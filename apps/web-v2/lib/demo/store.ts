import { create } from "zustand";

/** Budget presets from the supplied quick-start card, in dirhams. */
export const BUDGET_OPTIONS = [5000, 8000, 12000, 15000] as const;

export const DEFAULT_BUDGET = 8000;

export interface DemoStore {
  budget: number;
  setBudget: (budget: number) => void;
  reset: () => void;
}

/**
 * Step 0 preview state only: the selected budget preset. Deliberately not
 * persisted — the real configurator will own its own store, and a foundation
 * demo should not write a cookie or localStorage entry that a later sprint has
 * to migrate away from.
 */
export const useDemoStore = create<DemoStore>((set) => ({
  budget: DEFAULT_BUDGET,
  setBudget: (budget) => set({ budget }),
  reset: () => set({ budget: DEFAULT_BUDGET }),
}));
