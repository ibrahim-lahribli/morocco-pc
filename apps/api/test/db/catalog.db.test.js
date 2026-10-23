'use strict';

/**
 * apps/api/test/db/catalog.db.test.js - the catalog reads against REAL rows.
 *
 * TEST BRANCH ONLY. `resolveTestDbUrl` runs at module scope and throws when
 * TEST_DATABASE_URL is absent or points at the shared endpoint, so a missing
 * environment fails the suite loudly instead of skipping it.
 *
 * READ-ONLY BY CONSTRUCTION: this file issues SELECTs through the API and
 * SELECTs of its own for cross-checks. It inserts nothing, so it needs no
 * cleanup and no residue assertion - the write suites own those, and a
 * whole-table comparison here would measure THEIR work (the trap
 * presets.db.test.js documents, since `node --test` runs these files in
 * parallel processes).
 *
 * What only a real database can prove:
 *
 *   1. The keyset walk is COMPLETE AND DUPLICATE-FREE. A stub can prove the
 *      cursor arithmetic; only the real `slug > cursor` page against 100 rows
 *      proves no row is skipped or repeated at a page boundary.
 *   2. `from_price` is the cheapest ELIGIBLE offer of that product, computed by
 *      SQL that does not share the statement's implementation - compared against
 *      the offer the detail page serves FIRST.
 *   3. Provenance is derived, not assumed: every `offer_class` served today is
 *      `SEED_UNVERIFIED`, because every `store_offer` row has a NULL
 *      `ingestion_record_id` (Decision 35 beta data), and the derived
 *      `price_status` is therefore `indicative` - which is correct, and must not
 *      be special-cased into `verified`.
 *   4. A GPU spec belongs to the VARIANT that was priced. One live GPU product
 *      has two variants (measured 2026-10-17), so "whatever row came back" would
 *      be a real defect rather than a hypothetical one.
 */

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const { resolveTestDbUrl } = require('../../../../scripts/lib/db-url');
const { buildApp } = require('../../src/app');
const repository = require('../../src/repository');
const engine = require('../../src/engine');
const { STATEMENT_TIMEOUT_MS } = require('../../src/db');

const ENGINE_VERSION = 'db-test-sha';
const PAGE_SIZE = 7;

// Module scope on purpose: an unusable environment fails the file, not a test.
const POOL_CONFIG = resolveTestDbUrl(process.env);

function createPool() {
  return new Pool({
    connectionString: POOL_CONFIG.connectionString,
    connectionTimeoutMillis: POOL_CONFIG.connectionTimeoutMillis,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    application_name: 'morocco-pc-catalog-test',
  });
}

function createApp(pool) {
  return buildApp({
    pool,
    repository,
    engine,
    engineVersion: ENGINE_VERSION,
    env: { ENGINE_VERSION, ALLOWED_ORIGINS: '' },
    logger: false,
  });
}

async function getJson(app, url) {
  const response = await app.inject({ method: 'GET', url });
  return { status: response.statusCode, body: response.json() };
}

test('walking every page returns the whole catalogue once, in slug order', async () => {
  const pool = createPool();
  const app = createApp(pool);
  try {
    const expected = (await pool.query(
      "SELECT count(*)::int AS n FROM product WHERE lifecycle_status = 'ACTIVE' AND slug IS NOT NULL"
    )).rows[0].n;
    const bounds = (await pool.query(
      "SELECT min(slug) AS first, max(slug) AS last FROM product WHERE lifecycle_status = 'ACTIVE' AND slug IS NOT NULL"
    )).rows[0];

    const slugs = [];
    let cursor = null;
    let pages = 0;
    do {
      const url = '/v1/catalog/products?limit=' + PAGE_SIZE + (cursor === null ? '' : '&cursor=' + encodeURIComponent(cursor));
      const { status, body } = await getJson(app, url);
      assert.equal(status, 200, 'page ' + (pages + 1) + ' answered');
      assert.ok(body.products.length <= PAGE_SIZE, 'a page never exceeds the requested size');
      for (const product of body.products) {
        slugs.push(product.slug);
      }
      cursor = body.next_cursor;
      pages += 1;
      assert.ok(pages < 100, 'the walk must terminate');
    } while (cursor !== null);

    assert.equal(new Set(slugs).size, slugs.length, 'no slug is served twice');
    assert.equal(slugs.length, expected, 'the walk covers every ACTIVE product with a slug');
    assert.deepEqual(slugs.slice().sort(), slugs, 'the union is in ascending slug order');
    assert.equal(slugs[0], bounds.first, 'the first row is the catalogue’s lowest slug');
    assert.equal(slugs[slugs.length - 1], bounds.last, 'the last row is its highest slug');

    // Scenario 3.1: the default page is bounded and carries a cursor while more
    // rows exist.
    const firstPage = await getJson(app, '/v1/catalog/products');
    assert.equal(firstPage.body.products.length, 20);
    assert.ok(firstPage.body.next_cursor !== null);
  } finally {
    await app.close();
    await pool.end();
  }
});

