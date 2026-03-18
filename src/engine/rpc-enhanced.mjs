// BONDLI v4.0 — RPC Enhanced (Priority Fees + Optimized Tx Sending)
// Works with any standard Solana RPC provider (Alchemy, etc.)
import bs58 from "bs58";
import CONFIG from "./config.mjs";

// Get optimal priority fee using Solana's getRecentPrioritizationFees RPC
export async function getOptimalPriorityFee(accountKeys = []) {
  try {
    const response = await fetch(CONFIG.RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "getRecentPrioritizationFees",
        params: accountKeys.length > 0 ? [accountKeys] : [],
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.result && data.result.length > 0) {
        // Get 75th percentile of recent priority fees
        const fees = data.result.map(f => f.prioritizationFee).sort((a, b) => a - b);
        const p75 = fees[Math.floor(fees.length * 0.75)] || fees[fees.length - 1];
        // Clamp between 10k and 500k microLamports
        return Math.max(10_000, Math.min(500_000, Math.ceil(p75)));
      }
    }
  } catch (e) {
    console.warn(`[RPC] Priority fee estimate failed: ${e.message}`);
  }

  return CONFIG.PRIORITY_FEE;
}

// Send transaction via RPC with optimized params
export async function smartSend(connection, serializedTx, opts = {}) {
  try {
    const base58Tx = bs58.encode(serializedTx);
    const res = await fetch(CONFIG.RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "sendTransaction",
        params: [base58Tx, {
          skipPreflight: true,
          encoding: "base58",
          maxRetries: 5,
        }],
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.result) return data.result;
      if (data.error) console.warn(`[RPC-TX] Error: ${JSON.stringify(data.error)}`);
    }
  } catch (e) {
    console.warn(`[RPC-TX] Send failed, falling back: ${e.message}`);
  }

  // Fallback: standard Connection.sendRawTransaction
  return connection.sendRawTransaction(serializedTx, {
    skipPreflight: true,
    maxRetries: 3,
    ...opts,
  });
}

// Get token metadata via standard RPC
export async function getTokenMetadata(mintAddress) {
  try {
    const res = await fetch(CONFIG.RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "getAccountInfo",
        params: [mintAddress, { encoding: "jsonParsed" }],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      return data.result?.value || null;
    }
  } catch {}
  return null;
}

export default { getOptimalPriorityFee, smartSend, getTokenMetadata };
