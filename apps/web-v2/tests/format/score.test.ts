import { describe, expect, it } from "vitest";

import { formatScore } from "@/lib/format/score";

describe("formatScore", () => {
  it("prints the French comma with one decimal place", () => {
    expect(formatScore(72.5, "fr")).toBe("72,5");
    expect(formatScore(70, "fr")).toBe("70,0");
  });

  it("keeps Latin digits and the point in Arabic", () => {
    expect(formatScore(72.5, "ar")).toBe("72.5");
    expect(formatScore(70, "ar")).toBe("70.0");
  });

  it("rounds to one decimal rather than truncating", () => {
    expect(formatScore(72.46, "fr")).toBe("72,5");
    expect(formatScore(72.44, "fr")).toBe("72,4");
  });

  it("refuses a non-finite score instead of printing NaN", () => {
    expect(() => formatScore(Number.NaN, "fr")).toThrow(TypeError);
    expect(() => formatScore(Number.POSITIVE_INFINITY, "ar")).toThrow(TypeError);
  });
});
