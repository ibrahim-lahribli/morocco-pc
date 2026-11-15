'use strict';

// ---------------------------------------------------------------------------
// Engine 2D B2-H: barrel-contract test for the filtering public API.
//
// RUNTIME HALF since step 4B PR 2. The barrel now composes two owners: core
// (packages/recommendation-core/src/filtering) owns filterCandidates,
// CANDIDATE_STATUSES and buildIntegratedGpuPresentMap; this tree owns
// loadFilteringContext, CONTEXT_COMPAT_KEYS and filterCandidatesForRecommendation.
// This file proves:
//
//   1. the six-export public surface is unchanged - the assertion the original
//      barrel test carried, kept verbatim;
//   2. the runtime-owned exports point at their canonical implementations;
//   3. the core-owned exports are re-exported by IDENTITY (no wrapper, no copy),
//      which is what keeps the compatibility shim faithful.
//
// The core half - that the package owns the pure three and never gains the
// runtime ones - is packages/recommendation-core/test/filtering-barrel.test.js.
// No loader internals, filter verdict rules, resolver behavior, or pipeline
// orchestration are re-tested here (see context-loader.test.js, filter.test.js,
// integration.test.js and pipeline.test.js).
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const index = require('./index');
const core = require('../../../packages/recommendation-core/src/filtering');
const { loadFilteringContext, CONTEXT_COMPAT_KEYS } = require('./context-loader');
const { filterCandidatesForRecommendation } = require('./pipeline');

test('filtering barrel still exposes the canonical six-export public API', () => {
  // The six expected exports exist - and only those six. (The sixth is the
  // Decision 11 iGPU handoff, resolved 2026-09-17.)
  assert.deepEqual(
    Object.keys(index).sort(),
    [
      'loadFilteringContext',
      'CONTEXT_COMPAT_KEYS',
      'buildIntegratedGpuPresentMap',
      'filterCandidates',
      'CANDIDATE_STATUSES',
      'filterCandidatesForRecommendation',
    ].sort()
  );
});

test('the runtime-owned exports point at their canonical implementations', () => {
  assert.strictEqual(index.loadFilteringContext, loadFilteringContext);
  assert.strictEqual(index.CONTEXT_COMPAT_KEYS, CONTEXT_COMPAT_KEYS);

  // The canonical B2-G entry point is re-exported by identity - no wrapper, no copy.
  assert.strictEqual(index.filterCandidatesForRecommendation, filterCandidatesForRecommendation);
});

test('the core-owned exports are the core instances, re-exported by identity', () => {
  // Compatibility-shim identity: whatever core exports must be the SAME object
  // here, or a consumer comparing functions across the two paths would break.
  assert.strictEqual(index.filterCandidates, core.filterCandidates);
  assert.strictEqual(index.CANDIDATE_STATUSES, core.CANDIDATE_STATUSES);

  // The Decision 11 iGPU handoff is re-exported by identity - no wrapper, no copy.
  assert.strictEqual(index.buildIntegratedGpuPresentMap, core.buildIntegratedGpuPresentMap);
});
