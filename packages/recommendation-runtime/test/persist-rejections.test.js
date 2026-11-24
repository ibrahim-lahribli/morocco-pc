'use strict';

// packages/recommendation-runtime/test/persist-rejections.test.js — Engine 5b's
// rejection writer now lives in this package, batch `step-5-w2-persistence`.
//
// What it proves, beyond the L1 suite that stayed at the old path
// (src/recommendation/persistence/persist-rejections.test.js):
//   1. the writer loads from its NEW path and the old path is the same module
//      by identity;
//   2. the Decision 31 replace sequence is exactly DELETE-then-INSERT, both
//      scoped to this query, and a re-commit repeats the same sequence rather
//      than appending;
//   3. an empty rejection set still issues the DELETE (and no INSERT), which is
//      how a stale set is cleared;
//   4. PASS/UNKNOWN verdicts are filtered out here, and the writer's
//      `reason` -> `reason_code` mapping survives the move;
//   5. a malformed input issues no statement and raises the core's error class.
//
// DB-free: a recording fake client that implements query(sql, params) only.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { persistRejections } = require('../src/persistence/persist-rejections');
const shim = require('../../../src/recommendation/persistence/persist-rejections');
const core = require('../../../packages/recommendation-core');

const QUERY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const DELETE_SQL = 'DELETE FROM build_rejection WHERE recommendation_query_id = $1';
const INSERT_SQL =
  'INSERT INTO build_rejection ('
  + 'id, recommendation_query_id, component_role, product_id, product_variant_id, '
  + 'partner_product_id, partner_product_variant_id, reason_code'
  + ') SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::component_role[], $4::uuid[], '
  + '$5::uuid[], $6::uuid[], $7::uuid[], $8::text[])';

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

function verdict(overrides) {
  return Object.assign(
    {
      status: 'REJECT',
      component_role: 'GPU',
      product_id: 'gpu-1',
      product_variant_id: null,
      partner_product_id: null,
      partner_product_variant_id: null,
      reason: 'GPU_TOO_THICK',
    },
    overrides
  );
}

test('loads from the runtime package and the old path is the same module', () => {
  assert.equal(typeof persistRejections, 'function');
  assert.equal(shim.persistRejections, persistRejections);
});

test('the replace sequence is DELETE then one INSERT carrying only REJECT verdicts', async () => {
  const client = makeClient();
  const result = await persistRejections({
    client,
    queryId: QUERY_ID,
    rejections: [verdict({}), verdict({ status: 'PASS', product_id: 'gpu-2' }), verdict({ product_id: 'gpu-3' })],
  });

  assert.deepEqual(client.calls.map((call) => call.sql), [DELETE_SQL, INSERT_SQL]);
  assert.deepEqual(client.calls[0].params, [QUERY_ID]);

  const insert = client.calls[1];
  assert.deepEqual(insert.params.map((array) => array.length), [2, 2, 2, 2, 2, 2, 2, 2]);
  assert.deepEqual(insert.params[1], [QUERY_ID, QUERY_ID]);
  assert.deepEqual(insert.params[2], ['GPU', 'GPU']);
  assert.deepEqual(insert.params[3], ['gpu-1', 'gpu-3']);
  assert.deepEqual(insert.params[7], ['GPU_TOO_THICK', 'GPU_TOO_THICK']);
  assert.deepEqual(insert.params[0], result.build_rejection_ids);
  assert.equal(result.rejection_count, 2);
  assert.equal(result.query_id, QUERY_ID);
});

test('a re-commit repeats the same sequence instead of appending', async () => {
  const client = makeClient();
  const args = { client, queryId: QUERY_ID, rejections: [verdict({})] };
  await persistRejections(args);
  await persistRejections(args);
  assert.deepEqual(
    client.calls.map((call) => call.sql),
    [DELETE_SQL, INSERT_SQL, DELETE_SQL, INSERT_SQL]
  );
});

test('an empty rejection set still clears the query and inserts nothing', async () => {
  const client = makeClient();
  const result = await persistRejections({ client, queryId: QUERY_ID, rejections: [] });
  assert.deepEqual(client.calls.map((call) => call.sql), [DELETE_SQL]);
  assert.equal(result.rejection_count, 0);
  assert.deepEqual(result.build_rejection_ids, []);
});

test('a variant-keyed partner without its product issues no statement', async () => {
  const client = makeClient();
  await assert.rejects(
    () =>
      persistRejections({
        client,
        queryId: QUERY_ID,
        rejections: [verdict({ partner_product_id: null, partner_product_variant_id: 'variant-1' })],
      }),
    (error) => error instanceof core.candidates.CandidateSelectionError
  );
  assert.deepEqual(client.calls, []);
});
