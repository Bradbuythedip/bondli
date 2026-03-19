/**
 * Memetic Trading Pipeline
 *
 * Full integration: WS subscription → pre-filter → memetic score → on-chain score
 * → composite score → entry decision → Jito execution → position management → logging
 *
 * Pipeline target: <1500ms from token detection to execution
 */

import { EventEmitter } from 'events';
import { createClient } from 'redis';
import { AlchemyClient } from './alchemy-client.mjs';
import { scoreMemeticAll, scoreMemeticQuick, logTradeOutcome } from '../scoring/memetic/index.js';
import { recordLaunch, recordGraduation } from '../scoring/memetic/workers/launch-counter.js';
import { registerTokenForTrends } from '../scoring/memetic/workers/competitor-tracker.js';
import { recordViralEvent } from '../scoring/memetic/workers/viral-tracker.js';
import { startTrendPoller } from '../scoring/memetic/workers/trend-poller.js';
import { startKolMonitor } from '../scoring/memetic/workers/kol-monitor.js';
import { startMarketPoller } from '../scoring/memetic/workers/market-poller.js';
import { startCelebrityMonitor } from '../scoring/memetic/workers/celebrity-monitor.js';
import { startMindshareTracker } from '../scoring/memetic/workers/mindshare-tracker.js';
import { TrajectoryTracker, getExitParams } from './trajectory-classifier.mjs';

// Entry thresholds
const ENTRY_SCORE_THRESHOLD = 0.65;
const QUICK_SCORE_THRESHOLD = 0.40; // Pre-filter minimum
const MAX_POSITION_SIZE_SOL = 0.5;
const BASE_POSITION_SIZE_SOL = 0.1;

// Known rug signals for pre-filter
const KNOWN_RUG_DEVS = new Set(); // Populated from Redis at startup
const STOLEN_ART_HASHES = new Set(); // Populated from Redis at startup

let redis = null;

async function getRedis() {
  if (!redis) {
    redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redis.on('error', () => {});
    try { await redis.connect(); } catch { redis = null; }
  }
  return redis;
}

