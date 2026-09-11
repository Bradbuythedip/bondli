// ═══ PONS feed: Robinhood Chain launches and curve trades as MarketEvents (DP1) ═══
// Polls the chain's logs: TokenLaunched on the factory, CurveBuy / CurveSell / CurveCompleted on
// every curve it has seen. Keeps the same per-token state the pump.fun radar keeps (buys, sells,
// distinct buyers, trades, spark, mcap, curve progress), scores it with the same composite, and
// emits candidates with the same payload shape, so the same gates, sizer and exits judge it.
// The quote asset is ETH: every "solPrice" field on this venue is the ETH price in USD.
import { JsonRpcProvider, Contract } from "ethers";
import { Feed } from "../../core/feed.mjs";
import { FACTORY, TOPICS, CURVE_ABI, ERC20_ABI, DEFAULT_RPC_URL, SNIPE_TAX_WINDOW_MS, decodeLog, mcapQuote, curveProgress, toEth, toTokens } from "./chain.mjs";

/** The chain, behind four calls, so a test can fake it. */
export function ethersRpc(rpcUrl = process.env.PONS_RPC_URL || DEFAULT_RPC_URL) {
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true, batchMaxCount: 10 });
  return {
    provider,
    blockNumber: () => provider.getBlockNumber(),
    logs: (filter) => provider.getLogs(filter),
    async curveInfo(curve) {
      const c = new Contract(curve, CURVE_ABI, provider);
      const [[q, t], real, feeBps, taxBps, thr, native] = await Promise.all([c.getReserves(), c.realQuoteReserve(), c.feeBps(), c.creatorTaxBps(), c.graduationThreshold(), c.isNativeQuote().catch(() => true)]);
      return { quoteReserve: toEth(q), tokenReserve: toTokens(t), realQuoteReserve: toEth(real), feeBps: Number(feeBps), creatorTaxBps: Number(taxBps), graduationThreshold: toEth(thr), native: !!native };
    },
    async tokenMeta(token) {
      const c = new Contract(token, ERC20_ABI, provider);
      const [name, symbol] = await Promise.all([c.name().catch(() => ""), c.symbol().catch(() => "")]);
      return { name, symbol };
    },
  };
}

/** Score dynamics with the radar's output shape: velocity (points/s), acceleration, trend. */
export class Dynamics {
  constructor() { this.h = new Map(); }
  record(ca, score, now) {
    let e = this.h.get(ca); if (!e) { e = { pts: [], v: 0, a: 0 }; this.h.set(ca, e); }
    e.pts.push({ s: score, t: now }); if (e.pts.length > 6) e.pts.shift();
    const n = e.pts.length;
    if (n >= 2) {
      const dt = (e.pts[n - 1].t - e.pts[n - 2].t) / 1000, v = dt > 0 ? (e.pts[n - 1].s - e.pts[n - 2].s) / dt : 0;
      e.v = e.v === 0 ? v : e.v * 0.3 + v * 0.7;
      if (n >= 3) { const dt2 = (e.pts[n - 2].t - e.pts[n - 3].t) / 1000, v2 = dt2 > 0 ? (e.pts[n - 2].s - e.pts[n - 3].s) / dt2 : 0; const a = ((e.pts[n - 1].t - e.pts[n - 3].t) / 1000) > 0 ? (v - v2) / ((e.pts[n - 1].t - e.pts[n - 3].t) / 1000) : 0; e.a = e.a === 0 ? a : e.a * 0.3 + a * 0.7; }
    }
    const trend = e.v > 1 && e.a >= 0 ? "rocket" : e.v > 0.15 ? "rising" : e.v < -1 ? "crashing" : e.v < -0.15 ? "fading" : "stable";
    return { scores: n, velocity: +e.v.toFixed(4), acceleration: +e.a.toFixed(4), trend };
  }
  get(ca) { const e = this.h.get(ca); return e ? this.record(ca, e.pts[e.pts.length - 1].s, e.pts[e.pts.length - 1].t) : null; }
}

