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
 */

const meta = require('../meta');
const {
  DISCLAIMER,
  CreateRecommendationBodySchema,
  RecommendationParamsSchema,
  RecommendationResponseSchema,
  ErrorResponseSchema,
} = require('../contracts');

const POST_RATE_LIMIT = Object.freeze({ max: 30, timeWindow: '1 minute' });
const GET_RATE_LIMIT = Object.freeze({ max: 120, timeWindow: '1 minute' });

/** An id that cannot be a uuid cannot match a row; the answer is 404, not 22P02. */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

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
        explanation: row.explanation === null || row.explanation === undefined ? '' : String(row.explanation),
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
 * @param {object} source { snapshot, reason, deployVersion, reused }
 * @returns {object} the response body
 */
function presentRecommendationResult(source) {
  const { snapshot, reason, deployVersion, reused } = source;
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
    reason: reason === undefined ? null : reason,
    disclaimer: DISCLAIMER,
    served_by: { engine_version: deployVersion },
    builds,
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
      response: { 200: RecommendationResponseSchema, 404: ErrorResponseSchema },
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
    }));
  });
}

module.exports = {
  registerRecommendationRoutes,
  presentRecommendationResult,
  groupBuilds,
  parseFloor,
  priceStatusFor,
  toNumberOrNull,
  toStringOrNull,
  resolveCatalogVersion,
  toIsoOrNull,
  UUID_RE,
  POST_RATE_LIMIT,
  GET_RATE_LIMIT,
};
