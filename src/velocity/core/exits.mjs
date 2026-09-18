// ═══ VELOCITY — Exit plans and monitor (DP5) ═══
// Every position gets its plan at entry from the static table, as a pure
// function of (venue, key). The monitor evaluates the plan on every tick, in
// bondli's layer order for pump.fun, and executes nothing itself: it returns
// an action for the engine to route through DP4.

import { createExitPlan, runExitChecks } from "../../autoape/pipeline.js";

// A repeated plan adjustment may move the plan this far from the one the position was opened with,
// and no further. Below MIN_STOP_PCT a "stop loss" is just the spread.
const MAX_STOP_TIGHTEN = 0.5;  // never tighter than half the designed stop
const MIN_STOP_PCT = 4;        // nor tighter than 4% in absolute terms
const MAX_TP_WIDEN = 3;        // nor a target more than 3x its designed level
import { planFor, dipStopPct } from "./plans.mjs";
import { withClock } from "./pipeline.mjs";
// Arc's Argus trades like a curve from here (a launch, a price walking up one position, buyers and
// sellers, a quote asset), so every price rule applies. It never graduates -- the pool keeps trading
// after the bond tick -- which is why the pre-graduation rule below stays pons-only.
const CURVE = v => v === "pumpfun" || v === "pons" || v === "arc";

export const PUMPFUN_EXIT_SETTINGS = Object.freeze({ momentumExit: true, sl1Sell: 80 });

// How long a held position may go without a readable price before it is sold on that fact alone.
// Shorter than every stall_ms in the plan table: a blind position is worse than a stalled one,
// because a stalled one at least has a stop loss standing behind it.
/** A fading wave only trims a position that has cleared its round trip with room to spare. */
export const WAVE_TRIM_MIN_GAIN_PCT = 8;
export const BLIND_EXIT_MS = 45_000;

export function createPlan({ venue, key, entry = {} }) {
  const base = planFor(venue, key);
  // A dip entry carries the low it bought above, so its stop can sit under that low rather than at
  // the table's round number. Every other entry keeps exactly the stop it had.
  const stopPct = entry.dipLowMcap > 0 ? dipStopPct(base.stop_pct, { entryMcap: entry.mcapUsd, lowMcap: entry.dipLowMcap }) : base.stop_pct;
  if (CURVE(venue)) {
    return {
      venue, key, mode: base.mode, worst_case_fraction: base.worst_case_fraction, max_hold_ms: base.max_hold_ms,
      doa_ms: base.doa_ms ?? null, stall_ms: base.stall_ms ?? null, stall_band_pct: base.stall_band_pct ?? 8,
      bondli: { ...createExitPlan(base.tier ?? Number(key), Number(entry.score) || 0, stopPct ? { ...PUMPFUN_EXIT_SETTINGS, sl2: stopPct } : PUMPFUN_EXIT_SETTINGS), maxHoldMs: base.max_hold_ms },
      settings: { ...PUMPFUN_EXIT_SETTINGS },
    };
  }
  if (venue === "polymarket") {
    const entryPrice = Number(entry.price) || null;
    return {
      venue, key, mode: base.mode, worst_case_fraction: base.worst_case_fraction, max_hold_ms: base.max_hold_ms,
      entry_price: entryPrice,
      stop_price: base.stop_pct != null && entryPrice ? +(entryPrice * (1 - base.stop_pct / 100)).toFixed(4) : null,
      target_price: base.target_pct != null && entryPrice ? +Math.min(0.999, entryPrice * (1 + base.target_pct / 100)).toFixed(4) : null,
    };
  }
  throw new Error(`no plan builder for venue ${venue}`);
}

export function assertHasPlan(position) {
  if (!position?.plan || !position.plan.venue || position.plan.mode == null) throw new Error(`position ${position?.id} has no exit plan`);
  return position.plan;
}

/** Update mark, peak and PnL from a tick. Returns the position. */
export function markPosition(position, tick) {
  const p = tick.payload || {};
  if (CURVE(position.venue)) {
    const mcap = Number(p.mcapUsd) || 0;
    if (mcap > 0) {
      position.mark = mcap;
      position.peak = Math.max(position.peak || position.entryMark || mcap, mcap);
      position.changePct = position.entryMark > 0 ? ((mcap - position.entryMark) / position.entryMark) * 100 : 0;
    }
  } else if (position.venue === "polymarket") {
    const price = Number(p.price ?? p.bestBid) || 0;
    if (price > 0) {
      position.mark = price;
      position.peak = Math.max(position.peak || position.entryMark || price, price);
      position.changePct = position.entryMark > 0 ? ((price - position.entryMark) / position.entryMark) * 100 : 0;
    }
    if (p.resolved) position.resolved = { outcome: p.outcome ?? null, at: tick.t_observed };
  }
  position.unrealized_usd = +(((position.changePct || 0) / 100) * (position.notional_usd || 0)).toFixed(2);
  position.lastTickAt = tick.t_observed;
  return position;
}

