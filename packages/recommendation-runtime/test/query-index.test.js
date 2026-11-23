'use strict';

// packages/recommendation-runtime/test/query-index.test.js — the query public
// barrel (Decision 10 / Decision 17.1 surface, plus the Decision 47 catalog
// digest) now lives in this package, batch `step-5-w1-final-loaders`.
//
// The barrel re-exports two already-moved loaders without wrappers, so identity
// is the whole contract: the OLD path and the NEW path must expose the same key
// set, and every key must be the same value. The behavioural suites
// (`load-query-input.test.js`, `catalog-version.test.js`) stay at the old paths
// and now exercise the implementation through this shim.
//
// DB-free and dependency-free: loading the barrel executes no query.
//
//   npm run test:runtime        (from the repo root)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const barrel = require('../src/query');
const shim = require('../../../src/recommendation/query');

test('query barrel: the old path is the same module as the new path', () => {
  assert.equal(shim, barrel);
});

test('query barrel: both paths expose an identical key set', () => {
  assert.deepEqual(Object.keys(barrel).sort(), Object.keys(shim).sort());
  assert.deepEqual(Object.keys(barrel).sort(), [
    'CATALOG_COVERED_TABLES',
    'CATALOG_VERSION_SQL',
    'REQUIRED_ROLES',
    'SELECT_QUERY_INPUT_SQL',
    'catalogVersion',
    'loadQueryInput',
  ]);
});

test('query barrel: every export is the same value through both paths', () => {
  for (const key of Object.keys(barrel)) {
    assert.equal(shim[key], barrel[key], 'export ' + key + ' differs between the old and the new path');
  }
});
