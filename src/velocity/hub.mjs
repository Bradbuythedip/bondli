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

/** The wallet whose key was pasted into a chat; fees must never be sent there. */
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
  const cfg = {
    ...t, bankroll_usd: bankroll, bankroll_source: "wallet", wallet_reserve_sol: 0.02,
    per_trade_max_usd: perTrade, portfolio_max_exposure_usd: portfolio, daily_loss_limit_usd: daily,
    max_concurrent_positions: maxPositions, max_per_group: 1,
    venues: {
      pumpfun: { ...t.venues.pumpfun, max_exposure_usd: portfolio, max_concurrent: maxPositions, min_stake_usd: 5 },
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
  constructor({ feed, rootDir, platformWallet, fee, feePct = null, rpcUrl = process.env.RPC_URL, makeLiveRouter = null, clock = () => Date.now(), log = console }) {
    this.feed = feed; this.rootDir = rootDir; this.platformWallet = platformWallet || null; this.fee = fee; this.rpcUrl = rpcUrl;
    // A flat rate on realized profit (VELOCITY_FEE_PCT) replaces the site's ladder when set: one number, said plainly.
    this.feePct = feePct != null && feePct !== "" && Number.isFinite(Number(feePct)) && Number(feePct) >= 0 ? Number(feePct) : null;
    this.makeLiveRouter = makeLiveRouter || (({ secret }) => new PumpfunLiveRouter({ secret, rpcUrl, clock }));
    this.clock = clock; this.log = log;
    this.users = new Map(); // wallet -> { engine, sup, view, settings, startedAt }
    this.feeOk = !!this.platformWallet && this.platformWallet !== EXPOSED_DEFAULT_PLATFORM_WALLET;
    if (!this.feeOk) log.error?.(`[VELOCITY-HUB] PLATFORM_WALLET is ${this.platformWallet ? "the exposed default" : "unset"}: performance fees will NOT be collected until it is set to a fresh wallet`);
  }

  has(wallet) { return this.users.has(wallet); }
  list() { return [...this.users.keys()]; }

  /** Start a user's engine on their trading wallet. Refuses when the wallet cannot cover one order. */
  async start({ wallet, secret, settings = {} }) {
    if (!wallet || !secret) throw new Error("wallet and secret required");
    if (this.users.has(wallet)) return { ok: true, already: true, ...this.status(wallet) };
    const dataDir = path.join(this.rootDir, wallet);
    fs.mkdirSync(dataDir, { recursive: true });
    const envelope = userEnvelope(settings);
    const aggression = Math.max(0, Math.min(3, Math.round(Number(settings.aggression) || 1)));
    const view = new SharedFeedView(this.feed, { clock: this.clock });
    const liveRouter = this.makeLiveRouter({ secret, wallet });
    const venues = { pumpfun: { mode: "paper", feed: view, edge: makePumpfunEdge({ aggression }), router: new PumpfunPaperRouter({ bookFile: path.join(dataDir, "paper-book-pumpfun.json"), clock: this.clock }), liveRouter } };
    const engine = new Engine({ dataDir, envelope, venues, clock: this.clock });
    engine.alerter = new Alerter({ store: engine.store, ledger: engine.ledger, webhookUrl: null, statusUrl: null });
    engine.on("log", l => this.log.log?.(`[velocity ${wallet.slice(0, 8)}] ${l.level} ${l.text}`));
    engine.on("outcome", ({ position }) => { this.settleFee(wallet, position).catch(err => this.log.error?.(`[VELOCITY-HUB] fee ${wallet.slice(0, 8)}: ${err.message}`)); });
    const sup = new Supervisor({ engine, dataDir, alerter: engine.alerter, clock: this.clock });
    await engine.start();
    const live = await engine.setVenueMode("pumpfun", "live", { override: true, by: "user" });
    if (!live.ok) { await engine.stop(); return { ok: false, error: live.error || "could not go live", preflight: live.preflight || null }; }
    sup.start();
    this.users.set(wallet, { engine, sup, view, settings: { ...settings, aggression }, startedAt: this.clock() });
    return { ok: true, ...this.status(wallet) };
  }

  /** Sell everything the user holds and stop their engine. */
  async stop(wallet, { flatten = true } = {}) {
    const u = this.users.get(wallet);
    if (!u) return { ok: false, error: "not running" };
    let result = null;
    if (flatten) result = await u.engine.halt("flatten", "user stop", { by: "user" });
    u.sup.stop();
    await u.engine.stop();
    this.users.delete(wallet);
    return { ok: true, closed: result?.closed?.length || 0, failed: result?.failed || [] };
  }

  async halt(wallet, mode = "flatten") {
    const u = this.users.get(wallet);
    if (!u) return { ok: false, error: "not running" };
    return { ok: true, ...(await u.engine.halt(mode, "user halt", { by: "user" })) };
  }

  status(wallet) {
    const u = this.users.get(wallet);
    if (!u) return { running: false };
    const s = u.engine.status();
    return { running: true, startedAt: u.startedAt, settings: u.settings, status: s, feeWallet: this.feeOk ? this.platformWallet : null };
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
    if (!this.feeOk) { u.engine.log("warn", `platform fee ${f.fee.toFixed(6)} SOL not collected: PLATFORM_WALLET not set`); return { fee: f.fee, net: f.net, collected: false }; }
    const solPrice = u.engine.solPriceHint || this.feed.solPrice || 0;
    const sig = await u.engine.venues.pumpfun.liveRouter.transferSol(this.platformWallet, f.fee);
    u.engine.ledger.append({ kind: "fee", venue: "pumpfun", instrument: position.instrument, positionId: position.id, scope: "platform", sol: +f.fee.toFixed(6), usd: +(f.fee * solPrice).toFixed(4), rate: f.rate ?? null, net_sol: f.net, venue_ref: sig, note: `performance fee ${f.rate ?? ""}% of ${f.net.toFixed(4)} SOL profit` });
    u.engine.store.save();
    this.fee.recordGlobalFee?.(f.fee);
    u.engine.log("info", `platform fee ${f.fee.toFixed(6)} SOL (${f.rate ?? "?"}% of ${f.net.toFixed(4)} profit) tx ${String(sig).slice(0, 10)}`);
    return { fee: f.fee, net: f.net, collected: true, sig };
  }

  /** feePct of realized profit; nothing on a loss or dust; the owner pays nothing. */
  flatFee(solIn, solOut, wallet) {
    const net = +(solOut - solIn).toFixed(6);
    if (net <= 0.001 || this.fee.isOwnerWallet?.(wallet)) return { fee: 0, net, rate: this.feePct };
    return { fee: +(net * this.feePct / 100).toFixed(6), net, rate: this.feePct, type: "profit-share" };
  }

  async stopAll() { for (const w of this.list()) { try { await this.stop(w, { flatten: false }); } catch {} } }
}

/** Express routes. deps: { hub, requireOwner, getTradingWallet, getUser, resolveTier } */
export function mountVelocityRoutes(app, { hub, requireOwner, getTradingWallet, getUser, resolveTier }) {
  const allowed = async wallet => { const t = resolveTier(wallet, await getUser(wallet)); return t.tier === "pro" || t.tier === "vip" || t.whitelisted; };
  app.post("/api/velocity/start", requireOwner, async (req, res) => {
    try {
      const { wallet, settings } = req.body || {};
      if (!(await allowed(wallet))) return res.status(403).json({ error: "Pro or VIP required to run velocity" });
      const tw = await getTradingWallet(wallet);
      if (!tw?.secret) return res.status(400).json({ error: "No trading wallet; create one first" });
      res.json(await hub.start({ wallet, secret: tw.secret, settings: settings || {} }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/velocity/stop", requireOwner, async (req, res) => { try { res.json(await hub.stop(req.body.wallet)); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post("/api/velocity/halt", requireOwner, async (req, res) => { try { res.json(await hub.halt(req.body.wallet, req.body.mode === "freeze" ? "freeze" : "flatten")); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get("/api/velocity/status", requireOwner, (req, res) => res.json({ ok: true, ...hub.status(req.query.wallet), narration: hub.narration(req.query.wallet, 40) }));
  app.get("/api/velocity/health", (req, res) => res.json({ ok: true, users: hub.list().length, feeConfigured: hub.feeOk, feed: hub.feed.status?.() || null }));
}
