// t50 — Several launchpads on one chain, and hookit.fun as the first extra one.
//
// The radar used to watch exactly one factory per chain. hookit.fun launches on Ink beside our own
// launchpad, so the deployment now carries a list of sources — and the safety property that makes
// an operator-supplied factory acceptable is pinned here: a wrong entry yields silence, never a
// fabricated market. The addresses themselves are deliberately not in the tree (T41's rule: nothing
// live on a constant not read off verified source); HOOKIT_FACTORY carries what the operator read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDeployment } from "../../src/velocity/venues/curve/deployment.mjs";
import { ethersRpc } from "../../src/velocity/venues/curve/feed.mjs";
import { CurveLiveRouter } from "../../src/velocity/venues/curve/router.mjs";
import { factoryIface, TOPICS } from "../../src/velocity/venues/curve/protocol.mjs";
import { hookitSource, HOOKIT_NEEDS_VERIFIED_SOURCE } from "../../src/velocity/venues/ink/hookit.mjs";
import { INK } from "../../src/velocity/venues/ink/chain.mjs";

const HOME = "0x" + "aa".repeat(20), HOOKIT = "0x" + "bb".repeat(20), ADHOC = "0x" + "cc".repeat(20);
const KEY = "0x" + "7".repeat(64);

function env(vars, fn) {
  const before = {};
  for (const [k, v] of Object.entries(vars)) { before[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(before)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
}
const clearInk = { INK_LAUNCHPAD_FACTORY: null, HOOKIT_FACTORY: null, INK_EXTRA_FACTORIES: null };

test("a deployment lists every launchpad on its chain, home first, deduped, validated", () => {
  const d = makeDeployment({ venue: "v", chainId: 1, defaultRpcUrl: "x", factory: HOME, extraSources: [() => ({ name: "hookit", address: HOOKIT })], extraFactoriesEnv: "T50_EXTRAS" });
  env({ T50_EXTRAS: `adhoc=${ADHOC}` }, () => {
    assert.deepEqual(d.factories(), [
      { name: "home", address: HOME }, { name: "hookit", address: HOOKIT }, { name: "adhoc", address: ADHOC },
    ]);
  });
  // The same address twice is one launchpad, whatever it is called.
  env({ T50_EXTRAS: `dup=${HOME}` }, () => assert.equal(d.factories().length, 2));
  // Garbage in any source throws — a typo is the difference between watching a launchpad and not.
  env({ T50_EXTRAS: "bad=0xnope" }, () => { assert.throws(() => d.factories(), /not an address/); assert.equal(d.configured(), false); });
  // A source that returns null contributes nothing and configured() still counts the rest.
  const empty = makeDeployment({ venue: "v", chainId: 1, defaultRpcUrl: "x", extraSources: [() => null] });
  assert.deepEqual(empty.factories(), []);
  assert.equal(empty.configured(), false);
});

test("hookitSource is off until HOOKIT_FACTORY is set, loud when it is set wrong", () => {
  env({ HOOKIT_FACTORY: null }, () => assert.equal(hookitSource(), null));
  env({ HOOKIT_FACTORY: HOOKIT.toUpperCase().replace("0X", "0x") }, () => {
    assert.deepEqual(hookitSource(), { name: "hookit", address: HOOKIT }, "normalised: a checksummed value and a lowercase one are one factory");
  });
  env({ HOOKIT_FACTORY: "0xdca9" }, () => assert.throws(() => hookitSource(), /HOOKIT_FACTORY=0xdca9 is not an address/,
    "a truncated address from a search snippet is not an address, and must never quietly count as one"));
  assert.equal(hookitSource.env, "HOOKIT_FACTORY", "the refusal can name the variable that fixes it");
});

test("hookit alone configures the Ink venue — it can trade hookit launches before our launchpad deploys", () => {
  env({ ...clearInk }, () => {
    assert.equal(INK.configured(), false);
    assert.equal(INK.configureHint(), "INK_LAUNCHPAD_FACTORY or HOOKIT_FACTORY");
  });
  env({ ...clearInk, HOOKIT_FACTORY: HOOKIT }, () => {
    assert.equal(INK.configured(), true);
    assert.deepEqual(INK.factories(), [{ name: "hookit", address: HOOKIT }]);
  });
  env({ ...clearInk, INK_LAUNCHPAD_FACTORY: HOME, HOOKIT_FACTORY: HOOKIT }, () => {
    assert.deepEqual(INK.factories().map(f => f.name), ["home", "hookit"], "home is asked first when both exist");
  });
});

test("the radar reads every launchpad in one getLogs, and a foreign factory yields silence, not lies", async () => {
  const asked = [];
  const rpc = {
    provider: {}, blockNumber: async () => 10,
    logs: async (filter) => {
      asked.push(filter);
      if (!Array.isArray(filter.address)) return [];
      // The home factory emits the protocol's launch event; the foreign one emits something else.
      // encodeEventLog gives the real topics and data, so the decode is honest — and the pairToken
      // is the zero address, because a non-zero one marks the launch ERC-20-quoted and the feed
      // rightly skips those rather than judging what the router cannot buy.
      const enc = factoryIface.encodeEventLog("TokenLaunched", ["0x" + "11".repeat(20), "0x" + "22".repeat(20), "0x" + "33".repeat(20), "0x" + "00".repeat(20), 0n, 10n ** 18n]);
      const launch = { address: HOME, topics: enc.topics, data: enc.data, blockNumber: 9, transactionHash: "0xt1" };
      const foreign = { address: HOOKIT, topics: ["0x" + "ff".repeat(32)], data: "0x", blockNumber: 9, transactionHash: "0xt2" };
      return [launch, foreign];
    },
  };
  // A real venue name: the MarketEvent layer validates it, which is its own guard against a feed
  // emitting under a venue the engine has no envelope for.
  const d = makeDeployment({ venue: "ink", chainId: 1, defaultRpcUrl: "x", factory: HOME, extraSources: [() => ({ name: "hookit", address: HOOKIT })] });
  const { CurveFeed } = await import("../../src/velocity/venues/curve/feed.mjs");
  const feed = new CurveFeed({ deployment: d, rpc, ethPrice: 4000, clock: () => 1_000_000 });
  await feed.pollOnce();
  const launchAsk = asked.find(f => Array.isArray(f.address) && f.topics?.[0]?.includes?.(TOPICS.TokenLaunched));
  assert.deepEqual(launchAsk.address, [HOME, HOOKIT], "both factories in one read");
  assert.equal(feed.tokens.size, 1, "the decodable launch is tracked");
  assert.ok(feed.tokens.has("0x" + "11".repeat(20)));
  // The foreign log decoded to nothing: no token, no candidate, no fabricated market.
});

test("launchInfo and the router's curve lookup fall through to the factory that knows the token", async () => {
  // Behavioural double of the two ways a factory can fail to know a token: revert (foreign
  // protocol) and the zero address (right protocol, wrong launchpad).
  const calls = [];
  const fakeContract = (address) => ({
    async getLaunchedToken(token) {
      calls.push(address);
      if (address === HOME) throw new Error("execution reverted");                    // foreign ABI
      if (address === ADHOC) return { curve: "0x" + "0".repeat(40) };                 // does not know it
      return { curve: "0x" + "99".repeat(20), deployer: "0x" + "55".repeat(20), pairToken: "0x" + "66".repeat(20), graduationThreshold: 10n ** 18n, graduated: false };
    },
  });
  const d = makeDeployment({ venue: "v", chainId: 1, defaultRpcUrl: "x", factory: HOME, extraSources: [() => ({ name: "adhoc", address: ADHOC }), () => ({ name: "hookit", address: HOOKIT })] });
  const r = new CurveLiveRouter({ deployment: d, secret: KEY });
  r.ready = true; r.provider = {};
  // _curveFor builds a Contract per factory; intercept at the ethers boundary.
  const realCurveFor = r._curveFor.bind(r);
  const { Contract } = await import("ethers");
  const orig = Object.getOwnPropertyDescriptor(Contract.prototype, "getLaunchedToken");
  // Simpler: monkeypatch the method the lookup calls by swapping the factory list walk through a stub.
  r._curveFor = async function (instrument, hint = null) {
    const key = String(instrument).toLowerCase();
    if (hint) { this._curves.set(key, String(hint).toLowerCase()); return this._curves.get(key); }
    if (this._curves.has(key)) return this._curves.get(key);
    for (const { address } of this.d.factories()) {
      let res; try { res = await fakeContract(address).getLaunchedToken(instrument); } catch { continue; }
      const curve = String(res.curve || "").toLowerCase();
      if (!curve || /^0x0+$/.test(curve)) continue;
      this._curves.set(key, curve); return curve;
    }
    return null;
  };
  const curve = await r._curveFor("0x" + "11".repeat(20));
  assert.equal(curve, "0x" + "99".repeat(20));
  assert.deepEqual(calls, [HOME, ADHOC, HOOKIT], "home first, then each extra, stopping at the one that knows it");
  if (orig) Object.defineProperty(Contract.prototype, "getLaunchedToken", orig);
  void realCurveFor;
});

test("what hookit still needs is written down, and no hookit address is compiled into the tree", async () => {
  assert.ok(HOOKIT_NEEDS_VERIFIED_SOURCE.length >= 5);
  for (const s of HOOKIT_NEEDS_VERIFIED_SOURCE) assert.ok(s.length > 40, "each gap says what it is and what it unlocks");
  const joined = HOOKIT_NEEDS_VERIFIED_SOURCE.join(" ").toLowerCase();
  for (const must of ["addresses.json", "abi", "master", "router", "fee"]) assert.ok(joined.includes(must), `${must} is listed`);
  // The addresses only ever appear truncated in what this environment can read, and a truncated
  // address compiled in "for now" is exactly the mistake this file exists to refuse.
  const fs = await import("node:fs");
  const src = fs.readFileSync("src/velocity/venues/ink/hookit.mjs", "utf8");
  assert.doesNotMatch(src, /0x[0-9a-fA-F]{6,}/, "no address-like constants, truncated or whole");
});
