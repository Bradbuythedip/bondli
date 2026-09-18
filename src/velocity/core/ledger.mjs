// ═══ VELOCITY — Append-only ledger (DP6) ═══
// Every decision, order stage, fill, exit, outcome, halt, and governor verdict
// is written here with its reasons BEFORE the next action is taken.
// JSONL, one record per line, fsync on every append. A crash mid-line leaves a
// truncated tail that the reader tolerates; the previous records are intact.

import fs from "node:fs";
import path from "node:path";

export const RECORD_KINDS = Object.freeze([
  "decision", "order", "fill", "exit", "outcome", "halt", "resume",
  "reconcile", "weights", "governor", "alert", "heartbeat", "violation", "feed", "venue",
  "fee",  // a venue fee paid for nothing (a send that failed on chain): real money, charged to the day
  "rent", // an emptied token account closed and its rent taken back: real money, returned to the wallet
  "miss", // a candidate a rule refused that then ran anyway: the only record of what the rules cost
  "callout", // the bot's own fill, posted publicly with its tx and a hash written here first, so the track record cannot be edited after the fact
]);

// Order lifecycle stages, in order. The stage reached is what a crash reveals.
export const ORDER_STAGES = Object.freeze(["sized", "sent", "filled", "failed", "unwound"]);

// How much of each kind we keep in memory. Outcomes, exits and fills are the
// records every realized statistic is computed from, and they are rare: a live
// fortnight is tens of them. Decisions are the opposite -- the feed writes a
// REJECT for every token it looks at and refuses, hundreds an hour. While all
// of them shared one ring, the depth of the fourteen-day window the statistics
// promise was really a function of how many strangers' tokens the feed happened
// to refuse that hour, and a busy hour could push a month of our own trades out
// of memory without anything saying so. How often someone else launches garbage
// is not a property of our record and must not decide how much of it we can
// still see, so the kinds we compute on get rings of their own.
// Worth knowing before the next capacity estimate: these rings are PER ENGINE and the hosted hub
// runs one engine per tenant, so they are paid for once per user, not once per box.
export const KIND_LIMITS = Object.freeze({ outcome: 5_000, exit: 5_000, fill: 5_000 });

export class Ledger {
  constructor(file, { now = () => Date.now(), fsync = true, recentLimit = 20_000, kindLimits = KIND_LIMITS } = {}) {
    this.file = file;
    this.now = now;
    this.fsyncEnabled = fsync;
    this.recentLimit = recentLimit;
    this.kindLimits = Object.freeze({ ...kindLimits });
    this.seq = 0;
    this.recent = [];
    // A Map, not an object: kinds are read back off disk and a kind spelled
    // "constructor" would otherwise find something on Object's prototype.
    this.rings = new Map(Object.keys(this.kindLimits).map(k => [k, []]));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.repairedTail = false;
    if (fs.existsSync(file)) {
      this._repairTail();
      for (const rec of this.iterate()) {
        this.seq = Math.max(this.seq, rec.seq || 0);
        this._remember(rec);
      }
    }
  }

