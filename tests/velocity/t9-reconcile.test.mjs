// T9: kill -9 with an open paper position; restart reconciles from the ledger
// and the paper book, adopts the position with a plan, and exits still fire.
// Also: the engine end to end in paper mode, with every stage in the ledger.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine } from "../../src/velocity/core/engine.mjs";
import { loadRiskEnvelope } from "../../src/velocity/core/risk.mjs";
import { ScriptedFeed } from "../../src/velocity/core/feed.mjs";
import { makeEvent } from "../../src/velocity/core/events.mjs";
import { makePumpfunEdge } from "../../src/velocity/venues/pumpfun/edge.mjs";
import { PumpfunPaperRouter } from "../../src/velocity/venues/pumpfun/router.mjs";
import { Supervisor } from "../../src/velocity/core/supervisor.mjs";
import { goodCandidatePayload, tickPayload } from "./helpers/fixtures.mjs";

const envelope = loadRiskEnvelope(path.resolve("src/velocity/config/risk.example.json"));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "velocity-t9-"));

function mkEngine(dataDir, feed, config = {}) {
  return new Engine({ dataDir, envelope, venues: { pumpfun: { mode: "paper", feed, edge: makePumpfunEdge(), router: new PumpfunPaperRouter({ bookFile: path.join(dataDir, "paper-book-pumpfun.json"), latencyMs: 0 }) } }, config: { saveMs: 600_000, governorMs: 600_000, ...config } });
}

test("T9: SIGKILL with an open position, restart reconciles and exits fire", async () => {
  const dataDir = tmp();
  const child = spawn(process.execPath, [path.resolve("tests/velocity/helpers/crash-runner.mjs"), dataDir], { stdio: ["ignore", "pipe", "inherit"] });
  const posId = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("child never opened a position: " + buf)), 15_000);
    child.stdout.on("data", d => { buf += d; const m = /POSITION_OPEN (\S+)/.exec(buf); if (m) { clearTimeout(timer); resolve(m[1]); } });
  });
  child.kill("SIGKILL");
  await new Promise(r => child.on("exit", r));

  // The kill tore the snapshot mid-write: the store falls back to defaults, so the
  // ledger and the paper book are the only truth left. The ledger has the fill.
  fs.writeFileSync(path.join(dataDir, "state.json"), '{"version":1,"positions":{"' + posId + '":{"id":"');
  const fills = fs.readFileSync(path.join(dataDir, "ledger.jsonl"), "utf8").split("\n").filter(l => l.includes('"kind":"fill"'));
  assert.equal(fills.length, 1, "child recorded exactly one fill before the kill");
  const feed = new ScriptedFeed({ venue: "pumpfun", script: [] });
  const engine = mkEngine(dataDir, feed);
  try {
  const report = await engine.reconcile();
  assert.deepEqual(report.venues.pumpfun.adopted, ["MintCrash"]);
  const pos = engine.store.openPositions("pumpfun")[0];
  assert.equal(pos.id, posId, "adopted under the ledger's own position id");
  assert.ok(pos.plan && pos.plan.bondli.stopLoss > 0, "adopted position carries a plan");
  assert.equal(pos.tier, 2);
  await engine.start({ reconcile: false });

  const crash = makeEvent({ venue: "pumpfun", kind: "tick", id: "MintCrash", t_venue: Date.now() - 50, t_observed: Date.now(), payload: tickPayload("MintCrash", 17_000, { dynamics: { scores: 5, velocity: -0.6, acceleration: -0.2, trend: "crashing" } }) });
  await engine.enqueue(() => engine.onEvent(crash));
  assert.equal(engine.store.openPositions().length, 0, "exit fired on the adopted position");
  const outcome = engine.ledger.query({ kind: "outcome", limit: 1 })[0];
  assert.equal(outcome.reason, "crash-exit");
  assert.equal(outcome.positionId, posId);
  } finally { await engine.stop(); }
});

