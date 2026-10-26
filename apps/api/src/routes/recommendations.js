'use strict';

/**
 * apps/api/src/routes/recommendations.js - POST + GET /v1/recommendations.
 *
 * Boundary: HTTP concerns only - status codes, the response envelope, and the
 * pure row-to-JSON presenter. The SQL lives in ../repository.js and the engine
 * call in ../engine.js; this module never issues a statement of its own and
 * never imports the engine.
 *
 * THE ONE DESIGN RULE HERE (Decision 36 item 4): POST and GET present their
 * response through the SAME function over the SAME read. POST re-reads the
 * committed rows instead of trusting the engine's in-memory result, so the two
 * endpoints cannot disagree about a persisted field - not because someone
 * remembered to keep them in step, but because there is only one code path.
 *
 * As of migration 019 that property has NO exception. `budget_floor` and the
 * per-build `engine_version` / `strategy_key` used to be pass-only facts served
 * from the engine's in-memory result on POST and as null on GET; they are now
 * columns (Decision 46), and this presenter reads them back like every other
 * field. The engine result is no longer consulted for the response at all - its
 * only remaining role is to decide the status code, via whether builds exist.
 * `served_by.engine_version` stays what it always was: the deploy that ANSWERED
 * this request, which is a different question from the deploy that RAN the pass
 * (`engine_version`).
 *
 * REQUEST DEDUPE (Platform P1 Sprint 5, Decision 47). A POST whose request
 * identity, catalog version and engine version match an existing COMMITTED pass
 * is answered from that pass's persisted rows instead of running a second one:
 * 200 with `reused: true` and the ORIGINAL `id`. It does not cache a body - it
 * re-reads through the same statement GET uses, so a reused reply is the same
 * code path with the same guarantees. Two facts are deliberately NOT reused: a
 * pass that never committed (its `reason` is not persisted, so serving it would
 * mean inventing one - see `SELECT_REUSABLE_QUERY_SQL` in ../repository.js), and
 * a pass from a different deploy, which would make the answer stale by
 * construction.
 *
 * `reused` is a REQUEST fact, like `served_by.engine_version`, not a property of
 * the stored resource: it is TRUE only on a POST that found an equivalent pass,
 * and FALSE on every GET and on every POST that ran its own pass. Nothing in
 * the persisted rows could answer it, which is exactly why it is not derivable
 * from them.
 *
 * INPUT EFFECTS (Decision 52). `input_effects` IS derived from the persisted
 * rows by `../inputs.js` - the query's stored `use_case` / `resolution` /
 * `priority`, the configuration of the model the row PINNED, and the builds'
 * `strategy_key`s - so a GET revisit reports the same thing the original POST
 * did. The only injected fact is the engine's resolution multiplier, forwarded
 * from `app.engine` so the served arithmetic and retention's arithmetic have one
 * owner. A pass whose model row is gone reports UNKNOWN; it never borrows the
 * currently active model's configuration.
 *
 * Status codes:
 *   201  THIS request created a pass that produced at least one build
 *   200  a reused pass (`reused: true`), or a valid pass that produced ZERO
 *        builds (an under-budget floor is a legitimate outcome, not an error) -
 *        and the same 200 for EMPTY_CANDIDATE_POOL, which additionally carries
 *        `reason`
 *   404  GET of an unknown query id (the query row is the resource; a malformed
 *        id can match no row, so it is a 404 rather than a 500)
 *   422  schema validation, or a value outside the advertised vocabulary
 *   503  no active scoring model
 *
 * SWAP PREVIEW (Decision 55, contract v1.8.0). `GET
 * /v1/recommendations/:id/builds/:rank/swap-preview?role=&product_id=[&variant=]`
 * is the ONE read that is not about the persisted pass: it answers what the
 * build would become if one role held another product. Everything it claims
 * comes from elsewhere - the verdict from `assembly.evaluateBuildReplacement`,
 * the price from Stage 1's carrier, the eligibility from Engine 2D - and this
 * module only adds the envelope, the arithmetic a client should not re-derive,
 * and the status codes. It persists NOTHING, so it serves `Cache-Control:
 * no-store`: the verdict is a function of the live catalog AND the persisted
 * build, and a cached copy could outlive either (Decision 55 item 7).
 *
 * Its rate limit is POST's, not GET's: a preview pays roughly a pass's read half
 * (Decision 55 item 4 takes the full candidate pool on purpose), so it is a
 * costly GET rather than a cheap one.
 *
 * SWAP COMMIT (Decision 56, contract v1.10.0). `POST
 * /v1/recommendations/:id/builds/:rank/swap` is the mutation Decision 55 item 9
 * left open, and it APPENDS: one `build_candidate` plus its components plus one
 * `recommendation_swap` row, in one engine-owned transaction. No row of the pass
 * is updated, so `rank`, `strategy_key`, the dedupe key and the presets keep
 * describing the assembly that produced them, and GET serves the derived build
 * in place of the pass's own for that rank (`swapped` says so). A FAIL, an
 * ineligible candidate, or a role the build does not have is a 409 and writes
 * nothing; a second commit on the same build is a 409 too, because the
 * alternatives are an UPDATE or a chain the wire cannot address.
 */

