// BONDLI v3.0 — Exit (position exit + SOL sweep)
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import CONFIG from "./config.mjs";
import { WalletSaver } from "./wallet-saver.mjs";
import { TradeRouter } from "./trade-router.mjs";
import { calculateFee } from "./fee-engine.mjs";
import { sleep } from "./anti-detection.mjs";

async function exitPositions() {
  const connection = new Connection(CONFIG.RPC_URL, "confirmed");
  const router = new TradeRouter();
  const saver = new WalletSaver();
  const dryRun = CONFIG.DRY_RUN;

  console.log(`\n=== BONDLI EXIT ${dryRun ? "(DRY RUN)" : "(LIVE)"} ===\n`);

  // Load saved wallets
  const files = saver.list();
  if (files.length === 0) {
    console.log("No saved wallet files found.");
    return;
  }

  console.log(`Found ${files.length} wallet file(s)`);
  const latest = files[files.length - 1];
  const walletData = saver.load(`${process.cwd()}/.wallet-seeds/${latest.file}`);

  const master = Keypair.fromSecretKey(bs58.decode(CONFIG.MASTER_SEED));
  let totalRecovered = 0;

  // Phase 1: Sell all tokens in each wallet before sweeping SOL
  const tokenCA = CONFIG.TOKEN_CA;
  if (tokenCA) {
    console.log(`\n--- Phase 1: Selling tokens (${tokenCA.slice(0,8)}...) ---`);
    const mintPk = new PublicKey(tokenCA);
    for (const w of walletData) {
      const kp = Keypair.fromSecretKey(bs58.decode(w.secret));
      try {
        const ata = getAssociatedTokenAddressSync(mintPk, kp.publicKey, true);
        const account = await getAccount(connection, ata);
        const tokenBalance = Number(account.amount);
        if (tokenBalance <= 0) continue;
        console.log(`  [${w.role}] ${w.pubkey.slice(0,8)}... — ${tokenBalance} tokens`);
        if (!dryRun) {
          const sellResult = await router.sell(kp, tokenCA, tokenBalance);
          console.log(`    Sold -> ${sellResult.solOut?.toFixed(4) || '?'} SOL | sig: ${sellResult.sig?.slice(0,12)}`);
        }
      } catch {
        // No token account or sell failed — skip
      }
      await sleep(500);
    }
    console.log(`Token sell phase complete.\n`);
  }

  // Phase 2: Sweep remaining SOL back to master
  console.log(`--- Phase 2: Sweeping SOL ---`);
  for (const w of walletData) {
    const kp = Keypair.fromSecretKey(bs58.decode(w.secret));
    const balance = await connection.getBalance(kp.publicKey);
    const sol = balance / LAMPORTS_PER_SOL;

    if (sol < 0.001) {
      console.log(`  [${w.role}] ${w.pubkey.slice(0,8)}... — empty, skipping`);
      continue;
    }

    console.log(`  [${w.role}] ${w.pubkey.slice(0,8)}... — ${sol.toFixed(4)} SOL`);

    if (!dryRun) {
      try {
        // Sweep SOL back to master (minus rent)
        const sweepAmount = balance - 5000; // leave rent
        if (sweepAmount > 0) {
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: kp.publicKey,
              toPubkey: master.publicKey,
              lamports: sweepAmount,
            })
          );
          const { blockhash } = await connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          tx.feePayer = kp.publicKey;
          tx.sign(kp);
          await connection.sendRawTransaction(tx.serialize());
          totalRecovered += sweepAmount / LAMPORTS_PER_SOL;
        }
      } catch (e) {
        console.error(`    Sweep failed: ${e.message}`);
      }
      await sleep(300);
    } else {
      totalRecovered += sol;
    }
  }

  console.log(`\nTotal recovered: ${totalRecovered.toFixed(4)} SOL`);
  console.log("Exit complete.");
}

exitPositions().catch(console.error);

export { exitPositions };
