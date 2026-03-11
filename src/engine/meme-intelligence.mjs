/**
 * ═══════════════════════════════════════════════════════════════
 * MEME INTELLIGENCE ENGINE — Self-Evolving Token Scoring
 * ═══════════════════════════════════════════════════════════════
 *
 * Hybrid architecture:
 *   1. RAG Memory   — vector similarity to past tokens + outcomes
 *   2. Online ML    — streaming model updates on every label
 *   3. Rule Engine  — Tipping Point + System 1/2 heuristics
 *
 * Feedback loop:
 *   Token appears → extract features → score → monitor outcome
 *   → auto-label (graduated? MC multiple? fleet P&L?) → learn
 *   → next token scored better
 *
 * Integration:
 *   const intel = new MemeIntelligence(redis);
 *   // On radar token:
 *   const score = await intel.score(tokenData);
 *   // On outcome (cron or webhook):
 *   await intel.labelOutcome(ca, { graduated: true, peakMcx: 12.5, fleetPnl: 3.2 });
 */

// ═══ FEATURE EXTRACTION ═══
// Converts raw token data into a normalized feature vector

const FEATURE_KEYS = [
  // Tipping Point framework
  "tp_lawOfFew",        // whale concentration in first 50 buys (0-1)
  "tp_stickiness",      // meme phrase memorability score (0-1)
  "tp_context",         // trending topic match (0-1)
  "tp_connectorScore",  // are known influencer wallets buying? (0-1)
  "tp_mavenScore",      // are known alpha wallets buying? (0-1)
  "tp_salesmanScore",   // viral retweet velocity proxy (0-1)

  // System 1/2 (Kahneman)
  "k_cognitiveEase",    // name simplicity + pronounceability (0-1)
  "k_emotionalValence", // humor/outrage/surprise density (0-1)
  "k_anchorBias",       // round-number MC proximity ($1M, $10M) (0-1)
  "k_herdSignal",       // buy count acceleration (0-1)
  "k_lossAversion",     // sell pressure ratio (inverse = bullish) (0-1)
  "k_framingEffect",    // description sentiment polarity (0-1)

  // On-chain velocity
  "oc_buyVelocity1m",   // buys per minute in first minute
  "oc_buyVelocity5m",   // buys per minute in first 5 min
  "oc_uniqueBuyers5m",  // unique wallets buying in 5 min
  "oc_giniCoeff",       // Gini of buy sizes (0=equal, 1=one whale)
  "oc_avgBuySol",       // average buy size in SOL
  "oc_devHoldPct",      // dev wallet hold percentage
  "oc_topHolderPct",    // top 10 holder concentration
  "oc_sellRatio5m",     // sells/buys ratio in 5 min (lower = bullish)
  "oc_mcapSol",         // current mcap in SOL
  "oc_volumeSol5m",     // total volume in SOL first 5 min

  // Social signals
  "so_hasTwitter",      // 0 or 1
  "so_hasTelegram",     // 0 or 1
  "so_hasWebsite",      // 0 or 1
  "so_nameLength",      // character count normalized
  "so_tickerLength",    // ticker length normalized
  "so_hasEmoji",        // name/desc contains emoji
  "so_descLength",      // description length normalized

  // Rug Detection (on-chain patterns)
  "rg_devSellSpeed",    // how fast dev sells after launch (0=held, 1=instant dump)
  "rg_holderConcentration", // top 5 wallets % over time (high = rug risk)
  "rg_coordDumpScore",  // coordinated sell pattern detection (0-1)
  "rg_liqRemovalSpeed", // liquidity drain velocity (0=stable, 1=rapid drain)
  "rg_walletAgeScore",  // avg buyer wallet age (0=fresh wallets, 1=aged)
  "rg_sellWaveDetect",  // detection of sell waves (multiple sells in rapid succession)
  "rg_mcapDropRate",    // mcap drop rate from peak (0=stable, 1=crashed)
  "rg_buyerRetention",  // % of early buyers still holding (0=all dumped, 1=all held)

  // Chart shape analysis
  "ch_healthScore",     // overall chart health (0=crash, 0.5=neutral, 1=healthy growth)
  "ch_pumpDump",        // pump-and-dump pattern detection (0=none, 1=classic p&d)
  "ch_smoothGrind",     // gradual up with no dips — likely fake/self-bought chart (0=normal, 1=suspiciously smooth)
  "ch_dipRatio",        // ratio of dip candles vs up candles (0=no dips at all, 1=many dips = healthy)

  // Meta
  "mt_hourOfDay",       // 0-23 normalized to 0-1
  "mt_dayOfWeek",       // 0-6 normalized to 0-1
  "mt_isWeekend",       // 0 or 1
];

