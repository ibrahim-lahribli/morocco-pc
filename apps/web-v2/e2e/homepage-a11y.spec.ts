import { expect, test, type Page } from "@playwright/test";

import { contrastRatio, parseCssColor } from "../lib/a11y/contrast";
import { stubHomepageApi } from "./support/homepage-api";
import { waitForSettledCards } from "./support/homepage-ready";

/**
 * Homepage accessibility evidence.
 *
 * Every assertion measures the rendered page, so it fails when a token, a class
 * or a landmark changes — a unit test over class names would not. The thresholds
 * are the standards themselves, not this page's current values:
 *
 * - heading order: one `h1`, no skipped level (WCAG 1.3.1);
 * - landmarks: every `<section>` has a name (WCAG 1.3.1, 2.4.6);
 * - focus: the skip link is the first stop (WCAG 2.4.1), the Tab order matches
 *   the page's own focusable DOM exactly — no skipped control, no trapped focus
 *   — and every stop paints a visible indicator (WCAG 2.4.7);
 * - targets: 24 CSS px minimum at every width (WCAG 2.2 AA 2.5.8), the project's
 *   own 44 px floor (`--spacing-tap`) on phone widths, and 44 px for the locale
 *   switcher at EVERY width;
 * - contrast: 4.5:1 for the body copy and both calls to action (WCAG 1.4.3).
 *
 * The text colour is painted over the nearest opaque surface and read back from a
 * canvas, so a `text-on-primary/80` line is measured as the colour the reader
 * sees, whatever serialisation Chromium chose for it.
 */

const WIDTHS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
] as const;

/** Below Tailwind's `sm` the design's 48 px control scale applies. */
const PHONE_MAX = 640;

/** The two locales every structural assertion runs in. */
const LOCALES = ["fr", "ar"] as const;

const FINAL_CTA = "section[aria-labelledby='final-cta-title']";

/** Every finger-operated control the homepage renders in its default state. */
const CONTROLS = [
  "header a",
  "nav a",
  "nav button",
  "#finder-budget label:has(input[type='radio'])",
  "#finder-usage label:has(input[type='radio'])",
  "#homepage-custom-budget",
  "#finder-budget button[aria-expanded]",
  "#pathways button",
  "#configurations a",
  "#configurations button",
  `${FINAL_CTA} a`,
  `${FINAL_CTA} button`,
].join(", ");

interface Control {
  tag: string;
  text: string;
  width: number;
  height: number;
}

async function measureControls(page: Page): Promise<Control[]> {
  return page.evaluate((selector) => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      return element.getClientRects().length > 0;
    };

    return [...document.querySelectorAll(selector)].filter(visible).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    });
  }, CONTROLS);
}

interface Pair {
  selector: string;
  color: string;
  background: string;
}

/** Reads the painted text colour and the nearest opaque surface behind it. */
async function readPairs(page: Page, selectors: string[]): Promise<Pair[]> {
  return page.evaluate((list) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });

    /**
     * Paints the text colour over its surface and reads the pixel back. The
     * browser resolves `oklab(...)`, `color-mix(...)` and alpha itself, so this
     * never has to guess at a serialisation.
     */
    const paint = (color: string, background: string): string => {
      if (context === null) return color;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = background;
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
      return `rgb(${red}, ${green}, ${blue})`;
    };

    return list.flatMap((selector) => {
      const element = document.querySelector(selector);
      if (element === null) return [];

      let background = "";
      let node: Element | null = element;
      while (node !== null) {
        const candidate = getComputedStyle(node).backgroundColor;
        if (candidate !== "" && candidate !== "transparent" && candidate !== "rgba(0, 0, 0, 0)") {
          background = candidate;
          break;
        }
        node = node.parentElement;
      }

      if (background === "") return [];

      return [{ selector, color: paint(getComputedStyle(element).color, background), background }];
    });
  }, selectors);
}

