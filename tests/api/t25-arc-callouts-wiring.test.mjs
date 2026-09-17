// T25: the Arc feed and the public callouts are wired where they must be. The server file has no
// seam to render in isolation, so these pin the source: the feed is built beside the PONS one and
// handed to the hub, its tokens reach the radar with their own chain, and a fill reaches the
// callouts through the hub with the buy's own transaction on it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SERVER = fs.readFileSync(path.resolve("src/api/server.production.mjs"), "utf8");
const HUB = fs.readFileSync(path.resolve("src/velocity/hub.mjs"), "utf8");
const ENGINE = fs.readFileSync(path.resolve("src/velocity/core/engine.mjs"), "utf8");
const SITE = fs.readFileSync(path.resolve("app/src/Simple.jsx"), "utf8");
const CLIENT = fs.readFileSync(path.resolve("app/src/lib/api-client.js"), "utf8");
const ENV = fs.readFileSync(path.resolve(".env.example"), "utf8");

test("T25: the Arc feed is built from ARC_RPC_URL, handed to the hub, started, and switchable off", () => {
  assert.match(SERVER, /const arcFeed = process\.env\.VELOCITY_ARC !== "0" \? new ArcFeed\(\{ rpcUrl: process\.env\.ARC_RPC_URL \|\| ARC_DEFAULT_RPC/);
  assert.match(SERVER, /feed: hubFeed, ponsFeed, arcFeed,/, "the hub receives the feed");
  assert.match(SERVER, /if \(arcFeed\) arcFeed\.start\(\)/);
  // Its trades join the same history the Solana and PONS trades feed, so revival and slow-cook can speak about Arc tokens.
  const ctor = SERVER.indexOf("new ArcFeed({");
  assert.match(SERVER.slice(ctor, ctor + 600), /onTrade: \(t, tr\) => radar\._revivals\.noteTrade/);
  // The hub keeps it beside the PONS feed and reports it on the health route.
  assert.match(HUB, /this\.arcFeed = arcFeed;/);
  assert.match(HUB, /arc: hub\.arcFeed \? \{ \.\.\.\(hub\.arcFeed\.status\?\.\(\) \|\| \{\}\), tokens: hub\.arcFeed\.tokens\?\.size \?\? null/);
  // The key never lives in the example file.
  assert.match(ENV, /# ARC_RPC_URL=https:\/\/arc-mainnet\.g\.alchemy\.com\/v2\/<key>/);
  assert.doesNotMatch(ENV, /alchemy\.com\/v2\/[A-Za-z0-9_-]{20,}/);
});

test("T25: Arc launches sit in the radar's list with their own chain and link, and count in the hour", () => {
  assert.match(SERVER, /const arcTokens = velocityHub\?\.arcFeed \? \[\.\.\.velocityHub\.arcFeed\.tokens\.values\(\)\] : \[\];/);
  assert.match(SERVER, /const both = \[\.\.\.all, \.\.\.ponsTokens, \.\.\.arcTokens\];/);
  assert.match(SERVER, /chain: pons \? "robinhood" : arc \? "arc" : "solana"/);
  assert.match(SERVER, /t\._source === "arc" \? arcUrl\.replace\("\{ca\}", t\.ca\)/);
  // Arc tokens are judged the way PONS tokens are: by what their own feed last decided, not by the Solana filters.
  assert.match(SERVER, /const pons = t\._source === "pons", arc = t\._source === "arc";[\s\S]{0,400}if \(pons \|\| arc\) \{/);
  assert.match(SERVER, /robinhood: ponsHour, arc: arcHour/);
  // The site shows the chain on the row and the count in the hour strip.
  assert.match(SITE, /t\.chain === "arc" \? "ARC" : "RH"/);
  assert.match(SITE, /d\.hour\.arc > 0 \? \[\["arc", d\.hour\.arc, "dm"\]\] : \[\]/);
});

test("T25: a fill reaches the callouts through the hub with the buy tx on it; the record is public and hub-wide", () => {
  // The position carries its buy transaction, which is the whole proof a callout offers.
  assert.match(ENGINE, /venue_ref: fill\.venue_ref \|\| null,\n    \};/);
  // One Callouts per hub, on its own ledger, injectable for tests.
  assert.match(HUB, /this\.callouts = callouts \|\| new Callouts\(\{\n\s+ledger: new Ledger\(path\.join\(rootDir, "_hub", "callouts\.jsonl"\)/);
  assert.match(HUB, /engine\.on\("position", p => \{ this\.callouts\.onFill\(p, \{ venue: p\.venue, tx: p\.venue_ref \|\| null, mcapUsd: p\.reference\?\.mcapUsd, tier: p\.tier, plan: p\.plan, paper: !!p\.paper \}\)\.catch\(\(\) => \{\}\); \}\);/);
  assert.match(HUB, /engine\.on\("outcome", \(\{ position: p, pnl \}\) => \{ this\.callouts\.onOutcome\(\{ position: p, pnl, instrument: p\.instrument, reason: p\.exitReason \}\)\.catch\(\(\) => \{\}\); \}\);/);
  // Channels come from the environment; none set still leaves the record on the site.
  assert.match(HUB, /webhookUrl: process\.env\.CALLOUT_WEBHOOK_URL \|\| null/);
  assert.match(HUB, /telegram: process\.env\.CALLOUT_TG_TOKEN && process\.env\.CALLOUT_TG_CHAT_ID \? \{ token: process\.env\.CALLOUT_TG_TOKEN, chatId: process\.env\.CALLOUT_TG_CHAT_ID \} : null/);
  // The public route is unauthenticated and answers from feed()/record() only: never status()'s lastError or a user.
  const route = HUB.indexOf('app.get("/api/callouts"');
  assert.ok(route > 0);
  const body = HUB.slice(route, route + 500);
  assert.doesNotMatch(body, /requireOwner/);
  assert.match(body, /calls: hub\.callouts\.feed\(limit\), record: hub\.callouts\.record\(\)/);
  assert.doesNotMatch(body, /lastError|wallet/);
  // The site has a Calls tab that reads it, and the client knows the route.
  assert.match(SITE, /\["calls", "Calls"\]/);
  assert.match(SITE, /tab === "calls" \? <Calls T=\{T\} \/>/);
  assert.match(SITE, /function Calls\(\{ T \}\)/);
  assert.match(CLIENT, /calls\(\) \{ return this\.f\("\/api\/callouts", \{ noauth: true/);
  assert.match(ENV, /# CALLOUT_WEBHOOK_URL=\n# CALLOUT_TG_TOKEN=\n# CALLOUT_TG_CHAT_ID=\n# CALLOUT_MIN_TIER=2/);
});
