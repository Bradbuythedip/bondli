// T32: a zero win rate is a measurement, and a short record is worth something.
//
// Two defects in one line of the edge model. The record was only consulted at thirty closes AND a win
// rate above zero, so (a) a plan key that had lost every trade it ever took looked exactly like one
// that had never traded -- it fell to the priors, probed again, and the 14-day window aged the losses
// out before they could ever be an argument against it; and (b) with outcomes bucketed by plan key,
// eighteen buckets across three venues each needed thirty of their own closes against a live history
// counted in dozens, so in practice nothing was ever priced on its own record at all.
//
// What is pinned here: a record counts from the first close, in proportion to its size; it may lower
// the estimate and may never raise it; and only an absent or malformed bucket falls back to a guess.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePumpfunEdge, PUMPFUN_PRIORS } from "../../src/velocity/venues/pumpfun/edge.mjs";
import { statsFromOutcomes } from "../../src/velocity/core/stats.mjs";
import { GateRunner } from "../../src/velocity/core/pipeline.mjs";
import { makeEvent } from "../../src/velocity/core/events.mjs";
import { goodCandidatePayload } from "./helpers/fixtures.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine } from "../../src/velocity/core/engine.mjs";
import { loadRiskEnvelope } from "../../src/velocity/core/risk.mjs";
import { ScriptedFeed } from "../../src/velocity/core/feed.mjs";
import { PumpfunPaperRouter } from "../../src/velocity/venues/pumpfun/router.mjs";

/** The same candidate every time: an edge, a runner, the gated candidate and the event it came from. */
function bench() {
  const edge = makePumpfunEdge({ aggression: 2 });
  const runner = new GateRunner({ venue: "pumpfun", edge });
  const payload = goodCandidatePayload("MintShrink");
  const event = makeEvent({ venue: "pumpfun", kind: "candidate", id: "MintShrink", t_venue: Date.now() - 100, t_observed: Date.now(), payload });
  const [cand] = edge.ingest(event);
  for (const g of edge.gates) {
    const r = g.check(cand);
    assert.equal(r.pass, true, `${g.name}: ${JSON.stringify(r?.reasons)}`);
  }
  const key = edge.estimate(cand, {}).plan_key;
  const prior = PUMPFUN_PRIORS[cand.tier];
  const at = bucket => (bucket === undefined ? {} : { stats: { pumpfun: { [key]: bucket } } });
  return { edge, runner, event, cand, key, prior, at,
    estimate: bucket => edge.estimate(cand, at(bucket)),
    // A fresh day's probe tally every time: a probe with nowhere to charge itself is refused, and
    // that refusal is T33's subject rather than this file's.
    decide: bucket => runner.evaluate(event, cand, { governor: {}, probes: {}, ...at(bucket) }) };
}

test("T32: a plan key that has lost every trade is measured, not mistaken for one that never traded", () => {
  const b = bench();
  // Same candidate, no record: a GO on the priors, and a thin one -- which is the whole point. The
  // forty-two losses below used to leave it exactly here.
  const clean = b.decide();
  assert.equal(clean.action, "GO", `on priors: ${JSON.stringify(clean.reasons)}`);
  assert.equal(clean.p_win, b.prior.p_win, "and it is the prior doing the work");

  const wiped = { n: 42, wins: 0, p_win: 0, payoff: 0, loss_fraction: 0.05 };
  const est = b.estimate(wiped);
  assert.equal(est.on_priors, false, "forty-two closes are a record even when every one of them lost");
  assert.equal(est.outcomes_seen, 42);
  assert.ok(est.p_win > 0 && est.p_win < b.prior.p_win, `blended down, not erased: ${est.p_win}`);
  assert.ok(est.payoff > 0 && est.payoff < b.prior.payoff, `and so is the payoff: ${est.payoff}`);
  // The realized loss size is shrunk toward the designed stop at the SAME weight as the rest of the
  // record, and for the same reason: taken raw it was the one input through which a record could make
  // the gate KEENER, because expected value multiplies the edge by it. Forty-two closes own most of
  // the distance, so this lands near what was actually lost without ever being taken on trust at n=1.
  const priorLoss = PUMPFUN_PRIORS[b.cand.tier].loss_fraction;
  const w42 = 42 / (42 + 12);
  assert.ok(Math.abs(est.loss_fraction - (priorLoss + (0.05 - priorLoss) * w42)) < 1e-12, `blended, not raw: ${est.loss_fraction}`);
  assert.ok(est.loss_fraction < priorLoss && est.loss_fraction > 0.05, "between the designed stop and what it actually lost");
  assert.ok(est.reasons.some(r => /stats n=42 wins=0/.test(r)), `the estimate says which it used: ${JSON.stringify(est.reasons)}`);

  const d = b.decide(wiped);
  assert.equal(d.action, "REJECT", `an all-losing key stops trading: ${JSON.stringify(d.reasons)}`);
  assert.equal(d.gate, "ev", "refused on expected value, not for having no estimate at all");
  assert.ok(d.ev < 0, `deeply negative: ${d.ev}`);
  assert.ok(!d.reasons.some(r => /_ON_PRIORS/.test(r)), "and the refusal is a measurement, so it names no prior");
});

