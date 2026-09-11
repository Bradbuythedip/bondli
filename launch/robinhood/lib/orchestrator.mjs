// ═══ LaunchOrchestrator: the post-launch playbook, ported from engine/launch-orchestrator.mjs ═══
// Sits between the opening-window entry and the volume engine.
//   T+3-8s    the dev sells ~25% into the snipers: the "dev taking profit" candle. A chart with only
//             green candles is a red flag; this is the first dip, and dip buyers are the flywheel.
//   T+10-30s  cascading buy waves from fleet wallets, staggered, random sizes, each wave a bit bigger
//   T+30-60s  mixed buys and sells between fleet wallets: green and red candles, micro-dips
//   then      hand off to ContinuousVolumeEngine
// Throughout, the count of external buyers sets an activity multiplier: 3+ externals and the fleet
// cools to 30% (they make the volume); none for 30 s and it runs at 150% (we are the market).
import { EventEmitter } from "node:events";

export const DEFAULT_ORCHESTRATION = {
  devSellPct: 0.25, devSellChunks: 3, devSellDelayMs: 3000, devSellGapMs: 2500,
  cascadeWaves: 4, cascadeDelayMs: 8000, cascadeWaveGapMs: 6000, cascadeWalletStagger: 800, cascadeBuyPct: 0.12,
  mixedStartMs: 30_000, mixedDurationMs: 30_000, mixedBuyBias: 0.65, mixedTradeGapMs: 1500, mixedSellPct: 0.08,
  coolOffThreshold: 3, coolOffMultiplier: 0.3, intensifyThreshold: 0, intensifyMultiplier: 1.5,
};

export class LaunchOrchestrator extends EventEmitter {
  constructor(session, executors, config = {}) {
    super();
    this.session = session; this.executors = executors; this.config = { ...DEFAULT_ORCHESTRATION, ...config };
    this.rng = session.rng; this.sleep = session.sleep; this.now = session.clock.now; this.log = session.log;
    this.running = false; this.externalBuyers = 0; this.externalBuyCount = 0; this.externalSellCount = 0; this.lastExternalBuyTime = 0;
    this.stats = { devSellCount: 0, devSellEth: 0, cascadeBuyCount: 0, cascadeBuyEth: 0, mixedBuyCount: 0, mixedSellCount: 0, mixedBuyEth: 0, mixedSellEth: 0, externalBuyersTotal: 0, phaseTimings: {} };
  }
  _jitter(base, variance) { return base + (this.rng() - 0.5) * 2 * variance; }
  _pick(arr) { return arr[Math.floor(this.rng() * arr.length)]; }

  async run() {
    if (this.running) return; this.running = true;
    const t0 = this.now(); const { session } = this;
    this.log(`[ORCHESTRATOR] post-launch sequence for ${String(session.token).slice(0, 10)}`);
    this.emit("phase", { phase: "dev_sell", token: session.token });
    this._trackExternals();
    try {
      await this._devSellIntoSnipers(); this.stats.phaseTimings.devSell = this.now() - t0;
      if (!this.running || !session.running) return;
      this.emit("phase", { phase: "cascade_buys", token: session.token });
      await this._cascadeBuyWaves(); this.stats.phaseTimings.cascade = this.now() - t0;
      if (!this.running || !session.running) return;
      this.emit("phase", { phase: "mixed_volume", token: session.token });
      await this._mixedVolumePhase(); this.stats.phaseTimings.mixed = this.now() - t0;
    } catch (e) { this.log(`[ORCHESTRATOR] error: ${e.message}`); }
    this.emit("phase", { phase: "handoff", token: session.token });
    this.log(`[ORCHESTRATOR] complete in ${((this.now() - t0) / 1000).toFixed(1)}s | ${JSON.stringify(this.getStats())}`);
    this.running = false;
  }
  stop() { this.running = false; }

  /** Stage 1: the dev sells a quarter into the snipers, in chunks, never one dump. */
  async _devSellIntoSnipers() {
    const { session, config, executors } = this;
    const dev = session.devWallet || session.fleetWallets.find(w => w.role === "dev" || w.role === "early1") || session.fleetWallets[0];
    if (!dev) return;
    await this.sleep(config.devSellDelayMs + this.rng() * 2000);
    if (!this.running) return;
    const devBuy = dev.ethSpent || 0, budget = session.budgetEth || 1;
    // proportional: a dev buy above a fifth of the budget sells up to 35%, a small one sells less
    const pct = devBuy > budget * 0.2 ? Math.min(config.devSellPct * 1.2, 0.35) : devBuy > budget * 0.06 ? config.devSellPct : config.devSellPct * 0.8;
    this.log(`[ORCHESTRATOR] dev sell ${(pct * 100).toFixed(0)}% in ${config.devSellChunks} chunks`);
    const chunk = pct / config.devSellChunks;
    for (let i = 0; i < config.devSellChunks && this.running && session.running; i++) {
      const thisPct = chunk * this._jitter(1.0, 0.2);
      try { const r = await executors.executeSell(dev, thisPct); if (r?.ok) { this.stats.devSellCount++; this.stats.devSellEth += r.ethOut || 0; this.emit("trade", { token: session.token, role: dev.role, side: "sell", eth: r.ethOut, pct: thisPct, stage: "dev_sell" }); this.log(`[ORCHESTRATOR] dev sell ${i + 1}/${config.devSellChunks}: ${(thisPct * 100).toFixed(1)}% → ${(r.ethOut || 0).toFixed(5)} ETH`); } }
      catch (e) { this.log(`[ORCHESTRATOR] dev sell chunk ${i + 1} failed: ${e.message}`); }
      if (i < config.devSellChunks - 1) await this.sleep(this._jitter(config.devSellGapMs, config.devSellGapMs * 0.3));
    }
  }

