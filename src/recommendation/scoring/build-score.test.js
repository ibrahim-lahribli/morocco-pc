'use strict';

// ---------------------------------------------------------------------------
// Engine 4 (Decision 13 STEP 3): focused tests for the build score.
//
// Scope: the (role, type) weighted average with renormalized missing roles,
// the per-occurrence UNKNOWN penalty and the [0, 100] clamp, the
// unknownPairwiseCount contract (BLOCKING QUESTION B1, resolved by Decision
// 15: an injected array wins; the build-carried unknown_pairwise_count is
// the batch fallback), the build-shape and coverage guards (A4/A5/A6), the
// batch form, and the failure mapping.
// STEP 1 arithmetic is NOT re-tested here (see effective-score.test.js).
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  computeBuildScore,
  computeBuildScores,
  computeBuildScoreContributions,
} = require('./build-score');
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

function makeBuild(components, unknownPairwiseCount = 0) {
  return Object.freeze({
    components: Object.freeze(components),
    total_price: components.length * 100,
    currency: 'MAD',
    unknown_pairwise_count: unknownPairwiseCount,
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
});

// Decision 15: the build-carried count is the batch fallback -----------------

test('Decision 15: computeBuildScores falls back to each build unknown_pairwise_count', () => {
  const config = makeConfiguration();
  const withCount = makeBuild([component('CPU', P1), component('MOTHERBOARD', P2)], 2);
  const zeroCount = makeBuild([component('CPU', P1)]);
  const fromBuilds = computeBuildScores({
    builds: [withCount, zeroCount],
    assessments: makeAssessments(),
    configuration: config,
    nowMs: NOW_MS,
  });
  const injected = computeBuildScores({
    builds: [withCount, zeroCount],
    assessments: makeAssessments(),
    configuration: config,
    nowMs: NOW_MS,
    unknownPairwiseCounts: [2, 0],
  });
  // The fallback is exactly the injected form's producer result.
  assert.deepEqual(fromBuilds, injected);
  assert.ok(Math.abs(fromBuilds.scores[0].build_score - (34 / 0.525 - 2 * 5)) < 1e-9);
  assert.ok(Math.abs(fromBuilds.scores[1].build_score - 19 / 0.275) < 1e-9);
  assert.ok(Object.isFrozen(fromBuilds));
  assert.ok(Object.isFrozen(fromBuilds.scores));
  assert.ok(Object.isFrozen(fromBuilds.scores[0]));

  // An explicit empty array still wins for an empty build list.
  const empty = computeBuildScores({
    builds: [],
    assessments: {},
    configuration: config,
    nowMs: NOW_MS,
  });
  assert.deepEqual(empty.scores, []);
  assert.ok(Object.isFrozen(empty.scores));
});

test('Decision 15: a build without a valid unknown_pairwise_count fails fast in the batch form', async () => {
  const noCount = {
    components: Object.freeze([component('CPU', P1)]),
    total_price: 100,
    currency: 'MAD',
  };
  assertError(
    await rejectionOf(() =>
      computeBuildScores({
        builds: [noCount],
        assessments: makeAssessments(),
        configuration: makeConfiguration(),
        nowMs: NOW_MS,
      })
    ),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'unknownPairwiseCount',
    'build without count'
  );
  assertError(
    await rejectionOf(() =>
      computeBuildScores({
        builds: [makeBuild([component('CPU', P1)], -1)],
        assessments: makeAssessments(),
        configuration: makeConfiguration(),
        nowMs: NOW_MS,
      })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'unknownPairwiseCount',
    'negative build count'
  );
  assertError(
    await rejectionOf(() =>
      computeBuildScores({
        builds: [makeBuild([component('CPU', P1)], 1.5)],
        assessments: makeAssessments(),
        configuration: makeConfiguration(),
        nowMs: NOW_MS,
      })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'unknownPairwiseCount',
    'non-integer build count'
  );
});

// Decision 22 item 1: additive contributions exposure -------------------------

function contributionsOf(builds, configOverrides = {}, assessments = makeAssessments()) {
  return computeBuildScoreContributions({
    builds,
    assessments,
    configuration: makeConfiguration(configOverrides),
    nowMs: NOW_MS,
  });
}

function reconstructBuildScore(entries, configuration, unknownPairwiseCount) {
  // Sort by weight * effective_score descending (the Decision 22 item 1
  // dominance order); the sum is order-independent, which doubles as proof the
  // ordering rule does not change the score.
  const ordered = [...entries].sort(
    (a, b) => b.weight * b.effective_score - a.weight * a.effective_score
  );
  let numerator = 0;
  let denominator = 0;
  for (const item of ordered) {
    numerator += item.weight * item.effective_score;
    denominator += item.weight;
  }
  const raw = numerator / denominator;
  const penalized = raw - configuration.unknown_compat_penalty * unknownPairwiseCount;
  return Math.min(100, Math.max(0, penalized));
}

test('Decision 22 item 1: contributions are frozen, index-aligned, and use the {role,type,effective_score,weight} shape', () => {
  const builds = [fullBuild(), makeBuild([component('CPU', P1)])];
  const out = contributionsOf(builds);
  assert.deepEqual(Object.keys(out), ['contributions']);
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.contributions));
  assert.equal(out.contributions.length, builds.length);
  assert.ok(Object.isFrozen(out.contributions[0]));
  assert.ok(Object.isFrozen(out.contributions[0][0]));
  assert.deepEqual(
    Object.keys(out.contributions[0][0]).sort(),
    ['effective_score', 'role', 'type', 'weight']
  );
  // Inputs are never frozen or mutated by the additive function. The
  // makeBuild() fixtures arrive pre-frozen, so prove it on an unfrozen build.
  assert.ok(!Object.isFrozen(builds));
  const unfrozen = {
    components: Object.freeze([component('CPU', P1)]),
    total_price: 100,
    currency: 'MAD',
    unknown_pairwise_count: 0,
  };
  contributionsOf([unfrozen]);
  assert.ok(!Object.isFrozen(unfrozen));
});

test('Decision 22 item 1: contributions follow EXPANSION_ORDER then the configuration type-key order', () => {
  // Component order is deliberately reversed; iteration must not follow it.
  const reversed = makeBuild([component('MOTHERBOARD', P2), component('CPU', P1)]);
  const out = contributionsOf([reversed]);
  assert.deepEqual(
    out.contributions[0].map((item) => `${item.role}/${item.type}`),
    ['CPU/PERFORMANCE', 'CPU/VALUE', 'MOTHERBOARD/QUALITY']
  );
});

test('Decision 22 item 1: contribution weight and effective_score values are hand-checkable', () => {
  const out = contributionsOf([fullBuild()]);
  const list = out.contributions[0];
  assert.equal(list.length, 3);
  const byKey = Object.fromEntries(list.map((item) => [`${item.role}/${item.type}`, item]));
  // CPU/PERFORMANCE: 0.4 * 0.5 = 0.2; effective 80 (score 80, decay 1, CONFIRMED 1).
  assert.ok(Math.abs(byKey['CPU/PERFORMANCE'].weight - 0.2) < 1e-12);
  assert.ok(Math.abs(byKey['CPU/PERFORMANCE'].effective_score - 80) < 1e-12);
  // CPU/VALUE: 0.3 * 0.25 = 0.075; effective 40 (no row -> 50 - 10).
  assert.ok(Math.abs(byKey['CPU/VALUE'].weight - 0.075) < 1e-12);
  assert.ok(Math.abs(byKey['CPU/VALUE'].effective_score - 40) < 1e-12);
  // MOTHERBOARD/QUALITY: 1 * 0.25 = 0.25; effective 60.
  assert.ok(Math.abs(byKey['MOTHERBOARD/QUALITY'].weight - 0.25) < 1e-12);
  assert.ok(Math.abs(byKey['MOTHERBOARD/QUALITY'].effective_score - 60) < 1e-12);
});

test('Decision 22 item 1: contributions reproduce computeBuildScores build_score (cross-check)', () => {
  const config = makeConfiguration();
  const assessments = makeAssessments();
  const cpuOnly = makeBuild([component('CPU', P1)]);
  const penalized = makeBuild([component('CPU', P1), component('MOTHERBOARD', P2)], 2);
  const builds = [fullBuild(), cpuOnly, penalized];
  const scores = computeBuildScores({
    builds,
    assessments,
    configuration: config,
    nowMs: NOW_MS,
    unknownPairwiseCounts: [0, 0, 2],
  });
  const out = computeBuildScoreContributions({ builds, assessments, configuration: config, nowMs: NOW_MS });
  assert.equal(out.contributions.length, builds.length);
  for (let index = 0; index < builds.length; index += 1) {
    assert.equal(scores.scores[index].build_index, index);
    const reconstructed = reconstructBuildScore(
      out.contributions[index],
      config,
      builds[index].unknown_pairwise_count
    );
    assert.ok(
      Math.abs(reconstructed - scores.scores[index].build_score) < 1e-9,
      `build ${index}: contributions -> ${reconstructed}, computeBuildScores -> ${scores.scores[index].build_score}`
    );
  }
});

test('Decision 22 item 1: an empty build list yields frozen empty contributions', () => {
  const out = computeBuildScoreContributions({
    builds: [],
    assessments: {},
    configuration: makeConfiguration(),
    nowMs: NOW_MS,
  });
  assert.deepEqual(out.contributions, []);
  assert.ok(Object.isFrozen(out.contributions));
});

test('Decision 22 item 1: invalid builds fail fast with the existing vocabulary', async () => {
  assertError(
    await rejectionOf(() => contributionsOf('not-an-array')),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'builds',
    'non-array builds'
  );
  assertError(
    await rejectionOf(() => contributionsOf([makeBuild([])])),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'build.components',
    'empty components'
  );
  assertError(
    await rejectionOf(() =>
      contributionsOf([makeBuild([component('CASE', P1)])], {
        role_weights: { CPU: { PERFORMANCE: 0.4, VALUE: 0.3 } },
      })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'role_weights.CASE',
    'missing build role'
  );
});