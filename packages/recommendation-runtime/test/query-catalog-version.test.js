'use strict';

// packages/recommendation-runtime/test/query-catalog-version.test.js — the
// Decision 47 catalog content digest now lives in this package, batch
// `step-5-w1-query-scoring`.
//
// What it proves, and why each point is here rather than in the L1 suite that
// stayed at the old path (src/recommendation/query/catalog-version.test.js):
//   1. the module is loadable from its NEW path and still exports its surface;
//   2. the old path is the SAME module by identity, not a second copy;
//   3. the statement is still ONE parameterless SELECT over every declared
//      covered table (Decision 47 item 8: one round trip);
//   4. one call returns the digest string unchanged, and a non-digest result
//      fails fast instead of handing the caller a junk key.
//
// DB-free: the statement is issued against a fake client that records its
// calls. No database, no environment, no clock read.
//
//   npm run test:runtime        (from the repo root)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  catalogVersion,
  CATALOG_VERSION_SQL,
  CATALOG_COVERED_TABLES,
} = require('../src/query/catalog-version');
const shim = require('../../../src/recommendation/query/catalog-version');

const DIGEST = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

/** Fake pg-compatible client: records (sql, params) and returns fixed rows. */
function makeDb(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

test('loads from the runtime package and exports the catalog surface', () => {
  assert.equal(typeof catalogVersion, 'function');
  assert.equal(typeof CATALOG_VERSION_SQL, 'string');
  assert.ok(Array.isArray(CATALOG_COVERED_TABLES));
  assert.ok(CATALOG_COVERED_TABLES.length > 0);
});

test('the old path is the same module by identity, not a second implementation', () => {
  assert.equal(shim.catalogVersion, catalogVersion);
  assert.equal(shim.CATALOG_VERSION_SQL, CATALOG_VERSION_SQL);
  assert.equal(shim.CATALOG_COVERED_TABLES, CATALOG_COVERED_TABLES);
});

test('one statement covers every declared table and takes no parameters', () => {
  assert.equal(typeof CATALOG_VERSION_SQL, 'string');
  assert.ok(CATALOG_VERSION_SQL.includes('md5('), 'the digest is computed in SQL');
  for (const table of CATALOG_COVERED_TABLES) {
    assert.ok(
      CATALOG_VERSION_SQL.includes("'" + table + "'"),
      'the statement must cover every declared table: ' + table
    );
  }
  assert.ok(!CATALOG_VERSION_SQL.includes('${'), 'no template interpolation');
});

test('one call returns the digest, and a non-digest result fails fast', async () => {
  const db = makeDb([{ catalog_version: DIGEST }]);
  assert.equal(await catalogVersion(db), DIGEST);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].params, undefined, 'the digest statement takes no parameters');

  const bad = makeDb([{ catalog_version: 'not-a-digest' }]);
  await assert.rejects(
    () => catalogVersion(bad),
    (err) => err.code === 'INVALID_INPUT' && err.field === 'catalog_version'
  );
});
