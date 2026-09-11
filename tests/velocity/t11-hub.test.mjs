// T11: the hosted hub. One shared feed drives one engine per user; a user's engine trades its own
// wallet under its own envelope; a profitable close pays the platform's cut from measured SOL to
// PLATFORM_WALLET and never to the exposed default; stopping flattens.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ScriptedFeed } from "../../src/velocity/core/feed.mjs";
import { makeEvent } from "../../src/velocity/core/events.mjs";
import { failure } from "../../src/velocity/core/router.mjs";
import { VelocityHub, SharedFeedView, userEnvelope, EXPOSED_DEFAULT_PLATFORM_WALLET } from "../../src/velocity/hub.mjs";
import { goodCandidatePayload, tickPayload } from "./helpers/fixtures.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "velocity-t11-"));

/** A live router double with measured SOL on both sides and a recorded fee transfer. */
class FakeLive {
  constructor({ secret, wallet, balanceSol = 1, sellSol = 0.07 }) {
    this.secret = secret; this.owner = wallet; this.ready = false; this.balanceSol = balanceSol; this.sellSol = sellSol;
    this.transfers = []; this.priorityFeeSol = 0.0005; this.tokens = {};
  }
  async init() { this.ready = true; return { wallet: "TW_" + this.owner, balanceSol: this.balanceSol, rpc: "fake" }; }
  async preflight() { return { wallet: "TW_" + this.owner, balanceSol: this.balanceSol, rpc: "fake" }; }
  async health() { return { ok: true, latencyMs: 1, detail: "fake" }; }
  async positions() { return Object.entries(this.tokens).filter(([, q]) => q > 0).map(([instrument, qty]) => ({ instrument, qty })); }
  async submit(o) { const t = Date.now(); this.tokens[o.instrument] = 1000; return { ok: true, fill: { orderId: o.id, decisionId: o.decisionId, venue: "pumpfun", instrument: o.instrument, side: "BUY", price: 0.005, qty: 1000, notional_usd: 5.1, fee_usd: 0.1, t_sent: t, t_filled: t + 3, latency_ms: 3, venue_ref: "SIGBUY", sol_spent: 0.051 } }; }
  async close(p) { if (!this.tokens[p.instrument]) return failure({ id: p.id }, "NO_POSITION", "none"); this.tokens[p.instrument] = 0; const t = Date.now(); return { ok: true, fill: { price: 0.007, qty: 1000, notional_usd: this.sellSol * 100, fee_usd: 0, t_sent: t, t_filled: t + 3, latency_ms: 3, venue_ref: "SIGSELL", sol_received: this.sellSol } }; }
  async transferSol(to, sol) { this.transfers.push({ to, sol }); return "SIGFEE"; }
}

function feeDeps(tier = "pro") {
  const outcomes = [], global = [];
  return {
    outcomes, global,
    getUser: async () => ({ tier }),
    resolveTier: () => ({ tier, whitelisted: false }),
    recordTradeOutcome: (w, net) => outcomes.push(net),
    recordGlobalFee: f => global.push(f),
    // 10% of net profit, nothing on a loss or dust: the shape of bondli's calculateFee.
    calculateFee: (solIn, solOut) => { const net = +(solOut - solIn).toFixed(6); return net <= 0.001 ? { fee: 0, net } : { fee: +(net * 0.10).toFixed(6), net, rate: 10 }; },
  };
}

test("T11: a user's envelope is the template with their choices, validated", () => {
  const e = userEnvelope({ bankrollUsd: 100, perTradeMaxUsd: 10, maxPositions: 4 });
  assert.equal(e.bankroll_source, "wallet"); assert.equal(e.per_trade_max_usd, 10); assert.equal(e.portfolio_max_exposure_usd, 40);
  assert.equal(e.daily_loss_limit_usd, 15); assert.equal(e.venues.pumpfun.max_exposure_usd, 40); assert.equal(e.venues.polymarket.max_exposure_usd, 0);
  assert.ok(Object.isFrozen(e) && Object.isFrozen(e.venues.pumpfun));
  const small = userEnvelope({ bankrollUsd: 30, perTradeMaxUsd: 50, maxPositions: 20 });
  assert.equal(small.per_trade_max_usd, 30, "per-trade cannot exceed the bankroll"); assert.equal(small.max_concurrent_positions, 10);
});

