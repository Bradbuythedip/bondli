// ═══ VELOCITY — Risk envelope and sizer (DP3) ═══
// The envelope is read once, validated, deep-frozen, and never written by the
// process. The sizer turns a GO decision into a stake that cannot breach any
// cap even if every open position hits its worst case at the same time.
// The governor's throttle arrives as an input and can only shrink the stake.

import fs from "node:fs";

export const VENUE_KEYS = Object.freeze(["pumpfun", "polymarket", "perps"]);

export function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const num = (v) => typeof v === "number" && Number.isFinite(v);

export function validateRisk(cfg) {
  const errors = [];
  const req = (path, cond, msg) => { if (!cond) errors.push(`${path}: ${msg}`); };
  if (!cfg || typeof cfg !== "object") return { ok: false, errors: ["risk file is not an object"], summary: null };

  req("bankroll_usd", num(cfg.bankroll_usd) && cfg.bankroll_usd > 0, "must be a positive number");
  req("per_trade_max_usd", num(cfg.per_trade_max_usd) && cfg.per_trade_max_usd > 0, "must be a positive number");
  req("portfolio_max_exposure_usd", num(cfg.portfolio_max_exposure_usd) && cfg.portfolio_max_exposure_usd > 0, "must be a positive number");
  req("daily_loss_limit_usd", num(cfg.daily_loss_limit_usd) && cfg.daily_loss_limit_usd > 0, "must be a positive number");
  req("max_concurrent_positions", Number.isInteger(cfg.max_concurrent_positions) && cfg.max_concurrent_positions >= 1, "must be an integer >= 1");
  req("max_per_group", Number.isInteger(cfg.max_per_group) && cfg.max_per_group >= 1, "must be an integer >= 1");
  if (num(cfg.per_trade_max_usd) && num(cfg.portfolio_max_exposure_usd))
    req("per_trade_max_usd", cfg.per_trade_max_usd <= cfg.portfolio_max_exposure_usd, "cannot exceed portfolio_max_exposure_usd");
  if (num(cfg.daily_loss_limit_usd) && num(cfg.bankroll_usd))
    req("daily_loss_limit_usd", cfg.daily_loss_limit_usd <= cfg.bankroll_usd, "cannot exceed bankroll_usd");
  if (num(cfg.portfolio_max_exposure_usd) && num(cfg.bankroll_usd))
    req("portfolio_max_exposure_usd", cfg.portfolio_max_exposure_usd <= cfg.bankroll_usd, "cannot exceed bankroll_usd");

  req("venues", cfg.venues && typeof cfg.venues === "object", "must be an object");
  for (const v of VENUE_KEYS) {
    const vc = cfg.venues?.[v];
    const p = `venues.${v}`;
    if (!vc) { errors.push(`${p}: missing (set max_exposure_usd to 0 to disable)`); continue; }
    req(`${p}.max_exposure_usd`, num(vc.max_exposure_usd) && vc.max_exposure_usd >= 0, "must be a number >= 0");
    if (num(vc.max_exposure_usd) && num(cfg.portfolio_max_exposure_usd))
      req(`${p}.max_exposure_usd`, vc.max_exposure_usd <= cfg.portfolio_max_exposure_usd, "cannot exceed portfolio_max_exposure_usd");
    req(`${p}.max_concurrent`, Number.isInteger(vc.max_concurrent) && vc.max_concurrent >= 0, "must be an integer >= 0");
    if (num(vc.max_exposure_usd) && vc.max_exposure_usd > 0)
      req(`${p}.max_concurrent`, vc.max_concurrent >= 1, "must be >= 1 when the venue has exposure");
    req(`${p}.kelly_fraction`, num(vc.kelly_fraction) && vc.kelly_fraction > 0 && vc.kelly_fraction <= 0.5, "must be in (0, 0.5]");
    req(`${p}.min_stake_usd`, num(vc.min_stake_usd) && vc.min_stake_usd >= 0, "must be a number >= 0");
    req(`${p}.worst_case_fraction`, num(vc.worst_case_fraction) && vc.worst_case_fraction > 0 && vc.worst_case_fraction <= 1, "must be in (0, 1]");
    req(`${p}.max_slippage_bps`, Number.isInteger(vc.max_slippage_bps) && vc.max_slippage_bps >= 0 && vc.max_slippage_bps <= 5000, "must be an integer in [0, 5000]");
    const lb = vc.latency_budget_ms;
    req(`${p}.latency_budget_ms`, lb && ["observe", "decide", "send", "confirm"].every(k => num(lb[k]) && lb[k] > 0), "needs observe, decide, send, confirm in ms");
  }
  const pr = cfg.promotion || {};
  req("promotion.confidence", num(pr.confidence) && pr.confidence >= 0.5 && pr.confidence < 1, "must be in [0.5, 1)");
  req("promotion.live_start_fraction", num(pr.live_start_fraction) && pr.live_start_fraction > 0 && pr.live_start_fraction <= 1, "must be in (0, 1]");
  req("promotion.min_paper_trades", pr.min_paper_trades && VENUE_KEYS.every(v => Number.isInteger(pr.min_paper_trades[v]) && pr.min_paper_trades[v] >= 1), "needs an integer >= 1 per venue");

  return { ok: errors.length === 0, errors, summary: errors.length ? null : worstDay(cfg) };
}

