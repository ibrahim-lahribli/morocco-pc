'use strict';

/**
 * apps/api/src/engine.js - the API's ONLY engine entry point.
 *
 * Boundary: this file exists so the HTTP layer never reaches into an engine
 * module's internals. It requires exactly two PUBLIC BARRELS
 * (`src/recommendation/orchestrator/index.js` and
 * `src/recommendation/candidates/index.js`) and re-exports nothing the engine
 * does not already export. `import-boundary.test.js` enforces that rule by
 * scanning every file under apps/api/src for a `require` that resolves to a
 * path inside `src/recommendation/` and is neither a stage barrel (`index.js`)
 * nor the one documented exception (persistence/, which has no barrel and is
 * imported as `persistence/persist-ranked`).
 *
 * No engine logic lives here: no scoring, no ranking, no assembly, no SQL.
 * The one decision this module owns is the beta option (Decision 35 /
 * Decision 36 item 2): the HTTP API ALWAYS runs with
 * `allow_unverified_seed_offers: true`. The whole catalog is seed data
 * (`store_offer.ingestion_record_id IS NULL` on 101/101 rows), so with the
 * option OFF every pass would eventually throw EMPTY_CANDIDATE_POOL once the
 * 30-day window lapsed - a beta API that returns nothing is not a beta. The
 * option is intentionally NOT exposed as a request field: a client must not be
 * able to turn the freshness rule back on and change what it gets.
 */

const orchestrator = require('../../../src/recommendation/orchestrator');
const candidates = require('../../../src/recommendation/candidates');

/** The API's fixed engine options. Frozen so a caller cannot mutate it. */
const API_ENGINE_OPTIONS = Object.freeze({ allow_unverified_seed_offers: true });

/**
 * The options one pass runs with, including the deploy identity Decision 46
 * persists onto `recommendation_result.engine_version`.
 *
 * This is the API half of that handoff: the engine version is a CALLER-supplied
 * `options.engineVersion` and the engine never reads `process.env` for it, so
 * whoever knows which deploy is running has to say so. Here that is
 * `app.engineVersion` (from `ENGINE_VERSION`, defaulting to `dev`), which is the
 * same value the response reports as `served_by.engine_version` - so a persisted
 * row and the reply that produced it name one deploy, not two.
 *
 * A value that is not a non-empty string is DROPPED rather than passed through.
 * `persistPassFacts` refuses a blank or non-string engineVersion, and that
 * refusal would abort the entire pass with a 500 over a cosmetic provenance
 * field. Degrading to "not recorded" (SQL NULL) is the honest failure
 * direction: the schema is nullable precisely because this fact can be unknown,
 * and NULL means UNKNOWN - never a guessed placeholder. `buildApp` already
 * normalizes the ordinary path to a string, so this only guards direct callers.
 *
 * @param {string} [engineVersion] the deploy that is running this pass
 * @returns {object} frozen options for runRecommendationFullRun
 */
function engineOptionsFor(engineVersion) {
  if (typeof engineVersion === 'string' && engineVersion.trim().length > 0) {
    return Object.freeze(Object.assign({}, API_ENGINE_OPTIONS, { engineVersion }));
  }
  return API_ENGINE_OPTIONS;
}

/**
 * Run one full recommendation pass for `queryId` on `client`.
 *
 * `client` MUST be a single dedicated connection: the engine's read wrapper
 * opens its own REPEATABLE READ READ ONLY transaction and the write wrapper its
 * own write transaction, and nested-transaction safety depends on both running
 * in the same session.
 *
 * @param {object} client pg-compatible single dedicated connection
 * @param {string} queryId pinned recommendation_query.id
 * @param {string} [engineVersion] the deploy running this pass; persisted as
 *        the pass's `engine_version` (see engineOptionsFor). Callers that omit
 *        it still run - the column simply reads back NULL.
 * @returns {Promise<object>} the engine's frozen combined result
 */
async function runFullRun(client, queryId, engineVersion) {
  return orchestrator.runRecommendationFullRun(client, queryId, engineOptionsFor(engineVersion));
}

module.exports = {
  runFullRun,
  engineOptionsFor,
  API_ENGINE_OPTIONS,
  ERROR_CODES: candidates.ERROR_CODES,
  CandidateSelectionError: candidates.CandidateSelectionError,
};