  /** Stage 2: staggered buys that look like organic discovery, each wave a little bigger. */
  async _cascadeBuyWaves() {
    const { session, config, executors } = this;
    const buyable = session.fleetWallets.filter(w => w.funded && w.role !== "dev");
    if (!buyable.length) return;
    await this.sleep(config.cascadeDelayMs + this.rng() * 3000);
    for (let wave = 0; wave < config.cascadeWaves && this.running && session.running; wave++) {
      const mult = this._activityMultiplier();
      const shuffled = [...buyable].sort(() => this.rng() - 0.5);
      const waveWallets = shuffled.slice(0, Math.min(1 + Math.floor(this.rng() * 2), shuffled.length));
      const waveSize = 1 + wave * 0.15;
      this.log(`[ORCHESTRATOR] cascade wave ${wave + 1}/${config.cascadeWaves}: ${waveWallets.length} wallets (${mult.toFixed(1)}x)`);
      for (const w of waveWallets) {
        if (!this.running || !session.running) return;
        const amount = w.allocation * config.cascadeBuyPct * waveSize * mult * this._jitter(1.0, 0.25);
        if (amount < session.minTrade) continue;
        try { const r = await executors.executeBuy(w, amount); if (r?.ok) { this.stats.cascadeBuyCount++; this.stats.cascadeBuyEth += r.ethIn ?? amount; this.emit("trade", { token: session.token, role: w.role, side: "buy", eth: amount, stage: "cascade", wave }); } }
        catch (e) { this.log(`[ORCHESTRATOR] cascade buy [${w.role}] failed: ${e.message}`); }
        await this.sleep(this._jitter(config.cascadeWalletStagger, 400));
      }
      if (wave < config.cascadeWaves - 1) await this.sleep(this._jitter(config.cascadeWaveGapMs, config.cascadeWaveGapMs * 0.3));
    }
  }

  /** Stage 3: green and red candles between fleet wallets. */
  async _mixedVolumePhase() {
    const { session, config, executors } = this;
    const active = session.fleetWallets.filter(w => w.funded);
    if (active.length < 2) return;
    await this.sleep(Math.max(0, config.mixedStartMs - (this.now() - session.startTime)));
    const end = this.now() + config.mixedDurationMs;
    while (this.now() < end && this.running && session.running) {
      const mult = this._activityMultiplier(); const doBuy = this.rng() < config.mixedBuyBias; const w = this._pick(active);
      try {
        if (doBuy) { const amt = w.allocation * this._jitter(0.06, 0.03) * mult; if (amt >= session.minTrade) { const r = await executors.executeBuy(w, amt); if (r?.ok) { this.stats.mixedBuyCount++; this.stats.mixedBuyEth += r.ethIn ?? amt; this.emit("trade", { token: session.token, role: w.role, side: "buy", eth: amt, stage: "mixed" }); } } }
        else { const pct = config.mixedSellPct * mult * this._jitter(1.0, 0.3); const r = await executors.executeSell(w, pct); if (r?.ok) { this.stats.mixedSellCount++; this.stats.mixedSellEth += r.ethOut || 0; this.emit("trade", { token: session.token, role: w.role, side: "sell", eth: r.ethOut, stage: "mixed" }); } }
      } catch {}
      await this.sleep(Math.max(500, this._jitter(config.mixedTradeGapMs, config.mixedTradeGapMs * 0.4) / mult));
    }
  }

  /** Poll the game state every 3 s for new external buyers; runs beside the stages on the session clock. */
  _trackExternals() {
    const gs = this.session.gameState; if (!gs) return;
    (async () => {
      while (this.running && this.session.running) {
        await this.sleep(3000);
        try {
          const snap = gs.snapshot ? gs.snapshot() : gs;
          const n = snap.uniqueBuyers || 0;
          if (n > this.externalBuyers) { const delta = n - this.externalBuyers; this.externalBuyers = n; this.stats.externalBuyersTotal = Math.max(this.stats.externalBuyersTotal, n); this.lastExternalBuyTime = this.now(); this.log(`[ORCHESTRATOR] +${delta} external buyer(s) (total ${n})`); this.emit("external_buyer", { count: n, delta }); }
          this.externalBuyCount = snap.externalBuys || 0; this.externalSellCount = snap.externalSells || 0;
        } catch {}
      }
    })();
  }
  _activityMultiplier() {
    const { coolOffThreshold, coolOffMultiplier, intensifyThreshold, intensifyMultiplier } = this.config;
    if (this.externalBuyers >= coolOffThreshold) return coolOffMultiplier;
    if (this.externalBuyers <= intensifyThreshold && this.now() - this.lastExternalBuyTime > 30_000) return intensifyMultiplier;
    return 1.0;
  }
  getStats() { return { ...this.stats, externalBuyers: this.externalBuyers, running: this.running, activityMultiplier: this._activityMultiplier() }; }
}
export default LaunchOrchestrator;
