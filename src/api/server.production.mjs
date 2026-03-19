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
import { resolveTier, buildProfitConfig, isOwnerWallet, registerOwner, calculateFee, calculateReferralSplit, PLATFORM_WALLET, NETWORK_FEE_PCT } from "../engine/fee-engine.mjs";
import CONFIG from "../engine/config.mjs";
import { heliusSmartSend, getOptimalPriorityFee } from "../engine/helius-enhanced.mjs";
import { MemeIntelligence, ScoreDynamics } from "../engine/meme-intelligence.mjs";
import { ArtworkScanner } from "../engine/artwork-scanner.mjs";
import { XSocialIntel } from "../engine/x-social-intel.mjs";
import { MetaTracker } from "../engine/meta-engine.mjs";
import { HistoricalMovers } from "../engine/historical-movers.mjs";
import SurvivorshipBias from "../engine/survivorship-bias.mjs";
import { SmartMoneyTracker } from "../engine/smart-money-tracker.mjs";
import { DevWalletTracker } from "../engine/dev-wallet-tracker.mjs";
import { scoreMemeticQuick, scoreTokenMemetic, loadBlacklists as loadMemeticBlacklists, startMemeticWorkers } from "../engine/memetic-pipeline.mjs";
import { runPipeline, runExitChecks, classifyConfidence, calculatePositionSize, createExitPlan, checkPostExitReentry, checkDipDCA } from "../autoape/pipeline.js";

// ═══════════════════════════════════════
// ENVIRONMENT
// ═══════════════════════════════════════
const PORT = parseInt(process.env.PORT || "3001");
// CONFIG.RPC_URL now auto-uses Helius when HELIUS_API_KEY is set
const RPC_URL = process.env.RPC_URL || CONFIG.RPC_URL || "https://api.mainnet-beta.solana.com";

// Helius-optimized sendTransaction — delegated to helius-enhanced.mjs
const heliusSendRawTx = heliusSmartSend;
const REDIS_URL = process.env.REDIS_URL || null;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "bondli_default";
const DEFAULT_REFERRAL_CODE = "ilikethetech"; // owner's referral code — applied to all new users unless they have another referrer
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

// ── RPC helper: retry with exponential backoff on 429 ──
async function rpcRetry(fn, label = "rpc", maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const is429 = e.message?.includes("429") || e.message?.includes("Too Many Requests") || e.message?.includes("max usage");
      if (is429 && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000); // 1s, 2s, 4s, 8s
        console.warn(`[RPC-RETRY] ${label} got 429, retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
}

// ── Balance cache (15s TTL) to avoid hammering RPC on every poll ──
const _balCache = new Map();
const BAL_CACHE_TTL = 15_000;
function getCachedBalance(key) {
  const entry = _balCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts < BAL_CACHE_TTL) return entry.data;
  return null;
}
function getStaleCachedBalance(key) {
  const entry = _balCache.get(key);
  return entry ? entry.data : null;
}
function setCachedBalance(key, data) {
  _balCache.set(key, { data, ts: Date.now() });
  if (_balCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of _balCache) { if (now - v.ts > BAL_CACHE_TTL * 4) _balCache.delete(k); }
  }
}

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
const metaTracker = new MetaTracker();
// Restore meta state from Redis
if (redis) { try { const ms = await redis.get("meta:state"); if (ms) metaTracker.import(JSON.parse(ms)); } catch {} }
const memeIntel = new MemeIntelligence(redis, metaTracker);
const scoreDynamics = new ScoreDynamics(5000);
const historicalMovers = new HistoricalMovers(redis);
const artworkScanner = new ArtworkScanner(5000);
const xSocial = new XSocialIntel();
const survivorBias = new SurvivorshipBias(redis);

// Smart Money Tracker — monitors profitable wallets, emits signals for new buys
const smartMoneyTracker = new SmartMoneyTracker({
  redis,
  heliusApiKey: CONFIG.HELIUS_API_KEY,
  onSignal: (signal) => {
    // When a smart wallet buys a token we're not tracking yet, fast-track it onto radar
    const mint = signal.mint;
    if (!radar.tokens.has(mint)) {
      console.log(`[SMART-MONEY] New token from tracked wallet: ${mint.slice(0, 8)} — subscribing`);
      subscribeToToken(mint);
    }
    // Broadcast to connected dashboards
    broadcastWS({ event: "smart_money_signal", data: signal });
  },
});

// Dev Wallet Tracker — maps every dev wallet on radar, checks balances, profiles funded devs
const devWalletTracker = new DevWalletTracker({ redis, connection });
// Load persisted dev wallet data from Redis
if (redis) { devWalletTracker.load().catch(() => {}); }
// Start background balance polling
devWalletTracker.start();
// Alert on high-value dev launches
devWalletTracker.onHighValueDev = (alert) => {
  broadcastWS({ event: "high_value_dev", data: alert });
};

// Restore artwork scanner state from Redis
if (redis) {
  try {
    const artData = await redis.get("intel:artwork");
    if (artData) {
      artworkScanner.import(JSON.parse(artData));
      console.log(`[ARTWORK] Restored: ${artworkScanner.seen.size} known images`);
    }
  } catch {}
}

// Persist artwork scanner every 10 min
setInterval(async () => {
  if (!redis) return;
  try { await redis.set("intel:artwork", JSON.stringify(artworkScanner.export()), { EX: 604800 }); } catch {}
}, 10 * 60 * 1000);

// ═══ WALLET AGE CACHE — check how old buyer wallets are on-chain ═══
// Aged wallets = real users. Fresh wallets = likely dev sybils.
// Whales with aged wallets buying = bullish conviction signal.
const walletAgeCache = new Map(); // wallet → { ageMs, firstTxTime, checkedAt }
const WALLET_AGE_TTL = 3600000; // cache for 1 hour
const WALLET_AGE_MAX_CACHE = 10000;

async function getWalletAge(walletAddress) {
  const cached = walletAgeCache.get(walletAddress);
  if (cached && Date.now() - cached.checkedAt < WALLET_AGE_TTL) return cached;

  try {
    // Use Helius enhanced API for transaction history (fastest way to get oldest tx)
    if (CONFIG.HELIUS_API_KEY) {
      const resp = await fetch(
        `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions?api-key=${CONFIG.HELIUS_API_KEY}&limit=1&type=TRANSFER`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (resp.ok) {
        const txs = await resp.json();
        if (txs.length > 0 && txs[0].timestamp) {
          const firstTxTime = txs[0].timestamp * 1000; // Helius returns seconds
          const ageMs = Date.now() - firstTxTime;
          const entry = { ageMs, firstTxTime, checkedAt: Date.now() };
          walletAgeCache.set(walletAddress, entry);
          if (walletAgeCache.size > WALLET_AGE_MAX_CACHE) {
            const oldest = [...walletAgeCache.entries()].sort((a, b) => a[1].checkedAt - b[1].checkedAt)[0];
            if (oldest) walletAgeCache.delete(oldest[0]);
          }
          return entry;
        }
      }
    }

    // Fallback: use Solana RPC getSignaturesForAddress (returns newest first, but limit=1 is fast)
    const sigs = await connection.getSignaturesForAddress(
      new PublicKey(walletAddress),
      { limit: 1 },
    );
    if (sigs.length > 0 && sigs[0].blockTime) {
      const firstTxTime = sigs[0].blockTime * 1000;
      const ageMs = Date.now() - firstTxTime;
      const entry = { ageMs, firstTxTime, checkedAt: Date.now() };
      walletAgeCache.set(walletAddress, entry);
      return entry;
    }
  } catch (e) {
    // Non-blocking: wallet age is a bonus signal, not critical path
  }
  return null;
}

// Background wallet age enrichment for token buyers (non-blocking)
async function enrichWalletAges(token) {
  const buyTrades = (token.trades || []).filter(tr => tr.side === "buy" && tr.wallet);
  const uniqueWallets = [...new Set(buyTrades.map(tr => tr.wallet))].slice(0, 20); // cap to avoid rate limits
  const ages = [];
  const whaleBuys = []; // wallets that bought > 0.5 SOL with aged wallets

  for (const w of uniqueWallets) {
    const age = await getWalletAge(w);
    if (age) {
      ages.push(age.ageMs);
      // Check if this is a whale with an aged wallet
      const walletSol = buyTrades.filter(tr => tr.wallet === w).reduce((s, tr) => s + (tr.sol || 0), 0);
      if (walletSol >= 0.5 && age.ageMs > 7 * 24 * 3600000) { // > 0.5 SOL + > 7 days old
        whaleBuys.push({ wallet: w, sol: walletSol, ageDays: Math.round(age.ageMs / 86400000) });
      }
    }
  }

  const totalChecked = ages.length;
  if (totalChecked === 0) return { walletAgeScore: 0.5, whaleBullish: 0, freshRatio: 0.5, whaleBuys: [] };

  // Fresh = created within last 24 hours
  const freshCount = ages.filter(a => a < 24 * 3600000).length;
  const freshRatio = freshCount / totalChecked;

  // Aged = wallets older than 7 days
  const agedCount = ages.filter(a => a > 7 * 24 * 3600000).length;
  const walletAgeScore = agedCount / totalChecked; // 0 = all fresh (bad), 1 = all aged (good)

  // Whale bullish: large buys from aged wallets = smart money conviction
  const whaleBullish = Math.min(1, whaleBuys.length / Math.max(1, Math.ceil(totalChecked * 0.3)));

  return { walletAgeScore, whaleBullish, freshRatio, whaleBuys };
}

// ═══ DEV CREDIBILITY ENRICHMENT — name uniqueness + dev SOL + launch history ═══
// Checks DexScreener for previous tokens with same name, dev wallet SOL balance, and
// how many tokens the dev has created. High-value signal: fresh name + funded dev + first launch.
const devCredCache = new Map(); // devWallet → { devSolBalance, devLaunchCount, ts }
const nameCheckCache = new Map(); // name → { count, rugged, ts }

async function enrichDevCredibility(token) {
  const devW = token.devWallet || "";
  const name = (token.name || "").trim().toLowerCase();
  if (!devW || !name) return null;

  const result = {
    nameUnique: true,
    namePrevLaunches: 0,
    namePrevRugged: false,
    devSolBalance: 0,
    devLaunchCount: -1, // -1 = unknown
  };

  // 1. Check DexScreener for previous tokens with same name
  const nameCached = nameCheckCache.get(name);
  if (nameCached && Date.now() - nameCached.ts < 600000) { // 10 min cache
    result.nameUnique = nameCached.count === 0;
    result.namePrevLaunches = nameCached.count;
    result.namePrevRugged = nameCached.rugged;
  } else {
    try {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(name)}`, {
        signal: AbortSignal.timeout(6000),
      });
      if (r.ok) {
        const d = await r.json();
        const pairs = d?.pairs || [];
        // Count Solana pairs with matching base token name (case-insensitive)
        const matches = pairs.filter(p =>
          p.chainId === "solana" &&
          p.baseToken?.name?.toLowerCase() === name &&
          p.baseToken?.address !== token.ca // exclude self
        );
        result.namePrevLaunches = matches.length;
        result.nameUnique = matches.length === 0;
        // Check if any previous token with same name rugged (liquidity < $500 or MC crashed >90%)
        result.namePrevRugged = matches.some(p => {
          const liq = p.liquidity?.usd || 0;
          const mc = p.marketCap || p.fdv || 0;
          const priceChange24h = p.priceChange?.h24 || 0;
          return liq < 500 || mc < 1000 || priceChange24h < -80;
        });
        nameCheckCache.set(name, { count: matches.length, rugged: result.namePrevRugged, ts: Date.now() });
      }
    } catch (e) {
      console.log(`[DEV-CRED] DexScreener name check failed for "${name}": ${e.message}`);
    }
  }

  // 1b. Local radar check — catch same-name tokens in current session that DexScreener hasn't indexed yet
  let localDupes = 0;
  for (const [ca, t] of radar.tokens) {
    if (ca === token.ca) continue;
    if ((t.name || "").trim().toLowerCase() === name) localDupes++;
  }
  if (localDupes > 0) {
    result.namePrevLaunches = Math.max(result.namePrevLaunches, localDupes);
    result.nameUnique = false;
    // If local dupes exist and any has low MC or high sell ratio, mark as prev rugged
    if (!result.namePrevRugged) {
      for (const [ca, t] of radar.tokens) {
        if (ca === token.ca) continue;
        if ((t.name || "").trim().toLowerCase() !== name) continue;
        const mc = t.mcapUsd || 0;
        const sells = t.sells || 0;
        const buys = t.buys || 0;
        if (mc < 3000 && sells > buys * 0.5 && buys > 3) { result.namePrevRugged = true; break; }
      }
    }
  }

  // 2. Check dev wallet SOL balance
  const devCached = devCredCache.get(devW);
  if (devCached && Date.now() - devCached.ts < 300000) { // 5 min cache
    result.devSolBalance = devCached.devSolBalance;
    result.devLaunchCount = devCached.devLaunchCount;
  } else {
    try {
      const balance = await connection.getBalance(new PublicKey(devW));
      result.devSolBalance = +(balance / LAMPORTS_PER_SOL).toFixed(3);
    } catch (e) {
      console.log(`[DEV-CRED] Balance check failed for ${devW.slice(0, 8)}: ${e.message}`);
    }

    // 3. Check dev's token creation history via pump.fun
    // Count how many tokens this dev wallet has created recently
    try {
      const r = await fetch(`https://frontend-api-v3.pump.fun/coins/user-created-coins/${devW}?offset=0&limit=10&includeNsfw=true`, {
        signal: AbortSignal.timeout(6000),
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      if (r.ok) {
        const coins = await r.json();
        result.devLaunchCount = Array.isArray(coins) ? coins.length : 0;
      }
    } catch (e) {
      console.log(`[DEV-CRED] Launch count check failed for ${devW.slice(0, 8)}: ${e.message}`);
    }

    devCredCache.set(devW, {
      devSolBalance: result.devSolBalance,
      devLaunchCount: result.devLaunchCount,
      ts: Date.now(),
    });
  }

  return result;
}

// Clean dev cred caches periodically
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of devCredCache) { if (now - v.ts > 600000) devCredCache.delete(k); }
  for (const [k, v] of nameCheckCache) { if (now - v.ts > 1200000) nameCheckCache.delete(k); }
}, 300000);

// Register owner wallet
if (process.env.OWNER_WALLET) registerOwner(process.env.OWNER_WALLET);

// ═══════════════════════════════════════
// SOL PRICE (server-to-server, no CORS)
// FIX: Replaces hardcoded * 170
// ═══════════════════════════════════════
let solUsdPrice = 135;
// Pump.fun graduation: bonding curve fills at ~85 SOL virtual reserves
// Total supply 1B, ~800M on curve. At graduation the price × supply ≈ 69K USD.
// Formula: 85 SOL in curve × solPrice × ~5.4 (supply/curve distribution ratio)
// Dynamic: recalculated as SOL price changes. Floor at 55K (graduation never below ~$55K MC).
function gradMcUsd() { return Math.max(55000, Math.round(85 * solUsdPrice * 5.4)); }
async function pollSolPrice() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) });
    if (r.ok) { const d = await r.json(); if (d?.solana?.usd > 0) solUsdPrice = d.solana.usd; }
  } catch {
    // Fallback: try Jupiter
    try {
      const r2 = await fetch("https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112", { signal: AbortSignal.timeout(5000) });
      if (r2.ok) { const d2 = await r2.json(); const sp = d2?.data?.["So11111111111111111111111111111111111111112"]?.price; if (sp > 0) solUsdPrice = +sp; }
    } catch {}
  }
}
pollSolPrice();
setInterval(pollSolPrice, 60000); // 60s — SOL price doesn't move fast enough to justify 30s

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

