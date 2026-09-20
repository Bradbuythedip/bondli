// t44 — Running a fleet plan: aggregation, the abort right, and partial failure.
//
// The interesting cases are all the ones where the plan does not run to completion, because the
// engine upstream gets one position either way and everything it later does — the exit ladder, the
// stop, the outcome the Kelly sizer learns from — is computed from the numbers this returns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { executeFleetEntry, executeFleetExit } from "../../src/velocity/core/fleet-entry.mjs";
import { planEntry, planExit } from "../../src/velocity/core/fleet.mjs";

const order = { id: "o1", decisionId: "d1", instrument: "M", stake_usd: 40, reference: { solPrice: 200 } };
const plan4 = planEntry({ stake_usd: 40, wallets: ["f0", "f1", "f2", "f3"], lambda: 0, seed: "t44" });

/** A router double that fills at a price the test controls, and records the order it was given. */
function filler(prices, { failAt = -1, throwAt = -1 } = {}) {
  const seen = [];
  let i = 0;
  return {
    seen,
    async submit(o) {
      const n = i++;
      seen.push(o);
      if (n === throwAt) throw new Error("rpc exploded");
      if (n === failAt) return { ok: false, failure: { code: "INSUFFICIENT_SOL", reason: `wallet ${o.actor} is empty` } };
      const price = prices[n] ?? prices[prices.length - 1];
      return { ok: true, fill: { venue: "pumpfun", instrument: o.instrument, side: "BUY", price, qty: o.stake_usd / price, notional_usd: o.stake_usd, fee_usd: 0.05, rent_usd: 0.41, sol_spent: o.stake_usd / 200, t_sent: 1000 + n * 10, t_filled: 1005 + n * 10, latency_ms: 5, venue_ref: `SIG${n}`, exact: true, actor: o.actor, wallet: `PK_${o.actor}` } };
    },
  };
}
const noSleep = async () => {};

test("a fleet entry comes back as one position", async () => {
  const f = filler([0.01, 0.01, 0.01, 0.01]);
  const r = await executeFleetEntry({ plan: plan4, order, submit: f.submit, sleep: noSleep });
  assert.equal(r.ok, true);
  assert.equal(r.aborted, null);
  assert.equal(r.fill.slices, 4);
  assert.equal(r.fill.orderId, "o1", "the engine's order id survives, not the last slice's");
  assert.ok(Math.abs(r.fill.notional_usd - 40) < 1e-6, "the whole stake is spent");
  assert.ok(Math.abs(r.fill.qty - 4000) < 1e-6);
  assert.equal(r.fill.price, 0.01, "one weighted entry price");
  assert.equal(r.fill.unspent_usd, 0);
  assert.ok(Math.abs(r.fill.fee_usd - 0.2) < 1e-9, "fees are the one cost a fleet multiplies");
  assert.ok(Math.abs(r.fill.rent_usd - 1.64) < 1e-9, "four wallets, four rent deposits");
  assert.equal(r.fill.venue_refs.length, 4);
  // The per-wallet list is the only new thing the engine has to carry, and the exit needs it.
  assert.deepEqual(r.fill.wallets.map(w => w.actor), ["f0", "f1", "f2", "f3"]);
  assert.ok(Math.abs(r.fill.wallets.reduce((s, w) => s + w.qty, 0) - r.fill.qty) < 1e-9);
  // Each slice was sent with its own actor, its own stake and its own id.
  assert.deepEqual(f.seen.map(o => o.actor), ["f0", "f1", "f2", "f3"]);
  assert.deepEqual(f.seen.map(o => o.id), ["o1:s0", "o1:s1", "o1:s2", "o1:s3"]);
  assert.ok(Math.abs(f.seen.reduce((s, o) => s + o.stake_usd, 0) - 40) < 1e-6);
});

test("the entry price is weighted, not the first or the average of the prices", async () => {
  const two = planEntry({ stake_usd: 40, wallets: ["a", "b"], lambda: 0, minSliceUsd: 20, seed: "w" });
  const [s0, s1] = two.slices.map(s => s.stake_usd);
  const f = filler([0.01, 0.02]);
  const r = await executeFleetEntry({ plan: two, order, submit: f.submit, sleep: noSleep });
  const qty = s0 / 0.01 + s1 / 0.02;
  assert.ok(Math.abs(r.fill.price - 40 / qty) < 1e-12, "cost over quantity, which is what the stop is measured from");
  assert.ok(r.fill.price !== 0.015, "the mean of the prices is the wrong number and a plausible-looking one");
});

