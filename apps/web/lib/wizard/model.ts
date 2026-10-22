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
 * Three deliberate choices:
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
 *
 * 3. **The flow is a FUNCTION of the answers (S9), not a constant.** `STEPS` is
 *    the superset in canonical order; `stepsFor()` is what a given profile
 *    actually walks. Two things narrow it: the use case (resolution is a gaming
 *    question) and the contract's `inputs_applied` truth, which — once the
 *    contract serves it — hides a question it has declared inert instead of
 *    asking it and storing the answer. `normalizeAnswers()` is the other half of
 *    that rule: an answer whose step is not in the flow is dropped, so the URL,
 *    the progress line and the request body cannot disagree about the flow.
 */
import type { AppliedInput, AppliedInputs } from "./applied";

/** The superset, in canonical order. `stepsFor()` narrows it per profile. */
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
 * The budget's granularity (S8), in MAD. It lives here for the same reason the
 * bounds do: the rail, the snap note, the arrow keys and the tests must agree by
 * construction.
 */
export const BUDGET_STEP = 500;

/**
 * How many positions the budget rail has, 0..`BUDGET_SLIDER_POSITIONS` (S27).
 *
 * The rail is a POSITION domain, not an amount domain: a native
 * `<input type="range">` lays its thumb out linearly in its own value, so the
 * only way to give the low end of the budget more than 0.7 % of a 360 px track
 * is to make its value a position and map that position to an amount. A
 * thousand positions put the thumb within 0.1 % of any point on the rail, which
 * is finer than the 24 px thumb can express at 360 px.
 */
export const BUDGET_SLIDER_POSITIONS = 1000;

/**
 * What PageUp / PageDown move, in MAD (S27).
 *
 * Ten arrows, stated rather than inherited: the rail no longer has a constant
 * "ten positions" worth of movement, and a page that silently meant a tenth of
 * a curve is a rule nobody can describe to a keyboard user.
 */
export const BUDGET_PAGE_STEP = BUDGET_STEP * 10;

/** Which bound moved an amount, or null when it was already inside the range. */
export type BudgetClamp = "min" | "max" | null;

/**
 * Round an amount onto the slider's grid, then clamp it into the range.
 *
 * Rounding is `Math.round`, so a tie goes up (7 250 → 7 500). The clamp matters
 * after the round too: an amount at the top of the range must land exactly on
 * `BUDGET_MAX`, and 1 000 000 is on the grid (500 + 1999 × 500), so a slider at
 * End reaches the true maximum rather than 999 500.
 */
export function snapToStep(amount: number): number {
  const snapped = Math.round(amount / BUDGET_STEP) * BUDGET_STEP;
  return Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, snapped));
}

/**
 * Bring an amount into [min, max] and NAME the bound that moved it.
 *
 * The name is the point: S8 requires that clamping is guidance rather than a
 * silent reset, so the caller needs to know it happened — and which end it was —
 * to say so. The wording lives in the message catalogue, not here.
 */
export function clampBudget(amount: number): { amount: number; clamped: BudgetClamp } {
  if (amount < BUDGET_MIN) return { amount: BUDGET_MIN, clamped: "min" };
  if (amount > BUDGET_MAX) return { amount: BUDGET_MAX, clamped: "max" };
  return { amount, clamped: null };
}

/**
 * The amount a rail POSITION means (S27).
 *
 * Exponential, because budgets are: a 3 000 and a 5 000 budget are as far
 * apart as a 30 000 and a 50 000 one, so equal rail distance should mean equal
 * PROPORTION, not equal MAD. `BUDGET_MIN * (max/min)^(p / positions)` does that
 * and lands exactly on both ends (`p = 0` is 500, `p = 1000` is 1 000 000), then
 * snaps onto S8's grid — the rail still speaks in 500 MAD amounts, it just moves
 * through them unevenly.
 *
 * The consequence, stated rather than discovered: the curve is FINER than the
 * 500 grid at the bottom (many positions share one amount) and COARSER at the
 * top (one position step is more than 500 MAD above roughly 66 000), so a
 * few grid amounts have no position of their own. That is only a limit on the
 * RAIL — `TextField` still accepts any integer, and S8's rule that the typed
 * amount is the answer is what keeps the mismatch honest.
 */
