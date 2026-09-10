// ═══ VELOCITY — Engine wiring ═══
// feed -> pipeline (DP2) -> sizer (DP3) -> router (DP4) -> position with plan (DP5)
// ticks -> exits (DP5) -> router -> outcome -> governor (DP7)
// Every stage writes to the ledger (DP6) before the next stage runs.
// Events are processed one at a time so two candidates for the same
// instrument cannot both enter, and a crash leaves a single clean stage.

import path from "node:path";
import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { Ledger } from "./ledger.mjs";
import { Store } from "./store.mjs";
import { GateRunner } from "./pipeline.mjs";
import { Sizer } from "./risk.mjs";
import { createPlan, evaluateExit, markPosition } from "./exits.mjs";
import { Governor } from "./governor.mjs";
import { WeightStore, checksumFiles, verifyChecksums, retrain } from "./learner.mjs";
import { LatencyHistogram } from "./events.mjs";
import { statsFromOutcomes } from "./stats.mjs";
import { promotionGate } from "./promote.mjs";

export class Engine extends EventEmitter {
  constructor({ dataDir, envelope, venues = {}, clock = () => Date.now(), config = {}, alerter = null }) {
    super();
    this.dataDir = dataDir;
    this.env = envelope;
    this.clock = clock;
    this.cfg = { governorMs: 5_000, saveMs: 5_000, reentryCooldownMs: 5 * 60_000, retrainEvery: 50, disqualifyMs: 5 * 60_000, ...config };
    this.ledger = new Ledger(path.join(dataDir, "ledger.jsonl"), { now: clock });
    this.store = new Store(path.join(dataDir, "state.json"), { now: clock });
    this.weights = new WeightStore(path.join(dataDir, "weights"));
    this.governor = new Governor({ ledger: this.ledger, envelope, clock });
    this.sizer = new Sizer(envelope);
    this.alerter = alerter;
    this.venues = {};
    for (const [venue, v] of Object.entries(venues)) {
      this.venues[venue] = { ...v, runner: v.edge ? new GateRunner({ venue, edge: v.edge }) : null };
      if (v.mode) this.store.setVenueMode(venue, v.mode);
    }
    this.latency = {};
    for (const venue of Object.keys(this.venues)) this.latency[venue] = { decide: new LatencyHistogram(10_000, 1), send: new LatencyHistogram(), confirm: new LatencyHistogram() };
    this.blocked = {};          // venue -> reason from the supervisor (feed stale, router down)
    this.inflight = new Set();  // instruments with an order in flight
    this.cooldown = new Map();  // instrument -> until
    this.disqualified = new Map(); // instrument -> until; a fatal gate-1 reject is not re-judged every poll
    this.stats = statsFromOutcomes(this.ledger.query({ kind: "outcome", limit: 5000 }));
    this.checksums = checksumFiles();
    this.verdict = { throttle: 1, halt: false, reasons: [] };
    this.running = false;
    this._queue = Promise.resolve();
    this._timers = [];
    this._outcomesSinceRetrain = 0;
    this._lastGovernorKey = null;
  }

  // ── lifecycle ──
  async start({ reconcile = true } = {}) {
    this.running = true;
    this.store.state.startedAt = this.clock();
    this.store.rollDay();
    if (reconcile) await this.reconcile();
    this.evaluateGovernor();
    for (const [venue, v] of Object.entries(this.venues)) {
      if (this.store.venueMode(venue) === "off" || !v.feed) continue;
      v.feed.on("event", e => this.enqueue(() => this.onEvent(e)));
      for (const p of this.store.openPositions(venue)) v.feed.watch(p.instrument);
      await v.feed.start();
    }
    // unref: the control server keeps a real deployment alive; tests and tools must be able to exit.
    this._timers.push(setInterval(() => this.enqueue(() => this.evaluateGovernor()), this.cfg.governorMs).unref());
    this._timers.push(setInterval(() => this.store.save(), this.cfg.saveMs).unref());
    this.store.save();
    this.emit("started");
  }

