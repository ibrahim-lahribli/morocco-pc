import { describe, expect, it } from "vitest";

import { configuratorRecommendationKey } from "@/lib/configurator/queries";

describe("configurator query identity", () => {
  it("distinguishes recommendations and the empty state", () => {
    expect(configuratorRecommendationKey("a")).not.toEqual(configuratorRecommendationKey("b"));
    expect(configuratorRecommendationKey("a")).not.toEqual(configuratorRecommendationKey(null));
  });
});
