// ═══ BONDLI AUTO-APE ENGINE — 5-GATE PIPELINE ═══
// Every gate is a kill gate. Failing any = no entry.
// Gates ordered cheapest→most expensive to reject fast.
//
// Gate 1: Hard Disqualifiers (instant reject, <5ms)
// Gate 2: Minimum Viability (score + feature floors, <10ms)
// Gate 3: Confidence Classification (tier assignment, <5ms)
// Gate 4: Portfolio Constraints (bankroll, exposure, correlation, <5ms)
// Gate 5: Timing & Execution Window (is the window still open?, <5ms)

import { checkDisqualifiers } from "./gates/disqualifiers.js";
import { checkViability } from "./gates/viability.js";
import { classifyConfidence } from "./gates/confidence.js";
import { checkPortfolioConstraints } from "./gates/portfolio.js";
import { checkExecutionWindow } from "./gates/execution-window.js";
import { calculatePositionSize } from "./sizing.js";
import { createExitPlan, checkDerivativeExit, checkThresholdExit, checkTrailingExit, checkGraduationExit, checkVolumeExit } from "./exit-plan.js";
import { checkWatchlistPromotion, checkMissedReentry, checkPostExitReentry, checkDipDCA } from "./recovery.js";

// Run the full 5-gate pipeline for a single token
export function runPipeline(token, qf, scores, dynamics, portfolio) {
  const result = {
    ca: token.ca,
    name: token.name || token.ca?.slice(0, 8),
    gates: {},
    decision: "REJECT",
    tier: 0,
    tierLabel: "REJECT",
    positionSize: null,
    exitPlan: null,
    rejectGate: null,
    rejectReason: null,
    timing: {},
  };

  const t0 = Date.now();

  // ═══ GATE 1: HARD DISQUALIFIERS ═══
  const g1 = checkDisqualifiers(token, qf);
  result.gates.disqualifiers = g1;
  result.timing.gate1 = Date.now() - t0;
  if (!g1.pass) {
    result.rejectGate = 1;
    result.rejectReason = g1.flags.join(", ");
    return result;
  }

  // ═══ GATE 2: MINIMUM VIABILITY ═══
  const t2 = Date.now();
  const g2 = checkViability(token, qf, scores, dynamics);
  result.gates.viability = g2;
  result.timing.gate2 = Date.now() - t2;
  if (!g2.pass) {
    result.rejectGate = 2;
    result.rejectReason = g2.checks.join(", ");
    return result;
  }

  // ═══ GATE 3: CONFIDENCE CLASSIFICATION ═══
  const t3 = Date.now();
  const g3 = classifyConfidence(token, qf, scores, dynamics);
  result.gates.confidence = g3;
  result.tier = g3.tier;
  result.tierLabel = g3.label;
  result.timing.gate3 = Date.now() - t3;

  // Tier 4 (WATCHLIST) = don't enter, just monitor
  if (g3.tier >= 4 || g3.tier === 0) {
    result.decision = g3.tier === 4 ? "WATCHLIST" : "REJECT";
    result.rejectGate = 3;
    result.rejectReason = g3.tier === 4 ? "WATCHLIST" : g3.reasons.join(", ");
    return result;
  }

  // ═══ GATE 4: PORTFOLIO CONSTRAINTS ═══
  const t4 = Date.now();
  // Calculate preliminary position size for constraint checking
  const prelimSize = calculatePositionSize(g3.tier, scores, portfolio, dynamics);
  const g4 = checkPortfolioConstraints(g3.tier, prelimSize.solAmount, portfolio, token);
  result.gates.portfolio = g4;
  result.timing.gate4 = Date.now() - t4;
  if (!g4.pass) {
    result.rejectGate = 4;
    result.rejectReason = g4.checks.join(", ");
    return result;
  }

  // ═══ GATE 5: EXECUTION WINDOW ═══
  const t5 = Date.now();
  const g5 = checkExecutionWindow(token, g3.tier, scores.scoreTimestamp);
  result.gates.executionWindow = g5;
  result.timing.gate5 = Date.now() - t5;
  if (!g5.pass) {
    result.rejectGate = 5;
    result.rejectReason = g5.checks.join(", ");
    return result;
  }

  // ═══ ALL GATES PASSED — ENTRY DECISION: GO ═══
  result.decision = "ENTER";
  result.positionSize = prelimSize;

  // Attach exit plan
  result.exitPlan = createExitPlan(g3.tier, scores.apeScore || 0, portfolio.settings || {});

  result.timing.total = Date.now() - t0;
  return result;
}

// Run exit checks on an existing position (called every tick)
export function runExitChecks(pos, token, dynamics, settings) {
  if (!token || !pos) return null;

  const currentMcap = token.mcapUsd || 0;
  if (pos.entryMcap <= 0) return null;

  const changePct = ((currentMcap - pos.entryMcap) / pos.entryMcap) * 100;
  pos.peakMcap = Math.max(pos.peakMcap || pos.entryMcap, currentMcap);
  const fromPeak = pos.peakMcap > 0 ? ((pos.peakMcap - currentMcap) / pos.peakMcap) * 100 : 0;

  // Layer 1: Derivative exits (highest priority, leading indicators)
  const hasRadarData = token.buys != null && token.trades != null;
  if (settings.momentumExit && hasRadarData && !pos.isMoonbag) {
    const deriv = checkDerivativeExit(pos, dynamics, changePct, settings);
    if (deriv) return { ...deriv, changePct, fromPeak, currentMcap };
  }

  // Sell-into-volume
  const volExit = checkVolumeExit(pos, token, changePct);
  if (volExit) return { ...volExit, changePct, fromPeak, currentMcap };

  // Layer 4: Graduation exit (check before trailing — graduation is time-critical)
  const curvePct = token.vSolInBondingCurve ? token.vSolInBondingCurve / 85 : 0;
  const gradExit = checkGraduationExit(pos, changePct, curvePct);
  if (gradExit) return { ...gradExit, changePct, fromPeak, currentMcap };

  // Layer 3: Trailing profit stops
  const trail = checkTrailingExit(pos, changePct, fromPeak, settings);
  if (trail) return { ...trail, changePct, fromPeak, currentMcap };

  // Layer 2: Absolute thresholds (safety net)
  const thresh = checkThresholdExit(pos, changePct, settings);
  if (thresh) return { ...thresh, changePct, fromPeak, currentMcap };

  return null;
}

// Export all submodules for direct access
export {
  checkDisqualifiers,
  checkViability,
  classifyConfidence,
  checkPortfolioConstraints,
  checkExecutionWindow,
  calculatePositionSize,
  createExitPlan,
  checkDerivativeExit,
  checkThresholdExit,
  checkTrailingExit,
  checkGraduationExit,
  checkVolumeExit,
  checkWatchlistPromotion,
  checkMissedReentry,
  checkPostExitReentry,
  checkDipDCA,
};
