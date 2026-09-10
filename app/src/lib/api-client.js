import{API}from"./constants.js";
// Base58 for the signature bytes Phantom returns (no dependency needed for one encoder).
const B58="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(bytes){let x=0n;for(const b of bytes)x=x*256n+BigInt(b);let out="";while(x>0n){out=B58[Number(x%58n)]+out;x/=58n}for(const b of bytes){if(b===0)out="1"+out;else break}return out}
const TOK=w=>"bondli_auth_"+w;
class A{constructor(){this.w=null;this._signing=null}sw(w){this.w=w}
// Proof of ownership: sign a server nonce with Phantom once; the token lasts 7 days and is sent as
// Bearer on every call. Money routes refuse without it, so f() signs in on a 401 and retries once.
token(){try{return this.w?localStorage.getItem(TOK(this.w)):null}catch{return null}}
async signIn(){if(!this.w)throw new Error("connect wallet first");if(this._signing)return this._signing;this._signing=(async()=>{try{const p=window?.phantom?.solana||window?.solana;if(!p?.signMessage)throw new Error("wallet cannot sign");const c=await this.f("/api/auth/challenge",{method:"POST",body:{wallet:this.w},noauth:true});const s=await p.signMessage(new TextEncoder().encode(c.message),"utf8");const sig=b58(s.signature||s);const v=await this.f("/api/auth/verify",{method:"POST",body:{wallet:this.w,signature:sig},noauth:true});try{localStorage.setItem(TOK(this.w),v.token)}catch{}return v.token}finally{this._signing=null}})();return this._signing}
signOut(){try{if(this.w)localStorage.removeItem(TOK(this.w))}catch{}}
async f(p,o={}){const h={"Content-Type":"application/json"};if(this.w){h["X-Wallet"]=this.w;h["x-wallet"]=this.w;const t=this.token();if(t&&!o.noauth)h["Authorization"]="Bearer "+t}const r=await fetch(API+p,{headers:h,...o,body:o.body?JSON.stringify(o.body):undefined,signal:o.signal||AbortSignal.timeout(o.timeout||20000)});if(!r.ok){const e=await r.json().catch(()=>({error:r.statusText}));if(r.status===401&&e.auth_required&&!o.noauth&&!o._retried){await this.signIn();return this.f(p,{...o,_retried:true})}throw new Error(e.error||`API ${r.status}`)}return r.json()}
chk(w){return this.f(`/api/access/check?wallet=${w}`)}
afr(w){return this.f("/api/access/activate-free",{method:"POST",body:{wallet:w}})}
apr(w,t){return this.f("/api/access/activate-pro",{method:"POST",body:{wallet:w,txSig:t}})}
avp(w,t){return this.f("/api/access/activate-vip",{method:"POST",body:{wallet:w,txSig:t}})}
pri(){return this.f("/api/pricing")}
sc(d){return this.f("/api/session/create",{method:"POST",body:d})}
sb(s,w){return this.f(`/api/session/balance?sessionId=${s}&wallet=${w}`)}
sf(s,t,w){return this.f("/api/session/fund",{method:"POST",body:{sessionId:s,txSig:t,wallet:w}})}
sl(s,w){return this.f("/api/session/launch",{method:"POST",body:{sessionId:s,wallet:w}})}
sr(s,w){return this.f("/api/session/resume",{method:"POST",body:{sessionId:s,wallet:w}})}
ls(w){return this.f(`/api/sessions?wallet=${w}`)}
cs(w){return this.f("/api/sessions/clear",{method:"POST",body:{wallet:w}})}
ds(s,w){return this.f("/api/session/delete",{method:"POST",body:{sessionId:s,wallet:w}})}
ek(s,w){return this.f("/api/session/export-keys",{method:"POST",body:{sessionId:s,wallet:w}})}
ss(s,w){return this.f("/api/session/sell-sweep",{method:"POST",body:{sessionId:s,wallet:w}})}
fc(s,w,c,p){return this.f("/api/session/command",{method:"POST",body:{sessionId:s,wallet:w,command:c,params:p||{}}})}
fr(s,w){return this.f("/api/session/force-recover",{method:"POST",body:{sessionId:s,wallet:w}})}
gtw(w){return this.f(`/api/trading-wallet/${w}`)}
ctw(w){return this.f("/api/trading-wallet/create",{method:"POST",body:{wallet:w}})}
etw(w){return this.f("/api/trading-wallet/export",{method:"POST",body:{wallet:w}})}
qb(w,c,s,slip,tip){return this.f("/api/quick-ape",{method:"POST",timeout:15000,body:{wallet:w,ca:c,solAmount:s,...(slip!=null?{slippage:slip}:{}),...(tip!=null?{priorityFee:tip}:{})}})}
qs(w,c,p){return this.f("/api/quick-sell",{method:"POST",timeout:15000,body:{wallet:w,ca:c,percent:p}})}
sa(w){return this.f("/api/sell-all",{method:"POST",body:{wallet:w}})}
gp(w){return this.f(`/api/positions/${w}`)}
gfs(){return this.f("/api/fleet")}
gfw(c){return this.f(`/api/fleet/wallets/${c}`)}
cl(c,w){return this.f("/api/close",{method:"POST",body:{ca:c,wallet:w}})}
er(w){return this.f("/api/emergency-recover",{method:"POST",body:{wallet:w}})}
gr(){return this.f("/api/radar")}
grt(c){return this.f(`/api/radar/token/${c}`)}
se(q){return this.f(`/api/search?q=${encodeURIComponent(q)}`)}
an(c){return this.f(`/api/analyze/${c}`)}
gpr(c){return this.f(`/api/price/${c}`)}
gc(c){return this.f(`/api/chart/${c}`)}
bd(d){return this.f("/api/batch-deploy",{method:"POST",body:d})}
is(w){return this.f("/api/incinerator/scan",{method:"POST",body:{wallet:w}})}
ic(w){return this.f("/api/incinerator/close",{method:"POST",body:{wallet:w}})}
gu(w){return this.f(`/api/username/${w}`)}
su(w,u){return this.f("/api/username",{method:"POST",body:{wallet:w,username:u}})}
grf(w){return this.f(`/api/referral/${w}`)}
arf(w,c){return this.f("/api/referral/apply",{method:"POST",body:{wallet:w,refCode:c}})}
dr(d){return this.f("/api/dry-run",{method:"POST",body:d})}
gm(tf){return this.f(`/api/movers${tf?`?timeframe=${tf}`:""}`)}
gmt(c){return this.f(`/api/movers/token/${c}`)}
ats(w,s){return this.f("/api/auto-trade/start",{method:"POST",body:{wallet:w,settings:s}})}
atp(w){return this.f("/api/auto-trade/stop",{method:"POST",body:{wallet:w}})}
atc(w){return this.f("/api/auto-trade/close",{method:"POST",body:{wallet:w}})}
atx(w,c){return this.f("/api/auto-trade/exit-position",{method:"POST",body:{wallet:w,ca:c}})}
atu(w,s){return this.f("/api/auto-trade/update",{method:"POST",body:{wallet:w,settings:s}})}
atst(w){return this.f(`/api/auto-trade/status?wallet=${w}`)}
gcp(){return this.f("/api/chart-patterns")}
gcpr(l){return this.f(`/api/chart-patterns/recent?limit=${l||20}`)}
atsim(s){return this.f("/api/auto-trade/simulate",{method:"POST",body:{settings:s}})}
// Live sim endpoints (available to all tiers)
sims(w,s){return this.f("/api/sim/start",{method:"POST",body:{wallet:w,settings:s}})}
simx(w){return this.f("/api/sim/stop",{method:"POST",body:{wallet:w}})}
simst(w){return this.f(`/api/sim/status?wallet=${w}`)}
simu(w,s){return this.f("/api/sim/update",{method:"POST",body:{wallet:w,settings:s}})}
simg(w){return this.f("/api/sim/graduate",{method:"POST",body:{wallet:w}})}
simbt(s){return this.f("/api/sim/backtest",{method:"POST",body:{settings:s}})}
ges(){return this.f("/api/engine-state")}
// Auto-exit (manual ape position management)
aee(w,c,em,es,s){return this.f("/api/auto-exit/enable",{method:"POST",body:{wallet:w,ca:c,entryMcap:em,entrySol:es,settings:s}})}
aed(w,c){return this.f("/api/auto-exit/disable",{method:"POST",body:{wallet:w,ca:c}})}
aes(w){return this.f(`/api/auto-exit/status?wallet=${w}`)}
// VIP referral dashboard
vrd(w){return this.f(`/api/vip/referral-dashboard/${w}`)}
vcrc(w,c){return this.f("/api/vip/custom-ref-code",{method:"POST",body:{wallet:w,code:c}})}
vcl(w){return this.f("/api/vip/claim-referral",{method:"POST",body:{wallet:w}})}
xapi(w){return this.f(`/api/vip/export-api/${w}`,{timeout:30000})}
// GPU dashboard
gpd(w){return this.f(`/api/gpu/dashboard?wallet=${w}`)}
gpdr(w){return this.f("/api/gpu/deregister",{method:"POST",body:{wallet:w}})}
// BRAD cognitive engine
brt(w,e){return this.f("/api/brad/toggle",{method:"POST",body:{wallet:w,enabled:e}})}
brm(){return this.f("/api/brad/metrics")}
brs(){return this.f("/api/brad/status")}
brh(){return this.f("/api/brad/health")}
brmd(w){return this.f(`/api/brad/mind${w?"?wallet="+w:""}`,{timeout:15000})}
brtl(n){return this.f(`/api/brad/thought-log?limit=${n||20}`)}
brch(msgs,w){return this.f("/api/brad/chat",{method:"POST",timeout:30000,body:{messages:msgs,wallet:w,stream:false}})}
async brchStream(msgs,w,onToken){const r=await fetch(API+"/api/brad/chat",{method:"POST",headers:{"Content-Type":"application/json",...(this.w?{"X-Wallet":this.w}:{})},body:JSON.stringify({messages:msgs,wallet:w,stream:true})});if(!r.ok)throw new Error("Stream failed");const reader=r.body.getReader();const dec=new TextDecoder();let buf="";let full="";let jsonCarry="";while(true){const{done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const lines=buf.split(/\r?\n/);buf=lines.pop()||"";for(const line of lines){const trimmed=line.trim();if(!trimmed||!trimmed.startsWith("data: "))continue;const d=trimmed.slice(6).trim();if(!d||d==="[DONE]")continue;const jsonStr=jsonCarry?jsonCarry+d:d;jsonCarry="";try{const j=JSON.parse(jsonStr);if(j.token){full+=j.token;onToken(full)}if(j.error)throw new Error(j.error);if(j.done)return full}catch(e){if(e.message&&e.message.includes("JSON")){jsonCarry=jsonStr}else if(e.message)throw e}}}return full}
brps(){return this.f("/api/brad/paper/status")}
brpstart(b){return this.f("/api/brad/paper/start",{method:"POST",body:{bankroll:b||10}})}
brpstop(){return this.f("/api/brad/paper/stop",{method:"POST"})}
brcfg(){return this.f("/api/brad/config")}
brcfgu(u){return this.f("/api/brad/config",{method:"POST",body:u})}
// Chat support (Grok AI)
cht(msgs,w){return this.f("/api/chat",{method:"POST",timeout:30000,body:{messages:msgs,wallet:w}})}
chts(){return this.f("/api/chat/status")}
itk(pk){return this.f(`/api/trading-wallet/identify/${pk}`)}
fws(w,ca,wp,pct){return this.f("/api/fleet/wallet-sell",{method:"POST",timeout:15000,body:{wallet:w,ca,walletPubkey:wp,percent:pct}})}
fwb(ca){return this.f(`/api/fleet/balances/${ca}`)}
}
export const a=new A();export default a;
