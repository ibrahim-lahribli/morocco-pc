import { describe, expect, it } from "vitest";

import { buildConfiguratorHref, parseConfiguratorSearchParams } from "@/lib/configurator/schema";

const queryOf = (href: string) =>
  Object.fromEntries(new URLSearchParams(href.slice(href.indexOf("?") + 1)));

describe("buildConfiguratorHref", () => {
  it("builds the canonical href for every use case", () => {
    expect(buildConfiguratorHref({ useCase: "GAMING", budgetAmount: 12_000 })).toBe(
      "/configurateur?use_case=GAMING&budget=12000",
    );
    expect(buildConfiguratorHref({ useCase: "OFFICE", budgetAmount: 8_000 })).toBe(
      "/configurateur?use_case=OFFICE&budget=8000",
    );
    expect(buildConfiguratorHref({ useCase: "WORKSTATION", budgetAmount: 15_000 })).toBe(
      "/configurateur?use_case=WORKSTATION&budget=15000",
    );
  });

  it("accepts both bounds and refuses everything outside the contract", () => {
    expect(buildConfiguratorHref({ useCase: "GAMING", budgetAmount: 3_500 })).not.toBeNull();
    expect(buildConfiguratorHref({ useCase: "GAMING", budgetAmount: 100_000 })).not.toBeNull();

    for (const budgetAmount of [3_499, 100_001, 0, -1, 12_000.5, Number.NaN]) {
      expect(buildConfiguratorHref({ useCase: "GAMING", budgetAmount })).toBeNull();
    }

    expect(buildConfiguratorHref({ useCase: "GAMING", budgetAmount: null })).toBeNull();
    expect(buildConfiguratorHref({ useCase: null, budgetAmount: 12_000 })).toBeNull();
  });

  it("round-trips through the parser the route uses", () => {
    const href = buildConfiguratorHref({ useCase: "OFFICE", budgetAmount: 8_000 });
    expect(href).not.toBeNull();

    expect(parseConfiguratorSearchParams(queryOf(href ?? ""))).toEqual({
      useCase: "OFFICE",
      budgetAmount: 8000,
      budgetText: null,
      recommendationId: null,
      fieldErrors: {},
    });
  });

  it("emits exactly two canonical parameters and never a from", () => {
    const href = buildConfiguratorHref({ useCase: "GAMING", budgetAmount: 12_000 }) ?? "";
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));

    expect([...params.keys()]).toEqual(["use_case", "budget"]);
    expect(params.has("from")).toBe(false);
    expect(href.startsWith("/configurateur?")).toBe(true);
  });
});
