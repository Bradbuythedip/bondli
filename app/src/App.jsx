import { useState, useEffect, useRef, useMemo } from "react";

const API = "https://bondli-production.up.railway.app";
const WS_URL = "wss://bondli-production.up.railway.app/ws";
const PLATFORM_WALLET = "anal.sol";
const ACCESS_FEE_SOL = 0.1;

const T = {
  bg: "#0e0e10", bg2: "#151519", surface: "#1a1a21", surface2: "#222230",
  card: "#1c1c26", border: "#2a2a3a", borderLit: "#3d3d55",
  green: "#00e676", greenDim: "#00c853", greenGhost: "rgba(0,230,118,0.07)",
  red: "#ff1744", redGhost: "rgba(255,23,68,0.08)",
  yellow: "#ffd600", orange: "#ff9100", blue: "#448aff", purple: "#b388ff",
  pink: "#ff80ab", cyan: "#18ffff",
  text: "#eaeaf2", dim: "#8585a8", mid: "#aaaac4", faint: "#55556e",
};
const mono = "'IBM Plex Mono','JetBrains Mono','Fira Code',monospace";
const sans = "'Nunito','DM Sans','Segoe UI',system-ui,sans-serif";

const ROLES = [
  { id:"sniper", name:"Sniper", emoji:"\u{1F3AF}", color:T.red, weight:8, desc:"Fast entry, secures early position", thinkStyle:"aggressive" },
  { id:"accumulator", name:"Accumulator", emoji:"\u{1F41C}", color:T.blue, weight:12, desc:"Steady micro-buys, builds price floor", thinkStyle:"patient" },
  { id:"momentum", name:"Momentum", emoji:"\u{1F3CE}\uFE0F", color:T.green, weight:22, desc:"Buy pressure, creates FOMO", thinkStyle:"reactive" },
  { id:"swing", name:"Swing", emoji:"\u{1F3A2}", color:T.purple, weight:18, desc:"Buys dips, sells rips", thinkStyle:"analytical" },
  { id:"whale", name:"Whale", emoji:"\u{1F40B}", color:T.yellow, weight:28, desc:"Large trades at key moments", thinkStyle:"strategic" },
  { id:"liquidator", name:"Liquidator", emoji:"\u{1F4B0}", color:T.orange, weight:8, desc:"Strategic profit-taking", thinkStyle:"cautious" },
  { id:"recycler", name:"Recycler", emoji:"\u267B\uFE0F", color:T.dim, weight:4, desc:"Sells tokens, recycles SOL back", thinkStyle:"mechanical" },
];

