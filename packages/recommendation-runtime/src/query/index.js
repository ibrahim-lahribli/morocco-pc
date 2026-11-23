/**
 * Query input - Decision 10 / Decision 17.1 public surface.
 *
 * Boundary-only barrel: re-exports the recommendation_query loader without
 * wrappers, logic, orchestration, or additional contracts.
 *
 *   loadQueryInput()       - exact-ID `recommendation_query` lookup +
 *     fail-fast missing-row handling + frozen { query_id, scoring_model_id,
 *     input } where `input` is the Engine 2A selection input built THROUGH
 *     createCandidateSelectionInput (see ./load-query-input).
 *   SELECT_QUERY_INPUT_SQL - the single exact-ID query constant.
 *   REQUIRED_ROLES         - the Decision 10 Rule 1 loader constant.
 *   catalogVersion(db)     - Decision 47's content digest of the catalog, the
 *     version of the input state a pass ran against (see ./catalog-version).
 *     Read-only, deterministic, one `SELECT`.
 *
 * NOT owned here: orchestrator composition, ranking, persistence, profile
 * fallback, any write, `scoring_model` loading (Decision 11), and the
 * snapshot-transaction wrapper (Decision 17.5).
 */

'use strict';

const {
  loadQueryInput,
  SELECT_QUERY_INPUT_SQL,
  REQUIRED_ROLES,
} = require('./load-query-input');

const {
  catalogVersion,
  CATALOG_VERSION_SQL,
  CATALOG_COVERED_TABLES,
} = require('./catalog-version');

module.exports = {
  loadQueryInput,
  SELECT_QUERY_INPUT_SQL,
  REQUIRED_ROLES,
  catalogVersion,
  CATALOG_VERSION_SQL,
  CATALOG_COVERED_TABLES,
};
