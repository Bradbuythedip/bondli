// ═══ VELOCITY — Gate runner (DP2) ═══
// Venue-agnostic. Runs an edge model's kill gates cheapest-first, then the
// edge's estimate, then expected value after costs. Emits GO or REJECT with
// the gate and reasons. It never consults the risk envelope: that is DP3's job.
// Every number here derives from the event and the context, never from the
// wall clock, so a replay of the same capture yields byte-identical decisions.

import { eventHash } from "./events.mjs";

/** Run fn with Date.now() pinned to t. bondli's gates read the clock for token
 *  age and score freshness; the decision time is the event's observed time. */
export function withClock(t, fn) {
  const real = Date.now;
  Date.now = () => t;
  try { return fn(); } finally { Date.now = real; }
}

/** Expected value of one trade as a FRACTION OF THE STAKE, after costs.
 *
 *  `payoff` is a ratio -- average win over average loss -- so `p*payoff - (1-p)` is an edge measured
 *  in units of one average loss (one R), not in stake. `costs` is a fraction of the stake. Subtracting
 *  one from the other compares two different units: at a 5% average loss and a 3.5% round trip, one R
 *  is 0.7 of the trade's cost, so charging 0.035 R instead of 0.7 R understated the cost of trading by
 *  about twenty times. `lossFraction` is what converts between them.
 *
 *  With no lossFraction the old R-denominated form is kept, so a venue that has not supplied one is
 *  not silently rescaled. */
export function expectedValue({ p_win, payoff, costs, lossFraction = null }) {
  const edgeR = p_win * payoff - (1 - p_win);
  if (!(lossFraction > 0)) return edgeR - costs;
  return edgeR * lossFraction - costs;
}

export class GateRunner {
  // probeStakeFraction: while a plan key has no realized outcomes of its own it is judged on priors,
  // and a prior that prices a trade out is a claim about a guess. Where the guess is what refused it
  // -- see the test in evaluate, which asks whether the trade would clear its costs at the loss the
  // exit plan is designed to take -- refusing forever means never learning otherwise, so the trade is
  // taken at this fraction of the normal cap until the key has a record. Set to 0 to refuse instead.
  //
  // probeBudget: how many probes one (venue, plan key) may be sold in a UTC day. A probe is not a
  // trade that was judged worth taking -- it is a measurement being bought, and it is paid for in
  // toll at the same rate as any other round trip. Left uncounted it is not a probe at all but a
  // standing licence to trade on a guess, which is how a daily risk budget quietly becomes a fee
  // budget. Three is chosen, not rounded to: at three a day a key reaches the six closes where its
  // own record takes over the estimate inside two days, and about forty inside the fourteen-day
  // statistics window, which is enough for that record to mean something -- while the most the
  // whole idea can cost a key is three reduced-size round trips a day. Zero would be a lockout and
  // is refused as a setting; a large number would make this cosmetic.
  constructor({ venue, edge, minConfidence = edge?.minConfidence ?? 0.5, minEv = 0, probeStakeFraction = 0.4, probeBudget = 3 }) {
    if (!edge || edge.venue !== venue) throw new Error(`edge model must be for venue ${venue}`);
    this.venue = venue;
    this.edge = edge;
    this.minConfidence = minConfidence;
    this.minEv = minEv;
    this.probeStakeFraction = Number(probeStakeFraction) > 0 ? Math.min(1, Number(probeStakeFraction)) : 0;
    this.probeBudget = Number(probeBudget) >= 1 ? Math.floor(Number(probeBudget)) : 3;
    this.evaluated = 0;
    this.gos = 0;
  }

  /** Feed one MarketEvent through the edge's ingest, then gate every candidate. */
  run(event, ctx = {}) {
    const candidates = this.edge.ingest(event, ctx) || [];
    const out = [];
    for (const cand of candidates) out.push(this.evaluate(event, cand, ctx));
    return out;
  }