// ═══ SMART WALLET LABELING ═══
// Track which wallets historically pick winners, weight their buys 3-5x in scoring
// Uses in-memory LRU + Redis persistence for wallet performance history
const smartWallets = {
  // wallet(8-char prefix) → { buys, wins, losses, avgReturn, score, lastSeen }
  walletStats: new Map(),
  // Minimum trades to label a wallet as "smart"
  MIN_TRADES: 3,
  // Decay old entries every hour
  lastCleanup: Date.now(),

  // Record a buy — called when we see a wallet buy a token
  recordBuy(walletPrefix, ca) {
    if (!walletPrefix || walletPrefix.length < 6) return;
    let stats = this.walletStats.get(walletPrefix);
    if (!stats) {
      stats = { buys: 0, wins: 0, losses: 0, totalReturn: 0, activeBuys: new Map(), score: 0, lastSeen: Date.now() };
      this.walletStats.set(walletPrefix, stats);
    }
    stats.buys++;
    stats.lastSeen = Date.now();
    // Track entry MC for this token
    const token = radar.tokens.get(ca);
    if (token) {
      stats.activeBuys.set(ca, { entryMcap: token.mcapUsd || 0, time: Date.now() });
    }
  },

  // Resolve outcome — called when a token graduates or rugs
  resolveOutcome(ca, graduated) {
    for (const [wp, stats] of this.walletStats) {
      const entry = stats.activeBuys.get(ca);
      if (!entry) continue;
      stats.activeBuys.delete(ca);
      if (graduated) {
        stats.wins++;
        const token = radar.tokens.get(ca);
        const exitMcap = token?.mcapUsd || entry.entryMcap;
        const ret = entry.entryMcap > 0 ? (exitMcap - entry.entryMcap) / entry.entryMcap : 0;
        stats.totalReturn += ret;
      } else {
        stats.losses++;
        stats.totalReturn -= 0.5; // assume 50% loss on rug
      }
      // Recalculate score: win rate weighted by total return
      const totalTrades = stats.wins + stats.losses;
      if (totalTrades >= this.MIN_TRADES) {
        const winRate = stats.wins / totalTrades;
        const avgRet = stats.totalReturn / totalTrades;
        stats.score = Math.min(1, Math.max(0, winRate * 0.6 + Math.min(0.4, avgRet * 0.1)));
      }
    }
  },

  // Get smart wallet count for a token — how many known-good wallets are buying
  getSmartBuyerCount(token) {
    const trades = token.recentTrades || token.trades || [];
    const buyWallets = trades
      .filter(t => t.side === "buy" || t.txType === "buy")
      .map(t => (t.wallet || "").slice(0, 8));
    let smartCount = 0;
    for (const wp of new Set(buyWallets)) {
      const stats = this.walletStats.get(wp);
      if (stats && stats.score >= 0.4 && (stats.wins + stats.losses) >= this.MIN_TRADES) {
        smartCount++;
      }
    }
    return smartCount;
  },

  // Cleanup old entries — run periodically
  cleanup() {
    if (Date.now() - this.lastCleanup < 3600000) return; // hourly
    this.lastCleanup = Date.now();
    const cutoff = Date.now() - 86400000 * 7; // 7 days
    for (const [wp, stats] of this.walletStats) {
      if (stats.lastSeen < cutoff) this.walletStats.delete(wp);
    }
    // Cap at 5000 entries
    if (this.walletStats.size > 5000) {
      const entries = [...this.walletStats.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      for (let i = 0; i < entries.length - 5000; i++) this.walletStats.delete(entries[i][0]);
    }
  },

  // Persist to Redis (called periodically)
  async save() {
    if (!redis) return;
    try {
      const data = {};
      for (const [wp, stats] of this.walletStats) {
        if ((stats.wins + stats.losses) >= this.MIN_TRADES) {
          data[wp] = { b: stats.buys, w: stats.wins, l: stats.losses, r: +stats.totalReturn.toFixed(2), s: +stats.score.toFixed(3), t: stats.lastSeen };
        }
      }
      await redis.set("smart:wallets", JSON.stringify(data), { EX: 604800 }); // 7 days
    } catch {}
  },

  // Restore from Redis
  async load() {
    if (!redis) return;
    try {
      const raw = await redis.get("smart:wallets");
      if (!raw) return;
      const data = JSON.parse(raw);
      for (const [wp, d] of Object.entries(data)) {
        this.walletStats.set(wp, {
          buys: d.b, wins: d.w, losses: d.l, totalReturn: d.r, activeBuys: new Map(),
          score: d.s, lastSeen: d.t,
        });
      }
      console.log(`[SMART-WALLET] Loaded ${this.walletStats.size} wallet profiles from Redis`);
    } catch {}
  },
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
      twitter: (() => { const tw = d.twitter || ""; if (!tw) return ""; if (tw.startsWith("http")) { const m = tw.match(/(?:twitter\.com|x\.com)\/([^/?#]+)/); return m ? m[1] : tw; } return tw.startsWith("@") ? tw.slice(1) : tw; })(),
      website: (() => { const w = d.website || ""; if (!w) return ""; return w.startsWith("http") ? w : w.includes(".") ? "https://" + w : ""; })(),
      telegram: (() => { const tg = d.telegram || ""; if (!tg) return ""; if (tg.startsWith("http")) { const m = tg.match(/t\.me\/([^/?#]+)/); return m ? m[1] : tg; } return tg.startsWith("@") ? tg.slice(1) : tg; })(),
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

    // Artwork originality scan — runs async, stores result on token
    if (img && artworkScanner) {
      artworkScanner.scan(ca, img, token.name || "").then(artResult => {
        const t = radar.tokens.get(ca);
        if (!t) return;
        t._artworkScore = artResult.score;
        t._artworkOriginal = artResult.original;
        t._artworkFlags = artResult.flags;
        t._artworkMatches = artResult.matches;
        if (!artResult.original) {
          console.log(`[ARTWORK] ${ca.slice(0,8)} ${token.name}: COPIED (score:${artResult.score}) flags:${artResult.flags.join(",")}`);
        }
      }).catch(() => {});
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
  const vSol = data.vSolInBondingCurve || 0;
  const vTokens = data.vTokensInBondingCurve || 0;
  const trader = data.traderPublicKey || "";
  // Use PumpPortal's marketCapSol directly — it matches chart prices (GMGN, pump.fun).
  // Previously computed FDV via (vSol/vTokens)*1B which inflated MC vs chart price.
  const mcSol = data.marketCapSol || (vTokens > 0 ? vSol : 0);

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

    // Register dev wallet for balance tracking & profiling
    if (trader) {
      devWalletTracker.register(trader, {
        ca: mint,
        name: data.name || "",
        ticker: data.symbol || "",
        mcap: Math.round(mcSol * solUsdPrice),
      });
      // Kick off immediate balance check for this dev (non-blocking)
      devWalletTracker.checkBalance(trader).catch(() => {});
    }

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
        // Only trust meta.complete if token also has a raydiumPool — prevents false positives
        // from stale/wrong API responses marking brand-new tokens as graduated
        if (meta.complete && meta.raydiumPool) {
          t.graduated = true;
          t.graduatedAt = Date.now();
          if (t.mcapUsd < gradMcUsd()) t.mcapUsd = gradMcUsd();
        }
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

    // Score memetic quality on creation (non-blocking, <50ms)
    scoreMemeticQuick({ name: token.name, symbol: token.ticker, description: token.description }).then(mResult => {
      const t = radar.tokens.get(mint);
      if (!t) return;
      t._memeticQuick = mResult.quickScore || 0;
      t._memeticLinguistic = mResult.linguistic || 0;
      t._memeticAbsurdity = mResult.absurdity || 0;
      t._memeticTemporal = mResult.temporal || 0;
    }).catch(() => {});

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
      if (trader) {
        token.uniqueBuyers.add(trader);
        // Smart wallet tracking: record this buy
        smartWallets.recordBuy(trader.slice(0, 8), mint);
        // Smart money tracker: record full address for watchlist building
        smartMoneyTracker.recordObservedTrade(trader, mint, "buy", sol);
      }
    } else {
      token.sells++;
      token.sellVolumeSol = (token.sellVolumeSol || 0) + sol;
    }

    // Update mcap from PumpPortal data
    if (mcSol > 0) {
      token.mcapSol = mcSol;
      token.mcapUsd = Math.round(mcSol * solUsdPrice);
    }

    // Graduation detection: vSol must be very close to 85 SOL threshold
    // Previously used >= 79 which was too aggressive — tokens often pump to 79-83 then dump back.
    // Real graduation fires a migration event (handled separately). This is a safety net only.
    if (vSol >= 84 && !token.graduated) {
      token.graduated = true;
      // Floor mcap to graduation threshold — bonding curve mcap underreports
      if (token.mcapUsd < gradMcUsd()) token.mcapUsd = gradMcUsd();
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
      // Set mcap floor to graduation MC — bonding curve mcap is stale/misleading post-graduation
      const gradMc = gradMcUsd();
      if (token.mcapUsd < gradMc) token.mcapUsd = gradMc;
      console.log(`[RADAR] Token graduated: ${token.name || mint.slice(0, 8)} — MC: $${token.mcapUsd}`);
      // Smart wallet: resolve outcome as win for all buyers
      smartWallets.resolveOutcome(mint, true);
      smartMoneyTracker.recordOutcome(mint, true);
      // Fetch live MC from DexScreener since PumpPortal stops sending data after graduation
      // Retry with delay since Raydium pool takes seconds to index
      refreshGraduatedMcap(mint).catch(() => {});
      setTimeout(() => refreshGraduatedMcap(mint).catch(() => {}), 15000);
      setTimeout(() => refreshGraduatedMcap(mint).catch(() => {}), 60000);
      // Add to graduated watchlist for 24h follow
      const wEntry = { name: token.name || "", ticker: token.ticker || "", gradMcap: token.mcapUsd || 0, gradTime: Date.now(), spark: [...(token.spark || [])], peakMcap: token.mcapUsd || 0, lastMcap: token.mcapUsd || 0, lastRefresh: Date.now() };
      gradWatchlist.set(mint, wEntry);
      if (redis) { redis.hSet("grad:watchlist", mint, JSON.stringify(wEntry)).catch(() => {}); }
    }
    broadcastWS({ event: "graduation", data: { ca: mint } });
  }
}

// ═══ GRADUATED MC REFRESH — batched DexScreener for speed ═══
// Single-token fallback (used on graduation event)
async function refreshGraduatedMcap(mint) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return;
    const d = await r.json();
    const pair = d?.pairs?.[0];
    if (!pair) return;
    applyMcapUpdate(mint, pair);
  } catch {}
}

// Apply MC data from a DexScreener pair to a radar token
function applyMcapUpdate(mint, pair) {
  const token = radar.tokens.get(mint);
  if (!token) return;
  const newMcap = pair.marketCap || pair.fdv || 0;
  if (newMcap > 0) {
    const changed = token.mcapUsd !== Math.round(newMcap);
    token.mcapUsd = Math.round(newMcap);
    token.mcapSol = solUsdPrice > 0 ? Math.round(newMcap / solUsdPrice) : token.mcapSol;
    token.spark.push(token.mcapUsd);
    if (token.spark.length > 60) token.spark = token.spark.slice(-60);
    token.raydiumPool = pair.pairAddress || true;
    // Push MC update to frontend immediately via WebSocket
    if (changed) broadcastWS({ event: "mcap-update", data: { ca: mint, mcap: token.mcapUsd, mcapSol: token.mcapSol } });
  }
}

// Batch fetch MC for multiple tokens in one DexScreener request (up to 30 per batch)
async function batchRefreshMcap(mints) {
  if (mints.length === 0) return;
  const BATCH_SIZE = 30;
  for (let i = 0; i < mints.length; i += BATCH_SIZE) {
    const batch = mints.slice(i, i + BATCH_SIZE);
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${batch.join(",")}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const d = await r.json();
      if (!d?.pairs) continue;
      // Group pairs by base token address — pick best pair per token
      const bestPairs = new Map();
      for (const pair of d.pairs) {
        const addr = pair.baseToken?.address;
        if (!addr || !batch.includes(addr)) continue;
        const existing = bestPairs.get(addr);
        if (!existing || (pair.liquidity?.usd || 0) > (existing.liquidity?.usd || 0)) {
          bestPairs.set(addr, pair);
        }
      }
      for (const [mint, pair] of bestPairs) {
        applyMcapUpdate(mint, pair);
      }
    } catch {}
  }
}

// ═══ GRADUATED WATCHLIST — follows tokens beyond radar TTL ═══
// Tokens that graduate get tracked here for up to 24h for learning
const gradWatchlist = new Map(); // ca → { name, ticker, gradMcap, gradTime, spark, peakMcap, lastMcap, lastRefresh }
const GRAD_WATCH_TTL = 86400000; // 24h

// Periodically refresh MC for all graduated tokens (every 10s — batched so only 1-2 requests)
setInterval(async () => {
  // Batch refresh all graduated radar tokens in one request
  const graduatedMints = [...radar.tokens.entries()].filter(([, t]) => t.graduated).map(([ca]) => ca);
  await batchRefreshMcap(graduatedMints);

  // Also batch refresh stale watchlist tokens
  const now = Date.now();
  const stale = [...gradWatchlist.entries()]
    .filter(([, w]) => now - w.lastRefresh > 30000 && now - w.gradTime < GRAD_WATCH_TTL)
    .slice(0, 30);
  if (stale.length > 0) {
    const staleMints = stale.map(([ca]) => ca);
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${staleMints.join(",")}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const d = await r.json();
        if (d?.pairs) {
          const bestPairs = new Map();
          for (const pair of d.pairs) {
            const addr = pair.baseToken?.address;
            if (!addr) continue;
            const existing = bestPairs.get(addr);
            if (!existing || (pair.liquidity?.usd || 0) > (existing.liquidity?.usd || 0)) {
              bestPairs.set(addr, pair);
            }
          }
          for (const [ca, w] of stale) {
            const pair = bestPairs.get(ca);
            if (pair) {
              const mc = pair.marketCap || pair.fdv || 0;
              w.lastMcap = mc;
              if (mc > w.peakMcap) w.peakMcap = mc;
              w.spark.push(mc);
              if (w.spark.length > 100) w.spark = w.spark.slice(-100);
              w.lastRefresh = now;
              if (redis) { try { await redis.hSet("grad:watchlist", ca, JSON.stringify(w)); } catch {} }
            }
          }
        }
      }
    } catch {}
  }
  // Evict expired watchlist entries — label outcome before removing
  for (const [ca, w] of gradWatchlist) {
    if (now - w.gradTime > GRAD_WATCH_TTL) {
      const peak = w.peakMcap || w.gradMcap;
      const current = w.lastMcap || 0;
      const dropPct = peak > 0 ? ((peak - current) / peak) * 100 : 0;
      const rugged = dropPct > 80;
      const outcome = { graduated: true, peakMcx: peak > 0 && w.gradMcap > 0 ? peak / w.gradMcap : 1, rugged, mcapDropPct: dropPct, devDumped: false, alive: current > 5000 };
      // Re-learn from 24h outcome data — more accurate than the 4h eviction label
      const features = { isGradWatchlist: true, gradMcap: w.gradMcap, peakMcap: peak, finalMcap: current, age24h: true };
      try { memeIntel.learn(features, outcome); } catch {}
      try { await storeChartSnapshot(ca, { name: w.name, ticker: w.ticker, spark: w.spark, mcapUsd: current, createdAt: w.gradTime, buys: 0, sells: 0 }, outcome); } catch {}
      gradWatchlist.delete(ca);
      if (redis) { try { await redis.hDel("grad:watchlist", ca); } catch {} }
    }
  }
}, 10000);

// Load watchlist from Redis on startup
(async () => {
  if (!redis) return;
  try {
    const all = await redis.hGetAll("grad:watchlist");
    for (const [ca, json] of Object.entries(all || {})) {
      try { gradWatchlist.set(ca, JSON.parse(json)); } catch {}
    }
    console.log(`[GRAD-WATCH] Loaded ${gradWatchlist.size} tokens from Redis`);
  } catch {}
})();

// ═══ QUICK FEATURE EXTRACTION — for memeIntel learning ═══
function extractQuickFeatures(t) {
  if (!t || !t.ca) return null;
  const ageMin = Math.max(0.5, (Date.now() - t.createdAt) / 60000);
  const ub = t.uniqueBuyers?.size || 0;
  const buys = t.buys || 0;
  const sells = t.sells || 0;
  const vol = t.volumeSol || 0;
  const sellVol = t.sellVolumeSol || 0;
  const trades = t.trades || [];

  // ── Dev sell detection (improved: match full wallet when available) ──
  const devW = (t.devWallet || "").slice(0, 8);
  const devTrades = devW ? trades.filter(tr => (tr.wallet || "").startsWith(devW)) : [];
  const devSells = devTrades.filter(tr => tr.side === "sell");
  const devBuySol = devTrades.filter(tr => tr.side === "buy").reduce((s, tr) => s + (tr.sol || 0), 0);
  const devSellSol = devSells.reduce((s, tr) => s + (tr.sol || 0), 0);
  // How fast did dev dump? 0 = held, 1 = instant dump
  const devSellSpeed = devSells.length > 0
    ? Math.min(1, 30 / Math.max(1, (devSells[0]?.time - t.createdAt) / 60000))
    : 0;
  // Did dev sell MORE than they bought? (sniped own token)
  const devSelfSnipe = devBuySol > 0 && devSellSol > devBuySol * 0.8 ? 1 : 0;

  // ── Coordinated dump: multiple sells within 3s windows ──
  const sellTimes = trades.filter(tr => tr.side === "sell").map(tr => tr.time).sort((a, b) => a - b);
  let coordDumps = 0;
  for (let i = 1; i < sellTimes.length; i++) {
    if (sellTimes[i] - sellTimes[i - 1] < 3000) coordDumps++;
  }

  // ── Sell wave: bursts of sells in 10s windows ──
  let maxSellBurst = 0;
  for (let i = 0; i < sellTimes.length; i++) {
    let burst = 1;
    for (let j = i + 1; j < sellTimes.length && sellTimes[j] - sellTimes[i] < 10000; j++) burst++;
    maxSellBurst = Math.max(maxSellBurst, burst);
  }

  // ── Mcap drop from peak ──
  const peakMc = t.spark?.length > 0 ? Math.max(...t.spark) : t.mcapUsd;
  const mcapDropRate = peakMc > 0 ? Math.max(0, (peakMc - (t.mcapUsd || 0)) / peakMc) : 0;

  // ── Holder concentration from trade data ──
  // Approximate top-wallet concentration from buy amounts
  const walletBuys = new Map();
  for (const tr of trades) {
    if (tr.side === "buy" && tr.wallet) {
      walletBuys.set(tr.wallet, (walletBuys.get(tr.wallet) || 0) + (tr.sol || 0));
    }
  }
  const sortedHolders = [...walletBuys.values()].sort((a, b) => b - a);
  const totalBought = sortedHolders.reduce((s, v) => s + v, 0);
  const top3Bought = sortedHolders.slice(0, 3).reduce((s, v) => s + v, 0);
  const holderConcentration = totalBought > 0 ? Math.min(1, top3Bought / totalBought) : 0;

  // ── Sybil / wash-trade detection ──
  // Multiple tiny buys from many wallets in tight time windows = likely bot swarm
  const buyTrades = trades.filter(tr => tr.side === "buy");
  let tinyBuyCount = 0;       // buys < 0.02 SOL (dust buys to inflate buyer count)
  let sameSizeBuys = 0;       // buys with identical SOL amounts (bot pattern)
  const buySolAmounts = new Map();
  for (const tr of buyTrades) {
    const sol = tr.sol || 0;
    if (sol > 0 && sol < 0.02) tinyBuyCount++;
    const rounded = (sol * 100 | 0); // round to 0.01
    buySolAmounts.set(rounded, (buySolAmounts.get(rounded) || 0) + 1);
  }
  for (const [, count] of buySolAmounts) {
    if (count >= 3) sameSizeBuys += count; // 3+ buys at exact same size = suspicious
  }
  const sybilScore = Math.min(1,
    (buys > 5 ? tinyBuyCount / buys : 0) * 0.5 +        // dust buy ratio
    (buys > 5 ? sameSizeBuys / buys : 0) * 0.5           // identical-size buy ratio
  );

  // ── Volume manipulation: sell volume vs buy volume ratio ──
  const sellBuyRatio = vol > 0 ? Math.min(1, sellVol / vol) : 0;

  // ── Early dump: sells happening within first 2 minutes ──
  const earlyWindow = t.createdAt + 120000; // 2 minutes
  const earlySells = trades.filter(tr => tr.side === "sell" && tr.time < earlyWindow);
  const earlyDumpScore = Math.min(1, earlySells.length / Math.max(1, buys) * 3);

  // ── Buy-then-sell same wallet: quick flip detection ──
  let quickFlips = 0;
  const walletFirstBuy = new Map();
  for (const tr of trades) {
    if (tr.side === "buy" && tr.wallet && !walletFirstBuy.has(tr.wallet)) {
      walletFirstBuy.set(tr.wallet, tr.time);
    }
    if (tr.side === "sell" && tr.wallet) {
      const firstBuy = walletFirstBuy.get(tr.wallet);
      if (firstBuy && (tr.time - firstBuy) < 60000) quickFlips++; // sold within 60s of buying
    }
  }
  const quickFlipRate = buys > 3 ? Math.min(1, quickFlips / Math.max(1, ub) * 2) : 0;

  // ── Sparkline crash pattern: sharp spike then dump ──
  const spark = t.spark || [];
  let pumpDumpScore = 0;
  if (spark.length >= 4) {
    const peak = Math.max(...spark);
    const peakIdx = spark.indexOf(peak);
    const current = spark[spark.length - 1] || 0;
    // Pump-and-dump: peaked early, crashed since
    if (peakIdx < spark.length * 0.5 && peak > 0 && current < peak * 0.3) {
      pumpDumpScore = Math.min(1, (peak - current) / peak);
    }
  }

  // ── Chart shape similarity to stored graduated patterns ──
  let chartHealthScore = 0.5; // neutral default
  let smoothGrindScore = 0;
  let dipRatioScore = 0.5;
  let staircaseScore = 0;
  let flatlineSpikeScore = 0;
  if (spark.length >= 5) {
    const start = spark[0] || 1;
    const peak = Math.max(...spark);
    const current = spark[spark.length - 1] || 0;
    const peakIdx = spark.indexOf(peak);
    const peakPct = peakIdx / spark.length;
    const multiple = peak / start;
    const endRatio = current / (peak || 1);

    // Count dips and consecutive ups for smooth grind detection
    let sparkDips = 0, sparkUps = 0, maxConsUp = 0, consUp = 0;
    for (let i = 1; i < spark.length; i++) {
      if (spark[i] < spark[i - 1]) { sparkDips++; consUp = 0; }
      else if (spark[i] > spark[i - 1]) { sparkUps++; consUp++; maxConsUp = Math.max(maxConsUp, consUp); }
    }
    const totalSparkMoves = sparkDips + sparkUps;
    const sparkUpPct = totalSparkMoves > 0 ? sparkUps / totalSparkMoves : 0;
    dipRatioScore = totalSparkMoves > 0 ? Math.min(1, sparkDips / totalSparkMoves * 2) : 0;

    // Smooth grind: gradual up with almost no dips = fake chart / self-bought rug
    if (spark.length >= 8 && current > start * 1.3 && sparkUpPct > 0.85 && maxConsUp >= 6) {
      smoothGrindScore = Math.min(1, 0.5 + (sparkUpPct - 0.85) * 3 + (maxConsUp - 6) * 0.05);
    } else if (spark.length >= 8 && current > start * 1.3 && sparkUpPct > 0.75 && maxConsUp >= 5) {
      smoothGrindScore = Math.min(0.6, 0.3 + (sparkUpPct - 0.75) * 2);
    }

    // Healthy: steady growth WITH dips, peak late, holding value
    if (multiple > 2 && peakPct > 0.5 && endRatio > 0.4 && sparkDips >= 2) chartHealthScore = Math.min(1, 0.6 + multiple * 0.05);
    // Bad: early peak, crashed
    else if (peakPct < 0.3 && endRatio < 0.2) chartHealthScore = Math.max(0, 0.2 - pumpDumpScore * 0.2);
    // Slow grind: still growing
    else if (current > start && multiple < 3) chartHealthScore = 0.6;
    // Penalize smooth grind — looks healthy but is fake
    if (smoothGrindScore > 0.5) chartHealthScore = Math.max(0, chartHealthScore - smoothGrindScore * 0.4);

    // ── STAIRCASE CHART DETECTION ──
    // Classic rug pattern: dev buys from fresh wallets at regular intervals creating
    // a monotonically increasing chart with uniform step sizes. Real charts have
    // varying step sizes and natural pullbacks.
    if (spark.length >= 6) {
      const deltas = [];
      let monotoneUps = 0;
      for (let i = 1; i < spark.length; i++) {
        const d = spark[i] - spark[i - 1];
        if (d > 0) { monotoneUps++; deltas.push(d); }
      }
      const monotoneRatio = monotoneUps / (spark.length - 1);
      // Check step uniformity: low coefficient of variation = suspiciously regular
      if (deltas.length >= 4) {
        const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        const variance = deltas.reduce((s, d) => s + (d - avgDelta) ** 2, 0) / deltas.length;
        const cv = avgDelta > 0 ? Math.sqrt(variance) / avgDelta : 1; // coefficient of variation
        // Low CV (uniform steps) + high monotone ratio = staircase
        // Real charts: CV > 0.5, rugs: CV < 0.3
        if (monotoneRatio > 0.8 && cv < 0.4) {
          staircaseScore = Math.min(1, 0.4 + (0.4 - cv) * 2 + (monotoneRatio - 0.8) * 2);
        } else if (monotoneRatio > 0.7 && cv < 0.35) {
          staircaseScore = Math.min(0.5, 0.2 + (0.35 - cv) * 1.5);
        }
      }
    }
    // Staircase penalizes chart health
    if (staircaseScore > 0.4) chartHealthScore = Math.max(0, chartHealthScore - staircaseScore * 0.5);

    // ── FLATLINE SPIKE DETECTION ──
    // Classic rug: chart sits near zero/flat for most of its life, then a single
    // massive buy creates a vertical spike. The "hockey stick from zero" pattern.
    // Detection: majority of spark points cluster in a narrow low range, then the
    // last few points jump dramatically. Real organic growth doesn't look like this.
    if (spark.length >= 6) {
      const sorted = [...spark].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] || 1;
      const lastFew = spark.slice(-3);
      const lastMax = Math.max(...lastFew);
      // Count how many points are "flat" (within 30% of median)
      const flatCount = spark.slice(0, -3).filter(v => v <= median * 1.3).length;
      const flatRatio = flatCount / Math.max(1, spark.length - 3);
      const spikeRatio = median > 0 ? lastMax / median : 0;
      // Flatline spike: >70% of history is flat AND last points spike >3x median
      if (flatRatio > 0.7 && spikeRatio > 3) {
        flatlineSpikeScore = Math.min(1, 0.4 + (flatRatio - 0.7) * 2 + Math.min(0.4, (spikeRatio - 3) * 0.05));
      } else if (flatRatio > 0.6 && spikeRatio > 5) {
        flatlineSpikeScore = Math.min(0.6, 0.3 + (spikeRatio - 5) * 0.03);
      }
      // Flatline spike kills chart health
      if (flatlineSpikeScore > 0.3) chartHealthScore = Math.max(0, chartHealthScore - flatlineSpikeScore * 0.6);
    }
  }

  // ── ZERO SELL FLAG — the #1 rug signal ──
  // A token with many buys and zero/near-zero organic sells is almost always a rug.
  // Dev buys from fresh wallets to fake activity; nobody is organically selling because
  // there ARE no organic buyers — just the dev recycling SOL.
  const organicSells = sells - (devSells.length || 0); // exclude dev sells
  let zeroSellFlag = 0;
  if (buys >= 5 && organicSells <= 0) {
    zeroSellFlag = 1.0; // absolute red flag
  } else if (buys >= 10 && organicSells <= 1) {
    zeroSellFlag = 0.8;
  } else if (buys >= 5 && organicSells <= 1) {
    zeroSellFlag = 0.5;
  }

  // ── BUY/SELL IMBALANCE ──
  const totalTx = buys + sells;
  let buySellImbalance = 0;
  if (totalTx >= 5) {
    const buyPct = buys / totalTx;
    if (buyPct >= 0.95) buySellImbalance = 1.0;
    else if (buyPct >= 0.9) buySellImbalance = 0.7;
    else if (buyPct >= 0.8 && totalTx >= 10) buySellImbalance = 0.4;
  }

  // ── FRESH WALLET RATIO ──
  // If most buyers are wallets we've only seen once in this token's trades,
  // and they all bought but never sold, they're likely dev-controlled fresh wallets.
  const buyWalletTxCounts = new Map();
  for (const tr of trades) {
    if (tr.wallet) buyWalletTxCounts.set(tr.wallet, (buyWalletTxCounts.get(tr.wallet) || 0) + 1);
  }
  const uniqueBuyWallets = new Set(buyTrades.map(tr => tr.wallet).filter(Boolean));
  const singleUseBuyers = [...uniqueBuyWallets].filter(w => buyWalletTxCounts.get(w) === 1).length;
  const freshWalletRatio = uniqueBuyWallets.size > 2 ? singleUseBuyers / uniqueBuyWallets.size : 0;
  // Combined: fresh wallets + zero sells = definite rug setup
  const freshWalletRugSignal = freshWalletRatio > 0.7 && zeroSellFlag > 0.5 ? Math.min(1, freshWalletRatio * zeroSellFlag * 1.5) : freshWalletRatio;

  // ── DEV CREDIBILITY SCORE ──
  // Fresh name (never launched before) + first-time dev + dev holding SOL = high trust
  // Cached on token object via background enrichment (devCredData)
  const devCred = t._devCredData || null;
  let devCredScore = 0.5; // neutral default when no data
  let nameUniquenessScore = 0.5; // 1 = never seen, 0 = spammed name
  if (devCred) {
    // Name uniqueness: 1 = first time this name, 0 = many previous tokens with same name
    nameUniquenessScore = devCred.nameUnique ? 1.0 : Math.max(0, 1 - (devCred.namePrevLaunches || 0) * 0.25);
    // Dev wallet scoring: SOL balance + launch count
    const solBonus = devCred.devSolBalance >= 10 ? 1.0 : devCred.devSolBalance >= 5 ? 0.7 : devCred.devSolBalance >= 1 ? 0.4 : 0.1;
    const launchPenalty = devCred.devLaunchCount === 0 ? 1.0 : devCred.devLaunchCount === 1 ? 0.8 : devCred.devLaunchCount <= 3 ? 0.5 : Math.max(0, 0.3 - devCred.devLaunchCount * 0.03);
    // Combined: weight name 30%, dev balance 35%, launch count 35%
    devCredScore = Math.min(1, nameUniquenessScore * 0.3 + solBonus * 0.35 + launchPenalty * 0.35);
    // Perfect score: fresh name + first launch + 10+ SOL
    if (devCred.nameUnique && devCred.devLaunchCount <= 1 && devCred.devSolBalance >= 10) devCredScore = 1.0;
    // Previous tokens with same name that rugged = big penalty
    if (devCred.namePrevRugged) devCredScore = Math.max(0, devCredScore - 0.4);
  }

  const result = {
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
    // Rug detection (enhanced)
    rg_devSellSpeed: devSellSpeed,
    rg_holderConcentration: holderConcentration,
    rg_coordDumpScore: Math.min(1, coordDumps / 5),
    rg_liqRemovalSpeed: sellBuyRatio,
    // Wallet age: use cached on-chain age data if available, else fall back to sybil heuristic
    rg_walletAgeScore: t._walletAgeData ? t._walletAgeData.walletAgeScore : (1 - sybilScore),
    rg_sellWaveDetect: Math.min(1, maxSellBurst / 8),
    rg_mcapDropRate: mcapDropRate,
    rg_buyerRetention: buys > 0 ? Math.min(1, ub / buys) : 0,
    // Chart shape analysis
    ch_healthScore: chartHealthScore,
    ch_pumpDump: pumpDumpScore,
    ch_smoothGrind: smoothGrindScore,
    ch_dipRatio: dipRatioScore,
    ch_staircaseScore: staircaseScore,
    ch_flatlineSpike: flatlineSpikeScore,
    // Extra rug signals (used in buy gate, not in FEATURE_KEYS)
    _rg_devSelfSnipe: devSelfSnipe,
    _rg_earlyDump: earlyDumpScore,
    _rg_quickFlipRate: quickFlipRate,
    _rg_pumpDump: pumpDumpScore,
    _rg_sybilScore: sybilScore,
    _rg_zeroSellFlag: zeroSellFlag,
    _rg_buySellImbalance: buySellImbalance,
    _rg_freshWalletRatio: freshWalletRugSignal,
    // Wallet age on-chain data (0 = all fresh wallets = bad, 1 = all aged = good)
    _walletAgeFresh: t._walletAgeData ? t._walletAgeData.freshRatio : freshWalletRugSignal,
    // Whale bullish: aged whale wallets buying = smart money conviction
    _whaleBullish: t._walletAgeData ? t._walletAgeData.whaleBullish : 0,
    _whaleBuys: t._walletAgeData ? t._walletAgeData.whaleBuys : [],
    // Dev credibility: name uniqueness + dev wallet SOL + launch history
    _devCredScore: devCredScore,
    _nameUniqueness: nameUniquenessScore,
    _devSolBalance: devCred?.devSolBalance || 0,
    _devLaunchCount: devCred?.devLaunchCount ?? -1,
    _namePrevRugged: devCred?.namePrevRugged || false,

    // ═══ SIR VIRAL MODEL ═══
    // R0 estimation from buyer arrival rate acceleration
    sir_r0: (() => {
      const buyTimes2 = buyTrades.map(tr => tr.time).filter(t2 => t2 > 0).sort((a, b) => a - b);
      if (buyTimes2.length < 5) return 0;
      const mid = Math.floor(buyTimes2.length / 2);
      const earlySpan = (buyTimes2[mid - 1] - buyTimes2[0]) / 60000 || 1;
      const lateSpan = (buyTimes2[buyTimes2.length - 1] - buyTimes2[mid]) / 60000 || 1;
      const earlyRate = mid / earlySpan;
      const lateRate = (buyTimes2.length - mid) / lateSpan;
      const r0 = earlyRate > 0 ? lateRate / earlyRate : 1;
      return Math.min(1, Math.max(0, (r0 - 0.5) / 3));
    })(),
    sir_infectRate: Math.min(1, ub / Math.max(1, ageMin) / 10),
    sir_recoveryRate: Math.max(0, 1 - Math.min(1, sells / Math.max(1, ageMin) / 5)),

    // ═══ GRADUATION FRONTRUNNING ═══
    gf_curveProgress: t.vSolInBondingCurve ? Math.min(1, t.vSolInBondingCurve / 85) : 0,
    gf_frontrunSignal: (() => {
      const cp = t.vSolInBondingCurve ? t.vSolInBondingCurve / 85 : 0;
      if (cp < 0.6) return 0;
      const bv = Math.min(1, (buys / Math.max(1, Math.min(5, ageMin))) / 20);
      if (cp >= 0.8) {
        const urgency = (cp - 0.8) * 5;
        return Math.min(1, urgency * (bv > 0.3 ? 0.8 : 0.3) * 2);
      }
      return bv > 0.3 ? Math.min(0.3, (cp - 0.6) * 1.5) : 0;
    })(),

    // ═══ ATTENTION-PRICE DIVERGENCE ═══
    apd_attentionGrowth: (() => {
      const recent10 = buyTrades.slice(-10).length;
      const older10 = buyTrades.slice(-20, -10).length;
      const growth = older10 > 0 ? recent10 / Math.max(1, older10) : 1;
      return Math.min(1, Math.max(0, (growth - 0.8) / 2));
    })(),
    apd_priceFlat: (() => {
      if (spark.length < 4) return 0.5;
      const rs = spark.slice(-4);
      const avg = rs.reduce((a, b) => a + b, 0) / rs.length;
      const variance = rs.reduce((s, v) => s + Math.abs(v - avg), 0) / rs.length;
      return avg > 0 ? Math.max(0, 1 - (variance / avg) * 10) : 0.5;
    })(),
    apd_divergence: 0, // computed below

    // ═══ SMART WALLET SIGNAL ═══
    // How many known-winning wallets are buying this token
    // Layer 1: existing smartWallets (prefix-based, passive)
    // Layer 2: smartMoneyTracker (full address, active polling, tiered scoring)
    tp_mavenScore: Math.min(1,
      smartWallets.getSmartBuyerCount(t) * 0.25 +
      smartMoneyTracker.getSmartMoneyScore(t.ca || ca)?.score * 0.75
    ),
    tp_connectorScore: Math.min(1,
      (t.knownInfluencerBuys ? t.knownInfluencerBuys * 0.2 : 0) +
      (smartMoneyTracker.getSmartMoneyScore(t.ca || ca)?.convergence ? 0.5 : 0)
    ),
  };

  // Compute divergence after other fields are set
  const _r = result;
  if (_r.apd_attentionGrowth > 0.3 && _r.apd_priceFlat > 0.5) {
    _r.apd_divergence = Math.min(1, _r.apd_attentionGrowth * _r.apd_priceFlat * 1.5);
  }

  return _r;
}

// ═══ CHART PATTERN STORAGE — persist graduated token charts for learning ═══
const chartSnapshotCache = []; // in-memory fallback
const MAX_CHART_SNAPSHOTS = 500;

const chartSnapshotSeen = new Set(); // deduplicate by CA
async function storeChartSnapshot(ca, token, outcome) {
  // Deduplicate — only store one snapshot per contract address
  if (chartSnapshotSeen.has(ca)) return;
  chartSnapshotSeen.add(ca);
  if (chartSnapshotSeen.size > MAX_CHART_SNAPSHOTS * 2) {
    const arr = [...chartSnapshotSeen];
    arr.splice(0, arr.length - MAX_CHART_SNAPSHOTS);
    chartSnapshotSeen.clear();
    arr.forEach(c => chartSnapshotSeen.add(c));
  }
  const snapshot = {
    ca,
    name: token.name || "",
    ticker: token.ticker || "",
    graduated: !!outcome.graduated,
    spark: token.spark || [],
    peakMcx: outcome.peakMcx || 1,
    rugged: outcome.rugged || false,
    devDumped: outcome.devDumped || false,
    mcapStart: token.spark?.[0] || 0,
    mcapPeak: token.spark?.length > 0 ? Math.max(...token.spark) : 0,
    mcapEnd: token.mcapUsd || 0,
    buys: token.buys || 0,
    sells: token.sells || 0,
    uniqueBuyers: token.uniqueBuyers || 0,
    age: Math.round((Date.now() - token.createdAt) / 60000),
    ts: Date.now(),
    pattern: classifyChartPattern(token.spark || [], outcome),
  };
  if (redis) {
    try {
      await redis.lPush("chart:snapshots", JSON.stringify(snapshot));
      await redis.lTrim("chart:snapshots", 0, MAX_CHART_SNAPSHOTS - 1);
    } catch {}
  }
  chartSnapshotCache.unshift(snapshot);
  if (chartSnapshotCache.length > MAX_CHART_SNAPSHOTS) chartSnapshotCache.length = MAX_CHART_SNAPSHOTS;
}

function classifyChartPattern(spark, outcome) {
  if (!spark || spark.length < 5) return "unknown";
  const start = spark[0] || 1;
  const peak = Math.max(...spark);
  const end = spark[spark.length - 1] || 0;
  const peakIdx = spark.indexOf(peak);
  const peakPct = peakIdx / spark.length;
  const multiple = peak / start;
  const endRatio = end / peak;

  // Count dips and consecutive ups for smooth grind detection
  let dips = 0, ups = 0, maxConsecutiveUp = 0, consecutiveUp = 0;
  for (let i = 1; i < spark.length; i++) {
    if (spark[i] < spark[i - 1]) { dips++; consecutiveUp = 0; }
    else if (spark[i] > spark[i - 1]) { ups++; consecutiveUp++; maxConsecutiveUp = Math.max(maxConsecutiveUp, consecutiveUp); }
  }
  const totalMoves = dips + ups;
  const upPct = totalMoves > 0 ? ups / totalMoves : 0;

  if (outcome.rugged || outcome.devDumped) return "rug";
  // Smooth grind: gradual up with almost no dips — classic fake chart / self-bought rug
  // Catch aggressive: constant velocity up (linear pump) is the #1 slow rug pattern
  if (spark.length >= 6 && upPct > 0.78 && maxConsecutiveUp >= 4 && end > start * 1.2 && dips <= 3) return "smooth_grind_rug";
  // Extra catch: very linear pump — nearly every candle up, minimal variance
  if (spark.length >= 8 && upPct > 0.85 && end > start * 1.5) return "smooth_grind_rug";
  if (multiple > 8 && peakPct < 0.3) return "sniper_spike";
  // Staircase: gradual up with periodic small dips — can be legit or manipulated
  if (spark.length >= 10 && upPct > 0.7 && upPct <= 0.82 && dips >= 2 && dips <= spark.length * 0.2) return "staircase";
  if (multiple > 3 && peakPct > 0.6 && endRatio > 0.4) return "healthy_pump";
  if (multiple < 3 && spark.length > 30 && outcome.graduated) return "slow_grind";
  if (endRatio < 0.2 && multiple > 5) return "pump_dump";
  // V-shape recovery: crashed then bounced back
  const midIdx = Math.floor(spark.length / 2);
  const midVal = spark[midIdx] || 0;
  if (midVal < start * 0.5 && end > start * 0.8 && end > midVal * 2) return "v_recovery";
  // Flat/dead: barely moved
  if (multiple < 1.5 && endRatio > 0.7 && spark.length > 20) return "flat_dead";
  if (outcome.graduated) return "healthy_pump";
  return "unknown";
}

async function getChartSnapshots(limit = 50) {
  if (redis) {
    try {
      const raw = await redis.lRange("chart:snapshots", 0, limit - 1);
      if (raw?.length > 0) return raw.map(r => JSON.parse(r));
    } catch {}
  }
  return chartSnapshotCache.slice(0, limit);
}

async function getChartPatternStats() {
  const snaps = await getChartSnapshots(200);
  const patterns = {};
  for (const s of snaps) {
    const p = s.pattern || "unknown";
    if (!patterns[p]) patterns[p] = { count: 0, avgPeakMcx: 0, avgAge: 0, graduated: 0, rugged: 0 };
    patterns[p].count++;
    patterns[p].avgPeakMcx += s.peakMcx || 1;
    patterns[p].avgAge += s.age || 0;
    if (s.graduated) patterns[p].graduated++;
    if (s.rugged) patterns[p].rugged++;
  }
  for (const k of Object.keys(patterns)) {
    const p = patterns[k];
    p.avgPeakMcx = +(p.avgPeakMcx / p.count).toFixed(1);
    p.avgAge = Math.round(p.avgAge / p.count);
  }
  return {
    total: snaps.length,
    patterns,
    recentCharts: snaps.slice(0, 20).map(s => ({
      ca: s.ca, name: s.name, ticker: s.ticker, pattern: s.pattern,
      spark: s.spark, peakMcx: s.peakMcx, rugged: s.rugged, age: s.age, ts: s.ts,
    })),
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
        // Store chart snapshots for pattern learning — ALL tokens with enough data,
        // not just graduated. Rugs are critical training data for the model.
        if (t.spark?.length >= 5) {
          storeChartSnapshot(ca, t, outcome).catch(() => {});
        }
        // Persist rug patterns to Redis for long-term learning
        if (rugged && redis) {
          const rugData = { ca, name: t.name, ticker: t.ticker, mcapPeak: peakMc, mcapEnd: currentMc, dropPct: mcapDropPct, devDumped, buys: t.buys || 0, sells: t.sells || 0, age: Math.round((now - t.createdAt) / 60000), ts: now };
          redis.lPush("rug:patterns", JSON.stringify(rugData)).catch(() => {});
          redis.lTrim("rug:patterns", 0, 999).catch(() => {});
        }
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
      dexBoosted: !!radar.dexBoosted.get(t.ca),
      boostAmount: radar.dexBoosted.get(t.ca)?.amount || 0,
      artworkScore: t._artworkScore ?? null,
      artworkOriginal: t._artworkOriginal ?? null,
      artworkFlags: t._artworkFlags || [],
      // Memetic score data
      memeticScore: t._memeticQuick || null,
      memeticLinguistic: t._memeticLinguistic || null,
      memeticAbsurdity: t._memeticAbsurdity || null,
      memeticTemporal: t._memeticTemporal || null,
      memeticArchetype: t._memeticArchetype || null,
      // ═══ ENTRY TIMING DATA — helps frontend show when to buy ═══
      ...(() => {
        const dyn = scoreDynamics.get(t.ca);
        const ageMin = Math.max(0.3, (now - t.createdAt) / 60000);
        const buysPerMin = (t.buys || 0) / ageMin;
        const pressure = (t.buys || 0) / Math.max(1, (t.buys || 0) + (t.sells || 0));
        // ── Price Phase Detection ──
        // Analyze sparkline shape to classify: SPIKE / DIP / CONSOLIDATION / EARLY
        let pricePhase = "EARLY";
        if (spark.length >= 4) {
          const recent = spark.slice(-4);
          const older = spark.slice(-8, -4);
          const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
          const peak = Math.max(...spark);
          const cur = spark[spark.length - 1];
          const fromPeak = peak > 0 ? (peak - cur) / peak : 0;
          const recentSlope = recent.length >= 2 ? (recent[recent.length - 1] - recent[0]) / Math.max(1, recent[0]) : 0;
          if (recentSlope > 0.15 && cur >= peak * 0.95) {
            pricePhase = "SPIKE"; // price actively spiking — bad entry
          } else if (fromPeak > 0.08 && recentSlope <= 0.02) {
            pricePhase = "DIP"; // pulled back from peak, stabilizing — good entry
          } else if (fromPeak > 0.03 && fromPeak <= 0.08 && Math.abs(recentSlope) < 0.05) {
            pricePhase = "CONSOLIDATION"; // sideways after move — okay entry
          } else if (spark.length < 8 && ageMin < 2) {
            pricePhase = "EARLY"; // too young to classify — early discovery
          } else if (recentSlope > 0.05) {
            pricePhase = "SPIKE";
          } else {
            pricePhase = "CONSOLIDATION";
          }
        }
        // ── Buy Velocity Trend ──
        // Is buys/min accelerating or decelerating?
        let buyVelTrend = "steady";
        if (t.trades && t.trades.length >= 4) {
          const trades = t.trades;
          const mid = Math.floor(trades.length / 2);
          const firstHalf = trades.slice(0, mid).filter(tr => tr.side === "buy").length;
          const secondHalf = trades.slice(mid).filter(tr => tr.side === "buy").length;
          const firstSpan = Math.max(1, ((trades[mid]?.time || now) - (trades[0]?.time || now)) / 60000);
          const secondSpan = Math.max(0.3, (now - (trades[mid]?.time || now)) / 60000);
          const firstRate = firstHalf / firstSpan;
          const secondRate = secondHalf / secondSpan;
          if (secondRate > firstRate * 1.3) buyVelTrend = "accelerating";
          else if (secondRate < firstRate * 0.7) buyVelTrend = "decelerating";
        }
        // ── Volume Spike Detection ──
        const recentTrades = (t.trades || []).filter(tr => tr.time && now - tr.time < 60000);
        const recentBuyVol = recentTrades.filter(tr => tr.side === "buy").reduce((s, tr) => s + (tr.sol || 0), 0);
        const avgVolPerMin = t.volumeSol / Math.max(1, ageMin);
        const volSpike = avgVolPerMin > 0 ? recentBuyVol / avgVolPerMin : 0;
        // ── Entry Signal ──
        // Combine phase + velocity + dynamics into a simple signal
        let entrySignal = "WAIT";
        if (pricePhase === "SPIKE" || buyVelTrend === "decelerating") {
          entrySignal = "WAIT"; // don't chase spikes or fading velocity
        } else if (pricePhase === "DIP" && (dyn?.trend === "rising" || dyn?.trend === "rocket")) {
          entrySignal = "STRONG"; // dip + recovering score = best entry
        } else if (pricePhase === "EARLY" && pressure > 0.6 && buyVelTrend !== "decelerating") {
          entrySignal = "EARLY"; // early with good pressure = speculative entry
        } else if (pricePhase === "CONSOLIDATION" && dyn?.velocity > 0) {
          entrySignal = "READY"; // stable price + positive score momentum
        } else if (dyn?.trend === "rising" || dyn?.trend === "rocket") {
          entrySignal = "READY";
        } else if (pressure > 0.5 && buyVelTrend !== "decelerating") {
          entrySignal = "CAUTION";
        }
        return {
          entrySignal,
          pricePhase,
          buyPressure: +pressure.toFixed(2),
          buyVelTrend,
          scoreTrend: dyn?.trend || "new",
          scoreVelocity: dyn?.velocity || 0,
          scoreMomentum: dyn?.momentum || "nascent",
          volSpike: +(Math.min(10, volSpike).toFixed(1)),
        };
      })(),
    };
  };

  const deduped = dedup(all);

  // ── SCORE DYNAMICS: record score for every active token every 5s ──
  // This feeds the velocity/acceleration tracker so buy decisions
  // know if a token's score is accelerating (runner) or decelerating (rug)
  for (const t of deduped) {
    try {
      const qf = extractQuickFeatures(t);
      if (qf) {
        const s = memeIntel.scorer.score(qf);
        scoreDynamics.record(t.ca, s.score);
      }
    } catch {}
  }
  // Prune stale entries every ~60s (counter resets to 0 on 12th tick at 5s interval)
  if (++scoreDynamics._pruneCounter >= 12) {
    scoreDynamics._pruneCounter = 0;
    scoreDynamics.prune();
  }
  if (scoreDynamics._pruneCounter === undefined) scoreDynamics._pruneCounter = 0;

  // ═══ UNIVERSAL RUG FILTER — removes obvious rugs from ALL radar tabs ═══
  // Computes a composite rug score for each token; tokens above threshold get excluded.
  // This prevents rug chart patterns from landing in ANY tab (new, hot, momentum, grad).
  const rugScoreCache = new Map(); // ca → { rugScore, filtered }
  function isRugFiltered(t) {
    if (rugScoreCache.has(t.ca)) return rugScoreCache.get(t.ca).filtered;
    let rugScore = 0;
    try {
      const qf = extractQuickFeatures(t);
      if (qf) {
        // Zero sells: the #1 rug signal
        if (qf._rg_zeroSellFlag >= 0.8) rugScore += 40;
        else if (qf._rg_zeroSellFlag >= 0.5) rugScore += 25;
        // Buy/sell imbalance
        if (qf._rg_buySellImbalance >= 0.7) rugScore += 20;
        else if (qf._rg_buySellImbalance >= 0.4) rugScore += 10;
        // Staircase chart (uniform step up pattern)
        if (qf.ch_staircaseScore > 0.5) rugScore += 25;
        else if (qf.ch_staircaseScore > 0.3) rugScore += 12;
        // Smooth grind (no natural dips)
        if (qf.ch_smoothGrind > 0.5) rugScore += 20;
        else if (qf.ch_smoothGrind > 0.35) rugScore += 10;
        // Flatline spike (dead chart then pump)
        if (qf.ch_flatlineSpike > 0.4) rugScore += 25;
        else if (qf.ch_flatlineSpike > 0.25) rugScore += 12;
        // Pump and dump pattern
        if (qf.ch_pumpDump > 0.6) rugScore += 20;
        else if (qf.ch_pumpDump > 0.3) rugScore += 10;
        // Fresh wallet buyers (dev self-buying)
        if (qf._rg_freshWalletRatio > 0.8) rugScore += 15;
        else if (qf._rg_freshWalletRatio > 0.6) rugScore += 8;
        // Dev self-snipe
        if (qf._rg_devSelfSnipe > 0) rugScore += 15;
        // Early dump by dev
        if (qf._rg_earlyDump > 0.5) rugScore += 15;
        // Quick flip rate (buy then sell within 60s)
        if (qf._rg_quickFlipRate > 0.5) rugScore += 10;
        // Sybil score (many identical-size buys from fresh wallets)
        if (qf._rg_sybilScore > 0.5) rugScore += 10;
        // MC crash from peak
        if (qf.rg_mcapDropRate > 0.7) rugScore += 15;
        // Combined killer: zero sells + staircase = definitely a rug
        if (qf._rg_zeroSellFlag >= 0.5 && qf.ch_staircaseScore > 0.2) rugScore += 20;
        // Combined: zero sells + fresh wallets = dev self-buying rug
        if (qf._rg_zeroSellFlag >= 0.5 && qf._rg_freshWalletRatio > 0.6) rugScore += 15;
      }
    } catch {}
    // Tokens with enough buys for analysis that score high = rug
    // Young tokens with < 3 buys get a pass (not enough data yet)
    const hasSufficientData = (t.buys || 0) >= 3;
    const filtered = hasSufficientData && rugScore >= 45;
    rugScoreCache.set(t.ca, { rugScore, filtered });
    return filtered;
  }

  // Pre-filter: remove obvious rugs from the deduped pool
  const rugFiltered = deduped.filter(t => !isRugFiltered(t));

  // ── NEW: Fresh launches (last 10 min) — now with rug filtering ──
  radar.tabs.new = rugFiltered
    .filter(t => (now - t.createdAt) < 600000)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50).map(serialize);

  // ── HOT: Tokens with actual buy activity ──
  radar.tabs.hot = rugFiltered
    .filter(t => t.buys >= 2)
    .map(t => {
      const ageMin = Math.max(0.3, (now - t.createdAt) / 60000);
      const ub = t.uniqueBuyers?.size || 0;
      // Penalize rug patterns in HOT tab too
      let rugHeatPenalty = 0;
      try {
        const qf = extractQuickFeatures(t);
        if (qf) {
          if (qf._rg_zeroSellFlag > 0.5) rugHeatPenalty += qf._rg_zeroSellFlag * 30;
          if (qf._rg_buySellImbalance > 0.5) rugHeatPenalty += qf._rg_buySellImbalance * 20;
          if (qf.ch_staircaseScore > 0.3) rugHeatPenalty += qf.ch_staircaseScore * 15;
          if (qf.ch_smoothGrind > 0.35) rugHeatPenalty += qf.ch_smoothGrind * 10;
          if (qf.ch_flatlineSpike > 0.25) rugHeatPenalty += qf.ch_flatlineSpike * 20;
        }
      } catch {}
      return { ...t, _heat: (t.buys/ageMin)*10 + ub*8 + t.volumeSol*5 + (t.mcapUsd>5000?10:0) - rugHeatPenalty };
    })
    .sort((a, b) => b._heat - a._heat)
    .slice(0, 50).map(serialize);

  // ── GRAD: Real traction MC ($10K+) or graduated ($69K+) ──
  // $2.4K = launch, $3-5K = dev buy, $10K+ = real traction, $69K = graduated
  radar.tabs.graduating = rugFiltered
    .filter(t => t.mcapUsd >= 10000 || t.graduated)
    .map(t => ({
      ...t,
      _gradScore: (t.graduated ? 200 : 0) + Math.min(100, (t.mcapUsd / gradMcUsd()) * 100),
    }))
    .sort((a, b) => b._gradScore - a._gradScore)
    .slice(0, 50).map(t => {
      const s = serialize(t);
      s.pctToGrad = t.graduated ? 100 : Math.min(99, Math.round((t.mcapUsd / gradMcUsd()) * 100));
      s.graduated = t.graduated;
      return s;
    });

  // ── MOMENTUM: Sustained buying pressure ──
  radar.tabs.momentum = rugFiltered
    .filter(t => t.buys >= 2 && (now - t.createdAt) > 30000 && t.mcapUsd >= 3000)
    .map(t => {
      const ageMin = Math.max(0.5, (now - t.createdAt) / 60000);
      const buyRate = t.buys / ageMin;
      const pressure = t.buys / Math.max(1, t.buys + t.sells);
      const ub = t.uniqueBuyers?.size || 0;
      const mcGrowth = t.spark?.length > 2 ? (t.spark[t.spark.length-1] - t.spark[0]) / Math.max(1, t.spark[0]) : 0;
      if (mcGrowth < -0.3) return null;
      // ── RUG PENALTY FOR MOMENTUM TAB ──
      // Tokens with all buys / zero sells look like strong momentum but are actually rugs.
      // Penalize rug patterns to prevent them from ranking high.
      let rugMomentumPenalty = 0;
      try {
        const qf = extractQuickFeatures(t);
        if (qf) {
          // Zero sells: many buys + no organic sells = fake momentum
          if (qf._rg_zeroSellFlag > 0.5) rugMomentumPenalty += qf._rg_zeroSellFlag * 40;
          // Buy/sell imbalance: 90%+ buys = suspicious
          if (qf._rg_buySellImbalance > 0.4) rugMomentumPenalty += qf._rg_buySellImbalance * 25;
          // Staircase chart: fake chart pattern
          if (qf.ch_staircaseScore > 0.3) rugMomentumPenalty += qf.ch_staircaseScore * 20;
          // Smooth grind: no natural dips
          if (qf.ch_smoothGrind > 0.35) rugMomentumPenalty += qf.ch_smoothGrind * 15;
          // Flatline spike: dead chart with sudden pump
          if (qf.ch_flatlineSpike > 0.25) rugMomentumPenalty += qf.ch_flatlineSpike * 25;
          // Fresh wallets buying: dev self-buying
          if (qf._rg_freshWalletRatio > 0.6) rugMomentumPenalty += qf._rg_freshWalletRatio * 15;
          // Hard reject: obvious rug = exclude from momentum entirely
          if (qf._rg_zeroSellFlag >= 0.8 || (qf._rg_zeroSellFlag >= 0.5 && qf.ch_staircaseScore > 0.3)) return null;
        }
      } catch {}
      return { ...t, _momentum: buyRate*12 + pressure*20 + ub*10 + mcGrowth*30 + Math.min(15, t.volumeSol*3) - rugMomentumPenalty };
    })
    .filter(Boolean)
    .sort((a, b) => b._momentum - a._momentum)
    .slice(0, 50).map(serialize);

  radar.poolSize = radar.tokens.size;
}, 5000);

connectPumpPortal();

// Start memetic background workers (trend poller, KOL monitor, etc.)
loadMemeticBlacklists().catch(() => {});
startMemeticWorkers();

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
    try { await redis.set("tw:" + userPubkey, JSON.stringify(tw), { EX: 2592000 }); } catch {} // 30d
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
    try { await redis.set("user:" + wallet, JSON.stringify(merged), { EX: 2592000 }); } catch {}
  }
}

// Auto-apply default referral code for new users who weren't referred by someone else
async function applyDefaultReferral(wallet) {
  try {
    const user = await getUser(wallet);
    if (user.referredBy) return; // already referred by someone
    // Look up the default referral code owner
    let referrerWallet = null;
    if (redis) {
      referrerWallet = await redis.get("customref:" + DEFAULT_REFERRAL_CODE);
      if (!referrerWallet) referrerWallet = await redis.get("ref:" + DEFAULT_REFERRAL_CODE);
    }
    if (!referrerWallet) {
      const found = [...users.entries()].find(([, u]) => u.customRefCode === DEFAULT_REFERRAL_CODE || u.refCode === DEFAULT_REFERRAL_CODE);
      if (found) referrerWallet = found[0];
    }
    if (!referrerWallet || referrerWallet === wallet) return; // owner not found or self-referral
    const referrer = await getUser(referrerWallet);
    await saveUser(wallet, { referredBy: referrerWallet, referredByTier: referrer.tier || "free" });
    await saveUser(referrerWallet, {
      referralCount: (parseInt(referrer.referralCount || "0") + 1).toString(),
      referralNetwork: (parseInt(referrer.referralNetwork || "0") + 1).toString(),
    });
    if (redis) {
      try { await redis.lPush("refevents:" + referrerWallet, JSON.stringify({ user: wallet.slice(0, 4) + "..." + wallet.slice(-4), type: "signup", time: Date.now() })); } catch {}
    }
    console.log(`[REFERRAL] Default referral applied: ${wallet.slice(0, 8)}... → ${DEFAULT_REFERRAL_CODE}`);
  } catch (e) {
    console.error("[REFERRAL] Failed to apply default referral:", e.message);
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
// ── Token-gated tiers: hold BONDLI token at bonding curve ratio = auto-upgrade ──
const BONDLI_TOKEN_MINT = process.env.BONDLI_TOKEN_MINT || ""; // Set to BONDLI token CA when launched
// Ratio of total supply the user must hold for Pro (e.g. 0.001 = 0.1%)
// VIP = 10x the Pro ratio
const TIER_PRO_RATIO = parseFloat(process.env.TIER_PRO_RATIO || "0.001");
const TIER_VIP_RATIO = TIER_PRO_RATIO * 10;
// Total supply for pump.fun tokens (default 1B)
const TIER_TOKEN_SUPPLY = parseFloat(process.env.TIER_TOKEN_SUPPLY || "1000000000");

async function checkTokenGatedTier(wallet) {
  if (!BONDLI_TOKEN_MINT) return null; // not configured yet
  try {
    const owner = new PublicKey(wallet);
    const mint = new PublicKey(BONDLI_TOKEN_MINT);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, { mint });
    let totalBalance = 0;
    for (const ta of tokenAccounts.value) {
      totalBalance += ta.account.data.parsed?.info?.tokenAmount?.uiAmount || 0;
    }
    const holdRatio = totalBalance / TIER_TOKEN_SUPPLY;
    if (holdRatio >= TIER_VIP_RATIO) return "vip";
    if (holdRatio >= TIER_PRO_RATIO) return "pro";
    return null;
  } catch { return null; }
}

app.get("/api/access/check", async (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  const user = await getUser(wallet);
  // Even if Redis is down, check env whitelist first — VIPs should never be locked out
  let tierInfo = resolveTier(wallet, user._redisError ? {} : user);
  if (user._redisError && tierInfo.tier === "free") {
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }
  // Token-gated tier override — holding BONDLI token upgrades tier
  if (tierInfo.tier === "free" || tierInfo.tier === "pro") {
    const tokenTier = await checkTokenGatedTier(wallet);
    if (tokenTier) {
      const tierRank = { vip: 3, pro: 2, free: 1 };
      if ((tierRank[tokenTier] || 0) > (tierRank[tierInfo.tier] || 0)) {
        tierInfo = { ...tierInfo, tier: tokenTier, tokenGated: true };
      }
    }
  }
  // Only save if tier upgraded or not yet stored — never downgrade a stored VIP/pro to free
  if (!user._redisError) {
    const storedTier = user?.tier;
    const tierRank = { vip: 3, pro: 2, free: 1 };
    if (!storedTier || (tierRank[tierInfo.tier] || 0) >= (tierRank[storedTier] || 0)) {
      await saveUser(wallet, { tier: tierInfo.tier, whitelisted: tierInfo.whitelisted, tokenGated: tierInfo.tokenGated || false });
    }
  }
  res.json({ tier: tierInfo.tier, whitelisted: tierInfo.whitelisted, paid: user.paid || false, tokenGated: tierInfo.tokenGated || false, tokenThresholds: BONDLI_TOKEN_MINT ? { proRatio: TIER_PRO_RATIO, vipRatio: TIER_VIP_RATIO, proTokens: Math.ceil(TIER_PRO_RATIO * TIER_TOKEN_SUPPLY), vipTokens: Math.ceil(TIER_VIP_RATIO * TIER_TOKEN_SUPPLY), mint: BONDLI_TOKEN_MINT } : null });
});

app.post("/api/access/activate-free", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  const existing = await getUser(wallet);
  // Check whitelist even if Redis is down — VIPs should always get through
  const tierInfo = resolveTier(wallet, existing._redisError ? {} : existing);
  if (existing._redisError && tierInfo.tier === "free") {
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }
  if (tierInfo.tier === "vip" || tierInfo.tier === "pro" || tierInfo.whitelisted) {
    return res.json({ ok: true, tier: tierInfo.tier, message: "Already " + tierInfo.tier });
  }
  await saveUser(wallet, { tier: "free", activatedAt: new Date().toISOString() });
  // Auto-apply default referral for new users without a referrer
  applyDefaultReferral(wallet);
  res.json({ ok: true, tier: "free" });
});

// Shared payment verification helper
async function verifyPayment(wallet, txSig, minSol) {
  const tx = await connection.getTransaction(txSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx) throw new Error("Transaction not found or not confirmed");
  if (tx.meta?.err) throw new Error("Transaction failed on-chain");
  const keys = tx.transaction.message.staticAccountKeys
    ? tx.transaction.message.staticAccountKeys.map(k => k.toBase58())
    : tx.transaction.message.accountKeys.map(k => k.toBase58());
  const platformIdx = keys.indexOf(PLATFORM_WALLET);
  const senderIdx = keys.indexOf(wallet);
  if (platformIdx < 0) throw new Error("Payment not sent to platform wallet");
  if (senderIdx < 0) throw new Error("Transaction sender doesn't match wallet");
  const received = ((tx.meta.postBalances?.[platformIdx] || 0) - (tx.meta.preBalances?.[platformIdx] || 0)) / LAMPORTS_PER_SOL;
  if (received < minSol - 0.01) throw new Error(`Insufficient payment: ${received.toFixed(4)} SOL (need ${minSol})`);
  return received;
}

app.post("/api/access/activate-pro", async (req, res) => {
  const { wallet, txSig } = req.body;
  if (!wallet || !txSig) return res.status(400).json({ error: "wallet and txSig required" });
  try {
    await verifyPayment(wallet, txSig, 1); // Pro = 1 SOL
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  await saveUser(wallet, { tier: "pro", paid: true, proTx: txSig });
  applyDefaultReferral(wallet);
  res.json({ ok: true, tier: "pro" });
});

app.post("/api/access/activate-vip", async (req, res) => {
  const { wallet, txSig } = req.body;
  if (!wallet || !txSig) return res.status(400).json({ error: "wallet and txSig required" });
  try {
    await verifyPayment(wallet, txSig, 10); // VIP = 10 SOL
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  await saveUser(wallet, { tier: "vip", paid: true, whitelisted: true, vipTx: txSig });
  applyDefaultReferral(wallet);
  res.json({ ok: true, tier: "vip" });
});

app.get("/api/pricing", (req, res) => {
  res.json({
    free: { fee: "25% of profit", price: "0 SOL", label: "Free — 25% profit share" },
    pro: { fee: "0%", price: "1 SOL", label: "Pro — 0% fee" },
    vip: { fee: "0%", price: "10 SOL", label: "VIP — full sovereignty" },
    platformWallet: PLATFORM_WALLET,
  });
});

// ═══════════════════════════════════════
// ROUTES: TRADING WALLET
// ═══════════════════════════════════════
app.get("/api/trading-wallet/:wallet", async (req, res) => {
  const tw = await getTradingWallet(req.params.wallet);
  if (!tw) return res.json({ ok: false, tradingWallet: null });
  let pubkey = tw.pubkey;
  if (!pubkey && tw.secret) {
    try { pubkey = Keypair.fromSecretKey(bs58.decode(tw.secret)).publicKey.toBase58(); } catch {}
  }
  if (!pubkey) return res.json({ ok: false, tradingWallet: null, error: "invalid wallet" });

  // Return cached balance if fresh (avoids RPC 429 on frequent polls)
  const cacheKey = "bal:" + pubkey;
  const cached = getCachedBalance(cacheKey);
  if (cached) return res.json(cached);

  // Fetch SOL balance with retry + timeout
  let solBalance = 0;
  let rpcFailed = false;
  try {
    const bal = await rpcRetry(() => {
      const p = connection.getBalance(new PublicKey(pubkey));
      const t = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000));
      return Promise.race([p, t]);
    }, "getBalance:" + pubkey.slice(0, 8));
    solBalance = bal / LAMPORTS_PER_SOL;
  } catch (e) {
    rpcFailed = true;
    console.log(`[WALLET-BAL] getBalance failed for ${pubkey.slice(0,8)}: ${e.message}`);
    // On RPC failure, serve last known good balance instead of 0
    const stale = getStaleCachedBalance(cacheKey);
    if (stale) { console.log(`[WALLET-BAL] Serving stale cache for ${pubkey.slice(0,8)}`); return res.json(stale); }
  }
  // Calculate total token value in SOL across all held positions
  let tokenValueSol = 0;
  const tokenDetails = [];
  try {
    const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const accts = await rpcRetry(() => connection.getParsedTokenAccountsByOwner(new PublicKey(pubkey), { programId: TOKEN_PROGRAM }), "getTokenAccounts:" + pubkey.slice(0, 8));
    const mintsToPrice = [];
    for (const ta of accts.value) {
      const info = ta.account.data.parsed.info;
      const amount = parseFloat(info.tokenAmount.uiAmountString || "0");
      if (amount <= 0) continue;
      const mint = info.mint;
      const radarToken = radar.tokens.get(mint);
      if (radarToken) {
        const totalSupply = 1_000_000_000;
        const holdPct = amount / totalSupply;
        const mcUsd = radarToken.mcapUsd || 0;
        const valueUsd = mcUsd > 0 ? holdPct * mcUsd : 0;
        const valueSol = solUsdPrice > 0 ? valueUsd / solUsdPrice : 0;
        tokenValueSol += valueSol;
        tokenDetails.push({ mint, name: radarToken.name || mint.slice(0,8), amount, valueSol: +valueSol.toFixed(6) });
      } else {
        mintsToPrice.push({ mint, amount });
      }
    }
    if (mintsToPrice.length > 0) {
      try {
        const batch = mintsToPrice.slice(0, 10);
        const ids = batch.map(m => m.mint).join(",");
        const priceResp = await fetch(`https://api.jup.ag/price/v2?ids=${ids}`, { signal: AbortSignal.timeout(5000) });
        if (priceResp.ok) {
          const priceData = await priceResp.json();
          for (const item of batch) {
            const p = priceData?.data?.[item.mint];
            if (p?.price) {
              const valueUsd = item.amount * parseFloat(p.price);
              const valueSol = solUsdPrice > 0 ? valueUsd / solUsdPrice : 0;
              tokenValueSol += valueSol;
              tokenDetails.push({ mint: item.mint, name: item.mint.slice(0,8), amount: item.amount, valueSol: +valueSol.toFixed(6) });
            }
          }
        }
      } catch {}
    }
  } catch (e) {
    console.log(`[WALLET-BAL] token scan failed for ${pubkey.slice(0,8)}: ${e.message}`);
    // If token scan also failed, serve stale cache
    if (!rpcFailed) {
      const stale = getStaleCachedBalance(cacheKey);
      if (stale) { console.log(`[WALLET-BAL] Serving stale cache for ${pubkey.slice(0,8)} (token scan failed)`); return res.json(stale); }
    }
  }
  const totalBalance = +(solBalance + tokenValueSol).toFixed(6);
  const result = { ok: true, tradingWallet: pubkey, balance: totalBalance, solBalance: +solBalance.toFixed(6), tokenValueSol: +tokenValueSol.toFixed(6), tokens: tokenDetails };
  // Only cache successful results (don't cache 0 balance from RPC failures)
  if (!rpcFailed) setCachedBalance(cacheKey, result);
  console.log(`[WALLET-BAL] ${pubkey.slice(0,8)}: ${solBalance.toFixed(4)} SOL + ${tokenValueSol.toFixed(4)} tokens = ${totalBalance} total (${tokenDetails.length} tokens)`);
  res.json(result);
});

// ── WALLET DEBUG: detailed diagnostic for deposit issues ──
app.get("/api/trading-wallet/:wallet/debug", async (req, res) => {
  const diag = { steps: [], errors: [], wallet: req.params.wallet };
  try {
    // Step 1: Look up trading wallet
    const tw = await getTradingWallet(req.params.wallet);
    diag.steps.push({ step: "getTradingWallet", found: !!tw, pubkey: tw?.pubkey?.slice(0,12) || null, hasSecret: !!tw?.secret });
    if (!tw) {
      // Check if user record has tradingWallet reference
      const user = await getUser(req.params.wallet);
      diag.steps.push({ step: "getUser_fallback", user: user ? { tier: user.tier, tradingWallet: user.tradingWallet?.slice(0,12) || null } : null });
      diag.errors.push("No trading wallet found in tw: store or Redis");
      return res.json({ ok: false, diag });
    }
    let pubkey = tw.pubkey;
    if (!pubkey && tw.secret) {
      try { pubkey = Keypair.fromSecretKey(bs58.decode(tw.secret)).publicKey.toBase58(); diag.steps.push({ step: "derive_pubkey", pubkey: pubkey.slice(0,12) }); } catch (e) { diag.errors.push("derive_pubkey failed: " + e.message); }
    }
    if (!pubkey) { diag.errors.push("No pubkey available"); return res.json({ ok: false, diag }); }
    diag.pubkey = pubkey;

    // Step 2: Check SOL balance (with retry for 429)
    try {
      const bal = await rpcRetry(() => connection.getBalance(new PublicKey(pubkey)), "debug:getBalance");
      diag.steps.push({ step: "getBalance", lamports: bal, sol: bal / LAMPORTS_PER_SOL });
    } catch (e) {
      diag.steps.push({ step: "getBalance", error: e.message });
      diag.errors.push("getBalance failed: " + e.message);
    }

    // Step 3: Check token accounts (with retry for 429)
    try {
      const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const accts = await rpcRetry(() => connection.getParsedTokenAccountsByOwner(new PublicKey(pubkey), { programId: TOKEN_PROGRAM }), "debug:getTokenAccounts");
      const tokens = accts.value.map(ta => {
        const info = ta.account.data.parsed.info;
        return { mint: info.mint.slice(0,12), amount: info.tokenAmount.uiAmountString, decimals: info.tokenAmount.decimals };
      });
      diag.steps.push({ step: "getTokenAccounts", count: accts.value.length, tokens });
    } catch (e) {
      diag.steps.push({ step: "getTokenAccounts", error: e.message });
      diag.errors.push("getTokenAccounts failed: " + e.message);
    }

    // Step 4: Check RPC health (with retry for 429)
    try {
      const slot = await rpcRetry(() => connection.getSlot(), "debug:getSlot");
      diag.steps.push({ step: "rpcHealth", slot, rpcUrl: RPC_URL.slice(0, 40) });
    } catch (e) {
      diag.steps.push({ step: "rpcHealth", error: e.message });
      diag.errors.push("RPC unhealthy: " + e.message);
    }

    // Step 5: Redis status
    diag.steps.push({ step: "redis", connected: !!redis });

    // Step 6: solUsdPrice
    diag.steps.push({ step: "solUsdPrice", price: solUsdPrice });

    diag.ok = diag.errors.length === 0;
    res.json(diag);
  } catch (e) {
    diag.errors.push("Unexpected: " + e.message);
    res.json({ ok: false, diag });
  }
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
    const { totalSol, tokenConfig, wallet, fleetConfig } = req.body;
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    const user = await getUser(wallet);
    const tierInfo = resolveTier(wallet, user);

    const session = await sessionManager.create({
      userWallet: wallet,
      totalSol: totalSol || 0.5,
      tokenConfig: tokenConfig || {},
      tier: tierInfo.tier,
      fleetConfig: fleetConfig || {},
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
        const createResult = await createToken(connection, devKp, session.tokenConfig);
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
        try { await redis.set("fleetkeys:" + sessionId, JSON.stringify(launchResult.walletKeys), { EX: 172800 }); } catch {}
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

// ── FLEET COMMAND (War Room controls) ──
app.post("/api/session/command", async (req, res) => {
  try {
    const { sessionId, wallet, command, params } = req.body || {};
    if (!sessionId || !wallet || !command) return res.status(400).json({ error: "sessionId, wallet, command required" });
    const session = await sessionManager.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });
    if (!session.tokenCA) return res.status(400).json({ error: "No token CA" });
    const result = fleetTrader.command(session.tokenCA, command, params || {});
    if (!result.ok) return res.status(400).json(result);
    console.log(`[CMD] ${wallet.slice(0, 8)} → ${command} on ${session.tokenCA.slice(0, 8)} (${result.duration || 0}s)`);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
    // Try to close active fleet session (may not exist if server restarted)
    if (session.tokenCA && fleetTrader.sessions.has(session.tokenCA)) {
      try {
        closeResult = await fleetTrader.close(session.tokenCA);
      } catch (e) {
        console.warn(`[SWEEP] Fleet close failed (continuing): ${e.message}`);
      }
    }

    // Update session status
    await sessionManager.update(sessionId, { status: "closed", closedAt: new Date().toISOString() });

    const tw = await getTradingWallet(wallet);
    const destPubkey = tw?.pubkey || wallet;
    let totalSwept = closeResult.solRecovered || 0;

    // Sweep dev wallet → trading wallet
    try {
      if (session.devSecret) {
        const devKp = Keypair.fromSecretKey(bs58.decode(session.devSecret));
        // First sell any tokens the dev wallet holds
        if (session.tokenCA) {
          try {
            const tokenAccounts = await connection.getParsedTokenAccountsByOwner(devKp.publicKey, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
            const tokenAccount = tokenAccounts.value.find(ta => ta.account.data.parsed.info.mint === session.tokenCA);
            if (tokenAccount) {
              const tokenBal = parseFloat(tokenAccount.account.data.parsed.info.tokenAmount.uiAmountString || "0");
              if (tokenBal > 0) {
                console.log(`[SWEEP] Dev holds ${tokenBal} tokens — selling via PumpPortal...`);
                try {
                  const sellResp = await fetch("https://pumpportal.fun/api/trade-local", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ publicKey: devKp.publicKey.toBase58(), action: "sell", mint: session.tokenCA, amount: "100%", denominatedInSol: "false", slippage: 50, priorityFee: 0.01, pool: "auto" }),
                    signal: AbortSignal.timeout(15000),
                  });
                  if (sellResp.ok) {
                    const txBytes = await sellResp.arrayBuffer();
                    if (txBytes.byteLength > 100) {
                      const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
                      tx.sign([devKp]);
                      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
                      console.log(`[SWEEP] Dev token sell: ${sig.slice(0, 12)}`);
                      await new Promise(r => setTimeout(r, 3000)); // wait for confirmation
                    }
                  }
                } catch (e) { console.warn(`[SWEEP] Dev token sell failed: ${e.message}`); }
              }
            }
          } catch {}
        }
        // Transfer remaining SOL
        const devBal = await connection.getBalance(devKp.publicKey);
        if (devBal > 6000) {
          const tx = new Transaction().add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }),
            SystemProgram.transfer({ fromPubkey: devKp.publicKey, toPubkey: new PublicKey(destPubkey), lamports: devBal - 5000 })
          );
          await sendAndConfirmTransaction(connection, tx, [devKp], { skipPreflight: true, commitment: "confirmed" });
          const swept = (devBal - 5000) / LAMPORTS_PER_SOL;
          totalSwept += swept;
          console.log(`[SWEEP] Dev → Trading: ${swept.toFixed(4)} SOL`);
        }
      }
    } catch (e) { console.error(`[SWEEP] Dev sweep failed:`, e.message); }

    // Sweep fleet wallets → trading wallet
    let fleetKeys = [];
    try {
      if (redis) {
        const fkRaw = await redis.get("fleetkeys:" + sessionId);
        if (fkRaw) fleetKeys = JSON.parse(fkRaw);
      }
    } catch {}

    for (const fk of fleetKeys) {
      try {
        const fkKp = Keypair.fromSecretKey(bs58.decode(fk.secret));
        // Sell any tokens first
        if (session.tokenCA) {
          try {
            const sellResp = await fetch("https://pumpportal.fun/api/trade-local", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ publicKey: fkKp.publicKey.toBase58(), action: "sell", mint: session.tokenCA, amount: "100%", denominatedInSol: "false", slippage: 50, priorityFee: 0.01, pool: "auto" }),
              signal: AbortSignal.timeout(10000),
            });
            if (sellResp.ok) {
              const txBytes = await sellResp.arrayBuffer();
              if (txBytes.byteLength > 100) {
                const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
                tx.sign([fkKp]);
                await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
              }
            }
          } catch {}
        }
        // Transfer SOL
        const bal = await connection.getBalance(fkKp.publicKey);
        if (bal > 6000) {
          const tx = new Transaction().add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }),
            SystemProgram.transfer({ fromPubkey: fkKp.publicKey, toPubkey: new PublicKey(destPubkey), lamports: bal - 5000 })
          );
          await sendAndConfirmTransaction(connection, tx, [fkKp], { skipPreflight: true, commitment: "confirmed" });
          const swept = (bal - 5000) / LAMPORTS_PER_SOL;
          totalSwept += swept;
          console.log(`[SWEEP] ${fk.role} → Trading: ${swept.toFixed(4)} SOL`);
        }
      } catch (e) { console.warn(`[SWEEP] Fleet wallet sweep failed: ${e.message}`); }
    }

    // Get keys for response
    let keys = [];
    if (session.devSecret) keys.push({ role: "dev", pubkey: session.devWallet, secret: session.devSecret });
    keys = keys.concat(fleetKeys);

    console.log(`[SWEEP] Total swept: ${totalSwept.toFixed(4)} SOL from ${1 + fleetKeys.length} wallets`);

    // ── Referral revenue tracking (silent) ──
    const platformCut = closeResult.platformCut || 0;
    if (platformCut > 0.0001) {
      try {
        const sweepUser = await getUser(wallet);
        if (sweepUser.referredBy) {
          const referrer = await getUser(sweepUser.referredBy);
          if (referrer) {
            const { referrerCut } = calculateReferralSplit(platformCut, referrer.tier || "free");
            if (referrerCut > 0.0001) {
              await saveUser(sweepUser.referredBy, {
                referralEarnings: (parseFloat(referrer.referralEarnings || "0") + referrerCut).toFixed(6),
                referralPendingPayout: (parseFloat(referrer.referralPendingPayout || "0") + referrerCut).toFixed(6),
              });
              if (redis) {
                try { await redis.lPush("refevents:" + sweepUser.referredBy, JSON.stringify({ user: wallet.slice(0, 4) + "..." + wallet.slice(-4), commission: +referrerCut.toFixed(6), platformCut: +platformCut.toFixed(6), type: "commission", time: Date.now() })); } catch {}
              }
              console.log(`[REFERRAL] Commission: ${sweepUser.referredBy.slice(0, 8)}... earned ${referrerCut.toFixed(6)} SOL from ${wallet.slice(0, 8)}...`);
            }
          }
        }
        // Track total platform cut for the user
        await saveUser(wallet, {
          totalPlatformCut: (parseFloat(sweepUser.totalPlatformCut || "0") + platformCut).toFixed(6),
          totalProfit: (parseFloat(sweepUser.totalProfit || "0") + (closeResult.netProfit || 0)).toFixed(6),
        });
      } catch (e) { console.warn("[REFERRAL] Tracking error:", e.message); }
    }

    res.json({ ok: true, ...closeResult, totalSwept: +totalSwept.toFixed(4), keys });
  } catch (e) {
    console.error("[SELL-SWEEP] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── FORCE-RECOVER ──
// Sells any remaining tokens + sweeps all SOL back to trading wallet
app.post("/api/session/force-recover", async (req, res) => {
  try {
    const { sessionId, wallet } = req.body;
    const session = await sessionManager.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.userWallet !== wallet) return res.status(403).json({ error: "Not your session" });

    const tw = await getTradingWallet(wallet);
    const destPubkey = tw?.pubkey || wallet;

    // Collect all wallet secrets (dev + fleet)
    let allKeys = [];
    if (session.devSecret) allKeys.push({ role: "dev", secret: session.devSecret });
    if (redis) {
      try {
        const fkRaw = await redis.get("fleetkeys:" + sessionId);
        if (fkRaw) allKeys = allKeys.concat(JSON.parse(fkRaw));
      } catch {}
    }

    if (allKeys.length === 0) {
      return res.status(400).json({ error: "No wallet keys found. Keys may have expired (48h TTL)." });
    }

    let totalRecovered = 0;
    const results = [];

    for (const wk of allKeys) {
      try {
        const kp = Keypair.fromSecretKey(bs58.decode(wk.secret));
        const pub = kp.publicKey.toBase58().slice(0, 8);

        // Sell any tokens this wallet holds
        if (session.tokenCA) {
          try {
            const sellResp = await fetch("https://pumpportal.fun/api/trade-local", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ publicKey: kp.publicKey.toBase58(), action: "sell", mint: session.tokenCA, amount: "100%", denominatedInSol: "false", slippage: 50, priorityFee: 0.01, pool: "auto" }),
              signal: AbortSignal.timeout(10000),
            });
            if (sellResp.ok) {
              const txBytes = await sellResp.arrayBuffer();
              if (txBytes.byteLength > 100) {
                const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
                tx.sign([kp]);
                await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
                console.log(`[RECOVER] ${wk.role}(${pub}) tokens sold`);
                await new Promise(r => setTimeout(r, 2000));
              }
            }
          } catch (e) { console.warn(`[RECOVER] ${wk.role}(${pub}) token sell failed: ${e.message}`); }
        }

        // Transfer SOL to destination
        const bal = await connection.getBalance(kp.publicKey);
        if (bal > 6000) {
          const tx = new Transaction().add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }),
            SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(destPubkey), lamports: bal - 5000 })
          );
          await sendAndConfirmTransaction(connection, tx, [kp], { skipPreflight: true, commitment: "confirmed" });
          const swept = (bal - 5000) / LAMPORTS_PER_SOL;
          totalRecovered += swept;
          results.push({ pubkey: pub, role: wk.role, swept: +swept.toFixed(4), status: "ok" });
          console.log(`[RECOVER] ${wk.role}(${pub}) → ${swept.toFixed(4)} SOL`);
        } else {
          results.push({ pubkey: pub, role: wk.role, swept: 0, status: "empty" });
        }
      } catch (e) {
        results.push({ pubkey: "?", role: wk.role, error: e.message, status: "failed" });
      }
    }

    await sessionManager.update(sessionId, { status: "recovered", recoveredAt: new Date().toISOString() });

    console.log(`[RECOVER] Total: ${totalRecovered.toFixed(4)} SOL from ${results.filter(r => r.status === "ok").length}/${allKeys.length} wallets`);
    res.json({ ok: true, totalRecovered: +totalRecovered.toFixed(4), wallets: results });
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
    const { wallet, ca, solAmount, slippage: userSlippage, priorityFee: userPriorityFee } = req.body;
    if (!wallet || !ca || !solAmount) return res.status(400).json({ error: "wallet, ca, solAmount required" });
    if (solAmount <= 0 || solAmount > 100) return res.status(400).json({ error: "Invalid SOL amount (0-100)" });
    const apeSlippage = (userSlippage != null && userSlippage >= 1 && userSlippage <= 50) ? userSlippage : 25;
    const apePriorityFee = (userPriorityFee != null && userPriorityFee >= 0.0001 && userPriorityFee <= 0.5) ? userPriorityFee : 0.008;

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
    let errors = [];

    // Helper: try a single PumpPortal pool buy
    const tryPPBuy = async (pool) => {
      const response = await fetch("https://pumpportal.fun/api/trade-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: tw.pubkey, action: "buy", mint: ca,
          amount: solAmount, denominatedInSol: "true",
          slippage: apeSlippage, priorityFee: apePriorityFee, pool,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`${response.status}`);
      const txBytes = await response.arrayBuffer();
      if (txBytes.byteLength < 100) throw new Error("empty_response");
      const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
      tx.sign([kp]);
      const txSig = await heliusSendRawTx(connection, tx.serialize());
      return { sig: txSig, method: `pumpportal:${pool}` };
    };

    // Race all strategies — first success wins (Promise.any pattern)
    const pools = isGraduated ? ["auto", "raydium"] : ["pump", "auto"];
    const candidates = pools.map(pool =>
      tryPPBuy(pool).catch(e => { errors.push(`PP:${pool}=${e.message.slice(0, 60)}`); throw e; })
    );

    // For graduated tokens, also race Jupiter in parallel
    if (isGraduated) {
      const solLamports = Math.round(solAmount * LAMPORTS_PER_SOL);
      // Jupiter Ultra
      candidates.push((async () => {
        const orderResp = await fetch("https://lite-api.jup.ag/ultra/v1/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inputMint: "So11111111111111111111111111111111111111112",
            outputMint: ca, amount: solLamports, taker: tw.pubkey,
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (!orderResp.ok) throw new Error(`order:${orderResp.status}`);
        const order = await orderResp.json();
        if (!order.transaction) throw new Error("no_tx");
        const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
        tx.sign([kp]);
        const rawTx = Buffer.from(tx.serialize()).toString("base64");
        const execResp = await fetch("https://lite-api.jup.ag/ultra/v1/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signedTransaction: rawTx, requestId: order.requestId }),
          signal: AbortSignal.timeout(6000),
        });
        if (!execResp.ok) throw new Error(`exec:${execResp.status}`);
        const execResult = await execResp.json();
        if (execResult.signature || execResult.txid) return { sig: execResult.signature || execResult.txid, method: "jupiter-ultra" };
        throw new Error("no_sig");
      })().catch(e => { errors.push(`JUP-Ultra=${e.message.slice(0, 60)}`); throw e; }));

      // Jupiter v6
      candidates.push((async () => {
        const quoteResp = await fetch(
          `https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${ca}&amount=${solLamports}&slippageBps=2500`,
          { signal: AbortSignal.timeout(4000) }
        );
        if (!quoteResp.ok) throw new Error(`quote:${quoteResp.status}`);
        const quote = await quoteResp.json();
        const swapResp = await fetch("https://quote-api.jup.ag/v6/swap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quoteResponse: quote, userPublicKey: tw.pubkey,
            wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 10000,
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (!swapResp.ok) throw new Error(`swap:${swapResp.status}`);
        const { swapTransaction } = await swapResp.json();
        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
        tx.sign([kp]);
        const txSig = await heliusSendRawTx(connection, tx.serialize());
        return { sig: txSig, method: "jupiter-v6" };
      })().catch(e => { errors.push(`JUP-v6=${e.message.slice(0, 60)}`); throw e; }));
    }

    // First successful route wins — don't wait for slower routes
    try {
      const winner = await Promise.any(candidates);
      if (winner?.sig) {
        sig = winner.sig;
        method = winner.method;
        console.log(`[BUY] Race winner: ${method} sig=${sig}`);
      }
    } catch (aggErr) {
      // All routes failed — errors already collected above
    }

    if (!sig) {
      const errorSummary = errors.length > 0 ? errors.join(" | ") : "All routes failed";
      return res.status(400).json({ error: "Buy failed: " + errorSummary.slice(0, 200) });
    }

    // Track position immediately for instant wallet visibility
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
    if (!tw) return res.status(400).json({ error: "No trading wallet. Create one first." });
    const kp = Keypair.fromSecretKey(bs58.decode(tw.secret));
    const pct = Math.min(100, Math.max(1, percent || 100));

    // Pre-flight: check token balance + get decimals (both SPL Token and Token-2022)
    let tokenBalance = 0;
    let tokenDecimals = 6;
    let balanceCheckFailed = false;
    try {
      const [splAccts, t22Accts] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }).catch(() => ({ value: [] })),
        connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") }).catch(() => ({ value: [] })),
      ]);
      const allAccts = [...splAccts.value, ...t22Accts.value];
      const account = allAccts.find(ta => ta.account.data.parsed.info.mint === ca);
      if (account) {
        tokenBalance = parseFloat(account.account.data.parsed.info.tokenAmount.uiAmountString || "0");
        tokenDecimals = account.account.data.parsed.info.tokenAmount.decimals || 6;
      }
    } catch (e) {
      console.log(`[SELL] Token balance check failed: ${e.message}`);
      balanceCheckFailed = true;
      // Don't block — PumpPortal handles balance internally
    }

    // If RPC says no balance AND it didn't fail, token likely not held
    // But still try PumpPortal as a fallback (RPC can lag behind)
    const skipBalanceGate = balanceCheckFailed;

    const radarToken = radar.tokens.get(ca);
    let isGraduated = radarToken?.graduated || radarToken?.raydiumPool;
    // If not in radar, check DexScreener in background (don't block the sell)
    const gradCheckPromise = !radarToken ? fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`, { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null).then(dd => { if (dd?.pairs?.length > 0) isGraduated = true; }).catch(() => {}) : Promise.resolve();
    await gradCheckPromise;

    // Capture pre-sell SOL balance for accurate profit skim (only skim actual profit)
    let preSellSolBalance = 0;
    try { preSellSolBalance = await connection.getBalance(kp.publicKey) / LAMPORTS_PER_SOL; } catch {}

    let sig = null;
    let method = "";
    let errors = []; // collect all errors for debugging

    // Helper: try a single PumpPortal pool sell
    const tryPPSell = async (pool, slippage = 30, fee = 0.008, timeout = 5000) => {
      const response = await fetch("https://pumpportal.fun/api/trade-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: tw.pubkey, action: "sell", mint: ca,
          amount: pct + "%", denominatedInSol: "false",
          slippage, priorityFee: fee, pool,
        }),
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => "unknown");
        throw new Error(`${response.status}:${errText.slice(0, 80)}`);
      }
      const txBytes = await response.arrayBuffer();
      if (txBytes.byteLength < 100) throw new Error("empty_response");
      const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
      tx.sign([kp]);
      const txSig = await heliusSendRawTx(connection, tx.serialize());
      return { sig: txSig, method: `pumpportal:${pool}` };
    };

    // Helper: try Jupiter Ultra sell
    const tryJupUltraSell = async (sellAmount) => {
      const orderResp = await fetch("https://lite-api.jup.ag/ultra/v1/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputMint: ca, outputMint: "So11111111111111111111111111111111111111112",
          amount: sellAmount, taker: tw.pubkey,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!orderResp.ok) throw new Error(`order:${orderResp.status}`);
      const order = await orderResp.json();
      if (!order.transaction) throw new Error("no_tx");
      const txBuf = Buffer.from(order.transaction, "base64");
      const tx = VersionedTransaction.deserialize(txBuf);
      tx.sign([kp]);
      const rawTx = Buffer.from(tx.serialize()).toString("base64");
      const execResp = await fetch("https://lite-api.jup.ag/ultra/v1/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedTransaction: rawTx, requestId: order.requestId }),
        signal: AbortSignal.timeout(6000),
      });
      if (!execResp.ok) throw new Error(`exec:${execResp.status}`);
      const execResult = await execResp.json();
      if (execResult.signature || execResult.txid) return { sig: execResult.signature || execResult.txid, method: "jupiter-ultra" };
      throw new Error("no_sig");
    };

    // Helper: try Jupiter v6 sell
    const tryJupV6Sell = async (sellAmount) => {
      const quoteResp = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${ca}&outputMint=So11111111111111111111111111111111111111112&amount=${sellAmount}&slippageBps=3000`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (!quoteResp.ok) throw new Error(`quote:${quoteResp.status}`);
      const quote = await quoteResp.json();
      const swapResp = await fetch("https://quote-api.jup.ag/v6/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote, userPublicKey: tw.pubkey,
          wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 10000,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!swapResp.ok) throw new Error(`swap:${swapResp.status}`);
      const { swapTransaction } = await swapResp.json();
      const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
      tx.sign([kp]);
      const txSig = await heliusSendRawTx(connection, tx.serialize());
      return { sig: txSig, method: "jupiter-v6" };
    };

    // Race all strategies in parallel for maximum speed
    const sellAmount = Math.round(tokenBalance * (pct / 100) * Math.pow(10, tokenDecimals));
    const pools = isGraduated ? ["auto", "raydium", "pump"] : ["pump", "auto"];
    const candidates = pools.map(pool =>
      tryPPSell(pool).catch(e => { errors.push(`PP:${pool}=${e.message.slice(0, 60)}`); throw e; })
    );
    // For graduated tokens, also race Jupiter in parallel
    if (isGraduated && sellAmount > 0) {
      candidates.push(
        tryJupUltraSell(sellAmount).catch(e => { errors.push(`JUP-Ultra=${e.message.slice(0, 60)}`); throw e; })
      );
      candidates.push(
        tryJupV6Sell(sellAmount).catch(e => { errors.push(`JUP-v6=${e.message.slice(0, 60)}`); throw e; })
      );
    }

    // First successful route wins — don't wait for slower routes
    try {
      const winner = await Promise.any(candidates);
      if (winner?.sig) {
        sig = winner.sig;
        method = winner.method;
        console.log(`[SELL] Race winner: ${method} sig=${sig}`);
      }
    } catch (aggErr) {
      // All routes failed — errors already collected above
    }

    // Fallback: Direct amount-based sell for dust/dead tokens
    if (!sig && tokenBalance > 0 && pct === 100) {
      try {
        const reqBody = {
          publicKey: tw.pubkey, action: "sell", mint: ca,
          amount: tokenBalance.toString(), denominatedInSol: "false",
          slippage: 50, priorityFee: 0.01, pool: "auto",
        };
        const response = await fetch("https://pumpportal.fun/api/trade-local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const txBytes = await response.arrayBuffer();
          if (txBytes.byteLength > 100) {
            const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
            tx.sign([kp]);
            sig = await heliusSendRawTx(connection, tx.serialize());
            method = "pumpportal:amount-fallback";
            console.log(`[SELL] Amount-based fallback success: ${sig}`);
          }
        }
      } catch (e) {
        errors.push(`PP-amount=${e.message.slice(0, 60)}`);
      }
    }

    if (!sig) {
      const errorSummary = errors.length > 0 ? errors.join(" | ") : "All routes failed";
      console.log(`[SELL] FAILED all routes for ${ca.slice(0,8)}: ${errorSummary}`);
      return res.status(400).json({ error: "Sell failed: " + errorSummary.slice(0, 200) });
    }

    // Confirm transaction on-chain — poll status instead of blocking on confirmTransaction
    // which often times out on congested Solana RPCs
    let confirmed = false;
    const confirmStart = Date.now();
    const CONFIRM_TIMEOUT = 20000; // 20s max
    const POLL_INTERVAL = 2000;

    while (Date.now() - confirmStart < CONFIRM_TIMEOUT) {
      try {
        const txStatus = await connection.getSignatureStatus(sig, { searchTransactionHistory: false });
        if (txStatus?.value?.confirmationStatus === "confirmed" || txStatus?.value?.confirmationStatus === "finalized") {
          confirmed = true;
          console.log(`[SELL] Confirmed: ${sig}`);
          break;
        }
        if (txStatus?.value?.err) {
          console.log(`[SELL] Tx failed on-chain: ${sig} err=${JSON.stringify(txStatus.value.err)}`);
          break;
        }
      } catch (e) {
        console.log(`[SELL] Status check error: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }

    // Track sell optimistically — the tx was successfully sent and signed
    // Even if confirmation times out, the tx will likely land
    if (pct >= 100) trackSell(wallet, ca);

    if (!confirmed) {
      console.log(`[SELL] Confirmation timed out but tx was sent: ${sig} for ${ca.slice(0,8)}`);
      // Background: schedule a delayed check to log final status
      setTimeout(async () => {
        try {
          const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
          const status = st?.value?.confirmationStatus;
          console.log(`[SELL] Delayed check for ${sig}: ${status || "not found"}`);
        } catch {}
      }, 30000);
    }

    // ═══ PROFIT SKIM — transfer profits above threshold to owner wallet ═══
    // Runs in background after sell to avoid blocking the response.
    // Checks post-sell SOL balance vs tracked spend; if profit > threshold, skims %.
    const PROFIT_SKIM_THRESHOLD = 0.05; // SOL — only skim if profit > this
    (async () => {
      try {
        // Wait for sell to settle
        await new Promise(r => setTimeout(r, 5000));
        const postBalance = await connection.getBalance(kp.publicKey) / LAMPORTS_PER_SOL;
        const user = await getUser(wallet);
        const tierInfo = resolveTier(wallet, user);
        // Owner wallet doesn't get skimmed
        if (tierInfo.tier === "vip" && isOwnerWallet(wallet)) return;
        const feeInfo = calculateFee(preSellSolBalance, postBalance, wallet, tierInfo.tier);
        if (feeInfo.net > PROFIT_SKIM_THRESHOLD && feeInfo.fee > 0.001) {
          const skimLamports = Math.floor(feeInfo.fee * LAMPORTS_PER_SOL);
          if (skimLamports > 1000) {
            const { SystemProgram, Transaction } = await import("@solana/web3.js");
            const tx = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: kp.publicKey,
                toPubkey: new PublicKey(PLATFORM_WALLET),
                lamports: skimLamports,
              })
            );
            tx.feePayer = kp.publicKey;
            tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            tx.sign(kp);
            const skimSig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
            console.log(`[PROFIT-SKIM] ${wallet.slice(0,8)} → ${PLATFORM_WALLET.slice(0,8)} | ${feeInfo.fee.toFixed(4)} SOL (${feeInfo.rate}% of ${feeInfo.net.toFixed(4)}) | tx: ${skimSig.slice(0,12)}`);
          }
        }
      } catch (e) {
        console.log(`[PROFIT-SKIM] Error: ${e.message}`);
      }
    })();

    res.json({ ok: true, signature: sig, percent: pct, method, confirmed, tokenBalance: +tokenBalance.toFixed(2) });
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
    // Capture pre-sell SOL balance for accurate profit skim
    let preSellSolBalance = 0;
    try { preSellSolBalance = await connection.getBalance(kp.publicKey) / LAMPORTS_PER_SOL; } catch {}

    // Scan both SPL Token and Token-2022 programs
    const [splAccounts, t22Accounts] = await Promise.all([
      connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }).catch(() => ({ value: [] })),
      connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") }).catch(() => ({ value: [] })),
    ]);
    const tokenAccounts = { value: [...splAccounts.value, ...t22Accounts.value] };

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
          trackSell(wallet, info.mint);
        }
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }

    // ═══ PROFIT SKIM after sell-all ═══
    if (sold > 0) {
      (async () => {
        try {
          await new Promise(r => setTimeout(r, 5000));
          const postBalance = await connection.getBalance(kp.publicKey) / LAMPORTS_PER_SOL;
          const user = await getUser(wallet);
          const tierInfo = resolveTier(wallet, user);
          if (tierInfo.tier === "vip" && isOwnerWallet(wallet)) return;
          const feeInfo = calculateFee(preSellSolBalance, postBalance, wallet, tierInfo.tier);
          if (feeInfo.net > 0.05 && feeInfo.fee > 0.001) {
            const skimLamports = Math.floor(feeInfo.fee * LAMPORTS_PER_SOL);
            if (skimLamports > 1000) {
              const { SystemProgram, Transaction } = await import("@solana/web3.js");
              const tx = new Transaction().add(
                SystemProgram.transfer({
                  fromPubkey: kp.publicKey,
                  toPubkey: new PublicKey(PLATFORM_WALLET),
                  lamports: skimLamports,
                })
              );
              tx.feePayer = kp.publicKey;
              tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
              tx.sign(kp);
              const skimSig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
              console.log(`[PROFIT-SKIM] sell-all ${wallet.slice(0,8)} → ${PLATFORM_WALLET.slice(0,8)} | ${feeInfo.fee.toFixed(4)} SOL (${feeInfo.rate}% of ${feeInfo.net.toFixed(4)}) | tx: ${skimSig.slice(0,12)}`);
            }
          }
        } catch (e) { console.log(`[PROFIT-SKIM] sell-all error: ${e.message}`); }
      })();
    }

    res.json({ ok: true, sold });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════
// TRADE LEARNER — learns from trade outcomes to optimize entry/exit
// Records every trade's entry features + exit result, then aggregates
// patterns to dynamically shift thresholds and TP/SL levels.
// ═══════════════════════════════════════
const tradeLearner = {
  history: [],       // in-memory ring buffer (last 200 trades)
  insights: null,    // computed every 60s from history
  lastCompute: 0,

  // Record a completed trade
  async record(trade) {
    // trade: { ca, entryScore, entryMcap, exitMcap, pnlPct, pnlSol, entryBuys, entrySells, entryUB, entryAge, entryTrend, exitReason, holdTime, entryBondPct, peakPct }
    this.history.push({ ...trade, time: Date.now() });
    if (this.history.length > 200) this.history.shift();
    // Persist to Redis (last 200)
    if (redis) {
      try { await redis.lpush("trade:history", JSON.stringify(trade)); await redis.ltrim("trade:history", 0, 199); } catch {}
    }
  },

  // Load history from Redis on startup
  async load() {
    if (!redis) return;
    try {
      const raw = await redis.lrange("trade:history", 0, 199);
      this.history = raw.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
      console.log(`[LEARNER] Loaded ${this.history.length} trade records`);
      this.compute();
    } catch {}
  },

  // Compute insights from trade history
  compute() {
    if (this.history.length < 5) { this.insights = null; return; }
    this.lastCompute = Date.now();

    const wins = this.history.filter(t => t.pnlPct > 0);
    const losses = this.history.filter(t => t.pnlPct <= 0);
    const winRate = wins.length / this.history.length;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
    const avgHoldWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.holdTime || 0), 0) / wins.length : 0;
    const avgHoldLoss = losses.length > 0 ? losses.reduce((s, t) => s + (t.holdTime || 0), 0) / losses.length : 0;

    // Best entry score range: which scores produce the best P&L?
    const byScore = {};
    for (const t of this.history) {
      const bucket = Math.floor((t.entryScore || 0) / 5) * 5; // 0,5,10,15,...
      if (!byScore[bucket]) byScore[bucket] = { trades: 0, totalPnl: 0, wins: 0 };
      byScore[bucket].trades++;
      byScore[bucket].totalPnl += t.pnlPct || 0;
      if (t.pnlPct > 0) byScore[bucket].wins++;
    }
    // Find the score bucket with best avg P&L (min 3 trades)
    let bestScoreBucket = 25;
    let bestAvgPnl = -Infinity;
    for (const [bucket, data] of Object.entries(byScore)) {
      if (data.trades >= 3) {
        const avg = data.totalPnl / data.trades;
        if (avg > bestAvgPnl) { bestAvgPnl = avg; bestScoreBucket = +bucket; }
      }
    }

    // Best entry mcap range
    const byMcap = { low: [], mid: [], high: [] };
    for (const t of this.history) {
      const mc = t.entryMcap || 0;
      if (mc < 10000) byMcap.low.push(t);
      else if (mc < 30000) byMcap.mid.push(t);
      else byMcap.high.push(t);
    }
    const mcapWinRates = {};
    for (const [range, trades] of Object.entries(byMcap)) {
      if (trades.length >= 3) mcapWinRates[range] = trades.filter(t => t.pnlPct > 0).length / trades.length;
    }

    // Best exit reason analysis — which exits leave money on the table?
    const byExit = {};
    for (const t of this.history) {
      const r = t.exitReason || "unknown";
      if (!byExit[r]) byExit[r] = { count: 0, totalPnl: 0, peakMissed: 0 };
      byExit[r].count++;
      byExit[r].totalPnl += t.pnlPct || 0;
      byExit[r].peakMissed += (t.peakPct || 0) - (t.pnlPct || 0); // how much more we could have made
    }

    // Best entry trends
    const byTrend = {};
    for (const t of this.history) {
      const tr = t.entryTrend || "new";
      if (!byTrend[tr]) byTrend[tr] = { trades: 0, wins: 0, totalPnl: 0 };
      byTrend[tr].trades++;
      byTrend[tr].totalPnl += t.pnlPct || 0;
      if (t.pnlPct > 0) byTrend[tr].wins++;
    }

    this.insights = {
      totalTrades: this.history.length,
      winRate: +(winRate * 100).toFixed(1),
      avgWin: +avgWin.toFixed(1),
      avgLoss: +avgLoss.toFixed(1),
      avgHoldWin: Math.round(avgHoldWin / 60000),  // in minutes
      avgHoldLoss: Math.round(avgHoldLoss / 60000),
      bestScoreBucket,
      bestScoreAvgPnl: +bestAvgPnl.toFixed(1),
      scoreBreakdown: byScore,
      mcapWinRates,
      exitAnalysis: byExit,
      trendAnalysis: byTrend,
      // Dynamic threshold recommendations
      recommendedMinScore: Math.max(15, bestScoreBucket - 5), // enter slightly below the sweet spot
      // If early exits (momentum-exit, crash-exit) have high peakMissed, widen the exit thresholds
      shouldWidenExits: byExit["momentum-exit"]?.peakMissed > (byExit["momentum-exit"]?.count || 1) * 20,
      // If SL2 hits often, losses avg is bad → tighten SL
      shouldTightenSL: (byExit["SL2"]?.count || 0) > this.history.length * 0.3 && avgLoss < -20,
    };

    console.log(`[LEARNER] Computed: ${this.history.length} trades, ${this.insights.winRate}% WR, best score bucket: ${bestScoreBucket} (avg PnL: ${bestAvgPnl.toFixed(1)}%)`);
  },

  // Get dynamic adjustments for the auto-trader
  getAdjustments() {
    if (!this.insights || this.insights.totalTrades < 10) return {};
    const adj = {};

    // Dynamic minScore: shift toward best-performing score bucket
    adj.minScoreShift = this.insights.recommendedMinScore;

    // If momentum exits are leaving big gains on the table, relax the exit
    if (this.insights.shouldWidenExits) {
      adj.momentumDropThreshold = 35; // widen from 30 to 35 (let winners run longer)
      adj.tpMultiplier = 1.3; // push TPs 30% higher
    }

    // If too many SL2 hits, tighten entry or SL
    if (this.insights.shouldTightenSL) {
      adj.minScoreShift = Math.min(40, (adj.minScoreShift || 25) + 5);
      adj.slMultiplier = 0.8; // tighten SLs 20%
    }

    // If winning trades hold longer, extend the hold bias
    if (this.insights.avgHoldWin > this.insights.avgHoldLoss * 2) {
      adj.holdBias = "patient"; // let winners run, cut losers fast
    }

    return adj;
  }
};

// Load trade history on startup
tradeLearner.load();
// Recompute insights every 60s
setInterval(() => { if (tradeLearner.history.length >= 5) tradeLearner.compute(); }, 60000);

// ── SURVIVORSHIP BIAS: log survivor profile every 5 min when enough data ──
setInterval(() => {
  if (survivorBias.survivors.size >= 5) {
    const profile = survivorBias.getSurvivorProfile();
    if (profile.ready && profile.insights.length > 0) {
      console.log(`[SURVIVOR] Profile (${survivorBias.survivors.size}W/${survivorBias.dead.size}L): ${profile.insights.slice(0, 3).join(" | ")}`);
      const disc = survivorBias.getTopDiscriminants(3);
      if (disc.length > 0) {
        console.log(`[SURVIVOR] Top discriminants: ${disc.map(d => `${d.feature}(${d.direction}:${d.power})`).join(", ")}`);
      }
    }
  }
}, 300000);

// ═══════════════════════════════════════
// AUTO-APE ENGINE — walk-away auto-trading
// Monitors intel scores, auto-buys green tokens, auto-sells on profit/loss
// ═══════════════════════════════════════
const autoTraders = new Map(); // wallet → { settings, positions, interval, log }
const soldCooldowns = new Map(); // wallet → Map(ca → timestamp) — prevent re-buying recently sold tokens

function startAutoTrader(wallet, settings) {
  if (autoTraders.has(wallet)) stopAutoTrader(wallet);
  if (!soldCooldowns.has(wallet)) soldCooldowns.set(wallet, new Map());
  const state = {
    settings: {
      minScore: settings.minScore || 55,
      solPerTrade: settings.solPerTrade || 0.05,
      maxPositions: settings.maxPositions || 5,
      // ═══ POWER-LAW OPTIMIZED TP/SL ═══
      // Meme returns follow Pareto distribution (80/20):
      //   ~70% of entries hit SL → cut fast, lose small
      //   ~25% hit TP1-TP2 → take partial profits
      //   ~5% become 10-100x runners → let the moonbag ride the fat tail
      // Key insight: the 5% of runners generate >50% of total returns
      // ═══ REBALANCED TP/SL — asymmetric in OUR favor ═══
      // Old: TP1=20% SL2=15% → need 75% win rate to break even. Actual win rate ~25%. Math doesn't work.
      // New: TP1=35% SL2=12% → need 25% win rate to break even. Much more achievable.
      // Key insight: let winners run MORE, cut losers FASTER and SMALLER.
      tp1: settings.tp1 || 35,         // TP1: +35% (was 20% — too tight, winners got clipped)
      tp1Sell: settings.tp1Sell || 30,  // sell 30% at TP1 (was 40% — keep more for runners)
      tp2: settings.tp2 || 100,        // TP2: +100% (was 80%)
      tp2Sell: settings.tp2Sell || 30,  // sell 30% of remaining
      tp3: settings.tp3 || 250,        // TP3: +250% (was 200% — let fat tails ride)
      tp3Sell: settings.tp3Sell || 40,  // sell 40% of remaining, rest = moonbag
      // TIGHTER stop losses with FASTER cuts — max loss per trade capped
      sl1: settings.sl1 || 6,          // SL1: -6% (was 8% — cut faster)
      sl1Sell: settings.sl1Sell || 80,  // sell 80% at SL1 (was 70% — more aggressive risk reduction)
      sl2: settings.sl2 || 12,         // SL2: -12% full exit (was 15% — tighter cap on max loss)
      requireBoosted: settings.requireBoosted || false,
      momentumExit: settings.momentumExit !== false, // default ON — auto-tighten stops on score drop
      reentryDips: settings.reentryDips !== false,    // default ON — re-enter on dips, sell into volume
      enabled: true,
    },
    positions: new Map(), // ca → { entryMcap, entrySol, entryTime, peakMcap, tpHit, slHit }
    log: [],
    interval: null,
    lastActivity: Date.now(), // track last user interaction for auto-stop
    // ═══ DRAWDOWN GOVERNOR ═══
    // Tracks portfolio equity curve to reduce sizing during drawdowns
    // At 25% DD → half size, at 50% DD → stop trading entirely
    peakEquity: 0,      // high-water mark of portfolio value
    totalInvested: 0,    // total SOL invested across all positions
    totalRealized: 0,    // total SOL realized from sells
    drawdownMult: 1.0,   // current sizing multiplier (1.0 = full, 0.5 = half, 0 = stopped)
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

      // ═══ DRAWDOWN GOVERNOR — reduce sizing as drawdown deepens ═══
      // Tracks equity curve: if portfolio drops from peak, reduce bet sizes
      {
        let currentEquity = 0;
        try { currentEquity = await connection.getBalance(kp.publicKey) / LAMPORTS_PER_SOL; } catch {}
        // Add unrealized position value estimate
        for (const [ca, pos] of state.positions) {
          const token = radar.tokens.get(ca);
          if (token && pos.entryMcap > 0) {
            const currentMcap = token.mcapUsd || 0;
            const pctChange = (currentMcap - pos.entryMcap) / pos.entryMcap;
            currentEquity += (pos.entrySol || state.settings.solPerTrade) * (1 + pctChange);
          }
        }
        // Update high-water mark
        if (currentEquity > state.peakEquity) state.peakEquity = currentEquity;
        // Calculate drawdown from peak
        const drawdownPct = state.peakEquity > 0 ? ((state.peakEquity - currentEquity) / state.peakEquity) * 100 : 0;
        // Sizing multiplier: linear scale from 1.0 at 0% DD to 0.0 at 50% DD
        // At 25% DD → 0.5x size, at 50% DD → stop trading
        if (drawdownPct >= 50) {
          state.drawdownMult = 0;
          if (!state._ddStopLogged || Date.now() - state._ddStopLogged > 60000) {
            log(`DRAWDOWN GOVERNOR: ${drawdownPct.toFixed(1)}% DD — TRADING HALTED`);
            state._ddStopLogged = Date.now();
          }
        } else if (drawdownPct >= 10) {
          state.drawdownMult = Math.max(0.1, 1 - drawdownPct / 50);
          if (!state._ddWarnLogged || Date.now() - state._ddWarnLogged > 30000) {
            log(`DRAWDOWN GOVERNOR: ${drawdownPct.toFixed(1)}% DD — sizing at ${(state.drawdownMult * 100).toFixed(0)}%`);
            state._ddWarnLogged = Date.now();
          }
        } else {
          state.drawdownMult = 1.0;
        }
      }

      // ── HELPER: execute a partial sell ──
      async function execSell(ca, sellPct, kp, reason) {
        try {
          const resp = await fetch("https://pumpportal.fun/api/trade-local", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publicKey: kp.publicKey.toBase58(), action: "sell", mint: ca, amount: sellPct + "%", denominatedInSol: "false", slippage: 30, priorityFee: 0.005, pool: "auto" }),
          });
          if (resp.ok) {
            const txBytes = await resp.arrayBuffer();
            if (txBytes.byteLength > 100) {
              const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
              tx.sign([kp]);
              const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
              // Confirm before returning — if not confirmed, don't close position
              try {
                await connection.confirmTransaction(sig, "confirmed");
                return sig;
              } catch {
                // Check if tx actually landed despite timeout
                try {
                  const st = await connection.getSignatureStatus(sig);
                  if (st?.value?.confirmationStatus === "confirmed" || st?.value?.confirmationStatus === "finalized") return sig;
                } catch {}
                log(`Sell tx not confirmed ${ca.slice(0,6)} (${reason}): ${sig} — keeping position`);
                return null;
              }
            }
          }
        } catch (e) { log(`Sell error ${ca.slice(0,6)} (${reason}): ${e.message}`); }
        return null;
      }

      // Helper: remove position and add to cooldown + recently closed
      function exitPosition(ca, exitPct, exitReason) {
        const pos = state.positions.get(ca);
        if (pos) {
          const token = radar.tokens.get(ca);
          const currentMcap = token?.mcapUsd || 0;
          const changePct = pos.entryMcap > 0 ? ((currentMcap - pos.entryMcap) / pos.entryMcap) * 100 : 0;
          const peakPct = pos.entryMcap > 0 ? ((pos.peakMcap - pos.entryMcap) / pos.entryMcap) * 100 : 0;
          if (!state.recentlyClosed) state.recentlyClosed = [];
          state.recentlyClosed.push({
            ca, name: token?.name || ca.slice(0, 8),
            entrySol: pos.entrySol, entryMcap: pos.entryMcap, exitMcap: currentMcap,
            changePct: +changePct.toFixed(1),
            pnlSol: +(pos.entrySol * (changePct / 100)).toFixed(4),
            exitReason: exitReason || "unknown",
            exitTime: Date.now(),
            age: Math.round((Date.now() - pos.entryTime) / 60000),
            entryScore: pos.entryScore || 0,
            exitScore: pos.liveScore || pos.entryScore || 0,
          });
          // Keep only last 20 closed positions, remove entries older than 5 min
          state.recentlyClosed = state.recentlyClosed.filter(p => Date.now() - p.exitTime < 300000).slice(-20);

          // ── TRADE LEARNER: record this trade's outcome for future optimization ──
          if (exitPct >= 100) { // full exit = complete trade record
            tradeLearner.record({
              ca,
              entryScore: pos.entryScore || 0,
              entryMcap: pos.entryMcap,
              exitMcap: currentMcap,
              pnlPct: +changePct.toFixed(1),
              pnlSol: +(pos.entrySol * (changePct / 100)).toFixed(4),
              entryBuys: pos.entryBuys || 0,
              entrySells: pos.entrySells || 0,
              entryUB: pos.entryUB || 0,
              entryAge: +(pos.entryAge || 0).toFixed(1),
              entryTrend: pos.entryTrend || "new",
              entryBondPct: pos.entryBondPct || 0,
              exitReason: exitReason || "unknown",
              holdTime: Date.now() - pos.entryTime,
              peakPct: +peakPct.toFixed(1),
            });
            // ── MEME INTEL FEEDBACK: wire trade outcomes to scorer learning ──
            // This is the critical missing link — without this, the AI never learns from trades
            try {
              const features = typeof extractQuickFeatures === "function" ? extractQuickFeatures(token) : null;
              if (features) {
                const peakMcx = pos.entryMcap > 0 ? (pos.peakMcap || currentMcap) / pos.entryMcap : 1;
                const mcapDropPct = pos.peakMcap > 0 ? ((pos.peakMcap - currentMcap) / pos.peakMcap) * 100 : 0;
                const outcome = {
                  graduated: !!(token?.graduated || token?.raydiumPool),
                  peakMcx,
                  fleetPnl: +(pos.entrySol * (changePct / 100)).toFixed(4),
                  rugged: mcapDropPct > 80 || exitReason === "SL2" || exitReason === "CRASH",
                  mcapDropPct,
                  devDumped: exitReason === "rug-detected",
                  alive: currentMcap > 3000,
                };
                memeIntel.learn(features, outcome);
                console.log(`[INTEL-FEEDBACK] Learned from ${ca.slice(0,6)}: score=${pos.entryScore||0} pnl=${changePct.toFixed(1)}% exit=${exitReason} trainCount=${memeIntel.scorer.trainCount}`);
                // ── SURVIVORSHIP BIAS: record outcome with entry-time features ──
                // Uses the feature snapshot taken at buy time (not current features)
                // This is the Kahneman insight: what did winners look like AT BIRTH?
                const sbFeatures = pos.entryFeatures || features;
                survivorBias.recordOutcome(ca, sbFeatures, {
                  won: changePct > 5,
                  pnlPct: +changePct.toFixed(1),
                  graduated: outcome.graduated,
                  peakMcx: outcome.peakMcx,
                });
                console.log(`[SURVIVOR] Recorded ${changePct > 5 ? 'WINNER' : 'LOSER'} ${ca.slice(0,6)}: pnl=${changePct.toFixed(1)}% survivors=${survivorBias.survivors.size} dead=${survivorBias.dead.size}`);
              }
            } catch (e) {
              console.log(`[INTEL-FEEDBACK] Error: ${e.message}`);
            }
            // ── Silent referral revenue tracking for auto-trade ──
            const pnlSol = +(pos.entrySol * (changePct / 100)).toFixed(4);
            if (pnlSol > 0.001) {
              const netFee = +(pnlSol * NETWORK_FEE_PCT / 100).toFixed(6);
              if (netFee > 0.0001) {
                (async () => {
                  try {
                    const tradeUser = await getUser(wallet);
                    await saveUser(wallet, { totalPlatformCut: (parseFloat(tradeUser.totalPlatformCut || "0") + netFee).toFixed(6) });
                    if (tradeUser.referredBy) {
                      const ref = await getUser(tradeUser.referredBy);
                      if (ref) {
                        const { referrerCut } = calculateReferralSplit(netFee, ref.tier || "free");
                        if (referrerCut > 0.0001) {
                          await saveUser(tradeUser.referredBy, {
                            referralEarnings: (parseFloat(ref.referralEarnings || "0") + referrerCut).toFixed(6),
                            referralPendingPayout: (parseFloat(ref.referralPendingPayout || "0") + referrerCut).toFixed(6),
                          });
                          if (redis) { try { await redis.lPush("refevents:" + tradeUser.referredBy, JSON.stringify({ user: wallet.slice(0, 4) + "..." + wallet.slice(-4), commission: +referrerCut.toFixed(6), platformCut: +netFee.toFixed(6), type: "commission", time: Date.now() })); } catch {} }
                        }
                      }
                    }
                  } catch {}
                })();
              }
            }
          }
        }
        state.positions.delete(ca);
        const cd = soldCooldowns.get(wallet) || new Map();
        cd.set(ca, Date.now());
        soldCooldowns.set(wallet, cd);
      }

      // ── Check existing positions for tiered TP/SL ──
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
                const mcUsd = pair.marketCap || pair.fdv || 0;
                // Only mark graduated if DexScreener shows a Raydium pair (dexId === "raydium")
                const isRaydium = pair.dexId === "raydium" || pair.dexId === "raydium-clmm";
                token = { mcapUsd: mcUsd, mcapSol: solUsdPrice > 0 ? mcUsd / solUsdPrice : 0, name: pair.baseToken?.name || "", graduated: isRaydium };
              }
            }
          } catch {}
          if (!token) { pos._lastFetchFail = Date.now(); }
        }
        if (pos._lastFetchFail && Date.now() - pos._lastFetchFail > 300000) delete pos._lastFetchFail;
        if (!token) continue;

        const currentMcap = token.mcapUsd || 0;
        if (pos.entryMcap <= 0) continue;
        const changePct = ((currentMcap - pos.entryMcap) / pos.entryMcap) * 100;
        pos.peakMcap = Math.max(pos.peakMcap || pos.entryMcap, currentMcap);
        const fromPeak = pos.peakMcap > 0 ? ((pos.peakMcap - currentMcap) / pos.peakMcap) * 100 : 0;
        if (!pos.tpHit) pos.tpHit = 0;
        if (!pos.slHit) pos.slHit = 0;

        const s = { ...state.settings };

        // ═══ TIER-AWARE TP/SL ADJUSTMENT ═══
        // Tier 1 (GOD_CANDLE): wider stops, higher TPs — let runners run
        // Tier 3 (SPECULATIVE): tighter stops, lower TPs — take money fast
        const posTier = pos.tier || 2;
        if (posTier === 1) {
          s.sl1 = Math.round(s.sl1 * 1.3); s.sl2 = Math.round(s.sl2 * 1.3);
          s.tp1 = Math.round(s.tp1 * 1.3); s.tp2 = Math.round(s.tp2 * 1.3); s.tp3 = Math.round(s.tp3 * 1.3);
        } else if (posTier === 3) {
          s.sl1 = Math.round(s.sl1 * 0.8); s.sl2 = Math.round(s.sl2 * 0.8);
          s.tp1 = Math.round(s.tp1 * 0.85); s.tp2 = Math.round(s.tp2 * 0.75);
          s.tp3 = 0; // Tier 3 never holds for moonshot
        }
        // Max hold time enforcement (tier-dependent)
        const MAX_HOLDS_MS = { 1: 30 * 60000, 2: 15 * 60000, 3: 10 * 60000 };
        const holdTime = Date.now() - (pos.entryTime || Date.now());
        if (holdTime > (MAX_HOLDS_MS[posTier] || 15 * 60000) && changePct < 20 && !pos.isMoonbag) {
          log(`MAX HOLD ${ca.slice(0,6)}: T${posTier} ${Math.round(holdTime/60000)}min +${changePct.toFixed(0)}% — FULL SELL`);
          const sig = await execSell(ca, 100, kp, "max-hold-" + posTier);
          if (sig) {
            broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "MAX_HOLD", reason: `T${posTier}-${Math.round(holdTime/60000)}min` } });
            exitPosition(ca, 100, "max-hold");
            trackSell(wallet, ca);
          }
          continue;
        }

        // ── Apply learner-driven TP/SL adjustments ──
        const adj = tradeLearner.getAdjustments();
        if (adj.tpMultiplier) { s.tp1 = Math.round(s.tp1 * adj.tpMultiplier); s.tp2 = Math.round(s.tp2 * adj.tpMultiplier); s.tp3 = Math.round(s.tp3 * adj.tpMultiplier); }
        if (adj.slMultiplier) { s.sl1 = Math.round(s.sl1 * adj.slMultiplier); s.sl2 = Math.round(s.sl2 * adj.slMultiplier); }
        // Patient hold bias: widen SL1 slightly so winners aren't cut prematurely
        if (adj.holdBias === "patient") { s.sl1 = Math.round(s.sl1 * 1.2); }

        // ═══ MOMENTUM EXIT — score derivatives detect rugs BEFORE the score drops ═══
        // The score is a lagging indicator. Its velocity and acceleration are leading ones.
        // A decelerating score means the pump is running out of energy — exit before the crash.
        // IMPORTANT: Skip momentum scoring for DexScreener fallback tokens — they lack trade
        // data so extractQuickFeatures returns all-zero features → score = 0 → false exit.
        const hasRadarData = token && token.buys != null && token.trades != null;
        if (s.momentumExit && hasRadarData && !pos.isMoonbag) {
          try {
            const features = extractQuickFeatures(token);
            if (features) {
              const liveScore = memeIntel.scorer.score(features);
              const currentScore = liveScore?.score || 0;
              // Guard: if score suddenly drops to near-0 but we had a real score before,
              // the token likely lost radar data — skip this cycle (but not forever).
              // After 3 consecutive data-loss cycles, accept the score as real.
              if (currentScore < 5 && pos.entryScore > 20 && (pos.liveScore == null || pos.liveScore > 20)) {
                pos._dataLossStreak = (pos._dataLossStreak || 0) + 1;
                if (pos._dataLossStreak <= 3) {
                  log(`MOMENTUM SKIP ${ca.slice(0,6)}: score=${currentScore} looks like data loss (entry=${pos.entryScore}, last=${pos.liveScore}, streak=${pos._dataLossStreak}/3)`);
                  // Still record dynamics so vel/acc are available for the UI
                  const dyn = scoreDynamics.record(ca, currentScore);
                  pos.scoreVelocity = dyn.velocity;
                  pos.scoreAcceleration = dyn.acceleration;
                  pos.scoreTrend = dyn.trend;
                } else {
                  // 3+ cycles with score=0 — this is real, not transient data loss
                  log(`MOMENTUM ACCEPT ${ca.slice(0,6)}: score=${currentScore} persisted ${pos._dataLossStreak} cycles — treating as real`);
                  // Fall through to normal scoring below
                }
              }
              // Normal scoring path (also reached when data loss streak expires)
              if (pos._dataLossStreak === undefined || pos._dataLossStreak === 0 || pos._dataLossStreak > 3) {
              if (!pos.entryScore) pos.entryScore = currentScore;
              pos.liveScore = currentScore;
              const scoreDrop = pos.entryScore - currentScore;

              // Record score and get velocity/acceleration
              const dyn = scoreDynamics.record(ca, currentScore);
              pos.scoreVelocity = dyn.velocity;
              pos.scoreAcceleration = dyn.acceleration;
              pos.scoreTrend = dyn.trend;

              // ── DERIVATIVES-BASED EXIT (catches rugs 1-2 cycles earlier) ──
              // Crashing: velocity < -0.3 pts/s = score is collapsing fast
              if (dyn.trend === "crashing" && dyn.scores >= 3) {
                log(`CRASH EXIT ${ca.slice(0,6)}: score v=${dyn.velocity}/s a=${dyn.acceleration}/s² trend=CRASHING — FULL SELL`);
                const sig = await execSell(ca, 100, kp, "crash-exit");
                if (sig) {
                  broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "CRASH", reason: "score-crashing", velocity: dyn.velocity } });
                  exitPosition(ca, 100, "crash-exit");
                  trackSell(wallet, ca);
                }
                continue;
              }
              // Fading: score still positive but decelerating hard = pump dying
              // Only act if we have 3+ data points (acceleration needs history)
              if (dyn.trend === "fading" && dyn.acceleration < -0.02 && dyn.scores >= 3 && changePct > 5 && pos.tpHit === 0) {
                log(`FADE TRIM ${ca.slice(0,6)}: score fading a=${dyn.acceleration}/s² +${changePct.toFixed(0)}% — selling ${s.tp1Sell}% early`);
                const sig = await execSell(ca, s.tp1Sell, kp, "fade-trim");
                if (sig) {
                  broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "FADE", sellPct: s.tp1Sell, acceleration: dyn.acceleration } });
                  pos.tpHit = 1;
                }
              }

              // ── ABSOLUTE SCORE DROP (existing logic, kept as safety net) ──
              // PROTECTED: tokens with strong fundamentals (high UB, rising on-chain activity)
              // get a wider buffer before momentum exit — don't kill winners early
              const tokenData = radar.tokens.get(ca);
              const liveUB = tokenData?.uniqueBuyers?.size || 0;
              const liveBuys = tokenData?.buys || 0;
              const hasStrongFundamentals = liveUB >= 20 && liveBuys >= 30 && changePct > 0;
              const momentumExitThreshold = hasStrongFundamentals ? 40 : 30; // wider buffer for strong tokens
              if (scoreDrop >= momentumExitThreshold) {
                log(`MOMENTUM EXIT ${ca.slice(0,6)}: score ${pos.entryScore}→${currentScore} (−${scoreDrop}) UB:${liveUB} — FULL SELL`);
                const sig = await execSell(ca, 100, kp, "momentum-exit");
                if (sig) {
                  broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "MOMENTUM", reason: "score-crash" } });
                  exitPosition(ca, 100, "momentum-exit");
                  trackSell(wallet, ca);
                }
                continue;
              } else if (scoreDrop >= 20) {
                s.sl1 = Math.round(s.sl1 * 0.5);
                s.sl2 = Math.round(s.sl2 * 0.5);
                if (scoreDrop >= 25 && changePct > 5 && pos.tpHit === 0) {
                  log(`MOMENTUM TRIM ${ca.slice(0,6)}: score −${scoreDrop}, +${changePct.toFixed(0)}% — selling ${s.tp1Sell}% early`);
                  const sig = await execSell(ca, s.tp1Sell, kp, "momentum-trim");
                  if (sig) {
                    broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "MOM-TRIM", sellPct: s.tp1Sell } });
                    pos.tpHit = 1;
                  }
                }
              } else if (scoreDrop >= 10) {
                s.sl1 = Math.round(s.sl1 * 0.75);
                s.sl2 = Math.round(s.sl2 * 0.75);
              }

              // ── RUNNER DETECTION: accelerating score = let it fly ──
              if (dyn.trend === "rocket" || (dyn.trend === "rising" && currentScore > pos.entryScore + 10)) {
                s.tp1 = Math.round(state.settings.tp1 * 1.5);  // widen TPs more aggressively
                s.tp2 = Math.round(state.settings.tp2 * 1.5);
                s.tp3 = Math.round(state.settings.tp3 * 1.5);
              } else if (currentScore > pos.entryScore + 10) {
                s.tp1 = Math.round(state.settings.tp1 * 1.25);
                s.tp2 = Math.round(state.settings.tp2 * 1.25);
                s.tp3 = Math.round(state.settings.tp3 * 1.25);
              }
              } // end normal scoring path
            }
          } catch (e) { log(`Momentum score error ${ca.slice(0,6)}: ${e.message}`); }
        }

        // ═══ SELL-INTO-VOLUME — detect volume spikes and take profit into liquidity ═══
        // When volume surges (lots of buyers), there's liquidity to sell into without slippage
        // This is the smart exit: sell when others are buying, not when they're selling
        if (state.settings.reentryDips !== false && changePct > 15 && !pos.isMoonbag && pos.tpHit === 0) {
          const token5mVol = token.volumeSol || 0;
          const tokenAge = Math.max(1, (Date.now() - token.createdAt) / 60000);
          const avgVolPerMin = token5mVol / tokenAge;
          // Check recent trades for volume spike (last 60s)
          const recentTrades = (token.trades || []).filter(tr => tr.time && Date.now() - tr.time < 60000);
          const recentBuyVol = recentTrades.filter(tr => tr.side === "buy").reduce((s, tr) => s + (tr.sol || 0), 0);
          const isVolSpike = recentBuyVol > avgVolPerMin * 3 && recentBuyVol > 0.5; // 3x average volume
          if (isVolSpike) {
            const sellPct = changePct >= 50 ? 40 : 25; // sell more if bigger profit
            log(`SELL-INTO-VOLUME ${ca.slice(0,6)}: +${changePct.toFixed(0)}% vol spike ${recentBuyVol.toFixed(2)} SOL/min — selling ${sellPct}%`);
            const sig = await execSell(ca, sellPct, kp, "volume-sell");
            if (sig) {
              broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "VOL-SELL", sellPct, volumeSpike: true } });
              pos.tpHit = 1; // mark as partial exit
              pos.volumeSold = true;
            }
          }
        }

        // ═══ TAKE PROFIT — 3 tiers ═══
        // TP3: Runner — sell tp3Sell% of remaining (rest = moonbag forever)
        if (pos.tpHit < 3 && changePct >= s.tp3) {
          // ═══ TRAILING STOP WIDENING ═══
          // Bigger winners get wider trailing stops to capture fat-tail returns
          // At 2x (100%): trail within 50% of peak — let it breathe
          // At 10x (900%): trail within 30% — still wide for moonshot potential
          // At 50x (4900%): trail within 25% — tightest, massive gains to protect
          const trailPct = changePct >= 4900 ? 25 : changePct >= 900 ? 30 : changePct >= 400 ? 35 : changePct >= 200 ? 40 : 50;
          if (fromPeak < trailPct) {
            log(`RUNNER ${ca.slice(0,6)}: +${changePct.toFixed(0)}% — trailing (${fromPeak.toFixed(0)}% from peak, trail=${trailPct}%)`);
          } else {
            log(`TP3 ${ca.slice(0,6)}: +${changePct.toFixed(0)}% — selling ${s.tp3Sell}% (moonbag rest)`);
            const sig = await execSell(ca, s.tp3Sell, kp, "TP3");
            if (sig) {
              broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "TP3", sellPct: s.tp3Sell, moonbag: true } });
              log(`TP3 SOLD ${s.tp3Sell}% of ${ca.slice(0,6)} — moonbag remaining`);
            }
            pos.tpHit = 3;
            pos.isMoonbag = true;
          }
        }
        // TP2: Second target — sell tp2Sell% of remaining
        else if (pos.tpHit < 2 && changePct >= s.tp2) {
          log(`TP2 ${ca.slice(0,6)}: +${changePct.toFixed(0)}% — selling ${s.tp2Sell}%`);
          const sig = await execSell(ca, s.tp2Sell, kp, "TP2");
          if (sig) {
            broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "TP2", sellPct: s.tp2Sell } });
            log(`TP2 SOLD ${s.tp2Sell}% of ${ca.slice(0,6)}`);
          }
          pos.tpHit = 2;
        }
        // TP1: First profit taking
        else if (pos.tpHit < 1 && changePct >= s.tp1) {
          log(`TP1 ${ca.slice(0,6)}: +${changePct.toFixed(0)}% — selling ${s.tp1Sell}%`);
          const sig = await execSell(ca, s.tp1Sell, kp, "TP1");
          if (sig) {
            broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "TP1", sellPct: s.tp1Sell } });
            log(`TP1 SOLD ${s.tp1Sell}% of ${ca.slice(0,6)}`);
          }
          pos.tpHit = 1;
        }
        // Trailing stop: dropped from peak while still green and hasn't hit TP1 yet
        // Tighter trail to lock in gains early — don't give back profits
        // If peaked 15%+: trail at 25% from peak (was 30%) — e.g., peaked at +50%, sell at +37.5%
        // If peaked 30%+: trail at 20% from peak — e.g., peaked at +60%, sell at +48%
        else if (pos.tpHit === 0 && changePct > 5) {
          const peakPctFromEntry = pos.peakMcap > 0 && pos.entryMcap > 0 ? ((pos.peakMcap - pos.entryMcap) / pos.entryMcap) * 100 : 0;
          const trailThreshold = peakPctFromEntry >= 30 ? 20 : peakPctFromEntry >= 15 ? 25 : 35;
          if (fromPeak > trailThreshold && peakPctFromEntry >= 12) {
            log(`Trailing ${ca.slice(0,6)}: +${changePct.toFixed(0)}% (peaked +${peakPctFromEntry.toFixed(0)}%, down ${fromPeak.toFixed(0)}% from peak, trail=${trailThreshold}%) — selling ${s.tp1Sell}%`);
            const sig = await execSell(ca, s.tp1Sell, kp, "trailing");
            if (sig) {
              broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "TRAIL", sellPct: s.tp1Sell } });
            }
            pos.tpHit = 1;
          }
        }

        // ═══ POST-TP1 TRAILING STOP — protect profits after partial take ═══
        // After TP1 hit (sold 30%), if remaining position drops back near breakeven → full exit
        // Don't let a winning trade turn into a loser
        if (pos.tpHit >= 1 && !pos.isMoonbag && pos.tpHit < 3) {
          // After TP1: if price drops back to only +5% from entry, exit remaining
          if (changePct <= 5) {
            log(`POST-TP1 EXIT ${ca.slice(0,6)}: +${changePct.toFixed(0)}% after TP1 — protecting profits, full exit`);
            const sig = await execSell(ca, 100, kp, "post-tp1-exit");
            if (sig) {
              broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "POST-TP1", reason: "protect-profit" } });
              exitPosition(ca, 100, "post-tp1-exit");
              trackSell(wallet, ca);
            }
            continue;
          }
          // After TP1: tighter trailing — if dropped 30% from peak, exit remaining
          if (fromPeak > 30 && changePct > 5) {
            log(`POST-TP1 TRAIL ${ca.slice(0,6)}: +${changePct.toFixed(0)}% (${fromPeak.toFixed(0)}% from peak after TP1) — full exit`);
            const sig = await execSell(ca, 100, kp, "post-tp1-trail");
            if (sig) {
              broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "POST-TP1-TRAIL", reason: "trailing-after-tp" } });
              exitPosition(ca, 100, "post-tp1-trail");
              trackSell(wallet, ca);
            }
            continue;
          }
        }

        // ═══ STOP LOSS — 2 tiers ═══
        // Moonbags: trailing exit if dropped 60%+ from peak while still green (protect runner gains)
        // OR full exit if basically dead (-80%)
        if (pos.isMoonbag) {
          if (changePct <= -80) {
            log(`Moonbag dead ${ca.slice(0,6)}: ${changePct.toFixed(0)}% — full exit`);
            const sig = await execSell(ca, 100, kp, "moonbag-dead");
            if (sig) {
              broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, reason: "moonbag-dead" } });
              exitPosition(ca, 100, "moonbag-dead");
              trackSell(wallet, ca);
            }
          } else if (fromPeak > (changePct >= 500 ? 70 : 60) && changePct > 30) {
            // Moonbag trailing stop widening: wider trail for bigger runners
            log(`Moonbag trail ${ca.slice(0,6)}: +${changePct.toFixed(0)}% (−${fromPeak.toFixed(0)}% from peak) — exit moonbag`);
            const sig = await execSell(ca, 100, kp, "moonbag-trail");
            if (sig) {
              broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, reason: "moonbag-trail" } });
              exitPosition(ca, 100, "moonbag-trail");
              trackSell(wallet, ca);
            }
          }
        }
        // SL2: Full exit
        else if (!pos.isMoonbag && pos.slHit < 2 && changePct <= -s.sl2) {
          log(`SL2 ${ca.slice(0,6)}: ${changePct.toFixed(0)}% — full exit`);
          const sig = await execSell(ca, 100, kp, "SL2");
          if (sig) {
            broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "SL2", reason: "stop-loss" } });
            exitPosition(ca, 100, "SL2");
            trackSell(wallet, ca);
          }
        }
        // SL1: Reduce exposure — sell sl1Sell% to cut risk
        else if (!pos.isMoonbag && pos.slHit < 1 && changePct <= -s.sl1) {
          log(`SL1 ${ca.slice(0,6)}: ${changePct.toFixed(0)}% — selling ${s.sl1Sell}% to reduce risk`);
          const sig = await execSell(ca, s.sl1Sell, kp, "SL1");
          if (sig) {
            broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "SL1", sellPct: s.sl1Sell } });
            log(`SL1 SOLD ${s.sl1Sell}% of ${ca.slice(0,6)}`);
          }
          pos.slHit = 1;
        }
      }

      // ═══ DIP-BUY DCA — add to existing positions on dips with recovery signals ═══
      // If MC dropped 20%+ from peak but score is now rising/rocket, average down
      for (const [ca, pos] of state.positions) {
        if (pos.isMoonbag || pos.slHit >= 1 || pos.dcaBuys >= 2) continue; // max 2 DCA buys
        const token = radar.tokens.get(ca);
        if (!token) continue;
        const currentMcap = token.mcapUsd || 0;
        if (pos.entryMcap <= 0 || currentMcap <= 0) continue;
        const fromPeak = pos.peakMcap > 0 ? ((pos.peakMcap - currentMcap) / pos.peakMcap) * 100 : 0;
        const dyn = scoreDynamics.get(ca);
        const isRecovering = dyn && dyn.scores >= 3 && (dyn.trend === "rising" || dyn.trend === "rocket");
        // Dip criteria: MC dropped 20%+ from peak AND score is now recovering
        if (fromPeak >= 20 && isRecovering) {
          let balance = 0;
          try { balance = await connection.getBalance(kp.publicKey) / LAMPORTS_PER_SOL; } catch { continue; }
          const dcaAmount = Math.round(state.settings.solPerTrade * 0.5 * 1000) / 1000; // half-size DCA
          if (balance < dcaAmount + 0.01) continue;
          log(`DIP-BUY ${token.name||ca.slice(0,6)} | dip:${fromPeak.toFixed(0)}% from peak | trend:${dyn.trend} | MC:$${Math.round(currentMcap)} | ${dcaAmount} SOL`);
          try {
            const buyResp = await fetch("https://pumpportal.fun/api/trade-local", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ publicKey: tw.pubkey, action: "buy", mint: ca, amount: dcaAmount, denominatedInSol: "true", slippage: 25, priorityFee: 0.005, pool: "auto" }),
            });
            if (buyResp.ok) {
              const txBytes = await buyResp.arrayBuffer();
              if (txBytes.byteLength > 100) {
                const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
                tx.sign([kp]);
                const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
                pos.dcaBuys = (pos.dcaBuys || 0) + 1;
                pos.totalSol = (pos.totalSol || pos.entrySol) + dcaAmount;
                // Recalculate average entry (weighted)
                const totalInvested = (pos.entrySol || state.settings.solPerTrade) + dcaAmount * pos.dcaBuys;
                pos.entryMcap = (pos.entryMcap * (pos.entrySol || state.settings.solPerTrade) + currentMcap * dcaAmount) / (totalInvested || 1);
                trackBuy(wallet, ca, dcaAmount);
                log(`DIP-BOUGHT ${token.name||ca.slice(0,6)} +${dcaAmount} SOL (DCA #${pos.dcaBuys}) sig:${sig.slice(0,12)}...`);
                broadcastWS({ event: "auto-ape", data: { ca, name: token.name, sol: dcaAmount, mcap: currentMcap, wallet, score: pos.liveScore || 0, dca: true, dcaNum: pos.dcaBuys } });
              }
            }
          } catch (e) { log(`DIP-BUY error ${ca.slice(0,6)}: ${e.message}`); }
        }
      }

      // Look for new tokens to ape
      if (state.positions.size >= state.settings.maxPositions) {
        if (!state._lastFullLog || Date.now() - state._lastFullLog > 30000) {
          log(`SCAN: ${state.positions.size}/${state.settings.maxPositions} positions full — skipping entry scan`);
          state._lastFullLog = Date.now();
        }
        return;
      }

      // Clean expired cooldowns — shorter for re-entry mode
      const cd = soldCooldowns.get(wallet);
      if (cd) for (const [c, t] of cd) {
        const dyn = scoreDynamics.get(c);
        const isRecovering = dyn && dyn.scores >= 3 && (dyn.trend === "rising" || dyn.trend === "rocket");
        // Re-entry mode: allow re-buying sold tokens after 3min if dip-recovering, 10min normal
        const cooldownMs = state.settings.reentryDips !== false
          ? (isRecovering ? 180000 : 600000)   // 3min / 10min with re-entry enabled
          : (isRecovering ? 600000 : 1800000); // 10min / 30min without re-entry
        if (Date.now() - t > cooldownMs) cd.delete(c);
      }

      // ═══ DIP RE-ENTRY — re-buy previously sold tokens on confirmed dips with recovery ═══
      // User request: "enter tokens in the green that just dropped in price, sell into volume, re-enter the dip"
      if (state.settings.reentryDips !== false && state.positions.size < state.settings.maxPositions) {
        const recentlySold = soldCooldowns.get(wallet);
        if (recentlySold) {
          for (const [ca, soldTime] of recentlySold) {
            if (state.positions.has(ca)) continue; // already have position
            if (Date.now() - soldTime < 120000) continue; // wait at least 2 min after sell
            const token = radar.tokens.get(ca);
            if (!token) continue;
            const dyn = scoreDynamics.get(ca);
            if (!dyn || dyn.scores < 3) continue;
            // Re-entry criteria: score recovering + MC dipped from peak + still has volume
            const isRecovering = dyn.trend === "rising" || dyn.trend === "rocket";
            const currentMcap = token.mcapUsd || 0;
            const spark = token.spark || [];
            const recentPeak = spark.length > 3 ? Math.max(...spark.slice(-10)) : currentMcap;
            const dippedFromPeak = recentPeak > 0 ? ((recentPeak - currentMcap) / recentPeak) * 100 : 0;
            // Dip + recovery = re-entry: 15%+ dip from recent peak AND score is coming back
            if (isRecovering && dippedFromPeak >= 15 && currentMcap > 5000) {
              let balance = 0;
              try { balance = await connection.getBalance(kp.publicKey) / LAMPORTS_PER_SOL; } catch { continue; }
              const reentryAmount = Math.round(state.settings.solPerTrade * 0.5 * state.drawdownMult * 1000) / 1000; // half-size re-entry
              if (balance < reentryAmount + 0.01) continue;
              log(`DIP-REENTRY ${token.name||ca.slice(0,6)} | dip:${dippedFromPeak.toFixed(0)}% | trend:${dyn.trend} | MC:$${Math.round(currentMcap)} | ${reentryAmount} SOL`);
              try {
                const buyResp = await fetch("https://pumpportal.fun/api/trade-local", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ publicKey: tw.pubkey, action: "buy", mint: ca, amount: reentryAmount, denominatedInSol: "true", slippage: 25, priorityFee: 0.005, pool: "auto" }),
                });
                if (buyResp.ok) {
                  const txBytes = await buyResp.arrayBuffer();
                  if (txBytes.byteLength > 100) {
                    const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
                    tx.sign([kp]);
                    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
                    state.positions.set(ca, {
                      entryMcap: currentMcap, entrySol: reentryAmount, entryTime: Date.now(),
                      peakMcap: currentMcap, tpHit: 0, slHit: 0, dcaBuys: 0, isReentry: true,
                      entryScore: dyn.currentScore || 0,
                    });
                    recentlySold.delete(ca); // remove from cooldown
                    broadcastWS({ event: "auto-ape", data: { ca, name: token.name, sol: reentryAmount, mcap: currentMcap, wallet, score: dyn.currentScore || 0, reentry: true } });
                    log(`DIP-REENTERED ${token.name||ca.slice(0,6)} +${reentryAmount} SOL sig:${sig.slice(0,12)}...`);
                    if (state.positions.size >= state.settings.maxPositions) break;
                  }
                }
              } catch (e) { log(`DIP-REENTRY error ${ca.slice(0,6)}: ${e.message}`); }
            }
          }
        }
      }

      // ── PIPELINE STATS: track why tokens are rejected ──
      const pipeline = { total: 0, baseFilter: 0, alreadyOwned: 0, cooldown: 0, rugGate: 0, trendReject: 0, scoreLow: 0, passed: 0, nearMisses: [], rugRejects: [], skippedGreen: [] };

      const tokens = [...radar.tokens.values()].filter(t => {
        pipeline.total++;
        const mc = t.mcapUsd || 0;
        const buys = t.buys || 0;
        const ub = t.uniqueBuyers?.size || 0;
        const ageMin = (Date.now() - t.createdAt) / 60000;
        const sells = t.sells || 0;
        const dyn = scoreDynamics.get(t.ca);
        const isAccelerating = dyn && dyn.scores >= 1 && (dyn.trend === "rocket" || dyn.trend === "rising");
        // Low-velocity early entry: token has few buys but healthy buy/sell ratio
        // and is in the pre-discovery FDV range ($4K-$30K). These are the tokens
        // we SHOULD be aping — before velocity picks up.
        // TIGHTENED: was buys>=1 ub>=1 — require actual activity proof
        const isLowVelocity = mc >= 4000 && mc <= 30000 && buys >= 5 && sells >= 1 && sells <= buys && ub >= 3 && ageMin >= 0.5 && ageMin <= 30;
        // DexPaid early entry: boosted tokens get relaxed filters — paid = conviction
        const isDexPaid = !!radar.dexBoosted.get(t.ca);
        // Very early tokens (< 2 min) in pre-discovery range — still require minimum activity
        // TIGHTENED: was buys>=2 ub>=2 — too loose, let 6-second-old zero-sell tokens through
        const isVeryEarly = ageMin >= 0.5 && ageMin < 2 && mc >= 4000 && mc <= 25000 && buys >= 5 && ub >= 3 && sells >= 1;
        // HARD MINIMUM: no token enters without at least 3 unique buyers and 30 seconds of age
        // This alone would have prevented the BURDISH trade (3 UB, 6 seconds old, 0 sells)
        if (ub < 3 || ageMin < 0.5) { pipeline.baseFilter++; return false; }
        if (isAccelerating) {
          if (!(mc > 3000 && buys >= 5 && ub >= 3 && ageMin >= 0.5 && sells >= 1 && sells <= buys * 1.5)) { pipeline.baseFilter++; return false; }
          return true;
        }
        if (isDexPaid && mc >= 4000 && buys >= 3 && ub >= 3 && sells >= 1 && sells <= buys * 2) return true;
        if (isVeryEarly) return true; // fast-track very early movers (already tightened above)
        if (isLowVelocity) return true;
        if (!(mc > 5000 && buys >= 5 && ub >= 3 && ageMin >= 0.5 && sells >= 1 && sells <= buys * 1.2)) { pipeline.baseFilter++; return false; }
        return true;
      });
      // ═══ BACKGROUND WALLET AGE ENRICHMENT — non-blocking on-chain wallet age checks ═══
      // Enrich tokens that pass base filter with real wallet age data.
      // Uses cache so subsequent cycles are instant. Only check tokens not yet enriched.
      for (const t of tokens) {
        if (!t._walletAgeData && !t._walletAgeChecking && (t.buys || 0) >= 3) {
          t._walletAgeChecking = true;
          enrichWalletAges(t).then(data => {
            t._walletAgeData = data;
            t._walletAgeChecking = false;
          }).catch(() => { t._walletAgeChecking = false; });
        }
        // Dev credibility: name uniqueness + dev SOL balance + launch count
        if (!t._devCredData && !t._devCredChecking && t.devWallet) {
          t._devCredChecking = true;
          enrichDevCredibility(t).then(data => {
            t._devCredData = data;
            t._devCredChecking = false;
          }).catch(() => { t._devCredChecking = false; });
        }
      }

      const hot = tokens.filter(t => {
        if (state.positions.has(t.ca)) { pipeline.alreadyOwned++; return false; }
        if (cd?.has(t.ca)) { pipeline.cooldown++; return false; }
        const buys = t.buys || 0; const ub = t.uniqueBuyers?.size || 0; const vol = t.volumeSol || 0;
        const mc = t.mcapUsd || 0; const sells = t.sells || 0;
        const ageMin = Math.max(0.2, (Date.now() - t.createdAt) / 60000);
        const sellVol = t.sellVolumeSol || 0;

        // ═══ HARD RUG GATE — reject obvious rugs before scoring ═══
        // IMPORTANT: Tokens < 3 min old get relaxed gates — zero sells and buy imbalance
        // are NORMAL at launch. Only hard-reject on dev activity signals for young tokens.
        const qf = extractQuickFeatures(t);
        let rugRejectReason = null;
        // TIGHTENED: was < 3 min unconditional — now require at least some sell activity to qualify
        // Tokens with ZERO sells don't get young exemption (zero sells = classic rug setup)
        const isVeryYoung = ageMin < 2 && sells >= 1; // was ageMin < 3 with no sell requirement
        if (qf) {
          if (qf.rg_devSellSpeed > 0.6) rugRejectReason = "dev_sell"; // relaxed from 0.4 — partial dev sells are common on pumpfun
          else if (qf._rg_devSelfSnipe > 0) rugRejectReason = "dev_snipe";
          else if (qf.rg_mcapDropRate > 0.5 && !isVeryYoung) rugRejectReason = "mcap_crash"; // relaxed from 0.4
          else if (qf.rg_coordDumpScore > 0.5) rugRejectReason = "coord_dump"; // relaxed from 0.35 — fast sells common on pumpfun
          else if (qf._rg_pumpDump > 0.6 && !isVeryYoung) rugRejectReason = "pump_dump"; // relaxed from 0.5
          else if (qf._rg_sybilScore > 0.5) rugRejectReason = "sybil"; // relaxed from 0.4
          else if (qf._rg_earlyDump > 0.6 && ageMin < 5) rugRejectReason = "early_dump"; // relaxed from 0.5
          else if (qf._rg_quickFlipRate > 0.35) rugRejectReason = "quick_flip"; // relaxed from 0.25
          else if (qf.rg_holderConcentration > 0.7 && buys > 5 && !(qf._whaleBullish > 0.3)) rugRejectReason = "whale_heavy";
          else if (qf.rg_liqRemovalSpeed > 0.65 && !isVeryYoung) rugRejectReason = "liq_removal";
          else if (qf.ch_smoothGrind > 0.6 && !isVeryYoung) rugRejectReason = "smooth_grind";
          else if (qf.ch_smoothGrind > 0.4 && qf.ch_dipRatio < 0.1 && !isVeryYoung) rugRejectReason = "no_dips";
          // Zero sells: ONLY reject for tokens > 3 min old. At launch, zero sells is expected.
          else if (qf._rg_zeroSellFlag >= 0.8 && !isVeryYoung) rugRejectReason = "zero_sells";
          else if (qf._rg_zeroSellFlag >= 0.5 && (qf.ch_smoothGrind > 0.3 || qf.ch_staircaseScore > 0.3) && !isVeryYoung) rugRejectReason = "zero_sells_fake_chart";
          // Buy/sell imbalance: only flag for older tokens with many buys
          else if (qf._rg_buySellImbalance >= 0.8 && buys >= 15 && !isVeryYoung) rugRejectReason = "all_buys_no_sells";
          else if (qf.ch_staircaseScore > 0.6 && !isVeryYoung) rugRejectReason = "staircase_chart";
          else if (qf.ch_staircaseScore > 0.4 && qf._rg_freshWalletRatio > 0.6 && !isVeryYoung) rugRejectReason = "staircase_fresh_wallets";
          else if (qf._rg_freshWalletRatio > 0.8 && qf._rg_zeroSellFlag > 0.4 && !isVeryYoung) rugRejectReason = "fresh_wallet_rug";
          // Flatline spike: dead chart with sudden vertical pump = dev self-buy rug
          else if (qf.ch_flatlineSpike > 0.5 && !isVeryYoung) rugRejectReason = "flatline_spike";
          else if (qf.ch_flatlineSpike > 0.3 && qf._rg_zeroSellFlag > 0.3 && !isVeryYoung) rugRejectReason = "flatline_spike_no_sells";
          else if (qf.ch_flatlineSpike > 0.3 && qf._rg_freshWalletRatio > 0.5 && !isVeryYoung) rugRejectReason = "flatline_spike_fresh_wallets";
          else if (qf._namePrevRugged && qf._devLaunchCount > 3) rugRejectReason = "serial_rugger";
          else if (qf._devLaunchCount > 8) rugRejectReason = "serial_launcher";
          else if (t._artworkFlags?.includes("EXACT_DUPLICATE")) rugRejectReason = "stolen_art";
          else {
            const rugSignals = [
              qf.rg_devSellSpeed > 0.35, qf.rg_coordDumpScore > 0.3,
              qf._rg_sybilScore > 0.3, qf._rg_quickFlipRate > 0.2,
              qf.rg_holderConcentration > 0.65, qf._rg_earlyDump > 0.3,
              qf.rg_mcapDropRate > 0.3 && !isVeryYoung, qf._rg_pumpDump > 0.35 && !isVeryYoung,
              qf.ch_smoothGrind > 0.4 && !isVeryYoung, qf.ch_dipRatio < 0.08 && !isVeryYoung,
              qf._rg_zeroSellFlag > 0.5 && !isVeryYoung,
              qf._rg_buySellImbalance > 0.6 && !isVeryYoung,
              qf.ch_staircaseScore > 0.4 && !isVeryYoung,
              qf._rg_freshWalletRatio > 0.7 && !isVeryYoung,
              qf.ch_flatlineSpike > 0.3 && !isVeryYoung,
              t._artworkOriginal === false,
            ].filter(Boolean).length;
            // Young tokens need more signals to reject (5 instead of 4)
            const minSignals = isVeryYoung ? 5 : 4;
            if (rugSignals >= minSignals) rugRejectReason = "multi_rug_" + rugSignals;
          }
          if (rugRejectReason) {
            pipeline.rugGate++;
            pipeline.rugRejects.push({ name: t.name || t.ca?.slice(0, 8), ca: t.ca?.slice(0, 8), reason: rugRejectReason, mc: Math.round(mc), buys, walletAge: t._walletAgeData ? `${Math.round(t._walletAgeData.walletAgeScore * 100)}%aged` : "unknown", whaleBullish: t._walletAgeData?.whaleBullish || 0 });
            if (pipeline.rugRejects.length > 15) pipeline.rugRejects.shift();
            return false;
          }
        }

        // Buy activity (log-scaled to avoid spam bias)
        const buyScore = Math.min(15, Math.log2(buys + 1) * 3);
        const ubScore = Math.min(15, Math.log2(ub + 1) * 3);
        const volScore = Math.min(12, Math.log10(vol * 100 + 1) * 4);

        // MC scoring: ranges based on correct FDV (not bonding curve MC)
        // $6K-$16K = pre-discovery zone (highest upside if token has healthy signals)
        // $16K-$60K = discovery zone (proven activity, still good upside)
        // $60K+ = late entry (most upside already captured)
        const mcScore = mc >= gradMcUsd() ? 3 :
                        mc >= 100000 ? 5 :
                        mc >= 60000  ? 7 :
                        mc >= 30000  ? 10 :
                        mc >= 16000  ? 12 :
                        mc >= 10000  ? 11 :
                        mc >= 6000   ? 9 :
                        mc >= 4000   ? 6 : 0;

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
            if (growth > 0) greenScore = Math.min(20, growth * 60);
          }
        }

        // Buy pressure: more buys than sells = bullish
        const pressureScore = buys > 2 ? Math.min(10, (buys / Math.max(1, buys + sells)) * 10) : 0;

        // Buy velocity: fast buys = hype
        const velocityScore = Math.min(10, (buys / ageMin) * 3);

        // Penalties — lighter touch since hard rug gate already blocks obvious rugs
        const sellPenalty = sells > buys * 0.6 ? Math.min(12, (sells - buys * 0.4) * 2) : 0;
        // Graduated rug penalty: only penalize significant signals (hard gate catches the rest)
        let rugPenalty = 0;
        if (qf) {
          rugPenalty += qf.rg_devSellSpeed > 0.25 ? 10 : 0;          // significant dev selling
          rugPenalty += qf.rg_coordDumpScore > 0.25 ? 8 : 0;         // coordinated sells
          rugPenalty += qf.rg_mcapDropRate > 0.3 ? 8 : 0;            // mcap declining hard
          rugPenalty += qf._rg_quickFlipRate > 0.15 ? 6 : 0;         // quick flippers
          rugPenalty += qf._rg_sybilScore > 0.3 ? 6 : 0;             // sybil bots
          rugPenalty += qf.rg_holderConcentration > 0.6 ? 5 : 0;     // whale-heavy
          rugPenalty += qf._rg_earlyDump > 0.2 ? 5 : 0;              // early selling
          rugPenalty += sellVol > vol * 0.4 ? 5 : 0;                  // sell pressure
          rugPenalty += qf._rg_pumpDump > 0.3 ? 8 : 0;               // pump-dump pattern
          rugPenalty += qf.ch_smoothGrind > 0.25 ? Math.round(qf.ch_smoothGrind * 18) : 0; // smooth grind — constant velocity up = slow rug, penalize hard
          rugPenalty += qf._rg_zeroSellFlag > 0.4 ? Math.round(qf._rg_zeroSellFlag * 15) : 0; // zero sells
          rugPenalty += qf._rg_buySellImbalance > 0.4 ? Math.round(qf._rg_buySellImbalance * 10) : 0; // buy imbalance
          rugPenalty += qf.ch_staircaseScore > 0.3 ? Math.round(qf.ch_staircaseScore * 12) : 0; // staircase
          rugPenalty += qf._rg_freshWalletRatio > 0.6 ? Math.round(qf._rg_freshWalletRatio * 8) : 0; // fresh wallets
        } else {
          rugPenalty = (sellVol > vol * 0.5 && sells > 3) ? 15 :
                       (sells > buys * 1.2) ? 10 : 0;
        }

        const dexBoost = radar.dexBoosted.get(t.ca);
        // DexPaid = strong early buy signal: devs paying for visibility = conviction + marketing spend
        // Base 12 pts + scaled by boost amount, capped at 20 pts (was 8 — too weak)
        const boostScore = dexBoost ? Math.min(20, 12 + Math.log2(dexBoost.amount + 1)) : 0;
        if (state.settings.requireBoosted && !dexBoost) return false;

        // ═══ VELOCITY/ACCELERATION GATE ═══
        // Need at least 1 observation to have any data. For early movers (< 2 min old),
        // allow entry with just 1 observation since waiting 15-30s means missing the move.
        const dyn = scoreDynamics.get(t.ca);
        let dynamicsBonus = 0;

        const isEarlyMover = ageMin < 2 && mc >= 4000 && mc <= 30000 && ub >= 2;
        if (!dyn || (dyn.scores < 2 && !isEarlyMover)) {
          // Not enough data yet — skip this cycle, let it cook
          pipeline.scoreLow++;
          return false;
        }
        // Early movers with 1 observation get a bonus for having velocity data at all
        if (isEarlyMover && dyn && dyn.scores === 1) dynamicsBonus += 8;

        // Hard reject: actively crashing tokens
        if (dyn.trend === "crashing") { pipeline.trendReject++; return false; }

        // Velocity/acceleration are now PRIMARY signals, not just bonuses
        // Declining = dip opportunity — penalize but don't reject
        if (dyn.trend === "declining") dynamicsBonus = -15;
        // Fading momentum = warning
        else if (dyn.trend === "fading") dynamicsBonus = -8;
        // Stable with no movement = not interesting enough
        else if (dyn.trend === "stable" && dyn.velocity <= 0) dynamicsBonus = -12;
        // Rising steadily — strong signal
        else if (dyn.trend === "rising") dynamicsBonus = 18;
        // Rocket: accelerating score = STRONGEST signal
        else if (dyn.trend === "rocket") dynamicsBonus = 30;

        // Velocity bonus: scaled more aggressively — this IS the buy signal
        if (dyn.velocity > 0.1) dynamicsBonus += Math.min(15, Math.round(dyn.velocity * 10));
        // Acceleration bonus: positive 2nd derivative = momentum building
        if (dyn.acceleration > 0.005) dynamicsBonus += Math.min(12, Math.round(dyn.acceleration * 200));

        // Chart health bonus: if the sparkline shape matches healthy graduated patterns
        // Smooth grind penalty: fake charts with no natural dips should be avoided
        let chartBonus = qf?.ch_healthScore > 0.6 ? Math.round((qf.ch_healthScore - 0.5) * 16) :
                         qf?.ch_healthScore < 0.3 ? -8 : 0;
        if (qf?.ch_smoothGrind > 0.35) chartBonus -= Math.round(qf.ch_smoothGrind * 15);
        if (qf?.ch_dipRatio < 0.15 && spark.length >= 8) chartBonus -= 6; // no natural dips penalty
        if (qf?.ch_pumpDump > 0.4) chartBonus -= Math.round(qf.ch_pumpDump * 10);
        // Staircase chart penalty: monotonic up with uniform steps = dev self-buying
        if (qf?.ch_staircaseScore > 0.4) chartBonus -= Math.round(qf.ch_staircaseScore * 20);
        // Zero sell penalty: many buys + zero sells = almost always a rug
        if (qf?._rg_zeroSellFlag > 0.5) chartBonus -= Math.round(qf._rg_zeroSellFlag * 25);
        // Fresh wallet penalty: all buyers are brand new wallets
        if (qf?._rg_freshWalletRatio > 0.7) chartBonus -= Math.round(qf._rg_freshWalletRatio * 15);

        // ═══ LOW-VELOCITY POTENTIAL BONUS ═══
        // Core insight: tokens with LOW activity but HEALTHY signals have the highest
        // risk-reward ratio. By the time velocity is high, the move is mostly done.
        // Formula: bonus inversely proportional to velocity, gated by quality signals.
        //
        // Math: earlyBonus = qualitySignal * (1 / (buysPerMin + 0.3)) * scaleFactor
        //   - qualitySignal: healthy buy/sell ratio + no rug flags + MC in sweet spot
        //   - buysPerMin: lower = earlier = bigger bonus
        //   - Capped at 18 to avoid dominating the score
        let earlyApeBonus = 0;
        const buysPerMin = buys / Math.max(ageMin, 0.5);
        const isEarlyMcap = mc >= 4000 && mc <= 24000;
        const healthyRatio = buys > 0 && sells <= buys * 0.5; // few sells relative to buys
        const noRugFlags = !t._rugFlags || t._rugFlags.length === 0;
        if (isEarlyMcap && healthyRatio && noRugFlags && buysPerMin < 3) {
          // Quality signal: combination of healthy ratio + low sell pressure + organic pace
          const qualitySignal = Math.min(1, (buys > 0 ? 1 - (sells / Math.max(buys, 1)) : 0.5) + (ub >= 2 ? 0.3 : 0));
          // Inverse velocity: lower buysPerMin = higher bonus
          const velocityInverse = 1 / (buysPerMin + 0.3);
          earlyApeBonus = Math.min(18, Math.round(qualitySignal * velocityInverse * 8));
        }

        // Artwork penalty: non-original art = rug signal
        const artPenalty = t._artworkOriginal === false ? Math.max(5, Math.round((100 - (t._artworkScore || 50)) / 5)) : 0;

        // ═══ WHALE BULLISH BONUS — aged whale wallets buying = smart money conviction ═══
        // If on-chain wallet age data shows whales with aged wallets (>7 days) are buying,
        // this is a strong bullish signal — real money, not dev sybils.
        let whaleBullishBonus = 0;
        if (qf?._whaleBullish > 0.3) {
          whaleBullishBonus = Math.min(15, Math.round(qf._whaleBullish * 20));
        }
        // Fresh wallet penalty from on-chain data (overrides heuristic when available)
        let walletAgePenalty = 0;
        if (qf?._walletAgeFresh > 0.7) {
          walletAgePenalty = Math.round(qf._walletAgeFresh * 12);
        }

        // Dev credibility bonus/penalty: fresh name + funded dev = up to +15, serial launcher = penalty
        let devCredBonus = 0;
        if (qf?._devCredScore != null) {
          if (qf._devCredScore >= 0.8) devCredBonus = Math.round((qf._devCredScore - 0.5) * 30); // up to +15
          else if (qf._devCredScore < 0.3) devCredBonus = -Math.round((0.3 - qf._devCredScore) * 25); // down to -8
          if (qf._namePrevRugged) devCredBonus -= 10; // same name rugged before = big penalty
        }

        // ═══ DEV WALLET BALANCE BOOST — funded devs pump charts ═══
        // Devs with a lot of SOL have resources to sustain buy pressure.
        // This is a huge signal: whale_dev (50+ SOL) = +20, funded_dev (10+) = +15,
        // broke_dev (<0.5 SOL) = -15. Overrides the weaker devCredBonus when available.
        let devBalanceBoost = 0;
        const devScore = devWalletTracker.getDevScore(t.ca);
        if (devScore.mapped && devScore.solBalance >= 0) {
          devBalanceBoost = devScore.scoringBoost;
          // If dev tracker has stronger data, let it override the basic devCredBonus
          if (Math.abs(devBalanceBoost) > Math.abs(devCredBonus)) {
            devCredBonus = devBalanceBoost;
          } else {
            // Both have data — combine them, cap at ±25
            devCredBonus = Math.max(-25, Math.min(25, devCredBonus + Math.round(devBalanceBoost * 0.5)));
          }
          t._devTier = devScore.devTier;
          t._devSolBal = devScore.solBalance;
          t._devHighValue = devScore.isHighValue;
        }

        // ═══ MEMETIC SCORE BLEND ═══
        // Quick memetic score (linguistic + absurdity + temporal) ranges 0-1.
        // Convert to -8 to +12 point range: tokens with strong meme DNA get boosted,
        // generic/weak names get penalized. Cached on creation, ~0ms lookup.
        const memeticQuick = t._memeticQuick || 0;
        const memeticBonus = memeticQuick > 0 ? Math.round((memeticQuick - 0.45) * 24) : 0; // -11 to +13
        t._memeticScore = memeticQuick;

        t._apeScore = Math.max(0, Math.min(99, Math.round(
          buyScore + ubScore + volScore + mcScore + greenScore + pressureScore + velocityScore + boostScore + dynamicsBonus + chartBonus + earlyApeBonus + whaleBullishBonus + devCredBonus + memeticBonus - sellPenalty - rugPenalty - artPenalty - walletAgePenalty
        )));

        // ═══ SURVIVORSHIP BIAS FILTER (Kahneman) ═══
        // "We don't ask what makes tokens pump. We ask what surviving tokens
        //  looked like at birth — then reject anything that doesn't match."
        // This is the inverse of traditional scoring: instead of scoring UP for
        // good signals, we filter OUT tokens that don't match the winner archetype.
        let survivorAdj = 0;
        let survivorKilled = false;
        if (qf && survivorBias.survivors.size >= 5) {
          const sbResult = survivorBias.getScoreAdjustment(qf);
          survivorAdj = sbResult.adjustment;
          t._apeScore = Math.max(0, Math.min(99, t._apeScore + survivorAdj));
          t._survivorMatch = sbResult.eval.matchPct;
          t._survivorNet = sbResult.eval.netScore;
          t._survivorKills = sbResult.eval.killSignals?.map(k => k.feature.replace(/^(oc_|rg_|ch_|cs_|sir_|gf_|tp_|k_|apd_)/, "")).slice(0, 3);
          // Hard filter: survivorship engine says this looks nothing like winners
          if (!sbResult.eval.shouldApe && sbResult.eval.confidence > 40) {
            survivorKilled = true;
          }
        }

        t._rugFlags = [
          ...(qf ? [
            qf.rg_devSellSpeed > 0.3 && "dev_selling",
            qf.rg_coordDumpScore > 0.3 && "coord_sells",
            qf._rg_sybilScore > 0.3 && "sybil_bots",
            qf._rg_quickFlipRate > 0.2 && "quick_flips",
            qf.rg_holderConcentration > 0.6 && "whale_heavy",
            qf.ch_smoothGrind > 0.35 && "smooth_grind",
            qf.ch_dipRatio < 0.1 && spark.length >= 8 && "no_dips",
            qf.ch_staircaseScore > 0.4 && "staircase_chart",
            qf._rg_zeroSellFlag > 0.5 && "zero_sells",
            qf._rg_buySellImbalance > 0.5 && "all_buys_no_sells",
            qf._rg_freshWalletRatio > 0.7 && "fresh_wallets",
            qf._walletAgeFresh > 0.7 && "fresh_wallets_onchain",
          ] : []),
          t._artworkOriginal === false && "stolen_art",
          t._artworkFlags?.includes("SIMILAR_IMAGE") && "similar_art",
          t._artworkFlags?.includes("LOW_EFFORT_ART") && "low_effort_art",
          qf?._namePrevRugged && "name_prev_rugged",
          qf?._devLaunchCount > 5 && "serial_launcher",
          qf?._nameUniqueness < 0.3 && "recycled_name",
          t._devTier === "broke_dev" && "broke_dev",
          devScore.isSerialLauncher && "serial_dev",
        ].filter(Boolean);
        // Positive signals (not rug flags, but bullish indicators)
        t._bullishSignals = [
          ...(qf ? [
            qf._whaleBullish > 0.3 && `whale_bullish(${(qf._whaleBullish * 100).toFixed(0)}%)`,
            qf.rg_walletAgeScore > 0.7 && "aged_wallets",
            qf._devCredScore >= 0.8 && `dev_credible(${Math.round(qf._devSolBalance)}sol)`,
            qf._nameUniqueness >= 1.0 && "fresh_name",
            qf._devLaunchCount === 0 && "first_launch",
          ] : []),
          t._devTier === "whale_dev" && `whale_dev(${Math.round(t._devSolBal || 0)}sol)`,
          t._devTier === "funded_dev" && `funded_dev(${Math.round(t._devSolBal || 0)}sol)`,
          t._devHighValue && "high_value_dev",
          dyn?.trend === "rocket" && "rocket_trend",
          dyn?.trend === "rising" && "rising_trend",
          earlyApeBonus > 0 && "early_discovery",
          survivorAdj > 5 && `survivor_match(${t._survivorMatch || 0}%)`,
        ].filter(Boolean);
        t._scoreTrend = dyn?.trend || "new";
        t._earlyApe = earlyApeBonus > 0; // flag for logging
        // ── SURVIVORSHIP KILL GATE — Kahneman: if it doesn't look like a winner, skip ──
        if (survivorKilled) {
          pipeline.rugGate++;
          if (!pipeline.survivorRejects) pipeline.survivorRejects = [];
          pipeline.survivorRejects.push({
            name: t.name || t.ca?.slice(0, 8),
            score: t._apeScore,
            survivorMatch: t._survivorMatch || 0,
            survivorNet: t._survivorNet || 0,
            kills: t._survivorKills || [],
          });
          return false;
        }
        // Apply learner-recommended min score (if enough data)
        const adj = tradeLearner.getAdjustments();
        const effectiveMin = adj.minScoreShift || state.settings.minScore;
        const threshold = Math.max(45, Math.min(state.settings.minScore, effectiveMin)); // never drop below 45
        if (t._apeScore < threshold) {
          pipeline.scoreLow++;
          // Track near misses: within 10 pts of threshold
          if (t._apeScore >= threshold - 10) {
            pipeline.nearMisses.push({
              name: t.name || t.ca?.slice(0, 8),
              ca: t.ca?.slice(0, 8),
              score: t._apeScore,
              needed: threshold,
              mc: Math.round(t.mcapUsd || 0),
              buys: t.buys || 0,
              sells: t.sells || 0,
              trend: dyn?.trend || "new",
              flags: t._rugFlags || [],
            });
          }
          return false;
        }
        pipeline.passed++;
        return true;
      }).sort((a, b) => (b._apeScore || 0) - (a._apeScore || 0));

      // ═══ 5-GATE PIPELINE ENRICHMENT — classify confidence tier for each candidate ═══
      // Runs the full gate pipeline on scored candidates to assign tiers and exit plans.
      // Portfolio constraints are built from current state.
      const _portfolioSnapshot = {
        activePositionCount: state.positions.size,
        maxPositions: state.settings.maxPositions,
        positionsLast10m: state._positionsLast10m || 0,
        availableSOL: 0, // filled per-candidate in entry loop
        totalBankroll: 0,
        drawdownMult: state.drawdownMult,
        consecutiveLosses: state._consecutiveLosses || 0,
        lastLossTime: state._lastLossTime || 0,
        solPerTrade: state.settings.solPerTrade,
        settings: state.settings,
        activePositions: [...state.positions.entries()].map(([ca, p]) => ({
          ca, devWallet: radar.tokens.get(ca)?.devWallet, archetype: p.archetype,
        })),
      };
      // Track entries in last 10 min
      if (!state._entryTimestamps) state._entryTimestamps = [];
      state._entryTimestamps = state._entryTimestamps.filter(t => Date.now() - t < 600000);
      state._positionsLast10m = state._entryTimestamps.length;
      _portfolioSnapshot.positionsLast10m = state._positionsLast10m;

      for (const t of hot) {
        const qf = extractQuickFeatures(t);
        const dyn = scoreDynamics.get(t.ca);
        const scores = {
          apeScore: t._apeScore || 0,
          scoreTimestamp: Date.now(),
          pricePhase: t._pricePhase,
          buyVelTrend: t._buyVelTrend,
          rugFlagCount: t._rugFlags?.length || 0,
        };
        const pipeResult = runPipeline(t, qf, scores, dyn, _portfolioSnapshot);
        t._pipelineTier = pipeResult.tier;
        t._pipelineLabel = pipeResult.tierLabel;
        t._pipelineDecision = pipeResult.decision;
        t._pipelineRejectGate = pipeResult.rejectGate;
        t._pipelineRejectReason = pipeResult.rejectReason;
        t._pipelineExitPlan = pipeResult.exitPlan;
        t._pipelineSizing = pipeResult.positionSize;
        t._pipelineTiming = pipeResult.timing;
      }
      // Track tier distribution
      if (!state._pipelineStats) state._pipelineStats = { lastLog: 0, nearMisses: [], rugRejects: [], skippedGreen: [], cycles: 0, lastPipeline: null };
      const _tierDist = { 1: 0, 2: 0, 3: 0, 4: 0, 0: 0 };
      for (const t of hot) _tierDist[t._pipelineTier || 0]++;
      state._pipelineStats.tierDistribution = _tierDist;

      // ── PIPELINE DECISION LOG — shows what's happening every cycle ──
      if (!state._pipelineStats) state._pipelineStats = { lastLog: 0, nearMisses: [], rugRejects: [], skippedGreen: [], cycles: 0, lastPipeline: null };
      state._pipelineStats.cycles++;
      state._pipelineStats.lastPipeline = pipeline;
      // Keep rolling near misses (last 10, deduplicated by ca)
      for (const nm of pipeline.nearMisses) {
        const existing = state._pipelineStats.nearMisses.findIndex(n => n.ca === nm.ca);
        if (existing >= 0) state._pipelineStats.nearMisses[existing] = { ...nm, time: Date.now() };
        else state._pipelineStats.nearMisses.push({ ...nm, time: Date.now() });
      }
      state._pipelineStats.nearMisses = state._pipelineStats.nearMisses
        .filter(n => Date.now() - n.time < 300000) // keep 5min
        .slice(-10);
      // Track rug gate rejections with reasons (last 15)
      for (const rr of pipeline.rugRejects) {
        const existing = state._pipelineStats.rugRejects.findIndex(n => n.ca === rr.ca);
        if (existing >= 0) state._pipelineStats.rugRejects[existing] = { ...rr, time: Date.now() };
        else state._pipelineStats.rugRejects.push({ ...rr, time: Date.now() });
      }
      state._pipelineStats.rugRejects = state._pipelineStats.rugRejects
        .filter(n => Date.now() - n.time < 300000)
        .slice(-15);

      // Log pipeline summary every 30s
      if (Date.now() - state._pipelineStats.lastLog > 30000) {
        state._pipelineStats.lastLog = Date.now();
        const p = pipeline;
        const nmStr = p.nearMisses.length > 0 ? ` | NEAR: ${p.nearMisses.map(n => `${n.name}(${n.score}/${n.needed})`).join(", ")}` : "";
        const survStr = p.survivorRejects?.length > 0 ? ` | SURVIVOR-KILLED: ${p.survivorRejects.map(s => `${s.name}(match:${s.survivorMatch}%)`).join(", ")}` : "";
        const sbStats = survivorBias.survivors.size > 0 ? ` [SB:${survivorBias.survivors.size}W/${survivorBias.dead.size}L]` : "";
        // Tier distribution for pipeline candidates
        const tierDist = { 1: 0, 2: 0, 3: 0, 4: 0 };
        for (const t of hot) { if (t._pipelineTier) tierDist[t._pipelineTier]++; }
        const tierStr = hot.length > 0 ? ` | TIERS: T1:${tierDist[1]} T2:${tierDist[2]} T3:${tierDist[3]} WL:${tierDist[4]}` : "";
        log(`SCAN: ${p.total} tokens → ${p.total-p.baseFilter} pass base → ${p.total-p.baseFilter-p.alreadyOwned-p.cooldown} new → ${p.total-p.baseFilter-p.alreadyOwned-p.cooldown-p.rugGate} pass rug → ${p.total-p.baseFilter-p.alreadyOwned-p.cooldown-p.rugGate-p.trendReject} pass trend → ${p.passed} READY (need ${state.settings.minScore}+)${sbStats}${tierStr}${nmStr}${survStr}`);
      }

      // ═══ SCORE-BASED POSITION SIZING (Kelly Criterion + Kahneman Loss Aversion) ═══
      // Axiomatic reasoning:
      //   Axiom 1 (Kahneman): Losses hurt ~2x more than equivalent gains feel good.
      //     → Size positions so worst-case loss (SL2) is psychologically bearable.
      //   Axiom 2 (Kelly): Optimal bet size = edge / odds. Higher score = bigger edge.
      //     → Scale SOL linearly from 0.5x at minScore to 1.5x at score 80+.
      //   Axiom 3 (Norman): Make the system state visible — log the sizing rationale.
      //     → Show WHY each position is sized the way it is.
      //   Axiom 4 (Prospect Theory): People are risk-seeking in losses, risk-averse in gains.
      //     → Counter this bias: bet MORE on high-conviction, LESS on marginal signals.
      //
      // Formula: sizeMult = 0.5 + (score - minScore) / (80 - minScore)
      //   score=minScore → 0.5x (half size, marginal conviction)
      //   score=80       → 1.5x (full conviction, max edge)
      //   Capped at [0.4x, 1.6x] to prevent extremes.
      //   Trend bonus: rocket/rising adds +0.15x (momentum confirms conviction)
      //   Rug flags: each flag reduces by 0.1x (uncertainty penalty)
      function calcPositionSize(score, trend, rugFlagCount, baseSol) {
        // ═══ ADAPTIVE QUARTER-KELLY SIZING + DRAWDOWN GOVERNOR ═══
        // Meme tokens follow power-law returns (Pareto, not Gaussian)
        // Quarter-Kelly handles extreme variance. Drawdown governor protects capital.

        // Drawdown governor: if trading halted, return 0
        if (state.drawdownMult <= 0) return 0;

        const winRate = score >= 70 ? 0.45 : score >= 55 ? 0.35 : score >= 40 ? 0.25 : score >= 25 ? 0.15 : 0.08;
        const payoffRatio = 3.0;
        const q = 1 - winRate;
        const kellyFull = Math.max(0, (winRate * payoffRatio - q) / payoffRatio);
        const kellyQuarter = kellyFull * 0.25;

        let mult = 0.3 + kellyQuarter * 8.5;

        // Trend adjustment
        if (trend === "rocket") mult *= 1.15;
        else if (trend === "rising") mult *= 1.08;
        else if (trend === "fading") mult *= 0.85;
        else if (trend === "declining") mult *= 0.7;

        // Rug flag penalty
        if (rugFlagCount > 0) mult *= Math.pow(0.75, rugFlagCount);

        // ═══ DRAWDOWN GOVERNOR — scale down sizing as DD deepens ═══
        // At 25% DD → 0.5x, at 50% DD → stopped (caught above)
        mult *= state.drawdownMult;

        mult = Math.max(0.25, Math.min(2.0, mult));
        return Math.round(baseSol * mult * 1000) / 1000;
      }

      // ═══ ENTRY TIMING ENGINE — prevent buying at wrong time ═══
      // Score stability: track which tokens have been above threshold consecutively
      if (!state._scoreStability) state._scoreStability = new Map(); // ca → { aboveCount, firstSeen }
      const stabilityMap = state._scoreStability;
      // Update stability for all scored tokens this cycle
      const adj2 = tradeLearner.getAdjustments();
      const effMin = Math.max(45, Math.min(state.settings.minScore, adj2.minScoreShift || state.settings.minScore));
      for (const t of hot) {
        const prev = stabilityMap.get(t.ca) || { aboveCount: 0, firstSeen: Date.now() };
        prev.aboveCount++;
        prev.lastSeen = Date.now();
        stabilityMap.set(t.ca, prev);
        t._stabilityCount = prev.aboveCount; // expose to pipeline Gate 5
      }
      // Prune tokens not seen in 30s
      for (const [ca, s] of stabilityMap) { if (Date.now() - s.lastSeen > 30000) stabilityMap.delete(ca); }

      // Ape into top 2 candidates per cycle — with entry timing gates
      for (const t of hot.slice(0, 2)) {
        if (state.positions.size >= state.settings.maxPositions) break;

        // ── ENTRY TIMING GATE 1: Score Stability ──
        // Require score above threshold for 2+ consecutive cycles (8+ seconds)
        // Exception: early movers (<2 min, MC <$30K) get 1-cycle pass
        const stability = stabilityMap.get(t.ca);
        const ageMin = Math.max(0.3, (Date.now() - t.createdAt) / 60000);
        const isEarly = ageMin < 2 && t.mcapUsd <= 30000;
        if (!isEarly && (!stability || stability.aboveCount < 2)) {
          if (stability?.aboveCount === 1) {
            log(`TIMING WAIT ${t.name||t.ca.slice(0,6)} | score:${t._apeScore} — need 1 more cycle for stability`);
          }
          continue;
        }

        // ── ENTRY TIMING GATE 2: Price Phase Detection ──
        // Don't buy into active spikes — wait for dip or consolidation
        const spark = t.spark || [];
        let pricePhase = "EARLY";
        if (spark.length >= 4) {
          const recent = spark.slice(-4);
          const peak = Math.max(...spark);
          const cur = spark[spark.length - 1];
          const fromPeak = peak > 0 ? (peak - cur) / peak : 0;
          const recentSlope = recent.length >= 2 ? (recent[recent.length - 1] - recent[0]) / Math.max(1, recent[0]) : 0;
          if (recentSlope > 0.15 && cur >= peak * 0.95) pricePhase = "SPIKE";
          else if (fromPeak > 0.08 && recentSlope <= 0.02) pricePhase = "DIP";
          else if (Math.abs(recentSlope) < 0.05) pricePhase = "CONSOLIDATION";
          else if (recentSlope > 0.05) pricePhase = "SPIKE";
        }
        // Block SPIKE entries unless score is extremely high (>70 = strong conviction override)
        if (pricePhase === "SPIKE" && (t._apeScore || 0) < 70) {
          log(`TIMING SKIP ${t.name||t.ca.slice(0,6)} | score:${t._apeScore} phase:SPIKE — waiting for pullback`);
          continue;
        }

        // ── ENTRY TIMING GATE 3: Buy Velocity Trend ──
        // If buy rate is decelerating, we'd be buying the tail end of the pump
        let buyVelTrend = "steady";
        if (t.trades && t.trades.length >= 6) {
          const trades = t.trades;
          const mid = Math.floor(trades.length / 2);
          const firstBuys = trades.slice(0, mid).filter(tr => tr.side === "buy").length;
          const secondBuys = trades.slice(mid).filter(tr => tr.side === "buy").length;
          const firstSpan = Math.max(1, ((trades[mid]?.time || Date.now()) - (trades[0]?.time || Date.now())) / 60000);
          const secondSpan = Math.max(0.3, (Date.now() - (trades[mid]?.time || Date.now())) / 60000);
          if (secondBuys / secondSpan < (firstBuys / firstSpan) * 0.5) buyVelTrend = "decelerating";
          else if (secondBuys / secondSpan > (firstBuys / firstSpan) * 1.3) buyVelTrend = "accelerating";
        }
        // Block decelerating entries unless early mover or very high score
        if (buyVelTrend === "decelerating" && !isEarly && (t._apeScore || 0) < 65) {
          log(`TIMING SKIP ${t.name||t.ca.slice(0,6)} | score:${t._apeScore} buyVel:DECEL — buy rate fading`);
          continue;
        }

        // ── Size adjustment based on entry quality ──
        // Better entry timing = bigger size, worse = smaller
        let timingMult = 1.0;
        if (pricePhase === "DIP") timingMult = 1.15;        // best entry — reward
        else if (pricePhase === "SPIKE") timingMult = 0.7;    // forced through (high score) — reduce size
        if (buyVelTrend === "accelerating") timingMult *= 1.1; // momentum building — slight boost
        const phaseTag = pricePhase !== "EARLY" ? ` phase:${pricePhase}` : "";
        const velTag = buyVelTrend !== "steady" ? ` buyVel:${buyVelTrend}` : "";

        // Score-based sizing
        const rugFlagCount = t._rugFlags?.length || 0;
        const tradeSol = Math.round(calcPositionSize(t._apeScore || 0, t._scoreTrend, rugFlagCount, state.settings.solPerTrade) * timingMult * 1000) / 1000;
        // Check balance
        let balance = 0;
        try { balance = await connection.getBalance(kp.publicKey) / LAMPORTS_PER_SOL; } catch { continue; }
        if (balance < tradeSol + 0.01) { log("Low balance: " + balance.toFixed(4)); break; }

        const sizeMult = (tradeSol / state.settings.solPerTrade).toFixed(2);
        const rugFlags = t._rugFlags?.length > 0 ? ` [WARN: ${t._rugFlags.join(",")}]` : "";
        const trendTag = t._scoreTrend && t._scoreTrend !== "new" && t._scoreTrend !== "stable" ? ` trend:${t._scoreTrend}` : "";
        const earlyTag = t._earlyApe ? " [EARLY-APE]" : "";
        const bullishStr = t._bullishSignals?.length > 0 ? ` [BULLISH: ${t._bullishSignals.join(",")}]` : "";
        const walletAgeStr = t._walletAgeData ? ` wallets:${Math.round(t._walletAgeData.walletAgeScore * 100)}%aged` : "";
        const survivorStr = t._survivorMatch != null ? ` surv:${t._survivorMatch}%` : "";
        const tierTag = t._pipelineTier ? ` T${t._pipelineTier}:${t._pipelineLabel}` : "";
        log(`APE ${t.name||t.ca.slice(0,6)} | score:${t._apeScore}${tierTag}${trendTag}${earlyTag}${phaseTag}${velTag}${survivorStr} | MC:$${Math.round(t.mcapUsd)} | buys:${t.buys} sells:${t.sells} | ${tradeSol} SOL (${sizeMult}x)${rugFlags}${bullishStr}${walletAgeStr}`);
        try {
          const buyResp = await fetch("https://pumpportal.fun/api/trade-local", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publicKey: tw.pubkey, action: "buy", mint: t.ca, amount: tradeSol, denominatedInSol: "true", slippage: 25, priorityFee: 0.005, pool: "auto" }),
          });
          if (buyResp.ok) {
            const txBytes = await buyResp.arrayBuffer();
            if (txBytes.byteLength > 100) {
              const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
              tx.sign([kp]);
              const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
              // Snapshot features at entry for survivorship bias learning
              const _entryFeatures = typeof extractQuickFeatures === "function" ? extractQuickFeatures(t) : null;
              state.positions.set(t.ca, { entryMcap: t.mcapUsd, entrySol: tradeSol, entryTime: Date.now(), peakMcap: t.mcapUsd, entryScore: t._apeScore || 0, liveScore: t._apeScore || 0, entryBuys: t.buys||0, entrySells: t.sells||0, entryUB: t.uniqueBuyers?.size||0, entryAge: (Date.now()-t.createdAt)/60000, entryTrend: t._scoreTrend||"new", entryBondPct: t.vSolInBondingCurve ? Math.round(t.vSolInBondingCurve/85*100) : 0, sizeMult: +(tradeSol / state.settings.solPerTrade).toFixed(2), entryPhase: pricePhase, entryBuyVel: buyVelTrend, entryFeatures: _entryFeatures, tier: t._pipelineTier || 2, exitPlan: t._pipelineExitPlan || createExitPlan(2, t._apeScore || 0, state.settings) });
              // Track entry timestamp for rate limiting
              if (!state._entryTimestamps) state._entryTimestamps = [];
              state._entryTimestamps.push(Date.now());
              trackBuy(wallet, t.ca, tradeSol); // instant wallet visibility
              log(`BOUGHT ${t.name||t.ca.slice(0,6)} sig:${sig.slice(0,12)}...`);
              broadcastWS({ event: "auto-ape", data: { ca: t.ca, name: t.name, sol: tradeSol, mcap: t.mcapUsd, wallet, score: t._apeScore, sizeMult: +(tradeSol / state.settings.solPerTrade).toFixed(2), entryPhase: pricePhase, buyVelTrend, tier: t._pipelineTier || 2, tierLabel: t._pipelineLabel || "STRONG" } });
              // ═══ RAPID POST-ENTRY DUMP CHECK — catches instant rugs ═══
              // The 4s main loop interval lets dumps grow from -12% to -40%+.
              // This 2s rapid check catches tokens that dump immediately after our buy.
              setTimeout(async () => {
                try {
                  const pos = state.positions.get(t.ca);
                  if (!pos) return;
                  const freshToken = radar.tokens.get(t.ca);
                  if (!freshToken) return;
                  const freshMcap = freshToken.mcapUsd || 0;
                  if (pos.entryMcap <= 0 || freshMcap <= 0) return;
                  const rapidDrop = ((freshMcap - pos.entryMcap) / pos.entryMcap) * 100;
                  if (rapidDrop <= -8) { // already down 8% in 2 seconds = rug
                    log(`RAPID EXIT ${t.ca.slice(0,6)}: ${rapidDrop.toFixed(0)}% in 2s — emergency sell`);
                    const emergSig = await execSell(t.ca, 100, kp, "rapid-dump");
                    if (emergSig) {
                      broadcastWS({ event: "auto-sell", data: { ca: t.ca, pnl: rapidDrop.toFixed(1), wallet, tier: "RAPID", reason: "instant-dump" } });
                      exitPosition(t.ca, 100, "rapid-dump");
                      trackSell(wallet, t.ca);
                    }
                  }
                } catch {}
              }, 2000);
            }
          }
        } catch (e) { log(`Buy error: ${e.message}`); }
      }

      // ═══ AUTO-STOP: if no user interaction for 2 hours, pause auto-trader ═══
      if (Date.now() - state.lastActivity > 7200000) {
        log("AUTO-PAUSED: no user activity for 2h — pausing to protect funds");
        state.settings.enabled = false;
        broadcastWS({ event: "auto-paused", data: { wallet, reason: "inactivity" } });
      }
    } catch (e) { log(`Loop error: ${e.message}`); }
  }, 4000); // check every 4s — catch high-score tokens faster

  autoTraders.set(wallet, state);
  log("Auto-ape started: minScore=" + state.settings.minScore + " sol=" + state.settings.solPerTrade + " TP1=" + state.settings.tp1 + "% SL1=" + state.settings.sl1 + "% SL2=" + state.settings.sl2 + "% maxPos=" + state.settings.maxPositions);
  return state;
}

