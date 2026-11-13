"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { buildConfiguratorHref } from "@/lib/configurator/schema";
import { formatPrice } from "@/lib/format/price";
import type { BuildCardView, HomeUseCase } from "@/lib/homepage/builds";

import { PriceStatusBadge } from "./price-status-badge";

export interface CompactBuildRowProps {
  /** The localized use-case label. */
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
 * A compact configuration row — the second and third use cases.
 *
 * More compact than the featured card: title and component summary together on
 * the left, price below them, and the details CTA aligned to the right. No
 * image slot. The component summary is plain text, not badges or pills.
 *
 * Uses `h3` for the title (not `h4`) so heading levels never skip from the
 * featured card's `h3`.
 */
export function CompactBuildRow({
  title,
  useCase,
  view,
  capNote,
  errorMessage,
  onRetry,
}: CompactBuildRowProps) {
  const t = useTranslations("Homepage.builds");
  const currency = useTranslations("Price")("currency");
  const titleId = `build-${view.recommendationId}`;
  const href = buildConfiguratorHref({ useCase, budgetAmount: view.budgetAmount });

  return (
    <article
      aria-labelledby={titleId}
      data-slot="build-card"
      className="flex items-center justify-between gap-3 rounded-field border border-border bg-surface p-3 shadow-level-1"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 id={titleId} className="min-w-0 truncate text-label-lg font-bold text-foreground">
            {title}
          </h3>
          <PriceStatusBadge status={view.badge} />
        </div>

        {view.componentSummary !== "" ? (
          <p className="mt-0.5 truncate text-body-sm text-muted">{view.componentSummary}</p>
        ) : null}

        {/*
          The served tier — kept visible so a card whose detail is still loading
          or 404'd still shows its budget. When the total price is available it
          appears below; when it is not, the budget stands in.
        */}
        <p className="mt-0.5 text-body-sm text-muted">
          {t("budgetLabel")} ·{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatPrice(view.budgetAmount, currency)}
          </span>
        </p>

        {capNote ? <p className="mt-0.5 truncate text-body-sm text-indicative">{capNote}</p> : null}

        {view.totalPrice !== null ? (
          <p className="mt-1 text-body-md font-bold text-foreground tabular-nums">
            {formatPrice(view.totalPrice, currency)}
          </p>
        ) : null}

        {errorMessage ? (
          <p role="alert" className="text-label-md font-medium text-danger">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onRetry ? (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            {t("error.retry")}
          </Button>
        ) : null}
        {href === null ? (
          <span
            aria-disabled="true"
            className="inline-flex min-h-11 items-center text-label-md text-primary"
          >
            {t("compactCta")}
          </span>
        ) : (
          // `min-h-11` keeps the 44 px touch target on phone widths.
          <Link
            href={href}
            className="inline-flex min-h-11 items-center gap-0.5 text-label-md font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t("compactCta")}
            <ArrowRight aria-hidden="true" className="size-4 text-primary rtl:-scale-x-100" />
          </Link>
        )}
      </div>
    </article>
  );
}
