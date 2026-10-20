/**
 * apps/web/e2e/wizard-submit.spec.ts — S10's proof, in a browser.
 *
 * The subject is the HAND-OFF: the last step becomes a request, and everything
 * that can happen to a request has to be said out loud. So each spec drives the
 * real screen and pins one of them — the body that goes out, the state that
 * appears within 300 ms, and the five ways it can come back wrong.
 *
 * Two mechanics worth knowing before reading the handlers:
 *
 *   1. **The POST is preflighted.** The app fetches `localhost:3000` (inlined at
 *      build time) with a JSON content type, so the browser sends OPTIONS first.
 *      A route that only answers POST would fail the preflight and look like a
 *      network error, so `servePost` answers OPTIONS itself and counts only
 *      real POSTs — which is also what makes the double-tap spec honest.
 *   2. **Every response is a FIXTURE**, imported from `mock/fixtures.mjs` like
 *      S4's contract spec, so a body that drifts fails here rather than in a
 *      screenshot.
 */

import { test, expect, type Page, type Route } from "@playwright/test";

import {
  META_OPTIONS,
  RECOMMENDATION_OK,
  RECOMMENDATION_ZERO_BUILD,
} from "../mock/fixtures.mjs";

const META_ROUTE = "**/v1/meta/options*";
const POST_ROUTE = "**/v1/recommendations";
// The route stands in for the server, so it has to send what the server
// sends - INCLUDING the expose header, without which a browser cannot read
// `Retry-After` and the 429 spec would pass only against a mock that lies.
const JSON_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "retry-after,x-request-id",
};
const PREFLIGHT_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
};

/** The last step of a gaming profile, fully answered. */
const LAST_STEP =
  "/fr/configurer?etape=priority&use_case=GAMING&budget_amount=7300&resolution=1440p&priority=3";

type Answer = { status: number; body: unknown; headers?: Record<string, string> };

/** Route `POST /v1/recommendations`, answering from `handler` in order. */
async function servePost(
  page: Page,
  handler: (index: number, body: unknown) => Answer | Promise<Answer>,
): Promise<{ bodies: unknown[]; count: () => number }> {
  const bodies: unknown[] = [];
  await page.route(POST_ROUTE, async (route: Route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: PREFLIGHT_HEADERS });
      return;
    }
    const raw = route.request().postData();
    const body = raw === null ? null : (JSON.parse(raw) as unknown);
    bodies.push(body);
    const answer = await handler(bodies.length - 1, body);
    await route.fulfill({
      status: answer.status,
      contentType: "application/json",
      headers: { ...JSON_HEADERS, ...(answer.headers ?? {}) },
      body: JSON.stringify(answer.body),
    });
  });
  return { bodies, count: () => bodies.length };
}

async function serveMeta(page: Page): Promise<void> {
  await page.route(META_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: JSON_HEADERS,
      body: JSON.stringify(META_OPTIONS),
    }),
  );
}

const submitButton = (page: Page) => page.getByRole("button", { name: "Voir mes configurations" });

test("the last step posts the contract's body and lands on the result", async ({ page }) => {
  await serveMeta(page);
  const post = await servePost(page, () => ({ status: 201, body: RECOMMENDATION_OK }));

  await page.goto(LAST_STEP);
  await submitButton(page).click();

  await expect(page).toHaveURL(new RegExp(`/fr/config/${RECOMMENDATION_OK.id}$`));
  expect(post.bodies).toHaveLength(1);
  // The body is the contract's: a NUMBER budget, the three-letter currency, the
  // answers the URL held — not a merged or renamed version of them.
  expect(post.bodies[0]).toEqual({
    budget_amount: 7300,
    currency: "MAD",
    use_case: "GAMING",
    resolution: "1440p",
    priority: 3,
  });
  // The hand-off page shows the identifier the response produced.
  await expect(page.getByText(RECOMMENDATION_OK.id)).toBeVisible();
});

