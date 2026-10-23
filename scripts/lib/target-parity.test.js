'use strict';

/**
 * scripts/lib/target-parity.test.js - the comparison half of
 * `check-target-parity.js` (Platform P1 Sprint 1 Step 6).
 *
 * What only a unit test can pin: that a difference is NAMED, that a missing
 * count is never silently equal, and that the display digest cannot turn two
 * different shapes into a MATCH. The SQL half is exercised by the owner's run
 * on the new target; a fake client here would only prove that the fake agrees
 * with itself.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PARITY_TABLES,
  compareSnapshots,
  describeLabel,
  shortDigest,
} = require('./target-parity');

/** A snapshot with every parity table counted at `n` unless overridden. */
function snapshot(overrides) {
  const counts = {};
  for (const table of PARITY_TABLES) counts[table] = 0;
  return Object.assign({
    label: 'A',
    ledger: ['001_extensions.sql', '002_enums.sql'],
    tables: ['product', 'store_offer'],
    shape: ['col|product|id:uuid:NO', 'enum|product_category|CPU'],
    counts,
    models: ['launch-v2@1.0.0|active'],
  }, overrides || {});
}

test('identical snapshots match on every check', () => {
  const result = compareSnapshots(snapshot(), snapshot());
  assert.equal(result.ok, true);
  // Four list checks (ledger, tables, shape, models) plus one count per table.
  assert.equal(result.rows.length, 4 + PARITY_TABLES.length);
  assert.deepEqual(result.rows.filter((row) => row.status !== 'MATCH'), []);
});

test('the ledger is compared by CONTENT and order, and the first difference is named', () => {
  const a = snapshot();
  const b = snapshot({ ledger: ['001_extensions.sql', '003_core_tables.sql'] });
  const result = compareSnapshots(a, b);
  assert.equal(result.ok, false);
  const row = result.rows.find((entry) => entry.check === 'ledger-files');
  assert.equal(row.status, 'DIFF');
  assert.match(row.detail, /index 1/);
  assert.match(row.detail, /002_enums/);
});

test('a missing ledger is a DIFF, not an error and not a pass', () => {
  const result = compareSnapshots(snapshot({ ledger: null }), snapshot());
  assert.equal(result.ok, false);
  const row = result.rows.find((entry) => entry.check === 'ledger-files');
  assert.equal(row.status, 'DIFF');
  assert.match(row.detail, /present on one side only/);

  // Both absent is a MATCH: neither database has adopted the ledger, and that
  // is a fact about both, not a difference between them.
  const both = compareSnapshots(snapshot({ ledger: null }), snapshot({ ledger: null }));
  assert.equal(both.rows.find((entry) => entry.check === 'ledger-files').status, 'MATCH');
});

test('an ACTIVE scoring model that differs is a DIFF even when the row count matches', () => {
  // The case the count check cannot see: both sides hold exactly one active
  // model, so `rows:scoring_model` MATCHes, yet the scores they serve differ.
  const b = snapshot({ models: ['seed-minimal-v1@1.0.0|active'] });
  const result = compareSnapshots(snapshot(), b);
  assert.equal(result.ok, false);
  assert.equal(result.rows.find((entry) => entry.check === 'rows:scoring_model').status, 'MATCH');
  const row = result.rows.find((entry) => entry.check === 'scoring-model-pins');
  assert.equal(row.status, 'DIFF');
  assert.match(row.detail, /launch-v2@1\.0\.0\|active/);
  assert.match(row.detail, /seed-minimal-v1@1\.0\.0\|active/);

  // The active FLAG is part of the row: the same pins with a different active
  // model is still a difference, not a reordering.
  const flipped = compareSnapshots(
    snapshot({ models: ['launch-v2@1.0.0|active'] }),
    snapshot({ models: ['launch-v2@1.0.0|inactive'] })
  );
  assert.equal(flipped.ok, false);
  assert.equal(flipped.rows.find((entry) => entry.check === 'scoring-model-pins').status, 'DIFF');
});

