/**
 * ═══════════════════════════════════════════════════
 * PUMP.FUN TOKEN CREATOR
 * ═══════════════════════════════════════════════════
 *
 * Creates new tokens on pump.fun bonding curve:
 *   1. Upload image + metadata to pump.fun IPFS
 *   2. Generate mint keypair
 *   3. Build create instruction (+ optional dev buy)
 *   4. Sign with dev wallet + mint keypair
 *   5. Send transaction
 *
 * Returns: { mint, txSig, metadataUri }
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";

// Node 20+ has built-in fetch — no external deps needed

// Pump.fun program addresses
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMP_GLOBAL = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
const PUMP_FEE_RECIPIENT = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbCfay65R3jCVi");
const PUMP_EVENT_AUTHORITY = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
const MPL_TOKEN_METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const SYSTEM_PROGRAM = SystemProgram.programId;
const RENT_PROGRAM = new PublicKey("SysvarRent111111111111111111111111111111111");

// Instruction discriminators
const CREATE_DISCRIMINATOR = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);
const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);

// ═══════════════════════════════════════
// IPFS METADATA UPLOAD
// ═══════════════════════════════════════

/**
 * Upload token metadata + image to pump.fun IPFS.
 * @param {Object} config - { name, ticker, description, image (base64 or URL), twitter, telegram, website }
 * @returns {{ metadataUri: string }}
 */
