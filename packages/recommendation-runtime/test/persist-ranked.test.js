'use strict';

// packages/recommendation-runtime/test/persist-ranked.test.js — Engine 5b's
// ranked writer now lives in this package, batch `step-5-w2-persistence`.
//
// What it proves, and why each point is here rather than in the L1 suite that
// stayed at the old path (src/recommendation/persistence/persist-ranked.test.js):
//   1. the writer is loadable from its NEW path and exports persistRanked;
//   2. the old path is the SAME module by identity, not a second copy;
//   3. one pass issues exactly THREE statements, in the order the commit
//      wrapper depends on (candidates, their components, then the results), with
//      the exact SQL text and the parameter arrays zipped row-by-row;
//   4. the caller's single client is the only connection used: a second client
//      passed alongside receives nothing;
//   5. a zero-build pass and a malformed pass both issue ZERO statements, and
//      the malformed one raises the core's error class (not a copy of it).
//
// DB-free: every statement is issued against a recording fake client that
// implements query(sql, params) and nothing else. No database, no environment,
// no clock read.
//
//   npm run test:runtime        (from the repo root)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { persistRanked } = require('../src/persistence/persist-ranked');
const shim = require('../../../src/recommendation/persistence/persist-ranked');
const core = require('../../../packages/recommendation-core');

const QUERY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OFFER_ID = '33333333-3333-4333-8333-333333333333';

// The three statements, byte for byte. A writer whose SQL text drifts is a
// different contract for the database even when its JS behaviour looks equal.
const SQL_CANDIDATE =
  'INSERT INTO build_candidate (id, recommendation_query_id, total_price, score, compatibility_status)'
  + ' SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::numeric[], $4::numeric[], $5::compatibility_status[])';
const SQL_COMPONENT =
  'INSERT INTO build_component (id, build_candidate_id, product_id, product_variant_id, component_role, selected_price, currency, store_id, price_checked_at, offer_class, store_offer_id)'
  + ' SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::component_role[], $6::numeric[], $7::text[], $8::uuid[], $9::timestamptz[], $10::text[], $11::uuid[])';
const SQL_RESULT =
  'INSERT INTO recommendation_result (id, recommendation_query_id, build_candidate_id, rank, explanation)'
  + ' SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::uuid[], $4::integer[], $5::text[])';

const PRICE = Object.freeze({
  selected_price: 1000,
  currency: 'MAD',
  store_id: null,
  price_checked_at: null,
  offer_id: OFFER_ID,
  offer_class: 'SEED_UNVERIFIED',
});

function component(role, productId) {
  return {
    component_role: role,
    product_id: productId,
    product_variant_id: null,
    category: 'IGNORED-BY-THE-WRITER',
    status: 'PASS',
    price: PRICE,
  };
}

function entry(rank, components) {
  return {
    persisted_rank: rank,
    total_price: 1200 + rank,
    build_score: 70 + rank,
    compatibility_status: 'PASS',
    explanation: 'rank ' + rank,
    build: { currency: 'IGNORED-BY-THE-WRITER', components },
  };
}

/** A recording fake client: it holds no connection and answers nothing. */
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

function selected() {
  return [
    entry(1, [component('CPU', 'cpu-1'), component('GPU', 'gpu-1')]),
    entry(2, [component('PSU', 'psu-1')]),
  ];
}

test('loads from the runtime package and exports persistRanked', () => {
  assert.equal(typeof persistRanked, 'function');
});

test('the old path is the same module by identity, not a second implementation', () => {
  assert.equal(shim.persistRanked, persistRanked);
});

test('one pass issues the three statements in commit order', async () => {
  const client = makeClient();
  const result = await persistRanked({ client, queryId: QUERY_ID, selected: selected() });

  assert.deepEqual(client.calls.map((call) => call.sql), [SQL_CANDIDATE, SQL_COMPONENT, SQL_RESULT]);
  assert.equal(client.calls.length, 3);

  const [candidate, componentCall, resultCall] = client.calls;

  // One parameter per column, one array element per row: 2 builds, 3
  // components, 2 results, and every array in a statement is the same length
  // (UNNEST zips them positionally and pads silently otherwise).
  assert.deepEqual(candidate.params.map((array) => array.length), [2, 2, 2, 2, 2]);
  assert.deepEqual(componentCall.params.map((array) => array.length), [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  assert.deepEqual(resultCall.params.map((array) => array.length), [2, 2, 2, 2, 2]);
  for (const call of client.calls) {
    for (const array of call.params) {
      assert.ok(Array.isArray(array), 'every parameter is an array');
    }
  }

  assert.deepEqual(candidate.params[1], [QUERY_ID, QUERY_ID]);
  assert.deepEqual(candidate.params[2], [1201, 1202]);
  assert.deepEqual(candidate.params[3], [71, 72]);
  assert.deepEqual(candidate.params[4], ['PASS', 'PASS']);
  assert.deepEqual(candidate.params[0], result.build_candidate_ids);

  assert.deepEqual(componentCall.params[2], ['cpu-1', 'gpu-1', 'psu-1']);
  assert.deepEqual(componentCall.params[4], ['CPU', 'GPU', 'PSU']);
  assert.deepEqual(componentCall.params[5], [1000, 1000, 1000]);
  assert.deepEqual(componentCall.params[6], ['MAD', 'MAD', 'MAD']);
  assert.deepEqual(componentCall.params[9], ['SEED_UNVERIFIED', 'SEED_UNVERIFIED', 'SEED_UNVERIFIED']);
  assert.deepEqual(componentCall.params[10], [OFFER_ID, OFFER_ID, OFFER_ID]);

  assert.deepEqual(resultCall.params[3], [1, 2]);
  assert.deepEqual(resultCall.params[4], ['rank 1', 'rank 2']);
  assert.deepEqual(resultCall.params[0], result.recommendation_result_ids);
  assert.deepEqual(result.persisted_ranks, [1, 2]);
  assert.equal(result.query_id, QUERY_ID);
});

test('the injected client is the only connection used', async () => {
  const used = makeClient();
  const unused = makeClient();
  await persistRanked({ client: used, queryId: QUERY_ID, selected: selected() });
  assert.equal(used.calls.length, 3);
  assert.deepEqual(unused.calls, []);
});

test('a zero-build pass issues no statement at all', async () => {
  const client = makeClient();
  const result = await persistRanked({ client, queryId: QUERY_ID, selected: [] });
  assert.deepEqual(client.calls, []);
  assert.deepEqual(result, {
    query_id: QUERY_ID,
    persisted_ranks: [],
    build_candidate_ids: [],
    recommendation_result_ids: [],
  });
});

test('a malformed pass issues no statement and raises the core error class', async () => {
  const client = makeClient();
  const broken = [entry(1, [component('CPU', 'cpu-1')]), entry(3, [component('PSU', 'psu-1')])];
  await assert.rejects(
    () => persistRanked({ client, queryId: QUERY_ID, selected: broken }),
    (error) => error instanceof core.candidates.CandidateSelectionError
  );
  assert.deepEqual(client.calls, []);
});
