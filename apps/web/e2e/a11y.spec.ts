/**
 * apps/web/e2e/a11y.spec.ts — S21's axe sweep.
 *
 * One rule, applied to every route the site ships, in both locales: no WCAG A/AA
 * violation. The route table is deliberately explicit rather than derived from
 * the filesystem, because a route only counts once someone has decided what its
 * URL is — the results page needs a fixture id, the preset pages need a budget,
 * and a 404 is a page too. A derived list would silently stop covering the day a
 * route gained a required parameter.
 *
 * What axe proves and what it does not is recorded in `docs/design/ACCESSIBILITY_AUDIT.md`:
 * it is a machine checking what machines can check (contrast computed from the
 * rendered pixels, names, roles, landmarks, heading order, form labels, zoom).
 * Focus ORDER, what a screen reader actually says, and whether the copy makes
 * sense are the manual half, and they are written down there instead of implied
 * by a green suite.
 *
 * The wizard is audited at each of its four steps, in both languages, because the
 * step machine swaps the whole form: a violation on the priority step is not
 * visible from the usage step.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { IDS } from "../mock/fixtures.mjs";

const LOCALES = ["fr", "ar"] as const;

/** WCAG 2.0 / 2.1 / 2.2 at level A and AA — the level the brief asks for. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

interface Route {
  /** Readable in the failure, and in the audit document. */
  name: string;
  /** Path BELOW the locale prefix. */
  path: string;
  /** The status the route must answer; 200 unless it is the 404. */
  status?: number;
  /**
   * A French-only style sheet (`kit`, `tokens`): S20 left them untranslated on
   * purpose, because they are proofs of the token and component kits rather than
   * surfaces a reader visits. Their Arabic URL must answer 404 — pinned below, so
   * "French-only" stays a decision instead of an accident.
   */
  frenchOnly?: boolean;
}

const ROUTES: readonly Route[] = [
  { name: "home", path: "/" },
  { name: "wizard / usage", path: "/configurer?etape=usage" },
  { name: "wizard / budget", path: "/configurer?etape=budget&use_case=GAMING&budget_amount=9000" },
  {
    name: "wizard / resolution",
    path: "/configurer?etape=resolution&use_case=GAMING&budget_amount=9000",
  },
  {
    name: "wizard / priority",
    path: "/configurer?etape=priority&use_case=GAMING&budget_amount=9000&resolution=1440p",
  },
  { name: "result / three builds", path: `/config/${IDS.threeBuilds}` },
  { name: "result / one build", path: `/config/${IDS.oneBuild}` },
  { name: "result / demo prices", path: `/config/${IDS.demo}` },
  { name: "result / zero build with a floor", path: `/config/${IDS.zeroBuild}` },
  { name: "result / over budget", path: `/config/${IDS.overBudget}` },
  { name: "preset / committed fixture", path: "/config-pc-gamer-9000-dh" },
  { name: "preset / API-served", path: "/config-pc-gamer-20000-dh" },
  { name: "guides / index", path: "/guides" },
  { name: "guides / budget", path: "/guides/budget-pc-gamer" },
  { name: "guides / gpu", path: "/guides/choisir-un-gpu" },
  { name: "component", path: "/composants/rtx-4060-8gb" },
  // S23: the comparison is audited at the suite's 360 px viewport, i.e. the CARD
  // layout — the table is the wide representation and is `display:none` here.
  {
    name: "component / compare",
    path: "/composants/comparer?composants=rx-7600-8gb,rtx-4060-ti-gaming-oc-16-go",
  },
  { name: "kit", path: "/kit", frenchOnly: true },
  { name: "tokens", path: "/tokens", frenchOnly: true },
  { name: "format", path: "/format" },
  { name: "404", path: "/une-page-qui-nexiste-pas", status: 404 },
];

/** The violations, one line each: rule, impact, node counts and the first targets. */
async function violationsOf(page: Page): Promise<string[]> {
  // `font.ready` first: axe measures CONTRAST from what is painted, and a fallback
  // face mid-swap is a different pixel value from the shipped one.
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.map((violation) => {
    const targets = violation.nodes
      .slice(0, 3)
      .map((node) => node.target.join(" "))
      .join(" | ");
    return `${violation.id} [${violation.impact}] ${violation.nodes.length} node(s) — ${violation.help} :: ${targets}`;
  });
}

for (const locale of LOCALES) {
  for (const route of ROUTES) {
    if (route.frenchOnly === true && locale !== "fr") {
      test(`${locale} · ${route.name} is French-only (404, not an untranslated page)`, async ({
        request,
      }) => {
        expect((await request.get(`/${locale}${route.path}`)).status()).toBe(404);
      });
      continue;
    }

    test(`${locale} · ${route.name} passes axe (WCAG A/AA)`, async ({ page }) => {
      const response = await page.goto(`/${locale}${route.path}`);

      // WHICH page is audited matters as much as the result: a route that fell
      // through to an error shell once passed an axe run that never looked at the
      // page it named. The status and a real heading make that unrepresentable.
      expect(response?.status()).toBe(route.status ?? 200);
      const heading = (await page.getByRole("heading", { level: 1 }).first().innerText()).trim();
      expect(heading.length).toBeGreaterThan(0);

      const violations = await violationsOf(page);
      expect(violations.join("\n")).toBe("");
    });
  }
}

