export const hW=(p)=>{let h=0;for(let i=0;i<p.length;i++)h=((h<<5)-h+p.charCodeAt(i))|0;return Math.abs(h)};
const AJ=["Red","Blue","Neon","Dark","Fast","Wild","Cold","Hyper","Degen","Based","Chad","Sigma","Alpha","Giga","Turbo","Stealth","Quantum","Cosmic","Iron","Omega"];
const NN=["Pill","Ape","Frog","Bull","Wolf","Fox","Shark","Whale","Sniper","Bot","Node","Ghost","Flame","Wave","Storm","Byte","Pulse","Core","Flux","Edge"];
export const wN=(p)=>{const h=hW(p);return AJ[h%AJ.length]+NN[(h>>8)%NN.length]+(h%100)};
export const fm=(n)=>n==null||n<0?"—":n===0?"0":n>=1e6?(n/1e6).toFixed(1)+"M":n>=1e3?(n/1e3).toFixed(1)+"K":Math.round(n).toString();
export const fs=(n,d=4)=>n==null?"—":n.toFixed(d);
export const tp=(p,s=6,e=4)=>(!p||p.length<s+e+3)?p||"":p.slice(0,s)+"..."+p.slice(-e);
export function dbp(sol,ape){if(ape)return{dv:0,fe:.0,fl:+sol.toFixed(4),pc:0};let p,mn,mx;if(sol<.4){p=.6;mn=.05;mx=.2}else if(sol<1){p=.5;mn=.1;mx=.5}else if(sol<5){p=.4;mn=.3;mx=2}else if(sol<15){p=.25;mn=1;mx=4}else{p=.15;mn=2;mx=8}const d=Math.min(mx,Math.max(mn,sol*p));return{dv:+d.toFixed(4),fe:.02,fl:+Math.max(0,sol-d-.02).toFixed(4),pc:+((d/sol)*100).toFixed(1)}}
export const wc=(s)=>s<.3?1:s<.5?3:s<1?5:s<5?9:s<10?11:s<25?15:20;
export const hp=(pt=[15],ev)=>{try{if(navigator?.vibrate){navigator.vibrate(pt)}if(window.Telegram?.WebApp?.HapticFeedback){window.Telegram.WebApp.HapticFeedback.impactOccurred("medium")}}catch{}const el=ev?.currentTarget||ev?.target;if(el){el.style.transition="transform 80ms ease";el.style.transform="scale(0.92)";setTimeout(()=>{el.style.transform="scale(1)";setTimeout(()=>{el.style.transition="";el.style.transform=""},80)},80)}};
