/**
 * TanStack Query defaults for Morocco-PC.
 *
 * These are the foundation's decisions, not a page's:
 *
 * - **30 s stale time** — catalogue and preset reads are cheap but not free, and
 *   a shopper clicking between two views should not refetch the same page twice.
 * - **5 min gc time** — a back navigation re-renders from cache.
 * - **Retry only transport-shaped failures** — 5xx, 408 and network errors get a
 *   second chance; 4xx (validation, not found, rate limit) does not. A 429's
 *   `Retry-After` belongs to the UI countdown, so it is never retried silently.
 * - **Mutations never retry** — a `POST /v1/recommendations` runs and persists an
 *   engine pass. The API dedupes an identical committed pass, but an automatic
 *   retry can still pay for work the user did not ask for; the screen owns the
 *   decision.
 */
import { QueryClient } from "@tanstack/react-query";

import { ApiError, isApiError, isRetryableStatus } from "./errors";

export const QUERY_STALE_TIME_MS = 30_000;
export const QUERY_GC_TIME_MS = 5 * 60_000;
export const MAX_QUERY_RETRIES = 2;

/**
 * `failureCount` is zero-based in TanStack Query: 0 is the first failure.
 * A non-`ApiError` is usually a fetch `TypeError` (offline, DNS, CORS), which
 * deserves one retry; an unexpected programming error does not.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) {
    return false;
  }

  if (isApiError(error)) {
    return isRetryableStatus((error as ApiError).status);
  }

  return error instanceof TypeError && failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        gcTime: QUERY_GC_TIME_MS,
        retry: shouldRetryQuery,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
