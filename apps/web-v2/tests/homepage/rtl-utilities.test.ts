import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The design system's direction rule, enforced instead of remembered.
 *
 * `docs/DESIGN_SYSTEM.md` forbids the physical utilities (`ml/mr/pl/pr`,
 * `left/right`, `text-left/right`, `border-l/r`, `rounded-l/r` and the physical
 * corners) because Arabic mirrors the same tree rather than loading a second
 * stylesheet.
 *
 * The matcher below is deliberately not one large regular expression. It reads
 * class candidates out of string literals, strips variant prefixes
 * (`md:`, `hover:`, `max-lg:` …) with bracket awareness, and matches the
 * remaining utility base against one named family per rule. That keeps the
 * failure message readable, stops prose in a comment from tripping the rule, and
 * makes "which family did this violate?" answerable.
 */
const componentsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../components",
);

/** Matches the contents of a double-quoted, single-quoted or backtick literal. */
const LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;

interface Family {
  name: string;
  test: (base: string) => boolean;
}

/**
 * One entry per documented rule. Each test anchors its utility base, so a
 * physical side must be followed by a value or the end of the token
 * (`border-l`, `border-l-2`, `border-l-[#123456]`) and must not swallow a longer
 * word (`rounded-lg` is not a physical corner).
 */
const FAMILIES: readonly Family[] = [
  { name: "margin side", test: (base) => /^-?m[lr](?:-|$)/.test(base) },
  { name: "padding side", test: (base) => /^-?p[lr](?:-|$)/.test(base) },
  { name: "inset side", test: (base) => /^-?(?:left|right)(?:-|$)/.test(base) },
  { name: "text alignment", test: (base) => /^text-(?:left|right)$/.test(base) },
  { name: "border side", test: (base) => /^border-[lr](?:-|$)/.test(base) },
  { name: "corner radius", test: (base) => /^rounded-(?:l|r|tl|tr|bl|br)(?:-|$)/.test(base) },
];

export interface Violation {
  file: string;
  line: number;
  token: string;
  family: string;
}

/**
 * `md:hover:border-l-2` → `border-l-2`. Colons inside brackets belong to an
 * arbitrary value (`border-l-[rgb(0_0_0/0.5)]`, `supports-[display:grid]:`), so
 * only top-level colons are treated as variant separators.
 */
export function baseUtility(token: string): string {
  let depth = 0;
  let start = 0;

  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];

    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth = Math.max(0, depth - 1);
    } else if (char === ":" && depth === 0) {
      start = index + 1;
    }
  }

  // The important modifier (`!ml-2`) is a prefix on the utility, not part of it.
  return token.slice(start).replace(/^!/, "");
}

/** The family a class violates, or `null` when it is allowed. */
export function violatedFamily(token: string): string | null {
  const base = baseUtility(token);
  return FAMILIES.find((family) => family.test(base))?.name ?? null;
}

/** Reads every class candidate out of a source string, with its offset. */
function classTokens(source: string): { token: string; index: number }[] {
  const tokens: { token: string; index: number }[] = [];

  for (const literal of source.matchAll(LITERAL)) {
    const content = literal[1] ?? literal[2] ?? literal[3] ?? "";
    const offset = literal.index + 1;
    let cursor = 0;

    for (const raw of content.split(/\s+/)) {
      const at = content.indexOf(raw, cursor);
      cursor = at + raw.length;
      const token = raw.replace(/^[^a-zA-Z0-9!-]+/, "").replace(/[^a-zA-Z0-9\])%!-]+$/, "");

      if (token) tokens.push({ token, index: offset + at });
    }
  }

  return tokens;
}

/** `[file:line] token (family)` — one string per offender. */
export function findViolations(file: string, source: string): Violation[] {
  const violations: Violation[] = [];

  for (const { token, index } of classTokens(source)) {
    const family = violatedFamily(token);
    if (family === null) continue;

    const line = source.slice(0, index).split("\n").length;
    violations.push({ file, line, token, family });
  }

  return violations;
}