  async stop() {
    this.running = false;
    for (const t of this._timers) clearInterval(t);
    this._timers = [];
    for (const v of Object.values(this.venues)) { try { await v.feed?.stop(); } catch {} }
    await this._queue;
    this.store.save();
    this.emit("stopped");
  }

  enqueue(fn) {
    this._queue = this._queue.then(fn).catch(err => { this.log("error", `engine: ${err.stack || err.message}`); });
    return this._queue;
  }

  log(level, text) { this.emit("log", { level, text, ts: this.clock() }); }

  // ── halt / resume / venue mode (E2, E4) ──
  async halt(mode, reason, { by = "operator", venue = null } = {}) {
    this.store.setHalt(mode, reason, venue);
    this.ledger.append({ kind: "halt", mode, reason, by, venue });
    this.log("warn", `HALT ${mode}${venue ? ` ${venue}` : ""}: ${reason} (${by})`);
    const result = { mode, reason, closed: [], failed: [] };
    if (mode === "flatten") {
      for (const p of this.store.openPositions(venue)) {
        const r = await this.closePosition(p, 100, "FLATTEN", { by });
        (r.ok ? result.closed : result.failed).push({ id: p.id, instrument: p.instrument, detail: r.ok ? r.fill.notional_usd : r.failure.reason });
      }
      if (result.failed.length) this.alerter?.send("error", `flatten left ${result.failed.length} position(s) open: ${result.failed.map(f => f.instrument).join(", ")}; retrying on next tick`);
    }
    this.store.save();
    return result;
  }

  resume(venue, { by = "operator" } = {}) {
    if (!venue) throw new Error("resume needs a venue name typed by the operator");
    if (this.store.state.halt.mode) this.store.setHalt(null, null);
    this.store.setHalt(null, null, venue);
    this.ledger.append({ kind: "resume", venue, by });
    this.evaluateGovernor();
    this.store.save();
    return this.store.state.halt;
  }

  async setVenueMode(venue, mode, { override = false, by = "operator" } = {}) {
    if (!this.venues[venue]) throw new Error(`unknown venue ${venue}`);
    let preflight = null;
    if (mode === "live") {
      const gate = this.promotion(venue);
      if (!gate.ok && !override) return { ok: false, gate, mode: this.store.venueMode(venue) };
      const router = this.venues[venue].liveRouter;
      if (!router) return { ok: false, mode: this.store.venueMode(venue), error: "no live router configured for this venue" };
      try { preflight = await router.init(); }
      catch (err) { return { ok: false, mode: this.store.venueMode(venue), error: `live router not ready: ${err.message}` }; }
      const h = await router.health();
      if (!h.ok) return { ok: false, mode: this.store.venueMode(venue), error: `live venue unreachable: ${h.detail}` };
      const minSol = this.env.venues[venue].min_stake_usd / Math.max(1, this.solPriceHint || 100);
      if (preflight && preflight.balanceSol != null && preflight.balanceSol < minSol + 0.01)
        return { ok: false, mode: this.store.venueMode(venue), error: `wallet ${preflight.wallet} holds ${preflight.balanceSol.toFixed(4)} SOL, below one minimum stake plus fees`, preflight };
      this.venues[venue].liveStartCapUsd = gate.liveStartCapUsd;
      if (!gate.ok) this.alerter?.send("warn", `${venue} switched to LIVE by operator override with the paper gate red: ${gate.items.filter(i => !i.ok).map(i => i.name).join(", ")}`);
    }
    this.store.setVenueMode(venue, mode);
    this.ledger.append({ kind: "venue", venue, mode, by, override: !!override, gateOk: mode === "live" ? this.promotion(venue).ok : null, preflight });
    this.store.save();
    return { ok: true, mode, liveStartCapUsd: this.venues[venue].liveStartCapUsd || null, override: !!override, preflight };
  }

  routerFor(venue) {
    const v = this.venues[venue];
    return this.store.venueMode(venue) === "live" ? v.liveRouter : v.router;
  }

