// ═══ VELOCITY — Running a fleet plan (DP12b) ═══
//
// core/fleet.mjs decides the shape of an entry. This runs it, and it is deliberately not part of
// the engine: the orchestration is where the interesting failures live (a slice that fails halfway,
// a curve that moves under us, an exit leg that finds an empty wallet), and none of them need a
// store, a ledger or a clock that ticks by itself to reproduce.
//
// One position comes out. The engine upstream never learns that six transactions went in — it gets
// a weighted entry price, a summed quantity and a per-wallet holding list, which is exactly what it
// already handles for a single fill plus the one field the exit needs.

/** Weighted mean, guarding the degenerate case rather than returning NaN into a position record. */
function vwap(fills) {
  const qty = fills.reduce((s, f) => s + (f.qty || 0), 0);
  if (!(qty > 0)) return 0;
  return fills.reduce((s, f) => s + (f.price || 0) * (f.qty || 0), 0) / qty;
}

/**
 * Run an entry plan.
 *
 * `submit(order)` is the router's own submit — the actor rides on the order, so nothing here knows
 * how a wallet is signed for.
 *
 * Two stopping rules, and the asymmetry between them is the point:
 *
 *   the first slice failing ends the entry with nothing at risk, so it is simply a failed entry;
 *   a later slice failing leaves us holding tokens, and unwinding a partial ape costs a full round
 *     trip to undo a position we wanted anyway. We keep it and stop.
 *
 * The abort right is the only thing a split buys on a bonding curve (see core/fleet.mjs), so it is
 * measured against the price we actually got, not the one the model predicted: if the curve has
 * moved further than the slice's tolerance since the first fill, the remaining slices are buying a
 * different token than the one the gates approved.
 */
export async function executeFleetEntry({
  plan,
  order,
  submit,
  sleep = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve()),
  onSlice = () => {},
} = {}) {
  const slices = plan?.slices || [];
  if (!slices.length) return { ok: false, failure: { code: "NO_PLAN", reason: "the entry plan has no slices" } };

  const fills = [];
  const failures = [];
  let aborted = null;
  let waited = 0;
  let planned = 0;

  for (const slice of slices) {
    if (slice.at_ms > waited) { await sleep(slice.at_ms - waited); waited = slice.at_ms; }

    const sliceOrder = { ...order, id: `${order.id}:s${slice.order}`, stake_usd: slice.stake_usd, actor: slice.wallet };
    let r;
    try { r = await submit(sliceOrder); }
    catch (err) { r = { ok: false, failure: { code: "ROUTER_THREW", reason: err.message } }; }

    if (!r?.ok) {
      const f = { slice: slice.order, actor: slice.wallet, ...(r?.failure || { code: "NO_RESULT", reason: "router returned nothing" }) };
      failures.push(f);
      onSlice({ slice, failure: f });
      // Nothing filled yet: the entry simply did not happen, and the engine's own failure handling
      // (cooldowns, fee charges, pending-buy tracking) is the right thing to run.
      if (!fills.length) return { ok: false, failure: { ...(r?.failure || {}), code: r?.failure?.code || "NO_RESULT" }, failures, sliced: true };
      aborted = { code: "SLICE_FAILED", reason: `slice ${slice.order} on ${slice.wallet} failed: ${f.reason || f.code}` };
      break;
    }

    planned += slice.stake_usd;
    fills.push({ ...r.fill, actor: r.fill.actor ?? slice.wallet, wallet: r.fill.wallet ?? slice.wallet });
    onSlice({ slice, fill: r.fill });

    const first = fills[0].price;
    const last = r.fill.price;
    if (first > 0 && last > first) {
      const impact = ((last - first) / first) * 10_000;
      if (impact > slice.abort_if_impact_bps) {
        aborted = { code: "ABORT_IMPACT", reason: `slice ${slice.order} filled ${impact.toFixed(0)}bps above the first, over its ${slice.abort_if_impact_bps}bps tolerance` };
        break;
      }
    }
  }

  const qty = fills.reduce((s, f) => s + (f.qty || 0), 0);
  const notional = fills.reduce((s, f) => s + (f.notional_usd || 0), 0);
  // What the plan meant to spend and did not, because a slice failed or the abort right fired.
  // The engine sizes on the stake it asked for; this says how much of it is still in the wallets.
  const unspent = slices.reduce((s, x) => s + x.stake_usd, 0) - planned;

  return {
    ok: true,
    sliced: true,
    aborted,
    failures,
    fill: {
      ...fills[0],
      orderId: order.id,
      price: vwap(fills),
      qty,
      notional_usd: +notional.toFixed(4),
      fee_usd: +fills.reduce((s, f) => s + (f.fee_usd || 0), 0).toFixed(4),
      rent_usd: +fills.reduce((s, f) => s + (f.rent_usd || 0), 0).toFixed(4),
      sol_spent: fills.reduce((s, f) => s + (f.sol_spent || 0), 0) || null,
      // The latest confirmation is when the position was actually on, and the whole span is what it
      // cost in time — a fleet entry that reports the first slice's latency hides its own slowness.
      t_sent: fills[0].t_sent,
      t_filled: Math.max(...fills.map(f => f.t_filled || 0)),
      latency_ms: Math.max(...fills.map(f => f.t_filled || 0)) - fills[0].t_sent,
      // Slippage across the fleet is the thing the abort right watches, so it is reported, not
      // averaged away: the spread between the first fill and the worst one.
      slippage_bps: fills[0].price > 0 ? +(((Math.max(...fills.map(f => f.price)) - fills[0].price) / fills[0].price) * 10_000).toFixed(2) : null,
      exact: fills.every(f => f.exact),
      venue_ref: fills[0].venue_ref || null,
      venue_refs: fills.map(f => f.venue_ref).filter(Boolean),
      slices: fills.length,
      unspent_usd: +Math.max(0, unspent).toFixed(4),
      wallets: fills.map(f => ({ actor: f.actor, qty: f.qty, cost_usd: +(f.notional_usd || 0).toFixed(4), venue_ref: f.venue_ref || null })),
    },
  };
}

