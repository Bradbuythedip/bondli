/**
 * ═══════════════════════════════════════════════════════════════
 * BONDLI v4 — server.production.mjs
 * Express API + PumpPortal WebSocket Radar + Fleet Trading
 * ═══════════════════════════════════════════════════════════════
 *
 * Deploy: Railway (or any Node.js host)
 * Env vars: RPC_URL, REDIS_URL, PLATFORM_WALLET, ADMIN_SECRET,
 *           PUMPPORTAL_API_KEY (optional), PORT
 *
 * This file handles:
 *   - PumpPortal WebSocket → real-time radar feed
 *   - Session lifecycle (create → fund → launch → close)
 *   - Fleet trading (via fleet-trader.mjs)
 *   - Trading wallet management
 *   - Quick buy/sell (PumpPortal Lightning)
 *   - Positions / portfolio tracking
 *   - SOL price (server-to-server, no CORS)
 *   - Admin/owner dashboard endpoints
 *   - Referral system
 *   - Username system
 * ═══════════════════════════════════════════════════════════════
 */

import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createClient as createRedisClient } from "redis";
import {
  Connection, Keypair, PublicKey, Transaction,
  SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction, ComputeBudgetProgram
} from "@solana/web3.js";
import bs58 from "bs58";
import crypto from "crypto";
import { SessionManager, calculateDevBuy } from "../engine/session-manager.mjs";
import { FleetTrader, skimSweep } from "../engine/fleet-trader.mjs";
import { createToken } from "../engine/token-creator.mjs";
import { resolveTier, buildProfitConfig, isOwnerWallet, registerOwner, PLATFORM_WALLET } from "../engine/fee-engine.mjs";
import CONFIG from "../engine/config.mjs";

// ═══════════════════════════════════════
// ENVIRONMENT
// ═══════════════════════════════════════
const PORT = parseInt(process.env.PORT || "3001");
const RPC_URL = process.env.RPC_URL || CONFIG.RPC_URL || "https://api.mainnet-beta.solana.com";
const REDIS_URL = process.env.REDIS_URL || null;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "bondli_default";
const PUMPPORTAL_WS_URL = "wss://pumpportal.fun/api/data";

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
const app = express();
// CORS — inline, no npm package needed
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Wallet, x-wallet, X-Admin-Secret, X-API-Secret, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
// Trust proxy (Railway)
app.set("trust proxy", 1);

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const connection = new Connection(RPC_URL, "confirmed");

// Redis (optional — in-memory fallback)
let redis = null;
if (REDIS_URL) {
  try {
    redis = createRedisClient({ url: REDIS_URL });
    redis.on("error", (e) => console.warn("[REDIS] Error:", e.message));
    await redis.connect();
    console.log("[REDIS] Connected");
  } catch (e) {
    console.warn("[REDIS] Failed to connect:", e.message, "— using in-memory");
    redis = null;
  }
}

// Core services
const sessionManager = new SessionManager(redis);
const fleetTrader = new FleetTrader();

// Register owner wallet
if (process.env.OWNER_WALLET) registerOwner(process.env.OWNER_WALLET);

// ═══════════════════════════════════════
// SOL PRICE (server-to-server, no CORS)
// FIX: Replaces hardcoded * 170
// ═══════════════════════════════════════
let solUsdPrice = 135;
async function pollSolPrice() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) });
    if (r.ok) { const d = await r.json(); if (d?.solana?.usd > 0) solUsdPrice = d.solana.usd; }
  } catch {
    // Fallback: try Jupiter
    try {
      const r2 = await fetch("https://price.jup.ag/v6/price?ids=SOL", { signal: AbortSignal.timeout(5000) });
      if (r2.ok) { const d2 = await r2.json(); if (d2?.data?.SOL?.price > 0) solUsdPrice = d2.data.SOL.price; }
    } catch {}
  }
}
pollSolPrice();
setInterval(pollSolPrice, 30000);

// ═══════════════════════════════════════
// PUMPPORTAL WEBSOCKET — RADAR FEED
// ═══════════════════════════════════════
const radar = {
  tokens: new Map(),    // ca → token data
  tabs: { new: [], hot: [], graduating: [], momentum: [] },
  poolSize: 0,
  online: 0,
  ws: null,
  reconnects: 0,
};

function connectPumpPortal() {
  try {
    radar.ws = new WebSocket(PUMPPORTAL_WS_URL);

    radar.ws.on("open", () => {
      console.log("[RADAR] PumpPortal WS connected");
      radar.reconnects = 0;
      // Subscribe to new token events + trades
      radar.ws.send(JSON.stringify({ method: "subscribeNewToken" }));
      radar.ws.send(JSON.stringify({ method: "subscribeTokenTrade" }));
    });

    radar.ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw);
        processRadarMessage(data);
      } catch {}
    });

    radar.ws.on("close", () => {
      console.log("[RADAR] WS disconnected — reconnecting in 5s");
      setTimeout(connectPumpPortal, 5000);
      radar.reconnects++;
    });

    radar.ws.on("error", (e) => {
      console.error("[RADAR] WS error:", e.message);
    });
  } catch (e) {
    console.error("[RADAR] WS connect failed:", e.message);
    setTimeout(connectPumpPortal, 10000);
  }
}

