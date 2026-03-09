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

  // ─── Meta ───
  const now = new Date();
  f.mt_hourOfDay = now.getUTCHours() / 23;
  f.mt_dayOfWeek = now.getUTCDay() / 6;
  f.mt_isWeekend = (now.getUTCDay() === 0 || now.getUTCDay() === 6) ? 1 : 0;

  return f;
}

// ═══ SCORING ENGINE ═══
// Combines rule-based frameworks + learned weights

class ScoringEngine {
  constructor() {
    // Initial weights (Tipping Point framework emphasis)
    this.weights = {};
    FEATURE_KEYS.forEach(k => { this.weights[k] = 1.0; });

    // Framework group weights
    this.groupWeights = {
      tp: 1.5,  // Tipping Point gets 1.5x
      k: 1.2,   // Kahneman gets 1.2x
      oc: 1.3,  // On-chain velocity important
      so: 0.8,  // Social is a signal but noisy
      mt: 0.5,  // Time-of-day is minor
    };

    // Online learning state
    this.learningRate = 0.01;
    this.trainCount = 0;
    this.accuracy = { correct: 0, total: 0 };
  }

  score(features) {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const key of FEATURE_KEYS) {
      const val = features[key] || 0;
      const group = key.split("_")[0];
      const gw = this.groupWeights[group] || 1.0;
      const w = (this.weights[key] || 1.0) * gw;
      weightedSum += val * w;
      totalWeight += w;
    }

    const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Compute sub-scores for each framework
    const subScores = {};
    for (const group of ["tp", "k", "oc", "so", "mt"]) {
      const keys = FEATURE_KEYS.filter(k => k.startsWith(group + "_"));
      const vals = keys.map(k => (features[k] || 0) * (this.weights[k] || 1));
      subScores[group] = vals.length > 0 ? avg(vals) : 0;
    }

    // Tipping Point composite
    const tippingScore = (subScores.tp * 0.4 + subScores.k * 0.3 + subScores.oc * 0.2 + subScores.so * 0.1);

    // Bonding probability: based on velocity + tipping score
    const bondProb = Math.min(99, Math.max(1, Math.round(
      tippingScore * 40 +
      (features.oc_buyVelocity5m || 0) * 25 +
      (features.oc_uniqueBuyers5m || 0) * 20 +
      (features.k_herdSignal || 0) * 15
    )));

    return {
      score: Math.round(rawScore * 100),
      tippingScore: Math.round(tippingScore * 100),
      bondProb,
      subScores: {
        tippingPoint: Math.round(subScores.tp * 100),
        kahneman: Math.round(subScores.k * 100),
        onChain: Math.round(subScores.oc * 100),
        social: Math.round(subScores.so * 100),
        timing: Math.round(subScores.mt * 100),
      },
      confidence: Math.min(99, 40 + Math.round(this.trainCount / 10)),
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
  let score = 0.3; // base
  if (outcome.graduated) score += 0.4;
  if (outcome.peakMcx > 5) score += 0.15;
  if (outcome.peakMcx > 10) score += 0.1;
  if (outcome.alive) score += 0.05;
  return Math.min(1, score);
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

export default MemeIntelligence;
export { extractFeatures, ScoringEngine, RAGMemory, OutcomeMonitor, FEATURE_KEYS };
