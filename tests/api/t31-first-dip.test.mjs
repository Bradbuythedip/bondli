// T31: the first dip. A launch entry buys the crowd arriving; this one waits for the token to run on
// someone else's money, give some back, and be bought again. The read is pure, so it is tested on
// built price paths rather than on a live feed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pushTrack, dipSignal, gradSignal, convictionOf, TRACK, DIP_DEFAULTS } from "../../src/api/dip.mjs";
import { planFor } from "../../src/velocity/core/plans.mjs";
import { createPlan, evaluateExit } from "../../src/velocity/core/exits.mjs";
import { makePumpfunEdge, PUMPFUN_PRIORS } from "../../src/velocity/venues/pumpfun/edge.mjs";
import { statsFromOutcomes } from "../../src/velocity/core/stats.mjs";
import { goodCandidatePayload } from "../velocity/helpers/fixtures.mjs";

const MIN = 60_000, T0 = 1_800_000_000_000;

/** A price path as minutes-from-launch to market cap, with curve progress alongside. */
function track(points, { cv = m => 0.3 } = {}) {
  const t = [];
  for (const [min, mc] of points) pushTrack(t, T0 + min * MIN, mc, { cv: cv(min) });
  return t;
}
/** n wallets buying `sol` each, from `min` minutes on. */
function bought(n, min, { sol = 0.5, side = "buy", wallet = null } = {}) {
  return Array.from({ length: n }, (_, i) => ({ side, sol, wallet: wallet || "w" + i, time: T0 + min * MIN + i * 1000 }));
}
/** Ran to 24k by minute 6, back to 17k by minute 9, turning up at minute 11. */
const ranAndDipped = () => track([[0, 10000], [2, 15000], [4, 20000], [6, 24000], [7, 21000], [8, 19000], [9, 17000], [10, 18200], [11, 19500]], { cv: m => 0.3 + m * 0.02 });
const tok = (over = {}) => ({ ca: "MintD", createdAt: T0, mcapUsd: 19500, devWallet: "devwallet", _track: ranAndDipped(), _curvePct: 0.52, trades: bought(8, 9.5), ...over });

test("T31: the track keeps every extreme, stays bounded, and never moves a sample's start", () => {
  const t = [];
  pushTrack(t, T0, 1000, { cv: 0.1 });
  pushTrack(t, T0 + 5_000, 4000);   // inside the first interval: a spike, not a new sample
  pushTrack(t, T0 + 9_000, 500);
  pushTrack(t, T0 + 15_000, 1200);
  assert.equal(t.length, 1, "one interval, one sample");
  assert.deepEqual([t[0].t, t[0].mc, t[0].hi, t[0].lo], [T0, 1200, 4000, 500], "close, high and low of the interval; the start never moves");
  pushTrack(t, T0 + TRACK.minGapMs, 1300);
  assert.equal(t.length, 2);
  assert.equal(t[1].cv, 0.1, "curve progress carries forward until a new reading arrives");
  // Junk is refused rather than recorded as a price.
  const n = t.length;
  for (const bad of [0, -1, NaN, null, undefined, "x"]) pushTrack(t, T0 + 10 * MIN, bad);
  pushTrack(t, NaN, 5); pushTrack(null, T0, 5);
  assert.equal(t.length, n);
  // Full: the older half merges pairwise, so the array is bounded and the all-time high survives.
  const big = [];
  for (let i = 0; i < TRACK.cap * 3; i++) pushTrack(big, T0 + i * TRACK.minGapMs, i === 7 ? 999_999 : 1000 + i, { cv: i / 1000 });
  assert.ok(big.length <= TRACK.cap, `bounded: ${big.length}`);
  assert.equal(Math.max(...big.map(s => s.hi)), 999_999, "a decimated high is still the high");
  assert.ok(big[0].t < big[big.length - 1].t, "and time still runs forwards");
});

