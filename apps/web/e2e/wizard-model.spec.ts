/**
 * apps/web/e2e/wizard-model.spec.ts — the state machine without a browser.
 *
 * `lib/wizard/model.ts` is where the URL contract is decided, so it is tested
 * directly (the same way `api-contract.spec.ts` tests the client): a parsing or
 * validation rule that only fails in the UI would be caught four screens later,
 * in a spec that also has to render a page.
 */

import { test, expect } from "@playwright/test";

import { APPLIED_INPUTS, readAppliedInputs } from "../lib/wizard/applied";
import {
  BUDGET_MAX,
  BUDGET_MIN,
  BUDGET_STEP,
  PRIORITY_CHOICES,
  STEPS,
  clampBudget,
  firstInvalidStep,
  firstInvalidStepBefore,
  isStepValid,
  isPriorityChoice,
  normalizeAnswers,
  parseAmount,
  readState,
  resolveStep,
  snapToStep,
  stepsFor,
  toHref,
  toRequest,
  toSearch,
} from "../lib/wizard/model";

const COMPLETE = {
  use_case: "GAMING",
  budget_amount: 7300,
  resolution: "1440p",
  priority: 3,
};

test("an empty or unknown query is the first step, with no answers", () => {
  for (const search of ["", "?etape=", "?etape=42", "?etape=wizard"]) {
    const state = readState(new URLSearchParams(search));
    expect(state.step).toBe(STEPS[0]);
    expect(state.answers).toEqual({
      use_case: undefined,
      budget_amount: undefined,
      resolution: undefined,
      priority: undefined,
    });
  }
});

test("amounts lose their grouping separator, and no digits is NOT zero", () => {
  expect(parseAmount("7 300")).toBe(7300);
  expect(parseAmount("7\u202F300")).toBe(7300);
  expect(parseAmount("7.300")).toBe(7300);
  expect(parseAmount("7300")).toBe(7300);
  expect(parseAmount("")).toBeNull();
  expect(parseAmount(null)).toBeNull();
  expect(parseAmount("dh")).toBeNull();
});

test("the budget range is the model's, not the input's", () => {
  const at = (budget_amount: number) => isStepValid("budget", { budget_amount });
  expect(at(BUDGET_MIN)).toBe(true);
  expect(at(BUDGET_MAX)).toBe(true);
  expect(at(BUDGET_MIN - 1)).toBe(false);
  expect(at(BUDGET_MAX + 1)).toBe(false);
  expect(at(7300.5)).toBe(false);
});

test("the slider's grid rounds up, clamps, and lands exactly on the maximum", () => {
  expect(BUDGET_STEP).toBe(500);
  expect(snapToStep(7300)).toBe(7500);
  expect(snapToStep(7249)).toBe(7000);
  expect(snapToStep(7250)).toBe(7500);
  expect(snapToStep(250)).toBe(BUDGET_MIN); // clamped, not 0
  // Nearest point wins: 999 600 is closer to 999 500 than to the top.
  expect(snapToStep(999_600)).toBe(999_500);
  expect(snapToStep(999_800)).toBe(BUDGET_MAX);
  // End must reach the TRUE maximum, which only holds because the max is on the
  // grid: 500 + 1 999 × 500.
  expect((BUDGET_MAX - BUDGET_MIN) % BUDGET_STEP).toBe(0);
});

test("clampBudget names the bound that moved the amount", () => {
  // S8: clamping is guidance, so it has to say which end it was — the copy
  // chooses the words, the model only reports the fact.
  expect(clampBudget(50)).toEqual({ amount: BUDGET_MIN, clamped: "min" });
  expect(clampBudget(2_000_000)).toEqual({ amount: BUDGET_MAX, clamped: "max" });
  expect(clampBudget(7300)).toEqual({ amount: 7300, clamped: null });
  expect(clampBudget(BUDGET_MIN)).toEqual({ amount: BUDGET_MIN, clamped: null });
  expect(clampBudget(BUDGET_MAX)).toEqual({ amount: BUDGET_MAX, clamped: null });
});

test("a numeric string is not a budget: the contract takes a number", () => {
  // The URL always carries a string; reading it must still produce a NUMBER, or
  // S10 would POST `"7300"` and the API would answer 422.
  const state = readState(new URLSearchParams("etape=budget&budget_amount=7300"));
  expect(state.answers.budget_amount).toBe(7300);
  expect(typeof state.answers.budget_amount).toBe("number");
});

test("firstInvalidStepBefore repairs backwards only", () => {
  expect(firstInvalidStepBefore("usage", {})).toBeNull();
  expect(firstInvalidStepBefore("budget", {})).toBe("usage");
  expect(firstInvalidStepBefore("priority", { use_case: "GAMING" })).toBe("budget");
  expect(firstInvalidStepBefore("priority", COMPLETE)).toBeNull();
  // Standing ON an incomplete step is not a broken link.
  expect(firstInvalidStepBefore("resolution", { use_case: "GAMING", budget_amount: 7300 })).toBeNull();
});

test("firstInvalidStep lists the first gap in flow order", () => {
  expect(firstInvalidStep({})).toBe("usage");
  expect(firstInvalidStep({ use_case: "OFFICE" })).toBe("budget");
  expect(firstInvalidStep(COMPLETE)).toBeNull();
});

