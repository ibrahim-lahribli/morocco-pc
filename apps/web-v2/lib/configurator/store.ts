/**
 * The configurator's own memory, created once per mount.
 *
 * This is deliberately not a module singleton: two deep links must not share
 * answers, and `useState` in the shell can invoke its initializer twice under
 * Strict Mode without seeding anything twice. Server data (the recommendation
 * detail) stays in TanStack Query; copying it here would create a stale second
 * source of truth on every refetch.
 */
import { createStore, type StoreApi } from "zustand/vanilla";

import type { ConfiguratorSeed, ConfiguratorUseCase } from "./schema";

export type ConfiguratorPhase = "requirements" | "review";

export interface ConfiguratorRequirements {
  useCase: ConfiguratorUseCase | null;
  budgetAmount: number | null;
}

export interface ConfiguratorState {
  phase: ConfiguratorPhase;
  requirements: ConfiguratorRequirements;
  recommendationId: string | null;
  activeBuildRank: number;
  submitRequirements: (requirements: ConfiguratorRequirements) => void;
  setActiveBuildRank: (rank: number) => void;
}

export type ConfiguratorStoreApi = StoreApi<ConfiguratorState>;

export function createConfiguratorStore(seed: ConfiguratorSeed): ConfiguratorStoreApi {
  const seededRequirements: ConfiguratorRequirements = {
    useCase: seed.useCase,
    budgetAmount: seed.budgetAmount,
  };

  return createStore<ConfiguratorState>()((set) => ({
    phase: "requirements",
    requirements: seededRequirements,
    recommendationId: seed.recommendationId,
    activeBuildRank: 1,
    submitRequirements: (requirements) => set({ requirements, phase: "review" }),
    setActiveBuildRank: (activeBuildRank) => set({ activeBuildRank }),
  }));
}
