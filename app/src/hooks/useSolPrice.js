import{useState,useEffect}from"react";
import{API}from"../lib/constants.js";
export function useSolPrice(){const[p,s]=useState(135);useEffect(()=>{const g=async()=>{
try{const r=await fetch(API+"/api/sol-price");if(r.ok){const d=await r.json();if(d.price>0)s(d.price)}}catch{}
};g();const i=setInterval(g,30000);return()=>clearInterval(i)},[]);return p}

// Fetch Jupiter spot price for any token mint
export function useTokenPrice(mint){const[p,s]=useState(null);useEffect(()=>{if(!mint)return;
const g=async()=>{try{const r=await fetch(API+"/api/spot/"+mint);if(r.ok){const d=await r.json();if(d.price>0)s(d.price)}}catch{}};
g();const i=setInterval(g,15000);return()=>clearInterval(i)},[mint]);return p}

// Fetch GeckoTerminal candles + analysis for a token mint
export function useCandles(mint,tf="5m"){const[d,s]=useState({candles:[],analysis:null});useEffect(()=>{if(!mint)return;
const g=async()=>{try{const r=await fetch(API+"/api/candles/"+mint+"?tf="+tf);if(r.ok){const j=await r.json();s(j)}}catch{}};
g();const i=setInterval(g,tf==="1m"?15000:30000);return()=>clearInterval(i)},[mint,tf]);return d}
