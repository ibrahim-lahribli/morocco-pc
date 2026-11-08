"use client";

/**
 * TanStack Query hooks for the configurator.
 *
 * The meta read is the same `["meta", "options"]` query the homepage uses, so
 * entering the configurator after the homepage does not buy the same vocabulary
 * twice — and it is the same module, so the two surfaces cannot drift. The detail
 * read is keyed by the recommendation id alone: the pass is immutable, and the id
 * is the only thing the URL can change.
 *
 * No `placeholderData`: when the id changes, the previous build must disappear
 * while the next detail is pending, not linger as a stale answer.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { getBrowserApiClient } from "@/lib/api/client";
import { unwrapApiResult } from "@/lib/api/errors";
import { useMetaOptions } from "@/lib/api/meta";
import type { PresetDetail } from "@/lib/api/types";

const RECOMMENDATION_STALE_TIME_MS = 60_000;

export function configuratorRecommendationKey(
  id: string | null,
): readonly ["configurator", "recommendation", string | null] {
  return ["configurator", "recommendation", id] as const;
}

/**
 * The currency the configurator pages should display. A failed or empty meta
 * read is not an error state: the shared hook falls back to `MAD`, the market
 * default, and the label still comes from `Price.currency`.
 */
export function useConfiguratorCurrency(): { currency: string } {
  return { currency: useMetaOptions().currency };
}

/**
 * The detail behind a `?from=` link. Disabled for `null`, so the empty route
 * never asks the API for the string "null".
 */
export function useConfiguratorRecommendation(
  id: string | null,
): UseQueryResult<PresetDetail, Error> {
  return useQuery({
    queryKey: configuratorRecommendationKey(id),
    staleTime: RECOMMENDATION_STALE_TIME_MS,
    enabled: id !== null,
    queryFn: async () => {
      if (id === null) {
        throw new Error("configurator recommendation requested without an id");
      }

      return unwrapApiResult(
        await getBrowserApiClient().GET("/v1/recommendations/{id}", {
          params: { path: { id } },
        }),
      );
    },
  });
}
