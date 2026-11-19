/**
 * Scoring model and Engine 4 scoring - pure barrel (step 4B PR 6).
 *
 * Boundary: re-exports the pure Decision 3(a) configuration validator, the
 * Decision 37 use-case vocabulary and the Engine 4 scoring modules (Decision 13
 * STEP 1-3) by identity. No wrappers, no logic, no orchestration.
 *
 * Public surface (the 14 pure keys the runtime scoring barrel publishes):
 *
 *   Decision 11 - scoring model
 *   validateScoringModelConfiguration(configuration)
 *     - the pure Decision 3(a) configuration contract validator.
 *   SCORING_MODEL_CONFIGURATION_KEYS / OPTIONAL_CONFIGURATION_KEYS
 *     - the frozen required and optional top-level key vocabularies.
 *
 *   Decision 37 - use-case vocabulary
 *   listUseCases(configuration)
 *     - the model's use cases: read from `use_case_profiles`, with the legacy
 *     `gpu_required_use_cases` fallback for a model that declares no profiles.
 *   validateUseCaseProfiles(use_case_profiles)
 *     - the pure `use_case_profiles` contract validator.
 *   USE_CASE_PROFILES_KEY / GPU_POLICIES
 *     - the Decision 37 key and GPU-policy vocabulary.
 *
 *   Decision 13 - Engine 4
 *   selectAssessmentRow(rows, assessmentType)
 *     - STEP 1's deterministic row-selection policy (DECISION REQUIRED A2).
 *   computeEffectiveScore({ assessment, configuration, nowMs })
 *     - STEP 1: effective score per (product, assessment_type).
 *   computeCandidateScore / computeCandidateScores
 *     - STEP 2: candidate score per (product, role), and the unsorted batch
 *     in exact input order.
 *   computeBuildScore / computeBuildScores / computeBuildScoreContributions
 *     - STEP 3: build score per assembled build, the index-aligned batch, and
 *     the Decision 22 additive per-(role,type) contributions.
 *
 * Deliberately absent, and staying in the runtime tree:
 *   loadScoringModel / SELECT_SCORING_MODEL_SQL          (executes SQL)
 *   loadComponentAssessments / SELECT_COMPONENT_ASSESSMENTS_SQL (executes SQL)
 * A core import must never pull in SQL, so the runtime barrel
 * (src/recommendation/scoring/index.js) keeps composing them with these
 * modules; test/surface.test.js states this boundary executably.
 *
 * Explicit non-responsibilities: no database access, no I/O, no clock reads
 * (`nowMs` is injected), no ranking or tie-breaking (owned by the retention
 * stage, Decision 12), no persistence.
 */

'use strict';

const {
  validateScoringModelConfiguration,
  SCORING_MODEL_CONFIGURATION_KEYS,
  OPTIONAL_CONFIGURATION_KEYS,
} = require('./configuration');
const {
  listUseCases,
  validateUseCaseProfiles,
  USE_CASE_PROFILES_KEY,
  GPU_POLICIES,
} = require('./use-cases');
const { selectAssessmentRow, computeEffectiveScore } = require('./effective-score');
const { computeCandidateScore, computeCandidateScores } = require('./candidate-score');
const {
  computeBuildScore,
  computeBuildScores,
  computeBuildScoreContributions,
} = require('./build-score');

module.exports = {
  validateScoringModelConfiguration,
  SCORING_MODEL_CONFIGURATION_KEYS,
  OPTIONAL_CONFIGURATION_KEYS,
  listUseCases,
  validateUseCaseProfiles,
  USE_CASE_PROFILES_KEY,
  GPU_POLICIES,
  selectAssessmentRow,
  computeEffectiveScore,
  computeCandidateScore,
  computeCandidateScores,
  computeBuildScore,
  computeBuildScores,
  computeBuildScoreContributions,
};
