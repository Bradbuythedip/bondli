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
// WALLET ROLES v3 — sell-focused, tokens distributed from dev
// ═══════════════════════════════════════
const ROLES = [
  { id: "sniper",      weight: 0.08, sellDelay: 3,   sellPct: 0.95, sellRounds: 1, phase: "snipe"    },
  { id: "accumulator", weight: 0.12, sellDelay: 20,  sellPct: 0.60, sellRounds: 2, phase: "accum"    },
  { id: "momentum",    weight: 0.22, sellDelay: 45,  sellPct: 0.70, sellRounds: 3, phase: "momentum" },
  { id: "swing",       weight: 0.18, sellDelay: 90,  sellPct: 0.50, sellRounds: 2, phase: "swing"    },
  { id: "whale",       weight: 0.28, sellDelay: 150, sellPct: 0.40, sellRounds: 3, phase: "whale"    },
  { id: "liquidator",  weight: 0.08, sellDelay: 240, sellPct: 0.90, sellRounds: 2, phase: "exit"     },
  { id: "recycler",    weight: 0.04, sellDelay: 300, sellPct: 0.80, sellRounds: 1, phase: "recycle"  },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════
// ENFORCED PROFIT SKIM
// ═══════════════════════════════════════
async function skimSweep(connection, sourceKp, destinationPubkey, profitConfig, solInputForThisWallet = 0) {
  const balance = await connection.getBalance(sourceKp.publicKey);
  const available = balance - 6000;
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
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));
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
      const selectedRoles = totalSol < 0.5
        ? ROLES.filter(r => ["momentum", "whale"].includes(r.id))
        : totalSol < 2
          ? ROLES.filter(r => ["sniper", "accumulator", "momentum", "whale", "liquidator"].includes(r.id))
          : ROLES;
      const totalWeight = selectedRoles.reduce((s, r) => s + r.weight, 0);
      for (const role of selectedRoles) {
        const count = role.id === "sniper" ? Math.max(1, Math.min(5, sniperCount)) : 1;
        const perWalletWeight = (role.weight / totalWeight) / count;
        for (let n = 0; n < count; n++) {
          const kp = Keypair.generate();
          fleetWallets.push({
            keypair: kp, pubkey: kp.publicKey.toBase58(),
            role: role.id, roleConfig: { ...role, isSniper: role.id === "sniper" },
            tokenShare: perWalletWeight, allocation: 0.005,
            funded: false, solSpent: 0, solRecovered: 0, trades: [],
          });
        }
      }
      console.log(`[FLEET] Generated ${fleetWallets.length} wallets (token distribution):`);
      for (const w of fleetWallets) console.log(`  [${w.role}] ${w.pubkey.slice(0, 8)}... -> ${(w.tokenShare * 100).toFixed(1)}% tokens`);
      await this._fundWalletsMinimal(masterKp, fleetWallets);
    } else {
      fleetWallets.push({
        keypair: masterKp, pubkey: masterKp.publicKey.toBase58(), role: "solo",
        roleConfig: { id: "solo", sellDelay: 30, sellPct: 0.50, sellRounds: 3, phase: "solo" },
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
  // SMART FLEET — the new strategy
  // Phase 1: Dev sells 35% → volume + SOL recovery
  // Phase 2: Distribute remaining tokens to fleet
  // Phase 3: Fleet sells at staggered intervals
  // ═══════════════════════════════════════
  async _runSmartFleet(session) {
    const { ca, mint, masterKp, fleetWallets } = session;
    session.phase = "initializing";
    let global, feeConfig;
    try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); }
    catch (e) { console.error("[FLEET] Failed to fetch global:", e.message); session.phase = "error"; return; }

    // ── PHASE 1: Dev sells 35% for volume + SOL recovery ──
    session.phase = "dev_selling";
    this.emit("phase", { ca, phase: "dev_selling" });
    console.log(`[FLEET] Phase 1: Dev selling 35% of tokens...`);

    let devTokenBalance = new BN(0);
    try {
      const ata = getAssociatedTokenAddressSync(mint, masterKp.publicKey, true);
      const account = await getAccount(this.connection, ata);
      devTokenBalance = new BN(account.amount.toString());
      console.log(`[FLEET] Dev token balance: ${devTokenBalance.toString()}`);
    } catch (e) { console.error("[FLEET] Dev has no tokens:", e.message); }

    if (!devTokenBalance.isZero() && session.running) {
      const sellChunks = 2 + Math.floor(Math.random() * 2);
      const totalSellTokens = devTokenBalance.muln(350).divn(1000); // 35%
      let soldSoFar = new BN(0);

      for (let i = 0; i < sellChunks && session.running; i++) {
        const remaining = totalSellTokens.sub(soldSoFar);
        if (remaining.isZero()) break;
        const chunkPct = 1.0 / (sellChunks - i);
        const chunkAmount = remaining.muln(Math.floor(chunkPct * 1000)).divn(1000);
        try {
          const sellState = await this.onlineSdk.fetchSellState(mint, masterKp.publicKey);
          const { bondingCurveAccountInfo, bondingCurve } = sellState;
          const mintSupply = bondingCurve.tokenTotalSupply || global.tokenTotalSupply;
          const solOut = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply, bondingCurve, amount: chunkAmount });
          const instructions = await this.sdk.sellInstructions({ global, bondingCurveAccountInfo, bondingCurve, mint, user: masterKp.publicKey, amount: chunkAmount, solAmount: solOut, slippage: 50 });
          const tx = new Transaction();
          tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }), ...instructions);
          const sig = await sendAndConfirmTransaction(this.connection, tx, [masterKp], { skipPreflight: true, commitment: "confirmed" });
          const solAmount = parseFloat(solOut.toString()) / 1e9;
          soldSoFar = soldSoFar.add(chunkAmount);
          session.tradeCount++; session.totalSolRecovered += solAmount;
          this.emit("trade", { ca, role: "dev", side: "sell", sol: solAmount, sig });
          console.log(`[FLEET] [dev] SELL chunk ${i + 1}/${sellChunks} -> ${solAmount.toFixed(4)} SOL | sig: ${sig?.slice(0, 12)}`);
        } catch (e) { console.error(`[FLEET] [dev] Sell chunk ${i + 1} failed:`, e.message); }
        await sleep(2000 + Math.random() * 3000);
      }
    }

    // ── PHASE 2: Distribute remaining tokens to fleet ──
    if (fleetWallets.length > 1 && session.running) {
      session.phase = "distributing";
      this.emit("phase", { ca, phase: "distributing" });
      console.log(`[FLEET] Phase 2: Distributing tokens to ${fleetWallets.length} wallets...`);

      try {
        const ata = getAssociatedTokenAddressSync(mint, masterKp.publicKey, true);
        const account = await getAccount(this.connection, ata);
        devTokenBalance = new BN(account.amount.toString());
      } catch { devTokenBalance = new BN(0); }

      if (!devTokenBalance.isZero()) {
        const distributeTotal = devTokenBalance.muln(900).divn(1000); // distribute 90%, keep 10%

        for (const wallet of fleetWallets) {
          if (wallet.keypair.publicKey.equals(masterKp.publicKey)) continue;
          if (!wallet.funded || !session.running) continue;
          const tokenAmount = distributeTotal.muln(Math.floor(wallet.tokenShare * 10000)).divn(10000);
          if (tokenAmount.isZero()) continue;
          try {
            const fromAta = getAssociatedTokenAddressSync(mint, masterKp.publicKey, true);
            const toAta = getAssociatedTokenAddressSync(mint, wallet.keypair.publicKey, true);
            const tx = new Transaction();
            tx.add(
              ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
              createAssociatedTokenAccountInstruction(masterKp.publicKey, toAta, wallet.keypair.publicKey, mint),
              createTransferInstruction(fromAta, toAta, masterKp.publicKey, BigInt(tokenAmount.toString())),
            );
            const sig = await sendAndConfirmTransaction(this.connection, tx, [masterKp], { skipPreflight: true, commitment: "confirmed" });
            console.log(`[FLEET] [${wallet.role}] Received tokens | sig: ${sig?.slice(0, 12)}`);
          } catch (e) { console.error(`[FLEET] [${wallet.role}] Token transfer failed: ${e.message}`); }
          await sleep(400);
        }
      }
    }

    // ── PHASE 3: Fleet sells at staggered intervals ──
    session.phase = "trading";
    this.emit("phase", { ca, phase: "trading" });
    console.log(`[FLEET] Phase 3: Fleet selling at staggered intervals...`);

    const promises = fleetWallets.filter(w => w.funded && !w.keypair.publicKey.equals(masterKp.publicKey)).map(async (wallet) => {
      const delay = (wallet.roleConfig.sellDelay || 30) * 1000;
      await sleep(delay + Math.random() * delay * 0.3);
      if (!session.running) return;
      return this._runSellLoop(session, wallet, global, feeConfig);
    });
    await Promise.allSettled(promises);

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
    let global, feeConfig;
    try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); } catch {}
    for (const wallet of session.fleetWallets) {
      try {
        let tokenBalance;
        try { const ata = getAssociatedTokenAddressSync(session.mint, wallet.keypair.publicKey, true); const account = await getAccount(this.connection, ata); tokenBalance = new BN(account.amount.toString()); }
        catch { tokenBalance = new BN(0); }
        if (!tokenBalance.isZero() && global && feeConfig) {
          const result = await this._executeSell(wallet, session.mint, global, feeConfig, 1.0);
          if (result.ok) { wallet.solRecovered += result.solOut || 0; session.totalSolRecovered += result.solOut || 0; }
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
