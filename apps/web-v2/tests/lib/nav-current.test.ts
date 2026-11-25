import { describe, expect, it } from "vitest";

import { isNavItemCurrent } from "@/components/layout/nav-current";

describe("isNavItemCurrent", () => {
  it("matches route hrefs on the path alone, ignoring the query string", () => {
    expect(isNavItemCurrent("/configurateur?step=1", "/configurateur")).toBe(true);
    expect(
      isNavItemCurrent("/configurateur?step=2&use_case=GAMING&budget=8000", "/configurateur"),
    ).toBe(true);
    expect(isNavItemCurrent("/configurateur?step=1", "/")).toBe(false);
    expect(isNavItemCurrent("/configurateur?step=1", "/autre")).toBe(false);
  });

  it("treats the #top anchor as the homepage itself, only there", () => {
    expect(isNavItemCurrent("#top", "/")).toBe(true);
    expect(isNavItemCurrent("#top", "/configurateur")).toBe(false);
  });

  it("never marks a section anchor current", () => {
    expect(isNavItemCurrent("#guides", "/")).toBe(false);
    expect(isNavItemCurrent("#guides", "/configurateur")).toBe(false);
  });
});
