'use strict';

// ---------------------------------------------------------------------------
// Engine 4 (Decision 13 STEP 2): focused tests for the candidate score.
//
// Scope: the weighted-average arithmetic over the configured type key set
// (DECISION REQUIRED A4 proposal), the no-evidence inheritance from STEP 1,
// the weight-sum guard (A5), the missing-role guard (A6), the unsorted frozen
// batch output (ranking is Decision 12/14 - owned by ../retention, Decision 12 RESOLVED 2026-09-20), and the failure
// mapping. STEP 1 arithmetic is NOT re-tested here (see effective-score).
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeCandidateScore, computeCandidateScores } = require('./candidate-score');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const NOW_MS = Date.parse('2026-09-19T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

function makeConfiguration(overrides = {}) {
  return {
    version_note: 'shape spec; every key REQUIRED, engine fails fast otherwise',
    role_weights: {
      CPU: { PERFORMANCE: 0.4, VALUE: 0.3 },
      GPU: { PERFORMANCE: 0.5, VALUE: 0.25 },
    },
    type_weights: { PERFORMANCE: 0.5, VALUE: 0.25, QUALITY: 0.25 },
    neutral_baseline: 50,
    no_evidence_penalty: 10,
    unknown_compat_penalty: 5,
    confidence_multipliers: {
      CONFIRMED: 1,
      HIGH: 0.8,
      MEDIUM: 0.6,
      LOW: 0.3,
      UNVERIFIED: 0,
    },
    staleness: { max_age_days: 180, per_day_decay: 0.005 },
    candidate_caps: { top_k_per_role: 5, max_builds_per_query: 25 },
    gpu_required_use_cases: ['GAMING', 'WORKSTATION'],
    ...overrides,
  };
}

/** Loader-shape assessments: { [product_id]: [frozen rows in SQL order] }. */
function makeAssessments() {
  return {
    [P1]: [
      Object.freeze({ assessment_type: 'PERFORMANCE', score: 80, confidence: 'CONFIRMED', assessed_at: NOW_MS }),
    ],
    // P2 carries the DECISION REQUIRED A2 case: newest row first per loader order.
    [P2]: [
      Object.freeze({ assessment_type: 'VALUE', score: 90, confidence: 'CONFIRMED', assessed_at: NOW_MS }),
      Object.freeze({ assessment_type: 'VALUE', score: 70, confidence: 'CONFIRMED', assessed_at: NOW_MS - DAY_MS }),
    ],
  };
}

function cpuCandidate(productId, overrides = {}) {
  return { product_id: productId, product_variant_id: null, component_role: 'CPU', ...overrides };
}

async function rejectionOf(fn) {
  try {
    fn();
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

// STEP 2 arithmetic ----------------------------------------------------------

test('the weighted average runs over the configured type set; missing types inherit STEP 1 no-evidence', () => {
  // effective(PERFORMANCE) = 80 (fresh CONFIRMED), effective(VALUE) = 40 (no row)
  // score = (0.4*80 + 0.3*40) / 0.7 = 44 / 0.7
  const score = computeCandidateScore({
    candidate: cpuCandidate(P1),
    assessments: makeAssessments(),
    configuration: makeConfiguration(),
    nowMs: NOW_MS,
  });
  assert.ok(Math.abs(score - 44 / 0.7) < 1e-9, `expected ~${44 / 0.7}, got ${score}`);
});

test('a completely unassessed product scores the pure no-evidence average', () => {
  const config = makeConfiguration();
  for (const assessments of [undefined, null, {}]) {
    const score = computeCandidateScore({
      candidate: cpuCandidate(P3),
      assessments,
      configuration: config,
      nowMs: NOW_MS,
    });
    // (0.4*40 + 0.3*40) / 0.7 = 40
    assert.ok(Math.abs(score - 40) < 1e-9, `expected ~40, got ${score}`);
  }
});

test('role weights are per-role: a GPU candidate uses role_weights.GPU', () => {
  // effective(PERFORMANCE) = 80, effective(VALUE) = 40
  // score = (0.5*80 + 0.25*40) / 0.75 = 50 / 0.75
  const score = computeCandidateScore({
    candidate: cpuCandidate(P1, { component_role: 'GPU', product_variant_id: 'variant' }),
    assessments: makeAssessments(),
    configuration: makeConfiguration(),
    nowMs: NOW_MS,
  });
  assert.ok(Math.abs(score - 50 / 0.75) < 1e-9, `expected ~${50 / 0.75}, got ${score}`);
});

// DECISION REQUIRED A2: newest-row selection through STEP 2 ------------------

test('A2: the FIRST (newest) row of the type is scored, per the loader order', () => {
  // P2: PERFORMANCE missing -> 40; VALUE newest = 90 -> effective 90
  // score = (0.4*40 + 0.3*90) / 0.7 = 43 / 0.7
  const score = computeCandidateScore({
    candidate: cpuCandidate(P2),
    assessments: makeAssessments(),
    configuration: makeConfiguration(),
    nowMs: NOW_MS,
  });
  assert.ok(Math.abs(score - 43 / 0.7) < 1e-9, `expected ~${43 / 0.7}, got ${score}`);
});

test('A2: a newer NULL-score row shadows an older scored row (formula verbatim)', () => {
  // P3 newest VALUE row has score null -> VALUE effective 40 (both branches)
  const assessments = {
    [P3]: [
      Object.freeze({ assessment_type: 'VALUE', score: null, confidence: 'CONFIRMED', assessed_at: NOW_MS }),
      Object.freeze({ assessment_type: 'VALUE', score: 90, confidence: 'CONFIRMED', assessed_at: NOW_MS - DAY_MS }),
    ],
  };
  const score = computeCandidateScore({
    candidate: cpuCandidate(P3),
    assessments,
    configuration: makeConfiguration(),
    nowMs: NOW_MS,
  });
  assert.ok(Math.abs(score - 40) < 1e-9, `expected ~40, got ${score}`);
});

// Batch form (unsorted, frozen) ----------------------------------------------

test('computeCandidateScores preserves input order, unsorted, and freezes its output', () => {
  const config = makeConfiguration();
  const out = computeCandidateScores({
    candidates: [cpuCandidate(P2), cpuCandidate(P1)],
    assessments: makeAssessments(),
    configuration: config,
    nowMs: NOW_MS,
  });
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.scores));
  assert.ok(Object.isFrozen(out.scores[0]));
  assert.equal(out.scores.length, 2);
  // Incoming order preserved: NO sorting, NO ranking (Decision 12/14 concerns, owned by ../retention, Decision 12 RESOLVED 2026-09-20).
  assert.equal(out.scores[0].product_id, P2);
  assert.equal(out.scores[1].product_id, P1);
  assert.equal(out.scores[0].component_role, 'CPU');
  assert.equal(out.scores[0].product_variant_id, null);
  assert.ok(typeof out.scores[0].candidate_score === 'number');
  assert.ok(!Object.isFrozen(config));
});

test('an empty candidate list scores as an empty result', () => {
  const out = computeCandidateScores({
    candidates: [],
    assessments: {},
    configuration: makeConfiguration(),
    nowMs: NOW_MS,
  });
  assert.deepEqual(out.scores, []);
  assert.ok(Object.isFrozen(out.scores));
});

// Guards A5 / A6 and failure mapping ------------------------------------------

test('A6: a candidate role missing from role_weights fails fast', async () => {
  assertError(
    await rejectionOf(() =>
      computeCandidateScore({
        candidate: cpuCandidate(P1, { component_role: 'CASE' }),
        assessments: makeAssessments(),
        configuration: makeConfiguration(),
        nowMs: NOW_MS,
      })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'role_weights.CASE',
    'missing role'
  );
});

test('A5: a role weight sum <= 0 fails fast', async () => {
  assertError(
    await rejectionOf(() =>
      computeCandidateScore({
        candidate: cpuCandidate(P1, { component_role: 'GPU' }),
        assessments: makeAssessments(),
        configuration: makeConfiguration({
          role_weights: { GPU: { PERFORMANCE: 0.5, VALUE: -0.5 } },
        }),
        nowMs: NOW_MS,
      })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'role_weights.GPU',
    'zero-sum weights'
  );
});

test('argument failures fail fast with the existing error vocabulary', async () => {
  const config = makeConfiguration();
  assertError(
    await rejectionOf(() =>
      computeCandidateScore({ candidate: null, assessments: {}, configuration: config, nowMs: NOW_MS })
    ),
    ERROR_CODES.INVALID_INPUT,
    'candidate',
    'null candidate'
  );
  assertError(
    await rejectionOf(() =>
      computeCandidateScore({
        candidate: cpuCandidate(P1, { component_role: 'NOPE' }),
        assessments: {},
        configuration: config,
        nowMs: NOW_MS,
      })
    ),
    ERROR_CODES.INVALID_COMPONENT_ROLE,
    'candidate.component_role',
    'bad role'
  );
  assertError(
    await rejectionOf(() =>
      computeCandidateScore({ candidate: cpuCandidate(P1), assessments: [P1], configuration: config, nowMs: NOW_MS })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'assessments',
    'wrong map shape'
  );
  assertError(
    await rejectionOf(() =>
      computeCandidateScore({ candidate: cpuCandidate(P1), assessments: {}, configuration: config, nowMs: undefined })
    ),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'nowMs',
    'absent nowMs'
  );
  assertError(
    await rejectionOf(() =>
      computeCandidateScores({ candidates: 'nope', assessments: {}, configuration: config, nowMs: NOW_MS })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'candidates',
    'non-array candidates'
  );
});