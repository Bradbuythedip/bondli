// ═══ FleetTrader for Robinhood Chain: engine/fleet-trader.mjs, re-homed on a PONS curve ═══
// What changed from pump.fun, and what did not:
//   - The same-block entry was a Jito bundle. Here the launch declares the fleet wallets as snipe-tax
//     exemptions (PonsV2LaunchFactory allows 32), so they buy in the opening seconds at the untaxed
//     price while every undeclared sniper pays a tax that starts at 99%. Nothing needs to be atomic.
//   - Wallets are EVM keypairs funded by a master wallet with ETH; sweeps go back to it minus gas.
//   - The atomic auto-rug is one sell per wallet, all sent together, allowances set at funding time.
//   - GameState reads CurveBuy / CurveSell logs (the venue's trade stream), not PumpPortal.
//   - Everything else — roles, Kelly-sized ape entry, the orchestrated dev sell and cascades, the
//     escalating volume engine, the drought auto-rug, the mimicry dev sells, the GameState-adjusted
//     sell loop, the profit skim — is the same logic on a venue interface, so the simulator and the
//     chain run identical code.
import { EventEmitter } from "node:events";
import { GameState } from "./game-state.mjs";
import { DevSellController } from "./dev-sell.mjs";
import { LaunchOrchestrator } from "./orchestrator.mjs";
import { ContinuousVolumeEngine, AutoRugController } from "./volume-engine.mjs";
import { ethToWei, toEth, toTokens } from "./curve-model.mjs";
import { seededRng } from "./clock.mjs";

// Roles for CREATE mode: weights split the fleet budget; sellPct/sellRounds shape the fallback exit.
export const ROLES = [
  { id: "early1", weight: 0.18, buyDelay: 0.3, sellDelay: 0, sellPct: 0.60, sellRounds: 3, phase: "early" },
  { id: "early2", weight: 0.15, buyDelay: 0.9, sellDelay: 0, sellPct: 0.55, sellRounds: 3, phase: "early" },
  { id: "mid1",   weight: 0.20, buyDelay: 1.6, sellDelay: 0, sellPct: 0.50, sellRounds: 3, phase: "mid" },
  { id: "mid2",   weight: 0.17, buyDelay: 2.4, sellDelay: 0, sellPct: 0.50, sellRounds: 2, phase: "mid" },
  { id: "late1",  weight: 0.16, buyDelay: 3.5, sellDelay: 0, sellPct: 0.55, sellRounds: 3, phase: "late" },
  { id: "late2",  weight: 0.14, buyDelay: 5.0, sellDelay: 0, sellPct: 0.65, sellRounds: 2, phase: "late" },
];

export const DEFAULT_FLEET_CONFIG = {
  slippagePct: 15, durationMin: 60, radarScore: 50, devBuyShare: 0.10, entryShare: 0.88, apeEntryShare: 0.92,
  minFleetBudgetEth: 0.01, minTradeEth: 0.0005, gasTxsPerWallet: 60, txCostEth: 0, // txCostEth 0 = read from the venue
  volume: {}, autoRug: {}, orchestration: {}, profitConfig: null,
  // the fallback sell loop's profit guard: a curve fee of 1% each side plus creator tax; the
  // platform's cut (profitConfig.cutPercent) is taken at the sweep
  minNetProfitEth: 0.0005,
};

const lc = (a) => String(a || "").toLowerCase();

export class FleetTrader extends EventEmitter {
  /** @param venue SimVenue | ChainVenue  @param opts { log, rng, config } */
  constructor(venue, { log = null, rng = null, config = {} } = {}) {
    super();
    this.venue = venue; this.log = log || ((...a) => console.log(...a)); this.rng = rng || venue.rng || seededRng(Date.now());
    this.config = { ...DEFAULT_FLEET_CONFIG, ...config };
    this.sessions = new Map();
  }
  get clock() { return { now: () => this.venue.now(), sleep: (ms) => this.venue.sleep(ms) }; }

