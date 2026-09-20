'use strict';

// ---------------------------------------------------------------------------
// Decision 12 (src/recommendation/retention/): focused unit tests for the
// per-role top-K retention stage (Decision 14 Rules 2-5 semantics).
//
// Scope: Rule 2 eligibility (PASS/UNKNOWN only, REJECT never ranks), Rule 3
// score-DESC ordering, Rule 5 compareCandidates() tie-break (reused, not
// reimplemented), Rule 4 hard cap (retained_count = min(K, eligible_count)),
// the frozen Engine 3 candidate-pool input shape ({ results } of intact
// verdicts), the real Engine 4 STEP 2 contract (computeCandidateScores
// output drops in without adaptation), purity/determinism, and the fail-fast
// gates. No database is used or required anywhere in this file.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { retainTopKPerRole } = require('./retain');
const { CANDIDATE_STATUSES } = require('../filtering/filter');
const { ROLE_CATEGORIES } = require('../candidates/roles');
const { createCandidate } = require('../candidates');
const { computeCandidateScores } = require('../scoring/candidate-score');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

// ---------------------------------------------------------------------------
// Fixtures: hand-built frozen Engine 2D verdicts and Engine 4 STEP 2 score
// records in their exact documented shapes.
// ---------------------------------------------------------------------------

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function verdict(role, productId, overrides = {}) {
  const { variantId = null, status = CANDIDATE_STATUSES.PASS, ...rest } = overrides;
  return deepFreeze({
    product_id: productId,
    product_variant_id: variantId,
    category: ROLE_CATEGORIES[role],
    component_role: role,
    status,
    reason: null,
    relationships: {},
    unknown_pairwise_count: 0,
    ...rest,
  });
}

function scoreEntry(role, productId, candidateScore, variantId = null) {
  return deepFreeze({
    product_id: productId,
    product_variant_id: variantId,
    component_role: role,
    candidate_score: candidateScore,
  });
}

function scores(...entries) {
  return deepFreeze({ scores: entries });
}

/** Identity labels used in ordering assertions (variants tagged with #). */
function ids(results) {
  return results.map((entry) =>
    entry.product_variant_id === null
      ? entry.product_id
      : `${entry.product_id}#${entry.product_variant_id}`
  );
}

