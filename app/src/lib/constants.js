export const API = "https://bondli-production.up.railway.app";
export const X_URL = "https://x.com/notafruitfly";
export const DISCORD_URL = "https://discord.gg/SHueKKXRkv";
// The house token. Holding one waives the performance fee; the server decides, this is only the label
// and the link. Set VITE_NOTAFLY_TOKEN once it is launched to turn the address into a link.
export const NOTAFLY_SYMBOL = "NOTAFLY";
export const NOTAFLY_TOKEN = import.meta.env?.VITE_NOTAFLY_TOKEN || "";
export const NOTAFLY_URL = NOTAFLY_TOKEN ? `https://www.ponsfamily.com/launchpad/${NOTAFLY_TOKEN}` : X_URL;
export const M = "'IBM Plex Mono','JetBrains Mono','Fira Code',monospace";
export const S = "'Nunito','DM Sans','Segoe UI',system-ui,sans-serif";
// Every token image goes through the backend proxy: IPFS gateways block browser hotlinks.
export const imgUrl = (u, mint) => u && u.startsWith("data:") ? u : (u || mint) ? API + "/api/img?url=" + encodeURIComponent(u || "") + (mint ? "&mint=" + mint : "") : "";
