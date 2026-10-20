/**
 * apps/web/e2e/wizard-model.spec.ts — the state machine without a browser.
 *
 * `lib/wizard/model.ts` is where the URL contract is decided, so it is tested
 * directly (the same way `api-contract.spec.ts` tests the client): a parsing or
 * validation rule that only fails in the UI would be caught four screens later,
 * in a spec that also has to render a page.
 */

import { test, expect } from "@playwright/test";

import {
  BUDGET_MAX,
  BUDGET_MIN,
  STEPS,
  firstInvalidStep,
  firstInvalidStepBefore,
  isStepValid,
  parseAmount,
  readState,
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
