'use strict';

// packages/recommendation-core/test/surface.test.js — what each exported
// namespace actually contains, key by key.
//
// test/export-surface.json pins the ROOT keys; this pins the second level, so
// growing a namespace is as reviewable as adding one. It also states the
// negative half of the boundary in executable form: the runtime half of the
// candidates, filtering and scoring stages must not be reachable from core,
// because importing core must never pull in SQL.
//
// DB-free and dependency-free: node:test + node:assert only.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const core = require('..');

const CANDIDATES_KEYS = [
  'COMPONENT_ROLES',
  'ROLE_ORDER',
  'SINGULAR_ROLES',
  'PRODUCT_CATEGORIES',
  'ROLE_CATEGORIES',
  'isValidComponentRole',
  'isValidProductCategory',
  'expectedCategoryForRole',
  'ERROR_CODES',
  'CandidateSelectionError',
  'createCandidateSelectionInput',
  'createCandidate',
  'SELECTION_STAGES',
  'IMPLEMENTED_STAGES',
  'selectCandidatePool',
  'compareCandidates',
];

const COMPATIBILITY_KEYS = [
  'FINAL_STATUSES',
  'SOURCE_STATUSES',
  'REASON_CODES',
  'createCompatibilityResult',
  'aggregateCompatibilityResults',
  'resolveCpuMotherboardSocket',
  'resolveCpuMotherboardSupport',
  'resolveCoolerSocketSupport',
  'resolveCoolerCaseHeight',
  'resolveCoolerCpuTdp',
  'resolveRamMotherboardSlots',
  'resolveRamMotherboardCapacity',
  'resolveCaseMotherboardFormFactor',
  'resolveCaseRadiator',
  'resolvePlatformMemorySupport',
  'resolveMotherboardRamMemoryType',
  'resolveGpuCaseLength',
  'resolveGpuCaseThickness',
  'resolveGpuPsuWattage',
  'resolveGpuPsuConnectors',
];

const FILTERING_KEYS = ['filterCandidates', 'CANDIDATE_STATUSES', 'buildIntegratedGpuPresentMap'];

const ASSEMBLY_KEYS = [
  'validateEngine3Input',
  'priceKey',
  'validatePrices',
  'lookupPrice',
  'resolveGpuRequirement',
  'assembleBuilds',
  'EXPANSION_ORDER',
  'buildGpuInputs',
  'assembleBuildsForRecommendation',
  'evaluateBuild',
  'evaluateBuildReplacement',
];

const RANKING_KEYS = [
  'rankBuilds',
  'TOP_N_PERSISTED',
  'selectDiverseTop',
  'MAX_PER_PAIR',
  'selectArchetypes',
  'PERFORMANCE_FLOOR',
  'STRATEGIES',
  'REASON_CODES',
];

const RETENTION_KEYS = [
  'retainTopKPerRole',
  'excludedCpuProductIds',
  'BUDGET_FLOOR_ROLES',
  'computeBudgetFloor',
  'computeRoleTargets',
  'resolutionMultiplier',
  'RESOLUTION_MULTIPLIERS',
  'BAND_TOLERANCE',
  'BAND_CEILING_FACTOR',
];

const SCORING_KEYS = [
  'validateScoringModelConfiguration',
  'SCORING_MODEL_CONFIGURATION_KEYS',
  'OPTIONAL_CONFIGURATION_KEYS',
  'listUseCases',
  'validateUseCaseProfiles',
  'USE_CASE_PROFILES_KEY',
  'GPU_POLICIES',
  'selectAssessmentRow',
  'computeEffectiveScore',
  'computeCandidateScore',
  'computeCandidateScores',
  'computeBuildScore',
  'computeBuildScores',
  'computeBuildScoreContributions',
];

describe('core namespaces', () => {
  it('candidates exposes the pure contract and nothing runtime', () => {
    assert.deepEqual(Object.keys(core.candidates).sort(), [...CANDIDATES_KEYS].sort());
    // loadCandidates executes SQL; it belongs to the runtime tree.
    assert.equal('loadCandidates' in core.candidates, false);
  });

  it('compatibility exposes the whole Engine 1 surface', () => {
    assert.deepEqual(Object.keys(core.compatibility).sort(), [...COMPATIBILITY_KEYS].sort());
  });

  it('assembly exposes the whole Engine 3 surface', () => {
    assert.deepEqual(Object.keys(core.assembly).sort(), [...ASSEMBLY_KEYS].sort());
  });

  it('ranking exposes the whole Engine 5a surface', () => {
    assert.deepEqual(Object.keys(core.ranking).sort(), [...RANKING_KEYS].sort());
  });

  it('retention exposes the whole Engine 2D retention surface', () => {
    assert.deepEqual(Object.keys(core.retention).sort(), [...RETENTION_KEYS].sort());
    // The GPU policy vocabulary is igpu-pool's own module export, not part of
    // the stage barrel: the core namespace publishes the barrel's nine keys.
    assert.equal('GPU_POLICY_VALUES' in core.retention, false);
  });

  it('filtering exposes the pure half of Engine 2D and nothing runtime', () => {
    assert.deepEqual(Object.keys(core.filtering).sort(), [...FILTERING_KEYS].sort());
    for (const runtimeOnly of [
      'loadFilteringContext',
      'CONTEXT_COMPAT_KEYS',
      'filterCandidatesForRecommendation',
    ]) {
      assert.equal(
        runtimeOnly in core.filtering,
        false,
        runtimeOnly + ' executes SQL or carries a loader constant and must stay in the runtime tree'
      );
    }
  });

  it('scoring exposes the pure Engine 4 surface and nothing runtime', () => {
    assert.deepEqual(Object.keys(core.scoring).sort(), [...SCORING_KEYS].sort());
    // The two loaders and their SQL constants execute or carry SQL; they stay
    // in the runtime scoring barrel and must never be reachable from core.
    for (const runtimeOnly of [
      'loadScoringModel',
      'SELECT_SCORING_MODEL_SQL',
      'loadComponentAssessments',
      'SELECT_COMPONENT_ASSESSMENTS_SQL',
    ]) {
      assert.equal(
        runtimeOnly in core.scoring,
        false,
        runtimeOnly + ' executes SQL or carries a query constant and must stay in the runtime tree'
      );
    }
  });
});
