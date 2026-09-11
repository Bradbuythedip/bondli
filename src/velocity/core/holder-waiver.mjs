// ═══ VELOCITY — the holder fee waiver ═══
// Hold the house token and the performance fee is zero. One ERC-20 balance on Robinhood Chain decides
// it, read against the user's own EVM address and cached, so a close costs at most one balanceOf every
// few minutes rather than one per trade.
//
// Fail-safe, in the user's favour where it is honest to be: an RPC that answers "you hold it" is
// trusted for the whole TTL, and if a later read fails the last good answer stands rather than
// charging someone a fee because a node blinked. A user we have never successfully read is charged,
// because inventing a waiver from a failure would let anyone with a broken RPC trade free.
//
// Disabled until the token exists: with no address configured nothing is read, nothing is waived, and
// the rest of the fee path behaves exactly as it did before.
import { JsonRpcProvider, Contract } from "ethers";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];
const isAddress = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

export class HolderWaiver {
  /**
   * @param opts { token, minTokens, provider, rpcUrl, ttlMs, timeoutMs, clock, log, symbol }
   *   token      the ERC-20 whose holders trade free; unset disables the whole thing
   *   minTokens  how many whole tokens count as holding (default 1)
   *   provider   an ethers provider on the token's chain; else one is built from rpcUrl
   */
  constructor({ token = null, minTokens = 1, provider = null, rpcUrl = null, ttlMs = 5 * 60_000, timeoutMs = 6_000, clock = () => Date.now(), log = null, symbol = "NOTAFLY" } = {}) {
    this.token = isAddress(token) ? token : null;
    this.configuredButInvalid = !!token && !this.token;
    this.minTokens = Number(minTokens) > 0 ? Number(minTokens) : 1;
    this._provider = provider || null; this.rpcUrl = rpcUrl || null;
    this.ttlMs = ttlMs; this.timeoutMs = timeoutMs; this.clock = clock; this.log = log; this.symbol = symbol;
    this.cache = new Map(); // address -> { holds, at, balance }
    this.reads = 0; this.errors = 0; this.lastError = null; this._decimals = null;
  }

  get enabled() { return !!this.token; }

  provider() {
    if (!this._provider && this.rpcUrl) this._provider = new JsonRpcProvider(this.rpcUrl, undefined, { staticNetwork: true });
    return this._provider;
  }

  /** Whole tokens `address` holds, or null when it cannot be read. */
  async balanceOf(address) {
    const p = this.provider();
    if (!p || !this.token || !isAddress(address)) return null;
    const c = new Contract(this.token, ERC20_ABI, p);
    if (this._decimals == null) { try { this._decimals = Number(await c.decimals()); } catch { this._decimals = 18; } }
    const raw = BigInt(await c.balanceOf(address));
    return Number(raw / 10n ** BigInt(Math.max(0, this._decimals - 6))) / 1e6;
  }

  /**
   * Does this address hold enough to trade free? Cached for ttlMs. Never throws: an unreadable
   * balance keeps the last good answer, or charges the fee when there has never been one.
   */
  async holds(address) {
    if (!this.enabled || !isAddress(address)) return false;
    const key = address.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && this.clock() - hit.at < this.ttlMs) return hit.holds;
    try {
      const balance = await Promise.race([
        this.balanceOf(address),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`balanceOf timed out after ${this.timeoutMs}ms`)), this.timeoutMs)),
      ]);
      this.reads++;
      if (balance == null) throw new Error("no provider for the token's chain");
      const holds = balance >= this.minTokens;
      this.cache.set(key, { holds, at: this.clock(), balance });
      if (this.cache.size > 5000) this.cache.delete(this.cache.keys().next().value);
      return holds;
    } catch (err) {
      this.errors++; this.lastError = String(err?.message || err).slice(0, 200);
      this.log?.warn?.(`[WAIVER] ${this.symbol} balance of ${address.slice(0, 10)} unreadable: ${this.lastError}${hit ? " (keeping the last answer)" : ""}`);
      if (hit) { hit.at = this.clock() - this.ttlMs / 2; return hit.holds; } // keep it, retry sooner
      return false;
    }
  }

  /** What the last read said, without reading again. */
  cached(address) { return isAddress(address) ? (this.cache.get(address.toLowerCase()) || null) : null; }
  forget(address) { if (isAddress(address)) this.cache.delete(address.toLowerCase()); }

  status() {
    return { enabled: this.enabled, token: this.token, symbol: this.symbol, minTokens: this.minTokens, ttlMs: this.ttlMs, cached: this.cache.size, reads: this.reads, errors: this.errors, lastError: this.lastError, misconfigured: this.configuredButInvalid };
  }
}

export default HolderWaiver;
