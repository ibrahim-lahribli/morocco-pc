'use strict';

// packages/recommendation-runtime/test/persist-pass-facts.test.js — Engine 5b's
// pass-facts writer now lives in this package, batch `step-5-w2-persistence`.
//
// What it proves, beyond the L1 suite that stayed at the old path
// (src/recommendation/persistence/persist-pass-facts.test.js):
//   1. the writer loads from its NEW path and the old path is the same module
//      by identity;
//   2. the statement sequence is the floor UPDATE first, then one result UPDATE
//      per rank, addressed by rank = index + 1 in the caller's order;
//   3. every parameter reaches the driver unchanged, including a null engine
//      version and a jsonb budgetFloor passed through as an object;
//   4. a strategyKeys/selected length mismatch issues no statement at all;
//   5. the writer is UPDATE-only: no INSERT, DELETE or SELECT appears in the
//      text of any statement it issues.
//
// DB-free: a recording fake client that implements query(sql, params) only.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { persistPassFacts } = require('../src/persistence/persist-pass-facts');
const shim = require('../../../src/recommendation/persistence/persist-pass-facts');
const core = require('../../../packages/recommendation-core');

const QUERY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const FLOOR_SQL = 'UPDATE recommendation_query SET budget_floor = $2 WHERE id = $1';
const RESULT_SQL =
  'UPDATE recommendation_result SET engine_version = $1, strategy_key = $2 '
  + 'WHERE recommendation_query_id = $3 AND rank = $4';

function makeClient() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
}

const SELECTED = [{}, {}];
const BUDGET_FLOOR = { currency: 'MAD', per_role: { GPU: 4000 } };

test('loads from the runtime package and the old path is the same module', () => {
  assert.equal(typeof persistPassFacts, 'function');
  assert.equal(shim.persistPassFacts, persistPassFacts);
  assert.equal(shim.UPDATE_RECOMMENDATION_QUERY_FLOOR_SQL, FLOOR_SQL);
  assert.equal(shim.UPDATE_RECOMMENDATION_RESULT_FACTS_SQL, RESULT_SQL);
});

test('the floor comes first, then one result UPDATE per rank in rank order', async () => {
  const client = makeClient();
  const result = await persistPassFacts({
    client,
    queryId: QUERY_ID,
    selected: SELECTED,
    passFacts: { budgetFloor: BUDGET_FLOOR, engineVersion: 'engine@1', strategyKeys: ['PERFORMANCE', null] },
  });

  assert.deepEqual(client.calls.map((call) => call.sql), [FLOOR_SQL, RESULT_SQL, RESULT_SQL]);
  assert.deepEqual(client.calls[0].params, [QUERY_ID, BUDGET_FLOOR]);
  assert.deepEqual(client.calls[1].params, ['engine@1', 'PERFORMANCE', QUERY_ID, 1]);
  assert.deepEqual(client.calls[2].params, ['engine@1', null, QUERY_ID, 2]);
  assert.equal(result.result_updates_issued, 2);
  assert.equal(result.floor_update_issued, true);
});

test('a mismatch between strategyKeys and the persisted rows issues nothing', async () => {
  const client = makeClient();
  await assert.rejects(
    () =>
      persistPassFacts({
        client,
        queryId: QUERY_ID,
        selected: SELECTED,
        passFacts: { budgetFloor: null, engineVersion: null, strategyKeys: ['PERFORMANCE'] },
      }),
    (error) => error instanceof core.candidates.CandidateSelectionError
  );
  assert.deepEqual(client.calls, []);
});

test('every statement it issues is an UPDATE — no INSERT, DELETE or SELECT', async () => {
  const client = makeClient();
  await persistPassFacts({
    client,
    queryId: QUERY_ID,
    selected: SELECTED,
    passFacts: { budgetFloor: null, engineVersion: null, strategyKeys: [null, null] },
  });
  for (const call of client.calls) {
    assert.ok(call.sql.startsWith('UPDATE '), 'statement must be an UPDATE: ' + call.sql);
    assert.ok(!call.sql.includes('INSERT'), 'no INSERT: ' + call.sql);
    assert.ok(!call.sql.includes('DELETE'), 'no DELETE: ' + call.sql);
    assert.ok(!call.sql.includes('SELECT'), 'no SELECT: ' + call.sql);
  }
});
