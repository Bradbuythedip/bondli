// T42: the launchpad's money path, executed.
//
// launch/robinhood/contracts/FleetTestLaunchpad.sol is the contract bondli's own launchpad on Ink
// will be built from: a constant-product curve with a phantom quote reserve, quote-denominated fees,
// a creator tax, a quadratically-decaying snipe tax, a clamped final buy, and graduation when the
// sellable supply runs out. Until now its only test needed a node listening on port 8545 and skipped
// itself when there was not one, which means the contract that will hold other people's ETH had no
// test that ran on a commit. This runs the EVM in the test process instead (tests/helpers/evm.mjs),
// so there is nothing to start and nothing to remember.
//
// What is asserted here is arithmetic and solvency, because those are what lose money. The formulas
// are recomputed in JavaScript from the same inputs rather than pinned as magic constants: a
// hard-coded expected value proves the contract still does what it did, not that what it does is
// right.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Evm, loadArtifact } from "../helpers/evm.mjs";

const ART = loadArtifact("/home/user/bondli/launch/robinhood/contracts/FleetTestLaunchpad.json");
const E = 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000";
const B32 = "0x" + "00".repeat(32);
const LAUNCH_SIG = "launchToken((string,string,string,string,(string,string,string,string,string),address,uint16,bool,bytes32,bytes32),uint256,address)";

// One billion tokens, a one-ETH phantom reserve and a four-ETH raise: the curve opens at a price of
// 1 ETH per billion and graduates when four real ETH are in.
const SUPPLY = 1_000_000_000n * E, PHANTOM = 1n * E, GRADUATION = 4n * E, FEE_BPS = 100n, BPS = 10_000n;

const params = (over = {}) => ([
  over.name ?? "Jeff", over.symbol ?? "JEFF", "", "",
  ["", "", "", "", ""],
  over.feeRecipient ?? ZERO, over.creatorTaxBps ?? 0, false, over.expectedEconomics ?? B32, B32,
]);

/** A launchpad with one config, one launched token, and the actors around it. */
async function rig({ creatorTaxBps = 0, launchFee = 0n } = {}) {
  const evm = await Evm.create();
  const dev = await evm.account("dev"), buyer = await evm.account("buyer"), other = await evm.account("other");
  const pad = await evm.deploy(ART, "FleetTestLaunchpad", [launchFee, SUPPLY, FEE_BPS, PHANTOM, GRADUATION], { from: dev });
  const r = await evm.send(pad, LAUNCH_SIG, [params({ creatorTaxBps }), 0n, ZERO], { from: dev, value: launchFee });
  assert.ok(r.ok, `launch reverted: ${r.error}`);
  const ev = Evm.log(r.logs, "TokenLaunched");
  assert.ok(ev, "the launch emits TokenLaunched, which is how bondli's feed discovers a token");
  const curve = evm.attach(ev.args.curve, ART, "FleetTestCurve");
  const token = evm.attach(ev.args.token, ART, "FleetTestToken");
  return { evm, dev, buyer, other, pad, curve, token };
}

/** The books, as the contract reports them. */
async function books(evm, curve) {
  const [quoteReserve, tokenReserve] = await evm.call(curve, "getReserves");
  return {
    quoteReserve, tokenReserve,
    tracked: await evm.call(curve, "trackedQuote"),
    real: await evm.call(curve, "realQuoteReserve"),
    fee: await evm.call(curve, "quoteFeeBalance"),
    tax: await evm.call(curve, "creatorTaxBalance"),
    sellable: await evm.call(curve, "sellableTokens"),
    graduated: await evm.call(curve, "graduated"),
    owed: await evm.call(curve, "totalOwed"),
    balance: await evm.balance(curve),
  };
}

/** The invariant everything else rests on: the curve can always pay what it says it owes. Assert it
 *  after every state change, because a curve that is one wei short cannot be sold into. */
function solvent(b, where) {
  // totalOwed is money the curve accepted and could not push out. It is still the curve's to hold
  // and still somebody else's to claim, so it belongs on the same side of the ledger as the fees.
  const debt = b.real + b.fee + b.tax + b.owed;
  assert.ok(b.balance >= debt, `${where}: balance ${b.balance} < owed ${debt}`);
  assert.equal(b.real, b.tracked - b.fee - b.tax, `${where}: realQuoteReserve is trackedQuote less what is owed out`);
  assert.equal(b.quoteReserve, PHANTOM + b.tracked - b.fee - b.tax, `${where}: the priced reserve includes the phantom and excludes the fees`);
}

test("T42: a launch splits the supply exactly as the economics say", async () => {
  const { evm, curve, token } = await rig();
  const b = await books(evm, curve);
  // reserved = supply * phantom / (phantom + graduation). With 1 and 4, a fifth is held back: that
  // fifth is what the pool is seeded with at graduation, and it is why the curve can never be
  // drained to nothing.
  const reserved = (SUPPLY * PHANTOM) / (PHANTOM + GRADUATION);
  assert.equal(await evm.call(curve, "reservedTokens"), reserved);
  assert.equal(reserved, SUPPLY / 5n);
  assert.equal(b.sellable, SUPPLY - reserved);
  assert.equal(b.tokenReserve, SUPPLY, "the whole supply sits in the curve; the reserve is what is PRICED");
  assert.equal(b.quoteReserve, PHANTOM, "and the opening quote reserve is the phantom, with nothing raised");
  assert.equal(await evm.call(token, "balanceOf", [curve.toString()]), SUPPLY);
  assert.equal(await evm.call(curve, "isNativeQuote"), true);
  solvent(b, "at launch");
});

test("T42: a buy moves the constant product, and the fee is taken from the quote", async () => {
  const { evm, curve, token, buyer } = await rig();
  evm.warp(60);                                   // past the snipe window, so this is the plain case
  assert.equal(await evm.call(curve, "snipeTaxBps", [buyer.toString()]), 0n);
  const before = await books(evm, curve);

  const IN = 1n * E;
  const r = await evm.send(curve, "buy", [IN, 0n, buyer.toString()], { from: buyer, value: IN });
  assert.ok(r.ok, `buy reverted: ${r.error}`);

  // x*y=k on the net amount, with the fee skimmed in quote first. Recomputed here rather than pinned.
  const fee = (IN * FEE_BPS) / BPS;
  const net = IN - fee;
  const expected = (net * before.tokenReserve) / (before.quoteReserve + net);
  assert.equal(await evm.call(token, "balanceOf", [buyer.toString()]), expected);
  const ev = Evm.log(r.logs, "CurveBuy");
  assert.ok(ev && ev.args.tokensOut === expected && ev.args.fee === fee, "and the log says the same");

  const b = await books(evm, curve);
  assert.equal(b.fee, fee, "the fee is held, not paid out yet");
  assert.equal(b.tracked, IN, "every wei that came in is tracked");
  assert.equal(b.balance, IN, "and every wei is actually here");
  solvent(b, "after a buy");
});

