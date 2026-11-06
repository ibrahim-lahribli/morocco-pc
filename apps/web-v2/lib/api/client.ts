/**
 * The typed HTTP client. Types come from `./schema`, which is generated from the
 * API's committed OpenAPI document — no path, request body or response field is
 * hand-typed here.
 *
 * Deliberate limits for the foundation:
 *   - no retries, caching or runtime validation in the client (TanStack Query
 *     owns retry/cache policy; a silent retry here would hide a 429 countdown);
 *   - no default timeout (callers pass `signal`);
 *   - no auth headers — the API has no authentication.
 *
 * Server components should create a client with the server origin:
 *
 *   createApiClient({ baseUrl: resolveServerApiBaseUrl() })
 */
import createClient from "openapi-fetch";

import { normalizeApiBaseUrl, resolveBrowserApiBaseUrl } from "./config";
import type { paths } from "./schema";

export type ApiClient = ReturnType<typeof createClient<paths>>;

export interface ApiClientOptions {
  /** Defaults to the browser-facing `NEXT_PUBLIC_API_BASE_URL`. */
  baseUrl?: string;
  /** Injected for tests; defaults to `globalThis.fetch`. */
  fetch?: (input: Request) => Promise<Response>;
}

/** Build a client for one origin. Cheap: no connection is opened here. */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = normalizeApiBaseUrl(options.baseUrl ?? resolveBrowserApiBaseUrl());

  return createClient<paths>({
    ...(baseUrl === "" ? {} : { baseUrl }),
    headers: { accept: "application/json" },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}

let sharedBrowserClient: ApiClient | null = null;

/**
 * The browser's shared client. A module-level singleton keeps the client (and
 * its immutable config) in one place; TanStack Query, not this module, owns the
 * cache.
 */
export function getBrowserApiClient(): ApiClient {
  sharedBrowserClient ??= createApiClient();
  return sharedBrowserClient;
}
