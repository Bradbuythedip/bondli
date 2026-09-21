// ═══ PONS routers ═══
// The curve routers (../curve/router.mjs) bound to the Robinhood Chain deployment. There is nothing
// PONS-specific left to write: the protocol is shared with bondli's own launchpad by construction,
// so what used to be this file is now one deployment record away from serving both.
import { CurvePaperRouter, CurveLiveRouter, curveFillModel } from "../curve/router.mjs";
import { PONS } from "./chain.mjs";

export const ponsFillModel = curveFillModel;

export class PonsPaperRouter extends CurvePaperRouter {
  constructor(opts = {}) { super({ ...opts, deployment: PONS }); }
}
export class PonsLiveRouter extends CurveLiveRouter {
  constructor(opts = {}) { super({ ...opts, deployment: PONS }); }
}
