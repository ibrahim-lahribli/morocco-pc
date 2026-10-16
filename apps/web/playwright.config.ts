import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for apps/web (S1: mobile-first at 360 px).
 *
 * The webServer runs `next start` (production server) on port 3210 — a build
 * must exist first (`npm run build`), which the CI job does explicitly so the
 * build gate is visible as its own step. Port 3210 avoids colliding with the
 * API default (3000) or other workspaces' dev servers.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: "http://localhost:3210",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile-360",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 360, height: 800 },
      },
    },
  ],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3210/fr",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
