/**
 * ════════════════════════════════════════════════════════════════
 * META ENGINE — Narrative Detection & Memetic Fitness Tracking
 * ════════════════════════════════════════════════════════════════
 *
 * AXIOM: Memetic fitness is relative to the environment.
 * A dog token during dog meta has 10x the graduation probability.
 * This engine tracks what's working RIGHT NOW and boosts tokens
 * that fit the active narrative.
 *
 * Signal Detection Theory integration:
 *   - d' (sensitivity) improves by weighting narrative-matching tokens
 *   - β (criterion) shifts liberal when a meta is running hot
 *   - False alarm cost is low (small position), miss cost is high (10x+)
 *   → Optimal strategy: MORE entries at SMALLER size in hot meta
 *
 * ════════════════════════════════════════════════════════════════
 */

// ── Narrative categories with keyword matchers ──
// Each narrative has: id, display name, keywords (checked against name+ticker+description)
const NARRATIVES = [
  {
    id: "animal",
    name: "Animals",
    keywords: ["dog", "cat", "frog", "pepe", "doge", "shib", "inu", "bonk", "wif", "popcat", "mog", "neiro", "penguin", "pingu", "bird", "fish", "monkey", "ape", "bear", "bull", "rat", "hamster", "goat", "cow", "pig", "duck", "owl", "fox", "wolf", "lion", "tiger", "snake", "panda"],
  },
  {
    id: "ai",
    name: "AI / Tech",
    keywords: ["ai", "gpt", "llm", "neural", "bot", "agent", "claude", "openai", "tensor", "compute", "algo", "quantum", "cyber", "matrix", "singularity", "sentient", "cortex", "synth", "virtual", "meta", "agi", "robot"],
  },
  {
    id: "political",
    name: "Political",
    keywords: ["trump", "biden", "elon", "musk", "maga", "politics", "vote", "election", "president", "congress", "democrat", "republican", "freedom", "america", "usa", "patriot", "government", "white house", "senate"],
  },
  {
    id: "celebrity",
    name: "Celebrity",
    keywords: ["drake", "kanye", "ye", "taylor", "swift", "beyonce", "rihanna", "kim", "kardashian", "snoop", "eminem", "lebron", "ronaldo", "messi", "pewdiepie", "mr beast", "logan", "jake paul", "andrew tate", "joe rogan"],
  },
  {
    id: "culture",
    name: "Internet Culture",
    keywords: ["wojak", "chad", "sigma", "rizz", "skibidi", "based", "cope", "seethe", "npc", "gigachad", "soyjak", "brainlet", "cope", "mald", "kek", "lmao", "bruh", "bussin", "no cap", "sus", "ong", "fr", "gyatt", "ohio"],
  },
  {
    id: "defi",
    name: "DeFi / Crypto",
    keywords: ["sol", "solana", "eth", "bitcoin", "btc", "defi", "dex", "swap", "yield", "stake", "farm", "liquidity", "bridge", "chain", "layer", "protocol", "dao", "nft", "token", "coin", "moon", "pump", "gem"],
  },
  {
    id: "food",
    name: "Food / Objects",
    keywords: ["pizza", "burger", "taco", "sushi", "coffee", "beer", "wine", "cheese", "bread", "banana", "apple", "candy", "cookie", "cake", "water", "fire", "rock", "paper", "scissors", "hat", "shoe", "car"],
  },
  {
    id: "absurdist",
    name: "Absurdist",
    keywords: ["wtf", "bruh", "lol", "haha", "why", "how", "what", "cursed", "blursed", "chaos", "random", "weird", "strange", "bizarre", "fever dream", "schizo", "unhinged", "deranged", "maniacal"],
  },
];

// ── Classify a token into narratives (can match multiple) ──
function classifyToken(token) {
  const name = (token.name || "").toLowerCase();
  const ticker = (token.ticker || "").toLowerCase();
  const desc = (token.description || "").toLowerCase();
  const combined = `${name} ${ticker} ${desc}`;

  const matches = [];
  let bestMatch = null;
  let bestCount = 0;

  for (const narr of NARRATIVES) {
    const hits = narr.keywords.filter(kw => combined.includes(kw));
    if (hits.length > 0) {
      matches.push({ id: narr.id, hits: hits.length, keywords: hits });
      if (hits.length > bestCount) {
        bestCount = hits.length;
        bestMatch = narr.id;
      }
    }
  }

  return {
    primary: bestMatch || "unknown",
    all: matches.map(m => m.id),
    matchDetails: matches,
  };
}

