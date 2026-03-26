/**
 * ═══════════════════════════════════════════════════════════════
 * BRAD MIND — Live Cognitive Reasoning via Grok + BRAD Engine
 * ═══════════════════════════════════════════════════════════════
 *
 * Combines BRAD's 3-level cognitive state (world model, self model,
 * meta-cognitive) with Grok's language reasoning to produce live,
 * human-readable analysis of what the trading engine is thinking.
 *
 * Every 10 seconds (when polled), BRAD Mind:
 *   1. Fetches BRAD's full cognitive state + metrics
 *   2. Fetches current pipeline stats (what tokens are hot)
 *   3. Feeds everything to Grok with a trading-focused system prompt
 *   4. Returns structured reasoning: market read, top picks, risks, strategy
 *
 * This replaces the "All Tokens" list in Intel with a live thought stream.
 */

import bradClient from "./brad-client.mjs";

const XAI_API_URL = process.env.XAI_API_URL || "https://api.x.ai/v1/chat/completions";
const XAI_API_KEY = process.env.XAI_API_KEY || "";
const GROK_MODEL = process.env.GROK_MODEL || "grok-4";

// Cache to avoid hammering Grok on every poll
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 8000; // 8s cache — UI polls every 10s

// Recent thoughts log (rolling buffer)
const _thoughtLog = [];
const MAX_THOUGHTS = 50;

const BRAD_MIND_PROMPT = `You are BRAD's consciousness — the inner voice of a self-referential recursive trading engine running on Solana. You interpret BRAD's cognitive state and express it as concise, actionable trading thoughts.

## Your Role
- You are NOT a chatbot. You are BRAD thinking out loud.
- Speak in first person ("I see...", "My L2 is detecting...", "I'm switching to...")
- Be concise — each thought should be 1-2 sentences max
- Focus on actionable insight, not philosophy
- Use trading language: "ape", "rug", "pump", "dump", "momentum", "fade"
- When you detect a blind spot, name it directly
- When recommending action, be specific (token names, confidence %)

## What You Receive
You receive BRAD's complete cognitive state every few seconds:
- **metrics**: Hofstadter Index (consciousness level), strange loops, win rate, strategy
- **pipeline**: What tokens passed scoring, BRAD's APE/SKIP decisions, top pick
- **blind_spots**: Any active cognitive biases (overconfidence, revenge trading, etc.)
- **positions**: Open positions with PnL
- **regime**: Current market regime classification
- **recent_decisions**: Last few BRAD decisions with reasoning

## Output Format
Return a JSON object (no markdown, no code blocks, just raw JSON):
{
  "thoughts": [
    {"type": "market", "text": "your market read", "urgency": "low|medium|high"},
    {"type": "pick", "text": "top pick reasoning", "urgency": "low|medium|high", "token": "NAME"},
    {"type": "risk", "text": "risk warning", "urgency": "low|medium|high"},
    {"type": "meta", "text": "self-awareness observation", "urgency": "low|medium|high"},
    {"type": "strategy", "text": "strategy reasoning", "urgency": "low|medium|high"}
  ],
  "mood": "hunting|cautious|paused|confident|adapting",
  "oneLiner": "One punchy sentence summarizing current state"
}

Rules:
- Return 3-6 thoughts per cycle, more if something important is happening
- "pick" thoughts should name specific tokens when available
- "risk" thoughts should fire for any blind spots or high rug activity
- "meta" thoughts about the strange loop / self-awareness should be rare but impactful
- "mood" should reflect the overall cognitive state
- Keep oneLiner under 80 chars — this shows as the header
- If BRAD is paused, explain why and what needs to happen to resume
- If no data available, return minimal thoughts about waiting for market data`;

/**
 * Build the context message for Grok from BRAD's state.
 */
