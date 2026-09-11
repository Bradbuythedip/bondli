// ═══ GameState: real-time opponent modelling, ported from engine/fleet-trader.mjs ═══
// On pump.fun this listened to PumpPortal's trade stream; here it eats the venue's 'trade' records
// (CurveBuy / CurveSell logs on Robinhood Chain, the simulator's records in the sim). Same maths:
// exponentially decayed buy pressure, momentum, volume rate; whale, dev-selling and dump-cascade
// detectors; and the Nash-style signal (SELL_NOW / RIDE / ACCUMULATE / HOLD) with a sell multiplier
// and a hold extension the sell loops obey. A manual override from the war room still wins except
// against the dev-selling exit.
const lc = (a) => String(a || "").toLowerCase();

export class GameState {
  /**
   * @param opts { token, ourWallets: Iterable<address>, devWallet, clock: { now }, whaleEth, log }
   */
  constructor({ token, ourWallets = [], devWallet = null, clock, whaleEth = 0.05, log = () => {} } = {}) {
    this.token = token; this.ourWallets = new Set([...ourWallets].map(lc)); this.devWallet = lc(devWallet) || null;
    this.now = clock?.now || (() => Date.now()); this.log = log; this.whaleEth = whaleEth;
    this.trades = []; this.opponents = new Map();
    this.buyPressure = 0.5; this.momentum = 0; this.whaleAlert = false; this.devSelling = false; this.dumpCascade = false;
    this.bondingPct = 0; this.mcapEth = 0; this.quoteReserve = 0; this.volumeRate = 0; this.uniqueBuyers = 0; this.signal = "HOLD";
    this.sellMultiplier = 1.0; this.holdExtension = 0; this.observedVolume = 0;
    this.manualSignal = null; this.manualSellMult = null; this.manualHoldExt = null; this.manualExpiry = 0;
    this.alive = false; this._stopped = false; this.ingested = 0; this._lastKey = null; this._wasNotHold = false; this.signalChanges = 0;
  }
  addOurs(address) { this.ourWallets.add(lc(address)); }
  /** Attach to a venue's trade stream. */
  connect(venue) { this._venue = venue; this._onTrade = (t) => this.ingest(t); venue.on("trade", this._onTrade); this.alive = true; }
  stop() { this._stopped = true; this.alive = false; if (this._venue && this._onTrade) this._venue.off("trade", this._onTrade); }
  /** The curve's own numbers, refreshed by whoever polls it. */
  setCurve({ progress, mcapEth, quoteReserve } = {}) { if (progress != null) this.bondingPct = Math.max(0, Math.min(100, progress * 100)); if (mcapEth != null) this.mcapEth = mcapEth; if (quoteReserve != null) this.quoteReserve = quoteReserve; }

  ingest(t) {
    const now = this.now(); const wallet = lc(t.wallet); const isOurs = this.ourWallets.has(wallet);
    const eth = Math.abs(Number(t.quote) || 0); const type = t.kind === "buy" ? "buy" : "sell";
    this.trades.push({ time: t.time ?? now, type, sol: eth, eth, wallet, isOurs, tokens: Number(t.tokens) || 0 });
    if (this.trades.length > 300) this.trades = this.trades.slice(-300);
    if (!isOurs && wallet) {
      if (!this.opponents.has(wallet)) this.opponents.set(wallet, { buys: 0, sells: 0, totalSol: 0, firstSeen: now, lastSeen: now, avgSize: 0, tradeCount: 0 });
      const o = this.opponents.get(wallet); if (type === "buy") o.buys++; else o.sells++; o.totalSol += eth; o.tradeCount++; o.avgSize = o.totalSol / o.tradeCount; o.lastSeen = now;
      this.observedVolume += eth;
    }
    this.ingested++;
    this._computeSignals(now);
  }

