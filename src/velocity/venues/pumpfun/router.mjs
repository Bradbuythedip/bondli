// ═══ VELOCITY — pump.fun routers (DP4) ═══
// Paper: exact constant-product bonding-curve fill with virtual reserves, so
// modeled slippage is the real slippage the curve would charge.
// Live: bondli's PumpFunClient builds and signs; rpc-enhanced smartSend races
// the primary RPC against Jito with a p75 priority fee. Loaded lazily so paper
// mode and tests never import the Solana stack.

import { PaperRouter, Router, failure } from "../../core/router.mjs";

export const PUMP_FEE_BPS = 100;               // 1% each way
const DEFAULT_VSOL = 30;                       // fresh curve virtual SOL
const DEFAULT_VTOKENS = 1_073_000_000;         // fresh curve virtual tokens
const TOTAL_SUPPLY = 1_000_000_000;

/** Reserves from what the radar exposes: vSol from the curve, vTokens from spot price. */
export function reservesFromReference(ref = {}) {
  const solPrice = Number(ref.solPrice) || 0;
  const vSol = Number(ref.vSolInBondingCurve) > 0 ? Number(ref.vSolInBondingCurve) : DEFAULT_VSOL;
  let vTokens = Number(ref.vTokensInBondingCurve) || 0;
  if (!vTokens) {
    const mcapSol = Number(ref.mcapSol) || (solPrice > 0 ? (Number(ref.mcapUsd) || 0) / solPrice : 0);
    const spot = mcapSol > 0 ? mcapSol / TOTAL_SUPPLY : vSol / DEFAULT_VTOKENS;
    vTokens = spot > 0 ? vSol / spot : DEFAULT_VTOKENS;
  }
  return { vSol, vTokens, solPrice };
}

export function curveBuy({ vSol, vTokens }, stakeSol) {
  const tokensOut = vTokens - (vSol * vTokens) / (vSol + stakeSol);
  const spot = vSol / vTokens;
  const avg = stakeSol / tokensOut;
  return { tokensOut, avgPrice: avg, spot, slippage_bps: (avg / spot - 1) * 1e4 };
}
export function curveSell({ vSol, vTokens }, tokensIn) {
  const solOut = vSol - (vSol * vTokens) / (vTokens + tokensIn);
  const spot = vSol / vTokens;
  const avg = solOut / tokensIn;
  return { solOut, avgPrice: avg, spot, slippage_bps: (1 - avg / spot) * 1e4 };
}

export function pumpfunFillModel(order) {
  const { vSol, vTokens, solPrice } = reservesFromReference(order.reference || {});
  if (!(solPrice > 0)) return { reject: "NO_SOL_PRICE", reason: "reference has no solPrice" };
  const fee = PUMP_FEE_BPS / 1e4;
  if (order.side === "BUY") {
    const stakeSol = (Number(order.stake_usd) || 0) / solPrice;
    if (!(stakeSol > 0)) return { reject: "ZERO_STAKE", reason: "stake is zero" };
    const r = curveBuy({ vSol, vTokens }, stakeSol * (1 - fee));
    return { price: r.avgPrice * solPrice, qty: r.tokensOut, notional_usd: Number(order.stake_usd), slippage_bps: r.slippage_bps, fee_usd: stakeSol * fee * solPrice };
  }
  const qty = Number(order.qty) || 0;
  if (!(qty > 0)) return { reject: "ZERO_QTY", reason: "nothing to sell" };
  const r = curveSell({ vSol, vTokens }, qty);
  const gross = r.solOut * solPrice;
  return { price: r.avgPrice * solPrice, qty, notional_usd: gross * (1 - fee), slippage_bps: r.slippage_bps, fee_usd: gross * fee };
}

export class PumpfunPaperRouter extends PaperRouter {
  constructor({ bookFile, clock, latencyMs = 5 } = {}) {
    super({ venue: "pumpfun", clock, bookFile, fillModel: pumpfunFillModel, latencyMs });
  }
}

/** Request body for PumpPortal's free local transaction builder (the same path bondli's
 *  own trader uses). The returned transaction is signed locally; keys never leave the box. */
export function tradeLocalBody({ publicKey, action, mint, amount, denominatedInSol, slippagePct, priorityFeeSol, pool = "auto" }) {
  return { publicKey, action, mint, amount, denominatedInSol: denominatedInSol ? "true" : "false", slippage: slippagePct, priorityFee: priorityFeeSol, pool };
}