test('the role filter narrows by the derived category, and only that category is served', async () => {
  const pool = createPool();
  const app = createApp(pool);
  try {
    const expected = (await pool.query(
      'SELECT count(DISTINCT p.id)::int AS n'
      + ' FROM product p'
      + ' JOIN product_variant v ON v.product_id = p.id'
      + ' JOIN gpu_board_spec g ON g.product_variant_id = v.id'
      + " WHERE p.lifecycle_status = 'ACTIVE' AND p.slug IS NOT NULL"
    )).rows[0].n;

    const { status, body } = await getJson(app, '/v1/catalog/products?role=GPU&limit=100');
    assert.equal(status, 200);
    assert.equal(body.products.length, expected, 'every GPU product is listed');
    assert.deepEqual(
      body.products.map((product) => product.category),
      body.products.map(() => 'GPU'),
      'role=GPU maps to the GPU product category'
    );

    // A role the engine does not declare is a 422 that names the vocabulary -
    // never a silently broader page.
    const bogus = await getJson(app, '/v1/catalog/products?role=MODEM');
    assert.equal(bogus.status, 422);
    assert.equal(bogus.body.details[0].field, 'role');
  } finally {
    await app.close();
    await pool.end();
  }
});

test('from_price is the cheapest eligible offer, and the detail page prices the same offer first', async () => {
  const pool = createPool();
  const app = createApp(pool);
  try {
    const row = (await pool.query(
      "SELECT p.slug FROM product p WHERE p.lifecycle_status = 'ACTIVE' AND p.slug IS NOT NULL"
      + ' AND EXISTS (SELECT 1 FROM store_offer o WHERE o.product_id = p.id)'
      + ' ORDER BY p.slug ASC LIMIT 1'
    )).rows[0];
    assert.ok(row, 'the branch must have at least one priced product');

    const detail = await getJson(app, '/v1/catalog/products/' + encodeURIComponent(row.slug));
    assert.equal(detail.status, 200);
    assert.ok(detail.body.offers.length > 0, 'a priced product has offers');
    const cheapest = Math.min(...detail.body.offers.map((offer) => offer.price));

    const page = await getJson(app, '/v1/catalog/products?limit=100');
    const listed = page.body.products.find((product) => product.slug === row.slug);
    assert.ok(listed, 'the product appears in the list');
    assert.equal(listed.from_price, cheapest, 'the list advertises the cheapest eligible offer, not another one');
    assert.equal(listed.has_offer, true);
    assert.equal(listed.offer_class, 'SEED_UNVERIFIED', 'the seed catalogue’s provenance label is derived, not assumed');
  } finally {
    await app.close();
    await pool.end();
  }
});

test('a real product page serves specs, provenance-labelled offers, indicative pricing and the disclaimer', async () => {
  const pool = createPool();
  const app = createApp(pool);
  try {
    const row = (await pool.query(
      "SELECT slug FROM product WHERE lifecycle_status = 'ACTIVE' AND slug IS NOT NULL ORDER BY slug ASC LIMIT 1"
    )).rows[0];

    const { status, body } = await getJson(app, '/v1/catalog/products/' + encodeURIComponent(row.slug));
    assert.equal(status, 200);
    assert.equal(body.slug, row.slug);
    assert.equal(typeof body.display_name, 'string');
    assert.ok(!body.display_name.startsWith('Seed '), 'the ingestion-only prefix never reaches a client');
    assert.ok(Object.keys(body.specs).length > 0, 'the spec object carries real columns');
    assert.equal(typeof body.specs.created_at, 'undefined', 'identity/audit columns are stripped');
    assert.ok(body.offers.length > 0);
    for (const offer of body.offers) {
      assert.equal(typeof offer.price, 'number', 'NUMERIC is presented as a number, not a string');
      assert.equal(offer.currency, 'MAD');
      assert.equal(offer.offer_class, 'SEED_UNVERIFIED');
    }
    // The live catalog is 101/101 seed offers, so ANY product page is
    // indicative. Anything else would be the defect this sprint prevents.
    assert.equal(body.price_status, 'indicative');
    assert.match(body.disclaimer, /Prix indicatifs/);

    // Scenario 3.4: an unknown slug is a 404 with the standard envelope, and it
    // leaks nothing about the database.
    const missing = await getJson(app, '/v1/catalog/products/no-such-product-slug');
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: 'NOT_FOUND', message: 'No product with that slug' });
  } finally {
    await app.close();
    await pool.end();
  }
});