/**
 * Run an exit plan. Legs come from planExit, so the ordering and the stagger are already decided;
 * this only has to not lose money between them.
 *
 * A leg that finds nothing is not a failure. Between the plan and the send, the engine may have
 * closed that wallet on an earlier rung, or the account may have been emptied by a reclaim — the
 * position that matters is the one the other legs still hold.
 */
export async function executeFleetExit({
  legs = [],
  position,
  close,
  sleep = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve()),
  onLeg = () => {},
} = {}) {
  if (!legs.length) return { ok: false, failure: { code: "NO_LEGS", reason: "the exit plan has no legs" } };

  const fills = [];
  const failures = [];
  let waited = 0;

  for (const leg of legs) {
    if (leg.at_ms > waited) { await sleep(leg.at_ms - waited); waited = leg.at_ms; }
    let r;
    try { r = await close({ ...position, actor: leg.wallet }, leg.pct, { actor: leg.wallet }); }
    catch (err) { r = { ok: false, failure: { code: "ROUTER_THREW", reason: err.message } }; }
    if (r?.ok) { fills.push({ ...r.fill, actor: r.fill.actor ?? leg.wallet }); onLeg({ leg, fill: r.fill }); }
    else { const f = { actor: leg.wallet, ...(r?.failure || { code: "NO_RESULT", reason: "router returned nothing" }) }; failures.push(f); onLeg({ leg, failure: f }); }
  }

  // Every leg failed for the same reason: report it as the failure it is, rather than a sale of
  // nothing at a price of zero, which would book the position closed at a total loss.
  if (!fills.length) return { ok: false, failure: failures[0] || { code: "NO_RESULT", reason: "no leg returned a fill" }, failures, sliced: true };

  const qty = fills.reduce((s, f) => s + (f.qty || 0), 0);
  const proceeds = fills.reduce((s, f) => s + (f.notional_usd || 0), 0);
  return {
    ok: true,
    sliced: true,
    failures,
    fill: {
      ...fills[0],
      orderId: `${position.id}:close`,
      price: vwap(fills),
      qty,
      notional_usd: +proceeds.toFixed(4),
      fee_usd: +fills.reduce((s, f) => s + (f.fee_usd || 0), 0).toFixed(4),
      sol_received: fills.reduce((s, f) => s + (f.sol_received || 0), 0) || 0,
      t_sent: fills[0].t_sent,
      t_filled: Math.max(...fills.map(f => f.t_filled || 0)),
      latency_ms: Math.max(...fills.map(f => f.t_filled || 0)) - fills[0].t_sent,
      exact: fills.every(f => f.exact),
      venue_ref: fills[0].venue_ref || null,
      venue_refs: fills.map(f => f.venue_ref).filter(Boolean),
      legs_filled: fills.length,
      wallets: fills.map(f => ({ actor: f.actor, qty: f.qty, proceeds_usd: +(f.notional_usd || 0).toFixed(4) })),
    },
  };
}
