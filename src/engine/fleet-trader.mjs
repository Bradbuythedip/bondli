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

    // Track cumulative observed volume (for 2% volume cap)
    if (!isOurs) this.observedVolume = (this.observedVolume || 0) + sol;

    // ── Compute signals ──
    this._computeSignals(now);
  }

  _computeSignals(now) {
    // ── Exponential decay weighting (replaces flat windows) ──
    // w(t) = exp(-λ · age_seconds)
    // Fast λ=0.1 (half-life ~7s): buy pressure, momentum, cascade detection
    // Medium λ=0.02 (half-life ~35s): volume rate, unique buyers
    // Slow λ=0.005 (half-life ~140s): dev selling detection
    const FAST = 0.1, MED = 0.02, SLOW = 0.005;
    const decay = (age, lambda) => Math.exp(-lambda * (age / 1000));

    const external = this.trades.filter(t => !t.isOurs);

    // Decay-weighted buy pressure (fast — reacts in seconds)
    let wBuys = 0, wSells = 0;
    for (const t of external) {
      const w = decay(now - t.time, FAST);
      if (w < 0.01) continue; // prune negligible
      if (t.type === "buy") wBuys += w;
      else wSells += w;
    }
    this.buyPressure = (wBuys + wSells) > 0.01 ? wBuys / (wBuys + wSells) : 0.5;

    // Decay-weighted momentum: net SOL flow (fast)
    let wBuyVol = 0, wSellVol = 0;
    for (const t of external) {
      const w = decay(now - t.time, FAST);
      if (w < 0.01) continue;
      if (t.type === "buy") wBuyVol += t.sol * w;
      else wSellVol += t.sol * w;
    }
    this.momentum = wBuyVol - wSellVol;

    // Decay-weighted volume rate (medium — smoothed over ~35s)
    let wVol = 0;
    for (const t of external) {
      const w = decay(now - t.time, MED);
      if (w < 0.005) continue;
      wVol += t.sol * w;
    }
    this.volumeRate = wVol;

    // Unique buyers in last 2 min (unchanged — count, not weight)
    const window2m = this.trades.filter(t => now - t.time < 120000 && !t.isOurs && t.type === "buy");
    this.uniqueBuyers = new Set(window2m.map(t => t.wallet)).size;

    // Whale alert: high-weight recent large buy (fast decay, >0.5 SOL, weight > 0.5 = ~7s old)
    this.whaleAlert = external.some(t => t.type === "buy" && t.sol > 0.5 && decay(now - t.time, FAST) > 0.5);

    // Dev selling: any dev sell with medium-decay weight > 0.3 (~40s old)
    if (this.devWallet) {
      this.devSelling = external.some(t => t.type === "sell" && t.wallet.startsWith(this.devWallet) && decay(now - t.time, SLOW) > 0.3);
    }

    // Dump cascade: 3+ unique sellers with high fast-decay weight (recent cluster)
    const recentSells = external.filter(t => t.type === "sell" && decay(now - t.time, FAST) > 0.3);
    const uniqueSellers = new Set(recentSells.map(t => t.wallet)).size;
    this.dumpCascade = uniqueSellers >= 3;

    // ── Cumulative observed volume (for volume cap enforcement) ──
    this.observedVolume = (this.observedVolume || 0);
    // Updated in _processTrade, not here

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
      observedVolume: Math.round((this.observedVolume || 0) * 100) / 100,
    };
  }
}

// ═══════════════════════════════════════
// DEV SELL CONTROLLER — Mimicry Axiom
// Makes the dev wallet sell small amounts during volume phase
// so it looks like a normal retail dev taking profit.
// A dev that NEVER sells while 6 wallets buy is a coordination signal.
// ═══════════════════════════════════════
class DevSellController {
  constructor(session) {
    this.session = session;
    this.totalDevSoldPct = 0;
    this.maxDevSellPct = 0.20;   // Never sell more than 20% during volume phase
    this.sellCount = 0;
    this.lastSellTime = 0;
    this.minSellGap = 15000;     // At least 15s between dev sells
  }