test("the abort right fires when the curve runs away from the first fill", async () => {
  // Slice 1 lands 60% above slice 0; the tolerance on a quiet entry is well under that.
  const f = filler([0.01, 0.016, 0.016, 0.016]);
  const r = await executeFleetEntry({ plan: plan4, order, submit: f.submit, sleep: noSleep });
  assert.equal(r.ok, true, "a partial ape is a position, not a failure");
  assert.equal(r.aborted.code, "ABORT_IMPACT");
  assert.match(r.aborted.reason, /6000bps above the first/);
  assert.equal(r.fill.slices, 2, "the remaining slices are buying a different token than the gates approved");
  assert.equal(f.seen.length, 2, "and they are never sent");
  assert.ok(r.fill.unspent_usd > 0, "the stake that stayed in the wallets is reported");
  assert.ok(Math.abs(r.fill.notional_usd + r.fill.unspent_usd - 40) < 1e-4);
});

test("a fill below the first price is not an abort", async () => {
  const f = filler([0.02, 0.01, 0.01, 0.01]);
  const r = await executeFleetEntry({ plan: plan4, order, submit: f.submit, sleep: noSleep });
  assert.equal(r.aborted, null, "buying cheaper than we planned is the outcome we wanted");
  assert.equal(r.fill.slices, 4);
});

test("the first slice failing is a failed entry, with nothing at risk", async () => {
  const f = filler([0.01], { failAt: 0 });
  const r = await executeFleetEntry({ plan: plan4, order, submit: f.submit, sleep: noSleep });
  assert.equal(r.ok, false);
  assert.equal(r.failure.code, "INSUFFICIENT_SOL", "the engine's own cooldown and fee handling is the right thing to run");
  assert.equal(f.seen.length, 1, "no further slices chase a failure");
  assert.equal(r.failures.length, 1);
});

test("a later slice failing keeps what we hold and stops", async () => {
  const f = filler([0.01, 0.01, 0.01, 0.01], { failAt: 2 });
  const r = await executeFleetEntry({ plan: plan4, order, submit: f.submit, sleep: noSleep });
  assert.equal(r.ok, true, "unwinding a partial ape costs a full round trip to undo a position we wanted");
  assert.equal(r.aborted.code, "SLICE_FAILED");
  assert.match(r.aborted.reason, /slice 2 on f2 failed/);
  assert.equal(r.fill.slices, 2);
  assert.equal(r.failures.length, 1);
  assert.equal(f.seen.length, 3);
});

test("a router that throws is a failure, not an exception the engine has to catch", async () => {
  const f = filler([0.01], { throwAt: 0 });
  const r = await executeFleetEntry({ plan: plan4, order, submit: f.submit, sleep: noSleep });
  assert.equal(r.ok, false);
  assert.equal(r.failure.code, "ROUTER_THREW");
  const g = filler([0.01, 0.01, 0.01, 0.01], { throwAt: 1 });
  const r2 = await executeFleetEntry({ plan: plan4, order, submit: g.submit, sleep: noSleep });
  assert.equal(r2.ok, true);
  assert.equal(r2.fill.slices, 1);
});

test("an empty plan is refused rather than silently entering nothing", async () => {
  const r = await executeFleetEntry({ plan: { slices: [] }, order, submit: async () => { throw new Error("must not be called"); } });
  assert.equal(r.ok, false);
  assert.equal(r.failure.code, "NO_PLAN");
});

test("the entry waits out the plan's stagger without double-counting it", async () => {
  const waits = [];
  const plan = { slices: [{ order: 0, wallet: "a", stake_usd: 10, at_ms: 0, abort_if_impact_bps: 800 }, { order: 1, wallet: "b", stake_usd: 10, at_ms: 3000, abort_if_impact_bps: 800 }, { order: 2, wallet: "c", stake_usd: 10, at_ms: 5000, abort_if_impact_bps: 800 }] };
  const f = filler([0.01]);
  await executeFleetEntry({ plan, order, submit: f.submit, sleep: async ms => { waits.push(ms); } });
  assert.deepEqual(waits, [3000, 2000], "at_ms is an offset from the first send, not a gap between slices");
});

