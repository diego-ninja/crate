import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: [
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
