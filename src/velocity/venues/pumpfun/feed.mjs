// ═══ VELOCITY — pump.fun feed (DP1) ═══
// Candidates come from bondli's own radar and scorer (GET /api/radar/scored),
// so the 40+ feature scorer is reused rather than rebuilt. Ticks for held
// tokens come from the same endpoint filtered by ca, and optionally from
// PumpPortal's trade stream for sub-second marks.

import { Feed } from "../../core/feed.mjs";

export function hydrateToken(raw) {
  // The gates read token.uniqueBuyers.size (a Set in-process). Over JSON it is a count.
  const t = { ...raw };
  const n = typeof raw.uniqueBuyers === "number" ? raw.uniqueBuyers : raw.uniqueBuyers?.size || 0;
  t.uniqueBuyers = { size: n };
  t.trades = Array.isArray(raw.trades) ? raw.trades : [];
  t.spark = Array.isArray(raw.spark) ? raw.spark : [];
  return t;
}

/** Pure: turn one /api/radar/scored response into candidate payloads. */
export function parseScoredResponse(json) {
  const solPrice = Number(json?.solPrice) || 0;
  const rows = Array.isArray(json?.tokens) ? json.tokens : [];
  return rows
    .filter(r => r?.token?.ca)
    .map(r => ({
      id: r.token.ca,
      t_venue: Number(r.t_venue) || Number(r.token.createdAt) || Number(json.ts) || Date.now(),
      payload: {
        token: hydrateToken(r.token),
        qf: r.qf || null,
        scores: r.scores || { apeScore: r.token._apeScore || 0 },
        dynamics: r.dynamics || null,
        solPrice,
        mcapUsd: Number(r.token.mcapUsd) || 0,
        vSolInBondingCurve: Number(r.token.vSolInBondingCurve) || 0,
      },
    }));
}

/** Pure: a PumpPortal trade message for a watched mint becomes a tick. */
export function parsePumpPortalTrade(msg, solPrice) {
  if (!msg || !msg.mint || !msg.txType) return null;
  if (msg.txType !== "buy" && msg.txType !== "sell") return null;
  const mcapSol = Number(msg.marketCapSol) || 0;
  return {
    id: msg.mint,
    payload: {
      mcapSol,
      mcapUsd: mcapSol * (solPrice || 0),
      vSolInBondingCurve: Number(msg.vSolInBondingCurve) || 0,
      vTokensInBondingCurve: Number(msg.vTokensInBondingCurve) || 0,
      trade: { side: msg.txType, sol: Number(msg.solAmount) || 0, tokens: Number(msg.tokenAmount) || 0, wallet: msg.traderPublicKey || "", sig: msg.signature || "" },
      source: "pumpportal",
    },
  };
}

export class PumpfunFeed extends Feed {
  constructor({
    bondliUrl = process.env.BONDLI_URL || "http://127.0.0.1:3001",
    minScore = 40,
    pollMs = 2_000,
    tickMs = 1_000,
    pumpportal = false,
    pumpportalUrl = "wss://pumpportal.fun/api/data",
    fetchImpl = globalThis.fetch,
    wsFactory = url => new globalThis.WebSocket(url),
    ...rest
  } = {}) {
    super({ venue: "pumpfun", name: "pumpfun-feed", staleAfterMs: rest.staleAfterMs ?? 6_000, latencyBoundMs: rest.latencyBoundMs ?? 500, clock: rest.clock });
    this.bondliUrl = bondliUrl.replace(/\/$/, "");
    this.minScore = minScore;
    this.pollMs = pollMs;
    this.tickMs = tickMs;
    this.pumpportal = pumpportal;
    this.pumpportalUrl = pumpportalUrl;
    this.fetch = fetchImpl;
    this.wsFactory = wsFactory;
    this.solPrice = 0;
    this._timers = [];
    this._ws = null;
    this.errors = 0;
  }

  async _get(pathname) {
    const res = await this.fetch(`${this.bondliUrl}${pathname}`, { signal: AbortSignal.timeout(Math.max(1_000, this.pollMs)) });
    if (!res.ok) throw new Error(`bondli ${pathname} ${res.status}`);
    return res.json();
  }

  /** One candidate poll. Returns number of candidates emitted. */
  async pollOnce() {
    const json = await this._get(`/api/radar/scored?min=${this.minScore}&limit=100`);
    this.solPrice = Number(json.solPrice) || this.solPrice;
    const rows = parseScoredResponse(json);
    for (const r of rows) this.emitEvent({ kind: "candidate", id: r.id, payload: r.payload, t_venue: r.t_venue });
    this.markHealth(true, `poll ok (${rows.length})`);
    return rows.length;
  }

  /** One tick poll for every watched instrument. */
  async tickOnce() {
    if (!this.watched.size) return 0;
    const cas = [...this.watched].join(",");
    const json = await this._get(`/api/radar/scored?ca=${encodeURIComponent(cas)}`);
    this.solPrice = Number(json.solPrice) || this.solPrice;
    const rows = parseScoredResponse(json);
    for (const r of rows) this.emitEvent({ kind: "tick", id: r.id, payload: { ...r.payload, source: "bondli" }, t_venue: r.t_venue });
    return rows.length;
  }

  _connectPumpPortal() {
    if (!this.pumpportal || !this.running) return;
    try {
      const ws = this.wsFactory(this.pumpportalUrl);
      this._ws = ws;
      ws.onopen = () => { for (const mint of this.watched) ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] })); };
      ws.onmessage = ev => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (!this.watched.has(msg?.mint)) return;
        const tick = parsePumpPortalTrade(msg, this.solPrice);
        if (tick) this.emitEvent({ kind: "tick", id: tick.id, payload: tick.payload });
      };
      ws.onclose = () => { this._ws = null; if (this.running) this._timers.push(setTimeout(() => this._connectPumpPortal(), 5_000)); };
      ws.onerror = () => {};
    } catch (err) {
      this._timers.push(setTimeout(() => this._connectPumpPortal(), 10_000));
    }
  }

  watch(id) {
    super.watch(id);
    if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [String(id)] }));
  }
  unwatch(id) {
    super.unwatch(id);
    if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [String(id)] }));
  }

  async start() {
    this.running = true;
    const loop = (fn, ms) => {
      const tick = async () => {
        if (!this.running) return;
        try { await fn(); this.errors = 0; }
        catch (err) { this.errors++; this.markHealth(false, err.message); }
        if (this.running) this._timers.push(setTimeout(tick, ms));
      };
      tick();
    };
    loop(() => this.pollOnce(), this.pollMs);
    loop(() => this.tickOnce(), this.tickMs);
    this._connectPumpPortal();
  }

  async stop() {
    this.running = false;
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
    try { this._ws?.close(); } catch {}
    this._ws = null;
    this.markHealth(false, "stopped");
  }
}
