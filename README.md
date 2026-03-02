# BONDLI.FUN — Game Theory PumpFun Engine v3.0

Launchpad + trading engine for PumpFun tokens. Create coins, deploy wallet fleets with independent AI brains, and trade bonding curves with game theory. Fee engine with profit-share model and owner detection.

## Quick Start

```bash
git clone <repo>
cd bondli
npm run setup
nano .env
npm run dev
```

## Fee Model

Fees settle to `anal.sol`. Dynamic profit-share on wins (10-20%), flat infra fee on losses (0.002-0.020 SOL). Owner wallets (anal.sol + registered) pay ZERO fees.

### Profit Share

| SOL In | Rate |
|--------|------|
| <= 1 | 10% |
| <= 5 | 12% |
| <= 15 | 15% |
| <= 30 | 18% |
| > 30 | 20% |

### Infra Fee (Loss)

| SOL In | Flat Fee |
|--------|----------|
| <= 1 | 0.002 SOL |
| <= 5 | 0.005 SOL |
| <= 15 | 0.010 SOL |
| <= 30 | 0.015 SOL |
| > 30 | 0.020 SOL |

## Wallet Roles

| Role | Weight | Behavior |
|------|--------|----------|
| Sniper | 8% | Fast entry, holds early position |
| Accumulator | 12% | Steady micro-buys, builds floor |
| Momentum | 22% | Buy pressure after buys, FOMO |
| Swing | 18% | Buys dips, sells rips |
| Whale | 28% | Large trades at key moments |
| Liquidator | 8% | Strategic profit-taking |
| Recycler | 4% | SOL recovery loop |

Wallet count scales: 3 at 0.5 SOL up to 20 at 50 SOL.

## Anti-Sniper Purge

Configurable 0-60% purge phase shakes out snipers following the fleet. Adjustable via UI slider.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API + UI (development) |
| `npm run api` | API server only |
| `npm run ui` | Frontend only |
| `npm run build` | Build frontend for production |
| `npm start` | Engine CLI (live) |
| `npm run dry` | Engine CLI (dry run) |
| `npm run scan` | Rug scanner |
| `npm run exit` | Exit positions |
| `npm run recover` | Fund recovery scan |

## No Payment Gate

Unlike pumplaunch, Bondli loads straight in. No 0.1 SOL access fee.

---

**bondli.fun** — built for degens, by degens.
