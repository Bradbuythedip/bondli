# Fleet launcher for Robinhood Chain

**Scope: this is an operator tool for launching your own token, run by hand from a terminal. It is not
part of bondli.fun and nothing in the product uses it.** The dependency runs one way only: this folder
imports the PONS ABI and curve helpers from `src/velocity/venues/pons/chain.mjs`, and nothing under
`src/`, `app/` or `deploy/` imports anything here. The hosted trader deliberately excludes fleet
wallets and manufactured volume (see the constraint in `src/velocity/README.md`), and that line stays
where it is: the bot the site runs for users never calls this code.

The pump.fun fleet engine (`src/engine/fleet-trader.mjs`, `fleet-brains.mjs`, `launch-orchestrator.mjs`,
`volume-engine.mjs`, `GAME_THEORY.md`) ported to PONS on Robinhood Chain, with a fleet simulator that
runs the whole playbook against an in-memory PONS curve and a synthetic crowd in seconds, a testnet
rehearsal path, and the mainnet launch. One code path drives all three: the strategy never knows
whether it is talking to the simulator, the testnet launchpad, or the live PONS factory.

## Run it, from nothing

Node 20 or newer. Every step below is safe until step 4; nothing before it can spend money.

**0. Get the code.**

```bash
git clone https://github.com/Bradbuythedip/bondli.git
cd bondli
git checkout claude/youthful-carson-6imo58
npm install
```

**1. Simulate. No keys, no wallet, no configuration.** This is the whole playbook against an
in-memory PONS curve and a synthetic crowd; a twelve-minute launch plays out in about a second.

```bash
npm run fleet:sim -- --scenario organic --seed 3 --budget 0.3 --minutes 12
```

It prints every phase as it happens and then a report: what went in, what came home, curve fees, gas,
the launch fee, how the dev sold, what the crowd did, and whether every wei is accounted for. Run the
other scenarios before trusting any of it:

```bash
npm run fleet:sim -- --scenario dead --runs 5      # nobody comes: the floor, the cost of trying
npm run fleet:sim -- --scenario hostile --runs 5   # flippers and snipers only
npm run fleet:sim -- --scenario hype --runs 5      # it catches
npm run fleet:sim -- --scenario organic --runs 20  # twenty seeds, one line each, the mean
```

Change the token and the budget in `launch/robinhood/.env` (step 2) and the simulator uses them too.
`--mode ape --score 80` simulates buying someone else's launch instead of making your own.

**2. Configure.**

```bash
cp launch/robinhood/.env.example launch/robinhood/.env
$EDITOR launch/robinhood/.env
```

Set `PRIVATE_KEY` to a **fresh** wallet you use for nothing else, then `FLEET_TOKEN_NAME`,
`FLEET_TOKEN_SYMBOL`, `FLEET_LOGO`, and `FLEET_BUDGET_ETH`. Leave `FLEET_CHAIN_ID=46630` for now.

**3. Rehearse on testnet.** Fund the wallet from https://faucet.testnet.chain.robinhood.com, then:

```bash
node launch/robinhood/fleet-launch.mjs deploy-launchpad   # PONS has no testnet; this deploys the double
node launch/robinhood/fleet-launch.mjs preflight          # must print READY
node launch/robinhood/fleet-launch.mjs launch --dry-run   # simulates the launch call, sends nothing
node launch/robinhood/fleet-launch.mjs launch             # type LAUNCH when it asks
```

Watch the whole run. It is the same code and the same report you will see on mainnet.

**4. Mainnet.** Only after step 3 ran clean. In `.env` set `FLEET_CHAIN_ID=4663`, an
`FLEET_RPC_URL` you control (the public one is rate-limited), and `FLEET_I_UNDERSTAND_MAINNET=1`,
which exists so this step cannot happen by accident.

```bash
node launch/robinhood/fleet-launch.mjs preflight
node launch/robinhood/fleet-launch.mjs launch --dry-run
node launch/robinhood/fleet-launch.mjs launch            # type LAUNCH
```

