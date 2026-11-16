'use strict';

// packages/recommendation-core/test/filtering-barrel.test.js — the CORE half of
// the Engine 2D filtering barrel contract (step 4B PR 2).
//
// The original src/recommendation/filtering/index.test.js tested one barrel
// that mixed two owners. The barrel is now a composition of two: core owns the
// pure exports, the runtime tree owns the loader and the B2-G entry point. This
// file asserts the core half — that the package really owns and exports the
// pure three, by identity to their core implementations, and that it does not
// quietly acquire the runtime ones. The runtime half (six-key barrel shape,
// runtime-owned identities, and the compatibility-shim identity of the core
// three) stays in src/recommendation/filtering/index.test.js.
//
// DB-free and dependency-free: node:test + node:assert only.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const core = require('..');
const filterModule = require('../src/filtering/filter');
const igpuMapModule = require('../src/filtering/igpu-map');

describe('core filtering barrel (core ownership)', () => {
  it('exposes exactly the three pure Engine 2D exports', () => {
    // Carried over from the original barrel test: the export set is exact, so
    // a fourth export has to be a deliberate edit.
    assert.deepEqual(
      Object.keys(core.filtering).sort(),
      ['CANDIDATE_STATUSES', 'buildIntegratedGpuPresentMap', 'filterCandidates'].sort()
    );
  });

  it('points every export at its canonical implementation, by identity', () => {
    // These are the core-owned halves of the original strictEqual assertions:
    // no wrapper, no copy, the same function object.
    assert.strictEqual(core.filtering.filterCandidates, filterModule.filterCandidates);
    assert.strictEqual(core.filtering.CANDIDATE_STATUSES, filterModule.CANDIDATE_STATUSES);
    assert.strictEqual(core.filtering.buildIntegratedGpuPresentMap, igpuMapModule.buildIntegratedGpuPresentMap);
  });

  it('never carries the runtime half of the stage', () => {
    // The loader executes SQL and CONTEXT_COMPAT_KEYS is a loader constant
    // (RFC §11.3 item 2), so neither may be reachable from the package.
    for (const runtimeOnly of [
      'loadFilteringContext',
      'CONTEXT_COMPAT_KEYS',
      'filterCandidatesForRecommendation',
    ]) {
      assert.equal(runtimeOnly in core.filtering, false, runtimeOnly + ' must stay in the runtime tree');
    }
  });
});