export class MemeticPipeline extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dryRun: config.dryRun ?? (process.env.DRY_RUN === 'true'),
      entryThreshold: config.entryThreshold || ENTRY_SCORE_THRESHOLD,
      quickThreshold: config.quickThreshold || QUICK_SCORE_THRESHOLD,
      maxPositionSol: config.maxPositionSol || MAX_POSITION_SIZE_SOL,
      basePositionSol: config.basePositionSol || BASE_POSITION_SIZE_SOL,
      ...config
    };

    this.alchemy = null;
    this.positions = new Map(); // tokenAddress -> position data
    this.trajectoryTrackers = new Map(); // tokenAddress -> TrajectoryTracker
    this.workers = [];
    this.stats = {
      tokensScanned: 0,
      tokensPreFiltered: 0,
      tokensFullScored: 0,
      tokensEntered: 0,
      startTime: Date.now()
    };
  }

  /**
   * Initialize and start the full pipeline
   */
  async start() {
    console.log('[pipeline] Starting Memetic Trading Pipeline...');

    // Initialize Alchemy client
    this.alchemy = new AlchemyClient({
      apiKey: this.config.alchemyApiKey || process.env.ALCHEMY_API_KEY
    });

    // Load known rug devs and stolen art hashes from Redis
    await this._loadBlacklists();

    // Start background workers
    this._startWorkers();

    // Subscribe to pump.fun new token events
    this.alchemy.on('new_token', (event) => this._handleNewToken(event));
    this.alchemy.on('graduation', (event) => this._handleGraduation(event));
    await this.alchemy.subscribePumpFunCreates();

    // Start position monitoring loop
    this._startPositionMonitor();

    console.log('[pipeline] Pipeline running. Dry run:', this.config.dryRun);
    this.emit('started');
  }

  /**
   * Pre-filter: <50ms. Reject obvious rugs/spam.
   */
  async _preFilter(tokenData) {
    const { tokenAddress, devWallet, imageHash, name, symbol } = tokenData;

    // Known rug developer
    if (devWallet && KNOWN_RUG_DEVS.has(devWallet)) {
      return { pass: false, reason: 'known_rug_dev' };
    }

    // Stolen art hash
    if (imageHash && STOLEN_ART_HASHES.has(imageHash)) {
      return { pass: false, reason: 'stolen_art' };
    }

    // Quick memetic score (linguistic + absurdity + temporal only)
    const quickResult = await scoreMemeticQuick({ name, symbol });
    if (quickResult.quickScore < this.config.quickThreshold) {
      return { pass: false, reason: 'low_quick_score', quickScore: quickResult.quickScore };
    }

    // Check for sybil burst (>10 buys from same funder in first 30s)
    try {
      const r = await getRedis();
      if (r) {
        const burstCount = parseInt(await r.get(`sybil:burst:${tokenAddress}`) || '0');
        if (burstCount > 10) {
          return { pass: false, reason: 'sybil_burst' };
        }
      }
    } catch {}

    return { pass: true, quickScore: quickResult.quickScore, quickResult };
  }

  /**
   * Handle new token detection from Alchemy WS
   */
  async _handleNewToken(event) {
    const startTime = Date.now();
    this.stats.tokensScanned++;

    try {
      const { tokenAddress, signature } = event;

      // Record launch for counter
      recordLaunch().catch(() => {});

      // Fetch token metadata
      const metadata = await this.alchemy.getTokenMetadata(tokenAddress);
      const name = metadata?.name || '';
      const symbol = metadata?.symbol || '';
      const imageUri = metadata?.logo || '';

      // Register for trend tracking
      registerTokenForTrends(tokenAddress, name, symbol).catch(() => {});

      // Emit for radar display (always, even if filtered)
      this.emit('token_detected', {
        tokenAddress, name, symbol, imageUri,
        timestamp: Date.now()
      });

      // --- PRE-FILTER (<50ms target) ---
      const filterResult = await this._preFilter({ tokenAddress, name, symbol });
      if (!filterResult.pass) {
        this.emit('token_filtered', {
          tokenAddress, name, symbol, reason: filterResult.reason,
          quickScore: filterResult.quickScore
        });
        return;
      }

      this.stats.tokensPreFiltered++;

      // --- FULL MEMETIC SCORE (<200ms target) ---
      const scoreResult = await scoreMemeticAll({
        name, symbol,
        description: metadata?.description || '',
        imageUri,
        tokenAddress,
        alchemy: this.alchemy.alchemy,
        onChainScore: 0.5, // Will be computed separately
        communityData: {},
        socialData: {},
        devData: {}
      });

      this.stats.tokensFullScored++;

      // Emit score for radar (with archetype color)
      this.emit('token_scored', {
        tokenAddress, name, symbol, imageUri,
        score: scoreResult.finalScore,
        memeticScore: scoreResult.memeticScore,
        archetype: scoreResult.archetype,
        moduleScores: scoreResult.moduleScores,
        interactionBonuses: scoreResult.interactionBonuses,
        elapsed: Date.now() - startTime
      });

      // --- ENTRY DECISION ---
      if (scoreResult.finalScore >= this.config.entryThreshold) {
        await this._executeEntry(tokenAddress, name, symbol, scoreResult);
      }
    } catch (err) {
      console.error(`[pipeline] Error processing token:`, err.message);
    }
  }

  /**
   * Execute entry into a position
   */
  async _executeEntry(tokenAddress, name, symbol, scoreResult) {
    if (this.positions.has(tokenAddress)) return; // Already in position

    // Kelly-adjusted position size
    const kellyDampener = scoreResult.kellyDampener || 0.25;
    const confidence = scoreResult.finalScore;
    const positionSize = Math.min(
      this.config.maxPositionSol,
      this.config.basePositionSol * (confidence / this.config.entryThreshold) * (kellyDampener / 0.25)
    );

    const position = {
      tokenAddress,
      name,
      symbol,
      entryScore: scoreResult.finalScore,
      memeticScore: scoreResult.memeticScore,
      archetype: scoreResult.archetype,
      positionSize,
      entryTime: Date.now(),
      entryPrice: 0, // Set after execution
      moduleScores: scoreResult.moduleScores,
      moduleFeatures: scoreResult.moduleFeatures,
      scoreHistory: []
    };

    this.positions.set(tokenAddress, position);
    this.trajectoryTrackers.set(tokenAddress, new TrajectoryTracker());

    // Log initial reading
    this.trajectoryTrackers.get(tokenAddress).addReading(scoreResult.finalScore);

    this.stats.tokensEntered++;

    if (this.config.dryRun) {
      console.log(`[pipeline] DRY RUN: Would enter ${symbol} (${tokenAddress.slice(0, 8)}...) @ ${positionSize.toFixed(3)} SOL, score: ${scoreResult.finalScore.toFixed(3)}, archetype: ${scoreResult.archetype}`);
    } else {
      // TODO: Jito bundle execution
      console.log(`[pipeline] ENTRY: ${symbol} @ ${positionSize.toFixed(3)} SOL, score: ${scoreResult.finalScore.toFixed(3)}`);
    }

    // Subscribe to token activity for monitoring
    await this.alchemy.subscribeTokenActivity(tokenAddress);

    this.emit('position_entered', position);
  }

  /**
   * Handle bonding curve graduation events
   */
  async _handleGraduation(event) {
    recordGraduation().catch(() => {});
    this.emit('graduation', event);
  }

  /**
   * Position monitoring loop - runs every 5 seconds
   */
  _startPositionMonitor() {
    setInterval(async () => {
      for (const [tokenAddress, position] of this.positions) {
        try {
          // Re-score the token
          const scoreResult = await scoreMemeticQuick({
            name: position.name,
            symbol: position.symbol
          });

          // Update trajectory tracker
          const tracker = this.trajectoryTrackers.get(tokenAddress);
          if (tracker) {
            tracker.addReading(scoreResult.quickScore);
            const trajectory = tracker.classify();

            // Get dynamic exit parameters
            const exitParams = getExitParams(trajectory, {
              trailingStopPercent: 0.1
            });

            // Check if we should exit
            if (exitParams.forceExit) {
              await this._executeExit(tokenAddress, position, trajectory);
            }

            // Emit position update
            this.emit('position_update', {
              tokenAddress,
              score: scoreResult.quickScore,
              trajectory: trajectory.type,
              recommendation: trajectory.recommendation,
              pnl: 0 // TODO: compute from on-chain
            });
          }

          // Check for viral events
          // TODO: check market cap and call recordViralEvent if > $1M

        } catch (err) {
          console.error(`[pipeline] Position monitor error for ${tokenAddress}:`, err.message);
        }
      }
    }, 5000);
  }

  /**
   * Execute exit from a position
   */
  async _executeExit(tokenAddress, position, trajectory) {
    const holdTime = Date.now() - position.entryTime;

    if (this.config.dryRun) {
      console.log(`[pipeline] DRY RUN: Would exit ${position.symbol}, trajectory: ${trajectory.type}, held: ${(holdTime / 1000).toFixed(0)}s`);
    } else {
      console.log(`[pipeline] EXIT: ${position.symbol}, trajectory: ${trajectory.type}`);
    }

    // Log trade outcome for learning pipeline
    await logTradeOutcome({
      tokenAddress,
      memeticScore: position.memeticScore,
      moduleScores: position.moduleScores,
      allFeatures: position.moduleFeatures,
      entryPrice: position.entryPrice,
      exitPrice: 0, // TODO: from on-chain
      pnl: 0,
      maxPnl: 0,
      holdTimeMs: holdTime,
      exitTrigger: trajectory.recommendation,
      trajectoryType: trajectory.type,
      wasRug: trajectory.type === 'flash_decay'
    });

    // Cleanup
    this.positions.delete(tokenAddress);
    this.trajectoryTrackers.delete(tokenAddress);
    await this.alchemy.unsubscribeToken(tokenAddress);

    this.emit('position_exited', {
      tokenAddress,
      symbol: position.symbol,
      trajectory: trajectory.type,
      holdTimeMs: holdTime
    });
  }

  /**
   * Load blacklists from Redis
   */
  async _loadBlacklists() {
    try {
      const r = await getRedis();
      if (!r) return;

      const rugDevs = await r.sMembers('blacklist:rug_devs');
      for (const dev of (rugDevs || [])) KNOWN_RUG_DEVS.add(dev);

      const artHashes = await r.sMembers('blacklist:stolen_art');
      for (const hash of (artHashes || [])) STOLEN_ART_HASHES.add(hash);

      console.log(`[pipeline] Loaded ${KNOWN_RUG_DEVS.size} rug devs, ${STOLEN_ART_HASHES.size} stolen art hashes`);
    } catch {}
  }

  /**
   * Start all background workers
   */
  _startWorkers() {
    try {
      this.workers.push(startTrendPoller());
      this.workers.push(startMarketPoller());
      this.workers.push(startCelebrityMonitor());
      this.workers.push(startMindshareTracker());

      // KOL monitor returns { pollTimer, dailyTimer }
      const kolTimers = startKolMonitor();
      this.workers.push(kolTimers.pollTimer);
      this.workers.push(kolTimers.dailyTimer);

      console.log('[pipeline] Background workers started');
    } catch (err) {
      console.error('[pipeline] Error starting workers:', err.message);
    }
  }

  /**
   * Get current pipeline stats
   */
  getStats() {
    return {
      ...this.stats,
      uptime: Date.now() - this.stats.startTime,
      activePositions: this.positions.size,
      positions: [...this.positions.values()].map(p => ({
        tokenAddress: p.tokenAddress,
        symbol: p.symbol,
        entryScore: p.entryScore,
        archetype: p.archetype,
        holdTime: Date.now() - p.entryTime,
        trajectory: this.trajectoryTrackers.get(p.tokenAddress)?.classify()?.type || 'unknown'
      }))
    };
  }

  /**
   * Shutdown the pipeline
   */
  async shutdown() {
    console.log('[pipeline] Shutting down...');

    // Stop workers
    for (const timer of this.workers) {
      if (timer) clearInterval(timer);
    }

    // Cleanup Alchemy subscriptions
    if (this.alchemy) await this.alchemy.cleanup();

    // Close Redis
    if (redis) await redis.quit().catch(() => {});

    this.emit('stopped');
  }
}

export default MemeticPipeline;
