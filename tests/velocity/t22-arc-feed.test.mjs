// Argus on Arc: the feed, against a fake chain. A Portal launch becomes a tracked token, swaps on
// the PoolManager become buys and sells attributed to the transaction's sender, the price comes
// off the pool's sqrtPriceX96, the snipe window is never a candidate, a held token ticks even when
// the pool cannot be read, and a bonded token keeps trading: never graduated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AbiCoder } from "ethers";
import { ArcFeed, positionReserves, decodeLaunchWords, CANDIDATE_MIN_AGE_MS } from "../../src/velocity/venues/arc/feed.mjs";
import {
  PORTALS, POOL_MANAGER, USDC_ERC20, TOPICS, SNIPE_TAX_WINDOW_MS, QUOTE_IS_NATIVE, TOKEN_SUPPLY,
  portalIface, poolManagerIface, poolIdFor, liquidityForSupply, sqrtRatioAtTick, sqrtRatioToX96, quoteBuy, priceFromSqrtX96,
} from "../../src/velocity/venues/arc/chain.mjs";

const addr = n => "0x" + n.toString(16).padStart(40, "0");
const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1e-300), `${msg}: ${a} vs ${b}`);
const asLog = (enc, address, blockNumber, transactionHash, index = 0) => ({ ...enc, address, blockNumber, transactionHash, index });

// A launch as Portal #7 makes it: $5,000 opening mcap to a $45,000 bond, the whole supply in one
// position, the token as currency0 (its address is below the USDC view's).
const TOKEN = addr(0x11), DEV = addr(0x22), LOCKER = addr(0x33), HOOK = addr(0x44), SPLITTER = addr(0x55), ROUTER = addr(0x66);
const PORTAL = PORTALS[0].address;
const TICK_START = -398400, TICK_BOND = -376400;
const POOL = poolIdFor({ token: TOKEN, hook: HOOK }).toLowerCase();
const LIQ = BigInt(Math.round(liquidityForSupply({ tickStart: TICK_START, tickBond: TICK_BOND, tokenIs0: true })));
const openPool = () => ({ sqrtPriceX96: sqrtRatioToX96(sqrtRatioAtTick(TICK_START)), liquidity: Number(LIQ), tickStart: TICK_START, tickBond: TICK_BOND, buyTaxBps: 300, sellTaxBps: 500, snipeBps: 0, tokenIs0: true });