/** The radar's composite score, on this venue's state. 0..99. */
export function scoreToken(t, qf, now) {
  const buys = t.buys, sells = t.sells, ub = t.uniqueBuyers.size, mc = t.mcapUsd, vol = t.volumeUsd;
  const ageMin = (now - t.createdAt) / 60000;
  const buyScore = Math.min(20, buys * 1.5), ubScore = Math.min(15, ub * 2.5), volScore = Math.min(10, (vol / Math.max(mc, 1)) * 100);
  const mcScore = mc >= 100000 ? 3 : mc >= 50000 ? 5 : mc >= 20000 ? 8 : mc >= 10000 ? 10 : mc >= 5000 ? 8 : mc >= 4000 ? 6 : 0;
  let greenScore = 0;
  const sp = t.spark;
  if (sp.length >= 3) { const recent = sp.slice(-3), earlier = sp.slice(-6, -3); if (earlier.length) { const avgR = recent.reduce((a, b) => a + b, 0) / recent.length, avgE = earlier.reduce((a, b) => a + b, 0) / earlier.length; const g = avgE > 0 ? (avgR - avgE) / avgE : 0; if (g > 0) greenScore = Math.min(20, g * 60); } }
  const pressure = buys > 2 ? Math.min(10, (buys / Math.max(1, buys + sells)) * 10) : 0;
  const velocity = Math.min(10, (buys / Math.max(0.2, ageMin)) * 3);
  const sellPenalty = sells > buys * 0.6 ? Math.min(12, (sells - buys * 0.4) * 2) : 0;
  let rug = 0;
  rug += qf.rg_devSellSpeed > 0.25 ? 10 : 0; rug += qf.rg_coordDumpScore > 0.25 ? 8 : 0; rug += qf.rg_mcapDropRate > 0.3 ? 8 : 0; rug += qf._rg_quickFlipRate > 0.15 ? 6 : 0;
  return Math.max(0, Math.min(99, Math.round(buyScore + ubScore + volScore + mcScore + greenScore + pressure + velocity - sellPenalty - rug)));
}

/** The rug features the gates read, from this venue's own trade window. Missing ones stay undefined. */
export function quickFeatures(t, now) {
  const tr = t.trades, last60 = tr.filter(x => now - x.time <= 60_000), last30 = tr.filter(x => now - x.time <= 30_000);
  const buyQ = tr.filter(x => x.side === "buy").reduce((s, x) => s + x.quote, 0), sellQ = tr.filter(x => x.side === "sell").reduce((s, x) => s + x.quote, 0);
  const devSells = tr.filter(x => x.side === "sell" && x.wallet === t.devWallet).reduce((s, x) => s + x.quote, 0);
  const devBuys = tr.filter(x => x.side === "buy" && x.wallet === t.devWallet).reduce((s, x) => s + x.quote, 0);
  const byBuyer = {}; for (const x of tr) if (x.side === "buy") byBuyer[x.wallet] = (byBuyer[x.wallet] || 0) + x.quote;
  const top3 = Object.values(byBuyer).sort((a, b) => b - a).slice(0, 3).reduce((s, v) => s + v, 0);
  const firstBuy = {}; for (const x of tr) if (x.side === "buy" && firstBuy[x.wallet] == null) firstBuy[x.wallet] = x.time;
  const flips = tr.filter(x => x.side === "sell" && firstBuy[x.wallet] != null && x.time - firstBuy[x.wallet] <= 60_000).map(x => x.wallet);
  const sells60 = last60.filter(x => x.side === "sell").length;
  const peak = t.spark.length ? Math.max(...t.spark) : t.mcapUsd;
  return {
    rg_devSellSpeed: devBuys + t.devInitialQuote > 0 ? Math.min(1, devSells / (devBuys + t.devInitialQuote)) : (devSells > 0 ? 1 : 0),
    rg_coordDumpScore: Math.min(1, sells60 / 5),
    rg_sellWaveDetect: last30.length ? last30.filter(x => x.side === "sell").length / last30.length : 0,
    rg_holderConcentration: buyQ > 0 ? Math.min(1, top3 / buyQ) : 0,
    _rg_quickFlipRate: t.uniqueBuyers.size ? Math.min(1, new Set(flips).size / t.uniqueBuyers.size) : 0,
    rg_liqRemovalSpeed: buyQ + sellQ > 0 ? sellQ / (buyQ + sellQ) : 0,
    rg_mcapDropRate: peak > 0 ? Math.max(0, (peak - t.mcapUsd) / peak) : 0,
    _rg_organicBuyers: t.uniqueBuyers.size,
    _rg_singleWalletDominance: buyQ > 0 ? Math.max(0, ...Object.values(byBuyer)) / buyQ : 0,
    _rg_sybilScore: 0, _rg_freshWalletRatio: 0, // no wallet-age source on this chain yet: never asserted, never a false rug
  };
}

export class PonsFeed extends Feed {
  constructor({ rpc = null, rpcUrl, pollMs = 2_000, ethPrice = null, priceFn = null, fromBlock = null, maxTokens = 3000, clock, ...rest } = {}) {
    super({ venue: "pons", name: "pons-feed", staleAfterMs: rest.staleAfterMs ?? Math.max(8_000, 3 * pollMs), latencyBoundMs: rest.latencyBoundMs ?? 2_500, clock });
    this.rpc = rpc || ethersRpc(rpcUrl);
    this.pollMs = pollMs; this.fromBlock = fromBlock; this.maxTokens = maxTokens;
    this.priceFn = priceFn; this.solPrice = ethPrice || 0; this.solPriceAt = ethPrice ? this.clock() : 0; // "solPrice" = quote (ETH) price in USD, by the engine's convention
    this.tokens = new Map(); this.byCurve = new Map(); this.dyn = new Dynamics();
    this._lastEmitted = new Map(); this._timers = []; this._block = null; this.errors = 0; this.reemitMs = rest.reemitMs ?? 30_000;
  }

