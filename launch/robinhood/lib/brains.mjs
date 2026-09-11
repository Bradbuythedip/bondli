// ═══ Wallet brains: independent actors with personalities, ported from engine/fleet-brains.mjs ═══
// The axioms are unchanged (every wallet is an independent actor; volume is oxygen only when we are
// alone; the curve is the only truth; the dev buys first and sells last; sell into demand, never into
// a vacuum; information asymmetry is the edge; time pressure). Amounts are ETH, thresholds scale with
// the wallet's budget instead of pump.fun's absolute SOL floors, bonding progress is the PONS curve's
// real-reserve progress, and randomness comes from the session so a simulated run replays.
export const BRAINS = [
  { id: "degen_aper",     desc: "Buys fast, sells on first sign of dump.",               aggression: 0.9, patience: 0.1, greed: 0.3, fearFactor: 0.8, conviction: 0.85, buyStyle: "immediate",    sellTrigger: "momentum",      volumeRole: "none",    holdPct: 0.05 },
  { id: "accumulator",    desc: "Buys in small chunks over time.",                        aggression: 0.3, patience: 0.8, greed: 0.5, fearFactor: 0.3, conviction: 0.7,  buyStyle: "dca",          sellTrigger: "profit_target", volumeRole: "light",   holdPct: 0.15 },
  { id: "whale_bluffer",  desc: "One big candle, then sells gradually.",                  aggression: 0.7, patience: 0.4, greed: 0.6, fearFactor: 0.4, conviction: 0.9,  buyStyle: "single_large", sellTrigger: "time",          volumeRole: "none",    holdPct: 0.10 },
  { id: "volume_painter", desc: "Paints the chart with small rapid trades.",              aggression: 0.5, patience: 0.2, greed: 0.2, fearFactor: 0.5, conviction: 0.4,  buyStyle: "micro_burst",  sellTrigger: "volume_done",   volumeRole: "primary", holdPct: 0.0 },
  { id: "momentum_rider", desc: "Waits for external buys, rides, sells into FOMO.",       aggression: 0.4, patience: 0.9, greed: 0.7, fearFactor: 0.6, conviction: 0.6,  buyStyle: "reactive",     sellTrigger: "fomo_peak",     volumeRole: "none",    holdPct: 0.20 },
  { id: "sniper",         desc: "First seconds in, first demand out.",                     aggression: 1.0, patience: 0.0, greed: 0.4, fearFactor: 0.7, conviction: 0.95, buyStyle: "instant",      sellTrigger: "first_demand",  volumeRole: "none",    holdPct: 0.0 },
  { id: "diamond_hands",  desc: "Buys early, holds; a holder on the list, supply off it.", aggression: 0.5, patience: 1.0, greed: 1.0, fearFactor: 0.0, conviction: 0.5,  buyStyle: "early_quiet",  sellTrigger: "never",         volumeRole: "none",    holdPct: 1.0 },
];

export function createBrain(archetype, budgetEth, rng = Math.random) {
  const variance = () => (rng() - 0.5) * 0.15;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return { ...archetype, aggression: clamp(archetype.aggression + variance()), patience: clamp(archetype.patience + variance()), greed: clamp(archetype.greed + variance()), fearFactor: clamp(archetype.fearFactor + variance()), conviction: clamp(archetype.conviction + variance()), budget: budgetEth, spent: 0, recovered: 0, tokensHeld: false, lastAction: null, lastActionTime: 0, cooldown: 0, phase: "waiting", buyChunksRemaining: archetype.buyStyle === "dca" ? 3 + Math.floor(rng() * 2) : 1, _entryDelay: null };
}

/**
 * One tick's decision for one wallet. `gs` is a GameState snapshot (or {}), `bondingPct` 0..100.
 * `minTrade` is the smallest trade worth its fees on this venue (ETH).
 */
