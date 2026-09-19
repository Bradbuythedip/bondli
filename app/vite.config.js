import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

// Which build is in the browser. Without it there is no way to tell a fix that did not work from a
// fix that was never deployed, and four rounds went by unable to answer that question. Vercel sets
// VERCEL_GIT_COMMIT_SHA; a local build asks git; neither is fatal if absent.
const commit = (() => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "unknown"; }
})();

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_COMMIT__: JSON.stringify(commit),
    __BUILD_AT__: JSON.stringify(new Date().toISOString()),
  },
  server: { port: 5173, proxy: { "/api": { target: "http://localhost:3001", changeOrigin: true } } },
  build: { outDir: "dist", sourcemap: false, target: "es2020" },
});
