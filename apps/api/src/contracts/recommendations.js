'use strict';

/**
 * apps/api/src/contracts/recommendations.js - POST/GET recommendation contracts.
 *
 * These schemas are the published wire contract (Decision 36 item 4). Two
 * properties are load-bearing and easy to get wrong:
 *
 *   1. Nullability mirrors the DATABASE, not the happy path. `budget_floor`,
 *      `engine_version`, `strategy_key`, `catalog_version` and
 *      `components[].slug` are all nullable because their columns are
 *      (migrations 019, 020 and 021), and NULL means "not recorded" - a
 *      pre-019 row, a pass that ran without an engine version, a product
 *      inserted after 020's backfill without a slug, or a pass whose catalog
 *      digest was unavailable (021). A schema that demanded a value would make
 *      GET unserializable against real data, and would also assert a fact the
 *      schema itself declares unknowable.
 *   2. `price_status` is DERIVED, never stored: 'verified' only when EVERY
 *      component's persisted `offer_class` is VERIFIED, 'indicative' otherwise.
 *      The disclaimer text is what makes an indicative price honest.
 *   3. `input_effects` is the per-pass half of Decision 52's contract: for each
 *      accepted input, whether THIS pass read it in a way that shaped the
 *      answer. `input` and `effect` are closed literal vocabularies (a client
 *      may switch on them); `reason` is a plain string because it explains WHY
 *      and may grow without breaking a client. The values are derived on the
 *      READ path from persisted rows (`apps/api/src/inputs.js`), so POST and GET
 *      cannot disagree - and a field that is absent from an older server's body
 *      is `undefined` here, which the web client treats as silence, not as
 *      "nothing applied".
 *   4. `reused` is a REQUEST fact, alongside `served_by.engine_version`:
 *      `true` only when a POST answered from an equivalent committed pass
 *      (Platform P1 Sprint 5, Decision 47), `false` on every GET and on every
 *      POST that ran its own pass. It is NOT nullable and NOT derivable from
 *      the stored rows - nothing persisted distinguishes a pass that was
 *      reused from one that was not, because nothing needed to.
 *
 * The body schema is intentionally narrow: `budget_amount` is a NUMBER (the
 * engine's loader is strict about that, and the API does not accept a numeric
 * string), `currency` is exactly three characters, and unknown fields are
 * REJECTED (ajv `removeAdditional: false` in app.js) rather than silently
 * dropped, so a typo'd field is a 422 and not a mystery.
 */

const { Type } = require('@sinclair/typebox');

const DISCLAIMER = 'Prix indicatifs, non actualisés.';

const CreateRecommendationBodySchema = Type.Object({
  budget_amount: Type.Number({ exclusiveMinimum: 0, maximum: 1000000 }),
  currency: Type.String({ minLength: 3, maxLength: 3 }),
  use_case: Type.String({ minLength: 1 }),
  resolution: Type.Optional(Type.String({ minLength: 1 })),
  priority: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
}, { additionalProperties: false, $id: 'CreateRecommendationBody' });

const BuildComponentSchema = Type.Object({
  role: Type.String(),
  product_id: Type.String(),
  name: Type.String(),
  /** The persisted product slug (migration 020). Nullable like its column. */
  slug: Type.Union([Type.String(), Type.Null()]),
  variant: Type.Union([Type.String(), Type.Null()]),
  price_used: Type.Union([Type.Number(), Type.Null()]),
  offer_class: Type.String(),
  store_offer_id: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false });

const BuildSchema = Type.Object({
  rank: Type.Integer(),
  /** The deploy that produced this rank (Decision 46), or null if unrecorded. */
  engine_version: Type.Union([Type.String(), Type.Null()]),
  /** The E4 archetype (Decision 41) that nominated this rank, or null. */
  strategy_key: Type.Union([Type.String(), Type.Null()]),
  total_price: Type.Union([Type.Number(), Type.Null()]),
  build_score: Type.Union([Type.Number(), Type.Null()]),
  compatibility_status: Type.String(),
  explanation: Type.String(),
  price_status: Type.Union([Type.Literal('indicative'), Type.Literal('verified')]),
  components: Type.Array(BuildComponentSchema),
}, { additionalProperties: false });

/**
 * One input's effect on one pass (Decision 52). `input` and `effect` are
 * literals so a client's switch is exhaustive; `reason` is an explanation, not
 * a vocabulary the schema freezes.
 */
const InputEffectSchema = Type.Object({
  input: Type.Union([
    Type.Literal('use_case'),
    Type.Literal('resolution'),
    Type.Literal('priority'),
  ]),
  effect: Type.Union([
    Type.Literal('APPLIED'),
    Type.Literal('NO_EFFECT'),
    Type.Literal('UNKNOWN'),
  ]),
  reason: Type.String(),
}, { additionalProperties: false, $id: 'InputEffect' });

/**
 * Mirrors `retention/budget-floor.js` computeBudgetFloor exactly. `within_budget`
 * is `boolean | null` because a missing required role makes the floor UNKNOWN
 * (never 0, never `true`) - the project's standing NULL != 0 rule.
 */
const BudgetFloorSchema = Type.Object({
  cheapest_total: Type.Union([Type.Number(), Type.Null()]),
  currency: Type.String(),
  budget_amount: Type.Number(),
  within_budget: Type.Union([Type.Boolean(), Type.Null()]),
  cheapest_by_role: Type.Record(Type.String(), Type.Number()),
  missing_roles: Type.Array(Type.String()),
}, { additionalProperties: false });

const RecommendationResponseSchema = Type.Object({
  id: Type.String(),
  budget_amount: Type.Union([Type.Number(), Type.Null()]),
  currency: Type.Union([Type.String(), Type.Null()]),
  use_case: Type.Union([Type.String(), Type.Null()]),
  generated_at: Type.Union([Type.String(), Type.Null()]),
  budget_floor: Type.Union([BudgetFloorSchema, Type.Null()]),
  engine_version: Type.Union([Type.String(), Type.Null()]),
  /**
   * The catalog state this pass ran against (Decision 47 / migration 021): a
   * 32-character hex content digest, or null when none was recorded. Served
   * because a client that keeps an id is making a durable reference, and
   * Decision 47 item 17 requires the reference to name the catalog it belongs
   * to. It is the reason a repeated POST can answer "same id" or "new id" and
   * be checkable rather than mysterious.
   */
  catalog_version: Type.Union([Type.String(), Type.Null()]),
  /** A request fact: true only when THIS POST reused an equivalent pass. */
  reused: Type.Boolean(),
  reason: Type.Union([Type.String(), Type.Null()]),
  disclaimer: Type.String(),
  /**
   * The three inputs, in served order, always all three: an omitted optional
   * input is reported as `NO_EFFECT`/`NOT_PROVIDED` rather than left out, so a
   * client never has to infer which question its user skipped.
   */
  input_effects: Type.Array(InputEffectSchema),
  served_by: Type.Object({ engine_version: Type.String() }, { additionalProperties: false }),
  builds: Type.Array(BuildSchema),
}, { additionalProperties: false, $id: 'RecommendationResponse' });

const RecommendationParamsSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
}, { additionalProperties: false, $id: 'RecommendationParams' });

module.exports = {
  DISCLAIMER,
  CreateRecommendationBodySchema,
  BuildComponentSchema,
  BuildSchema,
  BudgetFloorSchema,
  InputEffectSchema,
  RecommendationResponseSchema,
  RecommendationParamsSchema,
};
