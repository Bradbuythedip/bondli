// ═══ VELOCITY — Keeping the fleet funded (DP12c) ═══
//
// FR: a slice must never wait on a transfer.
//
// The obvious design funds the wallets at the moment of entry, out of the stake the sizer just
// approved. It is wrong for one reason that outweighs everything in its favour: a transfer has to
// confirm before the slice that spends it can be built, and on a fresh curve the seconds that costs
// are the whole trade. The fleet would make every entry slower in order to make each entry harder to
// read, which is a bad bargain in exactly the case it was built for.
//
// So the fleet holds working capital. Each wallet keeps roughly what one slice needs plus its own
// headroom, topped up between entries rather than during one, and the top-up is hysteretic: refill
// only when a wallet has fallen well below target, or the maintenance loop spends its gas moving
// dust back and forth on every pass.
//
// The money is never at risk in a way it was not already: these are the user's own derived wallets,
// funded from the user's own root, and the sweep brings it home. What it does change is that the
// root's balance no longer tells the whole story — anything reading a wallet total has to ask for
// the fleet's, which is why the router reports them together.

import { HEADROOM } from "./fleet.mjs";

/** Below this fraction of target, a wallet is topped up; above it, it is left alone. */
export const REFILL_AT = 0.6;
/** A sweep is only worth sending when it brings back this many times its own gas. */
export const SWEEP_WORTH = 5;

/**
 * What to move, and in which direction, to leave the fleet ready for the next entry.
 *
 * `perSliceUsd` is what one slice is expected to spend — the per-trade maximum divided across the
 * fleet, not the whole position, because a wallet only ever sends its own slice.
 *
 * Returns transfers in native units. Nothing here sends anything; the engine does, and it does it
 * outside the entry path.
 */
export function maintenancePlan({
  venue,
  root,
  balances = {},          // { address|label: native }
  perSliceUsd = 0,
  nativePriceUsd = 0,
  rootReserve = 0,        // native the root keeps for itself whatever the fleet needs
  idle = false,           // nothing open on this venue: bring the working capital home
} = {}) {
  if (!(nativePriceUsd > 0)) throw new Error("maintenancePlan needs the native price");
  const h = HEADROOM[venue] || { gas: 0, rent: 0 };
  const target = perSliceUsd / nativePriceUsd + h.gas + h.rent;
  const rootBalance = balances[root] || 0;

  const wallets = Object.entries(balances).filter(([w]) => w !== root);

  // Idle: the working capital earns nothing sitting in eight wallets, and a balance spread across
  // addresses is a balance the operator cannot see. Bring back anything worth the trip.
  if (idle) {
    const transfers = [];
    for (const [w, bal] of wallets) {
      const net = +(bal - h.gas).toFixed(9);
      if (net > h.gas * SWEEP_WORTH) transfers.push({ from: w, to: root, amount: net });
    }
    return { direction: "sweep", target: +target.toFixed(9), transfers, short: 0, fundable: transfers.length };
  }

  // Busy: top up whoever has fallen below the refill line, in the order of who is emptiest, so a
  // root that cannot cover everyone funds the wallets that most need it rather than the first few
  // the object happened to list.
  const hungry = wallets
    .filter(([, bal]) => bal < target * REFILL_AT)
    .map(([w, bal]) => ({ to: w, amount: +(target - bal).toFixed(9), have: bal }))
    .sort((a, b) => a.have - b.have);

  const spendable = Math.max(0, rootBalance - rootReserve - h.gas * (hungry.length || 0));
  const transfers = [];
  let left = spendable;
  for (const t of hungry) {
    if (t.amount > left) break;   // not a partial fill: a half-funded wallet fails its slice anyway
    transfers.push({ to: t.to, amount: t.amount });
    left = +(left - t.amount).toFixed(9);
  }
  const short = hungry.length - transfers.length;
  return { direction: "fund", target: +target.toFixed(9), transfers, short, fundable: transfers.length };
}

/**
 * Whether the fleet can carry an entry at all right now. The engine asks before it plans, because a
 * plan whose wallets are empty is worse than no plan: it spends the first slice, fails the rest and
 * leaves a partial position nobody chose.
 *
 * Returns the wallets that can actually pay, so the planner sizes to the fleet that exists rather
 * than the one that was configured.
 */
export function readyWallets({ venue, balances = {}, root, perSliceUsd = 0, nativePriceUsd = 0 }) {
  if (!(nativePriceUsd > 0)) return [];
  const h = HEADROOM[venue] || { gas: 0, rent: 0 };
  const need = perSliceUsd / nativePriceUsd + h.gas + h.rent;
  return Object.entries(balances).filter(([w, bal]) => w !== root && bal >= need).map(([w]) => w);
}
