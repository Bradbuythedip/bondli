// ═══ The first dip, and the road to graduation ═══
// The launch feed buys the first minutes, which is where the crowd is loudest and the price is
// mostly the crowd's own impact. The record says what that costs: over the last measured stretch
// every close lost, whatever rule ended it -- stall, fade-trim, stop, crash, dead-on-arrival -- and a
// spread like that is not an exit problem. Nothing exits well out of a bad entry.
//
// This is the other entry, the one the launch feed cannot see because it stops looking after fifteen
// minutes: a token that RAN, gave some back while the first buyers took profit, and is being bought
// again. The run is the proof the launch never has (someone else's money moved the price, not ours),
// the drawdown is the discount, and the recovery is the crowd voting a second time. It is the same
// shape a trader means by "the first dip", measured rather than eyeballed.
//
// Two reads live here, both pure and both computed off one bounded price track per token:
//   dipSignal  -- ran, dipped, being bought again, within the first hour
//   gradSignal -- how far up the bonding curve, how fast, and how long until it graduates
// Neither decides anything. They stamp a token; the gates still judge every rug rule, the sizer
// still sizes, and the exit plan for a dip entry is its own (src/velocity/core/plans.mjs).
const SEC = 1_000, MIN = 60_000;

// ── The price track ────────────────────────────────────────────────────────────
// A sample covers an interval: its close, and the highest and lowest the price reached inside it. An
// extreme is never smoothed away, because every reading below is peak-to-trough. `cv` is bonding-curve
// progress at the close, 0..1, so the road to graduation is measured off the same series.
export const TRACK = Object.freeze({ minGapMs: 20 * SEC, cap: 150 });

/** Record a price. Mutates and returns `track`, which stays bounded by `cap`. */
export function pushTrack(track, t, mc, { minGapMs = TRACK.minGapMs, cap = TRACK.cap, cv = null } = {}) {
  if (!Array.isArray(track)) return track;
  const v = Number(mc), at = Number(t);
  if (!(v > 0) || !Number.isFinite(at)) return track;
  const last = track[track.length - 1];
  // Inside the current interval the sample is updated in place. Its `t` is the interval's START and
  // never moves: a busy token would otherwise keep pushing the gap out and never open a new sample.
  if (last && at - last.t < minGapMs) {
    last.mc = v;
    if (v > last.hi) last.hi = v;
    if (v < last.lo) last.lo = v;
    if (cv != null) last.cv = Number(cv);
    return track;
  }
  track.push({ t: at, mc: v, hi: v, lo: v, cv: cv == null ? (last?.cv ?? null) : Number(cv) });
  if (track.length > cap) decimate(track);
  return track;
}

/** Full: the older half is merged pairwise. Extremes survive exactly; only resolution is lost, and
 *  only where it matters least -- an hour ago, where the read wants a shape and not a tick. */
function decimate(track) {
  const half = track.length >> 1, merged = [];
  for (let i = 0; i < half; i += 2) {
    const a = track[i], b = track[i + 1];
    if (!b || i + 1 >= half) { merged.push(a); break; }
    merged.push({ t: a.t, mc: b.mc, hi: Math.max(a.hi, b.hi), lo: Math.min(a.lo, b.lo), cv: b.cv ?? a.cv });
  }
  track.splice(0, half, ...merged);
}

// ── The first dip ──────────────────────────────────────────────────────────────
export const DIP_DEFAULTS = Object.freeze({
  minAgeMs: 4 * MIN,        // before this the price is still the launch settling, not a dip
  maxAgeMs: 60 * MIN,       // the first hour; past it a token belongs to the slow cook or the revival
  minRunPct: 30,            // it has to have run: the peak this far above where it opened
  minDrawdownPct: 15,       // and given back this much of the run, or there is no discount
  maxDrawdownPct: 65,       // past this it is not a dip, it is the exit
  minRecoveryPct: 5,        // and be this far back up off the low: the crowd voting a second time
  maxFromPeakPct: 45,       // while still this close to the peak, so a knife is never caught
  // ...and no closer than this, because the discount is the whole reason to be here. A token that
  // gave back twenty per cent and took all of it back passed every other test while offering
  // nothing: the drawdown was real, the recovery was real, and the entry was the peak.
  minFromPeakPct: 8,
  // The bounce has to have outlived one print. A single sample above the low is a tick, not a turn,
  // and on a thin curve it is often just the spread. Two samples is the cheapest honest wait.
  minSamplesSinceLow: 2,
  freshLowMs: 12 * MIN,     // the low has to be recent, or this is a slow bleed with a bounce in it
  minBuyersSinceLow: 4,     // distinct wallets that bought the dip
  minBuyShareSinceLow: 0.55,// and the flow since the low is mostly buying
  maxDevSellShare: 0.25,    // the dev did not dump into it
  minSamples: 4,
});

