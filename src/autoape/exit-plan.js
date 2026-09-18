// ═══ EXIT PLAN — Pre-Attached at Entry ═══
// Every position enters with its death already planned.
// 4 layers: Derivatives, Absolute Thresholds, Trailing Profits, Graduation.

// The stop each tier is DESIGNED to lose, in percent. Exported because it is not only the exit's
// business any more: the entry gate has to know how big a loss the plan it is about to attach is
// actually aiming at, so that it can tell a refusal caused by a guessed loss size from one caused by
// a cost it has measured. Two copies of this table would let those two answers drift apart.
export const STOP_LOSSES = Object.freeze({ 1: 15, 2: 12, 3: 10 });

// Creates an exit plan based on confidence tier
export function createExitPlan(tier, entryScore, settings) {
  const s = { ...settings };

  // Tier-specific stop losses, with the operator's own override if they set one.
  const stops = { 1: s.sl2 || STOP_LOSSES[1], 2: s.sl2 || STOP_LOSSES[2], 3: s.sl2 || STOP_LOSSES[3] };
  const MAX_HOLDS = { 1: 30 * 60000, 2: 15 * 60000, 3: 10 * 60000 }; // 30/15/10 min

  // Tier-specific take profit levels
  // Ride mode (the default): no partial take-profits. The stop loss cuts a loser fast and the trail
  // takes a winner out in ONE sell, which is what makes the token account closable and its rent
  // reclaimable. Scalping a third of the position at +35% costs a transaction, gives up the right
  // tail, and at these stakes the ladder's fixed cost is a larger drag than the profit it locks.
  // The whole edge here is asymmetry: small losses, and a winner ridden until it actually rolls over.
  // rideArm: the gain at which the trail switches on, below which only the stop loss can fire.
  // rideFloor: the trail can never trigger an exit below this, so a trail never books a loss.
  const ride = s.ride === false ? false : true;
  const GRADUATED_TPS = {
    // A token that actually mooned (peak >= 2x) still keeps a moonbag: a runner is never sold to zero.
    1: { ride, rideArm: 30, rideFloor: 6, tp1: s.tp1 || 35, tp1Sell: 20, tp2: s.tp2 || 100, tp2Sell: 20, tp3: s.tp3 || 250, tp3Sell: 25, moonbagPct: 20, trailWidth: 40 },
    2: { ride, rideArm: 30, rideFloor: 6, tp1: s.tp1 || 35, tp1Sell: s.tp1Sell || 30, tp2: s.tp2 || 100, tp2Sell: s.tp2Sell || 30, tp3: s.tp3 || 250, tp3Sell: s.tp3Sell || 40, moonbagPct: 15, trailWidth: 35 },
    3: { ride, rideArm: 25, rideFloor: 6, tp1: Math.round((s.tp1 || 35) * 0.85), tp1Sell: 33, tp2: Math.round((s.tp2 || 100) * 0.75), tp2Sell: 33, tp3: 200, tp3Sell: 34, moonbagPct: 10, trailWidth: 25 },
  };

  return {
    tier,
    entryScore,
    stopLoss: stops[tier] || 12,
    maxHoldMs: MAX_HOLDS[tier] || 15 * 60000,
    tpLevels: GRADUATED_TPS[tier] || GRADUATED_TPS[2],
    // Derivative exit thresholds
    crashVelocity: -0.3,      // dS/dt below this = crashing
    fadeAcceleration: -0.02,   // d²S/dt² below this while fading = exit
    momentumDropAbsolute: tier === 1 ? 40 : 30, // absolute score drop for instant exit
    momentumTrimDrop: 25,      // partial exit on this drop
    momentumTightenDrop: 10,   // tighten SLs on this drop
  };
}

