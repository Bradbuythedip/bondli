// PONS on Robinhood Chain: the pure parts (log decoding, curve math) before any RPC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, zeroPadValue } from "ethers";
import { decodeLog, TOPICS, curveBuyQuote, curveSellQuote, mcapQuote, curveProgress, FACTORY, CHAIN_ID, toWei, toEth } from "../../src/velocity/venues/pons/chain.mjs";

const coder = AbiCoder.defaultAbiCoder();
const addr = n => "0x" + n.toString(16).padStart(40, "0");
const topicAddr = a => zeroPadValue(a, 32);

test("T12: factory and curve logs decode to plain records; foreign logs are null", () => {
  assert.equal(CHAIN_ID, 4663);
  const launch = { address: FACTORY, blockNumber: 100, transactionHash: "0xaa", topics: [TOPICS.TokenLaunched, topicAddr(addr(1)), topicAddr(addr(2)), topicAddr(addr(3))], data: coder.encode(["address", "uint256", "uint256"], [addr(0), 7, toWei(4)]) };
  assert.deepEqual(decodeLog(launch), { kind: "launch", token: addr(1), curve: addr(2), deployer: addr(3), pairToken: addr(0), graduationThreshold: 4, block: 100, tx: "0xaa" });
  const buy = { address: addr(2), blockNumber: 101, transactionHash: "0xbb", index: 3, topics: [TOPICS.CurveBuy, topicAddr(addr(9)), topicAddr(addr(9))], data: coder.encode(["uint256", "uint256", "uint256", "uint256"], [toWei(0.05), 12_000_000n * 10n ** 18n, toWei(0.0005), 0]) };
  const b = decodeLog(buy);
  assert.equal(b.kind, "buy"); assert.equal(b.wallet, addr(9)); assert.equal(b.quote, 0.05); assert.equal(b.tokens, 12_000_000); assert.equal(b.fee, 0.0005); assert.equal(b.logIndex, 3);
  const sell = { ...buy, topics: [TOPICS.CurveSell, topicAddr(addr(9)), topicAddr(addr(9))], data: coder.encode(["uint256", "uint256", "uint256", "uint256"], [5_000_000n * 10n ** 18n, toWei(0.02), toWei(0.0002), 0]) };
  const s = decodeLog(sell); assert.equal(s.kind, "sell"); assert.equal(s.tokens, 5_000_000); assert.equal(s.quote, 0.02);
  assert.equal(decodeLog({ topics: ["0x" + "1".repeat(64)], data: "0x" }), null);
  assert.equal(decodeLog({ topics: [TOPICS.CurveBuy], data: "0x" }), null, "malformed data is not a trade");
  assert.equal(toEth(toWei(1.5)), 1.5);
});

test("T12: curve math is constant product with quote-side fees; progress and mcap read off the reserves", () => {
  const r = { quoteReserve: 3, tokenReserve: 1_000_000_000 };
  const b = curveBuyQuote(r, 0.1, 100); // 1% fee: 0.099 spent
  assert.ok(Math.abs(b.tokensOut - (1e9 - (3 * 1e9) / 3.099)) < 1e-3);
  assert.ok(b.slippage_bps > 300 && b.slippage_bps < 340, `${b.slippage_bps}`);
  assert.ok(Math.abs(b.feeQuote - 0.001) < 1e-9);
  const s = curveSellQuote({ quoteReserve: 3.099, tokenReserve: 1e9 - b.tokensOut }, b.tokensOut, 100);
  assert.ok(s.quoteOut > 0.097 && s.quoteOut < 0.099, `round trip loses the two fees: ${s.quoteOut}`);
  assert.equal(mcapQuote(r), 3);
  assert.equal(curveProgress(2, 4), 0.5); assert.equal(curveProgress(9, 4), 1); assert.equal(curveProgress(1, 0), 0);
});

