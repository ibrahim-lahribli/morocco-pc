'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeModelString, matchListing } = require('./matching');

const CATALOG = [
  { product_id: 'p1', product_variant_id: null, sku: null, mpn: '100-100000597', name: 'Seed Ryzen 5 7500F' },
  { product_id: 'p2', product_variant_id: 'v2', sku: 'SEED-GPU-4060', mpn: null, name: 'Seed RTX 4060 8GB' },
  { product_id: 'p3', product_variant_id: null, sku: null, mpn: null, name: 'Seed Ryzen 5 7500F Duplicate' },
];

test('normalizeModelString strips accents, punctuation and the Seed prefix', () => {
  assert.equal(normalizeModelString('Seed Ryzen 5 7500F'), 'RYZEN 5 7500F');
  assert.equal(normalizeModelString('Noctua NH-U12S'), 'NOCTUA NH U12S');
  assert.equal(normalizeModelString('Corsair Vengeance'), 'CORSAIR VENGEANCE');
});

test('exact SKU match is CONFIRMED', () => {
  const res = matchListing({ sku: 'seed-gpu-4060', title: null, mpn: null }, CATALOG);
  assert.equal(res.status, 'MATCHED');
  assert.equal(res.confidence, 'CONFIRMED');
  assert.equal(res.matched_product_id, 'p2');
  assert.equal(res.matched_product_variant_id, 'v2');
});

test('exact MPN match is HIGH', () => {
  const res = matchListing({ sku: null, title: null, mpn: '100-100000597' }, CATALOG);
  assert.equal(res.status, 'MATCHED');
  assert.equal(res.confidence, 'HIGH');
  assert.equal(res.matched_product_id, 'p1');
});

test('an ambiguous name match is REVIEW and never guesses', () => {
  const catalog = [
    { product_id: 'n1', product_variant_id: null, sku: null, mpn: null, name: 'Seed Ryzen 5 7500F' },
    { product_id: 'n2', product_variant_id: null, sku: null, mpn: null, name: 'Ryzen 5 7500F Processor' },
  ];
  const res = matchListing({ sku: null, mpn: null, title: 'AMD Ryzen 5 7500F Processor' }, catalog);
  assert.equal(res.status, 'REVIEW');
  assert.equal(res.confidence, 'MEDIUM');
  assert.equal(res.reason, 'NAME_AMBIGUOUS');
});

test('a unique name match is MEDIUM and MATCHED', () => {
  const catalog = [{ product_id: 'p9', product_variant_id: null, sku: null, mpn: null, name: 'Seed DeepCool AG400' }];
  const res = matchListing({ sku: null, mpn: null, title: 'DeepCool AG400 CPU Cooler' }, catalog);
  assert.equal(res.status, 'MATCHED');
  assert.equal(res.confidence, 'MEDIUM');
  assert.equal(res.matched_product_id, 'p9');
});

test('ambiguity at the top tier is REVIEW and never guesses', () => {
  const catalog = [
    { product_id: 'a1', product_variant_id: null, sku: null, mpn: 'X', name: 'Thing' },
    { product_id: 'a2', product_variant_id: null, sku: null, mpn: 'X', name: 'Other' },
  ];
  const res = matchListing({ sku: null, title: null, mpn: 'X' }, catalog);
  assert.equal(res.status, 'REVIEW');
  assert.equal(res.matched_product_id, null);
  assert.equal(res.candidates.length, 2);
});

test('no match is UNMATCHED with no candidates', () => {
  const res = matchListing({ sku: 'ZZZ', mpn: 'ZZZ', title: 'Totally Unknown Part' }, CATALOG);
  assert.equal(res.status, 'UNMATCHED');
  assert.equal(res.matched_product_id, null);
  assert.equal(res.candidates.length, 0);
});
