import { createContext } from "react";
export const D = { bg: "#1a1a1a", sf: "#242424", bd: "rgba(255,255,255,.08)", gn: "#4ade80", rd: "#ef4444", yl: "#eab308", tx: "#e8e4e0", dm: "#9b958f", ft: "#5c5650" };
export const L = { bg: "#2a2a2a", sf: "#333333", bd: "rgba(255,255,255,.10)", gn: "#5eea94", rd: "#f05252", yl: "#f0c420", tx: "#f0ece8", dm: "#b0a99f", ft: "#706860" };
export const TC = createContext(D);
export function css(T) { return `
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
body{background:${T.bg};color:${T.tx};overflow-x:hidden;-webkit-font-smoothing:antialiased}
input,button{font-family:inherit;-webkit-appearance:none}
::-webkit-scrollbar{width:2px}::-webkit-scrollbar-thumb{background:${T.bd};border-radius:4px}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
@keyframes gp{0%,100%{box-shadow:0 0 0 0 ${T.gn}33}70%{box-shadow:0 0 0 5px ${T.gn}00}}
@keyframes fly{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-10px) rotate(-2deg)}}
`; }