function rejectionOf(fn) {
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

// ---------------------------------------------------------------------------
// Decision 14 Rule 2 - eligibility (PASS | UNKNOWN only; REJECT never ranks)
// ---------------------------------------------------------------------------

test('Rule 2: REJECT never ranks, even with the top score', () => {
  const results = [
    verdict('CPU', 'cpu-top', { status: CANDIDATE_STATUSES.REJECT }),
    verdict('CPU', 'cpu-pass'),
    verdict('CPU', 'cpu-unknown', { status: CANDIDATE_STATUSES.UNKNOWN }),
  ];
  const out = retainTopKPerRole({
    filterResult: { results },
    candidateScores: scores(
      scoreEntry('CPU', 'cpu-top', 99),
      scoreEntry('CPU', 'cpu-pass', 50),
      scoreEntry('CPU', 'cpu-unknown', 10)
    ),
    topKPerRole: 3,
  });
  // Score DESC within the retained set (Rule 3); UNKNOWN ranks like PASS.
  assert.deepEqual(ids(out.results), ['cpu-pass', 'cpu-unknown']);
});

test('Rule 2: a REJECT verdict needs no score entry (excluded before ranking)', () => {
  const out = retainTopKPerRole({
    filterResult: {
      results: [
        verdict('CPU', 'cpu-reject', { status: CANDIDATE_STATUSES.REJECT }),
        verdict('CPU', 'cpu-pass'),
      ],
    },
    candidateScores: scores(scoreEntry('CPU', 'cpu-pass', 50)),
    topKPerRole: 3,
  });
  assert.deepEqual(ids(out.results), ['cpu-pass']);
});

// ---------------------------------------------------------------------------
// Decision 14 Rule 3 - ranking by candidate score DESC
// ---------------------------------------------------------------------------

test('Rule 3: per-role ordering is candidate score DESC, independent of input order', () => {
  const results = [
    verdict('CPU', 'cpu-c'),
    verdict('CPU', 'cpu-a'),
    verdict('CPU', 'cpu-b'),
  ];
  const out = retainTopKPerRole({
    filterResult: { results },
    candidateScores: scores(
      scoreEntry('CPU', 'cpu-c', 90),
      scoreEntry('CPU', 'cpu-a', 85),
      scoreEntry('CPU', 'cpu-b', 80)
    ),
    topKPerRole: 3,
  });
  assert.deepEqual(ids(out.results), ['cpu-c', 'cpu-a', 'cpu-b']);
});

// ---------------------------------------------------------------------------
// Decision 14 Rule 5 - equal-score handling (the authorized tie-break chain)
// ---------------------------------------------------------------------------

test('Rule 5: equal scores fall back to the compareCandidates chain (product_id ASC)', () => {
  const results = [
    verdict('CPU', 'cpu-b'),
    verdict('CPU', 'cpu-a'),
    verdict('CPU', 'cpu-c'),
  ];
  const out = retainTopKPerRole({
    filterResult: { results },
    candidateScores: scores(
      scoreEntry('CPU', 'cpu-b', 50),
      scoreEntry('CPU', 'cpu-a', 50),
      scoreEntry('CPU', 'cpu-c', 50)
    ),
    topKPerRole: 3,
  });
  assert.deepEqual(ids(out.results), ['cpu-a', 'cpu-b', 'cpu-c']);
});

test('Rule 5: GPU variant tie-break is product_id ASC, then variant ASC, NULL first', () => {
  const results = [
    verdict('GPU', 'gpu-b', { variantId: 'v2' }),
    verdict('GPU', 'gpu-a', { variantId: 'v9' }),
    verdict('GPU', 'gpu-b', { variantId: 'v1' }),
    verdict('GPU', 'gpu-c', { variantId: 'v1' }),
    verdict('GPU', 'gpu-c', { variantId: null }),
  ];
  const out = retainTopKPerRole({
    filterResult: { results },
    candidateScores: scores(
      scoreEntry('GPU', 'gpu-b', 70, 'v2'),
      scoreEntry('GPU', 'gpu-a', 70, 'v9'),
      scoreEntry('GPU', 'gpu-b', 70, 'v1'),
      scoreEntry('GPU', 'gpu-c', 70, 'v1'),
      scoreEntry('GPU', 'gpu-c', 70, null)
    ),
    topKPerRole: 5,
  });
  // The comparator chain is reused verbatim; Engine 2B variant-identity rules
  // are the pool's contract, never re-enforced (or needed) here.
  assert.deepEqual(ids(out.results), [
    'gpu-a#v9',
    'gpu-b#v1',
    'gpu-b#v2',
    'gpu-c', // NULL variant first for the same product
    'gpu-c#v1',
  ]);
});

// ---------------------------------------------------------------------------
// Decision 14 Rule 4 - retention (hard upper bound)
// ---------------------------------------------------------------------------

test('Rule 4: retained_count = min(K, eligible_count)', () => {
  const results = [verdict('CPU', 'cpu-1'), verdict('CPU', 'cpu-2'), verdict('CPU', 'cpu-3')];
  const candidateScores = scores(
    scoreEntry('CPU', 'cpu-1', 30),
    scoreEntry('CPU', 'cpu-2', 20),
    scoreEntry('CPU', 'cpu-3', 10)
  );
  assert.deepEqual(
    ids(retainTopKPerRole({ filterResult: { results }, candidateScores, topKPerRole: 1 }).results),
    ['cpu-1']
  );
  assert.deepEqual(
    ids(retainTopKPerRole({ filterResult: { results }, candidateScores, topKPerRole: 2 }).results),
    ['cpu-1', 'cpu-2']
  );
  // Fewer eligible candidates than K: all of them are retained.
  assert.deepEqual(
    ids(retainTopKPerRole({ filterResult: { results }, candidateScores, topKPerRole: 5 }).results),
    ['cpu-1', 'cpu-2', 'cpu-3']
  );
});

test('Rule 4: equal scores at the K boundary never expand retention', () => {
  const results = [verdict('CPU', 'cpu-3'), verdict('CPU', 'cpu-2'), verdict('CPU', 'cpu-1')];
  const candidateScores = scores(
    scoreEntry('CPU', 'cpu-1', 90),
    scoreEntry('CPU', 'cpu-2', 80),
    scoreEntry('CPU', 'cpu-3', 80)
  );
  const out = retainTopKPerRole({ filterResult: { results }, candidateScores, topKPerRole: 2 });
  assert.equal(out.results.length, 2);
  // The 80 tie is resolved by the Rule 5 chain (product_id ASC): cpu-2 wins.
  assert.deepEqual(ids(out.results), ['cpu-1', 'cpu-2']);
});

// ---------------------------------------------------------------------------
// Output contract - Engine 3's existing candidate-pool input shape
// ---------------------------------------------------------------------------

test('output is the Engine 3 candidate-pool input shape: frozen { results } of intact verdicts', () => {
  const results = [verdict('CPU', 'cpu-1'), verdict('CPU', 'cpu-2')];
  const out = retainTopKPerRole({
    filterResult: { results },
    candidateScores: scores(scoreEntry('CPU', 'cpu-1', 90), scoreEntry('CPU', 'cpu-2', 50)),
    topKPerRole: 5,
  });
  assert.deepEqual(Object.keys(out), ['results']);
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.results));
  // Verdicts are handed over intact, by reference: no copies, no added fields.
  assert.strictEqual(out.results[0], results[0]);
  assert.strictEqual(out.results[1], results[1]);
  assert.deepEqual(out.results[0], {
    product_id: 'cpu-1',
    product_variant_id: null,
    category: 'CPU',
    component_role: 'CPU',
    status: 'PASS',
    reason: null,
    relationships: {},
    unknown_pairwise_count: 0,
  });
});

