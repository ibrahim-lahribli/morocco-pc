'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { evaluateOfferFreshness, DEFAULT_MAX_AGE_DAYS } = require('../../gates/check-offer-freshness');

const asOf = new Date('2026-11-15T12:00:00Z');
const oneDay = 24 * 60 * 60 * 1000;
function offered(daysAgo, verified) {
  return { id: String(Math.random()), ingestion_record_id: verified ? 'rec-1' : null, last_checked_at: new Date(asOf.getTime() - daysAgo * oneDay).toISOString() };
}

test('freshness: empty catalog is INCONCLUSIVE, never PASS', () => {
  const r = evaluateOfferFreshness([], { asOf });
  assert.equal(r.verdict, 'INCONCLUSIVE');
});

test('freshness: all verified offers fresh is PASS', () => {
  const r = evaluateOfferFreshness([offered(5, true), offered(10, true)], { asOf });
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.counts.verifiedTotal, 2);
  assert.equal(r.counts.verifiedFresh, 2);
  assert.equal(r.counts.verifiedExpired, 0);
});

test('freshness: any verified offer expired is FAIL', () => {
  const r = evaluateOfferFreshness([offered(5, true), offered(35, true)], { asOf });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.counts.verifiedExpired, 1);
});

test('freshness: verified offer with unknown age is FAIL', () => {
  const r = evaluateOfferFreshness([{ id: 'x', ingestion_record_id: 'rec-1', last_checked_at: null }], { asOf });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.counts.verifiedUnknownAge, 1);
});

test('freshness: seed offers never fail the gate', () => {
  const r = evaluateOfferFreshness([offered(35, false)], { asOf });
  assert.equal(r.verdict, 'INCONCLUSIVE');
  assert.equal(r.counts.seedExpired, 1);
});

test('freshness: boundary at exactly maxAgeDays is fresh, not expired', () => {
  const r = evaluateOfferFreshness([offered(DEFAULT_MAX_AGE_DAYS, true)], { asOf });
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.counts.verifiedFresh, 1);
});

test('freshness: one day past the window is expired', () => {
  const r = evaluateOfferFreshness([offered(DEFAULT_MAX_AGE_DAYS + 1, true)], { asOf });
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.counts.verifiedExpired, 1);
});
