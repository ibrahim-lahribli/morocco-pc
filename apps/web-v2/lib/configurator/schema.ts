/**
 * The configurator's URL contract.
 *
 * The route is entered either from a homepage handoff (quick start) or from
 * the navigation ("Configurer"), so every answer may arrive as text in
 * `searchParams`. Parsing is per field: one bad value is dropped to `null`
 * without affecting a valid neighbour. Nothing is rewritten and the URL is
 * never modified here — a `step=2` that arrives incomplete renders Step 1
 * content while keeping the URL the visitor arrived with.
 *
 * One module owns both directions of the URL contract, so the link the
 * homepage builds and the seed the route parses cannot drift apart.
 */
import { HOME_USE_CASES, type HomeUseCase } from "@/lib/homepage/builds";
import { BUDGET_MAX, BUDGET_MIN } from "@/lib/homepage/finder-schema";

export type ConfiguratorUseCase = HomeUseCase;

export type ConfiguratorStep = 1 | 2;

/** What the server hands the page; serialisable and already validated. */
export interface ConfiguratorSeed {
  step: ConfiguratorStep;
  /** Guaranteed non-null when `step === 2`; parsed but unused on Step 1. */
  useCase: ConfiguratorUseCase | null;
  /** Guaranteed non-null when `step === 2`; parsed but unused on Step 1. */
  budgetAmount: number | null;
}

/** `searchParams` as Next.js supplies them: one value, repeated values, or absent. */
export type RawSearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function parseBudget(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < BUDGET_MIN || value > BUDGET_MAX) {
    return null;
  }

  return value;
}

export function parseConfiguratorSearchParams(params: RawSearchParams): ConfiguratorSeed {
  const useCaseRaw = params.use_case;
  const useCase =
    typeof useCaseRaw === "string" && (HOME_USE_CASES as readonly string[]).includes(useCaseRaw)
      ? (useCaseRaw as ConfiguratorUseCase)
      : null;

  const budgetRaw = params.budget;
  const budgetAmount = typeof budgetRaw === "string" ? parseBudget(budgetRaw) : null;

  // Only the exact string "2" can promote to Step 2, and only with both
  // answers present: "1", "02", repeats and every other value are Step 1.
  const stepTwoRequested = params.step === "2";
  const step: ConfiguratorStep =
    stepTwoRequested && useCase !== null && budgetAmount !== null ? 2 : 1;

  return { step, useCase, budgetAmount };
}

export interface ConfiguratorHandoffAnswers {
  useCase: ConfiguratorUseCase | null;
  budgetAmount: number | null;
}

/**
 * The inverse of `parseConfiguratorSearchParams`, for the homepage handoff.
 *
 * Returns `null` rather than inventing an answer: an incomplete or
 * out-of-contract pair must leave the visitor on the page, never navigate to a
 * link the route would render as Step 1. A returned href always carries
 * `step=2` — the same completeness rule both sides apply.
 */
export function buildConfiguratorHref(answers: ConfiguratorHandoffAnswers): string | null {
  const { useCase, budgetAmount } = answers;

  if (useCase === null || !(HOME_USE_CASES as readonly string[]).includes(useCase)) {
    return null;
  }
  if (budgetAmount === null || !Number.isSafeInteger(budgetAmount)) {
    return null;
  }
  if (budgetAmount < BUDGET_MIN || budgetAmount > BUDGET_MAX) {
    return null;
  }

  const params = new URLSearchParams({
    step: "2",
    use_case: useCase,
    budget: String(budgetAmount),
  });
  return `/configurateur?${params.toString()}`;
}
