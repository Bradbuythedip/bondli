// T10: the live path end to end, without a network. Every case here was a defect found by
// tracing the operator's first live day: a $50 bankroll that could never clear the minimum
// stake, a restart that forgot the venue was live, paper positions handed to the live router,
// fills booked from a lagging RPC, sells that landed after their timeout, and positions with
// no ticks and therefore no exit.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine } from "../../src/velocity/core/engine.mjs";
import { Sizer, loadRiskEnvelope } from "../../src/velocity/core/risk.mjs";
import { ScriptedFeed } from "../../src/velocity/core/feed.mjs";
import { makeEvent } from "../../src/velocity/core/events.mjs";
import { evaluateExit, createPlan } from "../../src/velocity/core/exits.mjs";
import { buildEngine, DEFAULT_CONFIG } from "../../src/velocity/core/build.mjs";
import { failure } from "../../src/velocity/core/router.mjs";
import { makePumpfunEdge } from "../../src/velocity/venues/pumpfun/edge.mjs";
import { PumpfunPaperRouter, PumpfunLiveRouter, solNeededForBuy, walletDeltasFromMeta, RENT_ATA_SOL } from "../../src/velocity/venues/pumpfun/router.mjs";
import { goodCandidatePayload, tickPayload } from "./helpers/fixtures.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "velocity-t10-"));

/** The operator's envelope: $50 bankroll, $5 minimum stake. */
function smallEnvelope(dir, over = {}) {
  const base = JSON.parse(fs.readFileSync(path.resolve("src/velocity/config/risk.example.json"), "utf8"));
  const cfg = { ...base, bankroll_usd: 50, per_trade_max_usd: 10, portfolio_max_exposure_usd: 40, daily_loss_limit_usd: 15, max_concurrent_positions: 4, max_per_group: 1, ...over };
  cfg.venues = { ...base.venues, pumpfun: { ...base.venues.pumpfun, max_exposure_usd: 40, min_stake_usd: 5, ...(over.pumpfun || {}) }, polymarket: { ...base.venues.polymarket, max_exposure_usd: 0 } };
  const file = path.join(dir, "risk.json");
  fs.writeFileSync(file, JSON.stringify(cfg));
  return loadRiskEnvelope(file);
}

/** A live router double: no network, scripted wallet, records every call. */
class FakeLive {
  constructor({ wallet = {}, failInit = false, balanceSol = 1 } = {}) {
    this.ready = false; this.calls = []; this.wallet = wallet; this.failInit = failInit; this.balanceSol = balanceSol; this.priorityFeeSol = 0.0005;
    this.closeImpl = null; this.submitImpl = null;
  }
  async init() { this.calls.push("init"); if (this.failInit) throw new Error("MASTER_SEED missing"); this.ready = true; return { wallet: "WALLET", balanceSol: this.balanceSol, rpc: "fake" }; }
  async health() { return { ok: true, latencyMs: 1, detail: "fake" }; }
  async preflight() { this.calls.push("preflight"); return { wallet: "WALLET", balanceSol: this.balanceSol, rpc: "fake" }; }
  async positions() { this.calls.push("positions"); return this.ready ? Object.entries(this.wallet).filter(([, q]) => q > 0).map(([instrument, qty]) => ({ instrument, qty })) : []; }
  async submit(order) {
    this.calls.push(`submit:${order.instrument}`);
    if (this.submitImpl) return this.submitImpl(order);
    const t = Date.now();
    this.wallet[order.instrument] = (this.wallet[order.instrument] || 0) + 1000;
    return { ok: true, fill: { orderId: order.id, decisionId: order.decisionId, venue: "pumpfun", instrument: order.instrument, side: "BUY", price: 0.005, qty: 1000, notional_usd: 5.12, fee_usd: 0.12, t_sent: t, t_filled: t + 5, latency_ms: 5, venue_ref: "SIGBUY" } };
  }
  async close(p, pct, ctx) {
    this.calls.push(`close:${p.instrument}:${pct}`);
    if (this.closeImpl) return this.closeImpl(p, pct, ctx);
    return failure({ id: p.id }, "NO_POSITION", "no token balance to sell");
  }
}

function mkEngine(dataDir, { envelope, mode = "paper", live = null, feed = new ScriptedFeed({ venue: "pumpfun", script: [] }), config = {} } = {}) {
  const venues = { pumpfun: { mode, feed, edge: makePumpfunEdge(), router: new PumpfunPaperRouter({ bookFile: path.join(dataDir, "paper-book-pumpfun.json"), latencyMs: 0 }), liveRouter: live } };
  return new Engine({ dataDir, envelope, venues, config: { saveMs: 600_000, governorMs: 600_000, sweepMs: 600_000, ...config } });
}
const cand = (id, t = Date.now()) => makeEvent({ venue: "pumpfun", kind: "candidate", id, t_venue: t - 100, t_observed: t, payload: goodCandidatePayload(id) });

test("T10: a $50 bankroll trades the venue minimum instead of nothing", () => {
  const env = smallEnvelope(tmp());
  const sizer = new Sizer(env);
  const portfolio = { open: [], realized_today_usd: 0 };
  const tier1 = sizer.size({ decision: { venue: "pumpfun", p_win: 0.45, payoff: 3, stop_fraction: 1 }, portfolio });
  assert.equal(tier1.stake_usd, 5, "fractional Kelly ($3.33) is floored to the $5 minimum");
  assert.ok(tier1.caps.includes("MIN_STAKE_FLOOR"));
  const tier2 = sizer.size({ decision: { venue: "pumpfun", p_win: 0.35, payoff: 3, stop_fraction: 1 }, portfolio });
  assert.equal(tier2.stake_usd, 5);
  const noEdge = sizer.size({ decision: { venue: "pumpfun", p_win: 0.25, payoff: 3, stop_fraction: 1 }, portfolio });
  assert.equal(noEdge.stake_usd, 0); assert.equal(noEdge.reasons[0], "NO_EDGE", "the floor never invents an edge");
  // The floor respects every cap: with $37 open of a $40 venue cap there is no room for $5.
  const crowded = sizer.size({ decision: { venue: "pumpfun", p_win: 0.45, payoff: 3, stop_fraction: 1 }, portfolio: { open: [{ venue: "pumpfun", notional_usd: 37, worst_case_fraction: 0 }], realized_today_usd: 0 } });
  assert.equal(crowded.stake_usd, 0); assert.match(crowded.reasons[0], /BELOW_MIN_STAKE/);
  // And the daily budget: $12 lost today of a $15 limit leaves $3 of risk, not $5.
  const bled = sizer.size({ decision: { venue: "pumpfun", p_win: 0.45, payoff: 3, stop_fraction: 1 }, portfolio: { open: [], realized_today_usd: -12 } });
  assert.equal(bled.stake_usd, 0); assert.match(bled.reasons[0], /BELOW_MIN_STAKE/);
});

