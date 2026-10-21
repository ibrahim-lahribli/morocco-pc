/**
 * apps/web/e2e/wizard-browser-api.spec.ts — the browser→API path, un-stubbed.
 *
 * Every other wizard spec intercepts `**\/v1/**`, because `NEXT_PUBLIC_*` is
 * inlined at BUILD time: without it the browser posts to the client's default
 * base, `http://localhost:3000`, and a test that wanted the real path had to
 * supply that server itself. So the suite proved the SERVER-side fetch (the
 * results page reads `API_BASE_URL`) and the FORM's behaviour against a stub,
 * but never both halves of a real submit.
 *
 * This spec closes that gap with no build-time env and no change to the app:
 * `playwright.config.ts` starts a SECOND instance of the same fixture mock on
 * port 3000 (`MOCK_API_PORT`), which is exactly the base `apiBaseUrl()` falls
 * back to. The browser therefore talks to a real HTTP server over a real CORS
 * preflight, and the redirect that follows is served by the Next process reading
 * the SAME mock at 3211 — two hops, both real.
 *
 * Why it is OPT-IN (`E2E_BROWSER_API=1`, set by `web.yml`): on a developer
 * machine port 3000 may hold the real API, which is write-capable against the
 * TEST branch and refuses the shared database only by default. A spec that
 * submits a real pass because a server happened to be listening would be a
 * surprise nobody asked for, so it runs where the port is provably the mock.
 */
import { test, expect, type Page } from "@playwright/test";

import { IDS, RECOMMENDATION_OK } from "../mock/fixtures.mjs";

test.skip(
  process.env.E2E_BROWSER_API !== "1",
  "set E2E_BROWSER_API=1 to drive the real browser→mock API path (port 3000)",
);

/** The last step of a gaming profile, fully answered — the same URL S10 uses. */
const LAST_STEP =
  "/fr/configurer?etape=priority&use_case=GAMING&budget_amount=7300&resolution=1440p&priority=3";

const submitButton = (page: Page) =>
  page.getByRole("button", { name: "Voir mes configurations" });

test("the wizard submits to a real HTTP server, and the result page reads the pass back", async ({
  page,
}) => {
  // NOTHING here intercepts a request: that is the subject of the spec.
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/v1/recommendations")) {
      posts.push(request.url());
    }
  });

  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().includes("/v1/recommendations"),
  );

  await page.goto(LAST_STEP);
  await submitButton(page).click();

  const response = await answered;
  // A real 201 from the mock, not a fulfilled stub. 200 would mean the API's
  // dedupe path served a committed pass, which this fixture does not assert.
  expect(response.status()).toBe(201);
  expect(new URL(response.url()).origin).toBe("http://localhost:3000");
  expect(posts).toHaveLength(1);

  // The hand-off is a reference: the destination reads that id back through the
  // Next server, whose own API base is the mock on 3211 (playwright.config.ts).
  await expect(page).toHaveURL(new RegExp(`/fr/config/${IDS.ok}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vos configurations");
  await expect(page.locator("article")).toHaveCount(RECOMMENDATION_OK.builds.length);
  // The card's furniture, so a blank-but-correct-count render cannot pass.
  await expect(page.getByRole("progressbar").first()).toBeVisible();
});
