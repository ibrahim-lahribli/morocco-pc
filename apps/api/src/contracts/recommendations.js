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

/**
 * The committed swap a build carries (Decision 56, contract v1.10). Nullable,
 * because most builds are the engine's own and no row would answer it.
 *
 * Only what a client cannot derive from the build itself: the role is already
 * visible in `components`, and WHICH product it now holds is the component's own
 * `product_id`. What no component can say is that the build was MODIFIED, which
 * role was the one replaced, and when - and that is what this object carries.
 */
const SwappedSchema = Type.Object({
  role: Type.String(),
  committed_at: Type.Union([Type.String(), Type.Null()]),
  /** The deploy that computed the derived build's score. */
  engine_version: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false, $id: 'Swapped' });

const BuildSchema = Type.Object({
  rank: Type.Integer(),
  /** The deploy that produced this rank (Decision 46), or null if unrecorded. */
  engine_version: Type.Union([Type.String(), Type.Null()]),
  /** The E4 archetype (Decision 41) that nominated this rank, or null. */
  strategy_key: Type.Union([Type.String(), Type.Null()]),
  total_price: Type.Union([Type.Number(), Type.Null()]),
  build_score: Type.Union([Type.Number(), Type.Null()]),
  compatibility_status: Type.String(),
  /**
   * Nullable SINCE v1.10 (Decision 56 item 7). The column always was
   * (`recommendation_result.explanation` is `text NULL`), and a swapped build
   * genuinely has no engine explanation - the stored text describes the parts it
   * no longer carries - so `Type.String()` was also a latent unserializable row,
   * not only a swap question.
   */
  explanation: Type.Union([Type.String(), Type.Null()]),
  /** Decision 56: the committed swap this build came from, or null. */
  swapped: Type.Union([SwappedSchema, Type.Null()]),
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

/* -------------------------------------------------------------------------
 * THE SWAP PREVIEW (Decision 55, contract v1.8.0)
 *
 * ONE new path, and no field on any existing response. Four properties are
 * load-bearing and easy to get wrong:
 *
 *   1. `status` vocabularies are CLOSED (PASS | UNKNOWN | FAIL for a preview,
 *      because `evaluateBuildReplacement` aggregates with FAIL beats UNKNOWN
 *      beats PASS). A client may switch on them, and it MUST render UNKNOWN as
 *      its own state - Decision 55 item 5's standing rule, applied to a field.
 *   2. `partner_role` and `reason` are NULLABLE. `partner_role` is null on the
 *      synthetic `check: "eligibility"` pair - a candidate that cannot be built
 *      at all has no partner - and `reason` is null on a PASS pair. Declaring
 *      either as a plain string would make a real answer unserializable.
 *   3. `evidence` is OPEN (`additionalProperties: true`), exactly like the
 *      catalog's `specs`: its items are rule-specific (rule, source_table,
 *      source_id, source_status, row_count, ...), so enumerating them would make
 *      every new compatibility rule a breaking API change.
 *   4. every ARITHMETIC field is nullable, and NULL means UNKNOWN - never 0. A
 *      GPU-less build has no `previous`, an ineligible candidate has no `next`,
 *      and when either is null the total, the deltas and `within_budget` are
 *      null too. A 0 would assert a fact nobody computed.
 *
 * `check` is a plain string, NOT an enum: `PAIRWISE_CHECKS` keys plus the
 * documented non-pairwise `eligibility` value. Freezing the set here would mean
 * a new Engine 1 relationship needs an API version bump.
 * ---------------------------------------------------------------------- */

/** The three-valued preview verdict. Closed, because a client switches on it. */
const CompatibilityStatusSchema = Type.Union([
  Type.Literal('PASS'),
  Type.Literal('UNKNOWN'),
  Type.Literal('FAIL'),
]);

const CompatibilityPairSchema = Type.Object({
  /** A `PAIRWISE_CHECKS` relationship key, or the non-pairwise 'eligibility'. */
  check: Type.String(),
  /** The keyed role of the check (the later-picked one in the walk). */
  role: Type.String(),
  /** The other role, or null when the check has no partner (eligibility). */
  partner_role: Type.Union([Type.String(), Type.Null()]),
  status: CompatibilityStatusSchema,
  /** The rule's own code (e.g. CPU_SOCKET_MISMATCH), or null on a PASS pair. */
  reason: Type.Union([Type.String(), Type.Null()]),
  /** Rule-specific evidence objects; declared OPEN on purpose. */
  evidence: Type.Array(Type.Object({}, { additionalProperties: true })),
}, { additionalProperties: false, $id: 'CompatibilityPair' });

const SwapPreviewParamsSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  /** A path segment, so it arrives as a string; the route parses and validates it. */
  rank: Type.String({ minLength: 1 }),
}, { additionalProperties: false, $id: 'SwapPreviewParams' });

const SwapPreviewQuerySchema = Type.Object({
  role: Type.String({ minLength: 1 }),
  product_id: Type.String({ minLength: 1 }),
  /** Required for GPU (a GPU candidate is variant-keyed); refused elsewhere. */
  product_variant_id: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false, $id: 'SwapPreviewQuery' });

