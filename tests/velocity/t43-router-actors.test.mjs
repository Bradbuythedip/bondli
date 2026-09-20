// t43 — The live router signs as an actor, not as a fixture.
//
// Before this, the keypair was baked into the router at init() and every method reached for it
// directly, so a position could only ever be one wallet. These pin the parameterisation: the root
// still behaves exactly as it did, the fleet is derived from the same sealed secret, an unknown
// actor is an error rather than a silent fallback to the root, and reconciliation sees every
// wallet's holdings rather than the root's alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PumpfunLiveRouter } from "../../src/velocity/venues/pumpfun/router.mjs";
import { deriveFleet } from "../../src/velocity/core/fleet.mjs";

/** An RPC that actually distinguishes owners, which the t10 double does not need to. */
function ownerConn({ sol = {}, tokens = {}, statuses = {}, txs = {} } = {}) {
  const c = {
    sol, tokens, statuses, txs, sent: 0, signedBy: [], builtFor: [], nextSig: "SIG1",
    // A wallet nobody funded has nothing: the default must not be a stray SOL, or the fleet
    // would look funded when only the root is.
    async getBalance(pk) { return Math.round((c.sol[String(pk)] ?? 0) * 1e9); },
    async getParsedTokenAccountsByOwner(owner, { mint } = {}) {
      const held = c.tokens[String(owner)] || {};
      const entries = mint ? [[mint.v, held[mint.v] || 0]] : Object.entries(held);
      return { value: entries.filter(([, q]) => q > 0).map(([m, q]) => ({ account: { data: { parsed: { info: { mint: m, tokenAmount: { uiAmount: q, amount: String(q) } } } } } })) };
    },
    async getSignatureStatuses([sig]) { return { value: [c.statuses[sig] ?? null] }; },
    async getTransaction(sig) { return c.txs[sig] ?? null; },
    async getLatestBlockhash() { return { blockhash: "x" }; },
    async sendRawTransaction() { c.sent++; return c.nextSig; },
  };
  return c;
}

const SEED = "1111111111111111111111111111111111111111111111111111111111111111";

function router(conn, over = {}) {
  let t = 1_000_000;
  const r = new PumpfunLiveRouter({
    secret: SEED, confirmTimeoutMs: 30, lateConfirmMs: 30, sleep: async () => {}, clock: () => t,
    fetchImpl: async (_url, opts) => { conn.builtFor.push(JSON.parse(opts.body).publicKey); return { ok: true, arrayBuffer: async () => new Uint8Array(200).buffer }; },
    ...over,
  });
  r.ready = true; r.publicKey = "ROOTPK"; r.keypair = { publicKey: "ROOTPK" };
  r.web3 = {
    PublicKey: class { constructor(v) { this.v = v; } toString() { return String(this.v); } },
    Keypair: { fromSeed: (s) => { const id = `SUB${Buffer.from(s).toString("hex").slice(0, 6)}`; return { publicKey: { toBase58: () => id, toString: () => id } }; } },
    VersionedTransaction: { deserialize: () => ({ sign(keys) { conn.signedBy.push(String(keys[0].publicKey)); }, serialize() { return new Uint8Array(1); } }) },
  };
  r.connection = conn;
  return r;
}

const confirmed = { confirmationStatus: "confirmed", err: null };
const metaFor = (owner, solDelta, tokenDelta, mint = "M") => ({ meta: { err: null, preBalances: [1e9], postBalances: [1e9 + Math.round(solDelta * 1e9)], preTokenBalances: tokenDelta < 0 ? [{ mint, owner, uiTokenAmount: { uiAmount: -tokenDelta } }] : [], postTokenBalances: tokenDelta > 0 ? [{ mint, owner, uiTokenAmount: { uiAmount: tokenDelta } }] : [] } });
const buyOrder = (over = {}) => ({ id: "o1", decisionId: "d1", instrument: "M", stake_usd: 5, max_slippage_bps: 300, reference: { vSolInBondingCurve: 30, mcapUsd: 4500, solPrice: 200, solPriceAt: 970_000 }, ...over });

test("the root actor is the keypair, so a router that never calls useFleet is unchanged", async () => {
  const conn = ownerConn({ sol: { ROOTPK: 0.5 }, statuses: { SIG1: confirmed }, txs: { SIG1: metaFor("ROOTPK", -0.0285, 1200) } });
  const r = router(conn);
  assert.equal(r.root.publicKey, "ROOTPK");
  assert.deepEqual(r.allActors().map(a => a.label), ["root"]);
  const res = await r.submit(buyOrder());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(conn.builtFor, ["ROOTPK"], "the builder is asked for the root's transaction");
  assert.deepEqual(conn.signedBy, ["ROOTPK"]);
  assert.equal(res.fill.actor, "root");
  assert.equal(res.fill.wallet, "ROOTPK", "every fill names the wallet that carries it");
});

test("useFleet derives from the sealed root and nothing else is stored", async () => {
  const r = router(ownerConn());
  const listed = await r.useFleet(3);
  assert.deepEqual(listed.map(a => a.label), ["f0", "f1", "f2"]);
  // The addresses are exactly what core/fleet.mjs derives — the router adds no second scheme.
  const seeds = deriveFleet({ rootSecret: SEED, venue: "pumpfun", size: 3 });
  assert.deepEqual(listed.map(a => a.publicKey), seeds.map(s => `SUB${Buffer.from(s).toString("hex").slice(0, 6)}`));
  assert.deepEqual(r.allActors().map(a => a.label), ["root", "f0", "f1", "f2"]);
  // Idempotent: calling it again replaces the fleet with the same fleet.
  const again = await r.useFleet(3);
  assert.deepEqual(again, listed);
  assert.equal(r.allActors().length, 4, "the fleet does not accumulate");
});

