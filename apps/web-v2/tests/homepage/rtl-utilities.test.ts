import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The design system's direction rule, enforced instead of remembered.
 *
 * `docs/DESIGN_SYSTEM.md` forbids the physical utilities (`ml/mr/pl/pr`,
 * `left/right`, `text-left/right`, `border-l/r`, `rounded-l/r`…) because Arabic
 * is a mirror of the same tree, not a second stylesheet. Until this suite the
 * rule held only by reviewer attention — exactly the kind of thing a visual
 * refinement pass breaks while "nudging" a margin.
 *
 * The scan covers `components/`, where every page's UI lives; `app/` composes
 * those components and holds the container classes the tokens define.
 */
const componentsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../components",
);

/**
 * Each pattern targets a class-shaped token, so prose and identifiers cannot
 * trip it: the leading `\b` and the Tailwind shape after the dash are what keep
 * `border-lg` (not a class) or `printf` (not a class) out of the report.
 */
const FORBIDDEN: readonly RegExp[] = [
  /\b(?:ml|mr|pl|pr)-\[?[a-z0-9]/g, // margin/padding sides
  /\b(?:text-left|text-right)\b/g, // text alignment
  /\b(?:border|rounded)-(?:l|r|tl|tr|bl|br)\b/g, // corners and edges
  /\b(?:left|right)-\[?[a-z0-9]/g, // offsets and insets
];

function componentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return componentFiles(full);
    }

    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("direction utilities", () => {
  it("scans the component tree rather than passing vacuously", () => {
    // A gate over an empty file list would always be green, so the scope is
    // asserted too: the tree carries far more than this many components.
    expect(componentFiles(componentsRoot).length).toBeGreaterThan(10);
  });

  it("uses logical direction utilities in every component", () => {
    const offenders = componentFiles(componentsRoot).flatMap((file) =>
      FORBIDDEN.flatMap((pattern) =>
        [...readFileSync(file, "utf8").matchAll(pattern)].map(
          (match) => `${path.relative(componentsRoot, file)}: ${match[0]}`,
        ),
      ),
    );

    expect(offenders).toEqual([]);
  });
});
