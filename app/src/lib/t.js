import{createContext,useContext}from"react";
export const D={bg:"#08080c",bg2:"#0e0e14",sf:"#111118",sf2:"#17171f",cd:"#141420",bd:"#1e1e30",bl:"#2a2a44",gn:"#00e676",gd:"#00c853",gg:"rgba(0,230,118,.04)",rd:"#ff1744",rg:"rgba(255,23,68,.04)",yl:"#ffd600",or:"#ff9100",bl2:"#448aff",pu:"#b388ff",cy:"#18ffff",tx:"#d8d8e8",dm:"#686888",md:"#8888a8",ft:"#404058",gl:"linear-gradient(rgba(0,230,118,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(0,230,118,.02) 1px,transparent 1px)",mo:"dark"};
export const L={bg:"#f2f2f6",bg2:"#e8e8ee",sf:"#fff",sf2:"#f0f0f5",cd:"#fff",bd:"#d0d0de",bl:"#bbbbd0",gn:"#00a854",gd:"#008844",gg:"rgba(0,168,84,.04)",rd:"#d01030",rg:"rgba(208,16,48,.04)",yl:"#b89800",or:"#c07000",bl2:"#1155cc",pu:"#6633bb",cy:"#0088aa",tx:"#181828",dm:"#606078",md:"#505068",ft:"#8888a0",gl:"linear-gradient(rgba(0,168,84,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,168,84,.03) 1px,transparent 1px)",mo:"light"};
export const TC=createContext(D);
export const uT=()=>useContext(TC);
export function css(T){return`
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent;scroll-behavior:smooth}
body{background:${T.bg};color:${T.tx};overflow-x:hidden;-webkit-font-smoothing:antialiased;overscroll-behavior:none}
input,button,textarea,select{font-family:inherit;-webkit-appearance:none}
::selection{background:${T.gn}22}
::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${T.bd};border-radius:4px}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes fu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes fd{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
@keyframes si{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
@keyframes sp{to{transform:rotate(360deg)}}
@keyframes gp{0%,100%{box-shadow:0 0 0 0 ${T.gn}33}70%{box-shadow:0 0 0 6px ${T.gn}00}}
@keyframes gl{0%,100%{box-shadow:0 0 16px #551bf933}50%{box-shadow:0 0 32px #551bf955}}
@keyframes pf{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes pu{0%,100%{opacity:1}50%{opacity:.35}}
input[type=range]{-webkit-appearance:none;height:4px;border-radius:2px;background:${T.bd};outline:none;margin:8px 0}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:${T.gn};cursor:pointer;box-shadow:0 0 6px ${T.gn}55;border:2px solid ${T.bg};transition:transform .12s}
input[type=range]::-webkit-slider-thumb:active{transform:scale(1.15);box-shadow:0 0 12px ${T.gn}77}
input[type=range]::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:${T.gn};cursor:pointer;border:2px solid ${T.bg}}
input[type=range]::-moz-range-track{height:4px;border-radius:2px;background:${T.bd}}
.hl{transition:transform .15s,box-shadow .15s}.hl:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,0,0,.25)}
.st>*{animation:fu .35s ease both}.st>:nth-child(1){animation-delay:.03s}.st>:nth-child(2){animation-delay:.06s}.st>:nth-child(3){animation-delay:.09s}.st>:nth-child(4){animation-delay:.12s}.st>:nth-child(5){animation-delay:.15s}.st>:nth-child(6){animation-delay:.18s}.st>:nth-child(7){animation-delay:.21s}.st>:nth-child(8){animation-delay:.24s}
`;}
