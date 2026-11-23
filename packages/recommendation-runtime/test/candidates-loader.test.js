'use strict';

// packages/recommendation-runtime/test/candidates-loader.test.js — the Engine 2B
// candidate loader now lives in this package, batch
// `step-5-w1-candidates-filtering`.
//
// What it proves, and why each point is here rather than in the L1 suite that
// stayed at the old path (src/recommendation/candidates/loader.test.js):
//   1. the module is loadable from its NEW path and still exports
//      `loadCandidates`, so the move did not depend on the old shim existing;
//   2. the old path is the SAME module by identity (same function object), not
//      a second copy that could drift;
//   3. every statement's SQL text is byte-identical to the pre-move text. The
//      text is frozen here rather than compared against an exported constant,
//      because the loader deliberately exports no SQL: the statement IS the
//      contract, and a test that read it from the module could not detect a
//      change to it;
//   4. every statement is bound with the EMPTY parameter array — the id scoping
//      lives in the SQL (`lifecycle_status`), so a future "improvement" that
//      interpolated an id would show up as a non-empty params array;
//   5. the STATEMENT SEQUENCE is the canonical role order: one statement per
//      required role in `ROLE_ORDER` (so SSD_BOOT and SSD_SECONDARY both issue
//      the ssd_spec statement, in their role positions), the GPU statement in
//      its own role position, and the canonical-category ambiguity guard LAST
//      and only when a product-keyed candidate exists. No test in the tree
//      pinned that order before this batch;
//   6. the returned carrier is frozen and keeps its two-key shape.
//
// DB-free: the statements are issued against a fake client that records
// (sql, params) and returns fixed rows. No database, no environment, no clock.
//
//   npm run test:runtime        (from the repo root)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadCandidates } = require('../src/candidates/loader');
const shim = require('../../../src/recommendation/candidates/loader');

const INPUT = Object.freeze({
  budget_amount: 8000,
  currency: 'MAD',
  use_case: 'GAMING',
  required_roles: Object.freeze([
    'CPU',
    'GPU',
    'MOTHERBOARD',
    'RAM',
    'SSD_BOOT',
    'SSD_SECONDARY',
    'PSU',
    'CASE',
    'CPU_COOLER',
  ]),
});

/**
 * The product-keyed candidate statement, exactly as the loader carries it: base
 * products only (`NULL::uuid AS product_variant_id`), category derived from
 * spec-table presence — never from a `product.category` column, which does not
 * exist. `specTable` is a trusted identifier from the loader's static map.
 */
const productKeyedSql = (specTable) => `
SELECT p.id AS product_id,
       NULL::uuid AS product_variant_id
  FROM product p
 WHERE p.lifecycle_status = 'ACTIVE'
   AND EXISTS (SELECT 1 FROM ${specTable} s WHERE s.product_id = p.id)

 ORDER BY product_id ASC;
`;

/** The variant-keyed GPU statement: no product-level (NULL variant) candidate. */
const GPU_SQL = `
SELECT p.id AS product_id,
       pv.id AS product_variant_id
  FROM product p
  JOIN product_variant pv ON pv.product_id = p.id
  JOIN gpu_board_spec s ON s.product_variant_id = pv.id
 WHERE p.lifecycle_status = 'ACTIVE'
 ORDER BY p.id ASC, pv.id ASC;
`;

/** The canonical-category ambiguity guard, issued once and LAST. */
const AMBIGUITY_SQL = `
SELECT p.id AS product_id,
       count(*) AS category_count
  FROM product p
  JOIN (
         SELECT product_id, 'cpu_spec'          AS src FROM cpu_spec
         UNION ALL SELECT product_id, 'motherboard_spec' FROM motherboard_spec
         UNION ALL SELECT product_id, 'ram_spec' FROM ram_spec
         UNION ALL SELECT product_id, 'ssd_spec' FROM ssd_spec
         UNION ALL SELECT product_id, 'psu_spec' FROM psu_spec
         UNION ALL SELECT product_id, 'case_spec' FROM case_spec
         UNION ALL SELECT product_id, 'cooler_spec' FROM cooler_spec
       ) specs ON specs.product_id = p.id
 WHERE p.lifecycle_status = 'ACTIVE'
 GROUP BY p.id
HAVING count(*) > 1
 ORDER BY p.id ASC;
`;

/** Cache-order role sequence of every statement one all-roles load issues. */
const ALL_ROLES_SEQUENCE = Object.freeze([
  productKeyedSql('cpu_spec'),
  GPU_SQL,
  productKeyedSql('motherboard_spec'),
  productKeyedSql('ram_spec'),
  productKeyedSql('ssd_spec'),
  productKeyedSql('ssd_spec'),
  productKeyedSql('psu_spec'),
  productKeyedSql('case_spec'),
  productKeyedSql('cooler_spec'),
  AMBIGUITY_SQL,
]);

/** Fake pg-compatible client: records (sql, params) and returns fixed rows. */
function makeDb(rowsFor) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: rowsFor(sql) };
    },
  };
}

test('loads from the runtime package and exports the candidate surface', () => {
  assert.equal(typeof loadCandidates, 'function');
});

test('the old path is the same module by identity, not a second implementation', () => {
  assert.equal(shim.loadCandidates, loadCandidates);
});

test('one all-roles load issues every statement in canonical role order', async () => {
  const db = makeDb((sql) => (sql === productKeyedSql('cpu_spec')
    ? [{ product_id: 'cpu-1', product_variant_id: null }]
    : []));

  const out = await loadCandidates(INPUT, db);

  assert.deepEqual(
    db.calls.map((call) => call.sql),
    [...ALL_ROLES_SEQUENCE],
    'the statement sequence changed: role order, the duplicate ssd_spec statement'
      + ' for SSD_BOOT/SSD_SECONDARY, and the trailing ambiguity guard are all pinned'
  );
  for (const call of db.calls) {
    assert.deepEqual(call.params, [], 'the loader binds no parameter; id scoping lives in the SQL');
  }
  assert.ok(Object.isFrozen(out));
  assert.deepEqual(Object.keys(out).sort(), ['candidates', 'input']);
  assert.ok(Object.isFrozen(out.candidates));
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].component_role, 'CPU');
});

test('the ambiguity guard is skipped when no product-keyed candidate exists', async () => {
  const db = makeDb(() => []);

  await loadCandidates({ ...INPUT, required_roles: ['GPU'] }, db);

  assert.deepEqual(db.calls.map((call) => call.sql), [GPU_SQL],
    'a GPU-only request must issue the variant statement and no ambiguity guard');
  assert.deepEqual(db.calls[0].params, []);
});

test('only the required roles are queried, in role order', async () => {
  const db = makeDb(() => []);

  await loadCandidates({ ...INPUT, required_roles: ['PSU', 'CPU'] }, db);

  assert.deepEqual(db.calls.map((call) => call.sql), [productKeyedSql('cpu_spec'), productKeyedSql('psu_spec')],
    'the loader iterates ROLE_ORDER, not the caller\'s required_roles order');
});

test('a database client without query() is rejected before any statement', async () => {
  let error = null;
  try {
    await loadCandidates(INPUT, { notQuery: true });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error !== null, 'a client without query() must be rejected');
  assert.equal(error.field, 'db');
});