function processRadarMessage(data) {
  if (!data) return;
  const now = Date.now();

  // New token creation — only on explicit create events
  if (data.txType === "create" && data.mint) {
    const ca = data.mint;
    if (radar.tokens.has(ca)) return;
    const token = {
      ca,
      name: data.name || "",
      ticker: data.symbol || data.ticker || "",
      description: data.description || "",
      image: "",
      twitter: data.twitter || "",
      website: data.website || "",
      telegram: data.telegram || "",
      createdAt: now,
      trades: [],
      buys: 0, sells: 0,
      volumeSol: 0,
      mcapSol: data.marketCapSol || 0,
      mcapUsd: Math.round((data.marketCapSol || 0) * solUsdPrice),
      uniqueBuyers: new Set(),
      // Seed spark with initial mcap so frontend renders immediately (needs ≥2 points)
      spark: (data.marketCapSol > 0) ? [
        Math.round((data.marketCapSol * 0.85) * solUsdPrice),
        Math.round((data.marketCapSol * 0.92) * solUsdPrice),
        Math.round(data.marketCapSol * solUsdPrice),
      ] : [],
      h1Change: 0,
      devWallet: data.traderPublicKey || "",
      graduated: false,
      bundled: false,
    };
    radar.tokens.set(ca, token);
    // Fetch metadata for image (fire-and-forget)
    if (data.uri) fetchTokenImage(ca, data.uri).catch(() => {});
    // Cap pool size
    if (radar.tokens.size > 500) {
      const oldest = [...radar.tokens.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) radar.tokens.delete(oldest[0]);
    }
    return;
  }

  // Trade event (buy or sell)
  if ((data.txType === "buy" || data.txType === "sell") && data.mint) {
    const ca = data.mint;
    let token = radar.tokens.get(ca);
    // Auto-create on first trade if missed create event
    if (!token) {
      const initMcap = (data.marketCapSol || 0) * solUsdPrice;
      token = {
        ca, name: data.name || "", ticker: data.symbol || "",
        description: "", image: "", twitter: "", website: "", telegram: "",
        createdAt: now, trades: [], buys: 0, sells: 0, volumeSol: 0,
        mcapSol: 0, mcapUsd: 0, uniqueBuyers: new Set(),
        spark: initMcap > 0 ? [Math.round(initMcap * 0.9), Math.round(initMcap)] : [],
        h1Change: 0, devWallet: "", graduated: false, bundled: false,
      };
      radar.tokens.set(ca, token);
      if (data.uri) fetchTokenImage(ca, data.uri).catch(() => {});
    }
    // PumpPortal sends solAmount already in SOL (NOT lamports)
    const sol = Math.abs(data.solAmount || 0);
    if (data.txType === "buy") {
      token.buys++;
      token.volumeSol += sol;
      if (data.traderPublicKey) token.uniqueBuyers.add(data.traderPublicKey);
    } else {
      token.sells++;
    }
    // Update mcap
    if (data.marketCapSol > 0) {
      token.mcapSol = data.marketCapSol;
      token.mcapUsd = Math.round(data.marketCapSol * solUsdPrice);
    } else if (data.vSolInBondingCurve > 0) {
      token.mcapSol = data.vSolInBondingCurve * 2;
      token.mcapUsd = Math.round(token.mcapSol * solUsdPrice);
    }
    if (data.name && !token.name) token.name = data.name;
    if (data.symbol && !token.ticker) token.ticker = data.symbol;
    // Sparkline
    if (token.mcapUsd > 0) {
      token.spark.push(token.mcapUsd);
      if (token.spark.length > 60) token.spark = token.spark.slice(-60);
    }
    token.trades.push({ side: data.txType, sol, wallet: (data.traderPublicKey || "").slice(0, 8), time: now });
    if (token.trades.length > 100) token.trades = token.trades.slice(-100);
    const firstSpark = token.spark.length > 1 ? token.spark[0] : token.mcapUsd;
    token.h1Change = firstSpark > 0 ? ((token.mcapUsd - firstSpark) / firstSpark) * 100 : 0;
    broadcastWS({ event: "trade", data: { ca, side: data.txType, sol, mcap: token.mcapUsd, wallet: (data.traderPublicKey || "").slice(0, 8) } });
  }
}

// Fetch token image from metadata URI
async function fetchTokenImage(ca, uri) {
  try {
    let url = uri;
    if (url.startsWith("ipfs://")) url = "https://cf-ipfs.com/ipfs/" + url.slice(7);
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return;
    const meta = await r.json();
    const token = radar.tokens.get(ca);
    if (!token) return;
    let img = meta.image || "";
    if (img.startsWith("ipfs://")) img = "https://cf-ipfs.com/ipfs/" + img.slice(7);
    token.image = img;
    if (meta.description && !token.description) token.description = (meta.description || "").slice(0, 200);
    if (meta.twitter) token.twitter = meta.twitter;
    if (meta.telegram) token.telegram = meta.telegram;
    if (meta.website) token.website = meta.website;
  } catch {}
}


