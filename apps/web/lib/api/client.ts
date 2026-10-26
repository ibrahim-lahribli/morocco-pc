/**
 * apps/web/lib/api/client.ts — the ONE place the web app talks HTTP.
 *
 * Types come from the committed OpenAPI snapshot (`lib/api/schema.d.ts`,
 * generated from `apps/api/test/unit/openapi-v1.6.json` — the API's own gated
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
export type SwapPreviewResponse =
  JsonOf<paths["/v1/recommendations/{id}/builds/{rank}/swap-preview"]["get"]["responses"][200]>;
export type SwapCommitResponse =
  JsonOf<paths["/v1/recommendations/{id}/builds/{rank}/swap"]["post"]["responses"][201]>;
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

/**
 * Whether an API base was NAMED in the environment.
 *
 * Three callers depend on this distinction (S16, S17, S18): a build with no API
 * configured must render the committed fixtures deterministically and offline,
 * while a deployment that named an API gets real data. Falling back to
 * `localhost:3000` is a request-time convenience; treating it as "configured"
 * would make every build depend on whatever happened to be listening.
 */
export function isApiConfigured(): boolean {
  const raw = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  return typeof raw === "string" && raw.trim() !== "";
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

/** `/v1/recommendations/:id`. The id is DATA, so it is encoded here, once. */
function recommendationPath(id: string): string {
  return `/v1/recommendations/${encodeURIComponent(id)}`;
}

/** `/v1/presets?…` — one ribbon query, built in one place. */
function presetsPath(query: PresetsQuery): string {
  const search = new URLSearchParams({
    use_case: query.use_case,
    currency: query.currency,
  });
  return `/v1/presets?${search.toString()}`;
}

/**
 * One GET whose BODY is the answer, so no getter repeats `.body` or the path
 * maths. `base` is the caller's decision (browser vs server) — never a default
 * that happens to be right for one of them.
 */
async function getJson<T>(
  path: string,
  init: RequestInit = {},
  base: string = apiBaseUrl(),
): Promise<T> {
  return (await request<T>(path, init, base)).body;
}

export async function getRecommendation(
  id: string,
  init?: RequestInit
): Promise<RecommendationResponse> {
  return getJson<RecommendationResponse>(recommendationPath(id), init);
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
  return getJson<RecommendationResponse>(
    recommendationPath(id),
    { cache: "no-store", ...init },
    serverApiBaseUrl()
  );
}

export async function getPresets(
  query: PresetsQuery,
  init?: RequestInit
): Promise<PresetsResponse> {
  return getJson<PresetsResponse>(presetsPath(query), init);
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
  return getJson<PresetsResponse>(
    presetsPath(query),
    { next: { revalidate: init.revalidate }, signal: init.signal },
    serverApiBaseUrl(),
  );
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
  return getJson<RecommendationResponse>(
    recommendationPath(id),
    { next: { revalidate: init.revalidate }, signal: init.signal },
    serverApiBaseUrl(),
  );
}

/** `/v1/catalog/products` + its query string, built once for both callers. */
function catalogListPath(query: CatalogListQuery = {}): string {
  const search = new URLSearchParams();
  if (query.role !== undefined) search.set("role", query.role);
  if (query.limit !== undefined) search.set("limit", query.limit);
  if (query.cursor !== undefined) search.set("cursor", query.cursor);
  return search.size === 0
    ? "/v1/catalog/products"
    : `/v1/catalog/products?${search.toString()}`;
}

export async function listCatalogProducts(
  query: CatalogListQuery = {},
  init?: RequestInit
): Promise<CatalogListResponse> {
  return (await request<CatalogListResponse>(catalogListPath(query), init)).body;
}

/**
 * GET /v1/catalog/products, on the SERVER (S18's sitemap).
 *
 * Same two differences as the other `…ForServer` reads, and one more that is
 * specific to this route: the sitemap needs the WHOLE catalogue, one keyset page
 * at a time, so `cursor` is part of the query it passes through. Cached for the
 * revalidation window because a catalogue listing changes when the catalogue
 * does, not per crawler.
 */
export async function listCatalogProductsForServer(
  query: CatalogListQuery,
  init: { revalidate: number; signal?: AbortSignal },
): Promise<CatalogListResponse> {
  return getJson<CatalogListResponse>(
    catalogListPath(query),
    { next: { revalidate: init.revalidate }, signal: init.signal },
    serverApiBaseUrl(),
  );
}

/** `/v1/catalog/products/:slug`. The slug is DATA, so it is encoded here. */
function catalogProductPath(slug: string): string {
  return `/v1/catalog/products/${encodeURIComponent(slug)}`;
}

export async function getCatalogProduct(
  slug: string,
  init?: RequestInit
): Promise<CatalogProductResponse> {
  return getJson<CatalogProductResponse>(catalogProductPath(slug), init);
}

/**
 * The swap preview's query, as the control builds it (S24).
 *
 * `productVariantId` is REQUIRED for role `GPU` and refused for every other
 * role by the API: a GPU candidate is variant-keyed, and a variant on a
 * product-keyed role would name a row that has no candidate. The control
 * therefore never sends it speculatively - it sends what the catalogue's own
 * `variants` array gave it.
 */
export interface SwapPreviewRequest {
  id: string;
  rank: number;
  role: string;
  productId: string;
  productVariantId?: string | undefined;
}

/** `/v1/recommendations/:id/builds/:rank/swap-preview?…` - built in one place. */
function swapPreviewPath(request: SwapPreviewRequest): string {
  const search = new URLSearchParams({ role: request.role, product_id: request.productId });
  if (request.productVariantId !== undefined) {
    search.set("product_variant_id", request.productVariantId);
  }
  return (
    recommendationPath(request.id)
    + `/builds/${request.rank}/swap-preview?${search.toString()}`
  );
}

/**
 * GET /v1/recommendations/:id/builds/:rank/swap-preview (S24, contract v1.8).
 *
 * A BROWSER read: the control is a client island and the answer depends on a
 * choice made after the page rendered, so there is nothing for the server to
 * pre-fetch. `cache: "no-store"` is the API's own policy for this route (the
 * verdict is a function of the LIVE catalogue), and honouring it here keeps a
 * preview from being answered out of the HTTP cache after the catalogue moved.
 *
 * A `FAIL` verdict is a 200 RESULT, not a rejection: only a non-2xx throws, so a
 * caller cannot mistake "it does not fit" for "the request failed".
 */
export async function getSwapPreview(
  request: SwapPreviewRequest,
  init?: RequestInit
): Promise<SwapPreviewResponse> {
  return getJson<SwapPreviewResponse>(
    swapPreviewPath(request),
    { cache: "no-store", ...init },
    apiBaseUrl()
  );
}

/** `/v1/recommendations/:id/builds/:rank/swap` - the same address, one verb on. */
function swapCommitPath(request: SwapPreviewRequest): string {
  return recommendationPath(request.id) + `/builds/${request.rank}/swap`;
}

/**
 * POST /v1/recommendations/:id/builds/:rank/swap (S24, contract v1.10).
 *
 * The MUTATING half of CD-8 (Decision 56): it appends ONE derived build and
 * returns the same three facts the preview answered with plus `swapped`. The
 * body is the same triple the preview takes, because a commit is "the preview,
 * but keep it" - a different payload would let the two ask different questions.
 *
 * `cache: "no-store"` because a commit's answer is never reusable, and the
 * request carries no `next.revalidate`: unlike the preview this is not merely a
 * read that depends on live data, it writes.
 *
 * Every refusal (409 `SWAP_ALREADY_COMMITTED` / `SWAP_NOT_COMMITTABLE` /
 * `SWAP_ROLE_ABSENT`, 404 `BUILD_NOT_EVALUABLE`) arrives as an `ApiError`, so a
 * caller can tell "this build already carries a swap" from "the catalogue
 * moved" by `code` and `status`.
 */
export async function commitSwap(
  swap: SwapPreviewRequest,
  init?: RequestInit
): Promise<SwapCommitResponse> {
  const body: Record<string, string> = {
    role: swap.role,
    product_id: swap.productId,
  };
  if (swap.productVariantId !== undefined) {
    body.product_variant_id = swap.productVariantId;
  }
  return (
    await request<SwapCommitResponse>(
      swapCommitPath(swap),
      {
        ...init,
        method: "POST",
        cache: "no-store",
        body: JSON.stringify(body),
      },
      apiBaseUrl(),
    )
  ).body;
}

/**
 * GET /v1/catalog/products/:slug, on the SERVER (S17 component pages).
 *
 * Same two differences as `getPresetsForServer`, and for the same reasons: the
 * server base (a deployment may keep the API internal) and `next.revalidate`
 * instead of `no-store` — a component page is public, cached catalogue data, not
 * one person's pass. `signal` is the caller's timeout, so a request never hangs
 * on a black-holed host.
 */
export async function getCatalogProductForServer(
  slug: string,
  init: { revalidate: number; signal?: AbortSignal },
): Promise<CatalogProductResponse> {
  return getJson<CatalogProductResponse>(
    catalogProductPath(slug),
    { next: { revalidate: init.revalidate }, signal: init.signal },
    serverApiBaseUrl(),
  );
}
