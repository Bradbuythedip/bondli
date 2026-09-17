// Argus on Arc: the pure parts (event topics, log decoding, tick and price arithmetic, the hook's
// snipe tax, single-position swap math) before any RPC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Interface, AbiCoder, id as keccakId, keccak256 } from "ethers";
import {
  CHAIN_ID, DEFAULT_RPC_URLS, PORTALS, V4_PORTALS, POOL_MANAGER, STATE_VIEW, USDC_ERC20, PERMIT2, QUOTE_IS_NATIVE, QUOTE_DECIMALS,
  PORTAL_ABI, HOOK_ABI, POOL_MANAGER_ABI, TOPICS, SNIPE_TAX_WINDOW_MS, SNIPE_TAX_CAP_BPS, TOKEN_SUPPLY, POOL_FEE_PIPS, TICK_SPACING,
  decodeLog, classifySwap, priceFromSqrtX96, mcapQuote, snipeTaxBps, combinedTaxBps, progress, tokenIsToken0, poolIdFor,
  sqrtRatioAtTick, sqrtRatioToX96, sqrtRatioFromX96, tickFromSqrtPriceX96, liquidityForSupply, quoteBuy, quoteSell, toUsdc, toUsdcUnits, toNativeUsdc,
} from "../../src/velocity/venues/arc/chain.mjs";

const addr = n => "0x" + n.toString(16).padStart(40, "0");
const portal = new Interface(PORTAL_ABI), hook = new Interface(HOOK_ABI), pm = new Interface(POOL_MANAGER_ABI);
const asLog = (enc, address, blockNumber, transactionHash, index = 0) => ({ ...enc, address, blockNumber, transactionHash, index });
const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1e-300), `${msg}: ${a} vs ${b}`);

test("T20: chain constants, and every topic is the keccak of its own signature", () => {
  assert.equal(CHAIN_ID, 5042);
  assert.ok(DEFAULT_RPC_URLS.includes("https://rpc.mainnet.arc.io") && DEFAULT_RPC_URLS.length >= 4);
  assert.equal(PORTALS.length, 7); assert.equal(PORTALS[0].n, 7); assert.equal(PORTALS[0].address, "0xB021Be536808f551b31789422Fd28a6c9c6e97Da"); assert.equal(PORTALS[0].startBlock, 20_395_275);
  assert.equal(V4_PORTALS.length, 5, "Portals #3..#7 trade through a LaunchHook; #1 and #2 are legacy v3");
  assert.equal(POOL_MANAGER, "0x8366a39CC670B4001A1121B8F6A443A643e40951"); assert.equal(STATE_VIEW, "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b");
  assert.equal(USDC_ERC20, "0x3600000000000000000000000000000000000000"); assert.equal(QUOTE_DECIMALS, 6);
  assert.equal(QUOTE_IS_NATIVE, false, "Portal.sol builds the pool key from p.quoteAsset, an ERC-20 the splitter moves with transfer()");
  assert.equal(PERMIT2, "0x000000000022D473030F116dDEE9F6B43aC78BA3");
  assert.equal(SNIPE_TAX_WINDOW_MS, 3000); assert.equal(POOL_FEE_PIPS, 10_000); assert.equal(TICK_SPACING, 200);
  // The strings here are typed out on purpose: a topic that drifts from its Solidity event fails.
  assert.equal(TOPICS.TokenCreated, keccakId("TokenCreated(address,address,string,string,bytes32,string,string,string,string)"));
  assert.equal(TOPICS.PartsDeployed, keccakId("PartsDeployed(address,address,address,address)"));
  assert.equal(TOPICS.CurveOpened, keccakId("CurveOpened(address,bytes32,address,uint256,uint128,int24,int24)"));
  assert.equal(TOPICS.Swap, keccakId("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"));
  assert.equal(TOPICS.Initialize, keccakId("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)"));
  assert.equal(TOPICS.ModifyLiquidity, keccakId("ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)"));
  assert.equal(TOPICS.Bonded, keccakId("Bonded(uint256,int24)"));
  assert.equal(TOPICS.TaxCollected, keccakId("TaxCollected(bool,uint256,address)"));
  // Two anchors from outside this repo: the topic0 Argus documents for its v4 TokenCreated, and
  // Uniswap v4's Swap topic as every v4 indexer knows it.
  assert.equal(TOPICS.TokenCreated, "0x1d8917231579f8ce39407f0d616f36f357b07329b0ce5164d0754ac15145ce0a");
  assert.equal(TOPICS.Swap, "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f");
  // Both interfaces agree with the topics, so parseLog will find each event.
  assert.equal(portal.getEvent("TokenCreated").topicHash, TOPICS.TokenCreated);
  assert.equal(pm.getEvent("Swap").topicHash, TOPICS.Swap);
  assert.equal(hook.getEvent("TaxCollected").topicHash, TOPICS.TaxCollected);
  assert.ok(!hook.fragments.some(f => f.type === "event" && f.inputs.some(i => i.type === "address" && /trader|buyer|seller|recipient/i.test(i.name))), "the hook names no trader in any event");
});

