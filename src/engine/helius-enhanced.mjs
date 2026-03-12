// BONDLI v4.0 — Helius Enhanced (Priority Fees + Smart Transactions)
// Uses helius-sdk for optimal fee estimation and tx landing
import { createHelius } from "helius-sdk";
import { Connection, VersionedTransaction, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import CONFIG from "./config.mjs";

let _helius = null;

export function getHelius() {
  if (!_helius && CONFIG.HELIUS_API_KEY) {
    _helius = createHelius(CONFIG.HELIUS_API_KEY);
  }
  return _helius;
}

// Get optimal priority fee for current network conditions
// Returns microLamports (use in ComputeBudgetProgram.setComputeUnitPrice)
export async function getOptimalPriorityFee(accountKeys = []) {
  const helius = getHelius();
  if (!helius) return CONFIG.PRIORITY_FEE; // fallback to static

  try {
    const response = await fetch(CONFIG.RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "getPriorityFeeEstimate",
        params: [{
          accountKeys: accountKeys.length > 0 ? accountKeys : undefined,
          options: { priorityLevel: "High" },
        }],
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.result?.priorityFeeEstimate) {
        const fee = Math.ceil(data.result.priorityFeeEstimate);
        // Clamp between 50k and 2M microLamports
        return Math.max(50_000, Math.min(2_000_000, fee));
      }
    }
  } catch (e) {
    console.warn(`[HELIUS] Priority fee estimate failed: ${e.message}`);
  }

  return CONFIG.PRIORITY_FEE; // fallback
}

// Send transaction via Helius smart transaction API (auto-retry, optimized landing)
// Falls back to standard sendRawTransaction if smart tx not available
export async function heliusSmartSend(connection, serializedTx, opts = {}) {
  // Try Helius staked sendTransaction endpoint first
  if (CONFIG.HELIUS_SEND_TX_URL) {
    try {
      const base58Tx = bs58.encode(serializedTx);
      const res = await fetch(CONFIG.HELIUS_SEND_TX_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "sendTransaction",
          params: [base58Tx, {
            skipPreflight: true,
            encoding: "base58",
            maxRetries: 5,
            // Helius enhanced options
            ...(CONFIG.HELIUS_SMART_TX ? { preflightCommitment: "confirmed" } : {}),
          }],
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.result) return data.result;
        if (data.error) console.warn(`[HELIUS-TX] Error: ${JSON.stringify(data.error)}`);
      }
    } catch (e) {
      console.warn(`[HELIUS-TX] Smart send failed, falling back: ${e.message}`);
    }
  }

  // Fallback: standard RPC
  return connection.sendRawTransaction(serializedTx, {
    skipPreflight: true,
    maxRetries: 3,
    ...opts,
  });
}

// Get token metadata via Helius DAS (Digital Asset Standard)
export async function getTokenMetadata(mintAddress) {
  if (!CONFIG.HELIUS_API_KEY) return null;

  try {
    const res = await fetch(CONFIG.RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "getAsset",
        params: { id: mintAddress },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      return data.result || null;
    }
  } catch {}
  return null;
}

export default { getHelius, getOptimalPriorityFee, heliusSmartSend, getTokenMetadata };