// Layer 1: Derivative-based exits (leading indicators)
export function checkDerivativeExit(pos, dynamics, changePct, settings) {
  if (!dynamics || dynamics.scores < 2) return null;

  const plan = pos.exitPlan || createExitPlan(pos.tier || 2, pos.entryScore || 0, settings);
  const dyn = dynamics;

  // Flash decay: score peaked and freefalling. The score is a derived thing computed off snapshots that
  // can be stale or thin, so on its own it produces exits at a flat price that pay a full round trip
  // for no information. The price has to agree before the money moves: not up on the trade.
  if (dyn.trend === "crashing" && dyn.scores >= 3 && changePct <= 0) {
    return { action: "SELL", pct: 100, reason: "crash-exit", layer: 1, detail: `v=${dyn.velocity?.toFixed(3)} a=${dyn.acceleration?.toFixed(3)} CRASHING at ${changePct.toFixed(0)}%` };
  }

  // Fading: decelerating hard while still showing positive change
  if (dyn.trend === "fading" && dyn.acceleration < plan.fadeAcceleration && dyn.scores >= 3
    && changePct > 5 && (pos.tpHit || 0) === 0) {
    return { action: "PARTIAL_SELL", pct: plan.tpLevels.tp1Sell, reason: "fade-trim", layer: 1, detail: `a=${dyn.acceleration?.toFixed(3)} FADING` };
  }

  // Momentum collapse: velocity negative AND accelerating downward
  const scoreDrop = (pos.entryScore || 0) - (pos.liveScore || pos.entryScore || 0);
  const hasStrongFundamentals = (pos.liveUB || 0) >= 20 && (pos.liveBuys || 0) >= 30 && changePct > 0;
  const momentumExitThreshold = hasStrongFundamentals ? plan.momentumDropAbsolute + 10 : plan.momentumDropAbsolute;

  if (scoreDrop >= momentumExitThreshold && changePct <= 0) {
    return { action: "SELL", pct: 100, reason: "momentum-exit", layer: 1, detail: `score ${pos.entryScore}→${pos.liveScore} (−${scoreDrop}) at ${changePct.toFixed(0)}%` };
  }

  if (scoreDrop >= plan.momentumTrimDrop && changePct > 5 && (pos.tpHit || 0) === 0) {
    return { action: "PARTIAL_SELL", pct: plan.tpLevels.tp1Sell, reason: "momentum-trim", layer: 1, detail: `score −${scoreDrop}` };
  }

  // Runner detection: accelerating score = widen TPs
  if (dyn.trend === "rocket" || (dyn.trend === "rising" && (pos.liveScore || 0) > (pos.entryScore || 0) + 10)) {
    return { action: "WIDEN_TPS", multiplier: dyn.trend === "rocket" ? 1.5 : 1.25, reason: "runner-detected", layer: 1 };
  }

  // Score drop → tighten stops
  if (scoreDrop >= plan.momentumTightenDrop) {
    const tighten = scoreDrop >= 20 ? 0.5 : 0.75;
    return { action: "TIGHTEN_SLS", multiplier: tighten, reason: "score-weakening", layer: 1 };
  }

  return null;
}

// Layer 2: Absolute thresholds (safety net)
export function checkThresholdExit(pos, changePct, settings) {
  const plan = pos.exitPlan || createExitPlan(pos.tier || 2, pos.entryScore || 0, settings);
  const holdTime = Date.now() - (pos.entryTime || Date.now());

  // Stop loss
  if (changePct <= -plan.stopLoss && !pos.isMoonbag) {
    if ((pos.slHit || 0) < 1 && changePct > -(plan.stopLoss * 2)) {
      // SL1: partial exit
      return { action: "PARTIAL_SELL", pct: settings.sl1Sell || 80, reason: "SL1", layer: 2 };
    }
    // SL2: full exit
    return { action: "SELL", pct: 100, reason: "SL2", layer: 2 };
  }

  // Max hold time
  if (holdTime > plan.maxHoldMs && changePct < 20 && !pos.isMoonbag) {
    return { action: "SELL", pct: 100, reason: "MAX_HOLD_TIME", layer: 2, detail: `${Math.round(holdTime / 60000)}min` };
  }

  // Score floor: composite below 40 = dead
  if ((pos.liveScore || pos.entryScore || 50) < 20 && holdTime > 30000) {
    return { action: "SELL", pct: 100, reason: "SCORE_FLOOR", layer: 2 };
  }

  return null;
}

