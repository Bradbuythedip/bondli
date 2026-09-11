// The opponent model: decayed pressure, the detectors, the Nash signal, the manual override and its one exception.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GameState } from "../../launch/robinhood/lib/game-state.mjs";

function make() { let t = 0; const gs = new GameState({ token: "x", ourWallets: ["0xOurs"], devWallet: "0xDEV", clock: { now: () => t }, whaleEth: 0.05 }); gs.setCurve({ progress: 0.1, mcapEth: 3.3, quoteReserve: 3.3 }); return { gs, at: (ms) => { t = ms; }, now: () => t }; }

test("T2: our own trades never count as opponents", () => {
  const { gs, at } = make();
  at(1000); gs.ingest({ time: 1000, kind: "buy", wallet: "0xours", quote: 0.5, tokens: 1 });
  assert.equal(gs.opponents.size, 0); assert.equal(gs.observedVolume, 0); assert.equal(gs.signal, "HOLD");
});

test("T2: four external buys in 30s with full buy pressure → RIDE; a whale → RIDE with a 30s hold extension", () => {
  const { gs, at } = make();
  for (let i = 1; i <= 4; i++) { at(i * 2000); gs.ingest({ time: i * 2000, kind: "buy", wallet: "0xb" + i, quote: 0.01, tokens: 1 }); }
  assert.equal(gs.signal, "RIDE"); assert.equal(gs.snapshot().buyPressure, 100);
  at(9000); gs.ingest({ time: 9000, kind: "buy", wallet: "0xwhale", quote: 0.2, tokens: 1 });
  assert.ok(gs.whaleAlert); assert.equal(gs.signal, "RIDE"); assert.equal(gs.holdExtension, 30); assert.equal(gs.sellMultiplier, 0.3);
});

test("T2: three distinct sellers inside ~10s is a dump cascade → SELL_NOW; it decays back", () => {
  const { gs, at } = make();
  for (let i = 0; i < 3; i++) { at(100_000 + i * 1000); gs.ingest({ time: 100_000 + i * 1000, kind: "sell", wallet: "0xs" + i, quote: 0.01, tokens: 1 }); }
  assert.ok(gs.dumpCascade); assert.equal(gs.signal, "SELL_NOW"); assert.equal(gs.sellMultiplier, 2.5);
  at(200_000); gs.refresh(); assert.equal(gs.dumpCascade, false); assert.equal(gs.signal, "HOLD");
});

test("T2: a dev sell is SELL_NOW at 3x, and a manual RIDE cannot override it", () => {
  const { gs, at } = make();
  at(300_000); gs.ingest({ time: 300_000, kind: "sell", wallet: "0xdev", quote: 0.01, tokens: 1 });
  assert.ok(gs.devSelling); assert.equal(gs.signal, "SELL_NOW"); assert.equal(gs.sellMultiplier, 3);
  assert.equal(gs.setManualOverride("RIDE", 60), true); assert.equal(gs.signal, "SELL_NOW");
});

test("T2: a manual override wins otherwise and expires on time", () => {
  const { gs, at } = make();
  at(1000); gs.setManualOverride("ACCUMULATE", 30); assert.equal(gs.signal, "ACCUMULATE"); assert.equal(gs.sellMultiplier, 0.3);
  at(20_000); gs.refresh(); assert.equal(gs.signal, "ACCUMULATE");
  at(32_000); gs.refresh(); assert.equal(gs.signal, "HOLD"); assert.equal(gs.manualSignal, null);
  assert.equal(gs.setManualOverride("NONSENSE"), false);
});

test("T2: the whale threshold scales with the curve: 1.5% of the virtual reserve", () => {
  const { gs, at } = make(); gs.setCurve({ quoteReserve: 20 });
  at(1000); gs.ingest({ time: 1000, kind: "buy", wallet: "0xw", quote: 0.2, tokens: 1 }); assert.equal(gs.whaleAlert, false);
  at(2000); gs.ingest({ time: 2000, kind: "buy", wallet: "0xw2", quote: 0.4, tokens: 1 }); assert.equal(gs.whaleAlert, true);
});
