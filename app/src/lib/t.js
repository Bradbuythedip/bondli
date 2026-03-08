import{createContext,useContext}from"react";
export const D={bg:"#0a0a0f",bg2:"#111118",sf:"#15151e",sf2:"#1c1c28",cd:"#181824",bd:"#22223a",bl:"#33334d",gn:"#00e676",gd:"#00c853",gg:"rgba(0,230,118,.05)",rd:"#ff1744",rg:"rgba(255,23,68,.05)",yl:"#ffd600",or:"#ff9100",bl2:"#448aff",pu:"#b388ff",cy:"#18ffff",tx:"#e6e6f0",dm:"#7878a0",md:"#9e9ec0",ft:"#484868",gl:"linear-gradient(rgba(0,230,118,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,230,118,.03) 1px,transparent 1px)",mo:"dark"};
export const L={bg:"#f4f4f8",bg2:"#eaeaf0",sf:"#fff",sf2:"#f0f0f6",cd:"#fff",bd:"#d6d6e4",bl:"#c0c0d2",gn:"#00b862",gd:"#009e54",gg:"rgba(0,184,98,.05)",rd:"#e01040",rg:"rgba(224,16,64,.05)",yl:"#c8a600",or:"#d07800",bl2:"#2266dd",pu:"#7744cc",cy:"#00aacc",tx:"#1a1a30",dm:"#6e6e8e",md:"#5a5a78",ft:"#9494b4",gl:"linear-gradient(rgba(0,184,98,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,184,98,.03) 1px,transparent 1px)",mo:"light"};
export const TC=createContext(D);
export const uT=()=>useContext(TC);
export function css(T){return`
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
body{background:${T.bg};color:${T.tx};overflow-x:hidden;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;overscroll-behavior:none}
input,button,textarea,select{font-family:inherit;-webkit-appearance:none}
::selection{background:${T.gn}33}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${T.bd};border-radius:8px}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes fu{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes fd{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
@keyframes si{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
@keyframes su{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes pu{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes sp{to{transform:rotate(360deg)}}
@keyframes pf{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes gl{0%,100%{box-shadow:0 0 24px #551bf944}50%{box-shadow:0 0 48px #551bf966}}
@keyframes gp{0%,100%{box-shadow:0 0 0 0 ${T.gn}44}70%{box-shadow:0 0 0 10px ${T.gn}00}}
@keyframes sh{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes rb{0%{transform:scale(1)}50%{transform:scale(.97)}100%{transform:scale(1)}}
input[type=range]{-webkit-appearance:none;height:6px;border-radius:3px;background:${T.bd};outline:none}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:${T.gn};cursor:pointer;box-shadow:0 0 8px ${T.gn}66;border:2px solid ${T.bg};transition:transform .15s}
input[type=range]::-webkit-slider-thumb:hover{transform:scale(1.2)}
input[type=range]::-webkit-slider-thumb:active{transform:scale(1.1);box-shadow:0 0 16px ${T.gn}88}
input[type=range]::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:${T.gn};cursor:pointer;border:2px solid ${T.bg}}
input[type=range]::-moz-range-track{height:6px;border-radius:3px;background:${T.bd}}
.st>*{animation:fu .4s ease both}.st>:nth-child(1){animation-delay:.04s}.st>:nth-child(2){animation-delay:.08s}.st>:nth-child(3){animation-delay:.12s}.st>:nth-child(4){animation-delay:.16s}.st>:nth-child(5){animation-delay:.2s}.st>:nth-child(6){animation-delay:.24s}.st>:nth-child(7){animation-delay:.28s}.st>:nth-child(8){animation-delay:.32s}
`;}
