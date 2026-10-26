'use strict';

/**
 * apps/api/test/unit/catalog.test.js - the read-only catalog routes, DB-free
 * (Platform P2 Sprint 3, contract v1.5; the list rows gained `variants` in v1.9).
 *
 * What belongs here is the ROUTE's half of the contract: shape, presentation,
 * parameter validation and the keyset's cursor arithmetic. The SQL half - is
 * `slug` really unique, does the page walk cover every row - is asserted in
 * `apps/api/test/db/catalog.db.test.js`, because a stub cannot prove either.
 *
 * The fixtures mimic pg's wire shape, not a friendly one: `from_price` and
 * `price` are NUMERIC STRINGS. A fixture that used JS numbers would have hidden
 * a presenter that stopped converting, which is the exact defect the 101-row
 * seed catalog would hide in production (AGENTS section 7 item 16).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = require('../helpers/stub');
const { DISCLAIMER } = require('../../src/contracts');

/** A product page host wired with the given repository/engine overrides. */
function createApp(overrides) {
  return stub.createTestApp(overrides || {});
}

function listRow(overrides) {
  return Object.assign({
    id: '9a1d5f6e-0000-4000-8000-000000000001',
    slug: 'amd-ryzen-5-5600',
    display_name: 'AMD Ryzen 5 5600',
    category: 'CPU',
    from_price: '899.00',
    offer_class: 'SEED_UNVERIFIED',
    variants: [],
  }, overrides || {});
}

test('the list serves the advertised shape and converts NUMERIC strings', async () => {
  const repository = stub.createRepositoryStub({
    async selectCatalogProducts() {
      return [listRow(), listRow({ slug: 'gpu-without-offer', category: 'GPU', from_price: null, offer_class: null })];
    },
  });
  const app = createApp({ repository });

  const response = await app.inject({ method: 'GET', url: '/v1/catalog/products' });
  assert.equal(response.statusCode, 200);
  const body = response.json();

  assert.deepEqual(body.products[0], {
    id: '9a1d5f6e-0000-4000-8000-000000000001',
    slug: 'amd-ryzen-5-5600',
    display_name: 'AMD Ryzen 5 5600',
    category: 'CPU',
    from_price: 899,
    offer_class: 'SEED_UNVERIFIED',
    has_offer: true,
    variants: [],
  });
  // A product with no eligible offer is STILL a row: silently dropping it would
  // make a partial catalog look complete.
  assert.deepEqual(body.products[1], {
    id: '9a1d5f6e-0000-4000-8000-000000000001',
    slug: 'gpu-without-offer',
    display_name: 'AMD Ryzen 5 5600',
    category: 'GPU',
    from_price: null,
    offer_class: null,
    has_offer: false,
    variants: [],
  });
  assert.equal(body.next_cursor, null, 'no extra row was returned, so this is the last page');

  await app.close();
});

test('a row publishes its SKUs in order, and a product with none says so with an empty array', async () => {
  const variants = [
    { id: '11111111-1111-4111-8111-111111111101', sku: 'SEED-RTX4060-DUAL-8G' },
    { id: '11111111-1111-4111-8111-111111111102', sku: 'SEED-RTX4060-TRIO-OC-8G' },
  ];
  const repository = stub.createRepositoryStub({
    async selectCatalogProducts() {
      return [
        listRow({ slug: 'gpu-with-two-skus', category: 'GPU', variants }),
        // `null` is what a product with no variant rows aggregates to in SQL
        // (COALESCE'd there); the presenter must serve `[]`, never null and
        // never an invented entry.
        listRow({ slug: 'cpu-with-none', variants: null }),
      ];
    },
  });
  const app = createApp({ repository });

  const response = await app.inject({ method: 'GET', url: '/v1/catalog/products' });
  assert.equal(response.statusCode, 200);
  const body = response.json();

  assert.deepEqual(body.products[0].variants, variants, 'the SKUs are served in the order the aggregate returned');
  assert.deepEqual(body.products[1].variants, [], 'a product with no variants is an empty array, not null');

  await app.close();
});

test('the page asks for one row more than the page size and resumes after the last SERVED slug', async () => {
  const rows = [listRow({ slug: 'a' }), listRow({ slug: 'b' }), listRow({ slug: 'c' })];
  // Recorded locally: an override replaces the stub's own method, so the shared
  // call log would otherwise stay empty and the assertion would pass vacuously.
  const calls = [];
  const repository = stub.createRepositoryStub({
    async selectCatalogProducts(_db, key) {
      calls.push(key);
      return rows;
    },
  });
  const app = createApp({ repository });

  const first = await app.inject({ method: 'GET', url: '/v1/catalog/products?limit=2' });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json().products.map((p) => p.slug), ['a', 'b']);
  assert.equal(first.json().next_cursor, 'b', 'the cursor is the last SERVED slug, never the probe row');

  // The probe row is how the route knows a next page exists without a COUNT.
  assert.deepEqual(calls[0], {
    category: null,
    cursor: null,
    limit: 3,
    currency: 'MAD',
  });

  const second = await app.inject({ method: 'GET', url: '/v1/catalog/products?limit=2&cursor=b' });
  assert.equal(second.statusCode, 200);
  assert.equal(calls[1].cursor, 'b', 'the cursor is forwarded verbatim');

  await app.close();
});

