'use strict';

// scripts/lib/scenario-eval.test.js - pure evaluator tests (no database).
//
// These pin the projector and each assertion's PASS/FAIL/UNKNOWN decision with
// synthetic artifacts, so the golden suite's logic is verifiable without a Neon
// branch. Run under `npm run test:scripts` (scripts/lib/*.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STATUSES,
  pairKeyOf,
  projectArtifact,
  evaluateSuite,
} = require('./scenario-eval');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function component(role, productId, variantId, price) {
  return {
    component_role: role,
    product_id: productId,
    product_variant_id: variantId,
    price: { selected_price: price },
  };
}

const BUILD = {
  components: [
    component('CPU', 'cpu-1', null, 400),
    component('GPU', 'gpu-1', 'var-1', 300),
    component('RAM', 'ram-1', null, 100),
  ],
  total_price: 1000,
  currency: 'MAD',
};

const ENTRY = {
  signature: 'CPU:cpu-1:|GPU:gpu-1:var-1|RAM:ram-1:',
  build_score: 60,
  total_price: 1000,
  compatibility_status: 'PASS',
  build: BUILD,
};

const MAPS = {
  vramByVariant: new Map([['var-1', 12]]),
  igpuByCpu: new Map([['cpu-1', true]]),
};

function art(overrides) {
  return Object.assign({
    scenario_id: 'S',
    build_count: 25,
    ranked_count: 25,
    ranked_signatures: ['a', 'b', 'c'],
    scores_by_signature: { a: 60, b: 59, c: 58 },
    best: { signature: 'a', build_score: 60, total_price: 1000, gpu_price: 300, has_gpu: true, cpu_integrated_gpu_present: false },
    selected: [
      { signature: 'a', total_price: 1000, has_gpu: true, compatibility_status: 'PASS', gpu_vram_gb: 12, pair_key: 'c|v' },
    ],
    selected_pair_count: 1,
    selected_has_reject: false,
    best_gpu_price_share: 0.4,
    best_cpu_ram_share: 0.2,
    budget_floor: { cheapest_total: 4477, within_budget: true },
    budget_amount: 12000,
    currency: 'MAD',
  }, overrides || {});
}

