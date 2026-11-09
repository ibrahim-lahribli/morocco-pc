import { expect, test } from "@playwright/test";

import { stubHomepageApi } from "./support/homepage-api";

/**
 * The phone's first screen.
 *
 * Phase 3 carries one promise: at 393 x 852 and at 360 x 800 the finder's
 * primary CTA sits fully above the fixed bottom navigation, with a gap wide
 * enough to read as intentional. The rest of this spec pins the hero values
 * that buy the fit — the frame's 8 px gap under the header, its 24/30 phone
 * heading, a two-line intro — so a later tweak cannot quietly push the CTA back
 * under the nav.
 *
 * The fit is asserted as a RELATIONSHIP (CTA bottom against nav top), never as
 * an absolute `y`: those numbers move with the phone, the announcement banner
 * and the font that actually loaded.
 */
const PHONES = [
  { width: 393, height: 852 },
  { width: 360, height: 800 },
] as const;

/** The frame's hero starts 8 px under its header (`main pt-16` − fixed 56 px). */
const PHONE_HERO_PADDING = 8;
const DESKTOP_HERO_PADDING = 64;
/** The smallest gap that still reads as deliberate rather than "just fits". */
const MIN_CTA_GAP = 8;

test.describe("phone first screen", () => {
  for (const phone of PHONES) {
    test(`keeps the finder CTA clear of the bottom nav at ${phone.width}`, async ({ page }) => {
      await stubHomepageApi(page);
      await page.setViewportSize(phone);
      await page.goto("/fr");

      const cta = page.locator("#simulateur button[type='submit']");
      const nav = page.locator("[data-slot='mobile-nav']");
      await expect(cta).toBeVisible();
      await expect(nav).toBeVisible();

      const ctaBox = await cta.boundingBox();
      const navBox = await nav.boundingBox();
      const cardBox = await page.locator("#simulateur [data-slot='card']").boundingBox();
      expect(ctaBox, "the CTA has a box").not.toBeNull();
      expect(navBox, "the nav has a box").not.toBeNull();
      expect(cardBox, "the simulator card has a box").not.toBeNull();

      const ctaBottom = ctaBox!.y + ctaBox!.height;
      expect(ctaBottom, "the CTA ends inside the viewport").toBeLessThanOrEqual(phone.height);

      const gap = navBox!.y - ctaBottom;
      expect(gap, `the CTA clears the nav by ${Math.round(gap)}px`).toBeGreaterThanOrEqual(
        MIN_CTA_GAP,
      );

      // The card still contains its CTA and starts above it: no overlap was
      // faked by moving the button out of the flow.
      expect(cardBox!.y).toBeLessThan(ctaBox!.y);
      expect(cardBox!.y + cardBox!.height).toBeGreaterThanOrEqual(ctaBottom);
    });

    test(`takes the compact hero step at ${phone.width}`, async ({ page }) => {
      await stubHomepageApi(page);
      await page.setViewportSize(phone);
      await page.goto("/fr");

      const paddingTop = await page
        .locator("section#top")
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingTop));
      expect(paddingTop, "the hero's phone top padding").toBe(PHONE_HERO_PADDING);

      const heading = await page.locator("#hero-title").evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          fontSize: Number.parseFloat(style.fontSize),
          lineHeight: Number.parseFloat(style.lineHeight),
        };
      });
      expect(heading, "the phone heading step").toEqual({ fontSize: 24, lineHeight: 30 });

      const intro = await page.locator("#top h1 + p").evaluate((element) => {
        const style = getComputedStyle(element);
        const lineHeight = Number.parseFloat(style.lineHeight);
        return {
          fontSize: Number.parseFloat(style.fontSize),
          lineHeight,
          lines: Math.round(element.getBoundingClientRect().height / lineHeight),
        };
      });
      expect(intro.fontSize, "the phone intro keeps the 14/20 body step").toBe(14);
      expect(intro.lineHeight).toBe(20);
      expect(intro.lines, "the approved copy reads in two lines").toBe(2);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `no horizontal overflow at ${phone.width}`).toBeLessThanOrEqual(0);
    });
  }

  test("leaves the desktop hero on its own step", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/fr");

    const paddingTop = await page
      .locator("section#top")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingTop));
    expect(paddingTop, "desktop keeps pt-16").toBe(DESKTOP_HERO_PADDING);

    const heading = await page
      .locator("#hero-title")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(heading, "the 40 px desktop heading is unchanged").toBe(40);

    const intro = await page
      .locator("#top h1 + p")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(intro, "the 16 px desktop intro is unchanged").toBe(16);
  });
});
