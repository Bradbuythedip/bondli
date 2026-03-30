import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": { target: "http://localhost:3001", changeOrigin: true }, "/ws": { target: "ws://localhost:3001", ws: true } } },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2020",
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          solana: ["@solana/web3.js"],
        },
      },
    },
  },
});
