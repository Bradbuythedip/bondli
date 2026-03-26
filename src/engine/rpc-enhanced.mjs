// BONDLI v4.3 — RPC Enhanced (Priority Fees + Jito Bundles + Multi-RPC Failover + Retry)
import bs58 from "bs58";
import CONFIG from "./config.mjs";

// ── Priority fee cache ──
let _cachedPriorityFee = CONFIG.PRIORITY_FEE;
let _priorityFeeTs = 0;
const PRIORITY_FEE_TTL = 10_000;

// ── Blockhash cache ──
let _cachedBlockhash = null;
let _cachedBlockHeight = 0;
let _blockhashTs = 0;
const BLOCKHASH_TTL = 4_000; // 4s — shorter to avoid stale blockhash errors

export async function getCachedBlockhash(connection) {
  if (_cachedBlockhash && Date.now() - _blockhashTs < BLOCKHASH_TTL) {
    return { blockhash: _cachedBlockhash, lastValidBlockHeight: _cachedBlockHeight };
  }
  const result = await connection.getLatestBlockhash("confirmed");
  _cachedBlockhash = result.blockhash;
  _cachedBlockHeight = result.lastValidBlockHeight;
  _blockhashTs = Date.now();
  return result;
}

// ── Jito ──
const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4bPg4W6U6viQCi4LfbCR5iV",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSouaMnkQ3JrqERm9Hx",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

// Multiple Jito block engines for redundancy
const JITO_ENDPOINTS = [
  "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles",
];

export async function getOptimalPriorityFee(accountKeys = []) {
  if (Date.now() - _priorityFeeTs < PRIORITY_FEE_TTL) return _cachedPriorityFee;
  try {
    const response = await fetch(CONFIG.RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "getRecentPrioritizationFees",
        params: accountKeys.length > 0 ? [accountKeys] : [],
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = await response.json();
      if (data.result && data.result.length > 0) {
        const fees = data.result.map(f => f.prioritizationFee).sort((a, b) => a - b);
        // Use p90 instead of p75 for better inclusion during congestion
        const p90 = fees[Math.floor(fees.length * 0.9)] || fees[fees.length - 1];
        _cachedPriorityFee = Math.max(50_000, Math.min(1_000_000, Math.ceil(p90)));
        _priorityFeeTs = Date.now();
        return _cachedPriorityFee;
      }
    }
  } catch (e) {
    console.warn(`[RPC] Priority fee estimate failed: ${e.message}`);
  }
  return _cachedPriorityFee;
}

// Send to a single Jito endpoint
async function jitoSendSingle(base58Tx, endpoint) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[base58Tx]] }),
    signal: AbortSignal.timeout(8000),
  });
  if (res.ok) {
    const data = await res.json();
    if (data.result) return data.result;
    if (data.error) throw new Error(JSON.stringify(data.error));
  }
  throw new Error("Jito not ok");
}

// Send via Jito — race all endpoints simultaneously
export async function jitoSend(serializedTx) {
  const base58Tx = bs58.encode(serializedTx);
  try {
    // Race ALL Jito endpoints — first to accept wins
    const result = await Promise.any(
      JITO_ENDPOINTS.map(ep => jitoSendSingle(base58Tx, ep))
    );
    console.log(`[JITO] Bundle accepted: ${result}`);
    return result;
  } catch (e) {
    console.warn(`[JITO] All endpoints failed: ${e.message}`);
    return null;
  }
}

export function getJitoTipAccount() {
  return JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
}

// Multi-RPC failover URLs
const RPC_URLS = [CONFIG.RPC_URL];
if (process.env.BACKUP_RPC_URL) RPC_URLS.push(process.env.BACKUP_RPC_URL);
if (process.env.BACKUP_RPC_URL_2) RPC_URLS.push(process.env.BACKUP_RPC_URL_2);

// Stats for monitoring
const _sendStats = { total: 0, rpcOk: 0, jitoOk: 0, fallbackOk: 0, failed: 0 };

/**
 * Send transaction via RPC + Jito racing + retry.
 * Strategy:
 *   1. Send to all RPCs + all Jito endpoints simultaneously (Promise.any)
 *   2. If all fail, retry once after 500ms with fresh connection
 *   3. If retry fails, use connection.sendRawTransaction as last resort
 */
export async function smartSend(connection, serializedTx, opts = {}) {
  _sendStats.total++;
  const base58Tx = bs58.encode(serializedTx);

  const rpcSend = async (rpcUrl) => {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "sendTransaction",
        params: [base58Tx, { skipPreflight: true, encoding: "base58", maxRetries: 8 }],
      }),
      signal: AbortSignal.timeout(10000), // 10s — was 6s, too short for congestion
    });
    if (res.ok) {
      const data = await res.json();
      if (data.result) { _sendStats.rpcOk++; return data.result; }
      if (data.error) {
        const errMsg = JSON.stringify(data.error);
        // Non-retryable errors
        if (errMsg.includes("insufficient") || errMsg.includes("Blockhash not found") || errMsg.includes("already processed")) {
          throw new Error(errMsg);
        }
        throw new Error(errMsg);
      }
    }
    throw new Error("RPC response not ok");
  };

  // Attempt 1: race all paths
  const attempt = () => {
    const candidates = [
      ...RPC_URLS.map(url => rpcSend(url)),
      jitoSend(serializedTx).then(r => { if (!r) throw new Error("Jito failed"); _sendStats.jitoOk++; return r; }),
    ];
    return Promise.any(candidates);
  };

  try {
    return await attempt();
  } catch (firstErr) {
    // Check if it's a non-retryable error
    const msg = firstErr?.errors?.map(e => e.message).join("; ") || firstErr.message || "";
    if (msg.includes("insufficient") || msg.includes("Blockhash not found")) {
      console.error(`[RPC-TX] Non-retryable: ${msg}`);
      throw firstErr;
    }

    // Retry once after 500ms
    console.warn(`[RPC-TX] First attempt failed, retrying in 500ms...`);
    await new Promise(r => setTimeout(r, 500));

    try {
      return await attempt();
    } catch {
      // Last resort: direct connection.sendRawTransaction
      console.warn("[RPC-TX] All send paths failed x2, using connection.sendRawTransaction");
      try {
        const sig = await connection.sendRawTransaction(serializedTx, {
          skipPreflight: true,
          maxRetries: 5,
          ...opts,
        });
        _sendStats.fallbackOk++;
        return sig;
      } catch (e) {
        _sendStats.failed++;
        console.error(`[RPC-TX] All paths exhausted: ${e.message}`);
        throw e;
      }
    }
  }
}

// Get send stats for diagnostics
export function getSendStats() {
  return { ..._sendStats };
}

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

export default { getOptimalPriorityFee, smartSend, jitoSend, getJitoTipAccount, getTokenMetadata, getCachedBlockhash, getSendStats };
