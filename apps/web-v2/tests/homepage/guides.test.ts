import { describe, expect, it } from "vitest";

import { GUIDES } from "@/lib/homepage/guides";

describe("featured guides", () => {
  it("ships exactly the four approved guides in frame order", () => {
    expect(GUIDES.map((guide) => guide.slug)).toEqual([
      "quel-budget-pc-gamer-maroc",
      "choisir-carte-graphique-nvidia-amd",
      "combien-de-ram-16-ou-32-go",
      "pc-fixe-vs-pc-portable-maroc",
    ]);
  });

  it("keeps each guide's category, reading time and dictionary title key", () => {
    expect(GUIDES.map((guide) => [guide.category, guide.minutes, guide.titleKey])).toEqual([
      ["practical", 4, "budget"],
      ["comparison", 6, "gpu"],
      ["advice", 3, "ram"],
      ["special", 5, "portable"],
    ]);
  });

  it("stores no title, so every visible string stays in the dictionary", () => {
    for (const guide of GUIDES) {
      expect(Object.keys(guide).sort()).toEqual(["category", "minutes", "slug", "titleKey"]);
    }
  });

  it("uses unique slugs", () => {
    expect(new Set(GUIDES.map((guide) => guide.slug)).size).toBe(GUIDES.length);
  });
});