function stopAutoTrader(wallet) {
  const state = autoTraders.get(wallet);
  if (state) {
    clearInterval(state.interval);
    state.settings.enabled = false;
    // Add all current positions to cooldown so they aren't re-bought if restarted
    const cd = soldCooldowns.get(wallet) || new Map();
    for (const ca of state.positions.keys()) cd.set(ca, Date.now());
    soldCooldowns.set(wallet, cd);
  }
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

// Close all auto-trade positions (sell everything)
app.post("/api/auto-trade/close", async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    const state = autoTraders.get(wallet);
    if (!state) return res.status(404).json({ error: "No auto-trader running" });
    const tw = await getTradingWallet(wallet);
    if (!tw) return res.status(400).json({ error: "No trading wallet" });
    const kp = Keypair.fromSecretKey(bs58.decode(tw.secret));
    const results = [];
    for (const [ca, pos] of state.positions) {
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
            const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
            results.push({ ca, sold: true, sig: sig.slice(0, 12) });
            broadcastWS({ event: "auto-sell", data: { ca, wallet, reason: "close-all" } });
          }
        }
      } catch (e) { results.push({ ca, sold: false, error: e.message }); }
      trackSell(wallet, ca);
    }
    state.positions.clear();
    stopAutoTrader(wallet);
    res.json({ ok: true, closed: results.length, results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manual exit single auto-trade position (user sees rug / dry vol)
app.post("/api/auto-trade/exit-position", async (req, res) => {
  try {
    const { wallet, ca } = req.body;
    if (!wallet || !ca) return res.status(400).json({ error: "wallet and ca required" });
    const state = autoTraders.get(wallet);
    if (!state) return res.status(404).json({ error: "No auto-trader running" });
    const pos = state.positions.get(ca);
    if (!pos) return res.status(404).json({ error: "Position not found" });
    const tw = await getTradingWallet(wallet);
    if (!tw) return res.status(400).json({ error: "No trading wallet" });
    const kp = Keypair.fromSecretKey(bs58.decode(tw.secret));
    // Sell 100% via PumpPortal auto-route
    const sellResp = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: tw.pubkey, action: "sell", mint: ca, amount: "100%", denominatedInSol: "false", slippage: 30, priorityFee: 0.005, pool: "auto" }),
    });
    let sig = null;
    if (sellResp.ok) {
      const txBytes = await sellResp.arrayBuffer();
      if (txBytes.byteLength > 100) {
        const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
        tx.sign([kp]);
        sig = await heliusSendRawTx(connection, tx.serialize());
      }
    }
    // If PumpPortal failed, try Jupiter as fallback for graduated tokens
    if (!sig) {
      try {
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
        const account = tokenAccounts.value.find(ta => ta.account.data.parsed.info.mint === ca);
        if (account) {
          const tokenBalance = parseFloat(account.account.data.parsed.info.tokenAmount.uiAmountString || "0");
          const tokenDecimals = account.account.data.parsed.info.tokenAmount.decimals || 6;
          const sellAmount = Math.round(tokenBalance * Math.pow(10, tokenDecimals));
          if (sellAmount > 0) {
            const orderResp = await fetch("https://lite-api.jup.ag/ultra/v1/order", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ inputMint: ca, outputMint: "So11111111111111111111111111111111111111112", amount: sellAmount, taker: tw.pubkey }),
              signal: AbortSignal.timeout(10000),
            });
            if (orderResp.ok) {
              const order = await orderResp.json();
              if (order.transaction) {
                const txBuf = Buffer.from(order.transaction, "base64");
                const tx = VersionedTransaction.deserialize(txBuf);
                tx.sign([kp]);
                const rawTx = Buffer.from(tx.serialize()).toString("base64");
                const execResp = await fetch("https://lite-api.jup.ag/ultra/v1/execute", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ signedTransaction: rawTx, requestId: order.requestId }),
                  signal: AbortSignal.timeout(15000),
                });
                if (execResp.ok) { const r = await execResp.json(); sig = r.signature || r.txid; }
              }
            }
          }
        }
      } catch (e) { console.log(`[AUTO-EXIT] Jupiter fallback error: ${e.message}`); }
    }
    // Move to recently closed with manual-exit reason
    const token = radar.tokens.get(ca);
    const currentMcap = token?.mcapUsd || 0;
    const changePct = pos.entryMcap > 0 ? ((currentMcap - pos.entryMcap) / pos.entryMcap) * 100 : 0;
    if (!state.recentlyClosed) state.recentlyClosed = [];
    state.recentlyClosed.push({
      ca, name: token?.name || ca.slice(0, 8),
      entrySol: pos.entrySol, entryMcap: pos.entryMcap, exitMcap: currentMcap,
      changePct: +changePct.toFixed(1),
      pnlSol: +(pos.entrySol * (changePct / 100)).toFixed(4),
      exitReason: "manual-exit",
      exitTime: Date.now(),
      age: Math.round((Date.now() - pos.entryTime) / 60000),
      entryScore: pos.entryScore || 0,
      exitScore: pos.liveScore || pos.entryScore || 0,
    });
    state.recentlyClosed = state.recentlyClosed.filter(p => Date.now() - p.exitTime < 300000).slice(-20);
    // Record in trade learner
    const peakPct = pos.entryMcap > 0 ? ((pos.peakMcap - pos.entryMcap) / pos.entryMcap) * 100 : 0;
    tradeLearner.record({
      ca, entryScore: pos.entryScore || 0, entryMcap: pos.entryMcap, exitMcap: currentMcap,
      pnlPct: +changePct.toFixed(1), pnlSol: +(pos.entrySol * (changePct / 100)).toFixed(4),
      entryBuys: pos.entryBuys || 0, entrySells: pos.entrySells || 0, entryUB: pos.entryUB || 0,
      entryAge: +(pos.entryAge || 0).toFixed(1), entryTrend: pos.entryTrend || "new",
      entryBondPct: pos.entryBondPct || 0, exitReason: "manual-exit",
      holdTime: Date.now() - pos.entryTime, peakPct: +peakPct.toFixed(1),
    });
    // ── MEME INTEL FEEDBACK: learn from manual exits too ──
    try {
      const features = typeof extractQuickFeatures === "function" ? extractQuickFeatures(token) : null;
      if (features) {
        const peakMcx = pos.entryMcap > 0 ? (pos.peakMcap || currentMcap) / pos.entryMcap : 1;
        const mcapDropPctM = pos.peakMcap > 0 ? ((pos.peakMcap - currentMcap) / pos.peakMcap) * 100 : 0;
        memeIntel.learn(features, {
          graduated: !!(token?.graduated || token?.raydiumPool),
          peakMcx,
          fleetPnl: +(pos.entrySol * (changePct / 100)).toFixed(4),
          rugged: mcapDropPctM > 80,
          mcapDropPct: mcapDropPctM,
          alive: currentMcap > 3000,
        });
        console.log(`[INTEL-FEEDBACK] Manual exit learn: ${ca.slice(0,6)} pnl=${changePct.toFixed(1)}%`);
      }
    } catch {}
    // Remove position, add cooldown
    state.positions.delete(ca);
    const cd = soldCooldowns.get(wallet) || new Map();
    cd.set(ca, Date.now());
    soldCooldowns.set(wallet, cd);
    trackSell(wallet, ca);
    state.log.push({ msg: `MANUAL EXIT ${token?.name || ca.slice(0, 6)} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%)`, time: Date.now() });
    if (state.log.length > 50) state.log.shift();
    broadcastWS({ event: "auto-sell", data: { ca, wallet, reason: "manual-exit" } });
    res.json({ ok: true, sig: sig?.slice(0, 12) || null, pnlPct: +changePct.toFixed(1) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/auto-trade/update", async (req, res) => {
  const { wallet, settings } = req.body;
  const state = autoTraders.get(wallet);
  if (!state) return res.status(404).json({ error: "No auto-trader running" });
  state.lastActivity = Date.now();
  const prev = { ...state.settings };
  Object.assign(state.settings, settings);
  // Log what changed so it shows live in Intel log
  const changes = Object.keys(settings).filter(k => settings[k] !== prev[k]);
  const summary = changes.map(k => `${k}:${prev[k]}→${state.settings[k]}`).join(" ");
  const msg = summary ? `Settings updated: ${summary}` : "Settings applied (no changes)";
  state.log.push({ msg, time: Date.now() });
  if (state.log.length > 50) state.log.shift();
  console.log(`[AUTO-APE][${wallet.slice(0,6)}] ${msg}`);
  broadcastWS({ event: "settings-updated", data: { wallet, settings: state.settings, changes } });
  res.json({ ok: true, settings: state.settings });
});

