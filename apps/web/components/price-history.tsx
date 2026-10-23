/**
 * components/price-history.tsx — S25's "Historique des prix" section.
 *
 * The sprint's definition of done asks for a price chart WITH a text summary as
 * the chart's equivalent, `Intl`-formatted dates and prices, and an RTL-safe
 * layout. This component is that, and the three data states are the design:
 *
 *   0 readings  — one sentence saying there is no reading. No axis, no empty
 *                 chart frame: an empty plot is a picture of nothing.
 *   1 reading   — the price and its date as a sentence. A single point is not a
 *                 line, and drawing one would imply a trend nobody observed.
 *   2+ readings — the chart, the min / max / latest rows, the date range and the
 *                 change since the FIRST reading, in words and in numbers.
 *
 * Why the summary is not merely an `aria-label`: a chart is a picture of a series
 * and the numbers ARE the content. The visible rows carry them, so a sighted
 * reader who cannot read the slopes and a screen reader get the same facts from
 * the same text; the `<svg role="img">` label only says what the picture is (how
 * many readings), which is the one thing the rows do not. Nothing is stated twice
 * in the reading order.
 *
 * The chart is mirrored by GEOMETRY, not by a CSS flip. An SVG coordinate system
 * does not inherit `dir`, so the page passes the direction in and the time axis is
 * projected from the inline start: in French the oldest reading sits at the left,
 * in Arabic at the right, and `e2e/price-history.spec.ts` measures the point
 * positions rather than trusting the attribute. A CSS mirror would have flipped
 * the geometry too, inverting every curve of the line into its opposite.
 *
 * The x axis is TIME, not the index of the reading. Readings on irregular days are
 * uneven gaps; spacing them evenly would draw a history that never happened. Two
 * readings on one day collapse to index spacing, because there is no interval to
 * respect.
 *
 * Server component: it fetches its own translations and holds no state, so
 * nothing here ships to the browser.
 */
import { getTranslations } from "next-intl/server";

import type { PriceObservation } from "@/lib/catalog/load";
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
  type AppLocale,
} from "@/lib/i18n/format";

/** The page's writing direction — the same pair the locale layout sets on `<html>`. */
export type TextDirection = "ltr" | "rtl";

export interface PriceHistoryProps {
  /**
   * The product's readings, OLDEST FIRST with positive finite prices — the
   * loader's contract (`loadPriceHistory`), not this component's guess.
   */
  observations: readonly PriceObservation[];
  locale: AppLocale;
  /**
   * A PROP rather than something read from the DOM: the geometry is computed on
   * the server, where no computed style exists, and the page is the one place
   * that knows which locale it is rendering.
   */
  direction: TextDirection;
}

/** The drawing's own coordinate space; `w-full` scales it to the column. */
const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 96;
/** Breathing room so a point at the minimum or maximum is not clipped in half. */
const INSET = 6;
/** Two decimals: a stable attribute string, and far below a CSS pixel. */
const round = (value: number): number => Math.round(value * 100) / 100;

interface ChartPoint {
  x: number;
  y: number;
  /** The newest reading gets a heavier dot; DOM order still carries the time. */
  latest: boolean;
}

/**
 * Project the series into the drawing space, oldest at the inline START.
 *
 * `direction` is the only thing that flips: the vertical mapping never does, so
 * "cheaper is lower" holds in both languages.
 */
function projectSeries(
  observations: readonly PriceObservation[],
  direction: TextDirection,
): ChartPoint[] {
  const days = observations.map((observation) => Date.parse(observation.observed_at));
  const firstDay = days[0];
  const daySpan = days[days.length - 1] - firstDay;
  const prices = observations.map((observation) => observation.price);
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  const priceSpan = highest - lowest;
  const innerWidth = VIEW_WIDTH - INSET * 2;
  const innerHeight = VIEW_HEIGHT - INSET * 2;

  return observations.map((observation, index) => {
    // Equal days have no interval to respect, so they fall back to index spacing.
    const along =
      daySpan > 0
        ? (days[index] - firstDay) / daySpan
        : index / Math.max(1, observations.length - 1);
    // A flat series has no range to scale, so it sits on the middle line.
    const across = priceSpan > 0 ? (observation.price - lowest) / priceSpan : 0.5;
    const x = INSET + along * innerWidth;
    return {
      x: round(direction === "rtl" ? VIEW_WIDTH - x : x),
      y: round(VIEW_HEIGHT - INSET - across * innerHeight),
      latest: index === observations.length - 1,
    };
  });
}

