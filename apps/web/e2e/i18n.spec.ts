/**
 * apps/web/e2e/i18n.spec.ts — S5's proof.
 *
 * Five things are asserted, and each one is a failure mode that looks fine in a
 * screenshot:
 *
 *   1. `lang` and `dir` are on `<html>` in the server HTML, not set by a client
 *      effect. An Arabic page that flips after hydration is a visible glitch and
 *      a screen-reader mispronunciation.
 *   2. The switcher is a link that KEEPS THE PATH: `/fr/format` → `/ar/format`.
 *      A switcher that always lands on the home page is the classic i18n bug.
 *   3. Money and dates come from Intl with the ROUTE's locale, and money carries
 *      a narrow no-break space plus the unit the product uses ("DH").
 *   4. The Arabic page actually loads IBM Plex Sans Arabic, and the French page
 *      does not apply it.
 *   5. Cumulative Layout Shift is 0 while the fonts swap — the point of
 *      `next/font`'s metric-adjusted fallbacks, measured rather than assumed.
 */

import { test, expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    __cls?: number;
    __shifts?: Array<{ value: number; node: string }>;
  }
}

/** Record layout shifts from the first paint, before any app code runs. */
async function trackCls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<
        PerformanceEntry & { value: number; hadRecentInput: boolean }
      >) {
        if (entry.hadRecentInput) continue;
        window.__cls = (window.__cls ?? 0) + entry.value;
        if (entry.value > 0) {
          const source = (entry as unknown as { sources?: Array<{ node?: Node }> }).sources?.[0]?.node;
          window.__shifts?.push({
            value: entry.value,
            node: source instanceof Element ? source.outerHTML.slice(0, 80) : "unknown",
          });
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

test.describe("locale routing", () => {
  test("/ar is Arabic and RTL in the first byte of HTML", async ({ page }) => {
    await page.goto("/ar");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("جهّز حاسوبك، قطعة بقطعة");
  });

  test("/ar has no horizontal scroll at 360 px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/ar");
    // RTL is where a stray physical margin usually shows up: the page grows to
    // the left and `scrollWidth` exceeds the viewport even though nothing looks
    // wrong at a glance.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("/fr is French and LTR", async ({ page }) => {
    await page.goto("/fr");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("/ redirects to the default locale", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/fr$/);
  });

  test("an unknown locale is a 404, not a silent French page", async ({ page }) => {
    const response = await page.goto("/de");
    expect(response?.status()).toBe(404);
  });

  test("no message key leaks into the page", async ({ page }) => {
    for (const path of ["/fr", "/ar"]) {
      await page.goto(path);
      const text = await page.locator("body").innerText();
      expect(text).not.toMatch(/\b(?:shell|home|formats)\.[a-zA-Z]/);
    }
  });
});