test("T31: a token that ran, gave some back and is being bought again is a dip; the ways of not being one are named", () => {
  const now = T0 + 11 * MIN;
  const d = dipSignal(tok(), { now });
  assert.equal(d.dip, true, d.reasons.join(","));
  assert.equal(d.phase, "recovering");
  assert.equal(d.runPct, 140); assert.equal(d.drawdownPct, 29.2); assert.equal(d.recoveryPct, 14.7);
  assert.equal(d.buyers, 8); assert.equal(d.buyShare, 1); assert.equal(d.devSellShare, 0);

  const why = over => dipSignal(tok(over), { now: over.now || now }).reasons;
  // Seconds old: the price is still the launch settling.
  assert.ok(why({ createdAt: now - 2 * MIN }).includes("TOO_YOUNG_FOR_DIP"));
  // Past the first hour it belongs to the slow cook and the revival, which have their own reads.
  assert.ok(why({ createdAt: now - 90 * MIN }).includes("PAST_FIRST_HOUR"));
  // Never ran: there is no discount on a price nobody bid up.
  assert.ok(why({ _track: track([[0, 10000], [4, 10200], [8, 9000], [11, 9600]]) }).includes("NEVER_RAN"));
  // Ran and held: nothing has been given back yet, so there is nothing to buy.
  const held = dipSignal(tok({ _track: track([[0, 10000], [3, 17000], [6, 24000], [9, 23900], [11, 23800]]), mcapUsd: 23800 }), { now });
  assert.equal(held.dip, false); assert.equal(held.phase, "running"); assert.ok(held.reasons.includes("NO_DIP_YET"));
  // Collapsed: not a dip, the exit.
  const dead = dipSignal(tok({ _track: track([[0, 10000], [6, 24000], [9, 5000], [11, 5400]]), mcapUsd: 5400 }), { now });
  assert.equal(dead.phase, "dead"); assert.ok(dead.reasons.includes("NOT_A_DIP_A_COLLAPSE"));
  // Still falling: a knife, and the read says so rather than calling the bounce early.
  const knife = dipSignal(tok({ _track: track([[0, 10000], [6, 24000], [9, 17000], [11, 16000]]), mcapUsd: 16000 }), { now });
  assert.equal(knife.phase, "dipping"); assert.ok(knife.reasons.includes("NOT_TURNING"));
  // Nobody bought it: a price that drifted back up on no volume is not the crowd voting again.
  assert.ok(why({ trades: bought(2, 9.5) }).includes("NOBODY_BOUGHT_THE_DIP"));
  // Sellers still in control since the low.
  assert.ok(why({ trades: [...bought(5, 9.5), ...bought(3, 10, { sol: 4, side: "sell", wallet: "s" })] }).includes("STILL_SELLING"));
  // The dev dumped into the dip: whatever the chart says, that is the trade on the other side.
  assert.ok(why({ trades: [...bought(6, 9.5), { side: "sell", sol: 3, wallet: "devwallet", time: T0 + 10 * MIN }] }).includes("DEV_SOLD_THE_DIP"));
  // An old low with a slow drift up is a bleed, not a dip.
  assert.ok(why({ now: T0 + 40 * MIN, createdAt: T0, trades: bought(8, 9.5) }).includes("LOW_IS_OLD"));
  // Nothing to read from: never a candidate, never a crash.
  assert.deepEqual(dipSignal({ ca: "X", createdAt: T0 }, { now }).reasons, ["NO_TRACK"]);
  assert.deepEqual(dipSignal({ ca: "X" }, { now }).reasons, ["AGE_UNKNOWN"]);
  assert.deepEqual(dipSignal(null, { now }).reasons, ["NO_TOKEN"]);
});

