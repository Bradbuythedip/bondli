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
import { cors, securityHeaders, requestId, bodyLimit, extractIP } from "../middleware/security.mjs";
import { initRedis, getRedis, apiLimiter, launchLimiter } from "../middleware/rate-limiter.mjs";
import { requireAuth, optionalAuth } from "../middleware/auth.mjs";
import { launchSchema, closeSchema } from "../middleware/validate.mjs";

// Payments
import PaymentVerifier from "../payments/payment-verifier.mjs";
import createPaymentRoutes from "../payments/payment-routes.mjs";

// Sessions
import SessionStore from "../db/session-store.mjs";

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
app.use(cors);
app.use(bodyLimit(100_000));
app.use(express.json({ limit: "100kb" }));

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
let sessionStore, paymentVerifier;
const orch = new Orchestrator();

async function initServices() {
  const redis = await initRedis(process.env.REDIS_URL);
  sessionStore = new SessionStore(redis);
  const connection = new Connection(CONFIG.RPC_URL, "confirmed");
  paymentVerifier = new PaymentVerifier(connection);
  await paymentVerifier.init();
  console.log("[INIT] All services ready");
}

// ═══════════════════════════════════════
// ROUTES — Health
// ═══════════════════════════════════════
app.get("/api/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), env: IS_PROD ? "production" : "development" });
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
    res.status(500).json({ error: e.message });
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
// ROUTES — Protected (auth required)
// ═══════════════════════════════════════
app.get("/api/wallets", apiLimiter, requireAuth, (req, res) => {
  res.json({ wallets: orch.walletOpt.summary() });
});

app.get("/api/curve/:ca", apiLimiter, requireAuth, async (req, res) => {
  try {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(req.params.ca)) return res.status(400).json({ error: "Invalid contract address" });
    const info = await orch.router.getCurveInfo(req.params.ca);
    res.json(info);
  } catch (e) { res.status(500).json({ error: "Failed to fetch curve info" }); }
});

app.post("/api/launch", launchLimiter, requireAuth, launchSchema, async (req, res) => {
  try {
    const { ca, totalSol, force } = req.body;
    const sol = Math.min(totalSol || CONFIG.TOTAL_SOL, 100);
    if (sessionStore) await sessionStore.recordLaunch(req.user.wallet, ca, sol);
    const result = await orch.launch(ca, { totalSol: sol, force });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════
// CLOSE — with free tier profit skim
// ═══════════════════════════════════════
app.post("/api/close", apiLimiter, requireAuth, closeSchema, async (req, res) => {
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/close-all", apiLimiter, requireAuth, async (req, res) => {
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/fees/calculate", apiLimiter, requireAuth, (req, res) => {
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