test("T42: the snipe tax is 99% at the first instant and decays to nothing by the window's end", async () => {
  // This is the launchpad's only defence against the launch being taken by whoever is fastest, so it
  // is the mechanism most worth testing -- and it could not be tested at all until the harness could
  // move block.timestamp.
  const { evm, curve, buyer, dev } = await rig();
  const START = 9_900n, WINDOW = 15;
  assert.equal(await evm.call(curve, "snipeTaxStartBps"), START);
  assert.equal(await evm.call(curve, "snipeTaxSeconds"), BigInt(WINDOW));

  // start * (left/window)^2, in integer arithmetic, second by second across the whole window. The
  // clock only moves forward, so the expectation is computed from where it has got to.
  // ...clamped so that the levies always leave a basis point of the principal. Without the clamp the
  // curve fee pushed the total to exactly 10000 and the launch block reverted outright; with it the
  // first instant is 9899 rather than 9900, which is the same answer for every purpose except that
  // the trade is possible.
  const headroom = BPS - 1n - FEE_BPS;
  for (let elapsed = 0; elapsed <= WINDOW + 5; elapsed++) {
    const left = elapsed >= WINDOW ? 0n : BigInt(WINDOW - elapsed);
    const raw = (START * left * left) / BigInt(WINDOW * WINDOW);
    const expect = raw > headroom ? headroom : raw;
    assert.equal(await evm.call(curve, "snipeTaxBps", [buyer.toString()]), expect, `at +${elapsed}s`);
    evm.warp(1);
  }
  // Quadratic, not linear: at the halfway point a linear decay would say half and this says a
  // quarter, which is the difference between a defence and a speed bump.
  const half = await rig();
  half.evm.warp(Math.floor(WINDOW / 2));
  const atHalf = await half.evm.call(half.curve, "snipeTaxBps", [half.buyer.toString()]);
  assert.ok(atHalf < START / 2n, `halfway through, ${atHalf} bps is well under half of ${START}`);
  assert.ok(atHalf > START / 5n, "but not yet negligible");
  // The creator never pays it. That is deliberate -- they are the one launching -- but it is also
  // the whole of the exemption surface, so it is pinned.
  assert.equal(await evm.call(curve, "snipeTaxExempt", [dev.toString()]), true);
  assert.equal(await evm.call(curve, "snipeTaxExempt", [buyer.toString()]), false);
});

test("T42: on a one-second chain the snipe window is worth naming in blocks, not seconds", async () => {
  // Ink makes a block every second and the window is fifteen. A sniper in the very next block after
  // the launch pays start * (14/15)^2, which is still 86%: the defence does survive Ink's block
  // time. Worth an executable statement rather than an assumption, because the same window on a
  // twelve-second chain would be one or two blocks and worth almost nothing.
  const { evm, curve, buyer } = await rig();
  const seen = [];
  for (let block = 0; block <= 15; block++) {
    seen.push(Number(await evm.call(curve, "snipeTaxBps", [buyer.toString()])));
    evm.warp(1);
  }
  assert.equal(seen[0], 9899, "the launch block, clamped one bp short of the whole spend");
  assert.ok(seen[1] > 8600 && seen[1] < 8700, `one Ink block later it is still ${seen[1]} bps`);
  assert.ok(seen[5] > 4000, `five blocks in it is still ${seen[5]} bps`);
  assert.equal(seen[15], 0, "and it is gone at the window's end");
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] < seen[i - 1], "it only ever falls");
});

test("T42: selling returns quote, pays the fee, and cannot drain more than is really there", async () => {
  const { evm, curve, token, buyer } = await rig();
  evm.warp(60);
  const IN = 1n * E;
  assert.ok((await evm.send(curve, "buy", [IN, 0n, buyer.toString()], { from: buyer, value: IN })).ok);
  const held = await evm.call(token, "balanceOf", [buyer.toString()]);

  assert.ok((await evm.send(token, "approve", [curve.toString(), held], { from: buyer })).ok);
  const before = await books(evm, curve);
  const ethBefore = await evm.balance(buyer);
  const r = await evm.send(curve, "sell", [held, 0n, buyer.toString()], { from: buyer });
  assert.ok(r.ok, `sell reverted: ${r.error}`);

  const gross = (held * before.quoteReserve) / (before.tokenReserve + held);
  const fee = (gross * FEE_BPS) / BPS;
  const ev = Evm.log(r.logs, "CurveSell");
  assert.equal(ev.args.quoteOut, gross - fee);
  assert.equal(await evm.balance(buyer), ethBefore + gross - fee);
  // A full round trip inside one curve loses exactly the two fees, and the seller can never get back
  // more than was put in: that is the property that stops a curve being a free money machine.
  assert.ok(gross - fee < IN, "a round trip costs the fee, both ways");
  solvent(await books(evm, curve), "after a sell");
});