  shouldDevSell(tradeType, tradeSol, isOurs, gameState) {
    if (this.totalDevSoldPct >= this.maxDevSellPct) return null;
    if (gameState?.signal === "SELL_NOW") return null;
    if (Date.now() - this.lastSellTime < this.minSellGap) return null;
    if (tradeType === "sell") return null;

    let probability = 0, sellPct = 0, delay = 0;

    if (tradeSol > 0.5) {
      probability = 0.30;
      sellPct = 0.02 + Math.random() * 0.03;
      delay = 3000 + Math.random() * 5000;
    } else if (tradeSol > 0.1) {
      probability = 0.15;
      sellPct = 0.01 + Math.random() * 0.02;
      delay = 5000 + Math.random() * 8000;
    } else if (!isOurs && tradeSol > 0.02) {
      probability = 0.08;
      sellPct = 0.01 + Math.random() * 0.015;
      delay = 8000 + Math.random() * 12000;
    } else {
      probability = 0.04;
      sellPct = 0.005 + Math.random() * 0.01;
      delay = 10000 + Math.random() * 15000;
    }

    if (this.session.tradeCount > 10) probability *= 1.3;
    if (this.session.tradeCount > 20) probability *= 1.2;
    if (gameState?.signal === "RIDE") { probability *= 0.3; sellPct *= 0.5; }

    if (Math.random() > probability) return null;
    sellPct = Math.min(sellPct, this.maxDevSellPct - this.totalDevSoldPct);
    if (sellPct < 0.003) return null;

    return { shouldSell: true, sellPct, delay };
  }

  recordSell(pctSold) {
    this.totalDevSoldPct += pctSold;
    this.sellCount++;
    this.lastSellTime = Date.now();
  }

  summary() {
    return {
      totalSoldPct: +(this.totalDevSoldPct * 100).toFixed(2),
      sellCount: this.sellCount,
      remainingAllowance: +((this.maxDevSellPct - this.totalDevSoldPct) * 100).toFixed(2),
    };
  }
}