export function budgetAtPosition(position: number): number {
  const bounded = Math.min(BUDGET_SLIDER_POSITIONS, Math.max(0, Math.round(position)));
  const ratio = BUDGET_MAX / BUDGET_MIN;
  return snapToStep(BUDGET_MIN * ratio ** (bounded / BUDGET_SLIDER_POSITIONS));
}

/**
 * The rail position nearest an amount — `budgetAtPosition`'s inverse (S27).
 *
 * Rounded to the nearest position rather than floored, so a drag landing a hair
 * either side of a rung still shows that rung. Callers pass a SNAPPED amount
 * (`snapToStep`), because the rail has no position for 7 300.
 *
 * Exactness is preserved where it matters: every amount below the curve's
 * crossover (around 66 000) round-trips through this pair unchanged, and the two
 * endpoints always do. Above it the rail's own resolution is coarser than the
 * grid, so a grid amount may land on a neighbour — the field keeps the exact
 * figure and the snap note says where the thumb went.
 */
export function positionForBudget(amount: number): number {
  if (amount <= BUDGET_MIN) return 0;
  if (amount >= BUDGET_MAX) return BUDGET_SLIDER_POSITIONS;
  const ratio = BUDGET_MAX / BUDGET_MIN;
  const position = Math.round(
    (BUDGET_SLIDER_POSITIONS * Math.log(amount / BUDGET_MIN)) / Math.log(ratio),
  );
  return Math.min(BUDGET_SLIDER_POSITIONS, Math.max(0, position));
}

/**
 * The amount a key press asks for on the budget rail, or null for a key the rail
 * leaves alone (S27).
 *
 * The rail's POSITION steps are uneven, so the keyboard cannot inherit the
 * browser's "+1 position" and still promise anything a person can predict. The
 * rule is therefore stated in amounts:
 *
 *   - Arrow keys move exactly `BUDGET_STEP` (500 MAD), as they did in S8;
 *   - PageUp / PageDown move `BUDGET_PAGE_STEP` (ten arrows);
 *   - Home and End jump to the bounds (500 and 1 000 000 — the latter is on the
 *     grid, so "End" lands on the true maximum).
 *
 * `rtl` mirrors only the HORIZONTAL arrows: in an RTL page the rail runs the
 * other way, so ArrowRight must move the thumb the way it points — rightward,
 * which is down the scale. ArrowUp / ArrowDown are vertical and never mirrored.
 */
export function budgetForSliderKey(key: string, current: number, rtl: boolean): number | null {
  const horizontal = rtl ? -1 : 1;
  switch (key) {
    case "ArrowUp":
      return clampBudget(current + BUDGET_STEP).amount;
    case "ArrowDown":
      return clampBudget(current - BUDGET_STEP).amount;
    case "ArrowRight":
      return clampBudget(current + horizontal * BUDGET_STEP).amount;
    case "ArrowLeft":
      return clampBudget(current - horizontal * BUDGET_STEP).amount;
    case "PageUp":
      return clampBudget(current + BUDGET_PAGE_STEP).amount;
    case "PageDown":
      return clampBudget(current - BUDGET_PAGE_STEP).amount;
    case "Home":
      return BUDGET_MIN;
    case "End":
      return BUDGET_MAX;
    default:
      return null;
  }
}

/** The currency the wizard sends. The market is Morocco and the contract
 * requires a three-letter code, but there is no currency picker: a control with
 * exactly one option is a control that lies about being a choice.
 */
export const CURRENCY = "MAD";

