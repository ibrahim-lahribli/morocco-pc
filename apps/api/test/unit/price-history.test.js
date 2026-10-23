'use strict';

/**
 * apps/api/test/unit/price-history.test.js - the price-history route (contract
 * v1.6), DB-free.
 *
 * The subject is the DERIVATION, not the SQL: the repository is stubbed with the
 * rows a `pg` query would hand back (NUMERIC as strings, TIMESTAMPTZ as Date),
 * and the assertions are about what the route makes of them. Three properties
 * are load-bearing and each has its own test.
 *
 *   1. ASCENDING, AND THE NUMBER IS THE QUERY'S. `price_history` stores one row
 *      per observation, so the repository returns the window DESCENDING by time
 *      and lets the handler reverse it: a charting client can join the points in
 *      array order without sorting, and the ORDER BY is testable without a DB
 *      (`ORDER BY observed_at DESC` is asserted on the query the repository is
 *      asked to run elsewhere - here the reversal is what is pinned).
 *
 *   2. THIN DATA IS NOT AN ERROR. Most products have ONE observation, and a
 *      change over one point is not zero - it is UNKNOWN. `change_amount` /
 *      `change_pct` are null unless the window holds at least two points, the
 *      `min_price` / `max_price` equal the single price rather than being nulled
 *      out for looking redundant, and zero observations is a 200 with an empty
 *      `points` array. The web chart reads exactly these three states.
 *
 *   3. AN UNKNOWN PRODUCT IS A 404, NOT AN EMPTY HISTORY. `points: []` with a
 *      200 would be indistinguishable from a product nobody has observed yet.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const stub = require('../helpers/stub');

/** A product row as `readCatalogProduct` returns it. */
const PRODUCT = { slug: 'rtx-4060-8gb', display_name: 'RTX 4060 8GB', category: 'GPU' };

/** One `price_history` row, in the shape `pg` hands back (NUMERIC as a string). */
function row(observedAt, price, offerClass) {
  return {
    observed_at: new Date(observedAt),
    price,
    currency: 'MAD',
    offer_class: offerClass || 'SEED_UNVERIFIED',
  };
}

function createApp(repository) {
  return stub.createTestApp({ repository: repository || stub.createRepositoryStub() });
}

test('serves the window ascending, with numbers and the summary', async () => {
  const repository = stub.createRepositoryStub({
    async readCatalogProduct() {
      return { found: true, product: PRODUCT };
    },
    // The repository returns the window NEWEST FIRST (its own ORDER BY); the
    // route reverses it, so the served array is oldest first.
    async readPriceHistory() {
      return { found: true, product: PRODUCT, points: [row('2026-09-27T08:00:00Z', '4200.00'), row('2026-09-18T08:00:00Z', '3999.50')] };
    },
  });
  const app = createApp(repository);
  const response = await app.inject({ method: 'GET', url: '/v1/catalog/products/rtx-4060-8gb/price-history' });

  assert.equal(response.statusCode, 200);
  const body = response.json();

  assert.deepEqual(
    body.points.map((point) => point.observed_at),
    ['2026-09-18T08:00:00.000Z', '2026-09-27T08:00:00.000Z'],
  );
  // NUMERIC arrives as a string; the wire carries a number.
  assert.deepEqual(
    body.points.map((point) => point.price),
    [3999.5, 4200],
  );
  assert.equal(body.points[0].offer_class, 'SEED_UNVERIFIED');
  assert.equal(body.observation_count, 2);
  assert.equal(body.latest_price, 4200);
  assert.equal(body.min_price, 3999.5);
  assert.equal(body.max_price, 4200);
  assert.equal(body.change_amount, 200.5);
  assert.equal(body.change_pct, 5.01);
  assert.equal(body.currency, 'MAD');
  assert.equal(body.slug, 'rtx-4060-8gb');
  assert.equal(typeof body.disclaimer, 'string');
  assert.ok(body.disclaimer.length > 0);

  await app.close();
});

test('ONE observation reports a price and a null change, never a zero', async () => {
  const repository = stub.createRepositoryStub({
    async readCatalogProduct() {
      return { found: true, product: PRODUCT };
    },
    async readPriceHistory() {
      return { found: true, product: PRODUCT, points: [row('2026-09-18T08:00:00Z', '3999.00')] };
    },
  });
  const app = createApp(repository);
  const body = (
    await app.inject({ method: 'GET', url: '/v1/catalog/products/rtx-4060-8gb/price-history' })
  ).json();

  assert.equal(body.observation_count, 1);
  assert.equal(body.latest_price, 3999);
  assert.equal(body.min_price, 3999);
  assert.equal(body.max_price, 3999);
  // A change over one point is UNKNOWN, not zero: 0 would claim the price held.
  assert.equal(body.change_amount, null);
  assert.equal(body.change_pct, null);

  await app.close();
});

