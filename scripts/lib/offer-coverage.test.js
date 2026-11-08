'use strict';

/**
 * scripts/lib/offer-coverage.test.js - the pure half of
 * `check-offer-coverage.js`: verdicts, thresholds, INCONCLUSIVE, and the wording
 * of the report.
 *
 * The INCONCLUSIVE wording is pinned because it is the product claim: a
 * seed-only catalog must never be described as "coverage FAIL" (there is nothing
 * verified to count) and must never be described as covered either.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  COVERAGE_ROLES,
  VERDICTS,
  buildCoverage,
  formatReport,
  reasonOf,
} = require('./offer-coverage');

const AS_OF = new Date('2026-11-08T12:00:00Z');

function product(id, role) {
  return { product_id: id, role };
}

function offer(productId, role, storeId) {
  return { product_id: productId, role, store_id: storeId };
}

/** 5 products + 2 stores in every role: the default thresholds, met exactly. */
function fullCatalog() {
  const products = [];
  const offers = [];
  for (const role of COVERAGE_ROLES) {
    for (let i = 0; i < 5; i += 1) {
      products.push(product(role + '-p' + i, role));
      offers.push(offer(role + '-p' + i, role, 'store-' + (i % 2)));
    }
  }
  return { products, offers };
}

test('every role at both thresholds is PASS, and the catalog verdict is PASS', () => {
  const catalog = fullCatalog();
  const report = buildCoverage({
    products: catalog.products,
    offers: catalog.offers,
    minProducts: 5,
    minStores: 2,
    verifiedOffersAnywhere: catalog.offers.length,
  });
  assert.equal(report.verdict, VERDICTS.PASS);
  assert.equal(report.roles.length, 8);
  for (const row of report.roles) {
    assert.equal(row.active_products, 5, row.role);
    assert.equal(row.covered_products, 5, row.role);
    assert.equal(row.covered_stores, 2, row.role);
    assert.equal(row.verdict, VERDICTS.PASS, row.role);
  }
  assert.deepEqual(report.roles.map((row) => row.role), [...COVERAGE_ROLES]);
});

test('a role below the product threshold FAILs and names the shortfall', () => {
  const catalog = fullCatalog();
  // Drop two GPU products' offers: 3 covered < 5 required.
  const offers = catalog.offers.filter((row) => row.role !== 'GPU' || row.product_id === 'GPU-p0'
    || row.product_id === 'GPU-p1' || row.product_id === 'GPU-p2');
  const report = buildCoverage({
    products: catalog.products,
    offers,
    minProducts: 5,
    minStores: 2,
    verifiedOffersAnywhere: offers.length,
  });
  const gpu = report.roles.find((row) => row.role === 'GPU');
  assert.equal(gpu.covered_products, 3);
  assert.equal(gpu.missing_products, 2);
  assert.equal(gpu.verdict, VERDICTS.FAIL);
  assert.match(reasonOf(gpu), /needs 2 more product\(s\)/);
  assert.equal(report.verdict, VERDICTS.FAIL);
});

test('products met but one store FAILs the store threshold alone', () => {
  const catalog = fullCatalog();
  // One storefront for every CPU product: 5 products, 1 store.
  const offers = catalog.offers.map((row) => (
    row.role === 'CPU' ? { ...row, store_id: 'only-store' } : row
  ));
  const report = buildCoverage({
    products: catalog.products,
    offers,
    minProducts: 5,
    minStores: 2,
    verifiedOffersAnywhere: offers.length,
  });
  const cpu = report.roles.find((row) => row.role === 'CPU');
  assert.equal(cpu.covered_products, 5);
  assert.equal(cpu.covered_stores, 1);
  assert.equal(cpu.missing_products, 0);
  assert.equal(cpu.missing_stores, 1);
  assert.equal(cpu.verdict, VERDICTS.FAIL);
  assert.match(reasonOf(cpu), /1 more distinct store/);
});

