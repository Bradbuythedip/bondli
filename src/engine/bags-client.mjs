// BONDLI — Bags.fm API Client (Meteora DBC Integration)
//
// Bags.fm: Solana-native launchpad on Meteora DBC
// - Creators earn 1% of all trading volume forever
// - Top 100 holders get automatic 24h dividend payouts
// - Program: dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN
// - Signer: BAGSB9TpGrZxQbEsrEznv5jXXdwyP6AXerN8aVRiAmcv
//
// Base URL: https://public-api-v2.bags.fm/api/v1/
// Auth: x-api-key header
// Rate limit: 1,000 req/hr per user/IP

import CONFIG from "./config.mjs";

const BAGS_BASE = "https://public-api-v2.bags.fm/api/v1";
const BAGS_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const BAGS_SIGNER = "BAGSB9TpGrZxQbEsrEznv5jXXdwyP6AXerN8aVRiAmcv";

// Rate limiter: 1000 req/hr = ~16.6 req/min
const RATE_LIMIT = { count: 0, resetAt: 0, MAX: 950 }; // leave 50 buffer

function checkRateLimit() {
  const now = Date.now();
  if (now > RATE_LIMIT.resetAt) {
    RATE_LIMIT.count = 0;
    RATE_LIMIT.resetAt = now + 3600_000;
  }
  if (RATE_LIMIT.count >= RATE_LIMIT.MAX) {
    throw new Error("[BAGS] Rate limit approaching — request blocked");
  }
  RATE_LIMIT.count++;
}

export class BagsClient {
  constructor(apiKey) {
    this.apiKey = apiKey || CONFIG.BAGS_API_KEY || "";
    this.cache = new Map(); // endpoint → { data, expiry }
    this.CACHE_TTL = 15_000; // 15s default cache
  }

