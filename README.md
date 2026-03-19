# bondli

**if you know, you know.**

---

bondli is an intelligence layer for Solana meme tokens. it watches everything, scores everything, learns from everything, and never sleeps.

built because we were tired of losing money to rugs, snipers, and fake charts — so we taught a machine to see what humans can't.

---

## what it does

### intelligence & scoring

- **40+ feature ML scoring** — not vibes, not "trust me bro." behavioral economics (Kahneman), network effects (Tipping Point), on-chain forensics, chart shape analysis, social signals. weighted, learned, updated on every outcome.

- **score dynamics** — the score itself lags. the *velocity* and *acceleration* of the score are leading indicators. by the time a token's score drops, the derivatives already told you 2 cycles ago. physics applied to meme coins.

- **survivorship bias engine** — stores feature snapshots of every winner and loser. Fisher's linear discriminant analysis per feature. cosine similarity to a "survivor archetype" built from tokens that actually graduated. kill signals for dead-zone exclusion.

- **game theory engine** — real-time opponent modeling. Bayesian wallet classification: snipers, whales, bots, retail, accumulators. posterior probability updates on each trade. Nash equilibrium shift detection. dev selling? defect first. whale buying? cooperate.

- **memetic pipeline** — stateless meme scoring in two passes. quick 3-module pre-filter (<50ms), then full 7-module deep score via workers. language processing, absurdity detection, KOL/trend polling. the meme itself is a signal.

- **velocity-potential scoring** — separates what already moved from what will move. MCap headroom, liquidity/mcap ratio, holder quality, bonding curve progress. identifies the goldilocks zone: 5min to 2hr age, enough activity to be real but enough room to run.

