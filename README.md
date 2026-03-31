<p align="center">
  <img src="app/public/hero.png" alt="bondli" width="100%" />
</p>

# bondli

**ML-powered Solana trading terminal.** Scores every token. Exits before the rug. Burns NOS on Nosana GPUs.

[![Live](https://img.shields.io/badge/Live-bondli.fun-00ff88?style=flat-square)](https://bondli.fun)
[![Twitter](https://img.shields.io/badge/Twitter-@Bondlifun-1DA1F2?style=flat-square)](https://x.com/Bondlifun)
[![Nosana](https://img.shields.io/badge/GPU-Nosana%20Network-8B5CF6?style=flat-square)](https://nosana.com)

---

## What is Bondli?

Bondli is an AI-powered trading terminal for Solana memecoins built on [Nosana](https://nosana.com) decentralized GPU compute. It watches every token launch in real-time, scores them with 40+ ML features, detects rugs before they happen, and trades autonomously — all powered by GPU inference on Nosana nodes.

**The edge:** Score derivatives (velocity + acceleration) detect deterioration 2 cycles before price drops. Three exit layers fire automatically — by the time you'd notice the chart, Bondli already sold.

**The NOS burn:** Every GPU operation — from ML scoring to premium alpha tools — burns $NOS tokens on the Nosana network. Users pay SOL, Bondli swaps to NOS via Jupiter, NOS gets burned on GPU jobs. Self-sustaining demand flywheel from the pump.fun ecosystem.

**Tiers:** Free (radar + scoring), Pro (auto-trading), VIP (GPU Alpha Tools + compute job submission + smart money signals).

**Direct links:**
- [bondli.fun/radar](https://bondli.fun/radar) — Live token radar with ML scoring
- [bondli.fun/gpu](https://bondli.fun/gpu) — GPU earnings, Alpha Tools, compute jobs
- [bondli.fun/intel](https://bondli.fun/intel) — AI trading intelligence + auto-ape
- [bondli.fun/wallet](https://bondli.fun/wallet) — Portfolio + positions
- [bondli.fun/deploy](https://bondli.fun/deploy) — Launch tokens on pump.fun / Bags.fm

---

## How Bondli Uses Nosana GPU

| Feature | Status | Description |
|---------|--------|-------------|
| **ML Scorer** | ACTIVE | 40+ features scored per token in real-time. Rug detection, chart forensics, buy pressure — all computed on GPU inference via Nosana nodes. |
| **Artwork Forensics** | ACTIVE | Every token image scanned for copy/paste rugs, template art, and AI-generated fakes. GPU-accelerated perceptual hashing and CLIP embeddings. |
| **Monte Carlo Simulator** | Q3 2026 | 10,000 path simulations per new pair — modeling entry timing, position sizing, and exit triggers. Every possible trade scenario stress-tested before capital is deployed. |
| **Live Model Retraining** | Q4 2026 | Weekly weight recalibration using real trade outcomes. Users burn NOS to retrain the scoring model on their own trading data — better entries, better exits, better win rates. |

---

## Features

### ML Token Scoring (GPU-Powered)
- **40+ features** extracted from every launch — holder distribution, chart patterns, wallet age, buy/sell pressure, social signals
- GPU inference via Nosana nodes for real-time scoring (<5ms per token)
- Model learns from every trade outcome and updates weights live
- Score velocity + acceleration are leading indicators (detect problems before price drops)
- Survivorship bias engine: Fisher's discriminant analysis + cosine similarity to "survivor archetype"
- Memetic DNA scoring: linguistic analysis, absurdity detection, cultural timing, KOL influence

### Rug Detection (GPU-Powered)
- **12+ signals** — dev dumps, sybil wallets, wash trading, staircase charts, liquidity drains, holder concentration
- 3+ moderate signals = auto-reject
- GPU-accelerated artwork scanner with perceptual hashing catches duplicates even when resized/compressed
- CLIP embeddings detect AI-generated fakes and template art
- Dev wallet profiling: balance monitoring, launch history, serial rugger identification
- Volume legitimacy analysis: detects wash trading patterns and artificial demand

### Auto-Ape Engine
- Walk-away autonomous trading — finds tokens, enters, manages positions, exits
- 3-layer exit system: score derivatives first, absolute thresholds second, trailing stops third
- Configurable rules: min score, position size, take-profit levels, stop-loss
- Live simulation mode to test strategies before going live
- Kelly criterion position sizing
- Portfolio correlation limits to prevent over-exposure

### Smart Money Tracking
- Identifies consistently profitable wallets on Solana
- **SOL balance tracking** with 5-minute cache refresh
- **Wallet categorization**: whale (>10 SOL avg), sniper (high frequency), accumulator (steady >50% WR), mixed
- Tier scoring (S/A/B/C) based on trade performance
- VIP/owner can manually add/remove wallets from watchlist
- Configurable poll interval and max wallet count
- Signals before radar picks up the token

### GPU Alpha Tools (Premium — NOS Burn)
Pay-per-use GPU-powered tools. Each use burns $NOS on Nosana's network.

| Tool | Price | Category | Description |
|------|-------|----------|-------------|
| **Deep Rug Scanner** | 0.005 SOL | Scan | Forensic token analysis — on-chain + social + code decompilation |
| **Entry Simulator** | 0.01 SOL | Simulate | Monte Carlo entry timing with 5,000 path simulations |
| **Wallet X-Ray** | 0.008 SOL | Scan | Deep-profile any wallet — 90-day history, cluster analysis |
| **Exit Timing AI** | 0.005 SOL | Simulate | Optimal exit path modeling with 5,000 simulations |
| **Launch Simulator** | 0.02 SOL | Simulate | Pre-launch 10K scenario simulation |
| **MEV Protection** | 0.01 SOL | Protect | Sandwich bot detection and trade protection |
| **Portfolio Rebalancer** | 0.02 SOL | Optimize | AI-optimized position rebalancing |
| **Custom LoRA Model** | 0.1 SOL/wk | Subscribe | Train on your own trade history — personal scoring model |
| **Chart Pattern CNN** | 0.05 SOL/wk | Subscribe | AI pattern recognition: accumulation, distribution, breakout, trap, divergence |

- Deep Rug Scan available as one-click shortcut on every token card in Radar
- Results delivered via WebSocket in real-time
- 25% Bondli margin on all premium features

### Compute Job Submission (VIP)
- Submit custom Docker containers to Nosana GPU marketplace
- Quick-select templates: Scorer, Ollama, vLLM
- Market selector: RTX 3060 through H100
- Live cost estimation (NOS + SOL) with 15% Bondli margin
- SOL → NOS swap via Jupiter v6 API
- Job history table with real-time status updates via WebSocket
- Persistent deployments with health checks

### NOS Burn Flywheel

```
Users pay SOL → Bondli swaps to NOS (Jupiter) → NOS burned on GPU job
     ↓                                                    ↓
  Better tools ← GPU node earns NOS ← Job completed on Nosana
     ↓
  More users → More NOS demand → Higher NOS value → More node operators
```

Users burn $NOS to run alpha tools → better tools improve win rates → more profitable traders need more GPU → more NOS burned. Self-sustaining demand from the pump.fun ecosystem.

**Projected at scale:** 100 users × 3 features/day ≈ 1 NOS/day burned, scaling linearly with adoption.

### Token Radar
- Real-time feed of every token launch on pump.fun and Bags.fm
- Tabs: **Momentum** (sustained buying), **Hot** (buy activity), **New** (fresh launches), **Resurgence** (comeback plays)
- Source filter: filter by BAGS or PUMP tokens within any tab
- Entry signals: STRONG / READY / EARLY indicators
- Buy pressure bars, sparkline charts, memetic DNA scores
- One-click Deep Rug Scan on any expanded token card

### Token Deployment
- Launch tokens on pump.fun or Bags.fm (Meteora DBC)
- Bags.fm: 1% perpetual creator royalty on all volume, top 100 holders get dividends
- Fleet trading with multi-wallet coordination
- Session management: sweep, close, export keys

### GPU Earnings
- Plug in your NVIDIA GPU, earn $NOS tokens via Nosana decentralized compute
- One-command setup: `curl -s https://bondli.fun/gpu-agent.sh | bash -s -- --wallet <WALLET>`
- Remote node control from dashboard: restart, stop, view logs, GPU details
- Power consumption, fan speed, VRAM utilization, clock rates monitored in real-time
- 1 user = 1 GPU = 1 node = 1 keypair
- Laptop GPUs matched to Nosana markets by VRAM tier
- 90-95% of earnings to user, remainder to treasury (hourly sweep)

### AI Chat Support (Grok 4)
- Built-in assistant powered by xAI's Grok 4, trained on Bondli + Nosana GPU knowledge
- Knows about GPU Alpha Tools, NOS burn flywheel, node setup, earnings, troubleshooting
- Context-aware: understands your node status, tier, and feature access

---

## GPU Earnings — Deep Dive

Bondli is both a **supply-side** aggregator and **demand-side** client of the [Nosana](https://nosana.com) decentralized GPU compute network.

- **Supply side:** Users plug in their NVIDIA GPUs to earn $NOS tokens processing AI jobs
- **Demand side:** Bondli submits ML inference, rug scanning, and premium alpha tool jobs to Nosana

```
┌──────────────────────────────────────────────────────────┐
│                  BONDLI × NOSANA                          │
│                                                           │
│  SUPPLY (Earn NOS)          DEMAND (Burn NOS)            │
│  ─────────────────          ─────────────────            │
│  User A → RTX 4070 → NOS   ML Scorer → RTX 4090 job     │
│  User B → RTX 5070Ti→ NOS   Rug Scan → RTX 4090 job     │
│  User C → RTX 3090 → NOS   Alpha Tools → GPU jobs       │
│                              Compute Jobs → GPU jobs      │
│                                                           │
│  Each user = 1 node         SOL → NOS swap (Jupiter)     │
│  = 1 GPU = 1 keypair        NOS burned on every job      │
└──────────────────────────────────────────────────────────┘
```

### How GPU Earning Works

1. User runs the one-liner on their GPU machine
2. Agent registers with Bondli, gets a generated Solana keypair
3. Keypair written to `~/.nosana/nosana_key.json`, Nosana node starts
4. GPU accepts AI inference jobs from the Nosana marketplace
5. $NOS earnings flow to the node wallet
6. Bondli sweeps hourly: user gets 90-95%, remainder to treasury
7. All transfers on-chain, verifiable on Solana explorer

### How Alpha Tools Burn NOS

1. User pays SOL per feature (0.005–0.1 SOL)
2. Bondli swaps SOL → NOS via Jupiter v6 API (1% slippage)
3. NOS is spent submitting a GPU job to Nosana marketplace
4. GPU node processes the Docker container (rug scan, simulation, etc.)
5. Result delivered via WebSocket to user's frontend
6. 25% Bondli margin on premium features, 15% on raw compute jobs

### Remote Node Control

Commands are relayed via the heartbeat mechanism (queued → picked up within ~60s):

- **Restart Node** — restarts the Docker container
- **Stop Node** — stops the node (can restart from dashboard)
- **View Logs** — fetches last 50 lines of Docker logs
- **GPU Details** — power draw, fan speed, clock rates, VRAM utilization, driver version
- **Set Power Limit** — adjust GPU power limit remotely

### Supported GPUs & Nosana Market Rates

| GPU | ~NOS/sec | VRAM | Market Tier |
|-----|----------|------|-------------|
| RTX 3060 | 0.000043 | 12 GB | 12GB tier |
| RTX 4070 / Laptop 50-series | 0.000035 | 12 GB | 12GB tier |
| RTX 3090 | 0.00009 | 24 GB | 24GB tier |
| RTX 4090 / Desktop 5070+ | 0.000097 | 24 GB | 24GB tier |
| A100 | 0.000115 | 80 GB | 80GB tier |
| H100 | 0.000139 | 80 GB | 80GB tier |

Laptop GPUs are matched to Nosana markets by VRAM tier. Your 5070 Ti Laptop (8-12GB) joins the 12GB tier.

Also supports RTX 5070, 5080, 5090, A4000–A6500 — mapped to nearest VRAM tier.

### GPU API Endpoints

```
# ═══ Node Management (Supply Side) ═══
POST /api/gpu/register         — generate keypair, register node
POST /api/gpu/deregister       — sweep balance, remove node
GET  /api/gpu/dashboard        — node status, earnings, extended GPU metrics
POST /api/gpu/heartbeat        — agent reports metrics every 60s, receives commands
POST /api/gpu/job-completed    — agent reports completed Nosana job
GET  /api/gpu/fleet            — aggregate view of all Bondli GPU nodes
POST /api/gpu/command          — queue command for node (stop, restart, logs, etc.)
GET  /api/gpu/command-status   — check result of a sent command
GET  /api/gpu/node-logs        — get recent Docker logs from node

# ═══ Compute Jobs (Demand Side — VIP) ═══
GET  /api/compute/markets      — list available Nosana GPU markets + pricing
POST /api/compute/submit       — submit Docker job to Nosana (SOL → NOS swap)
POST /api/compute/deploy       — create persistent deployment (always-on service)
GET  /api/compute/status/:id   — get job status from Nosana + Redis
GET  /api/compute/jobs         — user's job history
GET  /api/compute/swap-quote   — preview SOL → NOS swap quote (Jupiter v6)
GET  /api/compute/summary      — compute usage summary

# ═══ Premium Alpha Tools (Demand Side) ═══
GET  /api/premium/features     — list all 9 premium GPU features + pricing
POST /api/premium/execute      — run a premium feature (pays SOL, burns NOS)
GET  /api/premium/result/:id   — get feature result (polls Nosana for status)
GET  /api/premium/history      — user's premium job history
GET  /api/premium/stats        — global NOS burn stats, feature usage counts
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          BONDLI STACK                             │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  FRONTEND         React/Vite SPA — 5 tabs (URL-routed)           │
│                   Radar · Wallet · Deploy · Intel · GPU           │
│                                                                   │
│  BACKEND          Node.js/Express + WebSocket                     │
│                   Real-time scoring, trading, GPU management      │
│                                                                   │
│  DATA             Redis — sessions, ML weights, node registry,    │
│                   compute jobs, NOS burn tracking, premium stats  │
│                                                                   │
│  CHAIN            Solana mainnet — Alchemy RPC, PumpPortal,       │
│                   Jito bundles, Jupiter v6 swaps (SOL → NOS)      │
│                                                                   │
│  GPU SUPPLY       Nosana Network — @nosana/kit v2.2.4 SDK        │
│                   gpu-earnings.mjs — node registration, earnings  │
│                   nosana-job-router.mjs — AI inference routing    │
│                                                                   │
│  GPU DEMAND       compute-engine.mjs — job submission, SOL→NOS   │
│                   premium-compute.mjs — 9 alpha tools, NOS burn  │
│                   nosana-client.mjs — SDK + REST API client       │
│                                                                   │
│  ML               Custom LoRA — online learning, 115 features     │
│                   <5ms inference, trains on outcomes              │
│                                                                   │
│  SOCIAL           X/Twitter API — profile, engagement, KOL       │
│                                                                   │
│  AI               xAI Grok 4 — GPU support chat                  │
│                   BRAD — autonomous trading AI companion          │
└──────────────────────────────────────────────────────────────────┘
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

### GPU Pipeline

```
  USER ACTION                 BONDLI                      NOSANA
  ───────────                 ──────                      ──────
  Click "Run"  ──►  premium-compute.mjs  ──►  Jupiter SOL→NOS swap
                           │                        │
                    Build Docker job def     NOS sent to market
                           │                        │
                    Submit to Nosana  ───────►  GPU node picks up job
                           │                        │
                    Poll for result  ◄───────  Docker container runs
                           │                        │
                    WS broadcast result             NOS burned ✓
                           │
                    Redis: track burn stats
```

---

## Repo Structure

```
bondli/
├── app/                              # Frontend (React/Vite)
│   ├── src/
│   │   ├── App.jsx                   # Main SPA — all 5 tabs + GPU Alpha Tools UI
│   │   ├── IntelDashboard.jsx        # Intel analytics panel
│   │   ├── MemeticRadar.jsx          # Token radar view
│   │   ├── api.js                    # Legacy API client
│   │   ├── main.jsx                  # App entry point
│   │   ├── hooks/
│   │   │   └── useSolPrice.js        # SOL price hook
│   │   └── lib/
│   │       ├── api-client.js         # API client (78+ methods)
│   │       ├── constants.js          # Constants (API URL, WS URL)
│   │       ├── theme.js              # Theme definitions (dark/light)
│   │       └── utils.js              # Utilities
│   ├── public/
│   │   ├── gpu-agent.sh              # Served at bondli.fun/gpu-agent.sh
│   │   ├── bondli-heartbeat.sh       # Node heartbeat agent
│   │   └── manifest.json             # PWA manifest
│   ├── index.html                    # SPA entry point
│   ├── vite.config.js                # Vite config (proxy /api → :3001)
│   └── vercel.json                   # Vercel deployment config
│
├── src/
│   ├── api/
│   │   ├── server.production.mjs     # Production server (Express + WS + all routes)
│   │   ├── server.mjs                # Development server
│   │   └── access-check.mjs          # Tier validation (Free/Pro/VIP)
│   │
│   ├── engine/
│   │   │ # ── GPU / Nosana ──
│   │   ├── gpu-earnings.mjs          # GPU node management, earnings, sweep cron
│   │   ├── nosana-client.mjs         # Nosana SDK/REST API client (18 markets)
│   │   ├── nosana-job-router.mjs     # AI inference routing via GPU fleet
│   │   ├── compute-engine.mjs        # Demand-side compute: SOL→NOS swap, job submission
│   │   ├── premium-compute.mjs       # 9 premium GPU alpha tools, NOS burn tracking
│   │   │
│   │   │ # ── AI / Chat ──
│   │   ├── grok-client.mjs           # xAI Grok 4 chat integration
│   │   ├── brad-mind.mjs             # BRAD autonomous AI companion
│   │   ├── brad-client.mjs           # BRAD API client
│   │   ├── brad-paper.mjs            # BRAD paper trading engine
│   │   │
│   │   │ # ── ML Scoring ──
│   │   ├── meme-intelligence.mjs     # Core ML scoring (40+ features)
│   │   ├── memetic-pipeline.mjs      # Meme DNA scoring pipeline
│   │   ├── survivorship-bias.mjs     # Survivor archetype matching
│   │   ├── game-theory.mjs           # Bayesian opponent modeling
│   │   ├── meta-engine.mjs           # Narrative lifecycle tracking
│   │   ├── velocity-scorer.mjs       # Score velocity + acceleration
│   │   ├── trajectory-classifier.mjs # Chart pattern classification
│   │   ├── lora-client.mjs           # LoRA model inference client
│   │   │
│   │   │ # ── Rug Detection ──
│   │   ├── rug-scanner.mjs           # 12+ rug detection signals
│   │   ├── artwork-scanner.mjs       # Perceptual hash + CLIP image forensics
│   │   ├── exit-liquidity-detector.mjs # Exit liquidity analysis
│   │   ├── dev-wallet-tracker.mjs    # Dev wallet profiling
│   │   ├── smart-money-tracker.mjs   # Profitable wallet tracking + categorization
│   │   ├── demand-authenticity.mjs   # Wash trading detection
│   │   ├── volume-legitimacy.mjs     # Volume legitimacy analysis
│   │   ├── counterparty-intel.mjs    # Counterparty intelligence
│   │   │
│   │   │ # ── Trading ──
│   │   ├── fleet-trader.mjs          # Multi-wallet fleet trading
│   │   ├── fleet-brains.mjs          # Fleet personality archetypes
│   │   ├── trade-router.mjs          # Trade execution routing
│   │   ├── trade-attribution.mjs     # Trade outcome attribution
│   │   ├── fee-engine.mjs            # Fee calculation + referrals
│   │   ├── session-manager.mjs       # Trading session lifecycle
│   │   ├── pumpfun-client.mjs        # Pump.fun bonding curve client
│   │   ├── bags-client.mjs           # Bags.fm / Meteora DBC client
│   │   ├── raydium-client.mjs        # Raydium AMM client + Jupiter swaps
│   │   ├── launch-orchestrator.mjs   # Token launch coordination
│   │   ├── token-creator.mjs         # Token creation
│   │   ├── orchestrator.mjs          # Main orchestration loop
│   │   ├── exit.mjs                  # Exit execution engine
│   │   ├── recover.mjs               # Position recovery
│   │   ├── simulator.mjs             # Trade simulation engine
│   │   │
│   │   │ # ── Intelligence ──
│   │   ├── forward-radar.mjs         # Upstream trend detection
│   │   ├── resurgence-scanner.mjs    # Comeback play detection
│   │   ├── x-social-intel.mjs        # Twitter/X social intelligence
│   │   ├── attention-value.mjs       # Attention valuation model
│   │   ├── signal-detector.mjs       # Entry signal detection
│   │   ├── regime-engine.mjs         # Market regime classification
│   │   ├── narrative-lifecycle.mjs   # Narrative stage tracking
│   │   ├── historical-movers.mjs     # Historical mover analysis
│   │   ├── portfolio-correlation.mjs # Portfolio correlation limits
│   │   ├── position-health.mjs       # Position health monitoring
│   │   ├── tilt-detector.mjs         # Emotional tilt detection
│   │   ├── price-feeds.mjs           # Price feed aggregation
│   │   ├── volume-engine.mjs         # Volume analysis engine
│   │   │
│   │   │ # ── Infrastructure ──
│   │   ├── alchemy-client.mjs        # Alchemy RPC client
│   │   ├── anti-detection.mjs        # Bot detection evasion
│   │   ├── wallet-optimizer.mjs      # Wallet gas optimization
│   │   ├── wallet-saver.mjs          # Wallet key management
│   │   ├── rpc-enhanced.mjs          # Enhanced RPC with retries
│   │   ├── benchmarker.mjs           # Performance benchmarking
│   │   └── config.mjs                # Environment configuration
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
│   │   ├── visual.js                 # Image analysis (CLIP embeddings)
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
│   │   └── setup.sh                  # Python environment setup
│   │
│   ├── middleware/                    # Express middleware
│   │   ├── auth.mjs                  # JWT authentication
│   │   ├── rate-limiter.mjs          # Rate limiting
│   │   ├── security.mjs              # Security headers
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
├── gpu-connect.sh                    # GPU connection helper
├── .env.example                      # Environment variable template
├── GAME_THEORY.md                    # Trading axioms and optimization theory
├── GPU_TRAINING_GUIDE.md             # GPU setup and training documentation
├── GRANT_PROPOSAL_ONE_PAGER.md       # Nosana grant proposal
├── NOSANA_GRANT_ANSWERS.md           # Detailed Nosana grant application
├── TECHNICAL_ARCHITECTURE.md         # Full technical architecture doc
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
REDIS_URL=                   # Redis connection string (redis://localhost:6379)

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
COMPUTE_WALLET_SECRET=       # Keypair for SOL→NOS swaps (compute engine)

# ═══ Optional — AI Chat ═══
XAI_API_KEY=                 # xAI API key for Grok 4 chat support
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

3. **GPU demand should come from real usage.** Every premium alpha tool burns NOS on Nosana's network. Users get better trading tools, Nosana gets sustained demand — no artificial tokenomics.

4. **Tiered access, not paywalls.** Free users get the full radar + scoring engine. Pro unlocks auto-trading. VIP unlocks GPU Alpha Tools, compute jobs, and smart money signals. Value scales with commitment.

---

## Redis Schema

```
# ── GPU Nodes ──
bondli:gpu:node:{addr}            # Node registration + metrics
bondli:gpu:user_node:{wallet}     # User → node mapping
bondli:gpu:nodekey:{addr}         # Node keypair

# ── Compute Jobs ──
compute:job:{jobId}               # Job record (7-day TTL)
compute:user:{userId}:jobs        # User's job history (30-day TTL)
compute:deploy:{deployId}         # Deployment record

# ── Premium Alpha Tools ──
premium:job:{jobId}               # Premium job record (7-day TTL)
premium:user:{userId}:jobs        # User's premium history (30-day TTL)
premium:total_nos_burned          # Global NOS burn counter
premium:total_revenue_sol         # Global revenue counter
premium:feature_usage             # Per-feature usage hash
```

---

## Status

Live on Solana mainnet. GPUs earning. NOS burning. AI learning.

**$BONDLI** — [pump.fun](https://pump.fun) · **Nosana Partner** — [nosana.com](https://nosana.com)

---

MIT License
