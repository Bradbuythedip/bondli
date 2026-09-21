// ═══ Ink feed ═══
// The curve feed (../curve/feed.mjs) bound to bondli's own launchpad on Ink.
//
// The poll interval is the chain's, not a constant. Ink produces a block a second — twice
// Robinhood Chain's rate — and a radar polling slower than the chain moves misses launches
// outright, which on a venue where we are the launchpad means missing our own.
import { CurveFeed, ethersRpc as curveRpc } from "../curve/feed.mjs";
import { INK } from "./chain.mjs";

export function ethersRpc(rpcUrl) { return curveRpc(INK, rpcUrl); }

export class InkFeed extends CurveFeed {
  constructor(opts = {}) { super({ ...opts, deployment: INK }); }
}
