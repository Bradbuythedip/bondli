// T35: pricing a token off the chain instead of off the wire. A coin launched through somebody
// else's front end reaches the radar quoted in pump.fun's constants -- one billion supply, a curve
// measured from a virtual reserve it never opened at -- and both readings break together: the market
// cap is multiplied by (1e9 / real supply) and the curve clamps to full the moment it opens above 30
// SOL. Two tokens holding $2.5k were served at $1.1M and $500k, one minute old, zero buyers, "curve
// 100%", at the top of the near-graduation list.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { decodeBondingCurve, curveMcapSol, curveProgress, curveSupply, supplyRatio, reconcileFromCurve, implausible, GRADUATION_SOL, PUMP_SUPPLY } from "../../src/api/pumpcurve.mjs";
import { decodeCurveFlags } from "../../src/api/mayhem.mjs";

/** A bonding-curve account: 8-byte discriminator, five u64s, then the `complete` byte. */
function curveAccount({ vTok, vSol, rTok = 0, rSol = 0, supply, complete = false, len = 81 }) {
  const b = Buffer.alloc(Math.max(49, len));
  b.writeBigUInt64LE(BigInt(Math.round(vTok)), 8);
  b.writeBigUInt64LE(BigInt(Math.round(vSol)), 16);
  b.writeBigUInt64LE(BigInt(Math.round(rTok)), 24);
  b.writeBigUInt64LE(BigInt(Math.round(rSol)), 32);
  b.writeBigUInt64LE(BigInt(Math.round(supply)), 40);
  b[48] = complete ? 1 : 0;
  return b;
}
// pump.fun's opening curve: 30 virtual SOL, 1.073B virtual tokens, 1B supply. Price is 30/1.073e9
// SOL per token, so the whole billion is worth ~28 SOL.
const STANDARD = () => curveAccount({ vTok: 1.073e15, vSol: 30e9, rTok: 793.1e12, rSol: 0, supply: 1e9 * 1e6 });

test("T35: the layout is the one mayhem.mjs already pins", () => {
  // `complete` at offset 48 is read by two modules now. If the layout ever moved, both move together
  // and this is the test that says so, rather than a market cap quietly going wrong in production.
  const done = curveAccount({ vTok: 1e15, vSol: 115e9, supply: 1e9 * 1e6, complete: true });
  assert.equal(decodeCurveFlags(done).complete, true);
  assert.equal(decodeBondingCurve(done).complete, true);
  assert.equal(decodeBondingCurve(STANDARD()).complete, false);
  // Anything too short, or with no reserves to price off, decodes to nothing rather than to zero.
  assert.equal(decodeBondingCurve(Buffer.alloc(40)), null);
  assert.equal(decodeBondingCurve(null), null);
  assert.equal(decodeBondingCurve(curveAccount({ vTok: 0, vSol: 30e9, supply: 1e9 * 1e6 })), null);
});

test("T35: a standard launch is priced exactly as it always was", () => {
  const c = decodeBondingCurve(STANDARD());
  assert.equal(curveSupply(c), 1e9);
  assert.equal(supplyRatio(c), 1, "nothing to correct");
  const mcap = curveMcapSol(c);
  assert.ok(mcap > 27.9 && mcap < 28.1, `opening mcap ${mcap} SOL`);
  const r = reconcileFromCurve(STANDARD(), { solPrice: 200 });
  assert.equal(r.standard, true);
  assert.equal(r.mcapUsd, Math.round(mcap * 200));
});

test("T35: a foreign launchpad's supply is the whole of the error", () => {
  // The same curve with a 2.5M supply instead of a billion: every quote for it is 400x too high,
  // which is the shape of a $2.5k token served at $1.1M.
  const small = curveAccount({ vTok: 1.073e15, vSol: 30e9, supply: 2.5e6 * 1e6 });
  const r = reconcileFromCurve(small, { solPrice: 200 });
  assert.equal(r.supply, 2.5e6);
  assert.equal(Math.round(r.supplyRatio), 400);
  assert.equal(r.standard, false);
  // The chain's price is the wire's divided by exactly that factor, which is why one ratio kept on
  // the token is enough to correct every quote that follows.
  const wire = reconcileFromCurve(STANDARD(), { solPrice: 200 }).mcapUsd;
  assert.equal(Math.round(wire / r.supplyRatio), r.mcapUsd);
});

