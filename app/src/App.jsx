import { useState, useEffect, useRef, useMemo, createContext, useContext } from "react";

const API = "https://bondli-production.up.railway.app";
window.__BONDLI_API = API;
const WS_URL = "wss://bondli-production.up.railway.app/ws";
const PLATFORM_WALLET = "4XnHZZmHwSQ8RszJsdc7snvxG8dZtm6g4hvpkCMkguMx";
const PRO_FEE_SOL = 10; // fallback, actual price fetched from bonding curve
const FREE_PROFIT_CUT = 25; // percent

// === DETERMINISTIC AVATAR + USERNAME FROM WALLET ===
function hashWallet(pubkey) {
  let h = 0;
  for (let i = 0; i < pubkey.length; i++) { h = ((h << 5) - h + pubkey.charCodeAt(i)) | 0; }
  return Math.abs(h);
}

function walletColor(pubkey) {
  const h = hashWallet(pubkey);
  const hue = h % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

function walletUsername(pubkey) {
  const adj = ["Red","Blue","Green","Dark","Fast","Neon","Wild","Cold","Hyper","Degen","Based","Chad","Sigma","Alpha","Giga","Turbo","Stealth","Quantum","Cosmic","Iron"];
  const noun = ["Pill","Ape","Frog","Degen","Bull","Wolf","Fox","Shark","Whale","Sniper","Bot","Node","Ghost","Flame","Wave","Storm","Byte","Pulse","Core","Flux"];
  const h = hashWallet(pubkey);
  return adj[h % adj.length] + noun[(h >> 8) % noun.length] + (h % 100);
}

// SVG avatar — geometric shape from wallet hash
function WalletAvatar({ pubkey, size = 28 }) {
  const h = hashWallet(pubkey || "demo");
  const hue = h % 360;
  const hue2 = (hue + 120) % 360;
  const shape = h % 4; // 0=diamond, 1=hexagon, 2=circle+cross, 3=triangle
  const s = size;
  const c = s / 2;

  const shapes = [
    // Diamond
    `M${c},${s*0.1} L${s*0.85},${c} L${c},${s*0.9} L${s*0.15},${c} Z`,
    // Hexagon
    `M${c},${s*0.1} L${s*0.85},${s*0.3} L${s*0.85},${s*0.7} L${c},${s*0.9} L${s*0.15},${s*0.7} L${s*0.15},${s*0.3} Z`,
    // Rounded square
    `M${s*0.2},${s*0.15} Q${s*0.15},${s*0.15} ${s*0.15},${s*0.2} L${s*0.15},${s*0.8} Q${s*0.15},${s*0.85} ${s*0.2},${s*0.85} L${s*0.8},${s*0.85} Q${s*0.85},${s*0.85} ${s*0.85},${s*0.8} L${s*0.85},${s*0.2} Q${s*0.85},${s*0.15} ${s*0.8},${s*0.15} Z`,
    // Triangle
    `M${c},${s*0.1} L${s*0.88},${s*0.85} L${s*0.12},${s*0.85} Z`,
  ];

  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
      <defs>
        <linearGradient id={`ag${h}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={`hsl(${hue},75%,55%)`} />
          <stop offset="100%" stopColor={`hsl(${hue2},70%,40%)`} />
        </linearGradient>
      </defs>
      <path d={shapes[shape]} fill={`url(#ag${h})`} />
      {/* Inner detail */}
      <circle cx={c} cy={c} r={s*0.15} fill={`hsl(${hue},60%,70%)`} opacity="0.4" />
    </svg>
  );
}

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

// === CUSTOM SVG ROLE ICONS (no default emoji) ===
const RoleIcon = ({ role, size = 20, color }) => {
  const s = size;
  const c = color || "#888";
  const icons = {
    sniper: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>,
    accumulator: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
    momentum: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    swing: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    whale: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><path d="M2 12c0-4 3-8 10-8s10 4 10 8-3 7-7 7c-2 0-3-1-3-1s-1 1-3 1c-4 0-7-3-7-7z"/><circle cx="8" cy="10" r="1" fill={c}/></svg>,
    liquidator: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>,
    recycler: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>,
    early1: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    early2: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    mid1: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    mid2: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    late1: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>,
    late2: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>,
    ape1: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    scout: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    fleet: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
    solo: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    dev: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
    "dev-profit": <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>,
    master: <svg width={s} height={s} viewBox="0 0 24 24" fill={c}><path d="M2 20h20v2H2v-2zm1-7l4.5 3L12 4l4.5 12L21 13l-2 7H5l-2-7z"/></svg>,
  };
  return icons[role] || icons.solo;
};

// Status/UI icons (no emoji)
const StatusIc = {
  Skull: ({ size = 14, color = "#ff4444" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><circle cx="12" cy="10" r="8"/><path d="M8 16v4h2v-2h4v2h2v-4"/><circle cx="9" cy="9" r="1.5" fill={color}/><circle cx="15" cy="9" r="1.5" fill={color}/></svg>,
  Rocket: ({ size = 14, color = "#00e676" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/></svg>,
  Key: ({ size = 14, color = "#ffd600" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>,
  Warn: ({ size = 14, color = "#ff9100" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Bag: ({ size = 14, color = "#888" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 00-8 0v2"/></svg>,
  Search: ({ size = 14, color = "#888" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Copy: ({ size = 14, color = "#888" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>,
  Signal: ({ size = 14, color = "#888" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 4v16"/></svg>,
  Globe: ({ size = 12, color = "#888" }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>,
  ArrowUp: ({ size = 10 }) => <svg width={size} height={size} viewBox="0 0 10 10"><path d="M5 2L9 8H1z" fill="currentColor"/></svg>,
  ArrowDown: ({ size = 10 }) => <svg width={size} height={size} viewBox="0 0 10 10"><path d="M5 8L1 2h8z" fill="currentColor"/></svg>,
};

const ROLES = [
  { id:"sniper", name:"Sniper", weight:8, thinkStyle:"aggressive" },
  { id:"accumulator", name:"Accumulator", weight:12, thinkStyle:"patient" },
  { id:"momentum", name:"Momentum", weight:22, thinkStyle:"reactive" },
  { id:"swing", name:"Swing", weight:18, thinkStyle:"analytical" },
  { id:"whale", name:"Whale", weight:28, thinkStyle:"strategic" },
  { id:"liquidator", name:"Liquidator", weight:8, thinkStyle:"cautious" },
  { id:"recycler", name:"Recycler", weight:4, thinkStyle:"mechanical" },
];
const ROLE_COLORS = (T) => ({ sniper: T.red, accumulator: T.blue, momentum: T.green, swing: T.purple, whale: T.yellow, liquidator: T.orange, recycler: T.dim });

const THOUGHTS = {
  aggressive: ["scanning mempool for entry window...","detected low liquidity \u2014 preparing front-run","optimal entry: next 2 blocks, slippage ok","entry locked. watching curve velocity"],
  patient: ["accumulating slowly... 3 micro-buys queued","price dipped 2.1% \u2014 increasing buy freq","building floor support at current level","steady state. drip buying continues"],
  reactive: ["2 consecutive buys \u2014 joining momentum","FOMO trigger: 4 buys in 30s, burst deploy","volume spike! increasing size 40%","painting green candle \u2014 3 rapid buys"],
  analytical: ["price at local resistance \u2014 sell ladder","support held at 0.0000043 \u2014 placing buy","breakout potential \u2014 switch to momentum","dip buyer activated. absorbing sells"],
  strategic: ["holding dry powder for key level","deploying 40% allocation \u2014 high conviction","large buy at curve inflection: max impact","position established. managing exit ladder"],
  cautious: ["profit target 1 \u2014 trimming 15%","sell ladder: 20/30/50 split","distribution phase. accelerating exits","locking gains before curve flattens"],
  mechanical: ["scanning wallets for stranded tokens...","recycling 42k tokens → ~0.012 SOL","SOL recovered. redistributing to fleet","sweep complete. reserve replenished"],
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
let _logoId = 0;
const BondliLogo = ({ size = 34 }) => {
  const id = useState(() => ++_logoId)[0];
  const g1 = `bL1_${id}`, g2 = `bL2_${id}`, gs = `bLs_${id}`;
  return (
    <svg width={size} height={size * 1.4} viewBox="0 0 30 42" style={{ filter: "drop-shadow(0 2px 8px rgba(220,20,20,.45))" }}>
      <defs>
        <linearGradient id={g1} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff5555"/><stop offset="50%" stopColor="#dd1818"/><stop offset="100%" stopColor="#881010"/></linearGradient>
        <linearGradient id={g2} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#ff4040" stopOpacity="0.95"/><stop offset="100%" stopColor="#771010" stopOpacity="0.9"/></linearGradient>
        <linearGradient id={gs} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#ff9999" stopOpacity="0.4"/><stop offset="100%" stopColor="#ff4444" stopOpacity="0"/></linearGradient>
      </defs>
      <path d={`M15,2 Q23,2 26,8 L27,20 L27,22 L26,34 Q23,40 15,40 L15,2 Z`} fill={`url(#${g1})`}/>
      <path d={`M15,2 Q7,2 4,8 L3,20 L3,22 L4,34 Q7,40 15,40 L15,2 Z`} fill={`url(#${g2})`}/>
      <path d={`M10,4 Q7,6 6,12 L8,10 Q10,5 14,4 Z`} fill={`url(#${gs})`}/>
      <path d="M15,2 Q7,2 4,8 L3,20" stroke="#ff999933" strokeWidth="0.5" fill="none"/>
    </svg>
  );
};
const RedPill = BondliLogo; // backward compat

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
function Input({ value, onChange, onKeyDown, placeholder, type = "text", icon, big = false, ...props }) {
  const T = useTheme(); const [focus, setFocus] = useState(false);
  return (<div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 14px", background: T.bg, border: "2px solid " + (focus ? T.green + "55" : T.border), borderRadius: 12, transition: "border-color .2s", minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}>{icon && <span style={{ color: T.dim, display: "flex", flexShrink: 0 }}>{icon}</span>}<input type={type} value={value} onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} style={{ flex: 1, padding: big ? "16px 0" : "14px 0", background: "none", border: "none", outline: "none", color: T.text, fontFamily: mono, fontSize: big ? 17 : 16, minWidth: 0, width: "100%" }} {...props} /></div>);
}
function Label({ children }) { const T = useTheme(); return <div style={{ fontSize: 13, fontWeight: 700, color: T.dim, fontFamily: mono, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 10 }}>{children}</div>; }
function ThemeToggle({ isDark, toggle, mobile }) { const T = useTheme(); return <button onClick={toggle} style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 10, padding: mobile ? "6px 8px" : "7px 10px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: T.dim, transition: "all .2s", WebkitTapHighlightColor: "transparent" }}>{isDark ? <Ic.Sun /> : <Ic.Moon />}</button>; }

// ══════════════════════════════════════════
// LANDING PAGE
// ══════════════════════════════════════════
function LandingPage({ onConnect, isDark, toggleTheme }) {
  const T = useTheme(); const mobile = useIsMobile();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [proPrice, setProPrice] = useState(PRO_FEE_SOL);
  const [proLicenses, setProLicenses] = useState(0);

  useEffect(() => {
    fetch(API + "/api/pricing").then(r => r.json()).then(d => {
      if (d.ok) { setProPrice(d.currentPrice); setProLicenses(d.licensesSold); }
    }).catch(() => {});
  }, []);

  const getProvider = () => { if (window?.phantom?.solana?.isPhantom) return window.phantom.solana; if (window?.solana?.isPhantom) return window.solana; return null; };

  const connectPhantom = async () => {
    setConnecting(true); setError("");
    try {
      const provider = getProvider();
      if (!provider) {
        if (/iPhone|iPad|Android/i.test(navigator.userAgent)) {
          window.location.href = "https://phantom.app/ul/browse/" + encodeURIComponent(window.location.href);
          return;
        }
        setError("Phantom not found. Install at phantom.app");
        setConnecting(false);
        return;
      }
      const resp = await provider.connect();
      const pubkey = resp.publicKey.toString();
      // Log in IMMEDIATELY with free tier — don't block on API
      onConnect({ pubkey, whitelisted: false, paid: false, tier: "free", demo: false });
      // Background: check actual tier and update
      fetch(API + "/api/access/check?wallet=" + pubkey)
        .then(r => r.json())
        .then(data => {
          if (data.tier) {
            onConnect({ pubkey, whitelisted: !!data.whitelisted, paid: !!data.paid, tier: data.tier, demo: false });
          }
        }).catch(() => {});
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
      <section style={{ maxWidth: 800, margin: "0 auto", padding: mobile ? "60px 20px 50px" : "100px 40px 70px", textAlign: "center", position: "relative", zIndex: 1 }}>
        <div style={{ animation: "pillFloat 3s ease infinite", marginBottom: 32, display: "flex", justifyContent: "center" }}><RedPill size={mobile ? 56 : 72} /></div>
        <h1 style={{ fontFamily: sans, fontWeight: 900, fontSize: mobile ? 34 : 60, lineHeight: 1.05, letterSpacing: "-.03em", marginBottom: 20 }}>
          <span style={{ color: T.green }}>7 wallets.</span><br />One brain.
        </h1>
        <p style={{ fontSize: mobile ? 16 : 19, color: T.dim, maxWidth: 480, margin: "0 auto 40px", lineHeight: 1.6, fontFamily: mono }}>
          Fleet trading engine for pump.fun. Game theory in, SOL out.
        </p>
        {error && <p style={{ fontSize: 14, color: T.red, marginBottom: 14, fontFamily: mono }}>{error}</p>}
        <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <Btn onClick={connectPhantom} disabled={connecting} style={{ padding: "16px 36px", fontSize: 18, borderRadius: 14, background: "linear-gradient(135deg, #534bb1, #551bf9)", animation: "glow 3s infinite" }}><Ic.Phantom /> {connecting ? "..." : "Connect"}</Btn>
          <Btn onClick={() => onConnect({ pubkey: "demo", whitelisted: false, paid: false, tier: "demo", demo: true })} ghost color={T.dim} style={{ padding: "16px 28px", fontSize: 16, borderRadius: 14 }}>Demo</Btn>
        </div>
      </section>

      {/* WHAT IT DOES — one line each */}
      <section style={{ maxWidth: 600, margin: "0 auto", padding: mobile ? "0 20px 40px" : "0 40px 50px", position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {[
            { t: "Radar scans every new token.", c: T.green },
            { t: "Fleet buys look organic, not bundled.", c: T.green },
            { t: "Game theory engine reads every trade.", c: T.green },
            { t: "Sells into demand. Exits before dumps.", c: T.green },
            { t: "You keep the SOL.", c: T.text },
          ].map((l, i) => (
            <div key={i} style={{ padding: "12px 0", borderBottom: i < 4 ? "1px solid " + T.border + "33" : "none", fontFamily: mono, fontSize: mobile ? 14 : 16, color: l.c, fontWeight: i === 4 ? 800 : 500 }}>{l.t}</div>
          ))}
        </div>
      </section>

      {/* YOU vs THE MARKET — visual comparison */}
      <section style={{ maxWidth: 700, margin: "0 auto", padding: mobile ? "0 20px 50px" : "0 40px 70px", position: "relative", zIndex: 1 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: mobile ? 10 : 16 }}>
          <div style={{ background: T.surface, border: "1px solid " + T.red + "33", borderRadius: 16, padding: mobile ? 16 : 24 }}>
            <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: T.red, marginBottom: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>Manual trading</div>
            {["One wallet = one target", "Visible on-chain fingerprint", "Slow reaction to dumps", "Emotional sells", "Sleep = miss moves"].map((x, i) => (
              <div key={i} style={{ fontFamily: mono, fontSize: mobile ? 11 : 13, color: T.dim, padding: "6px 0", borderBottom: i < 4 ? "1px solid " + T.border + "15" : "none" }}>{"/"} {x}</div>
            ))}
          </div>
          <div style={{ background: T.surface, border: "1px solid " + T.green + "33", borderRadius: 16, padding: mobile ? 16 : 24 }}>
            <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: T.green, marginBottom: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>Bondli fleet</div>
            {["7 wallets, 7 strategies", "Gaussian timing, random sizes", "Exits in seconds, not minutes", "Nash equilibrium, not vibes", "24/7 radar never sleeps"].map((x, i) => (
              <div key={i} style={{ fontFamily: mono, fontSize: mobile ? 11 : 13, color: T.green, padding: "6px 0", borderBottom: i < 4 ? "1px solid " + T.border + "15" : "none" }}>{"+"} {x}</div>
            ))}
          </div>
        </div>
      </section>

      {/* UNDER THE HOOD — 3 hard facts */}
      <section style={{ maxWidth: 700, margin: "0 auto", padding: mobile ? "0 20px 50px" : "0 40px 70px", position: "relative", zIndex: 1 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: mobile ? 8 : 14 }}>
          {[
            { n: "13", label: "Engine modules", sub: "Fleet, GameState, Radar, Anti-detection..." },
            { n: "15+", label: "Scoring signals", sub: "Volume, socials, bundles, dev behavior..." },
            { n: "<2s", label: "Exit latency", sub: "Dump detected to sell broadcast" },
          ].map((s, i) => (
            <div key={i} style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 14, padding: mobile ? 14 : 20, textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: mobile ? 24 : 32, fontWeight: 900, color: T.green }}>{s.n}</div>
              <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: T.text, marginTop: 4 }}>{s.label}</div>
              <div style={{ fontFamily: mono, fontSize: 9, color: T.faint, marginTop: 4 }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING — compact */}
      <section style={{ maxWidth: 600, margin: "0 auto", padding: mobile ? "0 20px 60px" : "0 40px 80px", position: "relative", zIndex: 1 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ background: T.surface, border: "1px solid " + T.border, borderRadius: 16, padding: mobile ? 20 : 28 }}>
            <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: T.green, marginBottom: 8 }}>FREE</div>
            <div style={{ fontFamily: mono, fontSize: mobile ? 28 : 36, fontWeight: 900, color: T.text }}>0</div>
            <div style={{ fontFamily: mono, fontSize: 12, color: T.dim, marginTop: 4 }}>{FREE_PROFIT_CUT}% on close</div>
            <Btn onClick={connectPhantom} full disabled={connecting} ghost color={T.green} style={{ marginTop: 16, borderRadius: 10, fontSize: 13 }}>Start</Btn>
          </div>
          <div style={{ background: T.surface, border: "1px solid " + T.green + "44", borderRadius: 16, padding: mobile ? 20 : 28 }}>
            <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: T.yellow, marginBottom: 8 }}>PRO</div>
            <div style={{ fontFamily: mono, fontSize: mobile ? 28 : 36, fontWeight: 900, color: T.green }}>{proPrice} <span style={{ fontSize: 14, color: T.dim }}>SOL</span></div>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginTop: 4 }}>{proLicenses} sold {"·"} price rises with each license</div>
            <Btn onClick={connectPhantom} full disabled={connecting} style={{ marginTop: 16, borderRadius: 10, fontSize: 13, background: "linear-gradient(135deg, #534bb1, #551bf9)" }}>Go Pro</Btn>
          </div>
        </div>
      </section>

      {/* ONE-LINER */}
      <section style={{ maxWidth: 600, margin: "0 auto", padding: mobile ? "0 20px 60px" : "0 40px 80px", textAlign: "center", position: "relative", zIndex: 1 }}>
        <p style={{ fontFamily: mono, fontSize: mobile ? 15 : 18, color: T.dim, lineHeight: 1.7, fontStyle: "italic" }}>
          {"\""}The market is a game. Most players don't know the rules. The ones who do are using seven wallets.{"\""}
        </p>
      </section>

      <footer style={{ padding: "16px 28px", borderTop: "1px solid " + T.border, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: T.faint, fontFamily: mono }}><span>BONDLI</span><a href="https://x.com/Bondlifun" target="_blank" rel="noopener" style={{ color: T.dim, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>@Bondlifun</a></footer>
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
  const [mode, setMode] = useState(null);
  const [proPrice, setProPrice] = useState(PRO_FEE_SOL);
  const [proNextPrice, setProNextPrice] = useState(PRO_FEE_SOL);
  const [proLicenses, setProLicenses] = useState(0);

  // Fetch current bonding curve price
  useEffect(() => {
    fetch(API + "/api/pricing").then(r => r.json()).then(d => {
      if (d.ok) { setProPrice(d.currentPrice); setProNextPrice(d.nextPrice); setProLicenses(d.licensesSold); }
    }).catch(() => {});
  }, []);

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
        <div style={{ textAlign: "center", marginBottom: 24, display: "flex", flexDirection: "column", alignItems: "center" }}>
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
              <div style={{ fontFamily: mono, fontSize: 32, fontWeight: 900, color: T.text, marginBottom: 4 }}>{proPrice} SOL</div>
              <div style={{ fontFamily: mono, fontSize: 14, color: T.yellow, marginBottom: 8 }}>Keep 100% forever</div>
              <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, marginBottom: 16 }}>License #{proLicenses + 1} {"·"} next: {proNextPrice} SOL</div>
              <div style={{ fontSize: 13, color: T.faint, marginBottom: 20, lineHeight: 1.6 }}>Price goes up with every license sold. Early users pay less.</div>
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 14, color: T.dim, fontFamily: mono, fontWeight: 600 }}>LICENSE #{proLicenses + 1}</span>
                <span style={{ fontSize: 28, fontFamily: mono, fontWeight: 900, color: T.green }}>{proPrice} SOL</span>
              </div>
              <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, marginBottom: 14, textAlign: "right" }}>Next license: {proNextPrice} SOL</div>
              <div style={{ padding: "12px 14px", background: T.surface, borderRadius: 10, border: "1px dashed " + T.border, fontFamily: mono, fontSize: mobile ? 14 : 16, color: T.green, wordBreak: "break-all", textAlign: "center", fontWeight: 600 }}>{PLATFORM_WALLET}</div>
              <p style={{ fontSize: 13, color: T.faint, textAlign: "center", marginTop: 10 }}>Send {proPrice} SOL, paste tx signature below</p>
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
function mcapFmt(n) { return n >= 1e6 ? (n/1e6).toFixed(1) + "M" : n >= 1e3 ? (n/1e3).toFixed(1) + "k" : Math.round(n).toString(); }

// ── Heartbeat MCap Monitor — polls pump.fun from browser, no server dependency ──
function PriceChart({ trades, mobile, T, ca, wsChart, gameState }) {
  const [mcap, setMcap] = useState(null);
  const [bp, setBp] = useState(0);
  const [chartMode, setChartMode] = useState("gmgn");
  const [timeframe, setTimeframe] = useState(5); // minutes: 5, 10, 30, 60, 0=all
  const timeframeRef = useRef(5);
  const drawRef = useRef(null);
  useEffect(() => { timeframeRef.current = timeframe; if (drawRef.current) drawRef.current(); }, [timeframe]);
  const [age, setAge] = useState(0);
  const canvasRef = useRef(null);
  const histRef = useRef([]);
  const wsRef = useRef(wsChart || []);

  // Update wsRef when new data comes in
  useEffect(() => { if (wsChart?.length) wsRef.current = wsChart; }, [wsChart]);

  // Poll for data (fallback if no WS chart)
  useEffect(() => {
    if (!ca) return;
    let alive = true;
    const born = Date.now();
    const poll = async () => {
      while (alive) {
        try {
          const r = await fetch(window.__BONDLI_API + "/api/price/" + ca);
          if (r.ok) {
            const d = await r.json();
            if (d.mcap) { setMcap(d.mcap); setBp(d.bp || 0); histRef.current.push({ t: Date.now(), mcap: d.mcap, bp: d.bp || 0 }); if (histRef.current.length > 200) histRef.current.shift(); }
          }
        } catch {}
        // Also try WS chart endpoint
        try {
          const r = await fetch(window.__BONDLI_API + "/api/chart/" + ca);
          if (r.ok) {
            const d = await r.json();
            if (d.points?.length) wsRef.current = d.points;
          }
        } catch {}
        // DexScreener fallback (browser can hit this directly, no Cloudflare issue)
        if (wsRef.current.length < 3 && histRef.current.length < 3) {
          try {
            const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + ca);
            if (r.ok) {
              const d = await r.json();
              const pair = (d.pairs || []).find(p => p.chainId === "solana");
              if (pair) {
                const mc = pair.marketCap || pair.fdv || 0;
                if (mc > 0) {
                  setMcap(mc); setBp(pair.dexId === "pumpfun" ? 0 : 100);
                  histRef.current.push({ t: Date.now(), mcap: mc, bp: pair.dexId === "pumpfun" ? 0 : 100 });
                }
              }
            }
          } catch {}
        }
        drawCanvas();
        setAge(Math.floor((Date.now() - born) / 1000));
        await new Promise(r => setTimeout(r, 3000));
      }
    };
    poll();
    const autoSwitch = setTimeout(() => { if (chartMode === "live" && wsRef.current.length < 5) setChartMode("gmgn"); }, 45000);
    return () => { alive = false; clearTimeout(autoSwitch); };
  }, [ca]);

  const fmtMcap = n => n >= 1e6 ? (n/1e6).toFixed(1) + "M" : n >= 1e3 ? (n/1e3).toFixed(1) + "K" : Math.round(n).toString();
  const fmt = n => n >= 1e6 ? (n/1e6).toFixed(2) + "M" : n >= 1e3 ? (n/1e3).toFixed(1) + "K" : n?.toFixed(0) || "\u2014";

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    const ws = wsRef.current;
    let rawHist = ws.length >= 3 ? ws.map(p => ({ t: p.t, m: p.mcap || (p.mcapSol || 0) * 170, type: p.type, sol: p.sol, bp: p.bp })) : histRef.current.map(p => ({ t: p.t, m: p.mcap, type: null, sol: 0, bp: p.bp }));
    
    // Apply timeframe filter
    const tf = timeframeRef.current;
    if (tf > 0 && rawHist.length > 0) {
      const cutoff = Date.now() - tf * 60 * 1000;
      rawHist = rawHist.filter(p => p.t >= cutoff);
    }
    const hist = rawHist;
    if (!canvas || hist.length < 2) return;

    const isDark = T?.mode === "dark" || T?.bg === "#0a0a0a" || !T?.bg || T?.bg?.startsWith("#0");
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const pad = { top: 30, right: 52, bottom: 24, left: 8 };
    const mcaps = hist.map(p => p.m).filter(m => m > 0);
    if (mcaps.length < 2) return;
    const mn = Math.min(...mcaps) * 0.92, mx = Math.max(...mcaps) * 1.08, rng = mx - mn || 1;
    const tMin = hist[0].t, tMax = hist[hist.length - 1].t, tRng = tMax - tMin || 1;
    const toX = t => pad.left + ((t - tMin) / tRng) * (W - pad.left - pad.right);
    const toY = m => pad.top + (1 - (m - mn) / rng) * (H - pad.top - pad.bottom);

    // Background
    ctx.fillStyle = isDark ? "#050508" : "#fafafa";
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    const gridColor = isDark ? "#ffffff06" : "#00000008";
    const labelColor = isDark ? "#555" : "#999";
    ctx.strokeStyle = gridColor; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (i / 4) * (H - pad.top - pad.bottom);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = labelColor; ctx.font = "9px monospace"; ctx.textAlign = "right";
      ctx.fillText("$" + fmtMcap(mx - (i / 4) * rng), W - 2, y + 3);
    }

    // Points for curves
    const validHist = hist.filter(p => p.m > 0);
    if (validHist.length < 2) return;
    const last = validHist[validHist.length - 1].m, first = validHist[0].m;
    const up = last >= first;
    const col = up ? "#00ff88" : "#ff4444";
    const points = validHist.map(p => ({ x: toX(p.t), y: toY(p.m) }));

    // Smooth bezier curve helper
    const drawSmoothLine = (pts) => {
      ctx.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 2) {
        ctx.lineTo(pts[1].x, pts[1].y);
        return;
      }
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const cpx = (prev.x + curr.x) / 2;
        ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
      }
    };

    // Glow line (wider, softer)
    ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 8;
    ctx.beginPath(); drawSmoothLine(points);
    ctx.strokeStyle = col + "30"; ctx.lineWidth = 4; ctx.stroke(); ctx.restore();

    // Main line (smooth)
    ctx.beginPath(); drawSmoothLine(points);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();

    // Gradient fill under curve
    const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    grad.addColorStop(0, col + "18"); grad.addColorStop(0.6, col + "08"); grad.addColorStop(1, col + "00");
    ctx.beginPath();
    ctx.moveTo(points[0].x, H - pad.bottom);
    drawSmoothLine(points);
    ctx.lineTo(points[points.length - 1].x, H - pad.bottom);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

    // Buy/sell markers with glow
    for (const p of hist) {
      if (!p.type || p.m <= 0) continue;
      const x = toX(p.t), y = toY(p.m);
      const isBuy = p.type === "buy";
      const markerSize = Math.min(7, 2.5 + (p.sol || 0) * 10);
      // Outer glow
      ctx.beginPath(); ctx.arc(x, y, markerSize + 1, 0, Math.PI * 2);
      ctx.fillStyle = isBuy ? "#00ff8822" : "#ff444422"; ctx.fill();
      // Inner dot
      ctx.beginPath(); ctx.arc(x, y, Math.max(2, markerSize - 1), 0, Math.PI * 2);
      ctx.fillStyle = isBuy ? "#00ff88" : "#ff4444"; ctx.fill();
    }

    // Current price dot with pulse ring
    const lx = points[points.length - 1].x, ly = points[points.length - 1].y;
    ctx.beginPath(); ctx.arc(lx, ly, 6, 0, Math.PI * 2);
    ctx.fillStyle = col + "22"; ctx.fill();
    ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();

    // Header text
    const pct = first > 0 ? ((last - first) / first * 100) : 0;
    const textColor = isDark ? "#ccc" : "#333";
    ctx.fillStyle = textColor; ctx.font = "bold 13px monospace"; ctx.textAlign = "left";
    ctx.fillText("MCap $" + fmtMcap(last), pad.left + 2, 18);
    ctx.fillStyle = col; ctx.font = "bold 12px monospace";
    ctx.fillText((pct >= 0 ? "▲" : "▼") + Math.abs(pct).toFixed(1) + "%", pad.left + 130, 18);

    // Trade count
    const buyCnt = hist.filter(p => p.type === "buy").length;
    const sellCnt = hist.filter(p => p.type === "sell").length;
    if (buyCnt + sellCnt > 0) {
      ctx.fillStyle = labelColor; ctx.font = "10px monospace"; ctx.textAlign = "right";
      ctx.fillText(`${buyCnt}b / ${sellCnt}s`, W - pad.right + 48, 18);
    }

    // Bonding bar
    const bpVal = validHist[validHist.length - 1]?.bp || 0;
    if (bpVal > 0) {
      const bW = W - pad.left - pad.right;
      const barBg = isDark ? "#ffffff08" : "#00000008";
      ctx.fillStyle = barBg; ctx.fillRect(pad.left, H - 8, bW, 4);
      const barCol = bpVal >= 80 ? "#ffaa00" : col;
      // Rounded bar
      const barW = bW * Math.min(1, bpVal / 100);
      ctx.fillStyle = barCol + "88";
      ctx.beginPath();
      ctx.roundRect(pad.left, H - 8, barW, 4, 2);
      ctx.fill();
      ctx.fillStyle = labelColor; ctx.font = "8px monospace"; ctx.textAlign = "left";
      ctx.fillText(bpVal.toFixed(0) + "%", pad.left + barW + 4, H - 2);
    }
  };
  drawRef.current = drawCanvas;

  return (
    <div>
      <div style={{ padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {mcap && <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 800, color: "#00e676" }}>${fmt(mcap)}</span>}
          {bp > 0 && <span style={{ fontFamily: "monospace", fontSize: 10, color: "#888" }}>{bp.toFixed(1)}%</span>}
          {gameState && <span style={{ fontFamily: "monospace", fontSize: 9, padding: "1px 5px", borderRadius: 3, background: gameState.signal === "SELL_NOW" ? "#ff444422" : gameState.signal === "RIDE" ? "#00ff8822" : gameState.signal === "ACCUMULATE" ? "#4488ff22" : "#33333322", color: gameState.signal === "SELL_NOW" ? "#ff4444" : gameState.signal === "RIDE" ? "#00ff88" : gameState.signal === "ACCUMULATE" ? "#4488ff" : "#666", fontWeight: 700 }}>{gameState.signal}</span>}
        </div>
        <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
          {/* Timeframe buttons */}
          {<div style={{ display: "flex", background: T?.border ? T.border + "44" : "#33333344", borderRadius: 6, overflow: "hidden" }}>
            {[{ v: 5, l: "5m" }, { v: 10, l: "10m" }, { v: 30, l: "30m" }, { v: 60, l: "1h" }, { v: 0, l: "All" }].map(tf => (
              <button key={tf.v} onClick={() => setTimeframe(tf.v)} style={{ background: timeframe === tf.v ? (T?.green || "#00e676") : "transparent", border: "none", padding: "4px 8px", fontFamily: "monospace", fontSize: 10, color: timeframe === tf.v ? "#000" : "#888", cursor: "pointer", fontWeight: timeframe === tf.v ? 800 : 400, transition: "all .15s" }}>{tf.l}</button>
            ))}
          </div>}
          <span style={{ width: 1, height: 14, background: "#333", margin: "0 2px" }} />
          {/* Chart mode buttons */}
          <div style={{ display: "flex", background: T?.border ? T.border + "44" : "#33333344", borderRadius: 6, overflow: "hidden" }}>
            {["gmgn", "dex", "live"].map(m => (
              <button key={m} onClick={() => setChartMode(m)} style={{ background: chartMode === m ? (T?.green || "#00e676") : "transparent", border: "none", padding: "4px 8px", fontFamily: "monospace", fontSize: 10, color: chartMode === m ? "#000" : "#888", cursor: "pointer", fontWeight: chartMode === m ? 800 : 400, transition: "all .15s" }}>{m === "gmgn" ? "GMGN" : m === "dex" ? "DEX" : "WS"}</button>
            ))}
          </div>
        </div>
      </div>
      {bp > 0 && <div style={{ height: 3, background: "#1a1a2a", margin: "0 14px 4px" }}><div style={{ height: 3, background: bp >= 100 ? "#ffaa00" : "#00e676", width: Math.min(100, bp) + "%", borderRadius: 2, transition: "width 1s" }} /></div>}
      {chartMode === "gmgn" ? (
        <iframe src={"https://www.gmgn.cc/kline/sol/" + ca} style={{ width: "100%", height: mobile ? 300 : 420, border: "none", display: "block", borderRadius: 4, background: "#0a0a0a" }} title="GMGN Chart" allow="clipboard-write" />
      ) : chartMode === "dex" ? (
        <iframe src={"https://dexscreener.com/solana/" + ca + "?embed=1&theme=dark&trades=0&info=0"} style={{ width: "100%", height: mobile ? 300 : 420, border: "none", display: "block" }} title="DexScreener" allow="clipboard-write" />
      ) : chartMode === "live" ? (
        <div style={{ position: "relative" }}>
          <canvas ref={canvasRef} style={{ width: "100%", height: mobile ? 220 : 300, display: "block" }} />
          {wsRef.current.length < 2 && histRef.current.length < 2 && <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontFamily: "monospace", fontSize: 12, color: "#444", animation: "pulse 2s infinite" }}>Collecting trades...</div>}
          <div style={{ position: "absolute", bottom: 10, left: 14, display: "flex", gap: 10, fontSize: 8, fontFamily: "monospace", color: "#555" }}>
            <span><span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#00ff88", marginRight: 3 }}/>buy</span>
            <span><span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#ff4444", marginRight: 3 }}/>sell</span>
            <span style={{ opacity: 0.6 }}>dot size = trade size</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════
// RADAR — Full-screen card grid scanner (pump.fun style)
// ═══════════════════════════════════════
// ── Sparkline — lightweight canvas mini chart for radar rows ──
function Sparkline({ data, color = "#00ff88", height = 36 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || data.length < 2) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width = canvas.offsetWidth * 2;
    const h = canvas.height = height * 2;
    ctx.clearRect(0, 0, w, h);
    const pts = data.filter(v => v > 0);
    if (pts.length < 2) return;
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min || 1;
    const pad = 4;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    for (let i = 0; i < pts.length; i++) {
      const x = (i / (pts.length - 1)) * (w - pad * 2) + pad;
      const y = h - pad - ((pts[i] - min) / range) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Fill gradient under line
    ctx.lineTo((pts.length - 1) / (pts.length - 1) * (w - pad * 2) + pad, h);
    ctx.lineTo(pad, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + "22");
    grad.addColorStop(1, color + "02");
    ctx.fillStyle = grad;
    ctx.fill();
  }, [data, color, height]);

  if (!data || data.filter(v => v > 0).length < 2) return <div style={{ width: "100%", height, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontFamily: "'SF Mono',monospace", fontSize: 10, color: "#555" }}>{"\u2014"}</span></div>;
  return <canvas ref={canvasRef} style={{ width: "100%", height, display: "block" }} />;
}

function RadarFeed({ T, mobile, onApe, onQuickApe, onQuickSell, isVip, fullScreen, tradingBalance, heldMints, toast }) {
  const mono = "'SF Mono',SFMono-Regular,ui-monospace,'Cascadia Mono',Menlo,monospace";
  const [tabs, setTabs] = useState({ new: [], hot: [], graduating: [], momentum: [] });
  const [activeTab, setActiveTab] = useState("momentum");
  const [wsAlive, setWsAlive] = useState(false);
  const [poolSize, setPoolSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [selected, setSelected] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [online, setOnline] = useState(0);
  const [search, setSearch] = useState("");
  const [externalResult, setExternalResult] = useState(null);
  const [apiSearchResults, setApiSearchResults] = useState([]);
  const seenCAs = useRef(new Set());
  const prevCAsRef = useRef(new Set()); // CAs from last render — used to detect truly new entries
  const lastDataHash = useRef(""); // prevent unnecessary re-renders

  const allTokens = tabs[activeTab] || [];
  // Deduplicate by CA — keep highest score
  const dedupMap = new Map();
  for (const t of allTokens) { if (!dedupMap.has(t.ca) || dedupMap.get(t.ca).score < t.score) dedupMap.set(t.ca, t); }
  const dedupedTokens = [...dedupMap.values()].sort((a, b) => b.score - a.score);
  const tokens = search.length >= 2
    ? dedupedTokens.filter(t => (t.ticker || "").toLowerCase().includes(search.toLowerCase()) || (t.name || "").toLowerCase().includes(search.toLowerCase()) || (t.ca || "").toLowerCase().startsWith(search.toLowerCase()))
    : dedupedTokens;

  // API search — search server for any query 2+ chars
  useEffect(() => {
    if (search.length < 2) { setApiSearchResults([]); setExternalResult(null); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        // For full CA (32+ chars), also hit radar/token endpoint
        if (search.length >= 32) {
          const r = await fetch(window.__BONDLI_API + "/api/radar/token/" + search);
          if (r.ok && !cancelled) {
            const d = await r.json();
            if (d.ok && !cancelled) setExternalResult({ ca: search, name: d.name || d.ticker || "?", ticker: d.ticker || "?", mcapUsd: d.mcap || 0, buys: d.txns1h?.buys || 0, sells: d.txns1h?.sells || 0, image: d.image_uri, description: d.description, score: d.score || 0, verdict: d.verdict || "?", bp: d.bp || 0, external: true });
          }
        }
        // Always search the API (DexScreener-backed)
        const sr = await fetch(window.__BONDLI_API + "/api/search?q=" + encodeURIComponent(search));
        if (sr.ok && !cancelled) {
          const sd = await sr.json();
          if (sd.results && !cancelled) {
            setApiSearchResults(sd.results.map(r => ({
              ca: r.ca, name: r.name, ticker: r.ticker, mcapUsd: r.mcap || 0,
              buys: r.buys24 || 0, sells: r.sells24 || 0,
              image: r.image, description: "",
              score: 0, verdict: "?", bp: 0, external: true,
            })).filter(r => r.ca));
          }
        }
      } catch {}
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]);

  // Merge: local hits first, then API results (deduped)
  const mergedExternal = [...(externalResult ? [externalResult] : []), ...apiSearchResults];
  const displayTokens = search.length >= 2
    ? [...tokens, ...mergedExternal.filter(e => e.ca && !tokens.some(t => t.ca === e.ca))]
    : tokens;

  const fetchRadar = async () => {
    try {
      const r = await fetch(window.__BONDLI_API + "/api/radar");
      if (r.ok) {
        const d = await r.json();
        // Only update state if data actually changed (prevents unnecessary re-renders)
        const newTabs = d.tabs || { hot: d.tokens || [], new: [], graduating: [], momentum: [] };
        const hash = JSON.stringify(Object.keys(newTabs).map(k => (newTabs[k] || []).map(t => t.ca + t.score).join(",")).join("|"));
        if (hash !== lastDataHash.current) {
          lastDataHash.current = hash;
          setTabs(newTabs);
        }
        setWsAlive(d.wsAlive || false);
        setPoolSize(d.poolSize || 0);
        setEnabled(d.enabled !== false);
        if (d.online != null) setOnline(d.online);
        setLoading(false);
      }
    } catch {}
  };

  useEffect(() => {
    let alive = true;
    const poll = async () => { while (alive) { if (enabled) await fetchRadar(); await new Promise(r => setTimeout(r, 4000)); } };
    fetchRadar(); poll();
    return () => { alive = false; };
  }, [enabled]);

  const handleRefresh = async () => { setRefreshing(true); lastDataHash.current = ""; seenCAs.current.clear(); prevCAsRef.current.clear(); await fetchRadar(); setTimeout(() => setRefreshing(false), 600); };
  const handleToggle = async () => { try { const r = await fetch(window.__BONDLI_API + "/api/radar/toggle", { method: "POST" }); if (r.ok) { const d = await r.json(); setEnabled(d.enabled); } } catch {} };

  const handleSelect = async (ca) => {
    if (selected?.ca === ca) { setSelected(null); return; }
    
    // Scroll to top so detail panel is visible
    window.scrollTo({ top: 0, behavior: "smooth" });
    
    // First: check if we already have this token's data in our tabs (no API call needed)
    const allTabTokens = [...(tabs.hot || []), ...(tabs.new || []), ...(tabs.graduating || []), ...(tabs.momentum || [])];
    const localToken = allTabTokens.find(t => t.ca === ca);
    
    if (localToken) {
      // We already have enough data to show the detail panel
      setSelected({ ok: true, ca, ...localToken });
      // Optionally fetch richer detail in background (non-blocking)
      fetch(window.__BONDLI_API + "/api/radar/token/" + ca)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.ok) setSelected(prev => prev?.ca === ca ? { ...prev, ...d } : prev); })
        .catch(() => {});
      return;
    }
    
    // Fallback: no local data, must fetch
    setSelected({ ca, loading: true });
    try {
      const r = await fetch(window.__BONDLI_API + "/api/radar/token/" + ca);
      if (r.ok) {
        const d = await r.json();
        setSelected(d.ok ? d : { ca, error: d.error || "Failed" });
      } else {
        setSelected({ ca, error: "Server error" });
      }
    } catch { setSelected({ ca, error: "Network error" }); }
  };

  const fmt = n => !n || n === 0 ? "\u2014" : n >= 1e6 ? (n/1e6).toFixed(1) + "M" : n >= 1e3 ? (n/1e3).toFixed(1) + "K" : n.toFixed(0);
  const vc = v => v === "APE" ? T.green : v === "WATCH" ? "#ffaa00" : T.faint;
  const ago = ts => { if (!ts) return ""; const s = Math.floor((Date.now() - ts) / 1000); return s < 60 ? s + "s" : s < 3600 ? Math.floor(s/60) + "m" : Math.floor(s/3600) + "h"; };

  const TAB_CONFIG = [
    { id: "momentum", label: "Momentum", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg> },
    { id: "hot", label: "Hot", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 23c-4.97 0-9-3.58-9-8 0-5.5 7-13.5 9-15.5 2 2 9 10 9 15.5 0 4.42-4.03 8-9 8zm-1-9.5c-1.5 2-2 3.5-2 4.5 0 1.93 1.57 3.5 3 3.5s3-1.57 3-3.5c0-1-.5-2.5-2-4.5l-1-1.5-1 1.5z"/></svg> },
    { id: "new", label: "New", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4m10-10h-4M6 12H2m15.07-7.07l-2.83 2.83M9.76 14.24l-2.83 2.83m12.14 0l-2.83-2.83M9.76 9.76L6.93 6.93"/></svg> },
    { id: "graduating", label: "Grad", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zm0 14.27L4.58 13.1 4 13.45V18l8 4.35L20 18v-4.55l-.58-.35L12 17.27z"/></svg> },
  ];

  // ── Customizable buy amounts (saved to localStorage) ──
  const [buyAmounts, setBuyAmounts] = useState(() => {
    try { const s = localStorage.getItem("bondli_buy_amounts"); return s ? JSON.parse(s) : [0.1, 0.5, 1]; } catch { return [0.1, 0.5, 1]; }
  });
  const [editingAmounts, setEditingAmounts] = useState(false);

  // ── Token Row (pump.fun movers style) ──
  const [expandedCA, setExpandedCA] = useState(null);
  const [buyingCA, setBuyingCA] = useState(null);
  const [sellingCA, setSellingCA] = useState(null);
  const [flashCA, setFlashCA] = useState(null);

  const handleBuy = async (ca, amt, e) => {
    e?.stopPropagation();
    if (buyingCA) return;
    setBuyingCA(ca + amt);
    const sig = await onQuickApe(ca, amt);
    setBuyingCA(null);
    if (sig) { setFlashCA(ca); setTimeout(() => setFlashCA(null), 1500); }
  };

  const handleSell = async (ca, pct, e) => {
    e?.stopPropagation();
    if (sellingCA) return;
    setSellingCA(ca + pct);
    const sig = await onQuickSell(ca, pct);
    setSellingCA(null);
    if (sig) { setFlashCA(ca); setTimeout(() => setFlashCA(null), 1500); }
  };

  const TokenRow = ({ t, i }) => {
    const isNew = !seenCAs.current.has(t.ca);
    if (isNew) seenCAs.current.add(t.ca);
    const ageStr = t.age ? (t.age >= 24 ? Math.floor(t.age/24) + "d" : Math.round(t.age) + "h") : (t.created ? ago(t.created) : "");
    const held = heldMints?.has(t.ca);
    const flashing = flashCA === t.ca;
    const expanded = expandedCA === t.ca;
    return (
    <div style={{
      borderBottom: "1px solid " + T.border + "22",
      background: flashing ? T.green + "15" : "transparent",
      transition: "background .4s",
    }}>
      {/* Main row — tap to expand buy panel */}
      <div onClick={() => setExpandedCA(expanded ? null : t.ca)} style={{
        display: "flex", alignItems: "center", gap: mobile ? 10 : 12,
        padding: mobile ? "10px 12px" : "12px 16px",
        cursor: "pointer",
      }}>
        {/* Thumbnail */}
        <div style={{ position: "relative", width: mobile ? 48 : 56, height: mobile ? 48 : 56, borderRadius: 10, overflow: "hidden", flexShrink: 0, background: T.bg }}>
          {t.image ? <img src={t.image} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" onError={e => { e.target.style.display = "none"; }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 20, color: T.faint + "55", fontWeight: 900 }}>{(t.ticker || "?")[0]}</div>}
          {t.bundled && <div style={{ position: "absolute", bottom: 1, left: 1, background: "#ff6600cc", color: "#fff", fontFamily: mono, fontSize: 6, fontWeight: 800, padding: "0 2px", borderRadius: 2 }}>B</div>}
        </div>

        {/* Name + ticker + age */}
        <div style={{ minWidth: 0, width: mobile ? 90 : 120, flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: mobile ? 13 : 14, fontWeight: 800, color: T.text, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{t.name || t.ticker}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
            <span style={{ fontFamily: mono, fontSize: mobile ? 10 : 11, color: T.green, fontWeight: 700 }}>{t.ticker}</span>
            {t.twitter && <span style={{ fontSize: 9, color: T.dim }}>{"𝕏"}</span>}
            {ageStr && <span style={{ fontFamily: mono, fontSize: 9, color: T.faint }}>{ageStr}</span>}
          </div>
        </div>

        {/* Mini sparkline chart */}
        <div style={{ flex: 1, height: mobile ? 36 : 44, position: "relative" }}>
          <Sparkline data={t.spark || []} color={t.spark && t.spark.length > 1 && t.spark[t.spark.length - 1] >= t.spark[0] ? T.green : "#ff4444"} height={mobile ? 36 : 44} />
        </div>

        {/* MCap */}
        <div style={{ textAlign: "right", flexShrink: 0, minWidth: mobile ? 60 : 70 }}>
          <div style={{ fontFamily: mono, fontSize: mobile ? 14 : 16, fontWeight: 800, color: t.mcapUsd >= 100000 ? T.green : T.text }}>${fmt(t.mcapUsd)}</div>
          {held && <div style={{ fontFamily: mono, fontSize: 8, color: T.green, marginTop: 1, fontWeight: 700 }}>HELD</div>}
        </div>
      </div>

      {/* Expanded buy/sell panel */}
      {expanded && (
        <div style={{ padding: mobile ? "4px 12px 10px" : "4px 16px 12px", background: T.bg + "88" }}>
          {/* Description */}
          {t.description && <div style={{ fontFamily: sans, fontSize: 11, color: T.dim, marginBottom: 6, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{t.description.slice(0, 80)}</div>}
          {/* Buy buttons */}
          <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
            <span style={{ fontFamily: mono, fontSize: 9, color: T.green, fontWeight: 700, alignSelf: "center", width: 28, flexShrink: 0 }}>BUY</span>
            {onQuickApe && buyAmounts.map(amt => {
              const canAfford = (tradingBalance || 0) >= amt;
              const loading = buyingCA === t.ca + amt;
              return (
                <button key={amt} disabled={!canAfford || loading} onClick={(e) => handleBuy(t.ca, amt, e)} style={{ padding: "8px 0", flex: 1, background: loading ? T.green + "30" : canAfford ? T.green + "0c" : "transparent", border: "1px solid " + (canAfford ? T.green + "44" : T.border + "33"), borderRadius: 8, fontFamily: mono, fontSize: 12, fontWeight: 800, color: canAfford ? T.green : T.faint, cursor: canAfford && !loading ? "pointer" : "default", opacity: canAfford ? 1 : 0.3, transition: "all .15s" }}>{loading ? "..." : amt + " SOL"}</button>
              );
            })}
          </div>
          {/* Sell buttons (only if held) */}
          {held && onQuickSell && (
            <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
              <span style={{ fontFamily: mono, fontSize: 9, color: "#ff4444", fontWeight: 700, alignSelf: "center", width: 28, flexShrink: 0 }}>SELL</span>
              {[25, 50, 100].map(pct => {
                const loading = sellingCA === t.ca + pct;
                return (
                  <button key={pct} disabled={loading} onClick={(e) => handleSell(t.ca, pct, e)} style={{ padding: "8px 0", flex: 1, background: loading ? "#ff444430" : "#ff44440a", border: "1px solid #ff444433", borderRadius: 8, fontFamily: mono, fontSize: 12, fontWeight: 800, color: "#ff4444", cursor: loading ? "default" : "pointer", transition: "all .15s" }}>{loading ? "..." : pct === 100 ? "ALL" : pct + "%"}</button>
                );
              })}
            </div>
          )}
          {/* Action row */}
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <button onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(t.ca); toast?.("CA copied", "success"); }} style={{ padding: "6px 10px", background: "none", border: "1px solid " + T.border + "44", borderRadius: 6, fontFamily: mono, fontSize: 9, color: T.faint, cursor: "pointer" }}>{t.ca?.slice(0, 8)}... copy</button>
            <a href={"https://pump.fun/coin/" + t.ca} target="_blank" rel="noopener" style={{ padding: "6px 10px", border: "1px solid " + T.border + "44", borderRadius: 6, fontFamily: mono, fontSize: 9, color: T.dim, textDecoration: "none" }}>pump</a>
            <button onClick={(e) => { e.stopPropagation(); onApe(t.ca); }} style={{ padding: "6px 10px", background: T.green + "10", border: "1px solid " + T.green + "33", borderRadius: 6, fontFamily: mono, fontSize: 9, fontWeight: 700, color: T.green, cursor: "pointer" }}>Fleet APE</button>
            <div style={{ flex: 1 }} />
            <button onClick={() => setEditingAmounts(!editingAmounts)} style={{ padding: "4px 6px", background: "none", border: "none", fontFamily: mono, fontSize: 9, color: T.faint, cursor: "pointer" }}>{"+"}</button>
          </div>
          {/* Custom amounts editor */}
          {editingAmounts && (
            <div style={{ marginTop: 6, display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ fontFamily: mono, fontSize: 9, color: T.faint }}>Amounts:</span>
              <input value={buyAmounts.join(", ")} onChange={e => {
                const vals = e.target.value.split(",").map(s => parseFloat(s.trim())).filter(n => n > 0 && n <= 100);
                if (vals.length > 0) { setBuyAmounts(vals.slice(0, 5)); localStorage.setItem("bondli_buy_amounts", JSON.stringify(vals.slice(0, 5))); }
              }} style={{ flex: 1, padding: "4px 8px", background: T.bg, border: "1px solid " + T.border, borderRadius: 6, fontFamily: mono, fontSize: 11, color: T.text, outline: "none" }} />
            </div>
          )}
        </div>
      )}
    </div>
    );
  };

  return (
    <div style={{ minHeight: fullScreen ? "calc(100vh - 60px)" : "auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: fullScreen ? "14px 20px" : "10px 14px", borderBottom: "1px solid " + T.border }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.green} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" opacity="0.3"/><circle cx="12" cy="12" r="6" opacity="0.5"/><circle cx="12" cy="12" r="2"/><line x1="12" y1="2" x2="12" y2="6"/></svg>
          <span style={{ fontFamily: mono, fontSize: fullScreen ? 18 : 15, fontWeight: 800, color: T.text }}>Radar</span>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: !enabled ? T.faint : wsAlive ? T.green : T.red, boxShadow: enabled && wsAlive ? "0 0 8px " + T.green : "none" }} />
          {enabled && poolSize > 0 && <span style={{ fontFamily: mono, fontSize: 10, color: T.faint }}>{poolSize} scanned</span>}
          {online > 0 && <span style={{ fontFamily: mono, fontSize: 10, color: T.green, opacity: 0.5 }}><span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: T.green, marginRight: 3, verticalAlign: "middle" }} />{online}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={handleRefresh} disabled={refreshing} style={{ background: "none", border: "1px solid " + T.border, borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontFamily: mono, fontSize: 11, color: T.dim }}><span style={{ display: "inline-block", transition: "transform .5s", transform: refreshing ? "rotate(360deg)" : "none" }}>{"↻"}</span></button>
          <button onClick={handleToggle} style={{ background: enabled ? T.green + "15" : T.red + "15", border: "1px solid " + (enabled ? T.green + "44" : T.red + "44"), borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontFamily: mono, fontSize: 11, fontWeight: 700, color: enabled ? T.green : T.red, transition: "all .2s" }}>{enabled ? "ON" : "OFF"}</button>
        </div>
      </div>

      {/* Tabs + Search */}
      {enabled && !loading && (<>
        <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid " + T.border, padding: "0 4px", overflowX: "auto" }}>
          {TAB_CONFIG.map(tab => {
            const count = (tabs[tab.id] || []).length;
            const isActive = activeTab === tab.id;
            return (<button key={tab.id} onClick={() => { setActiveTab(tab.id); setSelected(null); setSearch(""); setApiSearchResults([]); setExternalResult(null); }} style={{ padding: mobile ? "8px 8px" : "10px 14px", background: "none", border: "none", borderBottom: isActive ? "2px solid " + T.green : "2px solid transparent", fontFamily: mono, fontSize: mobile ? 10 : 12, fontWeight: 700, color: isActive ? T.green : T.dim, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}><span style={{ display: "flex", alignItems: "center" }}>{tab.icon}</span>{tab.label}{count > 0 && <span style={{ fontSize: 9, opacity: 0.7, fontWeight: 800 }}>{count}</span>}</button>);
          })}
          {!mobile && <><div style={{ flex: 1 }} /><input type="text" value={search} onChange={e => { setSearch(e.target.value); setExternalResult(null); }} onKeyDown={e => { if (e.key === "Enter" && search.length >= 32) { handleSelect(search); } }} placeholder={"Search or paste CA..."} style={{ width: 220, padding: "6px 10px", margin: "4px 8px", background: T.bg, border: "1px solid " + T.border, borderRadius: 8, color: T.text, fontFamily: mono, fontSize: 11, outline: "none" }} /></>}
        </div>
        {/* Mobile: full-width search bar */}
        {mobile && (
          <div style={{ padding: "6px 10px", borderBottom: "1px solid " + T.border + "44" }}>
            <input type="text" value={search} onChange={e => { setSearch(e.target.value); setExternalResult(null); }} onKeyDown={e => { if (e.key === "Enter" && search.length >= 32) { handleSelect(search); } }} placeholder={"Search name, ticker, or paste CA..."} style={{ width: "100%", padding: "8px 12px", background: T.bg, border: "1px solid " + T.border, borderRadius: 8, color: T.text, fontFamily: mono, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
          </div>
        )}
      </>)}

      {!enabled ? (
        <div style={{ padding: 60, textAlign: "center" }}><div style={{ fontFamily: mono, fontSize: 15, color: T.faint, marginBottom: 12 }}>Radar paused</div><button onClick={handleToggle} style={{ background: T.green + "15", border: "1px solid " + T.green + "33", borderRadius: 10, padding: "10px 28px", fontFamily: mono, fontSize: 14, fontWeight: 700, color: T.green, cursor: "pointer" }}>Turn On</button></div>
      ) : loading ? (
        <div style={{ padding: 80, textAlign: "center", fontFamily: mono, fontSize: 15, color: T.faint, animation: "pulse 2s infinite" }}><StatusIc.Signal size={14} /> Scanning...</div>
      ) : displayTokens.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center" }}><div style={{ fontFamily: mono, fontSize: 14, color: T.faint }}>No movers yet</div><div style={{ fontFamily: mono, fontSize: 11, color: T.faint, marginTop: 4 }}>{poolSize} tokens scanned{search ? ` — no matches for "${search}"` : ""}</div></div>
      ) : (
        <div>
          {/* Detail panel */}
          {selected && !selected.loading && !selected.error && (
            <div style={{ background: T.bg, border: "2px solid " + T.green + "33", margin: "16px", borderRadius: 16, overflow: "hidden" }}>
              <div style={{ display: "flex", gap: mobile ? 12 : 20, padding: mobile ? 16 : "20px 24px" }}>
                {selected.image ? <img src={selected.image} style={{ width: mobile ? 100 : 150, height: mobile ? 100 : 150, borderRadius: 16, objectFit: "cover", flexShrink: 0, border: "2px solid " + T.border }} alt="" onError={e => e.target.style.display = "none"} /> : <div style={{ width: mobile ? 100 : 150, height: mobile ? 100 : 150, borderRadius: 16, background: T.surface, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 48, color: T.faint, fontWeight: 800 }}>{(selected.ticker || "?")[0]}</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: mono, fontSize: mobile ? 22 : 28, fontWeight: 900, color: T.text }}>{selected.name}</div>
                  <div style={{ fontFamily: mono, fontSize: 16, color: T.green, fontWeight: 700 }}>{selected.ticker}</div>
                  <div style={{ fontFamily: mono, fontSize: 12, color: T.dim, marginTop: 6, lineHeight: 1.5, maxHeight: 54, overflow: "hidden" }}>{selected.description || ""}</div>
                  {selected.creator && <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginTop: 4 }}>dev: {selected.creator.slice(0, 14)}...</div>}
                  <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
                    {selected.twitter && <a href={selected.twitter.startsWith("http") ? selected.twitter : "https://x.com/" + (selected.twitterHandle || "")} target="_blank" rel="noopener" style={{ fontSize: 10, fontFamily: mono, color: "#1DA1F2", background: "#1DA1F218", padding: "3px 8px", borderRadius: 6, textDecoration: "none" }}>"X" {selected.twitterHandle || "twitter"}</a>}
                    {selected.website && <a href={selected.website} target="_blank" rel="noopener" style={{ fontSize: 10, fontFamily: mono, color: selected.websiteLive ? T.green : T.dim, background: T.green + "12", padding: "3px 8px", borderRadius: 6, textDecoration: "none" }}><StatusIc.Globe size={10} /> {selected.websiteLive ? "live" : "site"}</a>}
                    {selected.telegram && <a href={selected.telegram.startsWith("http") ? selected.telegram : "https://t.me/" + selected.telegram} target="_blank" rel="noopener" style={{ fontSize: 10, fontFamily: mono, color: "#229ED9", background: "#229ED918", padding: "3px 8px", borderRadius: 6, textDecoration: "none" }}>{"\u2708"} TG</a>}
                  </div>
                  {selected.bundleScore > 0 && <div style={{ marginTop: 6, fontSize: 10, fontFamily: mono, color: selected.bundled ? "#ff6600" : "#ffaa00", background: (selected.bundled ? "#ff6600" : "#ffaa00") + "10", padding: "4px 8px", borderRadius: 6 }}>{selected.bundled ? "! BUNDLED" : "! Bundle risk"} ({selected.bundleScore}/100){selected.bundleFlags?.length > 0 ? " — " + selected.bundleFlags.join(", ") : ""}</div>}
                  {selected.imageDupe && <div style={{ marginTop: 4, fontSize: 10, fontFamily: mono, color: T.red, background: T.red + "10", padding: "4px 8px", borderRadius: 6 }}><StatusIc.Warn size={10} /> Reused image</div>}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr", gap: 1, background: T.border + "33", margin: "0 16px" }}>
                {[{ k: "MCap", v: selected.mcap ? "$" + fmt(selected.mcap) : "\u2014", c: T.green }, { k: "Bonded", v: (selected.bp || 0).toFixed(1) + "%", c: selected.bp > 20 ? T.green : T.faint }, { k: "Buys", v: String(selected.buys || 0), c: T.green }, { k: "Sells", v: String(selected.sells || 0), c: "#ff4444" }, { k: "Volume", v: (selected.solVol || 0).toFixed(1) + " SOL", c: T.green }, { k: "Replies", v: String(selected.replies || 0), c: T.dim }].map(s => (<div key={s.k} style={{ background: T.surface, padding: "10px 6px", textAlign: "center" }}><div style={{ fontSize: 15, fontFamily: mono, fontWeight: 800, color: s.c }}>{s.v}</div><div style={{ fontSize: 9, color: T.faint, fontFamily: mono, marginTop: 2 }}>{s.k}</div></div>))}
              </div>
              {selected.bp > 0 && <div style={{ height: 4, background: T.border, margin: "8px 16px 0", borderRadius: 2 }}><div style={{ height: 4, background: selected.bp >= 80 ? "#ffaa00" : T.green, width: Math.min(100, selected.bp) + "%", borderRadius: 2 }} /></div>}
              <div style={{ margin: "10px 16px 0", borderRadius: 10, overflow: "hidden", border: "1px solid " + T.border }}><PriceChart trades={[]} mobile={true} T={T} ca={selected.ca} /></div>
              <div onClick={() => { navigator.clipboard?.writeText(selected.ca); }} style={{ margin: "10px 16px", background: T.surface, borderRadius: 8, padding: "8px 12px", fontFamily: mono, fontSize: 11, color: T.faint, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.ca} <span style={{ color: T.dim }}><StatusIc.Copy size={10} /> copy</span></div>
              <div style={{ display: "flex", gap: 5, padding: "0 16px 6px", flexWrap: "wrap" }}>
                <span style={{ fontFamily: mono, fontSize: 9, color: T.green, fontWeight: 700, alignSelf: "center", marginRight: 2 }}>BUY</span>
                {onQuickApe && [0.05, 0.1, 0.25, 0.5, 1].map(amt => {
                  const canAfford = (tradingBalance || 0) >= amt;
                  return (
                    <button key={amt} disabled={!canAfford} onClick={(e) => { e.stopPropagation(); onQuickApe(selected.ca, amt); }} style={{ padding: "8px 0", flex: 1, minWidth: 44, background: canAfford ? T.green + "12" : T.border + "22", border: "1px solid " + (canAfford ? T.green + "44" : T.border), borderRadius: 8, fontFamily: mono, fontSize: 11, fontWeight: 800, color: canAfford ? T.green : T.faint, cursor: canAfford ? "pointer" : "not-allowed", opacity: canAfford ? 1 : 0.4, transition: "all .15s" }}>{amt}</button>
                  );
                })}
              </div>
              {onQuickSell && heldMints?.has(selected?.ca) && (
                <div style={{ display: "flex", gap: 5, padding: "0 16px 8px", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: mono, fontSize: 9, color: "#ff4444", fontWeight: 700, alignSelf: "center", marginRight: 2 }}>SELL</span>
                  {[25, 50, 100].map(pct => (
                    <button key={pct} onClick={(e) => { e.stopPropagation(); onQuickSell(selected.ca, pct); }} style={{ padding: "8px 0", flex: 1, background: pct === 100 ? "#ff444418" : "#ff444408", border: "1px solid " + (pct === 100 ? "#ff444466" : "#ff444433"), borderRadius: 8, fontFamily: mono, fontSize: 11, fontWeight: 800, color: pct === 100 ? "#ff4444" : "#ff6666", cursor: "pointer" }}>{pct === 100 ? "Sell All" : pct + "%"}</button>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, padding: "0 16px 16px" }}>
                <button onClick={(e) => { e.stopPropagation(); onApe(selected.ca); setSelected(null); }} style={{ flex: 1, padding: "12px", background: T.surface, border: "1px solid " + T.green, borderRadius: 12, fontFamily: mono, fontSize: 13, fontWeight: 800, color: T.green, cursor: "pointer" }}><Ic.Cpu /> Fleet APE</button>
                <a href={"https://pump.fun/coin/" + selected.ca} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ padding: "12px 14px", border: "1px solid " + T.border, borderRadius: 12, fontFamily: mono, fontSize: 11, color: T.dim, textDecoration: "none", display: "flex", alignItems: "center" }}>pump {"→"}</a>
                <a href={selected.dexUrl || ("https://dexscreener.com/solana/" + selected.ca)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ padding: "12px 14px", border: "1px solid " + T.border, borderRadius: 12, fontFamily: mono, fontSize: 11, color: T.dim, textDecoration: "none", display: "flex", alignItems: "center" }}>dex {"→"}</a>
                <button onClick={(e) => { e.stopPropagation(); setSelected(null); }} style={{ padding: "12px 14px", background: "none", border: "1px solid " + T.border, borderRadius: 12, fontFamily: mono, fontSize: 14, color: T.faint, cursor: "pointer" }}>{"✕"}</button>
              </div>
            </div>
          )}
          {selected?.loading && <div style={{ padding: 40, textAlign: "center", fontFamily: mono, fontSize: 14, color: T.dim, animation: "pulse 1s infinite" }}>Loading...</div>}
          {selected?.error && <div style={{ padding: "14px 16px", margin: "10px 16px", background: T.red + "10", borderRadius: 12, fontFamily: mono, fontSize: 12, color: T.red, display: "flex", justifyContent: "space-between" }}><span>{selected.error}</span><button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: T.red, cursor: "pointer" }}>{"✕"}</button></div>}

          {/* Token List */}
          <div>
            {displayTokens.map((t, i) => <TokenRow key={t.ca} t={t} i={i} />)}
          </div>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════
// REFERRAL PANEL
// ═══════════════════════════════════════
// ═══════════════════════════════════════
// PORTFOLIO — Live positions with P&L + sell buttons + search
// ═══════════════════════════════════════
function PortfolioPanel({ T, mobile, mono, user, quickSell, quickApe, toast, tradingBalance, recentBuys, onPositionsUpdate, getCostBasis, onApe }) {
  const [positions, setPositions] = useState([]);
  const [solBal, setSolBal] = useState(tradingBalance || 0);
  const [totalVal, setTotalVal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selling, setSelling] = useState(null);
  const [sellingAll, setSellingAll] = useState(false);

  const API = window.__BONDLI_API;
  const fmt = n => !n || n === 0 ? "$0" : n >= 1e6 ? "$" + (n/1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + (n/1e3).toFixed(1) + "K" : "$" + n.toFixed(2);

  const fetchPositions = async () => {
    try {
      const r = await fetch(API + "/api/positions/" + user.pubkey);
      if (r.ok) {
        const d = await r.json();
        setPositions(d.positions || []);
        if (onPositionsUpdate) onPositionsUpdate(d.positions || []);
        setSolBal(d.solBalance || 0);
        setTotalVal(d.totalValueUsd || 0);
        setLoading(false);
      }
    } catch { setLoading(false); }
  };

  useEffect(() => {
    if (!user?.pubkey) return;
    fetchPositions();
    const iv = setInterval(fetchPositions, 5000); // 5s — axiomatic: balance must always be accurate
    return () => clearInterval(iv);
  }, [user?.pubkey]);

  useEffect(() => {
    if (search.length < 2) { setSearchResults([]); return; }
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(API + "/api/search?q=" + encodeURIComponent(search));
        if (r.ok) { const d = await r.json(); setSearchResults(d.results || []); }
      } catch {}
      setSearching(false);
    }, 400);
    return () => clearTimeout(timeout);
  }, [search]);

  const handleSell = async (ca, pct) => {
    setSelling(ca + pct);
    await quickSell(ca, pct);
    setSelling(null);
    setTimeout(fetchPositions, 3000);
  };

  const handleSellAll = async () => {
    if (positions.length === 0) return;
    setSellingAll(true);
    toast("Selling all positions...", "info");
    try {
      const r = await fetch(API + "/api/sell-all", { method: "POST", headers: { "Content-Type": "application/json", "x-wallet": user.pubkey }, body: JSON.stringify({ wallet: user.pubkey }) });
      const d = await r.json();
      toast(d.ok ? `Sold ${d.sold}/${d.total} positions` : (d.error || "Failed"), d.ok ? "success" : "error");
      setTimeout(fetchPositions, 3000);
    } catch { toast("Network error", "error"); }
    setSellingAll(false);
  };

  return (
    <div style={{ background: T.surface, border: "1px solid " + T.border, borderRadius: 14, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid " + T.border }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 900, color: T.text }}>{fmt(totalVal)}</div>
            <div style={{ fontFamily: mono, fontSize: 12, color: T.faint }}>{solBal.toFixed(3)} SOL {"·"} {positions.length} bag{positions.length !== 1 ? "s" : ""}</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={fetchPositions} style={{ background: "none", border: "1px solid " + T.border, borderRadius: 8, padding: "6px 10px", fontFamily: mono, fontSize: 10, color: T.dim, cursor: "pointer" }}>"Refresh"</button>
            {positions.length > 0 && <button onClick={handleSellAll} disabled={sellingAll} style={{ background: "#ff444415", border: "1px solid #ff444444", borderRadius: 8, padding: "6px 12px", fontFamily: mono, fontSize: 10, fontWeight: 800, color: "#ff4444", cursor: sellingAll ? "wait" : "pointer", opacity: sellingAll ? 0.5 : 1 }}>{sellingAll ? "Selling..." : "Close All"}</button>}
          </div>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={"Search any token..."} style={{ width: "100%", padding: "10px 14px", background: T.bg, border: "1px solid " + T.border, borderRadius: 10, color: T.text, fontFamily: mono, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
      </div>

      {/* Search Results */}
      {search.length >= 2 && (
        <div style={{ borderBottom: "1px solid " + T.border, maxHeight: 300, overflow: "auto" }}>
          {searching && <div style={{ padding: 16, textAlign: "center", fontFamily: mono, fontSize: 12, color: T.dim }}>Searching...</div>}
          {!searching && searchResults.length === 0 && search.length >= 2 && <div style={{ padding: 16, textAlign: "center", fontFamily: mono, fontSize: 12, color: T.faint }}>No results</div>}
          {searchResults.map(t => (
            <div key={t.ca} onClick={() => { if (onApe) { onApe(t.ca); setSearch(""); } }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", borderBottom: "1px solid " + T.border + "22", cursor: "pointer", transition: "background .15s" }} onMouseEnter={e => e.currentTarget.style.background = T.greenGhost} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              {t.image ? <img src={t.image} style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} alt="" onError={e => e.target.style.display = "none"} /> : <div style={{ width: 32, height: 32, borderRadius: 8, background: T.border + "44", flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 800, color: T.text }}>{t.name} <span style={{ color: T.green, fontSize: 11 }}>{t.ticker}</span></div>
                <div style={{ fontFamily: mono, fontSize: 10, color: T.faint }}>MC {fmt(t.mcap)}{t.h1Change ? (t.h1Change > 0 ? " +" : " ") + t.h1Change.toFixed(1) + "%" : ""}</div>
              </div>
              <div style={{ display: "flex", gap: 3, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                <button onClick={() => { navigator.clipboard?.writeText(t.ca); toast("CA copied", "success"); }} style={{ padding: "6px 8px", background: "none", border: "1px solid " + T.border, borderRadius: 6, fontFamily: mono, fontSize: 9, color: T.faint, cursor: "pointer" }}>CA</button>
                {[0.1, 0.25, 0.5].map(amt => (
                  <button key={amt} disabled={solBal < amt} onClick={() => quickApe(t.ca, amt)} style={{ padding: "6px 8px", background: solBal >= amt ? T.green + "12" : T.border + "22", border: "1px solid " + (solBal >= amt ? T.green + "33" : T.border), borderRadius: 6, fontFamily: mono, fontSize: 10, fontWeight: 800, color: solBal >= amt ? T.green : T.faint, cursor: solBal >= amt ? "pointer" : "not-allowed", opacity: solBal >= amt ? 1 : 0.4 }}>{amt}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Positions */}
      {loading ? (
        <div style={{ padding: 40, textAlign: "center", fontFamily: mono, fontSize: 14, color: T.dim, animation: "pulse 1.5s infinite" }}>Scanning wallets...</div>
      ) : positions.length === 0 && (!recentBuys || recentBuys.length === 0) && search.length < 2 ? (
        <div style={{ padding: "40px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}><StatusIc.Bag size={28} /></div>
          <div style={{ fontFamily: mono, fontSize: 14, color: T.faint, marginBottom: 4 }}>No bags yet</div>
          <div style={{ fontFamily: mono, fontSize: 12, color: T.faint }}>Buy from Radar {"→"} bags show here with live P&L</div>
        </div>
      ) : (
        <div>
          {/* Pending buys — show immediately before on-chain scan picks them up */}
          {(recentBuys || []).filter(b => !positions.some(p => p.mint === b.ca)).map(b => (
            <div key={b.ca} style={{ padding: "12px 20px", borderBottom: "1px solid " + T.border + "33", opacity: 0.7 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: T.green + "15", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 10, color: T.green, fontWeight: 800 }}>NEW</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: T.text }}>{b.ca.slice(0, 12)}...</div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: T.faint }}>Bought {b.sol} SOL — confirming...</div>
                </div>
                <div style={{ fontFamily: mono, fontSize: 12, color: T.green, fontWeight: 700, animation: "pulse 1.5s infinite" }}>{b.sol} SOL</div>
              </div>
            </div>
          ))}
          {positions.map(p => {
            const isUp = (p.h1Change || 0) >= 0;
            return (
              <div key={p.mint} style={{ padding: "14px 20px", borderBottom: "1px solid " + T.border + "33" }}>
                <div style={{ display: "flex", alignItems: "center", gap: mobile ? 8 : 12 }}>
                  {p.image ? <img src={p.image} style={{ width: 42, height: 42, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} alt="" onError={e => e.target.style.display="none"} /> : <div style={{ width: 42, height: 42, borderRadius: 10, background: T.border + "44", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 18, color: T.faint }}>{(p.ticker || "?")[0]}</div>}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 800, color: T.text }}>{p.ticker || "?"}</span>
                      <span style={{ fontFamily: mono, fontSize: 11, color: isUp ? T.green : "#ff4444", fontWeight: 700, background: (isUp ? T.green : "#ff4444") + "12", padding: "1px 5px", borderRadius: 4 }}>{isUp ? "▲" : "▼"}{Math.abs(p.h1Change || 0).toFixed(1)}%</span>
                    </div>
                    <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, marginTop: 3 }}>
                      {p.amount?.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens {"·"} {fmt(p.valueUsd || 0)} {"·"} MC {fmt(p.mcap || 0)}
                    </div>
                  </div>

                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 900, color: isUp ? T.green : "#ff4444" }}>
                      {fmt(p.valueUsd || 0)}
                    </div>
                    {(() => {
                      const basis = getCostBasis?.(p.mint);
                      if (!basis) return null;
                      const costSol = basis.totalSol;
                      const currentSol = p.valueSol || 0;
                      const pnlSol = currentSol - costSol;
                      const pnlPct = costSol > 0 ? ((currentSol / costSol) - 1) * 100 : 0;
                      const isProfit = pnlSol >= 0;
                      return (
                        <div style={{ fontFamily: mono, fontSize: 10, color: isProfit ? T.green : "#ff4444", marginTop: 2 }}>
                          {isProfit ? "+" : ""}{pnlSol.toFixed(3)} SOL ({isProfit ? "+" : ""}{pnlPct.toFixed(1)}%)
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: "flex", gap: 4, marginTop: 8, marginLeft: mobile ? 0 : 54 }}>
                  {[25, 50, 100].map(pct => {
                    const isSelling = selling === (p.mint + pct);
                    return (
                      <button key={pct} disabled={isSelling} onClick={() => handleSell(p.mint, pct)} style={{
                        padding: "6px 12px", flex: pct === 100 ? 2 : 1,
                        background: pct === 100 ? "#ff444418" : "#ff444408",
                        border: "1px solid " + (pct === 100 ? "#ff444466" : "#ff444433"),
                        borderRadius: 8, fontFamily: mono, fontSize: 11, fontWeight: 800,
                        color: pct === 100 ? "#ff4444" : "#ff6666",
                        cursor: isSelling ? "wait" : "pointer", opacity: isSelling ? 0.5 : 1,
                      }}>{isSelling ? "..." : pct === 100 ? "Sell All" : "Sell " + pct + "%"}</button>
                    );
                  })}
                  {p.valueUsd > 0 && <button onClick={() => { navigator.clipboard?.writeText(p.mint); toast("CA copied", "success"); }} style={{ padding: "6px 8px", background: "none", border: "1px solid " + T.border, borderRadius: 8, fontFamily: mono, fontSize: 9, color: T.faint, cursor: "pointer" }}>CA</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReferralPanel({ user, T, mobile }) {
  const [refData, setRefData] = useState(null);
  const [refInput, setRefInput] = useState("");
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!user?.pubkey) return;
    fetch(window.__BONDLI_API + "/api/referral/" + user.pubkey).then(r => r.json()).then(d => setRefData(d)).catch(() => {});
    // Check URL for ref param
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) setRefInput(ref);
  }, [user?.pubkey]);

  const applyRef = async () => {
    if (!refInput || applying) return;
    setApplying(true); setMsg("");
    try {
      const r = await fetch(window.__BONDLI_API + "/api/referral/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: user?.pubkey, refCode: refInput }) });
      const d = await r.json();
      if (d.ok) { setMsg("Referral applied!"); setRefData(prev => ({ ...prev })); }
      else setMsg(d.error || "Invalid code");
    } catch { setMsg("Error"); }
    setApplying(false);
  };

  const shareUrl = refData?.referralCode ? window.location.origin + "?ref=" + refData.referralCode : "";

  return (
    <div style={{ background: T.surface, border: "1px solid " + T.border, borderRadius: 14, padding: mobile ? 14 : 18 }}>
      <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 10 }}><Ic.Users /> Referrals</div>
      {refData?.referralCode ? (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1, background: T.bg, border: "1px solid " + T.border, borderRadius: 8, padding: "8px 12px", fontFamily: "monospace", fontSize: 13, color: T.green, fontWeight: 800 }}>{refData.referralCode}</div>
            <button onClick={() => { navigator.clipboard?.writeText(shareUrl); setMsg("Link copied!"); setTimeout(() => setMsg(""), 2000); }} style={{ background: T.green + "15", border: "1px solid " + T.green + "33", borderRadius: 8, padding: "8px 12px", fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: T.green, cursor: "pointer", flexShrink: 0 }}><StatusIc.Copy size={12} /> Copy Link</button>
          </div>
          <div style={{ display: "flex", gap: 12, fontFamily: "monospace", fontSize: 11, color: T.dim }}>
            <span>Referrals: <span style={{ color: T.green, fontWeight: 800 }}>{refData.referralCount || 0}</span></span>
            <span>Earned: <span style={{ color: T.green, fontWeight: 800 }}>{(refData.referralEarnings || 0).toFixed(4)} SOL</span></span>
          </div>
        </div>
      ) : (
        <div style={{ fontFamily: "monospace", fontSize: 11, color: T.dim }}>Loading...</div>
      )}
      {/* Apply someone else's referral */}
      <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
        <input value={refInput} onChange={e => setRefInput(e.target.value)} placeholder="Enter referral code..." style={{ flex: 1, padding: "8px 10px", background: T.bg, border: "1px solid " + T.border, borderRadius: 8, color: T.text, fontFamily: "monospace", fontSize: 12, outline: "none" }} />
        <button onClick={applyRef} disabled={applying} style={{ background: T.green + "15", border: "1px solid " + T.green + "33", borderRadius: 8, padding: "8px 12px", fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: T.green, cursor: applying ? "wait" : "pointer" }}>{applying ? "..." : "Apply"}</button>
      </div>
      {msg && <div style={{ marginTop: 6, fontFamily: "monospace", fontSize: 11, color: msg.includes("!") ? T.green : T.red }}>{msg}</div>}
    </div>
  );
}

function calcDevBuyPreview(totalSol, isApe) {
  if (isApe) return { devBuy: 0, creationFee: 0, fleet: +totalSol.toFixed(4), pct: 0 };
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
  const [fleetKeys, setFleetKeys] = useState([]);
  const [showKeys, setShowKeys] = useState(false);
  const [tokenCA, setTokenCA] = useState("");
  const [launchStatus, setLaunchStatus] = useState("");
  const [txSig, setTxSig] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const isApe = !!(tokenConfig?.existingCA);
  const preview = calcDevBuyPreview(totalSol, isApe);
  const pollRef = useRef(null);

  const copyText = (text) => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── STEP 1: Generate dev wallet ──
  const [batchResults, setBatchResults] = useState([]);
  const [batchRunning, setBatchRunning] = useState(false);

  const startBatchDeploy = async () => {
    setError(""); setBatchResults([]); setBatchRunning(true); setStep("launching");
    setLaunchStatus("Batch deploying " + (fleetConfig?.batchCount || 1) + " tokens...");
    try {
      const res = await fetch(API + "/api/batch-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Wallet": user?.pubkey },
        body: JSON.stringify({
          wallet: user?.pubkey,
          count: fleetConfig?.batchCount || 1,
          tokenConfig,
          masterSeed: masterSeed || "",
          jitoTip: fleetConfig?.jitoTip || 0.001,
          delayMs: (fleetConfig?.batchDelay || 5) * 1000,
        }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); setStep("idle"); setBatchRunning(false); return; }
      setBatchResults(data.results || []);
      setStep("batch_done");
      // Set the first successful CA as the launchCA
      const firstOk = (data.results || []).find(r => r.ok);
      if (firstOk) { setTokenCA(firstOk.ca); onLaunched({ tokenCA: firstOk.ca, pumpUrl: firstOk.pumpUrl, sessionId: "" }); }
    } catch (e) { setError("Batch failed: " + (e.message || "")); setStep("idle"); }
    setBatchRunning(false);
  };

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
      if (data.walletKeys) setFleetKeys(data.walletKeys);
      // If master wallet used, skip deposit — go straight to launch
      if (data.useMaster && data.funded) { setStep("launching"); executeLaunch(data); return; }
      setStep("awaiting");
    } catch (e) { setError(e.message?.includes("NetworkError") || e.message?.includes("fetch") ? "Server unreachable — check if backend is running at " + API : "Failed: " + (e.message || "")); setStep("idle"); }
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
      if (data.walletKeys && data.walletKeys.length > 0) setFleetKeys(data.walletKeys);
      setSession(prev => ({ ...prev, tokenCA: ca, pumpUrl: data.pumpUrl }));
      setStep("live");
      if (ca) onLaunched({ ...data, tokenCA: ca });
    } catch (e) { setError("Launch failed: " + (e.message || "")); setStep("awaiting"); }
  };

  const KeyBox = () => (devSecret || fleetKeys.length > 0) ? (
    <div style={{ padding: "12px 14px", background: T.yellow + "08", borderRadius: 10, border: "1px solid " + T.yellow + "28", marginBottom: 12 }}>
      {devSecret && (<>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 14 }}><StatusIc.Key size={14} /></span>
          <span style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, color: T.yellow, textTransform: "uppercase" }}>Creator Private Key</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div style={{ flex: 1, fontFamily: mono, fontSize: 10, color: T.mid, wordBreak: "break-all", lineHeight: 1.4, background: T.bg, padding: "6px 8px", borderRadius: 6, border: "1px solid " + T.border, maxHeight: 44, overflow: "auto" }}>{devSecret}</div>
          <button onClick={() => copyText(devSecret)} style={{ background: T.yellow, border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontFamily: mono, fontSize: 11, fontWeight: 700, color: T.bg, flexShrink: 0 }}>{copied ? "✓" : "Copy"}</button>
        </div>
        <p style={{ fontSize: 10, color: T.yellow, fontFamily: "system-ui,sans-serif", marginTop: 2, marginBottom: 8, opacity: 0.8 }}>Import into Phantom for creator fees (0.5%)</p>
      </>)}
      {fleetKeys.length > 0 && (<>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: showKeys ? 8 : 0 }}>
          <span style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, color: T.red, textTransform: "uppercase" }}><StatusIc.Warn size={10} /> Fleet Wallet Keys ({fleetKeys.length})</span>
          <button onClick={() => setShowKeys(!showKeys)} style={{ background: "none", border: "1px solid " + T.red + "44", borderRadius: 6, padding: "3px 8px", color: T.red, fontFamily: mono, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>{showKeys ? "Hide" : "Show Keys"}</button>
        </div>
        {showKeys && (<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {fleetKeys.map((k, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", background: T.bg, borderRadius: 6, border: "1px solid " + T.border }}>
            <span style={{ fontFamily: mono, fontSize: 10, color: T.faint, width: 65, textTransform: "capitalize", flexShrink: 0 }}>{k.role}</span>
            <span style={{ fontFamily: mono, fontSize: 9, color: T.mid, flex: 1, wordBreak: "break-all", lineHeight: 1.3 }}>{k.secret}</span>
            <button onClick={() => { navigator.clipboard?.writeText(k.secret); setCopied(k.role); }} style={{ background: T.red + "20", border: "none", borderRadius: 4, padding: "2px 6px", color: T.red, fontFamily: mono, fontSize: 9, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>Copy</button>
          </div>))}
          <button onClick={() => { const all = fleetKeys.map(k => k.role + ": " + k.secret).join("\n"); navigator.clipboard?.writeText(all); setCopied("all"); }} style={{ background: T.red + "15", border: "1px solid " + T.red + "33", borderRadius: 6, padding: "6px", color: T.red, fontFamily: mono, fontSize: 11, fontWeight: 700, cursor: "pointer", marginTop: 4 }}>Copy All Keys</button>
          <p style={{ fontSize: 9, color: T.red, fontFamily: "system-ui,sans-serif", opacity: 0.8, marginTop: 2 }}>SAVE THESE — import into Phantom to manually recover SOL if anything goes wrong</p>
        </div>)}
      </>)}
    </div>
  ) : null;

  const dw = session?.devWallet || "";

  // ═══════════════ LIVE — parent handles full dashboard ═══════════════
  if (step === "live" || (launched && tokenCA)) {
    return null; // parent App renders the full live dashboard with fleet wallets, trade feed, controls
  }

  // ═══════════════ LAUNCHING — progress ═══════════════
  if (step === "launching") {
    return (
      <div style={{ background: T.surface, border: "2px solid " + T.green + "44", borderRadius: 16, padding: mobile ? 20 : 28, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 14, animation: "pulse 1s infinite" }}><StatusIc.Rocket size={28} /></div>
        <div style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: T.green, marginBottom: 8 }}>{isApe ? "Starting fleet on existing token" : "Creating token on pump.fun"}</div>
        <div style={{ fontFamily: mono, fontSize: 12, color: T.dim, marginBottom: 16 }}>{launchStatus}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 260, margin: "0 auto", textAlign: "left" }}>
          {(isApe ? ["Connect to token", "Fund fleet wallets", "Sign & send", "Start trading"] : ["Upload metadata", "Generate mint", "Build transaction", "Sign & send", "Confirm on-chain"]).map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: mono, fontSize: 11 }}>
              <span style={{ color: T.faint, animation: "pulse 1.5s infinite" }}><span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:"currentColor"}}/></span>
              <span style={{ color: T.dim }}>{s}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: T.faint, fontFamily: mono, marginTop: 14 }}>15-45 seconds...</div>
      </div>
    );
  }

  // ═══════════════ BATCH DONE — show all deployed tokens ═══════════════
  if (step === "batch_done" && batchResults.length > 0) {
    return (
      <div style={{ background: T.surface, border: "2px solid " + T.green + "44", borderRadius: 16, padding: mobile ? 16 : 24 }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}><span style={{color:"#00e676",fontSize:24}}>OK</span></div>
          <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: T.green }}>{batchResults.filter(r => r.ok).length}/{batchResults.length} Deployed</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 400, overflow: "auto" }}>
          {batchResults.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: T.bg, borderRadius: 8, border: "1px solid " + (r.ok ? T.green : T.red) + "22" }}>
              <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: r.ok ? T.green : T.red, width: 20 }}>{r.index}</span>
              {r.ok ? (<>
                <a href={r.pumpUrl} target="_blank" rel="noopener" style={{ fontFamily: mono, fontSize: 11, color: T.green, flex: 1, textDecoration: "none" }}>{r.ca?.slice(0, 12)}...</a>
                <button onClick={() => { navigator.clipboard?.writeText(r.ca); }} style={{ background: "none", border: "1px solid " + T.border, borderRadius: 4, padding: "2px 6px", fontFamily: mono, fontSize: 9, color: T.mid, cursor: "pointer" }}>CA</button>
                <a href={r.pumpUrl} target="_blank" rel="noopener" style={{ fontSize: 10, color: T.green, textDecoration: "none" }}>{"→"}</a>
              </>) : (
                <span style={{ fontFamily: mono, fontSize: 10, color: T.red, flex: 1 }}>{r.error?.slice(0, 60)}</span>
              )}
            </div>
          ))}
        </div>
        <button onClick={() => { setStep("idle"); setBatchResults([]); }} style={{ width: "100%", marginTop: 12, padding: "12px", background: T.green, color: T.bg, border: "none", borderRadius: 10, fontFamily: mono, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Deploy More</button>
      </div>
    );
  }

  // ═══════════════ IDLE + AWAITING ═══════════════
  return (
    <div style={{ marginTop: 8 }}>
      {error && (
        <div style={{ fontSize: 12, color: T.red, fontFamily: mono, marginBottom: 12, padding: "10px 14px", background: T.redGhost, borderRadius: 10, border: "1px solid " + T.red + "22", display: "flex", alignItems: "flex-start", gap: 8, maxHeight: 200, overflow: "auto" }}>
          <span style={{ flex: 1, wordBreak: "break-all", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{error}</span>
          <button onClick={() => setError("")} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 14, padding: 0, flexShrink: 0 }}>{"✕"}</button>
        </div>
      )}

      {/* BUDGET */}
      {isApe ? (
        <div style={{ padding: "8px 0", marginBottom: 12, textAlign: "center", fontFamily: mono, fontSize: 12, color: T.dim }}>
          <span style={{ color: T.green, fontWeight: 700 }}>{totalSol} SOL</span> fleet budget
        </div>
      ) : (
        <div style={{ padding: "8px 0", marginBottom: 12, display: "flex", justifyContent: "center", gap: mobile ? 12 : 20, fontFamily: mono, fontSize: 12, color: T.dim }}>
          {fleetConfig?.deployOnly ? (<span style={{ color: T.yellow }}><StatusIc.Warn size={10} /> Deploy only — <span style={{ fontWeight: 700 }}>0.02 SOL</span> creation fee, no buy</span>) : (<>
          <span><span style={{ color: T.yellow, fontWeight: 700 }}>{preview.devBuy}</span> dev buy</span>
          <span style={{ color: T.border }}>{"·"}</span>
          <span><span style={{ color: T.dim, fontWeight: 700 }}>{preview.creationFee}</span> fee</span>
          <span style={{ color: T.border }}>{"·"}</span>
          <span><span style={{ color: T.green, fontWeight: 700 }}>{preview.fleet}</span> fleet</span>
          </>)}
        </div>
      )}

      {step === "idle" && (
        <Btn onClick={fleetConfig?.deployOnly && fleetConfig?.batchCount > 1 ? startBatchDeploy : startLaunch} full disabled={!canLaunch}
          style={{ padding: "16px 24px", fontSize: mobile ? 16 : 18, borderRadius: 14, animation: canLaunch ? "glow 3s infinite" : "none" }}>
          <Ic.Zap /> {isApe ? "Start Trading" : fleetConfig?.deployOnly ? (fleetConfig?.batchCount > 1 ? "Deploy " + fleetConfig.batchCount + " Tokens" : "Deploy on pump.fun") : "Launch on pump.fun"}
        </Btn>
      )}

      {step === "generating" && <div style={{ textAlign: "center", padding: 16 }}><div style={{ fontFamily: mono, color: T.dim, animation: "pulse 1.5s infinite" }}>Generating dev wallet...</div></div>}

      {step === "awaiting" && session && (
        <div style={{ background: T.surface, border: "2px solid " + T.green + "33", borderRadius: 14, padding: mobile ? 14 : 20 }}>
          <KeyBox />

          <div style={{ padding: "10px 12px", background: T.bg, borderRadius: 8, border: "1px dashed " + T.border, marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: T.faint, fontFamily: mono, marginBottom: 3, textTransform: "uppercase" }}>Send {totalSol} SOL to</div>
            <div style={{ fontFamily: mono, fontSize: mobile ? 11 : 13, color: T.green, fontWeight: 600, wordBreak: "break-all", cursor: "pointer" }} onClick={() => copyText(dw)}>{dw} <span style={{ color: T.faint, fontSize: 10 }}>{copied ? "✓" : "copy"}</span></div>
          </div>

          <Btn onClick={openPhantomSend} full style={{ borderRadius: 10, background: "linear-gradient(135deg, #534bb1, #551bf9)", marginBottom: 8 }}>
            {/iPhone|iPad|Android/i.test(navigator.userAgent) ? "Open Phantom" : "Copy & Send " + totalSol + " SOL"}
          </Btn>

          <p style={{ textAlign: "center", fontFamily: mono, fontSize: 11, color: T.dim, marginBottom: 8 }}>2022 Auto-detect + auto-launch after deposit</p>

          <div style={{ display: "flex", gap: 6, paddingTop: 8, borderTop: "1px solid " + T.border }}>
            <div style={{ flex: 1 }}><Input value={txSig} onChange={setTxSig} placeholder="or paste tx sig..." /></div>
            <Btn onClick={manualVerify} small disabled={!txSig} ghost color={T.green}>Go</Btn>
          </div>

          {/* Cancel deploy — go back to idle, discard session */}
          <button onClick={() => { if (pollRef.current) clearInterval(pollRef.current); setStep("idle"); setSession(null); setError(""); setDevSecret(""); setFleetKeys([]); }} style={{ width: "100%", marginTop: 10, padding: "10px", background: T.red + "10", border: "1px solid " + T.red + "33", borderRadius: 10, fontFamily: mono, fontSize: 13, fontWeight: 700, color: T.red, cursor: "pointer" }}>{"✕"} Cancel Deploy</button>
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
        <span style={{ fontSize: mobile ? 24 : 30, display: "flex", alignItems: "center", justifyContent: "center" }}><RoleIcon role={role.id} size={mobile ? 24 : 30} color={ROLE_COLORS(T)[role.id] || T.dim} /></span>
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
        {status === "closed" && <Btn onClick={handleReset} small full color={T.dim} ghost>"Refresh" Reset</Btn>}
      </div>
    </div>
  );
}
function ImageUpload({ image, onChange, mobile }) { const T = useTheme(); const ref = useRef(null); const read = (f) => { const r = new FileReader(); r.onload = () => onChange(r.result); r.readAsDataURL(f); }; return (<div onClick={() => ref.current?.click()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) read(e.dataTransfer.files[0]); }} onDragOver={e => e.preventDefault()} style={{ width: mobile ? 110 : 140, height: mobile ? 110 : 140, borderRadius: 14, border: "2px dashed " + (image ? T.green + "44" : T.border), background: image ? "url(" + image + ") center/cover" : T.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", flexShrink: 0, position: "relative" }}>{!image && <><span style={{ color: T.dim }}><Ic.Upload /></span><span style={{ fontSize: 11, color: T.faint, fontFamily: mono }}>512{"\u00D7"}512</span></>}{image && <div style={{ position: "absolute", bottom: 6, right: 6, width: 22, height: 22, borderRadius: 6, background: T.green, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><Ic.Check /></div>}<input ref={ref} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { if (e.target.files?.[0]) read(e.target.files[0]); }} /></div>); }
function BondingCurve({ progress = 0 }) { const T = useTheme(); const w = 340, h = 80; const pts = Array.from({ length: 50 }, (_, i) => { const t = i / 49; return { x: t * w, y: h - 8 - Math.pow(t, 2.5) * (h - 16) }; }); const d = pts.map((p, i) => (i ? "L" : "M") + p.x + "," + p.y).join(" "); const fp = Math.min(progress, 1); return (<div><svg width="100%" viewBox={"0 0 " + w + " " + h} style={{ display: "block" }}><defs><linearGradient id="cg" x1="0" x2="1"><stop offset="0" stopColor={T.green} stopOpacity=".15"/><stop offset={String(fp)} stopColor={T.green} stopOpacity=".35"/><stop offset={String(fp)} stopColor={T.dim} stopOpacity=".05"/></linearGradient><clipPath id="cc"><path d={d + " L" + w + "," + h + " L0," + h + " Z"}/></clipPath></defs><rect width={w} height={h} fill="url(#cg)" clipPath="url(#cc)"/><path d={d} fill="none" stroke={T.green} strokeWidth="2" opacity=".6"/>{fp > 0 && <circle cx={fp * w} cy={h - 8 - Math.pow(fp, 2.5) * (h - 16)} r="5" fill={T.green} style={{ filter: "drop-shadow(0 0 8px " + T.green + ")" }}/>}<line x1={w * 0.95} y1="0" x2={w * 0.95} y2={h} stroke={T.yellow} strokeWidth="1" strokeDasharray="4,4" opacity=".3"/><text x={w * 0.95 - 5} y="12" fontSize="10" fill={T.yellow} opacity=".5" textAnchor="end">grad</text></svg><div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.faint, fontFamily: mono, marginTop: 6 }}><span>0 SOL</span><span style={{ color: T.green, fontWeight: 600 }}>{(progress * 85).toFixed(1)} / 85 SOL</span></div></div>); }

function Section({ n, title, done, highlight, T, mobile, children, subtitle }) {
  const bg = highlight ? T.green + "08" : T.surface;
  const bdr = highlight ? T.green + "44" : done ? T.green + "33" : T.border;
  return (
    <div style={{ background: bg, border: "1px solid " + bdr, borderRadius: 16, padding: mobile ? 18 : 28, marginBottom: mobile ? 12 : 16, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: mobile ? 12 : 18 }}>
        <span style={{ width: 30, height: 30, borderRadius: "50%", background: done ? T.green : highlight ? T.green : T.border, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 13, fontWeight: 800, color: done || highlight ? T.bg : T.dim, flexShrink: 0 }}>{done ? "✓" : n}</span>
        <span style={{ fontFamily: sans, fontWeight: 800, fontSize: mobile ? 18 : 22, color: T.text }}>{title}</span>
        {subtitle && <span style={{ fontSize: 13, color: T.faint, fontFamily: mono, marginLeft: "auto" }}>{subtitle}</span>}
      </div>
      <div style={{ width: "100%", minWidth: 0, overflow: "hidden" }}>{children}</div>
    </div>
  );
}
function NumInput({ label, value, onChange, min, max, step, T, decimals }) {
  const s = step || 1;
  const display = decimals != null ? value.toFixed(decimals) : (s < 1 ? parseFloat(value.toFixed(6)) : value);
  return (
    <div style={{ background: T.bg, borderRadius: 12, border: "1px solid " + T.border, padding: "10px 10px", minWidth: 0, overflow: "hidden" }}>
      <div style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <button onClick={() => onChange(Math.max(min, parseFloat((value - s).toFixed(6))))} style={{ width: 34, height: 34, borderRadius: "8px 0 0 8px", border: "1px solid " + T.border, background: T.surface, color: T.dim, fontSize: 18, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0 }}>-</button>
        <div style={{ flex: 1, height: 34, display: "flex", alignItems: "center", justifyContent: "center", background: T.surface, borderTop: "1px solid " + T.border, borderBottom: "1px solid " + T.border, fontFamily: mono, fontSize: 17, fontWeight: 800, color: T.green, minWidth: 0 }}>{display}</div>
        <button onClick={() => onChange(Math.min(max, parseFloat((value + s).toFixed(6))))} style={{ width: 34, height: 34, borderRadius: "0 8px 8px 0", border: "1px solid " + T.border, background: T.surface, color: T.dim, fontSize: 18, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0 }}>+</button>
      </div>
    </div>
  );
}
export default function App() {
  const [isDark, setIsDark] = useState(() => { try { return localStorage.getItem("bondli_theme") !== "light"; } catch { return true; } });
  const T = isDark ? dark : light;
  const toggleTheme = () => setIsDark(d => { try { localStorage.setItem("bondli_theme", d ? "light" : "dark"); } catch {} return !d; });
  const [user, setUser] = useState(null);
  const [tokenName, setTokenName] = useState(""); const [ticker, setTicker] = useState(""); const [desc, setDesc] = useState(""); const [image, setImage] = useState(null);
  const [twitter, setTwitter] = useState(""); const [telegram, setTelegram] = useState(""); const [website, setWebsite] = useState("");
  const [existingCA, setExistingCA] = useState(""); const [totalSol, setTotalSol] = useState(1);
  const [rpc, setRpc] = useState(""); const [seed, setSeed] = useState(""); const [useFreshWallet, setUseFreshWallet] = useState(false);
  const [slippage, setSlippage] = useState(25); const [sniperCount, setSniperCount] = useState(2); const [duration, setDuration] = useState(60); const [jitoTip, setJitoTip] = useState(0.001); const [useAtlas, setUseAtlas] = useState(false); const [deployOnly, setDeployOnly] = useState(false); const [batchCount, setBatchCount] = useState(1); const [batchDelay, setBatchDelay] = useState(5);
  const [launched, setLaunched] = useState(false); const [curveProgress, setCurveProgress] = useState(0); const [wsConnected, setWsConnected] = useState(false);
  const [launchCA, setLaunchCA] = useState(""); const [launchPumpUrl, setLaunchPumpUrl] = useState(""); const [activeSessionId, setActiveSessionId] = useState("");
  const [pastSessions, setPastSessions] = useState([]); const [fleetStatus, setFleetStatus] = useState(null);
  const [fleetKeys, setFleetKeys] = useState([]); const [devSecret, setDevSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [customUsername, setCustomUsername] = useState(null);
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [appTab, setAppTab] = useState("radar"); // "trade" or "radar"
  const [caAnalysis, setCaAnalysis] = useState(null); const [showSettings, setShowSettings] = useState(false); const [showChart, setShowChart] = useState(false); const [isClosing, setIsClosing] = useState(false); const [sessionDetail, setSessionDetail] = useState(null); const [isRecovering, setIsRecovering] = useState(false); const [showUpgrade, setShowUpgrade] = useState(false); const [upgradeTxSig, setUpgradeTxSig] = useState(""); const [upgradeError, setUpgradeError] = useState(""); const [upgradeVerifying, setUpgradeVerifying] = useState(false); const [upgradePrice, setUpgradePrice] = useState(null); const [upgradeNextPrice, setUpgradeNextPrice] = useState(null); const [upgradeLicenses, setUpgradeLicenses] = useState(0); const [wantsHome, setWantsHome] = useState(false);

  // Fetch bonding curve price when upgrade modal opens
  useEffect(() => {
    if (!showUpgrade) return;
    fetch(API + "/api/pricing").then(r => r.json()).then(d => {
      if (d.ok) { setUpgradePrice(d.currentPrice); setUpgradeNextPrice(d.nextPrice); setUpgradeLicenses(d.licensesSold); }
    }).catch(() => {});
  }, [showUpgrade]);
  const [toasts, setToasts] = useState([]);
  const toast = (msg, type = "info") => { const id = Date.now(); setToasts(t => [...t, { id, msg, type }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000); };
  const mobile = useIsMobile();
  const hasAccess = user && (user.demo || user.whitelisted || user.tier === "free" || user.tier === "pro" || user.tier === "vip" || user.tier === "none");
  const needsTier = false; // Free tier is default — no gate needed
  const tierLabel = user?.whitelisted ? "VIP" : user?.tier === "pro" ? "PRO" : user?.tier === "free" ? "FREE" : user?.demo ? "DEMO" : "";
  const tierColor = user?.whitelisted ? T.yellow : user?.tier === "pro" ? T.purple : user?.tier === "free" ? T.green : T.orange;
  useEffect(() => { if (user?.tier === "free" && !desc) setDesc("bondli.fun deployed"); }, [user?.tier]);
  // Silently activate free tier on server if needed (no gate, no user action required)
  useEffect(() => { if (user?.pubkey && !user?.demo && (user?.tier === "free" || user?.tier === "none")) { fetch(API + "/api/access/activate-free", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: user.pubkey }) }).catch(() => {}); if (user.tier === "none") setUser(u => ({ ...u, tier: "free" })); } }, [user?.pubkey]);
  useEffect(() => { const p = window?.phantom?.solana || window?.solana; if (p?.isPhantom && p?.isConnected && !user) { p.connect({ onlyIfTrusted: true }).then((r) => { const pubkey = r.publicKey.toString(); setUser({ pubkey, whitelisted: false, paid: false, tier: "free", demo: false }); fetch(API + "/api/access/check?wallet=" + pubkey).then(r => r.json()).then(data => { if (data.tier || data.whitelisted) setUser(u => ({ ...u, whitelisted: !!data.whitelisted, paid: !!data.paid, tier: data.tier || "free" })); }).catch(() => {}); }).catch(() => {}); } }, []);
  useEffect(() => { if (!hasAccess) return; let ws, dead = false; const connect = () => { if (dead) return; try { ws = new WebSocket(WS_URL); ws.onopen = () => setWsConnected(true); ws.onclose = () => { setWsConnected(false); if (!dead) setTimeout(connect, 3000); }; ws.onerror = () => {}; } catch {} }; connect(); return () => { dead = true; if (ws) ws.close(); }; }, [hasAccess]);
  useEffect(() => { if (!user?.pubkey) return; fetch(API + "/api/sessions?wallet=" + user.pubkey).then(r => r.json()).then(d => { if (d.sessions) { const active = d.sessions.filter(s => s.tokenCA && s.status !== "closed").slice(0, 5); setPastSessions(active); if (!wantsHome && !launched && active.length > 0 && active[0].status === "live") { setLaunchCA(active[0].tokenCA); setLaunched(true); setActiveSessionId(active[0].id); if (active[0].tokenConfig?.name) setTokenName(active[0].tokenConfig.name); if (active[0].tokenConfig?.ticker) setTicker(active[0].tokenConfig.ticker); } } }).catch(() => {}); }, [user]);
  // Poll online count
  useEffect(() => { const iv = setInterval(() => { fetch(API + "/api/radar").then(r => r.json()).then(d => { if (d.online != null) setOnlineCount(d.online); }).catch(() => {}); }, 15000); return () => clearInterval(iv); }, []);

  // Fetch username
  useEffect(() => { if (!user?.pubkey || user.demo) return; fetch(API + "/api/username/" + user.pubkey).then(r => r.json()).then(d => { if (d.username) { setCustomUsername(d.username); setUsernameInput(d.username); } }).catch(() => {}); }, [user]);

  const saveUsername = async () => {
    if (!usernameInput.trim()) return;
    try {
      const r = await fetch(API + "/api/username", { method: "POST", headers: { "Content-Type": "application/json", "x-wallet": user.pubkey }, body: JSON.stringify({ wallet: user.pubkey, username: usernameInput.trim() }) });
      const d = await r.json();
      if (d.ok) { setCustomUsername(d.username); setEditingUsername(false); toast("Username updated", "success"); }
      else toast(d.error || "Failed", "error");
    } catch { toast("Network error", "error"); }
  };
  useEffect(() => { if (!launched || !launchCA) return; const iv = setInterval(async () => { try { const res = await fetch(API + "/api/fleet", { headers: { "X-Wallet": user?.pubkey } }); if (res.ok) { const data = await res.json(); setFleetStatus(data); if (data.curveProgress) setCurveProgress(data.curveProgress); } } catch {} }, 3000); return () => clearInterval(iv); }, [launched, launchCA]);
  useEffect(() => { if (!launched) return; const iv = setInterval(() => setCurveProgress(p => Math.min(1, p + Math.random() * 0.004)), 2000); return () => clearInterval(iv); }, [launched]);
  const walletCount = totalSol < 0.5 ? 3 : totalSol < 1 ? 5 : totalSol < 5 ? 9 : totalSol < 10 ? 11 : totalSol < 25 ? 15 : 20;
  const activeRoles = useMemo(() => { if (walletCount <= 3) return ROLES.filter(r => ["accumulator","momentum","whale"].includes(r.id)); if (walletCount <= 5) return ROLES.filter(r => ["sniper","accumulator","momentum","whale","liquidator"].includes(r.id)); if (walletCount <= 9) return ROLES.filter(r => r.id !== "recycler"); return ROLES; }, [walletCount]);
  const isApe = !!existingCA; const canLaunch = (existingCA || (tokenName && ticker)); const preview = calcDevBuyPreview(totalSol, isApe);
  const disconnect = async () => { try { const p = window?.phantom?.solana || window?.solana; await p?.disconnect(); } catch {} setUser(null); };
  const handleTierSelect = (tier) => setUser({ ...user, tier, paid: tier === "pro" });
  const analyzeCA = async (ca) => { if (!ca || ca.length < 32) return; setCaAnalysis({ ca, loading: true, error: null, data: null }); try { const res = await fetch(API + "/api/analyze/" + ca); if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Not found"); } const coin = await res.json(); setCaAnalysis({ ca, loading: false, error: null, data: coin }); } catch (e) { setCaAnalysis({ ca, loading: false, error: e.message || "Analysis failed", data: null }); } };

  // ═══ TRADING WALLET (PumpPortal Lightning) ═══
  const [tradingWallet, setTradingWallet] = useState(null);
  const [tradingBalance, setTradingBalance] = useState(0);
  const [tradingKeys, setTradingKeys] = useState(null);
  const [showTradingSetup, setShowTradingSetup] = useState(false);
  const [heldMints, setHeldMints] = useState(new Set());
  const [recentBuys, setRecentBuys] = useState([]); // pending buys not yet in on-chain scan

  // P&L cost basis tracking (localStorage)
  const recordBuy = (ca, solAmount) => {
    try {
      const buys = JSON.parse(localStorage.getItem("bondli_buys") || "{}");
      if (!buys[ca]) buys[ca] = { totalSol: 0, buyCount: 0 };
      buys[ca].totalSol += solAmount;
      buys[ca].buyCount++;
      buys[ca].lastBuy = Date.now();
      localStorage.setItem("bondli_buys", JSON.stringify(buys));
    } catch {}
  };
  const getCostBasis = (ca) => {
    try { const buys = JSON.parse(localStorage.getItem("bondli_buys") || "{}"); return buys[ca] || null; } catch { return null; }
  };
  const clearCostBasis = (ca) => {
    try { const buys = JSON.parse(localStorage.getItem("bondli_buys") || "{}"); delete buys[ca]; localStorage.setItem("bondli_buys", JSON.stringify(buys)); } catch {}
  };

  useEffect(() => { if (!user?.pubkey || user.demo) return; 
    const fetchWallet = () => fetch(API + "/api/trading-wallet/" + user.pubkey).then(r => r.json()).then(d => { if (d.tradingWallet) { setTradingWallet(d.tradingWallet); setTradingBalance(d.balance || 0); } }).catch(() => {});
    fetchWallet();
    // Poll balance every 5 seconds — axiomatic: balance must always be accurate
    const balPoll = setInterval(fetchWallet, 5000);
    // Also load keys for deploy auto-fill
    fetch(API + "/api/trading-wallet/export", { method: "POST", headers: { "Content-Type": "application/json", "x-wallet": user.pubkey }, body: JSON.stringify({ wallet: user.pubkey }) }).then(r => r.json()).then(d => { if (d.ok && d.privateKey) setTradingKeys(d); }).catch(() => {});
    return () => clearInterval(balPoll);
  }, [user]);

  const createTradingWallet = async () => { try { toast("Creating trading wallet...", "info"); const r = await fetch(API + "/api/trading-wallet/create", { method: "POST", headers: { "Content-Type": "application/json", "x-wallet": user.pubkey }, body: JSON.stringify({ wallet: user.pubkey }) }); const d = await r.json(); if (d.ok) { setTradingWallet(d.tradingWallet); setTradingKeys({ apiKey: d.apiKey, privateKey: d.privateKey }); setShowTradingSetup(false); toast("Trading wallet created! Deposit SOL to start.", "success"); } else toast(d.error || "Failed", "error"); } catch { toast("Network error", "error"); } };

  const exportTradingKeys = async () => { try { const r = await fetch(API + "/api/trading-wallet/export", { method: "POST", headers: { "Content-Type": "application/json", "x-wallet": user.pubkey }, body: JSON.stringify({ wallet: user.pubkey }) }); const d = await r.json(); if (d.ok) { setTradingKeys(d); } else toast(d.error || "Failed", "error"); } catch { toast("Network error", "error"); } };

  // SOL Incinerator — close empty token accounts to reclaim rent
  const [incineratorScanning, setIncineratorScanning] = useState(false);
  const [incineratorResult, setIncineratorResult] = useState(null);

  const runIncinerator = async () => {
    if (!user?.pubkey || user.demo) { toast("Connect wallet first", "error"); return; }
    setIncineratorScanning(true);
    toast("Scanning for reclaimable SOL...", "info");
    try {
      // Step 1: Scan
      const scanRes = await fetch(API + "/api/incinerator/scan", { method: "POST", headers: { "Content-Type": "application/json", "x-wallet": user.pubkey }, body: JSON.stringify({ wallet: user.pubkey }) });
      const scanData = await scanRes.json();
      if (!scanData.ok || scanData.totalAccounts === 0) {
        toast("No empty accounts to close", "info");
        setIncineratorScanning(false);
        return;
      }
      toast(`Found ${scanData.totalAccounts} empty accounts (${scanData.totalReclaimable.toFixed(4)} SOL). Closing...`, "info");
      // Step 2: Close
      const closeRes = await fetch(API + "/api/incinerator/close", { method: "POST", headers: { "Content-Type": "application/json", "x-wallet": user.pubkey }, body: JSON.stringify({ wallet: user.pubkey }) });
      const closeData = await closeRes.json();
      if (closeData.ok) {
        toast(`Reclaimed ${closeData.totalReclaimed.toFixed(4)} SOL from ${closeData.closed} accounts`, "success");
        setIncineratorResult(closeData);
        setTradingBalance(prev => prev + closeData.totalReclaimed);
      } else {
        toast(closeData.error || "Close failed", "error");
      }
    } catch (e) { toast("Incinerator error: " + e.message, "error"); }
    setIncineratorScanning(false);
  };

  // Quick Ape — PumpPortal Lightning (zero signing, one-click)
  const quickApe = async (ca, solAmount = 0.1) => {
    if (!user?.pubkey || user.demo) { toast("Connect wallet first", "error"); return; }
    if (!tradingWallet) { setShowTradingSetup(true); toast("Set up trading wallet first", "error"); return; }
    if (tradingBalance < solAmount) { toast(`Need ${solAmount} SOL (have ${tradingBalance.toFixed(3)})`, "error"); return; }
    toast(`Buying ${solAmount} SOL of ${ca.slice(0, 6)}...`, "info");
    try {
      const r = await fetch(API + "/api/quick-ape", { method: "POST", headers: { "Content-Type": "application/json", "x-wallet": user.pubkey }, body: JSON.stringify({ wallet: user.pubkey, ca, solAmount }) });
      const d = await r.json();
      if (!d.ok) { toast(d.error || "Buy failed — check trading wallet balance", "error"); return; }
      toast(`Bought ${solAmount} SOL — position open`, "success");
      setTradingBalance(prev => Math.max(0, prev - solAmount - 0.001));
      recordBuy(ca, solAmount);
      // Update held mints immediately
      setHeldMints(prev => { const n = new Set(prev); n.add(ca); return n; });
      // Push to recentBuys so bags shows it before next on-chain scan
      setRecentBuys(prev => [...prev.filter(b => b.ca !== ca), { ca, sol: solAmount, time: Date.now() }]);
      return d.signature;
    } catch (e) { toast("Buy failed: " + (e.message || "network error"), "error"); }
  };

  // Quick Sell — PumpPortal Lightning
  const quickSell = async (ca, percent = 100) => {
    if (!user?.pubkey || !tradingWallet) { toast("No trading wallet", "error"); return; }
    toast(`Selling ${percent}% of ${ca.slice(0, 6)}...`, "info");
    try {
      const r = await fetch(API + "/api/quick-sell", { method: "POST", headers: { "Content-Type": "application/json", "x-wallet": user.pubkey }, body: JSON.stringify({ wallet: user.pubkey, ca, percent }) });
      const d = await r.json();
      if (!d.ok) { toast(d.error || "Sell failed", "error"); return; }
      const costBasis = getCostBasis(ca);
      const solBack = d.solReceived || 0;
      let profitMsg = `Sold ${percent}%`;
      if (solBack > 0) profitMsg += ` — got ${solBack.toFixed(4)} SOL`;
      if (costBasis > 0 && solBack > 0) {
        const pnl = solBack - costBasis;
        profitMsg += pnl >= 0 ? ` (+${pnl.toFixed(4)} profit)` : ` (${pnl.toFixed(4)} loss)`;
      }
      toast(profitMsg, solBack >= (costBasis || 0) ? "success" : "error");
      if (percent >= 100) { clearCostBasis(ca); setHeldMints(prev => { const n = new Set(prev); n.delete(ca); return n; }); }
      setTradingBalance(prev => prev + (solBack || 0));
      return d.signature;
    } catch (e) { toast("Sell failed: " + e.message, "error"); }
  };
  const handleCAChange = (v) => { setExistingCA(v); setCaAnalysis(null); };
  const closeSession = async (ca) => {
    if (!ca) { toast("No active session", "error"); return; }
    if (isClosing) { toast("Already closing — please wait", "error"); return; }
    setIsClosing(true);
    try {
      const res = await fetch(API + "/api/close", { method: "POST", headers: { "Content-Type": "application/json", "X-Wallet": user?.pubkey }, body: JSON.stringify({ ca, wallet: user?.pubkey }) });
      const data = await res.json();
      if (data.error) { toast(data.error, "error"); }
      else { toast("Closed! Net: " + (data.netProfit || 0).toFixed(4) + " SOL | Recovered: " + (data.solRecovered || 0).toFixed(4) + " SOL", "success"); setLaunched(false); setLaunchCA(""); setFleetStatus(null); setFleetKeys([]); setDevSecret(""); }
    } catch (e) { toast(e.message, "error"); }
    setIsClosing(false);
  };

  const closeAllSessions = async () => {
    if (isClosing) { toast("Already closing — please wait", "error"); return; }
    // Gather all active session IDs + CAs
    const activeSessions = pastSessions.filter(s => s.tokenCA && s.status !== "closed" && s.status !== "swept" && s.status !== "recovered");
    const hasPositions = heldMints.size > 0;
    const hasFleet = launched || activeSessions.length > 0;
    if (!hasPositions && !hasFleet) { toast("Nothing to close", "info"); return; }
    const parts = [];
    if (hasPositions) parts.push(heldMints.size + " position" + (heldMints.size !== 1 ? "s" : ""));
    if (hasFleet) parts.push((activeSessions.length || 1) + " session" + (activeSessions.length !== 1 ? "s" : ""));
    if (!confirm("EXIT ALL? This will sell " + parts.join(" + ") + " and sweep all SOL back to you.")) return;
    setIsClosing(true);
    let totalRecovered = 0;
    // Step 1: Sell all portfolio positions (trading wallet bags)
    if (hasPositions) {
      toast("Selling all portfolio positions...", "info");
      try {
        const r = await fetch(API + "/api/sell-all", { method: "POST", headers: { "Content-Type": "application/json", "x-wallet": user.pubkey }, body: JSON.stringify({ wallet: user.pubkey }) });
        const d = await r.json();
        if (d.ok) toast("Sold " + (d.sold || 0) + "/" + (d.total || 0) + " positions", "success");
      } catch {}
    }
    // Step 2: Sell-sweep each fleet session (sells tokens + sweeps SOL to master → user)
    if (hasFleet) {
      toast("Closing " + (activeSessions.length || 1) + " fleet session(s)...", "info");
      const sessionIds = activeSessions.map(s => s.id);
      if (activeSessionId && !sessionIds.includes(activeSessionId)) sessionIds.push(activeSessionId);
      for (const sid of sessionIds) {
        try {
          const res = await fetch(API + "/api/session/sell-sweep", { method: "POST", headers: { "Content-Type": "application/json", "X-Wallet": user?.pubkey }, body: JSON.stringify({ sessionId: sid, wallet: user?.pubkey }) });
          const data = await res.json();
          if (!data.error) totalRecovered += (data.totalSwept || 0) + (data.totalSold || 0);
        } catch {}
      }
      // Also close via orch for any running fleet engines
      const allCAs = new Set();
      if (launchCA) allCAs.add(launchCA);
      for (const s of activeSessions) { if (s.tokenCA) allCAs.add(s.tokenCA); }
      for (const ca of allCAs) {
        try { await fetch(API + "/api/close", { method: "POST", headers: { "Content-Type": "application/json", "X-Wallet": user?.pubkey }, body: JSON.stringify({ ca, wallet: user?.pubkey }) }); } catch {}
      }
    }
    toast("EXIT ALL complete" + (totalRecovered > 0 ? " | Recovered " + totalRecovered.toFixed(4) + " SOL" : ""), "success");
    setLaunched(false); setLaunchCA(""); setFleetStatus(null); setFleetKeys([]); setDevSecret("");
    try { const r = await fetch(API + "/api/sessions?wallet=" + user.pubkey); const d = await r.json(); if (d.sessions) setPastSessions(d.sessions.filter(s => s.tokenCA && s.status !== "closed").slice(0, 5)); } catch {}
    setIsClosing(false);
  };
  const recoverSession = async (sessionId) => {
    if (isRecovering) return;
    if (!confirm("Recover all SOL from fleet wallets? This sweeps SOL back to your wallet.")) return;
    setIsRecovering(true);
    try {
      const res = await fetch(API + "/api/session/force-recover", { method: "POST", headers: { "Content-Type": "application/json", "X-Wallet": user?.pubkey }, body: JSON.stringify({ sessionId, wallet: user?.pubkey }) });
      const data = await res.json();
      if (data.error) toast(data.error, "error");
      else { toast("Recovered " + (data.totalRecovered || 0).toFixed(4) + " SOL from " + (data.wallets?.filter(w => w.status === "ok").length || 0) + " wallets!", "success"); setSessionDetail(null); }
    } catch (e) { toast(e.message, "error"); }
    setIsRecovering(false);
  };
  const [isClearing, setIsClearing] = useState(false);
  const clearAllSessions = async () => {
    if (isClearing) return;
    if (!confirm("Clear ALL sessions? This removes them from your dashboard. Make sure you've recovered SOL first!")) return;
    setIsClearing(true);
    try {
      const res = await fetch(API + "/api/sessions/clear", { method: "POST", headers: { "Content-Type": "application/json", "X-Wallet": user?.pubkey }, body: JSON.stringify({ wallet: user?.pubkey }) });
      const data = await res.json();
      if (data.error) toast(data.error, "error");
      else { toast("Cleared " + (data.cleared || 0) + " sessions", "success"); setPastSessions([]); setSessionDetail(null); }
    } catch (e) { toast(e.message, "error"); }
    setIsClearing(false);
  };
  const [isSweeping, setIsSweeping] = useState(false);
  const sellAndSweep = async (sessionId) => {
    if (!sessionId) { toast("No session ID", "error"); return; }
    if (isSweeping) { toast("Already sweeping", "error"); return; }
    if (!confirm("Sell all tokens in every fleet wallet and sweep SOL back to master?")) return;
    setIsSweeping(true);
    try {
      const res = await fetch(API + "/api/session/sell-sweep", { method: "POST", headers: { "Content-Type": "application/json", "X-Wallet": user?.pubkey }, body: JSON.stringify({ sessionId, wallet: user?.pubkey }) });
      const data = await res.json();
      if (data.error) toast(data.error, "error");
      else toast("Sold " + (data.totalSold || 0).toFixed(4) + " + Swept " + (data.totalSwept || 0).toFixed(4) + " SOL back | Master: " + (data.masterBalance || 0).toFixed(4), "success");
    } catch (e) { toast(e.message, "error"); }
    setIsSweeping(false);
  };
  const handleCAKeyDown = (e) => { if (e.key === "Enter" && existingCA.length >= 32) { e.preventDefault(); analyzeCA(existingCA); } };
  return (
    <ThemeCtx.Provider value={T}>
      <style>{makeCss(T)}</style>
      {toasts.length > 0 && (<div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 6, maxWidth: mobile ? "calc(100vw - 32px)" : 360 }}>{toasts.map(t => (<div key={t.id} style={{ padding: "10px 16px", borderRadius: 10, fontFamily: mono, fontSize: 12, fontWeight: 600, background: t.type === "error" ? T.red + "18" : t.type === "success" ? T.green + "18" : T.surface, color: t.type === "error" ? T.red : t.type === "success" ? T.green : T.text, border: "1px solid " + (t.type === "error" ? T.red + "44" : t.type === "success" ? T.green + "44" : T.border), backdropFilter: "blur(12px)", animation: "fadeUp .3s ease", cursor: "pointer" }} onClick={() => setToasts(ts => ts.filter(x => x.id !== t.id))}>{t.msg}</div>))}</div>)}
      {!user && <LandingPage onConnect={setUser} isDark={isDark} toggleTheme={toggleTheme} />}
      {needsTier && <TierGate user={user} onSelect={handleTierSelect} onDisconnect={disconnect} />}
      {user && hasAccess && (
        <div style={{ minHeight: "100dvh", background: T.bg, color: T.text, fontFamily: sans }}>
          <div style={{ position: "fixed", inset: 0, opacity: T.mode === "dark" ? 0.015 : 0.025, pointerEvents: "none", zIndex: 0, backgroundImage: T.gridLines, backgroundSize: "60px 60px" }} />
          <header style={{ padding: mobile ? "10px 14px" : "12px 28px", borderBottom: "1px solid " + T.border, display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 10, background: T.bg + "ee", backdropFilter: "blur(10px)" }}>
            <div onClick={() => { setLaunched(false); setLaunchCA(""); setActiveSessionId(""); setCaAnalysis(null); setShowSettings(false); setFleetStatus(null); setFleetKeys([]); setDevSecret(""); setSessionDetail(null); setWantsHome(true); }} style={{ display: "flex", alignItems: "center", gap: mobile ? 8 : 12, cursor: "pointer", userSelect: "none" }}>
              <RedPill size={mobile ? 26 : 34} />
              <span style={{ fontFamily: mono, fontWeight: 800, fontSize: mobile ? 17 : 22, color: T.text }}>BOND<span style={{ color: T.red }}>LI</span></span>
              {wsConnected && <span style={{ fontSize: 10, fontFamily: mono, color: T.green, opacity: 0.8 }}>{"●"} live</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: mobile ? 6 : 10 }}>
              {(launched || heldMints.size > 0 || pastSessions.filter(s => s.status !== "closed" && s.status !== "swept" && s.status !== "recovered").length > 0) && (<button onClick={closeAllSessions} disabled={isClosing} style={{ background: T.red + "15", border: "1px solid " + T.red + "44", borderRadius: 8, padding: "5px 10px", cursor: isClosing ? "wait" : "pointer", color: T.red, fontFamily: mono, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 4, opacity: isClosing ? 0.5 : 1 }}>{isClosing ? "Exiting..." : "EXIT ALL"}</button>)}
              <button onClick={() => setShowSettings(!showSettings)} style={{ background: "none", border: "1px solid " + T.border, borderRadius: 8, padding: "6px 8px", cursor: "pointer", color: T.dim, fontSize: 14 }}><Ic.Cpu /></button>
              <ThemeToggle isDark={isDark} toggle={toggleTheme} mobile={mobile} />
              {tierLabel && <span style={{ padding: "3px 8px", borderRadius: 6, fontFamily: mono, fontSize: 10, fontWeight: 700, background: tierColor + "18", color: tierColor, border: "1px solid " + tierColor + "33" }}>{tierLabel}</span>}
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: T.surface, borderRadius: 10, border: "1px solid " + T.border }}>
                <WalletAvatar pubkey={user.pubkey || "demo"} size={22} />
                {editingUsername ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input value={usernameInput} onChange={e => setUsernameInput(e.target.value.slice(0, 24))} onKeyDown={e => { if (e.key === "Enter") saveUsername(); if (e.key === "Escape") setEditingUsername(false); }} autoFocus style={{ width: 90, padding: "2px 6px", background: T.bg, border: "1px solid " + T.green, borderRadius: 4, color: T.text, fontFamily: mono, fontSize: 11, outline: "none" }} />
                    <button onClick={saveUsername} style={{ background: T.green + "20", border: "none", borderRadius: 4, padding: "2px 6px", color: T.green, fontFamily: mono, fontSize: 10, cursor: "pointer" }}>{"✓"}</button>
                  </div>
                ) : (
                  <span onClick={() => { setUsernameInput(customUsername || walletUsername(user.pubkey || "")); setEditingUsername(true); }} style={{ fontFamily: mono, fontSize: 12, color: T.mid, maxWidth: mobile ? 80 : 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }} title="Click to edit username">{user.demo ? "demo" : (customUsername || walletUsername(user.pubkey || ""))}</span>
                )}
                <button onClick={disconnect} style={{ background: "none", border: "none", cursor: "pointer", color: T.dim, fontSize: 11, fontFamily: mono, padding: 0, marginLeft: 2 }}>{"✕"}</button>
              </div>
            </div>
          </header>
          {/* Trading Wallet Banner */}
          {tradingWallet ? (
            <div style={{ background: T.surface, borderBottom: "1px solid " + T.border, padding: "6px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 10, fontFamily: mono, color: T.green, flexShrink: 0 }}><StatusIc.Bag size={10} /> Trading:</span>
                <span onClick={() => { navigator.clipboard?.writeText(tradingWallet); toast("Copied!", "success"); }} style={{ fontSize: 10, fontFamily: mono, color: T.faint, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title="Click to copy">{tradingWallet.slice(0, 12)}...{tradingWallet.slice(-6)}</span>
                <span style={{ fontSize: 10, fontFamily: mono, color: tradingBalance > 0.01 ? T.green : T.red, fontWeight: 700 }}>{tradingBalance.toFixed(3)} SOL</span>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={runIncinerator} disabled={incineratorScanning} style={{ background: T.orange ? T.orange + "15" : "#ff910015", border: "1px solid " + (T.orange || "#ff9100") + "33", borderRadius: 6, padding: "2px 8px", fontFamily: mono, fontSize: 9, color: T.orange || "#ff9100", cursor: incineratorScanning ? "wait" : "pointer", fontWeight: 700, opacity: incineratorScanning ? 0.5 : 1 }}>{incineratorScanning ? "..." : "Reclaim SOL"}</button>
                <button onClick={() => exportTradingKeys().then(() => setShowTradingSetup(true))} style={{ background: "none", border: "1px solid " + T.border, borderRadius: 6, padding: "2px 8px", fontFamily: mono, fontSize: 9, color: T.dim, cursor: "pointer" }}>Keys</button>
                <button onClick={() => { navigator.clipboard?.writeText(tradingWallet); toast("Deposit address copied!", "success"); }} style={{ background: T.green + "15", border: "1px solid " + T.green + "33", borderRadius: 6, padding: "2px 8px", fontFamily: mono, fontSize: 9, color: T.green, cursor: "pointer", fontWeight: 700 }}>Deposit</button>
              </div>
            </div>
          ) : user && !user.demo && (
            <div style={{ background: T.yellow + "08", borderBottom: "1px solid " + T.yellow + "22", padding: "8px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontFamily: mono, color: T.yellow }}>Set up trading wallet to start buying</span>
              <button onClick={createTradingWallet} style={{ background: T.green, color: T.bg, border: "none", borderRadius: 6, padding: "4px 14px", fontFamily: mono, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Create Trading Wallet</button>
            </div>
          )}
          {/* Trading Keys Modal */}
          {showTradingSetup && tradingKeys && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setShowTradingSetup(false)}>
              <div onClick={e => e.stopPropagation()} style={{ background: T.surface, border: "2px solid " + T.green + "33", borderRadius: 20, padding: 28, maxWidth: 480, width: "100%" }}>
                <h3 style={{ fontFamily: sans, fontWeight: 900, fontSize: 20, color: T.text, marginBottom: 16, textAlign: "center" }}>Trading Wallet Keys</h3>
                <div style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 10, padding: 14, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontFamily: mono, color: T.faint, marginBottom: 4 }}>Wallet Address (send SOL here to fund)</div>
                  <div onClick={() => { navigator.clipboard?.writeText(tradingKeys.tradingWallet || tradingWallet); toast("Copied!", "success"); }} style={{ fontSize: 13, fontFamily: mono, color: T.green, cursor: "pointer", wordBreak: "break-all" }}>{tradingKeys.tradingWallet || tradingWallet}</div>
                </div>
                {tradingKeys.privateKey && <div style={{ background: T.bg, border: "1px solid " + T.yellow + "33", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontFamily: mono, color: T.yellow, marginBottom: 4 }}>Private Key (import to Phantom to manage funds)</div>
                  <div onClick={() => { navigator.clipboard?.writeText(tradingKeys.privateKey); toast("Private key copied!", "success"); }} style={{ fontSize: 11, fontFamily: mono, color: T.text, cursor: "pointer", wordBreak: "break-all", background: T.surface, padding: 8, borderRadius: 6 }}>{tradingKeys.privateKey}</div>
                </div>}
                {tradingKeys.apiKey && tradingKeys.apiKey !== "null" && <div style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 10, padding: 14, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontFamily: mono, color: T.faint, marginBottom: 4 }}>PumpPortal Lightning API Key (for instant trades)</div>
                  <div onClick={() => { navigator.clipboard?.writeText(tradingKeys.apiKey); toast("API key copied!", "success"); }} style={{ fontSize: 12, fontFamily: mono, color: T.dim, cursor: "pointer", wordBreak: "break-all" }}>{tradingKeys.apiKey}</div>
                </div>}
                <p style={{ fontSize: 12, color: T.faint, textAlign: "center", marginBottom: 14, lineHeight: 1.6 }}>Save your private key! Import it into Phantom to withdraw funds anytime. Trades happen instantly from this wallet with zero popups.</p>
                <button onClick={() => setShowTradingSetup(false)} style={{ width: "100%", padding: 12, background: T.green + "15", border: "1px solid " + T.green, borderRadius: 10, fontFamily: mono, fontSize: 14, fontWeight: 800, color: T.green, cursor: "pointer" }}>Done</button>
              </div>
            </div>
          )}
          {showSettings && (<div style={{ maxWidth: 680, margin: "0 auto", padding: mobile ? "12px 14px" : "16px 24px" }}><div style={{ background: T.surface, border: "1px solid " + T.border, borderRadius: 14, padding: mobile ? 16 : 22 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}><span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: T.text }}><Ic.Cpu /> Settings</span><button onClick={() => setShowSettings(false)} style={{ background: "none", border: "none", color: T.dim, cursor: "pointer", fontFamily: mono }}>{"✕"}</button></div><div style={{ display: "flex", flexDirection: "column", gap: 14 }}><div><Label>RPC URL</Label><Input value={rpc} onChange={setRpc} placeholder="https://mainnet.helius-rpc.com/?api-key=..." big /></div><div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", background: T.bg, borderRadius: 10, border: "1px solid " + T.border, cursor: "pointer" }} onClick={() => setUseAtlas(!useAtlas)}><div style={{ width: 40, height: 22, borderRadius: 11, padding: 2, background: useAtlas ? T.green : T.border, transition: "all .2s", flexShrink: 0 }}><div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", transform: useAtlas ? "translateX(18px)" : "translateX(0)", transition: "transform .2s" }} /></div><div><div style={{ fontSize: 13, fontFamily: mono, fontWeight: 700, color: T.text }}>Helius Atlas</div><div style={{ fontSize: 11, color: T.dim }}>Staked connections</div></div></div></div></div></div>)}
          {user.tier === "free" && !user.whitelisted && (<div style={{ background: T.green + "08", borderBottom: "1px solid " + T.green + "22", padding: "6px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}><span style={{ fontSize: 12, fontFamily: mono, color: T.green }}>{FREE_PROFIT_CUT}% profit share</span><button onClick={() => setShowUpgrade(true)} style={{ background: T.green, color: T.bg, border: "none", borderRadius: 6, padding: "3px 10px", fontFamily: mono, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Upgrade</button></div>)}
          {showUpgrade && (<div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setShowUpgrade(false)}><div onClick={e => e.stopPropagation()} style={{ background: T.surface, border: "2px solid " + T.border, borderRadius: 20, padding: mobile ? 24 : 36, maxWidth: 440, width: "100%" }}>
            <h3 style={{ fontFamily: sans, fontWeight: 900, fontSize: 22, color: T.text, marginBottom: 8, textAlign: "center" }}>Upgrade to Pro</h3>
            <p style={{ fontSize: 14, color: T.dim, textAlign: "center", marginBottom: 16 }}>Send <span style={{ color: T.green, fontWeight: 800 }}>{upgradePrice || "..."} SOL</span> to the address below, then paste the tx signature.</p>
            {upgradeLicenses > 0 && <div style={{ textAlign: "center", fontFamily: mono, fontSize: 11, color: T.faint, marginBottom: 12 }}>License #{upgradeLicenses + 1} {"·"} {upgradeLicenses} sold {"·"} next: {upgradeNextPrice} SOL</div>}
            <div style={{ background: T.bg, border: "1px solid " + T.border, borderRadius: 10, padding: "12px 14px", marginBottom: 14, wordBreak: "break-all", fontSize: 13, fontFamily: mono, color: T.green, cursor: "pointer", textAlign: "center" }} onClick={() => { navigator.clipboard?.writeText(PLATFORM_WALLET); toast("Copied!", "success"); }}>{PLATFORM_WALLET}<div style={{ fontSize: 9, color: T.faint, marginTop: 4 }}>tap to copy</div></div>
            <input value={upgradeTxSig} onChange={e => setUpgradeTxSig(e.target.value)} placeholder="Paste transaction signature..." style={{ width: "100%", padding: "12px 14px", background: T.bg, border: "1px solid " + T.border, borderRadius: 10, color: T.text, fontFamily: mono, fontSize: 13, outline: "none", boxSizing: "border-box", marginBottom: 12 }} />
            {upgradeError && <p style={{ fontSize: 13, color: T.red, fontFamily: mono, marginBottom: 10, textAlign: "center" }}>{upgradeError}</p>}
            <button onClick={async () => {
              if (!upgradeTxSig || upgradeTxSig.length < 20) { setUpgradeError("Paste a valid tx signature"); return; }
              setUpgradeVerifying(true); setUpgradeError("");
              try {
                const res = await fetch(API + "/api/access/activate-pro", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: user?.pubkey, txSig: upgradeTxSig }) });
                const data = await res.json();
                if (data.ok) { setUser(u => ({ ...u, tier: "pro", paid: true })); setShowUpgrade(false); toast("Upgraded to Pro! License #" + (data.licenseNumber || "?") + " — paid " + (data.pricePaid || "?") + " SOL", "success"); }
                else setUpgradeError(data.error || "Payment not verified");
              } catch { setUpgradeError("Network error"); }
              setUpgradeVerifying(false);
            }} disabled={upgradeVerifying} style={{ width: "100%", padding: "14px", background: "linear-gradient(135deg, #534bb1, #551bf9)", border: "none", borderRadius: 12, color: "#fff", fontFamily: mono, fontSize: 15, fontWeight: 800, cursor: upgradeVerifying ? "wait" : "pointer", opacity: upgradeVerifying ? 0.6 : 1 }}>{upgradeVerifying ? "Verifying..." : "Verify Payment"}</button>
            <button onClick={() => setShowUpgrade(false)} style={{ width: "100%", marginTop: 8, padding: "10px", background: "none", border: "1px solid " + T.border, borderRadius: 10, color: T.dim, fontFamily: mono, fontSize: 13, cursor: "pointer" }}>Cancel</button>
          </div></div>)}
          <div style={{ maxWidth: launched ? 1100 : appTab === "radar" ? 1400 : appTab === "portfolio" ? 800 : 760, margin: "0 auto", padding: appTab === "radar" ? (mobile ? "10px 6px" : "16px 12px") : (mobile ? "16px 12px" : "28px 24px"), position: "relative", zIndex: 1 }}>
            {launched && launchCA ? (
              <div>
                {/* ═══ CHART ═══ */}
                <div style={{ background: T.surface, border: "2px solid " + T.green + "33", borderRadius: 14, overflow: "hidden", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid " + T.border }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, fontFamily: mono, color: T.bg, background: T.green, padding: "2px 8px", borderRadius: 6, animation: "pulse 2s infinite" }}>LIVE</span>
                      <span style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: T.text }}>{tokenName || ticker || "Trading"}</span>
                    </div>
                    <span style={{ fontFamily: mono, fontSize: 12, color: T.mid, cursor: "pointer" }} onClick={() => { navigator.clipboard?.writeText(launchCA); toast("CA copied", "success"); }}>{launchCA.slice(0, 6)}...{launchCA.slice(-4)} copy</span>
                  </div>
                  <PriceChart trades={(fleetStatus?.trades || []).slice(0, 30)} mobile={mobile} T={T} ca={launchCA} wsChart={fleetStatus?.wsChart} gameState={fleetStatus?.gameState} />
                  <div style={{ padding: "6px 12px", background: T.bg, borderTop: "1px solid " + T.border, display: "flex", gap: 8, justifyContent: "center" }}>
                    <a href={"https://pump.fun/coin/" + launchCA} target="_blank" rel="noopener" style={{ fontSize: 11, fontFamily: mono, color: T.green, textDecoration: "none" }}>pump.fun {"→"}</a>
                    <a href={"https://dexscreener.com/solana/" + launchCA} target="_blank" rel="noopener" style={{ fontSize: 11, fontFamily: mono, color: T.dim, textDecoration: "none" }}>dexscreener {"→"}</a>
                    <a href={"https://solscan.io/token/" + launchCA} target="_blank" rel="noopener" style={{ fontSize: 11, fontFamily: mono, color: T.dim, textDecoration: "none" }}>solscan {"→"}</a>
                  </div>
                </div>

                {/* ═══ LINKS ═══ */}
                <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 12 }}>
                  {[{ l: "pump.fun", u: "https://pump.fun/coin/" + launchCA, c: T.green }, { l: "Solscan", u: "https://solscan.io/token/" + launchCA }, { l: "DexScreener", u: "https://dexscreener.com/solana/" + launchCA }, { l: "Photon", u: "https://photon-sol.tinyastro.io/en/lp/" + launchCA }].map(x => (
                    <a key={x.l} href={x.u} target="_blank" rel="noopener" style={{ textAlign: "center", padding: "8px 4px", background: T.surface, borderRadius: 8, border: "1px solid " + T.border, color: x.c || T.mid, fontFamily: mono, fontSize: mobile ? 10 : 12, fontWeight: 700, textDecoration: "none" }}>{x.l}</a>
                  ))}
                </div>

                {/* ═══ STATS ═══ */}
                <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr 1fr" : "1fr 1fr 1fr 1fr 1fr", gap: 6, marginBottom: 12 }}>
                  {[
                    { k: "Phase", v: fleetStatus?.phase || "init", c: T.green },
                    { k: "Wallets", v: fleetStatus?.activeWallets || 0, c: T.green },
                    { k: "Trades", v: fleetStatus?.tradeCount || 0, c: T.green },
                    { k: "Spent", v: (fleetStatus?.solSpent || 0).toFixed(3), c: T.red },
                    { k: "Recovered", v: (fleetStatus?.solRecovered || 0).toFixed(3), c: T.green },
                  ].map(s => (
                    <div key={s.k} style={{ background: T.surface, borderRadius: 10, padding: mobile ? "8px 6px" : "10px 12px", border: "1px solid " + T.border }}>
                      <div style={{ fontSize: 9, fontFamily: mono, color: T.faint, textTransform: "uppercase", marginBottom: 2 }}>{s.k}</div>
                      <div style={{ fontSize: mobile ? 14 : 16, fontFamily: mono, fontWeight: 800, color: s.c }}>{s.v}</div>
                    </div>
                  ))}
                </div>

                {/* ═══ FLEET WALLETS ═══ */}
                {fleetStatus?.wallets && fleetStatus.wallets.length > 0 && (
                  <div style={{ background: T.surface, border: "1px solid " + T.border, borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid " + T.border, fontFamily: mono, fontSize: 13, fontWeight: 700, color: T.text, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>Fleet Wallets</span>
                      {(user?.tier === "pro" || user?.tier === "vip") && fleetKeys.length > 0 && (
                        <button onClick={() => { const all = fleetKeys.map(k => k.role + ": " + k.secret).join("\n"); navigator.clipboard?.writeText(all); setCopied("all"); }} style={{ background: T.red + "15", border: "1px solid " + T.red + "33", borderRadius: 6, padding: "3px 8px", color: T.red, fontFamily: mono, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>{copied === "all" ? "✓ Copied" : "Copy All Keys"}</button>
                      )}
                    </div>
                    {fleetStatus.wallets.map((w, i) => {
                      const net = (w.recovered || 0) - (w.spent || 0);
                      const rc = { sniper: "#ff6b6b", accumulator: T.green, momentum: "#ffd43b", whale: "#4dabf7", liquidator: "#da77f2", recycler: "#69db7c", support: "#748ffc" };
                      const keyData = fleetKeys.find(k => k.pubkey?.slice(0, 8) === w.pubkey?.slice(0, 8) || k.role === w.role);
                      const walletSecret = keyData?.secret || ((w.role === "dev" || w.role === "master" || w.role === "solo") ? devSecret : null);
                      const isVip = user?.tier === "pro" || user?.tier === "vip";
                      return (
                        <div key={i} style={{ padding: "8px 14px", borderBottom: "1px solid " + T.border + "22" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: rc[w.role] || T.green, flexShrink: 0 }} />
                            <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: T.mid, width: 80, textTransform: "capitalize" }}>{w.role}</span>
                            <span style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>{w.pubkey}...</span>
                            <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 12, fontWeight: 700, color: net >= 0 ? T.green : T.red }}>{net >= 0 ? "+" : ""}{net.toFixed(4)}</span>
                            <span style={{ fontFamily: mono, fontSize: 10, color: T.faint }}>{w.tradeCount || 0}tx</span>
                          </div>
                          {isVip && walletSecret && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, marginLeft: 16 }}>
                              <div style={{ flex: 1, fontFamily: mono, fontSize: 9, color: T.dim, wordBreak: "break-all", lineHeight: 1.3, background: T.bg, padding: "4px 6px", borderRadius: 4, border: "1px solid " + T.border, maxHeight: 32, overflow: "hidden", textOverflow: "ellipsis" }}>{walletSecret.slice(0, 20)}...{walletSecret.slice(-8)}</div>
                              <button onClick={() => { navigator.clipboard?.writeText(walletSecret); setCopied(w.role + i); }} style={{ background: T.red + "20", border: "none", borderRadius: 4, padding: "3px 8px", color: T.red, fontFamily: mono, fontSize: 9, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>{copied === w.role + i ? "✓" : "Key"}</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ═══ TRADE FEED ═══ */}
                {fleetStatus?.trades && fleetStatus.trades.length > 0 && (
                  <div style={{ background: T.surface, border: "1px solid " + T.border, borderRadius: 12, overflow: "hidden", marginBottom: 12, maxHeight: 300, overflowY: "auto" }}>
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid " + T.border, fontFamily: mono, fontSize: 13, fontWeight: 700, color: T.text, position: "sticky", top: 0, background: T.surface, zIndex: 1 }}>Trade Feed ({fleetStatus.trades.length})</div>
                    {fleetStatus.trades.map((t, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderBottom: "1px solid " + T.border + "15", fontSize: 12, fontFamily: mono }}>
                        <span style={{ width: 36, fontWeight: 800, color: t.side === "buy" ? T.green : T.red, textTransform: "uppercase" }}>{t.side}</span>
                        <span style={{ color: T.mid, textTransform: "capitalize", width: 70 }}>{t.role}</span>
                        <span style={{ color: T.text, fontWeight: 700 }}>{Number(t.sol || 0).toFixed(4)} SOL</span>
                        <span style={{ marginLeft: "auto", color: T.faint, fontSize: 10 }}>{t.wallet}...</span>
                        {t.sig && <a href={"https://solscan.io/tx/" + t.sig} target="_blank" rel="noopener" style={{ color: T.dim, fontSize: 10, textDecoration: "none" }}>tx{"↗"}</a>}
                      </div>
                    ))}
                  </div>
                )}

                {/* ═══ CONTROLS ═══ */}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={closeAllSessions} disabled={isClosing} style={{ flex: 1, padding: "14px", background: T.red + "10", border: "1px solid " + T.red, color: T.red, fontFamily: mono, fontSize: 14, fontWeight: 800, borderRadius: 10, cursor: isClosing ? "wait" : "pointer", opacity: isClosing ? 0.5 : 1 }}>{isClosing ? "Exiting..." : "EXIT ALL"}</button>
                  <button onClick={() => { setLaunched(false); setLaunchCA(""); setCaAnalysis(null); setFleetStatus(null); setFleetKeys([]); setDevSecret(""); setWantsHome(true); }} style={{ padding: "14px 20px", background: "none", border: "1px solid " + T.border, color: T.dim, fontFamily: mono, fontSize: 13, borderRadius: 10, cursor: "pointer" }}>New</button>
                </div>
              </div>

            ) : (
              <div>
                {/* ═══ TOP TAB BAR ═══ */}
                <div style={{ display: "flex", marginBottom: 16, background: T.surface, borderRadius: 12, border: "1px solid " + T.border, overflow: "hidden" }}>
                  {[
                    { id: "radar", label: "Radar", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/></svg> },
                    { id: "portfolio", label: "Bags", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="10"/></svg> },
                    { id: "trade", label: "Deploy", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> },
                  ].map(t => (
                    <button key={t.id} onClick={() => setAppTab(t.id)} style={{
                      flex: 1, padding: mobile ? "12px 8px" : "14px 16px",
                      background: appTab === t.id ? T.green + "10" : "transparent",
                      border: "none", borderBottom: appTab === t.id ? "3px solid " + T.green : "3px solid transparent",
                      fontFamily: mono, fontSize: mobile ? 14 : 16, fontWeight: 800,
                      color: appTab === t.id ? T.green : T.dim, cursor: "pointer", transition: "all .15s",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    }}><span style={{ display: "flex", alignItems: "center" }}>{t.icon}</span>{t.label}</button>
                  ))}
                </div>

                {/* ═══ RADAR TAB (full width card grid) ═══ */}
                {appTab === "radar" && (
                  <div style={{ background: T.surface, border: "1px solid " + T.border, borderRadius: 14, overflow: "hidden" }}>
                    <RadarFeed T={T} mobile={mobile} fullScreen isVip={user?.tier === "pro" || user?.whitelisted} tradingBalance={tradingBalance} heldMints={heldMints} toast={toast} onApe={(ca) => { setExistingCA(ca); analyzeCA(ca); setAppTab("trade"); }} onQuickApe={quickApe} onQuickSell={quickSell} />
                  </div>
                )}

                {/* ═══ PORTFOLIO TAB (positions + P&L + sell) ═══ */}
                {appTab === "portfolio" && (
                  <PortfolioPanel T={T} mobile={mobile} mono={mono} user={user} quickSell={quickSell} quickApe={quickApe} toast={toast} tradingBalance={tradingBalance} recentBuys={recentBuys} onPositionsUpdate={(positions) => { setHeldMints(new Set(positions.map(p => p.mint))); setRecentBuys(prev => prev.filter(b => !positions.some(p => p.mint === b.ca))); }} getCostBasis={getCostBasis} onApe={(ca) => { setExistingCA(ca); analyzeCA(ca); setAppTab("trade"); }} />
                )}

                {/* ═══ TRADE TAB (wizard) ═══ */}
                {appTab === "trade" && (<>
                <Section n="1" title="Wallet" done={!!tradingKeys?.privateKey || !!seed || useFreshWallet} T={T} mobile={mobile}>
                    {tradingKeys?.privateKey ? (
                      <div>
                        {/* Toggle: Trading Wallet vs Fresh Wallet */}
                        {(user?.tier === "pro" || user?.whitelisted) && (
                          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                            <button onClick={() => { setUseFreshWallet(false); setSeed(""); }} style={{ flex: 1, padding: "8px 12px", background: !useFreshWallet ? T.green + "12" : "transparent", border: "1px solid " + (!useFreshWallet ? T.green + "44" : T.border), borderRadius: 8, fontFamily: mono, fontSize: 11, fontWeight: 700, color: !useFreshWallet ? T.green : T.dim, cursor: "pointer" }}>Trading Key</button>
                            <button onClick={() => setUseFreshWallet(true)} style={{ flex: 1, padding: "8px 12px", background: useFreshWallet ? T.green + "12" : "transparent", border: "1px solid " + (useFreshWallet ? T.green + "44" : T.border), borderRadius: 8, fontFamily: mono, fontSize: 11, fontWeight: 700, color: useFreshWallet ? T.green : T.dim, cursor: "pointer" }}>Fresh Wallet</button>
                          </div>
                        )}
                        {!useFreshWallet ? (
                          <div style={{ padding: mobile ? 14 : 18, background: T.green + "08", border: "1px solid " + T.green + "44", borderRadius: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <div style={{ fontSize: 14, fontFamily: mono, fontWeight: 700, color: T.green }}>Trading Wallet</div>
                              <div style={{ fontSize: 12, fontFamily: mono, fontWeight: 700, color: tradingBalance > 0.05 ? T.green : T.red }}>{tradingBalance.toFixed(3)} SOL</div>
                            </div>
                            <div style={{ fontSize: 10, color: T.faint, fontFamily: mono, marginTop: 4 }}>{tradingWallet?.slice(0, 20)}...{tradingWallet?.slice(-6)}</div>
                            <div style={{ fontSize: 10, color: T.dim, fontFamily: mono, marginTop: 4 }}>Deploys directly from this wallet. No deposit step.</div>
                          </div>
                        ) : (
                          <div style={{ padding: mobile ? 14 : 18, background: T.bg, border: "1px solid " + T.border, borderRadius: 12 }}>
                            <div style={{ fontSize: 14, fontFamily: mono, fontWeight: 700, color: T.mid, marginBottom: 4 }}>Fresh Wallet</div>
                            <div style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>A new keypair will be generated. You'll deposit SOL via Phantom to fund it. No on-chain link to your trading wallet.</div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div onClick={() => setSeed("")} style={{ padding: mobile ? 16 : 20, background: !seed ? T.green + "10" : T.bg, border: "1px solid " + (!seed ? T.green : T.border), borderRadius: 12, cursor: "pointer", textAlign: "center" }}><div style={{ fontSize: 15, fontFamily: mono, fontWeight: 700, color: !seed ? T.green : T.mid }}>Generate Fresh</div><div style={{ fontSize: 13, color: T.faint, fontFamily: mono, marginTop: 4 }}>Deposit SOL to fund</div></div>
                        <div style={{ padding: mobile ? 16 : 20, background: seed ? T.green + "10" : T.bg, border: "1px solid " + (seed ? T.green : T.border), borderRadius: 12 }}><div style={{ fontSize: 15, fontFamily: mono, fontWeight: 700, color: seed ? T.green : T.mid, textAlign: "center", marginBottom: 8 }}>Master Wallet</div><Input value={seed} onChange={setSeed} placeholder="bs58 private key" type="password" /></div>
                      </div>
                    )}
                </Section>
                <Section n={"\u2714"} title={isApe ? "Ape" : "Token"} done={canLaunch} subtitle={isApe ? "existing CA" : canLaunch ? "ready" : ""} T={T} mobile={mobile}>
                  <div style={{ marginBottom: 10 }}><Label>paste CA to ape</Label><Input value={existingCA} onChange={handleCAChange} onKeyDown={handleCAKeyDown} placeholder="pump.fun CA... (Enter to analyze)" big />{existingCA.length >= 32 && !caAnalysis && (<div style={{ textAlign: "right", marginTop: 4 }}><span style={{ fontSize: 12, fontFamily: mono, color: T.green, cursor: "pointer", padding: "4px 10px", background: T.green + "10", borderRadius: 6 }} onClick={() => analyzeCA(existingCA)}>{"\u21B5"} Analyze</span></div>)}</div>
                  {caAnalysis?.loading && (<div style={{ padding: 20, textAlign: "center", fontFamily: mono, fontSize: 14, color: T.dim, animation: "pulse 1.5s infinite" }}>Analyzing {existingCA.slice(0, 8)}...</div>)}
                  {caAnalysis?.error && (<div style={{ marginBottom: 10 }}><div style={{ padding: "10px 14px", background: T.red + "10", border: "1px solid " + T.red + "33", borderRadius: 10, fontFamily: mono, fontSize: 13, color: T.red, display: "flex", alignItems: "center", gap: 8 }}><span style={{ flex: 1 }}>{caAnalysis.error}</span><button onClick={() => analyzeCA(existingCA)} style={{ background: T.red + "20", border: "1px solid " + T.red + "44", borderRadius: 6, padding: "4px 10px", color: T.red, fontFamily: mono, fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>Retry</button></div></div>)}
                  {caAnalysis?.data && (() => { const d = caAnalysis.data; const vc = d.verdict === "APE" ? T.green : d.verdict === "RISKY" ? T.yellow : T.red; return (<div style={{ background: T.bg, border: "1px solid " + vc + "33", borderRadius: 14, overflow: "hidden", marginBottom: 10 }}>
                    <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid " + T.border }}>
                      {d.image_uri && <img src={d.image_uri} style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} alt="" />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 800, color: T.text, lineHeight: 1.2 }}>{d.name}</div>
                        <div style={{ fontFamily: mono, fontSize: 13, color: T.green, fontWeight: 700 }}>${d.symbol}</div>
                        <div style={{ fontFamily: mono, fontSize: 12, color: T.mid, marginTop: 2 }}>{d.priceUsd ? "$" + Number(d.priceUsd).toFixed(6) : ""} {d.priceChange1h != null && (<span style={{ color: d.priceChange1h >= 0 ? T.green : T.red, fontWeight: 700 }}>{d.priceChange1h > 0 ? "+" : ""}{Number(d.priceChange1h).toFixed(1)}% 1h</span>)}</div>
                      </div>
                      <div style={{ textAlign: "center", flexShrink: 0 }}>
                        <div style={{ fontSize: 28, fontFamily: mono, fontWeight: 900, color: vc, lineHeight: 1 }}>{d.score}</div>
                        <div style={{ fontSize: 11, fontFamily: mono, fontWeight: 800, color: vc, marginTop: 2 }}>{d.verdict}</div>
                      </div>
                    </div>
                    {d.factors && (<div style={{ padding: "10px 16px", display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: "6px 14px" }}>
                      {d.factors.map(f => {
                        const maxScore = 20;
                        const pct = Math.max(0, Math.min(100, f.score / maxScore * 100));
                        const isGraduated = f.name === "Bonded" && (f.detail === "graduated" || f.detail === "Grad");
                        const barColor = isGraduated ? T.yellow : f.score >= 14 ? T.green : f.score >= 8 ? T.yellow : T.red;
                        const barWidth = isGraduated ? 100 : pct;
                        return (
                          <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 11, fontFamily: mono, color: T.dim, width: 85, flexShrink: 0 }}>{f.name}</span>
                            <div style={{ flex: 1, height: 6, background: T.border + "44", borderRadius: 3, overflow: "hidden" }}><div style={{ width: barWidth + "%", height: "100%", borderRadius: 3, background: barColor }} /></div>
                            <span style={{ fontSize: 10, fontFamily: mono, color: isGraduated ? T.yellow : T.faint, fontWeight: isGraduated ? 700 : 400, width: 78, textAlign: "right", flexShrink: 0 }}>{f.detail}</span>
                          </div>
                        );
                      })}
                    </div>)}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1, background: T.border + "33" }}>
                      {[
                        { k: "MCap", v: "$" + mcapFmt(d.usd_market_cap || 0), c: T.green },
                        { k: "Vol 1h", v: "$" + mcapFmt(d.vol1h || 0), c: (d.vol1h || 0) > 10000 ? T.green : T.dim },
                        { k: "Buys/Sells", v: (d.txns1h?.buys || 0) + "/" + (d.txns1h?.sells || 0), c: (d.txns1h?.buys || 0) > (d.txns1h?.sells || 0) ? T.green : T.red },
                        { k: "Bonded", v: d.complete ? "Grad" : (d.bp || 0).toFixed(1) + "%", c: d.complete ? T.yellow : T.green },
                      ].map(s => (<div key={s.k} style={{ background: T.surface, padding: "8px 4px", textAlign: "center" }}><div style={{ fontSize: 15, fontFamily: mono, fontWeight: 800, color: s.c }}>{s.v}</div><div style={{ fontSize: 10, color: T.faint, fontFamily: mono }}>{s.k}</div></div>))}
                    </div>
                    <div style={{ padding: "8px 16px", borderTop: "1px solid " + T.border, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <button onClick={() => setShowChart(!showChart)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: mono, fontSize: 12, color: T.mid, display: "flex", alignItems: "center", gap: 4 }}>{showChart ? "▲ Hide" : "▼ Show"} Chart</button>
                      <div style={{ display: "flex", gap: 8 }}>
                        <a href={"https://pump.fun/coin/" + caAnalysis.ca} target="_blank" rel="noopener" style={{ fontSize: 11, fontFamily: mono, color: T.green, textDecoration: "none" }}>pump.fun {"→"}</a>
                        <a href={"https://dexscreener.com/solana/" + caAnalysis.ca} target="_blank" rel="noopener" style={{ fontSize: 11, fontFamily: mono, color: T.dim, textDecoration: "none" }}>dex {"→"}</a>
                      </div>
                    </div>
                    {showChart && (<iframe src={"https://www.gmgn.cc/kline/sol/" + caAnalysis.ca} style={{ width: "100%", height: mobile ? 300 : 420, border: "none", display: "block", background: "#0a0a0a" }} title="Chart" />)}
                  </div>); })()}
                  {!existingCA && (<><div style={{ display: "flex", alignItems: "center", gap: 12, margin: "4px 0 10px", fontSize: 11, color: T.faint, fontFamily: mono, textTransform: "uppercase", letterSpacing: ".08em" }}><span style={{ flex: 1, height: 1, background: T.border }} />or create new<span style={{ flex: 1, height: 1, background: T.border }} /></div><div style={{ display: "flex", gap: mobile ? 10 : 14, marginBottom: 10 }}><ImageUpload image={image} onChange={setImage} mobile={mobile} /><div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0, overflow: "hidden" }}><Input value={tokenName} onChange={setTokenName} placeholder="Token Name" big /><Input value={ticker} onChange={v => setTicker(v.toUpperCase())} placeholder="TICKER" maxLength={10} big /></div></div><div style={{ marginBottom: 8 }}><textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Description..." style={{ width: "100%", padding: "10px 12px", background: T.bg, border: "1px solid " + T.border, borderRadius: 10, color: T.text, fontFamily: sans, fontSize: 14, outline: "none", resize: "vertical", lineHeight: 1.5, boxSizing: "border-box" }} /></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, overflow: "hidden" }}><Input value={twitter} onChange={setTwitter} placeholder="Twitter" /><Input value={telegram} onChange={setTelegram} placeholder="Telegram" /><Input value={website} onChange={setWebsite} placeholder="Website" /></div></>)}
                </Section>
                <Section n="3" title="Configure" T={T} mobile={mobile}>
                  {!isApe && (<div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 14px", background: T.bg, borderRadius: 10, border: "1px solid " + T.border, cursor: "pointer", marginBottom: 12 }} onClick={() => setDeployOnly(!deployOnly)}>
                    <div style={{ width: 40, height: 22, borderRadius: 11, padding: 2, background: deployOnly ? T.yellow : T.border, transition: "all .2s", flexShrink: 0 }}><div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", transform: deployOnly ? "translateX(18px)" : "translateX(0)", transition: "transform .2s" }} /></div>
                    <div><div style={{ fontSize: 13, fontFamily: mono, fontWeight: 700, color: deployOnly ? T.yellow : T.text }}>Deploy Only</div><div style={{ fontSize: 11, color: T.dim }}>Create token on pump.fun {"\u2014"} no buy, no fleet</div></div>
                  </div>)}
                  {deployOnly ? (
                    <div style={{ padding: "14px", background: T.yellow + "08", borderRadius: 10, border: "1px solid " + T.yellow + "22" }}>
                      <div style={{ fontFamily: mono, fontSize: 12, color: T.yellow, marginBottom: 8 }}><StatusIc.Warn size={10} /> Deploy only {"\u2014"} 0.02 SOL creation fee per token</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                        <NumInput label="Batch Count" value={batchCount} onChange={setBatchCount} min={1} max={20} T={T} />
                        <NumInput label="Delay sec" value={batchDelay} onChange={setBatchDelay} min={2} max={30} T={T} />
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 11, color: T.dim }}>
                        {batchCount > 1 ? `Deploy ${batchCount} tokens over ~${(batchCount * batchDelay).toFixed(0)}s` : "Single deploy"}
                      </div>
                    </div>
                  ) : (<>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}><span style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, color: T.faint, textTransform: "uppercase" }}>SOL Budget</span><span style={{ fontFamily: mono, fontSize: 28, fontWeight: 900, color: T.green }}>{totalSol}</span></div>
                  <input type="range" min={0.5} max={50} step={0.1} value={totalSol} onChange={e => setTotalSol(Number(e.target.value))} style={{ width: "100%", accentColor: T.green, marginBottom: 12 }} />
                  <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 12, overflow: "hidden" }}><NumInput label="Snipers" value={sniperCount} onChange={setSniperCount} min={1} max={5} T={T} /><NumInput label="Slippage %" value={slippage} onChange={setSlippage} min={1} max={50} T={T} /><NumInput label="Duration m" value={duration} onChange={setDuration} min={5} max={240} step={5} T={T} /><NumInput label="Jito Tip" value={jitoTip} onChange={setJitoTip} min={0.001} max={0.1} step={0.001} decimals={3} T={T} /></div>
                  <div style={{ display: "grid", gridTemplateColumns: isApe ? "repeat(3, 1fr)" : "repeat(4, 1fr)", gap: 2, background: T.border + "44", borderRadius: 8, overflow: "hidden" }}>{(isApe ? [{ k: "Fleet", v: totalSol.toFixed(2) }, { k: "Wallets", v: walletCount + sniperCount - 1 }, { k: "Snipers", v: sniperCount }] : [{ k: "Dev Buy", v: preview.devBuy.toFixed(2) }, { k: "Fleet", v: preview.fleet.toFixed(2) }, { k: "Wallets", v: walletCount + sniperCount - 1 }, { k: "Snipers", v: sniperCount }]).map(s => (<div key={s.k} style={{ background: T.bg, padding: "8px 4px", textAlign: "center" }}><div style={{ fontSize: 18, fontFamily: mono, fontWeight: 800, color: T.green }}>{s.v}</div><div style={{ fontSize: 11, color: T.faint, fontFamily: mono, marginTop: 2 }}>{s.k}</div></div>))}</div>
                  </>)}
                </Section>
                <Section n=<StatusIc.Rocket size={28} /> title={isApe ? "Start Trading" : "Launch"} highlight={canLaunch} T={T} mobile={mobile}>
                  <LaunchFlow user={user} mobile={mobile} totalSol={deployOnly ? 0 : totalSol} tokenConfig={{ name: tokenName, ticker, description: desc || (user?.tier === "free" ? "bondli.fun deployed" : ""), image, twitter, telegram, website, existingCA }} canLaunch={canLaunch} launched={launched} masterSeed={useFreshWallet ? "" : (tradingKeys?.privateKey || seed)} fleetConfig={{ sniperCount, slippage, duration, jitoTip, deployOnly, batchCount: deployOnly ? batchCount : 1, batchDelay: deployOnly ? batchDelay : 5 }} onLaunched={(data) => { setWantsHome(false); setLaunched(true); setCurveProgress(0.03); if (data.tokenCA) setLaunchCA(data.tokenCA); if (data.pumpUrl) setLaunchPumpUrl(data.pumpUrl); if (data.sessionId) setActiveSessionId(data.sessionId); if (data.walletKeys) setFleetKeys(data.walletKeys); if (data.devSecret) setDevSecret(data.devSecret); }} />
                </Section>
                {pastSessions.length > 0 && (<div style={{ background: T.surface, border: "1px solid " + T.border, borderRadius: 14, padding: mobile ? 14 : 18, marginTop: 8 }}>
                  <div style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>Active Sessions</span>
                    <button onClick={clearAllSessions} disabled={isClearing} style={{ background: T.red + "12", color: T.red, border: "1px solid " + T.red + "33", fontFamily: mono, fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 6, cursor: isClearing ? "wait" : "pointer", opacity: isClearing ? 0.5 : 1 }}>{isClearing ? "Clearing..." : "Clear All"}</button>
                  </div>
                  {pastSessions.map(s => (<div key={s.id} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderBottom: "1px solid " + T.border + "22" }}>
                      <span style={{ fontFamily: mono, fontSize: 13, color: T.mid, flex: 1 }}>{s.tokenConfig?.ticker || s.tokenConfig?.name || "?"} {"\u2014"} <span style={{ color: T.faint, fontSize: 11 }}>{s.tokenCA?.slice(0, 8)}...</span></span>
                      <button onClick={() => sellAndSweep(s.id)} disabled={isSweeping || isClosing} style={{ background: T.red + "15", color: T.red, border: "1px solid " + T.red + "33", fontFamily: mono, fontSize: 11, fontWeight: 700, padding: "5px 10px", borderRadius: 6, cursor: (isSweeping || isClosing) ? "wait" : "pointer", opacity: (isSweeping || isClosing) ? 0.5 : 1 }}>{isSweeping ? "..." : "Close"}</button>
                      <button onClick={async () => { try { const res = await fetch(API + "/api/session/resume", { method: "POST", headers: { "Content-Type": "application/json", "X-Wallet": user?.pubkey }, body: JSON.stringify({ sessionId: s.id, wallet: user?.pubkey }) }); const data = await res.json(); if (data.ok && data.status === "running") { setLaunchCA(data.tokenCA); setLaunched(true); } else if (data.ok) { setSessionDetail(data); } else toast(data.error || "Failed", "error"); } catch (e) { toast(e.message, "error"); } }} style={{ background: T.green + "15", color: T.green, border: "1px solid " + T.green + "33", fontFamily: mono, fontSize: 11, fontWeight: 700, padding: "5px 10px", borderRadius: 6, cursor: "pointer" }}>View</button>
                      <button onClick={() => recoverSession(s.id)} disabled={isRecovering} style={{ background: "none", color: T.faint, border: "1px solid " + T.border, fontFamily: mono, fontSize: 10, fontWeight: 600, padding: "5px 8px", borderRadius: 6, cursor: isRecovering ? "wait" : "pointer", opacity: isRecovering ? 0.5 : 1 }}>{isRecovering ? "..." : "Recover SOL"}</button>
                    </div>
                    {sessionDetail && sessionDetail.session?.id === s.id && (<div style={{ padding: "12px 0" }}>
                      <div style={{ fontFamily: mono, fontSize: 12, color: T.dim, marginBottom: 8 }}>Total SOL in fleet: <span style={{ color: T.green, fontWeight: 700, fontSize: 14 }}>{(sessionDetail.totalBalance || 0).toFixed(4)}</span></div>
                      {sessionDetail.wallets && sessionDetail.wallets.map((w, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontFamily: mono, fontSize: 11, color: T.mid }}><span style={{ width: 70, color: T.faint, textTransform: "capitalize" }}>{w.role}</span><span>{w.pubkey}...</span><span style={{ marginLeft: "auto", fontWeight: 700, color: w.balance > 0 ? T.green : T.faint }}>{w.balance.toFixed(4)} SOL</span></div>))}
                    </div>)}
                  </div>))}
                </div>)}
                </>)}
                {user?.tier === "free" && <div style={{ marginTop: 8 }}><ReferralPanel user={user} T={T} mobile={mobile} /></div>}
              </div>
            )}
          </div>
          {!mobile && <footer style={{ padding: "12px 28px", borderTop: "1px solid " + T.border, marginTop: 32, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: T.faint, fontFamily: mono }}><span>BONDLI v3.3{onlineCount > 0 ? <span style={{ marginLeft: 10, color: T.green, opacity: 0.5, fontSize: 10 }}><span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: T.green, marginRight: 3, verticalAlign: "middle", opacity: 0.7 }} />{onlineCount} online</span> : ""}</span><a href="https://x.com/Bondlifun" target="_blank" rel="noopener" style={{ color: T.dim, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>@Bondlifun</a><span>{launched ? <span style={{ color: T.green }}>{"●"} ACTIVE</span> : "● IDLE"}</span></footer>}
        </div>
      )}
    </ThemeCtx.Provider>
  );
}
