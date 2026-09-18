# What the customer is owed

Someone hands this bot money and walks away. Everything below follows from that one fact. Each
axiom names the rule, what breaks it, and where in the code it is held — so a change that would
violate one has to argue with this file first.

## 1. Money leaves only by a trade they asked for or a fee they were told about.
Nothing else. No route may move funds without the owner's signature (`requireOwner` on all 13 money
routes, held by `tests/api/t15`). The fee is one rate, stated on the site, taken only from realized
profit, and zero for anyone holding `$BNDLI` (`hub.settleFee`, `t14`). A fee whose transfer fails is
recorded as owed and collected later — never silently dropped (`hub.collectOwed`, `t11`). On
Robinhood Chain the fee leaves in ETH and on Arc in USDC, each to the EVM fee wallet, never
converted and never to the Solana one (`QUOTE_OF`, `feeWalletFor`, `t11`).

## 2. The bot never holds what it cannot manage.
A position with no readable price has no stop loss behind it, so it is sold on that fact alone after
45s (`blind-exit`, `t5`). A held token always ticks, readable or not (`t12`, `t22`), and a cached
price whose pool has stopped answering is reported as unreadable, never as current (`t22`). A sell
the venue will never accept — graduated, or refused five times running the same way — releases the position rather
than holding a slot forever and raising an error nobody can clear (`TERMINAL_EXIT_CODES`,
`releaseAfterFailures`, `t9`).

## 3. Every number on screen reconciles with its own parts.
The header P&L must equal what its subtitle says. A venue joining mid-run brings its open positions
into the baseline (`t10`). A partial sell shrinks what is still at risk (`notional_usd`, `t10`).
Rent charged at entry is credited when it comes back (`reclaimRent`, `t10`). Simulated money never
touches the real day's ledger (`t7`, `t11`). Fees are recorded on the venue and in the asset they
were paid (`hub.settleFee`).

## 4. A loss is bounded before it happens, not explained after.
The stop loss fires on the position's own mark on every tick. A sell never accepts a price below 85%
of the curve's own quote — size shrinks before price widens, and `minOut` is never zero (`t13`). The
EV gate prices costs at the smallest stake the sizer could return, so a trade that cannot clear its
own drag is refused (`pipeline.mjs`). Losing more always means betting less, smoothly, with no
lockout to game (`governor` daily taper, `t7`); the only hard stop is a fault, at 3x the limit.

## 5. They can stop everything, always, in one action.
`Sell all & stop` flattens every venue. A position that cannot be sold is released so the stop
completes rather than hanging on it (axiom 2). Pause freezes entries, never exits.

## 6. They can try it before funding it.
Paper mode runs the same feed, gates, sizes, plans and exits with only the router simulated. It
needs no funded wallet, cannot reach a live router, is never charged, and is labelled from the
server's own settings so the switch cannot relabel real money (`hub.start`, `t11`, `t17`).

## 7. They can see why, in the bot's own words, without noise.
Every decision, order, fill, exit and outcome is in the ledger with its reason. A halted governor
says so once per five minutes, not once per candidate (`noteHalted`, `t9`). An error on screen is
one they can act on or one that goes away on its own; a banner is never remade faster than it can be
dismissed (axiom 2).

## 8. Nothing is lost to our own failure.
Custodial keys live in Redis with no TTL (`keepForever`, `t16`); the filesystem is ephemeral and
treated as such. A crash mid-trade reconciles from the ledger and the chain, and a sale we lost the
signature for is recovered before anything is booked as a loss (`findRecentSale`, `t9`, `t13`).
Alerts go to `ALERT_WEBHOOK_URL`; the code is ready, the variable is the operator's to set.

## 9. A call is a fill, never an opinion.
Anything the site or a channel says the bot "called" is a buy the bot made with real money: the
token, the market cap it paid, the plan it declared, and the transaction. The record is written to
its own ledger with `sha256(venue|instrument|tx|ts)` before any channel sees it, so it cannot be
edited after the fact; the close is posted the same way, losses included. Paper never posts, below
the tier never posts, one call per token per hour across every user, and no row names a wallet or a
user (`Callouts`, `t21`, `t11`, `/api/callouts`).