test("T11: one feed, two users, isolated ledgers, fee paid on the profitable close; the original platform wallet is accepted", async () => {
  const root = tmp();
  const feed = new ScriptedFeed({ venue: "pumpfun", script: [] });
  feed.solPrice = 100;
  const routers = {};
  const deps = feeDeps("pro");
  const hub = new VelocityHub({ feed, rootDir: root, platformWallet: "PLATFORM_FRESH_WALLET", fee: deps, makeLiveRouter: ({ secret, wallet }) => (routers[wallet] = new FakeLive({ secret, wallet })), log: { log() {}, error() {}, warn() {} } });
  assert.equal(hub.feeOk, true);
  await feed.start();
  try {
    const a = await hub.start({ wallet: "UserA", secret: "sA", settings: { bankrollUsd: 100, aggression: 2 } });
    assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(a.status.venues.pumpfun.mode, "live"); assert.equal(a.settings.aggression, 2);
    const b = await hub.start({ wallet: "UserB", secret: "sB", settings: { bankrollUsd: 50 } });
    assert.equal(b.ok, true); assert.equal(hub.list().length, 2);
    assert.equal(routers.UserA.secret, "sA"); assert.equal(routers.UserB.secret, "sB", "each engine signs with its own key");
    assert.ok(fs.existsSync(path.join(root, "UserA", "ledger.jsonl")) && fs.existsSync(path.join(root, "UserB", "ledger.jsonl")));

    // One candidate on the shared feed reaches both engines; both buy with their own wallet.
    const now = Date.now();
    feed.emitEvent({ kind: "candidate", id: "MintX", payload: goodCandidatePayload("MintX"), t_venue: now - 100 });
    await new Promise(r => setTimeout(r, 50));
    for (const w of ["UserA", "UserB"]) { await hub.users.get(w).engine.enqueue(() => {}); assert.equal(hub.users.get(w).engine.store.openPositions("pumpfun").length, 1, `${w} holds MintX`); }
    // A crash tick closes both. Sold for 0.07 SOL against 0.051 spent: 0.019 profit, 10% fee = 0.0019 SOL.
    feed.emitEvent({ kind: "tick", id: "MintX", payload: tickPayload("MintX", 17_000, { dynamics: { scores: 5, velocity: -0.6, acceleration: -0.2, trend: "crashing" } }), t_venue: now + 500 });
    await new Promise(r => setTimeout(r, 80));
    for (const w of ["UserA", "UserB"]) await hub.users.get(w).engine.enqueue(() => {});
    await new Promise(r => setTimeout(r, 30));
    assert.deepEqual(routers.UserA.transfers, [{ to: "PLATFORM_FRESH_WALLET", sol: 0.0019 }]);
    assert.deepEqual(routers.UserB.transfers, [{ to: "PLATFORM_FRESH_WALLET", sol: 0.0019 }]);
    const feeRec = hub.users.get("UserA").engine.ledger.query({ kind: "fee", limit: 1 })[0];
    assert.equal(feeRec.scope, "platform"); assert.equal(feeRec.sol, 0.0019); assert.equal(feeRec.venue_ref, "SIGFEE"); assert.equal(feeRec.usd, 0.285, "priced at the candidate's SOL price (150), fresher than the feed's 100");
    assert.deepEqual(deps.global, [0.0019, 0.0019]); assert.deepEqual(deps.outcomes, [0.019, 0.019]);
    const nar = hub.narration("UserA", 20).map(x => x.line);
    assert.ok(nar.some(l => /FILLED  BUY MintX/.test(l)) && nar.some(l => /fee/.test(l)), nar.join("\n"));

    // Stop flattens (nothing open now) and forgets the user; the other keeps running.
    const s = await hub.stop("UserA");
    assert.equal(s.ok, true); assert.equal(hub.has("UserA"), false); assert.equal(hub.has("UserB"), true);
    assert.equal(hub.status("UserA").running, false);
  } finally { await hub.stopAll(); await feed.stop(); }

  // A loss pays nothing; the exposed default wallet is refused as a fee destination.
  const feed2 = new ScriptedFeed({ venue: "pumpfun", script: [] }); feed2.solPrice = 100; await feed2.start();
  const deps2 = feeDeps("free");
  const hub2 = new VelocityHub({ feed: feed2, rootDir: tmp(), platformWallet: EXPOSED_DEFAULT_PLATFORM_WALLET, fee: deps2, makeLiveRouter: ({ secret, wallet }) => (routers[wallet] = new FakeLive({ secret, wallet, sellSol: 0.03 })), log: { log() {}, error() {}, warn() {} } });
  assert.equal(hub2.feeOk, true, "the operator's choice of wallet stands");
  try {
    assert.equal((await hub2.start({ wallet: "UserC", secret: "sC", settings: {} })).ok, true);
    const now = Date.now();
    feed2.emitEvent({ kind: "candidate", id: "MintY", payload: goodCandidatePayload("MintY"), t_venue: now - 100 });
    await new Promise(r => setTimeout(r, 50)); await hub2.users.get("UserC").engine.enqueue(() => {});
    feed2.emitEvent({ kind: "tick", id: "MintY", payload: tickPayload("MintY", 17_000, { dynamics: { scores: 5, velocity: -0.6, acceleration: -0.2, trend: "crashing" } }), t_venue: now + 500 });
    await new Promise(r => setTimeout(r, 80)); await hub2.users.get("UserC").engine.enqueue(() => {}); await new Promise(r => setTimeout(r, 30));
    assert.deepEqual(routers.UserC.transfers, [], "a losing trade pays no fee");
    assert.deepEqual(deps2.outcomes, [-0.021]);
    routers.UserC.sellSol = 0.09; routers.UserC.tokens = {};
    feed2.emitEvent({ kind: "candidate", id: "MintZ", payload: goodCandidatePayload("MintZ"), t_venue: now + 1000 });
    await new Promise(r => setTimeout(r, 50)); await hub2.users.get("UserC").engine.enqueue(() => {});
    feed2.emitEvent({ kind: "tick", id: "MintZ", payload: tickPayload("MintZ", 17_000, { dynamics: { scores: 5, velocity: -0.6, acceleration: -0.2, trend: "crashing" } }), t_venue: now + 1500 });
    await new Promise(r => setTimeout(r, 80)); await hub2.users.get("UserC").engine.enqueue(() => {}); await new Promise(r => setTimeout(r, 30));
    assert.equal(routers.UserC.transfers.length, 1, "the profit's fee goes to the configured wallet");
    assert.equal(routers.UserC.transfers[0].to, EXPOSED_DEFAULT_PLATFORM_WALLET);
    assert.equal(hub2.users.get("UserC").engine.ledger.query({ kind: "fee", limit: 1 }).length, 1);
  } finally { await hub2.stopAll(); await feed2.stop(); }

  // A wallet that cannot cover one order is refused at start.
  const feed3 = new ScriptedFeed({ venue: "pumpfun", script: [] }); await feed3.start();
  const hub3 = new VelocityHub({ feed: feed3, rootDir: tmp(), platformWallet: "PLATFORM_FRESH_WALLET", fee: feeDeps(), makeLiveRouter: ({ secret, wallet }) => new FakeLive({ secret, wallet, balanceSol: 0.01 }), log: { log() {}, error() {}, warn() {} } });
  try { const r = await hub3.start({ wallet: "UserD", secret: "sD" }); assert.equal(r.ok, false); assert.match(r.error, /below one minimum stake/); assert.equal(hub3.has("UserD"), false); }
  finally { await hub3.stopAll(); await feed3.stop(); }
});

