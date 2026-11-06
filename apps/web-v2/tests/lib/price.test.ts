import { describe, expect, it } from "vitest";

import { formatPrice, groupNumber, NBSP } from "@/lib/format/price";

describe("groupNumber", () => {
  it("groups thousands with non-breaking spaces", () => {
    expect(groupNumber(8594)).toBe(`8${NBSP}594`);
    expect(groupNumber(15000)).toBe(`15${NBSP}000`);
    expect(groupNumber(1234567)).toBe(`1${NBSP}234${NBSP}567`);
  });

  it("leaves small numbers ungrouped", () => {
    expect(groupNumber(999)).toBe("999");
  });

  it("rounds to whole dirhams and keeps the sign", () => {
    expect(groupNumber(8594.4)).toBe(`8${NBSP}594`);
    expect(groupNumber(-1200)).toBe(`-1${NBSP}200`);
  });

  it("rejects non-finite input instead of printing NaN", () => {
    expect(() => groupNumber(Number.NaN)).toThrow(TypeError);
    expect(() => groupNumber(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("formatPrice", () => {
  it("formats French dirhams with a non-breaking separator and symbol", () => {
    expect(formatPrice(8594, "DH")).toBe(`8${NBSP}594${NBSP}DH`);
  });

  it("formats Arabic dirhams with the local symbol", () => {
    expect(formatPrice(15000, "د.م.")).toBe(`15${NBSP}000${NBSP}د.م.`);
  });

  it("contains no regular space that could wrap mid-price", () => {
    expect(formatPrice(7450, "DH")).not.toContain(" ");
  });
});
