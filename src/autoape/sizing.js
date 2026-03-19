// ═══ POSITION SIZING — Modified Kelly Criterion ═══
// Quarter-Kelly with tier multipliers, dynamic adjustments, and hard limits.

export function calculatePositionSize(tier, scores, portfolio, dynamics) {
  // Drawdown governor: if trading halted, return 0
  if ((portfolio.drawdownMult || 1) <= 0) return 0;

  const apeScore = scores.apeScore || 0;

  // Base Kelly parameters (from rolling trade history or defaults)
  const winRate = apeScore >= 70 ? 0.45
    : apeScore >= 55 ? 0.35
    : apeScore >= 40 ? 0.25
    : apeScore >= 25 ? 0.15
    : 0.08;

  const payoffRatio = 3.0; // avg win / avg loss
  const q = 1 - winRate;
  const kellyFull = Math.max(0, (winRate * payoffRatio - q) / payoffRatio);
  const kellyQuarter = kellyFull * 0.25;

  // Base size from Kelly
  const baseSol = portfolio.solPerTrade || 0.05;
  let mult = 0.3 + kellyQuarter * 8.5;

  // === TIER MULTIPLIERS ===
  const TIER_MULTS = { 1: 1.0, 2: 0.70, 3: 0.35 };
  mult *= TIER_MULTS[tier] || 0.35;

  // === DYNAMIC ADJUSTMENTS ===
  const trend = dynamics?.trend || "new";

  // Trend adjustment
  if (trend === "rocket") mult *= 1.15;
  else if (trend === "rising") mult *= 1.08;
  else if (trend === "fading") mult *= 0.85;
  else if (trend === "declining") mult *= 0.70;

  // Rug flag penalty
  const rugFlags = scores.rugFlagCount || 0;
  if (rugFlags > 0) mult *= Math.pow(0.75, rugFlags);

  // Consecutive loss reduction
  if ((portfolio.consecutiveLosses || 0) >= 3) mult *= 0.50;

  // Drawdown reduction
  if ((portfolio.currentDrawdownPct || 0) > 0.10) mult *= 0.60;

  // Drawdown governor scaling
  mult *= (portfolio.drawdownMult || 1);

  // === ENTRY TIMING ADJUSTMENTS ===
  // Price phase
  if (scores.pricePhase === "DIP") mult *= 1.15;
  else if (scores.pricePhase === "SPIKE") mult *= 0.70;

  // Buy velocity trend
  if (scores.buyVelTrend === "accelerating") mult *= 1.10;

  // Learner-driven adjustments
  if (portfolio.learnerMult) mult *= portfolio.learnerMult;

  // === HARD LIMITS ===
  mult = Math.max(0.25, Math.min(2.0, mult));
  const size = Math.round(baseSol * mult * 1000) / 1000;

  const MIN_SIZE = 0.01;
  const MAX_SIZE = Math.min(2.0, (portfolio.totalBankroll || 10) * 0.05);

  return {
    solAmount: Math.max(MIN_SIZE, Math.min(size, MAX_SIZE)),
    sizeMult: +(size / baseSol).toFixed(2),
    kellyFraction: kellyQuarter,
    winRateEst: winRate,
  };
}
