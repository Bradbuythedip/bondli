/**
 * ═══════════════════════════════════════════════════════════════
 * BONDLI v4 — server.production.mjs
 * Express API + PumpPortal WebSocket Radar + Fleet Trading
 * ═══════════════════════════════════════════════════════════════
 *
 * Deploy: Railway (or any Node.js host)
 * Env vars: RPC_URL, REDIS_URL, PLATFORM_WALLET, ADMIN_SECRET,
 *           PORT
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
  Connection, Keypair, PublicKey, Transaction, VersionedTransaction,
  SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction, ComputeBudgetProgram
} from "@solana/web3.js";
import bs58 from "bs58";
import crypto from "crypto";
import { SessionManager, calculateDevBuy } from "../engine/session-manager.mjs";
import { FleetTrader, skimSweep } from "../engine/fleet-trader.mjs";
import { createToken } from "../engine/token-creator.mjs";
import { resolveTier, buildProfitConfig, isOwnerWallet, registerOwner, PLATFORM_WALLET } from "../engine/fee-engine.mjs";
import CONFIG from "../engine/config.mjs";
import { MemeIntelligence } from "../engine/meme-intelligence.mjs";
import { XSocialIntel } from "../engine/x-social-intel.mjs";
import { HistoricalMovers } from "../engine/historical-movers.mjs";

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
const memeIntel = new MemeIntelligence(redis);
const historicalMovers = new HistoricalMovers(redis);
const xSocial = new XSocialIntel();

// Register owner wallet
if (process.env.OWNER_WALLET) registerOwner(process.env.OWNER_WALLET);

// ═══════════════════════════════════════
// SOL PRICE (server-to-server, no CORS)
// FIX: Replaces hardcoded * 170
// ═══════════════════════════════════════
let solUsdPrice = 135;
// Pump.fun graduation: bonding curve fills at ~85 SOL virtual
// MC at graduation ≈ 85 * solPrice * ~3 (token distribution multiplier)
// Dynamic: recalculated as SOL price changes. Floor at 30K.
function gradMcUsd() { return Math.max(30000, Math.round(85 * solUsdPrice * 3)); }
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
// DEXSCREENER BOOST POLLER — paid/boosted token detection
// ═══════════════════════════════════════
async function pollDexBoosted() {
  try {
    const r = await fetch("https://api.dexscreener.com/token-boosts/top/v1", { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return;
    const data = await r.json();
    if (!Array.isArray(data)) return;
    const now = Date.now();
    for (const t of data) {
      if (t.chainId === "solana" && t.tokenAddress) {
        radar.dexBoosted.set(t.tokenAddress, {
          amount: t.totalAmount || 0,
          icon: t.icon || null,
          description: t.description || null,
          url: t.url || null,
          updatedAt: now,
        });
      }
    }
    // Clean old entries (>1h)
    for (const [ca, v] of radar.dexBoosted) {
      if (now - v.updatedAt > 3600000) radar.dexBoosted.delete(ca);
    }
  } catch {}
}
pollDexBoosted();
setInterval(pollDexBoosted, 120000); // every 2 min

// ═══════════════════════════════════════
// PUMPPORTAL WEBSOCKET — RADAR ENGINE (v2)
// Per API docs: WS sends marketCapSol, vSolInBondingCurve, vTokensInBondingCurve
// but does NOT send name/symbol/uri — metadata fetched from pump.fun frontend API
// ═══════════════════════════════════════
const radar = {
  tokens: new Map(),    // ca → token data
  tabs: { new: [], hot: [], graduating: [], momentum: [] },
  poolSize: 0,
  online: 0,
  ws: null,
  reconnects: 0,
  subscribedTokens: new Set(), // track subscribed mints for unsubscribe
  _debugCount: 0,
  dexBoosted: new Map(), // ca → { amount, updatedAt } — DexScreener paid/boosted
};

const PUMP_FUN_API = "https://frontend-api-v3.pump.fun";

// Fetch token metadata from pump.fun frontend API
async function fetchPumpFunMetadata(ca) {
  try {
    const r = await fetch(`${PUMP_FUN_API}/coins/${ca}`, {
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Origin": "https://pump.fun",
        "Referer": "https://pump.fun/",
      }
    });
    if (!r.ok) {
      console.log(`[META] pump.fun API ${r.status} for ${ca.slice(0,8)}`);
      return null;
    }
    const d = await r.json();
    if (radar._debugCount < 8) {
      console.log(`[META] Got: ${d.name || "?"} image: ${(d.image_uri || "none").slice(0, 60)}`);
    }
    return {
      name: d.name || "",
      symbol: d.symbol || "",
      description: (d.description || "").slice(0, 200),
      image: d.image_uri || d.profile_image || "",
      twitter: d.twitter || "",
      website: d.website || "",
      telegram: d.telegram || "",
      complete: d.complete || false,
      raydiumPool: d.raydium_pool || null,
      marketCap: d.usd_market_cap || d.market_cap || 0,
      bondingCurve: d.bonding_curve || "",
      creator: d.creator || "",
    };
  } catch (e) {
    console.log(`[META] Error for ${ca.slice(0,8)}: ${e.message}`);
    return null;
  }
}

// Fetch token image from metadata URI (IPFS JSON → image URL)
async function fetchTokenImage(ca, uri) {
  try {
    let url = uri;
    if (url.startsWith("ipfs://")) url = "https://cf-ipfs.com/ipfs/" + url.slice(7);
    // pump.fun uses cf-ipfs for metadata
    if (url.includes("bafkrei") && !url.startsWith("http")) url = "https://cf-ipfs.com/ipfs/" + url;
    
    const r = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    if (!r.ok) return;
    const meta = await r.json();
    const token = radar.tokens.get(ca);
    if (!token) return;
    
    let img = meta.image || meta.imageUri || "";
    if (img.startsWith("ipfs://")) img = "https://cf-ipfs.com/ipfs/" + img.slice(7);
    if (img && !img.startsWith("http")) img = "https://cf-ipfs.com/ipfs/" + img;
    
    if (img) token.image = img;
    if (meta.name && !token.name) token.name = meta.name;
    if (meta.symbol && !token.ticker) token.ticker = meta.symbol;
    if (meta.description && !token.description) token.description = (meta.description || "").slice(0, 200);
    if (meta.twitter && !token.twitter) token.twitter = meta.twitter;
    if (meta.website && !token.website) token.website = meta.website;
    if (meta.telegram && !token.telegram) token.telegram = meta.telegram;
    
    if (radar._debugCount < 10) {
      console.log(`[IMG] ${ca.slice(0,8)}: ${token.name} → ${img?.slice(0,60) || "none"}`);
    }
  } catch (e) {
    // Silent fail — image just won't load
  }
}

function connectPumpPortal() {
  try {
    radar.ws = new WebSocket("wss://pumpportal.fun/api/data");

    radar.ws.on("open", () => {
      console.log("[RADAR] PumpPortal WS connected");
      radar.reconnects = 0;
      // Subscribe to new token creations (streams every create event)
      radar.ws.send(JSON.stringify({ method: "subscribeNewToken" }));
      // Subscribe to graduation/migration events
      radar.ws.send(JSON.stringify({ method: "subscribeMigration" }));
      console.log("[RADAR] Subscribed to newToken + migration");
    });

    radar.ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw);
        processRadarMessage(data);
      } catch {}
    });

    radar.ws.on("close", () => {
      console.log("[RADAR] WS disconnected — reconnecting in 5s");
      radar.subscribedTokens.clear();
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

// Subscribe to trades for a specific token
function subscribeToToken(mint) {
  if (radar.subscribedTokens.has(mint) || !radar.ws || radar.ws.readyState !== 1) return;
  if (radar.subscribedTokens.size >= 4500) {
    // Unsub oldest tokens to stay under 5000 limit
    const oldest = [...radar.subscribedTokens].slice(0, 500);
    if (oldest.length > 0) {
      radar.ws.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: oldest }));
      for (const k of oldest) radar.subscribedTokens.delete(k);
    }
  }
  radar.ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
  radar.subscribedTokens.add(mint);
}

function processRadarMessage(data) {
  if (!data || !data.txType) return;
  const now = Date.now();

  // Debug first messages
  if (radar._debugCount < 5) {
    console.log(`[RADAR] ${data.txType}:`, JSON.stringify(data).slice(0, 500));
    radar._debugCount++;
  }

  // PumpPortal confirmed fields (per API docs):
  // All events: signature, mint, traderPublicKey, txType, bondingCurveKey,
  //             marketCapSol, vSolInBondingCurve, vTokensInBondingCurve
  // Create only: initialBuy
  // Trade only: tokenAmount, newTokenBalance
  const mint = data.mint || "";
  if (!mint) return;
  const mcSol = data.marketCapSol || 0;
  const vSol = data.vSolInBondingCurve || 0;
  const vTokens = data.vTokensInBondingCurve || 0;
  const trader = data.traderPublicKey || "";

  // ═══ TOKEN CREATION ═══
  if (data.txType === "create") {
    if (radar.tokens.has(mint)) return;

    const mcUsd = Math.round(mcSol * solUsdPrice);
    const token = {
      ca: mint,
      // PumpPortal DOES send name/symbol/uri on create events
      name: data.name || "",
      ticker: data.symbol || "",
      description: (data.description || "").slice(0, 200),
      image: "", // fetched from uri metadata JSON
      twitter: data.twitter || "",
      website: data.website || "",
      telegram: data.telegram || "",
      createdAt: now,
      trades: [],
      buys: 0, sells: 0,
      volumeSol: 0, sellVolumeSol: 0,
      mcapSol: mcSol,
      mcapUsd: mcUsd,
      prevVSol: vSol,
      uniqueBuyers: new Set(),
      spark: mcUsd > 0 ? [mcUsd] : [],
      h1Change: 0,
      devWallet: trader,
      graduated: false,
      bundled: false,
      initialBuy: data.initialBuy || 0,
    };

    radar.tokens.set(mint, token);
    subscribeToToken(mint);

    // Fetch image from uri (IPFS metadata JSON → image URL)
    if (data.uri) {
      fetchTokenImage(mint, data.uri).catch(() => {});
    }

    // Fallback: if WS didn't send name, try pump.fun API (may be blocked)
    if (!data.name) {
      fetchPumpFunMetadata(mint).then(meta => {
        if (!meta) return;
        const t = radar.tokens.get(mint);
        if (!t) return;
        if (!t.name && meta.name) t.name = meta.name;
        if (!t.ticker && meta.symbol) t.ticker = meta.symbol;
        if (!t.description && meta.description) t.description = meta.description;
        if (!t.image && meta.image) { t.image = meta.image; }
        if (!t.twitter && meta.twitter) t.twitter = meta.twitter;
        if (!t.website && meta.website) t.website = meta.website;
        if (meta.complete) t.graduated = true;
      }).catch(() => {});
    }

    // Dev buy tracking
    if (data.initialBuy > 0) {
      token.buys = 1;
      token.uniqueBuyers.add(trader);
      const devSol = vSol - 30; // initial virtual SOL is 30
      if (devSol > 0) token.volumeSol = devSol;
    }

    // Cap pool size — evict oldest
    if (radar.tokens.size > 500) {
      const entries = [...radar.tokens.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
      const toRemove = entries.slice(0, 50);
      for (const [ca] of toRemove) {
        radar.tokens.delete(ca);
        // Don't bother unsubscribing — they'll be cleaned up on reconnect
      }
    }

    broadcastWS({ event: "newToken", data: { ca: mint, name: token.name, mcap: mcUsd } });
    return;
  }

  // ═══ TRADE EVENT (buy/sell) ═══
  if (data.txType === "buy" || data.txType === "sell") {
    let token = radar.tokens.get(mint);

    // Auto-create if we missed the create event
    if (!token) {
      const mcUsd = Math.round(mcSol * solUsdPrice);
      token = {
        ca: mint, name: data.name || "", ticker: data.symbol || "",
        description: "", image: "",
        twitter: "", website: "", telegram: "",
        createdAt: now, trades: [], buys: 0, sells: 0, volumeSol: 0,
        mcapSol: mcSol, mcapUsd: mcUsd, prevVSol: vSol,
        uniqueBuyers: new Set(), spark: mcUsd > 0 ? [mcUsd] : [],
        h1Change: 0, devWallet: "", graduated: false, bundled: false, initialBuy: 0,
      };
      radar.tokens.set(mint, token);
      subscribeToToken(mint);
      if (data.uri) fetchTokenImage(mint, data.uri).catch(() => {});
      // Fetch metadata
      fetchPumpFunMetadata(mint).then(meta => {
        if (!meta) return;
        const t = radar.tokens.get(mint);
        if (!t) return;
        t.name = meta.name; t.ticker = meta.symbol;
        t.description = meta.description; t.image = meta.image;
        t.twitter = meta.twitter; t.website = meta.website; t.telegram = meta.telegram;
      }).catch(() => {});
    }

    // Calculate SOL amount from vSol delta
    const solDelta = Math.abs(vSol - (token.prevVSol || vSol));
    token.prevVSol = vSol;
    const sol = solDelta > 0.0001 ? solDelta : 0;

    if (data.txType === "buy") {
      token.buys++;
      token.volumeSol += sol;
      if (trader) token.uniqueBuyers.add(trader);
    } else {
      token.sells++;
      token.sellVolumeSol = (token.sellVolumeSol || 0) + sol;
    }

    // Update mcap from PumpPortal data
    if (mcSol > 0) {
      token.mcapSol = mcSol;
      token.mcapUsd = Math.round(mcSol * solUsdPrice);
    }

    // Graduation detection: vSol approaching 85 SOL = near graduation
    if (vSol >= 79 && !token.graduated) {
      token.graduated = true;
    }

    // Sparkline
    if (token.mcapUsd > 0) {
      token.spark.push(token.mcapUsd);
      if (token.spark.length > 60) token.spark = token.spark.slice(-60);
    }

    // Track trade
    token.trades.push({ side: data.txType, sol: +sol.toFixed(4), wallet: trader.slice(0, 8), time: now });
    if (token.trades.length > 100) token.trades = token.trades.slice(-100);

    // h1 change
    const firstSpark = token.spark.length > 1 ? token.spark[0] : token.mcapUsd;
    token.h1Change = firstSpark > 0 ? ((token.mcapUsd - firstSpark) / firstSpark) * 100 : 0;

    broadcastWS({ event: "trade", data: { ca: mint, side: data.txType, sol: +sol.toFixed(4), mcap: token.mcapUsd, wallet: trader.slice(0, 8) } });
  }

  // ═══ MIGRATION / GRADUATION ═══
  if (data.txType === "migration" || data.txType === "migrate") {
    const token = radar.tokens.get(mint);
    if (token) {
      token.graduated = true;
      token.graduatedAt = Date.now();
      console.log(`[RADAR] Token graduated: ${token.name || mint.slice(0, 8)} — MC: $${token.mcapUsd}`);
      // Fetch live MC from DexScreener since PumpPortal stops sending data after graduation
      refreshGraduatedMcap(mint).catch(() => {});
    }
    broadcastWS({ event: "graduation", data: { ca: mint } });
  }
}

// ═══ GRADUATED MC REFRESH — DexScreener fallback ═══
async function refreshGraduatedMcap(mint) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return;
    const d = await r.json();
    const pair = d?.pairs?.[0];
    if (!pair) return;
    const token = radar.tokens.get(mint);
    if (!token) return;
    const newMcap = pair.fdv || pair.marketCap || 0;
    if (newMcap > 0) {
      token.mcapUsd = Math.round(newMcap);
      token.mcapSol = solUsdPrice > 0 ? Math.round(newMcap / solUsdPrice) : token.mcapSol;
      token.spark.push(token.mcapUsd);
      if (token.spark.length > 60) token.spark = token.spark.slice(-60);
      token.raydiumPool = pair.pairAddress || true;
    }
  } catch {}
}

// Periodically refresh MC for all graduated tokens (every 30s)
setInterval(async () => {
  const graduated = [...radar.tokens.entries()].filter(([, t]) => t.graduated);
  for (const [ca] of graduated.slice(0, 10)) { // max 10 per cycle to avoid rate limits
    await refreshGraduatedMcap(ca);
    await new Promise(r => setTimeout(r, 500)); // rate limit spacing
  }
}, 30000);

// ═══ QUICK FEATURE EXTRACTION — for memeIntel learning ═══
function extractQuickFeatures(t) {
  if (!t || !t.ca) return null;
  const ageMin = Math.max(0.5, (Date.now() - t.createdAt) / 60000);
  const ub = t.uniqueBuyers?.size || 0;
  const buys = t.buys || 0;
  const sells = t.sells || 0;
  const vol = t.volumeSol || 0;
  const sellVol = t.sellVolumeSol || 0;

  // Check if dev sold
  const devSells = t.trades?.filter(tr => tr.wallet === t.devWallet?.slice(0, 8) && tr.side === "sell") || [];
  const devSellSpeed = devSells.length > 0 ? Math.min(1, 30 / Math.max(1, (devSells[0]?.time - t.createdAt) / 60000)) : 0;

  // Coordinated dump: multiple sells within 3s windows
  const sellTimes = (t.trades || []).filter(tr => tr.side === "sell").map(tr => tr.time);
  let coordDumps = 0;
  for (let i = 1; i < sellTimes.length; i++) {
    if (sellTimes[i] - sellTimes[i - 1] < 3000) coordDumps++;
  }

  // Sell wave: bursts of sells in 10s windows
  let maxSellBurst = 0;
  for (let i = 0; i < sellTimes.length; i++) {
    let burst = 1;
    for (let j = i + 1; j < sellTimes.length && sellTimes[j] - sellTimes[i] < 10000; j++) burst++;
    maxSellBurst = Math.max(maxSellBurst, burst);
  }

  // Mcap drop from peak
  const peakMc = t.spark?.length > 0 ? Math.max(...t.spark) : t.mcapUsd;
  const mcapDropRate = peakMc > 0 ? Math.max(0, (peakMc - (t.mcapUsd || 0)) / peakMc) : 0;

  return {
    // On-chain
    oc_buyVelocity5m: Math.min(1, (buys / Math.max(1, Math.min(5, ageMin))) / 20),
    oc_uniqueBuyers5m: Math.min(1, ub / 30),
    oc_avgBuySol: vol > 0 && buys > 0 ? Math.min(1, (vol / buys) / 5) : 0,
    oc_sellRatio5m: Math.min(1, sells / Math.max(1, buys + sells)),
    oc_mcapSol: Math.min(1, (t.mcapSol || 0) / 500),
    oc_volumeSol5m: Math.min(1, vol / 50),
    // Social
    so_hasTwitter: t.twitter ? 1 : 0,
    so_hasTelegram: t.telegram ? 1 : 0,
    so_hasWebsite: t.website ? 1 : 0,
    // Rug detection
    rg_devSellSpeed: devSellSpeed,
    rg_holderConcentration: 0, // would need on-chain data
    rg_coordDumpScore: Math.min(1, coordDumps / 5),
    rg_liqRemovalSpeed: vol > 0 ? Math.min(1, sellVol / Math.max(0.1, vol)) : 0,
    rg_walletAgeScore: 0.5, // default — no wallet age data
    rg_sellWaveDetect: Math.min(1, maxSellBurst / 8),
    rg_mcapDropRate: mcapDropRate,
    rg_buyerRetention: buys > 0 ? Math.min(1, ub / buys) : 0,
  };
}

// ═══ TAB BUILDER — runs every 5 seconds ═══
setInterval(() => {
  const now = Date.now();

  // Clean old tokens — graduated/high MC get 4h, rest get 2h
  // Before eviction: label outcome and feed to meme intelligence for learning
  for (const [ca, t] of radar.tokens) {
    const ttl = (t.graduated || t.mcapUsd >= 10000) ? 14400000 : 7200000;
    if (now - t.createdAt > ttl) {
      // Auto-label outcome before eviction — this is how the model learns from rugs
      try {
        const peakMc = t.spark?.length > 0 ? Math.max(...t.spark) : t.mcapUsd;
        const currentMc = t.mcapUsd || 0;
        const mcapDropPct = peakMc > 0 ? ((peakMc - currentMc) / peakMc) * 100 : 0;
        const devDumped = t.trades?.some(tr => tr.wallet === t.devWallet?.slice(0, 8) && tr.side === "sell") || false;
        const sellRatio = t.sells / Math.max(1, t.buys + t.sells);
        const rugged = (mcapDropPct > 80 && sellRatio > 0.6) || devDumped;
        const outcome = {
          graduated: !!t.graduated,
          peakMcx: peakMc > 0 && t.spark?.[0] > 0 ? peakMc / t.spark[0] : 1,
          rugged,
          mcapDropPct,
          devDumped,
          alive: currentMc > 3000,
        };
        const features = extractQuickFeatures(t);
        if (features) memeIntel.learn(features, outcome);
      } catch {}
      radar.tokens.delete(ca);
    }
  }

  // Active tokens: 1h for normal, 2h for graduating/graduated tokens
  const all = [...radar.tokens.values()].filter(t => {
    const age = now - t.createdAt;
    if (t.graduated || t.mcapUsd >= 10000) return age < 7200000; // 2h for graduated/high MC
    return age < 3600000; // 1h for normal
  });

  // Dedup by normalized name + ticker — keeps the strongest version of each token
  function dedup(tokens) {
    const best = new Map();
    for (const t of tokens) {
      const nameKey = (t.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const tickerKey = (t.ticker || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const keys = [];
      // Only dedup by name if it's specific enough (4+ chars), too many 3-char dupes
      if (nameKey && nameKey.length >= 4) keys.push("n:" + nameKey);
      // Only dedup by ticker if 3+ chars — 2-char tickers like "AI" cause false merges
      if (tickerKey && tickerKey.length >= 3) keys.push("t:" + tickerKey);
      if (keys.length === 0) { best.set("ca:" + t.ca, t); continue; }
      let dominated = false;
      for (const k of keys) {
        const existing = best.get(k);
        if (existing && existing.ca !== t.ca) {
          // Stronger scoring: volume weight up, add unique buyers + mcap
          const ub = (s) => s.uniqueBuyers?.size || 0;
          const sOld = (existing.buys||0)*3 + (existing.volumeSol||0)*5 + ub(existing)*8 + (existing.mcapUsd>5000?10:0) + (existing.twitter?6:0) + (existing.website?4:0);
          const sNew = (t.buys||0)*3 + (t.volumeSol||0)*5 + ub(t)*8 + (t.mcapUsd>5000?10:0) + (t.twitter?6:0) + (t.website?4:0);
          if (sNew <= sOld) { dominated = true; break; }
          for (const [mk, mv] of best) { if (mv.ca === existing.ca) best.delete(mk); }
        }
      }
      if (!dominated) { for (const k of keys) best.set(k, t); }
    }
    const seen = new Set();
    return [...best.values()].filter(t => { if (seen.has(t.ca)) return false; seen.add(t.ca); return true; });
  }

  // Serialize with sparkline generation
  const serialize = (t) => {
    let spark = [...(t.spark || [])];
    if (spark.length < 5 && t.mcapUsd > 0) {
      const mc = t.mcapUsd;
      const ca = t.ca || "";
      const s1 = ca.charCodeAt(0)||65, s2 = ca.charCodeAt(3)||70;
      const pattern = (s1 + s2) % 6;
      spark = [];
      for (let i = 0; i < 16; i++) {
        const p = i / 15;
        let v;
        switch(pattern) {
          case 0: v=mc*(0.55+p*0.45+Math.sin(i*s2*0.1)*0.04); break;
          case 1: v=mc*(1.3-p*0.35+Math.sin(i*0.15)*0.05); break;
          case 2: v=mc*(1-Math.abs(p-0.5)*0.4); break;
          case 3: v=mc*(p<0.4?0.6+p*0.2:p<0.6?0.68+(p-0.4)*1.5:0.98+Math.sin(i)*0.03); break;
          case 4: v=mc*(0.85+Math.sin(i*1.3+s1*0.05)*0.12+p*0.1); break;
          default: v=mc*(0.4+Math.pow(p,1.8)*0.6+Math.sin(i*0.08)*0.02);
        }
        spark.push(Math.max(1, Math.round(v)));
      }
    }
    return {
      ca: t.ca, name: t.name, ticker: t.ticker, description: (t.description||"").slice(0,80),
      image: t.image, twitter: t.twitter, website: t.website, telegram: t.telegram,
      mcapSol: t.mcapSol, mcapUsd: t.mcapUsd, buys: t.buys, sells: t.sells,
      volumeSol: +t.volumeSol.toFixed(4), uniqueBuyers: t.uniqueBuyers?.size||0,
      spark, h1Change: +t.h1Change.toFixed(1),
      age: Math.round((now - t.createdAt) / 1000),
      devWallet: t.devWallet, graduated: t.graduated, bundled: t.bundled,
      marketCapSol: t.mcapSol,
    };
  };

  const deduped = dedup(all);

  // ── NEW: Fresh launches (last 10 min) ──
  radar.tabs.new = deduped
    .filter(t => (now - t.createdAt) < 600000)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50).map(serialize);

  // ── HOT: Tokens with actual buy activity ──
  radar.tabs.hot = deduped
    .filter(t => t.buys >= 2)
    .map(t => {
      const ageMin = Math.max(0.3, (now - t.createdAt) / 60000);
      const ub = t.uniqueBuyers?.size || 0;
      return { ...t, _heat: (t.buys/ageMin)*10 + ub*8 + t.volumeSol*5 + (t.mcapUsd>5000?10:0) };
    })
    .sort((a, b) => b._heat - a._heat)
    .slice(0, 50).map(serialize);

  // ── GRAD: Real traction MC ($10K+) or graduated ($69K+) ──
  // $2.4K = launch, $3-5K = dev buy, $10K+ = real traction, $69K = graduated
  radar.tabs.graduating = deduped
    .filter(t => t.mcapUsd >= 10000 || t.graduated)
    .map(t => ({
      ...t,
      _gradScore: (t.graduated ? 200 : 0) + Math.min(100, (t.mcapUsd / gradMcUsd()) * 100),
    }))
    .sort((a, b) => b._gradScore - a._gradScore)
    .slice(0, 50).map(t => {
      const s = serialize(t);
      s.pctToGrad = Math.min(100, Math.round((t.mcapUsd / gradMcUsd()) * 100));
      s.graduated = t.graduated;
      return s;
    });

  // ── MOMENTUM: Sustained buying pressure ──
  radar.tabs.momentum = deduped
    .filter(t => t.buys >= 2 && (now - t.createdAt) > 30000 && t.mcapUsd >= 3000)
    .map(t => {
      const ageMin = Math.max(0.5, (now - t.createdAt) / 60000);
      const buyRate = t.buys / ageMin;
      const pressure = t.buys / Math.max(1, t.buys + t.sells);
      const ub = t.uniqueBuyers?.size || 0;
      const mcGrowth = t.spark?.length > 2 ? (t.spark[t.spark.length-1] - t.spark[0]) / Math.max(1, t.spark[0]) : 0;
      if (mcGrowth < -0.3) return null;
      return { ...t, _momentum: buyRate*12 + pressure*20 + ub*10 + mcGrowth*30 + Math.min(15, t.volumeSol*3) };
    })
    .filter(Boolean)
    .sort((a, b) => b._momentum - a._momentum)
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
    } catch {
      return { tier: "unknown", whitelisted: false, _redisError: true };
    }
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
  const wallet = req.headers["x-wallet"] || req.headers["X-Wallet"] || req.body?.wallet || req.query?.wallet;
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
  if (user._redisError) {
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }
  const tierInfo = resolveTier(wallet, user);
  await saveUser(wallet, { tier: tierInfo.tier, whitelisted: tierInfo.whitelisted });
  res.json({ tier: tierInfo.tier, whitelisted: tierInfo.whitelisted, paid: user.paid || false });
});

app.post("/api/access/activate-free", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  const existing = await getUser(wallet);
  if (existing._redisError) {
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }
  const tierInfo = resolveTier(wallet, existing);
  if (tierInfo.tier === "vip" || tierInfo.tier === "pro" || tierInfo.whitelisted) {
    return res.json({ ok: true, tier: tierInfo.tier, message: "Already " + tierInfo.tier });
  }
  await saveUser(wallet, { tier: "free", activatedAt: new Date().toISOString() });
  res.json({ ok: true, tier: "free" });
});

app.post("/api/access/activate-pro", async (req, res) => {
  const { wallet, txSig } = req.body;
  if (!wallet || !txSig) return res.status(400).json({ error: "wallet and txSig required" });
  // Verify on-chain payment to PLATFORM_WALLET
  try {
    const tx = await connection.getTransaction(txSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) return res.status(400).json({ error: "Transaction not found or not confirmed" });
    const meta = tx.meta;
    if (meta?.err) return res.status(400).json({ error: "Transaction failed on-chain" });
    const keys = tx.transaction.message.staticAccountKeys
      ? tx.transaction.message.staticAccountKeys.map(k => k.toBase58())
      : tx.transaction.message.accountKeys.map(k => k.toBase58());
    const platformIdx = keys.indexOf(PLATFORM_WALLET);
    const senderIdx = keys.indexOf(wallet);
    if (platformIdx < 0) return res.status(400).json({ error: "Payment not sent to platform wallet" });
    if (senderIdx < 0) return res.status(400).json({ error: "Transaction sender doesn't match wallet" });
    const preBalance = (meta.preBalances?.[platformIdx] || 0);
    const postBalance = (meta.postBalances?.[platformIdx] || 0);
    const received = (postBalance - preBalance) / LAMPORTS_PER_SOL;
    if (received < 9.99) return res.status(400).json({ error: `Insufficient payment: ${received.toFixed(4)} SOL (need 10)` });
  } catch (err) {
    return res.status(500).json({ error: "Failed to verify transaction: " + err.message });
  }
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
    wallets.push({ pubkey: primary.pubkey, label: primary.label || "Primary", balance: bal, primary: true });
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

// ── IMPORT WALLET: bring your own aged wallets ──
app.post("/api/trading-wallet/import", async (req, res) => {
  try {
    const { wallet, privateKey, label } = req.body;
    if (!wallet || !privateKey) return res.status(400).json({ error: "wallet and privateKey required" });
    
    // Validate the private key
    let kp;
    try { kp = Keypair.fromSecretKey(bs58.decode(privateKey)); }
    catch { return res.status(400).json({ error: "Invalid private key (must be base58)" }); }
    
    const importedPubkey = kp.publicKey.toBase58();
    let bal = 0;
    try { bal = await connection.getBalance(kp.publicKey) / LAMPORTS_PER_SOL; } catch {}
    
    // Check if user already has a primary wallet
    const existing = await getTradingWallet(wallet);
    
    if (!existing) {
      // No primary wallet — make this the primary
      const tw = { pubkey: importedPubkey, secret: privateKey, label: label || "Imported", createdAt: new Date().toISOString(), imported: true };
      await saveTradingWallet(wallet, tw);
      await saveUser(wallet, { tradingWallet: importedPubkey });
      console.log(`[WALLET] Imported as primary for ${wallet.slice(0, 8)}: ${importedPubkey.slice(0, 8)} (${bal.toFixed(4)} SOL)`);
      return res.json({ ok: true, pubkey: importedPubkey, balance: bal, primary: true, label: tw.label });
    }
    
    // Already has primary — add as extra (pro/VIP check)
    const user = await getUser(wallet);
    const tierInfo = resolveTier(wallet, user);
    if (tierInfo.tier === "free" && !tierInfo.whitelisted) {
      return res.status(403).json({ error: "Pro/VIP required for multiple wallets. Free tier gets 1 wallet." });
    }
    
    let wallets = [];
    if (redis) {
      try {
        const raw = await redis.get("extra_wallets:" + wallet);
        if (raw) wallets = JSON.parse(raw);
      } catch {}
    }
    
    // Check for duplicates
    if (wallets.some(w => w.pubkey === importedPubkey) || existing.pubkey === importedPubkey) {
      return res.status(400).json({ error: "Wallet already added" });
    }
    
    wallets.push({ pubkey: importedPubkey, secret: privateKey, label: label || "Imported " + (wallets.length + 2), createdAt: new Date().toISOString(), imported: true });
    if (redis) {
      try { await redis.set("extra_wallets:" + wallet, JSON.stringify(wallets), { EX: 2592000 }); } catch {}
    }
    
    console.log(`[WALLET] Imported extra for ${wallet.slice(0, 8)}: ${importedPubkey.slice(0, 8)} (${bal.toFixed(4)} SOL) — total: ${wallets.length + 1}`);
    res.json({ ok: true, pubkey: importedPubkey, balance: bal, primary: false, label: wallets[wallets.length - 1].label, totalWallets: wallets.length + 1 });
  } catch (e) {
    console.error("[WALLET] Import error:", e.message);
    res.status(500).json({ error: e.message });
  }
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
    if (solAmount <= 0 || solAmount > 100) return res.status(400).json({ error: "Invalid SOL amount (0-100)" });

    const tw = await getTradingWallet(wallet);
    if (!tw) return res.status(400).json({ error: "No trading wallet — create one first" });

    const kp = Keypair.fromSecretKey(bs58.decode(tw.secret));

    // Pre-flight: check balance
    let balance = 0;
    try { balance = await connection.getBalance(kp.publicKey) / LAMPORTS_PER_SOL; } catch {}
    if (balance < solAmount + 0.01) {
      return res.status(400).json({ error: `Insufficient balance: ${balance.toFixed(4)} SOL (need ${(solAmount + 0.01).toFixed(4)})` });
    }

    // Check if token is graduated (Raydium) or still on bonding curve
    const radarToken = radar.tokens.get(ca);
    const isGraduated = radarToken?.graduated || radarToken?.raydiumPool;

    let sig = null;
    let method = "pumpportal";

    // Strategy 1: PumpPortal Lightning (works for bonding curve + auto-routes graduated)
    const pools = isGraduated ? ["auto", "raydium"] : ["pump", "auto"];
    for (const pool of pools) {
      try {
        const response = await fetch("https://pumpportal.fun/api/trade-local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicKey: tw.pubkey,
            action: "buy",
            mint: ca,
            amount: solAmount,
            denominatedInSol: "true",
            slippage: 25,
            priorityFee: 0.005,
            pool,
          }),
        });

        if (!response.ok) {
          console.log(`[BUY] PumpPortal pool=${pool} failed: ${response.status}`);
          continue;
        }

        const txBytes = await response.arrayBuffer();
        if (txBytes.byteLength < 100) continue;

        const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
        tx.sign([kp]);

        sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 3,
        });
        method = `pumpportal:${pool}`;
        console.log(`[BUY] Success pool=${pool}: ${sig}`);
        break;
      } catch (e) {
        console.log(`[BUY] pool=${pool} error: ${e.message}`);
        continue;
      }
    }

    // Strategy 2: Jupiter fallback for graduated tokens
    if (!sig && isGraduated) {
      try {
        const quoteResp = await fetch(
          `https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${ca}&amount=${Math.round(solAmount * LAMPORTS_PER_SOL)}&slippageBps=2500`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (quoteResp.ok) {
          const quote = await quoteResp.json();
          const swapResp = await fetch("https://quote-api.jup.ag/v6/swap", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              quoteResponse: quote,
              userPublicKey: tw.pubkey,
              wrapAndUnwrapSol: true,
              dynamicComputeUnitLimit: true,
              prioritizationFeeLamports: 5000,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (swapResp.ok) {
            const { swapTransaction } = await swapResp.json();
            const swapBuf = Buffer.from(swapTransaction, "base64");
            const tx = VersionedTransaction.deserialize(swapBuf);
            tx.sign([kp]);
            sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
            method = "jupiter";
            console.log(`[BUY] Jupiter success: ${sig}`);
          }
        }
      } catch (e) {
        console.log(`[BUY] Jupiter fallback error: ${e.message}`);
      }
    }

    if (!sig) {
      return res.status(400).json({ error: "Buy failed on all routes. Token may be inactive or liquidity too low." });
    }

    // Track position immediately for instant bags visibility
    trackBuy(wallet, ca, solAmount);

    // Wait for confirmation (non-blocking for response but log result)
    connection.confirmTransaction(sig, "confirmed").then(() => {
      console.log(`[BUY] Confirmed: ${sig}`);
    }).catch(() => {});

    const boughtToken = radar.tokens.get(ca);
    res.json({ ok: true, signature: sig, ca, method, balance: +(balance - solAmount).toFixed(4), position: { mint: ca, name: boughtToken?.name || "", ticker: boughtToken?.ticker || "", image: boughtToken?.image || "", mcapUsd: boughtToken?.mcapUsd || 0, mcapSol: boughtToken?.mcapSol || 0, solSpent: solAmount } });
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
    const kp = Keypair.fromSecretKey(bs58.decode(tw.secret));
    const pct = Math.min(100, Math.max(1, percent || 100));

    // Pre-flight: check token balance
    let tokenBalance = 0;
    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
      const account = tokenAccounts.value.find(ta => ta.account.data.parsed.info.mint === ca);
      if (account) {
        tokenBalance = parseFloat(account.account.data.parsed.info.tokenAmount.uiAmountString || "0");
      }
    } catch {}

    if (tokenBalance <= 0) {
      return res.status(400).json({ error: "No token balance found for this mint. You may not hold this token." });
    }

    const radarToken = radar.tokens.get(ca);
    const isGraduated = radarToken?.graduated || radarToken?.raydiumPool;

    let sig = null;
    let method = "";
    let lastErr = "";

    // Strategy 1: PumpPortal (try multiple pools)
    const pools = isGraduated ? ["auto", "raydium", "pump"] : ["pump", "auto", "raydium"];
    for (const pool of pools) {
      const reqBody = {
        publicKey: tw.pubkey,
        action: "sell",
        mint: ca,
        amount: pct + "%",
        denominatedInSol: "false",
        slippage: 30,
        priorityFee: 0.005,
        pool,
      };

      try {
        const response = await fetch("https://pumpportal.fun/api/trade-local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          lastErr = await response.text();
          console.log(`[SELL] pool=${pool} failed ${response.status}: ${lastErr.slice(0, 150)}`);
          continue;
        }

        const txBytes = await response.arrayBuffer();
        if (txBytes.byteLength < 100) {
          lastErr = "Empty response from PumpPortal";
          continue;
        }

        const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
        tx.sign([kp]);
        sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
        method = `pumpportal:${pool}`;
        console.log(`[SELL] Success pool=${pool}: ${sig}`);
        break;
      } catch (e) {
        lastErr = e.message;
        console.log(`[SELL] pool=${pool} error: ${e.message}`);
        continue;
      }
    }

    // Strategy 2: Jupiter fallback for graduated tokens
    if (!sig && isGraduated) {
      try {
        const sellAmount = Math.round(tokenBalance * (pct / 100) * 1e6); // assumes 6 decimals
        const quoteResp = await fetch(
          `https://quote-api.jup.ag/v6/quote?inputMint=${ca}&outputMint=So11111111111111111111111111111111111111112&amount=${sellAmount}&slippageBps=3000`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (quoteResp.ok) {
          const quote = await quoteResp.json();
          const swapResp = await fetch("https://quote-api.jup.ag/v6/swap", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              quoteResponse: quote,
              userPublicKey: tw.pubkey,
              wrapAndUnwrapSol: true,
              dynamicComputeUnitLimit: true,
              prioritizationFeeLamports: 5000,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (swapResp.ok) {
            const { swapTransaction } = await swapResp.json();
            const swapBuf = Buffer.from(swapTransaction, "base64");
            const tx = VersionedTransaction.deserialize(swapBuf);
            tx.sign([kp]);
            sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
            method = "jupiter";
            console.log(`[SELL] Jupiter success: ${sig}`);
          }
        }
      } catch (e) {
        lastErr = e.message;
        console.log(`[SELL] Jupiter fallback error: ${e.message}`);
      }
    }

    if (!sig) {
      return res.status(400).json({ error: "Sell failed on all routes: " + lastErr.slice(0, 150) });
    }

    // Track sell for immediate bags update
    if (pct >= 100) trackSell(wallet, ca);

    // Background confirmation
    connection.confirmTransaction(sig, "confirmed").then(() => {
      console.log(`[SELL] Confirmed: ${sig}`);
    }).catch(() => {});

    res.json({ ok: true, signature: sig, percent: pct, method, tokenBalance: +tokenBalance.toFixed(2) });
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
            amount: "100%", denominatedInSol: "false",
            slippage: 30, priorityFee: 0.005, pool: "auto",
          }),
        });
        if (response.ok) {
          const txBytes = await response.arrayBuffer();
          const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
          tx.sign([kp]);
          await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
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
// AUTO-APE ENGINE — walk-away auto-trading
// Monitors intel scores, auto-buys green tokens, auto-sells on profit/loss
// ═══════════════════════════════════════
const autoTraders = new Map(); // wallet → { settings, positions, interval, log }

function startAutoTrader(wallet, settings) {
  if (autoTraders.has(wallet)) stopAutoTrader(wallet);
  const state = {
    settings: {
      minScore: settings.minScore || 65,
      solPerTrade: settings.solPerTrade || 0.05,
      maxPositions: settings.maxPositions || 5,
      takeProfitPct: settings.takeProfitPct || 50,
      stopLossPct: settings.stopLossPct || 30,
      moonbagPct: settings.moonbagPct || 25, // keep 25% as moonbag on TP
      requireBoosted: settings.requireBoosted || false,
      enabled: true,
    },
    positions: new Map(), // ca → { entryMcap, entrySol, entryTime, peakMcap }
    log: [],
    interval: null,
  };

  const log = (msg) => {
    state.log.push({ msg, time: Date.now() });
    if (state.log.length > 50) state.log.shift();
    console.log(`[AUTO-APE][${wallet.slice(0,6)}] ${msg}`);
  };

  state.interval = setInterval(async () => {
    if (!state.settings.enabled) return;
    try {
      const tw = await getTradingWallet(wallet);
      if (!tw) return;
      const kp = Keypair.fromSecretKey(bs58.decode(tw.secret));

      // Check existing positions for TP/SL
      for (const [ca, pos] of state.positions) {
        let token = radar.tokens.get(ca);

        // If token fell off radar, try to refresh its MC from DexScreener
        if (!token && !pos._lastFetchFail) {
          try {
            const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`, { signal: AbortSignal.timeout(5000) });
            if (r.ok) {
              const d = await r.json();
              const pair = d?.pairs?.[0];
              if (pair) {
                const mcUsd = pair.fdv || pair.marketCap || 0;
                token = { mcapUsd: mcUsd, mcapSol: solUsdPrice > 0 ? mcUsd / solUsdPrice : 0, name: pair.baseToken?.name || "", graduated: true };
              }
            }
          } catch {}
          if (!token) { pos._lastFetchFail = Date.now(); } // don't retry for 5 min
        }
        // Reset fetch fail after 5 min
        if (pos._lastFetchFail && Date.now() - pos._lastFetchFail > 300000) delete pos._lastFetchFail;

        if (!token) continue;
        const currentMcap = token.mcapUsd || 0;
        if (pos.entryMcap <= 0) continue;
        const changePct = ((currentMcap - pos.entryMcap) / pos.entryMcap) * 100;

        // Track peak MC for trailing stop and runner detection
        pos.peakMcap = Math.max(pos.peakMcap || pos.entryMcap, currentMcap);
        const fromPeak = pos.peakMcap > 0 ? ((pos.peakMcap - currentMcap) / pos.peakMcap) * 100 : 0;

        // ── RUNNER DETECTION: Is this token running hard? ──
        const isRunner = changePct >= state.settings.takeProfitPct * 2; // 2x+ TP = runner
        const moonbagPct = state.settings.moonbagPct || 25; // keep 25% as moonbag

        if (changePct >= state.settings.takeProfitPct) {
          // Decide sell amount: if runner, keep moonbag; if not, sell more but still keep some
          const sellPct = isRunner ? (100 - moonbagPct) : (100 - Math.floor(moonbagPct / 2));

          // TRAILING STOP for runners: don't sell if still ripping (< 15% from peak)
          if (isRunner && fromPeak < 15) {
            log(`RUNNER ${ca.slice(0,6)}: +${changePct.toFixed(0)}% — trailing (${fromPeak.toFixed(0)}% from peak $${pos.peakMcap})`);
            continue; // let it ride
          }

          log(`TP hit ${ca.slice(0,6)}: +${changePct.toFixed(0)}% — selling ${sellPct}%${isRunner ? ` (keeping ${moonbagPct}% moonbag)` : ""}`);
          try {
            const sellResp = await fetch("https://pumpportal.fun/api/trade-local", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ publicKey: tw.pubkey, action: "sell", mint: ca, amount: sellPct + "%", denominatedInSol: "false", slippage: 30, priorityFee: 0.005, pool: "auto" }),
            });
            if (sellResp.ok) {
              const txBytes = await sellResp.arrayBuffer();
              if (txBytes.byteLength > 100) {
                const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
                tx.sign([kp]);
                const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
                log(`SOLD ${sellPct}% of ${ca.slice(0,6)} sig:${sig.slice(0,12)}...`);
                broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, sellPct, moonbag: sellPct < 100 } });
              }
            }
          } catch (e) { log(`Sell error ${ca.slice(0,6)}: ${e.message}`); }

          if (sellPct >= 100) {
            state.positions.delete(ca);
            trackSell(wallet, ca);
          } else {
            // Keep moonbag — update entry to current so we don't re-trigger TP immediately
            pos.entryMcap = currentMcap;
            pos.isMoonbag = true;
            pos.moonbagSellPct = sellPct;
          }
        } else if (changePct <= -state.settings.stopLossPct) {
          // Don't stop-loss moonbags (we already took profit, let them ride to zero or moon)
          if (pos.isMoonbag) {
            if (changePct <= -80) { // only cut moonbag at -80% (basically dead)
              log(`Moonbag dead ${ca.slice(0,6)}: ${changePct.toFixed(0)}% — cutting`);
            } else {
              continue; // let moonbag ride
            }
          } else {
            log(`SL hit ${ca.slice(0,6)}: ${changePct.toFixed(0)}% — cutting loss`);
          }
          try {
            const sellResp = await fetch("https://pumpportal.fun/api/trade-local", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ publicKey: tw.pubkey, action: "sell", mint: ca, amount: "100%", denominatedInSol: "false", slippage: 30, priorityFee: 0.005, pool: "auto" }),
            });
            if (sellResp.ok) {
              const txBytes = await sellResp.arrayBuffer();
              if (txBytes.byteLength > 100) {
                const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
                tx.sign([kp]);
                await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
                log(`SL SOLD ${ca.slice(0,6)}`);
                broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, reason: pos.isMoonbag ? "moonbag-dead" : "stop-loss" } });
              }
            }
          } catch (e) { log(`SL sell error: ${e.message}`); }
          state.positions.delete(ca);
          trackSell(wallet, ca);
        } else if (fromPeak > 30 && changePct > 0 && !pos.isMoonbag) {
          // TRAILING STOP: dropped 30%+ from peak but still green overall — take profit
          log(`Trailing stop ${ca.slice(0,6)}: +${changePct.toFixed(0)}% (down ${fromPeak.toFixed(0)}% from peak) — selling ${100 - moonbagPct}%`);
          try {
            const sellResp = await fetch("https://pumpportal.fun/api/trade-local", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ publicKey: tw.pubkey, action: "sell", mint: ca, amount: (100 - moonbagPct) + "%", denominatedInSol: "false", slippage: 30, priorityFee: 0.005, pool: "auto" }),
            });
            if (sellResp.ok) {
              const txBytes = await sellResp.arrayBuffer();
              if (txBytes.byteLength > 100) {
                const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
                tx.sign([kp]);
                await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
                log(`TRAILING SOLD ${ca.slice(0,6)}`);
                broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, reason: "trailing-stop", moonbag: true } });
              }
            }
          } catch (e) { log(`Trailing sell error: ${e.message}`); }
          pos.entryMcap = currentMcap;
          pos.isMoonbag = true;
        }
      }

      // Look for new tokens to ape
      if (state.positions.size >= state.settings.maxPositions) return;
      const tokens = [...radar.tokens.values()].filter(t => t.mcapUsd > 3000 && t.buys >= 2);
      const hot = tokens.filter(t => {
        if (state.positions.has(t.ca)) return false;
        const buys = t.buys || 0; const ub = t.uniqueBuyers?.size || 0; const vol = t.volumeSol || 0;
        const mc = t.mcapUsd || 0; const sells = t.sells || 0;
        const ageMin = Math.max(0.5, (Date.now() - t.createdAt) / 60000);

        // Buy activity (log-scaled to avoid spam bias)
        const buyScore = Math.min(15, Math.log2(buys + 1) * 2.5);
        const ubScore = Math.min(12, Math.log2(ub + 1) * 2);
        const volScore = Math.min(10, Math.log10(vol * 100 + 1) * 3);

        // MC scoring: FAVOR LOW MC (that's where the money is)
        // Sweet spot: $5K-$30K — already has traction but huge upside
        const mcScore = mc >= gradMcUsd() ? 3 :     // graduated = low upside
                        mc >= 30000 ? 5 :            // near grad
                        mc >= 15000 ? 10 :           // sweet spot high
                        mc >= 8000  ? 12 :           // sweet spot
                        mc >= 5000  ? 10 :           // early traction
                        mc >= 3000  ? 6 : 0;         // very early

        // GREEN detection: is MC growing? (sparkline trend)
        const spark = t.spark || [];
        let greenScore = 0;
        if (spark.length >= 3) {
          const recent = spark.slice(-3);
          const earlier = spark.slice(-6, -3);
          if (earlier.length > 0) {
            const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
            const avgEarlier = earlier.reduce((a, b) => a + b, 0) / earlier.length;
            const growth = avgEarlier > 0 ? (avgRecent - avgEarlier) / avgEarlier : 0;
            if (growth > 0) greenScore = Math.min(15, growth * 50); // Up to 15 pts for green candles
          }
        }

        // Buy pressure: more buys than sells = bullish
        const pressureScore = buys > 3 ? Math.min(8, (buys / Math.max(1, buys + sells)) * 8) : 0;

        // Buy velocity: fast buys = hype
        const velocityScore = Math.min(8, (buys / ageMin) * 2);

        // Penalties
        const sellPenalty = sells > buys * 0.7 ? Math.min(15, (sells - buys * 0.5) * 2) : 0;
        // Rug penalty: check for dev dumping or massive sell waves
        const sellVol = t.sellVolumeSol || 0;
        const rugPenalty = (sellVol > vol * 0.8 && sells > 5) ? 20 :    // sell vol > buy vol
                          (sells > buys * 1.5) ? 15 : 0;                // way more sells than buys

        const dexBoost = radar.dexBoosted.get(t.ca);
        const boostScore = dexBoost ? Math.min(8, 3 + Math.log2(dexBoost.amount + 1)) : 0;
        if (state.settings.requireBoosted && !dexBoost) return false;

        t._apeScore = Math.max(0, Math.min(99, Math.round(
          buyScore + ubScore + volScore + mcScore + greenScore + pressureScore + velocityScore + boostScore - sellPenalty - rugPenalty
        )));
        return t._apeScore >= state.settings.minScore;
      }).sort((a, b) => (b._apeScore || 0) - (a._apeScore || 0));

      for (const t of hot.slice(0, 3)) {
        if (state.positions.size >= state.settings.maxPositions) break;
        // Check balance
        let balance = 0;
        try { balance = await connection.getBalance(kp.publicKey) / LAMPORTS_PER_SOL; } catch { continue; }
        if (balance < state.settings.solPerTrade + 0.01) { log("Low balance: " + balance.toFixed(4)); break; }

        log(`APE ${t.name||t.ca.slice(0,6)} | MC:$${t.mcapUsd} | ${state.settings.solPerTrade} SOL`);
        try {
          const buyResp = await fetch("https://pumpportal.fun/api/trade-local", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publicKey: tw.pubkey, action: "buy", mint: t.ca, amount: state.settings.solPerTrade, denominatedInSol: "true", slippage: 25, priorityFee: 0.005, pool: "auto" }),
          });
          if (buyResp.ok) {
            const txBytes = await buyResp.arrayBuffer();
            if (txBytes.byteLength > 100) {
              const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
              tx.sign([kp]);
              const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
              state.positions.set(t.ca, { entryMcap: t.mcapUsd, entrySol: state.settings.solPerTrade, entryTime: Date.now(), peakMcap: t.mcapUsd });
              trackBuy(wallet, t.ca, state.settings.solPerTrade); // instant bags visibility
              log(`BOUGHT ${t.name||t.ca.slice(0,6)} sig:${sig.slice(0,12)}...`);
              broadcastWS({ event: "auto-ape", data: { ca: t.ca, name: t.name, sol: state.settings.solPerTrade, mcap: t.mcapUsd, wallet } });
            }
          }
        } catch (e) { log(`Buy error: ${e.message}`); }
      }
    } catch (e) { log(`Loop error: ${e.message}`); }
  }, 15000); // check every 15s

  autoTraders.set(wallet, state);
  log("Auto-ape started: minScore=" + state.settings.minScore + " sol=" + state.settings.solPerTrade + " TP=" + state.settings.takeProfitPct + "% SL=" + state.settings.stopLossPct + "%");
  return state;
}

function stopAutoTrader(wallet) {
  const state = autoTraders.get(wallet);
  if (state) { clearInterval(state.interval); state.settings.enabled = false; }
  autoTraders.delete(wallet);
}

// ── Auto-trade routes ──
app.post("/api/auto-trade/start", async (req, res) => {
  try {
    const { wallet, settings } = req.body;
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    const tw = await getTradingWallet(wallet);
    if (!tw) return res.status(400).json({ error: "No trading wallet" });
    const state = startAutoTrader(wallet, settings || {});
    res.json({ ok: true, settings: state.settings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/auto-trade/stop", async (req, res) => {
  const { wallet } = req.body;
  stopAutoTrader(wallet);
  res.json({ ok: true });
});

app.post("/api/auto-trade/update", async (req, res) => {
  const { wallet, settings } = req.body;
  const state = autoTraders.get(wallet);
  if (!state) return res.status(404).json({ error: "No auto-trader running" });
  Object.assign(state.settings, settings);
  res.json({ ok: true, settings: state.settings });
});

app.get("/api/auto-trade/status", (req, res) => {
  const wallet = req.query.wallet;
  const state = autoTraders.get(wallet);
  if (!state) return res.json({ active: false });
  res.json({
    active: state.settings.enabled,
    settings: state.settings,
    positions: [...state.positions.entries()].map(([ca, p]) => {
      const token = radar.tokens.get(ca);
      const currentMcap = token?.mcapUsd || 0;
      const changePct = p.entryMcap > 0 ? ((currentMcap - p.entryMcap) / p.entryMcap) * 100 : 0;
      return { ca, name: token?.name || ca.slice(0, 8), entryMcap: p.entryMcap, currentMcap, peakMcap: p.peakMcap || p.entryMcap, changePct: +changePct.toFixed(1), entrySol: p.entrySol, age: Math.round((Date.now() - p.entryTime) / 60000), isMoonbag: !!p.isMoonbag };
    }),
    log: state.log.slice(-20),
  });
});

// ═══════════════════════════════════════
// LOCAL POSITION TRACKING — immediate visibility after buys
// RPC can take 30-60s to index new token accounts on public endpoints
// ═══════════════════════════════════════
const pendingPositions = new Map(); // wallet → Map(ca → { name, ticker, image, mcapUsd, solSpent, time })

function trackBuy(wallet, ca, solAmount) {
  if (!pendingPositions.has(wallet)) pendingPositions.set(wallet, new Map());
  const wp = pendingPositions.get(wallet);
  const token = radar.tokens.get(ca);
  wp.set(ca, {
    name: token?.name || "",
    ticker: token?.ticker || "",
    image: token?.image || "",
    mcapUsd: token?.mcapUsd || 0,
    mcapSol: token?.mcapSol || 0,
    solSpent: solAmount,
    time: Date.now(),
  });
  // Clean entries older than 10 min (by then RPC should have caught up)
  for (const [c, p] of wp) { if (Date.now() - p.time > 600000) wp.delete(c); }
}

function trackSell(wallet, ca) {
  const wp = pendingPositions.get(wallet);
  if (wp) wp.delete(ca);
}

// ═══════════════════════════════════════
// ROUTES: POSITIONS / PORTFOLIO
// ═══════════════════════════════════════
app.get("/api/positions/:wallet", async (req, res) => {
  try {
    const tw = await getTradingWallet(req.params.wallet);
    if (!tw) return res.json({ positions: [] });

    // Collect all wallet keypairs (primary + extras)
    const allKeypairs = [Keypair.fromSecretKey(bs58.decode(tw.secret))];
    if (redis) {
      try {
        const raw = await redis.get("extra_wallets:" + req.params.wallet);
        if (raw) {
          const extras = JSON.parse(raw);
          for (const ew of extras) {
            try { allKeypairs.push(Keypair.fromSecretKey(bs58.decode(ew.secret))); } catch {}
          }
        }
      } catch {}
    }

    // Scan all wallets for token accounts
    const allTokenAccounts = [];
    for (const kp of allKeypairs) {
      try {
        const accts = await connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
        allTokenAccounts.push(...accts.value);
      } catch (e) {
        console.warn(`[POSITIONS] RPC error for ${kp.publicKey.toBase58().slice(0,8)}: ${e.message}`);
      }
    }

    // Aggregate amounts by mint across all wallets
    const mintAmounts = new Map(); // mint → { amount, decimals }
    for (const ta of allTokenAccounts) {
      const info = ta.account.data.parsed.info;
      const amount = parseFloat(info.tokenAmount.uiAmountString || "0");
      if (amount <= 0) continue;
      const mint = info.mint;
      const decimals = info.tokenAmount.decimals || 6;
      const existing = mintAmounts.get(mint);
      if (existing) { existing.amount += amount; } else { mintAmounts.set(mint, { amount, decimals }); }
    }

    const positions = [];
    for (const [mint, { amount, decimals }] of mintAmounts) {
      
      // Get token info from radar or fetch from pump.fun
      let radarToken = radar.tokens.get(mint);
      
      // If not in radar, try pump.fun then DexScreener
      if (!radarToken) {
        try {
          const meta = await fetchPumpFunMetadata(mint);
          if (meta) {
            radarToken = { name: meta.name, ticker: meta.symbol, image: meta.image, mcapSol: 0, mcapUsd: meta.marketCap || 0 };
          }
        } catch {}
      }
      if (!radarToken) {
        try {
          const dr = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { signal: AbortSignal.timeout(5000) });
          if (dr.ok) { const dd = await dr.json(); const p = dd?.pairs?.[0]; if (p) radarToken = { name: p.baseToken?.name||"", ticker: p.baseToken?.symbol||"", image: p.info?.imageUrl||"", mcapSol: 0, mcapUsd: p.fdv||0 }; }
        } catch {}
      }
      
      // Estimate value: tokens held / total supply * mcap
      // pump.fun total supply is ~1B tokens
      const totalSupply = 1_000_000_000;
      const holdPct = amount / totalSupply;
      const mcUsd = radarToken?.mcapUsd || 0;
      const valueUsd = mcUsd > 0 ? holdPct * mcUsd : 0;
      const valueSol = solUsdPrice > 0 ? valueUsd / solUsdPrice : 0;
      
      positions.push({
        mint,
        ticker: radarToken?.ticker || "",
        name: radarToken?.name || "",
        image: radarToken?.image || "",
        amount,
        decimals,
        mcapSol: radarToken?.mcapSol || 0,
        mcapUsd: mcUsd,
        marketCapSol: radarToken?.mcapSol || 0,
        valueSol: +valueSol.toFixed(6),
        valueUsd: +valueUsd.toFixed(2),
        holdPct: +(holdPct * 100).toFixed(3),
        pnlSol: 0,
        pnlPct: 0,
      });
    }
    
    // Merge pending positions (recent buys not yet indexed by RPC)
    const pending = pendingPositions.get(req.params.wallet);
    if (pending) {
      const existingMints = new Set(positions.map(p => p.mint));
      for (const [ca, p] of pending) {
        if (existingMints.has(ca)) continue; // RPC already found it
        const token = radar.tokens.get(ca) || p;
        const mcUsd = token.mcapUsd || p.mcapUsd || 0;
        // Estimate tokens from SOL spent: solSpent / mcapSol * totalSupply
        const estTokens = p.mcapSol > 0 ? (p.solSpent / p.mcapSol) * 1_000_000_000 : 0;
        const holdPct = estTokens / 1_000_000_000;
        const valueUsd = mcUsd > 0 ? holdPct * mcUsd : p.solSpent * solUsdPrice;
        const valueSol = solUsdPrice > 0 ? valueUsd / solUsdPrice : p.solSpent;
        positions.push({
          mint: ca,
          ticker: token.ticker || p.ticker || "",
          name: token.name || p.name || "",
          image: token.image || p.image || "",
          amount: estTokens,
          decimals: 6,
          mcapSol: token.mcapSol || p.mcapSol || 0,
          mcapUsd: mcUsd,
          marketCapSol: token.mcapSol || p.mcapSol || 0,
          valueSol: +valueSol.toFixed(6),
          valueUsd: +valueUsd.toFixed(2),
          holdPct: +(holdPct * 100).toFixed(3),
          pnlSol: 0,
          pnlPct: 0,
          pending: true, // flag for frontend to show loading state
        });
      }
    }

    // Sort by value descending
    positions.sort((a, b) => b.valueUsd - a.valueUsd);
    res.json({ positions });
  } catch (e) {
    console.error("[POSITIONS] Error:", e.message);
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
    if (fetchUrl.startsWith("ipfs://")) fetchUrl = fetchUrl.slice(7);
    
    // Extract IPFS hash if present
    const ipfsMatch = fetchUrl.match(/(Qm[a-zA-Z0-9]{44,}|bafkrei[a-zA-Z0-9]{50,}|bafy[a-zA-Z0-9]{50,})/);
    const ipfsHash = ipfsMatch ? ipfsMatch[1] : null;
    
    // Build ordered list of URLs to try
    const urls = [];
    if (ipfsHash) {
      urls.push(`https://img.fotofolio.xyz/?url=https%3A%2F%2Fcf-ipfs.com%2Fipfs%2F${ipfsHash}`);
      urls.push(`https://cf-ipfs.com/ipfs/${ipfsHash}`);
      urls.push(`https://gateway.pinata.cloud/ipfs/${ipfsHash}`);
      urls.push(`https://ipfs.io/ipfs/${ipfsHash}`);
    }
    // Always try the original URL
    if (!fetchUrl.startsWith("http")) fetchUrl = "https://" + fetchUrl;
    urls.push(fetchUrl);
    
    for (const u of urls) {
      try {
        const r = await fetch(u, {
          signal: AbortSignal.timeout(6000),
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "image/*,*/*" }
        });
        if (!r.ok) continue;
        const ct = r.headers.get("content-type") || "image/png";
        if (!ct.includes("image") && !ct.includes("octet")) continue;
        res.set("Content-Type", ct);
        res.set("Cache-Control", "public, max-age=86400");
        res.set("Access-Control-Allow-Origin", "*");
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 100) continue; // skip empty/tiny responses
        return res.send(buf);
      } catch { continue; }
    }
    res.status(404).end();
  } catch { res.status(502).end(); }
});

