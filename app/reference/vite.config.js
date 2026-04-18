import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  server: {
    allowedHosts: [
      ".crate.local",
      ".dev.lespedants.org",
      ".dev.cratemusic.app",
      ".cratemusic.app",
      "reference.dev.cratemusic.app",
      "reference.cratemusic.app",
    ],
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
  },
});