/**
 * 1.4.10 Reflow, at the zoom the brief asks for.
 *
 * Browser zoom is a CSS-pixel change, so "200 %" is the layout at half the width:
 * a 1280 px desktop at 200 % lays out at 640 px. (The 360 px phone layout is the
 * design width and is asserted at 100 % throughout the suite.) The wizard is the
 * densest surface, so it carries two of the three assertions, in both locales.
 */
test.describe("200 % zoom", () => {
  const SURFACES = [
    `/fr/configurer?etape=budget&use_case=GAMING&budget_amount=9000`,
    `/fr/config/${IDS.threeBuilds}`,
    `/ar/configurer?etape=budget&use_case=GAMING&budget_amount=9000`,
  ];

  for (const path of SURFACES) {
    test(`${path} keeps its content and stays inside 640 px`, async ({ page }) => {
      await page.setViewportSize({ width: 640, height: 800 });
      await page.goto(path);

      // Nothing is clipped away: the primary control is in the layer it should be
      // (no `display: none` from a narrower breakpoint) and is reachable.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      // Content loss is not something a scroll width can see, so the page's own
      // landmarks are required to still be in the layout at 640 px.
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeVisible();
    });
  }
});

/**
 * The brief's anti-pattern list, asserted where it can be asserted.
 *
 * Two are runtime facts — the viewport meta is readable from the served HTML, and
 * unsized images are readable from the rendered DOM. The other two cannot be seen
 * in a page at all (a click handler on a `div` looks like a working button, and a
 * `transition: all` is indistinguishable from a chosen one until something
 * animates), so those are read from the SOURCE.
 */
test.describe("interface guidelines", () => {
  test("the viewport meta never forbids zoom", async ({ request }) => {
    const html = await (await request.get("/fr")).text();
    const viewport = /<meta[^>]+name="viewport"[^>]*>/i.exec(html)?.[0] ?? "";
    expect(viewport).not.toBe("");
    expect(/user-scalable\s*=\s*no/i.test(html)).toBe(false);
    expect(/maximum-scale\s*=\s*1(\D|$)/i.test(html)).toBe(false);
  });

  /**
   * "No click handlers on non-buttons" is a SOURCE fact, so it is read from the
   * source. The rule is narrow on purpose: an `onClick` may appear only on an
   * element the platform already makes interactive (`button`, `input`, `label`,
   * `a`, `summary`, …) or on our own `Button`. The attribute list is matched up to
   * the tag's closing `>`, so a handler written on its own line is still caught.
   */
  test("no click handler is attached to a non-interactive element", () => {
    const NATIVELY_CLICKABLE = new Set([
      "button",
      "input",
      "label",
      "a",
      "summary",
      "select",
      "textarea",
      "option",
    ]);
    const offenders: string[] = [];

    const walk = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
        return entry.name.endsWith(".tsx") ? [full] : [];
      });

    for (const file of [...walk("app"), ...walk("components")]) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<([A-Za-z][\w.]*)\b((?:(?!>)[\s\S])*?)\bonClick=/g)) {
        const element = match[1];
        if (element === "Button" || NATIVELY_CLICKABLE.has(element)) continue;
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${file}:${line} <${element} onClick>`);
      }
    }

    expect(offenders.join("\n")).toBe("");
  });

  /** The animation anti-pattern: `transition: all` animates properties nobody chose. */
  test("no stylesheet transitions every property", () => {
    const offenders: string[] = [];
    const walk = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
        return entry.name.endsWith(".css") || entry.name.endsWith(".tsx") ? [full] : [];
      });

    for (const file of [...walk("app"), ...walk("components")]) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (/transition(-property)?\s*:\s*all\b/.test(line) || /\btransition-all\b/.test(line)) {
            offenders.push(`${file}:${index + 1} ${line.trim()}`);
          }
        });
    }

    expect(offenders.join("\n")).toBe("");
  });

  test("every image declares its intrinsic size", async ({ page }) => {
    for (const path of ["/fr", `/fr/config/${IDS.threeBuilds}`, "/fr/composants/rtx-4060-8gb"]) {
      await page.goto(path);
      const unsized = await page.evaluate(() =>
        [...document.querySelectorAll("img")]
          .filter((image) => image.getAttribute("width") === null || image.getAttribute("height") === null)
          .map((image) => image.getAttribute("src") ?? "(no src)"),
      );
      expect(unsized.join(", "), `${path} has unsized images`).toBe("");
    }
  });
});
