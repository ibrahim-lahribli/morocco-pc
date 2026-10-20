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
  // Two servers for two jobs: the app under test (3210, needs a prior
  // `npm run build`) and the fixture mock API (3211, zero deps). The mock is
  // listed second so a failing app never hides a failing mock.
  webServer: [
    {
      command: "npm run start",
      url: "http://localhost:3210/fr",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npm run mock:api",
      url: "http://localhost:3211/v1/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
