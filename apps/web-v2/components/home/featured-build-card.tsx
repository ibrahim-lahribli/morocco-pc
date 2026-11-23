"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { buildConfiguratorHref } from "@/lib/configurator/schema";
import { formatPrice } from "@/lib/format/price";
import type { BuildCardView, HomeUseCase } from "@/lib/homepage/builds";

import { BuildMediaPlaceholder } from "./build-media-placeholder";

export interface FeaturedBuildCardProps {
  /** The localized use-case label; the API carries no configuration name. */
  title: string;
  /** The card's own use case, carried into the configurator handoff. */
  useCase: HomeUseCase;
  view: BuildCardView;
  /** Cap note when the visitor's budget exceeds the highest served tier. */
  capNote?: string | null;
  /** A card-local failure line. The card stays usable and keeps its action. */
  errorMessage?: string | null;
  onRetry?: () => void;
}

/**
 * The featured configuration card — the first of the three use cases.
 *
 * Layout order follows the mobile reference: image → title → compact component
 * summary → divider → price and action on one row.
 *
 * The summary is the compact line from `lib/format/spec`, wrapped at two lines
 * so a long catalog name cannot grow the card. Everything it shows comes from
 * the detail read: the price only when `total_price` is non-null. It renders no
 * badges, no budget line and no score — those live in the full configuration
 * view, and the reference carries none of them here.
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
  const titleId = `build-${view.recommendationId}`;
  const href = buildConfiguratorHref({ useCase, budgetAmount: view.budgetAmount });

  return (
    <article
      aria-labelledby={titleId}
      data-slot="build-card"
      className="flex h-full flex-col gap-3 rounded-card border border-border bg-surface p-3.5 shadow-level-1"
    >
      {/*
        Image slot — the project ships no photography and the API exposes no
        image field, so the decorative token-based placeholder fills the
        reference's proportions (h-36 mobile / h-48 desktop).
      */}
      <BuildMediaPlaceholder className="h-36 w-full rounded-field lg:h-48" />

      <div className="min-w-0">
        <h3 id={titleId} className="min-w-0 text-headline-sm text-balance text-foreground">
          {title}
        </h3>

        {/*
          The four compact specs, in CPU → GPU → RAM → storage order, as one
          plain-text line. Two lines is the ceiling, so the card height holds
          whatever the catalog name turns out to be.
        */}
        {view.componentSummary !== "" ? (
          <p className="mt-1 line-clamp-2 text-body-sm leading-snug text-muted">
            {view.componentSummary}
          </p>
        ) : null}

        {capNote ? <p className="mt-1 text-body-sm text-indicative">{capNote}</p> : null}
      </div>

      {errorMessage ? (
        <div className="flex flex-col gap-1">
          <p role="alert" className="text-label-md font-medium text-danger">
            {errorMessage}
          </p>
          {onRetry ? (
            <Button variant="ghost" size="sm" className="self-start" onClick={onRetry}>
              {t("error.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/*
        Price left, action right, on one row. The label keeps the indicative
        phrasing — it is a text label, not a badge. With no price to show the
        action takes the row alone.
      */}
      <div className="mt-auto flex items-end justify-between gap-2 border-t border-border pt-2.5">
        {view.totalPrice === null ? null : (
          <dl>
            <dt className="text-label-sm tracking-wider text-muted uppercase">
              {t("priceLabelIndicative")}
            </dt>
            <dd
              aria-label={formatPrice(view.totalPrice, currency)}
              className="text-price text-foreground tabular-nums"
            >
              {formatPrice(view.totalPrice, currency)}
            </dd>
          </dl>
        )}

        {href === null ? (
          <span
            aria-disabled="true"
            className="ms-auto text-label-lg text-primary underline-offset-4"
          >
            {t("cta")}
          </span>
        ) : (
          // `h-11` rather than the reference's 36 px: the a11y gate pins a 44 px
          // touch target on a phone, and that floor wins over the mock.
          <Button asChild variant="primary" size="sm" className="ms-auto h-11 px-3.5 text-label-sm">
            <Link href={href}>
              {t("cta")}
              <SlidersHorizontal aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        )}
      </div>
    </article>
  );
}
