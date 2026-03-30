/**
 * ═══════════════════════════════════════════════════════════════
 * BONDLI PREMIUM COMPUTE — GPU-Powered Alpha Features for Degens
 * ═══════════════════════════════════════════════════════════════
 *
 * Paid GPU features that burn NOS through Nosana:
 *   - Deep Rug Scanner: forensic token analysis (0.005 SOL)
 *   - Entry Simulator: Monte Carlo before you ape (0.01 SOL)
 *   - Wallet X-Ray: deep-profile any wallet (0.008 SOL)
 *   - Exit Timing AI: optimal exit path modeling (0.005 SOL)
 *   - Launch Simulator: predict your token's trajectory (0.02 SOL)
 *   - Custom Watchlist AI: personalized scoring model (0.1 SOL/week)
 *   - Chart Pattern Pro: CNN pattern detection (0.05 SOL/week)
 *
 * Revenue flow:
 *   User pays SOL → Bondli takes margin → SOL swapped to NOS →
 *   NOS burned on Nosana GPU job → Results returned to user
 *
 * NOS burn accounting:
 *   Every premium feature usage is logged with NOS burned,
 *   providing verifiable on-chain proof for Nosana partnership metrics.
 * ═══════════════════════════════════════════════════════════════
 */

import { nosanaClient, buildJobDefinition, NOSANA_MARKETS } from "./nosana-client.mjs";

// ═══════════════════════════════════════
// PRICING — SOL per use
// ═══════════════════════════════════════

export const PREMIUM_FEATURES = {
  // ── Pay-per-use ──
  deep_rug_scan: {
    name: "Deep Rug Scanner",
    description: "Forensic token analysis — contract patterns, dev wallet graph, holder clustering, art forensics",
    price_sol: 0.005,
    gpu_market: "RTX 4090",
    est_duration_sec: 30,
    category: "scan",
    icon: "shield",
  },
  entry_simulator: {
    name: "Entry Simulator",
    description: "Monte Carlo simulation — 1,000 entry scenarios, slippage modeling, front-run probability",
    price_sol: 0.01,
    gpu_market: "RTX 4090",
    est_duration_sec: 45,
    category: "simulate",
    icon: "target",
  },
  wallet_xray: {
    name: "Wallet X-Ray",
    description: "Deep wallet profile — trade history, strategy classification, PnL curve, current holdings",
    price_sol: 0.008,
    gpu_market: "RTX 3090",
    est_duration_sec: 60,
    category: "scan",
    icon: "eye",
  },
  exit_optimizer: {
    name: "Exit Timing AI",
    description: "Optimal exit modeling — price trajectory Monte Carlo, dump probability windows, sell schedule",
    price_sol: 0.005,
    gpu_market: "RTX 4090",
    est_duration_sec: 30,
    category: "simulate",
    icon: "clock",
  },
  launch_simulator: {
    name: "Launch Simulator",
    description: "Pre-launch trajectory prediction — simulate 10K scenarios with your parameters",
    price_sol: 0.02,
    gpu_market: "RTX 4090",
    est_duration_sec: 90,
    category: "simulate",
    icon: "rocket",
  },
  mev_shield: {
    name: "MEV Protection",
    description: "Pre-trade MEV analysis — sandwich bot detection, optimal timing, priority fee recommendation",
    price_sol: 0.01,
    gpu_market: "RTX 3090",
    est_duration_sec: 15,
    category: "protect",
    icon: "lock",
  },
  portfolio_rebalance: {
    name: "Portfolio Rebalancer",
    description: "AI-optimized portfolio — correlation analysis, concentration risk, regime-adjusted sizing",
    price_sol: 0.02,
    gpu_market: "RTX 4090",
    est_duration_sec: 60,
    category: "optimize",
    icon: "chart",
  },

  // ── Subscriptions (weekly) ──
  custom_model: {
    name: "Custom Watchlist AI",
    description: "Personal scoring model trained on YOUR trade history — learns your style and risk profile",
    price_sol: 0.1,
    gpu_market: "RTX 4090",
    est_duration_sec: 3600, // training job
    category: "subscribe",
    period: "week",
    icon: "brain",
  },
  chart_pattern_pro: {
    name: "Chart Pattern Pro",
    description: "GPU-powered real-time chart analysis — accumulation zones, distribution patterns, fake breakouts",
    price_sol: 0.05,
    gpu_market: "RTX 4090",
    est_duration_sec: 1800,
    category: "subscribe",
    period: "week",
    icon: "trend",
  },
};