/**
 * Evaluate the plan on a tick. Returns null (hold) or
 * { action: SELL|PARTIAL_SELL|REDEEM, pct, reason, layer, detail }.
 * Plan adjustments (WIDEN_TPS, TIGHTEN_SLS) are applied in place and return null.
 */
export function evaluateExit(position, tick, { now = tick.t_observed } = {}) {
  const plan = assertHasPlan(position);
  const held = now - (position.entryTime || now);
  if (CURVE(position.venue)) return evaluatePumpfun(position, tick, plan, now, held);
  if (position.venue === "polymarket") return evaluatePolymarket(position, tick, plan, now, held);
  return null;
}

/**
 * Has this position's peak switched the ride trail on -- is the trail, rather than the clock, the
 * thing that is going to sell it?
 *
 * The test is the arm alone, not the arm and the trigger. Once armed the trail decides every tick
 * one of two ways: the mark is above the trigger and it holds, or the mark is at or below it and it
 * sells this very tick. Re-testing the trigger here would hand the clock exactly the tick the trail
 * was about to act on, and that tick is not a neutral choice -- it decides whether the runner is
 * booked as the trail exit it is, with the moonbag the trail grants it, or as a timeout.
 *
 * The threshold is the trail's own arm and nothing else's: see the note on the time stop below for
 * why this is not the same number as the engine's stall exemption, which is a different question.
 *
 * Read off the same numbers the trail itself uses (src/autoape/exit-plan.js checkTrailingExit): the
 * position's own copy of the plan when it has one, the designed plan before the first tick, and a
 * peak that includes this tick's mark the way runExitChecks recomputes it. No readable price is no
 * answer, and the answer to an unanswerable question is not an exemption -- a blind position is not
 * a runner, so the clock keeps it.
 */
function rideTrailArmed(position, plan, mcapUsd) {
  const tp = position._bondli?.exitPlan?.tpLevels || plan?.bondli?.tpLevels;
  const entry = position.entryMark;
  if (!tp?.ride || !(entry > 0) || !(mcapUsd > 0)) return false;
  const peak = Math.max(position.peak || entry, position._bondli?.peakMcap || 0, mcapUsd);
  return ((peak - entry) / entry) * 100 >= (tp.rideArm ?? 30);
}

