// ═══ PONS on Robinhood Chain: the addresses this deployment lives at ═══
// Robinhood Chain is an Arbitrum-stack Ethereum L2 (chain id 4663, gas and quote asset ETH).
// PONS V2 launches a fixed 1,000,000,000-token ERC-20 into its own constant-product bonding-curve
// contract; trades hit that curve until the real quote reserve reaches graduationThreshold, then
// the pool moves to Uniswap V4. Source: github.com/ponsdotdev/ponsfamily (contractsV2/src/v2).
//
// The ABI, the log decoding and the curve arithmetic are not here: they are the protocol, shared
// with every other deployment of it (../curve/protocol.mjs). This file is the part that is true of
// Robinhood Chain and nowhere else. It re-exports the protocol so that every existing import of
// ./chain.mjs keeps working unchanged.
import { makeDeployment } from "../curve/deployment.mjs";
export * from "../curve/protocol.mjs";
import { mcapQuote as mcapOf } from "../curve/protocol.mjs";

export const CHAIN_ID = 4663;
export const DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com"; // public, rate-limited; PONS_RPC_URL for a paid one
export const EXPLORER = "https://robinhoodchain.blockscout.com";
export const FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";        // PonsV2LaunchFactory
export const LAUNCH_AND_BUY = "0xe33e9e479df8802cb0866d5d05258bec4cf62948"; // PonsV2LaunchAndBuy router
export const MEME_HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044";      // PonsV2MemeHook (graduated pools)
export const TOKEN_SUPPLY = 1_000_000_000;

export const PONS = makeDeployment({
  venue: "pons", chainId: CHAIN_ID, chainName: "robinhood", rpcEnv: "PONS_RPC_URL", secretEnv: "PONS_PRIVATE_KEY",
  defaultRpcUrl: DEFAULT_RPC_URL, explorer: EXPLORER, factory: FACTORY,
  launchAndBuy: LAUNCH_AND_BUY, memeHook: MEME_HOOK, tokenSupply: TOKEN_SUPPLY, quoteSymbol: "ETH",
});

/** Market cap from virtual reserves at this deployment's supply. */
export function mcapQuote(reserves, supply = TOKEN_SUPPLY) { return mcapOf(reserves, supply); }
