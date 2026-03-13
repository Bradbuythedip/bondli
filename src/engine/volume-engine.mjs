// BONDLI v4.0 — Continuous Volume Engine + Auto-Rug
//
// Problem: after launch, volume flatlines → chart dies → no organic buyers
// Solution: continuous self-trading between fleet wallets with escalating volume
//
// Volume Strategy:
//   - Wallets constantly trade against each other (buy from one, sell from another)
//   - Volume ESCALATES over time: starts small, builds to peak
//   - Mix of green/red candles (70/30 buy bias early, shifting to 50/50)
//   - Different wallet each trade, human-like gaps
//   - Auto-detects real external buyers and adapts
//
// Auto-Rug:
//   - Monitors external volume via GameState
//   - If no external trades for DROUGHT_SEC, triggers rug
//   - All wallets sell simultaneously in a single Jito bundle
//   - Atomic: either all land in one block or none do
//   - SOL swept back to master wallet

import {
  Connection, Keypair, PublicKey, Transaction,
  ComputeBudgetProgram, SystemProgram, LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, getAccount, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PumpSdk, OnlinePumpSdk, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount } from "@pump-fun/pump-sdk";
import BN from "bn.js";
import bs58 from "bs58";
import CONFIG from "./config.mjs";
import { getOptimalPriorityFee, heliusSmartSend } from "./helius-enhanced.mjs";
import { EventEmitter } from "events";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════
// CONTINUOUS VOLUME ENGINE
// Replaces the old fixed-duration parabolic volume generator
// Runs indefinitely, escalating volume until auto-rug triggers
// ═══════════════════════════════════════════════════════════════
export class ContinuousVolumeEngine extends EventEmitter {
  constructor(session, { onlineSdk, connection }) {
    super();
    this.session = session;
    this.onlineSdk = onlineSdk;
    this.connection = connection;
    this.running = false;

    // Volume escalation state
    this.cycle = 0;
    this.volumeMultiplier = 1.0;
    this.escalationRate = CONFIG.VOLUME_ESCALATION_RATE;
    this.maxMultiplier = CONFIG.VOLUME_MAX_MULTIPLIER;
    this.minInterval = CONFIG.VOLUME_MIN_INTERVAL_MS;
    this.maxInterval = CONFIG.VOLUME_MAX_INTERVAL_MS;

    // Track which wallets traded recently (avoid same wallet back-to-back)
    this.lastBuyWallet = null;
    this.lastSellWallet = null;

    // Stats
    this.totalVolumeSol = 0;
    this.tradeCount = 0;
    this.startTime = 0;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.startTime = Date.now();
    console.log(`[VOLUME-ENGINE] Starting continuous volume for ${this.session.ca.slice(0, 8)}...`);
    console.log(`[VOLUME-ENGINE] Escalation: ${this.escalationRate}x per cycle, max ${this.maxMultiplier}x`);

    try {
      await this._volumeLoop();
    } catch (e) {
      console.error(`[VOLUME-ENGINE] Fatal error: ${e.message}`);
    } finally {
      this.running = false;
    }
  }

  stop() {
    this.running = false;
    console.log(`[VOLUME-ENGINE] Stopped after ${this.tradeCount} trades, ${this.totalVolumeSol.toFixed(4)} SOL volume`);
  }

