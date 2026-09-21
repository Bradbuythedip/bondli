// ═══ Ink: two launchpads, their addresses, ABIs and the pure maths over them ═══
//
// Ink is Kraken's OP-Stack L2 (chain id 57073, gas and quote asset ETH, one-second blocks). Two
// launchpads run on it and they are not the same kind of thing, which is the whole reason this
// module holds both:
//
//   TSUNAMI is a bonding-curve launchpad, the shape bondli was built for. A token is priced by its
//     own curve contract until the curve's sellable reserve drains, at which point the raise seeds a
//     pool on Calamari (a Uniswap v4 deployment with its own PoolManager singleton) and the curve
//     closes. That is pump.fun's life cycle with different nouns, so the dip read, the curve gates
//     and the graduation logic all have something to say about it.
//
//   SENTRY has no curve at all. A launch opens directly as a Uniswap pool -- v3 for the original
//     factories, v4 for the current one -- with the LP position permanently locked in the factory or
//     in an immutable vault. There is no curve progress to measure because the token is a pool from
//     its first block. To bondli's models a Sentry launch looks like a token that has ALREADY
//     graduated, at minute zero. Sentry also runs on Robinhood Chain, which bondli already reads for
//     PONS, so that side needs no new RPC.
//
// Everything here is pure: addresses, ABIs, decoders and maths, no network. The feed and the router
// are the only things that talk to a chain.
//
// PROVENANCE. Every address below is taken from DefiLlama's adapters for these protocols, which are
// public, reviewed and matched against on-chain TVL:
//   Tsunami   DefiLlama-Adapters projects/tsunami/index.js and dimension-adapters PR #9548
//   Calamari  DefiLlama-Adapters projects/calamari/index.js
//   Sentry    DefiLlama-Adapters projects/sentry-trading/index.js
// WETH on Ink is the OP-Stack predeploy. Nothing here is guessed; what is NOT yet known is listed in
// NEEDS_VERIFIED_SOURCE at the bottom, and no live order can be built until those are read off the
// verified contracts rather than inferred.
import { Interface, id as keccakId, keccak256, AbiCoder } from "ethers";

export const CHAIN_ID = 57073;                                     // 0xdef1
export const CHAIN_NAME = "ink";
// Public and rate-limited. One-second blocks mean a launch radar polls hard, so INK_RPC_URL should
// be an operator's own endpoint in production -- exactly the lesson Arc taught.
export const DEFAULT_RPC_URLS = Object.freeze([
  "https://rpc-gel.inkonchain.com",
  "https://rpc.nodeflare.app/ink/public",
]);
export const DEFAULT_RPC_URL = DEFAULT_RPC_URLS[0];
export const EXPLORER = "https://explorer.inkonchain.com";
export const BLOCK_MS = 1_000;

export const NATIVE_CURRENCY = "0x0000000000000000000000000000000000000000"; // how a v4 key spells ETH
export const WETH = "0x4200000000000000000000000000000000000006";           // OP-Stack predeploy
export const USDC = "0x2D270e6886d130D724215A266106e6832161EAEd";
export const QUOTE_IS_NATIVE = true;
export const QUOTE_DECIMALS = 18;
export const TOKEN_DECIMALS = 18;
export const BASIS_POINTS = 10_000;

// ── Tsunami ───────────────────────────────────────────────────────────────────
// A curve per token, registered on one factory. Graduation forwards the raise into a Calamari v4
// pool, so a token stops being priced by its curve and starts being priced by a pool.
export const TSUNAMI = Object.freeze({
  factory: "0x5934a5C377309453746EE8aa5194F671930c09fa",
  firstBlock: 54_686_019,          // 2026-08-31, the factory's deployment
  swapFeeBps: 100,                 // 1% charged by the hook on every trade
  // The creator's share of that fee. The original factory pays 30%; the factory added on 2026-09-13
  // pays 1%. Which one a token belongs to is told by the hook its pool was initialised with.
  creatorSplitBps: Object.freeze({ original: 3_000, second: 100 }),
});
// Calamari: the Uniswap v4 deployment a graduated Tsunami curve seeds.
export const CALAMARI = Object.freeze({
  poolManager: "0x6E4723A612831AfB9f5B2a5aE22723c37aAB9560",
  firstBlock: 54_652_108,
});
// Tsunami's hooks across generations. A Swap on the PoolManager is a Tsunami swap when its pool was
// initialised with one of these; the two current ones also say which fee split applies.
export const TSUNAMI_HOOKS = Object.freeze([
  { address: "0x5dC5426A33c1D095B9fD0449ac16F6AaeBEeE8cc", generation: "current", factory: "original" },
  { address: "0xAE08d8bFF05b19a32F0215123244e70DD54368Cc", generation: "current", factory: "second" },
  { address: "0xbA7286377D0369F566256770Dbe2FC59D13128cC", generation: "legacy", factory: "original" },
  { address: "0x110aAc8EE9cd4853fb2C12F4F73937996ECfA8CC", generation: "historical", factory: "original" },
]);
export const TSUNAMI_HOOK_SET = new Set(TSUNAMI_HOOKS.map(h => h.address.toLowerCase()));