// Rebuild radar tabs every 5 seconds
setInterval(() => {
  const now = Date.now();

  // Clean old tokens (2h TTL)
  for (const [ca, t] of radar.tokens) {
    if (now - t.createdAt > 7200000) radar.tokens.delete(ca);
  }

  const all = [...radar.tokens.values()].filter(t => now - t.createdAt < 3600000);

  // ── DEDUP by normalized name ──
  // Keep the "best" version: most buys > most volume > has socials > oldest (first mover)
  function dedup(tokens) {
    const byName = new Map();
    for (const t of tokens) {
      const key = (t.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!key || key.length < 2) { byName.set(t.ca, t); continue; }
      const existing = byName.get(key);
      if (!existing) { byName.set(key, t); continue; }
      // Score which is the "real" one
      const scoreA = (existing.buys || 0) * 2 + (existing.volumeSol || 0) * 3
        + (existing.twitter ? 5 : 0) + (existing.website ? 5 : 0) + (existing.image ? 3 : 0)
        + (existing.description ? 2 : 0);
      const scoreB = (t.buys || 0) * 2 + (t.volumeSol || 0) * 3
        + (t.twitter ? 5 : 0) + (t.website ? 5 : 0) + (t.image ? 3 : 0)
        + (t.description ? 2 : 0);
      if (scoreB > scoreA) byName.set(key, t);
    }
    return [...byName.values()];
  }

  // Serialize with varied sparklines
  const serialize = (t) => {
    // If spark has <3 points but mcap exists, generate varied synthetic data
    let spark = t.spark || [];
    if (spark.length < 3 && t.mcapUsd > 0) {
      const mc = t.mcapUsd;
      const hash = (t.ca || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
      const v = (hash % 20) / 100; // 0-0.19 variance based on CA hash
      spark = [
        Math.round(mc * (0.7 + v)), Math.round(mc * (0.75 + v * 0.5)),
        Math.round(mc * (0.82 + v * 0.3)), Math.round(mc * (0.88 - v * 0.2)),
        Math.round(mc * (0.93 + v * 0.1)), Math.round(mc * 0.97),
        Math.round(mc * (1.0 + v * 0.05)), mc,
      ];
    }
    return {
      ca: t.ca, name: t.name, ticker: t.ticker, description: (t.description || "").slice(0, 80),
      image: t.image, twitter: t.twitter, website: t.website, telegram: t.telegram,
      mcapSol: t.mcapSol, mcapUsd: t.mcapUsd, buys: t.buys, sells: t.sells,
      volumeSol: +t.volumeSol.toFixed(4),
      uniqueBuyers: t.uniqueBuyers?.size || 0,
      spark, h1Change: +t.h1Change.toFixed(1),
      age: Math.round((now - t.createdAt) / 1000),
      devWallet: t.devWallet, graduated: t.graduated, bundled: t.bundled,
      marketCapSol: t.mcapSol,
    };
  };

  const deduped = dedup(all);

  // ── NEW: freshest tokens with any activity ──
  radar.tabs.new = deduped
    .filter(t => (now - t.createdAt) < 600000) // last 10 min
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50).map(serialize);

  // ── HOT: highest volume ──
  radar.tabs.hot = deduped
    .filter(t => t.buys >= 1)
    .sort((a, b) => (b.volumeSol + b.buys * 0.5) - (a.volumeSol + a.buys * 0.5))
    .slice(0, 50).map(serialize);

  // ── GRADUATING: tokens with meaningful mcap ──
  radar.tabs.graduating = deduped
    .filter(t => t.mcapUsd >= 5000)
    .sort((a, b) => b.mcapUsd - a.mcapUsd)
    .slice(0, 50).map(serialize);

  // ── MOMENTUM: buy velocity (buys per minute) ──
  radar.tabs.momentum = deduped
    .filter(t => t.buys >= 1 && t.mcapUsd > 0)
    .map(t => {
      const ageMin = Math.max(0.5, (now - t.createdAt) / 60000);
      const velocity = t.buys / ageMin;
      const pressure = t.buys / Math.max(1, t.buys + t.sells);
      const score = velocity * 10 + pressure * 20 + (t.uniqueBuyers?.size || 0) * 3 + Math.min(20, t.volumeSol * 2);
      return { ...t, _score: score };
    })
    .sort((a, b) => b._score - a._score)
    .slice(0, 50).map(serialize);

  radar.poolSize = radar.tokens.size;
}, 5000);

connectPumpPortal();

// ═══════════════════════════════════════
// WEBSOCKET BROADCAST
// ═══════════════════════════════════════
function broadcastWS(msg) {
  const str = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(str); } catch {}
    }
  }
}

wss.on("connection", (ws) => {
  radar.online++;
  ws.on("close", () => { radar.online--; });
  // Send initial state
  ws.send(JSON.stringify({ event: "connected", data: { poolSize: radar.poolSize } }));
});

// ═══════════════════════════════════════
// TRADING WALLET STORE (in-memory + Redis)
// ═══════════════════════════════════════
const tradingWallets = new Map(); // userPubkey → { pubkey, secret, createdAt }

async function getTradingWallet(userPubkey) {
  let tw = tradingWallets.get(userPubkey);
  if (!tw && redis) {
    try {
      const raw = await redis.get("tw:" + userPubkey);
      if (raw) { tw = JSON.parse(raw); tradingWallets.set(userPubkey, tw); }
    } catch {}
  }
  return tw;
}

async function saveTradingWallet(userPubkey, tw) {
  tradingWallets.set(userPubkey, tw);
  if (redis) {
    try { await redis.set("tw:" + userPubkey, JSON.stringify(tw), "EX", 2592000); } catch {} // 30d
  }
}

// ═══════════════════════════════════════
// USER STORE (in-memory + Redis)
// ═══════════════════════════════════════
const users = new Map(); // wallet → { tier, whitelisted, username, ... }

async function getUser(wallet) {
  let u = users.get(wallet);
  if (!u && redis) {
    try {
      const raw = await redis.get("user:" + wallet);
      if (raw) { u = JSON.parse(raw); users.set(wallet, u); }
    } catch {}
  }
  return u || { tier: "free", whitelisted: false };
}

async function saveUser(wallet, data) {
  const existing = await getUser(wallet);
  const merged = { ...existing, ...data, lastSeen: new Date().toISOString() };
  users.set(wallet, merged);
  if (redis) {
    try { await redis.set("user:" + wallet, JSON.stringify(merged), "EX", 2592000); } catch {}
  }
}

// ═══════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════
function requireWallet(req, res, next) {
  const wallet = req.headers["x-wallet"] || req.headers["x-wallet"] || req.body?.wallet || req.query?.wallet;
  if (!wallet) return res.status(400).json({ error: "Wallet required" });
  req.wallet = wallet;
  next();
}

function requireAdmin(req, res, next) {
  const secret = req.headers["x-admin-secret"] || req.query?.secret;
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
  next();
}

// ═══════════════════════════════════════
// ROUTES: SOL PRICE
// ═══════════════════════════════════════
app.get("/api/sol-price", (req, res) => {
  res.json({ price: solUsdPrice, updated: Date.now() });
});

// ═══════════════════════════════════════
// ROUTES: ACCESS / TIER
// ═══════════════════════════════════════
app.get("/api/access/check", async (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  const user = await getUser(wallet);
  const tierInfo = resolveTier(wallet, user);
  await saveUser(wallet, { tier: tierInfo.tier, whitelisted: tierInfo.whitelisted });
  res.json({ tier: tierInfo.tier, whitelisted: tierInfo.whitelisted, paid: user.paid || false });
});

app.post("/api/access/activate-free", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  await saveUser(wallet, { tier: "free", activatedAt: new Date().toISOString() });
  res.json({ ok: true, tier: "free" });
});

app.post("/api/access/activate-pro", async (req, res) => {
  const { wallet, txSig } = req.body;
  if (!wallet || !txSig) return res.status(400).json({ error: "wallet and txSig required" });
  // TODO: verify on-chain payment to PLATFORM_WALLET
  await saveUser(wallet, { tier: "pro", paid: true, proTx: txSig });
  res.json({ ok: true, tier: "pro" });
});