test('a role filter is translated to its product category through the engine boundary', async () => {
  const app = createApp();

  const ram = await app.inject({ method: 'GET', url: '/v1/catalog/products?role=RAM' });
  assert.equal(ram.statusCode, 200);

  const unknown = await app.inject({ method: 'GET', url: '/v1/catalog/products?role=MODEM' });
  assert.equal(unknown.statusCode, 422);
  const body = unknown.json();
  assert.equal(body.details[0].field, 'role');
  assert.match(body.details[0].message, /CPU/, 'the message names the accepted vocabulary');

  await app.close();
});

test('limit is bounded and refused outside 1..100', async () => {
  const app = createApp();

  for (const [value, reason] of [['0', 'zero'], ['1000', 'above the maximum'], ['abc', 'not a number']]) {
    const response = await app.inject({ method: 'GET', url: '/v1/catalog/products?limit=' + value });
    assert.equal(response.statusCode, 422, 'limit=' + value + ' (' + reason + ') must be refused');
  }

  const zero = await app.inject({ method: 'GET', url: '/v1/catalog/products?limit=0' });
  assert.equal(zero.json().details[0].field, 'limit');
  assert.match(zero.json().details[0].message, /between 1 and 100/);

  const max = await app.inject({ method: 'GET', url: '/v1/catalog/products?limit=100' });
  assert.equal(max.statusCode, 200, 'the maximum itself is allowed');

  await app.close();
});

test('unknown query parameters are refused, like every other endpoint', async () => {
  const app = createApp();
  const response = await app.inject({ method: 'GET', url: '/v1/catalog/products?use_case=GAMING' });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().details[0].field, 'use_case');
  await app.close();
});

test('an unknown slug is a 404 with the standard envelope', async () => {
  const repository = stub.createRepositoryStub();
  const app = createApp({ repository });

  const response = await app.inject({ method: 'GET', url: '/v1/catalog/products/does-not-exist' });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'NOT_FOUND', message: 'No product with that slug' });

  // The route forwards the slug and the advertised currency, nothing else.
  assert.deepEqual(repository.state.catalogDetailCalls[0], { slug: 'does-not-exist', currency: 'MAD' });

  await app.close();
});

test('the detail serves specs, priced offers with their provenance, and the disclaimer', async () => {
  const repository = stub.createRepositoryStub({
    async readCatalogProduct() {
      return {
        found: true,
        product: { slug: 'amd-ryzen-5-5600', display_name: 'AMD Ryzen 5 5600', category: 'CPU' },
        offers: [
          { price: '899.00', currency: 'MAD', ingestion_record_id: null },
          { price: '949.50', currency: 'MAD', ingestion_record_id: 'ing-1' },
        ],
        specs: { socket: 'AM4', tdp_watts: 65 },
      };
    },
  });
  const app = createApp({ repository });

  const response = await app.inject({ method: 'GET', url: '/v1/catalog/products/amd-ryzen-5-5600' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    slug: 'amd-ryzen-5-5600',
    display_name: 'AMD Ryzen 5 5600',
    category: 'CPU',
    specs: { socket: 'AM4', tdp_watts: 65 },
    offers: [
      { price: 899, currency: 'MAD', offer_class: 'SEED_UNVERIFIED' },
      { price: 949.5, currency: 'MAD', offer_class: 'VERIFIED' },
    ],
    // One seed offer is enough: the page is indicative, never verified.
    price_status: 'indicative',
    disclaimer: DISCLAIMER,
  });

  await app.close();
});

test('price_status is verified only when EVERY offer is VERIFIED, and null when there is none', async () => {
  const verified = stub.createRepositoryStub({
    async readCatalogProduct() {
      return {
        found: true,
        product: { slug: 'p', display_name: 'P', category: 'PSU' },
        offers: [{ price: '599.00', currency: 'MAD', ingestion_record_id: 'ing-1' }],
        specs: { wattage: 550 },
      };
    },
  });
  const verifiedApp = createApp({ repository: verified });
  const verifiedBody = (await verifiedApp.inject({ method: 'GET', url: '/v1/catalog/products/p' })).json();
  assert.equal(verifiedBody.price_status, 'verified');
  await verifiedApp.close();

  const unpriced = stub.createRepositoryStub({
    async readCatalogProduct() {
      return {
        found: true,
        product: { slug: 'q', display_name: 'Q', category: 'CASE' },
        offers: [],
        // A spec-less category is unreachable through the list, but the route
        // still promises an object rather than null.
        specs: null,
      };
    },
  });
  const unpricedApp = createApp({ repository: unpriced });
  const unpricedBody = (await unpricedApp.inject({ method: 'GET', url: '/v1/catalog/products/q' })).json();
  assert.deepEqual(unpricedBody.offers, []);
  assert.equal(unpricedBody.price_status, null, 'no price means no provenance claim, never "verified"');
  assert.deepEqual(unpricedBody.specs, {});
  assert.equal(unpricedBody.disclaimer, DISCLAIMER);
  await unpricedApp.close();
});
