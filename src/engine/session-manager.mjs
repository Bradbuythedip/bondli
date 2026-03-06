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
 * Dev buy formula (v3.1 — optimized):
 *   < 0.5 SOL → 15% (min 0.03, max 0.075)
 *   0.5-2 SOL → 12% (min 0.06, max 0.24)
 *   2-5 SOL   → 10% (min 0.15, max 0.5)
 *   5-15 SOL  → 8%  (min 0.3, max 1.2)
 *   15+ SOL   → 5%  (min 0.5, max 2.0)
 *
 * Axiom: Dev buy creates a VISIBLE candle without moving the curve
 * so far that fleet pays inflated prices. On pump.fun (~30 SOL virtual
 * reserves), 0.1 SOL moves price ~0.33%. Old 40-50% formula moved
 * price 3-6% which made fleet entry expensive and dev buy detectable.
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
// DEV BUY CALCULATOR (v3.1 — optimized sweet spot)
// Target: 0.3-1.5% price impact (visible candle, cheap fleet entry)
// ═══════════════════════════════════════
export function calculateDevBuy(totalSol) {
  let pct, min, max;

  if (totalSol < 0.5) {
    // Micro budget: 15% — just enough to show on chart
    pct = 0.15; min = 0.03; max = 0.075;
  } else if (totalSol < 2) {
    // Small budget: 12% — visible candle, leaves 88% for fleet
    pct = 0.12; min = 0.06; max = 0.24;
  } else if (totalSol < 5) {
    // Medium budget: 10% — solid candle, 90% fleet
    pct = 0.10; min = 0.15; max = 0.5;
  } else if (totalSol < 15) {
    // Large budget: 8% — enough for attention, 92% fleet
    pct = 0.08; min = 0.3; max = 1.2;
  } else {
    // Whale budget: 5% — don't be the biggest candle
    pct = 0.05; min = 0.5; max = 2.0;
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
    const isDeployOnly = !!(fleetConfig?.deployOnly);
    const devBuyInfo = isApe
      ? { devBuy: 0, creationFee: 0, fleetBudget: totalSol, devBuyPercent: 0 }
      : isDeployOnly
        ? { devBuy: 0, creationFee: 0.02, fleetBudget: 0, devBuyPercent: 0 }
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

  // Delete a single session
  async delete(sessionId) {
    this.sessions.delete(sessionId);
    if (this.redis) {
      try {
        await this.redis.del("session:" + sessionId);
        await this.redis.del("fleetkeys:" + sessionId);
      } catch {}
    }
    return true;
  }

  // Delete all sessions for a user
  async deleteAllForUser(userWallet) {
    let count = 0;
    const toDelete = [];
    for (const [id, session] of this.sessions) {
      if (session.userWallet === userWallet) toDelete.push(id);
    }
    for (const id of toDelete) {
      await this.delete(id);
      count++;
    }
    return count;
  }

  // ═══════════════════════════════════════
  // GET BY WALLET — returns all sessions for a user (with fleet keys)
  // CRITICAL: /api/positions and /api/quick-sell depend on this method.
  // Without it, fleet wallets are never scanned for token holdings.
  // ═══════════════════════════════════════
  async getByWallet(userWallet) {
    const results = [];
    const seenIds = new Set();

    // Check in-memory sessions
    for (const [, session] of this.sessions) {
      if (session.userWallet === userWallet) {
        results.push(session);
        seenIds.add(session.id);
      }
    }

    // Check Redis for any sessions not in memory
    if (this.redis) {
      try {
        const keys = await this.redis.keys("session:*");
        for (const key of keys) {
          const raw = await this.redis.get(key);
          if (!raw) continue;
          try {
            const session = JSON.parse(raw);
            if (session.userWallet === userWallet && !seenIds.has(session.id)) {
              results.push(session);
              seenIds.add(session.id);
              // Hydrate in-memory cache
              this.sessions.set(session.id, session);
            }
          } catch {}
        }
      } catch {}
    }

    return results;
  }
}