test("T42: the curve fills, clamps the last buy, refunds the difference and graduates", async () => {
  const { evm, curve, token, pad, buyer } = await rig();
  evm.warp(60);
  // Buy past the raise in one go. The last buy can only take the sellable tokens that remain, so the
  // contract works out what that costs, spends only that, and hands the rest back.
  const OVER = 20n * E;
  const before = await evm.balance(buyer);
  const r = await evm.send(curve, "buy", [OVER, 0n, buyer.toString()], { from: buyer, value: OVER });
  assert.ok(r.ok, `buy reverted: ${r.error}`);

  const refund = Evm.log(r.logs, "CurveBuyRefunded");
  assert.ok(refund, "the overpayment comes back, and says so");
  const spent = Evm.log(r.logs, "CurveBuy").args.quoteIn;
  assert.equal(spent + refund.args.refund, OVER, "spent plus refunded is what was sent");
  assert.ok(spent < OVER, "and the curve took only what it could fill");
  assert.equal(await evm.balance(buyer), before - spent, "the buyer is out exactly what was spent");

  const b = await books(evm, curve);
  assert.equal(b.sellable, 0n, "there is nothing left to sell");
  assert.equal(b.graduated, true);
  assert.equal(await evm.call(curve, "readyToGraduate"), false, "graduated, so no longer merely ready");
  // Graduation hands everything to the factory and tells it so. On Ink that hand-off is where a v4
  // pool gets seeded; here it is the factory's balance, which is what the test double does.
  assert.ok(Evm.log(r.logs, "CurveCompleted"), "the curve says it is done");
  assert.ok(Evm.log(r.logs, "PoolGraduated"), "and the factory records it");
  assert.equal(await evm.call(token, "balanceOf", [curve.toString()]), 0n, "the curve keeps no tokens");
  assert.ok((await evm.balance(pad)) > 0n, "the raise is at the factory");
  // The curve keeps exactly the fees it has not paid out. They stay parked on purpose: getReserves
  // already nets them out so the price does not move, and paying them here is what used to put a
  // stranger's fallback on the graduation path.
  const after = await books(evm, curve);
  assert.equal(await evm.balance(curve), after.fee + after.tax);
  solvent(after, "after graduating");
  // The reserved supply is NOT handed over whole any more -- only what the raise can back.
  const seeded = Evm.log(r.logs, "CurveCompleted").args.tokenOut;
  assert.equal(await evm.call(token, "balanceOf", [pad.toString()]), seeded);
  assert.ok(seeded < SUPPLY / 5n, "less than the reserved fifth");
  assert.equal(await evm.call(token, "balanceOf", ["0x000000000000000000000000000000000000dEaD"]), SUPPLY / 5n - seeded, "and the rest is burnt");
  assert.equal((await evm.call(pad, "getLaunchedToken", [(await evm.call(curve, "token")).toString()])).graduated, true);
});

test("T42: a graduated curve is closed to both sides", async () => {
  const { evm, curve, token, buyer, other } = await rig();
  evm.warp(60);
  assert.ok((await evm.send(curve, "buy", [20n * E, 0n, buyer.toString()], { from: buyer, value: 20n * E })).ok);
  assert.equal(await evm.call(curve, "graduated"), true);

  // Buying is refused by name, not by a generic failure: bondli's router reads the reason.
  const buyAgain = await evm.send(curve, "buy", [1n * E, 0n, other.toString()], { from: other, value: 1n * E });
  assert.equal(buyAgain.ok, false);
  assert.match(buyAgain.error, /CurveGraduated/);
  // And so is selling back into it. The holder's exit is the pool now, which is the whole point of
  // graduating -- but it does mean the curve must have actually seeded one, or the holder is stuck.
  const held = await evm.call(token, "balanceOf", [buyer.toString()]);
  assert.ok((await evm.send(token, "approve", [curve.toString(), held], { from: buyer })).ok);
  const sell = await evm.send(curve, "sell", [held, 0n, buyer.toString()], { from: buyer });
  assert.equal(sell.ok, false);
  assert.match(sell.error, /CurveGraduated/);
});

test("T42: the books balance across a whole session", async () => {
  // Launch, several buys at different sizes, a partial sell, a fee sweep, and the solvency invariant
  // checked after every one of them. This is the test that would catch an accounting change that
  // looks right in isolation and leaves the curve a few wei short of what it owes.
  const { evm, curve, token, dev, buyer, other } = await rig({ creatorTaxBps: 200 });
  evm.warp(60);
  solvent(await books(evm, curve), "start");

  for (const [who, amount] of [[buyer, 1n * E], [other, 2n * E], [buyer, 500_000_000_000_000_000n]]) {
    const r = await evm.send(curve, "buy", [amount, 0n, who.toString()], { from: who, value: amount });
    assert.ok(r.ok, `buy reverted: ${r.error}`);
    solvent(await books(evm, curve), `after a ${amount} buy`);
  }
  const held = await evm.call(token, "balanceOf", [other.toString()]);
  assert.ok((await evm.send(token, "approve", [curve.toString(), held / 2n], { from: other })).ok);
  assert.ok((await evm.send(curve, "sell", [held / 2n, 0n, other.toString()], { from: other })).ok);
  solvent(await books(evm, curve), "after a partial sell");

  // Sweeping pays the protocol fee to the factory and the creator's tax to the creator, and must
  // leave the curve able to honour every remaining token.
  const beforeDev = await evm.balance(dev);
  const owedTax = (await books(evm, curve)).tax;
  assert.ok(owedTax > 0n, "a 2% creator tax accrued something");
  assert.ok((await evm.send(curve, "sweepFees", [], { from: other })).ok, "anyone may sweep; it pays the right people");
  const after = await books(evm, curve);
  assert.equal(after.fee, 0n);
  assert.equal(after.tax, 0n);
  assert.equal(await evm.balance(dev), beforeDev + owedTax, "the creator got exactly their tax");
  solvent(after, "after a sweep");
});

test("T42: the launch block is taxed, not broken", async () => {
  // The bug this prevents, measured on the contract before the fix: with the shipped 9900 bps
  // opening tax and the 1% curve fee, the levies totalled exactly 10000 with no creator tax and more
  // than that with any. Every buy in the launch block reverted -- `ZeroAmount` at exactly 10000
  // because the net spend rounded away, and a bare `Panic(0x11)` above it from
  // `spent - fee - tax - snipe` underflowing. The clamped final buy divides by the complement of the
  // total, which was a division by zero on the same inputs.
  //
  // So the most contested second of a launch was not taxed at 99%, it was unavailable, and the first
  // trade anyone could make was one second later at 86%. A launchpad whose opening block reverts is
  // not a launchpad with a strong defence; it is a launchpad that does not work.
  for (const creatorTaxBps of [0, 1, 100, 1000]) {
    const { evm, curve, buyer } = await rig({ creatorTaxBps });
    const snipe = await evm.call(curve, "snipeTaxBps", [buyer.toString()]);
    const total = FEE_BPS + BigInt(creatorTaxBps) + snipe;
    assert.equal(total, BPS - 1n, `at ${creatorTaxBps}bps creator tax the levies clamp to one bp short of everything`);
    const r = await evm.send(curve, "buy", [1n * E, 0n, buyer.toString()], { from: buyer, value: 1n * E });
    assert.ok(r.ok, `a buy in the launch block reverted with ${r.error}`);
    // Taxed to the bone, which is the point: a sniper gets a hundredth of a per cent of the spend.
    const got = Evm.log(r.logs, "CurveBuy").args.tokensOut;
    const plain = await rig({ creatorTaxBps });
    plain.evm.warp(60);
    const fair = await plain.evm.send(plain.curve, "buy", [1n * E, 0n, plain.buyer.toString()], { from: plain.buyer, value: 1n * E });
    assert.ok(got * 1000n < Evm.log(fair.logs, "CurveBuy").args.tokensOut, "the sniper gets a thousandth of what a later buyer gets");
    solvent(await books(evm, curve), `launch-block buy at ${creatorTaxBps}bps`);
  }
});

