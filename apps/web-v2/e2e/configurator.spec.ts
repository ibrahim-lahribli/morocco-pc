import { expect, test, type Page } from "@playwright/test";

import {
  COMPONENT_NAMES,
  FIRST_TOTAL,
  FLOOR_TOTAL,
  FROM_ID,
  SECOND_TOTAL,
  detailCalls,
  expectNoApiViolations,
  stubConfiguratorApi,
} from "./support/configurator-api";

/**
 * The configurator route, end to end against a stubbed API.
 *
 * Every test asserts the stub saw no write and no unmatched API path. The
 * suite never stubs a POST: a write would be answered 405 and fail the test,
 * which is the point — Step 3.2 is a read-only handoff.
 */
const USAGE_GAMING = /Jeux vidéo & Gaming/;
const USAGE_OFFICE = /Études et bureautique/;
const BUDGET_FIELD = "Budget (DH)";
const RANGE_MESSAGE = /Saisissez un budget entre 3\s?500 et 100\s?000/;
/** `11 946` renders with a non-breaking separator, so match either. */
const money = (amount: number) =>
  new RegExp(String(amount).replace(/(\d)(?=(\d{3})+$)/g, "$1\\s?"));
const TOTAL_PATTERN = money(FIRST_TOTAL);

const budgetField = (page: Page) => page.getByRole("spinbutton", { name: BUDGET_FIELD });
/** Scoped to `main`: the dev overlay owns an empty `role="alert"` of its own. */
const mainAlerts = (page: Page) => page.locator('main [role="alert"]');

