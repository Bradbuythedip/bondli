// Bondli — one page. A bot that trades memecoins for you.
// The page has one primary action at a time: connect, fund, start, watch, stop. Everything the bot
// does is shown in its own words; nothing is explained in prose that the narration already shows.
import React, { useState, useEffect, useCallback, useRef } from "react";
import { TC, D, L, css } from "./lib/theme.js";
import { M, S } from "./lib/constants.js";
import a from "./lib/api-client.js";

const FEE_PCT = 5;
const AGG = [{ v: 1, l: "Careful" }, { v: 2, l: "Normal" }, { v: 3, l: "Degen" }];
const SIZES = [5, 10, 25, 50];
const fmt = n => (n < 0 ? "-$" : "$") + Math.abs(Number(n) || 0).toFixed(2);
const phantom = () => (window?.phantom?.solana?.isPhantom ? window.phantom.solana : window?.solana?.isPhantom ? window.solana : null);

function Btn({ children, onClick, disabled, danger, ghost, T, big }) {
  return <button onClick={disabled ? undefined : onClick} style={{ width: "100%", padding: big ? "18px 20px" : "12px 16px", borderRadius: 12, border: ghost || danger ? `1px solid ${danger ? T.rd : T.bd}` : "none", background: ghost || danger ? "transparent" : T.gn, color: danger ? T.rd : ghost ? T.tx : "#000", fontFamily: S, fontWeight: 900, fontSize: big ? 20 : 15, letterSpacing: ".01em", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .45 : 1 }}>{children}</button>;
}