test("the progress block beats 300 ms, and its clock is real", async ({ page }) => {
  await serveMeta(page);
  await servePost(page, async () => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    return { status: 201, body: RECOMMENDATION_OK };
  });

  await page.goto(LAST_STEP);
  const started = Date.now();
  await submitButton(page).click();

  const bar = page.getByRole("progressbar", { name: "Recherche des configurations" });
  await expect(bar).toBeVisible();
  // The polite region exists BEFORE the text it carries, which is what makes a
  // screen reader speak it; this is the announcement the DoD asks for.
  await expect(page.getByRole("status")).toHaveText("Recherche des configurations en cours…");
  // The sprint's number. Nothing is awaited before the state is set, so this is
  // the paint after a click — if it ever fails, the screen really is frozen.
  expect(Date.now() - started).toBeLessThan(300);

  // What the bar MEANS, read instead of its number: sent, not answered.
  await expect(bar).toHaveAttribute("aria-valuetext", "Demande envoyée, réponse en attente");
  // The skeleton is decoration for the cards that are coming — asserted as
  // PRESENT rather than counted, because the count is SkeletonCard's shape.
  await expect(page.locator(".animate-pulse").first()).toBeVisible();
  // The page proves it is alive with a fact, not a fake percentage.
  await expect(page.getByText("Depuis 1 s")).toBeVisible();
  await expect(page.getByText("Depuis 2 s")).toBeVisible();
  // Nothing is clickable while the request is in flight.
  await expect(page.locator("form")).toHaveAttribute("aria-busy", "true");
  await expect(submitButton(page)).toBeDisabled();

  await expect(page).toHaveURL(new RegExp(`/fr/config/${RECOMMENDATION_OK.id}$`));
});

test("a 422 moves back to the field it names, shows the sentence and focuses it", async ({
  page,
}) => {
  await serveMeta(page);
  await servePost(page, () => ({
    status: 422,
    body: {
      error: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: [{ field: "use_case", message: "must be equal to one of the allowed values" }],
      request_id: "req_fixture_422",
    },
  }));

  await page.goto(LAST_STEP);
  await submitButton(page).click();

  // The refusal is about a screen the user already left, so they are taken back.
  await expect(page).toHaveURL(/etape=usage/);
  await expect(
    page.getByText("Cet usage n'a pas été reconnu par le service. Choisissez-en un autre."),
  ).toBeVisible();
  await expect(page.locator('input[name="use_case"]').first()).toBeFocused();
  // The answers survive the trip back.
  await expect(page).toHaveURL(/budget_amount=7300/);
});