test("T42: the quoted snipe tax is the one that is charged", async () => {
  // A view that disagrees with the charge is worse than no view: it is a quote that lies. The clamp
  // lives inside snipeTaxBps so the two cannot drift apart.
  const { evm, curve, buyer } = await rig({ creatorTaxBps: 1000 });
  for (let s = 0; s <= 16; s++) {
    const quoted = await evm.call(curve, "snipeTaxBps", [buyer.toString()]);
    const IN = 10n ** 16n;
    const before = await evm.balance(curve);
    const r = await evm.send(curve, "buy", [IN, 0n, buyer.toString()], { from: buyer, value: IN });
    assert.ok(r.ok, `t=+${s}s: ${r.error}`);
    // The snipe leg is the only part of the spend that leaves the curve immediately, so what stayed
    // behind is the spend less exactly the quoted tax.
    const spent = Evm.log(r.logs, "CurveBuy").args.quoteIn;
    const expectedSnipe = (spent * quoted) / BPS;
    assert.equal(await evm.balance(curve) - before, spent - expectedSnipe, `t=+${s}s the charge matches the quote`);
    evm.warp(1);
  }
});

test("T42: a curve whose standing levies eat the whole trade cannot be built", async () => {
  // The clamp handles the time-varying tax. The two fixed levies are checked at construction, where
  // the answer is knowable, so the impossible curve never exists rather than reverting on every buy.
  const evm = await Evm.create();
  const dev = await evm.account("dev");
  const args = (fee, tax) => [dev.toString(), dev.toString(), PHANTOM, fee, tax, GRADUATION, 9_900n, 15n];
  await assert.rejects(() => evm.deploy(ART, "FleetTestCurve", args(9_000n, 1_000n), { from: dev }), /LeviesExceedPrincipal/);
  await assert.rejects(() => evm.deploy(ART, "FleetTestCurve", args(10_000n, 0n), { from: dev }), /LeviesExceedPrincipal/);
  // One basis point short is allowed, and still leaves the clamp something to work with.
  const okCurve = await evm.deploy(ART, "FleetTestCurve", args(9_000n, 999n), { from: dev });
  assert.ok(okCurve);
});

test("T42: a creator whose address rejects ETH cannot brick the launch", async () => {
  // The attack, for the price of one launch fee: nominate a creatorFeeRecipient whose receive()
  // reverts. Every payout on the graduation path used to be a push that reverted the whole
  // transaction on failure, and _graduate() called sweepFees() first, and _graduate() is the tail of
  // buy(). So the curve filled to its last token and then refused every further buy, forever, with
  // the fees stranded, every holder trapped just below the top, and no rescue anywhere in the
  // contract. An honest creator using a Safe without a payable fallback does it to themselves.
  //
  // A contract with no receive and no fallback rejects ETH, so a plain token serves as the hostile
  // recipient without needing one written for the purpose.
  const evm = await Evm.create();
  const dev = await evm.account("dev"), buyer = await evm.account("buyer");
  const refuser = await evm.deploy(ART, "FleetTestToken", ["R", "R", "", "", dev.toString(), dev.toString(), 1n], { from: dev });
  const pad = await evm.deploy(ART, "FleetTestLaunchpad", [0n, SUPPLY, FEE_BPS, PHANTOM, GRADUATION], { from: dev });
  const lr = await evm.send(pad, LAUNCH_SIG, [params({ creatorTaxBps: 200, feeRecipient: refuser.toString() }), 0n, ZERO], { from: dev });
  assert.ok(lr.ok, lr.error);
  const curve = evm.attach(Evm.log(lr.logs, "TokenLaunched").args.curve, ART, "FleetTestCurve");
  evm.warp(60);

  const r = await evm.send(curve, "buy", [20n * E, 0n, buyer.toString()], { from: buyer, value: 20n * E });
  assert.ok(r.ok, `the hostile recipient blocked graduation: ${r.error}`);
  assert.equal(await evm.call(curve, "graduated"), true, "it graduated anyway");

  // Graduation no longer pays anyone at all -- the fees stay parked -- so the hostile address is not
  // even on the path. It only comes up when somebody sweeps, and then it is a debt, not a wedge.
  const sweep = await evm.send(curve, "sweepFees", [], { from: buyer });
  assert.ok(sweep.ok, `the sweep reverted: ${sweep.error}`);
  assert.ok(Evm.log(sweep.logs, "PaymentDeferred"), "the tax they refused is recorded as owed");
  const debt = await evm.call(curve, "owed", [refuser.toString()]);
  assert.ok(debt > 0n, "and credited to them, to collect the day they can receive ETH");
  // The protocol's own fee and the raise reached the factory regardless, which is the whole point:
  // one party's broken address is no longer a lever on everybody else's money.
  assert.ok((await evm.balance(pad)) > 0n);
  assert.equal(await evm.balance(curve), debt, "the curve holds exactly what it still owes");
});

