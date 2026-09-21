// ═══ PONS feed ═══
// The curve feed (../curve/feed.mjs) bound to the Robinhood Chain deployment.
import { CurveFeed, ethersRpc as curveRpc } from "../curve/feed.mjs";
import { PONS } from "./chain.mjs";

// The scoring helpers are the protocol's, not this deployment's; the Arc feed already imports them
// from here, so the path stays put.
export { Dynamics, quickFeatures, scoreToken } from "../curve/feed.mjs";

export function ethersRpc(rpcUrl) { return curveRpc(PONS, rpcUrl); }

export class PonsFeed extends CurveFeed {
  constructor(opts = {}) { super({ pollMs: 2_000, ...opts, deployment: PONS }); }
}
