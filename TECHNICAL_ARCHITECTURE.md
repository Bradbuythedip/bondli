# Bondli — Technical Architecture Diagram

## System Overview: GPU Earnings, Nosana Integration & Bonding Curve

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          BONDLI PLATFORM ARCHITECTURE                            │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐     │
│  │                         FRONTEND (React/Vite SPA)                       │     │
│  │                                                                         │     │
│  │   ┌─────────┐  ┌────────┐  ┌────────┐  ┌───────┐  ┌──────────────┐   │     │
│  │   │  Radar  │  │ Wallet │  │ Deploy │  │ Intel │  │ GPU Dashboard│   │     │
│  │   │ Token   │  │ Fleet  │  │ Launch │  │ Smart │  │ Node Status  │   │     │
│  │   │ Scanner │  │ Mgmt   │  │ Tokens │  │ Money │  │ Earnings     │   │     │
│  │   └────┬────┘  └───┬────┘  └───┬────┘  └──┬────┘  └──────┬───────┘   │     │
│  │        └────────────┴──────────┴───────────┴──────────────┘           │     │
│  │                          REST + WebSocket                              │     │
│  └──────────────────────────────────┬──────────────────────────────────────┘     │
│                                     │                                            │
│  ═══════════════════════════════════╪════════════════════════════════════════    │
│                                     │                                            │
│  ┌──────────────────────────────────┴──────────────────────────────────────┐     │
│  │                    BACKEND (Node.js/Express + WS)                       │     │
│  │                                                                         │     │
│  │  ┌───────────────────────────────────────────────────────────────────┐  │     │
│  │  │                        API Layer                                  │  │     │
│  │  │  /api/gpu/*    /api/trade/*   /api/radar/*   /api/payment/*      │  │     │
│  │  │  /api/deploy/* /api/intel/*   /api/chat/*    /api/health         │  │     │
│  │  └───────────┬───────────┬──────────────┬───────────────────────────┘  │     │
│  │              │           │              │                               │     │
│  │  ┌───────────▼───┐  ┌───▼──────────┐  ┌▼───────────────────────────┐  │     │
│  │  │  GPU ENGINE   │  │  ML ENGINE   │  │     TRADING ENGINE         │  │     │
│  │  │               │  │              │  │                             │  │     │
│  │  │ gpu-earnings  │  │ 40+ Features │  │ Auto-Ape Pipeline          │  │     │
│  │  │ nosana-client │  │ LoRA Scorer  │  │ Fleet Trader               │  │     │
│  │  │ job-router    │  │ Rug Scanner  │  │ Exit Strategy              │  │     │
│  │  │ heartbeat     │  │ Velocity     │  │ Position Sizing (Kelly)    │  │     │
│  │  │ sweep cron    │  │ Survivor     │  │ Trade Router               │  │     │
│  │  │               │  │ Game Theory  │  │ Fee Engine                 │  │     │
│  │  └───────┬───────┘  └──────┬───────┘  └──────────┬────────────────┘  │     │
│  │          │                 │                      │                    │     │
│  │  ┌───────▼─────────────────▼──────────────────────▼────────────────┐  │     │
│  │  │                     Redis (State Layer)                         │  │     │
│  │  │  Sessions │ ML Weights │ Node Registry │ Earnings │ Positions  │  │     │
│  │  └────────────────────────────────────────────────────────────────┘  │     │
│  └─────────────────────────────────────────────────────────────────────┘     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘


══════════════════════════════════════════════════════════════════════════════════
                          EXTERNAL INTEGRATIONS
══════════════════════════════════════════════════════════════════════════════════


┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                  │
│   ┌─────────────────────┐    ┌──────────────────┐    ┌───────────────────────┐  │
│   │    NOSANA NETWORK   │    │  SOLANA MAINNET  │    │   BONDING CURVES      │  │
│   │   (DePIN Compute)   │    │   (Blockchain)   │    │   (Token Economics)   │  │
│   │                     │    │                  │    │                       │  │
│   │  ┌───────────────┐  │    │  Alchemy RPC     │    │  ┌─────────────────┐  │  │
│   │  │ GPU Marketplace│  │    │  Helius RPC      │    │  │    pump.fun     │  │  │
│   │  │               │  │    │  Jupiter Swaps   │    │  │  AMM Bonding    │  │  │
│   │  │ AI Inference  │  │    │  Jito Bundles    │    │  │  Curve          │  │  │
│   │  │ Jobs          │  │    │  PumpPortal WS   │    │  │                 │  │  │
│   │  │               │  │    │  SPL Tokens      │    │  │  price =        │  │  │
│   │  │ $NOS Rewards  │  │    │                  │    │  │  SOL_reserve /  │  │  │
│   │  └───────┬───────┘  │    └────────┬─────────┘    │  │  token_reserve  │  │  │
│   │          │          │             │              │  └─────────────────┘  │  │
│   │          │          │             │              │                       │  │
│   │          │          │             │              │  ┌─────────────────┐  │  │
│   │          │          │             │              │  │    Bags.fm      │  │  │
│   │          │          │             │              │  │  Meteora DBC    │  │  │
│   │          │          │             │              │  │  1% Creator     │  │  │
│   │          │          │             │              │  │  Royalty        │  │  │
│   │          │          │             │              │  └─────────────────┘  │  │
│   └──────────┼──────────┘             │              └───────────────────────┘  │
│              │                        │                                          │
└──────────────┼────────────────────────┼──────────────────────────────────────────┘
               │                        │
               ▼                        ▼

══════════════════════════════════════════════════════════════════════════════════
               GPU EARNINGS FLOW (Nosana Integration)
══════════════════════════════════════════════════════════════════════════════════

  GPU Owner                    Bondli Platform                Nosana Network
  ─────────                    ──────────────                ──────────────
      │                              │                             │
      │  1. curl gpu-agent.sh        │                             │
      │─────────────────────────────▶│                             │
      │                              │                             │
      │  2. Register node            │                             │
      │  (POST /api/gpu/register)    │                             │
      │─────────────────────────────▶│  3. Generate Solana keypair │
      │                              │────────────────────────────▶│
      │  4. Keypair + config         │                             │
      │◀─────────────────────────────│  (nosana_key.json)          │
      │                              │                             │
      │  5. Start Nosana node        │                             │
      │  (Docker container)          │                             │
      │─────────────────────────────────────────────────────────▶ │
      │                              │                             │
      │  6. Heartbeat every 60s      │                             │
      │  (POST /api/gpu/heartbeat)   │                             │
      │─────────────────────────────▶│  7. Accept AI inference job │
      │                              │◀────────────────────────────│
      │  8. Execute job on GPU       │                             │
      │◀─────────────────────────────│                             │
      │─────────────────────────────────────────────────────────▶ │
      │                              │                             │
      │                              │  9. $NOS reward to node     │
      │                              │◀────────────────────────────│
      │                              │                             │
      │  10. Hourly sweep            │                             │
      │  ┌───────────────────────────┤                             │
      │  │  90-95% ──▶ User wallet   │                             │
      │  │   5-10% ──▶ Treasury      │                             │
      │  └───────────────────────────┤                             │
      │                              │                             │


══════════════════════════════════════════════════════════════════════════════════
               BONDING CURVE MECHANICS (pump.fun)
══════════════════════════════════════════════════════════════════════════════════

  Constant-Product AMM:

    price = virtualSolReserves / virtualTokenReserves

  At creation:  ~30 SOL virtual reserves, ~1B virtual tokens
  Initial price: 30 / 1,000,000,000 = 0.00000003 SOL/token

  ┌──────────────────────────────────────────────────────────────┐
  │  Price                                                        │
  │  ▲          Graduation Threshold                              │
  │  │          ($67K mcap)                                       │
  │  │              ╱─────── Migrates to Raydium AMM              │
  │  │            ╱                                               │
  │  │          ╱     ◀── Bondli ML detects                       │
  │  │        ╱           momentum shifts here                    │
  │  │      ╱                                                     │
  │  │    ╱   ◀── Score velocity + acceleration                   │
  │  │  ╱         detect deterioration 2 cycles                   │
  │  │╱           before price drops                              │
  │  ├──────────────────────────────────────────────▶ Supply      │
  │  Launch                                                       │
  └──────────────────────────────────────────────────────────────┘

  Bondli's ML Engine monitors:
  ├── Score velocity   (first derivative — rate of change)
  ├── Score acceleration (second derivative — change of rate)
  ├── 12+ rug signals  (dev dumps, sybils, wash trades)
  └── 3-layer exit     (derivatives → thresholds → trailing stops)


══════════════════════════════════════════════════════════════════════════════════
               THE FLYWHEEL: How All Three Systems Connect
══════════════════════════════════════════════════════════════════════════════════

                    ┌──────────────┐
                    │  GPU Owners  │
                    │  plug in     │
                    │  NVIDIA GPUs │
                    └──────┬───────┘
                           │
                           ▼
                ┌──────────────────────┐
                │   Nosana Network     │
                │   AI Inference Jobs  │──────────────┐
                └──────────┬───────────┘              │
                           │                          │
                    $NOS earnings                ML compute for
                           │                    Bondli's LoRA model
                           ▼                          │
                ┌──────────────────────┐              │
                │   Bondli Treasury    │              │
                │   (5-10% of GPU $)   │◀─────────────┘
                └──────────┬───────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
     ┌──────────────┐ ┌────────┐ ┌──────────────┐
     │ ML Model     │ │ Growth │ │  Trading     │
     │ Training     │ │ & User │ │  Fee Revenue │
     │ Improvement  │ │ Acquis │ │  Engine      │
     └──────┬───────┘ └────┬───┘ └──────┬───────┘
            │              │            │
            ▼              ▼            ▼
     ┌──────────────────────────────────────┐
     │   Better Scores → More Traders →     │
     │   More Fees → More GPUs → More       │
     │   Compute → Better ML → Repeat       │
     └──────────────────────────────────────┘


══════════════════════════════════════════════════════════════════════════════════
               ML SCORING PIPELINE
══════════════════════════════════════════════════════════════════════════════════

  New Token Launch (PumpPortal WebSocket)
         │
         ▼
  ┌──────────────────────────────────────────────────────────────┐
  │                     Feature Extraction                        │
  │                                                               │
  │  On-Chain (20+)        Social (10+)        Visual (5+)       │
  │  ├─ Holder distrib.    ├─ Twitter signals   ├─ Artwork hash  │
  │  ├─ Buy/sell pressure  ├─ KOL detection     ├─ Duplicate     │
  │  ├─ Wallet ages        ├─ Engagement rate   │  detection     │
  │  ├─ Dev wallet profile ├─ Follower quality  ├─ Meme DNA      │
  │  ├─ Liquidity depth    ├─ Post frequency    └─ Cultural      │
  │  ├─ Chart patterns     └─ Sentiment              timing      │
  │  └─ Sybil clustering                                         │
  └──────────────────────┬───────────────────────────────────────┘
                         │
                         ▼
  ┌──────────────────────────────────────────────────────────────┐
  │              LoRA Neural Network (128d, 4-layer, rank-16)    │
  │              <5ms inference — online learning from outcomes   │
  └──────────────────────┬───────────────────────────────────────┘
                         │
                         ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  Score (0-100) + Velocity + Acceleration + Rug Probability   │
  │                                                               │
  │  Decision:  APE (80+)  │  WATCH (40-79)  │  SKIP (<40)      │
  │             + RUG override if 3+ signals detected             │
  └──────────────────────────────────────────────────────────────┘
```

---

*Bondli v3.0 — Live on Solana Mainnet*
