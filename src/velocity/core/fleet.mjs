// ═══ VELOCITY — Fleet execution: one position, many wallets (DP12) ═══
//
// FR: ape a token without the entry being one address, one transaction, one price.
// DP: a delivery layer *beneath* the router. The Sizer still decides how much; the
//     fleet decides only how that stake is delivered and recovered.
//
// The independence axiom is what shapes this file. The launchpad fleet
// (launch/robinhood/lib/) gives every wallet its own brain because there we are
// manufacturing the market — seven actors with seven agendas IS the product. Aping
// someone else's token is the opposite problem: we are the taker, and a second brain
// per wallet would fork the risk envelope, the cost basis and the exit ladder that the
// engine already owns. So nothing here decides whether to trade, what it is worth, or
// when to leave. The engine sees one position; the chain sees a crowd.
//
// The only game theory that transfers is the execution game, and it has two costs
// pulling against each other:
//
//   impact/optionality — a slice is an observation. Splitting an entry buys the right
//     to abort when the first fills come back worse than the model said. On a bonding
//     curve back-to-back slices pay the same convexity as one order, so the split is
//     worth nothing except that option.
//   adverse selection — while we wait between slices, competing flow moves the price
//     against us at a rate proportional to the intensity of that flow.
//
// Both fall out of one observable: λ, the intensity of competing buy flow. That gives
// the rule, and it is the inverse of the naive one ("crowded, so hide harder"):
//
//   λ high  → delay is expensive, information is worthless → FEW slices, tight stagger,
//             front-loaded weights. Take the fill.
//   λ low   → delay is cheap, information is valuable → MANY slices, wide stagger, flat
//             weights, and real abort rights between them.
//
// Splitting is a purchase of information. Only buy it when there is time to use it.
//
// Detection is the second, independent axis: N wallets exist so that no one address
// carries the whole position. That needs only n >= 2 and weights that do not look
// mechanical — equal slices across equal wallets are a signature, not a disguise.

import crypto from "node:crypto";

/** A sub-wallet needs its own gas and (on Solana) its own token-account rent. */
export const HEADROOM = {
  pumpfun: { gas: 0.0015, rent: 0.00204 },   // SOL: priority+base over a few txs, one ATA
  pons:    { gas: 0.00002, rent: 0 },        // ETH on an L2
  arc:     { gas: 0.00002, rent: 0 },
  ink:     { gas: 0.00002, rent: 0 },
};

export const FLEET_MAX = 8;
export const FLEET_MIN = 1;

/**
 * Deterministic sub-wallet seeds from the user's sealed root secret.
 *
 * Custody does not grow: nothing new is stored. The root is already sealed in the
 * vault; every sub-wallet is a pure function of it, so a restart, a second process or
 * a recovery from the sealed backup all reproduce the same fleet. HMAC is one-way, so
 * a leaked sub-key exposes its own slice and nothing above it.
 */
export function deriveFleet({ rootSecret, venue, size = 4, purpose = "velocity-fleet-v1" }) {
  if (!rootSecret) throw new Error("deriveFleet needs the root secret");
  if (!venue) throw new Error("deriveFleet needs a venue");
  const n = Math.max(FLEET_MIN, Math.min(FLEET_MAX, Math.floor(size)));
  const root = Buffer.isBuffer(rootSecret) ? rootSecret : Buffer.from(String(rootSecret), "utf8");
  const seeds = [];
  for (let i = 0; i < n; i++) {
    // The index is inside the message, not the key: one HMAC key per (root, purpose, venue)
    // means a sub-seed cannot be replayed onto another venue's fleet.
    const mac = crypto.createHmac("sha512", root).update(`${purpose}|${venue}|${i}`).digest();
    seeds.push(mac.subarray(0, 32));
  }
  return seeds;
}

/** A deterministic stream in [0,1) — the plan must replay exactly in a backtest. */
export function seededRng(seed) {
  let h = crypto.createHash("sha256").update(String(seed)).digest();
  let i = 0;
  return () => {
    if (i + 4 > h.length) { h = crypto.createHash("sha256").update(h).digest(); i = 0; }
    const v = h.readUInt32BE(i); i += 4;
    return v / 4294967296;
  };
}