  token(ca) { return this.tokens.get(String(ca).toLowerCase()) || null; }

  /** Apply one decoded log. Exposed for tests and replays. */
  apply(rec, now = this.clock()) {
    if (!rec) return;
    if (rec.kind === "launch") {
      if (this.tokens.has(rec.token)) return;
      const t = { ca: rec.token, curve: rec.curve, name: "", ticker: "", devWallet: rec.deployer, createdAt: now, block: rec.block, graduationThreshold: rec.graduationThreshold, pairToken: rec.pairToken,
        buys: 0, sells: 0, uniqueBuyers: new Set(), trades: [], spark: [], volumeQuote: 0, volumeUsd: 0, devInitialQuote: 0,
        quoteReserve: 0, tokenReserve: 0, realQuoteReserve: 0, feeBps: 100, creatorTaxBps: 0, mcapQuote: 0, mcapUsd: 0, progress: 0, graduated: false, _curvePct: 0, _source: "pons", _apeScore: 0, _scoredAt: 0, _pending: true };
      this.tokens.set(rec.token, t); this.byCurve.set(rec.curve, t);
      if (this.tokens.size > this.maxTokens) { const oldest = [...this.tokens.values()].sort((a, b) => a.createdAt - b.createdAt)[0]; this.tokens.delete(oldest.ca); this.byCurve.delete(oldest.curve); }
      return t;
    }
    const t = this.byCurve.get(rec.curve); if (!t) return;
    if (rec.kind === "complete") { t.graduated = true; t.progress = 1; t._curvePct = 1; return t; }
    if (rec.kind === "buy" || rec.kind === "sell") {
      const buy = rec.kind === "buy";
      if (buy) { t.buys++; t.uniqueBuyers.add(rec.wallet); if (rec.wallet === t.devWallet && t.buys === 1) t.devInitialQuote = rec.quote; } else t.sells++;
      t.volumeQuote += rec.quote; t.volumeUsd = t.volumeQuote * this.solPrice;
      t.trades.push({ side: rec.kind, quote: rec.quote, sol: rec.quote, tokens: rec.tokens, wallet: rec.wallet, time: now, tx: rec.tx });
      if (t.trades.length > 100) t.trades = t.trades.slice(-100);
      // Reserves move exactly by what the curve took in and paid out; fees leave the real reserve.
      const spent = buy ? rec.quote - rec.fee - rec.tax : -(rec.quote + rec.fee + rec.tax);
      t.quoteReserve = Math.max(0, t.quoteReserve + spent); t.realQuoteReserve = Math.max(0, t.realQuoteReserve + spent);
      t.tokenReserve = Math.max(0, t.tokenReserve + (buy ? -rec.tokens : rec.tokens));
      this._remark(t);
      return t;
    }
  }

  _remark(t) {
    if (t.quoteReserve > 0 && t.tokenReserve > 0) { t.mcapQuote = mcapQuote(t); t.mcapUsd = Math.round(t.mcapQuote * this.solPrice); }
    t.progress = curveProgress(t.realQuoteReserve, t.graduationThreshold); t._curvePct = t.graduated ? 1 : t.progress;
    if (t.mcapUsd > 0) { t.spark.push(t.mcapUsd); if (t.spark.length > 60) t.spark = t.spark.slice(-60); }
  }

  /** Reserves and names straight from the chain, once per token (and after a burst, for drift). */
  async _hydrate(t) {
    try {
      const [info, meta] = await Promise.all([this.rpc.curveInfo(t.curve), t.name ? null : this.rpc.tokenMeta(t.ca)]);
      Object.assign(t, { quoteReserve: info.quoteReserve, tokenReserve: info.tokenReserve, realQuoteReserve: info.realQuoteReserve, feeBps: info.feeBps, creatorTaxBps: info.creatorTaxBps, native: info.native });
      if (info.graduationThreshold > 0) t.graduationThreshold = info.graduationThreshold;
      if (meta) { t.name = meta.name || t.name; t.ticker = meta.symbol || t.ticker; }
      t._pending = false; t._hydratedAt = this.clock();
      this._remark(t);
    } catch (err) { t._hydrateError = err.message; }
  }

