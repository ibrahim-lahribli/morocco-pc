import { describe, expect, it } from "vitest";

import { createSearchSchema } from "@/lib/demo/search-schema";

const schema = createSearchSchema({ required: "required", min: "too short" });

describe("createSearchSchema", () => {
  it("rejects an empty query with the required message", () => {
    const result = schema.safeParse({ query: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("required");
  });

  it("treats whitespace-only input as required", () => {
    const result = schema.safeParse({ query: "   " });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("required");
  });

  it("rejects a single character with the minimum-length message", () => {
    const result = schema.safeParse({ query: "a" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("too short");
  });

  it("accepts two or more characters and trims the value", () => {
    const result = schema.safeParse({ query: "  RTX 4060  " });
    expect(result.success).toBe(true);
    expect(result.data?.query).toBe("RTX 4060");
  });
});