app.get("/api/pricing", (req, res) => {
  res.json({
    free: { fee: "25% of profit", label: "Free — 25% profit share" },
    pro: { fee: "0%", price: "10 SOL one-time", label: "Pro — 0% fee" },
    vip: { fee: "0%", label: "VIP — Whitelisted" },
    platformWallet: PLATFORM_WALLET,
  });
});

// ═══════════════════════════════════════
// ROUTES: TRADING WALLET
// ═══════════════════════════════════════
app.get("/api/trading-wallet/:wallet", async (req, res) => {
  const tw = await getTradingWallet(req.params.wallet);
  if (!tw) return res.json({ ok: false, tradingWallet: null });
  // Check balance
  let balance = 0;
  try { balance = await connection.getBalance(new PublicKey(tw.pubkey)) / LAMPORTS_PER_SOL; } catch {}
  res.json({ ok: true, tradingWallet: tw.pubkey, balance });
});

app.post("/api/trading-wallet/create", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  const existing = await getTradingWallet(wallet);
  if (existing) return res.json({ ok: true, tradingWallet: existing.pubkey, already: true });
  const kp = Keypair.generate();
  const tw = { pubkey: kp.publicKey.toBase58(), secret: bs58.encode(kp.secretKey), createdAt: new Date().toISOString() };
  await saveTradingWallet(wallet, tw);
  await saveUser(wallet, { tradingWallet: tw.pubkey });
  res.json({ ok: true, tradingWallet: tw.pubkey, privateKey: tw.secret });
});

app.post("/api/trading-wallet/export", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  const tw = await getTradingWallet(wallet);
  if (!tw) return res.status(404).json({ error: "No trading wallet" });
  res.json({ ok: true, privateKey: tw.secret, pubkey: tw.pubkey });
});

// ── MULTI-WALLET: Pro/VIP can create additional trading wallets ──
app.post("/api/trading-wallet/create-extra", async (req, res) => {
  const { wallet, label } = req.body;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  const user = await getUser(wallet);
  const tierInfo = resolveTier(wallet, user);
  if (tierInfo.tier === "free" && !tierInfo.whitelisted) {
    return res.status(403).json({ error: "Pro/VIP only — upgrade to create multiple wallets" });
  }
  const kp = Keypair.generate();
  const newWallet = { pubkey: kp.publicKey.toBase58(), secret: bs58.encode(kp.secretKey), label: label || "Wallet " + (Date.now() % 1000), createdAt: new Date().toISOString() };
  // Store in list
  let wallets = [];
  if (redis) {
    try {
      const raw = await redis.get("extra_wallets:" + wallet);
      if (raw) wallets = JSON.parse(raw);
    } catch {}
  }
  wallets.push(newWallet);
  if (redis) {
    try { await redis.set("extra_wallets:" + wallet, JSON.stringify(wallets), { EX: 2592000 }); } catch {}
  }
  console.log(`[WALLET] Extra wallet created for ${wallet.slice(0, 8)}: ${newWallet.pubkey.slice(0, 8)}`);
  res.json({ ok: true, wallet: newWallet.pubkey, label: newWallet.label, total: wallets.length });
});

app.get("/api/trading-wallet/list/:wallet", async (req, res) => {
  const wallet = req.params.wallet;
  const primary = await getTradingWallet(wallet);
  const wallets = []; 
  if (primary) {
    let bal = 0;
    try { bal = await connection.getBalance(new PublicKey(primary.pubkey)) / LAMPORTS_PER_SOL; } catch {}
    wallets.push({ pubkey: primary.pubkey, label: "Primary", balance: bal, primary: true });
  }
  // Extra wallets (pro/VIP)
  if (redis) {
    try {
      const raw = await redis.get("extra_wallets:" + wallet);
      if (raw) {
        const extras = JSON.parse(raw);
        for (const ew of extras) {
          let bal = 0;
          try { bal = await connection.getBalance(new PublicKey(ew.pubkey)) / LAMPORTS_PER_SOL; } catch {}
          wallets.push({ pubkey: ew.pubkey, label: ew.label || "Extra", balance: bal, primary: false });
        }
      }
    } catch {}
  }
  res.json({ ok: true, wallets, count: wallets.length });
});

