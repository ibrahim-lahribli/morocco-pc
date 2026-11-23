"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { isApiError } from "@/lib/api/errors";
import { formatPrice } from "@/lib/format/price";
import type { Preset } from "@/lib/api/types";
import {
  HOMEPAGE_BUDGET_CEILING,
  HOME_USE_CASES,
  selectPresetAtOrBelow,
  toBuildCardView,
  type HomeUseCase,
} from "@/lib/homepage/builds";
import { useHomepageStore } from "@/lib/homepage/store";
import { useMetaOptions, usePresets, useRecommendationDetail } from "@/lib/homepage/use-presets";
import { cn } from "@/lib/utils";

import { CompactBuildRow } from "./compact-build-row";
import { FeaturedBuildCard } from "./featured-build-card";
import { SectionHeading } from "./section-heading";

const CATEGORY_KEY: Record<HomeUseCase, "gaming" | "office" | "workstation"> = {
  GAMING: "gaming",
  OFFICE: "office",
  WORKSTATION: "workstation",
};

/**
 * The selection rule for one slot, kept pure so the cap case is testable.
 *
 * - No visitor budget → the generic ceiling (`12 000`), never the median.
 * - Budget above the highest served tier → that tier plus the cap note, because
 *   no preset is tailored to the full amount.
 * - Budget below the cheapest tier → no preset at all; the slot shows its empty
 *   state rather than a more expensive "suitable" build.
 */
export function selectSlotPreset(
  ladder: readonly Preset[],
  budgetAmount: number | null,
): { preset: Preset | null; capped: boolean } {
  if (ladder.length === 0) {
    return { preset: null, capped: false };
  }

  if (budgetAmount === null) {
    return { preset: selectPresetAtOrBelow(ladder, HOMEPAGE_BUDGET_CEILING), capped: false };
  }

  const highest = selectPresetAtOrBelow(ladder, Number.POSITIVE_INFINITY);
  if (highest === null) {
    return { preset: null, capped: false };
  }

  if (budgetAmount > highest.budget_amount) {
    return { preset: highest, capped: true };
  }

  return { preset: selectPresetAtOrBelow(ladder, budgetAmount), capped: false };
}

/**
 * The recommended configurations: one featured card and two compact rows.
 *
 * A client island because it owns the queries and reacts to the finder's store.
 * The three use cases are peers in fixed order; the first (GAMING) renders as a
 * featured card with an image slot, and the other two render as compact rows
 * without images. When the finder narrows to a single use case, that slot
 * renders as a featured card. No ranking is implied by the featured/compact
 * split — it is layout only.
 */
export function RecommendedBuildSection() {
  const t = useTranslations("Homepage.builds");
  const { currency } = useMetaOptions();
  const budgetAmount = useHomepageStore((state) => state.budgetAmount);
  const useCase = useHomepageStore((state) => state.useCase);

  const slots: readonly HomeUseCase[] = useCase === null ? HOME_USE_CASES : [useCase];
  const selectedBudget = useCase === null ? null : budgetAmount;

  return (
    <section id="configurations" aria-labelledby="configurations-title" className="scroll-mt-24">
      <div className="max-w-2xl">
        <SectionHeading
          id="configurations-title"
          title={t("title")}
          intro={t("intro")}
          from="base"
          focusableHeading
        />
      </div>

      {/*
        Mobile: featured card full-width, then two compact rows stacked below.
        Desktop (lg): featured card on the left, two compact rows stacked on
        the right — a 3-column grid where the featured card spans 2 columns
        and the compact rows share the third.
      */}
      <div
        className={cn(
          "mt-3 lg:mt-8",
          slots.length === 1
            ? "flex flex-col lg:max-w-2xl"
            : "flex flex-col gap-3 lg:grid lg:grid-cols-3",
        )}
      >
        {slots.map((slot, index) => (
          <BuildSlot
            key={slot}
            useCase={slot}
            currency={currency}
            budgetAmount={selectedBudget}
            featured={slots.length === 1 || index === 0}
            className={slots.length > 1 && index === 0 ? "lg:col-span-2" : undefined}
          />
        ))}
      </div>
    </section>
  );
}

interface BuildSlotProps {
  useCase: HomeUseCase;
  currency: string;
  /** The visitor's budget, or null for the generic 12 000 ceiling. */
  budgetAmount: number | null;
  /** Whether this slot renders as a featured card (true) or compact row (false). */
  featured: boolean;
  /** Grid placement class for the lg layout. */
  className?: string;
}

