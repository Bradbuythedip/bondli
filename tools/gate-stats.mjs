#!/usr/bin/env node
// gate-stats: offline calibration for GATE 1 (src/autoape/gates/disqualifiers.js) on the velocity path.
// Live:    node tools/gate-stats.mjs --minutes 30 [--out snap.jsonl] [--url http://127.0.0.1:3001]
// Offline: node tools/gate-stats.mjs --file snap.jsonl
// Polls /api/radar/scored?min=0&limit=200 every 60s, appends each response as one JSONL line, then reports:
//   - rule fire rates as recorded (the features the server computed at snapshot time)
//   - the same with the three features recomputed the way the server computes them now
//     (organic distribution ratio, organic quick-flip share, spike-immune mcap peak)
//   - which single rule, if dropped, would let the most tokens through ("binding" rules)
// Both columns are judged by the CURRENT rule table, so a rule change moves both; only the three
// recomputed features differ between them.
import { appendFileSync, readFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = arg("--file"), OUT = arg("--out", "gate-snapshots.jsonl"), MIN = +arg("--minutes", 10);
const URL = (arg("--url", "http://127.0.0.1:3001")).replace(/\/$/, "") + "/api/radar/scored?min=0&limit=200";
const MIN_BUYS = +arg("--min-buys", 10), MIN_AGE = +arg("--min-age", 2);

// ── Rule table: one entry per flag in checkDisqualifiers(), same expressions, same order. ──
// c = { age (min, from snapshot ts), vy (isVeryYoung), moderate, minSignals, volLeg }
const RULES = {
  SERIAL_LAUNCHER:      (t, q) => q?._devLaunchCount > 8,
  SERIAL_RUGGER:        (t, q) => q?._namePrevRugged && q._devLaunchCount > 3,
  DEV_SELLING:          (t, q) => q?.rg_devSellSpeed > 0.6,
  DEV_SELF_SNIPE:       (t, q) => q?._rg_devSelfSnipe > 0,
  FREEZE_AUTHORITY:     (t) => !!t.freezeAuthority,                         // velocity edge.mjs passes opts.freezeAuthority = !!token.freezeAuthority
  EXTREME_CONCENTRATION:(t, q) => q?.rg_holderConcentration > 0.7 && (t.buys || 0) > 5 && (q?._rg_organicBuyers ?? 99) >= 8 && !(q?._whaleBullish > 0.3),
  DEV_SELF_PUMP:        (t, q) => q?._rg_devSelfPumpScore >= 0.7,
  DEV_PUMP_NO_SELLS:    (t, q) => q?._rg_devSelfPumpScore >= 0.5 && q?._rg_zeroSellFlag >= 0.5,
  LINEAR_PUMP:          (t, q) => q?._rg_velocityLinearity > 0.9 && q?._rg_buySellImbalance > 0.7,
  BOT_PUMP:             (t, q) => q?._rg_buyTimingRegularity > 0.6 && q?._rg_singleWalletDominance > 0.4,
  "MULTI_RUG_SIGNAL_*": (t, q, c) => c.moderate >= c.minSignals,             // code emits MULTI_RUG_SIGNAL_<n>; collapsed here
  COORDINATED_DUMP:     (t, q) => q?.rg_coordDumpScore > 0.5 && q?.rg_sellWaveDetect > 0.5 && (t.sells || 0) > (t.buys || 0) * 0.5,
  PUMP_DUMP:            (t, q, c) => q?._rg_pumpDump > 0.6 && !c.vy,
  SYBIL_ATTACK:         (t, q) => q?._rg_sybilScore > 0.5,
  EARLY_DUMP:           (t, q, c) => q?._rg_earlyDump > 0.6 && c.age < 5,
  QUICK_FLIP:           (t, q) => q?._rg_quickFlipRate > 0.35,
  LIQ_REMOVAL:          (t, q, c) => q?.rg_liqRemovalSpeed > 0.65 && !c.vy,
  SMOOTH_GRIND:         (t, q, c) => q?.ch_smoothGrind > 0.6 && !c.vy,
  NO_DIPS_GRIND:        (t, q, c) => q?.ch_smoothGrind > 0.4 && q?.ch_dipRatio < 0.1 && !c.vy,
  MCAP_CRASHING:        (t, q, c) => q?.rg_mcapDropRate > 0.5 && !c.vy,
  STAIRCASE_CHART:      (t, q, c) => q?.ch_staircaseScore > 0.6 && !c.vy,
  STAIRCASE_FRESH:      (t, q, c) => q?.ch_staircaseScore > 0.4 && q?._rg_freshWalletRatio > 0.6 && !c.vy,
  FRESH_WALLET_RUG:     (t, q, c) => q?._rg_freshWalletRatio > 0.8 && q?._rg_zeroSellFlag > 0.4 && !c.vy,
  FLATLINE_SPIKE:       (t, q, c) => q?.ch_flatlineSpike > 0.5 && !c.vy,
  FLATLINE_NO_SELLS:    (t, q, c) => q?.ch_flatlineSpike > 0.3 && q?._rg_zeroSellFlag > 0.3 && !c.vy,
  FLATLINE_FRESH:       (t, q, c) => q?.ch_flatlineSpike > 0.3 && q?._rg_freshWalletRatio > 0.5 && !c.vy,
  ZERO_SELLS:           (t, q, c) => q?._rg_zeroSellFlag >= 0.8 && !c.vy,
  ZERO_SELLS_FAKE_CHART:(t, q, c) => q?._rg_zeroSellFlag >= 0.5 && (q?.ch_smoothGrind > 0.3 || q?.ch_staircaseScore > 0.3) && !c.vy,
  ALL_BUYS_NO_SELLS:    (t, q, c) => q?._rg_buySellImbalance >= 0.8 && (t.buys || 0) >= 15 && !c.vy,
  BOTTED_VOLUME:        (t, q, c) => !!c.volLeg && c.volLeg.botDetection?.botScore >= 70 && (t.buys || 0) >= 10,
  FAKE_VOLUME_HIGH_SOL: (t, q, c) => !!c.volLeg && c.volLeg.legitimacy === "LIKELY_BOTTED" && (t.volumeSol || 0) > 5,
  BOT_FARM_VOLUME:      (t, q, c) => { const s = c.volLeg?.botDetection?.signals || []; return !!c.volLeg && s.includes("METRONOMIC_TIMING") && s.includes("UNIFORM_TRADE_SIZES"); },
  STOLEN_ART:           (t) => !!t._artworkFlags?.includes("EXACT_DUPLICATE"),
  TOO_LATE:             (t) => !!t.vSolInBondingCurve && t.vSolInBondingCurve / 85 > 0.80,
  STALE:                (t, q, c) => c.age > 15,                              // velocity never passes opts.isRecoveryPlay
  TOO_FEW_BUYERS:       (t) => (t.uniqueBuyers?.size || 0) < 3,
  TOO_YOUNG:            (t, q, c) => c.age < 0.5,
};
const MODERATE = (t, q) => [
  q?.rg_devSellSpeed > 0.35, q?.rg_coordDumpScore > 0.3 && q?.rg_sellWaveDetect > 0.3, q?._rg_sybilScore > 0.3, q?._rg_quickFlipRate > 0.2,
  q?.rg_holderConcentration > 0.65 && (q?._rg_organicBuyers ?? 99) >= 8, q?._rg_earlyDump > 0.3, q?.rg_mcapDropRate > 0.3, q?._rg_pumpDump > 0.35,
  q?.ch_smoothGrind > 0.4, q?.ch_dipRatio < 0.08, q?._rg_zeroSellFlag > 0.5, q?._rg_buySellImbalance > 0.6,
  q?.ch_staircaseScore > 0.4, q?._rg_freshWalletRatio > 0.7, q?.ch_flatlineSpike > 0.3, t._artworkOriginal === false,
  q?._rg_velocityLinearity > 0.8, q?._rg_buyTimingRegularity > 0.5, q?._rg_singleWalletDominance > 0.5,
].filter(Boolean).length;

function evalRules(t, q, ts, skip = null) {
  const age = (ts - (t.createdAt || ts)) / 60000, vy = age < 2 && (t.sells || 0) >= 1;
  const moderate = MODERATE(t, q);
  const c = { age, vy, moderate, minSignals: vy ? 5 : 4, volLeg: t._volumeLegitimacy || q?._volumeLegitimacy };
  return { age, flags: Object.keys(RULES).filter(k => k !== skip && !!RULES[k](t, q, c)) };
}

/** The three features the on-chain trade source broke, recomputed from the snapshot's trade window
 *  the way src/api/server.production.mjs extractQuickFeatures() computes them now. The window is
 *  the last 60 trades (the server keeps 100), so this is an approximation of a fresh collection. */
function recompute(t, q) {
  if (!q) return q;
  const trades = (t.trades || []).filter(tr => !tr.hub);
  const buysT = trades.filter(tr => tr.side === "buy"), sellsT = trades.filter(tr => tr.side === "sell");
  const orgBuySol = buysT.reduce((s, tr) => s + (tr.sol || 0), 0), orgSellSol = sellsT.reduce((s, tr) => s + (tr.sol || 0), 0);
  const all = (t.volumeSol || 0) > 0 ? Math.min(1, (t.sellVolumeSol || 0) / t.volumeSol) : 0;
  const flow = orgBuySol + orgSellSol, totalFlow = (t.volumeSol || 0) + (t.sellVolumeSol || 0);
  const liq = flow >= 0.5 ? orgSellSol / flow : (totalFlow > 0 ? (t.sellVolumeSol || 0) / totalFlow : 0);
  const walletBuys = new Set(buysT.map(tr => tr.wallet).filter(Boolean));
  let quickFlips = 0; const firstBuy = new Map();
  for (const tr of trades) {
    if (tr.side === "buy" && tr.wallet && !firstBuy.has(tr.wallet)) firstBuy.set(tr.wallet, tr.time);
    if (tr.side === "sell" && tr.wallet) { const fb = firstBuy.get(tr.wallet); if (fb && tr.time - fb < 60000) quickFlips++; }
  }
  const quickFlipRate = (t.buys || 0) > 3 ? Math.min(1, quickFlips / Math.max(1, walletBuys.size)) : 0;
  const desc = (t.spark || []).slice().sort((a, b) => b - a);
  const peak = desc.length >= 3 ? desc[1] : (desc[0] || t.mcapUsd);
  const mcapDropRate = peak > 0 ? Math.max(0, (peak - (t.mcapUsd || 0)) / peak) : 0;
  return { ...q, rg_liqRemovalSpeed: liq, _rg_liqRemovalAll: all, _rg_quickFlipRate: quickFlipRate, rg_mcapDropRate: mcapDropRate };
}

// Mirror src/velocity/venues/pumpfun/feed.mjs hydrateToken(): gates read token.uniqueBuyers.size.
const hydrate = r => ({ ...r, uniqueBuyers: { size: typeof r.uniqueBuyers === "number" ? r.uniqueBuyers : r.uniqueBuyers?.size || 0 }, trades: r.trades || [], spark: r.spark || [] });
const pct = (a, p) => a.length ? +a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))].toFixed(3) : NaN;
const fmt = (n, d) => (n / Math.max(1, d) * 100).toFixed(1).padStart(5) + "%";
const P = s => s.padEnd(24);

