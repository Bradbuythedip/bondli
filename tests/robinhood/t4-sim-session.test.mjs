// The fleet simulator end to end: a CREATE launch and an APE entry against the in-memory curve. What
// must hold whatever the crowd does: every wallet swept, nothing stranded, every wei accounted for,
// declared wallets untaxed, undeclared ones taxed, the auto-rug firing in a drought.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SimVenue } from "../../launch/robinhood/lib/sim-venue.mjs";
import { FleetTrader } from "../../launch/robinhood/lib/fleet.mjs";
import { ethToWei, toEth, toTokens } from "../../launch/robinhood/lib/curve-model.mjs";

async function createRun(scenario, seed, fleetConfig = {}) {
  const v = new SimVenue({ seed, scenario }); await v.init();
  const master = v.createWallet(); v.faucet(master.address, 0.5); await v.start();
  const ft = new FleetTrader(v, { log: () => {} });
  const r = await ft.launch({ master, budgetEth: 0.3, mode: "create", tokenParams: { name: "T", symbol: "T" }, fleetConfig: { durationMin: 10, ...fleetConfig } });
  assert.ok(r.ok, r.error);
  let rep;
  try { await ft.wait(r.session); if (r.session.phase !== "closed" && r.session.phase !== "rugged") await ft.close(r.session.token); rep = await ft.report(r.session.token); }
  catch (e) { r.session.running = false; await v.stop(); throw e; }
  const out = { v, ft, r, rep, stats: v.stats(), cons: v.conservation() };
  await v.stop(); return out;
}

test("T4: a dead launch auto-rugs after the drought and everything comes home minus fees", async () => {
  const { rep, cons, stats, v } = await createRun("dead", 1);
  assert.equal(rep.exitReason, "auto-rug"); assert.equal(rep.phase, "rugged");
  assert.equal(rep.strandedEth, 0); assert.ok(rep.tokensLeft.fleet < 1 && rep.tokensLeft.dev < 1, "no tokens left");
  assert.equal(cons.diff, 0n);
  assert.ok(rep.netEth < 0 && rep.netEth > -0.02, `a dead launch costs fees only: ${rep.netEth}`);
  assert.ok(Math.abs(rep.masterEndEth - (rep.masterStartEth + rep.netEth)) < 1e-9);
  assert.equal(stats.external.wallets, 0);
  // the fleet's opening buys were exempt from the tax; nobody paid it
  assert.equal(v.curve.snipeTaxPaid || 0n, 0n);
  assert.ok(rep.elapsedSec < 400, `rugged within minutes: ${rep.elapsedSec}s`);
});

test("T4: the opening window: fleet buys in the first seconds pay no tax, an undeclared buy in the window pays", async () => {
  const v = new SimVenue({ seed: 2, scenario: "dead" }); await v.init();
  const master = v.createWallet(); v.faucet(master.address, 0.5); await v.start();
  const ft = new FleetTrader(v, { log: () => {} });
  const r = await ft.launch({ master, budgetEth: 0.3, mode: "create", tokenParams: { name: "T", symbol: "T" }, fleetConfig: { durationMin: 10, autoRug: { minWaitSec: 30, droughtSec: 20 } } });
  try {
    while (!v.launchedAt) await v.sleep(250); // funding comes first; the launch follows
    await v.sleep(5000); // inside the 15 s window
    const entries = v.trades.filter(t => t.kind === "buy" && t.time - v.launchedAt <= 15_000 && t.wallet !== v.devWallet);
    assert.ok(entries.length >= 4, `fleet entered in the window: ${entries.length}`);
    assert.ok(entries.every(t => t.snipe === 0), "declared wallets paid no opening tax");
    const sniper = v.createWallet(); v._mint(sniper.address, ethToWei(0.2));
    const ours = await v.quoteBuy(ethToWei(0.05), r.session.fleetWallets[0].wallet), theirs = await v.quoteBuy(ethToWei(0.05), sniper);
    assert.equal(ours.snipeTaxBps, 0); assert.ok(theirs.snipeTaxBps > 1000, `outsider tax ${theirs.snipeTaxBps} bps`);
    assert.ok(ours.tokensOut > theirs.tokensOut * 1.5, "the declared wallet gets more tokens for the same ETH");
    const s = await v.buy(sniper, ethToWei(0.1), { slippagePct: 100 });
    assert.ok(s.ok && s.snipe > 0n, "the undeclared sniper paid the tax");
    await ft.wait(r.session); if (r.session.phase !== "rugged") await ft.close(r.session.token);
    assert.equal(v.conservation().diff, 0n);
  } finally { r.session.running = false; await v.stop(); }
});

