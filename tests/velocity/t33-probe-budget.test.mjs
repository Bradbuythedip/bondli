// T33: a probe is bought, not taken.
//
// The probe branch existed so that a plan key with no record of its own could not be refused forever
// on the strength of a guess. It asked two things: is the prior still speaking, and is the edge
// positive before costs. The second was not a test at all -- every prior in the table is positive
// before costs -- so EVERY expected-value refusal on priors became a GO at 0.4x, including the ones
// the cost model had fail-closed on purpose: a PONS curve whose creator tax has not been read yet, an
// Arc hook whose leg taxes are priced at the maximum until they are. The gate refused and the branch
// below it let the trade through anyway.
//
// What is pinned here. First, the probe fires while the PRIOR is what is speaking -- which is what
// on_priors means and the only kind of refusal a probe can revise -- and never on a refusal that came
// from a toll we have not read, because the answer to that one is to fetch the curve rather than to
// spend a round trip finding out. Second, what survives that is drawn from a bounded daily budget per
// (venue, plan key), counted live and paper apart, charged when the BUY LANDS rather than when the
// gate approves, and a probe that cannot draw is an ordinary REJECT that says so rather than going
// quiet.
//
// Two narrower conditions were tried in this branch's place and both were absorbing states: "the edge
// is positive before costs", which is true of every prior in the table and so approved every refusal
// there is, and "the edge clears the costs at the plan's designed stop", which compares constants and
// so refused tier 3, the first dip and revival identically for the life of the account.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GateRunner } from "../../src/velocity/core/pipeline.mjs";
import { makePumpfunEdge } from "../../src/velocity/venues/pumpfun/edge.mjs";
import { designedStopFraction, planFor } from "../../src/velocity/core/plans.mjs";
import { STOP_LOSSES } from "../../src/autoape/exit-plan.js";
import { Store } from "../../src/velocity/core/store.mjs";
import { Engine } from "../../src/velocity/core/engine.mjs";
import { loadRiskEnvelope } from "../../src/velocity/core/risk.mjs";
import { ScriptedFeed } from "../../src/velocity/core/feed.mjs";
import { PumpfunPaperRouter } from "../../src/velocity/venues/pumpfun/router.mjs";
import { makeEvent } from "../../src/velocity/core/events.mjs";
import { goodCandidatePayload } from "./helpers/fixtures.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "velocity-t33-"));

/** One candidate on one venue, gated and ready to judge. `over` patches the payload, which is how
 *  an unread curve is handed to the cost model: `{ curve: {} }` is a curve object whose economics
 *  have not come back yet, exactly as the feed leaves it. */
function bench(venue, over = {}) {
  const edge = makePumpfunEdge({ aggression: 2, venue });
  const runner = new GateRunner({ venue, edge });
  const payload = { ...goodCandidatePayload("MintProbe"), ...over };
  const event = makeEvent({ venue, kind: "candidate", id: "MintProbe", t_venue: Date.now() - 100, t_observed: Date.now(), payload });
  const [cand] = edge.ingest(event);
  for (const g of edge.gates) {
    const r = g.check(cand);
    assert.equal(r.pass, true, `${venue} ${g.name}: ${JSON.stringify(r?.reasons)}`);
  }
  return { edge, runner, event, cand,
    costs: stake => edge.costs(cand, stake).fraction,
    estimate: (ctx = {}) => edge.estimate(cand, ctx),
    decide: (ctx = {}) => runner.evaluate(event, cand, { governor: {}, probes: {}, ...ctx }) };
}

// Arc is quoted in USDC and its curves hold thousands of it; the SOL-shaped fixture defaults are the
// wrong order of magnitude and would drown the tax under an invented gas cost.
const ARC = { solPrice: 1, vSolInBondingCurve: 2000, mcapUsd: 18_000 };
// PONS is quoted in ETH.
const PONS = { solPrice: 3000, vSolInBondingCurve: 3 };

