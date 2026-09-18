// ═══ VELOCITY — Meta-governor (DP7) ═══
// Reads the ledger, never the market. Detects the systematic errors BRAD's L2
// names (overconfidence, revenge trading, regime blindness, winner bias, loss
// aversion, recency bias, concentration) plus bondli's tilt levels, and turns
// them into one throttle in [0,1] and one halt flag. It can shrink and stop.
// It can never grow: the caps live in the risk envelope and are not its to touch.

import { TiltDetector } from "../../engine/tilt-detector.mjs";
import { withClock } from "./pipeline.mjs";

// bondli's regime engine says EUPHORIA is 1.5x. A governor cannot amplify, so it is 1.0 here.
export const REGIME_MULT = Object.freeze({ EUPHORIA: 1.0, RISK_ON: 1.0, GRINDING: 0.7, PVP: 0.4, DEAD: 0 });

export class Governor {
  constructor({ ledger, envelope, clock = () => Date.now(), venueMode = null, anyLive = null, config = {} } = {}) {
    this.ledger = ledger;
    this.env = envelope;
    this.clock = clock;
    // How the governor tells a receipt from a model's opinion. Both are readers rather than values
    // because a venue is promoted while the engine is running; see _outcomes.
    this.venueMode = venueMode;
    this.anyLive = anyLive;
    this.cfg = {
      dailyFloorThrottle: 0.25,      // the smallest the daily-loss taper shrinks a stake to; never zero
      dailyBreakerMult: 3,           // x the daily limit in one day: a fault, and the only hard stop left
      streakThrottle: { 3: 0.5, 4: 0.25 },
      maxConsecutiveLosses: 5,
      revengeWindowMs: 120_000,
      revengeCount: 2,
      confidenceGapMax: 0.15,
      minOutcomesForCalibration: 20,
      recencyWindow: 5,
      lossAversionRatio: 2.0,
      lookback: 200,
      ...config,
    };
    this.tilt = new TiltDetector();
    this._tiltFedSeq = 0;
    this._tiltSig = null;
    this.last = null;
  }

  // Every brake below -- overconfidence, tilt, the losing-streak count, the recency check, loss
  // aversion -- is fed from this one pool, and until now the pool was every close in the ledger
  // whether or not the money was real. The hosted default makes that the normal shape rather than a
  // corner case: hub.start leaves a venue in paper when its preflight fails, so a user funded in SOL
  // but not in ETH runs pump.fun live beside PONS in simulation, and each imaginary PONS loss was
  // quartering the stake on their real pump.fun entries. The leak the house rule is actually about
  // is the other direction: a simulated hot streak lifting a brake that the live record had not
  // earned. Nothing here can grow a stake -- the ceiling is 1.0, the unthrottled default -- so the
  // whole of this is removing a brake that was resting on fiction.
  //
  // The rule is the one realizedToday and the day counters already keep: as soon as any real money
  // is at work the governor hears only from live closes, and an all-paper run is still governed by
  // its own simulated ones, or the record the promote gate reads would be of a bot trading without
  // brakes. Within that, a venue's closes are read back only in the mode it is in now, exactly as
  // engine.modeStats does, so the paper closes a venue earned before its go-live do not follow it
  // across. An outcome whose venue cannot be resolved is evidence about neither book.
  /** True once any real money is at work, which is when simulated records stop being evidence. A
   *  bare governor has no reader, and a missing reader must fail toward the stricter answer. */
  _liveRunning() { return typeof this.anyLive === "function" ? !!this.anyLive() : true; }

  /** The same mode test the outcome pool applies, for any record that carries a venue and a `paper`
   *  flag. A venue's records are read back only in the mode it is in NOW, so the paper closes a venue
   *  earned before its go-live do not follow it across. */
  _inBook(r) {
    if (!r) return false;
    const mode = this.venueMode;
    if (typeof mode !== "function") return r.paper !== true;
    return !!r.venue && !!r.paper === (mode(r.venue) === "paper") && (!this._liveRunning() || r.paper !== true);
  }

