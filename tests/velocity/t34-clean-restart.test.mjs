// T34: what a restart is allowed to remember. A bot that is stopped and started again used to come
// back holding positions it could not sell and with every cooldown forgotten, so the first thing it
// did was re-buy the name it had just stopped out of. This pins the other half of the same story:
// the dip is the entry a hosted bot takes unless its operator says otherwise, and a dip's stop sits
// under the low it bought above rather than at the table's round number.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../../src/velocity/core/store.mjs";
import { Engine } from "../../src/velocity/core/engine.mjs";
import { loadRiskEnvelope } from "../../src/velocity/core/risk.mjs";
import { dipStopPct, DIP_STOP, planFor } from "../../src/velocity/core/plans.mjs";
import { createPlan } from "../../src/velocity/core/exits.mjs";
import { pushTrack, dipSignal, DIP_DEFAULTS } from "../../src/api/dip.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "velocity-t34-"));
const MIN = 60_000, T0 = 1_800_000_000_000;

/** An engine with no venues: enough to own a store, a clock and the cooldown map. */
function engineOn(dir, config = {}) {
  const file = path.join(dir, "risk.json");
  if (!fs.existsSync(file)) fs.copyFileSync(path.resolve("src/velocity/config/risk.example.json"), file);
  return new Engine({
    dataDir: dir,
    envelope: loadRiskEnvelope(file),
    venues: {},
    config: { saveMs: 600_000, governorMs: 600_000, sweepMs: 600_000, reentryCooldownMs: 10 * MIN, ...config },
  });
}

test("T34: a cooldown escalates on every completed round trip and retires the name", () => {
  const dir = tmp();
  const e = engineOn(dir);
  let now = T0;
  e.clock = () => now;
  const base = 10 * MIN;

  // The first exit is the plain cooldown: one round trip, no multiplier yet.
  assert.equal(e.coolOff("MintA", base, { exit: true }), T0 + base);
  // The second doubles it, the third doubles again -- and the third is also maxTouches, so instead
  // of a multiple of ten minutes the name is finished until the day rolls.
  now = T0 + base;
  assert.equal(e.coolOff("MintA", base, { exit: true }), now + 2 * base);
  now += 2 * base;
  assert.equal(e.coolOff("MintA", base, { exit: true }), e.store.dayEndsAt(now), "retired for the day at maxTouches");
  assert.equal(e.store.state.touches.MintA.n, 3);

  // A send that failed is not a round trip: it buys a pause, it does not count toward retirement.
  assert.equal(e.coolOff("MintB", base).valueOf(), now + base);
  assert.equal(e.store.state.touches.MintB, undefined, "a failure leaves no touch");
  // And a cooldown never shortens: a shorter one arriving later loses to the one already set.
  assert.equal(e.coolOff("MintB", MIN), now + base);
});

test("T34: a restart reads its cooldowns back, and drops the expired ones", async () => {
  const dir = tmp();
  let now = T0;
  const a = engineOn(dir);
  a.clock = () => now;
  a.coolOff("MintLive", 60 * MIN, { exit: true });
  a.coolOff("MintStale", 5 * MIN, { exit: true });
  a.store.save();

  // Ten minutes later a new process starts on the same directory. One cooldown still has time on it
  // and one does not; the bot must come back holding the first and must not be carrying the second.
  now = T0 + 10 * MIN;
  const b = engineOn(dir);
  b.clock = () => now;
  await b.start({ reconcile: false });
  try {
    assert.equal(b.cooldown.get("MintLive"), T0 + 60 * MIN, "still cooling, and the restart knows it");
    assert.equal(b.cooldown.has("MintStale"), false, "expired, and not carried");
    assert.equal(b.store.state.cooldown.MintStale, undefined, "nor left in the file");
    assert.equal(b.store.state.touches.MintStale, undefined);
  } finally { await b.stop?.({ flatten: false }).catch?.(() => {}); }
});

test("T34: the persisted state is bounded -- closed positions are pruned, open ones never", () => {
  const dir = tmp();
  const s = new Store(path.join(dir, "state.json"));
  for (let i = 0; i < 260; i++) s.upsertPosition({ id: "c" + i, instrument: "M" + i, status: "closed", closedAt: T0 + i });
  s.upsertPosition({ id: "open1", instrument: "MOpen", status: "open" });
  const dropped = s.prunePositions(200);
  assert.equal(dropped, 60);
  assert.equal(Object.values(s.state.positions).filter(p => p.status !== "open").length, 200);
  assert.ok(s.state.positions.open1, "an open position is never pruned");
  // The newest closes are the ones kept: those are the ones a panel still asks about.
  assert.ok(s.state.positions.c259, "the most recent close survives");
  assert.equal(s.state.positions.c0, undefined, "the oldest does not");
});