export class PumpfunLiveRouter extends Router {
  constructor({
    secret = process.env.MASTER_SEED, rpcUrl = process.env.RPC_URL, slippageBps = 300, sellSlippagePct = 15,
    priorityFeeSol = Number(process.env.PRIORITY_FEE_SOL || 0.0005), confirmTimeoutMs = 25_000,
    tradeLocalUrl = "https://pumpportal.fun/api/trade-local", fetchImpl = globalThis.fetch, clock,
  } = {}) {
    super({ venue: "pumpfun", mode: "live", clock });
    this.secret = secret; this.rpcUrl = rpcUrl; this.slippageBps = slippageBps; this.sellSlippagePct = sellSlippagePct;
    this.priorityFeeSol = priorityFeeSol; this.confirmTimeoutMs = confirmTimeoutMs; this.tradeLocalUrl = tradeLocalUrl; this.fetch = fetchImpl;
    this.ready = false; this.publicKey = null;
  }

  async init() {
    // Resolved here, not in the constructor: the engine builds routers before an operator may have loaded .env.
    if (this.secret == null) this.secret = process.env.MASTER_SEED;
    if (this.rpcUrl == null) this.rpcUrl = process.env.RPC_URL;
    if (!this.secret) throw new Error("pumpfun live router needs MASTER_SEED (base58 secret key of a dedicated wallet) in .env");
    const [web3, bs58, cfg] = await Promise.all([import("@solana/web3.js"), import("bs58"), import("../../../engine/config.mjs")]);
    this.web3 = web3;
    this.keypair = web3.Keypair.fromSecretKey((bs58.default || bs58).decode(this.secret.trim()));
    this.publicKey = this.keypair.publicKey.toBase58();
    this.connection = new web3.Connection(this.rpcUrl || cfg.default.RPC_URL, "confirmed");
    this.ready = true;
    return this.preflight();
  }

  /** What the operator sees before the first real order: wallet, balance, RPC. */
  async preflight() {
    if (!this.ready) throw new Error("call init() first");
    const t0 = Date.now();
    const lamports = await this.connection.getBalance(this.keypair.publicKey, "confirmed");
    return { wallet: this.publicKey, balanceSol: lamports / 1e9, rpc: String(this.rpcUrl || "").split("?")[0] || "default", rpcLatencyMs: Date.now() - t0 };
  }

  async _solBalance() { return (await this.connection.getBalance(this.keypair.publicKey, "confirmed")) / 1e9; }

  async _tokenBalance(mint) {
    const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
    const res = await this.connection.getParsedTokenAccountsByOwner(this.keypair.publicKey, { mint: new this.web3.PublicKey(mint) });
    let qty = 0;
    for (const a of res?.value || []) qty += Number(a.account.data.parsed.info.tokenAmount.uiAmount) || 0;
    return qty;
  }

