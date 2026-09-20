// t45 — The engine enters through a fleet and exits through one.
//
// Everything the engine does after the entry — the ladder, the stop, the outcome the Kelly sizer
// learns from — is computed from one position record. These pin that a fleet entry produces exactly
// that, that paper trading is untouched, and that the exit follows the tokens rather than assuming
// every wallet still holds some.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine } from "../../src/velocity/core/engine.mjs";
import { loadRiskEnvelope } from "../../src/velocity/core/risk.mjs";
import { ScriptedFeed } from "../../src/velocity/core/feed.mjs";
import { makeEvent } from "../../src/velocity/core/events.mjs";
import { PumpfunPaperRouter } from "../../src/velocity/venues/pumpfun/router.mjs";
import { makePumpfunEdge } from "../../src/velocity/venues/pumpfun/edge.mjs";
import { failure } from "../../src/velocity/core/router.mjs";
import { goodCandidatePayload } from "./helpers/fixtures.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "velocity-t45-"));
function envelope(dir) {
  const base = JSON.parse(fs.readFileSync(path.resolve("src/velocity/config/risk.example.json"), "utf8"));
  const cfg = { ...base, bankroll_usd: 500, per_trade_max_usd: 40, portfolio_max_exposure_usd: 200, daily_loss_limit_usd: 100, max_concurrent_positions: 4, max_per_group: 1 };
  cfg.venues = { ...base.venues, pumpfun: { ...base.venues.pumpfun, max_exposure_usd: 200 }, polymarket: { ...base.venues.polymarket, max_exposure_usd: 0 } };
  const file = path.join(dir, "risk.json");
  fs.writeFileSync(file, JSON.stringify(cfg));
  return loadRiskEnvelope(file);
}

/** A live router that actually has a fleet and records which wallet each call used. */
class FleetLive {
  constructor({ size = 3, priceAt = () => 0.01, sellPrice = 0.02 } = {}) {
    this.ready = false; this.calls = []; this.buys = []; this.sells = []; this.held = new Map();
    this.fleet = []; this.size = size; this.priceAt = priceAt; this.sellPrice = sellPrice; this.priorityFeeSol = 0.0003;
  }
  async useFleet(n) { this.fleet = Array.from({ length: n }, (_, i) => ({ label: `f${i}`, publicKey: `PK${i}` })); return this.fleet; }
  async init() { this.calls.push("init"); this.ready = true; return { wallet: "ROOT", balanceSol: 5, rpc: "fake" }; }
  async health() { return { ok: true, latencyMs: 1, detail: "fake" }; }
  async preflight() { return { wallet: "ROOT", balanceSol: 5, rpc: "fake" }; }
  async positions() { const out = new Map(); for (const [k, q] of this.held) { const [inst] = k.split("|"); out.set(inst, (out.get(inst) || 0) + q); } return [...out].map(([instrument, qty]) => ({ instrument, qty })); }
  async submit(order) {
    const actor = order.actor || "root";
    this.buys.push({ actor, stake_usd: order.stake_usd, id: order.id });
    const price = this.priceAt(this.buys.length - 1);
    const qty = order.stake_usd / price;
    this.held.set(`${order.instrument}|${actor}`, (this.held.get(`${order.instrument}|${actor}`) || 0) + qty);
    const t = Date.now();
    return { ok: true, fill: { orderId: order.id, decisionId: order.decisionId, venue: "pumpfun", instrument: order.instrument, side: "BUY", price, qty, notional_usd: order.stake_usd, fee_usd: 0.05, rent_usd: 0.41, slippage_bps: 10, sol_spent: order.stake_usd / 200, t_sent: t, t_filled: t + 5, latency_ms: 5, venue_ref: `BUY${this.buys.length}`, exact: true, actor, wallet: `PK_${actor}` } };
  }
  async close(p, pct, ctx = {}) {
    const actor = ctx.actor || p.actor || "root";
    this.sells.push({ actor, pct, instrument: p.instrument });
    const key = `${p.instrument}|${actor}`;
    const have = this.held.get(key) || 0;
    if (!(have > 0)) return failure({ id: p.id }, "NO_POSITION", `wallet ${actor} has no token balance to sell`);
    const qty = have * Math.min(100, pct) / 100;
    this.held.set(key, have - qty);
    const t = Date.now();
    return { ok: true, fill: { orderId: `${p.id}:close`, venue: "pumpfun", instrument: p.instrument, side: "SELL", price: this.sellPrice, qty, notional_usd: qty * this.sellPrice, fee_usd: 0, sol_received: (qty * this.sellPrice) / 200, t_sent: t, t_filled: t + 5, latency_ms: 5, venue_ref: `SELL${this.sells.length}`, exact: true, actor } };
  }
  async closeTokenAccount() { return { closed: 0, reclaimed_sol: 0, sig: null }; }
}