export const TSUNAMI_FACTORY_ABI = [
  "function getLaunchedTokens() view returns (address[])",
  "function tokenCurves(address) view returns (address)",
  "function tokenQuotes(address) view returns (address)",
];
export const POOL_MANAGER_ABI = [
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
];
export const TSUNAMI_HOOK_ABI = [
  "event SwapFeeAccrued(address indexed currency, address indexed curve, uint256 amount)",
  "event SwapFeeAccrued(address indexed currency, uint256 amount)",
];

// ── Sentry ────────────────────────────────────────────────────────────────────
// Per chain, because Sentry runs on Ink and on Robinhood Chain, and bondli already has an RPC and a
// price feed for the second one. Each entry is [factory, the block it started at].
export const SENTRY = Object.freeze({
  ink: Object.freeze({
    chainId: CHAIN_ID,
    v3Factories: Object.freeze([
      Object.freeze({ address: "0xDc37e11B68052d1539fa23386eE58Ac444bf5BE1", firstBlock: 39_943_151, kind: "weth" }),
      // Sentry's own agent-launch factory. Worth naming rather than numbering: a launchpad for
      // agents is the population bondli's record is most likely to mean something to.
      Object.freeze({ address: "0x733733E8eAbB94832847AbF0E0EeD6031c3EB2E4", firstBlock: 40_126_112, kind: "agent" }),
    ]),
    v4Factories: Object.freeze([
      Object.freeze({ address: "0xcF44b151aee1Ef69677f24cadED4d2d61b0D45BD", firstBlock: 52_014_353, kind: "weth" }),
    ]),
    stateView: "0x76fd297e2d437cd7f76d50f01afe6160f86e9990",
    vault: "0x86585D4474C78c1C0fA1f8771682E9aD020787eC",   // the immutable SentryLPVault
    weth: WETH,
  }),
  robinhood: Object.freeze({
    chainId: 4663,
    v3Factories: Object.freeze([
      Object.freeze({ address: "0x9e8f6f8214b01Fd4Cf1d73FB1fb7cf9f811036Cb", firstBlock: 1_431_636, kind: "weth" }),
    ]),
    v4Factories: Object.freeze([
      Object.freeze({ address: "0x472286b7d5c1b2a3ce1132ef73d3bccf446c5cc1", firstBlock: 12_274_076, kind: "weth" }),
      // Tokenized stocks as the base asset. bondli has no model for these and must not judge them
      // with a memecoin edge; the feed keeps them apart rather than pretending they are launches.
      Object.freeze({ address: "0xd0A93885a387e3a8a14dd82776CF9104a3676b3A", firstBlock: 13_991_230, kind: "stock" }),
    ]),
    stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
    vault: "0x0F0E601041Ec765B8bAB8c166840E291253F2Df0",
    weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  }),
});
// The app fee Sentry charges on the ETH side of a swap routed through its fee router, and the LP fee
// on a Sentry-launched pool. Both are costs to a buyer and both belong in the cost model.
export const SENTRY_APP_FEE_BPS = 100;   // 1%
export const SENTRY_LP_FEE_BPS = 100;    // 1%, the pool's own tier

export const SENTRY_FACTORY_ABI = [
  "event PoolInitialized(address indexed pool, address indexed token)",
  "event TokenDeployed(address indexed token, string name, string symbol, address indexed creator, bytes32 indexed poolId)",
  "function launches(address) view returns (address baseToken, address creator, address hook, int24 tickLower, int24 tickUpper)",
];
export const STATE_VIEW_ABI = [
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getPositionInfo(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
];
export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];
// Sentry mints its v4 liquidity with a zero salt, so a position's key is just (owner, ticks).
export const ZERO_SALT = "0x" + "0".repeat(64);