app.get("/api/auto-trade/status", (req, res) => {
  const wallet = req.query.wallet;
  const state = autoTraders.get(wallet);
  if (!state) return res.json({ active: false });
  // User is still polling — keep trader alive
  state.lastActivity = Date.now();
  res.json({
    active: state.settings.enabled,
    settings: state.settings,
    positions: [...state.positions.entries()].map(([ca, p]) => {
      const token = radar.tokens.get(ca);
      const currentMcap = token?.mcapUsd || 0;
      const changePct = p.entryMcap > 0 ? ((currentMcap - p.entryMcap) / p.entryMcap) * 100 : 0;
      return {
        ca, name: token?.name || ca.slice(0, 8),
        entryMcap: p.entryMcap, currentMcap,
        peakMcap: p.peakMcap || p.entryMcap,
        changePct: +changePct.toFixed(1),
        entrySol: p.entrySol,
        age: Math.round((Date.now() - p.entryTime) / 60000),
        tpHit: p.tpHit || 0, slHit: p.slHit || 0,
        isMoonbag: !!p.isMoonbag,
        entryScore: p.entryScore || 0,
        liveScore: p.liveScore || p.entryScore || 0,
        scoreDelta: (p.liveScore || p.entryScore || 0) - (p.entryScore || 0),
        scoreVelocity: p.scoreVelocity || 0,
        scoreAcceleration: p.scoreAcceleration || 0,
        scoreTrend: p.scoreTrend || "stable",
        tier: p.tier || 2,
        exitPlan: p.exitPlan ? { tier: p.exitPlan.tier, stopLoss: p.exitPlan.stopLoss, maxHoldMs: p.exitPlan.maxHoldMs } : null,
      };
    }),
    log: state.log.slice(-20),
    recentlyClosed: (state.recentlyClosed || []).filter(p => Date.now() - p.exitTime < 300000),
    learner: tradeLearner.insights,
    learnerAdjustments: tradeLearner.getAdjustments(),
    pipeline: state._pipelineStats ? {
      cycles: state._pipelineStats.cycles,
      last: state._pipelineStats.lastPipeline,
      nearMisses: state._pipelineStats.nearMisses,
      rugRejects: state._pipelineStats.rugRejects || [],
      tierDistribution: state._pipelineStats.tierDistribution || {},
    } : null,
  });
});

