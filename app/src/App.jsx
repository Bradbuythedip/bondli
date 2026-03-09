import{useState,useEffect,useRef,useCallback,Component}from"react";
import{TC,D,L,css,uT}from"./lib/t.js";
import{M,S,API,WS_URL}from"./lib/c.js";
import{hW,wN,fm,fs,tp,dbp,wc,hp}from"./lib/u.js";
import{useSolPrice}from"./hooks/useSolPrice.js";
import a from"./lib/a.js";
const uM=()=>{const[m,s]=useState(()=>typeof window!=="undefined"&&window.innerWidth<700);useEffect(()=>{const q=window.matchMedia("(max-width:700px)");const h=e=>s(e.matches);q.addEventListener("change",h);s(q.matches);return()=>q.removeEventListener("change",h)},[]);return m};
class EB extends Component{constructor(p){super(p);this.state={e:null}}static getDerivedStateFromError(e){return{e}}render(){if(this.state.e)return<div style={{padding:12,margin:6,borderRadius:8,background:"#ff174406",textAlign:"center"}}><span style={{fontFamily:M,fontSize:11,color:"#ff1744"}}>{this.props.l} error </span><button onClick={()=>this.setState({e:null})} style={{marginLeft:6,padding:"2px 10px",borderRadius:5,background:"none",border:"1px solid #ff174422",color:"#ff1744",fontFamily:M,fontSize:10,cursor:"pointer"}}>retry</button></div>;return this.props.children}}

