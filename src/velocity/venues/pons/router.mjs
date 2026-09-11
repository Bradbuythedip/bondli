// ═══ PONS routers: paper (curve model) and live (ethers wallet on Robinhood Chain) (DP4) ═══
// Fill records keep the engine's field names: sol_spent / sol_received are the QUOTE asset (ETH)
// spent and received, gas included, and reference.solPrice is the ETH price in USD.
import { Wallet, JsonRpcProvider, Contract, MaxUint256 } from "ethers";
import { PaperRouter, Router, failure } from "../../core/router.mjs";
import { CURVE_ABI, ERC20_ABI, DEFAULT_RPC_URL, CHAIN_ID, curveBuyQuote, curveSellQuote, decodeLog, toEth, toWei, toTokens, TOKEN_DECIMALS } from "./chain.mjs";

const PRICE_MAX_AGE_MS = 5 * 60_000;
const DEFAULT_RESERVES = { quoteReserve: 3, tokenReserve: 1_000_000_000, feeBps: 100, creatorTaxBps: 0 };

function reserves(ref = {}) {
  const c = ref.curve || {};
  const quoteReserve = Number(c.quoteReserve) > 0 ? Number(c.quoteReserve) : DEFAULT_RESERVES.quoteReserve;
  const tokenReserve = Number(c.tokenReserve) > 0 ? Number(c.tokenReserve) : DEFAULT_RESERVES.tokenReserve;
  return { quoteReserve, tokenReserve, feeBps: (Number(c.feeBps) || DEFAULT_RESERVES.feeBps) + (Number(c.creatorTaxBps) || 0) };
}

export function ponsFillModel(order) {
  const price = Number(order.reference?.solPrice) || 0;
  if (!(price > 0)) return { reject: "NO_QUOTE_PRICE", reason: "reference has no ETH price" };
  const r = reserves(order.reference);
  if (order.side === "BUY") {
    const quoteIn = (Number(order.stake_usd) || 0) / price;
    if (!(quoteIn > 0)) return { reject: "ZERO_STAKE", reason: "stake is zero" };
    const q = curveBuyQuote(r, quoteIn, r.feeBps);
    return { price: q.avgPrice * price, qty: q.tokensOut, notional_usd: Number(order.stake_usd), slippage_bps: q.slippage_bps, fee_usd: q.feeQuote * price };
  }
  const qty = Number(order.qty) || 0;
  if (!(qty > 0)) return { reject: "ZERO_QTY", reason: "nothing to sell" };
  const q = curveSellQuote(r, qty, r.feeBps);
  return { price: q.avgPrice * price, qty, notional_usd: q.quoteOut * price, slippage_bps: q.slippage_bps, fee_usd: q.feeQuote * price };
}

export class PonsPaperRouter extends PaperRouter {
  constructor({ bookFile, clock, latencyMs = 5 } = {}) { super({ venue: "pons", clock, bookFile, fillModel: ponsFillModel, latencyMs }); }
}

/** A live router on an EVM wallet. `secret` is the 0x-prefixed private key of a dedicated wallet. */
export class PonsLiveRouter extends Router {
  constructor({ secret = null, rpcUrl = null, provider = null, slippagePct = 15, confirmTimeoutMs = 25_000, gasLimitBuy = 400_000n, gasLimitSell = 350_000n, clock } = {}) {
    super({ venue: "pons", mode: "live", clock });
    this.secret = secret; this.rpcUrl = rpcUrl; this.provider = provider; this.slippagePct = slippagePct; this.confirmTimeoutMs = confirmTimeoutMs;
    this.gasLimitBuy = gasLimitBuy; this.gasLimitSell = gasLimitSell;
    this.ready = false; this.address = null; this.known = new Set(); // tokens this wallet has been told about (EVM has no account enumeration)
  }

  async init() {
    if (this.secret == null) this.secret = process.env.PONS_PRIVATE_KEY;
    if (this.rpcUrl == null) this.rpcUrl = process.env.PONS_RPC_URL || DEFAULT_RPC_URL;
    if (!this.secret) throw new Error("pons live router needs an EVM private key (PONS_PRIVATE_KEY, 0x-hex) for a dedicated wallet");
    if (!this.provider) this.provider = new JsonRpcProvider(this.rpcUrl, { chainId: CHAIN_ID, name: "robinhood" }, { staticNetwork: true });
    this.wallet = new Wallet(this.secret.trim(), this.provider);
    this.address = this.wallet.address;
    this.ready = true;
    return this.preflight();
  }

