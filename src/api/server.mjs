// BONDLI v3.0 — PRODUCTION API Server
// Tiers: Free (25% profit share), Pro (10 SOL one-time, 0%), VIP (whitelisted, 0%)
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { Connection, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";

// Engine
import { Orchestrator } from "../engine/orchestrator.mjs";
import { calculateFee, getFeeTier, isOwnerWallet, registerOwner } from "../engine/fee-engine.mjs";
import CONFIG from "../engine/config.mjs";

// Security middleware
import { securityHeaders, requestId, bodyLimit, extractIP } from "../middleware/security.mjs";
import { initRedis, getRedis, apiLimiter, launchLimiter } from "../middleware/rate-limiter.mjs";
import { requireAuth, optionalAuth } from "../middleware/auth.mjs";
import { launchSchema, closeSchema } from "../middleware/validate.mjs";

// Payments
import PaymentVerifier from "../payments/payment-verifier.mjs";
import createPaymentRoutes from "../payments/payment-routes.mjs";

// Sessions
import SessionStore from "../db/session-store.mjs";

// Intel — token discovery + scoring
import { HistoricalMovers } from "../engine/historical-movers.mjs";
import { scoreToken } from "../engine/velocity-scorer.mjs";

// Resurgence scanner — older coins having a revival
import { ResurgenceScanner } from "../engine/resurgence-scanner.mjs";

// Memetic scoring (Alchemy-free — uses PumpPortal data)
import { MemeticPipeline, scoreMemeticQuick, scoreTokenMemetic, loadBlacklists as loadMemeticBlacklists, startMemeticWorkers } from "../engine/memetic-pipeline.mjs";
import { scheduleRetraining } from "../scoring/memetic/learning-pipeline.js";

// Intelligence — meme scoring, score dynamics, artwork originality
import { MemeIntelligence, ScoreDynamics } from "../engine/meme-intelligence.mjs";
import { ArtworkScanner } from "../engine/artwork-scanner.mjs";
import { MetaTracker, calcOptimalSize, classifyToken } from "../engine/meta-engine.mjs";

// Launch Sessions (dev wallet generation + funding)
import { SessionManager, calculateDevBuy } from "../engine/session-manager.mjs";
import { createToken } from "../engine/token-creator.mjs";

// ═══════════════════════════════════════
// TIER + ACCESS SYSTEM
// ═══════════════════════════════════════
const VIP_FEE_SOL = parseFloat(process.env.VIP_FEE_SOL || "10");
const FREE_PROFIT_CUT = parseFloat(process.env.FREE_PROFIT_CUT || "25"); // percent
const PLATFORM_WALLET = process.env.PLATFORM_WALLET || "anal.sol";

function getWhitelist() {
  const raw = process.env.WHITELISTED_WALLETS || "";
  return new Set(raw.split(",").map(w => w.trim()).filter(Boolean));
}

// tier: "free" | "vip" | "none"
// whitelisted wallets bypass everything
async function getWalletTier(wallet) {
  // Platform wallet is always VIP
  if (wallet === PLATFORM_WALLET) return { tier: "vip", whitelisted: true, paid: true, profitCut: 0 };

  const whitelist = getWhitelist();
  if (whitelist.has(wallet)) return { tier: "vip", whitelisted: true, paid: true, profitCut: 0 };

  const redis = getRedis();
  if (redis) {
    try {
      const tier = await redis.get("tier:" + wallet);
      if (tier === "vip" || tier === "pro") return { tier: "vip", whitelisted: false, paid: true, profitCut: 0 };
      if (tier === "free") return { tier: "free", whitelisted: false, paid: false, profitCut: FREE_PROFIT_CUT };
    } catch {
      return { tier: "error", whitelisted: false, paid: false, profitCut: 0 };
    }
  }
  return { tier: "free", whitelisted: false, paid: false, profitCut: FREE_PROFIT_CUT };
}

async function setWalletTier(wallet, tier) {
  const redis = getRedis();
  if (redis) {
    try { await redis.set("tier:" + wallet, tier); } catch {}
  }
}

// Track profit per wallet for the free tier skim
async function recordProfit(wallet, netProfit, platformCut) {
  const redis = getRedis();
  if (!redis) return;
  try {
    const key = "profit:" + wallet;
    const existing = JSON.parse(await redis.get(key) || "{}");
    existing.totalProfit = (existing.totalProfit || 0) + netProfit;
    existing.totalSkimmed = (existing.totalSkimmed || 0) + platformCut;
    existing.closes = (existing.closes || 0) + 1;
    existing.lastClose = new Date().toISOString();
    await redis.set(key, JSON.stringify(existing));
  } catch {}
}

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
const app = express();
const IS_PROD = process.env.NODE_ENV === "production";
if (IS_PROD) app.set("trust proxy", 1);

app.use(requestId);
app.use(extractIP);
app.use(securityHeaders);

// CORS - after securityHeaders so we get the last word
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Wallet, X-API-Secret, X-Admin-Secret, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

app.use(bodyLimit(5_000_000)); // 5MB for base64 images
app.use(express.json({ limit: "5mb" }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const color = status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : "\x1b[32m";
    console.log(`${color}${req.method} ${req.path} ${status}\x1b[0m ${ms}ms [${req.clientIP}] ${req.id?.slice(0,8)}`);
  });
  next();
});

// ═══════════════════════════════════════
// SERVICES
// ═══════════════════════════════════════
let sessionStore, paymentVerifier, sessionManager, movers;
let intel, scoreDynamics, artworkScanner, metaTracker;
let memeticPipeline = null;
let resurgenceScanner = null;
const orch = new Orchestrator();

async function initServices() {
  const redis = await initRedis(process.env.REDIS_URL);
  sessionStore = new SessionStore(redis);
  sessionManager = new SessionManager(redis);
  movers = new HistoricalMovers(redis);
  const connection = new Connection(CONFIG.RPC_URL, "confirmed");
  paymentVerifier = new PaymentVerifier(connection);
  await paymentVerifier.init();

  // Meta tracker — narrative detection and memetic fitness tracking
  metaTracker = new MetaTracker();
  // Restore meta state from Redis
  if (redis) {
    try {
      const metaState = await redis.get("meta:state");
      if (metaState) metaTracker.import(JSON.parse(metaState));
    } catch {}
  }

  // Intelligence engine — thinking fast (score dynamics) and slow (ML + RAG)
  intel = new MemeIntelligence(redis, metaTracker);
  // Share intel engine with orchestrator so pre-buy safety gate uses same trained model
  orch.intel = intel;
  scoreDynamics = new ScoreDynamics(5000);
  artworkScanner = new ArtworkScanner(5000);

  // Restore artwork scanner state from Redis
  if (redis) {
    try {
      const artData = await redis.get("intel:artwork");
      if (artData) artworkScanner.import(JSON.parse(artData));
    } catch {}
  }

  // Outcome feedback loop — check every 5 min, auto-label + learn
  setInterval(async () => {
    try {
      if (!movers) return;
      const currentTokens = await movers.getCurrentTokens?.() || [];
      if (currentTokens.length === 0) return;
      const outcomes = await intel.checkOutcomes(currentTokens);
      if (outcomes.length > 0) {
        console.log(`[INTEL] Auto-labeled ${outcomes.length} outcomes | model v${intel.scorer.trainCount}`);
      }
      // Prune stale score dynamics entries
      scoreDynamics.prune();
      // Persist artwork scanner + meta tracker
      if (redis) {
        try { await redis.set("intel:artwork", JSON.stringify(artworkScanner.export()), { EX: 604800 }); } catch {}
        try { await redis.set("meta:state", JSON.stringify(metaTracker.export()), { EX: 604800 }); } catch {}
      }
    } catch (e) {
      console.error("[INTEL] Feedback loop error:", e.message);
    }
  }, 5 * 60 * 1000);

  // Resurgence scanner — older coins with renewed momentum
  resurgenceScanner = new ResurgenceScanner({ redis, smartMoneyTracker: orch.smartMoneyTracker || null });

  console.log("[INIT] All services ready (intel + artwork scanner + resurgence scanner active)");
}

// Simple wallet auth — checks X-Wallet header + tier access
async function walletAuth(req, res, next) {
  const wallet = req.headers["x-wallet"] || req.body?.wallet || req.query?.wallet;
  if (!wallet) return res.status(401).json({ error: "Wallet required. Pass X-Wallet header." });
  const info = await getWalletTier(wallet);
  if (info.tier === "none") return res.status(403).json({ error: "No access. Choose a tier first." });
  req.user = { wallet, tier: info.tier, whitelisted: info.whitelisted, profitCut: info.profitCut };
  next();
}

// Wallet identification only — no tier check (for session create)
async function walletIdentify(req, res, next) {
  const wallet = req.headers["x-wallet"] || req.body?.wallet || req.query?.wallet;
  if (!wallet) return res.status(401).json({ error: "Wallet required." });
  const info = await getWalletTier(wallet);
  req.user = { wallet, tier: info.tier, whitelisted: info.whitelisted, profitCut: info.profitCut };
  next();
}

// ═══════════════════════════════════════
// ROUTES — Health
// ═══════════════════════════════════════
app.get("/api/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), env: IS_PROD ? "production" : "development", sessionManager: !!sessionManager });
});

// ═══════════════════════════════════════
// ROUTES — Access / Tiers
// ═══════════════════════════════════════

// Check wallet tier + access status
app.get("/api/access/check", apiLimiter, async (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ error: "wallet required" });

  const info = await getWalletTier(wallet);
  if (info.tier === "error") {
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }
  res.json({
    access: info.tier !== "none",
    tier: info.tier,
    whitelisted: info.whitelisted,
    paid: info.paid,
    profitCut: info.profitCut,
    fee: info.tier === "none" ? VIP_FEE_SOL : 0,
  });
});

// Activate free tier — no payment needed, 25% profit share
app.post("/api/access/activate-free", apiLimiter, async (req, res) => {
  const { wallet } = req.body || {};
  if (!wallet) return res.status(400).json({ error: "wallet required" });

  const existing = await getWalletTier(wallet);
  if (existing.tier === "pro" || existing.whitelisted) {
    return res.json({ ok: true, tier: "pro", message: "Already pro/VIP" });
  }
  if (existing.tier === "error") {
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }

  await setWalletTier(wallet, "free");
  console.log(`[ACCESS] Free tier activated: ${wallet}`);
  res.json({ ok: true, tier: "free", profitCut: FREE_PROFIT_CUT });
});

