// ═══ VELOCITY — pump.fun edge model (DP2 plugin) ═══
// Wraps bondli's five-gate auto-ape pipeline as kill gates. Gate 4 (portfolio)
// is deliberately absent: caps belong to the risk envelope (DP3), not here.

import { checkDisqualifiers } from "../../../autoape/gates/disqualifiers.js";
import { checkViability } from "../../../autoape/gates/viability.js";
import { classifyConfidence } from "../../../autoape/gates/confidence.js";
import { checkExecutionWindow } from "../../../autoape/gates/execution-window.js";
import { planFor } from "../../core/plans.mjs";
import { DEFAULT_WEIGHTS, scoreFeatures } from "../../core/learner.mjs";

/** Normalized 0..1 features the learnable ranking weights read. Kill gates never see these. */
export function pumpfunFeatures(c) {
  const clamp01 = v => Math.min(1, Math.max(0, Number(v) || 0));
  const opt = v => (v == null || Number.isNaN(Number(v)) ? null : clamp01(v)); // absent enrichment is null, never 0
  return {
    apeScore: clamp01((Number(c.scores.apeScore) || 0) / 100),
    memeticQuick: opt(c.token._memeticQuick),
    survivorMatch: c.token._survivorMatch == null ? null : clamp01(Number(c.token._survivorMatch) / 100),
    chartHealth: opt(c.qf?.ch_healthScore),
    whaleBullish: opt(c.qf?._whaleBullish),
    walletAge: opt(c.qf?.rg_walletAgeScore),
    freshWalletRatio: opt(c.qf?._rg_freshWalletRatio),
  };
}

// Priors until the ledger has enough realized outcomes for the tier. Every tier must clear the EV
// gate after ~5% costs on priors alone, or the tier can never trade and never earn the outcomes
// that would replace the prior: the old tier-3 prior (0.25 x 3.0) had EV -0.05 after costs, which
// silently refused every speculative entry.
export const PUMPFUN_PRIORS = Object.freeze({
  1: Object.freeze({ p_win: 0.45, payoff: 3.0 }),   // EV +0.80 before costs
  2: Object.freeze({ p_win: 0.35, payoff: 3.0 }),   // EV +0.40
  3: Object.freeze({ p_win: 0.30, payoff: 3.0 }),   // EV +0.20
});

/** One knob for how far past the designed floors gates 2 and 3 let a token in. Gate 1 (the rug
 *  disqualifiers) never moves: aggression is about how early and how speculative, not how unsafe.
 *    0 cautious  1 as designed  2 aggressive  3 degen */
// The risk dial. Every knob a gate reads, per level. 0 = only the designed rules at their strictest,
// 3 = as loose as still makes sense. Calibrated on gate-stats (30 min, 786 tokens): at level 1 the
// binding rules were COORDINATED_DUMP (+51 tokens), STALE (+15), TOO_LATE (+12), EXTREME_CONCENTRATION
// (+11) in gate 1; DEAD_ON_ARRIVAL (63%) and INSUFFICIENT_DATA (22%) in gate 2; WATCHLIST in gate 3.
export const AGGRESSION = Object.freeze({
  0: Object.freeze({ scoreFloor: 50, tier3Floor: 55, sybilMax: 0.35, freshWalletMax: 0.70, curveMax: 0.50, curveMaxSpec: 0.30, spikeSlope: 0.10, blockDecel: true,  requireStable: true,
                     coordDump: 0.5, staleMin: 15, tooLateCurve: 0.80, concentrationMax: 0.70, doaBuyers: 5, minScores: 2, enterWatchlist: false, minConfidence: 0.55 }),
  1: Object.freeze({ scoreFloor: 45, tier3Floor: 50, sybilMax: 0.40, freshWalletMax: 0.80, curveMax: 0.60, curveMaxSpec: 0.40, spikeSlope: 0.15, blockDecel: true,  requireStable: true,
                     coordDump: 0.5, staleMin: 15, tooLateCurve: 0.80, concentrationMax: 0.70, doaBuyers: 5, minScores: 2, enterWatchlist: false, minConfidence: 0.50 }),
  2: Object.freeze({ scoreFloor: 38, tier3Floor: 42, sybilMax: 0.50, freshWalletMax: 0.90, curveMax: 0.70, curveMaxSpec: 0.55, spikeSlope: 0.25, blockDecel: false, requireStable: false,
                     coordDump: 0.7, staleMin: 30, tooLateCurve: 0.90, concentrationMax: 0.80, doaBuyers: 4, minScores: 1, enterWatchlist: true, minConfidence: 0.40 }),
  3: Object.freeze({ scoreFloor: 32, tier3Floor: 35, sybilMax: 0.60, freshWalletMax: 1.00, curveMax: 0.80, curveMaxSpec: 0.65, spikeSlope: 0.40, blockDecel: false, requireStable: false,
                     coordDump: 0.85, staleMin: 60, tooLateCurve: 0.95, concentrationMax: 0.90, doaBuyers: 3, minScores: 0, enterWatchlist: true, minConfidence: 0.30 }),
});

