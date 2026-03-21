import{createContext,useContext}from"react";
export const D={bg:"#1a1a1a",bg2:"#1e1e1e",sf:"#242424",sf2:"#2a2a2a",cd:"#202020",bd:"rgba(255,255,255,.08)",bl:"rgba(255,255,255,.10)",gn:"#d97706",gd:"#b45309",gg:"rgba(217,119,6,.04)",rd:"#ef4444",rg:"rgba(239,68,68,.04)",yl:"#eab308",or:"#f97316",bl2:"#60a5fa",pu:"#c084fc",cy:"#22d3ee",tx:"#e8e4e0",dm:"#9b958f",md:"#b0aaa4",ft:"#5c5650",gl:"none",mo:"dark"};
export const L={bg:"#2a2a2a",bg2:"#2e2e2e",sf:"#333333",sf2:"#383838",cd:"#303030",bd:"rgba(255,255,255,.10)",bl:"rgba(255,255,255,.13)",gn:"#e5a00d",gd:"#c4850a",gg:"rgba(229,160,13,.05)",rd:"#f05252",rg:"rgba(240,82,82,.05)",yl:"#f0c420",or:"#fb923c",bl2:"#7ab8ff",pu:"#d4a0ff",cy:"#38e8f0",tx:"#f0ece8",dm:"#b0a99f",md:"#c0b8b0",ft:"#706860",gl:"none",mo:"light"};
export const TC=createContext(D);
export const uT=()=>useContext(TC);
export function css(T){return`
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent;scroll-behavior:smooth}
body{background:${T.bg};color:${T.tx};overflow-x:hidden;-webkit-font-smoothing:antialiased;overscroll-behavior:none}
input,button,textarea,select{font-family:inherit;-webkit-appearance:none}
::selection{background:${T.gn}22}
::-webkit-scrollbar{width:2px;height:2px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${T.bl};border-radius:4px}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes fu{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes fd{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
@keyframes si{from{opacity:0;transform:scale(.98)}to{opacity:1;transform:scale(1)}}
@keyframes sp{to{transform:rotate(360deg)}}
@keyframes gp{0%,100%{box-shadow:0 0 0 0 ${T.gn}33}70%{box-shadow:0 0 0 5px ${T.gn}00}}
@keyframes gl{0%,100%{box-shadow:0 0 12px #551bf922}50%{box-shadow:0 0 24px #551bf944}}
@keyframes pf{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes su{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes scan{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
@keyframes wireflow{0%{stroke-dashoffset:24}100%{stroke-dashoffset:0}}
@keyframes wirefb{0%{stroke-dashoffset:18}100%{stroke-dashoffset:0}}
input[type=range]{-webkit-appearance:none;height:3px;border-radius:2px;background:${T.bl};outline:none;margin:6px 0}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:${T.gn};cursor:pointer;box-shadow:0 0 4px ${T.gn}44;border:2px solid ${T.bg}}
input[type=range]::-webkit-slider-thumb:active{box-shadow:0 0 8px ${T.gn}66}
input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:${T.gn};cursor:pointer;border:2px solid ${T.bg}}
input[type=range]::-moz-range-track{height:3px;border-radius:2px;background:${T.bl}}
.st>*{animation:fu .3s ease both}.st>:nth-child(1){animation-delay:.02s}.st>:nth-child(2){animation-delay:.05s}.st>:nth-child(3){animation-delay:.08s}.st>:nth-child(4){animation-delay:.11s}.st>:nth-child(5){animation-delay:.14s}.st>:nth-child(6){animation-delay:.17s}
`;}