function extractFeatures(token) {
  const f = {};
  const t = token || {};
  const trades = t.recentTrades || [];
  const buys = trades.filter(tr => tr.side === "buy" || tr.txType === "buy");
  const sells = trades.filter(tr => tr.side === "sell" || tr.txType === "sell");

  // ─── Tipping Point ───
  // Law of the Few: are a few wallets dominating buys?
  const buyAmounts = buys.map(b => b.solAmount || b.sol || 0);
  f.tp_lawOfFew = gini(buyAmounts);

  // Stickiness: how memorable is the name/ticker?
  const name = (t.name || "").toLowerCase();
  const ticker = (t.ticker || "").toLowerCase();
  const stickyWords = ["doge", "pepe", "shib", "moon", "elon", "trump", "cat", "dog", "frog", "inu", "ai", "gpt", "sol", "bonk", "wojak", "chad", "based", "sigma", "rizz", "skibidi"];
  const stickyHits = stickyWords.filter(w => name.includes(w) || ticker.includes(w)).length;
  f.tp_stickiness = Math.min(1, stickyHits * 0.25 + (ticker.length <= 4 ? 0.2 : 0) + (name.length <= 10 ? 0.1 : 0));

  // Context: time-based (memecoins do better in US evening hours)
  const hour = new Date().getUTCHours();
  const usEveningBoost = (hour >= 22 || hour <= 4) ? 0.3 : (hour >= 14 && hour <= 21) ? 0.2 : 0;
  f.tp_context = usEveningBoost + (t.trendingMatch ? 0.5 : 0);

  // Connector/Maven/Salesman (placeholder — needs wallet labeling DB)
  f.tp_connectorScore = t.knownInfluencerBuys ? Math.min(1, t.knownInfluencerBuys * 0.2) : 0;
  f.tp_mavenScore = t.knownAlphaBuys ? Math.min(1, t.knownAlphaBuys * 0.15) : 0;
  f.tp_salesmanScore = t.retweetVelocity ? Math.min(1, t.retweetVelocity / 50) : 0;

  // ─── System 1/2 (Kahneman) ───
  // Cognitive ease: short, pronounceable, familiar patterns
  const vowels = (name.match(/[aeiou]/gi) || []).length;
  const consonants = (name.match(/[bcdfghjklmnpqrstvwxyz]/gi) || []).length;
  const ratio = vowels / Math.max(1, consonants);
  f.k_cognitiveEase = Math.min(1, (ratio > 0.3 && ratio < 1.5 ? 0.4 : 0) + (name.length <= 8 ? 0.3 : 0) + (ticker.length <= 5 ? 0.3 : 0));

  // Emotional valence: does description trigger emotion?
  const desc = (t.description || "").toLowerCase();
  const emotionWords = ["moon", "rich", "millionaire", "retire", "lambo", "100x", "1000x", "degen", "ape", "send", "pump", "gem", "alpha", "insane", "crazy", "fk", "shit", "holy"];
  const emotionHits = emotionWords.filter(w => desc.includes(w) || name.includes(w)).length;
  f.k_emotionalValence = Math.min(1, emotionHits * 0.15);

  // Anchor bias: proximity to round MC numbers
  const mcap = t.mcapUsd || t.mcapSol * 140 || 0;
  const anchors = [100000, 500000, 1000000, 5000000, 10000000];
  const closestAnchor = anchors.reduce((a, b) => Math.abs(b - mcap) < Math.abs(a - mcap) ? b : a);
  f.k_anchorBias = mcap > 0 ? Math.max(0, 1 - Math.abs(mcap - closestAnchor) / closestAnchor) : 0;

  // Herd signal: buy acceleration
  const recentBuys = buys.slice(-20);
  const olderBuys = buys.slice(-40, -20);
  f.k_herdSignal = olderBuys.length > 0 ? Math.min(1, recentBuys.length / Math.max(1, olderBuys.length) / 3) : 0;

  // Loss aversion (inverse sell pressure = bullish)
  f.k_lossAversion = buys.length > 0 ? Math.max(0, 1 - sells.length / Math.max(1, buys.length)) : 0.5;

  // Framing effect
  const positiveWords = ["guaranteed", "easy", "free", "win", "profit", "safe", "community"];
  f.k_framingEffect = Math.min(1, positiveWords.filter(w => desc.includes(w)).length * 0.2);

  // ─── On-chain velocity ───
  f.oc_buyVelocity1m = Math.min(1, (t.buys1m || buys.length) / 30);
  f.oc_buyVelocity5m = Math.min(1, (t.buys5m || buys.length) / 100);
  f.oc_uniqueBuyers5m = Math.min(1, (t.uniqueBuyers || new Set(buys.map(b => b.wallet)).size) / 50);
  f.oc_giniCoeff = gini(buyAmounts);
  f.oc_avgBuySol = buyAmounts.length > 0 ? Math.min(1, avg(buyAmounts) / 2) : 0;
  f.oc_devHoldPct = Math.min(1, (t.devHoldPct || 0) / 100);
  f.oc_topHolderPct = Math.min(1, (t.topHolderPct || 0) / 100);
  f.oc_sellRatio5m = buys.length > 0 ? Math.min(1, sells.length / Math.max(1, buys.length)) : 0.5;
  f.oc_mcapSol = Math.min(1, (t.mcapSol || 0) / 500);
  f.oc_volumeSol5m = Math.min(1, (t.volumeSol5m || sum(buyAmounts)) / 50);

  // ─── Social ───
  f.so_hasTwitter = t.twitter ? 1 : 0;
  f.so_hasTelegram = t.telegram ? 1 : 0;
  f.so_hasWebsite = t.website ? 1 : 0;
  f.so_nameLength = Math.min(1, name.length / 20);
  f.so_tickerLength = Math.min(1, ticker.length / 10);
  f.so_hasEmoji = /[\u{1F600}-\u{1F9FF}]/u.test(t.name || "") ? 1 : 0;
  f.so_descLength = Math.min(1, (t.description || "").length / 200);

  // ─── Rug Detection (on-chain patterns) ───
  const ageMs = Date.now() - (t.createdAt || Date.now());
  const ageMin = Math.max(1, ageMs / 60000);

  // Dev sell speed: did the dev wallet sell quickly?
  const devWallet = t.devWallet || "";
  const devSells = sells.filter(s => (s.wallet || "").startsWith(devWallet.slice(0, 8)));
  if (devSells.length > 0 && ageMin > 0) {
    const firstDevSellAge = devSells[0]?.time ? (devSells[0].time - (t.createdAt || Date.now())) / 60000 : ageMin;
    f.rg_devSellSpeed = Math.min(1, Math.max(0, 1 - firstDevSellAge / 30)); // sold within 30min = high risk
  } else {
    f.rg_devSellSpeed = 0; // no dev sell = good
  }

  // Holder concentration: top wallets holding too much
  const walletBuys = {};
  buys.forEach(b => {
    const w = b.wallet || "unknown";
    walletBuys[w] = (walletBuys[w] || 0) + (b.solAmount || b.sol || 0);
  });
  const sortedHolders = Object.values(walletBuys).sort((a, b) => b - a);
  const totalBought = sum(sortedHolders);
  const top5Pct = totalBought > 0 ? sum(sortedHolders.slice(0, 5)) / totalBought : 0;
  f.rg_holderConcentration = Math.min(1, top5Pct);

  // Coordinated dump: multiple sells within a narrow time window
  const sellTimes = sells.map(s => s.time || 0).filter(t => t > 0).sort((a, b) => a - b);
  let coordDumps = 0;
  for (let i = 1; i < sellTimes.length; i++) {
    if (sellTimes[i] - sellTimes[i - 1] < 3000) coordDumps++; // sells within 3 seconds
  }
  f.rg_coordDumpScore = sells.length > 2 ? Math.min(1, coordDumps / Math.max(1, sells.length - 1)) : 0;

  // Liquidity removal speed: volume of sells vs buys in recent window
  const recentSells = sells.slice(-10);
  const recentBuysSol = sum(buys.slice(-10).map(b => b.solAmount || b.sol || 0));
  const recentSellsSol = sum(recentSells.map(s => s.solAmount || s.sol || 0));
  f.rg_liqRemovalSpeed = recentBuysSol > 0 ? Math.min(1, recentSellsSol / Math.max(0.01, recentBuysSol)) : 0;

  // Wallet age score: fresh wallets = higher rug risk (uses uniqueBuyers count as proxy)
  const uniqueWallets = new Set(buys.map(b => b.wallet)).size;
  const buyCount = buys.length;
  const walletReuse = buyCount > 0 ? 1 - (uniqueWallets / Math.max(1, buyCount)) : 0;
  f.rg_walletAgeScore = Math.min(1, walletReuse); // high reuse = suspicious

  // Sell wave detection: bursts of sells
  let maxSellBurst = 0;
  for (let i = 0; i < sellTimes.length; i++) {
    let burst = 1;
    for (let j = i + 1; j < sellTimes.length && sellTimes[j] - sellTimes[i] < 10000; j++) {
      burst++;
    }
    maxSellBurst = Math.max(maxSellBurst, burst);
  }
  f.rg_sellWaveDetect = Math.min(1, maxSellBurst / 8); // 8+ sells in 10s = max risk

  // Mcap drop rate from peak
  const spark = t.spark || [];
  if (spark.length > 2) {
    const peakMcap = Math.max(...spark);
    const currentMcap = spark[spark.length - 1] || 0;
    f.rg_mcapDropRate = peakMcap > 0 ? Math.min(1, Math.max(0, 1 - currentMcap / peakMcap)) : 0;
  } else {
    f.rg_mcapDropRate = 0;
  }

  // Buyer retention: are early buyers still around (proxy: sell count vs buy count for early wallets)
  const earlyBuyers = new Set(buys.slice(0, 20).map(b => b.wallet));
  const earlyBuyerSells = sells.filter(s => earlyBuyers.has(s.wallet)).length;
  f.rg_buyerRetention = earlyBuyers.size > 0 ? Math.max(0, 1 - earlyBuyerSells / earlyBuyers.size) : 0.5;

  // ─── Chart shape analysis: gradual-up-no-dips detection ───
  const spark = t.spark || [];
  if (spark.length >= 5) {
    // Count dips: a "dip" is when spark[i] < spark[i-1]
    let dips = 0;
    let ups = 0;
    let maxConsecutiveUp = 0;
    let consecutiveUp = 0;
    let totalDelta = 0;
    for (let i = 1; i < spark.length; i++) {
      const delta = spark[i] - spark[i - 1];
      totalDelta += Math.abs(delta);
      if (delta < 0) {
        dips++;
        consecutiveUp = 0;
      } else if (delta > 0) {
        ups++;
        consecutiveUp++;
        maxConsecutiveUp = Math.max(maxConsecutiveUp, consecutiveUp);
      }
    }
    const totalMoves = dips + ups;
    // dipRatio: healthy charts have 30-50% dips. 0 dips = suspicious.
    f.ch_dipRatio = totalMoves > 0 ? Math.min(1, dips / totalMoves * 2) : 0;
    // smoothGrind: detects fake charts — long consecutive uptrends + very few dips
    // Real charts ALWAYS have dips. A chart with 80%+ up candles is almost certainly self-bought.
    const upPct = totalMoves > 0 ? ups / totalMoves : 0;
    const isLong = spark.length >= 8;
    const isGrowing = spark[spark.length - 1] > spark[0] * 1.3;
    // High smoothGrind = suspicious: many consecutive ups, very few dips, growing
    if (isLong && isGrowing && upPct > 0.85 && maxConsecutiveUp >= 6) {
      f.ch_smoothGrind = Math.min(1, 0.5 + (upPct - 0.85) * 3 + (maxConsecutiveUp - 6) * 0.05);
    } else if (isLong && isGrowing && upPct > 0.75 && maxConsecutiveUp >= 5) {
      f.ch_smoothGrind = Math.min(0.6, 0.3 + (upPct - 0.75) * 2);
    } else {
      f.ch_smoothGrind = 0;
    }
    // Chart health from meme-intelligence
    const start = spark[0] || 1;
    const peakVal = Math.max(...spark);
    const current = spark[spark.length - 1] || 0;
    const peakIdx = spark.indexOf(peakVal);
    const peakPct = peakIdx / spark.length;
    const multiple = peakVal / start;
    const endRatio = current / (peakVal || 1);
    // Healthy: steady growth with dips, peak late, holding value
    if (multiple > 2 && peakPct > 0.5 && endRatio > 0.4 && dips >= 2) {
      f.ch_healthScore = Math.min(1, 0.6 + multiple * 0.05);
    } else if (peakPct < 0.3 && endRatio < 0.2) {
      f.ch_healthScore = Math.max(0, 0.2);
    } else if (current > start && multiple < 3) {
      f.ch_healthScore = 0.6;
    } else {
      f.ch_healthScore = 0.5;
    }
    // Pump-dump: sharp peak early then crash
    if (multiple > 5 && peakPct < 0.35 && endRatio < 0.25) {
      f.ch_pumpDump = Math.min(1, 0.5 + (1 - endRatio) * 0.3 + (1 - peakPct) * 0.2);
    } else {
      f.ch_pumpDump = 0;
    }
    // penalize smooth grinds in health score — they look good but are fake
    if (f.ch_smoothGrind > 0.5) {
      f.ch_healthScore = Math.max(0, f.ch_healthScore - f.ch_smoothGrind * 0.4);
    }
  } else {
    f.ch_healthScore = 0.5;
    f.ch_pumpDump = 0;
    f.ch_smoothGrind = 0;
    f.ch_dipRatio = 0.5;
  }

  // ─── Meta ───
  const now = new Date();
  f.mt_hourOfDay = now.getUTCHours() / 23;
  f.mt_dayOfWeek = now.getUTCDay() / 6;
  f.mt_isWeekend = (now.getUTCDay() === 0 || now.getUTCDay() === 6) ? 1 : 0;

  return f;
}

