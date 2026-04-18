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
  server: {
    allowedHosts: [
      ".crate.local",
      ".dev.lespedants.org",
      ".dev.cratemusic.app",
      ".cratemusic.app",
      "docs.dev.cratemusic.app",
      "docs.cratemusic.app",
      "docs.dev.lespedants.org",
      "docs.lespedants.org",
    ],
    fs: {
      allow: [
        path.resolve(__dirname, "../.."),
      ],
    },
  },
});
