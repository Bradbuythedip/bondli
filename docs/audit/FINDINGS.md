# Audit findings — adversarial fleet, 32 agents, 16 dimensions

Generated from the audit run's journal and kept in the repo because the container it ran on is
ephemeral. Each finding was raised by a specialist agent and then reviewed by a second agent
applying three lenses: is the claim true of the code, is it reachable on the hosted path, and is
the impact honest. Refuted findings are kept at the bottom -- knowing what was checked and
dismissed is worth as much as the list of what was not.

Nothing here is fixed by being written down. Items already dealt with are noted in the git log;
everything else is open.

**109 confirmed** (5 critical, 23 high, 45 medium, 36 low), 17 refuted.

---

## [CRITICAL] Trade and liquidation routes take the victim's wallet from the request body with no auth at all
`src/api/server.production.mjs`:4169

**Claim.** /api/quick-ape (4169), /api/quick-sell (4373), /api/sell-all (4652), /api/emergency-recover (8625), /api/session/sell-sweep (3863) and /api/session/force-recover (4029) all read `wallet` (or `sessionId`+`wallet`) straight out of `req.body`, call `getTradingWallet(wallet)` and then `Keypair.fromSecretKey(bs58.decode(tw.secret))` to sign a transaction. None of them has `requireOwner`, none checks a Bearer token, and there is no global auth or rate-limit middleware (the only `app.use` calls are CORS at 168, express.json at 175, urlencoded at 176, and the error handler at 11211). CORS is `Access-Control-Allow-Origin: *`, so this is callable from any browser page. The comment in src/middleware/wallet-auth.mjs says "the money routes moved to requireOwner" — these six did not.

**How it fails.** Attacker deploys a worthless pump.fun token they control the curve of. They read a victim's Solana address off-chain (or from /api/trader-stats, /api/username, the referral dashboard), then POST {"wallet":"<victim>","ca":"<attacker mint>","solAmount":<victim balance - 0.01>,"slippage":50} to https://bondli.fun/api/quick-ape. The server signs with the victim's custodial key and buys the attacker's token at 50% slippage; the attacker sells into it. The victim's entire trading-wallet balance is gone. The cheaper version is POST /api/sell-all {"wallet":"<victim>"} to force-liquidate every open position of every user in a loop — and unlike withdraw, sell-all does not check velocityHub, so it also sells out from under a running engine.

**Impact.** Full drain of every funded custodial trading wallet on the platform. At ~$25 trade size and typical deposits, this is the total user float.

**Fix.** Put `requireOwner` on all six routes (it is already imported and constructed at line 185), so `req.body.wallet` must equal the JWT's wallet. Then add the `if (velocityHub?.has(wallet)) return res.status(409)` guard that withdraw already has to quick-sell/sell-all/emergency-recover. Given app/src/Simple.jsx calls none of these routes, deleting them is the safer fix.

**Reviewer's correction.** Two claims in the finding are wrong and should be dropped. (a) Only /api/quick-ape is a theft primitive (buy the attacker's mint, attacker sells into it). /api/quick-sell and /api/sell-all leave the proceeds in the victim's own trading wallet -- they are forced liquidation / griefing, not extraction, though sell-all does forcibly flatten a running engine's positions and, unlike withdraw at 3572, has no `velocityHub?.has(wallet)` guard. /api/emergency-recover (8629 `const dest = tw?.pubkey || wallet`), /api/session/sell-sweep (3885) and /api/session/force-recover (4037) all sweep INTO the victim's own trading wallet -- griefing and gas burn, not theft. (b) 'read a victim's Solana address off /api/trader-stats, /api/username, the referral dashboard' is false: all three take a wallet as input and enumerate nothing, and /api/admin/users truncates to 8 chars. The attacker gets addresses on-chain instead (parent wallet -> deposit into trading wallet -> fee transfer to PLATFORM_WALLET is a two-hop walk). Severity stays critical on quick-ape alone.

---

## [CRITICAL] Custodial trading-wallet keys are stored with a 30-day Redis TTL that is never refreshed, and create-on-miss then mints a replacement wallet over the funded one
`src/api/server.production.mjs`:3035

**Claim.** saveTradingWallet writes the sealed keypair as `redis.set("tw:"+userPubkey, ..., { EX: 2592000 })` — a hard 30-day expiry. It is called from exactly three places (3464 one-time EVM backfill, 3566 create, 3688 import); getTradingWallet (3013) reads the key but never rewrites it, so the TTL is 30 days from wallet creation regardless of how actively the user trades. The in-memory `tradingWallets` Map masks this until the process restarts. Two independent paths then destroy access: (a) after the TTL fires and Railway redeploys, getTradingWallet returns null and /api/trading-wallet/create's `if (existing) return already` check at 3560 passes, so it calls `Keypair.generate()` and `saveUser(wallet, { tradingWallet: <new pubkey> })` — silently replacing the funded wallet with an empty one; (b) if Redis is unreachable at boot the module sets `redis = null` permanently (line 236, no reconnect and no later re-check), and saveTradingWallet's writes are wrapped in `try {...} catch {}` (3031, 3035), so a wallet created in that window is RAM-only and returns `{ ok: true }` to the user.

**How it fails.** A user creates a trading wallet on day 0, deposits 2 SOL, runs Velocity, then pauses for a month. On day 30 Redis evicts `tw:<wallet>`. On the next Railway deploy (which happens on every push) the in-memory Map is cleared. The user opens bondli.fun, the UI sees no trading wallet and calls POST /api/trading-wallet/create, and the server generates a brand-new keypair and rewrites `user.tradingWallet`. The old key exists nowhere on the server. The 2 SOL plus any tokens are unrecoverable unless the user personally saved the privateKey the create response showed once on day 0.

**Impact.** Silent, permanent loss of every deposit older than 30 days. This is the single largest expected loss in the subsystem because it needs no attacker — it fires on a calendar.

**Fix.** Drop the TTL on `tw:` and `tkown:` entirely (custodial keys are not cache), or at minimum refresh it inside getTradingWallet on every successful read. Make Redis mandatory when `vault.canCreate()` is true: if `redis` is null, /api/trading-wallet/create must 503 the same way it already does for a missing WALLET_ENCRYPTION_KEY, and saveTradingWallet must throw rather than swallow a failed write. Add a boot-time reconnect/retry instead of latching `redis = null` for the process lifetime.

**Reviewer's correction.** One detail makes path (b) worse than stated: create returns `privateKey: tw.secret` at 3568, but app/src/Simple.jsx:310 discards the response body entirely (`await a.ctw(pk); await loadWallet();`), so the user is never shown the key even once. There is no user-side backup for either path. Severity critical confirmed.

---

## [CRITICAL] /api/quick-ape is unauthenticated: the request body names whose custodial key signs, and the mint it buys
`src/api/server.production.mjs`:4169

**Claim.** POST /api/quick-ape has no auth middleware at all. It reads `wallet`, `ca` and `solAmount` straight from the request body, loads that user's custodial secret with getTradingWallet(wallet), builds a Keypair from it, and signs and broadcasts a buy of the attacker-chosen mint for up to 100 SOL. This is the literal answer to "is there any path where a request body chooses which wallet signs" — yes, with no credential of any kind.

**How it fails.** Attacker deploys their own pump.fun token M with a tiny curve. They read any victim's public wallet address V off-chain or off the leaderboard. They POST {wallet: V, ca: M, solAmount: 5} to https://<api>/api/quick-ape. Line 4177 loads V's trading-wallet record, line 4180 rebuilds V's keypair from tw.secret, lines 4199-4216 build a PumpPortal buy of M for 5 SOL, sign it with V's key and send it. The attacker then dumps their own supply of M into that buy. Repeat until V's balance check at 4185 fails. V's whole trading wallet is drained to the attacker with no signature, no session, no token. Because CORS is Access-Control-Allow-Origin: * (line 169) any web page can also fire this from a third party's browser.

**Impact.** Total loss of every hosted user's trading-wallet balance. At the observed ~$25 typical stake and per-user deposits sized for that, one scripted pass over the user list drains the whole custodial float.

**Fix.** Add requireOwner: app.post("/api/quick-ape", requireOwner, ...). requireOwner already resolves the target from req.body.wallet (src/middleware/wallet-auth.mjs:86) and 403s when it is not the signed-in wallet, so no other change is needed. If the route is dead, delete it — nothing in app/src references it.

**Reviewer's correction.** Accurate as written. Worth adding to the fix note: the same one-line map shows /api/trading-wallet/list/:wallet (3641), /api/positions/:wallet (7510) and /api/trading-wallet/:wallet/debug (3475) are also unguarded but only expose pubkeys/balances/booleans (3479 reports `hasSecret: !!tw?.secret`, not the secret), so they are not in the same class.

---

## [CRITICAL] Three legacy money routes the shipped UI never calls are mounted without requireOwner and spend any named user's custodial wallet
`src/api/server.production.mjs`:4169

**Claim.** /api/quick-ape (4169), /api/quick-sell (4373) and /api/sell-all (4652) are leftovers from the pre-velocity trading direction. None of them is in the shipped frontend (app/src/lib/api-client.js lists exactly 15 endpoints, none of these), and none of them carries the requireOwner guard that the 11 other money routes carry. Each reads `wallet` straight out of req.body, calls getTradingWallet(wallet) to load that user's custodial secret, and signs with it. Commit 827a9ac's message asserts "every money route already went through requireOwner" -- that is false for these three.

**How it fails.** Anyone who knows a bondli user's public key POSTs {"wallet":"<victim>","ca":"<attacker's own pump.fun mint>","solAmount":100} to /api/quick-ape with no credentials. The server loads the victim's trading-wallet secret, buys up to 100 SOL of the attacker's token from the victim's wallet, and the attacker sells into it. /api/sell-all needs only {"wallet":"<victim>"} and liquidates every position they hold.

**Impact.** Unbounded: up to 100 SOL per /api/quick-ape call per user, and the full holdings of any user via /api/sell-all. At the observed ~$25 trade size the per-user float is small, but the route caps at 100 SOL (~$20k) and nothing rate-limits it.

**Fix.** These three routes are dead to the product. Delete them along with the inline PumpPortal blocks they own (4169-4372, 4373-4651, 4652-4750). If the operator still wants a manual buy/sell, mount them behind requireOwner and take the wallet from req.ownerWallet, never from the body.

**Reviewer's correction.** Two evidence details are slightly off and should be fixed before this is filed: api-client.js lists 17 endpoint strings, not 15 (still none of the three); and this is not the complete set of unguarded custodial-key routes — see the 'missed' list.

---

## [CRITICAL] Custodial trading-wallet private keys are stored in Redis with a 30-day TTL that is never refreshed
`src/api/server.production.mjs`:3035

**Claim.** The only durable copy of every user's custodial trading-wallet private key is written with `{ EX: 2592000 }` (30 days) and the TTL is never renewed. `getTradingWallet()` (line 3031-3041) only does `redis.get` — there is no `EXPIRE`/`PERSIST` anywhere in the file (grep for `redis.expire` returns nothing). `saveTradingWallet` is called from exactly three places: create (3566), import (3688) and the one-time EVM back-fill (3464). A wallet created on day 0 and used daily has its Redis record deleted on day 30; the process-memory copy in `tradingWallets` is the only thing keeping it alive, and it dies at the next Railway restart. The same 30-day TTL is on `extra_wallets:` (3635) and on the reverse index `tkown:` (3031).

**How it fails.** A user creates a trading wallet on 1 March, funds it with 0.5 SOL, and leaves the bot running. They never call /api/trading-wallet/export. On 31 March Redis expires `tw:<wallet>`. On 2 April the operator pushes a deploy; Railway restarts the container; `tradingWallets` is empty and `redis.get("tw:...")` returns null. Every route — start, stop, sweep, sell, withdraw — now returns "No trading wallet". The SOL and any open token positions are permanently unrecoverable by the platform and by the user. The failure is silent: the user sees a 400, not an alert.

**Impact.** 100% of every trading wallet's balance whose last write is >30 days before a restart. At the observed ~$25 trade size and a wallet funded to run 4 concurrent positions, ~$100-500 per affected user, unbounded across the user base.

**Fix.** Drop the TTL on `tw:` and `extra_wallets:` entirely (custodial key material is not cache), or at minimum call `redis.expire("tw:"+userPubkey, 2592000)` inside `getTradingWallet` on every successful read. Refuse `/api/trading-wallet/create` when `redis === null` the same way it is refused when the vault key is unset. Remove `--maxmemory-policy allkeys-lru` from deploy/docker-compose.yml:33 or move key material to a `noeviction` database.

**Reviewer's correction.** Two refinements. (1) The `redis === null` compounding angle is weaker than presented — HOSTED_VELOCITY.md §1 lists REDIS_URL as a required Railway variable, and the allkeys-lru eviction is on deploy/docker-compose.yml (the VPS path), not the Railway deployment. Drop those and the finding is unchanged. (2) A stronger fact the audit missed: app/src/Simple.jsx:310 discards the `privateKey` field that POST /api/trading-wallet/create returns at server.production.mjs:3568, so the user is never shown the key unless they separately press "Export key". The failure scenario's "they never call export" is the default behaviour, not an unlucky choice.

---

## [HIGH] /api/session/export-keys hands out custodial private keys to anyone who can name a sessionId, and /api/sessions enumerates the sessionIds
`src/api/server.production.mjs`:4114

**Claim.** POST /api/session/export-keys has no middleware. Its only check is `if (session.userWallet !== wallet) return 403` where `wallet` is a field the caller supplies in the same request body — a self-asserted claim, not proof. It then returns the raw base58 dev secret plus every fleet wallet secret from `fleetkeys:<sessionId>`. The sessionIds needed to call it are handed out by GET /api/sessions?wallet=<addr> (line 4149), which is also unauthenticated and only requires knowing a public Solana address. src/engine/session-manager.mjs listForUser (line 342) strips `devSecret` and `_fleetKeys` but keeps `id`, which is the only thing export-keys needs.

**How it fails.** GET https://bondli.fun/api/sessions?wallet=<victim> returns [{id:"sess_abc",userWallet:"<victim>",...}]. POST https://bondli.fun/api/session/export-keys {"sessionId":"sess_abc","wallet":"<victim>"} returns the dev keypair and all fleet keypairs in plaintext. The attacker now owns those wallets outright — they can drain them at leisure, off-platform, and no server-side revocation exists. The same self-asserted-wallet pattern also makes /api/session/delete (4139) and /api/sessions/clear (4159) callable by anyone.

**Impact.** Permanent, irreversible theft of every launch session's dev and fleet wallets — an attacker only needs a public address to start.

**Fix.** Add `requireOwner` to /api/session/export-keys, /api/session/delete, /api/sessions/clear, /api/sessions, /api/session/sell-sweep and /api/session/force-recover, and change the ownership test from `session.userWallet !== req.body.wallet` to `session.userWallet !== req.ownerWallet` (the JWT-derived value requireOwner sets). Self-asserted `wallet` fields must never be an authorization input.

**Reviewer's correction.** Downgrade critical -> high on reachability, and drop the enumeration step. The /api/sessions Redis half is dead code: src/engine/session-manager.mjs:358 calls `this.redis.scan(cursor, 'MATCH', 'session:sess_*', 'COUNT', 100)` -- ioredis syntax -- against node-redis 4.7.1, which returns `{cursor, keys}`; the array destructure `const [nextCursor, keys] = ...` throws 'is not iterable' and is swallowed by the surrounding try/catch (verified: node throws TypeError on that destructure). So /api/sessions lists only sessions still in the process's in-memory Map, and after any restart it lists nothing. export-keys itself still works for any sessionId because 4117 calls sessionManager.get(), which reads `session:<id>` directly. The defect to report is the authorization pattern (self-asserted req.body.wallet as the ownership test on six routes), not the enumeration chain.

---

## [HIGH] The hosted velocity pump.fun feed goes to zero candidates whenever any legacy auto-trader or sim is running
`src/api/server.production.mjs`:11279

**Claim.** `_scoredAt` is written in exactly one place in the whole 11k-line file — line 11361, inside the 3-second background scorer. That scorer's first statement is `if (autoTraders.size > 0 || liveSims.size > 0) return;`. Meanwhile buildScoredResponse drops any token whose `_scoredAt` is missing or older than 10s (line 8102), and the hosted engine's in-process feed requests exactly that filtered path — src/velocity/venues/pumpfun/feed.mjs:110 `GET /api/radar/scored?min=${this.minScore}&limit=100`, with no `all=1` and no `ca=` list, so both `only` and `all` are falsy and the staleness filter applies. The legacy auto-ape loop that is supposed to take over scoring writes `t._apeScore` (line 6099, and again at 6113) but never writes `t._scoredAt`.

**How it fails.** The operator (or any user) POSTs /api/auto-trade/start, or POSTs /api/sim/start to watch a paper run. Ten seconds later every pump.fun token fails the `_scoredAt` freshness check in buildScoredResponse, so /api/radar/scored returns `count: 0`. The hosted VelocityHub's PumpfunFeed keeps polling every 2s and keeps getting an empty list. No error is logged anywhere, the feed's status still reports healthy, /api/velocity/health still says ok, the gate funnel simply stops counting, and every user's bot silently stops taking pump.fun entries until the auto-trader is stopped. PONS keeps running, which makes it look like a Solana feed problem rather than a scoring one.

**Impact.** Total loss of pump.fun deal flow for every hosted user for as long as a legacy trader runs — no trades, no fees, and no signal that anything is wrong.

**Fix.** Stamp `t._scoredAt = Date.now()` alongside every `t._apeScore = ...` write in the auto-trader loop (6099 and 6113), or better, delete the `if (autoTraders.size > 0 || liveSims.size > 0) return` bail so the background scorer is the single owner of both `_apeScore` and `_scoredAt`. The two scorers producing different-shaped output for the same field is the root cause.

**Reviewer's correction.** The trigger is sharper than the finding says, in the platform's favour for auto-trade and against it for sim. /api/auto-trade/start (6726) IS behind requireOwner, so that half needs a signed-in user. But /api/sim/start (10974) has no middleware at all and derives its id from the caller's IP when no wallet is given (`anon_` + x-real-ip), and nothing ever expires a live sim -- grep of liveSims shows deletion only from stopLiveSim, called from /api/sim/stop and createLiveSim. So one unauthenticated POST from any browser page (CORS is '*') disables pump.fun entries for every hosted user until the process restarts. That is an anonymous remote kill switch on the product's Solana deal flow, not just an operator footgun.

---

## [HIGH] Five more unauthenticated routes sign with another tenant's custodial key (forced liquidation + forced fee)
`src/api/server.production.mjs`:4652

**Claim.** Besides quick-ape, five routes take a wallet from the request and sign with that wallet's custodial secret with no auth: /api/sell-all (4652), /api/quick-sell (4373), /api/session/sell-sweep (3863), /api/session/force-recover (4029), /api/emergency-recover (8625). An anonymous caller can liquidate any user's entire book at a moment of the attacker's choosing, and the profit-skim block then charges the victim a performance fee on the forced sale.

**How it fails.** Attacker POSTs {wallet: <victim>} to /api/sell-all. Line 4656 loads the victim's record, 4659 rebuilds their keypair, 4665-4696 enumerate every SPL and Token-2022 account and market-sell 100% of each through PumpPortal, signed at 4689. Lines 4698-4728 then transfer a skim from the victim's wallet to PLATFORM_WALLET. A competitor (or anyone who wants the token to dump) can force every bondli user out of a position at the exact bottom, repeatedly and for free, and the victim pays a fee for the privilege. /api/quick-sell (4373) does the same for one named mint, which is the precision version of the same attack.

