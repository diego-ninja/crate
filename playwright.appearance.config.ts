import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/appearance",
  outputDir: "./test-results/appearance",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/appearance", open: "never" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "node tests/appearance/harness/server.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
