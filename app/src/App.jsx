import{useState,useEffect,useRef,useCallback,Component}from"react";
import{TC,D,L,css,uT}from"./lib/t.js";
import{M,S,API,WS_URL}from"./lib/c.js";
import{hW,wN,fm,fs,tp,dbp,wc,hp}from"./lib/u.js";
import{useSolPrice}from"./hooks/useSolPrice.js";
import a from"./lib/a.js";
const uM=()=>{const[m,s]=useState(()=>typeof window!=="undefined"&&window.innerWidth<700);useEffect(()=>{const q=window.matchMedia("(max-width:700px)");const h=e=>s(e.matches);q.addEventListener("change",h);s(q.matches);return()=>q.removeEventListener("change",h)},[]);return m};
class EB extends Component{constructor(p){super(p);this.state={e:null}}static getDerivedStateFromError(e){return{e}}render(){if(this.state.e)return<div style={{padding:12,margin:6,borderRadius:8,background:"#ff174406",textAlign:"center"}}><span style={{fontFamily:M,fontSize:15,color:"#ff1744"}}>{this.props.l} error </span><button onClick={()=>this.setState({e:null})} style={{marginLeft:6,padding:"4px 12px",borderRadius:5,background:"none",border:"1px solid #ff174422",color:"#ff1744",fontFamily:M,fontSize:13,cursor:"pointer"}}>retry</button></div>;return this.props.children}}

