/**
 * apps/web/e2e/wizard-submit-model.spec.ts — S10's two rules, without a browser.
 *
 * `lib/wizard/submit.ts` decides (a) whether a body is one the contract accepts
 * and (b) what a failure MEANS. Both are pure, and both are the kind of rule
 * that only fails on the last screen of a flow — so they are tested directly,
 * the way `wizard-model.spec.ts` tests the state machine.
 *
 * The validation table is deliberately a mirror of
 * `apps/api/src/contracts/recommendations.js`: `budget_amount` is a number,
 * `currency` is exactly three characters, unknown fields are rejected. If the
 * API's schema moves, this file is where the client's copy of the rule is
 * updated — and the assertion that matters most is the first one, because a
 * body produced by the wizard must pass its own check.
 */

import { test, expect } from "@playwright/test";

import { ApiError } from "../lib/api/client";
import { toRequest } from "../lib/wizard/model";
import { mapSubmitFailure, validateRequest } from "../lib/wizard/submit";

const COMPLETE = {
  use_case: "GAMING",
  budget_amount: 7300,
  resolution: "1440p",
  priority: 3,
};

function apiError(init: {
  status: number;
  code?: string;
  details?: { field: string; message: string }[];
  requestId?: string;
  retryAfterSeconds?: number;
}): ApiError {
  return new ApiError({
    status: init.status,
    code: init.code ?? "TEST",
    message: "test",
    details: init.details,
    requestId: init.requestId,
    retryAfterSeconds: init.retryAfterSeconds,
  });
}

test("the body the wizard builds passes its own contract check", () => {
  const request = toRequest(COMPLETE);
  expect(request).not.toBeNull();
  expect(validateRequest(request)).toEqual([]);
  // The optional fields are optional: a minimal body is valid too.
  expect(validateRequest(toRequest({ use_case: "OFFICE", budget_amount: 6000, priority: 3 }))).toEqual(
    [],
  );
});

test("a numeric string is refused here, exactly as the API would refuse it", () => {
  // Scenario 1: the string never reaches the network.
  expect(validateRequest({ ...toRequest(COMPLETE), budget_amount: "7300" })).toEqual([
    "budget_amount",
  ]);
  expect(validateRequest({ ...toRequest(COMPLETE), budget_amount: 0 })).toEqual(["budget_amount"]);
  expect(validateRequest({ ...toRequest(COMPLETE), budget_amount: 7300.5 })).toEqual([
    "budget_amount",
  ]);
  // The contract's ceiling is inclusive; one past it is not.
  expect(validateRequest({ ...toRequest(COMPLETE), budget_amount: 1_000_000 })).toEqual([]);
  expect(validateRequest({ ...toRequest(COMPLETE), budget_amount: 1_000_001 })).toEqual([
    "budget_amount",
  ]);
});

test("currency is three characters and use_case is not empty", () => {
  expect(validateRequest({ ...toRequest(COMPLETE), currency: "MA" })).toEqual(["currency"]);
  expect(validateRequest({ ...toRequest(COMPLETE), use_case: "" })).toEqual(["use_case"]);
  expect(validateRequest({ ...toRequest(COMPLETE), resolution: "" })).toEqual(["resolution"]);
  // 1..5 is the CONTRACT's range; the wizard's 1/3/5 narrowing is model.ts's.
  for (const priority of [1, 2, 3, 4, 5]) {
    expect(validateRequest({ ...toRequest(COMPLETE), priority })).toEqual([]);
  }
  for (const priority of [0, 6, 2.5]) {
    expect(validateRequest({ ...toRequest(COMPLETE), priority })).toEqual(["priority"]);
  }
});

test("an unknown field is refused by name, in the contract's order", () => {
  expect(validateRequest({ ...toRequest(COMPLETE), budget: 7300 })).toEqual(["budget"]);
  // Several problems are all reported, required fields first.
  expect(
    validateRequest({ budget_amount: "7300", currency: "MAD", use_case: "GAMING", priority: 9 }),
  ).toEqual(["budget_amount", "priority"]);
  expect(validateRequest(null)).toEqual(["budget_amount", "currency", "use_case"]);
});

test("every failure becomes one of five states a screen can render", () => {
  expect(mapSubmitFailure(apiError({ status: 413 }))).toEqual({ kind: "too-large" });
  expect(mapSubmitFailure(apiError({ status: 503 }))).toEqual({ kind: "unavailable" });
  // A network failure is indistinguishable from an outage on the user's side.
  expect(mapSubmitFailure(apiError({ status: 0, code: "NETWORK_ERROR" }))).toEqual({
    kind: "unavailable",
  });
  expect(mapSubmitFailure(apiError({ status: 500, requestId: "req_fixture_500" }))).toEqual({
    kind: "server",
    requestId: "req_fixture_500",
  });
  // No request id is still a server failure: the screen just omits the handle.
  expect(mapSubmitFailure(apiError({ status: 500 }))).toEqual({ kind: "server", requestId: null });
  // A thrown non-ApiError is a client bug; it must not surface as a stack trace.
  expect(mapSubmitFailure(new TypeError("boom"))).toEqual({ kind: "server", requestId: null });
});

test("a 422 names its fields once each, and an empty details[] is still a field failure", () => {
  expect(
    mapSubmitFailure(
      apiError({
        status: 422,
        details: [
          { field: "budget_amount", message: "must be number" },
          { field: "budget_amount", message: "must be > 0" },
          { field: "use_case", message: "unknown value" },
        ],
      }),
    ),
  ).toEqual({ kind: "fields", fields: ["budget_amount", "use_case"] });
  // The screen falls back to its general sentence rather than inventing a field.
  expect(mapSubmitFailure(apiError({ status: 422 }))).toEqual({ kind: "fields", fields: [] });
});

test("a 429 carries the countdown only when the API gave one", () => {
  expect(mapSubmitFailure(apiError({ status: 429, retryAfterSeconds: 30 }))).toEqual({
    kind: "rate-limited",
    retryAfterSeconds: 30,
  });
  expect(mapSubmitFailure(apiError({ status: 429 }))).toEqual({
    kind: "rate-limited",
    retryAfterSeconds: null,
  });
});
