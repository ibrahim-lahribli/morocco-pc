import { expect, test } from "@playwright/test";

import { stubHomepageApi } from "./support/homepage-api";
import { horizontalOverflow, waitForSettledCards } from "./support/homepage-ready";

/**
 * The Arabic finder as an interaction, not just as an RTL layout.
 *
 * The French specs prove the wiring; these prove the same two answers work on
 * the Arabic page, that the narrowed card is the Arabic one, and that the
 * narrowed grid still fits a 360 px viewport — widths the i18n sweep only
 * measures before any answer is given.
 */
const BUDGET_8000 = /ميزانية 8\s?000/;
const USAGE_OFFICE = /الدراسة والمكتبيات/;
const OFFICE_CARD = "حاسوب للمكتبيات";

test.describe("Arabic finder", () => {
  test("selects a budget and a use case, then narrows to one Arabic card", async ({ page }) => {
    const { posts } = await stubHomepageApi(page);
    await page.goto("/ar");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await waitForSettledCards(page);

    await page.getByRole("radio", { name: BUDGET_8000 }).check({ force: true });
    await page.getByRole("radio", { name: USAGE_OFFICE }).check({ force: true });

    const section = page.locator("#configurations");

    await expect(section.locator("article")).toHaveCount(1);
    await expect(section.getByRole("heading", { name: OFFICE_CARD })).toBeVisible();
    await expect(section.getByText(/الميزانية المستهدفة/)).toBeVisible();
    expect(posts).toEqual([]);
  });

  test("keeps the narrowed Arabic cards inside the viewport at 360", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/ar");
    await waitForSettledCards(page);

    await page.getByRole("radio", { name: BUDGET_8000 }).check({ force: true });
    await page.getByRole("radio", { name: USAGE_OFFICE }).check({ force: true });
    await expect(page.locator("#configurations article")).toHaveCount(1);

    // The grid only reaches its final width once a price has landed, which is
    // why the measurement waits for the settled card rather than the skeleton.
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
