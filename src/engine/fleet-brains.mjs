/**
 * ════════════════════════════════════════════════════════════════
 * FLEET TRADING v6 — AXIOMATIC WALLET BRAINS
 * ════════════════════════════════════════════════════════════════
 *
 * AXIOMS (non-negotiable design principles):
 *
 * 1. EVERY WALLET IS AN INDEPENDENT ACTOR
 *    Each wallet has its own personality, risk tolerance, timing,
 *    and decision function. No two wallets should ever look
 *    coordinated on-chain. If a human can't tell whether wallet
 *    #3 is ours or a random degen, we've succeeded.
 *
 * 2. VOLUME IS OXYGEN — BUT ONLY WHEN WE'RE ALONE
 *    When no external wallets are trading, we must paint the chart.
 *    When external wallets start buying, we COOL OFF. Let them
 *    create the volume. Our job shifts from "create activity" to
 *    "sell into their activity."
 *
 * 3. THE BONDING CURVE IS THE ONLY TRUTH
 *    pump.fun bonding curve has a fixed graduation point (~$69K MC,
 *    ~85 SOL in reserves). Every action should push toward OR
 *    profit from this graduation. If we can't bond it, we need
 *    to exit before the dump.
 *
 * 4. DEV BUY IS THE FOUNDATION — DEV SELL IS PROFIT
 *    Dev buy creates the initial position and first candle.
 *    Dev never sells first. Dev sells LAST, after snipers and
 *    fleet have distributed. Dev hold creates confidence.
 *
 * 5. SELL INTO DEMAND, NEVER INTO VACUUM
 *    GameState tells us when real buyers are active. We only
 *    sell when buy pressure > 45% or unique external buyers ≥ 2.
 *    If no demand materializes, we hold or volume-trade.
 *
 * 6. INFORMATION ASYMMETRY IS OUR EDGE
 *    We know our own wallets. We know the GameState. External
 *    traders don't know which wallets are ours. Use this:
 *    - Our "sells" create dip-buy opportunities for externals
 *    - Our "buys" after dips look like confident accumulation
 *
 * 7. TIME PRESSURE CREATES URGENCY
 *    Pump.fun tokens that don't move in 10 minutes die. We have
 *    a finite window. Volume must peak in the first 3-5 minutes,
 *    then taper as organics (hopefully) take over.
 *
 * ════════════════════════════════════════════════════════════════
 * WALLET BRAIN PERSONALITIES
 * ════════════════════════════════════════════════════════════════
 *
 * Each wallet runs an independent decision loop that observes:
 *   - Its own position (tokens held, SOL spent, P&L)
 *   - GameState (external buys, sells, whale alerts, momentum)
 *   - Time elapsed since launch
 *   - Current bonding curve progress
 *
 * And decides INDEPENDENTLY whether to:
 *   - BUY (and how much)
 *   - SELL (and how much)
 *   - HOLD (do nothing this tick)
 *   - VOLUME_TRADE (small buy-then-sell to paint activity)
 *
 * Personality traits (randomized per wallet at creation):
 *   - aggression:  0.0-1.0 (how fast they buy/sell)
 *   - patience:    0.0-1.0 (how long they wait for signals)
 *   - greed:       0.0-1.0 (how much profit they want before selling)
 *   - fearFactor:  0.0-1.0 (how fast they panic-sell on dump)
 *   - conviction:  0.0-1.0 (how much of budget they deploy)
 *   - tickSize:    randomized buy/sell amounts (never round numbers)
 *
 * ════════════════════════════════════════════════════════════════
 */

