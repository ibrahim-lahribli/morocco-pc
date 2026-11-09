import { expect, test } from "@playwright/test";

import { CARD_TITLES, stubHomepageApi } from "./support/homepage-api";
import { waitForSettledCards } from "./support/homepage-ready";

/**
 * The desktop hero preview, asserted rather than eyeballed.
 *
 * Q-19 fixed its content: the rank-1 Gaming preset the configurations section
 * already fetched at the 12,000 MAD ceiling. These specs prove it renders the
 * served numbers in the reader's own number format, reuses the same cache
 * identities as the cards (no second read, no stale value after a change), and
 * degrades to the text shell when the ladder is empty.
 */
test.describe("hero preview", () => {
  test("shows the served Gaming score and price without a second request", async ({ page }) => {
    const { requests, posts } = await stubHomepageApi(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/fr");

    const preview = page.locator("#top");
    await expect(preview.getByText("Score de configuration : 72,5/100")).toBeVisible();
    await expect(preview.getByText(/11\s?500\s?DH/)).toBeVisible();

    // One ladder and one detail serve both the preview and the Gaming card: the
    // hero must be reading the same TanStack keys, not issuing its own reads.
    const gamingLadder = requests.filter((request) =>
      request.includes("/v1/presets?use_case=GAMING"),
    );
    const gamingDetail = requests.filter((request) =>
      request.includes("/v1/recommendations/rec-GAMING-12000"),
    );
    expect(gamingLadder, "one Gaming ladder for the hero and the card").toHaveLength(1);
    expect(gamingDetail, "one detail for the hero and the card").toHaveLength(1);
    expect(posts).toEqual([]);
  });

  test("formats the score with the comma in French and the point in Arabic", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto("/fr");
    const french = page.locator("#top");
    await expect(french.getByText("Score de configuration : 72,5/100")).toBeVisible();
    await expect(french.getByText(/72\.5/)).toHaveCount(0);

    await page.goto("/ar");
    const arabic = page.locator("#top");
    await expect(arabic.getByText("درجة التجميعة: 72.5/100")).toBeVisible();
    await expect(arabic.getByText(/72,5/)).toHaveCount(0);

    // Latin digits in both locales, matching the price rule.
    await expect(page.locator("#top")).toContainText(/[0-9]/);
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

  test("keeps its own answer when the finder changes use case", async ({ page }) => {
    const { requests, posts } = await stubHomepageApi(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/fr");
    await waitForSettledCards(page);

    const preview = page.locator("#top");
    await expect(preview.getByText("Score de configuration : 72,5/100")).toBeVisible();

    await page.getByRole("radio", { name: /Études et bureautique/ }).check({ force: true });

    const section = page.locator("#configurations");
    await expect(section.getByRole("heading", { name: CARD_TITLES.OFFICE })).toBeVisible();
    // The office card's own score is 61,5; the hero must still be the Gaming build,
    // so neither its score nor its price may be replaced by the office answer.
    await expect(section.getByText(/61,5/)).toBeVisible();
    await expect(preview.getByText("Score de configuration : 72,5/100")).toBeVisible();
    await expect(preview.getByText(/11\s?500\s?DH/)).toBeVisible();
    await expect(preview.getByText(/7\s?500\s?DH/)).toHaveCount(0);

    // A changed use case is a changed query key: one ladder, one detail, once.
    const officeLadder = requests.filter((request) =>
      request.includes("/v1/presets?use_case=OFFICE"),
    );
    const officeDetail = requests.filter((request) =>
      request.includes("/v1/recommendations/rec-OFFICE-12000"),
    );
    expect(officeLadder).toHaveLength(1);
    expect(officeDetail).toHaveLength(1);
    expect(posts).toEqual([]);
  });
});

test.describe("hero composition", () => {
  test("hides the trust chips on a phone and keeps all three on desktop", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/fr");

    const chips = page.locator("#top ul", { hasText: "1 minute chrono" });
    await expect(chips).toBeHidden();

    await page.setViewportSize({ width: 1440, height: 900 });

    await expect(chips).toBeVisible();
    await expect(chips.getByText("1 minute chrono")).toBeVisible();
    await expect(chips.getByText("100 % Gratuit")).toBeVisible();
    await expect(chips.getByText("Sans inscription requise")).toBeVisible();
  });

  test("sets the intro to 14 on 20 on a phone and keeps the desktop step", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/fr");

    const intro = page.locator("#top h1 + p");
    await expect(intro).toHaveText(
      "Gaming, études ou travail : trouvez un PC adapté à votre budget et à vos besoins. Prix indicatifs en dirhams marocains (MAD).",
    );

    const phone = await intro.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
        height: element.getBoundingClientRect().height,
      };
    });

    expect(phone.fontSize).toBe(14);
    expect(phone.lineHeight).toBe(20);
    // The approved copy reaches the frame's three-line composition at 361 px of
    // text width, so 14/20 buys 60 px where the 16/24 step took 72 px.
    expect(Math.round(phone.height / phone.lineHeight)).toBe(3);

    await page.setViewportSize({ width: 1440, height: 900 });

    const desktop = await intro.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(desktop).toBe(16);
  });
});