test("T33: the designed stop is the plan's own stop, and it is not the sizer's worst case", () => {
  // The number the probe test needs is how much this plan MEANS to lose, which is not the number
  // stop_fraction carries. That one is the sizer's worst case -- 1.0 on every curve plan, because a
  // token can go to zero between two blocks -- and testing against it would pass for everything.
  for (const key of [1, 2, 3, "dip", "dip_hold", "revival"]) {
    assert.equal(planFor("pumpfun", key).worst_case_fraction, 1.0, `${key} worst case`);
  }
  assert.equal(designedStopFraction("pumpfun", "dip"), 0.14);
  assert.equal(designedStopFraction("pumpfun", "dip_hold"), 0.18);
  assert.equal(designedStopFraction("pumpfun", "revival"), 0.08);
  // A launch tier does not name its own stop: bondli's exit plan does, and that one table is read
  // rather than copied, so the two answers cannot drift apart.
  assert.deepEqual({ ...STOP_LOSSES }, { 1: 15, 2: 12, 3: 10 });
  for (const tier of [1, 2, 3]) assert.equal(designedStopFraction("pumpfun", tier), STOP_LOSSES[tier] / 100);
  // PONS and Arc run pump.fun's plans, so they get pump.fun's designed stops.
  for (const venue of ["pons", "arc"]) assert.equal(designedStopFraction(venue, 2), 0.12);
  // A plan that cuts at no level at all says so rather than answering zero.
  assert.equal(designedStopFraction("polymarket", "consistency"), null);
  assert.equal(designedStopFraction("pumpfun", "no_such_plan"), null);
  // And it reaches the decision, so the ledger records what the gate was actually asking.
  assert.equal(bench("pumpfun").decide().designed_stop_fraction, 0.12);
});