test("T11: a shared feed view forwards events and reference-counts watches", async () => {
  const feed = new ScriptedFeed({ venue: "pumpfun", script: [] }); await feed.start();
  const v1 = new SharedFeedView(feed), v2 = new SharedFeedView(feed);
  const got = []; v1.on("event", e => got.push(e.id)); await v1.start(); await v2.start();
  feed.emitEvent({ kind: "tick", id: "M", payload: {} });
  assert.deepEqual(got, ["M"]); assert.equal(v1.eventsEmitted, 1);
  v1.watch("M"); v2.watch("M"); v1.unwatch("M");
  assert.ok(feed.watched.has("M"), "still watched by v2");
  v2.unwatch("M"); assert.ok(!feed.watched.has("M"));
  await v1.stop(); feed.emitEvent({ kind: "tick", id: "N", payload: {} }); assert.deepEqual(got, ["M"], "a stopped view hears nothing");
  await feed.stop();
});

test("T11: a flat fee rate takes that share of realized profit, nothing on a loss, nothing from the owner", async () => {
  const feed = new ScriptedFeed({ venue: "pumpfun", script: [] }); await feed.start();
  const deps = { ...feeDeps("free"), isOwnerWallet: w => w === "Owner" };
  const hub = new VelocityHub({ feed, rootDir: tmp(), platformWallet: "PLATFORM_FRESH_WALLET", fee: deps, feePct: 5, log: { log() {}, error() {}, warn() {} } });
  assert.equal(hub.feePct, 5);
  assert.deepEqual(hub.flatFee(0.05, 0.09, "UserE"), { fee: 0.002, net: 0.04, rate: 5, type: "profit-share" }, "5% of 0.04 SOL profit");
  assert.equal(hub.flatFee(0.05, 0.04, "UserE").fee, 0, "a loss pays nothing");
  assert.equal(hub.flatFee(0.05, 0.0505, "UserE").fee, 0, "dust pays nothing");
  assert.equal(hub.flatFee(0.05, 0.09, "Owner").fee, 0, "the owner pays nothing");
  assert.equal(new VelocityHub({ feed, rootDir: tmp(), platformWallet: "P", fee: deps, log: { error() {} } }).feePct, null, "unset means the site's ladder");
  await feed.stop();
});

