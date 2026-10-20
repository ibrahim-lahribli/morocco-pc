/**
 * apps/web/e2e/wizard.spec.ts — S7's proof.
 *
 * The wizard is the one screen whose state is a URL, so the specs are written
 * against URLs: what a deep link renders, what an incomplete one is repaired to,
 * and what browser Back does. Those are the three ways a URL-synced flow breaks
 * while looking fine in a screenshot.
 *
 * `meta/options` is INTERCEPTED, not proxied to the fixture server. The build
 * inlines `NEXT_PUBLIC_API_BASE_URL` (a public env var is a build-time value),
 * so a test cannot redirect the browser to port 3211 at runtime; and a 503 has
 * to be produced on demand, which `page.route` can do and a static mock URL
 * cannot. The body is the mock's own `META_OPTIONS`, imported rather than
 * copied, so the two cannot drift.
 */

import { test, expect, type Page } from "@playwright/test";

import { META_OPTIONS } from "../mock/fixtures.mjs";

const META_ROUTE = "**/v1/meta/options*";
const JSON_HEADERS = { "access-control-allow-origin": "*" };

async function serveMeta(page: Page, body: unknown = META_OPTIONS): Promise<void> {
  await page.route(META_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  );
}

test("step 1 renders the labels meta/options supplies, never the enum values", async ({ page }) => {
  await serveMeta(page);
  await page.goto("/fr/configurer");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Configurez votre PC");
  await expect(page.getByText("Étape 1 sur 4")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Jeu" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Bureau" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Travail" })).toBeVisible();

  // V5: the enum is a wire value. It must not be what a user reads.
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/GAMING|OFFICE|WORKSTATION/);

  // Nothing selected yet, so the step is not complete.
  await expect(page.getByRole("button", { name: "Suivant" })).toBeDisabled();
});

test("step 1 is completable from the keyboard alone", async ({ page }) => {
  await serveMeta(page);
  await page.goto("/fr/configurer");
  await expect(page.getByRole("radio", { name: "Jeu" })).toBeVisible();

  // Walk the real tab order (skip link, brand, two language links, then the
  // first radio) instead of focusing by script — that is the scenario.
  let onRadio = false;
  for (let i = 0; i < 12 && !onRadio; i += 1) {
    await page.keyboard.press("Tab");
    onRadio = await page.evaluate(
      () => document.activeElement?.getAttribute("type") === "radio",
    );
  }
  expect(onRadio).toBe(true);

  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "Bureau" })).toBeChecked();

  let onSubmit = false;
  for (let i = 0; i < 8 && !onSubmit; i += 1) {
    await page.keyboard.press("Tab");
    onSubmit = await page.evaluate(
      () => document.activeElement?.textContent?.trim() === "Suivant",
    );
  }
  expect(onSubmit).toBe(true);

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/etape=budget/);
  // "Bureau" is an office profile, and S9 gives it three steps: the
  // resolution question is a gaming one. Keyboard completion is unchanged.
  await expect(page.getByText("Étape 2 sur 3")).toBeVisible();
});

test("a deep link with valid state lands on its step", async ({ page }) => {
  await serveMeta(page);
  await page.goto("/fr/configurer?etape=resolution&use_case=GAMING&budget_amount=7300");

  await expect(page.getByText("Étape 3 sur 4")).toBeVisible();
  await expect(page.getByRole("group", { name: "Quelle résolution visez-vous ?" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "QHD (1440p)" })).toBeVisible();
  // No repair happened: the URL it was asked for is the URL it is on.
  await expect(page).toHaveURL(/etape=resolution/);
});

test("a deep link that skips an unanswered step is repaired to the first gap", async ({ page }) => {
  await serveMeta(page);
  await page.goto("/fr/configurer?etape=priority&use_case=GAMING");

  await expect(page).toHaveURL(/etape=budget/);
  await expect(page.getByText("Étape 2 sur 4")).toBeVisible();
  await expect(page.getByRole("button", { name: "Suivant" })).toBeDisabled();
});

test("typing a budget keeps the field usable, and Back restores it", async ({ page }) => {
  await serveMeta(page);
  await page.goto("/fr/configurer?etape=budget&use_case=GAMING");

  const field = page.getByLabel("Votre enveloppe cible");
  await field.fill("");
  // Character by character on purpose: committing each valid keystroke to the
  // URL must not remount the field or move the caret.
  await field.pressSequentially("7300");
  await expect(field).toHaveValue("7300");
  await expect(field).toBeFocused();
  await expect(page.getByRole("button", { name: "Suivant" })).toBeEnabled();

  await page.getByRole("button", { name: "Suivant" }).click();
  await expect(page).toHaveURL(/etape=resolution/);

  await page.goBack();
  await expect(page).toHaveURL(/etape=budget/);
  // "7 300" with the helper's narrow no-break space: the committed answer.
  await expect(field).toHaveValue(/^7\u202F300$/);
  await expect(page.getByRole("button", { name: "Suivant" })).toBeEnabled();
});