// WALLET ROLES v5 — buy timing matters less now (CREATE strategy controls waves)
// sellPct is max sell per round BEFORE holdback deduction
const ROLES = [
  { id: "early1",   weight: 0.18, buyDelay: 3,   sellDelay: 0,   sellPct: 0.60, sellRounds: 3, phase: "early"  },
  { id: "early2",   weight: 0.15, buyDelay: 7,   sellDelay: 0,   sellPct: 0.55, sellRounds: 3, phase: "early"  },
  { id: "mid1",     weight: 0.20, buyDelay: 14,  sellDelay: 0,   sellPct: 0.50, sellRounds: 3, phase: "mid"    },
  { id: "mid2",     weight: 0.17, buyDelay: 22,  sellDelay: 0,   sellPct: 0.50, sellRounds: 2, phase: "mid"    },
  { id: "late1",    weight: 0.16, buyDelay: 35,  sellDelay: 0,   sellPct: 0.55, sellRounds: 3, phase: "late"   },
  { id: "late2",    weight: 0.14, buyDelay: 50,  sellDelay: 0,   sellPct: 0.65, sellRounds: 2, phase: "late"   },
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

  // ── CREATE MODE v6: SPEED IS EVERYTHING ──
  // Dev buy already happened at token creation
  // Phase 1: ALL fleet buys fire in parallel (Lightning API) — under 5 seconds total
  // Phase 2: Volume engine (aggressive, 1-3s cycles)
  // Phase 3: Sell INTO demand
  async _runCreateStrategy(session, global, feeConfig, isSolo) {
    const { ca, mint, masterKp, fleetWallets, gameState } = session;
    const funded = fleetWallets.filter(w => w.funded);

    session._devSellCtrl = new DevSellController(session);

    // ═══ PHASE 1: RAPID ENTRY — all buys within 5 seconds ═══
    session.phase = "buying";
    this.emit("phase", { ca, phase: "buying" });
    session.startTime = Date.now();
    console.log(`[FLEET] CREATE v6: Phase 1 — RAPID ENTRY ${funded.length} wallets...`);

    if (isSolo) {
      console.log(`[FLEET] Solo mode — dev holds from creation buy`);
    } else {
      // Fire ALL buys in parallel — PumpPortal Lightning is fastest (no signing)
      // Tiny stagger (300-1000ms) so they land in different blocks = looks organic
      const buyPromises = funded.map(async (wallet, i) => {
        const delay = i * (300 + Math.random() * 700);
        await sleep(delay);
        if (!session.running) return null;
        const buyAmount = wallet.allocation * 0.88;
        if (buyAmount < 0.01) return null;

        try {
          // Try PumpPortal Lightning first (fastest — single HTTP call, no signing)
          if (session._apiKey) {
            const ppRes = await fetch("https://pumpportal.fun/api/trade?api-key=" + session._apiKey, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "buy", mint: ca, amount: buyAmount,
                denominatedInSol: "true", slippage: 30,
                priorityFee: 0.001, pool: "pump",
              }),
            });
            const result = await ppRes.json();
            if (result.signature) {
              wallet.solSpent += buyAmount;
              session.tradeCount++; session.totalSolSpent += buyAmount;
              this.emit("trade", { ca, role: wallet.role, side: "buy", sol: buyAmount, sig: result.signature });
              console.log(`[FLEET] [${wallet.role}] RAPID BUY ${buyAmount.toFixed(4)} SOL | ${((Date.now() - session.startTime) / 1000).toFixed(1)}s`);
              return { ok: true };
            }
          }
          // Fallback: on-chain SDK buy
          try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); } catch {}
          const result = await this._executeBuy(wallet, mint, global, feeConfig, buyAmount);
          if (result.ok) {
            wallet.solSpent += buyAmount;
            session.tradeCount++; session.totalSolSpent += buyAmount;
            this.emit("trade", { ca, role: wallet.role, side: "buy", sol: buyAmount, sig: result.sig });
            console.log(`[FLEET] [${wallet.role}] SDK BUY ${buyAmount.toFixed(4)} SOL | ${((Date.now() - session.startTime) / 1000).toFixed(1)}s`);
            return result;
          }
        } catch (e) { console.error(`[FLEET] [${wallet.role}] Buy error:`, e.message); }
        return null;
      });

      const results = await Promise.allSettled(buyPromises);
      const succeeded = results.filter(r => r.status === "fulfilled" && r.value?.ok).length;
      const elapsed = ((Date.now() - session.startTime) / 1000).toFixed(1);
      console.log(`[FLEET] Phase 1 DONE: ${succeeded}/${funded.length} buys in ${elapsed}s`);
    }

    if (!session.running) return;
    await sleep(2000); // brief pause to let chart render

      // ═══ PHASE 3: Volume generation (3-5 MINUTES) ═══
      // This is the critical phase — paint the chart to attract real buyers
      if (!session.running) return;
      session.phase = "volume";
      this.emit("phase", { ca, phase: "volume" });

      // Run volume for at least 3 minutes (time-based, not cycle-based)
      const volumeEnd = Date.now() + (3 * 60 * 1000) + Math.random() * (2 * 60 * 1000); // 3-5 min
      let volCycle = 0;
      console.log(`[FLEET] CREATE v5: Phase 3 — parabolic volume for ${Math.round((volumeEnd - Date.now()) / 60000)}min...`);

      while (Date.now() < volumeEnd && session.running) {
        // Check GameState — abort volume if dump detected
        if (gameState?.alive) {
          const gs = gameState.snapshot();
          if (gs.signal === "SELL_NOW") {
            console.log(`[FLEET] ⚡ SELL_NOW during volume — aborting, going to sell phase`);
            break;
          }
          if (volCycle % 3 === 0) {
            console.log(`[FLEET] [VOL] round ${volCycle} | ${gs.uniqueBuyers} ext buyers | ${gs.buyPressure}% bp | ${gs.signal}`);
          }
        }

        // Run one full parabola (8 steps = ~30-60s of trades)
        await this._generateVolume(session, global, feeConfig, 2);
        volCycle++;
        
        // Refresh global between cycles
        try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); } catch {}
      }

      console.log(`[FLEET] Volume phase done — ${volCycle} cycles, ${session.tradeCount} total trades`);
    }

    // ═══ PHASE 4: Sell INTO demand (only when real buyers are active) ═══
    if (!session.running) return;
    session.phase = "selling";
    this.emit("phase", { ca, phase: "selling" });
    console.log(`[FLEET] CREATE v5: Phase 4 — sell into demand...`);

    try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); } catch {}

    // Sort wallets by sell delay, sell one at a time
    const sellOrder = [...funded].sort((a, b) => (a.roleConfig.sellDelay || 30) - (b.roleConfig.sellDelay || 30));

    for (let i = 0; i < sellOrder.length && session.running; i++) {
      const wallet = sellOrder[i];

      // Wait for demand before selling (check GameState)
      let waitedForDemand = 0;
      const maxWaitForDemand = 60000; // max 60s waiting per wallet
      
      while (waitedForDemand < maxWaitForDemand && session.running) {
        if (gameState?.alive) {
          const gs = gameState.snapshot();
          // Good conditions to sell into:
          if (gs.signal === "SELL_NOW") break; // emergency — sell regardless
          if (gs.buyPressure > 45) break;       // buyers are active — sell into them
          if (gs.uniqueBuyers >= 2) break;       // real people buying
          if (gs.momentum > 0.1) break;          // price going up — good time to take profit
        }
        // If no GameState or just launched, wait then sell anyway
        if (!gameState?.alive && waitedForDemand > 15000) break;
        
        await sleep(5000);
        waitedForDemand += 5000;
        
        if (waitedForDemand % 15000 === 0) {
          console.log(`[FLEET] [${wallet.role}] Waiting for demand... (${(waitedForDemand/1000).toFixed(0)}s)`);
        }
      }

      if (!session.running) break;
      
      // Sell this wallet's tokens
      console.log(`[FLEET] [${wallet.role}] Selling (waited ${(waitedForDemand/1000).toFixed(0)}s for demand)...`);
      try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); } catch {}
      
      // Don't sell everything — keep 15-30% for moonshot potential
      const holdBack = 0.15 + Math.random() * 0.15; // keep 15-30%
      const sellPct = (wallet.roleConfig.sellPct || 0.70) * (1 - holdBack);
      
      await this._runSellLoop(session, wallet, global, feeConfig);

      // Gap between wallets selling (10-25s, looks like different people taking profit)
      if (i < sellOrder.length - 1) {
        await sleep(10000 + Math.random() * 15000);
      }
    }

    // ═══ PHASE 5: Hold remainder ═══
    if (session.running) {
      session.phase = "holding";
      this.emit("phase", { ca, phase: "holding" });
      console.log(`[FLEET] CREATE v5: Phase 5 — holding remaining tokens. Close manually when ready.`);
    }
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

      // During hold, run coordinated volume to attract real buyers
      if (Date.now() < holdEnd && session.running) {
        const activeWallets = fleetWallets.filter(w => w.funded && w.trades.length > 0);
        if (activeWallets.length >= 2) {
          // Run one volume cycle per hold iteration
          await this._generateVolume(session, global, feeConfig, 1);
        } else {
          await sleep(5000);
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

  // ═══════════════════════════════════════════════════════════════
  // VOLUME ENGINE v3 — Parabolic Build
  //
  // Volume builds like a crescendo: small → medium → PEAK → medium
  // Early cycles:  BUY heavy, tiny sells (accumulation — push price up)
  // Mid cycles:    BIG buys + BIG sells (peak activity — attract eyeballs)
  // Late cycles:   Sells catch up (distribute into any real demand)
  //
  // Trade timing: 3-8 seconds between each trade (never simultaneous)
  // Trade sizes:  Follow sin(π * progress) curve — peak in the middle
  // Different wallet each trade — no wallet does back-to-back
  // ═══════════════════════════════════════════════════════════════
  async _generateVolume(session, global, feeConfig, cycles = 1) {
    const { ca, mint, fleetWallets, gameState } = session;
    const active = fleetWallets.filter(w => w.funded && w.trades.length > 0);
    if (active.length < 2) return;

    // For multi-cycle calls from CREATE strategy, run the full parabola
    const totalSteps = Math.max(cycles * 4, 8); // each cycle = ~4 trade actions
    let lastBuyWallet = null;
    let lastSellWallet = null;

    for (let step = 0; step < totalSteps && session.running; step++) {
      const progress = step / totalSteps; // 0 → 1
      
      // Parabolic intensity: sin curve peaks at 50%
      const intensity = Math.sin(progress * Math.PI); // 0 → 1 → 0
      
      // Buy/sell ratio shifts over time:
      // Early (0-30%): 80% buys, 20% sells (accumulate)
      // Mid (30-70%):  55% buys, 45% sells (peak volume, roughly balanced)
      // Late (70-100%): 30% buys, 70% sells (distribute)
      const buyBias = progress < 0.3 ? 0.85 : progress < 0.7 ? 0.55 : 0.25;
      const doBuy = Math.random() < buyBias;

      // Check GameState
      if (gameState?.alive) {
        const gs = gameState.snapshot();
        if (gs.signal === "SELL_NOW") { console.log(`[VOL] SELL_NOW — aborting`); return; }
        // 2% volume cap: if external volume exists, don't let fleet exceed 2% of it
        // This prevents detection AND prevents moving price against ourselves
        // Skip check for CREATE mode (we ARE the market) — only apply when observedVolume > 1 SOL
        if (gs.observedVolume > 1 && session.totalSolSpent > gs.observedVolume * 0.02) {
          console.log(`[VOL] Volume cap: fleet spent ${session.totalSolSpent.toFixed(4)} SOL > 2% of ${gs.observedVolume.toFixed(2)} observed — throttling buys`);
          // Still allow sells (distribution), just skip buys
          if (doBuy) { await sleep(2000); continue; }
        }
      }

      // Refresh global/feeConfig every 5 steps (RPC calls add 200-500ms each)
      if (step % 5 === 0) { try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); } catch {} }

      // Pick a wallet (never same wallet back-to-back for same action)
      const shuffled = [...active].sort(() => Math.random() - 0.5);

      if (doBuy) {
        // ── BUY: size scales with intensity ──
        const wallet = shuffled.find(w => w !== lastBuyWallet) || shuffled[0];
        lastBuyWallet = wallet;
        
        const walletBal = await this.connection.getBalance(wallet.keypair.publicKey);
        const walletSol = walletBal / LAMPORTS_PER_SOL;
        
        // Base size: 3-8% of wallet balance, scaled by intensity
        const basePct = 0.03 + intensity * 0.08; // 3% at edges, 11% at peak
        const buyAmount = Math.min(walletSol * basePct, 0.02 + intensity * 0.08); // cap: 0.02-0.10 SOL
        
        if (buyAmount >= 0.005 && walletSol > buyAmount + 0.003) {
          try {
            const r = await this._executeBuy(wallet, mint, global, feeConfig, buyAmount);
            if (r.ok) {
              wallet.solSpent += buyAmount;
              session.tradeCount++; session.totalSolSpent += buyAmount;
              this.emit("trade", { ca, role: wallet.role, side: "buy", sol: buyAmount, sig: r.sig });
              const phase = progress < 0.3 ? "accumulate" : progress < 0.7 ? "peak" : "taper";
              console.log(`[VOL] ${step}/${totalSteps} BUY ${buyAmount.toFixed(4)} SOL [${wallet.role}] (${phase} i:${intensity.toFixed(2)})`);
            }
          } catch {}
        }
      } else {
        // ── SELL: size also scales with intensity, but smaller early ──
        const wallet = shuffled.find(w => w !== lastSellWallet && w.trades.some(t => t.side === "buy")) || shuffled[0];
        lastSellWallet = wallet;
        
        // Sell percentage of TOKEN holdings: 2-6% early, 5-15% at peak, 8-20% late
        const earlyPct = 0.02 + intensity * 0.04;
        const latePct = 0.05 + intensity * 0.15;
        const sellPct = progress < 0.3 ? earlyPct : progress < 0.7 ? earlyPct * 1.5 : latePct;
        
        try {
          const r = await this._executeSell(wallet, mint, global, feeConfig, Math.min(sellPct, 0.20));
          if (r.ok) {
            wallet.solRecovered += r.solOut || 0;
            session.tradeCount++; session.totalSolRecovered += r.solOut || 0;
            this.emit("trade", { ca, role: wallet.role, side: "sell", sol: r.solOut, sig: r.sig });
            const phase = progress < 0.3 ? "tiny-red" : progress < 0.7 ? "healthy-red" : "distribute";
            console.log(`[VOL] ${step}/${totalSteps} SELL ${(sellPct * 100).toFixed(0)}% [${wallet.role}] -> ${(r.solOut || 0).toFixed(4)} SOL (${phase})`);
          }
        } catch {}
      }

      // ── Dev sell check (Mimicry Axiom) ──
      // After each fleet buy, the dev might sell a small amount.
      // This makes the dev look like a normal retail creator taking profit.
      if (doBuy && session._devSellCtrl) {
        const gs = gameState?.alive ? gameState.snapshot() : null;
        const decision = session._devSellCtrl.shouldDevSell("buy", 0.05, true, gs);
        if (decision?.shouldSell) {
          const devSellDelay = decision.delay;
          const devSellPct = decision.sellPct;
          // Schedule dev sell after human-like delay (non-blocking)
          setTimeout(async () => {
            if (!session.running) return;
            try {
              let g2, fc2;
              try { g2 = await this.onlineSdk.fetchGlobal(); fc2 = await this.onlineSdk.fetchFeeConfig(); } catch { return; }
              // Dev wallet = masterKp. Create a temporary wallet object for _executeSell
              const devWalletObj = { keypair: session.masterKp, pubkey: session.masterKp.publicKey.toBase58(), role: "dev", trades: [] };
              const result = await this._executeSell(devWalletObj, mint, g2, fc2, devSellPct);
              if (result.ok) {
                session._devSellCtrl.recordSell(devSellPct);
                session.tradeCount++;
                session.totalSolRecovered += result.solOut || 0;
                this.emit("trade", { ca, role: "dev-profit", side: "sell", sol: result.solOut, sig: result.sig });
                console.log(`[DEV-SELL] Dev took ${(devSellPct * 100).toFixed(1)}% profit -> ${(result.solOut || 0).toFixed(4)} SOL (total: ${session._devSellCtrl.summary().totalSoldPct}%)`);
              }
            } catch (e) { console.error("[DEV-SELL] Failed:", e.message); }
          }, devSellDelay);
        }
      }

      // Gap between trades: 1-3 seconds (fast enough to paint chart, slow enough to look organic)
      const baseGap = 1000 + (1 - intensity) * 2000; // 1s at peak, 3s at edges
      const jitter = Math.random() * 1000;
      await sleep(baseGap + jitter);
    }

    console.log(`[VOL] Parabola complete: ${totalSteps} steps, ${session.tradeCount} total trades`);
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

  // Jito bundle — up to 5 transactions in one block, atomic (all land or none)
  async _sendJitoBundle(transactions, tipLamports = 10000) {
    const JITO_BUNDLE_ENDPOINTS = [
      "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
      "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
      "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
    ];
    const endpoint = JITO_BUNDLE_ENDPOINTS[Math.floor(Math.random() * JITO_BUNDLE_ENDPOINTS.length)];
    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");

    // Serialize all transactions
    const base58Txs = [];
    for (const { tx, signers } of transactions) {
      tx.recentBlockhash = blockhash;
      tx.feePayer = signers[0].publicKey;
      tx.sign(...signers);
      base58Txs.push(bs58.encode(tx.serialize()));
    }

    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendBundle", params: [base58Txs] }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) {
        const data = await r.json();
        if (data.result) {
          console.log(`[JITO] Bundle sent: ${base58Txs.length} txs | bundle_id: ${data.result}`);
          return { ok: true, bundleId: data.result, txCount: base58Txs.length };
        }
        if (data.error) console.warn(`[JITO] Bundle error:`, data.error);
      }
    } catch (e) {
      console.warn(`[JITO] Bundle failed (${endpoint.split("/")[2]}):`, e.message);
    }
    return { ok: false };
  }

  // Atomic close — sell all fleet wallets in one Jito bundle (same block)
  async atomicSellAll(ca) {
    const session = this.sessions.get(ca);
    if (!session) throw new Error(`No session for ${ca}`);

    let global, feeConfig;
    try { global = await this.onlineSdk.fetchGlobal(); feeConfig = await this.onlineSdk.fetchFeeConfig(); } catch {}
    if (!global || !feeConfig) throw new Error("Cannot fetch global/feeConfig");

    // Build sell transactions for every wallet that holds tokens
    const sellTxs = [];
    for (const wallet of session.fleetWallets) {
      try {
        const ata = getAssociatedTokenAddressSync(session.mint, wallet.keypair.publicKey, true);
        const account = await getAccount(this.connection, ata);
        const tokenBalance = new BN(account.amount.toString());
        if (tokenBalance.isZero()) continue;

        // Build the sell transaction (same logic as _executeSell but don't send)
        const sellState = await this.onlineSdk.fetchSellState(session.mint, wallet.keypair.publicKey);
        const tx = await this.onlineSdk.getSellTransaction(
          wallet.keypair.publicKey, session.mint, global, feeConfig,
          sellState.bondingCurveAccountInfo, sellState.bondingCurve,
          tokenBalance, BigInt(0), // 0 minSolOut for speed
          { units: 150000, microLamports: 100000 }
        );
        sellTxs.push({ tx, signers: [wallet.keypair], wallet, tokens: tokenBalance });
      } catch (e) {
        console.warn(`[ATOMIC] ${wallet.role} skip:`, e.message);
      }
    }

    if (sellTxs.length === 0) return { ok: true, sold: 0, message: "No tokens to sell" };

    console.log(`[ATOMIC] Selling ${sellTxs.length} wallets in one block for ${ca.slice(0, 8)}...`);

    // Jito bundles max 5 txs — split into bundles if needed
    let totalSold = 0;
    const BATCH = 5;
    for (let i = 0; i < sellTxs.length; i += BATCH) {
      const batch = sellTxs.slice(i, i + BATCH);
      const bundleResult = await this._sendJitoBundle(batch);

      if (bundleResult.ok) {
        console.log(`[ATOMIC] Bundle landed: ${batch.length} sells | id: ${bundleResult.bundleId}`);
        totalSold += batch.length;
        // Update accounting
        for (const { wallet } of batch) {
          session.totalSolRecovered += 0; // actual amount unknown until confirmed
        }
      } else {
        // Fallback: send individually (slow but reliable)
        console.warn(`[ATOMIC] Bundle failed, falling back to sequential...`);
        for (const { tx, signers, wallet } of batch) {
          try {
            const sig = await sendAndConfirmTransaction(this.connection, tx, signers, { skipPreflight: true, commitment: "confirmed", maxRetries: 3 });
            totalSold++;
            console.log(`[ATOMIC] Fallback sell OK: ${wallet.role} | sig: ${sig.toString().slice(0, 12)}`);
          } catch (e) {
            console.error(`[ATOMIC] Fallback sell failed: ${wallet.role}:`, e.message);
          }
        }
      }
    }

    return { ok: true, sold: totalSold, total: sellTxs.length, atomic: totalSold === sellTxs.length };
  }

  // Single-tx Jito send with MEV protection (existing, for individual trades)
  async _sendWithJito(tx, signers) {
    const JITO_ENDPOINTS = [
      "https://mainnet.block-engine.jito.wtf/api/v1/transactions",
      "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/transactions",
      "https://ny.mainnet.block-engine.jito.wtf/api/v1/transactions",
    ];
    const endpoint = JITO_ENDPOINTS[Math.floor(Math.random() * JITO_ENDPOINTS.length)];
    
    tx.recentBlockhash = (await this.connection.getLatestBlockhash("confirmed")).blockhash;
    tx.feePayer = signers[0].publicKey;
    tx.sign(...signers);
    const serialized = tx.serialize();
    const base58Tx = bs58.encode(serialized);
    
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [base58Tx] }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const data = await r.json();
        if (data.result) {
          // Wait for confirmation
          await this.connection.confirmTransaction(data.result, "confirmed");
          return data.result;
        }
      }
    } catch (e) {
      console.warn(`[FLEET] Jito send failed (${endpoint.split("/")[2]}): ${e.message} — falling back to standard`);
    }
    // Fallback to standard send
    return await sendAndConfirmTransaction(this.connection, tx, signers, { skipPreflight: true, commitment: "confirmed", maxRetries: 3 });
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
    // Use Jito for MEV protection on buys (most vulnerable to sandwich)
    const sig = await this._sendWithJito(tx, [keypair]);
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
    // Standard send for sells (less vulnerable to MEV, speed matters more)
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

    // ── ATOMIC SELL: all wallets in one Jito bundle (same block) ──
    let atomicWorked = false;
    if (global && feeConfig) {
      try {
        const atomicResult = await this.atomicSellAll(ca);
        if (atomicResult.ok && atomicResult.sold > 0) {
          atomicWorked = true;
          console.log(`[FLEET] Atomic close: ${atomicResult.sold}/${atomicResult.total} sold in ${atomicResult.atomic ? "one block" : "fallback mode"}`);
          // Wait for confirmation
          await sleep(2000);
          // Update balances
          for (const wallet of session.fleetWallets) {
            try {
              const bal = await this.connection.getBalance(wallet.keypair.publicKey);
              wallet.solRecovered = bal / LAMPORTS_PER_SOL;
              session.totalSolRecovered += wallet.solRecovered;
            } catch {}
          }
        }
      } catch (e) {
        console.warn(`[FLEET] Atomic sell failed, falling back to sequential:`, e.message);
      }
    }

    // ── FALLBACK: sequential sells (if atomic failed or partial) ──
    if (!atomicWorked) {
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
    } // end if(!atomicWorked)
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