export function makePumpfunEdge({
  venue = "pumpfun",               // "pons": the same judge on Robinhood Chain; snipe-tax window refused
  aggression = 1,
  priors = PUMPFUN_PRIORS,
  minOutcomesForStats = 30,
  feeFractionRoundTrip = 0.02,     // pump.fun 1% in + 1% out
  fixedCostSol = 0.0015,           // priority fee + Jito tip per side, rough
  nominalStakeUsd = 25,
} = {}) {
  const level = AGGRESSION[Math.max(0, Math.min(3, Math.round(Number(aggression) || 0)))] || AGGRESSION[1];
  const gateOpts = venue === "pons" ? { ...level, minAgeMin: 1.1 } : level; // PONS: up to 99% snipe tax in the first 60s
  return {
    venue,
    name: "bondli_gates",
    aggression: Number(aggression),
    gateOpts,
    minConfidence: gateOpts.minConfidence ?? 0.5, // the post-gate confidence floor, read by the GateRunner

    /** Only candidate events carry a scorable token; ticks belong to exits. */
    ingest(event) {
      if (event.kind !== "candidate") return [];
      const p = event.payload || {};
      if (!p.token || !p.token.ca) return [];
      if (p.token._mayhem) return []; // Mayhem launches are never looked at
      if (p.token._copyOf) return []; // a same-name copy is an advert for another token, never a trade
      return [{
        model: p.token._revival ? "bondli_revival" : "bondli_gates",
        revival: p.token._revival || null,
        instrument: p.token.ca,
        token: p.token, qf: p.qf, scores: p.scores || {}, dynamics: p.dynamics,
        solPrice: p.solPrice || 0,
        // The router sizes and routes from this: on PONS it needs the curve contract and its reserves.
        reference: { mcapUsd: p.mcapUsd || p.token.mcapUsd || 0, vSolInBondingCurve: p.vSolInBondingCurve || p.token.vSolInBondingCurve || 0, solPrice: p.solPrice || 0, solPriceAt: p.solPriceAt || 0, ...(p.curve ? { curve: p.curve, quote: p.quote || "ETH" } : {}) },
        group: p.token.devWallet || null,
      }];
    },

    gates: [
      // A revival is hours old by definition: the age rules (STALE) do not apply; every rug rule does.
      { name: "disqualifiers", check: c => { const r = checkDisqualifiers(c.token, c.qf, { ...gateOpts, ...(c.revival ? { staleMin: Infinity } : {}), freezeAuthority: !!c.token.freezeAuthority }); return { pass: r.pass, reasons: r.flags }; } },
      { name: "viability", check: c => { const r = checkViability(c.token, c.qf, c.scores, c.dynamics, gateOpts); return { pass: r.pass, reasons: r.checks }; } },
      { name: "confidence", check: c => {
          // A revival is always a speculative entry: its own plan, half the stake, never a bigger tier.
          if (c.revival) { c.tier = 3; c.tierLabel = "REVIVAL"; c.tierReasons = [`buyers5m ${c.revival.buyers5m} vs ${c.revival.baseline5m}`, `curve +${c.revival.curveDelta}`]; return { pass: true }; }
          const r = classifyConfidence(c.token, c.qf, c.scores, c.dynamics, gateOpts);
          c.tier = r.tier; c.tierLabel = r.label; c.tierReasons = r.reasons;
          if (r.tier >= 1 && r.tier <= 3) return { pass: true };
          // On the loose settings a watchlist token is a speculative entry: tier-3 plan and sizing.
          if (r.tier === 4 && gateOpts.enterWatchlist) { c.tier = 3; c.tierLabel = "WATCHLIST_AS_SPEC"; return { pass: true }; }
          return { pass: false, reasons: [...new Set([r.tier === 4 ? "WATCHLIST" : "BELOW_THRESHOLD", ...r.reasons])] };
        } },
      { name: "execution_window", check: c => { const r = checkExecutionWindow(c.token, c.tier, c.scores.scoreTimestamp, gateOpts); return { pass: r.pass, reasons: r.checks }; } },
    ],

    estimate(c, ctx = {}) {
      const stats = ctx.stats?.pumpfun?.[c.tier];
      const prior = priors[c.tier] || priors[3];
      const useStats = stats && stats.n >= minOutcomesForStats && stats.p_win > 0 && stats.payoff > 0;
      const p_win = useStats ? stats.p_win : prior.p_win;
      const payoff = useStats ? stats.payoff : prior.payoff;
      const weights = ctx.weights?.pumpfun || DEFAULT_WEIGHTS.pumpfun;
      const features = pumpfunFeatures(c);
      const ranked = scoreFeatures(features, weights);
      const confidence = Math.min(0.95, ranked + (c.tier === 1 ? 0.15 : c.tier === 2 ? 0.05 : 0));
      const plan = planFor(venue, c.revival ? "revival" : c.tier);
      return {
        p_win, payoff, confidence, tier: c.tier,
        plan_key: plan.key, stake_cap_fraction: plan.stake_cap_fraction ?? null,
        stop_fraction: plan.worst_case_fraction,
        group: c.token.devWallet || null,
        features,
        reasons: [c.tierLabel, ...(c.tierReasons || []), useStats ? `stats n=${stats.n}` : "priors", `rank ${ranked.toFixed(3)}`],
      };
    },

    costs(c) {
      const quotePrice = c.solPrice || c.reference?.solPrice || 0; // SOL on pump.fun, ETH on PONS
      const pons = venue === "pons";
      const vQuote = Number(c.reference?.vSolInBondingCurve) || (pons ? 3 : 30);
      const stakeQuote = quotePrice > 0 ? nominalStakeUsd / quotePrice : (pons ? 0.01 : 0.1);
      // Constant-product curve: buying stake into the quote reserve moves price by about stake/reserve.
      const impact = Math.min(0.25, stakeQuote / Math.max(pons ? 0.1 : 1, vQuote));
      // Fixed cost per side: priority fee + tip on Solana; L2 gas on Robinhood Chain (a few cents).
      const fixedQuote = pons ? 0.00003 : fixedCostSol;
      const fixed = quotePrice > 0 ? (2 * fixedQuote * quotePrice) / nominalStakeUsd : 0.02;
      // Round-trip fee: pump.fun 1% + 1%; PONS the curve's own feeBps + creator tax, each way.
      const feeRT = pons && c.reference?.curve ? 2 * (((Number(c.reference.curve.feeBps) || 100) + (Number(c.reference.curve.creatorTaxBps) || 0)) / 1e4) : feeFractionRoundTrip;
      return { fraction: feeRT + impact + fixed, detail: { feeFractionRoundTrip: feeRT, impact, fixed } };
    },
  };
}
