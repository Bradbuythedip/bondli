// BONDLI — Fleet Trader v4 (Organic + Reactive Game Theory)
// Wallets buy independently → GameState monitors opponent behavior → fleet adapts sell timing
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
import WebSocket from "ws";

// ═══════════════════════════════════════
// GAME STATE — Real-time opponent modeling via PumpPortal WS
// Observes every trade on our token and maintains a Bayesian model
// of market conditions to inform sell/hold decisions
// ═══════════════════════════════════════
class GameState {
  constructor(ca, ourWallets = new Set()) {
    this.ca = ca;
    this.ourWallets = ourWallets; // our fleet wallet pubkeys (to exclude from opponent analysis)
    this.trades = [];             // last 100 trades: { time, type, sol, wallet, isOurs }
    this.opponents = new Map();   // wallet -> { buys, sells, totalSol, firstSeen, lastSeen, avgSize }

    // ── Signals (updated per trade) ──
    this.buyPressure = 0.5;       // 0-1: ratio of buys in last 30s
    this.momentum = 0;            // positive = pumping, negative = dumping
    this.whaleAlert = false;      // large buy detected in last 15s
    this.devSelling = false;      // creator is selling
    this.dumpCascade = false;     // 3+ sells in 10s from different wallets
    this.bondingPct = 0;          // bonding curve progress
    this.mcapSol = 0;
    this.volumeRate = 0;          // SOL per minute (rolling 60s)
    this.uniqueBuyers = 0;        // distinct buy wallets in last 2min
    this.signal = "HOLD";         // HOLD, SELL_NOW, ACCUMULATE, RIDE

    // ── Strategy parameters ──
    this.sellMultiplier = 1.0;    // <1 = delay sells, >1 = accelerate sells
    this.holdExtension = 0;       // seconds to extend hold phase

    // WS connection
    this.ws = null;
    this.alive = false;
    this.devWallet = null;        // set after first create event or from session
  }

