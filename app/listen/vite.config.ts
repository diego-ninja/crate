import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";

import { translationDevPlugin } from "./src/i18n/dev/translation-dev-plugin";

const sentryUploadEnabled = Boolean(
  process.env.SENTRY_AUTH_TOKEN &&
    process.env.SENTRY_ORG &&
    process.env.SENTRY_PROJECT,
);
const sentryRelease =
  process.env.SENTRY_RELEASE ||
  (process.env.GITHUB_SHA ? `crate-${process.env.GITHUB_SHA}` : undefined);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    translationDevPlugin({
      catalogsDir: path.resolve(__dirname, "src/i18n/catalogs"),
    }),
    ...(sentryUploadEnabled
      ? [
          ...sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: { name: sentryRelease },
            sourcemaps: { filesToDeleteAfterUpload: "**/*.map" },
          }),
        ]
      : []),
  ],
  build: {
    sourcemap: sentryUploadEnabled,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (id.includes("/node_modules/@nivo/")) {
            return "stats-vendor";
          }
          if (
            id.includes("/node_modules/react-leaflet/") ||
            id.includes("/node_modules/leaflet/")
          ) {
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
    alias: [
      {
        find: /^lodash\/(.+)\.js$/,
        replacement: "lodash-es/$1.js",
      },
      {
        find: "@",
        replacement: path.resolve(__dirname, "./src"),
      },
    ],
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
      "/share": {
        target: process.env.API_URL || "http://localhost:8585",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
