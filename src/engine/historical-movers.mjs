// BONDLI — Historical Movers Engine
// Fetches top-performing pump.fun tokens from DexScreener + Birdeye
// Caches in Redis with TTL to avoid rate limits

const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY || "";
const CACHE_TTL = 600; // 10 min
const DEXSCREENER_BASE = "https://api.dexscreener.com";
const BIRDEYE_BASE = "https://public-api.birdeye.so";

// ── Helpers ──
async function jfetch(url, headers = {}, timeout = 10000) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

function birdHeaders() {
  return BIRDEYE_KEY
    ? { "X-API-KEY": BIRDEYE_KEY, Accept: "application/json" }
    : { Accept: "application/json" };
}

// ── DexScreener: top boosted tokens on Solana ──
async function fetchDexScreenerBoosted() {
  const d = await jfetch(`${DEXSCREENER_BASE}/token-boosts/top/v1`);
  if (!d || !Array.isArray(d)) return [];
  return d
    .filter(t => t.chainId === "solana" && t.url?.includes("pump.fun"))
    .slice(0, 30)
    .map(t => ({
      ca: t.tokenAddress,
      name: t.description || t.tokenAddress?.slice(0, 8),
      url: t.url,
      icon: t.icon,
      header: t.header,
      totalAmount: t.totalAmount || 0,
      source: "dexscreener-boost",
    }));
}

// ── DexScreener: search pump.fun graduated tokens by volume ──
async function fetchDexScreenerGraduated() {
  const d = await jfetch(`${DEXSCREENER_BASE}/latest/dex/search?q=pump.fun%20raydium`);
  if (!d?.pairs) return [];
  // Deduplicate pairs by base token address — keep the highest volume pair per token
  const byToken = new Map();
  for (const p of d.pairs) {
    if (p.chainId !== "solana" || !p.fdv || p.fdv <= 50000) continue;
    const ca = p.baseToken?.address;
    if (!ca) continue;
    const existing = byToken.get(ca);
    if (!existing || (p.volume?.h24 || 0) > (existing.volume?.h24 || 0)) {
      byToken.set(ca, p);
    }
  }
  return [...byToken.values()]
    .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
    .slice(0, 30)
    .map(p => ({
      ca: p.baseToken?.address,
      name: p.baseToken?.name || "?",
      ticker: p.baseToken?.symbol || "?",
      priceUsd: parseFloat(p.priceUsd || 0),
      mcapUsd: p.fdv || 0,
      volume24h: p.volume?.h24 || 0,
      change24h: p.priceChange?.h24 || 0,
      change6h: p.priceChange?.h6 || 0,
      change1h: p.priceChange?.h1 || 0,
      liquidity: p.liquidity?.usd || 0,
      pairCreated: p.pairCreatedAt,
      dexUrl: p.url,
      image: p.info?.imageUrl || null,
      source: "dexscreener-graduated",
    }));
}

// ── Birdeye: trending tokens on Solana ──
async function fetchBirdeyeTrending() {
  const d = await jfetch(
    `${BIRDEYE_BASE}/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=30`,
    birdHeaders()
  );
  if (!d?.data?.tokens) return [];
  return d.data.tokens.map(t => ({
    ca: t.address,
    name: t.name || "?",
    ticker: t.symbol || "?",
    priceUsd: t.price || 0,
    mcapUsd: t.mc || 0,
    volume24h: t.v24hUSD || 0,
    change24h: t.v24hChangePercent || 0,
    liquidity: t.liquidity || 0,
    image: t.logoURI || null,
    source: "birdeye-trending",
  }));
}

// ── Birdeye: top gainers ──
async function fetchBirdeyeGainers(timeframe = "24h") {
  const d = await jfetch(
    `${BIRDEYE_BASE}/defi/token_list?sort_by=v${timeframe}ChangePercent&sort_type=desc&offset=0&limit=30&min_liquidity=10000`,
    birdHeaders()
  );
  if (!d?.data?.tokens) return [];
  return d.data.tokens.map(t => ({
    ca: t.address,
    name: t.name || "?",
    ticker: t.symbol || "?",
    priceUsd: t.price || 0,
    mcapUsd: t.mc || 0,
    volume24h: t.v24hUSD || 0,
    change24h: t.v24hChangePercent || 0,
    liquidity: t.liquidity || 0,
    image: t.logoURI || null,
    source: `birdeye-gainers-${timeframe}`,
  }));
}

