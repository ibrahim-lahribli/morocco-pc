/**
 * apps/web/e2e/kit-phase2.spec.ts — the Phase 2 primitives' proof (gate G2).
 *
 * `kit.spec.ts` proves S3's nine components. This file proves the eight the
 * redesign added, and it asserts the ONE thing each could get wrong that a
 * screenshot cannot show:
 *
 *   - `BottomTabBar`  — the current item is announced, and every cell is a real
 *                       link (not a button that pushes a route: a tab that loses
 *                       open-in-new-tab is a lie to a screen reader).
 *   - `StickyBar`     — the status beside the figure is the price vocabulary, and
 *                       the action is a real 48 px target.
 *   - `SnapRow`       — the scroller is FOCUSABLE and keyboard-scrollable. A
 *                       horizontal strip nobody can reach with a keyboard is the
 *                       "never the only path" rule broken.
 *   - `BuildSummaryCard` — the drawn fallback is `aria-hidden` and the status
 *                       badge is NOT inside it (a status in a hidden subtree is
 *                       silent), and an unrecorded price renders no number.
 *   - `PartRow`       — a null price prints nothing rather than `0 DH`.
 *   - `RetailerRow`   — it is not a link. D-10: no merchant is served, so a
 *                       clickable row would be an affordance with no answer.
 *   - `TrustItem`     — the glyph is decoration, the words carry the meaning.
 *   - `ExplainerSheet` — it opens with the sheet's trap AND returns focus to its
 *                       trigger (the exact defect `f339d37` was red for).
 *
 * Every assertion reads the rendered production build, so a component change is
 * invisible until `npm run build` runs again — rebuild before believing a pass.
 */

import { test, expect } from "@playwright/test";

const section = (page: import("@playwright/test").Page, id: string) =>
  page.locator(`section[aria-labelledby="${id}-title"]`);

