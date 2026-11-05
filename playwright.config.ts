import { defineConfig } from "@playwright/test";
import { browserLaunchOptions } from "./tests/support/browser.ts";

const port = Number(process.env.PLAYWRIGHT_PORT || 5173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/browser",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  use: {
    baseURL,
    headless: true,
    launchOptions: browserLaunchOptions(),
    viewport: { width: 1440, height: 900 },
  },
  reporter: "list",
});
