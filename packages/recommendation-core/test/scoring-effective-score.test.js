'use strict';

// ---------------------------------------------------------------------------
// Engine 4 (Decision 13 STEP 1): focused tests for the effective score.
//
// Scope: the no-evidence branch (no row / NULL score), the linear staleness
// decay with its floor, the confidence blend toward neutral_baseline, the
// multiplier coverage guard (DECISION REQUIRED A3), the injected-decision-
// timestamp contract (no clock reads), selectAssessmentRow's deterministic
// policy (DECISION REQUIRED A2), and the failure mapping. The loader is NOT
// re-tested here.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { selectAssessmentRow, computeEffectiveScore } = require('./effective-score');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const NOW_MS = Date.parse('2026-09-19T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function makeConfiguration(overrides = {}) {
  return {
    version_note: 'shape spec; every key REQUIRED, engine fails fast otherwise',
    role_weights: { CPU: { PERFORMANCE: 0.4, VALUE: 0.3 } },
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

function assessment(overrides = {}) {
  return { score: 80, confidence: 'CONFIRMED', assessed_at: NOW_MS, ...overrides };
}

function call(assessmentOverrides, configOverrides = {}, nowMs = NOW_MS) {
  return computeEffectiveScore({
    assessment: assessmentOverrides === null ? null : assessment(assessmentOverrides),
    configuration: makeConfiguration(configOverrides),
    nowMs,
  });
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

// No-evidence branch --------------------------------------------------------

test('no row OR a NULL score both take the no-evidence branch (Decision 13)', () => {
  assert.equal(call(null), 40); // max(0, 50 - 10)
  assert.equal(call({ score: null }), 40);
});

test('a no_evidence_penalty beyond the baseline clamps at zero', () => {
  assert.equal(call(null, { no_evidence_penalty: 60 }), 0);
});

// Evidence branch: linear decay, blend toward the baseline -------------------

test('a fresh CONFIRMED score passes through at its measured value', () => {
  assert.equal(call({}), 80); // decay 1, mult 1: 50 + 1*(80-50)
});

test('linear decay over real-valued age days, blended toward the baseline', () => {
  // age 10 days: decay = 1 - 0.005*10 = 0.95; decayed = 76; HIGH mult 0.8
  // effective = 50 + 0.8*(76-50) = 70.8
  const result = call({ assessed_at: NOW_MS - 10 * DAY_MS, confidence: 'HIGH' });
  assert.ok(Math.abs(result - 70.8) < 1e-9, `expected ~70.8, got ${result}`);
});

test('fractional age days decay fractionally', () => {
  // age 0.5 day: decay = 0.9975; decayed = 79.8; effective = 79.8
  const result = call({ assessed_at: NOW_MS - 0.5 * DAY_MS });
  assert.ok(Math.abs(result - 79.8) < 1e-9, `expected ~79.8, got ${result}`);
});

test('max_age_days is a hard floor on the decay input', () => {
  // age 200 days: min(200, 180) = 180 -> decay = 1 - 0.9 = 0.1 -> decayed = 8
  const result = call({ assessed_at: NOW_MS - 200 * DAY_MS });
  assert.ok(Math.abs(result - 8) < 1e-9, `expected ~8, got ${result}`);
});

test('the decay itself floors at zero (never negative)', () => {
  // per_day_decay 1, max_age_days 1, age 2 days: 1 - 2 -> max(0, -1) = 0
  const result = call(
    { assessed_at: NOW_MS - 2 * DAY_MS },
    { staleness: { max_age_days: 1, per_day_decay: 1 } }
  );
  assert.equal(result, 0);
});

test('UNVERIFIED blends fully to the baseline (never multiplies toward zero)', () => {
  // decayed = 76, mult = 0: effective = 50 + 0*(76-50) = 50
  const result = call({ assessed_at: NOW_MS - 10 * DAY_MS, confidence: 'UNVERIFIED' });
  assert.equal(result, 50);
});

test('a future assessed_at is maximally fresh (age clamped at zero)', () => {
  const result = call({ assessed_at: NOW_MS + DAY_MS });
  assert.equal(result, 80);
});

// DECISION REQUIRED A3: multiplier coverage ----------------------------------

test('a DB confidence without a configured multiplier fails fast (A3)', async () => {
  const config = makeConfiguration();
  delete config.confidence_multipliers.LOW;
  assertError(
    await rejectionOf(() =>
      computeEffectiveScore({ assessment: assessment({ confidence: 'LOW' }), configuration: config, nowMs: NOW_MS })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'confidence',
    'missing multiplier'
  );
});

test('a NULL confidence fails fast (A3; the column is nullable in migration 008)', async () => {
  assertError(
    await rejectionOf(() => call({ confidence: null })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'confidence',
    'null confidence'
  );
});

// Failure mapping ------------------------------------------------------------

test('argument failures fail fast with the existing error vocabulary', async () => {
  assertError(
    await rejectionOf(() =>
      computeEffectiveScore({ assessment: null, configuration: makeConfiguration(), nowMs: undefined })
    ),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'nowMs',
    'absent nowMs'
  );
  assertError(
    await rejectionOf(() => computeEffectiveScore({ assessment: null, configuration: makeConfiguration(), nowMs: NaN })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'nowMs',
    'NaN nowMs'
  );
  assertError(
    await rejectionOf(() => call({ score: 150 })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'assessment.score',
    'out of range'
  );
  assertError(
    await rejectionOf(() => call({ score: '80' })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'assessment.score',
    'non-number'
  );
  assertError(
    await rejectionOf(() => call({ confidence: 5 })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'assessment.confidence',
    'non-string confidence'
  );
  assertError(
    await rejectionOf(() => computeEffectiveScore({ assessment: null, configuration: null, nowMs: NOW_MS })),
    ERROR_CODES.INVALID_INPUT,
    'configuration',
    'null configuration'
  );
  assertError(
    await rejectionOf(() => call({}, { staleness: { per_day_decay: 0.005 } })),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'staleness.max_age_days',
    'missing staleness field'
  );
});

test('the pure step never mutates or freezes caller-owned inputs', async () => {
  const configuration = makeConfiguration();
  const row = assessment({});
  computeEffectiveScore({ assessment: row, configuration, nowMs: NOW_MS });
  assert.ok(!Object.isFrozen(configuration));
  assert.ok(!Object.isFrozen(row));
  assert.deepEqual(row, { score: 80, confidence: 'CONFIRMED', assessed_at: NOW_MS });
});

// selectAssessmentRow (DECISION REQUIRED A2 policy) --------------------------

test('selectAssessmentRow takes the FIRST row of the type (newest first per loader order)', () => {
  const newest = assessment({ score: 90, assessment_type: 'VALUE' });
  const older = assessment({ score: 70, assessment_type: 'VALUE' });
  const rows = [assessment({ assessment_type: 'PERFORMANCE' }), newest, older];
  assert.equal(selectAssessmentRow(rows, 'VALUE'), newest);
  assert.equal(selectAssessmentRow(rows, 'PERFORMANCE').assessment_type, 'PERFORMANCE');
});

test('selectAssessmentRow yields null for absent types and absent input', () => {
  assert.equal(selectAssessmentRow([assessment()], 'VALUE'), null);
  assert.equal(selectAssessmentRow(undefined, 'VALUE'), null);
  assert.equal(selectAssessmentRow(null, 'VALUE'), null);
});

test('selectAssessmentRow validates its arguments', async () => {
  assertError(
    await rejectionOf(() => selectAssessmentRow([assessment()], '')),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'assessment_type',
    'blank type'
  );
  assertError(
    await rejectionOf(() => selectAssessmentRow('nope', 'VALUE')),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'rows',
    'non-array rows'
  );
});