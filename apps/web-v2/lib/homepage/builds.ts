/**
 * Homepage card logic — the two rules the homepage owns, and the mapping from a
 * served preset + its detail to what a card renders.
 *
 * Ownership boundaries, because they are easy to get wrong:
 *
 * - The homepage SELECTS a preset, it never invents one. The ladder arrives
 *   ordered by `budget_amount` ascending, but selection does not trust that: it
 *   filters to `budget_amount <= ceiling` and takes the maximum, so a shuffled
 *   or duplicate-budget response still answers the same way.
 * - The homepage RENDERS a price status, it never computes one. The only source
 *   is the rendered build's own `price_status`; the preset-level summary is a
 *   pointer summary and must never become a fallback badge.
 * - A preset carries no title, no components and no total price. Everything a
 *   card shows beyond its budget comes from the detail read.
 */
import type { BuildComponent, Preset, PresetBuild, PresetDetail } from "@/lib/api/types";

/** The generic homepage ceiling, in MAD. A selection bound, never a price. */
export const HOMEPAGE_BUDGET_CEILING = 12_000;

/** The three peers, in their approved display order. Never sorted by score. */
export const HOME_USE_CASES = ["GAMING", "OFFICE", "WORKSTATION"] as const;

export type HomeUseCase = (typeof HOME_USE_CASES)[number];

/** The two statuses a card may show. Anything else renders no badge at all. */
export type PriceBadgeStatus = "verified" | "indicative";

/** Spec-pill order on the card; the API returns components in role order already. */
export const PILL_ROLES = ["CPU", "GPU", "RAM", "SSD_BOOT"] as const;

const MAX_PILLS = PILL_ROLES.length;

/**
 * The highest preset at or below `ceiling`, or null when none qualifies.
 *
 * `Number.POSITIVE_INFINITY` is a legitimate ceiling: it answers "the highest
 * tier this ladder has", which is what the over-budget cap note needs.
 */
export function selectPresetAtOrBelow(presets: readonly Preset[], ceiling: number): Preset | null {
  let selected: Preset | null = null;

  for (const preset of presets) {
    if (preset.budget_amount > ceiling) continue;
    if (selected === null || preset.budget_amount > selected.budget_amount) {
      selected = preset;
    }
  }

  return selected;
}

/**
 * The badge a card may show, from the rank-1 build only.
 *
 * The contract types `builds[].price_status` as non-nullable, but the API's own
 * preset presenter returns null for a pass that assembled nothing, and a null or
 * unknown value must never be relabelled "indicative". Narrowing at the edge
 * keeps the generated type honest and the UI safe.
 */
export function resolvePriceBadge(builds: readonly PresetBuild[]): PriceBadgeStatus | null {
  const status: unknown = builds[0]?.price_status;
  return status === "verified" || status === "indicative" ? status : null;
}

/** Up to four component names, by role order, skipping roles the build lacks. */
export function specPillNames(components: readonly BuildComponent[]): string[] {
  const byRole = new Map<string, string>();

  for (const component of components) {
    if (!byRole.has(component.role) && component.name.trim() !== "") {
      byRole.set(component.role, component.name);
    }
  }

  return PILL_ROLES.map((role) => byRole.get(role))
    .filter((name): name is string => name !== undefined)
    .slice(0, MAX_PILLS);
}

/** Everything one card renders, already resolved. No optional lookups downstream. */
export interface BuildCardView {
  recommendationId: string;
  budgetAmount: number;
  score: number | null;
  totalPrice: number | null;
  badge: PriceBadgeStatus | null;
  pills: string[];
  rationale: string | null;
  hasCompleteBuild: boolean;
}

/**
 * Map a preset and its (possibly absent) detail to the card's view model.
 *
 * `detail === undefined` covers three different situations that render the same
 * way: the detail is still loading, it 404'd, or it errored. In all three the
 * card keeps the preset's budget line and shows no components, score or badge.
 */
export function toBuildCardView(preset: Preset, detail: PresetDetail | undefined): BuildCardView {
  const build = detail?.builds[0];

  return {
    recommendationId: preset.recommendation_id,
    budgetAmount: preset.budget_amount,
    score: build?.build_score ?? null,
    totalPrice: build?.total_price ?? null,
    badge: detail === undefined ? null : resolvePriceBadge(detail.builds),
    pills: build === undefined ? [] : specPillNames(build.components),
    rationale: build?.explanation ?? null,
    hasCompleteBuild: build !== undefined,
  };
}
