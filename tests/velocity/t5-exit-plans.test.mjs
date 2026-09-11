// T5: every entry gets a plan; each layer fires in simulation at its trigger.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlan, evaluateExit, markPosition, assertHasPlan } from "../../src/velocity/core/exits.mjs";
import { makeEvent } from "../../src/velocity/core/events.mjs";
import { EXIT_PLANS } from "../../src/velocity/core/plans.mjs";

const T0 = 1_700_000_000_000;

function pumpPos(over = {}) {
  const plan = createPlan({ venue: "pumpfun", key: 2, entry: { score: 66 } });
  return { id: "p1", venue: "pumpfun", instrument: "MintA", entryTime: T0, entryMark: 10_000, peak: 10_000, notional_usd: 20, entryScore: 66, plan, ...over };
}
function tick(mcapUsd, over = {}, at = T0 + 60_000) {
  const token = { ca: "MintA", buys: 50, sells: 10, trades: [], volumeSol: 20, createdAt: T0 - 120_000, uniqueBuyers: { size: 30 }, mcapUsd, vSolInBondingCurve: 20, ...over.token };
  return makeEvent({ venue: "pumpfun", kind: "tick", id: "MintA", t_venue: at - 100, t_observed: at, payload: { mcapUsd, token, dynamics: over.dynamics || { scores: 5, velocity: 0.05, acceleration: 0, trend: "stable" }, scores: over.scores || { apeScore: 66 }, vSolInBondingCurve: over.curve ?? 20 } });
}

test("T5: every venue/tier key in the table yields a complete plan", () => {
  for (const key of Object.keys(EXIT_PLANS.pumpfun)) {
    const p = createPlan({ venue: "pumpfun", key, entry: { score: 70 } });
    assert.equal(p.venue, "pumpfun");
    assert.ok(p.bondli.stopLoss > 0 && p.bondli.tpLevels.tp1 > 0 && p.max_hold_ms > 0);
    assert.equal(p.worst_case_fraction, 1);
  }
  for (const key of Object.keys(EXIT_PLANS.polymarket)) {
    const p = createPlan({ venue: "polymarket", key, entry: { price: 0.9 } });
    assert.ok(p.mode && p.max_hold_ms > 0);
  }
  const rf = createPlan({ venue: "polymarket", key: "resolved_fact", entry: { price: 0.96 } });
  assert.equal(rf.stop_price, 0.72);
  assert.throws(() => assertHasPlan({ id: "x" }), /no exit plan/);
  assert.throws(() => createPlan({ venue: "pumpfun", key: 9 }), /no exit plan/);
});

test("T5: pump.fun layers fire at their triggers", () => {
  // Layer 1: crashing score
  let pos = pumpPos();
  markPosition(pos, tick(10_500));
  let r = evaluateExit(pos, tick(10_500, { dynamics: { scores: 4, velocity: -0.5, acceleration: -0.1, trend: "crashing" } }));
  assert.equal(r.action, "SELL"); assert.equal(r.reason, "crash-exit"); assert.equal(r.layer, 1);
  // Layer 3: TP1 partial
  pos = pumpPos();
  r = evaluateExit(pos, tick(14_000));
  assert.equal(r.action, "PARTIAL_SELL"); assert.equal(r.reason, "TP1");
  assert.equal(pos._bondli.tpHit, 1);
  // Layer 2: SL2 full exit past twice the stop
  pos = pumpPos();
  r = evaluateExit(pos, tick(7_000));
  assert.equal(r.action, "SELL"); assert.equal(r.reason, "SL2"); assert.equal(r.layer, 2);
  // Layer 2: SL1 partial at the stop
  pos = pumpPos();
  r = evaluateExit(pos, tick(8_700));
  assert.equal(r.action, "PARTIAL_SELL"); assert.equal(r.reason, "SL1");
  // Layer 4: graduation
  pos = pumpPos();
  r = evaluateExit(pos, tick(11_000, { curve: 80, token: { vSolInBondingCurve: 80 } }));
  assert.equal(r.layer, 4);
  // Max hold from the static table
  pos = pumpPos();
  r = evaluateExit(pos, tick(10_500, {}, T0 + 16 * 60_000));
  assert.equal(r.action, "SELL"); assert.ok(/MAX_HOLD/.test(r.reason));
  // Runner: widen TPs is a plan adjustment, not an order
  pos = pumpPos();
  const before = pos.plan.bondli.tpLevels.tp1;
  r = evaluateExit(pos, tick(10_800, { dynamics: { scores: 5, velocity: 0.4, acceleration: 0.05, trend: "rocket" } }));
  assert.equal(r, null);
  assert.ok(pos._bondli.exitPlan.tpLevels.tp1 > before);
  assert.equal(pos.planAdjustments.length, 1);
});

