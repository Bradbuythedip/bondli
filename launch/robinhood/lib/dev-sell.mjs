// ═══ DevSellController: the mimicry axiom, ported from engine/fleet-trader.mjs ═══
// A dev that never sells while six wallets buy is a coordination signal. During the volume phase the
// dev takes small profits after buys, like a retail creator would: bounded (20% of the position in
// this phase), spaced (15 s), never during SELL_NOW, less during RIDE. Sizes and delays are drawn
// from the session's rng so a simulated run replays.
export class DevSellController {
  constructor(session, { maxDevSellPct = 0.20, minSellGapMs = 15_000 } = {}) {
    this.session = session; this.rng = session.rng; this.now = session.clock.now;
    this.totalDevSoldPct = 0; this.maxDevSellPct = maxDevSellPct; this.sellCount = 0; this.lastSellTime = 0; this.minSellGap = minSellGapMs;
  }
  /** After a trade of `tradeEth` (isOurs says whether a fleet wallet made it): should the dev sell, how much, after how long? */
  shouldDevSell(tradeType, tradeEth, isOurs, gs, quoteReserve = 3) {
    if (this.totalDevSoldPct >= this.maxDevSellPct) return null;
    if (gs?.signal === "SELL_NOW") return null;
    if (this.now() - this.lastSellTime < this.minSellGap) return null;
    if (tradeType === "sell") return null;
    const r = this.rng;
    // size classes relative to the curve: a "big" buy is 1% of the virtual reserve
    const big = 0.01 * quoteReserve, mid = 0.002 * quoteReserve, small = 0.0004 * quoteReserve;
    let probability, sellPct, delay;
    if (tradeEth > big) { probability = 0.30; sellPct = 0.02 + r() * 0.03; delay = 3000 + r() * 5000; }
    else if (tradeEth > mid) { probability = 0.15; sellPct = 0.01 + r() * 0.02; delay = 5000 + r() * 8000; }
    else if (!isOurs && tradeEth > small) { probability = 0.08; sellPct = 0.01 + r() * 0.015; delay = 8000 + r() * 12000; }
    else { probability = 0.04; sellPct = 0.005 + r() * 0.01; delay = 10000 + r() * 15000; }
    if (this.session.tradeCount > 10) probability *= 1.3;
    if (this.session.tradeCount > 20) probability *= 1.2;
    if (gs?.signal === "RIDE") { probability *= 0.3; sellPct *= 0.5; }
    if (r() > probability) return null;
    sellPct = Math.min(sellPct, this.maxDevSellPct - this.totalDevSoldPct);
    if (sellPct < 0.003) return null;
    return { shouldSell: true, sellPct, delay };
  }
  recordSell(pct) { this.totalDevSoldPct += pct; this.sellCount++; this.lastSellTime = this.now(); }
  summary() { return { totalSoldPct: +(this.totalDevSoldPct * 100).toFixed(2), sellCount: this.sellCount, remainingAllowance: +((this.maxDevSellPct - this.totalDevSoldPct) * 100).toFixed(2) }; }
}