  /**
   * Start a session. mode "create" launches a token with the fleet declared exempt, then runs the
   * CREATE playbook; mode "ape" buys an existing token with a Kelly-sized fleet.
   * @param opts { master: { address, privateKey }, budgetEth, mode, token, tokenParams, devBuyEth, fleetConfig, onWallets, sessionId }
   */
  async launch(opts) {
    const cfg = { ...this.config, ...(opts.fleetConfig || {}) };
    const mode = opts.mode || (opts.token ? "ape" : "create");
    const budgetEth = Number(opts.budgetEth);
    if (!(budgetEth > 0)) return { ok: false, error: "budgetEth must be positive" };
    const master = opts.master; if (!master?.address) return { ok: false, error: "no master wallet" };
    const venue = this.venue; const log = this.log; const rng = this.rng;
    // What a send actually costs the wallet: gasLimit × the fee the venue will send with, not the
    // cached gas price times a typical gasUsed. A wallet funded on the smaller number cannot pay for
    // its own sell when the rug comes, and the node refuses the transaction before it is mined.
    const sellCost = venue.sendCostEth ? await venue.sendCostEth("sell") : (venue.gasEth?.("sell") || 0.00002);
    const txCost = cfg.txCostEth || (venue.sendCostEth ? await venue.sendCostEth("buy") : venue.gasEth?.("buy")) || 0.00002;
    const gasBuffer = Math.max(0.0003, txCost * cfg.gasTxsPerWallet, sellCost * 3);
    const masterBal = toEth(await venue.ethBalance(master.address));
    const terms = mode === "create" ? await venue.launchTerms() : null;
    const launchFee = terms ? toEth(terms.launchFeeWei) : 0;
    const devBuyEth = mode === "create" ? (opts.devBuyEth ?? +(budgetEth * cfg.devBuyShare).toFixed(6)) : 0;
    const reserve = launchFee + devBuyEth + gasBuffer * 2;
    if (masterBal < budgetEth) return { ok: false, error: `master has ${masterBal.toFixed(5)} ETH, budget is ${budgetEth}` };
    if (budgetEth <= reserve) return { ok: false, error: `budget ${budgetEth} does not cover launch fee ${launchFee} + dev buy ${devBuyEth} + gas ${(gasBuffer * 2).toFixed(5)}` };
    const fleetBudget = budgetEth - reserve;
    const useFleet = fleetBudget >= cfg.minFleetBudgetEth;
    const conviction = cfg.radarScore || 50;
    const fleetWallets = [];
    let walletConfigs;
    if (useFleet) {
      if (mode === "ape") {
        // Kelly: bet proportional to the edge. High conviction → more wallets, even split; low → a scout carries 40%.
        let count = conviction >= 80 ? Math.min(7, Math.max(3, Math.floor(fleetBudget / (cfg.minFleetBudgetEth * 1.5)))) : conviction >= 55 ? Math.min(4, Math.max(2, Math.floor(fleetBudget / (cfg.minFleetBudgetEth * 2)))) : Math.min(2, Math.max(1, Math.floor(fleetBudget / (cfg.minFleetBudgetEth * 2.5))));
        count = Math.min(count, 7);
        walletConfigs = [];
        for (let i = 0; i < count; i++) {
          const isScout = i === 0; const k = conviction / 100; const even = 1 / count; const front = isScout ? 0.4 : 0.6 / Math.max(1, count - 1);
          walletConfigs.push({ id: `ape${i + 1}`, weight: k * even + (1 - k) * front, buyDelay: Math.round(1 + i * (conviction >= 80 ? 1.5 : conviction >= 55 ? 2.5 : 4)), sellDelay: Math.round(conviction >= 80 ? 20 + i * 15 : conviction >= 55 ? 15 + i * 12 : 10 + i * 8), sellPct: conviction >= 80 ? 0.85 : conviction >= 55 ? 0.80 : 0.90, sellRounds: conviction >= 80 ? 3 : 2, phase: isScout ? "scout" : "fleet" });
        }
        log(`[FLEET] APE conviction ${conviction} → ${count} wallets (Kelly-sized)`);
      } else {
        walletConfigs = fleetBudget < cfg.minFleetBudgetEth * 3 ? ROLES.filter(r => ["early1", "mid1", "late1"].includes(r.id)) : fleetBudget < cfg.minFleetBudgetEth * 8 ? ROLES.filter(r => r.id !== "late2") : ROLES;
      }
      const totalWeight = walletConfigs.reduce((s, r) => s + r.weight, 0);
      for (const role of walletConfigs) {
        const wallet = venue.createWallet();
        fleetWallets.push({ address: lc(wallet.address), wallet, role: role.id, roleConfig: { ...role }, tokenShare: role.weight / totalWeight, allocation: +((role.weight / totalWeight) * fleetBudget).toFixed(8), funded: false, ethSpent: 0, ethRecovered: 0, gasEth: 0, trades: [] });
      }
    } else {
      fleetWallets.push({ address: lc(master.address), wallet: master, role: "solo", roleConfig: { id: "solo", buyDelay: 0, sellDelay: 15, sellPct: 0.90, sellRounds: 3, phase: "solo" }, tokenShare: 1, allocation: fleetBudget, funded: true, ethSpent: 0, ethRecovered: 0, gasEth: 0, trades: [] });
    }
    const devWallet = { address: lc(master.address), wallet: master, role: "dev", allocation: devBuyEth, funded: true, ethSpent: 0, ethRecovered: 0, gasEth: 0, trades: [] };
    const walletKeys = fleetWallets.map(w => ({ role: w.role, address: w.address, privateKey: w.wallet.privateKey || null, allocation: w.allocation, tokenShare: w.tokenShare }));
    if (opts.onWallets) await opts.onWallets(walletKeys); // persist before a single wei moves: never lose user funds

    const session = {
      id: opts.sessionId || `fleet-${Date.now().toString(36)}`, mode, token: opts.token || null, tokenParams: opts.tokenParams || null, curve: null, master, devWallet, fleetWallets, budgetEth, fleetBudget, devBuyEth, launchFee, gasBuffer,
      fleetConfig: cfg, config: cfg, minTrade: cfg.minTradeEth, gasReserve: Math.max(0.0001, txCost * 2, sellCost * 2), sellCost, startTime: venue.now(), launchedAt: 0, phase: "starting", running: true, tradeCount: 0, totalEthSpent: 0, totalEthRecovered: 0, feesEth: 0, gasEth: 0,
      _profitConfig: cfg.profitConfig, _isApe: mode === "ape", rng, clock: this.clock, sleep: (ms) => venue.sleep(ms), log, venue, masterStartEth: masterBal, exitReason: null, walletKeys, events: [],
    };
    const key = session.token || session.id;
    this.sessions.set(key, session);
    session.gameState = new GameState({ token: key, ourWallets: [master.address, ...fleetWallets.map(w => w.address)], devWallet: master.address, clock: this.clock, whaleEth: cfg.whaleEth ?? 0.05, log: (m) => log(m) });
    // the duration limit is a loop that ends with the session, never a timer that outlives it (a real
    // one-hour setTimeout would hold the process open long after a rug)
    if (cfg.durationMin > 0) (async () => { const deadline = venue.now() + cfg.durationMin * 60_000; while (session.running && venue.now() < deadline) await venue.sleep(Math.min(5000, Math.max(50, deadline - venue.now()))); if (session.running) { session.running = false; session.phase = "duration_complete"; session.exitReason ||= "duration"; } })();
    session._run = this._run(session).catch(e => { log(`[FLEET] fatal: ${e.message}`); session.running = false; session.phase = "error"; session.error = e.message; });
    return { ok: true, sessionId: session.id, mode, wallets: fleetWallets.length, walletKeys, session };
  }

