import { expect, test, type Page } from "@playwright/test";

import { stubHomepageApi } from "./support/homepage-api";

/**
 * The Phase 2 simulator states, measured rather than eyeballed.
 *
 * The budget and usage cards are styled with tokens, and the Stitch frame fixes
 * each state: the selected preset is the solid `primary-container` fill with a
 * primary border and `on-primary` type, the unselected one is a
 * `surface-container-low` chip with a `surface-container-highest` border and the
 * normal foreground. The usage cards invert the pair — the selected card takes
 * the primary border and the `surface-container-highest` background — and the
 * frame paints no rings in either state, so a selected card must have no
 * box-shadow at all. The only outline allowed is the keyboard focus ring.
 *
 * Colours are asserted as the computed values of the semantic tokens in
 * `app/globals.css`, so a token change shows up here with its own number rather
 * than as a vague "looks different".
 */
const TOKENS = {
  primary: "rgb(55, 48, 163)", // --color-primary
  primarySoft: "rgb(238, 242, 255)", // --color-primary-soft
  surfaceMuted: "rgb(239, 244, 255)", // --color-surface-muted
  surfaceSunken: "rgb(229, 238, 255)", // --color-surface-sunken
  foreground: "rgb(11, 28, 48)", // --color-foreground
} as const;

const PHONE = { width: 393, height: 852 } as const;

const BUDGET_8000 = /Budget de 8\s?000\s?DH/;
const BUDGET_12000 = /Budget de 12\s?000\s?DH/;
const USAGE_OFFICE = /Études et bureautique/;
const USAGE_GAMING = /Jeux vidéo & Gaming/;

const budgetCard = (page: Page, name: RegExp) =>
  page.locator("#finder-budget label").filter({ has: page.getByRole("radio", { name }) });

const usageCard = (page: Page, name: RegExp) =>
  page.locator("#finder-usage label").filter({ has: page.getByRole("radio", { name }) });