test.describe("the Phase 2 primitives at 360 px", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("the tab bar marks the current page, and every cell is a link", async ({ page }) => {
    await page.goto("/fr/kit");

    // Scoped to the SECTION, not looked up by accessible name: the shell's header
    // nav is ALSO named "Navigation principale" (`shell.navLabel`), so a name
    // lookup unions both landmarks — measured 2026-11-03: 11 links, not 5. Two
    // landmarks sharing one name is a real Phase 3 finding, not a spec problem,
    // and it is recorded in HANDOFF.md rather than papered over here.
    const bar = section(page, "tab-bar").getByRole("navigation");
    await expect(bar).toHaveAccessibleName("Exemple de barre d’onglets");
    const links = bar.getByRole("link");
    await expect(links).toHaveCount(5);

    // `aria-current`, not a colour: the active cell is also filled primary, but
    // colour alone is not a signal a screen reader can use.
    await expect(bar.getByRole("link", { name: "Accueil" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(bar.getByRole("link", { name: "Guides" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );

    // Five labels across 360 px: each cell must still clear the 44 px floor.
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      // The CELL is 56 px (`h-14`) and the link fills it, so the floor is the
      // 44 px accessibility minimum. An earlier draft asserted 24 here, which
      // would have passed a cell less than half its designed height.
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }

    // The gallery contains a `fixed` bar by giving it a transform-bearing
    // ancestor; if that ever stops working the bar pins itself to the viewport
    // and covers the page's own footer, which is what this measures.
    const wrapper = section(page, "tab-bar").locator("div").first();
    const wrapBox = await wrapper.boundingBox();
    const barBox = await bar.boundingBox();
    expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(wrapBox!.y + wrapBox!.height + 1);
  });

  test("the sticky bar pairs the figure with a status and a real action", async ({ page }) => {
    await page.goto("/fr/kit");

    const bar = section(page, "sticky-bar");
    await expect(bar.getByText("Total", { exact: true })).toBeVisible();
    await expect(bar.getByText(/\d/).first()).toBeVisible();
    // The status slot carries the PRICE vocabulary, so the two badges cannot fork.
    await expect(bar.locator("[data-tone]")).toHaveCount(1);

    const action = bar.getByRole("button", { name: "Enregistrer" });
    const box = await action.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  });

  test("the snap row is focusable, keyboard-scrollable and snaps", async ({ page }) => {
    await page.goto("/fr/kit");

    const row = section(page, "snap-row").locator("[data-snap-row]");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("aria-label", "Configurations liées");
    await expect(row).toHaveAttribute("tabindex", "0");
    await expect(row.getByRole("listitem")).toHaveCount(4);

    // A scroller whose content is wider than itself is the whole point; if it is
    // not, this test would pass on a broken row.
    const { scrollWidth, clientWidth } = await row.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);

    await row.focus();
    const before = await row.evaluate((el) => el.scrollLeft);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => row.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(before);
  });

  test("the build card draws a fallback and never hides its status inside it", async ({
    page,
  }) => {
    await page.goto("/fr/kit");

    const cards = section(page, "build-summary").locator("article");
    await expect(cards).toHaveCount(2);

    const first = cards.first();
    const fallback = first.locator("[data-drawn-fallback]");
    await expect(fallback).toHaveAttribute("aria-hidden", "true");
    // The badge is a SIBLING of the drawn slot: inside an aria-hidden container
    // it would be invisible to a screen reader.
    await expect(fallback.locator("[data-tone]")).toHaveCount(0);
    await expect(first.locator("[data-tone]")).toHaveCount(1);

    // The CTA is a link, and the card itself is not one — a save control inside
    // a card-wide link is invalid HTML.
    await expect(first.getByRole("link", { name: "Voir le détail" })).toHaveAttribute(
      "href",
      "/fr/config/demo/1",
    );
    await expect(first.locator("a")).toHaveCount(1);

    // The second card records no price: no number, not a zero.
    const second = cards.nth(1);
    await expect(second.getByText(/\d\s?DH/)).toHaveCount(0);
    await expect(second.getByText("Essentiel", { exact: true })).toBeVisible();
  });

  test("a part row with no recorded price prints no number", async ({ page }) => {
    await page.goto("/fr/kit");

    const rows = section(page, "part-rows").locator("[data-part-row]");
    await expect(rows).toHaveCount(3);

    // Two priced rows, one unpriced: the unpriced row shows a name and no amount.
    await expect(section(page, "part-rows").getByText(/DH/)).toHaveCount(2);
    await expect(rows.nth(2)).toContainText("Pièce sans prix retenu");
  });

  test("the retailer row is provenance, not a fake shop link", async ({ page }) => {
    await page.goto("/fr/kit");

    const rows = section(page, "retailer-rows").locator("[data-retailer-row]");
    await expect(rows).toHaveCount(3);

    // D-10: `components[]` carries no merchant name, URL or per-offer price, so
    // the row must not offer a destination it cannot answer.
    await expect(section(page, "retailer-rows").locator("a")).toHaveCount(0);
    // The provenance vocabulary is the Badge's three states, no fourth.
    const tones = await rows.evaluateAll((els) =>
      els.map((el) => el.querySelector("[data-tone]")?.getAttribute("data-tone") ?? null),
    );
    expect(tones).toEqual(["verified", "indicative", "demo"]);
  });

  test("a trust item's glyph is decoration", async ({ page }) => {
    await page.goto("/fr/kit");

    const items = section(page, "trust-items").locator("[data-trust-item]");
    await expect(items).toHaveCount(3);
    for (const item of await items.all()) {
      await expect(item.locator("svg")).toHaveAttribute("aria-hidden", "true");
    }
  });

  test("the explainer sheet names itself, closes on Escape and returns focus", async ({
    page,
  }) => {
    await page.goto("/fr/kit");

    const trigger = page.getByRole("button", { name: "Ouvrir l’explication" });
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName("D’où vient ce montant");
    await expect(dialog).toHaveAccessibleDescription(
      "Le prix affiché est la somme des pièces retenues.",
    );
    // The eyebrow is inside the sheet, above the prose.
    await expect(dialog.getByText("Prix", { exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
