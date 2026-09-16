/**
 * Scoring model - Decision 11 public surface.
 *
 * Boundary-only barrel: re-exports the scoring-model loader and the pure
 * Decision 3(a) configuration validator without wrappers, logic, orchestration,
 * or additional contracts.
 *
 *   loadScoringModel()                 - Decision 11 loader: pinned-ID
 *     `scoring_model` lookup + fail-fast missing/inactive handling + frozen
 *     validated domain object (see ./load-scoring-model).
 *   SELECT_SCORING_MODEL_SQL           - the single exact-ID query constant.
 *   validateScoringModelConfiguration()- the pure, DB-free Decision 3(a)
 *     configuration contract validator (see ./configuration).
 *   SCORING_MODEL_CONFIGURATION_KEYS   - the frozen required top-level key
 *     vocabulary, in documented order.
 *
 * NOT owned here: iGPU sourcing (`integrated_gpu_present`), the
 * `top_k_per_role` application, Engine 3 assembly, Engine 4 scoring, ranking,
 * persistence, and any orchestrator.
 */

'use strict';

const {
  loadScoringModel,
  SELECT_SCORING_MODEL_SQL,
} = require('./load-scoring-model');
const {
  validateScoringModelConfiguration,
  SCORING_MODEL_CONFIGURATION_KEYS,
} = require('./configuration');

module.exports = {
  loadScoringModel,
  SELECT_SCORING_MODEL_SQL,
  validateScoringModelConfiguration,
  SCORING_MODEL_CONFIGURATION_KEYS,
};