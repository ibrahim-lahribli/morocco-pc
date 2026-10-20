/**
 * apps/web/e2e/wizard-budget.spec.ts — S8's proof.
 *
 * The budget is ONE answer with TWO controls, so every spec here is about the
 * relationship rather than a control: what the field keeps, what the thumb
 * shows, which of them wins, and what is said when a bound moves the number.
 *
 * The amounts are written with the app's own typography in the expectations —
 * U+202F between digit groups, U+00A0 before the unit — because `fr-MA` groups
 * with a full stop ("7.300"), which a French reader parses as a decimal. A spec
 * that accepted any whitespace would not notice that regression.
 */

import { test, expect, type Page } from "@playwright/test";

import { META_OPTIONS } from "../mock/fixtures.mjs";

const META_ROUTE = "**/v1/meta/options*";
const JSON_HEADERS = { "access-control-allow-origin": "*" };

const DH_7300 = "7\u202F300\u00A0DH";
const DH_7500 = "7\u202F500\u00A0DH";
const DH_500 = "500\u00A0DH";
const DH_MAX = "1\u202F000\u202F000\u00A0DH";

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

async function openBudgetStep(page: Page, query = ""): Promise<void> {
  await serveMeta(page);
  await page.goto(`/fr/configurer?etape=budget&use_case=GAMING${query}`);
}

/** Scroll the field into view, then read typed digits one at a time. */
async function typeAmount(page: Page, digits: string) {
  const field = page.getByLabel("Votre enveloppe cible");
  await field.fill("");
  await field.pressSequentially(digits);
  return field;
}

test("typing 7 300 keeps 7 300 exact while the thumb sits on the next 500 step", async ({
  page,
}) => {
  await openBudgetStep(page);

  const field = await typeAmount(page, "7300");
  const slider = page.getByRole("slider", { name: "Réglage rapide" });

  // The typed amount is the answer, character for character.
  await expect(field).toHaveValue("7300");
  await expect(page).toHaveURL(/budget_amount=7300(&|$)/);
  await expect(page.getByRole("button", { name: "Suivant" })).toBeEnabled();

  // The thumb cannot express 7 300, so it shows the step it would snap to — and
  // the note says so instead of letting the mismatch read as a bug.
  await expect(slider).toHaveValue("7500");
  await expect(slider).toHaveAttribute("aria-valuetext", DH_7500);
  await expect(page.getByText(/il s'arrête sur 7\u202F500\u00A0DH/)).toBeVisible();
  await expect(page.getByText(new RegExp(`${DH_7300} reste le montant retenu`))).toBeVisible();
});

test("a field below the minimum clamps to it on blur, and says which bound", async ({ page }) => {
  await openBudgetStep(page);

  const field = await typeAmount(page, "50");
  // While focused, nothing is rewritten under the caret.
  await expect(field).toHaveValue("50");
  await expect(field).not.toHaveAttribute("value", "500");

  await field.blur();

  await expect(field).toHaveValue("500");
  await expect(
    page.getByText(`Le minimum est ${DH_500} : le montant a été ramené à ${DH_500}.`),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Suivant" })).toBeEnabled();
  await expect(page).toHaveURL(/budget_amount=500(&|$)/);
});

test("a field above the maximum clamps to it on blur, and says which bound", async ({ page }) => {
  await openBudgetStep(page);

  const field = await typeAmount(page, "2000000");
  await field.blur();

  await expect(field).toHaveValue("1\u202F000\u202F000");
  await expect(
    page.getByText(`Le maximum est ${DH_MAX} : le montant a été ramené à ${DH_MAX}.`),
  ).toBeVisible();
  await expect(page).toHaveURL(/budget_amount=1000000(&|$)/);
});

test("the slider moves in 500s, reaches both ends, and writes into the field", async ({ page }) => {
  await openBudgetStep(page, "&budget_amount=7300");

  const field = page.getByLabel("Votre enveloppe cible");
  const slider = page.getByRole("slider", { name: "Réglage rapide" });

  // A deep link lands WITH the thumb already snapped, without rewriting the URL.
  await expect(slider).toHaveValue("7500");

  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("8000");
  await expect(field).toHaveValue("8\u202F000");
  await expect(page).toHaveURL(/budget_amount=8000(&|$)/);
  // The field is now on the grid, so the note has nothing to explain.
  await expect(page.getByText(/il s'arrête sur/)).toHaveCount(0);

  await slider.press("Home");
  await expect(slider).toHaveValue("500");
  await expect(slider).toHaveAttribute("aria-valuetext", DH_500);
  await expect(field).toHaveValue("500");

  await slider.press("End");
  await expect(slider).toHaveValue("1000000");
  await expect(slider).toHaveAttribute("aria-valuetext", DH_MAX);
  await expect(field).toHaveValue("1\u202F000\u202F000");
});

test("Enter settles an out-of-range amount, then advances on the next press", async ({ page }) => {
  await openBudgetStep(page);

  const field = await typeAmount(page, "50");
  await field.press("Enter");

  // The press that fixed the number does not ALSO jump a step: the guidance
  // would be read after it had already scrolled away.
  await expect(page).toHaveURL(/etape=budget/);
  await expect(field).toHaveValue("500");
  await expect(page.getByText(/Le minimum est/)).toBeVisible();

  // Wait for the settled answer to reach the flow before pressing again — the
  // commit is a navigation, and asserting the app's own promise (the step is now
  // answerable) is what makes the second press meaningful rather than a race.
  await expect(page).toHaveURL(/budget_amount=500(&|$)/);
  await expect(page.getByRole("button", { name: "Suivant" })).toBeEnabled();

  await field.press("Enter");
  await expect(page).toHaveURL(/etape=resolution/);
});

test("360 px, a 44 px slider, and a group named by the step's legend", async ({ page }) => {
  await openBudgetStep(page);

  await expect(page.getByRole("group", { name: "Quel budget visez-vous ?" })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const sliderBox = await page.getByRole("slider", { name: "Réglage rapide" }).boundingBox();
  expect(sliderBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(sliderBox?.width ?? 0).toBeGreaterThanOrEqual(280);

  const fieldBox = await page.getByLabel("Votre enveloppe cible").boundingBox();
  expect(fieldBox?.height ?? 0).toBeGreaterThanOrEqual(48);
});

test("/ar/configurer speaks Arabic about the same clamp", async ({ page }) => {
  await serveMeta(page);
  await page.goto("/ar/configurer?etape=budget&use_case=GAMING");

  const slider = page.getByRole("slider", { name: "ضبط سريع" });
  await expect(slider).toBeVisible();
  await expect(slider).toHaveAttribute("aria-valuetext", DH_500);

  const field = page.getByLabel("الميزانية المستهدفة");
  await field.fill("");
  await field.pressSequentially("10");
  await field.blur();

  await expect(page.getByText(/الحد الأدنى هو/)).toBeVisible();
  await expect(field).toHaveValue("500");
});