## 10. A new venue costs trades before it can cost money.
Arc's Portal events and launch records are pinned to Argus's published documents; its hook
interface still comes from a reference contract. Everything built on that fails closed: a hook
whose getters do not answer keeps its launch out of the feed, every swap is dry-run before it is
sent, a buy inside the snipe window is refused, an RPC that answers for another chain is refused at
go-live, and an unknown tax is priced at the cap (`arc/chain.mjs`, `arc/router.mjs`, `t20`, `t23`).

## 11. On Arc the quote asset is the dollar, and nothing is priced through anything else.
Every venue before this one carried a price feed between the trade and the money: SOL or ETH, read
from an exchange, stale by a minute, gone in an outage, and behind a whole class of loss (`t12`,
`t22`: the unreadable tick). On Arc the pool is quoted in USDC, gas is USDC, the fee is USDC, the
stake, the mark, the P&L and the platform's cut are all the same unit, and `solPrice` on the venue is
the constant 1 (`arc/feed.mjs`, `QUOTE_OF`). There is no price to lose, so the only unreadable
price on Arc is a pool that will not answer, and that is reported as such (axiom 2).

## 12. An entry is bought on proof, not on a create event.
The record that prompted this closed nine live positions and lost on all nine, spread across stall,
fade-trim, stop, crash and dead-on-arrival alike. A loss under every exit rule is not an exit
problem: seconds after a create the only thing that has moved the price is the crowd arriving, so
there is nothing to be right about. The other entry is the first dip -- the token ran on someone
else's money, gave some back while the first buyers took profit, and is being bought again, inside
its first hour (`src/api/dip.mjs`, `t31`). It is measured, not eyeballed: the run, the drawdown, the
recovery, who bought the low, and whether the dev sold into it. Its exits are its own shape -- no
dead-on-arrival cut, because the crowd already came -- and it is priced by its OWN realized record,
because bucketing a new entry with the tier it shares a number with prices it by the record that was
losing (`statsFromOutcomes`, keyed on the plan). Turning the launch entry off entirely is one
setting, and the operator owns it.

## 13. A record may lower an estimate and may never raise it, in the unit the gate decides in.
The estimate for a plan key starts at the prior and moves toward the realized record with weight
n/(n+k) -- but expected value is computed in units of STAKE, while `payoff` is a ratio denominated in
one average loss, and `loss_fraction` is the converter between them. Clamping two of the three
inputs left the third as a channel through which a record could make the gate KEENER: measured
against the shipped model at $25 and tier 2, one -5% stop gave EV -0.0311 and REJECT, one -60% rug
gave +0.0886 and a full-size GO, and one -100% close on a position the bot could not sell gave
+0.1757. The bot's worst outcomes were its strongest argument for repeating them. So the clamp is
applied where the decision is made: the blended edge is walked back until it is worth no more of the
stake than the prior's is, and `t32` asserts across every bucket shape that no record of any kind
raises the decision's `ev` above the one the same candidate gets with no record at all.

Two corollaries the same axiom forces. A record that only ever gets clamped away is not the thing
speaking -- the PRIOR is -- so such a key keeps the probe that lets it go on trading; and a close the
plan did not decide is not evidence about the plan, so a user's stop, a wallet sweep, a flatten at a
mode change, an unwound leg and a position the venue says we do not hold are all kept out of the
bucket entirely (`engine.modeStats`).

## 14. A probe is a measurement being bought, and it is charged when the buy lands.
A plan key whose prior does not clear its own costs can only ever trade through the probe branch, so
whatever closes that branch decides whether the key trades again at all. Two narrower tests were
tried and both were absorbing states: "the edge is positive before costs", which every prior in the
table satisfies and which therefore approved every refusal there is, and "the edge clears the costs
at the plan's designed stop", which compares constants -- measured on priors at the hosted floor,
tier 3 is worth 0.0200 of the stake at its designed stop, the first dip 0.0280 and revival 0.0160
against a round trip near 0.042, so all three were refused identically for the life of the account
and could never earn the record that would settle it. The condition is `on_priors` and the bound is
the budget: three draws a UTC day per venue and plan key, at 0.4x, live and paper counted apart.

