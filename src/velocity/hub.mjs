// ═══ VELOCITY — hosted hub: one radar, one engine per user, a fee on realized profit ═══
// Design: src/velocity/HOSTED_DESIGN.md (DP2, DP3, DP5, DP6).
// One PumpfunFeed is shared by every engine through a SharedFeedView, so N users cost one radar.
// Each engine owns its wallet (secret injected, never process.env), risk envelope, ledger, store and
// halt state under data/velocity/users/<wallet>. When a position closes with a profit the hub
// computes the platform's cut from the measured SOL in and out, moves it from the user's trading
// wallet to PLATFORM_WALLET, and writes it to the user's ledger where they can see it.
import fs from "node:fs";
import path from "node:path";
import { Feed } from "./core/feed.mjs";
import { Engine } from "./core/engine.mjs";
import { Alerter } from "./core/alerts.mjs";
import { Supervisor } from "./core/supervisor.mjs";
import { validateRisk, deepFreeze } from "./core/risk.mjs";
import { formatRecord } from "./core/watch.mjs";
import { makePumpfunEdge } from "./venues/pumpfun/edge.mjs";
import { PumpfunPaperRouter, PumpfunLiveRouter } from "./venues/pumpfun/router.mjs";
import { PonsLiveRouter, PonsPaperRouter } from "./venues/pons/router.mjs";

/** The original platform wallet. Its key was pasted into a chat once; the operator chose to keep it,
 *  so it is accepted with a loud warning at boot rather than refused. Sweep it often. */
export const EXPOSED_DEFAULT_PLATFORM_WALLET = "4XnHZZmHwSQ8RszJsdc7snvxG8dZtm6g4hvpkCMkguMx";

/** A per-engine view of one shared feed: same events, own watch list, no own poller. */
export class SharedFeedView extends Feed {
  constructor(shared, { clock } = {}) {
    super({ venue: shared.venue, name: `${shared.name}:view`, clock: clock || shared.clock, staleAfterMs: shared.staleAfterMs, latencyBoundMs: shared.latencyBoundMs });
    this.shared = shared;
    this._onEvent = e => { if (e.kind !== "feed_health") { this.lastEventAt = e.t_observed; this.eventsEmitted++; } this.emit("event", e); };
  }
  get solPrice() { return this.shared.solPrice; }
  watch(id) { super.watch(id); this.shared.watch(id); this.shared._viewRefs = this.shared._viewRefs || new Map(); this.shared._viewRefs.set(String(id), (this.shared._viewRefs.get(String(id)) || 0) + 1); }
  unwatch(id) {
    super.unwatch(id);
    const refs = this.shared._viewRefs || new Map(); const n = (refs.get(String(id)) || 1) - 1;
    if (n <= 0) { refs.delete(String(id)); this.shared.unwatch(id); } else refs.set(String(id), n);
  }
  ageMs() { return this.shared.ageMs(); }
  isStale() { return this.shared.isStale(); }
  async start() { this.running = true; this.shared.on("event", this._onEvent); this.healthy = this.shared.healthy; }
  async stop() { this.running = false; this.shared.off("event", this._onEvent); }
}

