// Bondli — one page. A bot that trades memecoins for you.
// The page has one primary action at a time: connect, fund, start, watch, stop. Everything the bot
// does is shown in its own words; nothing is explained in prose that the narration already shows.
import React, { useState, useEffect, useCallback, useRef } from "react";
import { TC, D, L, css } from "./lib/theme.js";
import { M, S, imgUrl } from "./lib/constants.js";
import a from "./lib/api-client.js";

const FEE_PCT = 5;
// The risk dial. Each stop is a full profile in the engine (AGGRESSION in the pumpfun edge).
const AGG = [
  { v: 0, l: "Safe", d: "Only the cleanest launches. Few trades." },
  { v: 1, l: "Careful", d: "The designed rules. Skips anything that looks like a dump." },
  { v: 2, l: "Normal", d: "Takes watchlist tokens and later entries. More trades, more losers." },
  { v: 3, l: "Degen", d: "Almost anything with buyers. Expect a lot of small losses for the big wins." },
];
const SIZES = [5, 10, 25, 50];
const fmt = n => (n < 0 ? "-$" : "$") + Math.abs(Number(n) || 0).toFixed(2);
const phantom = () => (window?.phantom?.solana?.isPhantom ? window.phantom.solana : window?.solana?.isPhantom ? window.solana : null);

function Btn({ children, onClick, disabled, danger, ghost, T, big }) {
  return <button onClick={disabled ? undefined : onClick} style={{ width: "100%", padding: big ? "18px 20px" : "12px 16px", borderRadius: 12, border: ghost || danger ? `1px solid ${danger ? T.rd : T.bd}` : "none", background: ghost || danger ? "transparent" : T.gn, color: danger ? T.rd : ghost ? T.tx : "#000", fontFamily: S, fontWeight: 900, fontSize: big ? 20 : 15, letterSpacing: ".01em", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .45 : 1 }}>{children}</button>;
}