  /** A crash mid-write leaves a line without its newline. Terminate it so the
   *  next append starts clean; the fragment stays on disk and is skipped. */
  _repairTail() {
    const size = fs.statSync(this.file).size;
    if (size === 0) return;
    const fd = fs.openSync(this.file, "r+");
    try {
      const buf = Buffer.alloc(1);
      fs.readSync(fd, buf, 0, 1, size - 1);
      if (buf[0] !== 0x0a) {
        fs.writeSync(fd, "\n", size);
        fs.fsyncSync(fd);
        this.repairedTail = true;
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  /** The ring a kind is retained in, and the cap that trims it. */
  _ringFor(kind) {
    const ring = this.rings.get(kind);
    if (ring) return { ring, cap: this.kindLimits[kind] };
    return { ring: this.recent, cap: this.recentLimit };
  }

  _remember(rec) {
    const { ring, cap } = this._ringFor(rec.kind);
    ring.push(rec);
    if (ring.length > cap) ring.splice(0, ring.length - cap);
  }

  /** Records held in memory right now, across every ring. Bounded, always, by
   *  retentionBudget(): the rings never grow, they only rotate. */
  retainedCount() {
    let n = this.recent.length;
    for (const ring of this.rings.values()) n += ring.length;
    return n;
  }

  /** The ceiling retainedCount() can reach. */
  retentionBudget() {
    let n = this.recentLimit;
    for (const k of this.rings.keys()) n += this.kindLimits[k];
    return n;
  }

  /** Append one record. Returns the record with seq and ts filled in. */
  append(record) {
    if (!RECORD_KINDS.includes(record.kind)) throw new Error(`ledger: unknown record kind ${record.kind}`);
    if (record.kind === "order" && !ORDER_STAGES.includes(record.stage))
      throw new Error(`ledger: order record needs a stage in ${ORDER_STAGES.join(",")}`);
    const rec = { seq: ++this.seq, ts: record.ts ?? this.now(), ...record };
    const line = JSON.stringify(rec) + "\n";
    const fd = fs.openSync(this.file, "a");
    try {
      fs.writeSync(fd, line);
      if (this.fsyncEnabled) fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    this._remember(rec);
    return rec;
  }

  /** Iterate every record on disk. Tolerates a truncated final line. */
  *iterate() {
    if (!fs.existsSync(this.file)) return;
    const text = fs.readFileSync(this.file, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch (err) {
        // A torn fragment from a crash mid-write: it never closed its object.
        // Skip it; every record before it is whole. Anything else is corruption.
        if (!line.trimEnd().endsWith("}")) continue;
        throw new Error(`ledger: corrupt record at line ${i + 1}: ${err.message}`);
      }
    }
  }

  readAll(filter = null) {
    const out = [];
    for (const rec of this.iterate()) if (!filter || filter(rec)) out.push(rec);
    return out;
  }

  /** Recent records from memory (fast path for the governor and status).
   *  Newest `limit` matches, returned oldest-first. Asking for one kind reads
   *  exactly one ring, because a kind lives in one ring and nowhere else; only
   *  an unfiltered ask has to walk them all, and it walks them newest-first in
   *  lockstep so the answer is the same one ring would have given. */
  query({ kind, venue, limit = 100, since = 0 } = {}) {
    if (kind) return this._scan(this._ringFor(kind).ring, kind, venue, limit, since);
    const rings = [this.recent, ...this.rings.values()];
    if (rings.length === 1) return this._scan(rings[0], kind, venue, limit, since);
    const at = rings.map(r => r.length - 1);
    const out = [];
    while (out.length < limit) {
      let pick = -1, newest = -Infinity;
      for (let i = 0; i < rings.length; i++) {
        if (at[i] < 0) continue;
        const seq = rings[i][at[i]].seq ?? 0;
        if (seq > newest) { newest = seq; pick = i; }
      }
      if (pick < 0) break;
      const r = rings[pick][at[pick]--];
      if (r.seq <= since) break;
      if (venue && r.venue !== venue) continue;
      out.push(r);
    }
    return out.reverse();
  }

  _scan(ring, kind, venue, limit, since) {
    const out = [];
    for (let i = ring.length - 1; i >= 0 && out.length < limit; i--) {
      const r = ring[i];
      if (r.seq <= since) break;
      if (kind && r.kind !== kind) continue;
      if (venue && r.venue !== venue) continue;
      out.push(r);
    }
    return out.reverse();
  }

  /** Latest stage an order reached, or null if never sized. */
  orderStage(orderId) {
    for (let i = this.recent.length - 1; i >= 0; i--) {
      const r = this.recent[i];
      if (r.kind === "order" && r.orderId === orderId) return r;
    }
    for (const r of this.readAll(r => r.kind === "order" && r.orderId === orderId).reverse()) return r;
    return null;
  }

  /** Everything recorded about one decision id, in order. */
  trail(decisionId) {
    return this.readAll(r => r.decisionId === decisionId || r.id === decisionId);
  }

  outcomes(venue = null, limit = 1000) {
    return this.query({ kind: "outcome", venue, limit });
  }

  lastDecision(venue = null) {
    const d = this.query({ kind: "decision", venue, limit: 1 });
    return d[0] || null;
  }
}