/**
 * λ, normalised to [0,1]: how contested this entry is right now.
 *
 * Built from what the feed already knows. uniqueBuyers is the honest half (how many
 * distinct actors are in front of us); buyPressure says whether that flow is one-sided.
 * A one-sided crowd is the expensive case; a two-sided one gives us the pauses that
 * make slicing pay.
 */
export function contention({ uniqueBuyers = 0, buyPressure = 0.5, volumeRate = 0, stake_usd = 0 } = {}) {
  const crowd = 1 - Math.exp(-(Math.max(0, uniqueBuyers)) / 4);      // 4 buyers ≈ 0.63
  const onesided = Math.max(0, Math.min(1, (buyPressure - 0.5) * 2)); // 0 at balanced, 1 at all-buys
  // Our own size relative to the flow: when we are the whole tape, nobody is racing us.
  const ours = stake_usd > 0 && volumeRate > 0 ? Math.min(1, volumeRate / stake_usd) : crowd;
  return Math.max(0, Math.min(1, 0.5 * crowd + 0.3 * onesided + 0.2 * ours));
}

/**
 * Non-uniform weights that still sum to 1. Equal slices are a fingerprint; so is a
 * clean geometric decay. `tilt` front-loads (λ high) or flattens (λ low).
 */
function weightsFor(n, tilt, rng) {
  const raw = [];
  for (let i = 0; i < n; i++) {
    const base = Math.exp(-tilt * (i / Math.max(1, n - 1)));
    raw.push(base * (0.75 + rng() * 0.5)); // ±25% so no two entries share a shape
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map(w => w / sum);
}

/**
 * The entry plan: which wallet buys how much, when, and what would make us stop.
 *
 * `slices` are returned in wallet order; `at_ms` is the offset from the first send.
 * A slice carries `abort_if_impact_bps` — the observed impact above which the engine
 * should cancel the remainder. That number is the whole reason to slice at all, so it
 * is strict when we have time and effectively off when we do not.
 */
export function planEntry({
  stake_usd,
  wallets = [],
  lambda = 0.5,
  minSliceUsd = 2,
  maxImpactBps = 800,
  seed = "entry",
} = {}) {
  const n0 = Math.max(1, Math.min(FLEET_MAX, wallets.length || 1));
  if (!(stake_usd > 0)) return { slices: [], n: 0, lambda, reason: "no_stake" };
  const l = Math.max(0, Math.min(1, lambda));
  const rng = seededRng(seed);

  // Slice count: information is worth buying only when there is time to use it.
  // λ=0 → the full fleet; λ=1 → a single take-the-fill order.
  let n = Math.max(1, Math.round(n0 - (n0 - 1) * l));
  // A slice below the minimum is a fee donation, not a disguise.
  n = Math.max(1, Math.min(n, Math.floor(stake_usd / minSliceUsd) || 1));

  const tilt = 0.2 + 2.3 * l;               // flat when alone, front-loaded when raced
  const w = weightsFor(n, tilt, rng);

  // Stagger: the wait we can afford. Wide when nothing is racing us, near-zero when
  // every second costs us the fill.
  const spanMs = Math.round((1 - l) ** 2 * 9_000);

  let acc = 0;
  const slices = [];
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const usd = last ? +(stake_usd - acc).toFixed(4) : +(stake_usd * w[i]).toFixed(4);
    acc = +(acc + usd).toFixed(4);
    slices.push({
      i,
      wallet: wallets[i % n0] ?? null,
      stake_usd: usd,
      at_ms: i === 0 ? 0 : Math.round((spanMs * i) / Math.max(1, n - 1) * (0.7 + rng() * 0.6)),
      // The abort right. With no time to react it is the envelope's cap and nothing more.
      abort_if_impact_bps: last ? maxImpactBps : Math.round(maxImpactBps * (0.45 + 0.55 * l)),
    });
  }
  // Jitter can reorder the offsets; a plan that goes backwards in time is a bug downstream.
  slices.sort((a, b) => a.at_ms - b.at_ms).forEach((s, k) => { s.order = k; });
  return { slices, n, lambda: l, spanMs, tilt: +tilt.toFixed(3) };
}

