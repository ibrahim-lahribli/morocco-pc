/**
 * apps/web/lib/api/client.ts — the ONE place the web app talks HTTP.
 *
 * Types come from the committed OpenAPI snapshot (`lib/api/schema.d.ts`,
 * generated from `apps/api/test/unit/openapi-v1.5.json` — the API's own gated
 * file, so the tree holds one contract rather than two). Nothing here is
 * hand-typed per field: a field that leaves the contract disappears from these
 * types at regeneration, and `npm run check:api-types` fails the build when the
 * generated file is stale.
 *
 * Deliberate limits, so S10 does not inherit surprises:
 *   - NO retries, NO caching, NO runtime validation. S10 owns retry/backoff and
 *     request validation; a silent retry here would hide the 429 countdown the
 *     UI is supposed to show.
 *   - NO default timeout: a caller that wants one passes `signal`.
 *   - The error envelope is parsed into `ApiError` with the fields a UI needs
 *     (`code`, `details[]`, `requestId`, `retryAfterSeconds`) and nothing else.
 *
 * The artifact note: `Type.Union([Type.Literal(...), Type.Null()])` renders in
 * the snapshot as `{type: "object", nullable: true, enum: [null]}`, so
 * openapi-typescript emits `(never | null)` for the null branch. That collapses
 * to `null`, which is the intended type — it reads oddly, it is not wrong, and
 * it is pinned by the API's own snapshot test.
 */

import type { paths } from "./schema";

/** The JSON body of a response object, or `never` for a response with no body. */
type JsonOf<T> = T extends { content: { "application/json": infer S } } ? S : never;

export type HealthResponse = JsonOf<paths["/v1/health"]["get"]["responses"][200]>;
export type MetaOptionsResponse = JsonOf<paths["/v1/meta/options"]["get"]["responses"][200]>;

export type RecommendationInput =
  paths["/v1/recommendations"]["post"]["requestBody"]["content"]["application/json"];
export type RecommendationResponse =
  JsonOf<paths["/v1/recommendations"]["post"]["responses"][201]>;
export type PresetsResponse = JsonOf<paths["/v1/presets"]["get"]["responses"][200]>;
export type PresetsQuery = paths["/v1/presets"]["get"]["parameters"]["query"];
export type CatalogListResponse = JsonOf<paths["/v1/catalog/products"]["get"]["responses"][200]>;
export type CatalogListQuery = paths["/v1/catalog/products"]["get"]["parameters"]["query"];
export type CatalogProductResponse =
  JsonOf<paths["/v1/catalog/products/{slug}"]["get"]["responses"][200]>;
export type ErrorEnvelope = JsonOf<paths["/v1/health"]["get"]["responses"][429]>;

/** The kinds of failure the wizard has to distinguish (S10's error map). */
export type ApiErrorCode =
  | "NETWORK_ERROR"
  | "VALIDATION_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "SCORING_MODEL_UNAVAILABLE"
  | "CATALOG_VERSION_UNAVAILABLE"
  | "NOT_FOUND"
  | "UNKNOWN";

export interface ApiValidationDetail {
  field: string;
  message: string;
}

export interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  details?: readonly ApiValidationDetail[];
  requestId?: string;
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never reached a server. */
  readonly status: number;
  /** The envelope's `error` code, or a transport-level code for status 0. */
  readonly code: string;
  readonly details: readonly ApiValidationDetail[];
  readonly requestId: string | null;
  /** Seconds from `Retry-After`, for the 429 countdown. */
  readonly retryAfterSeconds: number | null;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? [];
    this.requestId = init.requestId ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    if (init.cause !== undefined) {
      this.cause = init.cause;
    }
    // ES2017 target: without this, `instanceof ApiError` fails after transpiling
    // a class that extends Error.
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

const DEFAULT_API_BASE_URL = "http://localhost:3000";

/** Trailing slashes are stripped so callers may pass either form. */
function normalizeBase(raw: string): string {
  return raw.replace(/\/+$/, "");
}

/**
 * The API root a BROWSER uses: the public one, inlined at build time.
 *
 * `NEXT_PUBLIC_*` is compiled into the bundle, so changing it is a rebuild —
 * which is the point: a client cache and a server may not disagree about where
 * the public API lives.
 */
