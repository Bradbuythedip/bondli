// t49 — Ink is a venue.
//
// It trades bondli's own launchpad, which is the PONS curve on a different chain, so almost nothing
// here is new code: the point of these is that the deployment is what differs and the behaviour is
// not. What IS specific to Ink is that the launchpad may not be deployed yet, and every path has to
// treat that as "this venue is off" rather than "this trade failed".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { InkLiveRouter, InkPaperRouter } from "../../src/velocity/venues/ink/router.mjs";
import { InkFeed } from "../../src/velocity/venues/ink/feed.mjs";
import { PonsLiveRouter, PonsPaperRouter } from "../../src/velocity/venues/pons/router.mjs";
import { INK } from "../../src/velocity/venues/ink/chain.mjs";
import { PONS } from "../../src/velocity/venues/pons/chain.mjs";
import { QUOTE_OF, userEnvelope } from "../../src/velocity/hub.mjs";

const FACTORY = "0x" + "1f".repeat(20);
const KEY = "0x" + "7".repeat(64);

function withFactory(fn) {
  const before = process.env.INK_LAUNCHPAD_FACTORY;
  process.env.INK_LAUNCHPAD_FACTORY = FACTORY;
  try { return fn(); } finally { if (before == null) delete process.env.INK_LAUNCHPAD_FACTORY; else process.env.INK_LAUNCHPAD_FACTORY = before; }
}
function withoutFactory(fn) {
  const before = process.env.INK_LAUNCHPAD_FACTORY;
  delete process.env.INK_LAUNCHPAD_FACTORY;
  try { return fn(); } finally { if (before != null) process.env.INK_LAUNCHPAD_FACTORY = before; }
}

test("the Ink routers are the curve routers, bound to Ink", () => {
  const paper = new InkPaperRouter({ bookFile: path.join(fs.mkdtempSync("/tmp/t49-"), "b.json") });
  assert.equal(paper.venue, "ink");
  assert.equal(paper.d, INK);
  const live = new InkLiveRouter({ secret: KEY });
  assert.equal(live.venue, "ink");
  assert.equal(live.mode, "live");
  assert.equal(live.d.chainId, 57073);
  assert.equal(live.d.secretEnv, "INK_PRIVATE_KEY");
  // The same class serves both chains; only the record differs. That is the whole design.
  assert.equal(Object.getPrototypeOf(InkLiveRouter), Object.getPrototypeOf(PonsLiveRouter));
  assert.equal(Object.getPrototypeOf(InkPaperRouter), Object.getPrototypeOf(PonsPaperRouter));
  assert.equal(new PonsLiveRouter({ secret: KEY }).d.chainId, 4663, "and PONS is untouched by Ink existing");
});

test("a live router refuses to start against a launchpad that is not deployed", async () => {
  await withoutFactory(async () => {
    const r = new InkLiveRouter({ secret: KEY });
    await assert.rejects(() => r.init(), /no launchpad factory configured \(set INK_LAUNCHPAD_FACTORY\)/,
      "without this every order is built at an address with no code and comes back a revert");
    assert.equal(r.ready, false);
  });
  // A missing key is still its own error, named for the variable that fixes it.
  await withFactory(async () => {
    const before = process.env.INK_PRIVATE_KEY;
    delete process.env.INK_PRIVATE_KEY;
    try { await assert.rejects(() => new InkLiveRouter({}).init(), /INK_PRIVATE_KEY/); }
    finally { if (before != null) process.env.INK_PRIVATE_KEY = before; }
  });
});

test("the feed polls at the chain's rate, not a constant", () => {
  const feed = new InkFeed({ rpc: {} });
  assert.equal(feed.venue, "ink");
  assert.equal(feed.name, "ink-feed");
  // Ink makes a block a second. A radar slower than the chain misses launches outright, and on a
  // venue where we are the launchpad that means missing our own.
  assert.equal(feed.pollMs, 1_000);
  assert.equal(INK.blockMs, 1_000);
  assert.equal(feed.d.tokenSupply, 1_000_000_000);
  // An explicit interval still wins, for an operator on a rate-limited endpoint.
  assert.equal(new InkFeed({ rpc: {}, pollMs: 4_000 }).pollMs, 4_000);
});

test("the hub knows Ink's quote asset and sizes it like any other opt-in venue", () => {
  assert.equal(QUOTE_OF.ink, "ETH");
  const on = userEnvelope({ bankrollUsd: 1000, ink: true });
  const off = userEnvelope({ bankrollUsd: 1000 });
  assert.ok(on.venues.ink.max_exposure_usd > 0, "opted in, it is sized");
  assert.equal(off.venues.ink.max_exposure_usd, 0, "off by default: a venue with no exposure is never entered");
  assert.equal(off.venues.ink.max_concurrent, 0);
  assert.equal(on.venues.ink.max_exposure_usd, on.venues.pons.max_exposure_usd || on.venues.ink.max_exposure_usd);
  assert.equal(on.venues.ink.min_stake_usd, on.venues.pumpfun.min_stake_usd, "the same floor: the drag is the same arithmetic");
});

test("an undeployed launchpad turns the venue off rather than failing one trade at a time", () => {
  const HUB = fs.readFileSync(path.resolve("src/velocity/hub.mjs"), "utf8");
  assert.match(HUB, /const ink = !!settings\.ink && !!this\.inkFeed && !!evmSecret && INK\.configured\(\);/);
  // Every start path counts it, or a user who turned only Ink on would be told to turn a chain on.
  assert.match(HUB, /if \(!pumpfun && !pons && !arc && !ink\)/);
  assert.match(HUB, /const wanted = \[pumpfun && "pumpfun", pons && "pons", arc && "arc", ink && "ink"\]/);
  assert.match(HUB, /venues\.ink = \{ mode: "paper",/, "it starts in paper like every other venue");
  assert.match(HUB, /paper-book-ink\.json/, "with its own book");
});

test("the risk envelope has a place for Ink, with a confirmation budget the chain earns", () => {
  const cfg = JSON.parse(fs.readFileSync("src/velocity/config/risk.example.json", "utf8"));
  assert.ok(cfg.venues.ink, "a venue the envelope does not know cannot be sized");
  assert.equal(cfg.venues.ink.max_exposure_usd, 0, "shipped off");
  assert.equal(cfg.venues.ink.min_stake_usd, cfg.venues.pons.min_stake_usd);
  assert.ok(cfg.venues.ink.latency_budget_ms.confirm < cfg.venues.pons.latency_budget_ms.confirm,
    "one-second blocks confirm faster than two-second ones, and a budget that does not say so is a budget that never fires");
});
