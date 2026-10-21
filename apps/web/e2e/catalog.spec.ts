/**
 * apps/web/e2e/catalog.spec.ts — S17's proof for the component page.
 *
 * One spec per DoD scenario, plus the two claims the page makes in its header:
 *
 *   1. **It renders from the catalogue endpoint.** The h1, the category, the
 *      spec rows and the offer come from `GET /v1/catalog/products/:slug`; the
 *      assertions read the served HTML, so a client-side implementation would
 *      fail them.
 *   2. **An unknown slug is a 404**, not a crash and not a page with an empty
 *      body. This is also why the mock had to stop echoing any slug back.
 *   3. **A long name truncates instead of overflowing** at 360 px — the fixture's
 *      60-character SKU is the subject.
 *   4. **Indexability follows the prices**: verified indexable, seed or
 *      offer-less `noindex, follow`.
 *   5. **Appearances are real links** to preset pages, and they resolve.
 *   6. **No raw vocabulary**: no `VERIFIED`, no `SEED_UNVERIFIED`, no snake_case
 *      key and no UUID on the page — and a NULL spec is absent rather than "0 mm".
 */
import { test, expect } from "@playwright/test";

import { formatMoney } from "../lib/i18n/format";
import { CATALOG_PRODUCTS_BY_SLUG } from "../mock/fixtures.mjs";

const VERIFIED = "/fr/composants/rtx-4060-8gb";
/** No offer at all: a real catalogue page with nothing to price. */
const NO_OFFER = "/fr/composants/kit-ddr5-16-go";
/** A 60-character display name, and a NULL `height_mm`. */
const LONG_NAME = "/fr/composants/rtx-4060-ti-gaming-oc-16-go";

const VERIFIED_PRODUCT = CATALOG_PRODUCTS_BY_SLUG["rtx-4060-8gb"];
const LONG_NAME_PRODUCT = CATALOG_PRODUCTS_BY_SLUG["rtx-4060-ti-gaming-oc-16-go"];

test("the page renders the product the catalogue serves", async ({ page }) => {
  await page.goto(VERIFIED);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    VERIFIED_PRODUCT.display_name,
  );
  // The category is a word, never the contract's enum.
  await expect(page.locator("section > p").first()).toHaveText("Carte graphique");

  const specs = page.locator("dl > div");
  // Two facts the fixture carries, formatted with their units.
  await expect(specs.filter({ hasText: "Puissance (TGP)" })).toContainText("115 W");
  await expect(specs.filter({ hasText: "Longueur" })).toContainText("245 mm");
  // The offer, its price and its provenance word.
  const offers = page.getByRole("heading", { name: "Offres" }).locator("..");
  await expect(offers).toContainText(formatMoney(3200, "fr"));
  await expect(offers.getByText("Vérifié")).toBeVisible();
});

test("an unknown product is the locale's 404, not a crash", async ({ page }) => {
  for (const path of ["/fr/composants/pas-un-produit", "/ar/composants/pas-un-produit"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
      LONG_NAME_PRODUCT.display_name,
    );
  }
});

test("a long name wraps at 360 px instead of scrolling the page sideways", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(LONG_NAME);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    LONG_NAME_PRODUCT.display_name,
  );
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

test("indexability follows the prices, in both directions", async ({ request }) => {
  const verified = await (await request.get(VERIFIED)).text();
  expect(verified).not.toContain('content="noindex');

  // An all-seed offer is a demonstration, and a product with no offer has
  // nothing to vouch for: both stay out of the index, and both stay followable.
  for (const path of [NO_OFFER, LONG_NAME]) {
    const html = await (await request.get(path)).text();
    expect(html, path).toMatch(/<meta name="robots" content="[^"]*noindex/);
  }
});

test("appearances link to preset pages that answer 200", async ({ page, request }) => {
  await page.goto(VERIFIED);

  const section = page.getByRole("heading", { name: "Apparaît dans" }).locator("..");
  const links = section.getByRole("link");
  // The three-builds preset uses this GPU, so at least one appearance exists.
  await expect(links.first()).toBeVisible();

  const hrefs = await links.evaluateAll((anchors) =>
    anchors.map((anchor) => anchor.getAttribute("href") ?? ""),
  );
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    expect(href).toMatch(/^\/fr\/config-pc-gamer-\d+-dh$/);
    expect((await request.get(href)).status(), href).toBe(200);
  }
});

test("the page never prints an engine word, a key, a uuid or a fake zero", async ({ page }) => {
  await page.goto(LONG_NAME);
  const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");

  for (const vocabulary of ["SEED_UNVERIFIED", "VERIFIED", "GPU", "MEMORY"]) {
    expect(text).not.toContain(vocabulary);
  }
  // No raw spec key survives: every key the fixture serves has a label.
  expect(text).not.toMatch(/[a-z]+_[a-z]/);
  // No UUID: a foreign key is a reference, not a specification.
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
  // `height_mm` is NULL on this product, and NULL is UNKNOWN — never "0 mm".
  await expect(page.locator("dl > div").filter({ hasText: "Hauteur" })).toHaveCount(0);
  // The known facts are still there, so the omission above is not a blank page:
  // power, thickness, length, the PSU recommendation and the connector map.
  await expect(page.locator("dl > div")).toHaveCount(5);
});

test("a component page is ISR: it advertises the catalogue's revalidation window", async ({
  request,
}) => {
  const response = await request.get(VERIFIED);
  const cacheControl = response.headers()["cache-control"] ?? "";
  // The page's literal `revalidate` and `CATALOG_REVALIDATE_SECONDS` must agree.
  expect(cacheControl).toContain("s-maxage=3600");
  expect(cacheControl).not.toContain("no-store");
});
