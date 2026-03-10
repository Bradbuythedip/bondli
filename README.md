# Bondli

**AI-powered trading engine for pump.fun**

Bondli uses a 40+ feature machine learning model, real-time score derivatives, chart pattern recognition, and game theory to auto-trade Solana meme tokens. It watches every trade, scores every token, learns from every outcome, and exits before the rug.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      bondli.fun                           │
│                 React/Vite Frontend                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │  Landing  │ │  Radar   │ │   Bags   │ │   Intel    │  │
│  │  (Hero +  │ │  (4-tab  │ │  (Live   │ │  (Auto-Ape │  │
│  │  Features)│ │  scanner)│ │  positions│ │  + Charts) │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘  │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTP + WebSocket
┌────────────────────────┴─────────────────────────────────┐
│              server.production.mjs                         │
│  ┌───────────────┐ ┌────────────┐ ┌────────────────────┐ │
│  │  Meme Intel   │ │   Radar    │ │    Auto-Ape        │ │
│  │  (ML scorer)  │ │  (WS feed) │ │  (entry + exit)    │ │
│  └───────────────┘ └────────────┘ └────────────────────┘ │
│  ┌───────────────┐ ┌────────────┐ ┌────────────────────┐ │
│  │  Chart Pattern│ │   Bundle   │ │   Score Dynamics   │ │
│  │  Storage      │ │  Detection │ │  (velocity/accel)  │ │
│  └───────────────┘ └────────────┘ └────────────────────┘ │
│  ┌───────────────┐ ┌────────────┐ ┌────────────────────┐ │
│  │  Session Mgr  │ │  Auth/Fees │ │   Recovery/Sweep   │ │
│  └───────────────┘ └────────────┘ └────────────────────┘ │
└────────────────────────┬─────────────────────────────────┘
                         │
┌────────────────────────┴─────────────────────────────────┐
│              Engine Layer                                  │
│  ┌───────────────────────────────────────────────────┐   │
│  │           meme-intelligence.mjs                    │   │
│  │  ScoringEngine · RAGMemory · OutcomeMonitor       │   │
│  │  ScoreDynamics · 40+ features · Online learning   │   │
│  └───────────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────┐   │
│  │           fleet-trader.mjs                         │   │
│  │  GameState · Nash signals · Kelly sizing           │   │
│  │  CREATE / APE / BATCH / SOLO strategies            │   │
│  └───────────────────────────────────────────────────┘   │
│  ┌───────────────┐ ┌────────────┐ ┌────────────────────┐ │
│  │  fee-engine   │ │  config    │ │  token-creator     │ │
│  └───────────────┘ └────────────┘ └────────────────────┘ │
└──────────────────────────────────────────────────────────┘
        PumpPortal WebSocket + Solana RPC + Redis
```

---

## Meme Intelligence Engine

The core of Bondli is a real-time ML scoring engine that evaluates every token on 40+ features, learns from outcomes, and feeds into all trading decisions.

### Feature Groups

**Tipping Point Framework** (6 features)
- Law of Few: whale concentration in first 50 buys
- Stickiness: meme phrase memorability
- Context: trending topic match
- Connector/Maven/Salesman scores: influencer, alpha, viral wallet detection

**Kahneman System 1/2** (6 features)
- Cognitive ease: name simplicity + pronounceability
- Emotional valence: humor/outrage/surprise density
- Anchor bias: round-number MC proximity ($1M, $10M)
- Herd signal: buy count acceleration
- Loss aversion: sell pressure ratio
- Framing effect: description sentiment

**On-Chain Velocity** (10 features)
- Buy velocity (1m, 5m), unique buyers, Gini coefficient
- Average buy size, dev hold %, top holder concentration
- Sell ratio, mcap in SOL, volume in SOL

**Social Signals** (6 features)
- Has Twitter/Telegram/Website, name/ticker/description length, emoji presence

**Rug Detection** (8 features + 4 private signals)
- Dev sell speed, holder concentration, coordinated dump detection
- Liquidity drain velocity, wallet age/sybil score, sell wave detection
- Mcap drop rate, buyer retention
- Private: dev self-snipe, early dump, quick-flip rate, pump-dump pattern

**Chart Shape Analysis** (2 features)
- Chart health score: overall shape health (0=crash, 1=healthy growth)
- Pump-dump detection: classic pump-and-dump sparkline pattern

**Meta** (3 features)
- Hour of day, day of week, is weekend

### How It Learns

1. Every token that enters radar gets scored in real-time
2. When tokens are evicted (2-4h TTL), their outcome is labeled:
   - Graduated? Peak multiple? Rugged? Dev dumped? MC drop %?
3. Features + outcome are fed to the online learning engine
4. Weights are adjusted using gradient-like updates (learning rate 0.02)
5. Chart snapshots are stored for ALL tokens with 5+ spark points — rugs and winners alike
6. Pattern classifier categorizes charts: `healthy_pump`, `sniper_spike`, `slow_grind`, `rug`, `pump_dump`

### Score Dynamics

The raw score is a lagging indicator. Score dynamics provide leading signals:

- **Velocity**: points per second (how fast score is changing)
- **Acceleration**: change in velocity per second (momentum of momentum)
- **Trend classification**: `rocket` → `rising` → `stable` → `fading` → `declining` → `crashing`

Score dynamics drive both entry decisions (rocket trend = early ape) and exit decisions (crashing trend = immediate sell).

---

## Auto-Ape

Walk-away auto-trading engine. Set parameters once, it handles everything.

### Configuration

| Parameter | Default | Description |
|---|---|---|
| Min Score | 50-70 | Minimum ape score to trigger buy |
| SOL/Trade | 0.05-0.2 | SOL per position entry |
| Max Positions | 2-3 | Concurrent open positions |
| TP1 / Sell% | +35% / 50% | First take-profit: secure capital |
| TP2 / Sell% | +80% / 30% | Second take-profit: scale out |
| TP3 / Sell% | +150% / 50% | Runner: sell half, moonbag rest |
| SL1 / Sell% | -15% / 60% | First stop: cut exposure |
| SL2 | -30% | Full exit |
| Momentum Exit | ON | Score-based dynamic exit system |

### Entry Logic

Tokens pass through three gates:

1. **Base filters** — minimum MC, buys, unique buyers, age, sell ratio
   - Accelerating tokens (rocket/rising trend) get relaxed thresholds: $3k MC, 3 buys, 1min age
   - Normal tokens: $5k MC, 5 buys, 2min age
2. **Hard rug gate** — 8 rug signals checked individually + composite (3+ moderate signals = reject)
3. **Ape scoring** — weighted sum of activity, volume, MC sweet spot, chart shape, buy pressure, velocity, dynamics bonus, minus sell/rug penalties

The dynamics bonus is the key signal for catching early movers:
- Rocket trend: +20 points (was +12)
- Rising trend: +10 points (was +5)
- Additional velocity bonus: up to +8 for fast movers
- Additional acceleration bonus: up to +5 for building momentum
- Chart health bonus: up to +8 for healthy chart shapes

### Momentum Exit System

Three layers of exit logic when enabled:

**Layer 1 — Derivatives (leading indicator)**
- Score velocity < -0.3 pts/s → trend = "crashing" → FULL SELL (catches rugs 1-2 cycles early)
- Score decelerating hard (fading + acceleration < -0.02) → TRIM SELL (pump dying)

**Layer 2 — Absolute Score Drop (safety net)**
- Score drops 30+ pts → FULL SELL
- Score drops 20+ pts → tighten stops 50%, trim sell if 25+ pts and green
- Score drops 10+ pts → tighten stops 25%

**Layer 3 — Runner Detection (opposite)**
- Rocket trend or score rising 10+ pts above entry → widen TPs 50%
- Score improving 10+ pts → widen TPs 25%

**Data loss protection**: If score suddenly drops to near-0 but was previously stable (>20), the system detects this as radar data loss and skips the cycle instead of selling.

### Profit Protection

- **Dynamic trailing**: TP3 trail width scales with gain size (15% at 1-2x, 20% at 2-4x, 25% at 5x+)
- **Moonbag trailing**: if moonbag drops 60%+ from peak while still green (+30%+), exits to protect gains
- **Moonbag dead**: full exit at -80% (token is basically dead)

---

## Trading Modes

### CREATE — Launch Your Own Token

Deploys a new token on pump.fun with organic-looking launch. Multiple wallets buy independently from the bonding curve at staggered intervals.

- Phase 1: 3-6 wallets buy at 3-50s intervals, randomized amounts (±50% jitter)
- Phase 2: Small buy/sell wash cycles for natural chart activity
- Phase 3: Staggered sells at 45-120s intervals, GameState can override

### APE — Snipe Existing CA

Fast multi-wallet entry using Kelly Criterion sizing:

| Radar Score | Conviction | Wallets | Buy Stagger | Sell Timing |
|---|---|---|---|---|
| 80-100 | High | 5-7 | 1.5s apart | 20-125s |
| 55-79 | Medium | 3-4 | 2.5s apart | 15-50s |
| 25-54 | Low | 1-2 | 4s apart | 10-18s |

### BATCH — Multi-Token Deploy

1-20 tokens with rotating fresh keypairs per token. No on-chain link between tokens. Pro/VIP only.

### SOLO — Low Budget

Single wallet for budgets under 0.15 SOL.

---

## Game Theory Engine (GameState)

Real-time opponent modeling via PumpPortal WebSocket per active session.

### Nash Equilibrium Signals

| Signal | Trigger | Nash Logic | Effect |
|---|---|---|---|
| `SELL_NOW` | Dev selling | Trust collapse → defect first | 3x sell speed, dump 95% |
| `SELL_NOW` | Dump cascade (3+ sellers/10s) | First-mover advantage | 2.5x sell speed |
| `SELL_NOW` | Buy pressure < 25% | Market exiting | 2x sell speed |
| `RIDE` | Whale buy > 0.5 SOL | Cooperative equilibrium | 0.3x sells, +30s hold |
| `RIDE` | Buy pressure > 75% | Everyone holds → price rises | 0.5x sells, +15s hold |
| `RIDE` | Bonding > 60% + momentum | Migration premium | 0.4x sells, +45s hold |
| `ACCUMULATE` | 5+ unique buyers + momentum | Growing organic interest | Re-buy with remaining SOL |
| `HOLD` | Neutral | Default strategy | ±30% speed adjust |

---

## Radar Scanner

Real-time token discovery via PumpPortal WebSocket. Tracks up to 80 tokens with zero HTTP API dependency.

### Four Tabs

- **Momentum** — tokens with accelerating score (rocket/rising trend). Best for Auto-Ape entries.
- **New** — tokens under 5 minutes old with early buy traction
- **Hot** — volume spikes regardless of age (up to 20 min)
- **Graduating** — bonding curve > 30% heading toward Raydium graduation

### Scoring (15+ factors)

Trade activity, freshness, MC sweet spot, social signals (+5 per link, +5 valid Twitter, +5 live website), image dupe penalty (-20), bundle penalty (-8 to -30).

### Bundle Detection (8 signals)

| Signal | Score | Detection |
|---|---|---|
| 3+ buys within 2s of creation | +30 | Jito bundled launch |
| 3+ buys in same second | +25 | Same-slot transactions |
| 3+ identical SOL amounts | +20 | Coordinated bot sizing |
| Zero sells in first 10 trades | +15 | No organic profit-taking |
| Low unique wallet ratio (<40%) | +15 | Same wallets re-buying |
| Dev buying multiple times | +10 | Inflating holder count |
| 50%+ dust buys (<0.01 SOL) | +12 | Fake buyer inflation |
| One wallet buying 3+ times | +10 | Obvious bot loop |

---

## Chart Pattern Storage

Every token with 5+ spark points gets its chart stored on eviction (not just graduated tokens). This means the model learns from rugs, pumps, slow grinds, and everything in between.

### Stored Data

- Sparkline array, peak multiple, MC start/peak/end
- Buys, sells, unique buyers, age at eviction
- Rugged flag, dev dumped flag
- Pattern classification: `healthy_pump`, `sniper_spike`, `slow_grind`, `rug`, `pump_dump`

### Pattern Classification Logic

| Pattern | Criteria |
|---|---|
| `rug` | Rugged or dev dumped |
| `sniper_spike` | 8x+ multiple, peak in first 30% of lifetime |
| `healthy_pump` | 3x+ multiple, peak in last 40%, holds 40%+ of peak |
| `slow_grind` | Under 3x, 30+ spark points, graduated |
| `pump_dump` | 5x+ multiple, end < 20% of peak |

### API

```
GET /api/chart-patterns        → { total, patterns: { [type]: stats }, recentCharts }
GET /api/chart-patterns/recent → { charts: [...snapshots] }
```

---

## Tier System

| Feature | Free | Pro (10 SOL) | VIP (Whitelisted) |
|---|---|---|---|
| Radar + Auto-Ape | Yes | Yes | Yes |
| Intel scoring | Yes | Yes | Yes |
| Fleet trading (multi-wallet) | No | Yes | Yes |
| Batch deploy (1-20 tokens) | No | Yes | Yes |
| Export private keys | No | Yes | Yes |
| Custom description | No | Yes | Yes |
| Profit share on wins | 25% | 0% | 0% |
| Rate limit | 5/hr | 50/hr | 200/hr |

VIP wallets are checked against the `WHITELISTED_WALLETS` env var. VIP access works even when Redis is temporarily down — the env whitelist is always checked first.

---

## Recovery System

- `POST /api/session/sell-sweep` — sell all remaining tokens, sweep SOL to master, then to user
- `POST /api/session/force-recover` — raw SOL sweep (no token sells)
- `POST /api/close` — GameState-informed sells, sweep, profit skim
- `POST /api/emergency-recover` — emergency recovery from trading wallet

All sweeps send `balance - 5000` lamports (base fee only) to avoid `InsufficientFundsForRent`.

---

## API Reference

### Session Lifecycle

```
POST /api/session/create       → { sessionId, devWallet, ... }
POST /api/session/launch       → { tokenCA, walletKeys, devSecret, ... }
GET  /api/fleet                → { phase, wallets, trades, wsChart, gameState, ... }
POST /api/close                → { netProfit, solRecovered, ... }
POST /api/session/sell-sweep   → { totalSold, totalSwept, ... }
POST /api/session/force-recover → { totalRecovered, wallets, ... }
```

### Radar + Intel

```
GET  /api/radar                → { tabs: { momentum, hot, new, graduating }, poolSize }
GET  /api/radar/token/:ca      → { name, ticker, mcap, bp, bundleScore, socials, ... }
GET  /api/chart/:ca            → { points: [{ t, mcap, type, sol, bp, wallet }] }
GET  /api/analyze/:ca          → { score, flags }
GET  /api/chart-patterns       → { total, patterns, recentCharts }
GET  /api/movers               → { tokens: [...] }
```

### Auto-Trade

```
POST /api/auto-trade/start     → { ok, settings }
POST /api/auto-trade/stop      → { ok }
POST /api/auto-trade/update    → { ok, settings }
GET  /api/auto-trade/status    → { active, settings, positions, log }
POST /api/auto-trade/close     → { ok, positions }
```

### Trading Wallet

```
POST /api/trading-wallet/create → { ok, tradingWallet, pubkey }
POST /api/trading-wallet/export → { ok, secretKey }
GET  /api/trading-wallet/:w     → { exists, balance }
POST /api/quick-ape             → { ok, sig }
POST /api/quick-sell            → { ok, sig }
GET  /api/positions/:wallet     → { positions }
```

### Auth + User

```
GET  /api/access/check          → { tier, whitelisted }
POST /api/access/activate-free  → { ok }
POST /api/access/activate-pro   → { ok }
GET  /api/username/:wallet      → { username }
POST /api/username              → { ok }
GET  /api/referral/:wallet      → { code, referrals }
```

---

## File Structure

```
bondli/
├── app/
│   ├── index.html                  # Meta tags, OG, PWA manifest
│   └── src/
│       ├── main.jsx                # React entry
│       ├── App.jsx                 # Full frontend (~1700 lines)
│       │   ├── Landing page        # Hero, features, tiers, how-it-works
│       │   ├── Radar scanner       # 4-tab with momentum, hot, new, graduating
│       │   ├── Bags view           # Live positions + quick-sell
│       │   ├── Intel / Auto-Ape    # 2-column: config + live positions panel
│       │   ├── Deploy wizard       # CREATE/APE/BATCH session flow
│       │   └── War Room            # Live dashboard for active sessions
│       └── lib/
│           ├── a.js                # API client (minified method names)
│           ├── c.js                # Constants (API URL, RPC)
│           └── t.js                # Theme system (dark/light)
├── src/
│   ├── api/
│   │   └── server.production.mjs   # Express API + Radar + Auto-Ape
│   ├── engine/
│   │   ├── meme-intelligence.mjs   # ML scorer, RAG memory, score dynamics
│   │   ├── fleet-trader.mjs        # Trading engine + GameState
│   │   ├── fee-engine.mjs          # Tier-based profit sharing + whitelist
│   │   ├── config.mjs              # RPC, fees, platform wallet
│   │   ├── token-creator.mjs       # pump.fun SDK token creation
│   │   └── session-manager.mjs     # Redis session CRUD
│   ├── middleware/
│   │   ├── auth.mjs                # Wallet signature verification
│   │   ├── rate-limiter.mjs        # Redis-backed rate limiting
│   │   ├── security.mjs            # Headers, body limits, IP extraction
│   │   └── validate.mjs            # Request schemas
│   ├── payments/
│   │   ├── payment-verifier.mjs    # On-chain tx verification
│   │   └── payment-routes.mjs      # Pro upgrade endpoints
│   └── db/
│       ├── user-store.mjs          # Persistent user database
│       └── session-store.mjs       # Session persistence
```

---

## Environment Variables

```env
RPC_URL=https://api.mainnet-beta.solana.com
API_PORT=8080
PLATFORM_WALLET=<base58 pubkey>
DRY_RUN=false
REDIS_URL=redis://localhost:6379
SLIPPAGE_BPS=2500
PRIORITY_FEE=100000
HELIUS_SEND_TX_URL=<optional helius endpoint>
PRO_FEE_SOL=10
FREE_PROFIT_CUT=25
WHITELISTED_WALLETS=<comma-separated base58 pubkeys>
FEE_SALT=<optional salt for owner hash>
```

---

## Deployment

Hosted on Railway with Redis addon. Frontend built with Vite, served as static files.

```bash
npm install
npm run dev          # development
NODE_ENV=production node src/api/server.production.mjs  # production
```

---

## What Makes This Different

1. **ML scoring with online learning** — 40+ features, learns from every outcome, gets smarter over time. Not static rules.

2. **Score derivatives catch rugs early** — velocity and acceleration of the score are leading indicators. By the time the score drops, the derivatives already triggered the exit.

3. **Chart pattern recognition** — stores and classifies every token's price curve. Learns which shapes lead to graduation vs rugs.

4. **Acceleration-based entry** — doesn't wait for tokens to "prove themselves" at $15k MC. Catches early movers by detecting score acceleration (rocket trend) and entering with relaxed filters.

5. **Multi-wallet fleet coordination** — each wallet trades independently on-chain but is coordinated by GameState off-chain. No bundle detection risk.

6. **Conviction-driven sizing** — Kelly Criterion math, not vibes. Higher radar scores get more wallets and capital.

7. **Walk-away auto-trading** — set min score, SOL, TP/SL tiers, toggle momentum exit. It finds, buys, manages, and exits positions automatically.
