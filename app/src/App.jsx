import { useState, useEffect, useRef, useMemo, createContext, useContext } from "react";

const API = "https://bondli-production.up.railway.app";
const WS_URL = "wss://bondli-production.up.railway.app/ws";
const PLATFORM_WALLET = "anal.sol";
const PRO_FEE_SOL = 10;
const FREE_PROFIT_CUT = 25; // percent

// === THEMES ===
const dark = {
  bg: "#0e0e10", bg2: "#151519", surface: "#1a1a21", surface2: "#222230",
  card: "#1c1c26", border: "#2a2a3a", borderLit: "#3d3d55",
  green: "#00e676", greenDim: "#00c853", greenGhost: "rgba(0,230,118,0.07)",
  red: "#ff1744", redGhost: "rgba(255,23,68,0.08)",
  yellow: "#ffd600", orange: "#ff9100", blue: "#448aff", purple: "#b388ff",
  pink: "#ff80ab", cyan: "#18ffff",
  text: "#eaeaf2", dim: "#8585a8", mid: "#aaaac4", faint: "#55556e",
  dotGrid: "radial-gradient(#00e676 1px, transparent 1px)",
  gridLines: "linear-gradient(#00e676 1px, transparent 1px), linear-gradient(90deg, #00e676 1px, transparent 1px)",
  mode: "dark",
};
const light = {
  bg: "#f4f4f7", bg2: "#eaeaef", surface: "#ffffff", surface2: "#f0f0f5",
  card: "#ffffff", border: "#d8d8e4", borderLit: "#c0c0d0",
  green: "#00b862", greenDim: "#009e54", greenGhost: "rgba(0,184,98,0.08)",
  red: "#e01040", redGhost: "rgba(224,16,64,0.06)",
  yellow: "#c8a600", orange: "#d07800", blue: "#2266dd", purple: "#7744cc",
  pink: "#cc5588", cyan: "#00aacc",
  text: "#1a1a2e", dim: "#6e6e8a", mid: "#5a5a74", faint: "#9898b0",
  dotGrid: "radial-gradient(#00b862 1px, transparent 1px)",
  gridLines: "linear-gradient(#00b862 1px, transparent 1px), linear-gradient(90deg, #00b862 1px, transparent 1px)",
  mode: "light",
};
const ThemeCtx = createContext(dark);
const useTheme = () => useContext(ThemeCtx);
const mono = "'IBM Plex Mono','JetBrains Mono','Fira Code',monospace";
const sans = "'Nunito','DM Sans','Segoe UI',system-ui,sans-serif";

const ROLES = [
  { id:"sniper", name:"Sniper", emoji:"\u{1F3AF}", weight:8, thinkStyle:"aggressive" },
  { id:"accumulator", name:"Accumulator", emoji:"\u{1F41C}", weight:12, thinkStyle:"patient" },
  { id:"momentum", name:"Momentum", emoji:"\u{1F3CE}\uFE0F", weight:22, thinkStyle:"reactive" },
  { id:"swing", name:"Swing", emoji:"\u{1F3A2}", weight:18, thinkStyle:"analytical" },
  { id:"whale", name:"Whale", emoji:"\u{1F40B}", weight:28, thinkStyle:"strategic" },
  { id:"liquidator", name:"Liquidator", emoji:"\u{1F4B0}", weight:8, thinkStyle:"cautious" },
  { id:"recycler", name:"Recycler", emoji:"\u267B\uFE0F", weight:4, thinkStyle:"mechanical" },
];
const ROLE_COLORS = (T) => ({ sniper: T.red, accumulator: T.blue, momentum: T.green, swing: T.purple, whale: T.yellow, liquidator: T.orange, recycler: T.dim });

const THOUGHTS = {
  aggressive: ["scanning mempool for entry window...","detected low liquidity \u2014 preparing front-run","optimal entry: next 2 blocks, slippage ok","entry locked. watching curve velocity"],
  patient: ["accumulating slowly... 3 micro-buys queued","price dipped 2.1% \u2014 increasing buy freq","building floor support at current level","steady state. drip buying continues"],
  reactive: ["2 consecutive buys \u2014 joining momentum","FOMO trigger: 4 buys in 30s, burst deploy","volume spike! increasing size 40%","painting green candle \u2014 3 rapid buys"],
  analytical: ["price at local resistance \u2014 sell ladder","support held at 0.0000043 \u2014 placing buy","breakout potential \u2014 switch to momentum","dip buyer activated. absorbing sells"],
  strategic: ["holding dry powder for key level","deploying 40% allocation \u2014 high conviction","large buy at curve inflection: max impact","position established. managing exit ladder"],
  cautious: ["profit target 1 \u2014 trimming 15%","sell ladder: 20/30/50 split","distribution phase. accelerating exits","locking gains before curve flattens"],
  mechanical: ["scanning wallets for stranded tokens...","recycling 42k tokens \u2192 ~0.012 SOL","SOL recovered. redistributing to fleet","sweep complete. reserve replenished"],
};