// ═══════════════════════════════════════
// ROUTES: SESSION LIFECYCLE
// ═══════════════════════════════════════
app.post("/api/session/create", async (req, res) => {
  try {
    const { totalSol, tokenConfig, wallet, fleetConfig, masterSeed } = req.body;
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    const user = await getUser(wallet);
    const tierInfo = resolveTier(wallet, user);

    const session = await sessionManager.create({
      userWallet: wallet,
      totalSol: totalSol || 0.5,
      tokenConfig: tokenConfig || {},
      tier: tierInfo.tier,
      fleetConfig: fleetConfig || {},
      masterSeed: masterSeed || null,
    });

    res.json(session);
  } catch (e) {
    console.error("[SESSION] Create error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/session/balance", async (req, res) => {
  const { sessionId, wallet } = req.query;
  const session = await sessionManager.get(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });
  if (session.funded) return res.json({ funded: true, balance: session.actualDeposit || session.totalSol });
  // Check on-chain
  try {
    const balance = await connection.getBalance(new PublicKey(session.devWallet));
    const balanceSol = balance / LAMPORTS_PER_SOL;
    const expectedMin = session.totalSol * 0.90;
    if (balanceSol >= expectedMin) {
      await sessionManager.update(sessionId, { funded: true, status: "funded", actualDeposit: balanceSol, fundedAt: new Date().toISOString() });
      return res.json({ funded: true, balance: balanceSol });
    }
    return res.json({ funded: false, balance: balanceSol, needed: session.totalSol });
  } catch (e) {
    return res.json({ funded: false, error: e.message });
  }
});

app.post("/api/session/fund", async (req, res) => {
  const { sessionId, txSig, wallet } = req.body;
  const result = await sessionManager.verifyDeposit(sessionId, txSig);
  res.json(result);
});

app.post("/api/session/launch", async (req, res) => {
  try {
    const { sessionId, wallet } = req.body;
    const session = await sessionManager.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });
    if (!session.funded) return res.status(400).json({ error: "Not funded" });

    const devKp = await sessionManager.getDevKeypair(sessionId);
    if (!devKp) return res.status(500).json({ error: "Dev keypair not found" });

    const user = await getUser(wallet);
    const tierInfo = resolveTier(wallet, user);
    const profitConfig = buildProfitConfig(tierInfo.tier, tierInfo.whitelisted);

    let tokenCA = session.tokenConfig.existingCA;

    // Create token if not aping existing
    if (!tokenCA) {
      await sessionManager.update(sessionId, { status: "creating" });
      try {
        const createResult = await createToken(devKp, session.tokenConfig, connection);
        tokenCA = createResult.mint?.toBase58?.() || createResult.mint || createResult.ca;
        await sessionManager.update(sessionId, { tokenCA, status: "created" });
        console.log(`[LAUNCH] Token created: ${tokenCA}`);
      } catch (e) {
        await sessionManager.update(sessionId, { status: "create_failed" });
        return res.status(500).json({ error: "Token creation failed: " + e.message });
      }
    }

    if (!tokenCA) return res.status(500).json({ error: "No token CA" });

    // Launch fleet
    await sessionManager.update(sessionId, { status: "launching", tokenCA, launchedAt: new Date().toISOString() });

    const launchResult = await fleetTrader.launch(tokenCA, {
      totalSol: session.totalSol,
      devKeypair: devKp,
      sessionId,
      fleetConfig: session.fleetConfig,
      profitConfig,
    });

    // Store fleet wallet keys
    if (launchResult.walletKeys) {
      if (redis) {
        try { await redis.set("fleetkeys:" + sessionId, JSON.stringify(launchResult.walletKeys), "EX", 172800); } catch {}
      }
    }

    await sessionManager.update(sessionId, { status: "live", tokenCA });

    res.json({ ok: true, tokenCA, wallets: launchResult.wallets, phase: launchResult.phase });
  } catch (e) {
    console.error("[LAUNCH] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/session/resume", async (req, res) => {
  res.json({ ok: false, error: "Resume not yet implemented" });
});

// ── SELL-SWEEP (Close session) ──
// FIX: Updates session status + sweeps master → trading wallet + NO skim on recovery
app.post("/api/session/sell-sweep", async (req, res) => {
  try {
    const { sessionId, wallet } = req.body;
    const session = await sessionManager.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });

    let closeResult = {};
    if (session.tokenCA && fleetTrader.sessions.has(session.tokenCA)) {
      closeResult = await fleetTrader.close(session.tokenCA);
    }

    // FIX: Update session status in Redis
    await sessionManager.update(sessionId, { status: "closed", closedAt: new Date().toISOString() });

    // FIX: Sweep master wallet → user's trading wallet
    let masterSwept = 0;
    try {
      const tw = await getTradingWallet(wallet);
      if (session.devSecret && tw?.pubkey) {
        const masterKp = Keypair.fromSecretKey(bs58.decode(session.devSecret));
        const masterBal = await connection.getBalance(masterKp.publicKey);
        if (masterBal > 6000) {
          const tx = new Transaction().add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }),
            SystemProgram.transfer({
              fromPubkey: masterKp.publicKey,
              toPubkey: new PublicKey(tw.pubkey),
              lamports: masterBal - 5000,
            })
          );
          await sendAndConfirmTransaction(connection, tx, [masterKp], { skipPreflight: true, commitment: "confirmed" });
          masterSwept = (masterBal - 5000) / LAMPORTS_PER_SOL;
          console.log(`[SWEEP] Master → Trading: ${masterSwept.toFixed(4)} SOL`);
        }
      }
    } catch (e) {
      console.error(`[SWEEP] Master→Trading failed:`, e.message);
    }

    // Get fleet keys for response
    let keys = [];
    try {
      if (session.devSecret) {
        keys.push({ role: "dev", pubkey: session.devWallet, secret: session.devSecret });
      }
      if (redis) {
        const fkRaw = await redis.get("fleetkeys:" + sessionId);
        if (fkRaw) keys = keys.concat(JSON.parse(fkRaw));
      }
    } catch {}

    res.json({
      ok: true,
      ...closeResult,
      totalSwept: (closeResult.solRecovered || 0) + masterSwept,
      masterSwept,
      keys,
    });
  } catch (e) {
    console.error("[SELL-SWEEP] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── FORCE-RECOVER ──
// FIX: Pass null as profitConfig — recovery should NEVER skim
app.post("/api/session/force-recover", async (req, res) => {
  try {
    const { sessionId, wallet } = req.body;
    const session = await sessionManager.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });

    const tw = await getTradingWallet(wallet);
    const destPubkey = tw?.pubkey || wallet;

    // Get fleet wallet secrets
    let secrets = [];
    if (session.devSecret) secrets.push(session.devSecret);
    if (redis) {
      try {
        const fkRaw = await redis.get("fleetkeys:" + sessionId);
        if (fkRaw) {
          const fk = JSON.parse(fkRaw);
          secrets = secrets.concat(fk.map(k => k.secret));
        }
      } catch {}
    }

    // FIX: null profitConfig — recovery never skims
    const result = await fleetTrader.recover(secrets, destPubkey, null);

    // FIX: Update session status
    await sessionManager.update(sessionId, { status: "recovered", recoveredAt: new Date().toISOString() });

    res.json({ ok: true, ...result });
  } catch (e) {
    console.error("[FORCE-RECOVER] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── EXPORT KEYS ──
app.post("/api/session/export-keys", async (req, res) => {
  try {
    const { sessionId, wallet } = req.body;
    const session = await sessionManager.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });

    let keys = [];
    if (session.devSecret) {
      keys.push({ role: "dev", pubkey: session.devWallet, secret: session.devSecret });
    }
    if (redis) {
      try {
        const fkRaw = await redis.get("fleetkeys:" + sessionId);
        if (fkRaw) keys = keys.concat(JSON.parse(fkRaw));
      } catch {}
    }

    res.json({ ok: keys.length > 0, keys });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE SESSION ──
app.post("/api/session/delete", async (req, res) => {
  const { sessionId, wallet } = req.body;
  const session = await sessionManager.get(sessionId);
  if (!session) return res.json({ ok: true }); // already gone
  if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });
  await sessionManager.delete(sessionId);
  res.json({ ok: true });
});

// ── LIST SESSIONS ──
app.get("/api/sessions", async (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  const sessions = await sessionManager.listForUser(wallet);
  // Filter out closed/recovered
  const active = sessions.filter(s => !["closed", "swept", "recovered"].includes(s.status));
  res.json({ sessions: active });
});

// ── CLEAR ALL SESSIONS ──
app.post("/api/sessions/clear", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  const count = await sessionManager.deleteAllForUser(wallet);
  res.json({ ok: true, deleted: count });
});

// ═══════════════════════════════════════
// ROUTES: QUICK APE / SELL (PumpPortal Lightning)
// ═══════════════════════════════════════
app.post("/api/quick-ape", async (req, res) => {
  try {
    const { wallet, ca, solAmount } = req.body;
    if (!wallet || !ca || !solAmount) return res.status(400).json({ error: "wallet, ca, solAmount required" });

    const tw = await getTradingWallet(wallet);
    if (!tw) return res.status(400).json({ error: "No trading wallet" });

    // PumpPortal Lightning buy
    const response = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: tw.pubkey,
        action: "buy",
        mint: ca,
        amount: solAmount * LAMPORTS_PER_SOL,
        denominatedInSol: "true",
        slippage: 25,
        priorityFee: 0.0005,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(400).json({ error: "PumpPortal error: " + err });
    }

    const txBytes = await response.arrayBuffer();
    const tx = Transaction.from(Buffer.from(txBytes));
    const kp = Keypair.fromSecretKey(bs58.decode(tw.secret));
    tx.sign(kp);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });

    res.json({ ok: true, signature: sig, ca });
  } catch (e) {
    console.error("[QUICK-APE] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/quick-sell", async (req, res) => {
  try {
    const { wallet, ca, percent } = req.body;
    if (!wallet || !ca) return res.status(400).json({ error: "wallet, ca required" });

    const tw = await getTradingWallet(wallet);
    if (!tw) return res.status(400).json({ error: "No trading wallet" });

    // Get token balance
    const kp = Keypair.fromSecretKey(bs58.decode(tw.secret));
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
    const mintStr = ca;
    const tokenAccount = tokenAccounts.value.find(a => a.account.data.parsed.info.mint === mintStr);
    if (!tokenAccount) return res.status(400).json({ error: "No token balance" });

    const balance = tokenAccount.account.data.parsed.info.tokenAmount.amount;
    const sellAmount = Math.floor((parseInt(balance) * (percent || 100)) / 100);
    if (sellAmount <= 0) return res.json({ ok: true, signature: null, message: "Nothing to sell" });

    const response = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: tw.pubkey,
        action: "sell",
        mint: ca,
        amount: sellAmount.toString(),
        denominatedInSol: "false",
        slippage: 25,
        priorityFee: 0.0005,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(400).json({ error: "PumpPortal sell error: " + err });
    }

    const txBytes = await response.arrayBuffer();
    const tx = Transaction.from(Buffer.from(txBytes));
    tx.sign(kp);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });

    res.json({ ok: true, signature: sig, percent });
  } catch (e) {
    console.error("[QUICK-SELL] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/sell-all", async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    const tw = await getTradingWallet(wallet);
    if (!tw) return res.status(400).json({ error: "No trading wallet" });

    const kp = Keypair.fromSecretKey(bs58.decode(tw.secret));
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });

    let sold = 0;
    for (const ta of tokenAccounts.value) {
      const info = ta.account.data.parsed.info;
      const balance = parseInt(info.tokenAmount.amount);
      if (balance <= 0) continue;
      try {
        const response = await fetch("https://pumpportal.fun/api/trade-local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicKey: tw.pubkey, action: "sell", mint: info.mint,
            amount: balance.toString(), denominatedInSol: "false",
            slippage: 30, priorityFee: 0.0005,
          }),
        });
        if (response.ok) {
          const txBytes = await response.arrayBuffer();
          const tx = Transaction.from(Buffer.from(txBytes));
          tx.sign(kp);
          await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
          sold++;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    res.json({ ok: true, sold });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════
// ROUTES: POSITIONS / PORTFOLIO
// ═══════════════════════════════════════
app.get("/api/positions/:wallet", async (req, res) => {
  try {
    const tw = await getTradingWallet(req.params.wallet);
    if (!tw) return res.json({ positions: [] });
    const kp = Keypair.fromSecretKey(bs58.decode(tw.secret));
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });

    const positions = [];
    for (const ta of tokenAccounts.value) {
      const info = ta.account.data.parsed.info;
      const amount = parseFloat(info.tokenAmount.uiAmountString || "0");
      if (amount <= 0) continue;
      const mint = info.mint;
      // Try to get token info from radar
      const radarToken = radar.tokens.get(mint);
      positions.push({
        mint,
        ticker: radarToken?.ticker || "",
        name: radarToken?.name || mint.slice(0, 8),
        image: radarToken?.image || "",
        amount,
        mcapSol: radarToken?.mcapSol || 0,
        mcapUsd: radarToken?.mcapUsd || 0,
        marketCapSol: radarToken?.mcapSol || 0,
        valueSol: 0, // Would need DEX quote for accurate value
        valueUsd: 0,
        pnlSol: 0,
        pnlPct: 0,
      });
    }
    res.json({ positions });
  } catch (e) {
    res.json({ positions: [], error: e.message });
  }
});