test.describe("configurator", () => {
  test("renders the empty route without asking for a pass", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);
    await page.goto("/fr/configurateur");

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator("fieldset")).toHaveCount(2);
    await expect(page.getByRole("group", { name: "Usage principal" })).toBeVisible();
    await expect(page.getByRole("group", { name: BUDGET_FIELD })).toBeVisible();
    await expect(page.getByText("Aucune configuration chargée")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuer" })).toBeVisible();

    expect(detailCalls(stub)).toEqual([]);
    expectNoApiViolations(stub);
  });

  test("seeds a valid deep link without requesting a detail", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);
    await page.goto("/fr/configurateur?use_case=GAMING&budget=12000");

    await expect(page.getByRole("radio", { name: USAGE_GAMING })).toBeChecked();
    await expect(budgetField(page)).toHaveValue("12000");
    await expect(mainAlerts(page)).toHaveCount(0);

    expect(detailCalls(stub)).toEqual([]);
    expectNoApiViolations(stub);
  });

  test("keeps an invalid budget visible instead of clamping it", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);
    await page.goto("/fr/configurateur?use_case=GAMING&budget=12");

    await expect(page.getByRole("radio", { name: USAGE_GAMING })).toBeChecked();
    await expect(budgetField(page)).toHaveValue("12");
    await expect(page.getByText(RANGE_MESSAGE)).toBeVisible();
    // One summary announcement; the field error is linked, not a second alert.
    await expect(mainAlerts(page)).toHaveCount(1);

    expect(detailCalls(stub)).toEqual([]);
    expectNoApiViolations(stub);
  });

  test("marks an unknown use case and preserves the valid budget", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);
    await page.goto("/fr/configurateur?use_case=CONSOLE&budget=8000");

    await expect(page.getByText("Choisissez un usage pour continuer.")).toBeVisible();
    await expect(budgetField(page)).toHaveValue("8000");
    await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);

    expect(detailCalls(stub)).toEqual([]);
    expectNoApiViolations(stub);
  });

  test("renders the loaded pass, its components and both ranks", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);
    await page.goto(`/fr/configurateur?from=${FROM_ID}`);

    await expect(page.getByText(TOTAL_PATTERN)).toBeVisible();
    await expect(page.getByText("Prix indicatif", { exact: true })).toBeVisible();
    for (const name of COMPONENT_NAMES) {
      await expect(page.getByText(name)).toBeVisible();
    }
    await expect(page.getByText("Prix indicatifs, non actualisés.")).toBeVisible();

    const ranks = page.getByRole("button", { name: /^Configuration [12]$/ });
    await expect(ranks).toHaveCount(2);

    await page.getByRole("button", { name: "Configuration 2" }).click();
    await expect(page.getByText(money(SECOND_TOTAL))).toBeVisible();

    expect(detailCalls(stub)).toHaveLength(1);
    expectNoApiViolations(stub);
  });

  test("rejects a malformed link and issues no detail request", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);
    await page.goto("/fr/configurateur?from=rec-1");

    await expect(page.getByText("Ce lien de configuration est invalide.")).toBeVisible();
    await expect(page.getByRole("group", { name: "Usage principal" })).toBeVisible();
    await expect(budgetField(page)).toHaveValue("");

    await page.getByRole("radio", { name: USAGE_OFFICE }).check({ force: true });
    await expect(page.getByRole("radio", { name: USAGE_OFFICE })).toBeChecked();

    expect(detailCalls(stub)).toEqual([]);
    expectNoApiViolations(stub);
  });

  test("names a deleted pass and keeps the form usable", async ({ page }) => {
    const stub = await stubConfiguratorApi(page, { detailStatus: 404 });
    await page.goto(`/fr/configurateur?from=${FROM_ID}`);

    await expect(page.getByText("Configuration introuvable")).toBeVisible();
    await expect(page.getByRole("button", { name: "Réessayer" })).toHaveCount(0);

    await page.getByRole("radio", { name: USAGE_GAMING }).check({ force: true });
    await expect(page.getByRole("radio", { name: USAGE_GAMING })).toBeChecked();

    expectNoApiViolations(stub);
  });

  test("names a loaded pass that assembled nothing and shows its floor", async ({ page }) => {
    const stub = await stubConfiguratorApi(page, { zeroBuilds: true });
    await page.goto(`/fr/configurateur?from=${FROM_ID}`);

    // Loaded: the pass's own use case and budget are named, and its own state
    // is described — never "nothing is loaded".
    await expect(page.getByText(/Usage · Jeux vidéo & Gaming/)).toBeVisible();
    await expect(page.getByText(/Budget visé · 12\s?000\s?DH/)).toBeVisible();
    await expect(page.getByText("Aucun assemblage pour cette configuration")).toBeVisible();
    await expect(page.getByText(/Cette configuration a bien été chargée/)).toBeVisible();
    await expect(page.getByText("Aucune configuration chargée")).toHaveCount(0);

    // The floor is a diagnostic, not a build price: no total, no component list.
    await expect(page.getByText("Budget minimum estimé")).toBeVisible();
    await expect(page.getByText(money(FLOOR_TOTAL))).toBeVisible();
    await expect(page.getByText("Total indicatif")).toHaveCount(0);
    await expect(page.locator('[data-slot="build-summary"] dl')).toHaveCount(0);

    expectNoApiViolations(stub);
  });

  test("announces the pending detail, then renders the total", async ({ page }) => {
    const stub = await stubConfiguratorApi(page, { detailDelayMs: 800 });
    await page.goto(`/fr/configurateur?from=${FROM_ID}`);

    await expect(page.getByRole("status")).toHaveAttribute("aria-busy", "true");

    await expect(page.getByText(TOTAL_PATTERN)).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);

    expectNoApiViolations(stub);
  });

  test("recovers from a failing detail through one retry", async ({ page }) => {
    const stub = await stubConfiguratorApi(page, { detailStatus: 500 });
    await page.goto(`/fr/configurateur?from=${FROM_ID}`);

    await expect(page.getByText("La configuration n'a pas pu être chargée")).toBeVisible({
      timeout: 20_000,
    });
    const retry = page.getByRole("button", { name: "Réessayer" });
    await expect(retry).toBeVisible();

    stub.controls.detailStatus = null;
    await retry.click();

    await expect(page.getByText(TOTAL_PATTERN)).toBeVisible();
    expectNoApiViolations(stub);
  });

  test("continues into review, focuses the summary and makes no request", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);
    await page.goto("/fr/configurateur");
    const url = page.url();

    await page.getByRole("radio", { name: USAGE_OFFICE }).check({ force: true });
    await budgetField(page).fill("8000");
    await page.getByRole("button", { name: "Continuer" }).click();

    await expect(page.locator("#build-summary-title")).toBeFocused();
    await expect(page.getByRole("button", { name: "Mettre à jour" })).toBeVisible();
    // Exact: the summary's review copy opens with the same sentence.
    await expect(page.getByText("Vos réponses sont enregistrées.", { exact: true })).toBeVisible();
    expect(page.url()).toBe(url);

    expect(stub.calls).toEqual(["GET /v1/meta/options"]);
    expect(detailCalls(stub)).toEqual([]);
    expectNoApiViolations(stub);
  });

  test("serves the Arabic route in RTL with Arabic labels and currency", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);
    await page.goto(`/ar/configurateur?from=${FROM_ID}`);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("تكوينك، قطعة بقطعة");
    await expect(page.getByText("المعالج", { exact: true })).toBeVisible();
    await expect(
      page.getByText(new RegExp(`${money(FIRST_TOTAL).source}\\s?د\\.م\\.`)),
    ).toBeVisible();
    await expect(page.getByText("سعر إرشادي")).toBeVisible();

    expectNoApiViolations(stub);
  });

  test("preserves the answers across a locale switch", async ({ page }) => {
    const stub = await stubConfiguratorApi(page);
    await page.goto("/fr/configurateur?use_case=GAMING&budget=12000");

    const arabic = page.getByRole("link", { name: "Afficher en العربية" });
    await expect(arabic).toHaveAttribute("href", "/ar/configurateur?use_case=GAMING&budget=12000");

    await arabic.click();

    await expect(page).toHaveURL(/\/ar\/configurateur\?use_case=GAMING&budget=12000$/);
    await expect(page.getByRole("radio", { name: /الألعاب/ })).toBeChecked();
    await expect(page.getByRole("spinbutton")).toHaveValue("12000");

    expectNoApiViolations(stub);
  });

  test("clears both fixed bars at 360 px without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const stub = await stubConfiguratorApi(page);
    await page.goto(`/fr/configurateur?from=${FROM_ID}`);
    await expect(page.getByText(TOTAL_PATTERN)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const form = await page.locator("[data-slot=card]").first().boundingBox();
    const bar = await page.locator('[data-slot="build-summary"]').boundingBox();
    const navContent = await page.locator('nav[aria-label="Navigation mobile"] ul').boundingBox();

    expect(form).not.toBeNull();
    expect(bar).not.toBeNull();
    expect(navContent).not.toBeNull();
    if (form === null || bar === null || navContent === null) return;

    // The page reserves enough space that the last content ends above the bar,
    // and the bar stacks on the nav's content box (its 1 px top border is
    // deliberately covered, not overlapped).
    expect(form.y + form.height).toBeLessThanOrEqual(bar.y + 1);
    expect(bar.y + bar.height).toBeLessThanOrEqual(navContent.y + 1);

    expectNoApiViolations(stub);
  });

  test("puts the summary beside the form at 1024 instead of over it", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const stub = await stubConfiguratorApi(page);
    await page.goto(`/fr/configurateur?from=${FROM_ID}`);
    await expect(page.getByText(TOTAL_PATTERN)).toBeVisible();

    const panel = page.locator('[data-slot="build-summary"]');

    // Below `lg` the panel is a fixed bar above the mobile nav; at the boundary
    // it returns to the flow, so it can cover neither the form nor the nav.
    expect(await panel.evaluate((element) => getComputedStyle(element).position)).not.toBe("fixed");

    const bar = await panel.boundingBox();
    const form = await page.locator("[data-slot=card]").first().boundingBox();

    expect(bar).not.toBeNull();
    expect(form).not.toBeNull();
    if (bar === null || form === null) return;

    // Beside, not stacked: the panel starts past the form's end edge.
    expect(bar.x).toBeGreaterThanOrEqual(form.x + form.width - 1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    expectNoApiViolations(stub);
  });

  test("keeps one heading level, two labelled groups and 44 px targets", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const stub = await stubConfiguratorApi(page);
    await page.goto("/fr/configurateur");

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator("fieldset")).toHaveCount(2);
    await expect(page.locator("fieldset > legend")).toHaveCount(2);
    await expect(
      page.getByRole("heading", { level: 2, name: "Votre configuration" }),
    ).toBeVisible();

    const undersized = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          "main a[href], main button, main input:not(.sr-only), main select, main textarea",
        ),
      )
        .filter((element) => {
          const style = getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden") return false;
          if (element.getClientRects().length === 0) return false;
          const rect = element.getBoundingClientRect();
          return rect.width < 44 || rect.height < 44;
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return `${element.tagName} ${element.id || element.textContent?.trim().slice(0, 24)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
        }),
    );
    expect(undersized).toEqual([]);

    await page.goto("/fr/configurateur?from=rec-1");
    await expect(mainAlerts(page)).toHaveCount(1);

    expectNoApiViolations(stub);
  });

  test("gives the submit, the budget and the summary toggle 48 px on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const stub = await stubConfiguratorApi(page);
    await page.goto("/fr/configurateur");

    const sizes = await page.evaluate(() => {
      const measure = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (element === null) return null;
        const rect = element.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      };
      return {
        submit: measure("form button[type=submit]"),
        budget: measure("#configurator-budget"),
        toggle: measure('[data-slot="build-summary"] button[aria-expanded]'),
      };
    });

    for (const [name, size] of Object.entries(sizes)) {
      expect(size, name).not.toBeNull();
      if (size === null) continue;
      expect(size.height, name).toBeGreaterThanOrEqual(48);
    }

    expectNoApiViolations(stub);
  });
});