const pct = (a, b) => (b > 0 ? ((a - b) / b) * 100 : 0);
const same = (a, b) => !!a && !!b && String(a).slice(0, 8) === String(b).slice(0, 8);

/**
 * The first-dip read for one token. `track` is the series above; `trades` is the radar's own list
 * ({side, sol, wallet, time}). Returns the numbers whatever the verdict, so a row can show what a
 * token is doing even when it is not a candidate.
 */
export function dipSignal(token, { now = Date.now(), track = token?._track, trades = token?.trades, ...over } = {}) {
  const o = { ...DIP_DEFAULTS, ...over };
  const out = { dip: false, phase: "unknown", reasons: [], runPct: 0, drawdownPct: 0, recoveryPct: 0, fromPeakPct: 0,
    peakMcap: 0, lowMcap: 0, openMcap: 0, mcapUsd: Number(token?.mcapUsd) || 0, peakAt: 0, lowAt: 0, ageMs: null,
    buyers: 0, buyShare: 0, devSellShare: 0, samplesSinceLow: 0, at: now };
  if (!token?.ca) { out.reasons.push("NO_TOKEN"); return out; }
  const age = token.createdAt ? now - token.createdAt : null;
  out.ageMs = age;
  if (age == null) { out.reasons.push("AGE_UNKNOWN"); return out; }
  const t = Array.isArray(track) ? track : [];
  if (t.length < o.minSamples) { out.reasons.push("NO_TRACK"); return out; }

  // The shape: where it opened, the highest it reached, and the lowest since that peak.
  out.openMcap = t[0].lo || t[0].mc;
  let peak = -Infinity, peakAt = 0;
  for (const s of t) if (s.hi > peak) { peak = s.hi; peakAt = s.t; }
  let low = Infinity, lowAt = peakAt;
  for (const s of t) if (s.t >= peakAt && s.lo < low) { low = s.lo; lowAt = s.t; }
  const mc = t[t.length - 1].mc;
  out.peakMcap = peak; out.lowMcap = low; out.peakAt = peakAt; out.lowAt = lowAt;
  out.runPct = +pct(peak, out.openMcap).toFixed(1);
  out.drawdownPct = +(peak > 0 ? ((peak - low) / peak) * 100 : 0).toFixed(1);
  out.recoveryPct = +pct(mc, low).toFixed(1);
  out.fromPeakPct = +(peak > 0 ? ((peak - mc) / peak) * 100 : 0).toFixed(1);
  // How many readings have printed above the low since it was set. One is the bounce itself.
  out.samplesSinceLow = t.filter(s => s.t > lowAt && s.mc > low).length;

  // The flow since the low: who bought the dip, and did the dev sell into it.
  const since = (Array.isArray(trades) ? trades : []).filter(x => (x?.time || 0) >= lowAt);
  const buyers = new Set();
  let buySol = 0, sellSol = 0, devSell = 0;
  for (const x of since) {
    const sol = Number(x.sol) || 0;
    if (x.side === "buy") { buySol += sol; if (x.wallet) buyers.add(x.wallet); }
    else if (x.side === "sell") { sellSol += sol; if (same(x.wallet, token.devWallet)) devSell += sol; }
  }
  out.buyers = buyers.size;
  out.buyShare = +(buySol + sellSol > 0 ? buySol / (buySol + sellSol) : 0).toFixed(2);
  out.devSellShare = +(sellSol > 0 ? devSell / sellSol : 0).toFixed(2);

  // What it is doing, said in one word, whether or not it is a candidate.
  out.phase = out.drawdownPct < o.minDrawdownPct ? (out.fromPeakPct <= 3 ? "running" : "holding")
    : out.drawdownPct > o.maxDrawdownPct ? "dead"
    : out.recoveryPct >= o.minRecoveryPct ? "recovering" : "dipping";

  const no = out.reasons;
  if (age < o.minAgeMs) no.push("TOO_YOUNG_FOR_DIP");
  if (age > o.maxAgeMs) no.push("PAST_FIRST_HOUR");
  if (out.runPct < o.minRunPct) no.push("NEVER_RAN");
  if (out.drawdownPct < o.minDrawdownPct) no.push("NO_DIP_YET");
  if (out.drawdownPct > o.maxDrawdownPct) no.push("NOT_A_DIP_A_COLLAPSE");
  if (out.recoveryPct < o.minRecoveryPct) no.push("NOT_TURNING");
  if (out.fromPeakPct > o.maxFromPeakPct) no.push("STILL_FAR_UNDER_PEAK");
  if (out.fromPeakPct < o.minFromPeakPct) no.push("NO_DISCOUNT_LEFT");
  if (out.samplesSinceLow < o.minSamplesSinceLow) no.push("BOUNCE_HAS_NOT_HELD");
  if (now - lowAt > o.freshLowMs) no.push("LOW_IS_OLD");
  if (out.buyers < o.minBuyersSinceLow) no.push("NOBODY_BOUGHT_THE_DIP");
  if (out.buyShare < o.minBuyShareSinceLow) no.push("STILL_SELLING");
  if (out.devSellShare > o.maxDevSellShare) no.push("DEV_SOLD_THE_DIP");
  out.dip = no.length === 0;
  return out;
}

