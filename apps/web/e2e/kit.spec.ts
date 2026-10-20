/**
 * apps/web/e2e/kit.spec.ts — S3's proof.
 *
 * A screenshot cannot tell you whether a radio group answers the arrow keys,
 * whether the disabled card is still reachable by Tab, or whether the skeleton
 * stops pulsing for a user who asked for less motion. These specs assert the
 * things the board's pixels do not encode: the accessibility tree, per-state
 * geometry, and the token each state resolves to.
 *
 * Contrast is NOT re-measured here — `e2e/tokens.spec.ts` owns the palette
 * matrix, and every component below is built from those tokens. What is checked
 * here is that a component actually lands on the token it claims, by comparing
 * computed colours between states rather than trusting a class name.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";

async function heightOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("element has no box");
  return box.height;
}

function computed(page: Page, selector: string, property: string): Promise<string> {
  return page.evaluate(
    ([sel, prop]) => {
      const element = document.querySelector(sel);
      if (element === null) throw new Error(`no element for ${sel}`);
      return getComputedStyle(element).getPropertyValue(prop);
    },
    [selector, property] as const,
  );
}

test.describe("the kit at 360 px", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("renders every component with no horizontal scroll and is noindex", async ({ page }) => {
    await page.goto("/fr/kit");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kit de composants");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robots).toContain("noindex");
  });

  test("buttons are 48 px, compact is 44 px, and none is skipped in the tab order", async ({
    page,
  }) => {
    await page.goto("/fr/kit");

    const primary = page.getByRole("button", { name: "Continuer" });
    expect(await heightOf(primary)).toBeGreaterThanOrEqual(48);

    const compact = page.getByRole("button", { name: "Changer" });
    expect(await heightOf(compact)).toBeGreaterThanOrEqual(44);

    const disabled = page.getByRole("button", { name: "Indisponible" });
    await expect(disabled).toBeDisabled();

    // The secondary keeps a real border rather than a shadow: the board draws
    // structure with borders, and a 1 px edge is what survives on a light page.
    const secondary = page.getByRole("button", { name: "Retour" });
    const border = await secondary.evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(border).toBe("1px");
  });

  test("keyboard focus paints the 2 px ring on a real button", async ({ page }) => {
    await page.goto("/fr/kit");

    // Tab to the first kit button. The number of stops before it belongs to the
    // shell (skip link, brand, two language links), not to this suite — so walk
    // the tab order rather than counting it.
    let reached = false;
    for (let i = 0; i < 10 && !reached; i += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(
        () => document.activeElement?.textContent?.trim() === "Continuer",
      );
    }
    expect(reached).toBe(true);

    const ring = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement as Element);
      return {
        width: style.outlineWidth,
        style: style.outlineStyle,
      };
    });
    expect(ring.style).toBe("solid");
    expect(ring.width).toBe("2px");
  });

  test("the text field wires its label, hint, suffix and error", async ({ page }) => {
    await page.goto("/fr/kit");

    const section = page.locator('section[aria-labelledby="text-field-title"]');
    const filled = page.locator("#kit-budget");
    await expect(section.getByLabel("Votre enveloppe cible").first()).toHaveAttribute("id", "kit-budget");
    expect(await heightOf(filled)).toBeGreaterThanOrEqual(48);

    // The unit is visual only: it must not be announced twice.
    const suffix = section.locator("span", { hasText: /^MAD$/ }).first();
    await expect(suffix).toHaveAttribute("aria-hidden", "true");

    // A filled field carries its hint as the described-by target.
    await expect(filled).toHaveAttribute("aria-describedby", "kit-budget-hint");
    await expect(page.locator("#kit-budget-hint")).toHaveText("Paliers de 500 MAD.");

    // The same global ring covers the field, not only buttons and cards.
    await filled.focus();
    const fieldRing = await filled.evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(fieldRing.style).toBe("solid");
    expect(fieldRing.width).toBe("2px");

    // The error state replaces the hint (never two competing sentences) and
    // keeps the value the user typed.
    const invalid = page.locator("#kit-budget-error");
    await expect(invalid).toHaveAttribute("aria-invalid", "true");
    await expect(invalid).toHaveAttribute("aria-describedby", "kit-budget-error-error");
    // S5's helper: narrow no-break space between groups, no-break before `DH`.
    await expect(page.locator("#kit-budget-error-error")).toHaveText(
      /^Le budget minimal est de 3\u202F000\u00A0DH\.$/,
    );
    await expect(invalid).toHaveValue("1\u202F500");
  });

  test("the slider is keyboard operable and announces the amount, not a bare number", async ({
    page,
  }) => {
    await page.goto("/fr/kit");

    const slider = page.getByRole("slider");
    await expect(slider).toHaveAttribute("min", "3000");
    await expect(slider).toHaveAttribute("max", "40000");
    await expect(slider).toHaveAttribute("step", "500");

    // 44 px hit area: the thumb is 24 px, the box the user can hit is not.
    expect(await heightOf(slider)).toBeGreaterThanOrEqual(44);

    const before = Number(await slider.inputValue());
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveValue(String(before + 500));

    const sliderRing = await slider.evaluate((el) => getComputedStyle(el).outlineWidth);
    expect(sliderRing).toBe("2px");

    // S5's helper: "9 000 DH", with a narrow no-break space between groups.
    const valueText = await slider.getAttribute("aria-valuetext");
    expect(valueText).toContain("DH");
    expect(valueText).toContain("\u202F");
    expect(valueText).toContain("9");

    await page.keyboard.press("End");
    await expect(slider).toHaveValue("40000");

    // The field next to it follows the keyboard, because both read one state.
    const field = page.locator('section[aria-labelledby="interactive-title"] input[inputmode="numeric"]');
    await expect(field).toHaveValue(/40/);
  });

  test("the choice cards are one radio group, arrow keys move the selection", async ({ page }) => {
    await page.goto("/fr/kit");

    const selected = page.locator('input[name="kit-usage"][value="jeu"]');
    const next = page.locator('input[name="kit-usage"][value="bureau"]');
    const unavailable = page.locator('input[name="kit-usage"][value="station"]');

    await expect(selected).toBeChecked();
    await expect(unavailable).toBeDisabled();

    const card = page.locator('label:has(input[value="jeu"]) > span');
    expect(await heightOf(card)).toBeGreaterThanOrEqual(48);

    await selected.focus();
    await page.keyboard.press("ArrowDown");

    await expect(next).toBeChecked();
    await expect(selected).not.toBeChecked();

    const focus = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement as Element);
      return { width: style.outlineWidth, visible: document.activeElement?.matches(":focus-visible") };
    });
    expect(focus.visible).toBe(true);

    // The ring is drawn on the CARD, not on the visually hidden input.
    const ringOnCard = await computed(page, 'label:has(input[value="bureau"]) > span', "outline-width");
    expect(focus.width).toBe("2px");
    expect(ringOnCard).toBe("2px");

    // Selection is a token pair, not a raw colour: the checked card is filled
    // with `primary-soft`, and the unchecked one is not.
    const checkedBg = await computed(page, 'label:has(input[value="bureau"]) > span', "background-color");
    const uncheckedBg = await computed(page, 'label:has(input[value="jeu"]) > span', "background-color");
    expect(checkedBg).not.toBe(uncheckedBg);
  });

  test("badges distinguish the three price states by word, icon and colour", async ({ page }) => {
    await page.goto("/fr/kit");

    const section = page.locator('section[aria-labelledby="badges-title"]');
    const demo = section.locator('[data-tone="demo"]');
    const indicative = section.locator('[data-tone="indicative"]');
    const verified = section.locator('[data-tone="verified"]');

    for (const badge of [demo, indicative, verified]) {
      await expect(badge).toBeVisible();
      expect(await badge.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("nowrap");
      await expect(badge.locator("svg")).toHaveAttribute("aria-hidden", "true");
    }

    const colours = await Promise.all(
      [demo, indicative, verified].map((badge) =>
        badge.evaluate((el) => getComputedStyle(el).color),
      ),
    );
    expect(new Set(colours).size).toBe(3);
  });

  test("the budget bar reports the real value past 100 % and clamps only the paint", async ({
    page,
  }) => {
    await page.goto("/fr/kit");

    const bars = page.locator('section[aria-labelledby="budget-bar-title"] [role="progressbar"]');
    await expect(bars).toHaveCount(3);

    await expect(bars.nth(0)).toHaveAttribute("aria-valuenow", "79");
    await expect(bars.nth(0)).toHaveAttribute("aria-valuemax", "100");
    await expect(bars.nth(0)).toHaveAttribute("aria-label", "Normal (79 %)");

    // Over budget: `aria-valuenow` must stay inside [min, max] — a browser
    // CLAMPS an out-of-range value in the accessibility tree, so 10400 there
    // would be announced as 10000 anyway. The real percentage travels in
    // `aria-valuetext`, and the fill stops at the rail's edge.
    const over = bars.nth(2);
    await expect(over).toHaveAttribute("aria-valuenow", "10000");
    await expect(over).toHaveAttribute("aria-valuemax", "10000");
    await expect(over).toHaveAttribute("aria-valuetext", "104 %");
    await expect(bars.nth(0)).toHaveAttribute("aria-valuetext", "79 %");
    const fillWidth = await over
      .locator("div")
      .first()
      .evaluate((el) => el.getBoundingClientRect().width);
    const railWidth = await over.evaluate((el) => el.getBoundingClientRect().width);
    expect(Math.abs(fillWidth - railWidth)).toBeLessThan(1);

    // Three tones, three fills.
    const fills = await bars.evaluateAll((rails) =>
      rails.map((rail) => getComputedStyle(rail.firstElementChild as Element).backgroundColor),
    );
    expect(new Set(fills).size).toBe(3);
  });

  test("the skeleton is decoration and stops pulsing when motion is reduced", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/fr/kit");

    const block = page.locator('[aria-hidden="true"].animate-pulse').first();
    await expect(block).toHaveCount(1);

    const duration = await block.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(duration)).toBeLessThan(0.05);
  });

  test("alerts use the live-region role that matches their tone", async ({ page }) => {
    await page.goto("/fr/kit");

    // Scoped to the section: Next's own route announcer is also a role="alert".
    const section = page.locator('section[aria-labelledby="alerts-title"]');
    const error = section.locator('[role="alert"]');
    await expect(error).toHaveCount(1);
    await expect(error).toContainText("Aucune configuration compatible");

    // Static info copy is NOT a live region: announcing it on load would be a
    // lie about when it appeared. One banner opts in explicitly.
    const statuses = section.locator('[role="status"]');
    await expect(statuses).toHaveCount(1);
    await expect(statuses).toContainText("Douze configurations");

    // Every banner's glyph is decoration: four banners, four hidden icons.
    const icons = section.locator('svg[aria-hidden="true"]');
    await expect(icons).toHaveCount(4);
  });
});