  async _volumeLoop() {
    const { ca, mint, fleetWallets, gameState } = this.session;

    while (this.running && this.session.running) {
      const active = fleetWallets.filter(w => w.funded && w.trades.length > 0);
      if (active.length < 2) {
        await sleep(2000);
        continue;
      }

      // Escalate volume each cycle
      this.cycle++;
      if (this.cycle % 5 === 0 && this.volumeMultiplier < this.maxMultiplier) {
        this.volumeMultiplier = Math.min(this.volumeMultiplier * this.escalationRate, this.maxMultiplier);
        console.log(`[VOLUME-ENGINE] Cycle ${this.cycle} — volume multiplier: ${this.volumeMultiplier.toFixed(2)}x`);
      }

      // Check GameState — adapt behavior
      if (gameState?.alive) {
        const gs = gameState.snapshot();
        // If real buyers are active, accelerate volume (FOMO amplification)
        if (gs.uniqueBuyers >= 3) {
          this.volumeMultiplier = Math.min(this.volumeMultiplier * 1.15, this.maxMultiplier);
        }
        // If SELL_NOW signal, stop volume — auto-rug will handle it
        if (gs.signal === "SELL_NOW") {
          console.log(`[VOLUME-ENGINE] SELL_NOW signal — pausing volume`);
          await sleep(5000);
          continue;
        }
      }

      // Fetch fresh state
      let global, feeConfig;
      try {
        global = await this.onlineSdk.fetchGlobal();
        feeConfig = await this.onlineSdk.fetchFeeConfig();
      } catch (e) {
        console.warn(`[VOLUME-ENGINE] fetchGlobal failed: ${e.message}`);
        await sleep(3000);
        continue;
      }

      // Run a burst of trades (4-8 trades per burst)
      const burstSize = 4 + Math.floor(Math.random() * 5);
      await this._tradeBurst(active, mint, global, feeConfig, burstSize);

      // Gap between bursts — decreases as volume escalates
      const burstGap = this.maxInterval / this.volumeMultiplier;
      const jitter = Math.random() * 2000;
      await sleep(Math.max(burstGap + jitter, this.minInterval));
    }
  }

  async _tradeBurst(active, mint, global, feeConfig, count) {
    const shuffled = [...active].sort(() => Math.random() - 0.5);

    for (let i = 0; i < count && this.running && this.session.running; i++) {
      // Alternate buy/sell with buy bias (keeps price stable-to-rising)
      // Buy bias decreases over time (70% early → 55% late)
      const elapsedMin = (Date.now() - this.startTime) / 60000;
      const buyBias = Math.max(0.50, 0.75 - elapsedMin * 0.02); // drops 2% per minute
      const doBuy = Math.random() < buyBias;

      try {
        if (doBuy) {
          await this._volumeBuy(shuffled, mint, global, feeConfig);
        } else {
          await this._volumeSell(shuffled, mint, global, feeConfig);
        }
      } catch (e) {
        // Swallow individual trade errors
      }

      // Gap between individual trades within a burst
      const tradeGap = (this.minInterval + Math.random() * 1200) / this.volumeMultiplier;
      await sleep(Math.max(tradeGap, 400));
    }
  }

