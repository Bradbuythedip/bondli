// ═══ An EVM in the test process ═══
// The launchpad's own test (tests/robinhood/t5-chain-local) needs a node listening on 8545 and skips
// itself when there is not one, which in practice means the contract that will hold other people's
// ETH has no test that runs on every commit. This is the same EVM, in process: no node, no ports,
// nothing to remember to start. Deploy, call, read the logs, inspect balances.
//
// It is deliberately small. There is no gas accounting to speak of, no block production and no
// mempool, because none of those is what the curve's arithmetic and solvency depend on. What it does
// give is the only thing that actually settles an argument about money-code: running it.
import { createRequire } from "node:module";
import { Common, Hardfork, Chain } from "@ethereumjs/common";
import { VM } from "@ethereumjs/vm";
import { Account, Address, hexToBytes, bytesToHex } from "@ethereumjs/util";
import { Interface } from "ethers";

const require = createRequire(import.meta.url);

/** Load a compiled artifact written by a compile.mjs: { contracts: { Name: { abi, bytecode } } }. */
export function loadArtifact(path) {
  const art = require(path);
  if (!art?.contracts) throw new Error(`${path} is not a compiled artifact`);
  return art;
}

const addr = a => (a instanceof Address ? a : new Address(hexToBytes(String(a).toLowerCase())));
const GAS = 30_000_000n;

export class Evm {
  constructor(vm) {
    this.vm = vm; this.ifaces = new Map(); this.names = new Map();
    // A block clock. It must not start at zero: the curve treats launchedAt == 0 as "not yet
    // initialised" and returns no snipe tax for it, so a harness at timestamp zero silently cannot
    // test the one mechanism whose entire behaviour is a function of time. A real chain never has
    // timestamp zero, so this is the harness matching reality rather than working around the code.
    this._now = 1_800_000_000n;
    this._number = 1n;
    // Every interface from every artifact this harness has been handed, for decoding logs emitted by
    // contracts it never deployed. A launchpad deploys its own token and curve, so their addresses
    // cannot be attached in advance and their events -- which are the whole point of the test -- would
    // otherwise come back unreadable.
    this._known = [];
  }

  /** The fake block every call is executed against, so TIMESTAMP and NUMBER answer. */
  get _block() {
    return { header: { number: this._number, timestamp: this._now, coinbase: addr("0x" + "00".repeat(20)), difficulty: 0n, prevRandao: new Uint8Array(32), gasLimit: GAS, baseFeePerGas: 0n, getBlobGasPrice: () => 0n } };
  }

