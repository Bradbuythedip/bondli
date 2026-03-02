// BONDLI v3.0 — API Client with Auth + Payment Flow
const BASE = "";

let _token = localStorage.getItem("bondli_token") || null;

export function setToken(t) {
  _token = t;
  if (t) localStorage.setItem("bondli_token", t);
  else localStorage.removeItem("bondli_token");
}

export function getToken() { return _token; }
export function isAuthenticated() { return !!_token; }

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;

  const res = await fetch(BASE + path, {
    headers,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  // Auto-clear token on 401
  if (res.status === 401) {
    setToken(null);
    throw new Error("Session expired. Please re-authenticate.");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "API error");
  }
  return res.json();
}

// ── Payment Flow ─────────────────────
export const getPaymentInfo = () => api("/api/payment/info");
export const verifyPayment  = (wallet, txSig) =>
  api("/api/payment/verify", { method: "POST", body: { wallet, txSig } });
export const checkPaymentStatus = (wallet) => api(`/api/payment/status?wallet=${wallet}`);

// ── Public ───────────────────────────
export const getStatus  = ()   => api("/api/status");
export const getConfig  = ()   => api("/api/config");
export const getFees    = (sol, wallet) => api(`/api/fees?sol=${sol}&wallet=${wallet || ""}`);

// ── Protected ────────────────────────
export const getWallets = ()   => api("/api/wallets");
export const getCurve   = (ca) => api(`/api/curve/${ca}`);
export const calcFee    = (solIn, solReturn, wallet) =>
  api("/api/fees/calculate", { method: "POST", body: { solIn, solReturn, wallet } });

export const launch       = (ca, totalSol, force) =>
  api("/api/launch", { method: "POST", body: { ca, totalSol, force } });
export const closeSession = (ca) =>
  api("/api/close", { method: "POST", body: { ca } });
export const closeAll     = () =>
  api("/api/close-all", { method: "POST" });

// ── WebSocket ────────────────────────
export function connectWS(onMessage) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch {}
  };
  ws.onclose = () => {
    console.log("[WS] Disconnected, reconnecting in 3s...");
    setTimeout(() => connectWS(onMessage), 3000);
  };
  ws.onerror = () => {};
  return ws;
}