async function collect() {
  const end = Date.now() + MIN * 60000; let n = 0;
  while (Date.now() < end) {
    try { const r = await fetch(URL, { signal: AbortSignal.timeout(15000) }); const j = await r.json(); appendFileSync(OUT, JSON.stringify(j) + "\n"); n++;
      console.error(`[${new Date().toISOString()}] snapshot ${n}: ${j.count} tokens -> ${OUT}`); }
    catch (e) { console.error("poll failed:", e.message); }
    if (Date.now() < end) await new Promise(r => setTimeout(r, 60000));
  }
  return OUT;
}

/** Fire rates and pass sets over every qualifying token-snapshot, for one feature view. */
function tally(rows, gate, featuresOf) {
  const fire = Object.fromEntries(Object.keys(RULES).map(k => [k, 0]));
  const pass1 = new Set(), pass2 = new Set(), dropOne = Object.fromEntries(Object.keys(RULES).map(k => [k, new Set()]));
  let mismatch = 0; const mmEx = [];
  for (const { t, r, ts } of rows) {
    const q = featuresOf(t, r.qf);
    const { flags } = evalRules(t, q, ts);
    for (const f of flags) fire[f]++;
    // Which single rule stands between this token and gate 1? Only rules that fired matter.
    if (flags.length === 1) dropOne[flags[0]].add(t.ca);
    if (flags.length === 2 && flags.includes("MULTI_RUG_SIGNAL_*")) { const other = flags.find(f => f !== "MULTI_RUG_SIGNAL_*"); if (other && !evalRules(t, q, ts, other).flags.length) dropOne[other].add(t.ca); }
    if (gate) { // the real gates with Date.now pinned to the snapshot time so offline replay ages correctly
      const now = Date.now; Date.now = () => ts;
      try {
        const g1 = gate.d.checkDisqualifiers(t, q, { freezeAuthority: !!t.freezeAuthority });
        const real = g1.flags.map(f => f.startsWith("MULTI_RUG_SIGNAL_") ? "MULTI_RUG_SIGNAL_*" : f).sort().join(",");
        if (real !== flags.slice().sort().join(",")) { mismatch++; if (mmEx.length < 5) mmEx.push(`${t.ca?.slice(0, 8)} real=[${real}] replica=[${flags}]`); }
        if (g1.pass) { pass1.add(t.ca); if (gate.v.checkViability(t, q, r.scores || {}, r.dynamics).pass) pass2.add(t.ca); }
      } finally { Date.now = now; }
    } else if (!flags.length) pass1.add(t.ca);
  }
  return { fire, pass1, pass2, dropOne, mismatch, mmEx };
}

