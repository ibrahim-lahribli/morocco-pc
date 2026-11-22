'use strict';

// packages/recommendation-runtime/test/scoring-load-scoring-model.test.js — the
// Decision 11 pinned `scoring_model` loader now lives in this package, batch
// `step-5-w1-query-scoring`.
//
// What it proves, and why each point is here rather than in the L1 suite that
// stayed at the old path (src/recommendation/scoring/load-scoring-model.test.js):
//   1. the module is loadable from its NEW path and still exports its surface;
//   2. the old path is the SAME module by identity, not a second copy;
//   3. the lookup is still the exact pinned-ID query on $1, with the is_active
//      eligibility predicate deliberately NOT in the WHERE clause (Decision 11
//      Rule 1: an eligibility check, never discovery);
//   4. the failure path still fails fast through the injected client: no row
//      means SCORING_MODEL_UNAVAILABLE, with the id carried in `field`.
//
// It asserts no valid configuration fixture on purpose: the Decision 3(a)
// configuration contract is the core's, and its exhaustive suite already
// covers it. This suite pins the boundary the move could break.
//
// DB-free: the query is issued against a fake client that records its calls.
// No database, no environment, no clock read.
//
//   npm run test:runtime        (from the repo root)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  loadScoringModel,
  SELECT_SCORING_MODEL_SQL,
} = require('../src/scoring/load-scoring-model');
const shim = require('../../../src/recommendation/scoring/load-scoring-model');

const core = require('../src/core-entry');
const { CandidateSelectionError, ERROR_CODES } = core.candidates;

const MODEL_ID = '22222222-2222-4222-8222-222222222222';

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

test('loads from the runtime package and exports the Decision 11 surface', () => {
  assert.equal(typeof loadScoringModel, 'function');
  assert.equal(typeof SELECT_SCORING_MODEL_SQL, 'string');
  assert.ok(SELECT_SCORING_MODEL_SQL.includes('FROM scoring_model'));
});

test('the old path is the same module by identity, not a second implementation', () => {
  assert.equal(shim.loadScoringModel, loadScoringModel);
  assert.equal(shim.SELECT_SCORING_MODEL_SQL, SELECT_SCORING_MODEL_SQL);
});

test('the lookup stays pinned on $1 and keeps eligibility out of the WHERE clause', () => {
  assert.ok(SELECT_SCORING_MODEL_SQL.includes('WHERE id = $1'));
  assert.ok(!SELECT_SCORING_MODEL_SQL.includes('${'), 'no template interpolation');
  // is_active is a SELECTED column (the loader checks strict `true` in JS); what
  // must never appear is an eligibility predicate folded into the WHERE clause
  // (Decision 11 Rule 1: an eligibility check, never discovery).
  assert.ok(!SELECT_SCORING_MODEL_SQL.includes('AND is_active'), 'eligibility is never folded into the lookup');
  assert.ok(!SELECT_SCORING_MODEL_SQL.includes('is_active = true'), 'only strict true is active, and only in JS');
  assert.ok(SELECT_SCORING_MODEL_SQL.trimEnd().endsWith('WHERE id = $1'), 'the lookup is the pinned id and nothing else');
});

test('a missing row fails fast through the injected client', async () => {
  const db = makeDb([]);
  await assert.rejects(
    () => loadScoringModel(MODEL_ID, db),
    (err) => {
      assert.ok(err instanceof CandidateSelectionError);
      assert.equal(err.code, ERROR_CODES.SCORING_MODEL_UNAVAILABLE);
      assert.equal(err.field, MODEL_ID);
      return true;
    }
  );
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, [MODEL_ID]);
});