test("T4: an organic crowd: the playbook runs, the dev sells into snipers in chunks, volume escalates, sweep is clean", async () => {
  const { rep, cons } = await createRun("organic", 3);
  assert.ok(rep.orchestrator.devSellCount >= 2, "dev sold into the snipers");
  assert.ok(rep.orchestrator.mixedBuyCount + rep.orchestrator.mixedSellCount >= 3, "mixed candles were painted");
  assert.ok(rep.volume.tradeCount >= 5, "the volume engine traded");
  assert.ok(rep.volume.volumeMultiplier > 1, "volume escalated");
  assert.equal(rep.strandedEth, 0); assert.equal(cons.diff, 0n);
  assert.ok(["auto-rug", "duration", "sell_now", "graduated", "manual_close", "close"].includes(rep.exitReason), rep.exitReason);
});

test("T4: hype: the fleet cools off while real buyers make the volume, and the session ends in profit", async () => {
  const { rep, cons, stats } = await createRun("hype", 1);
  assert.ok(stats.external.wallets >= 50, `a crowd came: ${stats.external.wallets}`);
  assert.ok(rep.netEth > 0, `profit: ${rep.netEth}`);
  assert.equal(rep.strandedEth, 0); assert.equal(cons.diff, 0n);
});

test("T4: the war room: 'distribute' forces SELL_NOW, 'auto' clears it", async () => {
  const v = new SimVenue({ seed: 5, scenario: "quiet" }); await v.init();
  const master = v.createWallet(); v.faucet(master.address, 0.5); await v.start();
  const ft = new FleetTrader(v, { log: () => {} });
  const r = await ft.launch({ master, budgetEth: 0.3, mode: "create", tokenParams: { name: "T", symbol: "T" }, fleetConfig: { durationMin: 10 } });
  await v.sleep(30_000);
  assert.equal(ft.command(r.session.token, "distribute", { duration: 30 }).signal, "SELL_NOW");
  assert.equal(r.session.gameState.refresh().signal, "SELL_NOW");
  assert.equal(ft.command(r.session.token, "auto").signal, "AUTO");
  assert.notEqual(r.session.gameState.manualSignal, "SELL_NOW");
  assert.equal(ft.command(r.session.token, "nonsense").ok, false);
  await ft.close(r.session.token); const rep = await ft.report(r.session.token);
  assert.equal(rep.phase, "closed"); assert.equal(rep.strandedEth, 0); await v.stop();
});

test("T4: APE mode waits out the opening tax, enters Kelly-sized, exits, sweeps", async () => {
  const v = new SimVenue({ seed: 6, scenario: "organic" }); await v.init();
  const dev = v.createWallet(); v.faucet(dev.address, 1); await v.start();
  const L = await v.launch({ from: dev, params: { name: "Theirs", symbol: "X" }, devBuyWei: ethToWei(0.05) }); assert.ok(L.ok);
  const master = v.createWallet(); v.faucet(master.address, 0.4);
  const ft = new FleetTrader(v, { log: () => {} });
  const r = await ft.launch({ master, budgetEth: 0.2, mode: "ape", token: v.token, fleetConfig: { durationMin: 8, radarScore: 85, apeHoldMin: 2 } });
  assert.ok(r.ok, r.error); assert.ok(r.wallets >= 3 && r.wallets <= 7, `Kelly wallets: ${r.wallets}`);
  await ft.wait(r.session);
  const ours = new Set(r.session.fleetWallets.map(w => w.address));
  const ourBuys = v.trades.filter(t => t.kind === "buy" && ours.has(t.wallet));
  assert.ok(ourBuys.length >= 3); assert.ok(ourBuys.every(t => t.snipe === 0 || t.time - v.launchedAt >= 15_000 * 0.8), "no ape buy donated to the opening tax");
  if (r.session.phase !== "closed" && r.session.phase !== "rugged") await ft.close(r.session.token);
  const rep = await ft.report(r.session.token);
  assert.equal(rep.strandedEth, 0); assert.ok(rep.tokensLeft.fleet < 1); assert.equal(v.conservation().diff, 0n);
  await v.stop();
});

test("T4: the same seed replays the same run", async () => {
  const a = await createRun("quiet", 11), b = await createRun("quiet", 11);
  assert.equal(a.rep.netEth, b.rep.netEth); assert.equal(a.rep.trades, b.rep.trades); assert.equal(a.stats.external.wallets, b.stats.external.wallets);
});