export function walletDecide(brain, gs, elapsedSeconds, bondingPct, rng = Math.random, minTrade = 0.0005) {
  if (brain.cooldown > 0) { brain.cooldown--; return { action: "hold", reason: "cooldown" }; }
  const g = gs || {}; const hasTokens = brain.tokensHeld; const budgetLeft = brain.budget - brain.spent; const elapsed = elapsedSeconds;
  const micro = () => Math.max(minTrade, brain.budget * (0.01 + rng() * 0.02)); // 1-3% of budget: the painter's brush
  // entry timing is drawn once per wallet, not re-rolled every tick (re-rolling biases early entries)
  if (brain._entryDelay == null) brain._entryDelay = { immediate: 3 + rng() * 12, single_large: 15 + rng() * 15, dca: 10 + rng() * 10, micro_burst: 30 + rng() * 20, early_quiet: 5 + rng() * 25 }[brain.buyStyle] ?? 0;

  if (brain.phase === "waiting") {
    switch (brain.buyStyle) {
      case "instant": if (elapsed > 2) { brain.phase = "buying"; return { action: "buy", amount: budgetLeft * brain.conviction, reason: "sniper_entry" }; } break;
      case "immediate": if (elapsed > brain._entryDelay) { brain.phase = "buying"; return { action: "buy", amount: budgetLeft * brain.conviction, reason: "degen_ape" }; } break;
      case "single_large": if (elapsed > brain._entryDelay) { brain.phase = "buying"; return { action: "buy", amount: budgetLeft * brain.conviction, reason: "whale_entry" }; } break;
      case "dca": if (elapsed > brain._entryDelay) brain.phase = "buying"; break;
      case "micro_burst": if (elapsed > brain._entryDelay) brain.phase = "buying"; break;
      case "reactive":
        if ((g.uniqueBuyers || 0) >= 1 && (g.momentum || 0) > 0) { brain.phase = "buying"; return { action: "buy", amount: budgetLeft * brain.conviction * 0.5, reason: "reactive_entry" }; }
        if (elapsed > 90) { brain.phase = "buying"; return { action: "buy", amount: budgetLeft * 0.3, reason: "reactive_timeout" }; }
        break;
      case "early_quiet": if (elapsed > brain._entryDelay) { brain.phase = "buying"; return { action: "buy", amount: budgetLeft * 0.5, reason: "diamond_entry" }; } break;
    }
    return { action: "hold", reason: "waiting" };
  }

  if (brain.phase === "buying") {
    if (brain.buyStyle === "dca" && brain.buyChunksRemaining > 0 && budgetLeft > minTrade * 2) {
      brain.buyChunksRemaining--;
      const chunk = budgetLeft / (brain.buyChunksRemaining + 1);
      brain.cooldown = 2 + Math.floor(rng() * 4);
      brain.phase = brain.buyChunksRemaining > 0 ? "buying" : "holding";
      return { action: "buy", amount: chunk * (0.8 + rng() * 0.4), reason: "dca_chunk" };
    }
    if (brain.buyStyle === "micro_burst" && budgetLeft > minTrade) { brain.cooldown = 1; return { action: "buy", amount: Math.min(budgetLeft, micro()), reason: "volume_buy" }; }
    brain.phase = "holding";
  }

  if (brain.phase === "holding" && hasTokens) {
    const momentum = g.momentum || 0, buyPressure = g.buyPressure || 0, externalBuyers = g.uniqueBuyers || 0;
    // AXIOM 2: cool off while externals push the price; we sell into their demand later
    if (externalBuyers >= 2 && momentum > 0.002 && brain.sellTrigger !== "first_demand") return { action: "hold", reason: "externals_active_hold" };
    // profit guard: the curve fee is 1% each side and the creator tax on top; below ~15% of the way to
    // graduation a profit-taking sell barely clears the round trip
    const MIN_PROFIT_BONDING_PCT = 15; const isAboveBreakeven = bondingPct >= MIN_PROFIT_BONDING_PCT;
    switch (brain.sellTrigger) {
      case "momentum": if (momentum < -0.0005 * (1 - brain.fearFactor) && isAboveBreakeven) { brain.phase = "selling"; return { action: "sell", percent: (1 - brain.holdPct) * 100, reason: "momentum_dump" }; } break;
      case "profit_target": if (bondingPct > 55 + brain.greed * 25 && isAboveBreakeven) { brain.phase = "selling"; return { action: "sell", percent: 50, reason: "profit_target_1" }; } break;
      case "time": if (elapsed > 60 + brain.patience * 60) { brain.phase = "selling"; return { action: "sell", percent: (1 - brain.holdPct) * 100, reason: "time_exit" }; } break;
      case "first_demand": if (externalBuyers >= 1 && buyPressure > 30) { brain.phase = "selling"; return { action: "sell", percent: 100, reason: "sniper_exit" }; } break;
      case "fomo_peak": if (externalBuyers >= 3 && momentum < 0) { brain.phase = "selling"; return { action: "sell", percent: (1 - brain.holdPct) * 100, reason: "fomo_peak_exit" }; } break;
      case "volume_done": if (elapsed > 300) { brain.phase = "selling"; return { action: "sell", percent: 100, reason: "volume_complete" }; } break;
      case "never": return { action: "hold", reason: "diamond_holding" };
    }
    if (momentum < -0.003 && brain.fearFactor > 0.5) { brain.phase = "selling"; return { action: "sell", percent: 80, reason: "panic_sell" }; }
    // AXIOM 6: volume when alone
    if (brain.volumeRole === "primary" && externalBuyers === 0 && budgetLeft > minTrade) return { action: "volume_trade", amount: micro(), reason: "painting_chart" };
    if (brain.volumeRole === "light" && externalBuyers === 0 && rng() < 0.2 && budgetLeft > minTrade) return { action: "volume_trade", amount: micro() * 0.7, reason: "light_volume" };
    return { action: "hold", reason: "holding_position" };
  }

  if (brain.phase === "selling" && hasTokens) { brain.cooldown = 2 + Math.floor(rng() * 3); return { action: "sell", percent: 30 + rng() * 40, reason: "staggered_exit" }; }
  if (!hasTokens && brain.spent > 0) brain.phase = "done";
  return { action: "hold", reason: brain.phase };
}