test("T31: the road to completion is measured by pace, not position, and a stalled curve is not a queue position", () => {
  const now = T0 + 11 * MIN;
  const g = gradSignal(tok(), { now });
  assert.equal(g.near, false, "52% is on its way, not yet near");
  assert.equal(g.ptsPerMin, 2); assert.equal(g.etaMin, 24); assert.equal(g.phase, "early");
  // Far along and filling: the last stretch.
  const hot = gradSignal(tok({ _curvePct: 0.88, _track: ranAndDipped() }), { now });
  assert.equal(hot.hot, true); assert.equal(hot.near, true); assert.equal(hot.phase, "last stretch");
  // Far along and not moving for a quarter of an hour: a trap, and it is said out loud.
  const flat = tok({ _curvePct: 0.86, _track: track([[0, 10000], [8, 24000], [20, 23000], [26, 23500]], { cv: () => 0.86 }) });
  const st = gradSignal(flat, { now: T0 + 26 * MIN });
  assert.equal(st.stalled, true); assert.equal(st.phase, "stalled"); assert.equal(st.ptsPerMin, 0);
  // Young and not yet moving is not stuck: there is no reading from before a stall could have begun.
  assert.equal(gradSignal(flat, { now: T0 + 9 * MIN }).stalled, false, "too young to be called stuck");
  // Already through: nothing left to walk toward.
  const done = gradSignal({ graduated: true, _curvePct: 1 }, { now });
  assert.equal(done.phase, "graduated"); assert.equal(done.pct, 1);
  assert.equal(gradSignal({}, { now }).phase, "unknown", "no curve reading is unknown, never zero");
});

test("T31: conviction says which dip is a trade and which is worth sitting through noise for", () => {
  const now = T0 + 11 * MIN;
  const d = dipSignal(tok(), { now });
  // Curve at 52%, filling at 2 points a minute, done in under half an hour: worth holding.
  const hold = convictionOf(d, gradSignal(tok(), { now }));
  assert.equal(hold.conviction, "hold"); assert.match(hold.why, /completes in about 24m/);
  // The same dip on a curve that stopped filling is a trade, and the reason says why.
  const stalled = convictionOf(d, { pct: 0.86, ptsPerMin: 0, etaMin: null, stalled: true, graduated: false });
  assert.equal(stalled.conviction, "trade"); assert.match(stalled.why, /stopped filling/);
  assert.equal(convictionOf(d, { pct: 0.2, ptsPerMin: 2, etaMin: 40 }).conviction, "trade", "too early on the curve to be walking anywhere");
  assert.equal(convictionOf(d, { pct: 0.6, ptsPerMin: 2, etaMin: 400 }).conviction, "trade", "completion out of sight at this pace");
  assert.equal(convictionOf(d, { graduated: true }).conviction, "trade");
  assert.equal(convictionOf({ dip: false }, {}).conviction, null, "no entry, no conviction");
});

test("T31: a dip enters on its own plan, which does not cut at twenty seconds and does not stall it out", () => {
  const dip = planFor("pumpfun", "dip"), hold = planFor("pumpfun", "dip_hold"), launch = planFor("pumpfun", 3);
  assert.equal(dip.doa_ms, null, "the crowd came already: that is the premise of the entry");
  assert.equal(hold.doa_ms, null); assert.equal(hold.stall_ms, null, "waiting is the position");
  assert.ok(dip.max_hold_ms > launch.max_hold_ms * 4 && hold.max_hold_ms >= 180 * MIN);
  assert.ok(dip.stall_ms > launch.stall_ms * 4, "a dip that takes ten minutes to turn is not dead money");
  assert.ok(dip.stop_pct > 10 && hold.stop_pct > dip.stop_pct, "the risk is the dip low, not a launch's 10%");
  // Built as a real plan, the rules that killed launch entries cannot fire on it.
  const plan = createPlan({ venue: "pumpfun", key: "dip", entry: { score: 60 } });
  const pos = { id: "p", venue: "pumpfun", instrument: "MintD", entryTime: T0, entryMark: 19500, peak: 19500, notional_usd: 20, entryScore: 60, plan };
  const alone = { token: { ca: "MintD", buys: 50, sells: 10, trades: [{ side: "buy", time: T0 + 200 }], volumeSol: 20, createdAt: T0 - 11 * MIN, uniqueBuyers: { size: 30 }, mcapUsd: 19600, vSolInBondingCurve: 20 } };
  const tick = at => ({ venue: "pumpfun", kind: "tick", id: "MintD", t_venue: at, t_observed: at, payload: { mcapUsd: 19600, ...alone, dynamics: { scores: 5, velocity: 0, acceleration: 0, trend: "stable" }, scores: { apeScore: 60 }, vSolInBondingCurve: 20 } });
  assert.equal(evaluateExit({ ...pos }, tick(T0 + 30_000)), null, "no dead-on-arrival cut on a dip entry");
  assert.equal(evaluateExit({ ...pos }, tick(T0 + 5 * MIN)), null, "and no stall while it is still early");
  assert.equal(evaluateExit({ ...pos }, tick(T0 + 12 * MIN))?.reason, "STALL", "dead money is still freed, later");
  // A dip entry that is 20% under water is still stopped out: the wider stop is a stop, not an absence.
  const low = { ...tick(T0 + 5 * MIN), payload: { ...tick(T0).payload, mcapUsd: 15000, token: { ...alone.token, mcapUsd: 15000 } } };
  assert.match(String(evaluateExit({ ...pos }, low)?.reason), /^(SL1|SL2)$/);
});

