// ═══ ContinuousVolumeEngine and AutoRugController, ported from engine/volume-engine.mjs ═══
// After the playbook, volume must not flatline: fleet wallets trade against the curve in bursts, a
// different wallet each trade, human-like gaps, buy bias easing from 75% to 50%, sizes escalating
// 8% every five cycles to a cap, faster still when three or more real buyers are in. The auto-rug
// watches the game state for the last external trade; a drought longer than the threshold (after a
// minimum wait) sells every wallet at once and sweeps the ETH home. On Solana that was one Jito
// bundle; an EVM has no bundles, so it is one transaction per wallet sent in the same instant, each
// wallet pre-approved so nothing sits between the decision and the sell.
import { EventEmitter } from "node:events";

export const DEFAULT_VOLUME = { minIntervalMs: 800, maxIntervalMs: 4000, escalationRate: 1.08, maxMultiplier: 5.0, buyCapOfAllocation: 0.3, maxSellPct: 0.25 };
export const DEFAULT_AUTO_RUG = { enabled: true, droughtSec: 45, minWaitSec: 60, checkIntervalMs: 5000 };

export class ContinuousVolumeEngine extends EventEmitter {
  constructor(session, executors, config = {}) {
    super();
    this.session = session; this.executors = executors; this.config = { ...DEFAULT_VOLUME, ...config };
    this.rng = session.rng; this.sleep = session.sleep; this.now = session.clock.now; this.log = session.log;
    this.running = false; this.cycle = 0; this.volumeMultiplier = 1.0; this.lastBuyWallet = null; this.lastSellWallet = null;
    this.totalVolumeEth = 0; this.tradeCount = 0; this.startTime = 0;
  }
  async start() {
    if (this.running) return; this.running = true; this.startTime = this.now();
    this.log(`[VOLUME] continuous volume: ${this.config.escalationRate}x per 5 cycles, max ${this.config.maxMultiplier}x`);
    try { await this._loop(); } catch (e) { this.log(`[VOLUME] fatal: ${e.message}`); } finally { this.running = false; }
  }
  stop() { if (this.running) this.log(`[VOLUME] stopped after ${this.tradeCount} trades, ${this.totalVolumeEth.toFixed(5)} ETH`); this.running = false; }
  async _loop() {
    const { fleetWallets, gameState } = this.session;
    while (this.running && this.session.running) {
      const active = fleetWallets.filter(w => w.funded && w.trades.length > 0);
      if (active.length < 2) { await this.sleep(2000); continue; }
      this.cycle++;
      if (this.cycle % 5 === 0 && this.volumeMultiplier < this.config.maxMultiplier) { this.volumeMultiplier = Math.min(this.volumeMultiplier * this.config.escalationRate, this.config.maxMultiplier); this.log(`[VOLUME] cycle ${this.cycle}: ${this.volumeMultiplier.toFixed(2)}x`); }
      if (gameState?.alive) {
        const gs = gameState.refresh();
        if (gs.uniqueBuyers >= 3) this.volumeMultiplier = Math.min(this.volumeMultiplier * 1.15, this.config.maxMultiplier);
        if (gs.signal === "SELL_NOW") { this.log(`[VOLUME] SELL_NOW — pausing volume`); await this.sleep(5000); continue; }
      }
      const burst = 4 + Math.floor(this.rng() * 5);
      await this._burst(active, burst);
      await this.sleep(Math.max(this.config.maxIntervalMs / this.volumeMultiplier + this.rng() * 2000, this.config.minIntervalMs));
    }
  }
  async _burst(active, count) {
    const shuffled = [...active].sort(() => this.rng() - 0.5);
    for (let i = 0; i < count && this.running && this.session.running; i++) {
      const elapsedMin = (this.now() - this.startTime) / 60_000;
      const buyBias = Math.max(0.50, 0.75 - elapsedMin * 0.02);
      try { if (this.rng() < buyBias) await this._buy(shuffled); else await this._sell(shuffled); } catch {}
      await this.sleep(Math.max(400, (this.config.minIntervalMs + this.rng() * 1200) / this.volumeMultiplier));
    }
  }
  async _buy(wallets) {
    const w = wallets.find(x => x !== this.lastBuyWallet) || wallets[0]; this.lastBuyWallet = w;
    const bal = await this.executors.ethBalance(w);
    const pct = 0.02 + this.rng() * 0.04;
    const amount = Math.min(bal * pct * this.volumeMultiplier, w.allocation * this.config.buyCapOfAllocation * this.volumeMultiplier);
    if (amount < this.session.minTrade || bal < amount + this.session.gasReserve) return;
    const r = await this.executors.executeBuy(w, amount);
    if (r?.ok) { this.tradeCount++; this.totalVolumeEth += r.ethIn ?? amount; this.emit("trade", { token: this.session.token, role: w.role, side: "buy", eth: amount, engine: "volume" }); this.log(`[VOL] BUY ${amount.toFixed(5)} ETH [${w.role}] (${this.volumeMultiplier.toFixed(1)}x)`); }
  }
  async _sell(wallets) {
    const w = wallets.find(x => x !== this.lastSellWallet && x.trades.some(t => t.side === "buy")) || wallets[0]; this.lastSellWallet = w;
    const pct = Math.min((0.03 + this.rng() * 0.07) * Math.min(this.volumeMultiplier, 3.0), this.config.maxSellPct);
    const r = await this.executors.executeSell(w, pct);
    if (r?.ok) { this.tradeCount++; this.totalVolumeEth += r.ethOut || 0; this.emit("trade", { token: this.session.token, role: w.role, side: "sell", eth: r.ethOut, engine: "volume" }); this.log(`[VOL] SELL ${(pct * 100).toFixed(0)}% [${w.role}] → ${(r.ethOut || 0).toFixed(5)} ETH (${this.volumeMultiplier.toFixed(1)}x)`); }
  }
  snapshot() { return { running: this.running, cycle: this.cycle, volumeMultiplier: Math.round(this.volumeMultiplier * 100) / 100, tradeCount: this.tradeCount, totalVolumeEth: Math.round(this.totalVolumeEth * 1e5) / 1e5, elapsedSec: Math.round((this.now() - this.startTime) / 1000) }; }
}

