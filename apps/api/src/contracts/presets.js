'use strict';

/**
 * apps/api/src/contracts/presets.js - GET /v1/presets contracts (Platform P1
 * Sprint 6 / Decision 48).
 *
 * `catalog_version` is a plain string here, NOT `string | null` as the same
 * field is on a recommendation response. The difference is a policy, not an
 * oversight: this endpoint selects rows BY the current catalog version, so a
 * version it cannot compute selects nothing, and the route answers 503 rather
 * than serving a list it cannot attribute to a catalog state. The type
 * therefore states what the route guarantees, not merely what the column
 * allows - and it is what stops `presets` from being served under a version
 * nobody recorded.
 *
 * `generated_at` is nullable because an EMPTY list has no generation time to
 * report: it is the newest `generated_at` among the rows being returned, and no
 * rows means no timestamp. NULL is the honest value there - it says "not
 * generated yet", which is what a client renders, rather than an invented date.
 *
 * `build_score` and `price_status` are DERIVED per preset from the persisted
 * pass (Decision 48), not stored on the preset row. Both are nullable because a
 * committed pass CAN legitimately assemble nothing - an under-budget floor is a
 * valid outcome (Decision 17.2) - and `price_status` then says `null`, never
 * 'verified': a build-less preset has no price to make a claim about, and
 * `'verified'` over an empty component list is the single reading the derived
 * status must not produce. The two boolean-free rules for it are: 'verified'
 * only when the top-ranked build HAS components and every one is VERIFIED;
 * 'indicative' when any is not (fail-safe by direction - an unknown provenance
 * is never advertised as verified); NULL when there is no build to verify.
 *
 * Both query parameters are REQUIRED, and unknown ones are REFUSED (ajv
 * `removeAdditional: false` in app.js), so a typo is a 422 instead of a silently
 * broader query. `use_case` is checked against the ACTIVE model's vocabulary in
 * the handler rather than by the schema: the accepted values are a property of
 * the scoring model (Decision 37), so the schema cannot know them - and an
 * empty list is never the answer for a use case the model does not declare
 * (Decision 36 item 3).
 */

const { Type } = require('@sinclair/typebox');

const PresetSchema = Type.Object({
  budget_amount: Type.Number(),
  /** The pass this landing page shows: the same id GET /v1/recommendations/{id} answers. */
  recommendation_id: Type.String(),
  build_score: Type.Union([Type.Number(), Type.Null()]),
  /**
   * An EXPLICIT `Type.Null()` branch, not `Type.Union([...], { nullable: true })`.
   * The tidier-looking option is refused: ajv compiles a response schema with
   * `"nullable" cannot be used without "type"` (measured 2026-10-16), so the
   * third branch is the only form Fastify accepts here - the same form the
   * recommendation contracts use for every `string | null` field. The cost is a
   * known OpenAPI 3.0 rendering artifact: `@fastify/swagger` folds `Type.Null()`
   * into `{ type: 'object', nullable: true, enum: [null] }`, which a generator
   * may read as "an object" rather than "null". It is pinned by
   * openapi-v1.4.json rather than hidden, and the alternative readings were
   * worse: a third vocabulary member (`'none'`) would put a value on this
   * endpoint that GET /v1/recommendations does not have for the same field name,
   * and omitting the property would make the row shape vary per row.
   */
  price_status: Type.Union([Type.Literal('indicative'), Type.Literal('verified'), Type.Null()]),
}, { additionalProperties: false });

const PresetsResponseSchema = Type.Object({
  /** The catalog state these presets were generated against. Never null (see header). */
  catalog_version: Type.String(),
  generated_at: Type.Union([Type.String(), Type.Null()]),
  presets: Type.Array(PresetSchema),
}, { additionalProperties: false, $id: 'PresetsResponse' });

const PresetsQuerySchema = Type.Object({
  use_case: Type.String({ minLength: 1 }),
  currency: Type.String({ minLength: 3, maxLength: 3 }),
}, { additionalProperties: false, $id: 'PresetsQuery' });

module.exports = { PresetSchema, PresetsResponseSchema, PresetsQuerySchema };