async function uploadMetadata(config) {
  const form = new FormData();

  // Handle image — base64 data URI or URL
  if (config.image && config.image.startsWith("data:")) {
    const matches = config.image.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
      const mimeType = matches[1];
      const buffer = Buffer.from(matches[2], "base64");
      const ext = mimeType.includes("png") ? "png" : mimeType.includes("gif") ? "gif" : "jpg";
      const blob = new Blob([buffer], { type: mimeType });
      form.append("file", blob, `token.${ext}`);
    }
  } else if (config.image && (config.image.startsWith("http://") || config.image.startsWith("https://"))) {
    const imgResp = await fetch(config.image);
    const imgBlob = await imgResp.blob();
    form.append("file", imgBlob, "token.png");
  }

  form.append("name", config.name || "Token");
  form.append("symbol", config.ticker || "TKN");
  form.append("description", config.description || "");
  form.append("twitter", config.twitter || "");
  form.append("telegram", config.telegram || "");
  form.append("website", config.website || "");
  form.append("showName", "true");

  const resp = await fetch("https://pump.fun/api/ipfs", {
    method: "POST",
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`IPFS upload failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  return {
    metadataUri: data.metadataUri || data.uri,
    metadata: data.metadata || data,
  };
}

// ═══════════════════════════════════════
// PDA DERIVATIONS
// ═══════════════════════════════════════

function deriveBondingCurve(mint) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_PROGRAM
  );
  return pda;
}

function deriveMintAuthority() {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    PUMP_PROGRAM
  );
  return pda;
}

function deriveMetadata(mint) {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      MPL_TOKEN_METADATA.toBuffer(),
      mint.toBuffer(),
    ],
    MPL_TOKEN_METADATA
  );
  return pda;
}

// ═══════════════════════════════════════
// ENCODE STRING FOR INSTRUCTION DATA
// ═══════════════════════════════════════

function encodeString(str) {
  const bytes = Buffer.from(str, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

// ═══════════════════════════════════════
// CREATE TOKEN
// ═══════════════════════════════════════

/**
 * Create a new token on pump.fun.
 *
 * @param {Connection} connection - Solana RPC connection
 * @param {Keypair} creator - Dev wallet keypair (pays for everything)
 * @param {Object} tokenConfig - { name, ticker, description, image, twitter, telegram, website }
 * @param {Object} options - { devBuySol, slippageBps, priorityFee, sendUrl }
 * @returns {{ mint: string, txSig: string, metadataUri: string, bondingCurve: string }}
 */
export async function createToken(connection, creator, tokenConfig, options = {}) {
  const {
    devBuySol = 0,
    slippageBps = 2500,
    priorityFee = 100_000, // microlamports
    sendUrl = null,
  } = options;

  console.log(`[CREATE] Uploading metadata for ${tokenConfig.name} ($${tokenConfig.ticker})...`);

  // 1. Upload metadata to IPFS
  const { metadataUri } = await uploadMetadata(tokenConfig);
  console.log(`[CREATE] Metadata URI: ${metadataUri}`);

  // 2. Generate mint keypair
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  console.log(`[CREATE] Mint: ${mint.toBase58()}`);

  // 3. Derive PDAs
  const bondingCurve = deriveBondingCurve(mint);
  const bondingCurveAta = await getAssociatedTokenAddress(mint, bondingCurve, true);
  const mintAuthority = deriveMintAuthority();
  const metadata = deriveMetadata(mint);

  // 4. Build create instruction
  const createData = Buffer.concat([
    CREATE_DISCRIMINATOR,
    encodeString(tokenConfig.name || "Token"),
    encodeString(tokenConfig.ticker || "TKN"),
    encodeString(metadataUri),
  ]);

  const createIx = new TransactionInstruction({
    programId: PUMP_PROGRAM,
    keys: [
      { pubkey: mint, isSigner: true, isWritable: true },
      { pubkey: mintAuthority, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: bondingCurveAta, isSigner: false, isWritable: true },
      { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
      { pubkey: MPL_TOKEN_METADATA, isSigner: false, isWritable: false },
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: createData,
  });

  // 5. Build transaction
  const tx = new Transaction();

  // Priority fee
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }));

  // Create instruction
  tx.add(createIx);

  // 6. Optional dev buy in same tx
  if (devBuySol > 0) {
    console.log(`[CREATE] Adding dev buy: ${devBuySol} SOL`);

    const buyerAta = await getAssociatedTokenAddress(mint, creator.publicKey);

    // Create ATA for buyer
    tx.add(
      createAssociatedTokenAccountInstruction(
        creator.publicKey, buyerAta, creator.publicKey, mint
      )
    );

    // Buy instruction
    // Amount = SOL in lamports, maxSolCost = amount * (1 + slippage)
    const solLamports = Math.floor(devBuySol * LAMPORTS_PER_SOL);
    const maxSolCost = Math.floor(solLamports * (1 + slippageBps / 10000));

    // For a brand new token, we can estimate tokens from the initial curve
    // Initial virtual reserves: ~30 SOL virtual, 1B tokens virtual
    // Price at start: ~30 / 1B = 0.00000003 SOL per token
    // Tokens for devBuySol: devBuySol / 0.00000003 ≈ devBuySol * 33_333_333
    const estimatedTokens = new BN(Math.floor(devBuySol * 30_000_000));

    const buyData = Buffer.concat([
      BUY_DISCRIMINATOR,
      estimatedTokens.toArrayLike(Buffer, "le", 8),
      new BN(maxSolCost).toArrayLike(Buffer, "le", 8),
    ]);

    const buyIx = new TransactionInstruction({
      programId: PUMP_PROGRAM,
      keys: [
        { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
        { pubkey: PUMP_FEE_RECIPIENT, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: bondingCurveAta, isSigner: false, isWritable: true },
        { pubkey: buyerAta, isSigner: false, isWritable: true },
        { pubkey: creator.publicKey, isSigner: true, isWritable: true },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: RENT_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: buyData,
    });

    tx.add(buyIx);
  }

  // 7. Sign and send
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = creator.publicKey;

  const signers = [creator, mintKeypair];

  let txSig;
  if (sendUrl) {
    // Use custom RPC (Helius Atlas etc)
    tx.sign(...signers);
    const rawTx = tx.serialize();
    const resp = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "sendTransaction",
        params: [rawTx.toString("base64"), { encoding: "base64", skipPreflight: true, maxRetries: 3 }],
      }),
    });
    const result = await resp.json();
    if (result.error) throw new Error(result.error.message);
    txSig = result.result;

    // Wait for confirmation
    try {
      await connection.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, "confirmed");
    } catch (e) {
      console.warn(`[CREATE] Confirmation timeout, tx may still land: ${txSig}`);
    }
  } else {
    txSig = await sendAndConfirmTransaction(connection, tx, signers, {
      commitment: "confirmed",
      maxRetries: 3,
    });
  }

  console.log(`[CREATE] ✅ Token created! Mint: ${mint.toBase58()} | TX: ${txSig}`);

  return {
    mint: mint.toBase58(),
    bondingCurve: bondingCurve.toBase58(),
    txSig,
    metadataUri,
    pumpUrl: `https://pump.fun/coin/${mint.toBase58()}`,
  };
}

export { uploadMetadata, deriveBondingCurve };