test("T32: a short record counts in proportion to its length, between the prior and what it claims", () => {
  const b = bench();
  const raw = 1 / 12;
  const est = b.estimate({ n: 12, wins: 1, p_win: raw, payoff: 2, loss_fraction: 0.1 });
  assert.equal(est.on_priors, false, "twelve closes are evidence");
  assert.ok(est.p_win < b.prior.p_win, `below the prior, because one win in twelve is bad news: ${est.p_win}`);
  assert.ok(est.p_win > raw, `and above the raw rate, because twelve closes do not settle it: ${est.p_win}`);
  // n/(n+k) at k=12: twelve closes are worth exactly half the distance.
  assert.ok(Math.abs(est.p_win - (b.prior.p_win + (raw - b.prior.p_win) / 2)) < 1e-12, `halfway at n=k: ${est.p_win}`);
  assert.ok(est.payoff < b.prior.payoff && est.payoff > 2, `the payoff moves the same way: ${est.payoff}`);

  // Longer records land nearer what they claim, and never past it.
  const fifty = b.estimate({ n: 50, wins: 4, p_win: 0.08, payoff: 2, loss_fraction: 0.1 });
  assert.ok(fifty.p_win < est.p_win, `fifty closes weigh more than twelve: ${fifty.p_win} vs ${est.p_win}`);
  assert.ok(fifty.p_win > 0.08, "still short of the raw rate");
});

test("T32: evidence may lower the estimate and may never raise it", () => {
  const b = bench();
  const great = b.estimate({ n: 200, wins: 180, p_win: 0.9, payoff: 8, loss_fraction: 0.02 });
  assert.equal(great.outcomes_seen, 200, "two hundred closes are still counted");
  assert.equal(great.p_win, b.prior.p_win, "a key beating its prior is priced as though it were only meeting it");
  assert.equal(great.payoff, b.prior.payoff);
  // ...and because the clamp is what produced that number, the PRIOR is what is speaking here, which
  // is what on_priors means and what keeps such a key's probe open. See the dedicated case below.
  assert.equal(great.on_priors, true);
  // Not a rounding accident: a run of wins at any length stays capped.
  for (const n of [1, 8, 30, 500]) {
    const e = b.estimate({ n, wins: n, p_win: 1, payoff: 9, loss_fraction: 0.02 });
    assert.ok(e.p_win <= b.prior.p_win && e.payoff <= b.prior.payoff, `n=${n} raised the estimate: ${e.p_win}/${e.payoff}`);
  }
  // Monotone downward: more losses in the same bucket never make the estimate friendlier.
  let last = b.prior.p_win;
  for (const n of [4, 12, 40, 120]) {
    const e = b.estimate({ n, wins: 0, p_win: 0, payoff: 0, loss_fraction: 0.05 });
    assert.ok(e.p_win < last, `n=${n} should be worse than the shorter record: ${e.p_win} vs ${last}`);
    last = e.p_win;
  }
});