// Layer 3: Trailing profit stops
export function checkTrailingExit(pos, changePct, fromPeak, settings) {
  const plan = pos.exitPlan || createExitPlan(pos.tier || 2, pos.entryScore || 0, settings);
  const tp = plan.tpLevels;

  // Moonbag handling
  if (pos.isMoonbag) {
    if (changePct <= -80) {
      return { action: "SELL", pct: 100, reason: "moonbag-dead", layer: 3 };
    }
    const moonTrail = changePct >= 500 ? 70 : 60;
    if (fromPeak > moonTrail && changePct > 30) {
      return { action: "SELL", pct: 100, reason: "moonbag-trail", layer: 3 };
    }
    return null;
  }

  // Ride mode: one trail, one exit, no ladder. The share of the peak gain kept grows with the run,
  // so a 5x is allowed to breathe where a +40% blip is not. Anything that reached 2x keeps a moonbag.
  if (tp.ride) {
    const peakPct = pos.peakMcap > 0 && pos.entryMcap > 0 ? ((pos.peakMcap - pos.entryMcap) / pos.entryMcap) * 100 : Math.max(0, changePct);
    if (peakPct >= (tp.rideArm ?? 30)) {
      const keepGain = peakPct >= 300 ? 0.70 : peakPct >= 100 ? 0.65 : 0.55;
      const trigger = Math.max(tp.rideFloor ?? 6, peakPct * keepGain);
      if (changePct <= trigger) {
        const keep = peakPct >= 200 && tp.moonbagPct > 0 ? tp.moonbagPct : 0;
        const detail = `peaked +${peakPct.toFixed(0)}%, out at +${changePct.toFixed(0)}%${keep ? `, ${keep}% moonbag kept` : ""}`;
        return keep
          ? { action: "PARTIAL_SELL", pct: 100 - keep, reason: "RIDE-trail", layer: 3, moonbag: true, detail }
          : { action: "SELL", pct: 100, reason: "RIDE-trail", layer: 3, detail };
      }
    }
    return null; // the stop loss and this trail are the only ways out; nothing is scalped on the way up
  }

  // TP3: Runner — sell everything but the moonbag once the run gives back its trail
  if ((pos.tpHit || 0) < 3 && tp.tp3 > 0 && changePct >= tp.tp3) {
    // Trailing stop widening for big runners
    const trailPct = changePct >= 4900 ? 25 : changePct >= 900 ? 30 : changePct >= 400 ? 35 : changePct >= 200 ? 40 : 50;
    if (fromPeak >= trailPct) {
      return { action: "PARTIAL_SELL", pct: Math.max(tp.tp3Sell, 100 - (tp.moonbagPct || 0)), reason: "TP3", layer: 3, moonbag: (tp.moonbagPct || 0) > 0 };
    }
    // Still within trail — hold
    return null;
  }

  // After TP2 (or on a plan with no TP3): a trailing stop on what is left, so a runner never rides
  // all the way back. The wider the run, the more room it gets; a 10x may breathe 30% off its peak.
  if ((pos.tpHit || 0) >= 2 && (tp.tp3 <= 0 || changePct < tp.tp3) && changePct > 20) {
    const trailPct = changePct >= 900 ? 30 : changePct >= 400 ? 26 : 22;
    if (fromPeak >= trailPct) {
      // A token that reached 3x keeps its moonbag when the trail fires; the rest is sold.
      const peakPct = pos.peakMcap > 0 && pos.entryMcap > 0 ? ((pos.peakMcap - pos.entryMcap) / pos.entryMcap) * 100 : changePct;
      const keep = peakPct >= 200 && tp.moonbagPct > 0 ? tp.moonbagPct : 0;
      return keep ? { action: "PARTIAL_SELL", pct: 100 - keep, reason: "TP-trail", layer: 3, moonbag: true, detail: `+${changePct.toFixed(0)}%, ${fromPeak.toFixed(0)}% off peak, ${keep}% moonbag kept` }
                  : { action: "SELL", pct: 100, reason: "TP-trail", layer: 3, detail: `+${changePct.toFixed(0)}%, ${fromPeak.toFixed(0)}% off peak` };
    }
  }

  // TP2: Second target
  if ((pos.tpHit || 0) < 2 && changePct >= tp.tp2) {
    return { action: "PARTIAL_SELL", pct: tp.tp2Sell, reason: "TP2", layer: 3 };
  }

  // TP1: First profit taking
  if ((pos.tpHit || 0) < 1 && changePct >= tp.tp1) {
    return { action: "PARTIAL_SELL", pct: tp.tp1Sell, reason: "TP1", layer: 3 };
  }

  // Pre-TP1 trailing stop: if peaked significantly but giving back gains
  if ((pos.tpHit || 0) === 0 && changePct > 5) {
    const peakPctFromEntry = pos.peakMcap > 0 && pos.entryMcap > 0
      ? ((pos.peakMcap - pos.entryMcap) / pos.entryMcap) * 100 : 0;
    const trailThreshold = peakPctFromEntry >= 30 ? 20 : peakPctFromEntry >= 15 ? 25 : 35;
    if (fromPeak > trailThreshold && peakPctFromEntry >= 12) {
      return { action: "PARTIAL_SELL", pct: tp.tp1Sell, reason: "trailing", layer: 3, detail: `peaked +${peakPctFromEntry.toFixed(0)}%` };
    }
  }

  // Post-TP1 protection: don't let winner become loser
  if ((pos.tpHit || 0) >= 1 && !pos.isMoonbag && (pos.tpHit || 0) < 3) {
    if (changePct <= 5) {
      return { action: "SELL", pct: 100, reason: "post-tp1-exit", layer: 3, detail: "protecting profits" };
    }
    if (fromPeak > 30 && changePct > 5) {
      return { action: "SELL", pct: 100, reason: "post-tp1-trail", layer: 3 };
    }
  }

  return null;
}

