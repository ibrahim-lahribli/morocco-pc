"use client";

/**
 * TanStack Query hooks for the configurator.
 *
 * The meta read shares the homepage's `["meta", "options"]` identity, so
 * entering the configurator after the homepage does not buy the same vocabulary
 * twice. The detail read is keyed by the recommendation id alone: the pass is
 * immutable, and the id is the only thing the URL can change.
 *
 * No `placeholderData`: when the id changes, the previous build must disappear
 * while the next detail is pending, not linger as a stale answer.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { getBrowserApiClient } from "@/lib/api/client";
import { unwrapApiResult } from "@/lib/api/errors";
import type { PresetDetail } from "@/lib/api/types";

const FALLBACK_CURRENCY = "MAD";
const META_STALE_TIME_MS = 5 * 60_000;
const RECOMMENDATION_STALE_TIME_MS = 60_000;

export function configuratorRecommendationKey(
  id: string | null,
): readonly ["configurator", "recommendation", string | null] {
  return ["configurator", "recommendation", id] as const;
}

/**
 * The currency the configurator pages should display. A failed or empty meta
 * read is not an error state: `MAD` is the market default and the label still
 * comes from `Price.currency`.
 */
export function useConfiguratorCurrency(): { currency: string } {
  const query = useQuery({
    queryKey: ["meta", "options"] as const,
    staleTime: META_STALE_TIME_MS,
    queryFn: async () => unwrapApiResult(await getBrowserApiClient().GET("/v1/meta/options")),
  });

  return { currency: String(query.data?.currencies[0]?.value ?? FALLBACK_CURRENCY) };
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
