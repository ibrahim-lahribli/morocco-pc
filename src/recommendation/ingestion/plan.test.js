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

// --- curated catalogue keys (product_slug / variant_sku) ---------------------

const SLUG_CATALOG = [
  { product_id: 'g1', product_variant_id: null, sku: null, mpn: null, product_slug: 'seed-rtx-4060-8gb', name: 'Seed RTX 4060 8GB' },
  { product_id: 'g1', product_variant_id: 'gv1', sku: 'SEED-GPU-4060', mpn: null, product_slug: 'seed-rtx-4060-8gb', name: 'Seed RTX 4060 8GB' },
  { product_id: 'm1', product_variant_id: null, sku: null, mpn: null, product_slug: 'seed-b550m-pro-vdh', name: 'Seed B550M PRO-VDH' },
];

function slugContext(existing) {
  return {
    storesByName: new Map([['Seed UltraPC', 'store-1']]),
    catalog: SLUG_CATALOG,
    existingByKey: new Map(existing || []),
  };
}

test('a curated variant_sku produces a VARIANT-keyed offer (the GPU case)', () => {
  const plan = buildPlan(
    [listing({ product_slug: 'seed-rtx-4060-8gb', variant_sku: 'SEED-GPU-4060', sku: null, title: 'Retailer title sharing no words with the catalogue' })],
    slugContext()
  );
  assert.equal(plan.newOffers.length, 1);
  assert.equal(plan.newOffers[0].match.matched_product_id, 'g1');
  assert.equal(plan.newOffers[0].match.matched_product_variant_id, 'gv1');
  assert.equal(plan.newOffers[0].match.reason, 'CATALOGUE_KEY');
});

test('a curated slug whose product HAS variants is refused without variant_sku', () => {
  // A product-keyed GPU offer is unselectable by offers/select.js, so writing one
  // would look like success and change nothing. Refuse it instead.
  const plan = buildPlan([listing({ product_slug: 'seed-rtx-4060-8gb', sku: null, title: 'x' })], slugContext());
  assert.equal(plan.newOffers.length, 0);
  assert.equal(plan.rejected.length, 1);
  assert.equal(plan.rejected[0].reason, 'VARIANT_SKU_REQUIRED');
});

test('an unknown slug is rejected, never guessed', () => {
  const plan = buildPlan(
    [listing({ product_slug: 'no-such-product', sku: null, title: 'Seed B550M PRO-VDH' })],
    slugContext()
  );
  assert.equal(plan.newOffers.length, 0);
  assert.equal(plan.rejected[0].reason, 'UNKNOWN_PRODUCT_SLUG');
});

test('an unknown or foreign variant_sku is rejected', () => {
  const unknown = buildPlan([listing({ product_slug: 'seed-rtx-4060-8gb', variant_sku: 'NOPE' })], slugContext());
  assert.equal(unknown.rejected[0].reason, 'UNKNOWN_VARIANT_SKU');
  // A real sku, but belonging to a different product, must not resolve.
  const foreign = buildPlan([listing({ product_slug: 'seed-b550m-pro-vdh', variant_sku: 'SEED-GPU-4060' })], slugContext());
  assert.equal(foreign.rejected[0].reason, 'UNKNOWN_VARIANT_SKU');
});

test('a curated product with no variants is product-keyed', () => {
  const plan = buildPlan([listing({ product_slug: 'seed-b550m-pro-vdh', title: 'x' })], slugContext());
  assert.equal(plan.newOffers.length, 1);
  assert.equal(plan.newOffers[0].match.matched_product_id, 'm1');
  assert.equal(plan.newOffers[0].match.matched_product_variant_id, null);
});

test('a variant_sku without a product_slug is rejected, never silently ignored', () => {
  // A sku is only unique WITHIN a product, so the half-specified key cannot be
  // resolved. Falling back to inference would hide the typo behind a plausible match.
  const plan = buildPlan([listing({ variant_sku: 'SEED-GPU-4060', sku: null, title: 'x' })], slugContext());
  assert.equal(plan.newOffers.length, 0);
  assert.equal(plan.changed.length, 0);
  assert.equal(plan.rejected.length, 1);
  assert.equal(plan.rejected[0].reason, 'VARIANT_SKU_WITHOUT_SLUG');
});

test('an uncurated listing keeps the inference path untouched', () => {
  // No product_slug and no variant_sku is the pre-existing path: SKU, then MPN,
  // then name. It must not be diverted by the curated-key guards.
  const plan = buildPlan([listing({ sku: 'SEED-R5-7500F', product_slug: null, variant_sku: null })], context());
  assert.equal(plan.newOffers.length, 1);
  assert.equal(plan.newOffers[0].match.reason, 'SKU_EXACT');
});

