'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectArchetypes,
  PERFORMANCE_FLOOR,
  STRATEGIES,
  REASON_CODES,
} = require('./select-archetypes');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** A ranked entry shaped like rankBuilds output (fresh object each call). */
function rankedEntry(index, overrides) {
  const o = overrides || {};
  return {
    build_score: o.build_score !== undefined ? o.build_score : 50,
    total_price: o.total_price !== undefined ? o.total_price : 100,
    compatibility_status: o.compatibility_status !== undefined ? o.compatibility_status : 'PASS',
    signature: o.signature !== undefined ? o.signature : `sig-${index}`,
    explanation: null,
    build: {
      components: [
        {
          component_role: 'CPU',
          product_id: o.cpu !== undefined ? o.cpu : 'cpu-a',
          product_variant_id: null,
        },
        {
          component_role: 'GPU',
          product_id: o.gpu !== undefined ? o.gpu : `gpu-${index}`,
          product_variant_id: o.gpuVariant !== undefined ? o.gpuVariant : null,
        },
      ],
    },
  };
}

const BUDGET = { amount: 10000, currency: 'MAD' };

test('E4: PERFORMANCE picks the highest-scoring build at >= 85% budget, BALANCED picks the top-ranked overall, VALUE picks score-per-MAD', () => {
  const ranked = [
    // coming from rankBuilds, the ranked array is ALREADY sorted: build_score
    // DESC, then price ASC. 90/5000 (the rank-0) is also the best VALUE ratio
    // (0.018) but BALANCED claims it first by output order (priority 3),
    // leaving VALUE the best remaining (80/9500 > 70/9000).
    rankedEntry(0, { build_score: 90, total_price: 5000, cpu: 'cpu-b', gpu: 'gpu-b' }),
    rankedEntry(1, { build_score: 80, total_price: 9500, cpu: 'cpu-a', gpu: 'gpu-a' }),
    rankedEntry(2, { build_score: 70, total_price: 9000, cpu: 'cpu-c', gpu: 'gpu-c' }),
  ];
  const result = selectArchetypes({ ranked, budget: BUDGET, priority: 3 });
  assert.equal(result.archetypes.length, 3);
  // priority 3: BALANCED claims the rank-1 build first (90, the top of the
  // ranked array, already in its real sort order).
  assert.equal(result.archetypes[0].strategy_key, 'BALANCED');
  assert.equal(result.archetypes[0].build_score, 90);
  // With priority 3 the module's fixed strategyOrder is
  // [BALANCED, PERFORMANCE, VALUE]: PERFORMANCE takes the best remaining
  // floor-qualified build (80 @ 9500 >= 8500 floor; 90's pair was claimed by
  // BALANCED), and VALUE then takes the best remaining score-per-MAD between
  // 70/9000 and nothing else unclaimed-eligible.
  assert.equal(result.archetypes[1].strategy_key, 'PERFORMANCE');
  assert.equal(result.archetypes[1].build_score, 80);
  assert.equal(result.archetypes[2].strategy_key, 'VALUE');
  assert.equal(result.archetypes[2].build_score, 70);
});

test('E4: PERFORMANCE prefers a build that reaches the 85% floor even when a higher-scoring one does not', () => {
  const ranked = [
    rankedEntry(0, { build_score: 95, total_price: 6000, cpu: 'cpu-a', gpu: 'gpu-a' }),
    rankedEntry(1, { build_score: 80, total_price: 9200, cpu: 'cpu-b', gpu: 'gpu-b' }),
  ];
  const result = selectArchetypes({ ranked, budget: BUDGET, priority: 5 });
  // priority 5: performance first. Entry 0 is 60% (below floor), so entry 1 wins.
  assert.equal(result.archetypes[0].strategy_key, 'PERFORMANCE');
  assert.equal(result.archetypes[0].build_score, 80);
});