test("T32: one close lowers the estimate but does not yet take the floor from the prior", () => {
  const b = bench();
  // The flag exists for the probe branch, so it has to mean "the prior is still what is speaking".
  // A single close of ANY kind lands in the bucket -- a forced exit at a mode change, a flatten, a
  // user's own sell -- and a tier whose prior does not clear its costs alone trades only because the
  // probe is open. If one such close closed the probe, the record could never reach the eight or
  // twelve closes the shrinkage is for: the key would be shut for the fourteen days the window runs.
  const one = { n: 1, wins: 0, p_win: 0, payoff: 0, loss_fraction: 0.05 };
  const est = b.estimate(one);
  assert.equal(est.on_priors, true, "one close does not make a record that can speak for a plan key");
  assert.equal(est.outcomes_seen, 1, "but it is counted, and said out loud");
  assert.ok(est.p_win < b.prior.p_win, `and it still costs the estimate something: ${est.p_win}`);
  // And because the prior is still what is speaking, the trade is bought rather than refused -- at
  // probe size, out of the day's budget. How that budget works is T33's subject, not this file's;
  // what matters here is that ONE close cannot shut a key. It used to: the expected value is
  // negative either way, and with the probe closed the key was refused for the fourteen days the
  // statistics window runs, having traded exactly once.
  const d1 = b.decide(one);
  assert.equal(d1.action, "GO", JSON.stringify(d1.reasons));
  assert.equal(d1.probe, true, "bought as a measurement, not taken as a trade");
  assert.ok(d1.ev < 0, `and it is still a negative-EV trade: ${d1.ev}`);
  assert.equal(d1.stake_cap_fraction, 0.4, "at the reduced size a probe is always bought at");

  // Six closes is where the record owns a third of the estimate and takes over. Three bad closes out
  // of eight is then enough to close a key; one is not.
  assert.equal(b.estimate({ n: 5, wins: 0, p_win: 0, payoff: 0, loss_fraction: 0.05 }).on_priors, true);
  assert.equal(b.estimate({ n: 6, wins: 0, p_win: 0, payoff: 0, loss_fraction: 0.05 }).on_priors, false);
  const eight = b.decide({ n: 8, wins: 5, p_win: 5 / 8, payoff: 1.1, loss_fraction: 0.05 });
  assert.equal(eight.action, "REJECT", `three bad closes out of eight close the key: ${JSON.stringify(eight.reasons)}`);
  assert.equal(eight.gate, "ev");
  assert.ok(!eight.probe, "and once the record speaks there is nothing left to probe for");
});

test("T32: an absent or malformed bucket is the absence of evidence and takes the prior", () => {
  const b = bench();
  const priors = [undefined, {}, { n: 0, wins: 0, p_win: 0, payoff: 0 }, { n: "12", p_win: 0.5, payoff: 2 },
                  { n: 30, p_win: null, payoff: 2 }, { n: 30, p_win: 0.4, payoff: NaN }, { n: 30, p_win: 1.4, payoff: 2 },
                  { n: 30, p_win: 0.4, payoff: -1 }];
  for (const bucket of priors) {
    const e = b.estimate(bucket);
    assert.equal(e.on_priors, true, `not a record: ${JSON.stringify(bucket)}`);
    assert.equal(e.p_win, b.prior.p_win);
    assert.equal(e.payoff, b.prior.payoff);
    assert.equal(e.outcomes_seen, 0, "and it reports no closes rather than a count it cannot use");
    assert.ok(e.reasons.includes("priors"));
  }
  // A record under a DIFFERENT plan key is not this key's record.
  const elsewhere = b.edge.estimate(b.cand, { stats: { pumpfun: { dip_hold: { n: 90, wins: 0, p_win: 0, payoff: 0, loss_fraction: 0.3 } } } });
  assert.equal(elsewhere.on_priors, true);
  assert.equal(elsewhere.p_win, b.prior.p_win);
});

