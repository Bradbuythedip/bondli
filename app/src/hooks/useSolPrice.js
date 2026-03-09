import{useState,useEffect}from"react";
import{API}from"../lib/c.js";
export function useSolPrice(){const[p,s]=useState(140);useEffect(()=>{const g=async()=>{
try{const r=await fetch(API+"/api/sol-price");if(r.ok){const d=await r.json();if(d.price>0){s(d.price);return}}}catch{}
try{const r=await fetch("https://price.jup.ag/v6/price?ids=SOL");if(r.ok){const d=await r.json();if(d?.data?.SOL?.price>0){s(d.data.SOL.price);return}}}catch{}
};g();const i=setInterval(g,30000);return()=>clearInterval(i)},[]);return p}JS 
