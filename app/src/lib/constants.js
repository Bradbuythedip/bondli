export const API = "https://bondli-production.up.railway.app";
export const X_URL = "https://x.com/notafruitfly";
export const DISCORD_URL = "https://discord.gg/SHueKKXRkv";
// The house token. Holding one waives the performance fee; the server decides, this is only the label
// and the link. $JEFF is an SPL mint on Solana -- the same wallet you sign in with holds it, so there
// is nothing extra to connect and it counts whichever chain you trade. Set VITE_JEFF_MINT once it is
// launched to turn the ticker into a link to its pump.fun page.
export const JEFF_SYMBOL = "JEFF";
export const JEFF_MINT = import.meta.env?.VITE_JEFF_MINT || "";
export const JEFF_URL = JEFF_MINT ? `https://pump.fun/coin/${JEFF_MINT}` : X_URL;
export const M = "'IBM Plex Mono','JetBrains Mono','Fira Code',monospace";
export const S = "'Nunito','DM Sans','Segoe UI',system-ui,sans-serif";
// Every token image goes through the backend proxy: IPFS gateways block browser hotlinks.
export const imgUrl = (u, mint) => u && u.startsWith("data:") ? u : (u || mint) ? API + "/api/img?url=" + encodeURIComponent(u || "") + (mint ? "&mint=" + mint : "") : "";