const inputs = require('../inputs');
const meta = require('../meta');
const {
  DISCLAIMER,
  CreateRecommendationBodySchema,
  RecommendationParamsSchema,
  RecommendationResponseSchema,
  SwapPreviewParamsSchema,
  SwapPreviewQuerySchema,
  SwapPreviewResponseSchema,
  SwapCommitParamsSchema,
  SwapCommitBodySchema,
  SwapCommitResponseSchema,
  ErrorResponseSchema,
} = require('../contracts');

const POST_RATE_LIMIT = Object.freeze({ max: 30, timeWindow: '1 minute' });
const GET_RATE_LIMIT = Object.freeze({ max: 120, timeWindow: '1 minute' });
/**
 * A preview costs ~a pass's read half, so it is priced like a POST. The single
 * most consequential line in the Decision 55 plan: the full pool is what makes
 * the answer truthful, and this is what keeps it affordable.
 */
const PREVIEW_RATE_LIMIT = Object.freeze({ max: 30, timeWindow: '1 minute' });

/** An id that cannot be a uuid cannot match a row; the answer is 404, not 22P02. */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** A rank is a positive integer in the path; `0`, `-1` and `1.5` are 422. */
const RANK_RE = /^[1-9][0-9]*$/;

/** The one role whose candidates are variant-keyed (Engine 2B/2C identity). */
const GPU_ROLE = 'GPU';

/** pg returns NUMERIC as a string; a missing value stays null, never 0. */
function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * A TEXT column as a string, or null when it was not recorded. A non-string can
 * only come from a hand-built fixture, and the response schema declares this
 * field a nullable string - so passing a surprise through would turn a fixture
 * mistake into a 500 instead of a null.
 */
function toStringOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'string' ? value : null;
}

/**
 * Read the catalog version of THIS moment, or null when it cannot be computed.
 *
 * Degrading to null is a POLICY decision made here, not in the engine: the
 * engine's `catalogVersion` throws when the database cannot produce a digest,
 * and a digest is a dedupe key, not part of the answer. Refusing to serve a
 * recommendation because a cache key was unavailable would break the product to
 * protect an optimization, and the beta's whole premise is that it always
 * answers (the same reasoning as `API_ENGINE_OPTIONS` in ../engine.js).
 *
 * NULL is the honest value and the SAFE one, never a guessed placeholder: the
 * row records "not recorded", and the dedupe cannot match it (Decision 47 item
 * 10 - an unknown version is a MISS, never a match), so the blast radius of a
 * broken digest is "reuse is off", not "a stale answer". The failure is logged
 * at warn, so it is visible rather than silent.
 *
 * The function's EXISTENCE is checked outside the try: a missing collaborator is
 * a wiring error that must be loud, and a catch here would swallow it into the
 * same null as a database failure.
 */
async function resolveCatalogVersion(app, request, client) {
  if (typeof app.engine.catalogVersion !== 'function') {
    throw new Error('app.engine.catalogVersion is not a function - the engine boundary is not wired');
  }
  try {
    return await app.engine.catalogVersion(client);
  } catch (error) {
    request.log.warn({ err: error }, 'catalog version unavailable - request reuse is disabled for this pass');
    return null;
  }
}

/** Normalize a timestamp (Date or string) to an ISO string, or null. */
function toIsoOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * The persisted Decision 27 diagnostic, or null when none was recorded.
 *
 * pg parses a `jsonb` column into a JS value already, so the ordinary path here
 * is an OBJECT and the string branch exists only for safety. Calling
 * JSON.parse unconditionally - the obvious reading of "read a JSON column" -
 * would throw `Unexpected token o` on the object the driver actually returns,
 * and a fixture that stored the floor as a JSON string would have hidden that
 * behind a passing test.
 */