  /** Wait for the session's strategy loop to finish (the simulator and the tests use this). */
  async wait(session) { await session._run; return session; }

  async _fundWallets(session) {
    const { venue, master, fleetWallets, gasBuffer, log } = session;
    for (const w of fleetWallets) {
      if (w.address === lc(master.address)) { w.funded = true; continue; }
      const amount = w.allocation + gasBuffer;
      const r = await venue.transfer(master, w.address, ethToWei(amount));
      if (r.ok) { w.funded = true; w.fundedEth = amount; log(`[FLEET] [${w.role}] funded ${amount.toFixed(6)} ETH`); }
      else log(`[FLEET] [${w.role}] fund failed: ${r.error}`);
      await session.sleep(200 + session.rng() * 300);
    }
    if (venue.approveAll) await venue.approveAll(fleetWallets.filter(w => w.funded).map(w => w.wallet)); // allowances now, so the rug is one tx per wallet
  }

  async _run(session) {
    const { venue, log } = session;
    session.phase = "initializing";
    if (session.mode === "create") {
      await this._fundWallets(session);
      const funded = session.fleetWallets.filter(w => w.funded && w.address !== session.devWallet.address);
      const params = { name: "Token", symbol: "TKN", ...(session.tokenParams || {}) };
      const L = await venue.launch({ from: session.master, params, exemptions: funded.map(w => w.address), devBuyWei: ethToWei(session.devBuyEth) });
      if (!L.ok) { session.running = false; session.phase = "launch_failed"; session.error = L.error; log(`[FLEET] launch failed: ${L.error}`); await this._sweep(session); return; }
      session.token = L.token; session.curve = L.curve; session.launchedAt = L.launchedAt || venue.now(); session.launchTx = L.hash;
      this.sessions.set(session.token, session);
      session.gameState.token = L.token;
      if (L.devBuy?.ok) this._book(session, session.devWallet, "buy", L.devBuy, session.devBuyEth, "launch");
      log(`[FLEET] LAUNCHED ${L.token} (curve ${L.curve}) fee ${session.launchFee} ETH, dev buy ${session.devBuyEth} ETH, ${funded.length} wallets exempt`);
    } else {
      const A = await venue.attach(session.token);
      if (!A.ok) { session.running = false; session.phase = "attach_failed"; session.error = A.error; log(`[FLEET] attach failed: ${A.error}`); return; }
      session.curve = A.curve; session.launchedAt = A.launchedAt || 0; session.gameState.devWallet = lc(A.deployer);
      if (A.graduated) { session.running = false; session.phase = "graduated"; session.error = "the curve has graduated"; return; }
      await this._fundWallets(session);
    }
    session.gameState.connect(venue);
    session._poll = this._pollCurve(session);
    this.emit("phase", { token: session.token, phase: "entry" });
    if (session.mode === "create") await this._runCreateStrategy(session); else await this._runApeStrategy(session);
    if (session.phase !== "closed" && session.phase !== "rugged") { if (session.running === false || session.phase === "holding") { /* left holding on purpose */ } }
  }

  /** Keep the game state's curve numbers fresh. */
  _pollCurve(session) {
    return (async () => {
      while (session.running || session.phase === "holding") {
        try { const info = await session.venue.curveInfo(); if (info) { session.gameState.setCurve({ progress: info.progress, mcapEth: info.mcapEth, quoteReserve: info.quoteReserve }); session.curveInfo = info; if (info.graduated && session.running) { session.log(`[FLEET] the curve graduated`); session.exitReason ||= "graduated"; session.running = false; session.phase = "graduated"; } } } catch {}
        if (!session.running) break;
        await session.sleep(2000);
      }
    })();
  }

  _book(session, w, side, r, ethPlanned, engine = "") {
    const gas = r.gasWei != null ? toEth(r.gasWei) : 0;
    w.gasEth += gas; session.gasEth += gas;
    if (side === "buy") { const ethIn = r.quoteIn != null ? toEth(r.quoteIn) : ethPlanned; w.ethSpent += ethIn; session.totalEthSpent += ethIn; session.feesEth += toEth((r.fee || 0n) + (r.tax || 0n)); w.trades.push({ side: "buy", ethIn, tokens: r.tokensOut != null ? toTokens(r.tokensOut) : null, tx: r.hash, t: session.venue.now(), engine }); }
    else { const ethOut = r.quoteOut != null ? toEth(r.quoteOut) : 0; w.ethRecovered += ethOut; session.totalEthRecovered += ethOut; session.feesEth += toEth((r.fee || 0n) + (r.tax || 0n)); w.trades.push({ side: "sell", ethOut, tokens: r.tokensIn != null ? toTokens(r.tokensIn) : null, tx: r.hash, t: session.venue.now(), engine }); }
    session.tradeCount++;
    this.emit("trade", { token: session.token, role: w.role, side, eth: side === "buy" ? (r.quoteIn != null ? toEth(r.quoteIn) : ethPlanned) : toEth(r.quoteOut || 0n), tx: r.hash, engine });
  }

