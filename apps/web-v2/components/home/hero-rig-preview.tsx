"use client";

import { Cpu } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui";
import type { AppLocale } from "@/i18n/routing";
import { formatPrice } from "@/lib/format/price";
import { formatScore } from "@/lib/format/score";
import {
  HOMEPAGE_BUDGET_CEILING,
  selectPresetAtOrBelow,
  toBuildCardView,
} from "@/lib/homepage/builds";
import { useMetaOptions, usePresets, useRecommendationDetail } from "@/lib/homepage/use-presets";

export interface HeroRigPreviewProps {
  eyebrow: string;
  caption: string;
  /** Rendered as text: there is no product page to link to yet. */
  details: string;
}

/**
 * The desktop hero preview.
 *
 * It shows the same rank-1 Gaming preset the configurations section already
 * fetched at the 12,000 MAD ceiling (Q-19): both read the same query keys, so the
 * preview adds no request. Only served values are rendered — the score and the
 * price are omitted rather than invented — and "Détails specs" stays inert text
 * until a product page exists (Q-06).
 *
 * The copy is `<p>` elements, not headings: the hero owns the page's only `<h1>`,
 * and an `<h3>` here would skip a level in the document outline.
 */
export function HeroRigPreview({ eyebrow, caption, details }: HeroRigPreviewProps) {
  const tPreview = useTranslations("Homepage.hero.preview");
  const tBuilds = useTranslations("Homepage.builds");
  const displayCurrency = useTranslations("Price")("currency");
  const locale = useLocale() as AppLocale;

  const { currency } = useMetaOptions();
  const ladderQuery = usePresets("GAMING", currency);
  const ladder = ladderQuery.data?.presets ?? [];
  // The preview has no visitor budget: it takes the generic 12,000 ceiling, which
  // is exactly what the Gaming card selects before the finder is answered.
  const preset = selectPresetAtOrBelow(ladder, HOMEPAGE_BUDGET_CEILING);
  const detailQuery = useRecommendationDetail(
    preset?.recommendation_id ?? null,
    ladderQuery.data?.catalog_version ?? null,
  );
  const view = preset === null ? null : toBuildCardView(preset, detailQuery.data);
  const pending = ladderQuery.isPending || (view !== null && detailQuery.isPending);

  if (pending) {
    return (
      <Card className="overflow-hidden" aria-busy="true">
        <span role="status" className="sr-only">
          {tBuilds("loading")}
        </span>
        <div
          aria-hidden="true"
          className="h-44 bg-linear-to-br from-surface-sunken via-surface-muted to-primary-soft"
        />
        <CardContent className="flex flex-col gap-2" aria-hidden="true">
          <div className="h-5 w-2/3 rounded-pill bg-surface-sunken" />
          <div className="h-3 w-1/2 rounded-pill bg-surface-muted" />
          <div className="h-6 w-1/3 rounded-pill bg-surface-muted" />
          <div className="mt-2 h-4 w-full rounded-pill bg-surface-muted" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div
        aria-hidden="true"
        className="relative h-44 bg-linear-to-br from-surface-sunken via-surface-muted to-primary-soft"
      >
        <span className="absolute inset-0 flex items-center justify-center text-primary/25">
          <Cpu className="size-16" />
        </span>
        <span className="absolute start-3 bottom-3 rounded-pill bg-surface/95 px-3 py-1 text-label-md text-primary shadow-level-1">
          {caption}
        </span>
      </div>

      <CardContent className="flex flex-col gap-1.5">
        {view === null ? null : (
          <div className="flex flex-col gap-1">
            <p className="text-headline-sm text-foreground">{tBuilds("category.gaming")}</p>
            {view.score === null ? null : (
              <p className="text-body-sm text-muted">
                {tPreview("score", { score: formatScore(view.score, locale) })}
              </p>
            )}
            {view.totalPrice === null ? null : (
              <p className="flex items-baseline justify-between gap-2">
                <span className="text-label-md text-muted">{tBuilds("priceLabel")}</span>
                <span className="text-price text-foreground tabular-nums">
                  {formatPrice(view.totalPrice, displayCurrency)}
                </span>
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-label-md font-semibold tracking-wide text-muted uppercase">
            {eyebrow}
          </p>
          <span aria-disabled="true" className="text-label-lg text-primary">
            {details}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