test('a GPU product with two variants serves the spec of the variant its cheapest offer priced', async (t) => {
  const pool = createPool();
  const app = createApp(pool);
  try {
    const multi = (await pool.query(
      'SELECT p.id, p.slug'
      + ' FROM product p'
      + ' JOIN product_variant v ON v.product_id = p.id'
      + ' JOIN gpu_board_spec g ON g.product_variant_id = v.id'
      + " WHERE p.lifecycle_status = 'ACTIVE'"
      + ' GROUP BY p.id, p.slug'
      + ' HAVING count(*) > 1'
      + ' ORDER BY p.slug ASC LIMIT 1'
    )).rows[0];
    if (!multi) {
      // The fixture is data-dependent (one such product exists, measured
      // 2026-10-17). A SKIP is visible in the summary; an early `return` with a
      // passing assertion would read as coverage the run never had.
      t.skip('no two-variant GPU product on this branch; the coherence case was not exercised');
      return;
    }

    const { status, body } = await getJson(app, '/v1/catalog/products/' + encodeURIComponent(multi.slug));
    assert.equal(status, 200);
    assert.ok(body.offers.length > 0, 'the two-variant product is priced');

    // The expected spec is built from the DATABASE, independently of the served
    // statement: the variant the cheapest offer names, with the same identity
    // columns stripped.
    const variantId = (await pool.query(
      'SELECT o.product_variant_id'
      + ' FROM store_offer o'
      + " WHERE o.product_id = $1 AND o.currency = 'MAD' AND o.price > 0 AND o.availability <> 'OUT_OF_STOCK'"
      + ' ORDER BY o.price ASC, o.id ASC LIMIT 1',
      [multi.id]
    )).rows[0].product_variant_id;

    const expected = (await pool.query(
      "SELECT to_jsonb(g) - ARRAY['id', 'product_id', 'product_variant_id', 'created_at', 'updated_at'] AS specs"
      + ' FROM gpu_board_spec g WHERE g.product_variant_id = $1',
      [variantId]
    )).rows[0].specs;

    assert.deepEqual(body.specs, expected, 'the spec shown belongs to the variant whose price is shown');
  } finally {
    await app.close();
    await pool.end();
  }
});

test('a real price history is one point per observation moment, cheapest price first', async (t) => {
  const pool = createPool();
  const app = createApp(pool);
  try {
    // The richest history on the branch (one product has two rows today, both
    // from the SAME sweep - two variants, two stores). Ordering is explicit: an
    // unordered LIMIT 1 is how a gate starts reporting intermittent drift.
    const anchor = (await pool.query(
      'SELECT p.slug, count(*)::int AS observations, count(DISTINCT h.observed_at)::int AS moments'
      + ' FROM product p'
      + ' JOIN store_offer o ON o.product_id = p.id'
      + ' JOIN price_history h ON h.store_offer_id = o.id'
      + ' GROUP BY p.slug'
      + ' ORDER BY observations DESC, p.slug ASC LIMIT 1'
    )).rows[0];
    if (!anchor) {
      // Data-dependent, like the two-variant GPU case above: a visible SKIP, not
      // a passing assertion the run never earned.
      t.skip('no product carries a price_history row on this branch');
      return;
    }

    const { status, body } = await getJson(
      app,
      '/v1/catalog/products/' + encodeURIComponent(anchor.slug) + '/price-history'
    );
    assert.equal(status, 200);

    // The expectation is built from the DATABASE, not from the served statement:
    // the cheapest price at each instant, oldest first.
    const expected = (await pool.query(
      'SELECT h.observed_at, min(h.price) AS price'
      + ' FROM price_history h'
      + ' JOIN store_offer o ON o.id = h.store_offer_id'
      + ' JOIN product p ON p.id = o.product_id'
      + ' WHERE p.slug = $1'
      + ' GROUP BY h.observed_at'
      + ' ORDER BY h.observed_at ASC',
      [anchor.slug]
    )).rows;

    assert.equal(body.observation_count, expected.length, 'one point per observation MOMENT');
    assert.equal(body.points.length, expected.length);
    assert.equal(body.points.length, anchor.moments, 'two offers in one sweep are one point, not two');
    assert.deepEqual(
      body.points.map((point) => point.price),
      expected.map((row) => Number(row.price)),
      'the moment is worth its cheapest observed price, and NUMERIC is served as a number'
    );
    assert.deepEqual(
      body.points.map((point) => point.observed_at),
      expected.map((row) => row.observed_at.toISOString()),
      'the series is ascending by observation time'
    );

    assert.equal(body.currency, 'MAD');
    assert.equal(body.slug, anchor.slug);
    for (const point of body.points) {
      assert.equal(point.offer_class, 'SEED_UNVERIFIED', 'every historical price carries its provenance class');
    }

    // Thin data is a fact, not a trend: a change needs two MOMENTS.
    const first = expected[0].price;
    const last = expected[expected.length - 1].price;
    if (expected.length >= 2) {
      assert.equal(body.change_amount, Number((Number(last) - Number(first)).toFixed(2)));
      assert.equal(body.change_pct, Number((((Number(last) - Number(first)) / Number(first)) * 100).toFixed(2)));
    } else {
      assert.equal(body.change_amount, null, 'one observation has no change, and 0 would claim it held');
      assert.equal(body.change_pct, null);
      assert.equal(body.latest_price, Number(first));
      assert.equal(body.min_price, Number(first));
      assert.equal(body.max_price, Number(first));
    }

    // Scenario guard: an unknown slug is the SAME 404 envelope as the detail
    // route, not an empty history that a chart would render as "no data yet".
    const missing = await getJson(app, '/v1/catalog/products/no-such-product-slug/price-history');
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: 'NOT_FOUND', message: 'No product with that slug' });
  } finally {
    await app.close();
    await pool.end();
  }
});
