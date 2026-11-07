import { describe, expect, it } from "vitest";

import {
  BUDGET_MAX,
  BUDGET_MIN,
  createFinderSchema,
  resolveBudgetAmount,
} from "@/lib/homepage/finder-schema";

const messages = {
  required: "Choisissez un budget et un usage pour continuer.",
  budgetRange: "Saisissez un budget entre 3 500 et 100 000 DH.",
};

const schema = createFinderSchema(messages);

describe("finder schema", () => {
  it("accepts a preset with a use case", () => {
    expect(
      schema.safeParse({ budgetPreset: 8_000, customBudget: "", useCase: "GAMING" }).success,
    ).toBe(true);
  });

  it("accepts both custom-budget bounds and rejects one dirham below the floor", () => {
    expect(
      schema.safeParse({ budgetPreset: null, customBudget: String(BUDGET_MIN), useCase: "OFFICE" })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({ budgetPreset: null, customBudget: String(BUDGET_MAX), useCase: "OFFICE" })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({
        budgetPreset: null,
        customBudget: String(BUDGET_MIN - 1),
        useCase: "OFFICE",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-integer custom budget with the range message", () => {
    const result = schema.safeParse({
      budgetPreset: null,
      customBudget: "9 000,5",
      useCase: "OFFICE",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(messages.budgetRange);
    }
  });

  it("requires both answers", () => {
    const result = schema.safeParse({ budgetPreset: null, customBudget: "", useCase: null });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(messages.required);
    }
  });

  it("rejects a preset the budget options do not offer", () => {
    expect(
      schema.safeParse({ budgetPreset: 9_000, customBudget: "", useCase: "GAMING" }).success,
    ).toBe(false);
  });

  it("resolves the amount from the preset first, then the custom field", () => {
    expect(
      resolveBudgetAmount({ budgetPreset: 12_000, customBudget: "9000", useCase: "GAMING" }),
    ).toBe(12_000);
    expect(
      resolveBudgetAmount({ budgetPreset: null, customBudget: "9000", useCase: "GAMING" }),
    ).toBe(9_000);
    expect(resolveBudgetAmount({ budgetPreset: null, customBudget: "", useCase: null })).toBeNull();
    expect(
      resolveBudgetAmount({ budgetPreset: null, customBudget: "900", useCase: "GAMING" }),
    ).toBeNull();
  });
});