test("T20: Portal and PoolManager logs decode to plain records; foreign and malformed logs are null", () => {
  const TOKEN = addr(0x11), CREATOR = addr(0x22), LOCKER = addr(0x33), HOOK = addr(0x44), SPLITTER = addr(0x55), POOL = "0x" + "ab".repeat(32);
  const launch = decodeLog(asLog(portal.encodeEventLog("TokenCreated", [TOKEN, CREATOR, "Arc Cat", "ACAT", POOL, "ipfs://img", "https://acat.xyz", "@acat", "t.me/acat"]), PORTALS[0].address, 100, "0xaa", 2));
  assert.deepEqual(launch, { kind: "launch", portal: PORTALS[0].address.toLowerCase(), token: TOKEN, creator: CREATOR, name: "Arc Cat", symbol: "ACAT", poolId: POOL, imageURI: "ipfs://img", website: "https://acat.xyz", twitter: "@acat", telegram: "t.me/acat", block: 100, tx: "0xaa", logIndex: 2 });
  const parts = decodeLog(asLog(portal.encodeEventLog("PartsDeployed", [TOKEN, LOCKER, HOOK, SPLITTER]), PORTALS[0].address, 100, "0xaa", 3));
  assert.deepEqual(parts, { kind: "parts", portal: PORTALS[0].address.toLowerCase(), token: TOKEN, locker: LOCKER, hook: HOOK, splitter: SPLITTER, block: 100, tx: "0xaa", logIndex: 3 });
  const opened = decodeLog(asLog(portal.encodeEventLog("CurveOpened", [TOKEN, POOL, LOCKER, 12345n, 3_400_000_000_000_000_000n, -398400, -376400]), PORTALS[0].address, 100, "0xaa", 4));
  assert.deepEqual(opened, { kind: "opened", portal: PORTALS[0].address.toLowerCase(), token: TOKEN, poolId: POOL, locker: LOCKER, positionId: "12345", liquidity: "3400000000000000000", tickLower: -398400, tickUpper: -376400, block: 100, tx: "0xaa", logIndex: 4 });
  const sqrt = sqrtRatioToX96(sqrtRatioAtTick(-390000));
  const swap = decodeLog(asLog(pm.encodeEventLog("Swap", [POOL, addr(0x66), 2_000_000n * 10n ** 18n, -50_000_000n, sqrt, 3_400_000_000_000_000_000n, -390000, 10000]), POOL_MANAGER, 101, "0xbb", 7));
  assert.deepEqual(swap, { kind: "swap", poolId: POOL, sender: addr(0x66), amount0: "2000000000000000000000000", amount1: "-50000000", sqrtPriceX96: sqrt.toString(), liquidity: "3400000000000000000", tick: -390000, fee: 10000, block: 101, tx: "0xbb", logIndex: 7 });
  // The swapper received 2,000,000 token0 for 50 USDC (6 decimals) of currency1: a buy when the token is currency0.
  assert.deepEqual(classifySwap(swap, { tokenIs0: true }), { side: "buy", tokens: 2_000_000, quote: 50 });
  assert.equal(classifySwap(swap, { tokenIs0: false }).side, "sell", "the same deltas read as a sell when the token is currency1");
  const init = decodeLog(asLog(pm.encodeEventLog("Initialize", [POOL, TOKEN, USDC_ERC20, 10000, 200, HOOK, sqrt, -390000]), POOL_MANAGER, 99, "0xcc"));
  assert.deepEqual(init, { kind: "initialize", poolId: POOL, currency0: TOKEN, currency1: USDC_ERC20, fee: 10000, tickSpacing: 200, hooks: HOOK, sqrtPriceX96: sqrt.toString(), tick: -390000, block: 99, tx: "0xcc", logIndex: 0 });
  assert.equal(decodeLog({ topics: ["0x" + "1".repeat(64)], data: "0x" }), null);
  assert.equal(decodeLog({ topics: [TOPICS.ModifyLiquidity], data: "0x" }), null, "liquidity changes are not a record the feed keeps");
  assert.equal(decodeLog({ topics: [TOPICS.Swap], data: "0x" }), null, "malformed data is not a trade");
  assert.equal(decodeLog(null), null);
});