- **meta engine** — narrative tracking across 8 categories (animals, AI, political, celebrity, culture, DeFi, food, absurdist). detects when a narrative is hot and dynamically boosts matching tokens. Signal Detection Theory optimization (d' & beta) for entries during peak metas.

### security & rug detection

- **12+ rug signals** — dev sell speed, coordinated dumps, sybil bots, wash trading, holder concentration, liquidity drain, flatline-spike patterns, pump-and-dump shapes, quick-flip detection. 3 moderate signals = hard reject before scoring even starts.

- **artwork originality scanner** — stolen images are one of the biggest rug signals. perceptual hashing catches duplicates even when resized, compressed, or cropped. exact content hash matching. entropy analysis. AI-generated image detection. stock photo signatures.

- **dev wallet profiling** — balance monitoring, launch history, rug rate calculation, serial rugger identification. $0 balance dev? penalty. dev who's launched 12 tokens and rugged 10? hard reject.

- **chart pattern recognition** — stores the price curve of every token it sees (not just winners). classifies into trajectory patterns (pump, consolidation, grind, crash). learns which shapes graduate vs rug.

### smart money & social

- **smart money tracker** — identifies consistently profitable wallets across thousands of trades. leaderboard ranking by win rate, avg return, consistency. polls top wallets for new buys via RPC. emits signals before radar picks up the token.

- **X/Twitter social intel** — profile verification, account age, follower/following ratio (bot detection), recent tweet engagement scoring, sentiment analysis. fake social = rug signal.

- **wallet age cache** — on-chain wallet age tracking. aged wallets buying = real users. fresh wallets clustered = likely sybils.

### trading

- **auto-ape** — walk-away trading. set your parameters, it finds tokens, enters, manages positions, takes profits, cuts losses, and exits on momentum collapse. 3-layer exit system: derivatives first, absolute thresholds second, trailing stops third.

- **quick-ape** — one-click sniping with configurable slippage, priority fees, and Jito tips. get in fast when a signal hits.

- **position management** — live P&L tracking, dual-axis analytics (score + price overlaid), TP/SL zone visualization, batch sell-all, emergency recovery.

- **simulation mode** — dry-run auto-trading with real signals and real settings. validate your strategy before risking SOL.

### deployment

- **token deploy wizard** — create and launch tokens directly from the dashboard. configure name, ticker, image, description, socials. pre-built presets (Quick, Scout, Standard, Swarm) or full custom configuration.

- **fleet trading** — multi-wallet coordinated launches with independent wallet personalities. see [axiomatic design](#axiomatic-design) below.

---

## axiomatic design

the fleet trading system is built on 7 non-negotiable axioms. these aren't suggestions — they're hard constraints that every line of trading logic must satisfy.

```
AXIOM 1  Every wallet is an independent actor.
         No coordinated on-chain footprint. Each wallet has its own
         personality, risk tolerance, timing, and decision function.
         If a human can't tell whether wallet #3 is ours or a random
         degen, we've succeeded.

AXIOM 2  Volume is oxygen — but only when we're alone.
         externalBuyers = 0  →  volume HIGH (we are the market)
         externalBuyers = 1  →  volume MEDIUM (someone found us)
         externalBuyers ≥ 2  →  volume OFF (they ARE the market)
         externalBuyers ≥ 3  →  START SELLING (exit into their demand)

AXIOM 3  The bonding curve is the only truth.
         pump.fun bonding curve has a fixed graduation point (~$69K MC).
         Every action should push toward graduation or profit before
         the dump. If we can't bond it, exit before it dies.

AXIOM 4  Dev buy is the foundation — dev sell is profit.
         Dev buy creates the initial position and first candle.
         Dev never sells first. Dev sells LAST, after snipers and
         fleet have distributed. Dev hold creates confidence.

AXIOM 5  Sell into demand, never into vacuum.
         Only sell when external buy pressure exists. Selling into
         nothing crashes the chart and kills the token.

AXIOM 6  Information asymmetry is our edge.
         External traders don't know which wallets are ours.
         This is a feature, not a bug.

AXIOM 7  Time pressure creates urgency.
         Tokens die without movement in 10 minutes. Volume must
         peak in a 3-5 minute window. After that, momentum either
         carries or it doesn't.
```

each wallet runs its own **brain** — one of 5 personality archetypes:

| brain | style | sells when |
|---|---|---|
| `degen_aper` | aggressive, fast entry | momentum turns negative |
| `accumulator` | patient, DCA in | profit target hit (2-3x) |
| `whale_bluffer` | large single buys | time-based exit (60-120s) |
| `volume_painter` | micro-burst trades | external demand appears |
| `momentum_rider` | reactive, follows flow | chart shape deteriorates |

brains have independent traits: aggression, patience, greed, fear factor, conviction. no two wallets behave the same way on-chain.

---

## the stack

```
frontend    React/Vite — radar, wallet, intel dashboard, deploy wizard
backend     Node.js/Express — WebSocket feeds, scoring pipeline, auto-trader
chain       Solana mainnet — Helius RPC, PumpPortal Lightning, Jito bundles
memory      Redis — sessions, learned weights, chart patterns, artwork hashes
intel       Custom ML — online learning, RAG memory, 100+ feature extractors
social      X/Twitter API — profile validation, engagement scoring, sentiment
```

---

## philosophy

most trading tools show you data. bondli makes decisions.

the core insight is borrowed from physics: **position is a lagging indicator. velocity and acceleration are leading indicators.** applied to token scores, this means we can detect rug pulls and runners *before* the price moves — by watching how fast the score is changing and whether that change is accelerating or decelerating.

the scoring draws from three frameworks:

- **Kahneman's System 1/2** — how do humans actually decide what to buy? cognitive ease, emotional valence, herd signals, anchoring bias, loss aversion. model the psychology, predict the crowd.

- **Gladwell's Tipping Point** — what makes a token tip from obscurity to virality? connectors (influencers), mavens (alpha wallets), salesmen (viral tweets). the law of the few. stickiness. context.

- **Game Theory** — every trade is a move in a game with imperfect information. classify opponents (Bayesian posteriors), detect equilibrium shifts, exploit information asymmetry. cooperate when the game is positive-sum, defect when it's not.

combine these with hard on-chain data (buy velocity, holder distribution, dev behavior, chart shape) and you get something that understands *both* the math and the psychology of why tokens pump.

---

## what makes it different

1. **it learns** — not static rules. online ML with gradient updates on every outcome. the model gets better at detecting rugs because it's seen thousands.

2. **derivatives, not thresholds** — most systems exit when score < X. bondli exits when d(score)/dt is collapsing. 1-2 cycles earlier. that's the difference between profit and bag-holding.

3. **survivorship analysis** — knows what a winner looks like at the feature level. Fisher discriminant + cosine similarity to the survivor archetype. tokens that don't match the pattern get filtered before you ever see them.

4. **artwork forensics** — nobody else checks if the token image is stolen. perceptual hashing, entropy analysis, AI-generation detection, exact duplicate matching. stolen art = rug.

5. **opponent modeling** — Bayesian classification of every wallet trading a token. knows if the buying is from real users or coordinated bots. adjusts strategy in real-time.

6. **axiomatic fleet design** — 7 hard constraints ensure every wallet acts independently. no coordination fingerprint. 5 personality archetypes with unique traits. sells into demand, not vacuum.

7. **it never sleeps** — 24/7 WebSocket monitoring. auto-ape, auto-exit, auto-learn. set it and forget it.

---

## access tiers

| tier | what you get |
|---|---|
| **free** | radar, scoring, rug detection, chart patterns, quick-ape (1 wallet) |
| **pro** | auto-ape, smart money signals, artwork forensics, survivor analysis, simulation mode |
| **vip** | fleet trading, deploy wizard, dev wallet profiling, referral dashboard, priority support |

---

## status

live on Solana mainnet. learning every day.

**$BONDLI** — [pump.fun](https://pump.fun)

---

*"if you want to make enemies, try to change something."*

---

MIT License
