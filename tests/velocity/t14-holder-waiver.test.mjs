// The house-token fee waiver: hold one and the performance fee is zero. What must hold is that it is
// inert until the token exists, that it never charges someone because a node blinked, and that it
// never invents a waiver out of a failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HolderWaiver } from "../../src/velocity/core/holder-waiver.mjs";

const ADDR = (n) => "0x" + String(n).repeat(40).slice(0, 40);
const TOKEN = "0x" + "ab".repeat(20);

function waiver({ balance = 0, clock, minTokens = 1 } = {}) {
  let t = 0;
  const w = new HolderWaiver({ token: TOKEN, minTokens, provider: {}, clock: clock || (() => t), symbol: "NOTAFLY" });
  w._balance = balance;
  w.balanceOf = async () => { if (w._throw) throw new Error("rpc down"); return w._balance; };
  w._advance = (ms) => { t += ms; };
  return w;
}

test("T14: with no token configured nothing is read and nothing is waived", async () => {
  const off = new HolderWaiver({});
  assert.equal(off.enabled, false);
  assert.equal(await off.holds(ADDR(1)), false);
  assert.equal(off.status().enabled, false);
  // a token that is not an address is a misconfiguration, not a waiver for everyone
  const bad = new HolderWaiver({ token: "NOTAFLY" });
  assert.equal(bad.enabled, false);
  assert.equal(bad.status().misconfigured, true);
  assert.equal(await bad.holds(ADDR(1)), false);
});

test("T14: one token is enough, none is not, and the threshold is configurable", async () => {
  const w = waiver({ balance: 0 });
  assert.equal(await w.holds(ADDR(2)), false);
  w._balance = 1; w.forget(ADDR(2));
  assert.equal(await w.holds(ADDR(2)), true);
  w._balance = 0.4; w.forget(ADDR(2));
  assert.equal(await w.holds(ADDR(2)), false, "a fraction of a token is not holding one");
  const big = waiver({ balance: 5000, minTokens: 10_000 });
  assert.equal(await big.holds(ADDR(3)), false);
  big._balance = 10_000; big.forget(ADDR(3));
  assert.equal(await big.holds(ADDR(3)), true);
});

test("T14: the answer is cached, so a close does not cost an RPC call each time", async () => {
  const w = waiver({ balance: 3 });
  assert.equal(await w.holds(ADDR(4)), true);
  const reads = w.reads;
  for (let i = 0; i < 20; i++) await w.holds(ADDR(4));
  assert.equal(w.reads, reads, "twenty more closes, no further reads");
  w._balance = 0;
  assert.equal(await w.holds(ADDR(4)), true, "still cached");
  w._advance(6 * 60_000);
  assert.equal(await w.holds(ADDR(4)), false, "after the TTL it reads again and sees they sold");
});

test("T14: an unreadable balance keeps the last good answer and never invents one", async () => {
  const w = waiver({ balance: 7 });
  assert.equal(await w.holds(ADDR(5)), true);
  w._throw = true; w._advance(6 * 60_000);
  assert.equal(await w.holds(ADDR(5)), true, "a node blink does not start charging a holder");
  assert.equal(await w.holds(ADDR(6)), false, "a wallet never read successfully is charged, not waived");
  assert.ok(w.status().errors >= 1);
  assert.equal(w.status().lastError, "rpc down");
  // once the node is back the truth wins again
  w._throw = false; w._balance = 0; w._advance(6 * 60_000);
  assert.equal(await w.holds(ADDR(5)), false);
});

test("T14: a garbage address is never waived and never read", async () => {
  const w = waiver({ balance: 99 });
  const reads = w.reads;
  for (const bad of [null, undefined, "", "0xnothex", "not-an-address", ADDR(1).slice(0, 20)]) assert.equal(await w.holds(bad), false);
  assert.equal(w.reads, reads);
});
