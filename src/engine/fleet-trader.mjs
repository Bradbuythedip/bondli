// BONDLI — Fleet Trader v2 (real multi-wallet trading via pump.fun SDK)
// Generates wallet fleet, funds from dev wallet, trades with role-based strategies
import {
  Connection, Keypair, PublicKey, Transaction,
  ComputeBudgetProgram, sendAndConfirmTransaction,
  LAMPORTS_PER_SOL, SystemProgram,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PumpSdk, OnlinePumpSdk, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount } from "@pump-fun/pump-sdk";
import BN from "bn.js";
import bs58 from "bs58";
import CONFIG from "./config.mjs";

// ═══════════════════════════════════════
// WALLET ROLES — each role has timing + behavior
// ═══════════════════════════════════════
const ROLES = [
  { id: "sniper",      weight: 0.08, phase: "snipe",    buyPct: 0.90, sellPct: 0.0,  delayMin: 1,  delayMax: 3    },
  { id: "accumulator", weight: 0.12, phase: "accum",    buyPct: 0.70, sellPct: 0.15, delayMin: 5,  delayMax: 15   },
  { id: "momentum",    weight: 0.22, phase: "momentum", buyPct: 0.80, sellPct: 0.20, delayMin: 8,  delayMax: 25   },
  { id: "swing",       weight: 0.18, phase: "swing",    buyPct: 0.50, sellPct: 0.40, delayMin: 15, delayMax: 45   },
  { id: "whale",       weight: 0.28, phase: "whale",    buyPct: 0.85, sellPct: 0.10, delayMin: 20, delayMax: 60   },
  { id: "liquidator",  weight: 0.08, phase: "exit",     buyPct: 0.30, sellPct: 0.70, delayMin: 30, delayMax: 90   },
  { id: "recycler",    weight: 0.04, phase: "recycle",  buyPct: 0.40, sellPct: 0.60, delayMin: 45, delayMax: 120  },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════
// FLEET TRADER
// ═══════════════════════════════════════
export class FleetTrader {
  constructor(connection) {
    this.connection = connection || new Connection(CONFIG.RPC_URL, "confirmed");
    this.sdk = new PumpSdk(this.connection);
    this.onlineSdk = new OnlinePumpSdk(this.connection);
    this.sessions = new Map();
    this.listeners = [];
  }

  emit(event, data) {
    const msg = JSON.stringify({ event, data, ts: Date.now() });
    for (const fn of this.listeners) { try { fn(msg); } catch {} }
  }

  onEvent(fn) { this.listeners.push(fn); }

  // ── Launch fleet on a CA ──
  async launch(ca, opts = {}) {
    const { totalSol = 0.5, devKeypair, sessionId, force = false, fleetConfig = {} } = opts;
    const {
      sniperCount = 2,     // how many sniper wallets
      slippage = 25,       // bps
      duration = 60,       // minutes to run
    } = fleetConfig;

    if (this.sessions.has(ca)) {
      console.warn(`[FLEET] Session already exists for ${ca.slice(0, 8)}`);
      return { ok: true, existing: true };
    }

    const mint = new PublicKey(ca);

    // Resolve devKeypair
    let masterKp;
    if (devKeypair instanceof Keypair) masterKp = devKeypair;
    else if (devKeypair?.secretKey) {
      masterKp = Keypair.fromSecretKey(
        typeof devKeypair.secretKey === "string" ? bs58.decode(devKeypair.secretKey) : devKeypair.secretKey
      );
    } else {
      console.error("[FLEET] No valid keypair");
      return { ok: false, error: "No keypair" };
    }

    console.log(`[FLEET] Launching on ${ca.slice(0, 8)}... | Budget: ${totalSol} SOL | Master: ${masterKp.publicKey.toBase58().slice(0, 8)}...`);

    // ── Generate wallet fleet ──
    const fleetWallets = [];
    const minBudget = 0.3;
    const useFleet = totalSol >= minBudget;

    if (useFleet) {
      const selectedRoles = totalSol < 0.5
        ? ROLES.filter(r => ["momentum", "whale"].includes(r.id))
        : totalSol < 2
          ? ROLES.filter(r => ["sniper", "accumulator", "momentum", "whale", "liquidator"].includes(r.id))
          : ROLES;

      const totalWeight = selectedRoles.reduce((s, r) => s + r.weight, 0);
      const reserveForFees = Math.min(0.05, totalSol * 0.05);
      const distributable = totalSol - reserveForFees;

      for (const role of selectedRoles) {
        // Create multiple sniper wallets based on sniperCount
        const count = role.id === "sniper" ? Math.max(1, Math.min(5, sniperCount)) : 1;
        const perWalletAlloc = ((role.weight / totalWeight) * distributable) / count;

        for (let n = 0; n < count; n++) {
          if (perWalletAlloc < 0.003) continue;
          const kp = Keypair.generate();
          fleetWallets.push({
            keypair: kp, pubkey: kp.publicKey.toBase58(),
            role: role.id, roleConfig: { ...role, isSniper: role.id === "sniper" },
            allocation: perWalletAlloc,
            funded: false, solSpent: 0, solRecovered: 0, trades: [],
          });
        }
      }

      console.log(`[FLEET] Generated ${fleetWallets.length} wallets:`);
      for (const w of fleetWallets) console.log(`  [${w.role}] ${w.pubkey.slice(0, 8)}... -> ${w.allocation.toFixed(4)} SOL`);

      // Fund wallets
      await this._fundWallets(masterKp, fleetWallets);
    } else {
      fleetWallets.push({
        keypair: masterKp, pubkey: masterKp.publicKey.toBase58(),
        role: "solo",
        roleConfig: { id: "solo", weight: 1, buyPct: 0.80, sellPct: 0.20, delayMin: 3, delayMax: 10, phase: "solo" },
        allocation: totalSol, funded: true, solSpent: 0, solRecovered: 0, trades: [],
      });
    }

    const session = {
      ca, mint, masterKp, totalSol, sessionId, fleetWallets,
      fleetConfig: { sniperCount, slippage, duration },
      startTime: Date.now(), phase: "starting", running: true,
      tradeCount: 0, totalSolSpent: 0, totalSolRecovered: 0,
    };
    this.sessions.set(ca, session);

    // Auto-stop after duration
    if (duration > 0) {
      setTimeout(() => {
        if (session.running) {
          console.log(`[FLEET] Duration ${duration}m reached — stopping ${ca.slice(0, 8)}`);
          session.running = false;
          session.phase = "duration_complete";
        }
      }, duration * 60 * 1000);
    }

    // Start all wallet trading loops
    this._runFleet(session).catch(e => {
      console.error(`[FLEET] Fatal on ${ca.slice(0, 8)}:`, e.message);
      session.running = false; session.phase = "error";
    });

    return { ok: true, ca, wallets: fleetWallets.length, phase: "starting" };
  }

  // ── Fund wallets from master ──
  async _fundWallets(master, wallets) {
    for (const w of wallets) {
      const lamports = Math.floor(w.allocation * LAMPORTS_PER_SOL);
      if (lamports < 10000) continue;

      try {
        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
          SystemProgram.transfer({
            fromPubkey: master.publicKey, toPubkey: w.keypair.publicKey, lamports,
          })
        );
        const sig = await sendAndConfirmTransaction(this.connection, tx, [master], { skipPreflight: true, commitment: "confirmed" });
        w.funded = true;
        console.log(`[FLEET] Funded [${w.role}] ${w.pubkey.slice(0, 8)}: ${w.allocation.toFixed(4)} SOL`);
        this.emit("wallet:funded", { role: w.role, pubkey: w.pubkey, sol: w.allocation });
      } catch (e) {
        console.error(`[FLEET] Fund [${w.role}] failed:`, e.message);
      }
      await sleep(500 + Math.random() * 500);
    }
  }

  // ── Run all wallet roles concurrently ──
  async _runFleet(session) {
    await sleep(5000); // wait for token propagation

    let global, feeConfig;
    try {
      global = await this.onlineSdk.fetchGlobal();
      feeConfig = await this.onlineSdk.fetchFeeConfig();
    } catch (e) {
      console.error("[FLEET] Failed to fetch global:", e.message);
      session.phase = "error"; return;
    }

    session.phase = "trading";
    this.emit("phase", { ca: session.ca, phase: "trading" });

    // Stagger wallet activation by phase
    const phaseDelays = { snipe: 0, accum: 5, momentum: 12, swing: 25, whale: 40, exit: 60, recycle: 90, solo: 0 };

    const promises = session.fleetWallets.filter(w => w.funded).map(async (wallet) => {
      const startDelay = (phaseDelays[wallet.roleConfig.phase] || 0) * 1000;
      if (startDelay > 0) {
        console.log(`[FLEET] [${wallet.role}] Activating in ${startDelay / 1000}s...`);
        await sleep(startDelay + Math.random() * 3000);
      }
      if (!session.running) return;
      return this._runWalletLoop(session, wallet, global, feeConfig);
    });

    await Promise.allSettled(promises);

    if (session.running) {
      session.phase = "holding";
      this.emit("phase", { ca: session.ca, phase: "holding" });
      console.log(`[FLEET] All wallets done. Holding. Total trades: ${session.tradeCount}`);
    }
  }

  // ── Individual wallet loop ──
  async _runWalletLoop(session, wallet, global, feeConfig) {
    const { ca, mint } = session;
    const { roleConfig, allocation } = wallet;
    const { buyPct, sellPct, delayMin, delayMax } = roleConfig;

    // ── SNIPER SPECIAL LOGIC: buy fast, then sell everything after 15-45s ──
    if (roleConfig.isSniper) {
      return this._runSniperLoop(session, wallet, global, feeConfig);
    }

    const maxBuySol = allocation * buyPct;
    let spent = 0;
    const rounds = 2 + Math.floor(Math.random() * 3);

    console.log(`[FLEET] [${wallet.role}] Starting — ${allocation.toFixed(4)} SOL, ${rounds} rounds`);

    // BUY PHASE
    for (let i = 0; i < rounds && session.running; i++) {
      const remaining = maxBuySol - spent;
      if (remaining < 0.003) break;

      const baseBuy = remaining / (rounds - i);
      const buyAmount = Math.max(0.003, baseBuy * (0.6 + Math.random() * 0.8));
      const cappedBuy = Math.min(buyAmount, remaining);

      try {
        const freshGlobal = await this.onlineSdk.fetchGlobal().catch(() => global);
        const result = await this._executeBuy(wallet, mint, freshGlobal, feeConfig, cappedBuy);
        if (result.ok) {
          spent += cappedBuy;
          wallet.solSpent += cappedBuy;
          wallet.trades.push({ side: "buy", sol: cappedBuy, sig: result.sig, time: Date.now() });
          session.tradeCount++;
          session.totalSolSpent += cappedBuy;
          this.emit("trade", { ca, role: wallet.role, side: "buy", sol: cappedBuy, sig: result.sig });
          console.log(`[FLEET] [${wallet.role}] BUY ${cappedBuy.toFixed(4)} SOL -> ${result.sig?.slice(0, 12)}...`);
        }
      } catch (e) {
        console.error(`[FLEET] [${wallet.role}] Buy failed:`, e.message);
      }

      await sleep((delayMin + Math.random() * (delayMax - delayMin)) * 1000);
    }

    // SELL PHASE
    if (sellPct > 0 && session.running) {
      await sleep((delayMin * 2 + Math.random() * delayMax) * 1000);

      const sellRounds = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < sellRounds && session.running; i++) {
        const pctToSell = sellPct / sellRounds * (0.8 + Math.random() * 0.4);

        try {
          const result = await this._executeSell(wallet, mint, global, feeConfig, Math.min(pctToSell, 0.95));
          if (result.ok) {
            wallet.solRecovered += result.solOut || 0;
            wallet.trades.push({ side: "sell", solOut: result.solOut, sig: result.sig, time: Date.now() });
            session.tradeCount++;
            session.totalSolRecovered += result.solOut || 0;
            this.emit("trade", { ca, role: wallet.role, side: "sell", sol: result.solOut, sig: result.sig });
            console.log(`[FLEET] [${wallet.role}] SELL ${(pctToSell * 100).toFixed(0)}% -> ${(result.solOut || 0).toFixed(4)} SOL`);
          }
        } catch (e) {
          console.error(`[FLEET] [${wallet.role}] Sell failed:`, e.message);
        }
        await sleep((delayMin + Math.random() * delayMax) * 1000);
      }
    }

    console.log(`[FLEET] [${wallet.role}] Done — spent: ${wallet.solSpent.toFixed(4)}, recovered: ${wallet.solRecovered.toFixed(4)}`);
  }

  // ── Sniper loop: buy fast, hold 15-45s, sell everything ──
  async _runSniperLoop(session, wallet, global, feeConfig) {
    const { ca, mint } = session;
    const buyAmount = wallet.allocation * 0.9;

    console.log(`[FLEET] [sniper] ${wallet.pubkey.slice(0, 8)} — buying ${buyAmount.toFixed(4)} SOL`);

    // INSTANT BUY
    try {
      const fg = await this.onlineSdk.fetchGlobal().catch(() => global);
      const result = await this._executeBuy(wallet, mint, fg, feeConfig, buyAmount);
      if (result.ok) {
        wallet.solSpent += buyAmount;
        wallet.trades.push({ side: "buy", sol: buyAmount, sig: result.sig, time: Date.now() });
        session.tradeCount++; session.totalSolSpent += buyAmount;
        this.emit("trade", { ca, role: "sniper", side: "buy", sol: buyAmount, sig: result.sig });
        console.log(`[FLEET] [sniper] BUY ${buyAmount.toFixed(4)} SOL -> ${result.sig?.slice(0, 12)}...`);
      } else return;
    } catch (e) { console.error(`[FLEET] [sniper] Buy error:`, e.message); return; }

    // HOLD 15-45s — let other buyers create liquidity to sell into
    const holdTime = 15000 + Math.random() * 30000;
    console.log(`[FLEET] [sniper] Holding ${(holdTime / 1000).toFixed(0)}s before exit...`);
    await sleep(holdTime);
    if (!session.running) return;

    // SELL 100% — take profit
    try {
      const result = await this._executeSell(wallet, mint, global, feeConfig, 0.99);
      if (result.ok) {
        wallet.solRecovered += result.solOut || 0;
        wallet.trades.push({ side: "sell", solOut: result.solOut, sig: result.sig, time: Date.now() });
        session.tradeCount++; session.totalSolRecovered += result.solOut || 0;
        this.emit("trade", { ca, role: "sniper", side: "sell", sol: result.solOut, sig: result.sig });
        const pnl = (result.solOut || 0) - buyAmount;
        console.log(`[FLEET] [sniper] SOLD -> ${(result.solOut || 0).toFixed(4)} SOL (${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)})`);
      }
    } catch (e) { console.error(`[FLEET] [sniper] Sell error:`, e.message); }

    console.log(`[FLEET] [sniper] ${wallet.pubkey.slice(0, 8)} done`);
  }

  // ── Execute buy ──
  async _executeBuy(wallet, mint, global, feeConfig, solAmount) {
    const { keypair } = wallet;
    const buyState = await this.onlineSdk.fetchBuyState(mint, keypair.publicKey);
    const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } = buyState;
    const mintSupply = bondingCurve.tokenTotalSupply || global.tokenTotalSupply;

    const solBN = new BN(Math.floor(solAmount * 1e9));
    const tokenAmount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply, bondingCurve, amount: solBN });
    if (tokenAmount.isZero()) return { ok: false, error: "Zero tokens" };

    const instructions = await this.sdk.buyInstructions({
      global, bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo,
      mint, user: keypair.publicKey, amount: tokenAmount, solAmount: solBN, slippage: 25,
    });

    const tx = new Transaction();
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }),
      ...instructions,
    );

    const sig = await sendAndConfirmTransaction(this.connection, tx, [keypair], { skipPreflight: true, commitment: "confirmed", maxRetries: 3 });
    return { ok: true, sig, tokens: tokenAmount.toString() };
  }

  // ── Execute sell ──
  async _executeSell(wallet, mint, global, feeConfig, sellPercent) {
    const { keypair } = wallet;
    let tokenBalance;
    try {
      const ata = getAssociatedTokenAddressSync(mint, keypair.publicKey, true);
      const account = await getAccount(this.connection, ata);
      tokenBalance = new BN(account.amount.toString());
    } catch { return { ok: false, error: "No token account" }; }

    if (tokenBalance.isZero()) return { ok: false, error: "Zero balance" };

    const sellAmount = tokenBalance.muln(Math.floor(sellPercent * 1000)).divn(1000);
    if (sellAmount.isZero()) return { ok: false, error: "Too small" };

    const sellState = await this.onlineSdk.fetchSellState(mint, keypair.publicKey);
    const { bondingCurveAccountInfo, bondingCurve } = sellState;
    const mintSupply = bondingCurve.tokenTotalSupply || global.tokenTotalSupply;

    const solOut = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply, bondingCurve, amount: sellAmount });

    const instructions = await this.sdk.sellInstructions({
      global, bondingCurveAccountInfo, bondingCurve,
      mint, user: keypair.publicKey, amount: sellAmount, solAmount: solOut, slippage: 50,
    });

    const tx = new Transaction();
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }),
      ...instructions,
    );

    const sig = await sendAndConfirmTransaction(this.connection, tx, [keypair], { skipPreflight: true, commitment: "confirmed", maxRetries: 3 });
    return { ok: true, sig, solOut: parseFloat(solOut.toString()) / 1e9, tokens: sellAmount.toString() };
  }

  // ── Close: sell everything + sweep SOL back ──
  async close(ca) {
    const session = this.sessions.get(ca);
    if (!session) throw new Error(`No session for ${ca}`);

    session.running = false;
    session.phase = "closing";
    console.log(`[FLEET] Closing ${ca.slice(0, 8)}... — ${session.fleetWallets.length} wallets`);
    this.emit("phase", { ca, phase: "closing" });

    await sleep(3000);

    let global, feeConfig;
    try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); } catch {}

    // Sell all tokens on every wallet
    for (const wallet of session.fleetWallets) {
      try {
        let tokenBalance;
        try {
          const ata = getAssociatedTokenAddressSync(session.mint, wallet.keypair.publicKey, true);
          const account = await getAccount(this.connection, ata);
          tokenBalance = new BN(account.amount.toString());
        } catch { tokenBalance = new BN(0); }

        if (!tokenBalance.isZero() && global && feeConfig) {
          console.log(`[FLEET] [${wallet.role}] Selling all tokens...`);
          const result = await this._executeSell(wallet, session.mint, global, feeConfig, 1.0);
          if (result.ok) {
            wallet.solRecovered += result.solOut || 0;
            session.totalSolRecovered += result.solOut || 0;
            console.log(`[FLEET] [${wallet.role}] Sold -> ${(result.solOut || 0).toFixed(4)} SOL`);
          }
        }
      } catch (e) { console.error(`[FLEET] [${wallet.role}] Close sell failed:`, e.message); }
      await sleep(500);
    }

    // Sweep SOL from fleet wallets back to master
    for (const wallet of session.fleetWallets) {
      if (wallet.keypair.publicKey.equals(session.masterKp.publicKey)) continue;
      try {
        const balance = await this.connection.getBalance(wallet.keypair.publicKey);
        const sweepAmount = balance - 5000;
        if (sweepAmount <= 0) continue;

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
          SystemProgram.transfer({ fromPubkey: wallet.keypair.publicKey, toPubkey: session.masterKp.publicKey, lamports: sweepAmount })
        );
        await sendAndConfirmTransaction(this.connection, tx, [wallet.keypair], { skipPreflight: true, commitment: "confirmed" });
        console.log(`[FLEET] [${wallet.role}] Swept ${(sweepAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL back`);
      } catch (e) { console.error(`[FLEET] [${wallet.role}] Sweep failed:`, e.message); }
      await sleep(300);
    }

    let masterBalance = 0;
    try { masterBalance = await this.connection.getBalance(session.masterKp.publicKey) / LAMPORTS_PER_SOL; } catch {}

    const netProfit = session.totalSolRecovered - session.totalSolSpent;
    session.phase = "closed";
    this.sessions.delete(ca);

    console.log(`[FLEET] Closed ${ca.slice(0, 8)} | Spent: ${session.totalSolSpent.toFixed(4)} | Recovered: ${session.totalSolRecovered.toFixed(4)} | Net: ${netProfit.toFixed(4)}`);

    return {
      trades: session.tradeCount, wallets: session.fleetWallets.length,
      solSpent: session.totalSolSpent, solRecovered: session.totalSolRecovered,
      netProfit, totalIn: session.totalSol, totalReturn: session.totalSolRecovered, masterBalance,
    };
  }

  async closeAll() {
    const results = {};
    let totalNetProfit = 0;
    for (const ca of [...this.sessions.keys()]) {
      try { results[ca] = await this.close(ca); totalNetProfit += results[ca].netProfit || 0; }
      catch (e) { results[ca] = { error: e.message }; }
    }
    return { results, totalNetProfit };
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
        walletDetails: s.fleetWallets.map(w => ({
          role: w.role, pubkey: w.pubkey.slice(0, 8), allocation: w.allocation,
          spent: w.solSpent, recovered: w.solRecovered, trades: w.trades.length,
        })),
      };
    }
    return { sessions, activeSessions: this.sessions.size };
  }

  getSessionStatus(ca) {
    const s = ca ? this.sessions.get(ca) : this.sessions.values().next().value;
    if (!s) return null;
    return {
      phase: s.phase, running: s.running, tradeCount: s.tradeCount,
      solSpent: s.totalSolSpent, solRecovered: s.totalSolRecovered,
      activeWallets: s.fleetWallets.filter(w => w.funded).length, ca: s.ca,
    };
  }
}

export default FleetTrader;
