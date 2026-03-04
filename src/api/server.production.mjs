// BONDLI v3.0 — PRODUCTION API Server
// Tiers: Free (25% profit share), Pro (10 SOL one-time, 0%), VIP (whitelisted, 0%)
import express from "express";
import { createServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { Connection, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction, Keypair, sendAndConfirmTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import bs58 from "bs58";

// Engine
import { FleetTrader } from "../engine/fleet-trader.mjs";
import { skimSweep } from "../engine/fleet-trader.mjs";
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

// User tracking (persistent)
import UserStore from "../db/user-store.mjs";

// Wallet signature auth
import { generateChallenge, verifySolanaSignature, issueAuthToken, requireVerifiedWallet, requireStrictAuth, nonces } from "../middleware/wallet-auth.mjs";

// Launch Sessions (dev wallet generation + funding)
import { SessionManager, calculateDevBuy } from "../engine/session-manager.mjs";
import { createToken } from "../engine/token-creator.mjs";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import BN from "bn.js";
import { getSellSolAmountFromTokenAmount } from "@pump-fun/pump-sdk";

// ═══════════════════════════════════════
// TIER + ACCESS SYSTEM
// ═══════════════════════════════════════
const PRO_FEE_SOL = parseFloat(process.env.PRO_FEE_SOL || "10");
const FREE_PROFIT_CUT = parseFloat(process.env.FREE_PROFIT_CUT || "25"); // percent
const PLATFORM_WALLET = process.env.PLATFORM_WALLET || "4XnHZZmHwSQ8RszJsdc7snvxG8dZtm6g4hvpkCMkguMx";
if (PLATFORM_WALLET === "4XnHZZmHwSQ8RszJsdc7snvxG8dZtm6g4hvpkCMkguMx") console.log("[INFO] Using hardcoded platform wallet");

function getWhitelist() {
  const raw = process.env.WHITELISTED_WALLETS || "";
  return new Set(raw.split(",").map(w => w.trim()).filter(Boolean));
}

// tier: "free" | "pro" | "vip"
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
      if (tier === "pro") return { tier: "pro", whitelisted: false, paid: true, profitCut: 0 };
      if (tier === "vip") return { tier: "vip", whitelisted: true, paid: true, profitCut: 0 };
    } catch {}
  }
  // Default is FREE — never return "none"
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
let sessionStore, paymentVerifier, sessionManager, userStore;
const orch = new FleetTrader();

async function initServices() {
  const redis = await initRedis(process.env.REDIS_URL);
  sessionStore = new SessionStore(redis);
  sessionManager = new SessionManager(redis);
  userStore = new UserStore(redis);
  const connection = new Connection(CONFIG.RPC_URL, "confirmed");
  paymentVerifier = new PaymentVerifier(connection);
  await paymentVerifier.init();
  console.log("[INIT] All services ready (userStore, sessionStore, sessionManager)");
}

// Simple wallet auth — checks X-Wallet header
async function walletAuth(req, res, next) {
  const wallet = req.headers["x-wallet"] || req.body?.wallet || req.query?.wallet;
  if (!wallet) return res.status(401).json({ error: "Wallet required. Pass X-Wallet header." });
  const info = await getWalletTier(wallet);
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
// ROUTES — Auth (wallet signature verification)
// ═══════════════════════════════════════

// Step 1: Get challenge message to sign
app.post("/api/auth/challenge", apiLimiter, (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  const challenge = generateChallenge(wallet);
  res.json({ ok: true, ...challenge });
});

// Step 2: Verify signed challenge → issue JWT
app.post("/api/auth/verify", apiLimiter, async (req, res) => {
  const { wallet, signature, message } = req.body;
  if (!wallet || !signature || !message) return res.status(400).json({ error: "wallet, signature, and message required" });

  // Check nonce exists
  const stored = nonces.get(wallet);
  if (!stored || stored.message !== message) return res.status(400).json({ error: "Invalid or expired challenge. Request a new one." });

  // Verify signature
  const valid = verifySolanaSignature(wallet, signature, message);
  if (!valid) return res.status(401).json({ error: "Signature verification failed" });

  // Clean up nonce
  nonces.delete(wallet);

  // Get or create user record
  const user = userStore ? await userStore.getOrCreate(wallet) : { tier: "free" };
  const walletInfo = await getWalletTier(wallet);

  // Issue token
  const token = issueAuthToken(wallet, walletInfo.tier);

  res.json({
    ok: true,
    token,
    wallet,
    tier: walletInfo.tier,
    referralCode: user.referralCode || "",
    totalLaunches: user.totalLaunches || 0,
    verified: true,
  });
});

// Apply referral code
app.post("/api/referral/apply", apiLimiter, async (req, res) => {
  const { wallet, refCode } = req.body;
  if (!wallet || !refCode) return res.status(400).json({ error: "wallet and refCode required" });
  if (!userStore) return res.status(503).json({ error: "Service not ready" });
  const result = await userStore.applyReferral(wallet, refCode);
  res.json(result);
});

// Get referral info
app.get("/api/referral/:wallet", apiLimiter, async (req, res) => {
  if (!userStore) return res.json({ referralCode: "", referralCount: 0, referralEarnings: 0 });
  const user = await userStore.get(req.params.wallet);
  if (!user) return res.json({ referralCode: "", referralCount: 0, referralEarnings: 0 });
  res.json({ referralCode: user.referralCode, referralCount: user.referralCount, referralEarnings: user.referralEarnings });
});

// Get user profile/stats
app.get("/api/user/:wallet", apiLimiter, async (req, res) => {
  if (!userStore) return res.json({ wallet: req.params.wallet, tier: "free" });
  const user = await userStore.getOrCreate(req.params.wallet);
  const walletInfo = await getWalletTier(req.params.wallet);
  res.json({
    wallet: user.wallet,
    tier: walletInfo.tier,
    firstSeen: user.firstSeen,
    totalLaunches: user.totalLaunches,
    totalDeploys: user.totalDeploys,
    totalSolIn: user.totalSolIn,
    totalSolOut: user.totalSolOut,
    totalProfit: user.totalProfit,
    totalPlatformCut: user.totalPlatformCut,
    referralCode: user.referralCode,
    referralCount: user.referralCount,
    referralEarnings: user.referralEarnings,
    lastActive: user.lastActive,
  });
});

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
    access: true, // everyone has access now, free is default
    tier: info.tier || "free",
    whitelisted: info.whitelisted,
    paid: info.paid,
    profitCut: info.profitCut,
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
  const activeSession = orch.getSessionStatus();
  const sessionInfo = activeSession ? {
    phase: activeSession.phase,
    tradeCount: activeSession.tradeCount,
    solSpent: activeSession.solSpent,
    solRecovered: activeSession.solRecovered,
    activeWallets: activeSession.activeWallets || 1,
    running: activeSession.running,
    ca: activeSession.ca,
  } : {};
  if (!req.user) return res.json({ ok: true, activeSessions: status.activeSessions, ...sessionInfo });
  res.json({ ok: true, ...status, ...sessionInfo });
});

// Full fleet details with trade history
// ── Price history for live charting ──
const priceHistory = new Map(); // ca -> [{time, price, mcap}]
const PRICE_HISTORY_MAX = 300; // 5 min at 1s intervals

