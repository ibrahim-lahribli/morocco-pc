'use strict';

// packages/recommendation-runtime/test/offers-index.test.js — the Engine 2
// stage 1 public barrel now lives in this package, batch
// `step-5-w1-final-loaders`.
//
// It is a boundary-only barrel, so the move can prove everything it needs to
// prove by identity: the OLD path and the NEW path must expose the same key
// set, and every key must be the same value, so a consumer cannot observe two
// different modules. `src/recommendation/offers/select.test.js` stays at the old
// path and is the behavioural suite (Decision 65 selection order among it); it
// now exercises the implementation through this shim.
//
// DB-free and dependency-free: loading the barrel executes no query.
//
//   npm run test:runtime        (from the repo root)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const barrel = require('../src/offers');
const shim = require('../../../src/recommendation/offers');

test('offers barrel: the old path is the same module as the new path', () => {
  assert.equal(shim, barrel);
});

test('offers barrel: both paths expose an identical key set', () => {
  assert.deepEqual(Object.keys(barrel).sort(), Object.keys(shim).sort());
  assert.deepEqual(Object.keys(barrel).sort(), ['SELECT_OFFER_PRICES_SQL', 'selectOfferPrices']);
});

test('offers barrel: every export is the same value through both paths', () => {
  for (const key of Object.keys(barrel)) {
    assert.equal(shim[key], barrel[key], 'export ' + key + ' differs between the old and the new path');
  }
});
