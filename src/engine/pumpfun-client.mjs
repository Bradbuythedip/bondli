// BONDLI v3.0 — PumpFun Bonding Curve Client
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import CONFIG from "./config.mjs";

const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMP_FEE = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbCJt85gtBk6jR");
const PUMP_GLOBAL = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");

export class PumpFunClient {
  constructor(connection) {
    this.connection = connection || new Connection(CONFIG.RPC_URL, "confirmed");
    this.dryRun = CONFIG.DRY_RUN;
  }

  // Derive bonding curve PDA for a given mint
  async getBondingCurve(mint) {
    const [curve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()],
      PUMP_PROGRAM
    );
    return curve;
  }

  // Fetch bonding curve state
  async getCurveState(mint) {
    const curve = await this.getBondingCurve(mint);
    const info = await this.connection.getAccountInfo(curve);
    if (!info) return null;
    // Decode: virtualTokenReserves(u64) + virtualSolReserves(u64) + realTokenReserves(u64) + realSolReserves(u64) + tokenTotalSupply(u64)
    const data = info.data;
    return {
      address: curve.toBase58(),
      virtualTokenReserves: Number(data.readBigUInt64LE(8)),
      virtualSolReserves:   Number(data.readBigUInt64LE(16)),
      realTokenReserves:    Number(data.readBigUInt64LE(24)),
      realSolReserves:      Number(data.readBigUInt64LE(32)),
      tokenTotalSupply:     Number(data.readBigUInt64LE(40)),
      graduated:            Number(data.readBigUInt64LE(32)) >= 85_000_000_000, // ~85 SOL threshold
    };
  }

  // Calculate price from curve state
  getPrice(state) {
    if (!state) return 0;
    return state.virtualSolReserves / state.virtualTokenReserves;
  }

  // Estimate tokens out for SOL in (buy)
  estimateBuy(state, solAmount) {
    const lamports = solAmount * 1e9;
    const newSolReserves = state.virtualSolReserves + lamports;
    const newTokenReserves = (state.virtualSolReserves * state.virtualTokenReserves) / newSolReserves;
    return Math.floor(state.virtualTokenReserves - newTokenReserves);
  }

  // Estimate SOL out for tokens in (sell)
  estimateSell(state, tokenAmount) {
    const newTokenReserves = state.virtualTokenReserves + tokenAmount;
    const newSolReserves = (state.virtualSolReserves * state.virtualTokenReserves) / newTokenReserves;
    return Math.floor(state.virtualSolReserves - newSolReserves);
  }

  // Execute buy
  async buy(keypair, mint, solAmount, opts = {}) {
    const slippage = opts.slippage || CONFIG.SLIPPAGE_BPS;
    const state = await this.getCurveState(mint);
    if (!state) throw new Error("Bonding curve not found");
    if (state.graduated) throw new Error("Token graduated - use Raydium");

    const tokensOut = this.estimateBuy(state, solAmount);
    const minTokens = Math.floor(tokensOut * (1 - slippage / 10000));

    if (this.dryRun) {
      return {
        type: "buy", mint, solAmount, tokensOut, minTokens,
        price: this.getPrice(state), dryRun: true,
        sig: "DRY_" + Date.now().toString(36),
      };
    }

    // Build and send transaction (simplified - actual impl needs full IX encoding)
    const sig = await this._sendPumpTx(keypair, mint, "buy", solAmount, minTokens, opts);
    return { type: "buy", mint, solAmount, tokensOut, sig, price: this.getPrice(state) };
  }

  // Execute sell
  async sell(keypair, mint, tokenAmount, opts = {}) {
    const slippage = opts.slippage || CONFIG.SLIPPAGE_BPS;
    const state = await this.getCurveState(mint);
    if (!state) throw new Error("Bonding curve not found");
    if (state.graduated) throw new Error("Token graduated - use Raydium");

    const solOut = this.estimateSell(state, tokenAmount);
    const minSol = Math.floor(solOut * (1 - slippage / 10000));

    if (this.dryRun) {
      return {
        type: "sell", mint, tokenAmount, solOut: solOut / 1e9, minSol: minSol / 1e9,
        price: this.getPrice(state), dryRun: true,
        sig: "DRY_" + Date.now().toString(36),
      };
    }

    const sig = await this._sendPumpTx(keypair, mint, "sell", tokenAmount, minSol, opts);
    return { type: "sell", mint, tokenAmount, solOut: solOut / 1e9, sig, price: this.getPrice(state) };
  }

  async _sendPumpTx(keypair, mint, side, amount, minOut, opts) {
    // Instruction encoding for pump.fun buy/sell
    // This is a simplified stub - full impl requires anchor IDL decoding
    const tx = new Transaction();
    tx.feePayer = keypair.publicKey;
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    // Priority fee
    if (CONFIG.PRIORITY_FEE > 0) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: keypair.publicKey,
          lamports: 0,
        })
      );
    }

    // TODO: Add actual pump.fun instruction encoding
    // For now this is a scaffold
    console.log(`[PUMP] ${side.toUpperCase()} ${amount} on ${mint}`);
    
    tx.sign(keypair);
    const sig = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    await this.connection.confirmTransaction(sig, "confirmed");
    return sig;
  }
}

export default PumpFunClient;