// ═══ ICONS ═══
const Logo=({s:z=26})=><svg width={z} height={z*1.3} viewBox="0 0 30 42" style={{filter:"drop-shadow(0 1px 4px rgba(200,20,20,.35))"}}><defs><linearGradient id="bl1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff5555"/><stop offset="50%" stopColor="#dd1818"/><stop offset="100%" stopColor="#881010"/></linearGradient><linearGradient id="bl2" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#ff4040" stopOpacity=".95"/><stop offset="100%" stopColor="#771010" stopOpacity=".9"/></linearGradient></defs><path d="M15,2 Q23,2 26,8 L27,20 L27,22 L26,34 Q23,40 15,40 L15,2 Z" fill="url(#bl1)"/><path d="M15,2 Q7,2 4,8 L3,20 L3,22 L4,34 Q7,40 15,40 L15,2 Z" fill="url(#bl2)"/><text x="15" y="22" textAnchor="middle" dominantBaseline="central" fontFamily="Arial Black,Arial,sans-serif" fontWeight="900" fontSize="14" fill="#fff" opacity=".06">B</text></svg>;
const IC={
radar:({s:z=16,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><circle cx="12" cy="12" r="10" opacity=".2"/><circle cx="12" cy="12" r="6" opacity=".4"/><circle cx="12" cy="12" r="2"/></svg>,
bags:({s:z=16,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 00-8 0v2"/></svg>,
deploy:({s:z=16,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
trend:({s:z=12,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
fire:({s:z=12,c="#ff6600"})=><svg width={z} height={z} viewBox="0 0 24 24" fill={c}><path d="M12 23c-4.97 0-9-3.58-9-8 0-3.07 2.31-6.64 4.5-9 .42-.45 1.17-.14 1.13.47-.13 1.93.67 3.12 1.37 3.53.2-2.2 1.6-4.5 3.5-6.5.39-.41 1.07-.15 1.07.41 0 2.5 1.5 4.09 3 5.09.27-1.17.43-2.39.43-3.5 0-.36.41-.56.67-.28C21.2 7.82 23 11.1 23 15c0 4.42-4.03 8-9 8h-2z"/></svg>,
star:({s:z=12,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
grad:({s:z=12,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>,
rocket:({s:z=16,c="#00e676"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/></svg>,
key:({s:z=14,c="#ffd600"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>,
shield:({s:z=16,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
gear:({s:z=14,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
users:({s:z=14,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
upload:({s:z=20,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
crown:({s:z=14,c="#ffd600"})=><svg width={z} height={z} viewBox="0 0 24 24" fill={c}><path d="M2 20h20v2H2v-2zm1-7l4.5 3L12 4l4.5 12L21 13l-2 7H5l-2-7z"/></svg>,
copy:({s:z=10,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>,
tw:({s:z=12,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill={c}><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>,
globe:({s:z=12,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>,
tg:({s:z=12,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill={c}><path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>,
zap:({s:z=12,c="#00e676"})=><svg width={z} height={z} viewBox="0 0 24 24" fill={c}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
ph:()=><svg width="16" height="16" viewBox="0 0 128 128" fill="none"><rect width="128" height="128" rx="26" fill="url(#pg)"/><defs><linearGradient id="pg" x1="0" y1="0" x2="128" y2="128"><stop stopColor="#534bb1"/><stop offset="1" stopColor="#551bf9"/></linearGradient></defs><path d="M110.6 64.1c-2.4-11.5-13.4-19.6-24.2-22.6-14.6-4-30.2-1.5-43.2 5.8-8.1 4.5-15.1 11.1-18.5 19.8-4.5 11.5-1.7 25.4 8 33.5 4.5 3.8 10.3 6.2 16.2 6.2 3.6 0 7.1-.7 10.4-2.2 2.4-1.1 4.5-2.7 6.9-3.8 4-1.8 8.5-1.8 12.8-1 4.2.7 8.1 2.6 12.1 4 4.2 1.5 9 2.3 13.2.5 5.6-2.3 9-7.9 8.6-13.8-.2-3.5-.7-6.9-1.3-10.3-.5-2.8-.7-5.6-.7-8.5 0-2.5.2-5.1-.3-7.6z" fill="#fff"/><circle cx="44" cy="68" r="6" fill="#534bb1"/><circle cx="72" cy="68" r="6" fill="#534bb1"/><line x1="38" y1="88" x2="58" y2="88" stroke="#fff" strokeWidth="3" strokeLinecap="round"/><line x1="44" y1="95" x2="72" y2="95" stroke="#fff" strokeWidth="3" strokeLinecap="round"/><line x1="50" y1="102" x2="66" y2="102" stroke="#fff" strokeWidth="3" strokeLinecap="round"/></svg>,
sun:()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
moon:()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
stop:({s:z=12,c="#ff1744"})=><svg width={z} height={z} viewBox="0 0 24 24" fill={c}><rect x="4" y="4" width="16" height="16" rx="2"/></svg>,
sim:({s:z=16,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
sol:({s:z=12})=><svg width={z} height={z} viewBox="0 0 398 312" fill="none"><defs><linearGradient id="sl" x1="360" y1="14" x2="42" y2="298"><stop stopColor="#00FFA3"/><stop offset="1" stopColor="#DC1FFF"/></linearGradient></defs><path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#sl)"/><path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="url(#sl)"/><path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="url(#sl)"/></svg>,
close:({s:z=14,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
brain:({s:z=20,c="#b388ff"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C9.5 2 8 3.5 7.5 5 6 4.5 4 5.5 3.5 7.5 2.5 8 2 9.5 2 11c0 2 1 3.5 2.5 4C4 16 3.5 18 5 19.5c1 1 2.5 1.5 4 1.5h1"/><path d="M12 2c2.5 0 4 1.5 4.5 3C18 4.5 20 5.5 20.5 7.5 21.5 8 22 9.5 22 11c0 2-1 3.5-2.5 4C20 16 20.5 18 19 19.5c-1 1-2.5 1.5-4 1.5h-1"/><path d="M12 2v19"/><path d="M5 10c2 0 3.5.5 4.5 2"/><path d="M19 10c-2 0-3.5.5-4.5 2"/><path d="M6 16c1.5-1 3-1.5 4.5-1"/><path d="M18 16c-1.5-1-3-1.5-4.5-1"/></svg>,
bulb:({s:z=20,c="#b388ff"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/><path d="M12 6v4"/><path d="M10 8h4"/></svg>,
chart:({s:z=20,c="#00e676"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><line x1="16" y1="7" x2="22" y2="7"/><line x1="22" y1="7" x2="22" y2="13"/></svg>,
scan:({s:z=20,c="#00bcd4"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round"><path d="M3 7V5a2 2 0 012-2h2"/><path d="M17 3h2a2 2 0 012 2v2"/><path d="M21 17v2a2 2 0 01-2 2h-2"/><path d="M7 21H5a2 2 0 01-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="M12 5v2M12 17v2M5 12h2M17 12h2"/></svg>,
bolt:({s:z=20,c="#ffd600"})=><svg width={z} height={z} viewBox="0 0 24 24" fill={c} stroke="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
fleet:({s:z=20,c="#ff1744"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><circle cx="12" cy="16" r="3"/><path d="M10.5 9.5l1 4.5M13.5 9.5l-1 4.5M5.5 9.5l4.5 5M18.5 9.5l-4.5 5"/></svg>,
eye:({s:z=20,c="#ff9800"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><path d="M12 5v-.5M12 19v.5" strokeDasharray="2 2"/></svg>,
};
const Sp=({s:z=12,c})=><svg width={z} height={z} viewBox="0 0 24 24" style={{animation:"sp .7s linear infinite"}}><circle cx="12" cy="12" r="10" fill="none" stroke={c||"#00e676"} strokeWidth="3" strokeDasharray="31.4" strokeLinecap="round"/></svg>;
const Av=({pk,s:z=18})=>{const h=hW(pk||"x"),hu=h%360;return<svg width={z} height={z}><rect width={z} height={z} rx={z*.25} fill={`hsl(${hu},55%,42%)`}/></svg>};
const SpkC=({data=[],color="#00e676",h:H=28})=>{const ref=useRef(null);useEffect(()=>{const cv=ref.current;if(!cv)return;const pts=data.filter(v=>v>0);if(pts.length<2)return;const ctx=cv.getContext("2d");const dpr=window.devicePixelRatio||2;const w=cv.width=cv.offsetWidth*dpr;const HH=cv.height=H*dpr;ctx.clearRect(0,0,w,HH);const mn=Math.min(...pts),mx=Math.max(...pts),rng=mx-mn||1;const pH=HH*.75;
// Volume micro-bars (bottom 25%)
const vH=HH*.22;const vY=HH-vH;ctx.globalAlpha=.15;for(let i=1;i<pts.length;i++){const x=(i/(pts.length-1))*(w-2)+1;const delta=Math.abs(pts[i]-pts[i-1])/rng;const bh=Math.max(1,delta*vH*3);const isUp=pts[i]>=pts[i-1];ctx.fillStyle=isUp?color:"#ff4444";ctx.fillRect(x-1,HH-bh,Math.max(1,w/pts.length*.6),bh)}ctx.globalAlpha=1;
// Glow line (wider, blurred)
ctx.save();ctx.filter=`blur(${dpr}px)`;ctx.beginPath();ctx.strokeStyle=color+"44";ctx.lineWidth=4;ctx.lineJoin="round";for(let i=0;i<pts.length;i++){const x=(i/(pts.length-1))*(w-2)+1,y=2+((mx-pts[i])/rng)*pH;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)}ctx.stroke();ctx.restore();
// Main line
ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.lineJoin="round";for(let i=0;i<pts.length;i++){const x=(i/(pts.length-1))*(w-2)+1,y=2+((mx-pts[i])/rng)*pH;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)}ctx.stroke();
// Gradient fill
const gf=ctx.createLinearGradient(0,0,0,pH+4);gf.addColorStop(0,color+"22");gf.addColorStop(.6,color+"08");gf.addColorStop(1,color+"00");ctx.lineTo(w-1,pH+4);ctx.lineTo(1,pH+4);ctx.closePath();ctx.fillStyle=gf;ctx.fill();
// Endpoint dot
const lastY=2+((mx-pts[pts.length-1])/rng)*pH;ctx.beginPath();ctx.arc(w-2,lastY,2*dpr,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.beginPath();ctx.arc(w-2,lastY,4*dpr,0,Math.PI*2);ctx.fillStyle=color+"22";ctx.fill()},[data,color,H]);if(!data||data.filter(v=>v>0).length<2)return<div style={{width:"100%",height:H}}/>;return<canvas ref={ref} style={{width:"100%",height:H,display:"block"}}/>};
function B({children,onClick,color,ghost,disabled:dis,small,full,style:sx={}}){const T=uT(),c=color||T.gn,[h,sH]=useState(false);return<button onClick={dis?undefined:(ev)=>{hp([6],ev);onClick?.()}} onMouseEnter={()=>sH(true)} onMouseLeave={()=>sH(false)} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:5,padding:small?"9px 14px":"13px 22px",borderRadius:8,fontFamily:M,fontSize:small?16:18,fontWeight:700,cursor:dis?"not-allowed":"pointer",opacity:dis?.28:1,width:full?"100%":undefined,WebkitTapHighlightColor:"transparent",border:ghost?"1px solid "+c+"28":"none",background:ghost?(h?c+"0c":"transparent"):(h?c+"dd":c),color:ghost?c:(T.mo==="light"?"#fff":T.bg),transform:h&&!dis?"translateY(-1px)":"none",transition:"all .1s ease",...sx}}>{children}</button>}
function In({value,onChange,placeholder,...p}){const T=uT(),[f,sF]=useState(false);return<input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} onFocus={()=>sF(true)} onBlur={()=>sF(false)} style={{width:"100%",padding:"11px 13px",background:T.bg,border:"1px solid "+(f?T.gn+"33":T.bd),borderRadius:8,color:T.tx,fontFamily:M,fontSize:16,outline:"none",transition:"border-color .12s"}} {...p}/>}
function NI({label,value,onChange,min,max,step:s=1,decimals:d}){const T=uT();return<div style={{background:T.bg,borderRadius:8,border:"1px solid "+T.bd,padding:"8px 10px"}}><div style={{fontSize:13,fontFamily:M,fontWeight:700,color:T.ft,textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>{label}</div><div style={{display:"flex"}}><button onClick={(ev)=>{hp([3],ev);onChange(Math.max(min,parseFloat((value-s).toFixed(6))))}} style={{width:32,height:32,borderRadius:"5px 0 0 5px",border:"1px solid "+T.bd,background:T.sf,color:T.dm,fontSize:16,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>−</button><div style={{flex:1,height:32,display:"flex",alignItems:"center",justifyContent:"center",background:T.sf,borderTop:"1px solid "+T.bd,borderBottom:"1px solid "+T.bd,fontFamily:M,fontSize:16,fontWeight:800,color:T.gn}}>{d!=null?value.toFixed(d):(s<1?parseFloat(value.toFixed(6)):value)}</div><button onClick={(ev)=>{hp([3],ev);onChange(Math.min(max,parseFloat((value+s).toFixed(6))))}} style={{width:32,height:32,borderRadius:"0 5px 5px 0",border:"1px solid "+T.bd,background:T.sf,color:T.dm,fontSize:16,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>+</button></div></div>}
function ImgUp({image,onChange,mb}){const T=uT(),ref=useRef(null);const read=f=>{const r=new FileReader();r.onload=()=>onChange(r.result);r.readAsDataURL(f)};return<div onClick={()=>ref.current?.click()} onDrop={e=>{e.preventDefault();if(e.dataTransfer.files[0])read(e.dataTransfer.files[0])}} onDragOver={e=>e.preventDefault()} style={{width:mb?88:110,height:mb?88:110,borderRadius:10,border:"1px dashed "+(image?T.gn+"33":T.bd),background:image?"url("+image+") center/cover":T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,cursor:"pointer",flexShrink:0,position:"relative"}}>{!image&&<><IC.upload s={22} c={T.dm}/><span style={{fontSize:11,color:T.ft,fontFamily:M}}>512x512</span></>}<input ref={ref} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{if(e.target.files?.[0])read(e.target.files[0])}}/></div>}
const tk=s=>s?s.replace(/^\$/,""):s||"";
const solFmt=n=>n<.001?"0":n<1?n.toFixed(3).replace(/0+$/,"").replace(/\.$/,""):n<100?n.toFixed(2):Math.round(n)+"";
// Image proxy: route ALL external images through backend to avoid CORS/blocking
const imgProxy=u=>!u?"":u.startsWith("data:")?u:u.startsWith("/")?u:API+"/api/img?url="+encodeURIComponent(u);
// Resilient token image component — retries on failure, shows fallback letter
function TImg({src,ticker,size,style:sx={}}){const[ok,sOk]=useState(true);const[retries,sR]=useState(0);const proxyUrl=imgProxy(src);const letter=(tk(ticker)||"?")[0];if(!src||!ok)return<div style={{width:size,height:size,display:"flex",alignItems:"center",justifyContent:"center",fontSize:Math.max(12,size*.35),color:"#3a3a50"+"33",fontWeight:900,...sx}}>{letter}</div>;return<img src={retries>0?proxyUrl+(proxyUrl.includes("?")?"&":"?")+"r="+retries:proxyUrl} style={{width:"100%",height:"100%",objectFit:"cover",...sx}} alt="" loading="lazy" onError={()=>{if(retries<2)setTimeout(()=>sR(r=>r+1),1500*(retries+1));else sOk(false)}}/>}
// MC correction: server uses * 170, we recalculate with live price
const fixMc=(t,solPrice)=>{if(t.mcapSol&&solPrice)return Math.round(t.mcapSol*solPrice);if(t.marketCapSol&&solPrice)return Math.round(t.marketCapSol*solPrice);return t.mcapUsd||0};
const PRESETS=[{name:"Quick",sol:.3,snc:0,slip:25,dur:15,jt:.001,desc:"Deploy only — add vol later"},{name:"Scout",sol:1,snc:1,slip:20,dur:30,jt:.001,desc:"1 SOL + 1 sniper"},{name:"Standard",sol:2,snc:2,slip:25,dur:60,jt:.001,desc:"2 SOL + fleet"},{name:"Swarm",sol:10,snc:3,slip:30,dur:120,jt:.002,desc:"Full fleet"}];

// ═══ POSITION ANALYTICS — dual-axis score+price chart with TP/SL zones ═══
function PositionAnalytics({positions,settings,T,mb}){
const histRef=useRef({});// {ca: [{t,score,pct}]}
const canvasRefs=useRef({});
// Accumulate data points from position snapshots
useEffect(()=>{if(!positions?.length)return;const h=histRef.current;const now=Date.now();positions.forEach(p=>{if(!p.ca||p.liveScore==null)return;if(!h[p.ca])h[p.ca]=[];const pts=h[p.ca];// Dedupe: skip if last point was <2s ago
if(pts.length>0&&now-pts[pts.length-1].t<2000)return;pts.push({t:now,score:p.liveScore??p.entryScore??0,pct:p.changePct??0,mcap:p.currentMcap??0});if(pts.length>120)pts.splice(0,pts.length-120)});// Clean stale CAs
const activeCAs=new Set(positions.map(p=>p.ca));Object.keys(h).forEach(ca=>{if(!activeCAs.has(ca))delete h[ca]})},[positions]);
// Draw charts
useEffect(()=>{if(!positions?.length)return;const S=settings||{};positions.forEach(p=>{if(!p.ca)return;const cv=canvasRefs.current[p.ca];if(!cv)return;const pts=histRef.current[p.ca];if(!pts||pts.length<2)return;const ctx=cv.getContext("2d");const dpr=window.devicePixelRatio||2;const W=cv.offsetWidth*dpr;const H=cv.offsetHeight*dpr;cv.width=W;cv.height=H;ctx.clearRect(0,0,W,H);
const pad={l:28*dpr,r:28*dpr,t:6*dpr,b:14*dpr};const cW=W-pad.l-pad.r;const cH=H-pad.t-pad.b;
// Data ranges
const scores=pts.map(d=>d.score);const pcts=pts.map(d=>d.pct);
const sMin=Math.min(0,...scores);const sMax=Math.max(100,...scores);
const pMin=Math.min(-(S.sl2||30),...pcts,-5);const pMax=Math.max(S.tp3||150,...pcts,20);
const sRng=sMax-sMin||1;const pRng=pMax-pMin||1;
const xOf=i=>(pad.l+(i/(pts.length-1))*cW);
const sY=v=>(pad.t+((sMax-v)/sRng)*cH);
const pY=v=>(pad.t+((pMax-v)/pRng)*cH);
// Grid lines
ctx.strokeStyle=T.bd+"44";ctx.lineWidth=1;
[0,25,50,75,100].forEach(v=>{if(v>=sMin&&v<=sMax){const y=sY(v);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke()}});
// TP zones (green dashed)
ctx.setLineDash([4*dpr,3*dpr]);
const tpLevels=[{v:S.tp1||35,l:"TP1"},{v:S.tp2||80,l:"TP2"},{v:S.tp3||150,l:"TP3"}];
tpLevels.forEach(tp=>{if(tp.v<=pMax){const y=pY(tp.v);ctx.strokeStyle="#00e676"+(tp.l==="TP3"?"44":"66");ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();ctx.fillStyle="#00e67688";ctx.font=`${7*dpr}px monospace`;ctx.textAlign="right";ctx.fillText(tp.l+" +"+tp.v+"%",W-pad.r-2*dpr,y-2*dpr)}});
// SL zones (red dashed)
const slLevels=[{v:-(S.sl1||15),l:"SL1"},{v:-(S.sl2||30),l:"SL2"}];
slLevels.forEach(sl=>{if(sl.v>=pMin){const y=pY(sl.v);ctx.strokeStyle="#ff174466";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();ctx.fillStyle="#ff174488";ctx.font=`${7*dpr}px monospace`;ctx.textAlign="right";ctx.fillText(sl.l+" "+sl.v+"%",W-pad.r-2*dpr,y+9*dpr)}});
ctx.setLineDash([]);
// Zero line for price
const zeroY=pY(0);ctx.strokeStyle=T.dm+"44";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad.l,zeroY);ctx.lineTo(W-pad.r,zeroY);ctx.stroke();
// Price change area fill
const lastPct=pcts[pcts.length-1];const pColor=lastPct>=0?"#00e676":"#ff1744";
ctx.beginPath();ctx.moveTo(xOf(0),pY(0));
for(let i=0;i<pts.length;i++)ctx.lineTo(xOf(i),pY(pts[i].pct));
ctx.lineTo(xOf(pts.length-1),pY(0));ctx.closePath();
const gf=ctx.createLinearGradient(0,pad.t,0,H-pad.b);gf.addColorStop(0,pColor+"22");gf.addColorStop(1,pColor+"04");ctx.fillStyle=gf;ctx.fill();
// Price line
ctx.beginPath();ctx.strokeStyle=pColor;ctx.lineWidth=1.5*dpr;ctx.lineJoin="round";
for(let i=0;i<pts.length;i++){const x=xOf(i),y=pY(pts[i].pct);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)}ctx.stroke();
// Score line (purple, thinner)
ctx.beginPath();ctx.strokeStyle=T.pu||"#b388ff";ctx.lineWidth=1.2*dpr;ctx.lineJoin="round";
for(let i=0;i<pts.length;i++){const x=xOf(i),y=sY(pts[i].score);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)}ctx.stroke();
// Score endpoint glow
const lastScore=scores[scores.length-1];const lastSY=sY(lastScore);const lastX=xOf(pts.length-1);
ctx.beginPath();ctx.arc(lastX,lastSY,3*dpr,0,Math.PI*2);ctx.fillStyle=T.pu||"#b388ff";ctx.fill();
ctx.beginPath();ctx.arc(lastX,lastSY,6*dpr,0,Math.PI*2);ctx.fillStyle=(T.pu||"#b388ff")+"33";ctx.fill();
// Price endpoint
const lastPY=pY(lastPct);ctx.beginPath();ctx.arc(lastX,lastPY,3*dpr,0,Math.PI*2);ctx.fillStyle=pColor;ctx.fill();
// Y-axis labels — score (left)
ctx.font=`${7*dpr}px monospace`;ctx.textAlign="right";ctx.fillStyle=(T.pu||"#b388ff")+"88";
[0,50,100].forEach(v=>{if(v>=sMin&&v<=sMax)ctx.fillText(v+"",pad.l-3*dpr,sY(v)+3*dpr)});
// Y-axis labels — price (right)
ctx.textAlign="left";ctx.fillStyle=T.dm+"88";
[pMin,0,pMax].forEach(v=>{const lbl=(v>=0?"+":"")+Math.round(v)+"%";ctx.fillText(lbl,W-pad.r+3*dpr,pY(v)+3*dpr)});
// Time labels (bottom)
ctx.textAlign="center";ctx.fillStyle=T.ft+"88";ctx.font=`${6*dpr}px monospace`;
const first=pts[0].t;const last=pts[pts.length-1].t;
if(last-first>5000){[0,Math.floor(pts.length/2),pts.length-1].forEach(i=>{const ago=Math.round((last-pts[i].t)/1000);const lbl=ago>0?ago+"s ago":"now";ctx.fillText(lbl,xOf(i),H-2*dpr)})}
})},[positions,settings]);
// Momentum exit threshold line at -30 score drop
const S=settings||{};
if(!positions?.length)return null;
const posWithScore=positions.filter(p=>p.liveScore!=null||p.entryScore!=null);
if(!posWithScore.length)return null;
return<div style={{background:T.bg,borderRadius:8,border:"1px solid "+(T.pu||"#b388ff")+"22",padding:mb?8:10,marginTop:8}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
<IC.chart s={14} c={T.pu||"#b388ff"}/>
<span style={{fontSize:11,fontWeight:800,color:T.pu||"#b388ff"}}>Position Analytics</span>
<span style={{fontSize:8,color:T.ft}}>live</span>
<span style={{marginLeft:"auto",display:"flex",gap:6,fontSize:7,color:T.ft}}>
<span style={{display:"flex",alignItems:"center",gap:2}}><span style={{width:8,height:2,background:T.pu||"#b388ff",borderRadius:1,display:"inline-block"}}/>score</span>
<span style={{display:"flex",alignItems:"center",gap:2}}><span style={{width:8,height:2,background:"#00e676",borderRadius:1,display:"inline-block"}}/>P&L</span>
</span>
</div>
{posWithScore.map(p=>{const pts=histRef.current[p.ca]||[];const trend=p.scoreTrend;const vel=p.scoreVelocity;const acc=p.scoreAcceleration;
const trendColor=trend==="rocket"||trend==="rising"?T.gn:trend==="fading"||trend==="crashing"?T.rd:T.ft;
const trendIcon=trend==="rocket"?"🚀":trend==="rising"?"↑":trend==="crashing"?"💥":trend==="fading"?"↓":"—";
const scoreDrop=(p.entryScore||0)-(p.liveScore||0);
const exitZone=scoreDrop>=20;
return<div key={p.ca} style={{marginBottom:posWithScore.length>1?8:0}}>
{/* Position header */}
<div style={{display:"flex",alignItems:"center",gap:4,marginBottom:4}}>
<span style={{fontSize:10,fontWeight:800,color:T.tx,flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{p.name||p.ca?.slice(0,8)}</span>
<span style={{fontSize:9,fontWeight:800,color:(p.changePct||0)>=0?T.gn:T.rd}}>{(p.changePct||0)>=0?"+":""}{(p.changePct||0).toFixed(1)}%</span>
</div>
{/* Score gauges row */}
<div style={{display:"flex",gap:4,marginBottom:4}}>
{/* Live Score */}
<div style={{flex:1,background:T.sf,borderRadius:4,padding:"3px 6px",border:"1px solid "+(exitZone?T.rd:T.bd)+"33"}}>
<div style={{fontSize:6,color:T.ft,fontWeight:700}}>SCORE</div>
<div style={{display:"flex",alignItems:"baseline",gap:2}}>
<span style={{fontSize:14,fontWeight:900,color:exitZone?T.rd:(p.liveScore||0)>=50?T.gn:(p.liveScore||0)>=25?T.yl:T.ft}}>{p.liveScore??p.entryScore??0}</span>
<span style={{fontSize:7,color:T.ft}}>/{p.entryScore||0}</span>
</div>
{scoreDrop>0&&<div style={{fontSize:7,color:scoreDrop>=30?T.rd:scoreDrop>=20?T.yl:T.ft,fontWeight:700}}>−{scoreDrop}{scoreDrop>=30?" EXIT":scoreDrop>=20?" TIGHT":""}</div>}
</div>
{/* Velocity */}
<div style={{flex:1,background:T.sf,borderRadius:4,padding:"3px 6px"}}>
<div style={{fontSize:6,color:T.ft,fontWeight:700}}>VELOCITY</div>
<div style={{fontSize:12,fontWeight:900,color:vel>0?T.gn:vel<-0.1?T.rd:T.ft}}>{vel!=null?(vel>0?"+":"")+vel.toFixed(2)+"/s":"—"}</div>
{/* Velocity bar */}
{vel!=null&&<div style={{height:3,borderRadius:2,background:T.bd,marginTop:2,overflow:"hidden"}}>
<div style={{width:Math.min(100,Math.abs(vel)*100)+"%",height:"100%",borderRadius:2,marginLeft:vel<0?"auto":0,background:vel>0?T.gn:T.rd,transition:"width .3s"}}/>
</div>}
</div>
{/* Acceleration */}
<div style={{flex:1,background:T.sf,borderRadius:4,padding:"3px 6px"}}>
<div style={{fontSize:6,color:T.ft,fontWeight:700}}>ACCEL</div>
<div style={{fontSize:12,fontWeight:900,color:acc>0?T.gn:acc<-0.01?T.rd:T.ft}}>{acc!=null?(acc>0?"+":"")+acc.toFixed(3):"—"}</div>
</div>
{/* Trend */}
<div style={{background:trendColor+"12",borderRadius:4,padding:"3px 6px",border:"1px solid "+trendColor+"22",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minWidth:40}}>
<div style={{fontSize:12}}>{trendIcon}</div>
<div style={{fontSize:7,fontWeight:800,color:trendColor,textTransform:"uppercase"}}>{trend||"—"}</div>
</div>
</div>
{/* Canvas chart */}
<canvas ref={el=>{if(el)canvasRefs.current[p.ca]=el}} style={{width:"100%",height:mb?100:130,display:"block",borderRadius:4,background:T.sf}}/>
{/* Time + data points */}
<div style={{display:"flex",justifyContent:"space-between",marginTop:2}}>
<span style={{fontSize:7,color:T.ft}}>{pts.length} samples</span>
<span style={{fontSize:7,color:T.ft}}>{p.age||0}m old</span>
</div>
</div>})}
</div>}

// ═══ CANDLESTICK CHART — OHLC + volume + crosshair ═══
function CandleChart({ca,T,mb}){
return<div style={{width:"100%",borderRadius:6,overflow:"hidden",background:T.bg}}>
<iframe src={`https://www.gmgn.cc/kline/sol/${ca}?theme=dark&interval=15s&header=0`} style={{width:"100%",height:mb?220:300,border:"none",display:"block"}} title="chart" loading="lazy" sandbox="allow-scripts allow-same-origin"/>
<div style={{display:"flex",gap:6,padding:"4px 8px",borderTop:"1px solid "+T.bd}}>
<a href={`https://pump.fun/coin/${ca}`} target="_blank" rel="noopener" style={{fontSize:13,color:T.gn,textDecoration:"none",fontWeight:700}}>open full chart →</a>
<a href={`https://dexscreener.com/solana/${ca}`} target="_blank" rel="noopener" style={{fontSize:13,color:T.dm,textDecoration:"none"}}>dexscreener →</a>
</div></div>}

// ═══ TOKEN DETAIL — full inspection panel ═══
function TokenDetail({t,T,mb,trB,buying,selling,sBuy,sSell,quickBuy,quickSell,toast,held,onClose,solP}){
const isH=held.has(t.ca);
useEffect(()=>{const h=e=>{if(e.key==="Escape")onClose()};window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h)},[onClose]);
const SL=({href,icon:Ic,label})=>href?<a href={href} target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:5,padding:"7px 12px",background:T.bg,border:"1px solid "+T.bd,borderRadius:5,fontSize:14,color:T.md,textDecoration:"none",fontWeight:600}}><Ic s={14} c={T.md}/>{label}</a>:null;
return<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden",animation:"su .25s ease",margin:mb?"0 0 6px":"0 0 8px"}}>
{/* Header with large image */}
<div style={{display:"flex",gap:12,padding:mb?10:14,borderBottom:"1px solid "+T.bd}}>
<div style={{width:mb?80:100,height:mb?80:100,borderRadius:10,overflow:"hidden",background:T.bg,flexShrink:0}}><TImg src={t.image} ticker={t.ticker} size={mb?80:100}/></div>
<div style={{flex:1,minWidth:0}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}><span style={{fontSize:mb?26:32,fontWeight:900}}>{t.name||tk(t.ticker)}</span><span style={{fontSize:17,color:T.gn,fontWeight:700}}>{tk(t.ticker)}</span>{isH&&<span style={{fontSize:13,fontWeight:800,padding:"3px 8px",borderRadius:3,background:T.gn+"18",color:T.gn}}>HELD</span>}{t.bundled&&<span style={{fontSize:13,fontWeight:800,padding:"3px 8px",borderRadius:3,background:T.or+"18",color:T.or}}>BUNDLED</span>}{t.graduated&&<span style={{fontSize:13,fontWeight:800,padding:"3px 8px",borderRadius:3,background:T.yl+"18",color:T.yl}}>GRADUATED</span>}{t.dexBoosted&&<span style={{fontSize:13,fontWeight:800,padding:"3px 8px",borderRadius:3,background:"#ffd60018",color:"#ffd600"}} title={"Boosted: $"+(t.boostAmount||0)}>DEX BOOST{t.boostAmount>0?" $"+t.boostAmount:""}</span>}</div>
<div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:4}}><span style={{fontSize:mb?32:40,fontWeight:900,color:fixMc(t,solP)>=1e6?"#ffaa00":fixMc(t,solP)>=1e5?T.gn:T.tx}}>${fm(fixMc(t,solP))}</span>{t.h1Change!=null&&<span style={{fontSize:20,fontWeight:700,color:t.h1Change>0?T.gn:"#ff4444"}}>{t.h1Change>0?"+":""}{t.h1Change.toFixed(1)}%</span>}</div>
{/* Social links — always visible */}
<div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
<SL href={t.twitter?("https://twitter.com/"+(t.twitter.startsWith("@")?t.twitter.slice(1):t.twitter)):null} icon={IC.tw} label="Twitter"/>
<SL href={t.website} icon={IC.globe} label="Website"/>
<SL href={t.telegram?("https://t.me/"+(t.telegram.startsWith("@")?t.telegram.slice(1):t.telegram)):null} icon={IC.tg} label="Telegram"/>
<a href={"https://pump.fun/coin/"+t.ca} target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:4,padding:"6px 10px",background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:5,fontSize:14,color:T.gn,textDecoration:"none",fontWeight:700}}>pump.fun</a>
<a href={"https://www.gmgn.cc/sol/token/"+t.ca} target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 12px",background:T.bg,border:"1px solid "+T.bd,borderRadius:5,fontSize:14,color:T.dm,textDecoration:"none"}}>gmgn</a>
<a href={"https://dexscreener.com/solana/"+t.ca} target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 12px",background:T.bg,border:"1px solid "+T.bd,borderRadius:5,fontSize:14,color:T.dm,textDecoration:"none"}}>dex</a>
</div>
</div>
<button onClick={onClose} style={{background:T.bg,border:"1px solid "+T.bd,cursor:"pointer",color:T.dm,padding:"6px 12px",alignSelf:"flex-start",flexShrink:0,borderRadius:6,display:"flex",alignItems:"center",gap:4,fontSize:15,fontFamily:M,fontWeight:700}}><IC.close s={14} c={T.dm}/> Close</button>
</div>
{/* Description */}
{t.description&&<div style={{padding:"8px 14px",fontSize:16,color:T.dm,borderBottom:"1px solid "+T.bd,lineHeight:1.5}}>{t.description.length>200?t.description.slice(0,200)+"…":t.description}</div>}
{/* Chart — canvas candlestick with OHLC + volume */}
<CandleChart ca={t.ca} T={T} mb={mb}/>
{/* CA copy */}
<div style={{padding:"5px 14px",borderTop:"1px solid "+T.bd,display:"flex",alignItems:"center",gap:4}}>
<button onClick={()=>{navigator.clipboard?.writeText(t.ca);toast("Copied","success")}} style={{padding:"5px 8px",background:"none",border:"1px solid "+T.bd,borderRadius:4,fontSize:13,color:T.ft,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}><IC.copy s={12}/>{t.ca}</button>
{t.age!=null&&<span style={{fontSize:13,color:T.ft,marginLeft:"auto"}}>{t.age>=24?Math.floor(t.age/24)+"d":Math.round(t.age)+"h"} old</span>}
</div>
{/* Buy/Sell */}
<div style={{padding:"6px 14px 10px"}}>
<div style={{display:"flex",gap:4,marginBottom:isH?6:0}}><span style={{fontSize:14,color:T.gn,fontWeight:700,width:36,alignSelf:"center"}}>BUY</span>{[.05,.1,.25,.5,1].map(amt=>{const ok=(trB||0)>=amt;const ld=buying===t.ca+amt;return<button key={amt} disabled={!ok||ld} onClick={async()=>{sBuy(t.ca+amt);try{await quickBuy(t.ca,amt);toast(`+${amt}`,"success")}catch(er){toast(er.message,"error")}sBuy(null)}} style={{padding:"10px 0",flex:1,background:ok?T.gn+"06":"transparent",border:"1px solid "+(ok?T.gn+"22":T.bd),borderRadius:5,fontSize:13,fontWeight:800,color:ok?T.gn:T.ft,cursor:ok&&!ld?"pointer":"default",opacity:ok?1:.2}}>{ld?<Sp s={8}/>:amt}</button>})}</div>
{isH&&<div style={{display:"flex",gap:4}}><span style={{fontSize:14,color:"#ff4444",fontWeight:700,width:36,alignSelf:"center"}}>SELL</span>{[25,50,100].map(pct=>{const ld=selling===t.ca+pct;return<button key={pct} disabled={ld} onClick={async()=>{sSell(t.ca+pct);try{await quickSell(t.ca,pct);toast(`Sold ${pct}%`,"success")}catch(er){toast(er.message,"error")}sSell(null)}} style={{padding:"10px 0",flex:1,background:"#ff444406",border:"1px solid #ff444418",borderRadius:5,fontSize:13,fontWeight:800,color:"#ff4444",cursor:ld?"default":"pointer"}}>{ld?<Sp s={8} c="#ff4444"/>:pct===100?"ALL":pct+"%"}</button>})}</div>}
</div></div>}

// ═══ SIMULATION — pump.fun bonding curve simulator ═══
function SimMode({mb,budget:extBudget,sniperCount,gradMc:gMc}){const T=uT();const cvRef=useRef(null);const frame=useRef(0);
const st=useRef({p:.00001,pts:[],buys:[],sells:[],noise:[],mc:0,sig:"WAIT",ph:"idle",spent:0,back:0,bonded:false,bondProb:0,peakMc:0,roi:0});
const[running,sR]=useState(false);const budget=extBudget||2;const[speed,sSpeed]=useState(1);const[tick,sTick]=useState(0);const snprs=sniperCount||2;const gradMc=gMc||34000;
const PHASES={scan:"Scanning for entry — analyzing first trades",accumulate:"Fleet buying in — staggered Gaussian timing",hold:"Holding position — monitoring opponent behavior",distribute:"Selling into demand — taking profit",sweep:"Final sweep — recovering all SOL from fleet wallets",complete:"Session complete — all funds returned"};
const calcBondProb=(mc,mom,bp)=>{if(mc>=gradMc)return 100;const base=Math.min(80,(mc/gradMc)*100);const m=mom>0?Math.min(15,mom*500):Math.max(-20,mom*300);const b=bp>0.5?10:bp>0.3?5:0;return Math.max(0,Math.min(99,Math.round(base+m+b)))};
useEffect(()=>{if(!running)return;const s=st.current;s.p=.000006+Math.random()*.000008;s.pts=[];s.buys=[];s.sells=[];s.noise=[];s.mc=0;s.spent=0;s.back=0;s.bonded=false;s.bondProb=0;s.peakMc=0;s.roi=0;s.ph="scan";s.sig="SCAN";frame.current=0;
const doTick=()=>{const f=++frame.current;const pr=s.p;
const phase=f<40?"scan":f<140?"accumulate":f<220?"hold":f<350?"distribute":f<420?"sweep":"complete";
const buyP=phase==="accumulate"?.6:phase==="hold"?.3:phase==="scan"?.1:0;
const sellP=phase==="distribute"?.5:phase==="sweep"?.7:0;
s.p=Math.max(.000001,pr+(Math.random()-.48)*pr*.05+buyP*pr*.004-sellP*pr*.003+(Math.random()>.7?1:-1)*pr*.002);
s.mc=s.p*1e9;if(s.mc>s.peakMc)s.peakMc=s.mc;s.pts.push(s.p);if(s.pts.length>600)s.pts.shift();
const mom=s.pts.length>10?(s.pts[s.pts.length-1]-s.pts[s.pts.length-10])/(s.pts[s.pts.length-10]||1):0;
s.bondProb=calcBondProb(s.mc,mom,buyP);s.ph=phase;
if(phase==="accumulate"&&f%6===0&&s.spent<budget*.6){s.buys.push({f,p:s.p,amt:budget*.02+Math.random()*budget*.025});s.spent+=budget*.03;s.sig="BUY"}
else if(phase==="hold"){s.sig="HOLD";if(f%18===0)s.noise.push({f,sell:Math.random()>.45})}
else if(phase==="distribute"&&f%8===0){s.sells.push({f,p:s.p,amt:budget*.04});s.back+=budget*.04*(1.1+Math.random()*.5);s.sig=f>300?"EXIT":"SELL"}
else if(phase==="sweep"){s.sig="SWEEP";if(f%4===0&&s.back<s.spent*1.3){s.sells.push({f,p:s.p,amt:budget*.05});s.back+=budget*.05*.7}}
else if(phase==="complete"){s.sig="DONE";s.bonded=s.mc>=gradMc}
else if(phase==="scan"){s.sig="SCAN";if(f%12===0)s.noise.push({f,sell:Math.random()>.5})}
s.roi=s.spent>0?((s.back-s.spent)/s.spent*100):0;sTick(f);
const cv=cvRef.current;if(!cv)return;const ctx=cv.getContext("2d");const dpr=window.devicePixelRatio||2;const w=cv.width=cv.offsetWidth*dpr;const h=cv.height=(mb?180:240)*dpr;ctx.clearRect(0,0,w,h);
const pts=s.pts;if(pts.length<2)return;const mn=Math.min(...pts),mx=Math.max(...pts),rng=mx-mn||1;
ctx.strokeStyle=T.bd;ctx.lineWidth=.5;for(let i=0;i<5;i++){const y=8+h*.85*(i/4);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
const bondP=gradMc/1e9;if(bondP>=mn*.5&&bondP<=mx*1.5){const by=h-8-((Math.min(bondP,mx)-mn)/rng)*(h-16);if(by>0&&by<h){ctx.setLineDash([8,4]);ctx.strokeStyle=T.yl+"55";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,by);ctx.lineTo(w,by);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=T.yl;ctx.font=`${Math.round(5*dpr)}px monospace`;ctx.fillText("BOND $"+(gradMc/1000).toFixed(0)+"K",w-Math.round(40*dpr),by-4)}}
ctx.beginPath();ctx.strokeStyle=T.gn;ctx.lineWidth=2;ctx.lineJoin="round";
for(let i=0;i<pts.length;i++){const x=(i/(pts.length-1))*(w-4)+2;const y=h-8-((pts[i]-mn)/rng)*(h-16);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)}ctx.stroke();
const gf=ctx.createLinearGradient(0,0,0,h);gf.addColorStop(0,T.gn+"18");gf.addColorStop(1,T.gn+"01");ctx.lineTo(w-2,h);ctx.lineTo(2,h);ctx.closePath();ctx.fillStyle=gf;ctx.fill();
const mark=(fi,color,sz)=>{const bi=Math.round((fi/f)*pts.length);if(bi<0||bi>=pts.length)return;const x=(bi/(pts.length-1))*(w-4)+2;const y=h-8-((pts[bi]-mn)/rng)*(h-16);ctx.beginPath();ctx.arc(x,y,sz*2,0,Math.PI*2);ctx.fillStyle=color+"33";ctx.fill();ctx.beginPath();ctx.arc(x,y,sz,0,Math.PI*2);ctx.fillStyle=color;ctx.fill()};
s.buys.forEach(b=>mark(b.f,"#00e676",3));s.sells.forEach(b=>mark(b.f,"#ff1744",3));s.noise.forEach(n=>mark(n.f,n.sell?"#ff174444":"#00e67644",2));
};const iv=setInterval(doTick,35/speed);return()=>clearInterval(iv)},[running,budget,speed,mb]);
const s=st.current;const pnl=s.back-s.spent;
const[simOpen,sSimOpen]=useState(false);
return<div style={{background:T.sf,border:"1px solid "+T.pu+"18",borderRadius:10,overflow:"hidden",animation:"si .2s ease"}}>
<div onClick={()=>sSimOpen(!simOpen)} style={{padding:"8px 12px",cursor:"pointer",borderBottom:simOpen?"1px solid "+T.bd:"none"}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<div style={{display:"flex",alignItems:"center",gap:5}}><IC.sim s={14} c={T.pu}/><span style={{fontSize:12,fontWeight:800}}>Launch Preview</span>{running&&<span style={{width:5,height:5,borderRadius:"50%",background:T.gn,animation:"gp 2s infinite"}}/>}{!simOpen&&s.ph!=="idle"&&<span style={{fontSize:9,color:T.dm}}>{s.bondProb}% bond • ${fm(s.mc)} MC • {s.ph}</span>}</div>
<div style={{display:"flex",gap:2,alignItems:"center"}} onClick={e=>e.stopPropagation()}>
{simOpen&&<><button onClick={()=>sSpeed(speed>=4?1:speed*2)} style={{background:"none",border:"1px solid "+T.bd,borderRadius:4,padding:"1px 7px",fontSize:11,color:T.dm,cursor:"pointer"}}>{speed}x</button><button onClick={()=>sR(!running)} style={{background:running?T.rd+"0c":T.gn+"0c",border:"1px solid "+(running?T.rd:T.gn)+"18",borderRadius:4,padding:"1px 8px",fontSize:8,fontWeight:700,color:running?T.rd:T.gn,cursor:"pointer"}}>{running?"Stop":"Preview"}</button></>}
<span style={{fontSize:10,color:T.ft,marginLeft:4}}>{simOpen?"▾":"▸"}</span>
</div></div>
{simOpen&&<div style={{fontSize:8,color:T.dm,lineHeight:1.4,marginTop:4}}>Preview how your {budget} SOL fleet with {snprs} snipers trades the bonding curve. Dev buys first, snipers enter staggered, fleet holds through volatility, exits into demand. Bond target: ~${(gradMc/1000).toFixed(0)}K MC.</div>}</div>
{simOpen&&<><canvas ref={cvRef} style={{width:"100%",height:mb?180:240,display:"block",background:T.bg}}/>
<div style={{padding:"6px 12px",borderTop:"1px solid "+T.bd,display:"flex",alignItems:"center",gap:8}}>
<div style={{flex:1}}><div style={{display:"flex",alignItems:"center",gap:4,marginBottom:2}}><span style={{fontSize:10,fontWeight:800,color:s.ph==="accumulate"?T.gn:s.ph==="distribute"||s.ph==="sweep"?T.rd:s.ph==="complete"?T.yl:T.md,textTransform:"uppercase"}}>{s.ph}</span><span style={{fontSize:10,fontWeight:800,color:s.sig==="BUY"?T.gn:s.sig==="SELL"||s.sig==="EXIT"?T.rd:s.sig==="DONE"?T.yl:T.dm}}>{s.sig}</span></div><div style={{fontSize:7,color:T.ft,lineHeight:1.3}}>{PHASES[s.ph]||""}</div></div>
<div style={{textAlign:"center",minWidth:70}}><div style={{fontSize:18,fontWeight:900,color:s.bondProb>=80?T.gn:s.bondProb>=50?T.yl:s.bondProb>=20?T.or:T.rd}}>{s.bondProb}%</div><div style={{fontSize:7,color:T.ft,fontWeight:700}}>BOND PROB</div><div style={{width:60,height:3,borderRadius:2,background:T.bd,marginTop:2}}><div style={{width:(s.bondProb/100)*60,height:3,borderRadius:2,background:s.bondProb>=80?T.gn:s.bondProb>=50?T.yl:s.bondProb>=20?T.or:T.rd,transition:"width .3s"}}/></div></div></div>
<div style={{padding:"4px 12px",borderTop:"1px solid "+T.bd,display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:1,fontSize:8}}>
<div style={{textAlign:"center"}}><div style={{color:s.mc>=60000?"#ffaa00":T.tx,fontWeight:800,fontSize:10}}>${fm(s.mc)}</div><div style={{color:T.ft,fontSize:6}}>MC</div></div>
<div style={{textAlign:"center"}}><div style={{color:T.tx,fontWeight:800,fontSize:10}}>${fm(s.peakMc)}</div><div style={{color:T.ft,fontSize:6}}>PEAK</div></div>
<div style={{textAlign:"center"}}><div style={{color:T.rd,fontWeight:800,fontSize:10}}>{s.spent.toFixed(1)}</div><div style={{color:T.ft,fontSize:6}}>SPENT</div></div>
<div style={{textAlign:"center"}}><div style={{color:T.gn,fontWeight:800,fontSize:10}}>{s.back.toFixed(1)}</div><div style={{color:T.ft,fontSize:6}}>BACK</div></div>
<div style={{textAlign:"center"}}><div style={{color:pnl>=0?T.gn:T.rd,fontWeight:800,fontSize:10}}>{pnl>=0?"+":""}{pnl.toFixed(1)}</div><div style={{color:T.ft,fontSize:6}}>PnL</div></div>
<div style={{textAlign:"center"}}><div style={{color:s.roi>=0?T.gn:T.rd,fontWeight:800,fontSize:10}}>{s.roi>=0?"+":""}{s.roi.toFixed(0)}%</div><div style={{color:T.ft,fontSize:6}}>ROI</div></div></div>
<div style={{padding:"4px 12px 6px",display:"flex",gap:8,fontSize:7,color:T.ft,alignItems:"center"}}><span style={{display:"flex",alignItems:"center",gap:2}}><span style={{width:5,height:5,borderRadius:"50%",background:"#00e676"}}/>fleet buy</span><span style={{display:"flex",alignItems:"center",gap:2}}><span style={{width:5,height:5,borderRadius:"50%",background:"#ff1744"}}/>fleet sell</span><span style={{display:"flex",alignItems:"center",gap:2}}><span style={{width:5,height:5,borderRadius:"50%",background:T.dm+"44"}}/>opponent</span><span style={{marginLeft:"auto",fontWeight:700,color:T.gn}}>{budget} SOL · {snprs} snipers</span><span style={{color:T.yl+"88",fontSize:6}}>━ bond line</span></div>
</>}</div>}

// ═══ MAIN APP ═══
export default function App(){
const[isDark,sD]=useState(()=>{try{return localStorage.getItem("bondli_theme")!=="light"}catch{return true}});
const T=isDark?D:L;const tog=()=>sD(d=>{try{localStorage.setItem("bondli_theme",d?"light":"dark")}catch{}return!d});
const mb=uM();const solP=useSolPrice();
const[user,sU]=useState(null);const[wsOn,sWs]=useState(false);const[online,sOl]=useState(0);
const[tn,sTn]=useState("");const[tkr,sTk]=useState("");const[desc,sDs]=useState("");
const[tw,sTw]=useState("");const[tg,sTg]=useState("");const[wb,sWb]=useState("");const[eCA,sECA]=useState("");
const[sol,sSol]=useState(2);const[slip,sSl]=useState(25);const[snc,sSn]=useState(2);const[dur,sDur]=useState(60);const[jt,sJt]=useState(0.001);
const[launched,sLd]=useState(false);const[lCA,sLCA]=useState("");const[asid,sAsid]=useState("");
const[pSess,sPS]=useState([]);const[fleet,sFl]=useState(null);
const[trW,sTrW]=useState(null);const[trB,sTrB]=useState(0);const[trK,sTrK]=useState(null);
const[held,sHeld]=useState(new Set());const[positions,sPos]=useState([]);
const[tab,sTab]=useState("radar");const[cUser,sCU]=useState(null);
const[toasts,sToasts]=useState([]);
const[rt,sRT]=useState({new:[],hot:[],graduating:[],momentum:[]});
const[rTab,sRTab]=useState("momentum");const[rLoad,sRL]=useState(true);const[rPool,sRP]=useState(0);const[gradMc,sGradMc]=useState(34000);
const[rExp,sRExp]=useState(null);const[buying,sBuy]=useState(null);const[selling,sSell]=useState(null);const[rSearch,sRS]=useState("");
const[rEnabled,sRE]=useState(true);const[autoTrade,sAutoTrade]=useState(null);const[img,sImg]=useState(null);const[showKeys,sShowKeys]=useState(false);
const[refData,sRefData]=useState(null);const[refInput,sRefInput]=useState("");const[refMsg,sRefMsg]=useState("");
const[expert,sExpert]=useState(false);const[launchStep,sLS]=useState(null);const[showHow,sShowHow]=useState(false);
// launchStep: null | "creating" | "uploading" | "funding" | "dev_buy" | "snipers" | "live"
const[intelData,sIntel]=useState(null);const[chartPatterns,sChartPatterns]=useState(null);const[gradsOpen,sGradsOpen]=useState(false);
// CA lookup state — must be declared before any early returns to satisfy Rules of Hooks
const[caLookup,sCaLookup]=useState(null);const[caLoading,sCaLoading]=useState(false);const caLookupRef=useRef(null);

const toast=useCallback((m,t="info")=>{const id=Date.now()+Math.random();sToasts(x=>[...x,{id,msg:m,type:t}]);setTimeout(()=>sToasts(x=>x.filter(y=>y.id!==id)),5000)},[]);
const hasAccess=user&&(user.demo||user.tier==="free"||user.tier==="pro"||user.tier==="vip");
const tierColor=user?.whitelisted?T.yl:user?.tier==="pro"?T.pu:T.gn;
const tierLabel=user?.whitelisted?"VIP":user?.tier==="pro"?"PRO":user?.demo?"DEMO":"FREE";
const isOwner=user?.whitelisted||user?.pubkey==="4XnHZZmHwSQ8RszJsdc7snvxG8dZtm6g4hvpkCMkguMx";
const isApe=!!eCA;const pv=dbp(sol,isApe);const nw=wc(sol);
const canLaunch=(trW||isApe)&&(eCA||(tn&&tkr))&&sol>=0.2&&trB>=sol;
const applyPreset=p=>{sSol(p.sol);sSn(p.snc);sSl(p.slip);sDur(p.dur);sJt(p.jt)};
const connect=async()=>{try{const p=window?.phantom?.solana?.isPhantom?window.phantom.solana:window?.solana?.isPhantom?window.solana:null;if(!p){if(/iPhone|iPad|Android/i.test(navigator.userAgent)){window.location.href="https://phantom.app/ul/browse/"+encodeURIComponent(window.location.href);return}toast("Install Phantom","error");return}const r=await p.connect();const pk=r.publicKey.toString();sU({pubkey:pk,tier:"free",demo:false});a.chk(pk).then(d=>{if(d.tier)sU(u=>({...u,whitelisted:!!d.whitelisted,paid:!!d.paid,tier:d.tier}))}).catch(()=>{})}catch(e){toast(e.code===4001?"Rejected":"Failed","error")}};

useEffect(()=>{if(user?.pubkey)a.sw(user.pubkey)},[user?.pubkey]);
useEffect(()=>{if(user?.pubkey&&!user?.demo)a.afr(user.pubkey).catch(()=>{})},[user?.pubkey]);
useEffect(()=>{const p=window?.phantom?.solana||window?.solana;if(p?.isPhantom&&p?.isConnected&&!user){p.connect({onlyIfTrusted:true}).then(r=>{const pk=r.publicKey.toString();sU({pubkey:pk,tier:"free",demo:false});a.chk(pk).then(d=>{if(d.tier)sU(u=>({...u,whitelisted:!!d.whitelisted,paid:!!d.paid,tier:d.tier}))}).catch(()=>{})}).catch(()=>{})}},[]);
useEffect(()=>{if(!hasAccess)return;let ws,dead=false;const conn=()=>{if(dead)return;try{ws=new WebSocket(WS_URL);ws.onopen=()=>sWs(true);ws.onclose=()=>{sWs(false);if(!dead)setTimeout(conn,3000)};ws.onerror=()=>{}}catch{}};conn();return()=>{dead=true;if(ws)ws.close()}},[hasAccess]);
useEffect(()=>{if(!user?.pubkey||user.demo)return;a.ls(user.pubkey).then(d=>{if(d.sessions)sPS(d.sessions.filter(s=>s.tokenCA&&s.status!=="closed"&&s.status!=="swept"&&s.status!=="recovered").slice(0,8))}).catch(()=>{})},[user?.pubkey]);
useEffect(()=>{if(!user?.pubkey||user.demo)return;const f=()=>a.gtw(user.pubkey).then(d=>{if(d.tradingWallet){sTrW(d.tradingWallet);sTrB(d.balance||0)}}).catch(()=>{});f();const iv=setInterval(f,15000);a.etw(user.pubkey).then(d=>{if(d.ok&&d.privateKey)sTrK(d)}).catch(()=>{});return()=>clearInterval(iv)},[user?.pubkey]);
useEffect(()=>{if(!user?.pubkey||user.demo)return;a.gu(user.pubkey).then(d=>{if(d.username)sCU(d.username)}).catch(()=>{})},[user?.pubkey]);
useEffect(()=>{const iv=setInterval(()=>{a.gr().then(d=>{if(d.online!=null)sOl(d.online)}).catch(()=>{})},15000);return()=>clearInterval(iv)},[]);
useEffect(()=>{if(!launched||!lCA)return;const iv=setInterval(()=>{a.gfs().then(d=>sFl(d)).catch(()=>{})},5000);return()=>clearInterval(iv)},[launched,lCA]);
// Intel tab polling
useEffect(()=>{if(tab!=="intel")return;const poll=()=>{fetch(API+"/api/intel/stats").then(r=>r.json()).then(d=>sIntel(d)).catch(()=>{})};poll();const iv=setInterval(poll,8000);return()=>clearInterval(iv)},[tab]);
useEffect(()=>{if(tab!=="intel"||!user?.pubkey||user.demo)return;const poll=()=>a.atst(user.pubkey).then(d=>sAutoTrade(p=>({...p,...d,open:p?.open||d?.active||false,settings:p?.open?{...(d?.settings||{}),...(p?.settings||{})}:d?.settings}))).catch(()=>{});poll();const rate=autoTrade?.active?3000:10000;const iv=setInterval(poll,rate);return()=>clearInterval(iv)},[tab,user?.pubkey,autoTrade?.active]);
useEffect(()=>{if(tab!=="intel")return;a.gcp().then(d=>sChartPatterns(d)).catch(()=>{});const iv=setInterval(()=>a.gcp().then(d=>sChartPatterns(d)).catch(()=>{}),30000);return()=>clearInterval(iv)},[tab]);
useEffect(()=>{if(!hasAccess||!rEnabled)return;const f=async()=>{try{const d=await a.gr();if(d.tabs)sRT(d.tabs);if(d.poolSize!=null)sRP(d.poolSize);if(d.gradMc)sGradMc(d.gradMc);sRL(false)}catch{sRL(false)}};f();const iv=setInterval(f,5000);return()=>clearInterval(iv)},[hasAccess,rEnabled]);
useEffect(()=>{if(!user?.pubkey||user.demo||!trW)return;const f=()=>a.gp(user.pubkey).then(d=>{if(d.positions){sPos(d.positions);sHeld(new Set(d.positions.map(p=>p.mint)))}}).catch(()=>{});f();const iv=setInterval(f,10000);return()=>clearInterval(iv)},[user?.pubkey,trW]);
useEffect(()=>{if(!user?.pubkey||user.demo)return;a.grf(user.pubkey).then(d=>sRefData(d)).catch(()=>{})},[user?.pubkey]);
// CA lookup effect — must be before early return to satisfy Rules of Hooks
const allRadarPre=(()=>{const seen=new Set();return[...(rt.momentum||[]),...(rt.hot||[]),...(rt.new||[]),...(rt.graduating||[])].filter(t=>{if(seen.has(t.ca))return false;seen.add(t.ca);return true})})();
useEffect(()=>{const q=rSearch.trim();const isCA=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);if(!isCA||q.length<32){sCaLookup(null);return}const local=allRadarPre.find(t=>t.ca===q);if(local){sCaLookup(null);return}sCaLoading(true);clearTimeout(caLookupRef.current);caLookupRef.current=setTimeout(()=>{fetch(API+"/api/radar/token/"+q).then(r=>r.ok?r.json():null).then(d=>{if(d&&d.ca){sCaLookup(d);sCaLoading(false)}else{fetch("https://api.dexscreener.com/latest/dex/tokens/"+q,{signal:AbortSignal.timeout(6000)}).then(r=>r.ok?r.json():null).then(dx=>{const p=dx?.pairs?.[0];if(p){sCaLookup({ca:q,name:p.baseToken?.name||q.slice(0,8),ticker:p.baseToken?.symbol||"",mcapUsd:p.fdv||p.marketCap||0,mcapSol:0,image:p.info?.imageUrl||"",graduated:true,spark:[],dexUrl:p.url});sCaLoading(false)}else{sCaLookup(null);sCaLoading(false)}}).catch(()=>{sCaLookup(null);sCaLoading(false)})}}).catch(()=>{sCaLookup(null);sCaLoading(false)})},400)},[rSearch]);

const disconnect=async()=>{try{const p=window?.phantom?.solana||window?.solana;await p?.disconnect()}catch{}sU(null)};
const resetHome=()=>{sLd(false);sLCA("");sAsid("");sFl(null)};
const quickBuy=async(ca,s)=>{if(!user?.pubkey||user.demo){toast("Connect wallet","error");return}if(!trW){toast("Create trading key","error");return}if(trB<s){toast(`Need ${s} SOL`,"error");return}const r=await a.qb(user.pubkey,ca,s);if(r.signature){sTrB(b=>b-s);hp([6,15,6]);toast("Bought "+s+" SOL","success");sTab("bags");sRExp(null);if(r.position){sPos(prev=>{if(prev.some(p=>p.mint===ca))return prev;return[{mint:ca,name:r.position.name,ticker:r.position.ticker,image:r.position.image,mcapUsd:r.position.mcapUsd,mcapSol:r.position.mcapSol,marketCapSol:r.position.mcapSol,valueSol:s,valueUsd:s*solP,amount:0,holdPct:0,pnlSol:0,pnlPct:0,pending:true},...prev]});sHeld(prev=>new Set([...prev,ca]))}const rb=async(n)=>{try{const d=await a.gp(user.pubkey);if(d.positions){sPos(d.positions);sHeld(new Set(d.positions.map(p=>p.mint)));if(d.positions.some(p=>p.mint===ca))return}}catch{}if(n<8)setTimeout(()=>rb(n+1),(n+1)*2500)};setTimeout(()=>rb(0),4000);return r.signature}throw new Error(r.error||"Failed")};
const quickSell=async(ca,pct)=>{if(!user?.pubkey)throw new Error("Connect wallet");let lastErr="";for(let attempt=0;attempt<2;attempt++){try{const r=await a.qs(user.pubkey,ca,pct);if(r.error)throw new Error(r.error);if(!r.signature)throw new Error("No signature returned");if(pct>=100){sPos(prev=>prev.filter(p=>p.mint!==ca));sHeld(prev=>{const n=new Set(prev);n.delete(ca);return n})}setTimeout(()=>a.gp(user.pubkey).then(d=>{if(d.positions){sPos(d.positions);sHeld(new Set(d.positions.map(p=>p.mint)))}}).catch(()=>{}),3000);return r.signature}catch(e){lastErr=e.message;if(attempt===0)await new Promise(r=>setTimeout(r,1500))}}throw new Error(lastErr||"Sell failed")};

if(!user)return<TC.Provider value={T}><style>{css(T)}</style><div style={{minHeight:"100dvh",background:T.bg,fontFamily:M,overflow:"auto"}}>
{/* ═══ HERO ═══ */}
<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:mb?"60px 16px 36px":"100px 20px 50px",textAlign:"center"}}>
<div style={{animation:"pf 3s ease infinite",marginBottom:16}}><Logo s={mb?48:64}/></div>
<div style={{fontWeight:900,fontSize:mb?44:72,letterSpacing:"-.04em",lineHeight:1,marginBottom:12}}>BOND<span style={{color:T.rd}}>LI</span></div>
<div style={{fontSize:mb?14:18,color:T.dm,marginBottom:32,maxWidth:420,lineHeight:1.6}}>Score every token. Learn from every outcome. Exit before the rug. Trust nothing. Verify everything.</div>
<B onClick={connect} style={{padding:"16px 44px",fontSize:20,borderRadius:10,background:"linear-gradient(135deg,#534bb1,#551bf9)",animation:"gl 3s infinite",letterSpacing:".02em"}}><IC.ph/> Enter</B>
<button onClick={()=>sU({pubkey:"demo",tier:"demo",demo:true})} style={{marginTop:12,background:"none",border:"none",fontSize:13,color:T.ft,cursor:"pointer",textDecoration:"underline",textUnderlineOffset:3}}>demo mode</button>
</div>

{/* ═══ FEATURE GRID ═══ */}
<div style={{maxWidth:940,margin:"0 auto",padding:mb?"0 12px 36px":"0 20px 56px"}}>
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr 1fr",gap:mb?8:14}}>
{[
{ic:<IC.bulb s={mb?22:26} c={T.pu}/>,title:"40+ Feature ML",desc:"Scores every token in real-time. Learns from every outcome. Weights update automatically.",color:T.pu},
{ic:<IC.chart s={mb?22:26} c={T.gn}/>,title:"Score Derivatives",desc:"Velocity and acceleration are leading indicators. Exits 1-2 cycles before the chart shows it.",color:T.gn},
{ic:<IC.scan s={mb?22:26} c={T.cy||"#00bcd4"}/>,title:"Bundle Detection",desc:"8 signals scored 0-100. Same-slot buys, identical amounts, dust inflation. High score = fake chart.",color:T.cy||"#00bcd4"},
{ic:<IC.bolt s={mb?22:26} c={T.yl}/>,title:"Pattern Memory",desc:"Every chart stored and classified. Healthy pumps, sniper spikes, slow grinds, rugs. Seen it before.",color:T.yl},
{ic:<IC.fleet s={mb?22:26} c={T.rd}/>,title:"Fleet + Nash",desc:"Multi-wallet, no bundling. Nash equilibrium signals. Kelly Criterion sizing. Game theory, not guessing.",color:T.rd},
{ic:<IC.eye s={mb?22:26} c="#ff9800"/>,title:"8 Rug Vectors",desc:"Dev dumps, sybil wallets, liquidity drains, sell waves, holder concentration. 3+ signals = reject.",color:"#ff9800"},
].map((f,i)=><div key={i} style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:12,padding:mb?"14px 12px":"20px 16px"}}>
<div style={{marginBottom:8}}>{f.ic}</div>
<div style={{fontSize:mb?13:14,fontWeight:800,color:f.color,marginBottom:5}}>{f.title}</div>
<div style={{fontSize:mb?11:12,color:T.dm,lineHeight:1.5}}>{f.desc}</div>
</div>)}
</div>

{/* ═══ HOW IT WORKS ═══ */}
<div style={{marginTop:mb?32:48}}>
<div style={{textAlign:"center",marginBottom:mb?12:20}}>
<div style={{fontSize:mb?16:20,fontWeight:800,color:T.tx}}>How it works</div>
</div>
<div style={{display:"grid",gridTemplateColumns:mb?"1fr 1fr":"1fr 1fr 1fr 1fr",gap:mb?6:12}}>
{[
{step:"1",title:"Connect",desc:"Phantom. No sign-up. No KYC."},
{step:"2",title:"Fund",desc:"Generate keypair. Deposit SOL."},
{step:"3",title:"Set rules",desc:"Min score, SOL/trade, TP/SL."},
{step:"4",title:"Walk away",desc:"It finds, buys, exits. You verify."},
].map((s,i)=><div key={i} style={{padding:mb?"10px 8px":"16px 12px",textAlign:"center"}}>
<div style={{width:mb?28:36,height:mb?28:36,borderRadius:"50%",background:"linear-gradient(135deg,#534bb1,#551bf9)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:mb?14:18,fontWeight:900,color:"#fff",marginBottom:8}}>{s.step}</div>
<div style={{fontSize:mb?12:14,fontWeight:800,color:T.tx,marginBottom:3}}>{s.title}</div>
<div style={{fontSize:mb?10:11,color:T.dm,lineHeight:1.4}}>{s.desc}</div>
</div>)}
</div>
</div>

{/* ═══ SPECS ═══ */}
<div style={{marginTop:mb?28:44,display:"flex",flexWrap:"wrap",justifyContent:"center",gap:mb?4:8}}>
{[
{n:"40+",l:"features"},
{n:"3",l:"exit layers"},
{n:"8",l:"rug signals"},
{n:"4",l:"radar feeds"},
{n:"4",l:"trade modes"},
{n:"0.02",l:"learn rate"},
].map((s,i)=><div key={i} style={{textAlign:"center",padding:mb?"8px 12px":"10px 18px",background:T.sf,border:"1px solid "+T.bd,borderRadius:8,minWidth:mb?80:100}}>
<div style={{fontSize:mb?18:22,fontWeight:900,color:T.gn,lineHeight:1}}>{s.n}</div>
<div style={{fontSize:mb?9:10,color:T.ft,marginTop:3,textTransform:"uppercase",letterSpacing:".06em"}}>{s.l}</div>
</div>)}
</div>

{/* ═══ TIERS ═══ */}
<div style={{marginTop:mb?36:52}}>
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr 1fr",gap:mb?8:14}}>
{[
{tier:"Free",price:"0 SOL",color:T.ft,features:["Radar + ML scoring","Auto-Ape + momentum exits","2 positions","25% profit share"]},
{tier:"Pro",price:"1 SOL",color:T.pu,features:["Fleet multi-wallet","Batch deploy (20)","0% profit share","Export keys","50 launches/hr"]},
{tier:"VIP",price:"10 SOL",color:T.yl,features:["200 launches/hr","Priority queue","Early access","Direct to dev"]},
].map((t,i)=><div key={i} onClick={connect} style={{background:T.sf,border:"1px solid "+(t.color)+"33",borderRadius:12,padding:mb?"16px 14px":"22px 18px",position:"relative",cursor:"pointer",transition:"all .15s ease"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=t.color+"88";e.currentTarget.style.transform="translateY(-2px)"}} onMouseLeave={e=>{e.currentTarget.style.borderColor=t.color+"33";e.currentTarget.style.transform="none"}}>
{i===1&&<div style={{position:"absolute",top:-8,right:12,fontSize:9,fontWeight:900,padding:"2px 8px",borderRadius:4,background:T.pu,color:"#fff",letterSpacing:".05em"}}>POPULAR</div>}
<div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:8}}><span style={{fontSize:mb?20:26,fontWeight:900,color:t.color}}>{t.tier}</span><span style={{fontSize:mb?13:15,color:T.tx,fontWeight:800}}>{t.price}</span></div>
{t.features.map((f,j)=><div key={j} style={{fontSize:mb?11:12,color:T.dm,padding:"2px 0"}}>{f}</div>)}
<div style={{marginTop:10,fontSize:mb?11:12,fontWeight:700,color:t.color,opacity:.8}}>Select {t.tier} →</div>
</div>)}
</div>
</div>

{/* ═══ BOTTOM CTA ═══ */}
<div style={{marginTop:mb?36:52,textAlign:"center",paddingBottom:28}}>
<B onClick={connect} style={{padding:"14px 40px",fontSize:18,borderRadius:10,background:"linear-gradient(135deg,#534bb1,#551bf9)"}}><IC.ph/> Enter</B>
<div style={{marginTop:14,fontSize:11,color:T.ft}}>Solana. Phantom. Nothing else.</div>
</div>
</div>
</div></TC.Provider>;

const rTokens=rt[rTab]||[];const allRadar=allRadarPre;
const rFiltered=(()=>{if(!rSearch)return rTokens;const q=rSearch.toLowerCase();const local=allRadar.filter(t=>(t.name||"").toLowerCase().includes(q)||(tk(t.ticker)||"").toLowerCase().includes(q)||t.ca?.includes(rSearch)||t.ca?.startsWith(rSearch));if(caLookup&&!local.find(t=>t.ca===caLookup.ca))return[caLookup,...local];return local})();
const expToken=rExp?rFiltered.find(t=>t.ca===rExp)||rTokens.find(t=>t.ca===rExp)||allRadar.find(t=>t.ca===rExp)||(caLookup?.ca===rExp?caLookup:null):null;

return<TC.Provider value={T}><style>{css(T)}</style>
{toasts.length>0&&<div style={{position:"fixed",top:mb?4:60,left:"50%",transform:"translateX(-50%)",zIndex:9999,display:"flex",flexDirection:"column",gap:3,maxWidth:mb?"95%":480,width:"auto",minWidth:200}}>{toasts.map(t=><div key={t.id} onClick={()=>sToasts(x=>x.filter(y=>y.id!==t.id))} style={{padding:"8px 16px",borderRadius:8,fontFamily:M,fontSize:14,fontWeight:600,background:t.type==="error"?T.rd+"15":t.type==="success"?T.gn+"15":T.sf,color:t.type==="error"?T.rd:t.type==="success"?T.gn:T.tx,border:"1px solid "+(t.type==="error"?T.rd+"33":t.type==="success"?T.gn+"33":T.bd),animation:"fd .15s ease",cursor:"pointer",backdropFilter:"blur(8px)",textAlign:"center",wordBreak:"break-word"}}>{t.msg}</div>)}</div>}
<div style={{minHeight:"100dvh",background:T.bg,color:T.tx,fontFamily:M,paddingBottom:mb?80:16}}>
<header style={{padding:mb?"5px 8px":"6px 20px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:T.bg}}><div onClick={resetHome} style={{display:"flex",alignItems:"center",gap:mb?4:7,cursor:"pointer"}}><Logo s={mb?20:24}/><span style={{fontWeight:800,fontSize:mb?20:24}}>{mb?"B":"BOND"}<span style={{color:T.rd}}>{mb?"L":"LI"}</span></span>{wsOn&&(launched||pSess.length>0)&&<span style={{width:4,height:4,borderRadius:"50%",background:T.gn,animation:"gp 2s infinite"}}/>}</div>{trW&&<div style={{display:"flex",alignItems:"center",gap:3}}><span style={{fontSize:mb?26:32,fontWeight:900,color:trB>.01?T.gn:T.ft}}>{solFmt(trB)}</span><IC.sol s={mb?16:20}/></div>}<div style={{display:"flex",alignItems:"center",gap:mb?2:5}}>{launched&&<button onClick={async()=>{if(!confirm("STOP ALL?"))return;try{for(const s of pSess)try{await a.ss(s.id,user.pubkey)}catch{};sPS([]);toast("Stopped","success");resetHome()}catch(e){toast(e.message,"error")}}} style={{background:T.rd+"12",border:"1px solid "+T.rd+"22",borderRadius:6,padding:"3px 7px",cursor:"pointer",color:T.rd,display:"flex",alignItems:"center",gap:2,fontSize:14,fontWeight:700}}><IC.stop s={14}/>STOP</button>}<button onClick={tog} style={{background:"none",border:"1px solid "+T.bd,borderRadius:6,padding:"3px 5px",cursor:"pointer",color:T.dm,display:"flex"}}>{isDark?<IC.sun/>:<IC.moon/>}</button><button onClick={()=>sShowKeys(!showKeys)} style={{background:"none",border:"1px solid "+T.bd,borderRadius:6,padding:"3px 5px",cursor:"pointer",color:T.dm,display:"flex"}}><IC.gear s={13}/></button><div onClick={disconnect} style={{display:"flex",alignItems:"center",gap:3,padding:"2px 5px",background:T.sf,borderRadius:6,border:"1px solid "+T.bd,cursor:"pointer"}}><span style={{padding:"2px 6px",borderRadius:3,fontSize:12,fontWeight:800,background:tierColor+"18",color:tierColor,border:"1px solid "+tierColor+"22"}}>{tierLabel}</span><Av pk={user.pubkey||""} s={18}/><span style={{fontSize:13,color:T.dm,maxWidth:mb?50:80,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.demo?"demo":(cUser||wN(user.pubkey||""))}</span></div></div></header>

{trW?<div style={{padding:"6px 12px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",gap:6,fontSize:14,color:T.ft}}><IC.zap s={13}/><span onClick={()=>{navigator.clipboard?.writeText(trW);toast("Copied","success")}} style={{cursor:"pointer"}}>{tp(trW,6,4)}</span>{online>0&&<span style={{color:T.gn+"77"}}>{online} online</span>}<div style={{marginLeft:"auto",display:"flex",gap:2}}><button onClick={()=>{navigator.clipboard?.writeText(trW);toast("Deposit address copied","success")}} style={{background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:4,padding:"3px 8px",cursor:"pointer",color:T.gn,fontSize:13,fontWeight:700}}>deposit</button></div></div>:user&&!user.demo&&<div style={{padding:"8px 10px",borderBottom:"1px solid "+T.bd,textAlign:"center"}}><B onClick={async()=>{try{const r=await a.ctw(a.w);if(r.ok){sTrW(r.tradingWallet);sTrK(r);toast("Key created","success")}}catch(e){toast(e.message,"error")}}} small><IC.key s={12} c="#0a0a0f"/> Create Trading Key</B></div>}

{launched&&lCA?<EB l="War Room"><div style={{padding:mb?4:8,animation:"fu .2s ease"}}>
{/* ═══ WAR ROOM HEADER ═══ */}
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 10px",background:T.sf,border:"1px solid "+T.gn+"22",borderRadius:10,marginBottom:6}}>
<div style={{display:"flex",alignItems:"center",gap:6}}>
<span style={{width:8,height:8,borderRadius:"50%",background:T.gn,animation:"gp 1.5s infinite"}}/>
<span style={{fontSize:15,fontWeight:900,color:T.gn}}>LIVE</span>
<span style={{fontSize:13,color:T.dm,fontWeight:700}}>{tk(fleet?.ca?.slice(0,8)||lCA.slice(0,8))}</span>
{fleet?.phase&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:fleet.phase==="selling"?T.rd+"12":fleet.phase==="volume"?T.pu+"12":T.gn+"12",color:fleet.phase==="selling"?T.rd:fleet.phase==="volume"?T.pu:T.gn,fontWeight:800,textTransform:"uppercase"}}>{fleet.phase}</span>}
</div>
<div style={{display:"flex",gap:2}}>
<button onClick={resetHome} style={{background:"none",border:"1px solid "+T.bd,borderRadius:5,padding:"4px 10px",fontSize:11,color:T.dm,cursor:"pointer"}}>← Back</button>
<button onClick={async(ev)=>{hp([20,30,20],ev);ev.currentTarget.style.opacity=".5";ev.currentTarget.textContent="Sweeping...";try{const r=await a.ss(asid,user.pubkey);hp([10,20,10,20,10],ev);toast(`Closed — ${(r.totalSwept||0).toFixed(4)} SOL swept`,"success");resetHome()}catch(e){ev.currentTarget.style.opacity="1";ev.currentTarget.textContent="Close + Sweep";toast(e.message,"error")}}} style={{background:T.rd+"0a",border:"1px solid "+T.rd+"22",borderRadius:5,padding:"4px 10px",fontSize:11,fontWeight:800,color:T.rd,cursor:"pointer"}}>Close + Sweep</button>
</div></div>

{/* ═══ P&L DASHBOARD ═══ */}
<div style={{display:"grid",gridTemplateColumns:mb?"repeat(3,1fr)":"repeat(6,1fr)",gap:4,marginBottom:6}}>
{[
{l:"SPENT",v:fs(fleet?.solSpent,3),c:T.rd,ic:null},
{l:"BACK",v:fs(fleet?.solRecovered,3),c:T.gn,ic:null},
{l:"PnL",v:((fleet?.solRecovered||0)-(fleet?.solSpent||0)).toFixed(3),c:((fleet?.solRecovered||0)-(fleet?.solSpent||0))>=0?T.gn:T.rd},
{l:"TRADES",v:fleet?.tradeCount||0,c:T.tx},
{l:"SIGNAL",v:fleet?.gameState?.signal||"IDLE",c:fleet?.gameState?.signal==="SELL_NOW"?T.rd:fleet?.gameState?.signal==="RIDE"?T.gn:T.yl},
{l:"EXT BUYERS",v:fleet?.gameState?.uniqueBuyers||0,c:T.cy||T.tx},
].map(s=><div key={s.l} style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:8,padding:"6px 4px",textAlign:"center"}}>
<div style={{fontSize:mb?18:22,fontWeight:900,color:s.c,display:"flex",alignItems:"center",justifyContent:"center",gap:2}}>{s.v}{s.l==="PnL"&&<IC.sol s={12}/>}</div>
<div style={{fontSize:10,color:T.ft,fontWeight:700,letterSpacing:"0.05em"}}>{s.l}</div>
</div>)}
</div>

{/* ═══ CHART ═══ */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden",marginBottom:6}}>
<iframe src={"https://www.gmgn.cc/kline/sol/"+lCA} style={{width:"100%",height:mb?240:360,border:"none",display:"block"}} title="chart" loading="lazy"/>
</div>

{/* ═══ FLEET CONTROLS ═══ */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:"8px 10px",marginBottom:6}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
<span style={{fontSize:13,fontWeight:800}}>Fleet Controls</span>
{fleet?.gameState?.manualOverride&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:T.yl+"12",color:T.yl,fontWeight:800}}>MANUAL: {fleet.gameState.manualOverride} ({fleet.gameState.manualExpiry||0}s)</span>}
</div>
<div style={{display:"grid",gridTemplateColumns:mb?"repeat(3,1fr)":"repeat(5,1fr)",gap:4}}>
{[
{cmd:"accumulate",label:"ACCUM",desc:"Buy heavy",color:T.gn,bg:T.gn},
{cmd:"hold",label:"DIAMOND",desc:"Hold wave",color:T.cy||"#00bcd4",bg:T.cy||"#00bcd4"},
{cmd:"boost",label:"VOLUME",desc:"Paint chart",color:T.pu||"#9c27b0",bg:T.pu||"#9c27b0"},
{cmd:"distribute",label:"DISTRIB",desc:"Take profit",color:T.rd||"#ff4444",bg:T.rd||"#ff4444"},
{cmd:"auto",label:"AUTO",desc:"Game theory",color:T.ft,bg:T.ft},
].map(b=>{const active=fleet?.gameState?.manualOverride===(b.cmd==="hold"?"RIDE":b.cmd==="boost"?"HOLD":b.cmd==="auto"?null:b.cmd.toUpperCase());return<button key={b.cmd} onClick={async(ev)=>{hp([15,25],ev);try{const r=await a.fc(asid,user.pubkey,b.cmd,{duration:b.cmd==="boost"?30:60});toast(r.signal||b.label,"success")}catch(e){toast(e.message,"error")}}} style={{padding:mb?"12px 4px":"12px 4px",background:active?b.bg+"18":b.bg+"06",border:"2px solid "+(active?b.bg+"66":b.bg+"22"),borderRadius:8,fontSize:mb?11:12,fontWeight:900,color:b.color,cursor:"pointer",textAlign:"center",lineHeight:1.2,minHeight:mb?52:48,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}><div>{b.label}</div><div style={{fontSize:9,fontWeight:500,color:T.ft,marginTop:2}}>{b.desc}</div></button>})}
</div>
</div>

{/* ═══ TRADE FEED + WALLETS (side by side on desktop) ═══ */}
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr",gap:6,marginBottom:6}}>
{/* Trade feed */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden"}}>
<div style={{padding:"6px 10px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<span style={{fontSize:13,fontWeight:800}}>Trade Feed</span>
<span style={{fontSize:10,color:T.ft}}>live</span>
</div>
<div style={{maxHeight:200,overflowY:"auto",padding:"2px 0"}}>
{(fleet?.trades||[]).slice(0,20).map((t,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",fontSize:11,borderBottom:"1px solid "+T.bd+"44"}}>
<span style={{width:5,height:5,borderRadius:"50%",background:t.side==="buy"?T.gn:T.rd,flexShrink:0}}/>
<span style={{color:t.side==="buy"?T.gn:T.rd,fontWeight:800,width:32}}>{t.side==="buy"?"BUY":"SELL"}</span>
<span style={{color:T.dm,flex:1}}>{t.wallet||"?"}</span>
<span style={{color:T.tx,fontWeight:700}}>{typeof t.sol==="number"?t.sol.toFixed(4):t.sol}</span>
<IC.sol s={8}/>
<span style={{fontSize:10,color:T.ft,minWidth:30,textAlign:"right"}}>{t.role||""}</span>
</div>)}
{(!fleet?.trades||fleet.trades.length===0)&&<div style={{padding:16,textAlign:"center",fontSize:12,color:T.ft}}>Waiting for trades...</div>}
</div></div>

{/* Wallet breakdown */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden"}}>
<div style={{padding:"6px 10px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<span style={{fontSize:13,fontWeight:800}}>Fleet Wallets</span>
<button onClick={async()=>{try{const k=await a.ek(asid,user.pubkey);if(k.ok&&k.keys?.length){navigator.clipboard?.writeText(k.keys.map(w=>w.role+": "+w.secret).join("\n"));toast(k.keys.length+" keys copied","success")}}catch(e){toast(e.message,"error")}}} style={{background:"none",border:"1px solid "+T.bd,borderRadius:3,padding:"2px 6px",fontSize:10,color:T.ft,cursor:"pointer"}}>Export All</button>
</div>
<div style={{maxHeight:200,overflowY:"auto"}}>
{(fleet?.wallets||[]).map((w,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",borderBottom:"1px solid "+T.bd+"44",fontSize:11}}>
<span style={{width:6,height:6,borderRadius:"50%",background:w.role==="dev"?T.yl:T.gn,flexShrink:0}}/>
<span style={{fontWeight:700,color:T.dm,minWidth:55}}>{w.role||"fleet"}</span>
<span style={{color:T.ft,flex:1}}>{(w.pubkey||"").slice(0,8)}…</span>
<span style={{color:T.gn,fontWeight:700}}>{w.spent!==undefined?w.spent.toFixed(3):"-"}</span>
<span style={{color:T.ft}}>→</span>
<span style={{color:T.tx,fontWeight:700}}>{w.recovered!==undefined?w.recovered.toFixed(3):"-"}</span>
</div>)}
{(!fleet?.wallets||fleet.wallets.length===0)&&<div style={{padding:16,textAlign:"center",fontSize:9,color:T.ft}}>Fleet initializing...</div>}
</div></div>
</div>

{/* ═══ QUICK TRADE ═══ */}
<div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:4,marginBottom:6,alignItems:"center"}}>
<span style={{fontSize:13,color:T.gn,fontWeight:700,paddingLeft:4}}>BUY</span>
<div style={{display:"flex",gap:3}}>{[0.1,0.25,0.5,1].map(amt=>{const ok=(trB||0)>=amt;const ld=buying===lCA+amt;return<button key={amt} disabled={!ok||ld} onClick={async(ev)=>{hp([15],ev);sBuy(lCA+amt);try{await quickBuy(lCA,amt);toast(`+${amt} SOL`,"success")}catch(er){toast(er.message,"error")}sBuy(null)}} style={{flex:1,padding:"8px 0",background:ok?T.gn+"06":"transparent",border:"1px solid "+(ok?T.gn+"22":T.bd),borderRadius:5,fontSize:13,fontWeight:800,color:ok?T.gn:T.ft,cursor:ok&&!ld?"pointer":"default",opacity:ok?1:.2}}>{ld?<Sp s={8}/>:amt}</button>})}</div>
<span style={{fontSize:13,color:"#ff4444",fontWeight:700,paddingLeft:4}}>SELL</span>
<div style={{display:"flex",gap:3}}>{[25,50,100].map(pct=>{const ld=selling===lCA+pct;return<button key={pct} disabled={ld} onClick={async(ev)=>{hp([20,30],ev);sSell(lCA+pct);try{await quickSell(lCA,pct);toast(`Sold ${pct}%`,"success")}catch(er){toast(er.message,"error")}sSell(null)}} style={{flex:1,padding:"8px 0",background:"#ff444406",border:"1px solid #ff444418",borderRadius:5,fontSize:13,fontWeight:800,color:"#ff4444",cursor:ld?"default":"pointer"}}>{ld?<Sp s={8} c="#ff4444"/>:pct===100?"ALL":pct+"%"}</button>})}</div>
</div>

{/* ═══ ACTION BAR ═══ */}
<div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
<button onClick={()=>{navigator.clipboard?.writeText(lCA);toast("CA copied","success")}} style={{padding:"5px 10px",background:T.sf,border:"1px solid "+T.bd,borderRadius:6,fontSize:12,color:T.ft,cursor:"pointer",fontFamily:M}}>{lCA.slice(0,12)}…</button>
<a href={"https://pump.fun/coin/"+lCA} target="_blank" rel="noopener" style={{padding:"5px 10px",background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:6,fontSize:12,color:T.gn,textDecoration:"none",fontWeight:700}}>pump.fun ↗</a>
<a href={"https://www.gmgn.cc/sol/token/"+lCA} target="_blank" rel="noopener" style={{padding:"5px 10px",background:T.sf,border:"1px solid "+T.bd,borderRadius:6,fontSize:12,color:T.dm,textDecoration:"none"}}>gmgn ↗</a>
<a href={"https://dexscreener.com/solana/"+lCA} target="_blank" rel="noopener" style={{padding:"5px 10px",background:T.sf,border:"1px solid "+T.bd,borderRadius:6,fontSize:12,color:T.dm,textDecoration:"none"}}>dexscreener ↗</a>
<a href={"https://birdeye.so/token/"+lCA+"?chain=solana"} target="_blank" rel="noopener" style={{padding:"5px 10px",background:T.sf,border:"1px solid "+T.bd,borderRadius:6,fontSize:12,color:T.dm,textDecoration:"none"}}>birdeye ↗</a>
<a href={"https://photon-sol.tinyastro.io/en/lp/"+lCA} target="_blank" rel="noopener" style={{padding:"5px 10px",background:T.sf,border:"1px solid "+T.bd,borderRadius:6,fontSize:12,color:T.dm,textDecoration:"none"}}>photon ↗</a>
<button onClick={async(ev)=>{hp([20,30,20],ev);ev.currentTarget.style.opacity=".5";try{const r=await a.fr(asid,user.pubkey);toast(`Swept ${(r.totalRecovered||0).toFixed(4)} SOL`,"success")}catch(e){toast(e.message,"error")}ev.currentTarget.style.opacity="1"}} style={{padding:"5px 10px",background:T.yl+"08",border:"1px solid "+T.yl+"18",borderRadius:6,fontSize:9,fontWeight:700,color:T.yl,cursor:"pointer"}}>Force Sweep</button>
</div>
</div></EB>
:<>
{!mb&&<div style={{display:"flex",margin:0,overflow:"hidden",background:T.bg,borderBottom:"1px solid "+T.bd,position:"sticky",top:0,zIndex:19,backdropFilter:"blur(10px)"}}>{[{id:"radar",l:"Radar",ic:IC.radar},{id:"bags",l:"Bags",ic:IC.bags},{id:"deploy",l:"Deploy",ic:IC.deploy},{id:"intel",l:"Intel",ic:IC.sim}].map(t=>{const ac=tab===t.id;return<button key={t.id} onClick={()=>{sTab(t.id);sRExp(null);window.scrollTo({top:0,behavior:"smooth"})}} style={{flex:1,padding:"12px 0",background:ac?T.gn+"08":"transparent",borderBottom:ac?"2px solid "+T.gn:"2px solid transparent",border:"none",fontSize:16,fontWeight:ac?800:500,color:ac?T.gn:T.dm,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}><t.ic s={16} c={ac?T.gn:T.dm}/>{t.l}</button>})}</div>}
<div id="tc" style={{padding:mb?"0 6px 6px":"0 16px 16px",marginTop:mb?4:8,scrollMarginTop:50}}>

{tab==="radar"&&<EB l="Radar"><div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden",animation:"si .2s ease"}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",borderBottom:"1px solid "+T.bd}}><div style={{display:"flex",alignItems:"center",gap:5}}><IC.radar s={16} c={T.gn}/><span style={{fontSize:15,fontWeight:800}}>Radar</span><span style={{width:6,height:6,borderRadius:"50%",background:rEnabled?T.gn:T.rd}}/><span style={{fontSize:13,color:T.ft}}>{rPool}</span>{online>0&&<span style={{fontSize:11,color:T.gn+"66"}}>{online} online</span>}</div><div style={{display:"flex",gap:3}}><button onClick={()=>{sRL(true);a.gr().then(d=>{if(d.tabs)sRT(d.tabs);if(d.poolSize!=null)sRP(d.poolSize);sRL(false)}).catch(()=>sRL(false))}} style={{background:"none",border:"1px solid "+T.bd,borderRadius:5,padding:"4px 9px",cursor:"pointer",fontSize:14,color:T.dm}}>↻</button><button onClick={()=>sRE(!rEnabled)} style={{background:rEnabled?T.gn+"08":T.rd+"08",border:"1px solid "+(rEnabled?T.gn:T.rd)+"18",borderRadius:5,padding:"4px 10px",cursor:"pointer",fontSize:12,fontWeight:700,color:rEnabled?T.gn:T.rd}}>{rEnabled?"ON":"OFF"}</button></div></div>
<div style={{borderBottom:"1px solid "+T.bd}}><div style={{display:"flex",alignItems:"center",overflowX:"auto"}}>{[{id:"momentum",l:"Momentum",ic:IC.trend},{id:"hot",l:"Hot",ic:IC.fire},{id:"new",l:"New",ic:IC.star},{id:"graduating",l:"Grad",ic:IC.grad}].map(t=>{const ac=rTab===t.id;const n=(rt[t.id]||[]).length;return<button key={t.id} onClick={()=>{sRTab(t.id);sRExp(null);sRS("")}} style={{padding:mb?"8px 6px":"8px 12px",background:"none",border:"none",borderBottom:ac?"1.5px solid "+T.gn:"1.5px solid transparent",fontSize:mb?13:15,fontWeight:700,color:ac?T.gn:T.dm,cursor:"pointer",display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap"}}><t.ic s={14} c={ac?T.gn:T.dm}/>{t.l}{n>0&&<span style={{fontSize:10,opacity:.5}}>{n}</span>}</button>})}{!mb&&<><div style={{flex:1}}/><input value={rSearch} onChange={e=>{sRS(e.target.value);sRExp(null)}} placeholder="Search / CA" style={{width:180,padding:"6px 9px",margin:"3px 5px",background:T.bg,border:"1px solid "+T.bd,borderRadius:5,color:T.tx,fontSize:14,outline:"none"}}/></>}</div>{mb&&<div style={{padding:"4px 8px"}}><input value={rSearch} onChange={e=>{sRS(e.target.value);sRExp(null)}} placeholder="Search token name or paste CA..." style={{width:"100%",padding:"8px 10px",background:T.bg,border:"1px solid "+T.bd,borderRadius:6,color:T.tx,fontSize:14,outline:"none",boxSizing:"border-box"}}/></div>}</div>
{/* Expanded token detail panel */}
{expToken&&<TokenDetail t={expToken} T={T} mb={mb} trB={trB} buying={buying} selling={selling} sBuy={sBuy} sSell={sSell} quickBuy={quickBuy} quickSell={quickSell} toast={toast} held={held} onClose={()=>sRExp(null)} solP={solP}/>}
{/* Token list */}
{rLoad?<div style={{padding:40,textAlign:"center"}}><Sp s={16}/></div>:!rEnabled?<div style={{padding:40,textAlign:"center",fontSize:14,color:T.ft}}>Paused</div>:rFiltered.length===0?<div style={{padding:40,textAlign:"center",fontSize:14,color:T.ft}}>{caLoading?<><Sp s={14}/> Looking up CA...</>:rSearch?"No results for \""+rSearch+"\"":rTab==="momentum"?"Waiting for tokens with sustained buy pressure...":rTab==="hot"?"Waiting for tokens with multiple buyers...":rTab==="graduating"?"No tokens above $10K MC yet...":"Waiting for new launches..."}</div>:<div>{rFiltered.filter(t=>t.ca!==rExp).map(t=>{const isH=held.has(t.ca);return<div key={t.ca} onClick={()=>{sRExp(t.ca);setTimeout(()=>document.getElementById("tc")?.scrollIntoView({behavior:"smooth",block:"start"}),50)}} style={{display:"flex",alignItems:"center",gap:mb?6:10,padding:mb?"8px 10px":"9px 12px",cursor:"pointer",borderBottom:"1px solid "+T.bd,background:isH?T.gn+"03":"transparent"}}><div style={{width:mb?40:46,height:mb?40:46,borderRadius:8,overflow:"hidden",flexShrink:0,background:T.bg,position:"relative"}}>{t.image?<img src={imgProxy(t.image)} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="" onError={e=>e.target.style.display="none"}/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:T.ft+"33",fontWeight:900}}>{(tk(t.ticker)||"?")[0]}</div>}{isH&&<div style={{position:"absolute",top:0,right:0,background:T.gn,color:"#000",fontSize:7,fontWeight:900,padding:"0 2px",borderRadius:"0 0 0 2px"}}>H</div>}</div><div style={{minWidth:0,width:mb?80:120,flexShrink:0}}><div style={{fontSize:mb?15:16,fontWeight:800,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.name||tk(t.ticker)}</div><div style={{display:"flex",alignItems:"center",gap:3,marginTop:1}}><span style={{fontSize:mb?13:14,color:T.gn,fontWeight:700}}>{tk(t.ticker)}</span>{t.twitter&&<IC.tw s={9} c={T.dm}/>}{t.website&&<IC.globe s={9} c={T.dm}/>}{t.telegram&&<IC.tg s={9} c={T.dm}/>}{t.dexBoosted&&<span style={{fontSize:8,fontWeight:800,color:"#ffd600",background:"#ffd60012",padding:"0 3px",borderRadius:2,lineHeight:"14px"}} title={"DexScreener boosted: $"+(t.boostAmount||0)}>DEX BOOST</span>}</div>{t.description&&<div style={{fontSize:11,color:T.dm,marginTop:2,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",maxWidth:mb?80:120}}>{t.description.slice(0,60)}</div>}</div><div style={{flex:1,height:mb?22:28}}><SpkC data={t.spark||[]} color={t.spark&&t.spark.length>1&&t.spark[t.spark.length-1]>=t.spark[0]?T.gn:"#ff4444"} h={mb?22:28}/></div><div style={{textAlign:"right",flexShrink:0,minWidth:mb?50:64}}><div style={{fontSize:mb?15:17,fontWeight:800,color:fixMc(t,solP)>=gradMc?"#ffaa00":fixMc(t,solP)>=1e5?T.gn:fixMc(t,solP)>=1e4?T.yl:T.tx}}>${fm(fixMc(t,solP))}</div>{t.h1Change!=null&&<div style={{fontSize:12,color:t.h1Change>0?T.gn:"#ff4444"}}>{t.h1Change>0?"+":""}{typeof t.h1Change==="number"?t.h1Change.toFixed(1):t.h1Change}%</div>}{t.pctToGrad!=null&&<div style={{width:"100%",height:3,borderRadius:2,background:T.bd,marginTop:2}}><div style={{width:Math.min(100,t.pctToGrad)+"%",height:"100%",borderRadius:2,background:t.pctToGrad>=100?T.yl:T.gn}}/></div>}{t.graduated&&<div style={{fontSize:11,fontWeight:800,color:T.yl,marginTop:1}}>GRADUATED</div>}{t.dexBoosted&&!t.graduated&&<div style={{fontSize:10,fontWeight:800,color:"#ffd600",marginTop:1}}>BOOSTED</div>}</div></div>})}</div>}</div></EB>}

{tab==="bags"&&<EB l="Bags"><div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden",animation:"si .2s ease"}}><div style={{padding:"7px 10px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",justifyContent:"space-between"}}><div style={{display:"flex",alignItems:"center",gap:5}}><IC.bags s={16} c={T.gn}/><span style={{fontSize:15,fontWeight:800}}>Bags</span><span style={{fontSize:13,color:T.ft}}>{positions.length}</span></div><div style={{display:"flex",gap:3}}>{positions.length>0&&<button onClick={async()=>{if(!confirm("Sell ALL positions?"))return;try{const r=await a.sa(user.pubkey);toast(`Sold ${r.sold||0}`,"success")}catch(e){toast(e.message,"error")}}} style={{background:T.rd+"08",border:"1px solid "+T.rd+"18",borderRadius:5,padding:"4px 10px",fontSize:13,fontWeight:700,color:T.rd,cursor:"pointer"}}>Sell All</button>}<button onClick={()=>{a.gp(user.pubkey).then(d=>{if(d.positions){sPos(d.positions);sHeld(new Set(d.positions.map(p=>p.mint)))}toast("Refreshed","success")}).catch(()=>{})}} style={{background:"none",border:"1px solid "+T.bd,borderRadius:5,padding:"4px 10px",fontSize:13,color:T.dm,cursor:"pointer"}}>↻</button></div></div>
{!trW?<div style={{padding:30,textAlign:"center",fontSize:14,color:T.ft}}>Create trading key to start</div>
:positions.length===0?<div style={{padding:30,textAlign:"center"}}><div style={{fontSize:36,marginBottom:8,opacity:.2}}>💼</div><div style={{fontSize:14,color:T.ft}}>No positions yet</div><div style={{fontSize:12,color:T.ft,marginTop:4}}>Buy from Radar to see them here</div></div>
:<div>{positions.map(p=>{const mc=fixMc(p,solP);const val=p.valueSol||(p.valueUsd?p.valueUsd/solP:0);const isProfit=val>0;const expanded=rExp===p.mint;return<div key={p.mint} style={{borderBottom:"1px solid "+T.bd}}>
<div onClick={()=>sRExp(expanded?null:p.mint)} style={{display:"flex",alignItems:"center",gap:mb?6:10,padding:mb?"8px":"10px 12px",cursor:"pointer",background:expanded?T.gn+"04":"transparent"}}>
<div style={{width:42,height:42,borderRadius:8,overflow:"hidden",background:T.bg,flexShrink:0}}>{p.image?<img src={imgProxy(p.image)} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="" onError={e=>e.target.style.display="none"}/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,color:T.ft}}>{(tk(p.ticker)||"?")[0]}</div>}</div>
<div style={{flex:1,minWidth:0}}>
<div style={{display:"flex",alignItems:"baseline",gap:4}}><span style={{fontSize:14,fontWeight:800}}>{p.name||tk(p.ticker)||p.mint?.slice(0,8)}</span>{p.pending&&<span style={{fontSize:8,fontWeight:700,color:T.yl,background:T.yl+"12",padding:"1px 4px",borderRadius:3,animation:"gp 1.5s infinite"}}>CONFIRMING</span>}{mc>0&&<span style={{fontSize:13,color:T.ft}}>${fm(mc)}</span>}{p.holdPct>0&&<span style={{fontSize:10,color:T.pu}}>{p.holdPct}%</span>}</div>
<div style={{fontSize:13,color:T.dm}}>{fm(p.amount)} tokens</div>
</div>
<div style={{textAlign:"right",flexShrink:0}}>
<div style={{fontSize:16,fontWeight:900,color:isProfit?T.gn:T.rd}}>{val>0.0001?<>{solFmt(val)} <IC.sol s={14}/></>:"—"}</div>
{p.valueUsd>0&&<div style={{fontSize:13,color:T.dm}}>${p.valueUsd.toFixed(2)}</div>}
</div></div>
{/* Expanded view with chart + controls */}
{expanded&&<div style={{padding:"0 12px 10px",background:T.bg+"44"}}>
<CandleChart ca={p.mint} T={T} mb={mb}/>
{/* Buy more */}
<div style={{display:"flex",gap:3,marginTop:8}}>{[0.05,0.1,0.25,0.5].map(amt=><button key={amt} onClick={async()=>{try{await quickBuy(p.mint,amt);toast(`Buying ${amt} SOL...`,"success")}catch(e){toast(e.message,"error")}}} style={{flex:1,padding:"8px 0",background:T.gn+"06",border:"1px solid "+T.gn+"18",borderRadius:5,fontSize:12,fontWeight:800,color:T.gn,cursor:"pointer"}}>{amt}</button>)}</div>
{/* Sell */}
<div style={{display:"flex",gap:3,marginTop:4}}>{[25,50,100].map(pct=>{const sellKey=p.mint+pct;const isSelling=selling===sellKey;return<button key={pct} disabled={isSelling} onClick={async()=>{sSell(sellKey);try{await quickSell(p.mint,pct);toast(`Sold ${pct}%`,"success")}catch(e){toast(e.message,"error")}sSell(null)}} style={{flex:1,padding:"10px 0",background:isSelling?"#ff444422":"#ff444408",border:"1px solid #ff444422",borderRadius:5,fontSize:13,fontWeight:800,color:"#ff4444",cursor:isSelling?"wait":"pointer",opacity:isSelling?.5:1}}>{isSelling?<Sp s={8} c="#ff4444"/>:pct===100?"SELL ALL":pct+"%"}</button>})}</div>
{/* Links */}
<div style={{display:"flex",gap:3,marginTop:4}}><button onClick={()=>{navigator.clipboard?.writeText(p.mint);toast("CA copied","success")}} style={{flex:1,padding:"8px 0",background:"none",border:"1px solid "+T.bd,borderRadius:5,fontSize:12,color:T.ft,cursor:"pointer"}}>Copy CA</button><a href={"https://pump.fun/coin/"+p.mint} target="_blank" rel="noopener" style={{flex:1,padding:"8px 0",background:T.gn+"06",border:"1px solid "+T.gn+"18",borderRadius:5,fontSize:12,color:T.gn,textDecoration:"none",fontWeight:700,textAlign:"center"}}>pump.fun</a><a href={"https://dexscreener.com/solana/"+p.mint} target="_blank" rel="noopener" style={{flex:1,padding:"8px 0",background:"none",border:"1px solid "+T.bd,borderRadius:5,fontSize:12,color:T.dm,textDecoration:"none",textAlign:"center"}}>dex</a></div>
</div>}
</div>})}</div>}
{/* Referrals */}
<div style={{padding:"8px 10px",borderTop:"1px solid "+T.bd}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:11,fontWeight:700}}>Referrals</span>{refData?.referralCode&&<span style={{fontSize:11,color:T.dm}}>Refs: <b style={{color:T.gn}}>{refData.referralCount||0}</b> Earned: <b style={{color:T.gn}}>{fs(refData.referralEarnings||0,3)} SOL</b></span>}</div>
{refData?.referralCode?<div style={{display:"flex",gap:3}}><div style={{flex:1,background:T.bg,border:"1px solid "+T.bd,borderRadius:5,padding:"4px 8px",fontSize:11,color:T.gn,fontWeight:800}}>{refData.referralCode}</div><button onClick={()=>{navigator.clipboard?.writeText(window.location.origin+"?ref="+refData.referralCode);toast("Link copied","success")}} style={{background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:5,padding:"4px 8px",fontSize:9,fontWeight:700,color:T.gn,cursor:"pointer"}}>Copy Link</button></div>:<div style={{fontSize:9,color:T.ft}}>Loading...</div>}
<div style={{marginTop:4,display:"flex",gap:3}}><input value={refInput} onChange={e=>sRefInput(e.target.value)} placeholder="Enter referral code" style={{flex:1,padding:"4px 7px",background:T.bg,border:"1px solid "+T.bd,borderRadius:5,color:T.tx,fontSize:10,outline:"none"}}/><button onClick={async()=>{if(!refInput.trim())return;try{const r=await a.arf(user.pubkey,refInput.trim());toast(r.ok?"Referral applied!":"Failed","success");if(r.ok)sRefInput("")}catch(e){toast(e.message,"error")}}} style={{background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:5,padding:"4px 8px",fontSize:9,fontWeight:700,color:T.gn,cursor:"pointer"}}>Apply</button></div>
</div>
</div></EB>}

{tab==="deploy"&&<EB l="Deploy"><div style={{animation:"si .2s ease"}} className="st">{!trW?<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:24,textAlign:"center"}}><IC.key s={24} c={T.yl}/><div style={{fontSize:11,color:T.dm,marginTop:8,marginBottom:12}}>Create trading key first</div><B onClick={async()=>{try{const r=await a.ctw(a.w);if(r.ok){sTrW(r.tradingWallet);sTrK(r);toast("Created","success")}}catch(e){toast(e.message,"error")}}} small><IC.key s={12} c="#0a0a0f"/> Create Key</B></div>:<>
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?10:16,marginBottom:6}}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:mb?8:12}}><IC.rocket s={18}/><span style={{fontFamily:S,fontWeight:800,fontSize:mb?16:18}}>Token</span></div><div style={{display:"flex",gap:10,marginBottom:8}}><ImgUp image={img} onChange={sImg} mb={mb}/><div style={{flex:1}}><div style={{display:"flex",gap:6,marginBottom:6}}><div style={{flex:1}}><div style={{fontSize:13,color:T.ft,marginBottom:3,textTransform:"uppercase"}}>Name</div><In value={tn} onChange={sTn} placeholder="Token name"/></div><div style={{flex:1}}><div style={{fontSize:13,color:T.ft,marginBottom:3,textTransform:"uppercase"}}>Ticker</div><In value={tkr} onChange={sTk} placeholder="TICKER"/></div></div><div style={{fontSize:13,color:T.ft,marginBottom:3,textTransform:"uppercase"}}>Description</div><In value={desc} onChange={sDs} placeholder="Optional"/></div></div><div style={{display:"flex",gap:6,marginTop:8,marginBottom:6}}><div style={{flex:1}}><div style={{fontSize:13,color:T.ft,marginBottom:3,textTransform:"uppercase",display:"flex",alignItems:"center",gap:3}}><IC.tw s={9} c={T.ft}/>Twitter</div><In value={tw} onChange={sTw} placeholder="@handle or URL"/></div><div style={{flex:1}}><div style={{fontSize:13,color:T.ft,marginBottom:3,textTransform:"uppercase",display:"flex",alignItems:"center",gap:3}}><IC.globe s={9} c={T.ft}/>Website</div><In value={wb} onChange={sWb} placeholder="https://"/></div><div style={{flex:1}}><div style={{fontSize:13,color:T.ft,marginBottom:3,textTransform:"uppercase",display:"flex",alignItems:"center",gap:3}}><IC.tg s={9} c={T.ft}/>Telegram</div><In value={tg} onChange={sTg} placeholder="t.me/group"/></div></div><div style={{marginTop:6}}><div style={{fontSize:13,color:T.ft,marginBottom:3,textTransform:"uppercase"}}>Or ape existing CA</div><In value={eCA} onChange={sECA} placeholder="Contract address"/></div></div>
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?10:16,marginBottom:6}}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><IC.shield s={18}/><span style={{fontFamily:S,fontWeight:800,fontSize:mb?16:18}}>Fleet</span><div style={{marginLeft:"auto"}}><button onClick={()=>sExpert(!expert)} style={{background:"none",border:"1px solid "+T.bd,borderRadius:5,padding:"1px 7px",fontSize:8,color:expert?T.gn:T.ft,cursor:"pointer"}}>{expert?"expert":"simple"}</button></div></div><div style={{display:"grid",gridTemplateColumns:`repeat(${PRESETS.length},1fr)`,gap:3,marginBottom:8}}>{PRESETS.map(p=>{const ac=sol===p.sol&&snc===p.snc;return<button key={p.name} onClick={()=>applyPreset(p)} style={{padding:"8px 4px",background:ac?T.gn+"08":T.bg,border:"1px solid "+(ac?T.gn+"22":T.bd),borderRadius:6,cursor:"pointer",textAlign:"center"}}><div style={{fontSize:13,fontWeight:800,color:ac?T.gn:T.tx}}>{p.name}</div><div style={{fontSize:10,color:T.ft,marginTop:1}}>{p.sol} SOL</div><div style={{fontSize:8,color:ac?T.gn:T.dm,marginTop:2}}>{p.desc}</div></button>})}</div><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:13,color:T.ft,textTransform:"uppercase",fontWeight:700}}>Budget</span><span style={{fontSize:26,fontWeight:900,color:T.gn}}>{sol}</span></div><input type="range" min={.2} max={50} step={.1} value={sol} onChange={e=>sSol(Number(e.target.value))} style={{width:"100%",marginBottom:6}}/>{expert&&<div style={{display:"grid",gridTemplateColumns:mb?"1fr 1fr":"1fr 1fr 1fr 1fr",gap:4,marginBottom:6}}><NI label="Snipers" value={snc} onChange={sSn} min={0} max={5}/><NI label="Slip %" value={slip} onChange={sSl} min={1} max={50}/><NI label="Dur m" value={dur} onChange={sDur} min={5} max={240} step={5}/><NI label="Jito" value={jt} onChange={sJt} min={.001} max={.1} step={.001} decimals={3}/></div>}<div style={{display:"grid",gridTemplateColumns:isApe?"repeat(3,1fr)":"repeat(4,1fr)",gap:1,background:T.bd,borderRadius:5,overflow:"hidden"}}>{(isApe?[{k:"Fleet",v:sol.toFixed(2)},{k:"Wallets",v:nw},{k:"Snipers",v:snc}]:[{k:"Dev",v:pv.dv.toFixed(2)},{k:"Fleet",v:pv.fl.toFixed(2)},{k:"Wallets",v:nw},{k:"Snipers",v:snc}]).map(s=><div key={s.k} style={{background:T.bg,padding:"5px 2px",textAlign:"center"}}><div style={{fontSize:15,fontWeight:800,color:T.gn}}>{s.v}</div><div style={{fontSize:12,color:T.ft}}>{s.k}</div></div>)}</div></div>

{/* ═══ WALLET SELECTION (Pro/VIP) ═══ */}
{expert&&(user?.tier==="pro"||user?.whitelisted)&&<div style={{background:T.sf,border:"1px solid "+T.pu+"18",borderRadius:10,padding:mb?10:16,marginBottom:6}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><IC.key s={14} c={T.pu}/><span style={{fontSize:12,fontWeight:800}}>Fleet Wallets</span><span style={{fontSize:11,color:T.dm}}>({nw} wallets)</span></div>
<div style={{fontSize:8,color:T.dm,marginBottom:8,lineHeight:1.5}}>Paste private keys for aged wallets. Empty = fresh keypair auto-generated.</div>
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr",gap:4}}>
{(()=>{
const roles=["dev"];
for(let i=1;i<=snc;i++)roles.push("sniper_"+i);
const brainTypes=["accumulator","volume","momentum","diamond","whale_bluffer","degen_aper","momentum_rider","wash_painter","stealth_buyer","front_runner","bag_holder","exit_liquidity","sweep_bot","arb_walker","signal_follower","phantom_buyer"];
let ri=0;
while(roles.length<nw&&ri<brainTypes.length){roles.push(brainTypes[ri]);ri++}
while(roles.length<nw){roles.push("fleet_"+(roles.length-snc))}
return roles.map(role=>{
const roleLabel=role==="dev"?"Dev Wallet":role.startsWith("sniper")?"Sniper "+role.split("_")[1]:role.startsWith("fleet_")?"Fleet "+role.split("_")[1]:role.split("_").map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(" ");
const roleColor=role==="dev"?T.yl:role.startsWith("sniper")?T.gn:role.startsWith("fleet")?T.dm:T.pu;
return<div key={role} style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:"6px 8px"}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:3}}>
<span style={{fontSize:8,fontWeight:700,color:roleColor}}>{roleLabel}</span>
<span style={{fontSize:10,color:T.ft}}>{role==="dev"?"required":"optional"}</span>
</div>
<input placeholder="Paste private key or leave empty (auto)" style={{width:"100%",padding:"4px 6px",background:T.sf,border:"1px solid "+T.bd,borderRadius:4,fontSize:8,color:T.tx,fontFamily:M,outline:"none",boxSizing:"border-box"}}
data-role={role}/>
</div>})
})()}
</div>
<div style={{marginTop:6,fontSize:10,color:T.ft}}>Imported keys used for fleet. Empty slots get fresh keypairs.</div>
</div>}

{/* ═══ LAUNCH PREVIEW SIM ═══ */}
<EB l="Preview"><SimMode mb={mb} budget={sol} sniperCount={snc} gradMc={gradMc}/></EB>

{/* ═══ LAUNCH COST BREAKDOWN ═══ */}
{!isApe&&canLaunch&&<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?8:12,marginBottom:6}}>
<div style={{fontSize:11,fontWeight:700,marginBottom:6}}>Cost Breakdown</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,fontSize:10}}>
<div style={{color:T.ft}}>Dev buy (your position)</div><div style={{color:T.gn,fontWeight:700,textAlign:"right"}}>{pv.dv} SOL</div>
<div style={{color:T.ft}}>Fleet wallets ({nw-1})</div><div style={{color:T.gn,fontWeight:700,textAlign:"right"}}>{pv.fl} SOL</div>
<div style={{color:T.ft}}>Network fee</div><div style={{color:T.gn,fontWeight:700,textAlign:"right"}}>{pv.fe} SOL</div>
<div style={{borderTop:"1px solid "+T.bd,paddingTop:4,color:T.tx,fontWeight:800}}>Total</div><div style={{borderTop:"1px solid "+T.bd,paddingTop:4,color:T.gn,fontWeight:900,textAlign:"right"}}>{sol} SOL</div>
</div>
{trB<sol&&trB>0&&<div style={{marginTop:6,fontSize:9,color:T.rd,fontWeight:700}}>Insufficient balance ({solFmt(trB)} SOL). Deposit {(sol-trB).toFixed(3)} SOL to launch.</div>}
</div>}

<div style={{background:canLaunch?T.gn+"04":T.sf,border:"1px solid "+(canLaunch?T.gn+"22":T.bd),borderRadius:10,padding:mb?10:16,marginBottom:6}}>
{launchStep?<div style={{textAlign:"center",padding:"8px 0"}}>
{/* Step progress */}
<div style={{display:"flex",justifyContent:"center",gap:4,marginBottom:10}}>
{["creating","uploading","funding","dev_buy","snipers","live"].map((step,i)=>{const steps=["creating","uploading","funding","dev_buy","snipers","live"];const ci=steps.indexOf(launchStep);const done=i<ci;const active=i===ci;return<div key={step} style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:active?28:8,height:8,borderRadius:4,background:done?T.gn:active?T.gn:T.bd,transition:"all .3s",position:"relative",overflow:"hidden"}}>{active&&<div style={{position:"absolute",inset:0,background:`linear-gradient(90deg,transparent,${T.gn}88,transparent)`,animation:"scan 1.5s linear infinite"}}/>}</div></div>})}
</div>
<div style={{fontSize:13,fontWeight:800,color:launchStep==="live"?T.gn:T.yl,marginBottom:4}}>
{launchStep==="creating"?"Creating session..."
:launchStep==="uploading"?"Uploading token data..."
:launchStep==="funding"?"Funding fleet wallets..."
:launchStep==="dev_buy"?"Dev buy executing..."
:launchStep==="snipers"?"Deploying snipers..."
:launchStep==="live"?"LIVE — Fleet active":""}
</div>
<div style={{fontSize:12,color:T.dm}}>
{launchStep==="creating"?"Generating keypairs + session"
:launchStep==="uploading"?"Image + metadata → pump.fun"
:launchStep==="funding"?"Distributing SOL to "+snc+" sniper + "+(wc(sol)-1)+" fleet wallets"
:launchStep==="dev_buy"?"First buy on bonding curve → your position"
:launchStep==="snipers"?"Snipers entering at staggered intervals"
:launchStep==="live"?"GameState monitoring opponents":""}
</div>
{launchStep!=="live"&&<div style={{marginTop:6}}><Sp s={14}/></div>}
</div>
:<B full disabled={!canLaunch} onClick={async()=>{if(!canLaunch)return;hp([6,15,6]);sLS("creating");
// Collect imported wallet keys from inputs
const importedKeys={};
document.querySelectorAll("input[data-role]").forEach(inp=>{const v=inp.value.trim();if(v)importedKeys[inp.dataset.role]=v});
try{const r=await a.sc({totalSol:sol,tokenConfig:{name:tn,ticker:tkr,description:desc,image:img,twitter:tw,telegram:tg,website:wb,existingCA:eCA},wallet:user.pubkey,fleetConfig:{sniperCount:snc,slippage:slip,duration:dur,jitoTip:jt,importedKeys},masterSeed:trK?.privateKey||""});
sLS("uploading");await new Promise(r=>setTimeout(r,800));
if(r.useMaster&&r.funded){sLS("funding");await new Promise(r=>setTimeout(r,1200));sLS("dev_buy");const l=await a.sl(r.sessionId,user.pubkey);sLS("snipers");await new Promise(r=>setTimeout(r,1500));if(l.tokenCA){sLCA(l.tokenCA);sLd(true);sAsid(r.sessionId);sLS("live");hp([20,40,20]);toast("LIVE — Fleet deployed","success");setTimeout(()=>sLS(null),3000)}}
else{sLS("funding");toast("Send "+sol+" SOL → "+r.devWallet,"info");navigator.clipboard?.writeText(r.devWallet);const poll=setInterval(async()=>{try{const b=await a.sb(r.sessionId,user.pubkey);if(b.funded){clearInterval(poll);sLS("dev_buy");await new Promise(r=>setTimeout(r,1000));sLS("snipers");const l=await a.sl(r.sessionId,user.pubkey);await new Promise(r=>setTimeout(r,1500));if(l.tokenCA){sLCA(l.tokenCA);sLd(true);sAsid(r.sessionId);sLS("live");hp([20,40,20]);toast("LIVE","success");setTimeout(()=>sLS(null),3000)}}}catch{}},2000);setTimeout(()=>{clearInterval(poll);if(!launched)sLS(null)},180000)}}
catch(e){toast(e.message,"error");sLS(null)}}} style={{animation:canLaunch?"gp 2s infinite":"none"}}><IC.rocket s={14} c={canLaunch?"#0a0a0f":"#888"}/> {isApe?"Ape "+eCA.slice(0,8)+"…":"Launch "+(tn||"Token")}</B>}
</div>
{pSess.length>0&&<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?8:12}}><div style={{fontSize:11,fontWeight:700,marginBottom:6}}>Sessions</div>{pSess.map(s=><div key={s.id} style={{display:"flex",alignItems:"center",gap:5,padding:"6px 4px",marginBottom:2,borderRadius:6,background:T.bg+"55",border:"1px solid "+T.bd}}><div style={{width:24,height:24,borderRadius:5,overflow:"hidden",background:T.bg,flexShrink:0}}>{s.tokenConfig?.image?<img src={imgProxy(s.tokenConfig?.image)} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:T.ft+"44",fontWeight:900}}>{(tk(s.tokenConfig?.ticker)||s.tokenCA?.slice(0,1)||"?")[0]}</div>}</div><span style={{fontSize:10,color:T.md,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tk(s.tokenConfig?.ticker)||s.tokenCA?.slice(0,6)}</span><button onClick={async()=>{try{const r=await a.ss(s.id,user.pubkey);const swept=r.totalSwept||r.totalRecovered||0;toast(swept>0.001?`Closed — ${swept.toFixed(4)} SOL swept`:"Closed","success")}catch(e){toast("Close: "+(e.message||"error"),"error")};sPS(p=>p.filter(x=>x.id!==s.id))}} style={{background:T.rd+"08",color:T.rd,border:"1px solid "+T.rd+"18",fontSize:7,fontWeight:700,padding:"2px 5px",borderRadius:3,cursor:"pointer"}}>Close</button><button onClick={async()=>{try{const r=await a.fr(s.id,user.pubkey);const amt=r.totalRecovered||0;if(amt>0.001){toast(`Swept ${amt.toFixed(4)} SOL`,"success");sPS(p=>p.filter(x=>x.id!==s.id))}else toast("Nothing to sweep","info")}catch(e){toast(e.message,"error")}}} style={{background:T.yl+"08",color:T.yl,border:"1px solid "+T.yl+"18",fontSize:7,fontWeight:700,padding:"2px 5px",borderRadius:3,cursor:"pointer"}}>Sweep</button><button onClick={async()=>{try{const k=await a.ek(s.id,user.pubkey);if(k.ok&&k.keys?.length){navigator.clipboard?.writeText(k.keys.map(w=>(w.role||"w")+": "+w.secret).join("\n"));toast(k.keys.length+" keys copied","success")}else toast("No keys","info")}catch(e){toast(e.message,"error")}}} style={{background:"none",color:T.ft,border:"1px solid "+T.bd,fontSize:7,fontWeight:700,padding:"2px 5px",borderRadius:3,cursor:"pointer"}}>Keys</button><button onClick={()=>{sLCA(s.tokenCA);sLd(true);sAsid(s.id)}} style={{background:T.gn+"08",color:T.gn,border:"1px solid "+T.gn+"18",fontSize:7,fontWeight:700,padding:"2px 5px",borderRadius:3,cursor:"pointer"}}>View</button></div>)}</div>}
</>}</div></EB>}

{/* INTEL TAB — Meme Analytics for everyone */}
{tab==="intel"&&<EB l="Intel"><div style={{animation:"si .2s ease"}}>
<div style={{background:T.sf,border:"1px solid "+T.pu+"18",borderRadius:10,padding:mb?8:12,marginBottom:6}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}><IC.sim s={16} c={T.pu}/><span style={{fontSize:15,fontWeight:800}}>Meme Intelligence</span><span style={{width:5,height:5,borderRadius:"50%",background:T.gn,animation:"gp 2s infinite"}}/></div>
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:3,marginBottom:6}}>
{[{l:"TOKENS",v:intelData?.memory?.total||"—",c:T.pu},{l:"ACCURACY",v:intelData?.scorer?.accuracy||"—",c:T.gn},{l:"GRAD RATE",v:intelData?.memory?.graduationRate||"—",c:T.yl},{l:"TRACKING",v:intelData?.monitor?.tracking||"—",c:T.or}].map(s=><div key={s.l} style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:"6px 4px",textAlign:"center"}}><div style={{fontSize:18,fontWeight:900,color:s.c}}>{s.v}</div><div style={{fontSize:9,color:T.ft,fontWeight:700,marginTop:1}}>{s.l}</div></div>)}
</div>
<div style={{fontSize:11,color:T.ft,textAlign:"center"}}>{intelData?`${intelData.scorer?.trainCount||0} tokens scored · SOL $${intelData.solPrice?.toFixed(0)||"?"} · uptime ${intelData.uptime||"—"}`:"Connecting to intel engine..."}</div>

{/* ═══ LIVE INTEL: Scores + Spotlight + Pulse (3 columns) ═══ */}
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr 1fr",gap:4,marginTop:6}}>

{/* Recent Scores */}
<div style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:10,maxHeight:280,overflowY:"auto"}}><div style={{fontSize:13,fontWeight:700,color:T.dm,marginBottom:6}}>Recent Scores {(user?.tier==="pro"||user?.whitelisted)&&<span style={{color:T.gn,fontSize:8}}>· click to ape</span>}</div>{(intelData?.recentEvents||[]).slice(0,8).map((e,i)=>{const fullCA=e.data?.ca||"";const name=e.data?.name||fullCA.slice(0,6);return<div key={i} onClick={()=>{if(!user?.whitelisted&&user?.tier==="free"){toast("Pro/VIP only","error");return}
if(!fullCA||fullCA.length<20){toast("No CA available","error");return}
sTab("radar");sRExp(fullCA);sRS("");
setTimeout(()=>document.getElementById("tc")?.scrollIntoView({behavior:"smooth",block:"start"}),150);
toast(name,"success")}} style={{display:"flex",alignItems:"center",gap:4,padding:"4px 2px",fontSize:10,color:T.dm,cursor:"pointer",borderRadius:4}}><span style={{width:6,height:6,borderRadius:"50%",background:e.data?.score>=50?T.gn:e.data?.score>=25?T.yl:T.ft,flexShrink:0}}/><span style={{color:T.tx,fontWeight:700,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:11}}>{name}</span><span style={{color:e.data?.score>=50?T.gn:e.data?.score>=25?T.yl:T.ft,fontWeight:800,fontSize:11,flexShrink:0}}>{e.data?.score}pts</span><span style={{color:T.yl,fontSize:9,flexShrink:0}}>{e.data?.bondProb}%</span>{e.data?.score>=50&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:2,background:T.gn+"18",color:T.gn,fontWeight:800,flexShrink:0}}>APE</span>}{e.data?.score>=25&&e.data?.score<50&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:2,background:T.yl+"18",color:T.yl,fontWeight:800,flexShrink:0}}>WATCH</span>}</div>})}</div>

{/* Token Spotlight — top scoring token with image */}
<div style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:10,display:"flex",flexDirection:"column",maxHeight:280}}>
<div style={{fontSize:13,fontWeight:700,color:T.dm,marginBottom:6}}>Top Signal</div>
{(()=>{const top=intelData?.recentEvents?.[0]?.data;if(!top)return<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:T.ft}}>Scanning...</div>;
const allT=[...(rt.momentum||[]),...(rt.hot||[]),...(rt.new||[]),...(rt.graduating||[])];
const match=allT.find(t=>t.ca===top.ca);
return<div style={{flex:1,display:"flex",flexDirection:"column",gap:6}}>
<div style={{display:"flex",gap:8,alignItems:"center"}}>
<div style={{width:52,height:52,borderRadius:8,overflow:"hidden",background:T.sf,flexShrink:0}}>{match?.image?<img src={imgProxy(match.image)} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="" onError={e=>e.target.style.display="none"}/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:T.pu+"66",fontWeight:900}}>{(top.name||"?")[0]}</div>}</div>
<div><div style={{fontSize:13,fontWeight:900,color:T.tx}}>{top.name||top.ca?.slice(0,8)}</div>
<div style={{fontSize:8,color:T.ft,marginTop:1}}>{top.ca?.slice(0,12)}…</div>
<div style={{display:"flex",gap:4,alignItems:"center",marginTop:3}}><span style={{fontSize:22,fontWeight:900,color:top.score>=50?T.gn:top.score>=25?T.yl:T.pu}}>{top.score}</span><span style={{fontSize:11,color:T.ft}}>pts</span><span style={{fontSize:11,fontWeight:700,color:T.yl}}>{top.bondProb}%</span><span style={{fontSize:11,color:T.ft}}>bond</span></div>
{top.mcap>0&&<div style={{fontSize:12,color:T.dm,marginTop:1}}>${(top.mcap/1000).toFixed(1)}K MC</div>}
</div></div>
{/* Signal breakdown */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginTop:"auto"}}>
{[{l:"Velocity",v:Math.min(10,Math.round((top.buys||match?.buys||0)/Math.max(1,((match?.age||60)/60)))),mx:10},
{l:"Pressure",v:match?Math.round((match.buys||0)/Math.max(1,(match.buys||0)+(match.sells||0))*10):5,mx:10},
{l:"Diversity",v:Math.min(10,top.ub||match?.uniqueBuyers||0),mx:10},
{l:"Social",v:(match?.twitter?4:0)+(match?.website?3:0)+(match?.telegram?3:0),mx:10}
].map(s=><div key={s.l} style={{display:"flex",alignItems:"center",gap:3}}>
<span style={{fontSize:7,color:T.ft,width:40,textAlign:"right"}}>{s.l}</span>
<div style={{flex:1,height:5,borderRadius:2,background:T.sf}}><div style={{width:(s.v/s.mx*100)+"%",height:"100%",borderRadius:2,background:T.gn}}/></div>
<span style={{fontSize:7,color:T.gn,width:12,fontWeight:700}}>{s.v}</span>
</div>)}
</div>
{(user?.tier==="pro"||user?.whitelisted)&&<button onClick={()=>{if(top.ca){sTab("radar");sRExp(top.ca);toast(top.name||"Opening...","success")}}} style={{marginTop:6,padding:"6px 0",background:T.gn+"0a",border:"1px solid "+T.gn+"22",borderRadius:5,fontSize:10,fontWeight:800,color:T.gn,cursor:"pointer",width:"100%"}}>Ape {top.name?.slice(0,14)||"Token"}</button>}
</div>})()}
</div>

{/* Live Radar Pulse — enhanced activity visualization */}
<div style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:10}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
<div style={{display:"flex",alignItems:"center",gap:6}}>
<span style={{width:6,height:6,borderRadius:"50%",background:T.gn,animation:"gp 2s infinite"}}/>
<span style={{fontSize:13,fontWeight:800,color:T.tx}}>Live Radar Pulse</span>
</div>
<div style={{display:"flex",gap:8,fontSize:10,color:T.ft}}>
<span><span style={{display:"inline-block",width:6,height:6,borderRadius:1,background:T.gn,marginRight:3,verticalAlign:"middle"}}/>APE</span>
<span><span style={{display:"inline-block",width:6,height:6,borderRadius:1,background:T.yl,marginRight:3,verticalAlign:"middle"}}/>WATCH</span>
<span><span style={{display:"inline-block",width:6,height:6,borderRadius:1,background:"#ff1744",marginRight:3,verticalAlign:"middle"}}/>RUG RISK</span>
</div>
</div>
<div style={{display:"flex",flexDirection:"column",gap:2}}>
{(intelData?.recentEvents||[]).slice(0,12).map((e,i)=>{
const score=e.data?.score||0;const bp=e.data?.bondProb||0;const name=e.data?.name||e.data?.ca?.slice(0,6)||"?";
const rugScore=e.data?.rugScore||0;const rugFlags=e.data?.rugFlags||[];
const isRug=rugScore>50||rugFlags.length>=2;
const sc=isRug?"#ff1744":score>=50?T.gn:score>=25?T.yl:T.pu;
const mcap=e.data?.mcap||0;const mcapStr=mcap>=1000?(mcap/1000).toFixed(1)+"K":mcap>0?mcap.toString():"—";
return<div key={i} style={{display:"grid",gridTemplateColumns:"16px 110px 1fr 28px 58px 32px",alignItems:"center",padding:"3px 0",borderBottom:i<11?"1px solid "+T.bd+"44":"none",gap:0}}>
{/* Rank — fixed col */}
<span style={{fontSize:8,color:T.ft,textAlign:"center"}}>{i+1}</span>
{/* Name — fixed col */}
<div style={{paddingLeft:2,paddingRight:4,overflow:"hidden"}}>
<span style={{fontSize:10,color:T.tx,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",display:"flex",alignItems:"center",gap:2}}>{name.slice(0,14)}{e.data?.dexBoosted&&<span style={{fontSize:6,fontWeight:800,color:"#ffd600",background:"#ffd60015",padding:"0 2px",borderRadius:2}} title={"DexScreener boosted: $"+e.data.boostAmount}>BOOST</span>}</span>
</div>
{/* Score bar — fills remaining space */}
<div style={{height:16,borderRadius:4,background:T.sf,overflow:"hidden",position:"relative",marginRight:4}}>
<div style={{position:"absolute",left:0,top:0,height:"100%",width:Math.min(100,score)+"%",borderRadius:4,background:`linear-gradient(90deg,${sc}66,${sc})`,transition:"width 0.6s ease"}}/>
<div style={{position:"absolute",left:Math.min(98,bp)+"%",top:2,width:2,height:12,borderRadius:1,background:"rgba(255,255,255,0.5)",transition:"left 0.6s ease"}}/>
{isRug&&<div style={{position:"absolute",right:0,top:0,height:"100%",width:"30%",background:"repeating-linear-gradient(45deg,transparent,transparent 2px,#ff174422 2px,#ff174422 4px)"}}/>}
</div>
{/* Score — fixed col */}
<span style={{fontSize:12,color:sc,fontWeight:900,textAlign:"right"}}>{score}</span>
{/* Bond + MC — fixed col */}
<div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",paddingLeft:4}}>
<span style={{fontSize:7,color:T.yl,fontWeight:700}}>{bp}% bond</span>
<span style={{fontSize:9,color:T.ft}}>${mcapStr}</span>
</div>
{/* Rug badge — fixed col (always present, empty if no rug) */}
<div style={{textAlign:"center"}}>
{isRug&&<span style={{fontSize:7,color:"#ff1744",fontWeight:800,padding:"1px 4px",borderRadius:3,background:"#ff174415"}} title={rugFlags.join(", ")}>RUG</span>}
</div>
</div>})}
</div>
{/* Stats footer */}
{intelData&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:3,marginTop:8,paddingTop:6,borderTop:"1px solid "+T.bd}}>
<div style={{textAlign:"center"}}><div style={{fontSize:14,fontWeight:900,color:T.pu}}>{intelData.memory?.total||0}</div><div style={{fontSize:10,color:T.ft}}>TRACKED</div></div>
<div style={{textAlign:"center"}}><div style={{fontSize:14,fontWeight:900,color:T.gn}}>{intelData.monitor?.tracking||0}</div><div style={{fontSize:10,color:T.ft}}>ACTIVE</div></div>
<div style={{textAlign:"center"}}><div style={{fontSize:14,fontWeight:900,color:T.yl}}>{intelData.memory?.graduated||0}</div><div style={{fontSize:10,color:T.ft}}>GRADS</div></div>
<div style={{textAlign:"center"}}><div style={{fontSize:14,fontWeight:900,color:"#ff1744"}}>{(intelData?.recentEvents||[]).filter(e=>(e.data?.rugScore||0)>50||(e.data?.rugFlags||[]).length>=2).length}</div><div style={{fontSize:10,color:T.ft}}>RUG RISK</div></div>
</div>}
{/* Graduated Watchlist — 24h follow */}
{intelData?.gradWatch?.count>0&&<div style={{marginTop:6,paddingTop:6,borderTop:"1px solid "+T.bd}}>
<div onClick={()=>sGradsOpen(!gradsOpen)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}>
<span style={{fontSize:10,fontWeight:800,color:T.yl}}>Following Grads</span>
<span style={{fontSize:8,color:T.ft}}>{intelData.gradWatch.count} tracked 24h {gradsOpen?"▾":"▸"}</span>
</div>
{gradsOpen&&intelData.gradWatch.tokens?.map(g=>{const c=g.changePct>=0?T.gn:T.rd;return<div key={g.ca} style={{display:"flex",alignItems:"center",gap:6,padding:"2px 0",fontSize:9}}>
<span style={{color:T.tx,fontWeight:700,flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{g.name||g.ca?.slice(0,6)}</span>
<span style={{color:T.ft}}>${fm(g.currentMcap)}</span>
<span style={{color:c,fontWeight:800}}>{g.changePct>=0?"+":""}{g.changePct}%</span>
<span style={{color:T.ft}}>{g.age}h</span>
</div>})}
</div>}
</div>

</div>{/* end grid */}
</div>

{/* How it works — collapsible */}
<button onClick={()=>sShowHow(!showHow)} style={{width:"100%",padding:"8px 10px",background:T.sf,border:"1px solid "+T.bd,borderRadius:8,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
<span style={{fontSize:12,fontWeight:700,color:T.dm}}>How scoring works</span>
<span style={{fontSize:10,color:T.ft}}>{showHow?"▾":"▸"}</span>
</button>
{showHow&&<>
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr 1fr",gap:4,marginBottom:6}}>
{[{name:"Tipping Point (Gladwell)",color:T.gn,items:["Law of the Few — whale/influencer concentration","Stickiness Factor — meme phrase memorability","Power of Context — trending topic + market mood","Maven/Connector/Salesman — wallet archetype signals","10K Hour Rule — token pattern maturity depth"]},
{name:"Thinking Fast & Slow (Kahneman)",color:T.yl,items:["Cognitive Ease — name pronounceability score","Anchoring Bias — first price vs current price drift","Availability Heuristic — recency of similar rugs","Loss Aversion — 2x weight on sell pressure vs buys","Herd Signal — System 1 buy acceleration cascade","Peak-End Rule — chart shape memory at peak + now","Prospect Theory — framing effect on holder behavior"]},
{name:"Blink + Outliers (Gladwell)",color:"#ff9800",items:["Thin-Slicing — first 30s pattern = 80% accuracy","Outlier Detection — 3σ deviation from normal launches","Rapid Cognition — sub-second rug signature match","Accumulative Advantage — early mover wallet clustering"]},
{name:"On-Chain Velocity",color:T.or,items:["Buy velocity 1m/5m","Unique buyers in 5 min","Gini coefficient of buys","Dev wallet hold %"]},
{name:"Social Signals",color:T.pu,items:["Twitter/Telegram/Website presence","Name length + ticker length","Description sentiment","Emoji density + type analysis"]}
].map(fw=><div key={fw.name} style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:6,padding:8}}>
<div style={{fontSize:11,fontWeight:800,color:fw.color,marginBottom:4}}>{fw.name}</div>
{fw.items.map(it=><div key={it} style={{fontSize:10,color:T.dm,padding:"1px 0",display:"flex",alignItems:"center",gap:3}}><span style={{width:3,height:3,borderRadius:"50%",background:fw.color+"44",flexShrink:0}}/>{it}</div>)}
</div>)}
</div>
<div style={{display:"grid",gridTemplateColumns:mb?"1fr 1fr":"repeat(5,1fr)",gap:3,marginBottom:6}}>
{[{name:"Rule Engine",st:"active",c:T.gn},{name:"RAG Memory",st:"active",c:T.gn},{name:"Online ML",st:"active",c:T.yl},{name:"Behavioral AI",st:"active",c:"#ff9800"},{name:"Nightly LoRA",st:"planned",c:T.ft}
].map(l=><div key={l.name} style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:6,padding:"6px 8px",display:"flex",alignItems:"center",gap:4}}>
<span style={{width:4,height:4,borderRadius:"50%",background:l.c,flexShrink:0}}/>
<span style={{fontSize:10,fontWeight:700,color:l.c,flex:1}}>{l.name}</span>
<span style={{fontSize:8,color:l.c,fontWeight:700}}>{l.st}</span>
</div>)}
</div>
</>}

{/* Live ML Behavior — Pro/VIP only */}
{(user?.tier==="pro"||user?.tier==="vip"||user?.whitelisted)&&intelData?.scorer?.topFeatures?.length>0&&<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?8:12,marginTop:6}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}><IC.sim s={14} c={T.pu}/><span style={{fontSize:11,fontWeight:800}}>Model Behavior</span><span style={{fontSize:7,color:T.dm}}>live feature weights</span></div>
{/* Feature weight bars */}
<div style={{display:"grid",gap:4}}>
{intelData.scorer.topFeatures.slice(0,8).map((f,i)=>{const maxW=parseFloat(intelData.scorer.topFeatures[0]?.weight)||2.5;const pct=Math.min(100,Math.round((parseFloat(f.weight)/maxW)*100));const featureNames={oc_buyVelocity5m:"Buy Velocity (5m)",tp_stickiness:"Meme Stickiness",oc_uniqueBuyers5m:"Unique Buyers (5m)",k_herdSignal:"Herd Signal",tp_lawOfFew:"Law of Few",k_cognitiveEase:"Name Ease",oc_volumeSol5m:"Volume SOL (5m)",so_hasTwitter:"Has Twitter",ch_healthScore:"Chart Health",ch_pumpDump:"Pump & Dump",rg_devSellSpeed:"Dev Sell Speed",rg_mcapDropRate:"MC Drop Rate",rg_buyerRetention:"Buyer Retention",k_anchoring:"Anchoring Bias",k_availability:"Availability Heuristic",k_lossAversion:"Loss Aversion (2x)",k_peakEnd:"Peak-End Rule",k_prospectTheory:"Prospect Theory",gl_thinSlice:"Thin-Slice (30s)",gl_outlier:"Outlier Detection",gl_10kMaturity:"Pattern Maturity",gl_accumAdvantage:"Early Mover Cluster",tp_context:"Power of Context"};return<div key={f.feature} style={{display:"flex",alignItems:"center",gap:6}}>
<span style={{fontSize:7,color:T.dm,minWidth:90,textAlign:"right"}}>{featureNames[f.feature]||f.feature}</span>
<div style={{flex:1,height:6,borderRadius:3,background:T.bg,overflow:"hidden"}}><div style={{width:pct+"%",height:"100%",borderRadius:3,background:`linear-gradient(90deg,${T.pu},${T.gn})`,transition:"width 1s"}}/></div>
<span style={{fontSize:7,color:T.tx,fontWeight:700,minWidth:25}}>{f.weight}</span>
</div>})}
</div>
{/* Scoring distribution */}
{(user?.tier==="pro"||user?.whitelisted)&&intelData.recentEvents?.length>0&&<div style={{marginTop:10,borderTop:"1px solid "+T.bd,paddingTop:8}}>
<div style={{fontSize:8,fontWeight:700,color:T.dm,marginBottom:6}}>Score Distribution</div>
<div style={{display:"flex",alignItems:"flex-end",gap:1,height:40}}>
{[0,10,20,30,40,50,60,70,80,90].map(bucket=>{const count=intelData.recentEvents.filter(e=>e.data?.score>=bucket&&e.data?.score<bucket+10).length;const h=count>0?Math.max(4,Math.round((count/Math.max(1,intelData.recentEvents.length))*40)):0;return<div key={bucket} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
<div style={{width:"100%",height:h,borderRadius:2,background:bucket>=50?T.gn+"66":bucket>=25?T.yl+"66":T.ft+"44"}}/>
<span style={{fontSize:5,color:T.ft}}>{bucket}</span>
</div>})}
</div></div>}
</div>}

{/* Auto-Ape Settings */}
{user?.pubkey&&!user.demo&&trW&&(()=>{
const aaOpen=autoTrade?.open||autoTrade?.active;
const aaActive=autoTrade?.active;
const S=autoTrade?.settings||{minScore:25,solPerTrade:0.05,maxPositions:3,tp1:35,tp1Sell:50,tp2:80,tp2Sell:30,tp3:150,tp3Sell:50,sl1:15,sl1Sell:60,sl2:30,momentumExit:true};
const adj=(k,step,mn,mx)=>{const cur=S[k]??0;const nv=Math.max(mn,Math.min(mx,+(cur+step).toFixed(4)));sAutoTrade(p=>({...p,settings:{...p.settings,[k]:nv}}))};
/* Auto-balance TP sell %s to always total 100%.
   When one changes, the others shrink/grow proportionally.
   Keys: tp1Sell, tp2Sell, tp3Sell — each is the % of TOTAL position to sell at that tier. */
const adjTP=(k,step)=>{
  const keys=["tp1Sell","tp2Sell","tp3Sell"];
  const others=keys.filter(x=>x!==k);
  const cur=S[k]||0;
  const nv=Math.max(5,Math.min(90,cur+step));
  const remaining=100-nv;
  const otherSum=(S[others[0]]||0)+(S[others[1]]||0);
  const r0=otherSum>0?Math.round(remaining*(S[others[0]]||0)/otherSum):Math.round(remaining/2);
  const r1=remaining-r0;
  sAutoTrade(p=>({...p,settings:{...p.settings,[k]:nv,[others[0]]:Math.max(5,r0),[others[1]]:Math.max(5,r1)}}));
};
/* Auto-balance SL: sl1Sell is partial, remainder is implied for SL2 (always 100%) */
const adjSL=(step)=>{
  const nv=Math.max(10,Math.min(90,+(S.sl1Sell||50)+step));
  sAutoTrade(p=>({...p,settings:{...p.settings,sl1Sell:nv}}));
};
const StepBtn=({k,step,mn,mx,c,fmt,onAdj})=>{const v=S[k]??0;return<div style={{display:"flex",alignItems:"center",gap:0,background:T.bg,borderRadius:6,overflow:"hidden",border:"1px solid "+(c||T.bd)+"22"}}>
<button onClick={()=>onAdj?onAdj(-Math.abs(step)):adj(k,-Math.abs(step),mn,mx)} style={{padding:mb?"10px 12px":"6px 10px",background:"none",border:"none",color:c||T.ft,fontSize:mb?18:14,fontWeight:800,cursor:"pointer",lineHeight:1}}>-</button>
<div style={{flex:1,textAlign:"center",fontSize:mb?15:13,fontWeight:800,color:c||T.tx,padding:"4px 0",minWidth:mb?44:36}}>{fmt?fmt(v):v}</div>
<button onClick={()=>onAdj?onAdj(Math.abs(step)):adj(k,Math.abs(step),mn,mx)} style={{padding:mb?"10px 12px":"6px 10px",background:"none",border:"none",color:c||T.ft,fontSize:mb?18:14,fontWeight:800,cursor:"pointer",lineHeight:1}}>+</button>
</div>};
const tpTotal=(S.tp1Sell||0)+(S.tp2Sell||0)+(S.tp3Sell||0);
return<div style={{background:T.sf,border:"1px solid "+(aaActive?T.gn:T.bd),borderRadius:10,padding:mb?10:16,marginTop:6,overflow:"hidden"}}>
{/* Header + buttons */}
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:aaOpen?8:0,flexWrap:"wrap",gap:4}}>
<div style={{display:"flex",alignItems:"center",gap:6}}><IC.trend s={16} c={aaActive?T.gn:T.ft}/><span style={{fontSize:15,fontWeight:800}}>Auto-Ape</span>{aaActive&&<span style={{width:6,height:6,borderRadius:"50%",background:T.gn,animation:"gp 2s infinite"}}/>}</div>
<div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
{/* OPEN: expand panel to configure */}
{!aaOpen&&<button onClick={()=>sAutoTrade(p=>({...p,open:true,settings:p?.settings||S}))} style={{padding:mb?"8px 16px":"6px 14px",borderRadius:6,border:"1px solid "+T.bd,background:T.bg,color:T.tx,fontWeight:800,fontSize:mb?13:12,cursor:"pointer"}}>OPEN</button>}
{/* START: begin auto-trading */}
{aaOpen&&!aaActive&&<button onClick={async()=>{try{const r=await a.ats(user.pubkey,S);sAutoTrade({open:true,active:true,settings:r.settings,positions:[],log:[]});toast("Auto-ape started","success")}catch(e){toast(e.message,"error")}}} style={{padding:mb?"7px 12px":"6px 14px",borderRadius:6,border:"none",background:T.gn,color:"#fff",fontWeight:800,fontSize:mb?12:12,cursor:"pointer"}}>START</button>}
{/* PAUSE: stop buying, keep monitoring */}
{aaActive&&<button onClick={async()=>{try{await a.atp(user.pubkey);sAutoTrade(p=>({...p,active:false,open:true}));toast("Paused — positions still monitored","success")}catch(e){toast(e.message,"error")}}} style={{padding:mb?"7px 12px":"6px 14px",borderRadius:6,border:"none",background:T.yl,color:"#000",fontWeight:800,fontSize:mb?12:12,cursor:"pointer"}}>PAUSE</button>}
{/* CLOSE ALL: sell everything, stop */}
{aaOpen&&(aaActive||autoTrade?.positions?.length>0)&&<button onClick={async()=>{if(!confirm("Sell ALL positions and stop?"))return;try{const r=await a.atc(user.pubkey);sAutoTrade({open:true,active:false,settings:S,positions:[],log:[]});toast(`Closed ${r.closed||0} positions`,"success")}catch(e){toast(e.message,"error")}}} style={{padding:mb?"7px 10px":"6px 14px",borderRadius:6,border:"none",background:T.rd,color:"#fff",fontWeight:800,fontSize:mb?12:12,cursor:"pointer"}}>CLOSE ALL</button>}
{/* Collapse */}
{aaOpen&&!aaActive&&<button onClick={()=>sAutoTrade(p=>({...p,open:false}))} style={{padding:mb?"8px 10px":"6px 8px",borderRadius:6,border:"1px solid "+T.bd,background:"none",color:T.ft,fontWeight:800,fontSize:mb?13:11,cursor:"pointer"}}>×</button>}
</div>
</div>
{!aaOpen&&<div style={{fontSize:11,color:T.dm,marginTop:4}}>Walk away mode: auto-buys green tokens, sells at 3 TP / 2 SL tiers.</div>}
{/* Expanded panel */}
{aaOpen&&<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr",gap:mb?6:12,width:"100%",boxSizing:"border-box"}}>
<div>{/* LEFT: Config */}
<div style={{fontSize:11,color:T.dm,marginBottom:8}}>Configure targets, then hit START. Uses +/- to adjust.</div>
{/* Core settings */}
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4,marginBottom:8}}>
{[{l:"Min Score",k:"minScore",st:5,mn:15,mx:90},{l:"SOL/Trade",k:"solPerTrade",st:0.01,mn:0.01,mx:1,fmt:v=>v.toFixed(2)},{l:"Max Pos",k:"maxPositions",st:1,mn:1,mx:15}].map(s=><div key={s.k} style={{textAlign:"center"}}><div style={{fontSize:mb?9:8,color:T.ft,fontWeight:700,marginBottom:3}}>{s.l}</div><StepBtn k={s.k} step={s.st} mn={s.mn} mx={s.mx} fmt={s.fmt}/></div>)}
</div>
{/* TP tiers — sell %s auto-balance to 100% */}
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
<div style={{fontSize:mb?10:9,fontWeight:700,color:T.gn}}>Take Profit</div>
<div style={{fontSize:mb?9:8,fontWeight:700,color:tpTotal===100?T.gn:T.yl}}>{tpTotal}% allocated</div>
</div>
{/* Visual allocation bar */}
<div style={{display:"flex",height:mb?8:6,borderRadius:4,overflow:"hidden",marginBottom:6,border:"1px solid "+T.gn+"22"}}>
<div style={{width:(S.tp1Sell||0)+"%",background:T.gn,transition:"width .2s"}}/>
<div style={{width:(S.tp2Sell||0)+"%",background:T.gn+"88",transition:"width .2s"}}/>
<div style={{width:(S.tp3Sell||0)+"%",background:T.gn+"44",transition:"width .2s"}}/>
</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4,marginBottom:8}}>
{[{l:"TP1",k:"tp1",sk:"tp1Sell",st:10,sst:5,desc:"Secure"},{l:"TP2",k:"tp2",sk:"tp2Sell",st:10,sst:5,desc:"Scale out"},{l:"TP3 Runner",k:"tp3",sk:"tp3Sell",st:25,sst:5,desc:"Moonbag"}].map(t=><div key={t.k} style={{background:T.bg,borderRadius:6,padding:mb?8:6,border:"1px solid "+T.gn+"22"}}>
<div style={{fontSize:mb?10:8,color:T.gn,fontWeight:800,marginBottom:4,textAlign:"center"}}>{t.l}</div>
<div style={{fontSize:mb?8:7,color:T.ft,marginBottom:2}}>Trigger</div>
<StepBtn k={t.k} step={t.st} mn={10} mx={1000} c={T.gn} fmt={v=>"+"+v+"%"}/>
<div style={{fontSize:mb?8:7,color:T.ft,marginBottom:2,marginTop:4}}>Sell %</div>
<StepBtn k={t.sk} step={t.sst} mn={5} mx={90} c={T.gn} fmt={v=>v+"%"} onAdj={s=>adjTP(t.sk,s)}/>
<div style={{fontSize:mb?8:7,color:T.dm,textAlign:"center",marginTop:3}}>{t.desc}</div>
</div>)}
</div>
{/* SL tiers */}
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
<div style={{fontSize:mb?10:9,fontWeight:700,color:T.rd}}>Stop Loss</div>
<div style={{fontSize:mb?9:8,color:T.dm}}>SL1: {S.sl1Sell||50}% → SL2: 100% exit</div>
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginBottom:8}}>
<div style={{background:T.bg,borderRadius:6,padding:mb?8:6,border:"1px solid "+T.rd+"22"}}>
<div style={{fontSize:mb?10:8,color:T.rd,fontWeight:800,marginBottom:4,textAlign:"center"}}>SL1 Reduce</div>
<div style={{fontSize:mb?8:7,color:T.ft,marginBottom:2}}>Trigger</div>
<StepBtn k="sl1" step={5} mn={5} mx={80} c={T.rd} fmt={v=>"-"+v+"%"}/>
<div style={{fontSize:mb?8:7,color:T.ft,marginBottom:2,marginTop:4}}>Sell %</div>
<StepBtn k="sl1Sell" step={5} mn={10} mx={90} c={T.rd} fmt={v=>v+"%"} onAdj={s=>adjSL(s)}/>
<div style={{fontSize:mb?8:7,color:T.dm,textAlign:"center",marginTop:3}}>Cut {S.sl1Sell||50}%, keep {100-(S.sl1Sell||50)}%</div>
</div>
<div style={{background:T.bg,borderRadius:6,padding:mb?8:6,border:"1px solid "+T.rd+"22"}}>
<div style={{fontSize:mb?10:8,color:T.rd,fontWeight:800,marginBottom:4,textAlign:"center"}}>SL2 Full Exit</div>
<div style={{fontSize:mb?8:7,color:T.ft,marginBottom:2}}>Trigger</div>
<StepBtn k="sl2" step={5} mn={10} mx={90} c={T.rd} fmt={v=>"-"+v+"%"}/>
<div style={{fontSize:mb?8:7,color:T.dm,textAlign:"center",marginTop:6}}>Sells 100% — full bail</div>
</div>
</div>
{/* Momentum exit toggle */}
<div style={{background:T.bg,borderRadius:6,padding:mb?10:8,border:"1px solid "+T.pu+"22",marginBottom:8}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<div>
<div style={{fontSize:mb?11:10,fontWeight:800,color:T.pu}}>Momentum Exit</div>
<div style={{fontSize:mb?9:8,color:T.dm,marginTop:2}}>Auto-tightens stops when token intel score drops. Sells faster on fading momentum.</div>
</div>
<button onClick={()=>sAutoTrade(p=>({...p,settings:{...p.settings,momentumExit:!S.momentumExit}}))} style={{padding:mb?"8px 14px":"6px 12px",borderRadius:6,border:"1px solid "+(S.momentumExit?T.pu:T.bd),background:S.momentumExit?T.pu+"22":"none",color:S.momentumExit?T.pu:T.ft,fontWeight:800,fontSize:mb?12:11,cursor:"pointer",whiteSpace:"nowrap"}}>{S.momentumExit?"ON":"OFF"}</button>
</div>
{S.momentumExit&&<div style={{fontSize:mb?8:7,color:T.dm,marginTop:4,lineHeight:1.5}}>Score drops 20+pts → SL tightens 50% • Score drops 30+pts → immediate sell • Re-scores every 15s from live radar data</div>}
</div>
{/* APPLY button when settings changed while active */}
{aaActive&&<button onClick={async()=>{try{await a.atu(user.pubkey,S);sAutoTrade(p=>({...p,log:[...(p?.log||[]),{msg:"Settings applied",time:Date.now()}]}));toast("Settings applied","success")}catch(e){toast(e.message,"error")}}} style={{width:"100%",padding:mb?"10px 0":"7px 0",borderRadius:6,border:"none",background:T.gn+"18",color:T.gn,fontWeight:800,fontSize:mb?13:11,cursor:"pointer",marginBottom:4}}>APPLY CHANGES</button>}
{/* ═══ POSITION ANALYTICS — live score+price charts ═══ */}
<PositionAnalytics positions={autoTrade?.positions||[]} settings={S} T={T} mb={mb}/>
</div>{/* END LEFT */}

{/* RIGHT: Live Positions + Log + Chart Patterns */}
<div style={{display:"flex",flexDirection:"column",gap:6}}>
{/* Live Positions */}
<div style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:8,padding:10,minHeight:mb?0:180}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
<div style={{display:"flex",alignItems:"center",gap:4}}>
<span style={{fontSize:12,fontWeight:800}}>Positions</span>
{autoTrade?.positions?.length>0&&<span style={{fontSize:10,fontWeight:800,color:T.gn,background:T.gn+"18",padding:"1px 6px",borderRadius:4}}>{autoTrade.positions.length}</span>}
</div>
{aaActive&&<span style={{width:5,height:5,borderRadius:"50%",background:T.gn,animation:"gp 2s infinite"}}/>}
</div>
{(()=>{
const openPos=autoTrade?.positions||[];
const closedPos=autoTrade?.recentlyClosed||[];
const hasAny=openPos.length>0||closedPos.length>0;
return !hasAny?
<div style={{textAlign:"center",padding:mb?"12px 0":"24px 0",color:T.ft}}>
<div style={{fontSize:24,opacity:.2,marginBottom:4}}>◎</div>
<div style={{fontSize:11}}>{aaActive?"Scanning for entries...":"Start Auto-Ape to open positions"}</div>
</div>
:<>
{/* Open positions */}
{openPos.map(p=>{
const pnlColor=p.changePct>=0?T.gn:T.rd;
const pnlSol=p.entrySol>0?(p.entrySol*(p.changePct/100)):0;
const currentVal=p.entrySol>0?(p.entrySol+pnlSol):0;
return<div key={p.ca} style={{padding:"6px 0",borderBottom:"1px solid "+T.bd+"44"}}>
<div style={{display:"flex",alignItems:"center",gap:4,marginBottom:3}}>
<span style={{fontSize:12,fontWeight:800,color:T.tx,flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{p.name}</span>
<div style={{display:"flex",flexDirection:"column",alignItems:"flex-end"}}>
<span style={{fontSize:14,fontWeight:900,color:pnlColor}}>{p.changePct>=0?"+":""}{p.changePct}%</span>
{p.entrySol>0&&<span style={{fontSize:10,fontWeight:800,color:pnlColor}}>{pnlSol>=0?"+":""}{pnlSol.toFixed(4)} SOL</span>}
</div>
<button title="Exit this position" onClick={async(e)=>{e.stopPropagation();if(!confirm(`Sell ${p.name} now?`))return;try{const r=await a.atx(user.pubkey,p.ca);toast(`Exited ${p.name} (${r.pnlPct>=0?"+":""}${r.pnlPct}%)`,"success")}catch(err){toast(err.message,"error")}}} style={{padding:mb?"6px 8px":"4px 6px",borderRadius:4,border:"1px solid "+T.rd+"44",background:T.rd+"18",color:T.rd,fontWeight:900,fontSize:mb?11:9,cursor:"pointer",lineHeight:1,flexShrink:0}}>EXIT</button>
</div>
{p.entrySol>0&&<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,padding:"3px 6px",background:pnlColor+"0a",borderRadius:4,border:"1px solid "+pnlColor+"18"}}>
<div style={{flex:1,display:"flex",justifyContent:"space-between",fontSize:9,color:T.ft}}>
<span>In: {p.entrySol.toFixed(3)}</span>
<span style={{color:T.tx,fontWeight:700}}>Now: {currentVal.toFixed(3)}</span>
<span style={{color:pnlColor,fontWeight:800}}>P&L: {pnlSol>=0?"+":""}{pnlSol.toFixed(4)}</span>
</div>
</div>}
<div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
<span style={{fontSize:9,color:T.ft}}>${fm(p.currentMcap)} MC</span>
<span style={{fontSize:9,color:T.ft}}>{p.age}m</span>
{p.isMoonbag&&<span style={{fontSize:7,fontWeight:800,padding:"1px 4px",borderRadius:3,background:T.yl+"22",color:T.yl}}>MOONBAG</span>}
{p.tpHit>0&&<span style={{fontSize:7,fontWeight:800,padding:"1px 4px",borderRadius:3,background:T.gn+"22",color:T.gn}}>TP{p.tpHit}</span>}
{p.slHit>0&&<span style={{fontSize:7,fontWeight:800,padding:"1px 4px",borderRadius:3,background:T.rd+"22",color:T.rd}}>SL{p.slHit}</span>}
{p.liveScore!=null&&<span style={{fontSize:7,fontWeight:800,padding:"1px 4px",borderRadius:3,background:(p.scoreDelta>=0?T.gn:T.rd)+"18",color:p.scoreDelta>=0?T.gn:T.rd}}>Score {p.liveScore}{p.scoreDelta!==0&&" ("+(p.scoreDelta>0?"+":"")+p.scoreDelta+")"}</span>}
{p.scoreTrend&&p.scoreTrend!=="stable"&&<span style={{fontSize:7,fontWeight:800,color:p.scoreTrend==="rising"?T.gn:T.rd}}>{p.scoreTrend==="rising"?"↑":"↓"}</span>}
</div>
</div>})}
{/* Recently closed positions */}
{closedPos.length>0&&<>
<div style={{fontSize:9,fontWeight:700,color:T.ft,padding:"6px 0 3px",borderBottom:"1px solid "+T.bd+"22"}}>RECENTLY CLOSED</div>
{closedPos.slice().reverse().map(p=>{
const pnlColor=p.changePct>=0?T.gn:T.rd;
const ago=Math.round((Date.now()-p.exitTime)/60000);
return<div key={p.ca+p.exitTime} style={{padding:"5px 0",borderBottom:"1px solid "+T.bd+"22",opacity:.7}}>
<div style={{display:"flex",alignItems:"center",gap:4,marginBottom:2}}>
<span style={{fontSize:11,fontWeight:700,color:T.dm,flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{p.name}</span>
<span style={{fontSize:12,fontWeight:900,color:pnlColor}}>{p.changePct>=0?"+":""}{p.changePct}%</span>
<span style={{fontSize:9,fontWeight:800,color:pnlColor}}>{p.pnlSol>=0?"+":""}{p.pnlSol} SOL</span>
</div>
<div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
<span style={{fontSize:8,color:T.ft}}>In: {p.entrySol?.toFixed(3)||"?"} SOL</span>
<span style={{fontSize:8,color:T.ft}}>Score: {p.entryScore}→{p.exitScore}</span>
<span style={{fontSize:7,fontWeight:800,padding:"1px 4px",borderRadius:3,background:T.rd+"18",color:T.rd}}>{p.exitReason?.replace(/-/g," ").toUpperCase()}</span>
<span style={{fontSize:8,color:T.ft}}>{ago}m ago</span>
</div>
</div>})}
</>}
</>})()}
</div>

{/* Log */}
<div style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:8,padding:10}}>
<div style={{fontSize:11,fontWeight:700,color:T.ft,marginBottom:4}}>Activity Log</div>
{autoTrade?.log?.length>0?
<div style={{maxHeight:mb?100:200,overflowY:"auto",fontSize:10,color:T.dm,lineHeight:1.6,fontFamily:M}}>
{autoTrade.log.slice().reverse().map((l,i)=><div key={i} style={{padding:"1px 0",borderBottom:i<autoTrade.log.length-1?"1px solid "+T.bd+"22":"none"}}>
<span style={{color:T.ft}}>{new Date(l.time).toLocaleTimeString()}</span>{" "}
<span style={{color:l.msg?.includes("BOUGHT")||l.msg?.includes("APE")?T.gn:l.msg?.includes("SELL")||l.msg?.includes("EXIT")?T.rd:T.dm}}>{l.msg}</span>
</div>)}
</div>
:<div style={{fontSize:10,color:T.ft,textAlign:"center",padding:"8px 0"}}>No activity yet</div>}
</div>

{/* Scan Pipeline — shows decision funnel + near misses */}
{autoTrade?.pipeline&&<div style={{background:T.bg,border:"1px solid "+T.cy+"18",borderRadius:8,padding:10}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
<span style={{fontSize:11,fontWeight:800,color:T.cy}}>Scan Pipeline</span>
<span style={{fontSize:8,color:T.ft}}>cycle #{autoTrade.pipeline.cycles}</span>
</div>
{autoTrade.pipeline.last&&(()=>{const p=autoTrade.pipeline.last;return<>
<div style={{display:"flex",gap:3,alignItems:"center",flexWrap:"wrap",marginBottom:6}}>
<span style={{fontSize:9,padding:"2px 5px",borderRadius:3,background:T.ft+"22",color:T.dm}}>{p.total} tokens</span>
<span style={{fontSize:10,color:T.ft}}>→</span>
<span style={{fontSize:9,padding:"2px 5px",borderRadius:3,background:p.total-p.baseFilter>0?T.gn+"22":T.rd+"22",color:p.total-p.baseFilter>0?T.gn:T.rd}}>{p.total-p.baseFilter} base</span>
<span style={{fontSize:10,color:T.ft}}>→</span>
<span style={{fontSize:9,padding:"2px 5px",borderRadius:3,background:T.yl+"22",color:T.yl}}>{p.total-p.baseFilter-p.alreadyOwned-p.cooldown} new</span>
<span style={{fontSize:10,color:T.ft}}>→</span>
<span style={{fontSize:9,padding:"2px 5px",borderRadius:3,background:T.pu+"22",color:T.pu}}>{p.total-p.baseFilter-p.alreadyOwned-p.cooldown-p.rugGate} safe</span>
<span style={{fontSize:10,color:T.ft}}>→</span>
<span style={{fontSize:9,padding:"2px 5px",borderRadius:3,background:p.passed>0?T.gn+"33":T.rd+"22",color:p.passed>0?T.gn:T.rd,fontWeight:p.passed>0?800:400}}>{p.passed} READY</span>
</div>
<div style={{display:"flex",gap:6,flexWrap:"wrap",fontSize:8,color:T.ft}}>
{p.baseFilter>0&&<span>Base filter: -{p.baseFilter}</span>}
{p.alreadyOwned>0&&<span>Owned: -{p.alreadyOwned}</span>}
{p.cooldown>0&&<span>Cooldown: -{p.cooldown}</span>}
{p.rugGate>0&&<span>Rug gate: -{p.rugGate}</span>}
{p.trendReject>0&&<span>Trend: -{p.trendReject}</span>}
{p.scoreLow>0&&<span>Score low: -{p.scoreLow}</span>}
</div>
</>})()}

{autoTrade.pipeline.nearMisses?.length>0&&<>
<div style={{fontSize:9,fontWeight:700,color:T.yl,padding:"6px 0 3px",borderBottom:"1px solid "+T.bd+"22"}}>NEAR MISSES (almost qualified)</div>
{autoTrade.pipeline.nearMisses.slice().reverse().map(nm=><div key={nm.ca} style={{padding:"4px 0",borderBottom:"1px solid "+T.bd+"11",display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
<span style={{fontSize:10,fontWeight:700,color:T.dm}}>{nm.name}</span>
<span style={{fontSize:11,fontWeight:900,color:T.yl}}>{nm.score}<span style={{fontSize:8,fontWeight:400,color:T.ft}}>/{nm.needed}</span></span>
<span style={{fontSize:8,color:T.ft}}>MC:${nm.mc?.toLocaleString()}</span>
<span style={{fontSize:8,color:T.ft}}>B:{nm.buys} S:{nm.sells}</span>
{nm.trend&&nm.trend!=="new"&&<span style={{fontSize:7,fontWeight:800,padding:"1px 4px",borderRadius:3,background:nm.trend==="rocket"?T.gn+"22":nm.trend==="rising"?T.cy+"22":T.ft+"22",color:nm.trend==="rocket"?T.gn:nm.trend==="rising"?T.cy:T.ft}}>{nm.trend}</span>}
{nm.flags?.length>0&&<span style={{fontSize:7,color:T.rd}}>{nm.flags.join(",")}</span>}
</div>)}
</>}
</div>}

{/* Trade Learner Insights */}
{autoTrade?.learner&&<div style={{background:T.bg,border:"1px solid "+T.pu+"18",borderRadius:8,padding:10}}>
<div style={{fontSize:11,fontWeight:800,color:T.pu,marginBottom:6}}>Trade Learner</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,marginBottom:6}}>
<div style={{textAlign:"center"}}><div style={{fontSize:14,fontWeight:900,color:T.pu}}>{autoTrade.learner.totalTrades}</div><div style={{fontSize:8,color:T.ft}}>TRADES</div></div>
<div style={{textAlign:"center"}}><div style={{fontSize:14,fontWeight:900,color:autoTrade.learner.winRate>=50?T.gn:T.rd}}>{autoTrade.learner.winRate}%</div><div style={{fontSize:8,color:T.ft}}>WIN RATE</div></div>
<div style={{textAlign:"center"}}><div style={{fontSize:14,fontWeight:900,color:T.gn}}>+{autoTrade.learner.avgWin}%</div><div style={{fontSize:8,color:T.ft}}>AVG WIN</div></div>
<div style={{textAlign:"center"}}><div style={{fontSize:14,fontWeight:900,color:T.rd}}>{autoTrade.learner.avgLoss}%</div><div style={{fontSize:8,color:T.ft}}>AVG LOSS</div></div>
</div>
<div style={{display:"flex",gap:6,flexWrap:"wrap",fontSize:8,color:T.ft}}>
<span>Best score: {autoTrade.learner.bestScoreBucket}+ ({autoTrade.learner.bestScoreAvgPnl>0?"+":""}{autoTrade.learner.bestScoreAvgPnl}%)</span>
<span>Win hold: {autoTrade.learner.avgHoldWin}m</span>
<span>Loss hold: {autoTrade.learner.avgHoldLoss}m</span>
</div>
{autoTrade.learnerAdjustments&&Object.keys(autoTrade.learnerAdjustments).length>0&&<div style={{marginTop:4,fontSize:8,color:T.yl}}>
Active: {autoTrade.learnerAdjustments.holdBias==="patient"?"Patient mode":""}
{autoTrade.learnerAdjustments.tpMultiplier?" TP×"+autoTrade.learnerAdjustments.tpMultiplier:""}
{autoTrade.learnerAdjustments.slMultiplier?" SL×"+autoTrade.learnerAdjustments.slMultiplier:""}
{autoTrade.learnerAdjustments.minScoreShift?" MinScore→"+autoTrade.learnerAdjustments.minScoreShift:""}
</div>}
</div>}

{/* Graduated Chart Patterns — live data from stored snapshots */}
<div style={{background:T.bg,border:"1px solid "+T.yl+"18",borderRadius:8,padding:10}}>
<div style={{display:"flex",alignItems:"center",gap:4,marginBottom:6}}>
<span style={{fontSize:11,fontWeight:800,color:T.yl}}>Chart Patterns</span>
<span style={{fontSize:9,color:T.ft}}>{chartPatterns?.total||0} stored</span>
</div>
{/* Pattern type breakdown */}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3,marginBottom:6}}>
{[{k:"healthy_pump",l:"Healthy",c:T.gn},{k:"sniper_spike",l:"Spike",c:T.yl},{k:"slow_grind",l:"Grind",c:T.pu},{k:"rug",l:"Rug",c:T.rd}].map(p=>{
const stats=chartPatterns?.patterns?.[p.k];
return<div key={p.k} style={{padding:"4px 6px",borderRadius:4,border:"1px solid "+p.c+"22",background:p.c+"06"}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<span style={{fontSize:9,fontWeight:800,color:p.c}}>{p.l}</span>
<span style={{fontSize:10,fontWeight:900,color:p.c}}>{stats?.count||0}</span>
</div>
{stats&&<div style={{fontSize:7,color:T.dm}}>{stats.avgPeakMcx}x peak · {stats.avgAge}m avg</div>}
</div>})}
</div>
{/* Recent graduated charts with mini sparklines */}
{chartPatterns?.recentCharts?.length>0&&<div style={{display:"flex",flexDirection:"column",gap:2}}>
{chartPatterns.recentCharts.slice(0,6).map((c,i)=>{
const pColor=c.pattern==="rug"?T.rd:c.pattern==="healthy_pump"?T.gn:c.pattern==="sniper_spike"?T.yl:T.pu;
return<div key={i} style={{display:"flex",alignItems:"center",gap:4,padding:"2px 0",borderBottom:"1px solid "+T.bd+"33"}}>
<span style={{fontSize:9,fontWeight:700,color:T.tx,flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{c.name||c.ticker||"?"}</span>
<span style={{fontSize:7,fontWeight:800,color:pColor,padding:"1px 3px",borderRadius:2,background:pColor+"18"}}>{c.pattern?.replace("_"," ")}</span>
<span style={{fontSize:8,color:T.ft}}>{c.peakMcx?.toFixed(1)}x</span>
{/* Mini sparkline */}
{c.spark?.length>3&&<svg width={40} height={14} style={{flexShrink:0}}>
{(()=>{const s=c.spark;const mn=Math.min(...s);const mx=Math.max(...s);const rng=mx-mn||1;const pts=s.map((v,j)=>`${(j/(s.length-1))*40},${14-((v-mn)/rng)*12}`).join(" ");return<polyline points={pts} fill="none" stroke={pColor} strokeWidth={1.2}/>})()}
</svg>}
</div>})}
</div>}
{(!chartPatterns||chartPatterns.total===0)&&<div style={{fontSize:9,color:T.ft,textAlign:"center",padding:"6px 0"}}>Charts stored as tokens graduate</div>}
</div>
</div>{/* END RIGHT */}
</div>}
</div>})()}

{/* Tier features */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?8:12,marginTop:6}}>
<div style={{fontSize:13,fontWeight:800,marginBottom:6}}>Intel Access by Tier</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
<div style={{padding:8,background:T.bg,borderRadius:6,border:"1px solid "+T.gn+"18"}}>
<div style={{fontSize:13,fontWeight:800,color:T.gn,marginBottom:4}}>Free</div>
<div style={{fontSize:11,color:T.dm,lineHeight:1.4}}>• View radar scores{"\n"}• Sparkline charts{"\n"}• Token scoring{"\n"}• Basic analytics</div>
</div>
<div style={{padding:8,background:T.bg,borderRadius:6,border:"1px solid "+T.pu+"18"}}>
<div style={{fontSize:13,fontWeight:800,color:T.pu,marginBottom:4}}>Pro</div>
<div style={{fontSize:11,color:T.dm,lineHeight:1.4}}>• All Free features{"\n"}• Click-to-ape scored tokens{"\n"}• Import unlimited wallets{"\n"}• Fleet wallet selection{"\n"}• Feature weight insights</div>
</div>
<div style={{padding:8,background:T.bg,borderRadius:6,border:"1px solid "+T.yl+"18"}}>
<div style={{fontSize:13,fontWeight:800,color:T.yl,marginBottom:4}}>VIP</div>
<div style={{fontSize:11,color:T.dm,lineHeight:1.4}}>• All Pro features{"\n"}• Admin panel{"\n"}• API access{"\n"}• Custom scoring rules{"\n"}• Priority fleet execution</div>
</div>
</div>
</div>

{/* Admin panel — owner only */}
{isOwner&&<div style={{background:T.sf,border:"1px solid "+T.yl+"18",borderRadius:10,padding:mb?8:12,marginTop:6}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><IC.crown s={14} c={T.yl}/><span style={{fontSize:12,fontWeight:800,color:T.yl}}>Admin Panel</span></div>
<div style={{fontSize:8,color:T.dm,marginBottom:8}}>Platform owner tools. Visible only to whitelisted wallets.</div>
<div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
<button onClick={async()=>{try{const r=await fetch(API+"/api/admin/stats",{headers:{"x-admin-secret":"bondli_default"}});const d=await r.json();if(d.ok)toast(`Users: ${d.totalUsers} | Active: ${d.activeUsers} | Free: ${d.tiers?.free} Pro: ${d.tiers?.pro} VIP: ${d.tiers?.vip} | Sessions: ${d.activeSessions}`,"success");else toast(d.error||"Failed","error")}catch(e){toast(e.message,"error")}}} style={{padding:"6px 12px",background:T.yl+"08",border:"1px solid "+T.yl+"18",borderRadius:6,fontSize:9,fontWeight:700,color:T.yl,cursor:"pointer"}}>Platform Stats</button>
<button onClick={async()=>{try{const r=await fetch(API+"/api/admin/users",{headers:{"x-admin-secret":"bondli_default"}});const d=await r.json();toast(`${d.users?.length||0} users loaded`,"success")}catch(e){toast(e.message,"error")}}} style={{padding:"6px 12px",background:T.pu+"08",border:"1px solid "+T.pu+"18",borderRadius:6,fontSize:9,fontWeight:700,color:T.pu,cursor:"pointer"}}>User List</button>
<button onClick={async()=>{try{const r=await fetch(API+"/api/sol-price");const d=await r.json();toast(`SOL: $${d.price?.toFixed(2)||"??"}`,"success")}catch(e){toast("Add /api/sol-price route","error")}}} style={{padding:"6px 12px",background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:6,fontSize:9,fontWeight:700,color:T.gn,cursor:"pointer"}}>SOL Price</button>
</div></div>}
</div></EB>}
</div></>}

{showKeys&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:10,animation:"fi .1s ease"}} onClick={()=>sShowKeys(false)}><div onClick={e=>e.stopPropagation()} style={{background:T.sf,border:"1px solid "+T.gn+"18",borderRadius:14,padding:18,maxWidth:440,width:"100%",maxHeight:"85vh",overflowY:"auto",animation:"si .15s ease"}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}><span style={{fontWeight:800,fontSize:16}}>Settings</span><button onClick={()=>sShowKeys(false)} style={{background:"none",border:"none",color:T.ft,fontSize:16,cursor:"pointer"}}>×</button></div>
{/* Primary trading wallet */}
{trW&&<div style={{marginBottom:10}}><div style={{fontSize:8,fontWeight:700,color:T.ft,textTransform:"uppercase",marginBottom:3}}>Trading Wallet</div><div onClick={()=>{navigator.clipboard?.writeText(trW);toast("Address copied (public key)","success")}} style={{padding:"7px 9px",background:T.bg,border:"1px solid "+T.bd,borderRadius:7,fontSize:10,color:T.gn,cursor:"pointer",wordBreak:"break-all",display:"flex",alignItems:"center",gap:4}}><IC.sol s={12}/>{trW}</div><div style={{display:"flex",gap:3,marginTop:5}}><button onClick={async()=>{try{const r=await a.etw(user.pubkey);if(r.ok&&r.privateKey){try{await navigator.clipboard.writeText(r.privateKey);toast("Private key copied — clears 60s","success")}catch{prompt("Copy your private key:",r.privateKey);toast("Private key shown above","success")}setTimeout(()=>{try{navigator.clipboard.writeText("")}catch{}},60000)}}catch(e){toast(e.message,"error")}}} style={{flex:1,padding:mb?"8px 0":"5px 0",background:T.yl+"08",border:"1px solid "+T.yl+"18",borderRadius:5,fontSize:mb?11:9,fontWeight:700,color:T.yl,cursor:"pointer"}}>Export Private Key</button><button onClick={async()=>{try{const r=await a.er(user.pubkey);toast(`${r.totalWallets||0} wallets | ${(r.totalSol||0).toFixed(3)} SOL`,"success")}catch(e){toast(e.message,"error")}}} style={{flex:1,padding:"5px 0",background:T.or+"08",border:"1px solid "+T.or+"18",borderRadius:5,fontSize:9,fontWeight:700,color:T.or,cursor:"pointer"}}>Emergency</button></div></div>}
{/* Import wallet */}
<div style={{marginBottom:10,padding:10,background:T.bg,border:"1px solid "+T.bd,borderRadius:8}}><div style={{fontSize:8,fontWeight:700,color:T.pu,textTransform:"uppercase",marginBottom:6}}>Import Wallet {user?.tier==="free"&&!user?.whitelisted?"(Pro/VIP)":""}</div><div style={{fontSize:8,color:T.dm,marginBottom:6}}>Bring your own aged wallets. Paste a Solana private key (base58).</div><div style={{display:"flex",gap:3}}><input placeholder="Private key (base58)" style={{flex:1,padding:"6px 8px",background:T.sf,border:"1px solid "+T.bd,borderRadius:5,fontSize:10,color:T.tx,fontFamily:M,outline:"none"}} onKeyDown={async e=>{if(e.key!=="Enter")return;const pk=e.target.value.trim();if(!pk)return;try{const r=await fetch(API+"/api/trading-wallet/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet:user.pubkey,privateKey:pk})});const d=await r.json();if(d.ok){toast(`Imported ${d.pubkey?.slice(0,8)}… (${d.balance?.toFixed(3)||0} SOL)`,"success");e.target.value="";if(d.primary&&!trW){sTrW(d.pubkey)}}else toast(d.error||"Failed","error")}catch(err){toast(err.message,"error")}}}/><button onClick={async()=>{const inp=document.querySelector("input[placeholder*='Private key']");const pk=inp?.value?.trim();if(!pk){toast("Paste a private key","error");return}try{const r=await fetch(API+"/api/trading-wallet/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet:user.pubkey,privateKey:pk})});const d=await r.json();if(d.ok){toast(`Imported ${d.pubkey?.slice(0,8)}… (${d.balance?.toFixed(3)||0} SOL)`,"success");inp.value="";if(d.primary&&!trW){sTrW(d.pubkey)}}else toast(d.error||"Failed","error")}catch(err){toast(err.message,"error")}}} style={{padding:"6px 12px",background:T.pu+"08",border:"1px solid "+T.pu+"18",borderRadius:5,fontSize:9,fontWeight:700,color:T.pu,cursor:"pointer",whiteSpace:"nowrap"}}>Import</button></div></div>
{/* SOL price */}
<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,fontSize:9,color:T.ft}}><IC.sol s={14}/> ${solP.toFixed(2)}</div>
</div></div>}