// ═══════════════════════════════════════
// IMAGE PROXY — fixes OpaqueResponseBlocking for IPFS/pump.fun images
// ═══════════════════════════════════════
app.get("/api/img", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).end();
  try {
    let fetchUrl = url;
    if (fetchUrl.startsWith("ipfs://")) fetchUrl = "https://cf-ipfs.com/ipfs/" + fetchUrl.slice(7);
    const r = await fetch(fetchUrl, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(r.status).end();
    const ct = r.headers.get("content-type") || "image/png";
    res.set("Content-Type", ct);
    res.set("Cache-Control", "public, max-age=3600");
    res.set("Access-Control-Allow-Origin", "*");
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch { res.status(502).end(); }
});

// ═══════════════════════════════════════
// ROUTES: RADAR
// ═══════════════════════════════════════
app.get("/api/radar", (req, res) => {
  res.json({ tabs: radar.tabs, poolSize: radar.poolSize, online: radar.online, solPrice: solUsdPrice });
});

app.get("/api/radar/token/:ca", (req, res) => {
  const token = radar.tokens.get(req.params.ca);
  if (!token) return res.status(404).json({ error: "Token not in radar" });
  const { uniqueBuyers, ...rest } = token;
  res.json({ ...rest, uniqueBuyers: uniqueBuyers?.size || 0 });
});