test("T35: curve progress is the SOL actually raised, not a distance from an assumed start", () => {
  // The bug in one line: a curve that opens at 150 virtual SOL reads 100% under (vSol - 30) / 85,
  // with nothing raised and nobody having bought. Measured off the real reserve it reads zero.
  const foreign = curveAccount({ vTok: 1.073e15, vSol: 150e9, rSol: 0, supply: 2.5e6 * 1e6 });
  assert.equal(curveProgress(decodeBondingCurve(foreign)), 0);
  // Half the graduation raised is half way, and a completed curve is one whatever its reserves say.
  const half = curveAccount({ vTok: 1e15, vSol: 70e9, rSol: (GRADUATION_SOL / 2) * 1e9, supply: 1e9 * 1e6 });
  assert.equal(curveProgress(decodeBondingCurve(half)), 0.5);
  const done = curveAccount({ vTok: 1e15, vSol: 115e9, rSol: 0, supply: 1e9 * 1e6, complete: true });
  assert.equal(curveProgress(decodeBondingCurve(done)), 1);
  // And it never runs past one, however much sits in the curve.
  const over = curveAccount({ vTok: 1e15, vSol: 200e9, rSol: 200e9, supply: 1e9 * 1e6 });
  assert.equal(curveProgress(decodeBondingCurve(over)), 1);
});

test("T35: a reading the token's own history contradicts is not a price", () => {
  // Neither rule is about a launchpad. A curve cannot be nearly full before anyone has bought, and a
  // token is not worth six figures with no trades behind it. Both say the quote used wrong constants.
  assert.equal(implausible({ ca: "A", buys: 0, sells: 0, mcapUsd: 1_100_000, _curvePct: 1 }), "FULL_CURVE_NO_TRADES");
  assert.equal(implausible({ ca: "A", buys: 0, sells: 0, mcapUsd: 500_000 }, { curvePct: 1 }), "FULL_CURVE_NO_TRADES");
  assert.equal(implausible({ ca: "A", buys: 2, sells: 0, mcapUsd: 900_000, _curvePct: 0.1 }), "RICH_WITHOUT_TRADES");
  // A real token that got there the ordinary way is left alone: trades behind the curve, and a market
  // cap that grew with them.
  assert.equal(implausible({ ca: "A", buys: 60, sells: 20, mcapUsd: 400_000, _curvePct: 0.95 }), null);
  assert.equal(implausible({ ca: "A", buys: 1, sells: 0, mcapUsd: 3_200, _curvePct: 0.02 }), null);
  assert.equal(implausible(null), null);
});

test("T35: the radar prices off the chain and keeps the correction", () => {
  const SRV = fs.readFileSync("src/api/server.production.mjs", "utf8");
  // The reconcile rides the account read the mayhem probe already does: no second RPC per token.
  assert.match(SRV, /const v = detectMayhem\(\{ curve: info\?\.data \|\| null \}\);\n\s+if \(v\.mayhem\) markMayhem\(mint, v\.source\);\n\s+reconcileCurve\(mint, info\?\.data \|\| null\);/);
  // The wire keeps quoting the bad number on every trade, so it is divided out there rather than
  // re-fetched: one ratio on the token, applied for as long as the token lives.
  assert.match(SRV, /t\._supplyRatio = r\.supplyRatio && r\.supplyRatio > 0 \? r\.supplyRatio : 1;/);
  assert.match(SRV, /const corrected = wireMcapSol\(token, mcSol\);/);
  // A curve the chain has read is believed over the vSol >= 84 graduation guess, which is what put a
  // one-minute-old token in the near-graduation list.
  assert.match(SRV, /if \(vSol >= 84 && !token\.graduated && !token\._curveFromChain\) \{/);
  // Held out of the bot's candidate feed and out of the near-graduation list until it is believed.
  assert.match(SRV, /if \(!priceTrusted\(t, now\)\) continue;/);
  assert.match(SRV, /const graduating = both\.filter\(t => priceTrusted\(t, now\)/);
  // PONS and Arc read their own curves; a Solana probe on an EVM address would be meaningless.
  assert.match(SRV, /if \(!radar\.tokens\.has\(t\.ca\)\) return true;/);
  // And the row says so rather than printing a number nobody can stand behind.
  assert.match(SRV, /mcapUsd: t\._priceUnknown \? null : Math\.round\(mc\),/);
  const SITE = fs.readFileSync("app/src/Simple.jsx", "utf8");
  assert.match(SITE, /tok\.priceUnknown \? t\("live\.priceUnknown"\) : kfmt\(tok\.mcapUsd\)/);
});
