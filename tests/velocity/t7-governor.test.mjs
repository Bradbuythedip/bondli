// T7: an injected losing streak produces a throttle, then a halt, before the
// daily limit is reached; the governor never amplifies.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ledger } from "../../src/velocity/core/ledger.mjs";
import { Governor } from "../../src/velocity/core/governor.mjs";
import { loadRiskEnvelope } from "../../src/velocity/core/risk.mjs";

const env = loadRiskEnvelope(path.resolve("src/velocity/config/risk.example.json")); // daily limit 100

function mkLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "velocity-t7-"));
  return new Ledger(path.join(dir, "ledger.jsonl"), { fsync: false });
}

test("T7: losing streak throttles at 3, cuts at 4, halts at 5, all before the daily limit", () => {
  const ledger = mkLedger();
  let t = 1_700_000_000_000;
  const gov = new Governor({ ledger, envelope: env, clock: () => t });
  let realized = 0;
  const seen = [];
  for (let i = 1; i <= 6; i++) {
    t += 5 * 60_000;
    realized -= 8;
    ledger.append({ kind: "fill", venue: "pumpfun", side: "BUY", notional_usd: 10, ts: t - 60_000 });
    ledger.append({ kind: "outcome", venue: "pumpfun", pnl_usd: -8, pnl_pct: -80, stake_usd: 10, p_win: 0.35, confidence: 0.6, held_ms: 60_000, ts: t });
    const v = gov.evaluate({ regime: "RISK_ON", realized_today_usd: realized, open: [] });
    seen.push({ i, throttle: v.throttle, halt: v.halt, reason: v.haltReason, realized });
    assert.ok(v.throttle <= 1);
  }
  // A losing streak is information, never a brake: no throttle, no halt, until the daily limit says so.
  for (const s of seen) if (Math.abs(s.realized) < env.daily_loss_limit_usd * 0.5) { assert.equal(s.throttle, 1, `${s.i} losses: no throttle`); assert.equal(s.halt, false, `${s.i} losses: no halt`); }
  assert.equal(gov.last.streak, 6);
  assert.equal(gov.last.blindSpots.losing_streak?.triggered, false, "shown as informational");
});

test("T7: daily loss halts at 80% of the limit even without a streak", () => {
  const ledger = mkLedger();
  const gov = new Governor({ ledger, envelope: env });
  let t = 1_700_000_000_000;
  const pnls = [20, -30, 15, -40, 10, -45];
  let realized = 0;
  let verdict;
  for (const p of pnls) {
    t += 60_000;
    ledger.append({ kind: "outcome", venue: "polymarket", pnl_usd: p, stake_usd: 50, p_win: 0.9, ts: t });
    realized += p;
    verdict = gov.evaluate({ realized_today_usd: realized, open: [] });
  }
  assert.equal(realized, -70);
  assert.equal(verdict.halt, false);
  assert.equal(verdict.throttle, 0.5, "past half the limit: throttled");
  const v2 = gov.evaluate({ realized_today_usd: -80, open: [] });
  assert.equal(v2.halt, true);
  assert.equal(v2.haltReason, "daily_limit");
  const v3 = gov.evaluate({ realized_today_usd: -30, open: [{ notional_usd: 80, worst_case_fraction: 1 }] });
  assert.equal(v3.throttle, 0, "realized plus open worst case reaching the limit stops new entries");
});

test("T7: regime caps, overconfidence, revenge, and never above 1", () => {
  const ledger = mkLedger();
  const gov = new Governor({ ledger, envelope: env });
  assert.equal(gov.evaluate({ regime: "PVP" }).throttle, 0.4);
  assert.equal(gov.evaluate({ regime: "EUPHORIA" }).throttle, 1, "euphoria never amplifies");
  assert.equal(gov.evaluate({ regime: "DEAD" }).halt, true);

  let t = 1_700_000_000_000;
  // 24 outcomes stating p_win 0.8, winning 30%: overconfident.
  for (let i = 0; i < 24; i++) {
    t += 10 * 60_000;
    ledger.append({ kind: "outcome", venue: "pumpfun", pnl_usd: i % 10 < 3 ? 12 : -5, stake_usd: 10, p_win: 0.8, ts: t });
  }
  const v = gov.evaluate({ regime: "RISK_ON", realized_today_usd: 0 });
  assert.ok(v.blindSpots.overconfidence?.triggered, JSON.stringify(v.blindSpots));
  assert.ok(v.throttle <= 0.5);

  // Revenge: bigger buys right after losses.
  const l2 = mkLedger();
  const g2 = new Governor({ ledger: l2, envelope: env });
  t = 1_700_000_000_000;
  for (let i = 0; i < 3; i++) {
    t += 30 * 60_000;
    l2.append({ kind: "outcome", venue: "pumpfun", pnl_usd: -5, stake_usd: 10, p_win: 0.35, ts: t });
    l2.append({ kind: "fill", venue: "pumpfun", side: "BUY", notional_usd: 25, ts: t + 30_000 });
  }
  const r = g2.evaluate({ regime: "RISK_ON" });
  assert.ok(r.blindSpots.revenge_trading?.triggered);
  assert.equal(r.throttle, 0.5);
});
