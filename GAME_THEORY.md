# Bondli Game Theory — Axiomatic Optimization

## Core Axioms

### A1: Mimicry (Anti-Detection)
**Every on-chain actor must be indistinguishable from retail.**

Implications:
- Dev wallet MUST sell during pumps (retail devs take profit)
- Fleet wallets must have varied buy sizes (±50% jitter)
- No two wallets should buy in the same block
- Dev sell timing must correlate with external buys (human reaction)
- The dev should NOT sell during dumps (that looks like panic coordination)

### A2: Information Asymmetry (Edge Preservation)  
**The fleet's edge is knowing all wallet positions. This must never be inferrable on-chain.**

Implications:
- Dev sells must NOT correlate with fleet sell timing
- Dev should sell BEFORE fleet sells (looks like normal profit-taking)
- Fleet sells should start 10-30s AFTER dev sells (looks like follow-on selling)
- Volume phase washes must use different wallet pairs each cycle

### A3: Demand Creation (Volume = Attention)
**Volume attracts real buyers. Real buyers provide exit liquidity.**

Implications:
- The volume phase is the MOST important phase, not the dev buy
- Mixed buy/sell volume looks healthier than all-buy volume
- Chart shape matters: parabolic buildup → plateau → gradual distribution
- The goal of volume is to get the token on pump.fun trending/king of hill

### A4: First-Mover Exit (Time Decay)
**The fleet's edge decays as real buyers arrive. Exit before the crowd.**

Implications:
- RIDE signal should have a maximum duration (45-90 seconds)
- After 3 minutes of positive momentum, begin distribution regardless
- The longer you hold, the more you depend on greater-fool theory
- The optimal exit window is when buy pressure is STILL high but momentum is flattening

### A5: Kelly Sizing (Risk Management)
**Position size must be proportional to conviction, not budget.**

Implications:
- APE mode wallet count should scale with radar score
- CREATE mode fleet budget split should favor volume generation over dev buy
- Never put more than 30% of budget in any single wallet
- Reserve 10-15% of budget for "reactive buys" (ACCUMULATE signal)

---

## Optimal CREATE Strategy (v2)

Based on the axioms, here's the optimized flow:

### Phase 0: Deploy (0-2s)
- Create token with metadata (name, ticker, image, socials)
- Dev buy: **8-15% of budget** (just enough to show on chart)
- This creates a small green candle that snipers will see

### Phase 1: Organic Discovery (2-30s)
- Wave 1: 2-3 wallets buy at 5-15s intervals
- Each buy should be 10-20% of their allocation
- Looks like early organic discovery
- **KEY INSIGHT**: These wallets should buy LESS than the dev buy
  (snipers see the dev candle, then smaller candles = retail following)

### Phase 2: Momentum Build (30-90s)  
- Wave 2: 2-3 more wallets buy
- If no external buyers after 15s → burst buy (late bundle)
- If external buyers present → stagger slowly (look like follow-on)
- **DEV SELL #1**: Dev sells 2-3% of holdings here (looks like "damn, snipers found it, take some profit")

### Phase 3: Volume Generation (90s-5min)
- Parabolic wash trading between fleet wallets
- Buy/sell ratio: 75/25 early → 55/45 mid → 35/65 late
- **DEV SELLS**: Dev sells 1-3% on every 3rd-5th buy event
  - Total dev sells during volume: 8-15% of holdings
  - Each sell: delayed 3-15s after triggering buy (human reaction)
- Chart should show: ascending mcap with healthy red candles mixed in

### Phase 4: Peak + Distribution (5-8min)
- If external buyers active: extend Phase 3 by 1-2 minutes
- If no external buyers: start selling immediately
- **DEV SELLS MORE**: Dev sells 5-10% in 2-3 chunks
  - This signals "dev is cashing out" which is NORMAL on pump.fun
  - External holders see dev selling and may panic → providing sell pressure
  - BUT the fleet has already sold most positions, so this is fine

### Phase 5: Hold Remainder (8min+)
- Keep 15-30% of tokens across fleet (moonshot potential)
- Dev keeps 5-10% (looks like a long-term holder)
- Fleet sells trigger on GameState signals (SELL_NOW, RIDE decay)

---

## Optimal APE Strategy (v2)

