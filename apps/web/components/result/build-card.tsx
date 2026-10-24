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
 * states (rendered below the heading, S12) and are pinned by `e2e/kit.spec.ts`,
 * so adding a fourth tone would make one component say two unrelated things. An
 * `Alert` with the warning tone says what happened AND by how much, which a pill
 * cannot.
 *
 * **The explanation is a disclosure, not a paragraph of prose nobody reads.**
 * `BuildExplanation` renders the committed `explanation` verbatim until the
 * contract serves `reasons[]` (CD-2), then switches to catalogue lines; it owns
 * that feature check so this card keeps composing and does not parse.
 *
 * **The price badge is the provenance, and only `verified` carries a date.**
 * `priceProvenance()` folds the build's derived `price_status` and its
 * components' `offer_class` into the board's three states, so an all-seed build
 * says "démo" instead of hiding inside "indicatif". The date is
 * `generated_at` — when this pass ran — so the badge says `calculé le`, NOT the
 * board's "prix constatés le": the API has no per-offer observed date (CD-6),
 * and a label claiming the shop surveyed its price that day would be a lie.
 *

 * The card is a server component: it fetches its translations itself and holds
 * no state, so nothing here ships to the browser.
 */
import { getTranslations } from "next-intl/server";

import { SaveBuildButton } from "@/components/saved/save-build-button";
import { Alert, Badge, Button, ProgressBar, cn } from "@/components/ui";
import { formatDate, formatMoney, formatNumber, type AppLocale } from "@/lib/i18n/format";
import { localePath } from "@/lib/i18n/paths";
import {
  barFigures,
  budgetTone,
  overBudgetBy,
  priceProvenance,
  remainingBudget,
  strategyLabel,
  type Build,
  type PriceProvenance,
} from "@/lib/result/model";

import { BuildExplanation } from "./build-explanation";
import { ComponentRow } from "./component-row";

export interface BuildCardProps {
  build: Build;
  /** The recommendation this build belongs to — the address a save keeps. */
  resultId: string;
  /** The query's budget, or null when the pass did not record one. */
  budget: number | null;
  /** When this pass ran, or null — the only date the contract carries (CD-6). */
  generatedAt: string | null;
  /** 1-based position in the rendered list. Display only — `rank` is the data. */
  position: number;
  /** Rank 1: the card the eye lands on first. */
  primary: boolean;
  locale: AppLocale;
}

/** The catalogue key for each state, so no key is built by concatenation. */
const BADGE_KEY: Record<PriceProvenance, string> = {
  demo: "provenance.demo",
  indicative: "provenance.indicative",
  verified: "provenance.verified",
};

export async function BuildCard({
  build,
  resultId,
  budget,
  generatedAt,
  position,
  primary,
  locale,
}: BuildCardProps) {
  const t = await getTranslations({ locale, namespace: "result" });
  // S25's saved-builds copy is its own namespace: the shelf is not a results
  // word, and the same strings are read by the page that lists it.
  const tSaved = await getTranslations({ locale, namespace: "saved" });
  const headingId = `build-${position}-heading`;
  // Per-card, so two cards never share a described-by target.
  const swapNoteId = `build-${position}-swap-note`;

  const total = build.total_price;
  const bar = barFigures(total, budget);
  const tone = budgetTone(total, budget);
  const over = overBudgetBy(total, budget);
  const remaining = remainingBudget(total, budget);
  const provenance = priceProvenance(build);
  // The date belongs to `verified` alone; an indicative or demo price has no
  // observation date to print, and inventing one is what CD-6 forbids.
  const badgeText =
    provenance === "verified" && generatedAt !== null
      ? t("provenance.verifiedDated", { date: formatDate(generatedAt, locale) })
      : t(BADGE_KEY[provenance]);

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

      <div className="mt-2">
        <Badge tone={provenance}>{badgeText}</Badge>
      </div>

      {/* Saving is this browser's business, so the control is the card's ONE
          client island. It keeps a POINTER (this result, this rank), never a
          copy of the build: the card below it is the only place the build is
          rendered from the API. */}
      <div className="mt-3">
        <SaveBuildButton
          entry={{
            id: resultId,
            rank: build.rank,
            strategyKey: strategyLabel(build.strategy_key),
            totalPrice: total,
          }}
          shelfHref={localePath(locale, "/enregistrements")}
          labels={{
            save: tSaved("save"),
            saved: tSaved("saved"),
            removed: tSaved("removed"),
            full: tSaved("full"),
            unavailable: tSaved("saveUnavailable"),
            openShelf: tSaved("openShelf"),
          }}
        />
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

      {/* S24's buildable half (shipped 2026-10-25). CD-8 — a swap endpoint —
          does not exist, so the control is PRESENT and DISABLED rather than
          hidden: an honest future state, and no swap is simulated here. There
          is no handler and no fetch, so there is no code path that could fire a
          request. The explanation is VISIBLE TEXT, not a hover-only tooltip —
          a disabled button cannot take focus, so a tooltip on it would be
          unreachable by keyboard and by touch at 360 px — and
          `aria-describedby` still ties the sentence to the control for anyone
          who reaches it with a virtual cursor. `data-swap` states the state for
          the spec and for the change that lands when the endpoint exists. */}
      <div className="mt-3">
        <Button
          variant="secondary"
          size="compact"
          className="w-full"
          disabled
          aria-describedby={swapNoteId}
          data-swap="unavailable"
        >
          {t("swap.label")}
        </Button>
        <p id={swapNoteId} className="mt-1.5 text-caption text-muted">
          {t("swap.explanation")}
        </p>
      </div>

      <BuildExplanation build={build} locale={locale} />
    </article>
  );
}
