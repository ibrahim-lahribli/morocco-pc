/**
 * apps/web/e2e/explanation.spec.ts — S13's proof, in a browser.
 *
 * Two states, and the page must not confuse them:
 *
 *   - `reasons[]` ABSENT (every id but one, because CD-2 is not served yet) →
 *     the panel renders the committed `explanation` string verbatim. That string
 *     is Engine 6's recorded text; paraphrasing or improving it here would be a
 *     second explanation, which is exactly what V4 warns about.
 *   - `reasons[]` PRESENT (the mock's `withReasons` id, a PROVISIONAL shape) →
 *     one catalogue line per reason, in the engine's order, plus one generic
 *     line for the code this client does not know. No raw code, no raw enum.
 *
 * The disclosure is a NATIVE `<details>`: collapsed on the server, and its state
 * lives in the element, not in React. So the specs assert the DOM's `open`
 * attribute and real keyboard operation (Enter and Space on the focused
 * `<summary>`), rather than a class name or a client-side boolean.
 */

import { test, expect, type Page } from "@playwright/test";

import { formatPercent } from "../lib/i18n/format";
import {
  IDS,
  RECOMMENDATION_THREE_BUILDS,
  RECOMMENDATION_WITH_REASONS,
} from "../mock/fixtures.mjs";

const THREE = `/fr/config/${IDS.threeBuilds}`;
const WITH_REASONS = `/fr/config/${IDS.withReasons}`;

/** The first build card's disclosure. */
function disclosure(page: Page) {
  return page.locator("article").first().locator("details");
}

test("without reasons the panel is the explanation, collapsed until opened", async ({ page }) => {
  await page.goto(THREE);
  const details = disclosure(page);

  // Collapsed in the SERVER's HTML: no `open`, so the content is not rendered.
  expect(await details.getAttribute("open")).toBeNull();
  await expect(details.locator("summary")).toHaveText("Pourquoi ce choix");
  await expect(details.locator("p")).toBeHidden();

  await details.locator("summary").click();
  expect(await details.getAttribute("open")).not.toBeNull();
  // Verbatim, not paraphrased: the same string the fixture's API body carries.
  await expect(details.locator("p")).toHaveText(RECOMMENDATION_THREE_BUILDS.builds[0].explanation);
});

test("with reasons the panel renders one mapped line per code, in order", async ({ page }) => {
  await page.goto(WITH_REASONS);
  const details = disclosure(page);
  await details.locator("summary").click();

  const items = details.locator("li");
  await expect(items).toHaveCount(9);

  await expect(items.nth(0)).toHaveText("Profil retenu : Équilibré.");
  await expect(items.nth(1)).toHaveText(
    `${formatPercent(57.29333333333334 / 100, "fr")} du budget utilisé.`,
  );
  await expect(items.nth(2)).toHaveText(
    `La carte graphique pèse ${formatPercent(0.3723, "fr")} du prix.`,
  );
  await expect(items.nth(3)).toHaveText("Poste le plus contributif : Carte graphique.");
  await expect(items.nth(4)).toHaveText("Mise à jour du BIOS requise : 1.2.3.");
  await expect(items.nth(5)).toHaveText("Caractéristiques non vérifiées : Refroidissement.");
  await expect(items.nth(6)).toHaveText(
    "Les réglages de la recherche (usage, résolution, priorité) ont été pris en compte.",
  );
  await expect(items.nth(7)).toHaveText(
    "Le catalogue ne contenait pas assez de profils distincts pour varier davantage.",
  );

  // ONE story, not two: when reasons are served the recorded prose is not also
  // printed beside them.
  await expect(details).not.toContainText(RECOMMENDATION_WITH_REASONS.builds[0].explanation);
});

test("an unknown code is one generic sentence and never reaches the screen raw", async ({
  page,
}) => {
  await page.goto(WITH_REASONS);
  const details = disclosure(page);
  await details.locator("summary").click();

  await expect(details.getByText("Un autre facteur a pesé sur ce choix.")).toHaveCount(1);
  await expect(details.locator("li")).toHaveCount(9);

  const text = await page.locator("main").innerText();
  for (const code of [
    "FUTURE_REASON",
    "LIMITED_CATALOG",
    "BUDGET_USED_PCT",
    "GPU_SHARE",
    "UNKNOWN_SPEC",
    "FEWER_THAN_THREE",
  ]) {
    expect(text, code).not.toContain(code);
  }
});

test("the disclosure opens with Enter and closes with Space", async ({ page }) => {
  await page.goto(THREE);
  const details = disclosure(page);
  const summary = details.locator("summary");

  // A `<summary>` is focusable natively; no tabIndex was added to make it so.
  await summary.focus();
  await expect(summary).toBeFocused();

  await page.keyboard.press("Enter");
  expect(await details.getAttribute("open")).not.toBeNull();
  await expect(details.locator("p")).toBeVisible();

  await page.keyboard.press("Space");
  expect(await details.getAttribute("open")).toBeNull();
  await expect(details.locator("p")).toBeHidden();
});

test("the Arabic panel says the same thing", async ({ page }) => {
  await page.goto(`/ar/config/${IDS.withReasons}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  const details = disclosure(page);
  await expect(details.locator("summary")).toHaveText("لماذا هذا الاختيار");
  await details.locator("summary").click();

  const items = details.locator("li");
  await expect(items).toHaveCount(9);
  await expect(items.nth(0)).toContainText("متوازن");
  await expect(items.nth(3)).toContainText("بطاقة الرسوميات");
});