function evaluatePumpfun(position, tick, plan, now, held) {
  const p = tick.payload || {};
  const token = p.token ? { ...p.token, mcapUsd: Number(p.mcapUsd) || p.token.mcapUsd || 0, vSolInBondingCurve: Number(p.vSolInBondingCurve) || p.token.vSolInBondingCurve || 0 }
    : { mcapUsd: Number(p.mcapUsd) || 0, vSolInBondingCurve: Number(p.vSolInBondingCurve) || 0 };
  // The time stop needs no price: a token that left the radar or went to zero still gets sold.
  // A moonbag has no time limit: it rides until it dies (-80%) or gives back its own trail.
  // Nor does a position whose trail is armed, for as long as it is armed. A clock is a poor judge of
  // a token that is still running, and this strategy is all right tail: an average win of +24.1%
  // against an average loss of -5.3% only pays because the winners are allowed to get large. Selling
  // a runner at +358% because fifteen minutes elapsed, while the trail that exists to sell it is
  // switched on and has not fired, is the most expensive thing this file can do -- no improvement in
  // win rate buys that gain back. The engine already makes an exemption of this SHAPE for the stall, one
  // evaluator over (engine.mjs:470-474: a position whose peak armed the trail is the trail's to
  // manage, and a quiet feed is not a reason to give it up); the bondli layer this evaluator replaced
  // carried the same guard on the time stop itself (src/autoape/exit-plan.js, checkThresholdExit:
  // its MAX_HOLD_TIME never fires on a position that is up, `changePct < 20`).
  // It cannot widen a loser: a loser never reaches rideArm, and SL1/SL2, DOA, the crash exit and
  // blind-exit all take it out long before this line. And it defers the clock rather than removing
  // it -- past twice max_hold MAX_HOLD fires whatever the position is doing, because a token that
  // goes vertical and then rugs between ticks must not be held for ever, and a position that is
  // deferring is holding one of a handful of slots while it does so.
  //
  // Two bounds worth stating plainly rather than leaving to be discovered. The per-position one is
  // 2x max_hold, which on dip_hold is six hours. Nothing bounds how MANY positions may defer at
  // once, so on a four-slot table all four can sit past their clocks for that long; engine.status()
  // marks each such position `deferring` so an operator can see the table filling rather than infer
  // it from timestamps. And the threshold here is the ride trail's own arm (tp.rideArm, 30%), which
  // is NOT the threshold the engine's stall exemption uses -- that one is stall_band_pct * 1.5, 12%
  // on tier 2. They are two different questions wearing one word: this asks whether the trail will
  // be the thing that sells, the stall's asks whether a quiet position has moved enough to be worth
  // waiting on. A position between 12% and 30% off entry is exempt from the stall and not from the
  // clock, which is the intended order.
  if (held > plan.max_hold_ms && !position._bondli?.isMoonbag && !(held <= plan.max_hold_ms * 2 && rideTrailArmed(position, plan, token.mcapUsd)))
    return { action: "SELL", pct: 100, reason: "MAX_HOLD", layer: 2, detail: `${Math.round(held / 60000)}min` };
  // Blind: the venue is answering, but not with a price for this token -- a reverting curve read, a
  // pool that graduated out from under us, a quote-asset price gap. Every second blind is unbounded
  // downside with no stop loss behind it, because every price rule below this line needs a price.
  // Holding through it is not patience, it is an unmanaged position. Sell after a short grace, well
  // before the time exits, and reset the moment a real price comes back.
  if (!(token.mcapUsd > 0)) {
    if (!position._blindSince) position._blindSince = now;
    const blind = now - position._blindSince;
    if (blind >= (plan.blind_ms ?? BLIND_EXIT_MS)) return { action: "SELL", pct: 100, reason: "blind-exit", layer: 2, detail: `no readable price for ${Math.round(blind / 1000)}s` };
    return null;
  }
  position._blindSince = null;
  const pos = position._bondli || (position._bondli = {
    entryMcap: position.entryMark, peakMcap: position.peak || position.entryMark, tier: Number(plan.key), entryScore: position.entryScore || 0,
    entryTime: position.entryTime, tpHit: 0, slHit: 0, isMoonbag: false,
    // A COPY of the plan, not the plan. Plan adjustments mutate exitPlan in place; sharing the object
    // meant they also rewrote position.plan.bondli, so the record of the plan the position was opened
    // with was silently edited by the position itself -- and any bound measured against "the designed
    // plan" was measured against a value that had already moved.
    exitPlan: { ...plan.bondli, tpLevels: { ...plan.bondli.tpLevels } },
  });
  // The engine marks the position on every tick, including ticks that never reach this evaluator;
  // its peak is the truth the trailing stops measure from.
  if (position.peak > (pos.peakMcap || 0)) pos.peakMcap = position.peak;
  // PONS: once the curve completes, sells go to a Uniswap V4 pool the router does not speak. Everything
  // is sold at 85% progress, whatever the P&L, because a token held through graduation cannot be sold by the bot.
  if (position.venue === "pons" && Number(token._curvePct) >= 0.85 && !token.graduated) return { action: "SELL", pct: 100, reason: "pre-graduation-exit", layer: 4, detail: `curve ${Math.round(Number(token._curvePct) * 100)}%: the bot cannot sell after graduation` };
  // Dead on arrival: nobody followed us in.
  //
  // Seconds after a fill the price is mostly our own impact, so it is not evidence. Whether anyone
  // ELSE has bought since is, and a launch nobody joins in its first seconds is not about to be
  // joined. This is the cheap half of the trade-off: cutting one of these flat costs a round trip
  // (3.5% of a $25 stake), where letting it turn into a crash-exit cost 7.2% on average over the last
  // forty closes. What it must never do is cut a winner, so it needs an ABSENCE of participation and
  // a price that has not moved -- a blanket time cut here would take the average win from +24% to
  // nothing and flip the edge negative.
  // It owns the position only from doa_ms until the stall window opens; after that the slower test,
  // with its longer view of the trade flow, is the better judge and the more accurate label.
  if (plan.doa_ms && held >= plan.doa_ms && held < (plan.stall_ms ?? Infinity) && (pos.tpHit || 0) === 0) {
    const band = plan.stall_band_pct;
    const chg = position.entryMark > 0 ? ((token.mcapUsd - position.entryMark) / position.entryMark) * 100 : 0;
    const peakPct = position.entryMark > 0 ? ((pos.peakMcap - position.entryMark) / position.entryMark) * 100 : 0;
    // Buys that landed after ours. One is allowed for our own fill appearing in the feed.
    const joined = (token.trades || []).filter(t => t.side === "buy" && (t.time || 0) > position.entryTime).length;
    // Inside the band on BOTH sides. A position already well under water is a loser, and the stop
    // loss is the right thing to handle it and the right name to book it under; DOA is specifically
    // for the case where nothing at all has happened.
    if (joined <= 1 && Math.abs(chg) <= band && peakPct < band)
      return { action: "SELL", pct: 100, reason: "DOA", layer: 2, detail: `${Math.round(held / 1000)}s, ${joined} joined, ${chg.toFixed(1)}%` };
  }
  // Dead money: old enough, never left the band around entry (peak included), and nobody is buying.
  // A token that does not move in its first minutes on a curve is not about to; the slot is worth more.
  if (plan.stall_ms && held >= plan.stall_ms && (pos.tpHit || 0) === 0) {
    const band = plan.stall_band_pct, chg = position.entryMark > 0 ? ((token.mcapUsd - position.entryMark) / position.entryMark) * 100 : 0;
    const peakPct = position.entryMark > 0 ? ((pos.peakMcap - position.entryMark) / position.entryMark) * 100 : 0;
    const recentBuys = (token.trades || []).filter(t => t.side === "buy" && now - (t.time || 0) <= 60_000).length;
    // Flat IS a reason to sell, because a slot is not free. Entries are capped (MAX_CONCURRENT), so a
    // position drifting inside the band for minutes is not costless holding -- it is one of a handful
    // of slots withheld from the next candidate, for the whole of max_hold. The round trip that exit
    // pays is ~$0.12 since the rent is reclaimed; a blocked slot for ten minutes costs more than that.
    // What the stall must still not do is sell something that is working: a token nobody is buying,
    // whose peak never armed the trail, is not working.
    if (Math.abs(chg) <= band && peakPct < band * 1.5 && recentBuys <= 2) return { action: "SELL", pct: 100, reason: "STALL", layer: 2, detail: `${Math.round(held / 60000)}min, ${chg.toFixed(0)}%, ${recentBuys} buys/min` };
  }
  // The wave is fading: the copies that were landing every minute have stopped, which means the crowd
  // that discovers a narrative through its copies has arrived and the leader's best bid is behind it.
  // Half comes off while it is still green, once; the ladder below keeps the rest. Never on a loser
  // (the stop loss owns that) and never inside the wave's first minutes, when a quiet window is noise.
  const wave = p.qf?._wave;
  if (wave?.fading && wave.copies >= 2 && !pos.waveTrimmed && held >= 2 * (wave.windowMs || 180_000)) {
    const chg = position.entryMark > 0 ? ((token.mcapUsd - position.entryMark) / position.entryMark) * 100 : 0;
    if (chg >= WAVE_TRIM_MIN_GAIN_PCT) { pos.waveTrimmed = true; return { action: "PARTIAL_SELL", pct: 50, reason: "wave-fade", layer: 3, detail: `${wave.copies} copies, none in ${Math.round((wave.windowMs || 180_000) / 60_000)}m, +${chg.toFixed(0)}%`, stamp: { tpHit: Math.max(pos.tpHit || 0, 1) } }; }
  }
  pos.liveScore = Number(p.scores?.apeScore ?? pos.liveScore ?? pos.entryScore) || 0;
  pos.liveUB = token.uniqueBuyers?.size ?? pos.liveUB ?? 0;
  pos.liveBuys = token.buys ?? pos.liveBuys ?? 0;
  const r = withClock(now, () => runExitChecks(pos, token, p.dynamics || null, plan.settings));
  position.peak = pos.peakMcap;
  if (!r) return null;
  // Both adjustments fire on a CONDITION, not an event, so they repeat on every tick the condition
  // holds and compound. Unbounded, a score that sits 10 points below entry takes a 10% stop to 0.32%
  // in twelve ticks, and a trend that reads "rising" takes a 35% target past 200%. Each is bounded
  // against the plan the position was opened with: the plan may be adjusted, not replaced.
  const designed = position.plan?.bondli;
  if (r.action === "WIDEN_TPS") {
    const tp = pos.exitPlan.tpLevels, d = designed?.tpLevels || tp, m = r.multiplier || 1.25;
    const cap = (v, base) => Math.min(Math.round(v * m), Math.round((base || v) * MAX_TP_WIDEN));
    pos.exitPlan.tpLevels = { ...tp, tp1: cap(tp.tp1, d.tp1), tp2: cap(tp.tp2, d.tp2), tp3: tp.tp3 ? cap(tp.tp3, d.tp3) : 0 };
    position.planAdjustments = (position.planAdjustments || []).concat({ at: now, ...r });
    return null;
  }
  if (r.action === "TIGHTEN_SLS") {
    const floor = Math.max(MIN_STOP_PCT, (designed?.stopLoss || pos.exitPlan.stopLoss) * MAX_STOP_TIGHTEN);
    pos.exitPlan.stopLoss = +Math.max(floor, pos.exitPlan.stopLoss * (r.multiplier || 0.75)).toFixed(2);
    position.planAdjustments = (position.planAdjustments || []).concat({ at: now, ...r });
    return null;
  }
  if (r.action === "PARTIAL_SELL") {
    // These stamps describe a position that has been REDUCED, so they are handed to the caller to
    // apply once the sell actually lands (see applyExitStamp). Stamping them here marked a position
    // that still holds everything: isMoonbag turns off the stop loss, the max hold, the sweeper's
    // time stop and the stall, so a RIDE-trail partial that failed to send left the FULL position
    // with no way out short of -80%.
    const stamp = {};
    if (/^TP1|trailing|fade-trim|momentum-trim/.test(r.reason)) stamp.tpHit = Math.max(pos.tpHit, 1);
    if (r.reason === "TP2") stamp.tpHit = Math.max(pos.tpHit, 2);
    if (r.reason === "TP3" || (/^(TP-trail|RIDE-trail)$/.test(r.reason) && r.moonbag)) { stamp.tpHit = 3; stamp.isMoonbag = !!r.moonbag; }
    if (r.reason === "SL1") stamp.slHit = 1;
    // Everything else that takes some off is stamped too, by default rather than by name. A rule
    // that says "sell a quarter and keep the rest" only means that if something remembers it fired:
    // volume-sell, pre-graduation-profit and brad-partial left no mark, so on the next tick the same
    // condition was still true, they sold a quarter of what was LEFT, and a token that ran drained
    // itself to nothing over a couple of minutes of ticks. SL1 is the one exclusion, by name: a
    // position 13% under water has not taken profit, and saying it has hands the stop's remaining
    // job to the post-TP1 rules and tells every other reader of tpHit that this one is a winner.
    if (stamp.tpHit == null && stamp.slHit == null) stamp.tpHit = Math.max(pos.tpHit || 0, 1);
    return { action: "PARTIAL_SELL", pct: r.pct, reason: r.reason, layer: r.layer, detail: r.detail || null, stamp };
  }
  return { action: "SELL", pct: 100, reason: r.reason, layer: r.layer, detail: r.detail || null };
}

