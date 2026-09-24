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
  extraSources = [],     // other launchpads on this chain: () => ({ name, address } | null), each with .env naming its variable
  extraFactoriesEnv = null, // ad-hoc extras: "name=0x...,name2=0x..." for launchpads nobody wrote a module for
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
    tokenSupply, quoteSymbol, blockMs, extraSources, extraFactoriesEnv,
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
  /**
   * Every launchpad this venue watches on its chain, home first: [{ name, address }].
   *
   * One chain can carry several deployments of the curve protocol — bondli's own launchpad and
   * hookit.fun both live on Ink — and a radar that watched only the home factory would be blind to
   * every launch on the others. The list is validated the way the home factory is: a malformed
   * address in any source throws rather than reading as "that launchpad is not there", because a
   * typo in an env var is the difference between trading a venue and not.
   *
   * Compatibility is self-verifying downstream, not asserted here: a factory that does not emit the
   * protocol's TokenLaunched produces no launches (its logs decode to nothing), and a token whose
   * curve does not answer the protocol's reads never becomes a candidate. A wrong entry in this
   * list yields silence, never a fabricated market.
   */
  d.factories = () => {
    const out = [];
    const push = (name, address) => {
      if (!address) return;
      if (!ADDRESS.test(address)) throw new Error(`${d.venue}: ${name} factory ${address} is not an address`);
      const a = address.toLowerCase();
      if (!out.some(f => f.address === a)) out.push({ name, address: a });
    };
    push("home", d.factoryAddress());
    for (const source of d.extraSources) {
      const r = source();
      if (r) push(r.name, r.address);
    }
    const adhoc = d.extraFactoriesEnv ? process.env[d.extraFactoriesEnv] : null;
    if (adhoc) for (const pair of adhoc.split(",")) {
      const [name, address] = pair.split("=").map(x => x?.trim());
      push(name || "extra", address);
    }
    return out;
  };
  /** What an operator sets to bring this venue up, for the refusal that names it. */
  d.configureHint = () => [d.factoryEnv, ...d.extraSources.map(s => s.env)].filter(Boolean).join(" or ");
  /** Whether this venue can trade at all. Read before going live, not at import. */
  d.configured = () => {
    try { return d.factories().length > 0; } catch { return false; }
  };
  d.rpcUrl = () => (d.rpcEnv && process.env[d.rpcEnv]) || d.defaultRpcUrl;
  d.network = () => ({ chainId: d.chainId, name: d.chainName });
  d.txUrl = (hash) => (d.explorer ? `${d.explorer}/tx/${hash}` : hash);

  return Object.freeze(d);
}