/** A user's risk envelope: the template with the user's few choices, validated and frozen. */
export function userEnvelope(settings = {}, templateFile = path.resolve("src/velocity/config/risk.example.json")) {
  const t = JSON.parse(fs.readFileSync(templateFile, "utf8"));
  const bankroll = Math.max(20, Math.min(100_000, Number(settings.bankrollUsd) || 100));
  const perTrade = Math.max(5, Math.min(bankroll, Number(settings.perTradeMaxUsd) || 10));
  const maxPositions = Math.max(1, Math.min(10, Math.round(Number(settings.maxPositions) || 4)));
  const portfolio = Math.min(bankroll, perTrade * maxPositions);
  const daily = Math.max(5, Math.min(bankroll, Number(settings.dailyLossUsd) || Math.round(bankroll * 0.15)));
  // Degen apes heavier: the Kelly fraction scales with the dial (0.75x safe, 1x, 1.5x, 2x), capped at half Kelly.
  const level = Math.max(0, Math.min(3, Math.round(settings.aggression == null || settings.aggression === "" ? 1 : Number(settings.aggression) || 0)));
  const kellyMult = { 0: 0.75, 1: 1, 2: 1.5, 3: 2 }[level] || 1;
  const kelly = v => Math.min(0.5, (Number(v) || 0.25) * kellyMult);
  const cfg = {
    ...t, bankroll_usd: bankroll, bankroll_source: "wallet", wallet_reserve_sol: 0.02,
    per_trade_max_usd: perTrade, portfolio_max_exposure_usd: portfolio, daily_loss_limit_usd: daily,
    max_concurrent_positions: maxPositions, max_per_group: 1,
    venues: {
      pumpfun: { ...t.venues.pumpfun, max_exposure_usd: portfolio, max_concurrent: maxPositions, min_stake_usd: 5, kelly_fraction: kelly(t.venues.pumpfun.kelly_fraction) },
      pons: { ...t.venues.pons, max_exposure_usd: settings.pons ? portfolio : 0, max_concurrent: settings.pons ? maxPositions : 0, min_stake_usd: 5, kelly_fraction: kelly(t.venues.pons.kelly_fraction) },
      polymarket: { ...t.venues.polymarket, max_exposure_usd: 0 },
      perps: { ...t.venues.perps, max_exposure_usd: 0 },
    },
  };
  delete cfg._comment;
  const v = validateRisk(cfg);
  if (!v.ok) throw new Error(`risk settings rejected: ${v.errors.join("; ")}`);
  return deepFreeze(cfg);
}

export class VelocityHub {
  /**
   * @param feed        the shared PumpfunFeed (or any Feed) already fed by the radar
   * @param rootDir     data/velocity/users
   * @param platformWallet  where the fee goes; the exposed default is refused
   * @param fee         { calculateFee, resolveTier, recordTradeOutcome, recordGlobalFee, getUser }
   * @param makeLiveRouter  ({ secret }) => router; tests inject a double
   */
  constructor({ feed, ponsFeed = null, rootDir, platformWallet, platformEvmWallet = null, fee, feePct = null, rpcUrl = process.env.RPC_URL, makeLiveRouter = null, makePonsRouter = null, clock = () => Date.now(), log = console }) {
    this.feed = feed; this.ponsFeed = ponsFeed; this.rootDir = rootDir; this.platformWallet = platformWallet || null; this.platformEvmWallet = platformEvmWallet || null; this.fee = fee; this.rpcUrl = rpcUrl;
    this.makePonsRouter = makePonsRouter || (({ secret }) => new PonsLiveRouter({ secret, clock }));
    // A flat rate on realized profit (VELOCITY_FEE_PCT) replaces the site's ladder when set: one number, said plainly.
    this.feePct = feePct != null && feePct !== "" && Number.isFinite(Number(feePct)) && Number(feePct) >= 0 ? Number(feePct) : null;
    this.makeLiveRouter = makeLiveRouter || (({ secret }) => new PumpfunLiveRouter({ secret, rpcUrl, clock }));
    this.clock = clock; this.log = log;
    this.users = new Map(); // wallet -> { engine, sup, view, settings, startedAt }
    this._sweeps = new Map(); // wallet -> running or finished sweep job
    this.feeOk = !!this.platformWallet;
    if (!this.feeOk) log.error?.(`[VELOCITY-HUB] PLATFORM_WALLET is unset: SOL performance fees will NOT be collected`);
    else if (this.platformWallet === EXPOSED_DEFAULT_PLATFORM_WALLET) log.warn?.(`[VELOCITY-HUB] PLATFORM_WALLET is the original wallet whose key was once exposed in a chat: fees go there by the operator's choice; sweep it often`);
  }

  has(wallet) { return this.users.has(wallet); }
  list() { return [...this.users.keys()]; }