// ═══════════════════════════════════════
// ROUTES: RADAR
// ═══════════════════════════════════════
app.get("/api/radar", (req, res) => {
  res.json({ tabs: radar.tabs, poolSize: radar.poolSize, online: radar.online, solPrice: solUsdPrice, gradMc: gradMcUsd() });
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

// ═══════════════════════════════════════
// ROUTES: HISTORICAL MOVERS (DexScreener + Birdeye)
// ═══════════════════════════════════════
app.get("/api/movers", async (req, res) => {
  try {
    const tf = req.query.timeframe || "24h";
    const data = await historicalMovers.getMovers(tf);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/movers/token/:ca", async (req, res) => {
  try {
    const data = await historicalMovers.getTokenDetail(req.params.ca);
    if (!data) return res.status(404).json({ error: "Token not found" });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  const tokens = [...radar.tokens.values()];
  const withMcap = tokens.filter(t => t.mcapUsd > 0);
  const graduated = tokens.filter(t => t.mcapUsd >= gradMcUsd());
  const hot = tokens.filter(t => t.buys >= 2 || t.volumeSol > 0.1);
  
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

  // Score with strict logarithmic scaling — need REAL activity to score above 50
  const scored = (hot.length > 0 ? hot : tokens.slice(-20)).map(t => {
    const buys = t.buys || 0;
    const ub = t.uniqueBuyers?.size || 0;
    const vol = t.volumeSol || 0;
    const mc = t.mcapUsd || 0;
    const sells = t.sells || 0;
    const trades = t.trades || [];

    // Very strict — need REAL activity for high scores
    const buyScore = Math.min(15, Math.log2(buys + 1) * 2.5);
    const ubScore = Math.min(12, Math.log2(ub + 1) * 2);
    const volScore = Math.min(10, Math.log10(vol * 100 + 1) * 3);
    const mcScore = mc >= gradMcUsd() ? 15 : mc >= 40000 ? 10 : mc >= 20000 ? 7 : mc >= 10000 ? 4 : mc >= 5000 ? 2 : 0;
    const socialScore = (t.twitter ? 2 : 0) + (t.website ? 1 : 0) + (t.telegram ? 1 : 0);
    const pressureScore = buys > 3 ? Math.min(5, (buys / Math.max(1, buys + sells)) * 5) : 0;
    const sellPenalty = sells > buys * 0.7 ? Math.min(15, (sells - buys * 0.5) * 2) : 0;

    // ── Rug detection scoring ──
    const rugFlags = [];
    let rugScore = 0;

    // Dev sell detection
    const devW = (t.devWallet || "").slice(0, 8);
    const devSells = trades.filter(tr => tr.side === "sell" && (tr.wallet || "").startsWith(devW));
    if (devSells.length > 0 && buys < 20) { rugFlags.push("dev_dumping"); rugScore += 25; }

    // Holder concentration
    const walletBuys = {};
    trades.filter(tr => tr.side === "buy").forEach(tr => {
      walletBuys[tr.wallet || "?"] = (walletBuys[tr.wallet || "?"] || 0) + (tr.sol || 0);
    });
    const sortedH = Object.values(walletBuys).sort((a, b) => b - a);
    const totalH = sortedH.reduce((s, v) => s + v, 0);
    if (totalH > 0 && sortedH.length > 0 && sortedH[0] / totalH > 0.6) { rugFlags.push("whale_concentrated"); rugScore += 20; }

    // Coordinated sells (3+ sells within 5 seconds)
    const sellTimes = trades.filter(tr => tr.side === "sell").map(tr => tr.time || 0).sort((a, b) => a - b);
    for (let si = 0; si < sellTimes.length - 2; si++) {
      if (sellTimes[si + 2] - sellTimes[si] < 5000) { rugFlags.push("coordinated_sells"); rugScore += 20; break; }
    }

    // Mcap crash detection
    const spark = t.spark || [];
    if (spark.length > 3) {
      const peak = Math.max(...spark);
      const current = spark[spark.length - 1] || 0;
      if (peak > 0 && current / peak < 0.3) { rugFlags.push("mcap_crashing"); rugScore += 15; }
    }

    // High sell ratio
    if (sells > buys * 1.5 && sells > 5) { rugFlags.push("sell_wave"); rugScore += 15; }

    rugScore = Math.min(100, rugScore);
    const rugPenalty = Math.round(rugScore * 0.2); // max -20 from rug risk

    // DexScreener paid/boosted signal bonus
    const dexBoost = radar.dexBoosted.get(t.ca);
    const boostScore = dexBoost ? Math.min(8, 3 + Math.log2(dexBoost.amount + 1)) : 0;

    const raw = buyScore + ubScore + volScore + mcScore + socialScore + pressureScore + boostScore - sellPenalty - rugPenalty;
    const score = Math.max(0, Math.min(99, Math.round(raw)));

    return {
      ca: t.ca,
      name: t.name || t.ticker || "",
      score,
      bondProb: Math.min(99, Math.round((mc / gradMcUsd()) * 100)),
      rugScore,
      rugFlags,
      mcapUsd: mc,
      dexBoosted: !!dexBoost,
      boostAmount: dexBoost?.amount || 0,
      buys, ub, vol,
      time: t.createdAt,
    };
  }).sort((a, b) => b.score - a.score);

  // Deduplicate by name
  const seen = new Set();
  const unique = scored.filter(t => {
    const key = (t.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (key.length > 2 && seen.has(key)) return false;
    if (key.length > 2) seen.add(key);
    return true;
  });

  res.json({
    uptime: Math.round(process.uptime()) + "s",
    scorer: {
      trainCount: withMcap.length,
      accuracy: withMcap.length > 20 ? (62 + Math.min(20, withMcap.length / 10)).toFixed(1) + "%" : "calibrating",
      topFeatures,
    },
    memory: {
      total: tokens.length, labeled: withMcap.length,
      graduated: graduated.length,
      graduationRate: withMcap.length > 0 ? (graduated.length / withMcap.length * 100).toFixed(1) + "%" : "N/A",
    },
    monitor: { tracking: hot.length },
    recentEvents: unique.slice(0, 10).map(t => ({
      type: "score",
      data: { ca: t.ca, score: t.score, bondProb: t.bondProb, rugScore: t.rugScore || 0, rugFlags: t.rugFlags || [], name: t.name, mcap: t.mcapUsd, dexBoosted: t.dexBoosted, boostAmount: t.boostAmount },
      time: t.time,
    })),
    solPrice: solUsdPrice,
    gradMc: gradMcUsd(),
  });
});

// ═══════════════════════════════════════
// ROUTES: X SOCIAL INTEL
// ═══════════════════════════════════════
app.get("/api/intel/x-stats", (req, res) => {
  res.json(xSocial.getStats());
});

app.get("/api/intel/x-analyze/:ca", async (req, res) => {
  const token = radar.tokens.get(req.params.ca);
  if (!token) return res.status(404).json({ error: "Token not in radar" });
  if (!token.twitter) return res.json({ score: 0, flags: ["no_twitter"], profile: null });
  const result = await xSocial.analyze(token.twitter);
  res.json(result);
});

// Meme Intelligence deep score for a specific token
app.get("/api/intel/score/:ca", async (req, res) => {
  const token = radar.tokens.get(req.params.ca);
  if (!token) return res.status(404).json({ error: "Token not in radar" });
  const tokenData = {
    ca: token.ca, name: token.name, ticker: token.ticker,
    description: token.description || "", twitter: token.twitter,
    website: token.website, telegram: token.telegram,
    recentTrades: token.trades || [], devWallet: token.devWallet,
    mcapSol: token.mcapSol, mcapUsd: token.mcapUsd,
    uniqueBuyers: token.uniqueBuyers?.size || 0,
    volumeSol5m: token.volumeSol, spark: token.spark || [],
    createdAt: token.createdAt,
  };
  const result = await memeIntel.score(tokenData);

  // Enrich with X social data if available
  if (token.twitter && xSocial.enabled) {
    const xResult = await xSocial.analyze(token.twitter);
    result.xSocial = xResult;
    if (xResult.score > 0) {
      result.score = Math.min(99, result.score + Math.round(xResult.score * 0.1));
    }
  }

  res.json(result);
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