// ═══ PRE-COMPUTED LOOKUP TABLES ═══
// Built once at module load — eliminates string splits and array filters from hot path

const GROUP_FOR_KEY = {};      // "tp_lawOfFew" → "tp"
const KEYS_BY_GROUP = {};      // "tp" → ["tp_lawOfFew", ...]
const KEY_INDEX = {};          // "tp_lawOfFew" → 0 (position in FEATURE_KEYS)
for (let i = 0; i < FEATURE_KEYS.length; i++) {
  const k = FEATURE_KEYS[i];
  const g = k.substring(0, k.indexOf("_")); // faster than split("_")[0]
  GROUP_FOR_KEY[k] = g;
  KEY_INDEX[k] = i;
  if (!KEYS_BY_GROUP[g]) KEYS_BY_GROUP[g] = [];
  KEYS_BY_GROUP[g].push(k);
}
const GROUP_NAMES = Object.keys(KEYS_BY_GROUP); // ["tp","k","oc","rg","so","mt"]

// ═══ SCORING ENGINE ═══
// Combines rule-based frameworks + learned weights

class ScoringEngine {
  constructor() {
    // Initial weights (Tipping Point framework emphasis)
    this.weights = {};
    FEATURE_KEYS.forEach(k => { this.weights[k] = 1.0; });

    // Framework group weights — safety first, rug detection dominates
    this.groupWeights = {
      tp: 1.3,  // Tipping Point
      k: 1.0,   // Kahneman
      oc: 1.5,  // On-chain velocity important
      rg: 3.0,  // Rug detection — HIGHEST weight (losing money > missing plays)
      ch: 2.0,  // Chart pattern analysis — catches fake charts and pump-dumps
      so: 0.6,  // Social is noisy
      mt: 0.3,  // Time-of-day is minor
    };

    // Online learning state — higher rate to adapt faster from rug losses
    this.learningRate = 0.03;
    this.trainCount = 0;
    this.accuracy = { correct: 0, total: 0 };
  }