export const poolManagerIface = new Interface(POOL_MANAGER_ABI);
export const sentryFactoryIface = new Interface(SENTRY_FACTORY_ABI);
export const tsunamiHookIface = new Interface(TSUNAMI_HOOK_ABI);
export const erc20Iface = new Interface(ERC20_ABI);

export const TOPICS = Object.freeze({
  Initialize: keccakId("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)"),
  Swap: keccakId("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"),
  PoolInitialized: keccakId("PoolInitialized(address,address)"),
  TokenDeployed: keccakId("TokenDeployed(address,string,string,address,bytes32)"),
  SwapFeeAccruedCurve: keccakId("SwapFeeAccrued(address,address,uint256)"),
  SwapFeeAccrued: keccakId("SwapFeeAccrued(address,uint256)"),
});

// ── Pure maths ────────────────────────────────────────────────────────────────

/** A v4 pool orders its two currencies by address; this says which side the launched token is. */
export function tokenIsToken0(token, quote) { return BigInt(token) < BigInt(quote); }

/** The v4 pool id: keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks)). */
export function poolIdFor({ token, quote, hook, fee, tickSpacing }) {
  const t0 = tokenIsToken0(token, quote);
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint24", "int24", "address"],
    [t0 ? token : quote, t0 ? quote : token, fee, tickSpacing, hook],
  ));
}

/**
 * Price of one token in the quote asset, from a v4 sqrtPriceX96.
 * sqrtPriceX96 is sqrt(token1/token0) in Q64.96, so the square is the raw ratio and the decimal
 * scale turns it into a price per whole token.
 */
export function priceFromSqrtX96(sqrtPriceX96, { tokenIs0, quoteDecimals = QUOTE_DECIMALS, tokenDecimals = TOKEN_DECIMALS } = {}) {
  const x = Number(sqrtPriceX96);
  if (!(x > 0)) return 0;
  const raw = (x / 2 ** 96) ** 2;
  if (!(raw > 0)) return 0;
  const scale = 10 ** (tokenDecimals - quoteDecimals);
  return tokenIs0 ? raw * scale : scale / raw;
}

/** Market cap in the quote asset. Supply is read from the token, never assumed: these launchpads do
 *  not all mint the same billion, and assuming one is how a $2.5k token gets served at $1.1M. */
export function mcapFrom(price, supply) {
  const p = Number(price), s = Number(supply);
  return p > 0 && s > 0 ? p * s : 0;
}

/** Whether a v4 Swap belongs to Tsunami, by the hook its pool was initialised with. */
export function isTsunamiHook(hook) { return TSUNAMI_HOOK_SET.has(String(hook || "").toLowerCase()); }

/** Which Tsunami factory a hook belongs to, and therefore the creator's share of the swap fee. */
export function tsunamiFeeSplit(hook) {
  const h = TSUNAMI_HOOKS.find(x => x.address.toLowerCase() === String(hook || "").toLowerCase());
  if (!h) return null;
  const creatorBps = TSUNAMI.creatorSplitBps[h.factory];
  return { generation: h.generation, factory: h.factory, swapFeeBps: TSUNAMI.swapFeeBps, creatorBps, platformBps: BASIS_POINTS - creatorBps };
}

/**
 * A buy's round-trip cost on each launchpad, as a fraction of the stake, for the cost model. Both
 * legs, because a position is only worth what it can be sold for.
 * Tsunami: the hook's 1% on the way in and the way out.
 * Sentry: the pool's 1% LP fee both ways, plus Sentry's 1% app fee on the ETH side of each swap when
 * the trade is routed through Sentry's own router. A direct pool swap pays only the LP fee, so the
 * router is what decides, and it is named rather than assumed.
 */
export function roundTripCostFraction(venueKind, { viaSentryRouter = true } = {}) {
  if (venueKind === "tsunami") return (2 * TSUNAMI.swapFeeBps) / BASIS_POINTS;
  if (venueKind === "sentry") {
    const perLeg = SENTRY_LP_FEE_BPS + (viaSentryRouter ? SENTRY_APP_FEE_BPS : 0);
    return (2 * perLeg) / BASIS_POINTS;
  }
  return 0;
}

/** How far a Tsunami curve has filled, from the quote it holds against the raise it needs. Null when
 *  the target is not known: a made-up denominator would read as progress. */
export function curveProgress(quoteHeld, graduationQuote) {
  const q = Number(quoteHeld), g = Number(graduationQuote);
  if (!(g > 0) || !(q >= 0)) return null;
  return Math.max(0, Math.min(1, q / g));
}

