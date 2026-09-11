// ═══ VELOCITY — Exit plans and monitor (DP5) ═══
// Every position gets its plan at entry from the static table, as a pure
// function of (venue, key). The monitor evaluates the plan on every tick, in
// bondli's layer order for pump.fun, and executes nothing itself: it returns
// an action for the engine to route through DP4.

import { createExitPlan, runExitChecks } from "../../autoape/pipeline.js";
import { planFor } from "./plans.mjs";
import { withClock } from "./pipeline.mjs";
const CURVE = v => v === "pumpfun" || v === "pons";

export const PUMPFUN_EXIT_SETTINGS = Object.freeze({ momentumExit: true, sl1Sell: 80 });

export function createPlan({ venue, key, entry = {} }) {
  const base = planFor(venue, key);
  if (CURVE(venue)) {
    return {
      venue, key, mode: base.mode, worst_case_fraction: base.worst_case_fraction, max_hold_ms: base.max_hold_ms,
      bondli: { ...createExitPlan(base.tier ?? Number(key), Number(entry.score) || 0, base.stop_pct ? { ...PUMPFUN_EXIT_SETTINGS, sl2: base.stop_pct } : PUMPFUN_EXIT_SETTINGS), maxHoldMs: base.max_hold_ms },
      settings: { ...PUMPFUN_EXIT_SETTINGS },
    };
  }
  if (venue === "polymarket") {
    const entryPrice = Number(entry.price) || null;
    return {
      venue, key, mode: base.mode, worst_case_fraction: base.worst_case_fraction, max_hold_ms: base.max_hold_ms,
      entry_price: entryPrice,
      stop_price: base.stop_pct != null && entryPrice ? +(entryPrice * (1 - base.stop_pct / 100)).toFixed(4) : null,
      target_price: base.target_pct != null && entryPrice ? +Math.min(0.999, entryPrice * (1 + base.target_pct / 100)).toFixed(4) : null,
    };
  }
  throw new Error(`no plan builder for venue ${venue}`);
}

export function assertHasPlan(position) {
  if (!position?.plan || !position.plan.venue || position.plan.mode == null) throw new Error(`position ${position?.id} has no exit plan`);
  return position.plan;
}

/** Update mark, peak and PnL from a tick. Returns the position. */
export function markPosition(position, tick) {
  const p = tick.payload || {};
  if (CURVE(position.venue)) {
    const mcap = Number(p.mcapUsd) || 0;
    if (mcap > 0) {
      position.mark = mcap;
      position.peak = Math.max(position.peak || position.entryMark || mcap, mcap);
      position.changePct = position.entryMark > 0 ? ((mcap - position.entryMark) / position.entryMark) * 100 : 0;
    }
  } else if (position.venue === "polymarket") {
    const price = Number(p.price ?? p.bestBid) || 0;
    if (price > 0) {
      position.mark = price;
      position.peak = Math.max(position.peak || position.entryMark || price, price);
      position.changePct = position.entryMark > 0 ? ((price - position.entryMark) / position.entryMark) * 100 : 0;
    }
    if (p.resolved) position.resolved = { outcome: p.outcome ?? null, at: tick.t_observed };
  }
  position.unrealized_usd = +(((position.changePct || 0) / 100) * (position.notional_usd || 0)).toFixed(2);
  position.lastTickAt = tick.t_observed;
  return position;
}

/**
 * Evaluate the plan on a tick. Returns null (hold) or
 * { action: SELL|PARTIAL_SELL|REDEEM, pct, reason, layer, detail }.
 * Plan adjustments (WIDEN_TPS, TIGHTEN_SLS) are applied in place and return null.
 */
export function evaluateExit(position, tick, { now = tick.t_observed } = {}) {
  const plan = assertHasPlan(position);
  const held = now - (position.entryTime || now);
  if (CURVE(position.venue)) return evaluatePumpfun(position, tick, plan, now, held);
  if (position.venue === "polymarket") return evaluatePolymarket(position, tick, plan, now, held);
  return null;
}