function run(assertion, thresholds, scenarios, artifacts, extra) {
  return evaluateSuite(Object.assign({
    suite: { scenarios, thresholds, assertions: [assertion] },
    artifacts,
    artifactsSecond: new Map(),
    pi1: null,
  }, extra || {})).results;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

test('pairKeyOf mirrors the Decision 20 pair (variant, empty string, OMITTED)', () => {
  assert.equal(pairKeyOf(BUILD), 'cpu-1|var-1');
  assert.equal(pairKeyOf({
    components: [
      component('CPU', 'cpu-1', null, 1),
      component('GPU', 'gpu-1', null, 1),
    ],
  }), 'cpu-1|');
  assert.equal(pairKeyOf({ components: [component('CPU', 'cpu-1', null, 1)] }), 'cpu-1|OMITTED');
});

test('projectArtifact derives shares, pair count, vram and iGPU from the run', () => {
  const artifact = projectArtifact(
    'S03',
    { builds: [BUILD], budget_floor: { cheapest_total: 4477, within_budget: true }, budget_amount: 12000, currency: 'MAD' },
    { ranked: [ENTRY] },
    { selected: [ENTRY] },
    MAPS
  );
  assert.equal(artifact.selected_pair_count, 1);
  assert.equal(artifact.best_gpu_price_share, 0.3);
  assert.equal(artifact.best_cpu_ram_share, 0.5);
  assert.equal(artifact.best.gpu_vram_gb, 12);
  assert.equal(artifact.best.cpu_integrated_gpu_present, true);
  assert.equal(artifact.selected_has_reject, false);
});

test('projectArtifact records the RAW build_score, not the rounded ranked-entry score', () => {
  const rawBuild = Object.assign({}, BUILD, { build_score: 60.00499 });
  const entry = Object.assign({}, ENTRY, { build_score: 60.0, build: rawBuild });
  const artifact = projectArtifact(
    'S',
    { builds: [rawBuild], budget_floor: {}, budget_amount: 12000, currency: 'MAD' },
    { ranked: [entry] },
    { selected: [entry] },
    MAPS
  );
  assert.equal(artifact.scores_by_signature[ENTRY.signature], 60.00499);
});

// ---------------------------------------------------------------------------
// A1
// ---------------------------------------------------------------------------

test('A1: 2 distinct selected pairs is FAIL, 3 is PASS', () => {
  const thresholds = { A1_min_distinct_pairs: { value: 3 } };
  const assertion = { type: 'min_distinct_cpu_gpu_pairs', scenarios: ['S03'] };
  const scenarios = [{ id: 'S03' }];

  const two = run(assertion, thresholds, scenarios, new Map([['S03', art({ selected_pair_count: 2 })]]));
  assert.equal(two[0].status, STATUSES.FAIL);

  const three = run(assertion, thresholds, scenarios, new Map([['S03', art({ selected_pair_count: 3 })]]));
  assert.equal(three[0].status, STATUSES.PASS);
});

test('A1: no selected builds is UNKNOWN, never PASS', () => {
  const results = run(
    { type: 'min_distinct_cpu_gpu_pairs', scenarios: ['S01'] },
    { A1_min_distinct_pairs: { value: 3 } },
    [{ id: 'S01' }],
    new Map([['S01', art({ selected: [], selected_pair_count: 0 })]])
  );
  assert.equal(results[0].status, STATUSES.UNKNOWN);
});

// ---------------------------------------------------------------------------
// A3
// ---------------------------------------------------------------------------

test('A3: identical use-case artifacts overlap 100% and FAIL', () => {
  const results = run(
    { type: 'use_case_divergence', pairs: [{ gaming: 'S03', workstation: 'S14' }] },
    {
      A3_signature_overlap_max: { value: 0.5 },
      A3_gaming_gpu_share: { min: 0.3, max: 0.5 },
    },
    [{ id: 'S03' }, { id: 'S14' }],
    new Map([['S03', art()], ['S14', art()]])
  );
  assert.equal(results[0].status, STATUSES.FAIL);
  assert.equal(results[0].measured.signature_overlap, 1);
});

test('A3: divergent sets, in-band GPU share and a CPU+RAM shift PASS', () => {
  const results = run(
    { type: 'use_case_divergence', pairs: [{ gaming: 'S03', workstation: 'S14' }] },
    {
      A3_signature_overlap_max: { value: 0.5 },
      A3_gaming_gpu_share: { min: 0.3, max: 0.5 },
    },
    [{ id: 'S03' }, { id: 'S14' }],
    new Map([
      ['S03', art({ ranked_signatures: ['a', 'b'], best_gpu_price_share: 0.4, best_cpu_ram_share: 0.2 })],
      ['S14', art({ ranked_signatures: ['x', 'y'], best_gpu_price_share: 0.1, best_cpu_ram_share: 0.5 })],
    ])
  );
  assert.equal(results[0].status, STATUSES.PASS);
});

// ---------------------------------------------------------------------------
// A4
// ---------------------------------------------------------------------------

test('A4: equal GPU prices across resolutions FAIL; strictly increasing PASS', () => {
  const thresholds = {
    A4_vram_floor_gb: { value: { '1080p': 8, '1440p': 12, '2160p': 16 } },
  };
  const assertion = { type: 'resolution_divergence', series: [['S05', 'S08', 'S09']], strict_pair: ['S05', 'S09'], vram_scenarios: [] };
  const scenarios = [
    { id: 'S05', resolution: '1080p' },
    { id: 'S08', resolution: '1440p' },
    { id: 'S09', resolution: '2160p' },
  ];

  // Non-decreasing allows equality (2160p >= 1440p >= 1080p), so a flat series PASSes
  // the ordering check while the STRICT pair still FAILs.
  const flat = run(assertion, thresholds, scenarios, new Map([
    ['S05', art({ best: { gpu_price: 9000, total_price: 20000, signature: 'a', cpu_integrated_gpu_present: false, has_gpu: true } })],
    ['S08', art({ best: { gpu_price: 9000, total_price: 20000, signature: 'b', cpu_integrated_gpu_present: false, has_gpu: true } })],
    ['S09', art({ best: { gpu_price: 9000, total_price: 20000, signature: 'c', cpu_integrated_gpu_present: false, has_gpu: true } })],
  ]));
  assert.equal(flat[0].status, STATUSES.PASS);
  assert.equal(flat[1].status, STATUSES.FAIL);

  // A DECREASING series violates the ordering check itself.
  const decreasing = run(assertion, thresholds, scenarios, new Map([
    ['S05', art({ best: { gpu_price: 15000, total_price: 20000, signature: 'a', cpu_integrated_gpu_present: false, has_gpu: true } })],
    ['S08', art({ best: { gpu_price: 11000, total_price: 20000, signature: 'b', cpu_integrated_gpu_present: false, has_gpu: true } })],
    ['S09', art({ best: { gpu_price: 9000, total_price: 20000, signature: 'c', cpu_integrated_gpu_present: false, has_gpu: true } })],
  ]));
  assert.equal(decreasing[0].status, STATUSES.FAIL);

  const rising = run(assertion, thresholds, scenarios, new Map([
    ['S05', art({ best: { gpu_price: 9000, total_price: 20000, signature: 'a', cpu_integrated_gpu_present: false, has_gpu: true } })],
    ['S08', art({ best: { gpu_price: 11000, total_price: 20000, signature: 'b', cpu_integrated_gpu_present: false, has_gpu: true } })],
    ['S09', art({ best: { gpu_price: 15000, total_price: 20000, signature: 'c', cpu_integrated_gpu_present: false, has_gpu: true } })],
  ]));
  assert.equal(rising[0].status, STATUSES.PASS);
  assert.equal(rising[1].status, STATUSES.PASS);
});

test('A4: a selected GPU below the resolution floor FAILs; a NULL vram is UNKNOWN', () => {
  const thresholds = { A4_vram_floor_gb: { value: { '2160p': 16 } } };
  const assertion = { type: 'resolution_divergence', series: [], vram_scenarios: ['S09'] };
  const scenarios = [{ id: 'S09', resolution: '2160p' }];

  const below = run(assertion, thresholds, scenarios, new Map([
    ['S09', art({ selected: [{ signature: 'a', has_gpu: true, gpu_vram_gb: 12, compatibility_status: 'PASS', total_price: 1, pair_key: 'p' }] })],
  ]));
  assert.equal(below[0].status, STATUSES.FAIL);

  const unknown = run(assertion, thresholds, scenarios, new Map([
    ['S09', art({ selected: [{ signature: 'a', has_gpu: true, gpu_vram_gb: null, compatibility_status: 'PASS', total_price: 1, pair_key: 'p' }] })],
  ]));
  assert.equal(unknown[0].status, STATUSES.UNKNOWN);
});

// ---------------------------------------------------------------------------
// A5 / A6 / A7
// ---------------------------------------------------------------------------

test('A5: equal priority prices FAIL; cheaper-and-different PASS', () => {
  const assertion = { type: 'priority_divergence', pairs: [{ price_first: 'S10', performance_first: 'S11' }] };
  const scenarios = [{ id: 'S10' }, { id: 'S11' }];

  const equal = run(assertion, {}, scenarios, new Map([
    ['S10', art({ best: { signature: 'same', total_price: 1000, gpu_price: 1, cpu_integrated_gpu_present: false, has_gpu: true } })],
    ['S11', art({ best: { signature: 'same', total_price: 1000, gpu_price: 1, cpu_integrated_gpu_present: false, has_gpu: true } })],
  ]));
  assert.equal(equal[0].status, STATUSES.FAIL);

  const divergent = run(assertion, {}, scenarios, new Map([
    ['S10', art({ best: { signature: 'cheap', total_price: 900, gpu_price: 1, cpu_integrated_gpu_present: false, has_gpu: true } })],
    ['S11', art({ best: { signature: 'pricey', total_price: 1500, gpu_price: 1, cpu_integrated_gpu_present: false, has_gpu: true } })],
  ]));
  assert.equal(divergent[0].status, STATUSES.PASS);
});

test('A6: a discrete GPU in the OFFICE build FAILs; a bare iGPU build PASSes', () => {
  const thresholds = { A6_office_price_ratio_max: { value: 0.4 } };
  const assertion = { type: 'office_igpu', scenarios: ['S19'], reference: 'S03' };
  const scenarios = [{ id: 'S19' }, { id: 'S03' }];
  const reference = art({ scenario_id: 'S03', best: { signature: 'r', total_price: 10000, gpu_price: 1, cpu_integrated_gpu_present: false, has_gpu: true } });

  const withGpu = run(assertion, thresholds, scenarios, new Map([
    ['S03', reference],
    ['S19', art({ selected: [{ signature: 'a', has_gpu: true, gpu_vram_gb: 8, compatibility_status: 'PASS', total_price: 3000, pair_key: 'p' }], best: { signature: 'a', total_price: 3000, gpu_price: 900, cpu_integrated_gpu_present: true, has_gpu: true } })],
  ]));
  assert.equal(withGpu[0].status, STATUSES.FAIL);

  const bare = run(assertion, thresholds, scenarios, new Map([
    ['S03', reference],
    ['S19', art({ selected: [{ signature: 'a', has_gpu: false, gpu_vram_gb: null, compatibility_status: 'PASS', total_price: 3000, pair_key: 'p' }], best: { signature: 'a', total_price: 3000, gpu_price: null, cpu_integrated_gpu_present: true, has_gpu: false } })],
  ]));
  assert.equal(bare[0].status, STATUSES.PASS);
});

test('A7: build_count and within_budget must both match', () => {
  const assertion = {
    type: 'below_floor',
    cases: [
      { scenario: 'S01', within_budget: true },
      { scenario: 'S01b', within_budget: false },
    ],
  };
  const scenarios = [{ id: 'S01' }, { id: 'S01b' }];

  const ok = run(assertion, {}, scenarios, new Map([
    ['S01', art({ build_count: 0, budget_floor: { cheapest_total: 4477, within_budget: true } })],
    ['S01b', art({ build_count: 0, budget_floor: { cheapest_total: 4477, within_budget: false } })],
  ]));
  assert.equal(ok[0].status, STATUSES.PASS);
  assert.equal(ok[1].status, STATUSES.PASS);

  const wrong = run(assertion, {}, scenarios, new Map([
    ['S01', art({ build_count: 0, budget_floor: { cheapest_total: 4477, within_budget: false } })],
    ['S01b', art({ build_count: 3, budget_floor: { cheapest_total: 4477, within_budget: false } })],
  ]));
  assert.equal(wrong[0].status, STATUSES.FAIL);
  assert.equal(wrong[1].status, STATUSES.FAIL);
});

// ---------------------------------------------------------------------------
// A8 / A9
// ---------------------------------------------------------------------------

test('A8: signature lists must match order-sensitively and scores within 1e-3', () => {
  const assertion = { type: 'determinism', scenarios: ['S03'] };
  const scenarios = [{ id: 'S03' }];
  const thresholds = { A8_score_tolerance: { value: 1e-3 } };

  const within = run(assertion, thresholds, scenarios,
    new Map([['S03', art({ scores_by_signature: { a: 60.0, b: 59.0, c: 58.0 } })]]),
    { artifactsSecond: new Map([['S03', art({ scores_by_signature: { a: 60.0005, b: 59.0, c: 58.0 } })]]) });
  assert.equal(within[0].status, STATUSES.PASS);

  const drifted = run(assertion, thresholds, scenarios,
    new Map([['S03', art({ scores_by_signature: { a: 60.0, b: 59.0, c: 58.0 } })]]),
    { artifactsSecond: new Map([['S03', art({ scores_by_signature: { a: 60.002, b: 59.0, c: 58.0 } })]]) });
  assert.equal(drifted[0].status, STATUSES.FAIL);

  const reordered = run(assertion, thresholds, scenarios,
    new Map([['S03', art({ ranked_signatures: ['a', 'b', 'c'] })]]),
    { artifactsSecond: new Map([['S03', art({ ranked_signatures: ['a', 'c', 'b'] })]]) });
  assert.equal(reordered[0].status, STATUSES.FAIL);
});

test('A8 tolerates the 2dp presentation step: raw deltas stay PASS when rounded values differ by a full 0.01', () => {
  // 60.00499 rounds to 60.00; 60.00501 rounds to 60.01. Comparing the ROUNDED
  // ranked-entry scores made A8 flaky under a ~1e-5 clock drift; the RAW Engine 4
  // scores differ by 2e-5 and must PASS.
  const buildA = Object.assign({}, BUILD, { build_score: 60.00499 });
  const buildB = Object.assign({}, BUILD, { build_score: 60.00501 });
  const entryA = Object.assign({}, ENTRY, { build_score: 60.0, build: buildA });
  const entryB = Object.assign({}, ENTRY, { build_score: 60.01, build: buildB });
  const snapshot = (build) => ({ builds: [build], budget_floor: {}, budget_amount: 12000, currency: 'MAD' });
  const first = projectArtifact('S', snapshot(buildA), { ranked: [entryA] }, { selected: [entryA] }, MAPS);
  const second = projectArtifact('S', snapshot(buildB), { ranked: [entryB] }, { selected: [entryB] }, MAPS);
  assert.equal(first.ranked_signatures[0], second.ranked_signatures[0]);

  const results = evaluateSuite({
    suite: {
      scenarios: [{ id: 'S' }],
      thresholds: { A8_score_tolerance: { value: 1e-3 } },
      assertions: [{ type: 'determinism', scenarios: ['S'] }],
    },
    artifacts: new Map([['S', first]]),
    artifactsSecond: new Map([['S', second]]),
    pi1: null,
  }).results;
  assert.equal(results[0].status, STATUSES.PASS);
  assert.ok(Math.abs(results[0].measured.max_score_delta) < 1e-3);
});

test('A9: a REJECT in the selected set FAILs; PI-1 is recorded separately', () => {
  const assertion = { type: 'safety', scenarios: ['S03'] };
  const scenarios = [{ id: 'S03' }];

  const rejected = run(assertion, {}, scenarios, new Map([['S03', art({ selected_has_reject: true })]]));
  assert.equal(rejected[0].status, STATUSES.FAIL);

  const noPi1 = run(assertion, {}, scenarios, new Map([['S03', art()]]));
  assert.equal(noPi1[0].status, STATUSES.PASS);
  assert.equal(noPi1[1].status, STATUSES.UNKNOWN);

  const withPi1 = run(assertion, {}, scenarios, new Map([['S03', art()]]), { pi1: { status: 'PASS', code: 0 } });
  assert.equal(withPi1[1].status, STATUSES.PASS);
});