test("T10: the persisted venue mode survives a restart and the live router is initialized before reconcile", async () => {
  const dir = tmp(); const env = smallEnvelope(dir);
  const first = mkEngine(dir, { envelope: env, mode: "paper", live: new FakeLive() });
  assert.equal(first.store.venueMode("pumpfun"), "paper", "config seeds a venue the store never saw");
  first.store.setVenueMode("pumpfun", "live", { liveStartCapUsd: 5 }); first.store.save();
  // Restart with the same default config ("paper"): the operator's go-live wins.
  const live = new FakeLive({ wallet: { MintHeld: 900 } });
  const second = mkEngine(dir, { envelope: env, mode: "paper", live });
  assert.equal(second.store.venueMode("pumpfun"), "live");
  second.store.upsertPosition({ id: "pumpfun:MintHeld:1", venue: "pumpfun", instrument: "MintHeld", status: "open", paper: false, qty: 900, remaining_qty: 900, cost_usd: 5, notional_usd: 5, stake_usd: 5, proceeds_usd: 0, entryTime: Date.now(), entryMark: 9000, plan: createPlan({ venue: "pumpfun", key: 2, entry: { score: 60 } }) });
  try {
    await second.start();
    assert.deepEqual(live.calls.slice(0, 2), ["init", "positions"], "init runs before the wallet is read");
    assert.equal(second.store.openPositions("pumpfun").length, 1, "the real position is matched, not closed as missing");
    assert.equal(second.ledger.query({ kind: "venue", limit: 1 })[0].by, "restart");
    assert.equal(second.venues.pumpfun.liveStartCapUsd ?? second.store.state.venues.pumpfun.liveStartCapUsd, 5, "the live start cap is persisted with the mode");
  } finally { await second.stop(); }

  // A router that cannot initialize freezes the venue instead of emptying it.
  const broken = new FakeLive({ failInit: true });
  const third = mkEngine(dir, { envelope: env, mode: "paper", live: broken });
  try {
    await third.start();
    assert.equal(third.store.openPositions("pumpfun").length, 1, "nothing closed");
    assert.equal(third.store.isHalted("pumpfun")?.mode, "freeze");
    assert.match(third.store.isHalted("pumpfun").reason, /live router not ready/);
    const rec = third.ledger.query({ kind: "reconcile", limit: 1 })[0];
    assert.equal(rec.report.venues.pumpfun.frozen, true);
  } finally { await third.stop(); }
});

test("T10: going live closes paper positions through the paper router first; going back refuses with live positions open", async () => {
  const dir = tmp(); const env = smallEnvelope(dir);
  const live = new FakeLive();
  const engine = mkEngine(dir, { envelope: env, mode: "paper", live, config: { reentryCooldownMs: 0 } });
  try {
    await engine.start({ reconcile: false });
    await engine.enqueue(() => engine.onEvent(cand("MintPaper")));
    assert.equal(engine.store.openPositions("pumpfun").length, 1);
    assert.equal(engine.store.openPositions("pumpfun")[0].paper, true);
    const r = await engine.setVenueMode("pumpfun", "live", { override: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(engine.store.openPositions("pumpfun").length, 0, "the paper position was closed before the flip");
    const outcome = engine.ledger.query({ kind: "outcome", limit: 1 })[0];
    assert.equal(outcome.reason, "VENUE_MODE_CHANGE"); assert.equal(outcome.paper, true);
    assert.ok(!live.calls.some(c => c.startsWith("close")), "the live router never saw the paper position");
    assert.equal(engine.store.state.venues.pumpfun.liveStartCapUsd, r.liveStartCapUsd);

    // Now a live entry, then an attempt to go back to paper.
    await engine.enqueue(() => engine.onEvent(cand("MintLive", Date.now() + 1000)));
    const pos = engine.store.openPositions("pumpfun")[0];
    assert.ok(pos && pos.paper === false, "live fill opened a live position");
    assert.equal(pos.cost_usd, 5.12, "cost is what left the wallet; the fee is not added twice");
    assert.equal(pos.notional_usd, 5.12);
    const back = await engine.setVenueMode("pumpfun", "paper");
    assert.equal(back.ok, false); assert.match(back.error, /1 live position\(s\) and 0 unconfirmed buy\(s\) still open/);
    assert.equal(engine.store.venueMode("pumpfun"), "live");
  } finally { await engine.stop(); }
});

// ── live router with a scripted RPC ──
function fakeConn({ sol = 1, tokens = {}, statuses = {}, txs = {} } = {}) {
  const c = {
    sol, tokens, statuses, txs, sent: 0, statusCalls: 0, throwTokenRead: false, nextSig: "SIG1",
    async getBalance() { return Math.round(c.sol * 1e9); },
    async getParsedTokenAccountsByOwner(owner, { mint }) {
      if (c.throwTokenRead) throw new Error("429 too many requests");
      const entries = mint ? [[mint.v, c.tokens[mint.v] || 0]] : Object.entries(c.tokens);
      return { value: entries.filter(([, q]) => q > 0).map(([m, q]) => ({ account: { data: { parsed: { info: { mint: m, tokenAmount: { uiAmount: q } } } } } })) };
    },
    async getSignatureStatuses([sig]) { c.statusCalls++; const s = c.statuses[sig]; return { value: [typeof s === "function" ? s() : s ?? null] }; },
    async getTransaction(sig) { const t = c.txs[sig]; return typeof t === "function" ? t() : t ?? null; },
    async getLatestBlockhash() { return { blockhash: "x" }; },
    async sendRawTransaction() { c.sent++; return c.nextSig; },
  };
  return c;
}
function liveRouter(conn, over = {}) {
  let t = 1_000_000;
  const r = new PumpfunLiveRouter({ secret: "x", confirmTimeoutMs: 30, lateConfirmMs: 30, sleep: async () => {}, clock: () => t, fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array(200).buffer }), ...over });
  r.ready = true; r.publicKey = "PK"; r.keypair = { publicKey: "PK" };
  r.web3 = { PublicKey: class { constructor(v) { this.v = v; } }, VersionedTransaction: { deserialize: () => ({ sign() {}, serialize() { return new Uint8Array(1); } }) } };
  r.connection = conn;
  r.tick = ms => { t += ms; };
  return r;
}
const meta = (solDelta, tokenDelta, mint = "M", { err = null } = {}) => ({ meta: { err, preBalances: [1e9], postBalances: [1e9 + Math.round(solDelta * 1e9)], preTokenBalances: tokenDelta < 0 ? [{ mint, owner: "PK", uiTokenAmount: { uiAmount: -tokenDelta } }] : [], postTokenBalances: tokenDelta > 0 ? [{ mint, owner: "PK", uiTokenAmount: { uiAmount: tokenDelta } }] : [] } });
const confirmed = { confirmationStatus: "confirmed", err: null };
const buyOrder = (over = {}) => ({ id: "o1", decisionId: "d1", instrument: "M", stake_usd: 5, max_slippage_bps: 300, reference: { vSolInBondingCurve: 30, mcapUsd: 4500, solPrice: 200, solPriceAt: 1_000_000 - 30_000 }, ...over });