/** The chain in memory: Portal and PoolManager logs by block, hook terms, the pool's slot0, and who sent each tx. */
function fakeChain({ launchedAtMs }) {
  const s = { head: 1000, logs: [], txFrom: {}, sqrt: sqrtRatioToX96(sqrtRatioAtTick(TICK_START)).toString(), tick: TICK_START, slot0Broken: false, bonded: false, filters: [], hookReads: 0, quoteAsset: USDC_ERC20, launches: {} };
  const rpc = {
    blockNumber: async () => s.head,
    logs: async (f) => {
      s.filters.push(f);
      const addrs = (Array.isArray(f.address) ? f.address : [f.address]).map(a => a.toLowerCase());
      const t0 = Array.isArray(f.topics[0]) ? f.topics[0] : [f.topics[0]], t1 = f.topics[1] == null ? null : (Array.isArray(f.topics[1]) ? f.topics[1] : [f.topics[1]]).map(x => x.toLowerCase());
      return s.logs.filter(l => l.blockNumber >= f.fromBlock && l.blockNumber <= f.toBlock && addrs.includes(l.address.toLowerCase()) && t0.includes(l.topics[0]) && (!t1 || t1.includes(String(l.topics[1]).toLowerCase())));
    },
    hookInfo: async (hook) => { s.hookReads++; assert.equal(hook, HOOK); return { buyTaxBps: 300, sellTaxBps: 500, bonded: s.bonded, launchedAt: launchedAtMs, tickStart: TICK_START, tickBond: TICK_BOND, token: TOKEN, quoteAsset: s.quoteAsset, quoteDecimals: 6, tokenIs0: true, poolId: POOL }; },
    slot0: async (poolId) => { assert.equal(poolId, POOL); if (s.slot0Broken) throw new Error("execution reverted"); return { sqrtPriceX96: s.sqrt, tick: s.tick, lpFeePips: 10000 }; },
    liquidity: async () => LIQ.toString(),
    tokenMeta: async () => ({ name: "Arc Cat", symbol: "ACAT" }),
    txFrom: async (hash) => s.txFrom[hash] ?? null,
    launchInfo: async (token) => s.launches[token] || null,
  };
  return { s, rpc };
}
const launchLogs = (blk) => [
  asLog(portalIface.encodeEventLog("TokenCreated", [TOKEN, DEV, "Arc Cat", "ACAT", POOL, "ipfs://QmArcCatPicture", "https://acat.xyz", "@acat", "t.me/acat"]), PORTAL, blk, "0xlaunch", 0),
  asLog(portalIface.encodeEventLog("PartsDeployed", [TOKEN, LOCKER, HOOK, SPLITTER]), PORTAL, blk, "0xlaunch", 1),
  asLog(portalIface.encodeEventLog("CurveOpened", [TOKEN, POOL, LOCKER, 1n, LIQ, TICK_START, TICK_BOND]), PORTAL, blk, "0xlaunch", 2),
];
/** One swap on the pool as the PoolManager logs it: the swapper's deltas, then the pool state after. */
function swapLog(s, { usdc, tokens, side, blk, tx, wallet, index = 0, pool = openPool() }) {
  const q = BigInt(Math.round(usdc * 1e6)), tk = BigInt(Math.round(tokens)) * 10n ** 18n;
  const a0 = side === "buy" ? tk : -tk, a1 = side === "buy" ? -q : q;
  s.txFrom[tx] = wallet;
  return asLog(poolManagerIface.encodeEventLog("Swap", [POOL, ROUTER, a0, a1, BigInt(s.sqrt), LIQ, s.tick, 10000]), POOL_MANAGER, blk, tx, index);
}
/** Walk the fake pool's price up by a buy, the way the chain would. */
function buyOn(s, usdc, pool = openPool()) {
  const q = quoteBuy({ ...pool, sqrtPriceX96: BigInt(s.sqrt) }, usdc);
  s.sqrt = q.sqrtPriceAfter.toString(); s.tick = Math.floor(Math.log(Number(q.sqrtPriceAfter) / 2 ** 96) * 2 / Math.log(1.0001));
  return q;
}

test("T22: a Portal launch becomes a tracked token with its hook's terms, its picture, and a price off the pool", async () => {
  let now = 1_800_000_000_000; const clock = () => now;
  const { s, rpc } = fakeChain({ launchedAtMs: now });
  const feed = new ArcFeed({ rpc, pollMs: 1500, clock });
  assert.equal(feed.venue, "arc"); assert.equal(feed.name, "arc-feed"); assert.equal(feed.pollMs, 1500);
  assert.equal(feed.solPrice, 1, "the quote asset is the dollar");
  const events = []; feed.on("event", e => { if (e.kind !== "feed_health") events.push(e); });
  s.logs.push(...launchLogs(1001)); s.head = 1001;
  await feed.pollOnce();
  const t = feed.token(TOKEN);
  assert.ok(t, "tracked");
  assert.equal(t.hook, HOOK); assert.equal(t.locker, LOCKER); assert.equal(t.splitter, SPLITTER); assert.equal(t.poolId, POOL); assert.equal(t.devWallet, DEV);
  assert.equal(t.name, "Arc Cat"); assert.equal(t.ticker, "ACAT");
  assert.equal(t.image, "ipfs://QmArcCatPicture", "the launch's picture rides on the token, where the radar row reads it");
  assert.equal(t.website, "https://acat.xyz"); assert.equal(t.twitter, "@acat");
  assert.equal(t.feeBps, 300); assert.equal(t.sellTaxBps, 500); assert.equal(t.tickStart, TICK_START); assert.equal(t.tickBond, TICK_BOND);
  assert.equal(t.liquidity, LIQ.toString()); assert.equal(t.tokenIs0, true);
  close(t.mcapUsd, 5000, 0.02, "opening mcap from slot0"); assert.equal(t.progress, 0); assert.equal(t.bonded, false); assert.equal(t.graduated, false);
  close(t.tokenReserve, TOKEN_SUPPLY, 1e-6, "the whole supply sits in the position"); assert.equal(t.quoteReserve, 0);
  assert.equal(s.hookReads, 1, "the hook's terms are read once");
  // Every Portal is asked for launches, not just the one new launches go to.
  const launchFilter = s.filters.find(f => Array.isArray(f.address) && f.address.length > 1);
  assert.ok(launchFilter, "one launch query across Portals");
  for (const p of PORTALS) assert.ok(launchFilter.address.map(a => a.toLowerCase()).includes(p.address.toLowerCase()), `Portal #${p.n} is indexed`);
  assert.ok(launchFilter.topics[0].includes(TOPICS.TokenCreated) && launchFilter.topics[0].includes(TOPICS.PartsDeployed) && launchFilter.topics[0].includes(TOPICS.CurveOpened));
  assert.equal(events.length, 0, "nothing held, nothing emitted");
  assert.ok(feed.status().healthy); assert.equal(feed.status().block, 1002);
});

