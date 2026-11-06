import { describe, expect, it } from "vitest";

import {
  ApiError,
  apiErrorFromResponse,
  isApiError,
  isRetryableStatus,
  parseRetryAfter,
  unwrapApiResult,
} from "@/lib/api/errors";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("apiErrorFromResponse", () => {
  it("reads the API error envelope", () => {
    const response = jsonResponse(
      429,
      { error: "RATE_LIMITED", message: "Too many requests", request_id: "req-42" },
      { "retry-after": "60" },
    );

    const error = apiErrorFromResponse(response, {
      error: "RATE_LIMITED",
      message: "Too many requests",
      request_id: "req-42",
    });

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(429);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.message).toBe("Too many requests");
    expect(error.requestId).toBe("req-42");
    expect(error.retryAfterSeconds).toBe(60);
  });

  it("falls back to HTTP_<status> and the response text for a non-envelope body", () => {
    const response = new Response("not json", { status: 502, statusText: "Bad Gateway" });
    const error = apiErrorFromResponse(response, "not json");

    expect(error.code).toBe("HTTP_502");
    expect(error.message).toBe("Bad Gateway");
    expect(error.retryAfterSeconds).toBeNull();
  });

  it("falls back to the x-request-id header", () => {
    const response = jsonResponse(
      500,
      { error: "INTERNAL_ERROR", message: "Oops" },
      {
        "x-request-id": "header-id",
      },
    );

    expect(apiErrorFromResponse(response, null).requestId).toBe("header-id");
  });
});

describe("parseRetryAfter", () => {
  it("accepts non-negative seconds and rejects an HTTP date", () => {
    expect(parseRetryAfter("60")).toBe(60);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
  });
});

describe("unwrapApiResult", () => {
  it("returns the typed body on success", () => {
    const data = { status: "ok" as const, db: "ok" as const, engine_version: "dev" };
    expect(unwrapApiResult({ data, response: jsonResponse(200, data) })).toBe(data);
  });

  it("throws ApiError on a failed response", () => {
    const response = jsonResponse(404, { error: "NOT_FOUND", message: "Unknown" });

    expect(() =>
      unwrapApiResult({ data: undefined, error: { error: "NOT_FOUND" }, response }),
    ).toThrow(ApiError);
  });

  it("throws when a 2xx has no body", () => {
    expect(() =>
      unwrapApiResult({ data: undefined, response: new Response(null, { status: 204 }) }),
    ).toThrow(ApiError);
  });
});

describe("retryability", () => {
  it("retries transport, timeout and server failures only", () => {
    expect(isRetryableStatus(0)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(422)).toBe(false);
    expect(isRetryableStatus(429)).toBe(false);
  });

  it("recognizes ApiError instances", () => {
    expect(isApiError(new ApiError({ status: 500, code: "X", message: "x" }))).toBe(true);
    expect(isApiError(new Error("x"))).toBe(false);
  });
});