// Activate pro tier — requires 10 SOL tx verification
app.post("/api/access/activate-pro", apiLimiter, async (req, res) => {
  const { wallet, txSig } = req.body || {};
  if (!wallet || !txSig) return res.status(400).json({ error: "wallet and txSig required" });

  // Verify the transaction on-chain
  try {
    const connection = new Connection(CONFIG.RPC_URL, "confirmed");
    const tx = await connection.getTransaction(txSig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    if (!tx) return res.status(400).json({ error: "Transaction not found. Wait for confirmation and retry." });
    if (tx.meta?.err) return res.status(400).json({ error: "Transaction failed on-chain" });

    // Verify amount: at least VIP_FEE_SOL sent
    // Check all instructions for a SOL transfer to platform wallet
    let verified = false;
    const requiredLamports = VIP_FEE_SOL * LAMPORTS_PER_SOL;

    // Check pre/post balances for platform wallet receiving funds
    const accountKeys = tx.transaction.message.staticAccountKeys
      ? tx.transaction.message.staticAccountKeys.map(k => k.toString())
      : tx.transaction.message.accountKeys.map(k => k.toString());

    // Find platform wallet in the tx accounts
    const platformIdx = accountKeys.indexOf(PLATFORM_WALLET);
    if (platformIdx >= 0 && tx.meta) {
      const pre = tx.meta.preBalances[platformIdx] || 0;
      const post = tx.meta.postBalances[platformIdx] || 0;
      const received = post - pre;
      if (received >= requiredLamports * 0.99) { // 1% tolerance for rounding
        verified = true;
      }
    }

    // Fallback: check if we can verify via paymentVerifier
    if (!verified && paymentVerifier) {
      try {
        const pvResult = await paymentVerifier.verify(txSig, wallet, VIP_FEE_SOL);
        if (pvResult?.verified) verified = true;
      } catch {}
    }

    if (!verified) {
      return res.status(400).json({
        error: `Payment not verified. Send exactly ${VIP_FEE_SOL} SOL to ${PLATFORM_WALLET}`,
      });
    }

    await setWalletTier(wallet, "pro");
    console.log(`[ACCESS] Pro tier activated: ${wallet} | tx: ${txSig}`);
    res.json({ ok: true, tier: "pro", profitCut: 0 });

  } catch (e) {
    console.error("[ACCESS] Pro verification error:", e.message);
    res.status(500).json({ error: "Verification failed. Try again." });
  }
});

// Admin: manually grant access
app.post("/api/access/grant", async (req, res) => {
  const secret = req.headers["x-api-secret"];
  if (secret !== CONFIG.API_SECRET) return res.status(403).json({ error: "forbidden" });
  const { wallet, tier } = req.body || {};
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  await setWalletTier(wallet, tier || "pro");
  console.log(`[ACCESS] Admin granted ${tier || "pro"} to: ${wallet}`);
  res.json({ ok: true, wallet, tier: tier || "pro" });
});

// Admin: view whitelist + stats
app.get("/api/access/whitelist", async (req, res) => {
  const secret = req.headers["x-api-secret"];
  if (secret !== CONFIG.API_SECRET) return res.status(403).json({ error: "forbidden" });
  const whitelist = getWhitelist();
  res.json({ wallets: [...whitelist], count: whitelist.size, proFee: VIP_FEE_SOL, profitCut: FREE_PROFIT_CUT });
});

// Admin: view wallet profit history
app.get("/api/access/profits", async (req, res) => {
  const secret = req.headers["x-api-secret"];
  if (secret !== CONFIG.API_SECRET) return res.status(403).json({ error: "forbidden" });
  const redis = getRedis();
  if (!redis) return res.json({ wallets: [] });
  try {
    const keys = await redis.keys("profit:*");
    const results = [];
    for (const key of keys) {
      const data = JSON.parse(await redis.get(key) || "{}");
      results.push({ wallet: key.replace("profit:", ""), ...data });
    }
    results.sort((a, b) => (b.totalSkimmed || 0) - (a.totalSkimmed || 0));
    res.json({ wallets: results, totalSkimmed: results.reduce((s, r) => s + (r.totalSkimmed || 0), 0) });
  } catch (e) {
    res.status(500).json({ error: IS_PROD ? "Server error. Check logs." : e.message });
  }
});

// ═══════════════════════════════════════
// ROUTES — Public
// ═══════════════════════════════════════
app.get("/api/status", apiLimiter, optionalAuth, (req, res) => {
  const status = orch.status();
  if (!req.user) return res.json({ ok: true, dryRun: status.dryRun, activeSessions: Object.keys(status.sessions).length });
  res.json({ ok: true, ...status });
});

app.get("/api/config", apiLimiter, (req, res) => {
  res.json({
    dryRun: CONFIG.DRY_RUN,
    totalSol: CONFIG.TOTAL_SOL,
    slippageBps: CONFIG.SLIPPAGE_BPS,
    purgePercent: CONFIG.PURGE_PERCENT,
    platformWallet: PLATFORM_WALLET,
    proFee: VIP_FEE_SOL,
    freeProfitCut: FREE_PROFIT_CUT,
  });
});

// ═══════════════════════════════════════
// ROUTES — Ape Targets (velocity-potential scoring)
// ═══════════════════════════════════════

// Get low-velocity, high-potential tokens to ape
app.get("/api/ape-targets", apiLimiter, async (req, res) => {
  try {
    if (!movers) return res.status(503).json({ error: "Still initializing" });
    const targets = await movers.getApeTargets();
    res.json(targets);
  } catch (e) {
    console.error("[APE-TARGETS]", e.message);
    res.status(500).json({ error: "Failed to fetch ape targets" });
  }
});

// Score a specific token (enhanced with dynamics + intel)
app.get("/api/score/:ca", apiLimiter, async (req, res) => {
  try {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(req.params.ca)) {
      return res.status(400).json({ error: "Invalid contract address" });
    }
    if (!movers) return res.status(503).json({ error: "Still initializing" });
    const scored = await movers.scoreToken(req.params.ca);
    if (!scored) return res.status(404).json({ error: "Token not found" });

    // Enrich with score dynamics (velocity/acceleration)
    if (scoreDynamics && scored.apeScore !== undefined) {
      scored.dynamics = scoreDynamics.record(req.params.ca, scored.apeScore);
    }

    // Enrich with intel deep score if available
    if (intel && scored.ca) {
      try {
        const intelScore = await intel.score(scored);
        scored.intelScore = intelScore.score;
        scored.bondProb = intelScore.bondProb;
        scored.rugScore = intelScore.rugScore;
        scored.rugFlags = intelScore.rugFlags;
        scored.chartPenalty = intelScore.chartPenalty;
        // Meta narrative info
        if (intelScore.narrative) {
          scored.narrative = intelScore.narrative;
          scored.narrativeName = intelScore.narrativeName;
          scored.metaBoost = intelScore.metaBoost || 0;
          scored.metaHeat = intelScore.metaHeat || 0;
        }
      } catch {}
    }

    // Enrich with memetic score (Alchemy-free)
    try {
      const memeticResult = await scoreMemeticQuick({
        name: scored.name || "", symbol: scored.ticker || "",
      });
      scored.memeticScore = memeticResult.quickScore;
      scored.memeticLinguistic = memeticResult.linguistic;
      scored.memeticAbsurdity = memeticResult.absurdity;
      scored.memeticTemporal = memeticResult.temporal;
      // Blend memetic into apeScore
      if (scored.apeScore !== undefined && memeticResult.quickScore > 0) {
        const memeticBoost = Math.round((memeticResult.quickScore - 0.45) * 24);
        scored.apeScoreRaw = scored.apeScore;
        scored.apeScore = Math.max(0, scored.apeScore + memeticBoost * 0.3);
      }
    } catch {}

    res.json(scored);
  } catch (e) {
    console.error("[SCORE]", e.message);
    res.status(500).json({ error: "Failed to score token" });
  }
});

// Full memetic score (on-demand, 7 modules)
const _memeticCache = new Map();
app.get("/api/memetic-score/:ca", apiLimiter, async (req, res) => {
  try {
    const ca = req.params.ca;
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca)) return res.status(400).json({ error: "Invalid CA" });
    const cached = _memeticCache.get(ca);
    if (cached && Date.now() - cached.ts < 300000) return res.json(cached.result);
    const token = { ca, name: "", ticker: "" };
    // Try to find in movers
    if (movers) {
      const scored = await movers.scoreToken(ca);
      if (scored) { token.name = scored.name || ""; token.ticker = scored.ticker || ""; token.description = scored.description || ""; token.image = scored.image || ""; }
    }
    const result = await scoreTokenMemetic(token);
    const response = {
      ca, score: result.finalScore, memeticScore: result.memeticScore, archetype: result.archetype,
      moduleScores: result.moduleScores || {}, interactionBonuses: result.interactionBonuses || [],
      elapsed: result.elapsed,
    };
    _memeticCache.set(ca, { result: response, ts: Date.now() });
    if (_memeticCache.size > 200) { for (const [k] of [..._memeticCache.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, 50)) _memeticCache.delete(k); }
    res.json(response);
  } catch (e) { res.status(500).json({ error: "Scoring failed" }); }
});

app.get("/api/fees", apiLimiter, (req, res) => {
  const sol = Math.min(100, Math.max(0, parseFloat(req.query.sol || "1")));
  const tier = getFeeTier(sol);
  const wallet = req.query.wallet || "";
  const owner = wallet ? isOwnerWallet(wallet) : false;
  res.json({ ...tier, isOwner: owner });
});

// ═══════════════════════════════════════
// ROUTES — Intelligence (thinking fast + slow)
// ═══════════════════════════════════════

// Deep score a token — MemeIntelligence (System 1/2 + Tipping Point + RAG)
app.get("/api/intel/score/:ca", apiLimiter, async (req, res) => {
  try {
    if (!intel) return res.status(503).json({ error: "Intel engine initializing" });
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(req.params.ca)) {
      return res.status(400).json({ error: "Invalid contract address" });
    }

    // Get token data from movers if available
    let tokenData = { ca: req.params.ca };
    if (movers?.getCurrentTokens) {
      const tokens = await movers.getCurrentTokens();
      const found = tokens.find(t => t.ca === req.params.ca);
      if (found) tokenData = found;
    }

    const scoreResult = await intel.score(tokenData);

    // Record in score dynamics for velocity/acceleration tracking
    const dynamics = scoreDynamics.record(req.params.ca, scoreResult.score);

    res.json({
      ...scoreResult,
      dynamics,
    });
  } catch (e) {
    console.error("[INTEL/SCORE]", e.message);
    res.status(500).json({ error: "Intel scoring failed" });
  }
});