test('buckets are emitted in canonical COMPONENT_ROLES order regardless of input order', () => {
  const results = [
    verdict('CASE', 'case-1'),
    verdict('GPU', 'gpu-1', { variantId: 'v1' }),
    verdict('CPU', 'cpu-1'),
    verdict('PSU', 'psu-1'),
    verdict('MOTHERBOARD', 'mb-1'),
  ];
  const out = retainTopKPerRole({
    filterResult: { results },
    candidateScores: scores(
      scoreEntry('CPU', 'cpu-1', 50),
      scoreEntry('GPU', 'gpu-1', 50, 'v1'),
      scoreEntry('MOTHERBOARD', 'mb-1', 50),
      scoreEntry('PSU', 'psu-1', 50),
      scoreEntry('CASE', 'case-1', 50)
    ),
    topKPerRole: 5,
  });
  assert.deepEqual(ids(out.results), ['cpu-1', 'gpu-1#v1', 'mb-1', 'psu-1', 'case-1']);
});

// ---------------------------------------------------------------------------
// Real Engine 4 contract - computeCandidateScores output drops in as-is
// ---------------------------------------------------------------------------

test('Engine 4 contract: the real computeCandidateScores output needs no adaptation', () => {
  const NOW_MS = Date.parse('2026-09-19T00:00:00.000Z');
  const P1 = '11111111-1111-4111-8111-111111111111';
  const P2 = '22222222-2222-4222-8222-222222222222';
  const P3 = '33333333-3333-4333-8333-333333333333';
  const P6 = '66666666-6666-4666-8666-666666666666';
  const G1 = '44444444-4444-4444-8444-444444444444';
  const G2 = '55555555-5555-4555-8555-555555555555';

  const configuration = deepFreeze({
    version_note: 'test shape; mirrors the Decision 3(a) required key set',
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
    candidate_caps: { top_k_per_role: 2, max_builds_per_query: 25 },
    gpu_required_use_cases: ['GAMING', 'WORKSTATION'],
  });
  const assessments = deepFreeze({
    [P1]: [
      Object.freeze({ assessment_type: 'PERFORMANCE', score: 80, confidence: 'CONFIRMED', assessed_at: NOW_MS }),
    ],
    [G2]: [
      Object.freeze({ assessment_type: 'PERFORMANCE', score: 90, confidence: 'CONFIRMED', assessed_at: NOW_MS }),
    ],
  });
  const candidates = [
    createCandidate({ component_role: 'CPU', category: ROLE_CATEGORIES.CPU, product_id: P1, product_variant_id: null }),
    createCandidate({ component_role: 'CPU', category: ROLE_CATEGORIES.CPU, product_id: P2, product_variant_id: null }),
    createCandidate({ component_role: 'CPU', category: ROLE_CATEGORIES.CPU, product_id: P3, product_variant_id: null }),
    createCandidate({ component_role: 'GPU', category: ROLE_CATEGORIES.GPU, product_id: G1, product_variant_id: 'variant-g1' }),
    createCandidate({ component_role: 'GPU', category: ROLE_CATEGORIES.GPU, product_id: G2, product_variant_id: 'variant-g2' }),
  ];
  const candidateScores = computeCandidateScores({ candidates, assessments, configuration, nowMs: NOW_MS });

  // Real STEP 2 scores: P1 = 44/0.7 > P2 = 43/0.7 > P3 = 40 (no evidence);
  // G2 = 55/0.75 > G1 = 40 (no evidence).
  const filterResult = {
    results: [
      verdict('CPU', P3),
      verdict('GPU', G1, { variantId: 'variant-g1' }),
      verdict('CPU', P2),
      verdict('GPU', G2, { variantId: 'variant-g2' }),
      verdict('CPU', P1),
      // A hard-compatibility REJECT carries no score entry at all (Rule 2).
      verdict('CPU', P6, { status: CANDIDATE_STATUSES.REJECT }),
    ],
  };
  const out = retainTopKPerRole({
    filterResult,
    candidateScores,
    topKPerRole: configuration.candidate_caps.top_k_per_role,
  });
  // One K for every role: CPU keeps its top 2 (P3 falls off), GPU keeps both.
  assert.deepEqual(ids(out.results), [P1, P2, `${G2}#variant-g2`, `${G1}#variant-g1`]);
});

