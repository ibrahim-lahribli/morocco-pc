'use strict';

// ---------------------------------------------------------------------------
// Engine 4 (Decision 13): focused tests for the component_assessment loader.
//
// Scope: the exact query contract, one-query discipline, row normalization
// (NUMERIC string -> number, naive TIMESTAMP read as UTC), grouping and
// freezing, decision-timestamp handling, and argument/row failure mapping.
// The pure scoring steps are NOT tested here (see effective-score.test.js,
// candidate-score.test.js, build-score.test.js).
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadComponentAssessments, SELECT_COMPONENT_ASSESSMENTS_SQL } = require('./load-assessments');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

function assessmentRow(overrides = {}) {
  return {
    product_id: P1,
    assessment_type: 'PERFORMANCE',
    score: 80,
    confidence: 'CONFIRMED',
    assessed_at: new Date('2026-09-01T00:00:00.000Z'),
    loaded_at: new Date('2026-09-19T00:00:00.000Z'),
    ...overrides,
  };
}

function makeDb(rows = [], { error = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (error) {
        throw error;
      }
      return { rows: typeof rows === 'function' ? rows(sql, params) : rows };
    },
  };
}

async function rejectionOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return null;
}

function assertError(error, code, field, message) {
  assert.ok(error instanceof CandidateSelectionError, message);
  assert.equal(error.code, code, message);
  assert.equal(error.field, field, message);
}

// Query contract ------------------------------------------------------------

test('the loader issues exactly the Engine 4 assessment query', () => {
  assert.equal(typeof SELECT_COMPONENT_ASSESSMENTS_SQL, 'string');
  assert.ok(SELECT_COMPONENT_ASSESSMENTS_SQL.includes('FROM component_assessment'));
  assert.ok(SELECT_COMPONENT_ASSESSMENTS_SQL.includes('ANY($1::uuid[])'));
  assert.ok(SELECT_COMPONENT_ASSESSMENTS_SQL.includes("AT TIME ZONE 'UTC'"));
  assert.ok(SELECT_COMPONENT_ASSESSMENTS_SQL.includes('CURRENT_TIMESTAMP AS loaded_at'));
  assert.ok(
    SELECT_COMPONENT_ASSESSMENTS_SQL.includes(
      'ORDER BY product_id ASC, assessment_type ASC, assessed_at DESC, id ASC'
    )
  );
  // No interpolation: the id set travels as the single parameter.
  assert.ok(!SELECT_COMPONENT_ASSESSMENTS_SQL.includes(P1));
});

test('exactly one query with the deduped, sorted id set as $1', async () => {
  const db = makeDb([assessmentRow()]);
  await loadComponentAssessments([P2, P1, P2], db);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, [[P1, P2]]);
  assert.equal(db.calls[0].sql, SELECT_COMPONENT_ASSESSMENTS_SQL);
});

// Normalization / grouping / freezing ---------------------------------------

test('rows are normalized: NUMERIC-string score to number, timestamp to epoch ms', async () => {
  const db = makeDb([assessmentRow({ score: '75', confidence: null })]);
  const out = await loadComponentAssessments([P1], db);
  const row = out.assessments[P1][0];
  assert.deepEqual(Object.keys(row).sort(), ['assessed_at', 'assessment_type', 'confidence', 'score']);
  assert.equal(row.score, 75);
  assert.equal(row.confidence, null);
  assert.equal(row.assessed_at, Date.parse('2026-09-01T00:00:00.000Z'));
});

test('NULL score stays null (Decision 13: STEP 1 treats it like no-row)', async () => {
  const db = makeDb([assessmentRow({ score: null })]);
  const out = await loadComponentAssessments([P1], db);
  assert.equal(out.assessments[P1][0].score, null);
});

test('rows group per product; every (product, type) row is kept; keys are sorted', async () => {
  const db = makeDb([
    assessmentRow({ product_id: P2, assessment_type: 'PERFORMANCE', score: 60 }),
    assessmentRow({ product_id: P1, assessment_type: 'VALUE', score: 70 }),
    assessmentRow({ product_id: P1, assessment_type: 'PERFORMANCE', score: 80 }),
  ]);
  const out = await loadComponentAssessments([P1, P2], db);
  assert.deepEqual(Object.keys(out.assessments), [P1, P2]);
  assert.equal(out.assessments[P1].length, 2);
  assert.equal(out.assessments[P2].length, 1);
  // An unassessed product is simply absent - never invented.
  assert.equal(Object.prototype.hasOwnProperty.call(out.assessments, P3), false);
});

test('loaded_at is the query decision timestamp in strict UTC ISO; null when no rows', async () => {
  const withRows = makeDb([assessmentRow({ loaded_at: new Date('2026-09-19T12:34:56.789Z') })]);
  const outWithRows = await loadComponentAssessments([P1], withRows);
  assert.equal(outWithRows.loaded_at, '2026-09-19T12:34:56.789Z');

  const empty = makeDb([]);
  const outEmpty = await loadComponentAssessments([P1], empty);
  assert.deepEqual(outEmpty.assessments, {});
  assert.equal(outEmpty.loaded_at, null);
});

test('the returned value is deeply frozen; caller-owned arguments are untouched', async () => {
  const ids = [P1];
  const db = makeDb([assessmentRow()]);
  const out = await loadComponentAssessments(ids, db);
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.assessments));
  assert.ok(Object.isFrozen(out.assessments[P1]));
  assert.ok(Object.isFrozen(out.assessments[P1][0]));
  assert.ok(!Object.isFrozen(ids));
});

// Argument / row failure mapping --------------------------------------------

test('argument failures fail fast with the existing error vocabulary', async () => {
  const db = makeDb([]);
  assertError(
    await rejectionOf(loadComponentAssessments(undefined, db)),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'product_ids',
    'absent'
  );
  assertError(
    await rejectionOf(loadComponentAssessments([], db)),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'product_ids',
    'empty'
  );
  assertError(
    await rejectionOf(loadComponentAssessments(['ok', ''], db)),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'product_ids',
    'blank entry'
  );
  assertError(
    await rejectionOf(loadComponentAssessments([P1], null)),
    ERROR_CODES.INVALID_INPUT,
    'db',
    'db gate'
  );
  assert.equal(db.calls.length, 0);
});

test('malformed DB rows fail fast (no silent repair)', async () => {
  assertError(
    await rejectionOf(loadComponentAssessments([P1], makeDb([assessmentRow({ assessment_type: null })]))),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'component_assessment.assessment_type',
    'bad type'
  );
  assertError(
    await rejectionOf(loadComponentAssessments([P1], makeDb([assessmentRow({ score: 'not-a-number' })]))),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'component_assessment.score',
    'bad score'
  );
  assertError(
    await rejectionOf(loadComponentAssessments([P1], makeDb([assessmentRow({ score: 150 })]))),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'component_assessment.score',
    'out of range'
  );
  assertError(
    await rejectionOf(loadComponentAssessments([P1], makeDb([assessmentRow({ assessed_at: 'garbage' })]))),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'component_assessment.assessed_at',
    'bad timestamp'
  );
});

test('PostgreSQL errors propagate unchanged', async () => {
  const boom = new Error('connection refused');
  const db = makeDb([], { error: boom });
  const error = await rejectionOf(loadComponentAssessments([P1], db));
  assert.equal(error, boom);
});