test("T22: swaps update buyers, price and progress, attributed to the transaction's sender and not the router; the snipe window is never a candidate", async () => {
  let now = 1_800_000_000_000; const clock = () => now;
  const { s, rpc } = fakeChain({ launchedAtMs: now });
  const feed = new ArcFeed({ rpc, pollMs: 1500, clock });
  const events = []; feed.on("event", e => { if (e.kind !== "feed_health") events.push(e); });
  const trades = []; feed.onTrade = (t, tr) => trades.push(tr);
  // block 1001: launch and the dev's own buy in the same second (the Portal is snipe-tax exempt)
  s.logs.push(...launchLogs(1001));
  const dev = buyOn(s, 100); s.logs.push(swapLog(s, { usdc: 97 * 0.99, tokens: dev.tokensOut, side: "buy", blk: 1001, tx: "0xdev", wallet: DEV, index: 5 }));
  s.head = 1001; await feed.pollOnce();
  const t = feed.token(TOKEN);
  assert.equal(t.buys, 1); assert.equal(t.uniqueBuyers.size, 1); assert.ok(t.uniqueBuyers.has(DEV)); assert.ok(!t.uniqueBuyers.has(ROUTER), "the Swap event's sender is the router, never a buyer");
  assert.equal(t.trades[0].wallet, DEV); assert.equal(t.trades[0].tx, "0xdev"); assert.ok(t.devInitialQuote > 0);
  assert.ok(t.mcapUsd > 5000 && t.progress > 0 && t.progress < 1, `the buy moved the price: ${t.mcapUsd} ${t.progress}`);
  assert.equal(events.filter(e => e.kind === "candidate").length, 0, "inside the snipe window: not a candidate");
  // 2 seconds later, past the 3s snipe tax but not the feed's slack: still not a candidate even with buyers
  now += SNIPE_TAX_WINDOW_MS + 1000; s.head = 1005;
  for (let i = 0; i < 3; i++) { const q = buyOn(s, 50); s.logs.push(swapLog(s, { usdc: 48.5 * 0.99, tokens: q.tokensOut, side: "buy", blk: 1003 + i, tx: "0xb" + i, wallet: addr(0x100 + i) })); }
  await feed.pollOnce();
  assert.equal(t.buys, 4); assert.equal(t.uniqueBuyers.size, 4);
  assert.ok(now - t.createdAt < CANDIDATE_MIN_AGE_MS);
  assert.equal(events.filter(e => e.kind === "candidate").length, 0, "younger than the snipe window plus slack: still not a candidate");
  // a minute in: more buyers, one sell, and the token is judged
  now += 60_000; s.head = 1200;
  for (let i = 3; i < 8; i++) { const q = buyOn(s, 40); s.logs.push(swapLog(s, { usdc: 38.8 * 0.99, tokens: q.tokensOut, side: "buy", blk: 1100 + i, tx: "0xb" + i, wallet: addr(0x100 + i) })); }
  s.logs.push(swapLog(s, { usdc: 10, tokens: 1_000_000, side: "sell", blk: 1150, tx: "0xsell", wallet: addr(0x100) }));
  await feed.pollOnce();
  const c = events.find(e => e.kind === "candidate");
  assert.ok(c, "a candidate once old enough"); assert.equal(c.venue, "arc"); assert.equal(c.id, TOKEN);
  const p = c.payload;
  assert.equal(p.token.buys, 9); assert.equal(p.token.sells, 1); assert.equal(p.token.uniqueBuyers.size, 9); assert.equal(p.token.trades.length, 10);
  assert.equal(p.solPrice, 1); assert.equal(p.quote, "USDC"); assert.equal(p.mcapUsd, t.mcapUsd); assert.equal(p.token.image, "ipfs://QmArcCatPicture");
  assert.equal(p.curve.address, POOL); assert.equal(p.curve.hook, HOOK);
  assert.equal(p.curve.feeBps, 300); assert.equal(p.curve.sellTaxBps, 500); assert.equal(p.curve.creatorTaxBps, 0); assert.equal(p.curve.poolFeeBps, 100); assert.equal(p.curve.native, QUOTE_IS_NATIVE);
  assert.equal(p.curve.tickStart, TICK_START); assert.equal(p.curve.tickBond, TICK_BOND); assert.equal(p.curve.sqrtPriceX96, s.sqrt); assert.equal(p.curve.liquidity, LIQ.toString());
  assert.ok(p.curve.progress > 0 && p.curve.progress < 1 && p.token._curvePct === p.curve.progress, `progress ${p.curve.progress}`);
  assert.equal(p.curve.bonded, false); assert.equal(p.token.graduated, false);
  close(p.mcapUsd, priceFromSqrtX96(BigInt(s.sqrt), { tokenIs0: true }) * TOKEN_SUPPLY, 1e-3, "mcap is the pool's own price times the supply");
  close(p.curve.quoteReserve, 450 * 0.97 * 0.99, 1e-3, "USDC in the position: 450 USDC of buys less the 3% tax and the pool's 1%");
  assert.equal(p.vSolInBondingCurve, p.curve.quoteReserve);
  assert.ok(p.scores.apeScore > 0); assert.ok(p.dynamics.trend); assert.equal(p.qf.rg_devSellSpeed, 0); assert.ok(p.qf._rg_quickFlipRate >= 0);
  assert.equal(trades.length, 10); assert.equal(trades[0].wallet, DEV); assert.equal(trades[9].side, "sell");
  // the same numbers do not re-emit; a watched token ticks every poll regardless
  feed.watch(TOKEN); now += 2000; s.head = 1201; await feed.pollOnce();
  assert.equal(events.filter(e => e.kind === "tick").length, 1, "a watched token ticks every poll"); assert.equal(events.at(-1).payload.source, "arc");
  const candidates = () => events.filter(e => e.kind === "candidate").length;
  const before = candidates(); now += 1; s.head = 1202; await feed.pollOnce(); now += 1; s.head = 1203; await feed.pollOnce();
  assert.ok(candidates() <= before + 1, "same numbers: at most one more decision as the trend settles, never one per poll");
  const settled = candidates(); now += 1; s.head = 1204; await feed.pollOnce();
  assert.equal(candidates(), settled, "settled and unchanged: no new decision asked for");
  const q = buyOn(s, 30); s.logs.push(swapLog(s, { usdc: 29.1 * 0.99, tokens: q.tokensOut, side: "buy", blk: 1205, tx: "0xlate", wallet: addr(0x150) }));
  now += 2000; s.head = 1205; await feed.pollOnce();
  assert.equal(candidates(), settled + 1, "a new buy is a new decision");
  assert.equal(events.filter(e => e.kind === "tick").length, 5, "one tick per poll while held");
  assert.equal(feed.status().ticks, 5); assert.equal(feed.status().attributionErrors, 0);
});