function evaluatePumpfun(position, tick, plan, now, held) {
  const p = tick.payload || {};
  const token = p.token ? { ...p.token, mcapUsd: Number(p.mcapUsd) || p.token.mcapUsd || 0, vSolInBondingCurve: Number(p.vSolInBondingCurve) || p.token.vSolInBondingCurve || 0 }
    : { mcapUsd: Number(p.mcapUsd) || 0, vSolInBondingCurve: Number(p.vSolInBondingCurve) || 0 };
  // The time stop needs no price: a token that left the radar or went to zero still gets sold.
  if (held > plan.max_hold_ms) return { action: "SELL", pct: 100, reason: "MAX_HOLD", layer: 2, detail: `${Math.round(held / 60000)}min` };
  if (!(token.mcapUsd > 0)) return null;
  const pos = position._bondli || (position._bondli = {
    entryMcap: position.entryMark, peakMcap: position.peak || position.entryMark, tier: Number(plan.key), entryScore: position.entryScore || 0,
    entryTime: position.entryTime, tpHit: 0, slHit: 0, isMoonbag: false, exitPlan: plan.bondli,
  });
  pos.liveScore = Number(p.scores?.apeScore ?? pos.liveScore ?? pos.entryScore) || 0;
  pos.liveUB = token.uniqueBuyers?.size ?? pos.liveUB ?? 0;
  pos.liveBuys = token.buys ?? pos.liveBuys ?? 0;
  const r = withClock(now, () => runExitChecks(pos, token, p.dynamics || null, plan.settings));
  position.peak = pos.peakMcap;
  if (!r) return null;
  if (r.action === "WIDEN_TPS") {
    const tp = pos.exitPlan.tpLevels; const m = r.multiplier || 1.25;
    pos.exitPlan.tpLevels = { ...tp, tp1: Math.round(tp.tp1 * m), tp2: Math.round(tp.tp2 * m), tp3: tp.tp3 ? Math.round(tp.tp3 * m) : 0 };
    position.planAdjustments = (position.planAdjustments || []).concat({ at: now, ...r });
    return null;
  }
  if (r.action === "TIGHTEN_SLS") {
    pos.exitPlan.stopLoss = +(pos.exitPlan.stopLoss * (r.multiplier || 0.75)).toFixed(2);
    position.planAdjustments = (position.planAdjustments || []).concat({ at: now, ...r });
    return null;
  }
  if (r.action === "PARTIAL_SELL") {
    if (/^TP1|trailing|fade-trim|momentum-trim/.test(r.reason)) pos.tpHit = Math.max(pos.tpHit, 1);
    if (r.reason === "TP2") pos.tpHit = Math.max(pos.tpHit, 2);
    if (r.reason === "TP3") { pos.tpHit = 3; pos.isMoonbag = !!r.moonbag; }
    if (r.reason === "SL1") pos.slHit = 1;
    return { action: "PARTIAL_SELL", pct: r.pct, reason: r.reason, layer: r.layer, detail: r.detail || null };
  }
  return { action: "SELL", pct: 100, reason: r.reason, layer: r.layer, detail: r.detail || null };
}

function evaluatePolymarket(position, tick, plan, now, held) {
  const p = tick.payload || {};
  if (p.resolved || position.resolved) return { action: "REDEEM", pct: 100, reason: "RESOLVED", layer: 0, detail: p.outcome ?? null };
  const price = Number(p.price ?? p.bestBid) || position.mark || 0;
  if (plan.stop_price != null && price > 0 && price <= plan.stop_price) return { action: "SELL", pct: 100, reason: "STOP", layer: 2, detail: `${price} <= ${plan.stop_price}` };
  if (plan.target_price != null && price > 0 && price >= plan.target_price) return { action: "SELL", pct: 100, reason: "TARGET", layer: 3, detail: `${price} >= ${plan.target_price}` };
  if (held > plan.max_hold_ms) return { action: plan.mode === "hold_to_redeem" ? "SELL" : "SELL", pct: 100, reason: "MAX_HOLD", layer: 2, detail: `${Math.round(held / 3_600_000)}h` };
  return null;
}
