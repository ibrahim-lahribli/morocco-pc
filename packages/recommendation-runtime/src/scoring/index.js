'use strict';

/**
 * Engine 4 / Decision 11 - scoring (runtime barrel, step 5 W3).
 *
 * The two loaders moved here in step 5 W1; W3 adds the namespace barrel so the
 * orchestrator's `require('../scoring')` resolves at both depths (the old path
 * is an identity shim to this file, like the candidate and filtering barrels).
 *
 * This barrel is written out explicitly rather than spread from the core
 * namespace for ONE reason: `src/recommendation/scoring/index.test.js` pins the
 * key ORDER, and the two loaders sit in the middle of it
 * (`loadComponentAssessments` before `selectAssessmentRow`, both after
 * `GPU_POLICIES`). A spread would append the loaders at the end and break that
 * published order. Every pure member is still the core's own function object,
 * by identity - proved by test/namespace-barrels.test.js, which also proves the
 * core namespace carries no getter and no non-enumerable member.
 */

const core = require('../core-entry');
const {
  loadScoringModel,
  SELECT_SCORING_MODEL_SQL,
} = require('./load-scoring-model');
const {
  loadComponentAssessments,
  SELECT_COMPONENT_ASSESSMENTS_SQL,
} = require('./load-assessments');

const pure = core.scoring;

module.exports = {
  loadScoringModel,
  SELECT_SCORING_MODEL_SQL,
  validateScoringModelConfiguration: pure.validateScoringModelConfiguration,
  SCORING_MODEL_CONFIGURATION_KEYS: pure.SCORING_MODEL_CONFIGURATION_KEYS,
  OPTIONAL_CONFIGURATION_KEYS: pure.OPTIONAL_CONFIGURATION_KEYS,
  listUseCases: pure.listUseCases,
  validateUseCaseProfiles: pure.validateUseCaseProfiles,
  USE_CASE_PROFILES_KEY: pure.USE_CASE_PROFILES_KEY,
  GPU_POLICIES: pure.GPU_POLICIES,
  loadComponentAssessments,
  SELECT_COMPONENT_ASSESSMENTS_SQL,
  selectAssessmentRow: pure.selectAssessmentRow,
  computeEffectiveScore: pure.computeEffectiveScore,
  computeCandidateScore: pure.computeCandidateScore,
  computeCandidateScores: pure.computeCandidateScores,
  computeBuildScore: pure.computeBuildScore,
  computeBuildScores: pure.computeBuildScores,
  computeBuildScoreContributions: pure.computeBuildScoreContributions,
};
