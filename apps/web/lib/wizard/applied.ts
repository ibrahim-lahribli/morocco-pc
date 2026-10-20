/**
 * `inputs_applied` — the contract field the wizard needs and the API does not
 * serve yet (CD-1), read without pretending it is part of the types.
 *
 * `docs/plans/agent3-web-plan.md` records the dependency: `inputs_applied` would
 * say which of `use_case` / `resolution` / `priority` actually changed the
 * result, and v1 serves none of it because `resolution` and `priority` are
 * stored and not read (OG-38, Decision 17.6). S4's rule is that every field the
 * app reads comes from `schema.d.ts`, so a name that is not in the contract is a
 * COMPILE error — which is the right default and the reason `compile-gate.ts`
 * exists.
 *
 * This module is the one deliberate exception, and it is deliberately narrow: it
 * reads an ABSENT field out of an already-validated response through `unknown`,
 * and it answers a three-valued question rather than a boolean, because "the
 * contract says this input is inert" and "the contract does not say" are
 * different facts and must not collapse into each other:
 *
 *   - `null`  — the field is missing, null, or not an array of strings. The
 *               contract is SILENT, so the wizard asks the question and says the
 *               answer is stored rather than used (OD1). This is today's state.
 *   - a Set   — the contract named the applied inputs. An input NOT in it is
 *               inert, and its step is not shown at all.
 *
 * The moment the API serves the field, the parser below keeps working unchanged
 * (it already accepts the real shape) and the honest label turns itself off,
 * followed by the steps the contract hides. `e2e/wizard-steps.spec.ts` drives
 * both paths through `page.route`, so the feature check is a test, not a hope.
 *
 * Unknown members are IGNORED rather than rejected: a contract that adds a
 * fourth dimension later must not turn the whole field into silence.
 */

/** The three inputs `inputs_applied` is about — the contract's own names. */
export const APPLIED_INPUTS = ["use_case", "resolution", "priority"] as const;

export type AppliedInput = (typeof APPLIED_INPUTS)[number];

/**
 * What the contract said about the applied inputs.
 * `null` = it did not say. A Set = it did (possibly empty).
 */
export type AppliedInputs = ReadonlySet<AppliedInput> | null;

function isAppliedInput(value: unknown): value is AppliedInput {
  return typeof value === "string" && (APPLIED_INPUTS as readonly string[]).includes(value);
}

/**
 * Read `inputs_applied` off a `meta/options` body.
 *
 * Takes `unknown` on purpose: the caller has a typed response, and the point of
 * this function is that the field is NOT in that type. It never throws — a
 * malformed value is silence, because a wizard that crashes over an optional
 * hint is worse than one that asks an extra question honestly.
 */
export function readAppliedInputs(body: unknown): AppliedInputs {
  if (typeof body !== "object" || body === null) return null;
  const raw = (body as Record<string, unknown>).inputs_applied;
  if (!Array.isArray(raw)) return null;
  return new Set(raw.filter(isAppliedInput));
}
