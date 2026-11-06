import { beforeEach, describe, expect, it } from "vitest";

import { BUDGET_OPTIONS, DEFAULT_BUDGET, useDemoStore } from "@/lib/demo/store";

describe("demo budget store", () => {
  beforeEach(() => {
    useDemoStore.setState({ budget: DEFAULT_BUDGET });
  });

  it("starts on the designed default preset", () => {
    expect(useDemoStore.getState().budget).toBe(8000);
    expect(DEFAULT_BUDGET).toBe(8000);
  });

  it("offers the four supplied presets", () => {
    expect(BUDGET_OPTIONS).toEqual([5000, 8000, 12000, 15000]);
  });

  it("selects a budget", () => {
    useDemoStore.getState().setBudget(12000);
    expect(useDemoStore.getState().budget).toBe(12000);
  });

  it("resets to the default", () => {
    useDemoStore.getState().setBudget(15000);
    useDemoStore.getState().reset();
    expect(useDemoStore.getState().budget).toBe(DEFAULT_BUDGET);
  });
});