### Conviction-Driven Entry
| Radar Score | Action | Wallet Count | Dev Equivalent |
|-------------|--------|-------------|---------------|
| 80-100 | FULL APE | 5-7 wallets | N/A (existing token) |
| 60-79 | MODERATE APE | 3-4 wallets | N/A |
| 40-59 | SCOUT | 1-2 wallets | N/A |
| 20-39 | WATCH ONLY | 0 (radar monitor) | N/A |
| 0-19 | SKIP | 0 | N/A |

### Exit Timing (Based on GameState)
The critical insight: **sell INTO demand, not after demand fades.**

Current problem: The sell loop waits for demand signals before selling.
This is backwards — by the time demand signals appear, price is already high.
When demand fades, price has already dropped.

**Better**: Sell a FIXED percentage on a time schedule, adjusted by GameState:
- Base: sell 5% of holdings every 30 seconds after hold period
- RIDE signal: reduce to 2% every 30s (extend hold)
- SELL_NOW: dump 50% immediately, then 25% every 10s
- ACCUMULATE: buy 5% more, reset sell timer
- HOLD: normal 5%/30s schedule

This ensures the fleet is ALWAYS distributing, just at different speeds.
No more "wait for demand then dump" — that's too slow.

---

## Dev Buy Sweet Spot: Mathematical Analysis

On pump.fun, the bonding curve follows:
```
price = virtualSolReserves / virtualTokenReserves
```

At creation: ~30 SOL virtual, ~1B virtual tokens
So initial price ≈ 30/1e9 = 0.00000003 SOL/token

A dev buy of X SOL:
- New SOL reserves: 30 + X
- New token reserves: 30 * 1e9 / (30 + X) 
- Tokens received: 1e9 - (30 * 1e9 / (30 + X)) = 1e9 * X / (30 + X)
- Price after: (30 + X) / (1e9 - tokens_received)

| Dev Buy (SOL) | Tokens Received | % of Supply | Price Impact | MCap After |
|--------------|----------------|-------------|-------------|-----------|
| 0.05 | ~1.66M (0.17%) | 0.17% | +0.17% | $5,008 |
| 0.1 | ~3.32M (0.33%) | 0.33% | +0.33% | $5,017 |
| 0.3 | ~9.9M (0.99%) | 0.99% | +1.0% | $5,050 |
| 0.5 | ~16.4M (1.64%) | 1.64% | +1.67% | $5,083 |
| 1.0 | ~32.3M (3.23%) | 3.23% | +3.33% | $5,167 |
| 2.0 | ~62.5M (6.25%) | 6.25% | +6.67% | $5,333 |
| 5.0 | ~142.9M (14.3%) | 14.3% | +16.7% | $5,833 |

**The sweet spot is 0.1-0.5 SOL dev buy:**
- Visible green candle on chart ✓
- Low price impact (fleet enters cheap) ✓  
- Dev holds <2% of supply (doesn't look like a whale) ✓
- MCap stays under $5,100 (room to 10x+ before graduation) ✓

For a 1 SOL total budget:
- Dev buy: 0.1 SOL (10%) → fleet has 0.88 SOL for 6 wallets
- Each fleet wallet: ~0.14 SOL average
- Total fleet tokens: ~28.5M (2.85% of supply) at slightly higher price
- Combined position: ~31.8M (3.18%) of supply
- Target exit: 30-50% bonded ($15K-$25K mcap) = 3-5x on dev buy

For a 5 SOL total budget:
- Dev buy: 0.5 SOL (10%) → fleet has 4.48 SOL for 6-7 wallets
- Fleet buys at 0.5-0.7% premium from dev buy (negligible)
- Combined position: ~15% of supply
- Target exit: graduation ($67K mcap) = 13x potential

---

## Summary of Recommended Changes

1. **Dev buy: 8-15% of budget** (down from 40-50%)
2. **Dev sell during volume phase**: 8-15% of dev holdings, staggered
3. **Sell on a schedule**: 5%/30s baseline, adjusted by GameState  
4. **Volume phase is king**: 3-5 minutes of mixed buy/sell wash
5. **Hold 15-30% remainder**: moonshot optionality
6. **Exit INTO demand**: sell when buys are happening, not after they stop
