'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { selectOfferPrices, SELECT_OFFER_PRICES_SQL } = require('./select');
const { priceKey, validatePrices } = require('../assembly/prices');
const { ERROR_CODES, CandidateSelectionError } = require('../candidates/errors');

const STORE_A = '11111111-1111-4111-8111-111111111111';
const STORE_B = '22222222-2222-4222-8222-222222222222';
const DECISION_TS = '2026-09-14T12:00:00.000Z';
const DECISION_DATE = new Date(DECISION_TS);
const LAST_FRESH = '2026-09-10T12:00:00.000Z';

const BASE_INPUT = {
  budget_amount: 8000,
  currency: 'MAD',
  use_case: 'GAMING',
  required_roles: ['CPU', 'GPU', 'PSU'],
};

function cpu(id) {
  return { product_id: id, product_variant_id: null, category: 'CPU', component_role: 'CPU' };
}

function gpu(productId, variantId) {
  return { product_id: productId, product_variant_id: variantId, category: 'GPU', component_role: 'GPU' };
}

function psu(id) {
  return { product_id: id, product_variant_id: null, category: 'PSU', component_role: 'PSU' };
}

function poolResult(pool, input = BASE_INPUT) {
  return { input: { ...input }, pool };
}

/**
 * Fake pg-compatible DB. Every returned row carries an explicit
 * price_checked_at so tests prove the implementation consumes the query
 * decision timestamp (not last_checked_at). Records calls for assertions.
 */
function makeDb(rows, { checkedAt = DECISION_TS } = {}) {
  const calls = [];
  const withStamp = rows.map((row) => ({ price_checked_at: checkedAt, ...row }));
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: withStamp };
    },
  };
}

function offerRow(overrides = {}) {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    store_id: STORE_A,
    product_id: 'cpu-1',
    product_variant_id: null,
    price: 100,
    currency: 'MAD',
    availability: 'IN_STOCK',
    last_checked_at: LAST_FRESH,
    ...overrides,
  };
}

function msBeforeDecision(ms) {
  return new Date(DECISION_DATE.getTime() - ms).toISOString();
}

