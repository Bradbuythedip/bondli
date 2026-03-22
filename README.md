<p align="center">
  <img src="hero.png" alt="bondli" width="100%" />
</p>

# bondli

**earn with your GPU. trade with AI.**

---

bondli is two things:

1. **GPU earnings** — plug in your NVIDIA GPU, run a Nosana node, earn $NOS tokens by processing AI inference jobs from a decentralized compute marketplace on Solana.

2. **AI trading intelligence** — a scoring engine that watches every token on pump.fun, learns from every outcome, and trades before humans can react.

one platform. two income streams. built on Solana.

---

## GPU earnings

bondli is an aggregation layer for the [Nosana](https://nosana.com) decentralized GPU compute network. each Pro/VIP user runs one Nosana node on their machine — 1 user, 1 GPU, 1 node, 1 keypair.

the "Bondli GPU Fleet" is the collective of all user nodes. bondli makes setup easy, tracks earnings across users, and routes its own AI inference jobs to the fleet.

```
┌──────────────────────────────────────────────────────┐
│                BONDLI GPU FLEET                       │
│                                                       │
│  User A (Pro)  → nodeKey_A → RTX 4070  → earns NOS  │
│  User B (VIP)  → nodeKey_B → RTX 5070Ti→ earns NOS  │
│  User C (Pro)  → nodeKey_C → RTX 3090  → earns NOS  │
│  User D (VIP)  → nodeKey_D → RTX 5080  → earns NOS  │
│                                                       │
│  Each user = 1 node = 1 GPU = 1 keypair              │
└──────────────────────────────────────────────────────┘
```

### how it works

1. user runs `curl -s https://bondli.fun/gpu-agent.sh | bash -s -- --wallet <WALLET>`
2. agent registers with bondli, gets a generated Solana keypair
3. keypair is written to `~/.nosana/nosana_key.json`, Nosana node starts
4. GPU accepts AI inference jobs from the Nosana marketplace
5. $NOS earnings flow to the node wallet
6. bondli sweeps hourly: 90% (Pro) or 95% (VIP) to user, remainder to treasury
7. all transfers on-chain, verifiable on Solana explorer

### supported GPUs & rates

| GPU | Nosana Market | ~NOS/sec | VRAM |
|-----|---------------|----------|------|
| RTX 3060 | `7AtiXM...cGHq` | 0.000043 | 12 GB |
| RTX 4070 | `EzuHhk...8Aso` | 0.000035 | 12 GB |
| RTX 3090 | `CA5pMp...CpuQ` | 0.00009 | 24 GB |
| RTX 4090 | `97G9Nn...odAf` | 0.000097 | 24 GB |
| A100 | `GLJHzq...M22` | 0.000115 | 80 GB |

also supports RTX 5070, 5080, 5090, A4000–A6500, H100 — mapped to the nearest market tier.

### trust model

bondli generates and manages the node keypair (Option C: Custody Wallet). users trust bondli with keypair custody and honest fee accounting. users retain physical control (their hardware), kill switch (stop Docker anytime), and can deregister to sweep remaining balance. all NOS transfers are on-chain.

### GPU API endpoints

```
POST /api/gpu/register      — generate keypair, register node (Pro/VIP only)
POST /api/gpu/deregister    — sweep balance, remove node
GET  /api/gpu/dashboard     — user's node status, earnings, telemetry
POST /api/gpu/heartbeat     — agent reports GPU util/temp every 60s
POST /api/gpu/job-completed — agent reports completed Nosana job
GET  /api/gpu/fleet         — aggregate view of all Bondli GPU nodes
```

### Nosana integration

bondli integrates with Nosana via the `@nosana/kit` v2.0 SDK and REST API for:

- **job posting** — bondli's AI inference needs (rug scoring, price prediction) are posted as jobs to Nosana markets where user nodes are registered
- **deployment management** — SCHEDULED strategy with 2 replicas for always-on ML services
- **endpoint routing** — `https://{NODE_KEY}.node.k8s.prd.nos.ci` pattern for direct inference access
- **market discovery** — programmatic GPU tier → market address resolution

```
POST /api/nosana/deploy     — deploy inference service to Nosana fleet
POST /api/nosana/job        — post one-off inference job
GET  /api/nosana/job/:id    — get job status/results
GET  /api/nosana/status     — router status, deployment, endpoints
GET  /api/nosana/markets    — available Nosana GPU markets
GET  /api/nosana/credits    — Nosana credits balance
```

---

## AI trading intelligence

### the brain

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

### intelligence & scoring

- **40+ feature ML** — behavioral economics (Kahneman), network effects (Tipping Point), on-chain forensics, chart shape analysis, social signals. weighted, learned, updated on every outcome.

- **score dynamics** — velocity and acceleration of the score are leading indicators. by the time a score drops, the derivatives told you 2 cycles ago.

- **survivorship bias engine** — Fisher's discriminant analysis per feature. cosine similarity to a "survivor archetype" built from tokens that graduated.

- **game theory engine** — real-time opponent modeling. Bayesian wallet classification: snipers, whales, bots, retail, accumulators.

- **memetic pipeline** — stateless meme scoring. quick 3-module pre-filter (<50ms), then full 7-module deep score. language processing, absurdity detection, KOL/trend polling.

- **meta engine** — narrative tracking across 8 categories. Signal Detection Theory optimization for entries during peak metas.

### security & rug detection

- **12+ rug signals** — dev sell speed, coordinated dumps, sybil bots, wash trading, holder concentration, liquidity drain, flatline-spike patterns. 3 moderate = hard reject.

- **artwork scanner** — perceptual hashing catches duplicates even resized/compressed. AI-generated image detection.

- **dev wallet profiling** — balance monitoring, launch history, rug rate calculation, serial rugger ID.

- **chart pattern recognition** — classifies price trajectories. learns which shapes graduate vs rug.

### trading

- **auto-ape** — walk-away trading. finds tokens, enters, manages positions, takes profit, cuts losses. 3-layer exit: derivatives first, absolute thresholds second, trailing stops third.

- **quick-ape** — one-click sniping with configurable slippage, priority fees, Jito tips.

- **fleet trading** — multi-wallet coordinated launches. 7 axioms, 5 personality archetypes. Nash equilibrium. Kelly sizing.

- **smart money tracker** — identifies consistently profitable wallets. signals before radar picks up the token.

---

## fee system

```
┌─────────────────────────────────────────────────────────┐
│                    FEE STRUCTURE                         │
├──────────────────┬──────────┬────────────────────────────┤
│  tier            │  trading │  GPU earnings              │
├──────────────────┼──────────┼────────────────────────────┤
│  Free (0 SOL)    │  25-5%   │  not available             │
│  Pro (1 SOL)     │  0%      │  10% platform fee          │
│  VIP (10 SOL)    │  0%      │  5% platform fee           │
└──────────────────┴──────────┴────────────────────────────┘

Free tier profit ladder: 0 SOL → 25% | 1+ → 20% | 5+ → 15% | 15+ → 10% | 50+ → 5%
Win streak bonus: -2% per consecutive win (up to -10%)
Referrals: 20-40% of platform revenue from referred users
```

---

## repo structure

```
bondli/
├── app/                          # frontend (React/Vite)
│   └── src/
│       ├── App.jsx               # main app — GPU, radar, wallet, intel, deploy tabs
│       ├── IntelDashboard.jsx    # intel analytics panel
│       ├── MemeticRadar.jsx      # token radar view
│       └── lib/                  # shared utilities
│
├── src/
│   ├── api/
│   │   └── server.production.mjs # production server (Express + WS + all routes)
│   │
│   ├── engine/
│   │   ├── gpu-earnings.mjs      # GPU earnings — register, dashboard, sweep cron
│   │   ├── nosana-client.mjs     # Nosana SDK/REST API client
│   │   ├── nosana-job-router.mjs # AI inference routing via GPU fleet
│   │   │
│   │   ├── meme-intelligence.mjs # core ML scoring (40+ features)
│   │   ├── memetic-pipeline.mjs  # meme DNA scoring pipeline
│   │   ├── survivorship-bias.mjs # survivor archetype matching
│   │   ├── game-theory.mjs       # Bayesian opponent modeling
│   │   ├── meta-engine.mjs       # narrative tracking
│   │   │
│   │   ├── rug-scanner.mjs       # 12+ rug signals
│   │   ├── artwork-scanner.mjs   # perceptual hash image forensics
│   │   ├── smart-money-tracker.mjs # profitable wallet following
│   │   │
│   │   ├── fleet-trader.mjs      # fleet trading v4
│   │   ├── fee-engine.mjs        # profit ladder + referrals
│   │   ├── session-manager.mjs   # trading session lifecycle
│   │   └── config.mjs            # environment configuration
│   │
│   └── ml/                       # LoRA GPU inference
│       ├── serve.py              # FastAPI scoring server
│       ├── model.py              # BondliScorer (128d, 4 layers, LoRA rank 16)
│       └── train.py              # online training from trade outcomes
│
├── bondli-gpu-agent.sh           # one-command GPU node setup script
├── package.json
└── README.md
```

---

## the stack

```
frontend    React/Vite — GPU earn, radar, wallet, intel dashboard, deploy wizard
backend     Node.js/Express — WebSocket feeds, scoring pipeline, GPU fleet management
chain       Solana mainnet — Alchemy RPC, PumpPortal Lightning, Jito bundles
GPU         Nosana Network — decentralized compute, @nosana/kit v2.0 SDK
memory      Redis — sessions, learned weights, node registry, earnings logs
ML          Custom LoRA — online learning, 115-feature scorer, <5ms inference
social      X/Twitter API — profile validation, engagement scoring, sentiment
```

---

## environment variables

```
# Core
ALCHEMY_API_KEY=         # Alchemy RPC
RPC_URL=                 # Custom RPC (overrides Alchemy)
REDIS_URL=               # Redis connection
API_PORT=3001            # Server port
PLATFORM_WALLET=         # Fee destination

# GPU / Nosana
NOSANA_API_KEY=          # Nosana API bearer token (nos_xxx_...)
NOSANA_API_URL=          # Nosana API base URL
NOSANA_DEPLOY_MARKET=    # Default market for deployments
NOSANA_DEPLOY_REPLICAS=  # Replica count (default 2)
NOSANA_DEPLOY_SCHEDULE=  # Cron schedule (default hourly)
NOSANA_INFERENCE=        # Set to "false" to disable Nosana routing

# Trading
MASTER_SEED=             # Trading wallet master seed
BONDLI_LORA_URL=         # GPU scoring server (default http://127.0.0.1:8420)
PRO_FEE_SOL=1            # Pro tier cost
VIP_FEE_SOL=10           # VIP tier cost

# Social
X_BEARER_TOKEN=          # Twitter/X API bearer
```

---

## quick start

```bash
# Clone and install
git clone https://github.com/Bradbuythedip/bondli.git
cd bondli
npm run setup

# Start development
npm run dev

# Start GPU earning (on a machine with NVIDIA GPU)
curl -s https://bondli.fun/gpu-agent.sh | bash -s -- --wallet <YOUR_WALLET>

# Production
npm start
```

---

## philosophy

bondli exists because:

1. **GPUs should earn money when idle.** Nosana's decentralized compute marketplace pays NOS tokens per second for AI inference. bondli makes it one command to start earning.

2. **trading tools should make decisions, not just show data.** the scoring engine applies physics to token scores — velocity and acceleration are leading indicators. combine with Kahneman's behavioral economics, Gladwell's Tipping Point, and game theory to predict crowd behavior before it happens.

3. **the fee model should reward performance.** winning traders pay less. GPU earnings compound. the platform grows through user success, not extraction.

---

## access tiers

| tier | trading fee | GPU earning | what you get |
|------|-------------|-------------|--------------|
| **Free** | 25% → 5% (ladder) | — | radar, scoring, rug detection, quick-ape |
| **Pro** | 0% | 10% platform fee | auto-ape, smart money, fleet, GPU earnings |
| **VIP** | 0% | 5% platform fee | everything + priority queue + API access |

---

## status

live on Solana mainnet. GPUs earning. AI learning.

**$BONDLI** — [pump.fun](https://pump.fun)

---

MIT License