test.describe("simulator visual states", () => {
  test.beforeEach(async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize(PHONE);
    await page.goto("/fr");
  });

  test("renders both step circles at 20 px with identical styling", async ({ page }) => {
    const circles = page.locator("#simulateur legend > span[aria-hidden='true']");
    await expect(circles).toHaveCount(2);

    const metrics = await circles.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          background: style.backgroundColor,
          colour: style.color,
          weight: Number(style.fontWeight),
          radius: style.borderTopLeftRadius,
        };
      }),
    );

    expect(metrics[0]).toEqual(metrics[1]);
    for (const circle of metrics) {
      expect(circle.width).toBe(20);
      expect(circle.height).toBe(20);
      expect(circle.background).toBe(TOKENS.primarySoft);
      expect(circle.colour).toBe(TOKENS.primary);
      expect(circle.weight).toBeGreaterThanOrEqual(600);
    }
  });

  test("sets both step headings on the compact 14/20 semibold step", async ({ page }) => {
    for (const selector of ["#finder-budget legend", "#finder-usage legend"]) {
      const heading = await page.locator(selector).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          fontSize: Number.parseFloat(style.fontSize),
          lineHeight: Number.parseFloat(style.lineHeight),
          weight: Number(style.fontWeight),
        };
      });

      expect(heading, selector).toEqual({ fontSize: 14, lineHeight: 20, weight: 600 });
    }
  });

  test("keeps the Step 2 question on one line at 360 and 393", async ({ page }) => {
    for (const width of [360, 393]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const lines = await page.locator("#finder-usage legend").evaluate((element) => {
        const style = getComputedStyle(element);
        return Math.round(
          element.getBoundingClientRect().height / Number.parseFloat(style.lineHeight),
        );
      });

      expect(lines, `Step 2 at ${width}px`).toBe(1);
    }
  });

  test("paints the selected preset as the solid primary chip", async ({ page }) => {
    const card = budgetCard(page, BUDGET_8000);
    await card.click();

    await expect(card).toHaveCSS("background-color", TOKENS.primary);
    await expect(card).toHaveCSS("border-top-color", TOKENS.primary);
    await expect(card).toHaveCSS("color", "rgb(255, 255, 255)");
    // The frame paints no ring: selection is the fill and the border, nothing else.
    await expect(card).toHaveCSS("box-shadow", "none");
  });

  test("keeps an unselected preset on the light surface with dark type", async ({ page }) => {
    const card = budgetCard(page, BUDGET_12000);

    await expect(card).toHaveCSS("background-color", TOKENS.surfaceMuted);
    await expect(card).toHaveCSS("border-top-color", TOKENS.surfaceSunken);
    await expect(card).toHaveCSS("color", TOKENS.foreground);
    await expect(card).toHaveCSS("box-shadow", "none");
  });

  test("gives the selected usage card one primary border and no ring", async ({ page }) => {
    const card = usageCard(page, USAGE_OFFICE);
    await card.click();

    await expect(card).toHaveCSS("border-top-color", TOKENS.primary);
    await expect(card).toHaveCSS("background-color", TOKENS.surfaceSunken);
    await expect(card).toHaveCSS("color", TOKENS.foreground);
    await expect(card).toHaveCSS("box-shadow", "none");

    // The status indicator flips to the filled primary circle.
    const indicator = card.locator("span[aria-hidden='true']").last();
    await expect(indicator).toHaveCSS("background-color", TOKENS.primary);
  });

  test("keeps an unselected usage card on the low surface with no ring", async ({ page }) => {
    const card = usageCard(page, USAGE_GAMING);

    await expect(card).toHaveCSS("border-top-color", TOKENS.surfaceSunken);
    await expect(card).toHaveCSS("background-color", TOKENS.surfaceMuted);
    await expect(card).toHaveCSS("color", TOKENS.foreground);
    await expect(card).toHaveCSS("box-shadow", "none");
  });

  test("shows the keyboard focus ring without the selected ring", async ({ page }) => {
    // A mouse click must not leave an outline behind…
    const selected = usageCard(page, USAGE_OFFICE);
    await selected.click();
    await expect(selected).toHaveCSS("box-shadow", "none");

    // …while tabbing into the preset group must paint one.
    for (let press = 0; press < 24; press += 1) {
      await page.keyboard.press("Tab");
      const onBudgetRadio = await page.evaluate(() => {
        const active = document.activeElement;
        return (
          active instanceof HTMLInputElement &&
          active.type === "radio" &&
          active.name === "homepage-budget"
        );
      });
      if (onBudgetRadio) break;
    }

    const focusShadow = await page.evaluate(() => {
      const label = document.activeElement?.closest("label");
      return label === null || label === undefined ? null : getComputedStyle(label).boxShadow;
    });

    expect(focusShadow, "the focused preset paints a focus ring").not.toBe("none");
  });

  test("keeps every usage title on one line", async ({ page }) => {
    const titles = page.locator("#finder-usage label span.truncate:first-of-type");
    const count = await titles.count();
    expect(count).toBe(3);

    for (let index = 0; index < count; index += 1) {
      const box = await titles.nth(index).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          height: Math.round(element.getBoundingClientRect().height),
          lineHeight: Number.parseFloat(style.lineHeight),
          whiteSpace: style.whiteSpace,
        };
      });

      expect(box.whiteSpace).toBe("nowrap");
      expect(box.height).toBe(box.lineHeight);
    }
  });

  test("truncates the long usage description instead of wrapping it", async ({ page }) => {
    const description = usageCard(page, USAGE_GAMING).locator("span.truncate").last();

    await expect(description).toHaveCSS("text-overflow", "ellipsis");
    await expect(description).toHaveCSS("white-space", "nowrap");

    const metrics = await description.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      height: Math.round(element.getBoundingClientRect().height),
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    }));

    // One line, and genuinely clipped: the untouched French copy is wider than
    // the card at 393 px, so an ellipsis is what the reader sees.
    expect(metrics.height).toBe(metrics.lineHeight);
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  });

  test("never overflows horizontally with the truncated copy", async ({ page }) => {
    for (const width of [360, 393]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(0);
    }
  });

  test("keeps the Phase 1 budget and custom-budget behaviour intact", async ({ page }) => {
    const cta = page.getByRole("button", { name: "Trouver mon PC", exact: true });
    const status = page.locator("#finder-budget legend [role='status']");

    await page.getByRole("radio", { name: BUDGET_8000 }).check({ force: true });
    await expect(status).toHaveText(/8\s?000\s?DH/);
    await expect(cta).toBeDisabled();

    await page.getByRole("radio", { name: USAGE_OFFICE }).check({ force: true });
    await expect(cta).toBeEnabled();

    await page.getByRole("button", { name: "Autre budget personnalisé" }).click();
    const amount = page.getByRole("spinbutton", { name: "Budget exact en dirhams" });
    await expect(amount).toBeFocused();

    await amount.fill("9000");
    await expect(status).toHaveText(/9\s?000\s?DH/);
    await expect(page.getByRole("radio", { name: BUDGET_8000 })).not.toBeChecked();
  });
});