test("toSearch round-trips, and drops absent answers", () => {
  const state = readState(new URLSearchParams(toSearch({ step: "budget", answers: COMPLETE })));
  expect(state).toEqual({ step: "budget", answers: COMPLETE });

  const partial = toSearch({ step: "usage", answers: { use_case: "GAMING" } });
  expect(partial).toBe("?etape=usage&use_case=GAMING");

  // An explicit `undefined` (what "clear the field" writes) must REMOVE the
  // parameter rather than serialize the word.
  const cleared = toSearch({
    step: "budget",
    answers: { use_case: "GAMING", budget_amount: undefined },
  });
  expect(cleared).not.toContain("budget_amount");
});

test("toHref keeps the locale prefix", () => {
  expect(toHref("/ar/configurer", { step: "usage", answers: {} })).toBe(
    "/ar/configurer?etape=usage",
  );
});

test("the request body exists only when the flow is complete", () => {
  expect(toRequest({ use_case: "GAMING" })).toBeNull();
  expect(toRequest(COMPLETE)).toEqual({
    budget_amount: 7300,
    currency: "MAD",
    use_case: "GAMING",
    resolution: "1440p",
    priority: 3,
  });
});

test("the flow is the profile's: resolution is a gaming question", () => {
  // GAMING walks all four; OFFICE walks three, and the missing one is the
  // resolution question rather than the priority one.
  expect(stepsFor({ use_case: "GAMING" })).toEqual(["usage", "budget", "resolution", "priority"]);
  expect(stepsFor({ use_case: "OFFICE" })).toEqual(["usage", "budget", "priority"]);
  // The gaming family is the prefix the contract's vocabulary uses, so a
  // later GAMING_* value is asked too.
  expect(stepsFor({ use_case: "GAMING_4K" })).toContain("resolution");
  // An UNANSWERED use case has narrowed nothing yet, so the flow is full: a
  // first screen that guessed "sur 3" would rewrite itself to "sur 4" the
  // moment the user picked gaming.
  expect(stepsFor({})).toEqual(["usage", "budget", "resolution", "priority"]);
});

test("an answer whose step the profile does not walk is dropped, not sent", () => {
  const office = { use_case: "OFFICE", budget_amount: 7300, resolution: "1440p", priority: 3 };
  expect(normalizeAnswers(office).resolution).toBeUndefined();
  expect(toRequest(office)).toEqual({
    budget_amount: 7300,
    currency: "MAD",
    use_case: "OFFICE",
    priority: 3,
  });
  // GAMING keeps it: the step exists, so the answer belongs in the body.
  expect(toRequest({ ...office, use_case: "GAMING" })).toMatchObject({ resolution: "1440p" });
});

test("a step the profile lacks is resolved forwards, not to a dead end", () => {
  const answered = { use_case: "OFFICE", budget_amount: 7300 };
  expect(resolveStep("resolution", answered)).toBe("priority");
  // Already on a step of its own flow: no repair.
  expect(resolveStep("priority", answered)).toBeNull();
  // The backwards repair still applies inside the narrowed flow.
  expect(resolveStep("priority", { use_case: "OFFICE" })).toBe("budget");
});

test("only 1, 3 and 5 are priorities the wizard will send", () => {
  expect(PRIORITY_CHOICES).toEqual([1, 3, 5]);
  for (const value of [1, 3, 5]) expect(isPriorityChoice(value)).toBe(true);
  for (const value of [0, 2, 4, 6, 2.5]) expect(isPriorityChoice(value)).toBe(false);
  expect(isStepValid("priority", { priority: 2 })).toBe(false);
  expect(isStepValid("priority", { priority: 3 })).toBe(true);
});

test("inputs_applied: silence is not the same as an empty list", () => {
  // CD-1 is not served today, so the body has no such field.
  expect(readAppliedInputs({ use_cases: [], currencies: [], resolutions: [], priorities: [] })).toBeNull();
  expect(readAppliedInputs(null)).toBeNull();
  expect(readAppliedInputs("inputs_applied")).toBeNull();
  expect(readAppliedInputs({ inputs_applied: "resolution" })).toBeNull();
  // Present and readable: a Set, and unknown members do not silence the rest.
  const applied = readAppliedInputs({ inputs_applied: ["priority", "budget_amount", 7, null] });
  expect(applied).not.toBeNull();
  expect([...(applied ?? [])]).toEqual(["priority"]);
  expect(readAppliedInputs({ inputs_applied: [] })?.size).toBe(0);
  expect(APPLIED_INPUTS).toEqual(["use_case", "resolution", "priority"]);
});

test("a contract that speaks hides the steps it calls inert", () => {
  const applied = readAppliedInputs({ inputs_applied: ["priority"] });
  // Only priority is read, so resolution is not asked — but the required
  // use_case step stays, because the POST body cannot exist without it.
  expect(stepsFor({ use_case: "GAMING" }, applied)).toEqual(["usage", "budget", "priority"]);
  expect(normalizeAnswers({ use_case: "GAMING", resolution: "1080p" }, applied).resolution).toBeUndefined();
  // A silent contract asks both.
  expect(stepsFor({ use_case: "GAMING" }, null)).toContain("resolution");
});
