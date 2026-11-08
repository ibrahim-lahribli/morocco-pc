import { expect, test } from "@playwright/test";

import { stubHomepageApi } from "./support/homepage-api";

/**
 * The desktop hero preview, asserted rather than eyeballed.
 *
 * Q-19 fixed its content: the rank-1 Gaming preset the configurations section
 * already fetched at the 12,000 MAD ceiling. These specs prove it renders the
 * served numbers, adds no request, degrades to the text shell when the ladder is
 * empty, and stays out of the phone layout.
 */
test.describe("hero preview", () => {
  test("shows the served Gaming score and price without a second request", async ({ page }) => {
    const { requests, posts } = await stubHomepageApi(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/fr");

    const preview = page.locator("#top");
    // `{score}` is ICU-formatted, so French may use a comma decimal separator.
    await expect(
      preview.getByText(/Score de configuration\s*:\s*72[,.]5\s*\/\s*100/),
    ).toBeVisible();
    await expect(preview.getByText(/11\s?500\s?DH/)).toBeVisible();

    // One ladder serves both the preview and the Gaming card: the hero must use
    // the same query key rather than issuing its own read.
    const gaming = requests.filter((request) => request.includes("/v1/presets?use_case=GAMING"));
    expect(gaming, "the hero must reuse the builds section's query key").toHaveLength(1);
    expect(posts).toEqual([]);
  });

  test("is absent from the phone layout", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr");

    await expect(page.locator("#top").getByText("Vue Référence")).toBeHidden();
  });

  test("keeps the text shell when the Gaming ladder is empty", async ({ page }) => {
    await stubHomepageApi(page, { emptyPresetsFor: ["GAMING"] });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/fr");

    await expect(page.locator("#top").getByText("Détails specs →")).toBeVisible();
    await expect(page.locator("#top").getByText(/Score de configuration/)).toHaveCount(0);
  });

  test("never overflows in Arabic at 360", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/ar");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