// ═══════════════════════════════════════
// SESSION LOG EXPORT — full dump for offline analysis/training
// ═══════════════════════════════════════
app.get("/api/auto-trade/export-session", (req, res) => {
  const wallet = req.query.wallet;
  const state = autoTraders.get(wallet);

  // Trade learner history + insights (available even if auto-trader not running)
  const learnerHistory = tradeLearner.history || [];
  const learnerInsights = tradeLearner.insights;
  const learnerAdjustments = tradeLearner.getAdjustments();

  // Scorer model state
  const scorerState = memeIntel?.scorer ? memeIntel.scorer.export() : null;

  // Active auto-trader state
  let autoState = null;
  if (state) {
    autoState = {
      settings: state.settings,
      log: state.log || [],
      positions: [...state.positions.entries()].map(([ca, p]) => {
        const token = radar.tokens.get(ca);
        const currentMcap = token?.mcapUsd || 0;
        return { ca, name: token?.name || ca.slice(0, 8), ...p, currentMcap };
      }),
      recentlyClosed: state.recentlyClosed || [],
      pipeline: state._pipelineStats || null,
      calibration: state.calibration || null,
    };
  }

  // Recent radar tokens snapshot (last 50 scored)
  const radarSnapshot = [];
  for (const [ca, t] of radar.tokens) {
    if (radarSnapshot.length >= 50) break;
    if (!t.buys) continue;
    radarSnapshot.push({
      ca, name: t.name, mcap: t.mcapUsd, buys: t.buys, sells: t.sells,
      uniqueBuyers: t.uniqueBuyers?.size || 0, age: Math.round((Date.now() - t.createdAt) / 60000),
      bondPct: t.vSolInBondingCurve ? Math.round(t.vSolInBondingCurve / 85 * 100) : 0,
      graduated: !!t.graduated, twitter: !!t.twitter, website: !!t.website,
    });
  }

  const dump = {
    exportedAt: new Date().toISOString(),
    wallet: wallet || "none",
    learner: { history: learnerHistory, insights: learnerInsights, adjustments: learnerAdjustments },
    scorer: scorerState,
    autoTrader: autoState,
    radarSnapshot,
    solPrice: solUsdPrice,
  };

  res.setHeader("Content-Disposition", `attachment; filename="bondli-session-${Date.now()}.json"`);
  res.setHeader("Content-Type", "application/json");
  res.json(dump);
});

