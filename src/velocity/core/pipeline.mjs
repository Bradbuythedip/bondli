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

export function expectedValue({ p_win, payoff, costs }) {
  return p_win * payoff - (1 - p_win) - costs;
}

export class GateRunner {
  constructor({ venue, edge, minConfidence = 0.5, minEv = 0 }) {
    if (!edge || edge.venue !== venue) throw new Error(`edge model must be for venue ${venue}`);
    this.venue = venue;
    this.edge = edge;
    this.minConfidence = minConfidence;
    this.minEv = minEv;
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
    const costs = withClock(event.t_observed, () => this.edge.costs(cand, ctx)) || { fraction: 0 };
    const p_win = clamp(Number(est.p_win) || 0, 0, 1);
    const payoff = Math.max(0, Number(est.payoff) || 0);
    const confidence = clamp(Number(est.confidence) || 0, 0, 1);
    const ev = expectedValue({ p_win, payoff, costs: costs.fraction || 0 });
    const tier = est.tier ?? cand.tier ?? 0;
    const common = { ...base, tier, p_win: round(p_win), payoff: round(payoff), confidence: round(confidence), ev: round(ev), costs: { ...costs, fraction: round(costs.fraction || 0) }, stop_fraction: est.stop_fraction ?? cand.stop_fraction ?? null, group: est.group ?? base.group, size_hint: est.size_hint ?? null, features: est.features || null };
    if (!(p_win > 0) || !(payoff > 0)) return { ...common, action: "REJECT", gate: "estimate", reasons: ["NO_EDGE_ESTIMATE"] };
    if (confidence < this.minConfidence) return { ...common, action: "REJECT", gate: "confidence", reasons: [`CONFIDENCE_${confidence.toFixed(2)}_BELOW_${this.minConfidence}`] };
    if (ev <= this.minEv) return { ...common, action: "REJECT", gate: "ev", reasons: [`EV_${ev.toFixed(4)}_NOT_POSITIVE_AFTER_COSTS`] };
    this.gos++;
    return { ...common, action: "GO", gate: null, reasons: [].concat(est.reasons || ["all gates passed"]).map(String) };
  }
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function round(v) { return Math.round(v * 1e6) / 1e6; }
