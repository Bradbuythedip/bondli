// ═══ VELOCITY — Live state store (DP6) ═══
// One JSON snapshot, written atomically (temp file + rename). Holds what the
// operator needs to see and what a restart needs to reconcile. The ledger is
// the record; this is the current picture. Fewer parts than Redis, same FR.

import fs from "node:fs";
import path from "node:path";

export const HALT_MODES = Object.freeze(["freeze", "flatten"]);
export const VENUE_MODES = Object.freeze(["off", "paper", "live"]);

function defaultState(now) {
  return {
    version: 1,
    startedAt: now,
    savedAt: now,
    heartbeatAt: now,
    reconciledAt: null,
    positions: {},            // positionId -> position
    // instrument -> when it may be bought again, and how many round trips this engine has already
    // paid for on that name. Both are persisted: an in-memory cooldown hands a restarted bot a
    // fresh licence to re-buy the token it just stopped out of, which is the cheapest way to pay
    // the round trip twice for one idea.
    cooldown: {},             // instrument -> until (ms)
    touches: {},              // instrument -> { n, at }
    halt: { mode: null, reason: null, since: null, venues: {} },
    throttle: 1,
    governor: { reasons: [], blindSpots: {} },
    regime: "RISK_ON",
    feeds: {},                // venue -> { lastEventAt, healthy, stale }
    routers: {},              // venue -> { ok, latencyMs, checkedAt }
    venues: {},               // venue -> { mode }
    weightsVersion: 0,
    // probes / paperProbes: "venue|plan_key" -> how many information probes that key has already been
    // sold today. A probe is a trade the gate takes on a guess rather than on a record, so it buys a
    // measurement with real toll; counting it here is what turns that from an open tap into a budget
    // that a day roll refills. Paper keeps its own tally for the same reason it keeps its own P&L:
    // an imaginary probe must never spend the live one.
    day: { date: dayKey(now), realizedUsd: 0, trades: 0, paperRealizedUsd: 0, paperTrades: 0, lossAckUsd: 0, probes: {}, paperProbes: {} },
    alerts: [],
    lastDecisions: [],
  };
}

export function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

export class Store {
  constructor(file, { now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.state = this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) return defaultState(this.now());
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return { ...defaultState(this.now()), ...parsed };
    } catch {
      // A torn snapshot is not fatal: the ledger reconstructs positions.
      return defaultState(this.now());
    }
  }

  save() {
    this.state.savedAt = this.now();
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
    return this.state;
  }

  /** The UTC day's counters, rolling them over first if the date has changed.
   *
   *  This is called on the candidate path as well as the fill path now (the probe budget is read for
   *  every candidate), so the reset can fire from a call that only meant to READ the day. That is
   *  harmless -- the reset is a function of the clock and nothing else, and whoever rolls it first
   *  gets the same fresh counters everyone else would have -- but it is worth knowing that a day can
   *  turn over without any money having moved. */
  /** When the current UTC day ends. A name retired for the day comes back when the loss budget and
   *  the statistics do, which is the same moment. */
  dayEndsAt(now = this.now()) { const d = new Date(now); d.setUTCHours(24, 0, 0, 0); return d.getTime(); }

  rollDay() {
    const key = dayKey(this.now());
    // Paper and live are counted apart. They fund the same daily loss limit only when there is no
    // live venue at all, and then it is the simulation's own limit.
    if (this.state.day.date !== key) this.state.day = { date: key, realizedUsd: 0, trades: 0, paperRealizedUsd: 0, paperTrades: 0, lossAckUsd: 0, probes: {}, paperProbes: {} };
    if (this.state.day.paperRealizedUsd == null) { this.state.day.paperRealizedUsd = 0; this.state.day.paperTrades = 0; } // an older state file
    // Same reason, and it matters more: a missing map here would be read as "no probes drawn" by one
    // caller and crash the next, so a state file written before budgets existed gets its empty ones.
    if (!this.state.day.probes) this.state.day.probes = {};
    if (!this.state.day.paperProbes) this.state.day.paperProbes = {};
    this.pruneCooldowns();
    return this.state.day;
  }

  // ── positions ──
  openPositions(venue = null) {
    return Object.values(this.state.positions).filter(p => p.status === "open" && (!venue || p.venue === venue));
  }
  upsertPosition(pos) {
    this.state.positions[pos.id] = pos;
    return pos;
  }

  /** Closed positions are kept so a restart can still answer questions about them, but not forever:
   *  this map is written to disk on every save, and an account that trades for months would carry
   *  every position it ever had in one JSON file. The open ones are never touched. */
  prunePositions(keepClosed = 200) {
    const closed = Object.values(this.state.positions).filter(p => p.status !== "open")
      .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
    let dropped = 0;
    for (const p of closed.slice(keepClosed)) { delete this.state.positions[p.id]; dropped++; }
    return dropped;
  }

  /** Expired cooldowns and the touch counts behind them, dropped on the day roll. */
  pruneCooldowns(now = this.now()) {
    const cd = this.state.cooldown || (this.state.cooldown = {});
    const tc = this.state.touches || (this.state.touches = {});
    let dropped = 0;
    for (const [inst, until] of Object.entries(cd)) if (!(until > now)) { delete cd[inst]; delete tc[inst]; dropped++; }
    return dropped;
  }
  closePosition(id, patch = {}) {
    const p = this.state.positions[id];
    if (!p) return null;
    Object.assign(p, patch, { status: "closed", closedAt: this.now() });
    return p;
  }

  // ── halt / venues ──
  setHalt(mode, reason, venue = null) {
    if (mode && !HALT_MODES.includes(mode)) throw new Error(`halt mode must be one of ${HALT_MODES.join("|")}`);
    if (venue) this.state.halt.venues[venue] = mode ? { mode, reason, since: this.now() } : undefined;
    else this.state.halt = { mode, reason, since: mode ? this.now() : null, venues: this.state.halt.venues || {} };
    return this.state.halt;
  }
  isHalted(venue = null) {
    if (this.state.halt.mode) return this.state.halt;
    if (venue && this.state.halt.venues?.[venue]) return this.state.halt.venues[venue];
    return null;
  }
  setVenueMode(venue, mode, extra = {}) {
    if (!VENUE_MODES.includes(mode)) throw new Error(`venue mode must be one of ${VENUE_MODES.join("|")}`);
    this.state.venues[venue] = { ...(this.state.venues[venue] || {}), mode, since: this.now(), ...extra };
    return this.state.venues[venue];
  }
  venueMode(venue) {
    return this.state.venues[venue]?.mode || "off";
  }

  noteDecision(decision) {
    this.state.lastDecisions.unshift({
      id: decision.id, venue: decision.venue, instrument: decision.instrument, action: decision.action,
      gate: decision.gate, reason: (decision.reasons || [])[0] || null, waived: (decision.reasons || []).find(r => /^momentum waived /.test(r)) || null, ts: decision.t_decided,
    });
    if (this.state.lastDecisions.length > 20) this.state.lastDecisions.length = 20;
  }

  alert(level, text) {
    const a = { level, text, ts: this.now() };
    this.state.alerts.unshift(a);
    if (this.state.alerts.length > 50) this.state.alerts.length = 50;
    return a;
  }
}