**While it runs**, the terminal takes commands: `accumulate`, `hold`, `distribute`, `boost`, `auto`,
`status`, and `close` to sell everything and sweep. Ctrl-C does the same; a second Ctrl-C abandons.

**If anything goes wrong**, the fleet's keys are in `launch/robinhood/fleet-state.json`:

```bash
node launch/robinhood/fleet-launch.mjs status    # what the last run was and where it got to
node launch/robinhood/fleet-launch.mjs close     # sell every wallet and sweep the ETH home
node launch/robinhood/fleet-launch.mjs recover   # sweep the ETH only, no selling
```

Other commands: `ape --token 0x…` puts a Kelly-sized fleet into someone else's curve, and
`npm run fleet:test` runs the suite (the on-chain tests run only when a local node answers).

**5. Put it on bondli.fun.** The site reads `GET /api/launch` every 15 s and `tools/launch-push.mjs`
writes it — no redeploy for any of this. `--from-state` reads only the token address out of the
fleet's state file (that file also holds the fleet's private keys; nothing else is ever read from it,
and nothing else is ever sent), sets the venue to `pons`, and flips the banner to live, which turns
the badge in the card's top-left corner into a link straight to the PONS buy page.

```bash
export BONDLI_API=https://<your-railway-app>.up.railway.app
export ADMIN_SECRET=<the same ADMIN_SECRET Railway has>

node tools/launch-push.mjs --from-state launch/robinhood/fleet-state.json \
  --ticker FLY --update "Live on Robinhood Chain."
node tools/launch-push.mjs --show        # what the site has now, and the chain's view of it
node tools/launch-push.mjs --announce    # ready-to-post text for X and Telegram, with the buy link
node tools/launch-push.mjs --watch 720   # read the chain every 30s for 12h: pushes a milestone line
                                         # at 10k/25k/50k/100k/250k/500k/1M and when the curve graduates
```

Leave `--watch` running through the launch. It is also what keeps the banner's chart dense: the
server samples the market cap every time the chain is read, so a poll every 30 s draws a smooth line
whether or not anyone has the page open. Before the token exists, `--status soon` shows the teaser
card; `--reset` puts it back; `--status off` removes it from the site entirely.

## What was ported, and what changed on an EVM curve

| pump.fun engine | Robinhood Chain (PONS V2) |
|---|---|
| **Same-block entry**: token create + fleet buys in one Jito bundle | **Opening-window entry**: `launchToken(params, config, ETH, snipeTaxExemptions[])` declares the fleet wallets exempt from the snipe tax (99% in the launch second, decaying over 15 s; up to 32 wallets). Declared wallets buy in the first seconds at the untaxed price while every undeclared sniper's buy is mostly a donation. Nothing needs to be atomic. |
| **GameState** on PumpPortal's trade stream | The same decay-weighted opponent model (buy pressure, momentum, whale, dev-selling, dump cascade → SELL_NOW / RIDE / ACCUMULATE / HOLD, sell multiplier, hold extension, war-room override) fed by `CurveBuy` / `CurveSell` logs. The whale threshold scales with the curve's virtual reserve. |
| **Wallet brains** (seven personalities, axioms 1-7) | Unchanged logic; ETH amounts scale with each wallet's budget instead of pump.fun's absolute SOL floors; bonding progress is the curve's real-reserve progress. |
| **Launch orchestrator** (dev sells 25% into snipers in chunks → cascading buy waves → mixed candles) | Same playbook, same cool-off when 3+ real buyers appear. |
| **Continuous volume engine** (escalating bursts) + **auto-rug** (drought → atomic sell) | Same engine. The rug is one pre-approved sell per wallet sent in the same instant (an EVM has no bundles), then a sweep. |
| **Dev-sell mimicry** (the dev takes small profits after buys) | Same controller, size classes relative to the curve's reserve. |
| **Kelly-sized APE** (conviction → wallet count and split) | Same. Plus: never donate — an ape into a launch still inside its opening window waits for the tax to fall below 3%. |
| Sweep + platform skim | Same; ETH via plain transfers, allowance set at funding so the rug has nothing in the way. |
| Simulation mode (`simulator.mjs`, paper P&L of one trader) | **The fleet simulator**: the contract's curve arithmetic in BigInt wei, gas, block latency, a virtual clock (a 12-minute launch plays in under a second), a seeded crowd that arrives with attention and leaves on take-profit, stop-loss, cascades and dev dumping, and a conservation check that every wei minted is in a wallet, the curve, a fee or gas. |

