'use strict';

// packages/recommendation-core/test/surface.test.js — what each exported
// namespace actually contains, key by key.
//
// test/export-surface.json pins the ROOT keys; this pins the second level, so
// growing a namespace is as reviewable as adding one. It also states the
// negative half of the boundary in executable form: the runtime half of the
// candidates and filtering stages must not be reachable from core, because
// importing core must never pull in SQL.
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

describe('core namespaces', () => {
  it('candidates exposes the pure contract and nothing runtime', () => {
    assert.deepEqual(Object.keys(core.candidates).sort(), [...CANDIDATES_KEYS].sort());
    // loadCandidates executes SQL; it belongs to the runtime tree.
    assert.equal('loadCandidates' in core.candidates, false);
  });

  it('compatibility exposes the whole Engine 1 surface', () => {
    assert.deepEqual(Object.keys(core.compatibility).sort(), [...COMPATIBILITY_KEYS].sort());
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
});
