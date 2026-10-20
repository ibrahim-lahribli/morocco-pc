/**
 * The wizard's step machine (S7), as a pure module — no React, no fetch, no
 * clock, no randomness. Everything here is a function of the URL, which is the
 * whole point: **the URL is the state**.
 *
 * Why the URL and not `useState`: S7's definition of done asks that refresh,
 * back and forward all preserve the flow, and that a deep link with valid state
 * lands on its step. A component that keeps answers in memory satisfies none of
 * those — a refresh empties the form and a deep link cannot be "valid". So the
 * answers live in query parameters (`use_case`, `budget_amount`, `resolution`,
 * `priority`) beside the step (`etape`), and every screen derives what it shows
 * from them. There is no second copy of the state to fall out of sync.
 *
 * Two deliberate choices:
 *
 * 1. **Steps are NAMED, not numbered.** The sprint text allows `?etape=2`, but
 *    S9 makes the flow length depend on the profile (resolution exists only for
 *    gaming), and then "2" means different screens for different users. The
 *    VISIBLE numbering ("Étape 2 sur 4") is computed from the applicable list at
 *    render time, where it is a property of what the user sees rather than of
 *    the URL.
 *
 * 2. **The parameters use the contract's own field names.** `budget_amount`,
 *    `use_case`, `resolution`, `priority` are the names S10 posts; keeping one
 *    vocabulary from URL to request body means there is no renaming layer where
 *    a typo turns into a field the API silently ignores.
 */

/** The four steps, in order. S9 narrows this list for non-gaming profiles. */
export const STEPS = ["usage", "budget", "resolution", "priority"] as const;

export type WizardStep = (typeof STEPS)[number];

/**
 * The budget bounds. S8 owns the input (a 500 MAD slider plus free entry); the
 * MODEL owns the range, so the deep-link validation and the future slider agree
 * by construction instead of by copy-paste.
 */
export const BUDGET_MIN = 500;
export const BUDGET_MAX = 1_000_000;

/**
 * The currency the wizard sends. The market is Morocco and the contract
 * requires a three-letter code, but there is no currency picker: a control with
 * exactly one option is a control that lies about being a choice.
 */
export const CURRENCY = "MAD";

/** The answers, all optional because a deep link may carry a prefix of them. */
export interface Answers {
  use_case?: string;
  budget_amount?: number;
  resolution?: string;
  priority?: number;
}

export interface WizardState {
  step: WizardStep;
  answers: Answers;
}

/** The slice of `URLSearchParams` this module needs, so it stays unit-testable. */
export interface SearchParamsLike {
  get(name: string): string | null;
}

function nonEmpty(value: string | null): string | undefined {
  return value === null || value.trim() === "" ? undefined : value;
}

/**
 * Digits only, so the grouping separator can be any of the forms a user pastes
 * (a narrow space from our own formatter, an ordinary space, a dot). Returns
 * null for "no digits at all" — which is NOT the same as 0: an empty field is an
 * unimplemented answer, and 0 is an out-of-range one.
 */
export function parseAmount(raw: string | null): number | null {
  if (raw === null) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits === "") return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

function parseInteger(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

function isStep(value: string | null): value is WizardStep {
  return value !== null && (STEPS as readonly string[]).includes(value);
}

/**
 * Read the whole flow out of the query string.
 *
 * Unknown `etape` values fall back to the FIRST step rather than a 404: the
 * wizard is a tool, and a stale bookmark should land somewhere usable, not on a
 * dead end. An unknown answer value is kept as-is and simply fails validation
 * (or matches no option), which is what makes the "invalid state" redirect in
 * `firstInvalidStepBefore` possible.
 */
export function readState(search: SearchParamsLike): WizardState {
  const rawStep = search.get("etape");
  const step = isStep(rawStep) ? rawStep : STEPS[0];

  return {
    step,
    answers: {
      use_case: nonEmpty(search.get("use_case")),
      budget_amount: parseAmount(search.get("budget_amount")) ?? undefined,
      resolution: nonEmpty(search.get("resolution")),
      priority: parseInteger(search.get("priority")),
    },
  };
}

/** Whether one step's own answer is present and admissible. */
export function isStepValid(step: WizardStep, answers: Answers): boolean {
  switch (step) {
    case "usage":
      return answers.use_case !== undefined && answers.use_case.length > 0;
    case "budget":
      return (
        answers.budget_amount !== undefined &&
        Number.isInteger(answers.budget_amount) &&
        answers.budget_amount >= BUDGET_MIN &&
        answers.budget_amount <= BUDGET_MAX
      );
    case "resolution":
      return answers.resolution !== undefined && answers.resolution.length > 0;
    case "priority":
      return (
        answers.priority !== undefined &&
        Number.isInteger(answers.priority) &&
        answers.priority >= 1 &&
        answers.priority <= 5
      );
  }
}

/** The first step the flow cannot pass, or null when every step is answerable. */
export function firstInvalidStep(answers: Answers): WizardStep | null {
  return STEPS.find((step) => !isStepValid(step, answers)) ?? null;
}

export function stepIndex(step: WizardStep): number {
  return STEPS.indexOf(step);
}

export function nextStep(step: WizardStep): WizardStep | null {
  return STEPS[stepIndex(step) + 1] ?? null;
}

export function previousStep(step: WizardStep): WizardStep | null {
  return stepIndex(step) === 0 ? null : STEPS[stepIndex(step) - 1];
}

/**
 * The step a deep link should be MOVED to, or null when the current one is
 * reachable.
 *
 * Only steps BEFORE the current one are checked: landing on step 2 with no
 * answer is a broken link and gets corrected, while sitting on step 1 with no
 * answer is just… step 1. Checking the current step too would fight the user the
 * instant they clear a field — the point of this function is to repair a URL,
 * not to police a form in progress.
 */
export function firstInvalidStepBefore(
  step: WizardStep,
  answers: Answers,
): WizardStep | null {
  const invalid = firstInvalidStep(answers);
  if (invalid === null) return null;
  return stepIndex(invalid) < stepIndex(step) ? invalid : null;
}

/** The canonical query string for a state, `etape` first so URLs diff readably. */
export function toSearch(state: WizardState): string {
  const params = new URLSearchParams();
  params.set("etape", state.step);
  if (state.answers.use_case !== undefined) {
    params.set("use_case", state.answers.use_case);
  }
  if (state.answers.budget_amount !== undefined) {
    params.set("budget_amount", String(state.answers.budget_amount));
  }
  if (state.answers.resolution !== undefined) {
    params.set("resolution", state.answers.resolution);
  }
  if (state.answers.priority !== undefined) {
    params.set("priority", String(state.answers.priority));
  }
  return `?${params.toString()}`;
}

/** The path to navigate to, given the locale-prefixed pathname. */
export function toHref(pathname: string, state: WizardState): string {
  return `${pathname}${toSearch(state)}`;
}

/**
 * The body S10 will POST, or null while the flow is incomplete. Kept here so
 * the request shape is a property of the state machine rather than of whichever
 * component happens to own the submit button.
 */
export function toRequest(answers: Answers): {
  budget_amount: number;
  currency: string;
  use_case: string;
  resolution?: string;
  priority?: number;
} | null {
  if (firstInvalidStep(answers) !== null) return null;
  return {
    budget_amount: answers.budget_amount as number,
    currency: CURRENCY,
    use_case: answers.use_case as string,
    ...(answers.resolution === undefined ? {} : { resolution: answers.resolution }),
    ...(answers.priority === undefined ? {} : { priority: answers.priority }),
  };
}