test("T20: pool id and currency order follow the Portal's own rules", () => {
  const HOOK = addr(0x44);
  const low = addr(0x11), high = "0x" + "f".repeat(40);
  assert.equal(tokenIsToken0(low), true); assert.equal(tokenIsToken0(high), false);
  // Portal.sol: keccak256(abi.encode(currency0, currency1, POOL_FEE, TICK_SPACING, address(hook)))
  const coder = AbiCoder.defaultAbiCoder();
  assert.equal(poolIdFor({ token: low, hook: HOOK }), keccak256(coder.encode(["address", "address", "uint24", "int24", "address"], [low, USDC_ERC20, 10000, 200, HOOK])));
  assert.equal(poolIdFor({ token: high, hook: HOOK }), keccak256(coder.encode(["address", "address", "uint24", "int24", "address"], [USDC_ERC20, high, 10000, 200, HOOK])));
  assert.notEqual(poolIdFor({ token: low, hook: HOOK }), poolIdFor({ token: low, hook: addr(0x45) }), "a different hook is a different pool");
  assert.equal(toUsdc(toUsdcUnits(12.5)), 12.5); assert.equal(toUsdc(1_500_000n), 1.5);
  assert.equal(toNativeUsdc(10n ** 18n), 1, "the gas face of one USDC is 1e18 wei");
});

test("T20: price from sqrtPriceX96 for both currency orders and both quote decimal faces", () => {
  // sqrtPriceX96 = 2^96 is a raw ratio of exactly 1: one currency1 unit per currency0 unit. With an
  // 18-decimal token and the 6-decimal USDC view that is 1e12 USDC per token whichever side the
  // token is on; against an 18-decimal quote it is 1.
  assert.equal(priceFromSqrtX96(2n ** 96n, { tokenIs0: true }), 1e12);
  assert.equal(priceFromSqrtX96(2n ** 96n, { tokenIs0: false }), 1e12);
  assert.equal(priceFromSqrtX96(2n ** 96n, { tokenIs0: true, quoteDecimals: 18 }), 1);
  // 1e-5 USDC per token: raw 1e-17 quote units per token unit when the token is currency0, the inverse 1e17 when it is currency1.
  const x0 = BigInt(Math.round(Math.sqrt(1e-17) * 2 ** 96)), x1 = BigInt(Math.round(Math.sqrt(1e17) * 2 ** 96));
  close(priceFromSqrtX96(x0, { tokenIs0: true }), 1e-5, 1e-9, "token0");
  close(priceFromSqrtX96(x1, { tokenIs0: false }), 1e-5, 1e-9, "token1");
  close(priceFromSqrtX96(x0, { tokenIs0: false }), 1e29, 1e-9, "reading the order wrong is off by 1e34, never subtle");
  assert.equal(priceFromSqrtX96(0n, { tokenIs0: true }), 0);
  close(mcapQuote(1e-5), 10_000, 1e-12, "mcap"); assert.equal(mcapQuote(0), 0); assert.equal(TOKEN_SUPPLY, 1e9);
  // Every tick on the 200 grid, and every tick across the launch band, round-trips through its sqrt
  // ratio. A plain floor of the float log answered one tick low about one time in seven.
  // Below about -700000 the X96 integer itself is only a few billion, so its own rounding is coarser
  // than a tick; no Argus pool sits there (launches open around -420000 for a 6-decimal quote).
  for (let t = -700000; t <= 887200; t += 200) assert.equal(tickFromSqrtPriceX96(sqrtRatioToX96(sqrtRatioAtTick(t))), t, `grid tick ${t}`);
  for (let t = -420000; t <= -300000; t += 7) assert.equal(tickFromSqrtPriceX96(sqrtRatioToX96(sqrtRatioAtTick(t))), t, `band tick ${t}`);
  close(sqrtRatioFromX96(sqrtRatioToX96(2.5e-9)), 2.5e-9, 1e-12, "x96 round trip");
});