The one refusal a probe may not buy is a toll we have not read. An unread PONS creator tax or Arc leg
tax is priced at the maximum on purpose; the answer to that is to fetch the curve, not to spend a
round trip finding out, and `costs.assumed` is what tells the two apart. And the charge falls when
the position OPENS, not when the gate approves: a full slot table, a throttled stake under the floor
and a reverting router are ordinary conditions in continuous mode, and an approval that dies at any
of them buys no measurement (`t33`).

## What is still open
- Entry quality: 4% win rate over the last 24 live closes on Robinhood Chain, and a measured stretch
  of nine closes that lost on all nine. Acted on by axiom 12 (the first dip and the `dips` entry
  mode), which is a hypothesis with no realized record behind it yet: the dip plans start on priors
  and must earn their own statistics before the EV gate will size them up. The miss ledger
  (`engine.misses()`) records which hard rule refused each token that then ran; still not read.
- `Engine.setRegime()` is called by nothing in `src/`, so `store.state.regime` is permanently
  "RISK_ON" and the governor's `REGIME_MULT` table (DEAD 0, PVP 0.4) never fires: a bot at 4am in a
  dead market sizes exactly as it does at peak. This is the single largest continuous-mode control
  and it is currently inert. It needs either a regime source wired to it (`src/engine/regime-engine.mjs`
  exists and is not read by velocity) or the table and its branch deleted, because a safety control
  that reads as live and is not is worse than no control.
- The risk envelope is built once in `hub.start` from `settings.bankrollUsd` and deep-frozen.
  Realized profit never grows the base and sustained loss never shrinks it; only the governor's
  daily taper moves, and it resets each day.
- The priors table (`PUMPFUN_PRIORS`) was calibrated for an R-denominated EV and was never
  recalibrated after the rescale into stake units. Measured against the shipped `costs()` at the $10
  hosted floor, tier 1 clears on priors and tiers 2 and 3 do not, so most of the flow reaches the
  market only through the probe branch and its three-a-day budget. Recalibrating that table against
  realized closes is the fix; loosening the gate that reads it is not.
- A plan key still shuts on six closes that speak against its prior (`weight >= 1/3` at k = 12) and
  stays shut for the fourteen-day window. That is deliberate, and at a 4% observed win rate it will
  happen quickly. Whether fourteen days is the right release valve is unmeasured.
- Every threshold added by the entry work is a source constant with no operator setting behind it:
  `statsShrinkK` (12), `probeStakeFraction` (0.4), `probeBudget` (3), the `weight >= 1/3` floor,
  `SPIKE_MULT`, `SPIKE_MIN_SHARE` and `KIND_LIMITS`. k and the 1/3 floor between them decide when a
  key stops trading, so k is the most consequential number in the batch and it cannot be tuned from
  evidence without editing source.
- `send failed` appeared in the live failure list once; not yet root-caused.
- Exposed credentials pasted in chat during development still need rotating (xAI key, X bearer
  tokens, X consumer secret, X access token/secret).
- The Arc hook ABI (getters, `Bonded`, `TaxCollected`, the snipe-tax formula) is from the reference
  contract, not the deployed bytecode; the explorer is unreachable from the build box. First live
  Arc trades should be small and watched, and `ARC_RPC_URL` should be the operator's own endpoint.
- The narrative-wave feature and the smart-money feature are bounded weights with no realized
  outcomes behind them yet; the learner will move them once the ledger has enough closes.
- `$BNDLI` is not launched. Until the mint exists and `BNDLI_MINT` is set, every fee is charged as
  before and the site's ticker links to the X profile instead of pump.fun. The mint address goes into
  the launch banner and the env, never into a doc.
- The launch thread (`docs/TWEETS.md`) carries placeholders for every number; each must be copied
  from `/api/callouts` at posting time, and a tweet whose number cannot be filled from the record is
  dropped, not estimated. The lore (`docs/LORE.md`) is checked against this file and against the
  site copy; when either changes, the lore is re-read before it is quoted anywhere.
- The frog is in (`app/public/fren.png`); the palette in `app/src/lib/theme.js` is measured off it.
  Any new ink or state colour has to be measured against the card again, not eyeballed.
