import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      { find: /^leaflet$/, replacement: path.resolve(__dirname, "../../node_modules/leaflet/dist/leaflet-src.esm.js") },
      { find: "lodash", replacement: "lodash-es" },
    ],
  },
  optimizeDeps: {
    include: [
      "prop-types",
      "leaflet",
      "@react-leaflet/core",
      "react-leaflet",
      "react-force-graph-2d",
    ],
    exclude: [
      "@nivo/core",
      "@nivo/bar",
      "@nivo/line",
      "@nivo/pie",
      "@nivo/radar",
      "@nivo/scatterplot",
    ],
  },
  server: {
    allowedHosts: [".crate.local", ".dev.lespedants.org"],
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
    proxy: {
      "/api": {
        target: process.env.API_URL || "http://localhost:8585",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
