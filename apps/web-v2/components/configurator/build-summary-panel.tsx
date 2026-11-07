"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Badge, Button, buttonVariants } from "@/components/ui";
import type { PresetBuild, PresetDetail } from "@/lib/api/types";
import { USE_CASE_MESSAGE_KEYS } from "@/lib/configurator/schema";
import type { ConfiguratorRequirements } from "@/lib/configurator/store";
import { formatPrice } from "@/lib/format/price";
import { cn } from "@/lib/utils";

export interface BuildSummaryPanelProps {
  detail: PresetDetail | undefined;
  /** The visitor's answers, owned by the store: the recap quotes these. */
  requirements: ConfiguratorRequirements;
  /** True once the answers are submitted, so the panel recaps instead of prompting. */
  submitted: boolean;
  /** The meta-sourced currency code; `MAD` is rendered through `Price.currency`. */
  currency: string;
  isPending: boolean;
  /** `null` when there is no error, otherwise the HTTP status (0 for transport). */
  errorStatus: number | null;
  activeBuildRank: number;
  onSelectRank: (rank: number) => void;
  onRetry: () => void;
}

type SummaryState = "empty" | "loading" | "notFound" | "error" | "ready" | "loadedNoBuilds";

const ROLE_KEYS = new Map<string, string>([
  ["CPU", "CPU"],
  ["GPU", "GPU"],
  ["MOTHERBOARD", "MOTHERBOARD"],
  ["RAM", "RAM"],
  ["SSD_BOOT", "SSD_BOOT"],
  ["SSD_SECONDARY", "SSD_SECONDARY"],
  ["PSU", "PSU"],
  ["CASE", "CASE"],
  ["CPU_COOLER", "CPU_COOLER"],
]);

function roleKey(role: string): string {
  return ROLE_KEYS.get(role) ?? "other";
}

function priceBadge(status: unknown): "verified" | "indicative" | null {
  return status === "verified" || status === "indicative" ? status : null;
}

function selectBuild(
  detail: PresetDetail | undefined,
  activeRank: number,
): PresetBuild | undefined {
  if (detail === undefined) return undefined;
  return detail.builds.find((build) => build.rank === activeRank) ?? detail.builds[0];
}

/**
 * The floor's priced total, or `null` when the engine never priced one.
 *
 * `NULL` != `0`: an unpriced floor, a zero and an absent floor are all "no
 * number". The floor is a lower-bound diagnostic, so it is never rendered as a
 * build price and never used to claim a build is within budget.
 */
function pricedFloor(detail: PresetDetail | undefined): number | null {
  const cheapest = detail?.budget_floor?.cheapest_total;
  if (typeof cheapest !== "number" || !Number.isFinite(cheapest) || cheapest <= 0) return null;
  return cheapest;
}

function resolveState(
  detail: PresetDetail | undefined,
  isPending: boolean,
  errorStatus: number | null,
): SummaryState {
  if (detail !== undefined) {
    // A pass that loaded and assembled nothing is NOT the unloaded state: it has
    // its own copy, its own floor and its own absence of a build.
    return detail.builds.length > 0 ? "ready" : "loadedNoBuilds";
  }
  if (isPending) return "loading";
  if (errorStatus === 404) return "notFound";
  if (errorStatus !== null) return "error";
  return "empty";
}

/**
 * The configurator's one summary surface.
 *
 * Desktop: a sticky build sheet beside the form. Mobile: a compact bar above
 * the bottom navigation that expands into the same sheet, never a second copy.
 * The API's `total_price`, `price_status` and `disclaimer` are the only price
 * claims; a missing price stays missing rather than becoming zero.
 *
 * A loaded pass with zero builds is its own state (`loadedNoBuilds`): it names
 * the pass's own use case and budget, says plainly that nothing could be
 * assembled, and shows the engine's `budget_floor` as a diagnostic — never as a
 * build price, a component list or a compatibility verdict.
 */