  /**
   * One trade at a time per wallet.
   *
   * Every trade here reads a balance and then acts on it, and several engines drive the same wallets
   * at once -- the volume engine, the dev-sell controller, the fallback sell loop and the auto-rug,
   * which fires every holder together with Promise.allSettled. Two trades from one address that
   * overlap race each other twice over. In the simulator the second reads a balance the first is
   * about to change, which is the observed "insufficient tokens: 6444917 < 8423397" during a rug. On
   * a real chain it is worse and quieter: both transactions are signed against the same nonce, so
   * one of them is replaced or dropped, and the one that vanishes is as likely to be the sell as the
   * buy. A rug sell that misses is the one sell there is no second chance at, because the price it
   * was aiming at is the price the other sells just moved.
   *
   * So a wallet's trades queue. The lock is per address and is released in a finally, and it is held
   * across the read AND the send, which is the only span where the race exists.
   */
  _lock(session, address) {
    const locks = session._walletLocks || (session._walletLocks = new Map());
    const prev = locks.get(address) || Promise.resolve();
    let release;
    const held = new Promise(r => { release = r; });
    locks.set(address, prev.then(() => held));
    return prev.then(() => release);
  }

  /** Wait until no wallet has a trade in flight. stop() on an engine only sets a flag; the trade it
   *  already started is still going, and reading balances before it lands is what made the rug race. */
  async _quiesce(session) {
    const locks = session._walletLocks;
    if (!locks?.size) return;
    await Promise.allSettled([...locks.values()]);
  }

  /** Buy `eth` worth from a wallet. Returns { ok, ethIn, tokens, hash } or { ok:false, error }. */
  async _executeBuy(session, w, eth, engine = "") {
    if (!(eth >= session.minTrade)) return { ok: false, error: "below minimum trade" };
    const release = await this._lock(session, w.address);
    try {
      const bal = toEth(await session.venue.ethBalance(w.address));
      if (bal < eth + session.gasReserve) return { ok: false, error: `wallet has ${bal.toFixed(6)} ETH, needs ${(eth + session.gasReserve).toFixed(6)}` };
      const r = await session.venue.buy(w.wallet, ethToWei(eth), { slippagePct: session.fleetConfig.slippagePct });
      if (!r.ok) return r;
      this._book(session, w, "buy", r, eth, engine);
      return { ok: true, ethIn: r.quoteIn != null ? toEth(r.quoteIn) : eth, tokens: r.tokensOut != null ? toTokens(r.tokensOut) : null, hash: r.hash, graduated: !!r.graduated };
    } finally { release(); }
  }
  /** Sell a fraction of what the wallet holds. Returns { ok, ethOut, emptied, hash } or { ok:false }. */
  async _executeSell(session, w, fraction, engine = "") {
    const release = await this._lock(session, w.address);
    try {
      const held = await session.venue.tokenBalance(w.address);
      if (held === 0n) return { ok: false, error: "no tokens" };
      const f = Math.max(0, Math.min(1, fraction));
      const units = f >= 0.999 ? held : held * BigInt(Math.floor(f * 1e6)) / 1_000_000n;
      if (units === 0n) return { ok: false, error: "too small" };
      const r = await session.venue.sell(w.wallet, units, { slippagePct: session.fleetConfig.slippagePct });
      if (!r.ok) return r;
      this._book(session, w, "sell", r, 0, engine);
      return { ok: true, ethOut: toEth(r.quoteOut), emptied: units === held, hash: r.hash };
    } finally { release(); }
  }
  /** A buy followed by a sell of the same tokens: activity on the chart. */
  async _executeVolumeTrade(session, w, eth) {
    const b = await this._executeBuy(session, w, eth, "paint"); if (!b.ok) return b;
    await session.sleep(2000 + session.rng() * 6000);
    const held = await session.venue.tokenBalance(w.address); const tokens = b.tokens || 0;
    const frac = tokens > 0 && toTokens(held) > 0 ? Math.min(1, tokens / toTokens(held)) : 1;
    return this._executeSell(session, w, frac * (0.9 + session.rng() * 0.1), "paint");
  }
  _executors(session, engine) {
    return { executeBuy: (w, eth) => this._executeBuy(session, w, eth, engine), executeSell: (w, f) => this._executeSell(session, w, f, engine), executeVolumeTrade: (w, eth) => this._executeVolumeTrade(session, w, eth), ethBalance: async (w) => toEth(await session.venue.ethBalance(w.address)) };
  }

  // ── CREATE: opening-window entry → orchestration → volume + auto-rug → fallback sells → hold ──
  async _runCreateStrategy(session) {
    const { venue, fleetWallets, gameState, log, rng } = session;
    const funded = fleetWallets.filter(w => w.funded && w.address !== session.devWallet.address);
    session._devSellCtrl = new DevSellController(session);
    session.phase = "buying"; this.emit("phase", { token: session.token, phase: "buying" });
    const isSolo = funded.length === 0;
    if (isSolo) log(`[FLEET] solo: the dev holds the launch buy`);
    else {
      // The window is ours: declared wallets are exempt, so they clear at the untaxed price while the
      // tax makes everyone else wait. Staggered by role so it is six wallets, not one bundle.
      log(`[FLEET] CREATE: opening-window entry, ${funded.length} exempt wallets`);
      const info = await venue.curveInfo();
      const window = (info?.snipeTaxSeconds || 15) * 1000;
      await Promise.allSettled(funded.map(async (w) => {
        await session.sleep(Math.min(window * 0.6, (w.roleConfig.buyDelay || 0) * 1000 + rng() * 600));
        if (!session.running) return;
        const amount = w.allocation * session.fleetConfig.entryShare * (0.95 + rng() * 0.1);
        const r = await this._executeBuy(session, w, amount, "entry");
        if (r.ok) log(`[FLEET] [${w.role}] ENTRY ${r.ethIn.toFixed(5)} ETH ✓ (${((venue.now() - session.launchedAt) / 1000).toFixed(1)}s after launch)`); else log(`[FLEET] [${w.role}] entry failed: ${r.error}`);
      }));
      log(`[FLEET] entry done: ${session.tradeCount} buys in ${((venue.now() - session.launchedAt) / 1000).toFixed(1)}s`);
    }
    if (!session.running) return this._endOfStrategy(session);
    await session.sleep(2000);
    session.phase = "orchestrating"; this.emit("phase", { token: session.token, phase: "orchestrating" });
    const orchestrator = new LaunchOrchestrator(session, this._executors(session, "orchestrator"), session.fleetConfig.orchestration);
    session._orchestrator = orchestrator;
    orchestrator.on("external_buyer", (d) => this.emit("external_buyer", d));
    await orchestrator.run();
    if (!session.running) return this._endOfStrategy(session);
    await this._volumeAndRug(session, "volume");
    if (session.phase === "rugged" || !session.running) return this._endOfStrategy(session);
    // fallback: GameState-adjusted sell rounds per role, then hold the remainder
    session.phase = "selling"; this.emit("phase", { token: session.token, phase: "selling" });
    const order = [...funded].sort((a, b) => (a.roleConfig.sellDelay || 30) - (b.roleConfig.sellDelay || 30));
    for (let i = 0; i < order.length && session.running; i++) { await this._runSellLoop(session, order[i]); if (i < order.length - 1) await session.sleep(5000 + rng() * 10000); }
    if (session.running) { session.phase = "holding"; this.emit("phase", { token: session.token, phase: "holding" }); log(`[FLEET] holding the remainder; close when ready`); }
    return this._endOfStrategy(session);
  }

