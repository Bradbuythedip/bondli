import { createContext } from "react";
// The frog with the coffee. Everything here is taken off that painting rather than invented: the
// ground is the warm oxblood he is sitting against, the cards lift out of it, the positive green is
// his skin, the negative is the dusky rose of his mouth, the warning is the light on the cup, and the
// text is the cream of the cup itself. Nothing is neon -- the painting has no saturated colour in it,
// and a trading screen that shouts is harder to read, not easier.
//
// Contrast is measured, not eyeballed. Against a card, the three inks sit at 10.6 / 6.2 / 4.6 and the
// three states at 7.1 (green) / 4.8 (red) / 7.4 (yellow), so every one of them clears 4.5:1 -- the
// faint ink that carries every age, market cap and buyer count included, which is the one that used
// to drift under the readable floor. Black on the green button is 12.0.
export const D = { bg: "#2a2022", sf: "#3d3133", bd: "rgba(255,255,255,.15)", gn: "#a8d07a", rd: "#e8867e", yl: "#e8c46a", tx: "#f4ece1", dm: "#c3b5a8", ft: "#a99a8d" };
// The same painting in a lighter room: the ground and cards lift, the colours lift with them so the
// ratios hold (7.0 / 5.1 / 7.3 for the states, 10.1 / 6.6 / 5.1 for the inks).
export const L = { bg: "#3a2e30", sf: "#483a3c", bd: "rgba(255,255,255,.18)", gn: "#b8dc8e", rd: "#f09c94", yl: "#f0d17e", tx: "#fdf7ee", dm: "#d4c8bb", ft: "#bcb0a3" };
// His shirt. Used where something needs to read as a third thing -- neither good nor bad, just other.
export const BLUE = "#6d93c8";
export const TC = createContext(D);
export function css(T) { return `
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
body{background:${T.bg};color:${T.tx};overflow-x:hidden;-webkit-font-smoothing:antialiased}
/* Jeff is the ground, not a card. The painting sits fixed behind the whole page, under a scrim in the
   ground colour so every surface keeps the contrast it was measured at; the cards are translucent and
   blurred so he shows through them. With no /fren.png the scrim alone is the painting's own colour. */
body::before{content:"";position:fixed;inset:0;z-index:-2;background:${T.bg} url(/fren.png) center 28%/cover no-repeat}
body::after{content:"";position:fixed;inset:0;z-index:-1;background:linear-gradient(180deg,${T.bg}d4 0%,${T.bg}ec 40%,${T.bg}f7 100%)}
.card{background:${T.sf}f5;backdrop-filter:blur(16px) saturate(1.05);-webkit-backdrop-filter:blur(16px) saturate(1.05)}
input,button{font-family:inherit;-webkit-appearance:none}
::-webkit-scrollbar{width:2px}::-webkit-scrollbar-thumb{background:${T.bd};border-radius:4px}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
@keyframes imgin{from{opacity:0;transform:scale(1.06)}to{opacity:1;transform:scale(1)}}
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
