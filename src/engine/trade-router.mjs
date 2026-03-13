// BONDLI v3.0 — Trade Router (PumpFun vs Raydium auto-switch)
import { PumpFunClient } from "./pumpfun-client.mjs";
import { RaydiumClient } from "./raydium-client.mjs";
import CONFIG from "./config.mjs";
import { Connection } from "@solana/web3.js";

export class TradeRouter {
  constructor() {
    this.connection = new Connection(CONFIG.RPC_URL, "confirmed");
    this.pump = new PumpFunClient(this.connection);
    this.ray = new RaydiumClient(this.connection);
    this.graduated = new Map(); // mint -> { value, timestamp }
    this.CACHE_TTL = 30_000; // 30s — re-check graduation status regularly
  }

  async isGraduated(mint) {
    const cached = this.graduated.get(mint);
    // Only use cache if it's fresh AND the token was already graduated (graduation is permanent)
    if (cached && (cached.value === true || Date.now() - cached.timestamp < this.CACHE_TTL)) {
      return cached.value;
    }
    try {
      const state = await this.pump.getCurveState(mint);
      const grad = state ? state.graduated : true;
      this.graduated.set(mint, { value: grad, timestamp: Date.now() });
      return grad;
    } catch {
      // On error, assume NOT graduated only if we have no prior data
      // If we previously saw it as not graduated, keep that (stale is better than wrong direction)
      return cached?.value ?? false;
    }
  }

  async buy(keypair, mint, solAmount, opts = {}) {
    const grad = await this.isGraduated(mint);
    if (grad) {
      console.log(`[ROUTER] ${mint.slice(0,8)}... graduated -> Jupiter`);
      return this.ray.buy(keypair, mint, solAmount, opts);
    }
    console.log(`[ROUTER] ${mint.slice(0,8)}... on curve -> PumpFun`);
    return this.pump.buy(keypair, mint, solAmount, opts);
  }

  async sell(keypair, mint, tokenAmount, opts = {}) {
    const grad = await this.isGraduated(mint);
    if (grad) {
      return this.ray.sell(keypair, mint, tokenAmount, opts);
    }
    return this.pump.sell(keypair, mint, tokenAmount, opts);
  }

  async getCurveInfo(mint) {
    try {
      const state = await this.pump.getCurveState(mint);
      if (!state) return { exists: false };
      return {
        exists: true,
        graduated: state.graduated,
        price: this.pump.getPrice(state),
        solReserves: state.realSolReserves / 1e9,
        progress: Math.min(100, (state.realSolReserves / 85e9) * 100),
        ...state,
      };
    } catch (e) {
      return { exists: false, error: e.message };
    }
  }
}

export default TradeRouter;
