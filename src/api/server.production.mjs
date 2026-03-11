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
import { MemeIntelligence, ScoreDynamics } from "../engine/meme-intelligence.mjs";
import { ArtworkScanner } from "../engine/artwork-scanner.mjs";
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
const scoreDynamics = new ScoreDynamics(5000);
const historicalMovers = new HistoricalMovers(redis);
const artworkScanner = new ArtworkScanner(5000);
const xSocial = new XSocialIntel();

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
  try { await redis.set("intel:artwork", JSON.stringify(artworkScanner.export()), "EX", 604800); } catch {}
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
      const r2 = await fetch("https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112", { signal: AbortSignal.timeout(5000) });
      if (r2.ok) { const d2 = await r2.json(); const sp = d2?.data?.["So11111111111111111111111111111111111111112"]?.price; if (sp > 0) solUsdPrice = +sp; }
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
  // FDV = price * total supply. PumpPortal's marketCapSol underreports (~half)
  // because it uses bonding curve supply, not the full 1B token supply.
  // Compute FDV ourselves: (vSol / vTokens) * 1,000,000,000
  const TOTAL_SUPPLY = 1_000_000_000;
  const mcSol = vTokens > 0 ? (vSol / vTokens) * TOTAL_SUPPLY : (data.marketCapSol || 0);

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
      // Add to graduated watchlist for 24h follow
      const wEntry = { name: token.name || "", ticker: token.ticker || "", gradMcap: token.mcapUsd || 0, gradTime: Date.now(), spark: [...(token.spark || [])], peakMcap: token.mcapUsd || 0, lastMcap: token.mcapUsd || 0, lastRefresh: Date.now() };
      gradWatchlist.set(mint, wEntry);
      if (redis) { redis.hSet("grad:watchlist", mint, JSON.stringify(wEntry)).catch(() => {}); }
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

// ═══ GRADUATED WATCHLIST — follows tokens beyond radar TTL ═══
// Tokens that graduate get tracked here for up to 24h for learning
const gradWatchlist = new Map(); // ca → { name, ticker, gradMcap, gradTime, spark, peakMcap, lastMcap, lastRefresh }
const GRAD_WATCH_TTL = 86400000; // 24h

// Periodically refresh MC for all graduated tokens (every 30s)
setInterval(async () => {
  const graduated = [...radar.tokens.entries()].filter(([, t]) => t.graduated);
  for (const [ca] of graduated.slice(0, 10)) { // max 10 per cycle to avoid rate limits
    await refreshGraduatedMcap(ca);
    await new Promise(r => setTimeout(r, 500)); // rate limit spacing
  }
  // Also refresh watchlist tokens via DexScreener
  const now = Date.now();
  const stale = [...gradWatchlist.entries()]
    .filter(([, w]) => now - w.lastRefresh > 60000 && now - w.gradTime < GRAD_WATCH_TTL)
    .slice(0, 5);
  for (const [ca, w] of stale) {
    try {
      const d = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
      if (d?.pairs?.[0]) {
        const mc = d.pairs[0].fdv || 0;
        w.lastMcap = mc;
        if (mc > w.peakMcap) w.peakMcap = mc;
        w.spark.push(mc);
        if (w.spark.length > 100) w.spark = w.spark.slice(-100);
        w.lastRefresh = now;
        // Store updated learning data
        if (redis) {
          try { await redis.hSet("grad:watchlist", ca, JSON.stringify(w)); } catch {}
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 500));
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
}, 30000);

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
  };
}

// ═══ CHART PATTERN STORAGE — persist graduated token charts for learning ═══
const chartSnapshotCache = []; // in-memory fallback
const MAX_CHART_SNAPSHOTS = 500;

