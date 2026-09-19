// T38: making the failure say what it was. Four rounds of fixes went out for "the wallet button does
// not work" and not one of them could be confirmed or ruled out, because nothing outside the browser
// could see which of the causes was the live one. The console is no help: what lands there is the
// wallet extension talking to itself, and a call that fails inside a try/catch never reaches it. The
// facts that separate the causes are collected at the moment of the failure instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const DIAG = fs.readFileSync("app/src/lib/diagnose.js", "utf8");
const SITE = fs.readFileSync("app/src/Simple.jsx", "utf8");
const VITE = fs.readFileSync("app/vite.config.js", "utf8");

test("T38: the build in the browser is stamped, so a fix nobody deployed is not a fix that failed", () => {
  // The single most valuable fact, and the one that was missing: these two look identical from
  // outside. Vercel's own commit variable first, git second, neither fatal.
  assert.match(VITE, /__BUILD_COMMIT__: JSON\.stringify\(commit\)/);
  assert.match(VITE, /process\.env\.VERCEL_GIT_COMMIT_SHA/);
  assert.match(DIAG, /export const BUILD = \(\(\) => \{/);
  assert.match(DIAG, /build: BUILD,/);
  // It survives a bundler that does not define it rather than throwing on load.
  assert.match(DIAG, /catch \{ return \{ commit: "unknown", at: null \}; \}/);
  // And it really is in the built bundle, not merely configured.
  const bundle = fs.readdirSync("app/dist/assets").find(f => f.endsWith(".js"));
  assert.ok(bundle, "the app is built");
  assert.match(fs.readFileSync(`app/dist/assets/${bundle}`, "utf8"), /commit:"[0-9a-f]{7}"|commit:"unknown"/);
});

test("T38: the failing call is run, not described", () => {
  // A status and a body beat "it did not work" by the whole width of the problem, and every one of
  // the four causes answers with a different one.
  assert.match(DIAG, /try \{ out\.call = \{ ok: true, result: await attempt\(\) \}; \}/);
  assert.match(DIAG, /catch \(e\) \{ out\.call = \{ ok: false, status: e\?\.status \?\? null, error: e\?\.message \|\| String\(e\), body: e\?\.body \?\? null \}; \}/);
  assert.match(SITE, /attempt: \(\) => a\.ctw\(pk\)/);
});

test("T38: it captures what separates the causes from each other", () => {
  // Which wallet answered, which account it is on, whether a session exists: the wrong-account case
  // and the wrong-provider case are invisible without these and identical with each other.
  assert.match(DIAG, /accountMatches: p && wallet \? selectedAddress\(p\) === wallet : null,/);
  assert.match(DIAG, /if \(window\.solana\) injected\.push\("window\.solana" \+ \(window\.solana\.isPhantom \? " \(phantom\)" : window\.solana\.isMetaMask \? " \(metamask\)" : ""\)\);/);
  // And the server's side: which secrets are configured, and whether one instance is serving.
  assert.match(DIAG, /instances: a\.body\.instance === b\.body\?\.instance \? 1 : "more than one",/);
});

test("T38: no key and no token ever leave the page", () => {
  // It is going to be pasted into a chat window, so the session is reported as a boolean and the
  // wallet addresses are shortened. Nothing here reads a secret.
  assert.match(DIAG, /token = wallet \? !!localStorage\.getItem\("bondli_auth_" \+ wallet\) : null;/);
  assert.match(DIAG, /hasSession: token,/);
  // Checked against the code rather than the prose: the comments above it say the word "secret"
  // precisely because the code must not.
  const code = DIAG.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /secret|privateKey/i, "no secret is read, let alone reported");
  assert.doesNotMatch(code, /getItem\([^)]*\)\s*\|\||token:\s*token\b/, "the token is never carried as a value");
  // Addresses are shortened both ends rather than printed whole.
  assert.match(DIAG, /const short = w => \(w && w\.length > 12 \? `\$\{w\.slice\(0, 6\)\}…\$\{w\.slice\(-6\)\}` : w \|\| null\);/);
});

test("T38: it is reachable from every state the panel can be in", () => {
  // Any of the four can be the one that is wrong, so the way to report it cannot live inside one of
  // them. It sits below the branch, not in it.
  const block = SITE.slice(SITE.indexOf("{pk && !tw && <>"), SITE.indexOf("{pk && tw && !running && <>"));
  assert.ok(block.includes('t("panel.diagnose")'), "offered whichever state the panel is showing");
  assert.ok(block.lastIndexOf('t("panel.diagnose")') > block.lastIndexOf('t("panel.create")'), "after the branch, not inside it");
  const I18N = fs.readFileSync("app/src/lib/i18n.js", "utf8");
  for (const k of ["panel.diagnose", "panel.diagRunning", "panel.diagCopied", "panel.diagShown"]) {
    assert.equal((I18N.match(new RegExp(`"${k}":`, "g")) || []).length, 2, `${k} in en and zh`);
  }
});
