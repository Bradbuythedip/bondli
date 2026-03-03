// BONDLI — Fleet Trader (real buy/sell via pump.fun SDK)
// Executes actual on-chain trades from the dev wallet after token creation
import {
  Connection, Keypair, PublicKey, Transaction,
  ComputeBudgetProgram, sendAndConfirmTransaction,
  LAMPORTS_PER_SOL, SystemProgram,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PumpSdk, OnlinePumpSdk, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount, bondingCurvePda } from "@pump-fun/pump-sdk";
import BN from "bn.js";
import bs58 from "bs58";
import CONFIG from "./config.mjs";

// ═══════════════════════════════════════
// FLEET TRADER — runs post-launch trading loop
// ═══════════════════════════════════════
export class FleetTrader {
  constructor(connection) {
    this.connection = connection || new Connection(CONFIG.RPC_URL, "confirmed");
    this.sdk = new PumpSdk(this.connection);
    this.onlineSdk = new OnlinePumpSdk(this.connection);
    this.sessions = new Map(); // CA -> session
    this.listeners = [];
  }

  emit(event, data) {
    const msg = JSON.stringify({ event, data, ts: Date.now() });
    for (const fn of this.listeners) {
      try { fn(msg); } catch {}
    }
  }

  onEvent(fn) { this.listeners.push(fn); }

  // ── Start trading on a CA with budget ──
  async launch(ca, opts = {}) {
    const {
      totalSol = 0.5,
      devKeypair,        // Keypair object — has the SOL
      sessionId,
      force = false,
    } = opts;

    if (this.sessions.has(ca)) {
      console.warn(`[FLEET] Session already exists for ${ca}`);
      return { ok: true, existing: true };
    }

    const mint = new PublicKey(ca);

    // Resolve keypair
    let trader;
    if (devKeypair instanceof Keypair) {
      trader = devKeypair;
    } else if (devKeypair?.secretKey) {
      trader = Keypair.fromSecretKey(
        typeof devKeypair.secretKey === "string"
          ? bs58.decode(devKeypair.secretKey)
          : devKeypair.secretKey
      );
    } else {
      console.error("[FLEET] No valid keypair provided");
      return { ok: false, error: "No keypair" };
    }

    console.log(`[FLEET] Starting on ${ca.slice(0, 8)}... | Budget: ${totalSol} SOL | Wallet: ${trader.publicKey.toBase58().slice(0, 8)}...`);

    const session = {
      ca,
      mint,
      trader,
      totalSol,
      sessionId,
      startTime: Date.now(),
      phase: "starting",
      trades: [],
      solSpent: 0,
      solRecovered: 0,
      tokenBalance: 0,
      running: true,
      tradeCount: 0,
    };
    this.sessions.set(ca, session);

    // Start the trading loop in background
    this._runTradingLoop(session).catch(e => {
      console.error(`[FLEET] Loop error on ${ca.slice(0, 8)}:`, e.message);
      session.running = false;
      session.phase = "error";
      session.error = e.message;
    });

    return { ok: true, ca, phase: "starting" };
  }