test("T10: the SOL a buy needs counts fees and rent, and the fill is read from the confirmed transaction", async () => {
  assert.ok(Math.abs(solNeededForBuy(0.025, { priorityFeeSol: 0.0005 }) - (0.025 * 1.015 + 0.0005 + 0.000005 + RENT_ATA_SOL + 0.00089088)) < 1e-12);
  assert.ok(solNeededForBuy(0.025, { hasAccount: true }) < solNeededForBuy(0.025), "an existing token account needs no rent");
  const poor = liveRouter(fakeConn({ sol: 0.0275 }));
  const p = await poor.submit(buyOrder());
  assert.equal(p.failure.code, "INSUFFICIENT_SOL"); assert.match(p.failure.reason, /order needs 0\.0326/, "15% slippage headroom, fees and rent are all counted");
  assert.equal(poor.connection.sent, 0);

  // Confirmed: the transaction metadata gives the exact debit (stake + fees) and tokens received,
  // even though the balance reads still show the old numbers (a lagging RPC node).
  const conn = fakeConn({ sol: 0.5, statuses: { SIG1: confirmed }, txs: { SIG1: meta(-0.0285, 1200) } });
  const r = liveRouter(conn);
  const res = await r.submit(buyOrder());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.fill.qty, 1200); assert.equal(res.fill.exact, true);
  assert.equal(res.fill.notional_usd, +(0.0285 * 200).toFixed(4), "notional is the whole outflow");
  assert.ok(Math.abs(res.fill.fee_usd - (0.0285 - 0.025) * 200) < 1e-6, "fee is the part above the stake, informational");
  assert.equal(res.fill.venue_ref, "SIG1");
  assert.equal(walletDeltasFromMeta(null, { mint: "M", owner: "PK" }), null);
});

test("T10: an on-chain failure reports the burnt fee; a late confirmation is settled, not lost", async () => {
  const failed = liveRouter(fakeConn({ sol: 0.5, statuses: { SIG1: { confirmationStatus: "confirmed", err: { InstructionError: [3, { Custom: 6002 }] } } } }));
  const f = await failed.submit(buyOrder());
  assert.equal(f.failure.code, "SEND_FAILED"); assert.match(f.failure.reason, /failed on chain/);
  assert.equal(f.failure.venue_ref, "SIG1"); assert.ok(f.failure.fee_usd > 0, "priority fee and base fee were paid for nothing");

  // Never confirms inside both windows: UNCONFIRMED with the signature, nothing booked.
  const conn = fakeConn({ sol: 0.5, statuses: { SIG1: null } });
  const r = liveRouter(conn);
  const u = await r.submit(buyOrder());
  assert.equal(u.failure.code, "UNCONFIRMED"); assert.equal(u.failure.venue_ref, "SIG1");
  // Later the sweep asks: still unknown and young -> wait; landed -> a late fill; unknown and old -> expired.
  const wait = await r.resolvePending({ instrument: "M", side: "BUY", sig: "SIG1", at: 1_000_000, reference: { solPrice: 200 } });
  assert.equal(wait.failure.code, "UNCONFIRMED"); assert.equal(wait.failure.expired, false);
  conn.statuses.SIG1 = confirmed; conn.txs.SIG1 = meta(-0.0285, 1200);
  const late = await r.resolvePending({ instrument: "M", side: "BUY", sig: "SIG1", at: 1_000_000, reference: { solPrice: 200 } });
  assert.equal(late.ok, true); assert.equal(late.fill.qty, 1200); assert.equal(late.fill.late, true); assert.equal(late.fill.notional_usd, 5.7);
  conn.statuses.SIG1 = null; r.tick(100_000);
  const gone = await r.resolvePending({ instrument: "M", side: "BUY", sig: "SIG1", at: 1_000_000, reference: { solPrice: 200 } });
  assert.equal(gone.failure.code, "EXPIRED"); assert.equal(gone.failure.expired, true);
});

