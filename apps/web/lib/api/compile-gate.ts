/**
 * apps/web/lib/api/compile-gate.ts — the contract's type checks, enforced by
 * `tsc --noEmit` rather than by a test with no assertions.
 *
 * This file is never imported at runtime. Its job is to make a type regression
 * a BUILD FAILURE:
 *
 *   - `@ts-expect-error` is itself an error when the marked line stops failing.
 *     So if the generated types ever loosen (an unknown request field becomes
 *     accepted, a number turns into `string | number`), typecheck goes red and
 *     names this line.
 *   - The positive assertions keep the fields S9/S11/S13 depend on from being
 *     deleted from the contract unnoticed.
 *
 * It is deliberately small: one probe per property that a screen would notice,
 * not a mirror of the schema.
 */

import type { RecommendationInput, RecommendationResponse } from "./client";

/** The minimum a wizard step sends: three fields, no optional ones. */
export const MINIMAL_INPUT: RecommendationInput = {
  budget_amount: 6000,
  currency: "MAD",
  use_case: "GAMING",
};

/** Optional fields are optional, not forbidden. */
export const FULL_INPUT: RecommendationInput = {
  budget_amount: 15000,
  currency: "MAD",
  use_case: "GAMING",
  resolution: "1440p",
  priority: 3,
};

export const UNKNOWN_FIELD: RecommendationInput = {
  budget_amount: 6000,
  currency: "MAD",
  use_case: "GAMING",
  // @ts-expect-error an unknown request field is rejected by the contract types
  budget: 6000,
};

export const NUMERIC_STRING_BUDGET: RecommendationInput = {
  // @ts-expect-error budget_amount is a NUMBER in the contract; the API refuses "6000"
  budget_amount: "6000",
  currency: "MAD",
  use_case: "GAMING",
};

export const BAD_PRIORITY: RecommendationInput = {
  budget_amount: 6000,
  currency: "MAD",
  use_case: "GAMING",
  // @ts-expect-error priority is a NUMBER on the wire (its 1..5 range is runtime validation, not a type)
  priority: "haute",
};

/**
 * Response-side probes: `declare` keeps this compile-only (no runtime value, so
 * nothing can import it by accident).
 */
declare const response: RecommendationResponse;

/** The three states the price badge must distinguish (S12). */
export const PRICE_STATES: Array<RecommendationResponse["builds"][number]["price_status"]> = [
  "verified",
  "indicative",
];

/** `budget_floor` is nullable because a pass can know no floor (V2). */
export const FLOOR_IS_NULLABLE: RecommendationResponse["budget_floor"] = null;

/** A component carries `slug` (nullable) and never a `display_name` field. */
export const COMPONENT_SLUG: RecommendationResponse["builds"][number]["components"][number]["slug"] =
  response.builds[0].components[0].slug;

// @ts-expect-error display_name is a SOURCE for `name`, never a wire field (V5)
export const COMPONENT_DISPLAY_NAME: string = response.builds[0].components[0].display_name;