// Get score dynamics (velocity + acceleration) for a token
app.get("/api/intel/dynamics/:ca", apiLimiter, (req, res) => {
  if (!scoreDynamics) return res.status(503).json({ error: "Not ready" });
  const dynamics = scoreDynamics.get(req.params.ca);
  if (!dynamics) return res.status(404).json({ error: "No dynamics data for this token" });
  res.json(dynamics);
});

// Bulk score dynamics — for the radar dashboard
app.post("/api/intel/dynamics/bulk", apiLimiter, express.json(), (req, res) => {
  if (!scoreDynamics) return res.status(503).json({ error: "Not ready" });
  const { tokens } = req.body || {};
  if (!Array.isArray(tokens)) return res.status(400).json({ error: "tokens array required" });

  const results = {};
  for (const t of tokens.slice(0, 200)) {
    const ca = t.ca || t;
    const score = typeof t === "object" ? t.score : null;

    // Record new score if provided
    if (score !== null && score !== undefined) {
      results[ca] = scoreDynamics.record(ca, score);
    } else {
      const existing = scoreDynamics.get(ca);
      if (existing) results[ca] = existing;
    }
  }
  res.json(results);
});

// Scan artwork for originality
app.post("/api/intel/artwork", apiLimiter, async (req, res) => {
  try {
    if (!artworkScanner) return res.status(503).json({ error: "Artwork scanner initializing" });
    const { ca, imageUrl, name } = req.body || {};
    if (!ca || !imageUrl) return res.status(400).json({ error: "ca and imageUrl required" });

    const result = await artworkScanner.scan(ca, imageUrl, name || "unknown");
    res.json(result);
  } catch (e) {
    console.error("[INTEL/ARTWORK]", e.message);
    res.status(500).json({ error: "Artwork scan failed" });
  }
});

// Bulk artwork scan (for radar pipeline)
app.post("/api/intel/artwork/bulk", apiLimiter, async (req, res) => {
  try {
    if (!artworkScanner) return res.status(503).json({ error: "Not ready" });
    const { tokens } = req.body || {};
    if (!Array.isArray(tokens)) return res.status(400).json({ error: "tokens array required" });

    const results = [];
    for (const t of tokens.slice(0, 50)) {
      if (!t.ca || !t.imageUrl) continue;
      const result = await artworkScanner.scan(t.ca, t.imageUrl, t.name || "unknown");
      results.push(result);
    }
    res.json({ results, scanned: results.length });
  } catch (e) {
    console.error("[INTEL/ARTWORK/BULK]", e.message);
    res.status(500).json({ error: "Bulk artwork scan failed" });
  }
});

// Intel stats — model accuracy, memory, artwork scanner stats + memetic
app.get("/api/intel/stats", apiLimiter, (req, res) => {
  const stats = {
    intel: intel ? intel.getStats() : null,
    dynamics: scoreDynamics ? { tracked: scoreDynamics.history.size } : null,
    artwork: artworkScanner ? artworkScanner.getStats() : null,
    meta: metaTracker ? metaTracker.getCurrentMeta() : null,
    memetic: memeticPipeline ? memeticPipeline.getStats() : null,
  };
  res.json(stats);
});

// Meta narrative stats — what's hot right now
app.get("/api/intel/meta", apiLimiter, (req, res) => {
  if (!metaTracker) return res.json({ active: false });
  res.json({
    current: metaTracker.getCurrentMeta(),
    narratives: metaTracker.getSummary(),
  });
});

// Manual outcome label (for admin/testing)
app.post("/api/intel/label", apiLimiter, async (req, res) => {
  const secret = req.headers["x-api-secret"];
  if (secret !== CONFIG.API_SECRET) return res.status(403).json({ error: "forbidden" });
  if (!intel) return res.status(503).json({ error: "Not ready" });

  const { ca, outcome } = req.body || {};
  if (!ca || !outcome) return res.status(400).json({ error: "ca and outcome required" });

  const result = await intel.labelOutcome(ca, outcome);
  res.json({ ok: true, result });
});

// ═══════════════════════════════════════
// ROUTES — Launch Sessions (dev wallet flow)
// ═══════════════════════════════════════

// Preview dev buy calculation (no auth needed)
app.get("/api/session/preview", apiLimiter, (req, res) => {
  const totalSol = Math.min(100, Math.max(0.1, parseFloat(req.query.sol || "1")));
  const info = calculateDevBuy(totalSol);
  res.json(info);
});

// Create session: generate dev wallet, return address for funding
app.post("/api/session/create", apiLimiter, async (req, res) => {
  try {
    if (!sessionManager) return res.status(503).json({ error: "Server still starting up. Try again in a few seconds." });
    const { totalSol, tokenConfig, wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    if (!totalSol || totalSol < 0.1 || totalSol > 100) {
      return res.status(400).json({ error: "totalSol must be between 0.1 and 100" });
    }
    if (!tokenConfig) return res.status(400).json({ error: "tokenConfig required" });
    if (!tokenConfig.existingCA && (!tokenConfig.name || !tokenConfig.ticker)) {
      return res.status(400).json({ error: "Need token name+ticker or existingCA" });
    }

    const walletInfo = await getWalletTier(wallet);

    const session = await sessionManager.create({
      userWallet: wallet,
      totalSol: Math.min(100, totalSol),
      tokenConfig,
      tier: walletInfo.tier,
    });

    res.json(session);
  } catch (e) {
    console.error("[SESSION] Create error:", e.message, e.stack);
    res.status(500).json({ error: "Failed to create session. Try again." });
  }
});

// Confirm deposit: user sends tx sig after Phantom transfer
app.post("/api/session/fund", apiLimiter, async (req, res) => {
  try {
    const { sessionId, txSig, wallet } = req.body;
    if (!sessionId || !txSig) return res.status(400).json({ error: "sessionId and txSig required" });
    if (!wallet) return res.status(400).json({ error: "wallet required" });

    const session = await sessionManager.getPublic(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });

    const result = await sessionManager.verifyDeposit(sessionId, txSig);
    if (!result.ok) return res.status(400).json(result);

    res.json({ ok: true, ...result, status: "funded" });
  } catch (e) {
    console.error("[SESSION] Fund error:", e.message);
    res.status(500).json({ error: "Deposit verification failed" });
  }
});

// Launch: create token on pump.fun + start orchestrator
app.post("/api/session/launch", apiLimiter, async (req, res) => {
  try {
    const { sessionId, wallet } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });
    if (!wallet) return res.status(400).json({ error: "wallet required" });

    const session = await sessionManager.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });
    if (!session.funded) return res.status(400).json({ error: "Session not funded yet" });
    if (session.status === "live") return res.status(400).json({ error: "Session already running" });

    const devKeypair = await sessionManager.getDevKeypair(sessionId);
    if (!devKeypair) return res.status(500).json({ error: "Dev wallet key not found" });

    await sessionManager.update(sessionId, { status: "creating", launchedAt: new Date().toISOString() });

    const existingCA = session.tokenConfig?.existingCA || null;
    let tokenCA = existingCA;
    let createResult = null;

    // ── Step 1: Create token on pump.fun (if no existing CA) ──
    if (!existingCA) {
      console.log(`[LAUNCH] Creating token: ${session.tokenConfig.name} ($${session.tokenConfig.ticker})`);
      console.log(`[LAUNCH] Dev wallet: ${devKeypair.publicKey.toBase58()}`);
      console.log(`[LAUNCH] Budget: ${session.devBuy} SOL dev buy + ${session.fleetBudget} SOL fleet`);
      
      const connection = new Connection(CONFIG.RPC_URL, "confirmed");
      
      createResult = await createToken(connection, devKeypair, session.tokenConfig, {
        devBuySol: session.devBuy,
        slippageBps: parseInt(CONFIG.SLIPPAGE_BPS || "2500"),
        priorityFee: parseInt(CONFIG.PRIORITY_FEE || "100000"),
        sendUrl: CONFIG.RPC_URL || null,
      });

      tokenCA = createResult.mint;
      console.log(`[LAUNCH] ✅ Token created: ${tokenCA}`);
      console.log(`[LAUNCH] 🔗 https://pump.fun/coin/${tokenCA}`);
    }

    // ── Step 2: Update session with CA ──
    await sessionManager.update(sessionId, {
      status: "live",
      tokenCA,
      createTx: createResult?.txSig || null,
      pumpUrl: `https://pump.fun/coin/${tokenCA}`,
      bondingCurve: createResult?.bondingCurve || null,
      metadataUri: createResult?.metadataUri || null,
    });

    // ── Step 3: Start orchestrator fleet on this CA ──
    let orchResult = { ok: true };
    try {
      // Set the CA in config so orchestrator trades it
      CONFIG.TOKEN_CA = tokenCA;
      
      // Find token data from radar if available (for intel scoring)
      let radarTokenData = null;
      if (existingCA) {
        // Look up this token in the current radar data for recent trades
        const radarTokens = movers?.lastResults || [];
        radarTokenData = radarTokens.find(t => t.ca === tokenCA) || { ca: tokenCA };
      }

      const launchConfig = {
        totalSol: session.fleetBudget,
        devBuy: existingCA ? session.devBuy : 0, // already bought in create tx
        devKeypair,
        tokenConfig: session.tokenConfig,
        sessionId: session.id,
        force: !existingCA, // Only force-bypass rug scan for our OWN tokens (we created them)
                            // For existing CAs, rug scan must pass
        tokenData: radarTokenData, // Pass token data for intel safety gate scoring
      };

      console.log(`[LAUNCH] Starting fleet with ${session.fleetBudget} SOL on ${tokenCA}`);
      console.log(`[LAUNCH] Orch type: ${typeof orch.launch}, Has launch: ${!!orch.launch}`);
      
      orchResult = await orch.launch(tokenCA, launchConfig);
      console.log(`[LAUNCH] Fleet result:`, JSON.stringify(orchResult).slice(0, 300));
    } catch (orchErr) {
      // Fleet failed but token was created — still a partial success
      console.warn("[LAUNCH] Fleet start failed:", orchErr.message);
      console.warn("[LAUNCH] Fleet error stack:", orchErr.stack?.split("\n").slice(0, 3).join("\n"));
      orchResult = { ok: true, fleetError: orchErr.message };
    }

    if (sessionStore) {
      await sessionStore.recordLaunch(session.userWallet, tokenCA, session.totalSol);
    }

    console.log(`[LAUNCH] ${sessionId} complete | CA: ${tokenCA} | devBuy: ${session.devBuy} SOL | fleet: ${session.fleetBudget} SOL`);

    res.json({
      ok: true,
      sessionId,
      tokenCA,
      pumpUrl: `https://pump.fun/coin/${tokenCA}`,
      devBuy: session.devBuy,
      fleetBudget: session.fleetBudget,
      createTx: createResult?.txSig || null,
      ...orchResult,
    });
  } catch (e) {
    console.error("[LAUNCH] Error:", e.stack || e.message);
    res.status(500).json({ error: e.message || "Launch failed" });
  }
});