test("T5: polymarket plans redeem, stop, target, and time out", () => {
  const rf = { id: "q1", venue: "polymarket", instrument: "A1", entryTime: T0, entryMark: 0.96, notional_usd: 50, plan: createPlan({ venue: "polymarket", key: "resolved_fact", entry: { price: 0.96 } }) };
  const mk = (payload, at = T0 + 1000) => makeEvent({ venue: "polymarket", kind: "tick", id: "A1", t_venue: at - 10, t_observed: at, payload });
  assert.equal(evaluateExit(rf, mk({ price: 0.97 })), null);
  assert.equal(evaluateExit(rf, mk({ price: 0.5 })).reason, "STOP");
  assert.equal(evaluateExit(rf, mk({ resolved: true, outcome: "Yes" })).action, "REDEEM");
  assert.equal(evaluateExit(rf, mk({ price: 0.97 }, T0 + 15 * 24 * 3_600_000)).reason, "MAX_HOLD");
  const sq = { id: "q2", venue: "polymarket", instrument: "B1", entryTime: T0, entryMark: 0.5, notional_usd: 50, plan: createPlan({ venue: "polymarket", key: "stale_quote", entry: { price: 0.5 } }) };
  assert.equal(evaluateExit(sq, mk({ price: 0.54 })).reason, "TARGET");
  assert.equal(evaluateExit(sq, mk({ price: 0.47 })).reason, "STOP");
  markPosition(sq, mk({ price: 0.52 }));
  assert.equal(sq.unrealized_usd, 2);
});

test("T5: after TP2 a runner is trailed: a tier-3 plan with no TP3 sells 100% when it gives back 22% from the peak", () => {
  // tier 3: TP1 at +30%, TP2 at +75%, no TP3. Before this rule the last third rode until the stop or max hold.
  const plan3 = createPlan({ venue: "pumpfun", key: 3, entry: { score: 60 } });
  const pos = pumpPos({ plan: plan3 });
  assert.equal(evaluateExit(pos, tick(13_000)).reason, "TP1");
  assert.equal(evaluateExit(pos, tick(17_600)).reason, "TP2");
  assert.equal(pos._bondli.tpHit, 2);
  // +150% peak, then 10% off: hold
  evaluateExit(pos, tick(25_000)); assert.equal(evaluateExit(pos, tick(22_500)), null);
  // 22% off the peak at +95%: sell everything (under 3x there is no moonbag to keep)
  const r = evaluateExit(pos, tick(19_500));
  assert.equal(r?.action, "SELL"); assert.equal(r.pct, 100); assert.equal(r.reason, "TP-trail");
  // a tier-2 plan between TP2 (+100%) and TP3 (+250%) gets the same protection
  const pos2 = pumpPos({ plan: createPlan({ venue: "pumpfun", key: 2, entry: { score: 60 } }) });
  evaluateExit(pos2, tick(13_500)); evaluateExit(pos2, tick(20_000)); assert.equal(pos2._bondli.tpHit, 2);
  markPosition(pos2, tick(30_000));
  assert.equal(evaluateExit(pos2, tick(22_000))?.reason, "TP-trail", "+120% and 27% off its +200% peak");
});

