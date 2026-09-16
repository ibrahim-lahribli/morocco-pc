'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { priceKey, validatePrices, lookupPrice } = require('./prices');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

// Strict mode file-wide: writes to frozen structures raise TypeError.

const STORE_A = '11111111-1111-4111-8111-111111111111';
const STORE_B = '22222222-2222-4222-8222-222222222222';
const TS = '2026-09-14T00:00:00.000Z';
const TS2 = '2026-09-15T12:30:00.000Z';

function makeEntry(overrides = {}) {
  return {
    selected_price: 1299.5,
    currency: 'MAD',
    store_id: STORE_A,
    price_checked_at: TS,
    ...overrides,
  };
}

function makeCarrier(pairs) {
  const carrier = Object.create(null);
  for (const [key, entry] of pairs) {
    Object.defineProperty(carrier, key, {
      value: entry, enumerable: true, writable: true, configurable: true,
    });
  }
  return carrier;
}

function singleCarrier(entryOverrides = {}) {
  return makeCarrier([[priceKey('cpu-1', null, 'CPU'), makeEntry(entryOverrides)]]);
}

/** Predicate for assert.throws: stable machine-readable error shape. */
function expectError(code, field) {
  return (error) => {
    if (!(error instanceof CandidateSelectionError)) return false;
    if (error.name !== 'CandidateSelectionError') return false;
    if (error.code !== code) return false;
    return field === undefined ? true : error.field === field;
  };
}

// ---------------------------------------------------------------------------
// priceKey
// ---------------------------------------------------------------------------

test('priceKey exact tuple ordering matches the spec example', () => {
  assert.equal(priceKey('cpu-1', null, 'CPU'), '["cpu-1",null,"CPU"]');
});

test('priceKey orders tuple as product_id, variant, role', () => {
  assert.equal(
    priceKey('p', 'v', 'GPU'),
    JSON.stringify(['p', 'v', 'GPU'])
  );
  assert.notEqual(priceKey('p', 'v', 'GPU'), priceKey('v', 'p', 'GPU'));
  assert.notEqual(priceKey('p', 'v', 'GPU'), priceKey('p', 'GPU', 'v'));
});

test('priceKey CPU with null variant', () => {
  assert.equal(priceKey('cpu-1', null, 'CPU'), '["cpu-1",null,"CPU"]');
});

test('priceKey GPU with non-null variant', () => {
  assert.equal(priceKey('gpu-1', 'var-9', 'GPU'), '["gpu-1","var-9","GPU"]');
});

test('priceKey null vs non-null variant produce different keys', () => {
  assert.notEqual(priceKey('cpu-1', null, 'CPU'), priceKey('cpu-1', 'var-1', 'CPU'));
});

test('priceKey different variants produce different keys', () => {
  assert.notEqual(priceKey('gpu-1', 'var-1', 'GPU'), priceKey('gpu-1', 'var-2', 'GPU'));
});

test('priceKey category is irrelevant / not included', () => {
  const a = priceKey('cpu-1', null, 'CPU');
  assert.equal(a, JSON.stringify(['cpu-1', null, 'CPU']));
  assert.ok(!a.includes('MEMORY'));
  assert.ok(!a.includes('category'));
});

test('priceKey preserves values verbatim (no trim, no fold)', () => {
  assert.equal(priceKey(' p ', null, 'CPU'), '[" p ",null,"CPU"]');
  assert.notEqual(priceKey('p', null, 'CPU'), priceKey(' p ', null, 'CPU'));
  assert.notEqual(priceKey('p', null, 'cpu'), priceKey('p', null, 'CPU'));
});

// ---------------------------------------------------------------------------
// Carrier validation
// ---------------------------------------------------------------------------

test('accepts a valid empty null-prototype carrier', () => {
  const carrier = validatePrices(Object.create(null));
  assert.equal(Object.getPrototypeOf(carrier), null);
  assert.deepEqual(Object.keys(carrier), []);
  assert.ok(Object.isFrozen(carrier));
});

test('accepts a valid single-entry carrier', () => {
  const carrier = validatePrices(singleCarrier());
  const key = priceKey('cpu-1', null, 'CPU');
  assert.deepEqual(carrier[key], makeEntry());
  assert.ok(Object.isFrozen(carrier));
  assert.ok(Object.isFrozen(carrier[key]));
});