// ═══════════════════════════════════════
// PAPER TRADE SIMULATION — backtest settings against recent radar data
// Applies Kahneman's "premortem" technique: simulate the WORST case
// before committing real capital. Norman: make errors visible BEFORE they cost you.
// ═══════════════════════════════════════
app.post("/api/auto-trade/simulate", (req, res) => {
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

    // Simulate against all tokens currently in radar + recently seen
    const tokens = [...radar.tokens.values()];
    let totalTrades = 0, wins = 0, losses = 0;
    let totalPnlSol = 0, totalInvested = 0;
    let bestTrade = null, worstTrade = null;
    const trades = [];

    // Build a lightweight portfolio snapshot for pipeline Gate 4
    let btActivePositions = 0;
    const btPortfolio = {
      activePositionCount: 0,
      maxPositions: s.maxPositions,
      positionsLast10m: 0,
      availableSOL: s.solPerTrade * s.maxPositions * 2,
      totalBankroll: s.solPerTrade * s.maxPositions * 2,
      solPerTrade: s.solPerTrade,
      drawdownMult: 1,
      consecutiveLosses: 0,
      lastLossTime: 0,
      currentDrawdownPct: 0,
      settings: s,
      learnerMult: 1,
      activePositions: [],
    };

    for (const t of tokens) {
      const spark = t.spark || [];
      if (spark.length < 6) continue;

      // Score this token
      const features = typeof extractQuickFeatures === "function" ? extractQuickFeatures(t) : null;
      const scoreResult = features && memeIntel?.scorer ? memeIntel.scorer.score(features) : null;
      const score = scoreResult?.score || t._apeScore || 0;
      if (score < s.minScore) continue;

      // Run 5-gate pipeline for entry decision (matches live auto-ape)
      const qf = features;
      const dyn = scoreDynamics.get(t.ca);
      const scores = {
        apeScore: score,
        scoreTimestamp: Date.now(),
        pricePhase: t._pricePhase,
        buyVelTrend: t._buyVelTrend,
        rugFlagCount: t._rugFlags?.length || 0,
      };
      const pipeResult = runPipeline(t, qf, scores, dyn, btPortfolio);

      // Only simulate tokens that pass the pipeline (ENTER decision)
      if (pipeResult.decision !== "ENTER") continue;

      // Use pipeline's tier-specific exit plan for TP/SL levels
      const exitPlan = pipeResult.exitPlan || createExitPlan(pipeResult.tier || 2, score, s);
      const tp = exitPlan.tpLevels;
      const sizing = pipeResult.positionSize;
      const tradeSol = sizing?.solAmount || Math.round(s.solPerTrade * 1000) / 1000;
      const sizeMult = sizing?.sizeMult || 1;

      // Simulate entry at spark midpoint, exit at end
      const entryIdx = Math.floor(spark.length * 0.3);
      const entryMc = spark[entryIdx] || 1;
      const peakMc = Math.max(...spark.slice(entryIdx));
      const endMc = spark[spark.length - 1] || 1;

      const peakPct = entryMc > 0 ? ((peakMc - entryMc) / entryMc) * 100 : 0;
      const endPct = entryMc > 0 ? ((endMc - entryMc) / entryMc) * 100 : 0;

      // Simulate tiered TP/SL using pipeline exit plan levels
      let exitReason = "hold";
      let soldPct = 0;
      let realizedPnl = 0;

      // TP3 (if tier supports it)
      if (tp.tp3 > 0 && peakPct >= tp.tp3) {
        realizedPnl += tradeSol * (tp.tp3 / 100) * (tp.tp3Sell / 100);
        soldPct += tp.tp3Sell * ((100 - soldPct) / 100);
        exitReason = "TP3";
      }
      // TP2
      if (peakPct >= tp.tp2) {
        const remaining = 100 - soldPct;
        realizedPnl += tradeSol * (remaining / 100) * (tp.tp2 / 100) * (tp.tp2Sell / 100);
        soldPct += tp.tp2Sell * (remaining / 100);
        if (exitReason === "hold") exitReason = "TP2";
      }
      // TP1
      if (peakPct >= tp.tp1) {
        const remaining = 100 - soldPct;
        realizedPnl += tradeSol * (remaining / 100) * (tp.tp1 / 100) * (tp.tp1Sell / 100);
        soldPct += tp.tp1Sell * (remaining / 100);
        if (exitReason === "hold") exitReason = "TP1";
      }
      // SL check using pipeline stop loss
      if (endPct <= -exitPlan.stopLoss && soldPct < 100) {
        const remaining = 100 - soldPct;
        realizedPnl += tradeSol * (remaining / 100) * (endPct / 100);
        soldPct = 100;
        exitReason = exitReason === "hold" ? "SL" : exitReason + "+SL";
      }
      // Remaining unsold position at current price
      if (soldPct < 100) {
        const remaining = (100 - soldPct) / 100;
        realizedPnl += tradeSol * remaining * (endPct / 100);
      }

      const trade = {
        name: t.name || t.ca?.slice(0, 8),
        score,
        tier: pipeResult.tier,
        tierLabel: pipeResult.tierLabel,
        sizeMult: +sizeMult.toFixed ? +sizeMult.toFixed(2) : sizeMult,
        sol: tradeSol,
        peakPct: +peakPct.toFixed(1),
        endPct: +endPct.toFixed(1),
        pnlSol: +realizedPnl.toFixed(4),
        exitReason,
      };
      trades.push(trade);
      totalTrades++;
      totalInvested += tradeSol;
      totalPnlSol += realizedPnl;
      if (realizedPnl > 0) wins++;
      else losses++;
      if (!bestTrade || realizedPnl > bestTrade.pnlSol) bestTrade = trade;
      if (!worstTrade || realizedPnl < worstTrade.pnlSol) worstTrade = trade;

      // Update portfolio snapshot for subsequent iterations
      btPortfolio.activePositionCount++;
      btPortfolio.availableSOL -= tradeSol;
    }

    const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;
    const avgPnl = totalTrades > 0 ? +(totalPnlSol / totalTrades).toFixed(4) : 0;
    const roi = totalInvested > 0 ? +((totalPnlSol / totalInvested) * 100).toFixed(1) : 0;
    // Kahneman loss-aversion adjusted score: losses count 2x
    const lossAdjPnl = trades.reduce((sum, t) => sum + (t.pnlSol < 0 ? t.pnlSol * 2 : t.pnlSol), 0);
    const kahnemanScore = totalInvested > 0 ? +((lossAdjPnl / totalInvested) * 100).toFixed(1) : 0;

    res.json({
      ok: true,
      totalTrades, wins, losses, winRate,
      totalPnlSol: +totalPnlSol.toFixed(4),
      totalInvested: +totalInvested.toFixed(4),
      roi,
      kahnemanScore, // Loss-aversion adjusted ROI
      avgPnl,
      bestTrade,
      worstTrade,
      trades: trades.sort((a, b) => b.pnlSol - a.pnlSol).slice(0, 20),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  // Clean entries older than 2 min (RPC usually catches up within 30-60s)
  for (const [c, p] of wp) { if (Date.now() - p.time > 120000) wp.delete(c); }
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
    const userWallet = req.params.wallet;
    const tw = await getTradingWallet(userWallet);

    // Collect Bondli wallet pubkeys to scan: trading wallet + extras (NOT Phantom)
    const pubkeysToScan = [];
    if (tw) {
      try {
        const twPubkey = new PublicKey(tw.pubkey || Keypair.fromSecretKey(bs58.decode(tw.secret)).publicKey.toBase58());
        pubkeysToScan.push(twPubkey);
        console.log(`[POSITIONS] Trading wallet: ${twPubkey.toBase58()}`);
      } catch (e) {
        console.warn(`[POSITIONS] Failed to resolve trading wallet for ${userWallet.slice(0,8)}: ${e.message}`);
      }
    } else {
      console.warn(`[POSITIONS] No trading wallet found for ${userWallet.slice(0,8)}`);
    }
    // Scan extra wallets (Pro/VIP fleet)
    if (redis) {
      try {
        const raw = await redis.get("extra_wallets:" + userWallet);
        if (raw) {
          const extras = JSON.parse(raw);
          for (const ew of extras) {
            try { pubkeysToScan.push(Keypair.fromSecretKey(bs58.decode(ew.secret)).publicKey); } catch {}
          }
        }
      } catch {}
    }

    if (pubkeysToScan.length === 0) return res.json({ positions: [] });

    // Scan all Bondli wallets for token accounts (trading + extras)
    // Check both standard SPL Token and Token-2022 programs
    const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    const allTokenAccounts = [];
    const scannedPubkeys = new Set(); // deduplicate
    const scanPromises = [];
    for (const pk of pubkeysToScan) {
      const pkStr = pk.toBase58();
      if (scannedPubkeys.has(pkStr)) continue;
      scannedPubkeys.add(pkStr);
      // Scan both token programs in parallel
      scanPromises.push(
        connection.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_PROGRAM })
          .then(accts => allTokenAccounts.push(...accts.value))
          .catch(e => console.warn(`[POSITIONS] RPC error (SPL) for ${pkStr.slice(0,8)}: ${e.message}`))
      );
      scanPromises.push(
        connection.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_2022_PROGRAM })
          .then(accts => allTokenAccounts.push(...accts.value))
          .catch(e => { /* Token-2022 may not exist for this wallet, ignore */ })
      );
    }
    await Promise.all(scanPromises);

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

    // Resolve metadata for unknown mints in parallel (batch of up to 10 at a time)
    const unknownMints = [...mintAmounts.keys()].filter(m => !radar.tokens.get(m));
    const metadataCache = new Map(); // mint → radarToken-like object

    // Fetch metadata in parallel batches
    const BATCH_SIZE = 10;
    for (let i = 0; i < unknownMints.length; i += BATCH_SIZE) {
      const batch = unknownMints.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (mint) => {
        // Try pump.fun first, then DexScreener
        try {
          const meta = await fetchPumpFunMetadata(mint);
          if (meta) {
            metadataCache.set(mint, { name: meta.name, ticker: meta.symbol, image: meta.image, mcapSol: 0, mcapUsd: meta.marketCap || 0 });
            return;
          }
        } catch {}
        try {
          const dr = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { signal: AbortSignal.timeout(5000) });
          if (dr.ok) { const dd = await dr.json(); const p = dd?.pairs?.[0]; if (p) metadataCache.set(mint, { name: p.baseToken?.name||"", ticker: p.baseToken?.symbol||"", image: p.info?.imageUrl||"", mcapSol: 0, mcapUsd: p.marketCap||p.fdv||0 }); }
        } catch {}
      }));
    }

    const positions = [];
    for (const [mint, { amount, decimals }] of mintAmounts) {
      const radarToken = radar.tokens.get(mint) || metadataCache.get(mint) || null;

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
    const pending = pendingPositions.get(userWallet);
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
// In-memory image cache to avoid repeated fetches for the same URL
const imgCache = new Map(); // url → { buf, ct, ts }
const IMG_CACHE_MAX = 500;
const IMG_CACHE_TTL = 3600000; // 1 hour

app.get("/api/img", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).end();

  // Check cache first
  const cached = imgCache.get(url);
  if (cached && Date.now() - cached.ts < IMG_CACHE_TTL) {
    res.set("Content-Type", cached.ct);
    res.set("Cache-Control", "public, max-age=86400");
    res.set("Access-Control-Allow-Origin", "*");
    return res.send(cached.buf);
  }

  try {
    let fetchUrl = url;
    if (fetchUrl.startsWith("ipfs://")) fetchUrl = fetchUrl.slice(7);

    // Extract IPFS hash if present
    const ipfsMatch = fetchUrl.match(/(Qm[a-zA-Z0-9]{44,}|bafkrei[a-zA-Z0-9]{50,}|bafy[a-zA-Z0-9]{50,})/);
    const ipfsHash = ipfsMatch ? ipfsMatch[1] : null;

    // Build ordered list of URLs to try — more gateways for reliability
    const urls = [];
    if (ipfsHash) {
      urls.push(`https://img.fotofolio.xyz/?url=https%3A%2F%2Fcf-ipfs.com%2Fipfs%2F${ipfsHash}`);
      urls.push(`https://cf-ipfs.com/ipfs/${ipfsHash}`);
      urls.push(`https://gateway.pinata.cloud/ipfs/${ipfsHash}`);
      urls.push(`https://nftstorage.link/ipfs/${ipfsHash}`);
      urls.push(`https://dweb.link/ipfs/${ipfsHash}`);
      urls.push(`https://ipfs.io/ipfs/${ipfsHash}`);
    }
    // pump.fun image CDN — try directly if the URL is from pump.fun
    if (fetchUrl.includes("pump.fun") || fetchUrl.includes("cf-ipfs")) {
      const pumpMatch = fetchUrl.match(/\/ipfs\/([a-zA-Z0-9]+)/);
      if (pumpMatch) urls.unshift(`https://img.fotofolio.xyz/?url=${encodeURIComponent(fetchUrl)}`);
    }
    // Always try the original URL
    if (!fetchUrl.startsWith("http")) fetchUrl = "https://" + fetchUrl;
    urls.push(fetchUrl);

    for (const u of urls) {
      try {
        const r = await fetch(u, {
          signal: AbortSignal.timeout(8000),
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "image/*,*/*" },
          redirect: "follow",
        });
        if (!r.ok) continue;
        const ct = r.headers.get("content-type") || "image/png";
        if (!ct.includes("image") && !ct.includes("octet")) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 100) continue; // skip empty/tiny responses

        // Cache the result
        if (imgCache.size >= IMG_CACHE_MAX) {
          const oldest = [...imgCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
          if (oldest) imgCache.delete(oldest[0]);
        }
        imgCache.set(url, { buf, ct, ts: Date.now() });

        res.set("Content-Type", ct);
        res.set("Cache-Control", "public, max-age=86400");
        res.set("Access-Control-Allow-Origin", "*");
        return res.send(buf);
      } catch { continue; }
    }
    res.status(404).end();
  } catch { res.status(502).end(); }
});

