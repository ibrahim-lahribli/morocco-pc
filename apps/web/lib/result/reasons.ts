/**
 * lib/result/reasons.ts — the "pourquoi ce choix" facts, parsed and typed (S13).
 *
 * `reasons[]` is NOT in contract v1.5 (CD-2). Decision 44's `deriveReasons()`
 * exists in the engine and returns frozen `{ code, value }` records in a fixed
 * order, but no route serves them yet, so this module reads the field through
 * `unknown` — the same deliberate exception `lib/wizard/applied.ts` makes for
 * `inputs_applied`, and the only place a field outside `schema.d.ts` may be
 * named. Everything else in the app stays compile-gated.
 *
 * Three rules, and they are the sprint:
 *
 *   1. **Absent is not empty and neither is invented.** No array, or an array
 *      with nothing readable in it, yields `[]` and the caller renders the
 *      committed `explanation` string verbatim. Reasons are never composed from
 *      prose, and prose is never replaced by an invented code.
 *   2. **A code this module does not know becomes ONE generic view**, at the end,
 *      never the raw code. `FUTURE_REASON` on screen is a V5-class failure: the
 *      user would be reading the engine's vocabulary.
 *   3. **A value that does not have the code's shape is treated the same way.**
 *      `BUDGET_USED_PCT: "57"` is not formatted into "NaN %" and is not silently
 *      dropped: it becomes the generic view, because the fact was served and
 *      could not be said.
 *
 * What it returns is a VIEW, not a sentence: the copy lives in
 * `messages/*.json` under `result.reasons.*`, and the component that renders it
 * formats the numbers/roles with the app's own helpers. This module has no
 * locale, no JSX and no `t` — which is what lets its rules be tested without a
 * browser.
 *
 * Read-path note: Decision 44 item 5 says only `BUDGET_USED_PCT`, `GPU_SHARE`
 * and `INPUT_APPLIED` are derivable from persisted rows; the other five need
 * facts the engine holds at the seam. So an API that serves `reasons[]` will
 * serve a SUBSET on a GET revisit, and this module must render fewer lines
 * rather than claim the missing facts — which it does by construction, because
 * it only renders what it was given.
 */
import { roleLabel, strategyLabel } from "./model";

/**
 * One renderable fact. `key` values are catalogue keys (`roles.*` /
 * `strategies.*`), never raw enums; `ratio` is the 0..1 figure `formatPercent`
 * takes, so the component never divides by 100 itself.
 */
export type ReasonView =
  | { kind: "strategy"; key: string }
  | { kind: "budget"; ratio: number }
  | { kind: "gpuShare"; ratio: number }
  | { kind: "dominantRole"; key: string }
  | { kind: "bios"; versions: string[] }
  | { kind: "unknownSpec"; keys: string[] }
  | { kind: "inputs" }
  | { kind: "limitedCatalog" }
  | { kind: "unknown" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-empty array of non-empty strings, or null. */
function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") return null;
    out.push(item);
  }
  return out;
}

/** A finite number in `[min, max]`, or null. */
function finiteBetween(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value >= min && value <= max ? value : null;
}

/**
 * The view for one entry, or null when it cannot be rendered.
 *
 * `null` means "this entry is a reason we cannot name" — the caller turns that
 * into the generic view once, no matter how many entries it covers.
 */
function viewFor(entry: unknown): ReasonView | null {
  if (!isRecord(entry) || typeof entry.code !== "string") return null;
  const value = entry.value;

  switch (entry.code) {
    case "STRATEGY": {
      if (typeof value !== "string" || value.trim() === "") return null;
      return { kind: "strategy", key: strategyLabel(value) };
    }
    case "BUDGET_USED_PCT": {
      // A percentage, and it may legitimately exceed 100: a persisted pass is
      // not re-derived against a new budget, so there is no upper bound.
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
      return { kind: "budget", ratio: value / 100 };
    }
    case "GPU_SHARE": {
      // A share of the build total, so it is bounded by 1 by definition.
      const share = finiteBetween(value, 0, 1);
      return share === null ? null : { kind: "gpuShare", ratio: share };
    }
    case "DOMINANT_ROLE": {
      if (typeof value !== "string" || value.trim() === "") return null;
      return { kind: "dominantRole", key: roleLabel(value) };
    }
    case "BIOS_UPDATE_REQUIRED": {
      const versions = stringList(value);
      return versions === null ? null : { kind: "bios", versions };
    }
    case "UNKNOWN_SPEC": {
      const roles = stringList(value);
      return roles === null ? null : { kind: "unknownSpec", keys: roles.map(roleLabel) };
    }
    case "INPUT_APPLIED": {
      // The values (use_case, resolution, priority, gpu_policy) are contract
      // VOCABULARY, and the results page has no `meta/options` labels to
      // translate them with. The line therefore says that the inputs were
      // applied without printing `GAMING` or `1440p` at a user.
      return isRecord(value) ? { kind: "inputs" } : null;
    }
    case "LIMITED_CATALOG": {
      // The values are E4's internal selection codes (`FEWER_THAN_THREE...`);
      // the line is generic for the same reason.
      return stringList(value) === null ? null : { kind: "limitedCatalog" };
    }
    default:
      return null;
  }
}

/**
 * The reason views for a served `reasons[]`, in the order the engine emitted
 * them (Decision 44's `REASON_ORDER`), with at most ONE generic view at the end.
 *
 * Entries that are not `{ code, value }` records at all are IGNORED rather than
 * counted as unknown facts — a stray null is not a reason we failed to name.
 * Duplicate unknown codes collapse into the single generic line.
 */
export function reasonViews(raw: unknown): ReasonView[] {
  if (!Array.isArray(raw)) return [];

  const views: ReasonView[] = [];
  let unnameable = false;
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.code !== "string") continue;
    const view = viewFor(entry);
    if (view === null) unnameable = true;
    else views.push(view);
  }
  if (unnameable) views.push({ kind: "unknown" });
  return views;
}