// Personality archetypes (each wallet gets ONE + random variance)
const BRAINS = [
  {
    id: "degen_aper",
    desc: "Buys fast, sells on first sign of dump. Classic CT degen.",
    aggression: 0.9, patience: 0.1, greed: 0.3, fearFactor: 0.8, conviction: 0.85,
    buyStyle: "immediate",     // buys ASAP after launch
    sellTrigger: "momentum",   // sells when momentum turns negative
    volumeRole: "none",        // doesn't wash trade
    holdPct: 0.05,             // keeps 5% moonbag
  },
  {
    id: "accumulator",
    desc: "Buys in small chunks over time. Looks like genuine interest.",
    aggression: 0.3, patience: 0.8, greed: 0.5, fearFactor: 0.3, conviction: 0.7,
    buyStyle: "dca",           // splits buy into 3-4 chunks over 2-3 minutes
    sellTrigger: "profit_target",  // sells at 2-3x
    volumeRole: "light",      // occasional small trades
    holdPct: 0.15,
  },
  {
    id: "whale_bluffer",
    desc: "Makes one big buy to create a green candle spike. Sells gradually.",
    aggression: 0.7, patience: 0.4, greed: 0.6, fearFactor: 0.4, conviction: 0.9,
    buyStyle: "single_large",  // one big candle
    sellTrigger: "time",       // sells after fixed hold period
    volumeRole: "none",
    holdPct: 0.10,
  },
  {
    id: "volume_painter",
    desc: "Primary job is to create chart activity. Small rapid buys/sells.",
    aggression: 0.5, patience: 0.2, greed: 0.2, fearFactor: 0.5, conviction: 0.4,
    buyStyle: "micro_burst",   // tiny rapid buys
    sellTrigger: "volume_done", // sells when volume phase ends
    volumeRole: "primary",     // main volume generator
    holdPct: 0.0,
  },
  {
    id: "momentum_rider",
    desc: "Waits for external buys, then rides the wave. Sells into FOMO.",
    aggression: 0.4, patience: 0.9, greed: 0.7, fearFactor: 0.6, conviction: 0.6,
    buyStyle: "reactive",      // only buys AFTER seeing external buys
    sellTrigger: "fomo_peak",  // sells when buy velocity peaks then slows
    volumeRole: "none",
    holdPct: 0.20,
  },
  {
    id: "sniper",
    desc: "Buys in first 3 seconds. Gets the best price. Sells into first demand.",
    aggression: 1.0, patience: 0.0, greed: 0.4, fearFactor: 0.7, conviction: 0.95,
    buyStyle: "instant",       // <3 second buy
    sellTrigger: "first_demand", // sells as soon as real buyers appear
    volumeRole: "none",
    holdPct: 0.0,
  },
  {
    id: "diamond_hands",
    desc: "Buys early, holds forever. Creates holder count + reduces circulating supply.",
    aggression: 0.5, patience: 1.0, greed: 1.0, fearFactor: 0.0, conviction: 0.5,
    buyStyle: "early_quiet",   // buys in first 30s, small amount
    sellTrigger: "never",      // only sells on manual close
    volumeRole: "none",
    holdPct: 1.0,              // holds everything
  },
];

// Add random variance to each personality
function createBrain(archetype, budgetSol) {
  const variance = () => (Math.random() - 0.5) * 0.15; // ±7.5%
  const clamp = (v) => Math.max(0, Math.min(1, v));
  
  return {
    ...archetype,
    aggression: clamp(archetype.aggression + variance()),
    patience: clamp(archetype.patience + variance()),
    greed: clamp(archetype.greed + variance()),
    fearFactor: clamp(archetype.fearFactor + variance()),
    conviction: clamp(archetype.conviction + variance()),
    budget: budgetSol,
    spent: 0,
    recovered: 0,
    tokensHeld: false,
    lastAction: null,
    lastActionTime: 0,
    cooldown: 0,      // ticks to wait before next action
    phase: "waiting",  // waiting → buying → holding → selling → done
    buyChunksRemaining: archetype.buyStyle === "dca" ? 3 + Math.floor(Math.random() * 2) : 1,
  };
}

/**
 * ════════════════════════════════════════════════════════════════
 * WALLET DECISION FUNCTION
 * 
 * Called every tick (5-15s). Returns the action this wallet takes.
 * Each wallet sees the same GameState but interprets it differently
 * based on its personality.
 * ════════════════════════════════════════════════════════════════
 */