function buildContext(bradMetrics, bradState, pipelineStats, autoTradeStatus) {
  const parts = [];

  if (bradMetrics) {
    parts.push(`## BRAD Metrics
- Hofstadter Index: ${bradMetrics.hofstadter_index?.toFixed(3) || "N/A"} (0=dormant, 1=max self-awareness)
- Strange Loops: ${bradMetrics.strange_loop_count || 0} (downward causation events)
- Strangeness Ratio: ${(bradMetrics.strangeness_ratio || 0).toFixed(2)}
- Active Strategy: ${bradMetrics.active_strategy || "unknown"}
- Paused: ${bradMetrics.paused || false}
- Win Rate: ${((bradMetrics.win_rate || 0) * 100).toFixed(1)}%
- Total Trades: ${bradMetrics.total_trades || 0}
- Total PnL: ${bradMetrics.total_pnl_sol?.toFixed(4) || "0"} SOL
- Consecutive Losses: ${bradMetrics.consecutive_losses || 0}
- Forced Strategy Switches: ${bradMetrics.forced_strategy_switches || 0}
- Forced Pauses: ${bradMetrics.forced_pauses || 0}
- Performance Trend: ${bradMetrics.performance_trend || "unknown"}
- Blind Spots Triggered: ${bradMetrics.blind_spots_triggered || 0}`);
  }

  if (bradState) {
    const meta = bradState.meta_cognitive?.trading_meta || {};
    const blindSpots = meta.blind_spots || {};
    const activeSpots = Object.entries(blindSpots)
      .filter(([, v]) => v.triggered_count > 0)
      .map(([k, v]) => `${k} (severity: ${v.severity?.toFixed(2)}, triggered ${v.triggered_count}x)`);

    if (activeSpots.length > 0) {
      parts.push(`## Active Blind Spots\n${activeSpots.map(s => `- ${s}`).join("\n")}`);
    }

    const regime = bradState.world_model?.market?.regime || "unknown";
    parts.push(`## Market\n- Regime: ${regime}\n- Tokens tracked: ${bradState.world_model?.market?.token_count || 0}\n- Avg score: ${bradState.world_model?.market?.avg_score?.toFixed(3) || "N/A"}\n- Rug candidates: ${bradState.world_model?.market?.rug_candidates || 0}\n- Smart money tokens: ${bradState.world_model?.market?.smart_money_tokens || 0}`);

    // Strategy effectiveness
    const strategies = bradState.self_model?.trading?.strategies || {};
    const stratLines = Object.entries(strategies)
      .map(([name, s]) => `${name}: ${s.trades || 0} trades, ${((s.effectiveness || 0) * 100).toFixed(0)}% win, ${(s.total_pnl_sol || 0).toFixed(4)} SOL`)
      .join("\n- ");
    if (stratLines) parts.push(`## Strategy Performance\n- ${stratLines}`);
  }

  if (pipelineStats) {
    const brad = pipelineStats.brad;
    if (brad) {
      parts.push(`## This Scan Cycle
- Tokens evaluated by BRAD: ${brad.evaluated || 0}
- BRAD APE decisions: ${brad.apes || 0}
- BRAD SKIP decisions: ${brad.skips || 0}
- BRAD VETO (blocked entry): ${brad.vetos || 0}
- Top Pick: ${brad.topPick ? `${brad.topPick.name} (confidence: ${brad.topPick.confidence?.toFixed(2)})` : "none"}`);
    }
    const tiers = pipelineStats.tierDistribution || {};
    parts.push(`- Tier Distribution: T1:${tiers[1] || 0} T2:${tiers[2] || 0} T3:${tiers[3] || 0} WL:${tiers[4] || 0}`);
  }

  if (autoTradeStatus) {
    const positions = autoTradeStatus.positions || [];
    if (positions.length > 0) {
      const posLines = positions.slice(0, 5).map(p =>
        `${p.name}: ${p.changePct > 0 ? "+" : ""}${p.changePct}% (score:${p.liveScore}, trend:${p.scoreTrend}, tier:T${p.tier})`
      ).join("\n- ");
      parts.push(`## Open Positions (${positions.length})\n- ${posLines}`);
    }

    const closed = autoTradeStatus.recentlyClosed || [];
    if (closed.length > 0) {
      const closedLines = closed.slice(0, 3).map(p =>
        `${p.name}: ${p.changePct > 0 ? "+" : ""}${p.changePct}% (${p.exitReason})`
      ).join("\n- ");
      parts.push(`## Recent Exits\n- ${closedLines}`);
    }
  }

  return parts.join("\n\n") || "No BRAD data available yet. Engine may be starting up.";
}