test('E4: a build exactly at the floor (0.85) qualifies for PERFORMANCE', () => {
  const ranked = [rankedEntry(0, { build_score: 70, total_price: 8500 })];
  const result = selectArchetypes({ ranked, budget: BUDGET, priority: 4 });
  assert.equal(result.archetypes[0].strategy_key, 'PERFORMANCE');
});

test('E4: priority 1-2 orders VALUE first, 3 balanced, 4-5 performance first', () => {
  // Two entries, two distinct pairs, both qualifying for PERFORMANCE (9200
  // and 9500 are both >= 8500): every order yields exactly THREE claimed
  // strategies only when three DISTINCT pairs exist - with two pairs the
  // third strategy degrades, and the reason goes in output order.
  const ranked = [
    rankedEntry(0, { build_score: 80, total_price: 9500, cpu: 'cpu-a', gpu: 'gpu-a' }),
    rankedEntry(1, { build_score: 90, total_price: 9200, cpu: 'cpu-b', gpu: 'gpu-b' }),
  ];
  // priority 5: performance first (90 wins, 9200/10000 = 0.92), then balanced (80).
  const p5 = selectArchetypes({ ranked, budget: BUDGET, priority: 5 }).archetypes.map((a) => a.strategy_key);
  assert.deepEqual(p5, ['PERFORMANCE', 'BALANCED']);
  // p2: value first - VALUE prefers cheAper at equal ratio: 80/9500 < 90/9200, so entry 0 (80) wins VALUE.
  const p2 = selectArchetypes({ ranked, budget: BUDGET, priority: 2 }).archetypes.map((a) => a.strategy_key);
  assert.deepEqual(p2, ['VALUE', 'PERFORMANCE']);
  const p3 = selectArchetypes({ ranked, budget: BUDGET, priority: 3 }).archetypes.map((a) => a.strategy_key);
  assert.deepEqual(p3, ['BALANCED', 'PERFORMANCE']);
  assert.equal(selectArchetypes({ ranked, budget: BUDGET, priority: 3 }).reason_codes.length, 1);
});

test('E4: three same-pair builds yield ONE archetype; reason_codes records the honest shortfall', () => {
  const ranked = [
    rankedEntry(0, { build_score: 80, total_price: 9900, cpu: 'cpu-a', gpu: 'gpu-x' }),
    rankedEntry(1, { build_score: 70, total_price: 9500, cpu: 'cpu-a', gpu: 'gpu-x' }),
    rankedEntry(2, { build_score: 60, total_price: 9000, cpu: 'cpu-a', gpu: 'gpu-x' }),
  ];
  const result = selectArchetypes({ ranked, budget: BUDGET, priority: 3 });
  // all three same pair: first strategy (BALANCED) claims the pair.
  assert.equal(result.archetypes.length, 1);
  assert.equal(result.archetypes[0].strategy_key, 'BALANCED');
  const codes = [...result.reason_codes].sort(); // frozen in production; unsorted copy here
  assert.deepEqual(codes, ['NO_PERFORMANCE_CANDIDATE', 'NO_VALUE_CANDIDATE']);
});

test('E4: empty ranked produces empty archetypes with EMPTY_RANKED', () => {
  const result = selectArchetypes({ ranked: [], budget: BUDGET, priority: 3 });
  assert.equal(result.archetypes.length, 0);
  assert.deepEqual(result.reason_codes, [REASON_CODES.EMPTY_RANKED]);
});

test('E4: the result is deeply frozen the ranked input is not mutated', () => {
  const ranked = [rankedEntry(0, { build_score: 70, total_price: 9000 })];
  const before = JSON.stringify(ranked);
  const result = selectArchetypes({ ranked, budget: BUDGET, priority: 3 });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.archetypes), true);
  assert.equal(Object.isFrozen(result.archetypes[0]), true);
  assert.equal(JSON.stringify(ranked), before);
});