export class AutoRugController extends EventEmitter {
  /** executeRug: () => Promise<{ ok, sold, total, masterBalance }> — sells every wallet and sweeps. */
  constructor(session, executeRug, config = {}) {
    super();
    this.session = session; this.executeRug = executeRug; this.config = { ...DEFAULT_AUTO_RUG, ...config };
    this.sleep = session.sleep; this.now = session.clock.now; this.log = session.log; this.rng = session.rng;
    this.running = false; this.triggered = false; this.lastExternalTradeTime = this.now();
  }
  async start() {
    if (!this.config.enabled) { this.log(`[AUTO-RUG] disabled`); return; }
    if (this.running) return; this.running = true; this.lastExternalTradeTime = this.now();
    this.log(`[AUTO-RUG] watching for a drought (threshold ${this.config.droughtSec}s, min wait ${this.config.minWaitSec}s)`);
    try { return await this._monitor(); } catch (e) { this.log(`[AUTO-RUG] error: ${e.message}`); }
  }
  stop() { this.running = false; }
  async _monitor() {
    const start = this.now();
    while (this.running && this.session.running && !this.triggered) {
      await this.sleep(this.config.checkIntervalMs);
      if (this.now() - start < this.config.minWaitSec * 1000) continue;
      const gs = this.session.gameState;
      if (gs?.alive) { const ext = gs.trades.filter(t => !t.isOurs); if (ext.length) this.lastExternalTradeTime = ext[ext.length - 1].time; }
      const drought = this.now() - this.lastExternalTradeTime;
      if (drought >= this.config.droughtSec * 1000) {
        this.log(`[AUTO-RUG] drought: ${(drought / 1000).toFixed(0)}s since the last external trade — every wallet sells now`);
        this.triggered = true; this.emit("drought-detected", { droughtSec: drought / 1000 });
        try { const r = await this.executeRug(); this.emit("rug-complete", r); return r; }
        catch (e) { this.log(`[AUTO-RUG] rug failed: ${e.message}`); this.emit("rug-failed", { error: e.message }); this.session.running = false; }
      } else if (drought > this.config.droughtSec * 500 && this.rng() < 0.2) this.log(`[AUTO-RUG] warning: ${(drought / 1000).toFixed(0)}s since the last external trade`);
    }
  }
  snapshot() { return { enabled: this.config.enabled, running: this.running, triggered: this.triggered, droughtThresholdSec: this.config.droughtSec, timeSinceLastExternal: Math.round((this.now() - this.lastExternalTradeTime) / 1000) }; }
}
export default { ContinuousVolumeEngine, AutoRugController };