test("a 422 about a field with no control is a sentence and a retry, on the same step", async ({
  page,
}) => {
  await serveMeta(page);
  await servePost(page, () => ({
    status: 422,
    body: {
      error: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: [{ field: "currency", message: "must be equal to one of the allowed values" }],
    },
  }));

  await page.goto(LAST_STEP);
  await submitButton(page).click();

  // Nothing to jump to: the wizard fixes the currency, so the app says so where
  // the user is standing.
  await expect(page).toHaveURL(/etape=priority/);
  await expect(page.getByText("La devise de la demande n'est pas acceptée.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeEnabled();
});

test("a 413 explains itself, and the retry is the same button", async ({ page }) => {
  await serveMeta(page);
  const post = await servePost(page, (index) =>
    index === 0
      ? {
          status: 413,
          body: { error: "PAYLOAD_TOO_LARGE", message: "Request body is larger than 10 KB" },
        }
      : { status: 201, body: RECOMMENDATION_OK },
  );

  await page.goto(LAST_STEP);
  await submitButton(page).click();

  await expect(
    page.getByText("La demande est trop volumineuse pour être acceptée. Réessayez dans un instant."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/config/${RECOMMENDATION_OK.id}$`));
  expect(post.count()).toBe(2);
});

test("a 429 counts down from Retry-After, disables the action, then re-enables it", async ({
  page,
}) => {
  await serveMeta(page);
  await servePost(page, (index) =>
    index === 0
      ? {
          status: 429,
          body: { error: "RATE_LIMITED", message: "Rate limit exceeded", request_id: "req_429" },
          headers: { "retry-after": "2" },
        }
      : { status: 201, body: RECOMMENDATION_OK },
  );

  await page.goto(LAST_STEP);
  await submitButton(page).click();

  // The number is the API's, formatted by the app (never "2s" typed by hand).
  await expect(page.getByText("Trop de demandes en peu de temps. Réessayez dans 2 s.")).toBeVisible();
  const retry = page.getByRole("button", { name: "Réessayer" });
  await expect(retry).toBeDisabled();

  await expect(page.getByText(/Réessayez dans 1 s\./)).toBeVisible();
  // At zero the countdown stops claiming a number and the action comes back.
  await expect(page.getByText("Trop de demandes en peu de temps. Réessayez dans un instant.")).toBeVisible();
  await expect(retry).toBeEnabled();

  await retry.click();
  await expect(page).toHaveURL(new RegExp(`/fr/config/${RECOMMENDATION_OK.id}$`));
});

test("a 503 says the service is unavailable, and the retry is the same button", async ({
  page,
}) => {
  await serveMeta(page);
  const post = await servePost(page, (index) =>
    index === 0
      ? {
          status: 503,
          body: {
            error: "SCORING_MODEL_UNAVAILABLE",
            message: "No active scoring model is configured",
          },
        }
      : { status: 201, body: RECOMMENDATION_OK },
  );

  await page.goto(LAST_STEP);
  await submitButton(page).click();

  // A network failure reads the same way from here, which is why the model maps
  // both to `unavailable`: the user's next move is a retry either way.
  await expect(
    page.getByText("Le service est momentanément indisponible. Réessayez dans un instant."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/config/${RECOMMENDATION_OK.id}$`));
  expect(post.count()).toBe(2);
});

test("a 500 shows the reference for support, and never the server's text", async ({ page }) => {
  await serveMeta(page);
  await servePost(page, () => ({
    status: 500,
    body: {
      error: "INTERNAL_ERROR",
      message: "Unexpected failure in the recommendation pipeline",
      request_id: "req_fixture_500",
    },
  }));

  await page.goto(LAST_STEP);
  await submitButton(page).click();

  await expect(
    page.getByText(
      "Une erreur inattendue s'est produite. Réessayez ; si elle persiste, signalez la référence ci-dessous.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Référence : req_fixture_500")).toBeVisible();
  // The API's own message can carry a SQL fragment or a host; it stays out of the UI.
  await expect(page.getByText(/recommendation pipeline/)).toHaveCount(0);
});

test("a double tap sends exactly one request", async ({ page }) => {
  await serveMeta(page);
  const post = await servePost(page, async () => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    return { status: 201, body: RECOMMENDATION_OK };
  });

  await page.goto(LAST_STEP);
  // Hydration first: an un-hydrated form submits NATIVELY and reloads the same
  // URL, which would look like a blocked request rather than a sent one.
  await expect(submitButton(page)).toBeEnabled();
  // Two submits in the SAME tick: the button is not disabled yet when the second
  // one fires, so only a synchronous guard (not state) can hold the line.
  await page.evaluate(() => {
    const form = document.querySelector("form");
    if (form instanceof HTMLFormElement) {
      form.requestSubmit();
      form.requestSubmit();
    }
  });

  await expect(page).toHaveURL(new RegExp(`/fr/config/${RECOMMENDATION_OK.id}$`));
  expect(post.count()).toBe(1);
});

test("a zero-build 200 is a result, not an error", async ({ page }) => {
  await serveMeta(page);
  await servePost(page, () => ({ status: 200, body: RECOMMENDATION_ZERO_BUILD }));

  await page.goto(LAST_STEP);
  await submitButton(page).click();

  // V2: an empty pass is legitimate. S14 owns the zero-build experience; S10
  // must simply not dress it up as a failure on the way there.
  await expect(page).toHaveURL(new RegExp(`/fr/config/${RECOMMENDATION_ZERO_BUILD.id}$`));
  // The hand-off page is what it says it is...
  await expect(page.getByText("Votre demande est enregistrée.")).toBeVisible();
  // ...and no failure copy came with it. Scoped by text on purpose: Next's
  // route announcer is ALSO a role="alert", so a bare role count would fail
  // on a page that has nothing wrong with it.
  await expect(page.getByText(/Une erreur inattendue|Réessayez dans/)).toHaveCount(0);
});