// Layer 4: Bonding curve graduation exit
export function checkGraduationExit(pos, changePct, curvePct) {
  if (curvePct <= 0.90 || !pos) return null;

  if (changePct > 50) {
    // Half off, half held for the Raydium pop -- ONCE. Unlike every other partial in this file this
    // one had no tpHit guard, and the graduation check runs ahead of both the trail and the stop, so
    // a winner on a nearly-full curve returned this same trim on every tick and nothing downstream
    // could intercept it. Measured against this file: a tier-2 position up 80% on a 95%-full curve
    // fired sixty times over sixty one-second ticks, each time taking half of what was left, and
    // finished holding 0.0000% of the position it started with.
    //
    // And it returns null rather than falling through, which is the difference between this and the
    // obvious one-line guard. Falling through reaches the full `pre-graduation-exit` below and dumps
    // the kept half on the very next tick -- the exact opposite of the rule's own purpose, which is
    // to hold that half through graduation.
    if ((pos.tpHit || 0) > 0) return null;
    return { action: "PARTIAL_SELL", pct: 50, reason: "pre-graduation-profit", layer: 4, detail: `curve ${Math.round(curvePct * 100)}%` };
  }
  // Not up much → full exit before graduation
  return { action: "SELL", pct: 100, reason: "pre-graduation-exit", layer: 4, detail: `curve ${Math.round(curvePct * 100)}%` };
}

