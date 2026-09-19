// T40: a feed that has just started is not a feed that is down, and a quiet chain is not a broken one.
//
// From an operator's log, two seconds after pressing start:
//   01:55:03 resume  pumpfun (user)
//   01:55:05 ALERT   warn: arc: entries blocked (FEED_NO_DATA); exits keep running
//   01:55:05 ALERT   warn: pons: entries blocked (FEED_NO_DATA); exits keep running
// The watchdog runs every two seconds. Arc polls every 1.5s and Robinhood Chain every 3s, so at the
// first check neither could possibly have produced anything yet -- and the test for "down" was
// "eventsEmitted === 0", which is also what a perfectly healthy chain with no launches on it looks
// like. Both venues were blocked on every start, and stayed blocked through every quiet stretch.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Feed } from "../../src/velocity/core/feed.mjs";
import { Supervisor } from "../../src/velocity/core/supervisor.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "velocity-t40-"));

/** An engine with just enough shape for the watchdog to walk one venue. */
function rig(feed, { now = () => NOW } = {}) {
  const ledger = [];
  const alerts = [];
  const engine = {
    venues: { arc: { feed } },
    blocked: {},
    routerFor: () => null,
    store: { state: { routers: {}, feeds: {} }, venueMode: () => "paper", openPositions: () => [] },
    ledger: { append: r => ledger.push(r) },
    enqueue: fn => fn(),
  };
  const sup = new Supervisor({ engine, dataDir: tmp(), clock: now, alerter: { send: (level, msg) => alerts.push(`${level}: ${msg}`) } });
  return { engine, sup, ledger, alerts };
}
let NOW = 1_800_000_000_000;

test("T40: a feed two seconds old is given time to answer", async () => {
  NOW = 1_800_000_000_000;
  const feed = new Feed({ venue: "arc", clock: () => NOW });
  feed.running = true;                       // started, no poll has returned yet
  const { engine, sup } = rig(feed);
  NOW += 2_000;                              // the watchdog's own interval
  await sup.watchdog();
  assert.equal(engine.blocked.arc, undefined, "not blocked while it is still warming up");
  assert.equal(engine.store.state.feeds.arc.warmingUp, true);
  // Past the grace with still no successful poll, it IS down and says so.
  NOW += sup.feedGraceMs;
  await sup.watchdog();
  assert.equal(engine.blocked.arc, "FEED_DOWN");
});

test("T40: a chain with nothing on it is working, not broken", async () => {
  // The whole of the old bug in one case: polls succeeding, no launches to report. Arc and Robinhood
  // Chain go minutes between launches, so this was the normal state and it blocked entries -- which
  // also means the first launch to arrive would have been refused until the next watchdog tick.
  NOW = 1_800_000_000_000;
  const feed = new Feed({ venue: "arc", clock: () => NOW });
  feed.running = true;
  const { engine, sup } = rig(feed);
  NOW += 10 * 60_000;
  feed.markHealth(true, "block 918, 0 candidates");   // a poll that worked and found nothing
  await sup.watchdog();
  assert.equal(feed.eventsEmitted, 0, "nothing has been emitted, and that is fine");
  assert.equal(engine.blocked.arc, undefined, "quiet is not down");
});

test("T40: a feed whose polls are failing is blocked, whatever it has emitted before", async () => {
  NOW = 1_800_000_000_000;
  const feed = new Feed({ venue: "arc", clock: () => NOW });
  feed.running = true;
  const { engine, sup, alerts, ledger } = rig(feed);
  NOW += sup.feedGraceMs + 1;
  feed.markHealth(false, "getLogs: 429");
  await sup.watchdog();
  assert.equal(engine.blocked.arc, "FEED_DOWN");
  assert.equal(alerts.length, 1, "and it is worth saying once");
  assert.match(alerts[0], /arc: entries blocked \(FEED_DOWN\)/);
  // Saying it once is the point: the old check flipped the state on every start.
  await sup.watchdog();
  assert.equal(alerts.length, 1, "not repeated while nothing has changed");
  // And it clears the moment a poll succeeds again.
  feed.markHealth(true, "block 920");
  await sup.watchdog();
  assert.equal(engine.blocked.arc, undefined);
  assert.equal(ledger.filter(r => r.kind === "feed").length, 2, "blocked, then cleared");
});

test("T40: the moment a feed came up is recorded wherever running is set", () => {
  // No venue calls super.start(); every one of them assigns this.running directly, so the stamp has
  // to live on the accessor or it would not exist for the two feeds this was actually about.
  NOW = 1_800_000_000_000;
  const feed = new Feed({ venue: "arc", clock: () => NOW });
  assert.equal(feed.startedAt, null);
  assert.equal(feed.upMs(), Infinity, "a feed that is not running has no age");
  feed.running = true;
  assert.equal(feed.startedAt, NOW);
  NOW += 5_000;
  assert.equal(feed.upMs(), 5_000);
  // Setting it true again does not restart the clock; stopping clears it.
  feed.running = true;
  assert.equal(feed.upMs(), 5_000);
  feed.running = false;
  assert.equal(feed.startedAt, null);
  for (const v of ["arc", "pons", "pumpfun"]) {
    const SRC = fs.readFileSync(`src/velocity/venues/${v}/feed.mjs`, "utf8");
    assert.match(SRC, /async start\(\) \{\n\s+this\.running = true;/, `${v} assigns running directly`);
  }
});