// ═══════════════════════════════════════
// META TRACKER — Sliding window graduation/performance tracking per narrative
// ═══════════════════════════════════════
class MetaTracker {
  constructor() {
    // narrative_id → { events: [{ time, graduated, pnl, mcapMultiple }], ... }
    this.narratives = new Map();
    this.globalEvents = [];  // all events regardless of narrative
    this._lastSummary = null;
    this._lastSummaryTime = 0;

    // Initialize all narratives
    for (const n of NARRATIVES) {
      this.narratives.set(n.id, { events: [], gradCount1h: 0, gradCount6h: 0, totalCount1h: 0, totalCount6h: 0 });
    }
    this.narratives.set("unknown", { events: [], gradCount1h: 0, gradCount6h: 0, totalCount1h: 0, totalCount6h: 0 });
  }

  // Record a token outcome (called when a token gets labeled or graduates)
  record(token, outcome) {
    const classification = classifyToken(token);
    const event = {
      time: Date.now(),
      ca: token.ca,
      name: token.name,
      narrative: classification.primary,
      narratives: classification.all,
      graduated: outcome.graduated || false,
      pnl: outcome.pnl || 0,
      mcapMultiple: outcome.mcapMultiple || 0,
    };

    // Record to primary narrative
    const narr = this.narratives.get(classification.primary);
    if (narr) narr.events.push(event);

    // Also record to all matching narratives
    for (const nid of classification.all) {
      if (nid !== classification.primary) {
        const n = this.narratives.get(nid);
        if (n) n.events.push(event);
      }
    }

    this.globalEvents.push(event);
    this._invalidateCache();
  }

  // Record a token sighting (it appeared on radar, regardless of outcome)
  recordSighting(token) {
    const classification = classifyToken(token);
    const narr = this.narratives.get(classification.primary);
    if (narr) {
      narr.events.push({
        time: Date.now(),
        ca: token.ca,
        narrative: classification.primary,
        sighting: true,  // not an outcome, just appeared
        graduated: false,
      });
    }
    this._invalidateCache();
  }

  _invalidateCache() {
    this._lastSummaryTime = 0;
  }

  // Prune events older than 24h to prevent memory bloat
  _prune() {
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
    for (const [, narr] of this.narratives) {
      narr.events = narr.events.filter(e => e.time > cutoff24h);
    }
    this.globalEvents = this.globalEvents.filter(e => e.time > cutoff24h);
  }

  // ── Get current meta summary ──
  // Returns: sorted list of narratives by "heat" score
  // Heat = weighted graduation rate over multiple time windows
  getSummary() {
    const now = Date.now();
    // Cache for 30s to avoid recomputing on every score call
    if (now - this._lastSummaryTime < 30000 && this._lastSummary) return this._lastSummary;

    this._prune();

    const cutoff1h = now - 60 * 60 * 1000;
    const cutoff6h = now - 6 * 60 * 60 * 1000;
    const cutoff24h = now - 24 * 60 * 60 * 1000;

    const results = [];

    for (const [id, narr] of this.narratives) {
      const e1h = narr.events.filter(e => e.time > cutoff1h);
      const e6h = narr.events.filter(e => e.time > cutoff6h);
      const e24h = narr.events.filter(e => e.time > cutoff24h);

      const grad1h = e1h.filter(e => e.graduated && !e.sighting).length;
      const grad6h = e6h.filter(e => e.graduated && !e.sighting).length;
      const grad24h = e24h.filter(e => e.graduated && !e.sighting).length;

      const total1h = e1h.filter(e => !e.sighting).length || 1;
      const total6h = e6h.filter(e => !e.sighting).length || 1;
      const total24h = e24h.filter(e => !e.sighting).length || 1;

      // Sighting counts (how many tokens in this narrative appeared)
      const sightings1h = e1h.length;
      const sightings6h = e6h.length;

      const gradRate1h = grad1h / total1h;
      const gradRate6h = grad6h / total6h;
      const gradRate24h = grad24h / total24h;

      // Heat score: recent windows weighted more heavily
      // 1h window = 50% weight, 6h = 30%, 24h = 20%
      // Volume bonus: more sightings = more active narrative
      const volumeBonus = Math.min(0.3, sightings1h * 0.02);  // up to +0.3 for 15+ tokens in 1h
      const heat = gradRate1h * 0.50 + gradRate6h * 0.30 + gradRate24h * 0.20 + volumeBonus;

      // Confidence: need enough data points to trust the signal
      const confidence = Math.min(1, (total1h + total6h * 0.5 + total24h * 0.2) / 20);

      results.push({
        id,
        name: NARRATIVES.find(n => n.id === id)?.name || id,
        heat: +heat.toFixed(4),
        confidence: +confidence.toFixed(3),
        gradRate1h: +(gradRate1h * 100).toFixed(1),
        gradRate6h: +(gradRate6h * 100).toFixed(1),
        gradRate24h: +(gradRate24h * 100).toFixed(1),
        graduated1h: grad1h,
        graduated6h: grad6h,
        sightings1h,
        sightings6h,
        total1h,
        total6h,
      });
    }

    // Sort by heat descending
    results.sort((a, b) => b.heat - a.heat);
    this._lastSummary = results;
    this._lastSummaryTime = now;
    return results;
  }