/**
 * The exit plan: which wallets sell, in what order, for a ladder rung of `pct`.
 *
 * Three rules, in priority order:
 *  1. A cascade or a dev sell is not a time to be clever — every wallet, at once.
 *  2. Otherwise sell largest-holding first: the same tokens leave in fewer transactions,
 *     and fees are the one cost a fleet genuinely multiplies.
 *  3. Never put two wallets in the same block. Simultaneous sells from correlated
 *     addresses are exactly the cascade signature we detect in other people; emitting
 *     it ourselves invites the fill we are trying to avoid.
 *
 * The runner is held in the smallest position, so the tail we keep is also the wallet
 * whose exit costs the most in fee terms — the one worth leaving alone.
 */
export function planExit({
  holdings = [],
  pct = 100,
  signal = "HOLD",
  sellMultiplier = 1,
  minLegMs = 1_200,
  seed = "exit",
} = {}) {
  const live = holdings.filter(h => (h.qty || 0) > 0);
  if (!live.length) return { legs: [], urgent: false };
  const urgent = signal === "SELL_NOW" || sellMultiplier >= 2;
  const rng = seededRng(seed);

  const ranked = [...live].sort((a, b) => (b.qty || 0) - (a.qty || 0));
  // RIDE says the crowd is still buying: take the rung from the big positions only and
  // leave the tail in, rather than scaling every wallet down uniformly.
  const holdTail = !urgent && (signal === "RIDE" || signal === "ACCUMULATE") && ranked.length > 1 && pct < 100;
  const selling = holdTail ? ranked.slice(0, Math.max(1, ranked.length - 1)) : ranked;

  const legs = selling.map((h, k) => ({
    wallet: h.wallet,
    qty: +((h.qty * Math.min(100, pct)) / 100).toFixed(12),
    pct: Math.min(100, pct),
    at_ms: urgent ? 0 : Math.round(k * minLegMs * (0.8 + rng() * 0.6)),
    order: k,
  })).filter(l => l.qty > 0);

  return { legs, urgent, held_back: holdTail ? ranked.slice(-1).map(h => h.wallet) : [] };
}

/**
 * What to send each sub-wallet before the entry, in native units.
 *
 * Funding is the fleet's real cost and the reason FLEET_MAX is small: every wallet
 * needs gas it will not fully spend, and on Solana a rent deposit per token account.
 * The rent comes back on close (the engine already books it as a deposit, not a cost),
 * the gas does not. A fleet that cannot afford its own headroom is not a fleet — the
 * plan says so rather than half-funding wallets that then fail mid-entry.
 */
export function fundingPlan({ venue, slices = [], balances = {}, nativePriceUsd = 0 }) {
  const h = HEADROOM[venue] || { gas: 0, rent: 0 };
  if (!(nativePriceUsd > 0)) throw new Error("fundingPlan needs the native price");
  const transfers = [];
  let total = 0;
  for (const s of slices) {
    if (!s.wallet) continue;
    const need = s.stake_usd / nativePriceUsd + h.gas + h.rent;
    const have = balances[s.wallet] || 0;
    const send = +(Math.max(0, need - have)).toFixed(9);
    if (send > 0) { transfers.push({ to: s.wallet, amount: send }); total = +(total + send).toFixed(9); }
  }
  return { transfers, total, headroom: h, overhead: +(slices.length * (h.gas + h.rent)).toFixed(9) };
}

/**
 * What to bring home afterwards. A sweep costs its own gas, so anything that would
 * net less than it costs stays put and funds the next entry instead of being burnt
 * moving it.
 */
export function sweepPlan({ venue, balances = {}, root }) {
  const h = HEADROOM[venue] || { gas: 0, rent: 0 };
  const transfers = [];
  let total = 0;
  for (const [wallet, bal] of Object.entries(balances)) {
    if (wallet === root) continue;
    const net = +(bal - h.gas).toFixed(9);
    if (net > h.gas) { transfers.push({ from: wallet, to: root, amount: net }); total = +(total + net).toFixed(9); }
  }
  return { transfers, total, dust: Object.entries(balances).filter(([w, b]) => w !== root && b - h.gas <= h.gas).map(([w]) => w) };
}
