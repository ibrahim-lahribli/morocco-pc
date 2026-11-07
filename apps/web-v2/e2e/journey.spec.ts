import { expect, test, type Page } from "@playwright/test";

import { FROM_ID, expectNoApiViolations, stubConfiguratorApi } from "./support/configurator-api";
import { horizontalOverflow, waitForSettledCards } from "./support/homepage-ready";

/**
 * The homepage → configurator journey, end to end against stubbed APIs.
 *
 * One stub answers both legs — the homepage's `meta/options`, its preset
 * ladders and the detail behind each card, then the configurator's own reads —
 * so a path either screen invents is recorded as `unmatched`. Every test closes
 * on `expectNoApiViolations`: a write anywhere fails the spec.
 *
 * The URL is the only thing that crosses the navigation. Nothing here asserts a
 * store, a cookie or a session survives it, because nothing does — the budget is
 * form-local by design and the review phase is client state that a fresh mount
 * legitimately forgets.
 */

const CTA = "Trouver mon PC";
const CONTINUE = "Continuer";
const BUDGET_FIELD = "Budget (DH)";
const RANGE_MESSAGE = /Saisissez un budget entre 3\s?500 et 100\s?000/;
const BUDGET_PRESET_8000 = /Budget de 8\s?000\s?DH/;
const BUDGET_PRESET_12000 = /Budget de 12\s?000\s?DH/;
const BUDGET_PRESET_15000 = /Budget de 15\s?000\s?DH/;

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

/** `11 946` renders with a non-breaking separator, so match either. */
const money = (amount: number) =>
  new RegExp(String(amount).replace(/(\d)(?=(?:\d{3})+$)/g, "$1\\s?"));

const budgetField = (page: Page) => page.getByRole("spinbutton", { name: BUDGET_FIELD });
/** Scoped to `main`: the dev overlay owns an empty `role="alert"` of its own. */
const mainAlerts = (page: Page) => page.locator('main [role="alert"]');

/** Answer both questions on the homepage and hand them over. */
async function handOverFromHomepage(page: Page, answers: { budget: RegExp; useCase: RegExp }) {
  await page.goto("/fr");
  // Hydration boundary: the radios must be live, or React undoes the change.
  await waitForSettledCards(page);

  await page.getByRole("radio", { name: answers.budget }).check({ force: true });
  await page.getByRole("radio", { name: answers.useCase }).check({ force: true });
  await page.getByRole("button", { name: CTA, exact: true }).click();
}