// ═══ ICONS ═══
const Logo=({s:z=26})=><svg width={z} height={z*1.3} viewBox="0 0 30 42" style={{filter:"drop-shadow(0 1px 4px rgba(200,20,20,.35))"}}><defs><linearGradient id="bl1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff5555"/><stop offset="50%" stopColor="#dd1818"/><stop offset="100%" stopColor="#881010"/></linearGradient><linearGradient id="bl2" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#ff4040" stopOpacity=".95"/><stop offset="100%" stopColor="#771010" stopOpacity=".9"/></linearGradient></defs><path d="M15,2 Q23,2 26,8 L27,20 L27,22 L26,34 Q23,40 15,40 L15,2 Z" fill="url(#bl1)"/><path d="M15,2 Q7,2 4,8 L3,20 L3,22 L4,34 Q7,40 15,40 L15,2 Z" fill="url(#bl2)"/></svg>;
const IC={
radar:({s:z=16,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><circle cx="12" cy="12" r="10" opacity=".2"/><circle cx="12" cy="12" r="6" opacity=".4"/><circle cx="12" cy="12" r="2"/></svg>,
bags:({s:z=16,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 00-8 0v2"/></svg>,
deploy:({s:z=16,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
trend:({s:z=12,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
fire:({s:z=12,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><path d="M12 12c-2-2.67-4-4.33-4-6 0-3.31 3.13-4 4-4s4 .69 4 4c0 1.67-2 3.33-4 6z"/><path d="M8 22c0-4.42 3.58-8 8-8"/></svg>,
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
ph:()=><svg width="16" height="16" viewBox="0 0 128 128" fill="none"><rect width="128" height="128" rx="26" fill="url(#pg)"/><defs><linearGradient id="pg" x1="0" y1="0" x2="128" y2="128"><stop stopColor="#534bb1"/><stop offset="1" stopColor="#551bf9"/></linearGradient></defs><path d="M110.6 64.1c-2.4-11.5-13.4-19.6-24.2-22.6-14.6-4-30.2-1.5-43.2 5.8-8.1 4.5-15.1 11.1-18.5 19.8-4.5 11.5-1.7 25.4 8 33.5 4.5 3.8 10.3 6.2 16.2 6.2 3.6 0 7.1-.7 10.4-2.2 2.4-1.1 4.5-2.7 6.9-3.8 4-1.8 8.5-1.8 12.8-1 4.2.7 8.1 2.6 12.1 4 4.2 1.5 9 2.3 13.2.5 5.6-2.3 9-7.9 8.6-13.8-.2-3.5-.7-6.9-1.3-10.3-.5-2.8-.7-5.6-.7-8.5 0-2.5.2-5.1-.3-7.6z" fill="#fff"/><circle cx="44" cy="68" r="6" fill="#534bb1"/><circle cx="72" cy="68" r="6" fill="#534bb1"/></svg>,
sun:()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
moon:()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
stop:({s:z=12,c="#ff1744"})=><svg width={z} height={z} viewBox="0 0 24 24" fill={c}><rect x="4" y="4" width="16" height="16" rx="2"/></svg>,
sim:({s:z=16,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
sol:({s:z=12})=><svg width={z} height={z} viewBox="0 0 398 312" fill="none"><defs><linearGradient id="sl" x1="360" y1="14" x2="42" y2="298"><stop stopColor="#00FFA3"/><stop offset="1" stopColor="#DC1FFF"/></linearGradient></defs><path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#sl)"/><path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="url(#sl)"/><path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="url(#sl)"/></svg>,
close:({s:z=14,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
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
function B({children,onClick,color,ghost,disabled:dis,small,full,style:sx={}}){const T=uT(),c=color||T.gn,[h,sH]=useState(false);return<button onClick={dis?undefined:()=>{hp([6]);onClick?.()}} onMouseEnter={()=>sH(true)} onMouseLeave={()=>sH(false)} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:5,padding:small?"7px 12px":"11px 20px",borderRadius:8,fontFamily:M,fontSize:small?11:13,fontWeight:700,cursor:dis?"not-allowed":"pointer",opacity:dis?.28:1,width:full?"100%":undefined,WebkitTapHighlightColor:"transparent",border:ghost?"1px solid "+c+"28":"none",background:ghost?(h?c+"0c":"transparent"):(h?c+"dd":c),color:ghost?c:(T.mo==="light"?"#fff":T.bg),transform:h&&!dis?"translateY(-1px)":"none",transition:"all .1s ease",...sx}}>{children}</button>}
function In({value,onChange,placeholder,...p}){const T=uT(),[f,sF]=useState(false);return<input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} onFocus={()=>sF(true)} onBlur={()=>sF(false)} style={{width:"100%",padding:"9px 11px",background:T.bg,border:"1px solid "+(f?T.gn+"33":T.bd),borderRadius:8,color:T.tx,fontFamily:M,fontSize:13,outline:"none",transition:"border-color .12s"}} {...p}/>}
function NI({label,value,onChange,min,max,step:s=1,decimals:d}){const T=uT();return<div style={{background:T.bg,borderRadius:8,border:"1px solid "+T.bd,padding:"7px 8px"}}><div style={{fontSize:8,fontFamily:M,fontWeight:700,color:T.ft,textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>{label}</div><div style={{display:"flex"}}><button onClick={()=>{hp([3]);onChange(Math.max(min,parseFloat((value-s).toFixed(6))))}} style={{width:26,height:26,borderRadius:"5px 0 0 5px",border:"1px solid "+T.bd,background:T.sf,color:T.dm,fontSize:14,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>−</button><div style={{flex:1,height:26,display:"flex",alignItems:"center",justifyContent:"center",background:T.sf,borderTop:"1px solid "+T.bd,borderBottom:"1px solid "+T.bd,fontFamily:M,fontSize:14,fontWeight:800,color:T.gn}}>{d!=null?value.toFixed(d):(s<1?parseFloat(value.toFixed(6)):value)}</div><button onClick={()=>{hp([3]);onChange(Math.min(max,parseFloat((value+s).toFixed(6))))}} style={{width:26,height:26,borderRadius:"0 5px 5px 0",border:"1px solid "+T.bd,background:T.sf,color:T.dm,fontSize:14,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>+</button></div></div>}
function ImgUp({image,onChange,mb}){const T=uT(),ref=useRef(null);const read=f=>{const r=new FileReader();r.onload=()=>onChange(r.result);r.readAsDataURL(f)};return<div onClick={()=>ref.current?.click()} onDrop={e=>{e.preventDefault();if(e.dataTransfer.files[0])read(e.dataTransfer.files[0])}} onDragOver={e=>e.preventDefault()} style={{width:mb?72:100,height:mb?72:100,borderRadius:10,border:"1px dashed "+(image?T.gn+"33":T.bd),background:image?"url("+image+") center/cover":T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,cursor:"pointer",flexShrink:0,position:"relative"}}>{!image&&<><IC.upload s={18} c={T.dm}/><span style={{fontSize:8,color:T.ft,fontFamily:M}}>512x512</span></>}<input ref={ref} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{if(e.target.files?.[0])read(e.target.files[0])}}/></div>}
const tk=s=>s?s.replace(/^\$/,""):s||"";
const solFmt=n=>n<.001?"0":n<1?n.toFixed(3).replace(/0+$/,"").replace(/\.$/,""):n<100?n.toFixed(2):Math.round(n)+"";
// Image proxy: routes external images through backend to avoid OpaqueResponseBlocking + CORS
const imgProxy=u=>!u?"":u.startsWith("data:")?u:(u.includes("ipfs")||u.includes("pump")||u.includes("arweave")||u.includes("nftstorage")||u.includes("storacha")||u.includes("cf-ipfs")||u.includes(".webp")||u.includes("bafkrei"))?API+"/api/img?url="+encodeURIComponent(u):u;
// MC correction: server uses * 170, we recalculate with live price
const fixMc=(t,solPrice)=>{if(t.mcapSol&&solPrice)return Math.round(t.mcapSol*solPrice);if(t.marketCapSol&&solPrice)return Math.round(t.marketCapSol*solPrice);return t.mcapUsd||0};
const PRESETS=[{name:"Scout",sol:.5,snc:1,slip:20,dur:30,jt:.001},{name:"Standard",sol:2,snc:2,slip:25,dur:60,jt:.001},{name:"Swarm",sol:10,snc:3,slip:30,dur:120,jt:.002}];

// ═══ CANDLESTICK CHART — OHLC + volume + crosshair ═══
function CandleChart({ca,T,mb}){const cvRef=useRef(null);const[data,sData]=useState(null);const[hover,sHover]=useState(null);const[loaded,sLoaded]=useState(false);
// Generate synthetic bonding curve OHLC as immediate fallback
const genSynthetic=useCallback(()=>{const pts=[];let p=.000008+Math.random()*.000004;for(let i=0;i<80;i++){const momentum=i<30?.003:i<50?.001:i<65?-.001:-.003;const vol=(Math.random()-.48)*p*.07;const o=p;p=Math.max(.000001,p+p*momentum+vol);const spread=p*.04;const h=Math.max(o,p)+Math.random()*spread;const l=Math.min(o,p)-Math.random()*spread*.8;pts.push({o,h:Math.max(h,o,p),l:Math.max(.000001,Math.min(l,o,p)),c:p,v:1000+Math.random()*8000+(i<30?i*200:0),t:Date.now()-((80-i)*60000)})}return pts},[]);
useEffect(()=>{if(!ca)return;let dead=false;sData(genSynthetic());sLoaded(true);
const go=async()=>{try{const d=await a.gc(ca);if(dead)return;const candles=d.candles||d.data||d.points||(Array.isArray(d)?d:null);if(candles&&candles.length>2){sData(candles.map(c=>({o:c.o||c.open||c.price||0,h:c.h||c.high||c.price||0,l:c.l||c.low||c.price||0,c:c.c||c.close||c.price||0,v:c.v||c.volume||0,t:c.t||c.time||0})))}}catch{}};
setTimeout(go,500);const iv=setInterval(go,12000);return()=>{dead=true;clearInterval(iv)}},[ca,genSynthetic]);
useEffect(()=>{const cv=cvRef.current;if(!cv||!data||data.length<2)return;
const ctx=cv.getContext("2d");const dpr=window.devicePixelRatio||2;const rect=cv.getBoundingClientRect();const W=rect.width*dpr;const H=rect.height*dpr;cv.width=W;cv.height=H;ctx.clearRect(0,0,W,H);
const cH=H*.7;const vH=H*.17;const gap=H*.04;const candles=data.slice(-80);const n=candles.length;const bw=Math.max(3,(W-24)/n-1);const mn=Math.min(...candles.map(c=>c.l));const mx=Math.max(...candles.map(c=>c.h));const rng=mx-mn||.0001;const maxV=Math.max(...candles.map(c=>c.v||0))||1;
// Grid + price labels
ctx.strokeStyle=T.bd;ctx.lineWidth=.5;for(let i=0;i<5;i++){const y=10+cH*(i/4);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();const pr=mx-rng*(i/4);ctx.fillStyle=T.ft;ctx.font=`${Math.round(5*dpr)}px monospace`;ctx.fillText(pr<.0001?pr.toExponential(1):pr<.01?pr.toFixed(6):pr<1?pr.toFixed(4):pr.toFixed(2),4,y-3)}
// Candles
candles.forEach((c,i)=>{const x=12+(i/n)*(W-24);const isG=c.c>=c.o;const col=isG?"#00e676":"#ff1744";
const hy=10+((mx-c.h)/rng)*cH;const ly=10+((mx-c.l)/rng)*cH;
ctx.strokeStyle=col+"aa";ctx.lineWidth=Math.max(1,dpr*.5);ctx.beginPath();ctx.moveTo(x+bw/2,hy);ctx.lineTo(x+bw/2,ly);ctx.stroke();
const oy=10+((mx-c.o)/rng)*cH;const cy=10+((mx-c.c)/rng)*cH;ctx.fillStyle=isG?col:col+"88";ctx.fillRect(x,Math.min(oy,cy),bw,Math.max(dpr,Math.abs(cy-oy)));
const vh=(c.v/maxV)*vH;ctx.fillStyle=isG?"#00e67628":"#ff174428";ctx.fillRect(x,cH+gap+(vH-vh),bw,vh)});
// Crosshair
if(hover!=null&&hover>=0&&hover<n){const c=candles[hover];const x=12+(hover/n)*(W-24);ctx.strokeStyle=T.bl;ctx.lineWidth=.5;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(x+bw/2,0);ctx.lineTo(x+bw/2,H);ctx.stroke();const cy=10+((mx-c.c)/rng)*cH;ctx.beginPath();ctx.moveTo(0,cy);ctx.lineTo(W,cy);ctx.stroke();ctx.setLineDash([]);
const bx=hover>n/2?x-100:x+bw+6;ctx.fillStyle=T.sf;ctx.globalAlpha=.92;ctx.fillRect(bx,8,96,72);ctx.globalAlpha=1;ctx.strokeStyle=T.bd;ctx.strokeRect(bx,8,96,72);
ctx.font=`${Math.round(4.5*dpr)}px monospace`;const f=v=>v<.0001?v.toExponential(1):v<.01?v.toFixed(6):v<1?v.toFixed(4):v.toFixed(2);
ctx.fillStyle=T.dm;ctx.fillText("O",bx+4,22);ctx.fillText("H",bx+4,34);ctx.fillText("L",bx+4,46);ctx.fillText("C",bx+4,58);ctx.fillText("V",bx+4,70);
ctx.fillStyle=T.tx;ctx.fillText(f(c.o),bx+16,22);ctx.fillText(f(c.h),bx+16,34);ctx.fillText(f(c.l),bx+16,46);ctx.fillStyle=c.c>=c.o?"#00e676":"#ff1744";ctx.fillText(f(c.c),bx+16,58);ctx.fillStyle=T.dm;ctx.fillText(fm(c.v),bx+16,70)}},[data,hover,T,mb,loaded]);
const onM=useCallback(e=>{const cv=cvRef.current;if(!cv||!data)return;const r=cv.getBoundingClientRect();const x=((e.clientX||e.pageX)-r.left)/r.width;const n=Math.min(80,data.length);sHover(Math.max(0,Math.min(n-1,Math.floor(x*n))))},[data]);
if(!data)return<div style={{width:"100%",height:mb?200:280,display:"flex",alignItems:"center",justifyContent:"center",background:T.bg}}><Sp s={14}/></div>;
return<canvas ref={cvRef} onMouseMove={onM} onMouseLeave={()=>sHover(null)} onTouchMove={e=>{if(e.touches[0])onM(e.touches[0])}} style={{width:"100%",height:mb?200:280,display:"block",background:T.bg,cursor:"crosshair"}}/>}

// ═══ TOKEN DETAIL — full inspection panel ═══
function TokenDetail({t,T,mb,trB,buying,selling,sBuy,sSell,quickBuy,quickSell,toast,held,onClose,solP}){
const isH=held.has(t.ca);
useEffect(()=>{const h=e=>{if(e.key==="Escape")onClose()};window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h)},[onClose]);
const SL=({href,icon:Ic,label})=>href?<a href={href} target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:3,padding:"4px 8px",background:T.bg,border:"1px solid "+T.bd,borderRadius:5,fontSize:8,color:T.md,textDecoration:"none",fontWeight:600}}><Ic s={10} c={T.md}/>{label}</a>:null;
return<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden",animation:"su .25s ease",margin:mb?"0 0 6px":"0 0 8px"}}>
{/* Header with large image */}
<div style={{display:"flex",gap:12,padding:mb?10:14,borderBottom:"1px solid "+T.bd}}>
<div style={{width:mb?64:80,height:mb?64:80,borderRadius:10,overflow:"hidden",background:T.bg,flexShrink:0}}>{t.image?<img src={imgProxy(t.image)} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,color:T.ft+"33",fontWeight:900}}>{(tk(t.ticker)||"?")[0]}</div>}</div>
<div style={{flex:1,minWidth:0}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}><span style={{fontSize:mb?15:18,fontWeight:900}}>{t.name||tk(t.ticker)}</span><span style={{fontSize:11,color:T.gn,fontWeight:700}}>{tk(t.ticker)}</span>{isH&&<span style={{fontSize:7,fontWeight:800,padding:"1px 4px",borderRadius:3,background:T.gn+"18",color:T.gn}}>HELD</span>}{t.bundled&&<span style={{fontSize:7,fontWeight:800,padding:"1px 4px",borderRadius:3,background:T.or+"18",color:T.or}}>BUNDLED</span>}</div>
<div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:4}}><span style={{fontSize:mb?20:26,fontWeight:900,color:fixMc(t,solP)>=1e6?"#ffaa00":fixMc(t,solP)>=1e5?T.gn:T.tx}}>${fm(fixMc(t,solP))}</span>{t.h1Change!=null&&<span style={{fontSize:12,fontWeight:700,color:t.h1Change>0?T.gn:"#ff4444"}}>{t.h1Change>0?"+":""}{t.h1Change.toFixed(1)}%</span>}</div>
{/* Social links — always visible */}
<div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
<SL href={t.twitter?("https://twitter.com/"+(t.twitter.startsWith("@")?t.twitter.slice(1):t.twitter)):null} icon={IC.tw} label="Twitter"/>
<SL href={t.website} icon={IC.globe} label="Website"/>
<SL href={t.telegram?("https://t.me/"+(t.telegram.startsWith("@")?t.telegram.slice(1):t.telegram)):null} icon={IC.tg} label="Telegram"/>
<a href={"https://pump.fun/coin/"+t.ca} target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:3,padding:"4px 8px",background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:5,fontSize:8,color:T.gn,textDecoration:"none",fontWeight:700}}>pump.fun</a>
<a href={"https://www.gmgn.cc/sol/token/"+t.ca} target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:3,padding:"4px 8px",background:T.bg,border:"1px solid "+T.bd,borderRadius:5,fontSize:8,color:T.dm,textDecoration:"none"}}>gmgn</a>
<a href={"https://dexscreener.com/solana/"+t.ca} target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:3,padding:"4px 8px",background:T.bg,border:"1px solid "+T.bd,borderRadius:5,fontSize:8,color:T.dm,textDecoration:"none"}}>dex</a>
</div>
</div>
<button onClick={onClose} style={{background:T.bg,border:"1px solid "+T.bd,cursor:"pointer",color:T.dm,padding:"4px 10px",alignSelf:"flex-start",flexShrink:0,borderRadius:6,display:"flex",alignItems:"center",gap:3,fontSize:9,fontFamily:M,fontWeight:700}}><IC.close s={12} c={T.dm}/> Close</button>
</div>
{/* Description */}
{t.description&&<div style={{padding:"6px 14px",fontSize:11,color:T.dm,borderBottom:"1px solid "+T.bd,lineHeight:1.5}}>{t.description.length>200?t.description.slice(0,200)+"…":t.description}</div>}
{/* Chart — canvas candlestick with OHLC + volume */}
<CandleChart ca={t.ca} T={T} mb={mb}/>
<div style={{padding:"3px 14px",borderBottom:"1px solid "+T.bd,display:"flex",gap:4}}><a href={"https://www.gmgn.cc/kline/sol/"+t.ca} target="_blank" rel="noopener" style={{fontSize:7,color:T.dm,textDecoration:"none"}}>open full chart →</a><a href={"https://dexscreener.com/solana/"+t.ca} target="_blank" rel="noopener" style={{fontSize:7,color:T.dm,textDecoration:"none"}}>dexscreener →</a></div>
{/* CA copy */}
<div style={{padding:"5px 14px",borderTop:"1px solid "+T.bd,display:"flex",alignItems:"center",gap:4}}>
<button onClick={()=>{navigator.clipboard?.writeText(t.ca);toast("Copied","success")}} style={{padding:"3px 6px",background:"none",border:"1px solid "+T.bd,borderRadius:4,fontSize:8,color:T.ft,cursor:"pointer",display:"flex",alignItems:"center",gap:2}}><IC.copy s={8}/>{t.ca}</button>
{t.age!=null&&<span style={{fontSize:8,color:T.ft,marginLeft:"auto"}}>{t.age>=24?Math.floor(t.age/24)+"d":Math.round(t.age)+"h"} old</span>}
</div>
{/* Buy/Sell */}
<div style={{padding:"6px 14px 10px"}}>
<div style={{display:"flex",gap:3,marginBottom:isH?4:0}}><span style={{fontSize:8,color:T.gn,fontWeight:700,width:20,alignSelf:"center"}}>BUY</span>{[.05,.1,.25,.5,1].map(amt=>{const ok=(trB||0)>=amt;const ld=buying===t.ca+amt;return<button key={amt} disabled={!ok||ld} onClick={async()=>{sBuy(t.ca+amt);try{await quickBuy(t.ca,amt);toast(`+${amt}`,"success")}catch(er){toast(er.message,"error")}sBuy(null)}} style={{padding:"6px 0",flex:1,background:ok?T.gn+"06":"transparent",border:"1px solid "+(ok?T.gn+"22":T.bd),borderRadius:5,fontSize:10,fontWeight:800,color:ok?T.gn:T.ft,cursor:ok&&!ld?"pointer":"default",opacity:ok?1:.2}}>{ld?<Sp s={8}/>:amt}</button>})}</div>
{isH&&<div style={{display:"flex",gap:3}}><span style={{fontSize:8,color:"#ff4444",fontWeight:700,width:20,alignSelf:"center"}}>SELL</span>{[25,50,100].map(pct=>{const ld=selling===t.ca+pct;return<button key={pct} disabled={ld} onClick={async()=>{sSell(t.ca+pct);try{await quickSell(t.ca,pct);toast(`Sold ${pct}%`,"success")}catch(er){toast(er.message,"error")}sSell(null)}} style={{padding:"6px 0",flex:1,background:"#ff444406",border:"1px solid #ff444418",borderRadius:5,fontSize:10,fontWeight:800,color:"#ff4444",cursor:ld?"default":"pointer"}}>{ld?<Sp s={8} c="#ff4444"/>:pct===100?"ALL":pct+"%"}</button>})}</div>}
</div></div>}

// ═══ SIMULATION — pump.fun bonding curve simulator ═══
function SimMode({mb}){const T=uT();const cvRef=useRef(null);const frame=useRef(0);
const st=useRef({p:.00001,pts:[],buys:[],sells:[],noise:[],mc:0,sig:"WAIT",ph:"idle",spent:0,back:0,bonded:false,bondProb:0,peakMc:0,roi:0});
const[running,sR]=useState(false);const[budget,sBudget]=useState(50);const[speed,sSpeed]=useState(1);const[autoBuy,sAB]=useState(false);const[tick,sTick]=useState(0);
const PHASES={scan:"Scanning for entry — analyzing first trades",accumulate:"Fleet buying in — staggered Gaussian timing",hold:"Holding position — monitoring opponent behavior",distribute:"Selling into demand — taking profit",sweep:"Final sweep — recovering all SOL from fleet wallets",complete:"Session complete — all funds returned"};
const calcBondProb=(mc,mom,bp)=>{if(mc>=69000)return 100;const base=Math.min(80,(mc/69000)*100);const m=mom>0?Math.min(15,mom*500):Math.max(-20,mom*300);const b=bp>0.5?10:bp>0.3?5:0;return Math.max(0,Math.min(99,Math.round(base+m+b)))};
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
else if(phase==="complete"){s.sig="DONE";s.bonded=s.mc>=69000}
else if(phase==="scan"){s.sig="SCAN";if(f%12===0)s.noise.push({f,sell:Math.random()>.5})}
s.roi=s.spent>0?((s.back-s.spent)/s.spent*100):0;sTick(f);
const cv=cvRef.current;if(!cv)return;const ctx=cv.getContext("2d");const dpr=window.devicePixelRatio||2;const w=cv.width=cv.offsetWidth*dpr;const h=cv.height=(mb?180:240)*dpr;ctx.clearRect(0,0,w,h);
const pts=s.pts;if(pts.length<2)return;const mn=Math.min(...pts),mx=Math.max(...pts),rng=mx-mn||1;
ctx.strokeStyle=T.bd;ctx.lineWidth=.5;for(let i=0;i<5;i++){const y=8+h*.85*(i/4);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
const bondP=69000/1e9;if(bondP>=mn*.5&&bondP<=mx*1.5){const by=h-8-((Math.min(bondP,mx)-mn)/rng)*(h-16);if(by>0&&by<h){ctx.setLineDash([8,4]);ctx.strokeStyle=T.yl+"55";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,by);ctx.lineTo(w,by);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=T.yl;ctx.font=`${Math.round(5*dpr)}px monospace`;ctx.fillText("BOND $69K",w-Math.round(40*dpr),by-4)}}
ctx.beginPath();ctx.strokeStyle=T.gn;ctx.lineWidth=2;ctx.lineJoin="round";
for(let i=0;i<pts.length;i++){const x=(i/(pts.length-1))*(w-4)+2;const y=h-8-((pts[i]-mn)/rng)*(h-16);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)}ctx.stroke();
const gf=ctx.createLinearGradient(0,0,0,h);gf.addColorStop(0,T.gn+"18");gf.addColorStop(1,T.gn+"01");ctx.lineTo(w-2,h);ctx.lineTo(2,h);ctx.closePath();ctx.fillStyle=gf;ctx.fill();
const mark=(fi,color,sz)=>{const bi=Math.round((fi/f)*pts.length);if(bi<0||bi>=pts.length)return;const x=(bi/(pts.length-1))*(w-4)+2;const y=h-8-((pts[bi]-mn)/rng)*(h-16);ctx.beginPath();ctx.arc(x,y,sz*2,0,Math.PI*2);ctx.fillStyle=color+"33";ctx.fill();ctx.beginPath();ctx.arc(x,y,sz,0,Math.PI*2);ctx.fillStyle=color;ctx.fill()};
s.buys.forEach(b=>mark(b.f,"#00e676",3));s.sells.forEach(b=>mark(b.f,"#ff1744",3));s.noise.forEach(n=>mark(n.f,n.sell?"#ff174444":"#00e67644",2));
};const iv=setInterval(doTick,35/speed);return()=>clearInterval(iv)},[running,budget,speed,mb]);
const s=st.current;const pnl=s.back-s.spent;
return<div style={{background:T.sf,border:"1px solid "+T.pu+"18",borderRadius:10,overflow:"hidden",animation:"si .2s ease"}}>
<div style={{padding:"8px 12px",borderBottom:"1px solid "+T.bd}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
<div style={{display:"flex",alignItems:"center",gap:5}}><IC.sim s={14} c={T.pu}/><span style={{fontSize:12,fontWeight:800}}>Bonding Curve Simulator</span>{running&&<span style={{width:5,height:5,borderRadius:"50%",background:T.gn,animation:"gp 2s infinite"}}/>}</div>
<div style={{display:"flex",gap:2}}><button onClick={()=>sAB(!autoBuy)} style={{background:autoBuy?T.gn+"0c":"none",border:"1px solid "+(autoBuy?T.gn:T.bd)+"18",borderRadius:4,padding:"1px 7px",fontSize:8,fontWeight:autoBuy?700:400,color:autoBuy?T.gn:T.dm,cursor:"pointer"}}>{autoBuy?"AUTO":"auto"}</button><button onClick={()=>sSpeed(speed>=4?1:speed*2)} style={{background:"none",border:"1px solid "+T.bd,borderRadius:4,padding:"1px 7px",fontSize:8,color:T.dm,cursor:"pointer"}}>{speed}x</button><button onClick={()=>sR(!running)} style={{background:running?T.rd+"0c":T.gn+"0c",border:"1px solid "+(running?T.rd:T.gn)+"18",borderRadius:4,padding:"1px 8px",fontSize:8,fontWeight:700,color:running?T.rd:T.gn,cursor:"pointer"}}>{running?"Stop":"Run"}</button></div></div>
<div style={{fontSize:8,color:T.dm,lineHeight:1.4}}>Simulates how Bondli fleet trades a pump.fun bonding curve. AI buys during accumulation, holds through volatility, exits into demand. Objective: bond the token to Raydium at $69K MC.</div></div>
<canvas ref={cvRef} style={{width:"100%",height:mb?180:240,display:"block",background:T.bg}}/>
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
<div style={{padding:"4px 12px 6px",display:"flex",gap:4,alignItems:"center"}}><span style={{fontSize:8,color:T.ft}}>Budget</span><input type="range" min={5} max={100} step={5} value={budget} onChange={e=>sBudget(Number(e.target.value))} style={{flex:1}}/><span style={{fontSize:10,fontWeight:800,color:T.gn,minWidth:20}}>{budget}</span></div>
<div style={{padding:"0 12px 6px",display:"flex",gap:8,fontSize:7,color:T.ft,alignItems:"center"}}><span style={{display:"flex",alignItems:"center",gap:2}}><span style={{width:5,height:5,borderRadius:"50%",background:"#00e676"}}/>fleet buy</span><span style={{display:"flex",alignItems:"center",gap:2}}><span style={{width:5,height:5,borderRadius:"50%",background:"#ff1744"}}/>fleet sell</span><span style={{display:"flex",alignItems:"center",gap:2}}><span style={{width:5,height:5,borderRadius:"50%",background:T.dm+"44"}}/>opponent</span>{autoBuy&&<span style={{color:T.gn,fontWeight:700}}>AUTO-BUY ON</span>}<span style={{marginLeft:"auto",color:T.yl+"88",fontSize:6}}>━ $69K bond line</span></div></div>}

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
const[rTab,sRTab]=useState("momentum");const[rLoad,sRL]=useState(true);const[rPool,sRP]=useState(0);
const[rExp,sRExp]=useState(null);const[buying,sBuy]=useState(null);const[selling,sSell]=useState(null);const[rSearch,sRS]=useState("");
const[rEnabled,sRE]=useState(true);const[img,sImg]=useState(null);const[showKeys,sShowKeys]=useState(false);
const[refData,sRefData]=useState(null);const[refInput,sRefInput]=useState("");const[refMsg,sRefMsg]=useState("");
const[expert,sExpert]=useState(false);const[showSim,sShowSim]=useState(false);const[launchStep,sLS]=useState(null);
// launchStep: null | "creating" | "uploading" | "funding" | "dev_buy" | "snipers" | "live"
const[intelData,sIntel]=useState(null);

const toast=useCallback((m,t="info")=>{const id=Date.now()+Math.random();sToasts(x=>[...x,{id,msg:m,type:t}]);setTimeout(()=>sToasts(x=>x.filter(y=>y.id!==id)),5000)},[]);
const hasAccess=user&&(user.demo||user.tier==="free"||user.tier==="pro"||user.tier==="vip");
const tierColor=user?.whitelisted?T.yl:user?.tier==="pro"?T.pu:T.gn;
const tierLabel=user?.whitelisted?"VIP":user?.tier==="pro"?"PRO":user?.demo?"DEMO":"FREE";
const isOwner=user?.whitelisted||user?.pubkey==="4XnHZZmHwSQ8RszJsdc7snvxG8dZtm6g4hvpkCMkguMx";
const isApe=!!eCA;const pv=dbp(sol,isApe);const nw=wc(sol);
const canLaunch=(trW||isApe)&&(eCA||(tn&&tkr));
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
useEffect(()=>{if(!hasAccess||!rEnabled)return;const f=async()=>{try{const d=await a.gr();if(d.tabs)sRT(d.tabs);if(d.poolSize!=null)sRP(d.poolSize);sRL(false)}catch{sRL(false)}};f();const iv=setInterval(f,5000);return()=>clearInterval(iv)},[hasAccess,rEnabled]);
useEffect(()=>{if(!user?.pubkey||user.demo||!trW)return;const f=()=>a.gp(user.pubkey).then(d=>{if(d.positions){sPos(d.positions);sHeld(new Set(d.positions.map(p=>p.mint)))}}).catch(()=>{});f();const iv=setInterval(f,20000);return()=>clearInterval(iv)},[user?.pubkey,trW]);
useEffect(()=>{if(!user?.pubkey||user.demo)return;a.grf(user.pubkey).then(d=>sRefData(d)).catch(()=>{})},[user?.pubkey]);

const disconnect=async()=>{try{const p=window?.phantom?.solana||window?.solana;await p?.disconnect()}catch{}sU(null)};
const resetHome=()=>{sLd(false);sLCA("");sAsid("");sFl(null)};
const quickBuy=async(ca,s)=>{if(!user?.pubkey||user.demo){toast("Connect wallet","error");return}if(!trW){toast("Create trading key","error");return}if(trB<s){toast(`Need ${s} SOL`,"error");return}const r=await a.qb(user.pubkey,ca,s);if(r.signature){sTrB(b=>b-s);hp([6,15,6]);toast(`Bought ${s} SOL — check Bags`,"success");sTab("bags");sRExp(null);setTimeout(()=>{a.gp(user.pubkey).then(d=>{if(d.positions){sPos(d.positions);sHeld(new Set(d.positions.map(p=>p.mint)))}}).catch(()=>{})},2000);return r.signature}throw new Error(r.error||"Failed")};
const quickSell=async(ca,pct)=>{if(!user?.pubkey)return;const r=await a.qs(user.pubkey,ca,pct);return r.signature||null};

if(!user)return<TC.Provider value={T}><style>{css(T)}</style><div style={{minHeight:"100dvh",background:T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:M,padding:20}}><div style={{animation:"pf 3s ease infinite",marginBottom:24}}><Logo s={mb?44:56}/></div><div style={{fontWeight:800,fontSize:mb?24:40,letterSpacing:"-.02em",marginBottom:4}}>BOND<span style={{color:T.rd}}>LI</span></div><div style={{fontSize:mb?12:14,color:T.dm,marginBottom:28}}>Fleet trading engine for pump.fun</div><B onClick={connect} style={{padding:"12px 28px",fontSize:14,borderRadius:10,background:"linear-gradient(135deg,#534bb1,#551bf9)",animation:"gl 3s infinite"}}><IC.ph/> Connect</B><button onClick={()=>sU({pubkey:"demo",tier:"demo",demo:true})} style={{marginTop:10,background:"none",border:"none",fontSize:11,color:T.ft,cursor:"pointer"}}>demo</button></div></TC.Provider>;

const rTokens=rt[rTab]||[];const rFiltered=rSearch?rTokens.filter(t=>(t.name||"").toLowerCase().includes(rSearch.toLowerCase())||(tk(t.ticker)||"").toLowerCase().includes(rSearch.toLowerCase())||t.ca?.includes(rSearch)):rTokens;
const expToken=rExp?rFiltered.find(t=>t.ca===rExp)||rTokens.find(t=>t.ca===rExp):null;

return<TC.Provider value={T}><style>{css(T)}</style>
{toasts.length>0&&<div style={{position:"fixed",top:mb?4:60,left:"50%",transform:"translateX(-50%)",zIndex:9999,display:"flex",flexDirection:"column",gap:3,maxWidth:mb?"95%":480,width:"auto",minWidth:200}}>{toasts.map(t=><div key={t.id} onClick={()=>sToasts(x=>x.filter(y=>y.id!==t.id))} style={{padding:"8px 16px",borderRadius:8,fontFamily:M,fontSize:11,fontWeight:600,background:t.type==="error"?T.rd+"15":t.type==="success"?T.gn+"15":T.sf,color:t.type==="error"?T.rd:t.type==="success"?T.gn:T.tx,border:"1px solid "+(t.type==="error"?T.rd+"33":t.type==="success"?T.gn+"33":T.bd),animation:"fd .15s ease",cursor:"pointer",backdropFilter:"blur(8px)",textAlign:"center",wordBreak:"break-word"}}>{t.msg}</div>)}</div>}
<div style={{minHeight:"100dvh",background:T.bg,color:T.tx,fontFamily:M,paddingBottom:mb?68:16}}>
<header style={{padding:mb?"5px 8px":"6px 20px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:20,background:T.bg+"f4",backdropFilter:"blur(10px)"}}><div onClick={resetHome} style={{display:"flex",alignItems:"center",gap:mb?4:7,cursor:"pointer"}}><Logo s={mb?16:22}/><span style={{fontWeight:800,fontSize:mb?13:16}}>{mb?"B":"BOND"}<span style={{color:T.rd}}>{mb?"L":"LI"}</span></span>{wsOn&&(launched||pSess.length>0)&&<span style={{width:4,height:4,borderRadius:"50%",background:T.gn,animation:"gp 2s infinite"}}/>}</div>{trW&&<div style={{display:"flex",alignItems:"center",gap:3}}><span style={{fontSize:mb?18:24,fontWeight:900,color:trB>.01?T.gn:T.ft}}>{solFmt(trB)}</span><IC.sol s={mb?14:18}/></div>}<div style={{display:"flex",alignItems:"center",gap:mb?2:5}}>{launched&&<button onClick={async()=>{if(!confirm("STOP ALL?"))return;try{for(const s of pSess)try{await a.ss(s.id,user.pubkey)}catch{};sPS([]);toast("Stopped","success");resetHome()}catch(e){toast(e.message,"error")}}} style={{background:T.rd+"12",border:"1px solid "+T.rd+"22",borderRadius:6,padding:"3px 7px",cursor:"pointer",color:T.rd,display:"flex",alignItems:"center",gap:2,fontSize:9,fontWeight:700}}><IC.stop s={10}/>STOP</button>}<button onClick={()=>sShowSim(!showSim)} style={{background:showSim?T.pu+"10":"none",border:"1px solid "+(showSim?T.pu+"22":T.bd),borderRadius:6,padding:"3px 5px",cursor:"pointer",color:showSim?T.pu:T.dm,display:"flex"}}><IC.sim s={13} c={showSim?T.pu:T.dm}/></button><button onClick={tog} style={{background:"none",border:"1px solid "+T.bd,borderRadius:6,padding:"3px 5px",cursor:"pointer",color:T.dm,display:"flex"}}>{isDark?<IC.sun/>:<IC.moon/>}</button><button onClick={()=>sShowKeys(!showKeys)} style={{background:"none",border:"1px solid "+T.bd,borderRadius:6,padding:"3px 5px",cursor:"pointer",color:T.dm,display:"flex"}}><IC.gear s={13}/></button><div onClick={disconnect} style={{display:"flex",alignItems:"center",gap:3,padding:"2px 5px",background:T.sf,borderRadius:6,border:"1px solid "+T.bd,cursor:"pointer"}}><span style={{padding:"1px 4px",borderRadius:3,fontSize:7,fontWeight:800,background:tierColor+"18",color:tierColor,border:"1px solid "+tierColor+"22"}}>{tierLabel}</span><Av pk={user.pubkey||""} s={14}/><span style={{fontSize:9,color:T.dm,maxWidth:mb?40:70,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.demo?"demo":(cUser||wN(user.pubkey||""))}</span></div></div></header>

{trW?<div style={{padding:"3px 10px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",gap:6,fontSize:9,color:T.ft}}><IC.zap s={9}/><span onClick={()=>{navigator.clipboard?.writeText(trW);toast("Copied","success")}} style={{cursor:"pointer"}}>{tp(trW,6,4)}</span>{online>0&&<span style={{color:T.gn+"77"}}>{online} online</span>}<div style={{marginLeft:"auto",display:"flex",gap:2}}><button onClick={()=>{navigator.clipboard?.writeText(trW);toast("Deposit address copied","success")}} style={{background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:4,padding:"1px 6px",cursor:"pointer",color:T.gn,fontSize:8,fontWeight:700}}>deposit</button></div></div>:user&&!user.demo&&<div style={{padding:"8px 10px",borderBottom:"1px solid "+T.bd,textAlign:"center"}}><B onClick={async()=>{try{const r=await a.ctw(a.w);if(r.ok){sTrW(r.tradingWallet);sTrK(r);toast("Key created","success")}}catch(e){toast(e.message,"error")}}} small><IC.key s={12} c="#0a0a0f"/> Create Trading Key</B></div>}

{showSim&&<div style={{padding:mb?"6px 8px":"8px 16px"}}><EB l="Sim"><SimMode mb={mb}/></EB></div>}

{launched&&lCA?<EB l="War Room"><div style={{padding:mb?4:8,animation:"fu .2s ease"}}>
{/* ═══ WAR ROOM HEADER ═══ */}
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 10px",background:T.sf,border:"1px solid "+T.gn+"22",borderRadius:10,marginBottom:6}}>
<div style={{display:"flex",alignItems:"center",gap:6}}>
<span style={{width:8,height:8,borderRadius:"50%",background:T.gn,animation:"gp 1.5s infinite"}}/>
<span style={{fontSize:15,fontWeight:900,color:T.gn}}>LIVE</span>
<span style={{fontSize:10,color:T.dm,fontWeight:700}}>{tk(fleet?.ca?.slice(0,8)||lCA.slice(0,8))}</span>
{fleet?.phase&&<span style={{fontSize:7,padding:"2px 6px",borderRadius:4,background:fleet.phase==="selling"?T.rd+"12":fleet.phase==="volume"?T.pu+"12":T.gn+"12",color:fleet.phase==="selling"?T.rd:fleet.phase==="volume"?T.pu:T.gn,fontWeight:800,textTransform:"uppercase"}}>{fleet.phase}</span>}
</div>
<div style={{display:"flex",gap:2}}>
<button onClick={resetHome} style={{background:"none",border:"1px solid "+T.bd,borderRadius:5,padding:"4px 10px",fontSize:8,color:T.dm,cursor:"pointer"}}>← Back</button>
<button onClick={async()=>{try{const r=await a.ss(asid,user.pubkey);toast(`Closed — ${(r.totalSwept||0).toFixed(4)} SOL swept`,"success");resetHome()}catch(e){toast(e.message,"error")}}} style={{background:T.rd+"0a",border:"1px solid "+T.rd+"22",borderRadius:5,padding:"4px 10px",fontSize:8,fontWeight:800,color:T.rd,cursor:"pointer"}}>Close + Sweep</button>
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
<div style={{fontSize:mb?14:18,fontWeight:900,color:s.c,display:"flex",alignItems:"center",justifyContent:"center",gap:2}}>{s.v}{s.l==="PnL"&&<IC.sol s={10}/>}</div>
<div style={{fontSize:6,color:T.ft,fontWeight:700,letterSpacing:"0.05em"}}>{s.l}</div>
</div>)}
</div>

{/* ═══ CHART ═══ */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden",marginBottom:6}}>
<iframe src={"https://www.gmgn.cc/kline/sol/"+lCA} style={{width:"100%",height:mb?240:360,border:"none",display:"block"}} title="chart" loading="lazy"/>
</div>

{/* ═══ TRADE FEED + WALLETS (side by side on desktop) ═══ */}
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr",gap:6,marginBottom:6}}>
{/* Trade feed */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden"}}>
<div style={{padding:"6px 10px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<span style={{fontSize:10,fontWeight:800}}>Trade Feed</span>
<span style={{fontSize:7,color:T.ft}}>live</span>
</div>
<div style={{maxHeight:200,overflowY:"auto",padding:"2px 0"}}>
{(fleet?.trades||[]).slice(0,20).map((t,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 10px",fontSize:8,borderBottom:"1px solid "+T.bd+"44"}}>
<span style={{width:4,height:4,borderRadius:"50%",background:t.side==="buy"?T.gn:T.rd,flexShrink:0}}/>
<span style={{color:t.side==="buy"?T.gn:T.rd,fontWeight:800,width:28}}>{t.side==="buy"?"BUY":"SELL"}</span>
<span style={{color:T.dm,flex:1}}>{t.wallet||"?"}</span>
<span style={{color:T.tx,fontWeight:700}}>{typeof t.sol==="number"?t.sol.toFixed(4):t.sol}</span>
<IC.sol s={8}/>
<span style={{fontSize:7,color:T.ft,minWidth:30,textAlign:"right"}}>{t.role||""}</span>
</div>)}
{(!fleet?.trades||fleet.trades.length===0)&&<div style={{padding:16,textAlign:"center",fontSize:9,color:T.ft}}>Waiting for trades...</div>}
</div></div>

{/* Wallet breakdown */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden"}}>
<div style={{padding:"6px 10px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<span style={{fontSize:10,fontWeight:800}}>Fleet Wallets</span>
<button onClick={async()=>{try{const k=await a.ek(asid,user.pubkey);if(k.ok&&k.keys?.length){navigator.clipboard?.writeText(k.keys.map(w=>w.role+": "+w.secret).join("\n"));toast(k.keys.length+" keys copied","success")}}catch(e){toast(e.message,"error")}}} style={{background:"none",border:"1px solid "+T.bd,borderRadius:3,padding:"1px 5px",fontSize:7,color:T.ft,cursor:"pointer"}}>Export All</button>
</div>
<div style={{maxHeight:200,overflowY:"auto"}}>
{(fleet?.wallets||[]).map((w,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",borderBottom:"1px solid "+T.bd+"44",fontSize:8}}>
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

{/* ═══ ACTION BAR ═══ */}
<div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
<button onClick={()=>{navigator.clipboard?.writeText(lCA);toast("CA copied","success")}} style={{padding:"5px 10px",background:T.sf,border:"1px solid "+T.bd,borderRadius:6,fontSize:9,color:T.ft,cursor:"pointer",fontFamily:M}}>{lCA.slice(0,12)}…</button>
<a href={"https://pump.fun/coin/"+lCA} target="_blank" rel="noopener" style={{padding:"5px 10px",background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:6,fontSize:9,color:T.gn,textDecoration:"none",fontWeight:700}}>pump.fun ↗</a>
<a href={"https://www.gmgn.cc/sol/token/"+lCA} target="_blank" rel="noopener" style={{padding:"5px 10px",background:T.sf,border:"1px solid "+T.bd,borderRadius:6,fontSize:9,color:T.dm,textDecoration:"none"}}>gmgn ↗</a>
<a href={"https://dexscreener.com/solana/"+lCA} target="_blank" rel="noopener" style={{padding:"5px 10px",background:T.sf,border:"1px solid "+T.bd,borderRadius:6,fontSize:9,color:T.dm,textDecoration:"none"}}>dexscreener ↗</a>
<button onClick={async()=>{try{const r=await a.fr(asid,user.pubkey);toast(`Swept ${(r.totalRecovered||0).toFixed(4)} SOL`,"success")}catch(e){toast(e.message,"error")}}} style={{padding:"5px 10px",background:T.yl+"08",border:"1px solid "+T.yl+"18",borderRadius:6,fontSize:9,fontWeight:700,color:T.yl,cursor:"pointer"}}>Force Sweep</button>
</div>
</div></EB>
:<>
{!mb&&<div style={{display:"flex",margin:"8px 16px 0",borderRadius:8,overflow:"hidden",background:T.sf,border:"1px solid "+T.bd}}>{[{id:"radar",l:"Radar",ic:IC.radar},{id:"bags",l:"Bags",ic:IC.bags},{id:"deploy",l:"Deploy",ic:IC.deploy},{id:"intel",l:"Intel",ic:IC.sim}].map(t=>{const ac=tab===t.id;return<button key={t.id} onClick={()=>{sTab(t.id);sRExp(null);setTimeout(()=>document.getElementById("tc")?.scrollIntoView({behavior:"smooth",block:"start"}),30)}} style={{flex:1,padding:"9px 0",background:ac?T.gn+"08":"transparent",borderBottom:ac?"1.5px solid "+T.gn:"1.5px solid transparent",border:"none",fontSize:11,fontWeight:ac?800:500,color:ac?T.gn:T.dm,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}><t.ic s={14} c={ac?T.gn:T.dm}/>{t.l}</button>})}</div>}
<div id="tc" style={{padding:mb?"0 6px 6px":"0 16px 16px",marginTop:mb?4:8,scrollMarginTop:50}}>

{tab==="radar"&&<EB l="Radar"><div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden",animation:"si .2s ease"}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",borderBottom:"1px solid "+T.bd}}><div style={{display:"flex",alignItems:"center",gap:5}}><IC.radar s={14} c={T.gn}/><span style={{fontSize:13,fontWeight:800}}>Radar</span><span style={{width:5,height:5,borderRadius:"50%",background:rEnabled?T.gn:T.rd}}/><span style={{fontSize:8,color:T.ft}}>{rPool}</span>{online>0&&<span style={{fontSize:8,color:T.gn+"66"}}>{online} online</span>}</div><div style={{display:"flex",gap:2}}><button onClick={()=>{sRL(true);a.gr().then(d=>{if(d.tabs)sRT(d.tabs);if(d.poolSize!=null)sRP(d.poolSize);sRL(false)}).catch(()=>sRL(false))}} style={{background:"none",border:"1px solid "+T.bd,borderRadius:5,padding:"2px 7px",cursor:"pointer",fontSize:9,color:T.dm}}>↻</button><button onClick={()=>sRE(!rEnabled)} style={{background:rEnabled?T.gn+"08":T.rd+"08",border:"1px solid "+(rEnabled?T.gn:T.rd)+"18",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:9,fontWeight:700,color:rEnabled?T.gn:T.rd}}>{rEnabled?"ON":"OFF"}</button></div></div>
<div style={{display:"flex",alignItems:"center",borderBottom:"1px solid "+T.bd,overflowX:"auto"}}>{[{id:"momentum",l:"Momentum",ic:IC.trend},{id:"hot",l:"Hot",ic:IC.fire},{id:"new",l:"New",ic:IC.star},{id:"graduating",l:"Grad",ic:IC.grad}].map(t=>{const ac=rTab===t.id;const n=(rt[t.id]||[]).length;return<button key={t.id} onClick={()=>{sRTab(t.id);sRExp(null)}} style={{padding:mb?"6px 5px":"6px 10px",background:"none",border:"none",borderBottom:ac?"1.5px solid "+T.gn:"1.5px solid transparent",fontSize:mb?8:10,fontWeight:700,color:ac?T.gn:T.dm,cursor:"pointer",display:"flex",alignItems:"center",gap:2,whiteSpace:"nowrap"}}><t.ic s={10} c={ac?T.gn:T.dm}/>{t.l}{n>0&&<span style={{fontSize:7,opacity:.5}}>{n}</span>}</button>})}<div style={{flex:1}}/><input value={rSearch} onChange={e=>{sRS(e.target.value);sRExp(null)}} placeholder="Search / CA" style={{width:mb?"100%":160,padding:"4px 7px",margin:"2px 5px",background:T.bg,border:"1px solid "+T.bd,borderRadius:5,color:T.tx,fontSize:9,outline:"none"}}/></div>
{/* Expanded token detail panel */}
{expToken&&<TokenDetail t={expToken} T={T} mb={mb} trB={trB} buying={buying} selling={selling} sBuy={sBuy} sSell={sSell} quickBuy={quickBuy} quickSell={quickSell} toast={toast} held={held} onClose={()=>sRExp(null)} solP={solP}/>}
{/* Token list */}
{rLoad?<div style={{padding:40,textAlign:"center"}}><Sp s={16}/></div>:!rEnabled?<div style={{padding:40,textAlign:"center",fontSize:11,color:T.ft}}>Paused</div>:rFiltered.length===0?<div style={{padding:40,textAlign:"center",fontSize:11,color:T.ft}}>No movers</div>:<div>{rFiltered.filter(t=>t.ca!==rExp).map(t=>{const isH=held.has(t.ca);return<div key={t.ca} onClick={()=>{sRExp(t.ca);setTimeout(()=>document.getElementById("tc")?.scrollIntoView({behavior:"smooth",block:"start"}),50)}} style={{display:"flex",alignItems:"center",gap:mb?5:8,padding:mb?"6px 8px":"7px 10px",cursor:"pointer",borderBottom:"1px solid "+T.bd,background:isH?T.gn+"03":"transparent"}}><div style={{width:mb?32:38,height:mb?32:38,borderRadius:7,overflow:"hidden",flexShrink:0,background:T.bg,position:"relative"}}>{t.image?<img src={imgProxy(t.image)} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="" onError={e=>e.target.style.display="none"}/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:T.ft+"33",fontWeight:900}}>{(tk(t.ticker)||"?")[0]}</div>}{isH&&<div style={{position:"absolute",top:0,right:0,background:T.gn,color:"#000",fontSize:5,fontWeight:900,padding:"0 2px",borderRadius:"0 0 0 2px"}}>H</div>}</div><div style={{minWidth:0,width:mb?70:110,flexShrink:0}}><div style={{fontSize:mb?10:11,fontWeight:800,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.name||tk(t.ticker)}</div><div style={{display:"flex",alignItems:"center",gap:3,marginTop:1}}><span style={{fontSize:mb?8:9,color:T.gn,fontWeight:700}}>{tk(t.ticker)}</span>{t.twitter&&<IC.tw s={7} c={T.dm}/>}{t.website&&<IC.globe s={7} c={T.dm}/>}{t.telegram&&<IC.tg s={7} c={T.dm}/>}</div>{t.description&&<div style={{fontSize:8,color:T.dm,marginTop:2,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",maxWidth:mb?70:110}}>{t.description.slice(0,60)}</div>}</div><div style={{flex:1,height:mb?22:28}}><SpkC data={t.spark||[]} color={t.spark&&t.spark.length>1&&t.spark[t.spark.length-1]>=t.spark[0]?T.gn:"#ff4444"} h={mb?22:28}/></div><div style={{textAlign:"right",flexShrink:0,minWidth:mb?42:56}}><div style={{fontSize:mb?10:12,fontWeight:800,color:fixMc(t,solP)>=1e6?"#ffaa00":fixMc(t,solP)>=1e5?T.gn:T.tx}}>${fm(fixMc(t,solP))}</div>{t.h1Change!=null&&<div style={{fontSize:7,color:t.h1Change>0?T.gn:"#ff4444"}}>{t.h1Change>0?"+":""}{typeof t.h1Change==="number"?t.h1Change.toFixed(1):t.h1Change}%</div>}</div></div>})}</div>}</div></EB>}

{tab==="bags"&&<EB l="Bags"><div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden",animation:"si .2s ease"}}><div style={{padding:"7px 10px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",justifyContent:"space-between"}}><div style={{display:"flex",alignItems:"center",gap:5}}><IC.bags s={14} c={T.gn}/><span style={{fontSize:13,fontWeight:800}}>Bags</span><span style={{fontSize:8,color:T.ft}}>{positions.length}</span></div><div style={{display:"flex",gap:3}}>{positions.length>0&&<button onClick={async()=>{if(!confirm("Sell ALL positions?"))return;try{const r=await a.sa(user.pubkey);toast(`Sold ${r.sold||0}`,"success")}catch(e){toast(e.message,"error")}}} style={{background:T.rd+"08",border:"1px solid "+T.rd+"18",borderRadius:5,padding:"2px 8px",fontSize:8,fontWeight:700,color:T.rd,cursor:"pointer"}}>Sell All</button>}<button onClick={()=>{a.gp(user.pubkey).then(d=>{if(d.positions){sPos(d.positions);sHeld(new Set(d.positions.map(p=>p.mint)))}toast("Refreshed","success")}).catch(()=>{})}} style={{background:"none",border:"1px solid "+T.bd,borderRadius:5,padding:"2px 8px",fontSize:8,color:T.dm,cursor:"pointer"}}>↻</button></div></div>
{!trW?<div style={{padding:30,textAlign:"center",fontSize:11,color:T.ft}}>Create trading key to start</div>
:positions.length===0?<div style={{padding:30,textAlign:"center"}}><div style={{fontSize:32,marginBottom:6,opacity:.2}}>💼</div><div style={{fontSize:11,color:T.ft}}>No positions yet</div><div style={{fontSize:9,color:T.ft,marginTop:4}}>Buy from Radar to see them here</div></div>
:<div>{positions.map(p=>{const mc=fixMc(p,solP);const pnl=p.pnlSol||p.pnl||0;const pnlPct=p.pnlPct||0;const isProfit=pnl>=0;const val=p.valueSol||p.valueUsd/solP||0;return<div key={p.mint} style={{padding:mb?"8px":"10px 12px",borderBottom:"1px solid "+T.bd,background:isProfit?T.gn+"02":T.rd+"02"}}>
<div style={{display:"flex",alignItems:"center",gap:mb?6:10,marginBottom:6}}>
<div style={{width:36,height:36,borderRadius:8,overflow:"hidden",background:T.bg,flexShrink:0}}>{p.image?<img src={imgProxy(p.image)} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:T.ft}}>{(tk(p.ticker)||"?")[0]}</div>}</div>
<div style={{flex:1,minWidth:0}}>
<div style={{display:"flex",alignItems:"baseline",gap:4}}><span style={{fontSize:12,fontWeight:800}}>{tk(p.ticker)||p.name||p.mint?.slice(0,6)}</span>{mc>0&&<span style={{fontSize:8,color:T.ft}}>${fm(mc)}</span>}</div>
<div style={{fontSize:8,color:T.dm}}>{fm(p.amount)} tokens</div>
</div>
<div style={{textAlign:"right",flexShrink:0}}>
<div style={{fontSize:14,fontWeight:900,color:isProfit?T.gn:T.rd}}>{val>0?<>{solFmt(val)} <IC.sol s={12}/></>:"—"}</div>
{pnl!==0&&<div style={{fontSize:9,fontWeight:700,color:isProfit?T.gn:T.rd}}>{isProfit?"+":""}{typeof pnl==="number"?pnl.toFixed(3):pnl} SOL {pnlPct?`(${isProfit?"+":""}${pnlPct.toFixed(1)}%)`:""}</div>}
</div></div>
<div style={{display:"flex",gap:2}}>{[25,50,100].map(pct=><button key={pct} onClick={async()=>{try{await quickSell(p.mint,pct);toast(`Sold ${pct}%`,"success");setTimeout(()=>a.gp(user.pubkey).then(d=>{if(d.positions){sPos(d.positions);sHeld(new Set(d.positions.map(x=>x.mint)))}}).catch(()=>{}),2000)}catch(e){toast(e.message,"error")}}} style={{flex:1,padding:"5px 0",background:"#ff444406",border:"1px solid #ff444418",borderRadius:5,fontSize:9,fontWeight:800,color:"#ff4444",cursor:"pointer"}}>{pct===100?"SELL ALL":pct+"%"}</button>)}<button onClick={()=>{navigator.clipboard?.writeText(p.mint);toast("CA copied","success")}} style={{padding:"5px 8px",background:"none",border:"1px solid "+T.bd,borderRadius:5,fontSize:8,color:T.ft,cursor:"pointer"}}>CA</button><a href={"https://pump.fun/coin/"+p.mint} target="_blank" rel="noopener" style={{padding:"5px 8px",background:T.gn+"06",border:"1px solid "+T.gn+"18",borderRadius:5,fontSize:8,color:T.gn,textDecoration:"none",fontWeight:700,display:"flex",alignItems:"center"}}>pump</a></div>
</div>})}</div>}</div></EB>}

{tab==="deploy"&&<EB l="Deploy"><div style={{animation:"si .2s ease"}} className="st">{!trW?<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:24,textAlign:"center"}}><IC.key s={24} c={T.yl}/><div style={{fontSize:11,color:T.dm,marginTop:8,marginBottom:12}}>Create trading key first</div><B onClick={async()=>{try{const r=await a.ctw(a.w);if(r.ok){sTrW(r.tradingWallet);sTrK(r);toast("Created","success")}}catch(e){toast(e.message,"error")}}} small><IC.key s={12} c="#0a0a0f"/> Create Key</B></div>:<>
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?10:16,marginBottom:6}}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:mb?8:12}}><IC.rocket s={16}/><span style={{fontFamily:S,fontWeight:800,fontSize:mb?14:16}}>Token</span></div><div style={{display:"flex",gap:10,marginBottom:8}}><ImgUp image={img} onChange={sImg} mb={mb}/><div style={{flex:1}}><div style={{display:"flex",gap:6,marginBottom:6}}><div style={{flex:1}}><div style={{fontSize:8,color:T.ft,marginBottom:2,textTransform:"uppercase"}}>Name</div><In value={tn} onChange={sTn} placeholder="Token name"/></div><div style={{flex:1}}><div style={{fontSize:8,color:T.ft,marginBottom:2,textTransform:"uppercase"}}>Ticker</div><In value={tkr} onChange={sTk} placeholder="TICKER"/></div></div><div style={{fontSize:8,color:T.ft,marginBottom:2,textTransform:"uppercase"}}>Description</div><In value={desc} onChange={sDs} placeholder="Optional"/></div></div><div style={{display:"flex",gap:6,marginTop:8,marginBottom:6}}><div style={{flex:1}}><div style={{fontSize:8,color:T.ft,marginBottom:2,textTransform:"uppercase",display:"flex",alignItems:"center",gap:3}}><IC.tw s={9} c={T.ft}/>Twitter</div><In value={tw} onChange={sTw} placeholder="@handle or URL"/></div><div style={{flex:1}}><div style={{fontSize:8,color:T.ft,marginBottom:2,textTransform:"uppercase",display:"flex",alignItems:"center",gap:3}}><IC.globe s={9} c={T.ft}/>Website</div><In value={wb} onChange={sWb} placeholder="https://"/></div><div style={{flex:1}}><div style={{fontSize:8,color:T.ft,marginBottom:2,textTransform:"uppercase",display:"flex",alignItems:"center",gap:3}}><IC.tg s={9} c={T.ft}/>Telegram</div><In value={tg} onChange={sTg} placeholder="t.me/group"/></div></div><div style={{marginTop:6}}><div style={{fontSize:8,color:T.ft,marginBottom:2,textTransform:"uppercase"}}>Or ape existing CA</div><In value={eCA} onChange={sECA} placeholder="Contract address"/></div></div>
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?10:16,marginBottom:6}}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><IC.shield s={16}/><span style={{fontFamily:S,fontWeight:800,fontSize:mb?14:16}}>Fleet</span><div style={{marginLeft:"auto"}}><button onClick={()=>sExpert(!expert)} style={{background:"none",border:"1px solid "+T.bd,borderRadius:5,padding:"1px 7px",fontSize:8,color:expert?T.gn:T.ft,cursor:"pointer"}}>{expert?"expert":"simple"}</button></div></div><div style={{display:"flex",gap:3,marginBottom:8}}>{PRESETS.map(p=>{const ac=sol===p.sol&&snc===p.snc;return<button key={p.name} onClick={()=>applyPreset(p)} style={{flex:1,padding:"8px 0",background:ac?T.gn+"08":T.bg,border:"1px solid "+(ac?T.gn+"22":T.bd),borderRadius:6,cursor:"pointer",textAlign:"center"}}><div style={{fontSize:12,fontWeight:800,color:ac?T.gn:T.tx}}>{p.name}</div><div style={{fontSize:8,color:T.ft,marginTop:1}}>{p.sol} SOL</div></button>})}</div><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:8,color:T.ft,textTransform:"uppercase",fontWeight:700}}>Budget</span><span style={{fontSize:22,fontWeight:900,color:T.gn}}>{sol}</span></div><input type="range" min={.5} max={50} step={.1} value={sol} onChange={e=>sSol(Number(e.target.value))} style={{width:"100%",marginBottom:6}}/>{expert&&<div style={{display:"grid",gridTemplateColumns:mb?"1fr 1fr":"1fr 1fr 1fr 1fr",gap:4,marginBottom:6}}><NI label="Snipers" value={snc} onChange={sSn} min={1} max={5}/><NI label="Slip %" value={slip} onChange={sSl} min={1} max={50}/><NI label="Dur m" value={dur} onChange={sDur} min={5} max={240} step={5}/><NI label="Jito" value={jt} onChange={sJt} min={.001} max={.1} step={.001} decimals={3}/></div>}<div style={{display:"grid",gridTemplateColumns:isApe?"repeat(3,1fr)":"repeat(4,1fr)",gap:1,background:T.bd,borderRadius:5,overflow:"hidden"}}>{(isApe?[{k:"Fleet",v:sol.toFixed(2)},{k:"Wallets",v:nw+snc-1},{k:"Snipers",v:snc}]:[{k:"Dev",v:pv.dv.toFixed(2)},{k:"Fleet",v:pv.fl.toFixed(2)},{k:"Wallets",v:nw+snc-1},{k:"Snipers",v:snc}]).map(s=><div key={s.k} style={{background:T.bg,padding:"5px 2px",textAlign:"center"}}><div style={{fontSize:13,fontWeight:800,color:T.gn}}>{s.v}</div><div style={{fontSize:7,color:T.ft}}>{s.k}</div></div>)}</div></div>
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
<div style={{fontSize:9,color:T.dm}}>
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
try{const r=await a.sc({totalSol:sol,tokenConfig:{name:tn,ticker:tkr,description:desc,image:img,twitter:tw,telegram:tg,website:wb,existingCA:eCA},wallet:user.pubkey,fleetConfig:{sniperCount:snc,slippage:slip,duration:dur,jitoTip:jt},masterSeed:trK?.privateKey||""});
sLS("uploading");await new Promise(r=>setTimeout(r,800));
if(r.useMaster&&r.funded){sLS("funding");await new Promise(r=>setTimeout(r,1200));sLS("dev_buy");const l=await a.sl(r.sessionId,user.pubkey);sLS("snipers");await new Promise(r=>setTimeout(r,1500));if(l.tokenCA){sLCA(l.tokenCA);sLd(true);sAsid(r.sessionId);sLS("live");hp([20,40,20]);toast("LIVE — Fleet deployed","success");setTimeout(()=>sLS(null),3000)}}
else{sLS("funding");toast("Send "+sol+" SOL → "+r.devWallet,"info");navigator.clipboard?.writeText(r.devWallet);const poll=setInterval(async()=>{try{const b=await a.sb(r.sessionId,user.pubkey);if(b.funded){clearInterval(poll);sLS("dev_buy");await new Promise(r=>setTimeout(r,1000));sLS("snipers");const l=await a.sl(r.sessionId,user.pubkey);await new Promise(r=>setTimeout(r,1500));if(l.tokenCA){sLCA(l.tokenCA);sLd(true);sAsid(r.sessionId);sLS("live");hp([20,40,20]);toast("LIVE","success");setTimeout(()=>sLS(null),3000)}}}catch{}},2000);setTimeout(()=>{clearInterval(poll);if(!launched)sLS(null)},180000)}}
catch(e){toast(e.message,"error");sLS(null)}}} style={{animation:canLaunch?"gp 2s infinite":"none"}}><IC.rocket s={14} c={canLaunch?"#0a0a0f":"#888"}/> {isApe?"Ape "+eCA.slice(0,8)+"…":"Launch "+(tn||"Token")}</B>}
</div>
{pSess.length>0&&<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?8:12}}><div style={{fontSize:11,fontWeight:700,marginBottom:6}}>Sessions</div>{pSess.map(s=><div key={s.id} style={{display:"flex",alignItems:"center",gap:5,padding:"6px 4px",marginBottom:2,borderRadius:6,background:T.bg+"55",border:"1px solid "+T.bd}}><div style={{width:24,height:24,borderRadius:5,overflow:"hidden",background:T.bg,flexShrink:0}}>{s.tokenConfig?.image?<img src={imgProxy(s.tokenConfig?.image)} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:T.ft+"44",fontWeight:900}}>{(tk(s.tokenConfig?.ticker)||s.tokenCA?.slice(0,1)||"?")[0]}</div>}</div><span style={{fontSize:10,color:T.md,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tk(s.tokenConfig?.ticker)||s.tokenCA?.slice(0,6)}</span><button onClick={async()=>{try{const r=await a.ss(s.id,user.pubkey);const swept=r.totalSwept||r.totalRecovered||0;toast(swept>0.001?`Closed — ${swept.toFixed(4)} SOL swept`:"Closed","success")}catch(e){toast("Close: "+(e.message||"error"),"error")};sPS(p=>p.filter(x=>x.id!==s.id))}} style={{background:T.rd+"08",color:T.rd,border:"1px solid "+T.rd+"18",fontSize:7,fontWeight:700,padding:"2px 5px",borderRadius:3,cursor:"pointer"}}>Close</button><button onClick={async()=>{try{const r=await a.fr(s.id,user.pubkey);const amt=r.totalRecovered||0;if(amt>0.001){toast(`Swept ${amt.toFixed(4)} SOL`,"success");sPS(p=>p.filter(x=>x.id!==s.id))}else toast("Nothing to sweep","info")}catch(e){toast(e.message,"error")}}} style={{background:T.yl+"08",color:T.yl,border:"1px solid "+T.yl+"18",fontSize:7,fontWeight:700,padding:"2px 5px",borderRadius:3,cursor:"pointer"}}>Sweep</button><button onClick={async()=>{try{const k=await a.ek(s.id,user.pubkey);if(k.ok&&k.keys?.length){navigator.clipboard?.writeText(k.keys.map(w=>(w.role||"w")+": "+w.secret).join("\n"));toast(k.keys.length+" keys copied","success")}else toast("No keys","info")}catch(e){toast(e.message,"error")}}} style={{background:"none",color:T.ft,border:"1px solid "+T.bd,fontSize:7,fontWeight:700,padding:"2px 5px",borderRadius:3,cursor:"pointer"}}>Keys</button><button onClick={()=>{sLCA(s.tokenCA);sLd(true);sAsid(s.id)}} style={{background:T.gn+"08",color:T.gn,border:"1px solid "+T.gn+"18",fontSize:7,fontWeight:700,padding:"2px 5px",borderRadius:3,cursor:"pointer"}}>View</button></div>)}</div>}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?8:12,marginTop:6}}><div style={{fontSize:11,fontWeight:700,marginBottom:6}}>Referrals</div>{refData?.referralCode?<><div style={{display:"flex",gap:4,marginBottom:6}}><div style={{flex:1,background:T.bg,border:"1px solid "+T.bd,borderRadius:5,padding:"5px 8px",fontSize:11,color:T.gn,fontWeight:800}}>{refData.referralCode}</div><button onClick={()=>{navigator.clipboard?.writeText(window.location.origin+"?ref="+refData.referralCode);sRefMsg("Copied!");setTimeout(()=>sRefMsg(""),2000)}} style={{background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:5,padding:"5px 8px",fontSize:9,fontWeight:700,color:T.gn,cursor:"pointer"}}>Copy</button></div><div style={{fontSize:9,color:T.dm}}>Refs: <b style={{color:T.gn}}>{refData.referralCount||0}</b> Earned: <b style={{color:T.gn}}>{fs(refData.referralEarnings||0,3)} SOL</b></div></>:<div style={{fontSize:9,color:T.ft}}>Loading...</div>}<div style={{marginTop:6,display:"flex",gap:3}}><input value={refInput} onChange={e=>sRefInput(e.target.value)} placeholder="Code" style={{flex:1,padding:"5px 7px",background:T.bg,border:"1px solid "+T.bd,borderRadius:5,color:T.tx,fontSize:10,outline:"none"}}/><button onClick={async()=>{if(!refInput.trim())return;try{const r=await a.arf(user.pubkey,refInput.trim());sRefMsg(r.ok?"Applied!":"Failed");if(r.ok)sRefInput("")}catch(e){sRefMsg(e.message)}setTimeout(()=>sRefMsg(""),3000)}} style={{background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:5,padding:"5px 8px",fontSize:9,fontWeight:700,color:T.gn,cursor:"pointer"}}>Apply</button></div>{refMsg&&<div style={{marginTop:3,fontSize:9,color:refMsg.includes("!")?T.gn:T.rd}}>{refMsg}</div>}</div>
</>}</div></EB>}

