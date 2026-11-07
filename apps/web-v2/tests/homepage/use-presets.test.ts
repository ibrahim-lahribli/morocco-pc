import { describe, expect, it } from "vitest";

import { presetsQueryKey, recommendationQueryKey } from "@/lib/homepage/use-presets";

describe("query identity", () => {
  it("distinguishes recommendation ids", () => {
    expect(recommendationQueryKey("rec-a", "v1")).not.toEqual(
      recommendationQueryKey("rec-b", "v1"),
    );
  });

  it("distinguishes catalog versions for the same recommendation", () => {
    expect(recommendationQueryKey("rec-a", "v1")).not.toEqual(
      recommendationQueryKey("rec-a", "v2"),
    );
  });

  it("keys presets by use case and currency", () => {
    expect(presetsQueryKey("GAMING", "MAD")).not.toEqual(presetsQueryKey("OFFICE", "MAD"));
    expect(presetsQueryKey("GAMING", "MAD")).not.toEqual(presetsQueryKey("GAMING", "EUR"));
  });
});
