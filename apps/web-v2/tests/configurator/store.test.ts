import { describe, expect, it } from "vitest";

import { createConfiguratorStore } from "@/lib/configurator/store";

const seed = {
  useCase: "GAMING" as const,
  budgetAmount: 12000,
  budgetText: null,
  recommendationId: "3b157941-b4df-4945-a6ae-e6e079644e4c",
  fieldErrors: {},
};

describe("configurator store", () => {
  it("seeds requirements, recommendation and rank 1", () => {
    const store = createConfiguratorStore(seed);

    expect(store.getState().phase).toBe("requirements");
    expect(store.getState().requirements).toEqual({ useCase: "GAMING", budgetAmount: 12000 });
    expect(store.getState().recommendationId).toBe(seed.recommendationId);
    expect(store.getState().activeBuildRank).toBe(1);
  });

  it("keeps two mounts independent", () => {
    const a = createConfiguratorStore(seed);
    const b = createConfiguratorStore({ ...seed, useCase: "OFFICE" });

    a.getState().submitRequirements({ useCase: "WORKSTATION", budgetAmount: 15000 });

    expect(a.getState().requirements.useCase).toBe("WORKSTATION");
    expect(b.getState().requirements.useCase).toBe("OFFICE");
  });

  it("submits requirements and advances to review", () => {
    const store = createConfiguratorStore(seed);

    store.getState().submitRequirements({ useCase: "OFFICE", budgetAmount: 8000 });

    expect(store.getState().requirements).toEqual({ useCase: "OFFICE", budgetAmount: 8000 });
    expect(store.getState().phase).toBe("review");
  });

  it("selects a build rank without touching the answers", () => {
    const store = createConfiguratorStore(seed);

    store.getState().setActiveBuildRank(2);

    expect(store.getState().activeBuildRank).toBe(2);
    expect(store.getState().requirements).toEqual({ useCase: "GAMING", budgetAmount: 12000 });
  });
});
