const { defineConfig, devices } = require("@playwright/test");

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:8081";

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  webServer: {
    command: "node tests/e2e/serve-dist.mjs",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: [["list"]],
});
