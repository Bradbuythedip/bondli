// ═══ GATE 1: HARD DISQUALIFIERS — Instant Reject (<5ms) ═══
// Absolute deal-breakers. No score overrides them. Token blacklisted on fail.

export function checkDisqualifiers(token, qf, opts = {}) {
  const flags = [];

  // === RUG SIGNALS (on-chain) ===
  // Dev wallet has 2+ prior rugs in last 30 days
  if (qf?._devLaunchCount > 8) flags.push("SERIAL_LAUNCHER");
  if (qf?._namePrevRugged && qf._devLaunchCount > 3) flags.push("SERIAL_RUGGER");

  // Dev selling aggressively
  if (qf?.rg_devSellSpeed > 0.6) flags.push("DEV_SELLING");

  // Dev self-sniped the launch
  if (qf?._rg_devSelfSnipe > 0) flags.push("DEV_SELF_SNIPE");

  // Freeze authority still active
  if (opts.freezeAuthority) flags.push("FREEZE_AUTHORITY");

  // Top holders extremely concentrated (excluding bonding curve)
  if (qf?.rg_holderConcentration > 0.7 && (token.buys || 0) > 5 && !(qf?._whaleBullish > 0.3))
    flags.push("EXTREME_CONCENTRATION");

  // Multiple moderate rug signals firing simultaneously
  const moderateSignals = [
    qf?.rg_devSellSpeed > 0.35,
    qf?.rg_coordDumpScore > 0.3,
    qf?._rg_sybilScore > 0.3,
    qf?._rg_quickFlipRate > 0.2,
    qf?.rg_holderConcentration > 0.65,
    qf?._rg_earlyDump > 0.3,
    qf?.rg_mcapDropRate > 0.3,
    qf?._rg_pumpDump > 0.35,
    qf?.ch_smoothGrind > 0.4,
    qf?.ch_dipRatio < 0.08,
    qf?._rg_zeroSellFlag > 0.5,
    qf?._rg_buySellImbalance > 0.6,
    qf?.ch_staircaseScore > 0.4,
    qf?._rg_freshWalletRatio > 0.7,
    qf?.ch_flatlineSpike > 0.3,
    token._artworkOriginal === false,
  ].filter(Boolean).length;

  const ageMin = (Date.now() - (token.createdAt || Date.now())) / 60000;
  const sells = token.sells || 0;
  const isVeryYoung = ageMin < 2 && sells >= 1;
  const minSignals = isVeryYoung ? 5 : 4;
  if (moderateSignals >= minSignals) flags.push("MULTI_RUG_SIGNAL_" + moderateSignals);

  // === CHART FORENSICS ===
  if (qf?.rg_coordDumpScore > 0.5) flags.push("COORDINATED_DUMP");
  if (qf?._rg_pumpDump > 0.6 && !isVeryYoung) flags.push("PUMP_DUMP");
  if (qf?._rg_sybilScore > 0.5) flags.push("SYBIL_ATTACK");
  if (qf?._rg_earlyDump > 0.6 && ageMin < 5) flags.push("EARLY_DUMP");
  if (qf?._rg_quickFlipRate > 0.35) flags.push("QUICK_FLIP");
  if (qf?.rg_liqRemovalSpeed > 0.65 && !isVeryYoung) flags.push("LIQ_REMOVAL");
  if (qf?.ch_smoothGrind > 0.6 && !isVeryYoung) flags.push("SMOOTH_GRIND");
  if (qf?.ch_smoothGrind > 0.4 && qf?.ch_dipRatio < 0.1 && !isVeryYoung) flags.push("NO_DIPS_GRIND");
  if (qf?.rg_mcapDropRate > 0.5 && !isVeryYoung) flags.push("MCAP_CRASHING");
  if (qf?.ch_staircaseScore > 0.6 && !isVeryYoung) flags.push("STAIRCASE_CHART");
  if (qf?.ch_staircaseScore > 0.4 && qf?._rg_freshWalletRatio > 0.6 && !isVeryYoung) flags.push("STAIRCASE_FRESH");
  if (qf?._rg_freshWalletRatio > 0.8 && qf?._rg_zeroSellFlag > 0.4 && !isVeryYoung) flags.push("FRESH_WALLET_RUG");
  if (qf?.ch_flatlineSpike > 0.5 && !isVeryYoung) flags.push("FLATLINE_SPIKE");
  if (qf?.ch_flatlineSpike > 0.3 && qf?._rg_zeroSellFlag > 0.3 && !isVeryYoung) flags.push("FLATLINE_NO_SELLS");
  if (qf?.ch_flatlineSpike > 0.3 && qf?._rg_freshWalletRatio > 0.5 && !isVeryYoung) flags.push("FLATLINE_FRESH");

  // Zero sells: only reject for tokens > 2 min old with no sell activity
  if (qf?._rg_zeroSellFlag >= 0.8 && !isVeryYoung) flags.push("ZERO_SELLS");
  if (qf?._rg_zeroSellFlag >= 0.5 && (qf?.ch_smoothGrind > 0.3 || qf?.ch_staircaseScore > 0.3) && !isVeryYoung)
    flags.push("ZERO_SELLS_FAKE_CHART");
  if (qf?._rg_buySellImbalance >= 0.8 && (token.buys || 0) >= 15 && !isVeryYoung)
    flags.push("ALL_BUYS_NO_SELLS");

  // === ARTWORK ===
  if (token._artworkFlags?.includes("EXACT_DUPLICATE")) flags.push("STOLEN_ART");

  // === AGE / TIMING ===
  // Bonding curve >80% = too late
  if (token.vSolInBondingCurve && token.vSolInBondingCurve / 85 > 0.80) flags.push("TOO_LATE");
  // Token >15 min old and score just now appearing = missed it
  if (ageMin > 15 && !opts.isRecoveryPlay) flags.push("STALE");

  // === HARD MINIMUMS ===
  const ub = token.uniqueBuyers?.size || 0;
  if (ub < 3) flags.push("TOO_FEW_BUYERS");
  if (ageMin < 0.5) flags.push("TOO_YOUNG");

  return {
    pass: flags.length === 0,
    flags,
    fatal: true,
  };
}