function useIsMobile() {
  const [m, setM] = useState(window.innerWidth < 768);
  useEffect(() => { const h = () => setM(window.innerWidth < 768); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  return m;
}

const makeCss = (T) => `
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;color-scheme:${T.mode}}
body{overscroll-behavior:none;background:${T.bg};transition:background .3s}
::-webkit-scrollbar{width:6px}
::-webkit-scrollbar-track{background:${T.bg}}
::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes glow{0%,100%{box-shadow:0 0 15px ${T.green}26}50%{box-shadow:0 0 40px ${T.green}4d}}
@keyframes think{0%{opacity:.3}50%{opacity:1}100%{opacity:.3}}
@keyframes slideIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
@keyframes pillFloat{0%,100%{transform:translateY(0) rotate(-15deg)}50%{transform:translateY(-6px) rotate(-15deg)}}
input[type=range]{cursor:pointer;-webkit-appearance:none;width:100%;height:8px;background:${T.bg};border-radius:4px}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;border-radius:50%;background:${T.green};border:2px solid ${T.bg};cursor:pointer}
input,textarea,button{font-size:16px}
@media(max-width:767px){input[type=range]::-webkit-slider-thumb{width:28px;height:28px}}
`;

// === RED PILL ===
const RedPill = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" style={{ filter: "drop-shadow(0 2px 6px rgba(200,0,0,.4))" }}>
    <defs>
      <linearGradient id="pillBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff1a1a"/><stop offset="45%" stopColor="#cc0000"/><stop offset="100%" stopColor="#880000"/></linearGradient>
      <linearGradient id="pillShine" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="white" stopOpacity="0.5"/><stop offset="100%" stopColor="white" stopOpacity="0"/></linearGradient>
      <linearGradient id="pillHalf" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff6666"/><stop offset="100%" stopColor="#cc3333"/></linearGradient>
    </defs>
    <g transform="rotate(-15 20 20)">
      <rect x="10" y="8" width="20" height="24" rx="10" fill="url(#pillBody)"/>
      <rect x="10" y="8" width="20" height="12" rx="10" fill="url(#pillHalf)"/>
      <rect x="10" y="14" width="20" height="6" fill="url(#pillHalf)"/>
      <line x1="10" y1="20" x2="30" y2="20" stroke="#660000" strokeWidth="0.8" opacity="0.6"/>
      <ellipse cx="17" cy="14" rx="4" ry="6" fill="url(#pillShine)" opacity="0.6"/>
    </g>
  </svg>
);

// === ICONS ===
const Ic = {
  Lock: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  Play: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>,
  Stop: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>,
  Check: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>,
  Brain: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96.44A2.5 2.5 0 015.5 18a2.5 2.5 0 01-1-4.74A2.5 2.5 0 014 11a2.5 2.5 0 013.02-2.45A2.5 2.5 0 019.5 2z"/><path d="M14.5 2A2.5 2.5 0 0012 4.5v15a2.5 2.5 0 004.96.44A2.5 2.5 0 0018.5 18a2.5 2.5 0 001-4.74A2.5 2.5 0 0020 11a2.5 2.5 0 00-3.02-2.45A2.5 2.5 0 0014.5 2z"/></svg>,
  Wallet: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12V7H5a2 2 0 010-4h14v4"/><path d="M3 5v14a2 2 0 002 2h16v-5"/><path d="M18 12a2 2 0 000 4h4v-4h-4z"/></svg>,
  Upload: () => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  Zap: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  Phantom: () => <svg width="20" height="20" viewBox="0 0 128 128" fill="none"><rect width="128" height="128" rx="26" fill="url(#pg)"/><defs><linearGradient id="pg" x1="0" y1="0" x2="128" y2="128"><stop stopColor="#534bb1"/><stop offset="1" stopColor="#551bf9"/></linearGradient></defs><path d="M110.6 64.1c-2.4-11.5-13.4-19.6-24.2-22.6-14.6-4-30.2-1.5-43.2 5.8-8.1 4.5-15.1 11.1-18.5 19.8-4.5 11.5-1.7 25.4 8 33.5 4.5 3.8 10.3 6.2 16.2 6.2 3.6 0 7.1-.7 10.4-2.2 2.4-1.1 4.5-2.7 6.9-3.8 4-1.8 8.5-1.8 12.8-1 4.2.7 8.1 2.6 12.1 4 4.2 1.5 9 2.3 13.2.5 5.6-2.3 9-7.9 8.6-13.8-.2-3.5-.7-6.9-1.3-10.3-.5-2.8-.7-5.6-.7-8.5 0-2.5.2-5.1-.3-7.6z" fill="#fff"/><circle cx="44" cy="68" r="6" fill="#534bb1"/><circle cx="72" cy="68" r="6" fill="#534bb1"/></svg>,
  Disconnect: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  Sun: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  Moon: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
  Shield: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Cpu: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>,
  Eye: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  Users: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
  TrendUp: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  Crown: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2 20h20v2H2v-2zm1-7l4.5 3L12 4l4.5 12L21 13l-2 7H5l-2-7z"/></svg>,
};

// === BASE COMPONENTS ===
function Btn({ children, onClick, color, ghost = false, disabled = false, small = false, full = false, style: sx = {} }) {
  const T = useTheme(); const c = color || T.green; const [hov, setHov] = useState(false);
  return (<button onClick={disabled ? undefined : onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: small ? "10px 16px" : "14px 24px", borderRadius: 12, fontFamily: mono, fontSize: small ? 14 : 16, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.35 : 1, width: full ? "100%" : undefined, WebkitTapHighlightColor: "transparent", border: ghost ? "2px solid " + c + "44" : "none", background: ghost ? (hov ? c + "15" : "transparent") : (hov ? c + "dd" : c), color: ghost ? c : (T.mode === "light" ? "#fff" : T.bg), transform: hov && !disabled ? "translateY(-1px)" : "none", transition: "all .15s", letterSpacing: ".02em", ...sx }}>{children}</button>);
}
function Input({ value, onChange, placeholder, type = "text", icon, big = false, ...props }) {
  const T = useTheme(); const [focus, setFocus] = useState(false);
  return (<div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 14px", background: T.bg, border: "2px solid " + (focus ? T.green + "55" : T.border), borderRadius: 12, transition: "border-color .2s" }}>{icon && <span style={{ color: T.dim, display: "flex", flexShrink: 0 }}>{icon}</span>}<input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} style={{ flex: 1, padding: big ? "14px 0" : "12px 0", background: "none", border: "none", outline: "none", color: T.text, fontFamily: mono, fontSize: 16, minWidth: 0 }} {...props} /></div>);
}
function Label({ children }) { const T = useTheme(); return <div style={{ fontSize: 13, fontWeight: 700, color: T.dim, fontFamily: mono, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 8 }}>{children}</div>; }
function ThemeToggle({ isDark, toggle, mobile }) { const T = useTheme(); return <button onClick={toggle} style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 10, padding: mobile ? "6px 8px" : "7px 10px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: T.dim, transition: "all .2s", WebkitTapHighlightColor: "transparent" }}>{isDark ? <Ic.Sun /> : <Ic.Moon />}</button>; }

// ══════════════════════════════════════════
// LANDING PAGE
// ══════════════════════════════════════════
function LandingPage({ onConnect, isDark, toggleTheme }) {
  const T = useTheme(); const mobile = useIsMobile();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const getProvider = () => { if (window?.phantom?.solana?.isPhantom) return window.phantom.solana; if (window?.solana?.isPhantom) return window.solana; return null; };

  const connectPhantom = async () => {
    setConnecting(true); setError("");
    try {
      const provider = getProvider();
      if (!provider) { if (/iPhone|iPad|Android/i.test(navigator.userAgent)) { window.location.href = "https://phantom.app/ul/browse/" + encodeURIComponent(window.location.href); return; } setError("Phantom not found. Install at phantom.app"); setConnecting(false); return; }
      const resp = await provider.connect(); const pubkey = resp.publicKey.toString();
      let whitelisted = false, paid = false, tier = "none";
      try { const res = await fetch(API + "/api/access/check?wallet=" + pubkey); const data = await res.json(); whitelisted = !!data.whitelisted; paid = !!data.paid; tier = data.tier || "none"; } catch {}
      onConnect({ pubkey, whitelisted, paid, tier, demo: false });
    } catch (e) { setError(e.code === 4001 ? "Connection rejected" : "Failed to connect"); }
    setConnecting(false);
  };

  const features = [
    { icon: <Ic.Users />, title: "Wallet Fleet AI", desc: "7 wallet roles with independent brains \u2014 sniper, whale, momentum, swing, accumulator, liquidator, recycler." },
    { icon: <Ic.Brain />, title: "Bayesian Game Theory", desc: "Real-time opponent modeling. Detects bundlers, snipers, and whales. Adapts strategy mid-trade." },
    { icon: <Ic.Eye />, title: "Anti-Detection", desc: "Gaussian timing, randomized sizes, human-like behavior. Your fleet looks like 7 different retail traders." },
    { icon: <Ic.Shield />, title: "Rug Scanner", desc: "Pre-trade safety checks on every token. Mint authority, freeze, LP locks, holder distribution." },
    { icon: <Ic.TrendUp />, title: "Smart Exit Engine", desc: "Automated profit-taking with configurable ladders. Sweeps remaining SOL on close." },
    { icon: <Ic.Cpu />, title: "Helius Integration", desc: "Optional Atlas staked connections for ultra low-latency. Priority fees and Jito tips built in." },
  ];

  return (
    <div style={{ minHeight: "100dvh", background: T.bg, color: T.text, fontFamily: sans, transition: "all .3s" }}>
      <div style={{ position: "fixed", inset: 0, opacity: T.mode === "dark" ? 0.03 : 0.04, backgroundImage: T.gridLines, backgroundSize: "60px 60px", pointerEvents: "none" }} />

      {/* Top bar */}
      <header style={{ padding: mobile ? "12px 16px" : "14px 40px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 40, background: T.surface + (T.mode === "dark" ? "ee" : "e8"), backdropFilter: "blur(12px)", borderBottom: "1px solid " + T.border }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><RedPill size={mobile ? 24 : 30} /><span style={{ fontFamily: mono, fontWeight: 800, fontSize: mobile ? 16 : 20 }}>BOND<span style={{ color: T.red }}>LI</span></span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ThemeToggle isDark={isDark} toggle={toggleTheme} mobile={mobile} />
          <Btn onClick={connectPhantom} small disabled={connecting} style={{ background: "linear-gradient(135deg, #534bb1, #551bf9)", borderRadius: 10 }}><Ic.Phantom /> {mobile ? "Connect" : "Connect Phantom"}</Btn>
        </div>
      </header>

      {/* HERO */}
      <section style={{ maxWidth: 900, margin: "0 auto", padding: mobile ? "48px 20px 40px" : "80px 40px 60px", textAlign: "center", position: "relative", zIndex: 1 }}>
        <div style={{ animation: "pillFloat 3s ease infinite", marginBottom: 28 }}><RedPill size={mobile ? 56 : 72} /></div>
        <h1 style={{ fontFamily: sans, fontWeight: 900, fontSize: mobile ? 32 : 56, lineHeight: 1.1, letterSpacing: "-.03em", marginBottom: 20 }}>
          Take the <span style={{ color: T.red }}>red pill</span>.<br /><span style={{ color: T.green }}>Trade pump.fun</span> with game theory.
        </h1>
        <p style={{ fontSize: mobile ? 16 : 20, color: T.dim, maxWidth: 600, margin: "0 auto 36px", lineHeight: 1.6 }}>
          Deploy a fleet of AI wallets that think independently, avoid detection, and trade bonding curves with Bayesian opponent modeling.
        </p>
        {error && <p style={{ fontSize: 14, color: T.red, marginBottom: 14, fontFamily: mono }}>{error}</p>}
        <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <Btn onClick={connectPhantom} disabled={connecting} style={{ padding: "16px 32px", fontSize: 18, borderRadius: 14, background: "linear-gradient(135deg, #534bb1, #551bf9)", animation: "glow 3s infinite" }}><Ic.Phantom /> {connecting ? "Connecting..." : "Connect Phantom"}</Btn>
          <Btn onClick={() => onConnect({ pubkey: "demo", whitelisted: false, paid: false, tier: "demo", demo: true })} ghost color={T.dim} style={{ padding: "16px 28px", fontSize: 16, borderRadius: 14 }}>Demo Mode</Btn>
        </div>
      </section>

      {/* PRICING */}
      <section style={{ maxWidth: 800, margin: "0 auto", padding: mobile ? "20px 16px 40px" : "20px 40px 60px", position: "relative", zIndex: 1 }}>
        <h2 style={{ textAlign: "center", fontFamily: sans, fontWeight: 900, fontSize: mobile ? 22 : 30, marginBottom: 8, color: T.text }}>Simple pricing</h2>
        <p style={{ textAlign: "center", fontSize: 16, color: T.dim, marginBottom: mobile ? 24 : 36 }}>Start free or go pro. No subscriptions.</p>
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: mobile ? 14 : 20 }}>
          {/* FREE */}
          <div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 20, padding: mobile ? 24 : 32, transition: "all .3s" }}>
            <div style={{ fontSize: 13, fontFamily: mono, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 12 }}>Free Tier</div>
            <div style={{ fontFamily: mono, fontSize: mobile ? 36 : 44, fontWeight: 900, color: T.text, marginBottom: 4 }}>0 <span style={{ fontSize: 20, color: T.dim }}>SOL</span></div>
            <p style={{ fontSize: 15, color: T.dim, marginBottom: 24 }}>{FREE_PROFIT_CUT}% of profits go to Bondli on every close</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {["All 7 wallet roles", "Game theory engine", "Anti-detection", "Rug scanner", FREE_PROFIT_CUT + "% profit share on close"].map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: T.mid }}>
                  <span style={{ color: T.green, flexShrink: 0 }}><Ic.Check /></span>{f}
                </div>
              ))}
            </div>
            <Btn onClick={connectPhantom} full disabled={connecting} style={{ marginTop: 24, borderRadius: 12 }} ghost color={T.green}>
              <Ic.Phantom /> Start Free
            </Btn>
          </div>
          {/* PRO */}
          <div style={{ background: T.surface, border: "2px solid " + T.green + "44", borderRadius: 20, padding: mobile ? 24 : 32, position: "relative", overflow: "hidden", transition: "all .3s" }}>
            <div style={{ position: "absolute", top: 16, right: 16, padding: "4px 12px", borderRadius: 8, background: T.green, color: T.bg, fontFamily: mono, fontSize: 11, fontWeight: 800 }}>BEST VALUE</div>
            <div style={{ fontSize: 13, fontFamily: mono, fontWeight: 700, color: T.yellow, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 12 }}><Ic.Crown /> Pro</div>
            <div style={{ fontFamily: mono, fontSize: mobile ? 36 : 44, fontWeight: 900, color: T.text, marginBottom: 4 }}>{PRO_FEE_SOL} <span style={{ fontSize: 20, color: T.dim }}>SOL</span></div>
            <p style={{ fontSize: 15, color: T.dim, marginBottom: 24 }}>One-time. Keep 100% of profits forever.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {["All 7 wallet roles", "Game theory engine", "Anti-detection", "Rug scanner", "0% profit share \u2014 keep everything", "Priority support"].map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: T.mid }}>
                  <span style={{ color: T.green, flexShrink: 0 }}><Ic.Check /></span>{f}
                </div>
              ))}
            </div>
            <Btn onClick={connectPhantom} full disabled={connecting} style={{ marginTop: 24, borderRadius: 12, background: "linear-gradient(135deg, #534bb1, #551bf9)" }}>
              <Ic.Phantom /> Go Pro
            </Btn>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: mobile ? "20px 16px 40px" : "20px 40px 60px", position: "relative", zIndex: 1 }}>
        <h2 style={{ textAlign: "center", fontFamily: sans, fontWeight: 900, fontSize: mobile ? 22 : 30, marginBottom: mobile ? 20 : 32, color: T.text }}>Built for degens, by degens</h2>
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr 1fr", gap: mobile ? 14 : 20 }}>
          {features.map((f, i) => (
            <div key={i} style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 18, padding: mobile ? 22 : 28, animation: "fadeUp .5s ease " + (i * 0.08) + "s both", transition: "all .3s" }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, marginBottom: 18, background: T.green + "12", border: "1px solid " + T.green + "22", display: "flex", alignItems: "center", justifyContent: "center", color: T.green }}>{f.icon}</div>
              <h3 style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, marginBottom: 10, color: T.text }}>{f.title}</h3>
              <p style={{ fontSize: 14, color: T.dim, lineHeight: 1.6 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* BOTTOM CTA */}
      <section style={{ maxWidth: 800, margin: "0 auto", padding: mobile ? "20px 20px 80px" : "20px 40px 80px", textAlign: "center", position: "relative", zIndex: 1 }}>
        <div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 24, padding: mobile ? 28 : 44, boxShadow: T.mode === "dark" ? "0 20px 60px rgba(0,0,0,.4)" : "0 10px 40px rgba(0,0,0,.08)", transition: "all .3s" }}>
          <RedPill size={40} />
          <h2 style={{ fontFamily: sans, fontWeight: 900, fontSize: mobile ? 22 : 30, marginTop: 16, marginBottom: 12, color: T.text }}>Ready to trade smarter?</h2>
          <p style={{ fontSize: mobile ? 15 : 17, color: T.dim, marginBottom: 28, lineHeight: 1.6 }}>Start free with {FREE_PROFIT_CUT}% profit share, or pay <span style={{ color: T.green, fontWeight: 800 }}>{PRO_FEE_SOL} SOL</span> once to keep everything.</p>
          <Btn onClick={connectPhantom} disabled={connecting} style={{ padding: "16px 36px", fontSize: 18, borderRadius: 14, background: "linear-gradient(135deg, #534bb1, #551bf9)" }}><Ic.Phantom /> {connecting ? "Connecting..." : "Get Started"}</Btn>
        </div>
      </section>

      <footer style={{ padding: "16px 28px", borderTop: "1px solid " + T.border, display: "flex", justifyContent: "space-between", fontSize: 13, color: T.faint, fontFamily: mono }}><span>BONDLI v3.1</span><span>{PLATFORM_WALLET}</span></footer>
    </div>
  );
}