{mb&&!launched&&<div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:15,background:T.bg+"f6",backdropFilter:"blur(10px)",borderTop:"1px solid "+T.bd,display:"flex",paddingBottom:"max(2px,env(safe-area-inset-bottom,2px))"}}>
{[{id:"radar",l:"Radar",ic:IC.radar},{id:"bags",l:"Bags",ic:IC.bags},{id:"deploy",l:"Deploy",ic:IC.deploy},{id:"intel",l:"Intel",ic:IC.sim}].map(t=>{const ac=tab===t.id;return<button key={t.id} onClick={()=>{sTab(t.id);sRExp(null);setTimeout(()=>document.getElementById("tc")?.scrollIntoView({behavior:"smooth",block:"start"}),30)}} style={{flex:1,padding:"8px 0 4px",background:"none",border:"none",display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"pointer"}}><t.ic s={20} c={ac?T.gn:T.ft}/><span style={{fontSize:11,fontWeight:ac?700:400,color:ac?T.gn:T.ft}}>{t.l}</span></button>})}
</div>}
{!mb&&<footer style={{padding:"8px 16px",borderTop:"1px solid "+T.bd,marginTop:12,display:"flex",justifyContent:"space-between",fontSize:12,color:T.ft}}><span>BONDLI v4</span><span>{launched?"ACTIVE":"IDLE"}</span></footer>}
</div></TC.Provider>}