export default function Simple() {
  const [dark] = useState(() => { try { return localStorage.getItem("bondli_theme") !== "light"; } catch { return true; } });
  const T = dark ? D : L;
  const [pk, sPk] = useState(null);
  const [tw, sTw] = useState(null);        // { pubkey, solBalance }
  const [st, sSt] = useState(null);        // velocity status
  const [busy, sBusy] = useState(null);    // what is in flight, for the button label
  const [msg, sMsg] = useState(null);
  const [agg, sAgg] = useState(() => { try { return Number(localStorage.getItem("bondli_agg")) || 2; } catch { return 2; } });
  const [size, sSize] = useState(() => { try { return Number(localStorage.getItem("bondli_size")) || 10; } catch { return 10; } });
  const [showKey, sShowKey] = useState(null);
  const [copied, sCopied] = useState(false);
  const narRef = useRef(null);
  const running = !!st?.running;
  const s = st?.status; const day = s?.day; const pnl = day?.realizedUsd || 0;
  const say = (m, kind = "info") => { sMsg({ m, kind }); setTimeout(() => sMsg(x => (x?.m === m ? null : x)), 6000); };

  useEffect(() => { const p = phantom(); if (p?.isConnected && p.publicKey) sPk(p.publicKey.toString()); else p?.connect?.({ onlyIfTrusted: true }).then(r => sPk(r.publicKey.toString())).catch(() => {}); }, []);
  useEffect(() => { a.sw(pk); }, [pk]);

  const loadWallet = useCallback(async () => {
    if (!pk) return;
    try { const r = await a.gtw(pk); sTw(r?.tradingWallet ? { pubkey: r.tradingWallet, solBalance: Number(r.solBalance ?? r.sol ?? 0), tokenValueSol: Number(r.tokenValueSol || 0) } : null); } catch { /* keep the last reading */ }
  }, [pk]);
  useEffect(() => { loadWallet(); const id = setInterval(loadWallet, running ? 15000 : 8000); return () => clearInterval(id); }, [loadWallet, running]);
  useEffect(() => {
    if (!pk || !tw) return; let on = true;
    const poll = async () => { try { const r = await a.vstat(pk); if (on) sSt(r); } catch (e) { if (on && !/Sign in/.test(e.message)) sSt(x => x); } };
    poll(); const id = setInterval(poll, running ? 3000 : 12000); return () => { on = false; clearInterval(id); };
  }, [pk, tw?.pubkey, running]);
  useEffect(() => { if (narRef.current) narRef.current.scrollTop = narRef.current.scrollHeight; }, [st?.narration?.length]);

  const connect = async () => {
    const p = phantom();
    if (!p) { if (/iPhone|iPad|Android/i.test(navigator.userAgent)) { window.location.href = "https://phantom.app/ul/browse/" + encodeURIComponent(window.location.href); return; } say("Install Phantom to continue", "error"); return; }
    try { const r = await p.connect(); sPk(r.publicKey.toString()); } catch (e) { say(e.code === 4001 ? "Cancelled" : "Could not connect", "error"); }
  };
  const createWallet = async () => { sBusy("wallet"); try { await a.ctw(pk); await loadWallet(); } catch (e) { say(e.message, "error"); } finally { sBusy(null); } };
  const start = async () => {
    sBusy("start");
    try {
      try { localStorage.setItem("bondli_agg", String(agg)); localStorage.setItem("bondli_size", String(size)); } catch {}
      const r = await a.vst(pk, { aggression: agg, perTradeMaxUsd: size, maxPositions: 4, dailyLossUsd: Math.max(15, size * 3), bankrollUsd: Math.max(20, Math.round((tw?.solBalance || 0) * 200)) });
      if (!r.ok) say(r.error || "Could not start", "error"); else sSt(r);
    } catch (e) { say(e.message, "error"); } finally { sBusy(null); }
  };
  const stop = async () => { if (!confirm("Sell everything the bot holds and stop?")) return; sBusy("stop"); try { const r = await a.vsp(pk); sSt({ running: false }); if (r.failed?.length) say(`${r.failed.length} token(s) could not be sold yet; retrying in the background`, "error"); } catch (e) { say(e.message, "error"); } finally { sBusy(null); } };
  const withdraw = async () => { if (running) { say("Stop the bot first", "error"); return; } if (!confirm(`Send all SOL from the trading wallet back to ${pk.slice(0, 6)}…?`)) return; sBusy("withdraw"); try { const r = await a.wdr(pk, pk, "all"); say(`Sent ${r.sol.toFixed(4)} SOL`, "ok"); await loadWallet(); } catch (e) { say(e.message, "error"); } finally { sBusy(null); } };
  const exportKey = async () => { sBusy("key"); try { const r = await a.etw(pk); sShowKey(r.privateKey); } catch (e) { say(e.message, "error"); } finally { sBusy(null); } };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); sCopied(true); setTimeout(() => sCopied(false), 1500); } catch {} };

  const funded = (tw?.solBalance || 0) >= 0.06;
  const wrap = { minHeight: "100vh", background: T.bg, color: T.tx, fontFamily: S, display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 16px 32px", boxSizing: "border-box" };
  const card = { width: "100%", maxWidth: 440, background: T.sf, border: `1px solid ${running ? T.gn : T.bd}`, borderRadius: 16, padding: 20, boxSizing: "border-box" };
  const muted = { color: T.ft, fontSize: 13, lineHeight: 1.5 };

  return <TC.Provider value={T}><style>{css(T)}</style><div style={wrap}>
    <div style={{ textAlign: "center", marginBottom: 28 }}>
      <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: "-.02em", lineHeight: 1.1 }}>A bot that trades memecoins for you.</div>
      <div style={{ ...muted, fontSize: 16, marginTop: 10 }}>You keep the wallet. It does the trading.</div>
    </div>

    <div style={card}>
      {/* 1. Connect */}
      {!pk && <Btn big T={T} onClick={connect}>Connect wallet</Btn>}

      {/* 2. Trading wallet: create, then fund */}
      {pk && !tw && <>
        <div style={{ ...muted, marginBottom: 12 }}>The bot needs a wallet of its own to trade from. You can take the key or the money out any time.</div>
        <Btn big T={T} onClick={createWallet} disabled={busy === "wallet"}>{busy === "wallet" ? "Creating…" : "Create the bot's wallet"}</Btn>
      </>}
      {pk && tw && !running && <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={muted}>Bot wallet</span>
          <span style={{ fontFamily: M, fontWeight: 800, fontSize: 22 }}>{tw.solBalance.toFixed(3)} SOL</span>
        </div>
        <div onClick={() => copy(tw.pubkey)} title="copy" style={{ fontFamily: M, fontSize: 12, color: T.dm, marginTop: 6, wordBreak: "break-all", cursor: "pointer", padding: "8px 10px", background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}` }}>{tw.pubkey}{copied ? "  copied" : ""}</div>
        {!funded && <div style={{ ...muted, marginTop: 8 }}>Send SOL to that address to begin. 0.5 SOL is a good start.</div>}

        {/* 3. Two choices, then start */}
        {funded && <>
          <div style={{ marginTop: 18, ...muted, marginBottom: 6 }}>How hard</div>
          <div style={{ display: "flex", gap: 6 }}>{AGG.map(o => <button key={o.v} onClick={() => sAgg(o.v)} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${agg === o.v ? T.gn : T.bd}`, background: agg === o.v ? T.gn + "22" : "transparent", color: agg === o.v ? T.gn : T.dm, fontWeight: 800, cursor: "pointer" }}>{o.l}</button>)}</div>
          <div style={{ marginTop: 14, ...muted, marginBottom: 6 }}>Per trade</div>
          <div style={{ display: "flex", gap: 6 }}>{SIZES.map(v => <button key={v} onClick={() => sSize(v)} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${size === v ? T.gn : T.bd}`, background: size === v ? T.gn + "22" : "transparent", color: size === v ? T.gn : T.dm, fontFamily: M, fontWeight: 800, cursor: "pointer" }}>${v}</button>)}</div>
          <div style={{ ...muted, marginTop: 10 }}>Up to 4 tokens at once. Stops for the day after ${Math.max(15, size * 3)} of losses.</div>
          <div style={{ marginTop: 16 }}><Btn big T={T} onClick={start} disabled={busy === "start"}>{busy === "start" ? "Starting…" : "Start"}</Btn></div>
        </>}
      </>}

      {/* 4. Running: the number, the holdings, the bot's own words, the stop */}
      {running && <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: T.gn, animation: "gp 2s infinite" }} /><span style={{ fontWeight: 800 }}>Trading</span></span>
          <span style={{ fontFamily: M, fontWeight: 900, fontSize: 30, color: pnl >= 0 ? T.gn : T.rd }}>{pnl >= 0 ? "+" : ""}{fmt(pnl)}</span>
        </div>
        <div style={{ ...muted, display: "flex", justifyContent: "space-between", marginTop: 2 }}><span>today, {day?.trades || 0} trades</span><span>{s?.bankroll?.wallet ? Number(s.bankroll.wallet.sol).toFixed(3) + " SOL" : ""}</span></div>
        {s?.halt?.mode && <div style={{ color: T.yl, fontSize: 13, marginTop: 8 }}>Paused: {s.halt.reason}</div>}
        {s?.positions?.length > 0 && <div style={{ marginTop: 12 }}>{s.positions.map(p => <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontFamily: M, fontSize: 13, padding: "5px 0", borderTop: `1px solid ${T.bd}` }}><span style={{ color: T.dm }}>{p.instrument.slice(0, 6)}…</span><span>{fmt(p.notional_usd)}</span><span style={{ color: (p.changePct || 0) >= 0 ? T.gn : T.rd }}>{p.changePct != null ? (p.changePct >= 0 ? "+" : "") + p.changePct.toFixed(1) + "%" : ""}</span></div>)}</div>}
        <div ref={narRef} style={{ marginTop: 14, fontFamily: M, fontSize: 11, lineHeight: 1.55, height: 200, overflowY: "auto", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 10, padding: "8px 10px", color: T.ft }}>
          {(st.narration || []).map((n, i) => <div key={i} style={{ color: /FILLED|SOLD|P&L/.test(n.line) ? T.tx : /fee/.test(n.line) ? T.yl : T.ft, whiteSpace: "pre-wrap" }}>{n.line}</div>)}
          {!(st.narration || []).length && <div>watching every new token…</div>}
        </div>
        <div style={{ marginTop: 14 }}><Btn danger T={T} onClick={stop} disabled={busy === "stop"}>{busy === "stop" ? "Selling…" : "Sell everything and stop"}</Btn></div>
      </>}
      {msg && <div style={{ marginTop: 12, fontSize: 13, color: msg.kind === "error" ? T.rd : T.gn }}>{msg.m}</div>}
    </div>

    {/* Footer: the two ways out, and the one line about money */}
    {pk && tw && <div style={{ width: "100%", maxWidth: 440, marginTop: 14, display: "flex", gap: 8 }}>
      <Btn ghost T={T} onClick={withdraw} disabled={busy === "withdraw" || running}>{busy === "withdraw" ? "Sending…" : "Withdraw"}</Btn>
      <Btn ghost T={T} onClick={exportKey} disabled={busy === "key"}>Export key</Btn>
    </div>}
    {showKey && <div style={{ width: "100%", maxWidth: 440, marginTop: 10, background: T.sf, border: `1px solid ${T.yl}`, borderRadius: 12, padding: 14 }}>
      <div style={{ ...muted, color: T.yl, marginBottom: 6 }}>Your bot wallet's private key. Anyone with it owns the wallet. Import it into Phantom to control the wallet directly.</div>
      <div onClick={() => copy(showKey)} style={{ fontFamily: M, fontSize: 11, wordBreak: "break-all", cursor: "pointer", color: T.tx }}>{showKey}{copied ? "  copied" : ""}</div>
      <div style={{ marginTop: 8 }}><Btn ghost T={T} onClick={() => sShowKey(null)}>Hide</Btn></div>
    </div>}
    <div style={{ ...muted, fontSize: 12, marginTop: 28, textAlign: "center", maxWidth: 440 }}>Bondli keeps {FEE_PCT}% of each profitable trade, taken from the profit. Losing trades cost nothing. Memecoins can go to zero; only trade what you can lose.</div>
  </div></TC.Provider>;
}
