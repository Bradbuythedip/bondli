import { createContext } from "react";
// A step lighter than it was, and warmer with it: the surfaces lift about 40%, the borders show, and
// the faint ink that carries every age, market cap and buyer count now clears 4.5:1 on a card instead
// of 2.2:1 — it was below the readable floor, which is why the page felt murky rather than calm.
// The three inks stay far enough apart (12.6 / 6.5 / 4.7 against a card) that the hierarchy still reads.
export const D = { bg: "#212020", sf: "#2c2b29", bd: "rgba(255,255,255,.13)", gn: "#5de88f", rd: "#f4605a", yl: "#f0c33c", tx: "#f4f1ed", dm: "#b5aea6", ft: "#9a938b" };
export const L = { bg: "#2e2d2b", sf: "#3a3937", bd: "rgba(255,255,255,.16)", gn: "#6dee9b", rd: "#f8756e", yl: "#f5cf55", tx: "#faf8f5", dm: "#c5bfb7", ft: "#a6a098" };
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