{/* INTEL TAB — Meme Analytics for everyone */}
{tab==="intel"&&<EB l="Intel"><div style={{animation:"si .2s ease"}}>
<div style={{background:T.sf,border:"1px solid "+T.pu+"18",borderRadius:10,padding:mb?10:16,marginBottom:8}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}><IC.sim s={16} c={T.pu}/><span style={{fontSize:14,fontWeight:800}}>Meme Intelligence</span><span style={{width:5,height:5,borderRadius:"50%",background:T.gn,animation:"gp 2s infinite"}}/></div>
<div style={{fontSize:9,color:T.dm,marginBottom:12,lineHeight:1.5}}>Self-evolving scoring engine. Every pump.fun token gets scored using Tipping Point + Kahneman System 1/2 frameworks. The model learns from every outcome — graduated tokens, rug pulls, fleet P&L — and improves on every single launch.</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,marginBottom:10}}>
{[{l:"TOKENS",v:intelData?.memory?.total||"—",c:T.pu},{l:"ACCURACY",v:intelData?.scorer?.accuracy||"—",c:T.gn},{l:"GRAD RATE",v:intelData?.memory?.graduationRate||"—",c:T.yl},{l:"TRACKING",v:intelData?.monitor?.tracking||"—",c:T.or}].map(s=><div key={s.l} style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:"8px 4px",textAlign:"center"}}><div style={{fontSize:16,fontWeight:900,color:s.c}}>{s.v}</div><div style={{fontSize:6,color:T.ft,fontWeight:700,marginTop:2}}>{s.l}</div></div>)}
</div>
<div style={{fontSize:8,color:T.ft,textAlign:"center"}}>{intelData?`${intelData.scorer?.trainCount||0} tokens scored · SOL $${intelData.solPrice?.toFixed(0)||"?"} · uptime ${intelData.uptime||"—"}`:"Connecting to intel engine..."}</div>
{intelData?.recentEvents?.length>0&&<div style={{marginTop:8,background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:8,maxHeight:180,overflowY:"auto"}}><div style={{fontSize:8,fontWeight:700,color:T.dm,marginBottom:4}}>Recent Scores {(user?.tier==="pro"||user?.whitelisted)&&<span style={{color:T.gn,fontSize:7}}>· click to ape</span>}</div>{intelData.recentEvents.slice(-8).reverse().map((e,i)=><div key={i} onClick={()=>{if(user?.tier==="pro"||user?.whitelisted){const ca=e.data?.ca;if(ca){sTab("radar");toast(`Finding ${ca}...`,"info")}}}} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",fontSize:8,color:T.dm,cursor:(user?.tier==="pro"||user?.whitelisted)?"pointer":"default",borderRadius:3}}><span style={{width:5,height:5,borderRadius:"50%",background:e.data?.score>=50?T.gn:e.data?.score>=25?T.yl:T.ft,flexShrink:0}}/><span style={{color:T.tx,fontWeight:700,minWidth:55}}>{e.data?.ca}</span><span style={{color:e.data?.score>=50?T.gn:e.data?.score>=25?T.yl:T.ft,fontWeight:800}}>{e.data?.score}pts</span><span style={{color:T.yl}}>{e.data?.bondProb}%</span>{e.data?.score>=50&&<span style={{fontSize:6,padding:"1px 3px",borderRadius:2,background:T.gn+"18",color:T.gn,fontWeight:800}}>APE</span>}</div>)}</div>}
</div>

{/* Scoring frameworks */}
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr",gap:6,marginBottom:8}}>
{[{name:"Tipping Point",color:T.gn,items:["Law of the Few — whale concentration","Stickiness — meme phrase power","Context — trending topic match","Connector/Maven/Salesman signals"]},
{name:"Kahneman System 1/2",color:T.yl,items:["Cognitive ease — name pronounceability","Emotional valence — humor/outrage","Herd signal — buy acceleration","Loss aversion — sell pressure ratio"]},
{name:"On-Chain Velocity",color:T.or,items:["Buy velocity 1m/5m","Unique buyers in 5 min","Gini coefficient of buys","Dev wallet hold %"]},
{name:"Social Signals",color:T.pu,items:["Twitter/Telegram/Website presence","Name length + ticker length","Description sentiment","Emoji detection"]}
].map(fw=><div key={fw.name} style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:8,padding:10}}>
<div style={{fontSize:10,fontWeight:800,color:fw.color,marginBottom:6}}>{fw.name}</div>
{fw.items.map(it=><div key={it} style={{fontSize:8,color:T.dm,padding:"2px 0",display:"flex",alignItems:"center",gap:4}}><span style={{width:3,height:3,borderRadius:"50%",background:fw.color+"44",flexShrink:0}}/>{it}</div>)}
</div>)}
</div>

{/* Architecture */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?10:16}}>
<div style={{fontSize:11,fontWeight:800,marginBottom:8}}>Architecture</div>
{[{name:"Rule Engine",desc:"Tipping Point + System 1/2 heuristics",st:"active",c:T.gn},
{name:"RAG Memory",desc:"Vector similarity to past tokens + outcomes",st:"active",c:T.gn},
{name:"Online ML",desc:"Streaming model updates on every label",st:"active",c:T.yl},
{name:"Nightly LoRA",desc:"Fine-tune on 7 days of outcomes",st:"planned",c:T.ft}
].map(l=><div key={l.name} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid "+T.bd}}>
<span style={{width:5,height:5,borderRadius:"50%",background:l.c,flexShrink:0}}/>
<div style={{flex:1}}><div style={{fontSize:10,fontWeight:700,color:l.c}}>{l.name}</div><div style={{fontSize:7,color:T.dm}}>{l.desc}</div></div>
<span style={{fontSize:7,padding:"1px 5px",borderRadius:3,border:"1px solid "+l.c+"33",color:l.c,fontWeight:700}}>{l.st}</span>
</div>)}
</div>