test("T32: the ledger's own bucket carries n and wins, so a wipeout can be told from a blank", () => {
  const b = bench();
  const close = (pnl, i) => ({ venue: "pumpfun", tier: b.cand.tier, plan_key: b.key, pnl_usd: pnl, stake_usd: 20, ts: 1_800_000_000_000 + i });
  const wiped = statsFromOutcomes(Array.from({ length: 9 }, (_, i) => close(-3, i))).pumpfun[b.key];
  assert.equal(wiped.n, 9, "the count is on the bucket");
  assert.equal(wiped.wins, 0, "and so is the win count, which is the only thing that separates this from no record");
  assert.equal(wiped.p_win, 0);
  assert.ok(wiped.loss_fraction > 0, "with all losses, loss_fraction is the average of what was actually lost");
  assert.equal(wiped.payoff, 0);

  // Straight from the ledger into the model, with no hand-written bucket in between.
  const est = b.estimate(wiped);
  assert.equal(est.on_priors, false, "nine real closes are a record");
  assert.equal(est.outcomes_seen, 9);
  assert.ok(est.p_win < b.prior.p_win, `nine losses cost it: ${est.p_win}`);
  // Nine closes carry nine closes' worth of the realized loss size and no more: the estimate sits
  // strictly between the designed stop and what the key actually lost, whichever of the two is bigger.
  const lo = Math.min(wiped.loss_fraction, b.prior.loss_fraction), hi = Math.max(wiped.loss_fraction, b.prior.loss_fraction);
  assert.ok(est.loss_fraction > lo && est.loss_fraction < hi,
    `between ${lo} and ${hi}, got ${est.loss_fraction}`);
  assert.ok(Math.abs(est.loss_fraction - (b.prior.loss_fraction + (wiped.loss_fraction - b.prior.loss_fraction) * (9 / 21))) < 1e-12, "at n/(n+k)");

  // A mixed record keeps its win count too, and is priced better than the wipeout.
  const mixed = statsFromOutcomes(Array.from({ length: 9 }, (_, i) => close(i < 3 ? 6 : -3, i))).pumpfun[b.key];
  assert.equal(mixed.wins, 3);
  assert.ok(b.estimate(mixed).p_win > est.p_win, "three wins in nine beats none in nine");
});

test("T32: no record of any shape may make the gate keener than no record at all", () => {
  // The property the whole family rests on, asserted where the money is actually decided rather than
  // on two of the three inputs. p_win and payoff were clamped against the prior, but expected value
  // is computed in units of STAKE and the converter between the two -- loss_fraction -- was passed
  // through raw. So a record COULD raise the estimate, through the one channel nobody clamped, and it
  // raised it most for the keys that lost biggest: measured against this file before the change, one
  // -60% rug came back at EV +0.0886 against a no-record +0.0060, and one -100% close that the bot
  // could not sell at +0.1757. A position the bot could not get out of was the strongest argument the
  // gate had for taking that plan key again, at full size.
  const b = bench();
  const clean = b.decide().ev;
  for (const n of [1, 2, 6, 12, 40, 200]) {
    for (const p_win of [0, 0.1, 0.34, 0.5, 0.9, 1]) {
      for (const payoff of [0.1, 1, 3, 9]) {
        for (const loss_fraction of [0.01, 0.05, 0.12, 0.4, 1]) {
          const d = b.decide({ n, wins: Math.round(n * p_win), p_win, payoff, loss_fraction });
          assert.ok(d.ev <= clean + 1e-12,
            `{n:${n}, p_win:${p_win}, payoff:${payoff}, loss_fraction:${loss_fraction}} raised the EV to ${d.ev} against ${clean}`);
        }
      }
    }
  }
  // The three shapes that were measured doing it, named so a regression says which.
  const rug = b.decide({ n: 1, wins: 0, p_win: 0, payoff: 0, loss_fraction: 0.60 });
  assert.ok(rug.ev < clean, `one rug: ${rug.ev}`);
  assert.ok(rug.stake_cap_fraction === 0.4, "and if it is taken at all it is taken at probe size, never full");
  const unsellable = b.decide({ n: 1, wins: 0, p_win: 0, payoff: 0, loss_fraction: 1 });
  assert.ok(unsellable.ev < clean, `one -100% bookkeeping close: ${unsellable.ev}`);
  const stop = b.decide({ n: 1, wins: 0, p_win: 0, payoff: 0, loss_fraction: 0.05 });
  assert.ok(stop.ev < clean, `one ordinary stop: ${stop.ev}`);
});