export function apiBaseUrl(): string {
  return normalizeBase(process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL);
}

/**
 * The API root a Next SERVER uses (S11's SSR fetch).
 *
 * `API_BASE_URL` is deliberately NOT `NEXT_PUBLIC_`: it is read at request time
 * and never inlined into a browser bundle, so a deployment can point the server
 * at an internal address (a service name on a private network) while the browser
 * keeps the public origin. When it is unset — every local run, and the tests —
 * the server falls back to the public URL, so there is one place to look when
 * both halves are the same host.
 */
export function serverApiBaseUrl(): string {
  return normalizeBase(
    process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
  );
}

function parseRetryAfter(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (header === null) {
    return undefined;
  }
  const seconds = Number(header);
  // `Retry-After` may also be an HTTP date; the API serves seconds, and an
  // unparseable value is left undefined rather than guessed.
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function detailsOf(value: unknown): ApiValidationDetail[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    if (record === null || typeof record.field !== "string" || typeof record.message !== "string") {
      return [];
    }
    return [{ field: record.field, message: record.message }];
  });
}

function errorFrom(response: Response, body: unknown): ApiError {
  const envelope = asRecord(body);
  const code = envelope !== null && typeof envelope.error === "string"
    ? envelope.error
    : `HTTP_${response.status}`;
  const message = envelope !== null && typeof envelope.message === "string"
    ? envelope.message
    : `Request failed with status ${response.status}`;
  const requestId = envelope !== null && typeof envelope.request_id === "string"
    ? envelope.request_id
    : response.headers.get("x-request-id") ?? undefined;

  return new ApiError({
    status: response.status,
    code,
    message,
    details: envelope !== null ? detailsOf(envelope.details) : [],
    requestId,
    retryAfterSeconds: parseRetryAfter(response),
  });
}

/** A body that is not JSON; distinct from JSON `null`, which is a valid body. */
const NOT_JSON = Symbol("not-json");

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return NOT_JSON;
  }
}

interface ApiResult<T> {
  status: number;
  body: T;
}

/**
 * One request. Throws `ApiError` for a non-2xx, a network failure, or a body
 * that is not JSON; a caller never sees a raw `Response`.
 */
async function request<T>(
  path: string,
  init: RequestInit = {},
  base: string = apiBaseUrl(),
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(base + path, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "The recommendation service could not be reached.",
      cause: error,
    });
  }

  const body = await readJson(response);
  if (!response.ok) {
    throw errorFrom(response, body === NOT_JSON ? null : body);
  }
  if (body === NOT_JSON) {
    // A 2xx with a non-JSON body is a proxy error page or a captive portal, not
    // a result. Returning `null as T` would type-check and then crash the first
    // caller that reads a field, so it fails here instead.
    throw new ApiError({
      status: response.status,
      code: "UNKNOWN",
      message: `Expected JSON from ${path}, got ${response.headers.get("content-type") ?? "no content type"}`,
    });
  }
  return { status: response.status, body: body as T };
}

export async function getHealth(init?: RequestInit): Promise<HealthResponse> {
  return (await request<HealthResponse>("/v1/health", init)).body;
}

export async function getMetaOptions(init?: RequestInit): Promise<MetaOptionsResponse> {
  return (await request<MetaOptionsResponse>("/v1/meta/options", init)).body;
}

/**
 * POST /v1/recommendations. Status 200 means the API answered from an
 * equivalent committed pass (`reused: true`, contract v1.3); 201 means this
 * call ran the engine. Both bodies are the same shape, so the status is
 * returned beside it rather than merged into it.
 */
export async function createRecommendation(
  input: RecommendationInput,
  init?: RequestInit
): Promise<{ status: 200 | 201; body: RecommendationResponse }> {
  const result = await request<RecommendationResponse>("/v1/recommendations", {
    ...init,
    method: "POST",
    body: JSON.stringify(input),
  });
  if (result.status !== 201 && result.status !== 200) {
    throw new ApiError({
      status: result.status,
      code: "UNKNOWN",
      message: `Unexpected status ${result.status} from POST /v1/recommendations`,
    });
  }
  return { status: result.status, body: result.body };
}

export async function getRecommendation(
  id: string,
  init?: RequestInit
): Promise<RecommendationResponse> {
  return (await request<RecommendationResponse>(
    `/v1/recommendations/${encodeURIComponent(id)}`,
    init
  )).body;
}

