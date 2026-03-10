// BONDLI v3.1 — Fee Engine
// Tiers: Free (25% profit share), Pro (0%, 10 SOL one-time), VIP (0%, whitelisted)
import crypto from "crypto";

// ── Platform config ──
const PLATFORM_WALLET = process.env.PLATFORM_WALLET || "4XnHZZmHwSQ8RszJsdc7snvxG8dZtm6g4hvpkCMkguMx";
const FREE_PROFIT_CUT = parseFloat(process.env.FREE_PROFIT_CUT || "25"); // %
const PRO_FEE_SOL = parseFloat(process.env.PRO_FEE_SOL || "10");
const MIN_PROFIT_THRESHOLD = 0.001; // SOL — don't skim dust

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
export function calculateFee(solIn, solReturn, wallet, tier = "free") {
  // Owners/VIP/Pro: zero fee always
  if (isOwnerWallet(wallet) || tier === "pro" || tier === "vip") {
    return { fee: 0, type: "none", tier, net: +(solReturn - solIn).toFixed(6), isOwner: isOwnerWallet(wallet) };
  }
  // Free tier: profit share on gains only
  const net = +(solReturn - solIn).toFixed(6);
  if (net > MIN_PROFIT_THRESHOLD) {
    const fee = +(net * FREE_PROFIT_CUT / 100).toFixed(6);
    return { fee, type: "profit-share", tier: "free", rate: FREE_PROFIT_CUT, net };
  }
  // No profit or loss: no fee
  return { fee: 0, type: "none", tier: "free", net };
}

// ── Profit config builder ──
// Returns profitConfig for skimSweep, or null if no skim needed
export function buildProfitConfig(tier, whitelisted = false) {
  if (tier === "free" && !whitelisted) {
    return { cutPercent: FREE_PROFIT_CUT, platformWallet: PLATFORM_WALLET };
  }
  return null; // Pro/VIP: no skim
}

// ── Fee tier info (for UI display) ──
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
  PRO_FEE_SOL,
  MIN_PROFIT_THRESHOLD,
};