/**
 * The three priorities the wizard offers (S9), in display order: price first,
 * balanced, performance first.
 *
 * The API accepts 1..5 and advertises all five, so this is a DELIBERATE
 * narrowing rather than a copy of the contract: 2 and 4 are amplitudes of the
 * same axis, and a question with five answers where three mean "somewhere in
 * between" is harder to answer than the underlying decision is. The choice is
 * the model's, not the response's, so only 1/3/5 can ever reach the URL or the
 * POST body — `isStepValid` rejects anything else and `toRequest` cannot produce
 * one. Labels still come from `meta/options`, never from this file.
 */
export const PRIORITY_CHOICES = [1, 3, 5] as const;

/** Whether a number is one of the three the wizard offers. */
export function isPriorityChoice(value: number): boolean {
  return (PRIORITY_CHOICES as readonly number[]).includes(value);
}

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
 * `resolveStep` possible.
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

/**
 * Whether a use case asks the resolution question (S9).
 *
 * The contract's use-case vocabulary is DATA — the active scoring model's
 * `use_case_profiles` keys — so this module cannot enumerate it, and a hardcoded
 * list of "gaming use cases" would silently stop matching the day a model spells
 * one differently. The rule is therefore the prefix the vocabulary already uses:
 * `GAMING` and any `GAMING_*` variant ask where the picture goes; office, work,
 * creation and ML profiles do not.
 *
 * WHAT THIS IS NOT: a claim that the answer changes anything. It decides whether
 * the question is worth asking; `inputs_applied` decides whether asking it is
 * honest, and a use case the vocabulary adds later that is gaming by another
 * name is CD-1's job to describe, not something this prefix should guess.
 */
export function isGamingFamily(useCase: string | undefined): boolean {
  return useCase !== undefined && useCase.startsWith("GAMING");
}

/**
 * Whether the contract says an answer is actually read (`inputs_applied`).
 *
 * A SILENT contract (null — today's, CD-1 is not served yet) is not the same as
 * "nothing is applied": silence means we do not know, so the question is asked
 * and the copy says the answer is stored rather than used (OD1). A contract that
 * DOES answer is taken at its word and the question is not shown.
 */
function applies(input: AppliedInput, applied: AppliedInputs): boolean {
  return applied === null ? true : applied.has(input);
}

/**
 * The steps one profile actually walks, in order.
 *
 * `usage` and `budget` are always there: `use_case` is required by the POST body
 * and the budget is the query itself, so neither can be dropped however inert
 * the contract says they are. They are also the two answers every profile needs
 * before any of the rest is meaningful.
 *
 * While the use case is still UNANSWERED the flow is the full one. Nothing has
 * narrowed it yet, so the alternative — guessing the short flow — would make the
 * first screen say "Étape 1 sur 3" and rewrite itself to "sur 4" the moment the
 * user picked gaming. A wizard whose length changes before the answer that
 * decides it is a wizard that lied once.
 */
export function stepsFor(answers: Answers, applied: AppliedInputs = null): WizardStep[] {
  return STEPS.filter((step) => {
    switch (step) {
      case "usage":
      case "budget":
        return true;
      case "resolution":
        return (answers.use_case === undefined || isGamingFamily(answers.use_case)) &&
          applies("resolution", applied);
      case "priority":
        return applies("priority", applied);
    }
  });
}

/**
 * Drop the answers whose step this profile does not walk.
 *
 * The other half of `stepsFor`. Without it a profile that changes use case (or a
 * contract that starts declaring an input inert) keeps a committed answer in the
 * URL that nothing asks for any more — and `toRequest` would either send it or,
 * worse, omit it while the URL still showed it as answered.
 */
export function normalizeAnswers(answers: Answers, applied: AppliedInputs = null): Answers {
  const steps = stepsFor(answers, applied);
  return {
    use_case: answers.use_case,
    budget_amount: answers.budget_amount,
    resolution: steps.includes("resolution") ? answers.resolution : undefined,
    priority: steps.includes("priority") ? answers.priority : undefined,
  };
}

