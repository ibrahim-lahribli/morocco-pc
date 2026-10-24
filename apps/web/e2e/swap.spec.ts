/**
 * apps/web/e2e/swap.spec.ts — S24's buildable half, in a browser.
 *
 * The subject is the SWAP CONTROL, and the thing worth proving is what it does
 * NOT do. CD-8 (a swap endpoint) does not exist, so the sprint's own definition
 * of done asks for the honest future state: a control that is present, disabled,
 * explained, and that fires nothing. A spec that only asserted "a button exists"
 * would pass over a control that quietly POSTed a simulated swap.
 *
 * Three facts, four tests (the first is mirrored for Arabic, because the copy is
 * part of what the control promises):
 *
 *   1. It is a real disabled button, labelled in the page's own language, and
 *      its explanation is VISIBLE text tied to it by `aria-describedby`. A
 *      hover-only tooltip was rejected: a disabled button cannot take focus, so
 *      a tooltip on it is unreachable by keyboard and by touch at 360 px.
 *   2. EVERY card carries one. Swapping belongs to a build, not to rank 1, and
 *      the results page renders one card per build (V13).
 *   3. Activating it is inert: no `/v1/` request, no non-GET request, no
 *      navigation, the same builds. The page arrives server-rendered, so any
 *      request observed here could only have come from the control itself.
 *
 * The fixture is reached by the Next process (`API_BASE_URL` → the mock), so the
 * ID in the URL selects the state — the same arrangement `result.spec.ts` uses.
 */

import { test, expect, type Page } from "@playwright/test";

import { IDS } from "../mock/fixtures.mjs";

const THREE = `/fr/config/${IDS.threeBuilds}`;
const THREE_AR = `/ar/config/${IDS.threeBuilds}`;

const FR_LABEL = "Remplacer un composant";
const AR_LABEL = "استبدال مكوّن";
const FR_EXPLANATION =
  "Bientôt disponible : remplacer une pièce demandera de recalculer sa compatibilité avec le reste de la configuration et son prix.";
const AR_EXPLANATION =
  "سيتوفر قريبًا: استبدال قطعة سيتطلب إعادة حساب توافقها مع بقية التجميعة وسعرها.";

/** The first card's control — the card every other results spec measures too. */
function firstSwapControl(page: Page) {
  return page.locator("article").first().getByRole("button", { name: FR_LABEL });
}

test("the swap control is present, disabled and explained in French", async ({ page }) => {
  await page.goto(THREE);

  const control = firstSwapControl(page);
  await expect(control).toBeVisible();
  await expect(control).toBeDisabled();
  // The state is data, not a class name: the change that lands with CD-8 flips it.
  await expect(control).toHaveAttribute("data-swap", "unavailable");

  // The explanation is tied to the control, not merely near it: read the
  // relation from the DOM and resolve it, so re-pointing the id fails here.
  const describedBy = await control.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  const note = page.locator(`#${describedBy}`);
  await expect(note).toBeVisible();
  await expect(note).toHaveText(FR_EXPLANATION);
});

test("every build carries the control — it is not a rank-1 affordance", async ({ page }) => {
  await page.goto(THREE);

  const cards = page.locator("article");
  await expect(cards).toHaveCount(3);
  await expect(page.getByRole("button", { name: FR_LABEL })).toHaveCount(3);

  for (const card of await cards.all()) {
    await expect(card.getByRole("button", { name: FR_LABEL })).toBeDisabled();
  }
});

test("activating it fires no request and changes nothing", async ({ page }) => {
  const apiCalls: string[] = [];
  const writes: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/v1/")) apiCalls.push(pathname);
    if (request.method() !== "GET") writes.push(`${request.method()} ${pathname}`);
  });

  await page.goto(THREE);
  await expect(page.locator("article")).toHaveCount(3);

  // `force` skips Playwright's actionability wait so the BROWSER, not the test
  // runner, is what refuses the activation. A disabled control dispatches no
  // click, and the component has no handler to dispatch it to.
  await firstSwapControl(page).click({ force: true });
  await page.waitForTimeout(500);

  expect(apiCalls).toEqual([]);
  expect(writes).toEqual([]);
  await expect(page).toHaveURL(new RegExp(`/fr/config/${IDS.threeBuilds}$`));
  await expect(page.locator("article")).toHaveCount(3);
});

test("the Arabic card carries the same control, translated", async ({ page }) => {
  await page.goto(THREE_AR);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  const control = page.locator("article").first().getByRole("button", { name: AR_LABEL });
  await expect(control).toBeVisible();
  await expect(control).toBeDisabled();
  await expect(control).toHaveAttribute("data-swap", "unavailable");

  const describedBy = await control.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  const note = page.locator(`#${describedBy}`);
  await expect(note).toBeVisible();
  await expect(note).toHaveText(AR_EXPLANATION);
});
