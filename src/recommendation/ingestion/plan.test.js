'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildPlan, planCounts, formatPlan } = require('./plan');

function listing(overrides) {
  return Object.assign({
    line: 2,
    source: 'manual',
    store_name: 'Seed UltraPC',
    listing_identifier: 'L-1',
    product_url: 'https://example.test/L-1',
    raw_price: '1299',
    price: 1299,
    currency: 'MAD',
    availability: 'IN_STOCK',
    observed_at: '2026-10-01T00:00:00.000Z',
    title: 'Seed Ryzen 5 7500F',
    sku: null,
    mpn: null,
    source_note: 'collected 2026-10-01',
    raw_data: {},
  }, overrides || {});
}

const CATALOG = [
  { product_id: 'p1', product_variant_id: 'v1', sku: 'SEED-R5-7500F', mpn: null, name: 'Seed Ryzen 5 7500F' },
];

function context(existing) {
  return {
    storesByName: new Map([['Seed UltraPC', 'store-1']]),
    catalog: CATALOG,
    existingByKey: new Map(existing || []),
  };
}

test('a listing with no stored offer is NEW', () => {
  const plan = buildPlan([listing({ sku: 'SEED-R5-7500F' })], context());
  assert.equal(plan.newOffers.length, 1);
  assert.equal(plan.newOffers[0].match.matched_product_id, 'p1');
});

test('a changed price is CHANGED and an identical one is UNCHANGED', () => {
  const changed = buildPlan(
    [listing({ sku: 'SEED-R5-7500F', price: 1399 })],
    context([['store-1\u0000L-1', { id: 'o1', price: 1299, availability: 'IN_STOCK' }]])
  );
  assert.equal(changed.changed.length, 1);
  assert.deepEqual(changed.changed[0].promotion.changedFields, ['price']);

  const same = buildPlan(
    [listing({ sku: 'SEED-R5-7500F' })],
    context([['store-1\u0000L-1', { id: 'o1', price: 1299, availability: 'IN_STOCK' }]])
  );
  assert.equal(same.unchanged.length, 1);
  assert.equal(same.changed.length, 0);
});

test('an unmatched listing goes to the unmatched bucket, never to a new offer', () => {
  const plan = buildPlan([listing({ sku: null, title: 'Unknown Widget' })], context());
  assert.equal(plan.unmatched.length, 1);
  assert.equal(plan.newOffers.length, 0);
});

test('an unknown store is rejected defensively', () => {
  const plan = buildPlan([listing({ store_name: 'Nope' })], context());
  assert.equal(plan.rejected.length, 1);
  assert.equal(plan.rejected[0].reason, 'UNKNOWN_STORE');
});

test('planCounts and formatPlan report every bucket', () => {
  const plan = buildPlan(
    [listing({ sku: 'SEED-R5-7500F', line: 2 }), listing({ sku: null, title: 'Nope', listing_identifier: 'L-2', line: 3 })],
    context()
  );
  const counts = planCounts(plan, [{ line: 4, errors: [{ field: 'raw_price', reason: 'PRICE_EMPTY' }] }]);
  assert.equal(counts.new, 1);
  assert.equal(counts.unmatched, 1);
  assert.equal(counts.rejected, 1);
  const text = formatPlan(plan, [{ line: 4, errors: [{ field: 'raw_price', reason: 'PRICE_EMPTY' }] }]);
  assert.match(text, /new:\s+1/);
  assert.match(text, /rejected:\s+1/);
  assert.match(text, /\[NEW\] line 2/);
  assert.match(text, /raw_price:PRICE_EMPTY/);
});
