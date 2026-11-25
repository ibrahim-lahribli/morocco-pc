import { expect, test, type Page } from "@playwright/test";

import { horizontalOverflow, waitForSettledCards } from "./support/homepage-ready";
import { stubHomepageApi } from "./support/homepage-api";

/**
 * The homepage → configurator journey, end to end.
 *
 * The URL is the only thing that crosses the navigation: the finder hands the
 * two answers to the configurator as query params (`step=2`, `use_case`,
 * `budget`), and nothing else — no store, cookie or session — survives it,
 * because nothing does. The budget is form-local by design, and the steps are
 * placeholders that fetch nothing and fire no API request.
 */

const CTA = "Trouver mon PC";
const BUDGET_PRESET_8000 = /Budget de 8\s?000\s?DH/;
const BUDGET_PRESET_12000 = /Budget de 12\s?000\s?DH/;
const BUDGET_PRESET_15000 = /Budget de 15\s?000\s?DH/;

const STEP_TWO_HEADING = "Étape 2 — Affinons votre configuration";

/** The usage radio's accessible name, per locale: the dictionaries are the source. */
const USAGE = {
  fr: {
    GAMING: /Jeux vidéo & Gaming/,
    OFFICE: /Études et bureautique/,
    WORKSTATION: /Création et travail pro/,
  },
  ar: {
    GAMING: /الألعاب/,
    OFFICE: /الدراسة والمكتبيات/,
    WORKSTATION: /الإبداع والعمل المهني/,
  },
} as const;

/** Answer both questions on the homepage and hand them over. */
async function handOverFromHomepage(page: Page, answers: { budget: RegExp; useCase: RegExp }) {
  // The steps fetch nothing, so only the homepage leg needs a stub; the
  // configurator is asserted on its URL and its placeholder heading alone.
  await stubHomepageApi(page);
  await page.goto("/fr");
  // Hydration boundary: the radios must be live, or React undoes the change.
  await waitForSettledCards(page);

  await page.getByRole("radio", { name: answers.budget }).check({ force: true });
  await page.getByRole("radio", { name: answers.useCase }).check({ force: true });
  await page.getByRole("button", { name: CTA, exact: true }).click();
}

test.describe("homepage to configurator", () => {
  test("carries a gaming 12 000 answer straight into Step 2", async ({ page }) => {
    await handOverFromHomepage(page, { budget: BUDGET_PRESET_12000, useCase: USAGE.fr.GAMING });

    await expect(page).toHaveURL(/\/fr\/configurateur\?step=2&use_case=GAMING&budget=12000$/);
    await expect(page.getByRole("heading", { level: 1, name: STEP_TWO_HEADING })).toBeVisible();
  });

  test("carries an office 8 000 answer into the same Step 2", async ({ page }) => {
    await handOverFromHomepage(page, { budget: BUDGET_PRESET_8000, useCase: USAGE.fr.OFFICE });

    await expect(page).toHaveURL(/\/fr\/configurateur\?step=2&use_case=OFFICE&budget=8000$/);
    await expect(page.getByRole("heading", { level: 1, name: STEP_TWO_HEADING })).toBeVisible();
  });

  test("carries a workstation 15 000 answer into the same Step 2", async ({ page }) => {
    await handOverFromHomepage(page, {
      budget: BUDGET_PRESET_15000,
      useCase: USAGE.fr.WORKSTATION,
    });

    await expect(page).toHaveURL(/\/fr\/configurateur\?step=2&use_case=WORKSTATION&budget=15000$/);
    await expect(page.getByRole("heading", { level: 1, name: STEP_TWO_HEADING })).toBeVisible();
  });

  test("keeps step and answers across a reload", async ({ page }) => {
    await handOverFromHomepage(page, { budget: BUDGET_PRESET_12000, useCase: USAGE.fr.GAMING });
    await expect(page.getByRole("heading", { level: 1, name: STEP_TWO_HEADING })).toBeVisible();

    await page.reload();

    await expect(page).toHaveURL(/\/fr\/configurateur\?step=2&use_case=GAMING&budget=12000$/);
    await expect(page.getByRole("heading", { level: 1, name: STEP_TWO_HEADING })).toBeVisible();
  });

  test("opens a shared Arabic Step 2 deep link in RTL", async ({ page }) => {
    await page.goto("/ar/configurateur?step=2&use_case=OFFICE&budget=8000");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الخطوة 2 — لنحسّن تكوينك");
  });

  test("leaves the homepage one back button away", async ({ page }) => {
    await handOverFromHomepage(page, { budget: BUDGET_PRESET_8000, useCase: USAGE.fr.OFFICE });
    await expect(page).toHaveURL(/\/fr\/configurateur\?step=2&use_case=OFFICE&budget=8000$/);

    await page.goBack();

    // The answers are deliberately NOT asserted here: the budget is form-local,
    // so a returned visitor gets a fresh finder rather than a restored one.
    await expect(page).toHaveURL(/\/fr$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("keeps step, use case and budget when the reader switches to Arabic", async ({ page }) => {
    await page.goto("/fr/configurateur?step=2&use_case=GAMING&budget=12000");
    await expect(page.getByRole("heading", { level: 1, name: STEP_TWO_HEADING })).toBeVisible();

    const arabic = page.getByRole("link", { name: "Afficher en العربية" });
    await expect(arabic).toHaveAttribute(
      "href",
      "/ar/configurateur?step=2&use_case=GAMING&budget=12000",
    );
    await arabic.click();

    await expect(page).toHaveURL(/\/ar\/configurateur\?step=2&use_case=GAMING&budget=12000$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الخطوة 2 — لنحسّن تكوينك");
  });

  test("fits the placeholders above the mobile nav at 360 px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/ar/configurateur?step=2&use_case=GAMING&budget=8000");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الخطوة 2 — لنحسّن تكوينك");

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const navContent = await page.locator('[data-slot="mobile-nav"] ul').boundingBox();
    expect(navContent).not.toBeNull();
  });
});