test('a snapshot without model rows is compared as absent, not as an error', () => {
  // Both absent is a MATCH (a pre-008 database on both sides); a fixture or a
  // caller that predates the check must not crash on `.length`.
  const old = (extra) => {
    const base = snapshot(extra);
    delete base.models;
    return base;
  };
  const both = compareSnapshots(old(), old());
  assert.equal(both.rows.find((entry) => entry.check === 'scoring-model-pins').status, 'MATCH');
  assert.match(both.rows.find((entry) => entry.check === 'scoring-model-pins').detail, /absent on both/);

  const one = compareSnapshots(old(), snapshot());
  assert.equal(one.ok, false);
  assert.equal(one.rows.find((entry) => entry.check === 'scoring-model-pins').status, 'DIFF');
});

test('the table list is compared by name and order', () => {
  const result = compareSnapshots(snapshot(), snapshot({ tables: ['product', 'store'] }));
  assert.equal(result.ok, false);
  const row = result.rows.find((entry) => entry.check === 'tables');
  assert.equal(row.status, 'DIFF');
  assert.match(row.detail, /index 1/);
});

test('a column type or nullability change is a SHAPE difference, not a table difference', () => {
  const b = snapshot({ shape: ['col|product|id:uuid:YES', 'enum|product_category|CPU'] });
  const result = compareSnapshots(snapshot(), b);
  assert.equal(result.ok, false);
  assert.equal(result.rows.find((entry) => entry.check === 'tables').status, 'MATCH');
  const row = result.rows.find((entry) => entry.check === 'schema-shape');
  assert.equal(row.status, 'DIFF');
  assert.match(row.detail, /uuid:YES/);
});

test('a row-count difference names the table and both numbers', () => {
  const b = snapshot();
  b.counts.product = 99;
  const result = compareSnapshots(snapshot(), b);
  assert.equal(result.ok, false);
  const row = result.rows.find((entry) => entry.check === 'rows:product');
  assert.equal(row.status, 'DIFF');
  assert.equal(row.detail, '0 vs 99');
  // Every other table still matches, so the report is not all-or-nothing noise.
  assert.equal(result.rows.find((entry) => entry.check === 'rows:store_offer').status, 'MATCH');
});

test('a table that exists on ONE side only is a DIFF, never a silent match', () => {
  const b = snapshot();
  delete b.counts.store_offer;
  const result = compareSnapshots(snapshot(), b);
  assert.equal(result.ok, false);
  const row = result.rows.find((entry) => entry.check === 'rows:store_offer');
  assert.equal(row.status, 'DIFF');
  assert.match(row.detail, /present on A only/);
});

test('a table absent on BOTH sides matches, so a pre-migration target can be compared', () => {
  const a = snapshot();
  const b = snapshot();
  // recommendation_preset does not exist below 022; two such databases are not
  // in drift merely because neither has it.
  a.counts.recommendation_preset = null;
  b.counts.recommendation_preset = null;
  const result = compareSnapshots(a, b);
  assert.equal(result.ok, true);
  const row = result.rows.find((entry) => entry.check === 'rows:recommendation_preset');
  assert.equal(row.status, 'MATCH');
  assert.match(row.detail, /absent on both/);
});

test('the Layer 4 tables are part of the parity set, so a dirty target cannot pass', () => {
  for (const table of ['recommendation_query', 'recommendation_result', 'build_candidate', 'build_component']) {
    assert.ok(PARITY_TABLES.includes(table), table + ' is compared');
  }
});

test('the display digest changes with any shape row and is stable across calls', () => {
  assert.equal(shortDigest(['a', 'b']), shortDigest(['a', 'b']));
  assert.notEqual(shortDigest(['a', 'b']), shortDigest(['a', 'c']));
  // Order is part of the shape: the same rows in a different order are a
  // different schema document, and the digest must not paper over that.
  assert.notEqual(shortDigest(['a', 'b']), shortDigest(['b', 'a']));
});

test('describeLabel states whether a ledger exists without printing a URL', () => {
  assert.match(describeLabel('A', snapshot()), /^A \(2 files\)$/);
  assert.match(describeLabel('B', snapshot({ ledger: null })), /^B \(no ledger\)$/);
});
