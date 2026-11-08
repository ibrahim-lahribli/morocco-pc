"use client";

/**
 * The API's vocabulary read, in one place.
 *
 * Both surfaces need it and for the same reason: `meta/options` supplies the
 * currency label and (on the homepage) the advertised use cases. It was written
 * twice — once per surface, with its own copy of the stale time, the fallback
 * currency and the query function — so a change to any of them had to be made in
 * two files or the two surfaces disagreed. One module, one `["meta", "options"]`
 * identity, one dedupe.
 *
 * The vocabulary never blocks a page: a failure leaves the fixed fallbacks in
 * place and renders nothing about itself.
 *
 * Like every query in `lib/homepage/use-presets.ts`, this one does not consume
 * TanStack Query's `AbortSignal`; consuming it split one read into two under
 * StrictMode in `next dev` (measured 2026-11-08). See the Milestone 4 report.
 */
import { useQuery } from "@tanstack/react-query";

import { getBrowserApiClient } from "@/lib/api/client";
import { unwrapApiResult } from "@/lib/api/errors";
import { HOME_USE_CASES, type HomeUseCase } from "@/lib/homepage/builds";

/** Vocabulary changes with a deploy, not per request. */
export const META_STALE_TIME_MS = 5 * 60_000;

/** The market default. A label, never a claim about a price. */
export const FALLBACK_CURRENCY = "MAD";

export interface MetaOptions {
  /** The advertised subset of the three supported use cases, in fixed order. */
  useCases: readonly HomeUseCase[];
  currency: string;
}

/**
 * The finder's vocabulary. There is no loading or error state: the fixed
 * `HOME_USE_CASES` and `MAD` are the fallbacks, and an upgrade is invisible.
 */
export function useMetaOptions(): MetaOptions {
  const query = useQuery({
    queryKey: ["meta", "options"] as const,
    staleTime: META_STALE_TIME_MS,
    queryFn: async () => unwrapApiResult(await getBrowserApiClient().GET("/v1/meta/options")),
  });

  // `value` is generated as `string | number` (the API sends plain strings).
  const advertised = (query.data?.use_cases ?? []).map((option) => String(option.value));
  const advertisedUseCases = HOME_USE_CASES.filter((useCase) => advertised.includes(useCase));

  return {
    useCases:
      advertisedUseCases.length === HOME_USE_CASES.length ? advertisedUseCases : HOME_USE_CASES,
    currency: String(query.data?.currencies[0]?.value ?? FALLBACK_CURRENCY),
  };
}