test("T32: a key whose record BEATS its prior is priced at the prior and keeps its probe", () => {
  // The other absorbing state. Because the estimate is clamped at the prior, a key doing better than
  // its prior comes back AT the prior -- so the prior is what is speaking, and the flag that says so
  // must agree. It did not: the flag flipped on n alone, which closed the probe branch on keys that
  // were winning and left them refused until the fourteen-day window aged the winning record out.
  // Tiers 2 and 3 are STRONG and SPECULATIVE, which is most of the flow.
  const b = bench();
  const winning = { n: 20, wins: 10, p_win: 0.50, payoff: 4.0, loss_fraction: b.prior.loss_fraction };
  const est = b.estimate(winning);
  assert.equal(est.p_win, b.prior.p_win, "priced at the prior, as the clamp requires");
  assert.equal(est.payoff, b.prior.payoff);
  assert.equal(est.on_priors, true, "and the prior is therefore what is speaking");
  assert.equal(est.outcomes_seen, 20, "which is not the same as saying there is no record");
  // Priced at the prior, it is a GO wherever the prior is one. Where costs are high enough that even
  // the prior does not clear them, it is still probe-eligible rather than shut out.
  assert.equal(b.decide(winning).action, "GO", JSON.stringify(b.decide(winning).reasons));
  const dear = b.runner.evaluate(b.event, b.cand, { governor: {}, probes: {}, minStakeUsd: 5, ...b.at(winning) });
  assert.equal(dear.action, "GO", `at the $5 floor the prior itself does not clear: ${JSON.stringify(dear.reasons)}`);
  assert.equal(dear.probe, true, "so what it gets is a bounded probe, not a hard refusal");
  assert.equal(dear.stake_cap_fraction, 0.4);

  // And a record that is genuinely WORSE than the prior still takes the floor and shuts the key.
  const losing = { n: 20, wins: 2, p_win: 0.10, payoff: 4.0, loss_fraction: b.prior.loss_fraction };
  assert.equal(b.estimate(losing).on_priors, false, "a worse-than-prior record is the thing speaking");
  const d = b.decide(losing);
  assert.equal(d.action, "REJECT", JSON.stringify(d.reasons));
  assert.ok(!d.probe, "and it is not probed around");
});

test("T32: a bucket with no loss in it yet has no payoff ratio, and is not read as a bad one", () => {
  // avgLoss fell back to 1 when a bucket held no losses, so a key that had won every trade it took
  // came back with a payoff of 0.25 -- a number in stake units wearing the units of one average loss
  // -- and the one-directional clamp then took that 0.25 as the key's ceiling and shut it.
  const b = bench();
  const wins = statsFromOutcomes(Array.from({ length: 10 }, (_, i) =>
    ({ venue: "pumpfun", plan_key: b.key, pnl_usd: 5, stake_usd: 20, ts: 1_800_000_000_000 + i }))).pumpfun[b.key];
  assert.equal(wins.n, 10);
  assert.equal(wins.p_win, 1);
  assert.equal(wins.payoff, null, "there is no average loss to divide by, and it says so rather than inventing one");
  assert.equal(wins.loss_fraction, 0);
  const est = b.estimate(wins);
  assert.equal(est.payoff, b.prior.payoff, "so the payoff falls back to the prior");
  assert.equal(est.loss_fraction, b.prior.loss_fraction, "and so does the size of a loss it has never taken");
  assert.equal(est.outcomes_seen, 10, "the ten closes are still counted");
  assert.equal(b.decide(wins).action, "GO", "a key that has only ever won is not shut for it");
  // Still capped: winning everything does not buy a bigger estimate than the prior.
  assert.ok(est.p_win <= b.prior.p_win);
});

