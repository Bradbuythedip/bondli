// t46 — Keeping the fleet funded, and never during an entry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { maintenancePlan, readyWallets, REFILL_AT, SWEEP_WORTH } from "../../src/velocity/core/treasury.mjs";
import { HEADROOM } from "../../src/velocity/core/fleet.mjs";

const H = HEADROOM.pumpfun;
const PRICE = 200;
// One slice of $10 plus the wallet's own gas and rent.
const TARGET = 10 / PRICE + H.gas + H.rent;
const base = { venue: "pumpfun", root: "root", perSliceUsd: 10, nativePriceUsd: PRICE };

test("a wallet holding one slice plus its headroom is left alone", () => {
  const p = maintenancePlan({ ...base, balances: { root: 1, f0: TARGET, f1: TARGET * 1.5 } });
  assert.equal(p.direction, "fund");
  assert.ok(Math.abs(p.target - TARGET) < 1e-9, "the target is a slice plus the wallet's own gas and rent");
  assert.deepEqual(p.transfers, [], "topping up a full wallet spends gas to move nothing");
});

test("top-ups are hysteretic, or the loop moves dust back and forth every pass", () => {
  // Just above the refill line: not yet.
  const above = maintenancePlan({ ...base, balances: { root: 1, f0: TARGET * (REFILL_AT + 0.05) } });
  assert.deepEqual(above.transfers, []);
  // Just below it: refilled to the target, not to the line.
  const below = maintenancePlan({ ...base, balances: { root: 1, f0: TARGET * (REFILL_AT - 0.05) } });
  assert.equal(below.transfers.length, 1);
  assert.equal(below.transfers[0].to, "f0");
  assert.ok(Math.abs(below.transfers[0].amount - (TARGET - TARGET * (REFILL_AT - 0.05))) < 1e-9);
});

test("a root that cannot fund everyone funds the emptiest first, and never half-funds", () => {
  const p = maintenancePlan({ ...base, balances: { root: TARGET * 2.2, f0: TARGET * 0.4, f1: 0, f2: TARGET * 0.1 } });
  assert.deepEqual(p.transfers.map(t => t.to), ["f1", "f2"], "the wallets that most need it, not the first two listed");
  assert.equal(p.short, 1, "and the shortfall is reported rather than hidden");
  // f0 would have taken more than was left, and a half-funded wallet fails its slice anyway.
  assert.ok(!p.transfers.some(t => t.to === "f0"));
  assert.ok(p.transfers.reduce((s, t) => s + t.amount, 0) <= TARGET * 2.2);
});

test("the root keeps its own reserve whatever the fleet needs", () => {
  const rich = maintenancePlan({ ...base, balances: { root: 1, f0: 0 } });
  assert.equal(rich.transfers.length, 1);
  const reserved = maintenancePlan({ ...base, balances: { root: 1, f0: 0 }, rootReserve: 1 });
  assert.deepEqual(reserved.transfers, [], "a reserve the fleet can eat is not a reserve");
  assert.equal(reserved.short, 1);
});

test("idle brings the working capital home, leaving anything not worth the trip", () => {
  const p = maintenancePlan({ ...base, idle: true, balances: { root: 0.1, f0: 0.05, f1: H.gas * 2, f2: 0 } });
  assert.equal(p.direction, "sweep");
  assert.deepEqual(p.transfers.map(t => t.from), ["f0"], "a balance spread across addresses is one the operator cannot see");
  assert.ok(Math.abs(p.transfers[0].amount - (0.05 - H.gas)) < 1e-9);
  assert.equal(p.transfers[0].to, "root");
  // The threshold is the gas the sweep itself burns, several times over.
  const worth = maintenancePlan({ ...base, idle: true, balances: { root: 0, f0: H.gas * (SWEEP_WORTH + 2) } });
  assert.equal(worth.transfers.length, 1);
});

test("the root is never swept into itself, in either direction", () => {
  assert.ok(!maintenancePlan({ ...base, idle: true, balances: { root: 5 } }).transfers.length);
  assert.ok(!maintenancePlan({ ...base, balances: { root: 5 } }).transfers.length);
});

test("no price means no plan, rather than a plan sized in nothing", () => {
  assert.throws(() => maintenancePlan({ ...base, nativePriceUsd: 0, balances: { root: 1 } }), /native price/);
});

test("readyWallets reports the fleet that exists, not the one configured", () => {
  const balances = { root: 10, f0: TARGET, f1: TARGET * 0.5, f2: TARGET * 2 };
  assert.deepEqual(readyWallets({ ...base, balances }), ["f0", "f2"], "a wallet that cannot pay for its slice is not in the fleet");
  assert.deepEqual(readyWallets({ ...base, balances, nativePriceUsd: 0 }), [], "without a price nothing is known to be ready");
  assert.ok(!readyWallets({ ...base, balances }).includes("root"), "the root is not a slice");
});
