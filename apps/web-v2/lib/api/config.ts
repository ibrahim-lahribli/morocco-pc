/**
 * Where the Morocco-PC API lives.
 *
 * Two roots exist because the two runtimes need different addresses:
 *
 * - **Browser**: `NEXT_PUBLIC_API_BASE_URL` is inlined into the bundle at build
 *   time, so a deployed browser always calls the public origin. Changing it is a
 *   rebuild, which is intended — a cached client and a server must not disagree
 *   about where the public API is.
 * - **Server** (future server components / route handlers): `API_BASE_URL` is
 *   read at request time and may point at an internal address. It falls back to
 *   the public value, then to the local default.
 *
 * The default is `http://localhost:3000` (the API's `PORT` default). It makes a
 * local run work without configuration; `isApiConfigured()` is what tells a
 * caller whether an API was actually NAMED, so a build without one can render
 * fixtures rather than depend on whatever happens to be listening.
 */

export const DEFAULT_API_BASE_URL = "http://localhost:3000";

export interface ApiEnvironment {
  [name: string]: string | undefined;
  NEXT_PUBLIC_API_BASE_URL?: string;
  API_BASE_URL?: string;
}

/**
 * Trim and strip trailing slashes. An empty value stays empty so callers can
 * distinguish "not configured" from a URL.
 */
export function normalizeApiBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/** The origin a browser uses; never reads the server-only variable. */
export function resolveBrowserApiBaseUrl(env: ApiEnvironment = process.env): string {
  const configured = normalizeApiBaseUrl(env.NEXT_PUBLIC_API_BASE_URL ?? "");
  return configured === "" ? DEFAULT_API_BASE_URL : configured;
}

/** The origin a Next server uses: internal address first, then the public one. */
export function resolveServerApiBaseUrl(env: ApiEnvironment = process.env): string {
  const configured =
    normalizeApiBaseUrl(env.API_BASE_URL ?? "") ||
    normalizeApiBaseUrl(env.NEXT_PUBLIC_API_BASE_URL ?? "");
  return configured === "" ? DEFAULT_API_BASE_URL : configured;
}

/** Whether an API origin was explicitly configured (either variable). */
export function isApiConfigured(env: ApiEnvironment = process.env): boolean {
  return normalizeApiBaseUrl(env.API_BASE_URL ?? env.NEXT_PUBLIC_API_BASE_URL ?? "") !== "";
}
