// Regressions from the adversarial review of the launcher. Each of these lost funds on a live run:
// a close that raced the process exit, a fire-and-forget dev sell that killed the process, and a gas
// reserve too small for the wallet to pay for its own sell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SimVenue } from "../../launch/robinhood/lib/sim-venue.mjs";
import { FleetTrader } from "../../launch/robinhood/lib/fleet.mjs";
import { ethToWei, toEth, toTokens } from "../../launch/robinhood/lib/curve-model.mjs";

async function running(scenario = "organic", seed = 3, fleetConfig = {}) {
  const v = new SimVenue({ seed, scenario }); await v.init();
  const master = v.createWallet(); v.faucet(master.address, 0.5); await v.start();
  const ft = new FleetTrader(v, { log: () => {} });
  const r = await ft.launch({ master, budgetEth: 0.3, mode: "create", tokenParams: { name: "T", symbol: "T" }, fleetConfig: { durationMin: 10, ...fleetConfig } });
  assert.ok(r.ok, r.error);
  while (!r.session.token && r.session.running) await v.sleep(250); // the session is keyed by its token once the launch lands
  assert.ok(r.session.token, `launch did not land: ${r.session.error || r.session.phase}`);
  return { v, ft, r, master, key: r.session.token };
}

test("T7: close is one operation however many callers ask — the CLI's double finish cannot exit mid-rug", async () => {
  const { v, ft, r, key } = await running("organic", 3);
  try {
    await v.sleep(40_000);
    // What the CLI does: the war room (or SIGINT) closes, and the strategy loop's tail closes again.
    const first = ft.close(key);
    const second = ft.close(key);
    const [a, b] = await Promise.all([first, second]);       // neither throws: it used to be "already closing"
    assert.deepEqual(a, b, "both callers get the same close result");
    assert.equal(r.session._closing, ft.pending(key), "one close in flight, not two");
    const rugs = r.session._rugDone;
    await ft.close(key);                                      // a third, after the fact
    assert.equal(r.session._rugDone, rugs, "no second rug was started");
    // ft.wait() must not resolve before the rug has sold and swept: that race is what stranded the ETH.
    await ft.wait(r.session);
    const p = ft.pending(key); if (p) await p;
    const rep = await ft.report(key);
    assert.equal(rep.phase, "closed");
    assert.equal(rep.strandedEth, 0, `nothing left in the fleet wallets: ${JSON.stringify(rep.wallets)}`);
    assert.ok(rep.tokensLeft.fleet < 1 && rep.tokensLeft.dev < 1, `no tokens left: ${JSON.stringify(rep.tokensLeft)}`);
    assert.equal(v.conservation().diff, 0n);
  } finally { r.session.running = false; await v.stop(); }
});

test("T7: a close issued during the volume phase finishes selling before the strategy loop returns", async () => {
  const { v, ft, r, key } = await running("quiet", 5, { autoRug: { minWaitSec: 600, droughtSec: 600 } });
  try {
    while (r.session.phase !== "volume" && r.session.running) await v.sleep(1000);
    assert.equal(r.session.phase, "volume");
    const closing = ft.close(key);
    await ft.wait(r.session);           // the CLI awaits this and then exits
    // At the moment the CLI would exit, the rug must already have run.
    const heldAtExit = [r.session.devWallet, ...r.session.fleetWallets].reduce((s, w) => s + Number(v.balanceOfToken(w.address)), 0);
    assert.equal(heldAtExit, 0, "every wallet was sold before the loop returned");
    await closing;
    const rep = await ft.report(key);
    assert.equal(rep.strandedEth, 0);
    assert.equal(v.conservation().diff, 0n);
  } finally { r.session.running = false; await v.stop(); }
});

test("T7: a dev sell that throws is swallowed, never an unhandled rejection", async () => {
  const { v, ft, r, key } = await running("organic", 9);
  const rejections = [];
  const onUnhandled = (e) => rejections.push(e);
  process.on("unhandledRejection", onUnhandled);
  try {
    // the dev sell path goes through the venue; make every sell from the dev wallet blow up
    const realSell = v.sell.bind(v);
    v.sell = async (wallet, units, opts) => { if (String(wallet.address).toLowerCase() === r.session.devWallet.address) throw new Error("RPC exploded"); return realSell(wallet, units, opts); };
    for (let i = 0; i < 40 && r.session.running; i++) {
      ft._maybeDevSell(r.session, { side: "buy", eth: 0.05 });
      await v.sleep(2000);
    }
    await new Promise(res => setImmediate(res));
    assert.deepEqual(rejections.map(e => e?.message), [], "a failing dev sell must not reject into the process");
    v.sell = realSell;
  } finally { process.off("unhandledRejection", onUnhandled); r.session.running = false; await v.stop(); }
});

test("T7: the gas reserve is what a send actually costs, so a spent-down wallet can still sell", async () => {
  const v = new SimVenue({ seed: 4, scenario: "dead" }); await v.init();
  // sendCostEth prices the gas limit, not a typical gasUsed: on chain the node checks the limit.
  const sellCost = await v.sendCostEth("sell");
  assert.ok(sellCost > 0);
  assert.equal(sellCost, toEth(v.gasWei("sell")));
  const master = v.createWallet(); v.faucet(master.address, 0.5); await v.start();
  const ft = new FleetTrader(v, { log: () => {} });
  const r = await ft.launch({ master, budgetEth: 0.3, mode: "create", tokenParams: { name: "T", symbol: "T" }, fleetConfig: { durationMin: 6 } });
  try {
    assert.ok(r.session.gasReserve >= sellCost * 2, `the reserve covers a sell: ${r.session.gasReserve} vs ${sellCost}`);
    assert.ok(r.session.gasBuffer >= sellCost * 3, `funding leaves room for the exit: ${r.session.gasBuffer}`);
    await ft.wait(r.session);
    if (r.session.phase !== "rugged" && r.session.phase !== "closed") await ft.close(r.session.token);
    const rep = await ft.report(r.session.token);
    assert.ok(rep.tokensLeft.fleet < 1, "every wallet could afford its own sell");
  } finally { r.session.running = false; await v.stop(); }
});
