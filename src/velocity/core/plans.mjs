// ═══ VELOCITY — Static exit plan table (read by DP2 and DP5) ═══
// A plan is a pure function of (venue, key). Nothing at runtime edits this
// table, which is what keeps entry (DP2) and exit (DP5) decoupled: the entry
// estimates payoff from the ledger's realized outcomes, never from these targets.

const MIN = 60_000;

export const EXIT_PLANS = Object.freeze({
  pumpfun: Object.freeze({
    // bondli's createExitPlan(tier) supplies stop/targets; these add the sizing-side worst case.
    1: Object.freeze({ key: 1, label: "GOD_CANDLE", mode: "bondli_layers", worst_case_fraction: 1.0, max_hold_ms: 30 * MIN }),
    2: Object.freeze({ key: 2, label: "STRONG", mode: "bondli_layers", worst_case_fraction: 1.0, max_hold_ms: 15 * MIN }),
    3: Object.freeze({ key: 3, label: "SPECULATIVE", mode: "bondli_layers", worst_case_fraction: 1.0, max_hold_ms: 10 * MIN }),
  }),
  polymarket: Object.freeze({
    // A wrong fact loses the whole stake: worst case is 1.0 even though the plan is hold-to-redeem.
    resolved_fact: Object.freeze({ key: "resolved_fact", mode: "hold_to_redeem", worst_case_fraction: 1.0, stop_pct: 25, max_hold_ms: 14 * 24 * 60 * MIN }),
    // A full consistency set is locked in; the residual is unwind slippage on a partial fill.
    consistency: Object.freeze({ key: "consistency", mode: "hold_to_redeem", worst_case_fraction: 0.15, stop_pct: null, max_hold_ms: 30 * 24 * 60 * MIN }),
    stale_quote: Object.freeze({ key: "stale_quote", mode: "target_stop", worst_case_fraction: 0.10, target_pct: 6, stop_pct: 5, max_hold_ms: 3 * 24 * 60 * MIN }),
  }),
});

export function planFor(venue, key) {
  const p = EXIT_PLANS[venue]?.[key];
  if (!p) throw new Error(`no exit plan for ${venue}/${key}`);
  return p;
}
