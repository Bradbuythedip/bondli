// T39: the address is the answer; the balances are an attachment to it.
//
// From the field, with the wallet panel offering to create a wallet that already existed:
//   "call": { "ok": true, "result": { "tradingWallet": "4dbu…qfGn", "already": true } }
// The create call SUCCEEDED and said the wallet was already there. So the store was fine, the key
// opened, the session was valid and the right account was connected -- and the page still concluded
// there was no wallet, because the route that REPORTS the wallet computed four chains of balances
// before it would say the address. Rate-limited, that is four attempts at eight seconds with 1s, 2s
// and 4s of backoff between them, then a token scan, then PONS and Arc with no timeout at all. The
// browser gives up at twenty seconds. The request was aborted, the panel saw nothing, and it offered
// to create the wallet the user already had.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRV = fs.readFileSync("src/api/server.production.mjs", "utf8");
const SITE = fs.readFileSync("app/src/Simple.jsx", "utf8");
const route = SRV.slice(SRV.indexOf('app.get("/api/trading-wallet/:wallet", requireOwner'), SRV.indexOf('app.get("/api/trading-wallet/:wallet/debug"'));

test("T39: retrying stops when nobody is left waiting", () => {
  // 8s x 4 attempts + 7s of backoff is thirty-nine seconds of patience on behalf of a caller who
  // waited twenty. Everything after that moment is work thrown into a closed socket.
  assert.match(SRV, /async function rpcRetry\(fn, label = "rpc", maxRetries = 3, deadline = 0\)/);
  assert.match(SRV, /if \(deadline && Date\.now\(\) \+ delay >= deadline\) \{/);
  assert.match(SRV, /got 429 and the caller's deadline is up; not retrying/);
});

test("T39: every leg of the read is on one budget, and it fits inside the browser's", () => {
  const budget = route.match(/const BALANCE_BUDGET_MS = ([0-9_]+);/);
  assert.ok(budget, "the balance work has a budget");
  const ms = Number(budget[1].replace(/_/g, ""));
  // The client's own ceiling is 20s (api-client.js). The budget has to leave room for the rest of
  // the request, not merely be smaller than the timeout by a hair.
  const CLIENT = fs.readFileSync("app/src/lib/api-client.js", "utf8");
  const clientMs = Number(CLIENT.match(/AbortSignal\.timeout\(o\.timeout \|\| (\d+)\)/)[1]);
  assert.equal(clientMs, 20000);
  assert.ok(ms > 0 && ms <= clientMs / 2, `budget ${ms}ms must be well inside the client's ${clientMs}ms`);
  // The Solana leg takes the deadline, so its retries stop with it.
  assert.match(route, /"getBalance:" \+ pubkey\.slice\(0, 8\), 3, deadline\);/);
  // PONS and Arc had no timeout of their own at all -- a hung node held the whole reply.
  assert.match(route, /await within\(Math\.min\(3000, left\(\)\), ponsProvider\.getBalance\(tw\.evmAddress\), null\)/);
  assert.match(route, /await within\(Math\.min\(3000, left\(\)\), arcProvider\.getBalance\(tw\.evmAddress\), null\)/);
  // The token scan is the biggest call and the least urgent: it gets what is left, or it is skipped.
  assert.match(route, /if \(left\(\) <= 0\) throw new Error\("no budget left for the token scan"\);/);
  assert.match(route, /const accts = await within\(left\(\), rpcRetry\(/);
});

test("T39: a balance that did not arrive is said to be unknown, not reported as zero", () => {
  assert.match(route, /const result = \{ ok: true, tradingWallet: pubkey, balancesKnown: !rpcFailed,/);
  assert.match(route, /const staleLegs = \[rpcFailed && "sol", ethFailed && "eth", usdcFailed && "arc"\]/);
  // A partial reading is still never cached as though it were whole.
  assert.match(route, /if \(!rpcFailed && !ethFailed && !usdcFailed\) setCachedBalance\(cacheKey, result\);/);
});

test("T39: the page shows the wallet it has, and a dash where a number is missing", () => {
  // The old line coerced a missing balance to 0 and then rendered it as a confident "0.000 SOL",
  // which is the same shape as an empty wallet and reads as one.
  assert.match(SITE, /const known = r\.balancesKnown !== false;/);
  assert.match(SITE, /solBalance: known \? Number\(r\.solBalance \?\? r\.sol \?\? 0\) : null,/);
  assert.match(SITE, /\{tw\.solBalance == null \? "…" : tw\.solBalance\.toFixed\(3\)\} SOL/);
  // And nothing calls .toFixed on a balance that can now be null.
  for (const m of SITE.matchAll(/tw\.(solBalance|ethBalance|usdcBalance)\.toFixed/g)) {
    const at = m.index, before = SITE.slice(Math.max(0, at - 160), at);
    assert.match(before, /== null \?|!= null/, `${m[0]} is guarded against a missing reading`);
  }
});
