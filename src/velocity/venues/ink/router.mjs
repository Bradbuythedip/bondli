// ═══ Ink routers ═══
// The curve routers (../curve/router.mjs) bound to bondli's own launchpad on Ink. There is nothing
// Ink-specific to write: the launchpad is the same curve protocol PONS runs, deliberately, so a
// second chain is a deployment record rather than a second router.
//
// The live router refuses to initialise until INK_LAUNCHPAD_FACTORY names a deployed launchpad.
// That refusal is the whole safety property of an unlaunched venue: without it every order would
// be built against an address with no code and come back as a revert.
import { CurvePaperRouter, CurveLiveRouter, curveFillModel } from "../curve/router.mjs";
import { INK } from "./chain.mjs";

export const inkFillModel = curveFillModel;

export class InkPaperRouter extends CurvePaperRouter {
  constructor(opts = {}) { super({ ...opts, deployment: INK }); }
}
export class InkLiveRouter extends CurveLiveRouter {
  constructor(opts = {}) { super({ ...opts, deployment: INK }); }
}