test("T9: paper mode end to end writes every stage and blocks entries on a stale feed", async () => {
  const dataDir = tmp();
  const feed = new ScriptedFeed({ venue: "pumpfun", script: [] });
  const engine = mkEngine(dataDir, feed, { reentryCooldownMs: 0 });
  try {
  await engine.start({ reconcile: true });
  const now = Date.now();
  const cand = makeEvent({ venue: "pumpfun", kind: "candidate", id: "MintE2E", t_venue: now - 100, t_observed: now, payload: goodCandidatePayload("MintE2E") });
  await engine.enqueue(() => engine.onEvent(cand));
  const kinds = engine.ledger.readAll().map(r => r.kind + (r.stage ? ":" + r.stage : ""));
  for (const k of ["reconcile", "governor", "decision", "order:sized", "order:sent", "fill", "order:filled"]) assert.ok(kinds.includes(k), `ledger has ${k}: ${kinds}`);
  const fill = engine.ledger.query({ kind: "fill", limit: 1 })[0];
  assert.ok(fill.plan && fill.plan.key === 2, "fill record carries the plan");
  assert.equal(engine.store.openPositions().length, 1);
  assert.equal(engine.status().positions[0].instrument, "MintE2E");
  assert.ok(feed.watched.has("MintE2E"), "feed watches the held instrument");

  // Same instrument again: refused, nothing sent.
  await engine.enqueue(() => engine.onEvent(makeEvent({ venue: "pumpfun", kind: "candidate", id: "MintE2E", t_venue: now, t_observed: now + 10, payload: goodCandidatePayload("MintE2E") })));
  assert.equal(engine.ledger.query({ kind: "order", limit: 1 })[0].reason, "ALREADY_IN_OR_INFLIGHT");

  // Ride mode: +150% takes nothing off the table, so no exit is written on the way up.
  await engine.enqueue(() => engine.onEvent(makeEvent({ venue: "pumpfun", kind: "tick", id: "MintE2E", t_venue: now + 500, t_observed: now + 600, payload: tickPayload("MintE2E", 25_000) })));
  assert.equal(engine.ledger.query({ kind: "exit", limit: 1 }).length, 0, "nothing is scalped on the way up");
  assert.equal(engine.store.openPositions().length, 1, "the whole position is still on");
  await engine.enqueue(() => engine.onEvent(makeEvent({ venue: "pumpfun", kind: "tick", id: "MintE2E", t_venue: now + 900, t_observed: now + 1000, payload: tickPayload("MintE2E", 4_000) })));
  assert.equal(engine.store.openPositions().length, 0);
  const finalExit = engine.ledger.query({ kind: "exit", limit: 1 })[0];
  assert.equal(finalExit.final, true, "it leaves in one sell, which is what makes the rent reclaimable");
  const outcome = engine.ledger.query({ kind: "outcome", limit: 1 })[0];
  assert.ok(Number.isFinite(outcome.pnl_usd));
  assert.ok(outcome.features, "outcome carries the entry features for the learner");
  // Paper mode: the trade is counted, but against the paper ledger, not the real daily loss budget.
  assert.equal(engine.store.state.day.paperTrades, 1);
  assert.equal(engine.store.state.day.trades, 0, "no real money moved");
  assert.equal(engine.store.state.day.realizedUsd, 0);
  // With no live venue, the limit and the governor still act on the simulated number.
  assert.equal(engine.realizedToday(), engine.store.state.day.paperRealizedUsd);

  // Stale feed blocks new entries; a halt freezes; flatten closes.
  feed.lastEventAt = Date.now() - 60_000; feed.eventsEmitted = 1;
  const sup = new Supervisor({ engine, dataDir });
  await sup.watchdog();
  assert.equal(engine.blocked.pumpfun, "FEED_STALE");
  await engine.enqueue(() => engine.onEvent(makeEvent({ venue: "pumpfun", kind: "candidate", id: "MintLate", t_venue: now + 2000, t_observed: now + 2100, payload: goodCandidatePayload("MintLate") })));
  const blocked = engine.ledger.query({ kind: "decision", limit: 1 })[0];
  assert.equal(blocked.gate, "governor"); assert.match(blocked.reasons[0], /FEED_STALE/);
  delete engine.blocked.pumpfun; feed.lastEventAt = Date.now();
  await engine.enqueue(() => engine.onEvent(makeEvent({ venue: "pumpfun", kind: "candidate", id: "MintLate", t_venue: now + 3000, t_observed: now + 3100, payload: goodCandidatePayload("MintLate") })));
  assert.equal(engine.store.openPositions().length, 1);
  await engine.halt("freeze", "test");
  await engine.enqueue(() => engine.onEvent(makeEvent({ venue: "pumpfun", kind: "candidate", id: "MintFrozen", t_venue: now + 4000, t_observed: now + 4100, payload: goodCandidatePayload("MintFrozen") })));
  assert.equal(engine.store.openPositions().length, 1, "frozen: no new entries");
  fs.writeFileSync(path.join(dataDir, "HALT"), "flatten");
  await sup.watchdog();
  assert.equal(engine.store.openPositions().length, 0, "HALT file flattened");
  assert.equal(engine.ledger.query({ kind: "halt", limit: 1 })[0].by, "file");
  assert.throws(() => engine.resume(), /venue name/);
  engine.resume("pumpfun");
  assert.equal(engine.store.isHalted(), null);
  const why = engine.why("last");
  assert.ok(Array.isArray(why) && why.length >= 1);
  } finally { await engine.stop(); }
});