  // ── Get meta boost for a specific token ──
  // Returns: 0-25 bonus points to add to the token's score
  getMetaBoost(token) {
    const classification = classifyToken(token);
    const summary = this.getSummary();

    // Find this token's narrative rank
    const narrResult = summary.find(s => s.id === classification.primary);
    if (!narrResult) return { boost: 0, narrative: "unknown", heat: 0, reason: "unclassified" };

    // Top narrative gets full boost, lower narratives get proportionally less
    const rank = summary.indexOf(narrResult);
    const topHeat = summary[0]?.heat || 0;
    const thisHeat = narrResult.heat;

    // No boost if the narrative is cold or no data
    if (thisHeat < 0.05 || narrResult.confidence < 0.2) {
      return { boost: 0, narrative: classification.primary, heat: thisHeat, reason: "cold_meta" };
    }

    // Boost scales with heat and confidence
    // Max boost: 25 points (significant but not overwhelming)
    // Formula: heat * confidence * 25, with rank decay
    const rankDecay = Math.max(0.2, 1 - rank * 0.15);  // top=1.0, 2nd=0.85, 3rd=0.7, ...
    const rawBoost = thisHeat * narrResult.confidence * 25 * rankDecay;

    // Extra boost if this narrative is THE dominant meta (top by >2x)
    const dominanceBoost = (rank === 0 && topHeat > 0.15 && thisHeat > (summary[1]?.heat || 0) * 2) ? 5 : 0;

    const boost = Math.min(25, Math.round(rawBoost + dominanceBoost));

    return {
      boost,
      narrative: classification.primary,
      narrativeName: narrResult.name,
      heat: thisHeat,
      rank,
      confidence: narrResult.confidence,
      gradRate1h: narrResult.gradRate1h,
      reason: boost > 10 ? "hot_meta" : boost > 5 ? "warm_meta" : boost > 0 ? "mild_meta" : "cold_meta",
    };
  }

  // ── Get the current dominant meta (for UI display) ──
  getCurrentMeta() {
    const summary = this.getSummary();
    const top = summary[0];
    if (!top || top.heat < 0.05) return { active: false, narrative: "none", heat: 0 };
    return {
      active: true,
      narrative: top.id,
      name: top.name,
      heat: top.heat,
      gradRate1h: top.gradRate1h,
      top3: summary.slice(0, 3).map(s => ({ id: s.id, name: s.name, heat: s.heat, gradRate1h: s.gradRate1h })),
    };
  }

  // ── Export/Import for Redis persistence ──
  export() {
    const data = {};
    for (const [id, narr] of this.narratives) {
      data[id] = narr.events;
    }
    return { narratives: data, global: this.globalEvents };
  }

  import(data) {
    if (!data?.narratives) return;
    for (const [id, events] of Object.entries(data.narratives)) {
      if (this.narratives.has(id)) {
        this.narratives.get(id).events = events;
      }
    }
    if (data.global) this.globalEvents = data.global;
    this._invalidateCache();
  }
}

