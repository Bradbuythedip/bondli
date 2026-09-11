// Each personality enters and exits on its own terms; the tick loop drives them through a fake session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BRAINS, createBrain, walletDecide, runFleetBrains } from "../../launch/robinhood/lib/brains.mjs";
import { seededRng, VirtualClock } from "../../launch/robinhood/lib/clock.mjs";

test("T3: variance keeps traits in [0,1] and the seed makes it repeatable", () => {
  const a = createBrain(BRAINS[0], 0.05, seededRng(9)), b = createBrain(BRAINS[0], 0.05, seededRng(9));
  assert.deepEqual({ ...a, _entryDelay: null }, { ...b, _entryDelay: null });
  for (const k of ["aggression", "patience", "greed", "fearFactor", "conviction"]) assert.ok(a[k] >= 0 && a[k] <= 1);
});

test("T3: the sniper is in within 3s and out on the first real buyer; diamond hands never sell", () => {
  const rng = seededRng(1);
  const sniper = createBrain(BRAINS.find(b => b.id === "sniper"), 0.05, rng);
  assert.equal(walletDecide(sniper, {}, 1, 0, rng).action, "hold");
  const entry = walletDecide(sniper, {}, 3, 0, rng); assert.equal(entry.action, "buy"); assert.equal(entry.reason, "sniper_entry"); sniper.tokensHeld = true; sniper.spent = entry.amount;
  assert.equal(walletDecide(sniper, { uniqueBuyers: 0, buyPressure: 50 }, 10, 0, rng).action, "hold");
  const exit = walletDecide(sniper, { uniqueBuyers: 1, buyPressure: 60 }, 12, 0, rng); assert.equal(exit.action, "sell"); assert.equal(exit.percent, 100);
  const dh = createBrain(BRAINS.find(b => b.id === "diamond_hands"), 0.05, rng);
  let bought = false; for (let t = 0; t < 60 && !bought; t += 5) { const d = walletDecide(dh, {}, t, 0, rng); if (d.action === "buy") { bought = true; dh.tokensHeld = true; dh.spent = d.amount; } }
  assert.ok(bought);
  for (let t = 60; t < 2000; t += 50) assert.equal(walletDecide(dh, { momentum: -1, uniqueBuyers: 5 }, t, 90, rng).action, "hold");
});

test("T3: externals active means hold, not sell (axiom 2), except the sniper", () => {
  const rng = seededRng(2);
  const degen = createBrain(BRAINS[0], 0.05, rng); degen.phase = "holding"; degen.tokensHeld = true; degen.spent = 0.04;
  assert.equal(walletDecide(degen, { uniqueBuyers: 3, momentum: 0.01 }, 100, 40, rng).reason, "externals_active_hold");
  assert.equal(walletDecide(degen, { uniqueBuyers: 0, momentum: -0.02 }, 100, 40, rng).action, "sell");
});

test("T3: the volume painter paints only when nobody else is trading", () => {
  const rng = seededRng(3);
  const p = createBrain(BRAINS.find(b => b.id === "volume_painter"), 0.05, rng); p.phase = "holding"; p.tokensHeld = true; p.spent = 0.01;
  assert.equal(walletDecide(p, { uniqueBuyers: 0 }, 100, 5, rng).action, "volume_trade");
  assert.equal(walletDecide(p, { uniqueBuyers: 2, momentum: 0.01 }, 100, 5, rng).action, "hold");
});

test("T3: runFleetBrains drives every wallet through a scripted market on a virtual clock, never buying below the minimum", async () => {
  const clock = new VirtualClock(0); const rng = seededRng(4);
  const fleetWallets = BRAINS.slice(0, 7).map((b, i) => ({ role: "w" + i, allocation: 0.02, funded: true }));
  // a market that wakes up: nobody for two minutes, then buyers and momentum, then the turn
  const snap = () => { const t = clock.now() / 1000; if (t < 120) return { uniqueBuyers: 0, momentum: 0, buyPressure: 50, bondingPct: 5 }; if (t < 360) return { uniqueBuyers: 4, momentum: 0.01, buyPressure: 80, bondingPct: 40 }; return { uniqueBuyers: 5, momentum: -0.01, buyPressure: 20, bondingPct: 90 }; };
  const gameState = { alive: true, refresh: snap, snapshot: snap };
  const session = { fleetWallets, gameState, rng, sleep: clock.sleep, clock, log: () => {}, running: true, phase: "volume" };
  const buys = [], sells = [];
  const run = runFleetBrains(session, async (w, eth) => { buys.push(eth); assert.ok(eth >= 0.0005, `buy ${eth}`); return { ok: true, ethIn: eth }; }, async (w, f) => { sells.push(w.role); return { ok: true, ethOut: 0.001, emptied: true }; }, async () => ({ ok: true }));
  (async () => { await clock.sleep(20 * 60_000); session.running = false; })();
  await run;
  assert.ok(buys.length >= 7, `bought ${buys.length}`);
  assert.ok(new Set(sells).size >= 4, `distinct sellers: ${[...new Set(sells)].join(",")}`);
  assert.ok(!sells.includes("w6"), "diamond hands never sold");
  assert.ok(buys.every(b => Math.round(b * 1e6) / 1e6 !== Math.round(b * 1e3) / 1e3 || b < 0.001), "amounts are not round");
});