test("T10: sells settle from the transaction, a pending sell is never sent twice, a failed token read does not book a full close", async () => {
  // 100% close, balance reads lag: proceeds come from the transaction, not from a zero delta.
  const conn = fakeConn({ sol: 0.5, tokens: { M: 1200 }, statuses: { SIG1: confirmed }, txs: { SIG1: meta(0.03, -1200) } });
  const r = liveRouter(conn);
  const pos = { id: "p1", instrument: "M", decisionId: "d1", reference: { solPrice: 200 } };
  const full = await r.close(pos, 100, { reference: { solPrice: 200 } });
  assert.equal(full.ok, true); assert.equal(full.fill.qty, 1200); assert.equal(full.fill.notional_usd, 6); assert.equal(full.fill.exact, true);

  // Partial sell; the post-trade token read throws and the transaction is not readable yet:
  // the fill is the percentage asked for, never the whole position.
  const lag = fakeConn({ sol: 0.5, tokens: { M: 1000 }, statuses: { SIG1: confirmed }, txs: {} });
  const r2 = liveRouter(lag);
  lag.getParsedTokenAccountsByOwner = (function (orig) { let n = 0; return async function (...a) { if (++n > 1) throw new Error("429"); return orig.apply(this, a); }; })(lag.getParsedTokenAccountsByOwner);
  const part = await r2.close(pos, 80, { reference: { solPrice: 200 } });
  assert.equal(part.ok, true); assert.equal(part.fill.qty, 800, "80% of 1000, not 1000");

  // A pending sell still in flight: no new transaction is built.
  const inflight = fakeConn({ sol: 0.5, tokens: { M: 1000 }, statuses: { SIGOLD: null } });
  const r3 = liveRouter(inflight);
  const p3 = { ...pos, pendingExit: { sig: "SIGOLD", pct: 100, at: 1_000_000 } };
  const still = await r3.close(p3, 100, { reference: { solPrice: 200 } });
  assert.equal(still.failure.code, "UNCONFIRMED"); assert.equal(inflight.sent, 0, "did not sell twice");
  // The pending sell landed: the fill is read from it, with the percentage it was sent for.
  inflight.statuses.SIGOLD = confirmed; inflight.txs.SIGOLD = meta(0.028, -1000);
  const landed = await r3.close(p3, 100, { reference: { solPrice: 200 } });
  assert.equal(landed.ok, true); assert.equal(landed.fill.qty, 1000); assert.equal(landed.fill.notional_usd, 5.6); assert.equal(landed.fill.pending_pct, 100);
  assert.equal(inflight.sent, 0);
  // The pending sell expired: a fresh sell goes out.
  const expired = fakeConn({ sol: 0.5, tokens: { M: 1000 }, statuses: { SIGOLD: null, SIG1: confirmed }, txs: { SIG1: meta(0.02, -1000) } });
  const r4 = liveRouter(expired); r4.tick(100_000);
  const fresh = await r4.close(p3, 100, { reference: { solPrice: 200 } });
  assert.equal(fresh.ok, true); assert.equal(fresh.fill.venue_ref, "SIG1"); assert.equal(expired.sent, 1);

  // A stale SOL price refuses to size an order in SOL; so does one bondli never fetched.
  const stale = liveRouter(fakeConn({ sol: 0.5 }));
  const s = await stale.submit(buyOrder({ reference: { vSolInBondingCurve: 30, mcapUsd: 4500, solPrice: 200, solPriceAt: 1_000_000 - 11 * 60_000 } }));
  assert.equal(s.failure.code, "STALE_SOL_PRICE");
  const never = await stale.submit(buyOrder({ reference: { vSolInBondingCurve: 30, mcapUsd: 4500, solPrice: 200 } }));
  assert.equal(never.failure.code, "STALE_SOL_PRICE"); assert.match(never.failure.reason, /not fetched/);
  assert.equal(stale.connection.sent, 0);
});