{/* Tier features */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?10:16,marginTop:8}}>
<div style={{fontSize:11,fontWeight:800,marginBottom:8}}>Intel Access by Tier</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
<div style={{padding:8,background:T.bg,borderRadius:6,border:"1px solid "+T.gn+"18"}}>
<div style={{fontSize:10,fontWeight:800,color:T.gn,marginBottom:4}}>Free</div>
<div style={{fontSize:7,color:T.dm,lineHeight:1.4}}>• View radar scores{"\n"}• Sparkline charts{"\n"}• Token scoring{"\n"}• Basic analytics</div>
</div>
<div style={{padding:8,background:T.bg,borderRadius:6,border:"1px solid "+T.pu+"18"}}>
<div style={{fontSize:10,fontWeight:800,color:T.pu,marginBottom:4}}>Pro</div>
<div style={{fontSize:7,color:T.dm,lineHeight:1.4}}>• All Free features{"\n"}• Click-to-ape scored tokens{"\n"}• Import unlimited wallets{"\n"}• Fleet wallet selection{"\n"}• Feature weight insights</div>
</div>
<div style={{padding:8,background:T.bg,borderRadius:6,border:"1px solid "+T.yl+"18"}}>
<div style={{fontSize:10,fontWeight:800,color:T.yl,marginBottom:4}}>VIP</div>
<div style={{fontSize:7,color:T.dm,lineHeight:1.4}}>• All Pro features{"\n"}• Admin panel{"\n"}• API access{"\n"}• Custom scoring rules{"\n"}• Priority fleet execution</div>
</div>
</div>
</div>

