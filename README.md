# Bondli

**AI-powered game theory trading engine for pump.fun**

Bondli uses real-time opponent modeling and Nash equilibrium logic to coordinate multi-wallet fleet trading on Solana's pump.fun bonding curves. It watches every trade on your token, detects whales, dumps, snipers, and bundled launches — then automatically adapts your fleet's buy/sell timing to maximize profit probability.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    bondli.fun                        │
│              React/Vite Frontend                     │
│   ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│   │  Wizard   │ │  Radar   │ │  Live Dashboard  │   │
│   │  (Create/ │ │  (3-tab  │ │  (Chart, Fleet,  │   │
│   │   Ape)    │ │  scanner)│ │  GameState, Keys)│   │
│   └──────────┘ └──────────┘ └──────────────────┘   │
└────────────────────┬────────────────────────────────┘
                     │ HTTP + WebSocket
┌────────────────────┴────────────────────────────────┐
│            server.production.mjs (2300 lines)        │
│  ┌─────────┐ ┌────────┐ ┌────────┐ ┌────────────┐  │
│  │ Session  │ │ Radar  │ │ Bundle │ │   Analyze   │  │
│  │ Manager  │ │ Engine │ │ Detect │ │  (6-factor) │  │
│  └─────────┘ └────────┘ └────────┘ └────────────┘  │
│  ┌─────────┐ ┌────────┐ ┌────────┐ ┌────────────┐  │
│  │  Auth   │ │  Fees  │ │  Batch │ │  Recovery   │  │
│  │ (Wallet)│ │ (Tier) │ │ Deploy │ │  (Sweep)    │  │
│  └─────────┘ └────────┘ └────────┘ └────────────┘  │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────┐
│            fleet-trader.mjs (970 lines)              │
│  ┌───────────────────────────────────────────────┐  │
│  │              GameState (WS)                    │  │
│  │  Opponent modeling · Nash signals · Bayesian   │  │
│  │  HOLD / RIDE / SELL_NOW / ACCUMULATE           │  │
│  └───────────────────────────────────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │
│  │  CREATE   │ │   APE    │ │  Volume Engine   │    │
│  │  Strategy │ │ Strategy │ │  (Wash cycles)   │    │
│  └──────────┘ └──────────┘ └──────────────────┘    │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │
│  │  Kelly   │ │ Reactive │ │  Sweep / Skim    │    │
│  │  Sizing  │ │ Sell Loop│ │  (Profit share)  │    │
│  └──────────┘ └──────────┘ └──────────────────┘    │
└────────────────────┬────────────────────────────────┘
                     │
        PumpPortal WebSocket + Solana RPC