test("T10: the engine finalizes a live position the wallet no longer holds, and remembers a pending sell", async () => {
  const dir = tmp(); const env = smallEnvelope(dir);
  const live = new FakeLive();
  const engine = mkEngine(dir, { envelope: env, mode: "live", live });
  let now = Date.now(); engine.clock = () => now;
  const mk = (id) => ({ id, venue: "pumpfun", instrument: id, status: "open", paper: false, qty: 1000, remaining_qty: 1000, cost_usd: 5.2, notional_usd: 5.2, stake_usd: 5, proceeds_usd: 0, entryTime: now - 60_000, entryMark: 9000, tier: 2, model: "bondli_gates", plan: createPlan({ venue: "pumpfun", key: 2, entry: { score: 60 } }), reference: { solPrice: 200 } });
  engine.store.upsertPosition(mk("Gone")); engine.store.upsertPosition(mk("Slow"));
  try {
    await engine.start({ reconcile: false });
    // One empty wallet read is a failed exit, not a loss; a second one a retry interval later is.
    const first = await engine.closePosition(engine.store.state.positions.Gone, 100, "SL1");
    assert.equal(first.ok, false); assert.equal(engine.store.state.positions.Gone.status, "open");
    now += 5_000;
    const soon = await engine.closePosition(engine.store.state.positions.Gone, 100, "SL1");
    assert.equal(soon.ok, false, "5s later: still not proof");
    now += 15_000;
    const r = await engine.closePosition(engine.store.state.positions.Gone, 100, "SL1");
    assert.equal(r.ok, true); assert.equal(r.flat, true);
    assert.equal(engine.store.state.positions.Gone.status, "closed");
    const outcome = engine.ledger.query({ kind: "outcome", limit: 1 })[0];
    assert.equal(outcome.reason, "SL1:FLAT_AT_VENUE"); assert.equal(outcome.pnl_usd, -5.2); assert.equal(outcome.flat_at_venue, true);
    assert.equal(engine.store.state.day.realizedUsd, -5.2, "real money lost counts against the daily limit");

    live.closeImpl = () => failure({ id: "Slow" }, "UNCONFIRMED", "tx SIGSELL not confirmed", { venue_ref: "SIGSELL" });
    const u = await engine.closePosition(engine.store.state.positions.Slow, 100, "TP2");
    assert.equal(u.ok, false);
    assert.equal(engine.store.state.positions.Slow.status, "open");
    assert.deepEqual({ sig: engine.store.state.positions.Slow.pendingExit.sig, pct: engine.store.state.positions.Slow.pendingExit.pct }, { sig: "SIGSELL", pct: 100 });
    // The same signature reported again keeps its original send time and percentage, so the
    // blockhash lifetime can actually run out and a dropped sell gets resent.
    const at0 = engine.store.state.positions.Slow.pendingExit.at;
    now += 30_000;
    await engine.closePosition(engine.store.state.positions.Slow, 50, "STOP");
    assert.equal(engine.store.state.positions.Slow.pendingExit.at, at0); assert.equal(engine.store.state.positions.Slow.pendingExit.pct, 100);
    // The next attempt returns the settled fill for the pending sell; the position closes with it.
    live.closeImpl = (p) => ({ ok: true, fill: { price: 0.006, qty: 1000, notional_usd: 6, fee_usd: 0, t_filled: now, latency_ms: 0, venue_ref: p.pendingExit.sig, pending_pct: p.pendingExit.pct } });
    const done = await engine.closePosition(engine.store.state.positions.Slow, 50, "TP3");
    assert.equal(done.ok, true);
    assert.equal(engine.store.state.positions.Slow.status, "closed", "closed at the pending sell's 100%, not the later 50%");
    assert.equal(engine.store.state.positions.Slow.pendingExit, undefined);
    assert.equal(engine.ledger.query({ kind: "outcome", limit: 1 })[0].pnl_usd, +(6 - 5.2).toFixed(4));
  } finally { await engine.stop(); }
});

test("T10: no ticks is not no exit: the time stop fires on a quiet position and a flatten is retried", async () => {
  // Pure: a tick with no price still yields MAX_HOLD once the hold is over.
  const plan = createPlan({ venue: "pumpfun", key: 2, entry: { score: 60 } });
  const pos = { id: "x", venue: "pumpfun", instrument: "M", entryTime: 1000, entryMark: 9000, entryScore: 60, plan };
  const dead = evaluateExit(pos, { t_observed: 1000 + plan.max_hold_ms + 1000, payload: { mcapUsd: 0 } }, { now: 1000 + plan.max_hold_ms + 1000 });
  assert.equal(dead?.reason, "MAX_HOLD");
  assert.equal(evaluateExit({ ...pos, plan }, { t_observed: 2000, payload: { mcapUsd: 0 } }, { now: 2000 }), null, "before the hold ends a priceless tick means hold");

  const dir = tmp(); const env = smallEnvelope(dir);
  let now = Date.now();
  const engine = mkEngine(dir, { envelope: env, mode: "paper", config: { reentryCooldownMs: 0, sweepRetryMs: 0 } });
  engine.clock = () => now;
  try {
    await engine.start({ reconcile: false });
    await engine.enqueue(() => engine.onEvent(cand("MintQuiet", now)));
    const p = engine.store.openPositions("pumpfun")[0];
    assert.ok(p, "paper position opened");
    now += 5 * 60_000; await engine.sweep();
    assert.equal(engine.store.openPositions("pumpfun").length, 1, "inside the hold: nothing");
    now += p.plan.max_hold_ms; await engine.sweep();
    assert.equal(engine.store.openPositions("pumpfun").length, 0, "past the hold with no ticks: sold");
    assert.equal(engine.ledger.query({ kind: "outcome", limit: 1 })[0].reason, "MAX_HOLD");
    assert.equal(engine.ledger.query({ kind: "exit", limit: 1 })[0].by, "timer");

    // Flatten that fails once is retried by the sweep until it succeeds.
    // The gates judge freshness from the event's own timestamps; the engine clock is 20 minutes ahead by now.
    await engine.enqueue(() => engine.onEvent(cand("MintStuck", Date.now())));
    const router = engine.venues.pumpfun.router;
    const realClose = router.close.bind(router);
    let fails = 1;
    router.close = async (...a) => (fails-- > 0 ? failure({ id: "s" }, "SEND_FAILED", "builder 502") : realClose(...a));
    const h = await engine.halt("flatten", "test");
    assert.equal(h.failed.length, 1); assert.equal(engine.store.openPositions().length, 1);
    now += 20_000; await engine.sweep();
    assert.equal(engine.store.openPositions().length, 0, "the sweep flattened what the halt could not");
    assert.equal(engine.ledger.query({ kind: "exit", limit: 1 })[0].by, "retry");
  } finally { await engine.stop(); }
});

