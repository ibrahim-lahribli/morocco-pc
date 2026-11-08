import { describe, expect, it } from "vitest";

import { contrastRatio, parseCssColor, relativeLuminance } from "@/lib/a11y/contrast";

describe("contrast", () => {
  it("parses every rgb() form getComputedStyle returns", () => {
    expect(parseCssColor("rgb(255, 255, 255)")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseCssColor("rgba(11, 28, 48, 0.8)")).toEqual({ r: 11, g: 28, b: 48 });
    expect(parseCssColor("rgb(11 28 48 / 0.8)")).toEqual({ r: 11, g: 28, b: 48 });
  });

  it("refuses a colour it cannot read instead of returning NaN", () => {
    expect(() => parseCssColor("oklch(0.6 0.2 250)")).toThrow(/Unsupported CSS colour/);
  });

  it("matches the WCAG reference values", () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 1);
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });
});
