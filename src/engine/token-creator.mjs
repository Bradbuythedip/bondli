/**
 * ═══════════════════════════════════════════════════
 * PUMP.FUN TOKEN CREATOR — via PumpPortal API
 * ═══════════════════════════════════════════════════
 *
 * Uses pumpportal.fun API to create tokens:
 *   1. Upload image + metadata to pump.fun IPFS
 *   2. POST to pumpportal /api/trade-local (returns unsigned tx)
 *   3. Sign with creator + mint keypair
 *   4. Send to Solana
 *
 * This avoids building raw instructions — the API handles
 * program changes, account layouts, and fee recipients.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

// ═══════════════════════════════════════
// IPFS METADATA UPLOAD (with retries)
// ═══════════════════════════════════════

async function uploadMetadata(config, maxRetries = 5) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const form = new FormData();
      let hasImage = false;

      if (config.image && config.image.startsWith("data:")) {
        const matches = config.image.match(/^data:(.+);base64,(.+)$/);
        if (matches) {
          const buffer = Buffer.from(matches[2], "base64");
          const ext = matches[1].includes("png") ? "png" : "jpg";
          form.append("file", new Blob([buffer], { type: matches[1] }), `token.${ext}`);
          hasImage = true;
        }
      } else if (config.image && config.image.startsWith("http")) {
        const resp = await fetch(config.image);
        form.append("file", await resp.blob(), "token.png");
        hasImage = true;
      }

      // pump.fun requires an image
      if (!hasImage) {
        console.log("[IPFS] No image — using default green pixel");
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

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`IPFS ${resp.status}: ${text.slice(0, 200)}`);
      }

      const data = await resp.json();
      const uri = data.metadataUri || data.uri;
      console.log(`[IPFS] ✅ Success: ${uri}`);
      return { metadataUri: uri, metadata: data.metadata || data };

    } catch (e) {
      lastError = e;
      console.warn(`[IPFS] Attempt ${attempt} failed: ${e.message}`);
      if (attempt < maxRetries) {
        const delay = 2000 * attempt;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`IPFS failed after ${maxRetries} tries: ${lastError?.message}`);
}

// ═══════════════════════════════════════
// CREATE TOKEN via PumpPortal API
// ═══════════════════════════════════════

/**
 * Create a token on pump.fun using pumpportal.fun API.
 *
 * @param {Connection} connection
 * @param {Keypair} creator — dev wallet (pays for everything)
 * @param {Object} tokenConfig — { name, ticker, description, image, twitter, telegram, website }
 * @param {Object} options — { devBuySol, slippageBps, priorityFee }
 * @returns {{ mint, txSig, metadataUri, pumpUrl }}
 */
export async function createToken(connection, creator, tokenConfig, options = {}) {
  const {
    devBuySol = 0,
    slippageBps = 2500,
    priorityFee = 200_000,
  } = options;

  // 1. Upload metadata
  console.log(`[CREATE] Starting: ${tokenConfig.name} ($${tokenConfig.ticker})`);
  const { metadataUri } = await uploadMetadata(tokenConfig);

  // 2. Generate mint keypair
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  console.log(`[CREATE] Mint: ${mint.toBase58()}`);
  console.log(`[CREATE] Metadata: ${metadataUri}`);

  // 3. Request pre-built transaction from PumpPortal
  const maxRetries = 3;
  let txSig;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[CREATE] Building tx via PumpPortal (attempt ${attempt})...`);

      const portalBody = {
        publicKey: creator.publicKey.toBase58(),
        action: "create",
        tokenMetadata: {
          name: tokenConfig.name || "Token",
          symbol: tokenConfig.ticker || "TKN",
          uri: metadataUri,
        },
        mint: mint.toBase58(),
        denominatedInSol: "true",
        amount: devBuySol,
        slippage: Math.floor(slippageBps / 100), // API expects percentage
        priorityFee: priorityFee / 1_000_000, // API expects SOL
        pool: "pump",
      };

      console.log(`[CREATE] Dev buy: ${devBuySol} SOL | Slippage: ${portalBody.slippage}% | Priority: ${portalBody.priorityFee} SOL`);

      const portalResp = await fetch("https://pumpportal.fun/api/trade-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(portalBody),
      });

      if (!portalResp.ok) {
        const errText = await portalResp.text();
        throw new Error(`PumpPortal ${portalResp.status}: ${errText.slice(0, 300)}`);
      }

      // 4. Deserialize the transaction
      const txData = await portalResp.arrayBuffer();
      const tx = VersionedTransaction.deserialize(new Uint8Array(txData));

      // 5. Sign with creator + mint keypair
      tx.sign([mintKeypair, creator]);

      // 6. Send raw transaction
      console.log(`[CREATE] Sending transaction...`);

      const rawTx = tx.serialize();

      // Try via connection.sendRawTransaction first
      txSig = await connection.sendRawTransaction(rawTx, {
        skipPreflight: true,
        maxRetries: 2,
        preflightCommitment: "processed",
      });

      console.log(`[CREATE] Sent: ${txSig}`);

      // 7. Wait for confirmation
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

      const confirmation = await connection.confirmTransaction(
        { signature: txSig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      if (confirmation.value?.err) {
        throw new Error(`TX failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      console.log(`[CREATE] ✅ Confirmed! Mint: ${mint.toBase58()}`);
      break;

    } catch (e) {
      console.error(`[CREATE] Attempt ${attempt} failed: ${e.message}`);
      if (attempt === maxRetries) {
        throw new Error(`Token creation failed after ${maxRetries} attempts: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }

  return {
    mint: mint.toBase58(),
    txSig,
    metadataUri,
    pumpUrl: `https://pump.fun/coin/${mint.toBase58()}`,
  };
}

export { uploadMetadata };