  // ── APE: wait out the tax if needed → snipe → volume + auto-rug (bounded by duration) → exit ──
  async _runApeStrategy(session) {
    const { venue, fleetWallets, log, rng } = session;
    session.phase = "sniping"; this.emit("phase", { token: session.token, phase: "sniping" });
    const funded = fleetWallets.filter(w => w.funded);
    // never donate: if the launch is inside its opening window and we are not exempt, wait for the tax to fall
    for (let i = 0; i < 120 && session.running; i++) { const q = await venue.quoteBuy(ethToWei(Math.max(session.minTrade, funded[0].allocation * 0.1)), funded[0].wallet); if (!q.ok || !(q.snipeTaxBps > 300)) break; if (i === 0) log(`[FLEET] APE: opening tax ${q.snipeTaxBps} bps — waiting for it to decay`); await session.sleep(1000); }
    await Promise.allSettled(funded.map(async (w, idx) => {
      await session.sleep((0.5 + idx * 1 + rng() * 1.5) * 1000);
      if (!session.running) return;
      const amount = w.allocation * session.fleetConfig.apeEntryShare;
      const r = await this._executeBuy(session, w, amount, "ape");
      if (r.ok) log(`[FLEET] [${w.role}] APE BUY ${r.ethIn.toFixed(5)} ETH ✓`); else log(`[FLEET] [${w.role}] ape buy failed: ${r.error}`);
    }));
    log(`[FLEET] APE: ${session.tradeCount} buys landed`);
    if (!session.running) return this._endOfStrategy(session);
    session.phase = "holding"; this.emit("phase", { token: session.token, phase: "holding" });
    const holdUntil = venue.now() + (session.fleetConfig.apeHoldMin || 5) * 60_000;
    (async () => { while (session.running && venue.now() < holdUntil && !session._autoRug?.triggered) await session.sleep(Math.min(2000, Math.max(50, holdUntil - venue.now()))); if (session.running && !session._autoRug?.triggered) { log(`[FLEET] APE: hold limit reached — stopping volume`); session._volumeEngine?.stop(); session._autoRug?.stop(); } })();
    await this._volumeAndRug(session, "holding");
    if (session._autoRug?.triggered || !session.running) return this._endOfStrategy(session);
    session.phase = "exiting"; this.emit("phase", { token: session.token, phase: "exiting" });
    await Promise.allSettled(funded.map(async (w, idx) => { await session.sleep((1.5 + idx * 1.5 + rng() * 2) * 1000); if (!session.running) return; const r = await this._executeSell(session, w, 0.90 + rng() * 0.05, "exit"); if (r.ok) log(`[FLEET] [${w.role}] EXIT → ${r.ethOut.toFixed(5)} ETH`); }));
    if (session.running) { session.phase = "exited"; session.exitReason ||= "ape_exit"; this.emit("phase", { token: session.token, phase: "exited" }); }
    return this._endOfStrategy(session);
  }

  /** Phase 2 of both strategies: the volume engine pumps while the auto-rug watches for a drought. */
  async _volumeAndRug(session, phaseName) {
    const { log } = session;
    session.phase = phaseName; this.emit("phase", { token: session.token, phase: phaseName });
    const volumeEngine = new ContinuousVolumeEngine(session, this._executors(session, "volume"), session.fleetConfig.volume);
    session._volumeEngine = volumeEngine;
    volumeEngine.on("trade", (d) => { if (session.mode === "create") this._maybeDevSell(session, d); });
    const autoRug = new AutoRugController(session, () => this.rugAll(session, "auto-rug"), session.fleetConfig.autoRug);
    session._autoRug = autoRug;
    autoRug.on("drought-detected", (d) => { log(`[FLEET] auto-rug: ${d.droughtSec.toFixed(0)}s drought`); volumeEngine.stop(); this.emit("phase", { token: session.token, phase: "auto-rug" }); });
    autoRug.on("rug-complete", (d) => { session.phase = "rugged"; session.exitReason ||= "auto-rug"; this.emit("phase", { token: session.token, phase: "rugged" }); this.emit("rug-complete", { token: session.token, ...d }); });
    // the game state can end volume too: a SELL_NOW that holds for 20 s means the market is leaving
    const sellNowWatch = (async () => { let since = 0; while (volumeEngine.running && session.running) { await session.sleep(2000); const gs = session.gameState.refresh(); if (gs.signal === "SELL_NOW") { since += 2000; if (since >= 20_000) { log(`[FLEET] SELL_NOW held 20s — stopping volume, exiting into what demand is left`); volumeEngine.stop(); autoRug.stop(); session.exitReason ||= "sell_now"; return; } } else since = 0; } })();
    await Promise.race([volumeEngine.start(), autoRug.start()]);
    volumeEngine.stop(); autoRug.stop();
    // Whoever started a rug — the drought, or a close from the war room — this phase does not end
    // until it has sold and swept. Awaiting only the auto-rug let a manual close race the process exit.
    if (session._rugDone) await session._rugDone;
    await sellNowWatch;
  }

