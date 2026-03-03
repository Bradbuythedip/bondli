// BONDLI v3.0 — PRODUCTION API Server
// Tiers: Free (25% profit share), Pro (10 SOL one-time, 0%), VIP (whitelisted, 0%)
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { Connection, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";

// Engine
import { FleetTrader } from "../engine/fleet-trader.mjs";
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

// Launch Sessions (dev wallet generation + funding)
import { SessionManager, calculateDevBuy } from "../engine/session-manager.mjs";
import { createToken } from "../engine/token-creator.mjs";

// ═══════════════════════════════════════
// TIER + ACCESS SYSTEM
// ═══════════════════════════════════════
const PRO_FEE_SOL = parseFloat(process.env.PRO_FEE_SOL || "10");
const FREE_PROFIT_CUT = parseFloat(process.env.FREE_PROFIT_CUT || "25"); // percent
const PLATFORM_WALLET = process.env.PLATFORM_WALLET || "anal.sol";

function getWhitelist() {
  const raw = process.env.WHITELISTED_WALLETS || "";
  return new Set(raw.split(",").map(w => w.trim()).filter(Boolean));
}

// tier: "free" | "pro" | "none"
// whitelisted wallets bypass everything
async function getWalletTier(wallet) {
  // Platform wallet is always VIP
  if (wallet === PLATFORM_WALLET) return { tier: "pro", whitelisted: true, paid: true, profitCut: 0 };

  const whitelist = getWhitelist();
  if (whitelist.has(wallet)) return { tier: "pro", whitelisted: true, paid: true, profitCut: 0 };

  const redis = getRedis();
  if (redis) {
    try {
      const tier = await redis.get("tier:" + wallet);
      if (tier === "pro") return { tier: "pro", whitelisted: false, paid: true, profitCut: 0 };
      if (tier === "free") return { tier: "free", whitelisted: false, paid: false, profitCut: FREE_PROFIT_CUT };
    } catch {}
  }
  return { tier: "none", whitelisted: false, paid: false, profitCut: 0 };
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
let sessionStore, paymentVerifier, sessionManager;
const orch = new FleetTrader();

async function initServices() {
  const redis = await initRedis(process.env.REDIS_URL);
  sessionStore = new SessionStore(redis);
  sessionManager = new SessionManager(redis);
  const connection = new Connection(CONFIG.RPC_URL, "confirmed");
  paymentVerifier = new PaymentVerifier(connection);
  await paymentVerifier.init();
  console.log("[INIT] All services ready");
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
  res.json({
    access: info.tier !== "none",
    tier: info.tier,
    whitelisted: info.whitelisted,
    paid: info.paid,
    profitCut: info.profitCut,
    fee: info.tier === "none" ? PRO_FEE_SOL : 0,
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

    // Verify amount: at least PRO_FEE_SOL sent
    // Check all instructions for a SOL transfer to platform wallet
    let verified = false;
    const requiredLamports = PRO_FEE_SOL * LAMPORTS_PER_SOL;

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
        const pvResult = await paymentVerifier.verify(txSig, wallet, PRO_FEE_SOL);
        if (pvResult?.verified) verified = true;
      } catch {}
    }

    if (!verified) {
      return res.status(400).json({
        error: `Payment not verified. Send exactly ${PRO_FEE_SOL} SOL to ${PLATFORM_WALLET}`,
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
  res.json({ wallets: [...whitelist], count: whitelist.size, proFee: PRO_FEE_SOL, profitCut: FREE_PROFIT_CUT });
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
  // Also include first active session's details for frontend
  const activeSession = orch.getSessionStatus();
  const sessionInfo = activeSession ? {
    phase: activeSession.phase,
    tradeCount: activeSession.tradeCount,
    solSpent: activeSession.solSpent,
    solRecovered: activeSession.solRecovered,
    activeWallets: 1,
    running: activeSession.running,
    ca: activeSession.ca,
  } : {};
  if (!req.user) return res.json({ ok: true, activeSessions: status.activeSessions, ...sessionInfo });
  res.json({ ok: true, ...status, ...sessionInfo });
});

app.get("/api/config", apiLimiter, (req, res) => {
  res.json({
    dryRun: CONFIG.DRY_RUN,
    totalSol: CONFIG.TOTAL_SOL,
    slippageBps: CONFIG.SLIPPAGE_BPS,
    purgePercent: CONFIG.PURGE_PERCENT,
    platformWallet: PLATFORM_WALLET,
    proFee: PRO_FEE_SOL,
    freeProfitCut: FREE_PROFIT_CUT,
  });
});

app.get("/api/fees", apiLimiter, (req, res) => {
  const sol = Math.min(100, Math.max(0, parseFloat(req.query.sol || "1")));
  const tier = getFeeTier(sol);
  const wallet = req.query.wallet || "";
  const owner = wallet ? isOwnerWallet(wallet) : false;
  res.json({ ...tier, isOwner: owner });
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
// ── CA Analysis proxy (avoids CORS) ──
app.get("/api/analyze/:ca", async (req, res) => {
  try {
    const ca = req.params.ca;
    if (!ca || ca.length < 32) return res.status(400).json({ error: "Invalid CA" });

    // Try pump.fun first with 8s timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch("https://frontend-api-v2.pump.fun/coins/" + ca, { signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) {
        const coin = await resp.json();
        return res.json({ ...coin, source: "pumpfun" });
      }
    } catch (e) {
      clearTimeout(timeout);
      console.log("[ANALYZE] pump.fun failed:", e.message);
    }

    // Fallback: DexScreener
    try {
      const dexRes = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + ca);
      if (dexRes.ok) {
        const dex = await dexRes.json();
        const pair = dex.pairs?.[0];
        if (pair) {
          return res.json({
            name: pair.baseToken?.name || "?",
            symbol: pair.baseToken?.symbol || "?",
            usd_market_cap: pair.marketCap || pair.fdv || 0,
            created_timestamp: pair.pairCreatedAt || Date.now(),
            reply_count: 0,
            complete: pair.dexId !== "pumpfun",
            image_uri: pair.info?.imageUrl || null,
            description: pair.info?.description || "",
            source: "dexscreener",
          });
        }
      }
    } catch (e) {
      console.log("[ANALYZE] DexScreener fallback failed:", e.message);
    }

    res.status(404).json({ error: "Token not found on pump.fun or DexScreener" });
  } catch (e) {
    console.error("[ANALYZE]", e.message);
    res.status(500).json({ error: "Analysis failed: " + e.message });
  }
});

app.post("/api/session/create", apiLimiter, async (req, res) => {
  try {
    if (!sessionManager) return res.status(503).json({ error: "Server still starting up. Try again in a few seconds." });
    const { totalSol, tokenConfig, wallet, fleetConfig, masterSeed } = req.body;
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
      fleetConfig: fleetConfig || {},
      masterSeed: masterSeed || "",
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
        sendUrl: CONFIG.HELIUS_SEND_TX_URL || null,
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

    // ── Step 3: Start fleet trading on this CA ──
    let orchResult = { ok: true };
    try {
      CONFIG.TOKEN_CA = tokenCA;

      console.log(`[LAUNCH] Starting fleet with ${session.fleetBudget} SOL on ${tokenCA}`);
      
      orchResult = await orch.launch(tokenCA, {
        totalSol: session.fleetBudget,
        devKeypair,
        sessionId: session.id,
        force: true,
        fleetConfig: session.fleetConfig || {},
      });
      console.log(`[LAUNCH] Fleet started:`, JSON.stringify(orchResult).slice(0, 300));
    } catch (orchErr) {
      console.warn("[LAUNCH] Fleet start failed:", orchErr.message);
      console.warn("[LAUNCH] Stack:", orchErr.stack?.split("\n").slice(0, 3).join("\n"));
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

// Resume trading on a previously launched session (VIP only)
app.post("/api/session/resume", apiLimiter, async (req, res) => {
  try {
    const { sessionId, wallet } = req.body;
    if (!sessionId || !wallet) return res.status(400).json({ error: "sessionId and wallet required" });

    const walletInfo = await getWalletTier(wallet);
    if (walletInfo.tier !== "pro" && !walletInfo.whitelisted) {
      return res.status(403).json({ error: "Resume is VIP/Pro only" });
    }

    const session = await sessionManager.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });
    if (!session.tokenCA) return res.status(400).json({ error: "No token CA — session was never launched" });

    // Check if already running
    const orchStatus = orch.getSessionStatus(session.tokenCA);
    if (orchStatus && orchStatus.running) {
      return res.json({ ok: true, already_running: true, ...orchStatus });
    }

    // Reconstruct devKeypair from stored secret
    const devKeypair = await sessionManager.getDevKeypair(sessionId);
    if (!devKeypair) return res.status(500).json({ error: "Cannot recover dev wallet" });

    // Check remaining balance in dev wallet
    const connection = new Connection(CONFIG.RPC_URL, "confirmed");
    const balance = await connection.getBalance(devKeypair.publicKey);
    const balanceSol = balance / LAMPORTS_PER_SOL;

    if (balanceSol < 0.01) return res.status(400).json({ error: "Dev wallet empty (" + balanceSol.toFixed(4) + " SOL)" });

    // Resume fleet trading
    const result = await orch.launch(session.tokenCA, {
      totalSol: balanceSol * 0.9,
      devKeypair,
      sessionId: session.id,
      force: true,
      fleetConfig: session.fleetConfig || {},
    });

    await sessionManager.update(sessionId, { status: "resumed", resumedAt: new Date().toISOString() });
    console.log("[RESUME] " + sessionId + " resumed on " + session.tokenCA + " with " + balanceSol.toFixed(4) + " SOL");

    res.json({ ok: true, ...result, balance: balanceSol, tokenCA: session.tokenCA });
  } catch (e) {
    console.error("[RESUME] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════
// ROUTES — Protected (legacy launch, still works)
// ═══════════════════════════════════════
app.get("/api/wallets", apiLimiter, walletAuth, (req, res) => {
  const status = orch.status();
  const wallets = [];
  for (const [ca, s] of Object.entries(status.sessions || {})) {
    wallets.push({ ca, ...s });
  }
  res.json({ wallets });
});

app.get("/api/curve/:ca", apiLimiter, walletAuth, async (req, res) => {
  try {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(req.params.ca)) return res.status(400).json({ error: "Invalid contract address" });
    // Use SDK to fetch bonding curve
    const mint = new PublicKey(req.params.ca);
    const onlineSdk = new (await import("@pump-fun/pump-sdk")).OnlinePumpSdk(new Connection(CONFIG.RPC_URL, "confirmed"));
    const bc = await onlineSdk.fetchBondingCurve(mint);
    res.json({ exists: true, ...bc });
  } catch (e) { res.status(500).json({ error: "Failed to fetch curve info", detail: e.message }); }
});

app.post("/api/launch", launchLimiter, walletAuth, launchSchema, async (req, res) => {
  try {
    const { ca, totalSol, force } = req.body;
    const sol = Math.min(totalSol || CONFIG.TOTAL_SOL, 100);
    if (sessionStore) await sessionStore.recordLaunch(req.user.wallet, ca, sol);
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
// 404 + Error
// ═══════════════════════════════════════
app.use((req, res) => { res.status(404).json({ error: "Not found" }); });
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.id?.slice(0,8)} ${err.stack || err.message}`);
  res.status(500).json({ error: IS_PROD ? "Internal server error" : err.message });
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
      console.log(`  Pro fee:   ${PRO_FEE_SOL} SOL`);
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
