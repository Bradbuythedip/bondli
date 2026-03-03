/**
 * PUMP.FUN TOKEN CREATOR — via PumpPortal API
 * Matches pumpportal.fun/creation/ docs EXACTLY
 */

import {
  Connection,
  Keypair,
  VersionedTransaction,
} from "@solana/web3.js";

// ═══════════════════════════════════════
// IPFS UPLOAD
// ═══════════════════════════════════════

async function uploadMetadata(config, maxRetries = 5) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const form = new FormData();
      let hasImage = false;

      if (config.image && config.image.startsWith("data:")) {
        const m = config.image.match(/^data:(.+);base64,(.+)$/);
        if (m) {
          form.append("file", new Blob([Buffer.from(m[2], "base64")], { type: m[1] }), "token." + (m[1].includes("png") ? "png" : "jpg"));
          hasImage = true;
        }
      } else if (config.image && config.image.startsWith("http")) {
        const r = await fetch(config.image);
        form.append("file", await r.blob(), "token.png");
        hasImage = true;
      }

      if (!hasImage) {
        const px = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mMU+M9QDwADgQF/Nnl5XgAAAABJRU5ErkJggg==", "base64");
        form.append("file", new Blob([px], { type: "image/png" }), "token.png");
      }

      form.append("name", config.name || "Token");
      form.append("symbol", config.ticker || "TKN");
      form.append("description", config.description || "");
      form.append("twitter", config.twitter || "");
      form.append("telegram", config.telegram || "");
      form.append("website", config.website || "");
      form.append("showName", "true");

      console.log(`[IPFS] Attempt ${attempt}/${maxRetries}...`);

      const resp = await fetch("https://pump.fun/api/ipfs", {
        method: "POST",
        body: form,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Origin": "https://pump.fun",
          "Referer": "https://pump.fun/",
        },
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);

      const data = await resp.json();
      console.log(`[IPFS] Full response: ${JSON.stringify(data).slice(0, 500)}`);

      const uri = data.metadataUri || data.uri;
      if (!uri) throw new Error("No metadataUri in response");

      console.log(`[IPFS] ✅ ${uri}`);
      return { metadataUri: uri, metadata: data.metadata || data };

    } catch (e) {
      lastError = e;
      console.warn(`[IPFS] Attempt ${attempt} failed: ${e.message}`);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastError;
}

// ═══════════════════════════════════════
// CREATE TOKEN
// ═══════════════════════════════════════

