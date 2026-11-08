/**
 * Step 3.5 visual verification: seven widths, both locales, measured.
 *
 * The app must already be running (production build or dev) against an API that
 * answers — `npm run build && npm run start`, or the same plus
 * `node scripts/fixture-api.mjs` when no real API origin is reachable. Each cell
 * waits for `#configurations` and the hero preview to leave their busy state, so
 * a skeleton is never recorded as evidence.
 *
 * Usage:
 *   node scripts/measure-step35.mjs
 *   SCREENSHOT_BASE_URL=http://localhost:3230 \
 *   SCREENSHOT_OUTPUT_DIR=docs/screenshots/step-3-5/after \
 *   MEASURE_SOURCE=fixture node scripts/measure-step35.mjs
 *
 * `MEASURE_SOURCE` labels the evidence and decides the value pins:
 *   fixture (default) — the page is served by `scripts/fixture-api.mjs`, so the
 *                       fixture's own score and price are asserted exactly.
 *   served            — a real API answered; the fixture values are NOT asserted,
 *                       but the structural and per-locale formatting rules still are.
 * Using `served` against the fixture server does not make the evidence production.
 *
 * Repeat against a real API once one is reachable:
 *   NEXT_PUBLIC_API_BASE_URL=https://<api-origin> npm run build
 *   npm run start -- -p 3230
 *   SCREENSHOT_BASE_URL=http://localhost:3230 MEASURE_SOURCE=served \
 *   SCREENSHOT_OUTPUT_DIR=docs/screenshots/step-3-5/production \
 *   node scripts/measure-step35.mjs
 *
 * The hero is measured through its own hooks (`data-testid="hero-preview*"`), never
 * through a featured build card: the preview's price is a bare span that carries no
 * aria-label, so any `dd[aria-label]` lookup is the card's, not the hero's. A hero
 * value that is not rendered is reported as null; nothing is borrowed from a card.
 *
 * Writes `<width>-<locale>.png` per cell plus `measurements.json`, prints a table of
 * what it recorded, and exits 1 on any failed assertion instead of skipping it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const baseUrl = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3230";
const outputDir = path.resolve(
  process.cwd(),
  process.env.SCREENSHOT_OUTPUT_DIR ?? "docs/screenshots/step-3-5/after",
);
const source = process.env.MEASURE_SOURCE ?? "fixture";

if (source !== "fixture" && source !== "served") {
  console.error(`MEASURE_SOURCE must be "fixture" or "served", got "${source}"`);
  process.exit(2);
}

const WIDTHS = [360, 390, 430, 768, 1024, 1280, 1440];
const LOCALES = ["fr", "ar"];
const SETTLE_TIMEOUT_MS = 30_000;

// What `scripts/fixture-api.mjs` serves for the hero: GAMING at the 12,000 ceiling,
// detail score 72.5 and total price 11500. Scores follow `lib/format/score` (French
// comma, Arabic point, Latin digits); the price keeps Latin digits and the DH suffix.
const FIXTURE = {
  score: { fr: "72,5/100", ar: "72.5/100" },
  // The currency suffix is translated: French prints "DH", Arabic prints "د.م.".
  price: { fr: "11 500 DH", ar: "11 500 د.م." },
};

const normalize = (value) => value.replace(/[\s\u00a0\u202f\u2009]+/g, " ").trim();

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
const rows = [];
const failures = [];

const fail = (label, message) => failures.push(`${label}: ${message}`);

try {
  for (const width of WIDTHS) {
    for (const locale of LOCALES) {
      const cell = `${width} ${locale}`;
      const cellFailures = [];
      const cellFail = (message) => {
        cellFailures.push(message);
        fail(cell, message);
      };

      const context = await browser.newContext({
        viewport: { width, height: width < 640 ? 844 : 900 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(SETTLE_TIMEOUT_MS);

      const consoleErrors = [];
      const requestFailures = [];
      page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(`console: ${message.text()}`);
      });
      page.on("requestfailed", (request) => {
        if (/\/v1\//.test(request.url())) {
          requestFailures.push(`${request.url()} ${request.failure()?.errorText ?? ""}`.trim());
        }
      });
      page.on("response", (response) => {
        if (/\/v1\//.test(response.url()) && response.status() >= 400) {
          requestFailures.push(`${response.url()} HTTP ${response.status()}`);
        }
      });

      let loaded = true;
      try {
        await page.goto(`${baseUrl}/${locale}`, { waitUntil: "networkidle" });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        });
      } catch (error) {
        loaded = false;
        cellFail(`the page did not load: ${error instanceof Error ? error.message : error}`);
      }

      let settled = false;
      if (loaded) {
        settled = await page
          .waitForFunction(
            () => {
              const section = document.querySelector("#configurations");
              const hero = document.querySelector("[data-testid='hero-preview']");
              if (section === null || hero === null) return false;
              if (section.querySelector("[aria-busy='true']") !== null) return false;
              return hero.querySelector("[aria-busy='true']") === null;
            },
            undefined,
            { timeout: SETTLE_TIMEOUT_MS },
          )
          .then(() => true)
          .catch(() => false);
        if (!settled) cellFail("the hero or #configurations never settled (skeleton state)");
      }

      const metrics = loaded
        ? await page.evaluate(() => {
            const visible = (element) => {
              if (element == null) return false;
              const style = getComputedStyle(element);
              if (style.display === "none" || style.visibility === "hidden") return false;
              return element.getClientRects().length > 0;
            };
            const rowsOf = (elements) =>
              new Set(elements.map((element) => Math.round(element.getBoundingClientRect().top)))
                .size;
            const text = (element) => (element?.textContent ?? "").replace(/\s+/g, " ").trim();
            const smallest = (elements) =>
              elements.length === 0
                ? null
                : Math.min(
                    ...elements.map((element) => {
                      const rect = element.getBoundingClientRect();
                      return Math.round(Math.min(rect.width, rect.height));
                    }),
                  );

            // Everything hero-related is scoped to the preview's own root. The cards
            // live in #configurations, so this cannot reach one.
            const heroRoots = [...document.querySelectorAll("[data-testid='hero-preview']")];
            const hero = heroRoots[0] ?? null;
            const heroField = (name) => (hero === null ? [] : [...hero.querySelectorAll(name)]);

            const scoreNodes = heroField("[data-testid='hero-preview-score']");
            const priceNodes = heroField("[data-testid='hero-preview-price']");
            const titleNodes = heroField("[data-testid='hero-preview-title']");

            const cards = [...document.querySelectorAll("#configurations article")];
            const tiles = [...document.querySelectorAll("#pathways button")].filter(visible);
            const languages = [...document.querySelectorAll("a[hreflang]")].filter(visible);
            const nav = document.querySelector("[data-slot='mobile-nav']");

            return {
              lang: document.documentElement.lang,
              dir: document.documentElement.dir,
              overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              heroRootCount: heroRoots.length,
              heroVisible: visible(hero),
              heroState: hero?.getAttribute("data-hero-state") ?? null,
              heroScoreCount: scoreNodes.length,
              // A hidden preview is not observable evidence, so it reports null even
              // though the DOM still carries the served values. Those are kept apart so
              // the fixture pin can still prove the data loaded rather than a blank.
              heroScore: visible(hero) && scoreNodes.length === 1 ? text(scoreNodes[0]) : null,
              heroDomScore: scoreNodes.length === 1 ? text(scoreNodes[0]) : null,
              heroPriceCount: priceNodes.length,
              heroPrice: visible(hero) && priceNodes.length === 1 ? text(priceNodes[0]) : null,
              heroDomPrice: priceNodes.length === 1 ? text(priceNodes[0]) : null,
              heroTitleCount: titleNodes.length,
              heroTitle: titleNodes.length === 1 ? text(titleNodes[0]) : null,
              pathwaysVisible: visible(document.querySelector("#pathways")),
              pathwayTiles: tiles.length,
              pathwayRows: rowsOf(tiles),
              cards: cards.length,
              cardRows: rowsOf(cards),
              // The cards' own prices, kept separate so a card value can never be
              // mistaken for the hero's.
              cardPrices: [
                ...document.querySelectorAll(
                  "#configurations [data-slot='build-card'] dd[aria-label]",
                ),
              ].map((element) => text(element)),
              navVisible: visible(nav),
              localeControls: languages.length,
              smallestLocaleControl: smallest(languages),
              smallestTile: smallest(tiles),
            };
          })
        : null;

      if (metrics !== null) {
        const expectVisible = width >= 1024;

        if (metrics.heroRootCount !== 1) {
          cellFail(`expected exactly one hero preview, found ${metrics.heroRootCount}`);
        }
        if (metrics.heroScoreCount > 1) {
          cellFail(`hero score hook matched ${metrics.heroScoreCount} elements`);
        }
        if (metrics.heroPriceCount > 1) {
          cellFail(`hero price hook matched ${metrics.heroPriceCount} elements`);
        }
        if (metrics.heroTitleCount > 1) {
          cellFail(`hero title hook matched ${metrics.heroTitleCount} elements`);
        }

        if (metrics.lang !== locale) cellFail(`document lang is "${metrics.lang}"`);
        if (metrics.dir !== (locale === "ar" ? "rtl" : "ltr")) {
          cellFail(`document dir is "${metrics.dir}"`);
        }
        if (metrics.overflow !== 0) cellFail(`horizontal overflow ${metrics.overflow}px`);

        if (expectVisible) {
          if (!metrics.heroVisible)
            cellFail("the hero preview is missing where it must be visible");
          if (metrics.heroState !== "ready") {
            cellFail(`hero state is "${metrics.heroState}", expected "ready"`);
          }
          if (metrics.heroScore === null) cellFail("the hero rendered no score");
          if (metrics.heroPrice === null) cellFail("the hero rendered no price");
        } else {
          if (metrics.heroVisible) cellFail("the hero preview is visible below lg");
          if (metrics.heroScore !== null || metrics.heroPrice !== null) {
            cellFail("a hidden hero still reported a score or price");
          }
          if (source === "fixture") {
            const domToken = metrics.heroDomScore?.match(/[\d.,]+\/100/)?.[0] ?? null;
            if (domToken !== FIXTURE.score[locale]) {
              cellFail(
                `the hidden hero carries score "${domToken}", expected "${FIXTURE.score[locale]}"`,
              );
            }
            const domPrice = metrics.heroDomPrice === null ? null : normalize(metrics.heroDomPrice);
            if (domPrice !== FIXTURE.price[locale]) {
              cellFail(
                `the hidden hero carries price "${domPrice}", expected "${FIXTURE.price[locale]}"`,
              );
            }
          }
        }

        if (expectVisible && metrics.heroScore !== null) {
          const token = metrics.heroScore.match(/[\d.,]+\/100/)?.[0] ?? null;
          if (source === "fixture") {
            const expected = FIXTURE.score[locale];
            if (token !== expected) {
              cellFail(
                `hero score "${token}" != fixture "${expected}" (from "${metrics.heroScore}")`,
              );
            }
          } else if (token === null) {
            cellFail(`hero score "${metrics.heroScore}" carries no /100 value`);
          } else if (locale === "fr" && !/^\d+,\d\/100$/.test(token)) {
            cellFail(`French hero score "${token}" does not use the decimal comma`);
          } else if (locale === "ar" && !/^\d+\.\d\/100$/.test(token)) {
            cellFail(`Arabic hero score "${token}" does not use the decimal point`);
          }
        }

        if (expectVisible && metrics.heroPrice !== null) {
          const price = normalize(metrics.heroPrice);
          if (source === "fixture") {
            const expectedPrice = FIXTURE.price[locale];
            if (price !== expectedPrice) {
              cellFail(`hero price "${price}" != fixture "${expectedPrice}"`);
            }
          } else if (price.length === 0) {
            cellFail("the hero price is empty");
          }
        }

        if (metrics.pathwayTiles === 0) cellFail("no discovery tile is visible");
        const expectedTileRows = width < 640 ? 3 : 1;
        if (metrics.pathwayRows !== expectedTileRows) {
          cellFail(
            `discovery tiles use ${metrics.pathwayRows} row(s), expected ${expectedTileRows}`,
          );
        }
        if (metrics.cards !== 3)
          cellFail(`#configurations holds ${metrics.cards} cards, expected 3`);
        // The cards stack until `lg` (1024px), so 768px is still three rows.
        if (metrics.cardRows !== (width < 1024 ? 3 : 1)) {
          cellFail(`build cards use ${metrics.cardRows} row(s) at ${width}px`);
        }
        if (metrics.localeControls < 2) cellFail("fewer than two locale links are visible");
        if (metrics.smallestLocaleControl !== null && metrics.smallestLocaleControl < 24) {
          cellFail(`locale control is ${metrics.smallestLocaleControl}px, under the 24px floor`);
        }
        if (width < 640 && metrics.smallestLocaleControl !== null) {
          if (metrics.smallestLocaleControl < 44) {
            cellFail(`locale control is ${metrics.smallestLocaleControl}px, under 44px on a phone`);
          }
        }
        if (metrics.smallestTile !== null && metrics.smallestTile < 44) {
          cellFail(`a discovery tile is ${metrics.smallestTile}px, under 44px`);
        }

        for (const message of consoleErrors) cellFail(`browser error — ${message}`);
        for (const message of requestFailures) cellFail(`API request failed — ${message}`);
      }

      // Bottom-nav clearance is a scrolled-to-bottom question: the fixed bar must
      // not cover the footer's last line.
      let clearance = null;
      if (loaded) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(150);
        clearance = await page.evaluate(() => {
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
        if (clearance !== null && !clearance.clear) {
          cellFail(
            `the mobile nav covers the footer (footer ${clearance.footerBottom} > nav ${clearance.navTop})`,
          );
        }
        await page.evaluate(() => window.scrollTo(0, 0));
      }

      const file = path.join(outputDir, `${width}-${locale}.png`);
      if (loaded) await page.screenshot({ path: file, fullPage: true });

      rows.push({
        width,
        locale,
        source,
        ...(metrics ?? {}),
        footerClearOfNav: clearance?.clear ?? null,
        footerBottom: clearance?.footerBottom ?? null,
        navTop: clearance?.navTop ?? null,
        screenshot: loaded ? path.relative(process.cwd(), file) : null,
        failures: cellFailures,
      });

      const heroCell = metrics
        ? metrics.heroVisible
          ? `${metrics.heroScore ?? "no score"} / ${metrics.heroPrice ?? "no price"}`
          : "hidden (intentional below lg)"
        : "not measured";
      console.log(
        `${String(width).padStart(4)} ${locale}  overflow=${metrics?.overflow ?? "?"}  ` +
          `hero=${heroCell}  state=${metrics?.heroState ?? "?"}  ` +
          `tiles=${metrics?.pathwayTiles ?? "?"}/${metrics?.pathwayRows ?? "?"} row(s)  ` +
          `cards=${metrics?.cards ?? "?"}/${metrics?.cardRows ?? "?"} row(s)  ` +
          `cardPrices=[${(metrics?.cardPrices ?? []).join(" | ")}]  ` +
          `footerClear=${clearance?.clear ?? "n/a"}  dir=${metrics?.dir ?? "?"}  ` +
          `failures=${cellFailures.length}`,
      );

      await context.close();
    }
  }
} finally {
  await browser.close();
}

await writeFile(
  path.join(outputDir, "measurements.json"),
  `${JSON.stringify({ baseUrl, source, capturedAt: new Date().toISOString(), rows, failures }, null, 2)}\n`,
);

if (failures.length > 0) {
  console.error(`\n${failures.length} measurement failure(s):`);
  for (const message of failures) console.error(`  - ${message}`);
  console.error(`wrote ${path.relative(process.cwd(), path.join(outputDir, "measurements.json"))}`);
  process.exitCode = 1;
} else {
  console.log(
    `\n${rows.length}/${WIDTHS.length * LOCALES.length} cells measured from ${source} evidence — ` +
      `hero values read only from the hero preview`,
  );
  console.log(`wrote ${path.relative(process.cwd(), path.join(outputDir, "measurements.json"))}`);
}