// ---------------------------------------------------------------------------
// Score index edge cases
// ---------------------------------------------------------------------------

test('score entries without an eligible verdict (pool-wide STEP 2 output) are ignored', () => {
  const out = retainTopKPerRole({
    filterResult: { results: [verdict('CPU', 'cpu-1')] },
    candidateScores: scores(scoreEntry('CPU', 'cpu-1', 50), scoreEntry('CPU', 'ghost', 99)),
    topKPerRole: 1,
  });
  assert.deepEqual(ids(out.results), ['cpu-1']);
});

test('a candidate_score of 0 is a legitimate score, not a missing one', () => {
  const out = retainTopKPerRole({
    filterResult: { results: [verdict('CPU', 'cpu-0')] },
    candidateScores: scores(scoreEntry('CPU', 'cpu-0', 0)),
    topKPerRole: 1,
  });
  assert.deepEqual(ids(out.results), ['cpu-0']);
});

// ---------------------------------------------------------------------------
// Empty results (Engine 3 allows an empty results array)
// ---------------------------------------------------------------------------

test('an empty filter result retains nothing (frozen empty results)', () => {
  const out = retainTopKPerRole({
    filterResult: { results: [] },
    candidateScores: scores(),
    topKPerRole: 3,
  });
  assert.deepEqual(out, { results: [] });
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.results));
});

test('an all-REJECT filter result retains nothing (frozen empty results)', () => {
  const out = retainTopKPerRole({
    filterResult: {
      results: [verdict('CPU', 'cpu-1', { status: CANDIDATE_STATUSES.REJECT })],
    },
    candidateScores: scores(),
    topKPerRole: 3,
  });
  assert.deepEqual(out, { results: [] });
  assert.ok(Object.isFrozen(out.results));
});

// ---------------------------------------------------------------------------
// Purity, determinism, deep freezing
// ---------------------------------------------------------------------------

test('purity: inputs are never mutated; identical inputs yield identical output', () => {
  const results = [
    verdict('CASE', 'case-1'),
    verdict('CPU', 'cpu-b'),
    verdict('GPU', 'gpu-1', { variantId: 'v1' }),
    verdict('CPU', 'cpu-a'),
  ];
  const candidateScores = scores(
    scoreEntry('CPU', 'cpu-a', 80),
    scoreEntry('CPU', 'cpu-b', 90),
    scoreEntry('GPU', 'gpu-1', 50, 'v1'),
    scoreEntry('CASE', 'case-1', 40)
  );
  const filterResult = { results };
  const before = {
    filterResult: structuredClone(filterResult),
    candidateScores: structuredClone(candidateScores),
  };
  const first = retainTopKPerRole({ filterResult, candidateScores, topKPerRole: 1 });
  const second = retainTopKPerRole({ filterResult, candidateScores, topKPerRole: 1 });
  assert.deepEqual(first, second);
  assert.deepEqual(structuredClone(filterResult), before.filterResult);
  assert.deepEqual(structuredClone(candidateScores), before.candidateScores);
  // Deterministic per-role capping too (K = 1 keeps the best of each bucket).
  assert.deepEqual(ids(first.results), ['cpu-b', 'gpu-1#v1', 'case-1']);
});

function assertFrozenDeep(value, path) {
  if (value !== null && typeof value === 'object') {
    assert.ok(Object.isFrozen(value), `not frozen: ${path}`);
    for (const key of Object.keys(value)) {
      assertFrozenDeep(value[key], `${path}.${key}`);
    }
  }
}

test('the output is deeply frozen even when handed unfrozen, hand-built verdicts', () => {
  const out = retainTopKPerRole({
    filterResult: {
      results: [
        {
          // Deliberately NOT frozen, unlike the real filterCandidates output.
          product_id: 'cpu-1',
          product_variant_id: null,
          category: 'CPU',
          component_role: 'CPU',
          status: 'PASS',
          reason: null,
          relationships: {},
          unknown_pairwise_count: 0,
        },
      ],
    },
    candidateScores: {
      scores: [{ product_id: 'cpu-1', product_variant_id: null, component_role: 'CPU', candidate_score: 50 }],
    },
    topKPerRole: 1,
  });
  assertFrozenDeep(out, 'out');
});

