// ═══ hookit.fun on Ink: the second launchpad the radar watches ═══
//
// hookit.fun is a permissionless launchpad in live test phase on Ink (chain 57073): dual-rail
// "Master" and "Classic" bonding, quote-only fees, locked LP, launches graduating into Uniswap v4.
// Its deployment addresses live in its repository (deploy/ink/addresses.json — a factory, a router
// and a bonding contract), which this environment cannot read, and its site is unreachable from
// here. So this module follows the same rule the Tsunami/Sentry work set and T41 pins: nothing
// live is built on a constant that was not read off verified source.
//
// What that means concretely: the addresses are NOT compiled in. HOOKIT_FACTORY supplies the
// factory at run time, read off the addresses file or the Ink explorer by the operator, and until
// it is set this source contributes nothing. A malformed value throws rather than reading as
// "hookit is not there", because a typo in that variable is the difference between watching a
// launchpad and not.
//
// Why the factory alone is enough to start: the radar's compatibility check is the chain itself.
// A factory that emits the curve protocol's TokenLaunched produces launches; one that does not
// produces logs that decode to nothing. A token whose bonding contract answers the protocol's
// reads (getReserves, feeBps, graduationThreshold) becomes a candidate; one that does not stays
// unreadable and is never judged, sized or bought. A wrong guess about hookit's ABI therefore
// yields silence, never a fabricated market — which is exactly the property that makes it safe to
// point the radar at a launchpad whose source this environment has not seen. First runs should
// still be paper, as every venue's are.

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** hookit's factory as an extra launchpad source for the INK deployment (deployment.extraSources). */
export function hookitSource() {
  const v = process.env.HOOKIT_FACTORY;
  if (!v) return null;
  if (!ADDRESS.test(v)) throw new Error(`ink: HOOKIT_FACTORY=${v} is not an address`);
  return { name: "hookit", address: v.toLowerCase() };
}
/** The variable an operator sets, for the refusal that names it. */
hookitSource.env = "HOOKIT_FACTORY";

/**
 * What integrating further needs, read off hookit's own repository or its verified contracts on
 * the Ink explorer — never inferred. Each entry names the artifact and what it unlocks.
 */
export const HOOKIT_NEEDS_VERIFIED_SOURCE = Object.freeze([
  "deploy/ink/addresses.json: the full factory, router and bonding addresses (search snippets truncate them, and a truncated address is not an address).",
  "The bonding contract's ABI: whether Classic bonding speaks the curve protocol's buy/sell/getReserves. If it does, HOOKIT_FACTORY is the whole integration; if not, trading it needs its own router the way Arc has one.",
  "Master-rail pricing: what a 'Master' launch is, how its modules price buys, and whether its trades emit events the radar can read at all.",
  "The router contract's role: whether buys are sent to the bonding contract directly (as PONS) or through the router (as pump.fun's trade-local), which decides what a live order signs.",
  "Quotrons wStocks: what they are and whether they appear on the same factory — if they do, the radar will see them and the gates need a rule for them.",
  "Fee schedule: 'quote-only fees' matches the curve protocol's design, but the numbers (feeBps, any creator tax, any opening tax) must be read, not assumed.",
]);
