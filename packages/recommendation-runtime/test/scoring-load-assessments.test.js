'use strict';

// packages/recommendation-runtime/test/scoring-load-assessments.test.js — the
// Engine 4 `component_assessment` loader now lives in this package, batch
// `step-5-w1-query-scoring`.
//
// What it proves, and why each point is here rather than in the L1 suite that
// stayed at the old path (src/recommendation/scoring/load-assessments.test.js):
//   1. the module is loadable from its NEW path and still exports its surface;
//   2. the old path is the SAME module by identity, not a second copy;
//   3. the query stays candidate-scoped and parameterized (ANY($1::uuid[])),
//      ordered deterministically, with the decision timestamp read from the
//      database rather than the JS clock;
//   4. one call over an unassessed product returns the frozen empty map with
//      loaded_at null — an unassessed product is not an error.
//
// DB-free: the query is issued against a fake client that records its calls.
// No database, no environment, no clock read.
//
//   npm run test:runtime        (from the repo root)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  loadComponentAssessments,
  SELECT_COMPONENT_ASSESSMENTS_SQL,
} = require('../src/scoring/load-assessments');
const shim = require('../../../src/recommendation/scoring/load-assessments');

const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';

/** Fake pg-compatible client: records (sql, params) and returns fixed rows. */
function makeDb(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

test('loads from the runtime package and exports the Engine 4 surface', () => {
  assert.equal(typeof loadComponentAssessments, 'function');
  assert.equal(typeof SELECT_COMPONENT_ASSESSMENTS_SQL, 'string');
  assert.ok(SELECT_COMPONENT_ASSESSMENTS_SQL.includes('FROM component_assessment'));
});

test('the old path is the same module by identity, not a second implementation', () => {
  assert.equal(shim.loadComponentAssessments, loadComponentAssessments);
  assert.equal(shim.SELECT_COMPONENT_ASSESSMENTS_SQL, SELECT_COMPONENT_ASSESSMENTS_SQL);
});

test('the query stays candidate-scoped, parameterized and deterministically ordered', () => {
  assert.ok(SELECT_COMPONENT_ASSESSMENTS_SQL.includes('ANY($1::uuid[])'));
  assert.ok(!SELECT_COMPONENT_ASSESSMENTS_SQL.includes('${'), 'no template interpolation');
  assert.ok(
    SELECT_COMPONENT_ASSESSMENTS_SQL.includes(
      'ORDER BY product_id ASC, assessment_type ASC, assessed_at DESC, id ASC'
    ),
    'the row order is what makes selectAssessmentRow deterministic'
  );
  assert.ok(!SELECT_COMPONENT_ASSESSMENTS_SQL.includes('now()'), 'no JS/statement clock read');
});

test('an unassessed product returns the frozen empty map with no decision timestamp', async () => {
  const db = makeDb([]);
  const out = await loadComponentAssessments([PRODUCT_ID], db);

  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, [[PRODUCT_ID]]);
  assert.ok(Object.isFrozen(out));
  assert.deepEqual(out.assessments, {});
  assert.equal(out.loaded_at, null);
});