  // Rebuild multiplier cache after weight changes — one Float64Array lookup per feature
  _rebuildCache() {
    this._mCache = new Float64Array(FEATURE_KEYS.length);
    this._mTotal = 0;
    for (let i = 0; i < FEATURE_KEYS.length; i++) {
      const k = FEATURE_KEYS[i];
      const m = (this.weights[k] || 1.0) * (this.groupWeights[GROUP_FOR_KEY[k]] || 1.0);
      this._mCache[i] = m;
      this._mTotal += m;
    }
    // Pre-compute per-group weight sums for sub-score normalization
    this._groupWeightSums = {};
    for (const g of GROUP_NAMES) {
      let s = 0;
      for (const k of KEYS_BY_GROUP[g]) s += this._mCache[KEY_INDEX[k]];
      this._groupWeightSums[g] = s;
    }
  }

  score(features) {
    // Lazy-init multiplier cache
    if (!this._mCache) this._rebuildCache();

    // ── Single pass: weighted sum + per-group sums ──
    // Zero-alloc: reuse pre-allocated group accumulators
    let weightedSum = 0;
    let gs_tp = 0, gs_k = 0, gs_oc = 0, gs_rg = 0, gs_ch = 0, gs_so = 0, gs_mt = 0;
    const mc = this._mCache;

    for (let i = 0; i < FEATURE_KEYS.length; i++) {
      const val = features[FEATURE_KEYS[i]] || 0;
      const wv = val * mc[i];
      weightedSum += wv;
      switch (GROUP_FOR_KEY[FEATURE_KEYS[i]]) {
        case "tp": gs_tp += wv; break;
        case "k":  gs_k  += wv; break;
        case "oc": gs_oc += wv; break;
        case "rg": gs_rg += wv; break;
        case "ch": gs_ch += wv; break;
        case "so": gs_so += wv; break;
        case "mt": gs_mt += wv; break;
      }
    }

    const totalWeight = this._mTotal;
    const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Sub-scores normalized by group weight
    const gws = this._groupWeightSums;
    const s_tp = gws.tp > 0 ? gs_tp / gws.tp : 0;
    const s_k  = gws.k  > 0 ? gs_k  / gws.k  : 0;
    const s_oc = gws.oc > 0 ? gs_oc / gws.oc : 0;
    const s_rg = gws.rg > 0 ? gs_rg / gws.rg : 0;
    const s_ch = gws.ch > 0 ? gs_ch / gws.ch : 0;
    const s_so = gws.so > 0 ? gs_so / gws.so : 0;
    const s_mt = gws.mt > 0 ? gs_mt / gws.mt : 0;

    // ── Rug penalty (no branches on common path) ──
    const rugRisk = s_rg;
    const rugPenalty = rugRisk < 0.2
      ? (rugRisk * 75 + 0.5) | 0
      : rugRisk < 0.4
        ? (15 + (rugRisk - 0.2) * 100 + 0.5) | 0
        : (35 + (rugRisk - 0.4) * 67 + 0.5) | 0;

    // ── Chart pattern penalty ──
    // smoothGrind is a STRONG rug signal — fake charts with no natural dips
    const chartPenalty = (features.ch_smoothGrind || 0) > 0.5
      ? Math.round((features.ch_smoothGrind - 0.3) * 40)
      : (features.ch_pumpDump || 0) > 0.5
        ? Math.round((features.ch_pumpDump - 0.3) * 25)
        : 0;

    // ── Tipping Point composite ──
    const tippingScore = s_tp * 0.4 + s_k * 0.3 + s_oc * 0.2 + s_so * 0.1;

    // ── Bond probability ──
    const bpRaw = tippingScore * 40
      + (features.oc_buyVelocity5m || 0) * 25
      + (features.oc_uniqueBuyers5m || 0) * 20
      + (features.k_herdSignal || 0) * 15
      - rugPenalty * 0.8
      - chartPenalty * 0.6;
    const bondProb = bpRaw < 1 ? 1 : bpRaw > 99 ? 99 : (bpRaw + 0.5) | 0;

    // ── Rug flags — direct reads, no array iteration ──
    const rugFlags = [];
    if ((features.rg_devSellSpeed || 0) > 0.2) rugFlags.push("dev_dumping");
    if ((features.rg_holderConcentration || 0) > 0.5) rugFlags.push("whale_concentrated");
    if ((features.rg_coordDumpScore || 0) > 0.2) rugFlags.push("coordinated_sells");
    if ((features.rg_liqRemovalSpeed || 0) > 0.4) rugFlags.push("liquidity_drain");
    if ((features.rg_sellWaveDetect || 0) > 0.3) rugFlags.push("sell_wave");
    if ((features.rg_mcapDropRate || 0) > 0.25) rugFlags.push("mcap_crashing");
    if ((features.rg_buyerRetention || 0) < 0.5) rugFlags.push("early_buyers_fled");
    if ((features.ch_smoothGrind || 0) > 0.5) rugFlags.push("fake_chart_smooth_grind");
    if ((features.ch_dipRatio || 0.5) < 0.1 && (features.ch_smoothGrind || 0) > 0.3) rugFlags.push("no_natural_dips");

    const finalScore = (rawScore * 100 + 0.5) | 0;
    const clamped = finalScore - rugPenalty - chartPenalty;

    return {
      score: clamped < 0 ? 0 : clamped > 99 ? 99 : clamped,
      tippingScore: (tippingScore * 100 + 0.5) | 0,
      bondProb,
      rugScore: (rugRisk * 100 + 0.5) | 0,
      rugFlags,
      subScores: {
        tippingPoint: (s_tp * 100 + 0.5) | 0,
        kahneman: (s_k * 100 + 0.5) | 0,
        onChain: (s_oc * 100 + 0.5) | 0,
        rugDetection: (s_rg * 100 + 0.5) | 0,
        chartPattern: (s_ch * 100 + 0.5) | 0,
        social: (s_so * 100 + 0.5) | 0,
        timing: (s_mt * 100 + 0.5) | 0,
      },
      chartPenalty,
      confidence: Math.min(99, 40 + ((this.trainCount / 10 + 0.5) | 0)),
      modelVersion: this.trainCount,
    };
  }

