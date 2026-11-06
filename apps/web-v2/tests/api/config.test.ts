import { describe, expect, it } from "vitest";

import {
  DEFAULT_API_BASE_URL,
  isApiConfigured,
  normalizeApiBaseUrl,
  resolveBrowserApiBaseUrl,
  resolveServerApiBaseUrl,
} from "@/lib/api/config";

describe("normalizeApiBaseUrl", () => {
  it("trims and strips every trailing slash", () => {
    expect(normalizeApiBaseUrl(" https://api.example.ma/ ")).toBe("https://api.example.ma");
    expect(normalizeApiBaseUrl("https://api.example.ma///")).toBe("https://api.example.ma");
  });

  it("keeps an empty value empty, so it means unconfigured", () => {
    expect(normalizeApiBaseUrl("   ")).toBe("");
  });
});

describe("resolveBrowserApiBaseUrl", () => {
  it("uses the public variable", () => {
    expect(resolveBrowserApiBaseUrl({ NEXT_PUBLIC_API_BASE_URL: "https://api.example.ma/" })).toBe(
      "https://api.example.ma",
    );
  });

  it("ignores the server-only variable and falls back to localhost", () => {
    expect(
      resolveBrowserApiBaseUrl({
        NEXT_PUBLIC_API_BASE_URL: "",
        API_BASE_URL: "http://api.internal:3000",
      }),
    ).toBe(DEFAULT_API_BASE_URL);
  });
});

describe("resolveServerApiBaseUrl", () => {
  it("prefers the server-only variable", () => {
    expect(
      resolveServerApiBaseUrl({
        NEXT_PUBLIC_API_BASE_URL: "https://api.example.ma",
        API_BASE_URL: "http://api.internal:3000/",
      }),
    ).toBe("http://api.internal:3000");
  });

  it("falls back to the public variable, then to localhost", () => {
    expect(
      resolveServerApiBaseUrl({
        NEXT_PUBLIC_API_BASE_URL: "https://api.example.ma",
      }),
    ).toBe("https://api.example.ma");
    expect(resolveServerApiBaseUrl({})).toBe(DEFAULT_API_BASE_URL);
  });
});

describe("isApiConfigured", () => {
  it("is false when both variables are missing", () => {
    expect(isApiConfigured({})).toBe(false);
  });

  it("is false when both variables are empty", () => {
    expect(isApiConfigured({ NEXT_PUBLIC_API_BASE_URL: "", API_BASE_URL: "" })).toBe(false);
    expect(isApiConfigured({ NEXT_PUBLIC_API_BASE_URL: "   ", API_BASE_URL: "  " })).toBe(false);
  });

  it("is true when only the public variable is configured", () => {
    expect(isApiConfigured({ NEXT_PUBLIC_API_BASE_URL: "https://api.example.ma" })).toBe(true);
  });

  it("is true when only the server variable is configured", () => {
    expect(isApiConfigured({ API_BASE_URL: "http://api.internal:3000" })).toBe(true);
  });

  it("is true when the server variable is empty but the public one is valid", () => {
    // Regression: nullish coalescing kept the empty `API_BASE_URL` and reported
    // the API unconfigured even though the browser origin was named.
    expect(
      isApiConfigured({ API_BASE_URL: "", NEXT_PUBLIC_API_BASE_URL: "https://api.example.ma" }),
    ).toBe(true);
    expect(
      isApiConfigured({ API_BASE_URL: "   ", NEXT_PUBLIC_API_BASE_URL: "https://api.example.ma" }),
    ).toBe(true);
  });

  it("is true when both variables are valid", () => {
    expect(
      isApiConfigured({
        NEXT_PUBLIC_API_BASE_URL: "https://api.example.ma",
        API_BASE_URL: "http://api.internal:3000",
      }),
    ).toBe(true);
  });
});