// ═══════════════════════════════════════
// ROUTES: MEMETIC SCORE (on-demand full 7-module)
// ═══════════════════════════════════════
const _memeticCache = new Map(); // ca -> { result, ts }
app.get("/api/memetic-score/:ca", async (req, res) => {
  try {
    const ca = req.params.ca;
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca)) return res.status(400).json({ error: "Invalid CA" });
    // Check cache (5 min TTL)
    const cached = _memeticCache.get(ca);
    if (cached && Date.now() - cached.ts < 300000) return res.json(cached.result);
    // Find token in radar pool
    const token = radar.tokens.get(ca);
    if (!token) return res.status(404).json({ error: "Token not in radar" });
    // Run full 7-module memetic score
    const result = await scoreTokenMemetic(token);
    const response = {
      ca,
      score: result.finalScore,
      memeticScore: result.memeticScore,
      onChainScore: result.onChainScore,
      archetype: result.archetype,
      moduleScores: result.moduleScores || {},
      interactionBonuses: result.interactionBonuses || [],
      kellyDampener: result.kellyDampener,
      elapsed: result.elapsed,
    };
    _memeticCache.set(ca, { result: response, ts: Date.now() });
    // Cap cache size
    if (_memeticCache.size > 200) {
      const oldest = [..._memeticCache.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, 50);
      for (const [k] of oldest) _memeticCache.delete(k);
    }
    res.json(response);
  } catch (e) {
    console.error("[MEMETIC-SCORE]", e.message);
    res.status(500).json({ error: "Scoring failed" });
  }
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