  /** The mimicry axiom: after a fleet buy, the dev may take a small profit after a human delay. */
  _maybeDevSell(session, d) {
    if (d.side !== "buy" || !session._devSellCtrl || !session.running) return;
    const gs = session.gameState?.alive ? session.gameState.refresh() : null;
    const decision = session._devSellCtrl.shouldDevSell("buy", d.eth || 0, true, gs, session.curveInfo?.quoteReserve || 3);
    if (!decision?.shouldSell) return;
    // Fire and forget, so it must never reject: an RPC error here was an unhandled rejection, which
    // takes the whole process down mid-launch with the fleet still holding.
    (async () => {
      try {
        await session.sleep(decision.delay); if (!session.running) return;
        const r = await this._executeSell(session, session.devWallet, decision.sellPct, "dev-profit");
        if (r.ok) { session._devSellCtrl.recordSell(decision.sellPct); session.log(`[DEV-SELL] dev took ${(decision.sellPct * 100).toFixed(1)}% → ${r.ethOut.toFixed(5)} ETH (total ${session._devSellCtrl.summary().totalSoldPct}%)`); }
      } catch (e) { session.log(`[DEV-SELL] skipped: ${e.message}`); }
    })();
  }

  /** GameState-adjusted sell rounds for one wallet (the fallback exit). */
  async _runSellLoop(session, w) {
    const { gameState, log, rng } = session; const { sellPct, sellRounds } = w.roleConfig; const per = sellPct / sellRounds;
    log(`[FLEET] [${w.role}] sell loop: ${sellRounds} rounds, ${(sellPct * 100).toFixed(0)}%`);
    for (let i = 0; i < sellRounds && session.running; i++) {
      const gs = gameState?.alive ? gameState.refresh() : null;
      if (gs) {
        if (gs.signal === "RIDE" && i < sellRounds - 1) { const extra = (gameState.holdExtension || 15) * 1000; log(`[FLEET] [${w.role}] RIDE (${gs.buyPressure}% buys, ${gs.uniqueBuyers} buyers) — delaying ${(extra / 1000).toFixed(0)}s`); await session.sleep(extra); if (!session.running) break; if (gameState.refresh().signal === "RIDE") { log(`[FLEET] [${w.role}] still RIDE — skipping this round`); continue; } }
        if (gs.signal === "SELL_NOW") { log(`[FLEET] [${w.role}] SELL_NOW — dumping`); const r = await this._executeSell(session, w, 0.95, "emergency"); if (r.ok) log(`[FLEET] [${w.role}] EMERGENCY SELL → ${r.ethOut.toFixed(5)} ETH`); return; }
        if (gs.signal === "ACCUMULATE" && i === 0) { const bal = toEth(await session.venue.ethBalance(w.address)) - session.gasReserve; if (bal > session.minTrade * 4) { log(`[FLEET] [${w.role}] ACCUMULATE — buying ${(bal * 0.8).toFixed(5)} more`); await this._executeBuy(session, w, bal * 0.8, "accumulate"); await session.sleep(10_000 + rng() * 15_000); if (!session.running) break; } }
      }
      const mult = gameState?.sellMultiplier || 1.0;
      const actual = per * (0.7 + rng() * 0.6) * Math.min(mult, 2.0);
      const invested = w.ethSpent || 0, recovered = w.ethRecovered || 0;
      const cut = (session._profitConfig?.cutPercent || 0) / 100;
      const estNet = (recovered - invested) * (1 - cut) - session.gasReserve;
      const bonding = gameState?.bondingPct || 0;
      if (gs?.signal !== "SELL_NOW" && i < sellRounds - 1 && invested > 0 && estNet < session.fleetConfig.minNetProfitEth && bonding < 15) { log(`[FLEET] [${w.role}] SKIP sell — below breakeven (net ${estNet.toFixed(5)} ETH, curve ${bonding.toFixed(0)}%)`); continue; }
      const r = await this._executeSell(session, w, Math.min(actual, 0.95), "sell-loop");
      if (r.ok) log(`[FLEET] [${w.role}] SELL ${i + 1}/${sellRounds} → ${r.ethOut.toFixed(5)} ETH${mult !== 1 ? ` (${mult.toFixed(1)}x)` : ""}`);
      if (i < sellRounds - 1) await session.sleep(((10 + rng() * 30) * 1000) / Math.max(0.3, mult));
    }
  }