// ── The road to graduation ─────────────────────────────────────────────────────
// Curve progress is the one number on a launchpad that cannot be faked by wash trading: it moves
// only when real quote currency is deposited. How fast it is moving says more than how far along it
// is -- a token at 85% that stopped filling an hour ago is a trap, and one at 60% filling at two
// points a minute is twenty minutes from a liquidity event.
export const GRAD_DEFAULTS = Object.freeze({
  nearPct: 0.55,        // "on the road" starts here
  hotPct: 0.80,         // and this is the last stretch
  windowMs: 10 * MIN,   // the fill rate is measured over this much of the track
  movingPtsPerMin: 0.15,// below this it is not filling, whatever it says
  stalledMs: 15 * MIN,  // a stall is measured over its own, longer lookback than the fill rate:
  stallPts: 1,          // fewer than this many points of progress in that time, and it is stuck
});

/** How far up the curve, how fast, and how long at this rate. `pctNow` is 0..1. */
export function gradSignal(token, { now = Date.now(), track = token?._track, pctNow = null, ...over } = {}) {
  const o = { ...GRAD_DEFAULTS, ...over };
  const p = pctNow == null ? (token?._curvePct != null ? Number(token._curvePct) : null) : Number(pctNow);
  const out = { near: false, hot: false, stalled: false, pct: p == null ? null : +p.toFixed(4), ptsPerMin: null, etaMin: null, graduated: !!token?.graduated, phase: "unknown" };
  if (out.graduated) { out.phase = "graduated"; out.pct = 1; return out; }
  if (p == null || !(p >= 0)) { out.phase = "unknown"; return out; }
  const t = (Array.isArray(track) ? track : []).filter(s => s.cv != null);
  if (t.length >= 2) {
    const lastS = t[t.length - 1];
    // The pace, over the recent window: what it is doing now, not what it averaged since launch.
    const first = t.find(s => s.t >= now - o.windowMs) || t[0];
    const mins = (lastS.t - first.t) / MIN;
    if (mins >= 1) {
      out.ptsPerMin = +(((lastS.cv - first.cv) * 100) / mins).toFixed(3);
      if (out.ptsPerMin > 0) out.etaMin = Math.max(0, Math.round(((1 - p) * 100) / out.ptsPerMin));
    }
    // A stall is a different question from a pace, and needs its own, longer lookback: measured
    // inside the pace window it could never be seen, because that window is shorter than a stall.
    // It needs a reading from before the stall began, so a token with no history that old is not
    // called stuck -- it is only young.
    let back = null;
    for (const sm of t) if (sm.t <= now - o.stalledMs) back = sm;
    if (back && p >= o.nearPct && (lastS.cv - back.cv) * 100 < o.stallPts) out.stalled = true;
  }
  out.near = p >= o.nearPct;
  out.hot = p >= o.hotPct;
  out.phase = out.stalled ? "stalled" : out.hot ? "last stretch" : out.near ? "on the road" : "early";
  return out;
}

// ── Which ones are worth holding ───────────────────────────────────────────────
// A dip entry is a trade: in on the discount, out on the bounce. A dip entry on a token that is also
// filling its curve toward a graduation is the other thing, the one worth sitting through noise for,
// because the event it is walking toward is a real one and it is not priced yet. Everything else is
// a trade, and saying so is what keeps a trade from silently becoming a bag.
export const HOLD_DEFAULTS = Object.freeze({ minCurvePct: 0.5, maxEtaMin: 90, minPtsPerMin: 0.3 });

/** "hold" or "trade", with the reason it is one and not the other. */
export function convictionOf(dip, grad, over = {}) {
  const o = { ...HOLD_DEFAULTS, ...over };
  if (!dip?.dip) return { conviction: null, why: "not a dip entry" };
  if (!grad || grad.graduated) return { conviction: "trade", why: "no curve left to fill" };
  if (grad.stalled) return { conviction: "trade", why: "the curve stopped filling" };
  if (!(grad.pct >= o.minCurvePct)) return { conviction: "trade", why: `curve ${Math.round((grad.pct || 0) * 100)}%, too early to be walking toward anything` };
  if (!(grad.ptsPerMin >= o.minPtsPerMin)) return { conviction: "trade", why: "the curve is barely moving" };
  if (!(grad.etaMin != null && grad.etaMin <= o.maxEtaMin)) return { conviction: "trade", why: `the curve completes ${grad.etaMin == null ? "at no rate worth naming" : `in ${grad.etaMin}m`} at this pace` };
  return { conviction: "hold", why: `curve ${Math.round(grad.pct * 100)}% and filling ${grad.ptsPerMin}/min: it completes in about ${grad.etaMin}m` };
}
