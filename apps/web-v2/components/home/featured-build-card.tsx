"use client";

import { ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { buildConfiguratorHref } from "@/lib/configurator/schema";
import { formatPrice } from "@/lib/format/price";
import { formatScore } from "@/lib/format/score";
import type { BuildCardView, HomeUseCase } from "@/lib/homepage/builds";

import { BuildMediaPlaceholder } from "./build-media-placeholder";
import { PriceStatusBadge } from "./price-status-badge";

export interface FeaturedBuildCardProps {
  /** The localized use-case label; the API carries no configuration name. */
  title: string;
  /** The card's own use case, carried into the configurator handoff. */
  useCase: HomeUseCase;
  view: BuildCardView;
  /** Cap note when the visitor's budget exceeds the highest served tier. */
  capNote?: string | null;
  /** A card-local failure line. The slot keeps its budget and stays usable. */
  errorMessage?: string | null;
  onRetry?: () => void;
}

/**
 * The featured configuration card — the first of the three use cases.
 *
 * Layout order follows the mobile reference: badge → image → title →
 * component summary (plain text) → divider → price → CTA.
 *
 * Everything it shows beyond the budget line comes from the detail read: the
 * badge from the rank-1 build's own `price_status`, the price only when
 * `total_price` is non-null, the score "—" when the pass assembled nothing. It
 * renders no compatibility verdict, no `budget_floor`, no engine diagnostics.
 */
export function FeaturedBuildCard({
  title,
  useCase,
  view,
  capNote,
  errorMessage,
  onRetry,
}: FeaturedBuildCardProps) {
  const t = useTranslations("Homepage.builds");
  const currency = useTranslations("Price")("currency");
  const locale = useLocale() as AppLocale;
  const titleId = `build-${view.recommendationId}`;
  const href = buildConfiguratorHref({ useCase, budgetAmount: view.budgetAmount });

  return (
    <article
      aria-labelledby={titleId}
      data-slot="build-card"
      className="flex flex-col rounded-card border border-border bg-surface p-3.5 shadow-level-1"
    >
      {/*
        Badge row: only the existing PriceStatusBadge, top-right. The
        reference's "Recommandé" and "Compatibilité vérifiée" chips are not
        existing project badges and are deliberately omitted.
      */}
      <div className="flex items-center justify-end gap-2">
        <PriceStatusBadge status={view.badge} />
      </div>

      {/*
        Image slot — the project ships no photography and the API exposes no
        image field, so the decorative token-based placeholder fills the
        reference's proportions (h-36 mobile / h-48 desktop).
      */}
      <BuildMediaPlaceholder className="mt-2 h-36 w-full rounded-field lg:h-48" />

      <div className="mt-3 flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 id={titleId} className="min-w-0 text-headline-sm text-balance text-foreground">
          {title}
        </h3>

        {/*
          Component summary as a single plain-text line. Not badges, not pills,
          not chips — just text that wraps naturally on narrow screens.
        */}
        {view.componentSummary !== "" ? (
          <p className="text-body-sm leading-snug text-muted">{view.componentSummary}</p>
        ) : null}

        {/*
          The served tier, never the visitor's typed amount. Kept visible so a
          card whose detail is still loading or 404'd still shows its budget.
        */}
        <p className="text-body-sm text-muted">
          {t("budgetLabel")} ·{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatPrice(view.budgetAmount, currency)}
          </span>
        </p>

        {capNote ? <p className="text-body-sm text-indicative">{capNote}</p> : null}

        {/*
          Divider + price block. The label uses the indicative phrasing from
          the reference; the value uses the project's price formatting. Score
          stays on the left so the two values share one baseline.
        */}
        <dl className="mt-auto flex items-end justify-between gap-2 border-t border-border pt-2">
          <div>
            <dt className="text-label-md text-muted">{t("scoreLabel")}</dt>
            <dd className="min-h-7 text-label-lg leading-7 font-semibold text-foreground tabular-nums">
              {view.score === null
                ? "—"
                : t("scoreValue", { score: formatScore(view.score, locale) })}
            </dd>
          </div>
          {view.totalPrice === null ? null : (
            <div className="text-end">
              <dt className="text-label-sm tracking-wider text-muted uppercase">
                {t("priceLabelIndicative")}
              </dt>
              <dd
                aria-label={formatPrice(view.totalPrice, currency)}
                className="text-price text-foreground tabular-nums"
              >
                {formatPrice(view.totalPrice, currency)}
              </dd>
            </div>
          )}
        </dl>

        {errorMessage ? (
          <p role="alert" className="text-label-md font-medium text-danger">
            {errorMessage}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          {href === null ? (
            <span aria-disabled="true" className="text-label-lg text-primary">
              {t("cta")}
            </span>
          ) : (
            // `min-h-11` is what keeps the Task 6 target gate true on a phone: a
            // bare text link is ~20 px tall and would fail it.
            <Link
              href={href}
              className="inline-flex min-h-11 items-center text-label-lg text-primary underline-offset-4 hover:underline"
            >
              {t("cta")}
            </Link>
          )}
          <div className="flex items-center gap-1">
            {onRetry ? (
              <Button variant="ghost" size="sm" onClick={onRetry}>
                {t("error.retry")}
              </Button>
            ) : null}
            <ArrowRight aria-hidden="true" className="size-4 text-primary rtl:-scale-x-100" />
          </div>
        </div>
      </div>
    </article>
  );
}