test("an empty amount removes the answer and explains the bounds", async ({ page }) => {
  await serveMeta(page);
  await page.goto("/fr/configurer?etape=budget&use_case=GAMING");

  // An amount that PARSES but is out of range is clamped, not an error — that
  // is S8's rule and `wizard-budget.spec.ts` owns it. What stays an error here
  // is the genuinely unimplemented answer: no digits at all.
  const field = page.getByLabel("Votre enveloppe cible");
  await field.fill("");
  await field.blur();

  await expect(page.getByText(/Saisissez un montant entier entre/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Suivant" })).toBeDisabled();
  await expect(page).not.toHaveURL(/budget_amount=/);
});

test("Enter in the budget field advances, because the step is a form", async ({ page }) => {
  await serveMeta(page);
  await page.goto("/fr/configurer?etape=budget&use_case=GAMING");

  const field = page.getByLabel("Votre enveloppe cible");
  await field.fill("");
  await field.pressSequentially("7300");
  // The app's own promise first: a valid amount enables the step. Only then is
  // Enter meaningful — otherwise this would race the URL update.
  await expect(page.getByRole("button", { name: "Suivant" })).toBeEnabled();

  await field.press("Enter");
  await expect(page).toHaveURL(/etape=resolution/);
});

test("the last step is real: the action submits, and the honest note is gone", async ({ page }) => {
  await serveMeta(page);
  await page.goto(
    "/fr/configurer?etape=priority&use_case=GAMING&budget_amount=7300&resolution=1440p&priority=3",
  );

  await expect(page.getByText("Étape 4 sur 4")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Qu'est-ce qui compte le plus ?" }),
  ).toBeVisible();

  // S10 wired the POST, so the action is a real button now — its request is
  // `wizard-submit.spec.ts`'s subject, not this one's — and the placeholder
  // note that said the feature was unavailable is gone rather than softened.
  await expect(page.getByRole("button", { name: "Voir mes configurations" })).toBeEnabled();
  await expect(page.getByText(/n'est pas encore disponible/)).toHaveCount(0);
});

test("a 503 from meta/options is a retryable message, never an empty form", async ({ page }) => {
  let calls = 0;
  await page.route(META_ROUTE, (route) => {
    calls += 1;
    if (calls === 1) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error: "SCORING_MODEL_UNAVAILABLE",
          message: "The scoring model is not available.",
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: JSON_HEADERS,
      body: JSON.stringify(META_OPTIONS),
    });
  });

  await page.goto("/fr/configurer");
  // Scoped by text: Next's route announcer is also a role="alert", so an
  // unscoped query resolves to two elements (kit.spec.ts hit this first).
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Les options n'ont pas pu être chargées" });
  await expect(alert).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);

  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByRole("radio", { name: "Jeu" })).toBeVisible();
  expect(calls).toBe(2);
});

test("360 px, 48 px targets, and the radio group has a real legend", async ({ page }) => {
  await serveMeta(page);
  await page.goto("/fr/configurer");
  await expect(page.getByRole("radio", { name: "Jeu" })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The group's accessible name comes from the <fieldset>'s <legend> — the
  // thing that was missing from the kit's first demo.
  await expect(page.getByRole("group", { name: "Quel est votre usage principal ?" })).toBeVisible();

  const card = page.locator('label:has(input[value="GAMING"]) > span');
  const cardBox = await card.boundingBox();
  expect(cardBox?.height ?? 0).toBeGreaterThanOrEqual(48);

  const next = await page.getByRole("button", { name: "Suivant" }).boundingBox();
  expect(next?.height ?? 0).toBeGreaterThanOrEqual(48);
});

test("/ar/configurer is Arabic, RTL, and speaks Arabic progress copy", async ({ page }) => {
  await serveMeta(page);
  await page.goto("/ar/configurer");

  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByText("الخطوة 1 من 4")).toBeVisible();
});

test("the home page sends people to the wizard with a LINK", async ({ page }) => {
  await page.goto("/fr");
  const cta = page.getByRole("link", { name: "Configurer mon PC" });
  await expect(cta).toHaveAttribute("href", "/fr/configurer");
});
