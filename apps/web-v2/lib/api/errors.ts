/**
 * One error shape for the whole client.
 *
 * `openapi-fetch` returns `{ data, error, response }` for HTTP failures and
 * throws only on transport failures. A UI should not have to inspect three
 * shapes, so this module normalizes a non-2xx response into `ApiError` and
 * leaves transport errors to the caller (or to TanStack Query's retry policy).
 *
 * The API's error envelope is `{ error, message, request_id }`; `details` is
 * kept raw because validation-detail rendering is a feature concern, not a
 * transport concern.
 */

export interface ApiErrorInit {
  /** HTTP status, or 0 when the response never reached a server. */
  status: number;
  /** The envelope's `error` code, or `HTTP_<status>` when the body has none. */
  code: string;
  message: string;
  requestId?: string | null;
  /** Seconds from `Retry-After`, for a rate-limit countdown. */
  retryAfterSeconds?: number | null;
  /** The parsed error body, untouched. */
  body?: unknown;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;
  readonly body: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.body = init.body;
    if (init.cause !== undefined) {
      this.cause = init.cause;
    }
    // ES2022 target keeps this, but the explicit prototype keeps
    // `instanceof ApiError` true across transpilation boundaries.
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Parse `Retry-After` seconds. An HTTP-date value is left null rather than
 * guessed; the API serves seconds.
 */
export function parseRetryAfter(header: string | null): number | null {
  if (header === null) {
    return null;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** Normalize a failed response and its parsed body into `ApiError`. */
export function apiErrorFromResponse(response: Response, body: unknown): ApiError {
  const envelope = asRecord(body);
  const code =
    envelope !== null && typeof envelope.error === "string"
      ? envelope.error
      : `HTTP_${response.status}`;
  const message =
    envelope !== null && typeof envelope.message === "string"
      ? envelope.message
      : response.statusText || `Request failed with status ${response.status}`;
  const requestId =
    envelope !== null && typeof envelope.request_id === "string"
      ? envelope.request_id
      : response.headers.get("x-request-id");

  return new ApiError({
    status: response.status,
    code,
    message,
    requestId,
    retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
    body,
  });
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * Retryability is a transport property, not a feature decision: 5xx and 408
 * may succeed on a second attempt. 429 is deliberately NOT retried here — its
 * `Retry-After` belongs to the UI's countdown, and a silent retry hides it.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status >= 500;
}

interface ApiFetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** Return the typed body of a successful result, or throw `ApiError`. */
export function unwrapApiResult<T>(result: ApiFetchResult<T>): T {
  if (result.response.ok && result.data !== undefined) {
    return result.data;
  }

  throw apiErrorFromResponse(result.response, result.error);
}