test("T42: a deferred payment can be claimed, once", async () => {
  const evm = await Evm.create();
  const dev = await evm.account("dev"), buyer = await evm.account("buyer"), other = await evm.account("other");
  // A curve whose factory is an address that cannot take ETH, so the protocol fee defers and there
  // is a debt to collect without needing a hostile creator.
  const refuser = await evm.deploy(ART, "FleetTestToken", ["R", "R", "", "", dev.toString(), dev.toString(), 1n], { from: dev });
  const curve = await evm.deploy(ART, "FleetTestCurve", [dev.toString(), dev.toString(), PHANTOM, FEE_BPS, 0n, GRADUATION, 0n, 15n], { from: refuser });
  const token = await evm.deploy(ART, "FleetTestToken", ["T", "T", "", "", dev.toString(), curve.toString(), SUPPLY], { from: dev });
  assert.ok((await evm.send(curve, "initialize", [token.toString()], { from: refuser })).ok);

  assert.ok((await evm.send(curve, "buy", [1n * E, 0n, buyer.toString()], { from: buyer, value: 1n * E })).ok);
  assert.ok((await evm.send(curve, "sweepFees", [], { from: other })).ok);
  const debt = await evm.call(curve, "owed", [refuser.toString()]);
  assert.ok(debt > 0n, "the factory could not take its fee, so it is owed it");
  assert.equal(await evm.call(curve, "totalOwed"), debt);

  // Nobody else can take it, and the owner of the debt cannot take it twice.
  const stranger = await evm.send(curve, "claim", [], { from: other });
  assert.equal(stranger.ok, false);
  assert.match(stranger.error, /NothingOwed/);
  // The refuser still cannot receive ETH, so its own claim reverts and the debt survives intact --
  // a failed claim must not burn the credit.
  const failed = await evm.send(curve, "claim", [], { from: refuser });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /TransferFailed/);
  assert.equal(await evm.call(curve, "owed", [refuser.toString()]), debt, "the debt is intact after a failed claim");
  solvent(await books(evm, curve), "with a debt outstanding");
});

test("T42: minTokensOut is a floor on tokens, not on the rate", async () => {
  // Measured on this contract before the change: a buyer asking for at least 49,773,503 tokens
  // received 1,889,169 -- 3.80% of what they demanded -- and the transaction succeeded, because the
  // old check compared ratios (spent*min against quoteIn*out) and the clamped final buy always
  // satisfies that: it spends proportionally less for what little is left. The price was fine. The
  // quantity was not, and minTokensOut is a quantity.
  const { evm, curve, buyer, other } = await rig();
  evm.warp(60);
  // Fill the curve to nearly nothing so the next buy clamps hard.
  // Just short of the four-ETH raise, so a sliver of sellable supply remains and the next buy clamps.
  assert.ok((await evm.send(curve, "buy", [3_950_000_000_000_000_000n, 0n, other.toString()], { from: other, value: 3_950_000_000_000_000_000n })).ok);
  const left = await evm.call(curve, "sellableTokens");
  assert.ok(left > 0n && left < SUPPLY / 50n, `a sliver is left: ${left}`);

  // Ask for far more than remains. It must refuse rather than fill 3.8% of the order.
  const greedy = await evm.send(curve, "buy", [5n * E, left * 100n, buyer.toString()], { from: buyer, value: 5n * E });
  assert.equal(greedy.ok, false, "a fill far under the floor is refused");
  assert.match(greedy.error, /SlippageExceeded/);
  // The error now carries the two quantities being compared, which it could not meaningfully do
  // when the comparison was a ratio.
  assert.match(greedy.error, new RegExp(String(left)));

  // Asking for what is actually there succeeds, and so does asking for nothing in particular --
  // which is how the curve still gets graduated by anyone who wants whatever remains.
  const honest = await evm.send(curve, "buy", [5n * E, left, buyer.toString()], { from: buyer, value: 5n * E });
  assert.ok(honest.ok, `an accurate floor is accepted: ${honest.error}`);
  assert.equal(await evm.call(curve, "graduated"), true);
});

test("T42: a launcher's change comes back to the launcher", async () => {
  // launchAndBuy forwards the opening buy to the curve, so inside buy() the msg.sender was the
  // launchpad. The clamped final buy refunds to msg.sender -- so a launcher who overpaid sent their
  // change into the launchpad's balance, where the only way out was an owner withdrawal, and
  // CurveBuyRefunded named the launchpad so nobody could even attribute it.
  const evm = await Evm.create();
  const dev = await evm.account("dev");
  const FEE = 10n ** 15n;
  const pad = await evm.deploy(ART, "FleetTestLaunchpad", [FEE, SUPPLY, FEE_BPS, PHANTOM, GRADUATION], { from: dev });
  const SIG = "launchAndBuy((string,string,string,string,(string,string,string,string,string),address,uint16,bool,bytes32,bytes32),uint256,address,uint256,uint256,address,address[])";
  const IN = 40n * E;                        // far more than the curve can absorb
  const before = await evm.balance(dev);
  const r = await evm.send(pad, SIG, [params(), 0n, ZERO, IN, 0n, ZERO, []], { from: dev, value: FEE + IN });
  assert.ok(r.ok, r.error);

  const refunded = Evm.log(r.logs, "CurveBuyRefunded");
  assert.ok(refunded, "the curve clamped and refunded");
  assert.equal(refunded.args.buyer.toLowerCase(), dev.toString().toLowerCase(), "to the launcher, not the launchpad");
  const spent = Evm.log(r.logs, "CurveBuy").args.quoteIn;
  assert.equal(await evm.balance(dev), before - FEE - spent, "the launcher is out the fee and what was actually spent");
  // And the launchpad holds only what it is meant to: the fee and the raise, never the change.
  // The pad holds its launch fee plus the raise. The raise is the spend less the levies, which stay
  // parked in the curve until someone sweeps them.
  const levies = Evm.log(r.logs, "CurveBuy").args.fee + Evm.log(r.logs, "CurveBuy").args.tax;
  assert.equal(await evm.balance(pad), FEE + spent - levies, "its fee and the raise, and no change that is not its own");
});

test("T42: an overpaid launch fee is change, not revenue", async () => {
  const evm = await Evm.create();
  const dev = await evm.account("dev");
  const FEE = 10n ** 15n;
  const pad = await evm.deploy(ART, "FleetTestLaunchpad", [FEE, SUPPLY, FEE_BPS, PHANTOM, GRADUATION], { from: dev });
  const before = await evm.balance(dev);
  const r = await evm.send(pad, LAUNCH_SIG, [params(), 0n, ZERO], { from: dev, value: FEE * 10n });
  assert.ok(r.ok, r.error);
  assert.equal(await evm.balance(dev), before - FEE, "nine tenths of it came straight back");
  assert.equal(await evm.balance(pad), FEE, "and the pad kept only its price");
  // The check stays `<` rather than `!=` on purpose: a fee raised between quoting and mining should
  // not fail an honest launch, it should just cost what it now costs.
  const short = await evm.send(pad, LAUNCH_SIG, [params(), 0n, ZERO], { from: dev, value: FEE - 1n });
  assert.equal(short.ok, false);
  assert.match(short.error, /LaunchFeeNotPaid/);
});