test('accepts a valid multiple-entry carrier', () => {
  const raw = makeCarrier([
    [priceKey('cpu-1', null, 'CPU'), makeEntry()],
    [priceKey('gpu-1', 'var-9', 'GPU'), makeEntry({ store_id: STORE_B, price_checked_at: TS2, currency: 'USD' })],
  ]);
  const carrier = validatePrices(raw);
  assert.deepEqual(Object.keys(carrier).sort(), [priceKey('cpu-1', null, 'CPU'), priceKey('gpu-1', 'var-9', 'GPU')].sort());
});

test('rejects a normal object carrier', () => {
  assert.throws(
    () => validatePrices({ [priceKey('cpu-1', null, 'CPU')]: makeEntry() }),
    expectError(ERROR_CODES.INVALID_INPUT, 'prices')
  );
});

test('rejects an array carrier', () => {
  assert.throws(() => validatePrices([]), expectError(ERROR_CODES.INVALID_INPUT, 'prices'));
});

test('rejects null carrier', () => {
  assert.throws(() => validatePrices(null), expectError(ERROR_CODES.INVALID_INPUT, 'prices'));
});

test('rejects primitive carriers', () => {
  for (const bad of [42, 'prices', true, undefined]) {
    assert.throws(() => validatePrices(bad), expectError(ERROR_CODES.INVALID_INPUT, 'prices'));
  }
});

test('rejects a carrier with the wrong prototype', () => {
  const carrier = Object.create({ polluted: true });
  Object.defineProperty(carrier, priceKey('cpu-1', null, 'CPU'), {
    value: makeEntry(), enumerable: true, writable: true, configurable: true,
  });
  assert.throws(() => validatePrices(carrier), expectError(ERROR_CODES.INVALID_INPUT, 'prices'));
});

// ---------------------------------------------------------------------------
// Exact selected-price shape
// ---------------------------------------------------------------------------

test('rejects entry missing selected_price', () => {
  const { selected_price: _drop, ...rest } = makeEntry();
  const key = priceKey('cpu-1', null, 'CPU');
  assert.throws(
    () => validatePrices(makeCarrier([[key, rest]])),
    expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, `prices.${key}.selected_price`)
  );
});

test('rejects entry missing currency', () => {
  const { currency: _drop, ...rest } = makeEntry();
  const key = priceKey('cpu-1', null, 'CPU');
  assert.throws(
    () => validatePrices(makeCarrier([[key, rest]])),
    expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, `prices.${key}.currency`)
  );
});

test('rejects entry missing store_id', () => {
  const { store_id: _drop, ...rest } = makeEntry();
  const key = priceKey('cpu-1', null, 'CPU');
  assert.throws(
    () => validatePrices(makeCarrier([[key, rest]])),
    expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, `prices.${key}.store_id`)
  );
});

test('rejects entry missing price_checked_at', () => {
  const { price_checked_at: _drop, ...rest } = makeEntry();
  const key = priceKey('cpu-1', null, 'CPU');
  assert.throws(
    () => validatePrices(makeCarrier([[key, rest]])),
    expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, `prices.${key}.price_checked_at`)
  );
});

test('rejects every possible extra key', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  for (const extra of ['extra', 'price', 'offer_id', 'category', 'product_id']) {
    const entry = { ...makeEntry(), [extra]: 1 };
    assert.throws(
      () => validatePrices(makeCarrier([[key, entry]])),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.${extra}`),
      `extra key ${extra}`
    );
  }
});

test('rejects combinations of missing plus extra keys', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  const { currency: _drop, ...rest } = makeEntry();
  const entry = { ...rest, bogus: true };
  assert.throws(() => validatePrices(makeCarrier([[key, entry]])), (err) => (
    err instanceof CandidateSelectionError &&
    (err.code === ERROR_CODES.INVALID_FIELD_VALUE || err.code === ERROR_CODES.MISSING_REQUIRED_FIELD)
  ));
});

// ---------------------------------------------------------------------------
// selected_price
// ---------------------------------------------------------------------------

test('accepts a positive finite selected_price', () => {
  for (const value of [1, 0.01, 1299.5, 100000]) {
    const carrier = validatePrices(singleCarrier({ selected_price: value }));
    assert.equal(carrier[priceKey('cpu-1', null, 'CPU')].selected_price, value);
  }
});

test('rejects zero selected_price', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  assert.throws(
    () => validatePrices(singleCarrier({ selected_price: 0 })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.selected_price`)
  );
});

test('rejects negative selected_price', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  assert.throws(
    () => validatePrices(singleCarrier({ selected_price: -5 })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.selected_price`)
  );
});

test('rejects NaN selected_price', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  assert.throws(
    () => validatePrices(singleCarrier({ selected_price: NaN })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.selected_price`)
  );
});