test("T20: the snipe tax is the hook's right-shift decay in whole seconds, capped with the leg tax at 99%", () => {
  // LaunchHook.currentSnipeTaxBps(): elapsed = block.timestamp - launchedAt (whole seconds);
  // 0 after SNIPE_TAX_DURATION (3 s); else 9900 >> ((elapsed * 14) / 3), integer division.
  //   0 ms   -> elapsed 0, shift 0        -> 9900
  //   1000ms -> elapsed 1, shift 14/3=4   -> 9900 >> 4 = floor(9900/16)  = 618
  //   2999ms -> elapsed 2, shift 28/3=9   -> 9900 >> 9 = floor(9900/512) = 19
  //   3000ms -> elapsed 3 >= duration     -> 0
  //   10000ms                              -> 0
  assert.equal(snipeTaxBps(0), 9900);
  assert.equal(snipeTaxBps(999), 9900, "the contract has no sub-second resolution");
  assert.equal(snipeTaxBps(1000), 618);
  assert.equal(snipeTaxBps(2999), 19);
  assert.equal(snipeTaxBps(3000), 0);
  assert.equal(snipeTaxBps(10000), 0);
  assert.equal(snipeTaxBps(-500), 9900, "a clock ahead of the chain is still inside the window");
  assert.equal(SNIPE_TAX_CAP_BPS, 9900);
  assert.equal(combinedTaxBps(1000, 9900), 9900, "10% leg + 99% snipe caps at 99%");
  assert.equal(combinedTaxBps(300, 618), 918);
  assert.equal(combinedTaxBps(300), 300);
});

test("T20: progress runs from the opening tick to the bond tick in either direction and is clamped", () => {
  assert.equal(progress(-398400, -398400, -376400), 0);
  assert.equal(progress(-387400, -398400, -376400), 0.5);
  assert.equal(progress(-376400, -398400, -376400), 1);
  assert.equal(progress(-370000, -398400, -376400), 1, "past the bond it stays 1 for display; the hook's latch is separate");
  assert.equal(progress(-400000, -398400, -376400), 0);
  // Token as currency1: the bond tick is below the start and the same ratio holds.
  assert.equal(progress(387400, 398400, 376400), 0.5);
  assert.equal(progress(1, 5, 5), 0, "a zero span is guarded, not divided");
});

/** The position at launch: the whole supply between tickStart and tickBond, price at tickStart. */
function launchPool({ tokenIs0, buyTaxBps = 300, sellTaxBps = 500, snipeBps = 0 }) {
  // $5,000 opening mcap (5e-6 USDC per token) to a $45,000 bond (4.5e-5), both on the 200 grid.
  const tickStart = tokenIs0 ? -398400 : 398400, tickBond = tokenIs0 ? -376400 : 376400;
  const liquidity = liquidityForSupply({ tickStart, tickBond, tokenIs0 });
  return { sqrtPriceX96: sqrtRatioToX96(sqrtRatioAtTick(tickStart)), liquidity, tickStart, tickBond, buyTaxBps, sellTaxBps, snipeBps, tokenIs0 };
}
/** Riemann-sum walk of the marginal price: dq of quote at a time, tokens at the current spot, then
 *  nudge the sqrt price the way constant liquidity says. Nothing here is the closed form. */
function bruteBuy(pool, usdcIn, steps = 200_000) {
  const L = Number(pool.liquidity), taxFrac = combinedTaxBps(pool.buyTaxBps, pool.snipeBps) / 1e4;
  let s = sqrtRatioFromX96(pool.sqrtPriceX96), tokens = 0;
  const dq = (usdcIn * (1 - taxFrac) * 0.99 * 1e6) / steps;
  for (let i = 0; i < steps; i++) {
    if (pool.tokenIs0) { tokens += dq / (s * s); s += dq / L; }               // quote per token is s^2; dy = L ds
    else { tokens += dq * s * s; s = 1 / (1 / s + dq / L); }                // tokens per quote is s^2; dx = L d(1/s)
  }
  return { tokensOut: tokens / 1e18, sqrtAfter: s };
}
function bruteSell(pool, tokensIn, steps = 200_000) {
  const L = Number(pool.liquidity), taxFrac = combinedTaxBps(pool.sellTaxBps, pool.snipeBps) / 1e4;
  let s = sqrtRatioFromX96(pool.sqrtPriceX96), usdc = 0;
  const dt = (tokensIn * 0.99 * 1e18) / steps;
  for (let i = 0; i < steps; i++) {
    if (pool.tokenIs0) { usdc += dt * s * s; s = 1 / (1 / s + dt / L); }
    else { usdc += dt / (s * s); s += dt / L; }
  }
  return { usdcOut: (usdc / 1e6) * (1 - taxFrac), sqrtAfter: s };
}