/**
 * GET /v1/recommendations/:id, on the SERVER (S11's results page).
 *
 * Two differences from `getRecommendation`, both deliberate:
 *
 *   - it targets `serverApiBaseUrl()`, so a deployment can keep the engine on an
 *     internal address while the browser keeps the public origin;
 *   - it is `cache: "no-store"`. A result id is a durable reference to one
 *     committed pass, and a cached copy would keep serving a body after the data
 *     behind it changed. There is nothing to revalidate: the page is dynamic by
 *     construction (its id is data), so every visit is one read.
 */
export async function getRecommendationForServer(
  id: string,
  init?: RequestInit
): Promise<RecommendationResponse> {
  return (
    await request<RecommendationResponse>(
      `/v1/recommendations/${encodeURIComponent(id)}`,
      { cache: "no-store", ...init },
      serverApiBaseUrl()
    )
  ).body;
}

export async function getPresets(
  query: PresetsQuery,
  init?: RequestInit
): Promise<PresetsResponse> {
  const search = new URLSearchParams({
    use_case: query.use_case,
    currency: query.currency,
  });
  return (await request<PresetsResponse>(`/v1/presets?${search.toString()}`, init)).body;
}

/**
 * GET /v1/presets, on the SERVER, for the preset pages (S16).
 *
 * Two differences from `getPresets`, both deliberate:
 *
 *   - it targets `serverApiBaseUrl()`, so a deployment can keep the engine on an
 *     internal address while the browser keeps the public origin;
 *   - it caches for `revalidate` seconds instead of being `no-store`. That is the
 *     whole of ISR here: a preset page is a function of the ribbon, and the ribbon
 *     changes when it is regenerated (Decision 48), not per visitor. The option is
 *     `next: { revalidate }`, NOT `cache` — a `cache: "no-store"` fetch would opt
 *     the route out of revalidation and turn every preset visit into an API call.
 *
 * `signal` is the caller's timeout: a build must not hang on a black-holed host.
 */
export async function getPresetsForServer(
  query: PresetsQuery,
  init: { revalidate: number; signal?: AbortSignal },
): Promise<PresetsResponse> {
  const search = new URLSearchParams({
    use_case: query.use_case,
    currency: query.currency,
  });
  return (
    await request<PresetsResponse>(
      `/v1/presets?${search.toString()}`,
      { next: { revalidate: init.revalidate }, signal: init.signal },
      serverApiBaseUrl(),
    )
  ).body;
}

/**
 * GET /v1/recommendations/:id, cached for `revalidate` seconds (S16).
 *
 * The results page reads a pass with `no-store` because its id names one
 * person's query and a stale copy would be worse than a slow page. A preset is
 * the opposite case: it is a PUBLIC landing page whose pass is a shared fixture of
 * the ribbon, so it is cached — and revalidated — as data, not read per visitor.
 * `getRecommendationForServer` stays the no-store read for `/config/[id]`; sharing
 * one function between the two would silently pick one of those policies.
 */
export async function getRecommendationForStatic(
  id: string,
  init: { revalidate: number; signal?: AbortSignal },
): Promise<RecommendationResponse> {
  return (
    await request<RecommendationResponse>(
      `/v1/recommendations/${encodeURIComponent(id)}`,
      { next: { revalidate: init.revalidate }, signal: init.signal },
      serverApiBaseUrl(),
    )
  ).body;
}

export async function listCatalogProducts(
  query: CatalogListQuery = {},
  init?: RequestInit
): Promise<CatalogListResponse> {
  const search = new URLSearchParams();
  if (query.role !== undefined) search.set("role", query.role);
  if (query.limit !== undefined) search.set("limit", query.limit);
  if (query.cursor !== undefined) search.set("cursor", query.cursor);
  const suffix = search.size === 0 ? "" : `?${search.toString()}`;
  return (await request<CatalogListResponse>(`/v1/catalog/products${suffix}`, init)).body;
}

export async function getCatalogProduct(
  slug: string,
  init?: RequestInit
): Promise<CatalogProductResponse> {
  return (await request<CatalogProductResponse>(
    `/v1/catalog/products/${encodeURIComponent(slug)}`,
    init
  )).body;
}