// Check session balance (for auto-detect polling)
app.get("/api/session/balance", apiLimiter, async (req, res) => {
  const { sessionId, wallet } = req.query;
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });

  const session = await sessionManager.get(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.funded) return res.json({ funded: true, balance: session.actualDeposit || session.totalSol });

  try {
    const connection = new Connection(CONFIG.RPC_URL, "confirmed");
    const balance = await connection.getBalance(new PublicKey(session.devWallet));
    const balanceSol = balance / LAMPORTS_PER_SOL;
    const expectedMin = session.totalSol * 0.95;

    if (balanceSol >= expectedMin) {
      // Auto-mark funded
      await sessionManager.update(sessionId, {
        funded: true,
        fundedAt: new Date().toISOString(),
        status: "funded",
        actualDeposit: balanceSol,
      });
      console.log(`[SESSION] ${sessionId} auto-funded | ${balanceSol.toFixed(4)} SOL detected`);
      return res.json({ funded: true, balance: balanceSol });
    }

    res.json({ funded: false, balance: balanceSol, expected: session.totalSol });
  } catch (e) {
    res.json({ funded: false, balance: 0, error: e.message });
  }
});

// Get session status
app.get("/api/session/:id", apiLimiter, async (req, res) => {
  const wallet = req.query.wallet;
  const session = await sessionManager.getPublic(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (wallet && session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });
  res.json(session);
});

// List user's sessions
app.get("/api/sessions", apiLimiter, async (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  const sessions = await sessionManager.listForUser(wallet);
  res.json({ sessions, count: sessions.length });
});

// ═══════════════════════════════════════
// ROUTES — Protected (legacy launch, still works)
// ═══════════════════════════════════════
app.get("/api/wallets", apiLimiter, walletAuth, (req, res) => {
  res.json({ wallets: orch.walletOpt.summary() });
});

app.get("/api/curve/:ca", apiLimiter, walletAuth, async (req, res) => {
  try {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(req.params.ca)) return res.status(400).json({ error: "Invalid contract address" });
    const info = await orch.router.getCurveInfo(req.params.ca);
    res.json(info);
  } catch (e) { res.status(500).json({ error: "Failed to fetch curve info" }); }
});

app.post("/api/launch", launchLimiter, walletAuth, launchSchema, async (req, res) => {
  try {
    const { ca, totalSol, force } = req.body;
    const sol = Math.min(totalSol || CONFIG.TOTAL_SOL, 100);
    if (sessionStore) await sessionStore.recordLaunch(req.user.wallet, ca, sol);
    // Note: force only bypasses basic rug scan, NOT the intel safety gate
    // Intel gate always runs and blocks tokens with zero sells, fake volume, etc.
    const result = await orch.launch(ca, { totalSol: sol, force });
    res.json(result);
  } catch (e) { res.status(500).json({ error: IS_PROD ? "Server error. Check logs." : e.message }); }
});

// ═══════════════════════════════════════
// CLOSE — with free tier profit skim
// ═══════════════════════════════════════
app.post("/api/close", apiLimiter, walletAuth, closeSchema, async (req, res) => {
  try {
    const { ca } = req.body;
    const wallet = req.user.wallet;

    // Get wallet tier
    const walletInfo = await getWalletTier(wallet);

    // Execute close
    const result = await orch.close(ca);

    // Calculate profit share for free tier
    if (walletInfo.tier === "free" && !walletInfo.whitelisted) {
      const netProfit = result.netProfit || 0; // SOL profit after all sells

      if (netProfit > 0) {
        const platformCut = +(netProfit * (FREE_PROFIT_CUT / 100)).toFixed(6);
        const userKeeps = +(netProfit - platformCut).toFixed(6);

        console.log(`[FEE] Free tier skim: ${wallet} | profit: ${netProfit} SOL | cut: ${platformCut} SOL (${FREE_PROFIT_CUT}%) | user keeps: ${userKeeps} SOL`);

        // Record for admin dashboard
        await recordProfit(wallet, netProfit, platformCut);

        // If not dry run, send the platform cut
        if (!CONFIG.DRY_RUN && platformCut > 0.0001) {
          try {
            const connection = new Connection(CONFIG.RPC_URL, "confirmed");
            // The orchestrator's master wallet sends platformCut to PLATFORM_WALLET
            // This happens as part of the close sweep
            result.platformCut = platformCut;
            result.userKeeps = userKeeps;
            result.profitCutPercent = FREE_PROFIT_CUT;

            // Queue the transfer via orchestrator
            if (orch.queueProfitTransfer) {
              await orch.queueProfitTransfer(PLATFORM_WALLET, platformCut);
            }
          } catch (e) {
            console.error("[FEE] Transfer failed:", e.message);
            // Still record it — can collect manually later
          }
        }

        // Attach fee info to response
        result.fee = {
          tier: "free",
          netProfit,
          platformCut,
          userKeeps,
          cutPercent: FREE_PROFIT_CUT,
        };
      } else {
        // No profit = no fee
        result.fee = { tier: "free", netProfit, platformCut: 0, userKeeps: netProfit, cutPercent: 0 };
        console.log(`[FEE] Free tier: ${wallet} | no profit (${netProfit} SOL) — no fee charged`);
      }
    } else {
      // Pro/VIP: no fee
      result.fee = { tier: walletInfo.tier, netProfit: result.netProfit || 0, platformCut: 0, userKeeps: result.netProfit || 0, cutPercent: 0 };
    }

    res.json(result);
  } catch (e) { res.status(500).json({ error: IS_PROD ? "Server error. Check logs." : e.message }); }
});

app.post("/api/close-all", apiLimiter, walletAuth, async (req, res) => {
  try {
    const wallet = req.user.wallet;
    const walletInfo = await getWalletTier(wallet);
    const result = await orch.closeAll();

    // Apply profit skim to aggregate
    if (walletInfo.tier === "free" && !walletInfo.whitelisted) {
      const netProfit = result.totalNetProfit || 0;
      if (netProfit > 0) {
        const platformCut = +(netProfit * (FREE_PROFIT_CUT / 100)).toFixed(6);
        result.fee = { tier: "free", netProfit, platformCut, userKeeps: +(netProfit - platformCut).toFixed(6), cutPercent: FREE_PROFIT_CUT };
        await recordProfit(wallet, netProfit, platformCut);
        if (!CONFIG.DRY_RUN && platformCut > 0.0001 && orch.queueProfitTransfer) {
          try { await orch.queueProfitTransfer(PLATFORM_WALLET, platformCut); } catch {}
        }
        console.log(`[FEE] Close-all skim: ${wallet} | ${platformCut} SOL`);
      } else {
        result.fee = { tier: "free", netProfit, platformCut: 0, userKeeps: netProfit, cutPercent: 0 };
      }
    } else {
      result.fee = { tier: walletInfo.tier, platformCut: 0, cutPercent: 0 };
    }

    res.json(result);
  } catch (e) { res.status(500).json({ error: IS_PROD ? "Server error. Check logs." : e.message }); }
});

app.post("/api/fees/calculate", apiLimiter, walletAuth, (req, res) => {
  const { solIn, solReturn, wallet } = req.body;
  if (typeof solIn !== "number" || typeof solReturn !== "number") return res.status(400).json({ error: "solIn and solReturn must be numbers" });
  const fee = calculateFee(solIn, solReturn, wallet || "");
  res.json(fee);
});

// ═══════════════════════════════════════
// ROUTES — Admin
// ═══════════════════════════════════════
app.post("/api/register-owner", (req, res) => {
  const { secret, pubkey } = req.body;
  if (secret !== CONFIG.API_SECRET) return res.status(403).json({ error: "Forbidden" });
  if (!pubkey) return res.status(400).json({ error: "pubkey required" });
  registerOwner(pubkey);
  res.json({ ok: true });
});

app.get("/api/admin/sessions", async (req, res) => {
  if (req.headers["x-admin-secret"] !== CONFIG.API_SECRET) return res.status(403).json({ error: "Forbidden" });
  if (!sessionStore) return res.json({ sessions: [] });
  const sessions = await sessionStore.allSessions();
  res.json({ count: sessions.length, sessions });
});

// ═══════════════════════════════════════
// LIVE SIM ENGINE — mirrors auto-ape decisions without executing trades
// Available to ALL tiers. Shows real decisions, tracks P&L, auto-calibrates.
// After ~1hr of sim, settings can graduate to real auto-ape.
// ═══════════════════════════════════════
const liveSims = new Map(); // wallet|"anon_ip" → sim state