test("T42: the opening tax is announced, so a reader can see what the curve kept", async () => {
  // CurveBuy reports the gross spend, the fee and the creator tax -- but not the opening tax, which
  // is forwarded to the launchpad the instant it is charged. Anyone tracking the curve's real
  // reserve from logs therefore credited it with money it never kept. bondli's own PONS feed did
  // exactly that (feed.mjs: `quote - fee - tax`), and on a one-second-old launch, where the tax is
  // 8624 bps, it over-credited by 7.76x.
  //
  // The tax gets its own event rather than a field on CurveBuy, because CurveBuy's signature is the
  // one bondli indexes by topic across two venues and PONS does not emit this at all.
  const { evm, curve, buyer } = await rig();
  evm.warp(1);                                   // one Ink block after the launch
  const before = await evm.balance(curve);
  const IN = 1n * E;
  const r = await evm.send(curve, "buy", [IN, 0n, buyer.toString()], { from: buyer, value: IN });
  assert.ok(r.ok, r.error);

  const charged = Evm.log(r.logs, "SnipeTaxCharged");
  assert.ok(charged, "the tax is on the record");
  assert.equal(charged.args.buyer.toLowerCase(), buyer.toString().toLowerCase());

  // The three numbers now reconcile: what the curve kept is the spend less every levy that left it.
  const cb = Evm.log(r.logs, "CurveBuy").args;
  const kept = await evm.balance(curve) - before;
  assert.equal(kept, cb.quoteIn - charged.args.amount, "kept = spend less the tax that was forwarded");
  // And the size of the error it prevents: reading CurveBuy alone says the curve took nearly all of
  // it, when it took a fraction.
  const naive = cb.quoteIn - cb.fee - cb.tax;
  assert.ok(naive > kept * 5n, `reading CurveBuy alone overstates the reserve by ${Number(naive) / Number(kept)}x`);
});

test("T42: the owner cannot turn a launch into a permanent toll booth", async () => {
  const evm = await Evm.create();
  const dev = await evm.account("dev");
  const pad = await evm.deploy(ART, "FleetTestLaunchpad", [0n, SUPPLY, FEE_BPS, PHANTOM, GRADUATION], { from: dev });
  assert.equal(await evm.call(pad, "MAX_SNIPE_TAX_SECONDS"), 60n);

  // An unbounded window is the toll booth: every buyer of every future launch pays, forever.
  const forever = await evm.send(pad, "setSnipeTax", [9_000n, 86_400n], { from: dev });
  assert.equal(forever.ok, false);
  assert.match(forever.error, /SnipeTaxOutOfRange/);
  const everything = await evm.send(pad, "setSnipeTax", [10_000n, 15n], { from: dev });
  assert.equal(everything.ok, false);
  assert.match(everything.error, /SnipeTaxOutOfRange/);

  const fine = await evm.send(pad, "setSnipeTax", [8_000n, 60n], { from: dev });
  assert.ok(fine.ok, fine.error);
  assert.ok(Evm.log(fine.logs, "SnipeTaxUpdated"), "and a change to everyone's terms is announced");
});

test("T42: pinned economics cover the terms the owner can move", async () => {
  // expectedEconomics used to hash the curve's shape and four uint16(0) placeholders, so it covered
  // none of the three things the owner can actually change. A launcher could pin their economics,
  // have the owner raise the opening tax in the same block, and launch anyway with the pin
  // satisfied and the terms different.
  const evm = await Evm.create();
  const dev = await evm.account("dev");
  const pad = await evm.deploy(ART, "FleetTestLaunchpad", [0n, SUPPLY, FEE_BPS, PHANTOM, GRADUATION], { from: dev });
  const pinned = await evm.call(pad, "previewLaunchEconomics", [0n, ZERO]);

  // Moving the opening tax moves the hash, which is the whole point.
  assert.ok((await evm.send(pad, "setSnipeTax", [5_000n, 10n], { from: dev })).ok);
  assert.notEqual(await evm.call(pad, "previewLaunchEconomics", [0n, ZERO]), pinned, "the tax is covered");
  // So does the launch fee.
  assert.ok((await evm.send(pad, "setLaunchFee", [10n ** 15n], { from: dev })).ok);
  const moved = await evm.call(pad, "previewLaunchEconomics", [0n, ZERO]);

  // A launch pinned to the old terms is refused; pinned to the new ones it goes through.
  const stale = await evm.send(pad, LAUNCH_SIG, [params({ expectedEconomics: pinned }), 0n, ZERO], { from: dev, value: 10n ** 15n });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /LaunchEconomicsMismatch/);
  const fresh = await evm.send(pad, LAUNCH_SIG, [params({ expectedEconomics: moved }), 0n, ZERO], { from: dev, value: 10n ** 15n });
  assert.ok(fresh.ok, fresh.error);
});