test('cheapest eligible offer wins', async () => {
  const db = makeDb([
    offerRow({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', price: 200 }),
    offerRow({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', price: 100, store_id: STORE_B }),
  ]);
  const out = await selectOfferPrices(poolResult([cpu('cpu-1')]), db);
  assert.equal(out.pool.length, 1);
  const entry = out.prices[priceKey('cpu-1', null, 'CPU')];
  assert.equal(entry.selected_price, 100);
  assert.equal(entry.store_id, STORE_B);
});

test('equal price chooses smaller store_offer.id', async () => {
  const db = makeDb([
    offerRow({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', price: 100 }),
    offerRow({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', price: 100 }),
  ]);
  const out = await selectOfferPrices(poolResult([cpu('cpu-1')]), db);
  const key = priceKey('cpu-1', null, 'CPU');
  assert.equal(out.prices[key].selected_price, 100);
});

test('currency mismatch excluded', async () => {
  const db = makeDb([offerRow({ currency: 'USD' })]);
  await assert.rejects(
    () => selectOfferPrices(poolResult([cpu('cpu-1')]), db),
    (err) => err instanceof CandidateSelectionError && err.code === ERROR_CODES.EMPTY_CANDIDATE_POOL
  );
});

test('stale offer excluded', async () => {
  const db = makeDb([offerRow({ last_checked_at: msBeforeDecision(31 * 24 * 60 * 60 * 1000) })]);
  await assert.rejects(
    () => selectOfferPrices(poolResult([cpu('cpu-1')]), db),
    (err) => err instanceof CandidateSelectionError && err.code === ERROR_CODES.EMPTY_CANDIDATE_POOL
  );
});

test('exactly-30-day boundary is represented by the SQL predicate', async () => {
  assert.ok(SELECT_OFFER_PRICES_SQL.includes("INTERVAL '30 days'"));
  assert.ok(SELECT_OFFER_PRICES_SQL.includes('o.last_checked_at >= CURRENT_TIMESTAMP - INTERVAL'));
  const db = makeDb([offerRow({ last_checked_at: msBeforeDecision(30 * 24 * 60 * 60 * 1000) })]);
  const out = await selectOfferPrices(poolResult([cpu('cpu-1')]), db);
  assert.equal(out.pool.length, 1);
});

test('future last_checked_at remains eligible', async () => {
  const db = makeDb([offerRow({ last_checked_at: new Date(DECISION_DATE.getTime() + 86400000).toISOString() })]);
  const out = await selectOfferPrices(poolResult([cpu('cpu-1')]), db);
  assert.equal(out.pool.length, 1);
});

test('OUT_OF_STOCK excluded', async () => {
  const db = makeDb([offerRow({ availability: 'OUT_OF_STOCK' })]);
  await assert.rejects(
    () => selectOfferPrices(poolResult([cpu('cpu-1')]), db),
    (err) => err instanceof CandidateSelectionError && err.code === ERROR_CODES.EMPTY_CANDIDATE_POOL
  );
});

test('product-level candidate only matches NULL-variant offer', async () => {
  const db = makeDb([
    offerRow({ product_variant_id: 'var-1', price: 10 }),
    offerRow({ product_variant_id: null, price: 100 }),
  ]);
  const out = await selectOfferPrices(poolResult([cpu('cpu-1')]), db);
  assert.equal(out.prices[priceKey('cpu-1', null, 'CPU')].selected_price, 100);
});

test('variant candidate only matches exact product+variant offer', async () => {
  const db = makeDb([
    offerRow({ product_id: 'gpu-1', product_variant_id: 'var-9', price: 500 }),
  ]);
  const out = await selectOfferPrices(
    poolResult([gpu('gpu-1', 'var-9')], { ...BASE_INPUT, required_roles: ['GPU'] }),
    db
  );
  assert.equal(out.prices[priceKey('gpu-1', 'var-9', 'GPU')].selected_price, 500);
});

test('wrong variant excluded', async () => {
  const db = makeDb([
    offerRow({ product_id: 'gpu-1', product_variant_id: 'var-other', price: 10 }),
  ]);
  await assert.rejects(
    () => selectOfferPrices(
      poolResult([gpu('gpu-1', 'var-9')], { ...BASE_INPUT, required_roles: ['GPU'] }),
      db
    ),
    (err) => err instanceof CandidateSelectionError && err.code === ERROR_CODES.EMPTY_CANDIDATE_POOL
  );
});

test('candidates without offers disappear from pool', async () => {
  const db = makeDb([offerRow({ product_id: 'cpu-1' })]);
  const out = await selectOfferPrices(poolResult([cpu('cpu-1'), psu('psu-9')]), db);
  assert.deepEqual(out.pool.map((c) => c.product_id), ['cpu-1']);
  assert.deepEqual(Object.keys(out.prices), [priceKey('cpu-1', null, 'CPU')]);
});

test('original candidate order is preserved', async () => {
  const db = makeDb([
    offerRow({ product_id: 'cpu-b' }),
    offerRow({ product_id: 'cpu-a' }),
    offerRow({ product_id: 'cpu-c' }),
  ]);
  const out = await selectOfferPrices(poolResult([cpu('cpu-b'), cpu('cpu-a'), cpu('cpu-c')]), db);
  assert.deepEqual(out.pool.map((c) => c.product_id), ['cpu-b', 'cpu-a', 'cpu-c']);
});

test('all candidates excluded throws EMPTY_CANDIDATE_POOL', async () => {
  const db = makeDb([offerRow({ currency: 'USD' })]);
  await assert.rejects(
    () => selectOfferPrices(poolResult([cpu('cpu-1'), psu('psu-1')]), db),
    (err) => {
      assert.ok(err instanceof CandidateSelectionError);
      assert.equal(err.code, ERROR_CODES.EMPTY_CANDIDATE_POOL);
      assert.equal(err.field, 'candidates');
      return true;
    }
  );
});

test('generated carrier passes validatePrices', async () => {
  const db = makeDb([offerRow({})]);
  const out = await selectOfferPrices(poolResult([cpu('cpu-1')]), db);
  const revalidated = validatePrices(out.prices);
  assert.deepEqual(revalidated, out.prices);
});

test('carrier is null-prototype and frozen', async () => {
  const db = makeDb([offerRow({})]);
  const out = await selectOfferPrices(poolResult([cpu('cpu-1')]), db);
  assert.equal(Object.getPrototypeOf(out.prices), null);
  assert.ok(Object.isFrozen(out.prices));
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.pool));
});

test('price_checked_at comes from CURRENT_TIMESTAMP, not last_checked_at', async () => {
  const customStamp = '2026-09-13T09:30:00.000Z';
  const db = makeDb([offerRow({ last_checked_at: '2026-08-20T00:00:00.000Z' })], { checkedAt: customStamp });
  const out = await selectOfferPrices(poolResult([cpu('cpu-1')]), db);
  const entry = out.prices[priceKey('cpu-1', null, 'CPU')];
  assert.equal(entry.price_checked_at, new Date(customStamp).toISOString());
  assert.notEqual(entry.price_checked_at, new Date('2026-08-20T00:00:00.000Z').toISOString());
});

test('price_checked_at accepts Date decision timestamps', async () => {
  const db = makeDb([offerRow({})], { checkedAt: new Date(DECISION_TS) });
  const out = await selectOfferPrices(poolResult([cpu('cpu-1')]), db);
  assert.equal(out.prices[priceKey('cpu-1', null, 'CPU')].price_checked_at, DECISION_TS);
});

test('NUMERIC string price converts correctly', async () => {
  const db = makeDb([offerRow({ price: '1299.50' })]);
  const out = await selectOfferPrices(poolResult([cpu('cpu-1')]), db);
  assert.equal(out.prices[priceKey('cpu-1', null, 'CPU')].selected_price, 1299.5);
});

test('only one DB query is issued', async () => {
  const db = makeDb([offerRow({}), offerRow({ product_id: 'psu-1' })]);
  await selectOfferPrices(poolResult([cpu('cpu-1'), psu('psu-1')]), db);
  assert.equal(db.calls.length, 1);
});

test('SQL contains required clauses and no forbidden tokens', async () => {
  const required = [
    'FROM store_offer',
    "o.last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'",
    "o.availability != 'OUT_OF_STOCK'",
    'ORDER BY o.price ASC, o.id ASC',
    'CURRENT_TIMESTAMP AS price_checked_at',
    '$1',
    '$2',
  ];
  for (const token of required) {
    assert.ok(SELECT_OFFER_PRICES_SQL.includes(token), `SQL must contain ${token}`);
  }
  const forbidden = ['statement_timestamp', 'clock_timestamp', 'price_history', 'new Date()'];
  const lowered = SELECT_OFFER_PRICES_SQL.toLowerCase();
  for (const token of forbidden) {
    assert.ok(!lowered.includes(token), `SQL must not contain ${token}`);
  }
  const source = fs.readFileSync(path.join(__dirname, 'select.js'), 'utf8');
  assert.ok(!source.includes('price_history'));
  assert.ok(!source.includes('statement_timestamp'));
  assert.ok(!source.includes('clock_timestamp'));
});

test('query is parameterized with product ids and currency', async () => {
  const db = makeDb([offerRow({ product_id: 'cpu-1' })]);
  await selectOfferPrices(poolResult([cpu('cpu-1')]), db);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, [['cpu-1'], 'MAD']);
});

test('no second engine behavior is introduced', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'select.js'), 'utf8');
  const required = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual(
    required.sort(),
    ['../assembly/prices', '../candidates/candidate', '../candidates/errors', '../candidates/input'].sort()
  );
  const bannedBehavior = [
    'filterCandidates',
    'assembleBuilds',
    'lookupPrice(',
    'resolveGpuRequirement',
    'is_active',
    'price_history',
    'statement_timestamp',
    'clock_timestamp',
  ];
  for (const token of bannedBehavior) {
    assert.ok(!source.includes(token), `select.js must not contain ${token}`);
  }
  const barrel = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.ok(barrel.includes('selectOfferPrices'));
});

test('repeated and shuffled equivalent rows produce deterministic output', async () => {
  const rows = [
    offerRow({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', product_id: 'cpu-1', price: 200 }),
    offerRow({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', product_id: 'cpu-1', price: 100 }),
    offerRow({ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', product_id: 'psu-1', price: 50 }),
  ];
  const shuffled = [rows[2], rows[0], rows[1]];
  const first = await selectOfferPrices(poolResult([cpu('cpu-1'), psu('psu-1')]), makeDb(rows));
  const second = await selectOfferPrices(poolResult([cpu('cpu-1'), psu('psu-1')]), makeDb(shuffled));
  assert.deepEqual(second.pool, first.pool);
  assert.deepEqual(second.prices, first.prices);
});

test('invalid pool result and db fail without a query', async () => {
  const db = makeDb([offerRow({})]);
  const before = db.calls.length;
  await assert.rejects(() => selectOfferPrices({ input: BASE_INPUT, pool: [] }, db));
  await assert.rejects(() => selectOfferPrices(poolResult([cpu('cpu-1')]), null));
  assert.equal(db.calls.length, before);
});
