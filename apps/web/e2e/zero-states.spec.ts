/**
 * apps/web/e2e/zero-states.spec.ts — S14's proof: the zero-build copy follows
 * the floor, and the reader is never shown a number nobody priced.
 *
 * The four sprint scenarios, each on its own fixture id (the results page is
 * server-rendered, so the ID IN THE URL is still the state selector):
 *
 *   1. a POST zero-build with EVERY role priced  -> the floor advice, number
 *      and caveat, in the shared Alert primitive;
 *   2. a GET revisit with NO floor object (CD-7 gap) -> the generic
 *      "budget insuffisant" copy, and no invented number;
 *   3. a floor whose `cheapest_total` is NULL (missing roles) -> guidance
 *      only, never a 0;
 *   4. a 429 read -> the API's `Retry-After` seconds, in the same primitive
 *      as the 503 retry, and a way out that a keyboard can operate.
 *
 * The model half runs without a browser: the copy decision lives in
 * `lib/result/model.ts`, so the narrowing is tested against the REAL fixtures
 * the mock serves, plus the single-value shapes a future API could send.
 */

import { test, expect, type Page } from "@playwright/test";

import { formatMoney } from "../lib/i18n/format";
import { zeroBuildAdvice } from "../lib/result/model";
import {
  IDS,
  RECOMMENDATION_THREE_BUILDS,
  RECOMMENDATION_ZERO_BUILD,
  RECOMMENDATION_ZERO_BUILD_FLOOR_ABSENT,
  RECOMMENDATION_ZERO_BUILD_NO_FLOOR,
} from "../mock/fixtures.mjs";

const money = (amount: number) => formatMoney(amount, "fr");

const ZERO = `/fr/config/${IDS.zeroBuild}`;
const ZERO_NO_FLOOR = `/fr/config/${IDS.zeroBuildNoFloor}`;
const ZERO_FLOOR_ABSENT = `/fr/config/${IDS.zeroBuildFloorAbsent}`;
const RATE_LIMITED = `/fr/config/${IDS.rateLimited}`;

/** The page's visible text, with scripts stripped (Next inlines its payload there). */
async function visibleText(page: Page): Promise<string> {
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// The decision, against the fixtures the mock actually serves
// ---------------------------------------------------------------------------

test("the three zero-build floors are the three copy states (and nothing else)", () => {
  // A priced floor carries its number for the advice sentence.
  expect(zeroBuildAdvice(RECOMMENDATION_ZERO_BUILD.budget_floor)).toEqual({
    kind: "floor",
    cheapestTotal: 4477,
  });
  // A floor with a role missing is guidance WITHOUT a number -- never a 0.
  expect(zeroBuildAdvice(RECOMMENDATION_ZERO_BUILD_NO_FLOOR.budget_floor)).toEqual({
    kind: "unknown-floor",
  });
  // A floor the response does not carry at all is the generic state.
  expect(zeroBuildAdvice(RECOMMENDATION_ZERO_BUILD_FLOOR_ABSENT.budget_floor)).toEqual({
    kind: "no-floor",
  });
  // A pass with builds is NOT a zero-build state, but the function stays total.
  expect(zeroBuildAdvice(RECOMMENDATION_THREE_BUILDS.budget_floor)).toEqual({
    kind: "floor",
    cheapestTotal: 4477,
  });
});

test("a 0, negative or non-finite cheapest_total is UNKNOWN, never free (NULL != 0)", () => {
  const floor = RECOMMENDATION_ZERO_BUILD.budget_floor;
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(
      zeroBuildAdvice({
        ...floor,
        cheapest_total: value,
      }).kind,
    ).toBe("unknown-floor");
  }
});

// ---------------------------------------------------------------------------
// Scenario 1 -- floor present: the number and the caveat, in the primitive
// ---------------------------------------------------------------------------