  /** Every wallet sells everything at once, then the ETH is swept home. The auto-rug's action, and close()'s. */
  async rugAll(session, why = "rug") {
    const { venue, log } = session;
    if (session._rugDone) return session._rugDone; // one rug per session; a close and the drought can both ask
    session._rugDone = (async () => {
      session.running = false; session._volumeEngine?.stop(); session.gameState?.stop();
      // stop() only sets a flag. Whatever was already in flight is still going, and every balance
      // read below is wrong until it lands -- which is exactly how a rug sell used to be sized
      // against tokens a volume sell had already spent.
      await this._quiesce(session);
      const holders = [session.devWallet, ...session.fleetWallets.filter(w => w.address !== session.devWallet.address)];
      // A wallet that spent itself down to less than one sell cannot sell. Top it up from the master
      // first: the tokens are worth more than the gas, and without this its position is simply stuck.
      const need = (session.sellCost || 0) * 2;
      if (need > 0) for (const w of holders) {
        if (w.address === lc(session.master.address)) continue;
        try { if ((await venue.tokenBalance(w.address)) > 0n && toEth(await venue.ethBalance(w.address)) < need) { const r = await venue.transfer(session.master, w.address, ethToWei(need)); log(`[${why.toUpperCase()}] ${w.role} topped up ${need.toFixed(6)} ETH to afford its sell${r.ok ? "" : `: ${r.error}`}`); } } catch (e) { log(`[${why.toUpperCase()}] ${w.role} top-up failed: ${e.message}`); }
      }
      const results = await Promise.allSettled(holders.map(async (w) => { const r = await this._executeSell(session, w, 1, why); if (r.ok) log(`[${why.toUpperCase()}] ${w.role} sold → ${r.ethOut.toFixed(5)} ETH`); else if (r.error !== "no tokens") log(`[${why.toUpperCase()}] ${w.role} sell failed: ${r.error}`); return r; }));
      const sold = results.filter(r => r.status === "fulfilled" && r.value.ok).length;
      // a sell can be refused (graduated, slippage): try once more, sequentially and wider
      for (const w of holders) {
        const release = await this._lock(session, w.address);
        try {
          const left = await venue.tokenBalance(w.address);
          if (left === 0n) continue;
          const r = await venue.sell(w.wallet, left, { slippagePct: 50 });
          if (r.ok) { this._book(session, w, "sell", r, 0, why); log(`[${why.toUpperCase()}] ${w.role} sold on retry → ${toEth(r.quoteOut).toFixed(5)} ETH`); }
          else log(`[${why.toUpperCase()}] ${w.role} still holds tokens: ${r.error}`);
        } finally { release(); }
      }
      await session.sleep(1000);
      const sw = await this._sweep(session);
      const masterBalance = toEth(await venue.ethBalance(session.master.address));
      log(`[${why.toUpperCase()}] complete: ${sold}/${holders.length} sold, swept ${sw.swept.toFixed(5)} ETH, master ${masterBalance.toFixed(5)} ETH`);
      return { ok: true, sold, total: holders.length, masterBalance, swept: sw.swept, skimmed: sw.skimmed };
    })();
    return session._rugDone;
  }

  /** Sweep every fleet wallet to the master, the platform's cut of the profit first. The venue prices
   *  the sweep the way it sends it, so what stays behind is the gas of that one transfer and nothing else. */
  async _sweep(session) {
    const { venue, log } = session; let swept = 0, skimmed = 0;
    const pc = session._profitConfig;
    for (const w of session.fleetWallets) {
      if (w.address === lc(session.master.address)) continue;
      try {
        if (pc?.cutPercent > 0 && pc.platformWallet) {
          const bal = await venue.ethBalance(w.address); const reserve = BigInt(await venue.sweepReserveWei());
          const profit = toEth(bal - reserve * 2n) - (w.fundedEth || w.allocation || 0);
          if (profit > 0.00001) { const skim = ethToWei(Math.min(profit * pc.cutPercent / 100, toEth(bal) * 0.9)); const s = await venue.transfer(w.wallet, pc.platformWallet, skim); if (s.ok) { skimmed += toEth(skim); log(`[FLEET] [${w.role}] platform cut ${toEth(skim).toFixed(6)} ETH`); } else log(`[FLEET] [${w.role}] skim failed: ${s.error}`); }
        }
        const r = await venue.sweepAll(w.wallet, session.master.address);
        if (r.ok) { swept += toEth(r.swept); log(`[FLEET] [${w.role}] swept ${toEth(r.swept).toFixed(6)} ETH`); }
        else if (r.error !== "dust") log(`[FLEET] [${w.role}] sweep failed: ${r.error}`);
      } catch (e) { log(`[FLEET] [${w.role}] sweep failed: ${e.message}`); }
      await session.sleep(150);
    }
    session.sweptEth = (session.sweptEth || 0) + swept; session.skimmedEth = (session.skimmedEth || 0) + skimmed;
    return { swept, skimmed };
  }

  async _endOfStrategy(session) { session.endedAt = session.venue.now(); }

  /** Close a session: sell everything, sweep, report.
   *  One close per session, and every caller awaits the same one. It used to throw "already closing"
   *  on the second call, which let the CLI's second finish() swallow the error and exit the process
   *  while the first close was still selling and sweeping — the fleet's ETH and tokens stayed put. */
  async close(key) {
    const session = this.sessions.get(key); if (!session) throw new Error(`no session ${key}`);
    if (session._closing) return session._closing;
    if (session.phase === "closed") return session._closeResult;
    session._closing = (async () => {
      session.running = false; const prev = session.phase; session.phase = "closing"; session.exitReason ||= prev === "holding" ? "manual_close" : "close";
      this.emit("phase", { token: session.token, phase: "closing" });
      session._volumeEngine?.stop(); session._autoRug?.stop(); session._orchestrator?.stop();
      await session.sleep(500);
      if (session._rugDone) await session._rugDone; else await this.rugAll(session, "close");
      session.gameState?.stop();
      const masterBalance = toEth(await session.venue.ethBalance(session.master.address));
      session.phase = "closed";
      session._closeResult = { trades: session.tradeCount, wallets: session.fleetWallets.length, ethSpent: session.totalEthSpent, ethRecovered: session.totalEthRecovered, netProfit: masterBalance - session.masterStartEth, masterBalance, platformCut: session.skimmedEth || 0 };
      return session._closeResult;
    })();
    return session._closing;
  }
  /** Whatever close/rug is in flight for this session, for a caller that must not exit before it lands. */
  pending(key) { const s = this.sessions.get(key); return s ? (s._closing || s._rugDone || null) : null; }
  async closeAll() { const out = {}; for (const k of [...this.sessions.keys()]) { try { out[k] = await this.close(k); } catch (e) { out[k] = { error: e.message }; } } return out; }
  stop(key) { const s = this.sessions.get(key); if (s) s.running = false; }