  /** The ledger applies its limit BEFORE any of this filtering, so asking for exactly `lookback`
   *  records and then dropping the simulated ones leaves a live pool of roughly lookback/venues. The
   *  overconfidence brake needs twenty closes before it will speak at all, so on a mixed run where
   *  the paper venues are busier the brake could switch itself off without saying so. Ask wide,
   *  filter, then take the newest `lookback` of what is actually in this book. */
  _pool(kind, extra = null) {
    const wide = this.ledger.query({ kind, limit: this.cfg.lookback * 4 }).filter(r => this._inBook(r) && (!extra || extra(r)));
    return wide.slice(-this.cfg.lookback);
  }

  _outcomes() {
    const mode = this.venueMode;
    const out = this.ledger.query({ kind: "outcome", limit: this.cfg.lookback * 4 });
    // A bare governor has no reader. A missing reader must fail toward the stricter answer, so
    // simulated closes are dropped rather than trusted.
    if (typeof mode !== "function") return out.filter(o => o && o.paper !== true).slice(-this.cfg.lookback);
    return out.filter(o => this._inBook(o)).slice(-this.cfg.lookback);
  }

  /** Which book the detector is holding: whether real money is at work, and what mode each venue in
   *  the pool is in now. This changes when, and only when, a venue is promoted or retired -- which is
   *  the one event that invalidates what the detector has already heard. */
  _modeSignature(outcomes) {
    const mode = this.venueMode;
    const venues = [...new Set(outcomes.map(o => o?.venue).filter(Boolean))].sort();
    return `${this._liveRunning() ? "live" : "paper"}|${venues.map(v => `${v}:${typeof mode === "function" ? mode(v) : "?"}`).join(",")}`;
  }

  _feedTilt(outcomes) {
    // Promoting a venue takes its simulated closes out of the pool, and a detector that had already
    // heard them would be holding both books at once -- the exact mixing the filter above exists to
    // stop. It is a pure function of the closes fed to it, so it is rebuilt when the book changes.
    //
    // What it is NOT rebuilt on is the pool sliding. The previous watermark compared the seq of the
    // last record the detector had heard against the record at that INDEX, and once the pool reaches
    // cfg.lookback that index holds a different record on every close: measured on a saturated
    // live-only pool, the detector was torn down and re-fed two hundred records on every one of the
    // five-second evaluations. That is not just waste -- rebuilding re-anchors the detector's clock
    // on the oldest close in the window, so its "session" P&L quietly stopped meaning the session and
    // started meaning the last two hundred closes. A monotone sequence watermark cannot slide.
    const sig = this._modeSignature(outcomes);
    if (this._tiltSig !== sig) {
      withClock(outcomes[0]?.ts || this.clock(), () => { this.tilt = new TiltDetector(); });
      this._tiltSig = sig;
      this._tiltFedSeq = 0;
    }
    // TiltDetector timestamps with Date.now(); pin it to each outcome's time.
    for (const o of outcomes) {
      const seq = Number(o.seq) || 0;
      if (seq && seq <= this._tiltFedSeq) continue;
      withClock(o.ts || o.closedAt || this.clock(), () => this.tilt.recordTrade({ pnl: o.pnl_usd, pnlPct: o.pnl_pct, size: o.stake_usd, score: (o.confidence || 0) * 100 }));
      if (seq > this._tiltFedSeq) this._tiltFedSeq = seq;
    }
  }

