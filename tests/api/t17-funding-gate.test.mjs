// T17: the panel offers Start when EITHER chain is funded.
//
// A wallet holding 0.002 SOL and 0.0241 ETH was shown "Send SOL to that address to begin" and no
// Start button at all. The engine had supported Robinhood Chain on its own for days; the panel read
// `funded` off the SOL balance alone, so nobody could ask for it. These assertions are on the
// source because the panel is one large component with no seam to render in isolation -- what they
// pin is that the rule is written once and read everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(path.resolve("app/src/Simple.jsx"), "utf8");

test("T17: funded means either chain, never SOL alone", () => {
  assert.match(SRC, /const fundedSol = \(tw\?\.solBalance \|\| 0\) >= MIN_BANKROLL_SOL/);
  assert.match(SRC, /const fundedEth = \(tw\?\.ethBalance \|\| 0\) >= MIN_BANKROLL_ETH/);
  assert.match(SRC, /const funded = fundedSol \|\| fundedEth/);
  // The old form gated the whole Start section on SOL. It must not come back.
  assert.doesNotMatch(SRC, /const funded = \(tw\?\.solBalance \|\| 0\) >= MIN_BANKROLL_SOL/);
  assert.match(SRC, /const MIN_BANKROLL_ETH = /, "Robinhood Chain has a floor of its own");
});

test("T17: one definition of which chains are on, read by Start and by the chips", () => {
  assert.match(SRC, /const chainsOn = \{/);
  // Start sends exactly what the chips show. Two separate expressions could disagree, and did:
  // the chips said pump.fun off while start() sent pumpfun: true.
  assert.match(SRC, /const usePump = chainsOn\.pumpfun, usePons = chainsOn\.pons/);
  assert.match(SRC, /const on = chainsOn/);
  // A chain the wallet cannot pay for is never on, whatever localStorage remembers.
  assert.match(SRC, /pumpfun: chains\.pumpfun !== false && fundedSol/);
  assert.match(SRC, /pons: !!chains\.pons && fundedEth/);
  // And the ad-hoc thresholds the chips used to carry are gone.
  assert.doesNotMatch(SRC, /solBalance \|\| 0\) > 0\.005/);
  assert.doesNotMatch(SRC, /ethBalance \|\| 0\) > 0\.003/);
});

test("T17: the panel's own arithmetic, on the wallet that could not start", () => {
  // Extracted verbatim from the component so the table below is the real rule, not a paraphrase.
  const MIN_SOL = Number(/const MIN_BANKROLL_SOL = ([\d.]+)/.exec(SRC)[1]);
  const MIN_ETH = Number(/const MIN_BANKROLL_ETH = ([\d.]+)/.exec(SRC)[1]);
  const decide = (sol, eth, chains = {}) => {
    const fundedSol = sol >= MIN_SOL, fundedEth = eth >= MIN_ETH;
    return { start: fundedSol || fundedEth, pumpfun: chains.pumpfun !== false && fundedSol, pons: (chains.pons ?? true) && fundedEth };
  };
  assert.equal(MIN_ETH, 0.01, "one $10 stake plus gas, with room for a few");

  // The screenshot: Start appears, and it starts on Robinhood Chain alone.
  assert.deepEqual(decide(0.002, 0.0241), { start: true, pumpfun: false, pons: true });
  // Exactly at the ETH floor, and just under it.
  assert.equal(decide(0, 0.01).start, true);
  assert.equal(decide(0, 0.009).start, false);
  // SOL alone still works, and both together turn both on.
  assert.deepEqual(decide(0.5, 0), { start: true, pumpfun: true, pons: false });
  assert.deepEqual(decide(2, 0.05), { start: true, pumpfun: true, pons: true });
  // Neither funded: no Start, which is the only case the old copy was ever right about.
  assert.equal(decide(0.002, 0).start, false);
  // Asking for a chain the wallet cannot pay for does not turn it on.
  assert.equal(decide(0.002, 0.05, { pumpfun: true }).pumpfun, false);
});
