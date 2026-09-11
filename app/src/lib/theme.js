import { createContext } from "react";
// A step lighter than it was, and warmer with it: the surfaces lift about 40%, the borders show, and
// the faint ink that carries every age, market cap and buyer count now clears 4.5:1 on a card instead
// of 2.2:1 — it was below the readable floor, which is why the page felt murky rather than calm.
// The three inks stay far enough apart (12.6 / 6.5 / 4.7 against a card) that the hierarchy still reads.
// Another step up: the ground and the cards each lift about 20% again. The faint ink lifts with them
// so the quiet text still clears 4.5:1 on a card (measured 4.71) rather than drifting under it, and
// the three inks stay far apart (13.4 / 6.3 / 4.7) so the hierarchy survives the lighter ground.
export const D = { bg: "#262524", sf: "#343331", bd: "rgba(255,255,255,.15)", gn: "#5de88f", rd: "#f4605a", yl: "#f0c33c", tx: "#f6f3f0", dm: "#bdb6ae", ft: "#a49d95" };
export const L = { bg: "#363533", sf: "#424140", bd: "rgba(255,255,255,.18)", gn: "#6dee9b", rd: "#f8756e", yl: "#f5cf55", tx: "#fbf9f7", dm: "#ccc6be", ft: "#b0aaa2" };
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
@keyframes bootspin{to{transform:rotate(360deg)}}
@keyframes bootrise{0%{opacity:0;transform:translateY(10px) scale(.94)}100%{opacity:1;transform:translateY(0) scale(1)}}
@keyframes bootword{0%{opacity:0;transform:translateY(6px)}100%{opacity:.75;transform:translateY(0)}}
@keyframes bootout{to{opacity:0;visibility:hidden}}
@keyframes bootbar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
@media (prefers-reduced-motion: reduce){
  [data-boot]{animation:bootout .2s .2s forwards!important}
  [data-boot] *{animation:none!important}
}
`; }
