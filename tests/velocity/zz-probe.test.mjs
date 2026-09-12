// PROBE (temporary): a chunked sell that stops half way, and what the engine books for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JsonRpcProvider, Interface, AbiCoder, Transaction, zeroPadValue } from "ethers";
import { PonsLiveRouter } from "../../src/velocity/venues/pons/router.mjs";
import { FACTORY, FACTORY_ABI, CURVE_ABI, ERC20_ABI, TOPICS, toWei } from "../../src/velocity/venues/pons/chain.mjs";

const factory = new Interface(FACTORY_ABI), curveI = new Interface(CURVE_ABI), erc = new Interface(ERC20_ABI), coder = AbiCoder.defaultAbiCoder();
const TOKEN = "0x" + "a1".repeat(20), CURVE = "0x" + "c1".repeat(20), KEY = "0x" + "7".repeat(64);

class FakeChain extends JsonRpcProvider {
  constructor(state) { super("http://fake", { chainId: 4663, name: "robinhood" }, { staticNetwork: true }); this.s = state; this.sent = []; this.calls = []; }
  async _send(payloads) {
    const out = [];
    for (const p of Array.isArray(payloads) ? payloads : [payloads]) {
      try { out.push({ id: p.id, jsonrpc: "2.0", result: await this.rpc(p.method, p.params || []) }); }
      catch (e) { out.push({ id: p.id, jsonrpc: "2.0", error: { code: e.code || -32000, message: e.message, data: e.data } }); }
    }
    return out;
  }
  async rpc(method, params) {
    const s = this.s;
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_blockNumber") return "0x10";
    if (method === "eth_getBalance") return "0x" + toWei(0.05).toString(16);
    if (method === "eth_getTransactionCount") return "0x" + this.sent.length.toString(16);
    if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
    if (method === "eth_getBlockByNumber") return { number: "0x10", hash: "0x" + "b".repeat(64), timestamp: "0x1", gasLimit: "0x1c9c380", gasUsed: "0x0", baseFeePerGas: "0x3b9aca00", miner: "0x" + "0".repeat(40), transactions: [], parentHash: "0x" + "0".repeat(64), nonce: "0x0000000000000000", difficulty: "0x0", extraData: "0x" };
    if (method === "eth_call" || method === "eth_estimateGas") {
      const tx = params[0], to = String(tx.to).toLowerCase(), data = tx.data;
      this.calls.push({ method, to, data });
      if (to === FACTORY.toLowerCase()) {
        const f = factory.parseTransaction({ data });
        return factory.encodeFunctionResult("getLaunchedToken", [[TOKEN, CURVE, "0x" + "d".repeat(40), "0x" + "0".repeat(40), 1n, toWei(3), false]]);
      }
      if (to === TOKEN) {
        const f = erc.parseTransaction({ data });
        if (f.name === "balanceOf") return erc.encodeFunctionResult("balanceOf", [s.balance]);
        if (f.name === "allowance") return erc.encodeFunctionResult("allowance", [s.allowance]);
        if (f.name === "approve") return erc.encodeFunctionResult("approve", [true]);
      }
      if (to === CURVE) {
        const f = curveI.parseTransaction({ data });
        if (f.name === "getReserves") return curveI.encodeFunctionResult("getReserves", [toWei(s.quoteReserve), s.tokenReserve]);
        if (f.name === "feeBps") return curveI.encodeFunctionResult("feeBps", [100n]);
        if (f.name === "creatorTaxBps") return curveI.encodeFunctionResult("creatorTaxBps", [0n]);
        if (f.name === "graduated") return curveI.encodeFunctionResult("graduated", [s.graduated]);
        if (f.name === "readyToGraduate") return curveI.encodeFunctionResult("readyToGraduate", [false]);
        if (f.name === "sell") {
          if (s.maxUnits != null && f.args[0] > s.maxUnits) { const e = new Error("execution reverted (unknown custom error)"); e.code = 3; e.data = "0xdeadbeef" + "0".repeat(56); throw e; }
          return method === "eth_estimateGas" ? "0x30000" : curveI.encodeFunctionResult("sell", [toWei(0.01)]);
        }
      }
      throw new Error(`unexpected ${method} to ${to} ${data.slice(0, 10)}`);
    }
    if (method === "eth_sendRawTransaction") {
      const tx = Transaction.from(params[0]); const hash = tx.hash; this.sent.push(tx);
      const to = String(tx.to).toLowerCase();
      if (to === TOKEN) { s.allowance = 2n ** 255n; s.receipts[hash] = this.receipt(hash, to, []); }
      else if (to === CURVE) {
        const f = curveI.parseTransaction({ data: tx.data }); s.sold = (s.sold || 0n) + f.args[0]; s.balance -= f.args[0];
        // the curve drains: after the first real sell it will only take a tiny amount
        s.maxUnits = 1n;
        const log = { address: CURVE, topics: [TOPICS.CurveSell, zeroPadValue(tx.from, 32), zeroPadValue(tx.from, 32)], data: coder.encode(["uint256", "uint256", "uint256", "uint256"], [f.args[0], toWei(0.01), toWei(0.0001), 0n]) };
        s.receipts[hash] = this.receipt(hash, to, [log]);
      }
      return hash;
    }
    if (method === "eth_getTransactionReceipt") return this.s.receipts[params[0]] || null;
    throw new Error("unexpected rpc " + method);
  }
  receipt(hash, to, logs) { return { transactionHash: hash, blockHash: "0x" + "b".repeat(64), blockNumber: "0x11", transactionIndex: "0x0", from: "0x" + "0".repeat(40), to, status: "0x1", gasUsed: "0x5208", cumulativeGasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", contractAddress: null, logsBloom: "0x" + "0".repeat(512), type: "0x2", logs: logs.map((l, i) => ({ ...l, blockNumber: "0x11", blockHash: "0x" + "b".repeat(64), transactionHash: hash, transactionIndex: "0x0", logIndex: "0x" + i.toString(16), removed: false })) }; }
}

test("PROBE: chunked sell that stops after one chunk still reports ok", async () => {
  const c = new FakeChain({ balance: 800n * 10n ** 18n, allowance: 2n ** 255n, quoteReserve: 2, tokenReserve: 800_000_000n * 10n ** 18n, graduated: false, maxUnits: 250n * 10n ** 18n, receipts: {} });
  const r = new PonsLiveRouter({ secret: KEY, provider: c, confirmTimeoutMs: 3000 });
  await r.init();
  const res = await r.close({ id: "pons:x", instrument: TOKEN, decisionId: "d1", reference: { curve: { address: CURVE } } }, 100, { reference: { solPrice: 3000 } });
  console.log("RESULT ok=", res.ok, JSON.stringify(res.fill || res.failure, null, 1));
  console.log("wallet still holds units:", c.s.balance.toString(), "=", Number(c.s.balance) / 1e18, "tokens");
});

test("PROBE: close with no ETH price still sells and reports $0", async () => {
  const c = new FakeChain({ balance: 800n * 10n ** 18n, allowance: 2n ** 255n, quoteReserve: 2, tokenReserve: 800_000_000n * 10n ** 18n, graduated: false, maxUnits: null, receipts: {} });
  const r = new PonsLiveRouter({ secret: KEY, provider: c, confirmTimeoutMs: 3000 });
  await r.init();
  const res = await r.close({ id: "pons:y", instrument: TOKEN, decisionId: "d2", reference: { curve: { address: CURVE } } }, 100, { reference: {} });
  console.log("NOPRICE ok=", res.ok, "notional_usd=", res.fill?.notional_usd, "price=", res.fill?.price, "sol_received=", res.fill?.sol_received, "txs sent=", c.sent.length);
});
