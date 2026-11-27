'use strict';

/**
 * Engine 4 / Decision 11 - scoring (runtime COMPOSITE SEAM, step 5 W3).
 *
 * WHAT THIS FILE IS. The legacy mixed barrel — 14 pure scoring names beside the
 * two SQL loaders and their two SQL constants — relocated into this package so
 * the byte-identical orchestrator's `require('../scoring')` resolves at BOTH
 * depths. The old path, `src/recommendation/scoring/index.js`, is an identity
 * shim to THIS object. See ./candidates/index.js for the full "what this file
 * is / is not" note and docs/MIXED_BARRELS.md §5 for the recorded architectural
 * question.
 *
 * WHAT IT IS NOT. A published namespace: absent from `package.json` `exports`,
 * from `src/index.js` and from `test/export-surface.json`. Core owns the pure
 * implementations by identity; this package owns the two loaders and keeps
 * their SQL constants module-public rather than publishing them in `loaders`
 * (§11.5 lists functions only — docs/MIXED_BARRELS.md rule 4).
 *
 * WHY NOT A SPREAD, unlike the candidate and filtering composites. The old
 * barrel's published key ORDER is pinned: `src/recommendation/scoring/index.test.js`
 * asserts it, and the two loaders sit in the middle of it
 * (`loadComponentAssessments` before `selectAssessmentRow`, both after
 * `GPU_POLICIES`). A spread would append them at the end and change a published
 * order for no architectural gain, so every member is written out explicitly in
 * the legacy order. The placement is still mechanical — each pure member is the
 * core's own function object, proved by test/namespace-barrels.test.js — and the
 * exact key list is committed there, so growth is a reviewed diff rather than a
 * silent one.
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
