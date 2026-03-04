// BONDLI — Fleet Trader v3 (Smart Distribution Strategy)
// Dev buys cheap → sells 35% for volume → distributes tokens to fleet → fleet sells staggered
import {
  Connection, Keypair, PublicKey, Transaction,
  ComputeBudgetProgram, sendAndConfirmTransaction,
  LAMPORTS_PER_SOL, SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, getAccount, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction, createTransferInstruction,
} from "@solana/spl-token";
import { PumpSdk, OnlinePumpSdk, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount } from "@pump-fun/pump-sdk";
import BN from "bn.js";
import bs58 from "bs58";
import CONFIG from "./config.mjs";
import { EventEmitter } from "events";

// ═══════════════════════════════════════
// WALLET ROLES v4 — organic buy-first strategy
// Each wallet BUYS from bonding curve independently (looks like real users)
// Then sells at staggered intervals
// ═══════════════════════════════════════
const ROLES = [
  { id: "early1",   weight: 0.18, buyDelay: 3,   sellDelay: 45,  sellPct: 0.80, sellRounds: 2, phase: "early"  },
  { id: "early2",   weight: 0.15, buyDelay: 7,   sellDelay: 55,  sellPct: 0.75, sellRounds: 2, phase: "early"  },
  { id: "mid1",     weight: 0.20, buyDelay: 14,  sellDelay: 70,  sellPct: 0.65, sellRounds: 3, phase: "mid"    },
  { id: "mid2",     weight: 0.17, buyDelay: 22,  sellDelay: 80,  sellPct: 0.60, sellRounds: 2, phase: "mid"    },
  { id: "late1",    weight: 0.16, buyDelay: 35,  sellDelay: 100, sellPct: 0.70, sellRounds: 3, phase: "late"   },
  { id: "late2",    weight: 0.14, buyDelay: 50,  sellDelay: 120, sellPct: 0.85, sellRounds: 2, phase: "late"   },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════
// ENFORCED PROFIT SKIM
// ═══════════════════════════════════════
async function skimSweep(connection, sourceKp, destinationPubkey, profitConfig, solInputForThisWallet = 0) {
  const balance = await connection.getBalance(sourceKp.publicKey);
  // Reserve only base tx fee (5000). Account goes to 0 → no rent issue.
  const available = balance - 5000;
  if (available <= 0) return { swept: 0, skimmed: 0, sig: null };
  const balanceSol = available / LAMPORTS_PER_SOL;
  let skimLamports = 0;
  if (profitConfig && profitConfig.cutPercent > 0 && profitConfig.platformWallet) {
    const profit = balanceSol - solInputForThisWallet;
    if (profit > 0.001) {
      skimLamports = Math.floor(profit * (profitConfig.cutPercent / 100) * LAMPORTS_PER_SOL);
      skimLamports = Math.min(skimLamports, Math.floor(available * 0.9));
    }
  }
  const sweepLamports = available - skimLamports;
  const tx = new Transaction();
  // No priority fee — sweep must leave account at exactly 0 to avoid rent issues
  if (sweepLamports > 0) tx.add(SystemProgram.transfer({ fromPubkey: sourceKp.publicKey, toPubkey: destinationPubkey, lamports: sweepLamports }));
  if (skimLamports > 0 && profitConfig.platformWallet) tx.add(SystemProgram.transfer({ fromPubkey: sourceKp.publicKey, toPubkey: new PublicKey(profitConfig.platformWallet), lamports: skimLamports }));
  const sig = await sendAndConfirmTransaction(connection, tx, [sourceKp], { skipPreflight: true, commitment: "confirmed" });
  return { swept: sweepLamports / LAMPORTS_PER_SOL, skimmed: skimLamports / LAMPORTS_PER_SOL, sig };
}

class FleetTrader extends EventEmitter {
  constructor() {
    super();
    this.connection = new Connection(CONFIG.RPC_URL, "confirmed");
    this.sdk = new PumpSdk();
    this.onlineSdk = new OnlinePumpSdk(this.connection);
    this.sessions = new Map();
  }

  async launch(ca, opts = {}) {
    const { totalSol = 0.5, devKeypair, sessionId, force = false, fleetConfig = {}, profitConfig = null } = opts;
    const { sniperCount = 2, slippage = 25, duration = 60 } = fleetConfig;
    if (this.sessions.has(ca)) return { ok: true, existing: true };
    const mint = new PublicKey(ca);
    let masterKp;
    if (devKeypair instanceof Keypair) masterKp = devKeypair;
    else if (devKeypair?.secretKey) masterKp = Keypair.fromSecretKey(typeof devKeypair.secretKey === "string" ? bs58.decode(devKeypair.secretKey) : devKeypair.secretKey);
    else return { ok: false, error: "No keypair" };

    console.log(`[FLEET] Launching on ${ca.slice(0, 8)}... | Budget: ${totalSol} SOL | Strategy: SMART DISTRIBUTION`);

    const fleetWallets = [];
    const useFleet = totalSol >= 0.3;

    if (useFleet) {
      // Select roles based on budget — fewer wallets for smaller budgets
      const selectedRoles = totalSol < 0.6
        ? ROLES.filter(r => ["early1", "mid1", "late1"].includes(r.id))
        : totalSol < 1.5
          ? ROLES.filter(r => ["early1", "early2", "mid1", "mid2", "late1"].includes(r.id))
          : ROLES;
      const totalWeight = selectedRoles.reduce((s, r) => s + r.weight, 0);

      // Reserve 0.02 SOL for dev wallet fees, rest goes to fleet
      const fleetBudget = totalSol - 0.02;

      for (const role of selectedRoles) {
        const kp = Keypair.generate();
        const walletBudget = (role.weight / totalWeight) * fleetBudget;
        fleetWallets.push({
          keypair: kp, pubkey: kp.publicKey.toBase58(),
          role: role.id, roleConfig: { ...role },
          tokenShare: role.weight / totalWeight,
          allocation: walletBudget, // actual SOL this wallet will buy with
          funded: false, solSpent: 0, solRecovered: 0, trades: [],
        });
      }
      console.log(`[FLEET] Generated ${fleetWallets.length} wallets (organic buy strategy):`);
      for (const w of fleetWallets) console.log(`  [${w.role}] ${w.pubkey.slice(0, 8)}... -> ${w.allocation.toFixed(4)} SOL (buy in ${w.roleConfig.buyDelay}s)`);
      await this._fundWallets(masterKp, fleetWallets);
    } else {
      fleetWallets.push({
        keypair: masterKp, pubkey: masterKp.publicKey.toBase58(), role: "solo",
        roleConfig: { id: "solo", buyDelay: 0, sellDelay: 15, sellPct: 0.90, sellRounds: 3, phase: "solo" },
        tokenShare: 1.0, allocation: totalSol, funded: true, solSpent: 0, solRecovered: 0, trades: [],
      });
    }

    const session = {
      ca, mint, masterKp, totalSol, sessionId, fleetWallets,
      fleetConfig: { sniperCount, slippage, duration },
      startTime: Date.now(), phase: "starting", running: true,
      tradeCount: 0, totalSolSpent: 0, totalSolRecovered: 0, _profitConfig: profitConfig,
    };
    this.sessions.set(ca, session);
    const walletKeys = fleetWallets.map(w => ({ role: w.role, pubkey: w.pubkey, secret: bs58.encode(w.keypair.secretKey), allocation: w.allocation, tokenShare: w.tokenShare }));
    session._walletKeys = walletKeys;

    if (duration > 0) setTimeout(() => { if (session.running) { session.running = false; session.phase = "duration_complete"; } }, duration * 60 * 1000);

    this._runSmartFleet(session).catch(e => { console.error(`[FLEET] Fatal:`, e.message); session.running = false; session.phase = "error"; });
    return { ok: true, ca, wallets: fleetWallets.length, phase: "starting", walletKeys };
  }

  // Fund each wallet with its buy allocation + fee buffer
  async _fundWallets(master, wallets) {
    for (const w of wallets) {
      if (w.keypair.publicKey.equals(master.publicKey)) { w.funded = true; continue; }
      try {
        const fundAmount = Math.floor((w.allocation + 0.003) * LAMPORTS_PER_SOL); // allocation + fee buffer
        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
          SystemProgram.transfer({ fromPubkey: master.publicKey, toPubkey: w.keypair.publicKey, lamports: fundAmount }),
        );
        await sendAndConfirmTransaction(this.connection, tx, [master], { skipPreflight: true, commitment: "confirmed" });
        w.funded = true;
        console.log(`[FLEET] [${w.role}] Funded ${(fundAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      } catch (e) { console.error(`[FLEET] [${w.role}] Fund failed: ${e.message}`); }
      await sleep(300);
    }
  }

  // Legacy: minimal funding for token-transfer-only strategies  
  async _fundWalletsMinimal(master, wallets) {
    for (const w of wallets) {
      if (w.keypair.publicKey.equals(master.publicKey)) { w.funded = true; continue; }
      try {
        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
          SystemProgram.transfer({ fromPubkey: master.publicKey, toPubkey: w.keypair.publicKey, lamports: Math.floor(0.005 * LAMPORTS_PER_SOL) }),
        );
        await sendAndConfirmTransaction(this.connection, tx, [master], { skipPreflight: true, commitment: "confirmed" });
        w.funded = true;
        console.log(`[FLEET] [${w.role}] Funded 0.005 SOL (fees)`);
      } catch (e) { console.error(`[FLEET] [${w.role}] Fund failed: ${e.message}`); }
      await sleep(300);
    }
  }

  // ═══════════════════════════════════════
  // ORGANIC FLEET v4
  // Phase 1: Each wallet buys independently from bonding curve (staggered, looks like real users)
  // Phase 2: Fleet sells at staggered intervals (take profit)
  // Phase 3: Hold (optional re-accumulate)
  // ═══════════════════════════════════════
  async _runSmartFleet(session) {
    const { ca, mint, masterKp, fleetWallets } = session;
    session.phase = "initializing";
    let global, feeConfig;
    try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); }
    catch (e) { console.error("[FLEET] Failed to fetch global:", e.message); session.phase = "error"; return; }

    const isSolo = fleetWallets.length === 1 && fleetWallets[0].keypair.publicKey.equals(masterKp.publicKey);

    // ── PHASE 1: Staggered buys from multiple wallets (organic activity) ──
    session.phase = "buying";
    this.emit("phase", { ca, phase: "buying" });
    console.log(`[FLEET] Phase 1: Staggered buys from ${fleetWallets.length} wallet(s)...`);

    if (isSolo) {
      // Solo mode: dev already bought on create, skip to selling
      console.log(`[FLEET] Solo mode — dev already holds tokens from creation buy`);
    } else {
      // Each wallet buys independently with randomized timing
      const buyPromises = fleetWallets.filter(w => w.funded).map(async (wallet) => {
        const baseDelay = (wallet.roleConfig.buyDelay || 10) * 1000;
        const jitter = Math.random() * baseDelay * 0.5; // ±50% randomization
        await sleep(baseDelay + jitter);
        if (!session.running) return;

        // Buy with ~90% of allocation (keep 10% for sell tx fees)
        const buyAmount = wallet.allocation * 0.90;
        if (buyAmount < 0.01) { console.log(`[FLEET] [${wallet.role}] Skip buy — too small (${buyAmount.toFixed(4)} SOL)`); return; }

        // Refetch global for fresh bonding curve state
        try {
          global = await this.onlineSdk.fetchGlobal();
          feeConfig = await this.onlineSdk.fetchFeeConfig();
        } catch {}

        try {
          console.log(`[FLEET] [${wallet.role}] BUY ${buyAmount.toFixed(4)} SOL...`);
          const result = await this._executeBuy(wallet, mint, global, feeConfig, buyAmount);
          if (result.ok) {
            wallet.solSpent += buyAmount;
            wallet.trades.push({ side: "buy", solIn: buyAmount, sig: result.sig, time: Date.now() });
            session.tradeCount++; session.totalSolSpent += buyAmount;
            this.emit("trade", { ca, role: wallet.role, side: "buy", sol: buyAmount, sig: result.sig });
            console.log(`[FLEET] [${wallet.role}] BUY OK -> ${buyAmount.toFixed(4)} SOL | sig: ${result.sig?.slice(0, 12)}`);
          } else {
            console.error(`[FLEET] [${wallet.role}] Buy failed:`, result.error);
          }
        } catch (e) { console.error(`[FLEET] [${wallet.role}] Buy error:`, e.message); }
      });
      await Promise.allSettled(buyPromises);
      console.log(`[FLEET] Phase 1 complete — ${session.tradeCount} buys across ${fleetWallets.filter(w => w.funded).length} wallets`);
    }

    // ── PHASE 2: Sell at staggered intervals ──
    if (!session.running) return;
    session.phase = "selling";
    this.emit("phase", { ca, phase: "selling" });
    console.log(`[FLEET] Phase 2: Staggered sells...`);

    // Refetch global before sell phase
    try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); } catch {}

    const sellWallets = isSolo
      ? fleetWallets.filter(w => w.funded)
      : fleetWallets.filter(w => w.funded);
    // In v4 all wallets sell (they all hold tokens from their own buys)

    console.log(`[FLEET] Phase 2: ${sellWallets.length} wallet(s) selling...`);

    const sellPromises = sellWallets.map(async (wallet) => {
      const delay = (wallet.roleConfig.sellDelay || 30) * 1000;
      const jitter = Math.random() * delay * 0.3;
      await sleep(delay + jitter);
      if (!session.running) return;
      return this._runSellLoop(session, wallet, global, feeConfig);
    });
    await Promise.allSettled(sellPromises);

    if (session.running) { session.phase = "holding"; this.emit("phase", { ca, phase: "holding" }); }
  }

  async _runSellLoop(session, wallet, global, feeConfig) {
    const { ca, mint } = session;
    const { sellPct, sellRounds } = wallet.roleConfig;
    console.log(`[FLEET] [${wallet.role}] Starting sell — ${sellRounds} rounds, ${(sellPct * 100).toFixed(0)}%`);
    const pctPerRound = sellPct / sellRounds;
    for (let i = 0; i < sellRounds && session.running; i++) {
      const actualPct = pctPerRound * (0.7 + Math.random() * 0.6);
      try {
        const result = await this._executeSell(wallet, mint, global, feeConfig, Math.min(actualPct, 0.95));
        if (result.ok) {
          wallet.solRecovered += result.solOut || 0;
          wallet.trades.push({ side: "sell", solOut: result.solOut, sig: result.sig, time: Date.now() });
          session.tradeCount++; session.totalSolRecovered += result.solOut || 0;
          this.emit("trade", { ca, role: wallet.role, side: "sell", sol: result.solOut, sig: result.sig });
          console.log(`[FLEET] [${wallet.role}] SELL ${i + 1}/${sellRounds} -> ${(result.solOut || 0).toFixed(4)} SOL`);
        }
      } catch (e) { console.error(`[FLEET] [${wallet.role}] Sell failed:`, e.message); }
      if (i < sellRounds - 1) await sleep((10 + Math.random() * 30) * 1000);
    }
  }

  async _executeBuy(wallet, mint, global, feeConfig, solAmount) {
    const { keypair } = wallet;
    const buyState = await this.onlineSdk.fetchBuyState(mint, keypair.publicKey);
    const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } = buyState;
    const mintSupply = bondingCurve.tokenTotalSupply || global.tokenTotalSupply;
    const solBN = new BN(Math.floor(solAmount * 1e9));
    const tokenAmount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply, bondingCurve, amount: solBN });
    if (tokenAmount.isZero()) return { ok: false, error: "Zero tokens" };
    const instructions = await this.sdk.buyInstructions({ global, bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo, mint, user: keypair.publicKey, amount: tokenAmount, solAmount: solBN, slippage: 25 });
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }), ...instructions);
    const sig = await sendAndConfirmTransaction(this.connection, tx, [keypair], { skipPreflight: true, commitment: "confirmed", maxRetries: 3 });
    return { ok: true, sig, tokens: tokenAmount.toString() };
  }

  async _executeSell(wallet, mint, global, feeConfig, sellPercent) {
    const { keypair } = wallet;
    let tokenBalance;
    try { const ata = getAssociatedTokenAddressSync(mint, keypair.publicKey, true); const account = await getAccount(this.connection, ata); tokenBalance = new BN(account.amount.toString()); }
    catch { return { ok: false, error: "No token account" }; }
    if (tokenBalance.isZero()) return { ok: false, error: "Zero balance" };
    const sellAmount = tokenBalance.muln(Math.floor(sellPercent * 1000)).divn(1000);
    if (sellAmount.isZero()) return { ok: false, error: "Too small" };
    const sellState = await this.onlineSdk.fetchSellState(mint, keypair.publicKey);
    const { bondingCurveAccountInfo, bondingCurve } = sellState;
    const mintSupply = bondingCurve.tokenTotalSupply || global.tokenTotalSupply;
    const solOut = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply, bondingCurve, amount: sellAmount });
    const instructions = await this.sdk.sellInstructions({ global, bondingCurveAccountInfo, bondingCurve, mint, user: keypair.publicKey, amount: sellAmount, solAmount: solOut, slippage: 50 });
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }), ...instructions);
    const sig = await sendAndConfirmTransaction(this.connection, tx, [keypair], { skipPreflight: true, commitment: "confirmed", maxRetries: 3 });
    return { ok: true, sig, solOut: parseFloat(solOut.toString()) / 1e9, tokens: sellAmount.toString() };
  }

  async close(ca) {
    const session = this.sessions.get(ca);
    if (!session) throw new Error(`No active session for ${ca.slice(0, 8)}`);
    if (session.phase === "closing") throw new Error("Already closing");
    if (session.phase === "closed") return session._closeResult || {};
    session.running = false; session.phase = "closing";
    this.emit("phase", { ca, phase: "closing" });
    await sleep(3000);
    // Fetch global/feeConfig with retry — critical for selling tokens
    let global, feeConfig;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); break; }
      catch (e) { console.error(`[FLEET] fetchGlobal attempt ${attempt + 1}/3 failed:`, e.message); await sleep(1000); }
    }
    if (!global || !feeConfig) console.error("[FLEET] WARNING: Could not fetch global/feeConfig — fleet tokens will NOT be sold!");

    // Sell all remaining tokens from each wallet
    for (const wallet of session.fleetWallets) {
      try {
        let tokenBalance;
        try { const ata = getAssociatedTokenAddressSync(session.mint, wallet.keypair.publicKey, true); const account = await getAccount(this.connection, ata); tokenBalance = new BN(account.amount.toString()); }
        catch { tokenBalance = new BN(0); }
        if (tokenBalance.isZero()) {
          console.log(`[FLEET] [${wallet.role}] Close: no tokens to sell`);
          continue;
        }
        if (!global || !feeConfig) {
          console.error(`[FLEET] [${wallet.role}] Close: SKIPPING sell — no global/feeConfig (${tokenBalance.toString()} tokens stranded!)`);
          continue;
        }
        console.log(`[FLEET] [${wallet.role}] Close: selling ${tokenBalance.toString()} tokens...`);
        const result = await this._executeSell(wallet, session.mint, global, feeConfig, 1.0);
        if (result.ok) {
          wallet.solRecovered += result.solOut || 0; session.totalSolRecovered += result.solOut || 0;
          console.log(`[FLEET] [${wallet.role}] Close: SOLD -> ${(result.solOut || 0).toFixed(4)} SOL | sig: ${result.sig?.slice(0, 12)}`);
        } else {
          console.error(`[FLEET] [${wallet.role}] Close: sell returned not ok:`, result.error);
        }
      } catch (e) { console.error(`[FLEET] [${wallet.role}] Close sell failed:`, e.message); }
      await sleep(500);
    }
    let totalSkimmed = 0;
    for (const wallet of session.fleetWallets) {
      if (wallet.keypair.publicKey.equals(session.masterKp.publicKey)) continue;
      try {
        const result = await skimSweep(this.connection, wallet.keypair, session.masterKp.publicKey, session._profitConfig, wallet.allocation || 0);
        if (result.swept > 0) console.log(`[FLEET] [${wallet.role}] Swept ${result.swept.toFixed(4)} SOL`);
        totalSkimmed += result.skimmed;
      } catch (e) { console.error(`[FLEET] [${wallet.role}] Sweep failed:`, e.message); }
      await sleep(300);
    }
    let masterBalance = 0;
    try { masterBalance = await this.connection.getBalance(session.masterKp.publicKey) / LAMPORTS_PER_SOL; } catch {}
    const netProfit = session.totalSolRecovered - session.totalSolSpent;
    session.phase = "closed";
    const closeResult = { trades: session.tradeCount, wallets: session.fleetWallets.length, solSpent: session.totalSolSpent, solRecovered: session.totalSolRecovered, netProfit, masterBalance, platformCut: totalSkimmed };
    session._closeResult = closeResult;
    setTimeout(() => { this.sessions.delete(ca); }, 5 * 60 * 1000);
    return closeResult;
  }

  async closeAll() {
    const results = {};
    for (const ca of [...this.sessions.keys()]) {
      try { results[ca] = await this.close(ca); } catch (e) { results[ca] = { error: e.message }; }
    }
    return { results };
  }

  async recover(walletSecrets, destinationPubkey, profitConfig = null) {
    const dest = new PublicKey(destinationPubkey);
    const results = []; let totalRecovered = 0;
    for (const secret of walletSecrets) {
      try {
        const kp = Keypair.fromSecretKey(bs58.decode(secret));
        const balance = await this.connection.getBalance(kp.publicKey);
        if (balance <= 6000) { results.push({ pubkey: kp.publicKey.toBase58().slice(0, 8), status: "empty" }); continue; }
        const sweepResult = await skimSweep(this.connection, kp, dest, profitConfig, 0);
        totalRecovered += sweepResult.swept;
        results.push({ pubkey: kp.publicKey.toBase58().slice(0, 8), swept: sweepResult.swept, status: "ok" });
      } catch (e) { results.push({ pubkey: "?", error: e.message, status: "failed" }); }
      await sleep(300);
    }
    return { totalRecovered, wallets: results };
  }

  stop(ca) { const s = this.sessions.get(ca); if (s) s.running = false; }

  status() {
    const sessions = {};
    for (const [ca, s] of this.sessions) {
      sessions[ca] = {
        phase: s.phase, running: s.running, tradeCount: s.tradeCount,
        solSpent: s.totalSolSpent, solRecovered: s.totalSolRecovered,
        elapsed: Date.now() - s.startTime,
        activeWallets: s.fleetWallets.filter(w => w.funded).length,
        walletDetails: s.fleetWallets.map(w => ({ role: w.role, pubkey: w.pubkey.slice(0, 8), allocation: w.allocation, spent: w.solSpent, recovered: w.solRecovered, trades: w.trades.length })),
      };
    }
    return { sessions, activeSessions: this.sessions.size };
  }

  getSessionStatus(ca) {
    const s = ca ? this.sessions.get(ca) : this.sessions.values().next().value;
    if (!s) return null;
    return { phase: s.phase, running: s.running, ca: s.ca, tradeCount: s.tradeCount, solSpent: s.totalSolSpent, solRecovered: s.totalSolRecovered, activeWallets: s.fleetWallets.filter(w => w.funded).length };
  }
}

export { FleetTrader, skimSweep };
