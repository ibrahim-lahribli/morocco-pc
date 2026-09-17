'use strict';

// ---------------------------------------------------------------------------
// Engine 2D B2-H: focused barrel-contract test for the filtering public API.
//
// This file proves ONLY the B2-H boundary decision: filtering/index.js is the
// canonical public surface and re-exports the B2-G orchestration entry point
// without duplicating logic. No loader internals, filter verdict rules,
// resolver behavior, or pipeline orchestration are re-tested here (see
// context-loader.test.js, filter.test.js, integration.test.js and
// pipeline.test.js).
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const index = require('./index');
const { loadFilteringContext, CONTEXT_COMPAT_KEYS } = require('./context-loader');
const { buildIntegratedGpuPresentMap } = require('./igpu-map');
const { filterCandidates, CANDIDATE_STATUSES } = require('./filter');
const { filterCandidatesForRecommendation } = require('./pipeline');

test('filtering barrel exposes the canonical six-export public API', () => {
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

  // Existing exports still point to their canonical implementations.
  assert.strictEqual(index.loadFilteringContext, loadFilteringContext);
  assert.strictEqual(index.CONTEXT_COMPAT_KEYS, CONTEXT_COMPAT_KEYS);
  assert.strictEqual(index.filterCandidates, filterCandidates);
  assert.strictEqual(index.CANDIDATE_STATUSES, CANDIDATE_STATUSES);

  // The Decision 11 iGPU handoff is re-exported by identity - no wrapper, no copy.
  assert.strictEqual(index.buildIntegratedGpuPresentMap, buildIntegratedGpuPresentMap);

  // The canonical entry point is re-exported by identity - no wrapper, no copy.
  assert.strictEqual(index.filterCandidatesForRecommendation, filterCandidatesForRecommendation);
});
