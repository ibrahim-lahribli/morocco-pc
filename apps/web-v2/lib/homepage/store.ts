import { create } from "zustand";

import type { HomeUseCase } from "./builds";

/**
 * The homepage's own state: the two answers the finder collects.
 *
 * Memory only, like the Step 0 demo store — no cookie and no localStorage, so a
 * later sprint never has to migrate a stale key. The store deliberately carries
 * NO resolution field: the resolution shortcuts are deferred, nothing reads a
 * resolution, and a field nothing can set is a trap for the next reader.
 */
export interface HomepageStore {
  /** The visitor's budget in dirhams, or null before they answer. */
  budgetAmount: number | null;
  /** The visitor's use case, or null before they answer. */
  useCase: HomeUseCase | null;
  setBudgetAmount: (budgetAmount: number | null) => void;
  setUseCase: (useCase: HomeUseCase | null) => void;
  reset: () => void;
}

const INITIAL = { budgetAmount: null, useCase: null } as const;

export const useHomepageStore = create<HomepageStore>((set) => ({
  ...INITIAL,
  setBudgetAmount: (budgetAmount) => set({ budgetAmount }),
  setUseCase: (useCase) => set({ useCase }),
  reset: () => set({ ...INITIAL }),
}));
