// t42 — Fleet execution planner: derivation, contention, slicing, exit order, funding.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveFleet, seededRng, contention, planEntry, planExit, fundingPlan, sweepPlan, HEADROOM, FLEET_MAX,
} from "../../src/velocity/core/fleet.mjs";

const W = ["w0", "w1", "w2", "w3"];

test("derived sub-wallets are deterministic, distinct, and venue-scoped", () => {
  const a = deriveFleet({ rootSecret: "root-secret", venue: "pumpfun", size: 4 });
  const b = deriveFleet({ rootSecret: "root-secret", venue: "pumpfun", size: 4 });
  assert.equal(a.length, 4);
  a.forEach((s, i) => { assert.equal(s.length, 32); assert.ok(s.equals(b[i]), "same root replays the same fleet"); });
  const hex = new Set(a.map(s => s.toString("hex")));
  assert.equal(hex.size, 4, "no two sub-wallets collide");

  // A seed must not carry across venues, or one venue's leak becomes every venue's.
  const other = deriveFleet({ rootSecret: "root-secret", venue: "pons", size: 4 });
  other.forEach((s, i) => assert.ok(!s.equals(a[i]), "venue is inside the HMAC message"));

  // And the root itself never appears in a derived seed.
  const root = Buffer.from("root-secret", "utf8");
  a.forEach(s => assert.ok(!s.includes(root), "no root material leaks into a sub-seed"));

  assert.equal(deriveFleet({ rootSecret: "r", venue: "arc", size: 99 }).length, FLEET_MAX, "size is clamped");
  assert.equal(deriveFleet({ rootSecret: "r", venue: "arc", size: 0 }).length, 1);
  assert.throws(() => deriveFleet({ venue: "arc" }), /root secret/);
});

test("seededRng replays and stays in range", () => {
  const a = seededRng("s"), b = seededRng("s");
  for (let i = 0; i < 200; i++) { const v = a(); assert.equal(v, b()); assert.ok(v >= 0 && v < 1); }
});

test("contention rises with the crowd and with one-sided flow", () => {
  const alone = contention({ uniqueBuyers: 0, buyPressure: 0.5, volumeRate: 0, stake_usd: 50 });
  const busy = contention({ uniqueBuyers: 8, buyPressure: 0.95, volumeRate: 500, stake_usd: 50 });
  assert.ok(alone < 0.3, `alone should be quiet, got ${alone}`);
  assert.ok(busy > 0.8, `a one-sided crowd should be loud, got ${busy}`);
  // Balanced two-sided flow is cheaper to wait in than the same number of one-sided buyers.
  assert.ok(contention({ uniqueBuyers: 5, buyPressure: 0.5, volumeRate: 10, stake_usd: 50 })
          < contention({ uniqueBuyers: 5, buyPressure: 1.0, volumeRate: 10, stake_usd: 50 }));
  for (const l of [alone, busy]) assert.ok(l >= 0 && l <= 1);
});

test("slicing inverts with contention: alone we buy information, raced we take the fill", () => {
  const quiet = planEntry({ stake_usd: 60, wallets: W, lambda: 0.05, seed: "t" });
  const raced = planEntry({ stake_usd: 60, wallets: W, lambda: 0.95, seed: "t" });
  assert.equal(quiet.n, 4, "the whole fleet when nothing is racing us");
  assert.equal(raced.n, 1, "one order when every second costs the fill");
  assert.ok(quiet.spanMs > 5_000 && raced.spanMs < 200, "the stagger is the wait we can afford");
  // The abort right is the only reason to slice; it is strict only when there is time to use it.
  assert.ok(quiet.slices[0].abort_if_impact_bps < raced.slices[0].abort_if_impact_bps);
});

test("an entry plan spends the stake exactly, in order, on distinct wallets", () => {
  for (const lambda of [0, 0.25, 0.5, 0.75, 1]) {
    const p = planEntry({ stake_usd: 37.5, wallets: W, lambda, seed: `l${lambda}` });
    const sum = p.slices.reduce((a, s) => a + s.stake_usd, 0);
    assert.ok(Math.abs(sum - 37.5) < 1e-6, `λ=${lambda} spends the stake, got ${sum}`);
    assert.equal(new Set(p.slices.map(s => s.wallet)).size, p.slices.length, "one slice per wallet");
    p.slices.forEach(s => assert.ok(s.stake_usd > 0));
    for (let i = 1; i < p.slices.length; i++) assert.ok(p.slices[i].at_ms >= p.slices[i - 1].at_ms, "never goes backwards");
    p.slices.forEach((s, k) => assert.equal(s.order, k));
  }
});

test("weights are not mechanical — two entries do not share a shape", () => {
  const a = planEntry({ stake_usd: 100, wallets: W, lambda: 0.1, seed: "a" }).slices.map(s => s.stake_usd);
  const b = planEntry({ stake_usd: 100, wallets: W, lambda: 0.1, seed: "b" }).slices.map(s => s.stake_usd);
  assert.notDeepEqual(a, b, "equal slices across equal wallets are a fingerprint, not a disguise");
  // ...but the same seed replays, or a backtest is fiction.
  assert.deepEqual(a, planEntry({ stake_usd: 100, wallets: W, lambda: 0.1, seed: "a" }).slices.map(s => s.stake_usd));
});