// ── DexScreener: token price history ──
async function fetchTokenHistory(ca) {
  const d = await jfetch(`${DEXSCREENER_BASE}/latest/dex/tokens/${ca}`);
  if (!d?.pairs?.length) return null;
  const p = d.pairs[0];
  return {
    ca,
    name: p.baseToken?.name || "?",
    ticker: p.baseToken?.symbol || "?",
    priceUsd: parseFloat(p.priceUsd || 0),
    mcapUsd: p.fdv || 0,
    volume24h: p.volume?.h24 || 0,
    change5m: p.priceChange?.m5 || 0,
    change1h: p.priceChange?.h1 || 0,
    change6h: p.priceChange?.h6 || 0,
    change24h: p.priceChange?.h24 || 0,
    liquidity: p.liquidity?.usd || 0,
    pairCreated: p.pairCreatedAt,
    txns24h: p.txns?.h24 || {},
    dexUrl: p.url,
    image: p.info?.imageUrl || null,
  };
}

// ── Main aggregator ──
export class HistoricalMovers {
  constructor(redis) {
    this.redis = redis;
    this._cache = {};  // in-memory fallback if no redis
  }

  async _getCached(key) {
    if (this.redis) {
      try { const v = await this.redis.get(key); return v ? JSON.parse(v) : null; } catch { return null; }
    }
    const c = this._cache[key];
    if (c && Date.now() - c.ts < CACHE_TTL * 1000) return c.data;
    return null;
  }

  async _setCache(key, data) {
    if (this.redis) {
      try { await this.redis.set(key, JSON.stringify(data), { EX: CACHE_TTL }); } catch {}
    }
    this._cache[key] = { data, ts: Date.now() };
  }

  async getMovers(timeframe = "24h") {
    const cacheKey = `movers:${timeframe}`;
    const cached = await this._getCached(cacheKey);
    if (cached) return cached;

    // Fetch from multiple sources in parallel
    const [boosted, graduated, trending, gainers] = await Promise.all([
      fetchDexScreenerBoosted().catch(() => []),
      fetchDexScreenerGraduated().catch(() => []),
      BIRDEYE_KEY ? fetchBirdeyeTrending().catch(() => []) : [],
      BIRDEYE_KEY ? fetchBirdeyeGainers(timeframe).catch(() => []) : [],
    ]);

    // Deduplicate by CA, prefer the richer record
    const seen = new Map();
    for (const list of [gainers, graduated, trending, boosted]) {
      for (const t of list) {
        if (!t.ca) continue;
        const existing = seen.get(t.ca);
        if (!existing || (t.mcapUsd && !existing.mcapUsd)) {
          seen.set(t.ca, { ...existing, ...t });
        }
      }
    }

    // Helper: deduplicate an array by CA, skip tokens already used in prior sections
    const usedCAs = new Set();
    const dedup = (arr, limit) => {
      const out = [];
      for (const t of arr) {
        if (!t.ca || usedCAs.has(t.ca)) continue;
        usedCAs.add(t.ca);
        out.push(seen.get(t.ca) || t);
        if (out.length >= limit) break;
      }
      return out;
    };

    const topGainers = dedup(
      [...seen.values()]
        .filter(t => t.change24h > 0 && t.mcapUsd > 0)
        .sort((a, b) => (b.change24h || 0) - (a.change24h || 0)),
      25
    );

    const result = {
      topGainers,
      hotGraduated: dedup(graduated.filter(t => t.mcapUsd > 50000), 25),
      trending: dedup(trending, 25),
      boosted: dedup(boosted, 15),
      updatedAt: Date.now(),
    };

    await this._setCache(cacheKey, result);
    return result;
  }

  async getTokenDetail(ca) {
    const cacheKey = `mover:${ca}`;
    const cached = await this._getCached(cacheKey);
    if (cached) return cached;

    const detail = await fetchTokenHistory(ca);
    if (detail) await this._setCache(cacheKey, detail);
    return detail;
  }
}