  // ── Main trading loop ──
  async _runTradingLoop(session) {
    const { ca, mint, trader, totalSol } = session;

    // Wait a few seconds for the token creation tx to confirm
    await sleep(5000);

    // Fetch global + fee config once
    let global, feeConfig;
    try {
      global = await this.onlineSdk.fetchGlobal();
      feeConfig = await this.onlineSdk.fetchFeeConfig();
    } catch (e) {
      console.error("[FLEET] Failed to fetch global/feeConfig:", e.message);
      session.phase = "error";
      return;
    }

    // ── Phase 1: SNIPE — quick buys to fill the chart ──
    session.phase = "sniping";
    this.emit("phase", { ca, phase: "sniping" });
    console.log(`[FLEET] Phase 1: SNIPING — ${totalSol.toFixed(3)} SOL budget`);

    const snipeBudget = totalSol * 0.6; // 60% for initial buys
    const snipeTrades = 3 + Math.floor(Math.random() * 3); // 3-5 buys
    const perTrade = snipeBudget / snipeTrades;

    for (let i = 0; i < snipeTrades && session.running; i++) {
      // Jitter the amount ±30%
      const jitter = 0.7 + Math.random() * 0.6;
      const buyAmount = Math.max(0.01, perTrade * jitter);

      if (session.solSpent + buyAmount > totalSol * 0.85) break; // leave reserve

      try {
        const result = await this._executeBuy(session, global, feeConfig, buyAmount);
        if (result.ok) {
          session.trades.push({ ...result, phase: "snipe", time: Date.now() });
          session.solSpent += buyAmount;
          session.tradeCount++;
          this.emit("trade", { ca, side: "buy", sol: buyAmount, ...result });
          console.log(`[FLEET] SNIPE BUY #${i + 1}: ${buyAmount.toFixed(4)} SOL → tx: ${result.sig?.slice(0, 12)}...`);
        }
      } catch (e) {
        console.error(`[FLEET] Snipe buy ${i + 1} failed:`, e.message);
      }

      // Human-like delay: 3-8 seconds between trades
      await sleep(3000 + Math.random() * 5000);
    }

    // ── Phase 2: MOMENTUM — buy/sell oscillation for chart activity ──
    session.phase = "momentum";
    this.emit("phase", { ca, phase: "momentum" });
    console.log(`[FLEET] Phase 2: MOMENTUM — oscillating buys/sells`);

    const momentumBudget = totalSol * 0.3; // 30% for momentum
    const momentumRounds = 4 + Math.floor(Math.random() * 4); // 4-7 rounds
    let momentumSpent = 0;

    for (let i = 0; i < momentumRounds && session.running; i++) {
      // Alternate: mostly buys with occasional sells
      const isBuy = Math.random() > 0.35; // 65% chance buy
      const amount = Math.max(0.005, (momentumBudget / momentumRounds) * (0.5 + Math.random()));

      if (isBuy && momentumSpent + amount > momentumBudget) break;

      try {
        if (isBuy) {
          const result = await this._executeBuy(session, global, feeConfig, amount);
          if (result.ok) {
            session.trades.push({ ...result, phase: "momentum", time: Date.now() });
            session.solSpent += amount;
            momentumSpent += amount;
            session.tradeCount++;
            this.emit("trade", { ca, side: "buy", sol: amount, ...result });
            console.log(`[FLEET] MOMENTUM BUY: ${amount.toFixed(4)} SOL`);
          }
        } else {
          // Sell 10-30% of token balance
          const sellPct = 0.1 + Math.random() * 0.2;
          const result = await this._executeSell(session, global, feeConfig, sellPct);
          if (result.ok) {
            session.trades.push({ ...result, phase: "momentum", time: Date.now() });
            session.solRecovered += result.solOut || 0;
            session.tradeCount++;
            this.emit("trade", { ca, side: "sell", ...result });
            console.log(`[FLEET] MOMENTUM SELL: ${(sellPct * 100).toFixed(0)}% → ${(result.solOut || 0).toFixed(4)} SOL back`);
          }
        }
      } catch (e) {
        console.error(`[FLEET] Momentum trade ${i + 1} failed:`, e.message);
      }

      // Longer delays for organic feel: 8-20 seconds
      await sleep(8000 + Math.random() * 12000);
    }

    // ── Phase 3: HOLD — keep position, monitor ──
    session.phase = "holding";
    this.emit("phase", { ca, phase: "holding" });
    console.log(`[FLEET] Phase 3: HOLDING — ${session.tradeCount} trades done, ${session.solSpent.toFixed(4)} SOL spent`);

    // Periodic small trades to keep chart alive
    while (session.running) {
      await sleep(30000 + Math.random() * 60000); // 30-90s between maintenance trades
      if (!session.running) break;

      const remaining = totalSol - session.solSpent;
      if (remaining < 0.005) break;

      // Small maintenance buy or sell
      const isBuy = Math.random() > 0.4;
      const amount = Math.max(0.003, remaining * 0.05 * Math.random());

      try {
        if (isBuy && remaining > amount) {
          const result = await this._executeBuy(session, global, feeConfig, amount);
          if (result.ok) {
            session.solSpent += amount;
            session.tradeCount++;
            session.trades.push({ ...result, phase: "hold", time: Date.now() });
            this.emit("trade", { ca, side: "buy", sol: amount, ...result });
          }
        } else {
          const result = await this._executeSell(session, global, feeConfig, 0.05 + Math.random() * 0.1);
          if (result.ok) {
            session.solRecovered += result.solOut || 0;
            session.tradeCount++;
            session.trades.push({ ...result, phase: "hold", time: Date.now() });
            this.emit("trade", { ca, side: "sell", ...result });
          }
        }
      } catch (e) {
        // Holding trades can fail silently
      }
    }

    session.phase = "complete";
    this.emit("phase", { ca, phase: "complete" });
    console.log(`[FLEET] Session complete on ${ca.slice(0, 8)} | Trades: ${session.tradeCount} | Spent: ${session.solSpent.toFixed(4)} | Recovered: ${session.solRecovered.toFixed(4)}`);
  }

  // ── Execute a buy via pump.fun SDK ──
  async _executeBuy(session, global, feeConfig, solAmount) {
    const { mint, trader } = session;

    // Fetch current bonding curve state
    const buyState = await this.onlineSdk.fetchBuyState(mint, trader.publicKey);
    const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } = buyState;

    // Decode mint supply from token account or use bonding curve data
    const mintSupply = bondingCurve.tokenTotalSupply || global.tokenTotalSupply;