  async _volumeBuy(wallets, mint, global, feeConfig) {
    const wallet = wallets.find(w => w !== this.lastBuyWallet) || wallets[0];
    this.lastBuyWallet = wallet;

    const balance = await this.connection.getBalance(wallet.keypair.publicKey);
    const balSol = balance / LAMPORTS_PER_SOL;

    // Trade size scales with multiplier: 2-6% of balance * multiplier
    const basePct = 0.02 + Math.random() * 0.04;
    const buyAmount = Math.min(
      balSol * basePct * this.volumeMultiplier,
      0.15 * this.volumeMultiplier // hard cap scales too
    );

    if (buyAmount < 0.003 || balSol < buyAmount + 0.002) return;

    // Get dynamic priority fee from Helius
    const priorityFee = await getOptimalPriorityFee();

    const buyState = await this.onlineSdk.fetchBuyState(mint, wallet.keypair.publicKey);
    const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } = buyState;
    const mintSupply = bondingCurve.tokenTotalSupply || global.tokenTotalSupply;
    const solBN = new BN(Math.floor(buyAmount * 1e9));
    const tokenAmount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply, bondingCurve, amount: solBN });
    if (tokenAmount.isZero()) return;

    const instructions = await new PumpSdk().buyInstructions({
      global, bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo,
      mint, user: wallet.keypair.publicKey, amount: tokenAmount, solAmount: solBN, slippage: 15,
    });

    const tx = new Transaction();
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
      ...instructions,
    );
    tx.recentBlockhash = (await this.connection.getLatestBlockhash("confirmed")).blockhash;
    tx.feePayer = wallet.keypair.publicKey;
    tx.sign(wallet.keypair);

    const sig = await heliusSmartSend(this.connection, tx.serialize());
    await this.connection.confirmTransaction(sig, "confirmed");

    wallet.solSpent += buyAmount;
    this.session.tradeCount++;
    this.session.totalSolSpent += buyAmount;
    this.tradeCount++;
    this.totalVolumeSol += buyAmount;
    this.emit("trade", { ca: this.session.ca, role: wallet.role, side: "buy", sol: buyAmount, sig, engine: "volume" });
    console.log(`[VOL] BUY ${buyAmount.toFixed(4)} SOL [${wallet.role}] (${this.volumeMultiplier.toFixed(1)}x)`);
  }

  async _volumeSell(wallets, mint, global, feeConfig) {
    const wallet = wallets.find(w => w !== this.lastSellWallet && w.trades.some(t => t.side === "buy")) || wallets[0];
    this.lastSellWallet = wallet;

    // Sell 3-10% of token holdings * multiplier
    const sellPct = (0.03 + Math.random() * 0.07) * Math.min(this.volumeMultiplier, 3.0);
    const clampedPct = Math.min(sellPct, 0.25); // never sell more than 25% in one trade

    let tokenBalance;
    try {
      const ata = getAssociatedTokenAddressSync(mint, wallet.keypair.publicKey, true);
      const account = await getAccount(this.connection, ata);
      tokenBalance = new BN(account.amount.toString());
    } catch { return; }
    if (tokenBalance.isZero()) return;

    const sellAmount = tokenBalance.muln(Math.floor(clampedPct * 1000)).divn(1000);
    if (sellAmount.isZero()) return;

    const priorityFee = await getOptimalPriorityFee();

    const sellState = await this.onlineSdk.fetchSellState(mint, wallet.keypair.publicKey);
    const { bondingCurveAccountInfo, bondingCurve } = sellState;
    const mintSupply = bondingCurve.tokenTotalSupply || global.tokenTotalSupply;
    const solOut = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply, bondingCurve, amount: sellAmount });

    const instructions = await new PumpSdk().sellInstructions({
      global, bondingCurveAccountInfo, bondingCurve,
      mint, user: wallet.keypair.publicKey, amount: sellAmount, solAmount: solOut, slippage: 15,
    });

    const tx = new Transaction();
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
      ...instructions,
    );
    tx.recentBlockhash = (await this.connection.getLatestBlockhash("confirmed")).blockhash;
    tx.feePayer = wallet.keypair.publicKey;
    tx.sign(wallet.keypair);

    const sig = await heliusSmartSend(this.connection, tx.serialize());
    await this.connection.confirmTransaction(sig, "confirmed");

    const solOutNum = parseFloat(solOut.toString()) / 1e9;
    wallet.solRecovered += solOutNum;
    this.session.tradeCount++;
    this.session.totalSolRecovered += solOutNum;
    this.tradeCount++;
    this.totalVolumeSol += solOutNum;
    this.emit("trade", { ca: this.session.ca, role: wallet.role, side: "sell", sol: solOutNum, sig, engine: "volume" });
    console.log(`[VOL] SELL ${(clampedPct * 100).toFixed(0)}% [${wallet.role}] -> ${solOutNum.toFixed(4)} SOL (${this.volumeMultiplier.toFixed(1)}x)`);
  }

  snapshot() {
    return {
      running: this.running,
      cycle: this.cycle,
      volumeMultiplier: Math.round(this.volumeMultiplier * 100) / 100,
      tradeCount: this.tradeCount,
      totalVolumeSol: Math.round(this.totalVolumeSol * 10000) / 10000,
      elapsedSec: Math.round((Date.now() - this.startTime) / 1000),
    };
  }
}