```

---

## Trading Modes

### CREATE — Launch Your Own Token

Deploys a new token on pump.fun with an organic-looking launch. Multiple wallets buy independently from the bonding curve at staggered intervals, making it look like real users discovering the token.

**Phase 1 — Staggered Buys**
- 3-6 wallets buy at 3-50 second intervals
- Randomized amounts (±50% jitter)
- Each wallet buys independently from the bonding curve (no SPL transfers)

**Phase 2 — Volume Generation**
- Small buy/sell wash cycles between wallets
- Creates natural-looking chart activity with green and red candles

**Phase 3 — Staggered Sells**
- Wallets exit at 45-120 second intervals
- GameState can override: delay sells if momentum is positive, dump if cascade detected

### APE — Snipe Existing CA

Fast multi-wallet entry on an existing token. Wallet count is conviction-driven using Kelly Criterion:

| Radar Score | Conviction | Wallets | Buy Stagger | Sell Timing |
|---|---|---|---|---|
| 80-100 | High | 5-7 | 1.5s apart | 20-125s (hold for pump) |
| 55-79 | Medium | 3-4 | 2.5s apart | 15-50s (moderate hold) |
| 25-54 | Low | 1-2 | 4s apart | 10-18s (quick scout + exit) |

Kelly sizing: high conviction → even distribution across wallets. Low conviction → 40% on scout wallet, 60% split across rest.

**Phase 1 — Rapid Snipe**: all wallets buy within 2-10 seconds
**Phase 2 — Hold + Volume**: small sells/rebuys to keep chart active, GameState monitors for exit signals
**Phase 3 — Exit**: staggered sells, 3-10s apart

### BATCH — Multi-Token Deploy

Deploys 1-20 tokens with rotating fresh keypairs per token. Master wallet funds each fresh creator with 0.05 SOL, fresh creator deploys. No on-chain link between tokens except the initial funding transaction. Pro/VIP only.

### SOLO — Low Budget

For budgets under 0.15 SOL. Single wallet (master keypair) trades directly. Dev holds tokens from creation buy, sells in 3 rounds over ~45 seconds.

---

## Game Theory Engine (GameState)

Each active session opens a dedicated PumpPortal WebSocket connection that monitors every buy and sell on the token in real-time. The GameState class maintains:

- **Opponent profiles**: per-wallet buy/sell counts, total SOL, average size, first/last seen
- **Buy pressure**: ratio of buys to total trades in rolling 30-second window
- **Momentum**: net SOL flow (buys minus sells) in last 30 seconds
- **Whale detection**: any single buy > 0.5 SOL in last 15 seconds
- **Dev sell detection**: creator wallet selling (trust collapse signal)
- **Dump cascade**: 3+ unique wallets selling within 10 seconds
- **Volume rate**: SOL per minute (rolling 60s)
- **Unique buyers**: distinct buy wallets in last 2 minutes
- **Bonding progress**: real-time bonding curve percentage

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

The sell loop checks GameState before every round:
- `SELL_NOW` → dumps 95% immediately and exits
- `RIDE` → delays the sell, skips the round if signal persists
- `ACCUMULATE` → buys more instead of selling (round 1 only)
- `HOLD` → normal sell with inter-round delay adjusted by `sellMultiplier`

---

## Radar Scanner

Real-time token discovery via PumpPortal WebSocket. Tracks up to 80 tokens simultaneously with zero HTTP API dependency (no Cloudflare blocking).

### Three Tabs

**🆕 New** — tokens under 5 minutes old with early buy traction. Optimized for catching tokens in the first 60 seconds. Ultra-fresh (<1 min) gets +20 bonus.

**🔥 Hot** — volume spikes regardless of age (up to 20 min). Scores on SOL volume, trade velocity, buy pressure, and MCap sweet spot ($2K-$30K). Best tab for aping.

**🎓 Graduating** — tokens with bonding curve > 30% heading toward Raydium graduation (~$67K MCap). Scores on bonding %, volume confirmation, participant count. Shows bonding percentage prominently.

### Scoring Factors

Each token is scored independently for all three tabs (0-100). The score combines:

- Trade activity (buys, volume, buy pressure)
- Freshness / velocity
- MCap sweet spot
- Social signals (+5 per social link, +5 valid Twitter, +5 live website)
- Image dupe penalty (-20 for reused images)
- Bundle penalty (-8 to -30 for coordinated buy patterns)

### Social Intelligence

Extracted from IPFS metadata (zero API cost):
- Twitter: URL validation, handle extraction
- Website: URL validation, HEAD reachability check
- Telegram: presence detection
- Tokens with all three socials get +25 score boost

### Bundle Detection

Analyzes the first 30 trades of every token for 8 coordinated buy signals:

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

Bundle score ≥ 40 shows orange ⚠BUNDLED warning. Score ≥ 60 gets -30 radar penalty.

### Image Dupe Detection

Normalizes and caches every token image URL. When a new token reuses the same image as a previous token, it's flagged with a reference to the original. Catches copy-paste scam tokens.

---

## Custom Charting

WS-powered real-time charts built from PumpPortal trade data. No external chart dependencies.

- **Price line** with gradient fill (green = up, red = down)
- **Buy/sell markers**: green dots for buys, red for sells, dot size scales with trade amount
- **MCap + % change** header
- **Bonding progress bar** at bottom
- **GameState signal badge** (HOLD/RIDE/SELL_NOW/ACCUMULATE with buy pressure %)
- **Three modes**: ❤️ Live (WS canvas), DEX (DexScreener embed), PF (pump.fun embed)
- Auto-switches to DexScreener after 45s if WS data is sparse

Charts appear in:
- Live dashboard (launched tokens)
- Radar detail panel (click any token to see chart before aping)

Chart data endpoint: `GET /api/chart/:ca` returns up to 200 price points with buy/sell type, SOL amount, wallet, and bonding %.

---

## Tier System

| Feature | Free | Pro (10 SOL) | VIP (Whitelisted) |
|---|---|---|---|
| Launch tokens | ✓ | ✓ | ✓ |
| Ape existing CA | ✓ | ✓ | ✓ |
| Radar scanner | ✓ | ✓ | ✓ |
| Game theory engine | ✓ | ✓ | ✓ |
| Fleet wallet keys visible | ✗ | ✓ | ✓ |
| Batch deploy (1-20 tokens) | ✗ | ✓ | ✓ |
| Description branding | "bondli.fun deployed" enforced | Custom | Custom |
| Profit share on close | 25% of net profit | 0% | 0% |
| Rate limit | 5 launches/hr | 50/hr | 200/hr |

Profit share is enforced server-side via `skimSweep` on session close. Only applies to net profit — if you lose money, fee is $0.

---

## Recovery System

### Sweep Endpoints

All sweep operations send `balance - 5000` lamports (base fee only, no priority fee). Account goes to exactly 0 after fee deduction — avoids Solana's `InsufficientFundsForRent` error.

- `POST /api/session/sell-sweep` — sells all remaining tokens, sweeps SOL to master, then master to user
- `POST /api/session/force-recover` — raw SOL sweep from all fleet wallets to user (no token sells)
- `POST /api/close` — normal close: GameState-informed sells, sweep, profit skim

### Fleet Wallet Keys

Pro/VIP users see private keys directly on each wallet card in the live dashboard:
- Truncated preview with 🔑 Key copy button per wallet
- 🔑 Copy All Keys button in Fleet Wallets header
- Keys are available immediately after launch (returned in launch response)
- Dev/master wallet key from `devSecret`, fleet keys from `walletKeys`

### Session Persistence

- Fleet wallet keys stored in Redis with 24h TTL (`fleetkeys:<sessionId>`)
- Sessions persist for 30 days
- VIP key export endpoint: `GET /api/session/:id/keys`

---

## API Reference

### Session Lifecycle

```
POST /api/session/create    → { sessionId, devWallet, ... }
POST /api/session/launch    → { tokenCA, walletKeys, devSecret, ... }
GET  /api/fleet             → { phase, wallets, trades, wsChart, gameState, ... }
POST /api/close             → { netProfit, solRecovered, ... }
POST /api/session/sell-sweep → { totalSold, totalSwept, ... }
POST /api/session/force-recover → { totalRecovered, wallets, ... }
```

### Radar

```
GET  /api/radar           → { tabs: { new, hot, graduating }, wsAlive, poolSize }
GET  /api/radar/token/:ca → { name, ticker, mcap, bp, bundleScore, bundleFlags, socials, ... }
GET  /api/chart/:ca       → { points: [{ t, mcap, type, sol, bp, wallet }], ... }
POST /api/radar/toggle    → { enabled }
```

### Analysis

```
GET  /api/analyze?ca=...  → { score, verdict, factors, ... }
GET  /api/price/:ca       → { mcap, bp, price, complete }
```

### Batch Deploy

```
POST /api/batch-deploy    → { results: [{ ca, creator, creatorSecret, ... }], rotatedKeys }
```

Each token gets a fresh creator keypair funded from master. Response includes creator pubkey + secret for each deploy.

### User / Auth

```
POST /api/access/activate-free  → { ok }
POST /api/access/activate-pro   → { ok } (with tx verification)
GET  /api/access/check          → { tier, whitelisted }
GET  /api/sessions?wallet=...   → { sessions, count }
GET  /api/fees?tier=...         → { profitCut, label }
GET  /api/referral/:wallet      → { code, referrals, ... }
```

---

## File Structure

```
bondli/
├── index.html                    # Favicon (red pill + matrix), meta tags, OG
├── src/
│   ├── main.jsx                  # React entry
│   ├── App.jsx                   # Full frontend (1620 lines)
│   │   ├── BondliLogo            # Red pill SVG (unique gradient IDs)
│   │   ├── LandingPage           # Phantom connect
│   │   ├── TierGate              # Free/Pro selection
│   │   ├── PriceChart            # WS-powered canvas chart
│   │   ├── RadarFeed             # 3-tab scanner (New/Hot/Graduating)
│   │   ├── ReferralPanel         # Referral codes
│   │   ├── LaunchFlow            # Session create → fund → launch
│   │   └── App                   # Main app shell + live dashboard
│   └── api/
│       └── server.production.mjs # Express API (2295 lines)
│           ├── Radar engine      # PumpPortal WS + multi-tab scoring
│           ├── Bundle detection  # 8-signal analysis on first 30 trades
│           ├── Social intel      # Twitter/website/telegram + image dupe
│           ├── CA analysis       # 6-factor scoring (MCap, momentum, etc)
│           ├── Session manager   # Redis-backed session lifecycle
│           ├── Auth middleware    # Wallet signature + tier enforcement
│           ├── Rate limiting     # Per-tier rate limits
│           └── Recovery          # Sweep endpoints (rent-safe)
├── src/engine/
│   ├── fleet-trader.mjs          # Trading engine (971 lines)
│   │   ├── GameState             # Real-time opponent modeling via WS
│   │   ├── CREATE strategy       # Organic staggered buys → volume → sells
│   │   ├── APE strategy          # Conviction-driven snipe → hold → exit
│   │   ├── Volume engine         # Wash trading between wallets
│   │   ├── Reactive sell loop    # GameState-driven sell timing
│   │   └── Sweep / skim          # SOL recovery + profit share
│   ├── fee-engine.mjs            # Tier-based profit sharing
│   ├── config.mjs                # RPC, fees, platform wallet
│   ├── token-creator.mjs         # pump.fun SDK token creation
│   └── session-manager.mjs       # Redis session CRUD
├── src/middleware/
│   ├── auth.mjs                  # Wallet signature verification
│   ├── rate-limiter.mjs          # Redis-backed rate limiting
│   ├── security.mjs              # Headers, body limits, IP extraction
│   └── validate.mjs              # Request schemas
├── src/payments/
│   ├── payment-verifier.mjs      # On-chain tx verification
│   └── payment-routes.mjs        # Pro upgrade endpoints
└── src/db/
    ├── user-store.mjs            # Persistent user database
    └── session-store.mjs         # Session persistence
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
```

---

## Deployment

Hosted on Railway with Redis addon. Frontend built with Vite, served as static files.

```bash
# Install
npm install

