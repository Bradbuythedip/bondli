// T8: one trade at a time per wallet.
//
// From a simulation run, during the auto-rug:
//   [700.4s] [VOLUME] stopped after 474 trades
//   [700.6s] [VOL] SELL 23% [mid1] → 0.00636 ETH      <- a volume sell still in flight
//   [700.7s] [AUTO-RUG] mid1 sell failed: insufficient tokens: 6444917.99 < 8423397.08
//   [701.2s] [AUTO-RUG] mid1 sold on retry → 0.01927 ETH
//
// Every trade reads a balance and then acts on it, and four engines drive the same wallets -- the
// volume engine, the dev-sell controller, the fallback sell loop, and the auto-rug, which fires every
// holder at once. Overlapping trades from one address race twice over. In the simulator the second
// reads a balance the first is about to change. On a real chain both are signed against the same
// nonce, so one is replaced or dropped, silently, and it is as likely to be the sell as the buy. A
// rug sell that misses is the one sell with no second chance, because the price it was aiming at is
// the price the other sells have just moved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FleetTrader } from "../../launch/robinhood/lib/fleet.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A venue that records overlap: it notes who is inside a call and screams if two share a wallet. */
function racyVenue({ latencyMs = 12 } = {}) {
  const inside = new Set();
  const overlaps = [];
  const order = [];
  let balances = new Map();
  const enter = (addr, what) => {
    if (inside.has(addr)) overlaps.push(`${what} on ${addr} overlapped another call`);
    inside.add(addr);
  };
  return {
    overlaps, order,
    setBalance: (a, v) => balances.set(a, v),
    async tokenBalance(a) { enter(a, "tokenBalance"); await sleep(latencyMs); inside.delete(a); return balances.get(a) ?? 0n; },
    async ethBalance(a) { enter(a, "ethBalance"); await sleep(latencyMs); inside.delete(a); return 10n ** 18n; },
    async sell(wallet, units) {
      const a = wallet.address;
      enter(a, "sell"); await sleep(latencyMs);
      const held = balances.get(a) ?? 0n;
      inside.delete(a);
      if (units > held) return { ok: false, error: `insufficient tokens: ${held} < ${units}` };
      balances.set(a, held - units);
      order.push(`sell:${a}`);
      return { ok: true, quoteOut: units / 1000n, tokensIn: units, fee: 0n, tax: 0n, hash: "0x" + order.length };
    },
    async buy(wallet, wei) {
      const a = wallet.address;
      enter(a, "buy"); await sleep(latencyMs); inside.delete(a);
      balances.set(a, (balances.get(a) ?? 0n) + wei * 1000n);
      order.push(`buy:${a}`);
      return { ok: true, quoteIn: wei, tokensOut: wei * 1000n, fee: 0n, tax: 0n, hash: "0x" + order.length };
    },
    now: () => Date.now(),
  };
}

function rig(venue) {
  const ft = new FleetTrader(venue, { log: () => {} });
  ft._book = () => {};                       // booking is tested elsewhere; this is about ordering
  const session = { venue, fleetConfig: { slippagePct: 10 }, minTrade: 0, gasReserve: 0, rng: () => 0.5 };
  const wallet = addr => ({ address: addr, role: addr, wallet: { address: addr }, trades: [] });
  return { ft, session, wallet };
}

test("T8: two sells on one wallet do not overlap, and the second sees what the first left", async () => {
  const venue = racyVenue();
  const { ft, session, wallet } = rig(venue);
  const w = wallet("mid1");
  venue.setBalance("mid1", 1000n);

  // The rug and a still-in-flight volume sell, launched together, exactly as rugAll does it.
  const [a, b] = await Promise.all([
    ft._executeSell(session, w, 1, "rug"),
    ft._executeSell(session, w, 0.5, "paint"),
  ]);
  assert.deepEqual(venue.overlaps, [], "no two calls for one wallet were ever inside at once");
  // The distinction that matters. If the full sell ran first the wallet is empty, and "no tokens" is
  // the correct answer -- the second trade sized against what was actually there and found nothing.
  // "insufficient tokens" is the racing failure: a trade sized against a balance that had already
  // been spent. That string is what appeared in the rug log, and it must never appear again.
  for (const r of [a, b]) {
    if (!r.ok) assert.equal(r.error, "no tokens", `a refusal must be an honest one, not "${r.error}"`);
    assert.doesNotMatch(String(r.error || ""), /insufficient tokens/);
  }
  assert.ok(a.ok || b.ok, "at least one sell landed");
  assert.equal(await venue.tokenBalance("mid1"), 0n, "and the wallet ends empty either way round");
});