async function pollPrice(ca) {
  try {
    const resp = await fetch("https://frontend-api-v2.pump.fun/coins/" + ca, { signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return null;
    const coin = await resp.json();
    const price = coin.usd_market_cap && coin.total_supply ? (coin.usd_market_cap / (coin.total_supply / 1e6)) : 0;
    const mcap = coin.usd_market_cap || 0;
    const virtualSolReserves = coin.virtual_sol_reserves ? coin.virtual_sol_reserves / 1e9 : 0;
    const virtualTokenReserves = coin.virtual_token_reserves ? coin.virtual_token_reserves / 1e6 : 0;
    const bondingProgress = coin.bonding_curve_progress || (coin.complete ? 100 : 0);
    return { time: Date.now(), price, mcap, virtualSolReserves, virtualTokenReserves, bondingProgress, complete: coin.complete };
  } catch { return null; }
}

// Start price polling when fleet launches
function startPricePolling(ca) {
  if (!priceHistory.has(ca)) priceHistory.set(ca, []);
  const iv = setInterval(async () => {
    const point = await pollPrice(ca);
    if (point) {
      const hist = priceHistory.get(ca) || [];
      hist.push(point);
      if (hist.length > PRICE_HISTORY_MAX) hist.shift();
      priceHistory.set(ca, hist);
    }
    // Stop polling if no active session
    if (!orch.sessions?.has(ca)) { clearInterval(iv); }
  }, 3000);
  // Initial fetch
  pollPrice(ca).then(p => { if (p) { const h = priceHistory.get(ca) || []; h.push(p); priceHistory.set(ca, h); } });
}

app.get("/api/fleet", apiLimiter, (req, res) => {
  const fullStatus = orch.status();
  const sessions = fullStatus.sessions || {};
  const first = Object.values(sessions)[0];
  if (!first) return res.json({ ok: true, wallets: [], trades: [], phase: "idle", priceHistory: [] });

  const allTrades = [];
  const wallets = (first.walletDetails || []).map(w => {
    return { role: w.role, pubkey: w.pubkey, allocation: w.allocation, spent: w.spent, recovered: w.recovered, tradeCount: w.trades };
  });

  const ca = Object.keys(sessions)[0];
  const session = orch.sessions?.get(ca);
  if (session) {
    for (const w of session.fleetWallets) {
      for (const t of (w.trades || [])) {
        allTrades.push({
          role: w.role,
          wallet: w.pubkey?.slice(0, 8) || "?",
          side: t.side,
          sol: t.sol || t.solOut || 0,
          sig: t.sig || "",
          time: t.time || 0,
        });
      }
    }
  }

  allTrades.sort((a, b) => b.time - a.time);

  // Start price polling if not already
  if (ca && !priceHistory.has(ca)) startPricePolling(ca);

  // GameState snapshot for UI
  let gameStateData = null;
  if (session?.gameState?.alive) {
    gameStateData = session.gameState.snapshot();
  }

  // WS-derived chart from radar (if this CA is being tracked by radar too)
  const radarToken = radar.pool.get(ca);
  const wsChart = radarToken?.priceHistory || [];

  res.json({
    ok: true,
    phase: first.phase,
    running: first.running,
    tradeCount: first.tradeCount,
    solSpent: first.solSpent,
    solRecovered: first.solRecovered,
    elapsed: first.elapsed,
    activeWallets: first.activeWallets,
    wallets,
    trades: allTrades.slice(0, 50),
    priceHistory: (priceHistory.get(ca) || []).slice(-120),
    wsChart: wsChart.slice(-200), // WS-derived price points with buy/sell markers
    gameState: gameStateData,
    ca,
  });
});

// Price proxy for client-side chart (avoids CORS)
app.get("/api/price/:ca", apiLimiter, async (req, res) => {
  try {
    const r = await fetch("https://frontend-api-v2.pump.fun/coins/" + req.params.ca, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return res.json({ mcap: 0 });
    const coin = await r.json();
    res.json({ mcap: coin.usd_market_cap || 0, bp: coin.bonding_curve_progress || 0, price: coin.market_cap ? coin.market_cap / 1e9 : 0, complete: coin.complete || false });
  } catch { res.json({ mcap: 0 }); }
});

// ═══════════════════════════════════════
// RADAR — Multi-Tab Mover Detection via PumpPortal WebSocket
// Tabs: NEW (fresh tokens with early traction), HOT (volume spikes), GRADUATING (near bonding completion)
// ═══════════════════════════════════════
const radar = {
  pool: new Map(),   // ca -> { name, ticker, dev, created, buys, sells, solVol, lastTrade, mcapSol, uri, image, bp, vSol, ... }
  movers: { new: [], hot: [], graduating: [] },
  wsAlive: false,
  wsRef: null,
  updated: 0,
  enabled: true,
  MAX_TRACKED: 80,
  subbed: new Set(),
};

function computeMovers() {
  const now = Date.now();
  const allScored = [];

  for (const [ca, t] of radar.pool) {
    const age = (now - t.created) / 60000; // minutes
    if (t.buys < 1 && t.solVol < 0.01) continue;

    const lastTradeAge = (now - (t.lastTrade || t.created)) / 1000;
    const pressure = t.buys > 0 ? t.buys / (t.buys + t.sells) : 0;

    // ── Social signals (applied to all tabs) ──
    const socialBonus = (t.socialCount || 0) * 5;           // +5 per social link (max +15)
    const twitterBonus = t.twitterValid ? 5 : 0;             // valid twitter format +5
    const websiteBonus = t.websiteLive ? 5 : (t.websiteValid ? 2 : 0); // live site +5, valid URL +2
    const imageDupePenalty = t.imageDupe ? -20 : 0;           // reused image = likely scam
    const bundlePenalty = (t.bundleScore || 0) >= 60 ? -30 : (t.bundleScore || 0) >= 40 ? -18 : (t.bundleScore || 0) >= 20 ? -8 : 0;
    const socialTotal = socialBonus + twitterBonus + websiteBonus + imageDupePenalty + bundlePenalty;

    // ── NEW score: fresh tokens with early traction ──
    let newScore = 0;
    if (age < 5) {
      newScore += Math.min(25, t.buys * 5);         // early buys are strong signal
      newScore += Math.min(20, t.solVol * 4);        // volume conviction
      newScore += pressure * 15;                      // buy pressure
      if (age < 1) newScore += 20;                    // ultra-fresh bonus
      else if (age < 2) newScore += 15;
      else if (age < 3) newScore += 10;
      else newScore += 5;
      if (lastTradeAge < 10) newScore += 15;          // actively trading right now
      else if (lastTradeAge < 30) newScore += 8;
      if (t.mcapSol > 5) newScore += 5;              // some traction
      newScore += socialTotal;                            // social signals
    }

    // ── HOT score: volume spikes regardless of age ──
    let hotScore = 0;
    if (age < 20) {
      // Volume is king for HOT
      hotScore += Math.min(35, t.solVol * 3.5);       // 10 SOL = max
      hotScore += Math.min(20, t.buys * 2);            // lots of transactions
      // Velocity: trades in last 60s
      if (lastTradeAge < 10) hotScore += 15;
      else if (lastTradeAge < 30) hotScore += 10;
      else if (lastTradeAge < 60) hotScore += 5;
      // MCap sweet spot: $2K-$30K
      const mcapUsd = (t.mcapSol || 0) * 170;
      if (mcapUsd >= 2000 && mcapUsd < 10000) hotScore += 15;
      else if (mcapUsd >= 10000 && mcapUsd < 30000) hotScore += 12;
      else if (mcapUsd >= 30000) hotScore += 8;
      else if (mcapUsd > 500) hotScore += 5;
      // Buy pressure bonus
      if (pressure > 0.6) hotScore += 10;
      else if (pressure > 0.5) hotScore += 5;
      hotScore += socialTotal;                             // social signals
    }

    // ── GRADUATING score: tokens near bonding curve completion ──
    let gradScore = 0;
    if (t.bp > 30) {
      gradScore += Math.min(40, t.bp * 0.5);          // closer to 100% = higher score
      if (t.bp >= 70) gradScore += 20;                 // very close to graduation
      else if (t.bp >= 50) gradScore += 10;
      gradScore += Math.min(15, t.solVol * 1.5);      // volume confirms it's real
      if (lastTradeAge < 30) gradScore += 10;          // still actively trading
      if (t.buys > 20) gradScore += 10;                // many participants
      else if (t.buys > 10) gradScore += 5;
      if (pressure > 0.55) gradScore += 5;             // still buying = momentum
      gradScore += socialTotal;                            // social signals
    }

    const scores = { new: Math.min(100, Math.round(newScore)), hot: Math.min(100, Math.round(hotScore)), graduating: Math.min(100, Math.round(gradScore)) };
    const bestScore = Math.max(scores.new, scores.hot, scores.graduating);
    if (bestScore < 12) continue;

    const base = {
      ca, name: t.name, ticker: t.ticker, image: t.image || "",
      buys: t.buys, sells: t.sells,
      solVol: Math.round(t.solVol * 100) / 100,
      mcapSol: Math.round(t.mcapSol * 100) / 100,
      mcapUsd: Math.round((t.mcapSol || 0) * 170),
      bp: Math.round((t.bp || 0) * 10) / 10,
      dev: t.devShort || t.dev, created: t.created,
      description: t.description || "", source: "ws",
      // Social intel
      twitter: t.twitter || "", twitterHandle: t.twitterHandle || null, twitterValid: !!t.twitterValid,
      website: t.website || "", websiteValid: !!t.websiteValid, websiteLive: !!t.websiteLive,
      telegram: t.telegram || "",
      socialCount: t.socialCount || 0,
      imageDupe: !!t.imageDupe,
      imageOriginal: t.imageOriginal || null,
      // Bundle detection
      bundleScore: t.bundleScore || 0,
      bundleFlags: t.bundleFlags || [],
      bundled: (t.bundleScore || 0) >= 40, // boolean shortcut
    };

    allScored.push({ ...base, scores });
  }

  // Sort each tab by its own score, take top 10
  radar.movers.new = allScored
    .filter(t => t.scores.new >= 15)
    .map(t => ({ ...t, score: t.scores.new, verdict: t.scores.new >= 55 ? "APE" : t.scores.new >= 25 ? "WATCH" : "SKIP" }))
    .sort((a, b) => b.score - a.score).slice(0, 10);

  radar.movers.hot = allScored
    .filter(t => t.scores.hot >= 15)
    .map(t => ({ ...t, score: t.scores.hot, verdict: t.scores.hot >= 50 ? "APE" : t.scores.hot >= 25 ? "WATCH" : "SKIP" }))
    .sort((a, b) => b.score - a.score).slice(0, 10);

  radar.movers.graduating = allScored
    .filter(t => t.scores.graduating >= 20)
    .map(t => ({ ...t, score: t.scores.graduating, verdict: t.scores.graduating >= 55 ? "APE" : t.scores.graduating >= 30 ? "WATCH" : "SKIP" }))
    .sort((a, b) => b.score - a.score).slice(0, 10);

  radar.updated = now;
}

// ═══════════════════════════════════════
// BUNDLE DETECTION — analyzes early trades for coordinated buying patterns
// Runs on every new trade for the first 30 trades per token
// ═══════════════════════════════════════
function analyzeBundle(t) {
  const trades = t.earlyTrades;
  const flags = [];
  let score = 0;

  const buys = trades.filter(tr => tr.type === "buy");
  const sells = trades.filter(tr => tr.type === "sell");
  if (buys.length === 0) { t.bundleScore = 0; t.bundleFlags = []; return; }

  const createdAt = t.created;

  // ── 1. Rapid buys after creation (within 2s) ──
  const instantBuys = buys.filter(b => b.time - createdAt < 2000);
  if (instantBuys.length >= 3) {
    score += 30;
    flags.push(`${instantBuys.length} buys in <2s`);
  } else if (instantBuys.length >= 2) {
    score += 15;
    flags.push(`${instantBuys.length} buys in <2s`);
  }

  // ── 2. Same-second buys (likely same block/bundle) ──
  const timeGroups = {};
  for (const b of buys) {
    const sec = Math.floor(b.time / 1000);
    timeGroups[sec] = (timeGroups[sec] || 0) + 1;
  }
  const maxSameSecond = Math.max(0, ...Object.values(timeGroups));
  if (maxSameSecond >= 3) {
    score += 25;
    flags.push(`${maxSameSecond} buys same second`);
  } else if (maxSameSecond >= 2) {
    score += 10;
  }

  // ── 3. Identical buy amounts (coordinated sizing) ──
  const amounts = buys.map(b => Math.round(b.sol * 10000)); // round to 4 decimals
  const amountCounts = {};
  for (const a of amounts) amountCounts[a] = (amountCounts[a] || 0) + 1;
  const maxSameAmount = Math.max(0, ...Object.values(amountCounts));
  if (maxSameAmount >= 3 && buys.length >= 4) {
    score += 20;
    flags.push(`${maxSameAmount}× identical amount`);
  } else if (maxSameAmount >= 2 && buys.length >= 3) {
    score += 8;
  }

  // ── 4. All buys no sells in first 10 trades ──
  const first10 = trades.slice(0, 10);
  const first10Buys = first10.filter(tr => tr.type === "buy").length;
  const first10Sells = first10.filter(tr => tr.type === "sell").length;
  if (first10.length >= 6 && first10Sells === 0) {
    score += 15;
    flags.push("0 sells in first " + first10.length);
  }

  // ── 5. Dev wallet buying again (after create) ──
  const devBuys = buys.filter(b => b.wallet === t.dev);
  if (devBuys.length >= 2) {
    score += 10;
    flags.push("dev multi-buy");
  }

  // ── 6. Low unique wallet ratio ──
  const uniqueWallets = new Set(buys.map(b => b.wallet)).size;
  const walletRatio = uniqueWallets / buys.length;
  if (buys.length >= 5 && walletRatio < 0.4) {
    score += 15;
    flags.push(`${uniqueWallets}/${buys.length} unique wallets`);
  } else if (buys.length >= 5 && walletRatio < 0.6) {
    score += 8;
    flags.push(`low diversity: ${uniqueWallets}/${buys.length}`);
  }

  // ── 7. Tiny buy amounts from many wallets (dust buys to inflate buyer count) ──
  const dustBuys = buys.filter(b => b.sol < 0.01);
  if (dustBuys.length >= 3 && dustBuys.length / buys.length > 0.5) {
    score += 12;
    flags.push(`${dustBuys.length} dust buys (<0.01 SOL)`);
  }

  // ── 8. Wallet reuse (same wallet buying multiple times quickly) ──
  const walletBuyCounts = {};
  for (const b of buys) walletBuyCounts[b.wallet] = (walletBuyCounts[b.wallet] || 0) + 1;
  const maxWalletBuys = Math.max(0, ...Object.values(walletBuyCounts));
  if (maxWalletBuys >= 3) {
    score += 10;
    flags.push(`1 wallet bought ${maxWalletBuys}×`);
  }

  t.bundleScore = Math.min(100, score);
  t.bundleFlags = flags;
}

function connectPumpPortalWS() {
  if (!radar.enabled) return;
  console.log("[RADAR] Connecting to PumpPortal WebSocket...");
  let ws;
  try {
    ws = new WebSocket("wss://pumpportal.fun/api/data");
  } catch (e) {
    console.error("[RADAR] WS error:", e.message);
    setTimeout(connectPumpPortalWS, 10000);
    return;
  }
  radar.wsRef = ws;

  ws.on("open", () => {
    radar.wsAlive = true;
    radar.subbed.clear();
    console.log("[RADAR] \u2713 PumpPortal connected — streaming new tokens + trades");
    ws.send(JSON.stringify({ method: "subscribeNewToken" }));
    // Re-subscribe to any existing tracked tokens
    const activeCAs = [...radar.pool.keys()].slice(0, radar.MAX_TRACKED);
    if (activeCAs.length > 0) {
      ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: activeCAs }));
      activeCAs.forEach(ca => radar.subbed.add(ca));
      console.log(`[RADAR] Re-subscribed to ${activeCAs.length} token trades`);
    }
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Debug: log first trade event to see actual fields
      if ((msg.txType === "buy" || msg.txType === "sell") && !radar._debuggedTrade) {
        radar._debuggedTrade = true;
        console.log("[RADAR] Sample trade event fields:", JSON.stringify(msg).slice(0, 500));
      }

      // New token created
      if (msg.txType === "create" && msg.mint) {
        const ca = msg.mint;
        if (!radar.pool.has(ca)) {
          radar.pool.set(ca, {
            name: msg.name || "?", ticker: msg.symbol || "?",
            dev: msg.traderPublicKey || "",
            devShort: (msg.traderPublicKey || "").slice(0, 8),
            created: Date.now(), buys: 0, sells: 0, solVol: 0,
            mcapSol: msg.marketCapSol || 0, lastTrade: Date.now(),
            uri: msg.uri || "", image: "", description: "",
            bp: msg.vSolInBondingCurve ? Math.max(0, ((msg.vSolInBondingCurve - 30) / 55) * 100) : 0,
            vSol: msg.vSolInBondingCurve || 0,
            // Bundle detection — track early trades
            earlyTrades: [],      // first 30 trades with wallet + amount + time
            bundleScore: 0,       // 0-100: higher = more likely bundled
            bundleFlags: [],      // human-readable flags
          });
          // Subscribe to this token's trades
          if (radar.subbed.size < radar.MAX_TRACKED) {
            ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [ca] }));
            radar.subbed.add(ca);
          }
          // If at limit, unsub oldest low-score token
          if (radar.subbed.size >= radar.MAX_TRACKED) {
            pruneSubscriptions(ws);
          }
          // Try to fetch metadata for image (fire-and-forget, best effort)
          if (msg.uri) fetchMetadata(ca, msg.uri);
        }
      }

      // Trade on a tracked token
      if ((msg.txType === "buy" || msg.txType === "sell") && msg.mint) {
        const t = radar.pool.get(msg.mint);
        if (t) {
          if (msg.txType === "buy") t.buys++;
          else t.sells++;
          // PumpPortal sends solAmount already in SOL (not lamports!)
          const tradeSol = Math.abs(msg.solAmount || 0);
          t.solVol += tradeSol;
          t.mcapSol = msg.marketCapSol || t.mcapSol;
          t.lastTrade = Date.now();

          // Record early trades for bundle detection (first 30)
          if (t.earlyTrades.length < 30) {
            t.earlyTrades.push({
              time: Date.now(),
              type: msg.txType,
              wallet: msg.traderPublicKey || "",
              walletShort: (msg.traderPublicKey || "").slice(0, 8),
              sol: tradeSol,
              sig: (msg.signature || "").slice(0, 12),
            });
            // Re-analyze bundle score after each early trade
            if (t.earlyTrades.length >= 3) {
              analyzeBundle(t);
            }
          }
          // Price history for charting (keep last 200 points)
          if (!t.priceHistory) t.priceHistory = [];
          t.priceHistory.push({
            t: Date.now(),
            mcap: Math.round((msg.marketCapSol || t.mcapSol) * 170),
            mcapSol: msg.marketCapSol || t.mcapSol,
            type: msg.txType,
            sol: Math.abs(msg.solAmount || 0),
            bp: msg.vSolInBondingCurve ? Math.max(0, ((msg.vSolInBondingCurve - 30) / 55) * 100) : t.bp,
            wallet: (msg.traderPublicKey || "").slice(0, 8),
          });
          if (t.priceHistory.length > 200) t.priceHistory = t.priceHistory.slice(-200);
          // Bonding curve progress from vSolInBondingCurve
          // Curve starts at ~30 SOL virtual, graduates at ~85 SOL
          if (msg.vSolInBondingCurve) {
            t.vSol = msg.vSolInBondingCurve;
            t.bp = Math.max(0, Math.min(100, ((msg.vSolInBondingCurve - 30) / 55) * 100));
          }
          // Token amount for volume tracking
          if (msg.tokenAmount) t.lastTokenAmount = msg.tokenAmount;
          // Name might come through on trades
          if (msg.name && t.name === "?") t.name = msg.name;
          if (msg.symbol && t.ticker === "?") t.ticker = msg.symbol;
        }
      }
    } catch {}
  });

  ws.on("close", () => {
    radar.wsAlive = false;
    console.log("[RADAR] Disconnected — reconnecting 5s...");
    if (radar.enabled) setTimeout(connectPumpPortalWS, 5000);
  });

  ws.on("error", (err) => {
    console.error("[RADAR] WS error:", err.message);
    radar.wsAlive = false;
  });
}