  // ── events ──
  async onEvent(event) {
    const venue = event.venue;
    const v = this.venues[venue];
    if (!v || this.store.venueMode(venue) === "off") return;
    if (event.kind === "feed_health") { this.store.state.feeds[venue] = { ...(this.store.state.feeds[venue] || {}), healthy: event.payload.healthy, detail: event.payload.detail, at: event.t_observed }; return; }
    this.store.state.feeds[venue] = { ...(this.store.state.feeds[venue] || {}), lastEventAt: event.t_observed };

    // Exits first: a held instrument's tick is worth more than a new candidate.
    await this.checkExits(event);

    if (event.payload?.solPrice > 0) this.solPriceHint = event.payload.solPrice;
    if (!v.runner) return;
    const gov = this.governorContext(venue);
    const t0 = performance.now();
    if (event.kind === "candidate" && (this.disqualified.get(event.id) || 0) > event.t_observed) return;
    const decisions = v.runner.run(event, { governor: gov, stats: this.stats, weights: { pumpfun: this.weights.current().weights } });
    const decideMs = performance.now() - t0;
    for (const d of decisions) {
      if (d.action === "REJECT" && d.gate === "disqualifiers") this.disqualified.set(d.instrument, event.t_observed + this.cfg.disqualifyMs);
      this.latency[venue].decide.record(decideMs);
      d.decide_ms = +decideMs.toFixed(3);
      this.ledger.append({ kind: "decision", venue, id: d.id, decisionId: d.id, ...d });
      this.store.noteDecision(d);
      if (d.action === "GO") await this.enter(d, event);
    }
  }

  governorContext(venue) {
    const halted = this.store.isHalted(venue);
    const blocked = this.blocked[venue];
    return {
      halt: !!halted || !!blocked || this.verdict.halt,
      haltReason: halted?.reason || blocked || this.verdict.haltReason || null,
      throttle: this.verdict.throttle,
    };
  }

  portfolioSnapshot() {
    this.store.rollDay();
    return {
      open: this.store.openPositions().map(p => ({ venue: p.venue, group: p.group, notional_usd: p.notional_usd, worst_case_fraction: p.worst_case_fraction ?? 1 })),
      realized_today_usd: this.store.state.day.realizedUsd,
    };
  }

