import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";

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
          if (
            id.includes("/node_modules/@nivo/") ||
            id.includes("/node_modules/d3-")
          ) {
            return "charts-vendor";
          }
          if (
            id.includes("/node_modules/react-leaflet/") ||
            id.includes("/node_modules/leaflet/")
          ) {
            return "maps-vendor";
          }
          if (
            id.includes("/node_modules/react-force-graph-2d/") ||
            id.includes("/node_modules/force-graph/")
          ) {
            return "graph-vendor";
          }
          if (
            id.includes("/node_modules/@radix-ui/") ||
            id.includes("/node_modules/cmdk/")
          ) {
            return "ui-vendor";
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
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      {
        find: /^leaflet$/,
        replacement: path.resolve(
          __dirname,
          "../../node_modules/leaflet/dist/leaflet-src.esm.js",
        ),
      },
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
