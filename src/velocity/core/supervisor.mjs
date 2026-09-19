// ═══ VELOCITY — Supervisor (DP9) ═══
// Heartbeat, feed-staleness watchdog, router health probe, HALT file, and a
// dead-man check. A stale feed or dead router blocks entries for that venue
// while exits keep running. Restart is the process manager's job (systemd, pm2);
// the engine's reconcile() runs before any new risk is taken.

import fs from "node:fs";
import path from "node:path";

export class Supervisor {
  // feedGraceMs: how long a feed that has just come up is left alone. The watchdog runs every two
  // seconds, and two seconds is less than a single poll on Arc or Robinhood Chain, so a feed was
  // being judged before it could possibly have answered: every start blocked both venues and fired
  // a warning about it.
  constructor({ engine, dataDir, clock = () => Date.now(), heartbeatMs = 10_000, watchdogMs = 2_000, deadmanMs = 60_000, feedGraceMs = 30_000, alerter = null }) {
    this.engine = engine;
    this.dataDir = dataDir;
    this.clock = clock;
    this.heartbeatMs = heartbeatMs;
    this.watchdogMs = watchdogMs;
    this.deadmanMs = deadmanMs;
    this.feedGraceMs = feedGraceMs;
    this.alerter = alerter;
    this._timers = [];
    this._beats = 0;
    this.haltFile = path.join(dataDir, "HALT");
    this.heartbeatFile = path.join(dataDir, "heartbeat");
  }

  start() {
    this.heartbeat();
    this._timers.push(setInterval(() => this.heartbeat(), this.heartbeatMs).unref());
    this._timers.push(setInterval(() => {
      // A live order can hold the engine queue for tens of seconds; queued watchdogs would then
      // run back to back and delay exits. One in flight at a time.
      if (this._watchdogPending) return;
      this._watchdogPending = true;
      this.engine.enqueue(() => this.watchdog().finally(() => { this._watchdogPending = false; }));
    }, this.watchdogMs).unref());
  }
  stop() { for (const t of this._timers) clearInterval(t); this._timers = []; }

  heartbeat() {
    const now = this.clock();
    this.engine.store.state.heartbeatAt = now;
    try { fs.writeFileSync(this.heartbeatFile, String(now)); } catch {}
    if (++this._beats % 6 === 0) this.engine.ledger.append({ kind: "heartbeat", positions: this.engine.store.openPositions().length, throttle: this.engine.store.state.throttle });
  }

  async watchdog() {
    const e = this.engine;
    for (const [venue, v] of Object.entries(e.venues)) {
      if (e.store.venueMode(venue) === "off") continue;
      const f = v.feed;
      // Two things were conflated here. "This feed has produced no events" was read as "this feed is
      // broken", and it is not: a chain with no launches in the last few minutes produces no events
      // and is working perfectly. Arc and Robinhood Chain are quiet for minutes at a time, so both
      // sat permanently blocked, an entry arriving on either would have been refused for the two
      // seconds until the next watchdog, and every start wrote a warning saying so.
      //
      // The feed's own verdict is the signal. Each venue calls markHealth(true) on a poll that
      // succeeded and markHealth(false) with the error when one did not, so `healthy` says whether
      // the feed can see its chain -- which is the question -- rather than whether the chain
      // happened to have anything on it.
      const warmingUp = f ? f.running && f.upMs() < this.feedGraceMs : false;
      const feedStale = f ? f.isStale() && f.eventsEmitted > 0 : false;
      const feedDown = f ? f.running && !f.healthy && !warmingUp : false;
      const router = e.routerFor(venue);
      let health = { ok: true };
      if (router?.health) { try { health = await Promise.race([router.health(), new Promise(r => setTimeout(() => r({ ok: false, detail: "health timeout" }), 1_500))]); } catch (err) { health = { ok: false, detail: err.message }; } }
      e.store.state.routers[venue] = { ...health, checkedAt: this.clock() };
      e.store.state.feeds[venue] = { ...(e.store.state.feeds[venue] || {}), stale: feedStale, warmingUp, upMs: f?.upMs() === Infinity ? null : f?.upMs(), ageMs: f?.ageMs() === Infinity ? null : f?.ageMs() };
      const before = e.blocked[venue] || null;
      const reason = feedStale ? "FEED_STALE" : feedDown ? "FEED_DOWN" : !health.ok ? "ROUTER_DOWN" : null;
      if (reason) e.blocked[venue] = reason; else delete e.blocked[venue];
      if (reason !== before) {
        e.ledger.append({ kind: "feed", venue, blocked: reason, detail: reason === "ROUTER_DOWN" ? health.detail : f?.status() });
        if (reason) this.alerter?.send("warn", `${venue}: entries blocked (${reason}); exits keep running`);
      }
    }
    // HALT file: works even when the control server is down.
    if (fs.existsSync(this.haltFile)) {
      const mode = (fs.readFileSync(this.haltFile, "utf8").trim() || "freeze").toLowerCase();
      await e.halt(mode === "flatten" ? "flatten" : "freeze", "HALT file", { by: "file" });
      try { fs.unlinkSync(this.haltFile); } catch {}
    }
  }

  /** For a status reader with no running engine: is the last heartbeat too old? */
  static deadman(dataDir, { now = Date.now(), deadmanMs = 60_000 } = {}) {
    const f = path.join(dataDir, "heartbeat");
    if (!fs.existsSync(f)) return { alive: false, ageMs: null, detail: "no heartbeat file" };
    const at = Number(fs.readFileSync(f, "utf8")) || 0;
    const age = now - at;
    return { alive: age <= deadmanMs, ageMs: age, detail: age <= deadmanMs ? "heartbeat fresh" : `last heartbeat ${Math.round(age / 1000)}s ago` };
  }
}
