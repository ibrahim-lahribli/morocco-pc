import { expect, test } from "@playwright/test";

import { stubHomepageApi } from "./support/homepage-api";
import { waitForSettledCards } from "./support/homepage-ready";

/**
 * The finder island on its own: two answers, one CTA.
 *
 * The radios are `sr-only` inside their label cards, so every selection is
 * `check({ force: true })` — the assertions that follow still read the rendered
 * result (checked state, the live status line, the CTA's enabled state), so the
 * forced click can never mask a broken wiring.
 *
 * The API is stubbed for every test: the submit must reach the cards section
 * without posting, and a real request would be a bug this spec would otherwise
 * report as a timeout.
 */
const BUDGET_PRESET_8000 = /Budget de 8\s?000\s?DH/;
const BUDGET_PRESET_12000 = /Budget de 12\s?000\s?DH/;
const USAGE_OFFICE = /Études et bureautique/;
const USAGE_GAMING = /Jeux vidéo & Gaming/;
const CTA = "Trouver mon PC";
const CUSTOM_ACTION = "Autre budget personnalisé";

test.describe("homepage finder", () => {
  test("keeps the call to action disabled until both answers are given", async ({ page }) => {
    await stubHomepageApi(page);
    await page.goto("/fr");

    const cta = page.getByRole("button", { name: CTA, exact: true });
    const budgetStatus = page.locator("#simulateur").getByRole("status");

    await expect(budgetStatus).toHaveText("À définir");
    await expect(cta).toBeDisabled();

    await page.getByRole("radio", { name: BUDGET_PRESET_8000 }).check({ force: true });
    await expect(budgetStatus).toHaveText(/8\s?000\s?DH/);
    await expect(cta).toBeDisabled();

    await page.getByRole("radio", { name: USAGE_OFFICE }).check({ force: true });
    await expect(cta).toBeEnabled();
  });

  test("takes the typed amount as the budget and rejects out-of-range values", async ({ page }) => {
    await stubHomepageApi(page);
    await page.goto("/fr");
    await waitForSettledCards(page);

    const cta = page.getByRole("button", { name: CTA, exact: true });
    const amount = page.getByRole("spinbutton", { name: "Budget exact en dirhams" });
    const budgetStatus = page.locator("#simulateur").getByRole("status");

    await page.getByRole("radio", { name: USAGE_GAMING }).check({ force: true });

    await page.getByRole("button", { name: CUSTOM_ACTION }).click();
    await amount.fill("1000");
    await expect(
      page.getByText(/Saisissez un budget entre 3\s?500 et 100\s?000\s?DH/),
    ).toBeVisible();
    await expect(budgetStatus).toHaveText("À définir");
    await expect(cta).toBeDisabled();

    await amount.fill("7000");
    await expect(page.getByText(/Saisissez un budget entre 3\s?500 et 100\s?000\s?DH/)).toHaveCount(
      0,
    );
    await expect(budgetStatus).toHaveText(/7\s?000\s?DH/);
    await expect(cta).toBeEnabled();
  });

  test("keeps exactly one budget answer", async ({ page }) => {
    await stubHomepageApi(page);
    await page.goto("/fr");

    const amount = page.getByRole("spinbutton", { name: "Budget exact en dirhams" });
    const preset8000 = page.getByRole("radio", { name: BUDGET_PRESET_8000 });
    const preset12000 = page.getByRole("radio", { name: BUDGET_PRESET_12000 });
    const budgetStatus = page.locator("#simulateur").getByRole("status");

    await page.getByRole("button", { name: CUSTOM_ACTION }).click();

    // A preset clears the typed text…
    await amount.fill("7000");
    await preset12000.check({ force: true });
    await expect(amount).toHaveValue("");
    await expect(preset12000).toBeChecked();
    await expect(budgetStatus).toHaveText(/12\s?000\s?DH/);

    // …and typing drops the preset.
    await amount.fill("9000");
    await expect(preset12000).not.toBeChecked();
    await expect(preset8000).not.toBeChecked();
    await expect(budgetStatus).toHaveText(/9\s?000\s?DH/);
  });

  test("renders no resolution shortcut tile at any breakpoint", async ({ page }) => {
    await stubHomepageApi(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr");
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
    await expect(page.getByText(/1080p|1440p/)).toHaveCount(0);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByText(/1080p|1440p/)).toHaveCount(0);
  });

  test("hands the answers to the configurator and never posts", async ({ page }) => {
    const { posts } = await stubHomepageApi(page);
    await page.goto("/fr");

    await page.getByRole("radio", { name: BUDGET_PRESET_8000 }).check({ force: true });
    await page.getByRole("radio", { name: USAGE_OFFICE }).check({ force: true });

    await page.getByRole("button", { name: CTA, exact: true }).click();

    // One URL contract: the two answers become query params, and the destination
    // parses them back into its own radio and budget field rather than
    // re-asking. The swap is a GET, so nothing is posted along the way.
    await expect(page).toHaveURL(/\/fr\/configurateur\?use_case=OFFICE&budget=8000$/);
    await expect(page.getByRole("radio", { name: /Études et bureautique/ })).toBeChecked();
    await expect(page.getByRole("spinbutton", { name: "Budget (DH)" })).toHaveValue("8000");
    expect(posts).toEqual([]);
  });
});

test.describe("homepage finder composition", () => {
  test("starts on the budget question without the desktop simulator header", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/fr");

    const section = page.locator("#simulateur");
    await expect(section.getByText("Simulateur Express")).toBeHidden();
    await expect(section.getByText("Étape 1 sur 2")).toBeHidden();

    await page.setViewportSize({ width: 1280, height: 900 });

    await expect(section.getByText("Simulateur Express")).toBeVisible();
    await expect(section.getByText("Étape 1 sur 2")).toBeVisible();
  });

  test("keeps the chosen amount on the Step 1 heading row", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/fr");

    const status = page.locator("#finder-budget legend [role='status']");
    await expect(status).toHaveCount(1);
    await expect(page.locator("#finder-budget > p[role='status']")).toHaveCount(0);

    await page.getByRole("radio", { name: BUDGET_PRESET_8000 }).check({ force: true });
    await expect(status).toHaveText(/8\s?000\s?DH/);

    const heading = page.locator("#finder-budget legend");
    const headingBox = await heading.boundingBox();
    const statusBox = await status.boundingBox();
    expect(Math.abs(statusBox!.y - headingBox!.y)).toBeLessThan(12);
  });

  test("reveals and focuses the custom budget from its compact action", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/fr");

    const action = page.getByRole("button", { name: CUSTOM_ACTION });
    await expect(action).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("spinbutton", { name: "Budget exact en dirhams" })).toHaveCount(0);

    await action.click();

    const amount = page.getByRole("spinbutton", { name: "Budget exact en dirhams" });
    await expect(amount).toBeVisible();
    await expect(amount).toBeFocused();
    await expect(action).toHaveAttribute("aria-expanded", "true");
  });
});