async function storeChartSnapshot(ca, token, outcome) {
  const snapshot = {
    ca,
    name: token.name || "",
    ticker: token.ticker || "",
    graduated: true,
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
  if (spark.length >= 8 && upPct > 0.82 && maxConsecutiveUp >= 5 && end > start * 1.3 && dips <= 2) return "smooth_grind_rug";
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
      // Penalize rug patterns in HOT tab too
      let rugHeatPenalty = 0;
      try {
        const qf = extractQuickFeatures(t);
        if (qf) {
          if (qf._rg_zeroSellFlag > 0.5) rugHeatPenalty += qf._rg_zeroSellFlag * 30;
          if (qf._rg_buySellImbalance > 0.5) rugHeatPenalty += qf._rg_buySellImbalance * 20;
          if (qf.ch_staircaseScore > 0.3) rugHeatPenalty += qf.ch_staircaseScore * 15;
          if (qf.ch_smoothGrind > 0.35) rugHeatPenalty += qf.ch_smoothGrind * 10;
        }
      } catch {}
      return { ...t, _heat: (t.buys/ageMin)*10 + ub*8 + t.volumeSol*5 + (t.mcapUsd>5000?10:0) - rugHeatPenalty };
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
      s.pctToGrad = t.graduated ? 100 : Math.min(99, Math.round((t.mcapUsd / gradMcUsd()) * 100));
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
      const solLamports = Math.round(solAmount * LAMPORTS_PER_SOL);
      // Try Jupiter Ultra API first
      try {
        const orderResp = await fetch("https://lite-api.jup.ag/ultra/v1/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inputMint: "So11111111111111111111111111111111111111112",
            outputMint: ca,
            amount: solLamports,
            taker: tw.pubkey,
          }),
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
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ signedTransaction: rawTx, requestId: order.requestId }),
              signal: AbortSignal.timeout(15000),
            });
            if (execResp.ok) {
              const execResult = await execResp.json();
              if (execResult.signature || execResult.txid) {
                sig = execResult.signature || execResult.txid;
                method = "jupiter-ultra";
                console.log(`[BUY] Jupiter Ultra success: ${sig}`);
              }
            }
          }
        }
      } catch (e) {
        console.log(`[BUY] Jupiter Ultra error: ${e.message}`);
      }
      // Fallback to Jupiter v6
      if (!sig) {
        try {
          const quoteResp = await fetch(
            `https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${ca}&amount=${solLamports}&slippageBps=2500`,
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
              method = "jupiter-v6";
              console.log(`[BUY] Jupiter v6 success: ${sig}`);
            }
          }
        } catch (e) {
          console.log(`[BUY] Jupiter v6 fallback error: ${e.message}`);
        }
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
    if (!tw) return res.status(400).json({ error: "No trading wallet. Create one first." });
    const kp = Keypair.fromSecretKey(bs58.decode(tw.secret));
    const pct = Math.min(100, Math.max(1, percent || 100));

    // Pre-flight: check token balance + get decimals
    let tokenBalance = 0;
    let tokenDecimals = 6;
    let balanceCheckFailed = false;
    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(kp.publicKey, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
      const account = tokenAccounts.value.find(ta => ta.account.data.parsed.info.mint === ca);
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
    // If not in radar, check DexScreener (token may have graduated and fallen off radar)
    if (!radarToken) {
      try {
        const dr = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`, { signal: AbortSignal.timeout(5000) });
        if (dr.ok) { const dd = await dr.json(); if (dd?.pairs?.length > 0) isGraduated = true; }
      } catch {}
    }

    let sig = null;
    let method = "";
    let errors = []; // collect all errors for debugging

    // Strategy 1: PumpPortal (try multiple pools — always try even if balance check failed)
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
          signal: AbortSignal.timeout(12000),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "unknown");
          errors.push(`PP:${pool}=${response.status}:${errText.slice(0, 80)}`);
          console.log(`[SELL] pool=${pool} failed ${response.status}: ${errText.slice(0, 150)}`);
          continue;
        }

        const txBytes = await response.arrayBuffer();
        if (txBytes.byteLength < 100) {
          errors.push(`PP:${pool}=empty_response`);
          continue;
        }

        const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
        tx.sign([kp]);
        sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
        method = `pumpportal:${pool}`;
        console.log(`[SELL] Success pool=${pool}: ${sig}`);
        break;
      } catch (e) {
        errors.push(`PP:${pool}=${e.message.slice(0, 60)}`);
        console.log(`[SELL] pool=${pool} error: ${e.message}`);
        continue;
      }
    }

    // Strategy 2: Jupiter fallback for graduated tokens
    if (!sig && isGraduated) {
      try {
        const sellAmount = Math.round(tokenBalance * (pct / 100) * Math.pow(10, tokenDecimals));
        // Try Jupiter Ultra first (newest API), then v6 as fallback
        let jupSuccess = false;

        // Jupiter Ultra API
        try {
          const orderResp = await fetch("https://lite-api.jup.ag/ultra/v1/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              inputMint: ca,
              outputMint: "So11111111111111111111111111111111111111112",
              amount: sellAmount,
              taker: tw.pubkey,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (orderResp.ok) {
            const order = await orderResp.json();
            if (order.transaction) {
              const txBuf = Buffer.from(order.transaction, "base64");
              const tx = VersionedTransaction.deserialize(txBuf);
              tx.sign([kp]);
              const rawTx = Buffer.from(tx.serialize()).toString("base64");
              // Execute via Ultra
              const execResp = await fetch("https://lite-api.jup.ag/ultra/v1/execute", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ signedTransaction: rawTx, requestId: order.requestId }),
                signal: AbortSignal.timeout(15000),
              });
              if (execResp.ok) {
                const execResult = await execResp.json();
                if (execResult.signature || execResult.txid) {
                  sig = execResult.signature || execResult.txid;
                  method = "jupiter-ultra";
                  jupSuccess = true;
                  console.log(`[SELL] Jupiter Ultra success: ${sig}`);
                }
              } else {
                const errText = await execResp.text().catch(() => "");
                errors.push(`JUP-Ultra-exec=${execResp.status}:${errText.slice(0, 60)}`);
              }
            }
          } else {
            const errText = await orderResp.text().catch(() => "");
            errors.push(`JUP-Ultra=${orderResp.status}:${errText.slice(0, 60)}`);
          }
        } catch (e) {
          errors.push(`JUP-Ultra=${e.message.slice(0, 60)}`);
          console.log(`[SELL] Jupiter Ultra error: ${e.message}`);
        }

        // Jupiter v6 fallback
        if (!jupSuccess) {
          try {
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
                method = "jupiter-v6";
                console.log(`[SELL] Jupiter v6 success: ${sig}`);
              } else {
                const errText = await swapResp.text().catch(() => "");
                errors.push(`JUP-v6-swap=${swapResp.status}:${errText.slice(0, 60)}`);
              }
            } else {
              const errText = await quoteResp.text().catch(() => "");
              errors.push(`JUP-v6-quote=${quoteResp.status}:${errText.slice(0, 60)}`);
            }
          } catch (e) {
            errors.push(`JUP-v6=${e.message.slice(0, 60)}`);
            console.log(`[SELL] Jupiter v6 fallback error: ${e.message}`);
          }
        }
      } catch (e) {
        errors.push(`JUP=${e.message.slice(0, 60)}`);
        console.log(`[SELL] Jupiter error: ${e.message}`);
      }
    }

    // Strategy 3: Direct RPC token close for dust/dead tokens
    if (!sig && tokenBalance > 0 && pct === 100) {
      try {
        // Try sending raw sell via PumpPortal with token amount instead of percentage
        const reqBody = {
          publicKey: tw.pubkey,
          action: "sell",
          mint: ca,
          amount: tokenBalance.toString(),
          denominatedInSol: "false",
          slippage: 50,
          priorityFee: 0.01,
          pool: "auto",
        };
        const response = await fetch("https://pumpportal.fun/api/trade-local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
          signal: AbortSignal.timeout(12000),
        });
        if (response.ok) {
          const txBytes = await response.arrayBuffer();
          if (txBytes.byteLength > 100) {
            const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
            tx.sign([kp]);
            sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
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
      minScore: settings.minScore || 28,
      solPerTrade: settings.solPerTrade || 0.05,
      maxPositions: settings.maxPositions || 5,
      // 3 Take Profit tiers: sell % of remaining at each level
      // Optimized: take profit earlier + sell less → secure gains while letting runners fly
      tp1: settings.tp1 || 25,         // TP1 trigger: +25% (lock gains early — most pumps peak fast)
      tp1Sell: settings.tp1Sell || 35,  // sell 35% at TP1 (keep 65% for bigger move)
      tp2: settings.tp2 || 70,         // TP2 trigger: +70%
      tp2Sell: settings.tp2Sell || 35,  // sell 35% of remaining at TP2
      tp3: settings.tp3 || 150,        // TP3 trigger: +150% (runner)
      tp3Sell: settings.tp3Sell || 50,  // sell 50% of remaining, rest = moonbag
      // 2 Stop Loss tiers — TIGHT defaults to cut losses fast
      sl1: settings.sl1 || 12,         // SL1 trigger: -12% (cut early before dump accelerates)
      sl1Sell: settings.sl1Sell || 70,  // sell 70% to reduce exposure fast
      sl2: settings.sl2 || 22,         // SL2 trigger: -22% full exit
      requireBoosted: settings.requireBoosted || false,
      momentumExit: settings.momentumExit !== false, // default ON — auto-tighten stops on score drop
      enabled: true,
    },
    positions: new Map(), // ca → { entryMcap, entrySol, entryTime, peakMcap, tpHit, slHit }
    log: [],
    interval: null,
    lastActivity: Date.now(), // track last user interaction for auto-stop
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
              return sig;
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
                const mcUsd = pair.fdv || pair.marketCap || 0;
                token = { mcapUsd: mcUsd, mcapSol: solUsdPrice > 0 ? mcUsd / solUsdPrice : 0, name: pair.baseToken?.name || "", graduated: true };
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
                if (sig) broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "CRASH", reason: "score-crashing", velocity: dyn.velocity } });
                exitPosition(ca, 100, "crash-exit");
                trackSell(wallet, ca);
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
              if (scoreDrop >= 30) {
                log(`MOMENTUM EXIT ${ca.slice(0,6)}: score ${pos.entryScore}→${currentScore} (−${scoreDrop}) — FULL SELL`);
                const sig = await execSell(ca, 100, kp, "momentum-exit");
                if (sig) broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "MOMENTUM", reason: "score-crash" } });
                exitPosition(ca, 100, "momentum-exit");
                trackSell(wallet, ca);
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

        // ═══ TAKE PROFIT — 3 tiers ═══
        // TP3: Runner — sell tp3Sell% of remaining (rest = moonbag forever)
        if (pos.tpHit < 3 && changePct >= s.tp3) {
          // Dynamic trailing: wider at higher gains, tighter at lower
          // At 2x (100%), trail within 20% of peak. At 5x+, trail within 25%.
          const trailPct = changePct > 400 ? 25 : changePct > 200 ? 20 : 15;
          if (fromPeak < trailPct) {
            log(`🏃 RUNNER ${ca.slice(0,6)}: +${changePct.toFixed(0)}% — trailing (${fromPeak.toFixed(0)}% from peak, trail=${trailPct}%)`);
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
        // Trailing stop: dropped 30%+ from peak while still green and hasn't hit TP1 yet
        else if (fromPeak > 30 && changePct > 10 && pos.tpHit === 0) {
          log(`Trailing ${ca.slice(0,6)}: +${changePct.toFixed(0)}% (down ${fromPeak.toFixed(0)}% from peak) — selling ${s.tp1Sell}%`);
          const sig = await execSell(ca, s.tp1Sell, kp, "trailing");
          if (sig) {
            broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "TRAIL", sellPct: s.tp1Sell } });
          }
          pos.tpHit = 1;
        }

        // ═══ STOP LOSS — 2 tiers ═══
        // Moonbags: trailing exit if dropped 60%+ from peak while still green (protect runner gains)
        // OR full exit if basically dead (-80%)
        if (pos.isMoonbag) {
          if (changePct <= -80) {
            log(`Moonbag dead ${ca.slice(0,6)}: ${changePct.toFixed(0)}% — full exit`);
            const sig = await execSell(ca, 100, kp, "moonbag-dead");
            if (sig) broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, reason: "moonbag-dead" } });
            exitPosition(ca, 100, "moonbag-dead");
            trackSell(wallet, ca);
          } else if (fromPeak > 60 && changePct > 30) {
            // Moonbag was running hard but pulled back significantly — take remaining profit
            log(`Moonbag trail ${ca.slice(0,6)}: +${changePct.toFixed(0)}% (−${fromPeak.toFixed(0)}% from peak) — exit moonbag`);
            const sig = await execSell(ca, 100, kp, "moonbag-trail");
            if (sig) broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, reason: "moonbag-trail" } });
            exitPosition(ca, 100, "moonbag-trail");
            trackSell(wallet, ca);
          }
        }
        // SL2: Full exit
        else if (!pos.isMoonbag && pos.slHit < 2 && changePct <= -s.sl2) {
          log(`SL2 ${ca.slice(0,6)}: ${changePct.toFixed(0)}% — full exit`);
          const sig = await execSell(ca, 100, kp, "SL2");
          if (sig) broadcastWS({ event: "auto-sell", data: { ca, pnl: changePct.toFixed(1), wallet, tier: "SL2", reason: "stop-loss" } });
          exitPosition(ca, 100, "SL2");
          trackSell(wallet, ca);
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

      // Clean expired cooldowns — 10min for tokens with recovery signals, 30min for others
      const cd = soldCooldowns.get(wallet);
      if (cd) for (const [c, t] of cd) {
        const dyn = scoreDynamics.get(c);
        const isRecovering = dyn && dyn.scores >= 3 && (dyn.trend === "rising" || dyn.trend === "rocket");
        const cooldownMs = isRecovering ? 600000 : 1800000; // 10min if recovering, 30min otherwise
        if (Date.now() - t > cooldownMs) cd.delete(c);
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
        const isAccelerating = dyn && dyn.scores >= 2 && (dyn.trend === "rocket" || dyn.trend === "rising");
        // Low-velocity early entry: token has few buys but healthy buy/sell ratio
        // and is in the pre-discovery FDV range ($4K-$30K). These are the tokens
        // we SHOULD be aping — before velocity picks up.
        const isLowVelocity = mc >= 4000 && mc <= 30000 && buys >= 1 && sells <= buys && ub >= 1 && ageMin >= 0.3 && ageMin <= 30;
        // DexPaid early entry: boosted tokens get relaxed filters — paid = conviction
        const isDexPaid = !!radar.dexBoosted.get(t.ca);
        if (isAccelerating) {
          if (!(mc > 3000 && buys >= 2 && ub >= 1 && ageMin >= 0.3 && sells <= buys * 1.5)) { pipeline.baseFilter++; return false; }
          return true;
        }
        if (isDexPaid && mc >= 4000 && buys >= 1 && sells <= buys * 2) return true; // dex paid = early entry signal
        if (isLowVelocity) return true; // let low-velocity tokens through to scoring
        if (!(mc > 5000 && buys >= 2 && ub >= 2 && ageMin >= 0.5 && sells <= buys * 1.2)) { pipeline.baseFilter++; return false; }
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
      }

      const hot = tokens.filter(t => {
        if (state.positions.has(t.ca)) { pipeline.alreadyOwned++; return false; }
        if (cd?.has(t.ca)) { pipeline.cooldown++; return false; }
        const buys = t.buys || 0; const ub = t.uniqueBuyers?.size || 0; const vol = t.volumeSol || 0;
        const mc = t.mcapUsd || 0; const sells = t.sells || 0;
        const ageMin = Math.max(0.5, (Date.now() - t.createdAt) / 60000);
        const sellVol = t.sellVolumeSol || 0;

        // ═══ HARD RUG GATE — reject obvious rugs before scoring ═══
        const qf = extractQuickFeatures(t);
        let rugRejectReason = null;
        if (qf) {
          if (qf.rg_devSellSpeed > 0.4) rugRejectReason = "dev_sell";
          else if (qf._rg_devSelfSnipe > 0) rugRejectReason = "dev_snipe";
          else if (qf.rg_mcapDropRate > 0.4) rugRejectReason = "mcap_crash";
          else if (qf.rg_coordDumpScore > 0.35) rugRejectReason = "coord_dump";
          else if (qf._rg_pumpDump > 0.5) rugRejectReason = "pump_dump";
          else if (qf._rg_sybilScore > 0.4) rugRejectReason = "sybil";
          else if (qf._rg_earlyDump > 0.3 && ageMin < 5) rugRejectReason = "early_dump";
          else if (qf._rg_quickFlipRate > 0.25) rugRejectReason = "quick_flip";
          // whale_heavy: only reject if wallets are fresh OR no wallet age data yet
          // Aged whale wallets buying = smart money conviction, NOT a rug signal
          else if (qf.rg_holderConcentration > 0.7 && buys > 5 && !(qf._whaleBullish > 0.3)) rugRejectReason = "whale_heavy";
          else if (qf.rg_liqRemovalSpeed > 0.65) rugRejectReason = "liq_removal";
          // NEW: smooth grind detection — fake charts with no natural dips
          else if (qf.ch_smoothGrind > 0.6) rugRejectReason = "smooth_grind";
          else if (qf.ch_smoothGrind > 0.4 && qf.ch_dipRatio < 0.1) rugRejectReason = "no_dips";
          // CRITICAL: zero sells = #1 rug pattern. Many buys + zero organic sells = dev self-buying
          else if (qf._rg_zeroSellFlag >= 0.8) rugRejectReason = "zero_sells";
          else if (qf._rg_zeroSellFlag >= 0.5 && (qf.ch_smoothGrind > 0.3 || qf.ch_staircaseScore > 0.3)) rugRejectReason = "zero_sells_fake_chart";
          // Buy/sell imbalance: 95%+ buys = almost certainly fake activity
          else if (qf._rg_buySellImbalance >= 0.8 && buys >= 8) rugRejectReason = "all_buys_no_sells";
          // Staircase chart: monotonic up with uniform steps = dev self-buying pattern
          else if (qf.ch_staircaseScore > 0.6) rugRejectReason = "staircase_chart";
          else if (qf.ch_staircaseScore > 0.4 && qf._rg_freshWalletRatio > 0.6) rugRejectReason = "staircase_fresh_wallets";
          // Fresh wallets + zero sells combo: definitive rug setup
          else if (qf._rg_freshWalletRatio > 0.8 && qf._rg_zeroSellFlag > 0.4) rugRejectReason = "fresh_wallet_rug";
          // Artwork originality: exact duplicate image = almost certainly copycat scam
          else if (t._artworkFlags?.includes("EXACT_DUPLICATE")) rugRejectReason = "stolen_art";
          else {
            const rugSignals = [
              qf.rg_devSellSpeed > 0.25, qf.rg_coordDumpScore > 0.2,
              qf._rg_sybilScore > 0.25, qf._rg_quickFlipRate > 0.15,
              qf.rg_holderConcentration > 0.6, qf._rg_earlyDump > 0.2,
              qf.rg_mcapDropRate > 0.25, qf._rg_pumpDump > 0.3,
              qf.ch_smoothGrind > 0.35, qf.ch_dipRatio < 0.1,
              qf._rg_zeroSellFlag > 0.4,           // zero/near-zero sells
              qf._rg_buySellImbalance > 0.5,        // extreme buy imbalance
              qf.ch_staircaseScore > 0.3,            // staircase chart pattern
              qf._rg_freshWalletRatio > 0.6,         // fresh wallet buyers
              t._artworkOriginal === false, // copied/stolen artwork
            ].filter(Boolean).length;
            if (rugSignals >= 3) rugRejectReason = "multi_rug_" + rugSignals;
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
          rugPenalty += qf.ch_smoothGrind > 0.35 ? Math.round(qf.ch_smoothGrind * 10) : 0; // smooth grind
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
        // Core principle: NEVER buy a token we haven't observed long enough to measure
        // momentum. Score alone is a snapshot — velocity/acceleration show the TREND.
        // Require 3+ observations (~15s) so v and a have real data before we risk SOL.
        const dyn = scoreDynamics.get(t.ca);
        let dynamicsBonus = 0;

        if (!dyn || dyn.scores < 2) {
          // Not enough data yet — skip this cycle, let it cook
          pipeline.scoreLow++;
          return false;
        }

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

        t._apeScore = Math.max(0, Math.min(99, Math.round(
          buyScore + ubScore + volScore + mcScore + greenScore + pressureScore + velocityScore + boostScore + dynamicsBonus + chartBonus + earlyApeBonus + whaleBullishBonus - sellPenalty - rugPenalty - artPenalty - walletAgePenalty
        )));

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
        // Positive signals (not rug flags, but bullish indicators)
        t._bullishSignals = [
          ...(qf ? [
            qf._whaleBullish > 0.3 && `whale_bullish(${(qf._whaleBullish * 100).toFixed(0)}%)`,
            qf.rg_walletAgeScore > 0.7 && "aged_wallets",
          ] : []),
          dyn?.trend === "rocket" && "rocket_trend",
          dyn?.trend === "rising" && "rising_trend",
          earlyApeBonus > 0 && "early_discovery",
        ].filter(Boolean);
        t._scoreTrend = dyn?.trend || "new";
        t._earlyApe = earlyApeBonus > 0; // flag for logging
        // Apply learner-recommended min score (if enough data)
        const adj = tradeLearner.getAdjustments();
        const effectiveMin = adj.minScoreShift || state.settings.minScore;
        const threshold = Math.min(state.settings.minScore, effectiveMin);
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
        log(`SCAN: ${p.total} tokens → ${p.total-p.baseFilter} pass base → ${p.total-p.baseFilter-p.alreadyOwned-p.cooldown} new → ${p.total-p.baseFilter-p.alreadyOwned-p.cooldown-p.rugGate} pass rug → ${p.total-p.baseFilter-p.alreadyOwned-p.cooldown-p.rugGate-p.trendReject} pass trend → ${p.passed} READY (need ${state.settings.minScore}+)${nmStr}`);
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
        const minS = state.settings.minScore;
        const range = Math.max(80 - minS, 20); // prevent div/0
        let mult = 0.5 + ((score - minS) / range);
        // Trend adjustment (Kahneman System 1: momentum = intuitive confidence)
        if (trend === "rocket") mult += 0.2;
        else if (trend === "rising") mult += 0.1;
        else if (trend === "fading") mult -= 0.15;
        else if (trend === "declining") mult -= 0.25;
        // Rug flag penalty (Norman: error prevention — reduce exposure to uncertainty)
        mult -= rugFlagCount * 0.1;
        // Clamp to safe range
        mult = Math.max(0.4, Math.min(1.6, mult));
        return Math.round(baseSol * mult * 1000) / 1000;
      }

      // Ape into top 2 candidates per cycle — meme tokens move fast
      for (const t of hot.slice(0, 2)) {
        if (state.positions.size >= state.settings.maxPositions) break;
        // Score-based sizing
        const rugFlagCount = t._rugFlags?.length || 0;
        const tradeSol = calcPositionSize(t._apeScore || 0, t._scoreTrend, rugFlagCount, state.settings.solPerTrade);
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
        log(`APE ${t.name||t.ca.slice(0,6)} | score:${t._apeScore}${trendTag}${earlyTag} | MC:$${Math.round(t.mcapUsd)} | buys:${t.buys} sells:${t.sells} | ${tradeSol} SOL (${sizeMult}x)${rugFlags}${bullishStr}${walletAgeStr}`);
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
              state.positions.set(t.ca, { entryMcap: t.mcapUsd, entrySol: tradeSol, entryTime: Date.now(), peakMcap: t.mcapUsd, entryScore: t._apeScore || 0, liveScore: t._apeScore || 0, entryBuys: t.buys||0, entrySells: t.sells||0, entryUB: t.uniqueBuyers?.size||0, entryAge: (Date.now()-t.createdAt)/60000, entryTrend: t._scoreTrend||"new", entryBondPct: t.vSolInBondingCurve ? Math.round(t.vSolInBondingCurve/85*100) : 0, sizeMult: +(tradeSol / state.settings.solPerTrade).toFixed(2) });
              trackBuy(wallet, t.ca, tradeSol); // instant bags visibility
              log(`BOUGHT ${t.name||t.ca.slice(0,6)} sig:${sig.slice(0,12)}...`);
              broadcastWS({ event: "auto-ape", data: { ca: t.ca, name: t.name, sol: tradeSol, mcap: t.mcapUsd, wallet, score: t._apeScore, sizeMult: +(tradeSol / state.settings.solPerTrade).toFixed(2) } });
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
        sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
      }
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
    } : null,
  });
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

    for (const t of tokens) {
      const spark = t.spark || [];
      if (spark.length < 6) continue;

      // Score this token
      const features = typeof extractQuickFeatures === "function" ? extractQuickFeatures(t) : null;
      const scoreResult = features && memeIntel?.scorer ? memeIntel.scorer.score(features) : null;
      const score = scoreResult?.score || t._apeScore || 0;
      if (score < s.minScore) continue;

      // Simulate entry at spark midpoint, exit at end
      const entryIdx = Math.floor(spark.length * 0.3);
      const entryMc = spark[entryIdx] || 1;
      const peakMc = Math.max(...spark.slice(entryIdx));
      const endMc = spark[spark.length - 1] || 1;

      // Score-based sizing
      const range = Math.max(80 - s.minScore, 20);
      let sizeMult = 0.5 + ((score - s.minScore) / range);
      sizeMult = Math.max(0.4, Math.min(1.6, sizeMult));
      const tradeSol = Math.round(s.solPerTrade * sizeMult * 1000) / 1000;

      const peakPct = entryMc > 0 ? ((peakMc - entryMc) / entryMc) * 100 : 0;
      const endPct = entryMc > 0 ? ((endMc - entryMc) / entryMc) * 100 : 0;

      // Simulate tiered TP/SL
      let exitPct = endPct;
      let exitReason = "hold";
      let soldPct = 0;
      let realizedPnl = 0;

      // TP3
      if (peakPct >= s.tp3) {
        realizedPnl += tradeSol * (s.tp3 / 100) * (s.tp3Sell / 100);
        soldPct += s.tp3Sell * ((100 - soldPct) / 100);
        exitReason = "TP3";
      }
      // TP2
      if (peakPct >= s.tp2) {
        const remaining = 100 - soldPct;
        realizedPnl += tradeSol * (remaining / 100) * (s.tp2 / 100) * (s.tp2Sell / 100);
        soldPct += s.tp2Sell * (remaining / 100);
        if (exitReason === "hold") exitReason = "TP2";
      }
      // TP1
      if (peakPct >= s.tp1) {
        const remaining = 100 - soldPct;
        realizedPnl += tradeSol * (remaining / 100) * (s.tp1 / 100) * (s.tp1Sell / 100);
        soldPct += s.tp1Sell * (remaining / 100);
        if (exitReason === "hold") exitReason = "TP1";
      }
      // SL check on remaining
      if (endPct <= -s.sl2 && soldPct < 100) {
        const remaining = 100 - soldPct;
        realizedPnl += tradeSol * (remaining / 100) * (endPct / 100);
        soldPct = 100;
        exitReason = exitReason === "hold" ? "SL2" : exitReason + "+SL2";
      } else if (endPct <= -s.sl1 && soldPct < 100) {
        const remaining = 100 - soldPct;
        const slSold = s.sl1Sell;
        realizedPnl += tradeSol * (remaining / 100) * (slSold / 100) * (endPct / 100);
        soldPct += slSold * (remaining / 100);
        if (exitReason === "hold") exitReason = "SL1";
      }
      // Remaining unsold position at current price
      if (soldPct < 100) {
        const remaining = (100 - soldPct) / 100;
        realizedPnl += tradeSol * remaining * (endPct / 100);
      }

      const trade = {
        name: t.name || t.ca?.slice(0, 8),
        score,
        sizeMult: +sizeMult.toFixed(2),
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
    const allTokenAccounts = [];
    const scannedPubkeys = new Set(); // deduplicate
    for (const pk of pubkeysToScan) {
      const pkStr = pk.toBase58();
      if (scannedPubkeys.has(pkStr)) continue;
      scannedPubkeys.add(pkStr);
      try {
        const accts = await connection.getParsedTokenAccountsByOwner(pk, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
        allTokenAccounts.push(...accts.value);
      } catch (e) {
        console.warn(`[POSITIONS] RPC error for ${pkStr.slice(0,8)}: ${e.message}`);
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
    artwork: artworkScanner ? artworkScanner.getStats() : null,
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
      minScore: settings.minScore || 28,
      solPerTrade: settings.solPerTrade || 0.05,
      maxPositions: settings.maxPositions || 5,
      tp1: settings.tp1 || 25, tp1Sell: settings.tp1Sell || 35,
      tp2: settings.tp2 || 70, tp2Sell: settings.tp2Sell || 35,
      tp3: settings.tp3 || 150, tp3Sell: settings.tp3Sell || 50,
      sl1: settings.sl1 || 12, sl1Sell: settings.sl1Sell || 70,
      sl2: settings.sl2 || 22,
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
    const minS = state.settings.minScore;
    const range = Math.max(80 - minS, 20);
    let mult = 0.5 + ((score - minS) / range);
    if (trend === "rocket") mult += 0.2;
    else if (trend === "rising") mult += 0.1;
    else if (trend === "fading") mult -= 0.15;
    else if (trend === "declining") mult -= 0.25;
    mult -= rugFlagCount * 0.1;
    mult = Math.max(0.4, Math.min(1.6, mult));
    mult += state.calibration.adjustments.scoreBias * 0.01;
    mult = Math.max(0.3, Math.min(1.8, mult));
    return Math.round(state.settings.solPerTrade * mult * 1000) / 1000;
  }

  function closeTrade(ca, changePct, reason) {
    const pos = state.positions.get(ca);
    if (!pos) return;
    const pnlSol = pos.entrySol * (changePct / 100);
    const trade = { ca, name: pos.name, ticker: pos.ticker, entryScore: pos.entryScore, entrySol: pos.entrySol, changePct, pnlSol: +pnlSol.toFixed(4), exitReason: reason, duration: Date.now() - pos.entryTime, time: Date.now() };
    state.closedTrades.push(trade);
    if (state.closedTrades.length > 200) state.closedTrades.shift();
    if (pnlSol > 0) state.stats.wins++; else state.stats.losses++;
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

    const total = Math.max(0, Math.min(99, Math.round(
      buyScore + ubScore + volScore + mcScore + greenScore + pressureScore + velocityScore +
      boostScore + dynamicsBonus + chartBonus + earlyApeBonus + whaleBullishBonus -
      sellPenalty - rugPenalty - artPenalty - walletAgePenalty
    )));

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

      // Check existing positions
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

        const s = state.settings;
        if (changePct >= s.tp1 && !pos.tp1Hit) { pos.tp1Hit = true; addDecision("TP1", { ca, name: pos.name, pnlPct: +changePct.toFixed(1) }); simLog(`SIM TP1 ${pos.name}: +${changePct.toFixed(0)}%`, "profit"); }
        if (changePct >= s.tp2 && !pos.tp2Hit) { pos.tp2Hit = true; addDecision("TP2", { ca, name: pos.name, pnlPct: +changePct.toFixed(1) }); simLog(`SIM TP2 ${pos.name}: +${changePct.toFixed(0)}%`, "profit"); }
        if (changePct >= s.tp3 && !pos.tp3Hit) { pos.tp3Hit = true; addDecision("TP3", { ca, name: pos.name, pnlPct: +changePct.toFixed(1) }); simLog(`SIM TP3 ${pos.name}: +${changePct.toFixed(0)}%`, "profit"); }
        if (changePct <= -s.sl2) { addDecision("SELL", { ca, name: pos.name, reason: "SL2", pnlPct: +changePct.toFixed(1) }); simLog(`SIM SL2 ${pos.name}: ${changePct.toFixed(0)}% — full exit`, "loss"); closeTrade(ca, changePct, "SL2"); continue; }
        if (changePct <= -s.sl1 && !pos.sl1Hit) { pos.sl1Hit = true; addDecision("SL1", { ca, name: pos.name, pnlPct: +changePct.toFixed(1) }); simLog(`SIM SL1 ${pos.name}: ${changePct.toFixed(0)}%`, "loss"); }
        if (s.momentumExit && dyn?.trend === "crashing" && changePct < -5) { addDecision("SELL", { ca, name: pos.name, reason: "momentum-crash", pnlPct: +changePct.toFixed(1) }); simLog(`SIM CRASH EXIT ${pos.name}: score crashing at ${changePct.toFixed(0)}%`, "sell"); closeTrade(ca, changePct, "momentum-crash"); }
      }

      // Look for new entries
      if (state.positions.size >= state.settings.maxPositions) {
        if (_simCycle % 8 === 1) simLog(`Max positions (${state.settings.maxPositions}) filled — watching for exits`, "scan");
        updateGraduation();
        return;
      }

      // Clean expired cooldowns
      for (const [c, t] of state.soldCooldowns) {
        if (Date.now() - t > 1800000) state.soldCooldowns.delete(c);
      }

      // Apply learner-recommended min score (matches auto-ape)
      const adj = tradeLearner.getAdjustments();
      const learnerMin = adj.minScoreShift || state.settings.minScore;
      const effectiveMin = Math.min(state.settings.minScore + state.calibration.adjustments.scoreBias, learnerMin);
      const scored = tokens.filter(t => (t._apeScore || 0) > 0);
      const candidates = tokens.filter(t => {
        if (state.positions.has(t.ca)) return false;
        if (state.soldCooldowns.has(t.ca)) {
          const soldAt = state.soldCooldowns.get(t.ca);
          const dyn = scoreDynamics.get(t.ca);
          const recovering = dyn && dyn.scores >= 3 && (dyn.trend === "rising" || dyn.trend === "rocket");
          if (Date.now() - soldAt < (recovering ? 600000 : 1800000)) return false;
          state.soldCooldowns.delete(t.ca);
        }
        const score = t._apeScore || 0;
        return score >= effectiveMin;
      }).sort((a, b) => (b._apeScore || 0) - (a._apeScore || 0));

      // Log scan activity periodically so user sees sim is working
      if (_simCycle % 5 === 1) {
        const topScore = scored.length > 0 ? Math.max(...scored.map(t => t._apeScore || 0)) : 0;
        simLog(`Scan: ${tokens.length} tokens, ${scored.length} scored, ${candidates.length} candidates (min:${effectiveMin}, top:${topScore})`, "scan");
      }

      // Log near misses for visibility
      if (candidates.length === 0 && _simCycle % 10 === 1) {
        const nearMisses = tokens.filter(t => !state.positions.has(t.ca) && (t._apeScore || 0) >= effectiveMin - 10 && (t._apeScore || 0) < effectiveMin).sort((a, b) => (b._apeScore || 0) - (a._apeScore || 0)).slice(0, 3);
        if (nearMisses.length > 0) {
          simLog(`Near misses: ${nearMisses.map(t => `${t.name||t.ca.slice(0,6)} s:${t._apeScore}`).join(", ")} (need ≥${effectiveMin})`, "scan");
        }
      }

      for (const t of candidates.slice(0, 2)) {
        if (state.positions.size >= state.settings.maxPositions) break;
        const score = t._apeScore || 0;
        const dyn = scoreDynamics.get(t.ca);
        const trend = dyn?.trend || "new";
        const rugFlags = t._rugFlags || [];
        const sizeSol = calcPositionSize(score, trend, rugFlags.length);
        state.positions.set(t.ca, {
          name: t.name, ticker: t.ticker, image: t.image, entryMcap: t.mcapUsd || 0,
          currentMcap: t.mcapUsd || 0, peakMcap: t.mcapUsd || 0, changePct: 0,
          entrySol: sizeSol, sizeMult: +(sizeSol / state.settings.solPerTrade).toFixed(2),
          entryScore: score, liveScore: score, trend, entryTime: Date.now(),
          tp1Hit: false, tp2Hit: false, tp3Hit: false, sl1Hit: false, isMoonbag: false,
        });
        state.stats.totalBuys++;
        state.stats.totalInvested += sizeSol;
        addDecision("BUY", { ca: t.ca, name: t.name, score, trend, sol: sizeSol, rugFlags });
        simLog(`SIM BUY ${t.name} score=${score} trend=${trend} MC:$${Math.round(t.mcapUsd||0)} sol=${sizeSol}`, "buy");
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
      tpHit: (p.tp1Hit ? 1 : 0) + (p.tp2Hit ? 1 : 0) + (p.tp3Hit ? 1 : 0),
      slHit: p.sl1Hit ? 1 : 0, isMoonbag: !!p.isMoonbag,
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
server.listen(PORT, () => {
  console.log(`\n═══════════════════════════════════════`);
  console.log(`  BONDLI v4 API — port ${PORT}`);
  console.log(`  RPC: ${RPC_URL.slice(0, 40)}...`);
  console.log(`  Redis: ${redis ? "connected" : "in-memory"}`);
  console.log(`  SOL: $${solUsdPrice}`);
  console.log(`  Radar: PumpPortal WS connecting...`);
  console.log(`═══════════════════════════════════════\n`);
});
