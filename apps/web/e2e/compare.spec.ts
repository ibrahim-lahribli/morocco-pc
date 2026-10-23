/**
 * apps/web/e2e/compare.spec.ts — S23's proof for the compare view.
 *
 * Four claims, and each one is a way the page can look right while being wrong:
 *
 *   1. **The URL is the state, in the order it names.** A shared link renders the
 *      same columns, and a reload renders them again. Column order is asserted, not
 *      just membership, because "compare A with B" and "compare B with A" are the
 *      same fact and different pages.
 *   2. **Every row states its verdict IN WORDS.** The DoD asks for a text
 *      equivalent of the diff highlighting, so "Identique" and "Différent" are
 *      asserted on the rows that carry them — including the row where one product
 *      publishes nothing, which is a difference and must read as one rather than as
 *      an empty cell.
 *   3. **At 360 px the table is replaced by cards, not shrunk.** The table must be
 *      hidden, one card per product must be visible with its own heading, and the
 *      document must not scroll sideways.
 *   4. **Selection is keyboard navigation.** Add and remove are anchors whose href
 *      is the next URL, so focusing one and pressing Enter is the whole interaction;
 *      the assertions drive them that way and never click through a widget.
 *
 * Expectations come from the same two catalogues the app reads and from the same
 * fixture map the mock serves, so a copy change moves the test with the page
 * instead of leaving a hand-typed French sentence behind.
 */
import { test, expect, type Page } from "@playwright/test";

import { CATALOG_PRODUCTS_BY_SLUG } from "../mock/fixtures.mjs";

import ar from "../messages/ar.json";
import fr from "../messages/fr.json";

type Locale = "fr" | "ar";

const CATALOGUES = { fr, ar } as const;
const LOCALES: readonly Locale[] = ["fr", "ar"];

/**
 * Two GPUs whose spec rows agree exactly once: both are 165 W, and they differ on
 * length, thickness, height (one publishes 40 mm, the other publishes nothing) and
 * on the two rows only the Ti card carries. That single agreeing row is what makes
 * the "Identique" assertion meaningful.
 */
const A = "rx-7600-8gb";
const B = "rtx-4060-ti-gaming-oc-16-go";
/** A third, for the cap. */
const C = "rtx-4060-8gb";
/** Never selected, so they are the rows that show the cap sentence. */
const D = "kit-ddr5-16-go";
const E = "ssd-nvme-1-to";

/** Indexed by a SLUG STRING, so the open map is widened rather than narrowed. */
const PRODUCTS = CATALOG_PRODUCTS_BY_SLUG as Record<string, { display_name: string }>;
const NAME = (slug: string): string => PRODUCTS[slug].display_name;

const WIDE = { width: 1280, height: 900 } as const;

/** `/{locale}/composants/comparer?composants=…` — the page's only input. */
function comparePath(locale: Locale, slugs: readonly string[]): string {
  return `/${locale}/composants/comparer?composants=${slugs.join(",")}`;
}

/** The comparison's table (wide viewports only). */
function table(page: Page) {
  return page.locator("table");
}

/** One characteristic's row, found by its label — the label is data, not layout. */
function row(page: Page, label: string) {
  return page.locator("tbody tr").filter({ hasText: label });
}