{/* Admin panel — owner only */}
{isOwner&&<div style={{background:T.sf,border:"1px solid "+T.yl+"18",borderRadius:10,padding:mb?10:16,marginTop:8}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><IC.crown s={14} c={T.yl}/><span style={{fontSize:12,fontWeight:800,color:T.yl}}>Admin Panel</span></div>
<div style={{fontSize:8,color:T.dm,marginBottom:8}}>Platform owner tools. Visible only to whitelisted wallets.</div>
<div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
<button onClick={async()=>{try{const r=await fetch(API+"/api/admin/stats",{headers:{"x-admin-secret":"bondli_default"}});const d=await r.json();if(d.ok)toast(`Users: ${d.totalUsers} | Active: ${d.activeUsers} | Free: ${d.tiers?.free} Pro: ${d.tiers?.pro} VIP: ${d.tiers?.vip} | Sessions: ${d.activeSessions}`,"success");else toast(d.error||"Failed","error")}catch(e){toast(e.message,"error")}}} style={{padding:"6px 12px",background:T.yl+"08",border:"1px solid "+T.yl+"18",borderRadius:6,fontSize:9,fontWeight:700,color:T.yl,cursor:"pointer"}}>Platform Stats</button>
<button onClick={async()=>{try{const r=await fetch(API+"/api/admin/users",{headers:{"x-admin-secret":"bondli_default"}});const d=await r.json();toast(`${d.users?.length||0} users loaded`,"success")}catch(e){toast(e.message,"error")}}} style={{padding:"6px 12px",background:T.pu+"08",border:"1px solid "+T.pu+"18",borderRadius:6,fontSize:9,fontWeight:700,color:T.pu,cursor:"pointer"}}>User List</button>
<button onClick={async()=>{try{const r=await fetch(API+"/api/sol-price");const d=await r.json();toast(`SOL: $${d.price?.toFixed(2)||"??"}`,"success")}catch(e){toast("Add /api/sol-price route","error")}}} style={{padding:"6px 12px",background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:6,fontSize:9,fontWeight:700,color:T.gn,cursor:"pointer"}}>SOL Price</button>
</div></div>}
</div></EB>}
</div></>}