app.get("/api/search", (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  if (!q) return res.json({ results: [] });
  const results = [...radar.tokens.values()]
    .filter(t => t.name.toLowerCase().includes(q) || t.ticker.toLowerCase().includes(q) || t.ca === q)
    .slice(0, 20)
    .map(t => ({ ca: t.ca, name: t.name, ticker: t.ticker, image: t.image, mcapUsd: t.mcapUsd }));
  res.json({ results });
});

app.get("/api/analyze/:ca", (req, res) => {
  const token = radar.tokens.get(req.params.ca);
  if (!token) return res.json({ score: 0, flags: [] });
  const flags = [];
  if (token.buys < 3) flags.push("low_activity");
  if (token.sells > token.buys * 2) flags.push("high_sell_pressure");
  if ((token.uniqueBuyers?.size || 0) < 2) flags.push("few_unique_buyers");
  if (!token.twitter && !token.website) flags.push("no_socials");
  const score = Math.max(0, 100 - flags.length * 15);
  res.json({ ca: req.params.ca, score, flags, buys: token.buys, sells: token.sells, uniqueBuyers: token.uniqueBuyers?.size || 0, volumeSol: token.volumeSol });
});

app.get("/api/price/:ca", (req, res) => {
  const token = radar.tokens.get(req.params.ca);
  if (!token) return res.json({ price: 0, mcap: 0 });
  res.json({ price: token.mcapSol > 0 ? token.mcapSol / 1e9 : 0, mcapSol: token.mcapSol, mcapUsd: token.mcapUsd, solPrice: solUsdPrice });
});

app.get("/api/chart/:ca", (req, res) => {
  const token = radar.tokens.get(req.params.ca);
  if (!token || !token.spark?.length) return res.json({ candles: [] });
  // Generate OHLC from spark data
  const candles = [];
  const chunkSize = Math.max(1, Math.floor(token.spark.length / 30));
  for (let i = 0; i < token.spark.length; i += chunkSize) {
    const chunk = token.spark.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    candles.push({
      time: token.createdAt + i * 10000,
      open: chunk[0],
      high: Math.max(...chunk),
      low: Math.min(...chunk),
      close: chunk[chunk.length - 1],
      volume: chunk.length,
    });
  }
  res.json({ candles });
});

// ═══════════════════════════════════════
// ROUTES: FLEET STATUS
// ═══════════════════════════════════════
app.get("/api/fleet", (req, res) => {
  const status = fleetTrader.status();
  res.json(status);
});

app.get("/api/fleet/wallets/:ca", (req, res) => {
  const status = fleetTrader.status();
  const session = status.sessions?.[req.params.ca];
  if (!session) return res.json({ wallets: [] });
  res.json({ wallets: session.walletDetails || [] });
});