  // ── entry ──
  async enter(decision, event) {
    const venue = decision.venue;
    const v = this.venues[venue];
    const inst = decision.instrument;
    if (this.inflight.has(inst) || this.store.openPositions(venue).some(p => p.instrument === inst))
      return this.ledger.append({ kind: "order", venue, orderId: `${decision.id}:o`, decisionId: decision.id, stage: "failed", reason: "ALREADY_IN_OR_INFLIGHT" });
    if ((this.cooldown.get(inst) || 0) > event.t_observed)
      return this.ledger.append({ kind: "order", venue, orderId: `${decision.id}:o`, decisionId: decision.id, stage: "failed", reason: "REENTRY_COOLDOWN" });

    const sizing = this.sizer.size({ decision, portfolio: this.portfolioSnapshot(), throttle: this.verdict.throttle, halted: !!this.store.isHalted(venue) });
    const liveCap = this.store.venueMode(venue) === "live" ? v.liveStartCapUsd || null : null;
    let stake = sizing.stake_usd;
    if (liveCap && stake > liveCap) { stake = liveCap; sizing.caps.push("LIVE_START_CAP"); }
    const orderId = `${decision.id}:o`;
    this.ledger.append({ kind: "order", venue, orderId, decisionId: decision.id, stage: "sized", stake_usd: stake, sizing });
    if (!(stake > 0)) return;

    const order = this.buildOrder(decision, orderId, stake, venue);
    if (!order) return this.ledger.append({ kind: "order", venue, orderId, decisionId: decision.id, stage: "failed", reason: "NO_REFERENCE" });

    const router = this.routerFor(venue);
    if (!router) return this.ledger.append({ kind: "order", venue, orderId, decisionId: decision.id, stage: "failed", reason: "NO_ROUTER" });

    this.inflight.add(inst);
    const t_sent = this.clock();
    this.ledger.append({ kind: "order", venue, orderId, decisionId: decision.id, stage: "sent", t_sent, instrument: inst, side: "BUY", stake_usd: stake, legs: order.legs?.length || 0 });
    this.latency[venue].send.record(Math.max(0, t_sent - decision.t_decided));
    let r;
    try { r = await router.submit(order); } catch (err) { r = { ok: false, failure: { orderId, code: "ROUTER_THREW", reason: err.message } }; }
    this.inflight.delete(inst);
    if (!r.ok) {
      this.ledger.append({ kind: "order", venue, orderId, decisionId: decision.id, stage: r.unwound ? "unwound" : "failed", reason: r.failure.reason, code: r.failure.code, unwound: r.unwound || null });
      if (r.unwound) this.ledger.append({ kind: "outcome", venue, instrument: inst, decisionId: decision.id, pnl_usd: -(r.unwound.reduce((s, u) => s + (u.failed ? 0 : Math.max(0, (u.stake_usd || 0) - (u.notional_usd || 0))), 0)), pnl_pct: 0, stake_usd: stake, p_win: decision.p_win, confidence: decision.confidence, model: decision.model, tier: decision.tier, held_ms: 0, reason: "LEG_UNWOUND", paper: !!(r.unwound[0]?.paper) });
      return;
    }
    const fill = r.fill;
    this.latency[venue].confirm.record(fill.latency_ms || 0);
    const key = venue === "pumpfun" ? decision.tier : decision.model;
    const plan = createPlan({ venue, key, entry: { score: decision.features ? Math.round((decision.features.apeScore || 0) * 100) : 0, price: fill.price } });
    const position = {
      id: `${venue}:${inst}:${fill.t_filled}`, venue, instrument: inst, model: decision.model, tier: decision.tier, group: decision.group,
      decisionId: decision.id, orderId, entryTime: fill.t_filled, entryPrice: fill.price, qty: fill.qty, notional_usd: fill.notional_usd, stake_usd: stake,
      cost_usd: fill.notional_usd + (fill.fee_usd || 0), proceeds_usd: 0, remaining_qty: fill.qty,
      entryMark: venue === "pumpfun" ? (decision.reference?.mcapUsd || 0) : fill.price, mark: null, peak: null, changePct: 0,
      entryScore: decision.features ? Math.round((decision.features.apeScore || 0) * 100) : 0,
      worst_case_fraction: sizing.stop_fraction ?? decision.stop_fraction ?? 1, plan, status: "open",
      p_win: decision.p_win, confidence: decision.confidence, features: decision.features || null,
      reference: decision.reference || null, legs: r.fills ? r.fills.map(f => ({ instrument: f.instrument, qty: f.qty, price: f.price })) : null, paper: !!fill.paper,
    };
    this.ledger.append({ kind: "fill", venue, orderId, decisionId: decision.id, positionId: position.id, side: "BUY", instrument: inst, price: fill.price, qty: fill.qty, notional_usd: fill.notional_usd, fee_usd: fill.fee_usd || 0, slippage_bps: fill.slippage_bps, latency_ms: fill.latency_ms, venue_ref: fill.venue_ref, plan: { venue: plan.venue, key: plan.key, mode: plan.mode }, paper: !!fill.paper });
    this.ledger.append({ kind: "order", venue, orderId, decisionId: decision.id, stage: "filled", positionId: position.id });
    this.store.upsertPosition(position);
    v.feed?.watch(inst);
    for (const l of position.legs || []) v.feed?.watch(l.instrument);
    this.store.save();
    this.emit("position", position);
    this.log("info", `ENTER ${venue} ${inst} $${fill.notional_usd.toFixed(2)} tier ${decision.tier} (${decision.model}) plan ${plan.key}`);
  }

