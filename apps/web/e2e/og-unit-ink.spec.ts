/**
 * apps/web/e2e/og-unit-ink.spec.ts — D-31's pin: the Arabic dirham's INK order
 * on the two share cards.
 *
 * The cards are Satori output. Satori lays text out in LOGICAL order and applies
 * no bidi, so handing it `formatMoney()`'s unit `د.م.` painted it backwards
 * (letter, dot, letter, dot). The fix is the VISUAL-order string in
 * `lib/i18n/og-unit.ts`; this spec is what makes a renderer upgrade that starts
 * applying bidi fail LOUDLY instead of quietly reversing it a second time.
 *
 * It cannot be answered from the DOM — there is no text node in a PNG — and a
 * regex over the source only proves what we WROTE, not what Satori DREW. So the
 * card is fetched, decoded through a canvas in the browser, and measured as ink:
 *
 *   1. rows are thresholded to the card's INK colour (#0f172a, luma ~18). The
 *      threshold of 48 also excludes the brand-blue tile (#1d4ed8, luma 79) and
 *      the muted labels (#64748b, luma 114), so what remains is the wordmark and
 *      the headline;
 *   2. the TALLEST ink band is the headline (96 px on the result card, 104 px on
 *      the preset card — both taller than the 36 px wordmark);
 *   3. inside it, columns with ink form runs. The money string ends with the
 *      unit, so the unit is the FOUR rightmost runs, and their left-to-right
 *      widths spell the reading order: dot, م, dot, د.
 *
 * The expected signature is therefore dot(11) letter(41) dot(11) letter(37) on
 * the result card's 96 px type, and dot(11) letter(44) dot(11) letter(39) on the
 * preset card's 104 px type: the two cards do not share a type size, so they do
 * not share pixel widths, and each is pinned to within 1 px. Measured
 * 2026-11-05 at luma < 48: [10, 40, 10, 37] and [11, 44, 11, 39]. A bidi pass
 * would turn either into [40, 10, 37, 10] and fail the assertion, which names
 * the measured runs.
 *
 * The second test covers the other half of D-28: there is NO other Arabic text
 * on either card. The unit is the only non-Latin string either renderer
 * receives, and the two card modules carry no Arabic code point at all.
 */
import fs from "node:fs";
import path from "node:path";

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

import { formatMoney, formatNumber } from "../lib/i18n/format";
import { formatOgMoney, OG_ARABIC_UNIT } from "../lib/i18n/og-unit";
import { IDS } from "../mock/fixtures.mjs";

const RESULT = `/ar/config/${IDS.threeBuilds}`;
const PRESET = "/ar/config-pc-gamer-9000-dh";

/** An ink run: the columns a glyph (or a touching pair) actually paints. */
interface InkRun {
  left: number;
  right: number;
  width: number;
}

interface CardInk {
  size: { width: number; height: number };
  bands: { top: number; bottom: number; height: number }[];
  headline: { top: number; bottom: number };
  runs: InkRun[];
}

/**
 * Fetch one card image from the running app and measure its ink. Runs in the
 * page so the PNG is decoded by the same Chromium that renders the app, at the
 * route's own 1200 x 630 — nothing is scaled on the way in.
 */
async function measureCard(page: Page, imageUrl: string): Promise<CardInk> {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`og:image answered ${response.status} for ${url}`);
    const bitmap = await createImageBitmap(
      new Blob([await response.arrayBuffer()], { type: "image/png" }),
    );
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, width, height);

    // Ink = the card's #0f172a. 48 keeps antialiased edges, excludes the blue
    // tile and every muted label (see the header).
    const ink = new Uint8Array(width * height);
    for (let i = 0; i < ink.length; i += 1) {
      const p = i * 4;
      const luma = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      ink[i] = luma < 48 ? 1 : 0;
    }

    const rowInk = new Array<number>(height).fill(0);
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) rowInk[y] += ink[row + x];
    }

    const bands: { top: number; bottom: number }[] = [];
    let open = -1;
    for (let y = 0; y < height; y += 1) {
      if (rowInk[y] > 0 && open === -1) open = y;
      if (rowInk[y] === 0 && open !== -1) {
        bands.push({ top: open, bottom: y - 1 });
        open = -1;
      }
    }
    if (open !== -1) bands.push({ top: open, bottom: height - 1 });
    if (bands.length === 0) throw new Error("the card carries no ink at all");

    const tallest = bands.reduce((best, band) =>
      band.bottom - band.top > best.bottom - best.top ? band : best,
    );

    const columns = new Array<number>(width).fill(0);
    for (let y = tallest.top; y <= tallest.bottom; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) columns[x] += ink[row + x];
    }

    const runs: { left: number; right: number; width: number }[] = [];
    let runStart = -1;
    for (let x = 0; x < width; x += 1) {
      if (columns[x] > 0 && runStart === -1) runStart = x;
      if (columns[x] === 0 && runStart !== -1) {
        runs.push({ left: runStart, right: x - 1, width: x - runStart });
        runStart = -1;
      }
    }
    if (runStart !== -1) runs.push({ left: runStart, right: width - 1, width: width - runStart });

    return {
      size: { width, height },
      bands: bands.map((band) => ({ ...band, height: band.bottom - band.top + 1 })),
      headline: tallest,
      runs,
    };
  }, imageUrl);
}

