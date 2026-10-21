/**
 * The results page's build card — board §12, the strategy card.
 *
 * One card per `builds[]` entry, and NOTHING in this component assumes how many
 * there are (V13). The page maps the array; a pass that assembled one build
 * renders one card, and a pass that assembled none never reaches this component
 * (the page's zero-build state owns that).
 *
 * Three decisions live here.
 *
 * **The first card is primary by RANK, not by position.** The page orders the
 * builds and tells the card whether it is the primary one; the card draws it as
 * a 1 px border plus a 1 px ring (the same edge as the kit's selected card, and
 * no layout shift when the set changes) with the board's ambient shadow. A
 * second, louder treatment would compete with the price, which is what the eye
 * should land on.
 *
 * **The bar's two numbers are the build's total and the QUERY's budget.** Not
 * the floor, not another build's total: the question it answers is "is this one
 * within what I asked for". `progressBar` receives `value`/`max` so the browser
 * clamps the fill and `aria-valuenow` itself, and the TRUE relationship travels
 * in `aria-valuetext` — the total, the word for "out of", and the budget, all
 * formatted by `lib/i18n/format.ts` — because a clamped 100 % would otherwise
 * read as "exactly on budget". That sentence is the DoD's "aria text equivalent".
 *
 * **Over budget is an Alert, not a Badge — a documented deviation.** The sprint
 * asks for a "warning badge"; `Badge`'s three tones are the PRICE-PROVENANCE
 * states and are pinned by `e2e/kit.spec.ts` and S12, so adding a fourth tone
 * would make one component say two unrelated things. An `Alert` with the
 * warning tone says what happened AND by how much, which a pill cannot.
 *
 * The card is a server component: it fetches its translations itself and holds
 * no state, so nothing here ships to the browser.
 */
import { getTranslations } from "next-intl/server";

import { Alert, ProgressBar, cn } from "@/components/ui";
import { formatMoney, formatNumber, type AppLocale } from "@/lib/i18n/format";
import {
  barFigures,
  budgetTone,
  overBudgetBy,
  remainingBudget,
  strategyLabel,
  type Build,
} from "@/lib/result/model";

import { ComponentRow } from "./component-row";

export interface BuildCardProps {
  build: Build;
  /** The query's budget, or null when the pass did not record one. */
  budget: number | null;
  /** 1-based position in the rendered list. Display only — `rank` is the data. */
  position: number;
  /** Rank 1: the card the eye lands on first. */
  primary: boolean;
  locale: AppLocale;
}

export async function BuildCard({ build, budget, position, primary, locale }: BuildCardProps) {
  const t = await getTranslations({ locale, namespace: "result" });
  const headingId = `build-${position}-heading`;

  const total = build.total_price;
  const bar = barFigures(total, budget);
  const tone = budgetTone(total, budget);
  const over = overBudgetBy(total, budget);
  const remaining = remainingBudget(total, budget);

  return (
    <article
      aria-labelledby={headingId}
      data-primary={primary ? "true" : "false"}
      data-tone={tone}
      className={cn(
        "rounded-card border bg-surface p-4",
        primary ? "border-primary shadow-card-2 ring-1 ring-primary" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-micro tracking-wide text-muted uppercase">
            {t("rank", { position: formatNumber(position, locale) })}
          </p>
          <h2 id={headingId} className="mt-0.5 text-subtitle text-ink">
            {t(`strategies.${strategyLabel(build.strategy_key)}`)}
          </h2>
        </div>
        {/* A total is never invented: an unrecorded one is simply absent. */}
        {total === null ? null : (
          <p className="num-tabular shrink-0 text-title text-ink">{formatMoney(total, locale)}</p>
        )}
      </div>

      {bar === null ? null : (
        <div className="mt-3">
          <ProgressBar
            label={t("bar.label")}
            value={bar.total}
            max={bar.budget}
            tone={tone}
            detail={
              over !== null
                ? t("bar.over", { amount: formatMoney(over, locale) })
                : remaining !== null
                  ? t("bar.remaining", { amount: formatMoney(remaining, locale) })
                  : undefined
            }
            valueText={t("bar.valueText", {
              total: formatMoney(bar.total, locale),
              budget: formatMoney(bar.budget, locale),
            })}
          />
        </div>
      )}

      {over !== null ? (
        <div className="mt-3">
          <Alert tone="warning">{t("overBudget", { amount: formatMoney(over, locale) })}</Alert>
        </div>
      ) : null}

      <ul aria-label={t("componentsLabel")} className="mt-3 divide-y divide-border border-t border-border">
        {build.components.map((component, index) => (
          <ComponentRow
            key={`${component.role}:${component.product_id}:${index}`}
            component={component}
            locale={locale}
          />
        ))}
      </ul>
    </article>
  );
}
