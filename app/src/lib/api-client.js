import { API } from "./constants.js";
// Base58 for the signature bytes Phantom returns (no dependency needed for one encoder).
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(bytes) { let x = 0n; for (const b of bytes) x = x * 256n + BigInt(b); let out = ""; while (x > 0n) { out = B58[Number(x % 58n)] + out; x /= 58n; } for (const b of bytes) { if (b === 0) out = "1" + out; else break; } return out; }
const TOK = w => "bondli_auth_" + w;

class A {
  constructor() { this.w = null; this._signing = null; }
  sw(w) { this.w = w; }
  token() { try { return this.w ? localStorage.getItem(TOK(this.w)) : null; } catch { return null; } }
  // Proof of ownership: sign a server nonce with Phantom once; the token lasts 7 days and is sent as
  // Bearer on every call. Money routes refuse without it, so f() signs in on a 401 and retries once.
  async signIn() {
    if (!this.w) throw new Error("connect wallet first");
    if (this._signing) return this._signing;
    this._signing = (async () => {
      try {
        const p = window?.phantom?.solana || window?.solana;
        if (!p?.signMessage) throw new Error("wallet cannot sign");
        const c = await this.f("/api/auth/challenge", { method: "POST", body: { wallet: this.w }, noauth: true });
        const s = await p.signMessage(new TextEncoder().encode(c.message), "utf8");
        const v = await this.f("/api/auth/verify", { method: "POST", body: { wallet: this.w, signature: b58(s.signature || s) }, noauth: true });
        try { localStorage.setItem(TOK(this.w), v.token); } catch {}
        return v.token;
      } finally { this._signing = null; }
    })();
    return this._signing;
  }
  async f(p, o = {}) {
    const h = { "Content-Type": "application/json" };
    if (this.w) { h["X-Wallet"] = this.w; const t = this.token(); if (t && !o.noauth) h["Authorization"] = "Bearer " + t; }
    const r = await fetch(API + p, { headers: h, ...o, body: o.body ? JSON.stringify(o.body) : undefined, signal: o.signal || AbortSignal.timeout(o.timeout || 20000) });
    if (!r.ok) {
      const e = await r.json().catch(() => ({ error: r.statusText }));
      if (r.status === 401 && e.auth_required && !o.noauth && !o._retried) { await this.signIn(); return this.f(p, { ...o, _retried: true }); }
      throw new Error(e.error || `API ${r.status}`);
    }
    return r.json();
  }
  // The bot's wallet
  gtw(w) { return this.f(`/api/trading-wallet/${w}`); }
  ctw(w) { return this.f("/api/trading-wallet/create", { method: "POST", body: { wallet: w } }); }
  etw(w) { return this.f("/api/trading-wallet/export", { method: "POST", body: { wallet: w } }); }
  wdr(w, to, sol) { return this.f("/api/trading-wallet/withdraw", { method: "POST", body: { wallet: w, to, sol: sol || "all" }, timeout: 60000 }); }
  // The bot
  vst(w, s) { return this.f("/api/velocity/start", { method: "POST", body: { wallet: w, settings: s }, timeout: 90000 }); }
  vsp(w) { return this.f("/api/velocity/stop", { method: "POST", body: { wallet: w }, timeout: 90000 }); }
  vstat(w) { return this.f(`/api/velocity/status?wallet=${w}`); }
}
export const a = new A(); export default a;
