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
 * Run one full recommendation pass for `queryId` on `client`.
 *
 * `client` MUST be a single dedicated connection: the engine's read wrapper
 * opens its own REPEATABLE READ READ ONLY transaction and the write wrapper its
 * own write transaction, and nested-transaction safety depends on both running
 * in the same session.
 *
 * @param {object} client pg-compatible single dedicated connection
 * @param {string} queryId pinned recommendation_query.id
 * @returns {Promise<object>} the engine's frozen combined result
 */
async function runFullRun(client, queryId) {
  return orchestrator.runRecommendationFullRun(client, queryId, API_ENGINE_OPTIONS);
}

module.exports = {
  runFullRun,
  API_ENGINE_OPTIONS,
  ERROR_CODES: candidates.ERROR_CODES,
  CandidateSelectionError: candidates.CandidateSelectionError,
};