// Bondli margin on premium features
const PREMIUM_MARGIN = 0.25; // 25% — higher margin on value-add features

// ═══════════════════════════════════════
// JOB BUILDERS — Docker container specs for each feature
// ═══════════════════════════════════════

function buildDeepRugScanJob(tokenMint, tokenData = {}) {
  return buildJobDefinition({
    image: "docker.io/bondli/rug-scanner:latest",
    cmd: ["--mint", tokenMint, "--mode", "forensic", "--device", "cuda"],
    gpu: true,
    port: null,
    requiredVram: 8,
    variables: {
      TOKEN_MINT: tokenMint,
      TOKEN_NAME: tokenData.name || "",
      TOKEN_IMAGE_URL: tokenData.imageUrl || "",
      DEV_WALLET: tokenData.devWallet || "",
      HOLDER_COUNT: String(tokenData.holderCount || 0),
      LIQUIDITY_SOL: String(tokenData.liquiditySol || 0),
      MCAP_SOL: String(tokenData.mcapSol || 0),
    },
  });
}

function buildEntrySimulatorJob(tokenMint, params = {}) {
  return buildJobDefinition({
    image: "docker.io/bondli/entry-sim:latest",
    cmd: ["--mint", tokenMint, "--simulations", "1000", "--device", "cuda"],
    gpu: true,
    requiredVram: 4,
    variables: {
      TOKEN_MINT: tokenMint,
      BUY_SIZE_SOL: String(params.buySizeSol || 0.1),
      CURRENT_MCAP: String(params.currentMcap || 0),
      CURRENT_LIQUIDITY: String(params.currentLiquidity || 0),
      BONDING_CURVE_PCT: String(params.bondingCurvePct || 0),
      HOLDER_COUNT: String(params.holderCount || 0),
      BUY_PRESSURE: String(params.buyPressure || 50),
    },
  });
}

function buildWalletXrayJob(walletAddress) {
  return buildJobDefinition({
    image: "docker.io/bondli/wallet-xray:latest",
    cmd: ["--wallet", walletAddress, "--depth", "90d", "--device", "cuda"],
    gpu: true,
    requiredVram: 8,
    variables: {
      WALLET_ADDRESS: walletAddress,
      ANALYSIS_DEPTH_DAYS: "90",
      CLUSTER_WALLETS: "true",
    },
  });
}

function buildExitOptimizerJob(tokenMint, position = {}) {
  return buildJobDefinition({
    image: "docker.io/bondli/exit-optimizer:latest",
    cmd: ["--mint", tokenMint, "--simulations", "5000", "--device", "cuda"],
    gpu: true,
    requiredVram: 4,
    variables: {
      TOKEN_MINT: tokenMint,
      ENTRY_PRICE_SOL: String(position.entryPrice || 0),
      CURRENT_PRICE_SOL: String(position.currentPrice || 0),
      POSITION_SIZE_SOL: String(position.sizeSol || 0),
      HOLDER_COUNT: String(position.holderCount || 0),
      TIME_HELD_SEC: String(position.timeHeldSec || 0),
    },
  });
}

