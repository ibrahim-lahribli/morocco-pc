"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui";
import { formatPrice } from "@/lib/format/price";
import type { BuildCardView } from "@/lib/homepage/builds";
import { cn } from "@/lib/utils";

import { BuildMediaPlaceholder } from "./build-media-placeholder";
import { PriceStatusBadge } from "./price-status-badge";
import { SpecPill } from "./spec-pill";

export interface FeaturedBuildCardProps {
  /** The localized use-case label; the API carries no configuration name. */
  title: string;
  view: BuildCardView;
  /** Cap note when the visitor's budget exceeds the highest served tier. */
  capNote?: string | null;
  /** A card-local failure line. The slot keeps its budget and stays usable. */
  errorMessage?: string | null;
  onRetry?: () => void;
  /**
   * Visual density only. `compact` is the mobile row for the second and third
   * use cases; from `lg` it is the same card as `featured`. It never implies a
   * ranking — the three use cases are peers.
   */
  variant?: "featured" | "compact";
}

/**
 * One recommended configuration.
 *
 * Everything it shows beyond the budget line comes from the detail read: the
 * badge from the rank-1 build's own `price_status`, the price only when
 * `total_price` is non-null, the score "—" when the pass assembled nothing. It
 * renders no compatibility verdict, no `budget_floor`, no engine diagnostics.
 */
export function FeaturedBuildCard({
  title,
  view,
  capNote,
  errorMessage,
  onRetry,
  variant = "featured",
}: FeaturedBuildCardProps) {
  const t = useTranslations("Homepage.builds");
  const currency = useTranslations("Price")("currency");
  const compact = variant === "compact";
  const titleId = `build-${view.recommendationId}`;

  return (
    <article
      aria-labelledby={titleId}
      data-slot="build-card"
      className={cn(
        "h-full rounded-card border border-border bg-surface shadow-level-1",
        compact ? "flex gap-3 p-3 lg:flex-col lg:gap-0 lg:p-4" : "flex flex-col p-4",
      )}
    >
      <BuildMediaPlaceholder
        className={compact ? "size-20 shrink-0 lg:h-48 lg:w-full" : "h-36 w-full lg:h-48"}
      />

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-1.5",
          compact ? "lg:mt-3 lg:gap-2" : "mt-3 gap-2",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 id={titleId} className="text-headline-sm text-balance text-foreground">
            {title}
          </h3>
          <PriceStatusBadge status={view.badge} />
        </div>

        <p className="text-body-sm text-muted">
          {t("budgetLabel")} ·{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatPrice(view.budgetAmount, currency)}
          </span>
        </p>

        {capNote ? <p className="text-body-sm text-indicative">{capNote}</p> : null}

        {view.pills.length > 0 ? (
          <ul className={cn("flex flex-wrap gap-1.5", compact && "max-lg:hidden")}>
            {view.pills.map((pill) => (
              <li key={pill}>
                <SpecPill>{pill}</SpecPill>
              </li>
            ))}
          </ul>
        ) : null}

        {view.rationale ? (
          <p className={cn("line-clamp-2 text-body-sm text-muted", compact && "max-lg:hidden")}>
            {view.rationale}
          </p>
        ) : null}

        <dl className="mt-auto flex items-end justify-between gap-2 border-t border-border pt-2">
          <div>
            <dt className="text-label-md text-muted">{t("scoreLabel")}</dt>
            <dd className="text-label-lg font-semibold text-foreground tabular-nums">
              {view.score === null ? "—" : t("scoreValue", { score: view.score })}
            </dd>
          </div>
          {view.totalPrice === null ? null : (
            <div className="text-end">
              <dt className="text-label-md text-muted">{t("priceLabel")}</dt>
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
          <span aria-disabled="true" className="text-label-lg text-primary">
            {t("cta")}
          </span>
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