  evaluate({ regime = "RISK_ON", realized_today_usd = 0, open = [] } = {}) {
    const outcomes = this._outcomes();
    this._feedTilt(outcomes);
    const reasons = [];
    const spots = {};
    const mults = [];
    let halt = false, haltReason = null;
    const flag = (name, severity, detail, mult = null) => {
      spots[name] = { triggered: true, severity: +severity.toFixed(2), detail };
      reasons.push(`${name}: ${detail}`);
      if (mult != null) mults.push(mult);
    };
    const stop = (name, detail) => { halt = true; haltReason = haltReason || name; flag(name, 1, detail, 0); };

    // Daily loss: halt before the limit, counting open worst case.
    const limit = this.env.daily_loss_limit_usd;
    const realizedLoss = Math.max(0, -realized_today_usd);
    const openRisk = open.reduce((s, p) => s + (p.notional_usd || 0) * (p.worst_case_fraction ?? 1), 0);
    // A cliff was the wrong shape for this. Halting at 80% of the limit locked the bot out for the
    // rest of the UTC day over a loss it could plausibly have traded back at a smaller size, and it
    // fired on an ordinary bad hour because the limit is sized for a day. It also refused every
    // candidate loudly, which told the operator nothing they could act on.
    //
    // The limit is now a taper, not a gate: from half the limit onwards the stake shrinks smoothly
    // toward dailyFloorThrottle and stays there. Losing more always means betting less, at every
    // point, with no step to game and no lockout to wait out. Open risk counts against the taper the
    // same as realized loss, because money at risk is money that can still be lost today.
    //
    // The one remaining hard stop is a circuit breaker, not a trading rule: dailyBreakerMult times
    // the limit in a single day is not a losing session, it is something broken -- a mispriced venue,
    // a sell path that cannot sell, a feed lying about a price -- and the right response to that is
    // to stop and be looked at.
    const exposure = realizedLoss + openRisk;
    const breaker = limit * this.cfg.dailyBreakerMult;
    if (realizedLoss >= breaker) {
      stop("daily_breaker", `realized loss ${realizedLoss.toFixed(2)} is ${this.cfg.dailyBreakerMult}x the daily limit of ${limit}; that is a fault, not a drawdown`);
    } else if (exposure > limit * 0.5) {
      // 0.5x the limit -> 1.0, 1.0x -> the floor, and flat at the floor beyond that.
      const over = Math.min(1, (exposure / limit - 0.5) / 0.5);
      const mult = 1 - over * (1 - this.cfg.dailyFloorThrottle);
      flag("daily_limit", Math.min(1, exposure / limit),
        `${exposure.toFixed(2)} of the ${limit} daily limit is spent (${realizedLoss.toFixed(2)} realized, ${openRisk.toFixed(2)} still open); stakes at ${Math.round(mult * 100)}%`,
        +mult.toFixed(3));
    }

    // Losing streak: counted and shown, never a brake. On a curve venue the base rate is a 25-35%
    // win rate, so five losses in a row is an ordinary week of Tuesdays; a halt here with no
    // cooldown froze the bot for good after six trades. The daily loss limit is the only money brake.
    let streak = 0;
    for (let i = outcomes.length - 1; i >= 0; i--) { if (outcomes[i].pnl_usd < 0) streak++; else break; }
    if (streak >= 3) spots.losing_streak = { triggered: false, severity: Math.min(1, streak / 8), detail: `${streak} consecutive losses (informational)` };

    // Overconfidence: stated p_win vs realized win rate.
    if (outcomes.length >= this.cfg.minOutcomesForCalibration) {
      const stated = outcomes.reduce((s, o) => s + (Number(o.p_win) || 0), 0) / outcomes.length;
      const realized = outcomes.filter(o => o.pnl_usd > 0).length / outcomes.length;
      const gap = stated - realized;
      // The wider the gap, the smaller the stake: half at the threshold, a quarter when the realized rate
      // is under half the stated one. Size is what the gap costs; entries still happen.
      if (gap > this.cfg.confidenceGapMax) flag("overconfidence", Math.min(1, gap / 0.3), `stated ${stated.toFixed(2)} vs realized ${realized.toFixed(2)}${realized < stated / 2 ? "; the edge is not showing up, sizes cut to a quarter" : ""}`, realized < stated / 2 ? 0.25 : 0.5);
    }

    // Revenge trading: a bigger entry right after a loss, repeatedly.
    //
    // The BUYS are filtered the same way the outcome pool is. They were not, and on the ordinary
    // hosted shape -- pump.fun live beside PONS in paper because its preflight failed -- a simulated
    // PONS buy landing within two minutes of a real pump.fun loss counted as revenge, and two of them
    // halved the stake on real entries. Half a rule applied to real money and imaginary money at once
    // fails in exactly the direction it exists to prevent.
    const entries = this._pool("fill", f => f.side === "BUY");
    let revenge = 0;
    for (const o of outcomes.filter(o => o.pnl_usd < 0)) {
      const next = entries.find(e => e.ts > o.ts && e.ts - o.ts <= this.cfg.revengeWindowMs && e.notional_usd > (o.stake_usd || 0) * 1.2);
      if (next) revenge++;
    }
    if (revenge >= this.cfg.revengeCount) flag("revenge_trading", Math.min(1, revenge / 4), `${revenge} larger re-entries within ${this.cfg.revengeWindowMs / 1000}s of a loss`, 0.5);

    // Recency bias: a hot last-few would tempt sizing up; base rate says otherwise.
    if (outcomes.length >= this.cfg.recencyWindow * 4) {
      const recent = outcomes.slice(-this.cfg.recencyWindow);
      const rWin = recent.filter(o => o.pnl_usd > 0).length / recent.length;
      const bWin = outcomes.filter(o => o.pnl_usd > 0).length / outcomes.length;
      if (rWin - bWin > 0.4) flag("recency_bias", rWin - bWin, `last ${recent.length} won ${Math.round(rWin * 100)}% vs base ${Math.round(bWin * 100)}%`, 0.8);
    }

    // Loss aversion / winner bias: losers held far longer than winners.
    const losers = outcomes.filter(o => o.pnl_usd < 0 && o.held_ms), winners = outcomes.filter(o => o.pnl_usd > 0 && o.held_ms);
    if (losers.length >= 5 && winners.length >= 5) {
      const avg = a => a.reduce((s, o) => s + o.held_ms, 0) / a.length;
      const ratio = avg(losers) / Math.max(1, avg(winners));
      if (ratio > this.cfg.lossAversionRatio) flag("loss_aversion", Math.min(1, ratio / 4), `losers held ${ratio.toFixed(1)}x longer than winners`, 0.8);
    }

    // Concentration: informational; the sizer already blocks the group cap.
    const groups = {};
    for (const p of open) if (p.group) groups[p.group] = (groups[p.group] || 0) + 1;
    const crowded = Object.entries(groups).filter(([, n]) => n >= this.env.max_per_group);
    if (crowded.length) flag("concentration_risk", 0.5, `${crowded.map(([g, n]) => `${g}:${n}`).join(", ")} at the per-group cap`);

    // Tilt (bondli): level 3 halves size, level 4 halts.
    const tilt = this.tilt.getStatus();
    // Tilt shrinks size, never stops the bot: the daily limit is the stop.
    if (tilt.tiltLevel >= 4) flag("tilt", 1, `tilt level 4: sizes halved (session pnl ${(tilt.stats?.sessionPnl ?? 0).toFixed(2)} USD)`, 0.5);
    else if (tilt.tiltLevel === 3) flag("tilt", 0.75, "tilt level 3: sizes halved", 0.5);
    else if (tilt.tiltLevel > 0) spots.tilt = { triggered: false, severity: tilt.tiltLevel / 4, detail: `tilt level ${tilt.tiltLevel}` };

    // Regime blindness: the regime sets the ceiling.
    const regimeMult = REGIME_MULT[regime] ?? 1;
    if (regimeMult === 0) stop("regime", `regime ${regime}: no entries`);
    else if (regimeMult < 1) flag("regime", 1 - regimeMult, `regime ${regime} caps activity at ${regimeMult}`, regimeMult);

    const throttle = halt ? 0 : Math.max(0, Math.min(1, ...mults, 1));
    this.last = { throttle: +throttle.toFixed(3), halt, haltReason, reasons, blindSpots: spots, regime, regimeMult, tiltLevel: tilt.tiltLevel, streak, outcomes: outcomes.length, at: this.clock() };
    return this.last;
  }
}