function pruneSubscriptions(ws) {
  // Remove oldest tokens with lowest activity from subscriptions
  const entries = [...radar.pool.entries()]
    .filter(([ca]) => radar.subbed.has(ca))
    .sort((a, b) => (a[1].buys + a[1].solVol) - (b[1].buys + b[1].solVol));
  const toUnsub = entries.slice(0, 10).map(([ca]) => ca);
  if (toUnsub.length > 0 && ws.readyState === 1) {
    ws.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: toUnsub }));
    toUnsub.forEach(ca => radar.subbed.delete(ca));
  }
}

// Image fingerprint cache — detect reused images across tokens
const imageFingerprints = new Map(); // imageUrl -> { firstCa, firstTicker, count, firstSeen }

// Fetch token metadata from URI — extracts socials, image, description
async function fetchMetadata(ca, uri) {
  try {
    let url = uri;
    if (url.startsWith("ipfs://")) url = "https://cf-ipfs.com/ipfs/" + url.slice(7);
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const meta = await r.json();
      const t = radar.pool.get(ca);
      if (t) {
        // Image
        let img = meta.image || "";
        if (img.startsWith("ipfs://")) img = "https://cf-ipfs.com/ipfs/" + img.slice(7);
        t.image = img;

        // Image dupe detection — normalize URL and check cache
        if (img) {
          const imgKey = img.replace(/^https?:\/\//, "").replace(/\?.*$/, ""); // strip protocol + query
          if (imageFingerprints.has(imgKey)) {
            const prev = imageFingerprints.get(imgKey);
            prev.count++;
            t.imageDupe = true;
            t.imageOriginal = { ca: prev.firstCa, ticker: prev.firstTicker, seen: prev.count };
          } else {
            imageFingerprints.set(imgKey, { firstCa: ca, firstTicker: t.ticker, count: 1, firstSeen: Date.now() });
            t.imageDupe = false;
          }
        }

        // Text fields
        if (meta.description) t.description = meta.description.slice(0, 200);
        if (meta.name && t.name === "?") t.name = meta.name;
        if (meta.symbol && t.ticker === "?") t.ticker = meta.symbol;

        // Socials — pump.fun metadata includes these when creator fills them in
        t.twitter = meta.twitter || "";
        t.telegram = meta.telegram || "";
        t.website = meta.website || "";

        // Social score (0-3): how many social links present
        t.socialCount = (t.twitter ? 1 : 0) + (t.telegram ? 1 : 0) + (t.website ? 1 : 0);

        // Validate Twitter URL (basic format check)
        if (t.twitter) {
          const twMatch = t.twitter.match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/);
          t.twitterHandle = twMatch ? twMatch[1] : null;
          t.twitterValid = !!twMatch;
        }

        // Validate website (basic — is it a real URL?)
        if (t.website) {
          t.websiteValid = /^https?:\/\/.+\..+/.test(t.website);
        }

        // Quick website reachability check (HEAD, non-blocking)
        if (t.website && t.websiteValid) {
          fetch(t.website, { method: "HEAD", signal: AbortSignal.timeout(3000) })
            .then(r => { t.websiteLive = r.ok; })
            .catch(() => { t.websiteLive = false; });
        }
      }
    }
  } catch {} // silent — metadata is best-effort
}

