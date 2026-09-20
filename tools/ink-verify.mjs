#!/usr/bin/env node
// ═══ Does Ink agree with what src/velocity/venues/ink/chain.mjs says about it? ═══
//
// Every address in that module came from DefiLlama's public adapters. Reviewed code matched against
// on-chain TVL is good provenance, but it is not the chain, and a wrong address does not fail loudly:
// the radar simply watches nothing, or prices a token off somebody else's pool. This asks the chain.
//
//   INK_RPC_URL=https://ink-mainnet.g.alchemy.com/v2/<key> node tools/ink-verify.mjs
//
// It only reads: eth_chainId, eth_getCode, eth_call, eth_getLogs. Nothing is signed and nothing is
// sent, so it is safe to run against mainnet with any endpoint. Exits non-zero if anything the code
// depends on is not there, which makes it usable as a pre-deploy check rather than only as a report.
import { JsonRpcProvider, Contract, Interface } from "ethers";
import * as ink from "../src/velocity/venues/ink/chain.mjs";

const RPC = process.env.INK_RPC_URL || ink.DEFAULT_RPC_URL;
// staticNetwork is deliberately NOT used: it makes getNetwork() hand back the chain id this script
// configured rather than the one the endpoint reports, so the check would pass by construction and
// an RPC pointed at the wrong chain would sail through it.
const provider = new JsonRpcProvider(RPC);
const redact = u => String(u).replace(/\/v2\/[^/]+$/, "/v2/<key>").replace(/[?&]api[-_]?key=[^&]+/i, "?key=<redacted>");

let failures = 0;
const ok = (label, detail = "") => console.log(`  ok    ${label}${detail ? "  " + detail : ""}`);
const bad = (label, detail = "") => { failures++; console.log(`  FAIL  ${label}${detail ? "  " + detail : ""}`); };

/** A contract is there when it has code. An EOA or an empty slot has none, and an address that was
 *  mistyped almost always lands on one. */
async function hasCode(label, address) {
  try {
    const code = await provider.getCode(address);
    if (!code || code === "0x") return bad(label, `${address} has no code`);
    ok(label, `${address} (${(code.length - 2) / 2} bytes)`);
    return true;
  } catch (e) { return bad(label, `${address}: ${e.shortMessage || e.message}`); }
}

console.log(`\nInk verification against ${redact(RPC)}\n`);

// ── the chain itself ──
console.log("chain");
try {
  // Asked of the endpoint, not of our own config.
  const reported = Number(await provider.send("eth_chainId", []));
  reported === ink.CHAIN_ID ? ok("chain id", String(reported)) : bad("chain id", `endpoint says ${reported}, the code expects ${ink.CHAIN_ID}`);
  const head = await provider.getBlockNumber();
  ok("head", `block ${head}`);
  // Block time decides the poll rate and, more importantly, whether a snipe window measured in
  // seconds is worth anything measured in blocks.
  const [a, b] = await Promise.all([provider.getBlock(head - 50), provider.getBlock(head)]);
  if (a && b) {
    const ms = ((b.timestamp - a.timestamp) / 50) * 1000;
    ok("block time", `${ms.toFixed(0)}ms over the last 50 blocks`);
    if (Math.abs(ms - ink.BLOCK_MS) > 1500) bad("block time", `the code assumes ${ink.BLOCK_MS}ms`);
  }
  // Every factory's first block has to be in the past, or a log scan starts in the future.
  const future = [["tsunami", ink.TSUNAMI.firstBlock], ["calamari", ink.CALAMARI.firstBlock],
    ...ink.SENTRY.ink.v3Factories.map(f => [`sentry v3 ${f.kind}`, f.firstBlock]),
    ...ink.SENTRY.ink.v4Factories.map(f => [`sentry v4 ${f.kind}`, f.firstBlock])].filter(([, n]) => n > head);
  future.length ? bad("first blocks", `${future.map(([k, n]) => `${k}@${n}`).join(", ")} are ahead of the head`) : ok("first blocks", "all in the past");
} catch (e) {
  // If the endpoint itself cannot be reached there is nothing to learn from asking it twenty more
  // times. One clear failure beats twenty copies of it, and the likely causes are worth naming.
  bad("chain", e.shortMessage || e.message);
  console.log(`\nThe endpoint did not answer, so nothing below could be checked.\n` +
    `  - a 403 usually means the key is wrong, out of credits, or the network blocks the host\n` +
    `  - set INK_RPC_URL to your own endpoint; the public ones are rate-limited for a launch radar\n` +
    `  - nothing here signs or sends, so it is safe to retry against any endpoint\n`);
  process.exit(1);
}

