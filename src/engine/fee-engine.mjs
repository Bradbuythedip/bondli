// BONDLI v3.0 — Fee Engine
import crypto from "crypto";
const PLATFORM_WALLET = "anal.sol";
const _SALT = process.env.FEE_SALT || "bndl3xK9";
const _OH = new Set();

function _h(v) {
  return crypto.createHash("sha256").update(v + _SALT).digest("hex");
}

export function registerOwner(pk) {
  _OH.add(_h(pk));
}

export function isOwnerWallet(w) {
  if (w === PLATFORM_WALLET) return true;
  const h = _h(w);
  for (const o of _OH) {
    try {
      if (crypto.timingSafeEqual(Buffer.from(h), Buffer.from(o))) return true;
    } catch {}
  }
  return false;
}

// Profit tiers: minutes held -> rate
const PT = [
  { m: 1,        r: 0.10 },
  { m: 5,        r: 0.12 },
  { m: 15,       r: 0.15 },
  { m: 30,       r: 0.18 },
  { m: Infinity,  r: 0.20 },
];

// Loss tiers: minutes held -> flat fee
const LT = [
  { m: 1,        f: 0.002 },
  { m: 5,        f: 0.005 },
  { m: 15,       f: 0.010 },
  { m: 30,       f: 0.015 },
  { m: Infinity,  f: 0.020 },
];

export function calculateFee(solIn, solReturn, wallet) {
  if (isOwnerWallet(wallet)) {
    return { fee: 0, type: "owner", isOwner: true };
  }
  const net = +(solReturn - solIn).toFixed(6);
  if (net > 0) {
    const rate = PT.find(t => solIn <= t.m).r;
    return {
      fee: Math.max(+(net * rate).toFixed(6), 0.001),
      type: "profit-share",
      rate,
      net,
    };
  }
  return {
    fee: LT.find(t => solIn <= t.m).f,
    type: "infra",
    net,
  };
}

export function getFeeTier(sol) {
  return {
    profitRate: PT.find(t => sol <= t.m).r,
    lossFee:    LT.find(t => sol <= t.m).f,
  };
}

export function validateFee(claimed, solIn, solReturn, wallet) {
  const actual = calculateFee(solIn, solReturn, wallet);
  return Math.abs(actual.fee - claimed) < 1e-6;
}

export { PLATFORM_WALLET, PT as PROFIT_TIERS, LT as LOSS_TIERS };
