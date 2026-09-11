// ═══ The fleet simulator's venue: a PONS curve in memory, a crowd around it, a clock that jumps ═══
// Same interface the chain venue exposes (launch, buy, sell, transfer, balances, curveInfo, a 'trade'
// stream) so the fleet cannot tell which one it is driving. Every transaction costs gas, takes about
// a block to land, and moves the curve exactly as the contract would. Around the fleet, a crowd of
// synthetic traders arrives at a rate that follows attention (volume, distinct wallets, a rising
// chart) and leaves on profit targets, stop-losses, cascades and dev selling: the opponents the game
// state is supposed to read. Seeded, so a run replays.
import { EventEmitter } from "node:events";
import { CurveModel, CurveError, DEFAULT_ECONOMICS, ethToWei, toEth, toTokens, WAD } from "./curve-model.mjs";
import { VirtualClock, seededRng, gaussian, pick } from "./clock.mjs";

export const GAS_UNITS = Object.freeze({ buy: 165_000n, sell: 135_000n, approve: 46_000n, transfer: 21_000n, launch: 3_600_000n });
export const DEFAULT_GAS_PRICE_WEI = 100_000_000n; // 0.1 gwei: Robinhood Chain is an Arbitrum-stack L2, gas is cents
export const BLOCK_MS = 250;

/** Who shows up, how often, and how they behave. Rates are arrivals per second at attention 1. */
export const SCENARIOS = Object.freeze({
  dead:    { rate: 0,     mix: {}, cascade: 0,   devWatch: 0,   halfLifeMin: 10, label: "nobody comes" },
  quiet:   { rate: 0.004, mix: { retail: 0.6, flipper: 0.35, sniper: 0.05 }, cascade: 0.15, devWatch: 0.3, halfLifeMin: 8, label: "a few retail, thin" },
  organic: { rate: 0.012, mix: { retail: 0.5, flipper: 0.25, sniper: 0.12, whale: 0.05, holder: 0.08 }, cascade: 0.25, devWatch: 0.5, halfLifeMin: 15, label: "a normal launch" },
  hype:    { rate: 0.035, mix: { retail: 0.45, flipper: 0.2, sniper: 0.15, whale: 0.1, holder: 0.1 }, cascade: 0.2, devWatch: 0.4, halfLifeMin: 25, label: "it catches" },
  hostile: { rate: 0.015, mix: { flipper: 0.5, sniper: 0.35, retail: 0.15 }, cascade: 0.6, devWatch: 1.0, halfLifeMin: 6, label: "snipers and flippers only" },
});
// [min, max] ranges per agent type: size in ETH, take-profit and stop-loss as fractions, hold in seconds
const AGENT_TYPES = {
  retail:  { size: [0.003, 0.04],  tp: [0.5, 1.5],  sl: [-0.25, -0.45], hold: [120, 900],  waitTaxBps: 300 },
  flipper: { size: [0.005, 0.03],  tp: [0.08, 0.3], sl: [-0.1, -0.2],   hold: [20, 120],   waitTaxBps: 300 },
  sniper:  { size: [0.03, 0.25],   tp: [0.25, 0.8], sl: [-0.15, -0.3],  hold: [60, 300],   waitTaxBps: 800 },
  whale:   { size: [0.2, 0.8],     tp: [1.0, 3.0],  sl: [-0.4, -0.6],   hold: [600, 3600], waitTaxBps: 100 },
  holder:  { size: [0.01, 0.06],   tp: [3.0, 8.0],  sl: [-0.7, -0.85],  hold: [3600, 7200], waitTaxBps: 300 },
};

const lc = (a) => String(a).toLowerCase();
const range = (rng, [a, b]) => a + rng() * (b - a);

