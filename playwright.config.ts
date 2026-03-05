/// <reference types="node" />
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "https://your-store.myshopify.com";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 120_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: process.env.HEADLESS !== "false",
  },
  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "desktop-safari",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "iphone-15",
      use: { ...devices["iPhone 15"] },
    },
  ],
});