function parseFloor(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    if (value.length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(value);
      return parsed === null ? null : parsed;
    } catch (_error) {
      return null;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return null;
}

/**
 * Group the flattened rows into builds, preserving the statement's ORDER BY.
 * A build_candidate with no component rows still appears (its `components` is
 * empty) because the candidate row is the unit of existence.
 *
 * `engine_version` and `strategy_key` are per-RESULT-row facts, so they are
 * read once per build from its first row (every row of one build shares the
 * result row). NULL is passed through untouched: a pre-019 row genuinely does
 * not record which deploy produced it.
 */
function groupBuilds(rows) {
  const order = [];
  const byCandidate = new Map();
  for (const row of rows) {
    const key = row.build_candidate_id;
    let build = byCandidate.get(key);
    if (build === undefined) {
      build = {
        rank: toNumberOrNull(row.rank),
        engine_version: row.engine_version === undefined ? null : row.engine_version,
        strategy_key: row.strategy_key === undefined ? null : row.strategy_key,
        total_price: toNumberOrNull(row.total_price),
        build_score: toNumberOrNull(row.build_score),
        compatibility_status: row.compatibility_status === undefined ? null : row.compatibility_status,
        // NULL means "no engine explanation for this build" - which is exactly
        // what a swapped build has (Decision 56 item 7): the stored text
        // describes the parts it no longer carries.
        explanation: row.explanation === null || row.explanation === undefined ? null : String(row.explanation),
        // Decision 56: what this build's swap replaced, or null. The effective
        // build IS the swapped one when this is set - the read path joins it.
        swapped: row.swapped_role === null || row.swapped_role === undefined
          ? null
          : {
            role: row.swapped_role,
            committed_at: toIsoOrNull(row.swapped_committed_at),
            engine_version: row.swapped_engine_version === undefined ? null : row.swapped_engine_version,
          },
        created_at: row.result_created_at,
        components: [],
      };
      byCandidate.set(key, build);
      order.push(build);
    }
    if (row.role !== null && row.role !== undefined) {
      build.components.push({
        role: row.role,
        product_id: row.product_id === undefined ? null : row.product_id,
        name: row.product_name === null || row.product_name === undefined ? '' : String(row.product_name),
        slug: row.product_slug === undefined ? null : row.product_slug,
        variant: row.variant_sku === undefined ? null : row.variant_sku,
        price_used: toNumberOrNull(row.selected_price),
        offer_class: row.offer_class === null || row.offer_class === undefined ? 'SEED_UNVERIFIED' : String(row.offer_class),
        store_offer_id: row.store_offer_id === undefined ? null : row.store_offer_id,
      });
    }
  }
  return order;
}

/**
 * 'verified' only when EVERY component is VERIFIED; anything else (including a
 * missing or unrecognized class) is 'indicative'. Fail-safe by direction: an
 * unknown provenance must never be advertised as verified.
 */
function priceStatusFor(components) {
  for (const component of components) {
    if (component.offer_class !== 'VERIFIED') {
      return 'indicative';
    }
  }
  return 'verified';
}

/**
 * Present one persisted result as the wire contract. Pure, and fed ONLY by
 * persisted rows - the engine's in-memory result is not a parameter, which is
 * what makes the two verbs agree by construction rather than by discipline.
 * The two exceptions are named as such: `reason` (which the engine's error is
 * the only source of, and which is therefore null for any pass that did not
 * just run) and `reused` (a request fact, `false` on every GET).
 *
 * @param {object} source { snapshot, reason, deployVersion, reused,
 *        resolutionMultiplier }
 * @returns {object} the response body
 */
function presentRecommendationResult(source) {
  const { snapshot, reason, deployVersion, reused, resolutionMultiplier } = source;
  const query = snapshot.query || {};
  const grouped = groupBuilds(snapshot.rows || []);
  // The top-level engine_version is the one recorded on the persisted result
  // rows. Every rank of a single pass carries the same value (full-run derives
  // ONE engineVersion and threads it to every rank), so the first row in
  // statement order speaks for all of them. A zero-build pass persisted no
  // result row and therefore records no pass engine version: null, which is why
  // `served_by.engine_version` exists as a separate, always-answered field.
  const persistedEngineVersion = grouped.length > 0 ? grouped[0].engine_version : null;

  let generatedAt = toIsoOrNull(query.created_at);
  const builds = grouped.map((build) => {
    const buildIso = toIsoOrNull(build.created_at);
    if (buildIso !== null && (generatedAt === null || buildIso > generatedAt)) {
      generatedAt = buildIso;
    }
    return {
      rank: build.rank,
      // Decision 46 provenance, read from THIS build's result row. Omitting
      // either here is a 500, not a silent null: the response schema declares
      // them, and fast-json-stringify refuses to serialize a declared property
      // that the payload does not carry.
      engine_version: build.engine_version,
      strategy_key: build.strategy_key,
      total_price: build.total_price,
      build_score: build.build_score,
      compatibility_status: build.compatibility_status,
      explanation: build.explanation,
      swapped: build.swapped,
      price_status: priceStatusFor(build.components),
      components: build.components,
    };
  });

  return {
    id: query.id === undefined ? null : query.id,
    budget_amount: toNumberOrNull(query.budget_amount),
    currency: query.currency === undefined ? null : query.currency,
    use_case: query.use_case === undefined ? null : query.use_case,
    generated_at: generatedAt,
    // Read back from recommendation_query, never recomputed here: the API has no
    // Stage 1..11 to derive a floor from, and Decision 27 forbids inventing one.
    budget_floor: parseFloor(query.budget_floor),
    engine_version: persistedEngineVersion,
    // The catalog state this pass ran against (Decision 47): a column since
    // migration 021, NULL for a pre-021 row - recorded as unknown, never
    // derived. It is served because a client that stores an id is making a
    // durable reference, and Decision 47 item 17 requires the reference to
    // carry the catalog it belongs to. NOT part of the dedupe key's request
    // half: it says which catalog produced the answer, not which was asked for.
    catalog_version: toStringOrNull(query.catalog_version),
    // A REQUEST fact, like served_by below, and the one field on this payload
    // that no persisted row could answer: true only when THIS POST found an
    // equivalent committed pass and served it instead of running one.
    reused: reused === true,
    // Decision 52: what each accepted input changed in THIS pass, derived from
    // the rows above. Always all three entries - an omitted optional input is
    // NO_EFFECT/NOT_PROVIDED, never a missing field a client has to interpret.
    input_effects: inputs.inputEffects({
      configuration: query.configuration,
      useCase: query.use_case,
      resolution: query.resolution,
      priority: query.priority,
      strategyKeys: grouped.map((build) => build.strategy_key),
      resolutionMultiplier,
    }),
    reason: reason === undefined ? null : reason,
    disclaimer: DISCLAIMER,
    served_by: { engine_version: deployVersion },
    builds,
  };
}

/**
 * Money arithmetic at the currency's own precision.
 *
 * `selected_price` and `total_price` are NUMERIC(._,2) strings, but subtraction
 * in JS floats does not respect that: a 1999.10 -> 1999.30 delta is
 * 0.1999999999998181 without this. Two decimals is what the database stores, so
 * two decimals is what the wire may claim - and NULL passes through untouched,
 * because an unknown operand must never become 0.
 */
function toMoneyOrNull(value) {
  if (value === null) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

/**
 * Present one preview as the wire contract. Pure, and fed by persisted rows
 * (the build, for `previous` / total / budget) plus the ENGINE's answer (the
 * verdict and the substituted price).
 *
 * The arithmetic here is the only thing this module owns, and it is arithmetic
 * rather than policy: a client displaying "+1201 MAD, still within budget"
 * should not have to re-derive it from two prices and a total, and should not be
 * able to derive it DIFFERENTLY from the API.
 *
 * Every field is null - never 0 - when an operand is unknown:
 *   - the role was omitted from the build (the GPU-less path): `previous` is
 *     null, so `delta`, `total`, `budget.delta` and `within_budget` are null;
 *   - the candidate is ineligible: `next` is null, with the same consequences.
 * `price_status` is derived from `next`'s provenance alone (one number is being
 * shown, so "every component verified" would be the wrong question), and is
 * null - not 'indicative' - when there is no number to describe.
 *
 * @param {object} source { build, preview, role, deployVersion, catalogVersion }
 * @returns {object} the SwapPreviewResponse body
 */
function presentSwapPreview(source) {
  const { build, preview, role, deployVersion, catalogVersion } = source;

  let previous = null;
  for (const component of build.components) {
    if (component.role === role) {
      previous = toNumberOrNull(component.selected_price);
      break;
    }
  }

  const next = preview.price === null ? null : toNumberOrNull(preview.price.next);
  const offerClass = preview.price === null || preview.price.offer_class === null
    ? null
    : preview.price.offer_class;

  const persistedTotal = toNumberOrNull(build.total_price);
  const budgetAmount = toNumberOrNull(build.budget_amount);

  const delta = previous === null || next === null ? null : toMoneyOrNull(next - previous);
  const total = previous === null || next === null || persistedTotal === null
    ? null
    : toMoneyOrNull(persistedTotal - previous + next);
  const budgetDelta = total === null ? null : toMoneyOrNull(total - persistedTotal);
  const withinBudget = total === null || budgetAmount === null ? null : total <= budgetAmount;

  return {
    compatibility: {
      status: preview.compatibility.status,
      pairs: preview.compatibility.pairs.map((pair) => ({
        check: pair.check,
        role: pair.role,
        // Nullable on purpose: the synthetic `eligibility` pair has no partner.
        partner_role: pair.partner_role === undefined ? null : pair.partner_role,
        status: pair.status,
        reason: pair.reason === undefined ? null : pair.reason,
        // Open, rule-specific objects - passed through, never narrowed.
        evidence: Array.isArray(pair.evidence) ? pair.evidence : [],
      })),
      unknown_pairwise_count: preview.compatibility.unknown_pairwise_count,
    },
    price: {
      previous,
      next,
      delta,
      offer_class: offerClass,
      // Derived, never stored - and reusing the route's ONE derivation, so a
      // preview and a served build cannot classify a price differently.
      price_status: next === null ? null : priceStatusFor([{ offer_class: offerClass }]),
    },
    budget: {
      budget_amount: budgetAmount,
      total,
      delta: budgetDelta,
      within_budget: withinBudget,
    },
    // The LIVE digest, not the pass's recorded one: the verdict is a function of
    // the catalog as it is NOW, so labelling it with the pass's catalog would be
    // a false statement (Decision 55 item 7). NULL is the honest degradation
    // when the digest is unavailable (resolveCatalogVersion).
    catalog_version: catalogVersion,
    engine_version: deployVersion,
  };
}

/** 422 body for a value outside the advertised vocabulary. */
function fieldError(field, message) {
  return {
    error: 'VALIDATION_ERROR',
    message: 'Request validation failed',
    details: [{ field, message }],
  };
}

function scoringUnavailable() {
  return {
    error: 'SCORING_MODEL_UNAVAILABLE',
    message: 'No active scoring model is configured',
  };
}

function registerRecommendationRoutes(app) {
  app.post('/v1/recommendations', {
    config: { rateLimit: POST_RATE_LIMIT },
    schema: {
      tags: ['recommendations'],
      summary: 'Create a recommendation (one full engine pass)',
      body: CreateRecommendationBodySchema,
      response: {
        200: RecommendationResponseSchema,
        201: RecommendationResponseSchema,
        422: ErrorResponseSchema,
        429: ErrorResponseSchema,
        500: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = request.body;

    const model = await app.repo.selectActiveScoringModel(app.pool);
    if (model === null) {
      return reply.code(503).send(scoringUnavailable());
    }

    // The ACTIVE model owns the use-case vocabulary (Decision 37), and the
    // derivation lives behind engine.js so the HTTP layer never imports the
    // engine itself. NULL is UNKNOWN, never an empty list: a model with no
    // usable vocabulary is UNAVAILABLE, not a 422 that blames the request.
    const useCases = app.engine.useCaseVocabulary(model.configuration);
    if (useCases === null) {
      return reply.code(503).send(scoringUnavailable());
    }

    // Vocabulary checks the schema cannot express: the accepted use cases are
    // a property of the ACTIVE MODEL, not of the request.
    if (!meta.isAllowedUseCase(body.use_case, useCases)) {
      return reply.code(422).send(fieldError(
        'use_case',
        'use_case must be one of: ' + meta.useCaseValues(useCases).join(', ')
      ));
    }
    if (!meta.isAllowedCurrency(body.currency)) {
      return reply.code(422).send(fieldError('currency', 'currency must be one of: ' + meta.CURRENCIES.map((c) => c.value).join(', ')));
    }
    if (body.resolution !== undefined && !meta.isAllowedResolution(body.resolution)) {
      return reply.code(422).send(fieldError('resolution', 'resolution is not a known value'));
    }
    if (body.priority !== undefined && !meta.isAllowedPriority(body.priority)) {
      return reply.code(422).send(fieldError('priority', 'priority is not a known value'));
    }

    const client = await app.pool.connect();
    try {
      // 1. The catalog version of THIS moment (Decision 47). Computed before
      //    anything is written, because it is both a component of the dedupe key
      //    and a fact the query row must record so a LATER request can compare
      //    against it.
      const catalogVersion = await resolveCatalogVersion(app, request, client);

      // 2. Has this request already been answered? The key is the request
      //    identity plus the catalog and engine versions - never the profile's
      //    UUID name, which is per-request by construction and identifies
      //    nothing (PLAN_PLATFORM_P1.md Sprint 5).
      const reusable = await app.repo.findReusableQuery(client, {
        scoringModelId: model.id,
        budgetAmount: body.budget_amount,
        currency: body.currency,
        useCase: body.use_case,
        resolution: body.resolution,
        priority: body.priority,
        catalogVersion,
        engineVersion: app.engineVersion,
      });

      let queryId;
      let reused = false;
      let reason = null;

      if (reusable !== null) {
        // The hit path runs NO engine pass and writes NOTHING. It still reads,
        // through the same statement every GET uses, so a reused reply cannot
        // differ from a first reply about any persisted field - the read path is
        // not bypassed on the cheap route (Decision 36 item 4).
        queryId = reusable.queryId;
        reused = true;
      } else {
        const created = await app.repo.createRecommendationQuery(client, {
          scoringModelId: model.id,
          budgetAmount: body.budget_amount,
          currency: body.currency,
          useCase: body.use_case,
          resolution: body.resolution,
          priority: body.priority,
          catalogVersion,
        });
        queryId = created.queryId;

        try {
          // `app.engineVersion` is handed to the engine so the pass records which
          // deploy produced it (Decision 46). The engine result is deliberately
          // NOT read here: every field of the response comes from the re-read
          // below, which is what keeps POST and GET on one code path.
          await app.engine.runFullRun(client, queryId, app.engineVersion);
        } catch (error) {
          if (error && error.code === 'EMPTY_CANDIDATE_POOL') {
            reason = 'EMPTY_CANDIDATE_POOL';
          } else if (error && error.code === 'SCORING_MODEL_UNAVAILABLE') {
            request.log.warn({ err: error }, 'pinned scoring model became unavailable mid-pass');
            return reply.code(503).send(scoringUnavailable());
          } else {
            throw error;
          }
        }
      }

      const snapshot = await app.repo.readRecommendationResult(client, queryId);
      if (!snapshot.found) {
        throw new Error('the query row disappeared after it was committed');
      }

      const payload = presentRecommendationResult({
        snapshot,
        reason,
        deployVersion: app.engineVersion,
        reused,
        resolutionMultiplier: app.engine.resolutionMultiplier,
      });
      // 201 means THIS request created a pass that produced builds. A reuse
      // created nothing to be created - it is a read - and a zero-build pass is
      // a valid answer either way (Decision 17.2), so both are served as 200.
      return reply.code(reused || payload.builds.length === 0 ? 200 : 201).send(payload);
    } finally {
      client.release();
    }
  });

  app.get('/v1/recommendations/:id', {
    config: { rateLimit: GET_RATE_LIMIT },
    schema: {
      tags: ['recommendations'],
      summary: 'Read a persisted recommendation',
      params: RecommendationParamsSchema,
      response: {
        200: RecommendationResponseSchema,
        404: ErrorResponseSchema,
        429: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const id = request.params.id;
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'No recommendation with that id' });
    }

    const snapshot = await app.repo.readRecommendationResult(app.pool, id);
    if (!snapshot.found) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'No recommendation with that id' });
    }

    return reply.code(200).send(presentRecommendationResult({
      snapshot,
      // GET never re-runs the engine and never recomputes a floor (Decision 36
      // item 4). It no longer needs to declare anything null either: the
      // pass facts are columns now, so the same presenter reads them back.
      reason: null,
      deployVersion: app.engineVersion,
      // Nothing was reused by a read: `reused` describes a POST that found an
      // equivalent pass, which is a fact about that request and not about the
      // resource being fetched.
      reused: false,
      // Same injected engine fact as POST, so a revisit derives the identical
      // `input_effects` from the same rows.
      resolutionMultiplier: app.engine.resolutionMultiplier,
    }));
  });

  /**
   * Decision 55 item 2: ONE read-only hypothetical swap.
   *
   * Status codes, and why each is what it is:
   *   200  a verdict was reached - INCLUDING FAIL and UNKNOWN. A FAIL is a
   *        RESULT, not an error (item 5): the caller asked what would happen and
   *        the answer is "it would not fit".
   *   404  no build at that rank (unknown query, unknown rank, or a candidate
   *        with no component rows), or a build that can no longer be
   *        reconstructed from the live catalog (`BUILD_NOT_EVALUABLE`, naming the
   *        role) - a distinct code, because "no such build" and "this build is
   *        no longer evaluable" are different answers.
   *   422  schema validation, a malformed rank/product id, a role outside
   *        EXPANSION_ORDER, or a variant where the role does not accept one.
   *   429  the preview's own 30/min budget.
   *   500  a genuine failure; the generic envelope, with a request id.
   */
  app.get('/v1/recommendations/:id/builds/:rank/swap-preview', {
    config: { rateLimit: PREVIEW_RATE_LIMIT },
    schema: {
      tags: ['recommendations'],
      summary: 'Preview one component swap against a persisted build (read-only)',
      params: SwapPreviewParamsSchema,
      querystring: SwapPreviewQuerySchema,
      response: {
        200: SwapPreviewResponseSchema,
        404: ErrorResponseSchema,
        422: ErrorResponseSchema,
        429: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const id = request.params.id;
    // A malformed id can match no row, so it is the same 404 a GET of it is - not
    // a 22P02 and not a 500.
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'No recommendation with that id' });
    }

    // A rank PRESENT but not a positive integer (`0`, `-1`, `1.5`, `abc`) is a
    // 422: a pass can only ever have written ranks 1..n. A rank segment MISSING
    // altogether (`/builds/swap-preview`) does not match this route at all, so
    // Fastify answers 404 before this handler runs - which is the other half of
    // Decision 55's "missing rank is a 404".
    const rankRaw = request.params.rank;
    if (typeof rankRaw !== 'string' || !RANK_RE.test(rankRaw)) {
      return reply.code(422).send(fieldError('rank', 'rank must be a positive integer'));
    }
    const rank = Number(rankRaw);
    if (!Number.isSafeInteger(rank)) {
      return reply.code(422).send(fieldError('rank', 'rank must be a positive integer'));
    }

    // The vocabulary is the ENGINE's (Decision 55 item 2). Restating the eight
    // roles here would let the API accept a swap assembly has no table for.
    const roles = app.engine.swapPreviewRoles();
    const role = request.query.role;
    if (!roles.includes(role)) {
      return reply.code(422).send(fieldError('role', 'role must be one of: ' + roles.join(', ')));
    }

    const productId = request.query.product_id;
    if (!UUID_RE.test(productId)) {
      return reply.code(422).send(fieldError('product_id', 'product_id must be a uuid'));
    }

    // Variant identity (Engine 2B/2C): a GPU candidate is variant-keyed, so a
    // GPU swap MUST name its variant; every other role MUST NOT.
    const variant = request.query.product_variant_id;
    if (role === GPU_ROLE) {
      if (variant === undefined) {
        return reply.code(422).send(fieldError(
          'product_variant_id',
          'a GPU swap must name product_variant_id: GPU candidates are variant-keyed'
        ));
      }
      if (!UUID_RE.test(variant)) {
        return reply.code(422).send(fieldError('product_variant_id', 'product_variant_id must be a uuid'));
      }
    } else if (variant !== undefined) {
      return reply.code(422).send(fieldError(
        'product_variant_id',
        'product_variant_id is only accepted for role GPU'
      ));
    }

    // The build must EXIST before anything is evaluated, and the read is one
    // statement (Decision 55's rank resolution: through recommendation_result,
    // with a candidate and at least one component).
    const snapshot = await app.repo.readBuildForSwap(app.pool, id, rank);
    if (!snapshot.found) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: 'No build at that rank for this recommendation',
      });
    }

    const client = await app.pool.connect();
    try {
      // The LIVE catalog version, read OUTSIDE the engine's snapshot on purpose:
      // perfect atomicity with a cache key is not worth a second error policy,
      // and this reuses the derivation POST already relies on.
      const catalogVersion = await resolveCatalogVersion(app, request, client);

      let preview;
      try {
        preview = await app.engine.evaluateSwapPreviewSnapshot(
          client,
          app.engine.swapPreviewArgs({
            queryId: id,
            role,
            productId,
            productVariantId: variant,
            // IDENTITIES only (role, product, variant). The engine re-derives
            // every verdict from the live catalog; handing it persisted
            // statuses would let it judge a swap against yesterday's
            // relationships.
            buildComponents: snapshot.build.components,
          })
        );
      } catch (error) {
        // The live catalog has no eligible offer for ANY role, so there is
        // nothing to preview against. That is the same class of answer as a
        // build that no longer reconstructs - not an internal failure.
        if (error && error.code === 'EMPTY_CANDIDATE_POOL') {
          return reply.code(404).send({
            error: 'BUILD_NOT_EVALUABLE',
            message: 'This build can no longer be evaluated: the live catalog has no eligible offer',
          });
        }
        throw error;
      }

      if (preview.evaluable !== true) {
        return reply.code(404).send({
          error: 'BUILD_NOT_EVALUABLE',
          message: 'This build can no longer be evaluated: the persisted '
            + String(preview.blocked_role)
            + ' pick is not a candidate in the live catalog',
        });
      }

      return reply
        .header('Cache-Control', 'no-store')
        .code(200)
        .send(presentSwapPreview({
          build: snapshot.build,
          preview,
          role,
          deployVersion: app.engineVersion,
          catalogVersion,
        }));
    } finally {
      client.release();
    }
  });

  /**
   * Decision 56: commit ONE swap against a persisted build.
   *
   * Status codes, and why each is what it is:
   *   201  a derived build was APPENDED. `swapped` names what it replaced, and
   *        `compatibility` is the WHOLE build's verdict - the one persisted.
   *   404  no build at that rank (unknown query, unknown rank, no component
   *        rows), or a build that no longer reconstructs from the live catalog
   *        (`BUILD_NOT_EVALUABLE`, naming the role).
   *   409  `SWAP_ALREADY_COMMITTED` (one swap per build, item 6),
   *        `SWAP_ROLE_ABSENT` (the build has no such role to replace),
   *        `SWAP_NOT_COMMITTABLE` (the engine's verdict is FAIL, or the candidate
   *        is not a candidate / has no eligible offer). Nothing is written.
   *   422  schema validation, a malformed rank/product id, a role outside
   *        EXPANSION_ORDER, or a variant where the role does not accept one.
   *   429  the commit's own 30/min budget (it pays a preview's read half).
   *   500  a genuine failure; the generic envelope, with a request id.
   */
  app.post('/v1/recommendations/:id/builds/:rank/swap', {
    config: { rateLimit: PREVIEW_RATE_LIMIT },
    schema: {
      tags: ['recommendations'],
      summary: 'Commit one component swap: appends a derived build (never edits the pass)',
      params: SwapCommitParamsSchema,
      body: SwapCommitBodySchema,
      response: {
        201: SwapCommitResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
        422: ErrorResponseSchema,
        429: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const id = request.params.id;
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'No recommendation with that id' });
    }

    const rankRaw = request.params.rank;
    if (typeof rankRaw !== 'string' || !RANK_RE.test(rankRaw)) {
      return reply.code(422).send(fieldError('rank', 'rank must be a positive integer'));
    }
    const rank = Number(rankRaw);
    if (!Number.isSafeInteger(rank)) {
      return reply.code(422).send(fieldError('rank', 'rank must be a positive integer'));
    }

    const roles = app.engine.swapPreviewRoles();
    const role = request.body.role;
    if (!roles.includes(role)) {
      return reply.code(422).send(fieldError('role', 'role must be one of: ' + roles.join(', ')));
    }

    const productId = request.body.product_id;
    if (!UUID_RE.test(productId)) {
      return reply.code(422).send(fieldError('product_id', 'product_id must be a uuid'));
    }

    const variant = request.body.product_variant_id;
    if (role === GPU_ROLE) {
      if (variant === undefined) {
        return reply.code(422).send(fieldError(
          'product_variant_id',
          'a GPU swap must name product_variant_id: GPU candidates are variant-keyed'
        ));
      }
      if (!UUID_RE.test(variant)) {
        return reply.code(422).send(fieldError('product_variant_id', 'product_variant_id must be a uuid'));
      }
    } else if (variant !== undefined) {
      return reply.code(422).send(fieldError(
        'product_variant_id',
        'product_variant_id is only accepted for role GPU'
      ));
    }

    const snapshot = await app.repo.readBuildForSwap(app.pool, id, rank);
    if (!snapshot.found) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: 'No build at that rank for this recommendation',
      });
    }

    // Decision 56 item 6: ONE committed swap per build. Asked BEFORE the
    // engine composes anything, so a second attempt costs one statement rather
    // than a pass's read half. The UNIQUE index on the column is the race guard
    // - two concurrent commits can both read "none" and only one INSERT wins.
    const existing = await app.engine.readCommittedSwap(app.pool, snapshot.build.result_id);
    if (existing.found) {
      return reply.code(409).send({
        error: 'SWAP_ALREADY_COMMITTED',
        message: 'This build already carries a swap; a build holds one committed replacement '
          + '(Decision 56 item 6)',
      });
    }

    const client = await app.pool.connect();
    try {
      // The LIVE catalog version, read OUTSIDE the snapshot for the same reason
      // the preview reads it there, then STORED: the swap row names the catalog
      // its verdict was judged against (Decision 47/56).
      const catalogVersion = await resolveCatalogVersion(app, request, client);

      let committed;
      try {
        committed = await app.engine.commitSwapInTransaction(
          client,
          app.engine.commitSwapArgs({
            queryId: id,
            sourceResultId: snapshot.build.result_id,
            role,
            productId,
            productVariantId: variant,
            buildComponents: snapshot.build.components,
            persistedTotalPrice: toNumberOrNull(snapshot.build.total_price),
            catalogVersion,
            engineVersion: app.engineVersion,
          })
        );
      } catch (error) {
        if (error && error.code === 'EMPTY_CANDIDATE_POOL') {
          return reply.code(404).send({
            error: 'BUILD_NOT_EVALUABLE',
            message: 'This build can no longer be evaluated: the live catalog has no eligible offer',
          });
        }
        // Two concurrent commits on one build: the loser's UNIQUE violation is
        // the same answer the pre-check gives a sequential second attempt.
        if (error && error.code === '23505') {
          return reply.code(409).send({
            error: 'SWAP_ALREADY_COMMITTED',
            message: 'This build already carries a swap; a build holds one committed replacement '
              + '(Decision 56 item 6)',
          });
        }
        throw error;
      }

      if (committed.committed !== true) {
        return refuseSwapCommit(reply, committed);
      }

      return reply
        .header('Cache-Control', 'no-store')
        .code(201)
        .send(presentSwapCommit({
          build: snapshot.build,
          committed,
          role,
          deployVersion: app.engineVersion,
          catalogVersion,
        }));
    } finally {
      client.release();
    }
  });
}