// ── exits ──
function seller(prices, { failAll = false, emptyAt = -1 } = {}) {
  const seen = [];
  let i = 0;
  return {
    seen,
    async close(p, pct, ctx) {
      const n = i++;
      seen.push({ actor: ctx.actor, pct, qty: p.remaining_qty });
      if (failAll || n === emptyAt) return { ok: false, failure: { code: "NO_POSITION", reason: `wallet ${ctx.actor} has no token balance to sell` } };
      const price = prices[n] ?? prices[prices.length - 1];
      const qty = 100;
      return { ok: true, fill: { venue: "pumpfun", instrument: p.instrument, side: "SELL", price, qty, notional_usd: qty * price, fee_usd: 0, sol_received: (qty * price) / 200, t_sent: 2000 + n * 10, t_filled: 2005 + n * 10, venue_ref: `SELL${n}`, exact: true, actor: ctx.actor } };
    },
  };
}

test("an exit sums its legs into one sale", async () => {
  const holdings = [{ wallet: "f0", qty: 100 }, { wallet: "f1", qty: 100 }, { wallet: "f2", qty: 100 }];
  const { legs } = planExit({ holdings, pct: 100, seed: "x" });
  const s = seller([0.02, 0.021, 0.019]);
  const r = await executeFleetExit({ legs, position: { id: "p1", instrument: "M" }, close: s.close, sleep: noSleep });
  assert.equal(r.ok, true);
  assert.equal(r.fill.legs_filled, 3);
  assert.equal(r.fill.orderId, "p1:close");
  assert.equal(r.fill.qty, 300);
  assert.ok(Math.abs(r.fill.notional_usd - (100 * 0.02 + 100 * 0.021 + 100 * 0.019)) < 1e-9);
  assert.ok(Math.abs(r.fill.price - r.fill.notional_usd / 300) < 1e-12);
  assert.deepEqual(s.seen.map(x => x.actor), ["f0", "f1", "f2"]);
  assert.deepEqual(s.seen.map(x => x.pct), [100, 100, 100]);
});

test("a leg that finds nothing is not a failure — the other wallets still hold the position", async () => {
  const holdings = [{ wallet: "f0", qty: 100 }, { wallet: "f1", qty: 100 }];
  const { legs } = planExit({ holdings, pct: 100, seed: "x" });
  const s = seller([0.02], { emptyAt: 0 });
  const r = await executeFleetExit({ legs, position: { id: "p1", instrument: "M" }, close: s.close, sleep: noSleep });
  assert.equal(r.ok, true);
  assert.equal(r.fill.legs_filled, 1);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].code, "NO_POSITION");
  assert.equal(s.seen.length, 2, "an empty wallet does not stop the legs behind it");
});

test("every leg failing is a failure, never a sale of nothing at zero", async () => {
  const holdings = [{ wallet: "f0", qty: 100 }, { wallet: "f1", qty: 100 }];
  const { legs } = planExit({ holdings, pct: 100, seed: "x" });
  const r = await executeFleetExit({ legs, position: { id: "p1", instrument: "M" }, close: seller([], { failAll: true }).close, sleep: noSleep });
  assert.equal(r.ok, false, "booking this as a close would record a total loss on a position we still hold");
  assert.equal(r.failure.code, "NO_POSITION");
  assert.equal(r.failures.length, 2);
  assert.equal((await executeFleetExit({ legs: [], position: {}, close: async () => {} })).failure.code, "NO_LEGS");
});

test("an urgent exit sends every leg without waiting", async () => {
  const holdings = [{ wallet: "f0", qty: 100 }, { wallet: "f1", qty: 100 }, { wallet: "f2", qty: 100 }];
  const { legs, urgent } = planExit({ holdings, pct: 100, signal: "SELL_NOW", sellMultiplier: 3, seed: "x" });
  assert.equal(urgent, true);
  const waits = [];
  await executeFleetExit({ legs, position: { id: "p1", instrument: "M" }, close: seller([0.02]).close, sleep: async ms => { waits.push(ms); } });
  assert.deepEqual(waits, [], "a cascade is not a time to be clever");
});