  evaluate(event, cand, ctx = {}) {
    this.evaluated++;
    const base = {
      id: eventHash(event, `${cand.model || "default"}|${cand.instrument || event.id}`),
      venue: this.venue,
      instrument: String(cand.instrument || event.id),
      model: cand.model || this.edge.name || "default",
      event_kind: event.kind,
      t_event: event.t_venue,
      t_observed: event.t_observed,
      t_decided: event.t_observed,
      group: cand.group || null,
      legs: cand.legs ? cand.legs.map(l => ({ conditionId: l.conditionId || null, tokenId: l.tokenId || l.instrument, instrument: l.instrument || l.tokenId, side: l.side, price: l.price, size: l.size })) : null,
      reference: cand.reference || null,
    };
    const reject = (gate, reasons) => ({ ...base, action: "REJECT", gate, reasons: [].concat(reasons).map(String), tier: cand.tier ?? 0 });

    // Gate 0: governor veto (halt or zero throttle). A throttle in (0,1) is sizing's business.
    const gov = ctx.governor || {};
    if (gov.halt) return reject("governor", [`HALT:${gov.haltReason || "halt"}`]);
    if (gov.throttle === 0) return reject("governor", ["THROTTLE_ZERO"]);

    // Venue gates, cheapest first, every one a kill gate.
    const gates = this.edge.gates || [];
    let verdict = null;
    withClock(event.t_observed, () => {
      for (const g of gates) {
        const r = g.check(cand, ctx);
        if (!r || r.pass) continue;
        verdict = reject(g.name, r.reasons && r.reasons.length ? r.reasons : ["FAIL"]);
        return;
      }
    });
    if (verdict) return verdict;

    // Estimate and expected value after costs.
    const est = withClock(event.t_observed, () => this.edge.estimate(cand, ctx)) || {};
    // Price the costs at the SMALLEST stake the sizer could hand back, not a nominal one. The fixed
    // part is a fixed number of dollars, so a gate that prices it at $25 while the governor throttles
    // the trade to the floor approves entries that cannot clear their own costs.
    const costs = withClock(event.t_observed, () => this.edge.costs(cand, ctx?.minStakeUsd ?? null)) || { fraction: 0 };
    const p_win = clamp(Number(est.p_win) || 0, 0, 1);
    const payoff = Math.max(0, Number(est.payoff) || 0);
    const confidence = clamp(Number(est.confidence) || 0, 0, 1);
    const lossFraction = Number(est.loss_fraction) > 0 ? Number(est.loss_fraction) : null;
    const ev = expectedValue({ p_win, payoff, costs: costs.fraction || 0, lossFraction });
    const tier = est.tier ?? cand.tier ?? 0;
    const common = { ...base, tier, p_win: round(p_win), payoff: round(payoff), confidence: round(confidence), ev: round(ev), loss_fraction: lossFraction, costs: { ...costs, fraction: round(costs.fraction || 0) }, stop_fraction: est.stop_fraction ?? cand.stop_fraction ?? null, designed_stop_fraction: est.designed_stop_fraction ?? null, plan_key: est.plan_key ?? null, stake_cap_fraction: est.stake_cap_fraction ?? null, group: est.group ?? base.group, size_hint: est.size_hint ?? null, features: est.features || null };
    if (!(p_win > 0) || !(payoff > 0)) return { ...common, action: "REJECT", gate: "estimate", reasons: ["NO_EDGE_ESTIMATE"] };
    if (confidence < this.minConfidence) return { ...common, action: "REJECT", gate: "confidence", reasons: [`CONFIDENCE_${confidence.toFixed(2)}_BELOW_${this.minConfidence}`] };
    if (ev <= this.minEv) {
      // A refusal that rests on a guess. See probeStakeFraction: while the estimate is still the
      // prior's, refusing forever means never learning otherwise, so the trade is bought at a
      // reduced size instead of refused -- and bought out of a small daily budget, because an
      // uncounted probe is not a probe but a standing licence to trade on a guess.
      //
      // `on_priors` is the whole test, and it means what its name says: is the prior still the
      // thing speaking. That is exactly the condition a probe can revise and the only one it can.
      // Two narrower tests were tried here and both were absorbing states. "Edge positive before
      // costs" approved every EV refusal there is, because every prior in the table is positive
      // before costs -- which made the fail-closed cost model decorative. Its replacement, "the
      // edge clears the costs at the loss the exit plan is DESIGNED to take", is a comparison
      // between constants for any key that has not traded: measured on priors at every stake the
      // sizer can return, tier 3 (0.0200), the first dip (0.0280) and revival (0.0160) all fall
      // under a round trip, so all three were refused identically for the life of the account and
      // could never earn the record that would revise them. And a key one close old is in the same
      // position: the close moves the estimate by a thirteenth and cannot clear that bar either, so
      // a single ordinary loss shut a key for the fourteen days the window runs.
      //
      // What the probe must NOT buy is a refusal that came from a toll we have not read. An unread
      // PONS creator tax or an unread Arc leg tax is priced at the hook's maximum on purpose; the
      // answer to that is to fetch the curve, not to spend a round trip finding out. costs.assumed
      // says which, so the fail-closed pricing stays load-bearing rather than decorative.
      const tollAssumed = !!costs.assumed;
      if (est.on_priors && this.probeStakeFraction > 0 && !tollAssumed) {
        // What survives is still bought, not taken. ctx.probes is the day's tally, one count per
        // (venue, plan key), and the caller hands over the live one or the paper one. No tally means
        // no day to charge it to, and an untracked probe is the thing this exists to stop, so it is
        // refused rather than waved through. Either way the refusal is an ordinary REJECT and says
        // why, so the funnel and the ledger record what the selectivity cost instead of going quiet.
        const budgetKey = `${this.venue}|${common.plan_key ?? tier}`;
        if (!ctx.probes) return { ...common, action: "REJECT", gate: "ev", reasons: [`PROBE_BUDGET_SPENT: no day budget was supplied to charge ${budgetKey} against`] };
        const spent = Number(ctx.probes[budgetKey]) || 0;
        if (spent >= this.probeBudget) return { ...common, action: "REJECT", gate: "ev", reasons: [`PROBE_BUDGET_SPENT: ${budgetKey} has spent ${spent} of ${this.probeBudget} probes today`] };
        // The tally is READ here and CHARGED where the buy lands (engine._openPosition). Charged
        // here it counted approvals rather than trades, and an approval that dies on a full slot
        // table, a stake throttled under the floor or a router failure buys no measurement at all.
        this.gos++;
        return { ...common, action: "GO", gate: null, probe: true,
          stake_cap_fraction: Math.min(common.stake_cap_fraction ?? 1, this.probeStakeFraction),
          reasons: [`PROBE ${spent + 1}/${this.probeBudget}: tier ${tier} has ${est.outcomes_seen || 0} outcomes, EV ${ev.toFixed(4)} rests on priors`, ...(est.reasons || [])].map(String) };
      }
      // Say which of the two refused it. A trade the probe would have taken and does not is the
      // whole behavioural change here, and if the ledger only records EV_NOT_POSITIVE it looks
      // identical to every other refusal -- so an operator watching entries dry up has nothing to
      // read, and no way to tell a cost model that is working from one that is too strict.
      return { ...common, action: "REJECT", gate: "ev",
        reasons: [`EV_${ev.toFixed(4)}_NOT_POSITIVE_AFTER_COSTS${est.on_priors ? "_ON_PRIORS" : ""}`,
          ...(tollAssumed ? [`no probe: the toll here is assumed at ${(costs.fraction || 0).toFixed(4)} because the curve's own fees have not been read; read them rather than buying a token to price them`] : [])] };
    }
    this.gos++;
    return { ...common, action: "GO", gate: null, reasons: [].concat(est.reasons || ["all gates passed"]).map(String) };
  }
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function round(v) { return Math.round(v * 1e6) / 1e6; }