    // Calculate expected tokens
    const solBN = new BN(Math.floor(solAmount * 1e9));
    const tokenAmount = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply,
      bondingCurve,
      amount: solBN,
    });

    if (tokenAmount.isZero()) {
      return { ok: false, error: "Zero tokens out" };
    }

    // Build buy instructions
    const instructions = await this.sdk.buyInstructions({
      global,
      bondingCurveAccountInfo,
      bondingCurve,
      associatedUserAccountInfo,
      mint,
      user: trader.publicKey,
      amount: tokenAmount,
      solAmount: solBN,
      slippage: 25, // 25% slippage for safety on small cap
    });

    // Build tx with compute budget
    const tx = new Transaction();
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }),
      ...instructions,
    );

    const sig = await sendAndConfirmTransaction(
      this.connection, tx, [trader],
      { skipPreflight: true, commitment: "confirmed", maxRetries: 3 }
    );

    return { ok: true, side: "buy", sol: solAmount, tokens: tokenAmount.toString(), sig };
  }

  // ── Execute a sell via pump.fun SDK ──
  async _executeSell(session, global, feeConfig, sellPercent) {
    const { mint, trader } = session;

    // Get current token balance
    let tokenBalance;
    try {
      const ata = getAssociatedTokenAddressSync(mint, trader.publicKey, true);
      const account = await getAccount(this.connection, ata);
      tokenBalance = new BN(account.amount.toString());
    } catch {
      return { ok: false, error: "No token account" };
    }

    if (tokenBalance.isZero()) {
      return { ok: false, error: "Zero balance" };
    }

    // Sell a percentage
    const sellAmount = tokenBalance.muln(Math.floor(sellPercent * 1000)).divn(1000);
    if (sellAmount.isZero()) {
      return { ok: false, error: "Sell amount too small" };
    }

    // Fetch sell state
    const sellState = await this.onlineSdk.fetchSellState(mint, trader.publicKey);
    const { bondingCurveAccountInfo, bondingCurve } = sellState;

    const mintSupply = bondingCurve.tokenTotalSupply || global.tokenTotalSupply;

    // Estimate SOL out
    const solOut = getSellSolAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply,
      bondingCurve,
      amount: sellAmount,
    });

    // Build sell instructions
    const instructions = await this.sdk.sellInstructions({
      global,
      bondingCurveAccountInfo,
      bondingCurve,
      mint,
      user: trader.publicKey,
      amount: sellAmount,
      solAmount: solOut,
      slippage: 25,
    });

    const tx = new Transaction();
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }),
      ...instructions,
    );

    const sig = await sendAndConfirmTransaction(
      this.connection, tx, [trader],
      { skipPreflight: true, commitment: "confirmed", maxRetries: 3 }
    );

    const solOutNum = parseFloat(solOut.toString()) / 1e9;
    return { ok: true, side: "sell", tokens: sellAmount.toString(), solOut: solOutNum, sig };
  }

  // ── Stop trading on a CA ──
  stop(ca) {
    const session = this.sessions.get(ca);
    if (session) {
      session.running = false;
      console.log(`[FLEET] Stopping ${ca.slice(0, 8)}...`);
    }
  }

  // ── Close a session (stop + return stats) ──
  async close(ca) {
    const session = this.sessions.get(ca);
    if (!session) throw new Error(`No session for ${ca}`);
    session.running = false;
    session.phase = "closing";
    // Wait for loop to exit
    await sleep(2000);
    const netProfit = session.solRecovered - session.solSpent;
    session.phase = "closed";
    this.sessions.delete(ca);
    return {
      trades: session.tradeCount,
      solSpent: session.solSpent,
      solRecovered: session.solRecovered,
      netProfit,
      totalIn: session.totalSol,
      totalReturn: session.solRecovered,
    };
  }

  // ── Close all sessions ──
  async closeAll() {
    const results = {};
    for (const ca of [...this.sessions.keys()]) {
      try {
        results[ca] = await this.close(ca);
      } catch (e) {
        results[ca] = { error: e.message };
      }
    }
    return results;
  }

  // ── Get status ──
  status() {
    const sessions = {};
    for (const [ca, s] of this.sessions) {
      sessions[ca] = {
        phase: s.phase,
        running: s.running,
        tradeCount: s.tradeCount,
        solSpent: s.solSpent,
        solRecovered: s.solRecovered,
        elapsed: Date.now() - s.startTime,
        activeWallets: 1, // single wallet for now
      };
    }
    return { sessions, activeSessions: this.sessions.size };
  }

  // ── Status for specific CA (or first session) ──
  getSessionStatus(ca) {
    if (ca) return this.sessions.get(ca);
    // Return first active session
    for (const [, s] of this.sessions) return s;
    return null;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default FleetTrader;