  /** Start a user's engine on their trading wallet. Refuses when the wallet cannot cover one order. */
  async start({ wallet, secret, evmSecret = null, settings = {} }) {
    if (!wallet || !secret) throw new Error("wallet and secret required");
    if (this.users.has(wallet)) return { ok: true, already: true, ...this.status(wallet) };
    const dataDir = path.join(this.rootDir, wallet);
    fs.mkdirSync(dataDir, { recursive: true });
    const pons = !!settings.pons && !!this.ponsFeed && !!evmSecret; // Robinhood Chain: opted in, feed running, ETH key on file
    const aggression = Math.max(0, Math.min(3, Math.round(settings.aggression == null || settings.aggression === "" ? 1 : Number(settings.aggression) || 0)));
    const envelope = userEnvelope({ ...settings, pons, aggression });
    const view = new SharedFeedView(this.feed, { clock: this.clock });
    const liveRouter = this.makeLiveRouter({ secret, wallet });
    const venues = { pumpfun: { mode: "paper", feed: view, edge: makePumpfunEdge({ aggression }), router: new PumpfunPaperRouter({ bookFile: path.join(dataDir, "paper-book-pumpfun.json"), clock: this.clock }), liveRouter } };
    if (pons) venues.pons = { mode: "paper", feed: new SharedFeedView(this.ponsFeed, { clock: this.clock }), edge: makePumpfunEdge({ venue: "pons", aggression }), router: new PonsPaperRouter({ bookFile: path.join(dataDir, "paper-book-pons.json"), clock: this.clock }), liveRouter: this.makePonsRouter({ secret: evmSecret, wallet }) };
    const engine = new Engine({ dataDir, envelope, venues, clock: this.clock });
    engine.alerter = new Alerter({ store: engine.store, ledger: engine.ledger, webhookUrl: null, statusUrl: null });
    engine.on("log", l => this.log.log?.(`[velocity ${wallet.slice(0, 8)}] ${l.level} ${l.text}`));
    engine.on("outcome", ({ position }) => { this.settleFee(wallet, position).catch(err => this.log.error?.(`[VELOCITY-HUB] fee ${wallet.slice(0, 8)}: ${err.message}`)); });
    const sup = new Supervisor({ engine, dataDir, alerter: engine.alerter, clock: this.clock });
    await engine.start();
    // Start is the user's intent to trade: a halt left over from their last stop or pause must not
    // outlive it. resume() re-runs the governor, so a daily-loss halt that still applies comes back.
    if (engine.store.state.halt?.mode || engine.store.isHalted("pumpfun")) engine.resume("pumpfun", { by: "user" });
    const live = await engine.setVenueMode("pumpfun", "live", { override: true, by: "user" });
    if (!live.ok) { await engine.stop(); return { ok: false, error: live.error || "could not go live", preflight: live.preflight || null }; }
    if (pons) { const l2 = await engine.setVenueMode("pons", "live", { override: true, by: "user" }); if (!l2.ok) engine.log("warn", `pons stays paper: ${l2.error || "could not go live"}`); }
    sup.start();
    this.users.set(wallet, { engine, sup, view, settings: { ...settings, aggression, pons }, startedAt: this.clock() });
    // Once a minute, the funnel in the server log: what the candidates hit. The first place to look when nothing fills.
    const fun = setInterval(() => { try { const f = engine.funnel(); this.log.log?.(`[velocity ${wallet.slice(0, 8)}] funnel 10m: judged ${f.judged} (${f.distinct} tokens) go ${f.gos} filled ${f.filled} | ${Object.entries(f.gates).map(([g, n]) => `${g} ${n}`).join(", ") || "no rejects"} | top: ${f.top.map(x => `${x.k} ${x.n}`).join("; ")}${f.sized0 ? ` | no size: ${JSON.stringify(f.sized0)}` : ""}${f.failed ? ` | failed: ${JSON.stringify(f.failed)}` : ""}`); } catch {} }, 60_000);
    fun.unref?.(); this.users.get(wallet).fun = fun;
    return { ok: true, ...this.status(wallet) };
  }

  /** Sell everything the user holds and stop their engine. */
  async stop(wallet, { flatten = true } = {}) {
    const u = this.users.get(wallet);
    if (!u) return { ok: false, error: "not running" };
    let result = null;
    if (flatten) result = await u.engine.halt("flatten", "user stop", { by: "user" });
    u.sup.stop(); clearInterval(u.fun);
    await u.engine.stop();
    this.users.delete(wallet);
    return { ok: true, closed: result?.closed?.length || 0, failed: result?.failed || [] };
  }

  async halt(wallet, mode = "flatten") {
    const u = this.users.get(wallet);
    if (!u) return { ok: false, error: "not running" };
    return { ok: true, ...(await u.engine.halt(mode, "user halt", { by: "user" })) };
  }