function buildLaunchSimulatorJob(params = {}) {
  return buildJobDefinition({
    image: "docker.io/bondli/launch-sim:latest",
    cmd: ["--simulations", "10000", "--device", "cuda"],
    gpu: true,
    requiredVram: 8,
    variables: {
      INITIAL_BUY_SOL: String(params.initialBuySol || 1),
      SNIPER_COUNT: String(params.sniperCount || 3),
      LIQUIDITY_SOL: String(params.liquiditySol || 5),
      MARKETING_DELAY_SEC: String(params.marketingDelaySec || 300),
      TOKEN_TICKER: params.ticker || "TEST",
      TOKEN_NARRATIVE: params.narrative || "",
    },
  });
}

function buildMevShieldJob(tokenMint, tradeParams = {}) {
  return buildJobDefinition({
    image: "docker.io/bondli/mev-shield:latest",
    cmd: ["--mint", tokenMint, "--analyze", "--device", "cuda"],
    gpu: true,
    requiredVram: 4,
    variables: {
      TOKEN_MINT: tokenMint,
      TRADE_SIDE: tradeParams.side || "buy",
      TRADE_SIZE_SOL: String(tradeParams.sizeSol || 0.1),
      CURRENT_SLOT: String(tradeParams.currentSlot || 0),
    },
  });
}

function buildPortfolioRebalanceJob(positions = []) {
  return buildJobDefinition({
    image: "docker.io/bondli/portfolio-ai:latest",
    cmd: ["--optimize", "--device", "cuda"],
    gpu: true,
    requiredVram: 4,
    variables: {
      POSITIONS_JSON: JSON.stringify(positions.slice(0, 20)), // max 20 positions
      TOTAL_SOL: String(positions.reduce((s, p) => s + (p.valueSol || 0), 0)),
    },
  });
}

// Map feature ID → job builder
const JOB_BUILDERS = {
  deep_rug_scan: (params) => buildDeepRugScanJob(params.mint, params),
  entry_simulator: (params) => buildEntrySimulatorJob(params.mint, params),
  wallet_xray: (params) => buildWalletXrayJob(params.wallet),
  exit_optimizer: (params) => buildExitOptimizerJob(params.mint, params),
  launch_simulator: (params) => buildLaunchSimulatorJob(params),
  mev_shield: (params) => buildMevShieldJob(params.mint, params),
  portfolio_rebalance: (params) => buildPortfolioRebalanceJob(params.positions || []),
};

// ═══════════════════════════════════════
// PREMIUM ENGINE CLASS
// ═══════════════════════════════════════

export class PremiumComputeEngine {
  constructor({ redis, connection, computeEngine, broadcastWS } = {}) {
    this.redis = redis;
    this.connection = connection;
    this.compute = computeEngine; // reference to ComputeEngine for job submission
    this.broadcastWS = broadcastWS || (() => {});

    // NOS burn tracking
    this.stats = {
      totalRequests: 0,
      totalRevenueSol: 0,
      totalNosBurned: 0,
      featureUsage: {},
    };
  }

  // ═══════════════════════════════════════
  // FEATURE EXECUTION
  // ═══════════════════════════════════════