test("T20: buy and sell quotes match a tiny-step walk of the position to 0.1%, for both currency orders", () => {
  for (const tokenIs0 of [true, false]) {
    const p = launchPool({ tokenIs0 });
    close(priceFromSqrtX96(p.sqrtPriceX96, { tokenIs0 }), 5e-6, 1e-2, `opening price on the 200-tick grid ${tokenIs0}`);
    // A 250 USDC buy at the open: 3% tax, then 1% to the pool, the rest walks the price up.
    const b = quoteBuy(p, 250);
    const bb = bruteBuy(p, 250);
    close(b.tokensOut, bb.tokensOut, 1e-3, `buy tokens ${tokenIs0}`);
    close(sqrtRatioFromX96(b.sqrtPriceAfter), bb.sqrtAfter, 1e-6, `buy price after ${tokenIs0}`);
    assert.equal(b.capped, false); close(b.usdcUsed, 250, 1e-12, "the whole stake is consumed"); close(b.usdcTaxed, 7.5, 1e-9, "3% of 250 to the hook"); close(b.usdcLpFee, 2.425, 1e-9, "1% of the 242.5 that reached the pool");
    assert.ok(b.priceAfter > b.spot && b.avgPrice > b.spot && b.slippage_bps > 0 && b.slippage_bps < 500, `impact ${b.slippage_bps}`);
    close(b.avgPrice, 250 / b.tokensOut, 1e-12, "average price is stake over tokens, taxes in");
    // Selling those tokens straight back from the new price: 1% off the tokens, 5% off the USDC.
    const after = { ...p, sqrtPriceX96: b.sqrtPriceAfter };
    const s = quoteSell(after, b.tokensOut);
    const bs = bruteSell(after, b.tokensOut);
    close(s.usdcOut, bs.usdcOut, 1e-3, `sell usdc ${tokenIs0}`);
    close(sqrtRatioFromX96(s.sqrtPriceAfter), bs.sqrtAfter, 1e-6, `sell price after ${tokenIs0}`);
    assert.equal(s.capped, false, "the sell is smaller than the buy after fees, so it stays inside what the pool took in");
    assert.ok(s.usdcOut > 250 * 0.88 && s.usdcOut < 250 * 0.92, `round trip loses about 3% + 1% + 1% + 5%: ${s.usdcOut}`);
    close(s.usdcTaxed, s.usdcGross * 0.05, 1e-9, "5% of the gross to the hook");
    // The paper router books these as the fill: the price must be net of the tax, the pool's cut in tokens.
    close(s.avgPrice, s.usdcOut / s.tokensUsed, 1e-12, "sell average price is net USDC over tokens accepted, tax out");
    close(s.tokensLpFee, s.tokensUsed * 0.01, 1e-9, "1% of the tokens sent is the pool's fee");
    close(s.tokensUsed, b.tokensOut, 1e-12, "an uncapped sell accepts every token sent");
    assert.ok(s.slippage_bps > 0 && s.priceAfter < s.spot);
    // The snipe tax in the launch block: 3% + 99% caps at 99%, so 250 USDC buys almost nothing.
    const sniped = quoteBuy({ ...p, snipeBps: snipeTaxBps(0) }, 250);
    close(sniped.usdcTaxed, 247.5, 1e-9, "99% withheld"); assert.ok(sniped.tokensOut < b.tokensOut / 50);
    // Zero and nonsense inputs quote nothing rather than NaN.
    assert.equal(quoteBuy(p, 0).tokensOut, 0); assert.equal(quoteSell(p, 0).usdcOut, 0); assert.equal(quoteBuy({ ...p, liquidity: 0 }, 10).tokensOut, 0);
  }
});

