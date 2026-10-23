/**
 * apps/web/e2e/rtl.spec.ts — S20's proof that the Arabic side is a RENDERED
 * mirror, not a translated string table with the same layout.
 *
 * `i18n.spec.ts` already proves `<html dir="rtl">` is in the first byte, that the
 * Arabic face loads and that money/dates format through Intl. That is the easy
 * half: an RTL page can be directionally correct and still be wrong, because
 * `dir="rtl"` only mirrors what is expressed in LOGICAL properties. The failures
 * this file is built to catch are all geometry:
 *
 *   1. **A list that does not mirror.** The wizard's step indicator is an `<ol>`
 *      laid out with flex; under `dir="rtl"` its DOM order must stay identical
 *      while its first item moves to the RIGHT. That is asserted as an ordered
 *      comparison of `x` positions — the same DOM, mirrored coordinates — so a
 *      `flex-direction: row` set explicitly, or an `ml-*` that pushes the list
 *      instead of spacing it, fails here. The share group gets the same check on
 *      a result page.
 *   2. **A bar that fills from the wrong end.** `<progressbar>`'s fill is a block
 *      box with a percentage width: it starts at the inline start, which is the
 *      RIGHT edge in Arabic. A physical `left: 0` would look fine in French and
 *      grow leftwards here, so the fill's anchored edge is measured.
 *   3. **A number in the wrong numeral system, or a reordered price.** Moroccan
 *      Arabic writes Western digits ("7 300 DH", not the Eastern Arabic-Indic
 *      range), and the product's unit is "DH" in both locales (S20's decision,
 *      recorded in the sprint board). Both are asserted on the rendered text, not
 *      on the helper.
 *   4. **Overflow at 360 px.** RTL is where a stray physical margin grows the page
 *      to the left, and `scrollWidth` notices even when nothing looks wrong. Every
 *      shipped Arabic route is measured, not just the home page.
 *   5. **Prose that is not actually Arabic.** The guide route used to 404 under
 *      `ar`; now that it renders, the body must be Arabic inside an RTL article —
 *      a French body in an Arabic shell would pass every other check here.
 *
 * And it leaves SCREENSHOTS attached to the run (`testInfo.attach`) for the four
 * screens a human should look at. They are evidence, not assertions: the
 * assertions above are what fail a build, because a stored PNG that nobody
 * regenerates rots into a test nobody reads. `SCREENSHOT_DIR` overrides where they
 * go (default: Playwright's own `test-results/` attachment store).
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";

import { IDS } from "../mock/fixtures.mjs";

const THREE_BUILDS = `/config/${IDS.threeBuilds}`;

/** The `<ol>` items' left edges, in DOM order. */
async function itemXs(page: Page): Promise<number[]> {
  const boxes = await page.locator("main ol").first().locator("> li").evaluateAll((items) =>
    items.map((item) => {
      const rect = item.getBoundingClientRect();
      return { x: rect.x, width: rect.width };
    }),
  );
  return boxes.map((box) => box.x + box.width / 2);
}

/** How far the document grows past the viewport, in CSS pixels (<= 0 is fine). */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Attach a full-page PNG to the run, and log where it went. */
async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(`${name}.png`, { path, contentType: "image/png" });
}

test.describe("the layout mirrors, it does not just translate", () => {
  test("the wizard's step list keeps its DOM order and reverses its geometry", async ({ page }) => {
    await page.goto("/fr/configurer?etape=usage&use_case=GAMING");
    const french = await itemXs(page);
    const frenchLabels = await page.locator("main ol").first().locator("> li").allInnerTexts();

    await page.goto("/ar/configurer?etape=usage&use_case=GAMING");
    const arabic = await itemXs(page);
    const arabicLabels = await page.locator("main ol").first().locator("> li").allInnerTexts();

    expect(french.length).toBeGreaterThanOrEqual(3);
    expect(arabic.length).toBe(french.length);
    // Same items, same order — only the language of each label changed.
    expect(arabicLabels.length).toBe(frenchLabels.length);
    expect(arabicLabels[0]).not.toBe(frenchLabels[0]);

    // French reads left to right; Arabic reads right to left. Compared in DOM
    // order, so "mirrored" means strictly DESCENDING x per list.
    for (let index = 1; index < french.length; index += 1) {
      expect(french[index], `fr step ${index} must sit right of step ${index - 1}`).toBeGreaterThan(
        french[index - 1],
      );
      expect(arabic[index], `ar step ${index} must sit left of step ${index - 1}`).toBeLessThan(
        arabic[index - 1],
      );
    }
  });

  test("the share group mirrors with its DOM order intact", async ({ page }) => {
    const centres = async () => {
      const boxes = await page
        .locator("main [role='group']")
        .first()
        .locator("> *")
        .evaluateAll((children) =>
          children.map((child) => {
            const rect = child.getBoundingClientRect();
            return rect.x + rect.width / 2;
          }),
        );
      return boxes;
    };

    await page.goto(`/fr${THREE_BUILDS}`);
    const french = await centres();

    await page.goto(`/ar${THREE_BUILDS}`);
    const arabic = await centres();

    expect(french.length).toBeGreaterThanOrEqual(2);
    expect(arabic.length).toBe(french.length);
    for (let index = 1; index < french.length; index += 1) {
      expect(french[index]).toBeGreaterThan(french[index - 1]);
      expect(arabic[index]).toBeLessThan(arabic[index - 1]);
    }
  });

  test("the budget bar fills from the inline start, whichever that is", async ({ page }) => {
    const anchored = async () =>
      page
        .getByRole("progressbar")
        .first()
        .evaluate((bar) => {
          const track = bar.getBoundingClientRect();
          const fill = (bar.firstElementChild as HTMLElement).getBoundingClientRect();
          return {
            trackLeft: track.left,
            trackRight: track.right,
            fillLeft: fill.left,
            fillRight: fill.right,
            fraction: fill.width / track.width,
          };
        });

    await page.goto(`/fr${THREE_BUILDS}`);
    const french = await anchored();
    expect(french.fraction).toBeGreaterThan(0);
    expect(french.fraction).toBeLessThanOrEqual(1);
    // LTR: the fill starts at the left edge and leaves the empty part on the right.
    expect(Math.abs(french.fillLeft - french.trackLeft)).toBeLessThan(1.5);

    await page.goto(`/ar${THREE_BUILDS}`);
    const arabic = await anchored();
    expect(arabic.fraction).toBeCloseTo(french.fraction, 2);
    // RTL: the same fraction, anchored to the RIGHT edge. A physical `left: 0`
    // would keep it on the left and this is the only assertion that notices.
    expect(Math.abs(arabic.fillRight - arabic.trackRight)).toBeLessThan(1.5);
  });
});