test('NO observations is a 200 with an empty history', async () => {
  const repository = stub.createRepositoryStub({
    async readCatalogProduct() {
      return { found: true, product: PRODUCT };
    },
    async readPriceHistory() {
      return { found: true, product: PRODUCT, points: [] };
    },
  });
  const app = createApp(repository);
  const response = await app.inject({
    method: 'GET',
    url: '/v1/catalog/products/rtx-4060-8gb/price-history',
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(body.points, []);
  assert.equal(body.observation_count, 0);
  for (const field of ['latest_price', 'min_price', 'max_price', 'change_amount', 'change_pct']) {
    assert.equal(body[field], null, `${field} must be null, not 0`);
  }

  await app.close();
});

test('an unknown slug is the standard 404, not an empty history', async () => {
  const app = createApp(
    stub.createRepositoryStub({
      async readPriceHistory() {
        return { found: false };
      },
    }),
  );
  const response = await app.inject({
    method: 'GET',
    url: '/v1/catalog/products/does-not-exist/price-history',
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), {
    error: 'NOT_FOUND',
    message: 'No product with that slug',
  });

  await app.close();
});

test('a window is capped, so a long history cannot become one unbounded page', async () => {
  const calls = [];
  const repository = stub.createRepositoryStub({
    async readCatalogProduct() {
      return { found: true, product: PRODUCT };
    },
    async readPriceHistory(_db, key) {
      calls.push(key);
      return { found: true, product: PRODUCT, points: [] };
    },
  });
  const app = createApp(repository);
  await app.inject({ method: 'GET', url: '/v1/catalog/products/rtx-4060-8gb/price-history' });

  assert.equal(calls.length, 1);
  // Both the slug and the advertised currency are forwarded, and the limit is
  // the route's own cap - a contract number, not the repository's.
  assert.equal(calls[0].slug, 'rtx-4060-8gb');
  assert.equal(calls[0].currency, 'MAD');
  assert.equal(calls[0].limit, 366);

  await app.close();
});

test('a row with an unusable price is dropped rather than served as NaN', async () => {
  const repository = stub.createRepositoryStub({
    async readCatalogProduct() {
      return { found: true, product: PRODUCT };
    },
    async readPriceHistory() {
      return { found: true, product: PRODUCT, points: [row('2026-09-18T08:00:00Z', null), row('2026-09-20T08:00:00Z', '4100')] };
    },
  });
  const app = createApp(repository);
  const body = (
    await app.inject({ method: 'GET', url: '/v1/catalog/products/rtx-4060-8gb/price-history' })
  ).json();

  assert.equal(body.points.length, 1);
  assert.equal(body.observation_count, 1);
  assert.equal(body.latest_price, 4100);

  await app.close();
});

test('one MOMENT with two offers is ONE point at the cheaper price, not a fake rise', async () => {
  // The live catalog's only two-row product is exactly this shape: two variants
  // from two stores, observed in the same sweep. Two consecutive points would
  // draw a +50 % rise that never happened.
  const at = '2026-09-18T22:33:23.358Z';
  const repository = stub.createRepositoryStub({
    async readCatalogProduct() {
      return { found: true, product: PRODUCT };
    },
    async readPriceHistory() {
      return {
        found: true,
        product: PRODUCT,
        points: [row(at, '4800'), row(at, '3200'), row('2026-09-27T00:25:51.593Z', '3500')],
      };
    },
  });
  const app = createApp(repository);
  const body = (
    await app.inject({ method: 'GET', url: '/v1/catalog/products/rtx-4060-8gb/price-history' })
  ).json();

  assert.equal(body.points.length, 2);
  assert.equal(body.points[0].observed_at, '2026-09-18T22:33:23.358Z');
  assert.equal(body.points[0].price, 3200, 'the moment is worth the cheapest price observed');
  assert.equal(body.observation_count, 2);
  assert.equal(body.change_amount, 300);
  assert.equal(body.change_pct, 9.38);

  await app.close();
});
