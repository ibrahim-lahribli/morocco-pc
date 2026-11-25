import { expect, test, type Page } from "@playwright/test";

/**
 * The configurator route, end to end.
 *
 * The page renders two empty step placeholders and resolves which one from
 * the URL alone — no API request, no stub, no client state. Step 2 requires
 * a complete, valid handoff (`step=2` + `use_case` + `budget`); every other
 * URL renders Step 1 content while keeping the URL the visitor arrived with.
 */

const STEP_ONE_HEADING = "Étape 1 — Définissons vos besoins";
const STEP_TWO_HEADING = "Étape 2 — Affinons votre configuration";

const stepOneHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: STEP_ONE_HEADING });
const stepTwoHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: STEP_TWO_HEADING });

const VALID_STEP_TWO = "/fr/configurateur?step=2&use_case=GAMING&budget=8000";

test.describe("configurator steps", () => {
  test("renders Step 1 without a step parameter", async ({ page }) => {
    await page.goto("/fr/configurateur");

    await expect(stepOneHeading(page)).toBeVisible();
    await expect(stepTwoHeading(page)).toHaveCount(0);
    expect(page.url()).toMatch(/\/fr\/configurateur$/);
  });

  test("renders Step 1 for an explicit step=1", async ({ page }) => {
    await page.goto("/fr/configurateur?step=1");

    await expect(stepOneHeading(page)).toBeVisible();
  });

  test("renders Step 2 for a complete valid handoff", async ({ page }) => {
    await page.goto(VALID_STEP_TWO);

    await expect(stepTwoHeading(page)).toBeVisible();
    await expect(stepOneHeading(page)).toHaveCount(0);
    await expect(page.getByText("Étape 2", { exact: true })).toBeVisible();
    expect(page.url()).toMatch(/step=2&use_case=GAMING&budget=8000$/);
  });

  test("renders Step 2 for the office use case", async ({ page }) => {
    await page.goto("/fr/configurateur?step=2&use_case=OFFICE&budget=6000");

    await expect(stepTwoHeading(page)).toBeVisible();
  });

  test("renders Step 2 for the workstation use case", async ({ page }) => {
    await page.goto("/fr/configurateur?step=2&use_case=WORKSTATION&budget=15000");

    await expect(stepTwoHeading(page)).toBeVisible();
  });

  test("renders Step 1 content but keeps the URL for a bare step=2", async ({ page }) => {
    await page.goto("/fr/configurateur?step=2");

    await expect(stepOneHeading(page)).toBeVisible();
    await expect(stepTwoHeading(page)).toHaveCount(0);
    expect(page.url()).toMatch(/step=2$/);
  });

  test("renders Step 1 for an incomplete or invalid step=2 handoff", async ({ page }) => {
    const invalid = [
      "/fr/configurateur?step=2&budget=8000",
      "/fr/configurateur?step=2&use_case=GAMING",
      "/fr/configurateur?step=2&use_case=CONSOLE&budget=8000",
      "/fr/configurateur?step=2&use_case=GAMING&budget=12",
      "/fr/configurateur?step=2&use_case=GAMING&budget=3499",
      "/fr/configurateur?step=2&use_case=GAMING&budget=100001",
      "/fr/configurateur?step=2&use_case=GAMING&budget=9%20000",
    ];

    for (const url of invalid) {
      await page.goto(url);

      await expect(stepOneHeading(page), url).toBeVisible();
      await expect(stepTwoHeading(page), url).toHaveCount(0);
    }
  });

  test("renders Step 1 for an invalid step value", async ({ page }) => {
    for (const step of ["3", "abc", "02", "0"]) {
      await page.goto(`/fr/configurateur?step=${step}&use_case=GAMING&budget=8000`);

      await expect(stepOneHeading(page), `step=${step}`).toBeVisible();
    }
  });

  test("keeps the step across a reload", async ({ page }) => {
    await page.goto(VALID_STEP_TWO);
    await expect(stepTwoHeading(page)).toBeVisible();

    await page.reload();
    await expect(stepTwoHeading(page)).toBeVisible();

    await page.goto("/fr/configurateur");
    await page.reload();
    await expect(stepOneHeading(page)).toBeVisible();
  });

  test("serves the Arabic steps in RTL", async ({ page }) => {
    await page.goto("/ar/configurateur?step=2&use_case=GAMING&budget=8000");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الخطوة 2 — لنحسّن تكوينك");

    await page.goto("/ar/configurateur");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("الخطوة 1 — لنحدّد احتياجاتك");
  });
});

test.describe("configurator entry paths", () => {
  test("the desktop header Configurer link opens Step 1", async ({ page }) => {
    await page.goto("/fr");

    const header = page.getByRole("navigation", { name: "Navigation principale" });
    const configure = header.getByRole("link", { name: "Configurer" });
    await expect(configure).toHaveAttribute("href", "/fr/configurateur?step=1");
    await configure.click();

    await expect(page).toHaveURL(/\/fr\/configurateur\?step=1$/);
    await expect(stepOneHeading(page)).toBeVisible();
  });

  test("the mobile Configurer action opens Step 1 and stays highlighted on both steps", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/fr");

    const nav = page.getByRole("navigation", { name: "Navigation mobile" });
    const configure = nav.getByRole("link", { name: "Configurer" });
    await expect(configure).toHaveAttribute("href", "/fr/configurateur?step=1");
    await configure.click();

    await expect(page).toHaveURL(/\/fr\/configurateur\?step=1$/);
    await expect(stepOneHeading(page)).toBeVisible();
    await expect(configure).toHaveAttribute("aria-current", "page");

    await page.goto(VALID_STEP_TWO);
    await expect(stepTwoHeading(page)).toBeVisible();
    await expect(configure).toHaveAttribute("aria-current", "page");
  });

  test("preserves step and answers across a locale switch", async ({ page }) => {
    await page.goto(VALID_STEP_TWO);
    await expect(stepTwoHeading(page)).toBeVisible();

    await expect(page.getByRole("link", { name: "Afficher en العربية" })).toHaveAttribute(
      "href",
      "/ar/configurateur?step=2&use_case=GAMING&budget=8000",
    );
  });
});

test.describe("configurator layout", () => {
  test("keeps one heading level and no horizontal overflow at 360 px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(VALID_STEP_TWO);

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