function mkEngine(dir, { live, fleet = null, config = {} } = {}) {
  const venues = { pumpfun: { mode: "paper", feed: new ScriptedFeed({ venue: "pumpfun", script: [] }), edge: makePumpfunEdge(), router: new PumpfunPaperRouter({ bookFile: path.join(dir, "book.json"), latencyMs: 0 }), liveRouter: live, fleet } };
  return new Engine({ dataDir: dir, envelope: envelope(dir), venues, config: { saveMs: 600_000, governorMs: 600_000, sweepMs: 600_000, reentryCooldownMs: 0, ...config } });
}
const cand = (id, t = Date.now()) => makeEvent({ venue: "pumpfun", kind: "candidate", id, t_venue: t - 100, t_observed: t, payload: goodCandidatePayload(id) });

async function liveEngine(dir, opts) {
  const e = mkEngine(dir, opts);
  e.store.setVenueMode("pumpfun", "live", { liveStartCapUsd: null });
  e.store.save();
  await e.start({ reconcile: false });
  return e;
}

test("a fleet entry is one position built from several transactions", async () => {
  const dir = tmp();
  const live = new FleetLive({ size: 3 });
  const engine = await liveEngine(dir, { live, fleet: { size: 3, lambda: 0 } });
  try {
    assert.equal(live.fleet.length, 3, "the fleet is derived when the live router comes up");
    await engine.enqueue(() => engine.onEvent(cand("MintA")));
    const open = engine.store.openPositions("pumpfun");
    assert.equal(open.length, 1, "the engine sees one position, whatever the chain saw");
    const p = open[0];
    assert.equal(live.buys.length, 3, "and the chain saw three");
    assert.deepEqual(live.buys.map(b => b.actor), ["f0", "f1", "f2"]);
    assert.deepEqual(p.wallets.map(w => w.actor), ["f0", "f1", "f2"]);
    assert.ok(Math.abs(live.buys.reduce((s, b) => s + b.stake_usd, 0) - p.stake_usd) < 1e-4, "the slices spend the sized stake, not more");
    assert.ok(Math.abs(p.wallets.reduce((s, w) => s + w.qty, 0) - p.qty) < 1e-6);
    // The rent of three token accounts is held apart from the cost, as it is for one.
    assert.ok(Math.abs(p.rent_usd - 1.23) < 1e-9);
    assert.ok(Math.abs(p.cost_usd - (p.notional_usd - 1.23)) < 1e-4);
    // The plan is on the ledger before the first slice is sent, so an abort is explicable afterwards.
    const sliced = engine.ledger.query({ kind: "order", limit: 50 }).find(o => o.stage === "sliced");
    assert.ok(sliced, "the slicing is recorded");
    assert.equal(sliced.slices.length, 3);
    assert.equal(sliced.lambda, 0);
  } finally { await engine.stop(); }
});

test("paper trading is untouched — the split changes execution, not the strategy the gate judges", async () => {
  const dir = tmp();
  const live = new FleetLive({ size: 3 });
  const engine = mkEngine(dir, { live, fleet: { size: 3, lambda: 0 } });
  try {
    await engine.start({ reconcile: false });
    await engine.enqueue(() => engine.onEvent(cand("MintP")));
    const p = engine.store.openPositions("pumpfun")[0];
    assert.equal(p.paper, true);
    assert.equal(p.wallets, null, "a paper position has no wallets, and every exit path checks for that");
    assert.equal(live.buys.length, 0);
  } finally { await engine.stop(); }
});

test("a fleet of one is a single order, and so is a venue with no fleet configured", async () => {
  for (const fleet of [null, { size: 1 }]) {
    const dir = tmp();
    const live = new FleetLive({ size: 1 });
    const engine = await liveEngine(dir, { live, fleet });
    try {
      await engine.enqueue(() => engine.onEvent(cand("MintS")));
      assert.equal(live.buys.length, 1, `fleet ${JSON.stringify(fleet)} sends one order`);
      assert.equal(live.buys[0].actor, "root");
      assert.equal(engine.store.openPositions("pumpfun")[0].wallets, null);
    } finally { await engine.stop(); }
  }
});