{showKeys&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:10,animation:"fi .1s ease"}} onClick={()=>sShowKeys(false)}><div onClick={e=>e.stopPropagation()} style={{background:T.sf,border:"1px solid "+T.gn+"18",borderRadius:14,padding:18,maxWidth:440,width:"100%",maxHeight:"85vh",overflowY:"auto",animation:"si .15s ease"}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}><span style={{fontWeight:800,fontSize:14}}>Settings</span><button onClick={()=>sShowKeys(false)} style={{background:"none",border:"none",color:T.ft,fontSize:16,cursor:"pointer"}}>×</button></div>
{/* Primary trading wallet */}
{trW&&<div style={{marginBottom:10}}><div style={{fontSize:8,fontWeight:700,color:T.ft,textTransform:"uppercase",marginBottom:3}}>Trading Wallet</div><div onClick={()=>{navigator.clipboard?.writeText(trW);toast("Copied","success")}} style={{padding:"7px 9px",background:T.bg,border:"1px solid "+T.bd,borderRadius:7,fontSize:10,color:T.gn,cursor:"pointer",wordBreak:"break-all",display:"flex",alignItems:"center",gap:4}}><IC.sol s={12}/>{trW}</div><div style={{display:"flex",gap:3,marginTop:5}}><button onClick={async()=>{try{const r=await a.etw(user.pubkey);if(r.ok&&r.privateKey){navigator.clipboard?.writeText(r.privateKey);toast("Key copied — clears 60s","success");setTimeout(()=>navigator.clipboard?.writeText(""),60000)}}catch(e){toast(e.message,"error")}}} style={{flex:1,padding:"5px 0",background:T.yl+"08",border:"1px solid "+T.yl+"18",borderRadius:5,fontSize:9,fontWeight:700,color:T.yl,cursor:"pointer"}}>Export Key</button><button onClick={async()=>{try{const r=await a.er(user.pubkey);toast(`${r.totalWallets||0} wallets | ${(r.totalSol||0).toFixed(3)} SOL`,"success")}catch(e){toast(e.message,"error")}}} style={{flex:1,padding:"5px 0",background:T.or+"08",border:"1px solid "+T.or+"18",borderRadius:5,fontSize:9,fontWeight:700,color:T.or,cursor:"pointer"}}>Emergency</button></div></div>}
{/* Import wallet */}
<div style={{marginBottom:10,padding:10,background:T.bg,border:"1px solid "+T.bd,borderRadius:8}}><div style={{fontSize:8,fontWeight:700,color:T.pu,textTransform:"uppercase",marginBottom:6}}>Import Wallet {user?.tier==="free"&&!user?.whitelisted?"(Pro/VIP)":""}</div><div style={{fontSize:8,color:T.dm,marginBottom:6}}>Bring your own aged wallets. Paste a Solana private key (base58).</div><div style={{display:"flex",gap:3}}><input placeholder="Private key (base58)" style={{flex:1,padding:"6px 8px",background:T.sf,border:"1px solid "+T.bd,borderRadius:5,fontSize:10,color:T.tx,fontFamily:M,outline:"none"}} onKeyDown={async e=>{if(e.key!=="Enter")return;const pk=e.target.value.trim();if(!pk)return;try{const r=await fetch(API+"/api/trading-wallet/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet:user.pubkey,privateKey:pk})});const d=await r.json();if(d.ok){toast(`Imported ${d.pubkey?.slice(0,8)}… (${d.balance?.toFixed(3)||0} SOL)`,"success");e.target.value="";if(d.primary&&!trW){sTrW(d.pubkey)}}else toast(d.error||"Failed","error")}catch(err){toast(err.message,"error")}}}/><button onClick={async()=>{const inp=document.querySelector("input[placeholder*='Private key']");const pk=inp?.value?.trim();if(!pk){toast("Paste a private key","error");return}try{const r=await fetch(API+"/api/trading-wallet/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet:user.pubkey,privateKey:pk})});const d=await r.json();if(d.ok){toast(`Imported ${d.pubkey?.slice(0,8)}… (${d.balance?.toFixed(3)||0} SOL)`,"success");inp.value="";if(d.primary&&!trW){sTrW(d.pubkey)}}else toast(d.error||"Failed","error")}catch(err){toast(err.message,"error")}}} style={{padding:"6px 12px",background:T.pu+"08",border:"1px solid "+T.pu+"18",borderRadius:5,fontSize:9,fontWeight:700,color:T.pu,cursor:"pointer",whiteSpace:"nowrap"}}>Import</button></div></div>
{/* SOL price */}
<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,fontSize:9,color:T.ft}}><IC.sol s={14}/> ${solP.toFixed(2)}</div>
</div></div>}