const THOUGHTS = {
  aggressive: ["scanning mempool for entry window...","detected low liquidity \u2014 preparing front-run","optimal entry: next 2 blocks, slippage ok","monitoring for MEV on this pair","entry locked. watching curve velocity","5 new wallets \u2014 possible bundler. alert"],
  patient: ["accumulating slowly... 3 micro-buys queued","price dipped 2.1% \u2014 increasing buy freq","building floor support at current level","spread across 3 size tiers to hide","steady state. drip buying continues","organic buy pressure \u2014 reducing freq"],
  reactive: ["2 consecutive buys \u2014 joining momentum","FOMO trigger: 4 buys in 30s, burst deploy","momentum stalling... pausing to reassess","volume spike! increasing size 40%","painting green candle \u2014 3 rapid buys","cooling off. needs organic confirmation"],
  analytical: ["price at local resistance \u2014 sell ladder","support held at 0.0000043 \u2014 placing buy","RSI overbought. shifting to sell bias","range: buy low band, sell upper","breakout potential \u2014 switch to momentum","dip buyer activated. absorbing sells"],
  strategic: ["holding dry powder for key level","deploying 40% allocation \u2014 high conviction","large buy at curve inflection: max impact","whale entry creates narrative. timing social","watching graduation threshold \u2014 deploy rest","position established. managing exit ladder"],
  cautious: ["profit target 1 \u2014 trimming 15%","sell ladder: 20/30/50 split","distribution phase. accelerating exits","locking gains before curve flattens","partial exit done. recycling SOL","3 sells over next 5 minutes"],
  mechanical: ["scanning wallets for stranded tokens...","recycling 42k tokens \u2192 ~0.012 SOL","SOL recovered. redistributing to fleet","cleaning ATA accounts for gas savings","sweep complete. reserve replenished","idle. waiting for trigger conditions"],
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:6px}
::-webkit-scrollbar-track{background:#0e0e10}
::-webkit-scrollbar-thumb{background:#2a2a3a;border-radius:3px}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes glow{0%,100%{box-shadow:0 0 15px rgba(0,230,118,.15)}50%{box-shadow:0 0 40px rgba(0,230,118,.3)}}
@keyframes think{0%{opacity:.3}50%{opacity:1}100%{opacity:.3}}
@keyframes slideIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
input[type=range]{cursor:pointer}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#00e676;border:2px solid #0e0e10;cursor:pointer}
`;

// === ICONS ===
const Ic = {
  Lock: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  Unlock: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 019.9-1"/></svg>,
  Play: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>,
  Stop: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>,
  Check: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>,
  Brain: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96.44A2.5 2.5 0 015.5 18a2.5 2.5 0 01-1-4.74A2.5 2.5 0 014 11a2.5 2.5 0 013.02-2.45A2.5 2.5 0 019.5 2z"/><path d="M14.5 2A2.5 2.5 0 0012 4.5v15a2.5 2.5 0 004.96.44A2.5 2.5 0 0018.5 18a2.5 2.5 0 001-4.74A2.5 2.5 0 0020 11a2.5 2.5 0 00-3.02-2.45A2.5 2.5 0 0014.5 2z"/></svg>,
  Wallet: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12V7H5a2 2 0 010-4h14v4"/><path d="M3 5v14a2 2 0 002 2h16v-5"/><path d="M18 12a2 2 0 000 4h4v-4h-4z"/></svg>,
  Upload: () => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  Zap: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  Phantom: () => <svg width="20" height="20" viewBox="0 0 128 128" fill="none"><rect width="128" height="128" rx="26" fill="url(#pg)"/><defs><linearGradient id="pg" x1="0" y1="0" x2="128" y2="128"><stop stopColor="#534bb1"/><stop offset="1" stopColor="#551bf9"/></linearGradient></defs><path d="M110.6 64.1c-2.4-11.5-13.4-19.6-24.2-22.6-14.6-4-30.2-1.5-43.2 5.8-8.1 4.5-15.1 11.1-18.5 19.8-4.5 11.5-1.7 25.4 8 33.5 4.5 3.8 10.3 6.2 16.2 6.2 3.6 0 7.1-.7 10.4-2.2 2.4-1.1 4.5-2.7 6.9-3.8 4-1.8 8.5-1.8 12.8-1 4.2.7 8.1 2.6 12.1 4 4.2 1.5 9 2.3 13.2.5 5.6-2.3 9-7.9 8.6-13.8-.2-3.5-.7-6.9-1.3-10.3-.5-2.8-.7-5.6-.7-8.5 0-2.5.2-5.1-.3-7.6z" fill="#fff"/><circle cx="44" cy="68" r="6" fill="#534bb1"/><circle cx="72" cy="68" r="6" fill="#534bb1"/></svg>,
  Disconnect: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
};

// Bondli pill icon
const BondliIcon = () => (
  <svg width="34" height="34" viewBox="0 0 40 40">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#ff2d78"/>
        <stop offset="100%" stopColor="#00e87b"/>
      </linearGradient>
    </defs>
    <rect x="4" y="10" width="32" height="20" rx="10" fill="url(#bg)" opacity="0.9"/>
    <circle cx="15" cy="20" r="4" fill="white" opacity="0.9"/>
    <circle cx="27" cy="20" r="3" fill="white" opacity="0.7"/>
  </svg>
);

// === COMPONENTS ===
function Btn({ children, onClick, color = T.green, ghost = false, disabled = false, small = false, full = false, style: sx = {} }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        padding: small ? "8px 16px" : "12px 24px",
        borderRadius: 12, fontFamily: mono, fontSize: small ? 14 : 16, fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.35 : 1,
        width: full ? "100%" : undefined,
        border: ghost ? "2px solid " + color + "44" : "none",
        background: ghost ? (hov ? color + "15" : "transparent") : (hov ? color + "dd" : color),
        color: ghost ? color : T.bg,
        transform: hov && !disabled ? "translateY(-1px)" : "none",
        transition: "all .15s", letterSpacing: ".02em", ...sx,
      }}
    >{children}</button>
  );
}

function Input({ value, onChange, placeholder, type = "text", icon, big = false, ...props }) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "0 16px", background: T.bg, border: "2px solid " + (focus ? T.green + "55" : T.border),
      borderRadius: 12, transition: "border-color .2s",
    }}>
      {icon && <span style={{ color: T.dim, display: "flex" }}>{icon}</span>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{
          flex: 1, padding: big ? "14px 0" : "12px 0", background: "none", border: "none", outline: "none",
          color: T.text, fontFamily: mono, fontSize: big ? 16 : 15,
        }}
        {...props}
      />
    </div>
  );
}

function Label({ children }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: T.dim, fontFamily: mono, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 8 }}>{children}</div>;
}

// === PHANTOM WALLET LOGIN ===
function PhantomGate({ onConnect }) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const connectPhantom = async () => {
    setConnecting(true); setError("");
    try {
      const provider = window?.solana;
      if (!provider?.isPhantom) {
        setError("Phantom wallet not found. Install it at phantom.app");
        setConnecting(false);
        return;
      }
      const resp = await provider.connect();
      const pubkey = resp.publicKey.toString();

      // Check if already paid
      try {
        const res = await fetch(API + "/api/payment/status?wallet=" + pubkey);
        const data = await res.json();
        if (data.paid) {
          onConnect({ pubkey, token: null, demo: false });
          return;
        }
      } catch {}

      onConnect({ pubkey, token: null, demo: false });
    } catch (e) {
      setError("Connection rejected");
    }
    setConnecting(false);
  };

  return (
    <div style={{
      minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center",
      position: "relative", overflow: "hidden",
    }}>
      <style>{css}</style>
      <div style={{
        position: "absolute", inset: 0, opacity: 0.03,
        backgroundImage: "linear-gradient(" + T.green + " 1px, transparent 1px), linear-gradient(90deg, " + T.green + " 1px, transparent 1px)",
        backgroundSize: "60px 60px",
      }} />
      <div style={{
        width: 500, padding: 44, background: T.surface, border: "2px solid " + T.border,
        borderRadius: 24, position: "relative", animation: "fadeUp .5s ease",
        boxShadow: "0 40px 80px rgba(0,0,0,.5), 0 0 60px " + T.green + "08",
      }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 18, margin: "0 auto 20px",
            background: "linear-gradient(135deg, " + T.green + "22, " + T.green + "08)",
            border: "2px solid " + T.green + "33", display: "flex", alignItems: "center", justifyContent: "center",
            animation: "glow 3s ease infinite",
          }}>
            <BondliIcon />
          </div>
          <h1 style={{ fontFamily: sans, fontWeight: 900, fontSize: 34, color: T.text, letterSpacing: "-.02em" }}>
            BOND<span style={{ color: T.green }}>LI</span>
          </h1>
          <p style={{ fontSize: 16, color: T.dim, marginTop: 8, fontFamily: sans }}>Game Theory Trading Engine v3.0</p>
        </div>

        <div style={{
          padding: 24, background: T.bg, borderRadius: 14, border: "1px solid " + T.border, marginBottom: 24,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontSize: 14, color: T.dim, fontFamily: mono, fontWeight: 600 }}>ACCESS FEE</span>
            <span style={{ fontSize: 26, fontFamily: mono, fontWeight: 800, color: T.green }}>{ACCESS_FEE_SOL} SOL</span>
          </div>
          <div style={{
            padding: "14px 18px", background: T.surface, borderRadius: 10,
            border: "1px dashed " + T.border, fontFamily: mono, fontSize: 16,
            color: T.green, wordBreak: "break-all", textAlign: "center", letterSpacing: ".03em", fontWeight: 600,
          }}>{PLATFORM_WALLET}</div>
          <p style={{ fontSize: 14, color: T.faint, textAlign: "center", marginTop: 12, fontFamily: sans, lineHeight: 1.5 }}>
            Connect Phantom, pay once, trade forever
          </p>
        </div>

        {error && <p style={{ fontSize: 14, color: T.red, marginBottom: 14, fontFamily: mono, textAlign: "center" }}>{error}</p>}

        <Btn onClick={connectPhantom} full disabled={connecting}
          style={{ padding: "16px 24px", fontSize: 17, borderRadius: 14, background: "linear-gradient(135deg, #534bb1, #551bf9)", gap: 12 }}>
          <Ic.Phantom /> {connecting ? "Connecting..." : "Connect Phantom"}
        </Btn>

        <div style={{ textAlign: "center", marginTop: 24, paddingTop: 20, borderTop: "1px solid " + T.border }}>
          <button onClick={() => onConnect({ pubkey: "demo", token: null, demo: true })} style={{
            background: "none", border: "none", color: T.faint, cursor: "pointer",
            fontFamily: mono, fontSize: 14, textDecoration: "underline", textUnderlineOffset: 4,
          }}>Preview in demo mode \u2192</button>
        </div>
      </div>
    </div>
  );
}

// === WALLET CARD (identical to original) ===
function WalletCard({ role, solBudget }) {
  const [status, setStatus] = useState("idle");
  const [thought, setThought] = useState("");
  const [trades, setTrades] = useState([]);
  const [solSpent, setSolSpent] = useState(0);
  const [solRecovered, setSolRecovered] = useState(0);
  const [tokenBal, setTokenBal] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const exitRef = useRef(null);

  const addr = useMemo(() => {
    const c = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    return Array.from({ length: 44 }, () => c[Math.floor(Math.random() * c.length)]).join("");
  }, []);

  useEffect(() => {
    if (status !== "thinking" && status !== "buying" && status !== "holding") return;
    const pool = THOUGHTS[role.thinkStyle] || THOUGHTS.patient;
    const iv = setInterval(() => setThought(pool[Math.floor(Math.random() * pool.length)]), 2000 + Math.random() * 3000);
    return () => clearInterval(iv);
  }, [status, role.thinkStyle]);

  useEffect(() => {
    if (status !== "buying" && status !== "holding") return;
    const iv = setInterval(() => {
      const isBuy = status === "buying" ? Math.random() > 0.2 : Math.random() > 0.6;
      const amt = +(Math.random() * solBudget * 0.15 + 0.001).toFixed(4);
      const tokens = Math.floor(amt * (80000 + Math.random() * 200000));
      const sig = Array.from({ length: 10 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

      setSolSpent(prev => {
        if (isBuy && prev < solBudget * 0.85) {
          setTokenBal(p => p + tokens);
          setTrades(p => [{ id: Date.now(), side: "BUY", sol: amt, tokens, sig, time: new Date().toLocaleTimeString() }, ...p].slice(0, 20));
          return +(prev + amt).toFixed(4);
        }
        return prev;
      });
      setTokenBal(prev => {
        if (!isBuy && prev > 0) {
          const sell = Math.floor(prev * (0.1 + Math.random() * 0.3));
          const solBack = +(sell / (80000 + Math.random() * 200000)).toFixed(4);
          setSolRecovered(p => +(p + solBack).toFixed(4));
          setTrades(p => [{ id: Date.now(), side: "SELL", sol: solBack, tokens: sell, sig, time: new Date().toLocaleTimeString() }, ...p].slice(0, 20));
          return Math.max(0, prev - sell);
        }
        return prev;
      });
    }, 3000 + Math.random() * 5000);
    return () => clearInterval(iv);
  }, [status, solBudget]);

  const handleDryLaunch = () => { setStatus("thinking"); setTimeout(() => setStatus("buying"), 1500 + Math.random() * 2000); };
  const handleDryClose = () => {
    setStatus("closing"); setThought("closing all positions... selling to curve");
    exitRef.current = setInterval(() => {
      setTokenBal(prev => {
        if (prev <= 0) { clearInterval(exitRef.current); setStatus("closed"); return 0; }
        const chunk = Math.floor(prev * 0.4);
        const solBack = +(chunk / 100000).toFixed(4);
        setSolRecovered(p => +(p + solBack).toFixed(4));
        setTrades(p => [{ id: Date.now(), side: "EXIT", sol: solBack, tokens: chunk, sig: "exit_" + Date.now().toString(36), time: new Date().toLocaleTimeString() }, ...p].slice(0, 20));
        return Math.max(0, prev - chunk);
      });
    }, 800);
  };
  const handleReset = () => { if (exitRef.current) clearInterval(exitRef.current); setStatus("idle"); setTrades([]); setSolSpent(0); setSolRecovered(0); setTokenBal(0); setThought(""); };

  const net = +(solRecovered - solSpent).toFixed(4);
  const sc = { idle: { color: T.faint, label: "IDLE" }, thinking: { color: T.yellow, label: "THINKING..." }, buying: { color: T.green, label: "BUYING" }, holding: { color: T.blue, label: "HOLDING" }, closing: { color: T.orange, label: "CLOSING..." }, closed: { color: T.dim, label: "CLOSED" } }[status];

  return (
    <div style={{
      background: T.card, border: "2px solid " + (status === "buying" ? T.green + "44" : status === "closing" ? T.orange + "44" : T.border),
      borderRadius: 16, overflow: "hidden", transition: "all .3s", animation: "fadeUp .4s ease",
      boxShadow: status === "buying" ? "0 0 30px " + T.green + "10" : "none",
    }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid " + T.border, cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}>
        <span style={{ fontSize: 30 }}>{role.emoji}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: T.text }}>{role.name}</span>
            <span style={{
              fontSize: 11, fontFamily: mono, fontWeight: 700, padding: "3px 10px",
              borderRadius: 6, background: sc.color + "18", color: sc.color, border: "1px solid " + sc.color + "33",
              animation: (status === "thinking" || status === "closing") ? "pulse 1.5s infinite" : "none",
            }}>{sc.label}</span>
          </div>
          <div style={{ fontSize: 13, color: T.faint, fontFamily: mono, marginTop: 3 }}>{addr.slice(0, 8)}...{addr.slice(-6)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 17, fontFamily: mono, fontWeight: 700, color: role.color }}>{solBudget.toFixed(4)}</div>
          <div style={{ fontSize: 12, color: T.dim }}>SOL</div>
        </div>
      </div>

      {status !== "idle" && status !== "closed" && (
        <div style={{ padding: "10px 20px", background: T.bg, borderBottom: "1px solid " + T.border + "22", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: T.yellow, display: "flex", animation: "think 2s infinite" }}><Ic.Brain /></span>
          <span style={{ fontSize: 13, color: T.mid, fontFamily: mono, fontStyle: "italic", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", animation: "slideIn .3s ease" }} key={thought}>{thought || "initializing..."}</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1, background: T.border + "44" }}>
        {[
          { label: "Spent", val: solSpent.toFixed(4), c: T.red },
          { label: "Recovered", val: solRecovered.toFixed(4), c: T.green },
          { label: "Net", val: (net >= 0 ? "+" : "") + net.toFixed(4), c: net >= 0 ? T.green : T.red },
          { label: "Tokens", val: tokenBal.toLocaleString(), c: T.yellow },
        ].map(s => (
          <div key={s.label} style={{ padding: "10px 14px", background: T.card }}>
            <div style={{ fontSize: 11, color: T.faint, fontFamily: mono, marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontSize: 15, color: s.c, fontFamily: mono, fontWeight: 600 }}>{s.val}</div>
          </div>
        ))}
      </div>

      {expanded && trades.length > 0 && (
        <div style={{ maxHeight: 200, overflow: "auto", borderTop: "1px solid " + T.border }}>
          {trades.map(t => (
            <div key={t.id} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "7px 20px",
              fontSize: 13, fontFamily: mono, borderBottom: "1px solid " + T.border + "22", animation: "slideIn .2s ease",
            }}>
              <span style={{ color: T.faint, width: 75 }}>{t.time}</span>
              <span style={{ fontWeight: 800, width: 42, color: t.side === "BUY" ? T.green : t.side === "EXIT" ? T.orange : T.red }}>{t.side}</span>
              <span style={{ color: T.text }}>{t.sol} SOL</span>
              <span style={{ color: T.faint, flex: 1, textAlign: "right", fontSize: 12 }}>{t.sig}...</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: "14px 20px", display: "flex", gap: 10, borderTop: "1px solid " + T.border }}>
        {status === "idle" && <Btn onClick={handleDryLaunch} small full color={T.green}><Ic.Play /> Dry Launch</Btn>}
        {(status === "buying" || status === "holding" || status === "thinking") && <Btn onClick={handleDryClose} small full color={T.orange} ghost><Ic.Stop /> Dry Close</Btn>}
        {status === "closed" && <Btn onClick={handleReset} small full color={T.dim} ghost>{"\u21BB"} Reset</Btn>}
      </div>
    </div>
  );
}

// === IMAGE UPLOAD ===
function ImageUpload({ image, onChange }) {
  const ref = useRef(null);
  const read = (f) => { const r = new FileReader(); r.onload = () => onChange(r.result); r.readAsDataURL(f); };
  return (
    <div onClick={() => ref.current?.click()}
      onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) read(e.dataTransfer.files[0]); }}
      onDragOver={e => e.preventDefault()}
      style={{
        width: "100%", aspectRatio: "1", maxWidth: 200, borderRadius: 16,
        border: "2px dashed " + (image ? T.green + "44" : T.border),
        background: image ? "url(" + image + ") center/cover" : T.bg,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 10, cursor: "pointer", transition: "all .2s", position: "relative",
      }}
    >
      {!image && <>
        <span style={{ color: T.dim }}><Ic.Upload /></span>
        <span style={{ fontSize: 14, color: T.dim, fontFamily: mono }}>drag or click</span>
        <span style={{ fontSize: 12, color: T.faint, fontFamily: mono }}>512\u00D7512</span>
      </>}
      {image && <div style={{ position: "absolute", bottom: 10, right: 10, width: 28, height: 28, borderRadius: 8, background: T.green, display: "flex", alignItems: "center", justifyContent: "center", color: T.bg }}><Ic.Check /></div>}
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { if (e.target.files?.[0]) read(e.target.files[0]); }} />
    </div>
  );
}

// === BONDING CURVE ===
function BondingCurve({ progress = 0 }) {
  const w = 340, h = 80;
  const pts = Array.from({ length: 50 }, (_, i) => { const t = i / 49; return { x: t * w, y: h - 8 - Math.pow(t, 2.5) * (h - 16) }; });
  const d = pts.map((p, i) => (i ? "L" : "M") + p.x + "," + p.y).join(" ");
  const fp = Math.min(progress, 1);
  return (
    <div>
      <svg width="100%" viewBox={"0 0 " + w + " " + h} style={{ display: "block" }}>
        <defs>
          <linearGradient id="cg" x1="0" x2="1"><stop offset="0" stopColor={T.green} stopOpacity=".15"/><stop offset={String(fp)} stopColor={T.green} stopOpacity=".35"/><stop offset={String(fp)} stopColor={T.dim} stopOpacity=".05"/></linearGradient>
          <clipPath id="cc"><path d={d + " L" + w + "," + h + " L0," + h + " Z"}/></clipPath>
        </defs>
        <rect width={w} height={h} fill="url(#cg)" clipPath="url(#cc)"/>
        <path d={d} fill="none" stroke={T.green} strokeWidth="2" opacity=".6"/>
        {fp > 0 && <circle cx={fp * w} cy={h - 8 - Math.pow(fp, 2.5) * (h - 16)} r="5" fill={T.green} style={{ filter: "drop-shadow(0 0 8px " + T.green + ")" }}/>}
        <line x1={w * 0.95} y1="0" x2={w * 0.95} y2={h} stroke={T.yellow} strokeWidth="1" strokeDasharray="4,4" opacity=".3"/>
        <text x={w * 0.95 - 5} y="12" fontSize="10" fill={T.yellow} opacity=".5" textAnchor="end">grad</text>
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.faint, fontFamily: mono, marginTop: 6 }}>
        <span>0 SOL</span>
        <span style={{ color: T.green, fontWeight: 600 }}>{(progress * 85).toFixed(1)} / 85 SOL</span>
      </div>
    </div>
  );
}

// === MAIN APP ===
export default function App() {
  const [user, setUser] = useState(null); // { pubkey, token, demo }
  const [tab, setTab] = useState("create");
  const [tokenName, setTokenName] = useState("");
  const [ticker, setTicker] = useState("");
  const [desc, setDesc] = useState("");
  const [image, setImage] = useState(null);
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [existingCA, setExistingCA] = useState("");
  const [totalSol, setTotalSol] = useState(1);
  const [rpc, setRpc] = useState("");
  const [seed, setSeed] = useState("");
  const [slippage, setSlippage] = useState(25);
  const [duration, setDuration] = useState(60);
  const [useAtlas, setUseAtlas] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [curveProgress, setCurveProgress] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);

  // WebSocket
  useEffect(() => {
    if (!user) return;
    let ws;
    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => { setWsConnected(false); setTimeout(connect, 3000); };
      ws.onerror = () => {};
    };
    connect();
    return () => { if (ws) ws.close(); };
  }, [user]);

  useEffect(() => {
    if (!launched) return;
    const iv = setInterval(() => setCurveProgress(p => Math.min(1, p + Math.random() * 0.004)), 2000);
    return () => clearInterval(iv);
  }, [launched]);

  const walletCount = totalSol < 0.5 ? 3 : totalSol < 1 ? 5 : totalSol < 5 ? 9 : totalSol < 10 ? 11 : totalSol < 25 ? 15 : 20;
  const activeRoles = useMemo(() => {
    if (walletCount <= 3) return ROLES.filter(r => ["accumulator","momentum","whale"].includes(r.id));
    if (walletCount <= 5) return ROLES.filter(r => ["sniper","accumulator","momentum","whale","liquidator"].includes(r.id));
    if (walletCount <= 9) return ROLES.filter(r => r.id !== "recycler");
    return ROLES;
  }, [walletCount]);

  const canLaunch = (existingCA || (tokenName && ticker)) && seed && rpc;

  const disconnect = async () => {
    try { await window?.solana?.disconnect(); } catch {}
    setUser(null);
  };

  if (!user) return <PhantomGate onConnect={setUser} />;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: sans }}>
      <style>{css}</style>
      <div style={{ position: "fixed", inset: 0, opacity: 0.015, pointerEvents: "none", zIndex: 0, backgroundImage: "radial-gradient(" + T.green + " 1px, transparent 1px)", backgroundSize: "30px 30px" }} />

      {/* HEADER */}
      <header style={{
        padding: "14px 28px", borderBottom: "1px solid " + T.border,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: T.surface + "ee", backdropFilter: "blur(10px)", position: "sticky", top: 0, zIndex: 40,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BondliIcon />
          <span style={{ fontFamily: mono, fontWeight: 800, fontSize: 20, letterSpacing: "-.01em" }}>
            BOND<span style={{ color: T.green }}>LI</span>
          </span>
          <span style={{ fontSize: 12, color: T.faint, fontFamily: mono }}>v3.0</span>
          {wsConnected && (
            <span style={{ fontSize: 11, fontFamily: mono, color: T.green, display: "flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.green, animation: "pulse 2s infinite" }}/>
              LIVE
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 4, background: T.bg, borderRadius: 12, padding: 4, border: "1px solid " + T.border }}>
          {[{ id:"create", l:"\u{1FA99} Create" }, { id:"wallets", l:"\u{1F916} Wallets" }, { id:"config", l:"\u2699\uFE0F Config" }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "9px 20px", borderRadius: 9, border: "none", cursor: "pointer",
              fontFamily: mono, fontSize: 14, fontWeight: 700, transition: "all .2s",
              background: tab === t.id ? T.surface2 : "transparent", color: tab === t.id ? T.green : T.dim,
            }}>{t.l}</button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {launched && (
            <span style={{
              display: "flex", alignItems: "center", gap: 8, padding: "6px 14px",
              background: T.greenGhost, border: "1px solid " + T.green + "33", borderRadius: 10,
              fontFamily: mono, fontSize: 14, fontWeight: 700, color: T.green,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.green, animation: "pulse 1.5s infinite" }} />
              LIVE
            </span>
          )}
          <div style={{
            display: "flex", alignItems: "center", gap: 10, padding: "8px 16px",
            background: T.bg, borderRadius: 12, border: "1px solid " + T.border,
          }}>
            <Ic.Phantom />
            <span style={{ fontFamily: mono, fontSize: 13, color: T.mid }}>
              {user.demo ? "demo" : user.pubkey.slice(0, 4) + ".." + user.pubkey.slice(-4)}
            </span>
            <button onClick={disconnect} style={{ background: "none", border: "none", cursor: "pointer", color: T.dim, display: "flex" }}>
              <Ic.Disconnect />
            </button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1140, margin: "0 auto", padding: "28px 24px", position: "relative", zIndex: 1 }}>

        {/* CREATE TAB */}
        {tab === "create" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 28 }}>
            <div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 18, padding: 32, animation: "fadeUp .4s ease" }}>
              <h2 style={{ fontFamily: sans, fontWeight: 900, fontSize: 26, marginBottom: 6, color: T.text }}>
                launch a coin on <span style={{ color: T.green }}>pump.fun</span>
              </h2>
              <p style={{ fontSize: 16, color: T.dim, marginBottom: 32, lineHeight: 1.5 }}>
                create a new token or paste a CA to run the engine
              </p>

              <div style={{ display: "flex", gap: 28, marginBottom: 28 }}>
                <ImageUpload image={image} onChange={setImage} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 18 }}>
                  <div><Label>name</Label><Input value={tokenName} onChange={setTokenName} placeholder="e.g. PepeCoin" big /></div>
                  <div><Label>ticker</Label><Input value={ticker} onChange={v => setTicker(v.toUpperCase())} placeholder="e.g. $PEPE" maxLength={10} big /></div>
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <Label>description</Label>
                <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="describe your token..."
                  style={{ width: "100%", padding: "14px 16px", background: T.bg, border: "2px solid " + T.border, borderRadius: 12, color: T.text, fontFamily: sans, fontSize: 15, outline: "none", resize: "vertical", lineHeight: 1.6 }} />
              </div>

              <div style={{ marginBottom: 28 }}>
                <Label>links <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></Label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <Input value={twitter} onChange={setTwitter} placeholder="twitter" />
                  <Input value={telegram} onChange={setTelegram} placeholder="telegram" />
                  <Input value={website} onChange={setWebsite} placeholder="website" />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, fontSize: 13, color: T.faint, fontFamily: mono, textTransform: "uppercase", letterSpacing: ".1em" }}>
                <span style={{ flex: 1, height: 1, background: T.border }} />
                or trade existing token
                <span style={{ flex: 1, height: 1, background: T.border }} />
              </div>

              <div style={{ marginBottom: 28 }}>
                <Label>contract address</Label>
                <Input value={existingCA} onChange={setExistingCA} placeholder="paste pump.fun CA..." big />
              </div>

              <div style={{ marginBottom: 28 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <Label>total SOL budget</Label>
                  <span style={{ fontFamily: mono, fontSize: 18, fontWeight: 800, color: T.green }}>{totalSol} SOL</span>
                </div>
                <input type="range" min={0.1} max={50} step={0.1} value={totalSol}
                  onChange={e => setTotalSol(Number(e.target.value))}
                  style={{ width: "100%", height: 8, appearance: "none", background: T.bg, borderRadius: 4, accentColor: T.green }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.faint, fontFamily: mono, marginTop: 6 }}>
                  <span>0.1</span><span>50 SOL</span>
                </div>
              </div>

              <Btn onClick={() => { setLaunched(true); setCurveProgress(0.03); setTab("wallets"); }} full disabled={!canLaunch || launched}
                style={{ padding: "16px 24px", fontSize: 18, borderRadius: 14, animation: canLaunch && !launched ? "glow 3s infinite" : "none" }}>
                <Ic.Zap /> {launched ? "Engine Running..." : "Dry Launch Token"}
              </Btn>

              {!canLaunch && (
                <p style={{ fontSize: 14, color: T.orange, fontFamily: mono, textAlign: "center", marginTop: 14 }}>
                  need: {!seed ? "master wallet \u00B7 " : ""}{!rpc ? "RPC URL \u00B7 " : ""}{!existingCA && !tokenName ? "token name \u00B7 " : ""}{!existingCA && !ticker ? "ticker" : ""}
                </p>
              )}
            </div>

            {/* Right sidebar */}
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 18, overflow: "hidden", animation: "fadeUp .5s ease" }}>
                <div style={{ height: 180, background: image ? "url(" + image + ") center/cover" : "linear-gradient(135deg, " + T.surface2 + ", " + T.bg + ")", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                  {!image && <span style={{ fontSize: 56, opacity: 0.3 }}>{"\u{1FA99}"}</span>}
                  {(tokenName || ticker) && (
                    <div style={{ position: "absolute", bottom: 14, left: 14, right: 14, background: "rgba(0,0,0,.75)", backdropFilter: "blur(8px)", borderRadius: 12, padding: "12px 16px" }}>
                      <div style={{ fontFamily: sans, fontWeight: 900, fontSize: 20, color: T.text }}>{tokenName || "Token Name"}</div>
                      <div style={{ fontFamily: mono, fontSize: 15, color: T.green, fontWeight: 700 }}>${ticker || "TICK"}</div>
                    </div>
                  )}
                </div>
                {desc && <div style={{ padding: "14px 18px", fontSize: 14, color: T.mid, lineHeight: 1.5, borderTop: "1px solid " + T.border }}>{desc.slice(0, 120)}{desc.length > 120 ? "..." : ""}</div>}
              </div>

              <div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 18, padding: 22 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700 }}>Fleet Strategy</span>
                  <span style={{ fontFamily: mono, fontSize: 14, color: T.green, fontWeight: 700, padding: "4px 12px", background: T.greenGhost, borderRadius: 8 }}>{walletCount} wallets</span>
                </div>
                {activeRoles.map(r => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid " + T.border + "22" }}>
                    <span style={{ fontSize: 20 }}>{r.emoji}</span>
                    <span style={{ flex: 1, fontSize: 14, fontFamily: mono, color: T.mid }}>{r.name}</span>
                    <span style={{ fontSize: 14, fontFamily: mono, color: r.color, fontWeight: 700 }}>{(totalSol * r.weight / 100).toFixed(3)}</span>
                  </div>
                ))}
              </div>

              <div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 18, padding: 22 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700 }}>Bonding Curve</span>
                  <span style={{ fontFamily: mono, fontSize: 15, color: T.green, fontWeight: 800 }}>{(curveProgress * 100).toFixed(1)}%</span>
                </div>
                <BondingCurve progress={curveProgress} />
              </div>

              <div style={{ background: T.surface, border: "1px solid " + T.border, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ color: T.dim }}><Ic.Wallet /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: T.faint, fontFamily: mono }}>PLATFORM FEE</div>
                  <div style={{ fontSize: 15, color: T.green, fontFamily: mono, fontWeight: 600 }}>{PLATFORM_WALLET}</div>
                </div>
                <span style={{ fontSize: 13, fontFamily: mono, fontWeight: 700, color: T.green, padding: "4px 10px", background: T.greenGhost, borderRadius: 8 }}>{ACCESS_FEE_SOL} SOL</span>
              </div>
            </div>
          </div>
        )}

        {/* WALLETS TAB */}
        {tab === "wallets" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <div>
                <h2 style={{ fontFamily: sans, fontWeight: 900, fontSize: 24, color: T.text }}>
                  Wallet Fleet <span style={{ color: T.green }}>({activeRoles.length})</span>
                </h2>
                <p style={{ fontSize: 15, color: T.dim, marginTop: 6, lineHeight: 1.5 }}>
                  Each wallet thinks independently. Dry launch and dry close each one.
                </p>
              </div>
            </div>
            {!canLaunch ? (
              <div style={{ padding: 70, textAlign: "center", background: T.surface, borderRadius: 18, border: "2px dashed " + T.border }}>
                <span style={{ fontSize: 56, display: "block", marginBottom: 20 }}>{"\u{1F916}"}</span>
                <p style={{ fontFamily: mono, fontSize: 16, color: T.dim }}>Configure token + wallet in Create & Config tabs first</p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: activeRoles.length <= 5 ? "1fr 1fr" : "1fr 1fr 1fr", gap: 18 }}>
                {activeRoles.map(role => (
                  <WalletCard key={role.id} role={role} solBudget={+(totalSol * role.weight / 100).toFixed(4)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* CONFIG TAB */}
        {tab === "config" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, animation: "fadeUp .4s ease" }}>
            <div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 18, padding: 28 }}>
              <h3 style={{ fontFamily: mono, fontSize: 17, fontWeight: 700, marginBottom: 24, display: "flex", alignItems: "center", gap: 10 }}>
                <Ic.Wallet /> Network & Wallet
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div><Label>RPC URL</Label><Input value={rpc} onChange={setRpc} placeholder="https://mainnet.helius-rpc.com/?api-key=..." icon={<Ic.Zap />} big /></div>
                <div><Label>Master Wallet (Private Key)</Label><Input value={seed} onChange={setSeed} placeholder="bs58 encoded private key" type="password" icon={<Ic.Lock />} big /></div>
                <div style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "14px 16px",
                  background: T.bg, borderRadius: 12, border: "2px solid " + T.border, cursor: "pointer",
                }} onClick={() => setUseAtlas(!useAtlas)}>
                  <div style={{ width: 46, height: 26, borderRadius: 13, padding: 3, background: useAtlas ? T.green : T.border, transition: "all .2s" }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", transform: useAtlas ? "translateX(20px)" : "translateX(0)", transition: "transform .2s", boxShadow: "0 2px 4px rgba(0,0,0,.2)" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontFamily: mono, fontWeight: 700 }}>Helius Atlas</div>
                    <div style={{ fontSize: 13, color: T.dim }}>Ultra low-latency staked connections</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 18, padding: 28 }}>
              <h3 style={{ fontFamily: mono, fontSize: 17, fontWeight: 700, marginBottom: 24, display: "flex", alignItems: "center", gap: 10 }}>
                <Ic.Zap /> Trading Parameters
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {[
                  { label: "Slippage", val: slippage, set: setSlippage, min: 1, max: 50, step: 1, suf: "%" },
                  { label: "Duration", val: duration, set: setDuration, min: 5, max: 240, step: 5, suf: " min" },
                  { label: "SOL Budget", val: totalSol, set: setTotalSol, min: 0.1, max: 50, step: 0.1, suf: " SOL" },
                ].map(s => (
                  <div key={s.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                      <span style={{ fontSize: 13, fontFamily: mono, fontWeight: 700, color: T.dim, textTransform: "uppercase", letterSpacing: ".1em" }}>{s.label}</span>
                      <span style={{ fontSize: 18, fontFamily: mono, fontWeight: 800, color: T.green }}>{s.val}{s.suf}</span>
                    </div>
                    <input type="range" min={s.min} max={s.max} step={s.step} value={s.val}
                      onChange={e => s.set(Number(e.target.value))}
                      style={{ width: "100%", height: 8, appearance: "none", background: T.bg, borderRadius: 4, accentColor: T.green }} />
                  </div>
                ))}
                <div style={{ padding: 20, background: T.bg, borderRadius: 12, border: "1px solid " + T.border }}>
                  <Label>computed strategy</Label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginTop: 14 }}>
                    {[
                      { k: "Wallets", v: walletCount },
                      { k: "Reserve", v: (totalSol * 0.12).toFixed(3) },
                      { k: "Per Wallet", v: "~" + (totalSol * 0.88 / walletCount).toFixed(3) },
                    ].map(s => (
                      <div key={s.k} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 24, fontFamily: mono, fontWeight: 800, color: T.green }}>{s.v}</div>
                        <div style={{ fontSize: 12, color: T.faint, fontFamily: mono }}>{s.k}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div style={{
              gridColumn: "1 / -1", background: T.surface, border: "2px solid " + T.border,
              borderRadius: 18, padding: 28, display: "flex", alignItems: "center", gap: 24,
            }}>
              <div style={{ width: 60, height: 60, borderRadius: 16, background: T.greenGhost, border: "2px solid " + T.green + "33", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>{"\u{1F48E}"}</div>
              <div style={{ flex: 1 }}>
                <h4 style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Platform Access</h4>
                <p style={{ fontSize: 15, color: T.dim }}>
                  One-time <span style={{ color: T.green, fontWeight: 700 }}>{ACCESS_FEE_SOL} SOL</span> to{" "}
                  <span style={{ color: T.green, fontFamily: mono }}>{PLATFORM_WALLET}</span>
                </p>
              </div>
              <span style={{ padding: "8px 16px", borderRadius: 10, fontFamily: mono, fontSize: 14, fontWeight: 700, background: T.greenGhost, color: T.green, border: "1px solid " + T.green + "33" }}>{"\u2713"} Unlocked</span>
            </div>
          </div>
        )}
      </div>

      <footer style={{
        padding: "16px 28px", borderTop: "1px solid " + T.border, marginTop: 40,
        display: "flex", justifyContent: "space-between", fontSize: 13, color: T.faint, fontFamily: mono,
      }}>
        <span>BONDLI v3.0 \u00B7 {PLATFORM_WALLET}</span>
        <span>{launched ? <span style={{ color: T.green }}>{"\u25CF"} ACTIVE</span> : "\u25CF IDLE"}</span>
      </footer>
    </div>
  );
}