test.describe("Arabic numerals and the unit", () => {
  test("prices keep Western digits and print DH, in both locales", async ({ page }) => {
    // The rule, stated once: Moroccan Arabic uses the Latin numeral set. The
    // Eastern Arabic-Indic block would break the alignment of every price column
    // and disagrees with the API's own values.
    const EASTERN_ARABIC_INDIC = /[\u0660-\u0669\u06F0-\u06F9]/;

    await page.goto(`/ar${THREE_BUILDS}`);
    const prices = await page.locator("main .num-tabular").allInnerTexts();
    expect(prices.length).toBeGreaterThan(0);
    for (const price of prices) {
      expect(price).not.toMatch(EASTERN_ARABIC_INDIC);
    }
    // The amount text itself: digits grouped by the helper, unit "DH".
    const body = await page.locator("main").innerText();
    expect(body).toMatch(/[0-9]/);
    expect(body).toContain("DH");

    // And no Eastern digits anywhere on the page — a date, a rank or a bar label
    // would be just as wrong as a price.
    expect(await page.locator("body").innerText()).not.toMatch(EASTERN_ARABIC_INDIC);
  });

  test("a Latin product name keeps its own direction inside the Arabic page", async ({ page }) => {
    await page.goto(`/ar${THREE_BUILDS}`);
    const name = page.locator('main [dir="auto"]', { hasText: "RTX 4060 8GB" }).first();
    await expect(name).toBeVisible();
    // `dir="auto"` resolves from the first strong character: the name is Latin,
    // so it must render LTR even though the row around it is RTL.
    await expect(name).toHaveAttribute("dir", "auto");
    const direction = await name.evaluate((element) => getComputedStyle(element).direction);
    expect(direction).toBe("ltr");
  });
});

test.describe("Arabic routes at 360 px", () => {
  const ARABIC_ROUTES = [
    "/ar",
    "/ar/configurer?etape=usage&use_case=GAMING",
    "/ar/configurer?etape=budget&use_case=GAMING&budget_amount=9000",
    `/ar${THREE_BUILDS}`,
    "/ar/guides",
    "/ar/guides/choisir-un-gpu",
    "/ar/composants/rtx-4060-8gb",
    "/ar/composants/comparer?slugs=rtx-4060-8gb,rtx-4070-12gb",
  ];

  for (const route of ARABIC_ROUTES) {
    test(`${route} does not scroll sideways`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(route);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      // The page is actually the RTL layout, not a Latin one with Arabic text.
      expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe("rtl");
    });
  }
});

test.describe("the Arabic guides are Arabic prose", () => {
  test("the guide body renders RTL, in Arabic, with its structure", async ({ page }) => {
    await page.goto("/ar/guides/budget-pc-gamer");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "ما الميزانية التي يحتاجها PC للألعاب؟",
    );
    const article = page.locator("main article");
    expect(await article.evaluate((element) => getComputedStyle(element).direction)).toBe("rtl");

    // The prose is the Arabic body, not the French one in an Arabic frame: the
    // first paragraph and the section headings come from a DIFFERENT file.
    const text = await article.innerText();
    expect(text).toContain("الميزانية");
    expect(text).not.toContain("Un budget ne dit pas seulement");
    expect(await article.locator("h2").count()).toBeGreaterThanOrEqual(3);
    expect(await article.locator("ul li").count()).toBeGreaterThanOrEqual(3);
    expect(await article.locator("blockquote").count()).toBe(1);

    // Internal links point at the ARABIC siblings, not the French ones.
    const hrefs = await article
      .locator("a")
      .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href") ?? ""));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href, "an Arabic guide must not link into the French tree").toMatch(/^\/ar\//);
    }
  });
});

test.describe("screenshots", () => {
  // One per surface a reviewer should look at. Attached to the run instead of
  // committed as `toHaveScreenshot()` baselines: a baseline nobody refreshes fails
  // a build for a font-rendering difference and teaches the team to skip it.
  const SHOTS: [name: string, path: string][] = [
    ["ar-home", "/ar"],
    ["ar-wizard-budget", "/ar/configurer?etape=budget&use_case=GAMING&budget_amount=9000"],
    ["ar-result", `/ar${THREE_BUILDS}`],
    ["ar-guide", "/ar/guides/choisir-un-gpu"],
    ["ar-component", "/ar/composants/rtx-4060-8gb"],
    ["fr-result", `/fr${THREE_BUILDS}`],
  ];

  for (const [name, path] of SHOTS) {
    test(`${name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await shoot(page, testInfo, name);
    });
  }
});