  // Online learning: update weights based on outcome
  learn(features, outcome) {
    // outcome: { graduated: bool, peakMcx: number, fleetPnl: number }
    const predicted = this.score(features);
    const actual = outcomeToLabel(outcome);
    const error = actual - predicted.score / 100;

    // Gradient update per feature
    for (const key of FEATURE_KEYS) {
      const val = features[key] || 0;
      if (val > 0) {
        this.weights[key] += this.learningRate * error * val;
        this.weights[key] = Math.max(0.1, Math.min(5.0, this.weights[key]));
      }
    }

    // Invalidate multiplier cache — weights changed
    this._mCache = null;

    // Track accuracy
    this.trainCount++;
    const predBool = predicted.score >= 50;
    const actualBool = actual >= 0.5;
    if (predBool === actualBool) this.accuracy.correct++;
    this.accuracy.total++;

    return {
      trainCount: this.trainCount,
      error: Math.abs(error),
      accuracy: this.accuracy.total > 0 ? (this.accuracy.correct / this.accuracy.total * 100).toFixed(1) : "N/A",
    };
  }

  getStats() {
    return {
      trainCount: this.trainCount,
      accuracy: this.accuracy.total > 10 ? (this.accuracy.correct / this.accuracy.total * 100).toFixed(1) + "%" : "calibrating",
      topFeatures: this.getTopFeatures(10),
      weights: { ...this.weights },
    };
  }

