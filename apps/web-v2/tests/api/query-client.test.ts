import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";
import {
  createQueryClient,
  MAX_QUERY_RETRIES,
  QUERY_GC_TIME_MS,
  QUERY_STALE_TIME_MS,
  shouldRetryQuery,
} from "@/lib/api/query-client";

describe("createQueryClient", () => {
  it("sets the foundation's stale and garbage-collection windows", () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();

    expect(QUERY_STALE_TIME_MS).toBe(30_000);
    expect(QUERY_GC_TIME_MS).toBe(300_000);
    expect(defaults.queries?.staleTime).toBe(QUERY_STALE_TIME_MS);
    expect(defaults.queries?.gcTime).toBe(QUERY_GC_TIME_MS);
    expect(defaults.queries?.retry).toBe(shouldRetryQuery);
  });

  it("never retries mutations, because a POST runs and persists a pass", () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
  });
});

describe("shouldRetryQuery", () => {
  it("retries 5xx, 408 and network failures up to the cap", () => {
    expect(shouldRetryQuery(0, new ApiError({ status: 500, code: "X", message: "x" }))).toBe(true);
    expect(shouldRetryQuery(1, new ApiError({ status: 408, code: "X", message: "x" }))).toBe(true);
    expect(shouldRetryQuery(0, new ApiError({ status: 0, code: "NETWORK", message: "x" }))).toBe(
      true,
    );
    expect(
      shouldRetryQuery(MAX_QUERY_RETRIES, new ApiError({ status: 500, code: "X", message: "x" })),
    ).toBe(false);
  });

  it("does not retry client errors, including a rate limit", () => {
    for (const status of [400, 404, 409, 422, 429]) {
      expect(shouldRetryQuery(0, new ApiError({ status, code: "X", message: "x" }))).toBe(false);
    }
  });

  it("retries a fetch TypeError once, then stops", () => {
    expect(shouldRetryQuery(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryQuery(1, new TypeError("Failed to fetch"))).toBe(false);
    expect(shouldRetryQuery(0, new Error("bug"))).toBe(false);
  });
});