// Sell-into-volume detection.
//
// The premise of this rule is "somebody is buying much harder than usual", and on a launch that is as
// often the top as it is the start of the next leg -- so it is worth a trim. But "harder than usual"
// needs a measure of USUAL, and the only one to hand is the token's own cumulative volume over its
// own age. That cumulative figure is written under a different name by each feed: pump.fun counts in
// SOL on `volumeSol`, PONS counts in ETH and Arc in USDC, both on `volumeQuote`. This read only ever
// looked at `volumeSol`, so on both EVM venues the baseline came out zero, every comparison against
// it was trivially true, and all that was left standing was a bare `> 0.5` -- half an ETH on PONS and
// sixty cents on Arc, one constant meaning two unrelated things and neither of them a spike. A rule
// whose premise is "this is unusual flow" with no measure of usual flow is not a rule; it is a coin
// flip that costs a round trip, and it was being flipped on the venue where the win rate was measured.
//
// So the baseline is whichever field this venue actually writes, and the recent buys are summed in the
// same unit (both EVM feeds put the quote amount on the trade's `sol` as well as its `quote`). If
// there is no cumulative volume, or no age to divide it by, there is no average -- therefore there is
// no spike, and this returns null instead of falling through to a constant. `volumeQuote` is
// initialised to 0 and incremented on every recorded trade by both EVM feeds (pons/feed.mjs and
// arc/feed.mjs), so it is positive from a token's first trade and this is a working rule there rather
// than a disabled one.
const SPIKE_MULT = 3;          // the last minute must be this many times the token's own average minute
// ...and worth this much of everything the token has ever traded, which is what keeps a single buy on
// a dust token from reading as a wave. It is a ratio, so it means the same thing in SOL, ETH and USDC.
//
// Be plain about its reach: condition A implies this one whenever 3/ageMin >= 0.05, which is every
// token under an hour old -- so on a launch entry, which is what this bot mostly holds, the 3x
// multiple IS the whole rule and this constant never binds. Where it does bind is the dip plans,
// whose holds run 45 and 180 minutes. It is kept for those and for nothing else.
const SPIKE_MIN_SHARE = 0.05;
export function checkVolumeExit(pos, token, changePct) {
  if (changePct < 15 || pos.isMoonbag || (pos.tpHit || 0) > 0) return null;

  const cumulative = token.volumeQuote ?? token.volumeSol ?? 0;
  const createdAt = Number(token.createdAt);
  // An adopted token of no known age (Arc's `_ageUnknown`) has a placeholder createdAt, not a clock.
  if (!(cumulative > 0) || !(createdAt > 0) || token._ageUnknown) return null;
  const ageMin = (Date.now() - createdAt) / 60000;
  // Less than a minute of history is not a per-minute average: the baseline would be shorter than the
  // window being compared against it. The old code clamped the age up to a minute instead, which came
  // to the same thing -- a minute of buying cannot exceed three times the token's entire life volume.
  if (!(ageMin >= 1)) return null;
  const avgPerMin = cumulative / ageMin;

  const recentBuyVol = (token.trades || [])
    .filter(tr => tr.side === "buy" && tr.time && Date.now() - tr.time < 60000)
    .reduce((s, tr) => s + (tr.quote ?? tr.sol ?? 0), 0);
  if (!(recentBuyVol > avgPerMin * SPIKE_MULT) || !(recentBuyVol >= cumulative * SPIKE_MIN_SHARE)) return null;

  const sellPct = changePct >= 50 ? 40 : 25;
  // No unit in the detail: it read "SOL/min" on a venue quoted in ETH and on one quoted in USDC. The
  // multiple is the thing the rule actually decided on, and it is the same number in any currency.
  return { action: "PARTIAL_SELL", pct: sellPct, reason: "volume-sell", layer: 3, detail: `buying ${(recentBuyVol / avgPerMin).toFixed(1)}x this token's own average minute` };
}