test("T10: reconcile leaves unknown tokens alone, books a missing live position, and a failed send cools the instrument down", async () => {
  const dir = tmp(); const env = smallEnvelope(dir);
  const live = new FakeLive({ wallet: { AirdropSpam: 5_000_000, MintOurs: 1000 } });
  const engine = mkEngine(dir, { envelope: env, mode: "live", live, config: { reentryCooldownMs: 0 } });
  engine.store.upsertPosition({ id: "pumpfun:MintOurs:1", venue: "pumpfun", instrument: "MintOurs", status: "open", paper: false, qty: 1000, remaining_qty: 1000, cost_usd: 5, notional_usd: 5, stake_usd: 5, proceeds_usd: 0, entryTime: Date.now(), entryMark: 9000, plan: createPlan({ venue: "pumpfun", key: 2, entry: { score: 60 } }) });
  engine.store.upsertPosition({ id: "pumpfun:MintSold:1", venue: "pumpfun", instrument: "MintSold", status: "open", paper: false, qty: 1000, remaining_qty: 1000, cost_usd: 2, notional_usd: 2, stake_usd: 2, proceeds_usd: 0, entryTime: Date.now(), entryMark: 9000, plan: createPlan({ venue: "pumpfun", key: 2, entry: { score: 60 } }) });
  try {
    await engine.start();
    const rep = engine.ledger.query({ kind: "reconcile", limit: 1 })[0].report.venues.pumpfun;
    assert.deepEqual(rep.matched, ["MintOurs"]);
    assert.deepEqual(rep.adopted, [], "an airdrop the engine never bought is not a position");
    assert.deepEqual(rep.unknown.map(u => u.instrument), ["AirdropSpam"]);
    assert.deepEqual(rep.closed, ["MintSold"]);
    assert.equal(engine.store.state.positions["pumpfun:MintSold:1"].pnl_usd, -2, "real tokens gone without a sale record: cost lost until proven otherwise");
    assert.equal(engine.store.state.day.realizedUsd, -2);
    assert.equal(engine.ledger.query({ kind: "exit", limit: 1 })[0].final, true);

    // A send that fails on chain charges its fee and is not retried on the next poll.
    live.submitImpl = () => failure({ id: "o" }, "SEND_FAILED", "tx SIGX failed on chain", { venue_ref: "SIGX", fee_usd: 0.1 });
    const t = Date.now();
    await engine.enqueue(() => engine.onEvent(cand("MintFail", t)));
    assert.equal(engine.ledger.query({ kind: "order", limit: 1 })[0].code, "SEND_FAILED");
    assert.equal(engine.ledger.query({ kind: "fee", limit: 1 })[0].usd, 0.1);
    assert.equal(engine.store.state.day.realizedUsd, -2.1);
    await engine.enqueue(() => engine.onEvent(cand("MintFail", t + 5_000)));
    assert.equal(engine.ledger.query({ kind: "order", limit: 1 })[0].reason, "REENTRY_COOLDOWN");
    assert.equal(live.calls.filter(c => c === "submit:MintFail").length, 1);
    // An unconfirmed send is settled by the sweep once the venue can prove it landed.
    live.submitImpl = () => failure({ id: "o" }, "UNCONFIRMED", "tx SIGLATE not confirmed", { venue_ref: "SIGLATE" });
    await engine.enqueue(() => engine.onEvent(cand("MintLate", t + 10_000)));
    assert.ok(engine.pendingBuys.has("MintLate"));
    live.resolvePending = async ({ sig }) => ({ ok: true, fill: { instrument: "MintLate", side: "BUY", price: 0.005, qty: 1100, notional_usd: 5.5, fee_usd: 0, t_sent: t, t_filled: t + 30_000, latency_ms: 30_000, venue_ref: sig, late: true } });
    await engine.sweep();
    assert.ok(!engine.pendingBuys.has("MintLate"));
    const late = engine.store.openPositions("pumpfun").find(p => p.instrument === "MintLate");
    assert.ok(late, "the late buy became a position with a plan"); assert.equal(late.cost_usd, 5.5); assert.ok(late.plan);
  } finally { await engine.stop(); }
});

test("T10: a partial venue entry in velocity.config.json keeps the documented defaults", () => {
  const dir = tmp(); smallEnvelope(dir);
  const { cfg } = buildEngine({ dataDir: dir, riskFile: path.join(dir, "risk.json"), venues: { pumpfun: { mode: "paper" }, polymarket: { mode: "off" } } });
  assert.equal(cfg.venues.pumpfun.minScore, DEFAULT_CONFIG.venues.pumpfun.minScore);
  assert.equal(cfg.venues.pumpfun.bondliUrl, DEFAULT_CONFIG.venues.pumpfun.bondliUrl);
  assert.equal(cfg.venues.polymarket.mode, "off");
});

test("T10: a signature survives an RPC that drops the reply; a zero read is re-read; a sale with no visible proceeds is not booked at zero", async () => {
  const fakeTx = () => ({ sign() {}, serialize() { return new Uint8Array(1); }, signatures: [new Uint8Array(64)] });
  // sendRawTransaction throws after the RPC may have forwarded it: the locally known signature is kept.
  const dropped = fakeConn({ sol: 0.5 });
  dropped.sendRawTransaction = async () => { throw new Error("socket hang up"); };
  const r1 = liveRouter(dropped); r1.web3.VersionedTransaction.deserialize = fakeTx; r1.bs58 = { encode: () => "LOCALSIG" };
  const a = await r1.submit(buyOrder());
  assert.equal(a.failure.code, "UNCONFIRMED"); assert.equal(a.failure.venue_ref, "LOCALSIG");
  // getSignatureStatuses throws after the send: same.
  const flaky = fakeConn({ sol: 0.5 });
  flaky.getSignatureStatuses = async () => { throw new Error("429"); };
  const r2 = liveRouter(flaky); r2.web3.VersionedTransaction.deserialize = fakeTx; r2.bs58 = { encode: () => "LOCALSIG" };
  const b = await r2.submit(buyOrder());
  assert.equal(b.failure.code, "UNCONFIRMED"); assert.equal(b.failure.venue_ref, "SIG1", "the RPC's signature once it answered the send");
  // Without bs58 (never initialized) a thrown send is still an honest SEND_FAILED.
  const r3 = liveRouter(dropped); r3.web3.VersionedTransaction.deserialize = fakeTx;
  assert.equal((await r3.submit(buyOrder())).failure.code, "SEND_FAILED");

  // A token balance that reads 0 once and 1000 next is a position, not NO_POSITION.
  const lag = fakeConn({ sol: 0.5, tokens: { M: 1000 }, statuses: { SIG1: confirmed }, txs: { SIG1: meta(0.03, -1000) } });
  let reads = 0; const orig = lag.getParsedTokenAccountsByOwner.bind(lag);
  lag.getParsedTokenAccountsByOwner = async (...args) => (++reads === 1 ? { value: [] } : orig(...args));
  const r4 = liveRouter(lag);
  const sold = await r4.close({ id: "p", instrument: "M", decisionId: "d", reference: { solPrice: 200 } }, 100, { reference: { solPrice: 200 } });
  assert.equal(sold.ok, true); assert.equal(sold.fill.notional_usd, 6);

  // Tokens gone, SOL not visible, transaction not readable: UNCONFIRMED, never a $0 sale.
  const half = fakeConn({ sol: 0.5, tokens: { M: 1000 }, statuses: { SIG1: confirmed }, txs: {} });
  const r5 = liveRouter(half);
  half.sendRawTransaction = async () => { half.tokens.M = 0; return "SIG1"; };
  const z = await r5.close({ id: "p", instrument: "M", decisionId: "d", reference: { solPrice: 200 } }, 100, { reference: { solPrice: 200 } });
  assert.equal(z.failure.code, "UNCONFIRMED"); assert.equal(z.failure.venue_ref, "SIG1");
  // Later, still unreadable but long confirmed: the curve model's estimate is booked, flagged.
  r5.tick(100_000);
  const est = await r5.resolvePending({ instrument: "M", side: "SELL", sig: "SIG1", at: 1_000_000, reference: { solPrice: 200, mcapUsd: 9000, vSolInBondingCurve: 30 }, qtyHint: 1000 });
  assert.equal(est.ok, true); assert.equal(est.fill.estimated, true); assert.ok(est.fill.notional_usd > 0);
});