  payloadFor(t, now = this.clock()) {
    const qf = quickFeatures(t, now);
    t._apeScore = scoreToken(t, qf, now); t._scoredAt = now;
    const dynamics = this.dyn.record(t.ca, t._apeScore, now);
    t._lastQf = qf; t._lastDyn = dynamics;
    const { uniqueBuyers, trades, ...rest } = t;
    const token = { ...rest, uniqueBuyers: { size: uniqueBuyers.size }, trades: trades.slice(-60), vSolInBondingCurve: t.quoteReserve, mcapSol: t.mcapQuote, _ageMs: now - t.createdAt };
    return {
      token, qf, dynamics, scores: { apeScore: t._apeScore, scoreTimestamp: now },
      solPrice: this.solPrice, solPriceAt: this.solPriceAt, quote: "ETH",
      mcapUsd: t.mcapUsd, vSolInBondingCurve: t.quoteReserve,
      curve: { address: t.curve, quoteReserve: t.quoteReserve, tokenReserve: t.tokenReserve, feeBps: t.feeBps, creatorTaxBps: t.creatorTaxBps, native: t.native !== false, progress: t.progress },
    };
  }

  _changed(t, payload, now) {
    const key = `${payload.scores.apeScore | 0}|${t.buys}|${t.sells}|${Math.round(t.mcapUsd / 250)}|${payload.dynamics.trend}`;
    const prev = this._lastEmitted.get(t.ca);
    if (prev && prev.key === key && now - prev.at < this.reemitMs) return false;
    this._lastEmitted.set(t.ca, { key, at: now }); return true;
  }

  async pollOnce() {
    const now = this.clock();
    if (this.priceFn) { try { const p = await this.priceFn(); if (p > 0) { this.solPrice = p; this.solPriceAt = now; } } catch {} }
    const head = await this.rpc.blockNumber();
    if (this._block == null) this._block = this.fromBlock ?? head; // first poll: from now, not from genesis
    if (head < this._block) { this.touch(); return 0; }
    const from = this._block, to = Math.min(head, from + 2000);
    const launches = await this.rpc.logs({ address: FACTORY, topics: [[TOPICS.TokenLaunched, TOPICS.PoolGraduated]], fromBlock: from, toBlock: to });
    for (const l of launches) { const r = decodeLog(l); if (r?.kind === "launch") this.apply(r, now); else if (r?.kind === "graduated") { const t = this.tokens.get(r.token); if (t) { t.graduated = true; t._curvePct = 1; } } }
    const curves = [...this.byCurve.keys()];
    const touched = new Set();
    if (curves.length) {
      for (let i = 0; i < curves.length; i += 200) { // address lists have a cap on most nodes
        const logs = await this.rpc.logs({ address: curves.slice(i, i + 200), topics: [[TOPICS.CurveBuy, TOPICS.CurveSell, TOPICS.CurveCompleted]], fromBlock: from, toBlock: to });
        logs.sort((a, b) => (a.blockNumber - b.blockNumber) || ((a.index ?? a.logIndex ?? 0) - (b.index ?? b.logIndex ?? 0)));
        for (const l of logs) { const r = decodeLog(l); const t = this.apply(r, now); if (t) touched.add(t); }
      }
    }
    this._block = to + 1;
    let emitted = 0;
    for (const t of this.tokens.values()) {
      const held = this.watched.has(t.ca);
      if (t._pending || (touched.has(t) && now - (t._hydratedAt || 0) > 20_000) || (held && now - (t._hydratedAt || 0) > 4_000)) await this._hydrate(t);
      if (!(t.mcapUsd > 0) || !(this.solPrice > 0)) continue;
      const payload = this.payloadFor(t, now);
      if (this.watched.has(t.ca)) this.emitEvent({ kind: "tick", id: t.ca, payload: { ...payload, source: "pons" }, t_venue: now });
      if (now - t.createdAt < SNIPE_TAX_WINDOW_MS) continue; // a buy in the snipe-tax window is a donation: not even a candidate
      if (t.uniqueBuyers.size < 2 || t.buys < 3) continue; // the pump.fun base filter's floor: two people and three buys before anyone is asked to judge it
      if (!this._changed(t, payload, now)) continue;
      this.emitEvent({ kind: "candidate", id: t.ca, payload, t_venue: now }); emitted++;
    }
    this.touch();
    this.markHealth(true, `block ${to}, ${this.tokens.size} tokens, ${emitted} candidates`);
    return emitted;
  }

  async start() {
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try { await this.pollOnce(); this.errors = 0; } catch (err) { this.errors++; this.markHealth(false, err.message); }
      if (this.running) this._timers.push(setTimeout(tick, this.pollMs));
    };
    tick();
  }
  async stop() { this.running = false; for (const t of this._timers) clearTimeout(t); this._timers = []; this.markHealth(false, "stopped"); }
}
