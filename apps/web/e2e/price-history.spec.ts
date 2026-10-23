/**
 * apps/web/e2e/price-history.spec.ts — S25's proof for "Historique des prix".
 *
 * The section has THREE data states, and the `2+` state has three change
 * branches, so the fixtures cover FIVE pages — one per thing a reader can be
 * told:
 *
 *   0 readings   — the page says there is no reading and draws no chart. The
 *                  fixture product with no series is `kit-ddr5-16-go`, the RAM
 *                  kit that also has no offer.
 *   1 reading    — a sentence carrying the price and its date, and still no
 *                  line: one point is not a trend.
 *   2+ falling   — the chart, the min / max / latest rows and the change in
 *                  words AND numbers, on `rtx-4060-8gb`'s four readings.
 *   2+ rising    — the same summary with the other verb, on `rx-7600-8gb`,
 *                  whose middle reading arrives as a numeric STRING (pg's
 *                  shape for a NUMERIC column) and must not be dropped.
 *   2+ unchanged — `ssd-nvme-1-to` holds one price twice: the summary says the
 *                  price has not moved, and the chart has no vertical range to
 *                  scale, so every point sits on the middle line.
 *
 * Four things this file is careful about, because each one is a way such a spec
 * passes while the page is wrong:
 *
 *   1. **The expectations are built by the SAME helpers the page formats with.**
 *      `formatMoney`, `formatDate`, `formatPercent` and `formatNumber` are
 *      imported from `lib/i18n/format.ts`, and the sentences come from the very
 *      catalogue the app reads. So this is not "the page printed 20 %" (a
 *      hand-typed string that can drift into a different locale's punctuation) —
 *      it is "the page printed what the route's locale expects".
 *   2. **The mirror is MEASURED, not read off `dir`.** `rtl.spec.ts` already
 *      proves `<html dir="rtl">`; here the four points' x positions are read from
 *      the rendered SVG, so a chart that kept a left-to-right time axis inside an
 *      RTL page fails even though the attribute is right. The Arabic series must
 *      be the French one reflected, not merely reversed.
 *   3. **The chart is a labelled image, and the numbers live in text.** The
 *      `role="img"` label is asserted as the count sentence, and the min / max /
 *      latest values are asserted in the rows — the chart is not the only place a
 *      value exists, which is what the DoD's "text summary equivalent" means.
 *   4. **360 px is measured in both locales.** The chart is `w-full`, and a fixed
 *      width or an unmirrored margin is exactly what grows the document at the
 *      narrowest viewport.
 */
import { test, expect, type Page } from "@playwright/test";

import { formatDate, formatMoney, formatNumber, formatPercent } from "../lib/i18n/format";
import { PRICE_HISTORY_BY_SLUG } from "../mock/fixtures.mjs";

import fr from "../messages/fr.json";
import ar from "../messages/ar.json";

/** The fixture slugs, named for the state each one produces. */
const NO_READING = "/composants/kit-ddr5-16-go";
const ONE_READING = "/composants/rtx-4060-ti-gaming-oc-16-go";
const MANY_READINGS = "/composants/rtx-4060-8gb";
/** Rising, and one of its prices is a numeric string. */
const RISING = "/composants/rx-7600-8gb";
/** Two readings, one price. */
const FLAT = "/composants/ssd-nvme-1-to";

type Locale = "fr" | "ar";

const CATALOGUES = { fr, ar } as const;
const LOCALES: readonly Locale[] = ["fr", "ar"];

const MANY = PRICE_HISTORY_BY_SLUG["rtx-4060-8gb"].points;
const ONE = PRICE_HISTORY_BY_SLUG["rtx-4060-ti-gaming-oc-16-go"].points[0];
const RISING_READINGS = PRICE_HISTORY_BY_SLUG["rx-7600-8gb"].points;
const FLAT_READINGS = PRICE_HISTORY_BY_SLUG["ssd-nvme-1-to"].points;

/** The catalogued sentence, with its ICU arguments filled in. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** The section, located by its own heading rather than by a wrapper class. */
function section(page: Page, locale: Locale) {
  const heading = CATALOGUES[locale].catalog.priceHistory.title;
  return page.getByRole("heading", { name: heading, level: 2 }).locator("..");
}