  /** Pause: no new entries, open positions keep their exit plans. Resume lifts it. */
  async pause(wallet) {
    const u = this.users.get(wallet);
    if (!u) return { ok: false, error: "not running" };
    await u.engine.halt("freeze", "paused by user", { by: "user" });
    return { ok: true, ...this.status(wallet) };
  }
  resume(wallet) {
    const u = this.users.get(wallet);
    if (!u) return { ok: false, error: "not running" };
    u.engine.resume("pumpfun", { by: "user" });
    return { ok: true, ...this.status(wallet) };
  }

  /** Sell some or all of one open position now, by the user's hand. Runs on the engine's queue. */
  async closePosition(wallet, positionId, pct = 100) {
    const u = this.users.get(wallet);
    if (!u) return { ok: false, error: "not running" };
    const p = u.engine.store.state.positions[positionId];
    if (!p || p.status !== "open") return { ok: false, error: "no such open position" };
    const share = Math.min(100, Math.max(1, Math.round(Number(pct) || 100)));
    const r = await u.engine.enqueue(() => u.engine.closePosition(p, share, "USER_SELL", { by: "user", detail: `${share}% by the user` }));
    return { ok: !!r?.ok, ...(r?.ok ? { sold_pct: share, proceeds_usd: r.fill?.notional_usd ?? null } : { error: r?.failure?.reason || "sell failed", code: r?.failure?.code || null }), ...this.status(wallet) };
  }

  status(wallet) {
    const u = this.users.get(wallet);
    if (!u) return { running: false, sweep: this._sweepView(this._sweeps.get(wallet)) };
    const s = u.engine.status();
    return { running: true, startedAt: u.startedAt, settings: u.settings, status: s, funnel: u.engine.funnel(), feeWallet: this.feeOk ? this.platformWallet : null, sweep: this._sweepView(this._sweeps.get(wallet)) };
  }

  /** The narration, newest last, from the user's own ledger. */
  narration(wallet, limit = 60) {
    const u = this.users.get(wallet);
    if (!u) return [];
    return u.engine.ledger.query({ limit }).map(r => ({ ts: r.ts, line: formatRecord(r) })).filter(x => x.line).reverse();
  }

  /** The performance fee: on realized SOL profit of one closed position, paid from the wallet that earned it. */
  async settleFee(wallet, position) {
    const u = this.users.get(wallet);
    if (!u || position.paper) return null;
    const solIn = Number(position.sol_spent) || 0, solOut = Number(position.sol_received) || 0;
    if (!(solIn > 0) || !(solOut > 0)) return null; // no measured SOL on both sides: no basis for a fee
    const tier = this.fee.resolveTier(wallet, await this.fee.getUser?.(wallet));
    const f = this.feePct != null ? this.flatFee(solIn, solOut, wallet) : this.fee.calculateFee(solIn, solOut, wallet, tier.tier);
    this.fee.recordTradeOutcome?.(wallet, f.net);
    if (!(f.fee > 0.0005)) return { fee: 0, net: f.net };
    const venue = position.venue || "pumpfun", quote = venue === "pons" ? "ETH" : "SOL";
    const feeWallet = venue === "pons" ? this.platformEvmWallet : (this.feeOk ? this.platformWallet : null);
    if (!feeWallet) { u.engine.log("warn", `platform fee ${f.fee.toFixed(6)} ${quote} not collected: ${venue === "pons" ? "PLATFORM_EVM_WALLET" : "PLATFORM_WALLET"} not set`); return { fee: f.fee, net: f.net, collected: false }; }
    const solPrice = u.engine.solPriceHint || this.feed.solPrice || 0;
    const sig = await u.engine.venues[venue].liveRouter.transferSol(feeWallet, f.fee);
    u.engine.ledger.append({ kind: "fee", venue: "pumpfun", instrument: position.instrument, positionId: position.id, scope: "platform", sol: +f.fee.toFixed(6), usd: +(f.fee * solPrice).toFixed(4), rate: f.rate ?? null, net_sol: f.net, venue_ref: sig, note: `performance fee ${f.rate ?? ""}% of ${f.net.toFixed(4)} SOL profit` });
    u.engine.store.save();
    this.fee.recordGlobalFee?.(f.fee);
    u.engine.log("info", `platform fee ${f.fee.toFixed(6)} ${quote} (${f.rate ?? "?"}% of ${f.net.toFixed(4)} profit) tx ${String(sig).slice(0, 10)}`);
    return { fee: f.fee, net: f.net, collected: true, sig };
  }