test("T31: the edge routes a dip to its own model, tier and plan, and the rug gates still judge it", () => {
  const edge = makePumpfunEdge({ aggression: 2 });
  const withDip = (over = {}) => {
    const p = goodCandidatePayload("MintD");
    p.token._dip = { dip: true, runPct: 140, drawdownPct: 29.2, buyers: 8, buyShare: 1, phase: "recovering", ...(over.dip || {}) };
    p.token._grad = { pct: 0.52, ptsPerMin: 2, etaMin: 24, stalled: false, graduated: false, near: false, ...(over.grad || {}) };
    if (over.token) Object.assign(p.token, over.token);
    return edge.ingest({ kind: "candidate", payload: p })[0];
  };
  const c = withDip();
  assert.equal(c.model, "bondli_dip");
  const run = edge.gates.reduce((acc, g) => acc.pass === false ? acc : g.check(c), { pass: true });
  assert.notEqual(run.pass, false, JSON.stringify(run));
  assert.equal(c.tier, 2, "a dip walking toward completion is worth the size");
  assert.equal(c.tierLabel, "DIP_TO_COMPLETION"); assert.equal(c.hold, true);
  assert.match(c.tierReasons.join(" "), /ran \+140% then gave back 29.2%/);
  assert.equal(edge.estimate(c, {}).plan_key, "dip_hold");
  // A dip on a curve going nowhere is the same entry with less conviction: smaller tier, shorter plan.
  const t = withDip({ grad: { pct: 0.2, ptsPerMin: 0.01, etaMin: null } });
  edge.gates.forEach(g => g.check(t));
  assert.equal(t.tier, 3); assert.equal(t.tierLabel, "FIRST_DIP"); assert.equal(t.hold, false);
  assert.equal(edge.estimate(t, {}).plan_key, "dip");
  // Every rug rule still applies: a frozen mint is refused whatever its chart did.
  const frozen = withDip({ token: { freezeAuthority: "someone" } });
  assert.equal(edge.gates[0].check(frozen).pass, false);
  // And a mayhem or copycat launch never reaches the model at all.
  const p = goodCandidatePayload("MintD"); p.token._dip = { dip: true }; p.token._copyOf = "MintOriginal";
  assert.equal(edge.ingest({ kind: "candidate", payload: p }).length, 0);
});