function walletDecide(brain, gameState, elapsedSeconds, bondingPct) {
  // Cooldown check
  if (brain.cooldown > 0) {
    brain.cooldown--;
    return { action: "hold", reason: "cooldown" };
  }

  const gs = gameState || {};
  const hasTokens = brain.tokensHeld;
  const budgetLeft = brain.budget - brain.spent;
  const elapsed = elapsedSeconds;

  // ══ PHASE: WAITING → should we start buying? ══
  if (brain.phase === "waiting") {
    switch (brain.buyStyle) {
      case "instant":
        // Sniper: buy immediately
        if (elapsed > 2) { brain.phase = "buying"; return { action: "buy", amount: budgetLeft * brain.conviction, reason: "sniper_entry" }; }
        break;
      case "immediate":
        // Degen: buy in first 5-15s
        if (elapsed > 3 + Math.random() * 12) { brain.phase = "buying"; return { action: "buy", amount: budgetLeft * brain.conviction, reason: "degen_ape" }; }
        break;
      case "single_large":
        // Whale: wait 15-30s then one big buy
        if (elapsed > 15 + Math.random() * 15) { brain.phase = "buying"; return { action: "buy", amount: budgetLeft * brain.conviction, reason: "whale_entry" }; }
        break;
      case "dca":
        // Accumulator: start buying in chunks after 10-20s
        if (elapsed > 10 + Math.random() * 10) { brain.phase = "buying"; }
        break;
      case "micro_burst":
        // Volume painter: start after 30s
        if (elapsed > 30 + Math.random() * 20) { brain.phase = "buying"; }
        break;
      case "reactive":
        // Momentum rider: only buy AFTER external buyers appear
        if ((gs.uniqueBuyers || 0) >= 1 && (gs.momentum || 0) > 0) {
          brain.phase = "buying";
          return { action: "buy", amount: budgetLeft * brain.conviction * 0.5, reason: "reactive_entry" };
        }
        // Timeout: if no externals after 90s, buy anyway (smaller)
        if (elapsed > 90) { brain.phase = "buying"; return { action: "buy", amount: budgetLeft * 0.3, reason: "reactive_timeout" }; }
        break;
      case "early_quiet":
        // Diamond hands: small buy in first 30s
        if (elapsed > 5 + Math.random() * 25) { brain.phase = "buying"; return { action: "buy", amount: budgetLeft * 0.5, reason: "diamond_entry" }; }
        break;
    }
    return { action: "hold", reason: "waiting" };
  }

  // ══ PHASE: BUYING → continue DCA or hold ══
  if (brain.phase === "buying") {
    if (brain.buyStyle === "dca" && brain.buyChunksRemaining > 0 && budgetLeft > 0.01) {
      brain.buyChunksRemaining--;
      const chunkSize = budgetLeft / (brain.buyChunksRemaining + 1);
      // Add human-like variance to timing
      brain.cooldown = 2 + Math.floor(Math.random() * 4); // 10-30s between chunks
      brain.phase = brain.buyChunksRemaining > 0 ? "buying" : "holding";
      return { action: "buy", amount: chunkSize * (0.8 + Math.random() * 0.4), reason: "dca_chunk" };
    }
    if (brain.buyStyle === "micro_burst" && budgetLeft > 0.005) {
      // Volume painter: tiny rapid buys
      const micro = Math.min(budgetLeft, 0.005 + Math.random() * 0.01);
      brain.cooldown = 1; // fast
      return { action: "buy", amount: micro, reason: "volume_buy" };
    }
    brain.phase = "holding";
  }

  // ══ PHASE: HOLDING → should we sell? ══
  if (brain.phase === "holding" && hasTokens) {
    const momentum = gs.momentum || 0;
    const buyPressure = gs.buyPressure || 0;
    const externalBuyers = gs.uniqueBuyers || 0;
    const whaleAlert = gs.whaleAlert || false;
    
    // ── AXIOM 2: Cool off when externals are buying ──
    // If external wallets are active and momentum is positive, HOLD.
    // Let them push the price. We sell into their demand later.
    if (externalBuyers >= 2 && momentum > 0.1 && !brain.sellTrigger !== "first_demand") {
      return { action: "hold", reason: "externals_active_hold" };
    }

    // ── MINIMUM PROFIT GUARD ──
    // Don't sell at tiny margins that get eaten by tx fees + platform cut.
    // Tx fees: ~0.002-0.005 SOL per trade (buy+sell = 2 txs).
    // Platform cut: 25% of profit on free tier.
    // Rent: ~0.002 SOL for token accounts.
    // Need at least ~12% gross profit to net positive after all costs.
    const MIN_PROFIT_BONDING_PCT = 15; // Don't trigger profit-taking below this bonding % progress
    const isAboveBreakeven = bondingPct >= MIN_PROFIT_BONDING_PCT;

    // ── AXIOM 5: Sell into demand, never into vacuum ──
    switch (brain.sellTrigger) {
      case "momentum":
        // Degen: sells when momentum turns negative — but only if above breakeven
        if (momentum < -0.05 * (1 - brain.fearFactor) && isAboveBreakeven) {
          brain.phase = "selling";
          return { action: "sell", percent: (1 - brain.holdPct) * 100, reason: "momentum_dump" };
        }
        break;
      case "profit_target":
        // Accumulator: sells at 2-3x (checks via bonding progress)
        // Raised from 40+ to 55+ to ensure meaningful profit above fees/rent
        if (bondingPct > 55 + brain.greed * 25 && isAboveBreakeven) {
          brain.phase = "selling";
          return { action: "sell", percent: 50, reason: "profit_target_1" };
        }
        break;
      case "time":
        // Whale: sells after hold period (60-120s)
        if (elapsed > 60 + brain.patience * 60) {
          brain.phase = "selling";
          return { action: "sell", percent: (1 - brain.holdPct) * 100, reason: "time_exit" };
        }
        break;
      case "first_demand":
        // Sniper: sells as soon as real buyers appear
        if (externalBuyers >= 1 && buyPressure > 30) {
          brain.phase = "selling";
          return { action: "sell", percent: 100, reason: "sniper_exit" };
        }
        break;
      case "fomo_peak":
        // Momentum rider: sells when buy velocity peaks then slows
        if (externalBuyers >= 3 && momentum < 0) {
          brain.phase = "selling";
          return { action: "sell", percent: (1 - brain.holdPct) * 100, reason: "fomo_peak_exit" };
        }
        break;
      case "volume_done":
        // Volume painter: sells everything when volume phase ends
        if (elapsed > 300) { // 5 min
          brain.phase = "selling";
          return { action: "sell", percent: 100, reason: "volume_complete" };
        }
        break;
      case "never":
        // Diamond hands: never sells (only manual close)
        return { action: "hold", reason: "diamond_holding" };
    }

    // Emergency: if momentum deeply negative AND we have fearFactor, panic
    if (momentum < -0.3 && brain.fearFactor > 0.5) {
      brain.phase = "selling";
      return { action: "sell", percent: 80, reason: "panic_sell" };
    }

    // ── AXIOM 6: Volume when alone ──
    // If we're holding and there are NO external traders, generate activity
    if (brain.volumeRole === "primary" && externalBuyers === 0 && budgetLeft > 0.005) {
      return { action: "volume_trade", amount: 0.005 + Math.random() * 0.01, reason: "painting_chart" };
    }
    if (brain.volumeRole === "light" && externalBuyers === 0 && Math.random() < 0.2 && budgetLeft > 0.005) {
      return { action: "volume_trade", amount: 0.003 + Math.random() * 0.007, reason: "light_volume" };
    }

    return { action: "hold", reason: "holding_position" };
  }

  // ══ PHASE: SELLING → continue selling ══
  if (brain.phase === "selling" && hasTokens) {
    // Stagger sells: don't dump all at once
    brain.cooldown = 2 + Math.floor(Math.random() * 3);
    return { action: "sell", percent: 30 + Math.random() * 40, reason: "staggered_exit" };
  }

  // ══ PHASE: DONE ══
  if (!hasTokens && brain.spent > 0) {
    brain.phase = "done";
  }

  return { action: "hold", reason: brain.phase };
}

