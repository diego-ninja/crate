import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  plugins: [],
  test: {
    environment: "jsdom",
    globals: true,
    include: [
      "icons/**/*.test.tsx",
      "lib/**/*.test.ts",
      "primitives/**/*.test.tsx",
      "shadcn/**/*.test.tsx",
      "composites/**/*.test.tsx",
      "domain/**/*.test.{ts,tsx}",
      "tokens/**/*.test.ts",
    ],
    setupFiles: ["test-setup.ts"],
    coverage: {
      exclude: ["test-setup.ts", "**/*.test.{ts,tsx}"],
      thresholds: {
        lines: 50,
        branches: 40,
        functions: 50,
        statements: 50,
      },
    },
  },
  resolve: {
    alias: [
      {
        find: /^@crate\/ui\/(.+)$/,
        replacement: path.resolve(__dirname, "$1"),
      },
    ],
  },
});