  getTopFeatures(n = 10) {
    return Object.entries(this.weights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => ({ feature: k, weight: v.toFixed(3) }));
  }

  export() {
    return { weights: this.weights, groupWeights: this.groupWeights, trainCount: this.trainCount, accuracy: this.accuracy };
  }

  import(data) {
    if (data.weights) this.weights = data.weights;
    if (data.groupWeights) this.groupWeights = data.groupWeights;
    if (data.trainCount) this.trainCount = data.trainCount;
    if (data.accuracy) this.accuracy = data.accuracy;
    this._mCache = null; // invalidate cache
  }
}

// ═══ RAG MEMORY — Vector Similarity Store ═══
// In-memory cosine similarity (upgrade to Qdrant/pgvector for production)

class RAGMemory {
  constructor(maxSize = 10000) {
    this.store = [];       // [{ ca, features, outcome, embedding, timestamp }]
    this.maxSize = maxSize;
  }

  // Store a token + features + outcome
  add(ca, features, outcome = null) {
    const embedding = featuresToVector(features);
    const entry = { ca, features, outcome, embedding, timestamp: Date.now() };

    // Deduplicate
    const idx = this.store.findIndex(e => e.ca === ca);
    if (idx >= 0) {
      this.store[idx] = { ...this.store[idx], ...entry, outcome: outcome || this.store[idx].outcome };
    } else {
      this.store.push(entry);
      if (this.store.length > this.maxSize) {
        this.store.shift(); // FIFO eviction
      }
    }
  }

  // Update outcome for an existing token
  updateOutcome(ca, outcome) {
    const entry = this.store.find(e => e.ca === ca);
    if (entry) {
      entry.outcome = { ...entry.outcome, ...outcome };
      return true;
    }
    return false;
  }

