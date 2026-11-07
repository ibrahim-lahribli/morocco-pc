import { describe, expect, it } from "vitest";

import {
  createRequirementsSchema,
  parseBudgetInput,
  parseConfiguratorSearchParams,
  resolveRequirementsBudget,
} from "@/lib/configurator/schema";

describe("parseConfiguratorSearchParams", () => {
  it("accepts a valid deep link", () => {
    expect(parseConfiguratorSearchParams({ use_case: "GAMING", budget: "12000" })).toEqual({
      useCase: "GAMING",
      budgetAmount: 12000,
      budgetText: null,
      recommendationId: null,
      fieldErrors: {},
    });
  });

  it("keeps the valid neighbour when one field is invalid", () => {
    const seed = parseConfiguratorSearchParams({ use_case: "GAMING", budget: "12" });

    expect(seed.useCase).toBe("GAMING");
    expect(seed.budgetAmount).toBeNull();
    expect(seed.budgetText).toBe("12");
    expect(seed.fieldErrors.budget).toBe("BUDGET_RANGE");
  });

  it("rejects an unknown use case without touching the budget", () => {
    const seed = parseConfiguratorSearchParams({ use_case: "CONSOLE", budget: "8000" });

    expect(seed.useCase).toBeNull();
    expect(seed.budgetAmount).toBe(8000);
    expect(seed.fieldErrors.useCase).toBe("USE_CASE_INVALID");
  });

  it("rejects a non-numeric or repeated budget as invalid, not out of range", () => {
    const spaced = parseConfiguratorSearchParams({ budget: "9 000" });
    expect(spaced.fieldErrors.budget).toBe("BUDGET_INVALID");
    expect(spaced.budgetText).toBe("9 000");
    expect(parseConfiguratorSearchParams({ budget: ["9000", "12000"] }).fieldErrors.budget).toBe(
      "BUDGET_INVALID",
    );
  });

  it("rejects repeated use-case and recommendation values", () => {
    const seed = parseConfiguratorSearchParams({
      use_case: ["GAMING", "OFFICE"],
      from: ["3b157941-b4df-4945-a6ae-e6e079644e4c"],
    });

    expect(seed.fieldErrors.useCase).toBe("USE_CASE_INVALID");
    expect(seed.fieldErrors.from).toBe("FROM_INVALID");
  });

  it("accepts the bounds and rejects 3499 / 100001 as out of range", () => {
    expect(parseConfiguratorSearchParams({ budget: "3500" }).budgetAmount).toBe(3500);
    expect(parseConfiguratorSearchParams({ budget: "100000" }).budgetAmount).toBe(100000);
    expect(parseConfiguratorSearchParams({ budget: "3499" }).fieldErrors.budget).toBe(
      "BUDGET_RANGE",
    );
    expect(parseConfiguratorSearchParams({ budget: "100001" }).fieldErrors.budget).toBe(
      "BUDGET_RANGE",
    );
  });

  it("accepts a canonical UUID and normalises it, rejecting anything else", () => {
    const id = "3B157941-B4DF-4945-A6AE-E6E079644E4C";

    expect(parseConfiguratorSearchParams({ from: id }).recommendationId).toBe(id.toLowerCase());
    expect(parseConfiguratorSearchParams({ from: "rec-1" }).recommendationId).toBeNull();
    expect(parseConfiguratorSearchParams({ from: "rec-1" }).fieldErrors.from).toBe("FROM_INVALID");
  });

  it("ignores unknown parameters", () => {
    expect(parseConfiguratorSearchParams({ utm_source: "x", use_case: "OFFICE" }).useCase).toBe(
      "OFFICE",
    );
  });
});

describe("requirements schema", () => {
  const schema = createRequirementsSchema({
    useCaseRequired: "Choisissez un usage.",
    budgetRequired: "Saisissez un budget.",
    budgetRange: "Saisissez un budget entre 3 500 et 100 000 DH.",
  });

  it("rejects an empty form with one message per field", () => {
    const result = schema.safeParse({ useCase: null, budget: "" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual([
        "Choisissez un usage.",
        "Saisissez un budget.",
      ]);
    }
  });

  it("accepts an integer in bounds and resolves it to a number", () => {
    const values = { useCase: "GAMING" as const, budget: "8000" };

    expect(schema.safeParse(values).success).toBe(true);
    expect(resolveRequirementsBudget(values)).toBe(8000);
  });

  it("rejects a decimal, a space-grouped amount and out-of-range values", () => {
    for (const budget of ["9000,5", "9 000", "3499", "100001"]) {
      expect(schema.safeParse({ useCase: "GAMING", budget }).success).toBe(false);
      expect(parseBudgetInput(budget)).toBeNull();
    }
  });
});
