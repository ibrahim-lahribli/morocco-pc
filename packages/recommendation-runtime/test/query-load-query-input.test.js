'use strict';

// packages/recommendation-runtime/test/query-load-query-input.test.js — Engine 2D
// precondition: the Decision 10 / 17.1 `recommendation_query` loader now lives
// in this package, batch `step-5-w1-query-scoring`.
//
// What it proves, and why each point is here rather than in the L1 suite that
// stayed at the old path (src/recommendation/query/load-query-input.test.js):
//   1. the module is loadable from its NEW path and still exports its surface,
//      so the move did not depend on the old shim existing;
//   2. the old path is the SAME module by identity (same function object), not
//      a second copy that could drift;
//   3. the SQL is still parameterized on $1 with no interpolation and no clock
//      read — the snapshot transaction is the caller's (Decision 17.5);
//   4. one call returns the frozen { query_id, scoring_model_id, input,
//      resolution, priority } carrier, budget converted per Decision 10.
//
// DB-free: the query is issued against a fake client that records its calls.
// No database, no environment, no clock read.
//
//   npm run test:runtime        (from the repo root)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  loadQueryInput,
  SELECT_QUERY_INPUT_SQL,
  REQUIRED_ROLES,
} = require('../src/query/load-query-input');
const shim = require('../../../src/recommendation/query/load-query-input');

const QUERY_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';

const ROW = {
  id: QUERY_ID,
  budget_amount: '8000',
  currency: 'MAD',
  use_case: 'GAMING',
  scoring_model_id: MODEL_ID,
  resolution: '1440p',
  priority: null,
};

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

test('loads from the runtime package and exports the query surface', () => {
  assert.equal(typeof loadQueryInput, 'function');
  assert.equal(typeof SELECT_QUERY_INPUT_SQL, 'string');
  assert.ok(Array.isArray(REQUIRED_ROLES));
  assert.ok(SELECT_QUERY_INPUT_SQL.includes('FROM recommendation_query'));
});

test('the old path is the same module by identity, not a second implementation', () => {
  assert.equal(shim.loadQueryInput, loadQueryInput);
  assert.equal(shim.SELECT_QUERY_INPUT_SQL, SELECT_QUERY_INPUT_SQL);
  assert.equal(shim.REQUIRED_ROLES, REQUIRED_ROLES);
});

test('the query stays parameterized on $1 with no interpolation', () => {
  assert.ok(SELECT_QUERY_INPUT_SQL.includes('WHERE id = $1'));
  assert.ok(!SELECT_QUERY_INPUT_SQL.includes('${'), 'no template interpolation');
  for (const token of ['begin', 'commit', 'rollback', 'now()', 'current_timestamp']) {
    assert.ok(!SELECT_QUERY_INPUT_SQL.toLowerCase().includes(token), 'SQL must not contain ' + token);
  }
});

test('one call returns the frozen query carrier with the budget converted', async () => {
  const db = makeDb([ROW]);
  const out = await loadQueryInput(QUERY_ID, db);

  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, [QUERY_ID]);
  assert.equal(db.calls[0].sql, SELECT_QUERY_INPUT_SQL);

  assert.ok(Object.isFrozen(out));
  assert.deepEqual(Object.keys(out).sort(), [
    'input',
    'priority',
    'query_id',
    'resolution',
    'scoring_model_id',
  ]);
  assert.equal(out.query_id, QUERY_ID);
  assert.equal(out.scoring_model_id, MODEL_ID);
  assert.equal(out.resolution, '1440p');
  assert.equal(out.priority, null);
  assert.equal(out.input.budget_amount, 8000);
  assert.equal(out.input.currency, 'MAD');
  assert.equal(out.input.use_case, 'GAMING');
  assert.ok(Object.isFrozen(out.input));
});
