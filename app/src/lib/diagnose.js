// ═══ One paste that says what actually happened ═══
// Four fixes have gone out for "the wallet button does not work" and none of them could be confirmed,
// because the only thing anyone could see from outside was that it did not work. The browser console
// is no help: what lands there is the wallet extension talking to itself, and a failed call inside a
// try/catch never reaches it at all. This collects, at the moment of the failure, the handful of
// facts that separate the causes from each other -- which build is running, which provider answered,
// which account it is on, whether there is a session, and exactly what the server said -- and puts
// them on the clipboard.
//
// It reports no secret and no key. The session token is reported as present or absent, never quoted.
import { API } from "./constants.js";
import { phantom, phantomAbsence, selectedAddress } from "./wallet.js";

/** The build in the browser, stamped at bundle time by vite.config.js. */
export const BUILD = (() => {
  try { return { commit: __BUILD_COMMIT__, at: __BUILD_AT__ }; } catch { return { commit: "unknown", at: null }; }
})();

const short = w => (w && w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-6)}` : w || null);

/** What the server needs from its environment, and whether one instance is serving or several. */
async function authHealth() {
  const one = async () => {
    const r = await fetch(API + "/api/auth/health", { cache: "no-store", signal: AbortSignal.timeout(10000) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    const a = await one(), b = await one();
    if (!a.body) return { reachable: a.status !== 0, status: a.status };
    return {
      status: a.status, ...a.body,
      // Two calls, on purpose: different ids mean more than one instance is serving, which is what
      // makes a process-local session key fail every other time instead of never.
      instances: a.body.instance === b.body?.instance ? 1 : "more than one",
    };
  } catch (e) { return { reachable: false, error: e.message }; }
}

/** The wallet side, as the page sees it right now. */
export function walletFacts(wallet) {
  const p = phantom();
  let token = null;
  try { token = wallet ? !!localStorage.getItem("bondli_auth_" + wallet) : null; } catch { token = "blocked"; }
  const injected = [];
  try {
    if (window.phantom?.solana) injected.push("window.phantom.solana" + (window.phantom.solana.isPhantom ? " (phantom)" : ""));
    if (window.solana) injected.push("window.solana" + (window.solana.isPhantom ? " (phantom)" : window.solana.isMetaMask ? " (metamask)" : ""));
    if (window.ethereum) injected.push("window.ethereum" + (window.ethereum.isMetaMask ? " (metamask)" : ""));
  } catch {}
  return {
    connectedAs: short(wallet),
    provider: p ? "phantom" : (phantomAbsence()?.other || "none"),
    providerAccount: short(selectedAddress(p)),
    // The mismatch that produces a valid signature the server then rejects as not matching.
    accountMatches: p && wallet ? selectedAddress(p) === wallet : null,
    hasSession: token,
    injected,
  };
}

/**
 * Everything, as text. `attempt` runs the call that is failing so its real answer is captured rather
 * than described -- a status and a body beat "it did not work" by the whole width of the problem.
 */
export async function diagnose({ wallet, attempt = null, label = "wallet" } = {}) {
  const out = {
    what: label,
    at: new Date().toISOString(),
    // The first thing to check, every time: a fix that was never deployed and a fix that did not
    // work look identical from the outside, and telling them apart used to be impossible.
    build: BUILD,
    api: API,
    page: typeof location === "undefined" ? null : location.origin,
    wallet: walletFacts(wallet),
  };
  if (attempt) {
    try { out.call = { ok: true, result: await attempt() }; }
    catch (e) { out.call = { ok: false, status: e?.status ?? null, error: e?.message || String(e), body: e?.body ?? null }; }
  }
  out.server = await authHealth();
  return JSON.stringify(out, null, 2);
}

/** Put it on the clipboard, falling back to a prompt the user can copy out of. */
export async function copyDiagnostics(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { try { window.prompt("Copy this:", text); } catch {} return false; }
}