/** Decode one log against whichever interface can read it. Returns null for anything unrecognised
 *  rather than throwing, because a shared PoolManager carries every protocol's traffic. */
export function decodeLog(log) {
  const topic0 = log?.topics?.[0];
  if (!topic0) return null;
  for (const [iface, name] of [[poolManagerIface, "poolManager"], [sentryFactoryIface, "sentry"], [tsunamiHookIface, "hook"]]) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed) return { source: name, name: parsed.name, args: parsed.args, log };
    } catch { /* not this interface */ }
  }
  return null;
}

/**
 * A v4 Swap, as a trade: which side, how much quote moved, and at what price. amount0/amount1 are
 * signed from the POOL's point of view -- positive is into the pool -- so quote going in is a buy.
 */
export function classifySwap({ amount0, amount1, sqrtPriceX96 }, { tokenIs0, quoteDecimals = QUOTE_DECIMALS }) {
  const a0 = BigInt(amount0), a1 = BigInt(amount1);
  const quoteDelta = tokenIs0 ? a1 : a0;           // the quote leg
  const tokenDelta = tokenIs0 ? a0 : a1;
  const side = quoteDelta > 0n ? "buy" : quoteDelta < 0n ? "sell" : null;
  const abs = quoteDelta < 0n ? -quoteDelta : quoteDelta;
  return {
    side,
    quote: Number(abs) / 10 ** quoteDecimals,
    tokens: Number(tokenDelta < 0n ? -tokenDelta : tokenDelta) / 10 ** TOKEN_DECIMALS,
    price: priceFromSqrtX96(sqrtPriceX96, { tokenIs0, quoteDecimals }),
  };
}

/**
 * What is still unknown, and therefore what no live order may be built on yet. Each of these needs
 * reading off the verified contract on the explorer, not inferring: a swap path assembled from a
 * guessed selector spends real money on a revert, or worse, on the wrong call. The feed can run
 * without any of it -- discovery, pricing and judging need only what is above -- so the radar ships
 * first and the router waits for these.
 */
export const NEEDS_VERIFIED_SOURCE = Object.freeze([
  "Tsunami curve: the buy/sell function signatures, the reserve view, and the graduation target that curveProgress() needs as its denominator.",
  "Tsunami: the event a launch emits. getLaunchedTokens() is a full-array poll, which is fine for discovery but says nothing about WHEN a token appeared; an event gives the launch a timestamp, and every age-based gate needs one.",
  "Sentry v4 factory: the launch entry point bondli would call to create a token through it, with its arguments and fee.",
  "Sentry: the fee-router address, so a swap can be priced against the 1% app fee rather than around it.",
  "Both: the pool fee tier and tick spacing each launchpad initialises with, which poolIdFor() takes as arguments precisely because they are not yet pinned.",
]);

// ── bondli's own launchpad on Ink ─────────────────────────────────────────────
// Everything above this line is about somebody else's contracts — Tsunami's and Sentry's — and
// every gap in NEEDS_VERIFIED_SOURCE is a gap in what can be read about them from outside. This is
// the part that has no such gap: our own launchpad, whose ABI we wrote and whose behaviour is
// pinned by the tests in tests/launch. It is the same curve protocol PONS runs, deliberately, so
// trading it needs a deployment record and nothing else.
//
// The address is not compiled in because it does not exist yet: the contract is deployed per chain
// by us, and a placeholder here would be worse than an admission — the router would build orders
// against an address with no code and report them as reverts. INK_LAUNCHPAD_FACTORY supplies it,
// and until it does, deployment.configured() is false and the venue cannot go live.
import { makeDeployment } from "../curve/deployment.mjs";

export const INK = makeDeployment({
  venue: "ink",
  chainId: CHAIN_ID,
  chainName: CHAIN_NAME,
  rpcEnv: "INK_RPC_URL",
  defaultRpcUrl: DEFAULT_RPC_URL,
  explorer: EXPLORER,
  factory: null,
  factoryEnv: "INK_LAUNCHPAD_FACTORY",
  // The launch config's own supply. bondli's launchpad takes it as a constructor argument rather
  // than fixing it the way PONS does, so a deployment that mints a different number must say so
  // here or every market cap it reports is wrong by exactly that ratio.
  tokenSupply: 1_000_000_000,
  quoteSymbol: "ETH",
  blockMs: BLOCK_MS,
});
