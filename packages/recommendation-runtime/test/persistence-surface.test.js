'use strict';

// packages/recommendation-runtime/test/persistence-surface.test.js — the
// `persistence` namespace, reconciled with RFC §11.5 by step 5 W3.
//
// W2 moved the five persistence modules into this package behind identity
// shims and published none of them, on the recorded ground that §11.5's table
// is orchestrator-facing and slicing it before its consumers existed would fix
// a shape a later batch had to review against the real call sites. W3 supplies
// those consumers (orchestrator/commit.js requires all three writers), so the
// namespace lands with them.
//
// §11.5 approves three writers "plus the validators for their own callers".
// This suite pins that reading exactly:
//
//   persistRanked, persistPassFacts, persistRejections,
//   validateSelected, validateRejections
//
// and nothing else. The SQL constants, `REJECT_STATUS`, the pass-facts writer's
// internal `validatePassFacts`, and the internal `runRecommendationCommit` are
// all absent, so "the surface is the approved table" is an executable claim
// rather than a reading of src/index.js.
//
// Member identity is asserted through the legacy shims because that is what
// keeps the commit orchestrator's documented patch seam working: the
// implementation and the old path are the same value, not two modules that
// happen to agree.
//
// DB-free and dependency-free: loading the namespace issues no statement.
//
//   npm run test:runtime        (from the repo root)

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const runtime = require('..');
const core = require('../../recommendation-core');

const PACKAGE_ROOT = path.resolve(__dirname, '..');

// RFC §11.5, in the order the approved row lists them.
const APPROVED_MEMBERS = [
  'persistRanked',
  'persistPassFacts',
  'persistRejections',
  'validateSelected',
  'validateRejections',
];

// name -> [the legacy shim, the module that owns the implementation]
const SOURCES = {
  persistRanked: [
    '../../../src/recommendation/persistence/persist-ranked',
    '../src/persistence/persist-ranked',
  ],
  persistPassFacts: [
    '../../../src/recommendation/persistence/persist-pass-facts',
    '../src/persistence/persist-pass-facts',
  ],
  persistRejections: [
    '../../../src/recommendation/persistence/persist-rejections',
    '../src/persistence/persist-rejections',
  ],
  validateSelected: [
    '../../../src/recommendation/persistence/validate-selected',
    '../src/persistence/validate-selected',
  ],
  validateRejections: [
    '../../../src/recommendation/persistence/validate-rejections',
    '../src/persistence/validate-rejections',
  ],
};

// Names that must never reach the public surface. Each one is reachable from
// its own module today; publishing it would be an RFC §11.5 amendment.
const INTERNAL_NAMES = [
  'runRecommendationCommit',
  'validatePassFacts',
  'REJECT_STATUS',
  'INSERT_BUILD_REJECTION_SQL',
  'DELETE_BUILD_REJECTION_SQL',
  'UPDATE_RECOMMENDATION_QUERY_FLOOR_SQL',
  'UPDATE_RECOMMENDATION_RESULT_FACTS_SQL',
  'INSERT_RECOMMENDATION_RESULT_SQL',
];

function coreMemberNames() {
  const names = new Set(Object.keys(core));
  for (const namespace of Object.values(core)) {
    for (const key of Object.keys(namespace)) names.add(key);
  }
  return names;
}

describe('runtime persistence namespace', () => {
  const persistence = runtime.persistence;

  it('is published at the package root', () => {
    assert.deepEqual(Object.keys(runtime).sort(), ['loaders', 'orchestrator', 'persistence']);
    assert.equal(typeof persistence, 'object');
    assert.notEqual(persistence, null);
    assert.equal(require('..').persistence, persistence);
  });

  it('is the same object as the declared ./persistence subpath', () => {
    const subpath = require(path.resolve(PACKAGE_ROOT, 'src/persistence/index.js'));
    assert.equal(subpath, persistence);
  });

  it('exposes exactly the approved writers and their callers\' validators, in order', () => {
    assert.deepEqual(Object.keys(persistence), APPROVED_MEMBERS);
    for (const name of APPROVED_MEMBERS) {
      assert.equal(typeof persistence[name], 'function', name + ' must be a function');
    }
  });

  it('publishes nothing internal', () => {
    for (const name of INTERNAL_NAMES) {
      assert.equal(name in persistence, false, name + ' is internal and must not be published');
    }
    for (const key of Object.keys(persistence)) {
      assert.equal(/_SQL$/.test(key), false, key + ' is a SQL constant, not a writer');
      assert.equal(/^[A-Z0-9_]+$/.test(key), false, key + ' is vocabulary, not a writer');
    }
  });

  it('shares no member with the core', () => {
    // A write payload shape belongs to the runtime contract (§11.3); if one of
    // these names were a core name the boundary between the packages would be
    // ambiguous at the call site.
    const coreNames = coreMemberNames();
    assert.ok(coreNames.size > 0, 'recommendation-core must export at least one member');
    const overlap = Object.keys(persistence).filter((name) => coreNames.has(name)).sort();
    assert.deepEqual(overlap, [], 'persistence re-exports core names: ' + overlap.join(', '));
  });

  it('is the same value as the legacy shim and the owning module, for every member', () => {
    for (const [name, [legacyPath, modulePath]] of Object.entries(SOURCES)) {
      const shim = require(legacyPath);
      const owner = require(modulePath);
      assert.equal(persistence[name], owner[name], name + ' is not the module export of ' + modulePath);
      assert.equal(persistence[name], shim[name], name + ' differs from the legacy shim ' + legacyPath);
    }
  });
});