test('rejects Infinity selected_price', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  assert.throws(
    () => validatePrices(singleCarrier({ selected_price: Infinity })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.selected_price`)
  );
});

test('rejects -Infinity selected_price', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  assert.throws(
    () => validatePrices(singleCarrier({ selected_price: -Infinity })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.selected_price`)
  );
});

test('rejects numeric-string selected_price', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  assert.throws(
    () => validatePrices(singleCarrier({ selected_price: '1299.5' })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.selected_price`)
  );
});

test('rejects null selected_price', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  assert.throws(
    () => validatePrices(singleCarrier({ selected_price: null })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.selected_price`)
  );
});

// ---------------------------------------------------------------------------
// currency / store_id / price_checked_at
// ---------------------------------------------------------------------------

test('accepts valid uppercase 3-letter currency codes', () => {
  for (const currency of ['GBP', 'USD', 'MAD', 'EUR']) {
    const carrier = validatePrices(singleCarrier({ currency }));
    assert.equal(carrier[priceKey('cpu-1', null, 'CPU')].currency, currency);
  }
});

test('rejects invalid currency forms', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  for (const currency of ['gbp', 'GB', 'GBPP', 'GBP ', ' GBP', 'Usd', '', null, 123]) {
    assert.throws(
      () => validatePrices(singleCarrier({ currency })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.currency`),
      `currency ${JSON.stringify(currency)}`
    );
  }
});

test('accepts a valid UUID store_id', () => {
  const carrier = validatePrices(singleCarrier({ store_id: STORE_A }));
  assert.equal(carrier[priceKey('cpu-1', null, 'CPU')].store_id, STORE_A);
});

test('rejects malformed store_id values', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  for (const store_id of ['store-1', 'not-a-uuid', '11111111-1111-1111-1111-11111111111', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', ' 11111111-1111-4111-8111-111111111111 ']) {
    assert.throws(
      () => validatePrices(singleCarrier({ store_id })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.store_id`),
      `store_id ${JSON.stringify(store_id)}`
    );
  }
});

test('rejects empty-string store_id', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  assert.throws(
    () => validatePrices(singleCarrier({ store_id: '' })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.store_id`)
  );
});

test('rejects null store_id', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  assert.throws(
    () => validatePrices(singleCarrier({ store_id: null })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.store_id`)
  );
});

test('rejects non-string store_id', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  for (const store_id of [42, true, {}]) {
    assert.throws(
      () => validatePrices(singleCarrier({ store_id })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.store_id`)
    );
  }
});

test('accepts a valid UTC ISO timestamp', () => {
  const carrier = validatePrices(singleCarrier({ price_checked_at: TS }));
  assert.equal(carrier[priceKey('cpu-1', null, 'CPU')].price_checked_at, TS);
});

test('accepts a +00:00 UTC offset timestamp', () => {
  const value = '2026-09-14T00:00:00.000+00:00';
  const carrier = validatePrices(singleCarrier({ price_checked_at: value }));
  assert.equal(carrier[priceKey('cpu-1', null, 'CPU')].price_checked_at, value);
});

test('rejects an invalid price_checked_at', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  assert.throws(
    () => validatePrices(singleCarrier({ price_checked_at: 'not-a-date' })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.price_checked_at`)
  );
});

test('rejects a non-UTC timestamp', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  for (const price_checked_at of ['2026-09-14T00:00:00.000+01:00', '2026-09-14T00:00:00.000-05:00']) {
    assert.throws(
      () => validatePrices(singleCarrier({ price_checked_at })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.price_checked_at`),
      `timestamp ${price_checked_at}`
    );
  }
});

test('rejects an arbitrary date string', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  for (const price_checked_at of ['2026-09-14', '14/09/2026', 'September 14 2026']) {
    assert.throws(
      () => validatePrices(singleCarrier({ price_checked_at })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.price_checked_at`),
      `timestamp ${price_checked_at}`
    );
  }
});

test('rejects an empty price_checked_at', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  assert.throws(
    () => validatePrices(singleCarrier({ price_checked_at: '' })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.price_checked_at`)
  );
});

test('rejects a non-string price_checked_at', () => {
  const key = priceKey('cpu-1', null, 'CPU');
  for (const price_checked_at of [null, 1726272000000, true, {}]) {
    assert.throws(
      () => validatePrices(singleCarrier({ price_checked_at })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.price_checked_at`)
    );
  }
});

// ---------------------------------------------------------------------------
// Immutability / lookup / idempotence / exports / scope
// ---------------------------------------------------------------------------