test("T22: a held token whose pool read fails still ticks, and the tick says it is unreadable", async () => {
  let now = 1_800_000_000_000; const clock = () => now;
  const { s, rpc } = fakeChain({ launchedAtMs: now - 120_000 });
  s.launches[TOKEN] = { token: TOKEN, portal: PORTAL.toLowerCase(), creator: DEV, hook: HOOK, locker: LOCKER, splitter: SPLITTER, quoteAsset: USDC_ERC20.toLowerCase(), poolId: POOL };
  const feed = new ArcFeed({ rpc, pollMs: 1500, clock });
  const events = []; feed.on("event", e => { if (e.kind !== "feed_health") events.push(e); });
  feed.watch(TOKEN); // the engine restarted with this position open; the feed never saw its launch
  assert.equal(feed.tokens.size, 0); assert.equal(feed.status().pendingAdopt, 1);
  await feed.pollOnce();
  const t = feed.token(TOKEN);
  assert.ok(t && t._adopted, "adopted from the Portal"); assert.equal(t.hook, HOOK); assert.equal(t.name, "Arc Cat");
  assert.equal(t.createdAt, now - 120_000, "the hook says when it launched, so the age is real"); assert.equal(t._ageUnknown, false);
  const good = events.filter(e => e.kind === "tick" && e.id === TOKEN);
  assert.equal(good.length, 1); assert.ok(good[0].payload.mcapUsd > 0); assert.equal(good[0].payload.curve.address, POOL);
  assert.equal(events.filter(e => e.kind === "candidate").length, 0, "held and priced, but with no buyers it is nothing to judge");
  // Now the pool stops answering and the cached reading is wiped, the way a reverting read leaves it.
  s.slot0Broken = true; t.mcapUsd = 0; t._hydratedAt = 0; events.length = 0;
  now += 10_000; s.head += 20;
  await feed.pollOnce();
  const ticks = events.filter(e => e.kind === "tick" && e.id === TOKEN);
  assert.equal(ticks.length, 1, "a held position still gets a tick when it cannot be priced");
  assert.deepEqual(ticks[0].payload, { unreadable: true, source: "arc", solPrice: 1, solPriceAt: feed.solPriceAt, quote: "USDC", token: { ca: TOKEN, curve: POOL, graduated: false, bonded: false, _ageMs: 130_000 } });
  assert.equal(feed.status().unreadableTicks, 1); assert.equal(feed.status().hydrateErrors, 1); assert.match(feed.status().lastHydrateError, /reverted/);
  assert.equal(events.filter(e => e.kind === "candidate" && e.id === TOKEN).length, 0, "not offered while it cannot be priced");
});

