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

export class PumpfunLiveRouter extends Router {
  constructor({ secret = process.env.MASTER_SEED, rpcUrl = process.env.RPC_URL, slippageBps = 300, confirmTimeoutMs = 20_000, clock } = {}) {
    super({ venue: "pumpfun", mode: "live", clock });
    this.secret = secret;
    this.rpcUrl = rpcUrl;
    this.slippageBps = slippageBps;
    this.confirmTimeoutMs = confirmTimeoutMs;
    this.ready = false;
  }

  async init() {
    if (!this.secret) throw new Error("pumpfun live router needs MASTER_SEED (base58 secret key)");
    const [web3, bs58, clientMod, rpc] = await Promise.all([
      import("@solana/web3.js"),
      import("bs58"),
      import("../../../engine/pumpfun-client.mjs"),
      import("../../../engine/rpc-enhanced.mjs"),
    ]);
    this.web3 = web3;
    this.keypair = web3.Keypair.fromSecretKey((bs58.default || bs58).decode(this.secret));
    this.connection = new web3.Connection(this.rpcUrl || (await import("../../../engine/config.mjs")).default.RPC_URL, "confirmed");
    this.client = new clientMod.PumpFunClient(this.connection);
    this.client.dryRun = false;
    this.smartSend = rpc.smartSend;
    this.ready = true;
  }

  async _sendAndConfirm(tx) {
    const t_sent = this.clock();
    const sig = await this.smartSend(this.connection, tx.serialize());
    const deadline = Date.now() + this.confirmTimeoutMs;
    while (Date.now() < deadline) {
      const st = await this.connection.getSignatureStatuses([sig]);
      const s = st?.value?.[0];
      if (s?.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(s.err)}`);
      if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return { sig, t_sent, t_filled: this.clock() };
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error(`tx ${sig} not confirmed within ${this.confirmTimeoutMs}ms`);
  }

  async submit(order) {
    if (!this.ready) return failure(order, "NOT_READY", "call init() first");
    if (order.legs?.length) return failure(order, "UNSUPPORTED", "pump.fun has no multi-leg orders");
    const solPrice = Number(order.reference?.solPrice) || 0;
    if (!(solPrice > 0)) return failure(order, "NO_SOL_PRICE", "reference has no solPrice");
    try {
      const state = await this.client.getCurveState(order.instrument);
      if (!state) return failure(order, "NO_CURVE", "bonding curve not found");
      if (state.graduated) return failure(order, "GRADUATED", "token graduated; Raydium path not enabled for entries");
      const est = pumpfunFillModel({ ...order, reference: { ...order.reference, vSolInBondingCurve: state.virtualSolReserves / 1e9, vTokensInBondingCurve: state.virtualTokenReserves / 1e6 } });
      if (est.reject) return failure(order, est.reject, est.reason);
      if (Number.isFinite(order.max_slippage_bps) && est.slippage_bps > order.max_slippage_bps)
        return failure(order, "SLIPPAGE_CAP", `curve slippage ${est.slippage_bps.toFixed(1)}bps > cap ${order.max_slippage_bps}bps`);
      const solAmount = Number(order.stake_usd) / solPrice;
      const tokensOut = this.client.estimateBuy(state, solAmount);
      const minTokens = Math.floor(tokensOut * (1 - this.slippageBps / 10_000));
      const tx = await this.client.buildPumpTx(this.keypair, order.instrument, "buy", solAmount, minTokens);
      const { sig, t_sent, t_filled } = await this._sendAndConfirm(tx);
      return { ok: true, fill: { orderId: order.id, decisionId: order.decisionId || null, venue: "pumpfun", instrument: order.instrument, side: "BUY", price: est.price, qty: tokensOut / 1e6, notional_usd: Number(order.stake_usd), slippage_bps: +est.slippage_bps.toFixed(2), fee_usd: est.fee_usd, t_sent, t_filled, latency_ms: t_filled - t_sent, venue_ref: sig, estimated_qty: true } };
    } catch (err) {
      return failure(order, "SEND_FAILED", err.message);
    }
  }

  async close(position, pct = 100, ctx = {}) {
    if (!this.ready) return failure({ id: position.id }, "NOT_READY", "call init() first");
    try {
      const { PublicKey } = this.web3;
      const { getAssociatedTokenAddressSync, getAccount } = await import("@solana/spl-token");
      const ata = getAssociatedTokenAddressSync(new PublicKey(position.instrument), this.keypair.publicKey, true);
      const acct = await getAccount(this.connection, ata);
      const raw = Number(acct.amount);
      const sellRaw = Math.floor(raw * Math.min(100, Math.max(0, pct)) / 100);
      if (sellRaw <= 0) return failure({ id: position.id }, "NO_POSITION", "no token balance to sell");
      const state = await this.client.getCurveState(position.instrument);
      if (!state) return failure({ id: position.id }, "NO_CURVE", "bonding curve not found");
      const solOut = this.client.estimateSell(state, sellRaw);
      const minSol = Math.floor(solOut * (1 - this.slippageBps / 10_000));
      const tx = await this.client.buildPumpTx(this.keypair, position.instrument, "sell", sellRaw, minSol);
      const { sig, t_sent, t_filled } = await this._sendAndConfirm(tx);
      const solPrice = Number(ctx.reference?.solPrice || position.reference?.solPrice) || 0;
      return { ok: true, fill: { orderId: `${position.id}:close`, decisionId: position.decisionId, venue: "pumpfun", instrument: position.instrument, side: "SELL", price: (solOut / 1e9 / (sellRaw / 1e6)) * solPrice, qty: sellRaw / 1e6, notional_usd: (solOut / 1e9) * solPrice * (1 - PUMP_FEE_BPS / 1e4), slippage_bps: null, fee_usd: (solOut / 1e9) * solPrice * (PUMP_FEE_BPS / 1e4), t_sent, t_filled, latency_ms: t_filled - t_sent, venue_ref: sig } };
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
