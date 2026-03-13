// BONDLI v4.0 Config — Helius Enhanced + Volume Engine
import "dotenv/config";

// Auto-construct Helius URLs from API key
const _heliusKey = process.env.HELIUS_API_KEY || "";
const _heliusRpc = _heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${_heliusKey}` : "";
const _heliusWs  = _heliusKey ? `wss://mainnet.helius-rpc.com/?api-key=${_heliusKey}` : "";
const _heliusSendTx = _heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${_heliusKey}` : "";

export const CONFIG = {
  // Helius RPC (staked connections, priority fee API, smart transactions)
  RPC_URL:           process.env.RPC_URL || _heliusRpc || "https://api.mainnet-beta.solana.com",
  WS_URL:            process.env.WS_URL || _heliusWs || "",
  HELIUS_API_KEY:    _heliusKey,
  USE_HELIUS_ATLAS:  process.env.USE_HELIUS_ATLAS === "true",
  HELIUS_SEND_TX_URL: process.env.HELIUS_SEND_TX_URL || _heliusSendTx,
  HELIUS_SMART_TX:   process.env.HELIUS_SMART_TX !== "false", // default ON now
  MASTER_SEED:       process.env.MASTER_SEED || "",
  TOKEN_CA:          process.env.TOKEN_CA || process.argv[2] || "",
  TOKEN_WEIGHTS:     process.env.TOKEN_WEIGHTS || "",
  TOTAL_SOL:         parseFloat(process.env.TOTAL_SOL || "1"),
  SLIPPAGE_BPS:      parseInt(process.env.SLIPPAGE_BPS || "500"),
  PRIORITY_FEE:      parseInt(process.env.PRIORITY_FEE || "50000"),
  JITO_TIP:          parseInt(process.env.JITO_TIP || "10000"),
  RUN_DURATION_MIN:  parseInt(process.env.RUN_DURATION_MINUTES || "60"),
  DRY_RUN:           process.env.DRY_RUN === "true",
  X_BEARER_TOKEN:    process.env.X_BEARER_TOKEN || "",
  API_PORT:          parseInt(process.env.API_PORT || "3001"),
  API_SECRET:        process.env.API_SECRET || "bondli_default",
  PLATFORM_WALLET:   process.env.PLATFORM_WALLET || "anal.sol",
  FEE_SALT:          process.env.FEE_SALT || "bndl3xK9",
  PURGE_PERCENT:     parseInt(process.env.PURGE_PERCENT || "30"),

  // Volume engine — continuous self-trading
  VOLUME_MIN_INTERVAL_MS:  parseInt(process.env.VOLUME_MIN_INTERVAL_MS || "800"),   // fastest trade gap
  VOLUME_MAX_INTERVAL_MS:  parseInt(process.env.VOLUME_MAX_INTERVAL_MS || "4000"),  // slowest trade gap
  VOLUME_ESCALATION_RATE:  parseFloat(process.env.VOLUME_ESCALATION_RATE || "1.08"), // multiply volume each cycle
  VOLUME_MAX_MULTIPLIER:   parseFloat(process.env.VOLUME_MAX_MULTIPLIER || "5.0"),   // max escalation cap

  // Auto-rug — volume drought detection
  AUTO_RUG_ENABLED:        process.env.AUTO_RUG_ENABLED !== "false", // default ON
  AUTO_RUG_DROUGHT_SEC:    parseInt(process.env.AUTO_RUG_DROUGHT_SEC || "45"),       // seconds of no external volume
  AUTO_RUG_MIN_WAIT_SEC:   parseInt(process.env.AUTO_RUG_MIN_WAIT_SEC || "60"),      // minimum time before auto-rug can trigger
};

export const WALLET_ROLES = [
  { role: "sniper",      emoji: "\U0001f3af", weight: 0.08, desc: "Fast entry" },
  { role: "accumulator", emoji: "\U0001f41c", weight: 0.12, desc: "Micro-buys, builds floor" },
  { role: "momentum",    emoji: "\U0001f3ce\ufe0f",  weight: 0.22, desc: "Buy pressure, FOMO" },
  { role: "swing",       emoji: "\U0001f3a2", weight: 0.18, desc: "Buys dips, sells rips" },
  { role: "whale",       emoji: "\U0001f40b", weight: 0.28, desc: "Large trades at key moments" },
  { role: "liquidator",  emoji: "\U0001f4b0", weight: 0.08, desc: "Strategic profit-taking" },
  { role: "recycler",    emoji: "\u267b\ufe0f",  weight: 0.04, desc: "SOL recovery loop" },
];

export function getWalletCount(sol) {
  if (sol <= 0.5)  return 3;
  if (sol <= 1)    return 5;
  if (sol <= 2)    return 7;
  if (sol <= 5)    return 10;
  if (sol <= 10)   return 13;
  if (sol <= 20)   return 16;
  return 20;
}

export const PHASES = {
  DEPLOY:     { min: 0,     max: 500   },
  SNIPE:      { min: 500,   max: 3000  },
  ACCUMULATE: { min: 3000,  max: 30000 },
  MOMENTUM:   { min: 10000, max: 60000 },
  SWING:      { min: 30000, max: 180000 },
  WHALE:      { min: 60000, max: 300000 },
  LIQUIDATE:  { min: 120000, max: 600000 },
  PURGE:      { min: 300000, max: 900000 },
  EXIT:       { min: 600000, max: null },
};

export default CONFIG;