test("T42: the pool opens at the price the curve closed at", async () => {
  // The curve's last price is its priced reserve over its token reserve, and the priced reserve
  // includes the phantom quote -- money nobody deposited and which cannot be handed to a pool. So
  // seeding with everything left, the whole raise against the whole reserved supply, opens at
  // raise/reserved when the curve closed at (phantom+raise)/reserved.
  //
  // That ratio is raise/(phantom+raise). Measured here at P=1,G=4 it is a 20% gap; at the shipped
  // P=3,G=6 it is 33.3%. Either way it lands on every holder at the moment the interface
  // congratulates them -- and bondli's own dip read would see that manufactured gap as a token that
  // ran and gave some back, and buy it.
  const { evm, curve, token, pad, buyer, other } = await rig();
  evm.warp(60);
  assert.ok((await evm.send(curve, "buy", [2n * E, 0n, other.toString()], { from: other, value: 2n * E })).ok);
  // The closing price, read one instant before the buy that ends the curve.
  const [qrBefore, trBefore] = await evm.call(curve, "getReserves");
  const r = await evm.send(curve, "buy", [20n * E, 0n, buyer.toString()], { from: buyer, value: 20n * E });
  assert.ok(r.ok, r.error);

  const done = Evm.log(r.logs, "CurveCompleted").args;
  const raise = done.quoteOut, seeded = done.tokenOut;
  assert.ok(raise > 0n && seeded > 0n);

  // The pool's opening price is raise/seeded. The curve's closing price is the priced reserve over
  // the token reserve at the moment the last token left. Compare as a cross-product so there is no
  // floating point in the assertion, and allow the one unit integer division can cost.
  const [qrEnd] = await evm.call(curve, "getReserves");
  const tokensAtClose = SUPPLY / 5n;                     // the reserved supply, which is what was left
  const lhs = raise * tokensAtClose, rhs = seeded * (qrEnd + raise);
  const off = lhs > rhs ? lhs - rhs : rhs - lhs;
  assert.ok(off <= tokensAtClose, `the pool opens at the curve's closing price (off by ${off} of ${lhs})`);

  // And the untrimmed alternative is the bug: had the whole reserved supply been seeded, the pool
  // would have opened well below.
  const naivePriceNum = raise, naivePriceDen = tokensAtClose;
  const realPriceNum = raise, realPriceDen = seeded;
  assert.ok(realPriceDen < naivePriceDen, "the trim is what closes the gap");
  const gapPct = Number(100n - (seeded * 100n) / tokensAtClose);
  assert.ok(gapPct >= 15 && gapPct <= 25, `the gap that was avoided is ${gapPct}% at these economics`);

  // Nothing is kept: what is not seeded is burnt, and the two add back to the reserved supply.
  const burnt = await evm.call(token, "balanceOf", ["0x000000000000000000000000000000000000dEaD"]);
  assert.equal(seeded + burnt, tokensAtClose);
  assert.equal(Evm.log(r.logs, "TokensBurned").args.amount, burnt);
  assert.ok(qrBefore > 0n && trBefore > 0n);
  assert.equal(await evm.call(pad, "raiseOf", [token.toString()]), raise, "and the raise is escrowed against its token");
});

test("T42: the owner cannot withdraw a raise, only the protocol's own revenue", async () => {
  // withdraw() used to send address(this).balance, and every graduated raise is paid into that
  // balance. Forty graduations at six ETH is two hundred and forty ETH of other people's money one
  // owner call from gone, with no event and nothing a holder could see coming.
  const evm = await Evm.create();
  const dev = await evm.account("dev"), buyer = await evm.account("buyer"), sink = await evm.account("sink");
  const FEE = 10n ** 15n;
  const pad = await evm.deploy(ART, "FleetTestLaunchpad", [FEE, SUPPLY, FEE_BPS, PHANTOM, GRADUATION], { from: dev });
  const lr = await evm.send(pad, LAUNCH_SIG, [params(), 0n, ZERO], { from: dev, value: FEE });
  const curve = evm.attach(Evm.log(lr.logs, "TokenLaunched").args.curve, ART, "FleetTestCurve");
  const tokenAddr = Evm.log(lr.logs, "TokenLaunched").args.token;
  evm.warp(60);
  const r = await evm.send(curve, "buy", [20n * E, 0n, buyer.toString()], { from: buyer, value: 20n * E });
  assert.ok(r.ok, r.error);

  const raise = await evm.call(pad, "raiseOf", [tokenAddr]);
  assert.ok(raise > 0n);
  assert.equal(await evm.call(pad, "totalEscrowed"), raise);

  const sinkBefore = await evm.balance(sink);
  assert.ok((await evm.send(pad, "withdraw", [sink.toString()], { from: dev })).ok);
  assert.equal(await evm.balance(sink) - sinkBefore, FEE, "the owner got the launch fee and not one wei more");
  assert.equal(await evm.balance(pad), raise, "the raise is untouched");

  // It moves only to a seeder, only once, and only the owner can name one.
  assert.match((await evm.send(pad, "releaseRaise", [tokenAddr], { from: dev })).error, /NotSeeder/);
  assert.match((await evm.send(pad, "setSeeder", [sink.toString()], { from: buyer })).error, /NotOwner/);
  assert.ok((await evm.send(pad, "setSeeder", [sink.toString()], { from: dev })).ok);
  const rel = await evm.send(pad, "releaseRaise", [tokenAddr], { from: sink });
  assert.ok(rel.ok, rel.error);
  assert.equal(await evm.call(pad, "totalEscrowed"), 0n);
  assert.equal(await evm.balance(pad), 0n, "the pad is empty; the raise and the seed supply went to the seeder");
  // The seed supply went with it: the reserved tokens used to be sent to a contract with no way to
  // move an ERC-20 at all, so no pool could be seeded even in good faith.
  const token = evm.attach(tokenAddr, ART, "FleetTestToken");
  assert.ok((await evm.call(token, "balanceOf", [sink.toString()])) > 0n);
  assert.match((await evm.send(pad, "releaseRaise", [tokenAddr], { from: sink })).error, /NothingEscrowed/, "and only once");
});

test("T42: ownership moves in two steps", async () => {
  const evm = await Evm.create();
  const dev = await evm.account("dev"), safe = await evm.account("safe"), other = await evm.account("other");
  const pad = await evm.deploy(ART, "FleetTestLaunchpad", [0n, SUPPLY, FEE_BPS, PHANTOM, GRADUATION], { from: dev });
  assert.ok((await evm.send(pad, "transferOwnership", [safe.toString()], { from: dev })).ok);
  assert.equal(await evm.call(pad, "owner"), dev.toString(), "nothing moves until it is accepted");
  assert.match((await evm.send(pad, "acceptOwnership", [], { from: other })).error, /NotPendingOwner/);
  const done = await evm.send(pad, "acceptOwnership", [], { from: safe });
  assert.ok(done.ok, done.error);
  assert.equal(await evm.call(pad, "owner"), safe.toString());
  assert.equal(await evm.call(pad, "pendingOwner"), "0x0000000000000000000000000000000000000000");
  assert.match((await evm.send(pad, "setLaunchFee", [1n], { from: dev })).error, /NotOwner/, "the old key is done");
});