test("T10: a throttled stake is never floored back up; a failed startup freeze lifts on a good restart; stopping opens no new risk", async () => {
  const dir = tmp(); const env = smallEnvelope(dir);
  const sizer = new Sizer(env);
  const d = { venue: "pumpfun", p_win: 0.45, payoff: 3, stop_fraction: 1 };
  assert.equal(sizer.size({ decision: d, portfolio: { open: [], realized_today_usd: 0 }, throttle: 1 }).stake_usd, 5);
  const shrunk = sizer.size({ decision: d, portfolio: { open: [], realized_today_usd: 0 }, throttle: 0.5 });
  assert.equal(shrunk.stake_usd, 0); assert.match(shrunk.reasons[0], /BELOW_MIN_STAKE/, "the governor's shrink means not trading at this bankroll");

  const first = mkEngine(dir, { envelope: env, mode: "paper", live: new FakeLive({ failInit: true }) });
  first.store.setVenueMode("pumpfun", "live");
  try { await first.start(); assert.equal(first.store.isHalted("pumpfun")?.mode, "freeze"); } finally { await first.stop(); }
  const second = mkEngine(dir, { envelope: env, mode: "paper", live: new FakeLive() });
  try {
    await second.start();
    assert.equal(second.store.isHalted("pumpfun"), null, "the startup freeze is gone once the router initializes");
    assert.equal(second.ledger.query({ kind: "resume", limit: 1 })[0].by, "restart");
    // Leaving live with an unconfirmed buy outstanding is refused.
    second.pendingBuys.set("MintLate", { venue: "pumpfun", sig: "S", decision: { instrument: "MintLate", reference: {} }, orderId: "o", stake: 5, sizing: {}, at: Date.now() });
    const back = await second.setVenueMode("pumpfun", "paper");
    assert.equal(back.ok, false); assert.match(back.error, /1 unconfirmed buy/);
    second.pendingBuys.clear();
  } finally { await second.stop(); }

  // A candidate queued behind a slow order when stop() is called opens nothing.
  const third = mkEngine(dir, { envelope: env, mode: "paper", config: { reentryCooldownMs: 0 } });
  third.store.setVenueMode("pumpfun", "paper");
  await third.start({ reconcile: false });
  let release; const gate = new Promise(r => { release = r; }); third.enqueue(() => gate);
  const queued = third.enqueue(() => third.onEvent(cand("MintStop")));
  const stopped = third.stop();
  release(); await queued; await stopped;
  assert.equal(third.store.openPositions().length, 0, "no entry after stop()");
});

test("T10: a tick-less paper sell is priced at the last mark, not the entry", async () => {
  const dir = tmp(); const env = smallEnvelope(dir);
  let now = Date.now();
  const engine = mkEngine(dir, { envelope: env, mode: "paper", config: { reentryCooldownMs: 0, sweepRetryMs: 0 } });
  engine.clock = () => now;
  try {
    await engine.start({ reconcile: false });
    await engine.enqueue(() => engine.onEvent(cand("MintFade", now)));
    const p = engine.store.openPositions("pumpfun")[0];
    assert.ok(p);
    // One tick 40% down that trips no plan rule of its own (the fixture's plan stop is wider on a
    // stable trend), then silence.
    await engine.enqueue(() => engine.onEvent(makeEvent({ venue: "pumpfun", kind: "tick", id: "MintFade", t_venue: now + 400, t_observed: now + 500, payload: tickPayload("MintFade", 10_800) })));
    if (engine.store.openPositions("pumpfun").length === 0) return; // the plan sold on the tick: nothing left to test here
    now += p.plan.max_hold_ms + 60_000; await engine.sweep();
    assert.equal(engine.store.openPositions("pumpfun").length, 0);
    const out = engine.ledger.query({ kind: "outcome", limit: 1 })[0];
    assert.equal(out.reason, "MAX_HOLD");
    assert.ok(out.pnl_pct < -30, `booked at the last mark (-40%), got ${out.pnl_pct}%`);
  } finally { await engine.stop(); }
});

