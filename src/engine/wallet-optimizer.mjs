// BONDLI v3.0 — Wallet Optimizer (count, roles, Kelly sizing)
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import CONFIG, { WALLET_ROLES, getWalletCount } from "./config.mjs";

export class WalletOptimizer {
  constructor() {
    this.masterKeypair = null;
    this.wallets = [];
  }

  // Initialize master wallet from seed
  initMaster() {
    if (!CONFIG.MASTER_SEED) throw new Error("MASTER_SEED not set");
    const secret = bs58.decode(CONFIG.MASTER_SEED);
    this.masterKeypair = Keypair.fromSecretKey(secret);
    console.log(`[WALLET] Master: ${this.masterKeypair.publicKey.toBase58().slice(0,8)}...`);
    return this.masterKeypair;
  }

  // Generate wallet fleet based on budget
  generateFleet(totalSol) {
    const count = getWalletCount(totalSol || CONFIG.TOTAL_SOL);
    this.wallets = [];

    for (let i = 0; i < count; i++) {
      const kp = Keypair.generate();
      const roleIdx = i % WALLET_ROLES.length;
      const role = WALLET_ROLES[roleIdx];

      // Kelly-criterion inspired sizing
      const baseAlloc = totalSol * role.weight;
      const kelly = this._kellySize(role, totalSol);

      this.wallets.push({
        index: i,
        keypair: kp,
        pubkey: kp.publicKey.toBase58(),
        role: role.role,
        emoji: role.emoji,
        allocation: Math.min(baseAlloc, kelly),
        funded: false,
        active: false,
        trades: [],
        pnl: 0,
      });
    }

    console.log(`[WALLET] Generated ${count} wallets for ${totalSol} SOL`);
    return this.wallets;
  }

  // Kelly criterion sizing
  _kellySize(role, totalSol) {
    // Simplified Kelly: f* = (p*b - q) / b
    // where p = win probability, b = win/loss ratio, q = 1-p
    const winProb = {
      sniper: 0.55, accumulator: 0.60, momentum: 0.50,
      swing: 0.45, whale: 0.40, liquidator: 0.65, recycler: 0.70,
    }[role.role] || 0.50;

    const winLossRatio = 2.0; // target 2:1
    const q = 1 - winProb;
    const kelly = (winProb * winLossRatio - q) / winLossRatio;
    const fractionalKelly = kelly * 0.5; // half-Kelly for safety

    return Math.max(0.001, totalSol * role.weight * Math.max(0.1, fractionalKelly));
  }

  // Get wallet by role
  getByRole(role) {
    return this.wallets.filter(w => w.role === role);
  }

  // Summary
  summary() {
    return this.wallets.map(w => ({
      idx: w.index,
      role: w.role,
      emoji: w.emoji,
      pubkey: w.pubkey.slice(0,8) + "...",
      alloc: w.allocation.toFixed(4),
      funded: w.funded,
      trades: w.trades.length,
      pnl: w.pnl.toFixed(4),
    }));
  }
}

export default WalletOptimizer;