  buildOrder(decision, orderId, stake, venue) {
    const v = this.venues[venue];
    const maxSlip = this.env.venues[venue].max_slippage_bps;
    if (venue === "pumpfun") {
      if (!decision.reference?.solPrice) return null;
      return { id: orderId, decisionId: decision.id, venue, instrument: decision.instrument, side: "BUY", stake_usd: stake, max_slippage_bps: maxSlip, reference: decision.reference };
    }
    if (venue === "polymarket") {
      const st = v.edge?.state;
      if (decision.legs?.length) {
        const per = stake / decision.legs.length;
        const legs = decision.legs.map(l => {
          const m = st?.markets.get(l.conditionId);
          return { instrument: l.instrument, side: "BUY", stake_usd: per, reference: { book: st?.books.get(l.instrument) || null, feeRateBps: m?.feeRateBps || 0, conditionId: l.conditionId } };
        });
        if (legs.some(l => !l.reference.book)) return null;
        return { id: orderId, decisionId: decision.id, venue, instrument: decision.instrument, side: "BUY", stake_usd: stake, max_slippage_bps: maxSlip, legs };
      }
      const book = st?.books.get(decision.instrument) || decision.reference?.book;
      if (!book) return null;
      return { id: orderId, decisionId: decision.id, venue, instrument: decision.instrument, side: "BUY", stake_usd: stake, max_slippage_bps: maxSlip, reference: { book, feeRateBps: decision.reference?.feeRateBps || 0, conditionId: decision.reference?.conditionId || null } };
    }
    return null;
  }

  // ── exits ──
  async checkExits(event) {
    const venue = event.venue;
    for (const p of this.store.openPositions(venue)) {
      const mine = p.instrument === event.id || (p.legs || []).some(l => l.instrument === event.id);
      if (!mine) continue;
      if (event.kind !== "tick" && event.kind !== "book" && event.kind !== "fact" && event.kind !== "market") continue;
      const tick = event.kind === "tick" ? event
        : event.kind === "book" ? { ...event, payload: { price: event.payload.bestBid, bestBid: event.payload.bestBid, book: event.payload } }
        : event.kind === "fact" ? { ...event, payload: { resolved: true, outcome: event.payload.outcome } }
        : { ...event, payload: { resolved: !!event.payload.closed, outcome: null } };
      if (event.kind === "market" && !event.payload.closed) continue;
      if (p.legs && event.kind !== "fact" && event.kind !== "market") continue; // multi-leg sets hold to redemption
      markPosition(p, tick);
      let action = null;
      try { action = evaluateExit(p, tick, { now: event.t_observed }); }
      catch (err) { this.log("error", `exit eval ${p.id}: ${err.message}`); continue; }
      if (!action) continue;
      await this.closePosition(p, action.pct, action.reason, { action: action.action, layer: action.layer, detail: action.detail, tick });
    }
  }