// Prune old image fingerprints every 10 min
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [key, val] of imageFingerprints) {
    if (val.firstSeen < cutoff) imageFingerprints.delete(key);
  }
}, 600000);

// Start + intervals
connectPumpPortalWS();
setInterval(() => { if (radar.enabled) computeMovers(); }, 4000);
// Prune dead tokens every 2 min
setInterval(() => {
  const cutoff = Date.now() - 20 * 60 * 1000; // 20 min max age
  for (const [ca, t] of radar.pool) {
    if (t.created < cutoff) {
      radar.pool.delete(ca);
      radar.subbed.delete(ca);
    }
  }
  // Enforce pool size
  if (radar.pool.size > 200) {
    const sorted = [...radar.pool.entries()].sort((a, b) => a[1].created - b[1].created);
    const excess = sorted.slice(0, radar.pool.size - 200);
    for (const [ca] of excess) { radar.pool.delete(ca); radar.subbed.delete(ca); }
  }
}, 120000);

app.get("/api/radar", apiLimiter, (req, res) => {
  const tab = req.query.tab || "all"; // "new", "hot", "graduating", or "all"
  if (tab !== "all" && radar.movers[tab]) {
    return res.json({ ok: true, tokens: radar.movers[tab], tab, wsAlive: radar.wsAlive, poolSize: radar.pool.size, subbedCount: radar.subbed.size, updated: radar.updated, enabled: radar.enabled });
  }
  res.json({
    ok: true,
    tabs: {
      new: radar.movers.new || [],
      hot: radar.movers.hot || [],
      graduating: radar.movers.graduating || [],
    },
    // Backwards compat: "tokens" = hot tab (best default for aping)
    tokens: radar.movers.hot || [],
    wsAlive: radar.wsAlive,
    poolSize: radar.pool.size,
    subbedCount: radar.subbed.size,
    updated: radar.updated,
    enabled: radar.enabled,
  });
});

// Chart data — returns WS-derived price history for any tracked token
app.get("/api/chart/:ca", apiLimiter, (req, res) => {
  const ca = req.params.ca;
  const t = radar.pool.get(ca);
  if (!t || !t.priceHistory || t.priceHistory.length === 0) {
    return res.json({ ok: true, ca, points: [], source: "none" });
  }
  res.json({
    ok: true, ca,
    points: t.priceHistory,
    name: t.name, ticker: t.ticker,
    mcapSol: t.mcapSol, bp: t.bp,
    buys: t.buys, sells: t.sells,
    source: "ws",
  });
});

