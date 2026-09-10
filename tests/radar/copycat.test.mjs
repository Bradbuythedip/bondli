// Same-name launches: the copies are ads, never candidates; the original is marked as promoted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CopycatIndex, copycatKey } from "../../src/api/copycat.mjs";
import { makePumpfunEdge } from "../../src/velocity/venues/pumpfun/edge.mjs";
import { goodCandidatePayload } from "../velocity/helpers/fixtures.mjs";

test("copycat: later launches with the same name and ticker point at the first one", () => {
  const ix = new CopycatIndex({ windowMs: 60_000 });
  const t0 = 1_000_000;
  assert.equal(ix.note({ ca: "A", name: "Haaland Hair", ticker: "HAIR", createdAt: t0 }), null);
  assert.deepEqual(ix.note({ ca: "B", name: "haaland  hair!", ticker: "hair", createdAt: t0 + 5_000 }), { copyOf: "A", copies: 1, key: "haalandhair|hair" });
  assert.deepEqual(ix.note({ ca: "C", name: "HAALAND HAIR", ticker: "$HAIR", createdAt: t0 + 9_000 }), { copyOf: "A", copies: 2, key: "haalandhair|hair" });
  assert.deepEqual(ix.copiesOf("A"), { copies: 2, lastCopyAt: t0 + 9_000 });
  assert.deepEqual(ix.copiesOf("B"), { copies: 0, lastCopyAt: 0 });
  // a copy is never itself treated as an original for the next copy
  assert.equal(ix.note({ ca: "D", name: "Haaland Hair", ticker: "HAIR", createdAt: t0 + 12_000 }).copyOf, "A");
  // outside the window the name is free again
  assert.equal(ix.note({ ca: "E", name: "Haaland Hair", ticker: "HAIR", createdAt: t0 + 200_000 }), null);
  // same name, different ticker: not a copy; noting the same mint twice is idempotent
  assert.equal(ix.note({ ca: "F", name: "Haaland Hair", ticker: "HH", createdAt: t0 + 201_000 }), null);
  assert.equal(ix.note({ ca: "E", name: "Haaland Hair", ticker: "HAIR", createdAt: t0 + 200_000 }), null);
  assert.equal(copycatKey("", "X"), null); assert.equal(copycatKey("a", "X"), null); assert.equal(copycatKey("Ab", ""), null);
});

test("copycat: the velocity edge never produces a candidate for a copy", () => {
  const edge = makePumpfunEdge();
  const p = goodCandidatePayload("MintCopy"); p.token._copyOf = "MintOriginal";
  assert.equal(edge.ingest({ kind: "candidate", payload: p }).length, 0);
});