  async closePosition(p, pct, reason, { action = "SELL", layer = null, detail = null, tick = null, by = "plan" } = {}) {
    const venue = p.venue;
    const router = this.routerFor(venue);
    if (!router) return { ok: false, failure: { reason: "NO_ROUTER" } };
    const reference = tick?.payload?.book ? { book: tick.payload.book } : tick?.payload ? { ...p.reference, ...tick.payload, solPrice: tick.payload.solPrice || p.reference?.solPrice } : p.reference;
    let r;
    if (action === "REDEEM") {
      // Paper redemption: the winning side pays 1.00 per share.
      r = await router.close(p, 100, { reference: { book: { bids: [{ price: 1, size: p.remaining_qty || p.qty }] } } });
    } else if (p.legs?.length) {
      r = { ok: true, fill: { price: null, qty: p.legs.length, notional_usd: p.legs.reduce((s, l) => s + l.qty, 0), fee_usd: 0, t_sent: this.clock(), t_filled: this.clock(), latency_ms: 0, paper: true } };
      for (const l of p.legs) await router.close({ ...p, instrument: l.instrument, id: `${p.id}:${l.instrument}` }, 100, { reference: { book: { bids: [{ price: 1, size: l.qty }] } } });
    } else {
      r = await router.close(p, pct, { reference });
    }
    if (!r.ok) {
      this.ledger.append({ kind: "exit", venue, positionId: p.id, instrument: p.instrument, pct, reason, failed: true, error: r.failure.reason });
      this.log("warn", `EXIT FAILED ${p.instrument} ${reason}: ${r.failure.reason}`);
      return r;
    }
    const f = r.fill;
    const proceeds = f.notional_usd;
    p.proceeds_usd = (p.proceeds_usd || 0) + proceeds;
    p.remaining_qty = Math.max(0, (p.remaining_qty ?? p.qty) - (f.qty || 0));
    const done = !!(pct >= 100 || p.remaining_qty <= 1e-9 || action === "REDEEM" || (p.legs && p.legs.length));
    this.ledger.append({ kind: "exit", venue, positionId: p.id, decisionId: p.decisionId, instrument: p.instrument, pct, reason, layer, detail, price: f.price, qty: f.qty, proceeds_usd: proceeds, fee_usd: f.fee_usd || 0, latency_ms: f.latency_ms, venue_ref: f.venue_ref, final: done, by });
    if (done) {
      const pnl = +(p.proceeds_usd - p.cost_usd).toFixed(4);
      const held = (f.t_filled || this.clock()) - p.entryTime;
      this.store.closePosition(p.id, { exitReason: reason, pnl_usd: pnl, remaining_qty: 0 });
      this.store.rollDay();
      this.store.state.day.realizedUsd = +(this.store.state.day.realizedUsd + pnl).toFixed(4);
      this.store.state.day.trades++;
      this.ledger.append({ kind: "outcome", venue, instrument: p.instrument, positionId: p.id, decisionId: p.decisionId, pnl_usd: pnl, pnl_pct: p.cost_usd > 0 ? +((pnl / p.cost_usd) * 100).toFixed(2) : 0, stake_usd: p.stake_usd, p_win: p.p_win, confidence: p.confidence, model: p.model, tier: p.tier, held_ms: held, reason, features: p.features, paper: !!f.paper });
      this.cooldown.set(p.instrument, this.clock() + this.cfg.reentryCooldownMs);
      this.venues[venue].feed?.unwatch(p.instrument);
      for (const l of p.legs || []) this.venues[venue].feed?.unwatch(l.instrument);
      this.stats = statsFromOutcomes(this.ledger.query({ kind: "outcome", limit: 5000 }));
      this.log("info", `EXIT ${venue} ${p.instrument} ${reason} pnl $${pnl.toFixed(2)} held ${Math.round(held / 1000)}s`);
      this.emit("outcome", { position: p, pnl });
      this.evaluateGovernor();
      if (++this._outcomesSinceRetrain >= this.cfg.retrainEvery) { this._outcomesSinceRetrain = 0; this.retrain(); }
    }
    this.store.save();
    return r;
  }

  // ── governor (DP7) ──
  evaluateGovernor() {
    const snap = this.portfolioSnapshot();
    const verdict = this.governor.evaluate({ regime: this.store.state.regime, realized_today_usd: snap.realized_today_usd, open: this.store.openPositions().map(p => ({ ...p })) });
    this.verdict = verdict;
    this.store.state.throttle = verdict.throttle;
    this.store.state.governor = { reasons: verdict.reasons, blindSpots: verdict.blindSpots, halt: verdict.halt, haltReason: verdict.haltReason, at: verdict.at };
    const key = JSON.stringify([verdict.throttle, verdict.halt, verdict.haltReason, verdict.reasons]);
    if (key !== this._lastGovernorKey) {
      this._lastGovernorKey = key;
      this.ledger.append({ kind: "governor", throttle: verdict.throttle, halt: verdict.halt, haltReason: verdict.haltReason, reasons: verdict.reasons, blindSpots: verdict.blindSpots, regime: verdict.regime });
      if (verdict.halt && !this.store.isHalted()) {
        this.store.setHalt("freeze", `governor: ${verdict.haltReason}`);
        this.ledger.append({ kind: "halt", mode: "freeze", reason: `governor: ${verdict.haltReason}`, by: "governor" });
        this.alerter?.send("warn", `governor froze entries: ${verdict.haltReason}. Exits keep running. Resume with: velocity resume <venue>`);
      }
    }
    return verdict;
  }

  setRegime(regime) { this.store.state.regime = regime; this.evaluateGovernor(); }

