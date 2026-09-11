// The simulator's curve is the contract's arithmetic: quotes match bondli's float model, the last buy
// clamps and refunds, sells are refused once graduation is reached, the opening tax spares the declared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CurveModel, CurveError, amountOut, amountIn, snipeTaxBpsAt, ethToWei, toEth, toTokens, WAD, DEFAULT_ECONOMICS, MAX_SNIPE_TAX_EXEMPTIONS } from "../../launch/robinhood/lib/curve-model.mjs";
import { curveBuyQuote, curveSellQuote } from "../../src/velocity/venues/pons/chain.mjs";

const close = (a, b, rel = 1e-6) => assert.ok(Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-12), `${a} vs ${b}`);

test("T1: constant-product quotes agree with the venue's float model to 1e-6", () => {
  const c = new CurveModel({}, { deployer: "0xdev" });
  const info = c.info();
  for (const eth of [0.001, 0.05, 0.5, 2]) {
    const q = c.quoteBuy(ethToWei(eth), "0xanyone", 999_999_999); // far past the window: no snipe tax
    const f = curveBuyQuote(info, eth, info.feeBps + info.creatorTaxBps);
    close(toTokens(q.tokensOut), f.tokensOut, 1e-6);
  }
  const bought = c.buy(ethToWei(0.2), 0n, "0xdev", 0);
  const info2 = c.info();
  const s = c.quoteSell(bought.tokensOut); const fs = curveSellQuote(info2, toTokens(bought.tokensOut), info2.feeBps + info2.creatorTaxBps);
  close(toEth(s.quoteOut), fs.quoteOut, 1e-6);
});

test("T1: getAmountOut / getAmountIn revert where the library does", () => {
  assert.throws(() => amountOut(0n, 1n, 1n), /InsufficientInputAmount/);
  assert.throws(() => amountOut(1n, 0n, 1n), /InsufficientLiquidity/);
  assert.throws(() => amountIn(5n, 1n, 5n), /InsufficientLiquidity/);
  const out = amountOut(WAD, 3n * WAD, 1_000_000_000n * WAD, 0n); assert.ok(out > 0n);
  assert.ok(amountIn(out, 3n * WAD, 1_000_000_000n * WAD, 0n) >= WAD);
});

test("T1: fees leave the quote leg on both sides and the reserves move by exactly the trade", () => {
  const c = new CurveModel({ creatorTaxBps: 200n }, { deployer: "0xdev" });
  const { quoteReserve: q0, tokenReserve: t0 } = c.getReserves();
  const b = c.buy(ethToWei(0.1), 0n, "0xdev", 0);
  assert.equal(b.fee, ethToWei(0.1) / 100n); assert.equal(b.tax, ethToWei(0.1) * 2n / 100n);
  const { quoteReserve: q1, tokenReserve: t1 } = c.getReserves();
  assert.equal(q1 - q0, b.quoteIn - b.fee - b.tax); assert.equal(t0 - t1, b.tokensOut);
  const s = c.sell(b.tokensOut, 0n, "0xdev");
  assert.equal(s.fee, (s.quoteOut + s.fee + s.tax) / 100n);
  assert.ok(toEth(s.quoteOut) < 0.1 && toEth(s.quoteOut) > 0.09, "round trip loses only the fees");
});

test("T1: the last buy is clamped to the sellable allocation, refunded, and graduates the curve; sells are then refused", () => {
  const c = new CurveModel({}, { deployer: "0xdev" });
  let n = 0; let last;
  while (!c.graduated) { last = c.buy(ethToWei(1), 0n, "0xbig" + n, 10_000_000); n++; }
  assert.ok(last.refund > 0n, "the crossing buy was refunded the excess");
  assert.equal(c.sellableTokens(), 0n); assert.equal(c.trackedTokens, c.reservedTokens);
  close(toEth(c.sweptQuote), toEth(DEFAULT_ECONOMICS.graduationThreshold), 0.02);
  assert.throws(() => c.sell(1n, 0n, "0xbig0"), /CurveGraduated/);
  assert.throws(() => c.buy(ethToWei(0.1), 0n, "0xbig0", 0), /CurveGraduated/);
  assert.equal(c.progress(), 1);
});

test("T1: minTokensOut is a price bound on a partial fill and a quantity bound otherwise", () => {
  const c = new CurveModel({}, { deployer: "0xdev" });
  const q = c.quoteBuy(ethToWei(0.1), "0xdev", 0);
  assert.throws(() => c.buy(ethToWei(0.1), q.tokensOut + 1n, "0xdev", 0), /SlippageExceeded/);
  c.buy(ethToWei(0.1), q.tokensOut, "0xdev", 0);
});

test("T1: the opening tax spares the deployer and the declared wallets, taxes everyone else, decays to zero", () => {
  const fleet = ["0xf1", "0xf2"];
  const c = new CurveModel({}, { deployer: "0xdev", launchedAtMs: 0, exemptions: fleet });
  assert.equal(c.snipeTaxBpsFor("0xdev", 0), 0n); assert.equal(c.snipeTaxBpsFor("0xF1", 0), 0n);
  assert.equal(c.snipeTaxBpsFor("0xsniper", 0), 9900n);
  assert.ok(c.snipeTaxBpsFor("0xsniper", 7500) < 9900n && c.snipeTaxBpsFor("0xsniper", 7500) > 0n);
  assert.equal(c.snipeTaxBpsFor("0xsniper", 15_000), 0n);
  const ours = c.quoteBuy(ethToWei(0.1), "0xf1", 1000), theirs = c.quoteBuy(ethToWei(0.1), "0xsniper", 1000);
  assert.ok(ours.tokensOut > theirs.tokensOut * 5n, "an undeclared buy one second in gets a fraction of the tokens");
  assert.equal(theirs.snipe, ethToWei(0.1) * theirs.snipeBps / 10_000n);
  assert.equal(snipeTaxBpsAt(9900n, 15, 15), 0n);
  assert.throws(() => new CurveModel({}, { deployer: "0xdev", exemptions: Array.from({ length: MAX_SNIPE_TAX_EXEMPTIONS + 1 }, (_, i) => "0x" + i) }), /ExemptionListTooLong/);
});

test("T1: economics that cannot graduate are refused at construction", () => {
  assert.throws(() => new CurveModel({ phantomQuote: 1n, graduationThreshold: 10n ** 30n }, { deployer: "0xdev" }), /InvalidLaunchEconomics|CurveError/);
  assert.throws(() => new CurveModel({ curveFeeBps: 1500n, creatorTaxBps: 600n }, { deployer: "0xdev" }), /InvalidFeePolicy/);
});
