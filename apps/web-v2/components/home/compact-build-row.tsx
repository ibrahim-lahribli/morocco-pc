"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { buildConfiguratorHref } from "@/lib/configurator/schema";
import { formatPrice } from "@/lib/format/price";
import type { BuildCardView, HomeUseCase } from "@/lib/homepage/builds";

export interface CompactBuildRowProps {
  /** The localized use-case label. */
  title: string;
  /** The card's own use case, carried into the configurator handoff. */
  useCase: HomeUseCase;
  view: BuildCardView;
  /** Cap note when the visitor's budget exceeds the highest served tier. */
  capNote?: string | null;
  /** A card-local failure line. The card keeps its category and its action. */
  errorMessage?: string | null;
  onRetry?: () => void;
}

/**
 * A compact configuration row — the second and third use cases.
 *
 * Title, one compact spec line and the price stacked on the left, the details
 * action on the right. No image, no badges, no budget line. The spec line is
 * already the compact form the formatter produces, so it is only clamped — at
 * two lines, never ellipsised on one, because cutting a line mid-token would
 * drop a capacity the formatter was asked to preserve.
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
      className="flex h-full items-center justify-between gap-3 rounded-field border border-border bg-surface p-3 shadow-level-1"
    >
      <div className="min-w-0 flex-1">
        <h3 id={titleId} className="min-w-0 text-headline-sm text-balance text-foreground">
          {title}
        </h3>

        {view.componentSummary !== "" ? (
          <p className="mt-0.5 line-clamp-2 text-body-sm leading-snug text-muted">
            {view.componentSummary}
          </p>
        ) : null}

        {view.totalPrice !== null ? (
          <p className="mt-1 text-body-md font-bold text-foreground tabular-nums">
            {formatPrice(view.totalPrice, currency)}
          </p>
        ) : null}

        {capNote ? <p className="mt-0.5 truncate text-body-sm text-indicative">{capNote}</p> : null}

        {errorMessage ? (
          <p role="alert" className="text-label-md font-medium text-danger">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        {onRetry ? (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            {t("error.retry")}
          </Button>
        ) : null}
        {href === null ? (
          <span aria-disabled="true" className="text-label-sm text-primary">
            {t("compactCta")}
          </span>
        ) : (
          // `h-11` rather than the reference's 32 px, for the same 44 px phone
          // target floor the featured card respects.
          <Button asChild variant="soft" size="sm" className="h-11 px-3 text-label-sm">
            <Link href={href}>
              {t("compactCta")}
              <ArrowRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
            </Link>
          </Button>
        )}
      </div>
    </article>
  );
}
