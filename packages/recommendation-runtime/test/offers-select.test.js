'use strict';

// packages/recommendation-runtime/test/offers-select.test.js — Engine 2 stage 1
// (offer pre-selection) now lives in this package, batch `step-5-w1-offers`.
//
// What it proves, and why each point is here rather than in the L1 suite that
// stayed at the old path (src/recommendation/offers/select.test.js):
//   1. the module is loadable from its NEW path and still exports both names,
//      so the move did not depend on the old shim existing;
//   2. the old path is the SAME module by identity (same function object), not
//      a second copy that could drift - this is what makes "the shim is
//      compatibility" a fact instead of a claim;
//   3. the SQL still carries $1..$4 with no interpolation: three parameters on
//      the transaction-clock path and the explicit $4::timestamptz as-of
//      variant (Decision 38), unchanged by the move;
//   4. one selection returns the frozen { input, pool, prices } carrier.
//
// DB-free: the query is issued against a fake client that records its calls.
// No database, no environment, no clock read.
//
//   npm run test:runtime        (from the repo root)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { selectOfferPrices, SELECT_OFFER_PRICES_SQL } = require('../src/offers/select');
const shim = require('../../../src/recommendation/offers/select');

const STORE_A = '11111111-1111-4111-8111-111111111111';
const OFFER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DECISION_TS = '2026-09-14T12:00:00.000Z';

const INPUT = {
  budget_amount: 8000,
  currency: 'MAD',
  use_case: 'GAMING',
  required_roles: ['CPU', 'GPU', 'PSU'],
};

function cpu(id) {
  return { product_id: id, product_variant_id: null, category: 'CPU', component_role: 'CPU' };
}

/** Fake pg-compatible client: records (sql, params) and stamps the decision time. */
function makeDb(rows, checkedAt = DECISION_TS) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: rows.map((row) => ({ price_checked_at: checkedAt, ...row })) };
    },
  };
}

function offerRow(overrides = {}) {
  return {
    id: OFFER_ID,
    store_id: STORE_A,
    product_id: 'cpu-1',
    product_variant_id: null,
    price: 100,
    currency: 'MAD',
    availability: 'IN_STOCK',
    last_checked_at: '2026-09-10T12:00:00.000Z',
    ingestion_record_id: null,
    ...overrides,
  };
}

function poolResult(pool, input = INPUT) {
  return { input: { ...input }, pool };
}

test('loads from the runtime package and exports both names', () => {
  assert.equal(typeof selectOfferPrices, 'function');
  assert.equal(typeof SELECT_OFFER_PRICES_SQL, 'string');
  assert.ok(SELECT_OFFER_PRICES_SQL.includes('FROM store_offer'));
});

test('the old path is the same module by identity, not a second implementation', () => {
  assert.equal(shim.selectOfferPrices, selectOfferPrices);
  assert.equal(shim.SELECT_OFFER_PRICES_SQL, SELECT_OFFER_PRICES_SQL);
});

test('the SQL keeps $1..$3 and no interpolation on the transaction-clock path', () => {
  for (const token of ['$1', '$2', '$3']) {
    assert.ok(SELECT_OFFER_PRICES_SQL.includes(token), 'SQL must contain ' + token);
  }
  assert.ok(!SELECT_OFFER_PRICES_SQL.includes('$4'), 'the base query takes three parameters');
  assert.ok(!SELECT_OFFER_PRICES_SQL.includes('${'), 'no template interpolation');
  assert.ok(SELECT_OFFER_PRICES_SQL.includes('CURRENT_TIMESTAMP AS price_checked_at'));
});

test('an explicit asOf issues the $4 variant and moves no other placeholder', async () => {
  const db = makeDb([offerRow({})]);
  await selectOfferPrices(poolResult([cpu('cpu-1')]), db, { asOf: DECISION_TS });
  assert.equal(db.calls.length, 1);
  const { sql, params } = db.calls[0];
  for (const token of ['$1', '$2', '$3', '$4']) {
    assert.ok(sql.includes(token), 'as-of SQL must contain ' + token);
  }
  assert.ok(sql.includes('$4::timestamptz'));
  assert.ok(!sql.includes('CURRENT_TIMESTAMP'));
  assert.equal(params.length, 4);
  assert.equal(params[3], DECISION_TS);
});

test('one selection returns a frozen { input, pool, prices } carrier', async () => {
  const db = makeDb([offerRow({})]);
  const out = await selectOfferPrices(poolResult([cpu('cpu-1')]), db);

  assert.deepEqual(Object.keys(out).sort(), ['input', 'pool', 'prices']);
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.pool));
  assert.ok(Object.isFrozen(out.prices));
  assert.equal(Object.getPrototypeOf(out.prices), null);
  assert.deepEqual(out.pool.map((candidate) => candidate.product_id), ['cpu-1']);

  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, [['cpu-1'], 'MAD', false]);
});
