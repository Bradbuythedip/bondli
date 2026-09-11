// ═══ The launch banner: what bondli.fun shows about Bondli's own token ═══
// One JSON file on disk (the Railway volume), written by POST /api/launch from tools/launch-push.mjs
// and read by GET /api/launch every few seconds from the site. The site never needs a redeploy for
// a new address, status, or update line: push it here and it is live.
import fs from "node:fs";
import path from "node:path";

export const LAUNCH_STATUSES = Object.freeze(["soon", "live", "graduated", "off"]);
export const LAUNCH_VENUES = Object.freeze(["pons", "uniswap-v2"]);
export const LAUNCH_FIELDS = Object.freeze(["name", "ticker", "chain", "venue", "address", "curve", "pair", "status", "tagline", "image", "links"]);
const MAX_UPDATES = 20;

export function defaultLaunch() {
  return { name: "Not a fruit fly", ticker: "", chain: "robinhood", venue: "uniswap-v2", address: "", curve: "", pair: "", status: "soon", tagline: "Bondli's own token. Launching on Robinhood Chain.", image: "/fly.png", links: {}, updates: [], updatedAt: 0 };
}

const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || ""));

/** Apply one push to the stored state. Unknown fields are ignored; an `update` string is appended
 *  (newest first, capped); `reset: true` starts over from the defaults. Returns the new state or throws. */
export function mergeLaunch(state, body = {}, now = Date.now()) {
  const next = body.reset ? defaultLaunch() : { ...defaultLaunch(), ...state, links: { ...(state?.links || {}) }, updates: [...(state?.updates || [])] };
  for (const k of LAUNCH_FIELDS) {
    if (body[k] === undefined) continue;
    if (k === "links") { for (const [n, v] of Object.entries(body.links || {})) { if (v == null || v === "") delete next.links[n]; else next.links[n] = String(v).slice(0, 300); } continue; }
    if (k === "status") { if (!LAUNCH_STATUSES.includes(body.status)) throw new Error(`status must be one of ${LAUNCH_STATUSES.join(", ")}`); next.status = body.status; continue; }
    if (k === "venue") { if (!LAUNCH_VENUES.includes(body.venue)) throw new Error(`venue must be one of ${LAUNCH_VENUES.join(", ")}`); next.venue = body.venue; continue; }
    if (k === "address" || k === "curve" || k === "pair") { if (body[k] !== "" && !isAddr(body[k])) throw new Error(`${k} must be a 0x address`); next[k] = String(body[k]).toLowerCase(); continue; }
    next[k] = String(body[k]).slice(0, k === "tagline" ? 200 : 120);
  }
  if (body.update) next.updates = [{ at: now, text: String(body.update).slice(0, 280) }, ...next.updates].slice(0, MAX_UPDATES);
  if (body.clearUpdates) next.updates = [];
  // A live token needs an address; a pushed address without a status goes live by itself.
  if (next.address && body.address && body.status === undefined && next.status === "soon") next.status = "live";
  next.updatedAt = now;
  return next;
}

export class LaunchStore {
  constructor(file) { this.file = file; this.state = this._read(); }
  _read() { try { return { ...defaultLaunch(), ...JSON.parse(fs.readFileSync(this.file, "utf8")) }; } catch { return defaultLaunch(); } }
  push(body, now = Date.now()) {
    this.state = mergeLaunch(this.state, body, now);
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2)); } catch (err) { console.error("[LAUNCH] could not persist:", err.message); }
    return this.state;
  }
}