  // Start monitoring via PumpPortal WS
  connect() {
    try {
      this.ws = new WebSocket("wss://pumpportal.fun/api/data");
    } catch (e) {
      console.error(`[GAME] WS connect failed: ${e.message}`);
      return;
    }

    this.ws.on("open", () => {
      this.alive = true;
      this.ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [this.ca] }));
      console.log(`[GAME] Monitoring ${this.ca.slice(0, 8)}... for opponent trades`);
    });

    this.ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if ((msg.txType === "buy" || msg.txType === "sell") && msg.mint === this.ca) {
          this._processTrade(msg);
        }
      } catch {}
    });

    this.ws.on("close", () => {
      this.alive = false;
      // Reconnect if still needed
      setTimeout(() => { if (!this._stopped) this.connect(); }, 3000);
    });

    this.ws.on("error", () => { this.alive = false; });
  }

  stop() {
    this._stopped = true;
    if (this.ws) try { this.ws.close(); } catch {}
  }

  _processTrade(msg) {
    const now = Date.now();
    const wallet = msg.traderPublicKey || "";
    const isOurs = this.ourWallets.has(wallet);
    const sol = Math.abs(msg.solAmount || 0);
    const type = msg.txType; // "buy" or "sell"

    // Record trade
    this.trades.push({ time: now, type, sol, wallet, isOurs });
    if (this.trades.length > 200) this.trades = this.trades.slice(-200);

    // Update opponent profile (skip our own wallets)
    if (!isOurs && wallet) {
      if (!this.opponents.has(wallet)) {
        this.opponents.set(wallet, { buys: 0, sells: 0, totalSol: 0, firstSeen: now, lastSeen: now, avgSize: 0, tradeCount: 0 });
      }
      const opp = this.opponents.get(wallet);
      if (type === "buy") opp.buys++;
      else opp.sells++;
      opp.totalSol += sol;
      opp.tradeCount++;
      opp.avgSize = opp.totalSol / opp.tradeCount;
      opp.lastSeen = now;
    }

    // Update bonding curve
    if (msg.vSolInBondingCurve) {
      this.bondingPct = Math.max(0, Math.min(100, ((msg.vSolInBondingCurve - 30) / 55) * 100));
    }
    if (msg.marketCapSol) this.mcapSol = msg.marketCapSol;

    // ── Compute signals ──
    this._computeSignals(now);
  }

  _computeSignals(now) {
    const window30s = this.trades.filter(t => now - t.time < 30000 && !t.isOurs);
    const window60s = this.trades.filter(t => now - t.time < 60000 && !t.isOurs);
    const window10s = this.trades.filter(t => now - t.time < 10000 && !t.isOurs);

    // Buy pressure: ratio of buys in last 30s
    const buys30 = window30s.filter(t => t.type === "buy").length;
    const sells30 = window30s.filter(t => t.type === "sell").length;
    this.buyPressure = (buys30 + sells30) > 0 ? buys30 / (buys30 + sells30) : 0.5;

    // Momentum: net SOL flow in last 30s (buys positive, sells negative)
    const buyVol = window30s.filter(t => t.type === "buy").reduce((s, t) => s + t.sol, 0);
    const sellVol = window30s.filter(t => t.type === "sell").reduce((s, t) => s + t.sol, 0);
    this.momentum = buyVol - sellVol;

    // Volume rate: SOL per minute
    const vol60 = window60s.reduce((s, t) => s + t.sol, 0);
    this.volumeRate = vol60; // already per 60s

    // Unique buyers in last 2 min
    const window2m = this.trades.filter(t => now - t.time < 120000 && !t.isOurs && t.type === "buy");
    this.uniqueBuyers = new Set(window2m.map(t => t.wallet)).size;

    // Whale alert: any single buy > 0.5 SOL in last 15s
    this.whaleAlert = window30s.some(t => t.type === "buy" && t.sol > 0.5 && now - t.time < 15000);

    // Dev selling: check if creator/dev wallet is selling
    if (this.devWallet) {
      this.devSelling = window60s.some(t => t.type === "sell" && t.wallet.startsWith(this.devWallet));
    }

    // Dump cascade: 3+ sells from different wallets in 10s
    const sells10 = window10s.filter(t => t.type === "sell");
    const uniqueSellers10 = new Set(sells10.map(t => t.wallet)).size;
    this.dumpCascade = uniqueSellers10 >= 3;

    // ── Derive strategic signal using Nash equilibrium logic ──
    // Nash insight: each player's optimal strategy depends on what others are doing
    // If others are buying → holding is dominant strategy (free ride the pump)
    // If others are selling → selling first is dominant (first-mover advantage in dumps)
    // If whale enters → everyone holds hoping for more pump (coordination game)
    // If dev sells → everyone should sell (trust collapse, prisoner's dilemma)

    let signal = "HOLD";
    let sellMult = 1.0;
    let holdExt = 0;

    // ── SELL_NOW triggers (high priority) ──
    if (this.devSelling) {
      // Dev selling = trust collapse. In Nash equilibrium, everyone should defect.
      // First to sell gets the best price. This is a strict dominant strategy.
      signal = "SELL_NOW";
      sellMult = 3.0; // sell 3x faster
      console.log(`[GAME] 🚨 DEV SELLING — triggering immediate exit`);
    } else if (this.dumpCascade) {
      // Multiple sellers in short window = cascade starting.
      // Nash: if you believe others will sell, your best response is to sell first.
      signal = "SELL_NOW";
      sellMult = 2.5;
      console.log(`[GAME] 🚨 DUMP CASCADE — ${uniqueSellers10} sellers in 10s`);
    } else if (this.buyPressure < 0.25 && sells30 >= 5) {
      // Heavy sell pressure — market is exiting
      signal = "SELL_NOW";
      sellMult = 2.0;
      console.log(`[GAME] ⚠️ Heavy sell pressure: ${(this.buyPressure * 100).toFixed(0)}% buys`);
    }

    // ── RIDE triggers (delay sells, ride momentum) ──
    else if (this.whaleAlert) {
      // Whale buy = coordination signal. Others will hold hoping for more pump.
      // Nash: if whale is buying, holding is weakly dominant (whale has info edge).
      signal = "RIDE";
      sellMult = 0.3; // delay sells significantly
      holdExt = 30;   // extend hold by 30s
      console.log(`[GAME] 🐋 WHALE DETECTED — riding momentum, extending hold 30s`);
    } else if (this.buyPressure > 0.75 && buys30 >= 4) {
      // Strong buy pressure from multiple participants
      // Nash: cooperative equilibrium — everyone holds, price goes up
      signal = "RIDE";
      sellMult = 0.5;
      holdExt = 15;
      console.log(`[GAME] 📈 Strong buy pressure: ${(this.buyPressure * 100).toFixed(0)}% | ${this.uniqueBuyers} unique buyers`);
    } else if (this.bondingPct > 60 && this.momentum > 0) {
      // Approaching graduation — potential Raydium migration premium
      // Nash: holding is dominant if graduation is likely (everyone benefits from LP)
      signal = "RIDE";
      sellMult = 0.4;
      holdExt = 45;
      console.log(`[GAME] 🎓 Graduation approaching: ${this.bondingPct.toFixed(0)}% bonded — holding for migration`);
    }

    // ── ACCUMULATE triggers (buy more if conditions are right) ──
    else if (this.uniqueBuyers >= 5 && this.momentum > 0.5 && this.buyPressure > 0.6) {
      signal = "ACCUMULATE";
      sellMult = 0.5;
      holdExt = 20;
      console.log(`[GAME] 💰 Accumulate signal: ${this.uniqueBuyers} buyers, positive momentum`);
    }

    // ── Default HOLD ──
    else {
      signal = "HOLD";
      sellMult = 1.0;
      // Adjust slightly based on pressure
      if (this.buyPressure > 0.55) sellMult = 0.8; // slightly delay
      if (this.buyPressure < 0.4) sellMult = 1.3;  // slightly accelerate
    }

    this.signal = signal;
    this.sellMultiplier = sellMult;
    this.holdExtension = holdExt;
  }

  // Get a snapshot for logging/UI
  snapshot() {
    return {
      signal: this.signal,
      sellMultiplier: this.sellMultiplier,
      holdExtension: this.holdExtension,
      buyPressure: Math.round(this.buyPressure * 100),
      momentum: Math.round(this.momentum * 100) / 100,
      volumeRate: Math.round(this.volumeRate * 100) / 100,
      uniqueBuyers: this.uniqueBuyers,
      opponents: this.opponents.size,
      whaleAlert: this.whaleAlert,
      devSelling: this.devSelling,
      dumpCascade: this.dumpCascade,
      bondingPct: Math.round(this.bondingPct),
      mcapSol: Math.round(this.mcapSol * 100) / 100,
      tradeCount: this.trades.length,
    };
  }
}

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

    console.log(`[FLEET] Launching on ${ca.slice(0, 8)}... | Budget: ${totalSol} SOL | Strategy: ${fleetConfig.existingCA ? "APE" : "CREATE"}`);

    const fleetWallets = [];
    const isApe = !!fleetConfig.existingCA;
    const conviction = fleetConfig.radarScore || 50; // 0-100 from radar
    const useFleet = totalSol >= 0.15; // lower threshold for ape (smaller positions OK)

    if (useFleet) {
      let walletCount, walletConfigs;

      if (isApe) {
        // ═══ APE MODE: conviction-driven wallet count ═══
        // Axiom: bet proportional to your edge (Kelly Criterion)
        // Higher conviction → more wallets → more exposure → faster entry
        // Lower conviction → fewer wallets → scout position → quick exit
        if (conviction >= 80) {
          walletCount = Math.min(7, Math.max(3, Math.floor(totalSol / 0.08))); // 5-7 wallets
        } else if (conviction >= 55) {
          walletCount = Math.min(4, Math.max(2, Math.floor(totalSol / 0.12))); // 3-4 wallets
        } else {
          walletCount = Math.min(2, Math.max(1, Math.floor(totalSol / 0.15))); // 1-2 wallets
        }
        walletCount = Math.min(walletCount, 7); // hard cap

        // Kelly-adjusted sizing: higher conviction → more even distribution
        // Lower conviction → heavy on first wallet (scout), light on rest
        walletConfigs = [];
        for (let i = 0; i < walletCount; i++) {
          const isScout = i === 0;
          // Stagger: 1-2s between wallets (tight enough to snipe, loose enough to not bundle)
          const buyDelay = 1 + i * (conviction >= 80 ? 1.5 : conviction >= 55 ? 2.5 : 4);
          // Sell timing: scouts exit first, later wallets hold longer
          const sellDelay = conviction >= 80 ? (20 + i * 15) : conviction >= 55 ? (15 + i * 12) : (10 + i * 8);
          // Weight: Kelly-proportional. High conviction = even. Low = front-loaded.
          const kellyFactor = conviction / 100; // 0-1
          const evenWeight = 1 / walletCount;
          const frontWeight = isScout ? 0.4 : 0.6 / (walletCount - 1);
          const weight = kellyFactor * evenWeight + (1 - kellyFactor) * frontWeight;

          walletConfigs.push({
            id: `ape${i + 1}`,
            weight,
            buyDelay: Math.round(buyDelay),
            sellDelay: Math.round(sellDelay),
            sellPct: conviction >= 80 ? 0.85 : conviction >= 55 ? 0.80 : 0.90, // low conviction = exit harder
            sellRounds: conviction >= 80 ? 3 : 2,
            phase: isScout ? "scout" : "fleet",
          });
        }
        console.log(`[FLEET] APE conviction:${conviction} → ${walletCount} wallets (Kelly-sized)`);

      } else {
        // ═══ CREATE MODE: organic staggered roles ═══
        const selectedRoles = totalSol < 0.6
          ? ROLES.filter(r => ["early1", "mid1", "late1"].includes(r.id))
          : totalSol < 1.5
            ? ROLES.filter(r => ["early1", "early2", "mid1", "mid2", "late1"].includes(r.id))
            : ROLES;
        walletConfigs = selectedRoles;
      }

      // Normalize weights and allocate SOL
      const totalWeight = walletConfigs.reduce((s, r) => s + r.weight, 0);
      const fleetBudget = totalSol - 0.02; // reserve for master fees

      for (const role of walletConfigs) {
        const kp = Keypair.generate();
        const walletBudget = (role.weight / totalWeight) * fleetBudget;
        fleetWallets.push({
          keypair: kp, pubkey: kp.publicKey.toBase58(),
          role: role.id, roleConfig: { ...role },
          tokenShare: role.weight / totalWeight,
          allocation: walletBudget,
          funded: false, solSpent: 0, solRecovered: 0, trades: [],
        });
      }

      const modeLabel = isApe ? "conviction-scaled ape" : "organic buy";
      console.log(`[FLEET] Generated ${fleetWallets.length} wallets (${modeLabel}):`);
      for (const w of fleetWallets) console.log(`  [${w.role}] ${w.pubkey.slice(0, 8)}... -> ${w.allocation.toFixed(4)} SOL (buy:${w.roleConfig.buyDelay}s sell:${w.roleConfig.sellDelay}s)`);
      await this._fundWallets(masterKp, fleetWallets);

    } else {
      // ═══ SOLO MODE: single wallet ═══
      fleetWallets.push({
        keypair: masterKp, pubkey: masterKp.publicKey.toBase58(), role: "solo",
        roleConfig: { id: "solo", buyDelay: 0, sellDelay: 15, sellPct: 0.90, sellRounds: 3, phase: "solo" },
        tokenShare: 1.0, allocation: totalSol, funded: true, solSpent: 0, solRecovered: 0, trades: [],
      });
    }

    // Build set of our own wallet pubkeys (to exclude from opponent analysis)
    const ourWallets = new Set(fleetWallets.map(w => w.pubkey));
    ourWallets.add(masterKp.publicKey.toBase58());

    // Initialize game state monitor
    const gameState = new GameState(ca, ourWallets);

    const session = {
      ca, mint, masterKp, totalSol, sessionId, fleetWallets,
      fleetConfig: { sniperCount, slippage, duration },
      startTime: Date.now(), phase: "starting", running: true,
      tradeCount: 0, totalSolSpent: 0, totalSolRecovered: 0, _profitConfig: profitConfig,
      _isApe: !!fleetConfig.existingCA,
      gameState,
    };
    this.sessions.set(ca, session);
    const walletKeys = fleetWallets.map(w => ({ role: w.role, pubkey: w.pubkey, secret: bs58.encode(w.keypair.secretKey), allocation: w.allocation, tokenShare: w.tokenShare }));
    session._walletKeys = walletKeys;

    if (duration > 0) setTimeout(() => { if (session.running) { session.running = false; session.phase = "duration_complete"; } }, duration * 60 * 1000);

    // Start game state monitoring (opponent trade feed)
    gameState.connect();

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
  // CREATE mode: staggered buys from multiple wallets → sell cycle
  // APE mode: fast multi-wallet snipe → quick exit
  // VOLUME mode: wash trading between wallets for chart activity
  // ═══════════════════════════════════════
  async _runSmartFleet(session) {
    const { ca, mint, masterKp, fleetWallets } = session;
    session.phase = "initializing";
    let global, feeConfig;
    try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); }
    catch (e) { console.error("[FLEET] Failed to fetch global:", e.message); session.phase = "error"; return; }

    const isSolo = fleetWallets.length === 1 && fleetWallets[0].keypair.publicKey.equals(masterKp.publicKey);
    const isApe = session.fleetConfig?.existingCA || session._isApe;

    if (isApe) {
      await this._runApeStrategy(session, global, feeConfig, isSolo);
    } else {
      await this._runCreateStrategy(session, global, feeConfig, isSolo);
    }
  }

  // ── CREATE MODE: organic-looking buys then sells ──
  async _runCreateStrategy(session, global, feeConfig, isSolo) {
    const { ca, mint, masterKp, fleetWallets } = session;

    // Phase 1: Staggered buys
    session.phase = "buying";
    this.emit("phase", { ca, phase: "buying" });
    console.log(`[FLEET] CREATE: Phase 1 — staggered buys from ${fleetWallets.length} wallet(s)...`);

    if (isSolo) {
      console.log(`[FLEET] Solo mode — dev already holds tokens from creation buy`);
    } else {
      const buyPromises = fleetWallets.filter(w => w.funded).map(async (wallet) => {
        const baseDelay = (wallet.roleConfig.buyDelay || 10) * 1000;
        const jitter = Math.random() * baseDelay * 0.5;
        await sleep(baseDelay + jitter);
        if (!session.running) return;

        const buyAmount = wallet.allocation * 0.90;
        if (buyAmount < 0.01) return;

        try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); } catch {}

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
      console.log(`[FLEET] Phase 1 complete — ${session.tradeCount} buys`);
    }

    // Phase 2: Volume generation — small buy/sell cycles to make chart look active
    if (!session.running) return;
    if (fleetWallets.length >= 3) {
      session.phase = "volume";
      this.emit("phase", { ca, phase: "volume" });
      console.log(`[FLEET] CREATE: Phase 2 — volume generation...`);
      await this._generateVolume(session, global, feeConfig, 3); // 3 wash cycles
    }

    // Phase 3: Staggered sells
    if (!session.running) return;
    session.phase = "selling";
    this.emit("phase", { ca, phase: "selling" });
    console.log(`[FLEET] CREATE: Phase 3 — staggered sells...`);

    try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); } catch {}

    const sellWallets = fleetWallets.filter(w => w.funded);
    const sellPromises = sellWallets.map(async (wallet) => {
      const delay = (wallet.roleConfig.sellDelay || 30) * 1000;
      await sleep(delay + Math.random() * delay * 0.3);
      if (!session.running) return;
      return this._runSellLoop(session, wallet, global, feeConfig);
    });
    await Promise.allSettled(sellPromises);

    if (session.running) { session.phase = "holding"; this.emit("phase", { ca, phase: "holding" }); }
  }

  // ── APE MODE: fast multi-wallet snipe → hold → quick exit ──
  async _runApeStrategy(session, global, feeConfig, isSolo) {
    const { ca, mint, masterKp, fleetWallets } = session;

    // Phase 1: Rapid-fire buys — all wallets buy within 2-8 seconds (snipe window)
    session.phase = "sniping";
    this.emit("phase", { ca, phase: "sniping" });
    console.log(`[FLEET] APE: Phase 1 — rapid snipe on ${ca.slice(0, 8)}...`);

    const buyPromises = fleetWallets.filter(w => w.funded).map(async (wallet, idx) => {
      // Tight stagger: 1-3 seconds between each wallet (looks like multiple users aping)
      const delay = (1 + idx * 1.5 + Math.random() * 2) * 1000;
      await sleep(delay);
      if (!session.running) return;

      const buyAmount = wallet.allocation * 0.92; // keep 8% for sell fees
      if (buyAmount < 0.01) return;

      try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); } catch {}

      try {
        console.log(`[FLEET] [${wallet.role}] APE BUY ${buyAmount.toFixed(4)} SOL...`);
        const result = await this._executeBuy(wallet, mint, global, feeConfig, buyAmount);
        if (result.ok) {
          wallet.solSpent += buyAmount;
          wallet.trades.push({ side: "buy", solIn: buyAmount, sig: result.sig, time: Date.now() });
          session.tradeCount++; session.totalSolSpent += buyAmount;
          this.emit("trade", { ca, role: wallet.role, side: "buy", sol: buyAmount, sig: result.sig });
          console.log(`[FLEET] [${wallet.role}] APE BUY OK -> ${buyAmount.toFixed(4)} SOL | sig: ${result.sig?.slice(0, 12)}`);
        }
      } catch (e) { console.error(`[FLEET] [${wallet.role}] APE buy error:`, e.message); }
    });
    await Promise.allSettled(buyPromises);
    console.log(`[FLEET] APE: ${session.tradeCount} buys landed`);

    // Phase 2: Hold briefly — let the chart develop, wait for other buyers
    // GameState continuously monitors — can extend or cut hold short
    if (!session.running) return;
    session.phase = "holding";
    this.emit("phase", { ca, phase: "holding" });
    const baseHoldTime = (session.fleetConfig?.duration || 1) * 60 * 1000;
    let holdEnd = Date.now() + baseHoldTime;
    console.log(`[FLEET] APE: Holding for ${(baseHoldTime / 1000).toFixed(0)}s (GameState may adjust)...`);

    while (Date.now() < holdEnd && session.running) {
      await sleep(5000 + Math.random() * 8000);
      if (!session.running) break;

      // Check GameState for early exit or hold extension
      if (session.gameState?.alive) {
        const gs = session.gameState.snapshot();

        if (gs.signal === "SELL_NOW") {
          console.log(`[GAME] APE: ⚡ SELL_NOW during hold — cutting hold short`);
          break; // exit hold, go straight to sells
        }
        if (gs.signal === "RIDE" && gs.holdExtension > 0) {
          const newEnd = Date.now() + gs.holdExtension * 1000;
          if (newEnd > holdEnd) {
            console.log(`[GAME] APE: 📈 Extending hold by ${gs.holdExtension}s (${gs.buyPressure}% buy pressure)`);
            holdEnd = newEnd;
          }
        }

        // Log game state periodically
        if (Math.random() < 0.3) {
          console.log(`[GAME] ${gs.signal} | bp:${gs.buyPressure}% | mom:${gs.momentum} | buyers:${gs.uniqueBuyers} | vol:${gs.volumeRate}/min${gs.whaleAlert ? " | 🐋" : ""}${gs.devSelling ? " | ⚠DEV" : ""}`);
        }
      }

      // During hold, do small volume trades
      if (Date.now() < holdEnd && session.running) {
        const activeWallets = fleetWallets.filter(w => w.funded && w.trades.length > 0);
        if (activeWallets.length >= 2) {
          const w = activeWallets[Math.floor(Math.random() * activeWallets.length)];
          try {
            global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig();
            const smallSellPct = 0.05 + Math.random() * 0.10;
            const sellResult = await this._executeSell(w, mint, global, feeConfig, smallSellPct);
            if (sellResult.ok) {
              session.tradeCount++; session.totalSolRecovered += sellResult.solOut || 0;
              this.emit("trade", { ca, role: w.role, side: "sell", sol: sellResult.solOut, sig: sellResult.sig });
              console.log(`[FLEET] [${w.role}] Volume sell ${(smallSellPct * 100).toFixed(0)}% -> ${(sellResult.solOut || 0).toFixed(4)} SOL`);
            }
          } catch {}
        }
      }
    }

    // Phase 3: Exit — staggered sells (faster than CREATE mode)
    if (!session.running) return;
    session.phase = "exiting";
    this.emit("phase", { ca, phase: "exiting" });
    console.log(`[FLEET] APE: Phase 3 — exiting positions...`);

    try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); } catch {}

    const exitPromises = fleetWallets.filter(w => w.funded).map(async (wallet, idx) => {
      // Exit stagger: 3-10 seconds between wallets
      await sleep((3 + idx * 2 + Math.random() * 5) * 1000);
      if (!session.running) return;
      // Sell 90-95% in one shot
      try {
        const result = await this._executeSell(wallet, mint, global, feeConfig, 0.90 + Math.random() * 0.05);
        if (result.ok) {
          wallet.solRecovered += result.solOut || 0;
          wallet.trades.push({ side: "sell", solOut: result.solOut, sig: result.sig, time: Date.now() });
          session.tradeCount++; session.totalSolRecovered += result.solOut || 0;
          this.emit("trade", { ca, role: wallet.role, side: "sell", sol: result.solOut, sig: result.sig });
          console.log(`[FLEET] [${wallet.role}] EXIT SELL -> ${(result.solOut || 0).toFixed(4)} SOL | sig: ${result.sig?.slice(0, 12)}`);
        }
      } catch (e) { console.error(`[FLEET] [${wallet.role}] Exit sell error:`, e.message); }
    });
    await Promise.allSettled(exitPromises);

    if (session.running) { session.phase = "exited"; this.emit("phase", { ca, phase: "exited" }); }
  }

  // ── VOLUME ENGINE: small buy/sell cycles across wallets to generate chart activity ──
  async _generateVolume(session, global, feeConfig, cycles = 3) {
    const { ca, mint, fleetWallets } = session;
    const activeWallets = fleetWallets.filter(w => w.funded && w.trades.length > 0);
    if (activeWallets.length < 2) return;

    for (let c = 0; c < cycles && session.running; c++) {
      // Pick 2 random wallets: one sells small, another buys with the proceeds vibe
      const shuffled = [...activeWallets].sort(() => Math.random() - 0.5);
      const seller = shuffled[0];
      const buyer = shuffled[1];

      try {
        global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig();

        // Seller dumps 8-18% (small, looks like a partial take-profit)
        const sellPct = 0.08 + Math.random() * 0.10;
        const sellResult = await this._executeSell(seller, mint, global, feeConfig, sellPct);
        if (sellResult.ok) {
          seller.solRecovered += sellResult.solOut || 0;
          session.tradeCount++; session.totalSolRecovered += sellResult.solOut || 0;
          this.emit("trade", { ca, role: seller.role, side: "sell", sol: sellResult.solOut, sig: sellResult.sig });
          console.log(`[FLEET] [${seller.role}] VOL sell ${(sellPct * 100).toFixed(0)}% -> ${(sellResult.solOut || 0).toFixed(4)} SOL`);
        }

        await sleep(3000 + Math.random() * 5000); // gap between sell and buy

        // Buyer buys a small amount (uses remaining SOL in wallet)
        const buyerBal = await this.connection.getBalance(buyer.keypair.publicKey);
        const buyerSol = buyerBal / LAMPORTS_PER_SOL;
        const buyAmount = Math.min(buyerSol * 0.15, 0.05); // small buy, max 0.05 SOL
        if (buyAmount >= 0.005 && session.running) {
          const buyResult = await this._executeBuy(buyer, mint, global, feeConfig, buyAmount);
          if (buyResult.ok) {
            buyer.solSpent += buyAmount;
            session.tradeCount++; session.totalSolSpent += buyAmount;
            this.emit("trade", { ca, role: buyer.role, side: "buy", sol: buyAmount, sig: buyResult.sig });
            console.log(`[FLEET] [${buyer.role}] VOL buy ${buyAmount.toFixed(4)} SOL`);
          }
        }
      } catch (e) { console.error(`[FLEET] Volume cycle ${c + 1} error:`, e.message); }

      await sleep(5000 + Math.random() * 10000); // gap between cycles
    }
  }

  async _runSellLoop(session, wallet, global, feeConfig) {
    const { ca, mint, gameState } = session;
    const { sellPct, sellRounds } = wallet.roleConfig;
    console.log(`[FLEET] [${wallet.role}] Starting sell — ${sellRounds} rounds, ${(sellPct * 100).toFixed(0)}%`);
    const pctPerRound = sellPct / sellRounds;

    for (let i = 0; i < sellRounds && session.running; i++) {
      // ── Check GameState before each sell ──
      if (gameState && gameState.alive) {
        const gs = gameState.snapshot();

        // RIDE signal: delay this sell round
        if (gs.signal === "RIDE" && i < sellRounds - 1) {
          const extraWait = (gameState.holdExtension || 15) * 1000;
          console.log(`[FLEET] [${wallet.role}] RIDE signal (${gs.buyPressure}% buys, ${gs.uniqueBuyers} buyers) — delaying ${(extraWait/1000).toFixed(0)}s`);
          await sleep(extraWait);
          if (!session.running) break;
          // Re-check after delay
          const gs2 = gameState.snapshot();
          if (gs2.signal === "RIDE") {
            console.log(`[FLEET] [${wallet.role}] Still RIDE — skipping this sell round`);
            continue; // skip this round entirely
          }
        }

        // SELL_NOW signal: dump everything immediately
        if (gs.signal === "SELL_NOW") {
          console.log(`[FLEET] [${wallet.role}] ⚡ SELL_NOW signal — dumping remaining tokens`);
          try {
            // Refetch for fresh state
            try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); } catch {}
            const result = await this._executeSell(wallet, mint, global, feeConfig, 0.95);
            if (result.ok) {
              wallet.solRecovered += result.solOut || 0;
              wallet.trades.push({ side: "sell", solOut: result.solOut, sig: result.sig, time: Date.now() });
              session.tradeCount++; session.totalSolRecovered += result.solOut || 0;
              this.emit("trade", { ca, role: wallet.role, side: "sell", sol: result.solOut, sig: result.sig });
              console.log(`[FLEET] [${wallet.role}] EMERGENCY SELL -> ${(result.solOut || 0).toFixed(4)} SOL`);
            }
          } catch (e) { console.error(`[FLEET] [${wallet.role}] Emergency sell failed:`, e.message); }
          return; // exit sell loop entirely
        }

        // ACCUMULATE signal: buy more instead of selling (if we have SOL)
        if (gs.signal === "ACCUMULATE" && i === 0) {
          const walletBal = await this.connection.getBalance(wallet.keypair.publicKey);
          const availSol = walletBal / LAMPORTS_PER_SOL - 0.003;
          if (availSol > 0.01) {
            console.log(`[FLEET] [${wallet.role}] ACCUMULATE signal — buying ${availSol.toFixed(4)} more SOL`);
            try {
              global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig();
              const buyResult = await this._executeBuy(wallet, mint, global, feeConfig, availSol * 0.8);
              if (buyResult.ok) {
                wallet.solSpent += availSol * 0.8;
                session.tradeCount++; session.totalSolSpent += availSol * 0.8;
                this.emit("trade", { ca, role: wallet.role, side: "buy", sol: availSol * 0.8, sig: buyResult.sig });
                console.log(`[FLEET] [${wallet.role}] Re-accumulated ${(availSol * 0.8).toFixed(4)} SOL`);
              }
            } catch {}
            await sleep(10000 + Math.random() * 15000); // hold the re-buy for a bit
            if (!session.running) break;
          }
        }
      }

      // ── Execute sell with GameState-adjusted sizing ──
      const gsMultiplier = gameState?.sellMultiplier || 1.0;
      const actualPct = pctPerRound * (0.7 + Math.random() * 0.6) * Math.min(gsMultiplier, 2.0);

      try {
        // Refetch global for fresh bonding curve
        try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); } catch {}
        const result = await this._executeSell(wallet, mint, global, feeConfig, Math.min(actualPct, 0.95));
        if (result.ok) {
          wallet.solRecovered += result.solOut || 0;
          wallet.trades.push({ side: "sell", solOut: result.solOut, sig: result.sig, time: Date.now() });
          session.tradeCount++; session.totalSolRecovered += result.solOut || 0;
          this.emit("trade", { ca, role: wallet.role, side: "sell", sol: result.solOut, sig: result.sig });
          console.log(`[FLEET] [${wallet.role}] SELL ${i + 1}/${sellRounds} -> ${(result.solOut || 0).toFixed(4)} SOL${gsMultiplier !== 1 ? ` (${gsMultiplier.toFixed(1)}x)` : ""}`);
        }
      } catch (e) { console.error(`[FLEET] [${wallet.role}] Sell failed:`, e.message); }

      if (i < sellRounds - 1) {
        // Inter-round delay adjusted by GameState
        const baseDelay = (10 + Math.random() * 30) * 1000;
        const adjustedDelay = baseDelay / Math.max(0.3, gsMultiplier);
        await sleep(adjustedDelay);
      }
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
    // Stop game state monitoring
    if (session.gameState) session.gameState.stop();
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
        gameState: s.gameState?.alive ? s.gameState.snapshot() : null,
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