test.describe("homepage to configurator", () => {
  test("carries a gaming 12 000 answer into a review that claims no build", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);

    await handOverFromHomepage(page, {
      budget: BUDGET_PRESET_12000,
      useCase: USAGE.fr.GAMING,
    });

    await expect(page).toHaveURL(/\/fr\/configurateur\?use_case=GAMING&budget=12000$/);
    await expect(page.getByRole("radio", { name: USAGE.fr.GAMING })).toBeChecked();
    await expect(budgetField(page)).toHaveValue("12000");

    await page.getByRole("button", { name: CONTINUE }).click();

    await expect(
      page.getByText(/Vos réponses : Jeux vidéo & Gaming · 12\s?000\s?DH/),
    ).toBeVisible();
    expectNoApiViolations(stub);
  });

  test("carries an office 8 000 answer into the same review", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);

    await handOverFromHomepage(page, {
      budget: BUDGET_PRESET_8000,
      useCase: USAGE.fr.OFFICE,
    });

    await expect(page).toHaveURL(/\/fr\/configurateur\?use_case=OFFICE&budget=8000$/);
    await expect(page.getByRole("radio", { name: USAGE.fr.OFFICE })).toBeChecked();
    await expect(budgetField(page)).toHaveValue("8000");

    await page.getByRole("button", { name: CONTINUE }).click();

    await expect(
      page.getByText(/Vos réponses : Études et bureautique · 8\s?000\s?DH/),
    ).toBeVisible();
    expectNoApiViolations(stub);
  });

  test("carries a workstation 15 000 answer into the same review", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);

    await handOverFromHomepage(page, {
      budget: BUDGET_PRESET_15000,
      useCase: USAGE.fr.WORKSTATION,
    });

    await expect(page).toHaveURL(/\/fr\/configurateur\?use_case=WORKSTATION&budget=15000$/);
    await expect(page.getByRole("radio", { name: USAGE.fr.WORKSTATION })).toBeChecked();
    await expect(budgetField(page)).toHaveValue("15000");

    await page.getByRole("button", { name: CONTINUE }).click();

    await expect(
      page.getByText(/Vos réponses : Création et travail pro · 15\s?000\s?DH/),
    ).toBeVisible();
    expectNoApiViolations(stub);
  });

  test("opens a shared Arabic deep link with nothing to flag on arrival", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);
    await page.goto("/ar/configurateur?use_case=OFFICE&budget=8000");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("radio", { name: USAGE.ar.OFFICE })).toBeChecked();
    await expect(page.getByRole("spinbutton")).toHaveValue("8000");
    // Nothing is validated until a submit: a deep link is not a form attempt.
    await expect(mainAlerts(page)).toHaveCount(0);

    expectNoApiViolations(stub);
  });

  test("survives a reload with the same answers and no message", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);
    await page.goto("/fr/configurateur?use_case=OFFICE&budget=8000");
    await expect(page.getByRole("radio", { name: USAGE.fr.OFFICE })).toBeChecked();

    await page.reload();

    await expect(page.getByRole("radio", { name: USAGE.fr.OFFICE })).toBeChecked();
    await expect(budgetField(page)).toHaveValue("8000");
    await expect(mainAlerts(page)).toHaveCount(0);

    expectNoApiViolations(stub);
  });

  test("leaves the homepage one back button away", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);

    await handOverFromHomepage(page, {
      budget: BUDGET_PRESET_8000,
      useCase: USAGE.fr.OFFICE,
    });
    await expect(page).toHaveURL(/\/fr\/configurateur\?use_case=OFFICE&budget=8000$/);

    await page.goBack();

    // The answers are deliberately NOT asserted here: the budget is form-local,
    // so a returned visitor gets a fresh finder rather than a restored one.
    await expect(page).toHaveURL(/\/fr$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expectNoApiViolations(stub);
  });

  test("keeps both parameters when the reader switches to Arabic", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);
    await page.goto("/fr/configurateur?use_case=GAMING&budget=12000");

    const arabic = page.getByRole("link", { name: "Afficher en العربية" });
    await expect(arabic).toHaveAttribute("href", "/ar/configurateur?use_case=GAMING&budget=12000");
    await arabic.click();

    await expect(page).toHaveURL(/\/ar\/configurateur\?use_case=GAMING&budget=12000$/);
    await expect(page.getByRole("radio", { name: USAGE.ar.GAMING })).toBeChecked();
    expectNoApiViolations(stub);
  });

  test("keeps both parameters but drops the review phase on the way back to French", async ({
    page,
  }) => {
    const stub = await stubConfiguratorApi(page);
    await page.goto("/ar/configurateur?use_case=GAMING&budget=12000");

    await page.locator("form button[type=submit]").click();
    await expect(page.getByText(/إجاباتك: /)).toBeVisible();

    await page.locator('a[hreflang="fr"]').first().click();

    await expect(page).toHaveURL(/\/fr\/configurateur\?use_case=GAMING&budget=12000$/);
    await expect(page.getByRole("radio", { name: USAGE.fr.GAMING })).toBeChecked();
    await expect(budgetField(page)).toHaveValue("12000");
    // The phase is client state and the URL is not rewritten to record it: the
    // new mount asks the two questions again instead of recapping.
    await expect(page.getByText(/Vos réponses :/)).toHaveCount(0);
    await expect(page.getByText(/Choisissez un usage et un budget/)).toBeVisible();
    expectNoApiViolations(stub);
  });

  test("fits the Arabic summary bar above the nav at 360 px, loaded or not", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const stub = await stubConfiguratorApi(page);
    await page.goto("/ar/configurateur?use_case=GAMING&budget=12000");
    await expect(page.getByRole("radio", { name: USAGE.ar.GAMING })).toBeChecked();

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const bar = await page.locator('[data-slot="build-summary"]').boundingBox();
    // The mobile nav carries a stable slot hook, not a translated label or a
    // utility class: a styling refactor must not be able to break this test.
    const navContent = await page.locator('[data-slot="mobile-nav"] ul').boundingBox();
    expect(bar).not.toBeNull();
    expect(navContent).not.toBeNull();
    if (bar === null || navContent === null) return;

    // The bar stacks on the nav's content box (its 1 px top border is covered).
    expect(bar.y + bar.height).toBeLessThanOrEqual(navContent.y + 1);

    // A loaded pass is what renders the use-case/budget meta line, so the
    // narrowest layout is measured again with that line present.
    await page.goto(`/ar/configurateur?from=${FROM_ID}`);
    await expect(page.getByText(/الاستخدام · الألعاب/)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    expectNoApiViolations(stub);
  });

  test("loads the pass and keeps an invalid budget error beside it", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);
    await page.goto(`/fr/configurateur?from=${FROM_ID}&budget=12`);

    // Neither state erases the other: the pass is rendered from `from`, the
    // budget field keeps the out-of-contract text it arrived with.
    await expect(page.getByText(money(11_946))).toBeVisible();
    await expect(page.getByText(/Usage · Jeux vidéo & Gaming/)).toBeVisible();
    await expect(budgetField(page)).toHaveValue("12");
    await expect(page.getByText(RANGE_MESSAGE)).toBeVisible();

    expectNoApiViolations(stub);
  });
});
