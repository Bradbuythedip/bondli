/**
 * ═══════════════════════════════════════════════════
 * SESSION MANAGER — Dev Wallet Generation + Funding
 * ═══════════════════════════════════════════════════
 *
 * Flow:
 *   1. User picks SOL budget + token config
 *   2. Backend generates a fresh Keypair (dev wallet)
 *   3. User sends SOL from Phantom → dev wallet
 *   4. Backend confirms deposit on-chain
 *   5. Dev wallet creates token + dev buy
 *   6. Remaining SOL distributes to fleet
 *   7. Fleet trades autonomously
 *
 * Dev buy formula:
 *   < 1 SOL  → 8% (min 0.05 SOL)
 *   1-5 SOL  → 5%
 *   5-15 SOL → 3.5%
 *   15+ SOL  → 2.5% (max 2 SOL)
 */

import {
  Keypair,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import bs58 from "bs58";
import CONFIG from "./config.mjs";

// ═══════════════════════════════════════
// DEV BUY CALCULATOR
// ═══════════════════════════════════════
export function calculateDevBuy(totalSol) {
  let pct, min, max;

  // Aggressive dev buy — big initial candle on chart
  if (totalSol < 1) {
    pct = 0.50; min = 0.1; max = 0.5;
  } else if (totalSol < 5) {
    pct = 0.40; min = 0.3; max = 2.0;
  } else if (totalSol < 15) {
    pct = 0.25; min = 1.0; max = 4.0;
  } else {
    pct = 0.15; min = 2.0; max = 8.0;
  }

  const raw = totalSol * pct;
  const devBuy = Math.min(max, Math.max(min, raw));
  const fleetBudget = totalSol - devBuy - 0.02; // 0.02 SOL reserve for token creation tx fee

  return {
    devBuy: +devBuy.toFixed(4),
    creationFee: 0.02,
    fleetBudget: +Math.max(0, fleetBudget).toFixed(4),
    devBuyPercent: +((devBuy / totalSol) * 100).toFixed(1),
    breakdown: {
      totalSol,
      devBuy: +devBuy.toFixed(4),
      creationFee: 0.02,
      fleet: +Math.max(0, fleetBudget).toFixed(4),
    },
  };
}

// ═══════════════════════════════════════
// SESSION STORE
// ═══════════════════════════════════════
export class SessionManager {
  constructor(redis) {
    this.redis = redis;
    this.sessions = new Map(); // in-memory fallback
    this.pollIntervals = new Map();
  }

  // Create a new launch session
  async create({ userWallet, totalSol, tokenConfig, tier, fleetConfig, masterSeed }) {
    let devKeypair, devWallet, devSecret;
    if (masterSeed) {
      try {
        devKeypair = Keypair.fromSecretKey(bs58.decode(masterSeed));
        devWallet = devKeypair.publicKey.toString();
        devSecret = masterSeed;
      } catch (e) {
        devKeypair = Keypair.generate();
        devWallet = devKeypair.publicKey.toString();
        devSecret = bs58.encode(devKeypair.secretKey);
      }
    } else {
      devKeypair = Keypair.generate();
      devWallet = devKeypair.publicKey.toString();
      devSecret = bs58.encode(devKeypair.secretKey);
    }

    const isApe = !!(tokenConfig?.existingCA);
    const devBuyInfo = isApe
      ? { devBuy: 0, creationFee: 0, fleetBudget: totalSol, devBuyPercent: 0 }
      : calculateDevBuy(totalSol);

    const session = {
      id: "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
      userWallet,
      devWallet,
      devSecret, // stored encrypted in prod — plaintext for now
      totalSol,
      tier: tier || "free",
      devBuy: devBuyInfo.devBuy,
      creationFee: devBuyInfo.creationFee,
      fleetBudget: devBuyInfo.fleetBudget,
      tokenConfig: {
        name: tokenConfig.name || "",
        ticker: tokenConfig.ticker || "",
        description: tokenConfig.description || "",
        image: tokenConfig.image || null, // base64 or URI
        twitter: tokenConfig.twitter || "",
        telegram: tokenConfig.telegram || "",
        website: tokenConfig.website || "",
        existingCA: tokenConfig.existingCA || "",
      },
      fleetConfig: {
        sniperCount: fleetConfig?.sniperCount || 2,
        slippage: fleetConfig?.slippage || 25,
        duration: fleetConfig?.duration || 60,
        jitoTip: fleetConfig?.jitoTip || 0.001,
      },
      useMaster: !!masterSeed,
      status: masterSeed ? "funded" : "awaiting_deposit", // awaiting_deposit → funded → creating → live → closing → closed
      funded: !!masterSeed,
      depositTx: null,
      tokenCA: tokenConfig.existingCA || null,
      createdAt: new Date().toISOString(),
      fundedAt: null,
      launchedAt: null,
    };

    // Store
    this.sessions.set(session.id, session);
    if (this.redis) {
      try {
        await this.redis.set("session:" + session.id, JSON.stringify(session), "EX", 86400); // 24h TTL
      } catch {}
    }

    console.log(`[SESSION] Created ${session.id} | dev: ${devWallet} | budget: ${totalSol} SOL | devBuy: ${devBuyInfo.devBuy} SOL`);

    // Return info including private key — user needs this for pumpfun creator fees
    return {
      sessionId: session.id,
      devWallet,
      devSecret, // user imports this into Phantom to claim creator fees
      totalSol,
      devBuy: devBuyInfo.devBuy,
      creationFee: devBuyInfo.creationFee,
      fleetBudget: devBuyInfo.fleetBudget,
      devBuyPercent: devBuyInfo.devBuyPercent,
      useMaster: !!masterSeed,
      funded: !!masterSeed,
      status: masterSeed ? "funded" : "awaiting_deposit",
    };
  }

  // Get session (internal, includes secret)
  async get(sessionId) {
    let session = this.sessions.get(sessionId);
    if (!session && this.redis) {
      try {
        const raw = await this.redis.get("session:" + sessionId);
        if (raw) { session = JSON.parse(raw); this.sessions.set(sessionId, session); }
      } catch {}
    }
    return session || null;
  }

  // Get session public info (no secrets)
  async getPublic(sessionId) {
    const s = await this.get(sessionId);
    if (!s) return null;
    const { devSecret, ...pub } = s;
    return pub;
  }

  // Update session
  async update(sessionId, updates) {
    const session = await this.get(sessionId);
    if (!session) return null;
    Object.assign(session, updates);
    this.sessions.set(sessionId, session);
    if (this.redis) {
      try { await this.redis.set("session:" + sessionId, JSON.stringify(session), "EX", 86400); } catch {}
    }
    return session;
  }

  // Verify deposit arrived on-chain
  async verifyDeposit(sessionId, txSig) {
    const session = await this.get(sessionId);
    if (!session) return { ok: false, error: "Session not found" };
    if (session.funded) return { ok: true, already: true };

    try {
      const connection = new Connection(CONFIG.RPC_URL, "confirmed");

      // Check tx
      const tx = await connection.getTransaction(txSig, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });

      if (!tx) return { ok: false, error: "Transaction not found. Wait for confirmation." };
      if (tx.meta?.err) return { ok: false, error: "Transaction failed on-chain" };

      // Verify SOL arrived at dev wallet
      const balance = await connection.getBalance(new PublicKey(session.devWallet));
      const balanceSol = balance / LAMPORTS_PER_SOL;

      // Need at least 95% of expected amount (tolerance for fees)
      const expectedMin = session.totalSol * 0.95;
      if (balanceSol < expectedMin) {
        return {
          ok: false,
          error: `Dev wallet has ${balanceSol.toFixed(4)} SOL, need at least ${expectedMin.toFixed(4)} SOL`,
          current: balanceSol,
          expected: session.totalSol,
        };
      }

      // Mark funded
      await this.update(sessionId, {
        funded: true,
        depositTx: txSig,
        fundedAt: new Date().toISOString(),
        status: "funded",
        actualDeposit: balanceSol,
      });

      console.log(`[SESSION] ${sessionId} funded | ${balanceSol.toFixed(4)} SOL | tx: ${txSig.slice(0, 12)}...`);

      return {
        ok: true,
        balanceSol,
        devWallet: session.devWallet,
        devBuy: session.devBuy,
        fleetBudget: session.fleetBudget,
      };

    } catch (e) {
      console.error(`[SESSION] Deposit verify error:`, e.message);
      return { ok: false, error: "Verification failed: " + e.message };
    }
  }

  // Get the dev keypair for launching (internal only)
  async getDevKeypair(sessionId) {
    const session = await this.get(sessionId);
    if (!session || !session.devSecret) return null;
    try {
      return Keypair.fromSecretKey(bs58.decode(session.devSecret));
    } catch {
      return null;
    }
  }

  // List user's sessions
  async listForUser(userWallet) {
    const results = [];
    for (const [, session] of this.sessions) {
      if (session.userWallet === userWallet) {
        const { devSecret, ...pub } = session;
        results.push(pub);
      }
    }
    return results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}
