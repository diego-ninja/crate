import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const require = createRequire(import.meta.url);
const lodashEsRoot = path.dirname(require.resolve("lodash-es/package.json"));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (id.includes("/node_modules/@nivo/")) {
            return "stats-vendor";
          }
          if (id.includes("/node_modules/react-leaflet/") || id.includes("/node_modules/leaflet/")) {
            return "maps-vendor";
          }
          if (id.includes("/node_modules/@capacitor/")) {
            return "capacitor-vendor";
          }
          if (id.includes("/node_modules/qrcode/")) {
            return "qrcode-vendor";
          }
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/react-router/")
          ) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      lodash: lodashEsRoot,
    },
  },
  optimizeDeps: {
    include: ["@capacitor/browser"],
    exclude: ["@nivo/core", "@nivo/line"],
  },
  server: {
    allowedHosts: [".crate.local", ".dev.lespedants.org"],
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
    proxy: {
      "/api": {
        target: process.env.API_URL || "http://localhost:8585",
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
});