export function BuildSummaryPanel({
  detail,
  requirements,
  submitted,
  currency,
  isPending,
  errorStatus,
  activeBuildRank,
  onSelectRank,
  onRetry,
}: BuildSummaryPanelProps) {
  const t = useTranslations("Configurator.summary");
  const tActions = useTranslations("Configurator.actions");
  const tRequirements = useTranslations("Configurator.requirements");
  const tRoles = useTranslations("Configurator.roles");
  const tPrice = useTranslations("Price");
  const titleId = "build-summary-title";
  const bodyId = "build-summary-body";
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const state = resolveState(detail, isPending, errorStatus);
  const build = selectBuild(detail, activeBuildRank);
  const badge = priceBadge(build?.price_status);
  const displayCurrency = currency === "MAD" ? tPrice("currency") : currency;
  const total = build?.total_price ?? null;
  const disclaimer = detail?.disclaimer ?? null;
  const floorTotal = pricedFloor(detail);
  // The pass's own answers are worth showing in both loaded states: a zero-build
  // pass still knows which question it answered.
  const showsPassMeta = state === "ready" || state === "loadedNoBuilds";
  // The contract types `use_case` as `string`. An unrecognised value leaves the
  // label out rather than borrowing one that would name a different use case.
  const rawUseCase = detail?.use_case ?? null;
  const useCaseKey =
    rawUseCase === null
      ? null
      : ((USE_CASE_MESSAGE_KEYS as Record<string, "gaming" | "office" | "creation">)[rawUseCase] ??
        null);
  const headerStatus =
    state === "loading"
      ? t("loading")
      : state === "notFound"
        ? t("notFoundTitle")
        : state === "error"
          ? t("errorTitle")
          : state === "empty"
            ? t("emptyTitle")
            : state === "loadedNoBuilds"
              ? t("noBuildsTitle")
              : null;

  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };

  return (
    <aside
      aria-labelledby={titleId}
      data-slot="build-summary"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close();
        }
      }}
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-card border border-border bg-surface shadow-level-3",
        "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[calc(5rem+env(safe-area-inset-bottom))] max-lg:z-30 max-lg:rounded-b-none max-lg:border-x-0 max-lg:border-b-0",
        "lg:sticky lg:top-24 lg:self-start lg:shadow-level-1",
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b border-border p-3 sm:gap-3 sm:p-4">
        <div className="min-w-0">
          <p className="hidden text-label-sm font-semibold tracking-wide text-primary lg:block">
            {t("eyebrow")}
          </p>
          <h2
            id={titleId}
            tabIndex={-1}
            className="text-headline-sm text-balance text-foreground focus:outline-none max-lg:sr-only"
          >
            {t("title")}
          </h2>

          {showsPassMeta &&
          detail?.budget_amount !== null &&
          detail?.budget_amount !== undefined ? (
            <p className="mt-1 text-label-md text-muted">
              {useCaseKey !== null ? (
                <>
                  {t("useCaseLabel")} ·{" "}
                  <span className="font-semibold text-foreground">
                    {tRequirements(`usage.${useCaseKey}.title`)}
                  </span>
                  <span aria-hidden="true"> · </span>
                </>
              ) : null}
              {t("budgetLabel")} ·{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {formatPrice(detail.budget_amount, displayCurrency)}
              </span>
            </p>
          ) : showsPassMeta ? (
            <p className="mt-1 text-label-md text-muted lg:hidden">
              {headerStatus ?? t("eyebrow")}
            </p>
          ) : (
            <p className="text-label-lg font-semibold text-foreground">{headerStatus}</p>
          )}
        </div>

        <div className="flex shrink-0 items-start gap-2">
          {state === "ready" && build !== undefined ? (
            <div className="text-end">
              <div className="flex items-center justify-end gap-1.5">
                <span className="text-label-sm text-muted">{t("totalLabel")}</span>
                {badge !== null ? (
                  <Badge tone={badge}>
                    {badge === "verified" ? t("badge.verified") : t("badge.indicative")}
                  </Badge>
                ) : null}
              </div>
              <p
                className={cn(
                  "mt-0.5 font-bold text-foreground tabular-nums",
                  total === null ? "text-label-lg" : "text-price",
                )}
              >
                {total === null ? t("priceUnavailable") : formatPrice(total, displayCurrency)}
              </p>
            </div>
          ) : null}

          <button
            ref={toggleRef}
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
            className={cn(
              buttonVariants({ variant: "outline", size: "md" }),
              "size-12 shrink-0 px-0 lg:hidden",
            )}
          >
            {open ? (
              <ChevronUp aria-hidden="true" className="size-5" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-5" />
            )}
            <span className="sr-only">{open ? tActions("collapse") : tActions("expand")}</span>
          </button>
        </div>
      </div>

      <div
        id={bodyId}
        className={cn(
          "flex flex-col max-lg:max-h-[70dvh] max-lg:overflow-y-auto lg:flex",
          open ? "" : "max-lg:hidden",
        )}
      >
        {state === "loading" ? (
          <div role="status" aria-busy="true" className="p-4">
            <span className="sr-only">{t("loading")}</span>
            <div aria-hidden="true" className="animate-pulse space-y-3">
              <div className="h-4 w-2/3 rounded-pill bg-surface-sunken" />
              <div className="h-4 w-full rounded-pill bg-surface-muted" />
              <div className="h-4 w-5/6 rounded-pill bg-surface-muted" />
              <div className="h-4 w-3/4 rounded-pill bg-surface-muted" />
            </div>
          </div>
        ) : null}

        {state === "empty" ? (
          <div className="p-4">
            <p className="text-body-sm text-muted">
              {submitted ? t("reviewBody") : t("emptyBody")}
            </p>
            {submitted && requirements.useCase !== null && requirements.budgetAmount !== null ? (
              <p className="mt-2 text-label-md font-semibold text-foreground">
                {t("reviewRecap", {
                  useCase: tRequirements(
                    `usage.${USE_CASE_MESSAGE_KEYS[requirements.useCase]}.title`,
                  ),
                  budget: formatPrice(requirements.budgetAmount, displayCurrency),
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        {state === "loadedNoBuilds" ? (
          <div className="flex flex-col gap-3 p-4">
            <div>
              <p className="text-label-md font-semibold text-foreground">{t("noBuildsTitle")}</p>
              <p className="mt-1 text-body-sm text-muted">{t("noBuildsBody")}</p>
            </div>

            {floorTotal !== null ? (
              <div className="border-t border-border pt-3">
                <p className="text-label-sm font-semibold text-muted">{t("floorLabel")}</p>
                <p className="mt-0.5 text-label-lg font-bold text-foreground tabular-nums">
                  {formatPrice(floorTotal, displayCurrency)}
                </p>
                <p className="mt-1 text-body-sm text-muted">{t("floorCaveat")}</p>
              </div>
            ) : null}

            {disclaimer !== null ? (
              <div className="border-t border-border pt-3">
                <p className="text-label-sm font-semibold text-muted">{t("disclaimerLabel")}</p>
                <p className="mt-1 text-body-sm text-muted">{disclaimer}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {state === "notFound" ? (
          <div className="p-4">
            <p className="text-body-sm text-muted">{t("notFoundBody")}</p>
          </div>
        ) : null}

        {state === "error" ? (
          <div role="alert" className="p-4">
            <p className="text-body-sm text-muted">{t("errorBody")}</p>
            <Button variant="outline" size="md" className="mt-3" onClick={onRetry}>
              {t("retry")}
            </Button>
          </div>
        ) : null}

        {state === "ready" && detail !== undefined && build !== undefined ? (
          <div className="flex flex-col gap-4 p-4">
            {detail.builds.length > 1 ? (
              <div>
                <p className="text-label-md font-semibold text-foreground">{t("rankLabel")}</p>
                <div role="group" aria-label={t("rankLabel")} className="mt-2 flex flex-wrap gap-2">
                  {detail.builds.map((candidate) => {
                    const selected = candidate.rank === build.rank;
                    return (
                      <Button
                        key={candidate.rank}
                        variant={selected ? "secondary" : "outline"}
                        size="md"
                        aria-pressed={selected}
                        onClick={() => onSelectRank(candidate.rank)}
                      >
                        {t("rankOption", { rank: candidate.rank })}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div>
              <h3 className="text-label-md font-semibold text-foreground">
                {t("componentsTitle")}
              </h3>
              {build.components.length === 0 ? (
                <p className="mt-2 text-body-sm text-muted">{t("noComponents")}</p>
              ) : (
                <dl className="mt-2 divide-y divide-border border-t border-border">
                  {build.components.map((component, index) => (
                    <div
                      key={`${component.role}-${component.product_id}-${index}`}
                      className="flex items-start justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <dt className="text-label-sm font-semibold tracking-wide text-muted">
                          {tRoles(roleKey(component.role))}
                        </dt>
                        <dd className="mt-0.5 text-label-lg text-foreground">{component.name}</dd>
                      </div>
                      {component.price_used === null ? null : (
                        <dd className="shrink-0 text-label-lg font-semibold text-foreground tabular-nums">
                          {formatPrice(component.price_used, displayCurrency)}
                        </dd>
                      )}
                    </div>
                  ))}
                </dl>
              )}
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-label-sm font-semibold text-muted">{t("disclaimerLabel")}</p>
              <p className="mt-1 text-body-sm text-muted">{detail.disclaimer}</p>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