// ---------------------------------------------------------------------------
// Fail-fast gates (existing error vocabulary only)
// ---------------------------------------------------------------------------

test('fail-fast: the sources object itself', () => {
  assertError(
    rejectionOf(() => retainTopKPerRole()),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    null,
    'missing sources'
  );
  assertError(
    rejectionOf(() => retainTopKPerRole(null)),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    null,
    'null sources'
  );
  assertError(
    rejectionOf(() => retainTopKPerRole('nope')),
    ERROR_CODES.INVALID_INPUT,
    null,
    'string sources'
  );
  assertError(
    rejectionOf(() => retainTopKPerRole([])),
    ERROR_CODES.INVALID_INPUT,
    null,
    'array sources'
  );
});

test('fail-fast: malformed filterResult', () => {
  for (const bad of [undefined, null, 'results', [], { results: {} }, { results: null }]) {
    assertError(
      rejectionOf(() =>
        retainTopKPerRole({ filterResult: bad, candidateScores: scores(), topKPerRole: 1 })
      ),
      ERROR_CODES.INVALID_INPUT,
      'filterResult',
      `filterResult=${String(bad)}`
    );
  }
});

test('fail-fast: a non-verdict entry in results', () => {
  assertError(
    rejectionOf(() =>
      retainTopKPerRole({
        filterResult: { results: [null] },
        candidateScores: scores(),
        topKPerRole: 1,
      })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'filterResult',
    'null verdict entry'
  );
});

test('fail-fast: malformed candidateScores', () => {
  for (const bad of [undefined, null, 'scores', [], { scores: {} }, { scores: null }]) {
    assertError(
      rejectionOf(() =>
        retainTopKPerRole({ filterResult: { results: [] }, candidateScores: bad, topKPerRole: 1 })
      ),
      ERROR_CODES.INVALID_INPUT,
      'candidateScores',
      `candidateScores=${String(bad)}`
    );
  }
});

test('fail-fast: a malformed score entry', () => {
  assertError(
    rejectionOf(() =>
      retainTopKPerRole({
        filterResult: { results: [verdict('CPU', 'cpu-1')] },
        candidateScores: { scores: [{ product_id: 'cpu-1', component_role: 'CPU' }] },
        topKPerRole: 1,
      })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'candidateScores',
    'score entry without a finite candidate_score'
  );
  assertError(
    rejectionOf(() =>
      retainTopKPerRole({
        filterResult: { results: [verdict('CPU', 'cpu-1')] },
        candidateScores: { scores: [scoreEntry('CPU', 'cpu-1', NaN)] },
        topKPerRole: 1,
      })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'candidateScores',
    'NaN candidate_score'
  );
});

test('fail-fast: duplicate score identity', () => {
  assertError(
    rejectionOf(() =>
      retainTopKPerRole({
        filterResult: { results: [verdict('CPU', 'cpu-1')] },
        candidateScores: scores(scoreEntry('CPU', 'cpu-1', 50), scoreEntry('CPU', 'cpu-1', 60)),
        topKPerRole: 1,
      })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'candidateScores',
    'duplicate identity'
  );
});

test('fail-fast: an eligible verdict without a score cannot be ranked', () => {
  assertError(
    rejectionOf(() =>
      retainTopKPerRole({
        filterResult: { results: [verdict('CPU', 'cpu-1'), verdict('CPU', 'cpu-2')] },
        candidateScores: scores(scoreEntry('CPU', 'cpu-1', 50)),
        topKPerRole: 1,
      })
    ),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'candidateScores',
    'eligible verdict without a score'
  );
});

test('fail-fast: topKPerRole must be a positive integer (Decision 11 Rule 8)', () => {
  for (const bad of [0, -1, 1.5, '3', NaN, Infinity, null, undefined]) {
    assertError(
      rejectionOf(() =>
        retainTopKPerRole({
          filterResult: { results: [verdict('CPU', 'cpu-1')] },
          candidateScores: scores(scoreEntry('CPU', 'cpu-1', 50)),
          topKPerRole: bad,
        })
      ),
      ERROR_CODES.INVALID_FIELD_VALUE,
      'topKPerRole',
      `topKPerRole=${String(bad)}`
    );
  }
});