test("T34: a dip's stop sits under the low it bought above", () => {
  // Bought at 19,500 after a low of 17,000: that is 12.8% down to the low, so the stop has to clear
  // it, not sit at the plan's 14% and get taken out by a retest.
  const planStop = planFor("pumpfun", "dip").stop_pct;
  assert.equal(planStop, 14);
  const stop = dipStopPct(planStop, { entryMcap: 19500, lowMcap: 17000 });
  assert.ok(stop > 12.82 + DIP_STOP.bufferPct - 0.01 && stop <= DIP_STOP.maxPct, `stop ${stop}`);
  assert.ok(stop > planStop, "and it is wider than the table's round number");
  // A shallow dip never tightens the stop below what the plan asked for.
  assert.equal(dipStopPct(planStop, { entryMcap: 19500, lowMcap: 19400 }), planStop);
  // Nor does it run away: a token bought far above its low is capped rather than given a 40% leash.
  assert.equal(dipStopPct(planStop, { entryMcap: 19500, lowMcap: 8000 }), DIP_STOP.maxPct);
  // Missing or nonsensical references leave the plan exactly as it was.
  assert.equal(dipStopPct(planStop, {}), planStop);
  assert.equal(dipStopPct(planStop, { entryMcap: 19500, lowMcap: 25000 }), planStop);

  // And the plan built for a real dip entry carries it, while a launch entry is untouched.
  const dip = createPlan({ venue: "pumpfun", key: "dip", entry: { mcapUsd: 19500, dipLowMcap: 17000 } });
  const plain = createPlan({ venue: "pumpfun", key: "dip", entry: { mcapUsd: 19500 } });
  assert.notDeepEqual(dip.bondli, plain.bondli, "the dip entry's exit plan is not the table's");
});

test("T34: a dip needs a discount left and a bounce that held", () => {
  const track = points => {
    const t = [];
    for (const [min, mc] of points) pushTrack(t, T0 + min * MIN, mc, { cv: 0.3 + min * 0.02 });
    return t;
  };
  const at = (t, min) => dipSignal({ ca: "MintT34", createdAt: T0, mcapUsd: t[t.length - 1].mc, devWallet: "devwallet", _track: t, _curvePct: 0.52, trades: Array.from({ length: 8 }, (_, i) => ({ side: "buy", sol: 0.5, wallet: "w" + i, time: T0 + (min - 1.5) * MIN + i * 1000 })) }, { now: T0 + min * MIN });

  // Ran, gave back, and turned up over two prints: this is the shape the entry exists for.
  const good = at(track([[0, 10000], [2, 15000], [4, 20000], [6, 24000], [8, 19000], [9, 17000], [10, 18200], [11, 19500]]), 11);
  assert.equal(good.dip, true, JSON.stringify(good.reasons));
  assert.ok(good.samplesSinceLow >= DIP_DEFAULTS.minSamplesSinceLow);

  // Same drawdown, fully recovered: the dip was real and the discount is gone. Buying here is buying
  // the peak with extra steps.
  const noDiscount = at(track([[0, 10000], [2, 15000], [4, 20000], [6, 24000], [8, 19000], [9, 17000], [10, 22000], [11, 24000]]), 11);
  assert.equal(noDiscount.dip, false);
  assert.ok(noDiscount.reasons.includes("NO_DISCOUNT_LEFT"), JSON.stringify(noDiscount.reasons));

  // One print above the low is a tick, not a turn.
  const oneTick = at(track([[0, 10000], [2, 15000], [4, 20000], [6, 24000], [8, 19000], [9, 17000], [10, 18200]]), 10);
  assert.equal(oneTick.dip, false);
  assert.ok(oneTick.reasons.includes("BOUNCE_HAS_NOT_HELD"), JSON.stringify(oneTick.reasons));
});

test("T34: the dip is the hosted default, and the library stays permissive", () => {
  // Two different defaults on purpose. The edge is a library and must still serve a caller that
  // wants launches; the product decision lives in one place, where an operator's settings are read.
  const HUB = fs.readFileSync("src/velocity/hub.mjs", "utf8");
  assert.match(HUB, /const entries = settings\.entries === "all" \? "all" : "dips";/);
  const EDGE = fs.readFileSync("src/velocity/venues/pumpfun/edge.mjs", "utf8");
  assert.match(EDGE, /entries = "all",/);

  // The stop hands back whatever the flatten could not sell rather than leaving it open in the book,
  // which is what made a restart show positions belonging to a bot that was not running.
  assert.match(HUB, /releasePosition\(p\.id, \{ by: "user", note: "the stop could not sell it; the tokens are in your wallet" \}\)/);
  assert.match(HUB, /return \{ ok: true, closed[^}]*released \};/);

  // And the site's toggle is on unless it was deliberately turned off.
  const SITE = fs.readFileSync("app/src/Simple.jsx", "utf8");
  assert.match(SITE, /localStorage\.getItem\("bondli_dips"\) !== "0"/);
  assert.match(SITE, /entries: dipsOnly \? "dips" : "all" \}\)/);
});
