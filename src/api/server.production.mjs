// BONDLI v3.0 — PRODUCTION API Server
// Tiers: Free (25% profit share), Pro (10 SOL one-time, 0%), VIP (whitelisted, 0%)
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { Connection, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction, Keypair, sendAndConfirmTransaction } from "@solana/web3.js";
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
const PLATFORM_WALLET = process.env.PLATFORM_WALLET || ""; // MUST be set to actual base58 pubkey in env
if (!PLATFORM_WALLET) console.warn("[WARN] PLATFORM_WALLET not set! Set to your actual Solana pubkey, not SNS name.");

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
    priceHistory: (priceHistory.get(ca) || []).slice(-120), // last 120 points (~6 min)
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
    const complete = pumpData?.complete || (dexData?.dexId !== "pumpfun");
    const imageUri = pumpData?.image_uri || dexData?.info?.imageUrl || null;
    const description = pumpData?.description || "";

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

    // 4. Liquidity — can we trade without slippage?
    let liqScore = 5;
    if (liquidity > 50000) liqScore = 20;
    else if (liquidity > 20000) liqScore = 16;
    else if (liquidity > 5000) liqScore = 12;
    else if (liquidity > 1000) liqScore = 8;
    factors.push({ name: "Liquidity", score: liqScore, detail: "$" + (liquidity > 1000 ? (liquidity / 1000).toFixed(1) + "k" : Math.round(liquidity)) });

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

    // Bonded penalty — already graduated means less pump potential
    if (complete) {
      factors.push({ name: "Bonded", score: 0, detail: "graduated — limited upside" });
    }

    const rawTotal = factors.reduce((a, f) => a + f.score, 0);
    const maxPossible = complete ? 140 : 120; // extra factor if bonded
    const score = Math.round((rawTotal / maxPossible) * 100);
    const verdict = score >= 70 ? "APE" : score >= 45 ? "RISKY" : "AVOID";

    res.json({
      name, symbol, usd_market_cap: mcap, created_timestamp: created,
      reply_count: replies, complete, image_uri: imageUri, description,
      source: pumpData ? "pumpfun" : "dexscreener",
      // Trading data
      vol24h, vol1h, txns24h, txns1h,
      priceChange5m, priceChange1h, priceChange24h,
      liquidity, priceUsd,
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
        
        orchResult = await orch.launch(tokenCA, {
          totalSol: session.fleetBudget,
          devKeypair,
          sessionId: session.id,
          force: true,
          fleetConfig: session.fleetConfig || {},
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

    // Fleet wallets
    if (session.fleetWallets) {
      for (const fw of session.fleetWallets) {
        if (fw.secret) secrets.push(fw.secret);
      }
    }

    // Sweep everything to user's connected wallet (or dev wallet if master)
    const destination = session.useMaster && devKeypair ? devKeypair.publicKey.toBase58() : wallet;

    if (secrets.length === 0) {
      return res.json({ ok: true, message: "No fleet wallets found to recover", totalRecovered: 0, wallets: [] });
    }

    // Determine profit config
    const walletInfo = await getWalletTier(wallet);
    const profitConfig = (walletInfo.tier === "free" && !walletInfo.whitelisted)
      ? { cutPercent: FREE_PROFIT_CUT, platformWallet: PLATFORM_WALLET }
      : null;

    const result = await orch.recover(secrets, destination, profitConfig);

    // Also sweep dev wallet to user if it's not the master
    if (!session.useMaster && devKeypair) {
      try {
        const connection = new Connection(CONFIG.RPC_URL, "confirmed");
        const balance = await connection.getBalance(devKeypair.publicKey);
        const sweepAmount = balance - 5000;
        if (sweepAmount > 0) {
          const tx = new Transaction().add(
            SystemProgram.transfer({ fromPubkey: devKeypair.publicKey, toPubkey: new PublicKey(wallet), lamports: sweepAmount })
          );
          await sendAndConfirmTransaction(connection, tx, [devKeypair], { skipPreflight: true, commitment: "confirmed" });
          result.totalRecovered += sweepAmount / LAMPORTS_PER_SOL;
          result.wallets.push({ pubkey: devKeypair.publicKey.toBase58().slice(0, 8), swept: sweepAmount / LAMPORTS_PER_SOL, status: "ok", role: "dev" });
        }
      } catch (e) {
        console.error("[RECOVER] Dev wallet sweep failed:", e.message);
      }
    }

    await sessionManager.update(sessionId, { status: "recovered", recoveredAt: new Date().toISOString() });
    console.log(`[RECOVER] ${sessionId} | Recovered ${result.totalRecovered.toFixed(4)} SOL to ${destination.slice(0, 8)}`);

    res.json({ ok: true, ...result, destination });
  } catch (e) {
    console.error("[RECOVER] Error:", e.message);
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

    // Resolve master keypair
    let masterKp;
    if (masterSeed) {
      try { masterKp = Keypair.fromSecretKey(bs58.decode(masterSeed)); } catch {}
    }
    if (!masterKp) return res.status(400).json({ error: "Master wallet private key required for batch deploy" });

    // Upload metadata ONCE (reuse for all)
    console.log(`[BATCH] Starting ${count} deploys for ${tokenConfig.name} ($${tokenConfig.ticker})`);

    // SSE-style: send results as they come via JSON array
    const results = [];
    let metadataUri = null;

    for (let i = 0; i < count; i++) {
      try {
        // Generate fresh mint keypair for each token
        const mintKp = Keypair.generate();
        
        const result = await createToken(connection, masterKp, {
          ...tokenConfig,
          // Vary name slightly to avoid exact duplicates
          name: count > 1 ? `${tokenConfig.name} ${String.fromCharCode(65 + (i % 26))}` : tokenConfig.name,
        }, {
          devBuySol: 0,
          jitoTip: jitoTip || 0.003, // higher tip for batch speed
        });

        results.push({
          index: i + 1,
          ok: true,
          ca: result.tokenCA || result.mintAddress || mintKp.publicKey.toBase58(),
          txSig: result.txSig,
          pumpUrl: "https://pump.fun/coin/" + (result.tokenCA || result.mintAddress || mintKp.publicKey.toBase58()),
        });
        console.log(`[BATCH] ${i + 1}/${count} deployed: ${results[results.length - 1].ca?.slice(0, 8)}...`);
      } catch (e) {
        results.push({ index: i + 1, ok: false, error: e.message });
        console.error(`[BATCH] ${i + 1}/${count} failed: ${e.message}`);
      }

      // Delay between deploys (avoid rate limit)
      if (i < count - 1) await new Promise(r => setTimeout(r, delay));
    }

    console.log(`[BATCH] Complete: ${results.filter(r => r.ok).length}/${count} succeeded`);
    res.json({ ok: true, total: count, succeeded: results.filter(r => r.ok).length, results });
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
    if (fleetWallets.length === 0 && devKeypair) {
      // At minimum try to sell from dev wallet
      fleetWallets.push({ role: "dev", secret: bs58.encode(devKeypair.secretKey), pubkey: devKeypair.publicKey.toBase58() });
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
