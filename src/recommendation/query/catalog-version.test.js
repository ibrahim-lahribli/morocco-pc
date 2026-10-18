'use strict';

// ---------------------------------------------------------------------------
// Query support - `catalog_version` (Decision 47): contract tests.
//
// Scope: the covered-table list as a contract, the statement's structural
// properties (one round trip, one arm per table, timestamps subtracted BY TYPE,
// no session GUC, no clock, no randomness, a set-fold rather than a
// sequence-dependent concat), builder determinism, and the `catalogVersion(db)`
// contract (exactly one call, fail-fast on a junk digest, error propagation,
// input validation). Fake pg-compatible clients only -- no DB, no migrations.
//
// What is deliberately NOT here: the digest's VALUE. Determinism across
// sessions and GUCs, and sensitivity to an in-place correction, are measured
// properties of a live database and are proven by
// `apps/api/test/db/dedupe.db.test.js` against the TEST branch, not by a fake
// client that would only be asserting its own canned row back.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  catalogVersion,
  CATALOG_VERSION_SQL,
  CATALOG_COVERED_TABLES,
  CATALOG_VERSION_RE,
  buildCatalogVersionSql,
  fingerprintArm,
} = require('./catalog-version');

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const DIGEST = '0123456789abcdef0123456789abcdef';

/** A pg-compatible fake recording its calls. `row` undefined -> an empty result. */
function fakeDb(row) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: row === undefined ? [] : [row] };
    },
  };
}

// ---------------------------------------------------------------------------
// The covered set (Decision 47 item 3)
// ---------------------------------------------------------------------------

test('the covered set is a frozen contract with no duplicate table', () => {
  assert.ok(Array.isArray(CATALOG_COVERED_TABLES));
  assert.ok(Object.isFrozen(CATALOG_COVERED_TABLES));
  assert.ok(CATALOG_COVERED_TABLES.length > 0);
  assert.equal(
    new Set(CATALOG_COVERED_TABLES).size,
    CATALOG_COVERED_TABLES.length,
    'a duplicated table would double-weight one arm of the digest'
  );
  for (const table of CATALOG_COVERED_TABLES) {
    assert.match(table, /^[a-z][a-z0-9_]*$/, 'a table name must be a bare lower-case identifier');
  }
});

test('the covered set is the read-path catalog, not the whole schema', () => {
  // Pipeline outputs and the write-side-only tables must never be folded in
  // (Decision 47 item 3): folding a pipeline output in would change the version
  // on every POST, which is exactly the bug this dedupe key must not have.
  for (const excluded of [
    'recommendation_query',
    'recommendation_result',
    'build_candidate',
    'build_component',
    'build_rejection',
    'store',
    'spec_provenance',
    'schema_migrations',
  ]) {
    assert.ok(
      !CATALOG_COVERED_TABLES.includes(excluded),
      excluded + ' must stay out of the catalog version'
    );
  }
});

// ---------------------------------------------------------------------------
// The statement: shape, coverage, invariance (Decision 47 items 4, 6, 8, 9)
// ---------------------------------------------------------------------------

test('the statement is one round trip and carries no terminator', () => {
  assert.equal(typeof CATALOG_VERSION_SQL, 'string');
  assert.equal(CATALOG_VERSION_SQL.includes(';'), false, 'a second statement must not be reachable');
  assert.equal(
    CATALOG_VERSION_SQL.match(/UNION ALL/g).length,
    CATALOG_COVERED_TABLES.length - 1,
    'exactly one arm per covered table'
  );
  assert.equal(
    (CATALOG_VERSION_SQL.match(/information_schema\.columns/g) || []).length,
    CATALOG_COVERED_TABLES.length,
    'each arm resolves its own timestamp columns'
  );
});

test('every covered table appears exactly twice, and only in its own arm', () => {
  for (const table of CATALOG_COVERED_TABLES) {
    const literal = "'" + table + "'";
    // Exactly TWO: the arm's own `AS tbl` literal, plus the `table_name = ...`
    // filter of that arm's timestamp subquery. This is also the substring guard
    // that a quoted literal buys: 'platform' cannot match inside
    // 'platform_memory_support', so no arm silently borrows another's columns.
    assert.equal(
      CATALOG_VERSION_SQL.split(literal).length - 1,
      2,
      table + ' must be named exactly twice, in its own arm only'
    );
    assert.equal(
      CATALOG_VERSION_SQL.split('table_name = ' + literal).length - 1,
      1,
      table + ' must resolve its timestamp columns exactly once'
    );
    assert.ok(
      CATALOG_VERSION_SQL.includes('FROM ' + table + ' row_value'),
      'every arm reads its table'
    );
  }
});