class Crowd {
  constructor(venue, scenario, rng) {
    this.venue = venue; this.s = scenario; this.rng = rng;
    this.agents = []; this.spawned = 0; this.buys = 0; this.sells = 0; this.waiting = [];
    this._lastEval = 0;
  }
  _address() { let h = ""; for (let i = 0; i < 40; i++) h += "0123456789abcdef"[Math.floor(this.rng() * 16)]; return "0x" + h; }
  _type() { const r = this.rng(); let acc = 0; for (const [k, v] of Object.entries(this.s.mix)) { acc += v; if (r < acc) return k; } return "retail"; }
  /** How interesting the token is right now, from what anyone watching the chart can see. */
  attention(now) {
    const v = this.venue, tr = v.trades;
    const last60 = tr.filter(t => now - t.time <= 60_000), last120 = tr.filter(t => now - t.time <= 120_000);
    const vol60 = last60.reduce((s, t) => s + t.quote, 0);
    const uniq = new Set(last120.map(t => t.wallet)).size;
    const spark = v._spark, ref = spark.find(p => now - p.time <= 300_000) || spark[0];
    const rise = ref && ref.mcap > 0 ? Math.max(0, (v.curve.mcapEth() - ref.mcap) / ref.mcap) : 0;
    const sells10 = last60.filter(t => t.kind === "sell" && now - t.time <= 10_000).length;
    const age = now - v.launchedAt;
    const decay = Math.exp(-Math.LN2 * age / (this.s.halfLifeMin * 60_000));
    const a = (0.35 + decay) * (1 + 1.2 * Math.log1p(vol60 / 0.05) + 0.25 * uniq + 1.5 * Math.min(rise, 1)) * (sells10 >= 3 ? 0.4 : 1);
    return a;
  }
  tick(now, dtMs) {
    const v = this.venue; if (!v.curve || v.curve.graduated || this.s.rate === 0) return;
    const att = this.attention(now);
    if (this.rng() < this.s.rate * att * dtMs / 1000) {
      const type = this._type(), spec = AGENT_TYPES[type];
      const agent = { id: this.spawned++, address: this._address(), type, sizeEth: range(this.rng, spec.size), tp: range(this.rng, spec.tp), sl: range(this.rng, spec.sl), holdMs: range(this.rng, spec.hold) * 1000, waitTaxBps: spec.waitTaxBps, tokens: 0n, spentWei: 0n, enteredAt: 0, spawnedAt: now };
      v._mint(agent.address, ethToWei(agent.sizeEth * 1.2));
      this.waiting.push(agent);
    }
    // waiting agents buy once the opening tax is below what they tolerate (nobody donates on purpose)
    for (const a of [...this.waiting]) {
      if (Number(v.curve.snipeTaxBpsFor(a.address, now)) > a.waitTaxBps) continue;
      if (now - a.spawnedAt > 120_000) { this.waiting = this.waiting.filter(x => x !== a); continue; } // lost interest
      this.waiting = this.waiting.filter(x => x !== a);
      const r = v._apply(a, "buy", ethToWei(a.sizeEth), 0n, now);
      if (r.ok) { a.tokens += r.tokensOut; a.spentWei += r.quoteIn; a.enteredAt = now; a.entrySpot = r.spotBefore; this.agents.push(a); this.buys++; }
    }
    if (now - this._lastEval < 1000) return; // holders look at the chart about once a second
    this._lastEval = now;
    const sells10 = v.trades.filter(t => t.kind === "sell" && now - t.time <= 10_000);
    const cascade = new Set(sells10.map(t => t.wallet)).size >= 3;
    const devSold60 = v.trades.filter(t => t.kind === "sell" && t.wallet === v.devWallet && now - t.time <= 60_000).reduce((s, t) => s + t.tokens, 0);
    const devHold = toTokens(v.balanceOfToken(v.devWallet)) + devSold60;
    const devDumping = devHold > 0 && devSold60 / devHold > 0.15;
    const spot = v.curve.spotEth();
    for (const a of [...this.agents]) {
      if (a.tokens === 0n) continue;
      const value = toTokens(a.tokens) * spot * (1 - Number(v.curve.feeBps + v.curve.creatorTaxBps) / 10_000);
      const pnl = value / toEth(a.spentWei) - 1;
      let sell = false, why = "";
      if (pnl >= a.tp) { sell = this.rng() < 0.5; why = "take_profit"; }
      else if (pnl <= a.sl) { sell = this.rng() < 0.6; why = "stop_loss"; }
      else if (now - a.enteredAt > a.holdMs) { sell = this.rng() < 0.3; why = "bored"; }
      if (!sell && cascade && this.rng() < this.s.cascade * 0.5) { sell = true; why = "cascade"; }
      if (!sell && devDumping && this.rng() < this.s.devWatch * 0.5) { sell = true; why = "dev_selling"; }
      if (!sell) continue;
      const r = v._apply(a, "sell", a.tokens, 0n, now, why);
      if (r.ok) { a.tokens = 0n; this.sells++; this.agents = this.agents.filter(x => x !== a); }
    }
  }
}

