// ═══ Time and chance, injectable ═══
// Every module in this folder takes its clock, its sleep and its randomness from the session it runs
// in, never from Date.now / setTimeout / Math.random. Live, they are the real ones. In the simulator,
// the clock is virtual: sleep(ms) parks the caller on a discrete-event scheduler and time jumps to the
// next waiter, so a twelve-minute launch plays out in a few hundred milliseconds and two runs with the
// same seed replay the same decisions.

/** Deterministic PRNG (mulberry32). Returns a function in [0, 1). */
export function seededRng(seed = 1) {
  let a = (Number(seed) >>> 0) || 1;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Real time. */
export function realClock() {
  return { now: () => Date.now(), sleep: (ms) => new Promise(r => setTimeout(r, Math.max(0, ms))), virtual: false };
}

/** Virtual time with a discrete-event scheduler. */
export class VirtualClock {
  constructor(startMs = 1_800_000_000_000) {
    this.t = startMs; this.virtual = true;
    this._q = []; this._seq = 0; this._draining = false;
    this.now = () => this.t;
    this.sleep = (ms) => this._sleep(ms);
  }
  _sleep(ms) {
    return new Promise(resolve => {
      const at = this.t + Math.max(0, Number(ms) || 0);
      this._q.push({ at, seq: this._seq++, resolve });
      this._q.sort((a, b) => a.at - b.at || a.seq - b.seq);
      if (!this._draining) { this._draining = true; setImmediate(() => this._drain()); }
    });
  }
  async _drain() {
    // Fire the earliest waiter, then yield a macrotask so the woken code runs up to its next await
    // (and registers its next timer) before time moves again. Ends when nobody is waiting.
    while (this._q.length) {
      const w = this._q.shift();
      if (w.at > this.t) this.t = w.at;
      w.resolve();
      await new Promise(r => setImmediate(r));
    }
    this._draining = false;
  }
  pending() { return this._q.length; }
}

/** Box-Muller gaussian around mean with stdDev, floored at zero. Ported from engine/anti-detection.mjs. */
export function gaussian(rng, mean, stdDev) {
  let u1; do { u1 = rng(); } while (u1 === 0);
  const u2 = rng();
  return Math.max(0, mean + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * stdDev);
}
/** Human-like delay: gaussian around base, with an occasional 'thinking' pause. */
export function humanDelay(rng, baseMs = 3000, jitterFactor = 0.4) {
  const d = gaussian(rng, baseMs, baseMs * jitterFactor);
  if (rng() < 0.05) return d + gaussian(rng, 5000, 1500);
  return Math.max(300, d);
}
/** A trade size a human would type: never a suspiciously round number, never exactly the plan. */
export function humanAmount(rng, base, variance = 0.15) {
  const raw = gaussian(rng, base, base * variance);
  if (raw > 1) return Math.round(raw * 1000) / 1000;
  if (raw > 0.1) return Math.round(raw * 10000) / 10000;
  return Math.round(raw * 1e6) / 1e6;
}
export const jitter = (rng, base, variance) => base + (rng() - 0.5) * 2 * variance;
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const shuffle = (rng, arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