test("T20: a buy past the bond tick is capped at the position's edge; a sell past the opening tick is capped there", () => {
  for (const tokenIs0 of [true, false]) {
    const p = launchPool({ tokenIs0, buyTaxBps: 100, sellTaxBps: 100 });
    // Everything the position holds costs exactly the range's USDC: dy = L (sqrtBond - sqrtStart)
    // (or its currency0 twin), grossed up for the pool's 1% and the hook's 1%.
    const a = sqrtRatioAtTick(p.tickStart), b = sqrtRatioAtTick(p.tickBond), L = Number(p.liquidity);
    const rangeUsdc = (tokenIs0 ? L * (b - a) : L * (1 / b - 1 / a)) / 1e6;
    const full = quoteBuy(p, rangeUsdc / 0.99 / 0.99);
    close(full.tokensOut, TOKEN_SUPPLY, 1e-6, `the whole supply sits in the range ${tokenIs0}`);
    close(progress(tickFromSqrtPriceX96(full.sqrtPriceAfter), p.tickStart, p.tickBond), 1, 1e-4, "and the price lands on the bond tick");
    const over = quoteBuy(p, rangeUsdc * 3);
    assert.equal(over.capped, true, "nothing to buy beyond the bond tick");
    close(over.tokensOut, TOKEN_SUPPLY, 1e-6, "capped at the supply");
    close(over.usdcUsed, rangeUsdc / 0.99 / 0.99, 1e-9, "and only the range's worth of USDC is consumed");
    assert.equal(sqrtRatioToX96(sqrtRatioAtTick(p.tickBond)), over.sqrtPriceAfter);
    // Half way up, someone tries to sell more tokens than the pool ever sold.
    const half = quoteBuy(p, rangeUsdc / 2);
    const dump = quoteSell({ ...p, sqrtPriceX96: half.sqrtPriceAfter }, half.tokensOut * 2);
    assert.equal(dump.capped, true, "the pool holds no USDC below the opening tick");
    assert.equal(dump.sqrtPriceAfter, sqrtRatioToX96(sqrtRatioAtTick(p.tickStart)));
    close(dump.usdcGross, (half.usdcUsed * 0.99) * 0.99, 1e-6, "it pays back what it took in, less the 1% the pool kept");
    assert.ok(dump.tokensUsed > half.tokensOut && dump.tokensUsed < half.tokensOut * 1.02, `accepts the bought tokens plus the fee's worth: ${dump.tokensUsed}`);
    // A price outside the position (a stale read below the opening tick) is treated as sitting at its edge.
    const below = quoteBuy({ ...p, sqrtPriceX96: sqrtRatioToX96(sqrtRatioAtTick(tokenIs0 ? p.tickStart - 2000 : p.tickStart + 2000)) }, 250);
    close(below.tokensOut, quoteBuy(p, 250).tokensOut, 1e-12, "same fill as from the opening tick");
  }
});

test("T20: an unknown launch time or leg tax is priced as the worst case, never as free; a swap that moved no tokens is no side", async () => {
  const { snipeTaxBps, combinedTaxBps, classifySwap, SNIPE_TAX_CAP_BPS } = await import("../../src/velocity/venues/arc/chain.mjs");
  assert.equal(snipeTaxBps(undefined), SNIPE_TAX_CAP_BPS); assert.equal(snipeTaxBps(NaN), SNIPE_TAX_CAP_BPS); assert.equal(snipeTaxBps(null), SNIPE_TAX_CAP_BPS);
  assert.equal(snipeTaxBps(0), SNIPE_TAX_CAP_BPS); assert.equal(snipeTaxBps(3_000), 0); assert.equal(snipeTaxBps(1e12), 0);
  assert.equal(combinedTaxBps(null, 0), SNIPE_TAX_CAP_BPS); assert.equal(combinedTaxBps(undefined, 100), SNIPE_TAX_CAP_BPS);
  assert.equal(combinedTaxBps(300, 0), 300); assert.equal(combinedTaxBps(300, 9900), SNIPE_TAX_CAP_BPS); assert.equal(combinedTaxBps(0, 0), 0, "a zero read is a zero, not unknown");
  assert.equal(classifySwap({ amount0: 0n, amount1: -5n }, { tokenIs0: true }).side, null);
  assert.equal(classifySwap({ amount0: 5n, amount1: -5n }, { tokenIs0: true }).side, "buy");
  assert.equal(classifySwap({ amount0: -5n, amount1: 5n }, { tokenIs0: true }).side, "sell");
});