test("T12: the feed turns chain logs into radar-shaped candidates; the snipe-tax window is never a candidate", async () => {
  const { PonsFeed } = await import("../../src/velocity/venues/pons/feed.mjs");
  const coder2 = AbiCoder.defaultAbiCoder();
  let now = 1_800_000_000_000; const clock = () => now;
  const CURVE = addr(0x22), TOKEN = addr(0x11), DEV = addr(0x33);
  const buyLog = (wallet, eth, tokens, blk) => ({ address: CURVE, blockNumber: blk, transactionHash: "0x" + blk.toString(16), index: 0, topics: [TOPICS.CurveBuy, topicAddr(wallet), topicAddr(wallet)], data: coder2.encode(["uint256", "uint256", "uint256", "uint256"], [toWei(eth), BigInt(Math.round(tokens)) * 10n ** 18n, toWei(eth * 0.01), 0]) });
  const sellLog = (wallet, tokens, eth, blk) => ({ address: CURVE, blockNumber: blk, transactionHash: "0xs" + blk.toString(16), index: 1, topics: [TOPICS.CurveSell, topicAddr(wallet), topicAddr(wallet)], data: coder2.encode(["uint256", "uint256", "uint256", "uint256"], [BigInt(Math.round(tokens)) * 10n ** 18n, toWei(eth), toWei(eth * 0.01), 0]) });
  let head = 1000, pending = [], chainReal = 0; // what the curve's getters would answer
  const rpc = {
    blockNumber: async () => head,
    logs: async (f) => { const mine = pending.filter(l => l.blockNumber >= f.fromBlock && l.blockNumber <= f.toBlock && (Array.isArray(f.address) ? f.address.map(a => a.toLowerCase()).includes(l.address.toLowerCase()) : f.address.toLowerCase() === l.address.toLowerCase()) && f.topics[0].includes(l.topics[0])); return mine; },
    curveInfo: async () => ({ quoteReserve: 3 + chainReal, tokenReserve: 1_000_000_000 - chainReal * 1e8, realQuoteReserve: chainReal, feeBps: 100, creatorTaxBps: 0, graduationThreshold: 4, native: true }),
    tokenMeta: async () => ({ name: "Hood Cat", symbol: "HCAT" }),
  };
  const feed = new PonsFeed({ rpc, pollMs: 1000, ethPrice: 2000, clock });
  const events = []; feed.on("event", e => { if (e.kind !== "feed_health") events.push(e); });
  // block 1001: launch + the dev's first buy
  pending.push({ address: FACTORY, blockNumber: 1001, transactionHash: "0xl", topics: [TOPICS.TokenLaunched, topicAddr(TOKEN), topicAddr(CURVE), topicAddr(DEV)], data: coder2.encode(["address", "uint256", "uint256"], [addr(0), 1, toWei(4)]) });
  pending.push(buyLog(DEV, 0.2, 60_000_000, 1001));
  head = 1001; await feed.pollOnce();
  const t = feed.token(TOKEN);
  assert.equal(t.name, "Hood Cat"); assert.equal(t.ticker, "HCAT"); assert.equal(t.devWallet, DEV); assert.equal(t.buys, 1);
  assert.ok(t.mcapUsd > 0, "market cap from the hydrated reserves");
  assert.equal(events.filter(e => e.kind === "candidate").length, 0, "inside the 60s snipe-tax window: not a candidate");
  // 90 seconds later: eight distinct buyers and one sell
  now += 90_000; head = 1010; pending = []; chainReal = 0.6;
  for (let i = 0; i < 8; i++) pending.push(buyLog(addr(0x100 + i), 0.05, 12_000_000, 1005 + (i % 3)));
  pending.push(sellLog(addr(0x100), 5_000_000, 0.02, 1008));
  await feed.pollOnce();
  const c = events.find(e => e.kind === "candidate");
  assert.ok(c, "a candidate after the window");
  assert.equal(c.venue, "pons"); assert.equal(c.id, TOKEN);
  const p = c.payload;
  assert.equal(p.token.buys, 9); assert.equal(p.token.sells, 1); assert.equal(p.token.uniqueBuyers.size, 9);
  assert.equal(p.solPrice, 2000); assert.equal(p.quote, "ETH"); assert.equal(p.curve.address, CURVE);
  assert.ok(p.token._curvePct > 0 && p.token._curvePct < 1, `progress ${p.token._curvePct}`);
  assert.ok(p.scores.apeScore > 0); assert.ok(p.qf.rg_devSellSpeed === 0); assert.ok(p.dynamics.trend);
  assert.ok(p.qf._rg_quickFlipRate > 0, "the buyer who sold inside a minute is a quick flip");
  // the same numbers again do not re-emit; a watched token gets ticks regardless
  const n = events.length; feed.watch(TOKEN); now += 2000; head = 1011; await feed.pollOnce();
  assert.ok(events.filter(e => e.kind === "tick").length >= 1, "a watched token ticks every poll");
  const before = events.filter(e => e.kind === "candidate").length; now += 2000; head = 1012; await feed.pollOnce(); now += 2000; head = 1013; await feed.pollOnce();
  assert.ok(events.filter(e => e.kind === "candidate").length <= before + 1, "same numbers: at most one more decision as the trend settles");
  assert.ok(feed.status().healthy);
});

test("T12: the edge on pons refuses the snipe-tax window and reads the curve's own progress", async () => {
  const { makePumpfunEdge } = await import("../../src/velocity/venues/pumpfun/edge.mjs");
  const { goodCandidatePayload } = await import("./helpers/fixtures.mjs");
  const edge = makePumpfunEdge({ venue: "pons", aggression: 2 });
  assert.equal(edge.venue, "pons");
  const p = goodCandidatePayload("0xabc"); p.token.createdAt = Date.now() - 50_000; p.token._curvePct = 0.3;
  const [c] = edge.ingest({ kind: "candidate", payload: p });
  assert.ok(edge.gates[0].check(c).reasons.includes("TOO_YOUNG"), "50s old: inside the 60s snipe tax");
  p.token.createdAt = Date.now() - 4 * 60_000;
  const [c2] = edge.ingest({ kind: "candidate", payload: p });
  for (const g of edge.gates) { const r = g.check(c2); assert.equal(r.pass, true, `${g.name}: ${JSON.stringify(r.reasons)}`); }
  p.token._curvePct = 0.95; p.token.vSolInBondingCurve = 1; // the venue says 95% even though "vSol" would read as 1%
  const [c3] = edge.ingest({ kind: "candidate", payload: p });
  assert.ok(edge.gates[0].check(c3).reasons.includes("TOO_LATE"));
  assert.equal(edge.estimate(c2, {}).plan_key, c2.tier);
});