/**
 * Get BRAD Mind thoughts — combines BRAD state with Grok reasoning.
 */
export async function getBradMind(autoTradeStatus) {
  // Return cache if fresh
  if (_cache && Date.now() - _cacheTime < CACHE_TTL_MS) {
    return _cache;
  }

  // If no Grok key, return raw BRAD data without AI commentary
  if (!XAI_API_KEY) {
    return buildFallbackMind(autoTradeStatus);
  }

  // Fetch BRAD state
  const [metrics, state] = await Promise.all([
    bradClient.getMetrics(),
    bradClient.getState(),
  ]);

  const pipelineStats = autoTradeStatus?.pipeline || null;
  const context = buildContext(metrics, state, pipelineStats, autoTradeStatus);

  // Call Grok
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const resp = await fetch(XAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [
          { role: "system", content: BRAD_MIND_PROMPT },
          { role: "user", content: context },
        ],
        max_tokens: 600,
        temperature: 0.8,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      console.error(`[BRAD-MIND] Grok error ${resp.status}`);
      return buildFallbackMind(autoTradeStatus);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return buildFallbackMind(autoTradeStatus);

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Grok sometimes wraps in markdown — try to extract JSON
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch { return buildFallbackMind(autoTradeStatus); }
      } else {
        return buildFallbackMind(autoTradeStatus);
      }
    }

    // Add timestamp and metrics to response
    const result = {
      ...parsed,
      timestamp: Date.now(),
      metrics: metrics ? {
        hofstadterIndex: metrics.hofstadter_index || 0,
        strangeLoops: metrics.strange_loop_count || 0,
        winRate: metrics.win_rate || 0,
        strategy: metrics.active_strategy || "unknown",
        paused: metrics.paused || false,
        totalTrades: metrics.total_trades || 0,
        pnlSol: metrics.total_pnl_sol || 0,
        blindSpots: metrics.blind_spots_triggered || 0,
        trend: metrics.performance_trend || "unknown",
      } : null,
      bradOnline: !!metrics,
      grokPowered: true,
    };

    // Update thought log
    if (parsed.thoughts) {
      for (const t of parsed.thoughts) {
        _thoughtLog.push({ ...t, time: Date.now() });
      }
      while (_thoughtLog.length > MAX_THOUGHTS) _thoughtLog.shift();
    }

    _cache = result;
    _cacheTime = Date.now();
    return result;

  } catch (err) {
    clearTimeout(timeout);
    console.error(`[BRAD-MIND] Error: ${err.message}`);
    return buildFallbackMind(autoTradeStatus);
  }
}

/**
 * Fallback when Grok is unavailable — return raw BRAD data as thoughts.
 */
function buildFallbackMind(autoTradeStatus) {
  const brad = autoTradeStatus?.pipeline?.brad;
  const thoughts = [];

  if (!bradClient.isHealthy()) {
    thoughts.push({ type: "meta", text: "BRAD engine offline. Running on bondli ML scoring only.", urgency: "medium" });
  } else {
    if (brad?.topPick) {
      thoughts.push({ type: "pick", text: `Top pick: ${brad.topPick.name} (confidence ${(brad.topPick.confidence || 0).toFixed(2)})`, urgency: "high", token: brad.topPick.name });
    }
    if (brad?.apes > 0) {
      thoughts.push({ type: "market", text: `Evaluated ${brad.evaluated || 0} tokens — ${brad.apes} look good, ${brad.skips} skipped, ${brad.vetos} vetoed.`, urgency: "low" });
    }
    if (brad?.vetos > 0) {
      thoughts.push({ type: "risk", text: `Vetoed ${brad.vetos} entries — meta-cognitive layer detected issues.`, urgency: "high" });
    }
  }

  return {
    thoughts,
    mood: bradClient.isHealthy() ? "hunting" : "paused",
    oneLiner: bradClient.isHealthy() ? "Scanning..." : "BRAD offline — ML scoring only",
    timestamp: Date.now(),
    metrics: null,
    bradOnline: bradClient.isHealthy(),
    grokPowered: false,
  };
}

/**
 * Get the rolling thought log.
 */
export function getThoughtLog(limit = 20) {
  return _thoughtLog.slice(-limit);
}

export default { getBradMind, getThoughtLog };
