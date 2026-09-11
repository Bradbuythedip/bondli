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

Decision: PONS. The token shows in the live feed with a verdict, the bot's users can trade it, and the
banner reads the curve. `launch.py` (Uniswap v2) stays here as the fallback and the site supports both.

## Fleet launch

A fleet of exempt wallets, the volume playbook and the auto-rug live in `../robinhood/` (README there): the
simulator first, testnet second, then `fleet-launch.mjs launch` on mainnet with a salt mined here.

## PONS path (chosen): `pons-launch.mjs`

The live deployer deploys curve then token with CREATE2 and salt `keccak256(abi.encode(launchWallet, userSalt))`.
The token's address therefore depends on the launch wallet, the salt, every launch parameter (name,
symbol, logo, description, socials, tax, buyback) and the deployer's live bytecode. The script never
guesses the bytecode: it traces one recent real launch, lifts the two CREATE2 init codes, swaps in our
parameters, and refuses to grind until its offline prediction equals the deployer's own
`predictLaunchAddresses` for a trial salt. The found salt is checked on chain again before it is saved.

```
cd launch/notafruitfly && npm i            # ethers (or run from the repo root, which has it)
echo 'PRIVATE_KEY=0x…' >> .env; echo 'PONS_RPC_URL=https://robinhood-mainnet.g.alchemy.com/v2/<NEW key>' >> .env
node pons-launch.mjs abi                   # ABIs from Blockscout into pons-abi/
node pons-launch.mjs inspect               # the launch struct as it will be filled, canLaunch(wallet), the router function
node pons-launch.mjs template              # optional: trace the latest launch -> pons-template.json (needs debug_traceTransaction, which the public RPC lacks)
node pons-launch.mjs mine                  # on chain (no template): every try is a predictLaunchAddresses call, batched. offline (template): proof against the deployer first, then grind on every core
node pons-launch.mjs launch --dry-run      # re-checks the CA today, simulates the launch-and-buy
node pons-launch.mjs launch                # type LAUNCH
node ../../tools/launch-push.mjs --venue pons --address 0x…  --update "We are live."
```

Read `inspect` carefully once: the script fills the launch struct by field name. If a field shows a
value you did not intend (an empty string, a zero where a config id belongs), set it with
`FLY_<KEY>` or edit `fillStruct`. `mine` cannot start until the offline math matches the deployer, so a
wrong field is caught before any hashing, and `launch` re-checks the address on the day.

The deployer's `predictLaunchAddresses` takes the whole `LaunchDeployment`, which carries values only
the factory knows: the fee policy (the meme hook) and its current policy snapshot, the fee escrow, the
buyback vault, and the launch config's supply, curve fee, phantom reserve and graduation threshold.
`inspect` reads them from the factory and prints them; `mine` and `launch` refuse to run while any is
unreadable, because a zero in their place predicts the address of a launch the factory never makes.
`launch` then simulates the real router call and refuses to send unless the `(token, curve)` it returns
is the mined address. Both were checked against mock PONS contracts on a local node (a deployer that
hashes the whole struct, a factory with the real getters, a router that simulates from the factory's
values, and a second router with a different policy that must be refused).

Set `LOGO` to the image URL you will upload (the fly is at https://bondli.fun/fly.png once Vercel
deploys) and the socials before mining; changing any of them afterwards changes the address.

Two ways to mine, chosen by whether pons-template.json exists (or FLY_MINE_MODE):
- **on chain** (default, nothing to get wrong): each try is one `predictLaunchAddresses` eth_call, 50
  per JSON-RPC batch, six batches in flight. A few hundred tries a second on Alchemy: four characters
  (65k tries) in minutes, five (1M) in about an hour. Alchemy compute units are the only cost.
- **offline** (needs the trace template): each try hashes the token init code locally, roughly 2,000 a
  second per core; five characters in minutes, six in an hour or two. The template must come from a
  launch whose creatorTaxBps and buybackEnabled equal ours; the script refuses otherwise.

What the launch call sends: `launchAndBuy(params, launchConfigId, pairToken=ETH, quoteIn, minTokensOut=0,
recipient, snipeTaxExemptions=[])` with `msg.value = launchFee + quoteIn`. The launch fee is read from
the factory (or set `FLY_LAUNCH_FEE_WEI`). `expectedEconomics` is pinned to `previewLaunchEconomics`
so a fee-config change between mining and launch reverts instead of landing on another address.

Baked into the address (frozen once `mine` runs): name, symbol, logo, description, the five socials
(TWITTER, TELEGRAM, DISCORD, WEBSITE, FARCASTER), creatorFeeRecipient (the launch wallet),
creatorTaxBps, buybackEnabled, pairToken, the launch config's economics, the wallet, the salt.
Not baked: the dev buy, minTokensOut, recipient, exemptions, the launch fee.

Announce the CA ahead of time once `mine` has it: nobody else can take it, and the 5-second opening
tax makes sniping pointless.

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
