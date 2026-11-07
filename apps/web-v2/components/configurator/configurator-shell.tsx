"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useStore } from "zustand";

import { BuildSummaryPanel } from "@/components/configurator/build-summary-panel";
import { RequirementsForm } from "@/components/configurator/requirements-form";
import { isApiError } from "@/lib/api/errors";
import type { ConfiguratorSeed } from "@/lib/configurator/schema";
import { useConfiguratorCurrency, useConfiguratorRecommendation } from "@/lib/configurator/queries";
import { createConfiguratorStore, type ConfiguratorRequirements } from "@/lib/configurator/store";

export interface ConfiguratorShellProps {
  seed: ConfiguratorSeed;
}

/**
 * The configurator's client boundary.
 *
 * The store is created once per retained mount with `useState`, never as a
 * module singleton: two deep links must not share answers. Strict Mode calls
 * the initializer twice and discards one store, so nothing is seeded twice.
 *
 * Server state stays in TanStack Query and is never copied into the store: a
 * refetch must not leave a second, staler copy of the build behind.
 */
export function ConfiguratorShell({ seed }: ConfiguratorShellProps) {
  const tErrors = useTranslations("Configurator.errors");
  const [store] = useState(() => createConfiguratorStore(seed));

  const phase = useStore(store, (state) => state.phase);
  const recommendationId = useStore(store, (state) => state.recommendationId);
  const activeBuildRank = useStore(store, (state) => state.activeBuildRank);
  const detailQuery = useConfiguratorRecommendation(recommendationId);
  const { currency } = useConfiguratorCurrency();

  const errorStatus = isApiError(detailQuery.error)
    ? detailQuery.error.status
    : detailQuery.error !== null
      ? 0
      : null;

  const onSubmit = (requirements: ConfiguratorRequirements) => {
    store.getState().submitRequirements(requirements);
    requestAnimationFrame(() => document.getElementById("build-summary-title")?.focus());
  };

  return (
    <div className="flex flex-col gap-6 pb-44 lg:pb-0">
      {seed.fieldErrors.from !== undefined ? (
        <p
          role="alert"
          className="rounded-control border border-danger bg-surface px-3 py-2 text-label-md font-medium text-danger"
        >
          {tErrors("fromInvalid")}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8">
        <RequirementsForm
          defaultValues={{
            useCase: seed.useCase,
            // The raw text keeps an invalid URL amount such as `12` visible
            // instead of erasing the answer the visitor arrived with.
            budget: seed.budgetText ?? seed.budgetAmount?.toString() ?? "",
          }}
          initialErrors={{ useCase: seed.fieldErrors.useCase, budget: seed.fieldErrors.budget }}
          submitted={phase === "review"}
          onSubmit={onSubmit}
        />

        <BuildSummaryPanel
          detail={detailQuery.data}
          currency={currency}
          // A disabled query is pending but not loading: passing that through
          // would keep the empty route's summary in the loading state forever.
          isPending={seed.recommendationId !== null && detailQuery.isPending}
          errorStatus={errorStatus}
          activeBuildRank={activeBuildRank}
          onSelectRank={(rank) => store.getState().setActiveBuildRank(rank)}
          onRetry={() => {
            void detailQuery.refetch();
          }}
        />
      </div>
    </div>
  );
}