// Proof of life between decisions: the engine only writes a line when it judges a token, so this row
// re-reads the heartbeat, the feed age and the judged count on every poll and says what it is doing now.
function Pulse({ st, T }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(id); }, []);
  const s = st?.status; if (!s) return null;
  const now = Date.now();
  const v = s.venues?.pumpfun || {};
  const hb = s.heartbeatAt ? (now - s.heartbeatAt) / 1000 : null;
  const feedAge = v.feed?.ageMs != null ? v.feed.ageMs / 1000 : null;
  const judged = v.evaluated || 0, gos = v.gos || 0;
  const last = st.narration?.length ? (now - st.narration[st.narration.length - 1].ts) / 1000 : null;
  const dead = hb != null && hb > 45, stale = v.feed?.stale || (feedAge != null && feedAge > 30);
  const c = dead ? T.rd : stale ? T.yl : T.gn;
  const what = dead ? "engine not responding" : stale ? "market feed stale" : s.halt?.mode ? (/user/.test(s.halt.reason || "") ? "paused by you" : "paused: " + s.halt.reason) : judged === 0 ? "waiting for the first token to qualify" : "watching for the next token";
  const dots = ".".repeat(1 + (Math.floor(now / 500) % 3));
  const f = st.funnel;
  const GATE = { disqualifiers: "rug rules", viability: "too weak", confidence: "unsure", ev: "no edge", execution_window: "bad timing", governor: "paused", estimate: "no edge" };
  return <>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, fontFamily: M, fontSize: 11, color: T.ft }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, color: c }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: c, animation: dead ? "none" : "gp 1.5s infinite" }} />{what}{dead || stale ? "" : dots}</span>
      <span>{judged} judged · {gos} taken{last != null ? ` · last ${last < 60 ? Math.round(last) + "s" : Math.round(last / 60) + "m"} ago` : ""}</span>
    </div>
    {(s.throttle === 0 || s.halt?.mode) && s.governor?.reasons?.length > 0 && <div style={{ marginTop: 6, fontFamily: M, fontSize: 11, color: T.yl, lineHeight: 1.5 }}>governor: {s.governor.reasons.join(" · ")}</div>}
    {f && f.judged > 0 && <div style={{ marginTop: 6, fontFamily: M, fontSize: 11, color: T.ft, lineHeight: 1.5 }}>
      last 10 min: {f.distinct} tokens, {f.judged} looks, {f.gos} go, {f.filled} filled{f.gos > f.filled && f.sized0 ? ` · no size: ${Object.keys(f.sized0).join(", ").toLowerCase().replace(/_/g, " ")}` : ""}{f.failed ? ` · failed: ${Object.keys(f.failed).join(", ").toLowerCase().replace(/_/g, " ")}` : ""}
      <div>{Object.entries(f.gates).sort((a, b) => b[1] - a[1]).map(([g, n]) => <span key={g} style={{ marginRight: 10 }}>{GATE[g] || g} <b style={{ color: T.dm }}>{n}</b></span>)}</div>
    </div>}
  </>;
}
// The market as the bot sees it: newest launches, a sparkline, the score, and the bot's one-word verdict.
const ago = ms => ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : ms < 3600_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 3600_000)}h`;
const kfmt = n => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : `$${Math.round(n)}`;
function Spark({ v, T, w = 72, h = 22 }) {
  const pts = (v || []).filter(x => x > 0);
  if (pts.length < 2) return <svg width={w} height={h} style={{ display: "block" }}><line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke={T.bd} strokeWidth="1.5" /></svg>;
  const mn = Math.min(...pts), mx = Math.max(...pts), r = mx - mn || 1;
  const d = pts.map((y, i) => `${(i / (pts.length - 1)) * w},${h - 2 - ((y - mn) / r) * (h - 4)}`).join(" ");
  const up = pts[pts.length - 1] >= pts[0];
  return <svg width={w} height={h} style={{ display: "block" }}><polyline points={d} fill="none" stroke={up ? T.gn : T.rd} strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}
// The bot's one reason per token, in plain words.
const TAG = { hot: ["BUY ZONE", "gn"], close: ["almost", "yl"], weak: ["weak", "ft"], new: ["too new", "ft"], nobuyers: ["no buyers", "ft"], fewbuyers: ["few buyers", "ft"], small: ["too small", "ft"], rug: ["rug", "rd"], mayhem: ["mayhem", "ft"], copy: ["copy", "ft"] };
// Risk reads green → yellow → red, the same three colours the rest of the page uses for gain, caution, loss.
const RISK_C = (v, T) => v >= 3 ? T.rd : v >= 2 ? T.yl : T.gn;
function Dial({ value, onChange, T }) {
  const n = AGG.length, c = RISK_C(value, T);
  return <div style={{ marginTop: 8 }}>
    <div style={{ display: "flex", gap: 4 }}>{AGG.map(o => <div key={o.v} onClick={() => onChange(o.v)} style={{ flex: 1, height: 10, borderRadius: 5, cursor: "pointer", background: o.v <= value ? RISK_C(o.v, T) : T.bg, border: `1px solid ${o.v <= value ? RISK_C(o.v, T) : T.bd}`, opacity: o.v <= value ? (o.v === value ? 1 : .55) : 1, transition: "background .15s, opacity .15s" }} />)}</div>
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${n}, 1fr)`, marginTop: 6 }}>{AGG.map(o => <button key={o.v} onClick={() => onChange(o.v)} style={{ background: "none", border: "none", padding: "2px 0", fontSize: 12, fontWeight: 800, cursor: "pointer", color: o.v === value ? c : T.ft, textAlign: o.v === 0 ? "left" : o.v === n - 1 ? "right" : "center" }}>{o.l}</button>)}</div>
  </div>;
}
const HUE = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
// A token picture through the proxy (by url, else by mint from DexScreener's copy). While it loads the
// tile is a soft, shimmering blur in the token's own hue with the ticker over it; the picture blurs in
// on top. Six retries over ~90s because a token's picture usually exists a minute after its launch.
function TokenImg({ src, ca, label, size, T }) {
  const [tries, sTries] = useState(0); const [ok, sOk] = useState(true); const [loaded, sLoaded] = useState(false);
  useEffect(() => { sTries(0); sOk(true); sLoaded(false); }, [src, ca]);
  const h = HUE(ca);
  const tile = { width: size, height: size, borderRadius: Math.round(size / 4), overflow: "hidden", position: "relative", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: M, fontWeight: 900, fontSize: Math.round(size / 3.2), color: "rgba(255,255,255,.55)", background: `radial-gradient(circle at 30% 30%, hsl(${h} 45% 34%), hsl(${(h + 40) % 360} 40% 18%))` };
  const fuzz = <div style={{ position: "absolute", inset: 0, background: `linear-gradient(110deg, transparent 30%, hsl(${h} 60% 60% / .25) 50%, transparent 70%)`, backgroundSize: "200% 100%", animation: "shimmer 1.6s linear infinite", filter: "blur(6px)" }} />;
  const url = imgUrl(src, ca);
  if (!url || !ok) return <div style={tile}>{label}</div>;
  return <div style={tile}>{!loaded && fuzz}{!loaded && <span style={{ position: "relative" }}>{label}</span>}<img key={tries} src={url + (tries ? `&r=${tries}` : "")} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: size, height: size, objectFit: "cover", filter: loaded ? "blur(0)" : "blur(12px)", opacity: loaded ? 1 : 0, transform: loaded ? "scale(1)" : "scale(1.15)", transition: "filter .35s, opacity .35s, transform .35s" }} onLoad={() => sLoaded(true)} onError={() => { if (tries < 6) setTimeout(() => sTries(t => t + 1), Math.min(30000, 3000 * (tries + 1))); else sOk(false); }} /></div>;
}
function Live({ T, agg }) {
  const [d, sD] = useState(null);
  useEffect(() => { let on = true; const poll = async () => { try { const r = await a.live(agg); if (on) sD(r); } catch {} }; poll(); const id = setInterval(poll, 3000); return () => { on = false; clearInterval(id); }; }, [agg]);
  if (!d) return null;
  const now = d.ts || Date.now();
  const muted = { color: T.ft, fontSize: 12 };
  return <div style={{ width: "100%", maxWidth: 560, marginTop: 32 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
      <span style={{ fontWeight: 800, fontSize: 17, display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: d.online ? T.gn : T.rd, animation: d.online ? "gp 2s infinite" : "none" }} />What the bot sees</span>
      <span style={muted}>{d.bots != null ? `${d.bots} bot${d.bots === 1 ? "" : "s"} trading` : ""}</span>
    </div>
    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
      {[["launched", d.hour.launches, "tx"], ["buy zone", d.hour.hot, "gn"], ["robinhood", d.hour.robinhood ?? 0, "dm"], ["mayhem", d.hour.mayhem, "ft"]].map(([l, n, c]) => <div key={l} style={{ flex: 1, background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 10, padding: "8px 0", textAlign: "center" }}><div style={{ fontFamily: M, fontWeight: 900, fontSize: 22, color: T[c] }}>{n}</div><div style={{ ...muted, fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em" }}>{l}</div></div>)}
    </div>
    {d.revivals?.length > 0 && <>
      <div style={{ ...muted, marginBottom: 6 }}>waking up · launched hours or days ago, buyers back at 3x</div>
      <div style={{ background: T.sf, border: `1px solid ${T.yl}55`, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>{d.revivals.map(t => rowOf(t, true))}</div>
    </>}
    <div style={{ ...muted, marginBottom: 6, display: "flex", justifyContent: "space-between" }}><span>last hour · both chains · judged at {AGG[d.aggression ?? agg]?.l || "Normal"}</span><span>tap to open on its launchpad</span></div>
    <div style={{ background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 12, overflow: "hidden" }}>
      {d.tokens.slice(0, 25).map(t => rowOf(t))}
      {!d.tokens.length && <div style={{ ...muted, padding: 14, textAlign: "center" }}>waiting for the next launch…</div>}
    </div>
  </div>;
  function rowOf(t, revival = false) { const [label, c] = TAG[t.tag] || TAG.weak; const dim = t.tag === "mayhem" || t.tag === "copy"; const initial = (t.ticker || t.name || "?").slice(0, 2).toUpperCase(); return <a key={t.ca} href={t.url || `https://pump.fun/coin/${t.ca}`} target="_blank" rel="noopener" style={{ display: "grid", gridTemplateColumns: "56px 1fr 100px 68px", gap: 12, alignItems: "center", padding: "9px 12px", borderTop: `1px solid ${T.bd}`, opacity: dim ? .45 : 1, color: "inherit", textDecoration: "none" }}>
        <TokenImg src={t.image} ca={t.ca} label={initial} size={56} T={T} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", minWidth: 0 }}><span style={{ fontWeight: 800, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name || t.ca.slice(0, 6)}</span><span style={{ ...muted, fontFamily: M, whiteSpace: "nowrap" }}>{t.ticker}</span>{t.chain === "robinhood" && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".05em", color: "#e0b3ff", background: "#e0b3ff1a", padding: "1px 5px", borderRadius: 4, whiteSpace: "nowrap" }}>RH</span>}</div>
          <div style={{ ...muted, fontFamily: M, fontSize: 12, marginTop: 2 }}>{ago(now - t.createdAt)} · {kfmt(t.mcapUsd)} · {t.buyers} buyers{t.copies ? ` · ${t.copies} copies` : ""}{revival && t.revival ? ` · ${t.revival.buyers5m} in 5m vs ${t.revival.baseline5m}` : ""}{t.why ? ` · ${t.why.toLowerCase().replace(/_/g, " ")}` : ""}</div>
        </div>
        <Spark v={t.spark} T={T} w={100} h={30} />
        <div style={{ textAlign: "right" }}><div style={{ fontFamily: M, fontWeight: 900, fontSize: 18, color: t.score >= 60 ? T.gn : t.score >= 40 ? T.tx : T.ft }}>{dim || !t.score ? "" : t.score}</div><div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: T[c], whiteSpace: "nowrap" }}>{label}</div></div>
      </a>; }
}

/** Bondli's own token, front and centre: the fly, the status, and when it is live the number, the
 *  curve, the address and the way in. State comes from the API every 15s, pushed by tools/launch-push.mjs. */
function Launch({ T }) {
  const [l, sL] = useState(null); const [copied, sCopied] = useState(false);
  useEffect(() => { let on = true; const poll = async () => { try { const r = await a.launch(); if (on) sL(r); } catch {} }; poll(); const id = setInterval(poll, 15000); return () => { on = false; clearInterval(id); }; }, []);
  if (!l || l.status === "off") return null;
  const live = l.status === "live" || l.status === "graduated", lv = l.live && !l.live.error ? l.live : null;
  const copy = async () => { try { await navigator.clipboard.writeText(l.address); sCopied(true); setTimeout(() => sCopied(false), 1500); } catch {} };
  const pill = { display: "inline-block", padding: "4px 10px", borderRadius: 999, fontFamily: M, fontSize: 11, fontWeight: 800, letterSpacing: ".08em" };
  return <div style={{ width: "100%", maxWidth: 440, marginBottom: 18, position: "relative", overflow: "hidden", borderRadius: 18, border: `1px solid ${live ? T.gn : T.bd}`, background: `radial-gradient(120% 90% at 85% 20%, ${T.gn}2a 0%, ${T.sf} 55%)`, padding: "18px 18px 16px", boxSizing: "border-box" }}>
    <img src={l.image || "/fly.png"} alt="Not a fruit fly" style={{ position: "absolute", right: -18, top: -6, width: 190, height: "auto", animation: "fly 5s ease-in-out infinite", filter: `drop-shadow(0 0 22px ${T.gn}88)`, pointerEvents: "none" }} />
    <div style={{ position: "relative", zIndex: 1, maxWidth: 240 }}>
      <span style={{ ...pill, background: live ? T.gn : T.bg, color: live ? "#000" : T.dm, border: `1px solid ${live ? T.gn : T.bd}` }}>{l.status === "graduated" ? "GRADUATED · ROBINHOOD CHAIN" : live ? "LIVE · ROBINHOOD CHAIN" : "LAUNCHING SOON · ROBINHOOD CHAIN"}</span>
      <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: "-.03em", lineHeight: 1, marginTop: 12 }}>NOT A<br />FRUIT FLY</div>
      {l.ticker && <div style={{ fontFamily: M, fontWeight: 800, color: T.gn, marginTop: 6 }}>${l.ticker.replace(/^\$/, "")}</div>}
      <div style={{ color: T.ft, fontSize: 13, lineHeight: 1.45, marginTop: 8 }}>{l.tagline}</div>
    </div>
    {live && <div style={{ position: "relative", zIndex: 1, marginTop: 14 }}>
      {lv && <div style={{ display: "flex", gap: 14, fontFamily: M, fontSize: 13, alignItems: "baseline" }}>
        <span><span style={{ color: T.ft, fontSize: 11 }}>mcap </span><b style={{ color: T.tx, fontSize: 18 }}>{kfmt(lv.mcapUsd || 0)}</b></span>
        {lv.buys != null && <span><span style={{ color: T.ft, fontSize: 11 }}>buys </span><b>{lv.buys}</b></span>}
        {lv.buyers != null && lv.buyers > 0 && <span><span style={{ color: T.ft, fontSize: 11 }}>holders </span><b>{lv.buyers}</b></span>}
      </div>}
      {lv && lv.curvePct != null && <div style={{ marginTop: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: M, fontSize: 11, color: T.ft }}><span>{lv.graduated ? "graduated to the pool" : "bonding curve"}</span><span>{Math.round(lv.curvePct * 100)}%</span></div>
        <div style={{ height: 6, background: T.bg, borderRadius: 3, marginTop: 4, overflow: "hidden" }}><div style={{ width: `${Math.max(2, Math.round(lv.curvePct * 100))}%`, height: "100%", background: T.gn, transition: "width .6s" }} /></div>
      </div>}
      {l.address && <div onClick={copy} title="copy" style={{ fontFamily: M, fontSize: 11, color: T.dm, marginTop: 10, wordBreak: "break-all", cursor: "pointer", padding: "7px 9px", background: T.bg + "cc", borderRadius: 8, border: `1px solid ${T.bd}` }}>{l.address}{copied ? "  copied" : ""}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {l.url && <a href={l.url} target="_blank" rel="noopener" style={{ flex: 1, textAlign: "center", padding: "11px 12px", borderRadius: 10, background: T.gn, color: "#000", fontWeight: 900, textDecoration: "none", fontSize: 14 }}>Buy on PONS</a>}
        {l.links?.x && <a href={l.links.x} target="_blank" rel="noopener" style={{ padding: "11px 14px", borderRadius: 10, border: `1px solid ${T.bd}`, color: T.tx, fontWeight: 800, textDecoration: "none", fontSize: 14 }}>X</a>}
        {l.links?.telegram && <a href={l.links.telegram} target="_blank" rel="noopener" style={{ padding: "11px 14px", borderRadius: 10, border: `1px solid ${T.bd}`, color: T.tx, fontWeight: 800, textDecoration: "none", fontSize: 14 }}>Telegram</a>}
      </div>
    </div>}
    {l.updates?.length > 0 && <div style={{ position: "relative", zIndex: 1, marginTop: 12, fontFamily: M, fontSize: 11, color: T.ft, lineHeight: 1.6, borderTop: `1px solid ${T.bd}`, paddingTop: 8 }}>
      {l.updates.slice(0, 3).map((u, i) => <div key={i}><span style={{ color: T.dm }}>{new Date(u.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> {u.text}</div>)}
    </div>}
    <div style={{ position: "relative", zIndex: 1, marginTop: 10, fontSize: 11, color: T.dm }}>The bot judges this launch like any other. No favours, no auto-buy.</div>
  </div>;
}

export default function Simple() {
  const [dark] = useState(() => { try { return localStorage.getItem("bondli_theme") !== "light"; } catch { return true; } });
  const T = dark ? D : L;
  const [pk, sPk] = useState(null);
  const [tw, sTw] = useState(null);        // { pubkey, solBalance }
  const [st, sSt] = useState(null);        // velocity status
  const [busy, sBusy] = useState(null);    // what is in flight, for the button label
  const [msg, sMsg] = useState(null);
  const [agg, sAgg] = useState(() => { try { const v = localStorage.getItem("bondli_agg"); return v == null ? 2 : Math.max(0, Math.min(3, Number(v) || 0)); } catch { return 2; } });
  const [size, sSize] = useState(() => { try { return Number(localStorage.getItem("bondli_size")) || 10; } catch { return 10; } });
  const [showKey, sShowKey] = useState(null);
  const [openPos, sOpenPos] = useState(null);
  const [chains, sChains] = useState(() => { try { return JSON.parse(localStorage.getItem("bondli_chains") || "null") || { pons: true }; } catch { return { pons: true }; } });
  const [copied, sCopied] = useState(false);
  const narRef = useRef(null);
  const running = !!st?.running;
  const s = st?.status; const day = s?.day; const tp = s?.pnl || null; const pnl = tp?.since_start_usd ?? (day?.realizedUsd || 0) + (tp?.unrealized_usd || 0); const pnlKind = tp?.since_start_usd != null ? "wallet" : "trades";
  // A message clears itself (errors get longer) and on a tap.
  const say = (m, kind = "info") => { sMsg({ m, kind }); setTimeout(() => sMsg(x => (x?.m === m ? null : x)), kind === "error" ? 15000 : 6000); };

  useEffect(() => { const p = phantom(); if (p?.isConnected && p.publicKey) sPk(p.publicKey.toString()); else p?.connect?.({ onlyIfTrusted: true }).then(r => sPk(r.publicKey.toString())).catch(() => {}); }, []);
  useEffect(() => { a.sw(pk); }, [pk]);

  const loadWallet = useCallback(async () => {
    if (!pk) return;
    try { const r = await a.gtw(pk); sTw(r?.tradingWallet ? { pubkey: r.tradingWallet, solBalance: Number(r.solBalance ?? r.sol ?? 0), tokenValueSol: Number(r.tokenValueSol || 0), evmAddress: r.evmAddress || null, ethBalance: r.ethBalance == null ? null : Number(r.ethBalance) } : null); } catch { /* keep the last reading */ }
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
      try { localStorage.setItem("bondli_chains", JSON.stringify(chains)); } catch {}
      const r = await a.vst(pk, { aggression: agg, perTradeMaxUsd: size, maxPositions: 4, dailyLossUsd: Math.max(15, size * 3), bankrollUsd: Math.max(20, Math.round((tw?.solBalance || 0) * 200 + (tw?.ethBalance || 0) * 3000)), pons: !!chains.pons && (tw?.ethBalance || 0) > 0.003 });
      if (!r.ok) say(r.error || "Could not start", "error"); else sSt(r);
    } catch (e) { say(e.message, "error"); } finally { sBusy(null); }
  };
  const stop = async () => { if (!confirm("Sell everything the bot holds and stop?")) return; sBusy("stop"); try { const r = await a.vsp(pk); sSt({ running: false }); if (r.failed?.length) say(`${r.failed.length} token(s) could not be sold yet; retrying in the background`, "error"); } catch (e) { say(e.message, "error"); } finally { sBusy(null); } };
  const paused = !!s?.halt?.mode;
  const pause = async () => { sBusy("pause"); try { const r = await a.vpause(pk); if (r.ok) sSt(x => ({ ...x, ...r })); else say(r.error, "error"); } catch (e) { say(e.message, "error"); } finally { sBusy(null); } };
  const resume = async () => { sBusy("pause"); try { const r = await a.vresume(pk); if (r.ok) sSt(x => ({ ...x, ...r })); else say(r.error, "error"); } catch (e) { say(e.message, "error"); } finally { sBusy(null); } };
  const sellPos = async (p, pct) => { sBusy("sell:" + p.id); try { const r = await a.vclose(pk, p.id, pct); if (r.ok) { say(`Sold ${pct}% of ${p.name || p.ticker || p.instrument.slice(0, 6)}${r.proceeds_usd != null ? ` for ${fmt(r.proceeds_usd)}` : ""}`, "ok"); sSt(x => ({ ...x, ...r })); } else say(r.error || "Sell failed", "error"); } catch (e) { say(e.message, "error"); } finally { sBusy(null); } };
  const [sweep, sSweep] = useState(null);
  // The sweep runs on the server, one token at a time; the page follows it until it is done.
  const sweepAll = async () => {
    if (!confirm("Sell every token in both bot wallets to SOL and ETH, one by one? This runs in the background and can take a while.")) return;
    sBusy("sweep");
    try { const r = await a.vsweep(pk, "all"); sSweep(r.sweep || null); if (!r.sweep) say(r.error || "Could not start", "error"); }
    catch (e) { say(e.message, "error"); sBusy(null); }
  };
  useEffect(() => {
    if (!pk || !sweep || sweep.done) { if (sweep?.done) sBusy(b => (b === "sweep" ? null : b)); return; }
    let on = true;
    const poll = async () => { try { const r = await a.vsweepStatus(pk); if (on && r.sweep) { sSweep(r.sweep); if (r.sweep.done) { say(`Sold ${r.sweep.sold}, ${r.sweep.failed} could not be sold`, r.sweep.failed ? "error" : "ok"); loadWallet(); } } } catch {} };
    const id = setInterval(poll, 2500); poll();
    return () => { on = false; clearInterval(id); };
  }, [pk, sweep?.done, sweep?.startedAt]);
  useEffect(() => { if (st?.sweep && !st.sweep.done && !sweep) sSweep(st.sweep); }, [st?.sweep?.startedAt]);
  // Every token in both wallets, with what a sell would fetch, whether or not the bot is running.
  const [hold, sHold] = useState(null); const [holdOpen, sHoldOpen] = useState(false);
  const loadHold = useCallback(async () => { if (!pk || !tw) return; try { const r = await a.vholdings(pk); if (r.holdings) sHold(r.holdings); } catch {} }, [pk, tw?.pubkey]);
  useEffect(() => { if (!holdOpen) return; loadHold(); const id = setInterval(loadHold, 25000); return () => clearInterval(id); }, [holdOpen, loadHold, sweep?.done]);
  const [selling, sSelling] = useState(null);
  const sellHolding = async (venue, instrument) => {
    sSelling(venue + instrument);
    try { const r = await a.vsell(pk, venue, instrument, 100); say(r.ok ? `Sold ${instrument.slice(0, 8)}… for ${Number(r.received || 0).toFixed(venue === "pons" ? 5 : 4)} ${venue === "pons" ? "ETH" : "SOL"}` : `${instrument.slice(0, 8)}…: ${r.error}`, r.ok ? "ok" : "error"); loadWallet(); sHold(h => h ? { ...h, sol: h.sol.map(x => x.instrument === instrument ? { ...x, result: r } : x), eth: h.eth.map(x => x.instrument === instrument ? { ...x, result: r } : x) } : h); }
    catch (e) { say(e.message, "error"); } finally { sSelling(null); }
  };
  const withdraw = async () => {
    if (running) { say("Stop the bot first", "error"); return; }
    if (!confirm(`Send all SOL from the bot wallet back to ${pk.slice(0, 6)}…?`)) return;
    sBusy("withdraw"); try { const r = await a.wdr(pk, pk, "all"); say(`Sent ${r.sol.toFixed(4)} SOL`, "ok"); await loadWallet(); } catch (e) { say(e.message, "error"); } finally { sBusy(null); }
  };
  const withdrawEth = async () => {
    if (running) { say("Stop the bot first", "error"); return; }
    const to = prompt("Send all ETH on Robinhood Chain to which 0x address?"); if (!to) return;
    sBusy("withdraw"); try { const r = await a.wdrEth(pk, to.trim()); say(`Sent ${r.eth.toFixed(5)} ETH`, "ok"); await loadWallet(); } catch (e) { say(e.message, "error"); } finally { sBusy(null); }
  };
  const exportKey = async () => {
    sBusy("key"); sMsg(null);
    try { const r = await a.etw(pk); if (!r?.privateKey) throw new Error("The server returned no key (" + JSON.stringify(r).slice(0, 80) + ")"); sShowKey({ sol: r.privateKey, evm: r.evmPrivateKey || null }); }
    catch (e) { console.error("export key", e); say("Export failed: " + (e.message || String(e)), "error"); }
    finally { sBusy(null); }
  };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); sCopied(true); setTimeout(() => sCopied(false), 1500); } catch {} };

  const funded = (tw?.solBalance || 0) >= 0.06;
  const wrap = { minHeight: "100vh", background: T.bg, color: T.tx, fontFamily: S, display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 16px 32px", boxSizing: "border-box" };
  const card = { width: "100%", maxWidth: 440, background: T.sf, border: `1px solid ${running ? T.gn : T.bd}`, borderRadius: 16, padding: 20, boxSizing: "border-box" };
  const muted = { color: T.ft, fontSize: 13, lineHeight: 1.5 };

  return <TC.Provider value={T}><style>{css(T)}</style><div style={wrap}>
    <div style={{ textAlign: "center", marginBottom: 28 }}>
      <img src="/bondli-logo.svg" alt="Bondli" style={{ height: 72, marginBottom: 14 }} />
      <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: "-.02em", lineHeight: 1.1 }}>A bot that trades memecoins for you.</div>
      <div style={{ ...muted, fontSize: 16, marginTop: 10 }}>You keep the wallet. It does the trading.</div>
    </div>

    <Launch T={T} />

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
          <span style={muted}>Bot wallet · Solana</span>
          <span style={{ fontFamily: M, fontWeight: 800, fontSize: 22 }}>{tw.solBalance.toFixed(3)} SOL</span>
        </div>
        <div onClick={() => copy(tw.pubkey)} title="copy" style={{ fontFamily: M, fontSize: 12, color: T.dm, marginTop: 6, wordBreak: "break-all", cursor: "pointer", padding: "8px 10px", background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}` }}>{tw.pubkey}{copied ? "  copied" : ""}</div>
        {!funded && <div style={{ ...muted, marginTop: 8 }}>Send SOL to that address to begin. 0.5 SOL is a good start.</div>}
        {tw.evmAddress && <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 14 }}>
            <span style={muted}>Bot wallet · Robinhood Chain</span>
            <span style={{ fontFamily: M, fontWeight: 800, fontSize: 22 }}>{tw.ethBalance == null ? "…" : tw.ethBalance.toFixed(4)} ETH</span>
          </div>
          <div onClick={() => copy(tw.evmAddress)} title="copy" style={{ fontFamily: M, fontSize: 12, color: T.dm, marginTop: 6, wordBreak: "break-all", cursor: "pointer", padding: "8px 10px", background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}` }}>{tw.evmAddress}{copied ? "  copied" : ""}</div>
          {!(tw.ethBalance > 0.003) && <div style={{ ...muted, marginTop: 8 }}>Optional. Send ETH on Robinhood Chain to that address and the bot trades PONS launches too. 0.05 ETH is a good start.</div>}
        </>}

        {/* 3. Two choices, then start */}
        {funded && <>
          <div style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={muted}>Risk</span><span style={{ fontWeight: 800, color: RISK_C(agg, T) }}>{AGG[agg]?.l}</span></div>
          <Dial value={agg} onChange={sAgg} T={T} />
          <div style={{ ...muted, marginTop: 8 }}>{AGG[agg]?.d}</div>
          <div style={{ marginTop: 14, ...muted, marginBottom: 6 }}>Per trade</div>
          <div style={{ display: "flex", gap: 6 }}>{SIZES.map(v => <button key={v} onClick={() => sSize(v)} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${size === v ? T.gn : T.bd}`, background: size === v ? T.gn + "22" : "transparent", color: size === v ? T.gn : T.dm, fontFamily: M, fontWeight: 800, cursor: "pointer" }}>${v}</button>)}</div>
          <div style={{ ...muted, marginTop: 10 }}>Up to 4 tokens at once. Stops for the day after ${Math.max(15, size * 3)} of losses.</div>
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            {[["pump.fun", "Solana", true, true], ["PONS", "Robinhood Chain", !!chains.pons && (tw?.ethBalance || 0) > 0.003, (tw?.ethBalance || 0) > 0.003]].map(([l, sub, on, can]) => <div key={l} onClick={() => l === "PONS" && can && sChains(c => ({ ...c, pons: !c.pons }))} style={{ flex: 1, padding: "8px 10px", borderRadius: 10, border: `1px solid ${on ? T.gn : T.bd}`, background: on ? T.gn + "14" : "transparent", cursor: l === "PONS" && can ? "pointer" : "default", opacity: can ? 1 : .5 }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: on ? T.gn : T.dm }}>{l}</div><div style={{ ...muted, fontSize: 11 }}>{sub}{l === "PONS" && !can ? " · fund with ETH" : on ? " · on" : " · off"}</div>
            </div>)}
          </div>
          <div style={{ marginTop: 16 }}><Btn big T={T} onClick={start} disabled={busy === "start"}>{busy === "start" ? "Starting…" : "Start"}</Btn></div>
        </>}
      </>}

      {/* 4. Running: the number, the holdings, the bot's own words, the stop */}
      {running && <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: T.gn, animation: "gp 2s infinite" }} /><span style={{ fontWeight: 800 }}>Trading</span></span>
          <span style={{ fontFamily: M, fontWeight: 900, fontSize: 30, color: pnl >= 0 ? T.gn : T.rd }}>{pnl >= 0 ? "+" : ""}{fmt(pnl)}</span>
        </div>
        <div style={{ ...muted, display: "flex", justifyContent: "space-between", marginTop: 2 }}><span title={pnlKind === "wallet" ? "wallet plus open positions now, against when you pressed Start" : "closed trades today plus open positions"}>{pnlKind === "wallet" ? "since start" : "today"}, {day?.trades || 0} trades{tp ? ` · closed ${(day?.realizedUsd || 0) >= 0 ? "+" : ""}${fmt(day?.realizedUsd || 0)} · open ${(tp.unrealized_usd || 0) >= 0 ? "+" : ""}${fmt(tp.unrealized_usd || 0)}` : ""}</span><span>{(() => { const w = s?.bankroll?.wallets || {}; const sol = w.pumpfun?.sol ?? tw?.solBalance, eth = w.pons?.sol ?? tw?.ethBalance; const parts = []; if (sol != null) parts.push(Number(sol).toFixed(3) + " SOL"); if (eth != null) parts.push(Number(eth).toFixed(4) + " ETH"); return parts.join(" · "); })()}</span></div>
        {paused && <div style={{ color: T.yl, fontSize: 13, marginTop: 8 }}>{/user/.test(s.halt.reason || "") ? "Paused. Open positions still get sold on their plan; nothing new is bought." : `Paused by the bot: ${s.halt.reason}`}</div>}
        {s?.positions?.length > 0 && <div style={{ marginTop: 12 }}>{s.positions.map(p => { const now = Date.now(); const tickAge = p.lastTickAt ? (now - p.lastTickAt) / 1000 : null; const stale = tickAge == null ? now - p.entryTime > 60_000 : tickAge > 60; const open = openPos === p.id; const url = p.venue === "pons" ? `https://www.ponsfamily.com/launchpad/${p.instrument}` : `https://pump.fun/coin/${p.instrument}`; const held = Math.round((now - p.entryTime) / 60000); return <div key={p.id} style={{ borderTop: `1px solid ${T.bd}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 8, alignItems: "center", fontFamily: M, fontSize: 13, padding: "6px 0" }}>
            <span onClick={() => sOpenPos(open ? null : p.id)} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}><span style={{ fontWeight: 800, color: T.tx }}>{p.name || p.ticker || p.instrument.slice(0, 6) + "…"}</span> <span style={{ color: T.ft, fontSize: 11 }}>{p.venue === "pons" ? "RH" : "SOL"} · {held}m{stale ? " · no price" : ""}</span></span>
            {(() => { const value = (p.notional_usd || 0) * (1 + (p.changePct || 0) / 100), delta = value - (p.notional_usd || 0), up = delta >= 0; return <span onClick={() => sOpenPos(open ? null : p.id)} style={{ textAlign: "right", cursor: "pointer", lineHeight: 1.2 }}><div style={{ color: T.tx }}>{fmt(value)}</div><div style={{ fontSize: 11, color: stale ? T.yl : up ? T.gn : T.rd }}>{up ? "+" : "-"}{fmt(Math.abs(delta)).replace(/^[-$]+/, "$")} · {p.changePct != null ? (p.changePct >= 0 ? "+" : "") + p.changePct.toFixed(1) + "%" : ""}</div></span>; })()}
            <button onClick={() => sellPos(p, 50)} disabled={busy === "sell:" + p.id} style={{ background: "transparent", border: `1px solid ${T.bd}`, color: T.dm, borderRadius: 8, padding: "6px 8px", fontFamily: S, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>50%</button>
            <button onClick={() => sellPos(p, 100)} disabled={busy === "sell:" + p.id} style={{ background: "transparent", border: `1px solid ${T.rd}`, color: T.rd, borderRadius: 8, padding: "6px 8px", fontFamily: S, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>{busy === "sell:" + p.id ? "…" : "Sell"}</button>
          </div>
          {open && <div style={{ fontFamily: M, fontSize: 11, color: T.ft, lineHeight: 1.6, padding: "2px 0 8px" }}>
            <div>{p.instrument} <a href={url} target="_blank" rel="noopener" style={{ color: T.gn }}>open on {p.venue === "pons" ? "PONS" : "pump.fun"}</a></div>
            <div>paid {fmt(p.stake_usd || p.notional_usd)} · entry mcap {kfmt(p.entryMark || 0)} · now {kfmt(p.mark || p.entryMark || 0)} · peak {kfmt(p.peak || p.entryMark || 0)}</div>
            {p.sizing && <div>sized {fmt(p.stake_usd || 0)}{p.sizing.kelly ? ` · kelly ${(p.sizing.kelly.f_used * 100).toFixed(1)}% × throttle ${p.sizing.throttle ?? 1}` : ""}{p.sizing.caps?.length ? ` · capped by ${p.sizing.caps.join(", ").toLowerCase().replace(/_/g, " ")}` : ""}</div>}
            <div>tier {p.tier} · plan {String(p.plan?.key)} · targets hit {p.tpHit || 0}{p.plan?.stall_ms ? ` · stall check at ${Math.round(p.plan.stall_ms / 60000)}m` : ""}{p.plan?.max_hold_ms ? ` · out by ${Math.round(p.plan.max_hold_ms / 60000)}m` : ""}</div>
            <div style={{ color: stale ? T.yl : T.ft }}>price updated {tickAge == null ? "never" : tickAge < 60 ? Math.round(tickAge) + "s ago" : Math.round(tickAge / 60) + "m ago"}{stale ? " · exits cannot fire without a price" : ""}</div>
          </div>}
        </div>; })}</div>}
        {(() => { const h = s?.holdings || {}; const rows = Object.entries(h).flatMap(([venue, x]) => (x.list || []).filter(i => !i.tracked && i.qty >= 1).map(i => ({ ...i, venue }))); if (!rows.length) return null; return <div style={{ marginTop: 10, fontFamily: M, fontSize: 11, color: T.yl, lineHeight: 1.6 }}>
          <div>in the wallet but not tracked as open (being reconciled):</div>
          {rows.map(r => <div key={r.venue + r.instrument} style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><a href={r.venue === "pons" ? `https://www.ponsfamily.com/launchpad/${r.instrument}` : `https://pump.fun/coin/${r.instrument}`} target="_blank" rel="noopener" style={{ color: T.yl }}>{r.instrument.slice(0, 10)}…</a> · {r.venue === "pons" ? "RH" : "SOL"} · {Number(r.qty).toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens</span><button onClick={() => sellHolding(r.venue, r.instrument)} disabled={selling === r.venue + r.instrument} style={{ background: "transparent", border: `1px solid ${T.rd}`, color: T.rd, borderRadius: 8, padding: "4px 8px", fontFamily: S, fontWeight: 800, fontSize: 11, cursor: "pointer" }}>{selling === r.venue + r.instrument ? "…" : "Sell"}</button></div>)}
        </div>; })()}
        <div ref={narRef} style={{ marginTop: 14, fontFamily: M, fontSize: 11, lineHeight: 1.55, height: 200, overflowY: "auto", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 10, padding: "8px 10px", color: T.ft }}>
          {(st.narration || []).map((n, i) => <div key={i} style={{ color: /FILLED|SOLD|P&L/.test(n.line) ? T.tx : /fee/.test(n.line) ? T.yl : T.ft, whiteSpace: "pre-wrap" }}>{n.line}</div>)}
          {!(st.narration || []).length && <div>watching every new token…</div>}
        </div>
        <Pulse st={st} T={T} />
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <Btn ghost T={T} onClick={paused ? resume : pause} disabled={busy === "pause"}>{busy === "pause" ? "…" : paused ? "Resume" : "Pause"}</Btn>
          <Btn danger T={T} onClick={stop} disabled={busy === "stop"}>{busy === "stop" ? "Selling…" : "Sell all & stop"}</Btn>
        </div>
      </>}
      {msg && <div onClick={() => sMsg(null)} title="tap to dismiss" style={{ marginTop: 12, fontSize: 13, cursor: "pointer", color: msg.kind === "error" ? T.rd : T.gn }}>{msg.m} <span style={{ color: T.dm }}>×</span></div>}
    </div>

    {/* Footer: the two ways out, and the one line about money */}
    {pk && tw && <div style={{ width: "100%", maxWidth: 440, marginTop: 14, display: "flex", gap: 8 }}>
      <Btn ghost T={T} onClick={withdraw} disabled={busy === "withdraw" || running}>{busy === "withdraw" ? "Sending…" : "Withdraw SOL"}</Btn>
      {tw.ethBalance > 0 && <Btn ghost T={T} onClick={withdrawEth} disabled={busy === "withdraw" || running}>Withdraw ETH</Btn>}
      <Btn ghost T={T} onClick={exportKey} disabled={busy === "key"}>{busy === "key" ? "Signing…" : "Export key"}</Btn>
    </div>}
    {pk && tw && <div style={{ width: "100%", maxWidth: 440, marginTop: 8 }}>
      <Btn ghost T={T} onClick={() => sHoldOpen(o => !o)}>{holdOpen ? "Hide the wallets' tokens" : "Show every token in the wallets"}</Btn>
      {holdOpen && <div style={{ marginTop: 8, background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 12, padding: "10px 12px", fontFamily: M, fontSize: 11, lineHeight: 1.5 }}>
        {!hold && <div style={{ color: T.ft }}>reading both wallets…</div>}
        {hold && [...hold.sol, ...hold.eth].length === 0 && <div style={{ color: T.ft }}>no tokens in either wallet</div>}
        {hold && [...hold.sol, ...hold.eth].map(h => { const sellable = h.state === "curve" || h.state === "unknown" && h.venue === "pumpfun"; const k = h.venue + h.instrument; return <div key={k} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center", padding: "6px 0", borderTop: `1px solid ${T.bd}` }}>
          <span style={{ minWidth: 0 }}>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><a href={h.url} target="_blank" rel="noopener" style={{ color: T.tx, fontWeight: 800, textDecoration: "none" }}>{h.name || h.ticker || h.instrument.slice(0, 10) + "…"}</a> <span style={{ color: T.ft }}>{h.venue === "pons" ? "RH" : "SOL"}{h.tracked ? " · open" : ""}</span></div>
            <div style={{ color: h.state === "curve" ? T.ft : T.yl }}>{Number(h.qty).toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens · {h.state}{h.curvePct != null ? ` ${Math.round(h.curvePct * 100)}%` : ""}{h.mcapUsd ? ` · mcap ${kfmt(h.mcapUsd)}` : ""}{h.via === "transfer" ? " (found by its transfer)" : ""}{h.state === "graduated" ? " · sell on the pool by hand" : h.state === "not a curve token" ? " · no curve sells it; see explorer" : ""}</div>
            {h.result && <div style={{ color: h.result.ok ? T.gn : T.rd }}>{h.result.ok ? `sold for ${Number(h.result.received || 0).toFixed(5)}` : h.result.error}</div>}
            {h.explorer && h.state !== "curve" && <a href={h.explorer} target="_blank" rel="noopener" style={{ color: T.dm }}>explorer</a>}
          </span>
          <span style={{ textAlign: "right", color: T.tx }}>{h.valueUsd != null ? fmt(h.valueUsd) : "—"}</span>
          <button onClick={() => sellHolding(h.venue, h.instrument)} disabled={!sellable || selling === k} style={{ background: "transparent", border: `1px solid ${sellable ? T.rd : T.bd}`, color: sellable ? T.rd : T.dm, borderRadius: 8, padding: "5px 9px", fontFamily: S, fontWeight: 800, fontSize: 11, cursor: sellable ? "pointer" : "default" }}>{selling === k ? "…" : "Sell"}</button>
        </div>; })}
        {hold?.scan && !hold.scan.done && <div style={{ color: T.dm, marginTop: 6 }}>still reading the chain's history for tokens no index lists; the list grows on each refresh</div>}
        {hold?.errors?.length > 0 && <div style={{ color: T.yl, marginTop: 6 }}>{hold.errors.join(" · ")}</div>}
      </div>}
      <div style={{ height: 8 }} />
      <Btn ghost T={T} onClick={sweepAll} disabled={busy === "sweep" || (sweep && !sweep.done)}>{sweep && !sweep.done ? `Selling one by one… ${sweep.sold + sweep.failed} done${sweep.current ? ` · now ${sweep.current.venue === "pons" ? "RH" : "SOL"} ${sweep.current.instrument.slice(0, 8)}…` : ""}` : "Sell every token in the wallets"}</Btn>
      {sweep && (sweep.report?.length > 0 || sweep.error) && <div style={{ marginTop: 8, fontFamily: M, fontSize: 11, color: T.ft, lineHeight: 1.6 }}>
        <div style={{ color: T.dm, display: "flex", justifyContent: "space-between" }}><span>{sweep.done ? `finished: ${sweep.sold} sold, ${sweep.failed} not sold` : `running: ${sweep.sold} sold, ${sweep.failed} not sold so far`}{sweep.error ? ` · ${sweep.error}` : ""}</span>{sweep.done && <span onClick={() => sSweep(null)} style={{ cursor: "pointer", padding: "0 4px" }}>clear ×</span>}</div>
        {sweep.report.map((r, i) => <div key={i} style={{ color: r.ok ? T.gn : r.note ? T.dm : T.yl }}>{r.instrument ? `${r.venue === "pons" ? "RH" : "SOL"} ${r.instrument.slice(0, 10)}… ` : ""}{r.ok ? `sold${r.received != null ? ` for ${Number(r.received).toFixed(r.venue === "pons" ? 5 : 4)} ${r.venue === "pons" ? "ETH" : "SOL"}` : ""}` : `${r.code ? r.code + ": " : ""}${r.error}`}</div>)}
      </div>}
    </div>}
    {msg && !running && pk && tw && <div onClick={() => sMsg(null)} title="tap to dismiss" style={{ width: "100%", maxWidth: 440, marginTop: 8, fontSize: 13, cursor: "pointer", color: msg.kind === "error" ? T.rd : T.gn }}>{msg.m} <span style={{ color: T.dm }}>×</span></div>}
    {showKey && <div style={{ width: "100%", maxWidth: 440, marginTop: 10, background: T.sf, border: `1px solid ${T.yl}`, borderRadius: 12, padding: 14 }}>
      <div style={{ ...muted, color: T.yl, marginBottom: 6 }}>Your bot wallet's private keys. Anyone with them owns the wallets. Solana key into Phantom; Robinhood Chain key into MetaMask or Rabby.</div>
      <div style={{ ...muted, fontSize: 11, marginTop: 6 }}>Solana</div>
      <div onClick={() => copy(showKey.sol)} title="tap to copy" style={{ fontFamily: M, fontSize: 12, wordBreak: "break-all", cursor: "pointer", color: T.tx, padding: "8px 10px", background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}` }}>{showKey.sol}</div>
      {showKey.evm && <><div style={{ ...muted, fontSize: 11, marginTop: 8 }}>Robinhood Chain</div>
      <div onClick={() => copy(showKey.evm)} title="tap to copy" style={{ fontFamily: M, fontSize: 12, wordBreak: "break-all", cursor: "pointer", color: T.tx, padding: "8px 10px", background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}` }}>{showKey.evm}</div></>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}><Btn ghost T={T} onClick={() => sShowKey(null)}>Hide</Btn></div>
    </div>}
    <Live T={T} agg={agg} />
    <div style={{ ...muted, fontSize: 12, marginTop: 28, textAlign: "center", maxWidth: 440 }}>Bondli keeps {FEE_PCT}% of each profitable trade, taken from the profit. Losing trades cost nothing. Memecoins can go to zero; only trade what you can lose.</div>
  </div></TC.Provider>;
}