/** Same scan over a bare class list, for the positive/negative matrix. */
export function violationsInClassList(classList: string): string[] {
  return classList
    .split(/\s+/)
    .map((token) => violatedFamily(token))
    .filter((family): family is string => family !== null);
}

function componentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return componentFiles(full);
    }

    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

const FORBIDDEN: { className: string; family: string }[] = [
  { className: "border-l", family: "border side" },
  { className: "border-r", family: "border side" },
  { className: "border-l-2", family: "border side" },
  { className: "border-r-4", family: "border side" },
  { className: "border-l-[#123456]", family: "border side" },
  { className: "border-r-[var(--example)]", family: "border side" },
  { className: "rounded-tl", family: "corner radius" },
  { className: "rounded-tr", family: "corner radius" },
  { className: "rounded-bl", family: "corner radius" },
  { className: "rounded-br", family: "corner radius" },
  { className: "rounded-tl-lg", family: "corner radius" },
  { className: "rounded-tr-md", family: "corner radius" },
  { className: "rounded-bl-[12px]", family: "corner radius" },
  { className: "rounded-l", family: "corner radius" },
  { className: "rounded-r", family: "corner radius" },
  { className: "rounded-l-lg", family: "corner radius" },
  { className: "rounded-r-full", family: "corner radius" },
  { className: "md:border-l-2", family: "border side" },
  { className: "hover:border-r-4", family: "border side" },
  { className: "lg:rounded-tr-lg", family: "corner radius" },
  { className: "ml-2", family: "margin side" },
  { className: "mr-4", family: "margin side" },
  { className: "-ml-2", family: "margin side" },
  { className: "pl-8", family: "padding side" },
  { className: "pr-6", family: "padding side" },
  { className: "text-left", family: "text alignment" },
  { className: "text-right", family: "text alignment" },
  { className: "left-0", family: "inset side" },
  { className: "right-4", family: "inset side" },
  { className: "-right-2", family: "inset side" },
  { className: "md:hover:text-right", family: "text alignment" },
];

const ALLOWED = [
  "border-s",
  "border-e",
  "border-s-2",
  "border-e-4",
  "border-s-[#123456]",
  "rounded-ss",
  "rounded-se",
  "rounded-es",
  "rounded-ee",
  "rounded-s-lg",
  "rounded-e-lg",
  "rounded-lg",
  "rounded-full",
  "rounded-t-lg",
  "rounded-b-xl",
  "ms-2",
  "me-4",
  "-ms-1",
  "ps-3",
  "pe-5",
  "text-start",
  "text-end",
  "start-0",
  "end-4",
  "inset-x-0",
  "mx-auto",
  "border-2",
  "border-x-4",
  "border-t-2",
  "border-border",
  "bg-background",
  "size-4",
  "rtl:-scale-x-100",
  "max-lg:hidden",
];

describe("direction utilities", () => {
  it("rejects every physical utility the design system forbids", () => {
    for (const { className, family } of FORBIDDEN) {
      expect(violationsInClassList(className), `${className} should violate "${family}"`).toEqual([
        family,
      ]);
    }
  });

  it("accepts the logical equivalents and unrelated utilities", () => {
    expect(violationsInClassList(ALLOWED.join(" "))).toEqual([]);
  });

  it("reports the file, line and family for a violation in source", () => {
    const probe = [
      "export function Probe() {",
      '  return <div className="flex md:rounded-tr-md text-start" />;',
      "}",
      "",
    ].join("\n");

    expect(findViolations("probe.tsx", probe)).toEqual([
      { file: "probe.tsx", line: 2, token: "md:rounded-tr-md", family: "corner radius" },
    ]);
  });

  it("scans the component tree rather than passing vacuously", () => {
    // A gate over an empty file list would always be green, so the scope is
    // asserted too: the tree carries far more than this many components.
    expect(componentFiles(componentsRoot).length).toBeGreaterThan(10);
  });

  it("uses logical direction utilities in every component", () => {
    const offenders = componentFiles(componentsRoot).flatMap((file) =>
      findViolations(path.relative(componentsRoot, file), readFileSync(file, "utf8")),
    );

    expect(offenders).toEqual([]);
  });
});