// ═══════════════════════════════════════════════════════════════
// AUTO-RUG CONTROLLER
// Monitors external volume. When it dries up, triggers atomic
// sell of ALL fleet wallets in a single Jito bundle.
//
// Logic:
//   1. Track lastExternalTradeTime from GameState
//   2. If gap > DROUGHT_SEC and we've been running > MIN_WAIT_SEC
//   3. Build sell tx for every wallet that holds tokens
//   4. Submit all as one Jito bundle (atomic — same block)
//   5. Sweep SOL back to master
// ═══════════════════════════════════════════════════════════════
export class AutoRugController extends EventEmitter {
  constructor(session, { onlineSdk, connection }) {
    super();
    this.session = session;
    this.onlineSdk = onlineSdk;
    this.connection = connection;
    this.running = false;
    this.triggered = false;

    this.droughtThreshold = CONFIG.AUTO_RUG_DROUGHT_SEC * 1000;
    this.minWait = CONFIG.AUTO_RUG_MIN_WAIT_SEC * 1000;
    this.enabled = CONFIG.AUTO_RUG_ENABLED;

    this.lastExternalTradeTime = Date.now(); // start from now
    this.checkInterval = 5000; // check every 5s
  }

  async start() {
    if (!this.enabled) {
      console.log(`[AUTO-RUG] Disabled via config`);
      return;
    }
    if (this.running) return;
    this.running = true;
    console.log(`[AUTO-RUG] Monitoring for volume drought (threshold: ${CONFIG.AUTO_RUG_DROUGHT_SEC}s, min wait: ${CONFIG.AUTO_RUG_MIN_WAIT_SEC}s)`);

    try {
      await this._monitorLoop();
    } catch (e) {
      console.error(`[AUTO-RUG] Error: ${e.message}`);
    }
  }

  stop() {
    this.running = false;
  }

  async _monitorLoop() {
    const startTime = Date.now();

    while (this.running && this.session.running && !this.triggered) {
      await sleep(this.checkInterval);

      const elapsed = Date.now() - startTime;
      if (elapsed < this.minWait) continue; // too early

      // Update last external trade time from GameState
      const gs = this.session.gameState;
      if (gs?.alive) {
        const externalTrades = gs.trades.filter(t => !t.isOurs);
        if (externalTrades.length > 0) {
          const lastExternal = externalTrades[externalTrades.length - 1];
          this.lastExternalTradeTime = lastExternal.time;
        }
      }

      const drought = Date.now() - this.lastExternalTradeTime;
      if (drought >= this.droughtThreshold) {
        console.log(`[AUTO-RUG] Volume drought detected: ${(drought / 1000).toFixed(0)}s since last external trade`);
        console.log(`[AUTO-RUG] Triggering atomic rug — all wallets sell in one Jito bundle`);

        this.triggered = true;
        this.emit("drought-detected", { droughtSec: drought / 1000 });

        try {
          const result = await this._executeRug();
          this.emit("rug-complete", result);
          return result;
        } catch (e) {
          console.error(`[AUTO-RUG] Rug execution failed: ${e.message}`);
          this.emit("rug-failed", { error: e.message });
          // Fallback: stop session, let normal close handle it
          this.session.running = false;
        }
      } else if (drought > this.droughtThreshold * 0.5) {
        // Warning at 50% threshold
        if (Math.random() < 0.2) { // don't spam
          console.log(`[AUTO-RUG] Warning: ${(drought / 1000).toFixed(0)}s since last external trade (threshold: ${CONFIG.AUTO_RUG_DROUGHT_SEC}s)`);
        }
      }
    }
  }