test("T32: a close the plan did not decide is not evidence about the plan", async () => {
  // Every forced exit carries a plan_key and so lands in that key's bucket, and under proportional
  // shrinkage they are decisive rather than dilute: six of them take the record past a third of the
  // estimate and shut the key for the fourteen days the window runs, and one at a large loss moves
  // the estimate on its own. None of them is the exit plan's judgement of the trade. A user's stop,
  // a wallet sweep, the flatten every open position takes when a venue is promoted, a leg unwound by
  // a failed second fill, a position the venue says we do not hold -- a human's exit timing, or a
  // bookkeeping close, is not the model's.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "velocity-t32-"));
  const feed = new ScriptedFeed({ venue: "pumpfun", script: [] });
  const engine = new Engine({
    dataDir: dir,
    envelope: loadRiskEnvelope(path.resolve("src/velocity/config/risk.example.json")),
    venues: { pumpfun: { mode: "paper", feed, edge: makePumpfunEdge({ aggression: 2 }), router: new PumpfunPaperRouter({ bookFile: path.join(dir, "paper-book-pumpfun.json"), latencyMs: 0 }) } },
    config: { saveMs: 600_000, governorMs: 600_000, sweepMs: 600_000 },
  });
  try {
    await feed.start(); await engine.start({ reconcile: false });
    const close = (reason, by) => engine.ledger.append({ kind: "outcome", venue: "pumpfun", instrument: "M", plan_key: 2, tier: 2,
      pnl_usd: -6, pnl_pct: -30, stake_usd: 20, held_ms: 60_000, reason, by, paper: true, ts: engine.clock() });

    for (const [reason, by] of [["FLATTEN", "user"], ["VENUE_MODE_CHANGE", "retry"], ["USER_SELL", "user"],
                                ["USER_SWEEP", "user"], ["MISSING_AT_VENUE", undefined], ["LEG_UNWOUND", undefined],
                                ["RELEASED", "user"], ["FLATTEN", "retry"], ["USER_SELL", "user"]]) close(reason, by);
    assert.equal(engine.ledger.query({ kind: "outcome", limit: 50 }).length, 9, "nine closes are on the ledger");
    assert.deepEqual(engine.modeStats(), {}, "and not one of them is evidence about the plan");

    // The same nine as stop losses, which the plan did decide, and the bucket fills.
    for (let i = 0; i < 9; i++) close("SL2", "plan");
    const bucket = engine.modeStats().pumpfun?.[2];
    assert.equal(bucket?.n, 9, "nine real closes are nine closes");
    assert.equal(bucket.wins, 0);
    // And the sweeper's own time-driven exits count too: nobody chose them, the plan's clock did.
    close("MAX_HOLD", "timer");
    assert.equal(engine.modeStats().pumpfun[2].n, 10);

    // Through the estimate, which is where it costs money: nine forced closes leave the key exactly
    // where it started, on priors with nothing seen.
    const b = bench();
    const forcedOnly = new Engine({
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "velocity-t32b-")),
      envelope: loadRiskEnvelope(path.resolve("src/velocity/config/risk.example.json")),
      venues: { pumpfun: { mode: "paper", feed, edge: makePumpfunEdge({ aggression: 2 }), router: new PumpfunPaperRouter({ bookFile: path.join(dir, "paper-book-2.json"), latencyMs: 0 }) } },
      config: { saveMs: 600_000, governorMs: 600_000, sweepMs: 600_000 },
    });
    try {
      await forcedOnly.start({ reconcile: false });
      for (let i = 0; i < 9; i++) forcedOnly.ledger.append({ kind: "outcome", venue: "pumpfun", instrument: "M", plan_key: b.key, tier: 2,
        pnl_usd: -20, pnl_pct: -100, stake_usd: 20, held_ms: 60_000, reason: "FLATTEN", by: "user", paper: true, ts: forcedOnly.clock() });
      const est = b.edge.estimate(b.cand, { stats: forcedOnly.modeStats() });
      assert.equal(est.on_priors, true, "still on priors");
      assert.equal(est.outcomes_seen, 0, "with nothing seen");
      assert.equal(est.p_win, b.prior.p_win);
      assert.equal(est.loss_fraction, b.prior.loss_fraction, "and no -100% bookkeeping close pricing its losses");
    } finally { await forcedOnly.stop(); }
  } finally { await engine.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