for (const locale of LOCALES) {
  const copy = CATALOGUES[locale].catalog.compare;
  const specs = CATALOGUES[locale].catalog.specs;

  test(`[${locale}] a shared URL renders the same selection in the same order`, async ({ page }) => {
    await page.setViewportSize(WIDE);
    const url = comparePath(locale, [A, B]);

    await page.goto(url);
    const headers = table(page).locator("thead th");
    // Label column first, then one column per product, in URL order.
    await expect(headers).toHaveCount(3);
    await expect(headers.nth(0)).toHaveText(copy.specColumn);
    await expect(headers.nth(1)).toContainText(NAME(A));
    await expect(headers.nth(2)).toContainText(NAME(B));

    // The picker agrees about what is selected: one "Retirer <name>" per column.
    await expect(page.getByRole("link", { name: copy.removeNamed.replace("{name}", NAME(A)) })).toBeVisible();
    await expect(page.getByRole("link", { name: copy.removeNamed.replace("{name}", NAME(B)) })).toBeVisible();

    // A reload is the sharing scenario: the same address, the same page.
    await page.reload();
    await expect(table(page).locator("thead th").nth(1)).toContainText(NAME(A));
    await expect(table(page).locator("thead th").nth(2)).toContainText(NAME(B));
  });

  test(`[${locale}] every row states its verdict in words`, async ({ page }) => {
    await page.setViewportSize(WIDE);
    await page.goto(comparePath(locale, [A, B]));

    // Both publish the same TGP, so this row agrees — and says so.
    const tgp = row(page, specs.board_tgp_watts);
    await expect(tgp).toHaveCount(1);
    await expect(tgp).toContainText(copy.same);
    await expect(tgp).not.toContainText(copy.differs);

    // Different lengths: the verdict is the other word.
    const length = row(page, specs.length_mm);
    await expect(length).toContainText(copy.differs);
    await expect(length).not.toContainText(copy.same);

    // One publishes 40 mm, the other publishes nothing: a difference, stated with
    // the unknown WORD rather than an empty cell.
    const height = row(page, specs.height_mm);
    await expect(height).toContainText("40 mm");
    await expect(height).toContainText(copy.unknown);
    await expect(height).toContainText(copy.differs);

    // A row only one product carries is still a row, not an omission.
    const psu = row(page, specs.recommended_psu_watts);
    await expect(psu).toHaveCount(1);
    await expect(psu).toContainText(copy.unknown);
  });

  test(`[${locale}] at 360 px the comparison is stacked cards`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(comparePath(locale, [A, B]));

    // The table exists in the markup but is out of the tree; the cards are what a
    // reader gets. Exactly one of the two is ever visible.
    await expect(table(page)).toBeHidden();

    const cards = page.locator("article");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).getByRole("heading", { level: 3 })).toContainText(NAME(A));
    await expect(cards.nth(1).getByRole("heading", { level: 3 })).toContainText(NAME(B));

    // The words travel with the cards: each card states its own rows' verdicts.
    for (const card of [cards.nth(0), cards.nth(1)]) {
      await expect(card).toContainText(specs.board_tgp_watts);
      await expect(card).toContainText(copy.same);
      await expect(card).toContainText(copy.differs);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
  });

  test(`[${locale}] adding a second product is a keyboard navigation`, async ({ page }) => {
    await page.goto(comparePath(locale, [A]));
    // One product is not a comparison: the page says what it needs and offers the
    // picker, and it draws no table and no cards.
    await expect(page.getByText(copy.needTwo)).toBeVisible();
    await expect(page.locator("article")).toHaveCount(0);

    // The whole interaction: focus the link and press Enter. No widget, no click.
    const add = page.getByRole("link", { name: copy.addNamed.replace("{name}", NAME(B)) });
    await add.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL((url) => url.searchParams.get("composants") === `${A},${B}`);

    await expect(page.locator("article")).toHaveCount(2);
    await expect(page.getByText(copy.needTwo)).toHaveCount(0);
  });

  test(`[${locale}] removing the second product returns to the "two needed" state`, async ({ page }) => {
    await page.goto(comparePath(locale, [A, B]));

    const remove = page.getByRole("link", { name: copy.removeNamed.replace("{name}", NAME(B)) });
    await remove.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL((url) => url.searchParams.get("composants") === A);

    await expect(page.getByText(copy.needTwo)).toBeVisible();
    await expect(page.locator("article")).toHaveCount(0);
  });

  test(`[${locale}] at three products the rest are a sentence, not a link`, async ({ page }) => {
    await page.goto(comparePath(locale, [A, B, C]));

    await expect(page.locator("article")).toHaveCount(3);
    // The two products that are NOT selected carry the cap sentence instead of a
    // control that would silently do nothing.
    await expect(page.getByText(copy.max)).toHaveCount(2);
    await expect(
      page.getByRole("link", { name: copy.addNamed.replace("{name}", NAME(D)) }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: copy.removeNamed.replace("{name}", NAME(D)) }),
    ).toHaveCount(0);
  });

  test(`[${locale}] a dead slug is dropped from the comparison and named`, async ({ page }) => {
    await page.goto(comparePath(locale, ["pas-un-produit", A, B]));

    // The comparison that still exists is rendered, in the surviving URL order…
    await expect(page.locator("article")).toHaveCount(2);
    await expect(page.locator("article").first()).toContainText(NAME(A));
    // …and the page says one token was dropped rather than pretending it was never
    // in the link.
    await expect(page.getByText(copy.missing)).toBeVisible();
    // The picker forwards only what resolved, so "Ajouter" cannot rebuild the dead
    // token either.
    await expect(
      page.getByRole("link", { name: copy.addNamed.replace("{name}", NAME(E)) }),
    ).toBeVisible();
  });
}

test("the comparison mirrors on /ar and states its verdicts in Arabic", async ({ page }) => {
  await page.setViewportSize(WIDE);
  await page.goto(comparePath("ar", [A, B]));
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  const centres = await table(page)
    .locator("thead th")
    .evaluateAll((cells) =>
      cells.map((cell) => {
        const box = cell.getBoundingClientRect();
        return box.x + box.width / 2;
      }),
    );
  expect(centres).toHaveLength(3);
  // RTL: the label column is at the reading start (the RIGHT), and the product
  // columns keep their URL order leftwards — a mirrored table, not a reversed one.
  expect(centres[0]).toBeGreaterThan(centres[1]);
  expect(centres[1]).toBeGreaterThan(centres[2]);

  const arabic = ar.catalog.compare;
  await expect(row(page, ar.catalog.specs.board_tgp_watts)).toContainText(arabic.same);
  await expect(row(page, ar.catalog.specs.length_mm)).toContainText(arabic.differs);

  // And the same page at 360 px stacks into cards, still in Arabic.
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(table(page)).toBeHidden();
  const cards = page.locator("article");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText(arabic.same);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the Arabic page must not scroll sideways").toBeLessThanOrEqual(0);
});

test("a component page links into the comparison with itself selected", async ({ request }) => {
  const html = await (await request.get(`/fr/composants/${A}`)).text();
  expect(html).toContain(`/fr/composants/comparer?composants=${A}`);
});

test("the compare view stays out of the index and out of the sitemap", async ({ request }) => {
  const html = await (await request.get(comparePath("fr", [A, B]))).text();
  expect(html).toMatch(/<meta name="robots" content="[^"]*noindex/);

  // The URL space is unbounded, so it must not be advertised anywhere.
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("/composants/comparer");
});