test("a stake too small to slice is one order, not a fee donation", () => {
  const p = planEntry({ stake_usd: 5, wallets: W, lambda: 0, minSliceUsd: 2, seed: "s" });
  assert.equal(p.n, 2, "$5 at a $2 floor is two slices, not four");
  p.slices.forEach(s => assert.ok(s.stake_usd >= 2));
  assert.equal(planEntry({ stake_usd: 1.5, wallets: W, lambda: 0, minSliceUsd: 2, seed: "s" }).n, 1);
  assert.deepEqual(planEntry({ stake_usd: 0, wallets: W }).slices, []);
});

test("exit sells the big positions first and never two wallets in one block", () => {
  const holdings = [{ wallet: "a", qty: 10 }, { wallet: "b", qty: 90 }, { wallet: "c", qty: 50 }];
  const { legs, urgent } = planExit({ holdings, pct: 100, signal: "HOLD", seed: "e" });
  assert.equal(urgent, false);
  assert.deepEqual(legs.map(l => l.wallet), ["b", "c", "a"], "fees are the one cost a fleet multiplies");
  assert.equal(legs[0].at_ms, 0);
  for (let i = 1; i < legs.length; i++) {
    assert.ok(legs[i].at_ms > legs[i - 1].at_ms, "a simultaneous sell from correlated addresses is the cascade we detect in others");
  }
  assert.equal(legs.reduce((a, l) => a + l.qty, 0), 150);
});

test("a cascade is not a time to be clever", () => {
  const holdings = [{ wallet: "a", qty: 10 }, { wallet: "b", qty: 90 }];
  for (const sig of ["SELL_NOW"]) {
    const { legs, urgent } = planExit({ holdings, pct: 100, signal: sig, sellMultiplier: 2.5, seed: "e" });
    assert.equal(urgent, true);
    assert.deepEqual(legs.map(l => l.at_ms), [0, 0], "every wallet, at once");
  }
  // sellMultiplier alone is enough — the governor can force it without a signal change.
  assert.equal(planExit({ holdings, pct: 100, sellMultiplier: 3, seed: "e" }).urgent, true);
});

test("RIDE takes the rung from the big positions and leaves the tail in", () => {
  const holdings = [{ wallet: "a", qty: 10 }, { wallet: "b", qty: 90 }, { wallet: "c", qty: 50 }];
  const r = planExit({ holdings, pct: 50, signal: "RIDE", seed: "e" });
  assert.deepEqual(r.held_back, ["a"], "the runner stays in the smallest, most expensive-to-exit position");
  assert.deepEqual(r.legs.map(l => l.wallet), ["b", "c"]);
  // A full rung is a full exit whatever the signal says — the ladder outranks the read.
  assert.deepEqual(planExit({ holdings, pct: 100, signal: "RIDE", seed: "e" }).held_back, []);
  assert.deepEqual(planExit({ holdings: [], pct: 50 }).legs, []);
  assert.deepEqual(planExit({ holdings: [{ wallet: "a", qty: 0 }], pct: 50 }).legs, []);
});

test("funding covers stake plus each wallet's own gas and rent, and credits what is there", () => {
  const slices = [{ wallet: "a", stake_usd: 20 }, { wallet: "b", stake_usd: 10 }];
  const f = fundingPlan({ venue: "pumpfun", slices, balances: {}, nativePriceUsd: 200 });
  const h = HEADROOM.pumpfun;
  assert.equal(f.transfers.length, 2);
  assert.ok(Math.abs(f.transfers[0].amount - (0.1 + h.gas + h.rent)) < 1e-9);
  assert.ok(Math.abs(f.overhead - 2 * (h.gas + h.rent)) < 1e-9, "the overhead is why the fleet is small");
  // A wallet already holding enough is not topped up.
  const g = fundingPlan({ venue: "pumpfun", slices, balances: { a: 1 }, nativePriceUsd: 200 });
  assert.deepEqual(g.transfers.map(t => t.to), ["b"]);
  assert.throws(() => fundingPlan({ venue: "pumpfun", slices, nativePriceUsd: 0 }), /native price/);
});

test("the sweep leaves behind anything that costs more to move than it is worth", () => {
  const h = HEADROOM.pons;
  const s = sweepPlan({ venue: "pons", root: "root", balances: { root: 5, a: 0.5, b: h.gas * 1.5 } });
  assert.deepEqual(s.transfers.map(t => t.from), ["a"], "the root is not swept into itself");
  assert.deepEqual(s.dust, ["b"], "dust funds the next entry instead of being burnt moving it");
  assert.ok(Math.abs(s.transfers[0].amount - (0.5 - h.gas)) < 1e-9);
});
