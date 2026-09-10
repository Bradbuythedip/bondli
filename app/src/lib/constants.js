export const API = "https://bondli-production.up.railway.app";
export const M = "'IBM Plex Mono','JetBrains Mono','Fira Code',monospace";
export const S = "'Nunito','DM Sans','Segoe UI',system-ui,sans-serif";
// Every token image goes through the backend proxy: IPFS gateways block browser hotlinks.
export const imgUrl = (u, mint) => u && u.startsWith("data:") ? u : (u || mint) ? API + "/api/img?url=" + encodeURIComponent(u || "") + (mint ? "&mint=" + mint : "") : "";