// Single token detail (uses pump.fun HTTP as best-effort, falls back to WS data)
app.get("/api/radar/token/:ca", apiLimiter, async (req, res) => {
  const ca = req.params.ca;
  const wsData = radar.pool.get(ca);
  // Try pump.fun HTTP for rich data
  try {
    const r = await fetch("https://frontend-api-v2.pump.fun/coins/" + ca, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (r.ok) {
      const c = await r.json();
      return res.json({
        ok: true, ca, name: c.name || wsData?.name, ticker: c.symbol || wsData?.ticker,
        image: c.image_uri || wsData?.image || "", description: (c.description || "").slice(0, 300),
        mcap: c.usd_market_cap || Math.round((wsData?.mcapSol || 0) * 170),
        bp: c.bonding_curve_progress || wsData?.bp || 0,
        replies: c.reply_count || 0, complete: c.complete || false,
        creator: c.creator || wsData?.dev || "",
        buys: wsData?.buys || 0, sells: wsData?.sells || 0,
        solVol: Math.round((wsData?.solVol || 0) * 100) / 100,
        mcapSol: wsData?.mcapSol || 0,
        // Bundle detection
        bundleScore: wsData?.bundleScore || 0,
        bundleFlags: wsData?.bundleFlags || [],
        bundled: (wsData?.bundleScore || 0) >= 40,
        // Socials
        twitter: wsData?.twitter || "", twitterHandle: wsData?.twitterHandle || null, twitterValid: !!wsData?.twitterValid,
        website: wsData?.website || "", websiteValid: !!wsData?.websiteValid, websiteLive: !!wsData?.websiteLive,
        telegram: wsData?.telegram || "",
        socialCount: wsData?.socialCount || 0,
        imageDupe: !!wsData?.imageDupe, imageOriginal: wsData?.imageOriginal || null,
      });
    }
  } catch {}
  // Fallback to WS data only
  if (wsData) {
    return res.json({
      ok: true, ca, name: wsData.name, ticker: wsData.ticker,
      image: wsData.image, description: wsData.description,
      mcap: Math.round((wsData.mcapSol || 0) * 170),
      bp: Math.round((wsData.bp || 0) * 10) / 10,
      replies: 0, complete: false,
      creator: wsData.devShort || wsData.dev,
      buys: wsData.buys, sells: wsData.sells,
      solVol: Math.round((wsData.solVol || 0) * 100) / 100,
      mcapSol: Math.round((wsData.mcapSol || 0) * 100) / 100,
      // Bundle detection
      bundleScore: wsData.bundleScore || 0,
      bundleFlags: wsData.bundleFlags || [],
      bundled: (wsData.bundleScore || 0) >= 40,
      // Socials
      twitter: wsData.twitter || "", twitterHandle: wsData.twitterHandle || null, twitterValid: !!wsData.twitterValid,
      website: wsData.website || "", websiteValid: !!wsData.websiteValid, websiteLive: !!wsData.websiteLive,
      telegram: wsData.telegram || "",
      socialCount: wsData.socialCount || 0,
      imageDupe: !!wsData.imageDupe, imageOriginal: wsData.imageOriginal || null,
    });
  }
  res.json({ ok: false, error: "Token not found", ca });
});

// Toggle radar on/off
app.post("/api/radar/toggle", apiLimiter, (req, res) => {
  radar.enabled = !radar.enabled;
  if (!radar.enabled && radar.wsRef) {
    try { radar.wsRef.close(); } catch {}
    radar.wsAlive = false;
  } else if (radar.enabled && !radar.wsAlive) {
    connectPumpPortalWS();
  }
  console.log("[RADAR]", radar.enabled ? "ENABLED" : "DISABLED");
  res.json({ ok: true, enabled: radar.enabled });
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
  const wallet = req.query.wallet || "";
  const owner = wallet ? isOwnerWallet(wallet) : false;
  const tier = owner ? "vip" : (req.query.tier || "free");
  const info = getFeeTier(tier);
  res.json({ ...info, isOwner: owner });
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

    let pumpData = null, dexData = null;

    // Fetch pump.fun + DexScreener in parallel
    const [pumpRes, dexRes] = await Promise.allSettled([
      fetch("https://frontend-api-v2.pump.fun/coins/" + ca, { signal: AbortSignal.timeout(6000) }).then(r => r.ok ? r.json() : null),
      fetch("https://api.dexscreener.com/latest/dex/tokens/" + ca, { signal: AbortSignal.timeout(6000) }).then(r => r.ok ? r.json() : null),
    ]);

    pumpData = pumpRes.status === "fulfilled" ? pumpRes.value : null;
    const dexPairs = dexRes.status === "fulfilled" ? dexRes.value : null;
    dexData = dexPairs?.pairs?.[0] || null;

    if (!pumpData && !dexData) return res.status(404).json({ error: "Token not found" });

    // Build unified analysis
    const name = pumpData?.name || dexData?.baseToken?.name || "?";
    const symbol = pumpData?.symbol || dexData?.baseToken?.symbol || "?";
    const mcap = dexData?.marketCap || dexData?.fdv || pumpData?.usd_market_cap || 0;
    const created = pumpData?.created_timestamp || dexData?.pairCreatedAt || Date.now();
    const age = (Date.now() - new Date(created).getTime()) / 60000; // minutes
    const replies = pumpData?.reply_count || 0;
    const complete = pumpData?.complete || (dexData?.dexId && dexData.dexId !== "pumpfun");
    const imageUri = pumpData?.image_uri || dexData?.info?.imageUrl || null;
    const description = pumpData?.description || "";
    // Bonding progress: pump.fun data > estimate from mcap (graduation ~$67k)
    const bp = pumpData?.bonding_curve_progress || (complete ? 100 : Math.min(99, Math.max(0, (mcap / 67000) * 100)));

    // DexScreener real trading data
    const vol24h = dexData?.volume?.h24 || 0;
    const vol1h = dexData?.volume?.h1 || 0;
    const txns24h = dexData?.txns?.h24 || { buys: 0, sells: 0 };
    const txns1h = dexData?.txns?.h1 || { buys: 0, sells: 0 };
    const priceChange5m = dexData?.priceChange?.m5 || 0;
    const priceChange1h = dexData?.priceChange?.h1 || 0;
    const priceChange24h = dexData?.priceChange?.h24 || 0;
    const liquidity = dexData?.liquidity?.usd || 0;
    const priceUsd = parseFloat(dexData?.priceUsd || 0);

    // ── SCORING ENGINE ──
    // 6 factors, each 0-20 pts, total 0-120 normalized to 0-100
    let factors = [];

    // 1. Momentum (price action) — is it moving?
    let momentumScore = 10; // neutral
    if (priceChange1h > 50) momentumScore = 20;
    else if (priceChange1h > 20) momentumScore = 17;
    else if (priceChange1h > 5) momentumScore = 14;
    else if (priceChange1h > 0) momentumScore = 12;
    else if (priceChange1h > -10) momentumScore = 8;
    else if (priceChange1h > -30) momentumScore = 5;
    else momentumScore = 2;
    factors.push({ name: "Momentum", score: momentumScore, detail: (priceChange1h > 0 ? "+" : "") + priceChange1h.toFixed(1) + "% 1h" });

    // 2. Volume — is there activity?
    let volumeScore = 5;
    if (vol1h > 50000) volumeScore = 20;
    else if (vol1h > 10000) volumeScore = 16;
    else if (vol1h > 2000) volumeScore = 12;
    else if (vol1h > 500) volumeScore = 8;
    factors.push({ name: "Volume", score: volumeScore, detail: "$" + (vol1h > 1000 ? (vol1h / 1000).toFixed(1) + "k" : Math.round(vol1h)) + " 1h" });

    // 3. Buy pressure — buys vs sells ratio
    const totalTxns1h = (txns1h.buys || 0) + (txns1h.sells || 0);
    const buyRatio = totalTxns1h > 0 ? (txns1h.buys / totalTxns1h) : 0.5;
    let pressureScore = Math.round(buyRatio * 20);
    factors.push({ name: "Buy Pressure", score: pressureScore, detail: txns1h.buys + "B/" + txns1h.sells + "S 1h" });

    // 4. Bonding Progress — how far along the curve? Sweet spot is 5-50%
    let bondScore = 5;
    if (complete) bondScore = 4; // graduated — already on raydium
    else if (bp >= 5 && bp < 20) bondScore = 18; // early traction, most upside
    else if (bp >= 20 && bp < 50) bondScore = 16; // confirmed momentum
    else if (bp >= 50 && bp < 80) bondScore = 12; // getting expensive
    else if (bp >= 80) bondScore = 8; // near graduation, risky entry
    else if (bp > 0) bondScore = 10; // just started
    factors.push({ name: "Bonded", score: bondScore, detail: complete ? "graduated" : bp.toFixed(1) + "%" });

    // 5. Market cap — sweet spot for pump potential
    let mcapScore = 10;
    if (mcap >= 5000 && mcap < 50000) mcapScore = 18; // early, room to grow
    else if (mcap >= 50000 && mcap < 200000) mcapScore = 15; // confirmed interest
    else if (mcap >= 200000 && mcap < 1000000) mcapScore = 12; // mid, ok
    else if (mcap >= 1000000) mcapScore = 6; // high cap, less upside
    else if (mcap < 5000) mcapScore = 8; // too early, risky
    factors.push({ name: "MCap", score: mcapScore, detail: "$" + (mcap > 1000 ? (mcap / 1000).toFixed(1) + "k" : Math.round(mcap)) });

    // 6. Freshness — newer = more potential
    let freshScore = 10;
    if (age < 5) freshScore = 20; // brand new
    else if (age < 30) freshScore = 17;
    else if (age < 120) freshScore = 14;
    else if (age < 720) freshScore = 10;
    else if (age < 1440) freshScore = 6;
    else freshScore = 3; // old
    factors.push({ name: "Freshness", score: freshScore, detail: age < 60 ? Math.round(age) + "m" : Math.round(age / 60) + "h old" });

    const rawTotal = factors.reduce((a, f) => a + f.score, 0);
    const maxPossible = 120;
    const score = Math.round((rawTotal / maxPossible) * 100);
    const verdict = score >= 70 ? "APE" : score >= 45 ? "RISKY" : "AVOID";

    res.json({
      name, symbol, usd_market_cap: mcap, created_timestamp: created,
      reply_count: replies, complete, image_uri: imageUri, description,
      bp, source: pumpData ? "pumpfun" : "dexscreener",
      // Trading data
      vol24h, vol1h, txns24h, txns1h,
      priceChange5m, priceChange1h, priceChange24h,
      priceUsd,
      // Analysis
      score, verdict, factors,
    });
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

    // Deploy-only allows totalSol = 0
    const isDeployOnly = fleetConfig?.deployOnly;
    if (!isDeployOnly && (!totalSol || totalSol < 0.1 || totalSol > 100)) {
      return res.status(400).json({ error: "totalSol must be between 0.1 and 100" });
    }
    if (!tokenConfig) return res.status(400).json({ error: "tokenConfig required" });
    if (!tokenConfig.existingCA && (!tokenConfig.name || !tokenConfig.ticker)) {
      return res.status(400).json({ error: "Need token name+ticker or existingCA" });
    }

    const walletInfo = await getWalletTier(wallet);

    // (4) Rate limiting per tier
    if (userStore) {
      const limits = { free: 5, pro: 50, vip: 200 };
      const maxPerHour = limits[walletInfo.tier] || limits.free;
      const rl = await userStore.checkRateLimit(wallet, "launch", maxPerHour);
      if (!rl.allowed) return res.status(429).json({ error: `Rate limit: ${maxPerHour} launches/hour. Try again in ${rl.resetIn}s.` });
    }

    // (1)(5) Free tier branding enforcement — server-side, can't bypass
    if (walletInfo.tier === "free" && !walletInfo.whitelisted && !tokenConfig.existingCA) {
      // Force "deployed with bondli.fun" in description
      const desc = (tokenConfig.description || "").trim();
      const brandTag = "deployed with bondli.fun";
      if (!desc.toLowerCase().includes("bondli")) {
        tokenConfig.description = desc ? `${desc} | ${brandTag}` : brandTag;
      }
    }

    // (2) Track user
    if (userStore) await userStore.getOrCreate(wallet);

    const session = await sessionManager.create({
      userWallet: wallet,
      totalSol: isDeployOnly ? 0 : Math.min(100, totalSol),
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
        jitoTip: session.fleetConfig?.jitoTip || 0.001,
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

    // ── Step 3: Start fleet trading on this CA (skip for deploy-only) ──
    let orchResult = { ok: true };
    const isDeployOnly = session.fleetConfig?.deployOnly || session.fleetBudget <= 0;
    if (!isDeployOnly) {
      try {
        CONFIG.TOKEN_CA = tokenCA;

        console.log(`[LAUNCH] Starting fleet with ${session.fleetBudget} SOL on ${tokenCA}`);
        
        // Look up radar/analysis score for conviction-based wallet sizing
        let radarScore = 50; // default medium conviction
        if (existingCA) {
          const radarToken = radar.pool.get(tokenCA);
          if (radarToken) {
            // Use the best score from any radar tab
            const allScored = radar.movers.hot?.find(t => t.ca === tokenCA) || radar.movers.new?.find(t => t.ca === tokenCA) || radar.movers.graduating?.find(t => t.ca === tokenCA);
            if (allScored) radarScore = allScored.score;
          }
          console.log(`[LAUNCH] APE conviction: ${radarScore}/100`);
        }

        orchResult = await orch.launch(tokenCA, {
          totalSol: session.fleetBudget,
          devKeypair,
          sessionId: session.id,
          force: true,
          fleetConfig: { ...(session.fleetConfig || {}), existingCA: !!existingCA, radarScore },
          profitConfig: (session.tier === "free") ? { cutPercent: FREE_PROFIT_CUT, platformWallet: PLATFORM_WALLET } : null,
        });
        console.log(`[LAUNCH] Fleet started:`, JSON.stringify(orchResult).slice(0, 300));
        
        // Start live price tracking
        startPricePolling(tokenCA);

        // CRITICAL: Save fleet wallet keys for recovery
        if (orchResult.walletKeys) {
          await sessionManager.update(session.id, {
            fleetWallets: orchResult.walletKeys,
            profitConfig: (session.tier === "free") ? { cutPercent: FREE_PROFIT_CUT, platformWallet: PLATFORM_WALLET } : null,
            status: "live",
            launchedAt: new Date().toISOString(),
          });
          console.log(`[LAUNCH] Saved ${orchResult.walletKeys.length} fleet wallet keys to session`);
        }
    } catch (orchErr) {
      console.warn("[LAUNCH] Fleet start failed:", orchErr.message);
      console.warn("[LAUNCH] Stack:", orchErr.stack?.split("\n").slice(0, 3).join("\n"));
      orchResult = { ok: true, fleetError: orchErr.message };
    }
    } else {
      console.log(`[LAUNCH] Deploy-only mode — no fleet, no dev buy`);
      await sessionManager.update(session.id, { status: "deployed", launchedAt: new Date().toISOString() });
    }

    if (sessionStore) {
      await sessionStore.recordLaunch(session.userWallet, tokenCA, session.totalSol);
    }
    if (userStore) {
      if (isDeployOnly) await userStore.recordDeploy(session.userWallet, tokenCA);
      else await userStore.recordLaunch(session.userWallet, tokenCA, session.totalSol);
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
      walletKeys: orchResult.walletKeys || [],
      devSecret: bs58.encode(devKeypair.secretKey),
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

// Delete a single session (clears from Redis + memory)
app.post("/api/session/delete", apiLimiter, async (req, res) => {
  try {
    const { sessionId, wallet } = req.body;
    if (!sessionId || !wallet) return res.status(400).json({ error: "sessionId and wallet required" });
    const session = await sessionManager.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });
    // Stop fleet if running
    if (session.tokenCA) { try { orch.stop(session.tokenCA); } catch {} }
    await sessionManager.delete(sessionId);
    console.log(`[SESSION] Deleted ${sessionId} for ${wallet.slice(0, 8)}`);
    res.json({ ok: true, deleted: sessionId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Clear ALL sessions for a user
app.post("/api/sessions/clear", apiLimiter, async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    // Stop all running fleets first
    try { await orch.closeAll(); } catch {}
    const count = await sessionManager.deleteAllForUser(wallet);
    console.log(`[SESSION] Cleared ${count} sessions for ${wallet.slice(0, 8)}`);
    res.json({ ok: true, cleared: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Resume/view a previously launched session — shows wallet balances and recovery options
app.post("/api/session/resume", apiLimiter, async (req, res) => {
  try {
    const { sessionId, wallet } = req.body;
    if (!sessionId || !wallet) return res.status(400).json({ error: "sessionId and wallet required" });

    const session = await sessionManager.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });
    if (!session.tokenCA) return res.status(400).json({ error: "No token CA — session was never launched" });

    // Check if fleet is currently running
    const orchStatus = orch.getSessionStatus(session.tokenCA);
    if (orchStatus && orchStatus.running) {
      return res.json({ ok: true, status: "running", tokenCA: session.tokenCA, ...orchStatus });
    }

    // Gather wallet balances (don't start trading!)
    const connection = new Connection(CONFIG.RPC_URL, "confirmed");
    const walletInfo = [];
    let totalBalance = 0;

    // Dev/master wallet
    const devKeypair = await sessionManager.getDevKeypair(sessionId);
    if (devKeypair) {
      try {
        const bal = await connection.getBalance(devKeypair.publicKey);
        const solBal = bal / LAMPORTS_PER_SOL;
        totalBalance += solBal;
        walletInfo.push({ role: "master", pubkey: devKeypair.publicKey.toBase58().slice(0, 8), balance: solBal });
      } catch {}
    }

    // Fleet wallets (if saved)
    if (session.fleetWallets && session.fleetWallets.length > 0) {
      for (const fw of session.fleetWallets) {
        try {
          const kp = Keypair.fromSecretKey(bs58.decode(fw.secret));
          const bal = await connection.getBalance(kp.publicKey);
          const solBal = bal / LAMPORTS_PER_SOL;
          totalBalance += solBal;
          walletInfo.push({ role: fw.role, pubkey: kp.publicKey.toBase58().slice(0, 8), balance: solBal });
        } catch {}
      }
    }

    res.json({
      ok: true,
      status: "stopped",
      tokenCA: session.tokenCA,
      totalBalance,
      wallets: walletInfo,
      hasFleetKeys: !!(session.fleetWallets && session.fleetWallets.length > 0),
      canRecover: totalBalance > 0.001,
      session: {
        id: session.id,
        totalSol: session.totalSol,
        devBuy: session.devBuy,
        fleetBudget: session.fleetBudget,
        createdAt: session.createdAt,
        ticker: session.tokenConfig?.ticker,
        name: session.tokenConfig?.name,
      },
    });
  } catch (e) {
    console.error("[RESUME] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Emergency recover: sweep all SOL from fleet wallets back to master/user wallet
app.post("/api/session/recover", apiLimiter, requireVerifiedWallet, async (req, res) => {
  try {
    const { sessionId, wallet } = req.body;
    if (!sessionId || !wallet) return res.status(400).json({ error: "sessionId and wallet required" });

    const session = await sessionManager.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });

    // Stop any running fleet first
    if (session.tokenCA) {
      try { await orch.close(session.tokenCA); } catch {}
    }

    // Collect all wallet secrets
    const secrets = [];
    const devKeypair = await sessionManager.getDevKeypair(sessionId);

    // Dev/master wallet — ALWAYS include
    if (devKeypair) {
      secrets.push({ role: "master", secret: bs58.encode(devKeypair.secretKey), pubkey: devKeypair.publicKey.toBase58() });
    }

    // Fleet wallets (momentum, whale, sniper, etc.)
    if (session.fleetWallets) {
      for (const fw of session.fleetWallets) {
        if (fw.secret) secrets.push({ role: fw.role || "fleet", secret: fw.secret, pubkey: fw.pubkey || "?" });
      }
    }

    // Also try Redis-stored fleet keys (backup)
    const redis = getRedis();
    if (redis) {
      try {
        const storedKeys = await redis.get("fleetkeys:" + sessionId);
        if (storedKeys) {
          const parsed = JSON.parse(storedKeys);
          const existingPubs = new Set(secrets.map(s => s.pubkey));
          for (const fk of parsed) {
            if (fk.secret && !existingPubs.has(fk.pubkey)) secrets.push(fk);
          }
        }
      } catch {}
    }

    // Sweep everything to user's connected wallet
    const destination = new PublicKey(wallet);

    if (secrets.length === 0) {
      return res.json({ ok: true, message: "No fleet wallets found to recover", totalRecovered: 0, wallets: [] });
    }

    console.log(`[RECOVER] ${sessionId} | Found ${secrets.length} wallets to sweep -> ${wallet.slice(0, 8)}`);

    // Determine profit config
    const walletInfo = await getWalletTier(wallet);
    const profitConfig = (walletInfo.tier === "free" && !walletInfo.whitelisted)
      ? { cutPercent: FREE_PROFIT_CUT, platformWallet: PLATFORM_WALLET }
      : null;

    // Direct sweep — don't rely on orch, do it ourselves
    const connection = new Connection(CONFIG.RPC_URL, "confirmed");
    const results = [];
    let totalRecovered = 0;

    for (const w of secrets) {
      try {
        const kp = Keypair.fromSecretKey(bs58.decode(w.secret));
        const balance = await connection.getBalance(kp.publicKey);
        const balSol = balance / LAMPORTS_PER_SOL;

        if (balance <= 5000) {
          results.push({ role: w.role, pubkey: kp.publicKey.toBase58().slice(0, 8), balance: balSol, swept: 0, status: "empty" });
          continue;
        }

        // If this IS the destination wallet, skip (can't sweep to self)
        if (kp.publicKey.equals(destination)) {
          results.push({ role: w.role, pubkey: kp.publicKey.toBase58().slice(0, 8), balance: balSol, swept: 0, status: "is_destination" });
          continue;
        }

        // Send balance - 5000 (base fee). Account goes to 0 → no rent issue.
        const sweepLamports = balance - 5000;
        const tx = new Transaction().add(
          SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: destination, lamports: sweepLamports })
        );

        const sig = await sendAndConfirmTransaction(connection, tx, [kp], { skipPreflight: true, commitment: "confirmed" });
        const sweptSol = sweepLamports / LAMPORTS_PER_SOL;
        totalRecovered += sweptSol;
        results.push({ role: w.role, pubkey: kp.publicKey.toBase58().slice(0, 8), balance: balSol, swept: sweptSol, sig, status: "ok" });
        console.log(`[RECOVER] [${w.role}] ${kp.publicKey.toBase58().slice(0, 8)}... -> ${sweptSol.toFixed(4)} SOL`);
      } catch (e) {
        results.push({ role: w.role || "?", pubkey: w.pubkey?.slice(0, 8) || "?", error: e.message, status: "failed" });
        console.error(`[RECOVER] [${w.role}] Failed: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 400));
    }

    await sessionManager.update(sessionId, { status: "recovered", recoveredAt: new Date().toISOString() });
    console.log(`[RECOVER] ${sessionId} | Total recovered: ${totalRecovered.toFixed(4)} SOL from ${results.filter(r => r.status === "ok").length}/${secrets.length} wallets`);

    res.json({ ok: true, totalRecovered, walletCount: secrets.length, swept: results.filter(r => r.status === "ok").length, wallets: results, destination: wallet });
  } catch (e) {
    console.error("[RECOVER] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// EMERGENCY: Force sweep all wallets in a session directly to user
// This is a standalone sweep that doesn't depend on orch
app.post("/api/session/force-recover", apiLimiter, async (req, res) => {
  try {
    const { sessionId, wallet } = req.body;
    if (!sessionId || !wallet) return res.status(400).json({ error: "sessionId and wallet required" });

    const session = await sessionManager.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });

    const connection = new Connection(CONFIG.RPC_URL, "confirmed");
    const destination = new PublicKey(wallet);
    const results = [];
    let totalRecovered = 0;

    // Collect ALL possible keypairs
    const keypairs = [];

    // Dev/master
    const devKeypair = await sessionManager.getDevKeypair(sessionId);
    if (devKeypair) keypairs.push({ role: "master", kp: devKeypair });

    // Fleet wallets from session
    if (session.fleetWallets) {
      for (const fw of session.fleetWallets) {
        if (fw.secret) {
          try {
            keypairs.push({ role: fw.role || "fleet", kp: Keypair.fromSecretKey(bs58.decode(fw.secret)) });
          } catch (e) { console.error(`[FORCE-RECOVER] Bad secret for ${fw.role}: ${e.message}`); }
        }
      }
    }

    console.log(`[FORCE-RECOVER] ${sessionId} | Found ${keypairs.length} keypairs | Destination: ${wallet.slice(0, 8)}`);

    for (const { role, kp } of keypairs) {
      try {
        // Skip if this IS the destination
        if (kp.publicKey.equals(destination)) {
          results.push({ role, pubkey: kp.publicKey.toBase58().slice(0, 8), status: "is_destination", swept: 0 });
          continue;
        }

        const balance = await connection.getBalance(kp.publicKey);
        const balSol = balance / LAMPORTS_PER_SOL;

        // Need at least base tx fee (5000 lamports) to sweep
        if (balance <= 5000) {
          results.push({ role, pubkey: kp.publicKey.toBase58().slice(0, 8), balance: balSol, status: "dust", swept: 0 });
          continue;
        }

        // Send balance - 5000 (base fee). Account goes to 0 → deleted. No rent issue.
        // NO priority fee — avoids leaving nonzero sub-rent-exempt remainder
        const sweepLamports = balance - 5000;
        const tx = new Transaction().add(
          SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: destination, lamports: sweepLamports })
        );

        const sig = await sendAndConfirmTransaction(connection, tx, [kp], { skipPreflight: true, commitment: "confirmed" });
        const sweptSol = sweepLamports / LAMPORTS_PER_SOL;
        totalRecovered += sweptSol;
        results.push({ role, pubkey: kp.publicKey.toBase58().slice(0, 8), balance: balSol, swept: sweptSol, sig, status: "ok" });
        console.log(`[FORCE-RECOVER] [${role}] ${kp.publicKey.toBase58().slice(0, 8)} -> ${sweptSol.toFixed(4)} SOL ✓`);
      } catch (e) {
        results.push({ role, pubkey: kp.publicKey.toBase58().slice(0, 8), status: "failed", error: e.message });
        console.error(`[FORCE-RECOVER] [${role}] FAILED: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`[FORCE-RECOVER] Done: ${totalRecovered.toFixed(4)} SOL recovered from ${results.filter(r => r.status === "ok").length}/${keypairs.length} wallets`);
    res.json({ ok: true, totalRecovered, wallets: results, destination: wallet });
  } catch (e) {
    console.error("[FORCE-RECOVER] Error:", e.message, e.stack);
    res.status(500).json({ error: e.message });
  }
});

// Batch deploy — create multiple tokens rapidly (VIP only)
app.post("/api/batch-deploy", apiLimiter, requireVerifiedWallet, async (req, res) => {
  try {
    const { wallet, count, tokenConfig, masterSeed, jitoTip, delayMs } = req.body;
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    if (!count || count < 1 || count > 20) return res.status(400).json({ error: "count must be 1-20" });
    if (!tokenConfig?.name || !tokenConfig?.ticker) return res.status(400).json({ error: "name and ticker required" });

    const walletInfo = await getWalletTier(wallet);
    if (walletInfo.tier !== "pro" && !walletInfo.whitelisted) {
      return res.status(403).json({ error: "Batch deploy is VIP/Pro only" });
    }

    // Free tier branding (shouldn't reach here since batch is pro/vip only, but safety)
    if (walletInfo.tier === "free") {
      const desc = (tokenConfig.description || "").trim();
      if (!desc.toLowerCase().includes("bondli")) {
        tokenConfig.description = desc ? `${desc} | deployed with bondli.fun` : "deployed with bondli.fun";
      }
    }

    const connection = new Connection(CONFIG.RPC_URL, "confirmed");
    const delay = Math.max(2000, delayMs || 5000); // min 2s between deploys

    // Resolve master keypair (funding source)
    let masterKp;
    if (masterSeed) {
      try { masterKp = Keypair.fromSecretKey(bs58.decode(masterSeed)); } catch {}
    }
    if (!masterKp) return res.status(400).json({ error: "Master wallet private key required for batch deploy" });

    // Upload metadata ONCE (reuse for all)
    console.log(`[BATCH] Starting ${count} deploys for ${tokenConfig.name} ($${tokenConfig.ticker})`);
    console.log(`[BATCH] Key rotation: each token gets a fresh creator wallet`);

    // SSE-style: send results as they come via JSON array
    const results = [];

    for (let i = 0; i < count; i++) {
      try {
        // Generate fresh creator keypair for each deploy (key rotation)
        const creatorKp = Keypair.generate();
        const creatorPubkey = creatorKp.publicKey.toBase58();

        // Fund the fresh creator from master (creation fee + optional dev buy)
        const fundAmount = Math.floor(0.05 * LAMPORTS_PER_SOL); // 0.05 SOL for creation + fees
        const fundTx = new Transaction().add(
          SystemProgram.transfer({ fromPubkey: masterKp.publicKey, toPubkey: creatorKp.publicKey, lamports: fundAmount })
        );
        await sendAndConfirmTransaction(connection, fundTx, [masterKp], { skipPreflight: true, commitment: "confirmed" });
        console.log(`[BATCH] [${i + 1}] Funded creator ${creatorPubkey.slice(0, 8)}... with 0.05 SOL`);

        const result = await createToken(connection, creatorKp, {
          ...tokenConfig,
          name: count > 1 ? `${tokenConfig.name} ${String.fromCharCode(65 + (i % 26))}` : tokenConfig.name,
        }, {
          devBuySol: 0,
          jitoTip: jitoTip || 0.003,
        });

        results.push({
          index: i + 1,
          ok: true,
          ca: result.tokenCA || result.mintAddress || result.mint,
          creator: creatorPubkey,
          creatorSecret: bs58.encode(creatorKp.secretKey),
          txSig: result.txSig,
          pumpUrl: "https://pump.fun/coin/" + (result.tokenCA || result.mintAddress || result.mint),
        });
        console.log(`[BATCH] ${i + 1}/${count} deployed: ${results[results.length - 1].ca?.slice(0, 8)}... (creator: ${creatorPubkey.slice(0, 8)})`);
      } catch (e) {
        results.push({ index: i + 1, ok: false, error: e.message });
        console.error(`[BATCH] ${i + 1}/${count} failed: ${e.message}`);
      }

      // Delay between deploys (avoid rate limit + looks more natural)
      if (i < count - 1) await new Promise(r => setTimeout(r, delay + Math.random() * 2000));
    }

    console.log(`[BATCH] Complete: ${results.filter(r => r.ok).length}/${count} succeeded | ${count} unique creators`);
    res.json({ ok: true, total: count, succeeded: results.filter(r => r.ok).length, results, rotatedKeys: true });
  } catch (e) {
    console.error("[BATCH] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Sell all tokens in fleet wallets and sweep SOL back to master
app.post("/api/session/sell-sweep", apiLimiter, requireVerifiedWallet, async (req, res) => {
  try {
    const { sessionId, wallet } = req.body;
    if (!sessionId || !wallet) return res.status(400).json({ error: "sessionId and wallet required" });

    const session = await sessionManager.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });
    if (!session.tokenCA) return res.status(400).json({ error: "No token CA" });

    const connection = new Connection(CONFIG.RPC_URL, "confirmed");
    const results = [];
    let totalSold = 0, totalSwept = 0, totalSkimmed = 0;

    // Determine profit config for this user
    const walletInfo = await getWalletTier(wallet);
    const profitConfig = (walletInfo.tier === "free" && !walletInfo.whitelisted)
      ? { cutPercent: FREE_PROFIT_CUT, platformWallet: PLATFORM_WALLET }
      : session.profitConfig || null; // fallback to persisted config

    // Get master wallet
    const devKeypair = await sessionManager.getDevKeypair(sessionId);
    const masterPubkey = devKeypair ? devKeypair.publicKey : new PublicKey(wallet);

    // Get all fleet wallet keys
    const fleetWallets = session.fleetWallets || [];
    
    // Also check Redis backup for fleet keys
    const redis = getRedis();
    if (redis) {
      try {
        const storedKeys = await redis.get("fleetkeys:" + sessionId);
        if (storedKeys) {
          const parsed = JSON.parse(storedKeys);
          const existingPubkeys = new Set(fleetWallets.map(w => w.pubkey));
          for (const fk of parsed) {
            if (fk.secret && !existingPubkeys.has(fk.pubkey)) fleetWallets.push(fk);
          }
        }
      } catch {}
    }

    // Always include dev wallet for sell
    if (devKeypair) {
      const devPub = devKeypair.publicKey.toBase58();
      if (!fleetWallets.find(w => w.pubkey === devPub)) {
        fleetWallets.push({ role: "dev", secret: bs58.encode(devKeypair.secretKey), pubkey: devPub });
      }
    }

    // Fetch pump globals once
    let global, feeConfig;
    try { global = await orch.onlineSdk.fetchGlobal(); feeConfig = await orch.onlineSdk.fetchFeeConfig(); } catch (e) {
      return res.status(500).json({ error: "Cannot fetch pump.fun state: " + e.message });
    }

    const mint = new PublicKey(session.tokenCA);

    for (const fw of fleetWallets) {
      const walletResult = { role: fw.role, pubkey: (fw.pubkey || "?").slice(0, 8), sold: 0, swept: 0, errors: [] };
      try {
        const kp = Keypair.fromSecretKey(bs58.decode(fw.secret));

        // Step 1: Sell all tokens
        try {
          const ata = getAssociatedTokenAddressSync(mint, kp.publicKey, true);
          const account = await getAccount(connection, ata);
          const tokenBalance = new BN(account.amount.toString());

          if (!tokenBalance.isZero() && global && feeConfig) {
            const sellState = await orch.onlineSdk.fetchSellState(mint, kp.publicKey);
            const { bondingCurveAccountInfo, bondingCurve } = sellState;
            const mintSupply = bondingCurve.tokenTotalSupply || global.tokenTotalSupply;
            const solOut = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply, bondingCurve, amount: tokenBalance });

            const sellIx = await orch.sdk.sellInstructions({
              global, bondingCurveAccountInfo, bondingCurve,
              mint, user: kp.publicKey, amount: tokenBalance, solAmount: solOut, slippage: 50,
            });

            const tx = new Transaction();
            tx.add(
              ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
              ...sellIx,
            );
            await sendAndConfirmTransaction(connection, tx, [kp], { skipPreflight: true, commitment: "confirmed" });
            const soldSol = parseFloat(solOut.toString()) / 1e9;
            walletResult.sold = soldSol;
            totalSold += soldSol;
            console.log(`[SELL-SWEEP] [${fw.role}] Sold tokens -> ${soldSol.toFixed(4)} SOL`);
          }
        } catch (e) { walletResult.errors.push("sell: " + e.message); }

        await new Promise(r => setTimeout(r, 500));

        // Step 2: Sweep SOL to master (with enforced profit skim)
        if (!kp.publicKey.equals(masterPubkey)) {
          try {
            const sweepResult = await skimSweep(connection, kp, masterPubkey, profitConfig, fw.allocation || 0);
            walletResult.swept = sweepResult.swept;
            walletResult.skimmed = sweepResult.skimmed;
            totalSwept += sweepResult.swept;
            totalSkimmed += sweepResult.skimmed;
            if (sweepResult.swept > 0) console.log(`[SELL-SWEEP] [${fw.role}] Swept ${sweepResult.swept.toFixed(4)} SOL -> master${sweepResult.skimmed > 0 ? ` (skimmed ${sweepResult.skimmed.toFixed(4)})` : ""}`);
          } catch (e) { walletResult.errors.push("sweep: " + e.message); }
        }
      } catch (e) { walletResult.errors.push("keypair: " + e.message); }

      results.push(walletResult);
      await new Promise(r => setTimeout(r, 300));
    }

    // Check master balance
    let masterBalance = 0;
    try { masterBalance = await connection.getBalance(masterPubkey) / LAMPORTS_PER_SOL; } catch {}

    // Final sweep: master wallet -> user's connected wallet (if different)
    if (devKeypair && !devKeypair.publicKey.equals(new PublicKey(wallet))) {
      try {
        const masterBal = await connection.getBalance(devKeypair.publicKey);
        const sweepAmount = masterBal - 5000; // base fee only, account goes to 0
        if (sweepAmount > 0) {
          const tx = new Transaction().add(
            SystemProgram.transfer({ fromPubkey: devKeypair.publicKey, toPubkey: new PublicKey(wallet), lamports: sweepAmount })
          );
          await sendAndConfirmTransaction(connection, tx, [devKeypair], { skipPreflight: true, commitment: "confirmed" });
          const sweptSol = sweepAmount / LAMPORTS_PER_SOL;
          totalSwept += sweptSol;
          results.push({ role: "master->user", pubkey: devKeypair.publicKey.toBase58().slice(0, 8), swept: sweptSol, sold: 0, errors: [] });
          console.log(`[SELL-SWEEP] Master -> User: ${sweptSol.toFixed(4)} SOL`);
          masterBalance = 0;
        }
      } catch (e) {
        console.error("[SELL-SWEEP] Master->User sweep failed:", e.message);
      }
    }

    await sessionManager.update(sessionId, { status: "swept", sweptAt: new Date().toISOString() });
    console.log(`[SELL-SWEEP] ${sessionId} complete | Sold: ${totalSold.toFixed(4)} SOL | Swept: ${totalSwept.toFixed(4)} SOL | Skimmed: ${totalSkimmed.toFixed(4)} SOL | Master: ${masterBalance.toFixed(4)} SOL`);

    res.json({ ok: true, totalSold, totalSwept, totalSkimmed, masterBalance, wallets: results, destination: masterPubkey.toBase58() });
  } catch (e) {
    console.error("[SELL-SWEEP] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get fleet wallet private keys for manual recovery (VIP only)
app.get("/api/session/:id/keys", apiLimiter, requireVerifiedWallet, async (req, res) => {
  try {
    const wallet = req.headers["x-wallet"];
    if (!wallet) return res.status(401).json({ error: "wallet required" });

    const walletInfo = await getWalletTier(wallet);
    if (walletInfo.tier !== "pro" && !walletInfo.whitelisted) {
      return res.status(403).json({ error: "VIP/Pro only — for safety" });
    }

    const session = await sessionManager.get(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });

    const keys = [];
    
    // Dev wallet
    if (session.devSecret) {
      keys.push({ role: "dev/master", pubkey: session.devWallet, secret: session.devSecret });
    }

    // Fleet wallets
    if (session.fleetWallets) {
      for (const fw of session.fleetWallets) {
        keys.push({ role: fw.role, pubkey: fw.pubkey, secret: fw.secret });
      }
    }

    res.json({ ok: true, keys, tokenCA: session.tokenCA, warning: "NEVER share these keys. Import into Phantom to manually recover funds." });
  } catch (e) {
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

    // Execute close (skim already enforced atomically in fleet-trader)
    const result = await orch.close(ca);

    // Record the already-enforced skim
    const platformCut = result.platformCut || 0;
    const netProfit = result.netProfit || 0;
    if (walletInfo.tier === "free" && !walletInfo.whitelisted) {
      await recordProfit(wallet, netProfit, platformCut);
      if (userStore) await userStore.recordClose(wallet, result.solRecovered || 0, platformCut, netProfit);
      result.fee = { tier: "free", netProfit, platformCut, userKeeps: netProfit - platformCut, cutPercent: platformCut > 0 ? FREE_PROFIT_CUT : 0 };
      if (platformCut > 0) console.log(`[FEE] Recorded: ${wallet} | profit: ${netProfit.toFixed(4)} SOL | skimmed: ${platformCut.toFixed(4)} SOL (${FREE_PROFIT_CUT}%)`);
    } else {
      result.fee = { tier: walletInfo.tier, netProfit, platformCut: 0, userKeeps: netProfit, cutPercent: 0 };
    }

    res.json(result);
  } catch (e) { res.status(500).json({ error: IS_PROD ? "Server error. Check logs." : e.message }); }
});

app.post("/api/close-all", apiLimiter, walletAuth, async (req, res) => {
  try {
    const wallet = req.user.wallet;
    const walletInfo = await getWalletTier(wallet);
    const result = await orch.closeAll();

    // Apply profit skim to aggregate (already enforced in fleet-trader)
    if (walletInfo.tier === "free" && !walletInfo.whitelisted) {
      const netProfit = result.totalNetProfit || 0;
      const platformCut = result.totalPlatformCut || 0;
      result.fee = { tier: "free", netProfit, platformCut, userKeeps: +(netProfit - platformCut).toFixed(6), cutPercent: platformCut > 0 ? FREE_PROFIT_CUT : 0 };
      if (platformCut > 0) await recordProfit(wallet, netProfit, platformCut);
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

app.get("/api/admin/users", async (req, res) => {
  if (req.headers["x-admin-secret"] !== CONFIG.API_SECRET) return res.status(403).json({ error: "Forbidden" });
  if (!userStore) return res.json({ users: [] });
  const users = await userStore.allUsers(500);
  res.json({ count: users.length, users });
});

app.get("/api/admin/stats", async (req, res) => {
  if (req.headers["x-admin-secret"] !== CONFIG.API_SECRET) return res.status(403).json({ error: "Forbidden" });
  if (!userStore) return res.json({});
  const stats = await userStore.platformStats();
  res.json(stats);
});

// Admin: set wallet tier (persists in Redis)
app.post("/api/admin/set-tier", async (req, res) => {
  if (req.headers["x-admin-secret"] !== CONFIG.API_SECRET) return res.status(403).json({ error: "Forbidden" });
  const { wallet, tier } = req.body;
  if (!wallet || !tier) return res.status(400).json({ error: "wallet and tier required" });
  if (!["free", "pro", "vip"].includes(tier)) return res.status(400).json({ error: "tier must be free, pro, or vip" });
  const redis = getRedis();
  if (!redis) return res.status(503).json({ error: "Redis not connected" });
  await redis.set("tier:" + wallet, tier);
  if (userStore) await userStore.setTier(wallet, tier);
  console.log(`[ADMIN] Set tier: ${wallet.slice(0, 8)}... -> ${tier}`);
  res.json({ ok: true, wallet, tier });
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
  const sendWs = (msg) => { if (ws.readyState === 1) { try { ws.send(msg); } catch {} } };
  const onTrade = (data) => sendWs(JSON.stringify({ event: "trade", data }));
  const onPhase = (data) => sendWs(JSON.stringify({ event: "phase", data }));
  orch.on("trade", onTrade);
  orch.on("phase", onPhase);
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("close", () => { orch.off("trade", onTrade); orch.off("phase", onPhase); });
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