# Dev
npm run dev

# Production (Railway)
NODE_ENV=production node src/api/server.production.mjs
```

Railway auto-deploys on push to `main`. The `npm error signal SIGTERM` in deploy logs is normal — it's the old process being killed during deploy, not a crash.

---

## Security Notes

- Fleet wallet private keys are stored in Redis with 24h TTL and returned to Pro/VIP users
- All session mutations require wallet header verification
- Free tier descriptions enforced server-side (can't bypass by modifying frontend)
- Rate limiting per tier prevents abuse
- Profit skim is enforced atomically on all exit paths (close, sell-sweep, recover)
- Batch deploy rotates creator keypairs — no on-chain link between tokens

---

## What Makes This Different

Most pump.fun bots are simple scripts: buy → wait → sell. Bondli is different because:

1. **It watches what other traders are doing in real-time** and adapts. If a whale buys in, the fleet delays selling to ride momentum. If the dev starts dumping, the fleet exits before the cascade.

2. **Multiple wallets act as one brain.** Each wallet trades independently on-chain (no bundle detection risk) but is coordinated by the GameState engine off-chain.

3. **Conviction-driven sizing.** The radar scores every token on 15+ factors. Higher scores get more wallets and more capital. Lower scores get scout positions with fast exit. Kelly Criterion math, not vibes.

4. **Bundle detection protects ape entries.** Before you ape, the radar has already analyzed the first 30 trades for 8 different coordination signals. Bundled tokens get flagged and penalized.

5. **Every trade generates intelligence.** Social links, image reuse, dev behavior, buy pressure, momentum — all computed in real-time and fed into scoring.