test('zero VERIFIED offers anywhere is INCONCLUSIVE, never PASS and never FAIL', () => {
  const catalog = fullCatalog();
  const report = buildCoverage({
    products: catalog.products,
    offers: [],
    verifiedOffersAnywhere: 0,
  });
  // Every role is 0/0 on evidence, so the per-role rows would all read FAIL;
  // the catalog verdict must not turn that into a coverage verdict.
  assert.equal(report.verdict, VERDICTS.INCONCLUSIVE);
  assert.equal(report.eligible_offers, 0);
  assert.equal(report.minProducts, 5);
  assert.deepEqual(report.unbalanced_roles, [...COVERAGE_ROLES]);

  const lines = formatReport(report, { asOf: AS_OF, windowDays: 30, currency: 'MAD', label: 'env:TEST' }).join('\n');
  assert.match(lines, /RESULT: INCONCLUSIVE/);
  assert.match(lines, /ZERO VERIFIED offers/);
  assert.match(lines, /NOT a coverage verdict/);
  assert.match(lines, /R-01/);
  assert.doesNotMatch(lines, /RESULT: PASS/);
  assert.doesNotMatch(lines, /RESULT: FAIL/);
});

test('a FAIL report lists the failing roles and the roles reachable only through seeds', () => {
  const catalog = fullCatalog();
  const offers = catalog.offers.filter((row) => row.role !== 'CASE');
  const report = buildCoverage({
    products: catalog.products,
    offers,
    minProducts: 5,
    minStores: 2,
    verifiedOffersAnywhere: 10,
  });
  const lines = formatReport(report, { asOf: AS_OF, windowDays: 30, currency: 'MAD', label: 'env:DATABASE_URL' }).join('\n');
  assert.match(lines, /RESULT: FAIL/);
  assert.match(lines, /Roles below threshold: CASE/);
  assert.match(lines, /only come from a seed offer/);
  assert.match(lines, /30-day window/);
  assert.match(lines, /window starts 2026-10-09T12:00:00\.000Z/);
});

test('duplicate offer rows count once per product and once per store', () => {
  const report = buildCoverage({
    products: [product('p1', 'RAM'), product('p2', 'RAM')],
    offers: [
      offer('p1', 'RAM', 's1'),
      offer('p1', 'RAM', 's1'),
      offer('p1', 'RAM', 's2'),
      offer('p2', 'RAM', 's2'),
    ],
    minProducts: 2,
    minStores: 2,
    verifiedOffersAnywhere: 4,
  });
  const ram = report.roles.find((row) => row.role === 'RAM');
  assert.equal(ram.covered_products, 2);
  assert.equal(ram.covered_stores, 2);
  assert.equal(ram.verdict, VERDICTS.PASS);
  assert.equal(report.eligible_offers, 4);
});

test('a role with no ACTIVE product at all says so', () => {
  const report = buildCoverage({
    products: [product('p1', 'PSU')],
    offers: [offer('p1', 'PSU', 's1')],
    minProducts: 1,
    minStores: 1,
    verifiedOffersAnywhere: 1,
  });
  const fan = report.roles.find((row) => row.role === 'CPU_COOLER');
  assert.equal(fan.active_products, 0);
  assert.match(reasonOf(fan), /no ACTIVE product in the catalog/);
  assert.equal(fan.verdict, VERDICTS.FAIL);
});

test('unknown roles and malformed rows are ignored rather than counted', () => {
  const report = buildCoverage({
    products: [product('p1', 'CPU'), null, { product_id: 'p2', role: 'STORAGE' }],
    offers: [offer('p1', 'CPU', 's1'), offer(null, 'CPU', 's1'), { role: 'CPU', store_id: 's9' }],
    minProducts: 1,
    minStores: 1,
    verifiedOffersAnywhere: 1,
  });
  const cpu = report.roles.find((row) => row.role === 'CPU');
  assert.equal(cpu.active_products, 1);
  assert.equal(cpu.covered_products, 1);
  assert.equal(report.active_products, 1);
});

test('a non-integer threshold is refused instead of silently coerced', () => {
  assert.throws(() => buildCoverage({ products: [], offers: [], minProducts: 1.5, minStores: 2 }),
    /minProducts must be a non-negative integer/);
  assert.throws(() => buildCoverage({ products: [], offers: [], minProducts: 1, minStores: -1 }),
    /minStores must be a non-negative integer/);
});