**Impact.** No direct theft (destinations are the victim's own wallets), but unlimited free forced liquidation of every user plus an involuntary performance fee on each. Against the observed book — 40 closes, -$25.81 net, $26.25 in fees — an attacker could reproduce that loss on demand.

**Fix.** Add requireOwner to all five. For the two session routes the existing `session.userWallet !== wallet` line stays but only becomes meaningful once requireOwner has authenticated `wallet`. Consider deleting the ones the UI no longer calls — grep of app/src shows none of these five are referenced by the frontend.

**Reviewer's correction.** Reduce to TWO routes, not five: /api/sell-all (4652) and /api/quick-sell (4373) are anonymous and sign with the victim's custodial key. /api/session/sell-sweep (3863), /api/session/force-recover (4029) and /api/emergency-recover (8625) are also unauthenticated, but they call getTradingWallet only for a destination pubkey (3884, 4037, 8630) and sign with session dev/fleet secrets; none of them skims (emergency-recover passes null profitConfig at 8650). They belong with finding 1 as session-subsystem auth holes, not with the custodial-signing class.

---

## [HIGH] Custodial private keys are stored with a 30-day Redis TTL that is never refreshed, so wallets become unrecoverable
`src/api/server.production.mjs`:3035

**Claim.** saveTradingWallet writes the sealed custodial secret to Redis with { EX: 2592000 } and there are only three call sites, all one-time (create, import-as-primary, and a single EVM backfill). getTradingWallet reads with GET, which does not touch a TTL. Thirty days after a wallet is created the only durable copy of the user's private key is deleted by Redis; the in-memory Map at line 3010 is the last copy and dies on the next deploy.

**How it fails.** A user creates a trading wallet on day 0 (line 3566 writes tw: with a 30-day expiry; line 3464 rewrites it once when the EVM key is backfilled, then never again). They deposit and trade. On day 30 Redis evicts tw:<wallet>. The process still serves them from tradingWallets (3010) so nothing looks wrong. Railway redeploys on day 31; the Map is empty; getTradingWallet (3013-3023) returns undefined; every route answers "No trading wallet". The private key no longer exists anywhere the service can reach, so the user's SOL, their open positions and any velocity engine state for that wallet are permanently unrecoverable unless they happened to have called /api/trading-wallet/export earlier. There is no warning and no backup — data/velocity/users/<wallet> holds the ledger and store but deliberately contains no key (grep of src/velocity/core finds no 'secret' at all).

**Impact.** 100% of the balance of any trading wallet whose owner goes 30 days without creating or importing a wallet. On a service where deposits sit in the custodial wallet between trades, this eventually eats every dormant user's entire deposit.

**Fix.** Persist custodial key material without an expiry — drop { EX: 2592000 } on the tw: and extra_wallets: writes (line 3035, 3635, 3716) — or, at minimum, re-arm the TTL on every successful read in getTradingWallet (redis.expire("tw:"+userPubkey, 2592000) after line 3018). Given these are the keys to user money, no-expiry plus an explicit delete-on-offboard is the right shape; a TTL on a private key is a scheduled loss.

**Reviewer's correction.** Accurate as written, including all three write sites and the read path. One thing to add to the fix: the tkown: reverse index at 3033 carries the same 30-day expiry, so it must be de-TTL'd alongside tw: and extra_wallets:, and this defect compounds with the create-overwrite path I list under missed items — after expiry the UI offers 'create a wallet' and a click permanently seals the loss.

---

## [HIGH] Smart-wallet win rate is 1.0 by construction - resolveOutcome is only ever called with graduated=true, so stats.losses is never incremented anywhere
`src/api/server.production.mjs`:777

**Claim.** smartWallets.resolveOutcome(ca, graduated) (server.production.mjs:765-787) increments stats.wins when graduated is truthy and stats.losses in the else branch at :777. There is exactly one call site in the entire repository - line 1476, inside the 'migration'/'migrate' handler - and it passes the literal true. No path ever calls it with false, so line 777 is unreachable and stats.losses is 0 for every wallet forever. Consequently the win rate computed at :783 and again at :2139 is wins/(wins+0) = exactly 1.0 for every wallet that has ever had one token graduate, the score at :784 becomes min(1, 1*0.6 + min(0.4, avgRet*0.1)) >= 0.6 for every such wallet, and the filter 'if (winRate >= 0.4)' at :2140 admits 100% of them. SmartMoneyTracker inherits the same numbers via syncFromSmartWallets (smart-money-tracker.mjs:137-192): winRate = 1, consistency = min(1, 1.2) = 1, score = 0.40 + up to 0.30 + 0.30 >= 0.70, so every wallet with 5 graduations is tier 's' (:187). Separately SmartMoneyTracker.recordOutcome (smart-money-tracker.mjs:242-250) only stamps token.graduated on recentTokens entries; nothing in that module ever reads that field except a report row at :660, so its own outcome loop is a pure dead write.

**How it fails.** A wallet buys 200 tokens; three graduate and 197 rug. Only the three graduations reach resolveOutcome, so the wallet records wins=3, losses=0, winRate=1.0, score>=0.6, tier 's'. Its next buy makes _holderQuality >= 0.35, which adds +7 to +15 to that token's ape score at :6059. Entries are observed at score 41-44 against a floor of 45 (level 1) / 38 (level 2), so a spurious +7 to +15 is exactly the amount that pushes a marginal token over the floor. The bot buys a token because a wallet with a 1.5% real hit rate is labelled a proven winner.

**Impact.** Up to +15 ape-score points (server.production.mjs:6059) and up to 0.75 of tp_mavenScore (:2119) awarded on a 100%-by-construction win rate. At $25/trade and entries clustered at the score floor, this is the single largest source of false positives feeding the entry gate.

**Fix.** Call resolveOutcome(ca, false) when a tracked token dies - there is already a rug/death signal in the radar (mcapDropPct > 80, or an age-out sweep of stats.activeBuys entries older than N hours). Until then, guard the consumers: require (stats.wins + stats.losses) >= MIN_TRADES with losses actually observed, or replace winRate with wins / stats.buys (buys is incremented on every buy at :758 and is a real denominator). Same for smart-money-tracker.mjs:140.

**Reviewer's correction.** Confirmed as written; keep severity high. Two precisions: the +6..+15 ape-score bonus needs at least one wallet with >=3 graduated buys (server.production.mjs:2138-2142 -> 2154 -> 6058-6060), and the 0.75 term of tp_mavenScore comes from smartMoneyTracker's own score, which inherits the same winRate=1 via syncFromSmartWallets rather than from smartWallets directly. Drop the 'single largest source of false positives' claim — nothing in the code or the logs establishes a ranking against the other bonuses.

---

## [HIGH] SIGTERM stops every engine without flattening and nothing restarts them: each deploy abandons all open positions
`src/api/server.production.mjs`:11205

**Claim.** The shutdown handler calls `velocityHub.stopAll()`, which calls `this.stop(w, { flatten: false })` for every user (hub.mjs:526) — positions are deliberately left open. On the next boot the hub is empty: `this.users` is a fresh `Map` (hub.mjs:143) and there is no code path that reads a persisted running-set and calls `hub.start()`. The engine's exit machinery (ticks, sweeper, STALL, max-hold, crash-exit) only exists inside a running engine, so from SIGTERM until the user personally presses START again, every open position has no stop-loss and no time limit. This is acknowledged in the deploy doc but has no mitigation and no alert.

**How it fails.** A user is holding three positions when the operator pushes a frontend-only change to the backend service. SIGTERM fires, stopAll() returns in milliseconds without selling, the process exits. The user is asleep. The positions sit unmanaged for eight hours. Two rug (the observed crash-exit path is -$1.80 average per close but the tail is a total loss), and nothing sold them because the STALL/max-hold windows that were just hardened only tick inside a live engine.

**Impact.** Unbounded per deploy: the full stake of every open position across all running users, for as long as it takes each user to notice and press START.

**Fix.** Persist the running set (a Redis `velocity:running` set keyed by wallet, written in `start`/`stop`) and re-`start()` those engines on boot from the sealed wallet records — reconcile already adopts what the wallet holds. Until that exists, make stopAll() flatten by default and only skip flattening on an explicit fast-shutdown flag, and send an `alerter` error listing every position left open at shutdown.

**Reviewer's correction.** Keep the finding, tighten two things. (1) It is an explicitly documented gap, not a silent one: deploy/HOSTED_VELOCITY.md §4.5 and §5 both state users must press START after a deploy and name `velocity:running` as the intended fix. (2) The fix suggestion 'make stopAll() flatten by default' is the wrong half — a forced market sell of every position inside Railway's ~30s SIGTERM grace is itself a loss event. The durable fix is the Redis running-set plus re-start() on boot; positions already survive on the volume (engine.mjs:97-110 re-watches and re-arms every open position on start), so restore-on-boot needs no new state beyond the wallet list.

---

## [HIGH] /api/admin/* and /api/launch authenticate against a hard-coded fallback secret that is published in this repo
`src/api/server.production.mjs`:143

**Claim.** `ADMIN_SECRET` falls back to the literal string `"bondli_default"`, and `requireAdmin` (3163-3166) compares the caller's `x-admin-secret` header — or the `?secret=` query parameter — against it. `.env.example` ships `ADMIN_SECRET` commented out (line 121) and states "Unset means no override exists at all, which is the safer default" — which is true of `requireOwner` (185 passes `|| null`) but false of `requireAdmin`. With ADMIN_SECRET unset on Railway, anyone can hit `GET https://<api>/api/admin/users?secret=bondli_default`, whitelist themselves to VIP, or overwrite the site's launch banner. The same string is also the shipped value of `API_SECRET` in .env.example.

**How it fails.** ADMIN_SECRET is not set in Railway (the documented default). An attacker who reads this repo posts `{"address":"0xATTACKER","ticker":"NOTAFLY","status":"live"}` to https://<railway-app>/api/launch with `x-admin-secret: bondli_default`. `launchStore.push` accepts it, `launchLive` is invalidated, and bondli.fun's front-page launch banner now links every visitor's "buy" button at the attacker's contract on Robinhood Chain. Separately they POST /api/admin/whitelist for their own wallet and get VIP for free.

**Impact.** Direct: an attacker-controlled contract address promoted on the site's own launch banner — unbounded user losses plus reputational loss. Indirect: free VIP defeats the paid tier.

**Fix.** Change line 143 to `const ADMIN_SECRET = process.env.ADMIN_SECRET || null;` and make `requireAdmin` return 403 unconditionally when it is null (matching what `makeRequireOwner` already does at wallet-auth.mjs:86). Compare with `crypto.timingSafeEqual`. Drop the `?secret=` query-string form so the secret stops landing in proxy and CDN access logs.

**Reviewer's correction.** Two line-reference fixes and one strengthening. .env.example line numbers are 30 (`API_SECRET=bondli_default`) and 119 (`# ADMIN_SECRET=`), not 24 and 121. Strengthening: deploy/HOSTED_VELOCITY.md §1's Railway variable table omits ADMIN_SECRET entirely, so 'unset in production' is what the repo's own deploy checklist produces, not merely a possibility. Also worth adding to the fix: requireAdmin uses `!==` on a raw string (no crypto.timingSafeEqual) and accepts ?secret= in the query string, which lands the secret in every proxy and CDN access log even when it IS set.

---

## [HIGH] One router call on the engine queue freezes every other position's stop loss (measured: 19.5 s)
`src/velocity/core/engine.mjs`:374

**Claim.** Every feed event, sweep, governor pass and watchdog is chained onto one promise (`enqueue`, engine.mjs:374-376), and `onEvent` awaits both `checkExits` (line 469) and `enter` (line 501) inside that chain. `router.submit` (line 680) and `router.close` (line 817) are multi-second RPC round trips, so while ONE position's buy or sell is in flight, every other position's tick sits unprocessed and its stop loss cannot even be evaluated. Both venues share the same queue, so a PONS sell blocks pump.fun exits.

**How it fails.** Two open positions A and B. A's stop fires; `closePosition(A)` awaits `router.close`. 500 ms later B crashes -83%. B's tick is enqueued behind A's sell and is not evaluated until the sell returns. Measured on the real Engine with a 20 s router: B's stop loss fired 19 517 ms after its crash tick (script at /tmp/claude-0/-home-user/e51cf6f5-3434-5e27-b040-d45f3c708791/scratchpad/hol.mjs, output: `exits: MintA at t+20015ms | MintB at t+20017ms  /  B's stop loss fired 19517 ms after its crash tick`). 20 s is conservative for the real routers: PumpfunLiveRouter.close = _tokenBalanceSettled (5 reads x 400 ms) + _buildSignSend (8 s fetch timeout + confirmTimeoutMs 12 000) + _settle (8 x 400 ms) ~= 25 s; PonsLiveRouter.close = approve (_waitReceipt 25 000 ms) + up to 8 sell chunks x 25 000 ms = up to 225 s (src/velocity/venues/pons/router.mjs:40, 70-77, 246-257). With MAX_CONCURRENT 4 and a market-wide dump the delays compound: position 4 exits ~60 s after its stop.

**Impact.** On the observed book (40 closes, crash-exit 14 = -$25.24, ~$25 stakes) a 20 s blind spot during a pump.fun crash is routinely another 20-40% of the stake: ~$5-10 per blocked crash exit, up to ~$30 per simultaneous multi-position dump. On PONS the window is up to 3.75 minutes.

**Fix.** Keep the queue only for state mutation, not for the network. Give exits their own lane: (a) run `router.submit`/`router.close` OUTSIDE the serialised chain — enqueue only the pre-send bookkeeping (inflight/exiting add + ledger record) and the post-fill booking, with the RPC awaited between them; the `inflight`/`exiting`/`pendingBuys` sets already provide the mutual exclusion the queue was standing in for. Minimum viable version: a second queue per position id, plus a rule that `enter()` never runs while any open position has an unevaluated tick. Also cap the pons chunk loop's total wall-clock budget rather than 8 x confirmTimeoutMs.

**Reviewer's correction.** Real and unmitigated as a design property, but the headline number is synthetic. Corrected statement: while any single router.submit or router.close is in flight on the engine queue, no other position's tick, sweep, governor pass or exit evaluation runs. The pump.fun window is ~2-6 s typical and ~25 s worst (confirmTimeoutMs 12_000, pumpfun/router.mjs:113); the PONS window is genuinely minutes (approve 25 s + up to 8 sell chunks at 25 s each, pons/router.mjs:222-258). Cost per blocked crash exit is ~$1.25-$5.00 on a $25 stake, benchmarked against the operator's observed -7.2% average crash exit, not $5-10. Severity high, not critical.

---

## [HIGH] The ledger is never rotated and is re-read synchronously from disk every 30 s and on every fill
`src/velocity/core/engine.mjs`:129

**Claim.** `seedRouterKnowledge` calls `this.ledger.readAll(...)` (engine.mjs:129), which is `fs.readFileSync` of the whole ledger.jsonl plus `JSON.parse` of every line (ledger.mjs:83-98, 100-104) — fully synchronous, blocking the entire Node process, not just this engine's queue. It runs from `refreshWallet` (engine.mjs:292) at least every `walletRefreshMs` (30 s) per live venue, and `refreshWallet` is also fired off-queue after every live fill and exit (engine.mjs:730, 907). `reconcile()` does four more full scans (engine.mjs:973, 980, 981, 984) plus one per adopted position (991). Nothing ever rotates or truncates the file, and `Ledger._remember` (ledger.mjs:59-62) does an O(n) `splice(0,1)` per record once past `recentLimit` 20 000, making construction quadratic.

**How it fails.** The operator's own funnel is 286 decisions per 10 minutes = ~41 000 decision records/day, ~950 bytes each (they carry `reference` and `features`, pipeline.mjs:73/107) = ~39 MB/day per user, with no rotation. Benchmarked on this machine with exactly that record shape: 50 000 records / 47 MB -> `new Ledger()` 2 043 ms, one `readAll()` 438 ms. 200 000 / 190 MB (day 5) -> boot 17 415 ms, readAll 3 643 ms. 500 000 / 475 MB (day 12) -> boot 46 007 ms, readAll 8 929 ms. So by week two every user's engine stalls the whole process for ~4-9 s every 30 seconds — which is finding #1 applied to every position of every tenant at once — and a Railway restart takes 46 s per user before reconcile even begins, all with real positions open and no exits running. Multi-tenant makes it worse: the stalls are additive across users because they share one thread.

**Impact.** Indirect but large: it converts finding #1 from a per-trade event into a permanent 4-9 s-every-30-s blind spot across all positions of all users, and makes a restart a ~1 minute unmanaged window. At $25 stakes and 4 concurrent positions that is the whole book unhedged.

**Fix.** Three separate changes. (1) Cache the instrument set: `seedRouterKnowledge` should keep an in-memory `Set` seeded once at boot and appended to by `enter()`/`_openPosition`, never re-scanned per refresh. (2) Rotate the ledger — daily files, or a `decisions.jsonl` split from the money records so REJECT spam never sits in the file that reconcile scans; reconcile only needs fill/exit/order/decision-for-open-positions. (3) Replace the `recent` array with a ring buffer so `_remember` is O(1) and boot is linear.

**Reviewer's correction.** Confirmed, with the recurring-stall scope corrected. seedRouterKnowledge returns 0 immediately for pump.fun (engine.mjs:126; PumpfunLiveRouter has no track()), so the every-30-s and per-fill full-file scan at engine.mjs:129 only affects users who opted into PONS. What hits everyone is the synchronous `new Ledger()` at engine.mjs:54 on every Start (independently measured: 2.2 s at 50k records / 48 MB, 17.3 s at 200k / 192 MB — day 5 at 39 MB/day) plus reconcile's three unconditional readAll scans at engine.mjs:980/981/984. Record size 957 bytes confirmed. The quadratic boot is the splice at ledger.mjs:61. Severity high, not critical.

---

## [HIGH] SIGKILL during a sell books the full stake as a 100% loss; reconcile never checks findRecentSale
`src/velocity/core/engine.mjs`:1017

**Claim.** Unlike the buy path, `_closePosition` writes NOTHING to the ledger before `router.close` (engine.mjs:817) — no signature, no 'exit sent' record. `pendingExit` is only stored after the router has already returned UNCONFIRMED (engine.mjs:822). So a crash anywhere in the 12-25 s sell window leaves zero on-disk evidence that a sell was attempted. On restart reconcile finds the position in the store, gone from the venue, and with no `pendingExit` falls straight through to MISSING_AT_VENUE, booking `pnl = proceeds(0) - cost` (engine.mjs:1016-1020). The `findRecentSale` recovery that was added for `finalizeFlat` (engine.mjs:832) is not wired into this sibling path, and `PonsLiveRouter` has no `findRecentSale` at all, so on PONS neither path can recover.

**How it fails.** A $25 position's stop fires; the sell confirms on chain and the SOL is in the wallet; Railway SIGKILLs before `_bookExit` runs. On restart: position open in state.json, mint absent from `router.positions()`, `p.pendingExit` undefined -> MISSING_AT_VENUE with `pnl_usd: -25`. Consequences: `day.realizedUsd` is reduced by $25 that was never lost (line 1019), which can trip the daily loss limit and halt the account for the rest of the day; an `outcome` record with -100% and the position's real tier/features feeds `modeStats()` and the EV gate, which can shut the tier off; and `truePnl()` shows the wallet holding SOL the ledger says was lost. The same path fires whenever a user sells by hand on pump.fun while the bot is stopped. Its sibling has already cost real money once in the operator's log: `"max hold: flat at venue" 1 = -$25.62`.

**Impact.** The full stake per event: $25 booked as a phantom loss, plus the knock-on of a false daily-loss trip (the whole day's trading) and a tier being closed by the EV gate on fabricated data.

**Fix.** (1) Write the sell's intent before sending it: append `{kind:"exit", stage:"sent", positionId, instrument, pct, reason}` and persist `p.pendingExit = { at: now }` before `await router.close`, mirroring what `enter()` already does at line 678. (2) In reconcile's `inStore` loop, before booking MISSING_AT_VENUE, call `router.findRecentSale(inst, { since: p.entryTime })` exactly as `_closePosition` does at line 832 and book the recovered proceeds. (3) Implement `findRecentSale` on PonsLiveRouter (scan the token's Transfer logs out of `this.address` since `entryTime`, which `rpc.transfersTo` already almost does).

**Reviewer's correction.** No correction needed — the finding stands as written. Worth promoting one detail it buries: the most reachable trigger is not a SIGKILL at all but a user selling by hand on pump.fun while the bot is stopped, since engine.mjs:65 makes the persisted live venue mode win on restart and reconcile then books MISSING_AT_VENUE = -cost at engine.mjs:1016-1020 before any tick arrives, with no findRecentSale attempt on that path.

---

## [FIXED] Every closed trade books the $0.41 token-account rent as a loss; the reclaim is written to the ledger and read by nothing
`src/velocity/core/engine.mjs`:881

**Claim.** A live buy's cost_usd is the full wallet outflow, which includes RENT_ATA_SOL (0.00203928 SOL = $0.41 at SOL $200). The sell's proceeds_usd does not contain the rent, because the rent is only returned later by a separate closeTokenAccount transaction. reclaimRent() is called at engine.mjs:881, AFTER pnl is computed at engine.mjs:879, is deliberately not awaited, and appends kind:"rent" — a record type that ledger.mjs:14 describes as "real money, returned to the wallet" and that no accounting path anywhere reads. So every closed position is booked $0.41 worse than the wallet actually is, and those pnl_usd values are exactly what statsFromOutcomes turns into p_win / payoff / loss_fraction for the EV gate and the Kelly sizer, what day.realizedUsd feeds to the governor and the daily loss budget, and what the UI shows as closed P&L.

**How it fails.** 40 live closes at ~$25 each. Each pays $0.4079 of ATA rent into cost_usd; each reclaim returns it to the wallet but is never credited to pnl_usd. Reported window P&L -$25.81; $16.32 of that (63%) is rent that is sitting back in the wallet. The tier's realized loss_fraction is inflated by 1.63% of stake and its p_win is depressed (a trade that netted +$0.30 books as -$0.11), so the EV gate is fed a strategy strictly worse than the one being run — and at the $10 MIN_STAKE_FLOOR the distortion is 4.08% of stake, larger than the entire modelled round trip.

**Impact.** $0.41 per closed trade of phantom loss in every statistic and in the UI; $16.32 of the observed -$25.81 window. Ongoing 1.6% of stake at $25, 4.1% at the $10 floor.

**Fix.** Either (a) subtract RENT_ATA_SOL * solPrice from cost_usd at entry (engine.mjs:717) and book a separate loss only if closeTokenAccount fails, or (b) make finalizeFlat/close await nothing but have reclaimRent's .then() append the reclaimed USD to the position's proceeds_usd and to store.state.day.realizedUsd, and emit a corrected outcome. Option (a) is simpler and matches what edge.mjs:67 already assumes ("The rent itself nets out because it is reclaimed").

**Fixed.** Option (a), as recommended. The router reports the deposit apart from the trade on the buy
fill (`rent_usd`), it is excluded from `cost_usd` and from `fee_usd`, and the position remembers it.
The reclaim no longer credits the day, because nothing was ever charged for it; a reclaim that FAILS
books the deposit as a loss against the day it was lost in, leaving the closed trade's own statistics
alone. So `outcome.pnl_usd` is now what the wallet did, which is what statsFromOutcomes, the EV gate
and the Kelly sizer read. Covered by two cases in tests/velocity/t10-live-path.

**Reviewer's correction.** Two corrections. (1) Severity is high, not critical: no user funds are lost — the rent really does come back, and both the wallet-derived bankroll (engine.mjs:620 freeUsd) and the header "since start" P&L (truePnl, engine.mjs:255-283) read the wallet and are therefore correct. What is corrupted is outcome.pnl_usd, day.realizedUsd, review(), the tier statistics, the EV gate, the Kelly inputs and every governor throttle/halt. (2) The $16.32 = 63%-of-the-window figure assumes all 40 closes were live pump.fun closes on a fresh ATA whose reclaim landed; PONS closes carry no ATA rent, and a mint already holding an open ATA (hasAccount) pays none, so treat $16.32 as an upper bound on that window. Also worth stating in the writeup: fill.fee_usd on the buy = (costSol - solAmount)*price likewise contains the rent, so review()'s fees_usd overstates fees by the same $0.41/trade — the operator's "$26.25 fees over 40 trades" ($0.66/trade) is only reachable with the rent inside it.

---

## [HIGH] The sweeper's DOA branch swallows the sweeper's STALL branch, and the only test that covers either uses a position with no ticks at all, so it cannot tell them apart
`src/velocity/core/engine.mjs`:354

**Claim.** engine.mjs:354 fires DOA whenever `age >= doa_ms && quiet >= doa_ms`, where `quiet = now - (p.lastTickAt || p.entryTime)` — silence since the LAST TICK, with no upper age bound. The tick-side DOA it claims to be the "strongest form" of is bounded (`exits.mjs:118`: `held >= plan.doa_ms && held < (plan.stall_ms ?? Infinity)`) and additionally requires `joined <= 1 && |chg| <= band && peakPct < band`. The sweeper requires only `!armed`. Consequence: (a) for tier 3 (doa 12s, tickSilence 15s) `quiet > 15_000` always implies `quiet >= 12_000`, so the STALL branch at engine.mjs:358-359 is unreachable — dead code on the tier the operator says is "almost all" entries; (b) any tier-3 position with a 12-second gap in its trade feed is flattened at any age and booked as "DOA", with the detail string "no trade since the fill" (engine.mjs:355) which is factually false. The test written alongside this code (t10-live-path.test.mjs:364-370) opens a position that never ticks at all, so `lastTickAt` is undefined and `quiet` falls back to `entryTime` — the fixture cannot distinguish the comment's intent from what the code does; the only other case (t10:373-380) is an ARMED position asserted NOT to be swept.

**How it fails.** A tier-3 position (plans.mjs:23, doa_ms 12s, stall_ms 120s, stall_band_pct 8) is filled, trades normally for 30 seconds and reaches +11% — below `armed` (band*1.5 = 12%), so no trail. The mint then goes 13 seconds without a trade, which is normal for a token the STALL rule itself would tolerate (`recentBuys <= 2` per minute, exits.mjs:142, i.e. gaps up to ~30s). The next sweep flattens it and writes reason "DOA", detail "30s, no trade since the fill". The suite passes.

**Impact.** Each spurious cut pays the full round trip (~3.5% of a $25 stake, ~$0.88) and forfeits the position. The two ride-trail closes in the operator's window were +$20.85 of the +$23.81 total — those are exactly the positions this cuts before their peak arms. Also corrupts the exit-reason breakdown the operator tunes on and the `reason` field on every outcome record the learner reads.

**Fix.** Bound the sweeper's DOA the way the tick-side one is bounded and make it mean what its comment says: require no tick at all since the fill (`!p.lastTickAt`) plus `age < (p.plan.stall_ms ?? Infinity)`, and let the STALL branch own everything older. Then add the test that is missing: a position with `lastTickAt` set that has gone quiet, asserted to leave as STALL (with `by: "timer"`), plus a tier-3 case asserting a position that has ticked is NOT cut as DOA. Both of the current sweeper assertions (t10:364-370, 373-380) survive unchanged.

**Reviewer's correction.** Two honest narrowings. (1) The dead-code half applies only where doa_ms <= tickSilenceMs — tier 3 and revival. Tiers 1 and 2 keep a live STALL window (quiet in 15-20s / 15-30s), which my probes B and E confirm, so it is not globally dead. (2) The behavioural change versus the pre-302f36c code is confined to age in [doa_ms, stall_ms) — 12s to 2min on tier 3 — because past stall_ms the STALL branch would have fired on the same silence anyway; beyond that window the defect is the label, not the cut. The impact estimate is also softer than claimed: DOA/STALL now set retryCooldownMs = 45s (engine.mjs:46), not the 5-minute reentryCooldownMs, so a wrongly cut mint can be re-entered in 45s for the price of one more round trip (~3.5% of $25 = ~$0.88). Attributing the +$20.85 of ride-trail profit to positions this would have killed is speculation the code cannot support — those closes are ride-trail exits, which by definition armed (peak >= band*1.5) and are therefore exempt at engine.mjs:346. Severity high, not critical: this is premature-exit plus stat corruption on the dominant tier, not loss of funds. The test claim is correct — t10:364-370 opens via onEvent and delivers no ticks, so lastTickAt is undefined and quiet falls back to entryTime; the fixture cannot separate 'never ticked' from 'ticked 13s ago'.

---

## [HIGH] The just-added "check the chain before booking a 100% loss" recovery is pump.fun-only; PONS has no findRecentSale and no test covers it
`src/velocity/core/engine.mjs`:832

**Claim.** engine.mjs:832 guards the recovery with `router.findRecentSale ? await router.findRecentSale(...) : null`. `PumpfunLiveRouter` implements it (pumpfun/router.mjs:249); `PonsLiveRouter` does not — the method is `undefined`. So on Robinhood Chain, a `NO_POSITION` from `pons/router.mjs` (returned at close() when `balUnits === 0`) falls straight through to `finalizeFlat` (engine.mjs:858) and books the whole cost as a loss, which is the exact defect that was just fixed for pump.fun. The test for the fix (t10:262-283) uses a pump.fun `FakeLive` with `findRecentSale` bolted on at t10:264, so the pons shape — a router without the method — is exercised only in the negative test ("Rugged"), where booking the loss is the correct answer. Nothing in the suite shows that a real PONS position takes the phantom loss.

**How it fails.** A user sells a Robinhood Chain position by hand in the PONS UI (the operator's log shows 16 "user sell" closes). The next exit attempt gets `NO_POSITION`; a sweepRetryMs later engine.mjs:840 calls `finalizeFlat`, which books `notional_usd: 0` and a loss of the full `cost_usd` — even though the ETH from the sale is sitting in the trading wallet. That number then drives `store.state.day.realizedUsd`, the daily loss limit, the governor and the learner. The operator's own log already contains one such row: "max hold: flat at venue 1 = -$25.62".

**Fix.** Implement `findRecentSale(token, { since })` on PonsLiveRouter using the CurveSell logs it already decodes (`decodeLog`, `TOPICS.CurveSell`, `_receiptDeltas`), and add a test that mirrors t10:262-283 for pons: a wallet holding none of the token, a CurveSell log after `entryTime`, asserting the outcome is `:RECOVERED` with real proceeds rather than `:FLAT_AT_VENUE` at -cost. Until then, refuse to finalizeFlat on any venue whose router lacks the method, rather than booking the loss.

**Reviewer's correction.** One overreach to strike: the operator's ledger row 'max hold: flat at venue 1 = -$25.62' is presented as evidence that PONS already took this loss. Nothing in the repo ties that row to a venue, and it predates the pump.fun fix, so it is at least as likely a pump.fun close. Keep the finding, drop that attribution. Also state the exposure precisely: the pons router DOES resolve the in-flight case it can — position.pendingExit is settled at pons/router.mjs:207-209 — so what is unrecoverable is specifically a sale the engine holds no signature for (a manual sell in the PONS UI, or a signature lost across a restart), not a timed-out sell of its own. Severity high stands.

---

## [HIGH] costs.fraction is subtracted even when the estimate came from realized outcomes that are already net of every cost, charging the round trip twice
`src/velocity/core/pipeline.mjs`:105

**Claim.** When a tier has >=30 outcomes, edge.estimate returns p_win, payoff and loss_fraction computed by statsFromOutcomes from pnl_usd/stake_usd — and pnl_usd is proceeds_usd - cost_usd, i.e. already net of the curve fee, the portal fee, the priority fees, the realized slippage and the rent. For those numbers, `edgeR * lossFraction` is algebraically identical to the realized net expectancy (p*avgWin - q*avgLoss = pnlSum/n = stats.expectancy). Line 105 then subtracts costs.fraction from it a second time. The same expression is correct for priors (which are price-denominated targets) and wrong for stats, and nothing distinguishes the two cases even though est.on_priors is right there.

**How it fails.** A tier whose measured, fully-netted performance is +0.95% per trade — a real, profitable strategy — is scored EV = -3.4% and refused. The hurdle is not "expectancy > 0" but "expectancy > 3.9-4.4%", i.e. the tier must beat its own costs twice over. Any tier operating in the 0 to +4% net expectancy band is shut off permanently; that band is where a memecoin scalper with a 3% fee load actually lives. This is a plausible share of the 88 "no edge" rejections in the funnel.

**Impact.** Refuses any measured strategy netting between 0 and ~4% per trade. Over a 40-trade window at $25 that is up to $39 of realized profit turned away.

**Fix.** In pipeline.mjs:105, charge costs only against a price-denominated estimate: `const ev = est.on_priors ? expectedValue({...,costs: costs.fraction}) : expectedValue({...,costs: 0})`, or better, have edge.estimate flag whether its numbers are gross-of-cost and let expectedValue decide. Keep costs.fraction in the record either way so the operator can see it.

**Reviewer's correction.** Keep at high; tighten two things. The stated money impact ('up to $39 over 40 trades at $25') is the top of the band, not a typical loss — the honest statement is that any tier whose measured net expectancy sits in (0, ~4.4%) is permanently shut off. Also note the compounding with finding 0: the pnl_usd feeding stats is already $0.41/trade too negative, so the measured expectancy the gate then double-charges is itself depressed by another 1.6% of stake.

---

## [HIGH] hub.start() is check-then-act: two concurrent starts create two live engines on one wallet, one of them unstoppable
`src/velocity/hub.mjs`:170

**Claim.** `if (this.users.has(wallet)) return {...already:true}` is at hub.mjs:170 and `this.users.set(wallet, ...)` is at hub.mjs:206. Between them the code awaits `engine.start()` (which runs a full `reconcile()` with router RPCs) and `engine.setVenueMode("pumpfun","live")` (router `init()` + `health()` + `preflight()`), plus the same again for pons. Two requests that arrive inside that multi-second window both pass the guard and both build an `Engine` on the same `dataDir`, the same keypair, and the same `SharedFeedView` source.

**How it fails.** The client's start call has a 90 s timeout (app/src/lib/api-client.js:47). On a slow RPC day `router.init()`/`health()` exceeds it; the browser shows an error but express does NOT abort the handler; the user presses Start again (or has a second tab open). Now: two `Store` objects on one state.json, each with its own in-memory `state`, so whichever saves last silently erases the other's positions — and a position erased from state.json but still held on chain comes back through reconcile as an entryMark-0 position with no exit rules (finding #3). Two `Ledger` objects with independent `seq` counters append to one file, so `trail()` and `orderStage()` return the wrong records. `max_concurrent_positions: 4` becomes 8 and `daily_loss_limit_usd` doubles, because the caps are enforced per engine. Both engines judge the same candidate and both buy the same mint (`cannotEnter` is per-engine state). Worst: only one engine ends up in `this.users`, so `hub.stop`, `hub.pause` and `hub.halt` reach that one — the other keeps trading the user's wallet forever, with no route in the API to stop it short of a process restart.

**Fix.** Reserve the slot synchronously before any await: insert a placeholder (`this.users.set(wallet, { starting: true })` or a `this._starting = new Map()` of in-flight promises) immediately after the `has` check, have concurrent callers await that same promise, and delete the reservation in a `finally` if start fails. Belt and braces: take an exclusive lock file in `dataDir` in the Engine constructor so two Engines can never share a store.

**Reviewer's correction.** No correction needed. One reinforcement the finding misses: the check-then-act window is not only the router RPCs — `new Engine()` at hub.mjs:181 synchronously constructs a Ledger that reads the whole ledger.jsonl (measured 17 s at 200k records), so on an established account the gap between the guard at hub.mjs:170 and the claim at hub.mjs:206 is tens of seconds of wall clock with real yield points throughout.

---

## [HIGH] The wallet sweep sells off the engine queue and never halts entries, so the bot keeps buying while the user is emptying the wallet
`src/velocity/hub.mjs`:480

**Claim.** `sweepWallet` step 1 closes open positions through `engine.enqueue` (hub.mjs:467), but step 2 sells everything else with `solRouter.close(...)` / `ethRouter.close(...)` called directly — off the queue, on the SAME live router the engine is using (hub.mjs:480, 500). Nothing in the whole function sets a halt, so the engine's gates, sizer and `enter()` keep running for the entire sweep, which the code itself says can be 'sixty tokens sold one by one' (hub.mjs:305-306) and is deliberately run as a background job because it outlives an HTTP request.

**How it fails.** User presses 'Sweep wallet'. Step 1 snapshots `openPositions()` at hub.mjs:467 and sells those; that takes minutes. During those minutes the engine buys a new mint with the SOL the sweep just freed. Two outcomes, both bad. (a) The new mint is not in step 1's snapshot, so step 2 sells it at hub.mjs:480 straight through the router: the ledger and the store never see the sale, the position stays `status:"open"` with `proceeds_usd: 0`, and the next tick's `closePosition` gets NO_POSITION -> `flatSeenAt` -> `finalizeFlat` books the whole cost as a loss (on PONS `findRecentSale` does not exist, so it is unrecoverable). (b) `solRouter.positions()` is read before that buy, so the mint is missed entirely and the user is told the wallet is swept when it is not. Step 2 also bypasses the `this.exiting` guard (engine.mjs:794), which only wraps `engine.closePosition` — so a tick-driven exit on the queue and the sweep can send two real sells for the same tokens; the loser gets NO_POSITION and the position is booked flat.

**Impact.** A position sold outside the ledger is later booked at its full cost ($25 per occurrence, unrecoverable on PONS), and the user who asked to be flat is left holding tokens the bot bought after they pressed the button.

**Fix.** Halt first: `await u.engine.enqueue(() => u.engine.halt("freeze", "wallet sweep", { by: "user" }))` at the top of `sweepWallet`, and resume (or leave frozen) at the end. Re-read `openPositions()` after step 2 rather than trusting the pre-sweep snapshot. Route step 2's router sells through `engine.enqueue` too, and check `engine.exiting` / `engine.inflight` for the instrument before selling it straight through the router.

**Reviewer's correction.** Confirmed with one correction: on pump.fun a position sold out from under the engine by step 2 is NOT booked as a total loss any more — engine.mjs:830-841 calls findRecentSale before finalizeFlat and the sweep's own sell is exactly the outgoing ATA transfer it looks for, so the proceeds are recovered. The unrecoverable-$25 case applies only to PONS, where PonsLiveRouter has no findRecentSale. Everything else stands: no halt anywhere in sweepWallet (hub.mjs:458-521), step 2 sells off-queue on the engine's own live router (hub.mjs:480, 500), and the pre-sweep openPositions snapshot at hub.mjs:467 is never re-read, so the user is told the wallet is swept while holding mints the bot bought during the sweep.

---

## [HIGH] A graduated PONS token can never be sold by the bot and never leaves the position book, so it holds a concurrency slot forever
`src/velocity/venues/pons/router.mjs`:210

**Claim.** close() hard-refuses a graduated curve (:210) and there is no pool sell path anywhere: MEME_HOOK (the graduated Uniswap V4 pool hook, chain.mjs:13) is exported and never referenced by any file. The engine only ever force-closes a position on NO_POSITION via finalizeFlat (engine.mjs:813-828); every other failure code just sets p.lastExitError and leaves the position open (engine.mjs:832-836). So a GRADUATED refusal is retried forever and the position permanently consumes one of max_concurrent (default 4 per user) and its share of portfolio_max_exposure_usd. The two timer exits that could otherwise retire it are also disabled: they require tick silence (`quiet > tickSilenceMs`, engine.mjs:333 and :345), and the feed keeps ticking the token because _remark only refreshes mcapUsd while both reserves are positive (feed.mjs:240) — a drained or unreadable curve leaves the old mcap in place, so markPosition keeps stamping lastTickAt (exits.mjs:65) at a frozen price.

**How it fails.** A PONS winner fills its curve and graduates while the bot holds it (or graduates while the process is restarting, so the feed never sees CurveCompleted and t.graduated stays false, which also skips the 85% pre-graduation exit at exits.mjs:105). From then on: mark frozen -> stop loss and ride-trail never trigger; ticks keep arriving -> sweeper MAX_HOLD and STALL never trigger; the tick-driven MAX_HOLD_TIME does fire -> close() -> GRADUATED -> position stays open. Repeat across a session and max_concurrent is exhausted; the log's "no size MAX_CONCURRENT" is what that looks like from the sizer's side.

**Impact.** Not a direct loss, but it stops the bot trading: 4 stuck positions is the whole default concurrency budget, and the operator reports ~60 that would not sell.

**Fix.** Two parts. (a) Stop the bleed: when close() returns a terminal code (GRADUATED, NO_CURVE), have the engine retire the position from the risk book — book it at its last mark as an UNSELLABLE outcome, release the slot and the exposure, alert the operator, and keep the tokens listed in the holdings view for a manual sale. (b) Stop the trap: in feed._remark, when a hydrate comes back with zero or unreadable reserves, null the mark and set a `_stale` flag instead of holding the last mcap, so the silence-based sweeper can see the token as dead.

**Reviewer's correction.** Confirmed, with three corrections. (a) Line numbers are stale: the GRADUATED refusal is router.mjs:217 (not :210); the NO_POSITION-only retirement path is engine.mjs:826-841 (not :813-828); the two silence-gated sweeper exits are engine.mjs:336 (MAX_HOLD) and :358 (STALL), plus a DOA at :352 the finding missed; the pre-graduation exit is exits.mjs:106 (not :105). (b) The slot cost is worse than stated and cross-venue: src/velocity/core/risk.mjs:135 `if (open.length >= env.max_concurrent_positions) return zero("MAX_CONCURRENT")` counts ALL live open positions, and engine.mjs:594-601 builds that list from store.openPositions() filtered only on paper — so one stuck PONS position also blocks pump.fun entries, which is exactly the 'no size MAX_CONCURRENT' the operator sees. (c) The '~60 that would not sell' evidence should be dropped: commit 0d49aad attributes those sixty to the part-fill bug ('sixty of them, at one point, that the sweep could not close because nothing thought they were open'), not to graduation. Also worth stating: the trap is partially mitigated by the 85% pre-graduation exit at exits.mjs:106, so it needs a curve that crosses 85%->complete inside one 3s poll, or a restart that misses CurveCompleted.

---

## [HIGH] A PONS exit that keeps failing is retried on every 3s tick with ~19 RPC calls and an uncached explorer fetch, on the engine's single serial queue
`src/velocity/venues/pons/router.mjs`:167

**Claim.** checkExits calls closePosition on every tick with no rate limit (engine.mjs:751-769) — unlike sweep, which gates each position behind `due()`/sweepRetryMs (engine.mjs:309) — and the exit rules do not latch, so an under-water position re-fires SL2 on every tick (exit-plan.js:101). Each attempt costs: balanceOf (1), _curveNow (4), allowance (1), _sellShape's ladder of up to 4 fractions x 3 keeps = 12 sequential eth_call dry runs (router.mjs:149-156), readyToGraduate (1), plus _explainRevert's HTTPS call to Blockscout with a 6s timeout. That explorer result is cached only on success: `this._abis.set(key, ...)` is inside the try and after the fetch, so a 404 (unverified contract) or a timeout throws past it (router.mjs:170-183) and the very next attempt refetches. Every one of these awaits sits on the engine's single serial promise chain (engine.mjs:352-355), so it also stalls that user's pump.fun ticks and pump.fun exits.

**How it fails.** One PONS position whose sell reverts with a custom error on an unverified curve: ~19 sequential eth_calls plus a Blockscout round trip (up to 6s) every 3 seconds, forever. With the reported ~60 such positions, the default PONS_RPC_URL (documented in chain.mjs:9 as 'public, rate-limited') is hit ~380 times/second-equivalent and starts refusing, which makes every other read fail too; meanwhile the serial queue means a Solana stop loss can wait minutes behind the PONS retries.

**Impact.** Indirect but large: it converts a handful of stuck PONS positions into a bot that cannot exit anything on either chain in time.

**Fix.** Cache the negative result too — move `this._abis.set(key, [])` into the catch so a curve the explorer cannot describe is asked about once. Add a per-position exit backoff in checkExits (reuse the sweep's `due()` keyed on p.id with an exponential delay driven by p.lastExitError.count), and memoise _sellShape's verdict per curve for a few seconds so a hopeless sell does not re-run the 12-call ladder every tick.

**Reviewer's correction.** Confirmed, with corrected line numbers and a corrected magnitude. Lines: the unthrottled call is engine.mjs:782 (not :769); the sweep's `due()` it lacks is engine.mjs:312 (not :309); the serial queue is engine.mjs:374 (not :352); router.mjs:149-156 and :170-183 are correct as quoted. Magnitude: '~60 such positions' is wrong — userEnvelope caps maxPositions at 10 and defaults to 4 (hub.mjs:75), so one user can hold at most 4-10 stuck positions; the 60 figure is wallet holdings, not open positions. The honest scaling is per user: 4 stuck positions x ~15 sequential HTTP round trips every 3 seconds is already more work than 3 seconds of wall clock, so the queue grows without bound and pump.fun stop losses starve behind it — and because every user's PonsLiveRouter builds its own provider against the same PONS_RPC_URL (router.mjs:51), the RPC load multiplies by tenant.

---

## [HIGH] Tier-3 priors can never clear the EV gate, and once 30 outcomes exist the tier shuts off permanently (absorbing state)
`src/velocity/venues/pumpfun/edge.mjs`:31

**Claim.** The comment above PUMPFUN_PRIORS asserts "Every tier must clear the EV gate after ~5% costs on priors alone, or the tier can never trade". Tier 3 does not clear it. p_win 0.30 x payoff 3.0 = edgeR 0.20; times loss_fraction 0.10 = +0.020 against a cost of ~0.038-0.039, so EV is about -0.019 at every plausible SOL price and curve depth. So the EV gate is not a gate for tier 3 at all — it is an unconditional fall-through to the probe branch. Worse, the probe branch is gated on `est.on_priors`, which flips to false the moment `stats.n >= minOutcomesForStats` (30). At that point the realized numbers take over and, at the observed 17.5% win rate, EV is about -0.064 — so every tier-3 candidate is refused with `EV_..._NOT_POSITIVE_AFTER_COSTS`, no probe. That is an absorbing state: no entries means no new outcomes, so p_win/payoff can never move, so the tier is dead forever. This — not any AGGRESSION knob — is the binding threshold in the observed funnel.

**How it fails.** Engine runs, tier 3 accumulates 30 live outcomes (the operator's window has 40). `useStats` latches true. statsFromOutcomes over the observed closes gives p_win = 7/40 = 0.175, avgWin r = 0.241, avgLoss r = 0.0825 -> payoff 2.93, loss_fraction 0.0825. EV = (0.175*2.93 - 0.825)*0.0825 - 0.0385 = -0.064. Every subsequent tier-3 candidate is rejected at gate `ev`, which Simple.jsx:60 renders as "no edge". The funnel shows exactly this: of 286 judged, 134 die at hard rules, 30 viability, 24 confidence, 10 window — and all 88 survivors die at "no edge". The bot has gated itself out of existence with no hysteresis and no path back.

**Impact.** Directly explains the 88 "no edge" rejections and the bot going quiet; and while the probe branch WAS open it took every tier-3 entry at a computed EV of -1.9% of stake, which on 40 x $25 is about -$19 of expected loss before variance.

**Fix.** Two changes. (1) Make the tier-3 prior actually clear its own gate as the comment claims (e.g. loss_fraction 0.20, or payoff 3.5 with loss_fraction 0.15) so the EV gate is a real gate rather than a pass-through to `probe`. (2) Break the absorbing state: keep a floor of probe capacity after the stats switch — e.g. blend priors and stats until n is large (`w = min(1, n/120)`), or allow the probe branch when `stats.n < 120` even with useStats, or window `modeStats()` to the last N days so a bad early record decays. Without (2) any tier that has one bad run of 30 is permanently retired.

**Reviewer's correction.** Split the finding. The durable defect is only claim 1: the tier-3 prior (edge.mjs:36) does not clear its own EV gate — measured EV [-0.0267, -0.0203] at costs priced on min stake $10 — so the comment at edge.mjs:29-32 is false and the `ev` gate is a pass-through to the probe branch for every tier-3 candidate, which is every observed entry. Add that tier 2 clears by only +0.001 to +0.008 and is one cost change from the same fate. Drop claim 2 entirely: engine.mjs:53 and :199-203 already age statistics out over a 14-day rolling window, with a comment describing the absorbing state by name. The residual of claim 2 is a bounded, not permanent, shutoff: once 30 live tier-3 closes land inside the window at the observed 17.5% win rate, EV goes to about -0.07, `on_priors` is false and the probe escape closes — for up to 14 days, then it reopens on priors. Severity high, not critical.

---

## [HIGH] Tier 3's prior can never clear the EV gate at any stake, so 100% of tier-3 entries are PROBEs the model itself scores at -1.9% of stake
`src/velocity/venues/pumpfun/edge.mjs`:36

**Claim.** The tier-3 prior {p_win 0.30, payoff 3.0, loss_fraction 0.10} is an edge of (0.30*3.0 - 0.70) = 0.200 R, and one R is 0.10 of stake, so the edge is 2.00% of stake. costs() can never return less than 3% (feeFractionRoundTrip is a pure percentage), and its actual minimum is 3.906% at a $27.17 stake. EV = 0.0200 - c is therefore negative at every stake, every SOL price and every curve size. The comment at edge.mjs:27-30 asserts the opposite — "Every tier must clear the EV gate after ~5% costs on priors alone, or the tier can never trade" — which is false for tier 3 (needs c < 2.00%) and also false for tier 2 at the stated 5% (tier 2's edge is 4.80% of stake and it fails at the $5 cost of 5.543%). The only reason tier 3 ever trades is pipeline.mjs:115, which converts the rejection into a GO whenever edgeBeforeCosts > 0 — and edgeBeforeCosts is 0.200 in R units compared against zero with no cost at all, which is precisely the unit confusion the expectedValue() rewrite at pipeline.mjs:18-27 exists to fix.

**How it fails.** Every tier-3 candidate that survives the four kill gates reaches the EV gate, is scored EV = -1.9%, and is then let through as a probe. The operator's log shows exactly this: entries almost all tier 3 at p_win 0.30 (the prior, i.e. on_priors=true, i.e. the probe path) with score at the floor. 40 trades x $25 x -1.9% = -$19.0 expected by the model's own arithmetic; observed -$25.81.

**Impact.** -1.9% to -2.4% of stake on every tier-3 entry, which is essentially every entry. ~-$19 modelled over the observed 40-trade window against an actual -$25.81.

**Fix.** Make the probe path cost-aware rather than R-aware: require `edgeR * lossFraction > 0` measured against a reduced probe cost, cap the number of probes per tier (e.g. stop at minOutcomesForStats), and either raise the tier-3 prior loss_fraction to a value where 0.20 R actually pays for a 3.9% round trip (loss_fraction >= 0.20) or lower p_win/payoff to admit that tier 3 has no prior edge. Do not leave the comment at edge.mjs:27-30 claiming an invariant the numbers violate.

**Reviewer's correction.** Three corrections. (1) The gate prices costs at ctx.minStakeUsd, not $25: engine.mjs:488 passes this.env.venues[venue].min_stake_usd and pipeline.mjs:100 forwards it, so the number the gate actually computes is 4.397% and EV = -2.397%, not -1.909%. (2) 'Also false for tier 2' needs care — at the gate's own $10 pricing tier 2 clears at +0.403%, so tier 3 is the only tier structurally shut out; the comment's '~5%' claim is what is wrong, not tier 2's ability to trade. (3) 'Refuse forever' is not the failure mode: the probe fires only while on_priors, which ends at minOutcomesForStats = 30 outcomes for that venue+tier inside the 14-day statsWindowMs (engine.mjs:53), so probing is self-limiting until the window ages the record out. Severity high, not critical: the design is documented and bounded; what makes it a real defect is that the bar it uses (an R-unit edge > 0) is one the priors satisfy unconditionally, so the EV gate contributes nothing on the path that produces nearly every entry. Drop the '-$19 modelled vs -$25.81 observed' comparison — the agreement is coincidence, not derivation.

---

## [HIGH] A confirmed sell whose proceeds are not yet readable is booked as $0 and written off as a −100% loss
`src/velocity/venues/pumpfun/router.mjs`:374

**Claim.** close() guards only the case "tokens visibly moved but SOL did not". When the RPC lags on BOTH legs — _txDeltas (getTransaction) returns null AND the 8×400 ms balance loop never sees either balance change — _settle returns {solDelta: 0, tokenDelta: 0}, the guard at line 374 is false because tokenDelta is 0 rather than <0, and the function falls through to line 375-378 and returns ok:true with proceedsSol = 0 and qty = qtyBefore*p/100. The sale really landed and real SOL is in the wallet, but the fill says the position sold for nothing. submit() has exactly this protection on the buy side (line 336-337, "book the expected outflow rather than zero"); the sell side does not.

**How it fails.** Position of $25.19 cost on mint M, wallet holds 1,000,000 tokens, sell tx SIG1 confirms and 0.05 SOL arrives. The RPC node answering us is ~4 s behind the slot: getTransaction(SIG1) returns null and getParsedTokenAccountsByOwner/getBalance both still serve pre-trade values for the whole 3.2 s settle window. Reproduced end to end through a real Engine + real PumpfunLiveRouter with a fake lagging connection: close ok:true notional:0 → OUTCOME { reason: 'SL1', pnl_usd: -25.19, pnl_pct: -100 }, day.realizedUsd: -25.19, position status: closed. The position is final, so neither sweep() nor _reconcile() ever revisits it; hub.settleFee also bails (hub.mjs:243 requires solOut>0) so the platform loses its fee too, and the learner is taught a −100% outcome on a trade that may have been a winner.

**Impact.** Up to 100% of a trade's cost per occurrence (~$25 at the observed size), plus the lost performance fee, plus a phantom charge against the daily loss budget that can halt live trading, plus a −100% training example fed to the learner.

**Fix.** Never return ok:true from close() on an inexact settle that saw no SOL. Replace the guard with `if (!(d.solDelta > 0) && !d.exact) return failure({id: position.id}, "UNCONFIRMED", ...,{ venue_ref: sig, t_sent: sent.t_sent })` — i.e. drop the `d.tokenDelta < 0` clause entirely, so "nothing moved" is treated the same as "tokens moved, SOL didn't". engine.mjs:797 then records p.pendingExit and the next attempt settles it from the transaction record via resolvePending, which is the path that already works. Optionally mirror submit()'s estimate fallback: after BLOCKHASH_LIFETIME_MS, book pumpfunFillModel's SELL estimate rather than zero.

**Reviewer's correction.** Correct as a defect; downgrade critical -> high. The money is not lost, only mis-booked (truePnl is wallet-based and stays right). Two failure modes, not one: tokenDelta === 0 AND tokenDelta === null both slip the guard — I reproduced both. hub.settleFee is at hub.mjs:278-279, not 243; engine refs are 865/869/872/876/879, not 841-846/862. Best fix is upstream of the proposed one: move the _txDeltas call inside _settle's retry loop (router.mjs:216 -> inside the 8-iteration loop at 219) so the attributable source is not abandoned after a single miss, AND drop the `d.tokenDelta < 0` clause so an inexact settle that saw no SOL is always UNCONFIRMED.

---

## [HIGH] The token-account rent is charged into cost_usd on every buy and never credited back when it is reclaimed
`src/velocity/venues/pumpfun/router.mjs`:338

**Claim.** A live buy's notional_usd is the whole measured outflow (-solDelta), which includes the 0.00203928 SOL ATA rent the buy pays to open the token account (test t10 line 191 pins this: "notional is the whole outflow"). engine.mjs:704 sets cost_usd = fill.notional_usd and engine.mjs:862 computes pnl = proceeds_usd - cost_usd. When the rent comes back, closeTokenAccount's result is written only as a `kind:"rent"` ledger line (engine.mjs:180) — grep over src/ and app/src/ shows nothing reads that kind. It never reaches pnl_usd, day.realizedUsd, the outcome record, the learner, or the UI. Meanwhile the paper fill model deliberately nets the rent out (router.mjs:44-45: "the rent nets out and only the extra base fee for that close is charged here"), so paper and live are permanently offset for the identical trade.

**How it fails.** Buy mint M for $25 at SOL $200. The buy tx debits 0.12593 SOL of trade+fees plus 0.00203928 SOL of ATA rent = 0.12797 SOL, so cost_usd = $25.59. Sell for 0.12797 SOL: proceeds_usd = $25.59, pnl booked = $0.00. reclaimRent then returns the 0.00203928 SOL to the wallet and appends kind:"rent" — the trade actually made +$0.41 but is recorded as flat. Every live pump.fun round trip is understated by RENT_ATA_SOL × solPrice ≈ $0.41. Across the operator's 40-close window that is ≈ $16.3 of the reported −$25.81 (63% of it); across the 13-close window ≈ $5.3 of the +$23.81. The same $0.41/trade is also the paper-vs-live gap, so a venue promoted on paper statistics is being judged on numbers $0.41/trade rosier than live can produce.

**Impact.** ≈ $0.41 per round trip at SOL $200; ≈ $16 of the reported −$25.81 over 40 closes. Also a permanent paper→live calibration bias of the same size.

**Fix.** Credit the reclaim to the position that paid it. Simplest correct form: in engine.reclaimRent's .then (engine.mjs:177-182), after appending the rent record, add the reclaimed USD back to the day (`this.store.state.day.realizedUsd += r.reclaimed_sol * this.quotePriceOf(venue)`) and to the just-closed outcome, mirroring chargeFee (engine.mjs:670-676) with the opposite sign. Cleaner: subtract RENT_ATA_SOL from costSol in router.mjs:333 when the account did not exist before the buy (qtyBefore === 0) so cost_usd matches the paper model's convention, and let the reclaim's base fee be the only real charge.

**Reviewer's correction.** Confirmed, but the $16.3-over-40-closes figure is conditional: it holds only for closes whose reclaim transaction actually landed. Where the reclaim failed, the $0.41 is a real loss and cost_usd is correct — so findings [1] and [2] are mutually exclusive per trade and their money impacts must not be summed. Line refs are engine.mjs:717 (not 704), 879 (not 862), 183 (not 180). Add that truePnl() is wallet-based and stays correct; the damage is to pnl_usd, day.realizedUsd, the learner and the promote gate.

---

## [HIGH] pump.fun live router signs and broadcasts whatever bytes pumpportal.fun returns — a remote blind-signing oracle over every hosted user's wallet
`src/velocity/venues/pumpfun/router.mjs`:155

**Claim.** `_buildSignSend` POSTs to `https://pumpportal.fun/api/trade-local`, deserializes the response into a VersionedTransaction, signs it with the user's trading key and broadcasts it with `skipPreflight: true`. The only validation performed on the returned bytes is `bytes.byteLength < 100`. Nothing checks the program IDs, the instruction set, the mint, the destination accounts, or the lamport amount. Every hosted user's PumpfunLiveRouter posts to the same URL, so one malicious/compromised/DNS-hijacked response drains every trading wallet the platform custodies. Contrast the PONS router, which builds its own calldata locally with ethers (`curve.buy(...)`, pons/router.mjs:107).

**How it fails.** pumpportal.fun is compromised (or its operator turns malicious, or the Railway box's DNS/TLS egress is MITM'd once). On the next buy for any user, the endpoint returns a `SystemProgram.transfer` of the full balance to an attacker address instead of a pump.fun buy. The router signs it with MASTER_SEED / the per-user trading key and sends it with skipPreflight so nothing simulates it first. Every user whose engine places a buy in that window loses their whole trading-wallet balance. The bot then books the order as UNCONFIRMED/EXPIRED and keeps trading.

**Impact.** 100% of every hosted trading wallet's SOL, simultaneously. At the current single-operator scale that is the whole deposited balance; multi-tenant it is the entire custodied float.

**Fix.** Before `tx.sign`, decompile the message and assert: (a) every programId is in an allow-list {pump.fun program, PumpPortal fee program, SystemProgram, AssociatedTokenProgram, TokenProgram, ComputeBudget}; (b) the only signer/fee payer is `this.keypair.publicKey`; (c) the mint account equals `order.instrument`; (d) the net SOL debit implied by the SystemProgram transfers plus the pump instruction is <= `solNeededForBuy(solAmount, ...)`. Refuse and alert otherwise. Additionally set `skipPreflight: false` for the first send of a mint so a simulation catches a malformed transaction, and pin the builder to an integrity-checked local instruction builder if one can be written.

**Reviewer's correction.** Keep the finding, drop the skipPreflight half of the fix (a valid drain transaction simulates fine — preflight catches malformed bytes, not malicious ones). Scope the blast radius to wallets that submit an order during the compromise window rather than 'every wallet simultaneously'. Note this is platform-wide, not velocity-specific: server.production.mjs signs pumpportal bytes unvalidated at ~15 sites. The separately-verifiable defect worth its own line is that router.mjs:4-5 documents a smartSend/Jito path that does not exist — `smartSend` (src/engine/rpc-enhanced.mjs:135) is imported nowhere under src/velocity.

---

## [MEDIUM] "Sell all & stop" tells the user failed sells are "retrying in the background" — nothing retries, the engine is deleted
`app/src/Simple.jsx`:320

**Claim.** On stop, the UI reports unsold tokens as "retrying in the background". `hub.stop()` stops the supervisor, stops the engine and does `this.users.delete(wallet)` — there is no retry, no scheduler, no queue. The tokens sit in the trading wallet until the user manually finds them. The same line also does `sSt({ running: false })`, which replaces the entire status object, so the positions list, the narration and the failed-instrument list disappear from the screen at the exact moment the user needs them.

**How it fails.** User holds 3 positions, presses "Sell all & stop". The pump.fun curve for one mint is congested and the sell reverts. Server returns `{ok:true, closed:2, failed:[{instrument:"7xK…"}]}`. UI shows "1 token(s) could not be sold yet; retrying in the background" and immediately re-renders the pre-funding card — the position row and the mint address are gone. The user closes the tab. No process is watching that mint. Given the observed exit mix (crash-exit is the single largest bucket at -$25.24 over 14 closes), an abandoned ~$25 position typically decays to near zero.

**Impact.** ~$25 per abandoned position (one full trade size) — the operator's worst single close was -$25.62. At 40 closes/window with any sell-failure rate above a couple of percent this is the largest single loss channel the UI creates.

**Fix.** Two changes. (1) Replace the message with the truth and the remedy: `` say(`${r.failed.length} token(s) did not sell: ${r.failed.map(f=>f.instrument.slice(0,8)).join(", ")} — the bot has stopped, use "Sell every token in the wallets" below`, "error") ``. (2) Do not blow away the status: keep `st` and set only the running flag (`sSt(x => ({ ...x, running: false }))`), and force `holdOpen`/`sSweep` open when `r.failed?.length` so the unsold tokens and their Sell buttons are on screen. Better still, have `hub.stop` keep the user registered (or auto-start a sweep) when `failed.length > 0` so the claim becomes true.

**Reviewer's correction.** True as written about the code, but the failure scenario is wrong in two places: the error message does survive `sSt({running:false})` (Simple.jsx:479 is not gated on `running`), and the sweep/holdings controls that can sell the abandoned mint render for any `pk && tw` (Simple.jsx:503-505). What is actually lost is the position row and the mint address, and what is actually false is the word "retrying". Worth noting the copy mirrors engine.mjs:216, which is accurate for /api/velocity/halt and inaccurate for /api/velocity/stop. Severity medium.

---

## [MEDIUM] After the UI's own "50%" button, the position row shows exactly double the real value and double the real P&L
`app/src/Simple.jsx`:448

**Claim.** The UI computes a position's current value as `notional_usd * (1 + changePct/100)`. `notional_usd` is set once at entry (engine.mjs:715) and is never reduced on a partial exit — `_bookExit` updates `proceeds_usd`, `sol_received` and `remaining_qty` but never `notional_usd`. `changePct` is a mark-vs-entryMark ratio, unaffected by how many tokens are left. So after the UI's own 50% sell the row values the remaining half of the tokens at the full original size. The backend agrees (exits.mjs:66 `unrealized_usd` and engine.mjs:267 `open_usd` have the identical defect), so `pnl.since_start_usd` — the big green headline number at Simple.jsx:441 — double-counts the half that was already sold and banked.

**How it fails.** $25 position, token +40%. Row correctly reads $35.00 / +$10.00 / +40.0%. User taps 50%; the server sells half and returns "Sold 50% … for $17.50". Poll returns the same position with `notional_usd` still 25 and `changePct` still 40. Row still reads $35.00 / +$10.00 — but the remaining tokens are worth $17.50. The user believes they hold $35 of the token plus $17.50 of realized SOL ($52.50) when they hold $35 total. `since_start_usd` in the header is inflated by the same $17.50 until the position finally closes.

**Impact.** Overstates displayed equity by up to 50% of every partially-sold position (~$12.50 on a $25 trade) for as long as the remainder is held; a user sizing their next deposit off the header number is acting on inflated equity.

**Fix.** Scale the basis with the fill in `_bookExit` (engine.mjs, just after `p.remaining_qty` is updated): `const before = p.remaining_qty + (f.qty||0); if (before > 0) p.notional_usd = +(p.notional_usd * (p.remaining_qty / before)).toFixed(4);` — mirroring what the paper router already does at router.mjs:70. That fixes the UI row, `unrealized_usd`, `open_usd` and `since_start_usd` in one place. Keep `cost_usd` untouched so the realized-P&L arithmetic at engine.mjs:879 still works.

**Reviewer's correction.** Confirmed exactly as claimed, and the proposed fix is the right one. Add: the stale `notional_usd` also inflates `risk.mjs:130-132` (totalOpen/venueOpen/openRisk) and `governor.mjs:66` (openRisk), so a partially-sold position keeps holding a full-size exposure slot in the risk envelope — an entry-suppressing side effect, not just a display bug. Realized P&L is unaffected (engine.mjs:879 uses cost_usd). Severity medium, not high.

---

## [MEDIUM] The round-trip cost quoted at the moment of choosing a trade size is ~56% too high, and reads a `solPrice` the status API never returns
`app/src/Simple.jsx`:24

**Claim.** Two independent errors in the same expression. (a) `dragPct` charges a 0.001 SOL priority fee for the round trip; the engine's real priority fee is 0.0003 SOL per transaction, i.e. 0.0006 for a round trip. (b) It charges the full 0.00203928 SOL token-account rent as a permanent cost, but the engine now reclaims that rent on every full exit (`reclaimRent`, engine.mjs:881/176). On top of that, both call sites pass `st?.status?.solPrice`, and `engine.status()` (engine.mjs:1060-1071) has no `solPrice` key at all — so the value is always `undefined`, always falls through to `SOL_USD_FALLBACK = 200`, and the quoted cost never tracks the actual SOL price.

**How it fails.** A user on the funding screen reads "Every trade pays a fixed cost … about 5% at the smallest stake" (Simple.jsx:408) and on the size picker "A $25 round trip costs about 5.4% …" (Simple.jsx:427). The true figure is 3.5%. They either walk away believing the economics are worse than they are, or they size up to $100 to dilute a fixed cost that was mostly refunded. Separately, if SOL is at $130 the quote is wrong in the other direction because the price is hardcoded.

**Impact.** none directly - the number is advisory, but it is the only cost figure a customer sees before committing, and it is wrong by 56% relative in the direction that suppresses the product's own case.

**Fix.** Add `solPrice: this.quotePriceOf("pumpfun")` to the object returned by `engine.status()` (engine.mjs:1060) — or read the value the UI already receives, `s?.bankroll?.wallet?.solPrice`. Then correct the constants: `((usd * 0.03) + (0.0006 + 0.00001) * p) / usd * 100`, and if you want to keep a rent line, charge it only as the failure case (rent-reclaim failure) rather than every trade.

**Reviewer's correction.** Confirmed, with one correction to the proposed fix: adding `solPrice` to engine.status() would NOT reach these two call sites. Both dragPct calls (Simple.jsx:408, :427) live inside the `{pk && tw && !running && ...}` block, and hub.status() returns `{ running: false, sweep }` for a non-running user (hub.mjs:259) — there is no `status` object at all on that screen, so `st?.status?.solPrice` is structurally unreachable, not merely a missing key. The price has to come from a public endpoint (/api/radar/live already returns `solPrice`, server.production.mjs:8190) or be dropped.

---

## [MEDIUM] Bondli's 5% cut appears in no aggregate number the UI shows, and the "fees" figure shown beside P&L is buy-side only — inviting double-subtraction
`app/src/Simple.jsx`:470

**Claim.** Three separate problems in the two lines that report money. (1) `day.realizedUsd` (shown as "closed +$X" at line 443) and `review.pnl_usd` (line 470) are `proceeds_usd - cost_usd` — net of venue fees but **gross of the 5% performance fee**, which is a separate SOL transfer out of the wallet booked as `kind:"fee"` (hub.mjs:296). (2) `review.fees_usd` only sums `kind:"exit"` and BUY `kind:"fill"` records; the pump.fun SELL fill hardcodes `fee_usd: 0` (router.mjs:378) and the platform fee is `kind:"fee"`, so the number is essentially buy-side venue fees only. (3) Those fees are already deducted from `pnl_usd`, so rendering them side by side ("$23.81 · fees $11.23") reads to any customer as "net $12.58".

**How it fails.** Operator's own window: UI shows "last 13 closes: +$23.81 · won 46% · fees $11.23". A customer concludes they netted $12.58. In fact $23.81 is already after venue fees and *before* Bondli's cut, so the truth is $23.81 minus roughly 5% of the winners' gross profit — a different number in the other direction. Neither reading is what the screen says, and the customer has no way to see what Bondli actually took except by scrolling the raw narration for `fee -$…` lines.

**Impact.** ~5% of gross profit is invisible to the customer on every screen except the raw log. On the operator's +$23.81 window that is roughly $1.20-$2 unaccounted, and structurally it means the fee disclosure at line 524 is never reconcilable against any number shown.

**Fix.** Add `platform_fee_usd` to `review()` (sum `ledger.query({kind:"fee", scope:"platform"})` `.usd`, and `waived_sol` for the waived case) and to the day roll-up. Then render line 470 as three explicit terms: `gross +$X · venue fees $Y (already deducted) · Bondli fee $Z → net $X-Z`. Also include the sell-side venue fee in `fee_usd` at router.mjs:378 rather than hardcoding 0, so `fees_usd` is a whole-round-trip number.

**Reviewer's correction.** Sub-claims (1) and (3) confirmed as stated. Sub-claim (2) needs a magnitude correction: the buy fill's `fee_usd` is `(costSol - solAmount) * solPrice` (pumpfun/router.mjs:378 buy branch), which INCLUDES the $0.41 ATA rent that is later reclaimed. At $25 / SOL $200 that is 0.00421928 SOL = $0.844, against a true round-trip venue+gas cost of ~$0.873. So the displayed figure happens to land within ~$0.03/trade of the whole round trip — it is compositionally buy-side-only (and rent-inflated) but not materially understated, which is why the operator's $0.86/trade matched. The finding's real weight is the invisible platform fee, not an undercounted venue fee. Severity medium.

---

## [MEDIUM] The headline P&L silently swaps between two different definitions over two different time windows, and counts a mid-run deposit as profit
`app/src/Simple.jsx`:281

**Claim.** `pnl` is `tp?.since_start_usd ?? (day?.realizedUsd || 0) + (tp?.unrealized_usd || 0)`. Those are not the same quantity: the first is a wallet delta measured from the moment Start was pressed; the second is realized P&L since midnight UTC plus open marks. `since_start_usd` goes null whenever any live venue's wallet or quote price cannot be read (`truePnl` breaks out with `known=false` at engine.mjs:262) — a single bad ETH-price poll with PONS enabled is enough. So the 30px headline can change definition and window between two 3-second polls, with only a 13px caption switching between "since start" and "today" to mark it. Separately, `since_start_usd` has no deposit detection: the baseline is frozen at first read (engine.mjs:238-241) and only extended for a *new* venue (engine.mjs:246-249), so SOL sent to the trading wallet while the bot runs shows up as pure profit.

**How it fails.** A user starts the bot Monday and leaves it running. Tuesday morning the header reads "since start -$41.20". The PONS ETH price oracle blips for one poll; `truePnl` breaks, `since_start_usd` becomes null, and the header flips to "today +$1.90" in green. Three seconds later it flips back to -$41.20 in red. Separately: user tops the wallet up with 1 SOL from Phantom (they still have the address in their send history) — the header immediately shows roughly +$200 in green with no trade having happened.

**Impact.** none directly - but a customer who deposits $200 and reads "+$200" will size up on a fictional win, and the sign flips make the one number they check untrustworthy.

**Fix.** Never fall back to a different metric behind the same number. When `since_start_usd` is null, render the headline as "—" with "waiting for a wallet reading", and show `day.realizedUsd` on its own labelled row underneath (it is already there at line 443). For deposits: have `noteWallet` treat any jump in `w.sol` larger than the largest plausible single fill as an external transfer and add it to `baseline.quote[venue]` rather than to profit — the balance-delta approach cannot otherwise be trusted as a P&L.

**Reviewer's correction.** Keep the deposit half exactly as written (engine.mjs:271-279 has no transfer detection; a 1 SOL top-up reads as +$200 profit). Drop the flip scenario: `this.wallets[venue]` is never cleared and `w.solPrice` persists, so `known` (engine.mjs:262) cannot flap on a single bad price poll — the realistic failure is `since_start_usd` staying null from the start when a live venue never produces a reading, which pins the header on "today" rather than oscillating. The two-metrics-one-number design criticism stands on its own.

---

## [MEDIUM] deploy/Dockerfile boots src/api/server.mjs, so the documented self-host deploy serves a server with none of the product's endpoints
`deploy/Dockerfile`:28

**Claim.** There are two API servers. package.json's `start` runs src/api/server.production.mjs (11,365 lines, 142 routes, velocity hub, wallet-auth, keyvault). deploy/Dockerfile's CMD runs src/api/server.mjs (2,059 lines, 55 routes) -- which has no /api/velocity/*, no /api/trading-wallet/*, and no /api/auth/challenge|verify. deploy/docker-compose.yml builds that Dockerfile and README.md:544 documents ./deploy/deploy.sh fresh as the deploy path, which runs `docker compose up -d --build`.

**How it fails.** An operator follows README.md:544 (`./deploy/deploy.sh fresh`). The container comes up healthy -- /api/health exists in both servers -- but every one of the 15 endpoints the shipped frontend calls returns 404: sign-in (api/auth/challenge, api/auth/verify), wallet creation (api/trading-wallet/create), and the entire bot (api/velocity/start|stop|status|sell|holdings). WALLET_ENCRYPTION_KEY and VELOCITY_HOSTED, which deploy/HOSTED_VELOCITY.md tells them to set, are never read by server.mjs, so the boot log gives no warning either.

**Impact.** none directly -- total outage of the paid product on the documented self-host path

**Fix.** Change deploy/Dockerfile:28 to `CMD ["node", "src/api/server.production.mjs"]`. Then delete src/api/server.mjs and everything it alone keeps alive (see the deletion-list finding), and point `npm run api:dev` at server.production.mjs so local dev exercises the shipped server.

**Reviewer's correction.** The evidence contains one false claim that also breaks the proposed fix: '/api/health exists in both servers' is wrong. `grep -nE 'app\.(get|all)\(\s*["'\''`][^"'\''`]*health'` over src/api/server.production.mjs returns only :9714 /api/brad/health and :11133 `app.get("/health", ...)`. There is no /api/health in the production server. So (a) the reason the container looks healthy is that server.mjs:233 happens to define the path the HEALTHCHECK wants, and (b) changing Dockerfile:28 to server.production.mjs as written would leave deploy/Dockerfile:26's `wget -qO- http://localhost:3001/api/health` failing forever, marking the container unhealthy on every self-host deploy. The fix must change the CMD and the HEALTHCHECK path together (or add /api/health to the production server).

---

## [MEDIUM] Tier 1 is unreachable and tier 2 loses 4 of its 6 routes on the hosted server: five classifier inputs are never written on that code path
`src/api/server.production.mjs`:5778

**Claim.** classifyConfidence reads `_dexBoosted`, `_whaleBullish`, `_survivorMatch`, `_bullishSignals`, `_devTier` and `_rugFlags`. `token._dexBoosted` is never assigned anywhere in the repository (the boost data lives in `radar.dexBoosted`, a Map, which six other sites read correctly with `radar.dexBoosted.get(t.ca)` — buildScoredResponse never copies it onto the token). The other five are written only inside `startAutoTrader`, which spans server.production.mjs:4913-6710 and is called from exactly one place, the legacy auto-trader route at line 6732; the hosted velocity path (VELOCITY_HOSTED=1, server.production.mjs:11187+) never calls it. Result on the hosted server: whaleBullish is always null, survivorMatch/bullishSignals/rugFlags are 0, devTier is "", dexBoosted is false.

**How it fails.** Tier 1 requires memeticQuick >= 0.6 AND one of four disjuncts. Three of the four are dead (`whaleBullish > 0.3` — null; `dexBoosted && ...` — never true; `survivorMatch >= 70 && bullishSignals >= 3` — both 0), leaving only `trend === "rocket" && apeScore >= 80 && buyVelocity >= 8`. On PONS even that is moot because `_memeticQuick` is never set there either, so tier 1 is mathematically impossible on Robinhood Chain. Tier 2 loses `dexBoosted && apeScore>=65`, `whaleBullish>0.2 && walletAge>0.5`, `survivorMatch>=50`, and `devCred>=0.6 && chartHealth>0.5` (devCred is pinned at 0.5), leaving only the trend disjunct and `apeScore >= 70`. This is exactly why every observed entry is tier 3 with p_win 0.30 — the two tiers whose priors DO clear the EV gate (+0.081 and +0.010, see finding 2) can essentially never be assigned.

**Impact.** Forces every entry into the one tier whose prior EV is negative (-0.019) while the two positive-EV tiers (+0.081, +0.010) are unreachable — i.e. the bot is structurally restricted to the only trades its own model says are unprofitable.

**Fix.** Stamp the boost onto the row buildScoredResponse serves: in the `rows.push({ token: { ...rest, ... } })` at server.production.mjs:8110, add `_dexBoosted: !!radar.dexBoosted.get(t.ca), _boostAmount: radar.dexBoosted.get(t.ca)?.amount || 0`. Move the `enrichWalletAges` / `enrichDevCredibility` loop (5776-5790) and the `_survivorMatch` / `_bullishSignals` / `_devTier` computation out of startAutoTrader into the background scorer at 11276 (or into buildScoredResponse's enrichment queue next to `queueXCheck` / `queueSiteCheck`), so the hosted path gets them. Until then, delete the dead disjuncts rather than leaving branches that read as live policy.

**Reviewer's correction.** Keep the dead-input inventory — it is exact, including that `_dexBoosted` has no writer anywhere in the repository. Rewrite the conclusions: tier 1 on pump.fun is reduced from four disjunct routes to one (`trend === "rocket" && apeScore >= 80 && buyVelocity >= 8`, confidence.js:52), not made unreachable, because `_memeticQuick` IS set on the hosted path at server.production.mjs:1357; tier 1 IS unreachable on PONS, where that field is never written. Tier 2 loses 4 of 6 routes and keeps `apeScore >= 70` and the trend route behind a `apeScore >= 62` floor. Note that the dead `_rugFlags` LOOSENS tiers 1 and 2 rather than blocking them, since `rugFlags === 0` (confidence.js:41) and `rugFlags <= 1` (:68) are requirements a never-written field satisfies. Drop the claim that this is why every observed entry is tier 3 — the observed scores of 41-44 are far below tier 2's floor of 62, so the dead disjuncts were not binding on those trades. Severity medium.

---

## [MEDIUM] requireAdmin falls back to the hardcoded literal "bondli_default" and accepts the secret in the query string
`src/api/server.production.mjs`:143

**Claim.** `const ADMIN_SECRET = process.env.ADMIN_SECRET || "bondli_default"` (143) means an unset env var does not disable the admin bypass — it sets it to a string that is in the public repo. requireAdmin (3163) compares against that value and additionally accepts it from `req.query.secret`, so it lands in Railway access logs, browser history and Referer headers. The file is internally inconsistent about this: makeRequireOwner is constructed at line 185 with `process.env.ADMIN_SECRET || null`, and wallet-auth.mjs guards it as `if (adminSecret && ...)`, so requireOwner correctly disables the bypass when the env var is missing. The two guards read the same variable and disagree about what "unset" means.

**How it fails.** ADMIN_SECRET is not set on the Railway service (nothing enforces it — there is no boot-time check and the server logs no warning). An attacker sends GET https://bondli.fun/api/admin/users?secret=bondli_default and receives the full user table, then POSTs /api/admin/whitelist?secret=bondli_default to grant themselves VIP, which resolveTier uses to set the performance-fee rate and to unlock create-extra wallets. The same literal also makes them an admin for every requireOwner route via the x-admin-secret header — except that path is null-guarded, so the exposure is exactly the requireAdmin set.

**Impact.** Full user-table disclosure and self-granted VIP (fee-rate manipulation). Not a direct drain, but it is the reconnaissance step that makes findings 1 and 2 trivial to target at scale.

**Fix.** Make the fallback null and have requireAdmin fail closed: `if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return res.status(403)`. Drop `req.query?.secret` so the credential is never in a URL, and compare with crypto.timingSafeEqual. Log a startup warning when ADMIN_SECRET is unset, the way wallet-auth.mjs already does for JWT_SECRET.

**Reviewer's correction.** Both stated impacts are weaker than claimed, and the real one is missing. (a) /api/admin/users (8988-8994) maps every row to `wallet.slice(0,8) + '...'` -- it is not a user-table disclosure and it does not give an attacker the addresses that findings 0 and 1 need. (b) Self-granted VIP does NOT touch the hosted performance fee: hub.mjs:317-322 charges a flat `this.feePct` (5% default) and exempts only `isOwnerWallet`, ignoring resolveTier entirely. VIP only moves the legacy sell-all skim (calculateFee at 4617/4707: fee-engine.mjs:154-188, free ladder -> NETWORK_FEE_PCT 2%) and GPU/compute tiering. (c) The sharpest impact is the one the finding lists and then ignores: POST /api/launch (8259) rewrites launchStore, and app/src/Simple.jsx:219, 225 and 252 render `l.buy` / `l.url` as the homepage's green 'Buy on PONS / Buy on Uniswap' button. With the repo's default secret, anyone can repoint that button at their own contract for every bondli.fun visitor. Medium is the right severity, for that reason rather than the stated ones.

---

## [MEDIUM] Two anonymous requests exfiltrate any user's launch private keys (/api/sessions then /api/session/export-keys)
`src/api/server.production.mjs`:4114

**Claim.** /api/session/export-keys returns raw base58 private keys and its only access check is `session.userWallet !== wallet`, where `wallet` is read from the same attacker-controlled request body. The sessionId needed to call it is handed out by /api/sessions, which is also unauthenticated and takes the wallet from the query string. A public wallet address is therefore the whole credential.

**How it fails.** Attacker: GET /api/sessions?wallet=<victim> (line 4149, no auth) -> session-manager.mjs:342-378 returns every session object for that wallet including its `id` (it strips devSecret and _fleetKeys but not the id). Then POST /api/session/export-keys {sessionId: <that id>, wallet: <victim>} (line 4114). Line 4119 compares session.userWallet to the attacker-supplied `wallet` — they match, because the attacker simply typed the victim's public address. Lines 4123 and 4127-4128 return {role:"dev", secret: session.devSecret} plus every fleet wallet secret from fleetkeys:<sessionId>. The attacker now signs directly as those wallets and sweeps whatever they hold; nothing in the app can revoke that.

**Impact.** Full compromise of every dev and fleet wallet for any user, for the 24h/48h the session and fleetkeys records live. Loss equals whatever SOL and tokens those wallets hold at the moment of theft.

**Fix.** Put requireOwner on both routes (and on /api/sessions/clear at 4159, which has the same shape). The `session.userWallet !== wallet` line then becomes a real check because requireOwner has proved `wallet` is the caller's. The body-field-equals-record-field pattern is not authentication anywhere it appears in this file (3756, 3784, 3868, 4034, 4119, 4143).

**Reviewer's correction.** Downgrade critical -> medium purely on reachability: the entire session/launch subsystem is absent from the deployed frontend, so there are no session:* records belonging to hosted customers to steal. Everything about the code claim is correct, and the severity returns to critical the day a launch UI ships.

---

## [MEDIUM] No health check can detect a bot that has stopped trading, and the /api/health path every deploy script probes does not exist in the production server
`src/api/server.production.mjs`:11133

**Claim.** The production server's only generic liveness route is `app.get("/health", (req, res) => res.json({ ok: true }))` — a constant that is true while the process can accept a socket, regardless of whether the radar is dead, the feed is stale, every engine is halted, or zero users are running. `/api/velocity/health` (hub.mjs:571) is richer but still returns `ok: true` unconditionally; it never reflects `Supervisor.deadman`, which exists (supervisor.mjs:73-79) but is called from nowhere except the standalone CLI (`src/velocity/index.mjs:76`) — never from the hosted API. Separately, `/api/health` — the path the Dockerfile HEALTHCHECK and all three deploy.sh probes use — is defined only in `src/api/server.mjs:233`, not in `server.production.mjs`, which `npm start` actually runs.

**How it fails.** Two concrete failures. (a) On Railway the operator follows the repo's own docs and sets the health path to /api/health; every deploy 404s the check, Railway marks the deployment unhealthy and rolls back or restarts in a loop — which, per finding #3, abandons open positions on each cycle. (b) The docker-compose path builds a container whose CMD is `src/api/server.mjs`, a server with no VelocityHub at all: the healthcheck goes green, the site answers, and no user can trade. In steady state, the radar websocket can die and every engine stop filling and `/health` still returns `{ok:true}` forever.

**Impact.** none directly - but it is the reason every other failure in this list is discovered by the operator looking at a screen rather than by a page.

**Fix.** Add `app.get("/api/health", ...)` as an alias, and make both return non-200 on real unhealth: `radar.online === false`, or `Date.now() - radar._lastPortalTradeAt > 120000`, or any running engine whose `store.state.heartbeatAt` is older than `deadmanMs`. Wire `Supervisor.deadman(dataDir)` into `/api/velocity/health` per user. Fix deploy/Dockerfile:28 to run `src/api/server.production.mjs`, and commit a railway.json pinning the start command and healthcheckPath.

**Reviewer's correction.** Downgrade high -> medium, and split it. The solid, reachable half is deploy/Dockerfile:28: the container CMD runs src/api/server.mjs, which has no VelocityHub (grep for VelocityHub/VELOCITY_HOSTED in that file returns nothing), while its HEALTHCHECK at :25 probes /api/health — a path that exists only in that dev server — so the compose stack README.md:544 documents comes up green and cannot trade at all. The observability half (constant `/health`, unconditional ok in hub.mjs:571, Supervisor.deadman wired only into the CLI at src/velocity/index.mjs:76) is real but low severity. Drop the Railway rollback-loop scenario: Railway runs `npm start` via nixpacks, never deploy/Dockerfile, and its healthcheckPath is unset by default — there is no evidence in the repo that /api/health was configured there.

---

## [MEDIUM] Any wallet that trades 5 mints in 15 minutes is permanently excluded from every gate-1 rug feature — a rug crew buys immunity for about $1 a wallet
`src/api/server.production.mjs`:716

**Claim.** `noteWalletTrade` adds a wallet's 8-char prefix to `radar.hubs` once it has traded HUB_MIN_TOKENS=5 distinct mints inside HUB_WINDOW_MS=15 min, and `radar.hubs` is add-only — the 60s prune at line 731-734 clears `radar.walletTokens` but never `radar.hubs`. Every trade from a hub wallet is stamped `hub: true` (line 1453-1454), and `extractQuickFeatures` drops all hub trades before computing identity and timing features (line 1642: `const trades = (t.trades || []).filter(tr => !tr.hub)`). That single filtered array is the sole input to rg_devSellSpeed, _rg_devSelfSnipe, rg_coordDumpScore, rg_sellWaveDetect, rg_holderConcentration, _rg_quickFlipRate, _rg_sybilScore, _rg_freshWalletRatio, _rg_singleWalletDominance, _rg_buyTimingRegularity and _rg_velocityLinearity. So a wallet that has been seen on 5 mints is invisible to the entire rug half of gate 1 for the lifetime of the process.

**How it fails.** A rug crew warms 20 sybil wallets by making one dust buy on each of 5 throwaway mints (their own, or any live mint) — about 0.005 SOL plus fees per wallet, roughly $1. All 20 are now in radar.hubs permanently. They launch the target mint; the same 20 wallets do the pump and, minutes later, the dump. rg_holderConcentration, rg_coordDumpScore, rg_sellWaveDetect, _rg_singleWalletDominance, _rg_freshWalletRatio and _rg_quickFlipRate all compute over an empty or near-empty trade array, so gate 1 sees a clean token. Because the deployer's own wallet also becomes a hub after selling out of 5 of its own launches in 15 minutes, rg_devSellSpeed stays 0, which additionally satisfies disqualifiers.js:154 and unlocks the MOMENTUM_WAIVABLE path, waiving QUICK_FLIP, COORDINATED_DUMP, EXTREME_CONCENTRATION and every MULTI_RUG_SIGNAL_*. The bot buys $25 and the crew sells into it. This matches the observed funnel: entries almost all tier 3 at the score floor with 14 crash-exits costing -$25.24 over 40 closes.

**Impact.** Directly funds the observed loss profile: at $25/trade and 14 crash exits in 40 closes, roughly -$25 realized per window, and it scales linearly with per-user stake and position count. Attacker cost to obtain immunity is ~$1 per wallet, one time.

**Fix.** Stop using a single boolean to mean both 'high-frequency router, do not count for volume attribution' and 'exempt from rug detection'. Keep hub exclusion for concentration/retention denominators only, and always include hub wallets in the adversarial features (dev sells, coordinated dump, sell wave, quick flip, single-wallet dominance). Bound `radar.hubs` with the same 15-minute expiry as `radar.walletTokens` so a wallet has to keep earning the label. Never let the dev wallet be hub-classified: match `devW` against the unfiltered `t.trades`.

**Reviewer's correction.** The permanent, unbounded `radar.hubs` set and its double duty as rug-detection exemption is real (server.production.mjs:715 add-only, :731-733 prunes only walletTokens, :1642 filter). Drop the momentum-waiver escalation entirely: `_rg_organicBuyers` (:2024) counts only non-hub buyers, so hub-labelling your own wallets makes the disqualifiers.js:153 crowd test HARDER, and `momentum` is null at aggression 0-1, which is the hosted default (hub.mjs:102). Also drop 'invisible to the entire rug half' — `_rg_devHoldPct` (:2022) still reports the full initialBuy when devSells is empty, so DEV_HOLDS_SUPPLY still fires on a hub dev. Reframe as: hub status is earned in 15 minutes and never expires, so the set only grows and gate 1's pattern rules see a shrinking sample over process lifetime.

---

## [MEDIUM] Unauthenticated endpoints map any Solana pubkey to the bondli user who owns it, and expose that bot wallet's full holdings
`src/api/server.production.mjs`:3351

**Claim.** Four trading-wallet routes have no `requireOwner` and are served under `Access-Control-Allow-Origin: *` (line 168-174): `GET /api/trading-wallet/identify/:pubkey` (3351) returns `{ isTradeKey, parentWallet, tradingWallet, tier, whitelisted, paid }` for any pubkey; `GET /api/trading-wallet/:wallet` (3379) returns the bot pubkey, SOL balance, token-by-token holdings and USD value for any user address; `GET /api/trading-wallet/:wallet/debug` (3475) returns the same plus RPC internals; `GET /api/trading-wallet/list/:wallet` (3641) enumerates the primary and all extra wallets with balances. Compare the sibling money routes at 3557, 3572, 3605, 3614, 3668, which are all behind `requireOwner`.

**How it fails.** An attacker streams pump.fun buys, and for each buyer pubkey calls `/api/trading-wallet/identify/<pubkey>`. Every bondli bot wallet in the fleet is identified in minutes, together with the human wallet that funds it and that user's paid tier. `/api/trading-wallet/<parent>` then gives that bot's exact SOL balance and every mint it holds, refreshed on demand. That is the targeting layer for everything else in this report: which wallets to sandwich (15% on-chain tolerance), which addresses to airdrop-poison on PONS, and which positions are open right now so a deployer knows exactly when the bot must sell. It is also a straight privacy break — it links a user's public main wallet to their trading activity.

**Impact.** No direct loss, but it converts every other finding here from opportunistic to targeted. Also leaks each user's balance and holdings to anyone.

**Fix.** Put all four routes behind `requireOwner` (they already take a wallet parameter, so the existing middleware works unchanged). If `identify` must stay public for the connect-wallet UX, reduce it to a bare boolean `{ isTradeKey: true }` with no parentWallet, tier or balance, and rate-limit it per IP.

**Reviewer's correction.** No correction needed; the finding is accurate as written, including line numbers, the requireOwner contrast at 3557/3572/3605/3614/3668, the CORS wildcard at :168, and the fix.

---

## [MEDIUM] crash-exit has no minimum adverse move and no minimum hold: it can sell at exactly break-even seconds after the fill
`src/autoape/exit-plan.js`:54

**Claim.** The crash-exit price condition is `changePct <= 0` — not 'down by X', just 'not up'. There is no minimum hold anywhere in the chain (exits.mjs:69-134 and pipeline.js:153-213 have no age guard), and dyn.scores >= 3 is already satisfied at entry because the radar has been recording the token every 5s since it appeared. So the very first tick after a fill can trigger a full exit at 0% change, paying the whole round trip for no information. The plan's own tier-3 stop is 10%; crash-exit pre-empts it at any depth, including 0.

**How it fails.** Tier-3 entry at score 42, entryMark = decision.reference.mcapUsd (engine.mjs:33, the PRE-buy mcap, up to 2s stale), so changePct on the first tick is a coin flip around 0. The memetic score dips 1.5 points over one 5s sample (velocity -0.3, the 'crashing' threshold at meme-intelligence.mjs:1500). runExitChecks returns a full SELL. Verified: `runExitChecks(pos at 0% change, { scores: 3, velocity: -0.35, trend: "crashing" })` -> {"action":"SELL","pct":100,"reason":"crash-exit","detail":"v=-0.350 a=-0.010 CRASHING at 0%"}.

**Impact.** $9.18 of unrecoverable transaction cost in the observed 40-trade window (36% of the crash-exit bucket, 40% of the window's whole -$25.81 loss), plus every tier-3 dip-and-recover that was cut at -4.6%.

**Fix.** Give crash-exit a floor and an age: require `changePct <= -(plan.stopLoss / 2)` (about -5% for tier 3) instead of `<= 0`, and `Date.now() - pos.entryTime >= 30_000` so a fill is never reversed inside the same half-minute for free. Tighten the trend test too — require `dyn.velocity <= plan.crashVelocity * 2` or `dyn.acceleration < 0` so one 5s score sample cannot fire it alone.

**Reviewer's correction.** Keep the mechanism (no depth floor, no age floor, different score than the entry's, pre-empts the tier stop at any depth) and drop the money arithmetic: the $9.18 is transaction cost those 14 closes would have paid on any exit path, so it is not attributable to crash-exit. The honest statement of cost is that crash-exit realises an average -4.6% price move against a plan willing to risk -10%, with no measurement of what the held alternative returned. Also correct the trigger example: ScoreDynamics needs v < -0.3 after a 0.3/0.7 EMA (meme-intelligence.mjs:1459, 1501), so a single 1.5-point 5s dip does not fire it from a rising token.

---

## [MEDIUM] _devCredScore's neutral default of exactly 0.5 makes the tier-3 "at least one compelling signal" requirement fire on everything
`src/autoape/gates/confidence.js`:101

**Claim.** classifyConfidence's SPECULATIVE branch requires apeScore >= tier3Floor AND at least one of nine "compelling signals". One of those nine is `devCred >= 0.5`, and `qf._devCredScore` is initialised to exactly 0.5 as the no-data neutral (server.production.mjs:1979 `let devCredScore = 0.5; // neutral default when no data`, emitted at 2063). Since `_devCredData` is only ever populated inside startAutoTrader (see finding 4), every hosted candidate carries exactly 0.5, and 0.5 >= 0.5 is true. The nine-way disjunct is therefore satisfied by 100% of hosted pump.fun candidates: tier 3 collapses to "apeScore >= tier3Floor and vel >= -0.05 and not crashing".

**How it fails.** A dead token with no memetic score, no whale, no survivor match, no dex boost, no chart health, stable trend and apeScore 50 is classified SPECULATIVE at aggression 1 purely because a field that means "we know nothing about this dev" is numerically equal to the threshold that means "this dev is credible".

**Fix.** Make the absence explicit rather than numeric: emit `_devCredScore: devCred ? devCredScore : null` (the codebase already does exactly this for `_whaleBullish` at server.production.mjs:2057, and learner.scoreFeatures already handles null correctly), and change the disjunct to `devCred != null && devCred >= 0.6` so the neutral value can never satisfy it. tools/gate-stats.mjs:177 already treats `_devCredScore === 0.5` as a missing input — the gate should too.

**Reviewer's correction.** Confirmed with two adjustments. (1) The line is server.production.mjs:1982, not 1979. (2) Scope it: this decides only at aggression 0 and 1, because AGGRESSION[2]/[3] set `enterWatchlist: true` and edge.mjs:120 promotes a tier-4 token to tier 3 regardless — so it affects the hosted default (aggression 1) but not the observed run (score 41-44 implies aggression 2 or 3). Severity medium, not high: it disables a gate condition rather than losing money directly. The proposed fix is right, and tools/gate-stats.mjs:187 already treats `_devCredScore === 0.5` as a missing input, which is good corroborating evidence that 0.5 means "unknown" everywhere except in the gate.

---

## [MEDIUM] The whole VOLUME LEGITIMACY block of gates 1 and 2 is dead: _volumeLegitimacy is only set by an on-demand HTTP route
`src/autoape/gates/disqualifiers.js`:115

**Claim.** Five rules — BOTTED_VOLUME and FAKE_VOLUME_HIGH_SOL and BOT_FARM_VOLUME in gate 1, BOTTED_VOLUME and DEAD_FEE_RATE in gate 2 — are all guarded by `token._volumeLegitimacy`. That field is written in exactly two places: memetic-pipeline.mjs:130, inside `scoreTokenMemetic()`, whose only server caller is the manual route `GET /api/memetic-score/:ca` (server.production.mjs:7880); and velocity-scorer.mjs:156, which is used by historical-movers, not the radar. Neither runs on the automated candidate path, and `extractQuickFeatures` does not produce `_volumeLegitimacy` either, so `qf?._volumeLegitimacy` is undefined too. The comment above the block reads "Botted volume = instant disqualify. Real volume is the strongest legitimacy signal" — it disqualifies nothing.

**How it fails.** A wash-traded token with METRONOMIC_TIMING + UNIFORM_TRADE_SIZES and botScore 95 passes gate 1's volume block untouched (the `if (volLeg)` at line 116 is never entered) and gate 2's (line 39/42 both require a truthy volLeg). It is judged only on the buy/sell counts the bot farm is manufacturing.

**Fix.** Call `scoreVolumeLegitimacy(t)` (the cheap part of scoreTokenMemetic — it needs only buys/sells/trades/volumeSol, no network) from the background scorer's per-token loop at server.production.mjs:11281 and stamp `t._volumeLegitimacy`, or compute it inside `extractQuickFeatures` and emit it on qf so both gates see it. It is a pure function of data the radar already has.

**Reviewer's correction.** Confirmed as written; severity medium stands. One addition worth making explicit in the write-up: three of the five dead rules (BOTTED_VOLUME, FAKE_VOLUME_HIGH_SOL, BOT_FARM_VOLUME) are enumerated in FATAL_DISQUALIFIERS at disqualifiers.js:190 as rules momentum may never waive, so the file documents protection that cannot fire at all.

---

## [MEDIUM] The legacy fee path silently defaults PLATFORM_WALLET to the address the code documents as key-compromised
`src/engine/fee-engine.mjs`:9

**Claim.** fee-engine.mjs defaults PLATFORM_WALLET to 4XnHZZmHwSQ8RszJsdc7snvxG8dZtm6g4hvpkCMkguMx — the exact address hub.mjs:22-24 names as EXPOSED_DEFAULT_PLATFORM_WALLET, "its key was pasted into a chat once". The velocity hub treats that address as a hazard: it warns loudly when it is in use (hub.mjs:135) and refuses to collect at all rather than mis-send when PLATFORM_WALLET is unset (hub.mjs:133-134). The legacy skim path does neither — it uses the compromised address as a silent default and transfers to it with no check.

**How it fails.** PLATFORM_WALLET is unset on a deploy (a new environment, a dropped Railway variable). Velocity behaves safely: hub.feeOk is false, settleFee logs "not collected" and skips the transfer (hub.mjs:266-267). Meanwhile every legacy skim — /api/sell-all (4715), /api/quick-sell, the fleet profit config (fee-engine.mjs:212-220) — resolves PLATFORM_WALLET to the leaked address and sends real SOL to it, signed with users' keys. Whoever holds that leaked key sweeps the platform's entire fee revenue, and because the transfer is fire-and-forget inside a detached async IIFE with a bare catch (4700, 4727), nothing surfaces the mistake.

**Impact.** On a deployment with PLATFORM_WALLET unset, 100% of legacy skim revenue is paid to an address whose key is public. Against the observed $26.25 of fees per 40 trades, that is the entire fee line.

**Fix.** Remove the literal default at fee-engine.mjs:9 (`process.env.PLATFORM_WALLET || null`) and make every skim site skip the transfer when it is null, the way settleFee does at hub.mjs:266-267. Import EXPOSED_DEFAULT_PLATFORM_WALLET and emit the same boot warning from fee-engine so the two code paths agree about which address is dangerous. Separately: retire that address as the fee destination entirely — a wallet with a published key cannot hold revenue no matter how often it is swept.

> No verdict was returned for this one. Treat as unconfirmed.

---

## [MEDIUM] survivorMatch is near-constant by construction (cosine similarity on non-negative, non-centred vectors) and adds a flat +7..+10 to every ape score, while 19 of its 46 features are always zero
`src/engine/survivorship-bias.mjs`:279

**Claim.** evaluate() scores a token as survivorSim - 0.5*deadSim where both are raw cosine similarities between non-negative, non-centred feature vectors (survivorship-bias.mjs:277-283, _cosineSim at :603-613). For vectors that share support and live in [0,1] this is ~0.9 for essentially any pair, so matchPct and the derived score carry almost no class information. matchPct is written to t._survivorMatch (server.production.mjs:6114) and becomes velocity's survivorMatch feature (edge.mjs:19) - which holds the joint-second largest weight, 0.15, and is declared SACRED (learner.mjs:37). getScoreAdjustment (:383-405) then adds netScore*0.2*confidenceScale straight onto the ape score at server.production.mjs:6113. Compounding it, 19 of the 46 SURVIVAL_FEATURES are never emitted by extractQuickFeatures - all five k_*, all three tp_*, all five cs_*, plus oc_giniCoeff, oc_devHoldPct, oc_topHolderPct, oc_buyVelocity1m, rg_fakeVolumeScore, and rg_zeroSellFlag / rg_buySellImbalance which exist only under an underscore prefix (_rg_zeroSellFlag, _rg_buySellImbalance). _toVector maps every miss to 0 (:143-149), so 41% of the vector is identically zero in the candidate, the survivor archetype and the dead archetype alike.

**How it fails.** survivorBias fills past 5 winners. Every scored token now gets t._apeScore += ~8 at server.production.mjs:6113, so the nominal score floor of 45 is effectively 37 and the observed 41-44 entries include tokens whose true score is 33-36. At the same time survivorMatch arrives at the velocity learner as ~0.90 for every candidate: a constant with weight 0.15 that raises every confidence uniformly, cannot discriminate, and has zero permutation importance - yet it is protected from being down-weighted by SACRED_INVERSIONS.

**Impact.** A uniform +7..+10 on every score is an undeclared 8-point loosening of the entry floor; with entries observed at 41-44 against a floor of 45 (aggression 1), it is the difference between trading and not trading. The learner also spends 15% of its weight budget on a constant.

**Fix.** Centre the vectors before taking cosine similarity (subtract the pooled mean of survivors and dead), or replace cosine with a Mahalanobis / logistic score on the discriminant weights that are already computed at :407-443. Drop or rename the 19 dead feature keys so the vector is honest about its dimension. Gate the ape-score adjustment on the survivor and dead archetypes being measurably separated (e.g. max Fisher power > 0.3), not merely on survivors.size >= 5.

**Reviewer's correction.** Confirmed in code and reproduced empirically, but gate the impact on reachability the finding never checks: survivorBias is populated only by the owner-only legacy fleet trader (server.production.mjs:5169 inside startAutoTrader, route POST /api/auto-trade/start behind requireOwner) or a Redis restore — the hosted velocity hub never feeds it, so on a velocity-only box survivors.size is 0, the adjustment is 0 and _survivorMatch is never set. State the finding conditionally, and note it is mutually exclusive with finding 0's 'survivorMatch arrives null' premise. Also: the adjustment scales with archive size (confidence = min(1, survivors/30)*100), so +7..+10 needs ~25-30 survivors; at 6-10 it is +2..+3. Minor: there are four k_* features, not five (19 dead keys total is correct).

---

## [MEDIUM] A position closed as FLAT_AT_VENUE and then re-adopted by reconcile is expensed twice at its full original stake
`src/velocity/core/engine.mjs`:828

**Claim.** When finalizeFlat (engine.mjs:713) books a total loss it writes an exit with final: true. reconcile then excludes that positionId from openInLedger (engine.mjs:818-819), so when the tokens turn out to still be at the venue the adoption branch falls through `f?.notional_usd || vp.notional_usd || sent.get(inst)?.stake_usd` (engine.mjs:828) and re-creates the position with cost_usd set to the FULL original stake — the same dollars that were already written off. The second close then books that stake as a loss again.

**How it fails.** An RPC that is behind the slot returns an empty token balance twice, sweepRetryMs apart, and router.findRecentSale() finds nothing (the common case: the sale never happened). finalizeFlat books -$25. Fifteen seconds later the RPC catches up, reconcile sees the tokens, and adopts them at cost_usd $25. When the position is finally sold or written off the ledger records a second -$25 outcome. day.realizedUsd, review().pnl_usd, day.trades and the learner's outcome stream all see two losing trades and $50 of loss from one $25 buy. The operator's live log already contains exactly one such event: "max hold: flat at venue 1 = -$25.62" against an average crash-exit of -$1.80 on ~$25 stakes.

**Impact.** Up to one full stake of phantom loss per event ($25 on the observed size), plus a false losing outcome fed to the learner and to the daily loss limit. One such event is already visible in the operator's 40-close window.

**Fix.** When adopting an instrument whose prior position was already booked as flat_at_venue or MISSING_AT_VENUE, set cost_usd to 0 (the money is already expensed) and mark the position `recovered: true` so the eventual sale books a pure gain. Also give the adoption loop the same dust threshold refreshWallet uses (engine.mjs:255 filters `h.qty >= 1`): reconcile's `for (const [inst, vp] of atVenue)` accepts any qty > 0, so a fractional remnant of a 100% sell is adopted at the full original stake too.

**Reviewer's correction.** Confirmed as written, including the dust sub-claim. Downgrade the severity from critical-adjacent 'high' to medium: the double booking is phantom (no user dollars leave the wallet), it needs a second condition beyond the observed FLAT_AT_VENUE event (the tokens must actually come back), and its worst real effect is a spurious daily halt plus a corrupted learner sample. The suggested fix (cost_usd 0 + recovered:true on adoption of an instrument whose prior position was booked flat) is right.

---

## [MEDIUM] A partial exit never reduces notional_usd, so the returned cash is counted twice in equity and the whole original position is still marked
`src/velocity/core/engine.mjs`:727

**Claim.** _bookExit decrements p.remaining_qty (engine.mjs:727) but leaves p.notional_usd at its entry value. notional_usd is what portfolioSnapshot sums into liveOpen for equity_usd (engine.mjs:493-494), what truePnl marks as open_usd (engine.mjs:233), and what markPosition multiplies by changePct to produce unrealized_usd (core/exits.mjs:59). Partial exits are live: SL1 sells 80% (src/autoape/exit-plan.js:100), plus fade-trim, momentum-trim, RIDE-trail, TP-trail, pre-graduation-profit 50% and volume-sell, and the hub exposes a user partial sell (hub.mjs:203-209).

**How it fails.** A $25 live position hits SL1 and sells 80% for $16. The $16 of SOL lands back in the wallet, so freeUsd rises by $16 — but liveOpen still says $25, so snap.equity_usd rises by $16 on a losing sale. The sizer's `available = equity - totalOpen` (risk.mjs:142) then hands out Kelly on a bankroll that counts the same $16 twice. Simultaneously truePnl().open_usd still marks the 200 remaining tokens as a $25 position and unrealized_usd applies changePct to the full $25, so the headline since_start_usd overstates by the value of the sold-off portion until the position finally closes.

**Impact.** Bankroll inflated by the full proceeds of every partial exit until the position closes; on an 80% SL1 of a $25 trade that is ~$16 of phantom equity per open position, and the headline since_start_usd overstates by the same amount.

**Fix.** In _bookExit, after updating remaining_qty, scale the open exposure down by the fraction actually sold: `const sold = (f.qty || 0) / (p.qty || 1); p.notional_usd = Math.max(0, p.notional_usd - p.notional_usd * sold)` (or recompute it as cost_usd * remaining_qty / qty). Everything downstream — equity_usd, open_usd, unrealized_usd, the exposure caps and the governor's openRisk — then means the remaining stub rather than the original ticket.

**Reviewer's correction.** The code claim stands; the money story does not. Kelly sizing is unaffected because equity_usd and totalOpen contain the same stale term and cancel. This is a reporting defect (equity_usd, truePnl.open_usd/since_start_usd, unrealized_usd overstated by the proceeds of the partial) plus over-tight exposure/openRisk caps — medium, not high. The proposed fix (scale notional_usd by the fraction actually sold) is still the right one.

---

## [MEDIUM] SIGKILL during a buy: reconcile adopts the position with entryMark 0, and NO exit rule can ever fire on it
`src/velocity/core/engine.mjs`:991

**Claim.** `enter()` writes the fsynced `stage:"sent"` order record and then awaits `router.submit` for 12-25 s (engine.mjs:678-680). If the process dies in that window and the buy landed, there is no `fill` record, so reconcile's `openInLedger.get(inst)` is undefined and `const decision = f ? this.ledger.readAll(...) : null` (line 991) resolves to null even though the `sent` record it already holds carries the `decisionId`. The adopted position therefore gets `entryMark: 0` (line 999), `decisionId: null`, `p_win: null` and the default `tier: 2`. `runExitChecks` bails on the first line with `if (pos.entryMcap <= 0) return null;` (src/autoape/pipeline.js:157), so the stop loss, every take-profit, the trailing stop, the volume exit and the graduation exit are all dead for the life of the position.

**How it fails.** Railway redeploys (SIGTERM then SIGKILL) while a $25 pump.fun buy is confirming. On restart reconcile adopts the mint. The token then rugs -83%. Reproduced against the real Engine (scratchpad/adopt.mjs): adopted `{ entryMark: 0, entryPrice: 0, cost_usd: 25, tier: 2, decisionId: null }`; after marking a 18 000 -> 3 000 tick, `changePct` is 0 and `evaluateExit` returns `null`. The only survivor is the MAX_HOLD time stop at 900 000 ms, so the position rides the rug for 15 minutes. It is also invisible in the UI (`changePct` 0, `unrealized_usd` 0) and, when it finally closes, books the loss against tier 2 with `features: null`, poisoning `statsFromOutcomes` for a tier that never took the trade.

**Fix.** In reconcile, fall back to the `sent` record when there is no fill: `const src = f || sent.get(inst); const decision = src?.decisionId ? this.ledger.readAll(r => r.kind === "decision" && r.decisionId === src.decisionId)[0] : null;`. That recovers tier, `reference.mcapUsd`, `features`, `stop_fraction` and `p_win` for exactly this case. Separately, refuse to adopt a curve position with `entryMark <= 0`: either derive the mark from the venue's current mcap and flag it, or freeze the venue and alert, rather than opening a real position with every exit rule disabled.

**Reviewer's correction.** The mechanism is confirmed (reconcile at engine.mjs:991 throws away the decisionId the `sent` record already carries, producing entryMark 0, and autoape/pipeline.js:157 then disables the stop loss, all take-profits, the trailing stop, the volume exit and the graduation exit). But 'NO exit rule can ever fire' is refuted: I ran the real evaluateExit on an entryMark-0 tier-2 position through a -83% tick and it returns DOA at t+40 s, STALL at t+200 s and MAX_HOLD at t+901 s, because exits.mjs:121-122/132-133 evaluate chg and peakPct as 0 when entryMark <= 0, which sits inside the stall band. Real exposure is 20-180 s without a stop loss, not 15 minutes. Reachability is broader than stated: pendingBuys is never persisted (engine.mjs:78), so an UNCONFIRMED buy plus an ordinary user Stop reproduces it without any crash. Severity medium, not critical; the proposed fix (fall back to the `sent` record, refuse to adopt a curve position with entryMark <= 0) is still correct.

---

## [MEDIUM] reconcile() can run off the engine queue and close a position whose sell is in flight, double-booking the day
`src/velocity/core/engine.mjs`:301

**Claim.** `refreshWallet()` calls `await this.reconcile()` (engine.mjs:301) when the wallet holds anything the store does not track. `refreshWallet()` itself is fired-and-forgotten off the queue from three places: `reclaimRent` (185), `_openPosition` (730) and `_bookExit` (907). So a full reconcile — which closes store positions that are absent at the venue — can execute concurrently with whatever the queue is doing, including a `_closePosition` whose sell has already landed on chain but has not yet been booked. `this.exiting` (engine.mjs:794) is not consulted by reconcile.

**How it fails.** Position X's sell lands on chain; the router is still inside `_settle`'s balance-retry loop (up to 3.2 s). Concurrently a `_bookExit` from a different position fires `refreshWallet()` off-queue, which sees an unrelated untracked holding (a partial-sell remainder, an airdrop, a graduated PONS token) and runs `reconcile()`. Reconcile's `atVenue` no longer contains X, X has no `pendingExit`, so it books MISSING_AT_VENUE with `pnl = -cost` and calls `store.closePosition(X)` and `day.realizedUsd -= 25` (engine.mjs:1017-1020). Then the in-flight sell returns ok and `_bookExit` runs on the now-closed position — it does not re-check `p.status` — appending a SECOND `exit` and `outcome` record and adding the real +$20 to `day.realizedUsd`. The day is now wrong by the phantom -$25, the ledger has two outcomes for one position, and `emit("outcome")` fires the platform fee on a position already written off.

**Impact.** Up to 2x the stake of mis-booked realized P&L per occurrence ($50 of error on a $25 trade), a duplicated outcome in the learner's training set, and a performance fee charged against a position booked twice.

**Fix.** Make `reconcile()` unrunnable off the queue: change the three fire-and-forget call sites to `this.enqueue(() => this.refreshWallet())`, or split `refreshWallet` into a queue-free balance read and a queued reconcile trigger. Additionally, skip any position in `this.exiting` inside reconcile's `inStore` loop, and add `if (p.status !== "open") return r;` at the top of `_bookExit` so a late fill can never double-book a closed position.

**Reviewer's correction.** Confirmed as written at the code level, but downgrade to medium on frequency. reconcile can only run off-queue via the guarded branch at engine.mjs:296-301, which needs an untracked holding of qty >= 1 that is not already in `_knownForeign`, and reconcile permanently resolves every such holding on its first pass (adopt at engine.mjs:1004, or `_knownForeign.add` at 988), so it cannot repeat for the same token in a session. That has to coincide with the ~0.4-3.2 s `_settle` window of an in-flight 100% sell. The missing `this.exiting` guard at engine.mjs:1007 and the missing `p.status !== "open"` guard at engine.mjs:865 are both real and worth fixing.

---

## [MEDIUM] Rejected candidates are recorded without their feature vector, so a refused mint that then ran can never enter training and no rule's false-positive rate is computable
`src/velocity/core/engine.mjs`:515

**Claim.** noteRejected() (engine.mjs:506-528) stores gate, reasons, tier, mcap at rejection and a peak, but never stores decision.features - even though the feature vector is right there on d (pipeline.mjs:107 puts features on every REJECT as well as every GO). The 'miss' record written at engine.mjs:542-547 likewise carries gate/reasons/tier/mcap/multiple and no features. retrain() filters usable = outcomes.filter(o => o && o.features && ...) at learner.mjs:73, so a miss can never become a training row even in principle. Separately misses() (engine.mjs:551-563) aggregates n / avgMult / best per reason with no denominator: it reports that COORDINATED_DUMP missed three runners but never how many times COORDINATED_DUMP fired, so no rule's precision is derivable from what is stored. Third, the miss watch can only see tokens the radar keeps re-serving: buildScoredResponse drops anything below the min score (server.production.mjs:8099), anything not re-scored within 10s (:8102), and anything failing the base filter (:8103) - which are exactly the tokens the scorer gave up on, i.e. the misses most worth measuring.

**How it fails.** Gate 1 flags COORDINATED_DUMP on 800 tokens over a week. Twelve of them 3x within 10 minutes and are written as 'miss' records; the other 788 rug. The operator's status page shows 'COORDINATED_DUMP n:12 avgMult 2.9' with no denominator, which reads as an expensive rule when it is in fact 98.5% correct. Meanwhile a genuinely wrong rule that blocks 400 tokens of which 200 ran shows n:200 - and because neither set carries features, retrain() cannot down-weight the signal behind either one. The system is structurally incapable of learning a rule is wrong.

**Impact.** This is the root cause of the whole subsystem being unfalsifiable. The gate funnel (hard rules 134, no edge 88, too weak 30, unsure 24, bad timing 10 = 286 refusals) is 286 uncounted experiments per window whose results are discarded. No dollar figure is derivable precisely because the data to derive it is what is missing.

**Fix.** Add features: d.features to the disqualified entry at engine.mjs:515 and to the miss record at :542. Add a rejection counter per (gate, reason) so misses() can return n_missed / n_rejected as a rate. Feed miss records into retrain() as pseudo-outcomes labelled by realised multiple (weighted down, since they were never actually held) so the ranker sees both classes, or at minimum export the joined (rejected features, ran/did-not-run) table for offline fitting. Also keep the last-known feature vector for a rejected mint so a miss can be attributed after the mint has fallen out of the scored feed.

**Reviewer's correction.** Keep the defect, downgrade to medium, and fix the evidence: kill-gate rejects (174 of the operator's 286, i.e. disqualifiers/viability/execution_window) carry no features anywhere because pipeline.mjs:75 builds them before edge.estimate() runs, so the fix must move feature extraction ahead of the kill gates, not just copy d.features. For the remaining 112 (confidence/ev) the features already reach the ledger as kind:'decision' rows (engine.mjs:498) and only need joining to the kind:'miss' rows by instrument. Correct line numbers: noteRejected engine.mjs:519-543 (entry written at :524), miss record :551-556, misses() :564-577, status :1068.

---

## [MEDIUM] No test covers an exit that keeps failing; lastExitError.count is written and never read, so a position that cannot be sold holds a slot forever with no alert
`src/velocity/core/engine.mjs`:845

**Claim.** `_closePosition` records `p.lastExitError = { code, reason, tried, at, count: (p.lastExitError?.count || 0) + 1 }` at engine.mjs:845, and nothing anywhere reads `count`: the only other references are the two `delete p.lastExitError` calls (:836, :852) and the status JSON (:1066). The alerter is invoked exactly once on the exit path, inside `finalizeFlat` (:861), which only runs for `NO_POSITION`. So a `GRADUATED` or persistently reverting sell retries every sweepRetryMs indefinitely, consuming one of `max_concurrent_positions`, with no alert, no halt and no escalation. The suite has no test for a permanently failing exit: the only failing-close fixture is t10:389 (`let fails = 1;`), which fails exactly once and then succeeds.

**How it fails.** A PONS position is held through curve completion (the pre-graduation-exit at exits.mjs:139 needs a tick to fire, and a token that graduates on a quiet feed produces none). Every subsequent close returns `GRADUATED` (pons/router.mjs:216). The position stays `open` forever, one of the user's 1-4 concurrency slots is permanently consumed, the operator's only signal is a `lastExitError` field buried in the status JSON, and the sweep retries the same doomed sell every 15 seconds for the life of the process.

**Fix.** Escalate on `lastExitError.count`: alert once past a threshold, and for terminal codes (GRADUATED, NO_CURVE) stop retrying and mark the position `stuck` so it stops counting against `max_concurrent_positions` while remaining visible. Add a test with a router whose `close` always fails, asserting an alert fires and the slot is released or the venue is frozen.

**Reviewer's correction.** Rewrite the claim: `count` is read — app/src/Simple.jsx:459 shows 'sell failed ×N' on the position card — so the user and the operator both have a visible signal. What is genuinely missing is machine escalation: no alert fires past any threshold, terminal codes (GRADUATED, NO_CURVE) are retried identically to transient ones, and the position keeps counting against risk.mjs:135 forever. The proposed fix and the missing test are both right as written. Severity medium stands.

---

## [MEDIUM] A lost or unmounted Railway volume silently orphans every open position — the engine marks them foreign forever and never alerts
`src/velocity/core/engine.mjs`:990

**Claim.** Reconcile decides whether a token in the wallet is the bot's by looking for a BUY `fill` or a `sent` order in the ledger. Both live only on disk under VELOCITY_DATA_DIR. If that directory is gone (volume never mounted, volume lost, or the default relative path landing on Railway's ephemeral filesystem), every open position fails both tests, is pushed to `rep.unknown`, added to `this._knownForeign`, and `continue`d — never adopted, never given a plan, never sold. Line 297 then excludes anything in `_knownForeign` from the periodic holdings check forever, so it is not even re-examined. The only notice is `this.log("warn", ...)` at 1023, which goes to the server log; the alerter call at 1031 fires only on `adopted || closed || frozen`, and an all-unknown reconcile has adopted=0, closed=0, frozen=false — so no webhook alert is ever sent.

**How it fails.** The operator deploys without adding the Railway volume (or leaves VELOCITY_DATA_DIR unset so it resolves to the ephemeral /app/data/velocity/users). Four users are each holding 4 open positions at ~$25. A deploy wipes the filesystem. Each user presses START again; reconcile reads 16 real token balances, finds no ledger for any of them, files all 16 as foreign, and logs one warn line per venue. No stop-loss, no max-hold, no crash-exit ever fires on any of them. Given that crash-exit is the modal outcome in the operator's own data (14 of 40 closes, -$25.24), those 16 positions decay to near zero. The operator's webhook stays silent throughout.

**Impact.** Full stake of every open position at the moment of the wipe: at 4 positions x $25 x N users, $100 per user per incident, and the incident recurs on every deploy until the volume is mounted.

**Fix.** Include `rep.unknown.length` in the alert condition at line 1031 and send it at `error` level with the instrument list. Log the resolved `rootDir` at boot and refuse to start (or alert) when it is empty while the wallet holds tokens. Treat a token whose balance appeared before this engine's first ledger record as adoptable with an unknown cost basis rather than as foreign, so at least an exit plan attaches.

**Reviewer's correction.** Downgrade critical -> medium and drop the 'silent / permanently unrecoverable' framing. Correct statement: when the ledger is lost, reconcile files every real holding as foreign (engine.mjs:990) and no automated exit plan is ever attached, so STALL, max-hold and crash-exit are silently disabled for those positions; and the operator webhook stays quiet because engine.mjs:1031 omits rep.unknown from the alert condition. The positions are NOT invisible or unrecoverable: engine.mjs:1070 marks them tracked:false, Simple.jsx:461-463 lists them to the user with a Sell button, and hub.sweepWallet (hub.mjs:472-484) sells the whole Solana wallet without consulting the ledger. Fix (a) add rep.unknown.length to the alert at 1031 at error level, and (b) log the resolved rootDir at boot.

---

## [MEDIUM] volume-sell never stamps tpHit, so it re-fires every tick and can liquidate a winner 25% at a time
`src/velocity/core/exits.mjs`:127

**Claim.** checkVolumeExit is guarded by `(pos.tpHit || 0) > 0` (exit-plan.js:225), but the regex in evaluatePumpfun that stamps tpHit after a PARTIAL_SELL — `/^TP1|trailing|fade-trim|momentum-trim/` — does not match the reason 'volume-sell'. So the guard is never armed and the exit repeats on every tick for as long as the buy-volume spike lasts, each repetition a separate sell transaction.

**How it fails.** A position up +30% sees sustained buying (recentBuyVol > 3x the per-minute average). The bondli radar tick poll runs at 1 Hz (feed.mjs:175, tickMs 1000). Each tick returns PARTIAL_SELL 25% (40% above +50%), so the engine sends a sell every second: 25%, then 25% of the rest, then 25% of the rest — the winner is scalped to nothing during exactly the buying pressure that should be held through, paying a ~1.5% pump/portal fee plus a priority fee on each leg.

**Impact.** Ladder-style scalping of exactly the trades ride mode was rebuilt to stop scalping, at ~1.5%+ fee per leg. Not present in the observed 40-close window only because so few positions reached +15%.

**Fix.** Add 'volume-sell' to the stamping regex at exits.mjs:127, or better, stamp tpHit for ANY PARTIAL_SELL that is not a RIDE-trail moonbag. Note the same wrong-order problem as finding 3 applies: stamp it in _bookExit on a confirmed fill, not in the evaluator.

**Reviewer's correction.** Two numbers in the finding are wrong: the repeats are serialized by the engine's exiting guard (engine.mjs:786-796), so the rate is one leg per confirm cycle rather than one per 1 Hz tick; and the incremental cost per extra leg is the ~$0.061 priority+base fee, not "~1.5% pump/portal fee per leg" (that fee is proportional to notional and is paid once across all legs). The stamping fix must also go on the returned stamp (exits.mjs:175-178), not on pos, since the pre-stamp bug is already fixed.

---

## [MEDIUM] retrain() is a provable no-op on the live feature distribution: the 0.6 accuracy threshold is unreachable, so every permutation importance is 0 and the weights never change
`src/velocity/core/learner.mjs`:68

**Claim.** retrain() classifies an outcome as a predicted win when scoreFeatures() exceeds threshold=0.6 (accuracy() at learner.mjs:58-62; the default is set at :68 and the only caller, engine.mjs:931, never overrides it). In the live path only 4 of the 7 features are populated - apeScore, chartHealth, walletAge, freshWalletRatio; memeticQuick / survivorMatch / whaleBullish arrive null (edge.mjs:15-23 opt(), server.production.mjs:2060). scoreFeatures renormalises over the present weights (wsum = 0.60), so with the observed apeScore band 0.41-0.44 the maximum attainable score is (0.40*0.44 + 0.10 + 0.05 + 0.05)/0.60 = 0.6267, and crossing 0.60 needs chartHealth >= 0.92 AND walletAge >= 0.92 AND freshWalletRatio <= 0.08 at the same instant. Every training row therefore lands on the same side of the threshold, accuracy() is a constant equal to the loss rate whatever the weights are, all importances collapse to <= 0, total == 0 at :85, share falls back to w at :88, next == current, and changed is false at :114. weights.save() (engine.mjs:932) is never reached and store.state.weightsVersion stays 0 forever. The entire DP8 learning loop is dead on the data it actually receives.

**How it fails.** The engine closes 50 pump.fun positions, _bookExit fires retrain() (engine.mjs:885). retrain reads 300 outcomes, all with ranked in [0.30, 0.59]. Every permuted copy scores the same class, importance is 0 across the board, total = 0, next = current, changed = false. No weights record is written, no version is saved, and the operator sees weightsVersion 0 after months of trading. If a feature really is mispriced - say freshWalletRatio should count harder - no amount of trading can ever reveal it.

**Impact.** The ranking model is frozen at hand-picked defaults forever. With entries pinned at the score floor (41-44, tier 3, p_win 0.30) and the earlier window at 17% wins / -$25.81 on 40 trades, the one mechanism designed to correct that cannot fire. Cost is the full difference between a tuned and an untuned ranker - unbounded, but on the observed book roughly -$0.65/trade.

**Fix.** Do not fix a decision threshold in the accuracy metric that is unrelated to the deployed one. Pass the venue's live decision boundary through from the caller (engine.mjs:931 -> retrain({..., threshold})): the GateRunner rejects below edge.minConfidence, which is 0.40-0.55 per AGGRESSION level (edge.mjs:48-55, pipeline.mjs:109), and confidence = ranked + tier bonus. Better still, replace the 0/1 threshold accuracy with a threshold-free ranking objective (AUC or Spearman of ranked vs pnl_usd) so importance does not depend on any cut point. Add a startup assertion that at least 20% of the training rows fall on each side of whatever threshold is used, and log 'importance all zero' rather than silently returning changed=false.

**Reviewer's correction.** Downgrade to medium and restate: accuracy()'s hard-coded threshold=0.6 (learner.mjs:68) sits above ~99% of the entered-trade distribution, so permutation importance is identically 0 in most retrains (measured: 19/30 at minConfidence 0.40 with a live-shaped feature set) and the importance channel contributes nothing. It is NOT a no-op — the sacred-inversion branch (learner.mjs:95-106) plus renormalisation (:108-109) still rewrites and saves the weight vector in the majority of runs, so weightsVersion advances on changes that carry zero measured information, which is worse than being frozen. Drop the 'only 4 of 7 features populated' premise (memeticQuick and walletAge are populated; survivorMatch is populated exactly when finding 5's precondition holds) and the wsum=0.60/max=0.6267 arithmetic. Correct caller line is engine.mjs:951.

---

## [MEDIUM] Weight constraints are clamped before renormalisation, so repeated retrains push apeScore 21% past its declared maximum
`src/velocity/core/learner.mjs`:108

**Claim.** retrain clamps each blended weight into [min,max] at learner.mjs:91, then divides every weight by their sum at :108-109 to make them sum to 1. Renormalisation happens after the clamp and is not re-checked, so whenever the post-clamp sum is below 1 the division scales every weight up and can lift one past its own max. The module's own header claims 'Every weight stays inside its constraint' (learner.mjs:5) and the T8 test asserts it (t8-learner.test.mjs:28-31) - but the test runs exactly one round starting from DEFAULT_WEIGHTS, the one case where the clamp does not bind. Iterated, the box is not invariant and there is no fixed point inside it.

**How it fails.** Once finding 1 is fixed and the learner starts moving, each retrain (every 50 closes) pushes apeScore further above its cap while chartHealth, walletAge and freshWalletRatio decay toward theirs. Within a dozen retrains - about 600 closed trades - the ranker has collapsed onto a single feature, which is precisely the outcome WEIGHT_CONSTRAINTS exists to prevent, and the operator has no signal that it happened because r.violations only records sacred-sign disagreements, not bound breaches.

**Impact.** No loss today because the learner cannot move at all (finding 1). The moment the threshold is corrected, the bounded-learner guarantee that the whole DP8 design rests on stops holding.

**Fix.** Normalise first, then clamp, then re-normalise the unclamped remainder into the slack (a small water-filling loop), or project onto the intersection of the simplex and the box. Either way, assert after the fact: if any weight is outside its constraint, push a violation record and refuse the save. Extend t8-learner.test.mjs to feed retrain its own output for 10 rounds and assert the bounds each round, not just the first.

**Reviewer's correction.** Confirmed at medium. Two precisions: the drift is not monotonic (my run dips at rounds 7, 11 and 12 while staying above the cap), and it requires a concentrated positive-importance signal — the sacred-pin path alone rescales by at most ~1.03 and converges without breaching any bound. Correct that the T8 test's single-round pass is at t8-learner.test.mjs:23-35.

---

## [MEDIUM] The sizer's Kelly never sees costs or loss_fraction, so NO_EDGE cannot refuse a negative-EV trade
`src/velocity/core/risk.mjs`:140

**Claim.** `kellyFraction(p_win, payoff)` is computed from the raw estimate only. The sizer never reads `decision.ev`, `decision.costs` or `decision.loss_fraction`, all of which the GateRunner has already attached (pipeline.mjs:107). It therefore returns a positive fraction for exactly the trades the EV gate has priced as losers, and NO_EDGE fires only when the *gross* edge `p*payoff-(1-p)` is negative. Separately, the two modules disagree on units: pipeline.mjs:31 converts the R-denominated edge into stake units with `lossFraction`, while kellyFraction treats `payoff` as though a loss costs the full stake.

**How it fails.** Tier 3 on priors: p_win 0.30, payoff 3.0. GateRunner computes ev = -0.018 and would REJECT, but takes the PROBE branch because `edgeBeforeCosts = 0.20 > 0`. The decision reaches the sizer carrying ev = -0.018. The sizer recomputes Kelly from p_win and payoff alone, gets +6.67%, and returns a stake. Nothing between the EV gate and the wire ever re-checks that the trade is worth taking; the sizer is structurally incapable of saying "this is negative EV". Over 40 such trades: expected -$18, observed -$25.81.

**Impact.** -$0.45 expected per $25 trade at the tier-3 prior; -$18 over the observed 40-trade window, against -$25.81 actually realized.

**Fix.** Pass the decision's own EV into the sizer and refuse on it: `if (!(decision.ev > 0) && !decision.probe_allowed) return zero('NEGATIVE_EV');`. Then make the Kelly cost- and unit-aware: `const L = decision.loss_fraction > 0 ? decision.loss_fraction : 1; const netEdgeR = decision.p_win * decision.payoff - (1 - decision.p_win) - (decision.costs?.fraction || 0) / L; const f_full = Math.max(0, netEdgeR / (decision.payoff * L));`. At minimum log NO_EDGE vs NEGATIVE_EV separately so the funnel distinguishes them.

**Reviewer's correction.** Retitle to "kellyFraction prices a loss at the full stake while expectedValue prices it at loss_fraction, under-sizing by ~1/L and pinning every realistic hosted account to the min-stake floor". Drop the "-EV trades reach the wire because the sizer is blind" framing: the EV gate refuses them (pipeline.mjs:110/121) and the only survivors are intentional probes. Corrected per-trade EV at the tier-3 prior is -$0.236 on the $10 the bot actually stakes. Medium (structural, conservative direction), not critical.

---

## [MEDIUM] The governor's throttle is binary, not graduated: 0.5/0.7/0.8 all size identically to 1.0
`src/velocity/core/risk.mjs`:166

**Claim.** The min-stake floor is applied whenever `t >= 0.5`, and because the raw Kelly stake is always below min_stake at the hosted envelope, every throttle in [0.5, 1] produces the same full stake. Every throttle below 0.5 produces no trade at all. Every graduated brake the governor computes — overconfidence 0.5, tilt level 3/4 0.5, loss aversion 0.8, recency bias 0.8, GRINDING regime 0.7 — therefore has literally no effect on size.

**How it fails.** The governor detects overconfidence — stated p_win 0.30 against a realized 0.17, which is precisely the operator's earlier window — and flags mult 0.5 with the message "sizes cut to a quarter" or "half". The sizer halves $1.67 to $0.83, then floors it back to $25. The stake is unchanged. The operator reads a log line saying sizes were cut and no size was cut. Conversely PVP regime (0.4) is a full stop rather than a 60% reduction, because 0.4 < 0.5 skips the floor and the sub-minimum stake is then rejected.

**Impact.** Indirect: the entire meta-governor (overconfidence, tilt, recency, loss aversion, regime) is inert as a size brake at the shipped hosted configuration.

**Fix.** Make the throttle act on something the floor cannot undo: apply it to admission (e.g. skip a proportion of GO decisions, or require a higher tier / EV threshold as the throttle falls) rather than only to a stake that is already pinned at the venue minimum. If the floor stays, the governor must at least log that the throttle was absorbed — `caps.push('THROTTLE_ABSORBED_BY_MIN_STAKE')` — so a cut that did not happen is visible.

**Reviewer's correction.** True for equity below roughly $600 (scaled by kelly_fraction) — which is the 0.5-2 SOL band the panel itself recommends — where every throttle in [0.5,1] yields exactly $10 and every throttle below 0.5 yields nothing. NOT true above that: at 5 SOL the throttle is fully graduated ($16.66/$13.33/$11.66/$10). Numbers are $10, not $25. The PVP-0.4 point is backwards (stopping is stricter than cutting). Root cause is the kellyFraction unit bug in finding 1. Medium, not high.

---

## [MEDIUM] kellyFraction assumes a loss costs 100% of stake, under-sizing 6.7-10x, so every stake collapses to MIN_STAKE_FLOOR — the most expensive point on the drag curve
`src/velocity/core/risk.mjs`:98

**Claim.** kellyFraction returns (p*b - q)/b, which is Kelly only when a loss forfeits the whole stake. Here `payoff` is avgWin/avgLoss and one average loss is loss_fraction of stake (0.10-0.15), so the correct fraction is (p*b - q)/(b*L). The sizer reads decision.payoff and decision.p_win — the same two numbers pipeline.mjs:28-32 was explicitly rewritten to convert from R units into stake units with lossFraction — but risk.mjs was never given the same treatment, and decision.loss_fraction is carried in the decision record (pipeline.mjs:107) and ignored here.

**How it fails.** Kelly is never the binding constraint: for tier 3 at kelly_fraction 0.25 the sizer asks for 1.67% of available, which is under $10 for any bankroll below $600, so risk.mjs:180 floors it to min_stake_usd. Every trade is therefore taken at $10, where the fixed cost is 1.23% of stake instead of 0.49% at $25 — the sizer's own arithmetic error pushes every trade onto the worst point of the cost curve it is being judged against. The same floor also silently voids the probe's whole safety mechanism: risk.mjs:178-182 raises the stake back over the model's 0.4x cap and records MIN_STAKE_OVER_MODEL_CAP, so a "reduced-size probe" is full size for anyone whose per_trade_max is $25 or less.

**Impact.** +0.5 to +0.9 points of drag per trade from being pinned at $10 instead of ~$27; and the probe's 0.4x size reduction is inert at every default configuration.

**Fix.** kellyFraction(p_win, payoff, lossFraction = 1) => Math.max(0, (p*payoff - (1-p)) / (payoff * lossFraction)), and pass decision.loss_fraction at risk.mjs:140. The existing kelly_fraction <= 0.5 cap in validateRisk plus PER_TRADE_MAX already bound the result, so this does not uncap risk — it just stops the floor from being the only thing that ever decides a stake.

**Reviewer's correction.** Downgrade to medium and correct two numbers. (1) 'Kelly is never the binding constraint' is false as a general claim: at per_trade_max $25 and $300 equity a tier-1 decision sizes to $20 with no caps at all — Kelly is the binding constraint there. It is true only for tier 3, which is admittedly nearly every entry. (2) The extra drag from being pinned at $10 is 0.49 points (4.397% vs the 3.906% minimum at $27.17), not '0.5 to 0.9'. (3) The proposed fix is not drop-in: dividing by loss_fraction gives f_full of 1.78 / 1.11 / 0.67, so at kelly_fraction 0.25 a tier-1 trade would ask for 44% of available equity and PER_TRADE_MAX would become the only thing bounding it. The defect is real (the same R-vs-stake unit confusion pipeline.mjs:18-32 was rewritten to fix), but the remedy needs the kelly_fraction recalibrated at the same time.

---

## [MEDIUM] 52% of the outcome sample the win rate, the EV gate and the learner are computed on is user-initiated, and neither statsFromOutcomes nor retrain filters on it
`src/velocity/core/stats.mjs`:8

**Claim.** Every close writes the same 'outcome' record (engine.mjs:877) whether the exit was the model's plan or a human's button. User sells carry by:'user' and reason 'USER_SELL' (hub.mjs:227) or 'USER_SWEEP' (hub.mjs:441); a flatten carries reason 'FLATTEN' with the same by:'user' threaded through from hub.mjs:193/203 into engine.mjs:376. statsFromOutcomes (stats.mjs:6-33) keys only on venue and tier and never inspects reason or by, and retrain's usable filter (learner.mjs:73) only requires features and a finite pnl. So p_win, payoff and loss_fraction - the numbers the EV gate at pipeline.mjs:105 and the sizer consume once a tier reaches minOutcomesForStats=30 (edge.mjs:135) - are measured over a sample in which a human's exit timing is treated as the model's. On the operator's own 40-close window that is 16 user sells (-$15.12) plus 5 flatten closes (+$21.38) = 21/40 = 52.5% of the sample. Worse, one close is a FLAT_AT_VENUE bookkeeping entry (finalizeFlat, engine.mjs:845-850) that books proceeds of 0 and therefore a -100% loss (-$25.62); that single row is roughly an 8x outlier against a designed stop of 10-15% and it lands directly in avgLoss, hence in loss_fraction (stats.mjs:28), which the EV formula multiplies the edge by (pipeline.mjs:31).

**How it fails.** A user watches a position, panics, and sells at -8%. That close is written as a tier-3 outcome with pnl_usd < 0. Sixteen such sells in forty closes drag the measured tier-3 p_win from whatever the exit plan would have produced down to the human's. Once tier 3 crosses 30 outcomes the EV gate switches off the priors (edge.mjs:135) and starts pricing every future tier-3 trade with a win rate the model never produced. If the human is a worse timer than the plan, the gate then refuses trades the plan would have won; if better, it over-sizes.

**Impact.** p_win, payoff and loss_fraction are the three inputs to expectedValue (pipeline.mjs:28-32) and to the Kelly sizer. On the observed book loss_fraction is inflated ~29% by one bookkeeping row alone, which understates EV and shrinks every subsequent stake; the 52% user-exit contamination biases p_win in whichever direction the operator happens to trade.

**Fix.** Filter statsFromOutcomes and retrain to outcomes the model owns: exclude by === 'user' and exclude flat_at_venue records (the field is already written at engine.mjs:877). Keep them in review() and truePnl, which are about money, and out of the statistics that feed decisions. Alternatively record a censored flag and treat a user sell as a right-censored observation rather than a loss.

**Reviewer's correction.** Keep the observation, downgrade to medium, and correct three things: (a) the exact lines are engine.mjs:890 (outcome, carries `by`), hub.mjs:219/229/253/467, finalizeFlat engine.mjs:858-863; (b) a sweeper-retried flatten carries by:'retry' (engine.mjs:330), so a `by==='user'` filter is incomplete; (c) drop the argument that the FLAT_AT_VENUE row should be excluded — plans.mjs:21-23 declares worst_case_fraction 1.0 for every pump.fun tier, so a -100% close is a designed outcome and a real loss, and removing it from loss_fraction would understate risk to the EV gate. The defensible core is narrower: p_win is documented as the model's win probability but is measured over trades a human terminated, and the code has the `by` field to separate them and does not.

---

## [MEDIUM] hub.start() clears every store halt, including a reconcile safety freeze set seconds earlier
`src/velocity/hub.mjs`:161

**Claim.** `engine.resume(venue)` clears both the global halt and the venue halt unconditionally, and only the daily-loss halt is restored by the evaluateGovernor call inside it. hub.start calls it immediately after `engine.start()`, which has just run `reconcile()` — and reconcile freezes the venue when it cannot read positions from the router. The freeze is wiped and the venue is then set live without a successful reconciliation.

**How it fails.** A returning user's store has pumpfun mode "live". On restart the Solana RPC is briefly unavailable, `router.positions()` throws, reconcile freezes pumpfun with "reconcile failed: ...". The very next line un-freezes it. `router.init()` and `router.health()` then succeed a second later, so setVenueMode returns ok and the engine goes live holding a store position set that was never checked against the wallet: positions the wallet holds but the store does not know about get no exit plan and no max-hold, and store positions already sold at the venue keep consuming MAX_CONCURRENT slots — which at this envelope means one stale slot freezes the whole bot.

**Impact.** Untracked holdings get no exit plan; a stale open slot blocks all entries. No fixed dollar figure, but it is the path by which a position is left with no stop.

**Fix.** Make resume selective. Tag halts with an origin (`by`) and have resume clear only user- and governor-originated halts: `const h = this.store.state.halt.venues?.[venue]; if (h && /^reconcile/.test(h.reason)) return this.store.state.halt;`. Or, in hub.start, re-run `await engine.reconcile()` after the resume and before setVenueMode, and refuse to go live if it still freezes.

**Reviewer's correction.** Confirmed, but hub.mjs:197 not :161, and the blast radius is smaller than stated. The untracked-holdings half self-heals: refreshWallet re-runs reconcile within ~2 min on any untracked token (engine.mjs:298-301), and a successful reconcile clears its own freeze (engine.mjs:1024). The durable half is the phantom store position — nothing ever triggers a reconcile for a store row the wallet no longer holds — which costs one of three concurrency slots, not "the whole bot". Requires a returning live-mode user and a transient RPC fault that recovers between reconcile and setVenueMode. Medium.

---

## [MEDIUM] The performance fee transfer runs off the queue: PONS nonce collision with a live trade, and a SIGKILL loses the fee record
`src/velocity/hub.mjs`:192

**Claim.** `engine.on("outcome", ...)` (hub.mjs:192) calls `settleFee` without awaiting it, and `_bookExit` emits `outcome` from inside the queue (engine.mjs:903). So `settleFee` -> `liveRouter.transferSol` (hub.mjs:295) executes concurrently with whatever the queue does next. On PONS the router signs with a bare `new Wallet(secret, provider)` (src/velocity/venues/pons/router.mjs:52) — no NonceManager — so `wallet.sendTransaction` for the fee and `curve.buy`/`curve.sell` for a trade can both populate the same pending nonce. Separately, the `kind:"fee"` ledger record is only written AFTER the transfer confirms (hub.mjs:296-297), so a SIGKILL in between takes the user's money with no record of it.

**How it fails.** A profitable PONS position closes. `_bookExit` emits `outcome`; `settleFee` starts an ETH transfer (which waits up to `confirmTimeoutMs` 25 000 ms for a receipt, pons/router.mjs:295-296). The queue immediately continues to the next candidate and calls `curve.buy(...)` from the same wallet. Both read `getTransactionCount(address, "pending")` before either is mined and get the same nonce: one is dropped as 'replacement underpriced' / 'nonce too low'. If the loser is the trade, the buy fails and `enter()` puts the mint on a 60 s cooldown; if it is an exit chunk mid-`close()`, the chunk loop `break`s and abandons the unsold remainder as a partial fill. The crash variant: the fee leaves the trading wallet, the process dies before hub.mjs:296, and there is no `fee` record, no `recordGlobalFee`, and the user's baseline wallet reading drops so `truePnl().since_start_usd` reports the fee as a trading loss.

**Impact.** Per event: one dropped PONS trade (a dropped SELL leaves a $25 position exposed with its stop already fired), or one fee (~5% of realized profit; ~$1.19 of the $23.81 window) taken with no record and shown to the user as a trading loss.

**Fix.** Run the fee on the engine queue (`u.engine.enqueue(() => this.settleFee(wallet, position))`) so it can never overlap a trade from the same key, or better, batch fees and settle them on a timer when no order is in flight. Write an intent record (`kind:"fee", scope:"platform", stage:"sending", sol, positionId`) BEFORE `transferSol` and update it after, so a crash leaves a recoverable trace. For PONS, wrap the signer in ethers' `NonceManager` so two concurrent sends from one key cannot collide.

**Reviewer's correction.** Confirmed except for the truePnl attribution. The fee shows as a reduction in since_start_usd because truePnl (engine.mjs:252-283) reads wallet balances against state.baseline.quote and never reads the ledger `fee` record — that symptom occurs whether or not the crash happens, so it is not evidence for this finding. The crash's real cost is a missing user-visible record and a missing recordGlobalFee. Also note the arming condition the finding omits: hub.mjs:282 gates on `f.fee > 0.0005` of the quote asset, which on PONS means 0.0005 ETH and therefore ~$30-40 of realized profit before any fee transfer is attempted at all, so the nonce race needs a rare large PONS winner to be possible.

---

## [MEDIUM] The abandoned free/pro/VIP revenue model still sells a 10 SOL VIP tier that the hosted bot's fee code cannot see
`src/velocity/hub.mjs`:319

**Claim.** hub.mjs:138-141 states in a comment that "the old free / pro / vip ladder was a different revenue model and no longer decides anything here", and flatFee (319-323) charges a flat this.feePct with no tier lookup. But the tier system is still live and still takes money: GET /api/pricing advertises `vip: { fee: "0%", price: "10 SOL" }`, and POST /api/access/activate-vip verifies a real 10 SOL on-chain transfer and grants the tier. server.production.mjs:11199 passes {calculateFee, resolveTier, getUser} into the hub and 11204 passes {getUser, resolveTier} into mountVelocityRoutes -- the hub only ever calls recordTradeOutcome, recordGlobalFee and isOwnerWallet, and mountVelocityRoutes' signature (hub.mjs:530) destructures only {hub, requireOwner, getTradingWallet}, so both extras are silently dropped. Separately, on the one path that does honour the tier, VIP is not 0%: fee-engine.mjs:186-188 charges VIP NETWORK_FEE_PCT (default 2%) as a "silent network optimization fee (appears as normal slippage)".

**How it fails.** A user reads /api/pricing, sends 10 SOL to PLATFORM_WALLET and POSTs the signature to /api/access/activate-vip. They are marked tier:vip, whitelisted:true. They then run the bot -- the only trading product bondli.fun ships -- and hub.settleFee calls flatFee, which returns net * this.feePct / 100 with feePct = VELOCITY_FEE_PCT or DEFAULT_FEE_PCT = 5. They pay the same 5% of profit as everyone else. The 10 SOL bought nothing.

**Impact.** 10 SOL (~$2,000 at SOL $200) per VIP buyer, refundable in principle; plus an advertised-0%-actually-2% discrepancy on the legacy path for every VIP who used it

**Fix.** Pick one. Either delete the tier system (routes /api/access/activate-vip, /api/access/activate-pro, /api/pricing's ladder/vip block, PROFIT_LADDER, getEffectiveFeeRate, resolveTier's vip branch, and the unused fee/resolveTier arguments at 11199 and 11204) so the flat VELOCITY_FEE_PCT is the only rate; or make hub.flatFee consult resolveTier and honour VIP at 0%. Either way fix deploy/HOSTED_VELOCITY.md:26 and, if any tier survives, stop advertising 0% while fee-engine.mjs:187 charges 2%.

**Reviewer's correction.** 'The 10 SOL bought nothing' is refuted. VIP does still unlock real functionality in server.production.mjs: multiple trading wallets (:3619 and :3697 both gate on tier==="free" && !whitelisted), the VIP referral dashboard (:8729-8732), the compute/GPU routes (:8789, :8850) and smart-money activity (:307, :320). What the 10 SOL does not buy is the one thing /api/pricing names first — 0% fee on the only trading product bondli.fun ships. Also add: /api/pricing's free line is wrong in the same way — it advertises '25% → 5% (profit ladder)' while hub.flatFee charges a flat 5% regardless, so both advertised rates on the live pricing endpoint describe a fee model that no longer runs. And hub.flatFee's only exemption is isOwnerWallet — there is no code path at all by which whitelisted/vip pays less.

---

## [MEDIUM] Alerts are off by default and the failing-sell loop never raises one anyway
`src/velocity/hub.mjs`:188

**Claim.** Every engine's alerter is built with `webhookUrl: process.env.ALERT_WEBHOOK_URL || null`, and `.env.example` ships that variable commented out (line 112). With it null, `Alerter.send` skips the entire delivery block (alerts.mjs:22) and the alert reaches only the ledger and the status page — and nothing at boot warns that alerting is inert, unlike the equivalent warnings for WALLET_ENCRYPTION_KEY (keyvault.mjs:20), JWT_SECRET (wallet-auth.mjs:18) and PLATFORM_WALLET (hub.mjs:160). Independently, the single most operationally urgent condition — a sell that keeps failing on an open position — is not an alert even when the webhook is set: it writes a ledger row, sets `p.lastExitError` with a running `count`, and logs a warn. Nothing reads that count.

**How it fails.** A user's trading wallet drops below the SOL needed to pay fees, or the RPC starts refusing sends. `closePosition` fails on every tick. `p.lastExitError.count` climbs into the hundreds. The ledger fills with `exit ... failed:true` rows, the panel shows "sell failed x312", and the operator — who is not looking at that user's panel — learns nothing. The position rides through its stop-loss and its max-hold to zero.

**Impact.** The full stake of any position whose exit is stuck. At the observed ~$25 sizes, $25 per stuck position, and a wallet-level cause (no SOL for fees, bad RPC) stalls every open position at once.

**Fix.** Log one line at boot when ALERT_WEBHOOK_URL is unset, in the same place the PLATFORM_WALLET warning is emitted (hub.mjs:160). Then in engine.mjs, after line 845, `if (p.lastExitError.count === 3 || p.lastExitError.count % 20 === 0) this.alerter?.send("error", ...)` naming the instrument, the code, and the notional at risk. Also add an alert when a wallet's free SOL falls below the round-trip fee reserve, which is the usual root cause.

**Reviewer's correction.** One addition that strengthens reachability, one that narrows the second half. Strengthening: deploy/HOSTED_VELOCITY.md §1's Railway variable table does not list ALERT_WEBHOOK_URL at all, so an operator following the repo's own checklist ships with alerting inert. Narrowing: the engine is not alert-free around exits — engine.mjs:392 alerts when a flatten leaves positions open and finalizeFlat (engine.mjs:861) alerts on a position booked as a total loss. The precise gap is the tick- and sweep-driven retry loop at engine.mjs:844-846, which is the unattended one, and the free-SOL-below-fee-reserve condition that usually causes it.

---

## [MEDIUM] PonsFeed pushes a new Timeout into this._timers on every poll and never prunes it — measured 5.8 MB/day
`src/velocity/venues/pons/feed.mjs`:323

**Claim.** The PONS poll loop schedules its next tick with `this._timers.push(setTimeout(tick, this.pollMs))`. Nothing removes settled entries; the array is only cleared in `stop()` (line 327), which the hosted server never calls — the shared `ponsFeed` is started once at boot (server.production.mjs:11203) and runs for the life of the process. The array therefore grows by exactly one retained Timeout object per poll, forever. I measured it.

**How it fails.** The Railway service runs for a month without a deploy with VELOCITY_PONS=1 and the default PONS_POLL_MS=3000. ~864,000 dead Timeout objects accumulate, ~175 MB of live heap on top of the radar's token map, the per-user engines and their ledger `recent` ring buffers (20,000 records each). The container hits its memory limit (deploy/docker-compose.yml:22 caps it at 512M; Railway plans are similar) and is OOM-killed. An OOM kill is not SIGTERM, so not even stopAll() runs — every open position across every user is abandoned exactly as in finding #3, and the process comes back with an empty hub.

**Impact.** Indirect but real: it is the most likely unattended cause of the abandoned-position scenario in finding #3, whose cost is the full stake of every open position at the moment of the kill.

**Fix.** Stop accumulating: keep a single handle, `this._timer = setTimeout(tick, this.pollMs)`, and `clearTimeout(this._timer)` in `stop()`. If the array must stay for symmetry with the base class, splice the fired handle out at the top of `tick`.

**Reviewer's correction.** Retitle and broaden: the leak is in BOTH always-on feeds, and the pumpfun one is the larger half. src/velocity/venues/pumpfun/feed.mjs:170 pushes a Timeout per tick from two concurrent loops (start() at :174-175, configured pollMs 2000 / tickMs 1000 at server.production.mjs:11190) = 129,600 timers/day, versus PONS's 28,800 at feed.mjs:323. src/velocity/venues/polymarket/feed.mjs:260 is the same pattern. I measured ~174 bytes/timer net (50k retained fired handles, gc'd twice: heap 3.67 -> 12.35 MB), so the real rate is ~27.6 MB/day, ~830 MB/30 days — an OOM against the 512M cap in deploy/docker-compose.yml:22 in about 2.5 weeks, not 30 days. Fix both files the same way (one `this._timer` handle, cleared in stop()).

---

## [MEDIUM] Nothing serializes nonces on the EVM wallet: the performance-fee transfer and the off-queue hub sweeps race the engine's own sells
`src/velocity/venues/pons/router.mjs`:279

**Claim.** PonsLiveRouter never sets or tracks a nonce — buy (:107), approve (:217), sell (:243) and transferSol (:281) all let ethers populate it, and ethers v6 resolves it per-transaction with getNonce("pending") with no caching. Two transactions built in the same window therefore get the same nonce. The engine's own calls are serialized by its promise queue, but two callers escape it: settleFee is attached as a fire-and-forget listener on the outcome event (hub.mjs:166) and later calls liveRouter.transferSol (hub.mjs:269) with no enqueue, and sweepWallet/sellHolding call ethRouter.close directly (hub.mjs:466 and :415) while the engine keeps processing ticks.

**How it fails.** A profitable PONS position closes. _bookExit emits 'outcome' (engine.mjs:880) and returns; the hub's listener starts settleFee, which awaits holderWaived and then sends the fee transfer. In that window the engine dequeues the next tick and starts a sell for another position. Both build a type-2 tx with the same pending nonce and the same fee data, so the sequencer rejects the second as 'replacement transaction underpriced' / 'nonce too low'. The rejected sell surfaces as SEND_FAILED (router.mjs:258) and the position is left open with a lastExitError; the same collision on a fee transfer silently loses that fee.

**Fix.** Give PonsLiveRouter a single-flight send lock: an internal promise chain that every sendTransaction-producing path (submit, approve, each sell chunk, transferSol) awaits, so only one transaction is being populated and broadcast at a time from this wallet. Alternatively wrap this.wallet in ethers' NonceManager at init (router.mjs:52) and route the hub's off-queue calls through engine.enqueue.

**Reviewer's correction.** Confirmed mechanically, with corrected line numbers: the outcome listener is hub.mjs:192, transferSol is called at hub.mjs:295, sweepWallet's off-queue close is hub.mjs:500, sellHolding's is hub.mjs:451; the router's unnonced sends are router.mjs:107 (buy), :224 (approve), :250 (sell chunk) and :295 (transferSol). Two refinements: the race window is only from tx1's populate to the node reflecting it in the pending count (one RPC round trip), so this is intermittent, not deterministic; and the two halves have very different consequences — a collided SELL surfaces as SEND_FAILED (router.mjs:272) and is retried on the next tick, i.e. self-healing, whereas a collided FEE transfer throws out of settleFee into the fire-and-forget catch at hub.mjs:192, which only logs. There is no retry path for a fee anywhere, so that one is permanently lost platform revenue.

---

## [MEDIUM] PONS sells fall back to minOut = 0 before they try a smaller size, and the MaxUint256 approve broadcasts the sell a block in advance
`src/velocity/venues/pons/router.mjs`:146

**Claim.** `_sellShape` searches `keeps = [0.85, 0.5, 0]` in the INNER loop and `fractions = [1,2,4,8]` in the outer loop, so the first thing it does when the 85%-of-quote dry run reverts is retry the same full size at 50%, then at 0% of quote. `keep = 0` produces `minOut = toWei(0)` at line 246, i.e. the whole position is sold with no price floor whatsoever — the curve may return one wei and the transaction succeeds. Sizes are only halved after all three floors have been abandoned at full size. Separately, line 224 sends a standalone `approve(curve, MaxUint256)` transaction and waits for its receipt before the sell, which is a public, unmistakable one-block-ahead announcement that this wallet is about to dump its entire balance of that token.

**How it fails.** The bot holds a PONS position on a young curve where phantomQuote dominates the virtual reserve, or on a curve with any deduction the 15-entry CURVE_ABI does not model. The 85% and 50% dry runs revert, `_sellShape` returns keep=0, and the bot sends `sell(allUnits, 0, self)`. The deployer, who has been watching for the approve transaction, dumps first in the same or previous block; the sell executes at whatever is left because minOut is zero. The exit is reported as ok with a real `sol_received` of nearly nothing and the position books as a ~100% loss that the exit logic believes was an orderly sale. The 'max hold: flat at venue' -$25.62 single close in the operator's log has exactly this shape.

**Impact.** Up to 100% of a PONS position (~$25 at the current stake) per occurrence, and it fires precisely on the young curves the bot targets.

**Fix.** Reverse the loop nesting: exhaust every fraction at the tight floor before ever loosening the floor, and drop 0 from `keeps` entirely — the floor should never go below something like 0.5, with a hard refusal (and an alert) when even the smallest chunk will not clear it. Use `realQuoteReserve()` (already in CURVE_ABI, chain.mjs:33) rather than the virtual reserve to bound `q.quoteOut` so the first dry run reflects what the curve can actually pay. Approve exactly `units` rather than MaxUint256, and only when allowance is short, so the approve does not advertise the full bag.

**Reviewer's correction.** Keep the structural defect: loop nesting at pons/router.mjs:149-152 tries full size at a zero price floor before any smaller chunk, and :246 reuses shape.keep=0 for every chunk in the send loop. Drop the phantomQuote mechanism — chain.mjs:92 states getReserves() returns the virtual reserves the contract itself trades on, so curveSellQuote is the contract's own formula, not an overestimate of it; reaching keep=0 requires the curve to pay under 50% of its own quote, which the finding assumes rather than shows. Note the precondition also bounds the impact: by the time keep=0 is chosen the position is already worth less than half its quote. Drop the attribution to the operator's -$25.62 close. Reachability is PONS-opt-in only (hub.mjs:171).

---

## [MEDIUM] PonsLiveRouter.known grows without bound and is poisoned by airdrops; positions() then does one sequential RPC per token on the single engine queue
`src/velocity/venues/pons/router.mjs`:312

**Claim.** `positions()` iterates `this.known` and awaits one `balanceOf` RPC per entry, serially, with no cache and no cap. `known` only ever grows: `seedRouterKnowledge` (engine.mjs:124-132) adds every instrument the ledger has ever seen, and `_rhInventory` adds every ERC-20 that has ever been Transferred into the wallet — `for (const t of Object.keys(scan.tokens)) ethRouter.track?.(t)` (hub.mjs:373), where `scan.tokens` is built from raw Transfer logs over up to PONS_SCAN_BLOCKS=1,500,000 blocks and is persisted to `rh-scan.json` and merged on every subsequent call. `positions()` is then called from `engine.refreshWallet()` (engine.mjs:293), which runs inside `sweep()`, which is on the engine's single serial promise queue (engine.mjs:114, 374-377) — the same queue that processes every tick and therefore every exit.

**How it fails.** An attacker mints a worthless ERC-20 on Robinhood Chain and, in one contract call, airdrops 1 wei of it to 2,000 different token contracts' worth of the victim's PONS bot address (or 2,000 distinct tokens to the one address — an L2 loop costing a few dollars of gas). The next time the user opens the Velocity panel, `/api/velocity/holdings` runs `_rhInventory`, which reads the Transfer logs, writes all 2,000 into `rh-scan.json` and calls `track()` on each. From then on every `refreshWallet()` — every 30 s, on the engine queue — performs 2,000 sequential `balanceOf` calls against a rate-limited public RPC. At ~150 ms each that is 300 s per sweep on a queue that also carries every tick-driven exit, so stop losses, trailing exits, the stall exit and even a user-initiated flatten simply never run. Open positions ride to zero. The victim's own trade history produces the same effect more slowly, with no attacker at all.

**Impact.** Full value of every open PONS position while the queue is blocked (~$25 each, up to maxPositions=10). Attacker cost is a few dollars of L2 gas.

**Fix.** Cap and prune `known` (LRU by last non-zero balance, plus a hard cap), batch the balance reads (multicall, or ethers `batchMaxCount` with Promise.all in chunks), cache `positions()` for the sweep interval, and never let `_rhInventory` promote a token into the router's tracking set unless it has a non-dust balance or appears in the ledger. Move `refreshWallet` off the engine's exit queue so a slow wallet read can never block an exit.

**Reviewer's correction.** Confirmed. Two adjustments: the airdrop variant needs the victim to open the Velocity panel once (holdings is behind requireOwner at hub.mjs:551), and the no-attacker variant is the stronger case — seedRouterKnowledge (engine.mjs:279-286) grows `known` monotonically from the ledger, so the sweep-time wallet read degrades on its own as trade history accumulates. Solana is unaffected (PumpfunLiveRouter.positions() at router.mjs:434 is a single RPC).

---

## [MEDIUM] The 5% performance fee is absent from the cost model and is charged per winning position with no netting against losers
`src/velocity/venues/pumpfun/edge.mjs`:178

**Claim.** costs() returns feeFractionRoundTrip + impact + fixed. The platform's own 5% performance fee — the largest cost after the venue fee — is not in it. Worse, flatFee is computed per closed position on (solOut - solIn) with no high-water mark and no netting across trades, so a user pays it on each winner even in a window that is net negative overall. The EV gate therefore approves trades on an edge the platform is about to take a slice out of.

**How it fails.** Observed 40-trade window: winners were ride-trail +$20.85 and flatten +$21.38 = +$42.23 gross, so roughly $2.11 left the user's wallet as performance fee while the window netted -$25.81. Because settleFee fires on every outcome with a positive net, a losing account still pays. The EV gate never priced that fee in, so it approved trades whose after-fee EV was ~1 point worse than it computed.

**Impact.** ~0.36% of stake per trade unmodelled; +1.0 point on the break-even win rate; ~$2.11 charged on the observed net-losing window.

**Fix.** Add a fee term to costs(): `perfFee = feePct/100 * p_win_estimate * expected_win_fraction`, threaded in from the hub's feePct (it is already per-user). Separately, give flatFee a per-user running high-water mark so the fee is on net new profit rather than on each winner in isolation.

**Reviewer's correction.** Downgrade to medium, and fix one piece of rhetoric: the fee is NOT 'the largest cost after the venue fee' — at 0.36% of stake it is the smallest term at every stake the sizer can return (fixed alone is 1.23% at $10, impact 0.42% at $25). It is ~8-9% of the modelled cost, i.e. a real but second-order omission. Add the sharper accounting point the finding misses: settleFee transfers real SOL out of the user's wallet but never touches store.state.day.realizedUsd or the position's pnl_usd — engine.chargeFee (engine.mjs:697-703) exists precisely to charge a fee to the day and settleFee does not use it — so the platform fee, like the ATA rent, is invisible to the tier statistics, the daily loss budget and the governor. Wallet-mode equity absorbs it (engine.mjs:620), so sizing is right, but every recorded winner overstates the user's net by 5% of its profit.

---

## [MEDIUM] The rent reclaim is one-shot, unverified, and treats a confirmation timeout as success — so the rent it reports as returned can be permanently abandoned
`src/velocity/venues/pumpfun/router.mjs`:405

**Claim.** closeTokenAccount sends the close, then calls _awaitStatus and only throws if st.err is set. _awaitStatus returns {confirmed:false, err:null} on timeout (router.mjs:204), so a transaction that never landed returns `{closed: n, reclaimed_sol: n*RENT_ATA_SOL - BASE_FEE_SOL, sig}` — a computed number, never measured. Separately, engine.reclaimRent fires exactly once, immediately after the exit is booked and deliberately un-awaited (engine.mjs:169-172), and silently drops a zero result (`if (!r?.closed) return;`, engine.mjs:179). If getParsedTokenAccountsByOwner still shows a non-zero balance — the same lagging-node behaviour this file guards against everywhere else (see _tokenBalanceSettled, router.mjs:231-240) — the filter at line 396 finds nothing, closeTokenAccount returns closed:0, and nothing in the codebase ever tries again: reclaimRent (engine.mjs:864) is the only caller of closeTokenAccount, and hub.sweepWallet sells holdings without closing accounts.

**How it fails.** A 100% sell of mint M confirms via the exact _txDeltas path, so close() returns without ever re-reading balances. _bookExit immediately calls reclaimRent. getParsedTokenAccountsByOwner answers from a node one slot behind and still reports 1,000,000 tokens. empty.length === 0 → {closed:0} → engine.mjs:179 returns with no log, no ledger line, no retry. The 0.00203928 SOL stays locked in a dead token account forever, and it was already charged into cost_usd (finding 2), so the trade is both mis-booked and genuinely down $0.41. transferSol (router.mjs:412-425) has the identical timeout-as-success shape: hub.mjs:259-263 writes the performance-fee ledger entry and calls recordGlobalFee on a signature that may never have landed.

**Impact.** 0.00203928 SOL (~$0.41) per abandoned account, permanently. At the observed ~53 closes that is up to ~$22 of locked rent if the immediate read frequently loses the race. Plus performance fees the platform records as collected but never received.

**Fix.** Three one-liners. (a) In closeTokenAccount and transferSol, after `if (st.err) throw ...` add `if (!st.confirmed) throw Object.assign(new Error('close/transfer not confirmed'), { sig, unconfirmed: true })`. (b) Measure the reclaim from the transaction instead of asserting it: `const d = await this._txDeltas(sig, mint)` and report `reclaimed_sol: d?.solDelta ?? …`. (c) Give the rent a retry path: have engine.sweep() call closeTokenAccount for mints of recently closed positions that returned closed:0, or run one periodic sweep over positions() to close every zero-balance account.

**Reviewer's correction.** Confirmed on all three code claims (I reproduced the timeout-as-success). Downgrade high -> medium: the abandoned rent is only permanent for mints never re-traded (a re-buy sees hasAccount and skips the rent, and its exit retries the reclaim), and where the rent IS lost the cost_usd of finding [1] was correct. Add a fourth, sharper sub-defect the finding missed: closeTokenAccount's query is scoped to one mint (router.mjs:395), so its `empty.slice(0, 8)` batching is dead code and no path ever cleans up a stale ATA for any other mint; positions() filters `p.qty > 0` (router.mjs:438) so emptied accounts are invisible to reconcile as well. Elevate hub.mjs:295-298 (fee ledger + recordGlobalFee on a possibly-unlanded transferSol) from an aside to the main point.

---

## [MEDIUM] _settle's balance-diff fallback measures the whole wallet, and the engine deliberately moves SOL concurrently
`src/velocity/venues/pumpfun/router.mjs`:228

**Claim.** When _txDeltas is unavailable, _settle computes solDelta as solAfter − solBefore across the send window (up to 3.2 s) and attributes the entire difference to this trade. Any other SOL movement in that window is booked into this position's cost or proceeds. This is not hypothetical concurrency: engine.reclaimRent is explicitly un-awaited ("Deliberately not awaited", engine.mjs:169-171) and credits +0.00203928 SOL, and hub.settleFee → transferSol (hub.mjs:259) debits the performance fee, both while another position's settle window is open.

**How it fails.** Position A closes at t=0; _bookExit fires reclaimRent(A) without awaiting it. At t=0.4 s position B's crash-exit sells and _txDeltas(B) returns null, so _settle enters the balance-diff loop with solBefore read at t=0.4 s. At t=1.2 s A's close-account transaction lands, +0.00203928 SOL. At t=1.6 s the loop reads solAfter and both legs have moved, so it breaks and returns solDelta inflated by 0.00203928 SOL. B's exit books $0.41 of proceeds it never earned; the mirror case (a fee transferSol landing mid-window) understates B by the whole fee. The same contamination hits the buy side: a rent credit landing during a buy's settle makes solAfter − solBefore less negative, understating cost_usd and overstating the trade's P&L.

**Impact.** ±0.00203928 SOL (~$0.41) per contaminated settle from a rent credit, or the entire performance fee if a transferSol lands in the window. Silent — nothing in the ledger distinguishes it.

**Fix.** Stop treating a whole-wallet diff as a trade delta. Either (a) keep retrying _txDeltas for the full window instead of falling back to balances — the transaction record is the only attributable source; or (b) serialize wallet-moving work: have reclaimRent and settleFee take a per-router mutex that close()/submit() also hold, so no other SOL movement can land inside a settle window; or (c) at minimum mark the fill `exact:false, contaminated:true` and refuse to close the position on it, so the next attempt reads the transaction.

**Reviewer's correction.** Confirmed, and understated. The primary mechanism is not the final subtraction at router.mjs:228 but the early-break test at router.mjs:224 (`solMoved = solAfter > solBefore` for a SELL), which any concurrent SOL credit satisfies. Reproduced: with an un-awaited rent reclaim landing mid-window, a $25 exit is booked at notional_usd $0.4079 / sol_received 0.00203928 — a −98% phantom loss, not the ±$0.41 the finding claims. Fix (a) in the finding (keep retrying _txDeltas for the full window) is the correct one and also fixes finding [0].

---

## [MEDIUM] Buys and sells authorize 1500 bps of on-chain slippage while the risk envelope caps 300 bps against a model, and the realized slippage is never measured
`src/velocity/venues/pumpfun/router.mjs`:109

**Claim.** `buySlippagePct`/`sellSlippagePct` default to 15 (%) and are what goes into the pump.fun instruction, i.e. the chain will accept up to 1500 bps of adverse move between build and land. The only other slippage control is `order.max_slippage_bps` = 300 (risk.example.json:19), and it is checked at line 308 against `est.slippage_bps`, which is the *modeled* constant-product impact of our own order computed from feed reserves — not anything the chain enforces. Closes are sent with `max_slippage_bps: Infinity` (core/router.mjs:141), so a sell has no modeled cap at all and 1500 bps on chain. The fill record then reports `slippage_bps: +est.slippage_bps.toFixed(2)` (line 338) — the model again — and sells report `slippage_bps: null` (line 372). Nothing anywhere compares the realized fill price against the curve's pre-trade spot, so the bot is structurally unable to notice that it is being sandwiched or that its cost model is wrong.

**How it fails.** An MEV searcher (or the deployer, who can read the bot's fixed wallet address off chain — see the unauthenticated identify endpoint finding) front-runs the bot's buy inside a Jito bundle, moving the curve up to 14.9%; the transaction still lands because the instruction authorizes 15%. The exit does the same in reverse. The bot books notional_usd from the real SOL delta, so the P&L is right, but `slippage_bps` in the ledger says 30-80 bps, the EV gate keeps pricing the round trip at 3.5%, the learner keeps training on features that never saw the extraction, and the governor never throttles. Nothing in the system can distinguish 'the token dumped' from 'we were extracted'.

**Impact.** Up to $7.50 per $25 round trip in the worst case versus the $0.87 the cost model prices; even a 3% realized average is ~$30 across the 40-close window, larger than the -$25.81 that window actually lost, and it is invisible in every statistic the bot keeps.

**Fix.** (1) Derive the on-chain tolerance from the envelope instead of a fixed 15: `slippagePct = max_slippage_bps/100` plus a small build-to-land allowance, and give sells their own explicit cap rather than Infinity. (2) Compute realized slippage on every fill — `(actual avg price / reference spot) - 1` from `costSol`/`qty` against `reservesFromReference` — write it to the ledger, and feed it into `edge.costs()` so the EV gate prices what actually happens. (3) Route live sends through `smartSend` (Jito bundle) or delete the header comment claiming it does.

**Reviewer's correction.** Correct the citations: the live close (router.mjs:344-382) ignores max_slippage_bps entirely — core/router.mjs:141 is the PAPER router; sell slippage_bps is null at :378/:298 not :372. Add the sharper fact the finding missed: at $25 into a 30-vSOL curve `est.slippage_bps` is ~42 bps against a 300 bps cap, so the envelope's slippage control can never bind at the operator's actual stake — it is decorative. Drop the claims that the learner and governor are blind: `slippage_bps` is written at engine.mjs:727 and read only by watch.mjs:27, but realized pnl_usd (engine.mjs:1020) comes from real SOL deltas, so both DO see extraction as loss. What is missing is attribution and an ex-ante cost term, not loss detection. Cost model at SOL=$200/$25 is 3.9% ($0.98), not 3.5%.

---

## [MEDIUM] No test ever drives the real PonsLiveRouter through the Engine — every Robinhood Chain money path is tested only in router isolation
`tests/velocity/t10-live-path.test.mjs`:889

**Claim.** The PONS router's four money-critical refusals — NO_QUOTE_PRICE (pons/router.mjs:199), GRADUATED (:216), NO_CURVE (:206), and the chunked/partial fill (:270) — are tested only against the hand-written FakeChain in t13. The single engine-level pons test (t10:872) builds its venue from `PonsPaperRouter` plus a bespoke `FakeEvm` class (t10:884-887) whose `close()` is `async close() { return { ok: false, failure: { code: "UNUSED", reason: "" } }; }`. `rg PonsLiveRouter tests/` returns only t13. So the engine↔pons contract is never verified: which failure codes the engine understands, whether `pct_filled` is honoured, whether `positions()`'s track-only enumeration survives reconcile against a live router, and whether a `GRADUATED` refusal ever resolves.

**How it fails.** Any change to the pons fill shape — renaming `sol_received`, dropping `pct_filled`, returning a new failure code — passes the whole suite while the engine silently mis-books it. Concretely: pons/router.mjs:199 returns `NO_QUOTE_PRICE`, which is not `NO_POSITION`, so engine.mjs:826 skips the flat handling and just appends a failed exit — correct, but nothing asserts it, and the symmetric mistake (adding NO_QUOTE_PRICE to the flat branch) would book a live position as a total loss with no test failing.

**Fix.** Add the t13 FakeChain as a shared helper and stand up one Engine test with `venues.pons.liveRouter = new PonsLiveRouter({ provider: fakeChain })` in live mode, driving: a normal close, a close with no ETH price (asserting the position stays open and nothing is sent), a graduated curve (asserting the position stays open with `lastExitError.code === "GRADUATED"`), and a chunk-limited close (asserting `remaining_qty > 0` and no outcome record). This is the single highest-value missing test in the suite: it covers three of the four defect classes in the brief at once.

**Reviewer's correction.** Severity medium, not high. The finding names no live defect of its own — every refusal it lists IS tested, at the router level in t13, and the engine's handling of NO_QUOTE_PRICE (which the finding itself concedes is 'correct, but nothing asserts it') is right today. High should be reserved for findings that cost money as written. The recommendation is well aimed and does cover the mechanism behind finding 2, but it is a test-suite gap, not a bug.

---

## [MEDIUM] The regression test for "do not book a part-filled PONS sell as a closed position" asserts the opposite of its name: the injected failure can never fire
`tests/velocity/t13-pons-sell.test.mjs`:147

**Claim.** The test at t13:143 injects a `c.call` override that throws on the second `sell` dry run, gated on `sells >= 1` — but `sells` is declared `let sells = 0` at line 147 and is never incremented anywhere in the file. The override therefore always delegates to the real call. `chain({ allowance: 2n**255n })` sets no `maxUnits`, so `_sellShape` accepts the whole balance on the first try, the loop runs one chunk, `leftUnits` reaches 0n, and the result is `partial: 0, pct_filled: 100` — the `else` branch at t13:155-158, which asserts exactly the non-partial case. The two assertions the test exists for (t13:153-154) are unreachable. `const realSend = c.broadcastTransaction?.bind(c)` at line 150 is also assigned and never used, a second sign the injection was never verified. This test was added by commit 0d49aad, the commit that introduced `pct_filled`.

**How it fails.** Revert engine.mjs:875 to `const filledPct = pct;` (the pre-0d49aad behaviour that stranded 60 tokens in a live wallet) and the whole 191-test suite still passes. Same if pons/router.mjs:270 stops emitting `pct_filled`.

**Impact.** The defect this test was written for stranded ~60 tokens in a live wallet that no position knew about and the sweep could not close. It is now unprotected against regression on both the router side and the engine side.

**Fix.** Increment `sells` inside the override (or drive the partial through `maxUnits` plus a `revert` that only trips after the first chunk) and delete the `else` escape hatch so the test fails if the scenario does not occur. Then add the engine-level test that is actually missing: `closePosition(p, 100, ...)` against a router returning `{ ok: true, fill: { qty: 600, pct_filled: 60, partial: 400, ... } }`, asserting `status === "open"`, `remaining_qty === 400` and no `outcome` record. (I verified with a probe that the engine does behave correctly today — the test would be a guard, and there is currently none.)

**Reviewer's correction.** Severity should be medium, not high. Nothing is broken in the shipping code — the auditor concedes as much ("I verified with a probe that the engine does behave correctly today"). The cost is that the fix in 0d49aad can be reverted silently, which is a real but zero-dollars-today defect. The 'money_impact' paragraph describes the ORIGINAL bug, not the current state, and should not be read as an active loss.

---

## [LOW] No polling backs off or pauses; the 3-second public poll drives an uncached, unauthenticated endpoint that re-scores ~90 tokens per request on the trading engine's own event loop
`app/src/Simple.jsx`:111

**Claim.** Six independent `setInterval` pollers, none of which has any error backoff, any `document.hidden` gate, or any give-up. Every failure is swallowed by an empty `catch {}` and the same request fires again on schedule. The worst is `Live`: 3s, no auth required, runs for every visitor from first paint whether or not they have a wallet, and forever in a background tab. `/api/radar/live` has no cache and no rate limit, and per request it runs `judgeToken` + `extractQuickFeatures` over up to 30 rows plus 10 revivals plus 10 cooking, and a separate `slowCookOf` sweep over up to 60 more tokens. This runs in the same Node process and the same event loop as the velocity hub that is placing and exiting trades.

**How it fails.** The site gets attention and 200 people leave the tab open. That is 200 × 20 = 4,000 requests/minute, each doing ~50 judgeToken passes and ~60 extractQuickFeatures passes, on the single thread that also runs the exit sweeper. Exit checks queue behind marketing traffic; the STALL and crash exits fire late; positions that should have been cut at -5% are cut at -20%. Separately, if the API goes down entirely, all six pollers keep hammering at full rate forever and the page shows the last-known P&L and balances with no indication that nothing is being refreshed.

**Impact.** Exit latency under load, which directly widens losses on the crash-exit bucket (already -$25.24 over 14 closes). Plus Railway CPU cost that scales with idle tabs rather than users.

**Fix.** (1) Cache `/api/radar/live` per `aggression` for 2-3s in a module-level map keyed `aggression` — the poll interval is 3s, so a 2.5s cache collapses N visitors to one computation. (2) Add exponential backoff to every poller: on catch, multiply the interval up to a cap (e.g. 60s) and reset on success; render a "not reaching the server, last updated Xs ago" line so the frozen numbers are honest. (3) Gate the pollers on `document.visibilityState === "visible"`.

**Reviewer's correction.** Mechanics confirmed (no cache, no rate limit, no backoff, no visibility gate, all six catches silent). Load arithmetic is wrong: background tabs are clamped by the browser to ~1 request/minute, so the 4,000 req/min figure is off by ~20x and the exposure is visible tabs only. The "page shows frozen numbers with no indication" claim is half-wrong: Pulse (Simple.jsx:52-57) flags a stale heartbeat as "engine not responding" once the last successful status is 45s old. Severity low; the defensible ask is the per-aggression 2.5s cache on /api/radar/live.

---

## [LOW] Keyboard users cannot toggle PONS, copy an address, expand a position or dismiss an error; disabled buttons lie to screen readers; error text is 4.01:1
`app/src/Simple.jsx`:429

**Claim.** Every secondary control in the app is a `<div>` or `<span>` with `onClick` — no `role`, no `tabIndex`, no key handler. The PONS chain toggle has no other affordance at all, so there is literally no keyboard path to turn Robinhood Chain trading on or off. `Btn` never emits the `disabled` attribute: it sets `onClick` to `undefined` and drops opacity, so a disabled button is still in the tab order and is announced as enabled. And the red ink used for every failure message measures 4.01:1 on the card surface in the dark theme (3.76:1 in the light one), below the 4.5:1 needed at the 11-13px sizes those messages use — the theme comments show contrast was measured for the muted ink but never for the error ink.

**How it fails.** A keyboard-only or screen-reader user connects, funds both chains, and cannot turn PONS off — the only control is a div. They tab to "Start" while it is disabled (mid-request), the reader says "Start, button", they press Enter, and nothing happens with no explanation. When a sell fails, the message that tells them so is rendered at 11px in a red that fails AA against the card.

**Impact.** none - correctness only. The contrast failure lands specifically on the sell-failed and exit-error messages, which are the ones a user most needs to read.

**Fix.** Convert the click-only elements to `<button type="button">` with `background: none; border: none` (they are already styled inline, so this costs nothing visually) — the PONS toggle should additionally carry `role="switch"` and `aria-checked`. In `Btn`, pass `disabled={disabled}` through to the element and keep the `onClick` guard. Darken/lift `rd` until it clears 4.5:1 on `sf` in both palettes (e.g. dark `#ff7b74` measures ~4.9:1 on `#343331`), or reserve `rd` for ≥18px text and use `tx` plus an icon for the small failure lines. Add `overflow: hidden` to the Live row's name column and let the footer buttons wrap (`flexWrap: "wrap"`, `minWidth: 120`).

**Reviewer's correction.** Core claims confirmed (PONS toggle has no keyboard path, Btn never emits `disabled`, error ink measures 4.01:1 dark / 3.77:1 in the alternate palette, no `<h1>`, the 84px name column at 400px). Three evidence errors: theme.js is 30 lines, so the palettes are at :9 and :10 not :82-83; `L` is a second DARK palette (#363533/#424140), not a light theme, so "a light palette with no toggle" is wrong; and the risk dial already has real `<button>` stops at Simple.jsx:92, so only the bars at :91 are inert. Severity low — no money impact.

---

## [LOW] src/api/server.mjs and its 2,961-line private subtree survive only because `npm run dev` and the wrong Dockerfile point at them
`src/api/server.mjs`:1

**Claim.** src/api/server.mjs is the sole importer of src/payments/payment-routes.mjs, src/payments/payment-verifier.mjs, src/middleware/auth.mjs, src/middleware/rate-limiter.mjs, src/middleware/security.mjs, src/middleware/validate.mjs, src/db/session-store.mjs and src/scoring/memetic/learning-pipeline.js. None of those eight is reachable from src/api/server.production.mjs. src/middleware/auth.mjs is a third hand-rolled JWT implementation (a fourth counting src/middleware/wallet-auth.mjs and the session tokens), and it is the header-trusting pattern commit 827a9ac set out to remove -- requireAuth trusts any Bearer token it can verify with a JWT_SECRET that silently defaults to crypto.randomBytes(32) per process.

**How it fails.** A contributor runs `npm run dev`, which starts src/api/server.mjs, and develops against a server whose 55 routes do not include /api/velocity/*, /api/trading-wallet/* or /api/auth/*. Anything they build against it cannot be exercised by the shipped frontend. The payment/access-fee revenue model those 2,961 lines implement (ACCESS_FEE_SOL, PaymentVerifier, issueToken) was superseded by the flat velocity fee and no longer runs anywhere.

**Impact.** none - correctness only

**Fix.** After fixing deploy/Dockerfile:28, delete all nine files and repoint `api:dev` at src/api/server.production.mjs. src/api/access-check.mjs (already in the zero-importer list) and src/engine/velocity-scorer.mjs -- whose only remaining importers are server.mjs and src/engine/historical-movers.mjs -- go in the same pass.

**Reviewer's correction.** One characterization is wrong: src/middleware/auth.mjs is NOT 'the header-trusting pattern commit 827a9ac set out to remove'. requireAuth (:41-56) reads only `req.headers.authorization` and verifies an HMAC-SHA256 JWT — there is no X-Wallet fallback anywhere in the file. What 827a9ac deleted were requireVerifiedWallet/requireStrictAuth from wallet-auth.mjs, a different pair. auth.mjs's actual defect is narrower: the per-process random JWT_SECRET at :4, with no boot warning, on a server nothing deploys. Fix the sentence; the deletion list is otherwise correct as written.

---

## [LOW] Legacy auto-trader positions and exit plans live only in RAM, and the SIGTERM handler process.exit()s without touching them
`src/api/server.production.mjs`:4910

**Claim.** `const autoTraders = new Map()` (4910) and `const autoExitPositions = new Map()` (6990) are the sole home for every open legacy position, its entry price, stop-loss, trailing stop and TP ladder. Neither is ever written to Redis and neither is restored at boot — `autoTraders.set` appears once, at 6707 inside startAutoTrader. The only shutdown hook (11205) is registered solely when VELOCITY_HOSTED=1 and calls `velocityHub.stopAll().finally(() => process.exit(0))`, which never stops an auto-trader or flushes anything. After a restart the positions are gone but the tokens are still in the user's custodial wallet, and /api/auto-trade/close then refuses to help because it requires the vanished state object.

**How it fails.** A user has three auto-ape positions open with -15% stop-losses armed. The operator pushes a commit; Railway sends SIGTERM and the handler calls process.exit(0) roughly immediately. On the new process autoTraders is empty. The three tokens are still in the wallet with no monitor: the stop-loss never fires, the trailing stop never fires, and max-hold never fires. The user's only remaining exit is the unauthenticated /api/sell-all, because /api/auto-trade/close and /api/auto-trade/exit-position both 404 on the missing state. Given the observed exit mix (crash-exit 14 = -$25.24 over 40 closes), an unmonitored memecoin position is a near-total write-off.

**Impact.** Every open legacy position at deploy time becomes an unmanaged bag. With ~$25 sizing and a 14/40 crash-exit rate, each orphaned position is worth roughly -$1.80 expected, and worse when the stop-loss was the thing keeping it bounded.

**Fix.** Either persist autoTraders/autoExitPositions to Redis on every mutation and rehydrate in the server.listen callback (the velocity store already shows the pattern), or — since app/src/Simple.jsx calls no /api/auto-trade/* route — retire the legacy trader entirely. At minimum register the SIGTERM handler unconditionally and have it stop every auto-trader and await pending Redis writes before exiting, instead of calling process.exit(0) from inside a .finally().

**Reviewer's correction.** Downgrade high -> low, and drop the SIGTERM framing, which is not the defect. When VELOCITY_HOSTED != 1 there is no signal handler at all, so the default SIGTERM kill gives the identical outcome -- the handler is not what loses the state, the absent persistence is. Also `process.exit(0)` sits in the `.finally()` of an awaited `velocityHub.stopAll()`, so it does not truncate the velocity engine's own writes; tests/velocity/t9-reconcile.test.mjs ('T9: SIGKILL with an open position, restart reconciles and exits fire', passing) shows that path is covered. The honest statement is: the legacy auto-ape subsystem has no durable state and no restart reconciliation, on a path the hosted UI does not expose.

---

## [LOW] Six PumpPortal trade calls have no AbortSignal, all of them on sell and exit paths
`src/api/server.production.mjs`:4677

**Claim.** 44 of the 50 outbound fetches in this file pass `signal: AbortSignal.timeout(...)`. The six that do not are all `https://pumpportal.fun/api/trade-local` calls, and they are exactly the ones that liquidate a position: 4677 (/api/sell-all's per-token loop), 5639 and 5710 (auto-trader buy paths), 6758 (/api/auto-trade/close), 6794 (/api/auto-trade/exit-position) and 7051 (autoExitSell, the stop-loss/TP executor). Node's undici default headers/body timeout is 300s, so a hung PumpPortal connection stalls a sell for five minutes with no cancellation.

**How it fails.** PumpPortal is degraded (it routinely is during a launch wave). A user with 8 tokens hits sell-all to escape a crash. The first token's trade-local call hangs; the loop is serial and awaits it, so the request occupies a connection for up to 300 seconds before the catch fires, then sleeps 500ms and tries the next. Worst case the sell-all takes 40 minutes to attempt 8 tokens, by which time the crash is over. The same hang on line 7051 stalls the auto-exit stop-loss executor: the position keeps falling while the sell request sits open.

**Impact.** A stalled exit on a memecoin is usually the whole position. With crash-exit already the biggest loss bucket (-$25.24 over 14 closes), a 300s sell stall converts a -20% exit into a -90% one.

**Fix.** Add `signal: AbortSignal.timeout(5000)` to all six, matching every other trade call in the file. For /api/sell-all also replace the serial for-loop with a bounded Promise.all (concurrency 4-5) so one slow mint cannot delay the rest.

**Reviewer's correction.** Downgrade high -> low: code-true and worth a one-line fix, but it is a latent hazard on a path the hosted product does not exercise, not a live money leak. The claim 'they are exactly the ones that liquidate a position' is also loose -- 5639 and 5710 are buys (DCA and re-entry), not liquidations.

---

## [LOW] /api/trading-wallet/import bypasses the vault's production guard and stores the key in plaintext
`src/api/server.production.mjs`:3668

**Claim.** Both custodial-wallet creation routes refuse to run when the vault has no key in production (`if (!vault.canCreate()) return 503`), but the import route — which also causes a private key to be persisted — has no such check. Because vault.seal() is a pass-through when no key is configured, importing under a production deploy with WALLET_ENCRYPTION_KEY unset writes the user's raw private key into Redis, silently defeating the guard the other two routes enforce.

**How it fails.** Operator deploys to Railway and forgets WALLET_ENCRYPTION_KEY (it is blank in .env.example:54). makeVault logs a warning and canCreate() returns false (keyvault.mjs:20-24), so /api/trading-wallet/create and /create-extra correctly 503 and no new custodial key is minted unsealed. A user instead clicks "import your own wallet" — line 3668 has no canCreate() check, line 3687 builds {secret: privateKey}, line 3688 calls saveTradingWallet, and line 3035's vault.sealRecord returns the record untouched because keyvault.mjs:22 `if (!key) return plain`. The imported key — often the user's aged, already-funded wallet — lands in Redis as cleartext, and the operator has no signal that the protection they think is on has been bypassed.

**Impact.** None while the key is set. If it is ever unset — a fresh environment, a variable dropped during a Railway migration — every imported wallet's key is readable by anyone who reaches Redis, and imported wallets are by definition the aged, funded ones.

**Fix.** Add the same guard at the top of the import handler: `if (!vault.canCreate()) return res.status(503).json({ error: "custodial wallets are disabled until WALLET_ENCRYPTION_KEY is set on the server" });`. Better still, move the check inside saveTradingWallet so no future call site can miss it.

**Reviewer's correction.** Downgrade medium -> low: correct as code truth, but doubly conditional (WALLET_ENCRYPTION_KEY unset AND a hand-crafted import during a window in which normal onboarding is already 503-ing and visibly broken).

---

## [LOW] ADMIN_SECRET falls back to the hardcoded literal "bondli_default" and is accepted in the query string
`src/api/server.production.mjs`:143

**Claim.** ADMIN_SECRET defaults to the in-repo literal "bondli_default" when the env var is unset, and requireAdmin compares against that constant. It also accepts the secret as `?secret=` in the URL, which puts it in proxy logs, referrer headers and browser history. The file itself shows the correct pattern one line away: line 185 builds requireOwner with `process.env.ADMIN_SECRET || null`, so the owner-bypass path fails closed while the admin path fails open.

**How it fails.** ADMIN_SECRET is commented out in .env.example (line 118) and only mentioned as needed for a separate CLI tool (line 87), so a deploy that skips it is likely. Anyone who has read the repo then POSTs /api/admin/whitelist with header x-admin-secret: bondli_default (or ?secret=bondli_default) and grants their own wallet {tier:"vip", whitelisted:true, paid:true} at line 9003. That unlocks the Pro/VIP gates on /api/trading-wallet/create-extra (3619) and the multi-wallet branch of import (3697), plus /api/admin/users, /api/admin/stats and POST /api/launch (8259), which writes the site's launch banner. Even when ADMIN_SECRET is set properly, the ?secret= form leaks it into every access log the request passes through.

**Impact.** No direct fund movement — these routes grant tier, not signing. Cost is free VIP/Pro (bypassing the paid upgrade and the multi-wallet limit) and the ability to post arbitrary content to the site's launch banner.

**Fix.** Mirror line 185: `const ADMIN_SECRET = process.env.ADMIN_SECRET || null;` and have requireAdmin 403 unconditionally when it is null, so an unset variable disables admin rather than opening it. Drop `req.query?.secret` so the secret can only travel in a header, and compare with crypto.timingSafeEqual on equal-length buffers.

**Reviewer's correction.** Downgrade medium -> low: correct as code truth (fail-open default vs the hub's fail-closed check) but the trigger condition appears false on the live deploy — the observed fee totals could not exist if feeOk were false — and the two skim sites are reachable only through unauthenticated legacy routes the UI never calls. Line-number fixes: hub.mjs 159/160/161 and 292-293, not 133-135/266-267. Broaden the consumer list, which is the part worth keeping: server.production.mjs:3293 publishes PLATFORM_WALLET as the VIP payment address on GET /api/pricing and 3261 verifyPayment accepts the 10 SOL VIP payment against it, so an unset variable makes the service advertise the compromised address as a payment destination; src/engine/gpu-earnings.mjs:40 hardcodes the same fallback as BONDLI_TREASURY for the hourly NOS sweep; and fee-engine.mjs:141 `if (w === PLATFORM_WALLET) return true` inside isOwnerWallet means, via hub.flatFee (hub.mjs:321), that whoever holds that leaked key also trades fee-free.

---

## [LOW] PRIORITY_FEE_SOL and SELL_SLIPPAGE are read by two trading stacks with different defaults, and .env.example documents only one of them
`src/api/server.production.mjs`:105

**Claim.** pump.fun trading is implemented twice. The velocity path uses PumpfunLiveRouter (a single 400-line router with a cost model, confirmation and fee accounting). server.production.mjs additionally issues 16 ad-hoc `fetch("https://pumpportal.fun/api/trade-local")` calls parameterised by its own TRADE_CONFIG. Both read the same two env vars with different fallbacks: PRIORITY_FEE_SOL defaults to 0.0015 in TRADE_CONFIG and 0.0003 in the router/edge; SELL_SLIPPAGE defaults to 20 in TRADE_CONFIG and 15 in the router. A third name, PRIORITY_FEE (lamports, default 10000), lives in src/engine/config.mjs:19. .env.example documents only the velocity numbers.

**How it fails.** Operator reads .env.example:91 ("PRIORITY_FEE_SOL=0.0003 ... 0.0003 is the default") and .env.example:126-128 ("Defaults 15/15") and leaves both unset, believing every transaction tips 0.0003 and sells at 15%. Every trade issued by server.production.mjs -- /api/quick-ape, /api/quick-sell, /api/sell-all, the /api/auto-trade auto-trader's entries and exits, the session/fleet sells -- actually tips 0.0015 (5x, +$0.24 per tx at SOL $200) and sells at 20% slippage. Conversely, an operator who raises PRIORITY_FEE_SOL to unstick the legacy path silently raises the velocity engine's tip too, and edge.mjs:68's EV gate then under-states its own fixed cost because it recomputes it from the same variable.

**Impact.** 0.0012 SOL (~$0.24 at SOL $200) extra per legacy-path transaction, ~$0.48 per round trip vs the velocity path's ~$0.12 -- about $19 over a 40-trade window whose total fees were $26.25, for any trades routed through the legacy path

**Fix.** Make TRADE_CONFIG import the router's constants instead of re-deriving them: replace src/api/server.production.mjs:106-108 with the values from src/velocity/venues/pumpfun/router.mjs so there is one default per knob. Better, once the three unguarded routes above are deleted, most of the 16 inline trade-local blocks go with them and the router becomes the only pump.fun writer.

**Reviewer's correction.** Keep the config-duplication claim; drop the money_impact. Correct '16 ad-hoc fetch calls' to 14, and correct the failure scenario: the /api/auto-trade auto-trader is started only by /api/auto-trade/start (server.production.mjs:6732), which the shipped frontend never calls, so 'every trade issued by server.production.mjs' is a path with no traffic. The live cost is $0 today; the defect is that one env var now silently drives two cost models with different assumed defaults.

---

## [LOW] requireSocials is satisfied by an unverified `telegram` string the deployer writes into the token metadata
`src/api/server.production.mjs`:2014

**Claim.** `_hasAnySocial` is true if ANY of twitter (only invalidated when the X API separately says the handle is dead), telegram (never checked at all), or website (only invalidated when a probe already ran and failed) is a non-empty string. All three come from deployer-authored data: the pump.fun create event (line 1259) and the pump.fun /coins metadata (line 887, applied at 954). There is no probe for telegram anywhere in the codebase — `grep telegram` returns only parse, assign and read sites, never a fetch. So NO_SOCIALS (disqualifiers.js:16) is defeated by putting the four characters `t.me` in one JSON field, and FRESH_SOCIALS (disqualifiers.js:19) can then never fire either because it requires `_xFlags`, which is only populated when `t.twitter` is set (line 7964).

**How it fails.** A rugger sets `telegram: "t.me/x"` (or literally `telegram: "x"`) in the pump.fun launch form. NO_SOCIALS cannot fire because _hasAnySocial is 1; FRESH_SOCIALS cannot fire because there is no twitter handle to probe. The gate that was added specifically to remove 'the laziest launches' removes nothing, at zero cost to the attacker. The gate also cannot fire at all on PONS (edge.mjs:76-78 documents this), so on Robinhood Chain the flag is inert regardless.

**Impact.** None on its own — it removes a filter that was intended to cut a slice of the 40-close loss set, so the cost is the losses it was supposed to prevent.

**Fix.** Require the social to be *verified*, not present: probe t.me/<handle> the same way `_siteAlive` probes the website, and treat an unresolvable handle as absent. Better, require at least two independent signals or a twitter handle that the X probe has actually resolved, and treat `telegram` alone as no social at all until it has been checked.

**Reviewer's correction.** True as written, but reframe. The gate is not silently disabled — disqualifiers.js:14 documents that a link is not verification. The real, undocumented defect is the asymmetry: `_hasAnySocial` (server.production.mjs:2014) invalidates a dead X handle (via queueXCheck, :7964) and a dead website (via queueSiteCheck, :8003) but has no equivalent for telegram, so the one unprobed field carries the whole disjunction. Severity low: no direct loss, and the fix (probe t.me/<handle> like _siteAlive probes the website) is small.

---

## [LOW] Ride mode left the SL1/SL2 split in place, so a normal stop-out costs two transactions and the ATA rent is not reclaimed on the first
`src/autoape/exit-plan.js`:97

**Claim.** The ride-mode rationale at exit-plan.js:14-18 says the stop loss should cut a loser 'in ONE sell, which is what makes the token account closable and its rent reclaimable'. checkThresholdExit still splits it: the first breach in the band [-stopLoss, -2*stopLoss) returns PARTIAL_SELL of settings.sl1Sell = 80% (PUMPFUN_EXIT_SETTINGS at exits.mjs:12), and only the next tick returns SL2 for the remaining 20%. engine._bookExit only calls reclaimRent when done, so the 0.00204 SOL of ATA rent waits for the second transaction.

**How it fails.** A tier-3 position hits -12%. Tick 1: PARTIAL_SELL 80% — one transaction with its own priority fee (0.0003 SOL) and base fee, account still funded, rent not reclaimed. Tick 2: SELL 100% of the remaining 20% — a second transaction and a second priority fee, on a 20% notional whose slippage is worse than the 100% sell would have been. Combined with finding 1, the SL1 window is also degenerate: after TIGHTEN_SLS collapses stopLoss to 0.42, the SL1 condition `changePct > -(plan.stopLoss * 2)` becomes `changePct > -0.84`, so SL1 fires at -0.5%.

**Impact.** ~$0.07-0.10 of extra transaction cost per stop-out plus worse slippage on the 20% tail, and 0.00204 SOL (~$0.44) of rent left locked until the second sell lands. Small today only because finding 1 means the stop loss almost never fires — it becomes the common path once finding 1 is fixed.

**Fix.** When tp.ride is true, drop the SL1 branch and return SELL 100% on the first stop breach — one transaction, account emptied, rent reclaimed. Delete or explicitly mark the unreachable ladder (exit-plan.js:154-206), MAX_HOLD_TIME and trailWidth so the next reader is not calibrating a branch the live path cannot enter.

**Reviewer's correction.** Drop the "SL1 fires at -0.5% after TIGHTEN_SLS collapses the stop to 0.42" paragraph — exits.mjs:163 floors the tier-3 stop at 5%, and the layer-chain short-circuit it depends on is fixed (pipeline.js:198-224). Restate the cost as ~$0.061 of extra priority+base fee per stop-out (not $0.07-0.10 of fees plus 1.5%), and the rent as delayed one tick rather than locked. Everything else — the split itself, reclaimRent gated on done (engine.mjs:878-881), MAX_HOLD_TIME unreachable behind exits.mjs:90, exit-plan.js:154-206 unreachable behind :138-152, trailWidth with no reader — is confirmed.

---

## [LOW] Four hard rug/timing rules can never fire on the hosted server: FREEZE_AUTHORITY, SERIAL_LAUNCHER, SERIAL_RUGGER, SCORE_NOT_STABLE
`src/autoape/gates/disqualifiers.js`:36

**Claim.** `opts.freezeAuthority` comes from `!!c.token.freezeAuthority` (edge.mjs:113) and `!!t.freezeAuthority` (server.production.mjs:8069), but no code path ever assigns `freezeAuthority` to a radar token — rug-scanner.mjs:25 reads it from an RPC response into its own `results.checks` object and is only wired into engine/orchestrator.mjs, not the API server. SERIAL_LAUNCHER needs `qf._devLaunchCount > 8` and SERIAL_RUGGER needs `qf._namePrevRugged`; both derive from `_devCredData`, which is only enriched inside startAutoTrader (see finding 4), so on the hosted server `_devLaunchCount` is always -1 (server.production.mjs:2065 `devCred?.devLaunchCount ?? -1`) and `_namePrevRugged` always false. SCORE_NOT_STABLE needs `token._stabilityCount != null`, written only at server.production.mjs:6536 — also inside startAutoTrader — so the `requireStable` knob in AGGRESSION levels 0 and 1 controls nothing.

**How it fails.** A dev on their twelfth launch, with a name that has rugged before, is judged identically to a first-time dev: both SERIAL_LAUNCHER and SERIAL_RUGGER evaluate `-1 > 8` and `false && ...`. And a candidate whose score has been above the floor for exactly one cycle is never blocked by SCORE_NOT_STABLE at aggression 0/1, so the operator's "cautious" setting is looser than it reads.

**Fix.** Move the dev-credibility enrichment to the hosted path (same fix as finding 4). For stability, compute the above-floor streak in the background scorer next to `t._scoredAt = Date.now()` (server.production.mjs:11361) rather than in the legacy trader. For freeze authority, either stamp it during the metadata fetch that already sets `token._metaAt` (server.production.mjs:960) using the mint account's `freezeAuthority`, or delete the rule and its FATAL_DISQUALIFIERS entry so it stops reading as protection that exists.

**Reviewer's correction.** Confirmed as written; downgrade to low. FREEZE_AUTHORITY is the weakest of the four — a pump.fun mint has no freeze authority to begin with and PONS is EVM, so wiring it would cost an RPC mint-account fetch to learn a field that is null by construction; deleting the rule and its FATAL_DISQUALIFIERS entry (disqualifiers.js:190) is the better half of the proposed fix. The one with real reach is SCORE_NOT_STABLE: `requireStable: true` at edge.mjs:51 and :53 (aggression 0 and 1) is inert on the hosted path, so the two cautious settings are looser than the table reads.

---

## [LOW] FREEZE_AUTHORITY is dead code — token.freezeAuthority is never assigned, and mint authority is never checked at all
`src/autoape/gates/disqualifiers.js`:36

**Claim.** `checkDisqualifiers` raises FREEZE_AUTHORITY from `opts.freezeAuthority`, which both call sites populate as `!!token.freezeAuthority` (edge.mjs:113, server.production.mjs:8069). Nothing in the repository ever writes `token.freezeAuthority` — a repo-wide grep returns only those two reads, the comment and the check. The only code that does read a mint's authorities is `src/engine/rug-scanner.mjs:24-27`, which is wired into `src/engine/orchestrator.mjs` and is not on the velocity path. There is no on-chain inspection of the mint anywhere under `src/velocity` at all: `grep -rn 'getAccountInfo|getMint|getTokenSupply' src/velocity` returns nothing. Mint authority is not checked in any form. So gate 1's two contract-level safety rules are (a) inert and (b) absent.

**How it fails.** The radar is not pump.fun-only — it also ingests bonk/bags launches (`_source: detectedSource` at server.production.mjs:1274, `src/engine/bags-client.mjs`) and revival/slow-cook candidates. For any SPL mint reaching the gates from a launchpad that does not revoke authorities, a live freeze authority means the deployer freezes the bot's token account the moment it buys and the position can never be sold (`close()` reverts, the sweeper eventually books MISSING_AT_VENUE or a 100% loss); a live mint authority means the deployer mints supply and drains the curve. Neither is detected, and the flag the operator believes covers the first case is a no-op. The correct impression the code gives — 'we reject freeze authority' — is false.

**Impact.** 100% of a position when it fires (a frozen account cannot be sold at all), bounded by how much non-pump.fun flow reaches the gates. Zero cost to fix — one cached RPC per mint.

**Fix.** Fetch the mint account once per candidate (`connection.getParsedAccountInfo(mint)` — a single RPC, cacheable forever since authorities can only be revoked) and set `token.freezeAuthority` and `token.mintAuthority` from `data.parsed.info`. Add a MINT_AUTHORITY disqualifier alongside the existing FREEZE_AUTHORITY one. If the intent is that pump.fun always revokes both and the check is only meaningful for other sources, gate it on `_source` and say so, rather than leaving a rule that reads an undefined field.

**Reviewer's correction.** Confirmed as dead code. Downgrade to low: pump.fun revokes mint and freeze authority at creation, so on the dominant flow a falsy `freezeAuthority` is the correct answer and nothing is being missed. The defect is that FATAL_DISQUALIFIERS (disqualifiers.js:189) advertises coverage that cannot exist, plus a bounded real gap on bonk/bags tokens — which I confirmed can reach the gates, since buildScoredResponse (server.production.mjs:8082-8133), the hosted feed's in-process source (:11188-11190), applies no `_source` filter.

---

## [LOW] src/autoape/recovery.js is imported into the production server but none of its four functions is ever called
`src/autoape/recovery.js`:6

**Claim.** recovery.js exports four decision functions -- checkWatchlistPromotion, checkMissedReentry, checkPostExitReentry, checkDipDCA. pipeline.js imports all four (line 19) purely to re-export them (242-245), and server.production.mjs:80 imports checkPostExitReentry and checkDipDCA by name. A repo-wide grep for call sites returns nothing: no `checkPostExitReentry(`, `checkDipDCA(`, `checkWatchlistPromotion(` or `checkMissedReentry(` anywhere in src/, tests/, tools/ or app/ outside their own definitions and the re-export list. Re-entry-after-exit, dip-DCA and watchlist promotion do not exist as behaviour.

**How it fails.** An operator reading server.production.mjs:80 or pipeline.js's export block reasonably concludes the bot re-enters a token it exited too early and DCAs into a dip. It never does. Given the observed 40-close window -- crash-exit 14 for -$25.24, and 2 ride-trail closes worth +$20.85 -- 'we already have re-entry logic' is exactly the wrong conclusion to draw when deciding what to build next.

**Impact.** none - correctness only; the cost is a documented feature that does not exist

**Fix.** Delete src/autoape/recovery.js, its import and re-export in src/autoape/pipeline.js (lines 19, 242-245), and the four unused names from src/api/server.production.mjs:80. If re-entry is wanted, it belongs in src/velocity/core/exits.mjs where the live exits are, next to the existing REENTRY_COOLDOWN the logs already show firing.

**Reviewer's correction.** The failure_scenario overreaches and should be cut. 'Re-entry-after-exit, dip-DCA and watchlist promotion do not exist as behaviour' is false: server.production.mjs implements two of the three inline in the legacy auto-trader — DIP-BUY DCA at :5619-5660 (20% off peak + rising/rocket trend, half-size, max 2 adds, weighted re-average of entryMcap at :5652) and DIP RE-ENTRY at :5684-5735 (2-minute post-sell wait, 15% dip from recent spark peak, half-size, gated on state.settings.reentryDips), with the cooldown decay at :5676-5682. The honest claim is narrower and still worth filing: recovery.js is dead code, and the behaviour that does exist lives inline on the legacy auto-trade path, not in the velocity engine, so the velocity bot genuinely has no re-entry or DCA. Downgrade to low — the cost is a misleading import line, not a missing feature nobody wrote.

---

## [LOW] Seventeen modules totalling 3,773 lines have zero importers anywhere and are referenced only by README.md's architecture tree
`src/engine/fleet-brains.mjs`:1

**Claim.** A full import-graph walk of src/, tests/, tools/, launch/ and app/ (static imports, dynamic import() and require()) finds seventeen files that nothing imports. Every one of them is listed in README.md's directory tree with a descriptive comment, so they read as shipped subsystems. Several are named exactly like features the bot is supposed to have -- exit-liquidity-detector, position-health, regime-engine, portfolio-correlation, trajectory-classifier, trade-attribution -- which is worse than plain dead code.

**How it fails.** A reader of README.md:385-436 believes the bot classifies market regime, monitors position health, caps portfolio correlation and attributes trade outcomes. None of that code runs. The known-open 'no counterfactual, no miss record' gap is precisely what src/engine/trade-attribution.mjs (211 lines) claims to solve, and it is not wired to anything.

**Impact.** none - correctness only

**Fix.** Delete all seventeen files and the corresponding lines from README.md's tree (362, 385, 391, 396, 400, 402, 416, 419, 421-425, 431, 436, 465, 495). If trade-attribution or position-health describe behaviour you still want, re-derive it inside src/velocity/core/ against the ledger that actually exists.

**Reviewer's correction.** Sound as filed; only the severity is generous. 'Deleting all seventeen leaves npm test at 191/189' should be stated as 'the current baseline is 191/189 and deleting them does not change it', otherwise it reads as if the deletion adds tests.

---

## [LOW] Session dev keys and fleet keys are written to Redis in plaintext; the vault covers only tw: and extra_wallets:
`src/engine/session-manager.mjs`:130

**Claim.** The keyvault is applied to exactly two Redis keyspaces. session:<id> is persisted with JSON.stringify(session) where session.devSecret is the raw base58 secret key, and fleetkeys:<id> is persisted with JSON.stringify(walletKeys) where each entry carries a raw secret. Neither goes through vault.sealRecord, so under the stated threat model — an attacker with read access to the Railway volume / Redis dump — those keys are readable in the clear even when WALLET_ENCRYPTION_KEY is correctly configured.

**How it fails.** An attacker who obtains a Redis RDB/AOF snapshot, a Railway volume backup, or read access to the Redis instance runs `strings` over it. tw:* and extra_wallets:* come back as {"enc":"gcm1",...} and are useless without the key. session:* and fleetkeys:* come back as plain JSON containing devSecret and every fleet wallet secret. Those wallets hold the live launch float for the 24h/48h TTL window, and the dev wallet is the token's creator, so the attacker can also dump creator supply. The mitigation the operator believes is in place (Phase 0b, "encrypt trading-wallet secrets at rest") does not cover them.

**Impact.** Every dev and fleet wallet balance for the 24-48h key lifetime, plus creator-supply dumping on tokens launched through the service. Bounded by launch volume, not by any single user.

**Fix.** Pass the vault into SessionManager and seal devSecret on write / open it on read the way saveTradingWallet and getTradingWallet do (vault.sealRecord/openRecord already handle a `secret` field and an array of records, keyvault.mjs:41-52 — extend it to also cover `devSecret`, or rename the field). Do the same for the two fleetkeys writes (session-manager.mjs:225 and server.production.mjs:3826). Legacy plaintext keeps reading, because vault.open() passes through anything that is not a gcm1 envelope (keyvault.mjs:34).

**Reviewer's correction.** Downgrade high -> low on reachability (no hosted customer owns a session:* record; the sealed keyspaces are the ones that hold real customer keys). Line-number fix: the second fleetkeys write is src/api/server.production.mjs:3828, not 3826. Also note the vault would need extending regardless — keyvault.mjs:44-46 seals only `secret` and `evmSecret`, so passing a vault into SessionManager without renaming or adding `devSecret` would silently do nothing.

---

## [LOW] .wallet-seeds/ is not gitignored and its AES key defaults to the API_SECRET value published in .env.example
`src/engine/wallet-saver.mjs`:7

**Claim.** `WalletSaver` writes fleet keypair secrets to `<cwd>/.wallet-seeds/<label>-<ts>.enc`. The directory exists in the working tree and is not covered by any rule in .gitignore (`git check-ignore -v .wallet-seeds/` returns nothing, while `data/velocity/`, `risk.json`, `launch/robinhood/.env` etc. are all explicitly listed). The encryption key is `scryptSync(password, "bondli-salt", 32)` where password defaults to `process.env.API_SECRET || "bondli"` — and `.env.example` ships `API_SECRET=bondli_default` uncommented, so the shipped default configuration encrypts private keys under a password that is committed to this repo, with a fixed salt.

**How it fails.** The operator runs `npm run dry` or the orchestrator once on the deploy box, which creates .wallet-seeds/<mint>-<ts>.enc holding base58 secret keys for the whole launch fleet. A later `git add -A && git commit` sweeps the directory into the repo, because nothing ignores it. Anyone with repo access — or anyone at all, if the repo is ever made public — decrypts it in one line with scrypt("bondli_default", "bondli-salt") and drains every fleet wallet.

**Impact.** Full balance of every fleet wallet ever saved, if the directory is ever committed or the box is imaged.

**Fix.** Add `.wallet-seeds/` to .gitignore alongside the other runtime-secret entries. Make WalletSaver refuse to run when API_SECRET is unset or equal to a known default rather than silently using "bondli"; use a random per-file salt instead of the constant "bondli-salt"; and `fs.mkdirSync(..., { mode: 0o700 })`.

**Reviewer's correction.** Downgrade medium -> low on reachability, not on truth. WalletSaver is unreachable from the hosted server: `grep -rn WalletSaver src/` gives only src/engine/orchestrator.mjs:22, recover.mjs:10 and exit.mjs:14, and orchestrator is imported solely by src/api/server.mjs:9 (the dev server) and `npm run dry` (package.json:14) — src/api/server.production.mjs, which package.json:13 "start" runs, never touches it. No bondli.fun customer's key is at stake; the material would be the operator's own launch-fleet keypairs. The directory is also currently empty, so nothing is exposed today. Still worth the one-line .gitignore entry plus a random per-file salt, but it is hygiene, not a live hole.

---

## [LOW] The Polymarket venue is dead in production but is the only venue the CLI's engine builder can pair with pump.fun, so `npm run velocity` is a different bot from the hosted one
`src/velocity/core/build.mjs`:42

**Claim.** There are two engine constructors. src/velocity/core/build.mjs wires pumpfun + polymarket and knows nothing about PONS; src/velocity/hub.mjs wires pumpfun + PONS and pins polymarket and perps to max_exposure_usd 0. build.mjs is reachable only from src/velocity/index.mjs (the `npm run velocity` CLI) and from tests -- never from src/api/server.production.mjs. So the CLI documented in src/velocity/README.md cannot trade Robinhood Chain at all, while the hosted engine cannot trade Polymarket at all, and neither one exercises the other's wiring.

**How it fails.** An operator debugs a live problem with `npm run velocity -- start` as src/velocity/README.md:22-25 instructs. They get an engine with a Polymarket venue that production disables and no PONS venue at all -- so a PONS-specific bug (the venue that produced the '-$25.62 max hold: flat at venue' close) is unreproducible from the CLI. Meanwhile 625 lines of Polymarket adapters are carried, and a third of the velocity test suite exercises them.

**Impact.** none - correctness only; the cost is that the CLI cannot reproduce hosted behaviour on the venue that produced the largest single loss in the observed window

**Fix.** Delete src/velocity/venues/polymarket/ and src/velocity/venues/perps/, drop their keys from DEFAULT_CONFIG (build.mjs:20-22), from hub.mjs:114-115 and from the risk-envelope template in core/risk.mjs, and rewrite the polymarket halves of t1/t2/t4/t5/t10 against pumpfun or pons. Then either teach build.mjs the PONS venue or delete build.mjs + index.mjs + core/server.mjs and make the hub the only constructor.

**Reviewer's correction.** Two numbers in the evidence are wrong and should be fixed: polymarket appears in 10 of the 14 tests/velocity/*.test.mjs files, not 12 — t9, t12, t13 and t14 have zero occurrences. Per-file grep counts are t2 ×7 (not ×8), t5 ×7, t10 ×5, t1 ×4 (not ×5), t4 ×2 (not ×5), t6 ×3, t7 ×3, t3 ×4, t8 ×2, t11 ×1. 'A third of the velocity test suite exercises them' is line-hit counting, not test counting, and overstates the rewrite cost.

---

## [LOW] review().fees_usd — the "fees" figure shown to the user — omits every pump.fun sell-side cost and every kind:"fee" record, but includes paper fees
`src/velocity/core/engine.mjs`:195

**Claim.** The fee total is built from two terms. The exit term sums exit.fee_usd, but the live pump.fun router hardcodes fee_usd: 0 on every sell (venues/pumpfun/router.mjs:378 and :298), so no live sell-side cost is ever counted; and exit records carry no `paper` field at all (engine.mjs:729 writes no `paper` key), so paper exit fees are counted unfiltered. The fill term is correctly live-only but only covers BUY fills. kind:"fee" records — the burnt priority fees from failed sends (chargeFee, engine.mjs:568-570) and the platform performance fee (hub.mjs:250) — are never included. Finally the exit term scans `limit * 3` records while pnl_usd scans `limit`, so the fee window is up to three times wider than the P&L window on the same UI line.

**How it fails.** A user runs 13 live round trips. Each pays pump.fun ~1% on the sell plus a priority fee and a base fee — roughly $0.30 on a $25 exit — and none of it appears. app/src/Simple.jsx:470 renders `last {n} closes: {pnl_usd} · won {win_rate} · fees {fees_usd}`, so the user is told their fee cost is roughly half of what it was, while any paper exits the engine took before going live inflate the same number with simulated fees.

**Impact.** The user-visible cost of trading is understated by roughly the whole sell leg — on the operator's own window that is $11.23 reported against roughly $20 of real cost over 13 trades, and on losing windows it makes the fee drag look survivable when it is not.

**Fix.** Have the live pump.fun close compute fee_usd the way the buy does — `Math.max(0, grossSol - proceedsSol) * solPrice`, or at minimum `(priorityFeeSol + BASE_FEE_SOL) * solPrice` plus the 1% venue cut — instead of hardcoding 0; add `paper: !!f.paper` to the exit record at engine.mjs:729 and filter on it; add the kind:"fee" records to the sum; and use the same window for both terms.

**Reviewer's correction.** Confirmed as a code defect on every sub-claim, but the money impact is close to zero at present because the omitted sell leg (~$0.44/trade) is almost exactly offset by the ATA rent (~$0.41/trade) that the buy fee wrongly includes. Severity low. The fix should credit the rent as well as charge the sell, or the number will swing the other way.

---

## [LOW] The learner trains on paper fills and never ages them out, unlike modeStats which filters both
`src/velocity/core/engine.mjs`:929

**Claim.** engine.retrain() reads 'this.ledger.query({ kind: "outcome", venue: "pumpfun", limit: 5000 })' with no paper filter and no time cutoff, and hands the lot to learner.retrain(), whose usable filter (learner.mjs:73) also ignores the paper flag that engine.mjs:877 writes on every record. Twenty lines earlier the same file gets this right: modeStats (engine.mjs:191-201) filters '!!o.paper === (this.store.venueMode(o.venue) === "paper")' and applies a 14-day statsWindowMs cutoff, with a comment explaining exactly why the window is needed. The learner has neither. Every paper-mode warm-up close - simulated fills with no slippage, no failed sends, no partial exits - stays in the training set for the life of the append-only ledger. Separately the retrain trigger at engine.mjs:885 increments _outcomesSinceRetrain on every close of every venue and both modes, while retrain() only reads pump.fun rows: on the documented deployment (pump.fun live, PONS paper) 50 PONS paper closes will fire a retrain that has no new pump.fun data at all.

**How it fails.** A user runs 200 paper trades before going live. Paper fills never fail and never slip, so their P&L distribution is systematically kinder than live. Those 200 rows sit permanently in every future retrain alongside the first 50 real ones, and because the ledger is append-only with no cutoff their share only decays as the user trades more - it never expires. Meanwhile a market regime change from six months ago still carries the same weight as last week.

**Impact.** Contaminates whatever the learner eventually produces once finding 1 is fixed. No loss today because retrain cannot move a weight.

**Fix.** Mirror modeStats exactly: '.filter(o => !o.paper).filter(o => !(o.ts > 0) || o.ts >= this.clock() - this.cfg.statsWindowMs)' at engine.mjs:929, or better, factor the one filter into a shared helper so the two paths cannot diverge again. Gate the trigger at :885 on the outcome being a live pump.fun close.

**Reviewer's correction.** Split the finding. CONFIRMED and hosted-reachable: engine.mjs:949 applies neither the 14-day statsWindowMs cutoff nor any mode filter that modeStats (engine.mjs:200-203) applies twenty lines earlier, and the retrain trigger (engine.mjs:905) counts closes from every venue and mode while retrain() reads pump.fun only, so PONS paper closes fire pump.fun retrains that have no new data. REFUTED for the hosted path: pump.fun paper outcomes cannot exist there — hub.mjs:198 promotes pumpfun to live during start() and aborts the engine if that fails, so the paper-contamination scenario applies only to the CLI/status-server path (core/server.mjs:52). Downgrade to low. Correct line is engine.mjs:949, not :929.

---

## [LOW] planAdjustments grows one 180-byte record per tick and is persisted forever; closed positions are never pruned from the store
`src/velocity/core/exits.mjs`:118

**Claim.** Both plan-adjustment branches append to position.planAdjustments on every tick that produces a WIDEN_TPS or TIGHTEN_SLS, with no cap and no dedupe. Because scoreDrop is measured from entry (see finding 1) a decaying position emits one record per tick for its entire hold. The position lives in store.state.positions, which is serialized in full with `JSON.stringify(state, null, 2)` on every save (store.mjs:57-62) and from which nothing is ever deleted — store.closePosition (store.mjs:79-83) only patches status.

**How it fails.** A tier-3 position held for the full 10 minutes at the 1 Hz tick poll accumulates ~600 planAdjustments = ~105 KB. Forty such positions accumulate ~4.1 MB, and every one of them is still in state.positions after it closes, so the whole file is re-pretty-printed and rewritten to the Railway volume every saveMs (5s) — per user, since the hub runs one engine and one store per tenant.

**Impact.** none - correctness only, but it degrades the write path that persists open positions, and a torn or oversized snapshot is how a live position gets forgotten across a restart.

**Fix.** Cap the array (`.slice(-20)`) and skip the append when the last record has the same action and multiplier. Independently, prune state.positions in Store.save(): keep open positions plus the N most recently closed, and let the ledger be the record (as the store's own header comment already says it should be).

**Reviewer's correction.** Re-attribute the cause: TIGHTEN_SLS repeats because scoreDrop is measured from entry (exit-plan.js:65) AND because exits.mjs:162-166 appends unconditionally even once the stop has hit its floor (exits.mjs:163, max(MIN_STOP_PCT, designed*MAX_STOP_TIGHTEN) = 5 for tier 3) and the adjustment is a no-op. Record size is 221 bytes pretty-printed, not 180 (pipeline.js:224 adds changePct/fromPeak/currentMcap). Severity low: no money path, but store.mjs:57-62 re-stringifies the whole never-pruned positions map every 5s per tenant.

---

## [LOW] curve.js is missing from GATE_FILES, so the bonding-curve maths four kill gates depend on is outside the gate-integrity checksum
`src/velocity/core/learner.mjs`:155

**Claim.** GATE_FILES enumerates the files whose sha256 must not change without an alert (`verifyChecksums`, used by the supervisor/alerter). It lists disqualifiers.js, viability.js, confidence.js, execution-window.js, pipeline.mjs, risk.mjs and both edge models — but not `src/autoape/gates/curve.js`, which commit 8 just made the sole owner of `pumpCurvePct` / `curvePctOf` for disqualifiers.js:134, execution-window.js:36, autoape/pipeline.js:200 and autoape/recovery.js:35.

**How it fails.** Someone edits `PUMP_GRADUATION_SOL` or the clamp in curve.js — changing what TOO_LATE at 0.80 and CURVE_TOO_ADVANCED_SPEC at 0.40 actually mean for every entry — and the checksum reports the gates as unchanged, so no alert is raised and no ledger entry records that the kill gates moved.

**Impact.** none - correctness only

**Fix.** Add `path.resolve(here, "../../autoape/gates/curve.js")` to GATE_FILES, and add `plans.mjs` on the same reasoning (planFor supplies stop_fraction and stake_cap_fraction to the entry decision).

> No verdict was returned for this one. Treat as unconfirmed.

---

## [LOW] Permutation importance is a single unaveraged draw, so at the retrain cadence of 50 outcomes the weight it produces is Monte-Carlo noise, not measurement
`src/velocity/core/learner.mjs`:82

**Claim.** Importance is estimated from one permutation per feature (learner.mjs:80-84) with no repeats and no averaging, on a sample as small as minOutcomes=30 (:68) and typically 50 (engine.cfg.retrainEvery, engine.mjs:45). The seed is hard-coded to 1, which makes the result reproducible but does not make it accurate: the weight the learner lands on is a property of that one draw. Accuracy itself is granular to 1/n, so at n=50 a single flipped sample moves it 0.02 - the same order as any real effect. The learner therefore needs an order of magnitude more closed trades than the code demands before its output distinguishes signal from the RNG.

**How it fails.** The 50th trade closes, retrain fires, and apeScore is written as 0.33 rather than 0.50 purely because seed 1 happened to draw that permutation. The weights record is saved with an importance table an operator will read as a finding. Fifty trades later the same data would have produced a different answer had the seed been 2.

**Impact.** Quantifies the honest answer to 'how many trades before the learner means anything': roughly 400 closes for the weight vector to be stable to within ~13%, and ~1500 for ~9%. At the observed $25 stake and $0.66-$0.86 fee per trade that is about $10,000 of turnover and $300 of fees for the first, and $37,500 and $1,100 for the second - and the per-tier p_win that gates sizing needs ~100 closes per tier before its confidence interval excludes zero edge, not the 30 the code requires.

**Fix.** Average importance over at least 20 permutation repeats per feature (cheap: accuracy is O(n*k)) and report its standard deviation alongside the mean. Refuse to apply a weight change whose importance is within one sd of zero. Raise minOutcomes from 30 to a power-justified number and raise minOutcomesForStats from 30 to at least 100 per tier, or keep blending priors with the measurement using a Beta posterior instead of a hard switch at 30.

**Reviewer's correction.** Confirmed mechanically, downgrade to low. Fix the statistics presentation: those percentages are ranges, not standard deviations — measured sd/mean is 4.6% at n=30 and 3.9% at n=50, with the seed-to-seed apeScore range spanning ~0.10 at both. Reframe money_impact as the trade volume needed before the estimator is stable, not as a loss. Note the interaction with finding 0: on the live feature distribution importance-total is exactly 0 in most retrains, so the seed noise only bites in the minority of runs where a signal is measured at all.

---

## [LOW] A PONS performance fee is written to the ledger as venue "pumpfun" with the ETH amount in a field named sol
`src/velocity/hub.mjs`:250

**Claim.** settleFee computes the venue and quote correctly at hub.mjs:245 (`const venue = position.venue || "pumpfun", quote = venue === "pons" ? "ETH" : "SOL"`), transfers through the right router, and prices with the right quote asset — then hardcodes `venue: "pumpfun"` in the ledger record and labels the amount `sol` and the note "SOL profit". The waived-fee branch at hub.mjs:241 does use the real venue, so the two branches disagree. this.fee.recordTradeOutcome(wallet, f.net) at hub.mjs:234 likewise adds an ETH profit into a SOL-denominated running total (src/engine/fee-engine.mjs:47-58 `stats.totalProfit`), which is surfaced as `totalProfit` at src/api/server.production.mjs:3299.

**How it fails.** A user trades PONS on Robinhood Chain and closes a winner with 0.004 ETH of profit. 0.0002 ETH is transferred to PLATFORM_EVM_WALLET, but the ledger says the fee was paid on pumpfun in SOL. Any per-venue fee query (`ledger.query({kind:"fee", venue:"pons"})`) returns nothing, and every ETH fee is silently attributed to the Solana venue. Separately, the user's lifetime totalProfit adds ETH and SOL numerically — 0.004 ETH counts as 0.004 SOL, about a 20x understatement at current prices.

**Impact.** No dollars lost on the transfer itself, but per-venue fee revenue is unauditable and the lifetime profit figure shown at server.production.mjs:3299 mixes two currencies with a ~20x price difference.

**Fix.** Use the `venue` and `quote` already computed at hub.mjs:245 in the append: `venue`, and either rename the amount field to `quote_amount` with a `quote` field, or keep `sol` only for SOL and add `eth` for pons. Make the note use `quote`. Pass a quote-tagged value (or a USD value) to recordTradeOutcome so SOL and ETH profits are not summed as one number.

**Reviewer's correction.** Literally true, but it is a mislabelled record, not lost or misvalued money: the USD amount is priced with the ETH price and is right, no code path consumes kind:'fee' by venue, and the currency-mixed totalProfit only feeds a cosmetic badge because the hub charges a flat rate. Low.

---

## [LOW] A performance-fee transfer that throws loses the fee permanently: no ledger record, no retry, and recordTradeOutcome has already run
`src/velocity/hub.mjs`:249

**Claim.** settleFee awaits liveRouter.transferSol at hub.mjs:249 and writes the kind:"fee" ledger record only on the line after it (hub.mjs:250). The only caller is the fire-and-forget outcome listener at hub.mjs:147, whose .catch just logs. If the transfer throws — the wallet is short of the base fee, the RPC drops the send, the blockhash expires — the fee is never collected, nothing is written to the ledger, and nothing ever retries it, because the outcome event fires exactly once per position. this.fee.recordTradeOutcome(wallet, f.net) at hub.mjs:234 has already run, so the user's win streak and totalProfit advance as though the fee were paid.

**How it fails.** A user's SOL wallet is drawn down near the reserve after a run of entries. A winner closes with 0.02 SOL of profit; the 0.001 SOL fee transfer fails for lack of lamports to pay its own base fee. The platform gets nothing, the ledger shows no fee record at all (not even a failed one), and the operator has no way to discover the miss except by grepping stderr for "[VELOCITY-HUB] fee".

**Impact.** Silent, unbounded platform revenue loss — 5% of every profitable close whose transfer fails, with no record that it was ever owed.

**Fix.** Wrap the transfer in try/catch and, on failure, append a `kind: "fee"` record with `collected: false`, the amount owed and the error, then keep a per-user owed balance the sweep (engine.mjs:270 onward) or the next successful settleFee drains. That also gives the operator an auditable list of uncollected fees instead of a log line.

**Reviewer's correction.** Confirmed, but scale it: this is bounded platform revenue (5% of profit, floor 0.0005 SOL ~ $0.10) with no user-fund exposure. The stronger half of the fix is the audit record (`collected:false` plus an owed balance), not the money. Note the converse defect in the same call: an unconfirmed transfer is recorded as collected because transferSol only throws on st.err.

---

## [LOW] The platform performance fee never reaches the daily loss budget or the governor
`src/velocity/hub.mjs`:259

**Claim.** settleFee moves SOL out of the user's trading wallet and writes a `kind: "fee"` ledger row, but unlike engine.chargeFee it never decrements `store.state.day.realizedUsd`. The daily loss limit, the governor's realizedLoss, and the day P&L shown to the user are all gross of the 5% performance fee.

**How it fails.** A user closes a winner for +$20 gross. The hub transfers 5% ($1) of the SOL profit to PLATFORM_WALLET. day.realizedUsd records +$20, not +$19. Over a session the user's displayed day P&L and the daily-loss headroom both drift above the truth by the cumulative fee — $11.23 in the operator's recent 13-trade window, on +$23.81 of closed P&L, i.e. the reported figure is ~47% higher than what the wallet actually gained. The next wallet refresh silently reconciles the balance, so the two numbers disagree with no error anywhere.

**Impact.** No lost funds, but the daily loss limit is enforced against a P&L that is high by the full fee take ($11.23 on a $23.81 window in the observed data), and the user-facing day P&L overstates by the same amount.

**Fix.** Route the platform fee through the same accounting as any other fee: after a successful transfer call `u.engine.chargeFee(venue, position.instrument, f.fee * solPrice, 'performance fee')` instead of appending the row by hand, or add the equivalent `day.realizedUsd` decrement plus the ledger row inside settleFee.

**Reviewer's correction.** Confirmed as code truth at hub.mjs:296 (not :259): settleFee writes the ledger row without the day.realizedUsd decrement that engine.chargeFee (engine.mjs:697-703) performs. But the impact is much smaller. The fee is only charged on winners, so the drift makes the daily budget less conservative rather than triggering a false halt; the headline P&L the user reads is truePnl()/since_start_usd (Simple.jsx:281, engine.mjs:1063), which is wallet-derived and already net of the fee; and the $11.23 cited is review().fees_usd, which sums venue exit/fill fees and excludes platform fee rows entirely. Low.

---

## [LOW] A PONS performance fee is written to the ledger as a pump.fun fee denominated in SOL
`src/velocity/hub.mjs`:270

**Claim.** settleFee correctly resolves venue and quote a few lines earlier (hub.mjs:265-266: `const venue = position.venue || "pumpfun", quote = venue === "pons" ? "ETH" : "SOL"`) and pays the fee in ETH from the EVM router (:269), but the ledger row hardcodes `venue: "pumpfun"` and labels the amount 'SOL profit' (:270). The waived-fee row two branches up gets this right (:260 uses venue0), so the mistake is isolated to the collected-fee row.

**How it fails.** A user earns 0.004 ETH of profit on Robinhood Chain and pays a 0.0002 ETH fee. The ledger records kind:"fee", venue:"pumpfun", sol:0.0002, note:"... of ... SOL profit". Any per-venue fee total, any reconciliation of PLATFORM_WALLET (Solana) against PLATFORM_EVM_WALLET receipts, and the user-facing narration (hub.narration -> formatRecord) all attribute ETH to the Solana venue. The $11.23/$26.25 fee figures in the operator's window cannot be split by chain.

**Impact.** None directly — the right amount is paid from the right wallet — but per-venue fee accounting and the user's fee narration are wrong for every PONS trade.

**Fix.** Use the variables already in scope: `venue,` and `note: \`performance fee ${f.rate ?? ""}% of ${f.net.toFixed(4)} ${quote} profit\``. Consider renaming the amount field or adding `quote` alongside `sol` so a reader of the ledger cannot mistake ETH for SOL.

**Reviewer's correction.** Confirmed exactly as described; only the line numbers are stale. The bad row is hub.mjs:296 (not :270), the correctly-scoped variables are declared at hub.mjs:291 (`const venue = position.venue || "pumpfun", quote = venue === "pons" ? "ETH" : "SOL"`), the ETH transfer is hub.mjs:295, and the correct waived-fee row is hub.mjs:286. One thing the finding got right that is worth keeping: the `usd` field on that row IS correct, because it is computed from `u.engine.quotePriceOf(venue)` at hub.mjs:294 — so only the `venue` label and the word 'SOL' in the note are wrong, and the dollar figure a user sees is right.

---

## [LOW] hub.mjs's cost table — the sole justification for MIN_STAKE_USD = 10 — omits curve impact, is non-monotone in the wrong direction, and understates every break-even by 1.4-6 points
`src/velocity/hub.mjs`:35

**Claim.** The table at hub.mjs:35-40 lists "variable 3.0%" at every stake, i.e. fees only. The gate's own costs() adds a curve-impact term that scales with stake (edge.mjs:172), so the two disagree, and the disagreement grows with size: the table says $40 is the cheapest stake at 3.31%, while costs() charges 3.974% at $40 — MORE than the 3.909% it charges at $25. The real cost curve has a minimum at $27.17 and rises on both sides; the table's monotone "bigger is cheaper" shape is an artifact of dropping the only term that grows.

**How it fails.** The table is the documented basis for lowering MIN_STAKE_USD from 25 to 10 (hub.mjs:30-44) and is quoted again at hub.mjs:110-111 as the per-venue floor's justification. It tells the reader the true break-even win rate is 29.9-32.4% when at the same payoff shape it is 34-35%, and that going bigger keeps getting cheaper when past ~$27 it does not. Any later sizing decision made from this table starts from numbers the engine itself does not agree with.

**Impact.** none directly - but it is the stated basis for the min-stake floor, and it hides that break-even is 34-35%, not 30%, against a 17% observed win rate.

**Fix.** Regenerate the table from edge.costs() rather than by hand, add the impact column and a performance-fee column, and state the minimum ($27.17 at SOL $200 / a 30-SOL curve) rather than implying monotonicity.

**Reviewer's correction.** Downgrade to low: this is a comment block, not executable code — nothing reads the table, the engine prices costs from edge.costs() at ctx.minStakeUsd (pipeline.mjs:100), so no trading decision is made from these numbers. Also the finding's own break-even corrections are overstated: at the table's quoted shape (+24.1%/-5.3%) the true break-even at $25 is (0.03909+0.053)/0.294 = 31.3%, or 32.7% once the 5% fee is taken off the wins — not 34.14%. The $5 row (36.9% / 38.5%) is close to what the finding claims; the $25 and $40 rows are not. The correct headline is 'the table understates cost by 0.08-0.67 points and inverts the ordering above ~$27', not 'break-even is 34-35%'.

---

## [LOW] hub.mjs hardcodes venue "pumpfun" on the collected-fee ledger row, and T11's only fee assertions are on pump.fun trades
`src/velocity/hub.mjs`:296

**Claim.** `settleFee` writes the collected-fee record with a literal `venue: "pumpfun"` while every other field on the same call is venue-correct (`quote`, `feeWallet`, `solPrice` all branch on `venue === "pons"` at lines 292-295). The waived-fee row twelve lines above (hub.mjs:286) correctly uses `venue: venue0`, which proves the literal at :296 is a slip, not a decision. So a Robinhood Chain performance fee is recorded against pump.fun, with an ETH amount in the field named `sol` and a USD value computed at the ETH price. T11's only fee assertions (t11:111-113, t11:147) are on pumpfun positions, and no test in the suite ever reaches settleFee with `position.venue === "pons"`.

**How it fails.** A user's PONS position closes at +0.02 ETH profit. The fee (0.001 ETH at 5%) is correctly transferred to `platformEvmWallet`, but the ledger row says `venue: "pumpfun", sol: 0.001, usd: 0.001 * ethPrice`. Any per-venue fee reconciliation, revenue report or user-facing fee breakdown attributes ETH revenue to the Solana venue and the SOL/ETH amounts become non-additive.

**Impact.** Platform revenue accounting: ETH-denominated fees booked under pump.fun and summed with SOL amounts in the same field.

**Fix.** Change `venue: "pumpfun"` to `venue` at hub.mjs:296 (and consider renaming `sol` to `quote_amount` or adding a `quote` field, as the waived row already carries the venue). Add a T11 case with a pons position reaching settleFee, asserting `feeRec.venue === "pons"` and that the transfer went to `platformEvmWallet`.

**Reviewer's correction.** Severity low, not medium. The 'accounting-corruption' framing overstates it: no number anywhere is wrong, and no code path today reads the field. The claim that 'the SOL/ETH amounts become non-additive' is misleading — they were already non-additive, because the waived row at :286 puts an ETH figure in a field named `sol` too, venue-correctly. What IS a live numeric corruption sits two lines away and this finding missed it (see the `missed` list): hub.mjs:297 feeds the ETH fee into a SOL accumulator that is persisted to Redis and read back. The one-character fix at :296 is right and should be made; it just is not where the money is.

---

## [LOW] A held PONS token whose curve read fails, or whose quote is an ERC-20, gets no tick at all — the position is never marked and every price-based exit is unreachable
`src/velocity/venues/pons/feed.mjs`:303

**Claim.** In pollOnce the two `continue` guards at :303 (native === false) and :304 (mcapUsd <= 0 or solPrice <= 0) sit BEFORE the tick emission at :306. The candidate-side filters below (snipe window :307, two-buyers floor :308, change filter :309) are correctly placed after it, so the ordering is clearly meant to be 'ticks first, candidates after' — but these two escape it. A watched token that never hydrates successfully keeps mcapUsd at its initial 0 (set in apply at :215, only raised by _remark at :240), so the engine gets no tick for it: markPosition never runs, position.mark/peak/changePct/unrealized_usd stay at their entry values, and every tick-driven exit (stop loss, ride-trail, stall, pre-graduation) is unreachable.

**How it fails.** An adopted position whose curve address is right but whose curveInfo call keeps failing on the rate-limited public RPC (_hydrate swallows it into t._hydrateError at feed.mjs:254): the feed polls it every 4 seconds forever and emits nothing. The UI shows the position at cost with unrealized_usd 0. The only exit left is the sweeper's MAX_HOLD/STALL after tickSilenceMs, i.e. the position rides its entire max hold with no stop loss regardless of what the price does.

**Fix.** Move the tick emission above the two guards for watched tokens: compute the payload and emit the tick whenever this.watched.has(t.ca), carrying a `stale: true` / `mcapUsd: null` marker when the curve could not be read, and keep :303-:304 as candidate-only filters. markPosition already ignores a non-positive mcap (exits.mjs:50), so a stale tick is safe — and it lets the position's lastTickAt reflect reality instead of leaving the engine with no signal either way.

**Reviewer's correction.** The ordering claim is literally true — feed.mjs:303 (`if (t.native === false) continue`) and :304 (`if (!(t.mcapUsd > 0) || !(this.solPrice > 0)) continue`) both precede the tick emission at :306, while the three candidate-only filters at :307-309 correctly follow it. But the consequence is overstated twice. First, the finding's premise that a failing hydrate 'keeps mcapUsd at its initial 0' only holds for a token that has NEVER hydrated successfully: feed.mjs:254's catch leaves every field untouched and _remark (:240) keeps the last positive mcap, so a token that hydrated once keeps ticking at a stale mark — a different and arguably worse bug, but not this one. The only real no-tick population is an adopted token (feed.mjs:199 creates it with mcapUsd 0) whose _hydrate keeps failing. Second, 'the position rides its entire max hold with no stop loss' is wrong: with no tick, `quiet = now - (p.lastTickAt || p.entryTime)` grows monotonically, and the sweeper's DOA (engine.mjs:352, doa_ms 12s at tier 3 per plans.mjs:23), STALL (engine.mjs:358, 2 min) and MAX_HOLD (engine.mjs:336) all key on exactly that silence — an adopted position at restart has an old entryTime and is swept on the first 5s sweep. The genuinely uncovered case is narrower: a position that ticked long enough to arm the trail (peakPct >= stall_band_pct * 1.5) and then goes silent, since engine.mjs:352/358 skip an armed position and only MAX_HOLD at 10 min remains. Downgrade to low.

---

## [LOW] The router's curve discovery is weaker than the feed's on exactly the path where a position has no curve
`src/velocity/venues/pons/router.mjs`:124

**Claim.** _curveFor asks only the PonsV2LaunchFactory (getLaunchedToken) and returns null if that comes back empty (:128-131). The feed's rpc.curveFor is strictly stronger: it tries the factory and then, for a curve from another factory version, checks every address that ever transferred the token to this wallet and asks it token() (feed.mjs:83-95). The hub uses the strong one for manual sells (hub.mjs:414) and sweeps (through _rhInventory, hub.mjs:344). The engine's exit path uses only the weak one, and that is the path adopted positions take: reconcile builds an adopted position with `reference: decision?.reference || null` (engine.mjs:970) and sets no `curve` field, so close() has nothing but the factory to go on.

**How it fails.** A token bought before the current factory was deployed, or one the wallet received from a curve the factory does not index, is adopted at restart. Every exit attempt returns NO_CURVE (router.mjs:197) — 'the factory does not know this token; not a PONS launch, sell by hand' — even though the hub's holdings page can name the curve for the same token from the transfer scan. The position never sells and, per finding 3, never leaves the book.

**Fix.** Let the router take the same fallback: give PonsLiveRouter an optional `curveResolver` (wired to ponsFeed.rpc.curveFor in hub.mjs:100/143) and call it in _curveFor when the factory answers zero, seeding the senders list from the rh-scan file. Cheaper stopgap: have reconcile stamp the resolved curve onto the adopted position (`curve: <address>`) so close() at router.mjs:193 finds it without any lookup.

**Reviewer's correction.** The mechanical claim is true — router.mjs:124-134 asks only PonsV2LaunchFactory.getLaunchedToken and returns null on a zero answer, while feed.mjs:83-95 falls back to asking every historical sender token(). But the failure scenario is almost entirely unreachable and the severity is low, not medium. close() only consults _curveFor when `ref.curve?.address || position.curve` is falsy (router.mjs:200), and on the engine's exit path that reference is nearly always populated: a tick-driven exit builds `reference = { ...p.reference, ...tick.payload, solPrice }` (engine.mjs:807) and every PONS tick payload carries `curve: { address: t.curve, ... }` (feed.mjs:268); a sweeper-driven exit falls back to p.reference, and an adopted position's p.reference is `decision?.reference` (engine.mjs:1001), which for PONS carries `...(p.curve ? { curve: p.curve, quote } : {})` (src/velocity/venues/pumpfun/edge.mjs:105). More decisively: any token the engine can hold was emitted by PonsFeed, and PonsFeed only ever learns about a token from the current FACTORY's TokenLaunched log (feed.mjs:286) or from launchInfo against that same FACTORY (feed.mjs:97-103) — so by construction the factory knows every token the engine bought. The weak path therefore bites only across a FACTORY address migration, or for a position whose decision row has aged out of the ledger. Report it as hardening, not as a live stuck-capital defect.

---

## [LOW] A perfect losing record reads as "no record" and restores the tier to full prior optimism
`src/velocity/venues/pumpfun/edge.mjs`:135

**Claim.** useStats requires stats.p_win > 0. A tier that has lost every one of its last 30+ trades has p_win exactly 0, fails the guard, falls back to the prior (p_win 0.30, payoff 3.0) with on_priors = true, and is then let through by the probe path at pipeline.mjs:115 because the prior's edgeBeforeCosts is 0.200 > 0. The worse the record, the more likely it is to be discarded. The mirror case is equally wrong: stats.mjs:22 defaults avgLoss to 1 when a tier had no losses and stats.mjs:28 sets loss_fraction to 0, so a tier that won every trade gets payoff = avgWin (e.g. 0.24) against a 100%-of-stake loss unit and is hard-rejected with no probe.

**How it fails.** The 14-day rolling window (engine.mjs:53, statsWindowMs) is meant to let a closed tier probe again after its record ages out. But a tier that goes 0-for-30 does not have to wait for the window at all: it is treated as unmeasured on the 30th loss and immediately resumes at the prior's optimism and full stake. This is the exact failure mode modeStats:195-199 says it is guarding against, inverted.

**Impact.** A tier that has proven it loses 100% of the time resumes trading at $10-25 per entry with no cooldown.

**Fix.** Change the guard to `stats.n >= minOutcomesForStats && stats.payoff >= 0` and handle p_win === 0 explicitly as a measured, decisive zero (edgeR = -1, hard reject, no probe). For the zero-loss case, fall back to the prior's loss_fraction while still using the measured p_win rather than reading avgLoss as 1.0.

**Reviewer's correction.** Downgrade to low. Two accuracy fixes. (1) The named guard is not the deciding one on its own: at p_win = 0 the payoff is also 0 (stats.mjs:24 avgWin = 0), so `stats.payoff > 0` fails too — the proposed fix of 'p_win >= 0 && payoff >= 0' has to handle both, and 'payoff >= 0' alone would let a zero payoff through pipeline.mjs:108 as NO_EDGE_ESTIMATE rather than as a decisive measured zero. (2) Probability: 0 wins in 30 at the observed 17-46% win rate is roughly 1e-3 down to 1e-8, and the all-win mirror is effectively unreachable. This is a correctness/absorbing-state inversion worth fixing, not a live money leak; there is no evidence in the operator's data that either branch has fired.

---

## [LOW] resolvePending's BUY estimate double-counts fees: est.notional_usd already contains est.fee_usd
`src/velocity/venues/pumpfun/router.mjs`:290

**Claim.** pumpfunFillModel returns notional_usd = spentSol*solPrice where spentSol already includes the portal fee and the per-send cost, and fee_usd = (spentSol − stakeSol)*solPrice, i.e. a component of that same notional (router.mjs:58-59). Line 290 then builds the synthetic delta as `solDelta: -solOf(est.notional_usd + est.fee_usd)`, adding the fee a second time. The SELL branch on the same line correctly uses est.notional_usd alone, because the sell model's notional is already net.

**How it fails.** A buy confirms but getTransaction stays unreadable for more than BLOCKHASH_LIFETIME_MS (90 s) — a Helius/load-balancer symptom the file already anticipates at line 213-214. sweep() → resolvePending falls to the estimate. For a $25 stake at SOL $200: est.notional_usd = 25.186, est.fee_usd = 0.186, so the booked solDelta is −0.12686 SOL ($25.372) instead of −0.12593 SOL ($25.186). cost_usd is inflated by $0.186 (0.74% of the trade) and entryPrice with it, which then shifts every percentage-based exit trigger on that position. Verified numerically by calling pumpfunFillModel directly.

**Impact.** $0.186 of phantom cost basis per $25 late-settled buy (0.74%), on top of the ~$0.41 rent asymmetry in the same line, mis-marking the position's entry price and therefore its exit triggers.

**Fix.** router.mjs:290 → `d = side === "BUY" ? { solDelta: -solOf(est.notional_usd), tokenDelta: est.qty, estimated: true } : ...`. Note that this estimate also omits RENT_ATA_SOL by construction (the paper model nets it out, router.mjs:44-45) while the real measured path includes it, so once the double-count is removed the estimate will still be ~$0.41 light versus a measured fill unless finding 2 is fixed at the same time — fix both together so the two paths agree.

**Reviewer's correction.** Code claim is true; both impact claims are wrong. Exit triggers are unaffected — entryPrice only feeds plan.stop_price/target_price (exits.mjs:34-36), which are read only by evaluatePolymarket (exits.mjs:188-189); pump.fun marks from mcapUsd (engine.mjs:31-34, exits.mjs:50-56). And the sign is inverted: against a measured live fill ($25.594 at SOL $200) the double-counted estimate books $25.372, i.e. $0.22 LOW, while the 'corrected' estimate would be $0.41 low. So this is not '$0.186 of phantom cost basis' — it is an inconsistent ternary that happens to shrink the estimate-vs-measured gap. Severity medium -> low, and it must not be fixed without fixing the rent convention (finding [1]) in the same change.

---

## [LOW] close() has none of submit()'s SOL-price guards, so it will value real proceeds at a zero or arbitrarily stale price
`src/velocity/venues/pumpfun/router.mjs`:346

**Claim.** submit() refuses to trade on a missing price (NO_SOL_PRICE, line 305) and on one older than SOL_PRICE_MAX_AGE_MS (STALE_SOL_PRICE, lines 312-314). close() has neither check: it takes `Number(ctx.reference?.solPrice || position.reference?.solPrice) || 0` and multiplies the measured SOL proceeds by it, whatever it is. A zero produces notional_usd = 0 on a sale that really landed; a stale one puts the feed's drift straight into booked P&L, and unlike an entry the money has already left the venue so there is no refusal available.

**How it fails.** (a) Zero: hub.sellHolding builds `const price = this.feed?.solPrice || 0` (hub.mjs:412) and calls router.close with a bare position object that has no `reference` (hub.mjs:415); hub.sweepWallet does the same (hub.mjs:439, 444). PumpfunFeed.solPrice starts at 0 (feed.mjs:81) and is only set on the first /coins fetch, so a user pressing "sell everything" before or during a feed outage gets a real sale reported as $0 proceeds. Inside the engine, an adopted position with no decision record carries `reference: null` (engine.mjs:977) and freshSol falls all the way through to 0 (engine.mjs:791) if reconcile runs before the feed's first price — then _bookExit records proceeds $0 and a −100% outcome. (b) Stale: if bondli's /coins endpoint dies, submit() correctly stops entering (STALE_SOL_PRICE) while close() keeps valuing every exit at the last price it saw, indefinitely — a 5% SOL move while the feed is down is 5% of error injected into every closed trade's P&L and into day.realizedUsd.

**Impact.** 100% of a trade's proceeds when solPrice is 0 (~$25); proportional to feed drift when stale — a 5% SOL move during an outage is ~$1.25 of error per $25 exit, applied to every close.

**Fix.** close() must not refuse to sell (the exit is the safety mechanism), but it must refuse to *price* a sale it cannot value. Keep sol_received (the measured SOL, which is price-independent) and, when solPrice is 0 or its solPriceAt is older than SOL_PRICE_MAX_AGE_MS, return the fill with `notional_usd: null, price: null, unpriced: true`; then have engine._bookExit (engine.mjs:841) refuse to finalize an unpriced exit — leave the position open with a pendingExit-style marker and re-price it from sol_received once a fresh price arrives. At minimum, log loudly and never let an unpriced exit reach day.realizedUsd.

**Reviewer's correction.** Code claim confirmed; scenario (a) is a UI/report defect, not a P&L one. hub.sellHolding (hub.mjs:446-447) and hub.sweepWallet (hub.mjs:465-468) route tracked open positions through the engine, so the bare-position path with no `reference` only ever handles untracked holdings — a solPrice of 0 there reports $0 proceeds while the SOL is really in the wallet. The genuine −100% needs an ADOPTED position (reference null, engine.mjs:1000) exiting before the feed's first solPrice event (engine.mjs:472); otherwise close() falls back to position.reference.solPrice. The stale half stands unqualified. Correct hub line refs are 448/451 and 475/480, not 412/415 and 439/444. Severity medium -> low.

---

## [LOW] Live fills report modeled slippage, never realized, and the envelope's 300 bps cap is checked against the model while the chain authorizes 1500 bps
`src/velocity/venues/pumpfun/router.mjs`:338

**Claim.** The SLIPPAGE_CAP check at lines 308-309 compares order.max_slippage_bps (300 for pumpfun, risk.example.json:19) against est.slippage_bps, which pumpfunFillModel derives from order.reference — the radar snapshot from decision time. The transaction actually sent carries slippagePct = buySlippagePct (default 15, i.e. 1500 bps, line 109/321). And the fill written to the ledger reports `slippage_bps: +est.slippage_bps.toFixed(2)` — the same model number — even when d.exact is true and the router holds costSol and qty and could compute the realized average price. Nothing anywhere compares realized execution to the cap.

**How it fails.** A tier-3 candidate is decided on a reference that is a few seconds old. The modeled curve impact is 180 bps, under the 300 bps cap, so the order passes. Between the build and the land, other buyers move the curve; the on-chain transaction accepts up to 15% and fills at 900 bps of real impact. submit() returns ok with slippage_bps: 180.00. cost_usd is correct (it is measured from the transaction) so the money shows up as a worse entry price, but the ledger's only execution-quality field says 180 bps, so no report, no governor rule and no learner feature can ever see that the venue's real slippage is 5× the configured cap. On a $25 entry that is up to ~$3 of unmeasured impact per trade, and it is indistinguishable in the books from the token simply going down — which is exactly the shape of "crash-exit 14 = −$25.24".

**Impact.** Up to ~$3 per $25 entry of impact that the configured 300 bps cap is supposed to prevent, and zero visibility into it: the ledger's slippage field cannot detect the gap because it never contains a measured number.

**Fix.** When d.exact is true, report the realized number instead of the model's: with `est.spot` (the pre-trade spot from reservesFromReference) and the measured avg = (costSol*(1-portal-fee))/qty, set `slippage_bps: +((avg/spot - 1) * 1e4).toFixed(2)` and keep the model's value under a separate `modeled_slippage_bps` field. Then either derive buySlippagePct from the envelope (`max_slippage_bps/100` plus a small build-to-land margin) so the on-chain tolerance actually enforces the configured cap, or add a post-fill check that records a violation when realized slippage exceeds max_slippage_bps.

**Reviewer's correction.** Code claims confirmed; the money framing is wrong. P&L is not blind to bad fills — a SOL-denominated buy fixes the SOL outflow, so realized impact lands in the measured `qty` and therefore in price, cost_usd and pnl. The defect is purely that the ledger's slippage_bps field reports the model instead of the realized number, so execution quality can never be attributed or alarmed on. The 1500 bps on-chain tolerance is documented as deliberate at router.mjs:107-108, not an oversight, and the 300 bps cap is inert at the observed size (I measured 41.25 bps for a $25 stake on a fresh 30-SOL curve, and the operator's funnel shows zero SLIPPAGE_CAP rejects). Severity medium -> low; keep only the 'report realized slippage when d.exact' half of the fix.

---

## [LOW] The 2 skipped tests skip unconditionally in CI and cover the token-launcher fleet, not the trading engine — they do not matter for any of the four defects
`tests/robinhood/t5-chain-local.test.mjs`:17

**Claim.** Both skips are `if (!chainId) return t.skip(...)` guarded on a JSON-RPC probe of `FLEET_LOCAL_RPC` (default http://127.0.0.1:8545), which never answers in this environment or in CI, so `npm test` reports 189 pass / 2 skip every run. Their subject is `launch/robinhood/lib/chain-venue.mjs` and `launch/robinhood/lib/fleet.mjs` — the token-launch fleet — not `src/velocity/venues/pons/*`, the trading router. So they cover none of: the shared SOL price, the flat-at-venue phantom loss, the silent-feed stall, or a Robinhood position that would not sell. What is genuinely lost is that they are the only tests in the repo that run ethers against a real node: approve/allowance ordering, a sweep leaving no stranded ETH, and snipe-tax exemption are otherwise verified only against the hand-written FakeChain in t13.

**How it fails.** Not a defect in the trading path. The risk is presentational: "170 pass" (191 subtests) reads as full coverage while the only real-node ethers coverage in the repo is silently absent on every run.

**Fix.** Either wire a hardhat node into the test job so they actually run, or move them to a separate `npm run test:chain` script so the default suite does not report skips that never resolve. Do not prioritise them over the pons-through-engine test above — they exercise a different subsystem.

**Reviewer's correction.** No correction needed; the finding is accurate as written, including its own instruction not to prioritise it over the pons-through-engine test.

---

## [LOW] The hub's router double drops the `pct` argument, so partial exits — a live path (SL1 sells 80%) — are modelled as full exits everywhere the performance fee is tested
`tests/velocity/t11-hub.test.mjs`:28

**Claim.** `FakeLive.close(p)` in the hub tests takes no `pct` parameter at all: it zeroes the whole token balance and always returns `qty: 1000, notional_usd: this.sellSol * 100, sol_received: this.sellSol`, whatever share was requested. Both real routers honour it (`pumpfun/router.mjs` sizes from `pct`; `pons/router.mjs:222` computes `units = p >= 100 ? balUnits : balUnits * BigInt(p) / 100n`). Since `PUMPFUN_EXIT_SETTINGS.sl1Sell = 80` (exits.mjs:18) and the RIDE-trail moonbag partial sells 85% (asserted in t5:179), partial exits are a real and frequent path — but no hub test ever produces one, and the fee is computed from the accumulated `position.sol_received` (hub.mjs:278) on the final close.

**How it fails.** An SL1 partial (80%) followed by the final 20% would, under this fake, return the full `sellSol` twice — `position.sol_received` becomes 2x the real proceeds, and `settleFee` (hub.mjs:278-282) charges the user 5% of a profit that never existed. No hub test can catch that, because no hub test ever issues a partial close.

**Impact.** Performance fee correctness on every partial-then-final exit — the most common shape once the stop loss fires (SL1 = 80%).

**Fix.** Make the hub double honour `pct` (sell `qty * pct/100`, scale `sol_received`, decrement rather than zero the balance) and add one hub test that takes an SL1 partial and then the remainder, asserting the fee is charged once, on the true total profit.

**Reviewer's correction.** The failure scenario as written is wrong and should not be repeated. The fake cannot 'return the full sellSol twice': it zeroes this.tokens[p.instrument] on the first close, so a second close hits the `if (!this.tokens[p.instrument]) return failure(NO_POSITION)` guard at the top of t11:28. What actually happens is subtler and still worth fixing — an 80% SL1 partial returns qty 1000 against a 1000-token position, so engine.mjs:876 computes remaining_qty 0, `done` is true, the position closes, the outcome fires and settleFee runs immediately on the full proceeds. In other words the hub suite models every partial as a final close, so the accumulate-across-partials-then-settle-once behaviour HOSTED_DESIGN.md:37 promises is never exercised in either direction. Severity low: a fidelity gap in a double, with no wrong number in shipping code.

---

# Refuted

- **Paper P&L is added to day.realizedUsd, so simulated trades drive the live daily-loss halt** (`src/velocity/core/engine.mjs`) — CODE TRUTH: false on this branch. _bookExit now splits the booking: /home/user/bondli/src/velocity/core/engine.mjs:888 `if (f.paper) { this.store.state.day.paperRealizedUsd = ...; this.store.state.day.paperTrades++; } else { this.store.state.day.realizedUsd = ...; this.store.state.day.trades++; }`, with the comment naming exactly the bug the finding describes. chargeFee (engine.mjs:699-701) has the same split. store.mjs:28 seeds `paperRealizedUsd: 0, paperTrades: 0` and store.mjs:69-70 rolls/back-fills them, so there is no NaN path from an older state file. realizedToday() (engine.mjs:919-922)
- **portfolioSnapshot builds equity from live positions only but the open list from all positions, so paper positions consume the live bankroll and every concurrency slot** (`src/velocity/core/engine.mjs`) — CODE TRUTH: false as written. portfolioSnapshot at /home/user/bondli/src/velocity/core/engine.mjs:595 is now `const open = this.store.openPositions().filter(p => (anyLive ? !p.paper : true));` and engine.mjs:623 sums equity from that same already-live-only array (`// \`open\` is already live-only here`). So snap.open, snap.equity_usd, the concurrency gate and openRisk all see the same set; the repro in the finding cannot be produced. Commit ffc9bcd 'Stop simulated positions from holding real concurrency slots' is in history. ARITHMETIC NOTE that also kills the finding's second mechanism even i
- **The since-start baseline is captured five lines before the venue is marked live, so it is all zeros and the UI headline P&L equals the user's whole wallet** (`src/velocity/core/engine.mjs`) — CODE TRUTH: false on this branch, and the fix is threefold. (1) noteWallet at /home/user/bondli/src/velocity/core/engine.mjs:238-241 now refuses a baseline with an empty quote map: `if (b.wallet_usd != null && b.all_since_start && Object.keys(b.quote).length > 0)`, with a comment that names the exact defect the finding describes. (2) setVenueMode calls noteWallet a second time AFTER the mode is persisted — engine.mjs:447 `this.store.setVenueMode(...)` then engine.mjs:449 `if (mode === "live" && preflight) this.noteWallet(venue, preflight);` — so the baseline is written while the venue is live.
- **TIGHTEN_SLS / WIDEN_TPS short-circuit layers 2, 3 and 4 for the whole life of a position** (`src/autoape/exit-plan.js`) — CODE TRUTH: false on this branch. The short-circuit was removed in commit 65bf8f7 ("Stop a plan adjustment from cancelling every exit check", 2026-09-12 05:05). /home/user/bondli/src/autoape/pipeline.js:198-204 now reads `let adjustment = null; ... if (deriv && (deriv.action === "SELL" || deriv.action === "PARTIAL_SELL")) return {...deriv,...}; if (deriv) adjustment = deriv;` and the adjustment is only returned at :224, AFTER checkVolumeExit (:207), checkGraduationExit (:212), checkTrailingExit (:216) and checkThresholdExit (:220). The comment at :190-195 describes exactly the bug this finding
- **hub.stop / hub.halt call engine.halt('flatten') off the engine queue, sending two sells for the same position and booking the trade twice** (`src/velocity/hub.mjs`) — CODE TRUTH: false on both halves. (a) All three hub paths are already on the queue: /home/user/bondli/src/velocity/hub.mjs:219 `if (flatten) result = await u.engine.enqueue(() => u.engine.halt("flatten", "user stop", { by: "user" }));` (with the comment "Through the engine queue: off it, this flatten races the tick-driven exits already running on it"), hub.mjs:229 for halt() and hub.mjs:236 for pause(). `grep -rn '\.halt(' src/` returns no off-queue engine.halt except supervisor.mjs:67 (the operator HALT-file path, not a customer path). (b) The re-entrancy guard the finding says does not exist
- **isMoonbag/tpHit are stamped before the sell is attempted, so a failed RIDE-trail partial leaves the FULL position with no stop, no max hold and no retry** (`src/velocity/core/exits.mjs`) — CODE TRUTH: false as written; fixed in commit eafce51 ("Mark a position reduced only once its partial sell has landed", 05:23). exits.mjs no longer mutates pos on a PARTIAL_SELL: /home/user/bondli/src/velocity/core/exits.mjs:168-179 builds a `stamp` object and RETURNS it (`return { action: "PARTIAL_SELL", pct, reason, layer, detail, stamp }`), with a comment at :169-173 stating the exact failure this finding describes as the reason. engine.mjs:782 forwards `stamp: action.stamp || null` into closePosition, and it is applied only inside _bookExit at engine.mjs:868 `applyExitStamp(p, stamp); // t
- **The probe's 40% stake cap is silently undone by MIN_STAKE_FLOOR: every negative-EV probe trades at full size** (`src/velocity/core/risk.mjs`) — CODE TRUTH: the finding's arithmetic premise is false on this branch. hub.mjs:44 sets `MIN_STAKE_USD = ... : 10`, not 25 — the finding asserts `per_trade_max_usd === min_stake_usd === 25`. Second, the 'silently' claim is dead: risk.mjs:166-184 is not the code quoted. The floor branch now recomputes the model cap inline (risk.mjs:178-179 `const modelCap = decision.stake_cap_fraction > 0 && ... ? env.per_trade_max_usd * decision.stake_cap_fraction : Infinity;`) and pushes a second marker at :182 `if (vc.min_stake_usd > modelCap) caps.push("MIN_STAKE_OVER_MODEL_CAP")`, above a seven-line rational
- **PONS entries are priced with pump.fun's realized statistics; the PONS record is computed and never read** (`src/velocity/venues/pumpfun/edge.mjs`) — CODE TRUTH: already fixed on this branch, in commit facd5f7 ("Price Robinhood Chain entries with Robinhood Chain's own record"). The finding quotes edge.mjs:129 as `const stats = ctx.stats?.pumpfun?.[c.tier];`. The actual line is edge.mjs:133 `const stats = ctx.stats?.[venue]?.[c.tier];`, preceded by a five-line comment at :127-131 describing this exact bug in the past tense ("Keyed to \"pumpfun\" it priced Robinhood Chain entries with pump.fun's win rate and payoff ... while the PONS statistics modeStats computes were never read by anything"). The weights line is likewise already `const weigh
- **MIN_STAKE_FLOOR silently overrides MODEL_CAP: probe and revival stakes are floored back up to full size** (`src/velocity/core/risk.mjs`) — CODE TRUTH: the evidence block quotes code that no longer exists on this branch. Commit 7182376 ("Age out realized statistics, and make a model cap's override visible") replaced the one-liner. Current /home/user/bondli/src/velocity/core/risk.mjs:178-182 reads `const modelCap = decision.stake_cap_fraction > 0 && decision.stake_cap_fraction < 1 ? env.per_trade_max_usd * decision.stake_cap_fraction : Infinity; stake = vc.min_stake_usd; caps.push("MIN_STAKE_FLOOR"); if (vc.min_stake_usd > modelCap) caps.push("MIN_STAKE_OVER_MODEL_CAP");`. So the claims "forgets the model cap it applied 16 lines ea
- **daily_loss_limit is floored to exactly one stake, so one open position zeroes the throttle and one full loss halts the account for the day** (`src/velocity/hub.mjs`) — CODE TRUTH: every number in the evidence belongs to a superseded revision. The finding computes `daily = max(25, min(100, round(100*0.15)=15)) = 25` from "hub.mjs:56-64". That code was replaced by commits 7f3a48c and cdb3c6b. Current hub.mjs:45 sets MIN_STAKE_USD = 10; hub.mjs:89-91 sets `DAILY_MAX_FRACTION = 0.35` and `daily = max(10, min(bankroll, dailyLossUsd || min(round(bankroll*0.35), perTrade*maxPositions)))`; hub.mjs:97-99 then reconciles the concurrency down to `affordable = max(1, floor(daily/perTrade))` and hub.mjs:122 records the shortfall. The 15% figure and the MIN_STAKE_USD=25 f
- **The wallet-derived bankroll can be five minutes stale, and paper positions plus in-flight buys are subtracted from it twice** (`src/velocity/core/engine.mjs`) — CODE TRUTH: every line number is stale (565 -> 614, 549 -> 599, 552 -> 602, 575 -> 624), and the headline mechanism has been fixed.

The paper-position half is REFUTED. The finding asserts `equity_usd = freeUsd + liveOpen` adds back only non-paper notional "while the sizer subtracts totalOpen, which also includes paper positions". But engine.mjs:595 is `const open = this.store.openPositions().filter(p => (anyLive ? !p.paper : true));` — paper positions are stripped from `open` BEFORE snap.open is built at line 601, with a comment at 589-593 describing precisely this fix ("`open` was every posi
- **A chunked sell that stops part-way returns ok:true and the engine books the whole position closed, abandoning the unsold tokens** (`src/velocity/venues/pons/router.mjs`) — CODE TRUTH: the file no longer reads as the finding describes. /home/user/bondli/src/velocity/venues/pons/router.mjs:268-270 now computes `const unsold = leftUnits > 0n ? toTokens(leftUnits) : 0; const pctFilled = units > 0n ? Math.min(100, (Number(units - leftUnits)/Number(units))*100) : 0;` and returns `partial: unsold, pct_filled: +pctFilled.toFixed(2)` in the fill. /home/user/bondli/src/velocity/core/engine.mjs:875-876 now reads it: `const filledPct = Number.isFinite(f.pct_filled) ? f.pct_filled : pct; const done = !!(filledPct >= 100 || p.remaining_qty <= 1e-9 || action === "REDEEM" || (p
- **close() will sell without a quote price and book a real sale as $0 proceeds — a 100% loss on money that actually arrived** (`src/velocity/venues/pons/router.mjs`) — CODE TRUTH: I read router.mjs:190-204. The guard is present and precedes _curveFor, balanceOf, _curveNow and every send. The finding's quoted line ':192 ... never validated' is contradicted by the very next lines. The whole downstream story (engine.mjs:856-857/866 booking notional_usd 0 as a total loss into day.realizedUsd) is unreachable from close() now, because close() returns a failure instead of a fill. resolvePending (:277-289) can still price at 0, but it is only called from close() at :208, i.e. after the guard. REACHABILITY of the surviving residual: the hosted path wires exactly `pri
- **walletDeltasFromMeta assumes account index 0 is our wallet, and findRecentSale applies it to third-party transactions** (`src/velocity/venues/pumpfun/router.mjs`) — CODE TRUTH — the literal claim is true: router.mjs:101 reads `meta.postBalances[0] - meta.preBalances[0]` with no check that key 0 is `owner`, while the token leg at line 100 is filtered by mint and owner. router.mjs:261 is `if (since && at && at < since) break;`, which is indeed skipped when blockTime is null.

REACHABILITY — this is where it dies. For the headline scenario to bite, findRecentSale must evaluate a transaction that (a) reduces our ATA's balance and (b) has someone else as fee payer. On Solana index 0 of pre/postBalances is always the fee payer, including for v0 transactions wit
- **The revival tracker's Solana curve reading still uses the raw vSol/85 and clamps at 100, so revival can never fire past 65% of the curve** (`src/api/server.production.mjs`) — CODE TRUTH: line 1456 is quoted correctly -- `curvePct: token.graduated ? null : Math.min(100, (vSol / 85) * 100)`. But the clamp is unreachable. Five statements earlier, at 1440-1441 in the same trade handler, `if (vSol >= 84 && !token.graduated) { token.graduated = true; ... }`, and `graduated` is never reset (grep for `.graduated =` gives only 1328, 1441, 1469, all setting true; 1271/1389 are initialisers). So by the time 1456 runs, any token at vSol >= 84 is flagged graduated and 1456 passes `curvePct: null` -- the tracker never receives a value above (84/85)*100 = 98.8, and Math.min(100, 
- **The app accepts a $10 bankroll and a $10 bankroll can never fill a single trade** (`src/velocity/hub.mjs`) — CODE TRUTH — the arithmetic is right but the causal story is not. solNeededForBuy(0.05, {priorityFeeSol:0.0003, hasAccount:false, slippagePct:15}) = 0.061598 SOL = $12.32, confirmed by running it (router.mjs:93-95), and the sizer does return $10. But the finding never checks the layer that already handles this. hub.start (hub.mjs:203) calls engine.setVenueMode('pumpfun','live',{override:true}), and engine.mjs:425 gets preflight from router.init(), which returns { balanceSol } (router.mjs:134-142). engine.mjs:431-434 then refuses: minSol = min_stake_usd/solPrice + priorityFeeSol + 0.006 = 0.056
- **A declined Phantom signature puts the app in a silent infinite loop: a wallet popup every 8 seconds, no error, no path to a first trade** (`app/src/Simple.jsx`) — CODE TRUTH — the load-bearing premise is false. `/api/trading-wallet/:wallet` is registered at src/api/server.production.mjs:3379 as `app.get("/api/trading-wallet/:wallet", async (req, res) => {...})` with NO requireOwner and no other guard. The only middlewares mounted globally are at server.production.mjs:168 (a small header shim), :175 and :176 (body parsers) and :11211 (the error handler) — I grepped every `app.use(`. requireOwner is applied per-route and only to create/withdraw/export/create-extra/import (:3557, :3572, :3605, :3614, :3668). So `a.gtw(pk)` returns 200, never 401, never rea
