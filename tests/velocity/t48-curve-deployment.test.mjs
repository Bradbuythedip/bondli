// t48 — One curve protocol, two chains.
//
// PONS on Robinhood Chain and bondli's own launchpad are the same contract shape by construction,
// not by coincidence: "the same function and event signatures bondli's PONS venue calls" is the
// first line of the launchpad's header. These pin the seam — that the protocol knows nothing about
// any chain, that a deployment is only data, and that a chain with no launchpad deployed on it says
// so rather than pointing the router at an address with no code.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeDeployment } from "../../src/velocity/venues/curve/deployment.mjs";
import * as protocol from "../../src/velocity/venues/curve/protocol.mjs";
import { PONS, FACTORY, CHAIN_ID as PONS_CHAIN, mcapQuote as ponsMcap, TOKEN_SUPPLY } from "../../src/velocity/venues/pons/chain.mjs";
import { INK, CHAIN_ID as INK_CHAIN } from "../../src/velocity/venues/ink/chain.mjs";

test("the protocol knows nothing about any chain, and may not learn", () => {
  const raw = fs.readFileSync("src/velocity/venues/curve/protocol.mjs", "utf8");
  // Comments stripped: the header names both deployments to say what the protocol is shared
  // between, which is the point of it. What must not appear is a chain in the CODE.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(src, /0x[0-9a-fA-F]{40}/, "no addresses in the protocol");
  assert.doesNotMatch(src, /https?:\/\//, "no RPC hosts in the protocol");
  assert.doesNotMatch(src, /\b(4663|57073|robinhood|inkonchain)\b/i, "no chain ids or names in the protocol");
  // And what it does export is the whole protocol, so a second deployment needs no copy of it.
  for (const k of ["FACTORY_ABI", "CURVE_ABI", "ERC20_ABI", "TOPICS", "decodeLog", "curveBuyQuote", "curveSellQuote", "curveProgress", "mcapQuote", "toEth", "toWei", "toTokens", "SNIPE_TAX_WINDOW_MS"]) {
    assert.ok(protocol[k] != null, `the protocol exports ${k}`);
  }
});

test("PONS keeps every name it exported before the split", () => {
  // The extraction is only safe if it is invisible: every existing import of ./chain.mjs still
  // resolves, which is what lets the PONS router and feed go untouched.
  assert.equal(PONS_CHAIN, 4663);
  assert.equal(FACTORY, "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e");
  assert.equal(TOKEN_SUPPLY, 1_000_000_000);
  assert.equal(typeof protocol.decodeLog, "function");
});

test("market cap takes the supply, because only one deployment fixes it at a billion", () => {
  const r = { quoteReserve: 3, tokenReserve: 1_000_000_000 };
  assert.equal(ponsMcap(r), 3, "PONS mints a billion for every launch");
  // Our launchpad takes the supply from its launch config. Half the supply is half the market cap,
  // and a reader that assumed a billion would report exactly twice the truth.
  assert.equal(protocol.mcapQuote(r, 500_000_000), 1.5);
  assert.equal(protocol.mcapQuote({ quoteReserve: 3, tokenReserve: 0 }), 0, "no tokens, no price");
});

test("a deployment is data, and it is checked", () => {
  assert.equal(PONS.venue, "pons");
  assert.equal(PONS.chainId, 4663);
  assert.deepEqual(PONS.network(), { chainId: 4663, name: "robinhood" });
  assert.equal(PONS.factoryAddress(), FACTORY.toLowerCase());
  assert.equal(PONS.configured(), true);
  assert.match(PONS.txUrl("0xdead"), /^https:\/\/.*\/tx\/0xdead$/);
  assert.throws(() => makeDeployment({ chainId: 1, defaultRpcUrl: "x" }), /venue name/);
  assert.throws(() => makeDeployment({ venue: "v", defaultRpcUrl: "x" }), /chain id/);
  assert.throws(() => makeDeployment({ venue: "v", chainId: 1 }), /RPC url/);
  assert.throws(() => makeDeployment({ venue: "v", chainId: 1, defaultRpcUrl: "x", factory: "nope" }), /not an address/);
});

test("Ink is the same protocol on a chain with nothing deployed on it yet", () => {
  assert.equal(INK.venue, "ink");
  assert.equal(INK.chainId, 57073);
  assert.equal(INK_CHAIN, 57073);
  assert.equal(INK.blockMs, 1_000, "one-second blocks: a radar's poll floor is the chain's, not a constant");
  assert.notEqual(INK.chainId, PONS.chainId);
  const before = process.env.INK_LAUNCHPAD_FACTORY;
  try {
    delete process.env.INK_LAUNCHPAD_FACTORY;
    assert.equal(INK.factoryAddress(), null);
    assert.equal(INK.configured(), false, "an unconfigured venue must not trade: the router would report reverts against an address with no code");
    // Supplied at run time, because the contract is deployed per chain by us.
    process.env.INK_LAUNCHPAD_FACTORY = "0x" + "Ab".repeat(20);
    assert.equal(INK.factoryAddress(), "0x" + "ab".repeat(20), "normalised, so a checksummed value and a lowercase one are one factory");
    assert.equal(INK.configured(), true);
    // Garbage is loud rather than silently treated as absent: a typo in the variable is the
    // difference between trading and not, and it should not read as "no launchpad here".
    process.env.INK_LAUNCHPAD_FACTORY = "0xnope";
    assert.throws(() => INK.factoryAddress(), /not an address/);
    assert.equal(INK.configured(), false);
  } finally {
    if (before == null) delete process.env.INK_LAUNCHPAD_FACTORY; else process.env.INK_LAUNCHPAD_FACTORY = before;
  }
});

test("an operator's own endpoint wins over the public one", () => {
  const before = process.env.INK_RPC_URL;
  try {
    delete process.env.INK_RPC_URL;
    assert.match(INK.rpcUrl(), /inkonchain|nodeflare/, "the public default is rate-limited but real");
    process.env.INK_RPC_URL = "https://mine.example/ink";
    assert.equal(INK.rpcUrl(), "https://mine.example/ink");
  } finally {
    if (before == null) delete process.env.INK_RPC_URL; else process.env.INK_RPC_URL = before;
  }
});