The curve arithmetic (`lib/curve-model.mjs`) is a port of `PonsV2BondingCurve.buy/sell` and
`PonsV2BondingCurveMath` from ponsdotdev/ponsfamily: quote-denominated fee and creator tax on both
sides, the clamped and refunded last buy, graduation at the exhaustion of the sellable allocation,
sells refused once ready to graduate. The one approximation is the opening tax's decay shape (the
published curve source predates it; the factory says "decays exponentially to zero" across
`snipeTaxSeconds`). What the strategy depends on is exact: declared wallets pay nothing, undeclared
ones pay most of their buy inside the window.

## The simulator

```
npm run fleet:sim -- --scenario organic --seed 1 --budget 0.3 --minutes 12
npm run fleet:sim -- --scenario hype --mode ape --score 80 --runs 10
```

Scenarios: `dead` (nobody comes), `quiet`, `organic`, `hype`, `hostile` (flippers and snipers). The
report says what went in, what came home, curve fees, gas, the launch fee, how the dev sold, what the
playbook did, what the crowd did, and that every wei is accounted for. With `--runs N` it prints one
line per seed and the mean; `--json` dumps everything. While a single run plays with the log on, the
terminal takes war-room commands (`accumulate`, `hold`, `distribute`, `boost`, `auto`, `status`, `close`).

What the numbers looked like on 5 seeds per scenario, 0.3 ETH budget, 12 minutes, CREATE mode (your
run will differ): dead −2.8% (the launch fee and the round-trip curve fees), quiet −2.6%, organic −4.5%,
hype +25.6% (5 of 5 in profit), hostile −3.9%. APE mode into a token someone else launched a minute
earlier (0.2 ETH, conviction 70, four-minute hold): organic −2.9% mean, hype −12% mean with two runs
losing a quarter and a third and two in profit; a late ape into a pumping curve is a coin flip and the
fixed hold is what loses it, which is the point of seeing it here first. A dead launch costs what it
costs; the engine's job is to be out with the ETH before a crowd that does come leaves, and the
auto-rug did that in every run.

The simulator's economics default to a 3 ETH phantom reserve, a 6 ETH graduation threshold, a 1%
curve fee and a 0.001 ETH launch fee; set `FLEET_SIM_*` to the values `preflight` prints from the
live factory before trusting the sizing.

## Testnet, then mainnet

1. `cp launch/robinhood/.env.example launch/robinhood/.env`, put a fresh key in `PRIVATE_KEY`, fund
   it from https://faucet.testnet.chain.robinhood.com (chain id 46630, gas is ETH).
2. `node launch/robinhood/fleet-launch.mjs deploy-launchpad` — PONS has no testnet deployment, so this
   deploys `contracts/FleetTestLaunchpad.sol` (the subset of PONS the fleet uses, same ABI, same curve,
   same opening tax, graduation parks the reserves instead of seeding a V4 pool) and records the
   address for the chain in `fleet-state.json`.
3. `preflight` must print READY. Then `launch` (or `launch --dry-run` first). The run logs every
   phase; Ctrl-C closes every wallet and sweeps. The report at the end is the same one the simulator
   prints. `status` shows past runs; `close` and `recover` work from the saved wallet keys.
