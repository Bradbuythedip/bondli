// BONDLI — Launch Orchestrator
//
// Sits between fleet entry (Phase 1) and volume engine (Phase 2).
// Simulates organic post-launch activity so the chart looks real.
//
// THE PLAYBOOK:
//   T+0s:     Dev buy + fleet buys land (Jito bundle — already handled)
//   T+3-8s:   Dev sells ~25% into snipers — creates "dev taking profit" candle
//   T+10-30s: Cascading buy waves from fleet wallets (staggered, random sizes)
//   T+30-60s: Mix of buys/sells between fleet wallets (paint green+red candles)
//   T+60s+:   Hand off to ContinuousVolumeEngine
//
// Throughout: track external (non-fleet) buyers and adapt behavior.
// More external buyers = cool off fleet activity (let them create volume).
// No external buyers = intensify fleet activity (we ARE the market).
//
// AXIOM: A chart with ONLY green candles is a red flag. Real charts have dips.
// The dev sell creates the first dip. Fleet sells create micro-dips.
// External buyers see dips as entry points. This is the flywheel.

import { EventEmitter } from "events";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(base, variance) { return base + (Math.random() - 0.5) * 2 * variance; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Default orchestration config (tunable per launch)
const DEFAULT_CONFIG = {
  // Dev sell into snipers
  devSellPct: 0.25,          // dev sells 25% of position
  devSellChunks: 3,          // split across 3 sells (not one big dump)
  devSellDelayMs: 3000,      // start 3s after launch
  devSellGapMs: 2500,        // 2.5s between dev sell chunks

  // Cascade buy waves
  cascadeWaves: 4,           // 4 waves of staggered buys
  cascadeDelayMs: 8000,      // first wave starts 8s after launch
  cascadeWaveGapMs: 6000,    // 6s between waves
  cascadeWalletStagger: 800, // 800ms between wallets within a wave
  cascadeBuyPct: 0.12,       // each cascade buy = 12% of wallet balance

  // Mixed volume (buys + sells painting candles)
  mixedStartMs: 30000,       // start mixed trading 30s in
  mixedDurationMs: 30000,    // run for 30s before handing to volume engine
  mixedBuyBias: 0.65,        // 65% buys, 35% sells
  mixedTradeGapMs: 1500,     // 1.5s between trades
  mixedSellPct: 0.08,        // sell 8% of holdings per sell trade

  // External buyer adaptation
  coolOffThreshold: 3,       // cool off fleet when 3+ external buyers
  coolOffMultiplier: 0.3,    // reduce fleet activity to 30% when cooling
  intensifyThreshold: 0,     // intensify when 0 external buyers
  intensifyMultiplier: 1.5,  // 1.5x fleet activity when no externals
};

export class LaunchOrchestrator extends EventEmitter {
  constructor(session, executors, config = {}) {
    super();
    this.session = session;
    this.executors = executors; // { executeBuy, executeSell, fetchState }
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.running = false;

    // External buyer tracking
    this.externalBuyers = new Set();
    this.externalBuyCount = 0;
    this.externalSellCount = 0;
    this.lastExternalBuyTime = 0;

    // Stats
    this.stats = {
      devSellCount: 0,
      devSellSol: 0,
      cascadeBuyCount: 0,
      cascadeBuySol: 0,
      mixedBuyCount: 0,
      mixedSellCount: 0,
      mixedBuySol: 0,
      mixedSellSol: 0,
      externalBuyersTotal: 0,
      phaseTimings: {},
    };
  }

  /**
   * Run the full post-launch orchestration sequence.
   * Call this after Phase 1 (fleet entry) completes.
   */
  async run() {
    if (this.running) return;
    this.running = true;
    const t0 = Date.now();
    const { session, config } = this;

    console.log(`[ORCHESTRATOR] Starting post-launch sequence for ${session.ca.slice(0, 8)}...`);
    this.emit("phase", { phase: "dev_sell", ca: session.ca });

    // Start tracking external buyers from GameState
    this._startExternalTracking();

    try {
      // ═══ STAGE 1: Dev sells ~25% into snipers ═══
      await this._devSellIntoSnipers();
      this.stats.phaseTimings.devSell = Date.now() - t0;

      if (!this.running || !session.running) return;

      // ═══ STAGE 2: Cascading buy waves ═══
      this.emit("phase", { phase: "cascade_buys", ca: session.ca });
      await this._cascadeBuyWaves();
      this.stats.phaseTimings.cascade = Date.now() - t0;

      if (!this.running || !session.running) return;

      // ═══ STAGE 3: Mixed volume (paint chart with green + red candles) ═══
      this.emit("phase", { phase: "mixed_volume", ca: session.ca });
      await this._mixedVolumePhase();
      this.stats.phaseTimings.mixed = Date.now() - t0;

    } catch (e) {
      console.error(`[ORCHESTRATOR] Error: ${e.message}`);
    }

    this.emit("phase", { phase: "handoff", ca: session.ca });
    console.log(`[ORCHESTRATOR] Post-launch complete in ${((Date.now() - t0) / 1000).toFixed(1)}s | Stats:`, this.getStats());
    this.running = false;
  }

  stop() {
    this.running = false;
  }

  // ═══════════════════════════════════════════════════════════════
  //  STAGE 1: Dev sells ~25% into snipers
  //  Creates the critical first "dev taking profit" candle.
  //  Without this, chart shows only green = obvious bot.
  // ═══════════════════════════════════════════════════════════════
  async _devSellIntoSnipers() {
    const { session, config, executors } = this;
    const devWallet = session.fleetWallets.find(w => w.role === "dev" || w.role === "early1") || session.fleetWallets[0];
    if (!devWallet) return;

    // Wait before first dev sell
    await sleep(config.devSellDelayMs + Math.random() * 2000);
    if (!this.running) return;

    // Calculate total sell amount (% of dev's token position)
    // Adaptive: if dev buy was larger, sell more (proportional)
    const devBuySol = devWallet.solSpent || 0;
    const adjustedPct = devBuySol > 1
      ? Math.min(config.devSellPct * 1.2, 0.35) // bigger dev buy → sell up to 35%
      : devBuySol > 0.3
        ? config.devSellPct
        : config.devSellPct * 0.8; // small dev buy → sell less

    console.log(`[ORCHESTRATOR] Dev sell: ${(adjustedPct * 100).toFixed(0)}% in ${config.devSellChunks} chunks`);

    // Split into chunks (never one big sell — that looks like a dump)
    const chunkPct = adjustedPct / config.devSellChunks;

    for (let i = 0; i < config.devSellChunks && this.running && session.running; i++) {
      // Randomize chunk size slightly (±20%)
      const thisPct = chunkPct * jitter(1.0, 0.2);

      try {
        const result = await executors.executeSell(devWallet, thisPct);
        if (result?.ok) {
          this.stats.devSellCount++;
          this.stats.devSellSol += result.solOut || 0;
          this.emit("trade", {
            ca: session.ca, role: devWallet.role, side: "sell",
            sol: result.solOut, pct: thisPct, stage: "dev_sell",
          });
          console.log(`[ORCHESTRATOR] Dev sell ${i + 1}/${config.devSellChunks}: ${(thisPct * 100).toFixed(1)}% → ${(result.solOut || 0).toFixed(4)} SOL`);
        }
      } catch (e) {
        console.warn(`[ORCHESTRATOR] Dev sell chunk ${i + 1} failed: ${e.message}`);
      }

      // Gap between chunks (with jitter)
      if (i < config.devSellChunks - 1) {
        await sleep(jitter(config.devSellGapMs, config.devSellGapMs * 0.3));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  STAGE 2: Cascading buy waves
  //  Staggered buys from fleet wallets that look like organic buyers
  //  discovering the token. Each wave is slightly bigger than the last.
  // ═══════════════════════════════════════════════════════════════
  async _cascadeBuyWaves() {
    const { session, config, executors } = this;
    const buyable = session.fleetWallets.filter(w => w.funded && w.role !== "dev");

    if (buyable.length === 0) return;

    await sleep(config.cascadeDelayMs + Math.random() * 3000);

    for (let wave = 0; wave < config.cascadeWaves && this.running && session.running; wave++) {
      const activityMult = this._getActivityMultiplier();

      // Each wave picks 1-3 wallets (not the same ones each time)
      const shuffled = [...buyable].sort(() => Math.random() - 0.5);
      const waveSize = Math.min(1 + Math.floor(Math.random() * 2), shuffled.length);
      const waveWallets = shuffled.slice(0, waveSize);

      // Wave sizing: escalates slightly each wave
      const waveSizeMultiplier = 1 + wave * 0.15; // wave 1 = 1x, wave 4 = 1.45x

      console.log(`[ORCHESTRATOR] Cascade wave ${wave + 1}/${config.cascadeWaves}: ${waveWallets.length} wallets (${activityMult.toFixed(1)}x activity)`);

      for (const wallet of waveWallets) {
        if (!this.running || !session.running) return;

        const buyPct = config.cascadeBuyPct * waveSizeMultiplier * activityMult;
        const buyAmount = wallet.allocation * buyPct * jitter(1.0, 0.25);

        if (buyAmount < 0.005) continue;

        try {
          const result = await executors.executeBuy(wallet, buyAmount);
          if (result?.ok) {
            this.stats.cascadeBuyCount++;
            this.stats.cascadeBuySol += buyAmount;
            this.emit("trade", {
              ca: session.ca, role: wallet.role, side: "buy",
              sol: buyAmount, stage: "cascade", wave,
            });
          }
        } catch (e) {
          console.warn(`[ORCHESTRATOR] Cascade buy [${wallet.role}] failed: ${e.message}`);
        }

        await sleep(jitter(config.cascadeWalletStagger, 400));
      }

      // Gap between waves
      if (wave < config.cascadeWaves - 1) {
        await sleep(jitter(config.cascadeWaveGapMs, config.cascadeWaveGapMs * 0.3));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  STAGE 3: Mixed volume (green + red candles)
  //  Alternating buys and sells between fleet wallets.
  //  This paints a realistic chart with micro-dips that attract dip buyers.
  // ═══════════════════════════════════════════════════════════════
  async _mixedVolumePhase() {
    const { session, config, executors } = this;
    const active = session.fleetWallets.filter(w => w.funded);
    if (active.length < 2) return;

    await sleep(Math.max(0, config.mixedStartMs - (Date.now() - session.startTime)));

    const endTime = Date.now() + config.mixedDurationMs;
    let tradeNum = 0;

    while (Date.now() < endTime && this.running && session.running) {
      const activityMult = this._getActivityMultiplier();
      const doBuy = Math.random() < config.mixedBuyBias;
      const wallet = pick(active);

      try {
        if (doBuy) {
          const buyAmt = wallet.allocation * jitter(0.06, 0.03) * activityMult;
          if (buyAmt >= 0.003) {
            const result = await executors.executeBuy(wallet, buyAmt);
            if (result?.ok) {
              this.stats.mixedBuyCount++;
              this.stats.mixedBuySol += buyAmt;
              this.emit("trade", { ca: session.ca, role: wallet.role, side: "buy", sol: buyAmt, stage: "mixed" });
            }
          }
        } else {
          const sellPct = config.mixedSellPct * activityMult * jitter(1.0, 0.3);
          const result = await executors.executeSell(wallet, sellPct);
          if (result?.ok) {
            this.stats.mixedSellCount++;
            this.stats.mixedSellSol += result.solOut || 0;
            this.emit("trade", { ca: session.ca, role: wallet.role, side: "sell", sol: result.solOut, stage: "mixed" });
          }
        }
      } catch {
        // swallow individual trade errors
      }

      tradeNum++;
      const gap = jitter(config.mixedTradeGapMs, config.mixedTradeGapMs * 0.4) / activityMult;
      await sleep(Math.max(gap, 500));
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  EXTERNAL BUYER TRACKING
  //  Monitors GameState to detect non-fleet wallets buying/selling.
  //  Adapts fleet behavior: more externals = less fleet activity.
  // ═══════════════════════════════════════════════════════════════
  _startExternalTracking() {
    const gs = this.session.gameState;
    if (!gs) return;

    // Poll GameState every 3s
    this._trackInterval = setInterval(() => {
      if (!this.running) {
        clearInterval(this._trackInterval);
        return;
      }

      try {
        const snap = gs.snapshot ? gs.snapshot() : gs;
        const newBuyers = snap.uniqueBuyers || 0;
        const newBuys = snap.externalBuys || snap.totalBuys || 0;
        const newSells = snap.externalSells || snap.totalSells || 0;

        // Detect new external buyers
        if (newBuyers > this.externalBuyers.size) {
          const delta = newBuyers - this.externalBuyers.size;
          this.stats.externalBuyersTotal = newBuyers;
          this.lastExternalBuyTime = Date.now();
          console.log(`[ORCHESTRATOR] +${delta} new external buyer(s) detected (total: ${newBuyers})`);
          this.emit("external_buyer", { count: newBuyers, delta });
        }

        // Update tracking
        // Note: we can't get individual wallet addresses from all GameState impls,
        // so we track by count
        for (let i = this.externalBuyers.size; i < newBuyers; i++) {
          this.externalBuyers.add(`buyer_${i}`);
        }
        this.externalBuyCount = newBuys;
        this.externalSellCount = newSells;
      } catch {}
    }, 3000);
  }

  /**
   * Get activity multiplier based on external buyer presence.
   * More external buyers = less fleet activity (let them create volume).
   * No external buyers = more fleet activity (we ARE the market).
   */
  _getActivityMultiplier() {
    const externalCount = this.externalBuyers.size;
    const { coolOffThreshold, coolOffMultiplier, intensifyThreshold, intensifyMultiplier } = this.config;

    if (externalCount >= coolOffThreshold) {
      // Real buyers are active — cool off fleet
      return coolOffMultiplier;
    }

    if (externalCount <= intensifyThreshold) {
      // No external buyers — we need to intensify
      const timeSinceExternal = Date.now() - this.lastExternalBuyTime;
      if (timeSinceExternal > 30000) {
        // 30s+ without external buyers — full intensity
        return intensifyMultiplier;
      }
    }

    return 1.0; // normal activity
  }

  /**
   * Get orchestrator stats for monitoring.
   */
  getStats() {
    return {
      ...this.stats,
      externalBuyers: this.externalBuyers.size,
      externalBuyCount: this.externalBuyCount,
      externalSellCount: this.externalSellCount,
      running: this.running,
      activityMultiplier: this._getActivityMultiplier(),
    };
  }
}

export default LaunchOrchestrator;
