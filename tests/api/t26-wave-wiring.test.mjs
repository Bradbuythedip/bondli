// T26: the narrative wave is read where the copies are counted and reaches the edge, the exits and
// the site. The server file has no seam to render in isolation, so these pin the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_WEIGHTS, FEATURE_SIGNS, WEIGHT_CONSTRAINTS, SACRED_INVERSIONS } from "../../src/velocity/core/learner.mjs";

const SERVER = fs.readFileSync(path.resolve("src/api/server.production.mjs"), "utf8");
const FEED = fs.readFileSync(path.resolve("src/velocity/venues/pumpfun/feed.mjs"), "utf8");
const SITE = fs.readFileSync(path.resolve("app/src/Simple.jsx"), "utf8");

test("T26: the wave rides in the quick features, so the edge and the exits read the same reading", () => {
  assert.match(SERVER, /_wave: radar\._copycats\.wave\(t\.ca \|\| ca, Date\.now\(\)\),/);
  // The quick features are forwarded into the engine's payload, which is where the exits read qf._wave.
  assert.match(FEED, /qf: r\.qf \|\| null,/);
  // The live row carries the wave for the site, only for a Solana original with copies.
  assert.match(SERVER, /wave: !pons && !arc && t\._copies \? radar\._copycats\.wave\(t\.ca, now\) : null/);
  assert.match(SITE, /wave of \$\{t\.copies\}, \$\{t\.wave\.rising \? "building" : t\.wave\.fading \? "fading" : "steady"\}/);
});

test("T26: the learner's weight for it is bounded, positive, not sacred, and the weights still sum to one", () => {
  assert.equal(DEFAULT_WEIGHTS.pumpfun.waveLeader, 0.05);
  assert.equal(FEATURE_SIGNS.pumpfun.waveLeader, 1);
  assert.deepEqual(WEIGHT_CONSTRAINTS.pumpfun.waveLeader, { min: 0.02, max: 0.15 }, "a shill campaign looks like a wave, so it can never become a main signal");
  assert.equal(SACRED_INVERSIONS.pumpfun.waveLeader, undefined, "the learner may find waves count the other way");
  assert.ok(Math.abs(Object.values(DEFAULT_WEIGHTS.pumpfun).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(DEFAULT_WEIGHTS.pumpfun.smartMoney, 0.10, "taken from survivorMatch, not from the measured signals");
});
