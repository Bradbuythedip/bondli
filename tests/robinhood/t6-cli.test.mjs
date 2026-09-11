// The launcher's simulator command, as a user runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("T6: `fleet-launch sim --json` runs a dead launch and reports a clean sweep", () => {
  const r = spawnSync(process.execPath, ["launch/robinhood/fleet-launch.mjs", "sim", "--scenario", "dead", "--seed", "1", "--minutes", "4", "--quiet", "--json"], { encoding: "utf8", timeout: 120_000 });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
  assert.equal(j.report.exitReason, "auto-rug"); assert.equal(j.report.strandedEth, 0); assert.equal(j.conservation.diff, "0");
});

test("T6: an unknown scenario or command fails with a message", () => {
  const a = spawnSync(process.execPath, ["launch/robinhood/fleet-launch.mjs", "sim", "--scenario", "nope"], { encoding: "utf8" }); assert.equal(a.status, 1); assert.match(a.stderr, /unknown scenario/);
  const b = spawnSync(process.execPath, ["launch/robinhood/fleet-launch.mjs", "wat"], { encoding: "utf8" }); assert.equal(b.status, 2);
});
