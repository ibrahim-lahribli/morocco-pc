'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { evaluateOfferProvenance } = require('../../gates/check-offer-provenance');

const store = { id: 's1', name: 'inmedia.ma', website_url: 'https://inmedia.ma' };
function offer(overrides = {}) {
  return Object.assign({
    id: 'o1',
    store_id: 's1',
    store_name: 'inmedia.ma',
    website_url: 'https://inmedia.ma',
    listing_identifier: 'LIST-001',
    product_url: 'https://inmedia.ma/product/1',
    seller_name: 'InMedia',
    fetched_at: new Date('2026-11-10T10:00:00Z').toISOString(),
    ingestion_record_id: 'rec-1',
  }, overrides);
}

test('provenance: complete evidence is PASS', () => {
  const r = evaluateOfferProvenance([offer()], [{ store_offer_id: 'o1', ingestion_record_id: 'rec-1' }], { asOf: new Date('2026-11-15T12:00:00Z') });
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.problems.length, 0);
});

test('provenance: empty catalog is INCONCLUSIVE, never PASS', () => {
  const r = evaluateOfferProvenance([], [], { asOf: new Date('2026-11-15T12:00:00Z') });
  assert.equal(r.verdict, 'INCONCLUSIVE');
});

test('provenance: missing listing identifier is FAIL', () => {
  const r = evaluateOfferProvenance([offer({ listing_identifier: null })], [], { asOf: new Date('2026-11-15T12:00:00Z') });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.problems.find((p) => p.class === 'MISSING_LISTING_IDENTIFIER') != null, true);
});

test('provenance: missing seller is FAIL', () => {
  const r = evaluateOfferProvenance([offer({ seller_name: null })], [], { asOf: new Date('2026-11-15T12:00:00Z') });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.problems.find((p) => p.class === 'MISSING_SELLER') != null, true);
});

test('provenance: URL host mismatch with store is FAIL', () => {
  const r = evaluateOfferProvenance([offer({ product_url: 'https://other.ma/product/1' })], [], { asOf: new Date('2026-11-15T12:00:00Z') });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.problems.find((p) => p.class === 'URL_HOST_MISMATCH') != null, true);
});

test('provenance: future fetched_at is FAIL', () => {
  const r = evaluateOfferProvenance([offer({ fetched_at: new Date('2026-12-01T10:00:00Z').toISOString() })], [], { asOf: new Date('2026-11-15T12:00:00Z') });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.problems.find((p) => p.class === 'FETCHED_AT_INVALID') != null, true);
});

test('provenance: price history not traced to ingestion record is FAIL', () => {
  const r = evaluateOfferProvenance([offer()], [{ store_offer_id: 'o1', ingestion_record_id: null }], { asOf: new Date('2026-11-15T12:00:00Z') });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.problems.find((p) => p.class === 'HISTORY_UNTRACED') != null, true);
});

test('provenance: multiple problems are all reported', () => {
  const r = evaluateOfferProvenance([offer({ listing_identifier: null, seller_name: null })], [], { asOf: new Date('2026-11-15T12:00:00Z') });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.problems.length, 2);
});