  /** feePct of realized profit; nothing on a loss or dust; the owner pays nothing. */
  flatFee(solIn, solOut, wallet) {
    const net = +(solOut - solIn).toFixed(6);
    if (net <= 0.001 || this.fee.isOwnerWallet?.(wallet)) return { fee: 0, net, rate: this.feePct };
    return { fee: +(net * this.feePct / 100).toFixed(6), net, rate: this.feePct, type: "profit-share" };
  }

  /**
   * Sell every token in the user's wallets to SOL / ETH, one by one: first every open position through
   * the engine (booked as USER_SWEEP), then anything else the wallets hold, straight through the routers.
   * Works whether or not the bot is running (routers are built from the keys when it is not).
   * A PONS token whose curve has graduated cannot be sold by the router and is reported as such.
   */
  /** The sweep as a background job: sixty tokens sold one by one take longer than any HTTP call may.
   *  Starts one if none is running; the report grows as it goes and status() shows it. */
  startSweep(wallet, opts = {}) {
    const cur = this._sweeps.get(wallet);
    if (cur && !cur.done) return { ok: true, started: false, sweep: this._sweepView(cur) };
    const job = { startedAt: Date.now(), done: false, finishedAt: null, chain: opts.chain || "all", report: [], total: null, error: null };
    this._sweeps.set(wallet, job);
    this.sweepWallet(wallet, { ...opts, job }).then(r => { job.total = r.report.length; }).catch(err => { job.error = err.message; }).finally(() => { job.done = true; job.finishedAt = Date.now(); });
    return { ok: true, started: true, sweep: this._sweepView(job) };
  }
  _sweepView(j) { return j ? { startedAt: j.startedAt, done: j.done, finishedAt: j.finishedAt, chain: j.chain, sold: j.report.filter(r => r.ok).length, failed: j.report.filter(r => !r.ok).length, report: j.report, error: j.error, current: j.current || null } : null; }

  /** Sell one token the wallet holds, tracked or not, straight through the router. */
  async sellHolding(wallet, { venue, instrument, pct = 100, secret = null, evmSecret = null }) {
    const u = this.users.get(wallet);
    const inst = venue === "pons" ? String(instrument).toLowerCase() : String(instrument);
    const open = u?.engine.store.openPositions(venue).find(p => p.instrument === inst || p.instrument.toLowerCase() === inst.toLowerCase());
    if (open) return this.closePosition(wallet, open.id, pct);
    const router = venue === "pons" ? (u?.engine.venues.pons?.liveRouter || (evmSecret ? this.makePonsRouter({ secret: evmSecret, wallet }) : null)) : (u?.engine.venues.pumpfun?.liveRouter || (secret ? this.makeLiveRouter({ secret, wallet }) : null));
    if (!router) return { ok: false, error: venue === "pons" ? "no Robinhood Chain wallet" : "no Solana wallet" };
    if (!router.ready) await router.init();
    const price = venue === "pons" ? (this.ponsFeed?.solPrice || 0) : (this.feed?.solPrice || 0);
    const r = await router.close({ id: `sell:${inst}`, instrument: inst }, pct, { reference: { solPrice: price } });
    u?.engine.log("info", `sell ${inst.slice(0, 10)} (${venue}): ${r?.ok ? `sold for ${(r.fill.sol_received ?? 0).toFixed(venue === "pons" ? 5 : 4)} ${venue === "pons" ? "ETH" : "SOL"}` : `${r?.failure?.code || ""} ${r?.failure?.reason || "failed"}`}`);
    if (u) { try { await u.engine.refreshWallet(); } catch {} }
    return r?.ok ? { ok: true, received: r.fill.sol_received ?? null, proceeds_usd: r.fill.notional_usd ?? null } : { ok: false, error: r?.failure?.reason || "sell failed", code: r?.failure?.code || null };
  }