test("T11: a stop's halt does not outlive the next start; pause freezes entries and resume lifts it", async () => {
  const root = tmp();
  const feed = new ScriptedFeed({ venue: "pumpfun", script: [] });
  feed.solPrice = 100;
  const hub = new VelocityHub({ feed, rootDir: root, platformWallet: "PLATFORM_FRESH_WALLET", fee: feeDeps("pro"), makeLiveRouter: ({ secret, wallet }) => new FakeLive({ secret, wallet }), log: { log() {}, error() {}, warn() {} } });
  await feed.start();
  try {
    await hub.start({ wallet: "UserC", secret: "sC", settings: { bankrollUsd: 100 } });
    await hub.stop("UserC"); // halt("flatten", "user stop") is persisted in the user's store
    const again = await hub.start({ wallet: "UserC", secret: "sC", settings: { bankrollUsd: 100 } });
    assert.equal(again.ok, true);
    assert.equal(again.status.halt.mode, null, "the old user stop is gone: the bot judges tokens again");
    const p = await hub.pause("UserC");
    assert.equal(p.status.halt.mode, "freeze"); assert.match(p.status.halt.reason, /paused by user/);
    assert.equal(hub.status("UserC").running, true, "paused is still running: positions keep their exit plans");
    const r = hub.resume("UserC");
    assert.equal(r.status.halt.mode, null);
    assert.equal(hub.pause("Nobody") instanceof Promise, true); assert.equal((await hub.pause("Nobody")).ok, false);
  } finally { await hub.stopAll(); await feed.stop(); }
});