test('E4: validation errors for bad budget and priority, missing budget fields', () => {
  assert.throws(() => selectArchetypes({ ranked: [], budget: { amount: 0, currency: 'MAD' } }),
    (e) => e instanceof CandidateSelectionError && e.code === ERROR_CODES.INVALID_FIELD_VALUE);
  assert.throws(() => selectArchetypes({ ranked: [], budget: { amount: -5, currency: 'MAD' } }),
    (e) => e instanceof CandidateSelectionError && e.code === ERROR_CODES.INVALID_FIELD_VALUE);
  assert.throws(() => selectArchetypes({ ranked: [] }),
    (e) => e instanceof CandidateSelectionError && e.code === ERROR_CODES.MISSING_REQUIRED_FIELD);
  assert.throws(() => selectArchetypes({ ranked: [], budget: BUDGET, priority: 6 }),
    (e) => e instanceof CandidateSelectionError && e.code === ERROR_CODES.INVALID_FIELD_VALUE);
  assert.throws(() => selectArchetypes({ ranked: 'no', budget: BUDGET }),
    (e) => e instanceof CandidateSelectionError && e.code === ERROR_CODES.INVALID_INPUT);
});

test('E4: default priority (null) maps to the 3 order (balanced first)', () => {
  const ranked = [rankedEntry(0, { build_score: 70, total_price: 9000 })];
  const result = selectArchetypes({ ranked, budget: BUDGET });
  assert.equal(result.archetypes[0].strategy_key, 'BALANCED');
});

test('E4: identical strategy ranking yields a stale-order-free deterministic output', () => {
  const ranked = [
    rankedEntry(0, { build_score: 80, total_price: 9300, cpu: 'cpu-a', gpu: 'gpu-a' }),
    rankedEntry(1, { build_score: 80, total_price: 9300, cpu: 'cpu-b', gpu: 'gpu-b' }),
    rankedEntry(2, { build_score: 80, total_price: 9300, cpu: 'cpu-c', gpu: 'gpu-c' }),
  ];
  const first = selectArchetypes({ ranked, budget: BUDGET, priority: 3 });
  const second = selectArchetypes({ ranked, budget: BUDGET, priority: 3 });
  assert.deepEqual(first, second);
  // three different pairs, all viable: BALANCED keeps the RANKED order (tie
  // keeps the first), then PERFORMANCE/VALUE claim pair-distinct entries in
  // ranked order too, so the signatures come out in ascending pair order.
  assert.equal(first.archetypes.length, 3);
  assert.deepEqual(first.archetypes.map((a) => a.signature), ['sig-0', 'sig-1', 'sig-2']);
});

test('E4: GPU-omitted entries are distinct from any GPU-present pair (iGPU path)', () => {
  // Build the omission case explicitly: no GPU component at all.
  const iGPU = rankedEntry(0, { build_score: 95, total_price: 5000 });
  iGPU.build.components = iGPU.build.components.filter((c) => c.component_role !== 'GPU');
  const ranked = [
    iGPU,
    rankedEntry(1, { build_score: 90, total_price: 9500, cpu: 'cpu-a', gpu: 'gpu-a' }),
  ];
  const result = selectArchetypes({ ranked, budget: BUDGET, priority: 3 });
  assert.equal(result.archetypes.length, 2);
  // BALANCED claims the iGPU pair ('cpu-a|OMITTED'), VALUE claims the discrete pair.
  assert.equal(result.archetypes[0].strategy_key, 'BALANCED');
  assert.equal(result.archetypes[0].build_score, 95);
  assert.equal(result.archetypes[1].strategy_key, 'PERFORMANCE');
  assert.equal(result.archetypes[1].build_score, 90);
  assert.equal(result.reason_codes.length, 1); // VALUE degraded (only two pairs exist)
});

test('E4: constant surfaces - PERFORMANCE_FLOOR is exactly 0.85 and STRATEGIES frozen', () => {
  assert.equal(PERFORMANCE_FLOOR, 0.85);
  assert.ok(Object.isFrozen(STRATEGIES));
  assert.ok(Object.isFrozen(REASON_CODES));
});