/**
 * Run every wallet's brain until all are done or the session stops. Executors return { ok, ethOut? }.
 * The tick is 5-15 s of session time; jitter and never-round amounts come from the session's rng.
 */
export async function runFleetBrains(session, executeBuy, executeSell, executeVolumeTrade, { minTrade = 0.0005 } = {}) {
  const { fleetWallets, gameState, rng, log } = session; const sleep = session.sleep; const startTime = session.clock.now();
  fleetWallets.forEach((w, i) => { w.brain = createBrain(BRAINS[i % BRAINS.length], w.allocation, rng); log(`[FLEET] [${w.role}] brain ${w.brain.id} agg:${w.brain.aggression.toFixed(2)} pat:${w.brain.patience.toFixed(2)} greed:${w.brain.greed.toFixed(2)}`); });
  let lastLog = 0;
  while (session.running) {
    const elapsed = (session.clock.now() - startTime) / 1000;
    const gs = gameState?.alive ? gameState.refresh() : {}; const bondingPct = gs.bondingPct || 0;
    for (const w of fleetWallets) {
      if (!w.funded || !w.brain || !session.running) continue;
      const d = walletDecide(w.brain, gs, elapsed, bondingPct, rng, minTrade);
      if (d.action === "buy" && d.amount > minTrade) {
        await sleep(500 + rng() * 2500);
        const amount = d.amount * (0.93 + rng() * 0.14);
        try { const r = await executeBuy(w, amount); if (r?.ok) { w.brain.spent += r.ethIn ?? amount; w.brain.tokensHeld = true; w.brain.lastAction = "buy"; w.brain.lastActionTime = session.clock.now(); log(`[FLEET] [${w.brain.id}] BUY ${amount.toFixed(5)} ETH — ${d.reason}`); } } catch (e) { log(`[FLEET] [${w.brain.id}] buy failed: ${e.message}`); }
      } else if (d.action === "sell" && d.percent > 0) {
        await sleep(1000 + rng() * 4000);
        try { const pct = Math.min(100, d.percent * (0.9 + rng() * 0.2)); const r = await executeSell(w, pct / 100); if (r?.ok) { w.brain.recovered += r.ethOut || 0; if (pct >= 95 || r.emptied) w.brain.tokensHeld = false; w.brain.lastAction = "sell"; w.brain.lastActionTime = session.clock.now(); log(`[FLEET] [${w.brain.id}] SELL ${pct.toFixed(0)}% — ${d.reason} → ${(r.ethOut || 0).toFixed(5)} ETH`); } } catch (e) { log(`[FLEET] [${w.brain.id}] sell failed: ${e.message}`); }
      } else if (d.action === "volume_trade" && d.amount > 0) {
        await sleep(500 + rng() * 1500);
        try { await executeVolumeTrade(w, d.amount); log(`[FLEET] [${w.brain.id}] VOL ${d.amount.toFixed(5)} — ${d.reason}`); } catch {}
      }
    }
    if (elapsed - lastLog >= 30) { lastLog = elapsed; const active = fleetWallets.filter(w => w.brain?.phase !== "done").length; log(`[FLEET] t=${Math.round(elapsed)}s | ${active}/${fleetWallets.length} active | ext:${gs.uniqueBuyers || 0} | mom:${(gs.momentum || 0).toFixed(4)} | bp:${gs.buyPressure || 0}%`); }
    await sleep((gs.uniqueBuyers || 0) > 2 ? 8000 + rng() * 7000 : 5000 + rng() * 5000);
    if (fleetWallets.every(w => !w.brain || w.brain.phase === "done")) { log(`[FLEET] all wallets done`); session.phase = "complete"; break; }
  }
}
