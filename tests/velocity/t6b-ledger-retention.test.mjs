// T6b: the statistics window is the ledger's to keep, not the feed's to spend.
// Every realized number the bot prices itself with -- modeStats, the governor's
// taper, the per-plan buckets -- is query({ kind: "outcome" }) under the hood.
// While outcomes shared one ring with decisions, a busy hour of REJECTs evicted
// them, so the fourteen days the statistics promised were however many hours the
// feed's reject rate left. These tests hold the promise to the record instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ledger, KIND_LIMITS } from "../../src/velocity/core/ledger.mjs";

function tmpFile(tag) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `velocity-t6b-${tag}-`)), "ledger.jsonl");
}

// What query() promised before any of this: newest `limit` matching records,
// oldest-first, stopping at `since`. Run against the whole append log it is the
// answer a ledger that never forgot anything would give.
function oracle(all, { kind, venue, limit = 100, since = 0 } = {}) {
  const out = [];
  for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
    const r = all[i];
    if (r.seq <= since) break;
    if (kind && r.kind !== kind) continue;
    if (venue && r.venue !== venue) continue;
    out.push(r);
  }
  return out.reverse();
}

test("T6b: a burst of rejected candidates cannot evict a single outcome", () => {
  const file = tmpFile("evict");
  const ledger = new Ledger(file, { fsync: false, now: () => 1_000 });

  let outcomes = 0;
  for (let i = 0; i < 40_000; i++) {
    ledger.append({ kind: "decision", id: `d${i}`, venue: "pumpfun", action: "REJECT", reasons: ["no edge"] });
    // fifty real trades scattered through the noise, one per eight hundred looks
    if (i % 800 === 0) {
      ledger.append({ kind: "outcome", id: `o${outcomes}`, venue: "pumpfun", plan_key: "dip", pnl_usd: -1.5, paper: false });
      outcomes++;
    }
  }
  assert.equal(outcomes, 50);

  const kept = ledger.query({ kind: "outcome", limit: 200 });
  assert.equal(kept.length, 50, "all fifty outcomes are still there after 40k decisions");
  assert.equal(kept[0].id, "o0", "oldest first, and the oldest is the first trade");
  assert.equal(kept[49].id, "o49");
  // the decisions did rotate -- that ring is doing its job
  assert.equal(ledger.recent.length, ledger.recentLimit);

  // and the same holds after a restart replays the file from disk
  const reopened = new Ledger(file, { fsync: false });
  assert.equal(reopened.query({ kind: "outcome", limit: 200 }).length, 50);
  assert.equal(reopened.seq, ledger.seq);
});

test("T6b: the one-ring ledger really did lose them", () => {
  // The witness for the test above. Handing the ledger no per-kind rings gives
  // back exactly the ledger we had: one ring, every kind sharing it. Same forty
  // thousand looks, same fifty trades, and the record of the fifty comes back
  // short -- silently, with nothing in the answer saying it was truncated. If
  // this ever stops losing records, the test above has stopped proving anything.
  const ledger = new Ledger(tmpFile("witness"), { fsync: false, kindLimits: {} });
  let outcomes = 0;
  for (let i = 0; i < 40_000; i++) {
    ledger.append({ kind: "decision", id: `d${i}`, venue: "pumpfun", action: "REJECT", reasons: ["no edge"] });
    if (i % 800 === 0) ledger.append({ kind: "outcome", id: `o${outcomes++}`, venue: "pumpfun" });
  }
  assert.equal(outcomes, 50);
  assert.ok(ledger.query({ kind: "outcome", limit: 200 }).length < 50, "the old ring drops outcomes under feed pressure");
});

test("T6b: exits and fills survive the same burst", () => {
  const file = tmpFile("exitfill");
  const ledger = new Ledger(file, { fsync: false });
  for (let i = 0; i < 5; i++) {
    ledger.append({ kind: "fill", orderId: `o${i}`, venue: "pumpfun", side: "BUY", fee_usd: 0.1 });
    ledger.append({ kind: "exit", positionId: `p${i}`, venue: "pumpfun", reason: "STALL", fee_usd: 0.2 });
  }
  for (let i = 0; i < 30_000; i++)
    ledger.append({ kind: "decision", id: `x${i}`, venue: "pumpfun", action: "REJECT", reasons: ["dead"] });

  assert.equal(ledger.query({ kind: "fill", limit: 100 }).length, 5);
  assert.equal(ledger.query({ kind: "exit", limit: 100 }).length, 5);
  // the governor's fee arithmetic reads exits and fills together; both are whole
  assert.equal(ledger.query({ kind: "exit", limit: 100 }).reduce((s, e) => s + e.fee_usd, 0).toFixed(1), "1.0");
});

