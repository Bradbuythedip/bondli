// BONDLI v3.0 — Fund Recovery (scan sub-wallets for remaining funds)
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import CONFIG from "./config.mjs";
import { WalletSaver } from "./wallet-saver.mjs";
import { sleep } from "./anti-detection.mjs";

async function recover() {
  const connection = new Connection(CONFIG.RPC_URL, "confirmed");
  const saver = new WalletSaver();
  const execute = process.env.EXECUTE_RECOVERY === "true";

  console.log(`\n=== BONDLI FUND RECOVERY ${execute ? "(EXECUTE)" : "(SCAN ONLY)"} ===\n`);

  const files = saver.list();
  if (files.length === 0) {
    console.log("No wallet files found.");
    return;
  }

  const master = Keypair.fromSecretKey(bs58.decode(CONFIG.MASTER_SEED));
  let totalFound = 0;
  let totalRecovered = 0;

  for (const fileInfo of files) {
    console.log(`\nFile: ${fileInfo.file} (${fileInfo.count} wallets, ${fileInfo.created})`);
    const walletData = saver.load(`${process.cwd()}/.wallet-seeds/${fileInfo.file}`);

    for (const w of walletData) {
      const kp = Keypair.fromSecretKey(bs58.decode(w.secret));
      const balance = await connection.getBalance(kp.publicKey);
      const sol = balance / LAMPORTS_PER_SOL;

      if (sol >= 0.001) {
        console.log(`  [${w.role}] ${w.pubkey.slice(0,8)}... = ${sol.toFixed(6)} SOL`);
        totalFound += sol;

        if (execute) {
          try {
            const sweepAmount = balance - 5000;
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
              console.log(`    -> Swept ${(sweepAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
            }
          } catch (e) {
            console.error(`    -> Sweep failed: ${e.message}`);
          }
          await sleep(300);
        }
      }
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total found: ${totalFound.toFixed(6)} SOL`);
  if (execute) console.log(`Total recovered: ${totalRecovered.toFixed(6)} SOL`);
  else console.log("Run with EXECUTE_RECOVERY=true to sweep funds.");
}

recover().catch(console.error);

export { recover };
