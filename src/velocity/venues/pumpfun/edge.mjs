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
  return {
    apeScore: clamp01((Number(c.scores.apeScore) || 0) / 100),
    memeticQuick: clamp01(c.token._memeticQuick),
    survivorMatch: clamp01((Number(c.token._survivorMatch) || 0) / 100),
    chartHealth: clamp01(c.qf?.ch_healthScore),
    whaleBullish: clamp01(c.qf?._whaleBullish),
    walletAge: clamp01(c.qf?.rg_walletAgeScore),
    freshWalletRatio: clamp01(c.qf?._rg_freshWalletRatio),
  };
}

// Priors until the ledger has enough realized outcomes for the tier (bondli's sizing.js values).
export const PUMPFUN_PRIORS = Object.freeze({
  1: Object.freeze({ p_win: 0.45, payoff: 3.0 }),
  2: Object.freeze({ p_win: 0.35, payoff: 3.0 }),
  3: Object.freeze({ p_win: 0.25, payoff: 3.0 }),
});

/** One knob for how far past the designed floors gates 2 and 3 let a token in. Gate 1 (the rug
 *  disqualifiers) never moves: aggression is about how early and how speculative, not how unsafe.
 *    0 cautious  1 as designed  2 aggressive  3 degen */
export const AGGRESSION = Object.freeze({
  0: Object.freeze({ scoreFloor: 50, tier3Floor: 55, sybilMax: 0.35, freshWalletMax: 0.70, curveMax: 0.50, curveMaxSpec: 0.30, spikeSlope: 0.10, blockDecel: true,  requireStable: true }),
  1: Object.freeze({ scoreFloor: 45, tier3Floor: 50, sybilMax: 0.40, freshWalletMax: 0.80, curveMax: 0.60, curveMaxSpec: 0.40, spikeSlope: 0.15, blockDecel: true,  requireStable: true }),
  2: Object.freeze({ scoreFloor: 38, tier3Floor: 42, sybilMax: 0.50, freshWalletMax: 0.90, curveMax: 0.70, curveMaxSpec: 0.55, spikeSlope: 0.25, blockDecel: false, requireStable: false }),
  3: Object.freeze({ scoreFloor: 32, tier3Floor: 35, sybilMax: 0.60, freshWalletMax: 1.00, curveMax: 0.80, curveMaxSpec: 0.65, spikeSlope: 0.40, blockDecel: false, requireStable: false }),
});

export function makePumpfunEdge({
  aggression = 1,
  priors = PUMPFUN_PRIORS,
  minOutcomesForStats = 30,
  feeFractionRoundTrip = 0.02,     // pump.fun 1% in + 1% out
  fixedCostSol = 0.0015,           // priority fee + Jito tip per side, rough
  nominalStakeUsd = 25,
} = {}) {
  const gateOpts = AGGRESSION[Math.max(0, Math.min(3, Math.round(Number(aggression) || 0)))] || AGGRESSION[1];
  return {
    venue: "pumpfun",
    name: "bondli_gates",
    aggression: Number(aggression),
    gateOpts,

    /** Only candidate events carry a scorable token; ticks belong to exits. */
    ingest(event) {
      if (event.kind !== "candidate") return [];
      const p = event.payload || {};
      if (!p.token || !p.token.ca) return [];
      if (p.token._mayhem) return []; // Mayhem launches are never looked at
      return [{
        model: "bondli_gates",
        instrument: p.token.ca,
        token: p.token, qf: p.qf, scores: p.scores || {}, dynamics: p.dynamics,
        solPrice: p.solPrice || 0,
        reference: { mcapUsd: p.mcapUsd || p.token.mcapUsd || 0, vSolInBondingCurve: p.vSolInBondingCurve || p.token.vSolInBondingCurve || 0, solPrice: p.solPrice || 0, solPriceAt: p.solPriceAt || 0 },
        group: p.token.devWallet || null,
      }];
    },

    gates: [
      { name: "disqualifiers", check: c => { const r = checkDisqualifiers(c.token, c.qf, { freezeAuthority: !!c.token.freezeAuthority }); return { pass: r.pass, reasons: r.flags }; } },
      { name: "viability", check: c => { const r = checkViability(c.token, c.qf, c.scores, c.dynamics, gateOpts); return { pass: r.pass, reasons: r.checks }; } },
      { name: "confidence", check: c => {
          const r = classifyConfidence(c.token, c.qf, c.scores, c.dynamics, gateOpts);
          c.tier = r.tier; c.tierLabel = r.label; c.tierReasons = r.reasons;
          if (r.tier >= 1 && r.tier <= 3) return { pass: true };
          return { pass: false, reasons: [r.tier === 4 ? "WATCHLIST" : "BELOW_THRESHOLD", ...r.reasons] };
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
      return {
        p_win, payoff, confidence, tier: c.tier,
        stop_fraction: planFor("pumpfun", c.tier).worst_case_fraction,
        group: c.token.devWallet || null,
        features,
        reasons: [c.tierLabel, ...(c.tierReasons || []), useStats ? `stats n=${stats.n}` : "priors", `rank ${ranked.toFixed(3)}`],
      };
    },

    costs(c) {
      const solPrice = c.solPrice || c.reference?.solPrice || 0;
      const vSol = Number(c.reference?.vSolInBondingCurve) || 30;
      const stakeSol = solPrice > 0 ? nominalStakeUsd / solPrice : 0.1;
      // Constant-product curve: buying stake into vSol moves price by about stake/vSol.
      const impact = Math.min(0.25, stakeSol / Math.max(1, vSol));
      const fixed = solPrice > 0 ? (2 * fixedCostSol * solPrice) / nominalStakeUsd : 0.02;
      return { fraction: feeFractionRoundTrip + impact + fixed, detail: { feeFractionRoundTrip, impact, fixed } };
    },
  };
}