test("T22: past the bond tick the token is bonded, still ticked, still a candidate, and never graduated", async () => {
  let now = 1_800_000_000_000; const clock = () => now;
  const { s, rpc } = fakeChain({ launchedAtMs: now });
  const feed = new ArcFeed({ rpc, pollMs: 1500, clock });
  const events = []; feed.on("event", e => { if (e.kind !== "feed_health") events.push(e); });
  s.logs.push(...launchLogs(1001)); s.head = 1001; await feed.pollOnce();
  feed.watch(TOKEN);
  // A minute later a wall of buys runs the whole position (about 15,600 USDC buys the range):
  // the last swap is capped at the bond tick.
  now += 60_000; s.head = 1100;
  for (let i = 0; i < 5; i++) { const q = buyOn(s, 3_200); s.logs.push(swapLog(s, { usdc: q.usdcUsed, tokens: q.tokensOut, side: "buy", blk: 1050 + i, tx: "0xw" + i, wallet: addr(0x200 + i) })); }
  assert.equal(s.tick, TICK_BOND, "the fake pool sits on the bond tick");
  await feed.pollOnce();
  const t = feed.token(TOKEN);
  assert.equal(t.bonded, true); assert.equal(t.progress, 1); assert.equal(t._curvePct, 1);
  assert.equal(t.graduated, false, "Argus never migrates: the pool keeps trading the same position");
  const c = events.find(e => e.kind === "candidate");
  assert.ok(c, "still judged"); assert.equal(c.payload.curve.bonded, true); assert.equal(c.payload.token.graduated, false); assert.equal(c.payload.token.bonded, true);
  close(c.payload.curve.tokenReserve, 0, 1e-6, "nothing left above the bond"); assert.ok(c.payload.curve.quoteReserve > 14_000 && c.payload.curve.quoteReserve < 16_000, `the range's USDC: ${c.payload.curve.quoteReserve}`);
  assert.equal(t.buys, 5); assert.equal(t.uniqueBuyers.size, 5);
  // The price retreats on a sell: progress reads lower for display, the latch does not clear.
  s.sqrt = sqrtRatioToX96(sqrtRatioAtTick(TICK_START + 11000)).toString(); s.tick = TICK_START + 11000;
  s.logs.push(swapLog(s, { usdc: 1000, tokens: 50_000_000, side: "sell", blk: 1101, tx: "0xdump", wallet: addr(0x200) }));
  now += 2000; s.head = 1101; events.length = 0;
  await feed.pollOnce();
  assert.equal(t.bonded, true, "bonded stays bonded"); assert.ok(t.progress < 1 && t.progress > 0.4, `display progress ${t.progress}`);
  assert.equal(t.graduated, false);
  const tick = events.find(e => e.kind === "tick");
  assert.ok(tick, "a held bonded token is still ticked"); assert.equal(tick.payload.token.graduated, false); assert.equal(tick.payload.curve.bonded, true);
  // The hook's own latch is honoured even when the feed never saw the crossing.
  const { s: s2, rpc: rpc2 } = fakeChain({ launchedAtMs: now }); s2.bonded = true;
  const feed2 = new ArcFeed({ rpc: rpc2, pollMs: 1500, clock });
  s2.logs.push(...launchLogs(1001)); s2.head = 1001; await feed2.pollOnce();
  assert.equal(feed2.token(TOKEN).bonded, true); assert.equal(feed2.token(TOKEN).graduated, false);
});