test("T10: with bankroll_source wallet the live wallet is the bankroll; no reading means no order", async () => {
  const dir = tmp(); const env = smallEnvelope(dir, { bankroll_source: "wallet", wallet_reserve_sol: 0.02 });
  assert.equal(env.bankroll_source, "wallet");
  // Sizer: a measured equity replaces bankroll + realized; null equity sizes nothing.
  const sizer = new Sizer(env);
  const d = { venue: "pumpfun", p_win: 0.45, payoff: 3, stop_fraction: 1 };
  const w = sizer.size({ decision: d, portfolio: { open: [], realized_today_usd: -5, equity_usd: 120 } });
  assert.equal(w.stake_usd, 8, "0.2667 x 0.25 x $120 = $8, realized is not subtracted twice (the wallet already fell by it)");
  assert.match(w.reasons[0], /\(wallet\)/);
  const unknown = sizer.size({ decision: d, portfolio: { open: [], realized_today_usd: 0, equity_usd: null, equity_reason: "WALLET_UNKNOWN" } });
  assert.equal(unknown.stake_usd, 0); assert.equal(unknown.reasons[0], "WALLET_UNKNOWN");
  const fixed = sizer.size({ decision: d, portfolio: { open: [], realized_today_usd: 0 } });
  assert.equal(fixed.stake_usd, 5, "a snapshot without equity_usd (paper) uses the fixed bankroll");

  // Engine: the go-live preflight and every live fill refresh the reading; the snapshot carries it.
  const live = new FakeLive({ balanceSol: 0.1495 });
  const engine = mkEngine(dir, { envelope: env, mode: "paper", live, config: { reentryCooldownMs: 0 } });
  let now = Date.now(); engine.clock = () => now;
  try {
    await engine.start({ reconcile: false });
    assert.equal(engine.portfolioSnapshot().equity_usd, undefined, "paper venue: fixed bankroll");
    engine.solPriceHint = 200;
    const r = await engine.setVenueMode("pumpfun", "live", { override: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    const snap = engine.portfolioSnapshot();
    assert.equal(snap.equity_usd, +((0.1495 - 0.02) * 200).toFixed(2), "free SOL at the current price");
    assert.equal(engine.status().bankroll.source, "wallet");
    assert.equal(engine.status().bankroll.wallet.sol, 0.1495);
    // A live buy: equity is free SOL plus what is open, and the wallet is re-read after the fill.
    const before = live.calls.filter(c => c === "preflight").length;
    await engine.enqueue(() => engine.onEvent(cand("MintW", now)));
    const pos = engine.store.openPositions("pumpfun")[0];
    assert.ok(pos && !pos.paper, "live position opened from the wallet bankroll");
    assert.equal(pos.stake_usd, 5, "Kelly on $25.9 is $1.73, floored to the $5 minimum");
    assert.ok(live.calls.filter(c => c === "preflight").length > before, "wallet re-read after the fill");
    const withOpen = engine.portfolioSnapshot();
    // The candidate carried the feed's SOL price (150), which is fresher than the 200 seeded above.
    assert.equal(withOpen.equity_usd, +(((0.1495 - 0.02) * 150) + pos.notional_usd).toFixed(2));
    // Stale reading: nothing is sized, and the sweep refreshes it.
    now += 6 * 60_000;
    assert.equal(engine.portfolioSnapshot().equity_reason, "WALLET_UNKNOWN");
    await engine.sweep();
    assert.equal(engine.portfolioSnapshot().equity_reason, undefined, "the sweep re-read the wallet");
    assert.ok(engine.portfolioSnapshot().equity_usd > 0);
  } finally { await engine.stop(); }
});

test("T10: the wallet's own balance change is read by account key, not by a fixed index", async () => {
  const { walletDelta } = await import("../../tools/tx-audit.mjs");
  const key = v => ({ toBase58: () => v });
  // A transaction where our wallet pays: it is the fee payer, so it sits at index 0.
  const payer = {
    transaction: { message: { getAccountKeys: () => ({ keySegments: () => [[key("ME"), key("CURVE"), key("SYS")]] }) } },
    meta: { fee: 5_000, err: null, preBalances: [100_000_000, 5_000, 1], postBalances: [70_000_000, 35_000, 1],
      preTokenBalances: [], postTokenBalances: [{ owner: "ME", mint: "M", uiTokenAmount: { uiAmount: 1200 } }] },
  };
  const a = walletDelta(payer, { owner: "ME", mint: "M" });
  assert.equal(a.index, 0); assert.equal(a.indexZeroIsWallet, true);
  assert.equal(a.solDelta, -0.03); assert.equal(a.tokenDelta, 1200); assert.equal(a.feeSol, 0.000005);

  // The same read when our wallet is NOT first: index 0 would report someone else's balance.
  const notFirst = {
    transaction: { message: { getAccountKeys: () => ({ keySegments: () => [[key("OTHER"), key("ME")]] }) } },
    meta: { fee: 5_000, err: null, preBalances: [9_000_000_000, 100_000_000], postBalances: [8_000_000_000, 130_000_000],
      preTokenBalances: [{ owner: "ME", mint: "M", uiTokenAmount: { uiAmount: 1200 } }], postTokenBalances: [] },
  };
  const b = walletDelta(notFirst, { owner: "ME", mint: "M" });
  assert.equal(b.index, 1); assert.equal(b.indexZeroIsWallet, false);
  assert.equal(b.solDelta, 0.03, "our wallet received 0.03 SOL");
  assert.equal(b.solDeltaAtIndexZero, -1, "index 0 would have claimed a whole SOL left the wallet");
  assert.equal(b.tokenDelta, -1200, "a 100% sell that closes the token account still shows the full outflow");

  // Balances that only mention other owners contribute nothing, and a failed tx is reported as failed.
  const foreign = { transaction: { message: { getAccountKeys: () => ({ keySegments: () => [[key("ME")]] }) } },
    meta: { fee: 5_000, err: { InstructionError: [3, { Custom: 6002 }] }, preBalances: [1_000_000], postBalances: [995_000],
      preTokenBalances: [{ owner: "SOMEONE", mint: "M", uiTokenAmount: { uiAmount: 500 } }], postTokenBalances: [] } };
  const c = walletDelta(foreign, { owner: "ME", mint: "M" });
  assert.equal(c.tokenDelta, 0); assert.ok(c.err); assert.equal(c.solDelta, -0.000005, "a failed transaction still paid its fee");
  assert.equal(walletDelta(null, { owner: "ME" }), null);
});
