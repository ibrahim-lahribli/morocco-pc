import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "@/lib/api/client";
import { ApiError, unwrapApiResult } from "@/lib/api/errors";

function stubFetch(response: Response) {
  return vi.fn<(request: Request) => Promise<Response>>(async () => response);
}

describe("createApiClient", () => {
  it("joins the normalized base URL with the contract path", async () => {
    const fetchStub = stubFetch(
      new Response(JSON.stringify({ status: "ok", db: "ok", engine_version: "dev" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = createApiClient({
      baseUrl: "https://api.example.ma/",
      fetch: fetchStub,
    });

    const result = await client.GET("/v1/health");

    expect(result.response.status).toBe(200);
    expect(result.data).toEqual({ status: "ok", db: "ok", engine_version: "dev" });
    expect(fetchStub).toHaveBeenCalledTimes(1);

    const request = fetchStub.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    expect(request?.url).toBe("https://api.example.ma/v1/health");
    expect(request?.headers.get("accept")).toBe("application/json");
  });

  it("surfaces a typed error result and unwraps it into ApiError", async () => {
    const fetchStub = stubFetch(
      new Response(JSON.stringify({ error: "NOT_FOUND", message: "Unknown product" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = createApiClient({ baseUrl: "http://localhost:3000", fetch: fetchStub });
    const result = await client.GET("/v1/catalog/products/{slug}", {
      params: { path: { slug: "rtx-4060" } },
    });

    expect(result.response.status).toBe(404);
    expect(result.data).toBeUndefined();
    expect(() => unwrapApiResult(result)).toThrow(ApiError);

    try {
      unwrapApiResult(result);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(404);
      expect((error as ApiError).code).toBe("NOT_FOUND");
    }
  });

  it("sends query parameters through the typed contract", async () => {
    const fetchStub = stubFetch(
      new Response(JSON.stringify({ products: [], next_cursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = createApiClient({ baseUrl: "http://localhost:3000", fetch: fetchStub });
    const result = await client.GET("/v1/catalog/products", {
      params: { query: { limit: "10" } },
    });

    expect(result.response.ok).toBe(true);
    const request = fetchStub.mock.calls[0]?.[0];
    expect(request?.url).toContain("/v1/catalog/products?");
    expect(request?.url).toContain("limit=10");
  });
});
