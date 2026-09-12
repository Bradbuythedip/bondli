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
  // A crashing score with the price still up is not a crash: the score is derived off snapshots and
  // leaving costs a full round trip, so the price has to agree before the money moves.
  assert.equal(evaluateExit(pos, tick(10_500, { dynamics: { scores: 4, velocity: -0.5, acceleration: -0.1, trend: "crashing" } })), null, "+5% and 'crashing': held");
  let r = evaluateExit(pos, tick(9_800, { dynamics: { scores: 4, velocity: -0.5, acceleration: -0.1, trend: "crashing" } }));
  assert.equal(r.action, "SELL"); assert.equal(r.reason, "crash-exit"); assert.equal(r.layer, 1);
  // Layer 3: ride mode takes no partial profit on the way up — +40% is held, not scalped
  pos = pumpPos();
  assert.equal(evaluateExit(pos, tick(14_000)), null, "nothing is sold at +40%: the ladder is gone");
  // it comes out in one sell when it gives back its trail: peak +40%, 55% of the gain kept -> out at +22%
  markPosition(pos, tick(14_000));
  r = evaluateExit(pos, tick(12_100));
  assert.equal(r.action, "SELL"); assert.equal(r.pct, 100); assert.equal(r.reason, "RIDE-trail");
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

test("T5: ride mode holds all the way up and exits once, and the trail widens with the run", () => {
  // +80% peak: below 100%, so 55% of the gain is kept -> the exit trigger sits at +44%
  let pos = pumpPos();
  markPosition(pos, tick(18_000));
  assert.equal(evaluateExit(pos, tick(15_000)), null, "+50% and still above the trail: held");
  let r = evaluateExit(pos, tick(14_000));
  assert.equal(r?.reason, "RIDE-trail"); assert.equal(r.action, "SELL"); assert.equal(r.pct, 100);

  // +400% peak: 70% of the gain is kept, so it may breathe all the way back to +280% before it goes
  pos = pumpPos();
  markPosition(pos, tick(50_000));
  assert.equal(evaluateExit(pos, tick(40_000)), null, "+300% off a +400% peak is still inside the trail");
  r = evaluateExit(pos, tick(37_000));
  assert.ok(r?.reason === "RIDE-trail", "+270% finally trips it");

  // the trail can never book a loss: a +30% peak that round-trips exits at the floor, not below entry
  pos = pumpPos();
  markPosition(pos, tick(13_000));
  r = evaluateExit(pos, tick(10_500));
  assert.equal(r?.reason, "RIDE-trail");
  assert.ok(r.detail.includes("out at +5%"), r.detail);

  // below the arm there is no trail at all: only the stop loss can take it out
  pos = pumpPos();
  markPosition(pos, tick(11_500));
  assert.equal(evaluateExit(pos, tick(10_100)), null, "+1% after a +15% peak: not armed, still held");
});

test("T5: the old partial ladder is still there when ride is switched off", async () => {
  const { createExitPlan, checkTrailingExit } = await import("../../src/autoape/exit-plan.js");
  const laddered = createExitPlan(2, 66, { ride: false });
  assert.equal(laddered.tpLevels.ride, false);
  const pos = { tier: 2, entryScore: 66, entryMcap: 10_000, peakMcap: 14_000, tpHit: 0, exitPlan: laddered };
  const r = checkTrailingExit(pos, 40, 0, { ride: false });
  assert.equal(r?.action, "PARTIAL_SELL"); assert.equal(r.reason, "TP1");
  // and ride mode on the same numbers takes nothing off the table
  const riding = createExitPlan(2, 66, {});
  assert.equal(riding.tpLevels.ride, true);
  assert.equal(checkTrailingExit({ ...pos, exitPlan: riding }, 40, 0, {}), null);
});

test("T5: dead money is sold: three minutes flat with no buyers is a STALL exit on a tier-3 plan", () => {
  const plan3 = createPlan({ venue: "pumpfun", key: 3, entry: { score: 60 } });
  assert.equal(plan3.stall_ms, 2 * 60_000);
  const pos = pumpPos({ plan: plan3 });
  const quiet = { token: { trades: [{ side: "buy", time: T0 + 60_000 }, { side: "sell", time: T0 + 170_000 }] } };
  // one minute in, flat, quiet: hold (not old enough)
  assert.equal(evaluateExit(pos, tick(10_300, quiet, T0 + 60_000)), null);
  // past the stall window and going nowhere: the slot is worth more than the drift, so it is sold
  const flat = evaluateExit(pumpPos({ plan: plan3 }), tick(10_300, quiet, T0 + 3 * 60_000 + 1000));
  assert.equal(flat?.reason, "STALL", "flat and quiet no longer holds a slot to max hold");
  // same, drifting down: STALL
  const r = evaluateExit(pos, tick(9_400, quiet, T0 + 3 * 60_000 + 1000));
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

test("T5: a runner keeps its moonbag, and the moonbag outlives the time limit", () => {
  // peak 4x: past 2x, so the trail sells all but the tier's moonbag instead of everything
  const pos = pumpPos();
  markPosition(pos, tick(40_000));
  const r = evaluateExit(pos, tick(24_000));
  assert.equal(r?.reason, "RIDE-trail"); assert.equal(r.action, "PARTIAL_SELL");
  assert.equal(r.pct, 85, "tier 2 keeps 15%");
  assert.equal(pos._bondli.isMoonbag, true, "the position is now a moonbag");
  // the moonbag is not sold at the plan's time limit
  assert.equal(evaluateExit(pos, tick(24_000, {}, T0 + 26 * 60_000)), null);
  // it dies only when the token does
  assert.equal(evaluateExit(pos, tick(1_900, {}, T0 + 26 * 60_000))?.reason, "moonbag-dead");

  // a token that only made +120% is sold in full: no moon, no moonbag
  const pos3 = pumpPos();
  markPosition(pos3, tick(22_000));
  const r3 = evaluateExit(pos3, tick(13_000));
  assert.equal(r3?.reason, "RIDE-trail"); assert.equal(r3.pct, 100);
});

