// t47 — The EVM routers sign as an actor too.
//
// pump.fun got this in t43. PONS and Arc are the other two venues the bot trades, and a fleet that
// only works on one of them is a fleet the operator has to remember the shape of. The cases that
// matter here are the EVM-specific ones: a derived key has to be a valid secp256k1 wallet, the
// balance and holding reads have to name the right owner, and Arc's Permit2 approvals have to be
// remembered per wallet rather than per token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JsonRpcProvider, Interface, Wallet, Transaction } from "ethers";
import { PonsLiveRouter } from "../../src/velocity/venues/pons/router.mjs";
import { ArcLiveRouter } from "../../src/velocity/venues/arc/router.mjs";
import { ERC20_ABI } from "../../src/velocity/venues/pons/chain.mjs";
import { deriveFleet } from "../../src/velocity/core/fleet.mjs";

const erc = new Interface(ERC20_ABI);
const KEY = "0x" + "7".repeat(64);
const TOKEN = "0x" + "a1".repeat(20);

/** Just enough chain to answer per-address reads and record who signed what. */
class Chain extends JsonRpcProvider {
  constructor({ chainId, name, balances = {}, holdings = {} } = {}) {
    super("http://fake", { chainId, name }, { staticNetwork: true });
    this.balances = balances; this.holdings = holdings; this.sent = []; this.nonce = 0;
  }
  async _send(payloads) {
    const out = [];
    for (const p of Array.isArray(payloads) ? payloads : [payloads]) {
      try { out.push({ id: p.id, jsonrpc: "2.0", result: await this.rpc(p.method, p.params || []) }); }
      catch (e) { out.push({ id: p.id, jsonrpc: "2.0", error: { code: -32000, message: e.message } }); }
    }
    return out;
  }
  async rpc(method, params) {
    const hex = v => "0x" + BigInt(v).toString(16);
    if (method === "eth_chainId") return hex(this._network.chainId);
    if (method === "eth_blockNumber") return "0x10";
    if (method === "eth_getTransactionCount") return hex(this.nonce);
    if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
    if (method === "eth_getBalance") return hex(this.balances[String(params[0]).toLowerCase()] || 0n);
    if (method === "eth_getBlockByNumber") return { number: "0x10", hash: "0x" + "b".repeat(64), timestamp: "0x1", gasLimit: "0x1c9c380", gasUsed: "0x0", baseFeePerGas: "0x3b9aca00", miner: "0x" + "0".repeat(40), transactions: [], parentHash: "0x" + "0".repeat(64), nonce: "0x0000000000000000", difficulty: "0x0", extraData: "0x" };
    if (method === "eth_call") {
      const f = erc.parseTransaction({ data: params[0].data });
      if (f?.name === "balanceOf") return erc.encodeFunctionResult("balanceOf", [this.holdings[String(f.args[0]).toLowerCase()] || 0n]);
      throw new Error(`unexpected call ${f?.name}`);
    }
    if (method === "eth_sendRawTransaction") {
      const tx = Transaction.from(params[0]);
      this.sent.push({ from: String(tx.from).toLowerCase(), to: String(tx.to).toLowerCase(), value: tx.value });
      this.nonce++;
      return tx.hash;
    }
    if (method === "eth_getTransactionReceipt") return { transactionHash: params[0], status: "0x1", blockNumber: "0x10", blockHash: "0x" + "b".repeat(64), transactionIndex: "0x0", from: "0x" + "0".repeat(40), to: "0x" + "0".repeat(40), gasUsed: "0x5208", cumulativeGasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", logs: [], logsBloom: "0x" + "0".repeat(512), type: 0 };
    throw new Error(`unexpected ${method}`);
  }
}

const VENUES = [
  { name: "pons", Router: PonsLiveRouter, chainId: 4663, chainName: "robinhood", unit: 10n ** 18n },
  { name: "arc", Router: ArcLiveRouter, chainId: 5042, chainName: "arc", unit: 10n ** 18n },
];

for (const v of VENUES) {
  test(`${v.name}: the fleet is derived from the sealed root and every key is a usable wallet`, async () => {
    const chain = new Chain({ chainId: v.chainId, name: v.chainName, balances: {} });
    const r = new v.Router({ secret: KEY, provider: chain });
    await r.init();
    assert.deepEqual(r.allActors().map(a => a.label), ["root"], "no fleet until it is asked for");

    const listed = await r.useFleet(3);
    assert.deepEqual(listed.map(a => a.label), ["f0", "f1", "f2"]);
    // A derived seed is 32 bytes from an HMAC; it has to be a valid secp256k1 key, and the address
    // has to be the one core/fleet.mjs implies rather than a second scheme invented here.
    const seeds = deriveFleet({ rootSecret: KEY, venue: v.name, size: 3 });
    assert.deepEqual(listed.map(a => a.publicKey), seeds.map(s => new Wallet("0x" + Buffer.from(s).toString("hex")).address));
    assert.equal(new Set(listed.map(a => a.publicKey)).size, 3);
    assert.ok(!listed.some(a => a.publicKey === r.root.address));
    // Venue-scoped: the same root on the other chain is a different fleet.
    const other = deriveFleet({ rootSecret: KEY, venue: v.name === "pons" ? "arc" : "pons", size: 3 });
    assert.notDeepEqual(other.map(s => s.toString("hex")), seeds.map(s => s.toString("hex")));
  });

  test(`${v.name}: an unknown actor throws instead of falling back to the root`, async () => {
    const r = new v.Router({ secret: KEY, provider: new Chain({ chainId: v.chainId, name: v.chainName }) });
    await r.init();
    await r.useFleet(2);
    assert.throws(() => r._actor("f9"), /unknown actor 'f9'/);
    assert.throws(() => r._actor({ address: "0x1" }), /needs a wallet/);
    assert.equal(r._actor().label, "root");
    assert.equal(r._actor("f1").label, "f1");
  });

  test(`${v.name}: balances and holdings are read per wallet, and positions sum across them`, async () => {
    // Seeded before init, because the provider coalesces identical reads for a moment and a balance
    // written after the first one would be answered from that cache.
    const root = new Wallet(KEY).address.toLowerCase();
    const seeds = deriveFleet({ rootSecret: KEY, venue: v.name, size: 2 });
    const [a0, a1] = seeds.map(sd => new Wallet("0x" + Buffer.from(sd).toString("hex")).address.toLowerCase());
    const chain = new Chain({
      chainId: v.chainId, name: v.chainName,
      balances: { [root]: v.unit, [a0]: v.unit / 2n, [a1]: 0n },
      holdings: { [root]: 100n * v.unit, [a0]: 250n * v.unit },
    });
    const r = new v.Router({ secret: KEY, provider: chain });
    await r.init();
    await r.useFleet(2);
    const bals = await r.fleetBalances();
    assert.deepEqual(Object.keys(bals), ["root", "f0", "f1"]);
    assert.ok(bals.root > bals.f0 && bals.f0 > 0 && bals.f1 === 0, JSON.stringify(bals));

    r.track(TOKEN);
    const pos = await r.positions();
    assert.equal(pos.length, 1);
    assert.equal(pos[0].qty, 350, "the engine holds one position per token however many wallets carry it");
    assert.deepEqual(pos[0].wallets, [{ actor: "root", qty: 100 }, { actor: "f0", qty: 250 }]);
    assert.ok(!pos[0].wallets.some(w => w.actor === "f1"), "a wallet holding none of it is not in the list");
  });

  test(`${v.name}: a transfer is signed by the wallet it is sent from`, async () => {
    const chain = new Chain({ chainId: v.chainId, name: v.chainName });
    const r = new v.Router({ secret: KEY, provider: chain, confirmTimeoutMs: 100 });
    await r.init();
    const [f0] = await r.useFleet(1);
    chain.balances[f0.publicKey.toLowerCase()] = v.unit;
    await r.transferSol(r.root.address, 0.001, "f0");
    assert.equal(chain.sent.length, 1);
    assert.equal(chain.sent[0].from, f0.publicKey.toLowerCase(), "the sweep comes out of the wallet it is sweeping");
    assert.equal(chain.sent[0].to, r.root.address.toLowerCase());
    await r.transferSol(f0.publicKey, 0.001);
    assert.equal(chain.sent[1].from, r.root.address.toLowerCase(), "and a top-up comes out of the root");
  });
}

test("arc: a Permit2 approval is remembered per wallet, not per token", async () => {
  const chain = new Chain({ chainId: 5042, name: "arc" });
  const r = new ArcLiveRouter({ secret: KEY, provider: chain });
  await r.init();
  await r.useFleet(2);
  // The cache key is what decides whether f1 is asked to approve after f0 already has. An approval
  // f0 gave says nothing about f1, and skipping f1's would send a swap the router cannot pull for.
  r._approved.add(`f0|${TOKEN.toLowerCase()}`);
  assert.ok(r._approved.has(`f0|${TOKEN.toLowerCase()}`));
  assert.ok(!r._approved.has(`f1|${TOKEN.toLowerCase()}`), "f1 still owes its own approval");
  assert.ok(!r._approved.has(TOKEN.toLowerCase()), "the old token-only key would have skipped it");
});