// ── the addresses ──
console.log("\ncontracts");
await hasCode("WETH", ink.WETH);
await hasCode("Tsunami factory", ink.TSUNAMI.factory);
await hasCode("Calamari PoolManager", ink.CALAMARI.poolManager);
for (const h of ink.TSUNAMI_HOOKS) await hasCode(`Tsunami hook (${h.generation}/${h.factory})`, h.address);
for (const f of ink.SENTRY.ink.v3Factories) await hasCode(`Sentry v3 factory (${f.kind})`, f.address);
for (const f of ink.SENTRY.ink.v4Factories) await hasCode(`Sentry v4 factory (${f.kind})`, f.address);
await hasCode("Sentry StateView", ink.SENTRY.ink.stateView);
await hasCode("Sentry LP vault", ink.SENTRY.ink.vault);

// ── the ABIs, which is the part provenance cannot settle ──
// An address with code proves something is there. Only a call proves it is the thing we think.
console.log("\ninterfaces");
try {
  const factory = new Contract(ink.TSUNAMI.factory, ink.TSUNAMI_FACTORY_ABI, provider);
  const tokens = await factory.getLaunchedTokens();
  ok("Tsunami getLaunchedTokens()", `${tokens.length} launches`);
  if (tokens.length) {
    const t = tokens[tokens.length - 1];
    const [curve, quote] = await Promise.all([factory.tokenCurves(t), factory.tokenQuotes(t)]);
    ok("Tsunami tokenCurves/tokenQuotes", `newest ${t} -> curve ${curve}`);
    const isNative = /^0x0{40}$/i.test(quote);
    ok("Tsunami quote asset", isNative ? "native ETH" : quote);
    // The curve holding the raise is what curveProgress() would read. Its balance is real money.
    const held = isNative ? await provider.getBalance(curve) : null;
    if (held != null) ok("newest curve holds", `${Number(held) / 1e18} ETH`);
    const meta = new Contract(t, ink.ERC20_ABI, provider);
    const [name, symbol, supply, dec] = await Promise.all([meta.name(), meta.symbol(), meta.totalSupply(), meta.decimals()]);
    ok("newest token", `${name} (${symbol}) supply ${Number(supply) / 10 ** Number(dec)}`);
    // The one assumption worth checking by hand: these launchpads do not all mint a billion, which
    // is exactly why mcapFrom() takes supply as an argument.
    const whole = Number(supply) / 10 ** Number(dec);
    console.log(`        supply is ${whole === 1e9 ? "the usual billion" : "NOT a billion -- assuming one would misprice this token by " + (1e9 / whole).toFixed(1) + "x"}`);
  }
} catch (e) { bad("Tsunami ABI", e.shortMessage || e.message); }

try {
  const sv = new Contract(ink.SENTRY.ink.stateView, ink.STATE_VIEW_ABI, provider);
  await sv.getSlot0("0x" + "00".repeat(32));   // a pool id that does not exist: it must answer, not revert
  ok("Sentry StateView getSlot0()", "answers");
} catch (e) {
  // A revert here is still informative: it means the selector exists and the pool does not.
  /revert|call exception|missing revert/i.test(e.shortMessage || e.message)
    ? ok("Sentry StateView getSlot0()", "reverts on an unknown pool, as expected")
    : bad("Sentry StateView", e.shortMessage || e.message);
}

// Recent launches prove the event signature, which is how the feed will discover tokens at all.
console.log("\nrecent activity");
try {
  const head = await provider.getBlockNumber();
  const from = Math.max(ink.SENTRY.ink.v4Factories[0].firstBlock, head - 50_000);
  const iface = new Interface(ink.SENTRY_FACTORY_ABI);
  for (const f of ink.SENTRY.ink.v4Factories) {
    const logs = await provider.getLogs({ address: f.address, topics: [ink.TOPICS.TokenDeployed], fromBlock: from, toBlock: head });
    ok(`Sentry v4 (${f.kind}) TokenDeployed`, `${logs.length} in the last ${head - from} blocks`);
    if (logs.length) {
      const p = iface.parseLog({ topics: [...logs[logs.length - 1].topics], data: logs[logs.length - 1].data });
      console.log(`        newest: ${p.args.name} (${p.args.symbol}) by ${p.args.creator}`);
    }
  }
} catch (e) { bad("log scan", e.shortMessage || e.message); }

console.log(`\n${failures === 0 ? "everything the code depends on is on the chain." : `${failures} problem(s): the code disagrees with the chain.`}\n`);
console.log("still unverifiable from a public read, and needed before anything trades:");
for (const s of ink.NEEDS_VERIFIED_SOURCE) console.log(`  - ${s}`);
process.exit(failures === 0 ? 0 : 1);