export class SimVenue extends EventEmitter {
  /**
   * @param opts { seed, scenario: name|object, economics, gasPriceWei, ethPriceUsd, latencyMs, startMs }
   */
  constructor(opts = {}) {
    super();
    this.name = "sim"; this.chainId = 0; this.explorer = null; this.mode = "sim";
    this.rng = seededRng(opts.seed ?? 1);
    this.clock = new VirtualClock(opts.startMs ?? 1_800_000_000_000);
    this.genesis = this.clock.now();
    this.economics = { ...DEFAULT_ECONOMICS, ...(opts.economics || {}) };
    this.gasPriceWei = BigInt(opts.gasPriceWei ?? DEFAULT_GAS_PRICE_WEI);
    this.ethPriceUsd = opts.ethPriceUsd ?? 4000;
    this.latencyMs = opts.latencyMs ?? 350;
    this.scenario = typeof opts.scenario === "string" ? { name: opts.scenario, ...SCENARIOS[opts.scenario] } : { name: "custom", ...SCENARIOS.organic, ...(opts.scenario || {}) };
    if (!this.scenario.mix) throw new Error(`unknown scenario ${opts.scenario}; one of ${Object.keys(SCENARIOS).join(", ")}`);
    this.balances = new Map(); this.tokenBalances = new Map(); this.approved = new Set();
    this.minted = 0n; this.gasBurned = 0n; this.launchFeePaid = 0n;
    this.curve = null; this.token = null; this.curveAddress = null; this.devWallet = null; this.launchedAt = 0;
    this.trades = []; this._spark = []; this._txn = 0; this._wallets = 0;
    this.crowd = new Crowd(this, this.scenario, this.rng);
    this.running = false; this.errors = [];
  }
  async init() { return { chainId: this.chainId, name: this.name, scenario: this.scenario.name }; }
  now() { return this.clock.now(); }
  sleep(ms) { return this.clock.sleep(ms); }
  block() { return Math.floor((this.now() - this.genesis) / BLOCK_MS); }
  createWallet() { let h = ""; for (let i = 0; i < 40; i++) h += "0123456789abcdef"[Math.floor(this.rng() * 16)]; const address = "0x" + h; this._wallets++; return { address, privateKey: null, sim: true }; }
  _mint(address, wei) { this.balances.set(lc(address), (this.balances.get(lc(address)) || 0n) + wei); this.minted += wei; }
  /** Sim only: give the master wallet its budget. */
  faucet(address, eth) { this._mint(address, ethToWei(eth)); }
  balanceOf(address) { return this.balances.get(lc(address)) || 0n; }
  balanceOfToken(address) { return this.tokenBalances.get(lc(address)) || 0n; }
  async ethBalance(address) { return this.balanceOf(address); }
  async tokenBalance(address) { return this.balanceOfToken(address); }
  gasWei(kind) { return GAS_UNITS[kind] * this.gasPriceWei; }
  gasEth(kind) { return toEth(this.gasWei(kind)); }
  _burn(address, kind) { const g = this.gasWei(kind); const b = this.balanceOf(address); if (b < g) throw new CurveError("InsufficientGas", `${address.slice(0, 8)} needs ${toEth(g)} for gas`); this.balances.set(lc(address), b - g); this.gasBurned += g; return g; }
  _hash() { this._txn++; return "0xsim" + this._txn.toString(16).padStart(60, "0"); }

