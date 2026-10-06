'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { decidePromotion } = require('./promotion');

test('a new offer is an INSERT with no price_history row', () => {
  const d = decidePromotion({ price: 1299, availability: 'IN_STOCK' }, null);
  assert.equal(d.action, 'INSERT');
  assert.equal(d.appendHistory, false);
  assert.deepEqual(d.changedFields, []);
});

test('a price change is an UPDATE and appends exactly one history row', () => {
  const d = decidePromotion({ price: 1399, availability: 'IN_STOCK' }, { price: 1299, availability: 'IN_STOCK' });
  assert.equal(d.action, 'UPDATE');
  assert.equal(d.appendHistory, true);
  assert.deepEqual(d.changedFields, ['price']);
});

test('an availability change is an UPDATE and appends history', () => {
  const d = decidePromotion({ price: 1299, availability: 'OUT_OF_STOCK' }, { price: 1299, availability: 'IN_STOCK' });
  assert.equal(d.action, 'UPDATE');
  assert.deepEqual(d.changedFields, ['availability']);
});

test('an unchanged price and availability appends nothing', () => {
  const d = decidePromotion({ price: 1299, availability: 'IN_STOCK' }, { price: '1299', availability: 'IN_STOCK' });
  assert.equal(d.action, 'UNCHANGED');
  assert.equal(d.appendHistory, false);
});

test('NULL availability never equals a string availability', () => {
  const d = decidePromotion({ price: 1299, availability: 'IN_STOCK' }, { price: 1299, availability: null });
  assert.equal(d.action, 'UPDATE');
  assert.deepEqual(d.changedFields, ['availability']);
});