/**
 * Map one engine refusal onto its status code and its message.
 *
 * The reasons stay DISTINGUISHABLE on the wire because the reader's next action
 * differs for each: "pick another part" (incompatible), "pick a part that has a
 * price" (ineligible), "this build cannot be evaluated at all" (not evaluable),
 * and "there is nothing to replace in that slot" (role absent).
 *
 * @param {object} reply the Fastify reply
 * @param {object} committed the engine's refusal envelope
 * @returns {object} the reply
 */
function refuseSwapCommit(reply, committed) {
  if (committed.reason === 'NOT_EVALUABLE') {
    return reply.code(404).send({
      error: 'BUILD_NOT_EVALUABLE',
      message: 'This build can no longer be evaluated: the persisted '
        + String(committed.blocked_role)
        + ' pick is not a candidate in the live catalog',
    });
  }
  if (committed.reason === 'ROLE_ABSENT') {
    return reply.code(409).send({
      error: 'SWAP_ROLE_ABSENT',
      message: 'This build has no ' + String(committed.role) + ' to replace',
    });
  }
  if (committed.reason === 'INELIGIBLE') {
    const reason = committed.eligibility === null ? 'INCOMPATIBLE' : committed.eligibility.reason;
    return reply.code(409).send({
      error: 'SWAP_NOT_COMMITTABLE',
      message: 'The replacement cannot be committed: ' + String(reason),
    });
  }
  return reply.code(409).send({
    error: 'SWAP_NOT_COMMITTABLE',
    message: 'The replacement would not fit this build',
  });
}