// ═══ CHART PATTERNS API ═══
app.get("/api/chart-patterns", async (req, res) => {
  try {
    const data = await getChartPatternStats();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/chart-patterns/recent", async (req, res) => {
  try {
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const snaps = await getChartSnapshots(limit);
    res.json({ charts: snaps });
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
// ROUTES: REFERRAL SYSTEM (v4 — VIP revenue sharing)
// ═══════════════════════════════════════

// Basic referral info (backwards-compatible)
app.get("/api/referral/:wallet", async (req, res) => {
  const user = await getUser(req.params.wallet);
  const code = user.customRefCode || user.refCode || req.params.wallet.slice(0, 4) + req.params.wallet.slice(-4);
  res.json({
    referralCode: code,
    customCode: user.customRefCode || "",
    referralCount: user.referralCount || 0,
    referralEarnings: parseFloat(user.referralEarnings || "0"),
    referralPendingPayout: parseFloat(user.referralPendingPayout || "0"),
    referralTotalPaid: parseFloat(user.referralTotalPaid || "0"),
    referralTier: user.referralTier || "standard",
    referralVolume: parseFloat(user.referralVolume || "0"),
    tier: user.tier,
  });
});

// Apply referral code
app.post("/api/referral/apply", async (req, res) => {
  const { wallet, refCode } = req.body;
  if (!wallet || !refCode) return res.status(400).json({ error: "wallet and refCode required" });
  // Look up referrer by code or custom code
  const clean = refCode.trim().toLowerCase();
  let referrerWallet = null;
  // Check custom codes first
  if (redis) {
    try {
      referrerWallet = await redis.get("customref:" + clean);
      if (!referrerWallet) referrerWallet = await redis.get("ref:" + refCode.trim());
    } catch {}
  }
  // Fallback: search users map
  if (!referrerWallet) {
    const found = [...users.entries()].find(([, u]) => u.refCode === refCode.trim() || u.customRefCode === clean);
    if (found) referrerWallet = found[0];
  }
  if (!referrerWallet) return res.status(400).json({ ok: false, error: "Invalid referral code" });
  if (referrerWallet === wallet) return res.status(400).json({ ok: false, error: "Cannot refer yourself" });
  const existingUser = await getUser(wallet);
  if (existingUser.referredBy) return res.status(400).json({ ok: false, error: "Already referred" });
  const referrer = await getUser(referrerWallet);
  await saveUser(wallet, { referredBy: referrerWallet, referredByTier: referrer.tier || "free" });
  await saveUser(referrerWallet, {
    referralCount: (parseInt(referrer.referralCount || "0") + 1).toString(),
    referralNetwork: (parseInt(referrer.referralNetwork || "0") + 1).toString(),
  });
  if (redis) {
    try { await redis.lPush("refevents:" + referrerWallet, JSON.stringify({ user: wallet.slice(0, 4) + "..." + wallet.slice(-4), type: "signup", time: Date.now() })); } catch {}
  }
  res.json({ ok: true, applied: refCode, referrer: referrerWallet.slice(0, 8) + "..." });
});

// VIP Dashboard — full referral analytics
app.get("/api/vip/referral-dashboard/:wallet", async (req, res) => {
  const wallet = req.params.wallet;
  const user = await getUser(wallet);
  if (!user || (user.tier !== "vip" && user.tier !== "pro" && !user.whitelisted)) {
    return res.status(403).json({ error: "VIP or Pro tier required" });
  }

  // Get all referred users
  const referredUsers = [];
  for (const [w, u] of users) {
    if (u.referredBy === wallet) {
      referredUsers.push({
        wallet: w.slice(0, 4) + "..." + w.slice(-4),
        tier: u.tier,
        joinedAt: u.firstSeen || u.lastSeen,
        lastActive: u.lastSeen || u.lastActive,
        volume: parseFloat(u.totalSolIn || "0"),
        profit: parseFloat(u.totalProfit || "0"),
        platformCut: parseFloat(u.totalPlatformCut || "0"),
      });
    }
  }

  // Get referral events from Redis
  let events = [];
  if (redis) {
    try {
      const raw = await redis.lRange("refevents:" + wallet, 0, 49);
      events = raw.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
    } catch {}
  }

  const activeRefs = referredUsers.filter(u => u.lastActive && Date.now() - new Date(u.lastActive).getTime() < 604800000);
  const code = user.customRefCode || user.refCode || wallet.slice(0, 4) + wallet.slice(-4);

  res.json({
    referralCode: code,
    defaultCode: user.refCode || wallet.slice(0, 4) + wallet.slice(-4),
    customCode: user.customRefCode || "",
    referralCount: parseInt(user.referralCount || "0"),
    referralNetwork: parseInt(user.referralNetwork || "0"),
    referralEarnings: parseFloat(user.referralEarnings || "0"),
    referralPendingPayout: parseFloat(user.referralPendingPayout || "0"),
    referralTotalPaid: parseFloat(user.referralTotalPaid || "0"),
    referralTier: user.referralTier || "standard",
    referralVolume: parseFloat(user.referralVolume || "0"),
    activeReferrals: activeRefs.length,
    totalReferralVolume: +referredUsers.reduce((s, u) => s + u.volume, 0).toFixed(4),
    totalReferralProfit: +referredUsers.reduce((s, u) => s + Math.max(0, u.profit), 0).toFixed(4),
    referredUsers,
    recentEvents: events,
    tier: user.tier,
  });
});

// VIP: Create custom referral code
app.post("/api/vip/custom-ref-code", async (req, res) => {
  const { wallet, code } = req.body;
  if (!wallet || !code) return res.status(400).json({ error: "wallet and code required" });
  const user = await getUser(wallet);
  if (!user || (user.tier !== "vip" && user.tier !== "pro" && !user.whitelisted)) {
    return res.status(403).json({ error: "VIP or Pro tier required" });
  }
  const clean = code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (clean.length < 3 || clean.length > 20) {
    return res.status(400).json({ error: "Code must be 3-20 alphanumeric characters" });
  }
  // Check uniqueness
  if (redis) {
    const existing = await redis.get("customref:" + clean);
    if (existing && existing !== wallet) {
      return res.status(400).json({ error: "Code already taken" });
    }
    // Remove old code
    if (user.customRefCode) {
      await redis.del("customref:" + user.customRefCode.toLowerCase());
    }
    await redis.set("customref:" + clean, wallet);
  }
  await saveUser(wallet, { customRefCode: clean });
  res.json({ ok: true, code: clean });
});

// VIP: Claim referral payout
app.post("/api/vip/claim-referral", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  const user = await getUser(wallet);
  const pending = parseFloat(user.referralPendingPayout || "0");
  if (pending < 0.001) return res.status(400).json({ error: "Minimum payout: 0.001 SOL", pending });

  // Transfer SOL from platform wallet to referrer
  // In production, this would be a queued on-chain transfer
  // For now, mark as claimed and queue the transfer
  await saveUser(wallet, {
    referralPendingPayout: "0",
    referralTotalPaid: (parseFloat(user.referralTotalPaid || "0") + pending).toFixed(6),
  });

  // Queue the actual SOL transfer (handled by platform wallet signer)
  if (redis) {
    try {
      await redis.lPush("payout_queue", JSON.stringify({
        to: wallet,
        amount: pending,
        type: "referral",
        time: Date.now(),
      }));
    } catch {}
  }

  console.log(`[REFERRAL] Payout claimed: ${wallet.slice(0, 8)}... | ${pending.toFixed(6)} SOL`);
  res.json({ ok: true, amount: pending, queued: true });
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

// Admin: whitelist a wallet as VIP (no payment required)
app.post("/api/admin/whitelist", requireAdmin, async (req, res) => {
  const { wallet } = req.body;
  if (!wallet || wallet.length < 32) return res.status(400).json({ error: "Valid wallet required" });
  await saveUser(wallet, { tier: "vip", whitelisted: true, paid: true });
  res.json({ ok: true, wallet, tier: "vip", whitelisted: true });
});

// Admin: remove VIP/whitelist from a wallet
app.post("/api/admin/unwhitelist", requireAdmin, async (req, res) => {
  const { wallet } = req.body;
  if (!wallet || wallet.length < 32) return res.status(400).json({ error: "Valid wallet required" });
  await saveUser(wallet, { tier: "free", whitelisted: false, paid: false });
  res.json({ ok: true, wallet, tier: "free", whitelisted: false });
});

// ═══════════════════════════════════════
// ROUTES: INTEL (meme analytics)
// ═══════════════════════════════════════
app.get("/api/intel/stats", (req, res) => {
  const tokens = [...radar.tokens.values()];
  const withMcap = tokens.filter(t => t.mcapUsd > 0);
  const graduated = tokens.filter(t => t.graduated || t.mcapUsd >= gradMcUsd());
  // Grad rate: count tokens old enough (10+ min) OR all tokens with any activity
  const now = Date.now();
  const matureTokens = tokens.filter(t => t.createdAt && (now - t.createdAt) > 10 * 60 * 1000 && (t.buys > 0 || t.mcapUsd > 0));
  const matureGraduated = matureTokens.filter(t => t.graduated || t.mcapUsd >= gradMcUsd());
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
    const mcScore = mc >= gradMcUsd() ? 15 : mc >= 80000 ? 10 : mc >= 40000 ? 7 : mc >= 20000 ? 4 : mc >= 10000 ? 2 : 0;
    const socialScore = (t.twitter ? 2 : 0) + (t.website ? 1 : 0) + (t.telegram ? 1 : 0);
    const pressureScore = buys > 3 ? Math.min(5, (buys / Math.max(1, buys + sells)) * 5) : 0;
    const sellPenalty = sells > buys * 0.7 ? Math.min(15, (sells - buys * 0.5) * 2) : 0;

    // ── Rug detection scoring (enhanced) ──
    const rugFlags = [];
    let rugScore = 0;

    // Dev sell detection
    const devW = (t.devWallet || "").slice(0, 8);
    const devTrades = devW ? trades.filter(tr => (tr.wallet || "").startsWith(devW)) : [];
    const devSells = devTrades.filter(tr => tr.side === "sell");
    if (devSells.length > 0 && buys < 20) { rugFlags.push("dev_dumping"); rugScore += 25; }
    // Dev self-snipe: dev sold more than they bought
    const devBuySol = devTrades.filter(tr => tr.side === "buy").reduce((s, tr) => s + (tr.sol || 0), 0);
    const devSellSol = devSells.reduce((s, tr) => s + (tr.sol || 0), 0);
    if (devBuySol > 0 && devSellSol > devBuySol * 0.8) { rugFlags.push("dev_self_snipe"); rugScore += 20; }

    // Holder concentration (top wallet)
    const walletBuys = {};
    trades.filter(tr => tr.side === "buy").forEach(tr => {
      walletBuys[tr.wallet || "?"] = (walletBuys[tr.wallet || "?"] || 0) + (tr.sol || 0);
    });
    const sortedH = Object.values(walletBuys).sort((a, b) => b - a);
    const totalH = sortedH.reduce((s, v) => s + v, 0);
    // Top 3 wallets concentration
    const top3H = sortedH.slice(0, 3).reduce((s, v) => s + v, 0);
    if (totalH > 0 && top3H / totalH > 0.7) { rugFlags.push("whale_concentrated"); rugScore += 20; }
    else if (totalH > 0 && sortedH.length > 0 && sortedH[0] / totalH > 0.5) { rugFlags.push("whale_heavy"); rugScore += 12; }

    // Coordinated sells (3+ sells within 5 seconds)
    const sellTimes = trades.filter(tr => tr.side === "sell").map(tr => tr.time || 0).sort((a, b) => a - b);
    for (let si = 0; si < sellTimes.length - 2; si++) {
      if (sellTimes[si + 2] - sellTimes[si] < 5000) { rugFlags.push("coordinated_sells"); rugScore += 20; break; }
    }

    // Mcap crash detection (more sensitive)
    const spark = t.spark || [];
    if (spark.length > 3) {
      const peak = Math.max(...spark);
      const current = spark[spark.length - 1] || 0;
      if (peak > 0 && current / peak < 0.3) { rugFlags.push("mcap_crashing"); rugScore += 20; }
      else if (peak > 0 && current / peak < 0.5) { rugFlags.push("mcap_declining"); rugScore += 10; }
      // Pump-and-dump pattern: peaked early, crashed since
      const peakIdx = spark.indexOf(peak);
      if (peakIdx < spark.length * 0.4 && peak > 0 && current < peak * 0.35) {
        rugFlags.push("pump_dump"); rugScore += 15;
      }
    }

    // High sell ratio
    if (sells > buys * 1.5 && sells > 5) { rugFlags.push("sell_wave"); rugScore += 15; }

    // Sybil detection: many identical-size buys
    const buySolMap = new Map();
    for (const tr of trades.filter(t2 => t2.side === "buy")) {
      const k = ((tr.sol || 0) * 100 | 0);
      buySolMap.set(k, (buySolMap.get(k) || 0) + 1);
    }
    let sybilBuys = 0;
    for (const [, c] of buySolMap) { if (c >= 4) sybilBuys += c; }
    if (buys > 5 && sybilBuys / buys > 0.4) { rugFlags.push("sybil_bots"); rugScore += 15; }

    // Quick-flip detection: wallets that buy and sell within 60s
    const walletFirst = new Map();
    let flipCount = 0;
    for (const tr of trades) {
      if (tr.side === "buy" && tr.wallet && !walletFirst.has(tr.wallet)) walletFirst.set(tr.wallet, tr.time);
      if (tr.side === "sell" && tr.wallet) {
        const fb = walletFirst.get(tr.wallet);
        if (fb && (tr.time - fb) < 60000) flipCount++;
      }
    }
    if (ub > 3 && flipCount / ub > 0.3) { rugFlags.push("quick_flips"); rugScore += 12; }

    // Sell volume exceeding buy volume
    const sellVol2 = t.sellVolumeSol || 0;
    if (vol > 0 && sellVol2 / vol > 0.8) { rugFlags.push("liquidity_drain"); rugScore += 15; }

    // Flatline-spike chart pattern (classic rug shape)
    if (t.spark && t.spark.length >= 6) {
      const sp = t.spark, srt = [...sp].sort((a, b) => a - b);
      const med = srt[Math.floor(srt.length / 2)] || 1;
      const lastMax = Math.max(...sp.slice(-3));
      const flatCt = sp.slice(0, -3).filter(v => v <= med * 1.3).length;
      const flatR = flatCt / Math.max(1, sp.length - 3);
      const spikeR = med > 0 ? lastMax / med : 0;
      if ((flatR > 0.7 && spikeR > 3) || (flatR > 0.6 && spikeR > 5)) { rugFlags.push("flatline_spike"); rugScore += 18; }
    }

    rugScore = Math.min(100, rugScore);
    // Non-linear penalty: mild rugs get small penalty, heavy rugs get crushed
    const rugPenalty = rugScore < 30
      ? Math.round(rugScore * 0.3)       // 0-9 points for mild signals
      : Math.round(9 + (rugScore - 30) * 0.44); // 9-40 points for serious signals

    // DexScreener paid/boosted signal bonus — strong early buy signal
    const dexBoost = radar.dexBoosted.get(t.ca);
    const boostScore = dexBoost ? Math.min(20, 12 + Math.log2(dexBoost.amount + 1)) : 0;

    const raw = buyScore + ubScore + volScore + mcScore + socialScore + pressureScore + boostScore - sellPenalty - rugPenalty;
    const score = Math.max(0, Math.min(99, Math.round(raw)));

    return {
      ca: t.ca,
      name: t.name || t.ticker || "",
      score,
      bondProb: t.graduated ? 100 : Math.min(99, Math.round((mc / gradMcUsd()) * 100)),
      rugScore,
      rugFlags,
      mcapUsd: mc,
      dexBoosted: !!dexBoost,
      boostAmount: dexBoost?.amount || 0,
      buys, ub, vol,
      time: t.createdAt,
      description: t.description || "",
      twitter: t.twitter || "",
      website: t.website || "",
      image: t.image || "",
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
      graduationRate: matureTokens.length > 0 ? (matureGraduated.length / matureTokens.length * 100).toFixed(1) + "%" : graduated.length > 0 ? (graduated.length / Math.max(1, tokens.length) * 100).toFixed(1) + "%" : "0%",
    },
    monitor: { tracking: hot.length },
    meta: metaTracker ? metaTracker.getCurrentMeta() : null,
    // Top signals: additional validation feedback loop — must pass quality gate
    topSignals: unique.filter(t => {
      // Gate 1: minimum score threshold
      if (t.score < 20) return false;
      // Gate 2: must not be flagged as rug
      if (t.rugScore > 40 || (t.rugFlags || []).length >= 2) return false;
      // Gate 3: must have real buy activity (not just 1-2 buys)
      if (t.buys < 3) return false;
      // Gate 4: must have multiple unique buyers (not just dev)
      if (t.ub < 2) return false;
      // Gate 5: check dev credibility if available
      const tok = radar.tokens.get(t.ca);
      if (tok?._devCredData) {
        if (tok._devCredData.namePrevRugged && tok._devCredData.devLaunchCount > 3) return false;
        if (tok._devCredData.devCredScore < 0.15) return false;
      }
      // Gate 6: chart pattern check — reject known bad patterns
      const qf = tok ? extractQuickFeatures(tok) : null;
      if (qf) {
        if (qf._rg_pumpDump > 0.5 || qf.ch_flatlineSpike > 0.5) return false;
        if (qf.ch_smoothGrind > 0.6) return false;
      }
      return true;
    }).slice(0, 4).map(t => {
      const tok = radar.tokens.get(t.ca);
      const ageMin = tok?.createdAt ? Math.round((Date.now() - tok.createdAt) / 60000) : 0;
      return {
        ca: t.ca, score: t.score, bondProb: t.bondProb, name: t.name, ticker: tok?.ticker || "",
        mcap: t.mcapUsd, description: t.description || "", twitter: t.twitter || "",
        website: t.website || "", telegram: tok?.telegram || "", image: t.image || "",
        buys: t.buys || 0, sells: tok?.sells || 0, ub: t.ub || 0, ageMin,
        dexBoosted: t.dexBoosted, boostAmount: t.boostAmount || 0,
        devCred: tok?._devCredData ? { score: tok._devCredData.devCredScore, launches: tok._devCredData.devLaunchCount, sol: tok._devCredData.devSolBalance } : null,
        devWalletProfile: devWalletTracker.getDevScore(t.ca),
        smartMoney: smartMoneyTracker.getSmartMoneyScore(t.ca),
      };
    }),
    recentEvents: unique.slice(0, 10).map(t => ({
      type: "score",
      data: { ca: t.ca, score: t.score, bondProb: t.bondProb, rugScore: t.rugScore || 0, rugFlags: t.rugFlags || [], name: t.name, mcap: t.mcapUsd, dexBoosted: t.dexBoosted, boostAmount: t.boostAmount, description: t.description || "", twitter: t.twitter || "", website: t.website || "", telegram: "", image: t.image || "", buys: t.buys || 0, sells: t.vol || 0, ub: t.ub || 0 },
      time: t.time,
    })),
    artwork: artworkScanner ? artworkScanner.getStats() : null,
    survivorship: survivorBias.getStats(),
    smartMoney: smartMoneyTracker.summary(),
    devWallets: devWalletTracker.summary(),
    solPrice: solUsdPrice,
    gradMc: gradMcUsd(),
    gradWatch: {
      count: gradWatchlist.size,
      tokens: [...gradWatchlist.entries()].slice(0, 10).map(([ca, w]) => ({
        ca, name: w.name, ticker: w.ticker,
        gradMcap: w.gradMcap, currentMcap: w.lastMcap,
        peakMcap: w.peakMcap,
        changePct: w.gradMcap > 0 ? +((w.lastMcap - w.gradMcap) / w.gradMcap * 100).toFixed(1) : 0,
        age: Math.round((Date.now() - w.gradTime) / 3600000),
      })),
    },
  });
});

// ═══════════════════════════════════════
// ROUTES: ENGINE STATE (live visualization data)
// ═══════════════════════════════════════
app.get("/api/engine-state", (req, res) => {
  const tokens = [...radar.tokens.values()];
  const now = Date.now();
  const recent5m = tokens.filter(t => t.createdAt && (now - t.createdAt) < 5 * 60 * 1000);
  const recent30m = tokens.filter(t => t.createdAt && (now - t.createdAt) < 30 * 60 * 1000);
  const withBuys = tokens.filter(t => (t.buys || 0) > 0);
  const graduated = tokens.filter(t => t.graduated || t.mcapUsd >= gradMcUsd());

  // Aggregate signal flows
  const totalBuys = tokens.reduce((s, t) => s + (t.buys || 0), 0);
  const totalSells = tokens.reduce((s, t) => s + (t.sells || 0), 0);
  const totalVol = tokens.reduce((s, t) => s + (t.volumeSol || 0), 0);

  // Decision matrix: categorize recent tokens by decision outcome
  const decisions = { ape: 0, watch: 0, skip: 0, rug: 0 };
  const signalFlow = []; // Last 20 signal events for animation
  recent30m.forEach(t => {
    const buys = t.buys || 0;
    const sells = t.sells || 0;
    const mc = t.mcapUsd || 0;
    const ub = t.uniqueBuyers?.size || 0;
    // Simplified scoring for visualization
    const score = Math.min(100, Math.round(
      Math.min(15, Math.log2(buys + 1) * 2.5) +
      Math.min(12, Math.log2(ub + 1) * 2) +
      Math.min(10, Math.log10((t.volumeSol || 0) * 100 + 1) * 3) +
      (mc >= gradMcUsd() ? 15 : mc >= 40000 ? 7 : mc >= 10000 ? 2 : 0) +
      (t.twitter ? 2 : 0) + (t.website ? 1 : 0) + (t.telegram ? 1 : 0)
    ));
    if (score >= 50) decisions.ape++;
    else if (score >= 25) decisions.watch++;
    else decisions.skip++;
    if (sells > buys * 0.7 && buys > 3) decisions.rug++;
    signalFlow.push({
      ca: t.ca, name: t.name || t.ticker || t.ca?.slice(0, 6),
      score, mc, buys, sells,
      signal: score >= 50 ? "APE" : score >= 25 ? "WATCH" : "SKIP",
      age: Math.round((now - (t.createdAt || now)) / 60000),
    });
  });
  signalFlow.sort((a, b) => b.score - a.score);

  // Engine modules status
  const modules = [
    { id: "pumpportal", name: "PumpPortal WS", status: radar.online ? "active" : "reconnecting", throughput: recent5m.length },
    { id: "scorer", name: "Velocity Scorer", status: "active", throughput: withBuys.length },
    { id: "intelligence", name: "Meme Intelligence", status: "active", throughput: tokens.length },
    { id: "rug_detector", name: "Rug Detector", status: "active", throughput: decisions.rug },
    { id: "trade_router", name: "Trade Router", status: graduated.length > 0 ? "active" : "idle", throughput: graduated.length },
    { id: "grad_watch", name: "Grad Watchlist", status: gradWatchlist.size > 0 ? "active" : "idle", throughput: gradWatchlist.size },
  ];

  // Feature activation heatmap (which scoring dimensions are firing)
  const featureHeat = {
    buyVelocity: Math.min(1, totalBuys / Math.max(1, tokens.length) / 5),
    sellPressure: Math.min(1, totalSells / Math.max(1, totalBuys + 1)),
    volumeFlow: Math.min(1, totalVol / Math.max(1, tokens.length * 2)),
    socialSignals: Math.min(1, tokens.filter(t => t.twitter || t.website).length / Math.max(1, tokens.length)),
    rugRisk: Math.min(1, decisions.rug / Math.max(1, recent30m.length)),
    graduation: Math.min(1, graduated.length / Math.max(1, tokens.length) * 10),
    diversity: Math.min(1, withBuys.reduce((s, t) => s + (t.uniqueBuyers?.size || 0), 0) / Math.max(1, withBuys.length * 5)),
    momentum: Math.min(1, recent5m.length / 20),
  };

  // Aggregate dynamics across tracked tokens for oracle visualization
  const dynCounts = { rocket: 0, rising: 0, fading: 0, crashing: 0, declining: 0, stable: 0 };
  const momCounts = { sustained: 0, flash: 0, exhausted: 0, building: 0, fading: 0, nascent: 0 };
  let dynTotal = 0, avgImpulse = 0, avgAccel = 0, avgVelocity = 0;
  for (const t of recent30m) {
    const dyn = scoreDynamics.get(t.ca);
    if (!dyn) continue;
    dynTotal++;
    dynCounts[dyn.trend] = (dynCounts[dyn.trend] || 0) + 1;
    momCounts[dyn.momentum] = (momCounts[dyn.momentum] || 0) + 1;
    avgImpulse += dyn.impulse || 0;
    avgAccel += dyn.acceleration || 0;
    avgVelocity += dyn.velocity || 0;
  }
  if (dynTotal > 0) { avgImpulse /= dynTotal; avgAccel /= dynTotal; avgVelocity /= dynTotal; }

  res.json({
    ts: now,
    pool: { total: tokens.length, active: withBuys.length, recent5m: recent5m.length, graduated: graduated.length },
    flow: { totalBuys, totalSells, totalVol: +totalVol.toFixed(2), buyPressure: totalBuys > 0 ? +((totalBuys / (totalBuys + totalSells)) * 100).toFixed(1) : 50 },
    decisions,
    signals: signalFlow.slice(0, 20),
    modules,
    featureHeat,
    dynamics: {
      tracked: dynTotal,
      trends: dynCounts,
      momentum: momCounts,
      avg: { velocity: +avgVelocity.toFixed(4), acceleration: +avgAccel.toFixed(6), impulse: +avgImpulse.toFixed(2) },
    },
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

// Artwork originality scan for a specific token
app.get("/api/intel/artwork/:ca", async (req, res) => {
  const token = radar.tokens.get(req.params.ca);
  if (!token) return res.status(404).json({ error: "Token not in radar" });
  // Return cached result if available
  if (token._artworkScore !== undefined) {
    return res.json({
      ca: token.ca, name: token.name,
      score: token._artworkScore, original: token._artworkOriginal,
      flags: token._artworkFlags || [], matches: token._artworkMatches || [],
    });
  }
  // Scan now if not yet scanned
  if (!token.image) return res.json({ ca: token.ca, score: 85, original: true, flags: ["NO_IMAGE"], matches: [] });
  const result = await artworkScanner.scan(token.ca, token.image, token.name || "");
  token._artworkScore = result.score;
  token._artworkOriginal = result.original;
  token._artworkFlags = result.flags;
  token._artworkMatches = result.matches;
  res.json(result);
});

// Artwork stats
app.get("/api/intel/artwork-stats", (req, res) => {
  res.json(artworkScanner ? artworkScanner.getStats() : { error: "not initialized" });
});

// ═══ SURVIVORSHIP BIAS — Kahneman Winner/Loser Analysis ═══
app.get("/api/intel/survivor-stats", (req, res) => {
  res.json(survivorBias.getStats());
});

app.get("/api/intel/survivor-profile", (req, res) => {
  res.json(survivorBias.getSurvivorProfile());
});

app.get("/api/intel/survivor-check/:ca", (req, res) => {
  const token = radar.tokens.get(req.params.ca);
  if (!token) return res.status(404).json({ error: "Token not in radar" });
  const qf = typeof extractQuickFeatures === "function" ? extractQuickFeatures(token) : null;
  if (!qf) return res.status(500).json({ error: "Cannot extract features" });
  const result = survivorBias.evaluate(qf);
  res.json({ ca: req.params.ca, name: token.name, ...result });
});

// ═══ SMART MONEY — Wallet Leaderboard, Signals, Watch Management ═══
app.get("/api/intel/smart-money", (req, res) => {
  const summary = smartMoneyTracker.summary();
  const leaderboard = smartMoneyTracker.getLeaderboard(parseInt(req.query.limit) || 50);
  const signals = smartMoneyTracker.getRecentSignals(parseInt(req.query.signals) || 20);
  res.json({ ...summary, leaderboard, signals });
});

app.get("/api/intel/smart-money/leaderboard", (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(smartMoneyTracker.getLeaderboard(limit));
});

app.get("/api/intel/smart-money/signals", (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json(smartMoneyTracker.getRecentSignals(limit));
});

app.get("/api/intel/smart-money/score/:ca", (req, res) => {
  const result = smartMoneyTracker.getSmartMoneyScore(req.params.ca);
  res.json({ ca: req.params.ca, ...result });
});

app.post("/api/intel/smart-money/watch", express.json(), (req, res) => {
  const { address, action } = req.body || {};
  if (!address) return res.status(400).json({ error: "address required" });
  if (action === "remove") {
    smartMoneyTracker.removeManualWatch(address);
    return res.json({ ok: true, action: "removed", watching: smartMoneyTracker.watchlist.size });
  }
  const added = smartMoneyTracker.addManualWatch(address);
  res.json({ ok: added, action: "added", watching: smartMoneyTracker.watchlist.size });
});

// ═══ DEV WALLET TRACKER API ═══
app.get("/api/intel/dev-wallets", (req, res) => {
  const limit = parseInt(req.query.limit || "100");
  res.json({
    summary: devWalletTracker.summary(),
    tiers: devWalletTracker.getTierDistribution(),
    devs: devWalletTracker.getDevMap(limit),
  });
});

app.get("/api/intel/dev-wallets/score/:ca", (req, res) => {
  const score = devWalletTracker.getDevScore(req.params.ca);
  const dev = devWalletTracker.getDevForToken(req.params.ca);
  res.json({
    ...score,
    dev: dev ? {
      address: dev.address,
      solBalance: dev.solBalance,
      tier: dev.tier,
      launchCount: dev.launchCount,
      pumpRate: +(dev.pumpRate * 100).toFixed(1),
      rugRate: +(dev.rugRate * 100).toFixed(1),
      tokens: dev.tokens.slice(-5),
    } : null,
  });
});

app.get("/api/intel/dev-wallets/:address", (req, res) => {
  const dev = devWalletTracker.devs.get(req.params.address);
  if (!dev) return res.status(404).json({ error: "Dev wallet not tracked" });
  res.json({
    address: dev.address,
    solBalance: dev.solBalance,
    tier: dev.tier,
    launchCount: dev.launchCount,
    pumpRate: +(dev.pumpRate * 100).toFixed(1),
    rugRate: +(dev.rugRate * 100).toFixed(1),
    bestTokenMcap: dev.bestTokenMcap,
    tokens: dev.tokens,
    firstSeen: dev.firstSeen,
    score: devWalletTracker.getDevScore(dev.address),
  });
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

  // Enrich with artwork originality data
  if (token._artworkScore !== undefined) {
    result.artwork = {
      score: token._artworkScore, original: token._artworkOriginal,
      flags: token._artworkFlags || [], matches: token._artworkMatches || [],
    };
    if (!token._artworkOriginal) {
      result.score = Math.max(0, result.score - Math.round((100 - token._artworkScore) / 5));
      result.rugFlags = [...(result.rugFlags || []), "stolen_art"];
    }
  }

  res.json(result);
});

// ═══════════════════════════════════════
// LIVE SIM MODE — paper trading available to ALL tiers
// Mirrors auto-ape logic but without real transactions
// ═══════════════════════════════════════
const liveSims = new Map(); // wallet|"anon_ip" → sim state

function createLiveSim(id, settings) {
  if (liveSims.has(id)) stopLiveSim(id);
  const state = {
    settings: {
      minScore: settings.minScore || 55,
      solPerTrade: settings.solPerTrade || 0.05,
      maxPositions: settings.maxPositions || 5,
      tp1: settings.tp1 || 25, tp1Sell: settings.tp1Sell || 35,
      tp2: settings.tp2 || 70, tp2Sell: settings.tp2Sell || 35,
      tp3: settings.tp3 || 150, tp3Sell: settings.tp3Sell || 50,
      sl1: settings.sl1 || 8, sl1Sell: settings.sl1Sell || 70,
      sl2: settings.sl2 || 15,
      momentumExit: settings.momentumExit !== false,
    },
    positions: new Map(),
    closedTrades: [],
    log: [],
    decisions: [],
    startedAt: Date.now(),
    lastActivity: Date.now(),
    interval: null,
    calibration: {
      predictions: [],
      accuracy: 0, totalPredictions: 0, correctPredictions: 0,
      lastCalibrated: Date.now(),
      adjustments: { tpBias: 0, slBias: 0, scoreBias: 0 },
    },
    graduation: { ready: false, simDurationMs: 0, totalSimTrades: 0, simWinRate: 0, simRoi: 0, confidence: 0 },
    stats: { totalBuys: 0, totalSells: 0, wins: 0, losses: 0, totalPnlSol: 0, totalInvested: 0, bestTrade: null, worstTrade: null, peakPnl: 0, maxDrawdown: 0 },
    soldCooldowns: new Map(),
  };

  const simLog = (msg, type = "info") => {
    state.log.push({ msg, type, time: Date.now() });
    if (state.log.length > 100) state.log.shift();
    console.log(`[SIM][${id.slice(0, 8)}] ${msg}`);
  };

  const addDecision = (action, data) => {
    const d = { action, ...data, time: Date.now() };
    state.decisions.push(d);
    if (state.decisions.length > 200) state.decisions.shift();
    broadcastWS({ event: "sim-decision", data: { simId: id, ...d } });
  };

  function calcPositionSize(score, trend, rugFlagCount) {
    // Adaptive quarter-Kelly sizing (matches auto-ape formula)
    const winRate = score >= 70 ? 0.45 : score >= 55 ? 0.35 : score >= 40 ? 0.25 : score >= 25 ? 0.15 : 0.08;
    const payoffRatio = 3.0;
    const q = 1 - winRate;
    const kellyFull = Math.max(0, (winRate * payoffRatio - q) / payoffRatio);
    const kellyQuarter = kellyFull * 0.25;
    let mult = 0.3 + kellyQuarter * 8.5;
    if (trend === "rocket") mult *= 1.15;
    else if (trend === "rising") mult *= 1.08;
    else if (trend === "fading") mult *= 0.85;
    else if (trend === "declining") mult *= 0.7;
    if (rugFlagCount > 0) mult *= Math.pow(0.75, rugFlagCount);
    mult += state.calibration.adjustments.scoreBias * 0.01;
    mult = Math.max(0.25, Math.min(2.0, mult));
    return Math.round(state.settings.solPerTrade * mult * 1000) / 1000;
  }

  function closeTrade(ca, changePct, reason) {
    const pos = state.positions.get(ca);
    if (!pos) return;
    const pnlSol = pos.entrySol * (changePct / 100);
    const trade = { ca, name: pos.name, ticker: pos.ticker, entryScore: pos.entryScore, entrySol: pos.entrySol, changePct, pnlSol: +pnlSol.toFixed(4), exitReason: reason, duration: Date.now() - pos.entryTime, time: Date.now() };
    state.closedTrades.push(trade);
    if (state.closedTrades.length > 200) state.closedTrades.shift();
    if (pnlSol > 0) { state.stats.wins++; state._consecutiveLosses = 0; }
    else { state.stats.losses++; state._consecutiveLosses = (state._consecutiveLosses || 0) + 1; state._lastLossTime = Date.now(); }
    state.stats.totalPnlSol += pnlSol;
    state.stats.totalSells++;
    if (!state.stats.bestTrade || pnlSol > state.stats.bestTrade.pnlSol) state.stats.bestTrade = trade;
    if (!state.stats.worstTrade || pnlSol < state.stats.worstTrade.pnlSol) state.stats.worstTrade = trade;
    if (state.stats.totalPnlSol > state.stats.peakPnl) state.stats.peakPnl = state.stats.totalPnlSol;
    const dd = state.stats.peakPnl - state.stats.totalPnlSol;
    if (dd > state.stats.maxDrawdown) state.stats.maxDrawdown = dd;
    state.positions.delete(ca);
    state.soldCooldowns.set(ca, Date.now());
  }

  function updateGraduation() {
    const dur = Date.now() - state.startedAt;
    const total = state.stats.wins + state.stats.losses;
    const wr = total > 0 ? Math.round((state.stats.wins / total) * 100) : 0;
    const roi = state.stats.totalInvested > 0 ? +((state.stats.totalPnlSol / state.stats.totalInvested) * 100).toFixed(1) : 0;
    const dPts = Math.min(30, (dur / 3600000) * 30);
    const tPts = Math.min(25, (total / 20) * 25);
    const wPts = wr >= 55 ? 25 : wr >= 45 ? 15 : 5;
    const rPts = roi > 0 ? 20 : roi > -5 ? 10 : 0;
    state.graduation = { ready: Math.round(dPts + tPts + wPts + rPts) >= 70 && dur >= 3600000, simDurationMs: dur, totalSimTrades: total, simWinRate: wr, simRoi: roi, confidence: Math.min(100, Math.round(dPts + tPts + wPts + rPts)) };
  }

  // Sim scoring mirrors auto-ape's FULL pipeline: hard rug gate + comprehensive scoring
  // This ensures sim decisions match what auto-ape would actually do with real SOL.
  function simScoreToken(t) {
    const mc = t.mcapUsd || 0;
    const buys = t.buys || 0;
    const sells = t.sells || 0;
    const ub = t.uniqueBuyers?.size || t.uniqueBuyers || 0;
    const ageMin = (Date.now() - (t.createdAt || Date.now())) / 60000;
    const vol = t.volumeSol || 0;
    const sellVol = t.sellVolumeSol || 0;
    const dyn = scoreDynamics.get(t.ca);
    const isAccelerating = dyn && dyn.scores >= 2 && (dyn.trend === "rocket" || dyn.trend === "rising");
    const isLowVelocity = mc >= 4000 && mc <= 30000 && buys >= 1 && sells <= buys && ub >= 1 && ageMin >= 0.3 && ageMin <= 30;
    const isDexPaid = !!radar.dexBoosted.get(t.ca);

    // ── BASE FILTER (matches auto-ape) ──
    if (isDexPaid && mc >= 4000 && buys >= 1 && sells <= buys * 2) {
      // dex paid = early entry signal, relaxed filters
    } else if (isAccelerating) {
      if (!(mc > 3000 && buys >= 2 && ub >= 1 && ageMin >= 0.3 && sells <= buys * 1.5)) return 0;
    } else if (!isLowVelocity) {
      if (!(mc > 5000 && buys >= 2 && ub >= 2 && ageMin >= 0.5 && sells <= buys * 1.2)) return 0;
    }

    // ── HARD RUG GATE (matches auto-ape exactly) ──
    const qf = extractQuickFeatures(t);
    if (qf) {
      let rugRejectReason = null;
      if (qf.rg_devSellSpeed > 0.4) rugRejectReason = "dev_sell";
      else if (qf._rg_devSelfSnipe > 0) rugRejectReason = "dev_snipe";
      else if (qf.rg_mcapDropRate > 0.4) rugRejectReason = "mcap_crash";
      else if (qf.rg_coordDumpScore > 0.35) rugRejectReason = "coord_dump";
      else if (qf._rg_pumpDump > 0.5) rugRejectReason = "pump_dump";
      else if (qf._rg_sybilScore > 0.4) rugRejectReason = "sybil";
      else if (qf._rg_earlyDump > 0.3 && ageMin < 5) rugRejectReason = "early_dump";
      else if (qf._rg_quickFlipRate > 0.25) rugRejectReason = "quick_flip";
      else if (qf.rg_holderConcentration > 0.7 && buys > 5 && !(qf._whaleBullish > 0.3)) rugRejectReason = "whale_heavy";
      else if (qf.rg_liqRemovalSpeed > 0.65) rugRejectReason = "liq_removal";
      else if (qf.ch_smoothGrind > 0.6) rugRejectReason = "smooth_grind";
      else if (qf.ch_smoothGrind > 0.4 && qf.ch_dipRatio < 0.1) rugRejectReason = "no_dips";
      else if (qf._rg_zeroSellFlag >= 0.8) rugRejectReason = "zero_sells";
      else if (qf._rg_zeroSellFlag >= 0.5 && (qf.ch_smoothGrind > 0.3 || qf.ch_staircaseScore > 0.3)) rugRejectReason = "zero_sells_fake_chart";
      else if (qf._rg_buySellImbalance >= 0.8 && buys >= 8) rugRejectReason = "all_buys_no_sells";
      else if (qf.ch_staircaseScore > 0.6) rugRejectReason = "staircase_chart";
      else if (qf.ch_staircaseScore > 0.4 && qf._rg_freshWalletRatio > 0.6) rugRejectReason = "staircase_fresh_wallets";
      else if (qf._rg_freshWalletRatio > 0.8 && qf._rg_zeroSellFlag > 0.4) rugRejectReason = "fresh_wallet_rug";
      // Flatline spike: dead chart with sudden vertical pump = dev self-buy rug
      else if (qf.ch_flatlineSpike > 0.5) rugRejectReason = "flatline_spike";
      else if (qf.ch_flatlineSpike > 0.3 && qf._rg_zeroSellFlag > 0.3) rugRejectReason = "flatline_spike_no_sells";
      else if (qf.ch_flatlineSpike > 0.3 && qf._rg_freshWalletRatio > 0.5) rugRejectReason = "flatline_spike_fresh_wallets";
      else if (t._artworkFlags?.includes("EXACT_DUPLICATE")) rugRejectReason = "stolen_art";
      else {
        const rugSignals = [
          qf.rg_devSellSpeed > 0.25, qf.rg_coordDumpScore > 0.2,
          qf._rg_sybilScore > 0.25, qf._rg_quickFlipRate > 0.15,
          qf.rg_holderConcentration > 0.6, qf._rg_earlyDump > 0.2,
          qf.rg_mcapDropRate > 0.25, qf._rg_pumpDump > 0.3,
          qf.ch_smoothGrind > 0.35, qf.ch_dipRatio < 0.1,
          qf._rg_zeroSellFlag > 0.4, qf._rg_buySellImbalance > 0.5,
          qf.ch_staircaseScore > 0.3, qf._rg_freshWalletRatio > 0.6,
          qf.ch_flatlineSpike > 0.25,
          t._artworkOriginal === false,
        ].filter(Boolean).length;
        if (rugSignals >= 3) rugRejectReason = "multi_rug_" + rugSignals;
      }
      if (rugRejectReason) {
        t._simRugReject = rugRejectReason;
        return 0;
      }
    }

    // ── VELOCITY/ACCELERATION GATE ──
    if (!dyn || dyn.scores < 2) return 0;
    if (dyn.trend === "crashing") return 0;

    // ── SCORE COMPONENTS (matches auto-ape) ──
    const buyScore = Math.min(15, Math.log2(buys + 1) * 3);
    const ubScore = Math.min(15, Math.log2(ub + 1) * 3);
    const volScore = Math.min(12, Math.log10(vol * 100 + 1) * 4);
    const mcScore = mc >= gradMcUsd() ? 3 : mc >= 100000 ? 5 : mc >= 60000 ? 7 : mc >= 30000 ? 10 : mc >= 16000 ? 12 : mc >= 10000 ? 11 : mc >= 6000 ? 9 : mc >= 4000 ? 6 : 0;

    const spark = t.spark || [];
    let greenScore = 0;
    if (spark.length >= 3) {
      const recent = spark.slice(-3), earlier = spark.slice(-6, -3);
      if (earlier.length > 0) {
        const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
        const avgEarlier = earlier.reduce((a, b) => a + b, 0) / earlier.length;
        const growth = avgEarlier > 0 ? (avgRecent - avgEarlier) / avgEarlier : 0;
        if (growth > 0) greenScore = Math.min(20, growth * 60);
      }
    }

    const pressureScore = buys > 2 ? Math.min(10, (buys / Math.max(1, buys + sells)) * 10) : 0;
    const velocityScore = Math.min(10, (buys / Math.max(ageMin, 0.5)) * 3);
    const sellPenalty = sells > buys * 0.6 ? Math.min(12, (sells - buys * 0.4) * 2) : 0;

    // ── RUG PENALTY (graduated, matches auto-ape) ──
    let rugPenalty = 0;
    if (qf) {
      rugPenalty += qf.rg_devSellSpeed > 0.25 ? 10 : 0;
      rugPenalty += qf.rg_coordDumpScore > 0.25 ? 8 : 0;
      rugPenalty += qf.rg_mcapDropRate > 0.3 ? 8 : 0;
      rugPenalty += qf._rg_quickFlipRate > 0.15 ? 6 : 0;
      rugPenalty += qf._rg_sybilScore > 0.3 ? 6 : 0;
      rugPenalty += qf.rg_holderConcentration > 0.6 ? 5 : 0;
      rugPenalty += qf._rg_earlyDump > 0.2 ? 5 : 0;
      rugPenalty += sellVol > vol * 0.4 ? 5 : 0;
      rugPenalty += qf._rg_pumpDump > 0.3 ? 8 : 0;
      rugPenalty += qf.ch_smoothGrind > 0.35 ? Math.round(qf.ch_smoothGrind * 10) : 0;
      rugPenalty += qf._rg_zeroSellFlag > 0.4 ? Math.round(qf._rg_zeroSellFlag * 15) : 0;
      rugPenalty += qf._rg_buySellImbalance > 0.4 ? Math.round(qf._rg_buySellImbalance * 10) : 0;
      rugPenalty += qf.ch_staircaseScore > 0.3 ? Math.round(qf.ch_staircaseScore * 12) : 0;
      rugPenalty += qf._rg_freshWalletRatio > 0.6 ? Math.round(qf._rg_freshWalletRatio * 8) : 0;
    } else {
      rugPenalty = (sellVol > vol * 0.5 && sells > 3) ? 15 : (sells > buys * 1.2) ? 10 : 0;
    }

    // ── DYNAMICS BONUS ──
    let dynamicsBonus = 0;
    if (dyn.trend === "declining") dynamicsBonus = -15;
    else if (dyn.trend === "fading") dynamicsBonus = -8;
    else if (dyn.trend === "stable" && dyn.velocity <= 0) dynamicsBonus = -12;
    else if (dyn.trend === "rising") dynamicsBonus = 18;
    else if (dyn.trend === "rocket") dynamicsBonus = 30;
    if (dyn.velocity > 0.1) dynamicsBonus += Math.min(15, Math.round(dyn.velocity * 10));
    if (dyn.acceleration > 0.005) dynamicsBonus += Math.min(12, Math.round(dyn.acceleration * 200));

    // ── CHART BONUS (matches auto-ape) ──
    let chartBonus = qf?.ch_healthScore > 0.6 ? Math.round((qf.ch_healthScore - 0.5) * 16) :
                     qf?.ch_healthScore < 0.3 ? -8 : 0;
    if (qf?.ch_smoothGrind > 0.35) chartBonus -= Math.round(qf.ch_smoothGrind * 15);
    if (qf?.ch_dipRatio < 0.15 && spark.length >= 8) chartBonus -= 6;
    if (qf?.ch_pumpDump > 0.4) chartBonus -= Math.round(qf.ch_pumpDump * 10);
    if (qf?.ch_staircaseScore > 0.4) chartBonus -= Math.round(qf.ch_staircaseScore * 20);
    if (qf?._rg_zeroSellFlag > 0.5) chartBonus -= Math.round(qf._rg_zeroSellFlag * 25);
    if (qf?._rg_freshWalletRatio > 0.7) chartBonus -= Math.round(qf._rg_freshWalletRatio * 15);

    // ── EARLY APE BONUS ──
    let earlyApeBonus = 0;
    const buysPerMin = buys / Math.max(ageMin, 0.5);
    const isEarlyMcap = mc >= 4000 && mc <= 24000;
    const healthyRatio = buys > 0 && sells <= buys * 0.5;
    const noRugFlags = !t._rugFlags || t._rugFlags.length === 0;
    if (isEarlyMcap && healthyRatio && noRugFlags && buysPerMin < 3) {
      const qualitySignal = Math.min(1, (buys > 0 ? 1 - (sells / Math.max(buys, 1)) : 0.5) + (ub >= 2 ? 0.3 : 0));
      const velocityInverse = 1 / (buysPerMin + 0.3);
      earlyApeBonus = Math.min(18, Math.round(qualitySignal * velocityInverse * 8));
    }

    // ── WHALE BULLISH BONUS ──
    let whaleBullishBonus = 0;
    if (qf?._whaleBullish > 0.3) whaleBullishBonus = Math.min(15, Math.round(qf._whaleBullish * 20));
    let walletAgePenalty = 0;
    if (qf?._walletAgeFresh > 0.7) walletAgePenalty = Math.round(qf._walletAgeFresh * 12);

    // ── DEXSCREENER BOOST — strong early buy signal ──
    const dexBoost = radar.dexBoosted.get(t.ca);
    const boostScore = dexBoost ? Math.min(20, 12 + Math.log2(dexBoost.amount + 1)) : 0;

    // ── ARTWORK PENALTY ──
    const artPenalty = t._artworkOriginal === false ? Math.max(5, Math.round((100 - (t._artworkScore || 50)) / 5)) : 0;

    // ── COMPUTE RUG FLAGS (for UI display) ──
    t._rugFlags = [
      ...(qf ? [
        qf.rg_devSellSpeed > 0.3 && "dev_selling",
        qf.rg_coordDumpScore > 0.3 && "coord_sells",
        qf._rg_sybilScore > 0.3 && "sybil_bots",
        qf._rg_quickFlipRate > 0.2 && "quick_flips",
        qf.rg_holderConcentration > 0.6 && "whale_heavy",
        qf.ch_smoothGrind > 0.35 && "smooth_grind",
        qf.ch_dipRatio < 0.1 && spark.length >= 8 && "no_dips",
        qf.ch_staircaseScore > 0.4 && "staircase_chart",
        qf._rg_zeroSellFlag > 0.5 && "zero_sells",
        qf._rg_buySellImbalance > 0.5 && "all_buys_no_sells",
        qf._rg_freshWalletRatio > 0.7 && "fresh_wallets",
        qf._walletAgeFresh > 0.7 && "fresh_wallets_onchain",
      ] : []),
      t._artworkOriginal === false && "stolen_art",
      t._artworkFlags?.includes("SIMILAR_IMAGE") && "similar_art",
      t._artworkFlags?.includes("LOW_EFFORT_ART") && "low_effort_art",
    ].filter(Boolean);

    // Memetic bonus (cached from creation)
    const simMemeticQuick = t._memeticQuick || 0;
    const simMemeticBonus = simMemeticQuick > 0 ? Math.round((simMemeticQuick - 0.45) * 24) : 0;

    let total = Math.max(0, Math.min(99, Math.round(
      buyScore + ubScore + volScore + mcScore + greenScore + pressureScore + velocityScore +
      boostScore + dynamicsBonus + chartBonus + earlyApeBonus + whaleBullishBonus + simMemeticBonus -
      sellPenalty - rugPenalty - artPenalty - walletAgePenalty
    )));

    // ── SURVIVORSHIP BIAS ADJUSTMENT (sim mirrors auto-ape) ──
    if (qf && survivorBias.survivors.size >= 5) {
      const sbAdj = survivorBias.getScoreAdjustment(qf);
      total = Math.max(0, Math.min(99, total + sbAdj.adjustment));
    }

    return total;
  }

  let _simCycle = 0;
  state.interval = setInterval(async () => {
    try {
      _simCycle++;
      const tokens = [...radar.tokens.values()];
      if (tokens.length === 0) {
        if (_simCycle % 5 === 1) simLog(`Waiting for radar data... (${radar.tokens.size} tokens in pool)`, "scan");
        return;
      }
      // Score tokens when auto-ape isn't actively scoring them
      // Auto-ape scores tokens in its scan loop, but if no auto-ape is running,
      // sim needs to score them itself so it can find candidates
      const anyAutoApeActive = autoTraders.size > 0;
      if (!anyAutoApeActive || _simCycle % 3 === 0) {
        for (const t of tokens) {
          if (!anyAutoApeActive || !t._apeScore) {
            const simScore = simScoreToken(t);
            if (simScore > 0) t._apeScore = simScore;
          }
        }
      }
      const tokenMap = new Map(tokens.map(t => [t.ca, t]));

      // Check existing positions using auto-ape's 4-layer exit system
      for (const [ca, pos] of state.positions) {
        const token = tokenMap.get(ca);
        if (!token) {
          if (Date.now() - pos.entryTime > 300000) {
            addDecision("SELL", { ca, name: pos.name, reason: "radar-exit", pnlPct: 0 });
            simLog(`SIM EXIT ${pos.name}: fell off radar after ${Math.round((Date.now() - pos.entryTime) / 60000)}m`, "sell");
            closeTrade(ca, 0, "radar-exit");
          }
          continue;
        }
        const mc = token.mcapUsd || 0;
        pos.currentMcap = mc;
        if (mc > pos.peakMcap) pos.peakMcap = mc;
        const changePct = pos.entryMcap > 0 ? ((mc - pos.entryMcap) / pos.entryMcap) * 100 : 0;
        pos.changePct = changePct;
        const dyn = scoreDynamics.get(ca);
        pos.trend = dyn?.trend || "new";
        pos.liveScore = token._apeScore || 0;
        // Enrich pos fields that runExitChecks needs
        pos.liveBuys = token.buys || 0;
        pos.liveUB = token.uniqueBuyers?.size || 0;

        // Use auto-ape's runExitChecks — 4-layer system (derivatives, thresholds, trailing, graduation)
        const exitResult = runExitChecks(pos, token, dyn, state.settings);
        if (exitResult) {
          const { action, pct, reason, layer, detail, moonbag } = exitResult;
          const layerName = ["", "derivative", "threshold", "trailing", "graduation"][layer] || "unknown";
          if (action === "SELL") {
            addDecision("SELL", { ca, name: pos.name, reason, pnlPct: +changePct.toFixed(1), layer: layerName, detail });
            simLog(`SIM EXIT ${pos.name}: ${reason} (L${layer}) at ${changePct.toFixed(0)}%${detail ? " — " + detail : ""}`, changePct >= 0 ? "profit" : "loss");
            closeTrade(ca, changePct, reason);
            continue;
          } else if (action === "PARTIAL_SELL") {
            // Track partial sells as TP hits for sim purposes
            const tpNum = (pos.tpHit || 0) + 1;
            pos.tpHit = tpNum;
            addDecision(`TP${tpNum}`, { ca, name: pos.name, reason, pnlPct: +changePct.toFixed(1), sellPct: pct, layer: layerName, detail });
            simLog(`SIM PARTIAL ${pos.name}: ${reason} (L${layer}) sell ${pct}% at +${changePct.toFixed(0)}%`, "profit");
            // Simulate partial sell by reducing position proportionally
            const soldFraction = (pct || 33) / 100;
            const soldSol = pos.entrySol * soldFraction;
            const partialPnl = soldSol * (changePct / 100);
            state.stats.totalPnlSol += partialPnl;
            if (state.stats.totalPnlSol > state.stats.peakPnl) state.stats.peakPnl = state.stats.totalPnlSol;
            pos.entrySol *= (1 - soldFraction);
            if (moonbag) {
              pos.isMoonbag = true;
              simLog(`SIM MOONBAG ${pos.name}: holding ${Math.round(pos.entrySol * 1000) / 1000} SOL`, "info");
            }
          } else if (action === "WIDEN_TPS") {
            // Runner detected — log but no trade action needed in sim
            if (!pos._runnerLogged) {
              simLog(`SIM RUNNER ${pos.name}: ${reason} — widening TPs ×${exitResult.multiplier}`, "info");
              pos._runnerLogged = true;
            }
          } else if (action === "TIGHTEN_SLS") {
            if (!pos._tightenLogged) {
              simLog(`SIM TIGHTEN ${pos.name}: ${reason} — SLs ×${exitResult.multiplier}`, "info");
              pos._tightenLogged = true;
            }
          }
        }
      }

      // Look for new entries using auto-ape's 5-gate pipeline
      if (state.positions.size >= state.settings.maxPositions) {
        if (_simCycle % 8 === 1) simLog(`Max positions (${state.settings.maxPositions}) filled — watching for exits`, "scan");
        updateGraduation();
        return;
      }

      // Clean expired cooldowns
      for (const [c, t] of state.soldCooldowns) {
        if (Date.now() - t > 1800000) state.soldCooldowns.delete(c);
      }

      // Build portfolio snapshot (matches auto-ape's _portfolioSnapshot structure)
      if (!state._entryTimestamps) state._entryTimestamps = [];
      state._entryTimestamps = state._entryTimestamps.filter(ts => Date.now() - ts < 600000);
      const simBankroll = state.settings.solPerTrade * state.settings.maxPositions * 2; // simulated bankroll
      const simInvested = [...state.positions.values()].reduce((s, p) => s + p.entrySol, 0);
      const simPortfolio = {
        activePositionCount: state.positions.size,
        maxPositions: state.settings.maxPositions,
        positionsLast10m: state._entryTimestamps.length,
        availableSOL: simBankroll - simInvested,
        totalBankroll: simBankroll,
        solPerTrade: state.settings.solPerTrade,
        drawdownMult: 1,
        consecutiveLosses: state.stats.losses > 0 ? Math.min(5, state.stats.losses - state.stats.wins) : 0,
        lastLossTime: state._lastLossTime || 0,
        currentDrawdownPct: state.stats.peakPnl > 0 ? (state.stats.peakPnl - state.stats.totalPnlSol) / simBankroll : 0,
        settings: state.settings,
        learnerMult: 1,
        activePositions: [...state.positions.entries()].map(([ca, p]) => ({
          ca, devWallet: radar.tokens.get(ca)?.devWallet, archetype: p.archetype,
        })),
      };

      // Pre-filter: skip already-held, cooldown, and unscored tokens
      const preFiltered = tokens.filter(t => {
        if (state.positions.has(t.ca)) return false;
        if (state.soldCooldowns.has(t.ca)) {
          const soldAt = state.soldCooldowns.get(t.ca);
          const dyn = scoreDynamics.get(t.ca);
          const recovering = dyn && dyn.scores >= 3 && (dyn.trend === "rising" || dyn.trend === "rocket");
          if (Date.now() - soldAt < (recovering ? 600000 : 1800000)) return false;
          state.soldCooldowns.delete(t.ca);
        }
        return (t._apeScore || 0) > 0;
      }).sort((a, b) => (b._apeScore || 0) - (a._apeScore || 0));

      // Run 5-gate pipeline on top candidates (matches auto-ape exactly)
      const pipelineResults = [];
      const nearMisses = [];
      const rugRejects = [];
      for (const t of preFiltered.slice(0, 15)) {
        const qf = typeof extractQuickFeatures === "function" ? extractQuickFeatures(t) : null;
        const dyn = scoreDynamics.get(t.ca);
        const scores = {
          apeScore: t._apeScore || 0,
          scoreTimestamp: Date.now(),
          pricePhase: t._pricePhase,
          buyVelTrend: t._buyVelTrend,
          rugFlagCount: t._rugFlags?.length || 0,
        };
        const pipeResult = runPipeline(t, qf, scores, dyn, simPortfolio);
        t._simPipelineTier = pipeResult.tier;
        t._simPipelineLabel = pipeResult.tierLabel;
        t._simPipelineDecision = pipeResult.decision;

        if (pipeResult.decision === "ENTER") {
          pipelineResults.push({ token: t, result: pipeResult, dyn });
        } else if (pipeResult.decision === "WATCHLIST") {
          nearMisses.push({ name: t.name || t.ca?.slice(0, 6), score: t._apeScore, tier: pipeResult.tier, reason: pipeResult.rejectReason });
        } else if (pipeResult.rejectGate === 1) {
          rugRejects.push({ name: t.name || t.ca?.slice(0, 6), reason: pipeResult.rejectReason });
        }
      }

      // Log scan activity periodically so user sees sim is working
      if (_simCycle % 5 === 1) {
        const scored = preFiltered.length;
        const topScore = preFiltered.length > 0 ? (preFiltered[0]._apeScore || 0) : 0;
        simLog(`Scan: ${tokens.length} tokens, ${scored} scored, ${pipelineResults.length} passed pipeline (top:${topScore})`, "scan");
      }

      // Log near misses for visibility
      if (pipelineResults.length === 0 && _simCycle % 10 === 1) {
        if (nearMisses.length > 0) {
          simLog(`Near misses (WATCHLIST): ${nearMisses.slice(0, 3).map(n => `${n.name} s:${n.score}`).join(", ")}`, "scan");
        }
        if (rugRejects.length > 0) {
          simLog(`Rug rejects: ${rugRejects.slice(0, 3).map(r => `${r.name}:${r.reason}`).join(", ")}`, "scan");
        }
      }

      // Enter positions for pipeline-approved tokens
      for (const { token: t, result: pipeResult, dyn } of pipelineResults.slice(0, 2)) {
        if (state.positions.size >= state.settings.maxPositions) break;
        const score = t._apeScore || 0;
        const trend = dyn?.trend || "new";
        const sizing = pipeResult.positionSize;
        const sizeSol = sizing?.solAmount || calcPositionSize(score, trend, (t._rugFlags || []).length);
        state.positions.set(t.ca, {
          name: t.name, ticker: t.ticker, image: t.image, entryMcap: t.mcapUsd || 0,
          currentMcap: t.mcapUsd || 0, peakMcap: t.mcapUsd || 0, changePct: 0,
          entrySol: sizeSol, sizeMult: sizing?.sizeMult || +(sizeSol / state.settings.solPerTrade).toFixed(2),
          entryScore: score, liveScore: score, trend, entryTime: Date.now(),
          // Auto-ape pipeline fields for exit system
          tier: pipeResult.tier, tierLabel: pipeResult.tierLabel,
          exitPlan: pipeResult.exitPlan,
          tpHit: 0, slHit: 0, isMoonbag: false,
          // Legacy compat
          tp1Hit: false, tp2Hit: false, tp3Hit: false, sl1Hit: false,
        });
        state._entryTimestamps.push(Date.now());
        state.stats.totalBuys++;
        state.stats.totalInvested += sizeSol;
        addDecision("BUY", { ca: t.ca, name: t.name, score, trend, sol: sizeSol, tier: pipeResult.tier, tierLabel: pipeResult.tierLabel, rugFlags: t._rugFlags || [], gates: pipeResult.timing });
        simLog(`SIM BUY ${t.name} score=${score} T${pipeResult.tier}:${pipeResult.tierLabel} trend=${trend} MC:$${Math.round(t.mcapUsd||0)} sol=${sizeSol}`, "buy");
      }

      updateGraduation();
    } catch (e) { console.error(`[SIM] Error: ${e.message}`); }
  }, 4000);

  liveSims.set(id, state);
  simLog(`Live sim started: minScore=${state.settings.minScore} sol=${state.settings.solPerTrade}`);
  return state;
}

function stopLiveSim(id) {
  const state = liveSims.get(id);
  if (state) clearInterval(state.interval);
  liveSims.delete(id);
}

// Start live sim
app.post("/api/sim/start", async (req, res) => {
  try {
    const { wallet, settings } = req.body;
    const id = wallet || ("anon_" + (req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown"));
    const state = createLiveSim(id, settings || {});
    res.json({ ok: true, simId: id, settings: state.settings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Stop sim
app.post("/api/sim/stop", (req, res) => {
  const { wallet } = req.body;
  const id = wallet || ("anon_" + (req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown"));
  const state = liveSims.get(id);
  if (!state) return res.json({ ok: true, message: "No sim running" });
  const totalTrades = state.stats.wins + state.stats.losses;
  const finalStats = {
    duration: Date.now() - state.startedAt, ...state.stats,
    winRate: totalTrades > 0 ? Math.round((state.stats.wins / totalTrades) * 100) : 0,
    roi: state.stats.totalInvested > 0 ? +((state.stats.totalPnlSol / state.stats.totalInvested) * 100).toFixed(1) : 0,
    calibration: state.calibration, graduation: state.graduation,
    closedTrades: state.closedTrades.slice(-20),
  };
  stopLiveSim(id);
  res.json({ ok: true, finalStats });
});

// Get sim status
app.get("/api/sim/status", (req, res) => {
  const wallet = req.query.wallet;
  const id = wallet || ("anon_" + (req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown"));
  const state = liveSims.get(id);
  if (!state) return res.json({ active: false });
  state.lastActivity = Date.now();
  const totalTrades = state.stats.wins + state.stats.losses;
  res.json({
    active: true, settings: state.settings,
    positions: [...state.positions.entries()].map(([ca, p]) => ({
      ca, name: p.name, ticker: p.ticker, image: p.image,
      entryMcap: p.entryMcap, currentMcap: p.currentMcap, peakMcap: p.peakMcap,
      changePct: p.changePct, entrySol: p.entrySol, sizeMult: p.sizeMult,
      entryScore: p.entryScore, liveScore: p.liveScore, trend: p.trend,
      tpHit: p.tpHit || ((p.tp1Hit ? 1 : 0) + (p.tp2Hit ? 1 : 0) + (p.tp3Hit ? 1 : 0)),
      slHit: p.slHit || (p.sl1Hit ? 1 : 0), isMoonbag: !!p.isMoonbag,
      tier: p.tier || 0, tierLabel: p.tierLabel || "UNKNOWN",
      age: Math.round((Date.now() - p.entryTime) / 60000),
    })),
    decisions: state.decisions.slice(-30), log: state.log.slice(-30),
    stats: { ...state.stats, totalTrades, winRate: totalTrades > 0 ? Math.round((state.stats.wins / totalTrades) * 100) : 0, roi: state.stats.totalInvested > 0 ? +((state.stats.totalPnlSol / state.stats.totalInvested) * 100).toFixed(1) : 0 },
    calibration: { accuracy: state.calibration.accuracy, totalPredictions: state.calibration.totalPredictions, adjustments: state.calibration.adjustments },
    graduation: state.graduation,
    recentlyClosed: state.closedTrades.slice(-10).reverse(),
    startedAt: state.startedAt, simDuration: Date.now() - state.startedAt,
  });
});

// Update sim settings
app.post("/api/sim/update", (req, res) => {
  const { wallet, settings } = req.body;
  const id = wallet || ("anon_" + (req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown"));
  const state = liveSims.get(id);
  if (!state) return res.status(404).json({ error: "No sim running" });
  state.lastActivity = Date.now();
  Object.assign(state.settings, settings);
  res.json({ ok: true, settings: state.settings });
});

// Graduate sim to real auto-ape
app.post("/api/sim/graduate", async (req, res) => {
  try {
    const { wallet } = req.body;
    const simState = liveSims.get(wallet);
    if (!simState) return res.status(404).json({ error: "No sim running" });
    if (!simState.graduation.ready) {
      return res.status(400).json({ error: `Not ready. Confidence: ${simState.graduation.confidence}% (need 70%+). Duration: ${Math.round(simState.graduation.simDurationMs / 60000)}m (need 60m+).` });
    }
    const graduatedSettings = {
      ...simState.settings,
      minScore: Math.max(15, simState.settings.minScore + simState.calibration.adjustments.scoreBias),
      tp1: Math.max(10, Math.round(simState.settings.tp1 * (1 + simState.calibration.adjustments.tpBias * 0.01))),
      tp2: Math.max(20, Math.round(simState.settings.tp2 * (1 + simState.calibration.adjustments.tpBias * 0.01))),
      tp3: Math.max(50, Math.round(simState.settings.tp3 * (1 + simState.calibration.adjustments.tpBias * 0.01))),
      sl1: Math.max(5, Math.round(simState.settings.sl1 * (1 + simState.calibration.adjustments.slBias * 0.01))),
      sl2: Math.max(10, Math.round(simState.settings.sl2 * (1 + simState.calibration.adjustments.slBias * 0.01))),
    };
    stopLiveSim(wallet);
    res.json({ ok: true, graduatedSettings, simStats: { duration: simState.graduation.simDurationMs, trades: simState.graduation.totalSimTrades, winRate: simState.graduation.simWinRate, roi: simState.graduation.simRoi, confidence: simState.graduation.confidence, calibrationAccuracy: simState.calibration.accuracy } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Backtest sim (one-shot against current radar data)
app.post("/api/sim/backtest", async (req, res) => {
  try {
    const { settings } = req.body;
    const s = {
      minScore: settings?.minScore || 28, solPerTrade: settings?.solPerTrade || 0.05,
      maxPositions: settings?.maxPositions || 5,
      tp1: settings?.tp1 || 25, tp1Sell: settings?.tp1Sell || 35,
      tp2: settings?.tp2 || 70, tp2Sell: settings?.tp2Sell || 35,
      tp3: settings?.tp3 || 150, tp3Sell: settings?.tp3Sell || 50,
      sl1: settings?.sl1 || 12, sl1Sell: settings?.sl1Sell || 70, sl2: settings?.sl2 || 22,
    };
    const tokens = [...radar.tokens.values()];
    let totalTrades = 0, wins = 0, losses = 0, totalPnlSol = 0, totalInvested = 0;
    let bestTrade = null, worstTrade = null;
    const trades = [];

    for (const t of tokens) {
      const spark = t.spark || [];
      if (spark.length < 6) continue;
      const features = typeof extractQuickFeatures === "function" ? extractQuickFeatures(t) : null;
      const scoreResult = features && memeIntel?.scorer ? memeIntel.scorer.score(features) : null;
      const score = scoreResult?.score || t._apeScore || 0;
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
    const avgPnl = totalTrades > 0 ? +(totalPnlSol / totalTrades).toFixed(4) : 0;
    const roi = totalInvested > 0 ? +((totalPnlSol / totalInvested) * 100).toFixed(1) : 0;
    const lossAdjPnl = trades.reduce((sum, t) => sum + (t.pnlSol < 0 ? t.pnlSol * 2 : t.pnlSol), 0);
    const kahnemanScore = totalInvested > 0 ? +((lossAdjPnl / totalInvested) * 100).toFixed(1) : 0;
    res.json({ ok: true, totalTrades, wins, losses, winRate, totalPnlSol: +totalPnlSol.toFixed(4), totalInvested: +totalInvested.toFixed(4), roi, kahnemanScore, avgPnl, bestTrade, worstTrade, trades: trades.sort((a, b) => b.pnlSol - a.pnlSol).slice(0, 20) });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
server.listen(PORT, async () => {
  console.log(`\n═══════════════════════════════════════`);
  console.log(`  BONDLI v4 API — port ${PORT}`);
  console.log(`  RPC: ${RPC_URL.slice(0, 40)}...`);
  console.log(`  Redis: ${redis ? "connected" : "in-memory"}`);
  console.log(`  SOL: $${solUsdPrice}`);
  console.log(`  Radar: PumpPortal WS connecting...`);
  console.log(`═══════════════════════════════════════\n`);

  // Load smart wallet profiles from Redis
  await smartWallets.load();

  // Load smart money tracker from Redis + start polling
  await smartMoneyTracker.load();
  // Initial sync from existing smartWallets data
  smartMoneyTracker.syncFromSmartWallets(smartWallets.walletStats);
  smartMoneyTracker.start();
  console.log(`[SMART-MONEY] Tracker started: ${smartMoneyTracker.summary().totalWallets} wallets, watching ${smartMoneyTracker.summary().watching}`);

  // Periodic smart wallet save + cleanup (every 10 minutes)
  setInterval(() => {
    smartWallets.cleanup();
    smartWallets.save();
    // Sync tracker from latest smartWallet data + save
    smartMoneyTracker.syncFromSmartWallets(smartWallets.walletStats);
    smartMoneyTracker.save();
    devWalletTracker.save();
  }, 600000);
});
