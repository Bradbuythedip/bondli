// T36: the four different nothings behind "create wallet". The panel drew one Create button for all
// of them -- a genuinely new account, a store that could not be asked, an account whose key is gone,
// and a server that is not allowed to mint keys at all -- so every one of them looked like a button
// that did not work, and the user could not tell which.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRV = fs.readFileSync("src/api/server.production.mjs", "utf8");
const SITE = fs.readFileSync("app/src/Simple.jsx", "utf8");

test("T36: a store that cannot answer is not an absence", () => {
  // The lookup still returns null, because twenty-odd call sites read it as a boolean, but the
  // failure is recorded beside it so the two callers about to act on the absence can tell.
  assert.match(SRV, /catch \(e\) \{ noteWalletStoreError\(userPubkey, "store", e\); return null; \}/);
  assert.match(SRV, /function walletStoreFailed\(userPubkey, withinMs = 30_000\)/);
  // A successful read clears it: one bad minute must not shut the account out for the next thirty.
  assert.match(SRV, /walletStoreErrors\.delete\(userPubkey\); \}\n\s+catch \(e\) \{ noteWalletStoreError\(userPubkey, "sealed", e\)/);
});

test("T36: a record that will not decrypt is not a store outage and not an absence", () => {
  // This is the likeliest shape of the whole bug in production. The record is present and whole; the
  // server cannot open it because WALLET_ENCRYPTION_KEY is missing, was rotated, or was never the key
  // these were sealed with. vault.open throws, the old code caught it beside the Redis error and
  // returned "no wallet", and the account with the money in it was offered a fresh one.
  assert.match(SRV, /catch \(e\) \{ noteWalletStoreError\(userPubkey, "sealed", e\); return null; \}/);
  // It is reported as a key problem, not as a store that needs retrying -- the store answered fine.
  assert.match(SRV, /if \(why\?\.kind === "sealed"\) \{/);
  assert.match(SRV, /keyMissing: true, sealed: true, canCreate: false/);
  assert.match(SRV, /WALLET_ENCRYPTION_KEY is missing or is not the one it was sealed with/);
  // And it is the strongest possible reason not to mint: the record's existence is not in doubt.
  assert.match(SRV, /if \(lookupWhy\?\.kind === "sealed"\) \{[\s\S]*?refusing to replace it/);
});

test("T36: nothing is minted over a wallet the store merely failed to show", () => {
  // This is the money-loss path: a Redis blip reads as "no wallet", a fresh keypair is generated, and
  // the pointer to the funded address is overwritten in the one call a returning user is most likely
  // to make. The old guard caught it only when the user record happened to miss its cache too.
  const create = SRV.slice(SRV.indexOf('app.post("/api/trading-wallet/create"'), SRV.indexOf('app.post("/api/trading-wallet/withdraw"'));
  const guardAt = create.indexOf('if (lookupWhy?.kind === "store")');
  const mintAt = create.indexOf("const kp = Keypair.generate();");
  assert.ok(guardAt > 0, "the create route checks whether the store answered");
  assert.ok(mintAt > guardAt, "and it checks BEFORE generating a key");
  assert.match(create, /not creating a wallet that might already exist/);
  // The pre-existing guards are still there and still ahead of the mint.
  assert.ok(create.indexOf("if (prior?.tradingWallet)") < mintAt);
  assert.ok(create.indexOf("if (!vault.canCreate())") < mintAt);
});

test("T36: the panel is told which nothing it is looking at", () => {
  const get = SRV.slice(SRV.indexOf('app.get("/api/trading-wallet/:wallet", requireOwner'), SRV.indexOf('app.get("/api/trading-wallet/:wallet/debug"'));
  // Store down: a 503 that says so, and explicitly not an offer to create.
  assert.match(get, /unavailable: true, canCreate: false/);
  // Key gone: the address is returned, because the user's money is at it.
  assert.match(get, /tradingWallet: prior\.tradingWallet, keyMissing: true, canCreate: false/);
  // New account: the only case where Create is offered -- and whether the server would honour it is
  // answered now rather than on the click.
  assert.match(get, /return res\.json\(\{ ok: false, tradingWallet: null, canCreate: vault\.canCreate\(\)/);
});

test("T36: the site stops drawing a button that cannot work", () => {
  // The silent catch was the whole bug on this side: any failure -- most often the seven-day
  // signature expiring and the re-sign being dismissed -- left tw null with nothing said, and the
  // panel answered that with an offer to create a wallet the account already had.
  assert.match(SITE, /sWhy\(\{ unavailable: true, canCreate: false, error: e\.message \}\);/);
  assert.doesNotMatch(SITE, /catch \{ sBooted\(true\); \/\* keep the last reading \*\/ \}/);
  // Each state draws its own thing, and only the last one draws the button.
  for (const key of ["panel.keyMissing", "panel.storeDown", "panel.cannotCreate", "panel.retry"]) {
    assert.ok(SITE.includes(`t("${key}")`), `${key} is rendered`);
  }
  assert.match(SITE, /walletWhy\?\.keyMissing \?/);
  // A refusal reloads, so the panel lands in the state the server just described rather than back on
  // the same button with a toast that is about to vanish.
  assert.match(SITE, /finally \{ await loadWallet\(\)\.catch\(\(\) => \{\}\); sBusy\(null\); \} \};/);
});

test("T36: both dictionaries carry the new lines", () => {
  const I18N = fs.readFileSync("app/src/lib/i18n.js", "utf8");
  for (const key of ["panel.keyMissing", "panel.keyMissingWhat", "panel.storeDown", "panel.cannotCreate", "panel.retry"]) {
    assert.equal((I18N.match(new RegExp(`"${key}":`, "g")) || []).length, 2, `${key} in en and zh`);
  }
});

test("T36: a sign-in challenge outlives the instance that issued it", () => {
  // The challenge is issued by one request and redeemed by the next, and the two are not guaranteed
  // to reach the same process: behind one URL there can be more than one instance, and a deploy
  // replaces the one holding the map mid-signature. An in-memory nonce made signing in a coin flip,
  // and the losing side answered "no challenge for this wallet", which a browser cannot act on.
  assert.match(SRV, /async function putNonce\(wallet, ch\)/);
  assert.match(SRV, /redis\.set\("nonce:" \+ wallet, JSON\.stringify\(\{ message: ch\.message, nonce: ch\.nonce \}\), \{ EX: NONCE_TTL_S \}\)/);
  // In memory first, so a box with no Redis behaves exactly as it did.
  assert.match(SRV, /const local = authNonces\.get\(wallet\);\n\s+if \(local\) return local;/);
  assert.match(SRV, /if \(!ch\) return res\.status\(400\)\.json\(\{ error: "that sign-in request expired; asking for a new one", retry: true \}\);/);
  // Redeeming it clears both stores, so one signature cannot be replayed against the other.
  assert.match(SRV, /async function dropNonce\(wallet\) \{\n\s+authNonces\.delete\(wallet\);/);
});

test("T36: the browser starts a stale sign-in over instead of reporting it", () => {
  const CLIENT = fs.readFileSync("app/src/lib/api-client.js", "utf8");
  assert.match(CLIENT, /if \(attempt >= 1 \|\| !\/expired\/i\.test\(e\.message \|\| ""\)\) throw e;/);
  // ...once only: a wallet that will not produce a valid signature must not be asked forever.
  assert.match(CLIENT, /for \(let attempt = 0; ; attempt\+\+\) \{/);
  // And an error carries what the server said, so a caller can tell one refusal from another.
  assert.match(CLIENT, /err\.status = r\.status; err\.body = e;/);
});

test("T36: what sign-in needs from the environment can be asked", () => {
  // A session key that dies with the process, or a second instance that never saw the first's, is the
  // difference between signing in working and working sometimes -- and the only thing that said so
  // was one line in the boot log. No value is ever returned, only whether it is set.
  assert.match(SRV, /app\.get\("\/api\/auth\/health"/);
  assert.match(SRV, /jwtSecret: !!process\.env\.JWT_SECRET,/);
  assert.match(SRV, /walletEncryptionKey: !!process\.env\.WALLET_ENCRYPTION_KEY,/);
  assert.match(SRV, /nonceStore: redis \? "shared" : "memory",/);
  assert.match(SRV, /instance: BOOT_ID,/);
  // The probe must not leak the secrets it reports on: every environment value it touches is read
  // through a double negation, so what leaves the route is a boolean and never a key.
  const at = SRV.indexOf('app.get("/api/auth/health"');
  assert.ok(at > 0);
  const health = SRV.slice(at, SRV.indexOf("});", at) + 3);
  for (const m of health.matchAll(/(!!)?process\.env\.[A-Z_]+/g)) {
    assert.equal(m[1], "!!", `${m[0]} is reported as a value, not as presence`);
  }
});