test("the exit sells from every wallet and remembers what each has left", async () => {
  const dir = tmp();
  const live = new FleetLive({ size: 3, sellPrice: 0.02 });
  const engine = await liveEngine(dir, { live, fleet: { size: 3, lambda: 0 } });
  try {
    await engine.enqueue(() => engine.onEvent(cand("MintX")));
    const p = engine.store.openPositions("pumpfun")[0];
    const before = p.qty;

    const half = await engine.closePosition(p, 50, "TEST_RUNG");
    assert.equal(half.ok, true, JSON.stringify(half));
    assert.equal(live.sells.length, 3, "one leg per wallet");
    assert.deepEqual(new Set(live.sells.map(s => s.actor)), new Set(["f0", "f1", "f2"]));
    assert.ok(Math.abs(half.fill.qty - before / 2) < 1e-6, "the rung is the ladder's, not each wallet's");
    // Largest holding first: the fee is the one cost a fleet multiplies, so the order is not
    // arbitrary. The slice weights are drawn from the order id, so which wallet is largest differs
    // run to run — the invariant is the ordering, not the names.
    const sold = live.sells.map(s => s.actor);
    const remaining = new Map(p.wallets.map(w => [w.actor, w.qty]));
    const soldSizes = sold.map(a => remaining.get(a));
    assert.deepEqual(soldSizes, [...soldSizes].sort((x, y) => y - x), "the legs go out largest holding first");
    assert.ok(Math.abs(p.wallets.reduce((s, w) => s + w.qty, 0) - before / 2) < 1e-6, "each wallet is decremented by what it sold");

    const rest = await engine.closePosition(p, 100, "TEST_FLAT");
    assert.equal(rest.ok, true, JSON.stringify(rest));
    assert.equal(live.sells.length, 6);
    assert.equal(p.wallets, null, "an emptied fleet stops being one");
    assert.equal(engine.store.openPositions("pumpfun").length, 0);
  } finally { await engine.stop(); }
});

test("a wallet emptied on an earlier rung is not sent a leg again", async () => {
  const dir = tmp();
  const live = new FleetLive({ size: 3 });
  const engine = await liveEngine(dir, { live, fleet: { size: 3, lambda: 0 } });
  try {
    await engine.enqueue(() => engine.onEvent(cand("MintY")));
    const p = engine.store.openPositions("pumpfun")[0];
    // Empty one wallet behind the engine's back, as a reclaim or a manual sell would.
    const gone = p.wallets[1].actor;
    live.held.set(`MintY|${gone}`, 0);
    p.wallets = p.wallets.filter(w => w.actor !== gone);
    live.sells.length = 0;
    await engine.closePosition(p, 100, "TEST");
    assert.deepEqual(new Set(live.sells.map(s => s.actor)), new Set(p.wallets?.map(w => w.actor) || ["f0", "f2"]));
    assert.ok(!live.sells.some(s => s.actor === gone), "a leg that would fail NO_POSITION counts towards the terminal tally for a position selling perfectly well out of the others");
  } finally { await engine.stop(); }
});

test("contention comes from the kind of entry, because nothing is racing us into a dip", () => {
  const dir = tmp();
  const engine = mkEngine(dir, { live: new FleetLive(), fleet: { size: 3 } });
  const l = k => engine.contentionFor("pumpfun", { plan_key: k });
  assert.equal(l("bondli_gates"), 0.8, "a launch: every second of stagger is a worse fill");
  assert.equal(l("bondli_dip"), 0.25);
  assert.equal(l("bondli_revival"), 0.1);
  assert.equal(l("bondli_slowcook"), 0.1);
  assert.ok(l("bondli_dip") < l("bondli_gates"), "the split is a purchase of information, worth making when there is time to use it");
  // An operator who knows better says so, and is believed within range.
  const forced = mkEngine(tmp(), { live: new FleetLive(), fleet: { size: 3, lambda: 0.42 } });
  assert.equal(forced.contentionFor("pumpfun", { plan_key: "bondli_gates" }), 0.42);
  const silly = mkEngine(tmp(), { live: new FleetLive(), fleet: { size: 3, lambda: 9 } });
  assert.equal(silly.contentionFor("pumpfun", { plan_key: "bondli_gates" }), 1);
});
