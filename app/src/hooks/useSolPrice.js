import{useState,useEffect}from"react";
export function useSolPrice(){const[p,s]=useState(170);useEffect(()=>{const g=async()=>{try{const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");if(r.ok){const d=await r.json();if(d?.solana?.usd>0)s(d.solana.usd)}}catch{}};g();const i=setInterval(g,30000);return()=>clearInterval(i)},[]);return p}