  // ── learner (DP8) ──
  retrain() {
    const integrity = verifyChecksums(this.checksums);
    if (!integrity.ok) { this.ledger.append({ kind: "violation", venue: "pumpfun", rule: "gate_checksum", detail: integrity.changed }); this.alerter?.send("error", `gate files changed on disk: ${integrity.changed.join(", ")}; retrain refused`); return null; }
    const outcomes = this.ledger.query({ kind: "outcome", venue: "pumpfun", limit: 5000 });
    const cur = this.weights.current();
    const r = retrain({ venue: "pumpfun", outcomes, weights: cur.weights });
    if (r.changed) {
      const rec = this.weights.save(r.weights, { n: r.n, accuracyBefore: r.accuracyBefore, accuracyAfter: r.accuracyAfter, violations: r.violations, importance: r.importance });
      this.store.state.weightsVersion = rec.version;
      this.ledger.append({ kind: "weights", version: rec.version, weights: r.weights, violations: r.violations, n: r.n, accuracyBefore: r.accuracyBefore, accuracyAfter: r.accuracyAfter });
      if (r.violations.length) this.alerter?.send("warn", `learner saw data contradicting sacred priors: ${r.violations.map(v => v.feature).join(", ")} (kept, pinned)`);
    }
    return r;
  }

  // ── reconciliation (DP9) ──
  async reconcile() {
    const report = { at: this.clock(), venues: {} };
    for (const [venue, v] of Object.entries(this.venues)) {
      const mode = this.store.venueMode(venue);
      if (mode === "off") continue;
      const router = this.routerFor(venue);
      const rep = { matched: [], adopted: [], closed: [], frozen: false, error: null };
      report.venues[venue] = rep;
      let venuePositions;
      try { venuePositions = await router.positions(); }
      catch (err) { rep.error = err.message; rep.frozen = true; this.store.setHalt("freeze", `reconcile failed: ${err.message}`, venue); continue; }
      const atVenue = new Map(venuePositions.map(p => [p.instrument, p]));
      const inStore = new Map(this.store.openPositions(venue).map(p => [p.instrument, p]));
      // Ledger truth: BUY fills with no final exit since.
      const fills = this.ledger.readAll(r => r.kind === "fill" && r.venue === venue && r.side === "BUY");
      const finals = new Set(this.ledger.readAll(r => r.kind === "exit" && r.venue === venue && r.final).map(r => r.positionId));
      const openInLedger = new Map(fills.filter(f => !finals.has(f.positionId)).map(f => [f.instrument, f]));
      for (const [inst, vp] of atVenue) {
        if (inStore.has(inst)) { const p = inStore.get(inst); if (vp.qty != null) { p.qty = vp.qty; p.remaining_qty = vp.qty; } rep.matched.push(inst); continue; }
        const f = openInLedger.get(inst);
        const decision = f ? this.ledger.readAll(r => r.kind === "decision" && r.decisionId === f.decisionId)[0] : null;
        const tier = decision?.tier || 2;
        const key = venue === "pumpfun" ? (tier >= 1 && tier <= 3 ? tier : 2) : (decision?.model || "resolved_fact");
        const plan = createPlan({ venue, key, entry: { score: decision?.features ? Math.round(decision.features.apeScore * 100) : 0, price: f?.price || vp.avgPrice || 0 } });
        const position = {
          id: f?.positionId || `${venue}:${inst}:adopted:${this.clock()}`, venue, instrument: inst, model: decision?.model || "adopted", tier, group: decision?.group || null,
          decisionId: f?.decisionId || null, orderId: f?.orderId || null, entryTime: f?.ts || this.clock(), entryPrice: f?.price || vp.avgPrice || 0, qty: vp.qty, remaining_qty: vp.qty,
          notional_usd: f?.notional_usd || vp.notional_usd || 0, stake_usd: f?.notional_usd || vp.notional_usd || 0, cost_usd: (f?.notional_usd || vp.notional_usd || 0) + (f?.fee_usd || 0), proceeds_usd: 0,
          entryMark: venue === "pumpfun" ? decision?.reference?.mcapUsd || 0 : f?.price || vp.avgPrice || 0, mark: null, peak: null, changePct: 0, entryScore: decision?.features ? Math.round(decision.features.apeScore * 100) : 0,
          worst_case_fraction: decision?.stop_fraction ?? 1, plan, status: "open", p_win: decision?.p_win ?? null, confidence: decision?.confidence ?? null, features: decision?.features || null,
          reference: decision?.reference || null, legs: null, paper: mode === "paper", adopted: true,
        };
        this.store.upsertPosition(position);
        rep.adopted.push(inst);
      }
      for (const [inst, p] of inStore) {
        if (atVenue.has(inst)) continue;
        this.store.closePosition(p.id, { exitReason: "MISSING_AT_VENUE", pnl_usd: null });
        this.ledger.append({ kind: "outcome", venue, instrument: inst, positionId: p.id, decisionId: p.decisionId, pnl_usd: 0, pnl_pct: 0, stake_usd: p.stake_usd, p_win: p.p_win, confidence: p.confidence, model: p.model, tier: p.tier, held_ms: this.clock() - p.entryTime, reason: "MISSING_AT_VENUE", reconciled: true, paper: !!p.paper });
        rep.closed.push(inst);
      }
    }
    this.store.state.reconciledAt = report.at;
    this.ledger.append({ kind: "reconcile", report });
    this.store.save();
    const adopted = Object.values(report.venues).reduce((s, r) => s + r.adopted.length, 0);
    const closed = Object.values(report.venues).reduce((s, r) => s + r.closed.length, 0);
    if (adopted || closed || Object.values(report.venues).some(r => r.frozen)) this.alerter?.send("warn", `reconciled: adopted ${adopted}, closed ${closed}${Object.values(report.venues).some(r => r.frozen) ? ", a venue is frozen" : ""}`);
    this.emit("reconciled", report);
    return report;
  }

