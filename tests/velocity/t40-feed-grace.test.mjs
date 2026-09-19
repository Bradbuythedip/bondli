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

test("T40: a view of a shared feed reports the shared feed's health, not a copy of it", async () => {
  // One radar serves every user through a SharedFeedView, and the view used to take a COPY of the
  // shared feed's health at the moment it attached:
  //     async start() { ...; this.healthy = this.shared.healthy; }
  // The shared feed calls markHealth(true) on every successful poll and the view never heard about
  // it. A view that attached before the first poll returned -- which is every view, because starting
  // a bot is what starts the feeds -- read as unhealthy for as long as it lived. All three venues go
  // through this class, which is why all three went down together, thirty seconds after start:
  //     02:02:19 blocked pumpfun: FEED_DOWN
  //     02:02:19 blocked pons: FEED_DOWN
  //     02:02:20 blocked arc: FEED_DOWN
  const { SharedFeedView } = await import("../../src/velocity/hub.mjs");
  NOW = 1_800_000_000_000;
  const shared = new Feed({ venue: "pumpfun", clock: () => NOW });
  shared.running = true;
  const view = new SharedFeedView(shared, { clock: () => NOW });
  await view.start();
  assert.equal(view.healthy, false, "nothing has polled yet");

  const { engine, sup } = rig(view);
  engine.venues = { pumpfun: { feed: view } };
  NOW += sup.feedGraceMs + 1;
  shared.markHealth(true, "poll ok (60 scored, 3 changed)");
  await sup.watchdog();
  assert.equal(view.healthy, true, "the view sees the poll that succeeded");
  assert.equal(engine.blocked.pumpfun, undefined, "and is not blocked for it");

  // It follows the shared feed down as well as up.
  shared.markHealth(false, "radar unreachable");
  await sup.watchdog();
  assert.equal(engine.blocked.pumpfun, "FEED_DOWN");
  shared.markHealth(true, "poll ok");
  await sup.watchdog();
  assert.equal(engine.blocked.pumpfun, undefined);

  // The view's grace is the FEED's uptime: a bot starting against a radar that has been up an hour
  // is not looking at something that needs warming up.
  const late = new SharedFeedView(shared, { clock: () => NOW });
  await late.start();
  assert.equal(late.upMs(), shared.upMs());
  assert.ok(late.upMs() > sup.feedGraceMs, "it inherits the feed's age, not its own");
});
