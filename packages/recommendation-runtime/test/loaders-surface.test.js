'use strict';

// packages/recommendation-runtime/test/loaders-surface.test.js — step 5 W1's
// acceptance test for the published `loaders` namespace.
//
// Three things are pinned here, and each one can fail on its own:
//
//   1. MEMBERSHIP. `APPROVED_LOADERS` is RFC §11.5's table, transcribed. The
//      namespace must expose exactly those names — an added name fails (nothing
//      internal leaks) and a removed name fails (the approved surface shrank).
//   2. ROOT SHAPE. The package root publishes `loaders` and nothing else until
//      W2 (persistence) and W3 (orchestrator). Every member must be a function.
//   3. IDENTITY. Each published name must be `===` the export reached through
//      its legacy shim under src/recommendation/**, and through the old stage
//      barrels where they publish it. A copy, a wrapper or a second
//      implementation would fail here even though it returned the same shape.
//
// The overlap half of the boundary (no runtime name is a core name) stays in
// test/surface.test.js, which owns that check for every namespace.
//
// DB-free and dependency-free: loading the namespace executes no query.
//
//   npm run test:runtime        (from the repo root)

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const runtime = require('..');
const core = require('../../recommendation-core');

// RFC §11.5, in the order the approved table lists them.
const APPROVED_LOADERS = [
  'loadQueryInput',
  'catalogVersion',
  'loadCandidates',
  'selectOfferPrices',
  'loadFilteringContext',
  'filterCandidatesForRecommendation',
  'loadScoringModel',
  'loadComponentAssessments',
];

// name -> the legacy path that must expose the SAME value.
const LEGACY_SHIM = {
  loadQueryInput: '../../../src/recommendation/query/load-query-input',
  catalogVersion: '../../../src/recommendation/query/catalog-version',
  loadCandidates: '../../../src/recommendation/candidates/loader',
  selectOfferPrices: '../../../src/recommendation/offers/select',
  loadFilteringContext: '../../../src/recommendation/filtering/context-loader',
  filterCandidatesForRecommendation: '../../../src/recommendation/filtering/pipeline',
  loadScoringModel: '../../../src/recommendation/scoring/load-scoring-model',
  loadComponentAssessments: '../../../src/recommendation/scoring/load-assessments',
};

// The old barrels that publish a loader keep publishing the same object.
const LEGACY_BARRELS = {
  '../../../src/recommendation/offers': ['selectOfferPrices'],
  '../../../src/recommendation/query': ['loadQueryInput', 'catalogVersion'],
};

// Names that must never reach the public surface: the core adapter, the three
// module-internal catalog helpers the query barrel withholds, the SQL
// constants and the loader vocabulary.
const INTERNAL_NAMES = [
  'core-entry',
  'CATALOG_VERSION_RE',
  'buildCatalogVersionSql',
  'fingerprintArm',
  'SELECT_QUERY_INPUT_SQL',
  'SELECT_OFFER_PRICES_SQL',
  'SELECT_SCORING_MODEL_SQL',
  'SELECT_COMPONENT_ASSESSMENTS_SQL',
  'REQUIRED_ROLES',
  'CATALOG_VERSION_SQL',
  'CATALOG_COVERED_TABLES',
  'CONTEXT_COMPAT_KEYS',
];

function coreMemberNames() {
  const names = new Set(Object.keys(core));
  for (const namespace of Object.values(core)) {
    for (const key of Object.keys(namespace)) names.add(key);
  }
  return names;
}

describe('runtime loaders namespace', () => {
  const loaders = runtime.loaders;

  it('is published at the package root', () => {
    assert.deepEqual(Object.keys(runtime).sort(), ['loaders', 'orchestrator']);
    assert.equal(typeof loaders, 'object');
    assert.notEqual(loaders, null);
    assert.equal(require('..').loaders, loaders);
  });

  it('exposes exactly the eight RFC §11.5 functions', () => {
    assert.deepEqual(Object.keys(loaders).sort(), [...APPROVED_LOADERS].sort());
    for (const name of APPROVED_LOADERS) {
      assert.equal(typeof loaders[name], 'function', name + ' must be a function');
    }
  });

  it('publishes nothing internal', () => {
    for (const name of INTERNAL_NAMES) {
      assert.equal(name in loaders, false, name + ' is internal and must not be published');
    }
    // The SQL constants this batch deliberately leaves at their old barrels.
    for (const key of Object.keys(loaders)) {
      assert.equal(/_SQL$/.test(key), false, key + ' is a SQL constant, not a loader');
      assert.equal(/^[A-Z0-9_]+$/.test(key), false, key + ' is vocabulary, not a loader');
    }
  });

  it('shares no member with the core', () => {
    const coreNames = coreMemberNames();
    assert.ok(coreNames.size > 0, 'recommendation-core must export at least one member');
    const overlap = Object.keys(loaders).filter((name) => coreNames.has(name)).sort();
    assert.deepEqual(overlap, [], 'loaders re-exports core names: ' + overlap.join(', '));
  });

  it('is the same object as the legacy shim for every name', () => {
    for (const [name, legacyPath] of Object.entries(LEGACY_SHIM)) {
      const shim = require(legacyPath);
      assert.equal(loaders[name], shim[name], name + ' differs from ' + legacyPath);
    }
  });

  it('is the same object as the old stage barrels publish', () => {
    for (const [barrelPath, names] of Object.entries(LEGACY_BARRELS)) {
      const barrel = require(barrelPath);
      for (const name of names) {
        assert.equal(loaders[name], barrel[name], name + ' differs from ' + barrelPath);
      }
    }
  });
});