test("T33: an Arc candidate whose hook taxes have not been read is refused, not probed", () => {
  const b = bench("arc", { ...ARC, curve: {} });
  // The fail-closed price: 10% a side from the hook plus the pool's 1% each way, because an unread
  // tax must not look free. That is a measurement of our own ignorance, not a guess about the token.
  const unread = b.costs(25);
  assert.ok(unread > 0.22, `the maximum leg taxes are charged: ${unread}`);
  const est = b.estimate();
  assert.equal(est.on_priors, true, "no record for this key, so the old branch would have probed");
  const edgeBeforeCosts = est.p_win * est.payoff - (1 - est.p_win);
  assert.ok(edgeBeforeCosts > 0, `positive before costs -- which is what the old test asked: ${edgeBeforeCosts}`);
  assert.ok(edgeBeforeCosts * est.designed_stop_fraction < unread, "and worthless at the loss the plan is designed to take");

  const d = b.decide({ minStakeUsd: 25 });
  assert.equal(d.action, "REJECT", `the unread tax decides: ${JSON.stringify(d.reasons)}`);
  assert.equal(d.gate, "ev");
  assert.ok(!d.probe, "and it is emphatically not a probe");
  assert.ok(d.reasons.some(r => /_ON_PRIORS/.test(r)), `the refusal still names the prior: ${JSON.stringify(d.reasons)}`);
  assert.equal(d.costs.assumed, true, "the cost model says out loud that it had to guess");
  // And it says which of the two refused it. Without this line an operator watching entries dry up
  // cannot tell a cost model that is working from one that is too strict.
  assert.match(d.reasons[1], /^no probe: the toll here is assumed at 0\.\d+ because the curve's own fees have not been read/);

  // Non-vacuous: the same token with its taxes actually read is not refused. It is the ignorance
  // that costs 22%, not Arc.
  const read = bench("arc", { ...ARC, curve: { feeBps: 0, sellTaxBps: 0 } });
  assert.ok(read.costs(25) < 0.05, `a read hook is cheap: ${read.costs(25)}`);
  const ok = read.decide({ minStakeUsd: 25 });
  assert.equal(ok.action, "GO");
  assert.equal(ok.costs.assumed, false, "nothing was guessed here");
});

test("T33: a hook whose taxes are READ and dear is refused at full size, and only ever probed small", () => {
  // The boundary the two cases above do not cover: a toll that is measured rather than assumed, and
  // still far too big. Nothing here is ignorance, so the probe branch stays open -- what a probe
  // revises is the guess about the TOKEN, and the estimate is capped at the prior, so the only thing
  // the day's three draws can do is measure that. What must never happen is the full-size entry.
  const b = bench("arc", { ...ARC, curve: { feeBps: 300, sellTaxBps: 300 } });
  const toll = b.costs(25);
  assert.ok(toll > 0.07, `3% a side plus the pool's 1% each way: ${toll}`);
  const d = b.decide({ minStakeUsd: 25 });
  assert.equal(d.costs.assumed, false, "measured, not assumed");
  assert.ok(d.ev < 0, `and it does not clear: ${d.ev}`);
  assert.equal(d.action, "GO", JSON.stringify(d.reasons));
  assert.equal(d.probe, true, "so it is a probe");
  assert.equal(d.stake_cap_fraction, 0.4, "at 0.4x, three a day, and never more");
  assert.match(d.reasons[0], /^PROBE 1\/3:/);
  // And the whole of that exposure is bounded twice over: Arc and PONS ship with
  // max_exposure_usd 0, so an operator has to turn the venue on before any of this spends anything.
  const cfg = JSON.parse(fs.readFileSync(path.resolve("src/velocity/config/risk.example.json"), "utf8"));
  assert.equal(cfg.venues.arc.max_exposure_usd, 0);
  assert.equal(cfg.venues.pons.max_exposure_usd, 0);
});

test("T33: a PONS candidate whose creator tax has not been read is refused, not probed", () => {
  const b = bench("pons", { ...PONS, curve: {} });
  const unread = b.costs(25);
  assert.ok(unread > 0.12, `1% fee and a 5% creator tax, both ways, until they are read: ${unread}`);
  const d = b.decide({ minStakeUsd: 25 });
  assert.equal(d.action, "REJECT", JSON.stringify(d.reasons));
  assert.equal(d.gate, "ev");
  assert.ok(!d.probe);
  assert.equal(d.costs.assumed, true);
  const read = bench("pons", { ...PONS, curve: { feeBps: 100, creatorTaxBps: 0 } });
  assert.ok(read.costs(25) < 0.05, `a curve that charges no creator tax is tradeable: ${read.costs(25)}`);
  assert.equal(read.decide({ minStakeUsd: 25 }).action, "GO");
});

/** The one shape the probe is FOR: a key one close old. The expected value is negative, and it is
 *  negative because of a guess -- a single -30% close moves the estimate by a thirteenth and the
 *  rest of it is still the prior's. Refuse this and the key is shut for the fourteen days the
 *  statistics window runs, having traded exactly once, and nothing it could have measured will ever
 *  arrive. Six closes that actually speak against the prior is what shuts a key; one is not. */
const ONE_CLOSE = { pumpfun: { 2: { n: 1, wins: 0, p_win: 0, payoff: 0, loss_fraction: 0.30 } } };

test("T33: a refusal that still rests on the prior is bought, at probe size", () => {
  const b = bench("pumpfun");
  const est = b.estimate({ stats: ONE_CLOSE });
  assert.equal(est.on_priors, true, "one close is not yet a record that speaks");
  assert.equal(est.outcomes_seen, 1, "and it is counted rather than ignored");
  assert.ok(est.p_win < 0.35 && est.p_win > 0.3, `the estimate did move, by a thirteenth: ${est.p_win}`);

  const d = b.decide({ stats: ONE_CLOSE });
  assert.equal(d.action, "GO", JSON.stringify(d.reasons));
  assert.equal(d.probe, true);
  assert.equal(d.ev < 0, true, "it is still a negative-EV trade: what is bought is the measurement");
  assert.equal(d.stake_cap_fraction, 0.4, "and it is bought small -- the probe never raises a stake");
  assert.match(d.reasons[0], /^PROBE 1\/3:/);
  assert.equal(d.costs.assumed, false, "on pump.fun the round trip is published: nothing here was guessed");

  // Switching probing off refuses it, and that has not changed.
  const strict = new GateRunner({ venue: "pumpfun", edge: b.edge, probeStakeFraction: 0 });
  const off = strict.evaluate(b.event, b.cand, { governor: {}, probes: {}, stats: ONE_CLOSE });
  assert.equal(off.action, "REJECT");
});

test("T33: a plan key with no record at all can still draw its first probe", () => {
  // The absorbing state this branch exists to prevent, and the one the designed-stop test walked
  // straight back into. For a key that has never traded, every input to that test is a constant --
  // the prior's edge, the plan's own stop, the cost model -- so a key it refuses is refused
  // identically for ever: n stays 0, the fourteen-day window has nothing to age out, and no trade
  // means no measurement that could revise it. Measured on priors at the $10 hosted floor, tier 3
  // is worth 0.0200 of the stake at its designed stop, the first dip 0.0280 and revival 0.0160,
  // against a round trip of about 0.042 -- so all three were refused for the life of the account.
  for (const [label, over, stake] of [["tier 3", { scores: { apeScore: 40, scoreTimestamp: Date.now() } }, 10]]) {
    const b = bench("pumpfun", over);
    const est = b.estimate();
    assert.equal(est.outcomes_seen, 0, `${label}: no record`);
    assert.equal(est.on_priors, true);
    const d = b.decide({ minStakeUsd: stake });
    assert.equal(d.action, "GO", `${label} must be able to buy its first measurement: ${JSON.stringify(d.reasons)}`);
    assert.equal(d.probe, true, `${label}: and only as a probe`);
    assert.equal(d.stake_cap_fraction, 0.4);
  }
  // Bounded by the budget and nothing else: the fourth draw of the day is refused.
  const b = bench("pumpfun", { scores: { apeScore: 40, scoreTimestamp: Date.now() } });
  const probes = { "pumpfun|3": 3 };
  const spent = b.decide({ minStakeUsd: 10, probes });
  assert.equal(spent.action, "REJECT", JSON.stringify(spent.reasons));
  assert.match(spent.reasons[0], /^PROBE_BUDGET_SPENT: pumpfun\|3 has spent 3 of 3/);
});

test("T33: the budget is three a day per venue and plan key, and the fourth is a REJECT that says so", () => {
  const b = bench("pumpfun");
  assert.equal(b.runner.probeBudget, 3, "small, fixed and nonzero: a lockout is not selectivity");
  assert.equal(new GateRunner({ venue: "pumpfun", edge: b.edge, probeBudget: 0 }).probeBudget, 3, "zero is not a budget, it is a lockout, and is refused as a setting");
  assert.equal(new GateRunner({ venue: "pumpfun", edge: b.edge, probeBudget: 1 }).probeBudget, 1);

  // The budget is charged when the BUY LANDS, not when the gate approves -- see the engine case at
  // the bottom of this file, and `landed` here stands in for the fill the engine would have booked.
  // Charged at the approval it counted decisions, and a decision that dies on a full slot table or a
  // router failure buys no measurement, so the day's three could be spent having bought nothing.
  const probes = {};
  const landed = key => { probes[key] = (Number(probes[key]) || 0) + 1; };
  for (let i = 1; i <= 3; i++) {
    const d = b.decide({ stats: ONE_CLOSE, probes });
    assert.equal(d.action, "GO", `probe ${i}: ${JSON.stringify(d.reasons)}`);
    assert.match(d.reasons[0], new RegExp(`^PROBE ${i}/3:`));
    assert.equal(Number(probes["pumpfun|2"]) || 0, i - 1, "the gate reads the tally and does not move it");
    landed("pumpfun|2");
    assert.equal(probes["pumpfun|2"], i, "the fill is what charges it");
  }
  const spent = b.decide({ stats: ONE_CLOSE, probes });
  assert.equal(spent.action, "REJECT", "the fourth is refused");
  assert.equal(spent.gate, "ev", "as an ordinary expected-value reject, so the funnel counts it");
  assert.ok(!spent.probe);
  assert.match(spent.reasons[0], /^PROBE_BUDGET_SPENT: pumpfun\|2 has spent 3 of 3 probes today/);
  assert.equal(probes["pumpfun|2"], 3, "a refused draw does not charge the budget");

  // Per (venue, plan key), not per bot: a spent pump.fun tier 2 says nothing about PONS tier 2.
  const p = bench("pons", { ...PONS, curve: { feeBps: 100, creatorTaxBps: 0 } });
  const onPons = p.decide({ stats: { pons: { 2: ONE_CLOSE.pumpfun[2] } }, probes, minStakeUsd: 25 });
  assert.equal(onPons.action, "GO", JSON.stringify(onPons.reasons));
  assert.match(onPons.reasons[0], /^PROBE 1\/3:/, "its own line in the tally, untouched by pump.fun's three");
  landed("pons|2");
  assert.equal(probes["pons|2"], 1);

  // And a GO that never becomes a trade charges nothing at all. This is the leak the move fixed: a
  // full slot table is the normal condition in continuous mode, and three approvals that all died
  // there used to spend the whole day's budget for a key that had bought no measurement.
  const nothingOpened = {};
  for (let i = 0; i < 4; i++) assert.equal(b.decide({ stats: ONE_CLOSE, probes: nothingOpened }).action, "GO", `draw ${i} is still available`);
  assert.deepEqual(nothingOpened, {}, "four approvals, no fills, nothing spent");

  // No tally at all is not an excuse to trade: an uncounted probe is the thing this exists to stop.
  const nowhere = b.runner.evaluate(b.event, b.cand, { governor: {}, stats: ONE_CLOSE });
  assert.equal(nowhere.action, "REJECT");
  assert.match(nowhere.reasons[0], /^PROBE_BUDGET_SPENT: no day budget/);
});

test("T33: the budget refills on the UTC day roll and never crosses it", () => {
  const dir = tmp();
  let now = Date.UTC(2026, 0, 5, 23, 40);
  const store = new Store(path.join(dir, "state.json"), { now: () => now });
  const b = bench("pumpfun");

  const day = store.rollDay();
  assert.deepEqual(day.probes, {}, "a fresh day starts with nothing spent");
  // Three buys land, charging the day's tally the way the engine does when a position opens.
  for (let i = 0; i < 3; i++) {
    assert.equal(b.decide({ stats: ONE_CLOSE, probes: day.probes }).action, "GO");
    day.probes["pumpfun|2"] = (day.probes["pumpfun|2"] || 0) + 1;
  }
  assert.equal(b.decide({ stats: ONE_CLOSE, probes: store.rollDay().probes }).action, "REJECT", "still the same day twenty minutes later");

  now += 30 * 60_000; // past midnight UTC
  const next = store.rollDay();
  assert.notEqual(next.date, day.date);
  assert.deepEqual(next.probes, {}, "the new day refills it");
  assert.equal(b.decide({ stats: ONE_CLOSE, probes: next.probes }).action, "GO");

  // A state file written before budgets existed reads as an empty tally, not as a crash.
  store.state.day = { date: store.state.day.date, realizedUsd: 0, trades: 0, paperRealizedUsd: 0, paperTrades: 0, lossAckUsd: 0 };
  assert.deepEqual(store.rollDay().probes, {});
});

test("T33: paper probes and live probes never draw from each other", () => {
  const dir = tmp();
  const store = new Store(path.join(dir, "state.json"), { now: () => Date.UTC(2026, 0, 6, 12) });
  const b = bench("pumpfun");
  const day = store.rollDay();
  for (let i = 0; i < 3; i++) {
    assert.equal(b.decide({ stats: ONE_CLOSE, probes: day.paperProbes }).action, "GO");
    day.paperProbes["pumpfun|2"] = (day.paperProbes["pumpfun|2"] || 0) + 1;   // the simulated buy lands
  }
  assert.equal(day.paperProbes["pumpfun|2"], 3);
  assert.deepEqual(day.probes, {}, "three imaginary probes spent nothing real");
  const fourth = b.decide({ stats: ONE_CLOSE, probes: day.paperProbes });
  assert.equal(fourth.action, "REJECT", "the simulation runs out on its own schedule");
  assert.match(fourth.reasons[0], /^PROBE_BUDGET_SPENT/);
  assert.equal(b.decide({ stats: ONE_CLOSE, probes: day.probes }).action, "GO", "and the live budget is untouched by any of it");
  assert.deepEqual(day.probes, {}, "which is still empty, because no live buy has landed");
});

test("T33: the engine hands the runner the tally that matches the venue's mode", async () => {
  const dir = tmp();
  // A bankroll where the minimum stake is $25: at the $5 floor the round trip is over 5% of stake and
  // nothing at these priors clears it even at the designed stop, which is the cost model working.
  const base = JSON.parse(fs.readFileSync(path.resolve("src/velocity/config/risk.example.json"), "utf8"));
  const cfg = { ...base, bankroll_usd: 500, per_trade_max_usd: 50, portfolio_max_exposure_usd: 200, daily_loss_limit_usd: 60, max_concurrent_positions: 4 };
  cfg.venues = { ...base.venues, pumpfun: { ...base.venues.pumpfun, max_exposure_usd: 200, min_stake_usd: 25 }, polymarket: { ...base.venues.polymarket, max_exposure_usd: 0 } };
  const file = path.join(dir, "risk.json"); fs.writeFileSync(file, JSON.stringify(cfg));

  const feed = new ScriptedFeed({ venue: "pumpfun", script: [] });
  const venues = { pumpfun: { mode: "paper", feed, edge: makePumpfunEdge({ aggression: 2 }), router: new PumpfunPaperRouter({ bookFile: path.join(dir, "paper-book-pumpfun.json"), latencyMs: 0 }), liveRouter: null } };
  const engine = new Engine({ dataDir: dir, envelope: loadRiskEnvelope(file), venues, config: { saveMs: 600_000, governorMs: 600_000, sweepMs: 600_000 } });
  try {
    await feed.start(); await engine.start({ reconcile: false });
    // The record the estimate reads, injected the way modeStats would have computed it.
    engine.stats = ONE_CLOSE;
    const now = Date.now();
    await engine.enqueue(() => engine.onEvent(makeEvent({ venue: "pumpfun", kind: "candidate", id: "MintEngine", t_venue: now - 100, t_observed: now, payload: goodCandidatePayload("MintEngine") })));
    const d = engine.ledger.query({ kind: "decision", limit: 20 })[0];
    assert.equal(d.action, "GO", JSON.stringify(d?.reasons));
    assert.equal(d.probe, true, "a probe, because the estimate still rests on the prior");
    // The tally is charged by the FILL, so the assertion belongs after the position exists. A
    // decision alone is not a measurement bought.
    assert.equal(engine.store.openPositions("pumpfun").length, 1, "the buy landed");
    const day = engine.store.state.day;
    assert.equal(day.paperProbes["pumpfun|2"], 1, "charged to the simulation's own budget");
    assert.deepEqual(day.probes, {}, "paper money never moved the live number");
  } finally { await engine.stop(); }
});

test("T33: a probe that never becomes a trade costs nothing from the day's budget", async () => {
  // A full slot table is the ordinary condition in continuous mode, not a corner case, and a GO can
  // also die under the minimum stake, on a missing reference, or on any router failure. Charged at
  // the approval, three such GOs spent the whole of a key's day having bought no measurement -- and
  // no measurement means the key stays on priors and burns the budget again tomorrow.
  const dir = tmp();
  const base = JSON.parse(fs.readFileSync(path.resolve("src/velocity/config/risk.example.json"), "utf8"));
  // One slot for the whole bot, and it is about to be occupied.
  const cfg = { ...base, bankroll_usd: 500, per_trade_max_usd: 50, portfolio_max_exposure_usd: 200, daily_loss_limit_usd: 60, max_concurrent_positions: 1 };
  cfg.venues = { ...base.venues, pumpfun: { ...base.venues.pumpfun, max_exposure_usd: 200, max_concurrent: 1, min_stake_usd: 25 }, polymarket: { ...base.venues.polymarket, max_exposure_usd: 0 } };
  const file = path.join(dir, "risk.json"); fs.writeFileSync(file, JSON.stringify(cfg));

  const feed = new ScriptedFeed({ venue: "pumpfun", script: [] });
  const venues = { pumpfun: { mode: "paper", feed, edge: makePumpfunEdge({ aggression: 2 }), router: new PumpfunPaperRouter({ bookFile: path.join(dir, "paper-book-pumpfun.json"), latencyMs: 0 }), liveRouter: null } };
  const engine = new Engine({ dataDir: dir, envelope: loadRiskEnvelope(file), venues, config: { saveMs: 600_000, governorMs: 600_000, sweepMs: 600_000, reentryCooldownMs: 0 } });
  try {
    await feed.start(); await engine.start({ reconcile: false });
    engine.stats = ONE_CLOSE;
    engine.modeStats = () => ONE_CLOSE;    // and it stays one close, whatever these trades do
    const send = async id => {
      const now = Date.now();
      await engine.enqueue(() => engine.onEvent(makeEvent({ venue: "pumpfun", kind: "candidate", id, t_venue: now - 100, t_observed: now, payload: goodCandidatePayload(id) })));
    };
    await send("MintSlot0");
    assert.equal(engine.store.openPositions("pumpfun").length, 1, "the one slot is taken");
    assert.equal(engine.store.state.day.paperProbes["pumpfun|2"], 1, "and charged for");

    for (const id of ["MintSlot1", "MintSlot2", "MintSlot3", "MintSlot4"]) await send(id);
    const decisions = engine.ledger.query({ kind: "decision", limit: 20 }).filter(x => /^MintSlot[1-4]$/.test(x.instrument));
    assert.equal(decisions.length, 4, "four more candidates were judged");
    assert.ok(decisions.every(x => x.action === "GO" && x.probe), `all four approved: ${JSON.stringify(decisions.map(x => x.reasons?.[0]))}`);
    assert.ok(decisions.every(x => /^PROBE 2\/3:/.test(x.reasons[0])), "and every one of them is still the SECOND draw of the day");
    assert.equal(engine.store.openPositions("pumpfun").length, 1, "none of them opened anything: the table is full");
    assert.equal(engine.store.state.day.paperProbes["pumpfun|2"], 1, "so the budget still shows one probe bought, not five");
  } finally { await engine.stop(); }
});