  // Find K most similar past tokens
  findSimilar(features, k = 5) {
    if (this.store.length === 0) return [];
    const query = featuresToVector(features);

    const scored = this.store
      .filter(e => e.outcome)  // Only tokens with known outcomes
      .map(e => ({
        ...e,
        similarity: cosineSim(query, e.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);

    return scored.map(s => ({
      ca: s.ca,
      similarity: (s.similarity * 100).toFixed(1) + "%",
      outcome: s.outcome,
      age: Math.round((Date.now() - s.timestamp) / 3600000) + "h ago",
    }));
  }

  getStats() {
    const withOutcome = this.store.filter(e => e.outcome).length;
    const graduated = this.store.filter(e => e.outcome?.graduated).length;
    return {
      total: this.store.length,
      labeled: withOutcome,
      graduated,
      graduationRate: withOutcome > 0 ? (graduated / withOutcome * 100).toFixed(1) + "%" : "N/A",
    };
  }

  // Export for Redis persistence
  export() { return this.store; }
  import(data) { if (Array.isArray(data)) this.store = data; }
}

// ═══ OUTCOME MONITOR — Auto-labels tokens ═══

class OutcomeMonitor {
  constructor() {
    this.pending = new Map();  // ca → { features, scoreResult, timestamp, checks: [] }
    this.checkIntervals = [
      { delay: 30 * 60 * 1000, label: "30m" },
      { delay: 2 * 60 * 60 * 1000, label: "2h" },
      { delay: 6 * 60 * 60 * 1000, label: "6h" },
      { delay: 24 * 60 * 60 * 1000, label: "24h" },
    ];
  }

  // Register a token to monitor
  track(ca, features, scoreResult) {
    this.pending.set(ca, {
      features,
      scoreResult,
      timestamp: Date.now(),
      launchMcap: features.oc_mcapSol || 0,
      checks: [],
    });
  }

  // Called periodically (e.g., every 5 min) with current token data
  // Returns outcomes ready for labeling
  check(currentTokens) {
    const now = Date.now();
    const outcomes = [];

    for (const [ca, entry] of this.pending) {
      const age = now - entry.timestamp;

      for (const interval of this.checkIntervals) {
        if (age >= interval.delay && !entry.checks.includes(interval.label)) {
          entry.checks.push(interval.label);

          // Find current data for this token
          const current = currentTokens.find(t => t.ca === ca);
          if (current) {
            const outcome = {
              ca,
              checkPoint: interval.label,
              graduated: !!(current.graduated || current.raydiumPool),
              peakMcx: entry.launchMcap > 0 ? (current.mcapSol || 0) / (entry.launchMcap * 140) : 0,
              currentMcap: current.mcapUsd || 0,
              alive: !current.rugged && (current.mcapUsd || 0) > 1000,
              holderCount: current.holders || 0,
            };
            outcomes.push(outcome);
          }
        }
      }

      // Clean up after 24h
      if (age > 25 * 60 * 60 * 1000) {
        this.pending.delete(ca);
      }
    }

    return outcomes;
  }

  getStats() {
    return {
      tracking: this.pending.size,
      oldest: this.pending.size > 0 ? Math.round((Date.now() - Math.min(...[...this.pending.values()].map(e => e.timestamp))) / 3600000) + "h" : "N/A",
    };
  }
}

// ═══ MAIN INTELLIGENCE CLASS ═══

export class MemeIntelligence {
  constructor(redis = null) {
    this.redis = redis;
    this.scorer = new ScoringEngine();
    this.memory = new RAGMemory(10000);
    this.monitor = new OutcomeMonitor();
    this.eventLog = [];    // Last 100 events
    this.startTime = Date.now();

    // Try to restore state from Redis
    this._restore();
  }

  // ─── SCORE A TOKEN ───
  async score(tokenData) {
    const features = extractFeatures(tokenData);
    const scoreResult = this.scorer.score(features);

    // RAG: find similar past tokens
    const similar = this.memory.findSimilar(features, 5);

    // RAG boost: if similar tokens graduated, boost score
    if (similar.length > 0) {
      const graduatedSimilar = similar.filter(s => s.outcome?.graduated);
      const ragBoost = graduatedSimilar.length / similar.length;
      scoreResult.ragBoost = Math.round(ragBoost * 20);
      scoreResult.score = Math.min(99, scoreResult.score + scoreResult.ragBoost);
      scoreResult.bondProb = Math.min(99, scoreResult.bondProb + Math.round(ragBoost * 10));
    }

    scoreResult.similar = similar;
    scoreResult.features = features;

    // Store in memory + monitor
    this.memory.add(tokenData.ca, features);
    this.monitor.track(tokenData.ca, features, scoreResult);

    this._log("score", { ca: tokenData.ca, score: scoreResult.score, bondProb: scoreResult.bondProb });

    return scoreResult;
  }

  // ─── LABEL AN OUTCOME ───
  async labelOutcome(ca, outcome) {
    // Update memory
    this.memory.updateOutcome(ca, outcome);

    // Find features for this token
    const entry = this.memory.store.find(e => e.ca === ca);
    if (entry?.features) {
      // Online learning
      const learnResult = this.scorer.learn(entry.features, outcome);
      this._log("learn", { ca, outcome, ...learnResult });

      // Persist weights
      await this._persist();

      return learnResult;
    }
    return null;
  }

  // ─── CHECK PENDING OUTCOMES ───
  // Call this periodically with current radar data
  async checkOutcomes(currentTokens) {
    const outcomes = this.monitor.check(currentTokens);

    for (const outcome of outcomes) {
      await this.labelOutcome(outcome.ca, outcome);
    }

    return outcomes;
  }

  // ─── GET FULL STATS ───
  getStats() {
    return {
      uptime: Math.round((Date.now() - this.startTime) / 3600000) + "h",
      scorer: this.scorer.getStats(),
      memory: this.memory.getStats(),
      monitor: this.monitor.getStats(),
      recentEvents: this.eventLog.slice(-20),
    };
  }

  // ─── PERSISTENCE ───
  async _persist() {
    if (!this.redis) return;
    try {
      await this.redis.set("intel:weights", JSON.stringify(this.scorer.export()), "EX", 604800);
      // Memory is large — persist only last 1000
      const recent = this.memory.store.slice(-1000).map(e => ({ ca: e.ca, features: e.features, outcome: e.outcome, timestamp: e.timestamp }));
      await this.redis.set("intel:memory", JSON.stringify(recent), "EX", 604800);
    } catch (e) {
      console.error("[INTEL] Persist error:", e.message);
    }
  }

  async _restore() {
    if (!this.redis) return;
    try {
      const weights = await this.redis.get("intel:weights");
      if (weights) {
        this.scorer.import(JSON.parse(weights));
        console.log(`[INTEL] Restored scorer: ${this.scorer.trainCount} training samples`);
      }
      const memory = await this.redis.get("intel:memory");
      if (memory) {
        const entries = JSON.parse(memory);
        for (const e of entries) {
          this.memory.add(e.ca, e.features, e.outcome);
        }
        console.log(`[INTEL] Restored memory: ${entries.length} tokens`);
      }
    } catch (e) {
      console.error("[INTEL] Restore error:", e.message);
    }
  }

  _log(type, data) {
    this.eventLog.push({ type, data, time: Date.now() });
    if (this.eventLog.length > 100) this.eventLog.shift();
  }
}

// ═══ UTILITY FUNCTIONS ═══

function gini(values) {
  if (!values || values.length < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = avg(sorted);
  if (mean === 0) return 0;
  let sumDiff = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sumDiff += Math.abs(sorted[i] - sorted[j]);
    }
  }
  return Math.min(1, sumDiff / (2 * n * n * mean));
}

function avg(arr) {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function featuresToVector(features) {
  return FEATURE_KEYS.map(k => features[k] || 0);
}

function cosineSim(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

function outcomeToLabel(outcome) {
  if (!outcome) return 0.5;
  let score = 0.25; // base — slightly skeptical default
  if (outcome.graduated) score += 0.4;
  if (outcome.peakMcx > 5) score += 0.15;
  if (outcome.peakMcx > 10) score += 0.1;
  if (outcome.alive) score += 0.1;
  // Rug pull penalties — HEAVY so model learns from losses fast
  if (outcome.rugged) score -= 0.7;
  if (outcome.mcapDropPct > 80) score -= 0.4;
  if (outcome.mcapDropPct > 50) score -= 0.2;
  if (outcome.devDumped) score -= 0.5;
  return Math.max(0, Math.min(1, score));
}

// ═══ EXPRESS ROUTE HELPERS ═══
// Add these to your server.js:
//
//   import { MemeIntelligence } from "./engine/meme-intelligence.mjs";
//   const intel = new MemeIntelligence(redis);
//
//   app.get("/api/intel/score/:ca", async (req, res) => {
//     const tokenData = radarTokens.find(t => t.ca === req.params.ca) || { ca: req.params.ca };
//     const result = await intel.score(tokenData);
//     res.json(result);
//   });
//
//   app.get("/api/intel/stats", (req, res) => res.json(intel.getStats()));
//
//   // In your radar update loop:
//   setInterval(async () => {
//     const outcomes = await intel.checkOutcomes(currentRadarTokens);
//     if (outcomes.length > 0) console.log(`[INTEL] Labeled ${outcomes.length} outcomes`);
//   }, 5 * 60 * 1000);
//
//   // Score every new token that enters radar:
//   onNewRadarToken(async (token) => {
//     token.intelScore = await intel.score(token);
//   });

// ═══ SCORE DYNAMICS — Velocity & Acceleration ═══
// Axiom: a token's fate is encoded not in its score, but in the *derivatives* of its score.
//
// Physics of rug pulls:
//   - Score decelerating (d²S/dt² < 0) while still positive = the pump is losing energy.
//     Like a ball thrown upward — still rising, but gravity is winning. Get out before the peak.
//   - Sharp negative velocity spike (dS/dt << 0) = something broke. Instant exit signal.
//   - Score accelerating upward (d²S/dt² > 0) = momentum building. Runner — let it ride.
//
// The score itself is a lagging indicator. The derivatives are *leading* indicators.
// By the time the score drops below threshold, you've already lost. The acceleration
// told you 2 cycles ago.

class ScoreDynamics {
  constructor(maxTokens = 5000) {
    this.history = new Map(); // ca → { scores: [{s, t}], v, a }
    this.maxTokens = maxTokens;
  }

  // Record a score observation. Returns { velocity, acceleration, trend }
  // velocity: points per second (positive = improving)
  // acceleration: change in velocity per second (positive = momentum building)
  // trend: "rocket" | "rising" | "fading" | "crashing" | "stable"
  record(ca, score) {
    const now = Date.now();
    let entry = this.history.get(ca);
    if (!entry) {
      entry = { scores: [], v: 0, a: 0 };
      this.history.set(ca, entry);
      // Evict oldest if at capacity
      if (this.history.size > this.maxTokens) {
        const oldest = this.history.keys().next().value;
        this.history.delete(oldest);
      }
    }

    const scores = entry.scores;
    scores.push({ s: score, t: now });

    // Keep only last 6 observations (enough for 2nd derivative)
    if (scores.length > 6) scores.shift();

    if (scores.length < 2) {
      entry.v = 0;
      entry.a = 0;
      return { velocity: 0, acceleration: 0, trend: "stable", scores: scores.length };
    }

    // ── Compute velocity: weighted linear regression on recent points ──
    // More recent points get more weight (exponential decay)
    const n = scores.length;
    const latest = scores[n - 1];
    const prev = scores[n - 2];
    const dt = (latest.t - prev.t) / 1000; // seconds

    // Instantaneous velocity (points per second)
    const v = dt > 0 ? (latest.s - prev.s) / dt : 0;

    // Smoothed velocity (EMA with previous to reduce noise)
    entry.v = entry.v === 0 ? v : entry.v * 0.3 + v * 0.7;

    // ── Compute acceleration: change in velocity ──
    if (scores.length >= 3) {
      const pp = scores[n - 3];
      const dtPrev = (prev.t - pp.t) / 1000;
      const vPrev = dtPrev > 0 ? (prev.s - pp.s) / dtPrev : 0;
      const aDt = (latest.t - pp.t) / 1000;
      const rawA = aDt > 0 ? (v - vPrev) / aDt : 0;
      entry.a = entry.a === 0 ? rawA : entry.a * 0.3 + rawA * 0.7;
    }

    // ── Classify trend ──
    let trend;
    if (entry.v > 0.3 && entry.a > 0.01) trend = "rocket";       // accelerating upward
    else if (entry.v > 0.1) trend = "rising";                      // steady climb
    else if (entry.v > 0 && entry.a < -0.01) trend = "fading";     // still up but decelerating
    else if (entry.v < -0.3) trend = "crashing";                   // falling fast
    else if (entry.v < -0.05) trend = "declining";                  // drifting down
    else trend = "stable";

    return {
      velocity: +entry.v.toFixed(4),
      acceleration: +entry.a.toFixed(6),
      trend,
      scores: n,
    };
  }

  // Get current dynamics for a token (without recording new score)
  get(ca) {
    const entry = this.history.get(ca);
    if (!entry) return null;
    const n = entry.scores.length;
    return {
      velocity: +entry.v.toFixed(4),
      acceleration: +entry.a.toFixed(6),
      trend: entry.v > 0.3 && entry.a > 0.01 ? "rocket"
        : entry.v > 0.1 ? "rising"
        : entry.v > 0 && entry.a < -0.01 ? "fading"
        : entry.v < -0.3 ? "crashing"
        : entry.v < -0.05 ? "declining"
        : "stable",
      lastScore: n > 0 ? entry.scores[n - 1].s : 0,
      scores: n,
    };
  }

  // Prune tokens not seen in 30 minutes
  prune() {
    const cutoff = Date.now() - 1800000;
    for (const [ca, entry] of this.history) {
      const last = entry.scores[entry.scores.length - 1];
      if (!last || last.t < cutoff) this.history.delete(ca);
    }
  }
}

export default MemeIntelligence;
export { extractFeatures, ScoringEngine, RAGMemory, OutcomeMonitor, ScoreDynamics, FEATURE_KEYS };