  /** The crowd acts as time passes. Runs as a waiter on the same virtual clock as everything else. */
  async start() {
    if (this.running) return; this.running = true;
    (async () => { let last = this.now(); while (this.running) { await this.sleep(BLOCK_MS); const now = this.now(); try { this.crowd.tick(now, now - last); } catch (e) { this.errors.push(e.message); } last = now; if (this._spark.length === 0 || now - this._spark[this._spark.length - 1].time >= 1000) { if (this.curve) { this._spark.push({ time: now, mcap: this.curve.mcapEth() }); if (this._spark.length > 4000) this._spark.shift(); } } } })();
  }
  async stop() { this.running = false; }

  async sweepReserveWei() { return this.gasWei("transfer"); }
  /** Everything minus the transfer's own gas: the same call the chain venue answers. */
  async sweepAll(from, to) { const bal = this.balanceOf(from.address); const reserve = this.gasWei("transfer"); if (bal <= reserve) return { ok: false, error: "dust", swept: 0n }; const r = await this.transfer(from, to, bal - reserve); return { ...r, swept: r.ok ? bal - reserve : 0n }; }
  async transfer(from, to, wei) {
    wei = BigInt(wei);
    try {
      const g = this._burn(from.address, "transfer");
      const b = this.balanceOf(from.address);
      if (b < wei) { this.balances.set(lc(from.address), b + g); this.gasBurned -= g; return { ok: false, error: `insufficient balance: ${toEth(b)} < ${toEth(wei)}` }; }
      this.balances.set(lc(from.address), b - wei); this.balances.set(lc(to), this.balanceOf(to) + wei);
      await this.sleep(this.latencyMs);
      return { ok: true, hash: this._hash(), gasWei: g };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  /** launchToken(params, configId, ETH, exemptions) with msg.value = launchFee, then the dev buy. */
  async launch({ from, params = {}, exemptions = [], devBuyWei = 0n }) {
    if (this.curve) return { ok: false, error: "the simulator holds one launch per venue" };
    devBuyWei = BigInt(devBuyWei);
    const fee = BigInt(this.economics.launchFee);
    try {
      const g = this._burn(from.address, "launch");
      const b = this.balanceOf(from.address);
      if (b < fee + devBuyWei) return { ok: false, error: `launch needs ${toEth(fee + devBuyWei)} ETH plus gas, wallet has ${toEth(b)}` };
      this.balances.set(lc(from.address), b - fee); this.launchFeePaid += fee;
      await this.sleep(this.latencyMs);
      const now = this.now();
      this.curve = new CurveModel({ ...this.economics, creatorTaxBps: params.creatorTaxBps ?? this.economics.creatorTaxBps }, { launchedAtMs: now, deployer: from.address, creatorFeeRecipient: params.creatorFeeRecipient || from.address, exemptions });
      this.token = this.createWallet().address; this.curveAddress = this.createWallet().address; this.devWallet = lc(from.address); this.launchedAt = now;
      this.tokenParams = { name: params.name || "Sim", symbol: params.symbol || "SIM", ...params };
      this._spark.push({ time: now, mcap: this.curve.mcapEth() });
      const launchHash = this._hash();
      let devBuy = null;
      if (devBuyWei > 0n) { const r = await this.buy(from, devBuyWei, { slippagePct: 100 }); if (!r.ok) return { ok: false, error: `launched but the dev buy failed: ${r.error}`, token: this.token, curve: this.curveAddress }; devBuy = r; }
      this.emit("launch", { token: this.token, curve: this.curveAddress, deployer: this.devWallet, block: this.block(), tx: launchHash });
      return { ok: true, token: this.token, curve: this.curveAddress, hash: launchHash, launchFeeWei: fee, gasWei: g, devBuy, launchedAt: now };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  /** Ape mode against a launch that already exists: in the sim, only the one this venue launched. */
  async attach(token) { if (!this.curve || lc(token) !== lc(this.token)) return { ok: false, error: "unknown token in this simulator; launch first" }; return { ok: true, token: this.token, curve: this.curveAddress, deployer: this.devWallet, graduated: this.curve.graduated, launchedAt: this.launchedAt }; }

  async quoteBuy(wei, wallet) { try { const q = this.curve.quoteBuy(BigInt(wei), wallet?.address || wallet || "0x0", this.now()); return { ok: true, tokensOut: toTokens(q.tokensOut), spent: toEth(q.spent), fee: toEth(q.fee + q.tax), snipeTaxBps: Number(q.snipeBps), spot: q.spotBefore }; } catch (e) { return { ok: false, error: e.message }; } }
  async quoteSell(units) { try { const q = this.curve.quoteSell(BigInt(units)); return { ok: true, quoteOut: toEth(q.quoteOut), fee: toEth(q.fee + q.tax), spot: q.spotBefore }; } catch (e) { return { ok: false, error: e.message }; } }

  /** One transaction against the curve, from a fleet wallet or a crowd agent. */
  _apply(wallet, kind, amount, minOut, now, why = "") {
    const address = lc(wallet.address);
    try {
      if (kind === "buy") {
        const b = this.balanceOf(address); const g = this.gasWei("buy");
        if (b < amount + g) return { ok: false, error: `insufficient balance: ${toEth(b)} ETH for ${toEth(amount)} + gas` };
        const q = this.curve.quoteBuy(amount, address, now);
        const rec = this.curve.buy(amount, minOut, address, now);
        this.balances.set(address, b - g - rec.quoteIn); this.gasBurned += g;
        this.tokenBalances.set(address, this.balanceOfToken(address) + rec.tokensOut);
        const t = { time: now, kind: "buy", wallet: address, quote: toEth(rec.quoteIn), tokens: toTokens(rec.tokensOut), fee: toEth(rec.fee), tax: toEth(rec.tax), snipe: toEth(rec.snipe), tx: this._hash(), block: this.block(), quoteWei: rec.quoteIn, tokenUnits: rec.tokensOut, why, agent: wallet.type || null };
        this._record(t);
        return { ok: true, hash: t.tx, tokensOut: rec.tokensOut, quoteIn: rec.quoteIn, fee: rec.fee, tax: rec.tax, snipe: rec.snipe, refund: rec.refund, gasWei: g, spotBefore: q.spotBefore, graduated: rec.graduated, block: t.block };
      }
      const held = this.balanceOfToken(address);
      if (held < amount) return { ok: false, error: `insufficient tokens: ${toTokens(held)} < ${toTokens(amount)}` };
      let g = this.gasWei("sell");
      if (!this.approved.has(address)) { g += this.gasWei("approve"); }
      const b = this.balanceOf(address);
      if (b < g) return { ok: false, error: `insufficient balance for gas: ${toEth(b)}` };
      const q = this.curve.quoteSell(amount);
      const rec = this.curve.sell(amount, minOut, address);
      this.approved.add(address);
      this.balances.set(address, b - g + rec.quoteOut); this.gasBurned += g;
      this.tokenBalances.set(address, held - amount);
      const t = { time: now, kind: "sell", wallet: address, quote: toEth(rec.quoteOut), tokens: toTokens(rec.tokensIn), fee: toEth(rec.fee), tax: toEth(rec.tax), tx: this._hash(), block: this.block(), quoteWei: rec.quoteOut, tokenUnits: rec.tokensIn, why, agent: wallet.type || null };
      this._record(t);
      return { ok: true, hash: t.tx, quoteOut: rec.quoteOut, tokensIn: rec.tokensIn, fee: rec.fee, tax: rec.tax, gasWei: g, spotBefore: q.spotBefore, block: t.block };
    } catch (e) { return { ok: false, error: e.message, revert: e instanceof CurveError ? e.name : null }; }
  }
  _record(t) { this.trades.push(t); if (this.trades.length > 5000) this.trades = this.trades.slice(-4000); this.emit("trade", t); }

  /** buy(wallet, quoteWei, { slippagePct }): minTokensOut from the quote now, then the block's latency. */
  async buy(wallet, quoteWei, { slippagePct = 15 } = {}) {
    if (!this.curve) return { ok: false, error: "no launch yet" };
    quoteWei = BigInt(quoteWei);
    const q = await this.quoteBuy(quoteWei, wallet); if (!q.ok) return q;
    const minOut = BigInt(Math.floor(q.tokensOut * (1 - slippagePct / 100) * 1e6)) * 10n ** 12n;
    await this.sleep(gaussian(this.rng, this.latencyMs, this.latencyMs / 4));
    return this._apply(wallet, "buy", quoteWei, minOut, this.now());
  }
  async sell(wallet, tokenUnits, { slippagePct = 15 } = {}) {
    if (!this.curve) return { ok: false, error: "no launch yet" };
    tokenUnits = BigInt(tokenUnits);
    const q = await this.quoteSell(tokenUnits); if (!q.ok) return q;
    const minOut = ethToWei(q.quoteOut * (1 - slippagePct / 100));
    await this.sleep(gaussian(this.rng, this.latencyMs, this.latencyMs / 4));
    return this._apply(wallet, "sell", tokenUnits, minOut, this.now());
  }
  async curveInfo() { return this.curve ? { ...this.curve.info(), address: this.curveAddress, token: this.token, launchedAt: this.launchedAt, snipeTaxStartBps: Number(this.curve.snipeTaxStartBps), snipeTaxSeconds: this.curve.snipeTaxSeconds } : null; }
  async launchTerms() { return { launchFeeWei: BigInt(this.economics.launchFee), snipeTaxStartBps: Number(this.economics.snipeTaxStartBps), snipeTaxSeconds: Number(this.economics.snipeTaxSeconds), phantomQuote: toEth(this.economics.phantomQuote), graduationThreshold: toEth(this.economics.graduationThreshold), curveFeeBps: Number(this.economics.curveFeeBps), supply: toTokens(this.economics.supply), canLaunch: true }; }

  /** Every wei minted is somewhere: wallets, the curve, fees paid out, gas. The tests hold this. */
  conservation() {
    let wallets = 0n; for (const v of this.balances.values()) wallets += v;
    const curveHeld = this.curve ? this.curve.trackedQuote : 0n;
    const swept = this.curve ? (this.curve.feesSwept || 0n) : 0n;
    const snipe = this.curve ? (this.curve.snipeTaxPaid || 0n) : 0n;
    const accounted = wallets + curveHeld + this.launchFeePaid + this.gasBurned + snipe + swept;
    return { minted: this.minted, wallets, curveHeld, launchFee: this.launchFeePaid, gas: this.gasBurned, snipeTax: snipe, feesSwept: swept, accounted, diff: this.minted - accounted };
  }
  stats() {
    const ext = this.trades.filter(t => t.agent);
    return { trades: this.trades.length, external: { buys: ext.filter(t => t.kind === "buy").length, sells: ext.filter(t => t.kind === "sell").length, wallets: new Set(ext.map(t => t.wallet)).size, volumeEth: +ext.reduce((s, t) => s + t.quote, 0).toFixed(4), spawned: this.crowd.spawned, holding: this.crowd.agents.filter(a => a.tokens > 0n).length }, peakMcapEth: +Math.max(0, ...this._spark.map(p => p.mcap)).toFixed(4), mcapEth: this.curve ? +this.curve.mcapEth().toFixed(4) : 0, progress: this.curve ? +this.curve.progress().toFixed(4) : 0, graduated: !!this.curve?.graduated, gasBurnedEth: +toEth(this.gasBurned).toFixed(6), errors: this.errors.length };
  }
}