test("an order routed to a fleet wallet is built, signed and settled as that wallet", async () => {
  const conn = ownerConn({ statuses: { SIG1: confirmed } });
  const r = router(conn);
  const [f0, f1] = await r.useFleet(2);
  conn.sol[f1.publicKey] = 0.5;
  conn.txs.SIG1 = metaFor(f1.publicKey, -0.0285, 1200);
  const res = await r.submit(buyOrder({ actor: "f1" }));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(conn.builtFor, [f1.publicKey], "the builder never sees the root");
  assert.deepEqual(conn.signedBy, [f1.publicKey]);
  assert.equal(res.fill.actor, "f1");
  assert.equal(res.fill.wallet, f1.publicKey);
  // The deltas were read against f1's ownership; the root's tx would have decoded to nothing.
  assert.equal(res.fill.exact, true);
  assert.equal(res.fill.qty, 1200);
  assert.ok(f0.publicKey !== f1.publicKey);
});

test("an empty fleet wallet fails on its own balance, naming itself", async () => {
  const conn = ownerConn({ sol: { ROOTPK: 10 } });
  const r = router(conn);
  await r.useFleet(2);
  const res = await r.submit(buyOrder({ actor: "f0" }));
  assert.equal(res.failure.code, "INSUFFICIENT_SOL");
  assert.match(res.failure.reason, /wallet f0 has/, "the root's balance is not the fleet's balance");
  assert.equal(conn.sent, 0);
});

test("an unknown actor is an error, never a quiet fall back to the root", async () => {
  const conn = ownerConn({ sol: { ROOTPK: 10 } });
  const r = router(conn);
  await r.useFleet(2);
  const res = await r.submit(buyOrder({ actor: "f9" }));
  assert.equal(res.failure.code, "SEND_FAILED");
  assert.match(res.failure.reason, /unknown actor 'f9'/);
  assert.equal(conn.sent, 0, "signing with the root would put the whole stake on one address");
  assert.throws(() => r._actor({ publicKey: "X" }), /needs a keypair/);
});

test("a close goes to the wallet that holds the tokens", async () => {
  const conn = ownerConn({ statuses: { SIG1: confirmed } });
  const r = router(conn);
  const [, f1] = await r.useFleet(2);
  conn.sol[f1.publicKey] = 0.1;
  conn.tokens[f1.publicKey] = { M: 1200 };
  conn.txs.SIG1 = metaFor(f1.publicKey, 0.03, -1200);
  const res = await r.close({ id: "p1", instrument: "M", actor: "f1", reference: { solPrice: 200 } }, 100);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(conn.signedBy, [f1.publicKey]);
  assert.equal(res.fill.actor, "f1");
  assert.equal(res.fill.qty, 1200);
  // ctx wins over the position, so the fleet layer can redirect a rung without rewriting it.
  conn.signedBy.length = 0;
  const none = await r.close({ id: "p1", instrument: "M", actor: "f1" }, 100, { actor: "root" });
  assert.equal(none.failure.code, "NO_POSITION");
  assert.match(none.failure.reason, /wallet root has no token balance/);
});

test("reconciliation sees the whole fleet, or a fleet entry reads as a phantom", async () => {
  const conn = ownerConn();
  const r = router(conn);
  const [f0, f1] = await r.useFleet(2);
  conn.tokens.ROOTPK = { M: 100 };
  conn.tokens[f0.publicKey] = { M: 250, N: 7 };
  conn.tokens[f1.publicKey] = { M: 50 };
  const pos = await r.positions();
  const m = pos.find(p => p.instrument === "M");
  assert.equal(m.qty, 400, "the engine holds one position per token however many wallets carry it");
  assert.deepEqual(m.wallets, [{ actor: "root", qty: 100 }, { actor: "f0", qty: 250 }, { actor: "f1", qty: 50 }]);
  assert.deepEqual(pos.find(p => p.instrument === "N").wallets, [{ actor: "f0", qty: 7 }]);
});

test("rent is reclaimed from the wallet that paid it", async () => {
  const conn = ownerConn({ statuses: { SIGRENT: confirmed } });
  conn.nextSig = "SIGRENT";
  const r = router(conn);
  const [f0] = await r.useFleet(1);
  r.web3.Transaction = class { constructor() { this.ix = []; } add(i) { this.ix.push(i); return this; } sign(kp) { conn.signedBy.push(String(kp.publicKey)); } serialize() { return new Uint8Array(1); } };
  // uiAmount 0 keeps the account out of positions(); closeTokenAccount reads `amount` instead.
  conn.getParsedTokenAccountsByOwner = async (owner) => ({ value: String(owner) === f0.publicKey ? [{ pubkey: "ATA", account: { data: { parsed: { info: { mint: "M", tokenAmount: { uiAmount: 0, amount: "0" } } } } } }] : [] });
  const out = await r.closeTokenAccount("M", "f0");
  assert.equal(out.closed, 1);
  assert.deepEqual(conn.signedBy, [f0.publicKey], "the root cannot close another wallet's account");
  // The root paid no rent here, so it has nothing to reclaim.
  assert.deepEqual(await r.closeTokenAccount("M"), { closed: 0, reclaimed_sol: 0, sig: null });
});
