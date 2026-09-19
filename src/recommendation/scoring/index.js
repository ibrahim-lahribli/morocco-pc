/**
 * Scoring model - Decision 11 public surface + Engine 4 scoring (Decision 13).
 *
 * Boundary-only barrel: re-exports the scoring-model loader, the pure
 * Decision 3(a) configuration validator, and the Engine 4 scoring modules
 * (Decision 13 STEP 1-3) without wrappers, logic, orchestration, or
 * additional contracts.
 *
 * Decision 11 (scoring model):
 *   loadScoringModel()                  - pinned-ID `scoring_model` lookup +
 *     fail-fast missing/inactive handling + frozen validated domain object
 *     (see ./load-scoring-model).
 *   SELECT_SCORING_MODEL_SQL            - the single exact-ID query constant.
 *   validateScoringModelConfiguration() - the pure, DB-free Decision 3(a)
 *     configuration contract validator (see ./configuration).
 *   SCORING_MODEL_CONFIGURATION_KEYS    - the frozen required top-level key
 *     vocabulary, in documented order.
 *
 * Engine 4 (Decision 13 STEP 1-3):
 *   loadComponentAssessments()          - component_assessment loader: the
 *     frozen { assessments, loaded_at } map (see ./load-assessments).
 *   SELECT_COMPONENT_ASSESSMENTS_SQL    - the single candidate-scoped query.
 *   selectAssessmentRow()               - STEP 1's deterministic row-selection
 *     policy (DECISION REQUIRED A2; see ./effective-score).
 *   computeEffectiveScore()             - STEP 1: effective score per
 *     (product, assessment_type) (see ./effective-score).
 *   computeCandidateScore()             - STEP 2: candidate score per
 *     (product, role) (see ./candidate-score).
 *   computeCandidateScores()            - STEP 2 batch, unsorted (ranking is
 *     Decision 12/14, blocked; `top_k_per_role` stays validated-only).
 *   computeBuildScore()                 - STEP 3: build score per assembled
 *     build (see ./build-score).
 *   computeBuildScores()                - STEP 3 batch, index-aligned.
 *
 * NOT owned here: iGPU sourcing (`integrated_gpu_present`), the
 * `top_k_per_role` application, Engine 3 assembly, ranking, persistence, and
 * any orchestrator.
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
const {
  loadComponentAssessments,
  SELECT_COMPONENT_ASSESSMENTS_SQL,
} = require('./load-assessments');
const { selectAssessmentRow, computeEffectiveScore } = require('./effective-score');
const { computeCandidateScore, computeCandidateScores } = require('./candidate-score');
const { computeBuildScore, computeBuildScores } = require('./build-score');

module.exports = {
  loadScoringModel,
  SELECT_SCORING_MODEL_SQL,
  validateScoringModelConfiguration,
  SCORING_MODEL_CONFIGURATION_KEYS,
  loadComponentAssessments,
  SELECT_COMPONENT_ASSESSMENTS_SQL,
  selectAssessmentRow,
  computeEffectiveScore,
  computeCandidateScore,
  computeCandidateScores,
  computeBuildScore,
  computeBuildScores,
};