  // ── observability (E5, E6, E7) ──
  promotion(venue) {
    const lat = this.latencySummary(venue);
    return promotionGate({ ledger: this.ledger, envelope: this.env, venue, latency: lat, store: this.store });
  }

  latencySummary(venue) {
    const v = this.venues[venue];
    const l = this.latency[venue];
    if (!l) return null;
    return { observe: v?.feed?.latency?.summary() || null, decide: l.decide.summary(), send: l.send.summary(), confirm: l.confirm.summary() };
  }

  status() {
    const s = this.store.state;
    this.store.rollDay();
    const venues = {};
    for (const [venue, v] of Object.entries(this.venues)) {
      venues[venue] = {
        mode: this.store.venueMode(venue), blocked: this.blocked[venue] || null, feed: v.feed?.status() || null, router: s.routers[venue] || null,
        latency: this.latencySummary(venue), budget: this.env.venues[venue].latency_budget_ms, halted: this.store.isHalted(venue),
        evaluated: v.runner?.evaluated || 0, gos: v.runner?.gos || 0, promotion: this.promotion(venue),
      };
    }
    return {
      running: this.running, startedAt: s.startedAt, now: this.clock(), heartbeatAt: s.heartbeatAt, reconciledAt: s.reconciledAt,
      halt: s.halt, throttle: s.throttle, governor: s.governor, regime: s.regime,
      day: { ...s.day, limit_usd: this.env.daily_loss_limit_usd, used_pct: +((Math.max(0, -s.day.realizedUsd) / this.env.daily_loss_limit_usd) * 100).toFixed(1) },
      positions: this.store.openPositions().map(p => ({ id: p.id, venue: p.venue, instrument: p.instrument, tier: p.tier, model: p.model, notional_usd: p.notional_usd, mark: p.mark, changePct: p.changePct, unrealized_usd: p.unrealized_usd, plan: { key: p.plan?.key, mode: p.plan?.mode }, entryTime: p.entryTime, adopted: !!p.adopted })),
      venues, weightsVersion: this.weights.current().version, lastDecisions: s.lastDecisions, alerts: s.alerts.slice(0, 10),
    };
  }

  why(id) {
    if (id === "last") { const d = this.ledger.lastDecision(); return d ? this.ledger.trail(d.id) : []; }
    const m = /^(\w+) last$/.exec(id);
    if (m) { const d = this.ledger.lastDecision(m[1]); return d ? this.ledger.trail(d.id) : []; }
    const trail = this.ledger.trail(id);
    if (trail.length) return trail;
    const near = this.ledger.query({ kind: "decision", limit: 5 }).map(d => d.id);
    return { error: `unknown id ${id}`, nearest: near };
  }
}
