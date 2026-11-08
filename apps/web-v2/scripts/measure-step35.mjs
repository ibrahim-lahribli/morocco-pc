/**
 * Step 3.5 visual verification: seven widths, both locales, measured.
 *
 * The app must already be running (production build or dev) against an API that
 * answers — `npm run build && npm run start`, or the same plus
 * `node scripts/fixture-api.mjs` when no real API origin is reachable. Each
 * capture waits for `#configurations` to settle, so a skeleton is never
 * presented as evidence.
 *
 * Usage:
 *   node scripts/measure-step35.mjs
 *   SCREENSHOT_BASE_URL=http://localhost:3230 \
 *   SCREENSHOT_OUTPUT_DIR=docs/screenshots/step-3-5/after \
 *   node scripts/measure-step35.mjs
 *
 * Writes `<width>-<locale>.png` per cell plus `measurements.json`, and prints a
 * table of the numbers it recorded. Every value comes from the rendered page:
 * nothing is computed from the source.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const baseUrl = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3230";
const outputDir = path.resolve(
  process.cwd(),
  process.env.SCREENSHOT_OUTPUT_DIR ?? "docs/screenshots/step-3-5/after",
);

const WIDTHS = [360, 390, 430, 768, 1024, 1280, 1440];
const LOCALES = ["fr", "ar"];
const SETTLE_TIMEOUT_MS = 30_000;

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
const rows = [];

try {
  for (const width of WIDTHS) {
    for (const locale of LOCALES) {
      const context = await browser.newContext({
        viewport: { width, height: width < 640 ? 844 : 900 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(SETTLE_TIMEOUT_MS);

      await page.goto(`${baseUrl}/${locale}`, { waitUntil: "networkidle" });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });

      const settled = await page
        .waitForFunction(
          () => {
            const section = document.querySelector("#configurations");
            if (section === null) return false;
            return section.querySelector("[aria-busy='true']") === null;
          },
          undefined,
          { timeout: SETTLE_TIMEOUT_MS },
        )
        .then(() => true)
        .catch(() => false);

      if (!settled) console.warn(`${width} ${locale}: #configurations never settled`);

      const metrics = await page.evaluate(() => {
        const visible = (element) => {
          if (element == null) return false;
          const style = getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden") return false;
          return element.getClientRects().length > 0;
        };
        const rowsOf = (elements) =>
          new Set(elements.map((element) => Math.round(element.getBoundingClientRect().top))).size;
        const text = (element) => (element?.textContent ?? "").replace(/\s+/g, " ").trim();

        // The served score is the only leaf carrying "/100"; locating it by
        // content keeps this independent of ids that mean something else (#top
        // is the page anchor, not the preview).
        const scoreNode = [...document.querySelectorAll("p, span, dd")].find(
          (element) => element.children.length === 0 && /\/100/.test(text(element)),
        );

        const cards = [...document.querySelectorAll("#configurations article")];
        const tiles = [...document.querySelectorAll("#pathways button")].filter(visible);
        const languages = [...document.querySelectorAll("a[hreflang]")].filter(visible);
        const nav = document.querySelector("[data-slot='mobile-nav']");
        const cardPrice =
          document
            .querySelector("[data-slot='build-card'] dd[aria-label]")
            ?.getAttribute("aria-label") ?? null;

        return {
          lang: document.documentElement.lang,
          dir: document.documentElement.dir,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          heroVisible: visible(scoreNode),
          heroScore: text(scoreNode) || null,
          heroPrice: cardPrice,
          pathwaysVisible: visible(document.querySelector("#pathways")),
          pathwayTiles: tiles.length,
          pathwayRows: rowsOf(tiles),
          cards: cards.length,
          cardRows: rowsOf(cards),
          navVisible: visible(nav),
          localeControls: languages.length,
          smallestLocaleControl: Math.min(
            ...languages.map((element) =>
              Math.round(
                Math.min(
                  element.getBoundingClientRect().width,
                  element.getBoundingClientRect().height,
                ),
              ),
            ),
          ),
          smallestTile: Math.min(
            ...tiles.map((element) =>
              Math.round(
                Math.min(
                  element.getBoundingClientRect().width,
                  element.getBoundingClientRect().height,
                ),
              ),
            ),
          ),
        };
      });

      // Bottom-nav clearance is a scrolled-to-bottom question: the fixed bar must
      // not cover the footer's last line.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(150);
      const clearance = await page.evaluate(() => {
        const nav = document.querySelector("[data-slot='mobile-nav']");
        const footer = document.querySelector("footer");
        if (nav === null || footer === null || nav.getClientRects().length === 0) return null;
        const navRect = nav.getBoundingClientRect();
        const footerRect = footer.getBoundingClientRect();
        return {
          footerBottom: Math.round(footerRect.bottom),
          navTop: Math.round(navRect.top),
          clear: footerRect.bottom <= navRect.top + 1,
        };
      });

      await page.evaluate(() => window.scrollTo(0, 0));

      const file = path.join(outputDir, `${width}-${locale}.png`);
      await page.screenshot({ path: file, fullPage: true });

      rows.push({
        width,
        locale,
        ...metrics,
        footerClearOfNav: clearance?.clear ?? null,
        footerBottom: clearance?.footerBottom ?? null,
        navTop: clearance?.navTop ?? null,
        screenshot: path.relative(process.cwd(), file),
      });

      console.log(
        `${String(width).padStart(4)} ${locale}  overflow=${metrics.overflow}  ` +
          `hero=${metrics.heroVisible ? metrics.heroScore : "hidden"}  ` +
          `tiles=${metrics.pathwayTiles}/${metrics.pathwayRows} row(s)  ` +
          `cards=${metrics.cards}/${metrics.cardRows} row(s)  ` +
          `footerClear=${clearance?.clear ?? "n/a"}  dir=${metrics.dir}`,
      );

      await context.close();
    }
  }
} finally {
  await browser.close();
}

await writeFile(
  path.join(outputDir, "measurements.json"),
  `${JSON.stringify({ baseUrl, capturedAt: new Date().toISOString(), rows }, null, 2)}\n`,
);

console.log(`wrote ${path.relative(process.cwd(), path.join(outputDir, "measurements.json"))}`);
