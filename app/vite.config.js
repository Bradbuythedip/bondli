import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      // If any dynamic imports of backend packages slip through, don't fail the build
      external: (id) => {
        if (id.includes("@solana/web3.js")) return true;
        if (id.includes("@pump-fun/pump-sdk")) return true;
        if (id.includes("tweetnacl")) return true;
        return false;
      },
    },
  },
  resolve: {
    alias: {
      // Shim @solana/web3.js for frontend — in case it's dynamically imported
      // The actual functionality is handled server-side or via Phantom wallet
    },
  },
});