/** What the operator is agreeing to: the most that can be lost in one day and at once. */
export function worstDay(cfg) {
  const venues = {};
  for (const v of VENUE_KEYS) {
    const vc = cfg.venues[v];
    venues[v] = { max_exposure_usd: vc.max_exposure_usd, worst_case_usd: +(vc.max_exposure_usd * vc.worst_case_fraction).toFixed(2), enabled: vc.max_exposure_usd > 0 };
  }
  return {
    bankroll_usd: cfg.bankroll_usd,
    daily_loss_limit_usd: cfg.daily_loss_limit_usd,
    daily_loss_pct_of_bankroll: +((cfg.daily_loss_limit_usd / cfg.bankroll_usd) * 100).toFixed(2),
    max_open_exposure_usd: cfg.portfolio_max_exposure_usd,
    max_single_stake_usd: cfg.per_trade_max_usd,
    venues,
  };
}

export function loadRiskEnvelope(file) {
  if (!fs.existsSync(file)) throw new Error(`risk file not found: ${file}. Copy src/velocity/config/risk.example.json to ${file} and edit it.`);
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (err) { throw new Error(`risk file ${file} is not valid JSON: ${err.message}`); }
  const v = validateRisk(cfg);
  if (!v.ok) throw new Error(`risk file ${file} rejected:\n  - ${v.errors.join("\n  - ")}`);
  return deepFreeze(cfg);
}

export function kellyFraction(p_win, payoff) {
  if (!(payoff > 0)) return 0;
  return Math.max(0, (p_win * payoff - (1 - p_win)) / payoff);
}

export class Sizer {
  constructor(envelope) {
    if (!Object.isFrozen(envelope)) throw new Error("sizer requires a frozen risk envelope (use loadRiskEnvelope)");
    this.env = envelope;
  }

  /**
   * @param decision  GO decision from DP2: p_win, payoff, venue, group, stop_fraction
   * @param portfolio { open: [{venue, group, notional_usd, worst_case_fraction}], realized_today_usd }
   * @param throttle  governor output in [0,1]; only ever shrinks
   */
  size({ decision, portfolio, throttle = 1, halted = false }) {
    const env = this.env;
    const venue = decision.venue;
    const vc = env.venues[venue];
    const reasons = [];
    const caps = [];
    const zero = (why) => ({ stake_usd: 0, worst_case_usd: 0, reasons: [why, ...reasons], caps, kelly: null });

    if (halted) return zero("HALTED");
    if (!vc || !(vc.max_exposure_usd > 0)) return zero("VENUE_DISABLED");
    const t = Math.min(1, Math.max(0, Number(throttle) || 0));
    if (t === 0) return zero("THROTTLE_ZERO");

    const open = portfolio?.open || [];
    const realized = Number(portfolio?.realized_today_usd) || 0;
    const totalOpen = open.reduce((s, p) => s + (p.notional_usd || 0), 0);
    const venueOpen = open.filter(p => p.venue === venue).reduce((s, p) => s + (p.notional_usd || 0), 0);
    const openRisk = open.reduce((s, p) => s + (p.notional_usd || 0) * (p.worst_case_fraction ?? env.venues[p.venue]?.worst_case_fraction ?? 1), 0);

    // Concurrency and group caps are yes/no.
    if (open.length >= env.max_concurrent_positions) return zero("MAX_CONCURRENT");
    if (open.filter(p => p.venue === venue).length >= vc.max_concurrent) return zero("VENUE_MAX_CONCURRENT");
    if (decision.group && open.filter(p => p.group === decision.group).length >= env.max_per_group) return zero("MAX_PER_GROUP");

    // Edge.
    const f_full = kellyFraction(decision.p_win, decision.payoff);
    if (f_full <= 0) return zero("NO_EDGE");
    const f_used = f_full * vc.kelly_fraction * t;
    const equity = env.bankroll_usd + realized;
    const available = Math.max(0, equity - totalOpen);
    let stake = available * f_used;
    reasons.push(`kelly f=${f_full.toFixed(4)} x ${vc.kelly_fraction} x throttle ${t.toFixed(2)} on ${available.toFixed(2)} available`);

    const cap = (name, limit) => { if (stake > limit) { stake = Math.max(0, limit); caps.push(name); } };
    cap("PER_TRADE_MAX", env.per_trade_max_usd);
    cap("VENUE_EXPOSURE", vc.max_exposure_usd - venueOpen);
    cap("PORTFOLIO_EXPOSURE", env.portfolio_max_exposure_usd - totalOpen);

    // Daily loss budget: what could still be lost today if everything open hits its worst case.
    const stop = Math.max(Number(decision.stop_fraction) || 0, vc.worst_case_fraction);
    const budget = env.daily_loss_limit_usd - Math.max(0, -realized) - openRisk;
    if (budget <= 0) return zero("DAILY_BUDGET_EXHAUSTED");
    cap("DAILY_LOSS_BUDGET", budget / stop);

    stake = Math.floor(stake * 100) / 100;
    if (stake > 0 && stake < vc.min_stake_usd) {
      // A small bankroll: fractional Kelly on $50 lands under the venue's minimum viable order.
      // Trade the minimum when every cap still admits it; otherwise trade nothing.
      const room = Math.min(env.per_trade_max_usd, vc.max_exposure_usd - venueOpen, env.portfolio_max_exposure_usd - totalOpen, budget / stop);
      if (vc.min_stake_usd <= room) { stake = vc.min_stake_usd; caps.push("MIN_STAKE_FLOOR"); }
    }
    if (stake < vc.min_stake_usd) return zero(`BELOW_MIN_STAKE_${vc.min_stake_usd}`);
    return {
      stake_usd: stake,
      worst_case_usd: +(stake * stop).toFixed(2),
      stop_fraction: stop,
      reasons,
      caps,
      kelly: { f_full: +f_full.toFixed(6), fraction: vc.kelly_fraction, throttle: t, f_used: +f_used.toFixed(6) },
      budget_remaining_usd: +(budget - stake * stop).toFixed(2),
    };
  }
}