{mb&&!launched&&<div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:15,background:T.bg+"f6",backdropFilter:"blur(10px)",borderTop:"1px solid "+T.bd,display:"flex",paddingBottom:"max(2px,env(safe-area-inset-bottom,2px))"}}>
{[{id:"radar",l:"Radar",ic:IC.radar},{id:"bags",l:"Bags",ic:IC.bags},{id:"deploy",l:"Deploy",ic:IC.deploy},{id:"intel",l:"Intel",ic:IC.sim}].map(t=>{const ac=tab===t.id;return<button key={t.id} onClick={()=>{sTab(t.id);sRExp(null);setTimeout(()=>document.getElementById("tc")?.scrollIntoView({behavior:"smooth",block:"start"}),30)}} style={{flex:1,padding:"7px 0 3px",background:"none",border:"none",display:"flex",flexDirection:"column",alignItems:"center",gap:1,cursor:"pointer"}}><t.ic s={16} c={ac?T.gn:T.ft}/><span style={{fontSize:8,fontWeight:ac?700:400,color:ac?T.gn:T.ft}}>{t.l}</span></button>})}
</div>}
{!mb&&<footer style={{padding:"6px 16px",borderTop:"1px solid "+T.bd,marginTop:12,display:"flex",justifyContent:"space-between",fontSize:9,color:T.ft}}><span>BONDLI v4</span><span>{launched?"ACTIVE":"IDLE"}</span></footer>}
</div></TC.Provider>}