test("T8: a buy and a sell on one wallet serialise too", async () => {
  // The volume engine buys and then sells the same tokens. Overlap between its buy and another
  // engine's sell is the same nonce collision in the other direction.
  const venue = racyVenue();
  const { ft, session, wallet } = rig(venue);
  const w = wallet("early1");
  venue.setBalance("early1", 500n);
  const r = await Promise.all([
    ft._executeBuy(session, w, 0.001, "paint"),
    ft._executeSell(session, w, 1, "rug"),
    ft._executeBuy(session, w, 0.001, "paint"),
  ]);
  assert.deepEqual(venue.overlaps, []);
  assert.equal(r.filter(x => x.ok).length, 3, "all three landed");
});

test("T8: different wallets still trade at the same time", async () => {
  // The lock must be per address. A fleet that serialises globally is a fleet that cannot cascade,
  // and the cascade is the point: six wallets selling together is what the chart is supposed to show.
  const venue = racyVenue({ latencyMs: 25 });
  const { ft, session, wallet } = rig(venue);
  const ws = ["w1", "w2", "w3", "w4", "w5", "w6"].map(wallet);
  for (const w of ws) venue.setBalance(w.address, 1000n);

  const t0 = Date.now();
  const out = await Promise.all(ws.map(w => ft._executeSell(session, w, 1, "rug")));
  const elapsed = Date.now() - t0;
  assert.deepEqual(venue.overlaps, []);
  assert.equal(out.filter(x => x.ok).length, 6);
  // Serialised across wallets this would be six lots of two 25ms calls, so 300ms. Concurrent it is
  // about 50ms. The bound is loose because timing is timing, but it separates the two designs.
  assert.ok(elapsed < 200, `six wallets sold concurrently in ${elapsed}ms, not one after another`);
});

test("T8: quiescing waits for what stop() left in flight", async () => {
  // volumeEngine.stop() sets a flag. The trade it already started is still going, and every balance
  // the rug reads is wrong until it lands. That is the whole of the original bug.
  const venue = racyVenue({ latencyMs: 30 });
  const { ft, session, wallet } = rig(venue);
  const w = wallet("late2");
  venue.setBalance("late2", 1000n);

  let landed = false;
  const inFlight = ft._executeSell(session, w, 0.5, "paint").then(r => { landed = r.ok; return r; });
  await sleep(5);                                   // the rug arrives mid-trade
  await ft._quiesce(session);
  assert.equal(landed, true, "quiesce returned only after the in-flight sell had actually landed");
  assert.equal(await venue.tokenBalance("late2"), 500n, "and the balance it left is the real one");
  await inFlight;
  // Quiescing an idle session is free and must not hang.
  await ft._quiesce(session);
  await ft._quiesce({ venue });
});

test("T8: a failing trade releases the wallet rather than wedging it", async () => {
  // The lock is held across the send, so a throw inside must not leave the wallet locked forever --
  // that would silently stop every later engine from trading it, including the rug.
  const venue = racyVenue();
  const { ft, session, wallet } = rig(venue);
  const w = wallet("dev");
  venue.setBalance("dev", 100n);
  const boom = { ...venue, sell: async () => { throw new Error("rpc exploded"); } };
  await assert.rejects(() => ft._executeSell({ ...session, venue: boom }, w, 1, "rug"), /rpc exploded/);
  // The very next trade still goes through, and quiesce does not hang.
  const after = await ft._executeSell(session, w, 1, "rug");
  assert.equal(after.ok, true, "the wallet was released by the finally");
  await ft._quiesce(session);
});
