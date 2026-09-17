// T18: a token picture is never put on screen half-drawn.
//
// The tile used to mount the <img> immediately and fade it in on the load event. load says the BYTES
// arrived, not that there is a frame ready to present: a progressive JPEG or a large PNG can be
// revealed mid-decode and paint in bands, which on a list of twenty-five launches is the flicker the
// page was accused of. decode() resolves only when the frame is ready, so the element is mounted
// after that and never before. Asserted on the source: the tile is inside one large component with
// no seam to render in isolation, and what matters is which API decides when the picture appears.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(path.resolve("app/src/Simple.jsx"), "utf8");
const TILE = SRC.slice(SRC.indexOf("function TokenImg"), SRC.indexOf("// ── Movers"));

test("T18: the picture is decoded before it is mounted, not faded in on load", () => {
  assert.ok(TILE.length > 200, "found the tile component");
  // The decision to show is decode()'s, and it is made off-screen on a detached Image.
  assert.match(TILE, /new Image\(\)/);
  assert.match(TILE, /img\.decode\(\)\.then\(done, fail\)/);
  // The visible element only exists once that resolved for THIS url -- not a stale one from the
  // previous token in a recycled row, which is why readiness stores the url rather than a boolean.
  assert.match(TILE, /const loaded = ready === full;/);
  assert.match(TILE, /\{loaded && <img src=\{full\}/);
  // The old behaviour is gone: no half-opaque, blurred img sitting in the tree while it loads.
  assert.doesNotMatch(TILE, /onLoad=/);
  assert.doesNotMatch(TILE, /opacity: loaded \? 1 : 0/);
  assert.doesNotMatch(TILE, /filter: loaded \? "blur\(0\)"/);
});

test("T18: a browser without decode() still works, and a failure still retries then gives up", () => {
  // decode() is not universal; the load event is the fallback, not an excuse to show nothing.
  assert.match(TILE, /else \{ img\.onload = done; img\.onerror = fail; \}/);
  // A token's picture usually appears a minute after its launch, so a miss is retried on a backoff
  // and only then replaced by the ticker. Both bounds are still here.
  assert.match(TILE, /tries < IMG_RETRY_MS\.length/);
  assert.match(TILE, /else sOk\(false\)/);
  // The schedule has to outlast the metadata (minutes, not a minute) and every gap after the first
  // has to clear the proxy's 30s negative cache, or the retry is an instant 404 that spends a try.
  const sched = JSON.parse(/const IMG_RETRY_MS = (\[[^\]]+\])/.exec(SRC)[1].replace(/_/g, ""));
  assert.ok(sched.reduce((a, b) => a + b, 0) >= 5 * 60_000, "keeps trying for at least five minutes");
  for (const gap of sched.slice(1)) assert.ok(gap >= 30_000, `gap ${gap} is inside the negative cache`);
  // The effect must not outlive the row: a resolved decode for an unmounted tile sets no state.
  assert.match(TILE, /return \(\) => \{ on = false; \};/);
});
