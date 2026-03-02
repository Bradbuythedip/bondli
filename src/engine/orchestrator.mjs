// BONDLI v3.0 — Orchestrator (main multi-CA phase engine)
import { Connection, Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import CONFIG, { PHASES, WALLET_ROLES } from "./config.mjs";
import { TradeRouter } from "./trade-router.mjs";
import { GameTheory } from "./game-theory.mjs";
import { SignalDetector } from "./signal-detector.mjs";
import { WalletOptimizer } from "./wallet-optimizer.mjs";
import { WalletSaver } from "./wallet-saver.mjs";
import { RugScanner } from "./rug-scanner.mjs";
import { calculateFee } from "./fee-engine.mjs";
import { humanDelay, organicSequence, sleep } from "./anti-detection.mjs";

export class Orchestrator {
  constructor(opts = {}) {
    this.connection = new Connection(CONFIG.RPC_URL, "confirmed");
    this.router = new TradeRouter();
    this.gameTheory = new GameTheory();
    this.signals = new SignalDetector();
    this.walletOpt = new WalletOptimizer();
    this.saver = new WalletSaver();
    this.scanner = new RugScanner();
    this.dryRun = opts.dryRun ?? CONFIG.DRY_RUN;
    this.running = false;
    this.sessions = new Map(); // CA -> session
    this.listeners = []; // WebSocket broadcast
    this.purgePercent = CONFIG.PURGE_PERCENT;
  }

  // Broadcast event to all listeners
  emit(event, data) {
    const msg = JSON.stringify({ event, data, ts: Date.now() });
    for (const fn of this.listeners) {
      try { fn(msg); } catch {}
    }
  }

  onEvent(fn) { this.listeners.push(fn); }

  // Launch a session for a token CA
  async launch(ca, opts = {}) {
    if (this.sessions.has(ca)) throw new Error(`Session already running for ${ca}`);

    const totalSol = opts.totalSol || CONFIG.TOTAL_SOL;
    this.emit("launch:start", { ca, totalSol, dryRun: this.dryRun });

    // 1. Rug scan
    this.emit("phase", { ca, phase: "SCAN" });
    const scan = await this.scanner.scan(ca);
    if (!scan.safe && !opts.force) {
      this.emit("launch:blocked", { ca, scan });
      throw new Error(`Rug scan failed (score: ${scan.score}): ${scan.flags.join(", ")}`);
    }

    // 2. Generate wallet fleet
    this.emit("phase", { ca, phase: "WALLETS" });
    this.walletOpt.initMaster();
    const wallets = this.walletOpt.generateFleet(totalSol);
    this.saver.save(wallets, ca.slice(0, 8));

    // 3. Fund wallets from master
    if (!this.dryRun) {
      await this._fundWallets(wallets);
    }

    // 4. Create session
    const session = {
      ca,
      totalSol,
      wallets,
      startTime: Date.now(),
      phase: "DEPLOY",
      trades: [],
      pnl: 0,
      running: true,
    };
    this.sessions.set(ca, session);

    // 5. Run phase loop
    this._runPhaseLoop(session).catch(e => {
      console.error(`[ORCH] Session ${ca.slice(0,8)} error:`, e.message);
      session.running = false;
    });

    return { ca, wallets: this.walletOpt.summary(), scan };
  }

  async _fundWallets(wallets) {
    const master = this.walletOpt.masterKeypair;
    for (const w of wallets) {
      const lamports = Math.floor(w.allocation * LAMPORTS_PER_SOL);
      if (lamports <= 0) continue;
      try {
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: master.publicKey,
            toPubkey: w.keypair.publicKey,
            lamports,
          })
        );
        const { blockhash } = await this.connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = master.publicKey;
        tx.sign(master);
        await this.connection.sendRawTransaction(tx.serialize());
        w.funded = true;
        this.emit("wallet:funded", { pubkey: w.pubkey, sol: w.allocation });
      } catch (e) {
        console.error(`[ORCH] Fund failed for wallet ${w.index}:`, e.message);
      }
      await sleep(200);
    }
  }

  async _runPhaseLoop(session) {
    const { ca, wallets } = session;
    const phases = ["SNIPE", "ACCUMULATE", "MOMENTUM", "SWING", "WHALE", "LIQUIDATE", "PURGE"];

    for (const phaseName of phases) {
      if (!session.running) break;
      session.phase = phaseName;
      this.emit("phase", { ca, phase: phaseName });

      const phaseWallets = this._getPhaseWallets(wallets, phaseName);
      const phaseTiming = PHASES[phaseName];

      for (const wallet of phaseWallets) {
        if (!session.running) break;

        try {
          const action = this._getWalletAction(wallet, phaseName, session);
          if (!action) continue;

          const delay = humanDelay(
            (phaseTiming.min + (phaseTiming.max || phaseTiming.min)) / 2
          );
          await sleep(Math.min(delay, 5000)); // cap for responsiveness

          let result;
          if (action.side === "buy") {
            result = await this.router.buy(wallet.keypair, ca, action.amount);
          } else {
            result = await this.router.sell(wallet.keypair, ca, action.amount);
          }

          wallet.trades.push({ ...result, phase: phaseName, timestamp: Date.now() });
          session.trades.push({ wallet: wallet.index, ...result });
          this.emit("trade", { ca, wallet: wallet.index, role: wallet.role, ...result });

        } catch (e) {
          this.emit("trade:error", { ca, wallet: wallet.index, error: e.message });
        }
      }
    }

    session.phase = "COMPLETE";
    this.emit("phase", { ca, phase: "COMPLETE" });
  }

  _getPhaseWallets(wallets, phase) {
    const roleMap = {
      SNIPE:      ["sniper"],
      ACCUMULATE: ["accumulator", "sniper"],
      MOMENTUM:   ["momentum", "accumulator"],
      SWING:      ["swing", "momentum"],
      WHALE:      ["whale"],
      LIQUIDATE:  ["liquidator", "swing"],
      PURGE:      ["recycler", "liquidator"],
    };
    const roles = roleMap[phase] || [];
    return wallets.filter(w => roles.includes(w.role));
  }

  _getWalletAction(wallet, phase, session) {
    const role = wallet.role;
    const alloc = wallet.allocation;

    switch (phase) {
      case "SNIPE":
        return { side: "buy", amount: alloc * 0.8 };
      case "ACCUMULATE":
        return role === "accumulator"
          ? { side: "buy", amount: alloc * 0.3 }
          : null;
      case "MOMENTUM":
        return { side: "buy", amount: alloc * 0.5 };
      case "SWING": {
        const rec = this.gameTheory.recommend(session.ca);
        return rec.action === "sell"
          ? { side: "sell", amount: Math.floor(alloc * 0.4 * 1e9) }
          : { side: "buy", amount: alloc * 0.3 };
      }
      case "WHALE":
        return { side: "buy", amount: alloc * 0.7 };
      case "LIQUIDATE":
        return { side: "sell", amount: Math.floor(alloc * 0.6 * 1e9) };
      case "PURGE": {
        // Anti-sniper purge: sell a percentage
        const purgeAmt = Math.floor(alloc * (this.purgePercent / 100) * 1e9);
        return purgeAmt > 0 ? { side: "sell", amount: purgeAmt } : null;
      }
      default:
        return null;
    }
  }

  // Close a session (sell all positions)
  async close(ca) {
    const session = this.sessions.get(ca);
    if (!session) throw new Error(`No session for ${ca}`);
    session.running = false;
    session.phase = "EXIT";
    this.emit("phase", { ca, phase: "EXIT" });

    const results = [];
    for (const wallet of session.wallets) {
      try {
        // Get token balance and sell all
        // Simplified - actual impl would check ATA balance
        const sellResult = await this.router.sell(wallet.keypair, ca, 0); // 0 = sell all
        results.push({ wallet: wallet.index, ...sellResult });
        this.emit("trade", { ca, wallet: wallet.index, role: wallet.role, type: "exit", ...sellResult });
      } catch (e) {
        results.push({ wallet: wallet.index, error: e.message });
      }
    }

    // Calculate fees
    const totalIn = session.totalSol;
    const totalReturn = results.reduce((s, r) => s + (r.solOut || 0), 0);
    const feeResult = calculateFee(totalIn, totalReturn, CONFIG.PLATFORM_WALLET);

    session.phase = "SETTLED";
    this.emit("session:closed", { ca, results, fee: feeResult, totalReturn });
    this.sessions.delete(ca);

    return { results, fee: feeResult, totalIn, totalReturn };
  }

  // Close all sessions
  async closeAll() {
    const results = {};
    for (const ca of this.sessions.keys()) {
      results[ca] = await this.close(ca);
    }
    return results;
  }

  // Get status
  status() {
    const sessions = {};
    for (const [ca, s] of this.sessions) {
      sessions[ca] = {
        phase: s.phase,
        running: s.running,
        trades: s.trades.length,
        elapsed: Date.now() - s.startTime,
        wallets: s.wallets.length,
      };
    }
    return { sessions, dryRun: this.dryRun };
  }
}

// CLI mode
if (process.argv[1]?.includes("orchestrator")) {
  const ca = process.argv[2] || CONFIG.TOKEN_CA;
  if (!ca) {
    console.error("Usage: node orchestrator.mjs <TOKEN_CA>");
    console.error("  or set TOKEN_CA in .env");
    process.exit(1);
  }
  console.log(`\n=== BONDLI v3.0 ENGINE ===`);
  console.log(`Mode: ${CONFIG.DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Token: ${ca}`);
  console.log(`Budget: ${CONFIG.TOTAL_SOL} SOL\n`);

  const orch = new Orchestrator();
  orch.onEvent(msg => console.log(msg));
  orch.launch(ca).then(r => {
    console.log("\nLaunched:", JSON.stringify(r, null, 2));
  }).catch(e => {
    console.error("Launch failed:", e.message);
    process.exit(1);
  });
}

export default Orchestrator;
