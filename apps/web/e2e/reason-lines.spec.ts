/**
 * apps/web/e2e/reason-lines.spec.ts — S13's parser, without a browser.
 *
 * `lib/result/reasons.ts` is the sprint's decision layer: it decides what is
 * absent, what cannot be named, and what order the lines come in. Those rules
 * are tested here rather than through a page, because a page test for a
 * malformed value would need a fixture that no server would ever send.
 *
 * Three properties matter more than the happy path:
 *
 *   1. ABSENT and EMPTY both mean "render the explanation" — never an empty
 *      panel and never an invented reason.
 *   2. An unknown code, or a KNOWN code carrying a malformed value, becomes
 *      exactly ONE generic view. It is never rendered raw and never formatted
 *      into "NaN %".
 *   3. A stray non-record in the array is not a reason at all: it is ignored,
 *      not counted as something we failed to name.
 */

import { test, expect } from "@playwright/test";

import { reasonViews } from "../lib/result/reasons";
import { RECOMMENDATION_WITH_REASONS } from "../mock/fixtures.mjs";

test("no usable reasons is silence, not an empty panel", () => {
  expect(reasonViews(undefined)).toEqual([]);
  expect(reasonViews(null)).toEqual([]);
  // A single object is not a list: the field is `reasons[]`.
  expect(reasonViews({ code: "STRATEGY", value: "VALUE" })).toEqual([]);
  // Present but empty is still nothing to say.
  expect(reasonViews([])).toEqual([]);
});

test("the served codes become typed views, in the engine's own order", () => {
  const views = reasonViews(RECOMMENDATION_WITH_REASONS.builds[0].reasons);

  expect(views.map((view) => view.kind)).toEqual([
    "strategy",
    "budget",
    "gpuShare",
    "dominantRole",
    "bios",
    "unknownSpec",
    "inputs",
    "limitedCatalog",
    "unknown",
  ]);

  // Every value is NARROWED here, so the component never guesses: a ratio the
  // formatter takes as-is, a catalogue key rather than an enum, a string list.
  expect(views[0]).toEqual({ kind: "strategy", key: "BALANCED" });
  expect(views[1]).toEqual({ kind: "budget", ratio: 57.29333333333334 / 100 });
  expect(views[2]).toEqual({ kind: "gpuShare", ratio: 0.3723 });
  expect(views[3]).toEqual({ kind: "dominantRole", key: "GPU" });
  expect(views[4]).toEqual({ kind: "bios", versions: ["1.2.3"] });
  expect(views[5]).toEqual({ kind: "unknownSpec", keys: ["CPU_COOLER"] });
  expect(views[6]).toEqual({ kind: "inputs" });
  expect(views[7]).toEqual({ kind: "limitedCatalog" });
  expect(views[8]).toEqual({ kind: "unknown" });
});

test("unknown codes collapse into ONE generic view, never the raw code", () => {
  const views = reasonViews([
    { code: "STRATEGY", value: "VALUE" },
    { code: "FUTURE_REASON", value: "whatever" },
    { code: "ANOTHER_FUTURE", value: null },
  ]);
  expect(views.map((view) => view.kind)).toEqual(["strategy", "unknown"]);
});

test("a malformed value is unnameable, not NaN and not a crash", () => {
  // A percentage served as a numeric STRING is not a percentage here: the
  // engine emits a number, and formatting a string would be a guess.
  expect(reasonViews([{ code: "BUDGET_USED_PCT", value: "57" }]).map((v) => v.kind)).toEqual([
    "unknown",
  ]);
  // A share of the total cannot exceed the total.
  expect(reasonViews([{ code: "GPU_SHARE", value: 1.5 }]).map((v) => v.kind)).toEqual(["unknown"]);
  expect(reasonViews([{ code: "GPU_SHARE", value: null }]).map((v) => v.kind)).toEqual(["unknown"]);
  // One bad member spoils the list: a role list is all roles or nothing.
  expect(
    reasonViews([{ code: "UNKNOWN_SPEC", value: ["CPU", 3] }]).map((v) => v.kind),
  ).toEqual(["unknown"]);
  expect(reasonViews([{ code: "BIOS_UPDATE_REQUIRED", value: [] }]).map((v) => v.kind)).toEqual([
    "unknown",
  ]);
  // The inputs object is the contract's shape, not a bare string.
  expect(reasonViews([{ code: "INPUT_APPLIED", value: "GAMING" }]).map((v) => v.kind)).toEqual([
    "unknown",
  ]);
});

test("entries that are not reasons are ignored, not counted as unnamed", () => {
  expect(reasonViews([null, "STRATEGY", 42, []])).toEqual([]);
  // ...while a record with no `code` is not a reason either.
  expect(reasonViews([{ value: "VALUE" }])).toEqual([]);
});

test("roles and strategies map through the catalogue, never as raw enums", () => {
  const views = reasonViews([
    { code: "DOMINANT_ROLE", value: "GPU" },
    { code: "DOMINANT_ROLE", value: "POWER_SUPPLY" },
    { code: "STRATEGY", value: "PRICE" },
    { code: "STRATEGY", value: "VALUE" },
  ]);
  expect(views).toEqual([
    { kind: "dominantRole", key: "GPU" },
    // An unknown role is "Autre", not `POWER_SUPPLY` on screen.
    { kind: "dominantRole", key: "OTHER" },
    { kind: "strategy", key: "OTHER" },
    { kind: "strategy", key: "VALUE" },
  ]);
});