  async _executeRug() {
    const { ca, mint, masterKp, fleetWallets, gameState } = this.session;

    // Stop volume engine and game state
    this.session.running = false;
    if (gameState) gameState.stop();

    // Fetch global state
    let global, feeConfig;
    for (let i = 0; i < 3; i++) {
      try {
        global = await this.onlineSdk.fetchGlobal();
        feeConfig = await this.onlineSdk.fetchFeeConfig();
        break;
      } catch (e) {
        console.warn(`[AUTO-RUG] fetchGlobal attempt ${i + 1}: ${e.message}`);
        await sleep(1000);
      }
    }
    if (!global || !feeConfig) throw new Error("Cannot fetch global state for rug");

    // Build sell transactions for ALL wallets (including dev/master)
    const sellTxs = [];
    const allWallets = [...fleetWallets];

    // Add master wallet if it holds tokens
    const masterWalletObj = {
      keypair: masterKp,
      pubkey: masterKp.publicKey.toBase58(),
      role: "master",
    };

    for (const wallet of [masterWalletObj, ...allWallets]) {
      try {
        const ata = getAssociatedTokenAddressSync(mint, wallet.keypair.publicKey, true);
        const account = await getAccount(this.connection, ata);
        const tokenBalance = new BN(account.amount.toString());
        if (tokenBalance.isZero()) continue;

        // Build sell tx — sell 100% of holdings with 15% slippage protection
        const sellState = await this.onlineSdk.fetchSellState(mint, wallet.keypair.publicKey);
        const { bondingCurveAccountInfo, bondingCurve } = sellState;
        const mintSupply = bondingCurve.tokenTotalSupply || global.tokenTotalSupply;
        const estSolOut = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply, bondingCurve, amount: tokenBalance });
        // Accept up to 15% slippage, not 100% — prevents MEV sandwich extracting all value
        const minSolOut = BigInt(Math.floor(Number(estSolOut) * 0.85));

        const tx = await this.onlineSdk.getSellTransaction(
          wallet.keypair.publicKey, mint, global, feeConfig,
          sellState.bondingCurveAccountInfo, sellState.bondingCurve,
          tokenBalance, minSolOut,
          { units: 200_000, microLamports: 200_000 }
        );

        sellTxs.push({
          tx,
          signers: [wallet.keypair],
          wallet,
          tokens: tokenBalance.toString(),
        });

        console.log(`[AUTO-RUG] Built sell tx: ${wallet.role} (${tokenBalance.toString()} tokens)`);
      } catch (e) {
        console.warn(`[AUTO-RUG] Skip ${wallet.role}: ${e.message}`);
      }
    }

    if (sellTxs.length === 0) {
      console.log(`[AUTO-RUG] No tokens to sell — already empty`);
      return { ok: true, sold: 0, message: "No tokens found" };
    }

    console.log(`[AUTO-RUG] Submitting ${sellTxs.length} sell txs as Jito bundle...`);

    // Submit via Jito bundle — all sell in one block
    const result = await this._sendJitoRugBundle(sellTxs);

    if (result.ok) {
      console.log(`[AUTO-RUG] Bundle landed! ${result.sold} wallets sold in one block`);

      // Wait for confirmations
      await sleep(3000);

      // Sweep all SOL back to master
      await this._sweepToMaster(allWallets, masterKp);

      const masterBal = await this.connection.getBalance(masterKp.publicKey) / LAMPORTS_PER_SOL;
      console.log(`[AUTO-RUG] Complete. Master balance: ${masterBal.toFixed(4)} SOL`);
      return { ok: true, sold: result.sold, total: sellTxs.length, masterBalance: masterBal };
    } else {
      // Fallback: sequential sells
      console.warn(`[AUTO-RUG] Jito bundle failed — falling back to sequential sells`);
      return await this._sequentialFallback(sellTxs, allWallets, masterKp);
    }
  }

  async _sendJitoRugBundle(sellTxs) {
    const JITO_ENDPOINTS = [
      "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
      "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
      "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
    ];

    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");

    // Jito bundles max 5 txs — split into batches
    const BATCH = 5;
    let totalSold = 0;

    for (let i = 0; i < sellTxs.length; i += BATCH) {
      const batch = sellTxs.slice(i, i + BATCH);
      const base58Txs = [];

      for (const { tx, signers } of batch) {
        tx.recentBlockhash = blockhash;
        tx.feePayer = signers[0].publicKey;
        tx.sign(...signers);
        base58Txs.push(bs58.encode(tx.serialize()));
      }

      // Try all Jito endpoints
      let bundleLanded = false;
      for (const endpoint of JITO_ENDPOINTS) {
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0", id: 1,
              method: "sendBundle",
              params: [base58Txs],
            }),
            signal: AbortSignal.timeout(15000),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.result) {
              console.log(`[AUTO-RUG] Jito bundle ${Math.floor(i / BATCH) + 1} landed: ${batch.length} txs | id: ${data.result}`);
              totalSold += batch.length;
              bundleLanded = true;
              break;
            }
            if (data.error) console.warn(`[AUTO-RUG] Jito error:`, data.error);
          }
        } catch (e) {
          console.warn(`[AUTO-RUG] Jito endpoint failed (${endpoint.split("/")[2]}): ${e.message}`);
        }
      }

      if (!bundleLanded) {
        console.warn(`[AUTO-RUG] Bundle ${Math.floor(i / BATCH) + 1} failed on all endpoints`);
        return { ok: false, sold: totalSold };
      }
    }

    return { ok: totalSold > 0, sold: totalSold };
  }

  async _sequentialFallback(sellTxs, allWallets, masterKp) {
    let sold = 0;
    for (const { tx, signers, wallet } of sellTxs) {
      try {
        const sig = await sendAndConfirmTransaction(this.connection, tx, signers, {
          skipPreflight: true, commitment: "confirmed", maxRetries: 3,
        });
        sold++;
        console.log(`[AUTO-RUG] Sequential sell OK: ${wallet.role} | sig: ${sig.toString().slice(0, 12)}`);
      } catch (e) {
        console.error(`[AUTO-RUG] Sequential sell failed: ${wallet.role}: ${e.message}`);
      }
      await sleep(200); // minimal gap
    }

    await sleep(2000);
    await this._sweepToMaster(allWallets, masterKp);

    const masterBal = await this.connection.getBalance(masterKp.publicKey) / LAMPORTS_PER_SOL;
    return { ok: sold > 0, sold, total: sellTxs.length, masterBalance: masterBal, atomic: false };
  }

  async _sweepToMaster(wallets, masterKp) {
    console.log(`[AUTO-RUG] Sweeping SOL from ${wallets.length} wallets to master...`);

    for (const wallet of wallets) {
      if (wallet.keypair.publicKey.equals(masterKp.publicKey)) continue;
      try {
        const balance = await this.connection.getBalance(wallet.keypair.publicKey);
        const available = balance - 5000; // leave rent
        if (available <= 0) continue;

        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: wallet.keypair.publicKey,
            toPubkey: masterKp.publicKey,
            lamports: available,
          })
        );
        await sendAndConfirmTransaction(this.connection, tx, [wallet.keypair], {
          skipPreflight: true, commitment: "confirmed",
        });
        console.log(`[AUTO-RUG] Swept ${(available / LAMPORTS_PER_SOL).toFixed(4)} SOL from ${wallet.role}`);
      } catch (e) {
        console.warn(`[AUTO-RUG] Sweep failed for ${wallet.role}: ${e.message}`);
      }
      await sleep(200);
    }
  }

  snapshot() {
    return {
      enabled: this.enabled,
      running: this.running,
      triggered: this.triggered,
      droughtThresholdSec: CONFIG.AUTO_RUG_DROUGHT_SEC,
      timeSinceLastExternal: Math.round((Date.now() - this.lastExternalTradeTime) / 1000),
    };
  }
}

export default { ContinuousVolumeEngine, AutoRugController };