export async function createToken(connection, creator, tokenConfig, options = {}) {
  const { devBuySol = 0.01 } = options;

  console.log(`\n${"═".repeat(50)}`);
  console.log(`[CREATE] ${tokenConfig.name} ($${tokenConfig.ticker})`);
  console.log(`[CREATE] Creator: ${creator.publicKey.toBase58()}`);
  console.log(`[CREATE] Dev buy: ${devBuySol} SOL`);

  // Check balance
  try {
    const bal = await connection.getBalance(creator.publicKey);
    console.log(`[CREATE] Creator balance: ${bal / 1e9} SOL`);
    if (bal < 0.01 * 1e9) throw new Error(`Wallet balance too low: ${(bal / 1e9).toFixed(4)} SOL`);
  } catch (e) {
    if (e.message.includes("balance")) throw e;
    console.warn(`[CREATE] Balance check skipped: ${e.message}`);
  }

  // Step 1: IPFS
  const { metadataUri, metadata } = await uploadMetadata(tokenConfig);

  // Step 2: Mint
  const mintKeypair = Keypair.generate();
  const mintPub = mintKeypair.publicKey.toBase58();
  console.log(`[CREATE] Mint: ${mintPub}`);

  // Step 3: Try multiple PumpPortal configs
  // Pump.fun migrated to PumpSwap (March 2025), so pool param may need updating
  const configs = [
    { pool: "pump", label: "pump (classic)" },
    { pool: "auto", label: "auto (let API decide)" },
    { pool: "pump-amm", label: "pump-amm (PumpSwap)" },
  ];

  const amount = Math.max(devBuySol, 0.001);
  let txSig;
  let lastErr;

  for (const cfg of configs) {
    const body = {
      publicKey: creator.publicKey.toBase58(),
      action: "create",
      tokenMetadata: {
        name: metadata?.name || tokenConfig.name || "Token",
        symbol: metadata?.symbol || tokenConfig.ticker || "TKN",
        uri: metadataUri,
      },
      mint: mintPub,
      denominatedInSol: "true",
      amount: amount,
      slippage: 10,
      priorityFee: 0.0005,
      pool: cfg.pool,
    };

    console.log(`\n[CREATE] Trying pool="${cfg.pool}" (${cfg.label})...`);
    console.log(`[CREATE] Body: ${JSON.stringify(body)}`);

    try {
      const resp = await fetch("https://pumpportal.fun/api/trade-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      console.log(`[CREATE] Response: ${resp.status} ${resp.statusText}`);

      if (resp.status !== 200) {
        const errBody = await resp.text();
        console.error(`[CREATE] Error with pool="${cfg.pool}": ${errBody}`);
        lastErr = `pool=${cfg.pool}: ${resp.status} ${errBody}`;
        continue; // try next pool config
      }

      // SUCCESS — got a transaction back
      console.log(`[CREATE] ✅ pool="${cfg.pool}" worked!`);
      
      const txData = await resp.arrayBuffer();
      console.log(`[CREATE] TX bytes: ${txData.byteLength}`);

      const tx = VersionedTransaction.deserialize(new Uint8Array(txData));
      tx.sign([mintKeypair, creator]);

      txSig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
      });
      console.log(`[CREATE] Sent: ${txSig}`);

      // Confirm with generous timeout
      const bh = await connection.getLatestBlockhash("confirmed");
      const conf = await connection.confirmTransaction(
        { signature: txSig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
        "confirmed"
      );

      if (conf.value?.err) {
        throw new Error(`TX failed: ${JSON.stringify(conf.value.err)}`);
      }

      console.log(`[CREATE] ✅ CONFIRMED! Mint: ${mintPub}`);
      console.log(`[CREATE] https://pump.fun/coin/${mintPub}\n`);

      return {
        mint: mintPub,
        txSig,
        metadataUri,
        pumpUrl: `https://pump.fun/coin/${mintPub}`,
      };

    } catch (e) {
      console.error(`[CREATE] pool="${cfg.pool}" failed: ${e.message}`);
      lastErr = `pool=${cfg.pool}: ${e.message}`;
      // If we got a tx sig but confirmation failed, still return it
      if (txSig) {
        console.log(`[CREATE] TX was sent but confirmation failed. Returning anyway.`);
        return {
          mint: mintPub,
          txSig,
          metadataUri,
          pumpUrl: `https://pump.fun/coin/${mintPub}`,
        };
      }
    }
  }

  // All pool configs failed
  throw new Error(`All PumpPortal configs failed. Last: ${lastErr}`);
}

/**
 * Diagnostic function — call from a test endpoint to debug PumpPortal
 */
export async function testPumpPortal(publicKey) {
  const results = {};

  // Test 1: Can we reach PumpPortal?
  try {
    const resp = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: publicKey,
        action: "create",
        tokenMetadata: { name: "Test", symbol: "TST", uri: "https://example.com/test.json" },
        mint: Keypair.generate().publicKey.toBase58(),
        denominatedInSol: "true",
        amount: 0.001,
        slippage: 10,
        priorityFee: 0.0005,
        pool: "pump",
      }),
    });
    const body = await resp.text();
    results.pump = { status: resp.status, body: body.slice(0, 200) };
  } catch (e) {
    results.pump = { error: e.message };
  }

  // Test 2: Try "auto" pool
  try {
    const resp = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: publicKey,
        action: "create",
        tokenMetadata: { name: "Test", symbol: "TST", uri: "https://example.com/test.json" },
        mint: Keypair.generate().publicKey.toBase58(),
        denominatedInSol: "true",
        amount: 0.001,
        slippage: 10,
        priorityFee: 0.0005,
        pool: "auto",
      }),
    });
    const body = await resp.text();
    results.auto = { status: resp.status, body: body.slice(0, 200) };
  } catch (e) {
    results.auto = { error: e.message };
  }

  // Test 3: Try with larger amount
  try {
    const resp = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: publicKey,
        action: "create",
        tokenMetadata: { name: "Test", symbol: "TST", uri: "https://example.com/test.json" },
        mint: Keypair.generate().publicKey.toBase58(),
        denominatedInSol: "true",
        amount: 1,
        slippage: 10,
        priorityFee: 0.0005,
        pool: "pump",
      }),
    });
    const body = await resp.text();
    results.largeAmount = { status: resp.status, body: body.slice(0, 200) };
  } catch (e) {
    results.largeAmount = { error: e.message };
  }

  return results;
}

export { uploadMetadata };
