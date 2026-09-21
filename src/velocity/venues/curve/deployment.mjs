// ═══ A deployment: one curve protocol, on one chain, behind one factory ═══
//
// Everything that differs between PONS on Robinhood Chain and bondli's own launchpad on Ink is in
// here, and it is all data. The protocol (protocol.mjs) is the same code for both.
//
// The factory address is the one field that may legitimately be unknown at import time: our own
// launchpad is deployed per chain by us, and a deployment record that hard-coded a placeholder
// would be worse than one that admits it does not know — the router would build orders against an
// address with no code and report them as reverts. `configured` is what the engine checks before
// it lets the venue go live.

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function makeDeployment({
  venue,                 // the engine's name for it: "pons", "ink"
  chainId,
  chainName,             // what ethers should call it, so a provider never has to detect it
  rpcEnv,                // the environment variable an operator points at their own endpoint
  secretEnv,             // ...and the one holding this chain's dedicated trading key
  defaultRpcUrl,
  explorer,
  factory = null,        // null when this chain has no deployment yet
  factoryEnv = null,     // ...and the variable that supplies one
  launchAndBuy = null,
  memeHook = null,
  tokenSupply = 1_000_000_000,
  quoteSymbol = "ETH",
  blockMs = 2_000,       // how fast this chain produces blocks; a radar's poll floor
} = {}) {
  if (!venue) throw new Error("a deployment needs a venue name");
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error(`${venue}: a deployment needs a chain id`);
  if (!defaultRpcUrl) throw new Error(`${venue}: a deployment needs a default RPC url`);
  if (factory != null && !ADDRESS.test(factory)) throw new Error(`${venue}: factory ${factory} is not an address`);

  const d = {
    venue, chainId, chainName: chainName || venue, rpcEnv, secretEnv: secretEnv || `${String(venue).toUpperCase()}_PRIVATE_KEY`, defaultRpcUrl, explorer,
    factory: factory ? factory.toLowerCase() : null, factoryEnv, launchAndBuy, memeHook,
    tokenSupply, quoteSymbol, blockMs,
  };

  /** The factory, from the environment if this chain's address is not compiled in. */
  d.factoryAddress = () => {
    const fromEnv = d.factoryEnv ? process.env[d.factoryEnv] : null;
    if (fromEnv) {
      if (!ADDRESS.test(fromEnv)) throw new Error(`${d.venue}: ${d.factoryEnv}=${fromEnv} is not an address`);
      return fromEnv.toLowerCase();
    }
    return d.factory;
  };
  /** Whether this venue can trade at all. Read before going live, not at import. */
  d.configured = () => {
    try { return !!d.factoryAddress(); } catch { return false; }
  };
  d.rpcUrl = () => (d.rpcEnv && process.env[d.rpcEnv]) || d.defaultRpcUrl;
  d.network = () => ({ chainId: d.chainId, name: d.chainName });
  d.txUrl = (hash) => (d.explorer ? `${d.explorer}/tx/${hash}` : hash);

  return Object.freeze(d);
}