  async _fetch(endpoint, opts = {}) {
    checkRateLimit();

    const url = `${BAGS_BASE}${endpoint}`;
    const cacheKey = opts.method === "GET" || !opts.method ? url : null;

    // Check cache for GET requests
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() < cached.expiry) return cached.data;
    }

    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    const res = await fetch(url, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`[BAGS] ${res.status} ${endpoint}: ${text}`);
    }

    const data = await res.json();

    // Cache GET responses
    if (cacheKey) {
      this.cache.set(cacheKey, { data, expiry: Date.now() + (opts.cacheTtl || this.CACHE_TTL) });
    }

    return data;
  }

  // ═══ TOKEN DISCOVERY ═══

  // Get trending/new Bags token launches
  async getTokens(opts = {}) {
    const params = new URLSearchParams();
    if (opts.sort) params.set("sort", opts.sort); // "newest", "trending", "volume"
    if (opts.limit) params.set("limit", opts.limit);
    if (opts.offset) params.set("offset", opts.offset);
    const qs = params.toString();
    return this._fetch(`/tokens${qs ? "?" + qs : ""}`, { cacheTtl: 10_000 });
  }

  // Get a specific token by mint address
  async getToken(mint) {
    return this._fetch(`/tokens/${mint}`, { cacheTtl: 10_000 });
  }

  // Get token holders (for holder analysis)
  async getHolders(mint, opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", opts.limit);
    return this._fetch(`/tokens/${mint}/holders?${params}`, { cacheTtl: 30_000 });
  }

  // Get token trades (for volume legitimacy analysis)
  async getTrades(mint, opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", opts.limit);
    if (opts.offset) params.set("offset", opts.offset);
    return this._fetch(`/tokens/${mint}/trades?${params}`, { cacheTtl: 5_000 });
  }

  // ═══ TRADE EXECUTION ═══

  // Execute a trade on a Bags token via Meteora DBC
  async trade(opts) {
    return this._fetch("/trade", {
      method: "POST",
      body: {
        mint: opts.mint,
        wallet: opts.wallet,
        side: opts.side, // "buy" | "sell"
        amount: opts.amount, // SOL for buy, tokens for sell
        slippage: opts.slippage || CONFIG.SLIPPAGE_BPS / 100,
        signedTransaction: opts.signedTx, // base64 signed tx
      },
    });
  }

  // Get a trade quote (preview before execution)
  async getQuote(mint, side, amount) {
    return this._fetch("/trade/quote", {
      method: "POST",
      body: { mint, side, amount },
    });
  }

  // ═══ TOKEN LAUNCH ═══

  // Launch a new token on Bags.fm (Meteora DBC)
  async launchToken(opts) {
    return this._fetch("/token-launch", {
      method: "POST",
      body: {
        name: opts.name,
        symbol: opts.symbol,
        description: opts.description,
        image: opts.image, // base64 or URL
        twitter: opts.twitter,
        telegram: opts.telegram,
        website: opts.website,
        wallet: opts.wallet,
        signedTransaction: opts.signedTx,
      },
    });
  }

  // ═══ FEE-SHARING (HACKATHON KEY INTEGRATION) ═══

  // Configure fee distribution for a Bags token
  async configureFeeShare(opts) {
    return this._fetch("/fee-share/config", {
      method: "POST",
      body: {
        mint: opts.mint,
        wallet: opts.wallet,
        feeRecipients: opts.recipients, // [{ wallet, share }]
        signedTransaction: opts.signedTx,
      },
    });
  }

  // Get claimable fees for a wallet
  async getClaimableFees(wallet) {
    return this._fetch(`/token-launch/claimable-positions?wallet=${wallet}`, { cacheTtl: 60_000 });
  }

  // Claim accrued fees
  async claimFees(opts) {
    return this._fetch("/token-launch/claim", {
      method: "POST",
      body: {
        wallet: opts.wallet,
        positions: opts.positions, // array of position IDs
        signedTransaction: opts.signedTx,
      },
    });
  }

  // Get fee-share info for a wallet (partner key)
  async getFeeShareWallet(wallet) {
    return this._fetch(`/token-launch/fee-share/wallet/v2?wallet=${wallet}`, { cacheTtl: 120_000 });
  }

  // ═══ BAGS TOKEN MONITOR ═══

  // Poll for new Bags launches and normalize to Bondli token format
  async pollNewLaunches(since = 0) {
    const tokens = await this.getTokens({ sort: "newest", limit: 50 });
    if (!Array.isArray(tokens)) return [];

    return tokens
      .filter(t => (t.createdAt || 0) > since)
      .map(t => this._normalizeToBondli(t));
  }

  // Normalize Bags token data to match Bondli's token format
  // This lets the scoring engine treat Bags and PumpFun tokens identically
  _normalizeToBondli(bagsToken) {
    const t = bagsToken;
    return {
      ca: t.mint || t.address,
      name: t.name || "",
      ticker: t.symbol || "",
      description: t.description || "",
      image: t.image || t.imageUri || "",
      twitter: t.twitter || "",
      telegram: t.telegram || "",
      website: t.website || "",
      devWallet: t.creator || t.deployer || "",
      priceUsd: t.priceUsd || 0,
      mcapUsd: t.marketCap || t.mcapUsd || 0,
      volume24h: t.volume24h || 0,
      volumeSol: t.volumeSol || 0,
      liquidity: t.liquidity || 0,
      change5m: t.priceChange5m || 0,
      change1h: t.priceChange1h || 0,
      change24h: t.priceChange24h || 0,
      buys: t.buys || t.buyCount || 0,
      sells: t.sells || t.sellCount || 0,
      uniqueBuyers: t.uniqueBuyers || 0,
      pairCreated: t.createdAt ? new Date(t.createdAt).getTime() : Date.now(),
      createdAt: t.createdAt ? new Date(t.createdAt).getTime() : Date.now(),
      // Bags-specific fields
      _source: "bags",
      _bagsCreatorFee: 0.01, // 1% perpetual creator royalty
      _bagsDividends: t.dividendsEnabled || true,
      _bagsHolderCount: t.holderCount || 0,
      _meteoraDBC: true, // Meteora DBC, NOT pump.fun bonding curve
      _bagsRaw: t, // preserve original for Bags-specific logic
    };
  }

  // ═══ FEE SWEEP AUTOMATION ═══

  // Auto-sweep claimable fees every N hours (called by orchestrator)
  async sweepFees(wallet) {
    try {
      const claimable = await this.getClaimableFees(wallet);
      if (!claimable?.positions?.length) return { swept: false, reason: "nothing_claimable" };

      const totalClaimable = claimable.positions.reduce((s, p) => s + (p.claimableAmount || 0), 0);
      if (totalClaimable < 0.001) return { swept: false, reason: "dust_amount", amount: totalClaimable };

      console.log(`[BAGS] Sweeping ${totalClaimable.toFixed(4)} SOL from ${claimable.positions.length} positions`);

      // Note: actual claiming requires signed tx from wallet
      return {
        swept: true,
        positions: claimable.positions.length,
        totalSol: totalClaimable,
        positionIds: claimable.positions.map(p => p.id),
      };
    } catch (e) {
      console.error(`[BAGS] Fee sweep error: ${e.message}`);
      return { swept: false, reason: "error", error: e.message };
    }
  }

  // Check if a mint is a Bags token (Meteora DBC program)
  async isBagsToken(mint) {
    try {
      const token = await this.getToken(mint);
      return !!token && token.program === BAGS_PROGRAM;
    } catch {
      return false;
    }
  }

  // Get rate limit status
  getRateLimitStatus() {
    return {
      used: RATE_LIMIT.count,
      max: RATE_LIMIT.MAX,
      remaining: RATE_LIMIT.MAX - RATE_LIMIT.count,
      resetsAt: RATE_LIMIT.resetAt,
    };
  }
}

export { BAGS_BASE, BAGS_PROGRAM, BAGS_SIGNER };
export default BagsClient;
