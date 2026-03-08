import{createContext,useContext}from"react";
export const D={bg:"#09090d",bg2:"#0d0d12",sf:"#111117",sf2:"#16161c",cd:"#131319",bd:"rgba(255,255,255,.06)",bl:"rgba(255,255,255,.1)",gn:"#00e676",gd:"#00c853",gg:"rgba(0,230,118,.03)",rd:"#ff1744",rg:"rgba(255,23,68,.03)",yl:"#ffd600",or:"#ff9100",bl2:"#448aff",pu:"#b388ff",cy:"#18ffff",tx:"#cccce0",dm:"#5c5c7a",md:"#8080a0",ft:"#3a3a50",gl:"none",mo:"dark"};
export const L={bg:"#f3f3f7",bg2:"#eaeaef",sf:"#fff",sf2:"#f0f0f5",cd:"#fff",bd:"rgba(0,0,0,.07)",bl:"rgba(0,0,0,.12)",gn:"#00a854",gd:"#008844",gg:"rgba(0,168,84,.03)",rd:"#d01030",rg:"rgba(208,16,48,.03)",yl:"#b89800",or:"#c07000",bl2:"#1155cc",pu:"#6633bb",cy:"#0088aa",tx:"#181828",dm:"#606078",md:"#505068",ft:"#9494b0",gl:"none",mo:"light"};
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
input[type=range]{-webkit-appearance:none;height:3px;border-radius:2px;background:${T.bl};outline:none;margin:6px 0}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:${T.gn};cursor:pointer;box-shadow:0 0 4px ${T.gn}44;border:2px solid ${T.bg}}
input[type=range]::-webkit-slider-thumb:active{box-shadow:0 0 8px ${T.gn}66}
input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:${T.gn};cursor:pointer;border:2px solid ${T.bg}}
input[type=range]::-moz-range-track{height:3px;border-radius:2px;background:${T.bl}}
.st>*{animation:fu .3s ease both}.st>:nth-child(1){animation-delay:.02s}.st>:nth-child(2){animation-delay:.05s}.st>:nth-child(3){animation-delay:.08s}.st>:nth-child(4){animation-delay:.11s}.st>:nth-child(5){animation-delay:.14s}.st>:nth-child(6){animation-delay:.17s}
`;}