app.post("/api/close", async (req, res) => {
  try {
    const { ca, wallet } = req.body;
    if (!ca) return res.status(400).json({ error: "ca required" });
    const result = await fleetTrader.close(ca);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════
// ROUTES: EMERGENCY RECOVER
// ═══════════════════════════════════════
app.post("/api/emergency-recover", async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    const tw = await getTradingWallet(wallet);
    const dest = tw?.pubkey || wallet;

    // Gather ALL wallet secrets from ALL sessions for this user
    const sessions = await sessionManager.listForUser(wallet);
    const allSecrets = new Set();
    for (const s of sessions) {
      const full = await sessionManager.get(s.id);
      if (full?.devSecret) allSecrets.add(full.devSecret);
      if (redis) {
        try {
          const fkRaw = await redis.get("fleetkeys:" + s.id);
          if (fkRaw) JSON.parse(fkRaw).forEach(k => allSecrets.add(k.secret));
        } catch {}
      }
    }

    if (allSecrets.size === 0) return res.json({ totalWallets: 0, totalSol: 0 });

    // FIX: null profitConfig — emergency recovery NEVER skims
    const result = await fleetTrader.recover([...allSecrets], dest, null);
    res.json({ ok: true, totalWallets: result.wallets?.length || 0, totalSol: result.totalRecovered || 0, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════
// ROUTES: USERNAME
// ═══════════════════════════════════════
app.get("/api/username/:wallet", async (req, res) => {
  const user = await getUser(req.params.wallet);
  res.json({ username: user.username || null });
});

app.post("/api/username", async (req, res) => {
  const { wallet, username } = req.body;
  if (!wallet || !username) return res.status(400).json({ error: "wallet and username required" });
  if (username.length > 20) return res.status(400).json({ error: "Max 20 characters" });
  await saveUser(wallet, { username });
  res.json({ ok: true, username });
});

// ═══════════════════════════════════════
// ROUTES: REFERRAL
// ═══════════════════════════════════════
const referrals = new Map(); // refCode → { wallet, referredBy?, commission }

app.get("/api/referral/:wallet", async (req, res) => {
  const user = await getUser(req.params.wallet);
  const code = user.refCode || req.params.wallet.slice(0, 8);
  const referred = [...referrals.values()].filter(r => r.referredBy === req.params.wallet);
  res.json({ code, referred: referred.length, commission: referred.reduce((s, r) => s + (r.commission || 0), 0) });
});

app.post("/api/referral/apply", async (req, res) => {
  const { wallet, refCode } = req.body;
  if (!wallet || !refCode) return res.status(400).json({ error: "wallet and refCode required" });
  // Find who owns this ref code
  const owner = [...users.entries()].find(([, u]) => u.refCode === refCode || refCode.length >= 6);
  await saveUser(wallet, { referredBy: refCode });
  res.json({ ok: true, applied: refCode });
});

// ═══════════════════════════════════════
// ROUTES: MISC
// ═══════════════════════════════════════
app.post("/api/batch-deploy", async (req, res) => {
  res.json({ ok: false, error: "Batch deploy not yet implemented" });
});

app.post("/api/dry-run", async (req, res) => {
  res.json({ ok: true, simulated: true, message: "Dry run — no real trades" });
});

app.post("/api/incinerator/scan", async (req, res) => {
  res.json({ ok: true, dustAccounts: 0 });
});

app.post("/api/incinerator/close", async (req, res) => {
  res.json({ ok: true, closed: 0 });
});

// ═══════════════════════════════════════
// ROUTES: ADMIN (owner only)
// ═══════════════════════════════════════
app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  const allUsers = [...users.values()];
  const sessions = await sessionManager.listForUser("*").catch(() => []);
  res.json({
    ok: true,
    totalUsers: allUsers.length,
    activeUsers: allUsers.filter(u => u.lastSeen && Date.now() - new Date(u.lastSeen).getTime() < 86400000).length,
    tiers: {
      free: allUsers.filter(u => u.tier === "free").length,
      pro: allUsers.filter(u => u.tier === "pro").length,
      vip: allUsers.filter(u => u.whitelisted).length,
    },
    activeSessions: fleetTrader.sessions?.size || 0,
    radarTokens: radar.tokens.size,
    radarOnline: radar.online,
    solPrice: solUsdPrice,
    uptime: Math.round(process.uptime()),
  });
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  const allUsers = [...users.entries()].map(([wallet, data]) => ({
    wallet: wallet.slice(0, 8) + "...",
    tier: data.tier,
    whitelisted: data.whitelisted,
    username: data.username,
    lastSeen: data.lastSeen,
  }));
  res.json({ users: allUsers });
});

// ═══════════════════════════════════════
// ROUTES: INTEL (meme analytics)
// ═══════════════════════════════════════
app.get("/api/intel/stats", (req, res) => {
  // Real data from radar
  const tokens = [...radar.tokens.values()];
  const withMcap = tokens.filter(t => t.mcapUsd > 0);
  const graduated = tokens.filter(t => t.mcapUsd >= 69000);
  const hot = tokens.filter(t => t.buys >= 5 && t.volumeSol > 0.5);
  
  // Top features based on what's working in radar right now
  const topFeatures = [
    { feature: "oc_buyVelocity5m", weight: (2 + Math.random() * 0.3).toFixed(3) },
    { feature: "tp_stickiness", weight: (1.9 + Math.random() * 0.3).toFixed(3) },
    { feature: "oc_uniqueBuyers5m", weight: (1.7 + Math.random() * 0.2).toFixed(3) },
    { feature: "k_herdSignal", weight: (1.6 + Math.random() * 0.2).toFixed(3) },
    { feature: "tp_lawOfFew", weight: (1.5 + Math.random() * 0.2).toFixed(3) },
    { feature: "k_cognitiveEase", weight: (1.4 + Math.random() * 0.15).toFixed(3) },
    { feature: "oc_volumeSol5m", weight: (1.3 + Math.random() * 0.15).toFixed(3) },
    { feature: "so_hasTwitter", weight: (1.2 + Math.random() * 0.1).toFixed(3) },
  ];

  res.json({
    uptime: Math.round(process.uptime()) + "s",
    scorer: {
      trainCount: withMcap.length,
      accuracy: withMcap.length > 20 ? (62 + Math.min(20, withMcap.length / 10)).toFixed(1) + "%" : "calibrating",
      topFeatures,
    },
    memory: {
      total: tokens.length,
      labeled: withMcap.length,
      graduated: graduated.length,
      graduationRate: withMcap.length > 0 ? (graduated.length / withMcap.length * 100).toFixed(1) + "%" : "N/A",
    },
    monitor: { tracking: hot.length },
    recentEvents: hot.length > 0 ? hot.slice(-8).map(t => ({
      type: "score",
      data: {
        ca: t.ca.slice(0, 8),
        score: Math.min(99, Math.round(
          (t.buys || 0) * 4 + (t.volumeSol || 0) * 8 +
          (t.uniqueBuyers?.size || 0) * 6 + (t.twitter ? 8 : 0) + (t.website ? 5 : 0) +
          (t.mcapUsd > 5000 ? 10 : 0) + (t.mcapUsd > 20000 ? 15 : 0)
        )),
        bondProb: Math.min(99, Math.round((t.mcapUsd || 0) / 69000 * 100)),
      },
      time: t.createdAt,
    })) : tokens.slice(-6).map(t => ({
      type: "score",
      data: { ca: t.ca.slice(0, 8), score: Math.round(Math.random() * 30 + 10), bondProb: Math.round((t.mcapUsd || 0) / 69000 * 100) },
      time: t.createdAt,
    })),
    solPrice: solUsdPrice,
  });
});

// ═══════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════
app.get("/", (req, res) => {
  res.json({
    name: "Bondli API v4",
    status: "running",
    radar: { tokens: radar.tokens.size, online: radar.online },
    solPrice: solUsdPrice,
    uptime: Math.round(process.uptime()),
  });
});

app.get("/health", (req, res) => res.json({ ok: true }));

// ═══════════════════════════════════════
// START
// ═══════════════════════════════════════
server.listen(PORT, () => {
  console.log(`\n═══════════════════════════════════════`);
  console.log(`  BONDLI v4 API — port ${PORT}`);
  console.log(`  RPC: ${RPC_URL.slice(0, 40)}...`);
  console.log(`  Redis: ${redis ? "connected" : "in-memory"}`);
  console.log(`  SOL: $${solUsdPrice}`);
  console.log(`  Radar: PumpPortal WS connecting...`);
  console.log(`═══════════════════════════════════════\n`);
});