interface PriceSummary {
  first: PriceObservation;
  latest: PriceObservation;
  lowest: PriceObservation;
  highest: PriceObservation;
  /** Signed: the latest reading minus the first one. */
  change: number;
}

/**
 * The four readings the text summary is built from.
 *
 * Ties keep the EARLIEST reading (`<` / `>` rather than `<=` / `>=`), so a price
 * seen twice reports the day it was first seen — the same rule the loader uses to
 * order equal days.
 */
function summarize(observations: readonly PriceObservation[]): PriceSummary {
  let lowest = observations[0];
  let highest = observations[0];
  for (const observation of observations) {
    if (observation.price < lowest.price) lowest = observation;
    if (observation.price > highest.price) highest = observation;
  }
  const first = observations[0];
  const latest = observations[observations.length - 1];
  return { first, latest, lowest, highest, change: latest.price - first.price };
}

export async function PriceHistory({ observations, locale, direction }: PriceHistoryProps) {
  const t = await getTranslations({ locale, namespace: "catalog" });

  const summary = observations.length >= 2 ? summarize(observations) : null;
  const points = summary === null ? [] : projectSeries(observations, direction);
  // The first reading is a positive price (the loader's contract), so the ratio
  // is a real percentage rather than a division by nothing.
  const changeSentence =
    summary === null
      ? null
      : summary.change === 0
        ? t("priceHistory.changeSame")
        : t(summary.change > 0 ? "priceHistory.changeUp" : "priceHistory.changeDown", {
            amount: formatMoney(Math.abs(summary.change), locale),
            percent: formatPercent(Math.abs(summary.change) / summary.first.price, locale),
          });

  const rows =
    summary === null
      ? []
      : [
          { key: "lowest", labelKey: "priceHistory.min", price: summary.lowest.price },
          { key: "highest", labelKey: "priceHistory.max", price: summary.highest.price },
          { key: "latest", labelKey: "priceHistory.latest", price: summary.latest.price },
        ];

  return (
    <section className="mt-6">
      <h2 className="text-subtitle text-ink">{t("priceHistory.title")}</h2>

      {observations.length === 0 ? (
        <p className="mt-2 text-compact text-muted">{t("priceHistory.none")}</p>
      ) : null}

      {observations.length === 1 ? (
        <p className="mt-2 text-compact text-ink">
          {t("priceHistory.single", {
            amount: formatMoney(observations[0].price, locale),
            date: formatDate(observations[0].observed_at, locale),
          })}
        </p>
      ) : null}

      {summary === null ? null : (
        <>
          <figure className="mt-3">
            <svg
              role="img"
              aria-label={t("priceHistory.chartLabel", {
                count: formatNumber(observations.length, locale),
              })}
              viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
              className="h-auto w-full text-primary"
              preserveAspectRatio="xMidYMid meet"
            >
              <polyline
                points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {points.map((point, index) => (
                <circle
                  key={observations[index].observed_at}
                  cx={point.x}
                  cy={point.y}
                  r={point.latest ? 4 : 2.5}
                  fill="currentColor"
                />
              ))}
            </svg>
            <figcaption className="mt-1 text-micro text-muted">
              {t("priceHistory.range", {
                from: formatDate(summary.first.observed_at, locale),
                to: formatDate(summary.latest.observed_at, locale),
              })}
            </figcaption>
          </figure>

          <dl className="mt-3 divide-y divide-border rounded-card border border-border">
            {rows.map((row) => (
              <div key={row.key} className="flex items-baseline justify-between gap-3 px-4 py-2">
                <dt className="min-w-0 text-compact text-muted">{t(row.labelKey)}</dt>
                <dd className="num-tabular min-w-0 text-end text-compact break-words text-ink">
                  {formatMoney(row.price, locale)}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-3 text-compact text-ink">{changeSentence}</p>
        </>
      )}
    </section>
  );
}