test("keeps one h1 and never skips a heading level", async ({ page }) => {
  await stubHomepageApi(page);

  for (const locale of LOCALES) {
    for (const { width, height } of WIDTHS) {
      await page.setViewportSize({ width, height });
      await page.goto(`/${locale}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const levels = await page.evaluate(() =>
        [...document.querySelectorAll("main h1, main h2, main h3, main h4")].map((element) =>
          Number(element.tagName.slice(1)),
        ),
      );

      expect(levels.length, `headings at ${width}px in ${locale}`).toBeGreaterThan(0);
      expect(
        levels.filter((level) => level === 1),
        `h1 count at ${width}px in ${locale}`,
      ).toHaveLength(1);

      for (let index = 1; index < levels.length; index += 1) {
        expect(
          levels[index]! - levels[index - 1]!,
          `h${levels[index - 1]} then h${levels[index]} at ${width}px in ${locale}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  }
});

test("gives every section an accessible name", async ({ page }) => {
  await stubHomepageApi(page);

  for (const locale of LOCALES) {
    await page.goto(`/${locale}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const sections = await page.evaluate(() =>
      [...document.querySelectorAll("main section")].map((section) => {
        const labelledBy = section.getAttribute("aria-labelledby");
        const label =
          labelledBy === null ? "" : (document.getElementById(labelledBy)?.textContent ?? "");
        return {
          literal: section.getAttribute("aria-label") ?? "",
          label: label.replace(/\s+/g, " ").trim(),
        };
      }),
    );

    expect(sections.length, `sections in ${locale}`).toBeGreaterThanOrEqual(6);

    for (const section of sections) {
      expect(
        section.label !== "" || section.literal !== "",
        `section in ${locale}: ${JSON.stringify(section)}`,
      ).toBe(true);
    }
  }
});

interface FocusStop {
  role: string;
  name: string;
  outline: number;
  shadow: string;
}

/**
 * The focus stops the page's own DOM offers, in Tab order.
 *
 * Computed from the document rather than hard-coded, so adding or removing a
 * control updates the expectation instead of breaking a count. A native radio
 * group contributes one stop (its checked option) and no stop when nothing is
 * checked, which is exactly how a browser tabs through it.
 */
async function expectedFocusOrder(page: Page): Promise<Array<{ role: string; name: string }>> {
  return page.evaluate(() => {
    const SELECTOR =
      "a[href], button, input:not([type='hidden']), select, textarea, [tabindex]:not([tabindex='-1'])";

    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return element.getClientRects().length > 0;
    };

    const nameOf = (element: Element): string => {
      const aria = element.getAttribute("aria-label");
      if (aria !== null && aria.trim() !== "") return aria.replace(/\s+/g, " ").trim();
      if (element instanceof HTMLInputElement) {
        if (element.labels !== null && element.labels.length > 0) {
          return [...element.labels]
            .map((label) => label.textContent ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        }
        return element.value;
      }
      return (element.textContent ?? "").replace(/\s+/g, " ").trim();
    };

    const order: Array<{ role: string; name: string }> = [];
    const groups = new Set<string>();

    for (const element of document.querySelectorAll<HTMLElement>(SELECTOR)) {
      if (!visible(element)) continue;
      if (element.hasAttribute("disabled")) continue;
      if (element.getAttribute("aria-disabled") === "true") continue;

      if (element instanceof HTMLInputElement && element.type === "radio") {
        if (groups.has(element.name)) continue;
        groups.add(element.name);
        const group = `input[type='radio'][name='${CSS.escape(element.name)}']`;
        // A browser focuses the checked option, or the first one when the group
        // has no answer yet: that is the single stop the group contributes.
        const selected =
          document.querySelector<HTMLInputElement>(`${group}:checked`) ??
          document.querySelector<HTMLInputElement>(group);
        if (selected === null) continue;
        order.push({ role: "input", name: nameOf(selected) });
        continue;
      }

      order.push({ role: element.tagName.toLowerCase(), name: nameOf(element) });
    }

    return order;
  });
}

/** The focused element, named the same way as the expected list above. */
async function activeStop(page: Page): Promise<FocusStop | null> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (element === null) return null;

    const nameOf = (node: Element): string => {
      const aria = node.getAttribute("aria-label");
      if (aria !== null && aria.trim() !== "") return aria.replace(/\s+/g, " ").trim();
      if (node instanceof HTMLInputElement) {
        if (node.labels !== null && node.labels.length > 0) {
          return [...node.labels]
            .map((label) => label.textContent ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        }
        return node.value;
      }
      return (node.textContent ?? "").replace(/\s+/g, " ").trim();
    };

    const style = getComputedStyle(element);
    return {
      role: element.tagName.toLowerCase(),
      name: nameOf(element),
      outline: Number.parseFloat(style.outlineWidth) || 0,
      shadow: style.boxShadow,
    };
  });
}

test("walks exactly the page's own focusable elements, in order", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubHomepageApi(page);
  await page.goto("/fr");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Hydration replaces the tree: a Tab pressed mid-render can land on body.
  await waitForSettledCards(page);

  const expected = await expectedFocusOrder(page);
  expect(expected.length, `expected stops: ${JSON.stringify(expected)}`).toBeGreaterThanOrEqual(8);

  const visited: FocusStop[] = [];

  // Keyboard input follows the frontmost page: a page left in the background by
  // a parallel worker can swallow Tab and report body as active.
  for (let press = 0; press < expected.length + 3; press += 1) {
    await page.bringToFront();
    await page.keyboard.press("Tab");

    const stop = await activeStop(page);
    // The browser chrome and the Next dev overlay (`nextjs-portal`) are the page's
    // boundary: reaching either means every stop this page owns was visited.
    if (stop === null || stop.role === "body" || stop.role === "nextjs-portal") break;

    visited.push(stop);
  }

  expect(
    visited.map(({ role, name }) => ({ role, name })),
    `Tab order: ${JSON.stringify(visited)} expected: ${JSON.stringify(expected)}`,
  ).toEqual(expected);

  expect(visited[0]?.role, "the skip link is the first stop").toBe("a");
  expect(visited[0]?.name.length ?? 0).toBeGreaterThan(0);
  expect(visited[0]!.outline, "skip link outline").toBeGreaterThanOrEqual(2);

  for (const stop of visited) {
    expect(
      stop.outline >= 2 || stop.shadow !== "none",
      `${stop.role} "${stop.name}" paints no focus indicator`,
    ).toBe(true);
  }
});

test("keeps every control at the WCAG minimum and the locale switcher at 44 px", async ({
  page,
}) => {
  await stubHomepageApi(page);

  for (const { width, height } of WIDTHS) {
    await page.setViewportSize({ width, height });
    await page.goto("/fr");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const controls = await measureControls(page);
    expect(controls.length, `controls at ${width}px`).toBeGreaterThan(0);

    const floor = width < PHONE_MAX ? 44 : 24;

    for (const control of controls) {
      expect(
        Math.min(control.width, control.height),
        `${control.tag} "${control.text}" at ${width}px`,
      ).toBeGreaterThanOrEqual(floor);
    }

    // The project's own 44 px floor, not the WCAG one: two language links are the
    // smallest controls in the header, and a 36 px variant shipped once.
    const languages = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("a[hreflang]")]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            lang: element.getAttribute("hreflang") ?? "?",
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        }),
    );

    expect(languages.length, `locale links at ${width}px`).toBe(2);
    for (const language of languages) {
      expect(
        Math.min(language.width, language.height),
        `${language.lang} locale link at ${width}px`,
      ).toBeGreaterThanOrEqual(44);
    }
  }
});

test("keeps body copy and both calls to action above 4.5:1", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await stubHomepageApi(page);

  for (const locale of LOCALES) {
    await page.goto(`/${locale}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await waitForSettledCards(page);

    const pairs = await readPairs(page, [
      "#configurations article .text-muted",
      `${FINAL_CTA} p.text-body-md`,
      `${FINAL_CTA} button`,
      "#final-cta-title",
    ]);

    expect(pairs, `measurable pairs in ${locale}`).toHaveLength(4);

    for (const pair of pairs) {
      const ratio = contrastRatio(parseCssColor(pair.color), parseCssColor(pair.background));
      expect(
        Number(ratio.toFixed(2)),
        `${locale} ${pair.selector}: ${pair.color} on ${pair.background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("announces the finder's budget status and its range error", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubHomepageApi(page);
  await page.goto("/fr");
  await waitForSettledCards(page);

  const status = page.locator("#finder-budget [role='status']");
  await expect(status).toHaveCount(1);
  await expect(status).toHaveText("À définir");

  await page.getByRole("radio", { name: /Budget de 12\s?000\s?DH/ }).check({ force: true });
  await expect(status).toHaveText(/12\s?000\s?DH/);

  await page.getByRole("button", { name: "Autre budget personnalisé" }).click();
  const amount = page.getByRole("spinbutton", { name: "Budget exact en dirhams" });
  await amount.fill("1000");

  const alert = page.locator("#homepage-custom-budget-error");
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toHaveText(/Saisissez un budget entre 3\s?500 et 100\s?000\s?DH/);
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expect(amount).toHaveAttribute("aria-describedby", /homepage-custom-budget-error/);
  await expect(status).toHaveText("À définir");

  await amount.fill("7000");
  await expect(alert).toHaveCount(0);
  await expect(amount).not.toHaveAttribute("aria-invalid", "true");
  await expect(status).toHaveText(/7\s?000\s?DH/);
});

test("renders the homepage without a console error", async ({ page }) => {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // The dev server answers /favicon.ico with a 404, which the browser logs as a
    // resource error that has nothing to do with this page.
    if (message.location().url.includes("favicon")) return;
    errors.push(`${message.text()} (${message.location().url})`);
  });

  await stubHomepageApi(page);

  for (const locale of LOCALES) {
    errors.length = 0;
    await page.goto(`/${locale}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");

    expect(errors, `console on /${locale}`).toEqual([]);
  }
});