test("T5: dead money is sold: three minutes flat with no buyers is a STALL exit on a tier-3 plan", () => {
  const plan3 = createPlan({ venue: "pumpfun", key: 3, entry: { score: 60 } });
  assert.equal(plan3.stall_ms, 3 * 60_000);
  const pos = pumpPos({ plan: plan3 });
  const quiet = { token: { trades: [{ side: "buy", time: T0 + 60_000 }, { side: "sell", time: T0 + 170_000 }] } };
  // two minutes in, flat, quiet: hold (not old enough)
  assert.equal(evaluateExit(pos, tick(10_300, quiet, T0 + 2 * 60_000)), null);
  // three minutes in, +3%, one buy in the last minute: STALL
  const r = evaluateExit(pos, tick(10_300, quiet, T0 + 3 * 60_000 + 1000));
  assert.equal(r?.action, "SELL"); assert.equal(r.reason, "STALL"); assert.equal(r.pct, 100);
  // three minutes in but buying is alive: hold
  const busy = { token: { trades: Array.from({ length: 6 }, (_, i) => ({ side: "buy", time: T0 + 3 * 60_000 - i * 5000 })) } };
  const pos2 = pumpPos({ plan: plan3 });
  assert.equal(evaluateExit(pos2, tick(10_300, busy, T0 + 3 * 60_000 + 1000)), null);
  // three minutes in, flat now, but it peaked +20% earlier: not dead money, the trail rules own it
  const pos3 = pumpPos({ plan: plan3 });
  evaluateExit(pos3, tick(12_000, quiet, T0 + 60_000));
  assert.notEqual(evaluateExit(pos3, tick(10_300, quiet, T0 + 3 * 60_000 + 1000))?.reason, "STALL");
});

test("T5: a PONS position is sold at 85% curve progress whatever the P&L: the bot cannot sell after graduation", () => {
  const pos = { ...pumpPos({ plan: createPlan({ venue: "pons", key: 3, entry: { score: 60 } }) }), venue: "pons", instrument: "0xabc" };
  const t = (mc, curve) => { const e = tick(mc, { token: { _curvePct: curve, ca: "0xabc" } }); e.venue = "pons"; return e; };
  assert.equal(evaluateExit(pos, t(10_200, 0.5)), null);
  const r = evaluateExit(pos, t(10_200, 0.86));
  assert.equal(r?.action, "SELL"); assert.equal(r.pct, 100); assert.equal(r.reason, "pre-graduation-exit");
});

test("T5: a runner keeps its moonbag on every tier, and the moonbag outlives the time limit", () => {
  // tier 3: TP1 +30%, TP2 +75%, then the trail at +300% sells 90% and keeps 10%
  const pos = pumpPos({ plan: createPlan({ venue: "pumpfun", key: 3, entry: { score: 60 } }) });
  evaluateExit(pos, tick(13_000)); evaluateExit(pos, tick(17_600));
  evaluateExit(pos, tick(40_000)); // the peak, +300%
  assert.equal(evaluateExit(pos, tick(30_000)), null, "at 3x a runner gets 40% of room");
  const r = evaluateExit(pos, tick(22_000)); // +120%, 45% off the peak
  assert.equal(r?.reason, "TP-trail"); assert.equal(r.action, "PARTIAL_SELL"); assert.equal(r.pct, 90);
  assert.equal(pos._bondli.isMoonbag, true);
  // the moonbag is not sold at the plan's 10-minute limit
  assert.equal(evaluateExit(pos, tick(22_000, {}, T0 + 25 * 60_000)), null);
  // it dies at -80% from entry, or gives back its own wide trail
  assert.equal(evaluateExit(pos, tick(1_900, {}, T0 + 26 * 60_000))?.reason, "moonbag-dead");
  // tier 2 through TP3 at +250%: sells 85%, keeps 15%
  const pos2 = pumpPos();
  evaluateExit(pos2, tick(13_500)); evaluateExit(pos2, tick(20_000)); evaluateExit(pos2, tick(36_000));
  evaluateExit(pos2, tick(60_000)); // +500% peak
  const r2 = evaluateExit(pos2, tick(35_000)); // 42% off the peak at +250%: past the 40% room a 3x runner gets
  assert.equal(r2?.reason, "TP3"); assert.equal(r2.pct, 85); assert.equal(pos2._bondli.isMoonbag, true);
  // a token that only made +120% before the trail is sold in full: no moon, no moonbag
  const pos3 = pumpPos({ plan: createPlan({ venue: "pumpfun", key: 3, entry: { score: 60 } }) });
  evaluateExit(pos3, tick(13_000)); evaluateExit(pos3, tick(17_600)); evaluateExit(pos3, tick(22_000));
  const r3 = evaluateExit(pos3, tick(16_500));
  assert.equal(r3?.reason, "TP-trail"); assert.equal(r3.pct, 100);
});
