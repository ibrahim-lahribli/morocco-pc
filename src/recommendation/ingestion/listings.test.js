'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseMadAmount, validateListings } = require('./listings');

const NOW = new Date('2026-10-06T12:00:00Z');

function baseRow(overrides) {
  return Object.assign({
    source: 'manual',
    store_name: 'Seed UltraPC',
    listing_identifier: 'L-1',
    raw_price: '1299',
    currency: 'MAD',
    availability: 'IN_STOCK',
    observed_at: '2026-10-01T00:00:00Z',
    title: 'Seed Ryzen 5 7500F',
    __line: 2,
  }, overrides || {});
}

test('parseMadAmount parses common Moroccan price forms', () => {
  assert.equal(parseMadAmount('1299').amount, 1299);
  assert.equal(parseMadAmount('1 299').amount, 1299);
  assert.equal(parseMadAmount('1 299,00').amount, 1299);
  assert.equal(parseMadAmount('1,299.00').amount, 1299);
  assert.equal(parseMadAmount('1.234,56').amount, 1234.56);
  assert.equal(parseMadAmount('39,99').amount, 39.99);
  assert.equal(parseMadAmount('1299 MAD').amount, 1299);
  assert.equal(parseMadAmount('1 299 DH').amount, 1299);
});

test('parseMadAmount rejects empty, non-positive and unparseable prices', () => {
  assert.equal(parseMadAmount('').reason, 'PRICE_EMPTY');
  assert.equal(parseMadAmount(null).reason, 'PRICE_EMPTY');
  assert.equal(parseMadAmount('-5').reason, 'PRICE_NOT_POSITIVE');
  assert.equal(parseMadAmount('0').reason, 'PRICE_NOT_POSITIVE');
  assert.equal(parseMadAmount('abc').reason, 'PRICE_UNPARSEABLE');
});

test('validateListings accepts a well-formed row and normalizes it', () => {
  const { valid, invalid } = validateListings([baseRow()], {
    now: NOW,
    knownStores: new Set(['Seed UltraPC']),
  });
  assert.equal(invalid.length, 0);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].price, 1299);
  assert.equal(valid[0].observed_at, '2026-10-01T00:00:00.000Z');
  assert.equal(valid[0].line, 2);
  assert.ok(Object.isFrozen(valid[0]));
});

test('validateListings reports required fields with their line number', () => {
  const { valid, invalid } = validateListings(
    [baseRow({ store_name: '', raw_price: '', __line: 7 })],
    { now: NOW }
  );
  assert.equal(valid.length, 0);
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].line, 7);
  const fields = invalid[0].errors.map((e) => e.field);
  assert.ok(fields.includes('store_name'));
  assert.ok(fields.includes('raw_price'));
});

test('validateListings rejects unknown store, unknown currency and future observed_at', () => {
  const { invalid } = validateListings(
    [
      baseRow({ store_name: 'Not A Store', __line: 2 }),
      baseRow({ listing_identifier: 'L-2', currency: 'EUR', __line: 3 }),
      baseRow({ listing_identifier: 'L-3', observed_at: '2027-01-01T00:00:00Z', __line: 4 }),
    ],
    { now: NOW, knownStores: new Set(['Seed UltraPC']) }
  );
  assert.equal(invalid.length, 3);
  assert.equal(invalid[0].errors[0].reason, 'UNKNOWN_STORE');
  assert.equal(invalid[1].errors[0].reason, 'UNKNOWN_CURRENCY');
  assert.equal(invalid[2].errors[0].reason, 'OBSERVED_AT_IN_FUTURE');
});

test('validateListings rejects a duplicate listing_identifier within the file', () => {
  const { valid, invalid } = validateListings(
    [baseRow({ __line: 2 }), baseRow({ __line: 3 })],
    { now: NOW, knownStores: new Set(['Seed UltraPC']) }
  );
  assert.equal(valid.length, 1);
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].errors[0].reason, 'DUPLICATE_LISTING_IDENTIFIER');
});