test.describe("the locale switcher", () => {
  test("keeps the current path and marks the active language", async ({ page }) => {
    await page.goto("/fr/format");

    const french = page.getByRole("link", { name: "Français" });
    const arabic = page.getByRole("link", { name: "العربية" });
    await expect(french).toHaveAttribute("aria-current", "true");
    await expect(arabic).not.toHaveAttribute("aria-current", "true");

    await arabic.click();
    await expect(page).toHaveURL(/\/ar\/format$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    // And back, on the same screen.
    await page.getByRole("link", { name: "Français" }).click();
    await expect(page).toHaveURL(/\/fr\/format$/);
    await expect(page.getByRole("link", { name: "Français" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("each option is a real link with hreflang, and a 44 px target", async ({ page }) => {
    await page.goto("/fr");
    const arabic = page.getByRole("link", { name: "العربية" });
    await expect(arabic).toHaveAttribute("hreflang", "ar");
    await expect(arabic).toHaveAttribute("href", "/ar");

    const box = await arabic.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe("formatting", () => {
  const NARROW_SPACE = "\u202F";

  test("money carries a narrow no-break space and DH in both locales", async ({ page }) => {
    for (const [path, label] of [
      ["/fr/format", "Prix indicatif"],
      ["/ar/format", "سعر إرشادي"],
    ] as const) {
      await page.goto(path);
      const value = page.locator("dd").first();
      const text = (await value.innerText()).trim();
      expect(text).toContain("DH");
      expect(text).toContain(NARROW_SPACE);
      expect(text).toMatch(/^7\u202F300\u00A0DH$/);
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("dates are the locale's own formatting, not a literal", async ({ page }) => {
    await page.goto("/fr/format");
    const fr = (await page.locator("dd").nth(1).innerText()).trim();
    expect(fr).toBe(
      new Intl.DateTimeFormat("fr-MA", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date("2026-10-12T09:00:00.000Z")),
    );

    await page.goto("/ar/format");
    const ar = (await page.locator("dd").nth(1).innerText()).trim();
    expect(ar).toBe(
      new Intl.DateTimeFormat("ar-MA", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date("2026-10-12T09:00:00.000Z")),
    );
    expect(ar).not.toBe(fr);
  });

  test("numbers and percentages are grouped by the helper", async ({ page }) => {
    await page.goto("/fr/format");
    const number = (await page.locator("dd").nth(2).innerText()).trim();
    expect(number).toBe(`1${NARROW_SPACE}234${NARROW_SPACE}567`);

    const percent = (await page.locator("dd").nth(3).innerText()).trim();
    expect(percent).toContain("73");
    expect(percent).toContain("%");
  });
});

test.describe("fonts", () => {
  /** Every `<link rel="preload">` for a font, as the server sent it. */
  async function fontPreloads(page: Page): Promise<string[]> {
    await page.waitForLoadState("domcontentloaded");
    return page.evaluate(() =>
      [...document.querySelectorAll('link[rel="preload"][as="font"]')].map(
        (link) => link.getAttribute("href") ?? "",
      ),
    );
  }

  test("the Arabic face is preloaded on /ar and never on a French page", async ({ page }) => {
    // The saving this pins: the face is self-hosted so its preload can follow the
    // locale. A regression is one `next/font` declaration away, and it would put
    // four subset files (~136 KB) back on every French page.
    await page.goto("/ar");
    const arabic = (await fontPreloads(page)).filter((href) => href.includes("ibm-plex"));
    expect(arabic).toHaveLength(3);
    expect(arabic.every((href) => href.endsWith(".woff2"))).toBe(true);

    for (const frenchRoute of ["/fr", "/fr/format", "/fr/kit"]) {
      await page.goto(frenchRoute);
      const leaks = (await fontPreloads(page)).filter((href) => href.includes("ibm-plex"));
      expect(leaks, `${frenchRoute} must not preload the Arabic face`).toEqual([]);
    }

    // The face is still declared where it is used — the absence of a preload is
    // not the absence of a font: `/fr/tokens` displays Arabic and loads it on
    // demand, with no preload tag.
    await page.goto("/fr/tokens");
    expect((await fontPreloads(page)).filter((href) => href.includes("ibm-plex"))).toEqual([]);
    await page.evaluate(() => document.fonts.ready);
    const specimenLoaded = await page.evaluate(() =>
      [...document.fonts].some(
        (face) => face.family === "IBM Plex Sans Arabic" && face.status === "loaded",
      ),
    );
    expect(specimenLoaded).toBe(true);
  });

  test("the Arabic page loads IBM Plex Sans Arabic; the French page does not apply it", async ({
    page,
  }) => {
    await page.goto("/ar");
    const arabicFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(arabicFamily).toContain("IBM Plex Sans Arabic");
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() =>
      document.fonts.check('16px "IBM Plex Sans Arabic"'),
    );
    expect(loaded).toBe(true);

    await page.goto("/fr");
    const frenchFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(frenchFamily).not.toContain("IBM Plex Sans Arabic");
    expect(frenchFamily).toContain("Inter");
  });

  test("CLS stays at 0 through the font swap", async ({ page }) => {
    await trackCls(page);
    await page.goto("/ar");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);

    const result = await page.evaluate(() => ({
      cls: window.__cls ?? 0,
      shifts: window.__shifts ?? [],
    }));
    // Expected 0. The shift list is the failure message: which element moved.
    expect(result.shifts, JSON.stringify(result.shifts)).toEqual([]);
    expect(result.cls).toBe(0);
  });
});