/**
 * ════════════════════════════════════════════════════════════════
 * FLEET ORCHESTRATOR — runs all wallet brains in parallel
 * 
 * Main loop (every 5-15 seconds):
 *   1. Snapshot GameState
 *   2. For each wallet, call walletDecide()
 *   3. Execute actions with human-like timing jitter
 *   4. Update wallet state
 *   5. Check if session should end
 * 
 * Volume ramping logic (AXIOM 2):
 *   externalBuyers = 0  → volume HIGH (we are the market)
 *   externalBuyers = 1  → volume MEDIUM (someone found us)
 *   externalBuyers ≥ 2  → volume OFF (they ARE the market)
 *   externalBuyers ≥ 3  → START SELLING (exit into their demand)
 * ════════════════════════════════════════════════════════════════
 */
async function runFleetBrains(session, executeBuy, executeSell, executeVolumeTrade) {
  const { fleetWallets, gameState } = session;
  const startTime = Date.now();

  // Assign brains to wallets
  const availableBrains = [...BRAINS];
  for (const wallet of fleetWallets) {
    // Pick a brain archetype (prioritize coverage of all types)
    const brainIdx = fleetWallets.indexOf(wallet) % availableBrains.length;
    wallet.brain = createBrain(availableBrains[brainIdx], wallet.allocation);
    console.log(`[FLEET] [${wallet.role}] Brain: ${wallet.brain.id} | agg:${wallet.brain.aggression.toFixed(2)} pat:${wallet.brain.patience.toFixed(2)} greed:${wallet.brain.greed.toFixed(2)}`);
  }

  // Main decision loop
  while (session.running) {
    const elapsed = (Date.now() - startTime) / 1000;
    const gs = gameState?.alive ? gameState.snapshot() : {};
    const bondingPct = gs.bondingPct || 0;

    for (const wallet of fleetWallets) {
      if (!wallet.funded || !wallet.brain) continue;

      const decision = walletDecide(wallet.brain, gs, elapsed, bondingPct);

      if (decision.action === "buy" && decision.amount > 0.005) {
        // Human-like jitter: 0.5-3s random delay
        const jitter = 500 + Math.random() * 2500;
        await new Promise(r => setTimeout(r, jitter));
        
        // Never buy round amounts
        const amount = decision.amount * (0.93 + Math.random() * 0.14);
        
        try {
          const result = await executeBuy(wallet, amount);
          if (result?.ok) {
            wallet.brain.spent += amount;
            wallet.brain.tokensHeld = true;
            wallet.brain.lastAction = "buy";
            wallet.brain.lastActionTime = Date.now();
            session.tradeCount++;
            session.totalSolSpent += amount;
            console.log(`[FLEET] [${wallet.brain.id}] BUY ${amount.toFixed(4)} SOL — ${decision.reason}`);
          }
        } catch (e) {
          console.error(`[FLEET] [${wallet.brain.id}] Buy failed: ${e.message}`);
        }
      }

      else if (decision.action === "sell" && decision.percent > 0) {
        const jitter = 1000 + Math.random() * 4000;
        await new Promise(r => setTimeout(r, jitter));
        
        try {
          const pct = Math.min(100, decision.percent * (0.9 + Math.random() * 0.2));
          const result = await executeSell(wallet, pct / 100);
          if (result?.ok) {
            wallet.brain.recovered += result.solOut || 0;
            if (pct >= 95) wallet.brain.tokensHeld = false;
            wallet.brain.lastAction = "sell";
            wallet.brain.lastActionTime = Date.now();
            session.tradeCount++;
            session.totalSolRecovered += result.solOut || 0;
            console.log(`[FLEET] [${wallet.brain.id}] SELL ${pct.toFixed(0)}% — ${decision.reason} → ${(result.solOut||0).toFixed(4)} SOL`);
          }
        } catch (e) {
          console.error(`[FLEET] [${wallet.brain.id}] Sell failed: ${e.message}`);
        }
      }

      else if (decision.action === "volume_trade" && decision.amount > 0) {
        const jitter = 500 + Math.random() * 1500;
        await new Promise(r => setTimeout(r, jitter));
        
        try {
          await executeVolumeTrade(wallet, decision.amount);
          console.log(`[FLEET] [${wallet.brain.id}] VOL ${decision.amount.toFixed(4)} — ${decision.reason}`);
        } catch {}
      }
    }

    // Log fleet state every 30s
    if (Math.floor(elapsed) % 30 === 0 && Math.floor(elapsed) > 0) {
      const active = fleetWallets.filter(w => w.brain?.phase !== "done").length;
      const extBuyers = gs.uniqueBuyers || 0;
      console.log(`[FLEET] t=${Math.round(elapsed)}s | ${active}/${fleetWallets.length} active | ext:${extBuyers} | mom:${(gs.momentum||0).toFixed(2)} | bp:${gs.buyPressure||0}%`);
    }

    // Tick interval: 5-15s (faster when more action needed)
    const tickInterval = (gs.uniqueBuyers || 0) > 2 ? 8000 + Math.random() * 7000 : 5000 + Math.random() * 5000;
    await new Promise(r => setTimeout(r, tickInterval));

    // Check if all wallets are done
    const allDone = fleetWallets.every(w => !w.brain || w.brain.phase === "done");
    if (allDone) {
      console.log(`[FLEET] All wallets done — session complete`);
      session.phase = "complete";
      break;
    }
  }
}

export { BRAINS, createBrain, walletDecide, runFleetBrains };
export default runFleetBrains;
