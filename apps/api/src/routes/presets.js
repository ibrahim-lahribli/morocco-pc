'use strict';

/**
 * apps/api/src/routes/presets.js - GET /v1/presets (Platform P1 Sprint 6 /
 * Decision 48).
 *
 * The read-only landing-page ribbon: for one use case in one currency it serves
 * the generated presets of the CURRENT catalog version, cheapest budget first.
 * A preset is a POINTER, not a copy - `recommendation_id` is an ordinary
 * recommendation id, so a client that follows it lands on exactly the pass the
 * landing page showed, through the same GET the POST reply uses.
 *
 * Boundary: HTTP concerns only. The two statements behind it live in
 * ../repository.js and the catalog digest behind ../engine.js; this module
 * issues no SQL and, like every other route, never imports the engine directly.
 *
 * WHY THE CURRENT CATALOG VERSION IS AN ARGUMENT AND NOT A `max()` IN SQL. The
 * version is computed here, once, and required: rows of a superseded catalog are
 * then INVISIBLE rather than merely least-preferred, so a price update can never
 * be answered with the builds it invalidated. That is also why the response
 * carries it - a client caching a landing page needs to know which catalog state
 * its copy belongs to.
 *
 * WHY A FAILED DIGEST IS A 503 AND NOT AN EMPTY LIST, although the POST route
 * degrades the same failure to a null. The two failures mean different things.
 * On a POST, the digest is a dedupe key: it is not part of the answer, so
 * serving the answer without it is strictly better than refusing (Decision 47
 * item 10 makes the resulting row unmatchable, i.e. reuse off - never a stale
 * answer). Here the digest is the SELECTOR: without it there is no version to
 * select by, so an empty list would be indistinguishable from a catalog with no
 * presets and would tell a client to generate something that already exists.
 * Unknown is reported as unknown, which is the project's standing NULL/UNKNOWN
 * rule applied to an HTTP status.
 *
 * Status codes:
 *   200  the presets of the current catalog version - an EMPTY list when none
 *        have been generated yet, which is a valid answer and not a 404
 *   422  schema validation, or a use_case / currency outside the advertised
 *        vocabulary (never an empty list: a use case the active model does not
 *        declare is a client error, Decision 36 item 3)
 *   503  no active scoring model, a model with no usable vocabulary, or a
 *        catalog version that could not be computed
 */

const meta = require('../meta');
const { PresetsQuerySchema, PresetsResponseSchema, ErrorResponseSchema } = require('../contracts');

const PRESETS_RATE_LIMIT = Object.freeze({ max: 120, timeWindow: '1 minute' });

/** pg returns a NUMERIC as a string; a missing value stays null, never 0. */
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
 * The provenance of the build this preset SHOWS, as the wire vocabulary.
 *
 * Three outcomes, and the first two are the point of the function:
 *
 *   - NULL when there is no build to make a claim about (`build_count` is 0, or
 *     the top-ranked build persisted no component rows at all). Decision 17.2
 *     makes a built-nothing pass a legitimate outcome, so this state is reached
 *     by real data and must not be dressed up.
 *   - 'indicative' when any component of the shown build is not VERIFIED -
 *     fail-safe by direction, so a NULL `offer_class` and an unrecognized one
 *     both land here rather than being advertised as verified.
 *   - 'verified' only when the shown build HAS components and every one of them
 *     is VERIFIED. This is the reading a single `NOT EXISTS (... <> 'VERIFIED')`
 *     over the components cannot express: an empty set contradicts nothing, so
 *     that form would call a component-less build verified. Hence the two
 *     COUNTS the statement returns rather than one boolean.
 *
 * @param {object} row a SELECT_PRESETS_SQL row
 * @returns {'verified'|'indicative'|null}
 */
function priceStatusFor(row) {
  const buildCount = toNumberOrNull(row.build_count);
  if (buildCount === null || buildCount <= 0) {
    return null;
  }
  const componentCount = toNumberOrNull(row.rank1_component_count);
  if (componentCount === null || componentCount <= 0) {
    return null;
  }
  return toNumberOrNull(row.rank1_unverified_count) === 0 ? 'verified' : 'indicative';
}

/**
 * Present the preset rows as the wire contract. Pure, and fed only by persisted
 * rows.
 *
 * `generated_at` is the NEWEST row's, not the oldest: it answers "when was this
 * list last generated", and a stale row alongside a fresh one must not make the
 * list look older than it is. NULL for an empty list, which is the one case with
 * no timestamp to report and the state a client renders as "not generated yet".
 *
 * @param {Array<object>} rows SELECT_PRESETS_SQL rows, cheapest budget first
 * @param {string} catalogVersion the version the rows were selected by
 * @returns {object} the response body
 */