  _computeSignals(now) {
    // w(t) = exp(-λ·age): fast λ=0.1 (half-life ~7s) for pressure/momentum/cascades, medium λ=0.02 (~35s) for
    // volume rate, slow λ=0.005 (~140s) for dev selling.
    const FAST = 0.1, MED = 0.02, SLOW = 0.005;
    const decay = (age, l) => Math.exp(-l * (age / 1000));
    const external = this.trades.filter(t => !t.isOurs);
    let wBuys = 0, wSells = 0, wBuyVol = 0, wSellVol = 0, wVol = 0;
    for (const t of external) {
      const wf = decay(now - t.time, FAST);
      if (wf >= 0.01) { if (t.type === "buy") { wBuys += wf; wBuyVol += t.eth * wf; } else { wSells += wf; wSellVol += t.eth * wf; } }
      const wm = decay(now - t.time, MED); if (wm >= 0.005) wVol += t.eth * wm;
    }
    this.buyPressure = (wBuys + wSells) > 0.01 ? wBuys / (wBuys + wSells) : 0.5;
    this.momentum = wBuyVol - wSellVol;
    this.volumeRate = wVol;
    this.uniqueBuyers = new Set(external.filter(t => now - t.time < 120_000 && t.type === "buy").map(t => t.wallet)).size;
    // a whale is a buy big relative to the curve (1.5% of the virtual reserve), or the absolute floor
    const whale = Math.max(this.whaleEth, 0.015 * (this.quoteReserve || 0));
    this.whaleAlert = external.some(t => t.type === "buy" && t.eth > whale && decay(now - t.time, FAST) > 0.5);
    if (this.devWallet) this.devSelling = external.some(t => t.type === "sell" && t.wallet === this.devWallet && decay(now - t.time, SLOW) > 0.3);
    const recentSells = external.filter(t => t.type === "sell" && decay(now - t.time, FAST) > 0.3);
    this.dumpCascade = new Set(recentSells.map(t => t.wallet)).size >= 3;

    const recentSellCount = external.filter(t => t.type === "sell" && now - t.time < 30_000).length;
    const recentBuyCount = external.filter(t => t.type === "buy" && now - t.time < 30_000).length;
    const recentSellersCount = new Set(external.filter(t => t.type === "sell" && now - t.time < 10_000).map(t => t.wallet)).size;

    let signal = "HOLD", sellMult = 1.0, holdExt = 0, why = "";
    if (this.devSelling) { signal = "SELL_NOW"; sellMult = 3.0; why = "dev_selling"; }
    else if (this.dumpCascade) { signal = "SELL_NOW"; sellMult = 2.5; why = `cascade:${recentSellersCount}`; }
    else if (this.buyPressure < 0.25 && recentSellCount >= 5) { signal = "SELL_NOW"; sellMult = 2.0; why = "sell_pressure"; }
    else if (this.whaleAlert) { signal = "RIDE"; sellMult = 0.3; holdExt = 30; why = "whale"; }
    else if (this.buyPressure > 0.75 && recentBuyCount >= 4) { signal = "RIDE"; sellMult = 0.5; holdExt = 15; why = "buy_pressure"; }
    else if (this.bondingPct > 60 && this.momentum > 0) { signal = "RIDE"; sellMult = 0.4; holdExt = 45; why = "graduation_near"; }
    else if (this.uniqueBuyers >= 5 && this.momentum > 0.02 && this.buyPressure > 0.6) { signal = "ACCUMULATE"; sellMult = 0.5; holdExt = 20; why = "accumulate"; }
    else { signal = "HOLD"; sellMult = 1.0; if (this.buyPressure > 0.55) sellMult = 0.8; if (this.buyPressure < 0.4) sellMult = 1.3; }
    const key = `${signal}:${why}`;
    if (key !== this._lastKey) {
      this._lastKey = key; this.signalChanges = (this.signalChanges || 0) + 1;
      const detail = { dev_selling: "DEV SELLING — immediate exit", sell_pressure: `heavy sell pressure: ${(this.buyPressure * 100).toFixed(0)}% buys`, whale: "WHALE — riding, hold +30s", buy_pressure: `strong buy pressure ${(this.buyPressure * 100).toFixed(0)}% | ${this.uniqueBuyers} buyers`, graduation_near: `graduation approaching: ${this.bondingPct.toFixed(0)}%`, accumulate: `accumulate: ${this.uniqueBuyers} buyers, momentum ${this.momentum.toFixed(3)}` }[why] || (why.startsWith("cascade") ? `DUMP CASCADE — ${recentSellersCount} sellers in 10s` : "");
      if (signal !== "HOLD" || this._wasNotHold) this.log(`[GAME] ${signal}${detail ? " — " + detail : ""}`);
      this._wasNotHold = signal !== "HOLD";
    }

    if (this.manualSignal && now < this.manualExpiry) {
      if (!(signal === "SELL_NOW" && this.devSelling)) { signal = this.manualSignal; if (this.manualSellMult != null) sellMult = this.manualSellMult; if (this.manualHoldExt != null) holdExt = this.manualHoldExt; }
    } else if (this.manualSignal && now >= this.manualExpiry) this.manualSignal = null;

    this.signal = signal; this.sellMultiplier = sellMult; this.holdExtension = holdExt;
  }

  /** Recompute without a new trade (signals decay with time). */
  refresh() { this._computeSignals(this.now()); return this.snapshot(); }

  setManualOverride(signal, durationSec = 60) {
    const o = { ACCUMULATE: { sellMult: 0.3, holdExt: durationSec }, RIDE: { sellMult: 0.2, holdExt: durationSec }, SELL_NOW: { sellMult: 3.0, holdExt: 0 }, HOLD: { sellMult: 1.0, holdExt: 0 } }[signal];
    if (!o) return false;
    this.manualSignal = signal; this.manualSellMult = o.sellMult; this.manualHoldExt = o.holdExt; this.manualExpiry = this.now() + durationSec * 1000;
    this.log(`[GAME] manual override: ${signal} for ${durationSec}s`); this._computeSignals(this.now()); return true;
  }
  clearManualOverride() { this.manualSignal = null; this.manualExpiry = 0; this._computeSignals(this.now()); }

  snapshot() {
    return { signal: this.signal, signalChanges: this.signalChanges, sellMultiplier: this.sellMultiplier, holdExtension: this.holdExtension, buyPressure: Math.round(this.buyPressure * 100), momentum: Math.round(this.momentum * 10000) / 10000, volumeRate: Math.round(this.volumeRate * 10000) / 10000, uniqueBuyers: this.uniqueBuyers, opponents: this.opponents.size, whaleAlert: this.whaleAlert, devSelling: this.devSelling, dumpCascade: this.dumpCascade, bondingPct: Math.round(this.bondingPct), mcapEth: Math.round(this.mcapEth * 10000) / 10000, tradeCount: this.trades.length, observedVolume: Math.round(this.observedVolume * 10000) / 10000, manualOverride: this.manualSignal || null, manualExpiry: this.manualExpiry > this.now() ? Math.round((this.manualExpiry - this.now()) / 1000) : 0 };
  }
}