test('the digest is a set-fold, so evaluation order cannot leak into it', () => {
  // The outer aggregate orders by the folded arm text and the inner one orders
  // the rows it concatenates; without both, two sessions could concatenate the
  // same multiset in different orders and disagree.
  assert.match(CATALOG_VERSION_SQL, /string_agg\(arm, '\|' ORDER BY arm\)/);
  assert.match(CATALOG_VERSION_SQL, /string_agg\(row_text, '' ORDER BY row_text\)/);
  assert.match(CATALOG_VERSION_SQL, /md5\(string_agg\(/);
});

test('timestamps are subtracted BY TYPE, never by a hand-kept column list', () => {
  assert.match(CATALOG_VERSION_SQL, /data_type LIKE 'timestamp%'/);
  // A name list would silently stop excluding a future timestamp column under a
  // new name, which is the only thing standing between this digest and the
  // session's TimeZone.
  assert.equal(/\bcreated_at\b/.test(CATALOG_VERSION_SQL), false);
  assert.equal(/\bupdated_at\b/.test(CATALOG_VERSION_SQL), false);
  assert.equal(/(?:^|\s)(?:timezone|datestyle|set\s)/i.test(CATALOG_VERSION_SQL), false);
  assert.equal(/to_char/i.test(CATALOG_VERSION_SQL), false);
  assert.equal(/::\s*timestamp/i.test(CATALOG_VERSION_SQL), false);
});

test('the statement carries no clock and no randomness', () => {
  for (const forbidden of ['now()', 'current_timestamp', 'clock_timestamp', 'random()', 'gen_random']) {
    assert.equal(CATALOG_VERSION_SQL.includes(forbidden), false, forbidden + ' must not appear');
  }
});

test('the whole row is hashed, minus its timestamps', () => {
  assert.match(CATALOG_VERSION_SQL, /to_jsonb\(row_value\)/);
  assert.match(CATALOG_VERSION_SQL, /count\(\*\)::text AS row_count/);
  // A NULL array (no timestamp column at all) must not null out the row text.
  assert.match(CATALOG_VERSION_SQL, /COALESCE\(\(/);
  assert.match(CATALOG_VERSION_SQL, /ARRAY\[\]::text\[\]/);
});

test('the arms are data-driven and the builder is deterministic', () => {
  assert.equal(buildCatalogVersionSql(CATALOG_COVERED_TABLES), CATALOG_VERSION_SQL);
  assert.equal(buildCatalogVersionSql(CATALOG_COVERED_TABLES), buildCatalogVersionSql(CATALOG_COVERED_TABLES));
  const single = buildCatalogVersionSql(['product']);
  assert.equal((single.match(/UNION ALL/g) || []).length, 0);
  assert.ok(single.includes("'product' AS tbl"));
});

test('a table name is quoted, so a surprising name cannot break out of its arm', () => {
  const arm = fingerprintArm("o'brien; DROP TABLE product");
  assert.ok(arm.includes("'o''brien; DROP TABLE product' AS tbl"));
});

// ---------------------------------------------------------------------------
// catalogVersion(db)
// ---------------------------------------------------------------------------

test('catalogVersion issues exactly one parameterless query and returns the digest', async () => {
  const db = fakeDb({ catalog_version: DIGEST });
  const result = await catalogVersion(db);
  assert.equal(result, DIGEST);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].sql, CATALOG_VERSION_SQL);
  assert.equal(db.calls[0].params, undefined);
});

test('the digest shape is pinned to 32 lower-case hex characters', () => {
  assert.equal(CATALOG_VERSION_RE.test(DIGEST), true);
  assert.equal(CATALOG_VERSION_RE.test(DIGEST.toUpperCase()), false);
  assert.equal(CATALOG_VERSION_RE.test(DIGEST.slice(1)), false);
  assert.equal(CATALOG_VERSION_RE.test(DIGEST + 'a'), false);
  assert.equal(CATALOG_VERSION_RE.test('z'.repeat(32)), false);
});

test('a missing or malformed digest fails fast instead of returning a junk key', async () => {
  const badResults = [
    undefined, // no rows at all
    { catalog_version: null },
    { catalog_version: undefined },
    { catalog_version: '' },
    { catalog_version: DIGEST.toUpperCase() },
    { catalog_version: DIGEST.slice(1) },
    { catalog_version: 12345 },
    { catalog_version: { toString: () => DIGEST } },
  ];
  for (const row of badResults) {
    await assert.rejects(
      () => catalogVersion(fakeDb(row)),
      (error) => {
        assert.ok(error instanceof CandidateSelectionError);
        assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
        assert.equal(error.field, 'catalog_version');
        return true;
      },
      'a junk digest must refuse rather than hand a caller a key it will persist'
    );
  }
});

test('a result without rows refuses rather than reading through undefined', async () => {
  const shapes = [{}, null, undefined, { rows: null }, { rows: 'nope' }];
  for (const shape of shapes) {
    const db = { async query() { return shape; } };
    await assert.rejects(
      () => catalogVersion(db),
      (error) => error.code === ERROR_CODES.INVALID_INPUT && error.field === 'catalog_version'
    );
  }
});

test('a database client that is not a client is rejected before any query', async () => {
  for (const bad of [null, undefined, '', 'db', 42, {}, { query: 'nope' }, []]) {
    await assert.rejects(
      () => catalogVersion(bad),
      (error) => {
        assert.ok(error instanceof CandidateSelectionError);
        assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
        assert.equal(error.field, 'db');
        return true;
      }
    );
  }
});

test('a database error propagates unchanged: what it means is the caller policy', async () => {
  const sentinel = Object.assign(new Error('relation "product" does not exist'), { code: '42P01' });
  const db = { async query() { throw sentinel; } };
  await assert.rejects(
    () => catalogVersion(db),
    (error) => error === sentinel,
    'the module must not wrap, swallow, or reinterpret a database failure'
  );
});