/** The share card's own image URL, read off the page's og:image metadata. */
async function cardImageUrl(
  request: APIRequestContext,
  pagePath: string,
  origin: string,
): Promise<string> {
  const html = await (await request.get(`${origin}${pagePath}`)).text();
  const match = /property="og:image"\s+content="([^"]+)"/.exec(html);
  expect(match, `${pagePath} must advertise an image`).not.toBeNull();
  return (match as RegExpMatchArray)[1].replace(/&amp;/g, "&");
}

/** `[dot, م, dot, د]` at the result card's 96 px (measured 10/40/10/37). */
const EXPECTED_RESULT = [11, 41, 11, 37];

/** The same four glyphs at the preset card's 104 px (measured 11/44/11/39). */
const EXPECTED_PRESET = [11, 44, 11, 39];

const CARDS = [
  { name: "result", page: RESULT, expected: EXPECTED_RESULT },
  { name: "preset", page: PRESET, expected: EXPECTED_PRESET },
];

test.describe("D-31 — the Arabic unit's ink order on the share cards", () => {
  for (const card of CARDS) {
    test(`the /ar ${card.name} card paints dot, letter, dot, letter`, async ({ page, request }) => {
      await page.goto("/fr");
      const imageUrl = await cardImageUrl(request, card.page, "http://localhost:3210");
      const ink = await measureCard(page, imageUrl);

      console.log(
        `REPORT ${card.name} card: ${ink.size.width}x${ink.size.height}, ${ink.bands.length} ink band(s) ${JSON.stringify(ink.bands)}; headline rows ${ink.headline.top}..${ink.headline.bottom}, ${ink.runs.length} ink runs`,
      );
      console.log(
        `REPORT ${card.name} runs: ${ink.runs.map((run) => `${run.width}@${run.left}`).join(" ")}`,
      );
      console.log(
        `REPORT ${card.name} unit (rightmost 4): ${ink.runs
          .slice(-4)
          .map((run) => run.width)
          .join(" ")}`,
      );

      // The unit is the money string's tail, so it is the rightmost ink on the
      // headline. Its four glyphs must be dot, م, dot, د — NOT the logical
      // د, dot, م, dot a renderer with bidi would produce.
      const unit = ink.runs.slice(-4).map((run) => run.width);
      const measured = JSON.stringify(ink.runs.slice(-4));
      expect(
        unit,
        `/ar ${card.name} card: the unit must be FOUR ink runs — dot, letter, dot, letter — measured ${measured}`,
      ).toHaveLength(4);
      unit.forEach((width, index) => {
        expect(
          Math.abs(width - card.expected[index]),
          `/ar ${card.name} card: unit ink run ${index} is ${width} px, expected ${card.expected[index]} +/- 1 px — the pattern must read dot(11) letter(41) dot(11) letter(37). Measured ${JSON.stringify(unit)} from ${measured}`,
        ).toBeLessThanOrEqual(1);
      });
    });

    test(`the /ar ${card.name} card carries no Arabic text but the unit`, async ({ page, request }) => {
      await page.goto("/fr");
      const imageUrl = await cardImageUrl(request, card.page, "http://localhost:3210");
      const ink = await measureCard(page, imageUrl);

      // The headline is the only place a word could ride along: every Arabic
      // glyph in the money string is one of the unit's two letters.
      const drawn = formatOgMoney(8594, "ar");
      const arabic = [...drawn].filter((char) => /[\u0600-\u06FF]/.test(char));
      expect(arabic, `the drawn money string is ${JSON.stringify(drawn)}`).toEqual(["م", "د"]);
      // ...and the number in it is Latin: an Arabic-Indic digit would add glyphs
      // to the ink and break the four-run unit above.
      expect(formatNumber(8594, "ar")).toMatch(/^[0-9\u202F]+$/);

      // The rest of both cards is hardcoded French, so their modules must carry
      // no Arabic code point at all.
      for (const file of [
        path.resolve(process.cwd(), "app/[locale]/config/[id]/opengraph-image.tsx"),
        path.resolve(process.cwd(), "app/[locale]/[presetSlug]/opengraph-image.tsx"),
      ]) {
        expect(/[\u0600-\u06FF]/.test(fs.readFileSync(file, "utf8")), file).toBe(false);
      }

      // And the unit itself is the one reversal, at the code-point level.
      expect(OG_ARABIC_UNIT).toBe(".م.د");
      expect([...OG_ARABIC_UNIT].map((char) => char.codePointAt(0))).toEqual([
        0x2e, 0x645, 0x2e, 0x62f,
      ]);
      // The HTML path keeps the LOGICAL unit: the card's reversal is not a
      // change to `formatMoney()`.
      expect(formatMoney(8594, "ar").endsWith("\u00A0د.م.")).toBe(true);
      // French is unchanged, digit for digit.
      expect(formatOgMoney(8594, "fr")).toBe(formatMoney(8594, "fr"));

      // The structural check the ink cannot make: two text bands only (the
      // wordmark and the headline), so no stray line of Arabic was added.
      console.log(
        `REPORT ${card.name} bands: ${JSON.stringify(ink.bands)} in ${ink.size.width}x${ink.size.height}`,
      );
      expect(ink.bands.length).toBe(2);
      expect(ink.size).toEqual({ width: 1200, height: 630 });
    });
  }
});