test("T22: a launch quoted in something other than USDC is read, then set aside: the router cannot pay for it", async () => {
  let now = 1_800_000_000_000; const clock = () => now;
  const { s, rpc } = fakeChain({ launchedAtMs: now }); s.quoteAsset = addr(0x999);
  const feed = new ArcFeed({ rpc, pollMs: 1500, clock });
  const events = []; feed.on("event", e => { if (e.kind !== "feed_health") events.push(e); });
  s.logs.push(...launchLogs(1001)); s.head = 1001; await feed.pollOnce();
  feed.watch(TOKEN);
  now += 60_000; s.head = 1100;
  for (let i = 0; i < 3; i++) { const q = buyOn(s, 50); s.logs.push(swapLog(s, { usdc: 48, tokens: q.tokensOut, side: "buy", blk: 1050 + i, tx: "0xq" + i, wallet: addr(0x300 + i) })); }
  await feed.pollOnce();
  assert.equal(feed.token(TOKEN).unsupportedQuote, true); assert.equal(feed.status().skippedQuote, 1);
  assert.equal(events.length, 0, "no tick, no candidate");
});

test("T22: PartsDeployed arriving before TokenCreated is kept until the launch shows up", async () => {
  const feed = new ArcFeed({ rpc: { blockNumber: async () => 1, logs: async () => [] }, clock: () => 1_800_000_000_000 });
  assert.equal(feed.apply({ kind: "parts", token: TOKEN, locker: LOCKER, hook: HOOK, splitter: SPLITTER }), undefined);
  assert.equal(feed.tokens.size, 0);
  const t = feed.apply({ kind: "launch", token: TOKEN, creator: DEV, name: "Arc Cat", symbol: "ACAT", poolId: POOL, imageURI: "", portal: PORTAL.toLowerCase(), block: 1, tx: "0x" });
  assert.equal(t.hook, HOOK); assert.equal(feed.byHook.get(HOOK), t); assert.equal(feed.byPool.get(POOL), t);
  assert.equal(feed.apply({ kind: "launch", token: TOKEN, creator: DEV, poolId: POOL }), undefined, "a launch is applied once");
  // A swap on a pool the feed does not track is nothing.
  assert.equal(feed.apply({ kind: "swap", poolId: "0x" + "9".repeat(64), amount0: "1", amount1: "-1", sqrtPriceX96: "1", liquidity: "1", tick: 0 }), undefined);
});