  /** Shanghai on a throwaway chain id: the curve uses no chain-specific opcode, so the fork only has
   *  to be new enough for the compiler's output (PUSH0 is emitted at 0.8.26 under paris/shanghai). */
  static async create() {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Shanghai });
    return new Evm(await VM.create({ common }));
  }

  /** An account with a balance, addressed by a short label so tests read as prose. */
  async account(label, ether = 1000n) {
    const hex = "0x" + Buffer.from(label.padEnd(20, "\0")).subarray(0, 20).toString("hex");
    const a = addr(hex);
    await this.vm.stateManager.putAccount(a, new Account(0n, ether * 10n ** 18n));
    return a;
  }

  async balance(a) { return (await this.vm.stateManager.getAccount(addr(a)))?.balance ?? 0n; }

  /** Register every contract in an artifact for log decoding, whoever ends up deploying them. */
  know(artifact) {
    for (const [name, c] of Object.entries(artifact.contracts || {})) {
      if (!this._known.some(k => k.name === name)) this._known.push({ name, iface: new Interface(c.abi) });
    }
    return this;
  }

  /** Deploy, and remember the ABI so calls to this address can be encoded and its logs decoded. */
  async deploy(artifact, name, args = [], { from, value = 0n } = {}) {
    const c = artifact.contracts[name];
    if (!c) throw new Error(`no contract ${name} in the artifact`);
    this.know(artifact);
    const iface = new Interface(c.abi);
    const data = c.bytecode + iface.encodeDeploy(args).slice(2);
    const r = await this.vm.evm.runCall({ caller: addr(from), to: undefined, data: hexToBytes(data), value, gasLimit: GAS, isStatic: false, block: this._block });
    if (r.execResult.exceptionError) throw new Error(`deploy ${name} reverted: ${this._why(r, iface)}`);
    const at = r.createdAddress;
    this.ifaces.set(at.toString().toLowerCase(), iface);
    this.names.set(at.toString().toLowerCase(), name);
    return at;
  }

  /** Register an ABI for an address this harness did not deploy (a token the factory made, say). */
  attach(address, artifact, name) {
    this.know(artifact);
    const iface = new Interface(artifact.contracts[name].abi);
    this.ifaces.set(addr(address).toString().toLowerCase(), iface);
    this.names.set(addr(address).toString().toLowerCase(), name);
    return addr(address);
  }

  _ifaceFor(to) {
    const i = this.ifaces.get(addr(to).toString().toLowerCase());
    if (!i) throw new Error(`no ABI registered for ${addr(to).toString()}`);
    return i;
  }

  /** A revert, turned back into something a person can read: a custom error with its arguments, a
   *  require string, or the raw data when it is neither. A bare "reverted" tells you nothing. */
  _why(r, iface) {
    const out = r.execResult.returnValue;
    if (!out?.length) return r.execResult.exceptionError?.error || "no reason";
    const hex = bytesToHex(out);
    try { const e = iface.parseError(hex); if (e) return `${e.name}(${e.args.map(String).join(", ")})`; } catch {}
    try { return new Interface(["function Error(string)"]).decodeFunctionData("Error", hex)[0]; } catch {}
    return hex.slice(0, 138);
  }

  /** Send a transaction. Returns { ok, ret, logs, error } -- a revert is data, not an exception, so a
   *  test can assert on the failure the contract chose rather than on the fact that it failed. */
  async send(to, fn, args = [], { from, value = 0n } = {}) {
    const iface = this._ifaceFor(to);
    const r = await this.vm.evm.runCall({
      caller: addr(from), to: addr(to), data: hexToBytes(iface.encodeFunctionData(fn, args)),
      value, gasLimit: GAS, isStatic: false, block: this._block,
    });
    if (r.execResult.exceptionError) return { ok: false, error: this._why(r, iface), logs: [] };
    let ret = null;
    try { const d = iface.decodeFunctionResult(fn, bytesToHex(r.execResult.returnValue)); ret = d.length === 1 ? d[0] : d; } catch {}
    return { ok: true, ret, logs: this.decodeLogs(r.execResult.logs || []) };
  }

  /** Read a view. Throws on revert, because a view that reverts in a test is a broken test. */
  async call(to, fn, args = [], { from } = {}) {
    const iface = this._ifaceFor(to);
    const caller = from ? addr(from) : addr("0x" + "11".repeat(20));
    const r = await this.vm.evm.runCall({ caller, to: addr(to), data: hexToBytes(iface.encodeFunctionData(fn, args)), value: 0n, gasLimit: GAS, isStatic: true, block: this._block });
    if (r.execResult.exceptionError) throw new Error(`${fn} reverted: ${this._why(r, iface)}`);
    const d = iface.decodeFunctionResult(fn, bytesToHex(r.execResult.returnValue));
    return d.length === 1 ? d[0] : d;
  }

  /** Raw EVM logs as { address, name, args }, for whichever ABIs are registered. An undecodable log
   *  is kept with name null rather than dropped: a log nobody can read is itself worth seeing. */
  decodeLogs(raw) {
    return raw.map(([address, topics, data]) => {
      const a = bytesToHex(address);
      const iface = this.ifaces.get(a.toLowerCase());
      const entry = { address: a, name: null, args: null, contract: this.names.get(a.toLowerCase()) ?? null };
      const t = topics.map(bytesToHex), d = bytesToHex(data);
      // The address's own ABI first. Failing that, every ABI we know: a contract that deploys other
      // contracts emits from addresses the test could not attach in advance, and a log nobody can
      // read is the one most likely to be the one the test is about.
      for (const candidate of [iface, ...this.ifaces.values(), ...this._known.map(k => k.iface)]) {
        if (!candidate) continue;
        try {
          const p = candidate.parseLog({ topics: t, data: d });
          if (p) { entry.name = p.name; entry.args = p.args; return entry; }
        } catch { /* not this one */ }
      }
      return entry;
    });
  }

  /** The first log of a given name, or null. */
  static log(logs, name) { return logs.find(l => l.name === name) || null; }

  /** Move the clock on. The snipe tax decays quadratically across a window measured in
   *  block.timestamp, so a harness that cannot advance time cannot test it at all. */
  warp(seconds) { this._now += BigInt(seconds); this._number += 1n; return this._now; }
  get now() { return this._now; }
}