  async _buildSignSend(body) {
    const res = await this.fetch(this.tradeLocalUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`trade builder ${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength < 100) throw new Error("trade builder returned an empty transaction");
    const tx = this.web3.VersionedTransaction.deserialize(bytes);
    tx.sign([this.keypair]);
    const t_sent = this.clock();
    const sig = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
    const deadline = Date.now() + this.confirmTimeoutMs;
    while (Date.now() < deadline) {
      const st = await this.connection.getSignatureStatuses([sig]);
      const v = st?.value?.[0];
      if (v?.err) throw new Error(`tx ${sig} failed on chain: ${JSON.stringify(v.err)}`);
      if (v && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized")) return { sig, t_sent, t_filled: this.clock() };
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error(`tx ${sig} not confirmed within ${this.confirmTimeoutMs}ms`);
  }

  async submit(order) {
    if (!this.ready) return failure(order, "NOT_READY", "call init() first");
    if (order.legs?.length) return failure(order, "UNSUPPORTED", "pump.fun has no multi-leg orders");
    const solPrice = Number(order.reference?.solPrice) || 0;
    if (!(solPrice > 0)) return failure(order, "NO_SOL_PRICE", "reference has no solPrice");
    const est = pumpfunFillModel({ ...order, side: "BUY" }); // entries are always buys
    if (est.reject) return failure(order, est.reject, est.reason);
    if (Number.isFinite(order.max_slippage_bps) && est.slippage_bps > order.max_slippage_bps)
      return failure(order, "SLIPPAGE_CAP", `curve slippage ${est.slippage_bps.toFixed(1)}bps > cap ${order.max_slippage_bps}bps`);
    const solAmount = +(Number(order.stake_usd) / solPrice).toFixed(6);
    try {
      const solBefore = await this._solBalance();
      if (solBefore < solAmount + this.priorityFeeSol + 0.003) return failure(order, "INSUFFICIENT_SOL", `wallet has ${solBefore.toFixed(4)} SOL, order needs ${(solAmount + 0.004).toFixed(4)}`);
      const qtyBefore = await this._tokenBalance(order.instrument).catch(() => 0);
      const body = tradeLocalBody({ publicKey: this.publicKey, action: "buy", mint: order.instrument, amount: solAmount, denominatedInSol: true, slippagePct: Math.max(1, Math.round(this.slippageBps / 100)), priorityFeeSol: this.priorityFeeSol });
      const { sig, t_sent, t_filled } = await this._buildSignSend(body);
      const [solAfter, qtyAfter] = await Promise.all([this._solBalance(), this._tokenBalance(order.instrument).catch(() => qtyBefore)]);
      const costSol = Math.max(0, solBefore - solAfter);
      const qty = Math.max(0, qtyAfter - qtyBefore) || est.qty;
      return { ok: true, fill: { orderId: order.id, decisionId: order.decisionId || null, venue: "pumpfun", instrument: order.instrument, side: "BUY", price: qty > 0 ? (costSol * solPrice) / qty : est.price, qty, notional_usd: +(costSol * solPrice).toFixed(4) || Number(order.stake_usd), slippage_bps: +est.slippage_bps.toFixed(2), fee_usd: +(Math.max(0, costSol - solAmount) * solPrice).toFixed(4), t_sent, t_filled, latency_ms: t_filled - t_sent, venue_ref: sig, sol_spent: costSol } };
    } catch (err) {
      return failure(order, "SEND_FAILED", err.message);
    }
  }

  async close(position, pct = 100, ctx = {}) {
    if (!this.ready) return failure({ id: position.id }, "NOT_READY", "call init() first");
    const solPrice = Number(ctx.reference?.solPrice || position.reference?.solPrice) || 0;
    try {
      const qtyBefore = await this._tokenBalance(position.instrument);
      if (!(qtyBefore > 0)) return failure({ id: position.id }, "NO_POSITION", "no token balance to sell");
      const solBefore = await this._solBalance();
      const p = Math.min(100, Math.max(1, Math.round(pct)));
      const body = tradeLocalBody({ publicKey: this.publicKey, action: "sell", mint: position.instrument, amount: `${p}%`, denominatedInSol: false, slippagePct: this.sellSlippagePct, priorityFeeSol: this.priorityFeeSol });
      const { sig, t_sent, t_filled } = await this._buildSignSend(body);
      const [solAfter, qtyAfter] = await Promise.all([this._solBalance(), this._tokenBalance(position.instrument).catch(() => 0)]);
      const proceedsSol = Math.max(0, solAfter - solBefore);
      const qty = Math.max(0, qtyBefore - qtyAfter) || qtyBefore * p / 100;
      return { ok: true, fill: { orderId: `${position.id}:close`, decisionId: position.decisionId, venue: "pumpfun", instrument: position.instrument, side: "SELL", price: qty > 0 ? (proceedsSol * solPrice) / qty : 0, qty, notional_usd: +(proceedsSol * solPrice).toFixed(4), slippage_bps: null, fee_usd: 0, t_sent, t_filled, latency_ms: t_filled - t_sent, venue_ref: sig, sol_received: proceedsSol } };
    } catch (err) {
      return failure({ id: position.id }, "SEND_FAILED", err.message);
    }
  }

  async health() {
    if (!this.ready) return { ok: false, latencyMs: null, detail: "not initialized" };
    const t0 = Date.now();
    try { await this.connection.getLatestBlockhash("confirmed"); return { ok: true, latencyMs: Date.now() - t0, detail: "rpc ok" }; }
    catch (err) { return { ok: false, latencyMs: Date.now() - t0, detail: err.message }; }
  }

  async positions() {
    if (!this.ready) return [];
    const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
    const res = await this.connection.getParsedTokenAccountsByOwner(this.keypair.publicKey, { programId: TOKEN_PROGRAM_ID });
    return (res?.value || []).map(a => ({ instrument: a.account.data.parsed.info.mint, qty: Number(a.account.data.parsed.info.tokenAmount.uiAmount) || 0 })).filter(p => p.qty > 0);
  }
}