/**
 * Present one committed swap as the wire contract.
 *
 * It is the PREVIEW's presenter plus the persisted link, on purpose: the three
 * facts a client shows (compatibility, price, budget) are the same three, and
 * re-deriving the money here would let the number the reader approved and the
 * number the API reports diverge. The ONLY difference is `swapped`, which is
 * never null on a 201 - and `compatibility`, which is the WHOLE build's verdict
 * (Decision 56 item 3) because that is what was persisted.
 *
 * @param {object} source { build, committed, role, deployVersion, catalogVersion }
 * @returns {object} the SwapCommitResponse body
 */
function presentSwapCommit(source) {
  const { build, committed, role, deployVersion, catalogVersion } = source;
  const body = presentSwapPreview({
    build,
    preview: { compatibility: committed.compatibility, price: committed.price },
    role,
    deployVersion,
    catalogVersion,
  });
  return Object.assign({}, body, {
    swapped: {
      role,
      committed_at: toIsoOrNull(committed.swap.created_at),
      engine_version: toStringOrNull(committed.swap.engine_version),
    },
  });
}

module.exports = {
  registerRecommendationRoutes,
  presentRecommendationResult,
  presentSwapPreview,
  presentSwapCommit,
  groupBuilds,
  parseFloor,
  priceStatusFor,
  toNumberOrNull,
  toStringOrNull,
  resolveCatalogVersion,
  toIsoOrNull,
  UUID_RE,
  RANK_RE,
  POST_RATE_LIMIT,
  GET_RATE_LIMIT,
  PREVIEW_RATE_LIMIT,
};