function presentPresets(rows, catalogVersion) {
  let generatedAt = null;
  const presets = rows.map((row) => {
    const rowIso = toIsoOrNull(row.generated_at);
    if (rowIso !== null && (generatedAt === null || rowIso > generatedAt)) {
      generatedAt = rowIso;
    }
    return {
      budget_amount: toNumberOrNull(row.budget_amount),
      recommendation_id: row.recommendation_id,
      build_score: toNumberOrNull(row.build_score),
      price_status: priceStatusFor(row),
    };
  });

  return {
    catalog_version: catalogVersion,
    generated_at: generatedAt,
    presets,
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

/**
 * The one 503 body the two model-side causes share: no active model at all, or
 * an active model whose configuration yields no use-case vocabulary. A client
 * keys on the code, and the message stays true of both - there is no usable
 * active model right now. Same body, same code, as POST /v1/recommendations and
 * GET /v1/meta/options, so a client has ONE state to handle.
 */
function scoringUnavailable() {
  return {
    error: 'SCORING_MODEL_UNAVAILABLE',
    message: 'No active scoring model is configured',
  };
}

/**
 * The catalog version of THIS moment, or throw.
 *
 * Unlike the POST route this does NOT degrade to null: there is nothing to serve
 * without a version (see the header). The function's existence is checked
 * outside the try on purpose - a missing collaborator is a WIRING error that
 * must be loud, and a catch would have turned it into the same 503 as a
 * database failure, which is the kind of silence this repo has been bitten by
 * before.
 *
 * @returns {Promise<string>} 32 hex characters
 */
async function resolveCatalogVersion(app, request) {
  if (typeof app.engine.catalogVersion !== 'function') {
    throw new Error('app.engine.catalogVersion is not a function - the engine boundary is not wired');
  }
  try {
    return await app.engine.catalogVersion(app.pool);
  } catch (error) {
    request.log.warn({ err: error }, 'catalog version unavailable - presets cannot be selected');
    return null;
  }
}

function registerPresetRoutes(app) {
  app.get('/v1/presets', {
    config: { rateLimit: PRESETS_RATE_LIMIT },
    schema: {
      tags: ['presets'],
      summary: 'Generated landing-page presets for one use case and currency',
      querystring: PresetsQuerySchema,
      response: {
        200: PresetsResponseSchema,
        422: ErrorResponseSchema,
        429: ErrorResponseSchema,
        500: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { use_case: useCase, currency } = request.query;

    const model = await app.repo.selectActiveScoringModel(app.pool, app.scoringModelPin);
    if (model === null) {
      return reply.code(503).send(scoringUnavailable());
    }

    // The ACTIVE model owns the use-case vocabulary (Decision 37), and the
    // derivation lives behind engine.js so the HTTP layer never imports the
    // engine. NULL is UNKNOWN, never an empty list: a model that declares no
    // usable vocabulary is UNAVAILABLE, not a 422 that blames the request.
    const useCases = app.engine.useCaseVocabulary(model.configuration);
    if (useCases === null) {
      return reply.code(503).send(scoringUnavailable());
    }

    // Vocabulary checks the schema cannot express: the accepted use cases are a
    // property of the ACTIVE MODEL, not of the request. A use case the model
    // does not declare is a 422 WITH the vocabulary in the message - serving an
    // empty ribbon for it would look like "no presets exist" and would invite a
    // client to generate a page the model cannot score (Sprint 6 scenario 6.4).
    if (!meta.isAllowedUseCase(useCase, useCases)) {
      return reply.code(422).send(fieldError(
        'use_case',
        'use_case must be one of: ' + meta.useCaseValues(useCases).join(', ')
      ));
    }
    if (!meta.isAllowedCurrency(currency)) {
      return reply.code(422).send(fieldError(
        'currency',
        'currency must be one of: ' + meta.CURRENCIES.map((option) => option.value).join(', ')
      ));
    }

    const catalogVersion = await resolveCatalogVersion(app, request);
    if (catalogVersion === null) {
      return reply.code(503).send({
        error: 'CATALOG_VERSION_UNAVAILABLE',
        message: 'The catalog version could not be computed, so no preset can be selected',
      });
    }

    const rows = await app.repo.selectPresets(app.pool, { useCase, currency, catalogVersion });
    return reply.code(200).send(presentPresets(rows, catalogVersion));
  });
}

module.exports = {
  registerPresetRoutes,
  presentPresets,
  priceStatusFor,
  toNumberOrNull,
  toIsoOrNull,
  PRESETS_RATE_LIMIT,
};