test('an ambiguous uncurated listing still goes to REVIEW and never becomes an offer', () => {
  const ambiguous = [
    { product_id: 'n1', product_variant_id: null, sku: null, mpn: null, product_slug: 'a', name: 'Seed Ryzen 5 7500F' },
    { product_id: 'n2', product_variant_id: null, sku: null, mpn: null, product_slug: 'b', name: 'Ryzen 5 7500F Processor' },
  ];
  const plan = buildPlan(
    [listing({ sku: null, mpn: null, product_slug: null, variant_sku: null, title: 'AMD Ryzen 5 7500F Processor' })],
    { storesByName: new Map([['Seed UltraPC', 'store-1']]), catalog: ambiguous, existingByKey: new Map() }
  );
  assert.equal(plan.newOffers.length, 0);
  assert.equal(plan.review.length, 1);
  assert.equal(plan.review[0].match.reason, 'NAME_AMBIGUOUS');
});

test('a curated listing re-planned against its stored offer is UNCHANGED (idempotent)', () => {
  const context = slugContext([['store-1\u0000L-1', { id: 'o1', price: 1299, availability: 'IN_STOCK' }]]);
  const plan = buildPlan([listing({ product_slug: 'seed-rtx-4060-8gb', variant_sku: 'SEED-GPU-4060' })], context);
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.newOffers.length, 0);
  assert.equal(plan.changed.length, 0);
});

// --- a curated re-import may not silently change a stored offer's identity ---

const REIMPORT_CATALOG = [
  { product_id: 'p1', product_variant_id: null, sku: null, mpn: null, product_slug: 'seed-b550m-pro-vdh', name: 'Seed B550M PRO-VDH' },
  { product_id: 'p2', product_variant_id: null, sku: null, mpn: null, product_slug: 'seed-b450m-ds3h', name: 'Seed B450M DS3H' },
  { product_id: 'g1', product_variant_id: null, sku: null, mpn: null, product_slug: 'seed-rtx-4060-8gb', name: 'Seed RTX 4060 8GB' },
  { product_id: 'g1', product_variant_id: 'gv1', sku: 'SEED-GPU-4060', mpn: null, product_slug: 'seed-rtx-4060-8gb', name: 'Seed RTX 4060 8GB' },
];

function reimportContext(stored) {
  return {
    storesByName: new Map([['Seed UltraPC', 'store-1']]),
    catalog: REIMPORT_CATALOG,
    existingByKey: new Map([['store-1\u0000L-1', stored]]),
  };
}

test('a curated re-import naming a different product is rejected, not silently refiled', () => {
  // apply.js never updates product_id, so proceeding would refresh the OLD
  // product's price and report success while ignoring the new key.
  const plan = buildPlan(
    [listing({ product_slug: 'seed-b450m-ds3h', title: 'x' })],
    reimportContext({ id: 'o1', price: 1299, availability: 'IN_STOCK', product_id: 'p1', product_variant_id: null })
  );
  assert.equal(plan.changed.length, 0);
  assert.equal(plan.unchanged.length, 0);
  assert.equal(plan.rejected.length, 1);
  assert.equal(plan.rejected[0].reason, 'OFFER_IDENTITY_MISMATCH');
});

test('a curated re-import that changes only the variant is rejected too', () => {
  const plan = buildPlan(
    [listing({ product_slug: 'seed-rtx-4060-8gb', variant_sku: 'SEED-GPU-4060' })],
    reimportContext({ id: 'o1', price: 1299, availability: 'IN_STOCK', product_id: 'g1', product_variant_id: null })
  );
  assert.equal(plan.rejected.length, 1);
  assert.equal(plan.rejected[0].reason, 'OFFER_IDENTITY_MISMATCH');
});

test('a curated re-import of the SAME identity still refreshes the price', () => {
  const plan = buildPlan(
    [listing({ product_slug: 'seed-b550m-pro-vdh', price: 899, title: 'x' })],
    reimportContext({ id: 'o1', price: 1299, availability: 'IN_STOCK', product_id: 'p1', product_variant_id: null })
  );
  assert.equal(plan.rejected.length, 0);
  assert.equal(plan.changed.length, 1);
  assert.deepEqual(plan.changed[0].promotion.changedFields, ['price']);
});

test('an uncurated re-import keeps the old behaviour: inference is not an assertion', () => {
  // Only a CURATED key is held to the stored identity; an inferred match on a
  // different product still refreshes the stored offer, as it always has.
  const plan = buildPlan(
    [listing({ sku: 'SEED-GPU-4060', price: 899, product_slug: null, variant_sku: null })],
    reimportContext({ id: 'o1', price: 1299, availability: 'IN_STOCK', product_id: 'p1', product_variant_id: null })
  );
  assert.equal(plan.rejected.length, 0);
  assert.equal(plan.changed.length, 1);
});
