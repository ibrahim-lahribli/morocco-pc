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
 * `budget_floor` and `engine_version` are the deliberate exceptions: they are
 * pass-only facts with no column to read back, so GET serves them as null and
 * `served_by.engine_version` always names the deploy that answered.
 *
 * Status codes:
 *   201  a recommendation with at least one build
 *   200  a valid recommendation that produced ZERO builds (an under-budget
 *        floor is a legitimate outcome, not an error) - and the same 200 for
 *        EMPTY_CANDIDATE_POOL, which additionally carries `reason`
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
 * Group the flattened rows into builds, preserving the statement's ORDER BY.
 * A build_candidate with no component rows still appears (its `components` is
 * empty) because the candidate row is the unit of existence.
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
 * Present one persisted result as the wire contract. Pure.
 *
 * @param {object} source { snapshot, budgetFloor, engineVersion, reason,
 *        deployVersion }
 * @returns {object} the response body
 */
function presentRecommendationResult(source) {
  const { snapshot, budgetFloor, engineVersion, reason, deployVersion } = source;
  const query = snapshot.query || {};
  const grouped = groupBuilds(snapshot.rows || []);

  let generatedAt = toIsoOrNull(query.created_at);
  const builds = grouped.map((build) => {
    const buildIso = toIsoOrNull(build.created_at);
    if (buildIso !== null && (generatedAt === null || buildIso > generatedAt)) {
      generatedAt = buildIso;
    }
    return {
      rank: build.rank,
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
    budget_floor: budgetFloor === undefined ? null : budgetFloor,
    engine_version: engineVersion === undefined ? null : engineVersion,
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

    // Vocabulary checks the schema cannot express: the accepted use cases are
    // a property of the ACTIVE MODEL, not of the request.
    if (!meta.isAllowedUseCase(body.use_case, model.configuration)) {
      return reply.code(422).send(fieldError(
        'use_case',
        'use_case must be one of: ' + meta.useCaseValues(model.configuration).join(', ')
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
      const created = await app.repo.createRecommendationQuery(client, {
        scoringModelId: model.id,
        budgetAmount: body.budget_amount,
        currency: body.currency,
        useCase: body.use_case,
        resolution: body.resolution,
        priority: body.priority,
      });

      let reason = null;
      let budgetFloor = null;
      try {
        const run = await app.engine.runFullRun(client, created.queryId);
        budgetFloor = run.budget_floor;
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

      const snapshot = await app.repo.readRecommendationResult(client, created.queryId);
      if (!snapshot.found) {
        throw new Error('the query row disappeared after it was committed');
      }

      const payload = presentRecommendationResult({
        snapshot,
        budgetFloor,
        engineVersion: app.engineVersion,
        reason,
        deployVersion: app.engineVersion,
      });
      // 201 only when the pass actually produced a build; a zero-build pass is a
      // valid answer and is served as 200.
      return reply.code(payload.builds.length > 0 ? 201 : 200).send(payload);
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
      // Pass-only facts: GET never re-runs the engine and never recomputes a
      // floor (Decision 36 item 4), so both are explicitly null here.
      budgetFloor: null,
      engineVersion: null,
      reason: null,
      deployVersion: app.engineVersion,
    }));
  });
}

module.exports = {
  registerRecommendationRoutes,
  presentRecommendationResult,
  groupBuilds,
  priceStatusFor,
  toNumberOrNull,
  toIsoOrNull,
  UUID_RE,
  POST_RATE_LIMIT,
  GET_RATE_LIMIT,
};