function evaluatePolymarket(position, tick, plan, now, held) {
  const p = tick.payload || {};
  if (p.resolved || position.resolved) return { action: "REDEEM", pct: 100, reason: "RESOLVED", layer: 0, detail: p.outcome ?? null };
  const price = Number(p.price ?? p.bestBid) || position.mark || 0;
  if (plan.stop_price != null && price > 0 && price <= plan.stop_price) return { action: "SELL", pct: 100, reason: "STOP", layer: 2, detail: `${price} <= ${plan.stop_price}` };
  if (plan.target_price != null && price > 0 && price >= plan.target_price) return { action: "SELL", pct: 100, reason: "TARGET", layer: 3, detail: `${price} >= ${plan.target_price}` };
  if (held > plan.max_hold_ms) return { action: plan.mode === "hold_to_redeem" ? "SELL" : "SELL", pct: 100, reason: "MAX_HOLD", layer: 2, detail: `${Math.round(held / 3_600_000)}h` };
  return null;
}

/** Apply the marks a partial exit earns, once its sell has actually landed. */
export function applyExitStamp(position, stamp) {
  if (!stamp || !position?._bondli) return;
  const pos = position._bondli;
  if (stamp.tpHit != null) pos.tpHit = Math.max(pos.tpHit || 0, stamp.tpHit);
  if (stamp.slHit != null) pos.slHit = Math.max(pos.slHit || 0, stamp.slHit);
  if (stamp.isMoonbag != null) pos.isMoonbag = !!stamp.isMoonbag;
}
