import { expect, test } from "@playwright/test";

import { ERROR_COPY } from "../lib/i18n/error-copy.generated";
import { IDS } from "../mock/fixtures.mjs";

/**
 * S4's boundary seam: a 200 whose BODY is structurally broken.
 *
 * Every other failure the results page can meet is handled by the page itself —
 * a 404 becomes `notFound()`, a 503/429 becomes the "indisponible" state with
 * its own retry. Those are DATA failures, and `lib/result/load.ts` turns each
 * into a decision. A body that parses but cannot be rendered is a different
 * event: the throw happens inside the render, so the segment's `error.tsx` is
 * the only thing that can catch it, and that is what this spec proves.
 *
 * The fixture (`IDS.brokenShape`) omits `components` from its only build: the
 * page reads `components.length` in `priceProvenance()` and the card maps the
 * array, so the render fails before a card can exist.
 */
for (const locale of ["fr", "ar"] as const) {
  const copy = ERROR_COPY[locale];

  test(`a broken 200 body renders the ${locale} error boundary`, { tag: "@layout" }, async ({ page }) => {
    const url = `/${locale}/config/${IDS.brokenShape}`;
    const attempts: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(IDS.brokenShape)) attempts.push(request.url());
    });

    await page.goto(url);

    // error.tsx, not the route's own unavailable state: its heading, its Alert.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.title);
    await expect(page.getByRole("alert").filter({ hasText: copy.body })).toBeVisible();

    // "Back to home" is NAVIGATION, and it points at the locale's root — this is
    // the one place a reader can leave a page whose content never rendered.
    await expect(page.getByRole("link", { name: copy.home })).toHaveAttribute(
      "href",
      `/${locale}`,
    );

    // The retry re-attempts the SAME route: a second request naming this id, and
    // the boundary is still what comes back, because the fixture is still broken.
    const before = attempts.length;
    await page.getByRole("button", { name: copy.retry }).click();
    await expect.poll(() => attempts.length, { timeout: 15_000 }).toBeGreaterThan(before);
    await expect(page.getByRole("alert").filter({ hasText: copy.body })).toBeVisible();
  });
}
