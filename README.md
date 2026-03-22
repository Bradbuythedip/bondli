<p align="center">
  <img src="hero.png" alt="bondli" width="100%" />
</p>

# bondli

**ML-powered Solana trading terminal.** Scores every token. Exits before the rug.

[![Live](https://img.shields.io/badge/Live-bondli.fun-00ff88?style=flat-square)](https://bondli.fun)
[![Twitter](https://img.shields.io/badge/Twitter-@Bondlifun-1DA1F2?style=flat-square)](https://x.com/Bondlifun)

---

## What is Bondli?

Bondli is an AI-powered trading terminal for Solana memecoins. It watches every token launch in real-time, scores them with 40+ ML features, detects rugs before they happen, and trades autonomously.

**The edge:** Score derivatives (velocity + acceleration) detect deterioration 2 cycles before price drops. Three exit layers fire automatically — by the time you'd notice the chart, Bondli already sold.

All features are unlocked for every user. No tiers. No paywalls.

**Direct links:** [bondli.fun/radar](https://bondli.fun/radar) · [bondli.fun/gpu](https://bondli.fun/gpu) · [bondli.fun/intel](https://bondli.fun/intel) · [bondli.fun/wallet](https://bondli.fun/wallet) · [bondli.fun/deploy](https://bondli.fun/deploy)

---

## Features

### ML Token Scoring
- **40+ features** extracted from every launch — holder distribution, chart patterns, wallet age, buy/sell pressure, social signals
- Model learns from every trade outcome and updates weights live
- Score velocity + acceleration are leading indicators (detect problems before price drops)
- Survivorship bias engine: Fisher's discriminant analysis + cosine similarity to "survivor archetype"

### Rug Detection
- **12+ signals** — dev dumps, sybil wallets, wash trading, staircase charts, liquidity drains, holder concentration
- 3+ moderate signals = auto-reject
- Artwork scanner with perceptual hashing catches duplicates even when resized/compressed
- Dev wallet profiling: balance monitoring, launch history, serial rugger identification

### Auto-Ape Engine
- Walk-away autonomous trading — finds tokens, enters, manages positions, exits
- 3-layer exit system: score derivatives first, absolute thresholds second, trailing stops third
- Configurable rules: min score, position size, take-profit levels, stop-loss
- Live simulation mode to test strategies before going live

### Smart Money Tracking
- Identifies consistently profitable wallets on Solana
- Signals before radar picks up the token
- Copy-trade the best performers

### Token Radar
- Real-time feed of every token launch on pump.fun and Bags.fm
- Tabs: **Momentum** (sustained buying), **Hot** (buy activity), **New** (fresh launches)
- Source filter: filter by BAGS or PUMP tokens within any tab
- Entry signals: STRONG / READY / EARLY indicators
- Buy pressure bars, sparkline charts, memetic DNA scores

### Token Deployment
- Launch tokens on pump.fun or Bags.fm (Meteora DBC)
- Bags.fm: 1% perpetual creator royalty on all volume, top 100 holders get dividends
- Fleet trading with multi-wallet coordination

### GPU Earnings
- Plug in your NVIDIA GPU, earn $NOS tokens via Nosana decentralized compute
- One-command setup: `curl -s https://bondli.fun/gpu-agent.sh | bash -s -- --wallet <WALLET>`
- Remote node control from dashboard: restart, stop, view logs, GPU details
- Power consumption, fan speed, clock rates monitored in real-time
- 1 user = 1 GPU = 1 node = 1 keypair

### AI Chat Support
- Built-in assistant powered by xAI's Grok, trained on Bondli + Nosana knowledge
- Helps with node setup, earnings questions, troubleshooting

---

## GPU Earnings — Deep Dive

Bondli is an aggregation layer for the [Nosana](https://nosana.com) decentralized GPU compute network. Each user runs one Nosana node on their machine.

```
┌──────────────────────────────────────────────────────┐
│                BONDLI GPU FLEET                       │
│                                                       │
│  User A  → nodeKey_A → RTX 4070  → earns NOS        │
│  User B  → nodeKey_B → RTX 5070Ti→ earns NOS        │
│  User C  → nodeKey_C → RTX 3090  → earns NOS        │
│                                                       │
│  Each user = 1 node = 1 GPU = 1 keypair              │
└──────────────────────────────────────────────────────┘
```

### How It Works

1. User runs the one-liner on their GPU machine
2. Agent registers with Bondli, gets a generated Solana keypair
3. Keypair written to `~/.nosana/nosana_key.json`, Nosana node starts
4. GPU accepts AI inference jobs from the Nosana marketplace
5. $NOS earnings flow to the node wallet
6. Bondli sweeps hourly: user gets 90-95%, remainder to treasury
7. All transfers on-chain, verifiable on Solana explorer

### Remote Node Control

Commands are relayed via the heartbeat mechanism (queued → picked up within ~60s):

- **Restart Node** — restarts the Docker container
- **Stop Node** — stops the node (can restart from dashboard)
- **View Logs** — fetches last 50 lines of Docker logs
- **GPU Details** — power draw, fan speed, clock rates, driver version
- **Set Power Limit** — adjust GPU power limit remotely

### Supported GPUs & Rates

| GPU | ~NOS/sec | VRAM |
|-----|----------|------|
| RTX 3060 | 0.000043 | 12 GB |
| RTX 4070 | 0.000035 | 12 GB |
| RTX 3090 | 0.00009 | 24 GB |
| RTX 4090 | 0.000097 | 24 GB |
| A100 | 0.000115 | 80 GB |

Also supports RTX 5070, 5080, 5090, A4000–A6500, H100 — mapped to nearest market tier.

### GPU API Endpoints

```
POST /api/gpu/register         — generate keypair, register node
POST /api/gpu/deregister       — sweep balance, remove node
GET  /api/gpu/dashboard        — node status, earnings, extended GPU metrics
POST /api/gpu/heartbeat        — agent reports metrics every 60s, receives commands
POST /api/gpu/job-completed    — agent reports completed Nosana job
GET  /api/gpu/fleet            — aggregate view of all Bondli GPU nodes
POST /api/gpu/command          — queue command for node (stop, restart, logs, etc.)
GET  /api/gpu/command-status   — check result of a sent command
GET  /api/gpu/node-logs        — get recent Docker logs from node
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        BONDLI STACK                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  FRONTEND        React/Vite SPA — 5 tabs (URL-routed)       │
│                  Radar · Wallet · Deploy · Intel · GPU       │
│                                                              │
│  BACKEND         Node.js/Express + WebSocket                 │
│                  Real-time scoring, trading, GPU management   │
│                                                              │
│  DATA            Redis — sessions, ML weights, node registry │
│                                                              │
│  CHAIN           Solana mainnet — Alchemy RPC, PumpPortal,   │
│                  Jito bundles, Jupiter swaps                  │
│                                                              │
│  GPU             Nosana Network — @nosana/kit v2.0 SDK       │
│                  Decentralized AI compute                     │
│                                                              │
│  ML              Custom LoRA — online learning, 115 features  │
│                  <5ms inference, trains on outcomes           │
│                                                              │
│  SOCIAL          X/Twitter API — profile, engagement, KOL    │
│                                                              │
│  AI CHAT         xAI Grok — support assistant                │
└─────────────────────────────────────────────────────────────┘
```

### The Brain

```
                    ┌──────────────────────────────────────────────┐
                    │                 BONDLI BRAIN                 │
                    ├──────────────────────────────────────────────┤
                    │                                              │
  INPUT             │  PumpPortal ──► Scanner ──► Scorer   Smart$  │
                    │       ↓            ↓          ↓        ↓     │
                    │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
  PROCESS           │  Social ─► Artwork ─► CORTEX ─► GameTh ─► Rug│
                    │                        ◉ hub                 │
                    │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
  OUTPUT            │     APE       WATCH      SKIP       RUG      │
                    │      ↓          ↓          ↓         ↓       │
                    │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
  LEARN             │  Learner   GradWatch  Survivor   Patterns    │
                    │      ↑          ↑          ↑         ↑       │
                    │      └──────────┴──── ◉ ───┴─────────┘       │
                    │            feedback → retrain model           │
                    └──────────────────────────────────────────────┘
```

---

## Repo Structure

```
bondli/
├── app/                              # Frontend (React/Vite)
│   ├── src/
│   │   ├── App.jsx                   # Main SPA — all 5 tabs
│   │   ├── IntelDashboard.jsx        # Intel analytics panel
│   │   ├── MemeticRadar.jsx          # Token radar view
│   │   └── lib/
│   │       ├── a.js                  # API client (78 methods)
│   │       ├── c.js                  # Constants (API URL, WS URL)
│   │       ├── t.js                  # Theme definitions (dark/light)
│   │       └── u.js                  # Utilities
│   ├── public/
│   │   ├── gpu-agent.sh              # Served at bondli.fun/gpu-agent.sh
│   │   ├── manifest.json             # PWA manifest
│   │   └── sitemap.xml               # SEO sitemap
│   ├── index.html                    # SPA entry point
│   └── vite.config.js                # Vite config (proxy /api → :3001)
│
├── src/
│   ├── api/
│   │   ├── server.production.mjs     # Production server (Express + WS + all routes)
│   │   ├── server.mjs                # Development server
│   │   └── access-check.mjs          # Tier validation
│   │
│   ├── engine/
│   │   ├── gpu-earnings.mjs          # GPU node management, earnings, sweep cron
│   │   ├── nosana-client.mjs         # Nosana SDK/REST API client
│   │   ├── nosana-job-router.mjs     # AI inference routing via GPU fleet
│   │   ├── grok-client.mjs           # xAI Grok chat integration
│   │   │
│   │   ├── meme-intelligence.mjs     # Core ML scoring (40+ features)
│   │   ├── memetic-pipeline.mjs      # Meme DNA scoring pipeline
│   │   ├── survivorship-bias.mjs     # Survivor archetype matching
│   │   ├── game-theory.mjs           # Bayesian opponent modeling
│   │   ├── meta-engine.mjs           # Narrative lifecycle tracking
│   │   ├── velocity-scorer.mjs       # Score velocity + acceleration
│   │   ├── trajectory-classifier.mjs # Chart pattern classification
│   │   │
│   │   ├── rug-scanner.mjs           # 12+ rug detection signals
│   │   ├── artwork-scanner.mjs       # Perceptual hash image forensics
│   │   ├── exit-liquidity-detector.mjs # Exit liquidity analysis
│   │   ├── dev-wallet-tracker.mjs    # Dev wallet profiling
│   │   ├── smart-money-tracker.mjs   # Profitable wallet following
│   │   │
│   │   ├── fleet-trader.mjs          # Multi-wallet fleet trading
│   │   ├── fleet-brains.mjs          # Fleet personality archetypes
│   │   ├── trade-router.mjs          # Trade execution routing
│   │   ├── fee-engine.mjs            # Fee calculation + referrals
│   │   ├── session-manager.mjs       # Trading session lifecycle
│   │   ├── pumpfun-client.mjs        # Pump.fun bonding curve client
│   │   ├── bags-client.mjs           # Bags.fm / Meteora DBC client
│   │   ├── raydium-client.mjs        # Raydium AMM client
│   │   ├── launch-orchestrator.mjs   # Token launch coordination
│   │   ├── token-creator.mjs         # Token creation
│   │   │
│   │   ├── forward-radar.mjs         # Upstream trend detection
│   │   ├── x-social-intel.mjs        # Twitter/X social intelligence
│   │   ├── attention-value.mjs       # Attention valuation model
│   │   ├── signal-detector.mjs       # Entry signal detection
│   │   ├── regime-engine.mjs         # Market regime classification
│   │   ├── price-feeds.mjs           # Price feed aggregation
│   │   │
│   │   ├── anti-detection.mjs        # Bot detection evasion
│   │   ├── wallet-optimizer.mjs      # Wallet gas optimization
│   │   ├── wallet-saver.mjs          # Wallet key management
│   │   ├── rpc-enhanced.mjs          # Enhanced RPC with retries
│   │   ├── config.mjs                # Environment configuration
│   │   └── ...
│   │
│   ├── autoape/                      # Auto-trading pipeline
│   │   ├── pipeline.js               # Main auto-ape pipeline
│   │   ├── exit-plan.js              # Exit strategy planning
│   │   ├── sizing.js                 # Position sizing (Kelly criterion)
│   │   ├── recovery.js               # Position recovery
│   │   └── gates/                    # Entry gate checks
│   │       ├── confidence.js         # Confidence threshold
│   │       ├── disqualifiers.js      # Hard reject rules
│   │       ├── execution-window.js   # Timing window
│   │       ├── portfolio.js          # Portfolio limits
│   │       └── viability.js          # Token viability check
│   │
│   ├── scoring/memetic/              # Memetic analysis
│   │   ├── index.js                  # Pipeline coordinator
│   │   ├── linguistic.js             # Language analysis
│   │   ├── visual.js                 # Image analysis
│   │   ├── absurdity.js              # Absurdity scoring
│   │   ├── community.js              # Community signals
│   │   ├── influencer.js             # KOL detection
│   │   ├── cultural-timing.js        # Cultural moment detection
│   │   ├── temporal.js               # Time-based patterns
│   │   ├── learning-pipeline.js      # Online learning
│   │   ├── workers/                  # Background workers
│   │   │   ├── celebrity-monitor.js
│   │   │   ├── kol-monitor.js
│   │   │   ├── trend-poller.js
│   │   │   ├── viral-tracker.js
│   │   │   ├── market-poller.js
│   │   │   ├── competitor-tracker.js
│   │   │   ├── mindshare-tracker.js
│   │   │   └── launch-counter.js
│   │   └── data/                     # Reference data
│   │       ├── meme-keywords.json
│   │       ├── kol-list.json
│   │       ├── english-10k.json
│   │       └── bigram-frequencies.json
│   │
│   ├── ml/                           # LoRA GPU inference
│   │   ├── serve.py                  # FastAPI scoring server
│   │   ├── model.py                  # BondliScorer (128d, 4 layers, LoRA rank 16)
│   │   ├── train.py                  # Online training from trade outcomes
│   │   ├── setup.sh                  # Python environment setup
│   │   └── requirements.txt
│   │
│   ├── middleware/                    # Express middleware
│   │   ├── auth.mjs                  # JWT authentication
│   │   ├── rate-limiter.mjs          # Rate limiting
│   │   ├── security.mjs             # Security headers
│   │   ├── validate.mjs              # Input validation
│   │   └── wallet-auth.mjs           # Wallet signature auth
│   │
│   ├── payments/                     # Payment processing
│   │   ├── payment-routes.mjs        # Payment API routes
│   │   └── payment-verifier.mjs      # On-chain payment verification
│   │
│   └── db/                           # Data layer
│       ├── session-store.mjs         # Redis session store
│       └── user-store.mjs            # User data management
│
├── deploy/                           # Deployment
│   ├── Dockerfile                    # Production Docker image
│   ├── docker-compose.yml            # Full stack (API + Redis + Nginx + Certbot)
│   ├── deploy.sh                     # One-command deploy script
│   └── nginx.conf                    # Nginx config (SSL, rate limits, SPA routing)
│
├── bondli-gpu-agent.sh               # GPU node setup script (also served at /gpu-agent.sh)
├── .env.example                      # Environment variable template
├── GAME_THEORY.md                    # Trading axioms and optimization theory
├── SHIP_IT.md                        # Railway + Vercel deployment guide
└── package.json
```

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/Bradbuythedip/bondli.git
cd bondli
npm run setup

# Configure
cp .env.example .env
# Edit .env with your ALCHEMY_API_KEY, MASTER_SEED, etc.

# Development (frontend + backend)
npm run dev

# Production
npm run build
npm start

# GPU earning (on a machine with NVIDIA GPU)
curl -s https://bondli.fun/gpu-agent.sh | bash -s -- --wallet <YOUR_WALLET>
```

### Production Deployment (Docker)

```bash
# First time
./deploy/deploy.sh fresh

# Update
./deploy/deploy.sh update

# Status & logs
./deploy/deploy.sh status
./deploy/deploy.sh logs
```

---

## Environment Variables

```bash
# ═══ Required ═══
ALCHEMY_API_KEY=             # Alchemy RPC (free tier: 100M compute units/mo)
MASTER_SEED=                 # Trading wallet master seed (base58)
API_PORT=3001                # Server port
REDIS_URL=                   # Redis connection string

# ═══ Optional — Trading ═══
RPC_URL=                     # Custom RPC (overrides Alchemy)
API_SECRET=                  # Admin API secret
PLATFORM_WALLET=             # Fee destination wallet
X_BEARER_TOKEN=              # Twitter/X API bearer token
BONDLI_LORA_URL=             # LoRA scoring server (http://127.0.0.1:8420)

# ═══ Optional — GPU / Nosana ═══
NOSANA_API_KEY=              # Nosana API bearer token
NOSANA_API_URL=              # Nosana API base URL
NOSANA_DEPLOY_MARKET=        # Default market for deployments
NOSANA_INFERENCE=false       # Enable/disable Nosana job routing

# ═══ Optional — AI Chat ═══
XAI_API_KEY=                 # xAI API key for Grok chat support
GROK_MODEL=                  # Model override (default: grok-4)

# ═══ Optional — Bags.fm ═══
BAGS_API_KEY=                # Bags.fm API key
BAGS_PARTNER_WALLET=         # Partner wallet for revenue sharing
```

---

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run setup` | Install all dependencies (root + app) |
| `npm run dev` | Start dev server (API + Vite frontend) |
| `npm run build` | Build frontend for production |
| `npm start` | Start production server |
| `npm run scan` | Run rug scanner standalone |
| `npm run dry` | Dry-run orchestrator |
| `npm run recover` | Check for recoverable positions |
| `npm run deploy:fresh` | Full production deployment |
| `npm run deploy:update` | Rebuild and restart |
| `npm run deploy:status` | Check service health |
| `npm run deploy:logs` | Tail API logs |
| `npm run generate:secrets` | Generate secure env values |

---

## Philosophy

1. **GPUs should earn money when idle.** Nosana pays NOS tokens per second for AI inference. Bondli makes it one command.

2. **Trading tools should make decisions, not just show data.** Score derivatives apply physics to token analysis — velocity and acceleration are leading indicators.

3. **Everything should be unlocked.** No paywalls. No artificial tiers. The platform grows through user success.

---

## Status

Live on Solana mainnet. GPUs earning. AI learning.

**$BONDLI** — [pump.fun](https://pump.fun)

---

MIT License
