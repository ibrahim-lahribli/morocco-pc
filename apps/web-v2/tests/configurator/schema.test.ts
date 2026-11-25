import { describe, expect, it } from "vitest";

import { parseConfiguratorSearchParams } from "@/lib/configurator/schema";

describe("parseConfiguratorSearchParams", () => {
  it("defaults to Step 1 without a step parameter", () => {
    expect(parseConfiguratorSearchParams({})).toEqual({
      step: 1,
      useCase: null,
      budgetAmount: null,
    });
    expect(parseConfiguratorSearchParams({ use_case: "GAMING", budget: "8000" })).toEqual({
      step: 1,
      useCase: "GAMING",
      budgetAmount: 8000,
    });
    expect(
      parseConfiguratorSearchParams({ step: "1", use_case: "GAMING", budget: "8000" }).step,
    ).toBe(1);
  });

  it("reaches Step 2 only with step=2 AND a complete valid handoff", () => {
    expect(
      parseConfiguratorSearchParams({ step: "2", use_case: "GAMING", budget: "8000" }),
    ).toEqual({
      step: 2,
      useCase: "GAMING",
      budgetAmount: 8000,
    });
  });

  it("falls back to Step 1 when step=2 misses an answer", () => {
    const incomplete = [
      { step: "2" },
      { step: "2", use_case: "GAMING" },
      { step: "2", budget: "8000" },
    ];

    for (const params of incomplete) {
      const seed = parseConfiguratorSearchParams(params);
      expect(seed.step).toBe(1);
    }
  });

  it("falls back to Step 1 when step=2 carries an invalid answer", () => {
    const invalid = [
      { step: "2", use_case: "CONSOLE", budget: "8000" },
      { step: "2", use_case: "GAMING", budget: "12" },
      { step: "2", use_case: "GAMING", budget: "3499" },
      { step: "2", use_case: "GAMING", budget: "100001" },
      { step: "2", use_case: "GAMING", budget: "9 000" },
      { step: "2", use_case: ["GAMING", "OFFICE"], budget: "8000" },
      { step: "2", use_case: "GAMING", budget: ["8000", "9000"] },
    ];

    for (const params of invalid) {
      const seed = parseConfiguratorSearchParams(params);
      expect(seed.step).toBe(1);
    }

    // The valid neighbour still parses even when the pair falls back.
    const seed = parseConfiguratorSearchParams({ step: "2", use_case: "CONSOLE", budget: "8000" });
    expect(seed.useCase).toBeNull();
    expect(seed.budgetAmount).toBe(8000);
  });

  it("accepts the budget bounds", () => {
    expect(
      parseConfiguratorSearchParams({ step: "2", use_case: "OFFICE", budget: "3500" }).budgetAmount,
    ).toBe(3500);
    expect(
      parseConfiguratorSearchParams({ step: "2", use_case: "OFFICE", budget: "100000" })
        .budgetAmount,
    ).toBe(100000);
  });

  it('treats every value other than the exact string "2" as not step 2', () => {
    for (const step of ["0", "3", "abc", "02", ["1", "2"], ""]) {
      const seed = parseConfiguratorSearchParams({
        step: step as string | string[],
        use_case: "GAMING",
        budget: "8000",
      });
      expect(seed.step).toBe(1);
    }
  });

  it("ignores unknown parameters", () => {
    const seed = parseConfiguratorSearchParams({
      utm_source: "x",
      from: "rec-1",
      step: "2",
      use_case: "OFFICE",
      budget: "6000",
    });

    expect(seed).toEqual({ step: 2, useCase: "OFFICE", budgetAmount: 6000 });
  });
});
