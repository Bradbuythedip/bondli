// BONDLI v4.2 — RPC Enhanced (Priority Fees + Jito Bundles + Multi-RPC Failover + Caching)
import bs58 from "bs58";
import CONFIG from "./config.mjs";

// ── Priority fee cache (avoid calling getRecentPrioritizationFees every trade) ──
let _cachedPriorityFee = CONFIG.PRIORITY_FEE;
let _priorityFeeTs = 0;
const PRIORITY_FEE_TTL = 10_000; // cache for 10s (was called every trade)

// ── Blockhash cache (reuse across trades within same slot window) ──
let _cachedBlockhash = null;
let _cachedBlockHeight = 0;
let _blockhashTs = 0;
const BLOCKHASH_TTL = 8_000; // cache for 8s (~20 slots, still well within 150-slot validity)

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

// Jito tip accounts — one is chosen at random per bundle
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
const JITO_BLOCK_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";

// Get optimal priority fee — cached for 10s to avoid burning RPC calls every trade
export async function getOptimalPriorityFee(accountKeys = []) {
  // Return cached value if fresh
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
        const p75 = fees[Math.floor(fees.length * 0.75)] || fees[fees.length - 1];
        _cachedPriorityFee = Math.max(10_000, Math.min(500_000, Math.ceil(p75)));
        _priorityFeeTs = Date.now();
        return _cachedPriorityFee;
      }
    }
  } catch (e) {
    console.warn(`[RPC] Priority fee estimate failed: ${e.message}`);
  }

  return _cachedPriorityFee;
}

// Send transaction via Jito bundle for MEV protection + faster inclusion
export async function jitoSend(serializedTx) {
  const base58Tx = bs58.encode(serializedTx);
  try {
    const res = await fetch(JITO_BLOCK_ENGINE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "sendBundle",
        params: [[base58Tx]],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.result) {
        console.log(`[JITO] Bundle accepted: ${data.result}`);
        return data.result;
      }
      if (data.error) {
        console.warn(`[JITO] Bundle rejected: ${JSON.stringify(data.error)}`);
      }
    }
  } catch (e) {
    console.warn(`[JITO] Send failed: ${e.message}`);
  }
  return null;
}

// Get a random Jito tip account
export function getJitoTipAccount() {
  return JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
}

// Multi-RPC failover URLs (set BACKUP_RPC_URL env var for secondary)
const RPC_URLS = [CONFIG.RPC_URL];
if (process.env.BACKUP_RPC_URL) RPC_URLS.push(process.env.BACKUP_RPC_URL);
if (process.env.BACKUP_RPC_URL_2) RPC_URLS.push(process.env.BACKUP_RPC_URL_2);

// Send transaction via RPC with Jito-first strategy + multi-RPC failover
// Strategy: race Jito bundle + primary RPC simultaneously for fastest inclusion
export async function smartSend(connection, serializedTx, opts = {}) {
  const base58Tx = bs58.encode(serializedTx);

  // Race strategy: send to Jito AND RPC simultaneously, first success wins
  const rpcSend = async (rpcUrl) => {
    const res = await fetch(rpcUrl, {
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
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.result) return data.result;
      if (data.error) {
        const errMsg = JSON.stringify(data.error);
        if (errMsg.includes("insufficient") || errMsg.includes("Blockhash not found")) {
          throw new Error(errMsg); // non-retryable
        }
        throw new Error(errMsg);
      }
    }
    throw new Error("RPC response not ok");
  };

  // Send to all RPCs + Jito simultaneously
  const candidates = RPC_URLS.map(url => rpcSend(url));
  candidates.push(jitoSend(serializedTx).then(r => { if (!r) throw new Error("Jito failed"); return r; }));

  try {
    return await Promise.any(candidates);
  } catch {
    // All failed — last resort fallback
    console.warn("[RPC-TX] All send paths failed, using connection.sendRawTransaction fallback");
    return connection.sendRawTransaction(serializedTx, {
      skipPreflight: true,
      maxRetries: 3,
      ...opts,
    });
  }
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

export default { getOptimalPriorityFee, smartSend, jitoSend, getJitoTipAccount, getTokenMetadata, getCachedBlockhash };