  /**
   * Execute a premium feature.
   *
   * @param {string} featureId - Feature key from PREMIUM_FEATURES
   * @param {string} userId - User wallet
   * @param {object} params - Feature-specific parameters
   * @returns {{ jobId, feature, estimatedWait, priceSol }}
   */
  async execute(featureId, userId, params = {}) {
    const feature = PREMIUM_FEATURES[featureId];
    if (!feature) throw new Error(`Unknown feature: ${featureId}`);
    if (!userId) throw new Error("userId required");

    const jobBuilder = JOB_BUILDERS[featureId];
    if (!jobBuilder) throw new Error(`No job builder for: ${featureId}`);

    // Build the Nosana job definition
    const jobDef = jobBuilder(params);

    // Resolve GPU market
    const marketInfo = NOSANA_MARKETS[feature.gpu_market];
    if (!marketInfo) throw new Error(`Unknown GPU market: ${feature.gpu_market}`);

    // Estimate NOS cost
    const nosCost = +(marketInfo.nosPerSec * feature.est_duration_sec).toFixed(4);

    // Submit to Nosana via compute engine
    let jobResult;
    try {
      jobResult = await nosanaClient.createJob(jobDef, marketInfo.address, feature.est_duration_sec + 300);
    } catch (err) {
      throw new Error(`GPU job failed: ${err.message}`);
    }

    const jobId = jobResult.jobId;

    // Track in Redis
    const record = {
      jobId,
      featureId,
      featureName: feature.name,
      userId,
      params: JSON.stringify(params).slice(0, 500),
      priceSol: feature.price_sol,
      nosCost,
      market: feature.gpu_market,
      status: "queued",
      createdAt: Date.now(),
      completedAt: null,
      result: null,
    };

    if (this.redis) {
      await Promise.all([
        this.redis.set(`premium:job:${jobId}`, JSON.stringify(record), { EX: 86400 * 7 }),
        this.redis.zAdd(`premium:user:${userId}:jobs`, { score: Date.now(), value: jobId }),
        this.redis.expire(`premium:user:${userId}:jobs`, 86400 * 30),
        // Global NOS burn tracking
        this.redis.incrByFloat("premium:total_nos_burned", nosCost),
        this.redis.incrByFloat("premium:total_revenue_sol", feature.price_sol),
        this.redis.hIncrBy("premium:feature_usage", featureId, 1),
      ]);
    }

    // Update local stats
    this.stats.totalRequests++;
    this.stats.totalRevenueSol += feature.price_sol;
    this.stats.totalNosBurned += nosCost;
    this.stats.featureUsage[featureId] = (this.stats.featureUsage[featureId] || 0) + 1;

    // Broadcast
    this.broadcastWS({
      event: "premium_job",
      data: { jobId, feature: featureId, userId, status: "queued" },
    });

    // Poll for results
    this._pollResult(jobId, userId, featureId);

    console.log(`[PREMIUM] ${feature.name} submitted: ${jobId} (${userId.slice(0, 8)}..., ${feature.price_sol} SOL, ~${nosCost} NOS)`);

    return {
      jobId,
      feature: featureId,
      featureName: feature.name,
      priceSol: feature.price_sol,
      estimatedNosBurn: nosCost,
      estimatedWaitSec: feature.est_duration_sec,
      status: "queued",
    };
  }

  /**
   * Get result for a premium job.
   */
  async getResult(jobId) {
    if (!this.redis) return null;
    const raw = await this.redis.get(`premium:job:${jobId}`);
    if (!raw) return null;
    const record = JSON.parse(raw);

    // If already completed, return cached
    if (record.status === "completed" || record.status === "failed") {
      return record;
    }

    // Fetch live status from Nosana
    try {
      const nosanaJob = await nosanaClient.getJob(jobId);
      const status = nosanaJob?.status || nosanaJob?.state || "unknown";

      if (status === "completed" || status === "finished") {
        record.status = "completed";
        record.completedAt = Date.now();
        record.result = nosanaJob.result || nosanaJob.output || null;
      } else if (status === "failed" || status === "error") {
        record.status = "failed";
        record.completedAt = Date.now();
        record.result = nosanaJob.error || null;
      } else {
        record.status = status;
      }

      await this.redis.set(`premium:job:${jobId}`, JSON.stringify(record), { EX: 86400 * 7 });
      return record;
    } catch {
      return record;
    }
  }

  /**
   * Get user's premium job history.
   */
  async getUserHistory(userId, limit = 20) {
    if (!this.redis) return [];
    const jobIds = await this.redis.zRange(`premium:user:${userId}:jobs`, 0, limit - 1, { REV: true });
    if (!jobIds?.length) return [];
    const jobs = await Promise.all(jobIds.map(async id => {
      const raw = await this.redis.get(`premium:job:${id}`);
      return raw ? JSON.parse(raw) : null;
    }));
    return jobs.filter(Boolean);
  }

