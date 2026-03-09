import{API}from"./c.js";
class A{constructor(){this.w=null}sw(w){this.w=w}
async f(p,o={}){const h={"Content-Type":"application/json"};if(this.w){h["X-Wallet"]=this.w;h["x-wallet"]=this.w}const r=await fetch(API+p,{headers:h,...o,body:o.body?JSON.stringify(o.body):undefined});if(!r.ok){const e=await r.json().catch(()=>({error:r.statusText}));throw new Error(e.error||`API ${r.status}`)}return r.json()}
chk(w){return this.f(`/api/access/check?wallet=${w}`)}
afr(w){return this.f("/api/access/activate-free",{method:"POST",body:{wallet:w}})}
apr(w,t){return this.f("/api/access/activate-pro",{method:"POST",body:{wallet:w,txSig:t}})}
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
fr(s,w){return this.f("/api/session/force-recover",{method:"POST",body:{sessionId:s,wallet:w}})}
gtw(w){return this.f(`/api/trading-wallet/${w}`)}
ctw(w){return this.f("/api/trading-wallet/create",{method:"POST",body:{wallet:w}})}
etw(w){return this.f("/api/trading-wallet/export",{method:"POST",body:{wallet:w}})}
qb(w,c,s){return this.f("/api/quick-ape",{method:"POST",body:{wallet:w,ca:c,solAmount:s}})}
qs(w,c,p){return this.f("/api/quick-sell",{method:"POST",body:{wallet:w,ca:c,percent:p}})}
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
}
export const a=new A();export default a;use
