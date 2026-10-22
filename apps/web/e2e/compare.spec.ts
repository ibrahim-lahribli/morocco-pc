/**
 * apps/web/e2e/compare.spec.ts — S23's proof for the compare view.
 *
 * One spec per DoD scenario, plus the claims the route's header makes:
 *
 *   1. **The URL is the selection.** Two slugs render two columns, and a reload
 *      of the same URL renders the same comparison — no cookie, no store.
 *   2. **It is a real table**, with a caption, `scope="col"` headers and a
 *      `scope="row"` header per fact. A grid of divs would fail these.
 *   3. **A difference is TEXT.** The marker says "Diffère" and the summary counts
 *      the rows; neither relies on colour.
 *   4. **360 px stacks, wide screens do not.** Asserted as GEOMETRY: the value
 *      cells share one inline start in the stack and sit side by side at 1280.
 *   5. **Every control is a link**, so removing a column is a keyboard
 *      activation rather than a click handler.
 *   6. **The wrong selections are answered in words**: a repeated slug, a fourth
 *      slug, an unknown slug, and two categories that cannot be compared.
 *   7. **The page stays out of the index** and names the ROUTE in its canonical,
 *      never the selection.
 */
import { test, expect } from "@playwright/test";

import { formatMoney } from "../lib/i18n/format";
import { CATALOG_PRODUCTS_BY_SLUG } from "../mock/fixtures.mjs";

const ORIGIN = "http://localhost:3210";

const A = "rtx-4060-8gb";
const B = "rtx-4070-12gb";
/** The 60-character SKU, a GPU too — used only for the three-column cap. */
const C = "rtx-4060-ti-gaming-oc-16-go";
/** A RAM kit: no offer, and a DIFFERENT category from the two GPUs. */
const RAM = "kit-ddr5-16-go";

const A_PRODUCT = CATALOG_PRODUCTS_BY_SLUG[A];
const B_PRODUCT = CATALOG_PRODUCTS_BY_SLUG[B];

const COMPARE = `/fr/composants/comparer?slugs=${A},${B}`;
const AR_COMPARE = `/ar/composants/comparer?slugs=${A},${B}`;

/**
 * The counts the table must report, derived from the fixtures rather than
 * hardcoded: a fixture that grows a spec should move this spec, not break it.
 * Two values are equal only when their PRINTED text would be, which is why the
 * comparison is over strings.
 */
const SPEC_KEYS = [...new Set([...Object.keys(A_PRODUCT.specs), ...Object.keys(B_PRODUCT.specs)])];
const DIFFERENT = SPEC_KEYS.filter(
  (key) =>
    String((A_PRODUCT.specs as Record<string, unknown>)[key]) !==
    String((B_PRODUCT.specs as Record<string, unknown>)[key]),
).length;
const SAME = SPEC_KEYS.length - DIFFERENT;

test("the URL is the whole selection, and reloading it renders the same view", async ({ page }) => {
  await page.goto(COMPARE);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Comparer des composants");
  const table = page.getByRole("table");
  await expect(table).toBeVisible();

  const headers = table.locator('th[scope="col"]');
  await expect(headers).toHaveText(["Caractéristique", A_PRODUCT.display_name, B_PRODUCT.display_name]);

  // A reload is a fresh request with the same URL: nothing was remembered.
  await page.reload();
  await expect(table).toBeVisible();
  await expect(table.locator('th[scope="col"]')).toHaveText([
    "Caractéristique",
    A_PRODUCT.display_name,
    B_PRODUCT.display_name,
  ]);
  await expect(page.getByRole("table")).toHaveCount(1);
});

test("the comparison is a real table: caption, column headers and a row header per fact", async ({
  page,
}) => {
  await page.goto(COMPARE);
  const table = page.getByRole("table");

  // The caption is read before the rows even though it is visually hidden.
  await expect(table.locator("caption")).toHaveText("Comparaison de 2 composants");

  // One column header per product, plus the spec column.
  await expect(table.locator('th[scope="col"]')).toHaveCount(3);
  // One row header per FACT, and two value cells beside each.
  await expect(table.locator('th[scope="row"]')).toHaveCount(SPEC_KEYS.length);
  await expect(page.getByRole("cell")).toHaveCount(SPEC_KEYS.length * 2);
});

test("a difference carries a word and a count, not just a colour", async ({ page }) => {
  await page.goto(COMPARE);
  const table = page.getByRole("table");

  // The summary counts what the rows mark.
  await expect(page.getByText(`Écarts : ${DIFFERENT} sur ${SPEC_KEYS.length}. Identiques : ${SAME}.`)).toBeVisible();

  // Every differing row header says so; every identical row stays unmarked.
  const marked = table.locator('th[scope="row"]').filter({ hasText: "Diffère" });
  await expect(marked).toHaveCount(DIFFERENT);

  // `width_slots` is the shared fact: 2 on both products.
  const shared = table.locator('th[scope="row"]').filter({ hasText: "Épaisseur" });
  await expect(shared).not.toContainText("Diffère");
  await expect(shared.locator("..")).toContainText("2 emplacements");
});

