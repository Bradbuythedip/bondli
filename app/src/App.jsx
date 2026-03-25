import React,{useState,useEffect,useRef,useCallback,Component,useMemo}from"react";
import{TC,D,L,css,uT}from"./lib/t.js";
import{M,S,API,WS_URL}from"./lib/c.js";
import{hW,wN,fm,fs,tp,dbp,wc,hp}from"./lib/u.js";
import{useSolPrice}from"./hooks/useSolPrice.js";
import{createChart,ColorType,CrosshairMode}from"lightweight-charts";
import a from"./lib/a.js";
const uM=()=>{const[m,s]=useState(()=>typeof window!=="undefined"&&window.innerWidth<700);useEffect(()=>{const q=window.matchMedia("(max-width:700px)");const h=e=>s(e.matches);q.addEventListener("change",h);s(q.matches);return()=>q.removeEventListener("change",h)},[]);return m};
class EB extends Component{constructor(p){super(p);this.state={e:null}}static getDerivedStateFromError(e){return{e}}render(){if(this.state.e)return<div style={{padding:12,margin:6,borderRadius:8,background:"#ff174406",textAlign:"center"}}><span style={{fontFamily:M,fontSize:15,color:"#ff1744"}}>{this.props.l} error </span><button onClick={()=>this.setState({e:null})} style={{marginLeft:6,padding:"4px 12px",borderRadius:5,background:"none",border:"1px solid #ff174422",color:"#ff1744",fontFamily:M,fontSize:13,cursor:"pointer"}}>retry</button></div>;return this.props.children}}

// ═══ ICONS ═══
const Logo=({s:z=26})=><svg width={z} height={z*1.3} viewBox="0 0 30 42" style={{filter:"drop-shadow(0 1px 4px rgba(200,20,20,.35))"}}><defs><linearGradient id="bl1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff5555"/><stop offset="50%" stopColor="#dd1818"/><stop offset="100%" stopColor="#881010"/></linearGradient><linearGradient id="bl2" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#ff4040" stopOpacity=".95"/><stop offset="100%" stopColor="#771010" stopOpacity=".9"/></linearGradient></defs><path d="M15,2 Q23,2 26,8 L27,20 L27,22 L26,34 Q23,40 15,40 L15,2 Z" fill="url(#bl1)"/><path d="M15,2 Q7,2 4,8 L3,20 L3,22 L4,34 Q7,40 15,40 L15,2 Z" fill="url(#bl2)"/><text x="15" y="22" textAnchor="middle" dominantBaseline="central" fontFamily="Arial Black,Arial,sans-serif" fontWeight="900" fontSize="14" fill="#fff" opacity=".06">B</text></svg>;
const IC={
radar:({s:z=16,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><circle cx="12" cy="12" r="10" opacity=".2"/><circle cx="12" cy="12" r="6" opacity=".4"/><circle cx="12" cy="12" r="2"/></svg>,
wallet:({s:z=16,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 00-8 0v2"/></svg>,
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
gh:({s:z=12,c="#888"})=><svg width={z} height={z} viewBox="0 0 24 24" fill={c}><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>,
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
bags:({s:z=14,c="#00e676"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/><circle cx="12" cy="14" r="1.5" fill={c}/></svg>,
bonk:({s:z=14,c="#ff9800"})=><svg width={z} height={z} viewBox="0 0 24 24" fill={c}><circle cx="7" cy="9" r="4"/><circle cx="17" cy="9" r="4"/><rect x="7" y="9" width="10" height="3" rx="1.5"/><circle cx="12" cy="16" r="5"/><circle cx="10" cy="15" r="1" fill="#000"/><circle cx="14" cy="15" r="1" fill="#000"/><ellipse cx="12" cy="17.5" rx="1.5" ry="1" fill="#000"/></svg>,
brain:({s:z=20,c="#b388ff"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="14" rx="7" ry="8"/><path d="M5 10c-1-3 0-6 2-8"/><path d="M19 10c1-3 0-6-2-8"/><path d="M7 7c1-1 2-2 3-2"/><path d="M17 7c-1-1-2-2-3-2"/><circle cx="9.5" cy="12" r="1" fill={c}/><circle cx="14.5" cy="12" r="1" fill={c}/><ellipse cx="12" cy="15.5" rx="1.5" ry="1" fill={c}/><path d="M10 17.5c.8.6 1.5.8 2 .8s1.2-.2 2-.8"/></svg>,
bulb:({s:z=20,c="#b388ff"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/><path d="M12 6v4"/><path d="M10 8h4"/></svg>,
chart:({s:z=20,c="#00e676"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><line x1="16" y1="7" x2="22" y2="7"/><line x1="22" y1="7" x2="22" y2="13"/></svg>,
scan:({s:z=20,c="#00bcd4"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round"><path d="M3 7V5a2 2 0 012-2h2"/><path d="M17 3h2a2 2 0 012 2v2"/><path d="M21 17v2a2 2 0 01-2 2h-2"/><path d="M7 21H5a2 2 0 01-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="M12 5v2M12 17v2M5 12h2M17 12h2"/></svg>,
bolt:({s:z=20,c="#ffd600"})=><svg width={z} height={z} viewBox="0 0 24 24" fill={c} stroke="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
fleet:({s:z=20,c="#ff1744"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><circle cx="12" cy="16" r="3"/><path d="M10.5 9.5l1 4.5M13.5 9.5l-1 4.5M5.5 9.5l4.5 5M18.5 9.5l-4.5 5"/></svg>,
eye:({s:z=20,c="#ff9800"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><path d="M12 5v-.5M12 19v.5" strokeDasharray="2 2"/></svg>,
gpu:({s:z=20,c="#00e676"})=><svg width={z} height={z} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/><path d="M7 8h2v4H7zM11 8h2v4h-2zM15 8h2v4h-2"/></svg>,
nos:({s:z=20,c="#10E80C"})=><svg width={z} height={z} viewBox="0 -0.2 34.1 29.8" fill="none"><path d="M9.567 2.727C9.057 1.732 8.22.935 7.188.464 6.157-.007 4.994-.123 3.887.133 2.78.389 1.793 1.003 1.088 1.876.382 2.749-.001 3.83 0 4.941V29.356H3.336V4.941c.006-.374.14-.736.38-1.028.24-.292.573-.498.946-.584.373-.086.765-.049 1.113.107.349.156.634.421.811.753L17.827 26.095h-3.732L8.235 14.68H4.502l7.537 14.677h11.197L9.567 2.727Z" fill={c}/><path d="M30.696.002V24.417c-.007.374-.141.734-.381 1.025-.24.291-.572.496-.944.582-.372.086-.764.049-1.112-.107-.348-.155-.634-.42-.811-.749L16.208 3.263h3.733l5.86 11.416h3.733L21.999.002H10.802l13.664 26.63c.51.993 1.348 1.79 2.379 2.26 1.031.47 2.194.587 3.301.33 1.107-.256 2.093-.87 2.799-1.742.706-.872 1.09-1.951 1.09-3.063V.002h-3.34Z" fill={c}/></svg>,
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
function NI({label,value,onChange,min,max,step:s=1,decimals:d}){const T=uT();return<div style={{background:T.bg,borderRadius:8,border:"1px solid "+T.bd,padding:"8px 10px"}}><div style={{fontSize:13,fontFamily:M,fontWeight:700,color:T.ft,textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>{label}</div><div style={{display:"flex"}}><button onClick={(ev)=>{hp([3],ev);onChange(Math.max(min,parseFloat((value-s).toFixed(6))))}} style={{width:32,height:32,borderRadius:"5px 0 0 5px",border:"1px solid "+T.bd,background:T.sf,color:T.dm,fontSize:16,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>−</button><div style={{flex:1,height:32,display:"flex",alignItems:"center",justifyContent:"center",background:T.sf,borderTop:"1px solid "+T.bd,borderBottom:"1px solid "+T.bd,fontFamily:M,fontSize:16,fontWeight:800,color:T.gn}}>{d!=null?value.toFixed(d):(s<1?parseFloat(value.toFixed(2)):value)}</div><button onClick={(ev)=>{hp([3],ev);onChange(Math.min(max,parseFloat((value+s).toFixed(6))))}} style={{width:32,height:32,borderRadius:"0 5px 5px 0",border:"1px solid "+T.bd,background:T.sf,color:T.dm,fontSize:16,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>+</button></div></div>}
function ImgUp({image,onChange,mb}){const T=uT(),ref=useRef(null);const read=f=>{const r=new FileReader();r.onload=()=>onChange(r.result);r.readAsDataURL(f)};return<div onClick={()=>ref.current?.click()} onDrop={e=>{e.preventDefault();if(e.dataTransfer.files[0])read(e.dataTransfer.files[0])}} onDragOver={e=>e.preventDefault()} style={{width:mb?88:110,height:mb?88:110,borderRadius:10,border:"1px dashed "+(image?T.gn+"33":T.bd),background:image?"url("+image+") center/cover":T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,cursor:"pointer",flexShrink:0,position:"relative"}}>{!image&&<><IC.upload s={22} c={T.dm}/><span style={{fontSize:11,color:T.ft,fontFamily:M}}>512x512</span></>}<input ref={ref} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{if(e.target.files?.[0])read(e.target.files[0])}}/></div>}
const tk=s=>s?s.replace(/^\$/,""):s||"";
const solFmt=n=>n<.01?"<0.01":n<100?n.toFixed(2):Math.round(n)+"";
const kFmt=n=>n>=10000?(n/1000).toFixed(1).replace(/\.0$/,"")+"k":n>=1000?(n/1000).toFixed(1)+"k":n+"";
// Image proxy: route ALL external images through backend to avoid CORS/blocking
const imgProxy=u=>!u?"":u.startsWith("data:")?u:u.startsWith("/")?u:API+"/api/img?url="+encodeURIComponent(u);

// ═══ IMAGE PRELOADER CACHE ═══
// Eagerly loads images via hidden Image objects so they're in browser cache
// before any <img> tag tries to render them. Retries failures 3x.
// Failed images expire after 30s so they can be retried on next poll.
const imgCache=new Map(); // url -> "loading" | "ok" | {fail:timestamp}
function preloadImg(rawUrl){if(!rawUrl)return;const url=imgProxy(rawUrl);const cached=imgCache.get(url);if(cached==="ok"||cached==="loading")return;if(cached&&cached.fail&&Date.now()-cached.fail<30000)return;imgCache.set(url,"loading");const load=(attempt)=>{const img=new Image();img.onload=()=>{imgCache.set(url,"ok")};img.onerror=()=>{if(attempt<3){setTimeout(()=>load(attempt+1),600*(attempt+1))}else{imgCache.set(url,{fail:Date.now()})}};img.src=attempt>0?url+"&_r="+attempt+"&_t="+Date.now():url};load(0)}
function preloadTokenImages(tokens){if(!tokens?.length)return;tokens.forEach(t=>{if(t.image)preloadImg(t.image)})}

// Resilient token image component — uses preloaded cache, retries on failure
// Shows blurred placeholder that sharpens when loaded
function TImg({src,ticker,size,style:sx={}}){const[ok,sOk]=useState(true);const[loaded,sLoaded]=useState(()=>{const url=imgProxy(src);return imgCache.get(url)==="ok"});const[retries,sR]=useState(0);const proxyUrl=imgProxy(src);const letter=(tk(ticker)||"?")[0];const fallback=<div style={{width:size,height:size,display:"flex",alignItems:"center",justifyContent:"center",fontSize:Math.max(12,size*.35),color:"#3a3a50"+"33",fontWeight:900,background:"linear-gradient(135deg,#1a1a2e 0%,#16162a 100%)",...sx}}>{letter}</div>;if(!src||!ok)return fallback;return<div style={{width:size,height:size,position:"relative",overflow:"hidden",borderRadius:"inherit",...sx}}>{!loaded&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:Math.max(12,size*.35),color:"#3a3a50"+"33",fontWeight:900,background:"linear-gradient(135deg,#1a1a2e 0%,#16162a 100%)",zIndex:1}}>{letter}</div>}<img src={retries>0?proxyUrl+"&_r="+retries+"&_t="+Date.now():proxyUrl} crossOrigin="anonymous" style={{width:"100%",height:"100%",objectFit:"cover",filter:loaded?"blur(0)":"blur(12px)",opacity:loaded?1:.6,transform:loaded?"scale(1)":"scale(1.1)",transition:"filter .4s ease,opacity .4s ease,transform .4s ease"}} alt="" onLoad={()=>{sLoaded(true);imgCache.set(proxyUrl,"ok")}} onError={()=>{if(retries<3)setTimeout(()=>sR(r=>r+1),500*(retries+1));else sOk(false)}}/></div>}
// MC correction: recalculate USD from SOL mcap with live SOL price
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
<div style={{fontSize:12,fontWeight:900,color:acc>0?T.gn:acc<-0.01?T.rd:T.ft}}>{acc!=null?(acc>0?"+":"")+acc.toFixed(2):"—"}</div>
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

// ═══ CANDLESTICK CHART — lightweight-charts OHLC + volume ═══
function CandleChart({ca,T,mb}){
const containerRef=useRef(null);
const chartRef=useRef(null);
const [err,setErr]=useState(null);
const [interval,setInterval_]=useState(15);

useEffect(()=>{
  if(!containerRef.current||!ca)return;
  setErr(null);
  const isDark=T.mo==="dark";

  // Create chart
  const chart=createChart(containerRef.current,{
    width:containerRef.current.clientWidth,
    height:mb?220:300,
    layout:{
      background:{type:ColorType.Solid,color:"transparent"},
      textColor:T.dm,
      fontSize:10,
      fontFamily:"inherit",
    },
    grid:{
      vertLines:{color:T.bd},
      horzLines:{color:T.bd},
    },
    crosshair:{
      mode:CrosshairMode.Normal,
      vertLine:{color:T.gn+"44",width:1,style:3,labelBackgroundColor:T.sf},
      horzLine:{color:T.gn+"44",width:1,style:3,labelBackgroundColor:T.sf},
    },
    rightPriceScale:{
      borderColor:T.bd,
      scaleMargins:{top:0.1,bottom:0.25},
    },
    timeScale:{
      borderColor:T.bd,
      timeVisible:true,
      secondsVisible:true,
      rightOffset:2,
      barSpacing:mb?6:8,
    },
    handleScroll:true,
    handleScale:true,
  });
  chartRef.current=chart;

  // Candlestick series
  const candleSeries=chart.addCandlestickSeries({
    upColor:T.gn,
    downColor:T.rd,
    borderUpColor:T.gn,
    borderDownColor:T.rd,
    wickUpColor:T.gn+"aa",
    wickDownColor:T.rd+"aa",
  });

  // Volume series (bottom overlay)
  const volumeSeries=chart.addHistogramSeries({
    priceFormat:{type:"volume"},
    priceScaleId:"vol",
  });
  chart.priceScale("vol").applyOptions({
    scaleMargins:{top:0.8,bottom:0},
  });

  // Fetch data
  fetch(`${API}/api/chart/${ca}?interval=${interval}`).then(r=>r.json()).then(d=>{
    if(!d.candles?.length){setErr("No chart data yet");return}

    candleSeries.setData(d.candles.map(c=>({
      time:c.time,
      open:c.open,
      high:c.high,
      low:c.low,
      close:c.close,
    })));

    volumeSeries.setData(d.candles.map(c=>({
      time:c.time,
      value:c.volume||0,
      color:c.close>=c.open?T.gn+"33":T.rd+"33",
    })));

    chart.timeScale().fitContent();
  }).catch(()=>setErr("Chart load failed"));

  // Auto-refresh every 10s
  const iv=setInterval(()=>{
    fetch(`${API}/api/chart/${ca}?interval=${interval}`).then(r=>r.json()).then(d=>{
      if(!d.candles?.length)return;
      candleSeries.setData(d.candles.map(c=>({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close})));
      volumeSeries.setData(d.candles.map(c=>({time:c.time,value:c.volume||0,color:c.close>=c.open?T.gn+"33":T.rd+"33"})));
    }).catch(()=>{});
  },10000);

  // Resize observer
  const ro=new ResizeObserver(entries=>{
    const{width}=entries[0].contentRect;
    chart.applyOptions({width});
  });
  ro.observe(containerRef.current);

  return()=>{clearInterval(iv);ro.disconnect();chart.remove();chartRef.current=null};
},[ca,T,mb,interval]);

return<div style={{width:"100%",borderRadius:6,overflow:"hidden",background:T.bg}}>
<div ref={containerRef} style={{width:"100%",minHeight:mb?220:300}}>
  {err&&<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:mb?220:300,color:T.dm,fontSize:12}}>{err}</div>}
</div>
<div style={{display:"flex",gap:4,padding:"4px 8px",borderTop:"1px solid "+T.bd,alignItems:"center",flexWrap:"wrap"}}>
  <div style={{display:"flex",gap:2}}>
    {[5,15,30,60].map(s=><button key={s} onClick={()=>setInterval_(s)} style={{fontSize:10,fontWeight:interval===s?800:500,color:interval===s?T.gn:T.dm,background:interval===s?T.gn+"12":"transparent",border:"1px solid "+(interval===s?T.gn+"33":T.bd),borderRadius:4,padding:"2px 6px",cursor:"pointer"}}>{s}s</button>)}
  </div>
  <div style={{flex:1}}/>
  <a href={`https://pump.fun/coin/${ca}`} target="_blank" rel="noopener" style={{fontSize:11,color:T.gn,textDecoration:"none",fontWeight:700}}>pump.fun</a>
  <a href={`https://dexscreener.com/solana/${ca}`} target="_blank" rel="noopener" style={{fontSize:11,color:T.dm,textDecoration:"none"}}>dexscreener</a>
</div></div>}

// ═══ MEMETIC SPIDER CHART ═══
const MEME_MODS={linguistic:{label:"Linguistic",color:"#00e676"},visual:{label:"Visual",color:"#ff9100"},cultural:{label:"Cultural",color:"#ffd600"},community:{label:"Community",color:"#18ffff"},influencer:{label:"Influencer",color:"#b388ff"},absurdity:{label:"Absurdity",color:"#ff1744"},temporal:{label:"Temporal",color:"#e040fb"}};
const ARCH_COLORS={organic_runner:"#00e676",cultural_catalyst:"#ff9100",camp_absurdist:"#b388ff",influencer_cascade:"#18ffff",rug_signal:"#ff1744",noise:"#5c5c7a"};
const ARCH_LABELS={organic_runner:"Organic Runner",cultural_catalyst:"Cultural Catalyst",camp_absurdist:"Camp / Absurdist",influencer_cascade:"Influencer Cascade",rug_signal:"Rug Signal",noise:"Noise"};
function MemeSpider({scores={},size=180,T:theme}){
const keys=Object.keys(MEME_MODS);const cx=size/2,cy=size/2,r=size*0.36;const step=(2*Math.PI)/keys.length;
const pt=(i,v)=>{const a=step*i-Math.PI/2;return{x:cx+r*v*Math.cos(a),y:cy+r*v*Math.sin(a)}};
const pts=keys.map((k,i)=>pt(i,scores[k]??0.5));const poly=pts.map(p=>`${p.x},${p.y}`).join(" ");
return<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
{[0.25,0.5,0.75,1].map(ring=><polygon key={ring} points={keys.map((_,i)=>{const p=pt(i,ring);return`${p.x},${p.y}`}).join(" ")} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>)}
{keys.map((_,i)=>{const p=pt(i,1);return<line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.03)" strokeWidth="0.5"/>})}
<polygon points={poly} fill="rgba(0,230,118,0.1)" stroke="#00e67688" strokeWidth="1.5"/>
{pts.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={2.5} fill={MEME_MODS[keys[i]].color}/>)}
{keys.map((k,i)=>{const p=pt(i,1.22);return<text key={k} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fill={MEME_MODS[k].color} fontSize="8" fontFamily={M} fontWeight="700">{MEME_MODS[k].label}</text>})}
</svg>}

// ═══ TOKEN DETAIL — full inspection panel ═══
function TokenDetail({t,T,mb,trB,buying,selling,sBuy,sSell,quickBuy,quickSell,toast,held,onClose,solP,rCustomBuy,sRCB,user,autoExitStatus,refreshAutoExit}){
const isH=held.has(t.ca);
const[memeData,setMemeData]=useState(null);const[memeLoading,setMemeLoading]=useState(false);const[memeOpen,setMemeOpen]=useState(false);
const[aeMode,setAeMode]=useState("balanced");const[aeLoading,setAeLoading]=useState(false);const[aePlan,setAePlan]=useState(null);const[aeOpen,setAeOpen]=useState(false);
// Check if this token has auto-exit active
const aeActive=autoExitStatus?.positions?.find(p=>p.ca===t.ca);
useEffect(()=>{if(aeActive)setAePlan(aeActive)},[aeActive?.ca,aeActive?.totalSoldPct]);
useEffect(()=>{if(!t.ca)return;setMemeData(null);setMemeLoading(true);fetch(API+"/api/memetic-score/"+t.ca).then(r=>r.ok?r.json():null).then(d=>{setMemeData(d);setMemeLoading(false)}).catch(()=>setMemeLoading(false))},[t.ca]);
useEffect(()=>{const h=e=>{if(e.key==="Escape")onClose()};window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h)},[onClose]);
const SL=({href,icon:Ic,label})=>href?<a href={href} target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:5,padding:"7px 12px",background:T.bg,border:"1px solid "+T.bd,borderRadius:5,fontSize:14,color:T.md,textDecoration:"none",fontWeight:600}}><Ic s={14} c={T.md}/>{label}</a>:null;
return<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden",animation:"su .25s ease",margin:mb?"0 0 6px":"0 0 8px"}}>
{/* Header with large image */}
<div style={{display:"flex",gap:12,padding:mb?10:14,borderBottom:"1px solid "+T.bd}}>
<div style={{width:mb?80:100,height:mb?80:100,borderRadius:10,overflow:"hidden",background:T.bg,flexShrink:0}}><TImg src={t.image} ticker={t.ticker} size={mb?80:100}/></div>
<div style={{flex:1,minWidth:0}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}><span style={{fontSize:mb?26:32,fontWeight:900}}>{t.name||tk(t.ticker)}</span><span style={{fontSize:17,color:T.gn,fontWeight:700}}>{tk(t.ticker)}</span>{isH&&<span style={{fontSize:13,fontWeight:800,padding:"3px 8px",borderRadius:3,background:T.gn+"18",color:T.gn}}>HELD</span>}{t.bundled&&<span style={{fontSize:13,fontWeight:800,padding:"3px 8px",borderRadius:3,background:T.or+"18",color:T.or}}>BUNDLED</span>}{t.graduated&&<span style={{fontSize:13,fontWeight:800,padding:"3px 8px",borderRadius:3,background:T.gn+"18",color:T.gn}}>GRADUATED</span>}{t.dexBoosted&&<span style={{fontSize:13,fontWeight:800,padding:"3px 8px",borderRadius:3,background:"#ffd60010",color:"#ffd600",border:"1px solid #ffd60030"}} title={"DexScreener boost: $"+(t.boostAmount||0)}>DEX PAID{t.boostAmount>0?" $"+t.boostAmount:""}</span>}</div>
<div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:4}}><span style={{fontSize:mb?32:40,fontWeight:900,color:fixMc(t,solP)>=1e6?"#ffaa00":fixMc(t,solP)>=1e5?T.gn:T.tx}}>${fm(fixMc(t,solP))}</span>{t.h1Change!=null&&<span style={{fontSize:20,fontWeight:700,color:t.h1Change>0?T.gn:"#ff4444"}}>{t.h1Change>0?"+":""}{t.h1Change.toFixed(1)}%</span>}</div>
{/* Social links — always visible */}
<div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
<SL href={t.twitter?(t.twitter.startsWith("http")?t.twitter:"https://twitter.com/"+(t.twitter.startsWith("@")?t.twitter.slice(1):t.twitter)):null} icon={IC.tw} label="Twitter"/>
<SL href={t.website?(t.website.startsWith("http")?t.website:"https://"+t.website):null} icon={IC.globe} label="Website"/>
<SL href={t.telegram?(t.telegram.startsWith("http")?t.telegram:"https://t.me/"+(t.telegram.startsWith("@")?t.telegram.slice(1):t.telegram)):null} icon={IC.tg} label="Telegram"/>
<a href={"https://pump.fun/coin/"+t.ca} target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:4,padding:"6px 10px",background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:5,fontSize:14,color:T.gn,textDecoration:"none",fontWeight:700}}>pump.fun</a>
<a href={"https://dexscreener.com/solana/"+t.ca} target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 12px",background:T.bg,border:"1px solid "+T.bd,borderRadius:5,fontSize:14,color:T.dm,textDecoration:"none"}}>dex</a>
</div>
</div>
<button onClick={onClose} style={{background:T.bg,border:"1px solid "+T.bd,cursor:"pointer",color:T.dm,padding:"6px 12px",alignSelf:"flex-start",flexShrink:0,borderRadius:6,display:"flex",alignItems:"center",gap:4,fontSize:15,fontFamily:M,fontWeight:700}}><IC.close s={14} c={T.dm}/> Close</button>
</div>
{/* Description */}
{t.description&&<div style={{padding:"8px 14px",fontSize:16,color:T.dm,borderBottom:"1px solid "+T.bd,lineHeight:1.5}}>{t.description.length>200?t.description.slice(0,200)+"…":t.description}</div>}
{/* ═══ ENTRY TIMING PANEL — shows when to buy ═══ */}
{(t.entrySignal||t.buyPressure!=null)&&<div style={{padding:"8px 14px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",gap:mb?6:10,flexWrap:"wrap"}}>
{/* Entry Signal */}
{t.entrySignal&&(()=>{const sc=t.entrySignal==="STRONG"?T.gn:t.entrySignal==="READY"?T.gn:t.entrySignal==="EARLY"?T.yl:t.entrySignal==="CAUTION"?"#ff8800":"#ff4444";return<div style={{display:"flex",alignItems:"center",gap:4,padding:"4px 10px",background:sc+"10",border:"1px solid "+sc+"30",borderRadius:6}}><div style={{width:8,height:8,borderRadius:"50%",background:sc,boxShadow:"0 0 6px "+sc+"66"}}/><span style={{fontSize:13,fontWeight:800,color:sc}}>{t.entrySignal==="STRONG"?"STRONG ENTRY":t.entrySignal==="READY"?"READY":t.entrySignal==="EARLY"?"EARLY BIRD":t.entrySignal==="CAUTION"?"CAUTION":"WAIT"}</span></div>})()}
{/* Price Phase */}
{t.pricePhase&&<div style={{fontSize:11,color:t.pricePhase==="DIP"?T.gn:t.pricePhase==="SPIKE"?"#ff4444":t.pricePhase==="EARLY"?T.yl:T.dm,fontWeight:700,padding:"3px 8px",background:T.bg,borderRadius:4,border:"1px solid "+T.bd}}>{t.pricePhase==="DIP"?"DIP":t.pricePhase==="SPIKE"?"SPIKING":t.pricePhase==="EARLY"?"EARLY":"SIDEWAYS"}</div>}
{/* Buy Pressure Gauge */}
{t.buyPressure!=null&&<div style={{display:"flex",alignItems:"center",gap:4,flex:1,minWidth:100}}><span style={{fontSize:11,color:T.ft,fontWeight:600,flexShrink:0}}>Buy Pressure</span><div style={{flex:1,height:6,borderRadius:3,background:T.bd,overflow:"hidden",maxWidth:120}}><div style={{width:Math.round(t.buyPressure*100)+"%",height:"100%",borderRadius:3,background:t.buyPressure>=.7?T.gn:t.buyPressure>=.5?T.yl:"#ff4444",transition:"width .5s"}}/></div><span style={{fontSize:12,fontWeight:800,color:t.buyPressure>=.7?T.gn:t.buyPressure>=.5?T.dm:"#ff4444"}}>{Math.round(t.buyPressure*100)}%</span></div>}
{/* Momentum */}
{t.scoreTrend&&t.scoreTrend!=="new"&&t.scoreTrend!=="stable"&&<div style={{fontSize:11,fontWeight:700,color:t.scoreTrend==="rocket"||t.scoreTrend==="rising"?T.gn:t.scoreTrend==="fading"?"#ff8800":"#ff4444",padding:"3px 8px",background:T.bg,borderRadius:4,border:"1px solid "+T.bd}}>{t.scoreTrend==="rocket"?"\u2191\u2191 ROCKET":t.scoreTrend==="rising"?"\u2191 RISING":t.scoreTrend==="fading"?"\u2193 FADING":t.scoreTrend==="crashing"?"\u2193\u2193 CRASHING":"\u2193 DECLINING"}</div>}
{/* Buy Velocity */}
{t.buyVelTrend&&t.buyVelTrend!=="steady"&&<div style={{fontSize:11,fontWeight:700,color:t.buyVelTrend==="accelerating"?T.gn:"#ff8800",padding:"3px 8px",background:T.bg,borderRadius:4,border:"1px solid "+T.bd}}>Buys {t.buyVelTrend==="accelerating"?"\u2191 Accelerating":"\u2193 Slowing"}</div>}
{/* Volume Spike */}
{t.volSpike>=3&&<div style={{fontSize:11,fontWeight:800,color:"#ff8800",padding:"3px 8px",background:"#ff880008",borderRadius:4,border:"1px solid #ff880022"}}>VOL SPIKE {t.volSpike.toFixed(0)}x</div>}
</div>}
{/* Memetic Score */}
{t.memeticScore!=null&&t.memeticScore>0&&<div style={{padding:"6px 14px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",gap:8}}>
<span style={{fontSize:11,fontWeight:800,color:T.ft}}>MEME DNA</span>
<div style={{display:"flex",gap:4,flex:1}}>
{[{l:"Ling",v:t.memeticLinguistic,c:"#00e676"},{l:"Absurd",v:t.memeticAbsurdity,c:"#ff1744"},{l:"Timing",v:t.memeticTemporal,c:"#e040fb"}].map(m=>m.v!=null&&<div key={m.l} style={{display:"flex",alignItems:"center",gap:3}}><span style={{fontSize:9,color:T.ft}}>{m.l}</span><div style={{width:40,height:3,borderRadius:2,background:T.bd}}><div style={{width:Math.round((m.v||0)*100)+"%",height:3,borderRadius:2,background:m.c}}/></div><span style={{fontSize:9,fontWeight:700,color:m.c}}>{Math.round((m.v||0)*100)}</span></div>)}
</div>
<span style={{fontSize:14,fontWeight:900,color:t.memeticScore>=0.7?T.gn:t.memeticScore>=0.5?T.yl:"#ff4444"}}>{Math.round(t.memeticScore*100)}</span>
</div>}
{/* Chart — gmgn embed */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden"}}><iframe src={"https://dexscreener.com/solana/"+t.ca+"?embed=1&theme=dark&trades=0&info=0"} style={{width:"100%",height:mb?240:360,border:"none",display:"block"}} title="chart" loading="lazy"/></div>
{/* ═══ MEMETIC TOGGLE BUTTON ═══ */}
<div style={{borderTop:"1px solid "+T.bd,borderBottom:memeOpen?"none":"1px solid "+T.bd}}>
<button onClick={()=>setMemeOpen(o=>!o)} style={{width:"100%",padding:"7px 14px",background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
<span style={{fontSize:11,fontWeight:800,color:T.pu||"#b388ff",letterSpacing:".5px"}}>MEMETIC</span>
{memeData&&<span style={{fontSize:12,fontWeight:900,color:ARCH_COLORS[memeData.archetype]||T.dm}}>{Math.round((memeData.score||0)*100)}</span>}
{memeData&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:3,background:(ARCH_COLORS[memeData.archetype]||T.dm)+"18",color:ARCH_COLORS[memeData.archetype]||T.dm,fontWeight:700}}>{ARCH_LABELS[memeData.archetype]||"?"}</span>}
{memeLoading&&<Sp s={10}/>}
<span style={{marginLeft:"auto",fontSize:10,color:T.dm,transition:"transform .2s",transform:memeOpen?"rotate(180deg)":"rotate(0)"}}>{"\u25BC"}</span>
</button>
</div>
{/* ═══ MEMETIC SPIDER CHART — collapsible ═══ */}
{memeOpen&&memeData&&memeData.moduleScores&&<div style={{borderBottom:"1px solid "+T.bd}}>
{/* Archetype + composite score */}
<div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px"}}>
<div style={{fontSize:28,fontWeight:900,color:ARCH_COLORS[memeData.archetype]||T.dm,fontFamily:M,lineHeight:1}}>{Math.round((memeData.score||0)*100)}</div>
<div>
<div style={{display:"inline-block",padding:"2px 8px",borderRadius:4,background:(ARCH_COLORS[memeData.archetype]||T.dm)+"18",color:ARCH_COLORS[memeData.archetype]||T.dm,fontSize:10,fontWeight:800,marginBottom:2}}>{ARCH_LABELS[memeData.archetype]||"Unknown"}</div>
{memeData.memeticScore!=null&&<div style={{fontSize:9,color:T.dm}}>Memetic: {Math.round(memeData.memeticScore*100)} · On-chain: {Math.round((memeData.onChainScore||0)*100)}</div>}
{memeData.elapsed!=null&&<div style={{fontSize:8,color:T.ft}}>{memeData.elapsed}ms</div>}
</div>
</div>
{/* Spider chart */}
<div style={{display:"flex",justifyContent:"center",padding:"2px 0 6px"}}><MemeSpider scores={memeData.moduleScores} size={mb?160:190} T={T}/></div>
{/* Module bars */}
<div style={{padding:"0 14px 8px"}}>{Object.entries(MEME_MODS).map(([key,{label,color:mc}])=>{const sc=memeData.moduleScores[key]??0.5;return<div key={key} style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
<span style={{width:3,height:3,borderRadius:"50%",background:mc,flexShrink:0}}/>
<span style={{fontSize:10,color:T.dm,flex:1,fontFamily:M}}>{label}</span>
<div style={{width:70,height:2.5,borderRadius:2,background:T.bd}}><div style={{height:2.5,borderRadius:2,background:mc,width:(sc*100)+"%"}}/></div>
<span style={{fontSize:10,color:mc,fontWeight:700,fontFamily:M,width:24,textAlign:"right"}}>{Math.round(sc*100)}</span>
</div>})}</div>
{/* Interaction bonuses */}
{memeData.interactionBonuses?.length>0&&<div style={{padding:"0 14px 8px"}}><div style={{fontSize:10,fontWeight:800,marginBottom:3,color:T.tx}}>Memeplex Bonuses</div>
{memeData.interactionBonuses.map((b,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"2px 6px",background:T.gn+"06",borderRadius:3,marginBottom:1,fontSize:10,fontFamily:M}}>
<span style={{color:T.gn}}>{(b.name||"").replace(/_/g," ")}</span>
<span style={{color:T.yl,fontWeight:800}}>×{(b.multiplier||1).toFixed(2)}</span>
</div>)}</div>}
</div>}
{/* CA copy */}
<div style={{padding:"5px 14px",borderTop:"1px solid "+T.bd,display:"flex",alignItems:"center",gap:4}}>
<button onClick={()=>{navigator.clipboard?.writeText(t.ca);toast("Copied","success")}} style={{padding:"5px 8px",background:"none",border:"1px solid "+T.bd,borderRadius:4,fontSize:13,color:T.ft,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}><IC.copy s={12}/>{t.ca}</button>
{t.age!=null&&<span style={{fontSize:13,color:T.ft,marginLeft:"auto"}}>{t.age>=24?Math.floor(t.age/24)+"d":Math.round(t.age)+"h"} old</span>}
</div>
{/* Buy/Sell */}
<div style={{padding:"6px 14px 10px"}}>
<div style={{display:"flex",gap:4,marginBottom:isH?6:0}}><span style={{fontSize:14,color:T.gn,fontWeight:700,width:36,alignSelf:"center"}}>BUY</span>{[.1,.25,.5].map(amt=>{const ok=(trB||0)>=amt;const ld=buying===t.ca+amt;return<button key={amt} disabled={!ok||ld} onClick={async()=>{sBuy(t.ca+amt);try{await quickBuy(t.ca,amt);toast(`+${amt}`,"success")}catch(er){toast(er.message,"error")}sBuy(null)}} style={{padding:"10px 0",flex:1,background:ok?T.gn+"06":"transparent",border:"1px solid "+(ok?T.gn+"22":T.bd),borderRadius:5,fontSize:13,fontWeight:800,color:ok?T.gn:T.ft,cursor:ok&&!ld?"pointer":"default",opacity:ok?1:.2}}>{ld?<Sp s={8}/>:amt}</button>})}<div style={{flex:1,display:"flex",gap:2}}><input value={rCustomBuy||""} onChange={e=>sRCB(e.target.value.replace(/[^0-9.]/g,""))} placeholder="SOL" style={{width:0,flex:1,padding:"6px 6px",background:T.bg,border:"1px solid "+T.bd,borderRadius:"5px 0 0 5px",fontSize:12,color:T.tx,outline:"none",textAlign:"center",fontWeight:700}}/><button disabled={!rCustomBuy||Number(rCustomBuy)<=0||Number(rCustomBuy)>(trB||0)||buying===t.ca+"c"} onClick={async()=>{const amt=Number(rCustomBuy);if(!amt||amt<=0)return;sBuy(t.ca+"c");try{await quickBuy(t.ca,amt);toast(`+${amt}`,"success");sRCB("")}catch(er){toast(er.message,"error")}sBuy(null)}} style={{padding:"6px 8px",background:rCustomBuy&&Number(rCustomBuy)>0&&Number(rCustomBuy)<=(trB||0)?T.gn+"12":"transparent",border:"1px solid "+(rCustomBuy&&Number(rCustomBuy)>0?T.gn+"22":T.bd),borderRadius:"0 5px 5px 0",fontSize:11,fontWeight:800,color:T.gn,cursor:"pointer"}}>GO</button></div></div>
{isH&&<div style={{display:"flex",gap:4}}><span style={{fontSize:14,color:"#ff4444",fontWeight:700,width:36,alignSelf:"center"}}>SELL</span>{[25,50,100].map(pct=>{const ld=selling===t.ca+pct;return<button key={pct} disabled={ld} onClick={async()=>{sSell(t.ca+pct);try{await quickSell(t.ca,pct);toast(`Sold ${pct}%`,"success")}catch(er){toast(er.message,"error")}sSell(null)}} style={{padding:"10px 0",flex:1,background:"#ff444406",border:"1px solid #ff444418",borderRadius:5,fontSize:13,fontWeight:800,color:"#ff4444",cursor:ld?"default":"pointer"}}>{ld?<Sp s={8} c="#ff4444"/>:pct===100?"ALL":pct+"%"}</button>})}</div>}
{/* ═══ AUTO-EXIT TOGGLE ═══ */}
{isH&&<div style={{marginTop:6,border:"1px solid "+(aeActive?"#e040fb33":T.bd),borderRadius:6,overflow:"hidden",background:aeActive?"#e040fb06":"transparent"}}>
<button onClick={()=>setAeOpen(o=>!o)} style={{width:"100%",padding:"8px 10px",background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
<div style={{width:28,height:16,borderRadius:8,background:aeActive?"#e040fb":T.bd,position:"relative",transition:"background .2s",cursor:"pointer"}} onClick={async(e)=>{e.stopPropagation();if(!user?.pubkey)return;setAeLoading(true);try{if(aeActive){await a.aed(user.pubkey,t.ca);setAePlan(null);toast("Auto-exit disabled","info")}else{const r=await a.aee(user.pubkey,t.ca,fixMc(t,solP),null,{mode:aeMode});setAePlan(r.plan);setAeOpen(true);toast("Auto-exit enabled","success")}if(refreshAutoExit)refreshAutoExit()}catch(er){toast(er.message,"error")}setAeLoading(false)}}><div style={{width:12,height:12,borderRadius:6,background:"#fff",position:"absolute",top:2,left:aeActive?14:2,transition:"left .2s"}}/></div>
<span style={{fontSize:12,fontWeight:800,color:aeActive?"#e040fb":T.dm}}>AUTO EXIT</span>
{aeActive&&<span style={{fontSize:10,color:T.dm,marginLeft:"auto"}}>{aeActive.totalSoldPct>0?aeActive.totalSoldPct+"% sold":"armed"}</span>}
{aeLoading&&<Sp s={8}/>}
<span style={{fontSize:10,color:T.dm,marginLeft:aeActive?"4px":"auto",transition:"transform .2s",transform:aeOpen?"rotate(180deg)":"rotate(0)"}}>{"\u25BC"}</span>
</button>
{aeOpen&&<div style={{padding:"6px 10px 10px",borderTop:"1px solid "+T.bd}}>
{/* Mode selector */}
<div style={{display:"flex",gap:3,marginBottom:8}}>{["conservative","balanced","aggressive","moonshot"].map(m=>{const ac=aeMode===m||(aeActive&&aeActive.mode===m);const mc=m==="conservative"?"#4fc3f7":m==="balanced"?"#e040fb":m==="aggressive"?"#ff8800":"#ffd600";return<button key={m} onClick={async()=>{setAeMode(m);if(aeActive&&user?.pubkey){try{await a.aed(user.pubkey,t.ca);const r=await a.aee(user.pubkey,t.ca,fixMc(t,solP),null,{mode:m});setAePlan(r.plan);if(refreshAutoExit)refreshAutoExit();toast("Switched to "+m,"success")}catch(er){toast(er.message,"error")}}}} style={{flex:1,padding:"5px 0",background:ac?mc+"12":"transparent",border:"1px solid "+(ac?mc+"33":T.bd),borderRadius:4,fontSize:9,fontWeight:ac?800:600,color:ac?mc:T.dm,cursor:"pointer",textTransform:"uppercase"}}>{m.slice(0,4)}</button>})}</div>
{/* Exit tiers display */}
{(aePlan||aeActive)&&(()=>{const p=aeActive||aePlan;return<div>
<div style={{display:"flex",gap:4,marginBottom:4}}>
<div style={{flex:1,fontSize:9,color:T.ft,textAlign:"center"}}>Kelly: <span style={{color:"#e040fb",fontWeight:800}}>{(p.kellyQ||0).toFixed(3)}</span></div>
<div style={{flex:1,fontSize:9,color:T.ft,textAlign:"center"}}>Conviction: <span style={{color:p.conviction>=1?"#00e676":"#ff8800",fontWeight:800}}>{(p.conviction||0).toFixed(2)}x</span></div>
</div>
{(p.exits||[]).map((ex,i)=>{const c=ex.hit?"#00e676":"#e040fb";return<div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0"}}>
<span style={{fontSize:10,fontWeight:800,color:c,width:28}}>{ex.name}</span>
<div style={{flex:1,height:3,borderRadius:2,background:T.bd}}><div style={{width:ex.hit?"100%":"0%",height:3,borderRadius:2,background:c,transition:"width .5s"}}/></div>
<span style={{fontSize:10,color:T.dm,width:42,textAlign:"right"}}>+{ex.triggerPct}%</span>
<span style={{fontSize:10,fontWeight:700,color:c,width:32,textAlign:"right"}}>{ex.sellPct}%</span>
{ex.hit&&<span style={{fontSize:8,color:"#00e676",fontWeight:800}}>HIT</span>}
</div>})}
<div style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",borderTop:"1px solid "+T.bd,marginTop:3}}>
<span style={{fontSize:10,fontWeight:800,color:"#ffd600",width:28}}>MOON</span>
<div style={{flex:1,fontSize:10,color:T.dm}}>Keep {p.moonBagPct}% forever</div>
<span style={{fontSize:10,color:"#ff4444",width:42,textAlign:"right"}}>SL {p.stopLoss}%</span>
<span style={{fontSize:10,color:T.dm,width:32,textAlign:"right"}}>TS {p.trailingStop}%</span>
</div>
{/* Log entries */}
{aeActive?.log?.length>0&&<div style={{marginTop:4,borderTop:"1px solid "+T.bd,paddingTop:4}}>
{aeActive.log.slice(-3).map((l,i)=><div key={i} style={{fontSize:9,color:T.dm,padding:"1px 0"}}>{l.msg}</div>)}
</div>}
</div>})()}
</div>}
</div>}
</div></div>}

// ═══ SIMULATION — pump.fun bonding curve simulator ═══
function SimMode({mb,budget:extBudget,sniperCount,gradMc:gMc}){const T=uT();const cvRef=useRef(null);const frame=useRef(0);
const st=useRef({p:.00001,pts:[],buys:[],sells:[],noise:[],mc:0,sig:"WAIT",ph:"idle",spent:0,back:0,bonded:false,bondProb:0,peakMc:0,roi:0,avgEntry:0,avgExit:0,maxDraw:0,phaseTime:{scan:0,accumulate:0,hold:0,distribute:0,sweep:0},runCount:0,history:[]});
const[running,sR]=useState(false);const budget=extBudget||2;const[speed,sSpeed]=useState(1);const[tick,sTick]=useState(0);const snprs=sniperCount||2;const gradMc=gMc||69000;
const[simOpen,sSimOpen]=useState(false);const[detailOpen,sDetailOpen]=useState(false);const[guideOpen,sGuideOpen]=useState(false);
const PHASES={scan:"Scanning for entry — analyzing first trades",accumulate:"Fleet buying in — staggered Gaussian timing",hold:"Holding position — monitoring opponent behavior",distribute:"Selling into demand — taking profit",sweep:"Final sweep — recovering all SOL from fleet wallets",complete:"Session complete — all funds returned"};
const SIM_DURATION={scan:40,accumulate:100,hold:80,distribute:130,sweep:70};const TOTAL_FRAMES=420;
const estTime=()=>{const secs=Math.round(TOTAL_FRAMES*35/(speed*1000));return secs<60?secs+"s":Math.round(secs/60)+"m "+secs%60+"s"};
const calcBondProb=(mc,mom,bp)=>{if(mc>=gradMc)return 100;const base=Math.min(80,(mc/gradMc)*100);const m=mom>0?Math.min(15,mom*500):Math.max(-20,mom*300);const b=bp>0.5?10:bp>0.3?5:0;return Math.max(0,Math.min(99,Math.round(base+m+b)))};
useEffect(()=>{if(!running)return;const s=st.current;s.p=.000006+Math.random()*.000008;s.pts=[];s.buys=[];s.sells=[];s.noise=[];s.mc=0;s.spent=0;s.back=0;s.bonded=false;s.bondProb=0;s.peakMc=0;s.roi=0;s.avgEntry=0;s.avgExit=0;s.maxDraw=0;s.phaseTime={scan:0,accumulate:0,hold:0,distribute:0,sweep:0};s.ph="scan";s.sig="SCAN";frame.current=0;
const doTick=()=>{const f=++frame.current;const pr=s.p;
const phase=f<40?"scan":f<140?"accumulate":f<220?"hold":f<350?"distribute":f<420?"sweep":"complete";
const buyP=phase==="accumulate"?.6:phase==="hold"?.3:phase==="scan"?.1:0;
const sellP=phase==="distribute"?.5:phase==="sweep"?.7:0;
s.p=Math.max(.000001,pr+(Math.random()-.48)*pr*.05+buyP*pr*.004-sellP*pr*.003+(Math.random()>.7?1:-1)*pr*.002);
s.mc=s.p*1e9;if(s.mc>s.peakMc)s.peakMc=s.mc;s.pts.push(s.p);if(s.pts.length>600)s.pts.shift();
if(phase!=="complete"&&s.phaseTime[phase]!=null)s.phaseTime[phase]++;
const mom=s.pts.length>10?(s.pts[s.pts.length-1]-s.pts[s.pts.length-10])/(s.pts[s.pts.length-10]||1):0;
s.bondProb=calcBondProb(s.mc,mom,buyP);s.ph=phase;
if(phase==="accumulate"&&f%6===0&&s.spent<budget*.6){const amt=budget*.02+Math.random()*budget*.025;s.buys.push({f,p:s.p,amt});s.spent+=budget*.03;s.sig="BUY"}
else if(phase==="hold"){s.sig="HOLD";if(f%18===0)s.noise.push({f,sell:Math.random()>.45})}
else if(phase==="distribute"&&f%8===0){s.sells.push({f,p:s.p,amt:budget*.04});s.back+=budget*.04*(1.1+Math.random()*.5);s.sig=f>300?"EXIT":"SELL"}
else if(phase==="sweep"){s.sig="SWEEP";if(f%4===0&&s.back<s.spent){s.sells.push({f,p:s.p,amt:budget*.05});s.back+=budget*.05*.7}}
else if(phase==="complete"){s.sig="DONE";s.bonded=s.mc>=gradMc;
// Compute final analytics
if(s.buys.length>0)s.avgEntry=s.buys.reduce((a,b)=>a+b.p,0)/s.buys.length;
if(s.sells.length>0)s.avgExit=s.sells.reduce((a,b)=>a+b.p,0)/s.sells.length;
const peaks=s.pts.map((_,i)=>Math.max(...s.pts.slice(0,i+1)));s.maxDraw=0;for(let i=1;i<s.pts.length;i++){const dd=(peaks[i]-s.pts[i])/peaks[i]*100;if(dd>s.maxDraw)s.maxDraw=dd}
s.runCount++;s.history.push({roi:s.roi,pnl:s.back-s.spent,peak:s.peakMc,bonded:s.bonded,bondProb:s.bondProb});if(s.history.length>20)s.history.shift();
sR(false)}
else if(phase==="scan"){s.sig="SCAN";if(f%12===0)s.noise.push({f,sell:Math.random()>.5})}
s.roi=s.spent>0?((s.back-s.spent)/s.spent*100):0;sTick(f);
const cv=cvRef.current;if(!cv)return;const ctx=cv.getContext("2d");const dpr=window.devicePixelRatio||2;const w=cv.width=cv.offsetWidth*dpr;const h=cv.height=(mb?180:240)*dpr;ctx.clearRect(0,0,w,h);
const pts=s.pts;if(pts.length<2)return;const mn=Math.min(...pts),mx=Math.max(...pts),rng=mx-mn||1;
ctx.strokeStyle=T.bd;ctx.lineWidth=.5;for(let i=0;i<5;i++){const y=8+h*.85*(i/4);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
// Phase background bands
const phaseColors={scan:T.cy+"08",accumulate:T.gn+"08",hold:T.pu+"06",distribute:T.or+"08",sweep:T.rd+"08"};
const phaseRanges=[{s:0,e:40,k:"scan"},{s:40,e:140,k:"accumulate"},{s:140,e:220,k:"hold"},{s:220,e:350,k:"distribute"},{s:350,e:420,k:"sweep"}];
phaseRanges.forEach(pr=>{const x1=Math.max(0,(pr.s/f)*w);const x2=Math.min(w,(pr.e/f)*w);if(x2>x1){ctx.fillStyle=phaseColors[pr.k]||"transparent";ctx.fillRect(x1,0,x2-x1,h)}});
const bondP=gradMc/1e9;if(bondP>=mn*.5&&bondP<=mx*1.5){const by=h-8-((Math.min(bondP,mx)-mn)/rng)*(h-16);if(by>0&&by<h){ctx.setLineDash([8,4]);ctx.strokeStyle=T.yl+"55";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,by);ctx.lineTo(w,by);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=T.yl;ctx.font=`${Math.round(5*dpr)}px monospace`;ctx.fillText("BOND $"+(gradMc/1000).toFixed(0)+"K",w-Math.round(40*dpr),by-4)}}
ctx.beginPath();ctx.strokeStyle=T.gn;ctx.lineWidth=2;ctx.lineJoin="round";
for(let i=0;i<pts.length;i++){const x=(i/(pts.length-1))*(w-4)+2;const y=h-8-((pts[i]-mn)/rng)*(h-16);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)}ctx.stroke();
const gf=ctx.createLinearGradient(0,0,0,h);gf.addColorStop(0,T.gn+"18");gf.addColorStop(1,T.gn+"01");ctx.lineTo(w-2,h);ctx.lineTo(2,h);ctx.closePath();ctx.fillStyle=gf;ctx.fill();
const mark=(fi,color,sz)=>{const bi=Math.round((fi/f)*pts.length);if(bi<0||bi>=pts.length)return;const x=(bi/(pts.length-1))*(w-4)+2;const y=h-8-((pts[bi]-mn)/rng)*(h-16);ctx.beginPath();ctx.arc(x,y,sz*2,0,Math.PI*2);ctx.fillStyle=color+"33";ctx.fill();ctx.beginPath();ctx.arc(x,y,sz,0,Math.PI*2);ctx.fillStyle=color;ctx.fill()};
s.buys.forEach(b=>mark(b.f,"#00e676",3));s.sells.forEach(b=>mark(b.f,"#ff1744",3));s.noise.forEach(n=>mark(n.f,n.sell?"#ff174444":"#00e67644",2));
// Phase labels on chart
const curPhaseIdx=phaseRanges.findIndex(pr=>f>=pr.s&&f<pr.e);if(curPhaseIdx>=0){const cp=phaseRanges[curPhaseIdx];const cx=(((cp.s+Math.min(f,cp.e))/2)/f)*w;ctx.fillStyle=T.tx+"66";ctx.font=`bold ${Math.round(4.5*dpr)}px monospace`;ctx.textAlign="center";ctx.fillText(cp.k.toUpperCase(),cx,h-4*dpr)}
};const iv=setInterval(doTick,35/speed);return()=>clearInterval(iv)},[running,budget,speed,mb]);
const s=st.current;const pnl=s.back-s.spent;const progress=Math.min(100,Math.round((frame.current/TOTAL_FRAMES)*100));
return<div style={{background:T.sf,border:"1px solid "+T.pu+"18",borderRadius:10,overflow:"hidden",animation:"si .2s ease"}}>
{/* ── Header: toggle on/off + collapse ── */}
<div style={{padding:"8px 12px",cursor:"pointer",borderBottom:simOpen?"1px solid "+T.bd:"none"}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<div onClick={()=>sSimOpen(!simOpen)} style={{display:"flex",alignItems:"center",gap:5,flex:1,cursor:"pointer"}}><IC.sim s={14} c={T.pu}/><span style={{fontSize:12,fontWeight:800}}>Sim Mode</span>{running&&<span style={{width:5,height:5,borderRadius:"50%",background:T.gn,animation:"gp 2s infinite"}}/>}{!simOpen&&s.ph!=="idle"&&<span style={{fontSize:9,color:T.dm}}>{s.bondProb}% bond · ${fm(s.mc)} MC · {s.ph}</span>}{!simOpen&&s.runCount>0&&s.ph==="idle"&&<span style={{fontSize:9,color:T.ft}}>ran {s.runCount}x · avg ROI {s.history.length>0?(s.history.reduce((a,h)=>a+h.roi,0)/s.history.length).toFixed(0)+"%":"—"}</span>}<span style={{fontSize:10,color:T.ft,marginLeft:4}}>{simOpen?"▾":"▸"}</span></div>
<div style={{display:"flex",gap:3,alignItems:"center"}} onClick={e=>e.stopPropagation()}>
<button onClick={()=>sSpeed(speed>=4?1:speed*2)} style={{background:"none",border:"1px solid "+T.bd,borderRadius:4,padding:"1px 7px",fontSize:11,color:T.dm,cursor:"pointer"}}>{speed}x</button>
<button onClick={()=>{if(running){sR(false)}else{if(!simOpen)sSimOpen(true);sR(true)}}} style={{background:running?T.rd+"0c":T.gn+"0c",border:"1px solid "+(running?T.rd:T.gn)+"18",borderRadius:4,padding:"2px 10px",fontSize:9,fontWeight:700,color:running?T.rd:T.gn,cursor:"pointer",display:"flex",alignItems:"center",gap:3}}>{running?<><IC.stop s={8} c={T.rd}/>Stop</>:<><IC.sim s={10} c={T.gn}/>Run</>}</button>
</div></div>
{/* Progress bar when running */}
{running&&<div style={{marginTop:4,height:2,borderRadius:1,background:T.bd}}><div style={{width:progress+"%",height:2,borderRadius:1,background:T.gn,transition:"width .3s"}}/></div>}
{simOpen&&<div style={{fontSize:8,color:T.dm,lineHeight:1.4,marginTop:4}}>Preview how your {budget} SOL fleet with {snprs} snipers trades the bonding curve. Dev buys first, snipers enter staggered, fleet holds through volatility, exits into demand. Bond target: ~${(gradMc/1000).toFixed(0)}K MC. <span style={{color:T.cy}}>~{estTime()} at {speed}x</span></div>}</div>
{simOpen&&<><canvas ref={cvRef} style={{width:"100%",height:mb?180:240,display:"block",background:T.bg}}/>
{/* ── Phase + Bond Prob row ── */}
<div style={{padding:"6px 12px",borderTop:"1px solid "+T.bd,display:"flex",alignItems:"center",gap:8}}>
<div style={{flex:1}}><div style={{display:"flex",alignItems:"center",gap:4,marginBottom:2}}><span style={{fontSize:10,fontWeight:800,color:s.ph==="accumulate"?T.gn:s.ph==="distribute"||s.ph==="sweep"?T.rd:s.ph==="complete"?T.yl:T.md,textTransform:"uppercase"}}>{s.ph}</span><span style={{fontSize:10,fontWeight:800,color:s.sig==="BUY"?T.gn:s.sig==="SELL"||s.sig==="EXIT"?T.rd:s.sig==="DONE"?T.yl:T.dm}}>{s.sig}</span></div><div style={{fontSize:7,color:T.ft,lineHeight:1.3}}>{PHASES[s.ph]||""}</div></div>
<div style={{textAlign:"center",minWidth:70}}><div style={{fontSize:18,fontWeight:900,color:s.bondProb>=80?T.gn:s.bondProb>=50?T.yl:s.bondProb>=20?T.or:T.rd}}>{s.bondProb}%</div><div style={{fontSize:7,color:T.ft,fontWeight:700}}>BOND PROB</div><div style={{width:60,height:3,borderRadius:2,background:T.bd,marginTop:2}}><div style={{width:(s.bondProb/100)*60,height:3,borderRadius:2,background:s.bondProb>=80?T.gn:s.bondProb>=50?T.yl:s.bondProb>=20?T.or:T.rd,transition:"width .3s"}}/></div></div></div>
{/* ── Primary stats grid ── */}
<div style={{padding:"4px 12px",borderTop:"1px solid "+T.bd,display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:1,fontSize:8}}>
<div style={{textAlign:"center"}}><div style={{color:s.mc>=60000?"#ffaa00":T.tx,fontWeight:800,fontSize:10}}>${fm(s.mc)}</div><div style={{color:T.ft,fontSize:6}}>MC</div></div>
<div style={{textAlign:"center"}}><div style={{color:T.tx,fontWeight:800,fontSize:10}}>${fm(s.peakMc)}</div><div style={{color:T.ft,fontSize:6}}>PEAK</div></div>
<div style={{textAlign:"center"}}><div style={{color:T.rd,fontWeight:800,fontSize:10}}>{s.spent.toFixed(1)}</div><div style={{color:T.ft,fontSize:6}}>SPENT</div></div>
<div style={{textAlign:"center"}}><div style={{color:T.gn,fontWeight:800,fontSize:10}}>{s.back.toFixed(1)}</div><div style={{color:T.ft,fontSize:6}}>BACK</div></div>
<div style={{textAlign:"center"}}><div style={{color:pnl>=0?T.gn:T.rd,fontWeight:800,fontSize:10}}>{pnl>=0?"+":""}{pnl.toFixed(1)}</div><div style={{color:T.ft,fontSize:6}}>PnL</div></div>
<div style={{textAlign:"center"}}><div style={{color:s.roi>=0?T.gn:T.rd,fontWeight:800,fontSize:10}}>{s.roi>=0?"+":""}{s.roi.toFixed(0)}%</div><div style={{color:T.ft,fontSize:6}}>ROI</div></div></div>
{/* ── Detailed metrics (collapsible) ── */}
<div style={{borderTop:"1px solid "+T.bd}}>
<div onClick={()=>sDetailOpen(!detailOpen)} style={{padding:"3px 12px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<span style={{fontSize:8,fontWeight:700,color:T.cy}}>Detailed Metrics</span>
<span style={{fontSize:8,color:T.ft}}>{detailOpen?"▾":"▸"}</span>
</div>
{detailOpen&&<div style={{padding:"2px 12px 6px"}}>
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:3,marginBottom:4}}>
<div style={{textAlign:"center",padding:"3px 2px",background:T.bg,borderRadius:4}}>
<div style={{fontSize:9,fontWeight:800,color:T.tx}}>{s.buys.length}</div>
<div style={{fontSize:6,color:T.ft}}>BUYS</div>
</div>
<div style={{textAlign:"center",padding:"3px 2px",background:T.bg,borderRadius:4}}>
<div style={{fontSize:9,fontWeight:800,color:T.tx}}>{s.sells.length}</div>
<div style={{fontSize:6,color:T.ft}}>SELLS</div>
</div>
<div style={{textAlign:"center",padding:"3px 2px",background:T.bg,borderRadius:4}}>
<div style={{fontSize:9,fontWeight:800,color:T.gn}}>{s.avgEntry>0?(s.avgEntry*1e6).toFixed(2):"—"}</div>
<div style={{fontSize:6,color:T.ft}}>AVG ENTRY (μ)</div>
</div>
<div style={{textAlign:"center",padding:"3px 2px",background:T.bg,borderRadius:4}}>
<div style={{fontSize:9,fontWeight:800,color:T.rd}}>{s.avgExit>0?(s.avgExit*1e6).toFixed(2):"—"}</div>
<div style={{fontSize:6,color:T.ft}}>AVG EXIT (μ)</div>
</div>
</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:3,marginBottom:4}}>
<div style={{textAlign:"center",padding:"3px 2px",background:T.bg,borderRadius:4}}>
<div style={{fontSize:9,fontWeight:800,color:T.or}}>{s.maxDraw>0?s.maxDraw.toFixed(1)+"%":"—"}</div>
<div style={{fontSize:6,color:T.ft}}>MAX DRAWDOWN</div>
</div>
<div style={{textAlign:"center",padding:"3px 2px",background:T.bg,borderRadius:4}}>
<div style={{fontSize:9,fontWeight:800,color:s.avgExit>s.avgEntry?T.gn:T.rd}}>{s.avgEntry>0&&s.avgExit>0?((s.avgExit/s.avgEntry-1)*100).toFixed(1)+"%":"—"}</div>
<div style={{fontSize:6,color:T.ft}}>PRICE SPREAD</div>
</div>
<div style={{textAlign:"center",padding:"3px 2px",background:T.bg,borderRadius:4}}>
<div style={{fontSize:9,fontWeight:800,color:T.tx}}>{s.noise.length}</div>
<div style={{fontSize:6,color:T.ft}}>OPP TRADES</div>
</div>
</div>
{/* Phase duration breakdown */}
<div style={{fontSize:7,color:T.ft,marginBottom:2,fontWeight:700}}>Phase Duration</div>
<div style={{display:"flex",gap:1,height:6,borderRadius:3,overflow:"hidden",marginBottom:2}}>
{Object.entries(s.phaseTime).map(([k,v])=>{const total=Object.values(s.phaseTime).reduce((a,b)=>a+b,0)||1;const pct=(v/total)*100;const colors={scan:T.cy,accumulate:T.gn,hold:T.pu,distribute:T.or,sweep:T.rd};return<div key={k} style={{width:pct+"%",background:colors[k]||T.bd,minWidth:pct>0?2:0}} title={k+": "+Math.round(v*35/1000)+"s"}/>})}
</div>
<div style={{display:"flex",gap:6,fontSize:6,color:T.dm,flexWrap:"wrap"}}>
{Object.entries(s.phaseTime).filter(([,v])=>v>0).map(([k,v])=>{const colors={scan:T.cy,accumulate:T.gn,hold:T.pu,distribute:T.or,sweep:T.rd};return<span key={k} style={{display:"flex",alignItems:"center",gap:2}}><span style={{width:4,height:4,borderRadius:1,background:colors[k]||T.bd}}/>{k} {Math.round(v*35/1000)}s</span>})}
</div>
{/* Multi-run history */}
{s.history.length>1&&<div style={{marginTop:6}}>
<div style={{fontSize:7,color:T.ft,fontWeight:700,marginBottom:2}}>Run History ({s.history.length} runs)</div>
<div style={{display:"flex",gap:2,alignItems:"end",height:24}}>
{s.history.map((h,i)=>{const maxRoi=Math.max(...s.history.map(x=>Math.abs(x.roi)),1);const barH=Math.max(2,Math.abs(h.roi)/maxRoi*22);return<div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center"}}><div style={{width:"100%",height:barH,borderRadius:1,background:h.roi>=0?T.gn:T.rd,opacity:i===s.history.length-1?1:.5}}/></div>})}
</div>
<div style={{display:"flex",justifyContent:"space-between",fontSize:6,color:T.dm,marginTop:2}}>
<span>avg ROI: {(s.history.reduce((a,h)=>a+h.roi,0)/s.history.length).toFixed(0)}%</span>
<span>bonded: {s.history.filter(h=>h.bonded).length}/{s.history.length}</span>
<span>avg PnL: {(s.history.reduce((a,h)=>a+h.pnl,0)/s.history.length).toFixed(2)} SOL</span>
</div>
</div>}
</div>}
</div>
{/* ── Legend ── */}
<div style={{padding:"4px 12px 4px",display:"flex",gap:8,fontSize:7,color:T.ft,alignItems:"center",borderTop:"1px solid "+T.bd}}><span style={{display:"flex",alignItems:"center",gap:2}}><span style={{width:5,height:5,borderRadius:"50%",background:"#00e676"}}/>fleet buy</span><span style={{display:"flex",alignItems:"center",gap:2}}><span style={{width:5,height:5,borderRadius:"50%",background:"#ff1744"}}/>fleet sell</span><span style={{display:"flex",alignItems:"center",gap:2}}><span style={{width:5,height:5,borderRadius:"50%",background:T.dm+"44"}}/>opponent</span><span style={{marginLeft:"auto",fontWeight:700,color:T.gn}}>{budget} SOL · {snprs} snipers</span><span style={{color:T.yl+"88",fontSize:6}}>━ bond line</span></div>
{/* ── Simulation guidelines (collapsible) ── */}
<div style={{borderTop:"1px solid "+T.bd}}>
<div onClick={()=>sGuideOpen(!guideOpen)} style={{padding:"3px 12px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<span style={{fontSize:8,fontWeight:700,color:T.yl}}>Sim Guidelines</span>
<span style={{fontSize:8,color:T.ft}}>{guideOpen?"▾":"▸"}</span>
</div>
{guideOpen&&<div style={{padding:"2px 12px 8px",fontSize:7,color:T.dm,lineHeight:1.6}}>
<div style={{marginBottom:4}}>
<span style={{fontWeight:800,color:T.yl}}>How long to simulate?</span>
<div>Run <span style={{color:T.tx,fontWeight:700}}>3-5 sims</span> at 1x speed to get a realistic spread. Use the run history to see consistency.</div>
</div>
<div style={{marginBottom:4}}>
<span style={{fontWeight:800,color:T.yl}}>What to look for:</span>
<div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"1px 6px",marginTop:2}}>
<span style={{color:T.gn}}>Bond Prob {">"} 60%</span><span>Your budget can push MC close to graduation</span>
<span style={{color:T.or}}>Max Drawdown {"<"} 40%</span><span>Price doesn't crater before fleet exits</span>
<span style={{color:T.gn}}>ROI consistently +</span><span>Fleet reliably recovers more than it spends</span>
<span style={{color:T.cy}}>Avg Entry {"<"} Avg Exit</span><span>Fleet buys low, sells higher — as designed</span>
</div>
</div>
<div>
<span style={{fontWeight:800,color:T.yl}}>Speed tips:</span>
<div><span style={{color:T.tx}}>1x</span> = most realistic timing · <span style={{color:T.tx}}>2x</span> = quick check · <span style={{color:T.tx}}>4x</span> = rapid iteration</div>
<div style={{marginTop:2}}>If ROI is negative across 3+ runs, consider: more budget, fewer snipers, or shorter duration.</div>
</div>
</div>}
</div>
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
const[trW,sTrW]=useState(null);const[trB,sTrB]=useState(0);const[trSol,sTrSol]=useState(0);const[trTok,sTrTok]=useState(0);const[trK,sTrK]=useState(null);
const[held,sHeld]=useState(new Set());const[positions,sPos]=useState([]);
const[tab,sTab]=useState(()=>{const p=window.location.pathname.replace(/^\//,"").toLowerCase();return["radar","wallet","deploy","intel","gpu"].includes(p)?p:"radar"});const[cUser,sCU]=useState(null);
useEffect(()=>{const p="/"+tab;if(window.location.pathname!==p)window.history.pushState(null,"",p)},[tab]);
useEffect(()=>{const h=()=>{const p=window.location.pathname.replace(/^\//,"").toLowerCase();if(["radar","wallet","deploy","intel","gpu"].includes(p)&&p!==tab)sTab(p)};window.addEventListener("popstate",h);return()=>window.removeEventListener("popstate",h)},[tab]);
const[toasts,sToasts]=useState([]);
const[rt,sRT]=useState({new:[],momentum:[],resurgence:[]});
const[rTab,sRTab]=useState("momentum");const[rLoad,sRL]=useState(true);const[rPool,sRP]=useState(0);const[gradMc,sGradMc]=useState(69000);
const[rExp,sRExp]=useState(null);const[buying,sBuy]=useState(null);const[selling,sSell]=useState(null);const[rSearch,sRS]=useState("");
const[rEnabled,sRE]=useState(true);const[rFilterOpen,sRFO]=useState(false);const[rMinBP,sRMinBP]=useState(0);const[rMinMC,sRMinMC]=useState(0);const[rSignalFilter,sRSF]=useState("ALL");const[rSourceFilter,sRSrcF]=useState("ALL");const[rCustomBuy,sRCB]=useState("");const[autoTrade,sAutoTrade]=useState(null);const[autoExitSt,sAutoExitSt]=useState(null);const[img,sImg]=useState(null);const[showKeys,sShowKeys]=useState(false);const[aaAdvanced,sAAAdvanced]=useState(false);
const[refData,sRefData]=useState(null);const[refInput,sRefInput]=useState("");const[refMsg,sRefMsg]=useState("");
const[vipDash,sVipDash]=useState(null);const[vipCustomCode,sVipCustomCode]=useState("");const[vipClaiming,sVipClaiming]=useState(false);const[demoProfits,sDemoProfits]=useState(null);const[demoLoading,sDemoLoading]=useState(false);
const[expert,sExpert]=useState(false);const[launchStep,sLS]=useState(null);const[showHow,sShowHow]=useState(false);const[showModel,sShowModel]=useState(false);const[launchTarget,sLTarget]=useState("pump"); // "pump" | "bags"
// launchStep: null | "creating" | "uploading" | "funding" | "dev_buy" | "snipers" | "live"
const[intelData,sIntel]=useState(null);const[wsLog,sWsLog]=useState([]);const[chartPatterns,sChartPatterns]=useState(null);const[gradsOpen,sGradsOpen]=useState(false);const[dexMovers,sDexMovers]=useState(null);const[engineState,sEngineState]=useState(null);const[intelTokens,sIntelTokens]=useState(null);const[intelTSort,sITSort]=useState("score");const[intelTSrc,sITSrc]=useState("all");const[intelTOpen,sITOpen]=useState(true);
// GPU Earn tab state
const[gpuDash,sGpuDash]=useState(null);const[gpuFleet,sGpuFleet]=useState(null);const[gpuLoading,sGpuLoading]=useState(false);const[gpuRegWallet,sGpuRegWallet]=useState("");
const[gpuCmdLoading,sGpuCmdLoading]=useState(false);const[gpuLogs,sGpuLogs]=useState(null);const[gpuShowLogs,sGpuShowLogs]=useState(false);const[gpuShowDetails,sGpuShowDetails]=useState(false);
const sendGpuCmd=useCallback(async(command,params={})=>{if(!user?.pubkey||gpuCmdLoading)return;sGpuCmdLoading(true);try{const r=await fetch(API+"/api/gpu/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet:user.pubkey,command,params})});const d=await r.json();if(d.success){toast(d.message,"success");if(command==="get_logs"){setTimeout(async()=>{try{const lr=await fetch(API+"/api/gpu/node-logs?wallet="+user.pubkey);const ld=await lr.json();sGpuLogs(ld.logs||[]);sGpuShowLogs(true)}catch{}},3000)}setTimeout(()=>a.gpd(user.pubkey).then(d=>sGpuDash(d)).catch(()=>{}),5000)}else{toast(d.error||"Command failed","error")}}catch(e){toast("Failed to send command","error")}sGpuCmdLoading(false)},[user?.pubkey,gpuCmdLoading]);
// Chat support state
const[chatOpen,sChatOpen]=useState(false);const[chatMsgs,sChatMsgs]=useState([]);const[chatInput,sChatInput]=useState("");const[chatLoading,sChatLoading]=useState(false);const chatEndRef=useRef(null);
const sendChat=useCallback(async()=>{const msg=chatInput.trim();if(!msg||chatLoading)return;const userMsg={role:"user",content:msg};const newMsgs=[...chatMsgs,userMsg];sChatMsgs(newMsgs);sChatInput("");sChatLoading(true);try{const r=await a.cht(newMsgs,user?.pubkey);if(r.reply){sChatMsgs(m=>[...m,{role:"assistant",content:r.reply}])}else{sChatMsgs(m=>[...m,{role:"assistant",content:r.error||"Something went wrong. Try again."}])}}catch(e){sChatMsgs(m=>[...m,{role:"assistant",content:"Connection error. Check your internet and try again."}])}sChatLoading(false)},[chatInput,chatMsgs,chatLoading,user?.pubkey]);
useEffect(()=>{chatEndRef.current?.scrollIntoView({behavior:"smooth"})},[chatMsgs]);
// Intel trade settings — slippage, tip, buy amount, auto mode
const[iTrade,sITrade]=useState({ca:null,slip:25,tip:0.005,amt:0.1,auto:false});
// Auto-trade settings calculator (shared between intel trade panel and auto-ape section)
const autoSettings=(solPerTrade)=>{const sol=solPerTrade||0.1;const aggr=sol<=0.1?1.2:sol<=0.25?1.0:sol<=0.5?0.85:sol<=1?0.7:sol<=2?0.6:0.5;return{minScore:Math.round(sol<=0.1?22:sol<=0.25?28:sol<=0.5?35:sol<=1?42:50),maxPositions:Math.round(sol<=0.1?5:sol<=0.25?4:sol<=0.5?3:sol<=1?2:2),tp1:Math.round(30*aggr),tp1Sell:30,tp2:Math.round(80*aggr),tp2Sell:30,tp3:Math.round(200*aggr),tp3Sell:40,sl1:Math.round(10/aggr),sl1Sell:60,sl2:Math.round(20/aggr),momentumExit:true,reentryDips:true}};
// Live sim state — must be declared here, NOT inside IIFEs (React Rules of Hooks / error #310)
const[simExpanded,sSimExpanded]=useState(true);const[simDetailOpen,sSimDetailOpen]=useState(true);const[simGuideOpen,sSimGuideOpen]=useState(false);const[simRunning,sSimRunning]=useState(false);
const[liveSim,sLiveSim]=useState(null);const[simStarting,sSimStarting]=useState(false);
// CA lookup state — must be declared before any early returns to satisfy Rules of Hooks
const[caLookup,sCaLookup]=useState(null);const[caLoading,sCaLoading]=useState(false);const caLookupRef=useRef(null);const didDisconnectRef=useRef(false);

const toast=useCallback((m,t="info")=>{const id=Date.now()+Math.random();sToasts(x=>[...x,{id,msg:m,type:t}]);setTimeout(()=>sToasts(x=>x.filter(y=>y.id!==id)),5000)},[]);
const hasAccess=user&&(user.demo||user.tier==="free"||user.tier==="pro"||user.tier==="vip"); // pro kept for legacy
const OWNER_WALLET="4XnHZZmHwSQ8RszJsdc7snvxG8dZtm6g4hvpkCMkguMx";
const isOwner=user?.pubkey===OWNER_WALLET;
const tierColor=isOwner?T.yl:user?.whitelisted?T.yl:user?.tier==="vip"?T.yl:T.gn;
const tierLabel=isOwner?"OWNER":user?.whitelisted?"VIP":user?.tier==="vip"?"VIP":user?.demo?"DEMO":"";
const isApe=!!eCA;const pv=dbp(sol,isApe);const nw=wc(sol);
const canLaunch=(trW||isApe)&&(eCA||tkr)&&sol>=0.2&&trB>=sol;
const applyPreset=p=>{sSol(p.sol);sSn(p.snc);sSl(p.slip);sDur(p.dur);sJt(p.jt)};
// Resolve connected wallet — if it's a trading key, use parent wallet & auto-set trading key
const resolveWallet=async(pk)=>{try{const id=await a.itk(pk);if(id.isTradeKey&&id.parentWallet){sU({pubkey:id.parentWallet,tier:id.tier||"free",demo:false,whitelisted:!!id.whitelisted,paid:!!id.paid});sTrW(id.tradingWallet||pk);a.sw(id.parentWallet);toast("Trading key detected — logged in","success");return}}catch{}sU({pubkey:pk,tier:"free",demo:false});a.chk(pk).then(d=>{if(d.tier)sU(u=>({...u,whitelisted:!!d.whitelisted,paid:!!d.paid,tier:d.tier}))}).catch(()=>{})};
const connect=async()=>{didDisconnectRef.current=false;try{const p=window?.phantom?.solana?.isPhantom?window.phantom.solana:window?.solana?.isPhantom?window.solana:null;if(!p){if(/iPhone|iPad|Android/i.test(navigator.userAgent)){window.location.href="https://phantom.app/ul/browse/"+encodeURIComponent(window.location.href);return}toast("Install Phantom","error");return}const r=await p.connect();const pk=r.publicKey.toString();await resolveWallet(pk)}catch(e){toast(e.code===4001?"Rejected":"Failed","error")}};

useEffect(()=>{if(user?.pubkey)a.sw(user.pubkey)},[user?.pubkey]);
useEffect(()=>{if(user?.pubkey&&!user?.demo)a.afr(user.pubkey).catch(()=>{})},[user?.pubkey]);
useEffect(()=>{if(didDisconnectRef.current)return;const p=window?.phantom?.solana||window?.solana;if(p?.isPhantom&&p?.isConnected&&!user){p.connect({onlyIfTrusted:true}).then(r=>{if(didDisconnectRef.current)return;const pk=r.publicKey.toString();resolveWallet(pk)}).catch(()=>{})}},[]);
useEffect(()=>{if(!hasAccess)return;let ws,dead=false;const conn=()=>{if(dead)return;try{ws=new WebSocket(WS_URL);ws.onopen=()=>{sWs(true);sWsLog(p=>[{ev:"connected",ts:Date.now()},...p].slice(0,500))};ws.onmessage=(e)=>{try{const msg=JSON.parse(e.data);if(msg.event==="mcap-update"&&msg.data){const{ca,mcap,mcapSol}=msg.data;sRT(prev=>{const update=tab=>[...tab].map(t=>t.ca===ca?{...t,mcapUsd:mcap,mcapSol:mcapSol||t.mcapSol}:t);return{new:update(prev.new||[]),momentum:update(prev.momentum||[])}})}if(msg.event){sWsLog(p=>[{ev:msg.event,d:msg.data||{},ts:msg.ts||Date.now()},...p].slice(0,500))}}catch{}};ws.onclose=()=>{sWs(false);sWsLog(p=>[{ev:"disconnected",ts:Date.now()},...p].slice(0,500));if(!dead)setTimeout(conn,3000)};ws.onerror=()=>{}}catch{}};conn();return()=>{dead=true;if(ws)ws.close()}},[hasAccess]);
useEffect(()=>{if(!user?.pubkey||user.demo)return;a.ls(user.pubkey).then(d=>{if(d.sessions)sPS(d.sessions.filter(s=>s.tokenCA&&s.status!=="closed"&&s.status!=="swept"&&s.status!=="recovered").slice(0,8))}).catch(()=>{})},[user?.pubkey]);
const refreshWallet=useCallback(()=>{if(!user?.pubkey||user.demo)return;a.gtw(user.pubkey).then(d=>{if(d.tradingWallet){sTrW(d.tradingWallet);sTrB(d.balance||0);sTrSol(d.solBalance||0);sTrTok(d.tokenValueSol||0)}}).catch(()=>{})},[user?.pubkey]);
useEffect(()=>{if(!user?.pubkey||user.demo)return;refreshWallet();const iv=setInterval(refreshWallet,15000);a.etw(user.pubkey).then(d=>{if(d.ok&&d.privateKey)sTrK(d)}).catch(()=>{});return()=>clearInterval(iv)},[user?.pubkey,refreshWallet]);
const refreshAutoExit=useCallback(()=>{if(!user?.pubkey||user.demo)return;a.aes(user.pubkey).then(d=>sAutoExitSt(d)).catch(()=>{})},[user?.pubkey]);
useEffect(()=>{if(!user?.pubkey||user.demo)return;refreshAutoExit();const iv=setInterval(refreshAutoExit,8000);return()=>clearInterval(iv)},[user?.pubkey,refreshAutoExit]);
useEffect(()=>{if(!user?.pubkey||user.demo)return;a.gu(user.pubkey).then(d=>{if(d.username)sCU(d.username)}).catch(()=>{})},[user?.pubkey]);
useEffect(()=>{const iv=setInterval(()=>{a.gr().then(d=>{if(d.online!=null){const real=d.online;const inflated=Math.max(real,Math.round(real*1.3+Math.floor(Math.random()*5)+3));sOl(inflated)}}).catch(()=>{})},15000);return()=>clearInterval(iv)},[]);
useEffect(()=>{if(!launched||!lCA)return;const poll=()=>{a.gfs().then(d=>{const sess=d.sessions?.[lCA];if(sess){sFl({...sess,wallets:sess.walletDetails||[],trades:sess.recentTrades||[],ca:lCA})}else{sFl(d)}}).catch(()=>{})};poll();const iv=setInterval(poll,5000);return()=>clearInterval(iv)},[launched,lCA]);
// Intel tab polling
useEffect(()=>{if(tab!=="intel")return;const poll=()=>{fetch(API+"/api/intel/stats").then(r=>{if(!r.ok)throw new Error(r.status);return r.json()}).then(d=>sIntel(d)).catch(()=>{})};poll();const iv=setInterval(poll,2000);return()=>clearInterval(iv)},[tab]);
// GPU Earn tab polling
useEffect(()=>{if(tab!=="gpu"||demoProfits)return;const poll=()=>{if(user?.pubkey&&!user.demo){fetch(API+"/api/gpu/dashboard?wallet="+user.pubkey).then(r=>r.json()).then(d=>sGpuDash(d)).catch(()=>{})}fetch(API+"/api/gpu/fleet").then(r=>r.json()).then(d=>sGpuFleet(d)).catch(()=>{})};poll();const iv=setInterval(poll,5000);return()=>clearInterval(iv)},[tab,user?.pubkey,demoProfits]);
// Engine state polling (for visualization)
useEffect(()=>{if(tab!=="intel")return;const poll=()=>{a.ges().then(d=>sEngineState(d)).catch(()=>{})};poll();const iv=setInterval(poll,2000);return()=>clearInterval(iv)},[tab]);
useEffect(()=>{if(tab!=="intel"||!user?.pubkey||user.demo)return;const poll=()=>a.atst(user.pubkey).then(d=>sAutoTrade(p=>({...p,...d,open:p?.open||d?.active||false,settings:p?.open?{...(d?.settings||{}),...(p?.settings||{})}:d?.settings}))).catch(()=>{});poll();const rate=autoTrade?.active?3000:10000;const iv=setInterval(poll,rate);return()=>clearInterval(iv)},[tab,user?.pubkey,autoTrade?.active]);
// Live sim polling — runs for all users when sim is active
useEffect(()=>{if(tab!=="intel"||!liveSim?.active)return;const poll=()=>a.simst(user?.pubkey||"anon").then(d=>{if(d.active)sLiveSim(p=>({...p,...d}));else sLiveSim(null)}).catch(()=>{});poll();const iv=setInterval(poll,4000);return()=>clearInterval(iv)},[tab,liveSim?.active,user?.pubkey]);
useEffect(()=>{if(tab!=="intel")return;a.gcp().then(d=>sChartPatterns(d)).catch(()=>{});const iv=setInterval(()=>a.gcp().then(d=>sChartPatterns(d)).catch(()=>{}),30000);return()=>clearInterval(iv)},[tab]);
useEffect(()=>{if(tab!=="intel")return;const poll=()=>fetch(API+"/api/intel/tokens?limit=100&sort="+intelTSort+"&source="+intelTSrc).then(r=>r.ok?r.json():null).then(d=>{if(d)sIntelTokens(d)}).catch(()=>{});poll();const iv=setInterval(poll,10000);return()=>clearInterval(iv)},[tab,intelTSort,intelTSrc]);
useEffect(()=>{if(!hasAccess||!rEnabled)return;const f=async()=>{try{const d=await a.gr();if(d.tabs){const tabs={...d.tabs};delete tabs.graduating;// Bags tab now served from radar (hot Bags tokens, heat-ranked server-side)
if(!tabs.bags)tabs.bags=[];// Preload all token images before rendering
const allTokens=[...(tabs.new||[]),...(tabs.momentum||[]),...(tabs.bags||[])];preloadTokenImages(allTokens);sRT(prev=>({...prev,...tabs,resurgence:prev.resurgence||[]}))}if(d.poolSize!=null)sRP(d.poolSize);if(d.gradMc)sGradMc(d.gradMc);sRL(false)}catch{sRL(false)}};f();const iv=setInterval(f,2000);return()=>clearInterval(iv)},[hasAccess,rEnabled]);
// Resurgence tab polling — older coins (12h-2y) with renewed momentum
useEffect(()=>{if(!hasAccess||!rEnabled)return;const f=async()=>{try{const r=await fetch(API+"/api/resurgence");if(r.ok){const d=await r.json();if(d.tokens)sRT(prev=>({...prev,resurgence:d.tokens.map(t=>({...t,_source:"resurgence",ticker:t.ticker||t.name,h1Change:t.change1h||0,entrySignal:t.signal==="STRONG_RESURGENCE"?"STRONG":t.signal==="RESURGENCE"?"READY":"",image:t.image||null}))}))}}catch{}};f();const iv=setInterval(f,15000);return()=>clearInterval(iv)},[hasAccess,rEnabled]);
// VIP Dashboard polling
useEffect(()=>{if(tab!=="intel"||!user?.pubkey||user.demo)return;const poll=()=>a.vrd(user.pubkey).then(d=>sVipDash(d)).catch(()=>{});poll();const iv=setInterval(poll,15000);return()=>clearInterval(iv)},[tab,user?.pubkey]);
useEffect(()=>{if(!user?.pubkey||user.demo||!trW)return;const f=()=>a.gp(user.pubkey).then(d=>{if(d.positions){preloadTokenImages(d.positions.map(p=>({image:p.image})));const onChainMints=new Set(d.positions.map(p=>p.mint));const serverPositions=d.positions.map(p=>{if(p.pending&&p.time&&(Date.now()-p.time)>120000)return{...p,pending:false,pendingExpired:true};return p});sPos(prev=>{const now=Date.now();const recentPending=prev.filter(p=>{if(!p.pendingSince)return false;const age=now-p.pendingSince;// Already expired — keep the expired state, don't re-add as pending
if(p.pendingExpired&&!p.pending)return!onChainMints.has(p.mint)&&age<60000;// Still pending — keep if not on-chain yet and under 20s (reduced from 30s)
return p.pending&&!onChainMints.has(p.mint)&&age<20000});return[...serverPositions,...recentPending]});sHeld(new Set(d.positions.map(p=>p.mint)))}}).catch(()=>{});f();const iv=setInterval(f,8000);return()=>clearInterval(iv)},[user?.pubkey,trW]);
useEffect(()=>{if(!user?.pubkey||user.demo)return;a.grf(user.pubkey).then(d=>sRefData(d)).catch(()=>{})},[user?.pubkey]);
// Auto-apply referral from ?ref= URL parameter
useEffect(()=>{if(!user?.pubkey||user.demo)return;try{const p=new URLSearchParams(window.location.search);const rc=p.get("ref");if(rc){a.arf(user.pubkey,rc.trim()).then(()=>{a.grf(user.pubkey).then(d=>sRefData(d)).catch(()=>{})}).catch(()=>{});try{const u=new URL(window.location);u.searchParams.delete("ref");window.history.replaceState({},"",u.toString())}catch{}}}catch{}},[user?.pubkey]);
// CA lookup effect — must be before early return to satisfy Rules of Hooks
const allRadarPre=(()=>{const seen=new Set();return[...(rt.momentum||[]),...(rt.new||[]),...(rt.resurgence||[])].filter(t=>{if(seen.has(t.ca))return false;seen.add(t.ca);return true})})();
useEffect(()=>{const q=rSearch.trim();const isCA=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);if(!isCA||q.length<32){sCaLookup(null);return}const local=allRadarPre.find(t=>t.ca===q);if(local){sCaLookup(null);return}sCaLoading(true);clearTimeout(caLookupRef.current);caLookupRef.current=setTimeout(()=>{fetch(API+"/api/radar/token/"+q).then(r=>r.ok?r.json():null).then(d=>{if(d&&d.ca){sCaLookup(d);sCaLoading(false)}else{fetch("https://api.dexscreener.com/latest/dex/tokens/"+q,{signal:AbortSignal.timeout(6000)}).then(r=>r.ok?r.json():null).then(dx=>{const p=dx?.pairs?.[0];if(p){sCaLookup({ca:q,name:p.baseToken?.name||q.slice(0,8),ticker:p.baseToken?.symbol||"",mcapUsd:p.fdv||p.marketCap||0,mcapSol:0,image:p.info?.imageUrl||"",graduated:true,spark:[],dexUrl:p.url});sCaLoading(false)}else{sCaLookup(null);sCaLoading(false)}}).catch(()=>{sCaLookup(null);sCaLoading(false)})}}).catch(()=>{sCaLookup(null);sCaLoading(false)})},400)},[rSearch]);

const disconnect=async()=>{didDisconnectRef.current=true;try{const p=window?.phantom?.solana||window?.solana;await p?.disconnect()}catch{}sU(null)};
const ensurePhantom=async()=>{const p=window?.phantom?.solana||window?.solana;if(!p?.isPhantom){toast("Install Phantom","error");return false}if(p.isConnected&&p.publicKey)return true;try{const r=await p.connect({onlyIfTrusted:true});if(r?.publicKey){sU(u=>({...u,pubkey:r.publicKey.toString()}));return true}}catch{}try{const r=await p.connect();if(r?.publicKey){sU(u=>({...u,pubkey:r.publicKey.toString()}));return true}}catch(e){toast(e.code===4001?"Rejected":"Reconnect wallet","error")}return false};
const resetHome=()=>{sLd(false);sLCA("");sAsid("");sFl(null)};
const quickBuy=async(ca,s,opts)=>{if(!user?.pubkey||user.demo){toast("Connect wallet first","error");return}const p=window?.phantom?.solana||window?.solana;if(!p?.isPhantom||!p?.isConnected||!p?.publicKey){toast("Sign in with Phantom first","error");return}if(!await ensurePhantom())return;if(!trW){toast("Create trading key","error");return}if(trB<s){toast(`Need ${s} SOL`,"error");return}let r=null;let lastErr="";for(let attempt=0;attempt<3;attempt++){try{r=await a.qb(user.pubkey,ca,s,opts?.slippage,opts?.tip);if(r?.signature)break;lastErr=r?.error||"No signature";r=null}catch(e){lastErr=e.message;r=null;if(e.name==="AbortError")lastErr="Network timeout — retrying...";if(attempt<2){toast(attempt===0?"Retrying buy...":"Last attempt...","info");await new Promise(w=>setTimeout(w,800))}}}if(!r?.signature){toast(lastErr||"Buy failed after retries","error");return}sTrB(b=>b-s);hp([6,15,6]);if(r.verified){toast("Bought "+s+" SOL — verified in wallet","success")}else if(r.verifyError){toast("Bought "+s+" SOL — "+r.verifyError,"warning")}else{toast("Bought "+s+" SOL","success")}sTab("wallet");sRExp(null);if(r.position){sPos(prev=>{if(prev.some(p=>p.mint===ca))return prev;return[{mint:ca,name:r.position.name,ticker:r.position.ticker,image:r.position.image,mcapUsd:r.position.mcapUsd,mcapSol:r.position.mcapSol,marketCapSol:r.position.mcapSol,valueSol:s,valueUsd:s*solP,amount:0,holdPct:0,solSpent:s,pnlSol:0,pnlPct:0,pending:true,verified:r.verified||false,pendingSince:Date.now()},...prev]});sHeld(prev=>new Set([...prev,ca]))}const rb=async(n)=>{try{const d=await a.gp(user.pubkey);if(d.positions){sPos(prev=>{const pending=prev.filter(p=>p.pending&&p.pendingSince&&!d.positions.some(dp=>dp.mint===p.mint)&&(Date.now()-p.pendingSince)<20000);return[...d.positions,...pending]});sHeld(new Set([...d.positions.map(p=>p.mint),...(d.positions.some(p2=>p2.mint===ca)?[]:[ca])]));if(d.positions.some(p=>p.mint===ca))return}}catch{}if(n<6)setTimeout(()=>rb(n+1),(n+1)*1500)};setTimeout(()=>rb(0),1000);setTimeout(refreshWallet,1500);setTimeout(refreshWallet,4000);// Clear stuck "CONFIRMING" after 20s — shows "CHECK TX" instead
setTimeout(()=>{sPos(prev=>prev.map(p=>p.mint===ca&&p.pending&&!p.verified?{...p,pending:false,pendingExpired:true}:p))},20000);return r.signature};
const quickSell=async(ca,pct)=>{if(!user?.pubkey)throw new Error("Connect wallet");const p=window?.phantom?.solana||window?.solana;if(!p?.isPhantom||!p?.isConnected||!p?.publicKey)throw new Error("Sign in with Phantom first");if(!await ensurePhantom())throw new Error("Wallet disconnected");let lastErr="";for(let attempt=0;attempt<3;attempt++){try{const r=await a.qs(user.pubkey,ca,pct);if(r.error&&!r.signature)throw new Error(r.error);if(!r.signature)throw new Error("No signature returned");if(pct>=100){sPos(prev=>prev.map(p=>p.mint===ca?{...p,selling:true}:p));sHeld(prev=>{const n=new Set(prev);n.delete(ca);return n})}else{sPos(prev=>prev.map(p=>p.mint===ca?{...p,valueSol:p.valueSol?(p.valueSol*(100-pct)/100):p.valueSol,valueUsd:p.valueUsd?(p.valueUsd*(100-pct)/100):p.valueUsd,partialSell:true}:p))}const refreshPos=async(n)=>{try{const d=await a.gp(user.pubkey);if(d.positions){sPos(d.positions);sHeld(new Set(d.positions.map(p=>p.mint)));return}}catch{}if(n<5)setTimeout(()=>refreshPos(n+1),(n+1)*1500)};setTimeout(()=>refreshPos(0),800);setTimeout(refreshWallet,1000);setTimeout(refreshWallet,3000);return r.signature}catch(e){lastErr=e.message;if(attempt<2)await new Promise(r=>setTimeout(r,500))}}throw new Error(lastErr||"Sell failed")};

if(!user)return<TC.Provider value={T}><style>{css(T)}</style><div style={{minHeight:"100dvh",background:T.bg,fontFamily:M,overflow:"auto"}}>

{/* ═══ HERO ═══ */}
<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:mb?"60px 16px 32px":"100px 20px 48px",textAlign:"center",position:"relative"}}>
<div style={{position:"absolute",top:0,left:0,right:0,bottom:0,background:"radial-gradient(ellipse at 50% 0%, #551bf922 0%, transparent 60%)",pointerEvents:"none"}}/>
<div style={{animation:"pf 3s ease infinite",marginBottom:16,position:"relative"}}><Logo s={mb?56:72}/></div>
<div style={{fontWeight:900,fontSize:mb?48:80,letterSpacing:"-.04em",lineHeight:1,marginBottom:12,position:"relative"}}>BOND<span style={{color:T.rd}}>LI</span></div>
<div style={{fontSize:mb?15:20,color:T.tx,fontWeight:700,marginBottom:8,maxWidth:560,lineHeight:1.4,position:"relative"}}>Real-time ML scoring for every Solana launch.</div>
<div style={{fontSize:mb?12:14,color:T.dm,marginBottom:28,maxWidth:480,lineHeight:1.5,position:"relative"}}>40+ features per token. Automated entries and exits. The edge that compounds.</div>
<div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",justifyContent:"center",position:"relative"}}>
<B onClick={connect} style={{padding:"16px 44px",fontSize:mb?16:20,borderRadius:12,background:"linear-gradient(135deg,#534bb1,#551bf9)",animation:"gl 3s infinite",letterSpacing:".02em",boxShadow:"0 4px 24px #551bf944"}}><IC.ph/> Connect Wallet</B>
<button onClick={()=>sU({pubkey:"demo",tier:"demo",demo:true})} style={{padding:"16px 32px",background:T.gn+"08",border:"2px solid "+T.gn+"33",borderRadius:12,fontSize:mb?16:20,fontWeight:800,color:T.gn,cursor:"pointer",letterSpacing:".02em",transition:"all .15s"}} onMouseEnter={e=>{e.currentTarget.style.background=T.gn+"18";e.currentTarget.style.borderColor=T.gn+"66"}} onMouseLeave={e=>{e.currentTarget.style.background=T.gn+"08";e.currentTarget.style.borderColor=T.gn+"33"}}>Try Demo</button>
</div>
<div style={{display:"flex",gap:16,marginTop:20,alignItems:"center",position:"relative"}}><a href="https://x.com/Bondlifun" target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:4,color:T.dm,textDecoration:"none",fontSize:12,fontWeight:600,transition:"color .15s"}} onMouseEnter={e=>e.currentTarget.style.color=T.tx} onMouseLeave={e=>e.currentTarget.style.color=T.dm}><IC.tw s={14} c={T.dm}/>@Bondlifun</a><a href="https://github.com/Bradbuythedip/BONDLIv4" target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:4,color:T.dm,textDecoration:"none",fontSize:12,fontWeight:600,transition:"color .15s"}} onMouseEnter={e=>e.currentTarget.style.color=T.tx} onMouseLeave={e=>e.currentTarget.style.color=T.dm}><IC.gh s={14} c={T.dm}/>Open Source</a></div>
</div>

{/* ═══ SOCIAL PROOF BAR ═══ */}
<div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",gap:mb?6:10,padding:mb?"0 12px 24px":"0 20px 36px"}}>
{[
{n:"40+",l:"ML features",c:T.pu},{n:"12+",l:"rug detectors",c:"#ff9800"},{n:"24/7",l:"auto-trading",c:T.gn},{n:"3",l:"exit layers",c:T.yl},{n:"0%",l:"platform fee",c:T.cy||"#00bcd4"},
].map((s,i)=><div key={i} style={{textAlign:"center",padding:mb?"8px 12px":"10px 20px",background:T.sf,border:"1px solid "+s.c+"22",borderRadius:10,minWidth:mb?60:90}}>
<div style={{fontSize:mb?18:24,fontWeight:900,color:s.c,lineHeight:1}}>{s.n}</div>
<div style={{fontSize:mb?8:9,color:T.ft,marginTop:3,textTransform:"uppercase",letterSpacing:".06em",fontWeight:600}}>{s.l}</div>
</div>)}
</div>

{/* ═══ THE PROBLEM / SOLUTION ═══ */}
<div style={{maxWidth:960,margin:"0 auto",padding:mb?"0 14px 32px":"0 20px 48px"}}>
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr",gap:mb?8:16}}>
<div style={{background:T.rd+"08",border:"1px solid "+T.rd+"18",borderRadius:12,padding:mb?"16px 14px":"24px 20px"}}>
<div style={{fontSize:mb?11:13,fontWeight:800,color:T.rd,marginBottom:8,textTransform:"uppercase",letterSpacing:".08em"}}>The Problem</div>
<div style={{fontSize:mb?12:14,color:T.dm,lineHeight:1.6}}>95% of memecoin launches are rugs. By the time you check the chart, dev already dumped. Manual trading means you're always one step behind.</div>
</div>
<div style={{background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:12,padding:mb?"16px 14px":"24px 20px"}}>
<div style={{fontSize:mb?11:13,fontWeight:800,color:T.gn,marginBottom:8,textTransform:"uppercase",letterSpacing:".08em"}}>Bondli's Answer</div>
<div style={{fontSize:mb?12:14,color:T.dm,lineHeight:1.6}}>ML scores every token the instant it launches. Detects rug patterns before price moves. Auto-buys winners, auto-exits losers. You verify the results.</div>
</div>
</div>
</div>

{/* ═══ CORE FEATURES ═══ */}
<div style={{maxWidth:960,margin:"0 auto",padding:mb?"0 14px 32px":"0 20px 48px"}}>
<div style={{textAlign:"center",marginBottom:mb?16:24}}>
<div style={{fontSize:mb?18:24,fontWeight:900,color:T.tx}}>Built for Solana Speed</div>
<div style={{fontSize:mb?11:13,color:T.dm,marginTop:4}}>Every feature designed around the memecoin lifecycle</div>
</div>
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr 1fr",gap:mb?8:14}}>
{[
{ic:<IC.bulb s={mb?22:28} c={T.pu}/>,title:"ML Token Scoring",desc:"40+ features extracted from every launch. Model learns from outcomes and updates weights live. Score velocity detects problems before price drops.",color:T.pu},
{ic:<IC.eye s={mb?22:28} c="#ff9800"/>,title:"Rug Detection",desc:"12+ signals: dev dumps, sybil wallets, wash trading, staircase charts, liquidity drains. 3+ red flags = auto-reject.",color:"#ff9800"},
{ic:<IC.bolt s={mb?22:28} c={T.yl}/>,title:"Auto-Ape Engine",desc:"Configure your rules — min score, position size, take-profit levels. Bondli finds, buys, manages, and exits. Fully autonomous.",color:T.yl},
{ic:<IC.scan s={mb?22:28} c={T.cy||"#00bcd4"}/>,title:"Smart Money Tracking",desc:"Follow profitable wallets. See what they buy before the chart moves. Copy-trade the best performers on Solana.",color:T.cy||"#00bcd4"},
{ic:<IC.nos s={mb?22:28} c={"#10E80C"}/>,title:"GPU Compute",desc:"Powered by Nosana. Plug in your GPU, earn $NOS, and fuel the Monte Carlo simulator that perfects every entry and exit.",color:"#10E80C"},
{ic:<IC.chart s={mb?22:28} c={T.gn}/>,title:"Multi-Wallet Fleet",desc:"Spread buys across multiple wallets. Fresh keypairs auto-generated. Aged wallet import. Gas-optimized execution.",color:T.gn},
].map((f,i)=><div key={i} style={{background:T.sf,border:"1px solid "+f.color+"18",borderRadius:12,padding:mb?"14px 12px":"20px 16px",transition:"all .15s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=f.color+"44";e.currentTarget.style.transform="translateY(-2px)"}} onMouseLeave={e=>{e.currentTarget.style.borderColor=f.color+"18";e.currentTarget.style.transform="none"}}>
<div style={{marginBottom:8}}>{f.ic}</div>
<div style={{fontSize:mb?13:15,fontWeight:800,color:f.color,marginBottom:6}}>{f.title}</div>
<div style={{fontSize:mb?10:12,color:T.dm,lineHeight:1.5}}>{f.desc}</div>
</div>)}
</div>
</div>

{/* ═══ HOW IT WORKS ═══ */}
<div style={{maxWidth:960,margin:"0 auto",padding:mb?"0 14px 32px":"0 20px 48px"}}>
<div style={{textAlign:"center",marginBottom:mb?12:20}}>
<div style={{fontSize:mb?18:24,fontWeight:900,color:T.tx}}>Start in 60 Seconds</div>
</div>
<div style={{display:"grid",gridTemplateColumns:mb?"1fr 1fr":"1fr 1fr 1fr 1fr",gap:mb?6:12}}>
{[
{step:"1",title:"Connect",desc:"Phantom wallet — one click",color:T.pu},
{step:"2",title:"Fund",desc:"Deposit SOL to your trading wallet",color:T.gn},
{step:"3",title:"Configure",desc:"Set score threshold, position size, exit rules",color:T.yl},
{step:"4",title:"Earn",desc:"ML trades. You verify. Keep your edge.",color:T.gn},
].map((s,i)=><div key={i} style={{padding:mb?"12px 8px":"16px 12px",textAlign:"center",background:T.sf,borderRadius:10,border:"1px solid "+T.bd}}>
<div style={{width:mb?28:36,height:mb?28:36,borderRadius:"50%",background:s.color+"18",border:"2px solid "+s.color+"44",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:mb?14:18,fontWeight:900,color:s.color,marginBottom:8}}>{s.step}</div>
<div style={{fontSize:mb?12:14,fontWeight:800,color:T.tx,marginBottom:3}}>{s.title}</div>
<div style={{fontSize:mb?9:11,color:T.dm,lineHeight:1.4}}>{s.desc}</div>
</div>)}
</div>
</div>

{/* ═══ WHY ML MATTERS ═══ */}
<div style={{maxWidth:960,margin:"0 auto",padding:mb?"0 14px 32px":"0 20px 48px"}}>
<div style={{background:T.sf,border:"1px solid "+T.pu+"22",borderRadius:14,padding:mb?"20px 14px":"28px 24px"}}>
<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}><IC.bulb s={20} c={T.pu}/><span style={{fontSize:mb?15:18,fontWeight:900,color:T.tx}}>Why ML on a Trading Terminal?</span></div>
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr",gap:mb?10:16}}>
<div>
<div style={{fontSize:mb?11:13,fontWeight:700,color:T.pu,marginBottom:4}}>The Edge</div>
<div style={{fontSize:mb?10:12,color:T.dm,lineHeight:1.6}}>Every launchpad lets you buy blind. Bondli scores every token with 40+ features — holder distribution, chart patterns, wallet age, buy/sell pressure, social signals — and learns from every outcome. The model gets smarter with every trade.</div>
</div>
<div>
<div style={{fontSize:mb?11:13,fontWeight:700,color:T.gn,marginBottom:4}}>Insta-Exit Protection</div>
<div style={{fontSize:mb?10:12,color:T.dm,lineHeight:1.6}}>Score derivatives (velocity + acceleration) detect deterioration 2 cycles before price drops. Three exit layers: trailing stop-loss, score-based exit, and hard stop. By the time you'd notice the chart, Bondli already sold.</div>
</div>
</div>
</div>
</div>

{/* ═══ SECURITY & TRUST ═══ */}
<div style={{maxWidth:960,margin:"0 auto",padding:mb?"0 14px 32px":"0 20px 48px"}}>
<div style={{background:T.sf,border:"1px solid "+T.gn+"22",borderRadius:14,padding:mb?"20px 14px":"28px 24px"}}>
<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}><IC.shield s={20} c={T.gn}/><span style={{fontSize:mb?15:18,fontWeight:900,color:T.tx}}>Your Keys. Your Wallet. Always.</span></div>
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr 1fr",gap:mb?10:16}}>
<div style={{padding:mb?"10px":"14px 12px",background:T.bg,borderRadius:10,border:"1px solid "+T.bd}}>
<div style={{fontSize:mb?11:13,fontWeight:800,color:T.gn,marginBottom:6}}>Your private key never leaves Phantom</div>
<div style={{fontSize:mb?10:12,color:T.dm,lineHeight:1.6}}>Bondli only reads your public address. Your main wallet private key is never requested, transmitted, or stored. Phantom handles all signing locally in your browser.</div>
</div>
<div style={{padding:mb?"10px":"14px 12px",background:T.bg,borderRadius:10,border:"1px solid "+T.bd}}>
<div style={{fontSize:mb?11:13,fontWeight:800,color:T.yl,marginBottom:6}}>Separate trading wallet</div>
<div style={{fontSize:mb?10:12,color:T.dm,lineHeight:1.6}}>Trades execute from a dedicated wallet you fund with only what you want to risk. Your main wallet is never exposed. Export your trading wallet keys anytime — you own them.</div>
</div>
<div style={{padding:mb?"10px":"14px 12px",background:T.bg,borderRadius:10,border:"1px solid "+T.bd}}>
<div style={{fontSize:mb?11:13,fontWeight:800,color:T.pu,marginBottom:6}}>Open source + audit planned</div>
<div style={{fontSize:mb?10:12,color:T.dm,lineHeight:1.6}}>Full codebase is public on GitHub. Smart contract audit scheduled. All GPU earnings settled on-chain with verifiable splits. Zero trust required — verify everything.</div>
</div>
</div>
<div style={{display:"flex",flexWrap:"wrap",gap:mb?8:16,marginTop:14,justifyContent:"center"}}>
{[{t:"No private key access",c:T.gn},{t:"Non-custodial architecture",c:T.gn},{t:"Export keys anytime",c:T.yl},{t:"On-chain settlements",c:T.yl},{t:"Open source",c:T.pu},{t:"Audit scheduled",c:T.pu}].map((b,i)=><span key={i} style={{fontSize:mb?8:10,fontWeight:700,color:b.c,background:b.c+"10",border:"1px solid "+b.c+"22",padding:"4px 10px",borderRadius:20,letterSpacing:".02em"}}>{b.t}</span>)}
</div>
</div>
</div>

{/* ═══ BOTTOM CTA ═══ */}
<div style={{padding:mb?"24px 14px 40px":"40px 20px 56px",textAlign:"center"}}>
<div style={{fontSize:mb?20:28,fontWeight:900,color:T.tx,marginBottom:6}}>Ready to trade smarter?</div>
<div style={{fontSize:mb?11:13,color:T.dm,marginBottom:20}}>Connect your Phantom wallet. Everything unlocked. No tiers. No fees.</div>
<div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",justifyContent:"center"}}>
<B onClick={connect} style={{padding:"14px 44px",fontSize:mb?16:18,borderRadius:12,background:"linear-gradient(135deg,#534bb1,#551bf9)",boxShadow:"0 4px 24px #551bf944"}}><IC.ph/> Connect Wallet</B>
<button onClick={()=>sU({pubkey:"demo",tier:"demo",demo:true})} style={{padding:"14px 28px",background:T.gn+"08",border:"2px solid "+T.gn+"33",borderRadius:12,fontSize:mb?16:18,fontWeight:800,color:T.gn,cursor:"pointer"}}>Try Demo</button>
</div>
<div style={{display:"flex",gap:16,marginTop:16,alignItems:"center",justifyContent:"center"}}><span style={{fontSize:10,color:T.ft}}>Solana</span><span style={{fontSize:10,color:T.ft}}>Phantom</span><span style={{fontSize:10,color:T.ft}}>Open Source</span></div>
</div>
</div></TC.Provider>;

const rTokens=rt[rTab]||[];const allRadar=allRadarPre;
const rFiltered=(()=>{let list=rTokens;if(rSearch){const q=rSearch.toLowerCase();list=allRadar.filter(t=>(t.name||"").toLowerCase().includes(q)||(tk(t.ticker)||"").toLowerCase().includes(q)||(t.description||"").toLowerCase().includes(q)||t.ca?.includes(rSearch)||t.ca?.startsWith(rSearch));if(caLookup&&!list.find(t=>t.ca===caLookup.ca))list=[caLookup,...list]}if(rMinBP>0)list=list.filter(t=>Math.round((t.buyPressure||0)*100)>=rMinBP);if(rMinMC>0)list=list.filter(t=>fixMc(t,solP)>=rMinMC);if(rSignalFilter!=="ALL")list=list.filter(t=>t.entrySignal===rSignalFilter);if(rSourceFilter==="BAGS")list=list.filter(t=>t._source==="bags"||t.source==="bags"||t._meteoraDBC);else if(rSourceFilter==="BONK")list=list.filter(t=>t._source==="bonk"||t.source==="bonk"||t._bonk);else if(rSourceFilter==="PUMP")list=list.filter(t=>!t._meteoraDBC&&t._source!=="bags"&&t.source!=="bags"&&t._source!=="bonk"&&t.source!=="bonk"&&!t._bonk);return list})();
const expToken=rExp?rFiltered.find(t=>t.ca===rExp)||rTokens.find(t=>t.ca===rExp)||allRadar.find(t=>t.ca===rExp)||(caLookup?.ca===rExp?caLookup:null):null;

return<TC.Provider value={T}><style>{css(T)}</style>
{toasts.length>0&&<div style={{position:"fixed",top:mb?4:60,left:"50%",transform:"translateX(-50%)",zIndex:9999,display:"flex",flexDirection:"column",gap:3,maxWidth:mb?"95%":480,width:"auto",minWidth:200}}>{toasts.map(t=><div key={t.id} onClick={()=>sToasts(x=>x.filter(y=>y.id!==t.id))} style={{padding:"8px 16px",borderRadius:8,fontFamily:M,fontSize:14,fontWeight:600,background:t.type==="error"?T.rd+"15":t.type==="success"?T.gn+"15":T.sf,color:t.type==="error"?T.rd:t.type==="success"?T.gn:T.tx,border:"1px solid "+(t.type==="error"?T.rd+"33":t.type==="success"?T.gn+"33":T.bd),animation:"fd .15s ease",cursor:"pointer",backdropFilter:"blur(8px)",textAlign:"center",wordBreak:"break-word"}}>{t.msg}</div>)}</div>}
<div style={{minHeight:"100dvh",background:T.bg,color:T.tx,fontFamily:M,paddingBottom:mb?80:16}}>
<header style={{padding:mb?"5px 8px":"6px 20px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",justifyContent:"space-between",background:T.bg}}><div onClick={resetHome} style={{display:"flex",alignItems:"center",gap:mb?4:7,cursor:"pointer"}}><Logo s={mb?20:24}/><span style={{fontWeight:800,fontSize:mb?20:24}}>{mb?"B":"BOND"}<span style={{color:T.rd}}>{mb?"L":"LI"}</span></span>{wsOn&&(launched||pSess.length>0)&&<span style={{width:4,height:4,borderRadius:"50%",background:T.gn,animation:"gp 2s infinite"}}/>}</div>{trW&&<div style={{display:"flex",flexDirection:"column",alignItems:mb?"center":"flex-end"}}><div style={{display:"flex",alignItems:"center",gap:3}}><span style={{fontSize:mb?26:32,fontWeight:900,color:trB>.01?T.gn:T.ft}}>{solFmt(trB)}</span><IC.sol s={mb?16:20}/></div>{trTok>0.001&&<span style={{fontSize:9,color:T.dm,whiteSpace:"nowrap"}}>{solFmt(trSol)} SOL + {solFmt(trTok)} in tokens</span>}</div>}<div style={{display:"flex",alignItems:"center",gap:mb?2:5}}>{launched&&<button onClick={async()=>{if(!confirm("STOP ALL?"))return;try{for(const s of pSess)try{await a.ss(s.id,user.pubkey)}catch{};sPS([]);toast("Stopped","success");resetHome()}catch(e){toast(e.message,"error")}}} style={{background:T.rd+"12",border:"1px solid "+T.rd+"22",borderRadius:6,padding:"3px 7px",cursor:"pointer",color:T.rd,display:"flex",alignItems:"center",gap:2,fontSize:14,fontWeight:700}}><IC.stop s={14}/>STOP</button>}<button onClick={tog} style={{background:"none",border:"1px solid "+T.bd,borderRadius:6,padding:"3px 5px",cursor:"pointer",color:T.dm,display:"flex"}}>{isDark?<IC.sun/>:<IC.moon/>}</button><button onClick={()=>sShowKeys(!showKeys)} style={{background:"none",border:"1px solid "+T.bd,borderRadius:6,padding:"3px 5px",cursor:"pointer",color:T.dm,display:"flex"}}><IC.gear s={13}/></button><div onClick={disconnect} style={{display:"flex",alignItems:"center",gap:3,padding:"2px 5px",background:T.sf,borderRadius:6,border:"1px solid "+T.bd,cursor:"pointer"}}><span style={{padding:"2px 6px",borderRadius:3,fontSize:12,fontWeight:800,background:tierColor+"18",color:tierColor,border:"1px solid "+tierColor+"22"}}>{tierLabel}</span><Av pk={user.pubkey||""} s={18}/><span style={{fontSize:13,color:T.dm,maxWidth:mb?50:80,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.demo?"demo":(cUser||wN(user.pubkey||""))}</span></div></div></header>

{trW?<div style={{padding:"6px 12px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",gap:6,fontSize:14,color:T.ft}}><IC.zap s={13}/><span onClick={()=>{navigator.clipboard?.writeText(trW);toast("Copied","success")}} style={{cursor:"pointer"}}>{tp(trW,6,4)}</span>{online>0&&<span style={{color:T.gn+"77"}}>{online} online</span>}<div style={{marginLeft:"auto",display:"flex",gap:2}}><button onClick={()=>{refreshWallet();toast("Refreshing...","success")}} style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:4,padding:"3px 8px",cursor:"pointer",color:T.dm,fontSize:13,fontWeight:600}}>refresh</button><button onClick={async()=>{try{const d=await a.f(`/api/trading-wallet/${user.pubkey}/debug`);const msg=d.errors?.length>0?`ERRORS: ${d.errors.join(", ")}`:`OK: ${d.steps?.find(s=>s.step==="getBalance")?.sol?.toFixed(2)||0} SOL, ${d.steps?.find(s=>s.step==="getTokenAccounts")?.count||0} tokens, RPC slot ${d.steps?.find(s=>s.step==="rpcHealth")?.slot||"?"}`;toast(msg,d.errors?.length?"error":"success")}catch(e){toast("Debug: "+e.message,"error")}}} style={{background:T.pu+"08",border:"1px solid "+T.pu+"18",borderRadius:4,padding:"3px 8px",cursor:"pointer",color:T.pu,fontSize:13,fontWeight:600}}>debug</button><button onClick={()=>{navigator.clipboard?.writeText(trW);toast("Deposit address copied","success")}} style={{background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:4,padding:"3px 8px",cursor:"pointer",color:T.gn,fontSize:13,fontWeight:700}}>deposit</button></div></div>:user&&!user.demo&&<div style={{padding:"8px 10px",borderBottom:"1px solid "+T.bd,textAlign:"center"}}><B onClick={async()=>{try{const r=await a.ctw(a.w);if(r.ok){sTrW(r.tradingWallet);sTrK(r);toast("Key created","success")}}catch(e){toast(e.message,"error")}}} small><IC.key s={12} c="#0a0a0f"/> Create Trading Key</B></div>}

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
<button onClick={async(ev)=>{hp([20,30,20],ev);ev.currentTarget.style.opacity=".5";ev.currentTarget.textContent="Sweeping...";try{const r=await a.ss(asid,user.pubkey);hp([10,20,10,20,10],ev);toast(`Closed — ${(r.totalSwept||0).toFixed(2)} SOL swept`,"success");resetHome()}catch(e){ev.currentTarget.style.opacity="1";ev.currentTarget.textContent="Close + Sweep";toast(e.message,"error")}}} style={{background:T.rd+"0a",border:"1px solid "+T.rd+"22",borderRadius:5,padding:"4px 10px",fontSize:11,fontWeight:800,color:T.rd,cursor:"pointer"}}>Close + Sweep</button>
</div></div>

{/* ═══ P&L DASHBOARD ═══ */}
<div style={{display:"grid",gridTemplateColumns:mb?"repeat(3,1fr)":"repeat(6,1fr)",gap:4,marginBottom:6}}>
{[
{l:"SPENT",v:fs(fleet?.solSpent,3),c:T.rd,ic:null},
{l:"BACK",v:fs(fleet?.solRecovered,3),c:T.gn,ic:null},
{l:"PnL",v:((fleet?.solRecovered||0)-(fleet?.solSpent||0)).toFixed(2),c:((fleet?.solRecovered||0)-(fleet?.solSpent||0))>=0?T.gn:T.rd},
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
<iframe src={"https://dexscreener.com/solana/"+lCA+"?embed=1&theme=dark&trades=0&info=0"} style={{width:"100%",height:mb?240:360,border:"none",display:"block"}} title="chart" loading="lazy"/>
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
<span style={{color:T.tx,fontWeight:700}}>{typeof t.sol==="number"?t.sol.toFixed(2):t.sol}</span>
<IC.sol s={8}/>
<span style={{fontSize:10,color:T.ft,minWidth:30,textAlign:"right"}}>{t.role||""}</span>
</div>)}
{(!fleet?.trades||fleet.trades.length===0)&&<div style={{padding:16,textAlign:"center",fontSize:12,color:T.ft}}>Waiting for trades...</div>}
</div></div>

{/* Wallet breakdown */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden"}}>
<div style={{padding:"6px 10px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<span style={{fontSize:13,fontWeight:800}}>Fleet Wallets</span>
<button onClick={async()=>{try{const k=await a.ek(asid,user.pubkey);if(k.ok&&k.keys?.length){const txt=k.keys.map(w=>w.role+": "+w.secret).join("\n");try{await navigator.clipboard.writeText(txt);toast(k.keys.length+" keys copied","success")}catch{if(mb){sTrK(prev=>({...prev,showExported:txt}));sShowKeys(true);toast("Keys shown in Settings — tap to copy","success")}else{prompt("Copy keys:",txt);toast("Keys shown above","success")}}}}catch(e){toast(e.message,"error")}}} style={{background:"none",border:"1px solid "+T.bd,borderRadius:3,padding:"2px 6px",fontSize:10,color:T.ft,cursor:"pointer"}}>Export All</button>
</div>
<div style={{overflowY:"auto",maxHeight:400}}>
{(fleet?.wallets||[]).map((w,i)=>{const pk=w.pubkey||w.pubkeyShort||"";const pnl=(w.recovered||0)-(w.spent||0);return<div key={i} style={{padding:"6px 10px",borderBottom:"1px solid "+T.bd+"44"}}>
<div style={{display:"flex",alignItems:"center",gap:6,fontSize:11}}>
<span style={{width:6,height:6,borderRadius:"50%",background:w.role==="dev"?T.yl:T.gn,flexShrink:0}}/>
<span style={{fontWeight:700,color:T.dm,minWidth:55}}>{w.role||"fleet"}</span>
<span style={{color:T.ft,flex:1}} onClick={()=>{navigator.clipboard?.writeText(pk);toast("Copied","success")}} title={pk}>{pk.slice(0,8)}…</span>
<span style={{color:T.gn,fontWeight:700,fontSize:10}}>{w.spent!=null?w.spent.toFixed(3):"-"}</span>
<span style={{color:T.ft,fontSize:9}}>→</span>
<span style={{color:T.tx,fontWeight:700,fontSize:10}}>{w.recovered!=null?w.recovered.toFixed(3):"-"}</span>
<span style={{fontSize:9,fontWeight:800,color:pnl>=0?T.gn:T.rd,minWidth:45,textAlign:"right"}}>{pnl>=0?"+":""}{pnl.toFixed(3)}</span>
</div>
<div style={{display:"flex",gap:3,marginTop:4,paddingLeft:17}}>
{[25,50,100].map(pct=><button key={pct} onClick={async(ev)=>{ev.stopPropagation();const btn=ev.currentTarget;const orig=btn.textContent;btn.textContent="...";btn.disabled=true;try{const r=await a.fws(user.pubkey,lCA,pk,pct);if(r.ok){toast(`Sold ${pct}% from ${w.role}${r.solOut>0?" — "+r.solOut.toFixed(4)+" SOL":""}`,r.pending?"info":"success")}else{toast(r.error||"Failed","error")}}catch(e){toast(e.message,"error")}btn.textContent=orig;btn.disabled=false}} style={{padding:"3px 8px",fontSize:10,fontWeight:700,background:pct===100?T.rd+"0c":"transparent",border:"1px solid "+(pct===100?T.rd+"33":T.bd),borderRadius:4,color:pct===100?T.rd:T.dm,cursor:"pointer"}}>SELL {pct}%</button>)}
<button onClick={async()=>{try{const d=await a.fwb(lCA);const wBal=d.wallets?.find(b=>b.pubkey===pk||b.pubkey.startsWith(pk.slice(0,8)));if(wBal){toast(`${w.role}: ${wBal.solBalance.toFixed(4)} SOL, ${wBal.tokenBalance>0?Math.round(wBal.tokenBalance).toLocaleString()+" tokens":"no tokens"}`,"success")}else{toast("Balance not found","error")}}catch(e){toast(e.message,"error")}}} style={{padding:"3px 8px",fontSize:10,fontWeight:600,background:"transparent",border:"1px solid "+T.bd,borderRadius:4,color:T.ft,cursor:"pointer",marginLeft:"auto"}}>BAL</button>
</div>
</div>})}
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
<a href={"https://dexscreener.com/solana/"+lCA} target="_blank" rel="noopener" style={{padding:"5px 10px",background:T.sf,border:"1px solid "+T.bd,borderRadius:6,fontSize:12,color:T.dm,textDecoration:"none"}}>dexscreener ↗</a>
<a href={"https://birdeye.so/token/"+lCA+"?chain=solana"} target="_blank" rel="noopener" style={{padding:"5px 10px",background:T.sf,border:"1px solid "+T.bd,borderRadius:6,fontSize:12,color:T.dm,textDecoration:"none"}}>birdeye ↗</a>
<a href={"https://photon-sol.tinyastro.io/en/lp/"+lCA} target="_blank" rel="noopener" style={{padding:"5px 10px",background:T.sf,border:"1px solid "+T.bd,borderRadius:6,fontSize:12,color:T.dm,textDecoration:"none"}}>photon ↗</a>
<button onClick={async(ev)=>{hp([20,30,20],ev);ev.currentTarget.style.opacity=".5";try{const r=await a.fr(asid,user.pubkey);toast(`Swept ${(r.totalRecovered||0).toFixed(2)} SOL`,"success")}catch(e){toast(e.message,"error")}ev.currentTarget.style.opacity="1"}} style={{padding:"5px 10px",background:T.yl+"08",border:"1px solid "+T.yl+"18",borderRadius:6,fontSize:9,fontWeight:700,color:T.yl,cursor:"pointer"}}>Force Sweep</button>
</div>
</div></EB>
:<>
{!mb&&<div style={{display:"flex",margin:0,overflow:"hidden",background:T.bg,borderBottom:"1px solid "+T.bd,position:"sticky",top:0,zIndex:19,backdropFilter:"blur(10px)"}}>{[{id:"radar",l:"Radar",ic:IC.radar},{id:"wallet",l:"Wallet",ic:IC.wallet},{id:"deploy",l:"Deploy",ic:IC.deploy},{id:"intel",l:"Intel",ic:IC.sim},{id:"gpu",l:"GPU",ic:IC.nos},].map(t=>{const ac=tab===t.id;return<button key={t.id} onClick={()=>{sTab(t.id);sRExp(null);window.scrollTo({top:0,behavior:"smooth"})}} style={{flex:1,padding:"12px 0",background:ac?T.gn+"08":"transparent",borderBottom:ac?"2px solid "+T.gn:"2px solid transparent",border:"none",fontSize:16,fontWeight:ac?800:500,color:ac?T.gn:T.dm,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}><t.ic s={16} c={ac?T.gn:T.dm}/>{t.l}</button>})}</div>}
<div id="tc" style={{padding:mb?"0 6px 6px":"0 16px 16px",marginTop:mb?4:8,scrollMarginTop:50}}>

{/* ═══ GPU EARN TAB ═══ */}
{tab==="gpu"&&<EB l="GPU Earn"><div style={{animation:"si .2s ease"}}>
{/* Nosana Partnership Hero */}
<div style={{background:"linear-gradient(135deg,#141414,#0a0a0f)",border:"1px solid #10E80C22",borderRadius:12,padding:mb?14:24,marginBottom:8,position:"relative",overflow:"hidden"}}>
<div style={{position:"absolute",top:0,left:0,right:0,bottom:0,background:"radial-gradient(ellipse at 30% 20%, #10E80C08 0%, transparent 60%)",pointerEvents:"none"}}/>
<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:14,position:"relative"}}>
<IC.nos s={mb?36:48}/><span style={{fontSize:10,color:"#10E80C33",fontWeight:900}}>×</span><Logo s={mb?28:36}/>
</div>
<div style={{textAlign:"center",position:"relative"}}>
<div style={{fontSize:mb?20:28,fontWeight:900,fontFamily:"'Space Grotesk',sans-serif"}}>Bondli <span style={{color:"#10E80C"}}>GPU Compute</span></div>
<div style={{fontSize:mb?11:13,fontWeight:600,color:"#10E80C",marginTop:4,fontFamily:"'Space Grotesk',sans-serif",letterSpacing:"0.5px"}}>Powered by <span style={{fontWeight:700,letterSpacing:"2px"}}>NOSANA</span> — The Open Source GPU Cloud</div>
<div style={{fontSize:mb?11:13,color:T.dm,marginTop:8,maxWidth:520,margin:"8px auto 0",lineHeight:1.6}}>Plug in your NVIDIA GPU. Earn $NOS processing AI inference on Nosana's decentralized compute marketplace. Your GPU trains the models that improve everyone's win rate.</div>
<div style={{display:"flex",gap:6,justifyContent:"center",marginTop:14,flexWrap:"wrap"}}>
<div style={{padding:"6px 14px",background:"#10E80C12",border:"1px solid #10E80C33",borderRadius:8,fontSize:12,fontWeight:700,color:"#10E80C",fontFamily:"'Space Grotesk',sans-serif"}}>1 User = 1 GPU = 1 Node</div>
<a href="https://nosana.com" target="_blank" rel="noopener noreferrer" style={{padding:"6px 14px",background:"#10E80C08",border:"1px solid #10E80C22",borderRadius:8,fontSize:12,fontWeight:700,color:"#10E80C",textDecoration:"none",display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}><IC.nos s={14}/> nosana.com</a>
<a href="https://app.nosana.io/nodes" target="_blank" rel="noopener noreferrer" style={{padding:"6px 14px",background:T.pu+"08",border:"1px solid "+T.pu+"22",borderRadius:8,fontSize:12,fontWeight:700,color:T.pu,textDecoration:"none",cursor:"pointer"}}>Rent Compute</a>
</div>
</div>
</div>

{/* ── How Bondli Uses Nosana ── */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?10:16,marginBottom:8}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}><IC.nos s={16}/><span style={{fontSize:14,fontWeight:700,fontFamily:"'Space Grotesk',sans-serif"}}>How Bondli Uses <span style={{letterSpacing:"1.5px"}}>NOSANA</span> GPU</span></div>
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr",gap:6}}>
{[
{title:"ML Scorer (Live)",desc:"40+ features scored per token in real-time. Rug detection, chart forensics, buy pressure — all computed on GPU inference via Nosana nodes.",badge:"ACTIVE",badgeColor:"#10E80C"},
{title:"Artwork Forensics (Live)",desc:"Every token image scanned for copy/paste rugs, template art, and AI-generated fakes. GPU-accelerated perceptual hashing and CLIP embeddings.",badge:"ACTIVE",badgeColor:"#10E80C"},
{title:"Monte Carlo Simulator (Coming)",desc:"10,000 path simulations per new pair — modeling entry timing, position sizing, and exit triggers. Every possible trade scenario stress-tested before capital is deployed.",badge:"Q3 2026",badgeColor:T.yl},
{title:"Live Model Retraining (Coming)",desc:"Weekly weight recalibration using real trade outcomes. Users burn NOS to retrain the scoring model on their own trading data — better entries, better exits, better win rates.",badge:"Q4 2026",badgeColor:T.yl},
].map(f=><div key={f.title} style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:8,padding:"10px 12px"}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
<span style={{fontSize:13,fontWeight:800,color:T.tx}}>{f.title}</span>
<span style={{fontSize:8,fontWeight:800,color:f.badgeColor,background:f.badgeColor+"14",padding:"2px 6px",borderRadius:3}}>{f.badge}</span>
</div>
<div style={{fontSize:11,color:T.dm,lineHeight:1.5}}>{f.desc}</div>
</div>)}
</div>
<div style={{marginTop:10,padding:"10px 12px",background:"#10E80C06",border:"1px solid #10E80C11",borderRadius:8}}>
<div style={{fontSize:12,fontWeight:700,color:"#10E80C",marginBottom:4,fontFamily:"'Space Grotesk',sans-serif"}}>The NOS Burn Flywheel</div>
<div style={{fontSize:11,color:T.dm,lineHeight:1.6}}>Users burn $NOS to train models → better models improve win rates → more profitable traders need more GPU → more NOS burned. Self-sustaining demand from the pump.fun ecosystem that no other Nosana partner can offer. The Monte Carlo engine alone will simulate <span style={{color:"#10E80C",fontWeight:700}}>10,000 entry/exit paths per new pair</span> — perfecting position sizing and exit timing before a single SOL is risked.</div>
</div>
</div>

{/* User's Node Dashboard */}
{gpuDash?.registered?<div style={{background:T.sf,border:"1px solid "+T.gn+"22",borderRadius:10,padding:mb?10:14,marginBottom:8}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}><IC.gpu s={16} c={T.gn}/><span style={{fontSize:15,fontWeight:800}}>Your Node</span><span style={{width:6,height:6,borderRadius:"50%",background:(gpuDash.node?.status==="offline"||gpuDash.node?.status==="disconnected")?T.rd:T.gn,animation:(gpuDash.node?.status!=="offline"&&gpuDash.node?.status!=="disconnected")?"gp 2s infinite":"none"}}/><span style={{fontSize:11,color:(gpuDash.node?.status==="offline"||gpuDash.node?.status==="disconnected")?T.rd:T.gn,fontWeight:700,textTransform:"uppercase"}}>{gpuDash.node?.status||"offline"}</span></div>
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:mb?4:6,marginBottom:10}}>
{[
{l:"EARNED",v:(gpuDash.earnings?.totalNOS||0).toFixed(2)+" NOS",c:T.gn},
{l:"PENDING",v:(gpuDash.earnings?.pendingNOS||0).toFixed(4)+" NOS",c:T.yl},
{l:"JOBS",v:gpuDash.earnings?.totalJobsCompleted||0,c:T.pu},
{l:"POWER",v:gpuDash.node?.powerDraw&&gpuDash.node?.powerLimit?(Math.round(parseFloat(gpuDash.node.powerDraw))+"W / "+Math.round(parseFloat(gpuDash.node.powerLimit))+"W"):gpuDash.node?.powerDraw?(Math.round(parseFloat(gpuDash.node.powerDraw))+"W"):"—",c:T.cy||"#00bcd4"},
].map(s=><div key={s.l} style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:"8px 4px",textAlign:"center"}}><div style={{fontSize:mb?14:18,fontWeight:900,color:s.c}}>{s.v}</div><div style={{fontSize:8,color:T.ft,fontWeight:700,marginTop:2}}>{s.l}</div></div>)}
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
<div style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:"8px 10px"}}><div style={{fontSize:9,color:T.ft,fontWeight:700}}>GPU</div><div style={{fontSize:13,fontWeight:800,color:T.tx,marginTop:2}}>{gpuDash.node?.gpuModel||"—"}</div></div>
<div style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:"8px 10px"}}><div style={{fontSize:9,color:T.ft,fontWeight:700}}>MARKET</div><div style={{fontSize:13,fontWeight:800,color:T.tx,marginTop:2}}>{gpuDash.node?.nosanaMarket||"—"}</div></div>
</div>
{/* ── Node Setup Steps / Status Guide ── */}
{gpuDash.node?.address&&(()=>{
const isOffline=gpuDash.node?.status==="offline"||gpuDash.node?.status==="disconnected";
const isOnline=!isOffline;
const hasEarnings=(gpuDash.earnings?.totalNOS||0)>0||(gpuDash.earnings?.pendingNOS||0)>0;
const steps=[
{n:1,label:"Register GPU",done:true,desc:"Your node is registered on Bondli."},
{n:2,label:"Fund node wallet",done:true,desc:"Send ~0.05 SOL for on-chain fees.",active:false},
{n:3,label:"Start node",done:isOnline||hasEarnings,active:isOffline&&!hasEarnings,desc:isOffline?"Your node is offline. Re-run the agent to start earning.":"Node is running."},
{n:4,label:"Earning NOS",done:hasEarnings,active:isOnline&&!hasEarnings,desc:hasEarnings?"You're earning NOS from AI jobs.":"Waiting for your first job..."},
];
const activeStep=steps.find(s=>s.active);
return<div style={{marginTop:8,background:activeStep?(activeStep.n===3?T.yl:T.gn)+"08":T.gn+"06",border:"1px solid "+(activeStep?(activeStep.n===3?T.yl:T.gn):T.gn)+"22",borderRadius:8,padding:mb?10:12}}>
{/* Step indicators */}
<div style={{display:"flex",alignItems:"center",gap:0,marginBottom:10}}>
{steps.map((s,i)=><React.Fragment key={s.n}>
<div style={{display:"flex",alignItems:"center",gap:4}}>
<div style={{width:20,height:20,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,background:s.done?T.gn:s.active?T.yl+"33":T.bd,color:s.done?"#000":s.active?T.yl:T.ft,border:s.active?"2px solid "+T.yl:"none"}}>{s.done?"✓":s.n}</div>
<span style={{fontSize:10,fontWeight:s.active?800:600,color:s.done?T.gn:s.active?T.yl:T.ft}}>{s.label}</span>
</div>
{i<steps.length-1&&<div style={{flex:1,height:1,background:steps[i+1].done?T.gn:T.bd,margin:"0 6px"}}/>}
</React.Fragment>)}
</div>

{/* Active step guidance */}
{isOffline&&!hasEarnings&&<div style={{background:T.yl+"0c",border:"1px solid "+T.yl+"33",borderRadius:6,padding:mb?10:12}}>
<div style={{fontSize:13,fontWeight:800,color:T.yl,marginBottom:6}}>Next: Start Your Node</div>
<div style={{fontSize:11,color:T.dm,lineHeight:1.6,marginBottom:8}}>You've funded your node wallet. Now re-run the setup command to start earning:</div>
<div style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:"8px 10px",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
<code style={{flex:1,fontSize:mb?9:11,color:T.gn,wordBreak:"break-all",fontFamily:"'IBM Plex Mono',monospace"}}>curl -s https://bondli.fun/gpu-agent.sh | bash -s -- --wallet {user?.pubkey||"YOUR_WALLET"}</code>
<button onClick={()=>{navigator.clipboard.writeText("curl -s https://bondli.fun/gpu-agent.sh | bash -s -- --wallet "+(user?.pubkey||"YOUR_WALLET"));toast("Command copied","success")}} style={{background:T.dm+"18",border:"1px solid "+T.bd,borderRadius:4,padding:"4px 8px",color:T.tx,fontSize:10,fontWeight:700,cursor:"pointer",flexShrink:0}}>Copy</button>
</div>
<div style={{fontSize:9,color:T.ft,lineHeight:1.4}}>Run this in your terminal. If your node was already registered, it will reconnect automatically.</div>
</div>}

{isOnline&&!hasEarnings&&<div style={{background:T.gn+"0c",border:"1px solid "+T.gn+"33",borderRadius:6,padding:mb?10:12}}>
<div style={{fontSize:13,fontWeight:800,color:T.gn,marginBottom:4}}>Node Online — Waiting for Jobs</div>
<div style={{fontSize:11,color:T.dm,lineHeight:1.5}}>Your GPU is connected to the Nosana network and ready to accept AI inference jobs. Jobs are assigned automatically — earnings will appear here once your first job completes.</div>
</div>}

{hasEarnings&&isOnline&&<div style={{background:T.gn+"0c",border:"1px solid "+T.gn+"33",borderRadius:6,padding:10}}>
<div style={{fontSize:12,fontWeight:800,color:T.gn}}>Your GPU is earning NOS. Earnings are swept to your wallet hourly.</div>
</div>}

{/* Node wallet address — collapsible after setup */}
<details style={{marginTop:8}}>
<summary style={{fontSize:10,color:T.ft,cursor:"pointer",fontWeight:700}}>Node Wallet Details</summary>
<div style={{marginTop:6,background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:"8px 10px",display:"flex",alignItems:"center",gap:6}}>
<code style={{flex:1,fontSize:mb?9:10,fontWeight:700,color:T.dm,wordBreak:"break-all",fontFamily:"'IBM Plex Mono',monospace"}}>{gpuDash.node.address}</code>
<button onClick={()=>{navigator.clipboard.writeText(gpuDash.node.address);toast("Node address copied","success")}} style={{background:T.dm+"18",border:"1px solid "+T.bd,borderRadius:4,padding:"3px 6px",color:T.tx,fontSize:9,fontWeight:700,cursor:"pointer",flexShrink:0}}>Copy</button>
</div>
<div style={{display:"flex",gap:6,marginTop:6}}>
<a href={"https://phantom.app/ul/send?to="+gpuDash.node.address} target="_blank" rel="noopener" style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"6px 10px",background:"#ab9ff215",border:"1px solid #ab9ff233",borderRadius:5,color:"#ab9ff2",fontSize:10,fontWeight:700,textDecoration:"none"}}>Send SOL via Phantom</a>
<a href={"https://solscan.io/account/"+gpuDash.node.address} target="_blank" rel="noopener" style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"6px 10px",background:T.dm+"08",border:"1px solid "+T.bd,borderRadius:5,color:T.dm,fontSize:10,fontWeight:700,textDecoration:"none"}}>View on Solscan</a>
</div>
</details>
</div>})()}

{gpuDash.node?.gpuUtil&&gpuDash.node.status!=="offline"&&gpuDash.node.status!=="disconnected"&&<div style={{marginTop:8}}>
<div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:T.dm,marginBottom:3}}><span>GPU Utilization</span><span style={{fontWeight:700,color:parseInt(gpuDash.node.gpuUtil)>50?T.gn:T.dm}}>{gpuDash.node.gpuUtil}%</span></div>
<div style={{height:4,borderRadius:2,background:T.bd,overflow:"hidden"}}><div style={{width:gpuDash.node.gpuUtil+"%",height:"100%",borderRadius:2,background:parseInt(gpuDash.node.gpuUtil)>80?T.gn:parseInt(gpuDash.node.gpuUtil)>50?T.yl:T.dm,transition:"width .5s"}}/></div>
<div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:T.ft,marginTop:4}}><span>Temp: {gpuDash.node.gpuTemp||"—"}C</span><span>Node: {(gpuDash.node?.address||"").slice(0,8)}...</span></div>
</div>}

{/* ── Node Control Buttons ── */}
<div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
<button disabled={gpuCmdLoading} onClick={()=>sendGpuCmd("restart_node")} style={{flex:1,padding:"6px 10px",background:T.yl+"18",border:"1px solid "+T.yl+"44",borderRadius:6,color:T.yl,fontSize:10,fontWeight:700,cursor:gpuCmdLoading?"wait":"pointer",opacity:gpuCmdLoading?.5:1}}>Restart Node</button>
<button disabled={gpuCmdLoading} onClick={()=>{if(confirm("Stop your GPU node? You can restart from the dashboard."))sendGpuCmd("stop_node")}} style={{flex:1,padding:"6px 10px",background:T.rd+"18",border:"1px solid "+T.rd+"44",borderRadius:6,color:T.rd,fontSize:10,fontWeight:700,cursor:gpuCmdLoading?"wait":"pointer",opacity:gpuCmdLoading?.5:1}}>Stop Node</button>
<button disabled={gpuCmdLoading} onClick={()=>sendGpuCmd("get_logs")} style={{flex:1,padding:"6px 10px",background:T.pu+"18",border:"1px solid "+T.pu+"44",borderRadius:6,color:T.pu,fontSize:10,fontWeight:700,cursor:gpuCmdLoading?"wait":"pointer",opacity:gpuCmdLoading?.5:1}}>View Logs</button>
<button onClick={()=>sGpuShowDetails(!gpuShowDetails)} style={{flex:1,padding:"6px 10px",background:T.dm+"18",border:"1px solid "+T.dm+"44",borderRadius:6,color:T.dm,fontSize:10,fontWeight:700,cursor:"pointer"}}>{gpuShowDetails?"Hide":"GPU"} Details</button>
<button disabled={gpuCmdLoading} onClick={async()=>{if(!confirm("Disconnect this node?\n\nAny SOL and NOS in the node wallet will be swept back to your wallet automatically. You can re-register with the setup command."))return;sGpuCmdLoading(true);try{const r=await a.gpdr(user.pubkey);toast(r.message||"Node disconnected","success");sGpuDash(null);setTimeout(()=>a.gpd(user.pubkey).then(d=>sGpuDash(d)).catch(()=>{}),2000)}catch(e){toast(e.message||"Disconnect failed","error")}sGpuCmdLoading(false)}} style={{flex:1,padding:"6px 10px",background:T.rd+"08",border:"1px solid "+T.rd+"22",borderRadius:6,color:T.rd,fontSize:10,fontWeight:700,cursor:gpuCmdLoading?"wait":"pointer",opacity:gpuCmdLoading?.5:1}}>Disconnect Node</button>
</div>

{/* ── GPU Details Panel ── */}
{gpuShowDetails&&<div style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:"8px 10px",marginTop:8}}>
<div style={{fontSize:10,fontWeight:700,color:T.dm,marginBottom:6}}>GPU Details</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4}}>
{[
{l:"Power",v:(gpuDash.node?.powerDraw||"—")+" / "+(gpuDash.node?.powerLimit||"—")+" W"},
{l:"Fan",v:(gpuDash.node?.fanSpeed||"—")+"%"},
{l:"GPU Clock",v:(gpuDash.node?.gpuClock||"—")+" MHz"},
{l:"Mem Clock",v:(gpuDash.node?.memClock||"—")+" MHz"},
{l:"VRAM",v:gpuDash.node?.gpuUtil?Math.round((parseInt(gpuDash.node.gpuUtil)||0))+"% used":"—"},
{l:"Temp",v:(gpuDash.node?.gpuTemp||"—")+"C"},
].map(d=><div key={d.l} style={{padding:"4px 6px",fontSize:9}}><div style={{color:T.ft,fontWeight:700}}>{d.l}</div><div style={{color:T.tx,fontWeight:800,marginTop:1}}>{d.v}</div></div>)}
</div>
</div>}

{/* ── Log Viewer ── */}
{gpuShowLogs&&gpuLogs&&<div style={{background:"#0a0a0a",border:"1px solid "+T.bd,borderRadius:6,padding:"8px 10px",marginTop:8,maxHeight:200,overflow:"auto"}}>
<div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:10,fontWeight:700,color:T.dm}}>Node Logs</span><button onClick={()=>sGpuShowLogs(false)} style={{background:"none",border:"none",color:T.ft,cursor:"pointer",fontSize:10}}>Close</button></div>
<div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:T.gn,lineHeight:1.5,whiteSpace:"pre-wrap"}}>{gpuLogs.length?gpuLogs.join("\n"):"No logs yet — waiting for agent response (~60s)"}</div>
</div>}

{/* ── Command History ── */}
{gpuDash.commandLog?.length>0&&<div style={{marginTop:8}}>
<div style={{fontSize:10,fontWeight:700,color:T.dm,marginBottom:4}}>Recent Commands</div>
{gpuDash.commandLog.slice(0,5).map((cmd,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 6px",fontSize:9,color:T.dm,borderBottom:"1px solid "+T.bd}}>
<span style={{fontWeight:700}}>{cmd.type.replace(/_/g," ")}</span>
<span style={{color:cmd.result?.status==="success"?T.gn:cmd.result?.status==="error"?T.rd:T.yl}}>{cmd.result?.status||"pending"}</span>
<span style={{color:T.ft}}>{new Date(cmd.issuedAt).toLocaleTimeString()}</span>
</div>)}
</div>}

{/* Recent jobs */}
{gpuDash.recentJobs?.length>0&&<div style={{marginTop:10}}><div style={{fontSize:11,fontWeight:700,color:T.dm,marginBottom:4}}>Recent Earnings</div>
{gpuDash.recentJobs.slice(0,5).map((j,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 6px",fontSize:10,color:T.dm,borderBottom:"1px solid "+T.bd}}>
<span>{j.type==="job_completed"?"Job":"Sweep"}</span>
<span style={{color:T.gn,fontWeight:700}}>+{(j.userNOS||j.nosEarned||0).toFixed(4)} NOS</span>
<span>{new Date(j.timestamp).toLocaleTimeString()}</span>
</div>)}
</div>}
</div>

/* Not registered — setup prompt or connect wallet */
:user?.demo||!user?.pubkey?<div style={{background:T.sf,border:"1px solid "+T.yl+"22",borderRadius:10,padding:mb?16:24,marginBottom:8,textAlign:"center"}}>
<IC.gpu s={32} c={T.yl}/>
<div style={{fontSize:18,fontWeight:900,color:T.tx,marginTop:10,marginBottom:6}}>Connect Wallet to Set Up Your GPU</div>
<div style={{fontSize:12,color:T.dm,lineHeight:1.6,marginBottom:16,maxWidth:400,margin:"0 auto 16px"}}>Sign in with your Phantom wallet to register your GPU node and start earning $NOS tokens.</div>
<B onClick={connect} style={{padding:"12px 32px",fontSize:16,borderRadius:10,background:"linear-gradient(135deg,#534bb1,#551bf9)"}}><IC.ph/> Connect Wallet</B>
</div>
:<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?12:18,marginBottom:8}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}><IC.gpu s={16} c={T.gn}/><span style={{fontSize:15,fontWeight:800}}>Setup Your GPU Node</span></div>
<div style={{fontSize:12,color:T.dm,lineHeight:1.6,marginBottom:12}}>
<>Ready to earn! Run this one-liner on your GPU machine:</>
</div>
{<>
<div style={{background:T.bg,border:"1px solid "+T.gn+"33",borderRadius:8,padding:mb?10:14,fontFamily:"'IBM Plex Mono',monospace",fontSize:mb?10:12,color:T.gn,wordBreak:"break-all",lineHeight:1.6,cursor:"pointer",position:"relative"}} onClick={()=>{navigator.clipboard?.writeText("curl -s https://bondli.fun/gpu-agent.sh | bash -s -- --wallet "+user.pubkey);toast("Copied!","success")}}>
<span style={{color:T.ft}}>$</span> curl -s https://bondli.fun/gpu-agent.sh | bash -s -- --wallet {user.pubkey}
<div style={{position:"absolute",top:4,right:6,fontSize:8,color:T.ft,fontWeight:700}}>CLICK TO COPY</div>
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginTop:12}}>
{[{step:"1",title:"Run Script",desc:"Installs Docker + NVIDIA toolkit"},{step:"2",title:"Fund Node",desc:"Send ~0.05 SOL for tx fees"},{step:"3",title:"Start Earning",desc:"GPU accepts AI jobs automatically"}].map(s=><div key={s.step} style={{textAlign:"center",padding:"8px 4px"}}>
<div style={{width:24,height:24,borderRadius:"50%",background:"linear-gradient(135deg,#534bb1,#551bf9)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:900,color:"#fff",marginBottom:4}}>{s.step}</div>
<div style={{fontSize:11,fontWeight:800,color:T.tx,marginBottom:2}}>{s.title}</div>
<div style={{fontSize:9,color:T.dm}}>{s.desc}</div>
</div>)}
</div>
</>}
<div style={{marginTop:12,fontSize:10,color:T.ft}}>Requirements: NVIDIA GPU (RTX 3060+), Linux/WSL, Docker, Internet</div>
</div>}

{/* Fleet Stats */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?10:14}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
<div style={{display:"flex",alignItems:"center",gap:6}}><IC.nos s={16}/><span style={{fontSize:15,fontWeight:700,fontFamily:"'Space Grotesk',sans-serif"}}>Bondli × <span style={{letterSpacing:"1.5px"}}>NOSANA</span> Fleet</span></div>
<button onClick={()=>{fetch(API+"/api/gpu/fleet").then(r=>r.json()).then(d=>sGpuFleet(d)).catch(()=>{})}} style={{background:"none",border:"1px solid "+T.bd,borderRadius:5,padding:"4px 9px",cursor:"pointer",fontSize:14,color:T.dm}}>↻</button>
</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:10}}>
{[
{l:"TOTAL NODES",v:gpuFleet?.totalNodes||0,c:T.pu},
{l:"ONLINE",v:gpuFleet?.onlineNodes||0,c:T.gn},
{l:"TOTAL EARNED",v:(gpuFleet?.totalEarned||0).toFixed(2)+" NOS",c:T.yl},
].map(s=><div key={s.l} style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:"8px 4px",textAlign:"center"}}><div style={{fontSize:mb?16:22,fontWeight:900,color:s.c}}>{s.v}</div><div style={{fontSize:8,color:T.ft,fontWeight:700,marginTop:2}}>{s.l}</div></div>)}
</div>
{gpuFleet?.nodes?.length>0&&<div>
<div style={{fontSize:11,fontWeight:700,color:T.dm,marginBottom:4}}>Active Nodes</div>
{gpuFleet.nodes.slice(0,20).map((n,i)=><div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 6px",fontSize:11,borderBottom:"1px solid "+T.bd}}>
<div style={{display:"flex",alignItems:"center",gap:6}}>
<span style={{width:6,height:6,borderRadius:"50%",background:(n.status==="offline"||n.status==="disconnected")?T.rd:T.gn}}/>
<span style={{color:T.dm,fontFamily:"'IBM Plex Mono',monospace",fontSize:10}}>{n.nodeId}</span>
<span style={{fontSize:9,color:T.ft}}>{n.gpuModel}</span>
</div>
<div style={{display:"flex",alignItems:"center",gap:8}}>
<span style={{fontSize:10,color:T.gn,fontWeight:700}}>{n.totalEarningsNOS.toFixed(2)} NOS</span>
<span style={{fontSize:9,color:T.ft}}>{n.totalJobsCompleted} jobs</span>
</div>
</div>)}
</div>}
{(!gpuFleet?.nodes||gpuFleet.nodes.length===0)&&<div style={{padding:20,textAlign:"center",fontSize:12,color:T.ft}}>No nodes registered yet. Be the first to plug in your GPU!</div>}
</div>

{/* Supported GPUs & Nosana Markets */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?10:14,marginTop:8}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
<div style={{display:"flex",alignItems:"center",gap:6}}><IC.nos s={14}/><span style={{fontSize:13,fontWeight:700,fontFamily:"'Space Grotesk',sans-serif"}}><span style={{letterSpacing:"1.5px"}}>NOSANA</span> GPU Markets</span></div>
<a href="https://app.nosana.io/nodes" target="_blank" rel="noopener noreferrer" style={{fontSize:10,fontWeight:700,color:"#10E80C",textDecoration:"none",padding:"3px 8px",border:"1px solid #10E80C22",borderRadius:5}}>Rent Compute →</a>
</div>
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr",gap:4}}>
{[
{gpu:"RTX 3060",rate:"~0.000043 NOS/s",vram:"12 GB"},
{gpu:"RTX 4070 / Laptop 50-series",rate:"~0.000035 NOS/s",vram:"12 GB"},
{gpu:"RTX 3090",rate:"~0.00009 NOS/s",vram:"24 GB"},
{gpu:"RTX 4090 / Desktop 5070+",rate:"~0.000097 NOS/s",vram:"24 GB"},
{gpu:"A100",rate:"~0.000115 NOS/s",vram:"80 GB"},
].map(g=><div key={g.gpu} style={{display:"flex",justifyContent:"space-between",padding:"6px 8px",background:T.bg,border:"1px solid "+T.bd,borderRadius:6,fontSize:11}}>
<span style={{fontWeight:700,color:T.tx}}>{g.gpu}</span>
<span style={{color:"#10E80C",fontWeight:600}}>{g.rate}</span>
<span style={{color:T.ft}}>{g.vram}</span>
</div>)}
</div>
<div style={{fontSize:9,color:T.ft,marginTop:4,padding:"0 4px"}}>Laptop GPUs are matched to <a href="https://nosana.com" target="_blank" rel="noopener noreferrer" style={{color:"#10E80C",textDecoration:"none"}}>Nosana</a> markets by VRAM tier. Your 5070 Ti Laptop (8-12GB) joins the 12GB tier.</div>
</div>

{/* ═══ AI SUPPORT CHAT (Grok 4) ═══ */}
<div style={{marginTop:8}}>
{!chatOpen?<button onClick={()=>sChatOpen(true)} style={{width:"100%",padding:mb?"12px":"14px 16px",background:"linear-gradient(135deg,"+T.sf+","+T.bg+")",border:"1px solid "+T.pu+"33",borderRadius:10,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
<IC.brain s={20} c={T.pu}/><span style={{fontSize:14,fontWeight:800,color:T.pu}}>GPU Support AI</span><span style={{fontSize:11,color:T.dm}}>Powered by Grok</span>
</button>
:<div style={{background:T.sf,border:"1px solid "+T.pu+"22",borderRadius:10,overflow:"hidden"}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderBottom:"1px solid "+T.bd,background:T.pu+"08"}}>
<div style={{display:"flex",alignItems:"center",gap:6}}><IC.brain s={16} c={T.pu}/><span style={{fontSize:14,fontWeight:800,color:T.pu}}>GPU Support AI</span><span style={{fontSize:10,color:T.dm}}>Grok 4</span></div>
<div style={{display:"flex",gap:4}}>
<button onClick={()=>{sChatMsgs([]);sChatInput("")}} style={{background:"none",border:"1px solid "+T.bd,borderRadius:4,padding:"2px 8px",fontSize:10,color:T.ft,cursor:"pointer"}}>Clear</button>
<button onClick={()=>sChatOpen(false)} style={{background:"none",border:"1px solid "+T.bd,borderRadius:4,padding:"2px 6px",fontSize:14,color:T.ft,cursor:"pointer"}}>×</button>
</div></div>
{/* Messages */}
<div style={{maxHeight:mb?300:400,overflowY:"auto",padding:"8px 10px",display:"flex",flexDirection:"column",gap:6}}>
{chatMsgs.length===0&&<div style={{padding:"20px 10px",textAlign:"center"}}>
<IC.brain s={32} c={T.pu+"44"}/>
<div style={{fontSize:13,color:T.dm,marginTop:8}}>Ask me anything about GPU earnings, Nosana nodes, or Bondli.</div>
<div style={{display:"flex",flexWrap:"wrap",gap:4,justifyContent:"center",marginTop:10}}>
{["My node is offline","How do I start earning?","Why are my earnings low?","How does the fee work?"].map(q=><button key={q} onClick={()=>{const userMsg={role:"user",content:q};const newMsgs=[...chatMsgs,userMsg];sChatMsgs(newMsgs);sChatLoading(true);a.cht(newMsgs,user?.pubkey).then(r=>{if(r.reply)sChatMsgs(m=>[...m,{role:"assistant",content:r.reply}]);else sChatMsgs(m=>[...m,{role:"assistant",content:r.error||"Something went wrong."}]);sChatLoading(false)}).catch(()=>{sChatMsgs(m=>[...m,{role:"assistant",content:"Connection error."}]);sChatLoading(false)})}} style={{padding:"5px 10px",background:T.bg,border:"1px solid "+T.bd,borderRadius:6,fontSize:10,color:T.dm,cursor:"pointer",fontFamily:M}}>{q}</button>)}
</div>
</div>}
{chatMsgs.map((m,i)=><div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
<div style={{maxWidth:"85%",padding:"8px 12px",borderRadius:m.role==="user"?"12px 12px 2px 12px":"12px 12px 12px 2px",background:m.role==="user"?T.pu+"18":T.bg,border:"1px solid "+(m.role==="user"?T.pu+"33":T.bd),fontSize:12,color:T.tx,lineHeight:1.5,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
{m.content}
</div></div>)}
{chatLoading&&<div style={{display:"flex",justifyContent:"flex-start"}}><div style={{padding:"8px 12px",borderRadius:"12px 12px 12px 2px",background:T.bg,border:"1px solid "+T.bd}}><Sp s={12} c={T.pu}/></div></div>}
<div ref={chatEndRef}/>
</div>
{/* Input */}
<div style={{display:"flex",gap:4,padding:"6px 8px",borderTop:"1px solid "+T.bd}}>
<input value={chatInput} onChange={e=>sChatInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat()}}} placeholder="Ask about GPU issues..." style={{flex:1,padding:"8px 10px",background:T.bg,border:"1px solid "+T.bd,borderRadius:8,color:T.tx,fontSize:13,outline:"none",fontFamily:M}} disabled={chatLoading}/>
<button onClick={sendChat} disabled={chatLoading||!chatInput.trim()} style={{padding:"8px 14px",background:chatInput.trim()?T.pu+"18":"transparent",border:"1px solid "+(chatInput.trim()?T.pu+"33":T.bd),borderRadius:8,fontSize:13,fontWeight:700,color:chatInput.trim()?T.pu:T.ft,cursor:chatInput.trim()?"pointer":"default"}}>Send</button>
</div>
</div>}
</div>

</div></EB>}

{tab==="radar"&&<EB l="Radar"><div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden",animation:"si .2s ease"}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",borderBottom:"1px solid "+T.bd}}><div style={{display:"flex",alignItems:"center",gap:5}}><IC.radar s={16} c={T.gn}/><span style={{fontSize:15,fontWeight:800}}>Radar</span><span style={{width:6,height:6,borderRadius:"50%",background:rEnabled?T.gn:T.rd}}/><span style={{fontSize:13,color:T.ft}}>{rPool}</span>{online>0&&<span style={{fontSize:11,color:T.gn+"66"}}>{online} online</span>}</div><div style={{display:"flex",gap:3}}><button onClick={()=>{sRL(true);a.gr().then(d=>{if(d.tabs){const tabs={...d.tabs};delete tabs.graduating;delete tabs.bags;delete tabs.hot;sRT(tabs)}if(d.poolSize!=null)sRP(d.poolSize);sRL(false)}).catch(()=>sRL(false))}} style={{background:"none",border:"1px solid "+T.bd,borderRadius:5,padding:"4px 9px",cursor:"pointer",fontSize:14,color:T.dm}}>↻</button><button onClick={()=>sRE(!rEnabled)} style={{background:rEnabled?T.gn+"08":T.rd+"08",border:"1px solid "+(rEnabled?T.gn:T.rd)+"18",borderRadius:5,padding:"4px 10px",cursor:"pointer",fontSize:12,fontWeight:700,color:rEnabled?T.gn:T.rd}}>{rEnabled?"ON":"OFF"}</button></div></div>
<div style={{borderBottom:"1px solid "+T.bd}}><div style={{display:"flex",alignItems:"center",overflowX:"auto"}}>{[{id:"momentum",l:"Momentum",ic:IC.trend},{id:"new",l:"New",ic:IC.star},{id:"resurgence",l:"Resurgence",ic:IC.trend}].map(t=>{const ac=rTab===t.id;const isResurg=t.id==="resurgence";const acColor=isResurg?"#b388ff":T.gn;const n=(rt[t.id]||[]).length;return<button key={t.id} onClick={()=>{sRTab(t.id);sRExp(null);sRS("")}} style={{padding:mb?"8px 6px":"8px 12px",background:"none",border:"none",borderBottom:ac?"1.5px solid "+acColor:"1.5px solid transparent",fontSize:mb?13:15,fontWeight:700,color:ac?acColor:T.dm,cursor:"pointer",display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap"}}><t.ic s={14} c={ac?acColor:T.dm}/>{t.l}{n>0&&<span style={{fontSize:10,opacity:.5}}>{n}</span>}</button>})}{!mb&&<><div style={{flex:1}}/><input value={rSearch} onChange={e=>{sRS(e.target.value);sRExp(null)}} placeholder="Search name, ticker, description, or paste CA..." style={{width:340,padding:"8px 12px",margin:"3px 5px",background:T.bg,border:"1px solid "+T.bd,borderRadius:6,color:T.tx,fontSize:14,outline:"none"}}/></>}</div>{mb&&<div style={{padding:"4px 8px"}}><input value={rSearch} onChange={e=>{sRS(e.target.value);sRExp(null)}} placeholder="Search name, description, or paste CA..." style={{width:"100%",padding:"10px 12px",background:T.bg,border:"1px solid "+T.bd,borderRadius:6,color:T.tx,fontSize:15,outline:"none",boxSizing:"border-box"}}/></div>}</div>
{/* Filter criteria panel */}
<div style={{borderBottom:"1px solid "+T.bd}}>
<button onClick={()=>sRFO(!rFilterOpen)} style={{width:"100%",padding:"6px 10px",background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",color:T.dm,fontSize:12,fontWeight:700}}>
<div style={{display:"flex",alignItems:"center",gap:4}}><IC.gear s={11} c={T.dm}/><span>Filters</span>{(rMinBP>0||rMinMC>0||rSignalFilter!=="ALL"||rSourceFilter!=="ALL")&&<span style={{fontSize:9,fontWeight:800,color:T.gn,background:T.gn+"12",padding:"1px 5px",borderRadius:3}}>ON</span>}</div>
<span style={{fontSize:14,transform:rFilterOpen?"rotate(180deg)":"rotate(0deg)",transition:"transform .15s"}}>▾</span>
</button>
{rFilterOpen&&<div style={{padding:"6px 10px 10px",display:"flex",flexDirection:"column",gap:8,animation:"si .15s ease"}}>
<div><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:11,color:T.ft,fontWeight:600}}>Entry Signal</span></div>
<div style={{display:"flex",gap:3}}>{["ALL","STRONG","READY","EARLY"].map(s=>{const ac=rSignalFilter===s;const sc=s==="STRONG"?T.gn:s==="READY"?T.gn:s==="EARLY"?T.yl:T.dm;return<button key={s} onClick={()=>sRSF(s)} style={{flex:1,padding:"5px 0",background:ac?sc+"12":"transparent",border:"1px solid "+(ac?sc+"33":T.bd),borderRadius:5,fontSize:11,fontWeight:ac?800:600,color:ac?sc:T.dm,cursor:"pointer"}}>{s}</button>})}
</div></div>
<div><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:11,color:T.ft,fontWeight:600}}>Source</span></div>
<div style={{display:"flex",gap:3}}>{["ALL","PUMP","BONK","BAGS"].map(s=>{const ac=rSourceFilter===s;const sc=s==="BAGS"?T.gn:s==="BONK"?"#ff9800":s==="PUMP"?"#b388ff":T.dm;return<button key={s} onClick={()=>sRSrcF(s)} style={{flex:1,padding:"5px 0",background:ac?sc+"12":"transparent",border:"1px solid "+(ac?sc+"33":T.bd),borderRadius:5,fontSize:11,fontWeight:ac?800:600,color:ac?sc:T.dm,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:3}}>{s==="BAGS"&&<IC.bags s={10} c={ac?sc:T.dm}/>}{s==="BONK"&&<IC.bonk s={10} c={ac?sc:T.dm}/>}{s==="PUMP"&&<IC.rocket s={10} c={ac?sc:T.dm}/>}{s}</button>})}
</div></div>
<div><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:11,color:T.ft,fontWeight:600}}>Min Buy Pressure</span><span style={{fontSize:12,fontWeight:800,color:rMinBP>0?T.gn:T.dm}}>{rMinBP}%</span></div>
<input type="range" min={0} max={80} step={5} value={rMinBP} onChange={e=>sRMinBP(Number(e.target.value))} style={{width:"100%"}}/>
</div>
<div><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:11,color:T.ft,fontWeight:600}}>Min Market Cap</span><span style={{fontSize:12,fontWeight:800,color:rMinMC>0?T.gn:T.dm}}>{rMinMC>0?"$"+fm(rMinMC):"Any"}</span></div>
<input type="range" min={0} max={50000} step={1000} value={rMinMC} onChange={e=>sRMinMC(Number(e.target.value))} style={{width:"100%"}}/>
</div>
{(rMinBP>0||rMinMC>0||rSignalFilter!=="ALL"||rSourceFilter!=="ALL")&&<button onClick={()=>{sRMinBP(0);sRMinMC(0);sRSF("ALL");sRSrcF("ALL")}} style={{padding:"4px 0",background:"none",border:"1px solid "+T.bd,borderRadius:5,fontSize:11,fontWeight:600,color:T.ft,cursor:"pointer"}}>Reset Filters</button>}
</div>}
</div>
{/* Expanded token detail panel */}
{expToken&&<TokenDetail t={expToken} T={T} mb={mb} trB={trB} buying={buying} selling={selling} sBuy={sBuy} sSell={sSell} quickBuy={quickBuy} quickSell={quickSell} toast={toast} held={held} onClose={()=>sRExp(null)} solP={solP} rCustomBuy={rCustomBuy} sRCB={sRCB} user={user} autoExitStatus={autoExitSt} refreshAutoExit={refreshAutoExit}/>}
{/* Token list */}
{rLoad?<div style={{padding:40,textAlign:"center"}}><Sp s={16}/></div>:!rEnabled?<div style={{padding:40,textAlign:"center",fontSize:14,color:T.ft}}>Paused</div>:rFiltered.length===0?<div style={{padding:40,textAlign:"center",fontSize:14,color:T.ft}}>{caLoading?<><Sp s={14}/> Looking up CA...</>:rSearch?"No results for \""+rSearch+"\"":rTab==="momentum"?"Waiting for tokens with sustained buy pressure...":rTab==="hot"?"Waiting for tokens with multiple buyers...":rTab==="bags"?"Waiting for hot Bags.fm tokens...":rTab==="resurgence"?"Scanning for older coins (12h–2y) with renewed momentum...":"Waiting for new launches..."}</div>:<div>{rFiltered.filter(t=>t.ca!==rExp).map(t=>{const isH=held.has(t.ca);const eSignal=(t.entrySignal==="STRONG"||t.entrySignal==="READY"||t.entrySignal==="EARLY")?t.entrySignal:"";const eColor=eSignal==="STRONG"?T.gn:eSignal==="READY"?T.gn:eSignal==="EARLY"?T.yl:T.dm;const bpW=Math.round((t.buyPressure||0)*100);const mArrow=t.scoreTrend==="rocket"?"\u2191\u2191":t.scoreTrend==="rising"?"\u2191":t.scoreTrend==="fading"?"\u2193":t.scoreTrend==="crashing"?"\u2193\u2193":t.scoreTrend==="declining"?"\u2193":"";const mColor=t.scoreTrend==="rocket"||t.scoreTrend==="rising"?T.gn:t.scoreTrend==="fading"||t.scoreTrend==="declining"?"#ff8800":t.scoreTrend==="crashing"?"#ff4444":T.dm;const isBags=t._source==="bags"||t.source==="bags"||t._meteoraDBC;const isBonk=t._source==="bonk"||t.source==="bonk"||t._bonk;const isResurg=t._source==="resurgence";const resurgTypeLabel=isResurg?({smart_money_accumulation:"Smart $",community_revival:"Community",volume_breakout:"Vol Breakout",social_resurgence:"Social"}[t.resurgenceType]||"Revival"):"";const resurgAge=isResurg&&t.ageMs?(t.ageMs<86400000?Math.round(t.ageMs/3600000)+"h":t.ageMs<2592000000?Math.round(t.ageMs/86400000)+"d":t.ageMs<15552000000?(t.ageMs/2592000000).toFixed(1)+"mo":(t.ageMs/31536000000).toFixed(1)+"y"):"";return<div key={t.ca} onClick={()=>{sRExp(t.ca);setTimeout(()=>document.getElementById("tc")?.scrollIntoView({behavior:"smooth",block:"start"}),50)}} style={{display:"flex",alignItems:"center",gap:mb?6:10,padding:mb?"8px 10px":"9px 12px",cursor:"pointer",borderBottom:"1px solid "+T.bd,background:isH?T.gn+"03":"transparent"}}><div style={{width:mb?56:68,height:mb?56:68,borderRadius:10,overflow:"hidden",flexShrink:0,position:"relative",border:isBags?"1px solid "+T.gn+"88":isBonk?"1px solid #ff980088":isResurg?"1px solid #b388ff88":"none",boxShadow:isBags?"0 0 4px "+T.gn+"22":isBonk?"0 0 4px #ff980022":isResurg?"0 0 4px #b388ff22":"none"}}><TImg src={t.image} ticker={t.ticker} size={mb?56:68}/>{isH&&<div style={{position:"absolute",top:0,right:0,background:T.gn,color:"#000",fontSize:7,fontWeight:900,padding:"0 2px",borderRadius:"0 0 0 2px",zIndex:1}}>H</div>}</div><div style={{minWidth:0,width:mb?100:160,flexShrink:0}}><div style={{fontSize:mb?15:16,fontWeight:800,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.name||tk(t.ticker)}</div><div style={{display:"flex",alignItems:"center",gap:3,marginTop:1}}><span style={{fontSize:mb?13:14,color:T.gn,fontWeight:700}}>{tk(t.ticker)}</span>{t.twitter&&<IC.tw s={9} c={T.dm}/>}{t.website&&<IC.globe s={9} c={T.dm}/>}{t.telegram&&<IC.tg s={9} c={T.dm}/>}{t.dexBoosted&&<span style={{fontSize:8,fontWeight:800,color:"#ffd600",background:"#ffd60012",padding:"0 3px",borderRadius:2,lineHeight:"14px"}} title={"DexScreener boost: $"+(t.boostAmount||0)}>DEX PAID</span>}{isResurg&&<span style={{fontSize:8,fontWeight:800,color:"#b388ff",background:"#b388ff12",padding:"0 3px",borderRadius:2,lineHeight:"14px"}}>{resurgTypeLabel}</span>}{isResurg&&resurgAge&&<span style={{fontSize:8,fontWeight:700,color:T.dm,background:T.bd,padding:"0 3px",borderRadius:2,lineHeight:"14px"}}>{resurgAge} old</span>}</div>{t.description&&<div style={{fontSize:11,color:T.dm,marginTop:2,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",maxWidth:mb?100:160}}>{t.description.slice(0,80)}</div>}{isResurg&&t.features&&<div style={{display:"flex",gap:2,marginTop:2}}>{[{l:"SM",v:t.features.smartMoney||0,c:"#b388ff"},{l:"COM",v:t.features.communityGrowth||0,c:"#18ffff"},{l:"SOC",v:t.features.socialRevival||0,c:"#ffd600"},{l:"VOL",v:t.features.volumeSpike||0,c:"#ff9100"},{l:"REV",v:t.features.priceReversal||0,c:"#00e676"}].map(b=><div key={b.l} style={{flex:1}} title={b.l+": "+(b.v*100).toFixed(0)+"%"}><div style={{height:2,borderRadius:1,background:T.bd}}><div style={{height:2,borderRadius:1,background:b.c,width:(b.v*100)+"%"}}/></div></div>)}</div>}</div><div style={{flex:1,minWidth:0}}><div style={{height:mb?38:48}}><SpkC data={t.spark||[]} color={t.spark&&t.spark.length>1&&t.spark[t.spark.length-1]>=t.spark[0]?T.gn:"#ff4444"} h={mb?38:48}/></div>{/* Buy Pressure Bar / Resurgence Score */}{isResurg?<div style={{display:"flex",alignItems:"center",gap:3,marginTop:2}}><div style={{flex:1,height:3,borderRadius:2,background:T.bd,overflow:"hidden"}}><div style={{width:Math.round((t.resurgenceScore||0)*100)+"%",height:"100%",borderRadius:2,background:(t.resurgenceScore||0)>=.65?"#b388ff":(t.resurgenceScore||0)>=.45?"#ffd600":"#ff9100",transition:"width .5s"}}/></div><span style={{fontSize:8,color:"#b388ff",fontWeight:700,flexShrink:0}}>{Math.round((t.resurgenceScore||0)*100)}</span></div>:<div style={{display:"flex",alignItems:"center",gap:3,marginTop:2}}><div style={{flex:1,height:3,borderRadius:2,background:T.bd,overflow:"hidden"}}><div style={{width:bpW+"%",height:"100%",borderRadius:2,background:bpW>=70?T.gn:bpW>=50?T.yl:"#ff4444",transition:"width .5s"}}/></div><span style={{fontSize:8,color:bpW>=70?T.gn:bpW>=50?T.dm:"#ff4444",fontWeight:700,flexShrink:0}}>{bpW}%</span></div>}</div><div style={{textAlign:"right",flexShrink:0,minWidth:mb?55:72}}><div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:2}}>{mArrow&&<span style={{fontSize:mb?11:13,fontWeight:900,color:mColor}}>{mArrow}</span>}<span style={{fontSize:mb?15:17,fontWeight:800,color:fixMc(t,solP)>=gradMc?"#ffaa00":fixMc(t,solP)>=1e5?T.gn:fixMc(t,solP)>=1e4?T.yl:T.tx}}>${fm(fixMc(t,solP))}</span></div>{t.h1Change!=null&&<div style={{fontSize:12,color:t.h1Change>0?T.gn:"#ff4444"}}>{t.h1Change>0?"+":""}{typeof t.h1Change==="number"?t.h1Change.toFixed(1):t.h1Change}%</div>}{t.volSpike>=3&&<div style={{fontSize:8,fontWeight:900,color:"#ff8800",background:"#ff880012",padding:"0 3px",borderRadius:2,marginTop:1,textAlign:"center"}} title={t.volSpike+"x avg volume"}>VOL {t.volSpike.toFixed(0)}x</div>}{t.pctToGrad!=null&&<div style={{width:"100%",height:3,borderRadius:2,background:T.bd,marginTop:2}}><div style={{width:Math.min(100,t.pctToGrad)+"%",height:"100%",borderRadius:2,background:t.pctToGrad>=100?T.yl:T.gn}}/></div>}{t.graduated&&<div style={{fontSize:11,fontWeight:800,color:T.gn,marginTop:1}}>GRADUATED</div>}{t.dexBoosted&&<div style={{fontSize:10,fontWeight:800,color:"#ffd600",marginTop:1}}>DEX PAID</div>}</div></div>})}</div>}</div></EB>}

{tab==="wallet"&&<EB l="Bags"><div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,overflow:"hidden",animation:"si .2s ease"}}><div style={{padding:"7px 10px",borderBottom:"1px solid "+T.bd,display:"flex",alignItems:"center",justifyContent:"space-between"}}><div style={{display:"flex",alignItems:"center",gap:5}}><IC.wallet s={16} c={T.gn}/><span style={{fontSize:15,fontWeight:800}}>Wallet</span><span style={{fontSize:13,color:T.ft}}>{positions.length}</span></div><div style={{display:"flex",gap:3}}>{positions.length>0&&<button onClick={async()=>{if(!confirm("Sell ALL positions?"))return;try{const r=await a.sa(user.pubkey);toast(`Sold ${r.sold||0}`,"success")}catch(e){toast(e.message,"error")}}} style={{background:T.rd+"08",border:"1px solid "+T.rd+"18",borderRadius:5,padding:"4px 10px",fontSize:13,fontWeight:700,color:T.rd,cursor:"pointer"}}>Sell All</button>}<button onClick={()=>{a.gp(user.pubkey).then(d=>{if(d.positions){sPos(d.positions);sHeld(new Set(d.positions.map(p=>p.mint)))}toast("Refreshed","success")}).catch(()=>{})}} style={{background:"none",border:"1px solid "+T.bd,borderRadius:5,padding:"4px 10px",fontSize:13,color:T.dm,cursor:"pointer"}}>↻</button></div></div>
{!trW?<div style={{padding:30,textAlign:"center",fontSize:14,color:T.ft}}>Create trading key to start</div>
:positions.length===0?<div style={{padding:30,textAlign:"center"}}><div style={{fontSize:36,marginBottom:8,opacity:.2}}>💼</div><div style={{fontSize:14,color:T.ft}}>No positions yet</div><div style={{fontSize:12,color:T.ft,marginTop:4}}>Buy from Radar to see them here</div></div>
:<div>{positions.map(p=>{const mc=fixMc(p,solP);const val=p.valueSol||(p.valueUsd?p.valueUsd/solP:0);const isProfit=val>0;const expanded=rExp===p.mint;const hasPnl=p.solSpent>0&&val>0;const pnlPct=hasPnl?((val-p.solSpent)/p.solSpent*100):p.pnlPct||0;const pnlSol=hasPnl?(val-p.solSpent):p.pnlSol||0;const pnlColor=pnlPct>=0?T.gn:T.rd;const pIsBags=p._source==="bags"||p._meteoraDBC;return<div key={p.mint} style={{borderBottom:"1px solid "+T.bd}}>
<div onClick={()=>sRExp(expanded?null:p.mint)} style={{display:"flex",alignItems:"center",gap:mb?6:10,padding:mb?"8px":"10px 12px",cursor:"pointer",background:expanded?T.gn+"04":"transparent"}}>
<div style={{width:42,height:42,borderRadius:8,overflow:"hidden",flexShrink:0,border:pIsBags?"1px solid "+T.gn+"88":"none"}}><TImg src={p.image} ticker={p.ticker} size={42}/></div>
<div style={{flex:1,minWidth:0}}>
<div style={{display:"flex",alignItems:"baseline",gap:4}}><span style={{fontSize:14,fontWeight:800}}>{p.name||tk(p.ticker)||p.mint?.slice(0,8)}</span>{pIsBags&&<span style={{fontSize:7,fontWeight:800,color:T.gn,background:T.gn+"12",padding:"1px 4px",borderRadius:3}}>BAGS</span>}{p.pending&&!p.verified&&<span onClick={e=>{e.stopPropagation();sPos(prev=>prev.map(x=>x.mint===p.mint&&x.pending?{...x,pending:false,pendingExpired:true}:x))}} style={{fontSize:8,fontWeight:700,color:T.yl,background:T.yl+"12",padding:"1px 4px",borderRadius:3,animation:"gp 1.5s infinite",cursor:"pointer"}} title="Click to dismiss">CONFIRMING</span>}{p.pending&&p.verified&&<span style={{fontSize:8,fontWeight:700,color:T.gn,background:T.gn+"12",padding:"1px 4px",borderRadius:3}}>VERIFIED</span>}{p.pendingExpired&&!p.pending&&<span onClick={e=>{e.stopPropagation();sPos(prev=>prev.map(x=>x.mint===p.mint?{...x,pendingExpired:false}:x))}} style={{fontSize:8,fontWeight:700,color:T.or,background:T.or+"12",padding:"1px 4px",borderRadius:3,cursor:"pointer"}} title="Click to dismiss">CHECK TX</span>}{mc>0&&<span style={{fontSize:13,color:T.ft}}>${fm(mc)}</span>}{p.holdPct>0&&<span style={{fontSize:10,color:T.pu}}>{p.holdPct}%</span>}</div>
<div style={{fontSize:13,color:T.dm}}>{fm(p.amount)} tokens{p.solSpent>0&&<span style={{color:T.ft,marginLeft:6,fontSize:11}}>in: {p.solSpent.toFixed(2)} SOL</span>}</div>
</div>
<div style={{textAlign:"right",flexShrink:0}}>
<div style={{fontSize:16,fontWeight:900,color:isProfit?T.gn:T.rd}}>{val>0.0001?<>{solFmt(val)} <IC.sol s={14}/></>:"—"}</div>
{(hasPnl||p.pnlPct!==0)&&<div style={{fontSize:14,fontWeight:800,color:pnlColor}}>{pnlPct>=0?"+":""}{pnlPct.toFixed(1)}%</div>}
{p.valueUsd>0&&<div style={{fontSize:12,color:T.dm}}>${p.valueUsd.toFixed(2)}</div>}
</div></div>
{/* Expanded view with chart + controls */}
{expanded&&<div style={{padding:"0 12px 10px",background:T.bg+"44"}}>
<CandleChart ca={p.mint} T={T} mb={mb}/>
{/* Buy more */}
<div style={{display:"flex",gap:3,marginTop:8}}>{[0.05,0.1,0.25,0.5].map(amt=><button key={amt} onClick={async()=>{try{await quickBuy(p.mint,amt);toast(`Buying ${amt} SOL...`,"success")}catch(e){toast(e.message,"error")}}} style={{flex:1,padding:"8px 0",background:T.gn+"06",border:"1px solid "+T.gn+"18",borderRadius:5,fontSize:12,fontWeight:800,color:T.gn,cursor:"pointer"}}>{amt}</button>)}</div>
{/* Sell */}
<div style={{display:"flex",gap:3,marginTop:4}}>{[25,50,100].map(pct=>{const sellKey=p.mint+pct;const isSelling=selling===sellKey;return<button key={pct} disabled={isSelling} onClick={async()=>{sSell(sellKey);try{await quickSell(p.mint,pct);toast(`Sold ${pct}%`,"success")}catch(e){toast(e.message,"error")}sSell(null)}} style={{flex:1,padding:"10px 0",background:isSelling?"#ff444422":"#ff444408",border:"1px solid #ff444422",borderRadius:5,fontSize:13,fontWeight:800,color:"#ff4444",cursor:isSelling?"wait":"pointer",opacity:isSelling?.5:1}}>{isSelling?<Sp s={8} c="#ff4444"/>:pct===100?"SELL ALL":pct+"%"}</button>})}</div>
{/* Links */}
<div style={{display:"flex",gap:3,marginTop:4}}><button onClick={()=>{navigator.clipboard?.writeText(p.mint);toast("CA copied","success")}} style={{flex:1,padding:"8px 0",background:"none",border:"1px solid "+T.bd,borderRadius:5,fontSize:12,color:T.ft,cursor:"pointer"}}>Copy CA</button>{pIsBags?<a href={"https://bags.fm/token/"+p.mint} target="_blank" rel="noopener" style={{flex:1,padding:"8px 0",background:T.gn+"06",border:"1px solid "+T.gn+"18",borderRadius:5,fontSize:12,color:T.gn,textDecoration:"none",fontWeight:700,textAlign:"center"}}>bags.fm</a>:<a href={"https://pump.fun/coin/"+p.mint} target="_blank" rel="noopener" style={{flex:1,padding:"8px 0",background:"#b388ff06",border:"1px solid #b388ff18",borderRadius:5,fontSize:12,color:"#b388ff",textDecoration:"none",fontWeight:700,textAlign:"center"}}>pump.fun</a>}<a href={"https://dexscreener.com/solana/"+p.mint} target="_blank" rel="noopener" style={{flex:1,padding:"8px 0",background:"none",border:"1px solid "+T.bd,borderRadius:5,fontSize:12,color:T.dm,textDecoration:"none",textAlign:"center"}}>dex</a></div>
</div>}
</div>})}</div>}
{/* Referrals */}
<div style={{padding:"8px 10px",borderTop:"1px solid "+T.bd}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:11,fontWeight:700}}>Referrals</span>{refData?.referralCode&&<span style={{fontSize:11,color:T.dm}}>Refs: <b style={{color:T.gn}}>{refData.referralCount||0}</b> Earned: <b style={{color:T.gn}}>{fs(refData.referralEarnings||0,3)} SOL</b></span>}</div>
{refData?.referralCode?<div style={{display:"flex",gap:3}}><div style={{flex:1,background:T.bg,border:"1px solid "+T.bd,borderRadius:5,padding:"4px 8px",fontSize:11,color:T.gn,fontWeight:800}}>{refData.referralCode}</div><button onClick={()=>{navigator.clipboard?.writeText(window.location.origin+"?ref="+refData.referralCode);toast("Link copied","success")}} style={{background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:5,padding:"4px 8px",fontSize:9,fontWeight:700,color:T.gn,cursor:"pointer"}}>Copy Link</button></div>:<div style={{fontSize:9,color:T.ft}}>Loading...</div>}
<div style={{marginTop:4,display:"flex",gap:3}}><input value={refInput} onChange={e=>sRefInput(e.target.value)} placeholder="Enter referral code" style={{flex:1,padding:"4px 7px",background:T.bg,border:"1px solid "+T.bd,borderRadius:5,color:T.tx,fontSize:10,outline:"none"}}/><button onClick={async()=>{if(!refInput.trim())return;try{const r=await a.arf(user.pubkey,refInput.trim());toast(r.ok?"Referral applied!":"Failed","success");if(r.ok)sRefInput("")}catch(e){toast(e.message,"error")}}} style={{background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:5,padding:"4px 8px",fontSize:9,fontWeight:700,color:T.gn,cursor:"pointer"}}>Apply</button></div>
</div>
</div></EB>}

{tab==="deploy"&&<EB l="Deploy"><div style={{animation:"si .2s ease"}} className="st">{!trW?<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:24,textAlign:"center"}}><IC.key s={24} c={T.yl}/><div style={{fontSize:11,color:T.dm,marginTop:8,marginBottom:12}}>Create trading key first</div><B onClick={async()=>{try{const r=await a.ctw(a.w);if(r.ok){sTrW(r.tradingWallet);sTrK(r);toast("Created","success")}}catch(e){toast(e.message,"error")}}} small><IC.key s={12} c="#0a0a0f"/> Create Key</B></div>:<>
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?10:16,marginBottom:6}}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:mb?8:12}}><IC.rocket s={18}/><span style={{fontFamily:S,fontWeight:800,fontSize:mb?16:18}}>Token</span></div>
{/* ═══ LAUNCHPAD TOGGLE: pump.fun vs Bags.fm ═══ */}
<div style={{display:"flex",gap:0,marginBottom:10,borderRadius:8,overflow:"hidden",border:"1px solid "+T.bd}}>
<button onClick={()=>sLTarget("pump")} style={{flex:1,padding:"10px 0",background:launchTarget==="pump"?"#b388ff18":"transparent",border:"none",borderRight:"1px solid "+T.bd,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
<IC.rocket s={14} c={launchTarget==="pump"?"#b388ff":T.dm}/>
<span style={{fontSize:13,fontWeight:launchTarget==="pump"?800:500,color:launchTarget==="pump"?"#b388ff":T.dm}}>pump.fun</span>
{launchTarget==="pump"&&<span style={{fontSize:8,fontWeight:800,color:"#b388ff",background:"#b388ff18",padding:"1px 5px",borderRadius:3}}>ACTIVE</span>}
</button>
<button onClick={()=>sLTarget("bags")} style={{flex:1,padding:"10px 0",background:launchTarget==="bags"?T.gn+"12":"transparent",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
<IC.bags s={14} c={launchTarget==="bags"?T.gn:T.dm}/>
<span style={{fontSize:13,fontWeight:launchTarget==="bags"?800:500,color:launchTarget==="bags"?T.gn:T.dm}}>bags.fm</span>
{launchTarget==="bags"&&<span style={{fontSize:8,fontWeight:800,color:T.gn,background:T.gn+"18",padding:"1px 5px",borderRadius:3}}>ACTIVE</span>}
</button>
</div>
{launchTarget==="bags"&&<div style={{background:T.gn+"06",border:"1px solid "+T.gn+"18",borderRadius:8,padding:"8px 10px",marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
<IC.bags s={16} c={T.gn}/>
<div><div style={{fontSize:11,fontWeight:700,color:T.gn}}>Bags.fm — Meteora DBC</div>
<div style={{fontSize:9,color:T.dm}}>1% perpetual creator royalty on all volume. Top 100 holders get 24h dividends.</div></div>
</div>}
<div style={{display:"flex",gap:10,marginBottom:8}}><ImgUp image={img} onChange={sImg} mb={mb}/><div style={{flex:1}}><div style={{display:"flex",gap:6,marginBottom:6}}><div style={{flex:1}}><div style={{fontSize:13,color:T.ft,marginBottom:3,textTransform:"uppercase"}}>Name</div><In value={tn} onChange={sTn} placeholder="Token name"/></div><div style={{flex:1}}><div style={{fontSize:13,color:T.ft,marginBottom:3,textTransform:"uppercase"}}>Ticker</div><In value={tkr} onChange={sTk} placeholder="TICKER"/></div></div><div style={{fontSize:13,color:T.ft,marginBottom:3,textTransform:"uppercase"}}>Description</div><In value={desc} onChange={sDs} placeholder="Optional"/></div></div><div style={{display:"flex",gap:6,marginTop:8,marginBottom:6}}><div style={{flex:1}}><div style={{fontSize:13,color:T.ft,marginBottom:3,textTransform:"uppercase",display:"flex",alignItems:"center",gap:3}}><IC.tw s={9} c={T.ft}/>Twitter</div><In value={tw} onChange={sTw} placeholder="@handle or URL"/></div><div style={{flex:1}}><div style={{fontSize:13,color:T.ft,marginBottom:3,textTransform:"uppercase",display:"flex",alignItems:"center",gap:3}}><IC.globe s={9} c={T.ft}/>Website</div><In value={wb} onChange={sWb} placeholder="https://"/></div><div style={{flex:1}}><div style={{fontSize:13,color:T.ft,marginBottom:3,textTransform:"uppercase",display:"flex",alignItems:"center",gap:3}}><IC.tg s={9} c={T.ft}/>Telegram</div><In value={tg} onChange={sTg} placeholder="t.me/group"/></div></div><div style={{marginTop:6}}><div style={{fontSize:13,color:T.ft,marginBottom:3,textTransform:"uppercase"}}>Or ape existing CA</div><In value={eCA} onChange={sECA} placeholder="Contract address"/></div></div>
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?10:16,marginBottom:6}}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><IC.shield s={18}/><span style={{fontFamily:S,fontWeight:800,fontSize:mb?16:18}}>Fleet</span><div style={{marginLeft:"auto"}}><button onClick={()=>sExpert(!expert)} style={{background:"none",border:"1px solid "+T.bd,borderRadius:5,padding:"1px 7px",fontSize:8,color:expert?T.gn:T.ft,cursor:"pointer"}}>{expert?"expert":"simple"}</button></div></div><div style={{display:"grid",gridTemplateColumns:`repeat(${PRESETS.length},1fr)`,gap:3,marginBottom:8}}>{PRESETS.map(p=>{const ac=sol===p.sol&&snc===p.snc;return<button key={p.name} onClick={()=>applyPreset(p)} style={{padding:"8px 4px",background:ac?T.gn+"08":T.bg,border:"1px solid "+(ac?T.gn+"22":T.bd),borderRadius:6,cursor:"pointer",textAlign:"center"}}><div style={{fontSize:13,fontWeight:800,color:ac?T.gn:T.tx}}>{p.name}</div><div style={{fontSize:10,color:T.ft,marginTop:1}}>{p.sol} SOL</div><div style={{fontSize:8,color:ac?T.gn:T.dm,marginTop:2}}>{p.desc}</div></button>})}</div><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:13,color:T.ft,textTransform:"uppercase",fontWeight:700}}>Budget</span><span style={{fontSize:26,fontWeight:900,color:T.gn}}>{sol}</span></div><input type="range" min={.2} max={50} step={.1} value={sol} onChange={e=>sSol(Number(e.target.value))} style={{width:"100%",marginBottom:6}}/>{expert&&<div style={{display:"grid",gridTemplateColumns:mb?"1fr 1fr":"1fr 1fr 1fr 1fr",gap:4,marginBottom:6}}><NI label="Snipers" value={snc} onChange={sSn} min={0} max={5}/><NI label="Slip %" value={slip} onChange={sSl} min={1} max={50}/><NI label="Dur m" value={dur} onChange={sDur} min={5} max={240} step={5}/><NI label="Jito" value={jt} onChange={sJt} min={.001} max={.1} step={.001} decimals={3}/></div>}<div style={{display:"grid",gridTemplateColumns:isApe?"repeat(3,1fr)":"repeat(4,1fr)",gap:1,background:T.bd,borderRadius:5,overflow:"hidden"}}>{(isApe?[{k:"Fleet",v:sol.toFixed(2)},{k:"Wallets",v:nw},{k:"Snipers",v:snc}]:[{k:"Dev",v:pv.dv.toFixed(2)},{k:"Fleet",v:pv.fl.toFixed(2)},{k:"Wallets",v:nw},{k:"Snipers",v:snc}]).map(s=><div key={s.k} style={{background:T.bg,padding:"5px 2px",textAlign:"center"}}><div style={{fontSize:15,fontWeight:800,color:T.gn}}>{s.v}</div><div style={{fontSize:12,color:T.ft}}>{s.k}</div></div>)}</div></div>

{/* ═══ WALLET SELECTION (Pro/VIP) ═══ */}
{expert&&<div style={{background:T.sf,border:"1px solid "+T.pu+"18",borderRadius:10,padding:mb?10:16,marginBottom:6}}>
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
{trB<sol&&trB>0&&<div style={{marginTop:6,fontSize:9,color:T.rd,fontWeight:700}}>Insufficient balance ({solFmt(trB)} SOL). Deposit {(sol-trB).toFixed(2)} SOL to launch.</div>}
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
:launchStep==="uploading"?("Image + metadata → "+(launchTarget==="bags"?"bags.fm":"pump.fun"))
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
try{const r=await a.sc({totalSol:sol,launchTarget,tokenConfig:{name:tn,ticker:tkr,description:desc,image:img,twitter:tw,telegram:tg,website:wb,existingCA:eCA},wallet:user.pubkey,fleetConfig:{sniperCount:snc,slippage:slip,duration:dur,jitoTip:jt,importedKeys}});
sLS("uploading");await new Promise(r=>setTimeout(r,800));
sLS("funding");toast("Send "+sol+" SOL → "+r.devWallet,"info");navigator.clipboard?.writeText(r.devWallet);const poll=setInterval(async()=>{try{const b=await a.sb(r.sessionId,user.pubkey);if(b.funded){clearInterval(poll);sLS("dev_buy");await new Promise(r=>setTimeout(r,1000));sLS("snipers");const l=await a.sl(r.sessionId,user.pubkey);await new Promise(r=>setTimeout(r,1500));if(l.tokenCA){sLCA(l.tokenCA);sLd(true);sAsid(r.sessionId);sLS("live");hp([20,40,20]);toast("LIVE","success");setTimeout(()=>sLS(null),3000)}}}catch{}},2000);setTimeout(()=>{clearInterval(poll);if(!launched)sLS(null)},180000)}
catch(e){toast(e.message,"error");sLS(null)}}} style={{animation:canLaunch?"gp 2s infinite":"none"}}><IC.rocket s={14} c={canLaunch?"#0a0a0f":"#888"}/> {isApe?"Ape "+eCA.slice(0,8)+"…":("Launch "+(tn||"Token")+" on "+(launchTarget==="bags"?"Bags.fm":"pump.fun"))}</B>}
</div>
{pSess.length>0&&<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,padding:mb?8:12}}><div style={{fontSize:11,fontWeight:700,marginBottom:6}}>Sessions</div>{pSess.map(s=><div key={s.id} style={{display:"flex",alignItems:"center",gap:5,padding:"6px 4px",marginBottom:2,borderRadius:6,background:T.bg+"55",border:"1px solid "+T.bd}}><div style={{width:24,height:24,borderRadius:5,overflow:"hidden",background:T.bg,flexShrink:0}}>{s.tokenConfig?.image?<img src={imgProxy(s.tokenConfig?.image)} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>:<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:T.ft+"44",fontWeight:900}}>{(tk(s.tokenConfig?.ticker)||s.tokenCA?.slice(0,1)||"?")[0]}</div>}</div><span style={{fontSize:10,color:T.md,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tk(s.tokenConfig?.ticker)||s.tokenCA?.slice(0,6)}</span><button onClick={async()=>{try{const r=await a.ss(s.id,user.pubkey);const swept=r.totalSwept||r.totalRecovered||0;toast(swept>0.001?`Closed — ${swept.toFixed(2)} SOL swept`:"Closed","success")}catch(e){toast("Close: "+(e.message||"error"),"error")};sPS(p=>p.filter(x=>x.id!==s.id))}} style={{background:T.rd+"08",color:T.rd,border:"1px solid "+T.rd+"18",fontSize:7,fontWeight:700,padding:"2px 5px",borderRadius:3,cursor:"pointer"}}>Close</button><button onClick={async()=>{try{const r=await a.fr(s.id,user.pubkey);const amt=r.totalRecovered||0;if(amt>0.001){toast(`Swept ${amt.toFixed(2)} SOL`,"success");sPS(p=>p.filter(x=>x.id!==s.id))}else toast("Nothing to sweep","info")}catch(e){toast(e.message,"error")}}} style={{background:T.yl+"08",color:T.yl,border:"1px solid "+T.yl+"18",fontSize:7,fontWeight:700,padding:"2px 5px",borderRadius:3,cursor:"pointer"}}>Sweep</button><button onClick={async()=>{try{const k=await a.ek(s.id,user.pubkey);if(k.ok&&k.keys?.length){const txt=k.keys.map(w=>(w.role||"w")+": "+w.secret).join("\n");try{await navigator.clipboard.writeText(txt);toast(k.keys.length+" keys copied","success")}catch{if(mb){sTrK(prev=>({...prev,showExported:txt}));sShowKeys(true);toast("Keys shown in Settings — tap to copy","success")}else{prompt("Copy keys:",txt);toast("Keys shown above","success")}}}else toast("No keys","info")}catch(e){toast(e.message,"error")}}} style={{background:"none",color:T.ft,border:"1px solid "+T.bd,fontSize:7,fontWeight:700,padding:"2px 5px",borderRadius:3,cursor:"pointer"}}>Keys</button><button onClick={()=>{sLCA(s.tokenCA);sLd(true);sAsid(s.id)}} style={{background:T.gn+"08",color:T.gn,border:"1px solid "+T.gn+"18",fontSize:7,fontWeight:700,padding:"2px 5px",borderRadius:3,cursor:"pointer"}}>View</button></div>)}</div>}
</>}</div></EB>}

{/* INTEL TAB — Meme Analytics for everyone */}
{tab==="intel"&&<EB l="Intel"><div style={{animation:"si .2s ease"}}>
<div style={{background:T.sf,border:"1px solid "+T.pu+"18",borderRadius:10,padding:mb?8:12,marginBottom:6}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}><IC.sim s={16} c={T.pu}/><span style={{fontSize:15,fontWeight:800}}>Meme Intelligence</span><span style={{width:5,height:5,borderRadius:"50%",background:T.gn,animation:"gp 2s infinite"}}/></div>
<div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:3,marginBottom:6}}>
{[{l:"TOKENS",v:intelData?.memory?.total||"—",c:T.pu},{l:"ACCURACY",v:intelData?.scorer?.accuracy||"—",c:T.gn},{l:"GRAD RATE",v:(intelData?.memory?.graduationRate&&intelData.memory.graduationRate!=="N/A")?intelData.memory.graduationRate:(intelData?.memory?.graduated>0&&intelData?.memory?.total>0?(intelData.memory.graduated/intelData.memory.total*100).toFixed(1)+"%":"0%"),c:T.yl},{l:"TRACKING",v:intelData?.monitor?.tracking||"—",c:T.or},{l:"RUG RISK",v:(intelData?.recentEvents||[]).filter(e=>(e.data?.rugScore||0)>50||(e.data?.rugFlags||[]).length>=2).length,c:"#ff1744"}].map(s=><div key={s.l} style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:"6px 4px",textAlign:"center"}}><div style={{fontSize:18,fontWeight:900,color:s.c}}>{s.v}</div><div style={{fontSize:9,color:T.ft,fontWeight:700,marginTop:1}}>{s.l}</div></div>)}
</div>
<div style={{fontSize:11,color:T.ft,textAlign:"center"}}>{intelData?`${intelData.scorer?.trainCount||0} tokens scored · SOL $${intelData.solPrice?.toFixed(0)||"?"} · uptime ${intelData.uptime||"—"}`:"Connecting to intel engine..."}</div>

{/* ═══ TOP SIGNALS + LIVE RADAR PULSE (above Oracle) ═══ */}
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr",gridTemplateRows:"1fr",gap:4,marginBottom:6}}>

{/* Raw Logs — full backend stdout, every data source */}
<div style={{background:"#0c0c0c",border:"1px solid #1a1a1a",borderRadius:6,display:"flex",flexDirection:"column",maxHeight:mb?360:460,overflow:"hidden"}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 10px",background:"#111",borderBottom:"1px solid #1a1a1a",flexShrink:0}}>
<div style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:7,height:7,borderRadius:"50%",background:"#22c55e",boxShadow:"0 0 6px #22c55e88"}}/>
<span style={{fontSize:10,color:"#888",fontFamily:"'SF Mono',Menlo,monospace"}}>bondli-production</span><span style={{fontSize:9,color:"#444",fontFamily:"'SF Mono',Menlo,monospace"}}>railway.app</span></div>
<span style={{fontSize:9,color:"#555",fontFamily:"'SF Mono',Menlo,monospace"}}>live tail</span>
</div>
<div style={{flex:1,overflowY:"auto",padding:"2px 0",background:"#0c0c0c"}}>
{(()=>{const L=[];const P=(t,c)=>({t,c});const S="|";const SP=P(" | ","#333");const _ts=d=>{const t=d?new Date(d):new Date();return String(t.getHours()).padStart(2,"0")+":"+String(t.getMinutes()).padStart(2,"0")+":"+String(t.getSeconds()).padStart(2,"0")+"."+String(t.getMilliseconds()).padStart(3,"0")};
const es=engineState||{};const fl=es.flow||{};const pl=es.pool||{};const fh=es.featureHeat||{};const dec=es.decisions||{};const mods=es.modules||[];const events=intelData?.recentEvents||[];const allT=[...(rt.momentum||[]),...(rt.new||[]),...(rt.graduating||[])];const gw=intelData?.gradWatch;const sm=intelData?.smartMoney;const aw=intelData?.artwork;const sv=intelData?.survivor;const sc=intelData?.scorer;const mem=intelData?.memory;const at=autoTrade;const cp=chartPatterns;const now=_ts();
/* ── INIT BANNER ── */
L.push({k:"b0",parts:[P(now+" ","#555"),P("[INIT]  ","#c084fc"),P("=========================================","#555")]});
L.push({k:"b1",parts:[P(now+" ","#555"),P("[INIT]  ","#c084fc"),P("  BONDLI v4.0 — PRODUCTION SERVER","#c084fc")]});
L.push({k:"b2",parts:[P(now+" ","#555"),P("[INIT]  ","#c084fc"),P("=========================================","#555")]});
L.push({k:"b3",parts:[P(now+" ","#555"),P("[INIT]  ","#c084fc"),P("Mode: ","#888"),P("LIVE","#ef4444"),SP,P("SOL: $"+(intelData?.solPrice?.toFixed(0)||"?"),"#eab308"),SP,P("Uptime: "+(intelData?.uptime||"—"),"#888")]});
/* ── MODULE STATUS ── */
mods.forEach((m,i)=>{const up=m.status==="active";L.push({k:"mod"+i,parts:[P(now+" ","#555"),P("[MOD]   ","#06b6d4"),P(m.id,"#e5e5e5"),P(" → ","#333"),P(up?"ACTIVE":"RECONNECTING",up?"#22c55e":"#eab308")]})});
if(!mods.length){["pumpportal","scorer","rug_detector","artwork_scanner"].forEach((m,i)=>{L.push({k:"modf"+i,parts:[P(now+" ","#555"),P("[MOD]   ","#06b6d4"),P(m,"#e5e5e5"),P(" → ","#333"),P("ACTIVE","#22c55e")]})})}
/* ── POOL STATE ── */
L.push({k:"pool",parts:[P(now+" ","#555"),P("[POOL]  ","#06b6d4"),P("total:"+pl.total,"#888"),SP,P("active:"+pl.active,"#22c55e"),SP,P("graduated:"+pl.graduated,"#eab308"),SP,P("recent_5m:"+pl.recent5m,"#06b6d4")]});
/* ── FLOW STATS ── */
L.push({k:"flow",parts:[P(now+" ","#555"),P("[FLOW]  ","#eab308"),P("buys:"+(fl.totalBuys||0),"#22c55e"),SP,P("sells:"+(fl.totalSells||0),"#ef4444"),SP,P("vol:"+(fl.totalVol||0).toFixed(1)+"SOL","#eab308"),SP,P("ext_buyers:"+(fl.externalBuyers||0),"#06b6d4")]});
/* ── FEATURE HEAT ── */
L.push({k:"heat",parts:[P(now+" ","#555"),P("[HEAT]  ","#f97316"),P("social:"+Math.round((fh.socialSignals||0)*100)+"%",(fh.socialSignals||0)>.3?"#22c55e":"#888"),SP,P("rug_risk:"+Math.round((fh.rugRisk||0)*100)+"%",(fh.rugRisk||0)>.3?"#ef4444":"#888")]});
/* ── DECISIONS ── */
L.push({k:"dec",parts:[P(now+" ","#555"),P("[BRAIN] ","#c084fc"),P("decisions → ","#888"),P("ape:"+(dec.ape||0),"#22c55e"),SP,P("watch:"+(dec.watch||0),"#eab308"),SP,P("skip:"+(dec.skip||0),"#666"),SP,P("rug:"+(dec.rug||0),"#ef4444"),SP,P("total:"+((dec.ape||0)+(dec.watch||0)+(dec.skip||0)+(dec.rug||0)),"#888")]});
/* ── SCORER MODEL ── */
if(sc){L.push({k:"scorer",parts:[P(now+" ","#555"),P("[MODEL] ","#a78bfa"),P("trained:"+(sc.trainCount||0),"#888"),SP,P("accuracy:"+(sc.accuracy||"—"),"#22c55e"),SP,P("features:40+","#a78bfa")]});
/* ── TOP FEATURES ── */
const fMap={"oc_buyVelocity5m":"BuyVel5m","tp_stickiness":"Stickiness","oc_uniqueBuyers5m":"UniqBuyers5m","k_herdSignal":"HerdSignal","tp_lawOfFew":"LawOfFew","k_cognitiveEase":"NameEase","oc_volumeSol5m":"VolSol5m","so_hasTwitter":"HasTwitter","ch_healthScore":"ChartHealth","ch_pumpDump":"PumpDump","rg_devSellSpeed":"DevSell","rg_mcapDropRate":"MCDrop","rg_buyerRetention":"BuyerRetention","cs_cascadeOnset":"CascadeOnset","cs_reflexivity":"Reflexivity","sir_r0":"ViralR0","gf_curveProgress":"CurveProgress","gf_frontrunSignal":"GradFrontrun","apd_divergence":"AttnPriceDiverge","gl_thinSlice":"ThinSlice30s","gl_outlier":"Outlier","k_anchoring":"Anchoring","k_lossAversion":"LossAversion","cs_curveVelocity":"CurveVel","cs_attentionShare":"AttnShare"};
(sc.topFeatures||[]).forEach((f,i)=>{const fn=fMap[f.feature]||f.feature;const w=typeof f.weight==="number"?f.weight.toFixed(4):f.weight;L.push({k:"feat"+i,parts:[P(now+" ","#555"),P("[FEAT]  ","#a78bfa"),P("#"+(i+1)+" ","#555"),P(fn,"#e5e5e5"),P(" weight:","#555"),P(w,"#a78bfa")]})})}
/* ── MEMORY ── */
if(mem){L.push({k:"mem",parts:[P(now+" ","#555"),P("[MEM]   ","#06b6d4"),P("total:"+(mem.total||0),"#888"),SP,P("graduated:"+(mem.graduated||0),"#22c55e"),SP,P("grad_rate:"+(mem.graduationRate||"0%"),"#eab308")]})}
/* ── SMART MONEY ── */
if(sm?.signals?.length>0){L.push({k:"smart",parts:[P(now+" ","#555"),P("[SMART] ","#14f195"),P("signals:"+sm.signals.length,"#14f195")]});
sm.signals.slice(0,5).forEach((s,i)=>{L.push({k:"sm"+i,parts:[P(now+" ","#555"),P("[SMART] ","#14f195"),P("  wallet:","#555"),P((s.wallet||s.ca||"???").slice(0,8)+"…","#888"),SP,P("type:"+(s.type||s.action||"signal"),"#14f195")]})})}
/* ── ARTWORK ── */
if(aw){L.push({k:"art",parts:[P(now+" ","#555"),P("[ART]   ","#f472b6"),P("scanned:"+(aw.scanned||0),"#f472b6")]})}
/* ── SURVIVOR ── */
if(sv){L.push({k:"surv",parts:[P(now+" ","#555"),P("[SURV]  ","#a78bfa"),P("matched:"+(sv.matched||0),"#a78bfa")]})}
/* ── PATTERNS ── */
if(cp?.total>0){L.push({k:"cpat",parts:[P(now+" ","#555"),P("[PATRN] ","#f97316"),P("total:"+(cp.total||0),"#f97316")]});
(cp.recentCharts||[]).slice(0,8).forEach((c,i)=>{L.push({k:"cp"+i,parts:[P(now+" ","#555"),P("[PATRN] ","#f97316"),P("  "+(c.name||(c.ca||"").slice(0,8)),"#888"),P(" → ","#333"),P(c.pattern||"unknown","#f97316")]})})}
/* ── GRAD WATCH ── */
if(gw?.count>0){L.push({k:"gw",parts:[P(now+" ","#555"),P("[GRAD]  ","#eab308"),P("tracking:"+(gw.count||0),"#eab308")]});
(gw.tokens||[]).forEach((g,i)=>{const gc=g.changePct>=0?"#22c55e":"#ef4444";L.push({k:"gw"+i,ca:g.ca,parts:[P(now+" ","#555"),P("[GRAD]  ","#eab308"),P("  "+(g.name||(g.ca||"").slice(0,6)),"#e5e5e5"),SP,P("mc:$"+fm(g.currentMcap||0),"#888"),SP,P((g.changePct>=0?"+":"")+g.changePct+"%",gc),SP,P("age:"+g.age+"h","#555"),
...(g.peakMultiple>2?[SP,P(g.peakMultiple+"x peak","#eab308")]:[])]})})}
/* ── AUTO TRADE ── */
if(at?.active){L.push({k:"at",parts:[P(now+" ","#555"),P("[AUTO]  ","#22c55e"),P("ACTIVE","#22c55e"),SP,P("positions:"+(at.positions?.length||0),"#888"),SP,P("sol/trade:"+(at.settings?.solPerTrade||"?"),"#eab308"),SP,P("min_score:"+(at.settings?.minScore||"?"),"#888")]});
(at.positions||[]).forEach((p,i)=>{const pc=p.changePct>=0?"#22c55e":"#ef4444";L.push({k:"atp"+i,ca:p.ca,parts:[P(now+" ","#555"),P("[POS]   ","#22c55e"),P("  "+(p.name||(p.ca||"").slice(0,8)),"#e5e5e5"),SP,P("entry:"+p.entrySol+"SOL","#888"),SP,P((p.changePct>=0?"+":"")+((p.changePct||0).toFixed(1))+"%",pc),SP,P("score:"+(p.liveScore||p.entryScore||"?"),"#06b6d4"),SP,P("trend:"+(p.scoreTrend||"—"),"#888")]})});
(at.recentlyClosed||[]).slice(0,10).forEach((c,i)=>{const cc=c.pnlSol>=0?"#22c55e":"#ef4444";L.push({k:"atc"+i,ca:c.ca,parts:[P(now+" ","#555"),P("[EXIT]  ",cc),P("  "+(c.name||(c.ca||"").slice(0,8)),"#888"),SP,P((c.pnlSol>=0?"+":"")+((c.pnlSol||0).toFixed(4))+"SOL",cc),SP,P(((c.pnlPct||0).toFixed(1))+"%",cc),SP,P("reason:"+(c.exitReason||"—"),"#888")]})})}
if(at?.learner?.totalTrades>0){const lr=at.learner;L.push({k:"lrn",parts:[P(now+" ","#555"),P("[LEARN] ","#60a5fa"),P("trades:"+lr.totalTrades,"#888"),SP,P("winRate:"+(lr.winRate||"—"),"#22c55e"),SP,P("avgWin:"+(lr.avgWin||"—")+"%","#22c55e"),SP,P("avgLoss:"+(lr.avgLoss||"—")+"%","#ef4444"),SP,P("bestBucket:"+(lr.bestScoreBucket||"—"),"#a78bfa")]})}
if(at?.pipeline?.cycles){L.push({k:"pipe",parts:[P(now+" ","#555"),P("[PIPE]  ","#06b6d4"),P("cycles:"+at.pipeline.cycles,"#888"),
...(at.pipeline.last?[SP,P("last:"+(at.pipeline.last.ca||"").slice(0,8),"#888"),SP,P("signal:"+(at.pipeline.last.signal||"—"),"#06b6d4")]:[])]})}
/* ── DYNAMICS ── */
if(es.dynamics){const dy=es.dynamics;const tr=dy.trends||{};L.push({k:"dyn",parts:[P(now+" ","#555"),P("[DYN]   ","#06b6d4"),P("tracked:"+(dy.tracked||0),"#888"),SP,P("building:"+(tr.building||0),"#22c55e"),SP,P("rising:"+(tr.rising||0),"#22c55e"),SP,P("fading:"+(tr.fading||0),"#eab308"),SP,P("crashing:"+(tr.crashing||0),"#ef4444")]})}
/* ── ALL SCORING EVENTS ── */
if(events.length>0)L.push({k:"evhdr",parts:[P(now+" ","#555"),P("[SCORE] ","#06b6d4"),P("--- recent scoring events ("+events.length+") ---","#444")]});
events.forEach((e,i)=>{const d=e.data||{};const ts=_ts(e.time);const ca=d.ca||"";const caS=ca.slice(0,8);const name=(d.name||"").slice(0,14);const score=d.score||0;const bp=d.bondProb||0;const mcap=d.mcap||0;const mcS=mcap>=1e6?(mcap/1e6).toFixed(1)+"M":mcap>=1e3?(mcap/1e3).toFixed(1)+"K":mcap>0?String(mcap):"0";const rs=d.rugScore||0;const rf=d.rugFlags||[];const isRug=rs>50||rf.length>=2;const isLrn=e.type==="learn";
if(isLrn){L.push({k:"ev"+i,ca,parts:[P(ts+" ","#555"),P("[LEARN] ","#60a5fa"),P(caS+"…","#666"),P(" err:","#555"),P((d.error!=null)?d.error.toFixed(4):"—","#888"),SP,P("acc:"+(d.accuracy||"—"),"#22c55e"),SP,P("model_v"+(d.trainCount||"?"),"#555")]})}else{
const tag=isRug?"[RUG]   ":"[SCORE] ";const tc=isRug?"#ef4444":"#06b6d4";const sc2=score>=50?"#22c55e":score>=25?"#eab308":"#666";
L.push({k:"ev"+i,ca,parts:[P(ts+" ","#555"),P(tag,tc),
P(name||caS,name?"#e5e5e5":"#666"),P(name?" "+caS+"…":"","#444"),
P(" score:","#555"),P(String(score),sc2),SP,P("bond:"+bp+"%",bp>=100?"#22c55e":"#eab308"),SP,P("mc:$"+mcS,"#888"),
...(d.meta?[SP,P("meta:"+d.meta.slice(0,20),"#a78bfa")]:[]),
...(d.lora?[SP,P("lora:blend","#c084fc")]:[]),
...(d.dexBoosted?[SP,P("DEX_PAID","#ffd600")]:[]),
...(isRug?[SP,P("rug_score:"+rs,"#ef4444"),SP,P("flags:["+rf.join(",")+"]","#ef4444")]:[]),
...(score>=50&&!isRug?[P(" → ","#333"),P("SIGNAL","#22c55e")]:isRug?[P(" → ","#333"),P("REJECT","#ef4444")]:[])
]})}});
/* ── RADAR TOKENS — every token currently tracked ── */
const radarT=allT.filter(t=>t.ca);
if(radarT.length>0)L.push({k:"rthdr",parts:[P(now+" ","#555"),P("[RADAR] ","#22c55e"),P("--- live tokens ("+radarT.length+") ---","#444")]});
radarT.forEach((t,i)=>{const bpW=Math.round((t.buyPressure||0)*100);const mc=t.mcapUsd||t.mcapSol*140||0;const mcS=mc>=1e6?(mc/1e6).toFixed(1)+"M":mc>=1e3?(mc/1e3).toFixed(1)+"K":mc>0?String(Math.round(mc)):"0";const sColor=(t.score||0)>=50?"#22c55e":(t.score||0)>=25?"#eab308":"#666";const isH=held.has(t.ca);
L.push({k:"rt"+i,ca:t.ca,parts:[P(now+" ","#555"),P("[RADAR] ","#22c55e"),
P((t.name||t.ticker||t.ca.slice(0,8)).slice(0,14),"#e5e5e5"),P(" "+t.ca.slice(0,6)+"…","#444"),
P(" score:","#555"),P(String(t.score||0),sColor),SP,
P("bp:"+bpW+"%",bpW>=70?"#22c55e":bpW>=50?"#eab308":"#ef4444"),SP,
P("mc:$"+mcS,"#888"),
...(t.h1Change!=null?[SP,P("1h:"+(t.h1Change>0?"+":"")+t.h1Change.toFixed(1)+"%",t.h1Change>0?"#22c55e":"#ef4444")]:[]),
...(t.entrySignal?[SP,P("signal:"+t.entrySignal,t.entrySignal==="STRONG"||t.entrySignal==="READY"?"#22c55e":"#eab308")]:[]),
...(t.scoreTrend?[SP,P("trend:"+t.scoreTrend,t.scoreTrend==="rocket"||t.scoreTrend==="rising"?"#22c55e":"#ef4444")]:[]),
...(t.twitter?[SP,P("tw:yes","#06b6d4")]:[]),
...(t.graduated?[SP,P("GRADUATED","#eab308")]:[]),
...(isH?[SP,P("HELD","#22c55e")]:[])
]})});
/* ── WS LIVE STREAM — real-time events, no polling ── */
if(wsLog.length>0)L.push({k:"wshdr",parts:[P(now+" ","#555"),P("[WS]    ","#22c55e"),P("--- live socket stream ("+wsLog.length+") ---","#444")]});
wsLog.slice(0,200).forEach((w,i)=>{const ts=_ts(w.ts);const d=w.d||{};const ca=d.ca||"";const evC={"newToken":"#c084fc","trade":"#06b6d4","mcap-update":"#888","graduation":"#eab308","auto-ape":"#22c55e","auto-sell":"#ef4444","auto-exit-sell":"#ef4444","smart_money_signal":"#14f195","high_value_dev":"#f97316","sim-decision":"#a78bfa","auto-paused":"#eab308","settings-updated":"#888","connected":"#22c55e","disconnected":"#ef4444"}[w.ev]||"#666";
const tag="["+w.ev+"]";const pad=" ".repeat(Math.max(0,16-tag.length));
const parts=[P(ts+" ","#555"),P(tag+pad,evC)];
if(w.ev==="newToken"){parts.push(P((d.name||ca.slice(0,8)),"#e5e5e5"),SP,P("mc:$"+fm(d.mcap||0),"#888"));if(d.source)parts.push(SP,P("src:"+d.source,"#06b6d4"))}
else if(w.ev==="trade"){parts.push(P(d.side||"?",d.side==="buy"?"#22c55e":"#ef4444"),P(" "+(ca.slice(0,8)||""),"#666"),SP,P((d.sol||0)+"SOL","#eab308"),SP,P("mc:$"+fm(d.mcap||0),"#888"));if(d.wallet)parts.push(SP,P("w:"+d.wallet,"#555"))}
else if(w.ev==="mcap-update"){parts.push(P(ca.slice(0,8),"#666"),SP,P("mc:$"+fm(d.mcap||0),"#888"))}
else if(w.ev==="graduation"){parts.push(P(ca.slice(0,8),"#eab308"),P(" GRADUATED","#eab308"))}
else if(w.ev==="auto-ape"){parts.push(P((d.name||ca.slice(0,8)),"#e5e5e5"),SP,P(d.sol+"SOL","#22c55e"),SP,P("score:"+(d.score||"?"),"#22c55e"),SP,P("mc:$"+fm(d.mcap||0),"#888"));if(d.dca)parts.push(SP,P("DCA#"+d.dcaNum,"#06b6d4"));if(d.reentry)parts.push(SP,P("REENTRY","#a78bfa"))}
else if(w.ev==="auto-sell"||w.ev==="auto-exit-sell"){parts.push(P(ca.slice(0,8),"#666"),SP,P((d.pnl||"?")+"%",parseFloat(d.pnl)>=0?"#22c55e":"#ef4444"),SP,P("tier:"+(d.tier||d.reason||"?"),"#ef4444"));if(d.reason&&d.reason!==d.tier)parts.push(SP,P(d.reason,"#888"))}
else if(w.ev==="smart_money_signal"){parts.push(P("whale detected","#14f195"));if(ca)parts.push(SP,P(ca.slice(0,8),"#666"))}
else if(w.ev==="high_value_dev"){parts.push(P("high value dev","#f97316"))}
else if(w.ev==="sim-decision"){parts.push(P("sim:"+(d.simId||"").slice(0,8),"#a78bfa"))}
else if(w.ev==="connected"){parts.push(P("websocket connected","#22c55e"))}
else if(w.ev==="disconnected"){parts.push(P("websocket disconnected","#ef4444"))}
else{parts.push(P(JSON.stringify(d).slice(0,80),"#555"))}
L.push({k:"ws"+i,ca,parts})});
/* ── LINE COUNT ── */
L.push({k:"end",parts:[P(now+" ","#555"),P("[SYS]   ","#555"),P(L.length+" lines | ws:real-time","#444")]});
if(!L.length)return<div style={{padding:16,fontFamily:"'SF Mono',Menlo,monospace",fontSize:10,color:"#555"}}>connecting...</div>;
return L.map(l=><div key={l.k} onClick={()=>{const c=l.ca;if(c?.length>=20){sTab("radar");sRS(c);sRExp(c);setTimeout(()=>document.getElementById("tc")?.scrollIntoView({behavior:"smooth",block:"start"}),150)}}} style={{padding:"0 12px",cursor:l.ca?"pointer":"default",fontFamily:"'SF Mono',Menlo,monospace",fontSize:mb?8:10.5,lineHeight:mb?"15px":"19px",whiteSpace:"nowrap",borderLeft:"2px solid transparent"}} onMouseEnter={ev=>{ev.currentTarget.style.background="#ffffff06";if(l.ca)ev.currentTarget.style.borderLeftColor="#333"}} onMouseLeave={ev=>{ev.currentTarget.style.background="transparent";ev.currentTarget.style.borderLeftColor="transparent"}}>
{l.parts.map((p,pi)=>p.t?<span key={pi} style={{color:p.c}}>{p.t}</span>:null)}
</div>)})()}
</div>
</div>

{/* Live Radar Pulse — enhanced activity visualization */}
<div style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:10,display:"flex",flexDirection:"column",maxHeight:mb?360:460,overflow:"hidden"}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
<div style={{display:"flex",alignItems:"center",gap:6}}>
<span style={{width:8,height:8,borderRadius:"50%",background:T.gn,boxShadow:`0 0 12px ${T.gn}88,0 0 24px ${T.gn}44`,animation:"gp 1.5s infinite"}}/>
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
const fullCA=e.data?.ca||"";
const canApe=trW&&fullCA.length>=20&&score>=50&&!isRug;
return<div key={fullCA+i} style={{display:"grid",gridTemplateColumns:canApe?"16px 90px 1fr 28px 48px 56px":"16px 110px 1fr 28px 58px 32px",alignItems:"center",padding:"3px 0",borderBottom:i<11?"1px solid "+T.bd+"44":"none",gap:0}}>
<span style={{fontSize:8,color:T.ft,textAlign:"center"}}>{i+1}</span>
<div onClick={()=>{if(!fullCA||fullCA.length<20)return;sTab("radar");sRS(fullCA);sRExp(fullCA);setTimeout(()=>document.getElementById("tc")?.scrollIntoView({behavior:"smooth",block:"start"}),150)}} style={{paddingLeft:2,paddingRight:4,overflow:"hidden",cursor:"pointer"}}>
<span style={{fontSize:10,color:T.tx,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",display:"flex",alignItems:"center",gap:2}}>{name.slice(0,14)}{e.data?.dexBoosted&&<span style={{fontSize:6,fontWeight:800,color:"#ffd600",background:"#ffd60015",padding:"0 2px",borderRadius:2}}>DEX</span>}{bp>=100&&<span style={{fontSize:6,fontWeight:800,color:T.gn,background:T.gn+"15",padding:"0 2px",borderRadius:2}}>GRAD</span>}</span>
</div>
<div style={{height:16,borderRadius:4,background:T.sf,overflow:"hidden",position:"relative",marginRight:4}}>
<div style={{position:"absolute",left:0,top:0,height:"100%",width:Math.min(100,score)+"%",borderRadius:4,background:`linear-gradient(90deg,${sc}66,${sc})`,transition:"width 0.6s ease"}}/>
{bp<100&&<div style={{position:"absolute",left:Math.min(95,bp)+"%",top:2,width:2,height:12,borderRadius:1,background:"rgba(255,255,255,0.5)",transition:"left 0.6s ease"}}/>}
{isRug&&<div style={{position:"absolute",right:0,top:0,height:"100%",width:"30%",background:"repeating-linear-gradient(45deg,transparent,transparent 2px,#ff174422 2px,#ff174422 4px)"}}/>}
</div>
<span style={{fontSize:12,color:sc,fontWeight:900,textAlign:"right"}}>{score}</span>
<div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",paddingLeft:4}}>
<span style={{fontSize:7,color:bp>=100?T.gn:T.yl,fontWeight:700}}>{bp}%</span>
<span style={{fontSize:9,color:T.ft}}>${mcapStr}</span>
</div>
<div style={{textAlign:"center",display:"flex",justifyContent:"center",gap:2}}>
{canApe?<button onClick={(ev)=>{ev.stopPropagation();sITrade(p=>({...p,ca:p.ca===fullCA?null:fullCA}))}} style={{fontSize:7,fontWeight:800,color:iTrade.ca===fullCA?"#0a0a0f":T.gn,background:iTrade.ca===fullCA?T.gn:T.gn+"22",border:"none",borderRadius:3,padding:"2px 6px",cursor:"pointer",lineHeight:1.2}}>BUY</button>
:isRug?<span style={{fontSize:7,color:"#ff1744",fontWeight:800,padding:"1px 4px",borderRadius:3,background:"#ff174415"}} title={rugFlags.join(", ")}>RUG</span>
:score>=25?<span style={{fontSize:7,color:T.yl,fontWeight:800,padding:"1px 4px",borderRadius:3,background:T.yl+"15"}}>WATCH</span>
:null}
</div>
{/* Inline trade panel for radar pulse row */}
{iTrade.ca===fullCA&&<div onClick={ev=>ev.stopPropagation()} style={{gridColumn:"1/-1",padding:"6px 8px",background:T.bg,border:"1px solid "+T.gn+"33",borderRadius:6,marginTop:2}}>
<div style={{display:"flex",gap:4,alignItems:"center",marginBottom:4}}>
<div style={{flex:1}}><div style={{fontSize:7,color:T.ft,fontWeight:700}}>AMT</div><div style={{display:"flex",alignItems:"center",background:T.sf,borderRadius:3,border:"1px solid "+T.bd}}><button onClick={()=>sITrade(p=>({...p,amt:Math.max(0.01,+(p.amt-0.05).toFixed(2))}))} style={{padding:"2px 4px",background:"none",border:"none",color:T.ft,fontWeight:800,cursor:"pointer",fontSize:9}}>-</button><span style={{flex:1,textAlign:"center",fontSize:9,fontWeight:800,color:T.gn}}>{iTrade.amt}</span><button onClick={()=>sITrade(p=>({...p,amt:Math.min(10,+(p.amt+0.05).toFixed(2))}))} style={{padding:"2px 4px",background:"none",border:"none",color:T.ft,fontWeight:800,cursor:"pointer",fontSize:9}}>+</button></div></div>
<div style={{flex:1}}><div style={{fontSize:7,color:T.ft,fontWeight:700}}>SLIP</div><div style={{display:"flex",alignItems:"center",background:T.sf,borderRadius:3,border:"1px solid "+T.bd}}><button onClick={()=>sITrade(p=>({...p,slip:Math.max(1,p.slip-5)}))} style={{padding:"2px 4px",background:"none",border:"none",color:T.ft,fontWeight:800,cursor:"pointer",fontSize:9}}>-</button><span style={{flex:1,textAlign:"center",fontSize:9,fontWeight:800,color:T.yl}}>{iTrade.slip}%</span><button onClick={()=>sITrade(p=>({...p,slip:Math.min(50,p.slip+5)}))} style={{padding:"2px 4px",background:"none",border:"none",color:T.ft,fontWeight:800,cursor:"pointer",fontSize:9}}>+</button></div></div>
<div style={{flex:1}}><div style={{fontSize:7,color:T.ft,fontWeight:700}}>TIP</div><div style={{display:"flex",alignItems:"center",background:T.sf,borderRadius:3,border:"1px solid "+T.bd}}><button onClick={()=>sITrade(p=>({...p,tip:Math.max(0.001,+(p.tip-0.001).toFixed(3))}))} style={{padding:"2px 4px",background:"none",border:"none",color:T.ft,fontWeight:800,cursor:"pointer",fontSize:9}}>-</button><span style={{flex:1,textAlign:"center",fontSize:9,fontWeight:800,color:T.or}}>{iTrade.tip}</span><button onClick={()=>sITrade(p=>({...p,tip:Math.min(0.5,+(p.tip+0.001).toFixed(3))}))} style={{padding:"2px 4px",background:"none",border:"none",color:T.ft,fontWeight:800,cursor:"pointer",fontSize:9}}>+</button></div></div>
</div>
<div style={{display:"flex",gap:3}}>
<button onClick={()=>sITrade(p=>({...p,auto:!p.auto}))} style={{padding:"3px 6px",borderRadius:3,border:"1px solid "+(iTrade.auto?T.cy:T.bd),background:iTrade.auto?T.cy+"22":"none",color:iTrade.auto?T.cy:T.ft,fontWeight:800,fontSize:8,cursor:"pointer"}}>{iTrade.auto?"AUTO":"AUTO"}</button>
<button onClick={async()=>{if(iTrade.auto){try{const eff={...autoSettings(iTrade.amt),solPerTrade:iTrade.amt};const r=await a.ats(user.pubkey,eff);sAutoTrade({open:true,active:true,settings:r.settings,positions:[],log:[]});toast("Auto-ape started","success");sITrade(p=>({...p,ca:null}))}catch(e){toast(e.message,"error")}return}try{hp([6,15,6]);toast(`Buying ${iTrade.amt} SOL...`,"info");await quickBuy(fullCA,iTrade.amt,{slippage:iTrade.slip,tip:iTrade.tip});sITrade(p=>({...p,ca:null}))}catch(e){toast(e.message,"error")}}} style={{flex:1,padding:"4px 0",background:"linear-gradient(135deg,#00c853,#00e676)",border:"none",borderRadius:3,fontSize:9,fontWeight:900,color:"#0a0a0f",cursor:"pointer"}}>{iTrade.auto?"START AUTO":"BUY "+iTrade.amt+" SOL"}</button>
</div>
</div>}
</div>})}
</div>
{intelData?.gradWatch?.count>0&&<div style={{marginTop:6,paddingTop:6,borderTop:"1px solid "+T.bd}}>
<div onClick={()=>sGradsOpen(!gradsOpen)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}>
<span style={{fontSize:10,fontWeight:800,color:T.yl}}>Following Grads</span>
<span style={{fontSize:8,color:T.ft}}>{intelData.gradWatch.count} tracked 24h {gradsOpen?"▾":"▸"}</span>
</div>
{gradsOpen&&intelData.gradWatch.tokens?.map(g=>{const c=g.changePct>=0?T.gn:T.rd;const gCA=g.ca||"";return<div key={gCA} onClick={()=>{if(gCA.length>=20){sTab("radar");sRS(gCA);sRExp(gCA);setTimeout(()=>document.getElementById("tc")?.scrollIntoView({behavior:"smooth",block:"start"}),150)}}} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",fontSize:9,cursor:"pointer",borderRadius:3,transition:"background 0.1s"}} onMouseEnter={e=>e.currentTarget.style.background=T.sf} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
<span style={{color:T.tx,fontWeight:700,flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{g.name||gCA.slice(0,6)}</span>
<span style={{color:T.ft}}>${fm(g.currentMcap)}</span>
<span style={{color:c,fontWeight:800}}>{g.changePct>=0?"+":""}{g.changePct}%</span>
<span style={{color:T.ft}}>{g.age}h</span>
{g.peakMultiple>2&&<span style={{fontSize:8,padding:"1px 3px",borderRadius:2,background:T.yl+"12",color:T.yl,fontWeight:700}}>{g.peakMultiple}x</span>}
</div>})}
</div>}
</div>
</div>{/* end top signals grid */}

{/* ═══ ALL TOKENS — Full scored token list ═══ */}
<div style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:8,marginBottom:6,overflow:"hidden"}}>
<div onClick={()=>sITOpen(!intelTOpen)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",cursor:"pointer",borderBottom:intelTOpen?"1px solid "+T.bd:"none"}}>
<div style={{display:"flex",alignItems:"center",gap:6}}>
<span style={{fontSize:13,fontWeight:800}}>All Tokens</span>
<span style={{fontSize:11,color:T.ft}}>{intelTokens?.total||0} tracked</span>
</div>
<div style={{display:"flex",alignItems:"center",gap:4}}>
{intelTOpen&&<>{["all","pump","bags"].map(s=><button key={s} onClick={e=>{e.stopPropagation();sITSrc(s)}} style={{padding:"2px 6px",fontSize:9,fontWeight:intelTSrc===s?800:500,color:intelTSrc===s?(s==="bags"?T.gn:s==="pump"?"#b388ff":T.tx):T.ft,background:intelTSrc===s?(s==="bags"?T.gn:s==="pump"?"#b388ff":T.dm)+"12":"transparent",border:"1px solid "+(intelTSrc===s?T.bd:"transparent"),borderRadius:4,cursor:"pointer"}}>{s.toUpperCase()}</button>)}
{["score","mcap","buys","recent"].map(s=><button key={s} onClick={e=>{e.stopPropagation();sITSort(s)}} style={{padding:"2px 6px",fontSize:9,fontWeight:intelTSort===s?800:500,color:intelTSort===s?T.gn:T.ft,background:intelTSort===s?T.gn+"0a":"transparent",border:"1px solid "+(intelTSort===s?T.gn+"22":"transparent"),borderRadius:4,cursor:"pointer"}}>{s.toUpperCase()}</button>)}</>}
<span style={{fontSize:11,color:T.ft}}>{intelTOpen?"▾":"▸"}</span>
</div>
</div>
{intelTOpen&&<div style={{maxHeight:400,overflowY:"auto"}}>
{!intelTokens?<div style={{padding:20,textAlign:"center",fontSize:11,color:T.ft}}>Loading tokens...</div>
:intelTokens.tokens.length===0?<div style={{padding:20,textAlign:"center",fontSize:11,color:T.ft}}>No tokens yet</div>
:<>{/* Header */}
<div style={{display:"grid",gridTemplateColumns:mb?"36px 1fr 40px 50px":"36px 1fr 40px 40px 60px 50px 50px",gap:4,padding:"4px 10px",fontSize:9,fontWeight:700,color:T.ft,borderBottom:"1px solid "+T.bd,position:"sticky",top:0,background:T.bg,zIndex:1}}>
<span>#</span><span>TOKEN</span><span style={{textAlign:"right"}}>SCORE</span>{!mb&&<span style={{textAlign:"right"}}>BP%</span>}<span style={{textAlign:"right"}}>MC</span>{!mb&&<span style={{textAlign:"right"}}>BUYS</span>}<span style={{textAlign:"right"}}>SIGNAL</span>
</div>
{intelTokens.tokens.map((t,i)=>{const sc=t.score>=50?T.gn:t.score>=25?T.yl:t.rugRisk>50?T.rd:T.pu;const isBags=t.source==="bags";const bpW=Math.round((t.buyPressure||0)*100);return<div key={t.ca} onClick={()=>{sTab("radar");sRS(t.ca);sRExp(t.ca);setTimeout(()=>document.getElementById("tc")?.scrollIntoView({behavior:"smooth",block:"start"}),150)}} style={{display:"grid",gridTemplateColumns:mb?"36px 1fr 40px 50px":"36px 1fr 40px 40px 60px 50px 50px",gap:4,padding:"5px 10px",borderBottom:"1px solid "+T.bd+"66",cursor:"pointer",alignItems:"center",background:t.graduated?T.gn+"04":t.rugRisk>50?"#ff174404":"transparent"}}>
<div style={{width:28,height:28,borderRadius:5,overflow:"hidden",flexShrink:0,border:isBags?"1px solid "+T.gn+"66":"none"}}><TImg src={t.image} ticker={t.ticker} size={28}/></div>
<div style={{minWidth:0}}><div style={{display:"flex",alignItems:"center",gap:3}}><span style={{fontSize:11,fontWeight:800,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.name||t.ticker||t.ca?.slice(0,8)}</span>{isBags&&<span style={{fontSize:7,fontWeight:800,color:T.gn,background:T.gn+"12",padding:"0 3px",borderRadius:2}}>BAGS</span>}{t.graduated&&<span style={{fontSize:7,fontWeight:800,color:T.yl,background:T.yl+"12",padding:"0 3px",borderRadius:2}}>GRAD</span>}{t.twitter&&<IC.tw s={8} c={T.dm}/>}</div><div style={{fontSize:9,color:T.dm}}>{t.ticker}{t.h1Change?<span style={{color:t.h1Change>0?T.gn:"#ff4444",marginLeft:4}}>{t.h1Change>0?"+":""}{t.h1Change.toFixed(1)}%</span>:null}</div></div>
<span style={{fontSize:13,fontWeight:900,color:sc,textAlign:"right"}}>{t.score}</span>
{!mb&&<div style={{display:"flex",alignItems:"center",gap:2,justifyContent:"flex-end"}}><div style={{width:20,height:3,borderRadius:2,background:T.bd,overflow:"hidden"}}><div style={{width:bpW+"%",height:"100%",borderRadius:2,background:bpW>=70?T.gn:bpW>=50?T.yl:"#ff4444"}}/></div><span style={{fontSize:9,color:T.ft}}>{bpW}%</span></div>}
<span style={{fontSize:11,fontWeight:700,textAlign:"right",color:t.mcapUsd>=1e5?T.gn:t.mcapUsd>=1e4?T.yl:T.tx}}>${fm(t.mcapUsd)}</span>
{!mb&&<span style={{fontSize:11,textAlign:"right",color:T.dm}}>{t.buys}/{t.sells}</span>}
<div style={{textAlign:"right"}}>{t.entrySignal?<span style={{fontSize:8,fontWeight:800,padding:"1px 4px",borderRadius:3,color:t.entrySignal==="STRONG"||t.entrySignal==="READY"?T.gn:t.entrySignal==="EARLY"?T.yl:"#ff8800",background:(t.entrySignal==="STRONG"||t.entrySignal==="READY"?T.gn:t.entrySignal==="EARLY"?T.yl:"#ff8800")+"15"}}>{t.entrySignal}</span>:t.rugRisk>50?<span style={{fontSize:8,fontWeight:800,padding:"1px 4px",borderRadius:3,color:T.rd,background:T.rd+"15"}}>RUG</span>:null}</div>
</div>})}
</>}
</div>}
</div>

{/* ═══ ORACLE ENGINE — BONDLI BRAIN ═══ */}
{engineState&&(()=>{
const d=engineState.decisions||{ape:0,watch:0,skip:0,rug:0};
const total=d.ape+d.watch+d.skip+d.rug||1;
const fh=engineState.featureHeat||{};
const hot={ape:d.ape>0,watch:d.watch>0,skip:d.skip>0,rug:d.rug>0};
const wc={ape:T.gn,watch:T.yl,skip:T.ft,rug:T.rd};
const dominant=d.ape>=d.watch&&d.ape>=d.skip?"ape":d.watch>=d.skip?"watch":d.skip>d.rug?"skip":"rug";
const domC=wc[dominant];
const mods=engineState.modules||[];
const modActive=id=>{const m=mods.find(x=>x.id===id);return m?.status==="active"?1:m?.status==="reconnecting"?.4:0};
const hasLearner=(autoTrade?.learner?.totalTrades||0)>0;
const hasGradWatch=(intelData?.gradWatch?.count||0)>0;
const hasPatterns=(chartPatterns?.total||0)>0;
const actSmart=(intelData?.smartMoney?.signals?.length||0)>0;
const actArt=modActive("artwork_scanner")>0||modActive("scorer")>0;
const actGame=modActive("scorer")>0;
const hasSurv=(intelData?.survivor?.matched||0)>0;
/* Bezier curve helper: creates smooth S-curve between two points */
const bezier=(a,b)=>{const dx=b.x-a.x;const dy=b.y-a.y;if(Math.abs(dy)>Math.abs(dx)){const cy1=a.y+dy*0.4;const cy2=b.y-dy*0.4;return`M${a.x} ${a.y} C${a.x} ${cy1},${b.x} ${cy2},${b.x} ${b.y}`}const cx1=a.x+dx*0.4;const cx2=b.x-dx*0.4;return`M${a.x} ${a.y} C${cx1} ${a.y},${cx2} ${b.y},${b.x} ${b.y}`};
/* SVG dimensions — expanded for full brain map */
const W=mb?390:540;const H=mb?290:300;
/* Node sizes — wider to prevent text/border overlap */
const nw=mb?48:62;const nh=mb?22:28;
const cx=W/2;/* center x */
const hubR=mb?22:28;/* Hub circle radius */
/* Even spacing helper */
const inM=mb?10:22;const inSpan=W-inM*2-nw;const inGap=Math.floor(inSpan/3);
/* Tier 1: inputs (4 nodes) */
const t1y=24;
const pump={x:inM,y:t1y};
const scan={x:inM+inGap,y:t1y};
const score={x:inM+inGap*2,y:t1y};
const smartM={x:inM+inGap*3,y:t1y};
/* Tier 2: process — 5 nodes with hub centered */
const t2y=mb?78:84;
const prM=mb?6:14;const prSpan=W-prM*2-nw;const prGap=Math.floor(prSpan/4);
const social={x:prM,y:t2y};
const artw={x:prM+prGap,y:t2y};
const hub={x:prM+prGap*2,y:t2y};
const gameth={x:prM+prGap*3,y:t2y};
const rugd={x:prM+prGap*4,y:t2y};
/* Tier 3: outputs (4 nodes) */
const outY=mb?140:150;
const ape={x:inM,y:outY};
const watch={x:inM+inGap,y:outY};
const skip={x:inM+inGap*2,y:outY};
const rug={x:inM+inGap*3,y:outY};
/* Tier 4: feedback (4 nodes) */
const fbY=mb?200:216;
const learner={x:inM,y:fbY};
const gradW={x:inM+inGap,y:fbY};
const surv={x:inM+inGap*2,y:fbY};
const patterns={x:inM+inGap*3,y:fbY};
/* Helper: node center */
const nc=(n)=>({x:n.x+nw/2,y:n.y+nh/2});
const nr=(n)=>({x:n.x+nw,y:n.y+nh/2});
const nl=(n)=>({x:n.x,y:n.y+nh/2});
const nb=(n)=>({x:n.x+nw/2,y:n.y+nh});
const nt=(n)=>({x:n.x+nw/2,y:n.y});
return<div style={{margin:"8px 0",background:`linear-gradient(135deg,${T.bg},${T.sf}66,${T.bg})`,border:"1px solid "+T.pu+"22",borderRadius:10,padding:mb?"8px 4px":"12px 10px",position:"relative",overflow:"hidden"}}>
{/* PCB dot pattern */}
<div style={{position:"absolute",inset:0,opacity:.03,backgroundImage:`radial-gradient(${T.cy} 1px,transparent 1px)`,backgroundSize:"16px 16px"}}/>
<div style={{position:"absolute",top:-30,left:"30%",width:120,height:120,borderRadius:"50%",background:`radial-gradient(circle,${domC}10,transparent 70%)`,filter:"blur(25px)",transition:"background 2s"}}/>
<div style={{position:"absolute",bottom:-20,right:"30%",width:100,height:100,borderRadius:"50%",background:`radial-gradient(circle,${T.pu}08,transparent 70%)`,filter:"blur(20px)"}}/>

{/* Header */}
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4,position:"relative",zIndex:2}}>
<div style={{display:"flex",alignItems:"center",gap:6}}>
<div style={{width:8,height:8,borderRadius:"50%",background:`linear-gradient(135deg,#9945FF,#14F195)`,boxShadow:"0 0 10px #9945FF66,0 0 20px #14F19533",animation:"gp 1.5s infinite"}}/>
<span style={{fontSize:11,fontWeight:900,letterSpacing:2,textTransform:"uppercase",background:"linear-gradient(90deg,#9945FF,#14F195)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Bondli Brain</span>
</div>
<div style={{display:"flex",alignItems:"center",gap:6,fontSize:8,color:T.ft}}>
<span style={{color:T.gn}}>{engineState.flow?.totalBuys||0}<span style={{color:T.ft}}> buys</span></span>
<span style={{color:T.rd}}>{engineState.flow?.totalSells||0}<span style={{color:T.ft}}> sells</span></span>
<span style={{color:T.yl}}>{engineState.flow?.totalVol||0}<span style={{color:T.ft}}> SOL</span></span>
<span style={{color:T.dm}}>|</span>
<span style={{color:T.dm}}>{engineState.pool?.total||0} pool</span>
<span style={{color:T.dm}}>{engineState.pool?.active||0} active</span>
<span style={{color:T.dm}}>{engineState.pool?.graduated||0} grad</span>
</div>
</div>

{/* ═══ WIRE DIAGRAM ═══ */}
<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{position:"relative",zIndex:1,display:"block"}}>
<defs>
<filter id="wglow"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="nglow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="fbglow"><feGaussianBlur stdDeviation="1.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<linearGradient id="solGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#9945FF"/><stop offset="100%" stopColor="#14F195"/></linearGradient>
<radialGradient id="hubGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#9945FF" stopOpacity=".15"/><stop offset="50%" stopColor="#14F195" stopOpacity=".08"/><stop offset="100%" stopColor="transparent" stopOpacity="0"/></radialGradient>
</defs>

{/* ── PUMPFUN PILL inside PumpPortal card (left of text) ── */}

{/* ── TIER LABELS ── */}
<text x="4" y={pump.y+nh/2+1} fill={T.ft} fontSize="5.5" fontFamily="monospace" opacity=".4">INPUT</text>
<text x="4" y={hub.y+nh/2+1} fill={T.ft} fontSize="5.5" fontFamily="monospace" opacity=".4">PROCESS</text>
<text x="4" y={outY+nh/2+1} fill={T.ft} fontSize="5.5" fontFamily="monospace" opacity=".4">OUTPUT</text>
<text x="4" y={fbY+nh/2+1} fill={T.ft} fontSize="5.5" fontFamily="monospace" opacity=".4">LEARN</text>
{/* Tier separator lines */}
<line x1="0" y1={pump.y+nh+4} x2={W} y2={pump.y+nh+4} stroke={T.ft} strokeWidth=".5" opacity=".06" strokeDasharray="4 4"/>
<line x1="0" y1={outY-4} x2={W} y2={outY-4} stroke={T.ft} strokeWidth=".5" opacity=".06" strokeDasharray="4 4"/>
<line x1="0" y1={fbY-4} x2={W} y2={fbY-4} stroke={T.ft} strokeWidth=".5" opacity=".06" strokeDasharray="4 4"/>

{/* ── DIM WIRES (flexible bezier curves) ── */}
{/* Forward flow: Pump→Scan→Score, SmartM independent */}
<path d={bezier(nr(pump),nl(scan))} fill="none" stroke={T.ft} strokeWidth="1.5" opacity=".12"/>
<path d={bezier(nr(scan),nl(score))} fill="none" stroke={T.ft} strokeWidth="1.5" opacity=".12"/>
{/* SmartM → Hub: diagonal down-left */}
<path d={bezier(nb(smartM),{x:nc(hub).x+hubR+4,y:nt(hub).y})} fill="none" stroke={T.ft} strokeWidth="1.5" opacity=".12"/>
{/* Down to hub: Score→Hub, Social→Artw→Hub, Hub→GameTh→Rug */}
<path d={bezier(nb(scan),nt(hub))} fill="none" stroke={T.ft} strokeWidth="1.5" opacity=".12"/>
<path d={bezier(nr(social),nl(artw))} fill="none" stroke={T.ft} strokeWidth="1.5" opacity=".12"/>
<path d={bezier(nr(artw),{x:nc(hub).x-hubR,y:nc(hub).y})} fill="none" stroke={T.ft} strokeWidth="1.5" opacity=".12"/>
<path d={bezier({x:nc(hub).x+hubR,y:nc(hub).y},nl(gameth))} fill="none" stroke={T.ft} strokeWidth="1.5" opacity=".12"/>
<path d={bezier(nr(gameth),nl(rugd))} fill="none" stroke={T.ft} strokeWidth="1.5" opacity=".12"/>
{/* Hub → outputs (fan out from hub bottom, each wire goes to its own output) */}
{[{n:ape,off:-8},{n:watch,off:-3},{n:skip,off:3},{n:rug,off:8}].map((o,i)=>{
const from={x:nb(hub).x+o.off,y:nb(hub).y};
return<path key={"dw"+i} d={`M${from.x} ${from.y} C${from.x} ${from.y+16},${nt(o.n).x} ${nt(o.n).y-16},${nt(o.n).x} ${nt(o.n).y}`} fill="none" stroke={T.ft} strokeWidth="1.5" opacity=".12"/>})}
{/* Feedback wires — routed along edges to avoid crossing through output tier */}
{/* Learner → Scorer: left side loop */}
<path d={`M${nt(learner).x} ${nt(learner).y} C${nt(learner).x-15} ${nt(learner).y-30},${nb(score).x-25} ${nb(score).y+25},${nb(score).x} ${nb(score).y}`} fill="none" stroke={T.ft} strokeWidth="1" opacity=".08" strokeDasharray="3 3"/>
{/* GradWatch → Hub: straight up */}
<path d={bezier(nt(gradW),{x:nb(hub).x-4,y:nb(hub).y+8})} fill="none" stroke={T.ft} strokeWidth="1" opacity=".08" strokeDasharray="3 3"/>
{/* Survivorship → Hub: up */}
<path d={bezier(nt(surv),{x:nb(hub).x+4,y:nb(hub).y+8})} fill="none" stroke={T.ft} strokeWidth="1" opacity=".08" strokeDasharray="3 3"/>
{/* Patterns → Rug Detect: right side loop — wide radius to clear RUG card */}
{(()=>{const fbOff=mb?20:40;return<path d={`M${nr(patterns).x} ${nr(patterns).y} C${nr(patterns).x+fbOff} ${nr(patterns).y},${nr(rugd).x+fbOff} ${nr(rugd).y},${nr(rugd).x} ${nr(rugd).y}`} fill="none" stroke={T.ft} strokeWidth="1" opacity=".08" strokeDasharray="3 3"/>})()}
{/* APE → Learner: straight down */}
<path d={bezier(nb(ape),nt(learner))} fill="none" stroke={T.ft} strokeWidth="1" opacity=".08" strokeDasharray="3 3"/>
{/* WATCH → GradWatch: straight down */}
<path d={bezier(nb(watch),nt(gradW))} fill="none" stroke={T.ft} strokeWidth="1" opacity=".08" strokeDasharray="3 3"/>
{/* SKIP → Survivorship: straight down */}
<path d={bezier(nb(skip),nt(surv))} fill="none" stroke={T.ft} strokeWidth="1" opacity=".08" strokeDasharray="3 3"/>
{/* RUG → Patterns: straight down */}
<path d={bezier(nb(rug),nt(patterns))} fill="none" stroke={T.ft} strokeWidth="1" opacity=".08" strokeDasharray="3 3"/>

{/* ── LIT WIRES + PARTICLES (particles on mobile only — desktop gets clean glowing wires) ── */}
{(()=>{
const actPump=modActive("pumpportal")>0;const actScore=modActive("scorer")>0;const actSocial=fh.socialSignals>.1;const actRug=fh.rugRisk>.05;
const fbOff=mb?20:40;
const l2sPath=`M${nl(learner).x} ${nl(learner).y} C${nl(learner).x-20} ${nl(learner).y},${nl(learner).x-20} ${nb(score).y+nh+8},${nb(score).x} ${nb(score).y}`;
const p2rPath=`M${nr(patterns).x} ${nr(patterns).y} C${nr(patterns).x+fbOff} ${nr(patterns).y},${nr(rugd).x+fbOff} ${nr(rugd).y},${nr(rugd).x} ${nr(rugd).y}`;
const s2hPath=bezier(nt(surv),{x:nb(hub).x+4,y:nb(hub).y+8});
return<>
{/* Forward flow wires — desktop uses stroke-dashoffset animation for flowing light effect */}
{(()=>{const wf=!mb?{strokeDasharray:"16 8",animation:"wireflow 1.5s linear infinite"}:{};const wfSlow=!mb?{strokeDasharray:"16 8",animation:"wireflow 2s linear infinite"}:{};const fb=!mb?{strokeDasharray:"6 12",animation:"wirefb 2s linear infinite"}:{strokeDasharray:"4 2"};const fbSlow=!mb?{strokeDasharray:"6 12",animation:"wirefb 3s linear infinite"}:{strokeDasharray:"4 2"};return<>
<path id="bp2s" d={bezier(nr(pump),nl(scan))} fill="none" stroke={T.cy} strokeWidth="1.5" style={{opacity:actPump?.6:.15,transition:"opacity .8s",...wf}} filter="url(#wglow)"/>
<path id="bs2sc" d={bezier(nr(scan),nl(score))} fill="none" stroke={T.pu} strokeWidth="1.5" style={{opacity:actScore?.5:.12,transition:"opacity .8s",...wf}} filter="url(#wglow)"/>
<path id="bsm2h" d={bezier(nb(smartM),{x:nc(hub).x+hubR+4,y:nt(hub).y})} fill="none" stroke="#14F195" strokeWidth="1.5" style={{opacity:actSmart?.5:.1,transition:"opacity .8s",...wfSlow}} filter="url(#wglow)"/>
<path id="bs2h" d={bezier(nb(scan),nt(hub))} fill="none" stroke={domC} strokeWidth="1.5" style={{opacity:actScore?.4:.1,transition:"opacity .8s",...wfSlow}} filter="url(#wglow)"/>
<path id="bso2a" d={bezier(nr(social),nl(artw))} fill="none" stroke={T.or} strokeWidth="1.5" style={{opacity:actSocial?.4:.1,transition:"opacity .8s",...wfSlow}} filter="url(#wglow)"/>
<path id="ba2h" d={bezier(nr(artw),{x:nc(hub).x-hubR,y:nc(hub).y})} fill="none" stroke="#F472B6" strokeWidth="1.5" style={{opacity:actArt?.4:.1,transition:"opacity .8s",...wfSlow}} filter="url(#wglow)"/>
<path id="bh2gt" d={bezier({x:nc(hub).x+hubR,y:nc(hub).y},nl(gameth))} fill="none" stroke="#60A5FA" strokeWidth="1.5" style={{opacity:actGame?.4:.1,transition:"opacity .8s",...wfSlow}} filter="url(#wglow)"/>
<path id="bgt2r" d={bezier(nr(gameth),nl(rugd))} fill="none" stroke={T.rd} strokeWidth="1.5" style={{opacity:actRug?.4:.1,transition:"opacity .8s",...wfSlow}} filter="url(#wglow)"/>
{/* Hub → output wires */}
{[{k:"ape",n:ape,off:-8},{k:"watch",n:watch,off:-3},{k:"skip",n:skip,off:3},{k:"rug",n:rug,off:8}].map(({k,n,off})=>{const act=hot[k];const isDom=k===dominant;const from={x:nb(hub).x+off,y:nb(hub).y};const pid="bh2"+k;const pth=`M${from.x} ${from.y} C${from.x} ${from.y+16},${nt(n).x} ${nt(n).y-16},${nt(n).x} ${nt(n).y}`;return<path key={pid} id={pid} d={pth} fill="none" stroke={wc[k]} strokeWidth="1.5" style={{opacity:act?(isDom?.7:.3):.08,transition:"opacity .8s",...wf}} filter="url(#wglow)"/>})}
{/* Feedback wires */}
<path id="bfa2l" d={bezier(nb(ape),nt(learner))} fill="none" stroke={T.gn} strokeWidth="1" style={{opacity:hasLearner&&hot.ape?.3:.08,transition:"opacity .8s",...fb}} filter="url(#fbglow)"/>
<path id="bfl2s" d={l2sPath} fill="none" stroke={T.cy} strokeWidth="1" style={{opacity:hasLearner?.25:.06,transition:"opacity .8s",...fbSlow}} filter="url(#fbglow)"/>
<path id="bfw2g" d={bezier(nb(watch),nt(gradW))} fill="none" stroke={T.yl} strokeWidth="1" style={{opacity:hasGradWatch?.3:.08,transition:"opacity .8s",...fb}} filter="url(#fbglow)"/>
<path id="bfg2h" d={bezier(nt(gradW),{x:nb(hub).x-4,y:nb(hub).y+8})} fill="none" stroke={T.yl} strokeWidth="1" style={{opacity:hasGradWatch?.2:.06,transition:"opacity .8s",...fbSlow}} filter="url(#fbglow)"/>
<path id="bfs2h" d={s2hPath} fill="none" stroke="#A78BFA" strokeWidth="1" style={{opacity:hasSurv?.25:.06,transition:"opacity .8s",...fbSlow}} filter="url(#fbglow)"/>
<path id="bfsk2s" d={bezier(nb(skip),nt(surv))} fill="none" stroke={T.ft} strokeWidth="1" style={{opacity:hasSurv?.2:.06,transition:"opacity .8s",...fb}} filter="url(#fbglow)"/>
<path id="bfr2p" d={bezier(nb(rug),nt(patterns))} fill="none" stroke={T.rd} strokeWidth="1" style={{opacity:hasPatterns&&hot.rug?.25:.06,transition:"opacity .8s",...fb}} filter="url(#fbglow)"/>
<path id="bfp2r" d={p2rPath} fill="none" stroke={T.or} strokeWidth="1" style={{opacity:hasPatterns?.2:.06,transition:"opacity .8s",...fbSlow}} filter="url(#fbglow)"/>
</>})()}
{/* Particles — mobile only (animateMotion breaks on desktop due to SVG viewBox scaling) */}
{mb&&<>
<circle r="2.5" filter="url(#wglow)" style={{fill:T.cy,opacity:actPump?1:.4,transition:"opacity .8s"}}><animateMotion dur="2s" repeatCount="indefinite"><mpath href="#bp2s"/></animateMotion></circle>
<circle r="2" filter="url(#wglow)" style={{fill:T.pu,opacity:actScore?1:.35,transition:"opacity .8s"}}><animateMotion dur="2s" repeatCount="indefinite"><mpath href="#bs2sc"/></animateMotion></circle>
<circle r="2" filter="url(#wglow)" style={{fill:domC,opacity:actScore?1:.3,transition:"opacity .8s"}}><animateMotion dur="2.5s" repeatCount="indefinite"><mpath href="#bs2h"/></animateMotion></circle>
<circle r="1.8" filter="url(#wglow)" style={{fill:T.or,opacity:actSocial?1:.3,transition:"opacity .8s"}}><animateMotion dur="3s" repeatCount="indefinite"><mpath href="#bso2h"/></animateMotion></circle>
<circle r="1.8" filter="url(#wglow)" style={{fill:T.rd,opacity:actRug?1:.3,transition:"opacity .8s"}}><animateMotion dur="2.5s" repeatCount="indefinite"><mpath href="#br2h"/></animateMotion></circle>
{[{k:"ape",c:wc.ape},{k:"watch",c:wc.watch},{k:"skip",c:wc.skip},{k:"rug",c:wc.rug}].map(({k,c})=><circle key={"p_"+k} r="2" filter="url(#wglow)" style={{fill:c,opacity:hot[k]?.9:.3,transition:"opacity .8s"}}><animateMotion dur="2s" repeatCount="indefinite"><mpath href={"#bh2"+k}/></animateMotion></circle>)}
<circle r="1.5" filter="url(#fbglow)" style={{fill:T.gn,opacity:hasLearner&&hot.ape?.7:.25,transition:"opacity .8s"}}><animateMotion dur="3.5s" repeatCount="indefinite"><mpath href="#bfa2l"/></animateMotion></circle>
<circle r="1.2" filter="url(#fbglow)" style={{fill:T.cy,opacity:hasLearner?.6:.2,transition:"opacity .8s"}}><animateMotion dur="4.5s" repeatCount="indefinite"><mpath href="#bfl2s"/></animateMotion></circle>
<circle r="1.2" filter="url(#fbglow)" style={{fill:T.yl,opacity:hasGradWatch?.7:.25,transition:"opacity .8s"}}><animateMotion dur="3.5s" repeatCount="indefinite"><mpath href="#bfw2g"/></animateMotion></circle>
<circle r="1.2" filter="url(#fbglow)" style={{fill:T.yl,opacity:hasGradWatch?.5:.2,transition:"opacity .8s"}}><animateMotion dur="4.5s" repeatCount="indefinite"><mpath href="#bfg2h"/></animateMotion></circle>
<circle r="1.2" filter="url(#fbglow)" style={{fill:T.rd,opacity:hasPatterns&&hot.rug?.6:.2,transition:"opacity .8s"}}><animateMotion dur="4s" repeatCount="indefinite"><mpath href="#bfr2p"/></animateMotion></circle>
<circle r="1.2" filter="url(#fbglow)" style={{fill:T.or,opacity:hasPatterns?.5:.2,transition:"opacity .8s"}}><animateMotion dur="4.5s" repeatCount="indefinite"><mpath href="#bfp2r"/></animateMotion></circle>
</>}
</>})()}

{/* ── PROCESS NODES (Tier 1: Input + Tier 2: Process) ── */}
{[
{n:pump,label:"PumpPortal",sub:"WS Feed",c:T.cy,v:engineState.pool?.recent5m||0,active:modActive("pumpportal"),ico:"P",pillImg:true},
{n:scan,label:"Scanner",sub:"Filter",c:T.pu,v:engineState.pool?.active||0,active:modActive("scorer"),ico:"S"},
{n:score,label:"Scorer",sub:"Velocity",c:T.pu,v:total,active:modActive("scorer"),ico:"V"},
{n:smartM,label:"Smart $",sub:"Wallets",c:"#14F195",v:intelData?.smartMoney?.signals?.length||0,active:actSmart?1:0,ico:"$"},
{n:social,label:"Social",sub:"Signals",c:T.or,v:Math.round(fh.socialSignals*100)+"%",active:fh.socialSignals>.05?1:0,ico:"W"},
{n:artw,label:"Artwork",sub:"Forensics",c:"#F472B6",v:intelData?.artwork?.scanned||0,active:actArt?1:0,ico:"A"},
{n:hub,label:"CORTEX",sub:"Inference",c:domC,v:total,active:1,isHub:true},
{n:gameth,label:"Game Th.",sub:"Bayesian",c:"#60A5FA",v:engineState.flow?.externalBuyers||0,active:actGame?1:0,ico:"G"},
{n:rugd,label:"Rug Detect",sub:"Safety",c:T.rd,v:d.rug,active:modActive("rug_detector"),ico:"R"},
].map((nd,i)=>nd.isHub?<g key={"n"+i}>
<circle cx={nc(nd.n).x} cy={nc(nd.n).y} r={hubR+6} fill="url(#hubGlow)"/>
<circle cx={nc(nd.n).x} cy={nc(nd.n).y} r={hubR+2} fill="none" stroke="url(#solGrad)" strokeWidth="1.5" opacity=".5" style={{animation:"gp 2s infinite"}}/>
<circle cx={nc(nd.n).x} cy={nc(nd.n).y} r={hubR-1} fill={T.bg} stroke="url(#solGrad)" strokeWidth="2"/>
{/* Bondli logo — centered inside top of brain circle */}
<image href="/bondli-logo.svg" x={nc(nd.n).x-12} y={nc(nd.n).y-hubR+5} width="24" height="20" opacity=".9"/>
<text x={nc(nd.n).x} y={nc(nd.n).y+4} textAnchor="middle" fill="url(#solGrad)" fontSize={mb?"5":"7"} fontWeight="900" fontFamily="monospace" letterSpacing=".8">{nd.label}</text>
<text x={nc(nd.n).x} y={nc(nd.n).y+12} textAnchor="middle" fill={T.dm} fontSize={mb?"3.5":"5"} fontFamily="monospace">{nd.sub} · {kFmt(nd.v)}</text>
<circle cx={nc(nd.n).x} cy={nc(nd.n).y-hubR+2} r="2.5" fill="#14F195" opacity=".9"><animate attributeName="opacity" values="1;.4;1" dur="1.5s" repeatCount="indefinite"/></circle>
</g>:<g key={"n"+i}>
{(()=>{const pw=nd.pillImg?nw+14:nw;const px=nd.pillImg?nd.n.x-7:nd.n.x;return<>
{nd.active>.5&&<rect x={px-2} y={nd.n.y-2} width={pw+4} height={nh+4} rx="7" fill={nd.c} opacity=".08" filter="url(#nglow)"/>}
<rect x={px} y={nd.n.y} width={pw} height={nh} rx="5" fill={T.bg} stroke={nd.active>.5?nd.c:T.ft} strokeWidth="1" opacity={nd.active>.5?1:.5}/>
{nd.pillImg?<image href="/pumpfun-pill.svg" x={px+2} y={nd.n.y+5} width={nh-10} height={nh-10} opacity=".8"/>:<text x={nd.n.x+8} y={nd.n.y+8} fontSize="5" fill={nd.c} opacity=".5">{nd.ico}</text>}
<circle cx={px+pw-6} cy={nd.n.y+6} r="2" fill={nd.active>.5?T.gn:T.ft} opacity={nd.active>.5?1:.3}><animate attributeName="opacity" values={nd.active>.5?"1;.4;1":".3"} dur="2s" repeatCount="indefinite"/></circle>
<text x={px+pw/2} y={nd.n.y+nh/2} textAnchor="middle" fill={nd.active>.5?nd.c:T.ft} fontSize={mb?"4.5":"6.5"} fontWeight="900" fontFamily="monospace" letterSpacing=".3">{nd.label}</text>
<text x={px+pw/2} y={nd.n.y+nh/2+7} textAnchor="middle" fill={T.ft} fontSize={mb?"3.5":"5"} fontFamily="monospace">{nd.sub} · {kFmt(nd.v)}</text>
</>})()}
</g>)}

{/* ── OUTPUT NODES (Tier 3) ── */}
{[
{n:ape,id:"ape",label:"APE",c:T.gn,v:d.ape},
{n:watch,id:"watch",label:"WATCH",c:T.yl,v:d.watch},
{n:skip,id:"skip",label:"SKIP",c:T.ft,v:d.skip},
{n:rug,id:"rug",label:"RUG",c:T.rd,v:d.rug},
].map(nd=><g key={nd.id}>
{hot[nd.id]&&nd.id===dominant&&<rect x={nd.n.x-2} y={nd.n.y-2} width={nw+4} height={nh+4} rx="7" fill={nd.c} opacity=".15" filter="url(#nglow)"/>}
<rect x={nd.n.x} y={nd.n.y} width={nw} height={nh} rx="5" fill={hot[nd.id]?nd.c+"12":T.bg} stroke={hot[nd.id]?nd.c:T.ft+"44"} strokeWidth={nd.id===dominant?"1.5":"1"}/>
<text x={nd.n.x+nw/2} y={nd.n.y+nh/2-2} textAnchor="middle" fill={hot[nd.id]?nd.c:T.ft} fontSize={mb?"5":"7"} fontWeight="900" fontFamily="monospace" letterSpacing=".8">{nd.label}</text>
<text x={nd.n.x+nw/2} y={nd.n.y+nh/2+7} textAnchor="middle" fill={hot[nd.id]?nd.c:T.ft} fontSize={mb?"5":"7"} fontWeight="900" fontFamily="monospace" opacity=".8">{kFmt(nd.v)}</text>
</g>)}

{/* ── FEEDBACK NODES (Tier 4) ── */}
{[
{n:learner,label:"Learner",sub:"Outcomes",c:T.cy,v:autoTrade?.learner?.totalTrades||0,active:hasLearner},
{n:gradW,label:"Grad Watch",sub:"Monitor",c:T.yl,v:intelData?.gradWatch?.count||0,active:hasGradWatch},
{n:surv,label:"Survivor",sub:"Archetype",c:"#A78BFA",v:intelData?.survivor?.matched||0,active:hasSurv},
{n:patterns,label:"Patterns",sub:"Memory",c:T.or,v:chartPatterns?.total||0,active:hasPatterns},
].map((nd,i)=><g key={"fb"+i}>
<rect x={nd.n.x} y={nd.n.y} width={nw} height={nh} rx="5" fill={T.bg} stroke={nd.active?nd.c+"66":T.ft+"33"} strokeWidth="1" strokeDasharray={nd.active?"":"3 2"} opacity={nd.active?1:.4}/>
<text x={nd.n.x+nw/2} y={nd.n.y+nh/2-2} textAnchor="middle" fill={nd.active?nd.c:T.ft} fontSize={mb?"4":"5.5"} fontWeight="800" fontFamily="monospace" letterSpacing=".3">{nd.label}</text>
<text x={nd.n.x+nw/2} y={nd.n.y+nh/2+6} textAnchor="middle" fill={T.ft} fontSize={mb?"3.5":"5"} fontFamily="monospace">{nd.sub} · {kFmt(nd.v)}</text>
{nd.active&&<circle cx={nd.n.x+nw-3} cy={nd.n.y+3} r="1.5" fill={T.gn} opacity=".8"><animate attributeName="opacity" values="1;.3;1" dur="3s" repeatCount="indefinite"/></circle>}
</g>)}

{/* Feedback label */}
<text x={W/2} y={fbY+nh+14} textAnchor="middle" fill={T.ft} fontSize="4.5" fontFamily="monospace" opacity=".3">↑ feedback loops — outcomes train future decisions ↑</text>
</svg>

{/* ═══ DYNAMICS BAR — Acceleration, Impulse, Momentum ═══ */}
{(()=>{const dy=engineState.dynamics;if(!dy||!dy.tracked)return null;const tr=dy.trends||{};const mm=dy.momentum||{};const av=dy.avg||{};
const trendBars=[{k:"rocket",c:T.gn,l:"🚀"},{k:"rising",c:"#4ade80",l:"↑"},{k:"building",c:T.yl,l:"⬆"},{k:"stable",c:T.ft,l:"—"},{k:"fading",c:T.or,l:"↓"},{k:"crashing",c:T.rd,l:"💥"}];
const accelColor=av.acceleration>0.005?T.gn:av.acceleration<-0.005?T.rd:T.ft;
const impulseColor=av.impulse>15?T.gn:av.impulse>5?T.yl:T.ft;
const momLabel=mm.sustained>mm.flash&&mm.sustained>mm.nascent?"SUSTAINED":mm.flash>mm.building?"FLASH":mm.building>mm.nascent?"BUILDING":"NASCENT";
const momColor=momLabel==="SUSTAINED"?T.gn:momLabel==="FLASH"?T.or:momLabel==="BUILDING"?T.yl:T.ft;
return<div style={{display:"flex",alignItems:"center",gap:mb?4:8,padding:"4px 8px",marginTop:4,background:T.bg+"88",borderRadius:6,border:"1px solid "+T.bd+"44",fontSize:mb?7:9,fontFamily:"monospace",flexWrap:"wrap"}}>
{/* Acceleration gauge */}
<div style={{display:"flex",alignItems:"center",gap:3}}>
<span style={{color:T.ft,opacity:.6}}>d²S/dt²</span>
<span style={{color:accelColor,fontWeight:800}}>{av.acceleration>0?"+":""}{(av.acceleration*1000).toFixed(1)}<span style={{color:T.ft,fontWeight:400,opacity:.5}}>m</span></span>
</div>
<span style={{color:T.bd}}>|</span>
{/* Impulse (area under curve) */}
<div style={{display:"flex",alignItems:"center",gap:3}}>
<span style={{color:T.ft,opacity:.6}}>∫v·dt</span>
<span style={{color:impulseColor,fontWeight:800}}>{av.impulse.toFixed(1)}</span>
</div>
<span style={{color:T.bd}}>|</span>
{/* Momentum classification */}
<div style={{display:"flex",alignItems:"center",gap:3}}>
<span style={{color:T.ft,opacity:.6}}>momentum</span>
<span style={{color:momColor,fontWeight:900,letterSpacing:.5}}>{momLabel}</span>
</div>
<span style={{color:T.bd}}>|</span>
{/* Trend distribution mini-bar */}
<div style={{display:"flex",alignItems:"center",gap:2,flex:1,minWidth:60}}>
{trendBars.map(b=>{const cnt=(tr[b.k]||0)+(b.k==="building"?(mm.building||0):0);const pct=dy.tracked>0?cnt/dy.tracked*100:0;return pct>0?<div key={b.k} style={{height:6,borderRadius:3,background:b.c,flex:pct,minWidth:pct>5?4:2,opacity:.7}} title={`${b.k}: ${cnt}`}/>:null})}
<span style={{color:T.ft,opacity:.4,marginLeft:2}}>{dy.tracked}tok</span>
</div>
</div>})()}
</div>})()}
</div>

{/* How it works — collapsible */}
<div onClick={()=>sShowHow(!showHow)} style={{padding:"8px 10px",background:T.sf,border:"1px solid "+T.bd,borderRadius:8,marginBottom:6,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<span style={{fontSize:12,fontWeight:700,color:T.dm}}>How scoring works</span>
<span style={{fontSize:10,color:T.ft}}>{showHow?"▾":"▸"}</span>
</div>
{showHow&&<>
<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr 1fr",gap:4,marginBottom:6}}>
{[{name:"Tipping Point (Gladwell)",color:T.gn,items:["Law of the Few — whale/influencer concentration","Stickiness Factor — meme phrase memorability","Power of Context — trending topic + market mood","Maven/Connector/Salesman — wallet archetype signals","10K Hour Rule — token pattern maturity depth"]},
{name:"Thinking Fast & Slow (Kahneman)",color:T.yl,items:["Cognitive Ease — name pronounceability score","Anchoring Bias — first price vs current price drift","Availability Heuristic — recency of similar rugs","Loss Aversion — 2x weight on sell pressure vs buys","Herd Signal — System 1 buy acceleration cascade","Peak-End Rule — chart shape memory at peak + now","Prospect Theory — framing effect on holder behavior"]},
{name:"Blink + Outliers (Gladwell)",color:"#ff9800",items:["Thin-Slicing — first 30s pattern = 80% accuracy","Outlier Detection — 3σ deviation from normal launches","Rapid Cognition — sub-second rug signature match","Accumulative Advantage — early mover wallet clustering"]},
{name:"On-Chain Velocity",color:T.or,items:["Buy velocity 1m/5m","Unique buyers in 5 min","Gini coefficient of buys","Dev wallet hold %"]},
{name:"Social Signals",color:T.pu,items:["Twitter/Telegram/Website presence","Name length + ticker length","Description sentiment","Emoji density + type analysis"]},
{name:"Mimetic + Reflexivity (Girard/Soros)",color:T.cy,items:["Mimetic Desire — copy-wallet clustering rate","Reflexivity Loop — price↔narrative feedback strength","Schelling Point — ticker/name cultural focal magnetism","Contagion R0 — buyer-to-buyer spread velocity","Antifragile Signal — dip recovery stronger than prior ATH"]}
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

{/* Live ML Behavior — Pro/VIP only — collapsible */}
{intelData?.scorer?.topFeatures?.length>0&&<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:10,marginTop:6}}>
<div onClick={()=>sShowModel(!showModel)} style={{display:"flex",alignItems:"center",gap:6,padding:mb?"8px":"12px",cursor:"pointer"}}><IC.sim s={14} c={T.pu}/><span style={{fontSize:11,fontWeight:800}}>Model Behavior</span><span style={{fontSize:7,color:T.dm}}>live feature weights</span><span style={{marginLeft:"auto",fontSize:10,color:T.ft}}>{showModel?"▾":"▸"}</span></div>
{showModel&&<div style={{padding:mb?"0 8px 8px":"0 12px 12px"}}>
{/* Feature weight bars */}
<div style={{display:"grid",gap:4}}>
{intelData.scorer.topFeatures.slice(0,8).map((f,i)=>{const maxW=parseFloat(intelData.scorer.topFeatures[0]?.weight)||2.5;const pct=Math.min(100,Math.round((parseFloat(f.weight)/maxW)*100));const featureNames={oc_buyVelocity5m:"Buy Velocity (5m)",tp_stickiness:"Meme Stickiness",oc_uniqueBuyers5m:"Unique Buyers (5m)",k_herdSignal:"Herd Signal",tp_lawOfFew:"Law of Few",k_cognitiveEase:"Name Ease",oc_volumeSol5m:"Volume SOL (5m)",so_hasTwitter:"Has Twitter",ch_healthScore:"Chart Health",ch_pumpDump:"Pump & Dump",rg_devSellSpeed:"Dev Sell Speed",rg_mcapDropRate:"MC Drop Rate",rg_buyerRetention:"Buyer Retention",k_anchoring:"Anchoring Bias",k_availability:"Availability Heuristic",k_lossAversion:"Loss Aversion (2x)",k_peakEnd:"Peak-End Rule",k_prospectTheory:"Prospect Theory",gl_thinSlice:"Thin-Slice (30s)",gl_outlier:"Outlier Detection",gl_10kMaturity:"Pattern Maturity",gl_accumAdvantage:"Early Mover Cluster",tp_context:"Power of Context",cs_cascadeOnset:"Cascade Onset",cs_cascadeStrength:"Cascade Strength",cs_reflexivity:"Reflexivity Loop",cs_curveVelocity:"Curve Velocity",cs_attentionShare:"Attention Share",sir_r0:"Viral R0",sir_infectRate:"Infection Rate",sir_recoveryRate:"Recovery Rate",gf_curveProgress:"Curve Progress",gf_frontrunSignal:"Grad Frontrun",apd_attentionGrowth:"Attention Growth",apd_priceFlat:"Price Flat",apd_divergence:"Attn-Price Diverge"};return<div key={f.feature} style={{display:"flex",alignItems:"center",gap:6}}>
<span style={{fontSize:7,color:T.dm,minWidth:90,textAlign:"right"}}>{featureNames[f.feature]||f.feature}</span>
<div style={{flex:1,height:6,borderRadius:3,background:T.bg,overflow:"hidden"}}><div style={{width:pct+"%",height:"100%",borderRadius:3,background:`linear-gradient(90deg,${T.pu},${T.gn})`,transition:"width 1s"}}/></div>
<span style={{fontSize:7,color:T.tx,fontWeight:700,minWidth:25}}>{f.weight}</span>
</div>})}
</div>
{/* Scoring distribution */}
{intelData.recentEvents?.length>0&&<div style={{marginTop:10,borderTop:"1px solid "+T.bd,paddingTop:8}}>
<div style={{fontSize:8,fontWeight:700,color:T.dm,marginBottom:6}}>Score Distribution</div>
<div style={{display:"flex",alignItems:"flex-end",gap:1,height:40}}>
{[0,10,20,30,40,50,60,70,80,90].map(bucket=>{const count=intelData.recentEvents.filter(e=>e.data?.score>=bucket&&e.data?.score<bucket+10).length;const h=count>0?Math.max(4,Math.round((count/Math.max(1,intelData.recentEvents.length))*40)):0;return<div key={bucket} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
<div style={{width:"100%",height:h,borderRadius:2,background:bucket>=50?T.gn+"66":bucket>=25?T.yl+"66":T.ft+"44"}}/>
<span style={{fontSize:5,color:T.ft}}>{bucket}</span>
</div>})}
</div></div>}
</div>}
</div>}

{/* Auto-Ape — Don Norman redesign: defaults that work, details on demand */}
{user?.pubkey&&!user.demo&&trW&&(()=>{
const aaOpen=autoTrade?.open||autoTrade?.active;
const aaActive=autoTrade?.active;
// autoSettings is defined at component level (shared with intel trade panel)
const S=autoTrade?.settings||{solPerTrade:0.1,...autoSettings(0.1)};
const computed=autoSettings(S.solPerTrade);
// Use computed values unless user has customized via advanced
const eff=aaAdvanced?S:{...computed,solPerTrade:S.solPerTrade,...(autoTrade?.customized?S:{})};
const adj=(k,step,mn,mx)=>{const cur=S[k]??0;const nv=Math.max(mn,Math.min(mx,+(cur+step).toFixed(4)));sAutoTrade(p=>({...p,customized:true,settings:{...p.settings,[k]:nv}}))};
const StepBtn=({k,step,mn,mx,c,fmt})=>{const v=S[k]??0;return<div style={{display:"flex",alignItems:"center",gap:0,background:T.bg,borderRadius:6,overflow:"hidden",border:"1px solid "+(c||T.bd)+"22",width:"100%",boxSizing:"border-box"}}>
<button onClick={()=>adj(k,-Math.abs(step),mn,mx)} style={{padding:mb?"8px 8px":"6px 10px",background:"none",border:"none",color:c||T.ft,fontSize:mb?16:14,fontWeight:800,cursor:"pointer",lineHeight:1,flexShrink:0}}>-</button>
<div style={{flex:1,textAlign:"center",fontSize:mb?13:13,fontWeight:800,color:c||T.tx,padding:"4px 0",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fmt?fmt(v):v}</div>
<button onClick={()=>adj(k,Math.abs(step),mn,mx)} style={{padding:mb?"8px 8px":"6px 10px",background:"none",border:"none",color:c||T.ft,fontSize:mb?16:14,fontWeight:800,cursor:"pointer",lineHeight:1,flexShrink:0}}>+</button>
</div>};
/* Presets for bet size */
const presets=[{l:"Scout",sol:0.1,desc:"Low risk"},{l:"Standard",sol:0.25,desc:"Moderate"},{l:"Full Send",sol:0.5,desc:"Higher risk"}];
const isCustomBet=!presets.some(p=>Math.abs(S.solPerTrade-p.sol)<0.005);
const settingsChanged=autoTrade?.customized||false;
const maxLoss=(eff.solPerTrade*(eff.sl2/100)*eff.maxPositions);
const maxExposure=(eff.maxPositions*eff.solPerTrade);
return<div style={{background:T.sf,border:"1px solid "+(aaActive?T.gn:T.bd),borderRadius:10,padding:mb?8:12,marginTop:6,overflow:"hidden",width:"100%",maxWidth:"100%",boxSizing:"border-box"}}>
{/* Header — single row: title + primary action */}
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:4}}>
<div style={{display:"flex",alignItems:"center",gap:6}}>
<IC.trend s={16} c={aaActive?T.gn:T.ft}/>
<span style={{fontSize:15,fontWeight:800}}>Auto-Ape</span>
{aaActive&&<span style={{width:6,height:6,borderRadius:"50%",background:T.gn,animation:"gp 2s infinite"}}/>}
{aaActive&&<span style={{fontSize:9,color:T.gn,fontWeight:700}}>{autoTrade?.positions?.length||0} open</span>}
</div>
<div style={{display:"flex",gap:4}}>
{/* Primary action: START or PAUSE — one button, clear state */}
{!aaActive?<button onClick={async()=>{if(!aaOpen){sAutoTrade(p=>({...p,open:true,settings:{...eff,solPerTrade:S.solPerTrade}}));return}try{const r=await a.ats(user.pubkey,eff);sAutoTrade({open:true,active:true,settings:r.settings,positions:[],log:[]});toast("Auto-ape started","success")}catch(e){toast(e.message,"error")}}} style={{padding:mb?"8px 20px":"7px 18px",borderRadius:6,border:"none",background:aaOpen?"linear-gradient(135deg,#00c853,#00e676)":T.gn,color:"#000",fontWeight:900,fontSize:mb?14:13,cursor:"pointer"}}>{aaOpen?"START":"OPEN"}</button>
:<button onClick={async()=>{try{await a.atp(user.pubkey);sAutoTrade(p=>({...p,active:false,open:true}));toast("Paused","success")}catch(e){toast(e.message,"error")}}} style={{padding:mb?"8px 16px":"7px 14px",borderRadius:6,border:"none",background:T.yl,color:"#000",fontWeight:900,fontSize:mb?14:13,cursor:"pointer"}}>PAUSE</button>}
{/* CLOSE ALL — destructive, separated visually */}
{aaActive&&<button onClick={async()=>{if(!confirm("Sell ALL and stop?"))return;try{const r=await a.atc(user.pubkey);sAutoTrade({open:true,active:false,settings:S,positions:[],log:[]});toast(`Closed ${r.closed||0}`,"success")}catch(e){toast(e.message,"error")}}} style={{padding:mb?"8px 10px":"7px 10px",borderRadius:6,border:"1px solid "+T.rd+"44",background:T.rd+"18",color:T.rd,fontWeight:800,fontSize:mb?11:10,cursor:"pointer"}}>EXIT ALL</button>}
{aaOpen&&!aaActive&&<button onClick={()=>sAutoTrade(p=>({...p,open:false}))} style={{padding:"7px 8px",borderRadius:6,border:"1px solid "+T.bd,background:"none",color:T.ft,fontWeight:800,fontSize:11,cursor:"pointer"}}>×</button>}
</div>
</div>

{/* Collapsed state: one-line summary */}
{!aaOpen&&<div style={{fontSize:11,color:T.dm,marginTop:4}}>Set your bet size. Bot handles entries, exits, and sizing automatically.</div>}

{/* Expanded: simple mode */}
{aaOpen&&<div style={{display:"grid",gridTemplateColumns:mb?"1fr":"1fr 1fr",gap:8,marginTop:8}}>
<div>{/* LEFT: Config */}

{/* Bet size — presets + custom input */}
<div style={{fontSize:10,fontWeight:700,color:T.dm,marginBottom:4}}>Bet Size (SOL per trade)</div>
<div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap"}}>
{presets.map(p=>{const active=Math.abs(S.solPerTrade-p.sol)<0.005;return<button key={p.sol} onClick={()=>{sAutoTrade(prev=>({...prev,customized:false,settings:{...autoSettings(p.sol),solPerTrade:p.sol}}))}} style={{flex:1,minWidth:60,padding:mb?"10px 0":"8px 0",background:active?"linear-gradient(135deg,"+T.gn+"22,"+T.gn+"08)":T.bg,border:"2px solid "+(active?T.gn:T.bd),borderRadius:8,cursor:"pointer",textAlign:"center"}}>
<div style={{fontSize:mb?16:14,fontWeight:900,color:active?T.gn:T.tx}}>{p.sol}</div>
<div style={{fontSize:mb?9:8,color:active?T.gn:T.ft,fontWeight:700}}>{p.l}</div>
</button>})}
{/* Custom input */}
<div style={{flex:1,minWidth:60,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:isCustomBet?"linear-gradient(135deg,"+T.gn+"22,"+T.gn+"08)":T.bg,border:"2px solid "+(isCustomBet?T.gn:T.bd),borderRadius:8,padding:"4px 0"}}>
<input type="number" step="0.01" min="0.01" max="10" value={isCustomBet?S.solPerTrade:""} placeholder="Custom" onChange={e=>{const v=parseFloat(e.target.value);if(v>0&&v<=10){sAutoTrade(prev=>({...prev,customized:false,settings:{...autoSettings(v),solPerTrade:v}}))}}} style={{width:"90%",background:"none",border:"none",textAlign:"center",fontSize:mb?14:13,fontWeight:900,color:isCustomBet?T.gn:T.tx,outline:"none",padding:0}}/>
<div style={{fontSize:mb?9:8,color:isCustomBet?T.gn:T.ft,fontWeight:700}}>Custom</div>
</div>
</div>

{/* Strategy summary — what the bot WILL do */}
<div style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:8,padding:mb?8:10,marginBottom:8}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
<div style={{fontSize:9,fontWeight:700,color:T.dm}}>{aaAdvanced?"Custom Strategy":"Auto Strategy"}{aaAdvanced?" (you control)":""}</div>
{aaAdvanced&&<span style={{fontSize:7,fontWeight:700,color:T.yl,background:T.yl+"18",padding:"1px 5px",borderRadius:3}}>CUSTOM</span>}
</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
<div><div style={{fontSize:8,color:T.ft}}>Min Score</div><div style={{fontSize:14,fontWeight:900,color:T.pu}}>{eff.minScore}</div></div>
<div><div style={{fontSize:8,color:T.ft}}>Max Positions</div><div style={{fontSize:14,fontWeight:900,color:T.tx}}>{eff.maxPositions}</div></div>
<div><div style={{fontSize:8,color:T.ft}}>Max Exposure</div><div style={{fontSize:14,fontWeight:900,color:T.tx}}>{maxExposure.toFixed(2)}</div></div>
</div>
<div style={{display:"flex",gap:8,marginTop:6,paddingTop:6,borderTop:"1px solid "+T.bd+"44"}}>
<div style={{flex:1}}><div style={{fontSize:8,color:T.gn,fontWeight:700}}>Take Profit</div><div style={{fontSize:10,color:T.dm}}>+{eff.tp1}% → +{eff.tp2}% → +{eff.tp3}% runner</div></div>
<div style={{flex:1}}><div style={{fontSize:8,color:T.rd,fontWeight:700}}>Stop Loss</div><div style={{fontSize:10,color:T.dm}}>-{eff.sl1}% cut 60% → -{eff.sl2}% exit</div></div>
<div><div style={{fontSize:8,color:T.ft}}>Max Loss</div><div style={{fontSize:12,fontWeight:900,color:T.rd}}>{maxLoss.toFixed(2)}</div></div>
</div>
<div style={{display:"flex",gap:4,marginTop:6}}>
<span style={{fontSize:7,fontWeight:700,color:T.pu,background:T.pu+"12",padding:"2px 5px",borderRadius:3}}>MOMENTUM EXIT</span>
<span style={{fontSize:7,fontWeight:700,color:T.cy,background:T.cy+"12",padding:"2px 5px",borderRadius:3}}>KELLY SIZING</span>
<span style={{fontSize:7,fontWeight:700,color:T.yl,background:T.yl+"12",padding:"2px 5px",borderRadius:3}}>DIP RE-ENTRY</span>
</div>
</div>

{/* Customize dropdown */}
<button onClick={()=>sAAAdvanced(!aaAdvanced)} style={{width:"100%",padding:"6px 10px",background:T.bg,border:"1px solid "+T.bd,borderRadius:6,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:aaAdvanced?6:0}}>
<span style={{fontSize:10,fontWeight:700,color:T.ft}}>Customize Strategy</span>
<span style={{fontSize:9,color:T.ft}}>{aaAdvanced?"▾":"▸"}</span>
</button>
{aaAdvanced&&<div style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:8,padding:8,marginBottom:6}}>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4,marginBottom:6}}>
{[{l:"Min Score",k:"minScore",st:5,mn:15,mx:90},{l:"SOL/Trade",k:"solPerTrade",st:0.01,mn:0.01,mx:10,fmt:v=>v.toFixed(2)},{l:"Max Pos",k:"maxPositions",st:1,mn:1,mx:15}].map(s=><div key={s.k} style={{textAlign:"center"}}><div style={{fontSize:8,color:T.ft,fontWeight:700,marginBottom:2}}>{s.l}</div><StepBtn k={s.k} step={s.st} mn={s.mn} mx={s.mx} fmt={s.fmt}/></div>)}
</div>
<div style={{fontSize:9,fontWeight:700,color:T.gn,marginBottom:4}}>Take Profit</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4,marginBottom:6}}>
{[{l:"TP1",k:"tp1",st:10,mn:10,mx:500},{l:"TP2",k:"tp2",st:10,mn:10,mx:500},{l:"TP3 Runner",k:"tp3",st:25,mn:10,mx:1000}].map(t=><div key={t.k} style={{textAlign:"center"}}><div style={{fontSize:7,color:T.gn,fontWeight:700,marginBottom:2}}>{t.l}</div><StepBtn k={t.k} step={t.st} mn={t.mn} mx={t.mx} c={T.gn} fmt={v=>"+"+v+"%"}/></div>)}
</div>
<div style={{fontSize:9,fontWeight:700,color:T.rd,marginBottom:4}}>Stop Loss</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:4,marginBottom:6}}>
{[{l:"SL1 Cut",k:"sl1",st:5,mn:5,mx:80},{l:"SL2 Exit",k:"sl2",st:5,mn:10,mx:90}].map(t=><div key={t.k} style={{textAlign:"center"}}><div style={{fontSize:7,color:T.rd,fontWeight:700,marginBottom:2}}>{t.l}</div><StepBtn k={t.k} step={t.st} mn={t.mn} mx={t.mx} c={T.rd} fmt={v=>"-"+v+"%"}/></div>)}
</div>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<span style={{fontSize:9,fontWeight:700,color:T.pu}}>Momentum Exit</span>
<button onClick={()=>sAutoTrade(p=>({...p,customized:true,settings:{...p.settings,momentumExit:!S.momentumExit}}))} style={{padding:"4px 10px",borderRadius:5,border:"1px solid "+(S.momentumExit?T.pu:T.bd),background:S.momentumExit?T.pu+"22":"none",color:S.momentumExit?T.pu:T.ft,fontWeight:800,fontSize:10,cursor:"pointer"}}>{S.momentumExit?"ON":"OFF"}</button>
</div>
</div>}

{/* APPLY STRATEGY — always visible when settings changed or when customized */}
{aaOpen&&(settingsChanged||aaAdvanced)&&<button onClick={async()=>{if(aaActive){try{await a.atu(user.pubkey,eff);sAutoTrade(p=>({...p,customized:false,log:[...(p?.log||[]),{msg:"Strategy applied",time:Date.now()}]}));toast("Strategy applied","success")}catch(e){toast(e.message,"error")}}else{sAutoTrade(p=>({...p,customized:false,settings:{...eff}}));toast("Strategy saved","success")}}} style={{width:"100%",padding:mb?"10px 0":"8px 0",borderRadius:6,border:"none",background:"linear-gradient(135deg,"+T.gn+","+T.gn+"cc)",color:"#000",fontWeight:900,fontSize:mb?14:12,cursor:"pointer",marginBottom:6}}>APPLY STRATEGY</button>}

{/* ═══ LIVE SIM MODE — mirrors auto-ape decisions in real-time, no real trades ═══ */}
{/* Available to ALL tiers. Auto-calibrates over time. Graduates to real trading after ~1hr. */}
{(()=>{const ls=liveSim;const simActive=ls?.active;const st=ls?.stats||{};const grad=ls?.graduation||{};const cal=ls?.calibration||{};
const simDurMin=ls?.simDuration?Math.round(ls.simDuration/60000):0;
const pnlColor=(st.totalPnlSol||0)>=0?T.gn:T.rd;
return<div style={{background:T.bg,borderRadius:6,border:"1px solid "+(simActive?T.cy:T.cy+"18"),marginBottom:8,overflow:"hidden"}}>
{/* ── Header: title + controls ── */}
<div style={{padding:mb?"8px 10px":"6px 10px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<div onClick={()=>sSimExpanded(!simExpanded)} style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",flex:1}}>
<IC.sim s={14} c={T.cy}/>
<span style={{fontSize:mb?12:10,fontWeight:800,color:T.cy}}>Sim Mode</span>
{simActive&&<span style={{width:5,height:5,borderRadius:"50%",background:T.cy,animation:"gp 2s infinite"}}/>}
{simActive&&!simExpanded&&<span style={{fontSize:mb?9:7,color:T.dm}}>{st.totalTrades||0} trades · {st.winRate||0}% win · {(st.totalPnlSol||0)>=0?"+":""}{st.totalPnlSol||0} SOL · {simDurMin}m</span>}
{simStarting&&<Sp s={10} c={T.cy}/>}
<span style={{fontSize:8,color:T.ft,marginLeft:2}}>{simExpanded?"▾":"▸"}</span>
</div>
<div style={{display:"flex",gap:3,alignItems:"center"}}>
{/* START SIM */}
{!simActive&&<button onClick={async()=>{sSimStarting(true);try{const r=await a.sims(user?.pubkey||"anon",S);sLiveSim({active:true,...r});if(!simExpanded)sSimExpanded(true);toast("Live sim started — watching radar","success")}catch(e){toast(e.message,"error")}finally{sSimStarting(false)}}} disabled={simStarting} style={{padding:mb?"5px 12px":"3px 10px",borderRadius:5,border:"none",background:T.cy,color:"#000",fontWeight:800,fontSize:mb?11:9,cursor:simStarting?"wait":"pointer",display:"flex",alignItems:"center",gap:3}}>{simStarting?<><Sp s={8} c="#000"/>Starting</>:<><IC.sim s={10} c="#000"/>Start Sim</>}</button>}
{/* BACKTEST */}
{!simActive&&<button onClick={async()=>{sSimRunning(true);try{const r=await a.simbt(S);sAutoTrade(p=>({...p,sim:r}));toast(`${r.totalTrades} backtested`,"success")}catch(e){toast(e.message,"error")}finally{sSimRunning(false)}}} disabled={simRunning} style={{padding:mb?"5px 10px":"3px 8px",borderRadius:5,border:"1px solid "+T.cy+"22",background:T.cy+"08",color:T.cy,fontWeight:800,fontSize:mb?10:8,cursor:simRunning?"wait":"pointer"}}>{simRunning?<Sp s={8} c={T.cy}/>:"Backtest"}</button>}
{/* EXIT SIM */}
{simActive&&<button onClick={async()=>{try{const r=await a.simx(user?.pubkey||"anon");sLiveSim(null);toast(`Sim ended — ${r.finalStats?.totalBuys||0} buys, ${r.finalStats?.roi||0}% ROI`,"success")}catch(e){toast(e.message,"error")}}} style={{padding:mb?"5px 12px":"3px 10px",borderRadius:5,border:"none",background:T.rd,color:"#fff",fontWeight:800,fontSize:mb?11:9,cursor:"pointer",display:"flex",alignItems:"center",gap:3}}><IC.stop s={8} c="#fff"/>Exit Sim</button>}
</div>
</div>
{simExpanded&&<>
{/* Status bar */}
<div style={{padding:"0 10px 6px",fontSize:mb?8:7,color:T.dm,lineHeight:1.4}}>
{simActive?<>Watching radar in real-time. Every decision auto-ape would make shows here — <span style={{color:T.cy,fontWeight:700}}>no real trades</span>. Auto-calibrates settings over time. {grad.ready&&<span style={{color:T.gn,fontWeight:700}}>Ready to graduate to live trading!</span>}</>
:<>Set your params then hit <span style={{color:T.cy,fontWeight:700}}>Start Sim</span> to watch live decisions, or <span style={{color:T.cy}}>Backtest</span> for a quick snapshot. Available to everyone — no wallet needed.</>}
</div>
{/* ── LIVE STATS (when sim is running) ── */}
{simActive&&<>
<div style={{padding:"0 10px 6px"}}>
{/* Primary stats row */}
<div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:3,marginBottom:6}}>
{[
{l:"TRADES",v:st.totalTrades||0,c:T.tx},
{l:"WIN RATE",v:(st.winRate||0)+"%",c:(st.winRate||0)>=50?T.gn:T.rd},
{l:"PnL",v:((st.totalPnlSol||0)>=0?"+":"")+(st.totalPnlSol||0)+" SOL",c:pnlColor},
{l:"ROI",v:((st.roi||0)>=0?"+":"")+(st.roi||0)+"%",c:pnlColor},
{l:"OPEN",v:ls?.positions?.length||0,c:T.cy},
{l:"TIME",v:simDurMin+"m",c:simDurMin>=60?T.gn:T.tx},
].map(s=><div key={s.l} style={{textAlign:"center",padding:"3px 2px",background:T.sf,borderRadius:4}}>
<div style={{fontSize:mb?11:10,fontWeight:900,color:s.c}}>{s.v}</div>
<div style={{fontSize:mb?6:5,color:T.ft,fontWeight:700}}>{s.l}</div>
</div>)}
</div>
{/* Best/worst trade */}
{(st.bestTrade||st.worstTrade)&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3,marginBottom:4}}>
{st.bestTrade&&<div style={{padding:"3px 6px",background:T.gn+"06",borderRadius:4,border:"1px solid "+T.gn+"18"}}>
<div style={{fontSize:mb?7:6,color:T.gn,fontWeight:700}}>BEST</div>
<div style={{fontSize:mb?10:9,fontWeight:800,color:T.gn}}>+{st.bestTrade.pnlSol} SOL</div>
<div style={{fontSize:mb?8:7,color:T.dm}}>{st.bestTrade.name} ({st.bestTrade.exitReason})</div>
</div>}
{st.worstTrade&&<div style={{padding:"3px 6px",background:T.rd+"06",borderRadius:4,border:"1px solid "+T.rd+"18"}}>
<div style={{fontSize:mb?7:6,color:T.rd,fontWeight:700}}>WORST</div>
<div style={{fontSize:mb?10:9,fontWeight:800,color:T.rd}}>{st.worstTrade.pnlSol} SOL</div>
<div style={{fontSize:mb?8:7,color:T.dm}}>{st.worstTrade.name} ({st.worstTrade.exitReason})</div>
</div>}
</div>}
{/* Auto-calibration status */}
<div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 6px",background:T.pu+"0a",borderRadius:4,border:"1px solid "+T.pu+"18",marginBottom:4}}>
<div style={{flex:1}}>
<div style={{fontSize:mb?8:7,fontWeight:700,color:T.pu}}>Auto-Calibration</div>
<div style={{fontSize:mb?7:6,color:T.dm}}>
{cal.totalPredictions>0?`${cal.accuracy}% accuracy over ${cal.totalPredictions} predictions`:"Collecting data..."}
{cal.adjustments?.scoreBias?` · Score bias: ${cal.adjustments.scoreBias>0?"+":""}${cal.adjustments.scoreBias}`:""}
{cal.adjustments?.tpBias?` · TP bias: ${cal.adjustments.tpBias>0?"+":""}${cal.adjustments.tpBias}%`:""}
{cal.adjustments?.slBias?` · SL bias: ${cal.adjustments.slBias>0?"+":""}${cal.adjustments.slBias}%`:""}
</div>
</div>
<div style={{fontSize:mb?12:10,fontWeight:900,color:cal.accuracy>=60?T.gn:cal.accuracy>=40?T.yl:T.rd}}>{cal.accuracy||0}%</div>
</div>
{/* Graduation readiness */}
<div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 6px",background:(grad.ready?T.gn:T.yl)+"0a",borderRadius:4,border:"1px solid "+(grad.ready?T.gn:T.yl)+"18",marginBottom:4}}>
<div style={{flex:1}}>
<div style={{fontSize:mb?8:7,fontWeight:700,color:grad.ready?T.gn:T.yl}}>Graduation {grad.ready?"Ready":"Progress"}</div>
<div style={{fontSize:mb?7:6,color:T.dm}}>{grad.ready?"Settings calibrated and tested. Graduate to use these settings for real trading (Pro+).":"Run sim for ~1hr with 20+ trades and >45% win rate to unlock graduation."}</div>
</div>
<div style={{textAlign:"center"}}>
<div style={{fontSize:mb?12:10,fontWeight:900,color:grad.confidence>=70?T.gn:grad.confidence>=40?T.yl:T.rd}}>{grad.confidence||0}%</div>
<div style={{fontSize:6,color:T.ft}}>CONFIDENCE</div>
</div>
</div>
{/* Graduate button */}
{grad.ready&&(user?.tier==="pro"||user?.whitelisted)&&<button onClick={async()=>{try{const r=await a.simg(user.pubkey);sLiveSim(null);sAutoTrade(p=>({...p,open:true,settings:r.graduatedSettings}));toast(`Graduated! ${r.simStats.trades} trades, ${r.simStats.winRate}% win rate. Settings applied to Auto-Ape.`,"success")}catch(e){toast(e.message,"error")}}} style={{width:"100%",padding:mb?"10px 0":"7px 0",borderRadius:6,border:"none",background:T.gn,color:"#000",fontWeight:800,fontSize:mb?13:11,cursor:"pointer",marginBottom:4}}>GRADUATE TO LIVE AUTO-APE</button>}
</div>
{/* ── LIVE DECISIONS FEED ── */}
<div style={{borderTop:"1px solid "+T.bd}}>
<div onClick={()=>sSimDetailOpen(!simDetailOpen)} style={{padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<span style={{fontSize:mb?9:8,fontWeight:700,color:T.cy}}>Live Decisions ({ls?.decisions?.length||0})</span>
<span style={{fontSize:8,color:T.ft}}>{simDetailOpen?"▾":"▸"}</span>
</div>
{simDetailOpen&&<div style={{padding:"0 10px 6px",maxHeight:mb?160:200,overflowY:"auto"}}>
{ls?.decisions?.length>0?ls.decisions.slice().reverse().slice(0,20).map((d,i)=>{
const isBuy=d.action==="BUY"||d.action?.includes("BUY");
const isSell=!isBuy;
const c=isBuy?T.gn:d.reason?.includes("TP")?T.gn:d.reason?.includes("SL")?T.rd:d.reason?.includes("crash")||d.reason?.includes("momentum")?T.or:T.rd;
const age=Math.round((Date.now()-d.time)/1000);
return<div key={i} style={{display:"flex",alignItems:"center",gap:4,padding:"3px 0",borderBottom:"1px solid "+T.bd+"22",fontSize:mb?9:8}}>
<span style={{width:mb?38:32,fontWeight:900,color:c,fontSize:mb?8:7,flexShrink:0}}>{isBuy?"BUY":"SELL"}</span>
<span style={{fontWeight:700,color:T.tx,flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{d.name||d.ca?.slice(0,8)}</span>
{d.score!=null&&<span style={{fontSize:mb?8:7,color:T.ft}}>s:{d.score}</span>}
{d.sizeMult!=null&&<span style={{fontSize:mb?8:7,color:T.ft}}>{d.sizeMult}x</span>}
{d.pnlPct!=null&&<span style={{fontWeight:800,color:parseFloat(d.pnlPct)>=0?T.gn:T.rd}}>{parseFloat(d.pnlPct)>=0?"+":""}{d.pnlPct}%</span>}
{d.reason&&<span style={{fontSize:mb?7:6,color:T.ft,flexShrink:0}}>{d.reason}</span>}
<span style={{fontSize:6,color:T.ft,flexShrink:0}}>{age}s</span>
</div>})
:<div style={{fontSize:mb?9:8,color:T.ft,textAlign:"center",padding:8}}>Waiting for first decision...</div>}
</div>}
</div>
{/* ── OPEN SIM POSITIONS ── */}
{ls?.positions?.length>0&&<div style={{borderTop:"1px solid "+T.bd,padding:"4px 10px 6px"}}>
<div style={{fontSize:mb?9:8,fontWeight:700,color:T.cy,marginBottom:4}}>Sim Positions ({ls.positions.length})</div>
{ls.positions.map(p=>{const pnlC=p.changePct>=0?T.gn:T.rd;return<div key={p.ca} style={{display:"flex",alignItems:"center",gap:4,padding:"3px 0",borderBottom:"1px solid "+T.bd+"22",fontSize:mb?9:8}}>
<span style={{fontWeight:700,color:T.tx,flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{p.name}</span>
<span style={{fontSize:mb?8:7,color:T.ft}}>s:{p.entryScore}</span>
<span style={{fontSize:mb?8:7,color:T.ft}}>{p.sizeMult}x</span>
<span style={{fontWeight:800,color:pnlC}}>{p.changePct>=0?"+":""}{p.changePct}%</span>
<span style={{fontSize:mb?7:6,color:T.ft}}>{p.age}m</span>
{p.tpHit>0&&<span style={{fontSize:6,fontWeight:800,color:T.gn,background:T.gn+"18",padding:"0 3px",borderRadius:2}}>TP{p.tpHit}</span>}
{p.isMoonbag&&<span style={{fontSize:6,fontWeight:800,color:T.yl,background:T.yl+"18",padding:"0 3px",borderRadius:2}}>MOON</span>}
</div>})}
</div>}
{/* ── RECENTLY CLOSED ── */}
{ls?.recentlyClosed?.length>0&&<div style={{borderTop:"1px solid "+T.bd,padding:"4px 10px 6px"}}>
<div style={{fontSize:mb?9:8,fontWeight:700,color:T.ft,marginBottom:4}}>Recently Closed</div>
{ls.recentlyClosed.slice(0,8).map((t,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:4,padding:"2px 0",borderBottom:"1px solid "+T.bd+"22",fontSize:mb?8:7}}>
<span style={{fontWeight:700,color:T.tx,flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.name}</span>
<span style={{fontWeight:800,color:t.pnlSol>=0?T.gn:T.rd}}>{t.pnlSol>=0?"+":""}{t.pnlSol} SOL</span>
<span style={{fontSize:mb?7:6,color:T.ft}}>{t.exitReason}</span>
</div>)}
</div>}
</>}
{/* ── BACKTEST RESULTS (one-shot, from old sim) ── */}
{!simActive&&autoTrade?.sim&&(()=>{const sim=autoTrade.sim;const pC=sim.totalPnlSol>=0?T.gn:T.rd;const kahC=sim.kahnemanScore>=0?T.gn:sim.kahnemanScore>=-10?T.yl:T.rd;return<div style={{borderTop:"1px solid "+T.bd,padding:"4px 10px 6px"}}>
<div style={{fontSize:mb?9:8,fontWeight:700,color:T.cy,marginBottom:4}}>Backtest Results</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:3,marginBottom:4}}>
{[{l:"TRADES",v:sim.totalTrades,c:T.tx},{l:"WIN RATE",v:sim.winRate+"%",c:sim.winRate>=50?T.gn:T.rd},{l:"PnL",v:(sim.totalPnlSol>=0?"+":"")+sim.totalPnlSol+" SOL",c:pC},{l:"Kahneman",v:(sim.kahnemanScore>=0?"+":"")+sim.kahnemanScore+"%",c:kahC}].map(s=><div key={s.l} style={{textAlign:"center",padding:"3px 2px",background:T.sf,borderRadius:4}}>
<div style={{fontSize:mb?11:10,fontWeight:900,color:s.c}}>{s.v}</div>
<div style={{fontSize:mb?6:5,color:T.ft,fontWeight:700}}>{s.l}</div>
</div>)}
</div>
{sim.trades?.length>0&&<div style={{maxHeight:mb?80:100,overflowY:"auto",fontSize:mb?8:7,color:T.dm}}>
{sim.trades.slice(0,10).map((t,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:4,padding:"2px 0",borderBottom:"1px solid "+T.bd+"22"}}>
<span style={{fontWeight:700,color:T.tx,flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.name}</span>
<span style={{fontSize:mb?8:7,color:T.ft}}>s:{t.score}</span>
<span style={{fontWeight:800,color:t.pnlSol>=0?T.gn:T.rd}}>{t.pnlSol>=0?"+":""}{t.pnlSol}</span>
<span style={{fontSize:mb?7:6,color:T.ft}}>{t.exitReason}</span>
</div>)}
</div>}
</div>})()}
{/* ── Sim guidelines (collapsible) ── */}
<div style={{borderTop:"1px solid "+T.bd}}>
<div onClick={()=>sSimGuideOpen(!simGuideOpen)} style={{padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<span style={{fontSize:mb?9:8,fontWeight:700,color:T.yl}}>How Sim Mode Works</span>
<span style={{fontSize:8,color:T.ft}}>{simGuideOpen?"▾":"▸"}</span>
</div>
{simGuideOpen&&<div style={{padding:"0 10px 8px",fontSize:mb?8:7,color:T.dm,lineHeight:1.6}}>
<div style={{marginBottom:4}}>
<span style={{fontWeight:800,color:T.yl}}>Live Sim (everyone):</span>
<div>1. Set your params (score threshold, SOL per trade, TP/SL levels)</div>
<div>2. Hit <span style={{color:T.cy,fontWeight:700}}>Start Sim</span> — watches radar in real-time</div>
<div>3. Every buy/sell decision auto-ape would make shows in the feed</div>
<div>4. Settings <span style={{color:T.pu,fontWeight:700}}>auto-calibrate</span> as trades complete</div>
<div>5. After ~1hr with good results, you can <span style={{color:T.gn,fontWeight:700}}>graduate</span> to real trading (Pro+)</div>
</div>
<div style={{marginBottom:4}}>
<span style={{fontWeight:800,color:T.yl}}>Reading the results:</span>
<div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"1px 6px",marginTop:2}}>
<span style={{color:T.gn}}>Win Rate {">"} 55%</span><span>Settings are profitable on average</span>
<span style={{color:T.pu}}>Calibration {">"} 60%</span><span>Auto-adjustments are improving accuracy</span>
<span style={{color:T.gn}}>Confidence {">"} 70%</span><span>Ready to graduate to live trading</span>
<span style={{color:T.rd}}>High SL exits</span><span>Raise min score or tighten entry criteria</span>
</div>
</div>
<div>
<span style={{fontWeight:800,color:T.yl}}>Sim vs Auto-Ape:</span>
<div><span style={{color:T.cy}}>Sim</span> = free, everyone, no real money, learns over time</div>
<div><span style={{color:T.gn}}>Auto-Ape</span> = Pro+, real trades, real P&L</div>
</div>
</div>}
</div>
</>}
</div>})()}

{/* ═══ RISK DASHBOARD — always visible below settings ═══ */}
<div style={{background:T.bg,borderRadius:6,padding:mb?6:6,border:"1px solid "+T.yl+"18",marginBottom:6}}>
<div style={{fontSize:mb?9:8,fontWeight:700,color:T.yl,marginBottom:4}}>Risk at a Glance</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:3}}>
<div style={{textAlign:"center",padding:"3px 2px"}}>
<div style={{fontSize:mb?12:10,fontWeight:900,color:T.rd}}>{(S.solPerTrade*(S.sl2/100)*S.maxPositions).toFixed(2)}</div>
<div style={{fontSize:mb?7:6,color:T.dm}}>Max Loss (SOL)</div>
</div>
<div style={{textAlign:"center",padding:"3px 2px"}}>
<div style={{fontSize:mb?12:10,fontWeight:900,color:T.gn}}>{(S.solPerTrade*(S.tp1/100)*S.maxPositions*(S.tp1Sell/100)).toFixed(2)}</div>
<div style={{fontSize:mb?7:6,color:T.dm}}>TP1 Take (SOL)</div>
</div>
<div style={{textAlign:"center",padding:"3px 2px"}}>
<div style={{fontSize:mb?12:10,fontWeight:900,color:T.tx}}>{(S.maxPositions*S.solPerTrade).toFixed(2)}</div>
<div style={{fontSize:mb?7:6,color:T.dm}}>Max Exposure</div>
</div>
</div>
{S.sl2>S.tp1&&<div style={{fontSize:mb?8:7,color:T.yl,marginTop:4,textAlign:"center"}}>SL2 ({S.sl2}%) {">"} TP1 ({S.tp1}%): Losses will feel {(S.sl2/S.tp1*2).toFixed(1)}x worse than gains (loss aversion)</div>}
</div>
{/* ═══ POSITION ANALYTICS — live score+price charts ═══ */}
<PositionAnalytics positions={autoTrade?.positions||[]} settings={S} T={T} mb={mb}/>
</div>{/* END LEFT */}

{/* RIGHT: Live Positions + Log + Chart Patterns */}
<div style={{display:"flex",flexDirection:"column",gap:6,minWidth:0,overflow:"hidden"}}>
{/* Live Positions */}
<div style={{background:T.bg,border:"1px solid "+(liveSim?.active?T.cy+"44":T.bd),borderRadius:8,padding:10,minHeight:mb?0:180}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
<div style={{display:"flex",alignItems:"center",gap:4}}>
<span style={{fontSize:12,fontWeight:800}}>Positions</span>
{(autoTrade?.positions?.length>0||liveSim?.positions?.length>0)&&<span style={{fontSize:10,fontWeight:800,color:liveSim?.active?T.cy:T.gn,background:(liveSim?.active?T.cy:T.gn)+"18",padding:"1px 6px",borderRadius:4}}>{(liveSim?.active?liveSim?.positions?.length:autoTrade?.positions?.length)||0}</span>}
{liveSim?.active&&<span style={{fontSize:8,fontWeight:700,color:T.cy,background:T.cy+"18",padding:"1px 4px",borderRadius:3}}>SIM</span>}
</div>
{aaActive&&<span style={{width:5,height:5,borderRadius:"50%",background:T.gn,animation:"gp 2s infinite"}}/>}
{liveSim?.active&&!aaActive&&<span style={{width:5,height:5,borderRadius:"50%",background:T.cy,animation:"gp 2s infinite"}}/>}
</div>
{(()=>{
const simActive=liveSim?.active&&!aaActive;
const openPos=simActive?(liveSim?.positions||[]):(autoTrade?.positions||[]);
const closedPos=simActive?(liveSim?.recentlyClosed||[]):(autoTrade?.recentlyClosed||[]);
const hasAny=openPos.length>0||closedPos.length>0;
return !hasAny?
<div style={{textAlign:"center",padding:mb?"12px 0":"24px 0",color:T.ft}}>
<div style={{fontSize:24,opacity:.2,marginBottom:4}}>◎</div>
<div style={{fontSize:11}}>{aaActive?"Scanning for entries...":liveSim?.active?"Sim scanning for entries...":"Start Auto-Ape to open positions"}</div>
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
{p.entrySol>0&&<span style={{fontSize:10,fontWeight:800,color:pnlColor}}>{pnlSol>=0?"+":""}{pnlSol.toFixed(2)} SOL</span>}
</div>
{!simActive&&<button title="Exit this position" onClick={async(e)=>{e.stopPropagation();if(!confirm(`Sell ${p.name} now?`))return;try{const r=await a.atx(user.pubkey,p.ca);toast(`Exited ${p.name} (${r.pnlPct>=0?"+":""}${r.pnlPct}%)`,"success")}catch(err){toast(err.message,"error")}}} style={{padding:mb?"6px 8px":"4px 6px",borderRadius:4,border:"1px solid "+T.rd+"44",background:T.rd+"18",color:T.rd,fontWeight:900,fontSize:mb?11:9,cursor:"pointer",lineHeight:1,flexShrink:0}}>EXIT</button>}
{simActive&&<span style={{fontSize:7,fontWeight:800,color:T.cy,background:T.cy+"18",padding:"2px 5px",borderRadius:3}}>SIM</span>}
</div>
{p.entrySol>0&&<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,padding:"3px 6px",background:pnlColor+"0a",borderRadius:4,border:"1px solid "+pnlColor+"18"}}>
<div style={{flex:1,display:"flex",justifyContent:"space-between",fontSize:9,color:T.ft}}>
<span>In: {p.entrySol.toFixed(2)}</span>
<span style={{color:T.tx,fontWeight:700}}>Now: {currentVal.toFixed(2)}</span>
<span style={{color:pnlColor,fontWeight:800}}>P&L: {pnlSol>=0?"+":""}{pnlSol.toFixed(2)}</span>
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
{closedPos.slice().reverse().map((p,ci)=>{
const pnlColor=(p.changePct||p.pnlSol||0)>=0?T.gn:T.rd;
const exitT=p.exitTime||p.time||Date.now();
const ago=Math.round((Date.now()-exitT)/60000);
return<div key={(p.ca||ci)+""+exitT} style={{padding:"5px 0",borderBottom:"1px solid "+T.bd+"22",opacity:.7}}>
<div style={{display:"flex",alignItems:"center",gap:4,marginBottom:2}}>
<span style={{fontSize:11,fontWeight:700,color:T.dm,flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{p.name}</span>
{p.changePct!=null&&<span style={{fontSize:12,fontWeight:900,color:pnlColor}}>{p.changePct>=0?"+":""}{p.changePct}%</span>}
<span style={{fontSize:9,fontWeight:800,color:pnlColor}}>{p.pnlSol>=0?"+":""}{p.pnlSol} SOL</span>
</div>
<div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
{p.entrySol&&<span style={{fontSize:8,color:T.ft}}>In: {p.entrySol?.toFixed(2)||"?"} SOL</span>}
{p.entryScore!=null&&<span style={{fontSize:8,color:T.ft}}>Score: {p.entryScore}{p.exitScore!=null?"→"+p.exitScore:""}</span>}
<span style={{fontSize:7,fontWeight:800,padding:"1px 4px",borderRadius:3,background:(pnlColor)+"18",color:pnlColor}}>{p.exitReason?.replace(/-/g," ").toUpperCase()||"CLOSED"}</span>
<span style={{fontSize:8,color:T.ft}}>{ago}m ago</span>
</div>
</div>})}
</>}
</>})()}
</div>

{/* Log */}
{(()=>{const logEntries=liveSim?.active?(liveSim?.log||[]):(autoTrade?.log||[]);return<div style={{background:T.bg,border:"1px solid "+(liveSim?.active?T.cy+"44":T.bd),borderRadius:8,padding:10}}>
<div style={{display:"flex",alignItems:"center",gap:4,marginBottom:4}}>
<span style={{fontSize:11,fontWeight:700,color:T.ft}}>Activity Log</span>
{liveSim?.active&&<span style={{fontSize:8,fontWeight:700,color:T.cy,background:T.cy+"18",padding:"1px 4px",borderRadius:3}}>SIM</span>}
</div>
{logEntries.length>0?
<div style={{maxHeight:mb?100:200,overflowY:"auto",fontSize:10,color:T.dm,lineHeight:1.6,fontFamily:M}}>
{logEntries.slice().reverse().map((l,i)=><div key={i} style={{padding:"1px 0",borderBottom:i<logEntries.length-1?"1px solid "+T.bd+"22":"none"}}>
<span style={{color:T.ft}}>{new Date(l.time).toLocaleTimeString()}</span>{" "}
<span style={{color:l.msg?.includes("BUY")||l.msg?.includes("APE")?T.gn:l.msg?.includes("SELL")||l.msg?.includes("EXIT")||l.msg?.includes("SL")?T.rd:l.msg?.includes("TP")?T.gn:l.msg?.includes("CALIBRATE")?T.pu:T.dm}}>{l.msg}</span>
</div>)}
</div>
:<div style={{fontSize:10,color:T.ft,textAlign:"center",padding:"8px 0"}}>{liveSim?.active?"Sim watching radar...":"No activity yet"}</div>}
</div>})()}

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
{[{k:"healthy_pump",l:"Healthy",c:T.gn},{k:"v_recovery",l:"Recovery",c:T.cy||"#0ef"},{k:"slow_grind",l:"Grind",c:T.pu},{k:"staircase",l:"Staircase",c:T.yl}].map(p=>{
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
{chartPatterns.recentCharts.filter(c=>!["pump_dump","flatline_spike","sniper_spike","smooth_grind_rug","rug"].includes(c.pattern)).slice(0,6).map((c,i)=>{
const pColor=c.pattern==="healthy_pump"?T.gn:c.pattern==="v_recovery"?(T.cy||"#0ef"):c.pattern==="staircase"?T.yl:T.pu;
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
<div style={{padding:10,background:T.bg,borderRadius:8,border:"1px solid "+T.gn+"18"}}>
<div style={{fontSize:13,fontWeight:800,color:T.gn,marginBottom:6}}>All Features Included</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:2}}>
{["ML scoring + radar","Click-to-ape tokens","Auto-Ape trading","Fleet multi-wallet","Feature weight insights","GPU earnings","Smart money signals","Referral revenue sharing"].map((f,i)=><div key={i} style={{fontSize:10,color:T.dm,padding:"2px 0"}}>• {f}</div>)}
</div>
{(user?.tier==="vip"||user?.whitelisted)&&<div style={{marginTop:6,padding:"4px 8px",background:T.yl+"12",borderRadius:4,display:"inline-flex",alignItems:"center",gap:4}}><IC.crown s={10} c={T.yl}/><span style={{fontSize:9,fontWeight:800,color:T.yl}}>VIP Member</span></div>}
</div>
</div>

{/* VIP/Admin Panel — VIP/Pro see referrals + export, Owner also sees platform stats */}
{user&&<div style={{background:T.sf,border:"1px solid "+T.yl+"18",borderRadius:10,padding:mb?8:12,marginTop:6}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}><IC.crown s={14} c={T.yl}/><span style={{fontSize:12,fontWeight:800,color:T.yl}}>{isOwner?"Admin Panel":"Referral Panel"}</span>{(user?.tier==="vip"||user?.whitelisted)&&<span style={{fontSize:8,fontWeight:800,color:T.yl,background:T.yl+"18",padding:"1px 5px",borderRadius:3}}>VIP</span>}</div>

{/* Quick actions row — owner gets platform stats + whitelist, everyone gets export */}
<div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:8}}>
{isOwner&&<button onClick={async()=>{try{const r=await fetch(API+"/api/admin/stats",{headers:{"x-admin-secret":"bondli_default"}});const d=await r.json();if(d.ok)toast(`Users: ${d.totalUsers} | Active: ${d.activeUsers} | Free: ${d.tiers?.free} Pro: ${d.tiers?.pro} VIP: ${d.tiers?.vip} | Sessions: ${d.activeSessions}`,"success");else toast(d.error||"Failed","error")}catch(e){toast(e.message,"error")}}} style={{padding:"6px 12px",background:T.yl+"08",border:"1px solid "+T.yl+"18",borderRadius:6,fontSize:9,fontWeight:700,color:T.yl,cursor:"pointer"}}>Platform Stats</button>}
{isOwner&&<button onClick={async()=>{try{const r=await fetch(API+"/api/sol-price");const d=await r.json();toast(`SOL: $${d.price?.toFixed(2)||"??"}`,"success")}catch(e){toast("Add /api/sol-price route","error")}}} style={{padding:"6px 12px",background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:6,fontSize:9,fontWeight:700,color:T.gn,cursor:"pointer"}}>SOL Price</button>}
{isOwner&&<button onClick={()=>{const w=prompt("Wallet address to whitelist as VIP:");if(!w||w.length<32)return;fetch(API+"/api/admin/whitelist",{method:"POST",headers:{"Content-Type":"application/json","x-admin-secret":"bondli_default"},body:JSON.stringify({wallet:w})}).then(r=>r.json()).then(d=>d.ok?toast(`${w.slice(0,8)}… → VIP`,"success"):toast(d.error||"Failed","error")).catch(e=>toast(e.message,"error"))}} style={{padding:"6px 12px",background:T.pu+"08",border:"1px solid "+T.pu+"18",borderRadius:6,fontSize:9,fontWeight:700,color:T.pu,cursor:"pointer"}}>Whitelist VIP</button>}
{isOwner&&<button disabled={demoLoading} onClick={async()=>{sDemoLoading(true);try{const r=await fetch(API+"/api/admin/demo-profits",{headers:{"x-admin-secret":"bondli_default"}});const d=await r.json();if(d.ok){sDemoProfits(d);sGpuDash(prev=>({...prev,registered:true,earnings:{...(prev?.earnings||{}),totalNOS:d.gpu?.totalEarnedNOS||0,pendingNOS:d.gpu?.treasuryCutNOS||0,totalJobsCompleted:d.gpu?.jobsCompleted||0},node:{...(prev?.node||{}),status:"online"}}));sGpuFleet(prev=>({...prev,totalNodes:d.gpu?.activeNodes||1,onlineNodes:d.gpu?.activeNodes||1,totalEarned:d.gpu?.totalEarnedNOS||0,nodes:prev?.nodes||[]}));toast(`Demo: ${d.platform.totalTrades} trades | +${d.platform.grossPnlSol?.toFixed(2)} SOL | ${d.gpu?.totalEarnedNOS?.toFixed(2)} NOS earned | ${d.platform.winRate}% WR`,"success")}else toast(d.error||"Failed","error")}catch(e){toast(e.message,"error")}sDemoLoading(false)}} style={{padding:"6px 12px",background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:6,fontSize:9,fontWeight:700,color:T.gn,cursor:demoLoading?"wait":"pointer",opacity:demoLoading?.5:1}}>{demoLoading?"Loading...":"Test Profits"}</button>}
<button onClick={async()=>{try{toast("Exporting session logs...","info");const r=await fetch(API+"/api/auto-trade/export-session?wallet="+(user?.pubkey||""));const d=await r.json();const blob=new Blob([JSON.stringify(d,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const el=document.createElement("a");el.href=url;el.download="bondli-session-"+Date.now()+".json";document.body.appendChild(el);el.click();document.body.removeChild(el);URL.revokeObjectURL(url);toast(`Exported: ${d.learner?.history?.length||0} trades, ${d.radarSnapshot?.length||0} radar tokens, scorer weights`,"success")}catch(e){toast(e.message,"error")}}} style={{padding:"6px 12px",background:T.cy+"08",border:"1px solid "+T.cy+"18",borderRadius:6,fontSize:9,fontWeight:700,color:T.cy,cursor:"pointer"}}>Export Session Logs</button>
<button onClick={async()=>{try{toast("Exporting intel API data...","info");const d=await a.xapi(user.pubkey);const blob=new Blob([JSON.stringify(d,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const el=document.createElement("a");el.href=url;el.download="bondli-api-export-"+Date.now()+".json";document.body.appendChild(el);el.click();document.body.removeChild(el);URL.revokeObjectURL(url);toast(`API Export: ${d.radar?.count||0} tokens, ${d.positions?.length||0} positions`,"success")}catch(e){toast(e.message,"error")}}} style={{padding:"6px 12px",background:T.yl+"08",border:"1px solid "+T.yl+"18",borderRadius:6,fontSize:9,fontWeight:700,color:T.yl,cursor:"pointer"}}>Export API</button>
</div>

{/* ── Demo Profits Panel (owner only) ── */}
{isOwner&&demoProfits&&<div style={{background:T.bg,border:"1px solid "+T.gn+"22",borderRadius:8,padding:10,marginBottom:8}}>
<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}><div style={{display:"flex",alignItems:"center",gap:6}}><IC.sol s={14} c={T.gn}/><span style={{fontSize:11,fontWeight:800,color:T.gn}}>Platform Profits</span><span style={{fontSize:9,color:T.dm}}>{demoProfits.period}</span></div><button onClick={()=>sDemoProfits(null)} style={{background:"none",border:"none",color:T.ft,fontSize:12,cursor:"pointer"}}>×</button></div>

{/* Revenue overview */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,marginBottom:8}}>
{[{l:"Revenue",v:(demoProfits.platform.totalRevenueSol||0).toFixed(3)+" SOL",c:T.gn},{l:"Volume",v:(demoProfits.platform.totalVolumeSol||0).toFixed(1)+" SOL",c:T.cy},{l:"Win Rate",v:demoProfits.platform.winRate+"%",c:T.yl},{l:"Trades",v:demoProfits.platform.totalTrades,c:T.pu}].map((s,i)=><div key={i} style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:6,padding:"6px 4px",textAlign:"center"}}><div style={{fontSize:13,fontWeight:900,color:s.c}}>{s.v}</div><div style={{fontSize:7,color:T.ft,textTransform:"uppercase"}}>{s.l}</div></div>)}
</div>

{/* Fee breakdown */}
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4,marginBottom:8}}>
{[{l:"Platform Fees",v:(demoProfits.platform.platformFeesSol||0).toFixed(3),c:T.gn},{l:"Network Fees",v:(demoProfits.platform.networkFeesSol||0).toFixed(3),c:T.cy},{l:"Net (after ref)",v:(demoProfits.platform.netRevenueSol||0).toFixed(3),c:T.yl}].map((s,i)=><div key={i} style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:5,padding:"5px 4px",textAlign:"center"}}><div style={{fontSize:12,fontWeight:800,color:s.c}}>{s.v}</div><div style={{fontSize:7,color:T.ft,textTransform:"uppercase"}}>{s.l}</div></div>)}
</div>

{/* GPU earnings */}
<div style={{background:T.sf,border:"1px solid "+T.bd,borderRadius:6,padding:"6px 8px",marginBottom:8}}>
<div style={{fontSize:9,fontWeight:700,color:T.pu,textTransform:"uppercase",marginBottom:4}}>GPU Earnings</div>
<div style={{display:"flex",gap:10,fontSize:10}}>
<span style={{color:T.dm}}>Earned: <b style={{color:T.gn}}>{(demoProfits.gpu.totalEarnedNOS||0).toFixed(1)} NOS</b></span>
<span style={{color:T.dm}}>Treasury: <b style={{color:T.yl}}>{(demoProfits.gpu.treasuryCutNOS||0).toFixed(1)} NOS</b></span>
<span style={{color:T.dm}}>Nodes: <b style={{color:T.cy}}>{demoProfits.gpu.activeNodes}</b></span>
<span style={{color:T.dm}}>Jobs: <b style={{color:T.pu}}>{demoProfits.gpu.jobsCompleted}</b></span>
</div>
</div>

{/* Top tokens */}
{demoProfits.topTokens?.length>0&&<div style={{marginBottom:8}}>
<div style={{fontSize:9,fontWeight:700,color:T.yl,textTransform:"uppercase",marginBottom:4}}>Top Trades</div>
<div style={{maxHeight:100,overflowY:"auto"}}>
{demoProfits.topTokens.map((t,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",fontSize:10,borderBottom:"1px solid "+T.bd+"33"}}>
<span style={{fontWeight:800,color:T.tx,minWidth:50}}>{t.name}</span>
<span style={{color:T.gn,fontWeight:700}}>{t.multiple}</span>
<span style={{color:T.dm}}>{t.entrySol}→{t.exitSol} SOL</span>
<span style={{flex:1}}/>
<span style={{color:T.gn,fontWeight:800}}>+{t.pnlSol} SOL</span>
</div>)}
</div>
</div>}

{/* Sessions */}
<div style={{fontSize:9,fontWeight:700,color:T.cy,textTransform:"uppercase",marginBottom:4}}>Sessions ({demoProfits.sessions?.length||0})</div>
<div style={{maxHeight:80,overflowY:"auto"}}>
{demoProfits.sessions?.map((s,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"2px 0",fontSize:9}}>
<span style={{color:T.dm,fontFamily:"monospace"}}>{s.id}</span>
<span style={{padding:"1px 4px",borderRadius:3,fontSize:7,fontWeight:700,background:s.status==="active"?T.gn+"18":s.status==="settled"?T.pu+"18":T.ft+"18",color:s.status==="active"?T.gn:s.status==="settled"?T.pu:T.ft}}>{s.status}</span>
<span style={{color:T.dm}}>{s.trades}t</span>
<span style={{color:T.gn}}>{s.wins}W</span>
<span style={{color:"#ff4444"}}>{s.losses}L</span>
<span style={{flex:1}}/>
<span style={{fontWeight:700,color:s.pnlSol>=0?T.gn:"#ff4444"}}>{s.pnlSol>=0?"+":""}{s.pnlSol.toFixed(3)}</span>
</div>)}
</div>

{/* Users */}
<div style={{display:"flex",gap:8,marginTop:6,padding:"4px 0",borderTop:"1px solid "+T.bd+"44",fontSize:9,color:T.dm}}>
<span>Users: <b style={{color:T.tx}}>{demoProfits.users.total}</b></span>
<span>Active 24h: <b style={{color:T.gn}}>{demoProfits.users.active24h}</b></span>
<span>VIP: <b style={{color:T.yl}}>{demoProfits.users.vip}</b></span>
<span>Referrals: <b style={{color:T.pu}}>{demoProfits.users.referrals}</b></span>
</div>
<div style={{textAlign:"center",marginTop:4,fontSize:8,color:T.ft}}>Demo data — {demoProfits.generated}</div>
</div>}

{/* ── Referral Dashboard (inline) ── */}
<div style={{borderTop:"1px solid "+T.bd,paddingTop:8}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}><IC.users s={14} c={T.yl}/><span style={{fontSize:11,fontWeight:800}}>Referrals</span><span style={{fontSize:10,color:T.dm}}>Earn SOL from your referrals' trades</span></div>

{/* Stats row */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,marginBottom:6}}>
{[{l:"Earned",v:fs(vipDash?.referralEarnings||0,4),c:T.gn},{l:"Pending",v:fs(vipDash?.referralPendingPayout||0,4),c:T.yl},{l:"Referrals",v:vipDash?.referralCount||0,c:T.pu},{l:"Active 7d",v:vipDash?.activeReferrals||0,c:T.cy}].map((s,i)=><div key={i} style={{background:T.bg,border:"1px solid "+T.bd,borderRadius:6,padding:"6px 4px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:900,color:s.c}}>{s.v}</div><div style={{fontSize:8,color:T.ft,textTransform:"uppercase"}}>{s.l}</div></div>)}
</div>

{/* Claim payout */}
{(vipDash?.referralPendingPayout||0)>=0.001&&<div style={{background:T.gn+"08",border:"1px solid "+T.gn+"22",borderRadius:6,padding:"6px 10px",marginBottom:6,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
<span style={{fontSize:11,fontWeight:700,color:T.gn}}>{fs(vipDash.referralPendingPayout,4)} SOL ready</span>
<button disabled={vipClaiming} onClick={async()=>{sVipClaiming(true);try{const r=await a.vcl(user.pubkey);if(r.ok){toast(`Claimed ${r.amount?.toFixed(2)} SOL!`,"success");sVipDash(d=>d?{...d,referralPendingPayout:0,referralTotalPaid:(d.referralTotalPaid||0)+r.amount}:d)}else toast(r.error||"Failed","error")}catch(e){toast(e.message,"error")}sVipClaiming(false)}} style={{padding:"4px 12px",background:T.gn,border:"none",borderRadius:5,fontSize:10,fontWeight:800,color:T.bg,cursor:vipClaiming?"wait":"pointer",opacity:vipClaiming?.5:1}}>{vipClaiming?"...":"Claim"}</button>
</div>}

{/* Referral link + custom code */}
<div style={{display:"flex",gap:3,marginBottom:6}}>
<div style={{flex:1,background:T.bg,border:"1px solid "+T.bd,borderRadius:5,padding:"5px 8px",fontSize:10,color:T.gn,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{window.location.origin+"?ref="+(vipDash?.customCode||vipDash?.referralCode||"...")}</div>
<button onClick={()=>{navigator.clipboard?.writeText(window.location.origin+"?ref="+(vipDash?.customCode||vipDash?.referralCode||""));toast("Referral link copied!","success")}} style={{padding:"5px 10px",background:T.gn+"08",border:"1px solid "+T.gn+"22",borderRadius:5,fontSize:9,fontWeight:700,color:T.gn,cursor:"pointer",whiteSpace:"nowrap"}}>Copy Link</button>
</div>
<div style={{display:"flex",gap:3,marginBottom:6}}>
<input value={vipCustomCode} onChange={e=>sVipCustomCode(e.target.value.replace(/[^a-zA-Z0-9_-]/g,"").slice(0,20))} placeholder={vipDash?.customCode||"custom-code"} style={{flex:1,padding:"5px 8px",background:T.bg,border:"1px solid "+T.bd,borderRadius:5,color:T.tx,fontSize:10,fontFamily:"monospace",outline:"none"}}/>
<button onClick={async()=>{if(!vipCustomCode.trim()){toast("Enter a code","error");return}try{const r=await a.vcrc(user.pubkey,vipCustomCode.trim());if(r.ok){toast(`Code set: ${r.code}`,"success");sVipCustomCode("");sVipDash(d=>d?{...d,customCode:r.code,referralCode:r.code}:d)}else toast(r.error||"Failed","error")}catch(e){toast(e.message,"error")}}} style={{padding:"5px 10px",background:T.yl+"08",border:"1px solid "+T.yl+"22",borderRadius:5,fontSize:9,fontWeight:700,color:T.yl,cursor:"pointer",whiteSpace:"nowrap"}}>Set Code</button>
</div>
{vipDash?.customCode&&<div style={{fontSize:9,color:T.dm,marginBottom:4}}>Code: <b style={{color:T.gn}}>{vipDash.customCode}</b></div>}

{/* Tier progress */}
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:3,marginBottom:6}}>
{[{n:"Standard",c:T.ft},{n:"Silver",c:"#c0c0c0"},{n:"Gold",c:T.yl},{n:"Diamond",c:"#00bcd4"}].map((t,i)=>{const active=(vipDash?.referralTier||"standard")===t.n.toLowerCase();return<div key={i} style={{padding:"4px 2px",background:active?t.c+"12":T.bg,border:"1px solid "+(active?t.c+"44":T.bd),borderRadius:4,textAlign:"center",fontSize:9,fontWeight:active?800:500,color:active?t.c:T.ft}}>{t.n}{active?" ✓":""}</div>})}
</div>

{/* Network stats */}
<div style={{display:"flex",gap:6,marginBottom:6}}>
<div style={{flex:1,fontSize:10,color:T.dm}}>Volume: <b style={{color:T.gn}}>{fs(vipDash?.totalReferralVolume||0,2)} SOL</b></div>
<div style={{flex:1,fontSize:10,color:T.dm}}>Profit: <b style={{color:(vipDash?.totalReferralProfit||0)>=0?T.gn:"#ff4444"}}>{fs(vipDash?.totalReferralProfit||0,2)} SOL</b></div>
</div>

{/* Referred users (compact) */}
{vipDash?.referredUsers?.length>0&&<div style={{maxHeight:150,overflowY:"auto",borderTop:"1px solid "+T.bd+"44",paddingTop:4,marginBottom:4}}>
{vipDash.referredUsers.map((u,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",fontSize:10}}>
<span style={{color:T.dm,fontFamily:"monospace"}}>{u.wallet}</span>
{u.tier==="vip"&&<span style={{padding:"0 4px",borderRadius:3,fontSize:8,fontWeight:700,background:T.yl+"18",color:T.yl}}>VIP</span>}
<span style={{flex:1}}/>
<span style={{color:T.gn,fontWeight:700}}>{fs(u.volume||0,2)}</span>
<span style={{color:(u.profit||0)>=0?T.gn:"#ff4444",fontWeight:600}}>{(u.profit||0)>=0?"+":""}{fs(u.profit||0,3)}</span>
</div>)}
</div>}

{/* Recent events (compact) */}
{vipDash?.recentEvents?.length>0&&<div style={{maxHeight:100,overflowY:"auto",borderTop:"1px solid "+T.bd+"44",paddingTop:4}}>
{vipDash.recentEvents.slice(0,10).map((ev,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:4,padding:"2px 0",fontSize:9}}>
<span style={{color:T.ft}}>{new Date(ev.time).toLocaleTimeString()}</span>
<span style={{color:T.dm}}>{ev.user}</span>
{ev.type==="commission"&&<span style={{color:T.gn,fontWeight:700}}>+{fs(ev.commission||0,4)} SOL</span>}
{ev.type==="signup"&&<span style={{color:T.pu,fontWeight:700}}>New!</span>}
</div>)}
</div>}
</div>
</div>}

</div></EB>}

{/* MEMETIC TAB — Memetic Physics Radar */}

</div></>}

{showKeys&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:10,animation:"fi .1s ease"}} onClick={()=>sShowKeys(false)}><div onClick={e=>e.stopPropagation()} style={{background:T.sf,border:"1px solid "+T.gn+"18",borderRadius:14,padding:18,maxWidth:440,width:"100%",maxHeight:"85vh",overflowY:"auto",animation:"si .15s ease"}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}><span style={{fontWeight:800,fontSize:16}}>Settings</span><button onClick={()=>sShowKeys(false)} style={{background:"none",border:"none",color:T.ft,fontSize:16,cursor:"pointer"}}>×</button></div>
{/* Primary trading wallet */}
{trW&&<div style={{marginBottom:10}}><div style={{fontSize:8,fontWeight:700,color:T.ft,textTransform:"uppercase",marginBottom:3}}>Trading Wallet</div><div onClick={()=>{navigator.clipboard?.writeText(trW);toast("Address copied (public key)","success")}} style={{padding:"7px 9px",background:T.bg,border:"1px solid "+T.bd,borderRadius:7,fontSize:10,color:T.gn,cursor:"pointer",wordBreak:"break-all",display:"flex",alignItems:"center",gap:4}}><IC.sol s={12}/>{trW}</div>{trK?.showExported&&<div style={{marginTop:5,padding:"8px 10px",background:T.bg,border:"1px solid "+T.yl+"33",borderRadius:7}}><div style={{fontSize:8,fontWeight:700,color:T.yl,marginBottom:4}}>YOUR PRIVATE KEY (tap to select & copy)</div><textarea readOnly value={trK.showExported} onClick={e=>{e.target.select();try{document.execCommand("copy");toast("Copied!","success")}catch{}}} style={{width:"100%",padding:"8px",background:T.sf,border:"1px solid "+T.bd,borderRadius:5,fontSize:11,color:T.tx,fontFamily:M,wordBreak:"break-all",resize:"none",minHeight:60,outline:"none",boxSizing:"border-box",WebkitUserSelect:"all",userSelect:"all"}}/><div style={{display:"flex",gap:3,marginTop:4}}><button onClick={()=>{try{navigator.clipboard?.writeText(trK.showExported);toast("Copied!","success")}catch{toast("Tap the key above to select & copy","info")}}} style={{flex:1,padding:"6px 0",background:T.gn+"08",border:"1px solid "+T.gn+"18",borderRadius:5,fontSize:10,fontWeight:700,color:T.gn,cursor:"pointer"}}>Copy</button><button onClick={()=>sTrK(k=>({...k,showExported:null}))} style={{flex:1,padding:"6px 0",background:T.rd+"08",border:"1px solid "+T.rd+"18",borderRadius:5,fontSize:10,fontWeight:700,color:T.rd,cursor:"pointer"}}>Hide</button></div></div>}<div style={{display:"flex",gap:3,marginTop:5}}><button onClick={async()=>{try{const r=await a.etw(user.pubkey);if(r.ok&&r.privateKey){if(mb){sTrK(k=>({...k,...r,showExported:r.privateKey}));toast("Key shown below — tap to copy","success")}else{try{await navigator.clipboard.writeText(r.privateKey);toast("Private key copied — clears 60s","success")}catch{sTrK(k=>({...k,...r,showExported:r.privateKey}));toast("Key shown below — tap to copy","success")}setTimeout(()=>{try{navigator.clipboard?.writeText("")}catch{}},60000)}}}catch(e){toast(e.message,"error")}}} style={{flex:1,padding:mb?"8px 0":"5px 0",background:T.yl+"08",border:"1px solid "+T.yl+"18",borderRadius:5,fontSize:mb?11:9,fontWeight:700,color:T.yl,cursor:"pointer"}}>Export Private Key</button><button onClick={async()=>{try{const r=await a.er(user.pubkey);toast(`${r.totalWallets||0} wallets | ${(r.totalSol||0).toFixed(2)} SOL`,"success")}catch(e){toast(e.message,"error")}}} style={{flex:1,padding:"5px 0",background:T.or+"08",border:"1px solid "+T.or+"18",borderRadius:5,fontSize:9,fontWeight:700,color:T.or,cursor:"pointer"}}>Emergency</button></div></div>}
{/* Import wallet */}
<div style={{marginBottom:10,padding:10,background:T.bg,border:"1px solid "+T.bd,borderRadius:8}}><div style={{fontSize:8,fontWeight:700,color:T.pu,textTransform:"uppercase",marginBottom:6}}>Import Wallet {user?.tier==="free"&&!user?.whitelisted?"(Pro/VIP)":""}</div><div style={{fontSize:8,color:T.dm,marginBottom:6}}>Bring your own aged wallets. Paste a Solana private key (base58).</div><div style={{display:"flex",gap:3}}><input placeholder="Private key (base58)" style={{flex:1,padding:"6px 8px",background:T.sf,border:"1px solid "+T.bd,borderRadius:5,fontSize:10,color:T.tx,fontFamily:M,outline:"none"}} onKeyDown={async e=>{if(e.key!=="Enter")return;const pk=e.target.value.trim();if(!pk)return;try{const r=await fetch(API+"/api/trading-wallet/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet:user.pubkey,privateKey:pk})});const d=await r.json();if(d.ok){toast(`Imported ${d.pubkey?.slice(0,8)}… (${d.balance?.toFixed(2)||0} SOL)`,"success");e.target.value="";if(d.primary&&!trW){sTrW(d.pubkey)}}else toast(d.error||"Failed","error")}catch(err){toast(err.message,"error")}}}/><button onClick={async()=>{const inp=document.querySelector("input[placeholder*='Private key']");const pk=inp?.value?.trim();if(!pk){toast("Paste a private key","error");return}try{const r=await fetch(API+"/api/trading-wallet/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet:user.pubkey,privateKey:pk})});const d=await r.json();if(d.ok){toast(`Imported ${d.pubkey?.slice(0,8)}… (${d.balance?.toFixed(2)||0} SOL)`,"success");inp.value="";if(d.primary&&!trW){sTrW(d.pubkey)}}else toast(d.error||"Failed","error")}catch(err){toast(err.message,"error")}}} style={{padding:"6px 12px",background:T.pu+"08",border:"1px solid "+T.pu+"18",borderRadius:5,fontSize:9,fontWeight:700,color:T.pu,cursor:"pointer",whiteSpace:"nowrap"}}>Import</button></div></div>
{/* SOL price */}
<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,fontSize:9,color:T.ft}}><IC.sol s={14}/> ${solP.toFixed(2)}</div>
</div></div>}

{mb&&!launched&&<div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:15,background:T.bg+"f6",backdropFilter:"blur(10px)",borderTop:"1px solid "+T.bd,paddingBottom:"max(2px,env(safe-area-inset-bottom,2px))"}}>
<div style={{display:"flex"}}>{[{id:"radar",l:"Radar",ic:IC.radar},{id:"wallet",l:"Wallet",ic:IC.wallet},{id:"deploy",l:"Deploy",ic:IC.deploy},{id:"intel",l:"Intel",ic:IC.sim},{id:"gpu",l:"GPU",ic:IC.nos},].map(t=>{const ac=tab===t.id;return<button key={t.id} onClick={()=>{sTab(t.id);sRExp(null);setTimeout(()=>document.getElementById("tc")?.scrollIntoView({behavior:"smooth",block:"start"}),30)}} style={{flex:1,padding:"8px 0 4px",background:"none",border:"none",display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"pointer"}}><t.ic s={20} c={ac?T.gn:T.ft}/><span style={{fontSize:11,fontWeight:ac?700:400,color:ac?T.gn:T.ft}}>{t.l}</span></button>})}</div>
<div style={{textAlign:"center",padding:"2px 0 4px",display:"flex",justifyContent:"center",gap:10}}><a href="https://x.com/Bondlifun" target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:3,color:T.dm,textDecoration:"none",fontSize:10}}><IC.tw s={10} c={T.dm}/>@Bondlifun</a><a href="https://github.com/Bradbuythedip/BONDLIv4" target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:3,color:T.dm,textDecoration:"none",fontSize:10}}><IC.gh s={10} c={T.dm}/>GitHub</a></div>
</div>}
{!mb&&<footer style={{padding:"8px 16px",borderTop:"1px solid "+T.bd,marginTop:12,display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,color:T.ft}}><span>BONDLI v4</span><div style={{display:"flex",gap:12,alignItems:"center"}}><a href="https://x.com/Bondlifun" target="_blank" rel="noopener" style={{display:"flex",alignItems:"center",gap:4,color:T.dm,textDecoration:"none",fontSize:13,fontWeight:700}}><IC.tw s={16} c={T.dm}/>@Bondlifun</a><a href="https://github.com/Bradbuythedip/BONDLIv4" target="_blank" rel="noopener" style={{display:"flex",alignItems:"center",gap:4,color:T.dm,textDecoration:"none",fontSize:13,fontWeight:700}}><IC.gh s={16} c={T.dm}/>GitHub</a></div><span>{launched?"ACTIVE":"IDLE"}</span></footer>}
</div></TC.Provider>}
