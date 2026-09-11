// The chain venue, for real: against a local EVM node with Robinhood testnet's chain id (46630) when one
// answers at FLEET_LOCAL_RPC (default http://127.0.0.1:8545), otherwise skipped. Deploys the test
// launchpad, launches with the fleet exempt, runs the playbook with short timers, auto-rugs, sweeps.
//   npx hardhat node  (with networks.hardhat.chainId = 46630)   then   npm run fleet:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { ChainVenue } from "../../launch/robinhood/lib/chain-venue.mjs";
import { FleetTrader } from "../../launch/robinhood/lib/fleet.mjs";
import { toEth } from "../../launch/robinhood/lib/curve-model.mjs";

const RPC = process.env.FLEET_LOCAL_RPC || "http://127.0.0.1:8545";
const PK = process.env.FLEET_LOCAL_PK || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // hardhat account #0
async function nodeUp() { try { const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }), signal: AbortSignal.timeout(2000) }); const j = await r.json(); return Number(j.result); } catch { return 0; } }

test("T5: launch, fleet entry, playbook, auto-rug and sweep on a local chain through ethers", { timeout: 240_000 }, async (t) => {
  const chainId = await nodeUp();
  if (!chainId) return t.skip(`no local node at ${RPC}`);
  const log = () => {};
  const dep = await ChainVenue.deployTestLaunchpad({ rpcUrl: RPC, chainId, privateKey: PK, launchFeeEth: 0.001, log });
  const v = new ChainVenue({ chainId, rpcUrl: RPC, factory: dep.address, pollMs: 500, log });
  const init = await v.init(); assert.equal(init.chainId, chainId); assert.equal(init.factory, dep.address);
  t.after(() => v.stop());
  const master = v.walletFromKey(PK); const start = toEth(await v.ethBalance(master.address));
  const terms = await v.launchTerms(); assert.equal(toEth(terms.launchFeeWei), 0.001); assert.equal(terms.snipeTaxStartBps, 9900);
  const ft = new FleetTrader(v, { log });
  const r = await ft.launch({ master, budgetEth: 0.5, mode: "create", tokenParams: { name: "Local Fly", symbol: "LFLY" }, fleetConfig: { durationMin: 4, orchestration: { devSellDelayMs: 800, cascadeDelayMs: 1000, cascadeWaveGapMs: 800, mixedStartMs: 4000, mixedDurationMs: 3000, mixedTradeGapMs: 600 }, autoRug: { minWaitSec: 6, droughtSec: 6, checkIntervalMs: 1000 }, volume: { maxIntervalMs: 1000, minIntervalMs: 300 } } });
  assert.ok(r.ok, r.error); assert.equal(r.wallets, 6);
  await ft.wait(r.session);
  assert.ok(r.session.token && r.session.curve, "the token and curve came from the TokenLaunched log");
  assert.equal(r.session.exitReason, "auto-rug");
  const rep = await ft.report(r.session.token);
  assert.equal(rep.phase, "rugged"); assert.ok(rep.strandedEth < 0.001, `sweep leaves only the gas reserve: ${rep.strandedEth}`); assert.ok(rep.tokensLeft.fleet < 1 && rep.tokensLeft.dev < 1, `tokens left ${JSON.stringify(rep.tokensLeft)}`);
  assert.ok(rep.trades >= 12, `trades: ${rep.trades}`);
  assert.ok(rep.orchestrator.devSellCount >= 1);
  // what the venue read back from CurveBuy/CurveSell logs matches what the fleet booked
  const seen = v.stats(); assert.ok(seen.trades >= rep.trades - 1, `logs ${seen.trades} vs booked ${rep.trades}`);
  const end = toEth(await v.ethBalance(master.address));
  assert.ok(start - end < 0.06, `a dead local launch costs fees and gas only: ${(start - end).toFixed(5)} ETH`);
  // the exemption held: the master (deployer) and fleet paid no tax; an outsider inside the window would (checked by the curve view)
  await v.stop();
});

test("T5: an outsider buying in the opening window pays the tax; the fleet's declared wallet does not", { timeout: 120_000 }, async (t) => {
  const chainId = await nodeUp(); if (!chainId) return t.skip(`no local node at ${RPC}`);
  const dep = await ChainVenue.deployTestLaunchpad({ rpcUrl: RPC, chainId, privateKey: PK, launchFeeEth: 0.001 });
  const v = new ChainVenue({ chainId, rpcUrl: RPC, factory: dep.address, pollMs: 500 }); await v.init(); t.after(() => v.stop());
  const master = v.walletFromKey(PK); const friend = v.createWallet(); const outsider = v.createWallet();
  for (const w of [friend, outsider]) assert.ok((await v.transfer(master, w.address, 200_000_000_000_000_000n)).ok);
  const L = await v.launch({ from: master, params: { name: "Tax", symbol: "TAX" }, exemptions: [friend.address], devBuyWei: 10_000_000_000_000_000n });
  assert.ok(L.ok, L.error); assert.ok(L.devBuy?.ok, "the dev buy landed in the launch tx");
  const qf = await v.quoteBuy(50_000_000_000_000_000n, friend), qo = await v.quoteBuy(50_000_000_000_000_000n, outsider);
  assert.equal(qf.snipeTaxBps, 0); assert.ok(qo.snipeTaxBps > 5000, `outsider tax ${qo.snipeTaxBps} bps`);
  const bf = await v.buy(friend, 50_000_000_000_000_000n), bo = await v.buy(outsider, 50_000_000_000_000_000n, { slippagePct: 100 });
  assert.ok(bf.ok && bo.ok, `${bf.error} ${bo.error}`);
  assert.ok(bf.tokensOut > bo.tokensOut * 2n, `the friend got a multiple of the outsider tokens for the same ETH (${bf.tokensOut} vs ${bo.tokensOut}; a block a second means the tax had decayed a little)`);
  const s = await v.sell(friend, bf.tokensOut); assert.ok(s.ok, s.error); assert.ok(s.quoteOut > 0n);
  await v.stop();
});