test("T31: the radar records a track, stamps the read, and serves the near-graduation list", () => {
  const SRC = fs.readFileSync(path.resolve("src/api/server.production.mjs"), "utf8");
  // Curve progress on the track is the chain's when the chain has been read, and pump.fun's default
  // maths only until then -- a token launched through another front end opens above 30 virtual SOL
  // and would otherwise stamp every sample at a hundred per cent (tests/api/t35).
  assert.match(SRC, /pushTrack\(token\._track \|\| \(token\._track = \[\]\), now, token\.mcapUsd, \{ cv: token\._curvePct != null \? token\._curvePct : pumpCurvePct\(token\.vSolInBondingCurve\) \}\);/);
  assert.equal((SRC.match(/pushTrack\(token\._track/g) || []).length, 2, "every place a market cap is recorded");
  assert.match(SRC, /function dipOf\(t, now = Date\.now\(\)\) \{\n  if \(t\._dipAt && now - t\._dipAt < 10_000\)/);
  // Same list, with one thing ahead of the read: a token whose price the chain has not confirmed is
  // not served as nearly graduated, because a wrongly-quoted curve is exactly how it got there.
  assert.match(SRC, /const graduating = both\.filter\(t => priceTrusted\(t, now\) && \(dipOf\(t, now\), t\._grad\) && t\._grad\.near && !t\._grad\.graduated\)/);
  assert.match(SRC, /tokens: rows, revivals, cooking, graduating,/);
  assert.match(SRC, /dips: rows\.filter\(r => r\.dip\?\.on\)\.length, nearGrad: graduating\.length/);
  // The row carries the read, and a row never carries a wallet.
  assert.match(SRC, /dip: dp \? \{ on: dp\.dip, phase: dp\.phase, runPct: dp\.runPct/);
  assert.match(SRC, /hold: dp\?\.dip \? convictionOf\(dp, gd\)\.conviction === "hold" : false \};/);
  // Both EVM feeds keep the same track and stamp the same read, so a dip is an entry on every venue.
  for (const f of ["src/velocity/venues/pons/feed.mjs", "src/velocity/venues/arc/feed.mjs"]) {
    const F = fs.readFileSync(path.resolve(f), "utf8");
    assert.match(F, /pushTrack\(t\._track \|\| \(t\._track = \[\]\), this\.clock\(\), t\.mcapUsd, \{ cv: t\._curvePct \}\);/, f);
    assert.match(F, /t\._grad = gradSignal\(t, \{ now, pctNow: t\._curvePct \}\);\n\s+t\._dip = dipSignal\(t, \{ now \}\);/, f);
  }
  assert.ok(DIP_DEFAULTS.maxAgeMs === 60 * MIN, "the first hour is the window");
});

test("T31: a dip is priced by its own record, never by the tier whose record closed the edge", () => {
  // The launch tiers lost: nine closes, nine losses, which is what prompted the whole entry.
  const losses = Array.from({ length: 9 }, (_, i) => ({ venue: "pumpfun", tier: 2, plan_key: 2, model: "bondli_gates", pnl_usd: -4, stake_usd: 20, ts: T0 + i }));
  // Enough closes that the EV gate will read them: below its floor an entry stays on priors.
  const dips = Array.from({ length: 40 }, (_, i) => ({ venue: "pumpfun", tier: 2, plan_key: "dip_hold", model: "bondli_dip", pnl_usd: i < 26 ? 9 : -3, stake_usd: 20, ts: T0 + i }));
  const st = statsFromOutcomes([...losses, ...dips]).pumpfun;
  assert.equal(st[2].n, 9); assert.equal(st[2].p_win, 0, "the launch tier's record is what it is");
  assert.equal(st.dip_hold.n, 40); assert.ok(st.dip_hold.p_win > 0.6, "and the dip's is its own");
  // An old outcome with no plan on it still buckets by its tier, so nothing already recorded moves.
  const old = statsFromOutcomes([{ venue: "pumpfun", tier: 3, model: "bondli_gates", pnl_usd: 5, stake_usd: 20 }]).pumpfun;
  assert.equal(old[3].n, 1);
  // The edge reads the bucket belonging to the plan it is about to run, not the tier number.
  const edge = makePumpfunEdge({ aggression: 2 });
  const p = goodCandidatePayload("MintD");
  p.token._dip = { dip: true, runPct: 140, drawdownPct: 29, buyers: 8, buyShare: 1 };
  p.token._grad = { pct: 0.52, ptsPerMin: 2, etaMin: 24, stalled: false, graduated: false };
  const c = edge.ingest({ kind: "candidate", payload: p })[0];
  edge.gates.forEach(g => g.check(c));
  const est = edge.estimate(c, { stats: statsFromOutcomes([...losses, ...dips]) });
  assert.equal(est.plan_key, "dip_hold"); assert.equal(est.outcomes_seen, 40); assert.equal(est.on_priors, false);
  // The record is blended toward the prior by its length and clamped so it can only lower the
  // estimate, so a dip record beating its prior comes back AT the prior. What separates the two is
  // still visible: hand the SAME plan key the launch tier's nine losses instead and both numbers
  // fall, which is the refusal the dip entry exists to escape.
  const asLaunches = edge.estimate(c, { stats: { pumpfun: { dip_hold: statsFromOutcomes(losses).pumpfun[2] } } });
  assert.ok(est.p_win > asLaunches.p_win && est.payoff > asLaunches.payoff,
    `priced by the dips, not by the launches: ${est.p_win}/${est.payoff} vs ${asLaunches.p_win}/${asLaunches.payoff}`);
  assert.equal(est.p_win, PUMPFUN_PRIORS[2].p_win, "a record better than its prior is still priced at the prior");
  // With no dip record at all it falls to the priors rather than borrowing the losing tier's.
  const fresh = edge.estimate(c, { stats: statsFromOutcomes(losses) });
  assert.equal(fresh.on_priors, true); assert.equal(fresh.outcomes_seen, 0); assert.ok(fresh.p_win > 0);
});

test("T31: dips-only takes the second entry and nothing else, and the operator owns the switch", () => {
  const all = makePumpfunEdge({ aggression: 2 }), only = makePumpfunEdge({ aggression: 2, entries: "dips" });
  assert.equal(all.entries, "all"); assert.equal(only.entries, "dips");
  const launch = () => ({ kind: "candidate", payload: goodCandidatePayload("MintL") });
  assert.equal(all.ingest(launch()).length, 1, "a launch is an entry when launches are wanted");
  assert.equal(only.ingest(launch()).length, 0, "and is not offered at all when they are not");
  const p = goodCandidatePayload("MintD");
  p.token._dip = { dip: true, runPct: 140, drawdownPct: 29, buyers: 8, buyShare: 1 };
  assert.equal(only.ingest({ kind: "candidate", payload: p }).length, 1, "the dip still is");
  // A token whose dip read says it is not a dip is not one, whatever else it looks like.
  const p2 = goodCandidatePayload("MintN"); p2.token._dip = { dip: false, phase: "dipping", reasons: ["NOT_TURNING"] };
  assert.equal(only.ingest({ kind: "candidate", payload: p2 }).length, 0);
  const HUB = fs.readFileSync(path.resolve("src/velocity/hub.mjs"), "utf8");
  // The hosted default is the dip; "all" is what an operator asks for by name when they want the
  // create-event entry back. The edge itself stays permissive, because it is a library.
  assert.match(HUB, /const entries = settings\.entries === "all" \? "all" : "dips";/);
  assert.equal((HUB.match(/makePumpfunEdge\(\{[^)]*entries \}\)/g) || []).length, 3, "every venue's edge, not just pump.fun");
  const SITE = fs.readFileSync(path.resolve("app/src/Simple.jsx"), "utf8");
  assert.match(SITE, /entries: dipsOnly \? "dips" : "all" \}\);/);
  assert.match(SITE, /t\("panel\.dips"\)/);
  const ENGINE = fs.readFileSync(path.resolve("src/velocity/core/engine.mjs"), "utf8");
  assert.equal((ENGINE.match(/plan_key: p\.plan\?\.key \?\? null,/g) || []).length, 2, "every close records the plan it ran");
  assert.match(ENGINE, /plan_key: decision\.plan_key \?\? null,/);
});