function BuildSlot({ useCase, currency, budgetAmount, featured, className }: BuildSlotProps) {
  const t = useTranslations("Homepage.builds");
  const displayCurrency = useTranslations("Price")("currency");
  const category = t(`category.${CATEGORY_KEY[useCase]}`);

  const presetsQuery = usePresets(useCase, currency);
  const ladder: readonly Preset[] = presetsQuery.data?.presets ?? [];
  const catalogVersion = presetsQuery.data?.catalog_version ?? null;

  const { preset, capped } = selectSlotPreset(ladder, budgetAmount);
  const detailQuery = useRecommendationDetail(preset?.recommendation_id ?? null, catalogVersion);
  const view =
    preset === null
      ? null
      : toBuildCardView(preset, detailQuery.data, { gb: t("unitGb"), tb: t("unitTb") });

  // A 404 means the served preset has no detail yet: the card keeps its budget
  // line and its empty state rather than claiming a network failure. Any other
  // error is a real failure and offers a retry.
  const detailError = detailQuery.error;
  const detailMissing = isApiError(detailError) && detailError.status === 404;
  const detailFailed = detailError !== null && !detailMissing;

  if (presetsQuery.isPending) {
    return (
      <BuildSkeleton
        label={category}
        loadingLabel={t("loading")}
        featured={featured}
        className={className}
      />
    );
  }

  if (presetsQuery.isError) {
    return (
      <SlotMessage
        id={`slot-${useCase}`}
        title={category}
        heading={t("error.title")}
        body={t("error.body")}
        retryLabel={t("error.retry")}
        onRetry={() => void presetsQuery.refetch()}
        className={className}
      />
    );
  }

  if (view === null) {
    return (
      <SlotMessage
        id={`slot-${useCase}`}
        title={category}
        heading={t("empty.title")}
        body={t("empty.body")}
        className={className}
      />
    );
  }

  const capNote = capped
    ? t("budgetCap", { amount: formatPrice(view.budgetAmount, displayCurrency) })
    : null;
  const errorMessage = detailFailed ? t("error.body") : null;
  const onRetry = detailFailed ? () => void detailQuery.refetch() : undefined;

  if (featured) {
    return (
      <div className={className}>
        <FeaturedBuildCard
          title={category}
          useCase={useCase}
          view={view}
          capNote={capNote}
          errorMessage={errorMessage}
          onRetry={onRetry}
        />
      </div>
    );
  }

  return (
    <div className={cn("lg:col-span-1", className)}>
      <CompactBuildRow
        title={category}
        useCase={useCase}
        view={view}
        capNote={capNote}
        errorMessage={errorMessage}
        onRetry={onRetry}
      />
    </div>
  );
}

function BuildSkeleton({
  label,
  loadingLabel,
  featured,
  className,
}: {
  label: string;
  loadingLabel: string;
  featured: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <article
        aria-busy="true"
        aria-label={label}
        className={cn(
          "h-full rounded-card border border-border bg-surface p-4 shadow-level-1",
          !featured && "flex items-center",
        )}
      >
        <span role="status" className="sr-only">
          {loadingLabel}
        </span>
        <div aria-hidden="true" className="animate-pulse">
          {featured ? (
            <>
              <div className="h-36 rounded-field bg-surface-sunken lg:h-48" />
              <div className="mt-3 h-4 w-2/3 rounded-pill bg-surface-sunken" />
              <div className="mt-2 h-3 w-1/2 rounded-pill bg-surface-muted" />
              <div className="mt-4 h-3 w-full rounded-pill bg-surface-muted" />
              <div className="mt-2 h-3 w-5/6 rounded-pill bg-surface-muted" />
            </>
          ) : (
            <div className="w-full">
              <div className="h-4 w-2/3 rounded-pill bg-surface-sunken" />
              <div className="mt-2 h-3 w-1/2 rounded-pill bg-surface-muted" />
              <div className="mt-2 h-3 w-1/3 rounded-pill bg-surface-muted" />
            </div>
          )}
        </div>
      </article>
    </div>
  );
}

interface SlotMessageProps {
  /** Unique per slot, so two failing cards never share a heading id. */
  id: string;
  title: string;
  heading: string;
  body: string;
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
}

/** The empty and error states: the slot keeps its category, never a substitute. */
function SlotMessage({
  id,
  title,
  heading,
  body,
  retryLabel,
  onRetry,
  className,
}: SlotMessageProps) {
  return (
    <div className={className}>
      <article
        aria-labelledby={id}
        className="flex h-full flex-col gap-2 rounded-card border border-dashed border-outline bg-surface-muted p-5"
      >
        <h3 id={id} className="text-headline-sm text-foreground">
          {title}
        </h3>
        <p className="text-label-lg font-semibold text-foreground">{heading}</p>
        <p className="text-body-sm text-muted">{body}</p>
        {retryLabel && onRetry ? (
          <Button variant="outline" size="sm" className="mt-auto self-start" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null}
      </article>
    </div>
  );
}