/** The centre of every plotted point, in DOM order (oldest first). */
async function pointCentres(page: Page, locale: Locale): Promise<number[]> {
  return section(page, locale)
    .locator("svg circle")
    .evaluateAll((circles) =>
      circles.map((circle) => {
        const box = circle.getBoundingClientRect();
        return box.x + box.width / 2;
      }),
    );
}

for (const locale of LOCALES) {
  const copy = CATALOGUES[locale].catalog.priceHistory;

  test(`[${locale}] no reading: the section says so and draws nothing`, async ({ page }) => {
    await page.goto(`/${locale}${NO_READING}`);
    const block = section(page, locale);

    await expect(block.getByRole("heading", { level: 2 })).toHaveText(copy.title);
    await expect(block.locator("p")).toHaveText(copy.none);
    // Missing readings are a sentence, not an empty frame: an axis with no points
    // is a picture of nothing, and a `dl` with no rows would be a broken table.
    await expect(block.locator("svg")).toHaveCount(0);
    await expect(block.locator("dl")).toHaveCount(0);
  });

  test(`[${locale}] one reading: a sentence with the price and the date`, async ({ page }) => {
    await page.goto(`/${locale}${ONE_READING}`);
    const block = section(page, locale);

    const expected = fill(copy.single, {
      amount: formatMoney(ONE.price, locale),
      date: formatDate(ONE.observed_at, locale),
    });
    await expect(block.locator("p")).toHaveText(expected);
    // One point is not a line, and it is not a min/max either.
    await expect(block.locator("svg")).toHaveCount(0);
    await expect(block.locator("dl")).toHaveCount(0);
  });

  test(`[${locale}] two or more: chart, min / max / latest and the change`, async ({ page }) => {
    await page.goto(`/${locale}${MANY_READINGS}`);
    const block = section(page, locale);

    // The chart is ONE labelled image; the label says what the picture is.
    const chart = block.locator("svg");
    await expect(chart).toHaveCount(1);
    await expect(chart).toHaveAttribute(
      "aria-label",
      fill(copy.chartLabel, { count: formatNumber(MANY.length, locale) }),
    );
    // Every reading is a point, so four readings cannot render as three, and the
    // points are joined by ONE line with one coordinate pair per reading.
    await expect(block.locator("svg circle")).toHaveCount(MANY.length);
    const line = chart.locator("polyline");
    await expect(line).toHaveCount(1);
    const points = (await line.getAttribute("points")) ?? "";
    expect(points.trim().split(/\s+/)).toHaveLength(MANY.length);

    // The date range is visible text, in the route's locale.
    await expect(block.locator("figcaption")).toHaveText(
      fill(copy.range, {
        from: formatDate(MANY[0].observed_at, locale),
        to: formatDate(MANY[MANY.length - 1].observed_at, locale),
      }),
    );

    // min / max / latest: three rows, each with its label and its formatted value.
    const prices = MANY.map((reading) => reading.price);
    const rows = block.locator("dl > div");
    await expect(rows).toHaveCount(3);

    const expectedRows = [
      { label: copy.min, price: Math.min(...prices) },
      { label: copy.max, price: Math.max(...prices) },
      { label: copy.latest, price: MANY[MANY.length - 1].price },
    ];
    for (const [index, row] of expectedRows.entries()) {
      await expect(rows.nth(index).locator("dt")).toHaveText(row.label);
      await expect(rows.nth(index).locator("dd")).toHaveText(formatMoney(row.price, locale));
    }

    // The change is stated in WORDS and in numbers, from the first reading — not
    // from the previous one, which the sentence names explicitly.
    const change = MANY[MANY.length - 1].price - MANY[0].price;
    const expectedSentence =
      change === 0
        ? copy.changeSame
        : fill(change > 0 ? copy.changeUp : copy.changeDown, {
            amount: formatMoney(Math.abs(change), locale),
            percent: formatPercent(Math.abs(change) / MANY[0].price, locale),
          });
    await expect(block.locator("p")).toHaveText(expectedSentence);
  });

  test(`[${locale}] a rising series says so, with the amount and the percent`, async ({ page }) => {
    await page.goto(`/${locale}${RISING}`);
    const block = section(page, locale);

    const first = Number(RISING_READINGS[0].price);
    const last = Number(RISING_READINGS[RISING_READINGS.length - 1].price);
    expect(last, "the rising fixture must actually rise").toBeGreaterThan(first);

    await expect(block.locator("p")).toHaveText(
      fill(copy.changeUp, {
        amount: formatMoney(last - first, locale),
        percent: formatPercent((last - first) / first, locale),
      }),
    );

    // One reading arrives as a NUMERIC STRING, which is how a pg NUMERIC column
    // is serialized. A loader that refused the string would drop that reading and
    // draw two points instead of three, so the COUNT is the coercion assertion.
    expect(RISING_READINGS).toHaveLength(3);
    await expect(block.locator("svg circle")).toHaveCount(3);

    // The latest row is the newest price, not the first one.
    const rows = block.locator("dl > div");
    await expect(rows.nth(2).locator("dt")).toHaveText(copy.latest);
    await expect(rows.nth(2).locator("dd")).toHaveText(formatMoney(last, locale));
  });

  test(`[${locale}] an unchanged series says the price has not moved`, async ({ page }) => {
    await page.goto(`/${locale}${FLAT}`);
    const block = section(page, locale);

    const price = Number(FLAT_READINGS[0].price);
    // The words, and the absence of a direction: no "up", no "down", no percent.
    await expect(block.locator("p")).toHaveText(copy.changeSame);

    // min = max = latest: three rows, one price, and none of them invents a
    // trend from a series that never moved.
    const rows = block.locator("dl > div");
    await expect(rows).toHaveCount(3);
    for (const label of [copy.min, copy.max, copy.latest]) {
      await expect(rows.filter({ hasText: label }).locator("dd")).toHaveText(
        formatMoney(price, locale),
      );
    }

    // A flat series has no vertical range to scale, so every point sits on the
    // same line: the degenerate projection is a straight line, not a division by
    // an empty range.
    const cys = await block.locator("svg circle").evaluateAll((circles) =>
      circles.map((circle) => circle.getAttribute("cy")),
    );
    expect(cys).toHaveLength(FLAT_READINGS.length);
    expect(new Set(cys).size, "a flat series draws on one line").toBe(1);
  });

  test(`[${locale}] the section fits 360 px without growing the page`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/${locale}${MANY_READINGS}`);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);

    // The rows stay inside the viewport, not merely inside a container that is
    // itself clipped: a row wider than the screen is what a summary table does
    // when a price and a label cannot share a line.
    const block = section(page, locale);
    const viewport = page.viewportSize();
    for (const box of await block.locator("dl > div").evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().toJSON()),
    )) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport?.width ?? 360);
    }
  });
}

test("the chart is a geometric mirror on /ar, not a reversed copy", async ({ page }) => {
  const measure = async (
    locale: Locale,
  ): Promise<{ box: { x: number; width: number }; centres: number[]; lastRadius: string | null }> => {
    await page.goto(`/${locale}${MANY_READINGS}`);
    const block = section(page, locale);
    const box = await block.locator("svg").boundingBox();
    if (box === null) throw new Error(`no chart on /${locale}`);
    return {
      box,
      centres: await pointCentres(page, locale),
      lastRadius: await block.locator("svg circle").last().getAttribute("r"),
    };
  };

  const french = await measure("fr");
  const arabic = await measure("ar");
  // The measurement is worthless if the page under it is not the RTL one.
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  expect(french.centres.length).toBe(MANY.length);
  expect(arabic.centres.length).toBe(MANY.length);

  // Oldest first in DOM order: French reads left to right, Arabic right to left.
  for (let index = 1; index < french.centres.length; index += 1) {
    expect(french.centres[index], `fr point ${index}`).toBeGreaterThan(french.centres[index - 1]);
    expect(arabic.centres[index], `ar point ${index}`).toBeLessThan(arabic.centres[index - 1]);
  }

  // And the reflection is exact: each Arabic point sits where its French twin
  // would after mirroring inside the same drawing box, within 1 % of its width.
  for (let index = 0; index < french.centres.length; index += 1) {
    const frenchFraction = (french.centres[index] - french.box.x) / french.box.width;
    const arabicFraction = (arabic.centres[index] - arabic.box.x) / arabic.box.width;
    expect(Math.abs(arabicFraction - (1 - frenchFraction)), `point ${index}`).toBeLessThan(0.01);
  }

  // The newest reading is the heaviest dot in both languages: the emphasis is not
  // carried by position alone, and it survives the mirror.
  expect(arabic.lastRadius).toBe(french.lastRadius);
});
