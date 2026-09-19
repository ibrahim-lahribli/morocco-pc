'use strict';

// ---------------------------------------------------------------------------
// Engine 4 (Decision 13 STEP 3): focused tests for the build score.
//
// Scope: the (role, type) weighted average with renormalized missing roles,
// the per-occurrence UNKNOWN penalty and the [0, 100] clamp, the injected
// unknownPairwiseCount contract (BLOCKING QUESTION B1), the build-shape and
// coverage guards (A4/A5/A6), the batch form, and the failure mapping.
// STEP 1 arithmetic is NOT re-tested here (see effective-score.test.js).
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeBuildScore, computeBuildScores } = require('./build-score');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const NOW_MS = Date.parse('2026-09-19T00:00:00.000Z');
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

function makeConfiguration(overrides = {}) {
  return {
    version_note: 'shape spec; every key REQUIRED, engine fails fast otherwise',
    role_weights: {
      CPU: { PERFORMANCE: 0.4, VALUE: 0.3 },
      MOTHERBOARD: { QUALITY: 1 },
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

function makeAssessments(overrides = {}) {
  return {
    [P1]: [
      Object.freeze({ assessment_type: 'PERFORMANCE', score: 80, confidence: 'CONFIRMED', assessed_at: NOW_MS }),
    ],
    [P2]: [
      Object.freeze({ assessment_type: 'QUALITY', score: 60, confidence: 'CONFIRMED', assessed_at: NOW_MS }),
    ],
    ...overrides,
  };
}

function component(role, productId) {
  return Object.freeze({
    component_role: role,
    product_id: productId,
    product_variant_id: role === 'GPU' ? 'variant' : null,
    category: 'x',
    status: 'PASS',
    price: Object.freeze({ selected_price: 100, currency: 'MAD', store_id: 's', price_checked_at: '2026-09-19T00:00:00.000Z' }),
  });
}

function makeBuild(components) {
  return Object.freeze({
    components: Object.freeze(components),
    total_price: components.length * 100,
    currency: 'MAD',
  });
}

function fullBuild() {
  return makeBuild([component('CPU', P1), component('MOTHERBOARD', P2)]);
}

function call(build, unknownPairwiseCount, configOverrides = {}, assessments = makeAssessments()) {
  return computeBuildScore({
    build,
    assessments,
    configuration: makeConfiguration(configOverrides),
    nowMs: NOW_MS,
    unknownPairwiseCount,
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

// STEP 3 arithmetic ----------------------------------------------------------

test('the (role,type) weighted average with STEP 1 effective scores', () => {
  // CPU: effective(PERFORMANCE) = 80, effective(VALUE) = 40 (no row)
  // MOTHERBOARD: effective(QUALITY) = 60
  // numerator = 0.4*0.5*80 + 0.3*0.25*40 + 1*0.25*60 = 34
  // denominator = 0.2 + 0.075 + 0.25 = 0.525
  const score = call(fullBuild(), 0);
  assert.ok(Math.abs(score - 34 / 0.525) < 1e-9, `expected ~${34 / 0.525}, got ${score}`);
});

test('the UNKNOWN penalty is applied PER-OCCURRENCE from the injected count', () => {
  const base = 34 / 0.525;
  assert.ok(Math.abs(call(fullBuild(), 2) - (base - 2 * 5)) < 1e-9, 'two occurrences subtract twice');
  // Per-occurrence compounding drives the clamp at zero.
  assert.equal(call(fullBuild(), 100), 0);
});

test('the build score clamps at exactly 100 for all-top scores', () => {
  const assessments = {
    [P1]: [
      Object.freeze({ assessment_type: 'PERFORMANCE', score: 100, confidence: 'CONFIRMED', assessed_at: NOW_MS }),
      Object.freeze({ assessment_type: 'VALUE', score: 100, confidence: 'CONFIRMED', assessed_at: NOW_MS }),
    ],
    [P2]: [
      Object.freeze({ assessment_type: 'QUALITY', score: 100, confidence: 'CONFIRMED', assessed_at: NOW_MS }),
    ],
  };
  assert.equal(call(fullBuild(), 0, {}, assessments), 100);
});

test('missing/optional roles are EXCLUDED and the denominator renormalizes', () => {
  // CPU only: numerator = 0.4*0.5*80 + 0.3*0.25*40 = 19; denominator = 0.275
  // GPU-optional omit path and any absent role behave the same way.
  const cpuOnly = makeBuild([component('CPU', P1)]);
  const expected = 19 / 0.275;
  assert.ok(Math.abs(call(cpuOnly, 0) - expected) < 1e-9, `expected ~${expected}, got ${call(cpuOnly, 0)}`);
  assert.ok(Math.abs(call(cpuOnly, 1) - (expected - 5)) < 1e-9, 'one occurrence subtracts once');
});

test('component order never matters: role iteration follows EXPANSION_ORDER', () => {
  const reversed = makeBuild([component('MOTHERBOARD', P2), component('CPU', P1)]);
  assert.ok(Math.abs(call(reversed, 0) - call(fullBuild(), 0)) < 1e-12);
});

// Guards A4 / A6 / B1 and build-shape failures -------------------------------

test('A6: a build role missing from role_weights fails fast', async () => {
  assertError(
    await rejectionOf(() =>
      call(makeBuild([component('CASE', P1)]), 0, { role_weights: { CPU: { PERFORMANCE: 0.4, VALUE: 0.3 } } })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'role_weights.CASE',
    'missing build role'
  );
});

test('A4: type_weights must cover every configured type of a participating role', async () => {
  assertError(
    await rejectionOf(() => call(fullBuild(), 0, { type_weights: { PERFORMANCE: 0.5, VALUE: 0.25 } })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'type_weights.QUALITY',
    'uncovered type'
  );
});

test('B1: the UNKNOWN count is a required injected input (no silent default)', async () => {
  assertError(
    await rejectionOf(() =>
      computeBuildScore({
        build: fullBuild(),
        assessments: makeAssessments(),
        configuration: makeConfiguration(),
        nowMs: NOW_MS,
      })
    ),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'unknownPairwiseCount',
    'absent count'
  );
  assertError(
    await rejectionOf(() => call(fullBuild(), -1)),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'unknownPairwiseCount',
    'negative count'
  );
  assertError(
    await rejectionOf(() => call(fullBuild(), 1.5)),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'unknownPairwiseCount',
    'non-integer count'
  );
});

test('build-shape violations fail fast', async () => {
  assertError(
    await rejectionOf(() => call(makeBuild([component('CPU', P1), component('CPU', P2)]), 0)),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'build.components',
    'duplicate role'
  );
  assertError(
    await rejectionOf(() => call(makeBuild([component('SSD_SECONDARY', P1)]), 0)),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'build.components.0.component_role',
    'non-participating role'
  );
  assertError(
    await rejectionOf(() => call(makeBuild([]), 0)),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'build.components',
    'empty components'
  );
});

// Batch form -----------------------------------------------------------------

test('computeBuildScores is index-aligned, frozen, and accepts an empty build list', () => {
  const config = makeConfiguration();
  const cpuOnly = makeBuild([component('CPU', P1)]);
  const out = computeBuildScores({
    builds: [fullBuild(), cpuOnly],
    assessments: makeAssessments(),
    configuration: config,
    nowMs: NOW_MS,
    unknownPairwiseCounts: [0, 1],
  });
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.scores));
  assert.ok(Object.isFrozen(out.scores[0]));
  assert.equal(out.scores.length, 2);
  assert.deepEqual(Object.keys(out.scores[0]).sort(), ['build_index', 'build_score']);
  assert.equal(out.scores[0].build_index, 0);
  assert.equal(out.scores[1].build_index, 1);
  assert.ok(Math.abs(out.scores[0].build_score - 34 / 0.525) < 1e-9);
  assert.ok(Math.abs(out.scores[1].build_score - (19 / 0.275 - 5)) < 1e-9);
  assert.ok(!Object.isFrozen(config));

  const empty = computeBuildScores({
    builds: [],
    assessments: {},
    configuration: config,
    nowMs: NOW_MS,
    unknownPairwiseCounts: [],
  });
  assert.deepEqual(empty.scores, []);
  assert.ok(Object.isFrozen(empty.scores));
});

test('computeBuildScores requires counts aligned with builds by index', async () => {
  assertError(
    await rejectionOf(() =>
      computeBuildScores({
        builds: [fullBuild()],
        assessments: makeAssessments(),
        configuration: makeConfiguration(),
        nowMs: NOW_MS,
        unknownPairwiseCounts: [],
      })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'unknownPairwiseCounts',
    'length mismatch'
  );
  assertError(
    await rejectionOf(() =>
      computeBuildScores({
        builds: [fullBuild()],
        assessments: makeAssessments(),
        configuration: makeConfiguration(),
        nowMs: NOW_MS,
      })
    ),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'unknownPairwiseCounts',
    'absent counts'
  );
});