// ═══════════════════════════════════════
// FEE-AWARE POSITION SIZING
// ═══════════════════════════════════════
// The axiom: never take a trade where the expected profit doesn't cover costs.
// Costs = tx fees (buy + sell) + rent + platform cut
//
// For pump.fun on Solana:
//   Priority fee: ~5000-50000 microLamports × 400K CU = 0.002-0.02 SOL per tx
//   Rent: ~0.002 SOL (ATA creation, refundable but locked during trade)
//   Platform: 25% of profit (free tier)
//
// Expected return on a winning trade: depends on meta heat + score
//   Hot meta + high score: ~40-100%+ expected return
//   Cold meta + low score: ~10-20% expected return
//
// Break-even trade size:
//   min_size = total_tx_costs / (expected_return * (1 - platform_cut))
//
// With 0.006 SOL tx costs and 20% expected return:
//   min_size = 0.006 / (0.20 * 0.75) = 0.04 SOL
//
// With 0.006 SOL tx costs and 40% expected return:
//   min_size = 0.006 / (0.40 * 0.75) = 0.02 SOL

const TX_COST_PER_TRADE = 0.003;   // conservative estimate per tx
const RENT_COST = 0.002;            // ATA creation
const TOTAL_OVERHEAD = TX_COST_PER_TRADE * 2 + RENT_COST;  // buy + sell + rent = 0.008
const PLATFORM_CUT_FREE = 0.25;     // 25% of profit

function calcMinTradeSize(expectedReturnPct, tier = "free") {
  const platformCut = tier === "free" ? PLATFORM_CUT_FREE : 0;
  const netReturnRate = (expectedReturnPct / 100) * (1 - platformCut);
  if (netReturnRate <= 0) return 0.15;  // if no expected return, use max safe size
  const minSize = TOTAL_OVERHEAD / netReturnRate;
  // Clamp: at least 0.03 SOL (below this tx fees dominate), at most 0.5 SOL
  return Math.max(0.03, Math.min(0.5, +minSize.toFixed(4)));
}

// Expected return estimator based on score + meta heat
function estimateExpectedReturn(score, metaBoost) {
  // Base expected return: higher score = higher expected return
  // score 30: ~15% expected return
  // score 50: ~30% expected return
  // score 70: ~60% expected return
  // score 90: ~100%+ expected return
  const baseReturn = Math.max(5, (score - 20) * 1.2);

  // Meta boost adds to expected return (hot meta = tokens move faster/further)
  const metaMultiplier = 1 + (metaBoost / 25) * 0.5;  // max 1.5x from meta

  return baseReturn * metaMultiplier;
}

// Full position sizing: combines score, meta, and fee-awareness
function calcOptimalSize(score, metaBoost, baseSolPerTrade, trend, rugFlagCount, tier = "free") {
  // 1. Score-based multiplier (same as existing, but wider range)
  const range = Math.max(80 - 28, 20);  // 28 = typical minScore
  let mult = 0.5 + ((score - 28) / range);
  if (trend === "rocket") mult += 0.25;
  else if (trend === "rising") mult += 0.12;
  else if (trend === "fading") mult -= 0.15;
  else if (trend === "declining") mult -= 0.3;
  mult -= rugFlagCount * 0.12;

  // 2. Meta boost: hot meta → size up (SDT: lower β when base rate is high)
  const metaMult = 1 + (metaBoost / 25) * 0.4;  // max 1.4x from meta
  mult *= metaMult;

  // 3. Clamp
  mult = Math.max(0.4, Math.min(2.2, mult));

  // 4. Calculate raw size
  let rawSize = baseSolPerTrade * mult;

  // 5. Fee-aware floor: ensure trade is large enough to profit
  const expectedReturn = estimateExpectedReturn(score, metaBoost);
  const minSize = calcMinTradeSize(expectedReturn, tier);

  // If raw size is below the fee-aware minimum, bump it up
  // But don't exceed 3x the base to avoid overexposure
  if (rawSize < minSize) {
    rawSize = Math.min(minSize, baseSolPerTrade * 3);
  }

  return {
    size: +rawSize.toFixed(4),
    multiplier: +mult.toFixed(2),
    metaMultiplier: +metaMult.toFixed(2),
    expectedReturn: +expectedReturn.toFixed(1),
    minViableSize: +minSize.toFixed(4),
    feeAdjusted: rawSize >= minSize,
  };
}

export {
  NARRATIVES,
  classifyToken,
  MetaTracker,
  calcMinTradeSize,
  estimateExpectedReturn,
  calcOptimalSize,
  TOTAL_OVERHEAD,
  TX_COST_PER_TRADE,
  PLATFORM_CUT_FREE,
};
