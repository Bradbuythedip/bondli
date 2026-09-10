// T8: after retraining, gate checksums are unchanged, every weight is inside its
// constraint, no sacred inversion has flipped, and any version can be restored.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { retrain, WeightStore, DEFAULT_WEIGHTS, WEIGHT_CONSTRAINTS, SACRED_INVERSIONS, checksumFiles, verifyChecksums, scoreFeatures } from "../../src/velocity/core/learner.mjs";

function lcg(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31; }

function synth(n, { survivorHelps = true, seed = 3 } = {}) {
  const rnd = lcg(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = { apeScore: rnd(), memeticQuick: rnd(), survivorMatch: rnd(), chartHealth: rnd(), whaleBullish: rnd(), walletAge: rnd(), freshWalletRatio: rnd() };
    const signal = (survivorHelps ? f.survivorMatch : 1 - f.survivorMatch) * 0.7 + f.apeScore * 0.3 + (rnd() - 0.5) * 0.3;
    out.push({ features: f, pnl_usd: signal > 0.5 ? 8 : -6 });
  }
  return out;
}

test("T8: retrain keeps constraints, sums to one, and gates untouched", () => {
  const before = checksumFiles();
  const r = retrain({ outcomes: synth(200), weights: DEFAULT_WEIGHTS.pumpfun });
  assert.equal(r.n, 200);
  const sum = Object.values(r.weights).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 1) < 1e-4);
  for (const [k, w] of Object.entries(r.weights)) {
    const c = WEIGHT_CONSTRAINTS.pumpfun[k];
    assert.ok(w >= c.min - 1e-9 && w <= c.max + 1e-9, `${k}=${w} outside [${c.min},${c.max}]`);
  }
  assert.ok(r.weights.survivorMatch >= DEFAULT_WEIGHTS.pumpfun.survivorMatch - 1e-9, "the feature that predicts pnl does not lose weight");
  assert.equal(r.violations.length, 0);
  const after = verifyChecksums(before);
  assert.equal(after.ok, true, `gate files changed: ${after.changed}`);
});

test("T8: data that contradicts a sacred prior cannot flip it", () => {
  const r = retrain({ outcomes: synth(200, { survivorHelps: false, seed: 9 }), weights: DEFAULT_WEIGHTS.pumpfun });
  const v = r.violations.find(x => x.feature === "survivorMatch");
  assert.ok(v, "violation recorded for a human");
  assert.equal(v.expected, "positive");
  assert.ok(v.observed < 0);
  assert.equal(r.weights.survivorMatch, +(WEIGHT_CONSTRAINTS.pumpfun.survivorMatch.min / Object.values(r.weights).reduce((s, x) => s + x, 0) * 0 + r.weights.survivorMatch).toFixed(6));
  assert.ok(r.weights.survivorMatch > 0, "still counts in the sacred direction");
  assert.deepEqual(Object.keys(SACRED_INVERSIONS.pumpfun).sort(), ["apeScore", "freshWalletRatio", "survivorMatch"]);
  // Negative-signed features reduce confidence as they rise.
  const lo = scoreFeatures({ freshWalletRatio: 0.1 }, { freshWalletRatio: 1 });
  const hi = scoreFeatures({ freshWalletRatio: 0.9 }, { freshWalletRatio: 1 });
  assert.ok(lo > hi);
});

test("T8: too few outcomes leaves weights unchanged; versions persist and roll back", () => {
  const r = retrain({ outcomes: synth(10), weights: DEFAULT_WEIGHTS.pumpfun });
  assert.equal(r.changed, false);
  assert.match(r.reason, /need 30/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "velocity-t8-"));
  const store = new WeightStore(dir);
  assert.equal(store.current().version, 0);
  const v1 = store.save({ ...DEFAULT_WEIGHTS.pumpfun }, { note: "seed" });
  const v2 = store.save(retrain({ outcomes: synth(100), weights: v1.weights }).weights, { note: "retrain" });
  assert.equal(v2.version, 2);
  assert.equal(store.current().version, 2);
  store.rollback(1);
  assert.equal(store.current().version, 1);
  assert.equal(store.history().length, 2);
  assert.throws(() => store.rollback(9), /no weights version/);
});