  async sweepWallet(wallet, { secret, evmSecret = null, chain = "all", explorer = null, job = null } = {}) {
    const u = this.users.get(wallet);
    const report = job ? job.report : [];
    const at = (venue, inst) => { if (job) job.current = { venue, instrument: inst, at: Date.now() }; };
    const note = (venue, instrument, r, extra = {}) => report.push({ venue, instrument, ok: !!r?.ok, proceeds_usd: r?.fill?.notional_usd ?? null, received: r?.fill?.sol_received ?? null, error: r?.ok ? null : (r?.failure?.reason || "failed"), code: r?.ok ? null : (r?.failure?.code || null), ...extra });
    const doSol = chain === "all" || chain === "sol" || chain === "pumpfun", doEth = (chain === "all" || chain === "eth" || chain === "pons" || chain === "rh") && !!(u?.engine.venues.pons || evmSecret);
    // 1. open positions, through the engine, so the ledger and P&L see them
    if (u) for (const venue of ["pumpfun", "pons"]) {
      if ((venue === "pumpfun" && !doSol) || (venue === "pons" && !doEth) || !u.engine.venues[venue]) continue;
      for (const p of u.engine.store.openPositions(venue)) { at(venue, p.instrument); const r = await u.engine.enqueue(() => u.engine.closePosition(p, 100, "USER_SWEEP", { by: "user", detail: "wallet sweep" })); note(venue, p.instrument, r, { position: p.id }); }
    }
    // 2. whatever else the wallets hold, through the routers
    const solRouter = u?.engine.venues.pumpfun?.liveRouter || (secret ? this.makeLiveRouter({ secret, wallet }) : null);
    const ethRouter = u?.engine.venues.pons?.liveRouter || (evmSecret ? this.makePonsRouter({ secret: evmSecret, wallet }) : null);
    if (doSol && solRouter) {
      try {
        if (!solRouter.ready) await solRouter.init();
        const solPrice = this.feed?.solPrice || 0;
        for (const h of await solRouter.positions()) {
          if (!(h.qty >= 1)) continue;
          if (report.some(x => x.instrument === h.instrument && x.ok)) continue; // sold above as an open position
          at("pumpfun", h.instrument);
          const r = await solRouter.close({ id: `sweep:${h.instrument}`, instrument: h.instrument }, 100, { reference: { solPrice } });
          note("pumpfun", h.instrument, r, { qty: h.qty });
          u?.engine.log("info", `sweep ${h.instrument.slice(0, 8)}: ${r?.ok ? `sold ${h.qty} tokens for ${(r.fill.sol_received ?? 0).toFixed(4)} SOL` : r?.failure?.reason}`);
        }
      } catch (err) { report.push({ venue: "pumpfun", instrument: null, ok: false, error: err.message }); }
    }
    if (doEth && ethRouter) {
      try {
        if (!ethRouter.ready) await ethRouter.init();
        const rpc = this.ponsFeed?.rpc || explorer;
        const ethPrice = this.ponsFeed?.solPrice || 0;
        let held = [], listed = false;
        try { if (rpc?.walletTokens) { held = await rpc.walletTokens(ethRouter.address); listed = true; } } catch (err) { report.push({ venue: "pons", instrument: null, ok: false, error: `could not list the wallet (${err.message}); checking every token this wallet ever bought instead` }); }
        // Whatever the listing said, every token this wallet ever bought is checked for a balance too.
        if (u) u.engine.seedRouterKnowledge("pons"); else for (const inst of this._instrumentsFromDisk(wallet, "pons")) ethRouter.track?.(inst);
        for (const p of await ethRouter.positions()) if (!held.some(h => h.instrument === p.instrument)) held.push(p);
        for (const h of held) {
          if (!(h.qty >= 1)) continue;
          if (report.some(x => x.instrument === h.instrument && x.ok)) continue; // sold above as an open position
          at("pons", h.instrument);
          let info = null; try { info = rpc?.launchInfo ? await rpc.launchInfo(h.instrument) : null; } catch {}
          if (!info) { report.push({ venue: "pons", instrument: h.instrument, ok: false, qty: h.qty, error: "not a PONS launch; sell by hand" }); continue; }
          if (info.graduated) { report.push({ venue: "pons", instrument: h.instrument, ok: false, qty: h.qty, code: "GRADUATED", error: "curve graduated to Uniswap; sell by hand on PONS" }); continue; }
          let ci = {}; try { ci = rpc?.curveInfo ? await rpc.curveInfo(info.curve) : {}; } catch {}
          const r = await ethRouter.close({ id: `sweep:${h.instrument}`, instrument: h.instrument, curve: info.curve }, 100, { reference: { solPrice: ethPrice, curve: { address: info.curve, ...ci } } });
          note("pons", h.instrument, r, { qty: h.qty });
          u?.engine.log("info", `sweep ${h.instrument.slice(0, 10)}: ${r?.ok ? `sold ${h.qty} tokens for ${(r.fill.sol_received ?? 0).toFixed(5)} ETH` : r?.failure?.reason}`);
        }
      } catch (err) { report.push({ venue: "pons", instrument: null, ok: false, error: err.message }); }
    }
    if (job) job.current = null;
    if (u) { try { await u.engine.refreshWallet(); } catch {} }
    return { ok: true, sold: report.filter(r => r.ok).length, failed: report.filter(r => !r.ok).length, report };
  }