test("T22: the position's reserves agree with the buy quote, for both currency orders", () => {
  for (const tokenIs0 of [true, false]) {
    const tickStart = tokenIs0 ? -398400 : 398400, tickBond = tokenIs0 ? -376400 : 376400;
    const liquidity = liquidityForSupply({ tickStart, tickBond, tokenIs0 });
    const pool = { sqrtPriceX96: sqrtRatioToX96(sqrtRatioAtTick(tickStart)), liquidity, tickStart, tickBond, buyTaxBps: 300, sellTaxBps: 500, snipeBps: 0, tokenIs0 };
    const open = positionReserves(pool);
    close(open.tokenReserve, TOKEN_SUPPLY, 1e-6, `whole supply at the open ${tokenIs0}`); assert.equal(open.quoteReserve, 0);
    const b = quoteBuy(pool, 250);
    const after = positionReserves({ ...pool, sqrtPriceX96: b.sqrtPriceAfter });
    close(after.tokenReserve, TOKEN_SUPPLY - b.tokensOut, 1e-6, `tokens left ${tokenIs0}`);
    close(after.quoteReserve, 250 - b.usdcTaxed - b.usdcLpFee, 1e-6, `USDC that moved the price ${tokenIs0}`);
    // Outside the position (a stale read) it is held at the edge, and no liquidity means no reserves.
    assert.deepEqual(positionReserves({ ...pool, sqrtPriceX96: sqrtRatioToX96(sqrtRatioAtTick(tokenIs0 ? tickStart - 5000 : tickStart + 5000)) }), open);
    assert.deepEqual(positionReserves({ ...pool, liquidity: 0 }), { quoteReserve: 0, tokenReserve: 0 });
  }
});

test("T22: a Portal's launches() record decodes by word position, whatever its version's length", () => {
  const coder = AbiCoder.defaultAbiCoder();
  const full = coder.encode(["address", "int24", "bool", "address", "address", "address", "uint16", "uint16", "uint256", "int24", "address"], [DEV, TICK_START, true, LOCKER, HOOK, SPLITTER, 300, 500, 12345n, TICK_BOND, USDC_ERC20]);
  assert.deepEqual(decodeLaunchWords(full), { creator: DEV, tickStart: TICK_START, tokenIsToken0: true, locker: LOCKER, hook: HOOK, splitter: SPLITTER, buyTaxBps: 300, sellTaxBps: 500, positionId: "12345", tickBond: TICK_BOND, quoteAsset: USDC_ERC20.toLowerCase(), words: 11 });
  const ten = coder.encode(["address", "int24", "bool", "address", "address", "address", "uint16", "uint16", "uint256", "int24"], [DEV, TICK_START, false, LOCKER, HOOK, SPLITTER, 300, 500, 1n, TICK_BOND]);
  const r10 = decodeLaunchWords(ten); assert.equal(r10.words, 10); assert.equal(r10.tickBond, TICK_BOND); assert.equal(r10.quoteAsset, null); assert.equal(r10.tokenIsToken0, false);
  const nine = coder.encode(["address", "int24", "bool", "address", "address", "address", "uint16", "uint16", "uint256"], [DEV, TICK_START, true, LOCKER, HOOK, SPLITTER, 300, 500, 1n]);
  const r9 = decodeLaunchWords(nine); assert.equal(r9.words, 9); assert.equal(r9.tickBond, null); assert.equal(r9.quoteAsset, null);
  assert.equal(decodeLaunchWords(coder.encode(["address", "int24", "bool", "address", "address", "address", "uint16", "uint16", "uint256", "int24", "address"], [addr(0), 0, false, addr(0), addr(0), addr(0), 0, 0, 0n, 0, addr(0)])), null, "an empty record is no launch");
  assert.equal(decodeLaunchWords("0x"), null); assert.equal(decodeLaunchWords(null), null);
});