  /**
   * Get global premium stats — for the Nosana partnership dashboard.
   */
  async getGlobalStats() {
    const stats = { ...this.stats };
    if (this.redis) {
      const [nosBurned, revenueSol, featureUsage] = await Promise.all([
        this.redis.get("premium:total_nos_burned"),
        this.redis.get("premium:total_revenue_sol"),
        this.redis.hGetAll("premium:feature_usage"),
      ]);
      stats.totalNosBurned = parseFloat(nosBurned || "0");
      stats.totalRevenueSol = parseFloat(revenueSol || "0");
      stats.featureUsage = {};
      if (featureUsage) {
        for (const [k, v] of Object.entries(featureUsage)) {
          stats.featureUsage[k] = parseInt(v);
        }
      }
    }
    return stats;
  }

  // ── Polling ──

  _pollResult(jobId, userId, featureId) {
    let checks = 0;
    const interval = setInterval(async () => {
      checks++;
      if (checks > 60) { // 60 × 10s = 10 min max
        clearInterval(interval);
        return;
      }
      try {
        const record = await this.getResult(jobId);
        if (record?.status === "completed" || record?.status === "failed") {
          clearInterval(interval);
          this.broadcastWS({
            event: "premium_job_result",
            data: { jobId, feature: featureId, userId, status: record.status, result: record.result },
          });
        }
      } catch {}
    }, 10000);
  }

  // ═══════════════════════════════════════
  // EXPRESS ROUTES
  // ═══════════════════════════════════════

  mountRoutes(app, { getUser, resolveTier, isOwnerWallet } = {}) {

    // GET /api/premium/features — List all premium features + pricing
    app.get("/api/premium/features", (_req, res) => {
      const features = Object.entries(PREMIUM_FEATURES).map(([id, f]) => ({
        id,
        ...f,
        nosEstimate: +(NOSANA_MARKETS[f.gpu_market]?.nosPerSec * f.est_duration_sec || 0).toFixed(4),
      }));
      res.json({ features, enabled: nosanaClient.enabled });
    });

    // POST /api/premium/execute — Execute a premium feature
    app.post("/api/premium/execute", async (req, res) => {
      const { wallet, feature, params } = req.body || {};
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      if (!feature) return res.status(400).json({ error: "feature required" });
      if (!PREMIUM_FEATURES[feature]) return res.status(400).json({ error: `Unknown feature: ${feature}` });

      // Tier check: free users can't use premium features
      if (getUser && resolveTier) {
        const userInfo = await getUser(wallet);
        const tier = resolveTier(wallet, userInfo._redisError ? {} : userInfo);
        const hasTier = (isOwnerWallet && isOwnerWallet(wallet)) || tier.tier === "vip" || tier.tier === "pro" || userInfo?.whitelisted || userInfo?.demo;
        if (!hasTier) {
          return res.status(403).json({ error: "Tier upgrade required for premium GPU features" });
        }
      }

      try {
        const result = await this.execute(feature, wallet, params || {});
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/premium/result/:jobId — Get premium job result
    app.get("/api/premium/result/:jobId", async (req, res) => {
      try {
        const result = await this.getResult(req.params.jobId);
        res.json(result || { error: "Job not found" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/premium/history — User's premium job history
    app.get("/api/premium/history", async (req, res) => {
      const wallet = req.query.wallet;
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      try {
        const jobs = await this.getUserHistory(wallet, parseInt(req.query.limit) || 20);
        res.json({ jobs });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/premium/stats — Global NOS burn stats (public — shows Nosana partnership value)
    app.get("/api/premium/stats", async (_req, res) => {
      try {
        const stats = await this.getGlobalStats();
        res.json(stats);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    console.log("[PREMIUM] Routes mounted: /api/premium/* (" + Object.keys(PREMIUM_FEATURES).length + " features)");
  }
}

export default PremiumComputeEngine;
