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
  // Three servers for three jobs: the app under test (3210, needs a prior
  // `npm run build`), the fixture mock API the SERVER reads (3211, zero deps),
  // and a second instance of that mock on the port the BROWSER calls by default
  // (3000 — see `apiBaseUrl()`; no `NEXT_PUBLIC_API_BASE_URL` is inlined in a CI
  // build). The app is listed first so a failing app never hides a failing mock.
  //
  // `API_BASE_URL` is the SERVER-side API root (S11). The results page fetches
  // in a server component, where a browser route interception does not exist, so
  // the Next process itself has to be pointed at the fixture mock — that is the
  // only way the SSR path is exercised by the suite rather than replaced by it.
  webServer: [
    {
      command: "npm run start",
      url: "http://localhost:3210/fr",
      env: { API_BASE_URL: "http://localhost:3211" },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npm run mock:api",
      url: "http://localhost:3211/v1/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // The browser's default API base. Started through `env` because a
      // `MOCK_API_PORT=3000 npm run …` prefix does not work through the shell
      // Playwright spawns on Windows.
      command: "npm run mock:api",
      url: "http://localhost:3000/v1/health",
      env: { MOCK_API_PORT: "3000" },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
