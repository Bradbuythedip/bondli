// ═══ The bonding curve, as the chain has it ═══
// Every market cap the radar shows for a pump.fun token arrives over the wire, and the wire computes
// it the same way we used to: price times ONE BILLION tokens, where the price comes from the curve's
// virtual reserves read against pump.fun's default opening constants.
//
// That is right for a coin launched from pump.fun's own front end and wrong for one launched through
// somebody else's. A launchpad that configures its own curve -- a different opening virtual reserve,
// a different total supply -- gets a token whose numbers are quoted in constants it never used. Both
// readings break at once and in the same direction: the market cap is multiplied by
// (1e9 / real supply), and the curve progress, which is measured as the distance the VIRTUAL reserve
// has travelled from pump.fun's opening 30 SOL, reads near a hundred per cent the moment the curve
// opens above 30 -- so a token one minute old with no buyers at all is served as filled and about to
// graduate at a million dollars, when it holds two and a half thousand.
//
// The curve account settles it. It carries the real reserves and the real total supply, and the two
// numbers that matter are computed off those rather than off any assumption:
//   mcap     = (virtual SOL / virtual tokens) * the supply that actually exists
//   progress = real SOL raised / the SOL a graduation takes -- no virtual offset in it, so a curve
//              that opened somewhere other than 30 is measured correctly instead of clamped to 1
//
// Layout (anchor account, little-endian u64s after the 8-byte discriminator):
//   8  virtual_token_reserves   24  real_token_reserves    40  token_total_supply
//   16 virtual_sol_reserves     32  real_sol_reserves      48  complete (u8)
// Offset 48 is the same `complete` byte src/api/mayhem.mjs reads, which is what pins the layout.

export const LAMPORTS = 1e9;
export const TOKEN_UNITS = 1e6;          // pump.fun mints carry 6 decimals
export const PUMP_SUPPLY = 1e9;          // the default the wire assumes, and the thing being checked
export const GRADUATION_SOL = 85;        // real SOL in the curve when it completes
export const CURVE_MIN_LEN = 49;         // through the `complete` byte

/** Decode a bonding-curve account. Returns null for anything that is not one. */
export function decodeBondingCurve(buf) {
  if (!buf || buf.length < CURVE_MIN_LEN) return null;
  const u64 = off => Number(buf.readBigUInt64LE(off));
  const vTok = u64(8), vSol = u64(16), rTok = u64(24), rSol = u64(32), supply = u64(40);
  // A curve with no virtual reserves is not a curve we can price off.
  if (!(vTok > 0) || !(vSol > 0)) return null;
  return {
    virtualTokenReserves: vTok, virtualSolReserves: vSol,
    realTokenReserves: rTok, realSolReserves: rSol,
    tokenTotalSupply: supply,
    complete: buf[48] === 1,
  };
}

/** Total supply in whole tokens, or null when the account does not state one. */
export function curveSupply(c) {
  const s = Number(c?.tokenTotalSupply);
  return s > 0 ? s / TOKEN_UNITS : null;
}

/** Market cap in SOL, priced off the virtual reserves against the supply that actually exists. */
export function curveMcapSol(c) {
  if (!c) return null;
  const supply = curveSupply(c);
  if (!(supply > 0)) return null;
  const priceSol = (c.virtualSolReserves / LAMPORTS) / (c.virtualTokenReserves / TOKEN_UNITS);
  if (!(priceSol > 0)) return null;
  return priceSol * supply;
}

/** Progress to graduation, 0..1, from the REAL SOL raised. A virtual offset this curve did not open
 *  at cannot distort it, which is the whole reason it is measured this way. */
export function curveProgress(c) {
  if (!c) return null;
  if (c.complete) return 1;
  const raised = Number(c.realSolReserves) / LAMPORTS;
  if (!(raised >= 0)) return null;
  return Math.max(0, Math.min(1, raised / GRADUATION_SOL));
}

/** How far the wire's numbers are from the chain's: 1 means they agree, 400 means the wire says four
 *  hundred times too much. The supply ratio is the whole of it when nothing else is wrong. */
export function supplyRatio(c) {
  const supply = curveSupply(c);
  return supply > 0 ? PUMP_SUPPLY / supply : null;
}

/** Everything the radar needs to correct one token, or null when the account cannot say.
 *  `off` is how many times the wire overstates the market cap; 1.0 is a standard pump.fun launch. */
export function reconcileFromCurve(buf, { solPrice = 0 } = {}) {
  const c = decodeBondingCurve(buf);
  if (!c) return null;
  const mcapSol = curveMcapSol(c);
  if (!(mcapSol > 0)) return null;
  return {
    mcapSol,
    mcapUsd: solPrice > 0 ? Math.round(mcapSol * solPrice) : 0,
    curvePct: curveProgress(c),
    supply: curveSupply(c),
    supplyRatio: supplyRatio(c),
    graduated: !!c.complete,
    realSol: Number(c.realSolReserves) / LAMPORTS,
    standard: Math.abs((curveSupply(c) || 0) - PUMP_SUPPLY) < 1,
  };
}

/** A reading the token's own history contradicts. Nothing here is about a launchpad: a curve cannot
 *  be nearly full before anyone has bought, and a market cap is not a number a token reaches in its
 *  first minute with no trades behind it. Both say the quote was computed with the wrong constants,
 *  and until the chain has been asked, the honest answer is that the price is not known. */
export function implausible(t, { now = Date.now(), curvePct = null, minTradesForFull = 5, fullPct = 0.9, richUsd = 100_000, richTrades = 10 } = {}) {
  if (!t) return null;
  const trades = (t.buys || 0) + (t.sells || 0);
  const curve = curvePct != null ? Number(curvePct) : t._curvePct != null ? Number(t._curvePct) : null;
  if (curve != null && curve >= fullPct && trades < minTradesForFull) return "FULL_CURVE_NO_TRADES";
  if ((t.mcapUsd || 0) >= richUsd && trades < richTrades) return "RICH_WITHOUT_TRADES";
  return null;
}
