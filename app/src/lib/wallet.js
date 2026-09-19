// ═══ Finding Phantom, and being sure it is Phantom ═══
// There were two lookups for the same provider and they did not agree. The panel required
// `isPhantom` before it would connect; the sign-in step took `window.phantom?.solana ||
// window.solana` and accepted whatever answered. With one wallet installed those are the same
// object. With two they need not be: `window.solana` is a single global that any extension can
// claim, and several now do -- MetaMask ships a Solana provider of its own. The address in the page
// then comes from one wallet and the signature from another, the server compares them, they do not
// match, and the user is told their signature does not match their wallet, which is true and
// useless. Everything resolves the provider here, the same way, once.
//
// `window.phantom.solana` is checked first because it is namespaced: Phantom owns that path and no
// other extension writes to it. The bare `window.solana` is only accepted when it says it is
// Phantom, and even then it is the fallback.

/** Phantom's provider, or null. Never another wallet, whatever it has claimed. */
export function phantom() {
  if (typeof window === "undefined") return null;
  const ns = window.phantom?.solana;
  if (ns?.isPhantom) return ns;
  const bare = window.solana;
  if (bare?.isPhantom) return bare;
  return null;
}

/** Why there is no Phantom to talk to. `squatted` means a wallet IS there and it is not Phantom,
 *  which is worth saying differently from "install Phantom" -- the user has a wallet, just not
 *  this one, and telling them to install what they have installed is a dead end. */
export function phantomAbsence() {
  if (typeof window === "undefined") return { reason: "no-window" };
  if (phantom()) return null;
  const other = window.solana || window.ethereum;
  if (other) {
    const name = other.isMetaMask ? "MetaMask" : other.isBackpack ? "Backpack" : other.isSolflare ? "Solflare" : null;
    return { reason: "squatted", other: name };
  }
  return { reason: "missing" };
}

/** The address Phantom currently has selected, or null when it has none. */
export function selectedAddress(p = phantom()) {
  try { return p?.publicKey ? p.publicKey.toString() : null; } catch { return null; }
}

/**
 * The provider, guaranteed to be Phantom, connected, and on `wallet`.
 *
 * The last of those is the one that used to be assumed. Phantom signs with whichever account is
 * selected right now, not with the one the page connected as, and it can be switched in the
 * extension at any moment without the page hearing about it. Signing then produces a valid
 * signature from the wrong key, the server rejects it as not matching, and nothing in that
 * exchange tells anyone what actually happened. Checked here, before the prompt.
 */
export async function providerFor(wallet) {
  const p = phantom();
  if (!p) {
    const why = phantomAbsence();
    throw new Error(why?.reason === "squatted"
      ? `Phantom is not available${why.other ? `: ${why.other} is answering instead` : ""}. Open this page with Phantom enabled.`
      : "Phantom is not installed");
  }
  if (!p.signMessage) throw new Error("this wallet cannot sign messages");
  // A provider that is not connected throws on signMessage with nothing useful in it.
  if (!selectedAddress(p)) {
    try { await p.connect(); } catch { throw new Error("Phantom did not connect"); }
  }
  const at = selectedAddress(p);
  if (wallet && at && at !== wallet) {
    throw new Error(`Phantom is on a different account (${at.slice(0, 4)}…${at.slice(-4)}). Switch back to ${wallet.slice(0, 4)}…${wallet.slice(-4)} in Phantom, or reconnect.`);
  }
  return p;
}