function createLiveSim(id, settings) {
  if (liveSims.has(id)) stopLiveSim(id);
  const state = {
    settings: {
      minScore: settings.minScore || 28,
      solPerTrade: settings.solPerTrade || 0.08,  // Raised from 0.05 — 0.05 barely covers fees
      maxPositions: settings.maxPositions || 5,
      // TP tiers: raised to ensure net profit after 25% cut + tx fees
      // TP1 at 40%: after fees (25% of 40% = 10%), net ~30% minus tx costs = ~25% net
      // Old TP1 at 25%: after fees net was ~13%, barely above breakeven
      tp1: settings.tp1 || 40, tp1Sell: settings.tp1Sell || 30,
      tp2: settings.tp2 || 100, tp2Sell: settings.tp2Sell || 30,
      tp3: settings.tp3 || 250, tp3Sell: settings.tp3Sell || 40,
      // SL tiers: tightened SL1 but loosened sell % — cut losers fast but don't dump all at once
      sl1: settings.sl1 || 15, sl1Sell: settings.sl1Sell || 50,
      sl2: settings.sl2 || 30,
      momentumExit: settings.momentumExit !== false,
    },
    positions: new Map(),    // ca → simulated position
    closedTrades: [],        // completed sim trades
    log: [],                 // decision log
    decisions: [],           // every buy/sell decision for UI feed
    startedAt: Date.now(),
    lastActivity: Date.now(),
    interval: null,
    // Auto-calibration state
    calibration: {
      predictions: [],       // { ca, predictedAction, actualOutcome, timestamp }
      accuracy: 0,
      totalPredictions: 0,
      correctPredictions: 0,
      lastCalibrated: Date.now(),
      adjustments: { tpBias: 0, slBias: 0, scoreBias: 0 },
    },
    // Graduation tracking
    graduation: {
      ready: false,
      simDurationMs: 0,
      totalSimTrades: 0,
      simWinRate: 0,
      simRoi: 0,
      confidence: 0,  // 0-100, needs >70 to graduate
    },
    stats: {
      totalBuys: 0, totalSells: 0,
      wins: 0, losses: 0,
      totalPnlSol: 0, totalInvested: 0,
      bestTrade: null, worstTrade: null,
      peakPnl: 0, maxDrawdown: 0,
    },
    soldCooldowns: new Map(),
  };

  const log = (msg, type = "info") => {
    const entry = { msg, type, time: Date.now() };
    state.log.push(entry);
    if (state.log.length > 100) state.log.shift();
    console.log(`[SIM][${id.slice(0, 8)}] ${msg}`);
  };

  const addDecision = (action, data) => {
    const d = { action, ...data, time: Date.now() };
    state.decisions.push(d);
    if (state.decisions.length > 200) state.decisions.shift();
    // Broadcast to WS so UI updates live
    broadcastWS({ event: "sim-decision", data: { simId: id, ...d } });
  };

  // Helper to broadcast to websocket clients
  function broadcastWS(msg) {
    const str = JSON.stringify(msg);
    wss.clients.forEach(ws => {
      if (ws.readyState === 1) { try { ws.send(str); } catch {} }
    });
  }

  // Fee-aware position sizing — ensures trades are large enough to profit after costs
  function calcPositionSize(score, trend, rugFlagCount, token) {
    // Get meta boost for this token
    const metaBoost = (metaTracker && token) ? metaTracker.getMetaBoost(token).boost : 0;

    // Use optimal sizing from meta-engine (accounts for fees, meta heat, expected return)
    const optimal = calcOptimalSize(score, metaBoost, state.settings.solPerTrade, trend, rugFlagCount);

    // Apply calibration bias on top
    let finalSize = optimal.size;
    finalSize *= 1 + (state.calibration.adjustments.scoreBias * 0.01);
    finalSize = Math.max(0.03, Math.min(state.settings.solPerTrade * 2.5, finalSize));

    return Math.round(finalSize * 1000) / 1000;
  }

  state.interval = setInterval(async () => {
    try {
      if (!movers) return;

      // Get current radar tokens
      const currentTokens = movers.lastResults || [];
      if (currentTokens.length === 0) return;
      const radarMap = new Map(currentTokens.map(t => [t.ca, t]));

      // ── CHECK EXISTING SIM POSITIONS ──
      for (const [ca, pos] of state.positions) {
        const token = radarMap.get(ca);
        if (!token) {
          // Token fell off radar — check age, maybe exit
          if (Date.now() - pos.entryTime > 300000) {
            const reason = "radar-exit";
            addDecision("SELL", { ca, name: pos.name, reason, pnlPct: 0, action: "EXIT" });
            log(`SIM EXIT ${pos.name}: fell off radar after ${Math.round((Date.now() - pos.entryTime) / 60000)}m`);
            closeTrade(ca, 0, reason);
          }
          continue;
        }

        const currentMcap = token.mcapUsd || 0;
        if (pos.entryMcap <= 0) continue;
        const changePct = ((currentMcap - pos.entryMcap) / pos.entryMcap) * 100;
        pos.peakMcap = Math.max(pos.peakMcap || pos.entryMcap, currentMcap);
        pos.currentMcap = currentMcap;
        pos.changePct = +changePct.toFixed(1);
        const fromPeak = pos.peakMcap > 0 ? ((pos.peakMcap - currentMcap) / pos.peakMcap) * 100 : 0;

        // Apply calibration adjustments to TP/SL
        const s = { ...state.settings };
        s.tp1 = Math.round(s.tp1 * (1 + state.calibration.adjustments.tpBias * 0.01));
        s.tp2 = Math.round(s.tp2 * (1 + state.calibration.adjustments.tpBias * 0.01));
        s.tp3 = Math.round(s.tp3 * (1 + state.calibration.adjustments.tpBias * 0.01));
        s.sl1 = Math.round(s.sl1 * (1 + state.calibration.adjustments.slBias * 0.01));
        s.sl2 = Math.round(s.sl2 * (1 + state.calibration.adjustments.slBias * 0.01));

        // ── MOMENTUM EXIT (score derivative) ──
        if (s.momentumExit && scoreDynamics) {
          const liveScore = token.apeScore || 0;
          if (pos.entryScore && liveScore > 0) {
            pos.liveScore = liveScore;
            const scoreDrop = pos.entryScore - liveScore;
            const dyn = scoreDynamics.get(ca);

            if (dyn?.trend === "crashing" && (dyn.scores || 0) >= 3) {
              addDecision("SELL", { ca, name: pos.name, reason: "crash-exit", pnlPct: changePct.toFixed(1), velocity: dyn.velocity, action: "CRASH EXIT" });
              log(`SIM CRASH EXIT ${pos.name}: score crashing v=${dyn.velocity}/s — FULL SELL at ${changePct.toFixed(1)}%`, "sell");
              closeTrade(ca, changePct, "crash-exit");
              continue;
            }
            if (scoreDrop >= 30) {
              addDecision("SELL", { ca, name: pos.name, reason: "momentum-exit", pnlPct: changePct.toFixed(1), scoreDrop, action: "MOMENTUM EXIT" });
              log(`SIM MOMENTUM EXIT ${pos.name}: score ${pos.entryScore}→${liveScore} (−${scoreDrop})`, "sell");
              closeTrade(ca, changePct, "momentum-exit");
              continue;
            }
            if (scoreDrop >= 20) {
              s.sl1 = Math.round(s.sl1 * 0.5);
              s.sl2 = Math.round(s.sl2 * 0.5);
            }
          }
        }

        // ── TAKE PROFIT — 3 tiers ──
        if (!pos.tpHit) pos.tpHit = 0;

        if (pos.tpHit < 3 && changePct >= s.tp3) {
          const trailPct = changePct > 400 ? 25 : changePct > 200 ? 20 : 15;
          if (fromPeak >= trailPct) {
            addDecision("SELL", { ca, name: pos.name, reason: "TP3", pnlPct: changePct.toFixed(1), sellPct: s.tp3Sell, action: `TP3 +${changePct.toFixed(0)}%` });
            log(`SIM TP3 ${pos.name}: +${changePct.toFixed(0)}% — would sell ${s.tp3Sell}% (moonbag rest)`, "profit");
            pos.tpHit = 3;
            pos.isMoonbag = true;
          }
        } else if (pos.tpHit < 2 && changePct >= s.tp2) {
          addDecision("SELL", { ca, name: pos.name, reason: "TP2", pnlPct: changePct.toFixed(1), sellPct: s.tp2Sell, action: `TP2 +${changePct.toFixed(0)}%` });
          log(`SIM TP2 ${pos.name}: +${changePct.toFixed(0)}% — would sell ${s.tp2Sell}%`, "profit");
          pos.tpHit = 2;
        } else if (pos.tpHit < 1 && changePct >= s.tp1) {
          addDecision("SELL", { ca, name: pos.name, reason: "TP1", pnlPct: changePct.toFixed(1), sellPct: s.tp1Sell, action: `TP1 +${changePct.toFixed(0)}%` });
          log(`SIM TP1 ${pos.name}: +${changePct.toFixed(0)}% — would sell ${s.tp1Sell}%`, "profit");
          pos.tpHit = 1;
        } else if (fromPeak > 35 && changePct > 25 && pos.tpHit === 0) {
          // Trailing stop: only triggers if we were up 25%+ and dropped 35% from peak
          // Old: changePct > 10 was too close to breakeven after fees
          addDecision("SELL", { ca, name: pos.name, reason: "trailing", pnlPct: changePct.toFixed(1), sellPct: s.tp1Sell, action: `TRAIL +${changePct.toFixed(0)}%` });
          log(`SIM TRAIL ${pos.name}: +${changePct.toFixed(0)}% (down ${fromPeak.toFixed(0)}% from peak)`, "profit");
          pos.tpHit = 1;
        }

        // ── STOP LOSS — 2 tiers ──
        if (pos.isMoonbag) {
          if (changePct <= -80) {
            addDecision("SELL", { ca, name: pos.name, reason: "moonbag-dead", pnlPct: changePct.toFixed(1), action: "MOONBAG DEAD" });
            log(`SIM MOONBAG DEAD ${pos.name}: ${changePct.toFixed(0)}%`, "loss");
            closeTrade(ca, changePct, "moonbag-dead");
          }
        } else if (changePct <= -s.sl2) {
          addDecision("SELL", { ca, name: pos.name, reason: "SL2", pnlPct: changePct.toFixed(1), action: `SL2 ${changePct.toFixed(0)}%` });
          log(`SIM SL2 ${pos.name}: ${changePct.toFixed(0)}% — full exit`, "loss");
          closeTrade(ca, changePct, "SL2");
        } else if (!pos.slHit && changePct <= -s.sl1) {
          addDecision("SELL", { ca, name: pos.name, reason: "SL1", pnlPct: changePct.toFixed(1), sellPct: s.sl1Sell, action: `SL1 ${changePct.toFixed(0)}%` });
          log(`SIM SL1 ${pos.name}: ${changePct.toFixed(0)}% — would sell ${s.sl1Sell}%`, "loss");
          pos.slHit = 1;
        }
      }

      // ── LOOK FOR NEW TOKENS TO SIM-BUY ──
      if (state.positions.size >= state.settings.maxPositions) return;

      // Clean expired cooldowns
      for (const [c, t] of state.soldCooldowns) {
        if (Date.now() - t > 1800000) state.soldCooldowns.delete(c);
      }

      // Enrich candidates with memetic quick score (async, non-blocking)
      let memeticQuickScorer = null;
      try { memeticQuickScorer = (await import("../scoring/memetic/index.js")).scoreMemeticQuick; } catch {}

      const candidatesRaw = currentTokens.filter(t => {
        const mc = t.mcapUsd || 0;
        const buys = t.buys || 0;
        const ub = t.uniqueBuyers || 0;
        const ageMin = (Date.now() - (t.createdAt || Date.now())) / 60000;
        const sells = t.sells || 0;
        if (mc < 2500 || buys < 2 || ub < 2 || ageMin < 0.5) return false;
        if (sells > buys * 1.2) return false;
        if (state.positions.has(t.ca)) return false;
        if (state.soldCooldowns.has(t.ca)) return false;
        // Use apeScore from radar if available
        const score = t.apeScore || 0;
        const effectiveMin = state.settings.minScore + state.calibration.adjustments.scoreBias;
        if (score < effectiveMin) return false;
        // Check score dynamics if available
        if (scoreDynamics) {
          const dyn = scoreDynamics.get(t.ca);
          if (dyn?.trend === "crashing") return false;
          if (!dyn || (dyn.scores || 0) < 2) return false;
        }
        return true;
      });

      // Apply memetic scoring to candidates for smarter ranking
      const candidates = [];
      for (const t of candidatesRaw) {
        if (memeticQuickScorer) {
          try {
            const ms = await memeticQuickScorer({ name: t.name || "", symbol: t.ticker || "" });
            t.memeticScore = ms.quickScore;
            // Boost apeScore with memetic signal: strong memetic = boost, weak = dampen
            const mBoost = (ms.quickScore - 0.5) * 3; // -1.5 to +1.5
            t.apeScore = Math.max(0, (t.apeScore || 0) + mBoost * 0.25);
          } catch {}
        }
        candidates.push(t);
      }
      candidates.sort((a, b) => (b.apeScore || 0) - (a.apeScore || 0));

      // Sim-buy top 2 candidates
      for (const t of candidates.slice(0, 2)) {
        if (state.positions.size >= state.settings.maxPositions) break;
        const score = t.apeScore || 0;
        const dyn = scoreDynamics?.get(t.ca);
        const trend = dyn?.trend || "new";
        const rugFlagCount = t.rugFlags?.length || 0;
        const tradeSol = calcPositionSize(score, trend, rugFlagCount, t);
        const sizeMult = +(tradeSol / state.settings.solPerTrade).toFixed(2);

        state.positions.set(t.ca, {
          name: t.name || t.ca.slice(0, 8),
          ticker: t.ticker || "",
          image: t.image || "",
          entryMcap: t.mcapUsd || 0,
          currentMcap: t.mcapUsd || 0,
          peakMcap: t.mcapUsd || 0,
          entrySol: tradeSol,
          entryTime: Date.now(),
          entryScore: score,
          liveScore: score,
          sizeMult,
          changePct: 0,
          tpHit: 0, slHit: 0,
          isMoonbag: false,
          trend,
        });

        state.stats.totalBuys++;
        state.stats.totalInvested += tradeSol;

        addDecision("BUY", {
          ca: t.ca, name: t.name || t.ca.slice(0, 8),
          score, trend, sizeMult, sol: tradeSol,
          mcap: t.mcapUsd, rugFlags: t.rugFlags || [],
          action: `BUY ${t.name || t.ca.slice(0, 6)} @ $${Math.round(t.mcapUsd || 0)} MC`,
        });
        log(`SIM BUY ${t.name || t.ca.slice(0, 6)} | score:${score} trend:${trend} | MC:$${Math.round(t.mcapUsd || 0)} | ${tradeSol} SOL (${sizeMult}x)`, "buy");

        // Record prediction for calibration
        state.calibration.predictions.push({
          ca: t.ca, entryMcap: t.mcapUsd || 0,
          predictedAction: "buy", entryScore: score,
          timestamp: Date.now(), resolved: false,
        });
      }

      // ── AUTO-CALIBRATION — compare predictions to outcomes ──
      if (Date.now() - state.calibration.lastCalibrated > 60000) {
        calibrateSim(state);
      }

      // ── UPDATE GRADUATION STATUS ──
      updateGraduation(state);

    } catch (e) {
      log(`Sim loop error: ${e.message}`, "error");
    }
  }, 5000); // check every 5s

  function closeTrade(ca, changePct, reason) {
    const pos = state.positions.get(ca);
    if (!pos) return;
    const pnlSol = +(pos.entrySol * (changePct / 100)).toFixed(4);
    const trade = {
      ca, name: pos.name, entrySol: pos.entrySol,
      entryMcap: pos.entryMcap, exitMcap: pos.currentMcap || pos.entryMcap,
      changePct: +changePct.toFixed(1), pnlSol,
      exitReason: reason, exitTime: Date.now(),
      entryScore: pos.entryScore, holdTime: Date.now() - pos.entryTime,
    };
    state.closedTrades.push(trade);
    if (state.closedTrades.length > 100) state.closedTrades.shift();

    // Update stats
    state.stats.totalSells++;
    state.stats.totalPnlSol = +(state.stats.totalPnlSol + pnlSol).toFixed(4);
    if (pnlSol > 0) state.stats.wins++;
    else state.stats.losses++;
    if (pnlSol > (state.stats.bestTrade?.pnlSol || -Infinity)) state.stats.bestTrade = trade;
    if (pnlSol < (state.stats.worstTrade?.pnlSol || Infinity)) state.stats.worstTrade = trade;
    if (state.stats.totalPnlSol > state.stats.peakPnl) state.stats.peakPnl = state.stats.totalPnlSol;
    const drawdown = state.stats.peakPnl - state.stats.totalPnlSol;
    if (drawdown > state.stats.maxDrawdown) state.stats.maxDrawdown = drawdown;

    // Resolve calibration prediction
    const pred = state.calibration.predictions.find(p => p.ca === ca && !p.resolved);
    if (pred) {
      pred.resolved = true;
      pred.actualOutcome = pnlSol > 0 ? "win" : "loss";
      pred.actualPnl = pnlSol;
      state.calibration.totalPredictions++;
      if ((pnlSol > 0 && pred.predictedAction === "buy") || (pnlSol <= 0 && pred.predictedAction === "skip")) {
        state.calibration.correctPredictions++;
      }
    }

    state.positions.delete(ca);
    state.soldCooldowns.set(ca, Date.now());
  }

  function calibrateSim(state) {
    state.calibration.lastCalibrated = Date.now();
    const resolved = state.calibration.predictions.filter(p => p.resolved);
    if (resolved.length < 5) return; // need minimum data

    state.calibration.accuracy = state.calibration.totalPredictions > 0
      ? Math.round((state.calibration.correctPredictions / state.calibration.totalPredictions) * 100) : 0;

    // Analyze recent trades to adjust TP/SL bias
    const recent = state.closedTrades.slice(-20);
    if (recent.length < 3) return;

    const avgPnl = recent.reduce((s, t) => s + t.pnlSol, 0) / recent.length;
    const slExits = recent.filter(t => t.exitReason.includes("SL")).length;
    const tpExits = recent.filter(t => t.exitReason.includes("TP")).length;
    const slRate = slExits / recent.length;

    // Auto-adjust: if too many SL exits, tighten entry (raise min score)
    if (slRate > 0.6 && recent.length >= 5) {
      state.calibration.adjustments.scoreBias = Math.min(15, state.calibration.adjustments.scoreBias + 2);
      log(`CALIBRATE: high SL rate (${(slRate * 100).toFixed(0)}%) → raising min score bias to +${state.calibration.adjustments.scoreBias}`, "calibrate");
    } else if (slRate < 0.3 && avgPnl > 0) {
      state.calibration.adjustments.scoreBias = Math.max(-10, state.calibration.adjustments.scoreBias - 1);
    }

    // If TP exits are mostly TP1 (never reaching TP2/TP3), widen TP1
    const tp1Only = recent.filter(t => t.exitReason === "TP1").length;
    if (tpExits > 0 && tp1Only / tpExits > 0.8) {
      state.calibration.adjustments.tpBias = Math.min(20, state.calibration.adjustments.tpBias + 3);
      log(`CALIBRATE: most exits at TP1 → widening TP triggers (+${state.calibration.adjustments.tpBias}%)`, "calibrate");
    }

    // If losses are deep (avg loss > 2x SL1), tighten SL
    const lossAvg = recent.filter(t => t.pnlSol < 0).reduce((s, t) => s + Math.abs(t.changePct), 0) / Math.max(1, slExits);
    if (lossAvg > state.settings.sl1 * 2 && slExits > 2) {
      state.calibration.adjustments.slBias = Math.max(-15, state.calibration.adjustments.slBias - 2);
      log(`CALIBRATE: deep losses (avg -${lossAvg.toFixed(0)}%) → tightening SL (${state.calibration.adjustments.slBias}%)`, "calibrate");
    }

    // Prune old predictions (keep last 100)
    state.calibration.predictions = state.calibration.predictions.slice(-100);
  }

  function updateGraduation(state) {
    const simDuration = Date.now() - state.startedAt;
    const totalTrades = state.stats.wins + state.stats.losses;
    const winRate = totalTrades > 0 ? Math.round((state.stats.wins / totalTrades) * 100) : 0;
    const roi = state.stats.totalInvested > 0 ? +((state.stats.totalPnlSol / state.stats.totalInvested) * 100).toFixed(1) : 0;

    // Confidence formula:
    // - Duration: 30pts max (1hr = full)
    // - Trade count: 25pts max (20 trades = full)
    // - Win rate: 25pts max (>55% = full)
    // - Positive ROI: 20pts
    const durationPts = Math.min(30, (simDuration / 3600000) * 30);
    const tradePts = Math.min(25, (totalTrades / 20) * 25);
    const winPts = winRate >= 55 ? 25 : winRate >= 45 ? 15 : 5;
    const roiPts = roi > 0 ? 20 : roi > -5 ? 10 : 0;
    const confidence = Math.min(100, Math.round(durationPts + tradePts + winPts + roiPts));

    state.graduation = {
      ready: confidence >= 70 && simDuration >= 3600000, // min 1hr + 70% confidence
      simDurationMs: simDuration,
      totalSimTrades: totalTrades,
      simWinRate: winRate,
      simRoi: roi,
      confidence,
    };
  }

  liveSims.set(id, state);
  log(`Live sim started: minScore=${state.settings.minScore} sol=${state.settings.solPerTrade} TP1=${state.settings.tp1}% SL1=${state.settings.sl1}%`);
  return state;
}

