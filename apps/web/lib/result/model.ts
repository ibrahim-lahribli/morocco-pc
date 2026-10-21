/**
 * lib/result/model.ts — the results page's decisions, as pure functions.
 *
 * Same reason `lib/wizard/model.ts` exists: a rule that only fails on a screen
 * fails late, in a spec that also has to render a page and reach a network. The
 * four rules below are decisions, not plumbing, so they are stated once here and
 * reused by the card, the page and the specs.
 *
 * ## 1. Position is display, `rank` is data
 *
 * The API orders `builds[]` by rank, but the page must not depend on an array
 * order it did not choose: `orderBuilds()` sorts by `rank` (stable, original
 * order as the tie-break) so "the first card" means rank 1 even if a future
 * response is served differently. Rank is never re-derived here — it is a fact
 * the engine recorded (Decision 41), and renumbering it would invent a ranking.
 *
 * ## 2. `builds[]` is 1..N, and N is not a layout constant (V13)
 *
 * Nothing in this file pads, slices or assumes three. The board draws three
 * cards; a pass that assembles one gets one card, and one that assembles none
 * gets the zero-build state (S14 owns its copy, S11 must not render an empty
 * skeleton of "missing" builds).
 *
 * ## 3. A bar is only drawn from two NUMBERS
 *
 * `total_price` and `budget_amount` are both nullable in the contract (the
 * column is), and NULL means "not recorded". A bar drawn from 0 would say a
 * build costs nothing — the project's standing NULL != 0 rule. `hasBar()` is the
 * gate, and `budgetTone()` never reports `over` for a missing number.
 *
 * ## 4. The warning band is a product decision, not a ratio the API sends
 *
 * `budgetTone()` has three tones for two facts: over budget is arithmetic, but
 * "close to it" is a judgement. 90 % is where a card stops reading as
 * comfortable — the last tenth of a budget is what a build has to absorb a price
 * change with — and it is a constant here rather than a magic number in JSX, so
 * changing it is one edit and one test.
 *
 * What this file deliberately does NOT do: format anything. Money, numbers and
 * percentages go through `lib/i18n/format.ts` at the call site, because this
 * module has no locale.
 */
import type { RecommendationResponse } from "@/lib/api/client";

/** One build, as the API serves it. */
export type Build = RecommendationResponse["builds"][number];

/**
 * The engine's `component_role` vocabulary, in the enum's DECLARATION order
 * (`database/migrations/011_reconcile_layer4.sql`).
 *
 * The ORDER is not used to sort the API's components — those arrive in assembly
 * order — it is the vocabulary `roleLabel()` validates: an unknown role is
 * rendered as "Autre" rather than as the raw enum, because a user should never
 * read `SSD_BOOT`.
 *
 * `SSD_SECONDARY` belongs here even though no current assembly step emits it
 * (`query/load-query-input.js` excludes it from the required roles): it is a
 * valid `build_component.role` — the enum's one non-singular storage role, and
 * `persistence/`'s own tests persist one — so a stored build that carries it
 * must be NAMED, not called "Autre".
 */
export const ROLE_ORDER = [
  "CPU",
  "GPU",
  "MOTHERBOARD",
  "RAM",
  "SSD_BOOT",
  "SSD_SECONDARY",
  "PSU",
  "CASE",
  "CPU_COOLER",
] as const;

/** The E4 archetypes (Decision 41). There is no `PRICE` key: the cheap build is VALUE. */
export const STRATEGY_KEYS = ["PERFORMANCE", "BALANCED", "VALUE"] as const;

/** The fallback key both label maps use for a value they do not know. */
export const OTHER_KEY = "OTHER";

/** The message-catalogue key for a role, or `OTHER`. */
export function roleLabel(role: string): string {
  return (ROLE_ORDER as readonly string[]).includes(role) ? role : OTHER_KEY;
}

/**
 * The message-catalogue key for a strategy, or `OTHER`.
 *
 * `strategy_key` is nullable: a pass committed before Decision 41, or one the
 * engine could not attribute, has no archetype. That is not "the unknown
 * strategy" — it is a build that must be named generically rather than guessed.
 */
export function strategyLabel(key: string | null): string {
  return key !== null && (STRATEGY_KEYS as readonly string[]).includes(key) ? key : OTHER_KEY;
}

/**
 * Builds in rank order, with the API's own order as the tie-break.
 *
 * A stable sort is specified by the language now, but the explicit index makes
 * the tie-break visible: two builds with the same rank would otherwise depend on
 * an implementation detail to render in a fixed order.
 */
export function orderBuilds(builds: readonly Build[]): Build[] {
  return builds
    .map((build, index) => ({ build, index }))
    .sort((a, b) => a.build.rank - b.build.rank || a.index - b.index)
    .map((entry) => entry.build);
}

/** Where a card stops reading as comfortable: the last tenth of the budget. */
export const NEAR_BUDGET_RATIO = 0.9;

export type BudgetTone = "normal" | "warning" | "over";

/**
 * The bar's tone from two numbers.
 *
 * `over` is arithmetic (`total > budget`). `warning` is the band starting at
 * 90 % of the budget, and exactly-on-budget is `warning` rather than `over`: the
 * build is affordable, with no room left. A missing total or budget — or a
 * non-positive one — is `normal`, because a bar is not drawn for it at all
 * (`hasBar`) and a tone without a bar would be a claim about nothing.
 */
export function budgetTone(total: number | null, budget: number | null): BudgetTone {
  const pair = barFigures(total, budget);
  if (pair === null) return "normal";
  if (pair.total > pair.budget) return "over";
  return pair.total >= pair.budget * NEAR_BUDGET_RATIO ? "warning" : "normal";
}

/** The bar's denominator is the query budget, never the build's total. */
export function hasBar(total: number | null, budget: number | null): boolean {
  return barFigures(total, budget) !== null;
}

/**
 * The two numbers a bar needs, narrowed, or null.
 *
 * A bar is drawn only from positive, finite figures: `total_price` and
 * `budget_amount` are nullable columns, and a zero or a NaN is not a cheaper
 * build — it is a number that was never recorded, which must not paint as 0 %.
 * Exported narrowed so a component never has to assert non-nullness to draw it.
 */
export function barFigures(
  total: number | null,
  budget: number | null,
): { total: number; budget: number } | null {
  if (
    typeof total !== "number" ||
    typeof budget !== "number" ||
    !Number.isFinite(total) ||
    !Number.isFinite(budget) ||
    total <= 0 ||
    budget <= 0
  ) {
    return null;
  }
  return { total, budget };
}

/** How far past the budget a total sits, or null when it does not. */
export function overBudgetBy(total: number | null, budget: number | null): number | null {
  const pair = barFigures(total, budget);
  if (pair === null) return null;
  const excess = pair.total - pair.budget;
  return excess > 0 ? excess : null;
}

/** What is left of the budget, or null when the total is unknown or over it. */
export function remainingBudget(total: number | null, budget: number | null): number | null {
  const pair = barFigures(total, budget);
  if (pair === null) return null;
  const left = pair.budget - pair.total;
  return left >= 0 ? left : null;
}

/**
 * Whether the variant is worth printing beside the name.
 *
 * The contract carries both, and `display_name` often already contains the
 * variant ("RTX 4060 8GB" with `variant: "8GB"`). Printing both reads as a
 * stutter — measured on the fixture, which is why this is a function rather than
 * an inline `variant !== null`.
 */
export function showsVariant(name: string, variant: string | null): boolean {
  if (variant === null || variant.trim() === "") return false;
  return !name.toLowerCase().includes(variant.trim().toLowerCase());
}