const SwapPreviewResponseSchema = Type.Object({
  compatibility: Type.Object({
    status: CompatibilityStatusSchema,
    pairs: Type.Array(CompatibilityPairSchema),
    /** UNKNOWN pairs, never "not PASS". */
    unknown_pairwise_count: Type.Integer({ minimum: 0 }),
  }, { additionalProperties: false }),
  price: Type.Object({
    /** The served component's persisted price; null when the role was omitted. */
    previous: Type.Union([Type.Number(), Type.Null()]),
    /** The substituted candidate's price; null when it is ineligible. */
    next: Type.Union([Type.Number(), Type.Null()]),
    delta: Type.Union([Type.Number(), Type.Null()]),
    /** Decision 35 provenance of `next`, travelling with the number. */
    offer_class: Type.Union([Type.String(), Type.Null()]),
    /** Derived, never stored: verified only when `next` is VERIFIED. */
    price_status: Type.Union([
      Type.Literal('indicative'),
      Type.Literal('verified'),
      Type.Null(),
    ]),
  }, { additionalProperties: false }),
  budget: Type.Object({
    budget_amount: Type.Union([Type.Number(), Type.Null()]),
    /** The build's total with the swap applied; null when a price is unknown. */
    total: Type.Union([Type.Number(), Type.Null()]),
    /** `total` minus the persisted total - the same change as price.delta. */
    delta: Type.Union([Type.Number(), Type.Null()]),
    within_budget: Type.Union([Type.Boolean(), Type.Null()]),
  }, { additionalProperties: false }),
  /** The LIVE catalog digest this verdict was computed against (Decision 47). */
  catalog_version: Type.Union([Type.String(), Type.Null()]),
  /** The deploy that answered - a different question from the pass's version. */
  engine_version: Type.String(),
}, { additionalProperties: false, $id: 'SwapPreviewResponse' });

/* -------------------------------------------------------------------------
 * THE COMMITTED SWAP (Decision 56, contract v1.10.0)
 *
 * The MUTATING half of CD-8: `POST /v1/recommendations/:id/builds/:rank/swap`
 * appends ONE derived build and returns the same three facts the preview
 * answers with (`compatibility` / `price` / `budget`) PLUS the persisted link.
 *
 * Two rules are load-bearing:
 *
 *   1. `compatibility` is the WHOLE build's verdict, not the role-scoped one a
 *      preview answers: it is what was PERSISTED as
 *      `build_candidate.compatibility_status`, and a client that showed the
 *      preview's status as "the build's" would be reading a different number
 *      (Decision 56 item 3).
 *   2. `swapped` is NOT nullable here. A 201 that did not carry the commit it
 *      just made would be indistinguishable from a preview.
 *
 * `explanation` does not appear in this body at all: a swapped build has none
 * (Decision 56 item 7), and the GET that follows reports it through the build
 * object where every other build reports its own.
 * ---------------------------------------------------------------------- */

const SwapCommitParamsSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  rank: Type.String({ minLength: 1 }),
}, { additionalProperties: false, $id: 'SwapCommitParams' });

/** The body: the same three fields the preview took from the query string. */
const SwapCommitBodySchema = Type.Object({
  role: Type.String({ minLength: 1 }),
  product_id: Type.String({ minLength: 1 }),
  /** Required for GPU (variant-keyed); refused for every other role. */
  product_variant_id: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false, $id: 'SwapCommitBody' });

const SwapCommitResponseSchema = Type.Object({
  compatibility: Type.Object({
    status: CompatibilityStatusSchema,
    pairs: Type.Array(CompatibilityPairSchema),
    unknown_pairwise_count: Type.Integer({ minimum: 0 }),
  }, { additionalProperties: false }),
  price: Type.Object({
    previous: Type.Union([Type.Number(), Type.Null()]),
    next: Type.Union([Type.Number(), Type.Null()]),
    delta: Type.Union([Type.Number(), Type.Null()]),
    offer_class: Type.Union([Type.String(), Type.Null()]),
    price_status: Type.Union([
      Type.Literal('indicative'),
      Type.Literal('verified'),
      Type.Null(),
    ]),
  }, { additionalProperties: false }),
  budget: Type.Object({
    budget_amount: Type.Union([Type.Number(), Type.Null()]),
    total: Type.Union([Type.Number(), Type.Null()]),
    delta: Type.Union([Type.Number(), Type.Null()]),
    within_budget: Type.Union([Type.Boolean(), Type.Null()]),
  }, { additionalProperties: false }),
  /** The persisted commit: never null on a 201. */
  swapped: SwappedSchema,
  /** The LIVE catalog digest the verdict was judged against (Decision 47). */
  catalog_version: Type.Union([Type.String(), Type.Null()]),
  /** The deploy that answered - a different question from the pass's version. */
  engine_version: Type.String(),
}, { additionalProperties: false, $id: 'SwapCommitResponse' });

module.exports = {
  DISCLAIMER,
  CreateRecommendationBodySchema,
  BuildComponentSchema,
  BuildSchema,
  BudgetFloorSchema,
  InputEffectSchema,
  RecommendationResponseSchema,
  RecommendationParamsSchema,
  CompatibilityPairSchema,
  SwapPreviewParamsSchema,
  SwapPreviewQuerySchema,
  SwapPreviewResponseSchema,
  SwappedSchema,
  SwapCommitParamsSchema,
  SwapCommitBodySchema,
  SwapCommitResponseSchema,
};
