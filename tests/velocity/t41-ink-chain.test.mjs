// T41: Ink's two launchpads, as constants and maths. Everything here is pure, so it is tested
// exhaustively and offline; the feed and the router are the only things that touch a chain.
//
// The addresses are the load-bearing part. They come from DefiLlama's public adapters for these
// protocols -- reviewed code, matched against on-chain TVL -- and a wrong one does not fail loudly:
// it makes the radar watch nothing, or worse, price a token off somebody else's pool. So they are
// pinned, and the shapes they have to satisfy are asserted rather than assumed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as ink from "../../src/velocity/venues/ink/chain.mjs";

const isAddr = a => /^0x[0-9a-fA-F]{40}$/.test(a);

test("T41: the chain is Ink, and every address is an address", () => {
  assert.equal(ink.CHAIN_ID, 57073);
  assert.equal(ink.CHAIN_NAME, "ink");
  assert.equal(ink.WETH, "0x4200000000000000000000000000000000000006", "the OP-Stack predeploy");
  assert.ok(ink.DEFAULT_RPC_URLS.length >= 2, "more than one public endpoint, because one will throttle");
  for (const u of ink.DEFAULT_RPC_URLS) assert.match(u, /^https:\/\//);

  // Sentry's Ink entry quotes against the same WETH the chain does. That is deliberate, so it is
  // asserted rather than tripping the uniqueness check below.
  assert.equal(ink.SENTRY.ink.weth, ink.WETH);
  assert.notEqual(ink.SENTRY.robinhood.weth, ink.WETH, "a different chain, a different WETH");

  const all = [
    ink.TSUNAMI.factory, ink.CALAMARI.poolManager, ink.WETH, ink.USDC, ink.SENTRY.robinhood.weth,
    ...ink.TSUNAMI_HOOKS.map(h => h.address),
    ...Object.values(ink.SENTRY).flatMap(c => [c.stateView, c.vault, ...c.v3Factories.map(f => f.address), ...c.v4Factories.map(f => f.address)]),
  ];
  for (const a of all) assert.ok(isAddr(a), `${a} is an address`);
  // No contract appears twice under two names -- a copy-paste slip between two factories would
  // otherwise read as a working config that watches the same contract twice.
  const lowered = all.map(a => a.toLowerCase());
  assert.equal(new Set(lowered).size, lowered.length, "no address is duplicated across roles");
  // Every factory carries the block it started at, or a log scan begins at genesis and times out.
  for (const c of Object.values(ink.SENTRY))
    for (const f of [...c.v3Factories, ...c.v4Factories]) assert.ok(f.firstBlock > 0, `${f.address} has a first block`);
  assert.ok(ink.TSUNAMI.firstBlock > 0 && ink.CALAMARI.firstBlock > 0);
  // Calamari's PoolManager predates the Tsunami factory that seeds it, which is the only order that
  // makes sense and a cheap check that the two numbers did not get swapped.
  assert.ok(ink.CALAMARI.firstBlock < ink.TSUNAMI.firstBlock);
});

test("T41: Sentry is two chains, and the tokenized-stock factory is kept apart", () => {
  // Sentry runs on Ink and on Robinhood Chain. bondli already has an RPC and a price for the second,
  // so that side costs no new infrastructure -- worth encoding so nobody rediscovers it.
  assert.deepEqual(Object.keys(ink.SENTRY).sort(), ["ink", "robinhood"]);
  assert.equal(ink.SENTRY.robinhood.chainId, 4663, "the chain bondli already reads for PONS");
  assert.equal(ink.SENTRY.ink.chainId, ink.CHAIN_ID);
  // A launch whose base asset is a tokenized stock is not a memecoin launch and must not be judged
  // by a memecoin edge. It is labelled at the source so the feed can refuse it deliberately.
  const kinds = Object.values(ink.SENTRY).flatMap(c => [...c.v3Factories, ...c.v4Factories].map(f => f.kind));
  assert.ok(kinds.includes("stock"), "the tokenized-stock factory is marked");
  assert.ok(kinds.includes("agent"), "so is the agent-launch factory");
  assert.equal(ink.SENTRY.robinhood.v4Factories.find(f => f.kind === "stock").address, "0xd0A93885a387e3a8a14dd82776CF9104a3676b3A");
});

test("T41: a pool id does not depend on the order the pair is named in", () => {
  // v4 orders currencies by address. If poolIdFor did not, two callers naming the same pool would
  // compute two ids and one of them would watch a pool that does not exist.
  const token = "0x1111111111111111111111111111111111111111";
  const quote = "0x9999999999999999999999999999999999999999";
  const key = { hook: ink.TSUNAMI_HOOKS[0].address, fee: 10_000, tickSpacing: 200 };
  const a = ink.poolIdFor({ token, quote, ...key });
  const b = ink.poolIdFor({ token: quote, quote: token, ...key });
  assert.equal(a, b, "the same pool either way round");
  assert.match(a, /^0x[0-9a-f]{64}$/);
  // And it is sensitive to everything that is part of the key.
  assert.notEqual(a, ink.poolIdFor({ token, quote, ...key, fee: 3_000 }));
  assert.notEqual(a, ink.poolIdFor({ token, quote, ...key, tickSpacing: 60 }));
  assert.notEqual(a, ink.poolIdFor({ token, quote, ...key, hook: ink.TSUNAMI_HOOKS[1].address }));
  assert.equal(ink.tokenIsToken0(token, quote), true);
  assert.equal(ink.tokenIsToken0(quote, token), false);
});

test("T41: price comes off the sqrt price, and market cap never assumes a supply", () => {
  const Q96 = 2n ** 96n;
  // sqrtPriceX96 == 2^96 is a raw ratio of 1; with equal decimals that is a price of 1.
  assert.equal(ink.priceFromSqrtX96(Q96, { tokenIs0: true }), 1);
  // Twice the sqrt price is four times the price.
  assert.ok(Math.abs(ink.priceFromSqrtX96(Q96 * 2n, { tokenIs0: true }) - 4) < 1e-9);
  // The other side of the pair is the reciprocal.
  assert.ok(Math.abs(ink.priceFromSqrtX96(Q96 * 2n, { tokenIs0: false }) - 0.25) < 1e-9);
  assert.equal(ink.priceFromSqrtX96(0n, { tokenIs0: true }), 0, "no price is 0, not NaN");

  // Supply is an argument, never a constant. Assuming one billion is exactly how a $2.5k token was
  // served at $1.1M on pump.fun (tests/api/t35), and these launchpads do not all mint the same.
  assert.equal(ink.mcapFrom(0.001, 1e9), 1e6);
  assert.equal(ink.mcapFrom(0.001, 2.5e6), 2500);
  assert.equal(ink.mcapFrom(0.001, 0), 0, "no supply means no market cap, not a made-up one");
  assert.equal(ink.mcapFrom(0, 1e9), 0);
  const SRC = fs.readFileSync("src/velocity/venues/ink/chain.mjs", "utf8");
  assert.doesNotMatch(SRC, /TOKEN_SUPPLY\s*=/, "this module hard-codes no supply at all");
});

test("T41: a swap's side is read from the quote leg's sign", () => {
  // amount0/amount1 are signed from the POOL's point of view: positive is into the pool. Quote going
  // in is somebody buying the token.
  const Q96 = 2n ** 96n;
  const buy = ink.classifySwap({ amount0: -5n * 10n ** 18n, amount1: 10n ** 18n, sqrtPriceX96: Q96 }, { tokenIs0: true });
  assert.equal(buy.side, "buy");
  assert.equal(buy.quote, 1);
  assert.equal(buy.tokens, 5);
  const sell = ink.classifySwap({ amount0: 5n * 10n ** 18n, amount1: -(10n ** 18n), sqrtPriceX96: Q96 }, { tokenIs0: true });
  assert.equal(sell.side, "sell");
  assert.equal(sell.quote, 1, "size is the magnitude; the sign is the side");
  // With the token as currency1 the legs swap over.
  const buy1 = ink.classifySwap({ amount0: 10n ** 18n, amount1: -5n * 10n ** 18n, sqrtPriceX96: Q96 }, { tokenIs0: false });
  assert.equal(buy1.side, "buy");
  assert.equal(ink.classifySwap({ amount0: 0n, amount1: 0n, sqrtPriceX96: Q96 }, { tokenIs0: true }).side, null);
});

test("T41: each launchpad's round trip is priced from its own fees", () => {
  // Tsunami charges 1% in the hook on every trade: 2% there and back.
  assert.equal(ink.roundTripCostFraction("tsunami"), 0.02);
  assert.equal(ink.TSUNAMI.swapFeeBps, 100);
  // Sentry's pool charges 1% and Sentry's router adds 1% more on the ETH side, so the route decides
  // whether a round trip costs 2% or 4% -- a difference the cost model cannot be allowed to guess.
  assert.equal(ink.roundTripCostFraction("sentry"), 0.04);
  assert.equal(ink.roundTripCostFraction("sentry", { viaSentryRouter: false }), 0.02);
  assert.equal(ink.roundTripCostFraction("nonsense"), 0);
  // The creator's share differs between Tsunami's two factories, and the hook is what says which.
  assert.equal(ink.tsunamiFeeSplit("0x5dC5426A33c1D095B9fD0449ac16F6AaeBEeE8cc").creatorBps, 3_000);
  assert.equal(ink.tsunamiFeeSplit("0xAE08d8bFF05b19a32F0215123244e70DD54368Cc").creatorBps, 100);
  for (const h of ink.TSUNAMI_HOOKS) {
    const s = ink.tsunamiFeeSplit(h.address);
    assert.equal(s.creatorBps + s.platformBps, ink.BASIS_POINTS, `${h.address} splits to a whole`);
  }
  assert.equal(ink.tsunamiFeeSplit("0x0000000000000000000000000000000000000000"), null);
  // A shared PoolManager carries every protocol's traffic, so a Tsunami swap is identified by hook.
  assert.equal(ink.isTsunamiHook(ink.TSUNAMI_HOOKS[2].address.toUpperCase()), true, "case does not matter");
  assert.equal(ink.isTsunamiHook(ink.SENTRY.ink.vault), false);
  assert.equal(ink.isTsunamiHook(null), false);
});

test("T41: curve progress refuses to invent a denominator", () => {
  assert.equal(ink.curveProgress(5, 10), 0.5);
  assert.equal(ink.curveProgress(0, 10), 0);
  assert.equal(ink.curveProgress(50, 10), 1, "and never runs past full");
  // The graduation target is not yet known from a verified source. Until it is, progress is null --
  // a guessed target would render as a confident percentage that nothing stands behind.
  assert.equal(ink.curveProgress(5, 0), null);
  assert.equal(ink.curveProgress(5, undefined), null);
});

test("T41: an unrecognised log is null, not an exception", () => {
  // The Calamari PoolManager is a singleton carrying every protocol on the chain, so the decoder
  // sees far more logs than it understands and must not throw on any of them.
  assert.equal(ink.decodeLog(null), null);
  assert.equal(ink.decodeLog({ topics: [] }), null);
  assert.equal(ink.decodeLog({ topics: ["0x" + "ab".repeat(32)], data: "0x" }), null);
  for (const t of Object.values(ink.TOPICS)) assert.match(t, /^0x[0-9a-f]{64}$/);
  assert.equal(new Set(Object.values(ink.TOPICS)).size, Object.keys(ink.TOPICS).length, "no two topics collide");
});

test("T41: what is not yet known is written down, and nothing live is built on it", () => {
  // Four rounds of this session were spent on code that treated an unknown as a confident value.
  // The gaps here are named instead, and the router that would need them does not exist yet.
  assert.ok(ink.NEEDS_VERIFIED_SOURCE.length >= 4);
  for (const s of ink.NEEDS_VERIFIED_SOURCE) assert.ok(s.length > 40, "each gap says what it is and why");
  const joined = ink.NEEDS_VERIFIED_SOURCE.join(" ").toLowerCase();
  for (const must of ["curve", "graduation", "sentry", "fee-router"]) assert.ok(joined.includes(must), `${must} is listed`);
  // There IS an Ink router now, and the guard this replaces is why it is worth saying what it is
  // built on. It trades bondli's own launchpad, whose ABI we wrote and whose behaviour the
  // tests/launch suite pins — not Tsunami and not Sentry, whose selectors are still unread. The
  // invariant is unchanged: nothing live is built on an unverified constant.
  const ROUTER = fs.readFileSync("src/velocity/venues/ink/router.mjs", "utf8");
  const FEED = fs.readFileSync("src/velocity/venues/ink/feed.mjs", "utf8");
  for (const [name, src] of [["router", ROUTER], ["feed", FEED]]) {
    assert.match(src, /from "\.\.\/curve\/(router|feed)\.mjs"/, `the Ink ${name} is the shared curve one`);
    assert.doesNotMatch(src, /TSUNAMI|SENTRY|CALAMARI/, `the Ink ${name} touches no unverified third-party constant`);
  }
  // poolIdFor takes fee and tickSpacing as arguments precisely because they are not pinned; a
  // default would be a guess that silently computes the wrong pool.
  const SRC = fs.readFileSync("src/velocity/venues/ink/chain.mjs", "utf8");
  assert.match(SRC, /export function poolIdFor\(\{ token, quote, hook, fee, tickSpacing \}\)/, "no defaulted key fields");
});