/**
 * The step that owns a contract field, or null when no control sets it.
 *
 * Used by a 422 (S10): the API names the field it refused, and the screen has
 * to put the user where that field lives. `currency` has no answer here — the
 * wizard fixes it to MAD — so it returns null and the failure is reported as a
 * sentence instead of a jump.
 */
export function stepForField(field: string): WizardStep | null {
  switch (field) {
    case "use_case":
      return "usage";
    case "budget_amount":
      return "budget";
    case "resolution":
      return "resolution";
    case "priority":
      return "priority";
    default:
      return null;
  }
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
      return answers.priority !== undefined && isPriorityChoice(answers.priority);
  }
}

/** The first step THIS profile cannot pass, or null when it is answerable. */
export function firstInvalidStep(answers: Answers, applied: AppliedInputs = null): WizardStep | null {
  return stepsFor(answers, applied).find((step) => !isStepValid(step, answers)) ?? null;
}

/** The position of a step in this profile's flow, or -1 when it is not one. */
export function stepIndex(
  step: WizardStep,
  answers: Answers,
  applied: AppliedInputs = null,
): number {
  return stepsFor(answers, applied).indexOf(step);
}

export function nextStep(
  step: WizardStep,
  answers: Answers,
  applied: AppliedInputs = null,
): WizardStep | null {
  const steps = stepsFor(answers, applied);
  const index = steps.indexOf(step);
  return index < 0 ? null : steps[index + 1] ?? null;
}

export function previousStep(
  step: WizardStep,
  answers: Answers,
  applied: AppliedInputs = null,
): WizardStep | null {
  const index = stepIndex(step, answers, applied);
  return index <= 0 ? null : stepsFor(answers, applied)[index - 1];
}

/**
 * The step a deep link should be MOVED to, or null when the current one is
 * reachable.
 *
 * Two repairs, in this order:
 *
 * 1. **A step this profile does not walk.** `?etape=resolution` on an office
 *    profile is not an invalid answer, it is a URL from a different flow, and
 *    the honest landing place is the first step at or after that position in
 *    the canonical order — the user was heading forwards.
 * 2. **A step that skips an unanswered earlier step.** Only steps BEFORE the
 *    current one are checked: sitting on step 1 with no answer is just step 1,
 *    and policing the current step would fight the user the instant they clear a
 *    field. The point of this function is to repair a URL, not a form in
 *    progress.
 */
export function resolveStep(
  step: WizardStep,
  answers: Answers,
  applied: AppliedInputs = null,
): WizardStep | null {
  const steps = stepsFor(answers, applied);
  if (!steps.includes(step)) {
    const position = STEPS.indexOf(step);
    return steps.find((candidate) => STEPS.indexOf(candidate) >= position) ?? steps[steps.length - 1];
  }
  return firstInvalidStepBefore(step, answers, applied);
}

/** The step a deep link should be moved BACK to, or null when none is skipped. */
export function firstInvalidStepBefore(
  step: WizardStep,
  answers: Answers,
  applied: AppliedInputs = null,
): WizardStep | null {
  const invalid = firstInvalidStep(answers, applied);
  if (invalid === null) return null;
  return stepIndex(invalid, answers, applied) < stepIndex(step, answers, applied) ? invalid : null;
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
 *
 * An answer whose step this profile does not walk is OMITTED rather than sent:
 * `resolution` for an office profile is not "no answer", it is a question that
 * was never asked (S9).
 */
export function toRequest(
  answers: Answers,
  applied: AppliedInputs = null,
): {
  budget_amount: number;
  currency: string;
  use_case: string;
  resolution?: string;
  priority?: number;
} | null {
  if (firstInvalidStep(answers, applied) !== null) return null;
  const steps = stepsFor(answers, applied);
  return {
    budget_amount: answers.budget_amount as number,
    currency: CURRENCY,
    use_case: answers.use_case as string,
    ...(steps.includes("resolution") && answers.resolution !== undefined
      ? { resolution: answers.resolution }
      : {}),
    ...(steps.includes("priority") && answers.priority !== undefined
      ? { priority: answers.priority }
      : {}),
  };
}