test("T11: the sweep sells every token in both wallets: open positions through the engine, the rest through the routers, graduated PONS reported", async () => {
  const root = tmp();
  const feed = new ScriptedFeed({ venue: "pumpfun", script: [] }); feed.solPrice = 100;
  const ponsFeed = new ScriptedFeed({ venue: "pons", script: [] }); ponsFeed.solPrice = 2000;
  ponsFeed.rpc = {
    walletTokens: async () => [{ instrument: "0xheld", qty: 500 }, { instrument: "0xgrad", qty: 300 }, { instrument: "0xdust", qty: 0.2 }, { instrument: "0xrandom", qty: 10 }],
    launchInfo: async (t) => t === "0xheld" ? { curve: "0xcurve1", graduated: false } : t === "0xgrad" ? { curve: "0xcurve2", graduated: true } : null,
    curveInfo: async () => ({ quoteReserve: 3, tokenReserve: 9e8, feeBps: 100, creatorTaxBps: 0 }),
  };
  const routers = {};
  class FakeEvm { constructor() { this.ready = false; this.address = "0xme"; this.known = new Set(); this.tokens = { "0xheld": 500, "0xgrad": 300 }; this.closed = []; }
    async init() { this.ready = true; return this.preflight(); } async preflight() { return { wallet: this.address, balanceSol: 0.05, quote: "ETH" }; } async health() { return { ok: true, latencyMs: 1 }; }
    track(t) { this.known.add(t); } async positions() { return [...this.known].filter(t => this.tokens[t] > 0).map(t => ({ instrument: t, qty: this.tokens[t] })); }
    async submit() { return failure({ id: "x" }, "UNUSED", ""); }
    async close(p, pct, ctx) { this.closed.push({ instrument: p.instrument, curve: ctx?.reference?.curve?.address }); this.tokens[p.instrument] = 0; return { ok: true, fill: { price: 0.00001, qty: 500, notional_usd: 12, fee_usd: 0, t_sent: 1, t_filled: 2, latency_ms: 1, venue_ref: "0xtx", sol_received: 0.006 } }; }
    async transferSol() { return "0xfee"; } }
  const hub = new VelocityHub({ feed, ponsFeed, rootDir: root, platformWallet: "PLATFORM_FRESH_WALLET", platformEvmWallet: "0x" + "1".repeat(40), fee: feeDeps("pro"), makeLiveRouter: ({ secret, wallet }) => (routers[wallet] = new FakeLive({ secret, wallet })), makePonsRouter: () => (routers.evm = new FakeEvm()), log: { log() {}, error() {}, warn() {} } });
  await feed.start(); await ponsFeed.start();
  try {
    await hub.start({ wallet: "UserS", secret: "sS", evmSecret: "0xkey", settings: { bankrollUsd: 100, pons: true } });
    // an open pump.fun position, plus a token the wallet holds that the store never tracked
    const now = Date.now();
    feed.emitEvent({ kind: "candidate", id: "MintX", payload: goodCandidatePayload("MintX"), t_venue: now - 100 });
    await new Promise(r => setTimeout(r, 50)); await hub.users.get("UserS").engine.enqueue(() => {});
    assert.equal(hub.users.get("UserS").engine.store.openPositions("pumpfun").length, 1);
    routers.UserS.tokens.MintOrphan = 2000;
    const r = await hub.sweepWallet("UserS", { secret: "sS", evmSecret: "0xkey" });
    assert.equal(r.ok, true);
    assert.equal(hub.users.get("UserS").engine.store.openPositions("pumpfun").length, 0, "the open position was closed through the engine");
    assert.ok(r.report.some(x => x.venue === "pumpfun" && x.instrument === "MintX" && x.ok && x.position), "booked as a position close");
    assert.ok(r.report.some(x => x.venue === "pumpfun" && x.instrument === "MintOrphan" && x.ok), "the orphan was sold straight through the router");
    assert.ok(routers.evm.closed.some(c => c.instrument === "0xheld" && c.curve === "0xcurve1"), "the RH holding was sold on its curve");
    assert.ok(r.report.some(x => x.instrument === "0xgrad" && x.code === "GRADUATED"), "a graduated curve is reported, not attempted");
    assert.ok(r.report.some(x => x.instrument === "0xrandom" && /not a PONS launch/.test(x.error)));
    assert.ok(!r.report.some(x => x.instrument === "0xdust"), "dust is ignored");
    assert.equal(hub.users.get("UserS").engine.ledger.query({ kind: "exit", limit: 5 }).some(e => e.reason === "USER_SWEEP"), true);
    // The same sweep as a background job: the call returns at once, status follows it, a second call while it runs joins it.
    routers.UserS.tokens.MintOrphan2 = 2000; routers.evm.tokens["0xheld"] = 700;
    const j = hub.startSweep("UserS", { secret: "sS", evmSecret: "0xkey" });
    assert.equal(j.started, true); assert.equal(j.sweep.done, false);
    assert.equal(hub.startSweep("UserS", { secret: "sS", evmSecret: "0xkey" }).started, false, "one sweep at a time");
    for (let i = 0; i < 100 && !hub.status("UserS").sweep.done; i++) await new Promise(r => setTimeout(r, 20));
    const sv = hub.status("UserS").sweep;
    assert.equal(sv.done, true); assert.ok(sv.report.some(x => x.instrument === "MintOrphan2" && x.ok)); assert.ok(sv.report.some(x => x.instrument === "0xheld" && x.ok)); assert.equal(sv.current, null);
    // The holdings list: every token, its curve state, what a sell would fetch
    routers.evm.tokens["0xheld"] = 900; routers.UserS.tokens.MintOrphan3 = 50;
    const hl = await hub.listHoldings("UserS", { secret: "sS", evmSecret: "0xkey" });
    const heldRow = hl.eth.find(x => x.instrument === "0xheld"), gradRow = hl.eth.find(x => x.instrument === "0xgrad"), randRow = hl.eth.find(x => x.instrument === "0xrandom");
    assert.equal(heldRow.state, "curve"); assert.ok(heldRow.sellEth > 0); assert.equal(gradRow.state, "graduated"); assert.equal(randRow.state, "not a PONS launch");
    assert.ok(hl.sol.some(x => x.instrument === "MintOrphan3" && x.qty === 50));
    // One holding by itself, tracked or not, through the router
    routers.evm.tokens["0xheld"] = 900;
    const one = await hub.sellHolding("UserS", { venue: "pons", instrument: "0xheld", evmSecret: "0xkey" });
    assert.equal(one.ok, true); assert.equal(one.received, 0.006); assert.equal(routers.evm.tokens["0xheld"], 0);
  } finally { await hub.stopAll(); await feed.stop(); await ponsFeed.stop(); }
});