test('freezes the carrier and every entry', () => {
  const carrier = validatePrices(singleCarrier());
  const key = priceKey('cpu-1', null, 'CPU');
  assert.equal(Object.isFrozen(carrier), true);
  assert.equal(Object.isFrozen(carrier[key]), true);
});

test('does not mutate caller-owned entry objects', () => {
  const entry = makeEntry();
  const snapshot = { ...entry };
  const raw = makeCarrier([[priceKey('cpu-1', null, 'CPU'), entry]]);
  const carrier = validatePrices(raw);
  assert.deepEqual(entry, snapshot);
  assert.equal(Object.isFrozen(entry), false);
  assert.deepEqual(carrier[priceKey('cpu-1', null, 'CPU')], snapshot);
  assert.notEqual(carrier[priceKey('cpu-1', null, 'CPU')], entry);
});

test('returns a frozen carrier with a null prototype', () => {
  const carrier = validatePrices(singleCarrier());
  assert.equal(Object.getPrototypeOf(carrier), null);
});

test('successful lookup returns the stored entry', () => {
  const carrier = validatePrices(singleCarrier());
  const found = lookupPrice(carrier, { product_id: 'cpu-1', product_variant_id: null, component_role: 'CPU' });
  assert.deepEqual(found, makeEntry());
});

test('lookup preserves exact object identity without cloning', () => {
  const carrier = validatePrices(singleCarrier());
  const candidate = { product_id: 'cpu-1', product_variant_id: null, component_role: 'CPU' };
  const key = priceKey(candidate.product_id, candidate.product_variant_id, candidate.component_role);
  assert.equal(lookupPrice(carrier, candidate), carrier[key]);
});

test('lookup uses the canonical tuple key', () => {
  const raw = makeCarrier([
    [priceKey('gpu-1', 'var-9', 'GPU'), makeEntry({ store_id: STORE_B })],
  ]);
  const carrier = validatePrices(raw);
  const found = lookupPrice(carrier, { product_id: 'gpu-1', product_variant_id: 'var-9', component_role: 'GPU', category: 'GPU' });
  assert.equal(found.store_id, STORE_B);
});

test('missing lookup throws CandidateSelectionError', () => {
  const carrier = validatePrices(singleCarrier());
  assert.throws(
    () => lookupPrice(carrier, { product_id: 'missing', product_variant_id: null, component_role: 'CPU' }),
    (err) => err instanceof CandidateSelectionError && err.name === 'CandidateSelectionError'
  );
});

test('missing lookup reuses INVALID_CANDIDATE', () => {
  const carrier = validatePrices(singleCarrier());
  assert.throws(
    () => lookupPrice(carrier, { product_id: 'missing', product_variant_id: null, component_role: 'CPU' }),
    expectError(ERROR_CODES.INVALID_CANDIDATE, 'prices')
  );
});

test('lookup keeps null and non-null variants distinct', () => {
  const carrier = validatePrices(singleCarrier());
  assert.throws(
    () => lookupPrice(carrier, { product_id: 'cpu-1', product_variant_id: 'var-1', component_role: 'CPU' }),
    expectError(ERROR_CODES.INVALID_CANDIDATE, 'prices')
  );
  const found = lookupPrice(carrier, { product_id: 'cpu-1', product_variant_id: null, component_role: 'CPU' });
  assert.equal(found.selected_price, 1299.5);
});

test('revalidating a frozen carrier is idempotent', () => {
  const once = validatePrices(singleCarrier());
  const snapshot = JSON.parse(JSON.stringify(once[priceKey('cpu-1', null, 'CPU')]));
  const twice = validatePrices(once);
  assert.deepEqual(twice[priceKey('cpu-1', null, 'CPU')], snapshot);
  assert.equal(Object.isFrozen(twice), true);
  assert.equal(Object.isFrozen(twice[priceKey('cpu-1', null, 'CPU')]), true);
  assert.deepEqual(Object.keys(twice), Object.keys(once));
});

test('exports exactly the Step 2 API', () => {
  const mod = require('./prices');
  assert.deepEqual(Object.keys(mod).sort(), ['lookupPrice', 'priceKey', 'validatePrices']);
});

test('module stays within the price-carrier boundary', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, 'prices.js'), 'utf8');
  for (const banned of ['require(\'pg\')', 'require("pg")', '.query(', 'SELECT', 'select store offers', 'top_k_per_role']) {
    assert.ok(!source.includes(banned), `prices.js must not contain ${banned}`);
  }
});