  async preflight() {
    if (!this.ready) throw new Error("call init() first");
    const t0 = Date.now();
    const wei = await this.provider.getBalance(this.address);
    const balanceSol = toEth(wei); // the engine's name for "quote balance"
    return { wallet: this.address, balanceSol, balanceEth: balanceSol, quote: "ETH", rpc: String(this.rpcUrl || "").split("?")[0], rpcLatencyMs: Date.now() - t0, chainId: CHAIN_ID };
  }

  track(token) { this.known.add(String(token).toLowerCase()); }
  async _quoteBalance() { return toEth(await this.provider.getBalance(this.address)); }
  async _tokenBalance(token) { const c = new Contract(token, ERC20_ABI, this.provider); return toTokens(await c.balanceOf(this.address)); }

  async _waitReceipt(hash, budgetMs) {
    const deadline = this.clock() + budgetMs;
    while (this.clock() < deadline) {
      const r = await this.provider.getTransactionReceipt(hash).catch(() => null);
      if (r) return r;
      await new Promise(res => setTimeout(res, 800));
    }
    return null;
  }

  /** The trade this receipt carried for `curve`, plus the gas it burned, in ETH. */
  _receiptDeltas(receipt, curve) {
    const gasEth = receipt.gasUsed != null && (receipt.gasPrice ?? receipt.effectiveGasPrice) != null ? toEth(BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice ?? receipt.effectiveGasPrice)) : 0;
    const trade = (receipt.logs || []).filter(l => String(l.address).toLowerCase() === String(curve).toLowerCase()).map(decodeLog).find(r => r && (r.kind === "buy" || r.kind === "sell")) || null;
    return { gasEth, trade, reverted: receipt.status === 0 };
  }

  async submit(order) {
    if (!this.ready) return failure(order, "NOT_READY", "call init() first");
    if (order.legs?.length) return failure(order, "UNSUPPORTED", "pons has no multi-leg orders");
    const ref = order.reference || {}, price = Number(ref.solPrice) || 0, curveAddr = ref.curve?.address;
    if (!(price > 0)) return failure(order, "NO_QUOTE_PRICE", "reference has no ETH price");
    if (!curveAddr) return failure(order, "NO_CURVE", "reference has no bonding curve address");
    const priceAt = Number(ref.solPriceAt) || 0;
    if (!(priceAt > 0) || this.clock() - priceAt > PRICE_MAX_AGE_MS) return failure(order, "STALE_QUOTE_PRICE", "ETH price is missing or older than 5 minutes; refusing to size in ETH");
    if (ref.curve?.native === false) return failure(order, "UNSUPPORTED", "this launch is quoted in an ERC-20, not ETH");
    const est = ponsFillModel({ ...order, side: "BUY" });
    if (est.reject) return failure(order, est.reject, est.reason);
    if (Number.isFinite(order.max_slippage_bps) && est.slippage_bps > order.max_slippage_bps) return failure(order, "SLIPPAGE_CAP", `curve slippage ${est.slippage_bps.toFixed(1)}bps > cap ${order.max_slippage_bps}bps`);
    const quoteIn = +(Number(order.stake_usd) / price).toFixed(9);
    const t_sent = this.clock();
    let hash = null;
    try {
      const bal = await this._quoteBalance();
      if (bal < quoteIn + 0.0003) return failure(order, "INSUFFICIENT_SOL", `wallet has ${bal.toFixed(5)} ETH, order needs ${(quoteIn + 0.0003).toFixed(5)} with gas`);
      const curve = new Contract(curveAddr, CURVE_ABI, this.wallet);
      const minOut = BigInt(Math.floor(est.qty * (1 - this.slippagePct / 100) * 1e6)) * 10n ** BigInt(TOKEN_DECIMALS - 6);
      const tx = await curve.buy(toWei(quoteIn), minOut, this.address, { value: toWei(quoteIn), gasLimit: this.gasLimitBuy });
      hash = tx.hash; this.track(order.instrument);
      const receipt = await this._waitReceipt(hash, this.confirmTimeoutMs);
      if (!receipt) return failure(order, "UNCONFIRMED", `tx ${hash} not confirmed within ${this.confirmTimeoutMs}ms`, { venue_ref: hash, t_sent });
      const d = this._receiptDeltas(receipt, curveAddr);
      if (d.reverted) return failure(order, "SEND_FAILED", `tx ${hash} reverted`, { venue_ref: hash, fee_usd: d.gasEth * price });
      const t_filled = this.clock();
      const qty = d.trade?.tokens || est.qty;
      const spent = (d.trade ? d.trade.quote : quoteIn) + d.gasEth;
      return { ok: true, fill: { orderId: order.id, decisionId: order.decisionId || null, venue: "pons", instrument: order.instrument, side: "BUY", price: qty > 0 ? (spent * price) / qty : est.price, qty, notional_usd: +(spent * price).toFixed(4), slippage_bps: +est.slippage_bps.toFixed(2), fee_usd: +(((d.trade?.fee || 0) + (d.trade?.tax || 0) + d.gasEth) * price).toFixed(4), t_sent, t_filled, latency_ms: t_filled - t_sent, venue_ref: hash, sol_spent: spent, exact: !!d.trade } };
    } catch (err) {
      return failure(order, "SEND_FAILED", err.shortMessage || err.message, hash ? { venue_ref: hash, t_sent } : {});
    }
  }

  async close(position, pct = 100, ctx = {}) {
    if (!this.ready) return failure({ id: position.id }, "NOT_READY", "call init() first");
    const ref = ctx.reference || position.reference || {}, price = Number(ref.solPrice) || 0, curveAddr = ref.curve?.address || position.curve;
    if (!curveAddr) return failure({ id: position.id }, "NO_CURVE", "position has no bonding curve address");
    const t_sent = this.clock();
    let hash = null;
    try {
      if (position.pendingExit?.sig) {
        const prev = await this.resolvePending({ instrument: position.instrument, side: "SELL", sig: position.pendingExit.sig, at: position.pendingExit.at, reference: { ...ref, solPrice: price }, curve: curveAddr });
        if (prev.ok) return { ...prev, fill: { ...prev.fill, orderId: `${position.id}:close`, decisionId: position.decisionId, pending_pct: Number(position.pendingExit.pct) || 100 } };
        if (!prev.failure.expired) return prev;
      }
      const held = await this._tokenBalance(position.instrument);
      if (!(held > 0)) return failure({ id: position.id }, "NO_POSITION", "no token balance to sell");
      const curveRead = new Contract(curveAddr, CURVE_ABI, this.provider);
      if (await curveRead.graduated().catch(() => false)) return failure({ id: position.id }, "GRADUATED", "the curve has graduated to a Uniswap V4 pool; sell by hand on PONS (export the key into Rabby)");
      const p = Math.min(100, Math.max(1, Math.round(pct)));
      const tokensIn = held * p / 100;
      const units = BigInt(Math.floor(tokensIn * 1e6)) * 10n ** BigInt(TOKEN_DECIMALS - 6);
      const token = new Contract(position.instrument, ERC20_ABI, this.wallet);
      const allowance = await token.allowance(this.address, curveAddr);
      if (allowance < units) { const a = await token.approve(curveAddr, MaxUint256); await this._waitReceipt(a.hash, this.confirmTimeoutMs); }
      const r = reserves(ref);
      const q = curveSellQuote(r, tokensIn, r.feeBps);
      const minOut = toWei(Math.max(0, q.quoteOut * (1 - this.slippagePct / 100)));
      const curve = new Contract(curveAddr, CURVE_ABI, this.wallet);
      const tx = await curve.sell(units, minOut, this.address, { gasLimit: this.gasLimitSell });
      hash = tx.hash;
      const receipt = await this._waitReceipt(hash, this.confirmTimeoutMs);
      if (!receipt) return failure({ id: position.id }, "UNCONFIRMED", `tx ${hash} not confirmed within ${this.confirmTimeoutMs}ms`, { venue_ref: hash, t_sent });
      const d = this._receiptDeltas(receipt, curveAddr);
      if (d.reverted) return failure({ id: position.id }, "SEND_FAILED", `tx ${hash} reverted`, { venue_ref: hash });
      const t_filled = this.clock();
      const qty = d.trade?.tokens || tokensIn, got = Math.max(0, (d.trade ? d.trade.quote : q.quoteOut) - d.gasEth);
      return { ok: true, fill: { orderId: `${position.id}:close`, decisionId: position.decisionId, venue: "pons", instrument: position.instrument, side: "SELL", price: qty > 0 ? (got * price) / qty : 0, qty, notional_usd: +(got * price).toFixed(4), slippage_bps: null, fee_usd: +(((d.trade?.fee || 0) + (d.trade?.tax || 0) + d.gasEth) * price).toFixed(4), t_sent, t_filled, latency_ms: t_filled - t_sent, venue_ref: hash, sol_received: got, exact: !!d.trade } };
    } catch (err) {
      return failure({ id: position.id }, "SEND_FAILED", err.shortMessage || err.message, hash ? { venue_ref: hash, t_sent } : {});
    }
  }

  /** A transaction sent earlier: did it land? Reads the receipt and books what it carried. */
  async resolvePending({ instrument, side, sig, at, reference = {}, curve = null, stakeUsd = 0 }) {
    const receipt = await this.provider.getTransactionReceipt(sig).catch(() => null);
    const price = Number(reference.solPrice) || 0, t = this.clock();
    if (!receipt) {
      const expired = at && t - at > 10 * 60_000;
      return failure({ id: sig }, expired ? "DROPPED" : "PENDING", expired ? `tx ${sig} never landed` : `tx ${sig} still pending`, { expired: !!expired, venue_ref: sig });
    }
    const d = this._receiptDeltas(receipt, curve || reference.curve?.address || "");
    if (d.reverted) return failure({ id: sig }, "SEND_FAILED", `tx ${sig} reverted`, { expired: true, venue_ref: sig, fee_usd: d.gasEth * price });
    if (!d.trade) return failure({ id: sig }, "UNREADABLE", `tx ${sig} carries no curve trade log`, { expired: true, venue_ref: sig });
    if (side === "BUY") { const spent = d.trade.quote + d.gasEth; return { ok: true, fill: { venue: "pons", instrument, side: "BUY", price: (spent * price) / d.trade.tokens, qty: d.trade.tokens, notional_usd: +(spent * price).toFixed(4), slippage_bps: null, fee_usd: 0, t_sent: at || t, t_filled: t, latency_ms: at ? t - at : 0, venue_ref: sig, sol_spent: spent, late: true } }; }
    const got = Math.max(0, d.trade.quote - d.gasEth);
    return { ok: true, fill: { venue: "pons", instrument, side: "SELL", price: d.trade.tokens > 0 ? (got * price) / d.trade.tokens : 0, qty: d.trade.tokens, notional_usd: +(got * price).toFixed(4), slippage_bps: null, fee_usd: 0, t_sent: at || t, t_filled: t, latency_ms: at ? t - at : 0, venue_ref: sig, sol_received: got, late: true } };
  }

  /** Plain ETH transfer from the trading wallet (the platform's performance fee). Returns the hash. */
  async transferSol(to, eth) {
    if (!this.ready) throw new Error("call init() first");
    const tx = await this.wallet.sendTransaction({ to, value: toWei(eth), gasLimit: 21_000n });
    await this._waitReceipt(tx.hash, this.confirmTimeoutMs);
    return tx.hash;
  }
  transferQuote(to, amount) { return this.transferSol(to, amount); }

  async health() {
    if (!this.ready) return { ok: false, latencyMs: null, detail: "not initialised" };
    const t0 = Date.now();
    try { const b = await this.provider.getBlockNumber(); return { ok: true, latencyMs: Date.now() - t0, detail: `block ${b}` }; }
    catch (err) { return { ok: false, latencyMs: Date.now() - t0, detail: err.message }; }
  }

  /** Balances of the tokens this router knows about. An EVM wallet has no account list to enumerate. */
  async positions() {
    if (!this.ready) return [];
    const out = [];
    for (const token of this.known) { try { const qty = await this._tokenBalance(token); if (qty > 0) out.push({ instrument: token, qty }); } catch {} }
    return out;
  }
}