4. Mainnet: `FLEET_CHAIN_ID=4663`, an RPC key, `FLEET_I_UNDERSTAND_MAINNET=1`. The launchpad is the
   live PONS V2 factory (`0x7eD5…EC7e`) and the launch goes through its launch-and-buy router with the
   dev buy and the exemption list in one transaction. Run `preflight`: it reads the launch fee, the
   snipe tax terms, `canLaunch(wallet)` and the launch config from the factory.
5. A vanity address: mine a salt with `launch/notafruitfly/pons-launch.mjs mine` using the same
   `PRIVATE_KEY`. The fleet launcher reads that miner's `pons-state.json` on its own when it was mined
   for this wallet (or take `FLEET_SALT` / `FLEET_EXPECTED_TOKEN`), passes the salt in the launch, and
   refuses to send if the launch simulation would create any token other than the mined one. Note the
   exemption list is not part of the address, so the fleet wallets can be generated after mining.

The launch call is simulated before it is signed and its returned `(token, curve)` is what the venue
attaches to, so a mined address that no longer matches is caught before the launch fee is spent.

`fleet-state.json` holds the fleet wallets' private keys in plain text (mode 600). It is git-ignored.
Lose it while a run is open and the fleet's ETH is lost with it.

## Verification done in this repo

- `tests/robinhood/t1` the curve model against bondli's float quotes and the contract's edge cases
- `t2` the game state's signals, `t3` the brains, `t4` end-to-end simulated CREATE and APE sessions
  (sweep clean, nothing stranded, conservation, exemptions, replayable seeds, the war room)
- `t5` the ethers venue end to end on a local EVM node with chain id 46630: deploy the launchpad,
  launch with exemptions, playbook, auto-rug, sweep; the outsider pays the opening tax and the declared
  wallet does not. Skipped when no node answers at `FLEET_LOCAL_RPC` (default `http://127.0.0.1:8545`).
- `t6` the CLI
- The first on-chain run stranded 0.46 ETH in the fleet wallets: the sweep reserved gas at the cached
  `gasPrice` while ethers sent with a higher EIP-1559 max fee, so every transfer was refused. Sweeps
  now read the fee they will be sent with and reserve exactly that (`sweepAll`); `t5` asserts nothing
  beyond that reserve stays behind.
- The PONS miner (`launch/notafruitfly/pons-launch.mjs`) was validated against mock PONS contracts on
  the local node: a deployer oracle that hashes the whole `LaunchDeployment`, a factory with the real
  getters, a router that simulates the launch from the factory's values. `mine` fills every
  factory-derived field (it used to zero them, which predicts the address of a launch the factory never
  makes), `launch --dry-run` confirms the router's simulation against the mined token, and a router
  whose simulation differs is refused.

The Robinhood Chain RPCs and explorers were not reachable from the environment this was built in
(egress policy), so the testnet run itself is yours to make: steps 1–3 above, from a machine that can
reach `rpc.testnet.chain.robinhood.com`.

## Layout

```
fleet-launch.mjs          the CLI
lib/curve-model.mjs       PONS V2 curve in BigInt wei (buy, sell, clamp, graduation, opening tax)
lib/clock.mjs             virtual clock with a discrete-event scheduler, seeded rng, human jitter
lib/sim-venue.mjs         the simulator: wallets, gas, latency, the crowd, conservation
lib/chain-venue.mjs       ethers: PONS factory/router or the test launchpad, per-wallet signers, log stream
lib/game-state.mjs        opponent model and the Nash signal (ported)
lib/brains.mjs            wallet personalities (ported)
lib/orchestrator.mjs      dev sell → cascades → mixed candles (ported)
lib/volume-engine.mjs     escalating volume and the drought auto-rug (ported)
lib/dev-sell.mjs          mimicry dev sells (ported)
lib/fleet.mjs             the session: roles, Kelly, funding, CREATE/APE, sell loop, rug, sweep, report
contracts/                FleetTestLaunchpad.sol and its compiled artifact (solc 0.8.26, viaIR)
```
