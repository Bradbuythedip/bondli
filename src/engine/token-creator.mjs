/**
 * PUMP.FUN TOKEN CREATOR — via PumpPortal API
 * Matches pumpportal.fun/creation docs exactly
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
      console.log(`[IPFS] Raw response: ${JSON.stringify(data).slice(0, 500)}`);
      
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
// CREATE TOKEN — returns detailed errors 
// ═══════════════════════════════════════

export async function createToken(connection, creator, tokenConfig, options = {}) {
  const { devBuySol = 0.01 } = options;

  console.log(`\n${"═".repeat(50)}`);
  console.log(`[CREATE] ${tokenConfig.name} ($${tokenConfig.ticker})`);
  console.log(`[CREATE] Creator: ${creator.publicKey.toBase58()}`);
  console.log(`[CREATE] Dev buy: ${devBuySol} SOL`);

  // Check creator balance first
  try {
    const bal = await connection.getBalance(creator.publicKey);
    console.log(`[CREATE] Creator balance: ${bal / 1e9} SOL`);
    if (bal < 0.005 * 1e9) {
      throw new Error(`Creator wallet only has ${(bal / 1e9).toFixed(4)} SOL — need at least 0.005`);
    }
  } catch (balErr) {
    if (balErr.message.includes("Creator wallet")) throw balErr;
    console.warn(`[CREATE] Could not check balance: ${balErr.message}`);
  }

  // Step 1: IPFS
  const { metadataUri, metadata } = await uploadMetadata(tokenConfig);

  // Validate metadataUri looks right
  if (!metadataUri || !metadataUri.startsWith("http")) {
    throw new Error(`Invalid metadataUri: "${metadataUri}"`);
  }

  // Step 2: Mint keypair
  const mintKeypair = Keypair.generate();
  const mintPub = mintKeypair.publicKey.toBase58();
  console.log(`[CREATE] Mint: ${mintPub}`);

  // Step 3: PumpPortal request — EXACT match to docs
  const amount = Math.max(devBuySol, 0.001);

  const body = {
    publicKey: creator.publicKey.toBase58(),
    action: "create",
    tokenMetadata: {
      name: (metadata?.name) || tokenConfig.name || "Token",
      symbol: (metadata?.symbol) || tokenConfig.ticker || "TKN",
      uri: metadataUri,
    },
    mint: mintPub,
    denominatedInSol: "true",
    amount: amount,
    slippage: 10,
    priorityFee: 0.0005,
    pool: "pump",
  };

  const bodyStr = JSON.stringify(body);
  console.log(`[CREATE] Request body: ${bodyStr}`);

  // Step 4: Call PumpPortal with retries
  let txSig;
  const maxRetries = 3;
  let lastDebug = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[CREATE] --- Attempt ${attempt}/${maxRetries} ---`);

      const resp = await fetch("https://pumpportal.fun/api/trade-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyStr,
      });

      console.log(`[CREATE] Status: ${resp.status}`);

      if (resp.status !== 200) {
        const rawBody = await resp.text();
        console.error(`[CREATE] Error body: "${rawBody}"`);
        
        // Build detailed debug string to send back to frontend
        lastDebug = `PumpPortal ${resp.status}. Body: "${rawBody}". Sent: ${bodyStr.slice(0, 500)}`;
        throw new Error(lastDebug);
      }

      const txData = await resp.arrayBuffer();
      console.log(`[CREATE] TX bytes: ${txData.byteLength}`);

      const tx = VersionedTransaction.deserialize(new Uint8Array(txData));
      tx.sign([mintKeypair, creator]);

      const rawTx = tx.serialize();
      txSig = await connection.sendRawTransaction(rawTx, {
        skipPreflight: true,
        maxRetries: 2,
      });
      console.log(`[CREATE] Sent: ${txSig}`);

      const bh = await connection.getLatestBlockhash("confirmed");
      const conf = await connection.confirmTransaction(
        { signature: txSig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
        "confirmed"
      );

      if (conf.value?.err) {
        throw new Error(`TX error: ${JSON.stringify(conf.value.err)}`);
      }

      console.log(`[CREATE] ✅ SUCCESS! Mint: ${mintPub} TX: ${txSig}`);
      console.log(`[CREATE] https://pump.fun/coin/${mintPub}\n`);
      break;

    } catch (e) {
      console.error(`[CREATE] Attempt ${attempt} failed: ${e.message}`);
      if (attempt === maxRetries) {
        // Include the debug info so frontend can show it
        throw new Error(lastDebug || e.message);
      }
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }

  return {
    mint: mintPub,
    txSig,
    metadataUri,
    pumpUrl: `https://pump.fun/coin/${mintPub}`,
  };
}

export { uploadMetadata };