test("a zero-build with a priced floor shows the advice, the caveat and no invented 0", async ({
  page,
}) => {
  await page.goto(ZERO);

  // Scoped by name: contract v1.7 adds the input-effects block, which is a
  // second level-2 section on this page.
  await expect(
    page.getByRole("heading", { level: 2, name: "Aucune configuration pour ce budget" }),
  ).toHaveText("Aucune configuration pour ce budget");
  await expect(page.locator("article")).toHaveCount(0);

  // The advice is the RECORDED floor, formatted by the helper...
  await expect(page.getByText(`Budget minimum conseillé : ${money(4477)}.`)).toBeVisible();
  // ...and the caveat says what the number is: a lower bound, not a build.
  await expect(page.getByText(/Estimation minimale, non garantie/)).toBeVisible();

  const alert = page
    .locator("[data-tone='warning']")
    .filter({ hasText: "Budget minimum conseillé" });
  await expect(alert).toHaveCount(1);

  // The standing lie this state exists to prevent: there is no "0 DH" anywhere,
  // and the floor number is the only amount the state advertises. innerText
  // normalizes the narrow no-break space formatMoney groups with, so BOTH sides
  // are compared with the locator-level normalization the visible sentence uses.
  const text = await visibleText(page);
  const flat = (value: string) => value.replace(/[  ]/g, " ");
  // "6 000 DH" contains the SUBSTRING "0 DH", so the no-zero check is a
  // regex whose guard forbids a digit before the 0.
  expect(flat(text)).not.toMatch(/[^0-9]0\s*DH/);
  expect(flat(text)).toContain(flat(money(4477)));
});

// ---------------------------------------------------------------------------
// Scenario 3 -- cheapest_total NULL: guidance only, and "0 DH" nowhere
// ---------------------------------------------------------------------------

test("a floor that could not be priced shows guidance and never a number", async ({ page }) => {
  await page.goto(ZERO_NO_FLOOR);

  const alert = page.locator("[data-tone='warning']");
  await expect(alert).toHaveCount(1);
  await expect(alert).toContainText(/Aucun plancher n'a pu être établi/);

  const text = await visibleText(page);
  // The advice sentence exists only where a floor was priced.
  expect(text).not.toContain("Budget minimum conseillé");
  // missing_roles exists on this floor; the page does not print enum vocab (V5).
  expect(text).not.toContain("missing_roles");
  expect(text).not.toMatch(/[^0-9]0\s*DH/);
});

// ---------------------------------------------------------------------------
// Scenario 2 -- floor absent: generic copy, and nothing invented for it
// ---------------------------------------------------------------------------

test("a GET revisit with no floor shows the generic copy and invents no number", async ({
  page,
}) => {
  await page.goto(ZERO_FLOOR_ABSENT);

  await expect(page.locator("[data-tone='warning']")).toContainText(
    "Budget insuffisant : aucune configuration n'a pu être assemblée.",
  );

  // The regression the sprint asks for: NO floor number is invented for a
  // field the response does not carry.
  const text = await visibleText(page);
  expect(text).not.toContain("Budget minimum conseillé");
  expect(text).not.toContain(money(4477));
  expect(text).not.toMatch(/[^0-9]0\s*DH/);

  // The way back still carries the answers this pass was made with.
  const href = await page.getByRole("link", { name: "Modifier mon budget" }).getAttribute("href");
  expect(href).toContain("/fr/configurer?");
  expect(href).toContain("etape=budget");
  expect(href).toContain("budget_amount=4000");
  expect(href).toContain("use_case=GAMING");
});

// ---------------------------------------------------------------------------
// Scenario 4 -- a 429 read: the API's seconds, the same primitive, keyboard-operable
// ---------------------------------------------------------------------------

test("a 429 read renders the Retry-After seconds in the error state, and the retry is keyboard reachable", async ({
  page,
}) => {
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(request.url());
  });

  await page.goto(RATE_LIMITED);
  expect(documents).toHaveLength(1);

  // Same heading as every unavailable read; the Alert's text is what differs.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Configuration indisponible");
  // The client parsed `Retry-After: 30` into the state; the sentence says 30,
  // formatted by Intl, not by a template string in a component. The countdown
  // is the API's fact, statically rendered: a server component has no client
  // timer, and no ticking number is invented.
  const alert = page.getByRole("alert").filter({ hasText: "Trop de demandes en peu de temps" });
  await expect(alert).toHaveCount(1);
  await expect(alert).toContainText("Réessayez dans 30 s");

  // Keyboard reachable: focus the retry link, press Enter -- a second document
  // navigation, exactly like the 503 path (which result.spec.ts pins).
  const retry = page.getByRole("link", { name: "Réessayer" });
  await retry.focus();
  await expect(retry).toBeFocused();
  await page.keyboard.press("Enter");
  await page.waitForLoadState();
  expect(documents).toHaveLength(2);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Configuration indisponible");
});
