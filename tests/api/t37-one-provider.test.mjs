// T37: one wallet provider, resolved one way. There were two lookups for the same thing and they did
// not agree. The panel required isPhantom before it would connect; the sign-in step took
// `window.phantom?.solana || window.solana` and accepted whatever answered. With one wallet
// installed those are the same object. With two they need not be -- `window.solana` is a single
// global any extension can claim, and several now do -- so the address came from one wallet and the
// signature from another, and the server rejected a signature that was perfectly valid.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { phantom, phantomAbsence, selectedAddress, providerFor } from "../../app/src/lib/wallet.js";

/** Stand up a window with whatever providers, and take it down again. */
async function withWindow(win, fn) {
  const had = "window" in globalThis, prev = globalThis.window;
  globalThis.window = win;
  try { return await fn(); } finally { if (had) globalThis.window = prev; else delete globalThis.window; }
}
const PK = "4XnHZZmHwSQ8RszJsdc7snvxG8dZtm6g4hvpkCMkguMx";
const OTHER = "9aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890aBcDeFg";
const phantomProvider = (addr = PK) => ({ isPhantom: true, signMessage: async () => ({}), publicKey: addr ? { toString: () => addr } : null, connect: async () => ({ publicKey: { toString: () => PK } }) });
const metamask = () => ({ isMetaMask: true, signMessage: async () => ({}), publicKey: { toString: () => OTHER } });

test("T37: another wallet holding window.solana is never mistaken for Phantom", async () => {
  // The exact shape a user with MetaMask installed presents. The old sign-in lookup would have taken
  // this object and asked it to sign, because it only checked that something was there.
  await withWindow({ solana: metamask(), ethereum: metamask() }, async () => {
    assert.equal(phantom(), null);
    assert.deepEqual(phantomAbsence(), { reason: "squatted", other: "MetaMask" });
    await assert.rejects(() => providerFor(PK), /MetaMask is answering instead/);
  });
  // No wallet at all is a different message, because "install Phantom" is only useful to someone who
  // has not got one.
  await withWindow({}, () => assert.deepEqual(phantomAbsence(), { reason: "missing" }));
});

test("T37: Phantom is found by its own namespace even when the global is taken", async () => {
  // window.phantom.solana is the path Phantom owns and no other extension writes to. window.solana
  // is first-come-first-served, so it is the fallback and only when it says it is Phantom.
  const p = phantomProvider();
  await withWindow({ phantom: { solana: p }, solana: metamask() }, () => {
    assert.equal(phantom(), p, "the namespaced one wins over the squatted global");
    assert.equal(phantomAbsence(), null);
    assert.equal(selectedAddress(), PK);
  });
  const bare = phantomProvider();
  await withWindow({ solana: bare }, () => assert.equal(phantom(), bare, "the bare global is accepted when it IS Phantom"));
});

test("T37: signing is refused when Phantom is on a different account", async () => {
  // Phantom signs with whichever account is selected NOW, not the one the page connected as, and it
  // can be switched in the extension without the page hearing. That produced a valid signature from
  // the wrong key, which the server rejected as not matching -- true, and impossible to act on.
  await withWindow({ phantom: { solana: phantomProvider(OTHER) } }, async () => {
    await assert.rejects(() => providerFor(PK), /different account/);
    await assert.rejects(() => providerFor(PK), new RegExp(OTHER.slice(0, 4)), "it names the account it is on");
  });
  // On the right account it simply returns the provider.
  await withWindow({ phantom: { solana: phantomProvider(PK) } }, async () => {
    assert.equal(selectedAddress(await providerFor(PK)), PK);
  });
  // Disconnected: connect first rather than throwing whatever signMessage throws.
  await withWindow({ phantom: { solana: phantomProvider(null) } }, async () => {
    assert.ok(await providerFor(PK), "a disconnected provider is connected, not rejected");
  });
});

test("T37: nothing reaches for window.solana on its own any more", () => {
  const CLIENT = fs.readFileSync("app/src/lib/api-client.js", "utf8");
  const SITE = fs.readFileSync("app/src/Simple.jsx", "utf8");
  assert.doesNotMatch(CLIENT, /window[?.]*\.solana[^`]/, "the sign-in step goes through the resolver, not the global");
  assert.match(CLIENT, /const p = await providerFor\(this\.w\);/);
  assert.doesNotMatch(SITE, /window[?.]*\.solana[^ ]/, "and so does the panel");
  assert.match(SITE, /import \{ phantom, phantomAbsence \} from "\.\/lib\/wallet\.js";/);
  // Only one definition of what Phantom is, in the module that exists to hold it.
  assert.equal((SITE.match(/const phantom = /g) || []).length, 0, "the panel no longer keeps its own");
});
