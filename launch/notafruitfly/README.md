# Not a fruit fly ($NOTAFRUITFLY) on Robinhood Chain: the launch runbook

Everything here is ready to run except two decisions that are yours: the venue and the liquidity.

## Which venue

| | Uniswap v2 (`launch.py`, ready) | PONS curve (needs one more file) |
|---|---|---|
| What buyers see | Uniswap / DexScreener | ponsfamily.com launchpad, same place as every RH launch |
| Shows in "What the bot sees" on bondli.fun | no (the bot's RH feed watches PONS curves) | yes, judged like every launch |
| Bondli users' bots can buy it | no | yes, at their own dial |
| Snipers | no protection: first block is a free-for-all | 99% buy tax decaying over 5 s, dev buy exempt |
| Liquidity | you seed ETH, LP burned forever | the curve, then a locked v4 pool at graduation |
| Vanity CA | yes, mined offline | yes, `TokenParams.salt`; miner needs the deployer source |
| What you keep | 0% (fair launch) or `LIQUIDITY_TOKEN_PCT` < 100 | the launch-and-buy dev buy |

The bot side of the site is built around PONS, so a PONS launch is the one the site can tie in fully:
the token shows in the live feed with a verdict, the bot's users can trade it, and the banner reads
the curve. The v2 launch is the one that is ready today, and the site supports it too (pool stats,
Buy on Uniswap, DexScreener chart). To build the PONS miner, paste the verified source of the launch
deployer (`0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42` on Blockscout, tab Contract): the
`predictLaunchAddresses` function and the `new …{salt: …}` lines.

## Before launch, once

1. `pip install web3 pillow`
2. `.env` in this folder (git ignores it):
   ```
   PRIVATE_KEY=0x…            # a fresh launch wallet, funded with LIQUIDITY_ETH + ~0.01 ETH for gas
   FLY_RPC_URL=https://robinhood-mainnet.g.alchemy.com/v2/<a NEW key>
   ```
   The old Alchemy key was in the script you pasted into chat and in Railway vars shown in chat. Make a new one.
3. Assets: `python3 make_assets.py fly.png` writes `assets/` (logo with transparency, dark logo, X avatar, X banner, share card). Upload the avatar and banner to the X account now, before the CA exists.
4. Decide `LIQUIDITY_ETH` in `launch.py` (0.05 ETH is about $200 of depth at $4k ETH; opening FDV equals that ETH amount when 100% of supply goes to the pool). `python3 launch.py check` prints the opening price and FDV in dollars.
5. Vanity: `VANITY_SUFFIX="f00d"` is seconds. Add `VANITY_PREFIX="70a57"` (TOAST) only if you accept ~1 hour on 8 cores; `check` prints the estimate.
6. Site: Railway must have `ADMIN_SECRET` set to something real. Push the "soon" state today:
   ```
   export BONDLI_API=https://bondli-production.up.railway.app ADMIN_SECRET=<same as Railway>
   node ../../tools/launch-push.mjs --ticker NOTAFRUITFLY --x https://x.com/notafruitfly --update "Launching on Robinhood Chain. Fair launch, LP burned."
   ```

## Launch day, in order

```
python3 launch.py check          # read-only: chain, router, balance, price, FDV, vanity estimate
python3 launch.py --dry-run      # same checks, stops before the first signature
python3 launch.py                # factory -> grind salt -> token -> pool -> LP burn -> verify. Type LAUNCH.
```
If a step fails, fix the cause and run the same command; `launch_state.json` skips what is done.

The moment the pool exists:
```
node ../../tools/launch-push.mjs --from-state launch_state.json --update "Live. LP burned."
node ../../tools/launch-push.mjs --announce      # ready-to-post text for X and Telegram
node ../../tools/launch-push.mjs --watch         # keeps running: milestone lines on the site as mcap crosses 10k/25k/50k/100k…
```
The first command reads the token and pair from the state file and flips the banner to live with the
pool's price, FDV, liquidity and LP-burned figure read from the chain every 15 s.

## Listings (do these within the first hour)

- Blockscout token page: verified by the script; add the logo through the "token info" form.
- DexScreener: the pair appears by itself; claim it and add the logo, X, site.
- Uniswap token list: not needed for the swap link; the Buy button carries the address.

## What to say, and what not to

Claims the chain proves: fixed supply, no owner, no mint, no tax, no blacklist, no pause, LP burned
to 0x…dEaD (the site shows the percentage live), verified source. Do not claim the bot favours it: the
banner says the bot does not buy it for anyone, and the code does not.