function stopLiveSim(id) {
  const state = liveSims.get(id);
  if (state) {
    clearInterval(state.interval);
  }
  liveSims.delete(id);
}

// ── Live Sim Routes — available to ALL tiers ──

// Start live sim (no wallet/trading key required)
app.post("/api/sim/start", apiLimiter, async (req, res) => {
  try {
    const { wallet, settings } = req.body;
    // Use wallet if available, otherwise use IP
    const id = wallet || ("anon_" + (req.clientIP || "unknown"));
    const state = createLiveSim(id, settings || {});
    res.json({ ok: true, simId: id, settings: state.settings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Stop/close sim mode
app.post("/api/sim/stop", apiLimiter, (req, res) => {
  const { wallet } = req.body;
  const id = wallet || ("anon_" + (req.clientIP || "unknown"));
  const state = liveSims.get(id);
  if (!state) return res.json({ ok: true, message: "No sim running" });

  // Return final stats before closing
  const finalStats = {
    duration: Date.now() - state.startedAt,
    ...state.stats,
    winRate: (state.stats.wins + state.stats.losses) > 0
      ? Math.round((state.stats.wins / (state.stats.wins + state.stats.losses)) * 100) : 0,
    roi: state.stats.totalInvested > 0
      ? +((state.stats.totalPnlSol / state.stats.totalInvested) * 100).toFixed(1) : 0,
    calibration: state.calibration,
    graduation: state.graduation,
    closedTrades: state.closedTrades.slice(-20),
  };

  stopLiveSim(id);
  res.json({ ok: true, finalStats });
});

// Get live sim status (polled by frontend)
app.get("/api/sim/status", apiLimiter, (req, res) => {
  const wallet = req.query.wallet;
  const id = wallet || ("anon_" + (req.clientIP || "unknown"));
  const state = liveSims.get(id);
  if (!state) return res.json({ active: false });

  state.lastActivity = Date.now();

  const totalTrades = state.stats.wins + state.stats.losses;
  res.json({
    active: true,
    settings: state.settings,
    positions: [...state.positions.entries()].map(([ca, p]) => ({
      ca, name: p.name, ticker: p.ticker, image: p.image,
      entryMcap: p.entryMcap, currentMcap: p.currentMcap,
      peakMcap: p.peakMcap, changePct: p.changePct,
      entrySol: p.entrySol, sizeMult: p.sizeMult,
      entryScore: p.entryScore, liveScore: p.liveScore,
      trend: p.trend, tpHit: p.tpHit || 0, slHit: p.slHit || 0,
      isMoonbag: !!p.isMoonbag,
      age: Math.round((Date.now() - p.entryTime) / 60000),
    })),
    decisions: state.decisions.slice(-30),
    log: state.log.slice(-30),
    stats: {
      ...state.stats,
      totalTrades,
      winRate: totalTrades > 0 ? Math.round((state.stats.wins / totalTrades) * 100) : 0,
      roi: state.stats.totalInvested > 0
        ? +((state.stats.totalPnlSol / state.stats.totalInvested) * 100).toFixed(1) : 0,
    },
    calibration: {
      accuracy: state.calibration.accuracy,
      totalPredictions: state.calibration.totalPredictions,
      adjustments: state.calibration.adjustments,
    },
    graduation: state.graduation,
    recentlyClosed: state.closedTrades.slice(-10).reverse(),
    startedAt: state.startedAt,
    simDuration: Date.now() - state.startedAt,
  });
});

// Update sim settings live (mirrors auto-trade/update)
app.post("/api/sim/update", apiLimiter, (req, res) => {
  const { wallet, settings } = req.body;
  const id = wallet || ("anon_" + (req.clientIP || "unknown"));
  const state = liveSims.get(id);
  if (!state) return res.status(404).json({ error: "No sim running" });
  state.lastActivity = Date.now();
  Object.assign(state.settings, settings);
  res.json({ ok: true, settings: state.settings });
});

// Graduate: apply sim settings to real auto-ape
app.post("/api/sim/graduate", apiLimiter, walletAuth, async (req, res) => {
  try {
    const wallet = req.user.wallet;
    const simState = liveSims.get(wallet);
    if (!simState) return res.status(404).json({ error: "No sim running" });
    if (!simState.graduation.ready) {
      return res.status(400).json({
        error: `Not ready to graduate. Confidence: ${simState.graduation.confidence}% (need 70%+). Duration: ${Math.round(simState.graduation.simDurationMs / 60000)}m (need 60m+).`,
      });
    }

    // Return the calibrated settings for auto-ape
    const graduatedSettings = {
      ...simState.settings,
      // Apply calibration adjustments permanently
      minScore: Math.max(15, simState.settings.minScore + simState.calibration.adjustments.scoreBias),
      tp1: Math.max(10, Math.round(simState.settings.tp1 * (1 + simState.calibration.adjustments.tpBias * 0.01))),
      tp2: Math.max(20, Math.round(simState.settings.tp2 * (1 + simState.calibration.adjustments.tpBias * 0.01))),
      tp3: Math.max(50, Math.round(simState.settings.tp3 * (1 + simState.calibration.adjustments.tpBias * 0.01))),
      sl1: Math.max(5, Math.round(simState.settings.sl1 * (1 + simState.calibration.adjustments.slBias * 0.01))),
      sl2: Math.max(10, Math.round(simState.settings.sl2 * (1 + simState.calibration.adjustments.slBias * 0.01))),
    };

    // Stop sim
    stopLiveSim(wallet);

    res.json({
      ok: true,
      graduatedSettings,
      simStats: {
        duration: simState.graduation.simDurationMs,
        trades: simState.graduation.totalSimTrades,
        winRate: simState.graduation.simWinRate,
        roi: simState.graduation.simRoi,
        confidence: simState.graduation.confidence,
        calibrationAccuracy: simState.calibration.accuracy,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Backtest sim (existing functionality, kept for quick one-shot backtests)
app.post("/api/sim/backtest", apiLimiter, async (req, res) => {
  try {
    const { settings } = req.body;
    const s = {
      minScore: settings?.minScore || 28,
      solPerTrade: settings?.solPerTrade || 0.05,
      maxPositions: settings?.maxPositions || 5,
      tp1: settings?.tp1 || 25, tp1Sell: settings?.tp1Sell || 35,
      tp2: settings?.tp2 || 70, tp2Sell: settings?.tp2Sell || 35,
      tp3: settings?.tp3 || 150, tp3Sell: settings?.tp3Sell || 50,
      sl1: settings?.sl1 || 12, sl1Sell: settings?.sl1Sell || 70,
      sl2: settings?.sl2 || 22,
    };

    if (!movers) return res.status(503).json({ error: "Radar not ready" });
    const currentTokens = movers.lastResults || [];
    let totalTrades = 0, wins = 0, losses = 0;
    let totalPnlSol = 0, totalInvested = 0;
    let bestTrade = null, worstTrade = null;
    const trades = [];

    for (const t of currentTokens) {
      const spark = t.spark || [];
      if (spark.length < 6) continue;
      const score = t.apeScore || 0;
      if (score < s.minScore) continue;

      const entryIdx = Math.floor(spark.length * 0.3);
      const entryMc = spark[entryIdx] || 1;
      const peakMc = Math.max(...spark.slice(entryIdx));
      const endMc = spark[spark.length - 1] || 1;

      const range = Math.max(80 - s.minScore, 20);
      let sizeMult = 0.5 + ((score - s.minScore) / range);
      sizeMult = Math.max(0.4, Math.min(1.6, sizeMult));
      const tradeSol = Math.round(s.solPerTrade * sizeMult * 1000) / 1000;

      const peakPct = entryMc > 0 ? ((peakMc - entryMc) / entryMc) * 100 : 0;
      const endPct = entryMc > 0 ? ((endMc - entryMc) / entryMc) * 100 : 0;

      let exitReason = "hold", soldPct = 0, realizedPnl = 0;

      if (peakPct >= s.tp3) {
        realizedPnl += tradeSol * (s.tp3 / 100) * (s.tp3Sell / 100);
        soldPct += s.tp3Sell * ((100 - soldPct) / 100);
        exitReason = "TP3";
      }
      if (peakPct >= s.tp2) {
        const remaining = 100 - soldPct;
        realizedPnl += tradeSol * (remaining / 100) * (s.tp2 / 100) * (s.tp2Sell / 100);
        soldPct += s.tp2Sell * (remaining / 100);
        if (exitReason === "hold") exitReason = "TP2";
      }
      if (peakPct >= s.tp1) {
        const remaining = 100 - soldPct;
        realizedPnl += tradeSol * (remaining / 100) * (s.tp1 / 100) * (s.tp1Sell / 100);
        soldPct += s.tp1Sell * (remaining / 100);
        if (exitReason === "hold") exitReason = "TP1";
      }
      if (endPct <= -s.sl2 && soldPct < 100) {
        const remaining = 100 - soldPct;
        realizedPnl += tradeSol * (remaining / 100) * (endPct / 100);
        soldPct = 100;
        exitReason = exitReason === "hold" ? "SL2" : exitReason + "+SL2";
      } else if (endPct <= -s.sl1 && soldPct < 100) {
        const remaining = 100 - soldPct;
        realizedPnl += tradeSol * (remaining / 100) * (s.sl1Sell / 100) * (endPct / 100);
        soldPct += s.sl1Sell * (remaining / 100);
        if (exitReason === "hold") exitReason = "SL1";
      }
      if (soldPct < 100) {
        realizedPnl += tradeSol * ((100 - soldPct) / 100) * (endPct / 100);
      }

      const trade = { name: t.name || t.ca?.slice(0, 8), score, sizeMult: +sizeMult.toFixed(2), sol: tradeSol, peakPct: +peakPct.toFixed(1), endPct: +endPct.toFixed(1), pnlSol: +realizedPnl.toFixed(4), exitReason };
      trades.push(trade);
      totalTrades++; totalInvested += tradeSol; totalPnlSol += realizedPnl;
      if (realizedPnl > 0) wins++; else losses++;
      if (!bestTrade || realizedPnl > bestTrade.pnlSol) bestTrade = trade;
      if (!worstTrade || realizedPnl < worstTrade.pnlSol) worstTrade = trade;
    }

    const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;
    const roi = totalInvested > 0 ? +((totalPnlSol / totalInvested) * 100).toFixed(1) : 0;
    const lossAdjPnl = trades.reduce((sum, t) => sum + (t.pnlSol < 0 ? t.pnlSol * 2 : t.pnlSol), 0);
    const kahnemanScore = totalInvested > 0 ? +((lossAdjPnl / totalInvested) * 100).toFixed(1) : 0;

    res.json({
      ok: true, totalTrades, wins, losses, winRate,
      totalPnlSol: +totalPnlSol.toFixed(4), totalInvested: +totalInvested.toFixed(4),
      roi, kahnemanScore,
      bestTrade, worstTrade,
      trades: trades.sort((a, b) => b.pnlSol - a.pnlSol).slice(0, 20),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Alias: /api/auto-trade/simulate → same as /api/sim/backtest (used by frontend atsim())
app.post("/api/auto-trade/simulate", apiLimiter, async (req, res) => {
  try {
    const { settings } = req.body;
    const s = {
      minScore: settings?.minScore || 28,
      solPerTrade: settings?.solPerTrade || 0.05,
      maxPositions: settings?.maxPositions || 5,
      tp1: settings?.tp1 || 25, tp1Sell: settings?.tp1Sell || 35,
      tp2: settings?.tp2 || 70, tp2Sell: settings?.tp2Sell || 35,
      tp3: settings?.tp3 || 150, tp3Sell: settings?.tp3Sell || 50,
      sl1: settings?.sl1 || 12, sl1Sell: settings?.sl1Sell || 70,
      sl2: settings?.sl2 || 22,
    };

    if (!movers) return res.status(503).json({ error: "Radar not ready" });
    const currentTokens = movers.lastResults || [];
    let totalTrades = 0, wins = 0, losses = 0;
    let totalPnlSol = 0, totalInvested = 0;
    let bestTrade = null, worstTrade = null;
    const trades = [];

    for (const t of currentTokens) {
      const spark = t.spark || [];
      if (spark.length < 6) continue;
      const score = t.apeScore || 0;
      if (score < s.minScore) continue;

      const entryIdx = Math.floor(spark.length * 0.3);
      const entryMc = spark[entryIdx] || 1;
      const peakMc = Math.max(...spark.slice(entryIdx));
      const endMc = spark[spark.length - 1] || 1;

      const range = Math.max(80 - s.minScore, 20);
      let sizeMult = 0.5 + ((score - s.minScore) / range);
      sizeMult = Math.max(0.4, Math.min(1.6, sizeMult));
      const tradeSol = Math.round(s.solPerTrade * sizeMult * 1000) / 1000;

      const peakPct = entryMc > 0 ? ((peakMc - entryMc) / entryMc) * 100 : 0;
      const endPct = entryMc > 0 ? ((endMc - entryMc) / entryMc) * 100 : 0;

      let exitReason = "hold", soldPct = 0, realizedPnl = 0;
      if (peakPct >= s.tp3) { realizedPnl += tradeSol * (s.tp3 / 100) * (s.tp3Sell / 100); soldPct += s.tp3Sell * ((100 - soldPct) / 100); exitReason = "TP3"; }
      if (peakPct >= s.tp2) { const r = 100 - soldPct; realizedPnl += tradeSol * (r / 100) * (s.tp2 / 100) * (s.tp2Sell / 100); soldPct += s.tp2Sell * (r / 100); if (exitReason === "hold") exitReason = "TP2"; }
      if (peakPct >= s.tp1) { const r = 100 - soldPct; realizedPnl += tradeSol * (r / 100) * (s.tp1 / 100) * (s.tp1Sell / 100); soldPct += s.tp1Sell * (r / 100); if (exitReason === "hold") exitReason = "TP1"; }
      if (endPct <= -s.sl2 && soldPct < 100) { realizedPnl += tradeSol * ((100 - soldPct) / 100) * (endPct / 100); soldPct = 100; exitReason = exitReason === "hold" ? "SL2" : exitReason + "+SL2"; }
      else if (endPct <= -s.sl1 && soldPct < 100) { const r = 100 - soldPct; realizedPnl += tradeSol * (r / 100) * (s.sl1Sell / 100) * (endPct / 100); soldPct += s.sl1Sell * (r / 100); if (exitReason === "hold") exitReason = "SL1"; }
      if (soldPct < 100) { realizedPnl += tradeSol * ((100 - soldPct) / 100) * (endPct / 100); }

      const trade = { name: t.name || t.ca?.slice(0, 8), score, sizeMult: +sizeMult.toFixed(2), sol: tradeSol, peakPct: +peakPct.toFixed(1), endPct: +endPct.toFixed(1), pnlSol: +realizedPnl.toFixed(4), exitReason };
      trades.push(trade); totalTrades++; totalInvested += tradeSol; totalPnlSol += realizedPnl;
      if (realizedPnl > 0) wins++; else losses++;
      if (!bestTrade || realizedPnl > bestTrade.pnlSol) bestTrade = trade;
      if (!worstTrade || realizedPnl < worstTrade.pnlSol) worstTrade = trade;
    }

    const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;
    const roi = totalInvested > 0 ? +((totalPnlSol / totalInvested) * 100).toFixed(1) : 0;
    const lossAdjPnl = trades.reduce((sum, t) => sum + (t.pnlSol < 0 ? t.pnlSol * 2 : t.pnlSol), 0);
    const kahnemanScore = totalInvested > 0 ? +((lossAdjPnl / totalInvested) * 100).toFixed(1) : 0;

    res.json({
      ok: true, totalTrades, wins, losses, winRate,
      totalPnlSol: +totalPnlSol.toFixed(4), totalInvested: +totalInvested.toFixed(4),
      roi, kahnemanScore, bestTrade, worstTrade,
      trades: trades.sort((a, b) => b.pnlSol - a.pnlSol).slice(0, 20),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════
// 404 + Error
// ═══════════════════════════════════════
app.use((req, res) => { res.status(404).json({ error: "Not found" }); });
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.id?.slice(0,8)} ${err.stack || err.message}`);
  res.status(500).json({ error: IS_PROD ? "Internal server error" : err.message });
});

// ═══════════════════════════════════════
// MEMETIC PIPELINE API
// ═══════════════════════════════════════
app.get("/api/memetic/stats", (req, res) => {
  if (!memeticPipeline) return res.json({ status: "offline" });
  res.json(memeticPipeline.getStats());
});

app.get("/api/memetic/score/:tokenAddress", async (req, res) => {
  try {
    const { scoreMemeticAll } = await import("../scoring/memetic/index.js");
    const result = await scoreMemeticAll({
      tokenAddress: req.params.tokenAddress,
      name: req.query.name || "",
      symbol: req.query.symbol || "",
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/memetic/retrain", async (req, res) => {
  try {
    const { runRetraining } = await import("../scoring/memetic/learning-pipeline.js");
    const result = await runRetraining();
    res.json(result || { message: "Not enough data" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════
// ROUTES: RESURGENCE — Older Coins Having a Revival (12h to 2y)
// ═══════════════════════════════════════
app.get("/api/resurgence", apiLimiter, async (req, res) => {
  try {
    if (!resurgenceScanner) return res.json({ tokens: [], error: "Scanner not initialized" });
    const result = await resurgenceScanner.scan();
    res.json(result);
  } catch (e) {
    console.error("[RESURGENCE] Scan error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/resurgence/score/:ca", apiLimiter, async (req, res) => {
  try {
    if (!resurgenceScanner) return res.status(503).json({ error: "Scanner not initialized" });
    const result = await resurgenceScanner.scoreToken(req.params.ca);
    if (!result) return res.status(404).json({ error: "Token not found or out of age range" });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════
// WEBSOCKET
// ═══════════════════════════════════════
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const ip = req.headers["x-real-ip"] || req.socket.remoteAddress;
  console.log(`[WS] Connected: ${ip}`);
  let connFromIP = 0;
  wss.clients.forEach(c => { if (c._bondliIP === ip) connFromIP++; });
  if (connFromIP >= 3) { ws.close(4029, "Too many connections"); return; }
  ws._bondliIP = ip;
  ws.send(JSON.stringify({ event: "connected", data: { dryRun: CONFIG.DRY_RUN } }));
  const handler = (msg) => { if (ws.readyState === 1) { try { ws.send(msg); } catch {} } };
  orch.onEvent(handler);
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("close", () => { const idx = orch.listeners.indexOf(handler); if (idx >= 0) orch.listeners.splice(idx, 1); });
  ws.on("message", (data) => { const now = Date.now(); if (!ws._lastMsg) ws._lastMsg = 0; if (now - ws._lastMsg < 100) return; ws._lastMsg = now; try { const msg = JSON.parse(data.toString()); if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong" })); } catch {} });
});
const heartbeat = setInterval(() => { wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }); }, 30000);
wss.on("close", () => clearInterval(heartbeat));

// ═══════════════════════════════════════
// START
// ═══════════════════════════════════════
const PORT = CONFIG.API_PORT;

async function start() {
  try {
    await initServices();
    app.use(createPaymentRoutes(paymentVerifier));

    // Initialize memetic scoring (Alchemy-free — scores inline from PF data)
    try {
      memeticPipeline = new MemeticPipeline({ dryRun: CONFIG.DRY_RUN });
      await memeticPipeline.start();
      scheduleRetraining();
      console.log("  \x1b[36mMemetic Scoring: ACTIVE (PumpPortal mode)\x1b[0m");
    } catch (e) {
      console.error("  Memetic Scoring failed to start:", e.message);
    }

    server.listen(PORT, () => {
      const wl = getWhitelist();
      console.log("");
      console.log("  \x1b[35m=========================================\x1b[0m");
      console.log("  \x1b[35m  BONDLI v3.0 — PRODUCTION SERVER\x1b[0m");
      console.log("  \x1b[35m=========================================\x1b[0m");
      console.log(`  HTTP:      http://localhost:${PORT}`);
      console.log(`  WS:        ws://localhost:${PORT}/ws`);
      console.log(`  Mode:      ${CONFIG.DRY_RUN ? "\x1b[33mDRY RUN\x1b[0m" : "\x1b[31mLIVE\x1b[0m"}`);
      console.log(`  Env:       ${IS_PROD ? "production" : "development"}`);
      console.log(`  Pro fee:   ${VIP_FEE_SOL} SOL`);
      console.log(`  Free cut:  ${FREE_PROFIT_CUT}%`);
      console.log(`  VIPs:      ${wl.size > 0 ? [...wl].join(", ") : "none"}`);
      console.log("");
    });
  } catch (e) { console.error("[FATAL]", e); process.exit(1); }
}

function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down...`);
  server.close(() => { wss.close(() => { process.exit(0); }); });
  setTimeout(() => { process.exit(1); }, 10000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start();
export default app;
