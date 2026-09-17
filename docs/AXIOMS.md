# What the customer is owed

Someone hands this bot money and walks away. Everything below follows from that one fact. Each
axiom names the rule, what breaks it, and where in the code it is held — so a change that would
violate one has to argue with this file first.

## 1. Money leaves only by a trade they asked for or a fee they were told about.
Nothing else. No route may move funds without the owner's signature (`requireOwner` on all 13 money
routes, held by `tests/api/t15`). The fee is one rate, stated on the site, taken only from realized
profit, and zero for anyone holding `$FREN` (`hub.settleFee`, `t14`). A fee whose transfer fails is
recorded as owed and collected later — never silently dropped (`hub.collectOwed`, `t11`).

## 2. The bot never holds what it cannot manage.
A position with no readable price has no stop loss behind it, so it is sold on that fact alone after
45s (`blind-exit`, `t5`). A held token always ticks, readable or not (`t12`). A sell the venue will
never accept — graduated, or refused five times running the same way — releases the position rather
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

## What is still open
- Entry quality on Robinhood Chain: 4% win rate over the last 24 live closes. The miss ledger
  (`engine.misses()`) records which hard rule refused each token that then ran; that is the
  instrument. Not yet acted on.
- `send failed` appeared in the live failure list once; not yet root-caused.
- Exposed credentials pasted in chat during development still need rotating (xAI key, X bearer
  tokens, X consumer secret, X access token/secret).
