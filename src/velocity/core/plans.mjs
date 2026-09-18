// ═══ VELOCITY — Static exit plan table (read by DP2 and DP5) ═══
// A plan is a pure function of (venue, key). Nothing at runtime edits this
// table, which is what keeps entry (DP2) and exit (DP5) decoupled: the entry
// estimates payoff from the ledger's realized outcomes, never from these targets.

import { STOP_LOSSES } from "../../autoape/exit-plan.js";

const SEC = 1_000;
const MIN = 60_000;

export const EXIT_PLANS = Object.freeze({
  pumpfun: Object.freeze({
    // bondli's createExitPlan(tier) supplies stop/targets; these add the sizing-side worst case.
    // doa_ms: the crowd-did-not-follow-us-in exit. Seconds after a fill the PRICE is mostly our own
    // impact and tells us nothing, but whether anyone ELSE has bought is already knowable, and a
    // launch that nobody joins in its first seconds is not about to be joined. Cutting one of these
    // flat costs a round trip (3.5% of a $25 stake); letting it become a crash-exit costs 7.2%, which
    // is what the last forty closes actually averaged. Time alone would be the wrong test -- a blanket
    // cut at this age takes the average win from +24% to nothing and flips the edge negative -- so it
    // fires only when participation is absent AND the price has not moved.
    // stall_ms / stall_band_pct: the slower version. A position this old that never left the band
    // around entry, with buying dried up, is dead money and is sold to free the slot ("STALL").
    1: Object.freeze({ key: 1, label: "GOD_CANDLE", mode: "bondli_layers", worst_case_fraction: 1.0, max_hold_ms: 30 * MIN, doa_ms: 30 * SEC, stall_ms: 4 * MIN, stall_band_pct: 10 }),
    2: Object.freeze({ key: 2, label: "STRONG", mode: "bondli_layers", worst_case_fraction: 1.0, max_hold_ms: 15 * MIN, doa_ms: 20 * SEC, stall_ms: 3 * MIN, stall_band_pct: 8 }),
    3: Object.freeze({ key: 3, label: "SPECULATIVE", mode: "bondli_layers", worst_case_fraction: 1.0, max_hold_ms: 10 * MIN, doa_ms: 12 * SEC, stall_ms: 2 * MIN, stall_band_pct: 8 }),
    // THE FIRST DIP (src/api/dip.mjs). A launch entry is bought seconds after the create, when the
    // only thing that has moved the price is the crowd arriving, and every exit below then fires on
    // noise: the measured stretch that prompted this closed nine positions, lost on all nine, and
    // spread the losses across stall, fade-trim, stop, crash and dead-on-arrival alike. A dip entry
    // starts from proof instead -- the token ran on someone else's money, gave some back, and is
    // being bought again -- so its plan is the opposite shape.
    // No doa_ms: the crowd came already, that is the premise, and cutting at twenty seconds because
    // nobody NEW arrived would sell the pause between two waves. The stall window is long and its
    // band narrow, so dead money is still freed but a dip that takes ten minutes to turn is not.
    // The stop is wider because a dip entry's risk is the dip low, not a launch's 10%.
    dip: Object.freeze({ key: "dip", label: "FIRST_DIP", mode: "bondli_layers", worst_case_fraction: 1.0, max_hold_ms: 45 * MIN, stop_pct: 14, tier: 3, doa_ms: null, stall_ms: 10 * MIN, stall_band_pct: 6 }),
    // The same entry on a token whose curve is filling toward completion: the one worth sitting
    // through noise for, because the event it is walking toward is real and is not priced yet. No
    // stall at all (waiting IS the position), three hours of hold, and a stop wide enough that the
    // ordinary shake on the way up cannot take it out.
    dip_hold: Object.freeze({ key: "dip_hold", label: "DIP_TO_COMPLETION", mode: "bondli_layers", worst_case_fraction: 1.0, max_hold_ms: 180 * MIN, stop_pct: 18, tier: 2, doa_ms: null, stall_ms: null, stall_band_pct: 6 }),
    // A revival moves faster on the way down than a launch: tier-3 layers with a tighter stop, a
    // shorter hold, and half the per-trade cap (stake_cap_fraction is read by the sizer).
    revival: Object.freeze({ key: "revival", label: "REVIVAL", mode: "bondli_layers", worst_case_fraction: 1.0, max_hold_ms: 6 * MIN, stop_pct: 8, tier: 3, stake_cap_fraction: 0.5, doa_ms: 10 * SEC, stall_ms: 1.5 * MIN, stall_band_pct: 8 }),
  }),
  polymarket: Object.freeze({
    // A wrong fact loses the whole stake: worst case is 1.0 even though the plan is hold-to-redeem.
    resolved_fact: Object.freeze({ key: "resolved_fact", mode: "hold_to_redeem", worst_case_fraction: 1.0, stop_pct: 25, max_hold_ms: 14 * 24 * 60 * MIN }),
    // A full consistency set is locked in; the residual is unwind slippage on a partial fill.
    consistency: Object.freeze({ key: "consistency", mode: "hold_to_redeem", worst_case_fraction: 0.15, stop_pct: null, max_hold_ms: 30 * 24 * 60 * MIN }),
    stale_quote: Object.freeze({ key: "stale_quote", mode: "target_stop", worst_case_fraction: 0.10, target_pct: 6, stop_pct: 5, max_hold_ms: 3 * 24 * 60 * MIN }),
  }),
});

// PONS trades the same way pump.fun does: same tiers, same layers, same revival plan.
const ALIAS = Object.freeze({ pons: "pumpfun", arc: "pumpfun" });

// A dip entry's risk is not a percentage somebody chose, it is the low failing. Entering ten per
// cent above the low and stopping at fourteen puts the stop under the low, which is right; entering
// thirty per cent above it and stopping at fourteen puts the stop in the middle of the move, where
// ordinary noise reaches it and the thing the trade was premised on has not even been tested. The
// stop is therefore the distance back to the low plus a buffer, never tighter than the plan's own
// and never wider than the cap, because a stop nobody can afford is not risk management.
export const DIP_STOP = Object.freeze({ bufferPct: 3, maxPct: 26 });
export function dipStopPct(planStopPct, { entryMcap, lowMcap } = {}) {
  const base = Number(planStopPct) || 0;
  if (!(entryMcap > 0) || !(lowMcap > 0) || lowMcap >= entryMcap) return base;
  const toLow = ((entryMcap - lowMcap) / entryMcap) * 100;
  return +Math.min(DIP_STOP.maxPct, Math.max(base, toLow + DIP_STOP.bufferPct)).toFixed(2);
}

export function planFor(venue, key) {
  const p = EXIT_PLANS[ALIAS[venue] || venue]?.[key];
  if (!p) throw new Error(`no exit plan for ${venue}/${key}`);
  return p;
}

/** How big a loss this plan is DESIGNED to take, as a fraction of the stake.
 *
 *  Not the same number as worst_case_fraction, which is what the sizer must survive if everything
 *  goes wrong at once and is 1.0 for every curve plan -- a token can go to zero between two blocks.
 *  This is the ordinary loss: the level the plan actually aims to cut at. A plan that names its own
 *  stop states it; a launch tier does not, because its stop lives in bondli's exit plan, so the one
 *  table there is read rather than copied here. Null when the plan cuts at no level at all. */
export function designedStopFraction(venue, key) {
  const p = EXIT_PLANS[ALIAS[venue] || venue]?.[key];
  const pct = Number(p?.stop_pct) > 0 ? Number(p.stop_pct) : Number(STOP_LOSSES[key]);
  return pct > 0 ? pct / 100 : null;
}