  /** Every instrument a stopped user's ledger says this wallet bought on a venue, read from disk. */
  _instrumentsFromDisk(wallet, venue) {
    const out = new Set();
    try {
      const file = path.join(this.rootDir, wallet, "ledger.jsonl");
      if (!fs.existsSync(file)) return [];
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (!line.includes(`"${venue}"`)) continue;
        try { const r = JSON.parse(line); if (r.venue === venue && r.instrument && (r.kind === "fill" || (r.kind === "order" && r.stage === "sent"))) out.add(String(r.instrument).toLowerCase()); } catch {}
      }
    } catch {}
    return [...out];
  }

  async stopAll() { for (const w of this.list()) { try { await this.stop(w, { flatten: false }); } catch {} } }
}

/** Express routes. deps: { hub, requireOwner, getTradingWallet } */
export function mountVelocityRoutes(app, { hub, requireOwner, getTradingWallet }) {
  // Anyone with a trading wallet can run the bot: the fee on profit is the only price of admission.
  app.post("/api/velocity/start", requireOwner, async (req, res) => {
    try {
      const { wallet, settings } = req.body || {};
      const tw = await getTradingWallet(wallet);
      if (!tw?.secret) return res.status(400).json({ error: "No trading wallet; create one first" });
      res.json(await hub.start({ wallet, secret: tw.secret, evmSecret: tw.evmSecret || null, settings: settings || {} }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/velocity/stop", requireOwner, async (req, res) => { try { res.json(await hub.stop(req.body.wallet)); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post("/api/velocity/pause", requireOwner, async (req, res) => { try { res.json(await hub.pause(req.body.wallet)); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post("/api/velocity/resume", requireOwner, (req, res) => { try { res.json(hub.resume(req.body.wallet)); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post("/api/velocity/sweep", requireOwner, async (req, res) => {
    try {
      const { wallet, chain } = req.body || {};
      const tw = await getTradingWallet(wallet);
      if (!tw?.secret) return res.status(400).json({ error: "No trading wallet" });
      res.json(hub.startSweep(wallet, { secret: tw.secret, evmSecret: tw.evmSecret || null, chain: chain || "all" }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/velocity/sweep", requireOwner, (req, res) => res.json({ ok: true, sweep: hub._sweepView(hub._sweeps.get(req.query.wallet)) }));
  app.post("/api/velocity/sell", requireOwner, async (req, res) => {
    try {
      const { wallet, venue, instrument, pct } = req.body || {};
      if (!instrument || !["pons", "pumpfun"].includes(venue)) return res.status(400).json({ error: "venue (pons|pumpfun) and instrument required" });
      const tw = await getTradingWallet(wallet);
      if (!tw?.secret) return res.status(400).json({ error: "No trading wallet" });
      res.json(await hub.sellHolding(wallet, { venue, instrument, pct: Number(pct) || 100, secret: tw.secret, evmSecret: tw.evmSecret || null }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/velocity/close", requireOwner, async (req, res) => { try { res.json(await hub.closePosition(req.body.wallet, req.body.positionId, req.body.pct)); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post("/api/velocity/halt", requireOwner, async (req, res) => { try { res.json(await hub.halt(req.body.wallet, req.body.mode === "freeze" ? "freeze" : "flatten")); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get("/api/velocity/status", requireOwner, (req, res) => res.json({ ok: true, ...hub.status(req.query.wallet), narration: hub.narration(req.query.wallet, 40) }));
  app.get("/api/velocity/health", (req, res) => res.json({ ok: true, users: hub.list().length, feeConfigured: hub.feeOk, feed: hub.feed.status?.() || null, pons: hub.ponsFeed ? { ...(hub.ponsFeed.status?.() || {}), tokens: hub.ponsFeed.tokens?.size ?? null, ethPrice: hub.ponsFeed.solPrice, feeConfigured: !!hub.platformEvmWallet } : null }));
}