  /** War-room commands: accumulate | hold | distribute | boost | auto. */
  command(key, cmd, params = {}) {
    const s = this.sessions.get(key); if (!s) return { ok: false, error: "no session" }; if (!s.running) return { ok: false, error: "session not running" };
    const gs = s.gameState; const dur = params.duration || 60;
    switch (cmd) {
      case "accumulate": gs?.setManualOverride("ACCUMULATE", dur); return { ok: true, signal: "ACCUMULATE", duration: dur };
      case "hold": gs?.setManualOverride("RIDE", dur); return { ok: true, signal: "RIDE", duration: dur };
      case "distribute": gs?.setManualOverride("SELL_NOW", dur); return { ok: true, signal: "SELL_NOW", duration: dur };
      case "boost": gs?.setManualOverride("HOLD", Math.min(dur, 30)); if (s._volumeEngine) s._volumeEngine.volumeMultiplier = Math.min(s._volumeEngine.volumeMultiplier * 1.5, s._volumeEngine.config.maxMultiplier); return { ok: true, signal: "BOOST" };
      case "auto": gs?.clearManualOverride(); return { ok: true, signal: "AUTO" };
      default: return { ok: false, error: `unknown command ${cmd}` };
    }
  }

  /** Sweep wallets from a saved key list back to a destination (recovery after a crash). */
  async recover(walletKeys, destination) {
    const results = []; let total = 0;
    for (const k of walletKeys) {
      const w = this.venue.walletFromKey ? this.venue.walletFromKey(k.privateKey) : k;
      try {
        const r = await this.venue.sweepAll(w, destination);
        if (r.ok) { total += toEth(r.swept); results.push({ address: w.address, swept: toEth(r.swept), status: "ok" }); }
        else results.push({ address: w.address, status: r.error === "dust" ? "empty" : "failed", error: r.error === "dust" ? undefined : r.error });
      } catch (e) { results.push({ address: w?.address || "?", error: e.message, status: "failed" }); }
    }
    return { totalRecovered: total, wallets: results };
  }

  status(key) {
    const s = key ? this.sessions.get(key) : [...this.sessions.values()][0]; if (!s) return null;
    return { id: s.id, mode: s.mode, token: s.token, curve: s.curve, phase: s.phase, running: s.running, tradeCount: s.tradeCount, ethSpent: +s.totalEthSpent.toFixed(6), ethRecovered: +s.totalEthRecovered.toFixed(6), feesEth: +s.feesEth.toFixed(6), gasEth: +s.gasEth.toFixed(6), elapsedSec: Math.round(((s.endedAt || s.venue.now()) - s.startTime) / 1000), wallets: s.fleetWallets.map(w => ({ role: w.role, address: w.address, allocation: w.allocation, spent: +w.ethSpent.toFixed(6), recovered: +w.ethRecovered.toFixed(6), trades: w.trades.length })), dev: { spent: +s.devWallet.ethSpent.toFixed(6), recovered: +s.devWallet.ethRecovered.toFixed(6), sells: s._devSellCtrl?.summary() || null }, gameState: s.gameState?.snapshot() || null, volumeEngine: s._volumeEngine?.snapshot() || null, autoRug: s._autoRug?.snapshot() || null, orchestrator: s._orchestrator?.getStats() || null, exitReason: s.exitReason, error: s.error || null };
  }

  /** The session's outcome in one object: what went in, what came back, where it went. */
  async report(key) {
    const s = this.sessions.get(key); if (!s) return null;
    const venue = s.venue; const master = toEth(await venue.ethBalance(s.master.address));
    const walletEth = []; for (const w of s.fleetWallets) if (w.address !== lc(s.master.address)) walletEth.push({ role: w.role, eth: toEth(await venue.ethBalance(w.address)), tokens: toTokens(await venue.tokenBalance(w.address)) });
    const devTokens = toTokens(await venue.tokenBalance(s.master.address));
    const stranded = walletEth.reduce((a, w) => a + w.eth, 0);
    const info = await venue.curveInfo().catch(() => null);
    const net = master + stranded - s.masterStartEth;
    return { id: s.id, mode: s.mode, token: s.token, phase: s.phase, exitReason: s.exitReason, elapsedSec: Math.round(((s.endedAt || venue.now()) - s.startTime) / 1000), budgetEth: s.budgetEth, masterStartEth: +s.masterStartEth.toFixed(6), masterEndEth: +master.toFixed(6), strandedEth: +stranded.toFixed(6), netEth: +net.toFixed(6), netPct: +((net / s.budgetEth) * 100).toFixed(2), ethSpent: +s.totalEthSpent.toFixed(6), ethRecovered: +s.totalEthRecovered.toFixed(6), feesEth: +s.feesEth.toFixed(6), gasEth: +s.gasEth.toFixed(6), launchFeeEth: s.launchFee, trades: s.tradeCount, devSells: s._devSellCtrl?.summary() || null, orchestrator: s._orchestrator?.getStats() || null, volume: s._volumeEngine?.snapshot() || null, autoRug: s._autoRug?.snapshot() || null, gameState: s.gameState?.snapshot() || null, curve: info ? { mcapEth: +info.mcapEth.toFixed(5), progress: +info.progress.toFixed(4), graduated: info.graduated } : null, tokensLeft: { dev: devTokens, fleet: walletEth.reduce((a, w) => a + w.tokens, 0) }, wallets: walletEth, error: s.error || null };
  }
}
export default FleetTrader;