test("T42: the launcher and their payee are two different identities", async () => {
  // The curve's public `deployer` was set to the creator's chosen fee recipient. That is a different
  // address whenever a creator nominates one, so the identity a rug model follows across launches
  // was silently replaced by a payout destination -- and it disagreed with the factory's own
  // LaunchedToken.deployer for the very same token.
  const evm = await Evm.create();
  const dev = await evm.account("dev"), payee = await evm.account("payee"), buyer = await evm.account("buyer");
  const pad = await evm.deploy(ART, "FleetTestLaunchpad", [0n, SUPPLY, FEE_BPS, PHANTOM, GRADUATION], { from: dev });
  const lr = await evm.send(pad, LAUNCH_SIG, [params({ creatorTaxBps: 300, feeRecipient: payee.toString() }), 0n, ZERO], { from: dev });
  assert.ok(lr.ok, lr.error);
  const ev = Evm.log(lr.logs, "TokenLaunched");
  const curve = evm.attach(ev.args.curve, ART, "FleetTestCurve");

  assert.equal((await evm.call(curve, "deployer")).toLowerCase(), dev.toString().toLowerCase(), "the launcher");
  assert.equal((await evm.call(curve, "feeRecipient")).toLowerCase(), payee.toString().toLowerCase(), "and their payee");
  // The two records agree about who launched it, which is the point.
  assert.equal((await evm.call(pad, "getLaunchedToken", [ev.args.token])).deployer.toLowerCase(), dev.toString().toLowerCase());
  // Both are exempt from the opening tax, and the tax still goes to the payee.
  assert.equal(await evm.call(curve, "snipeTaxExempt", [dev.toString()]), true);
  assert.equal(await evm.call(curve, "snipeTaxExempt", [payee.toString()]), true);
  evm.warp(60);
  assert.ok((await evm.send(curve, "buy", [1n * E, 0n, buyer.toString()], { from: buyer, value: 1n * E })).ok);
  const before = await evm.balance(payee);
  assert.ok((await evm.send(curve, "sweepFees", [], { from: buyer })).ok);
  assert.ok((await evm.balance(payee)) > before, "the creator's tax reaches the payee, not the launcher");
});

test("T42: a bad config can be taken out of service", async () => {
  // `enabled` was declared on LaunchConfig and never read, and configs are append-only by design --
  // a launched token's economics must never move under it. So a config with bad economics was
  // launchable forever, with no remedy short of deploying a new launchpad.
  const evm = await Evm.create();
  const dev = await evm.account("dev");
  const pad = await evm.deploy(ART, "FleetTestLaunchpad", [0n, SUPPLY, FEE_BPS, PHANTOM, GRADUATION], { from: dev });
  assert.ok((await evm.send(pad, LAUNCH_SIG, [params(), 0n, ZERO], { from: dev })).ok);

  const off = await evm.send(pad, "setLaunchConfigEnabled", [0n, false], { from: dev });
  assert.ok(off.ok, off.error);
  assert.ok(Evm.log(off.logs, "LaunchConfigEnabled"), "and it is announced");
  const blocked = await evm.send(pad, LAUNCH_SIG, [params({ name: "Second", symbol: "TWO" }), 0n, ZERO], { from: dev });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /LaunchConfigDisabled/);
  // Tokens already launched under it are untouched: the config is frozen, not revoked.
  assert.ok((await evm.send(pad, "setLaunchConfigEnabled", [0n, true], { from: dev })).ok);
  assert.ok((await evm.send(pad, LAUNCH_SIG, [params({ name: "Third", symbol: "THR" }), 0n, ZERO], { from: dev })).ok);
  assert.match((await evm.send(pad, "setLaunchConfigEnabled", [9n, false], { from: dev })).error, /InvalidLaunchConfigId/);
});

test("T42: a name is a name, not a megabyte", async () => {
  // Every one of these is stored on chain and read back unbounded by bondli's feed, so a launcher
  // paying gas for an enormous description is paying to make every reader of this launchpad slower.
  const evm = await Evm.create();
  const dev = await evm.account("dev");
  const pad = await evm.deploy(ART, "FleetTestLaunchpad", [0n, SUPPLY, FEE_BPS, PHANTOM, GRADUATION], { from: dev });
  const long = n => "x".repeat(n);
  for (const [field, over] of [["name", { name: long(65) }], ["symbol", { symbol: long(17) }]]) {
    const r = await evm.send(pad, LAUNCH_SIG, [params(over), 0n, ZERO], { from: dev });
    assert.equal(r.ok, false, `${field} was accepted at ${Object.values(over)[0].length} characters`);
    assert.match(r.error, /TokenParamTooLong/);
  }
  // At the limit it is fine: the cap is a bound, not a style guide.
  assert.ok((await evm.send(pad, LAUNCH_SIG, [params({ name: long(64), symbol: long(16) }), 0n, ZERO], { from: dev })).ok);
});

test("T42: money forced into the curve has a way out", async () => {
  // Nothing in the curve accepts a plain transfer, but selfdestruct and a coinbase payout do not
  // ask. Without a skim a donation sits there for good, and it also breaks any reader that assumes
  // the balance equals what the curve owes.
  const { evm, curve, buyer } = await rig();
  evm.warp(60);
  assert.ok((await evm.send(curve, "buy", [1n * E, 0n, buyer.toString()], { from: buyer, value: 1n * E })).ok);
  const owedOut = await evm.call(curve, "trackedQuote");
  assert.equal(await evm.balance(curve), owedOut, "the curve holds exactly what it owes");

  // Force a donation in by writing the balance directly, which is what selfdestruct amounts to.
  const { Account, Address, hexToBytes } = await import("@ethereumjs/util");
  const addr = new Address(hexToBytes(curve.toString()));
  const acct = await evm.vm.stateManager.getAccount(addr);
  await evm.vm.stateManager.putAccount(addr, new Account(acct.nonce, acct.balance + 5n * E, acct.storageRoot, acct.codeHash));
  assert.equal(await evm.balance(curve), owedOut + 5n * E);

  const r = await evm.send(curve, "skim", [], { from: buyer });
  assert.ok(r.ok, r.error);
  assert.equal(await evm.balance(curve), owedOut, "the donation is gone and what is owed is untouched");
  // Skimming again moves nothing: it can only ever take what belongs to nobody.
  assert.ok((await evm.send(curve, "skim", [], { from: buyer })).ok);
  assert.equal(await evm.balance(curve), owedOut);
  solvent(await books(evm, curve), "after a skim");
});