test("T6b: ordering, limit, venue and since are unchanged on a mixed stream", () => {
  const file = tmpFile("mixed");
  const ledger = new Ledger(file, { fsync: false });
  const all = [];
  const kinds = ["decision", "order", "fill", "exit", "outcome", "heartbeat", "governor"];
  for (let i = 0; i < 400; i++) {
    const kind = kinds[i % kinds.length];
    const rec = { kind, venue: i % 3 === 0 ? "pumpfun" : "arc", id: `r${i}` };
    if (kind === "order") rec.stage = "sized";
    all.push(ledger.append(rec));
  }
  assert.ok(all.length < ledger.retentionBudget(), "nothing evicted, so the oracle is the truth");

  const asks = [
    {},
    { limit: 1 },
    { limit: 400 },
    { limit: 1000 },
    { kind: "outcome" },
    { kind: "outcome", limit: 3 },
    { kind: "decision", limit: 7 },
    { kind: "fill", venue: "pumpfun" },
    { kind: "exit", venue: "arc", limit: 5 },
    { venue: "pumpfun", limit: 50 },
    { since: 0 },
    { since: 200 },
    { since: 399, limit: 400 },
    { since: 400 },
    { since: 10_000 },
    { kind: "outcome", since: 200, limit: 400 },
    { kind: "decision", venue: "arc", since: 100, limit: 20 },
  ];
  for (const ask of asks) {
    assert.deepEqual(ledger.query(ask), oracle(all, ask), `query(${JSON.stringify(ask)})`);
  }

  // the unfiltered ask walks four rings; it must still come back in seq order
  const feed = ledger.query({ limit: 400 });
  assert.equal(feed.length, 400);
  for (let i = 1; i < feed.length; i++) assert.ok(feed[i].seq > feed[i - 1].seq, "strictly ascending seq");
  assert.equal(feed[0].seq, 1);
  assert.equal(feed[399].seq, 400);
});

test("T6b: retention is bounded by the sum of the caps, not by uptime", () => {
  const file = tmpFile("bound");
  const ledger = new Ledger(file, { fsync: false });
  const budget = ledger.retentionBudget();
  assert.equal(budget, 20_000 + KIND_LIMITS.outcome + KIND_LIMITS.exit + KIND_LIMITS.fill);

  const kinds = ["decision", "outcome", "exit", "fill", "heartbeat"];
  for (let i = 0; i < 200_000; i++) {
    const kind = kinds[i % kinds.length];
    const rec = { kind, venue: "pumpfun", id: `b${i}` };
    ledger.append(rec);
    if (i % 25_000 === 0) assert.ok(ledger.retainedCount() <= budget, `bounded at append ${i}`);
  }
  assert.ok(ledger.retainedCount() <= budget, `retained ${ledger.retainedCount()} <= ${budget}`);
  // and it really is holding the full cap of each, not quietly dropping them
  assert.equal(ledger.query({ kind: "outcome", limit: 10_000 }).length, KIND_LIMITS.outcome);
  assert.equal(ledger.recent.length, ledger.recentLimit);
});

test("T6b: a kind spelled like an Object property does not find one", () => {
  const file = tmpFile("proto");
  const ledger = new Ledger(file, { fsync: false });
  ledger.append({ kind: "outcome", id: "o1", venue: "pumpfun" });
  // records come back off disk with whatever kind the line says; _remember must
  // not confuse "constructor" for a ring it owns
  fs.appendFileSync(file, JSON.stringify({ seq: 2, ts: 1, kind: "constructor", id: "weird" }) + "\n");
  const reopened = new Ledger(file, { fsync: false });
  assert.equal(reopened.query({ kind: "outcome", limit: 10 }).length, 1);
  assert.equal(reopened.query({ kind: "constructor", limit: 10 })[0].id, "weird");
});