test("360 px stacks the rows; 1280 px lays them out as columns", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(COMPARE);

  const cells = page.getByRole("cell");
  const first = (await cells.nth(0).boundingBox())!;
  const second = (await cells.nth(1).boundingBox())!;

  // Stacked: both values of one row start at the same inline start and fill it.
  expect(Math.abs(second.x - first.x)).toBeLessThanOrEqual(1);
  expect(first.width).toBeGreaterThan(200);
  // The fallback is not the table collapsed — the per-value label is painted.
  await expect(cells.nth(0).getByText(A_PRODUCT.display_name)).toBeVisible();
  // And stacking does not scroll the page sideways.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();

  const wideFirst = (await cells.nth(0).boundingBox())!;
  const wideSecond = (await cells.nth(1).boundingBox())!;
  expect(wideSecond.x).toBeGreaterThan(wideFirst.x + 20);
  // At wide widths the column header names the value, so the per-cell label is
  // gone from the accessibility tree too — not merely invisible.
  await expect(cells.nth(0).getByText(A_PRODUCT.display_name)).toBeHidden();
});

test("removing a column is a link, operable with Enter", async ({ page }) => {
  await page.goto(COMPARE);

  const remove = page.getByRole("link", { name: `Retirer ${B_PRODUCT.display_name}` });
  await expect(remove).toHaveAttribute("href", `/fr/composants/comparer?slugs=${A}`);

  await remove.focus();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(new RegExp(`/fr/composants/comparer\\?slugs=${A}$`));
  await expect(page.getByText("Ajoutez un deuxième composant")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("the wrong selections are answered in words", async ({ page }) => {
  // Two categories cannot be compared: the page says why and draws no table.
  await page.goto(`/fr/composants/comparer?slugs=${A},${RAM}`);
  await expect(page.getByText(/pas de la même catégorie/)).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);

  // A repeated slug is shown once, and said so.
  await page.goto(`/fr/composants/comparer?slugs=${A},${A}`);
  await expect(page.getByText(/figurait deux fois/)).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);

  // An unknown slug is dropped; the product that DOES exist still renders.
  await page.goto(`/fr/composants/comparer?slugs=${A},pas-un-produit`);
  await expect(page.getByText(/n’existe pas dans le catalogue/)).toBeVisible();
  await expect(page.getByText("Ajoutez un deuxième composant")).toBeVisible();

  // A fourth slug is not a fourth column.
  await page.goto(`/fr/composants/comparer?slugs=${A},${B},${C},${RAM}`);
  await expect(page.getByText(/Trois composants au maximum/)).toBeVisible();
  await expect(page.getByRole("table").locator('th[scope="col"]')).toHaveCount(4);
});

test("Arabic mirrors the columns without reversing the reading order", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(AR_COMPARE);

  const headers = page.getByRole("table").locator('th[scope="col"]');
  // DOM order is unchanged: the spec column, then A, then B.
  const texts = await headers.allTextContents();
  expect(texts[1]).toBe(A_PRODUCT.display_name);
  expect(texts[2]).toBe(B_PRODUCT.display_name);

  // RTL lays the first column at the inline START, which is the right edge.
  const a = (await headers.nth(1).boundingBox())!;
  const b = (await headers.nth(2).boundingBox())!;
  expect(a.x).toBeGreaterThan(b.x);
  // The marker is Arabic too, and the price is a DH amount on both sides.
  await expect(page.getByText("مختلف").first()).toBeVisible();
  await expect(page.getByText(formatMoney(3200, "ar")).first()).toBeVisible();
});

test("the compare page stays out of the index and canonicals the route", async ({ request }) => {
  const response = await request.get(COMPARE);
  expect(response.status()).toBe(200);
  const html = await response.text();

  expect(html).toMatch(/<meta name="robots" content="[^"]*noindex/);
  const canonical = /<link\b[^>]*\brel="canonical"[^>]*>/.exec(html)?.[0] ?? "";
  const href = /href="([^"]+)"/.exec(canonical)?.[1];
  // The ROUTE, not the selection: two selections are not two pages.
  expect(href).toBe(`${ORIGIN}/fr/composants/comparer`);
});

test("a component page offers comparisons with its own category, and they resolve", async ({
  page,
  request,
}) => {
  await page.goto(`/fr/composants/${A}`);

  const section = page
    .getByRole("heading", { name: "Comparer des composants", level: 2 })
    .locator("..");
  const link = section.getByRole("link", { name: `Avec ${B_PRODUCT.display_name}` });
  await expect(link).toHaveAttribute(
    "href",
    `/fr/composants/comparer?slugs=${A},${B}`,
  );
  expect((await request.get(`/fr/composants/comparer?slugs=${A},${B}`)).status()).toBe(200);

  // A one-product comparison is a starting point, not an error.
  const open = section.getByRole("link", { name: "Ouvrir la comparaison" });
  await expect(open).toHaveAttribute("href", `/fr/composants/comparer?slugs=${A}`);
});

test("the page never prints an engine word, a raw spec key or a fake zero", async ({ page }) => {
  await page.goto(COMPARE);
  const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");

  for (const vocabulary of ["SEED_UNVERIFIED", "VERIFIED", "GPU", "MEMORY"]) {
    expect(text).not.toContain(vocabulary);
  }
  expect(text).not.toMatch(/[a-z]+_[a-z]/);
  // `recommended_psu_watts` exists on B only: its absence on A is a WORD, never
  // "0 W" and never a dash.
  await expect(page.getByText("Non renseigné").first()).toBeVisible();
  expect(text).not.toMatch(/0 W/);
});
