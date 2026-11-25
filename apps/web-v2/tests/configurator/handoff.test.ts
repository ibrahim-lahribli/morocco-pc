import { describe, expect, it } from "vitest";

import { buildConfiguratorHref, parseConfiguratorSearchParams } from "@/lib/configurator/schema";

describe("buildConfiguratorHref", () => {
  it("builds the canonical step-2 href for every use case", () => {
    expect(buildConfiguratorHref({ useCase: "GAMING", budgetAmount: 8_000 })).toBe(
      "/configurateur?step=2&use_case=GAMING&budget=8000",
    );
    expect(buildConfiguratorHref({ useCase: "OFFICE", budgetAmount: 6_000 })).toBe(
      "/configurateur?step=2&use_case=OFFICE&budget=6000",
    );
    expect(buildConfiguratorHref({ useCase: "WORKSTATION", budgetAmount: 15_000 })).toBe(
      "/configurateur?step=2&use_case=WORKSTATION&budget=15000",
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
    const href = buildConfiguratorHref({ useCase: "OFFICE", budgetAmount: 6_000 });
    expect(href).not.toBeNull();

    const query = Object.fromEntries(
      new URLSearchParams((href ?? "").slice((href ?? "").indexOf("?") + 1)),
    );
    expect(parseConfiguratorSearchParams(query)).toEqual({
      step: 2,
      useCase: "OFFICE",
      budgetAmount: 6000,
    });
  });

  it("emits exactly the three canonical parameters", () => {
    const href = buildConfiguratorHref({ useCase: "GAMING", budgetAmount: 12_000 }) ?? "";
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));

    expect([...params.keys()]).toEqual(["step", "use_case", "budget"]);
    expect(href.startsWith("/configurateur?")).toBe(true);
  });
});
