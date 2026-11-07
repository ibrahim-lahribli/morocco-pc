import { expect, test, type Page } from "@playwright/test";

import ar from "../messages/ar.json";
import fr from "../messages/fr.json";

import { stubHomepageApi } from "./support/homepage-api";
import { horizontalOverflow, waitForSettledCards } from "./support/homepage-ready";

/**
 * The Arabic homepage, asserted rather than eyeballed.
 *
 * Arabic is authored and parity-tested but **not** production-approved until a
 * native reviewer signs off (`docs/homepage-arabic-review.md`); this spec proves
 * the mechanics — direction, typeface, mirroring, overflow and the fixed nav's
 * clearance — not the quality of the prose.
 *
 * Every API call is stubbed, so the cards render without a server.
 */

const ARABIC_LETTER = /[\u0600-\u06FF]/;

const BREAKPOINTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 900 },
  { width: 1440, height: 900 },
] as const;

/**
 * Where the price digits sit inside their own card.
 *
 * Absolute `x` cannot be compared across locales: in RTL the first card is on
 * the right, so the same logical position lands at a *larger* `x`. And a `<dd>`
 * is a block, so its border box spans its wrapper and mirrors nothing either.
 * A Range over the text gives the glyph box; measuring from the card's start
 * and end edges then survives the mirrored layout, and the assertion becomes
 * the design rule itself: the price hugs the end edge, whichever side that is.
 */
function priceRow(page: Page) {
  return page.evaluate(() => {
    const card = document.querySelector("#configurations article");
    const values = card === null ? [] : [...card.querySelectorAll("dd")];
    const price = values.at(-1);

    if (card === null || price === undefined) {
      return null;
    }

    const range = document.createRange();
    range.selectNodeContents(price);
    const text = range.getBoundingClientRect();
    const box = card.getBoundingClientRect();

    return {
      fromStart: text.x - box.x,
      fromEnd: box.right - text.right,
      cardWidth: box.width,
    };
  });
}

test.describe("Arabic homepage", () => {
  test("serves Arabic as an RTL document in the Arabic typeface", async ({ page }) => {
    await stubHomepageApi(page);
    await page.goto("/ar");

    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "ar");
    await expect(html).toHaveAttribute("dir", "rtl");

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(ARABIC_LETTER);

    const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(fontFamily).toContain("IBM Plex Sans Arabic");
  });

  test("mirrors the section heading, the card row and the bottom nav", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto("/fr");
    await expect(page.locator("#configurations article h3").first()).toBeVisible();
    await expect(page.locator("#configurations article dd").last()).toBeVisible();
    const frHeading = await page.locator("#configurations-title").boundingBox();
    const frCardHeading = await page.locator("#configurations article h3").first().boundingBox();
    const frPrice = await priceRow(page);

    await page.goto("/ar");
    await expect(page.locator("#configurations article h3").first()).toBeVisible();
    await expect(page.locator("#configurations article dd").last()).toBeVisible();
    const arHeading = await page.locator("#configurations-title").boundingBox();
    const arCardHeading = await page.locator("#configurations article h3").first().boundingBox();
    const arPrice = await priceRow(page);

    // The section and the card start at the start edge: left in French, right
    // in Arabic.
    expect(frHeading!.x).toBeLessThan(arHeading!.x);
    expect(frCardHeading!.x).toBeLessThan(arCardHeading!.x);

    // The price hugs the end edge of its card: right in French, left in Arabic.
    // A physical left/right assertion would pass in neither direction.
    expect(frPrice).not.toBeNull();
    expect(arPrice).not.toBeNull();
    expect(frPrice!.fromEnd, "fr: the price is not at the end edge").toBeLessThan(
      frPrice!.cardWidth * 0.35,
    );
    expect(arPrice!.fromStart, "ar: the price is not at the end edge").toBeLessThan(
      arPrice!.cardWidth * 0.35,
    );

    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/ar");
    const items = page.getByRole("navigation", { name: ar.Shell.mobileNav }).locator("li");
    const first = await items.first().boundingBox();
    const last = await items.last().boundingBox();

    expect(first!.x).toBeGreaterThan(last!.x);
  });

  test("switching language keeps the page and flips its direction", async ({ page }) => {
    await stubHomepageApi(page);
    await page.goto("/fr");

    await page
      .getByRole("navigation", { name: fr.Shell.language })
      .getByRole("link", { name: `Afficher en ${fr.Shell.languages.ar}`, exact: true })
      .click();

    await expect(page).toHaveURL(/\/ar$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ARABIC_LETTER);
  });

  test("never scrolls horizontally, in either locale, at any breakpoint", async ({ page }) => {
    await stubHomepageApi(page);

    for (const locale of ["fr", "ar"] as const) {
      for (const breakpoint of BREAKPOINTS) {
        await page.setViewportSize(breakpoint);
        await page.goto(`/${locale}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await waitForSettledCards(page);

        const overflow = await horizontalOverflow(page);
        expect(
          overflow,
          `${locale} overflows by ${overflow}px at ${breakpoint.width}px`,
        ).toBeLessThanOrEqual(0);
      }
    }
  });

  test("keeps the final call to action and the footer clear of the bottom nav at 360", async ({
    page,
  }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 360, height: 800 });

    for (const locale of ["ar", "fr"] as const) {
      await page.goto(`/${locale}`);

      const nav = page.getByRole("navigation", {
        name: locale === "ar" ? ar.Shell.mobileNav : fr.Shell.mobileNav,
      });
      const finalCta = page.locator("section[aria-labelledby='final-cta-title']");

      await finalCta.evaluate((element) => element.scrollIntoView({ block: "center" }));
      const ctaBox = await finalCta.boundingBox();
      const navBox = await nav.boundingBox();

      expect(ctaBox).not.toBeNull();
      expect(navBox).not.toBeNull();
      expect(navBox!.y, `${locale}: the bottom nav covers the final CTA`).toBeGreaterThanOrEqual(
        ctaBox!.y + ctaBox!.height - 1,
      );

      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const footerBox = await page.locator("footer").boundingBox();
      const navAtEnd = await nav.boundingBox();

      expect(footerBox).not.toBeNull();
      expect(navAtEnd).not.toBeNull();
      expect(
        footerBox!.y + footerBox!.height,
        `${locale}: the bottom nav covers the footer`,
      ).toBeLessThanOrEqual(navAtEnd!.y + 1);
    }
  });
});