async function report(file) {
  let gate = null; // real gates for cross-check + gate-2 pass count (only when run inside the repo)
  try { gate = { d: await import("../src/autoape/gates/disqualifiers.js"), v: await import("../src/autoape/gates/viability.js") }; } catch {}
  const snaps = readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  const FIELDS = ["rg_holderConcentration", "rg_coordDumpScore", "rg_devSellSpeed", "_rg_freshWalletRatio", "_rg_sybilScore", "ch_healthScore", "apeScore", "rg_liqRemovalSpeed", "_rg_quickFlipRate", "rg_mcapDropRate"];
  const CW = ["_whaleBullish", "_devLaunchCount", "_namePrevRugged", "_devCredScore", "_walletAgeFresh"], TK = ["_volumeLegitimacy", "_artworkOriginal", "_artworkFlags", "_rugFlags", "_survivorMatch", "_bullishSignals", "_devTier"];
  const rows = [], seen = new Set(), missing = {}, distRec = {}, distNew = {};
  let hubTrades = 0, trades = 0;
  for (const f of FIELDS) { distRec[f] = []; distNew[f] = []; }
  for (const s of snaps) for (const r of s.tokens || []) {
    const t = hydrate(r.token), ts = s.ts || Date.now(), age = (ts - (t.createdAt || ts)) / 60000;
    seen.add(t.ca);
    if ((t.buys || 0) < MIN_BUYS || age < MIN_AGE) continue;
    rows.push({ t, r, ts });
    const q = r.qf, q2 = recompute(t, q);
    for (const f of FIELDS) { const v = f === "apeScore" ? r.scores?.apeScore : q?.[f]; if (typeof v === "number") distRec[f].push(v); const v2 = f === "apeScore" ? r.scores?.apeScore : q2?.[f]; if (typeof v2 === "number") distNew[f].push(v2); }
    for (const f of CW) if (q?.[f] == null || q[f] === 0 || q[f] === -1 || q[f] === false || (f === "_devCredScore" && q[f] === 0.5)) missing["qf." + f] = (missing["qf." + f] || 0) + 1;
    for (const f of TK) if (t[f] == null || (Array.isArray(t[f]) && !t[f].length)) missing["token." + f] = (missing["token." + f] || 0) + 1;
    for (const tr of t.trades) { trades++; if (tr.hub) hubTrades++; }
  }
  const N = rows.length;
  const rec = tally(rows, gate, (t, q) => q);
  const fix = tally(rows, gate, recompute);
  console.log(`\n${file}: ${snaps.length} snapshots, ${seen.size} distinct tokens, ${N} token-snapshots with buys>=${MIN_BUYS} & age>=${MIN_AGE}min\n`);
  console.log("GATE 1 rule fire rate (fraction of qualifying token-snapshots)   recorded | recomputed features");
  const order = Object.keys(RULES).sort((a, b) => fix.fire[b] - fix.fire[a] || rec.fire[b] - rec.fire[a]);
  for (const k of order) console.log(`  ${P(k)} ${fmt(rec.fire[k], N)} (${String(rec.fire[k]).padStart(5)}) | ${fmt(fix.fire[k], N)} (${String(fix.fire[k]).padStart(5)})`);
  console.log("\nFeature percentiles (recorded | recomputed)       p10     p50     p90 |     p10     p50     p90    (n)");
  for (const f of FIELDS) console.log(`  ${P(f)} ${String(pct(distRec[f], .1)).padStart(7)} ${String(pct(distRec[f], .5)).padStart(7)} ${String(pct(distRec[f], .9)).padStart(7)} | ${String(pct(distNew[f], .1)).padStart(7)} ${String(pct(distNew[f], .5)).padStart(7)} ${String(pct(distNew[f], .9)).padStart(7)}  (${distRec[f].length})`);
  console.log(`\nHub-flagged trades: ${fmt(hubTrades, trades)} of ${trades} trades (last 60 per token-snapshot)`);
  console.log("Counterweight / enrichment fields absent or at their fallback value (startAutoTrader-only enrichment):");
  for (const [k, v] of Object.entries(missing).sort((a, b) => b[1] - a[1])) console.log(`  ${P(k)} ${fmt(v, N)}`);
  console.log(`\nTokens passing gate 1 (any qualifying snapshot): recorded ${rec.pass1.size} -> recomputed ${fix.pass1.size}   passing gate 1 AND gate 2: ${gate ? `${rec.pass2.size} -> ${fix.pass2.size}` : "n/a (gates not importable)"}`);
  console.log("\nBinding rules with recomputed features: distinct tokens that would pass gate 1 if only this rule were dropped");
  const binding = Object.entries(fix.dropOne).map(([k, s]) => [k, s.size]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!binding.length) console.log("  (none: every blocked token trips at least two rules)");
  for (const [k, n] of binding) console.log(`  ${P(k)} +${n}`);
  if (gate) { console.log(`\nReplica vs real checkDisqualifiers mismatches: recorded ${rec.mismatch}/${N}, recomputed ${fix.mismatch}/${N}`); fix.mmEx.forEach(x => console.log("  " + x)); }
}

report(FILE || await collect()).catch(e => { console.error(e); process.exit(1); });
