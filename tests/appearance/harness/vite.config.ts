import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";

const harnessRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(harnessRoot, "../../..");

export default defineConfig({
  root: harnessRoot,
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "@crate/ui": path.resolve(workspaceRoot, "app/shared/ui"),
    },
  },
  server: {
    fs: { allow: [workspaceRoot] },
  },
});