// ══════════════════════════════════════════
// TIER SELECTION — after connect, before app
// ══════════════════════════════════════════
function TierGate({ user, onSelect, onDisconnect }) {
  const T = useTheme(); const mobile = useIsMobile();
  const [txSig, setTxSig] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState(null); // null = choosing, "free" = activating, "pro" = paying

  const activateFree = async () => {
    setVerifying(true); setError("");
    try {
      const res = await fetch(API + "/api/access/activate-free", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: user?.pubkey }),
      });
      const data = await res.json();
      if (data.ok) onSelect("free");
      else setError(data.error || "Activation failed");
    } catch { setError("Network error. Try again."); }
    setVerifying(false);
  };

  const verifyPro = async () => {
    if (!txSig || txSig.length < 20) { setError("Paste a valid transaction signature"); return; }
    setVerifying(true); setError("");
    try {
      const res = await fetch(API + "/api/access/activate-pro", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: user?.pubkey, txSig }),
      });
      const data = await res.json();
      if (data.ok) onSelect("pro");
      else setError(data.error || "Payment not verified. Send " + PRO_FEE_SOL + " SOL to " + PLATFORM_WALLET);
    } catch { setError("Verification failed."); }
    setVerifying(false);
  };

  return (
    <div style={{ minHeight: "100dvh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: mobile ? 16 : 0, position: "relative" }}>
      <div style={{ position: "absolute", inset: 0, opacity: T.mode === "dark" ? 0.03 : 0.04, backgroundImage: T.gridLines, backgroundSize: "60px 60px" }} />
      <div style={{ width: "100%", maxWidth: mode ? 480 : 700, padding: mobile ? 24 : 40, background: T.surface, border: "2px solid " + T.border, borderRadius: 24, position: "relative", animation: "fadeUp .5s ease", boxShadow: T.mode === "dark" ? "0 40px 80px rgba(0,0,0,.5)" : "0 20px 60px rgba(0,0,0,.1)", transition: "all .3s" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <RedPill size={40} />
          <h2 style={{ fontFamily: sans, fontWeight: 900, fontSize: mobile ? 22 : 28, marginTop: 12, color: T.text }}>Choose your path</h2>
          <p style={{ fontSize: 14, color: T.dim, marginTop: 6 }}>Connected as <span style={{ fontFamily: mono, color: T.green }}>{(user?.pubkey || "").slice(0, 6)}...{(user?.pubkey || "").slice(-4)}</span></p>
        </div>

        {error && <p style={{ fontSize: 14, color: T.red, marginBottom: 14, fontFamily: mono, textAlign: "center" }}>{error}</p>}

        {/* CHOOSING */}
        {!mode && (
          <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: 16 }}>
            <div style={{ background: T.bg, border: "2px solid " + T.border, borderRadius: 16, padding: 24, textAlign: "center", transition: "all .3s" }}>
              <div style={{ fontFamily: mono, fontSize: 32, fontWeight: 900, color: T.text, marginBottom: 4 }}>Free</div>
              <div style={{ fontFamily: mono, fontSize: 14, color: T.dim, marginBottom: 16 }}>{FREE_PROFIT_CUT}% of profits on close</div>
              <div style={{ fontSize: 13, color: T.faint, marginBottom: 20, lineHeight: 1.6 }}>All features included. Bondli takes {FREE_PROFIT_CUT}% of your net profit when you close positions.</div>
              <Btn onClick={() => setMode("free")} full ghost color={T.green} style={{ borderRadius: 12 }}>Start Free</Btn>
            </div>
            <div style={{ background: T.bg, border: "2px solid " + T.green + "44", borderRadius: 16, padding: 24, textAlign: "center", transition: "all .3s" }}>
              <div style={{ fontFamily: mono, fontSize: 32, fontWeight: 900, color: T.text, marginBottom: 4 }}>{PRO_FEE_SOL} SOL</div>
              <div style={{ fontFamily: mono, fontSize: 14, color: T.yellow, marginBottom: 16 }}>Keep 100% forever</div>
              <div style={{ fontSize: 13, color: T.faint, marginBottom: 20, lineHeight: 1.6 }}>One-time payment. Zero profit share. Every lamport stays in your wallet.</div>
              <Btn onClick={() => setMode("pro")} full style={{ borderRadius: 12, background: "linear-gradient(135deg, #534bb1, #551bf9)" }}><Ic.Crown /> Go Pro</Btn>
            </div>
          </div>
        )}

        {/* FREE ACTIVATION */}
        {mode === "free" && (
          <div>
            <div style={{ padding: 20, background: T.bg, borderRadius: 14, border: "1px solid " + T.border, marginBottom: 20, textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 8 }}>Free Tier Activation</div>
              <p style={{ fontSize: 14, color: T.dim, lineHeight: 1.6 }}>
                No upfront cost. Bondli will automatically take <span style={{ color: T.green, fontWeight: 700 }}>{FREE_PROFIT_CUT}%</span> of your net profit when you close positions. If you lose money on a trade, you pay nothing.
              </p>
            </div>
            <Btn onClick={activateFree} full disabled={verifying} style={{ marginBottom: 12 }}><Ic.Check /> {verifying ? "Activating..." : "Activate Free Tier"}</Btn>
            <button onClick={() => { setMode(null); setError(""); }} style={{ display: "block", margin: "0 auto", background: "none", border: "none", color: T.faint, cursor: "pointer", fontFamily: mono, fontSize: 14, textDecoration: "underline", textUnderlineOffset: 4 }}>{"\u2190"} Back</button>
          </div>
        )}

        {/* PRO PAYMENT */}
        {mode === "pro" && (
          <div>
            <div style={{ padding: 20, background: T.bg, borderRadius: 14, border: "1px solid " + T.border, marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ fontSize: 14, color: T.dim, fontFamily: mono, fontWeight: 600 }}>LIFETIME ACCESS</span>
                <span style={{ fontSize: 24, fontFamily: mono, fontWeight: 800, color: T.green }}>{PRO_FEE_SOL} SOL</span>
              </div>
              <div style={{ padding: "12px 14px", background: T.surface, borderRadius: 10, border: "1px dashed " + T.border, fontFamily: mono, fontSize: mobile ? 14 : 16, color: T.green, wordBreak: "break-all", textAlign: "center", fontWeight: 600 }}>{PLATFORM_WALLET}</div>
              <p style={{ fontSize: 13, color: T.faint, textAlign: "center", marginTop: 10 }}>Send {PRO_FEE_SOL} SOL, paste tx signature below</p>
            </div>
            <div style={{ marginBottom: 16 }}><Label>Transaction Signature</Label><Input value={txSig} onChange={setTxSig} placeholder="Paste tx signature..." big /></div>
            <Btn onClick={verifyPro} full disabled={!txSig || verifying} style={{ marginBottom: 12 }}><Ic.Check /> {verifying ? "Verifying..." : "Verify & Unlock Pro"}</Btn>
            <button onClick={() => { setMode(null); setError(""); setTxSig(""); }} style={{ display: "block", margin: "0 auto", background: "none", border: "none", color: T.faint, cursor: "pointer", fontFamily: mono, fontSize: 14, textDecoration: "underline", textUnderlineOffset: 4 }}>{"\u2190"} Back</button>
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 16, paddingTop: 14, borderTop: "1px solid " + T.border }}>
          <button onClick={onDisconnect} style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontFamily: mono, fontSize: 13, textDecoration: "underline", textUnderlineOffset: 4 }}>Disconnect wallet</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// LAUNCH FLOW — generate dev wallet, fund, launch
// ══════════════════════════════════════════
function calcDevBuyPreview(totalSol) {
  let pct, min, max;
  if (totalSol < 1) { pct = 0.50; min = 0.1; max = 0.5; }
  else if (totalSol < 5) { pct = 0.40; min = 0.3; max = 2.0; }
  else if (totalSol < 15) { pct = 0.25; min = 1.0; max = 4.0; }
  else { pct = 0.15; min = 2.0; max = 8.0; }
  const devBuy = Math.min(max, Math.max(min, totalSol * pct));
  const creationFee = 0.02;
  const fleet = Math.max(0, totalSol - devBuy - creationFee);
  return { devBuy: +devBuy.toFixed(4), creationFee, fleet: +fleet.toFixed(4), pct: +((devBuy / totalSol) * 100).toFixed(1) };
}

function LaunchFlow({ user, mobile, totalSol, tokenConfig, canLaunch, launched, onLaunched, masterSeed, fleetConfig }) {
  const T = useTheme();
  const [step, setStep] = useState("idle");
  const [session, setSession] = useState(null);
  const [devSecret, setDevSecret] = useState("");
  const [tokenCA, setTokenCA] = useState("");
  const [launchStatus, setLaunchStatus] = useState("");
  const [txSig, setTxSig] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const preview = calcDevBuyPreview(totalSol);
  const pollRef = useRef(null);

  const copyText = (text) => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── STEP 1: Generate dev wallet ──
  const startLaunch = async () => {
    setError(""); setStep("generating");
    try {
      const res = await fetch(API + "/api/session/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Wallet": user?.pubkey },
        body: JSON.stringify({ totalSol, tokenConfig, wallet: user?.pubkey, fleetConfig: fleetConfig || {}, masterSeed: masterSeed || "" }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); setStep("idle"); return; }
      setSession(data);
      if (data.devSecret) setDevSecret(data.devSecret);
      // If master wallet used, skip deposit — go straight to launch
      if (data.useMaster && data.funded) { setStep("launching"); executeLaunch(data); return; }
      setStep("awaiting");
    } catch (e) { setError("Failed: " + (e.message || "")); setStep("idle"); }
  };

  // ── STEP 2: Send SOL → auto-poll → auto-launch ──
  const openPhantomSend = () => {
    const addr = session?.devWallet;
    if (!addr) return;
    if (/iPhone|iPad|Android/i.test(navigator.userAgent)) {
      window.location.href = "https://phantom.app/ul/transfer?recipient=" + addr + "&amount=" + totalSol;
    } else {
      copyText(addr);
    }
    startPolling();
  };

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const sid = session?.sessionId;
        if (!sid) return;
        const res = await fetch(API + "/api/session/balance?sessionId=" + sid + "&wallet=" + (user?.pubkey || ""));
        const data = await res.json();
        if (data.funded) {
          clearInterval(pollRef.current);
          executeLaunch();
        }
      } catch {}
    }, 4000);
  };

  const manualVerify = async () => {
    if (!txSig) return;
    setError("");
    try {
      const res = await fetch(API + "/api/session/fund", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Wallet": user?.pubkey },
        body: JSON.stringify({ sessionId: session?.sessionId, txSig, wallet: user?.pubkey }),
      });
      const data = await res.json();
      if (!data.ok) {
        if (data.error?.includes("not found") || data.error?.includes("Wait")) { setTimeout(manualVerify, 5000); return; }
        setError(data.error || "Verification failed"); return;
      }
      if (pollRef.current) clearInterval(pollRef.current);
      executeLaunch();
    } catch { setError("Verification failed"); }
  };

  // ── STEP 3: Auto-launch after deposit ──
  const executeLaunch = async (overrideSession) => {
    setError(""); setStep("launching");
    setLaunchStatus("Uploading metadata to IPFS...");
    try {
      const res = await fetch(API + "/api/session/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Wallet": user?.pubkey },
        body: JSON.stringify({ sessionId: (overrideSession || session)?.sessionId, wallet: user?.pubkey }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); setStep("awaiting"); return; }

      const ca = data.tokenCA || "";
      setTokenCA(ca);
      setSession(prev => ({ ...prev, tokenCA: ca, pumpUrl: data.pumpUrl }));
      setStep("live");
      if (ca) onLaunched({ ...data, tokenCA: ca });
    } catch (e) { setError("Launch failed: " + (e.message || "")); setStep("awaiting"); }
  };

  const KeyBox = () => devSecret ? (
    <div style={{ padding: "12px 14px", background: T.yellow + "08", borderRadius: 10, border: "1px solid " + T.yellow + "28", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 14 }}>{"\u{1F511}"}</span>
        <span style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, color: T.yellow, textTransform: "uppercase" }}>Creator Private Key</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, fontFamily: mono, fontSize: 10, color: T.mid, wordBreak: "break-all", lineHeight: 1.4, background: T.bg, padding: "6px 8px", borderRadius: 6, border: "1px solid " + T.border, maxHeight: 44, overflow: "auto" }}>{devSecret}</div>
        <button onClick={() => copyText(devSecret)} style={{ background: T.yellow, border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontFamily: mono, fontSize: 11, fontWeight: 700, color: T.bg, flexShrink: 0 }}>{copied ? "\u2713" : "Copy"}</button>
      </div>
      <p style={{ fontSize: 10, color: T.yellow, fontFamily: "system-ui,sans-serif", marginTop: 4, opacity: 0.8 }}>Import into Phantom for creator fees (0.5%)</p>
    </div>
  ) : null;

  const dw = session?.devWallet || "";

  // ═══════════════ LIVE — show CA + chart ═══════════════
  if (step === "live" || (launched && tokenCA)) {
    const ca = tokenCA || "";
    return (
      <div>
        {ca ? (
          <div style={{ padding: mobile ? 14 : 18, background: T.surface, borderRadius: 14, border: "2px solid " + T.green + "44", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ color: T.green }}>{"\u2705"}</span>
              <span style={{ fontFamily: mono, fontWeight: 700, color: T.green, fontSize: 14 }}>Token Live on pump.fun</span>
            </div>
            <div style={{ fontFamily: mono, fontSize: 11, color: T.text, wordBreak: "break-all", background: T.bg, padding: "8px 10px", borderRadius: 8, border: "1px solid " + T.border, marginBottom: 8, cursor: "pointer" }} onClick={() => copyText(ca)}>{ca} <span style={{ color: T.faint, fontSize: 10 }}>{copied ? "\u2713 copied" : "click to copy"}</span></div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                { label: "pump.fun", url: "https://pump.fun/coin/" + ca, c: T.green },
                { label: "Solscan", url: "https://solscan.io/token/" + ca },
                { label: "DexScreener", url: "https://dexscreener.com/solana/" + ca },
                { label: "Photon", url: "https://photon-sol.tinyastro.io/en/lp/" + ca },
              ].map(l => (
                <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 65, textAlign: "center", padding: "7px 4px", background: (l.c || T.mid) + "12", borderRadius: 6, border: "1px solid " + (l.c || T.mid) + "22", color: l.c || T.mid, fontFamily: mono, fontSize: 10, fontWeight: 700, textDecoration: "none" }}>
                  {l.label}
                </a>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ padding: "14px 18px", background: T.greenGhost, borderRadius: 12, border: "1px solid " + T.green + "33", marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: T.green, animation: "pulse 2s infinite", fontSize: 14 }}>{"\u25CF"}</span>
            <span style={{ fontFamily: mono, fontWeight: 700, color: T.green, fontSize: 13 }}>Engine Running</span>
          </div>
        )}

        {ca && (
          <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid " + T.border, marginBottom: 12, background: "#0d0d0d" }}>
            <iframe src={"https://www.gmgn.cc/kline/sol/" + ca} style={{ width: "100%", height: mobile ? 260 : 380, border: "none", display: "block" }} title="Chart" />
          </div>
        )}

        <KeyBox />
      </div>
    );
  }

  // ═══════════════ LAUNCHING — progress ═══════════════
  if (step === "launching") {
    return (
      <div style={{ background: T.surface, border: "2px solid " + T.green + "44", borderRadius: 16, padding: mobile ? 20 : 28, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 14, animation: "pulse 1s infinite" }}>{"\u{1F680}"}</div>
        <div style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: T.green, marginBottom: 8 }}>Creating token on pump.fun</div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.dim, marginBottom: 16 }}>{launchStatus}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 260, margin: "0 auto", textAlign: "left" }}>
          {["Upload metadata", "Generate mint", "Build transaction", "Sign & send", "Confirm on-chain"].map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: mono, fontSize: 11 }}>
              <span style={{ color: T.faint, animation: "pulse 1.5s infinite" }}>{"\u25CB"}</span>
              <span style={{ color: T.dim }}>{s}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: T.faint, fontFamily: mono, marginTop: 14 }}>15-45 seconds...</div>
      </div>
    );
  }

  // ═══════════════ IDLE + AWAITING ═══════════════
  return (
    <div style={{ marginTop: 8 }}>
      {error && (
        <div style={{ fontSize: 12, color: T.red, fontFamily: mono, marginBottom: 12, padding: "10px 14px", background: T.redGhost, borderRadius: 10, border: "1px solid " + T.red + "22", display: "flex", alignItems: "flex-start", gap: 8, maxHeight: 200, overflow: "auto" }}>
          <span style={{ flex: 1, wordBreak: "break-all", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{error}</span>
          <button onClick={() => setError("")} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 14, padding: 0, flexShrink: 0 }}>{"\u2715"}</button>
        </div>
      )}

      {/* BUDGET */}
      <div style={{ padding: "8px 0", marginBottom: 12, display: "flex", justifyContent: "center", gap: mobile ? 12 : 20, fontFamily: mono, fontSize: 12, color: T.dim }}>
        <span><span style={{ color: T.yellow, fontWeight: 700 }}>{preview.devBuy}</span> dev buy</span>
        <span style={{ color: T.border }}>{"\u00B7"}</span>
        <span><span style={{ color: T.dim, fontWeight: 700 }}>{preview.creationFee}</span> fee</span>
        <span style={{ color: T.border }}>{"\u00B7"}</span>
        <span><span style={{ color: T.green, fontWeight: 700 }}>{preview.fleet}</span> fleet</span>
      </div>

      {step === "idle" && (
        <Btn onClick={startLaunch} full disabled={!canLaunch}
          style={{ padding: "16px 24px", fontSize: mobile ? 16 : 18, borderRadius: 14, animation: canLaunch ? "glow 3s infinite" : "none" }}>
          <Ic.Zap /> Launch on pump.fun
        </Btn>
      )}

      {step === "generating" && <div style={{ textAlign: "center", padding: 16 }}><div style={{ fontFamily: mono, color: T.dim, animation: "pulse 1.5s infinite" }}>Generating dev wallet...</div></div>}

      {step === "awaiting" && session && (
        <div style={{ background: T.surface, border: "2px solid " + T.green + "33", borderRadius: 14, padding: mobile ? 14 : 20 }}>
          <KeyBox />

          <div style={{ padding: "10px 12px", background: T.bg, borderRadius: 8, border: "1px dashed " + T.border, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: T.faint, fontFamily: mono, marginBottom: 3, textTransform: "uppercase" }}>Send {totalSol} SOL to</div>
            <div style={{ fontFamily: mono, fontSize: mobile ? 11 : 13, color: T.green, fontWeight: 600, wordBreak: "break-all", cursor: "pointer" }} onClick={() => copyText(dw)}>{dw} <span style={{ color: T.faint, fontSize: 10 }}>{copied ? "\u2713" : "copy"}</span></div>
          </div>

          <Btn onClick={openPhantomSend} full style={{ borderRadius: 10, background: "linear-gradient(135deg, #534bb1, #551bf9)", marginBottom: 8 }}>
            {/iPhone|iPad|Android/i.test(navigator.userAgent) ? "Open Phantom" : "Copy & Send " + totalSol + " SOL"}
          </Btn>

          <p style={{ textAlign: "center", fontFamily: mono, fontSize: 11, color: T.dim, marginBottom: 8 }}>{"\u23F3"} Auto-detect + auto-launch after deposit</p>

          <div style={{ display: "flex", gap: 6, paddingTop: 8, borderTop: "1px solid " + T.border }}>
            <div style={{ flex: 1 }}><Input value={txSig} onChange={setTxSig} placeholder="or paste tx sig..." /></div>
            <Btn onClick={manualVerify} small disabled={!txSig} ghost color={T.green}>Go</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function WalletCard({ role, solBudget, mobile }) {
  const T = useTheme(); const rc = ROLE_COLORS(T)[role.id] || T.dim;
  const [status, setStatus] = useState("idle"); const [thought, setThought] = useState(""); const [trades, setTrades] = useState([]); const [solSpent, setSolSpent] = useState(0); const [solRecovered, setSolRecovered] = useState(0); const [tokenBal, setTokenBal] = useState(0); const [expanded, setExpanded] = useState(false); const exitRef = useRef(null);
  const addr = useMemo(() => { const c = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; return Array.from({ length: 44 }, () => c[Math.floor(Math.random() * c.length)]).join(""); }, []);
  useEffect(() => { if (status !== "thinking" && status !== "buying" && status !== "holding") return; const pool = THOUGHTS[role.thinkStyle] || THOUGHTS.patient; const iv = setInterval(() => setThought(pool[Math.floor(Math.random() * pool.length)]), 2000 + Math.random() * 3000); return () => clearInterval(iv); }, [status, role.thinkStyle]);
  useEffect(() => { if (status !== "buying" && status !== "holding") return; const iv = setInterval(() => { const isBuy = status === "buying" ? Math.random() > 0.2 : Math.random() > 0.6; const amt = +(Math.random() * solBudget * 0.15 + 0.001).toFixed(4); const tokens = Math.floor(amt * (80000 + Math.random() * 200000)); const sig = Array.from({ length: 10 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""); setSolSpent(p => { if (isBuy && p < solBudget * 0.85) { setTokenBal(pp => pp + tokens); setTrades(pp => [{ id: Date.now(), side: "BUY", sol: amt, tokens, sig, time: new Date().toLocaleTimeString() }, ...pp].slice(0, 20)); return +(p + amt).toFixed(4); } return p; }); setTokenBal(p => { if (!isBuy && p > 0) { const sell = Math.floor(p * (0.1 + Math.random() * 0.3)); const solBack = +(sell / (80000 + Math.random() * 200000)).toFixed(4); setSolRecovered(pp => +(pp + solBack).toFixed(4)); setTrades(pp => [{ id: Date.now(), side: "SELL", sol: solBack, tokens: sell, sig, time: new Date().toLocaleTimeString() }, ...pp].slice(0, 20)); return Math.max(0, p - sell); } return p; }); }, 3000 + Math.random() * 5000); return () => clearInterval(iv); }, [status, solBudget]);
  const handleDryLaunch = () => { setStatus("thinking"); setTimeout(() => setStatus("buying"), 1500 + Math.random() * 2000); };
  const handleDryClose = () => { setStatus("closing"); setThought("closing all positions..."); exitRef.current = setInterval(() => { setTokenBal(p => { if (p <= 0) { clearInterval(exitRef.current); setStatus("closed"); return 0; } const chunk = Math.floor(p * 0.4); const solBack = +(chunk / 100000).toFixed(4); setSolRecovered(pp => +(pp + solBack).toFixed(4)); setTrades(pp => [{ id: Date.now(), side: "EXIT", sol: solBack, tokens: chunk, sig: "exit_" + Date.now().toString(36), time: new Date().toLocaleTimeString() }, ...pp].slice(0, 20)); return Math.max(0, p - chunk); }); }, 800); };
  const handleReset = () => { if (exitRef.current) clearInterval(exitRef.current); setStatus("idle"); setTrades([]); setSolSpent(0); setSolRecovered(0); setTokenBal(0); setThought(""); };
  const net = +(solRecovered - solSpent).toFixed(4);
  const sc = { idle: { color: T.faint, label: "IDLE" }, thinking: { color: T.yellow, label: "THINKING..." }, buying: { color: T.green, label: "BUYING" }, holding: { color: T.blue, label: "HOLDING" }, closing: { color: T.orange, label: "CLOSING..." }, closed: { color: T.dim, label: "CLOSED" } }[status];
  return (
    <div style={{ background: T.card, border: "2px solid " + (status === "buying" ? T.green + "44" : status === "closing" ? T.orange + "44" : T.border), borderRadius: 16, overflow: "hidden", transition: "all .3s", animation: "fadeUp .4s ease", boxShadow: status === "buying" ? "0 0 30px " + T.green + "10" : "none" }}>
      <div style={{ padding: mobile ? "14px 16px" : "16px 20px", display: "flex", alignItems: "center", gap: mobile ? 10 : 14, borderBottom: "1px solid " + T.border, cursor: "pointer", WebkitTapHighlightColor: "transparent" }} onClick={() => setExpanded(!expanded)}>
        <span style={{ fontSize: mobile ? 24 : 30 }}>{role.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><span style={{ fontFamily: mono, fontSize: mobile ? 14 : 16, fontWeight: 700, color: T.text }}>{role.name}</span><span style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: sc.color + "18", color: sc.color, border: "1px solid " + sc.color + "33", animation: (status === "thinking" || status === "closing") ? "pulse 1.5s infinite" : "none" }}>{sc.label}</span></div><div style={{ fontSize: 12, color: T.faint, fontFamily: mono, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{addr.slice(0, 6)}...{addr.slice(-4)}</div></div>
        <div style={{ textAlign: "right", flexShrink: 0 }}><div style={{ fontSize: mobile ? 15 : 17, fontFamily: mono, fontWeight: 700, color: rc }}>{solBudget.toFixed(4)}</div><div style={{ fontSize: 12, color: T.dim }}>SOL</div></div>
      </div>
      {status !== "idle" && status !== "closed" && (<div style={{ padding: "10px 16px", background: T.bg, borderBottom: "1px solid " + T.border + "22", display: "flex", alignItems: "center", gap: 10, overflow: "hidden" }}><span style={{ color: T.yellow, display: "flex", flexShrink: 0, animation: "think 2s infinite" }}><Ic.Brain /></span><span style={{ fontSize: 13, color: T.mid, fontFamily: mono, fontStyle: "italic", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", animation: "slideIn .3s ease" }} key={thought}>{thought || "initializing..."}</span></div>)}
      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 1, background: T.border + "44" }}>
        {[{ label: "Spent", val: solSpent.toFixed(4), c: T.red }, { label: "Recovered", val: solRecovered.toFixed(4), c: T.green }, { label: "Net", val: (net >= 0 ? "+" : "") + net.toFixed(4), c: net >= 0 ? T.green : T.red }, { label: "Tokens", val: tokenBal.toLocaleString(), c: T.yellow }].map(s => (<div key={s.label} style={{ padding: mobile ? "8px 12px" : "10px 14px", background: T.card }}><div style={{ fontSize: 11, color: T.faint, fontFamily: mono, marginBottom: 3 }}>{s.label}</div><div style={{ fontSize: mobile ? 13 : 15, color: s.c, fontFamily: mono, fontWeight: 600 }}>{s.val}</div></div>))}
      </div>
      {expanded && trades.length > 0 && (<div style={{ maxHeight: 200, overflow: "auto", borderTop: "1px solid " + T.border, WebkitOverflowScrolling: "touch" }}>{trades.map(t => (<div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 16px", fontSize: 13, fontFamily: mono, borderBottom: "1px solid " + T.border + "22" }}><span style={{ color: T.faint, width: mobile ? 55 : 75, fontSize: mobile ? 11 : 13, flexShrink: 0 }}>{t.time}</span><span style={{ fontWeight: 800, width: 38, color: t.side === "BUY" ? T.green : t.side === "EXIT" ? T.orange : T.red, flexShrink: 0 }}>{t.side}</span><span style={{ color: T.text }}>{t.sol}</span>{!mobile && <span style={{ color: T.faint, flex: 1, textAlign: "right", fontSize: 12 }}>{t.sig}...</span>}</div>))}</div>)}
      <div style={{ padding: "12px 16px", display: "flex", gap: 10, borderTop: "1px solid " + T.border }}>
        {status === "idle" && <Btn onClick={handleDryLaunch} small full color={T.green}><Ic.Play /> Dry Launch</Btn>}
        {(status === "buying" || status === "holding" || status === "thinking") && <Btn onClick={handleDryClose} small full color={T.orange} ghost><Ic.Stop /> Dry Close</Btn>}
        {status === "closed" && <Btn onClick={handleReset} small full color={T.dim} ghost>{"\u21BB"} Reset</Btn>}
      </div>
    </div>
  );
}
function ImageUpload({ image, onChange, mobile }) { const T = useTheme(); const ref = useRef(null); const read = (f) => { const r = new FileReader(); r.onload = () => onChange(r.result); r.readAsDataURL(f); }; return (<div onClick={() => ref.current?.click()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) read(e.dataTransfer.files[0]); }} onDragOver={e => e.preventDefault()} style={{ width: mobile ? 120 : "100%", height: mobile ? 120 : undefined, aspectRatio: mobile ? undefined : "1", maxWidth: mobile ? 120 : 200, borderRadius: 16, border: "2px dashed " + (image ? T.green + "44" : T.border), background: image ? "url(" + image + ") center/cover" : T.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", flexShrink: 0, position: "relative" }}>{!image && <><span style={{ color: T.dim }}><Ic.Upload /></span><span style={{ fontSize: 12, color: T.faint, fontFamily: mono }}>512{"\u00D7"}512</span></>}{image && <div style={{ position: "absolute", bottom: 8, right: 8, width: 24, height: 24, borderRadius: 6, background: T.green, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><Ic.Check /></div>}<input ref={ref} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { if (e.target.files?.[0]) read(e.target.files[0]); }} /></div>); }
function BondingCurve({ progress = 0 }) { const T = useTheme(); const w = 340, h = 80; const pts = Array.from({ length: 50 }, (_, i) => { const t = i / 49; return { x: t * w, y: h - 8 - Math.pow(t, 2.5) * (h - 16) }; }); const d = pts.map((p, i) => (i ? "L" : "M") + p.x + "," + p.y).join(" "); const fp = Math.min(progress, 1); return (<div><svg width="100%" viewBox={"0 0 " + w + " " + h} style={{ display: "block" }}><defs><linearGradient id="cg" x1="0" x2="1"><stop offset="0" stopColor={T.green} stopOpacity=".15"/><stop offset={String(fp)} stopColor={T.green} stopOpacity=".35"/><stop offset={String(fp)} stopColor={T.dim} stopOpacity=".05"/></linearGradient><clipPath id="cc"><path d={d + " L" + w + "," + h + " L0," + h + " Z"}/></clipPath></defs><rect width={w} height={h} fill="url(#cg)" clipPath="url(#cc)"/><path d={d} fill="none" stroke={T.green} strokeWidth="2" opacity=".6"/>{fp > 0 && <circle cx={fp * w} cy={h - 8 - Math.pow(fp, 2.5) * (h - 16)} r="5" fill={T.green} style={{ filter: "drop-shadow(0 0 8px " + T.green + ")" }}/>}<line x1={w * 0.95} y1="0" x2={w * 0.95} y2={h} stroke={T.yellow} strokeWidth="1" strokeDasharray="4,4" opacity=".3"/><text x={w * 0.95 - 5} y="12" fontSize="10" fill={T.yellow} opacity=".5" textAnchor="end">grad</text></svg><div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.faint, fontFamily: mono, marginTop: 6 }}><span>0 SOL</span><span style={{ color: T.green, fontWeight: 600 }}>{(progress * 85).toFixed(1)} / 85 SOL</span></div></div>); }
function MobileNav({ tab, setTab }) { const T = useTheme(); return (<div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50, display: "flex", background: T.surface + "f5", backdropFilter: "blur(12px)", borderTop: "1px solid " + T.border, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>{[{ id:"create", l:"\u{1FA99}", t:"Create" }, { id:"wallets", l:"\u{1F916}", t:"Wallets" }, { id:"config", l:"\u2699\uFE0F", t:"Settings" }].map(item => (<button key={item.id} onClick={() => setTab(item.id)} style={{ flex: 1, padding: "10px 0 8px", border: "none", cursor: "pointer", background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, WebkitTapHighlightColor: "transparent" }}><span style={{ fontSize: 22 }}>{item.l}</span><span style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, color: tab === item.id ? T.green : T.faint }}>{item.t}</span></button>))}</div>); }

// ══════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════
export default function App() {
  const [isDark, setIsDark] = useState(() => { try { return localStorage.getItem("bondli_theme") !== "light"; } catch { return true; } });
  const T = isDark ? dark : light;
  const toggleTheme = () => setIsDark(d => { try { localStorage.setItem("bondli_theme", d ? "light" : "dark"); } catch {} return !d; });

  // user: null | { pubkey, whitelisted, paid, tier, demo }
  // tier: "none" | "free" | "pro" | "demo"
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("create");
  const [tokenName, setTokenName] = useState(""); const [ticker, setTicker] = useState(""); const [desc, setDesc] = useState(""); const [image, setImage] = useState(null);
  const [twitter, setTwitter] = useState(""); const [telegram, setTelegram] = useState(""); const [website, setWebsite] = useState("");
  const [existingCA, setExistingCA] = useState(""); const [totalSol, setTotalSol] = useState(1);
  const [rpc, setRpc] = useState(""); const [seed, setSeed] = useState("");
  const [slippage, setSlippage] = useState(25); const [sniperCount, setSniperCount] = useState(2); const [duration, setDuration] = useState(60); const [useAtlas, setUseAtlas] = useState(false);
  const [launched, setLaunched] = useState(false); const [curveProgress, setCurveProgress] = useState(0); const [wsConnected, setWsConnected] = useState(false);
  const [launchCA, setLaunchCA] = useState(""); const [launchPumpUrl, setLaunchPumpUrl] = useState("");
  const [pastSessions, setPastSessions] = useState([]);
  useEffect(() => {
    if (!user?.pubkey || !user?.whitelisted && user?.tier !== "pro") return;
    fetch(API + "/api/sessions?wallet=" + user.pubkey).then(r => r.json()).then(d => {
      if (d.sessions) setPastSessions(d.sessions.filter(s => s.tokenCA && s.status !== "closed").slice(0, 5));
    }).catch(() => {});
  }, [user, launched]);
  const mobile = useIsMobile();

  const hasAccess = user && (user?.whitelisted || user?.tier === "free" || user?.tier === "pro" || user?.demo);
  const needsTier = user && !user?.demo && !user?.whitelisted && user?.tier === "none";
  const tierLabel = user?.whitelisted ? "VIP" : user?.tier === "pro" ? "PRO" : user?.tier === "free" ? "FREE" : user?.demo ? "DEMO" : "";
  const tierColor = user?.whitelisted ? T.yellow : user?.tier === "pro" ? T.purple : user?.tier === "free" ? T.green : T.orange;

  // Auto-reconnect
  useEffect(() => {
    const p = window?.phantom?.solana || window?.solana;
    if (p?.isPhantom && p?.isConnected && !user) {
      p.connect({ onlyIfTrusted: true }).then(async (r) => {
        const pubkey = r.publicKey.toString();
        let whitelisted = false, paid = false, tier = "none";
        try { const res = await fetch(API + "/api/access/check?wallet=" + pubkey); const data = await res.json(); whitelisted = !!data.whitelisted; paid = !!data.paid; tier = data.tier || "none"; } catch {}
        setUser({ pubkey, whitelisted, paid, tier, demo: false });
      }).catch(() => {});
    }
  }, []);

  useEffect(() => { if (!hasAccess) return; let ws, dead = false; const connect = () => { if (dead) return; try { ws = new WebSocket(WS_URL); ws.onopen = () => setWsConnected(true); ws.onclose = () => { setWsConnected(false); if (!dead) setTimeout(connect, 3000); }; ws.onerror = () => {}; } catch {} }; connect(); return () => { dead = true; if (ws) ws.close(); }; }, [hasAccess]);
  // After launch, poll server for fleet trading status
  const [fleetStatus, setFleetStatus] = useState(null);
  useEffect(() => {
    if (!launched || !launchCA) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(API + "/api/status", { headers: { "X-Wallet": user?.pubkey } });
        if (res.ok) {
          const data = await res.json();
          setFleetStatus(data);
          if (data.curveProgress) setCurveProgress(data.curveProgress);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(iv);
  }, [launched, launchCA]);

  useEffect(() => { if (!launched) return; const iv = setInterval(() => setCurveProgress(p => Math.min(1, p + Math.random() * 0.004)), 2000); return () => clearInterval(iv); }, [launched]);

  const walletCount = totalSol < 0.5 ? 3 : totalSol < 1 ? 5 : totalSol < 5 ? 9 : totalSol < 10 ? 11 : totalSol < 25 ? 15 : 20;
  const activeRoles = useMemo(() => { if (walletCount <= 3) return ROLES.filter(r => ["accumulator","momentum","whale"].includes(r.id)); if (walletCount <= 5) return ROLES.filter(r => ["sniper","accumulator","momentum","whale","liquidator"].includes(r.id)); if (walletCount <= 9) return ROLES.filter(r => r.id !== "recycler"); return ROLES; }, [walletCount]);
  const canLaunch = (existingCA || (tokenName && ticker));

  const disconnect = async () => { try { const p = window?.phantom?.solana || window?.solana; await p?.disconnect(); } catch {} setUser(null); };

  const handleTierSelect = (tier) => setUser({ ...user, tier, paid: tier === "pro" });

  return (
    <ThemeCtx.Provider value={T}>
      <style>{makeCss(T)}</style>

      {/* 1. No user → Landing */}
      {!user && <LandingPage onConnect={setUser} isDark={isDark} toggleTheme={toggleTheme} />}

      {/* 2. Connected but no tier → Tier selection */}
      {needsTier && <TierGate user={user} onSelect={handleTierSelect} onDisconnect={disconnect} />}

      {/* 3. Has access → Full app */}
      {user && hasAccess && (
        <div style={{ minHeight: "100dvh", background: T.bg, color: T.text, fontFamily: sans, paddingBottom: mobile ? 70 : 0, transition: "background .3s, color .3s" }}>
          <div style={{ position: "fixed", inset: 0, opacity: T.mode === "dark" ? 0.015 : 0.025, pointerEvents: "none", zIndex: 0, backgroundImage: T.dotGrid, backgroundSize: "30px 30px" }} />

          <header style={{ padding: mobile ? "10px 16px" : "14px 28px", borderBottom: "1px solid " + T.border, display: "flex", alignItems: "center", justifyContent: "space-between", background: T.surface + (T.mode === "dark" ? "ee" : "e8"), backdropFilter: "blur(10px)", position: "sticky", top: 0, zIndex: 40 }}>
            <div style={{ display: "flex", alignItems: "center", gap: mobile ? 8 : 12 }}>
              <RedPill size={mobile ? 26 : 32} />
              <span style={{ fontFamily: mono, fontWeight: 800, fontSize: mobile ? 16 : 20, color: T.text }}>BOND<span style={{ color: T.red }}>LI</span></span>
              {!mobile && <span style={{ fontSize: 12, color: T.faint, fontFamily: mono }}>v3.0</span>}
              {wsConnected && <span style={{ fontSize: 11, fontFamily: mono, color: T.green, display: "flex", alignItems: "center", gap: 4, marginLeft: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: T.green, animation: "pulse 2s infinite" }}/>{!mobile && "LIVE"}</span>}
            </div>
            {!mobile && <div style={{ display: "flex", gap: 4, background: T.bg, borderRadius: 12, padding: 4, border: "1px solid " + T.border }}>{[{ id:"create", l:"\u{1FA99} Create" }, { id:"wallets", l:"\u{1F916} Wallets" }, { id:"config", l:"\u2699\uFE0F Settings" }].map(t => (<button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "9px 20px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: mono, fontSize: 14, fontWeight: 700, transition: "all .2s", background: tab === t.id ? T.surface2 : "transparent", color: tab === t.id ? T.green : T.dim }}>{t.l}</button>))}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: mobile ? 6 : 10 }}>
              <ThemeToggle isDark={isDark} toggle={toggleTheme} mobile={mobile} />
              {tierLabel && <span style={{ padding: "4px 10px", borderRadius: 8, fontFamily: mono, fontSize: 11, fontWeight: 700, background: tierColor + "18", color: tierColor, border: "1px solid " + tierColor + "33" }}>{tierLabel === "FREE" ? "\u{1F30D}" : tierLabel === "VIP" ? "\u2B50" : tierLabel === "PRO" ? "\u{1F451}" : ""} {tierLabel}</span>}
              <div style={{ display: "flex", alignItems: "center", gap: mobile ? 6 : 10, padding: mobile ? "6px 10px" : "8px 16px", background: T.bg, borderRadius: 12, border: "1px solid " + T.border }}>
                {!mobile && <Ic.Phantom />}
                <span style={{ fontFamily: mono, fontSize: mobile ? 12 : 13, color: T.mid }}>{user?.demo ? "demo" : (user?.pubkey || "").slice(0, 4) + ".." + (user?.pubkey || "").slice(-4)}</span>
                <button onClick={disconnect} style={{ background: "none", border: "none", cursor: "pointer", color: T.dim, display: "flex", padding: 0 }}><Ic.Disconnect /></button>
              </div>
            </div>
          </header>

          {/* Free tier banner */}
          {user?.tier === "free" && !user?.whitelisted && (
            <div style={{ background: T.green + "10", borderBottom: "1px solid " + T.green + "22", padding: "8px 28px", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontFamily: mono, color: T.green }}>Free tier: {FREE_PROFIT_CUT}% of profits go to Bondli on close</span>
              <button onClick={() => { setUser({ ...user, tier: "none" }); }} style={{ background: T.green, color: T.bg, border: "none", borderRadius: 8, padding: "4px 12px", fontFamily: mono, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Upgrade to Pro</button>
            </div>
          )}

            {tab === "create" && (
              <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 340px", gap: mobile ? 16 : 28 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: mobile ? 16 : 20 }}>
                  {/* STEP 1: TOKEN INFO */}
                  <div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 18, padding: mobile ? 20 : 28 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: mobile ? 16 : 24 }}>
                      <span style={{ width: 28, height: 28, borderRadius: "50%", background: T.green, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 14, fontWeight: 800, color: T.bg }}>1</span>
                      <span style={{ fontFamily: sans, fontWeight: 800, fontSize: mobile ? 18 : 22, color: T.text }}>Create Token</span>
                      <span style={{ fontSize: 12, color: T.faint, fontFamily: mono, marginLeft: "auto" }}>or paste CA below</span>
                    </div>
                    <div style={{ display: "flex", gap: mobile ? 16 : 24, marginBottom: mobile ? 16 : 20 }}>
                      <ImageUpload image={image} onChange={setImage} mobile={mobile} />
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: mobile ? 10 : 14 }}>
                        <div><Label>name</Label><Input value={tokenName} onChange={setTokenName} placeholder="e.g. PepeCoin" big /></div>
                        <div><Label>ticker</Label><Input value={ticker} onChange={v => setTicker(v.toUpperCase())} placeholder="e.g. $PEPE" maxLength={10} big /></div>
                      </div>
                    </div>
                    <div style={{ marginBottom: mobile ? 12 : 16 }}><Label>description</Label><textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="describe your token..." style={{ width: "100%", padding: "12px 14px", background: T.bg, border: "2px solid " + T.border, borderRadius: 12, color: T.text, fontFamily: sans, fontSize: 15, outline: "none", resize: "vertical", lineHeight: 1.5 }} /></div>
                    <div style={{ marginBottom: mobile ? 12 : 16 }}><Label>links <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></Label><div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr 1fr", gap: 10 }}><Input value={twitter} onChange={setTwitter} placeholder="twitter" /><Input value={telegram} onChange={setTelegram} placeholder="telegram" /><Input value={website} onChange={setWebsite} placeholder="website" /></div></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: T.faint, fontFamily: mono, textTransform: "uppercase", letterSpacing: ".1em" }}><span style={{ flex: 1, height: 1, background: T.border }} />or trade existing<span style={{ flex: 1, height: 1, background: T.border }} /></div>
                    <div style={{ marginTop: mobile ? 12 : 16 }}><Label>contract address</Label><Input value={existingCA} onChange={setExistingCA} placeholder="paste pump.fun CA..." big /></div>
                  </div>

                  {/* STEP 2: BUDGET + FLEET */}
                  <div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 18, padding: mobile ? 20 : 28 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: mobile ? 16 : 24 }}>
                      <span style={{ width: 28, height: 28, borderRadius: "50%", background: T.green, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 14, fontWeight: 800, color: T.bg }}>2</span>
                      <span style={{ fontFamily: sans, fontWeight: 800, fontSize: mobile ? 18 : 22, color: T.text }}>Configure Fleet</span>
                    </div>
                    <div style={{ marginBottom: 20 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><Label>total SOL budget</Label><span style={{ fontFamily: mono, fontSize: 22, fontWeight: 800, color: T.green }}>{totalSol} SOL</span></div><input type="range" min={0.5} max={50} step={0.1} value={totalSol} onChange={e => setTotalSol(Number(e.target.value))} style={{ width: "100%", accentColor: T.green }} /></div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
                      <div style={{ background: T.bg, borderRadius: 12, padding: "12px 14px", border: "1px solid " + T.border }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, color: T.dim, textTransform: "uppercase" }}>Snipers</span><span style={{ fontSize: 16, fontFamily: mono, fontWeight: 800, color: T.green }}>{sniperCount}</span></div>
                        <input type="range" min={1} max={5} step={1} value={sniperCount} onChange={e => setSniperCount(Number(e.target.value))} style={{ width: "100%", accentColor: T.green }} />
                        <div style={{ fontSize: 10, color: T.faint, fontFamily: mono, marginTop: 4 }}>buy fast, sell into liquidity</div>
                      </div>
                      <div style={{ background: T.bg, borderRadius: 12, padding: "12px 14px", border: "1px solid " + T.border }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, color: T.dim, textTransform: "uppercase" }}>Slippage</span><span style={{ fontSize: 16, fontFamily: mono, fontWeight: 800, color: T.green }}>{slippage}%</span></div>
                        <input type="range" min={1} max={50} step={1} value={slippage} onChange={e => setSlippage(Number(e.target.value))} style={{ width: "100%", accentColor: T.green }} />
                      </div>
                      <div style={{ background: T.bg, borderRadius: 12, padding: "12px 14px", border: "1px solid " + T.border }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, color: T.dim, textTransform: "uppercase" }}>Duration</span><span style={{ fontSize: 16, fontFamily: mono, fontWeight: 800, color: T.green }}>{duration}m</span></div>
                        <input type="range" min={5} max={240} step={5} value={duration} onChange={e => setDuration(Number(e.target.value))} style={{ width: "100%", accentColor: T.green }} />
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2, background: T.border + "44", borderRadius: 12, overflow: "hidden" }}>
                      <div style={{ background: T.bg, padding: "12px 8px", textAlign: "center" }}><div style={{ fontSize: 20, fontFamily: mono, fontWeight: 800, color: T.green }}>{calcDevBuyPreview(totalSol).devBuy.toFixed(2)}</div><div style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>dev buy</div></div>
                      <div style={{ background: T.bg, padding: "12px 8px", textAlign: "center" }}><div style={{ fontSize: 20, fontFamily: mono, fontWeight: 800, color: T.green }}>{calcDevBuyPreview(totalSol).fleet.toFixed(2)}</div><div style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>fleet budget</div></div>
                      <div style={{ background: T.bg, padding: "12px 8px", textAlign: "center" }}><div style={{ fontSize: 20, fontFamily: mono, fontWeight: 800, color: T.green }}>{walletCount + sniperCount - 1}</div><div style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>total wallets</div></div>
                    </div>
                  </div>

                  {/* STEP 3: LAUNCH */}
                  <div style={{ background: T.surface, border: "2px solid " + (canLaunch ? T.green + "44" : T.border), borderRadius: 18, padding: mobile ? 20 : 28 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: mobile ? 16 : 20 }}>
                      <span style={{ width: 28, height: 28, borderRadius: "50%", background: canLaunch ? T.green : T.border, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 14, fontWeight: 800, color: T.bg }}>3</span>
                      <span style={{ fontFamily: sans, fontWeight: 800, fontSize: mobile ? 18 : 22, color: T.text }}>Launch</span>
                      {seed && (<span style={{ fontFamily: mono, fontSize: 11, color: T.green, padding: "3px 10px", background: T.greenGhost, borderRadius: 6, marginLeft: "auto" }}>{"\u{1F511}"} master wallet</span>)}
                    </div>
                    <LaunchFlow
                      user={user} mobile={mobile}
                      totalSol={totalSol}
                      tokenConfig={{ name: tokenName, ticker, description: desc, image, twitter, telegram, website, existingCA }}
                      canLaunch={existingCA || (tokenName && ticker)}
                      launched={launched}
                      masterSeed={seed}
                      fleetConfig={{ sniperCount, slippage, duration }}
                      onLaunched={(data) => { setLaunched(true); setCurveProgress(0.03); setTab("wallets"); if (data.tokenCA) setLaunchCA(data.tokenCA); if (data.pumpUrl) setLaunchPumpUrl(data.pumpUrl); }}
                    />
                  </div>
                </div>

                {/* RIGHT SIDEBAR — live preview */}
                <div style={{ display: "flex", flexDirection: "column", gap: mobile ? 12 : 16, position: mobile ? "static" : "sticky", top: 100, alignSelf: "start" }}>
                  <div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 18, overflow: "hidden" }}>
                    <div style={{ height: mobile ? 120 : 160, background: image ? "url(" + image + ") center/cover" : "linear-gradient(135deg, " + T.surface2 + ", " + T.bg + ")", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                      {!image && <span style={{ fontSize: mobile ? 36 : 48, opacity: 0.3 }}>{"\u{1FA99}"}</span>}
                      {(tokenName || ticker) && <div style={{ position: "absolute", bottom: 12, left: 12, right: 12, background: "rgba(0,0,0,.75)", backdropFilter: "blur(8px)", borderRadius: 10, padding: "8px 12px" }}><div style={{ fontFamily: sans, fontWeight: 900, fontSize: mobile ? 15 : 18, color: "#eaeaf2" }}>{tokenName || "Token Name"}</div><div style={{ fontFamily: mono, fontSize: 13, color: "#00e676", fontWeight: 700 }}>${ticker || "TICK"}</div></div>}
                    </div>
                    {desc && <div style={{ padding: "10px 14px", fontSize: 13, color: T.mid, lineHeight: 1.5, borderTop: "1px solid " + T.border }}>{desc.slice(0, 100)}{desc.length > 100 ? "..." : ""}</div>}
                  </div>
                  <div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 18, padding: mobile ? 14 : 18 }}>
                    <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 12 }}>Fleet Roles</div>
                    {activeRoles.map(r => (<div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid " + T.border + "22" }}><span style={{ fontSize: 16 }}>{r.emoji}</span><span style={{ flex: 1, fontSize: 13, fontFamily: mono, color: T.mid }}>{r.name}{r.id === "sniper" ? " x" + sniperCount : ""}</span><span style={{ fontSize: 13, fontFamily: mono, color: ROLE_COLORS(T)[r.id], fontWeight: 700 }}>{(totalSol * r.weight / 100).toFixed(3)}</span></div>))}
                  </div>
                  <div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 18, padding: mobile ? 14 : 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: T.text }}>Bonding Curve</span><span style={{ fontFamily: mono, fontSize: 13, color: T.green, fontWeight: 800 }}>{(curveProgress * 100).toFixed(1)}%</span></div>
                    <BondingCurve progress={curveProgress} />
                  </div>
                </div>
              </div>
            )}
            {/* WALLETS */}
            {tab === "wallets" && (<div><div style={{ marginBottom: mobile ? 16 : 24, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}><div><h2 style={{ fontFamily: sans, fontWeight: 900, fontSize: mobile ? 20 : 24, color: T.text }}>Wallet Fleet <span style={{ color: T.green }}>({activeRoles.length})</span></h2><p style={{ fontSize: mobile ? 13 : 15, color: T.dim, marginTop: 6 }}>Each wallet thinks independently</p></div>
              {launched && launchCA && (<button onClick={async () => {
                if (!confirm("Close all positions? This will sell all tokens and stop trading.")) return;
                try {
                  const res = await fetch(API + "/api/close", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-Wallet": user?.pubkey },
                    body: JSON.stringify({ ca: launchCA, wallet: user?.pubkey }),
                  });
                  const data = await res.json();
                  if (data.error) alert("Close error: " + data.error);
                  else alert(`Positions closed! Recovered: ${(data.solRecovered || 0).toFixed(4)} SOL | Net: ${(data.netProfit || 0).toFixed(4)} SOL`);
                } catch (e) { alert("Close failed: " + e.message); }
              }} style={{ background: "none", border: "2px solid " + T.red, color: T.red, fontFamily: mono, fontSize: 13, fontWeight: 700, padding: "8px 16px", borderRadius: 10, cursor: "pointer", textTransform: "uppercase", letterSpacing: ".05em" }}>☠ Close All</button>)}
              </div>
              {launchCA && (<div style={{ background: T.surface, border: "2px solid " + T.green + "33", borderRadius: 14, padding: mobile ? 14 : 18, marginBottom: mobile ? 14 : 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, fontFamily: mono, color: T.bg, background: T.green, padding: "2px 8px", borderRadius: 6, textTransform: "uppercase", letterSpacing: ".1em" }}>LIVE</span>
                  <span style={{ fontFamily: mono, fontSize: 12, color: T.mid, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }} onClick={() => { navigator.clipboard?.writeText(launchCA); }}>{launchCA}</span>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <a href={"https://pump.fun/coin/" + launchCA} target="_blank" rel="noopener" style={{ fontFamily: mono, fontSize: 12, color: T.green, textDecoration: "none" }}>pump.fun ↗</a>
                  <a href={"https://solscan.io/token/" + launchCA} target="_blank" rel="noopener" style={{ fontFamily: mono, fontSize: 12, color: T.dim, textDecoration: "none" }}>solscan ↗</a>
                  <a href={"https://dexscreener.com/solana/" + launchCA} target="_blank" rel="noopener" style={{ fontFamily: mono, fontSize: 12, color: T.dim, textDecoration: "none" }}>dexscreener ↗</a>
                </div>
                {fleetStatus && (<div style={{ marginTop: 10, fontSize: 12, fontFamily: mono, color: T.dim }}>
                  Fleet: {fleetStatus.phase || "initializing"} | Wallets: {fleetStatus.activeWallets || 0} | Trades: {fleetStatus.tradeCount || 0}
                </div>)}
              </div>)}
              {pastSessions.length > 0 && !launchCA && (<div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 14, padding: mobile ? 14 : 18, marginBottom: mobile ? 14 : 20 }}>
                <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 12 }}>Past Sessions (VIP)</div>
                {pastSessions.map(s => (<div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid " + T.border + "22" }}>
                  <span style={{ fontFamily: mono, fontSize: 12, color: T.mid, flex: 1 }}>{s.tokenConfig?.ticker || "?"} — {s.tokenCA?.slice(0, 8)}...</span>
                  <span style={{ fontSize: 11, fontFamily: mono, color: T.dim }}>{s.status}</span>
                  <button onClick={async () => {
                    try {
                      const res = await fetch(API + "/api/session/resume", { method: "POST", headers: { "Content-Type": "application/json", "X-Wallet": user?.pubkey }, body: JSON.stringify({ sessionId: s.id, wallet: user?.pubkey }) });
                      const data = await res.json();
                      if (data.ok) { setLaunchCA(data.tokenCA); setLaunched(true); }
                      else alert(data.error || "Resume failed");
                    } catch (e) { alert("Error: " + e.message); }
                  }} style={{ background: T.green, color: T.bg, border: "none", fontFamily: mono, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6, cursor: "pointer" }}>Resume</button>
                </div>))}
              </div>)}
              {!canLaunch ? (<div style={{ padding: mobile ? 40 : 70, textAlign: "center", background: T.surface, borderRadius: 18, border: "2px dashed " + T.border }}><span style={{ fontSize: mobile ? 40 : 56, display: "block", marginBottom: 16 }}>{"\u{1F916}"}</span><p style={{ fontFamily: mono, fontSize: mobile ? 14 : 16, color: T.dim }}>Configure token + wallet in Create & Config tabs first</p></div>) : (<div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : activeRoles.length <= 5 ? "1fr 1fr" : "1fr 1fr 1fr", gap: mobile ? 12 : 18 }}>{activeRoles.map(role => (<WalletCard key={role.id} role={role} solBudget={+(totalSol * role.weight / 100).toFixed(4)} mobile={mobile} />))}</div>)}</div>)}
            {/* CONFIG */}
            {tab === "config" && (<div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: mobile ? 12 : 24, animation: "fadeUp .4s ease" }}>
              <div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 18, padding: mobile ? 20 : 28 }}><h3 style={{ fontFamily: mono, fontSize: 17, fontWeight: 700, marginBottom: 24, display: "flex", alignItems: "center", gap: 10, color: T.text }}><Ic.Wallet /> Settings</h3><div style={{ display: "flex", flexDirection: "column", gap: 20 }}><div><Label>RPC URL</Label><Input value={rpc} onChange={setRpc} placeholder="https://mainnet.helius-rpc.com/?api-key=..." icon={<Ic.Zap />} big /></div><div><Label>Master Wallet (Private Key)</Label><Input value={seed} onChange={setSeed} placeholder="bs58 encoded private key" type="password" icon={<Ic.Lock />} big /><p style={{ fontSize: 12, color: T.faint, fontFamily: mono, marginTop: 8, lineHeight: 1.5 }}>Optional. If set, launches directly from this wallet — no deposit step.</p></div><div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: T.bg, borderRadius: 12, border: "2px solid " + T.border, cursor: "pointer" }} onClick={() => setUseAtlas(!useAtlas)}><div style={{ width: 46, height: 26, borderRadius: 13, padding: 3, background: useAtlas ? T.green : T.border, transition: "all .2s", flexShrink: 0 }}><div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", transform: useAtlas ? "translateX(20px)" : "translateX(0)", transition: "transform .2s" }} /></div><div><div style={{ fontSize: 15, fontFamily: mono, fontWeight: 700, color: T.text }}>Helius Atlas</div><div style={{ fontSize: 13, color: T.dim }}>Ultra low-latency staked connections</div></div></div></div></div>
              <div style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 18, padding: mobile ? 20 : 28 }}><h3 style={{ fontFamily: mono, fontSize: 17, fontWeight: 700, marginBottom: 24, display: "flex", alignItems: "center", gap: 10, color: T.text }}><Ic.Zap /> Fleet Preview</h3><div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{activeRoles.map(r => (<div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid " + T.border + "22" }}><span style={{ fontSize: 20 }}>{r.emoji}</span><span style={{ flex: 1, fontSize: 14, fontFamily: mono, color: T.mid }}>{r.name}{r.id === "sniper" ? " x" + sniperCount : ""}</span><span style={{ fontSize: 14, fontFamily: mono, color: ROLE_COLORS(T)[r.id], fontWeight: 700 }}>{(totalSol * r.weight / 100).toFixed(3)}</span></div>))}</div><div style={{ padding: 14, background: T.bg, borderRadius: 12, border: "1px solid " + T.border, marginTop: 16 }}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, textAlign: "center" }}>{[{ k: "Budget", v: totalSol + " SOL" }, { k: "Wallets", v: walletCount + sniperCount - 1 }, { k: "Duration", v: duration + "m" }].map(s => (<div key={s.k}><div style={{ fontSize: 18, fontFamily: mono, fontWeight: 800, color: T.green }}>{s.v}</div><div style={{ fontSize: 11, color: T.faint, fontFamily: mono }}>{s.k}</div></div>))}</div></div></div>
            </div>)}
          </div>
          {mobile ? <MobileNav tab={tab} setTab={setTab} /> : <footer style={{ padding: "16px 28px", borderTop: "1px solid " + T.border, marginTop: 40, display: "flex", justifyContent: "space-between", fontSize: 13, color: T.faint, fontFamily: mono }}><span>BONDLI v3.1 {"\u00B7"} {PLATFORM_WALLET}</span><span>{launched ? <span style={{ color: T.green }}>{"\u25CF"} ACTIVE</span> : "\u25CF IDLE"}</span></footer>}
        </div>
      )}
    </ThemeCtx.Provider>
  );
}
