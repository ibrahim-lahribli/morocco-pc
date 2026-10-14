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
  EXPECTATION_STATUSES,
  DISPOSITIONS,
  epicIndex,
  validateExpectation,
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

function runSuite(assertion, thresholds, scenarios, artifacts, extra) {
  const config = Object.assign({ artifactsSecond: new Map(), pi1: null }, extra || {});
  // Fixtures declare hypothesis explicitly; production threshold entries may
  // not rely on the assertion-only missing-status default.
  const declaredThresholds = Object.fromEntries(Object.entries(thresholds).map(([key, entry]) =>
    [key, Object.assign({ status: 'hypothesis' }, entry)]));
  return evaluateSuite({
    suite: Object.assign({ scenarios, thresholds: declaredThresholds, assertions: [assertion] }, config.suite || {}),
    artifacts,
    artifactsSecond: config.artifactsSecond,
    pi1: config.pi1,
  });
}

function run(assertion, thresholds, scenarios, artifacts, extra) {
  return runSuite(assertion, thresholds, scenarios, artifacts, extra).results;
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
    { archetypes: [ENTRY], reason_codes: [] },
    MAPS
  );
  assert.equal(artifact.selected_pair_count, 1);
  assert.equal(artifact.best_gpu_price_share, 0.3);
  assert.equal(artifact.best_cpu_ram_share, 0.5);
  assert.equal(artifact.best.gpu_vram_gb, 12);
  assert.equal(artifact.best.cpu_integrated_gpu_present, true);
  assert.equal(artifact.selected_has_reject, false);

  // The legacy selectDiverseTop shape ({ selected }) must stay consumable:
  // the fallback reads selection.selected (it once read a non-existent
  // `project` key and silently projected an EMPTY selection).
  const legacy = projectArtifact(
    'S03',
    { builds: [BUILD], budget_amount: 12000 },
    { ranked: [ENTRY] },
    { selected: [ENTRY] },
    MAPS
  );
  assert.equal(legacy.selected.length, 1);
  assert.equal(legacy.selected_pair_count, 1);
});

test('projectArtifact carries rank-1 component names and exact selected prices, with explicit absence', () => {
  const build = { ...BUILD, components: [...BUILD.components, component('CPU_COOLER', 'cooler-1', null, 200)] };
  const entry = { ...ENTRY, build };
  const maps = { ...MAPS, productNames: new Map([['cpu-1', 'CPU name'], ['gpu-1', 'GPU name'], ['cooler-1', 'Cooler name']]) };
  const project = (b, m = maps) => projectArtifact('S', { builds: [b], budget_amount: 12000 },
    { ranked: [{ ...entry, build: b }] }, { selected: [] }, m).best;
  const best = project(build);
  assert.equal(best.cpu_name, 'CPU name');
  assert.equal(best.gpu_name, 'GPU name');
  assert.equal(best.cooler_name, 'Cooler name');
  assert.equal(best.cpu_price, 400);
  assert.equal(best.gpu_price, 300);
  assert.equal(best.cooler_price, 200);
  const noGpu = project({ ...build, components: build.components.filter(c => c.component_role !== 'GPU') });
  assert.equal(noGpu.gpu_name, null);
  assert.equal(noGpu.gpu_price, null);
  assert.equal(project(build, MAPS).cpu_name, null);
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

test('A7 (corrected): within_budget must equal (budget >= cheapest_total), read at run time', () => {
  const assertion = { id: 'A7', type: 'below_floor', cases: [{ scenario: 'S01' }, { scenario: 'S01b' }] };
  const scenarios = [{ id: 'S01' }, { id: 'S01b' }];

  // Above the floor (S01 @5000 >= 4477) within_budget is TRUE even with zero
  // builds - the emptiness is a compatibility limit, not a budget shortfall.
  // Below it (S01b @3805 < 4477) it is FALSE. The expectation is computed, not
  // supplied by the case.
  const both = run(assertion, {}, scenarios, new Map([
    ['S01', art({ build_count: 0, budget_amount: 5000, budget_floor: { cheapest_total: 4477, within_budget: true } })],
    ['S01b', art({ build_count: 0, budget_amount: 3805, budget_floor: { cheapest_total: 4477, within_budget: false } })],
  ]));
  assert.equal(both[0].status, STATUSES.PASS);
  assert.equal(both[1].status, STATUSES.PASS);
  assert.equal(both[0].measured.expected_within_budget, true);
  assert.equal(both[1].measured.expected_within_budget, false);

  // A stored within_budget contradicting budget vs cheapest_total FAILs, and so
  // does a below-floor scenario that somehow assembled builds.
  const mismatch = run(assertion, {}, scenarios, new Map([
    ['S01', art({ build_count: 0, budget_amount: 12000, budget_floor: { cheapest_total: 4477, within_budget: false } })],
    ['S01b', art({ build_count: 3, budget_amount: 3805, budget_floor: { cheapest_total: 4477, within_budget: false } })],
  ]));
  assert.equal(mismatch[0].status, STATUSES.FAIL);
  assert.equal(mismatch[1].status, STATUSES.FAIL);
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
      thresholds: { A8_score_tolerance: { value: 1e-3, status: 'hypothesis' } },
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

// ---------------------------------------------------------------------------
// Expectations (manifest design) + dispositions
// ---------------------------------------------------------------------------

test('validateExpectation: absent -> hypothesis; approved/waived require reviewer+reviewed_on, waived a reason', () => {
  assert.deepEqual(validateExpectation(undefined, 'x'), { status: EXPECTATION_STATUSES.HYPOTHESIS });
  assert.deepEqual(validateExpectation({ status: 'hypothesis' }, 'x'), { status: 'hypothesis' });
  assert.throws(() => validateExpectation({ status: 'approved' }, 'x'), /requires a non-empty "reviewer"/);
  assert.throws(() => validateExpectation({ status: 'approved', reviewer: 'R' }, 'x'), /requires "reviewed_on"/);
  assert.throws(() => validateExpectation({ status: 'waived', reviewer: 'R', reviewed_on: '2026-10-08' }, 'x'), /requires a non-empty "reason"/);
  assert.throws(() => validateExpectation({ status: 'bogus' }, 'x'), /unknown expectation status/);
  assert.deepEqual(
    validateExpectation({ status: 'approved', reviewer: 'R', reviewed_on: '2026-10-08' }, 'x'),
    { status: 'approved', reviewer: 'R', reviewed_on: '2026-10-08' }
  );
  assert.deepEqual(
    validateExpectation({ status: 'waived', reviewer: 'R', reviewed_on: '2026-10-08', reason: 'known' }, 'x'),
    { status: 'waived', reviewer: 'R', reviewed_on: '2026-10-08', reason: 'known' }
  );
});

test('epicIndex parses E<n> and rejects a typo', () => {
  assert.equal(epicIndex('E6'), 6);
  assert.throws(() => epicIndex('six'), /epic label/);
});

test('a hypothesis FAIL is EXPECTED-RED and does not fail the run; approved fails hard; waived is accepted', () => {
  const assertion = { id: 'A1', type: 'min_distinct_cpu_gpu_pairs', scenarios: ['S03'] };
  const thresholds = { A1_min_distinct_pairs: { value: 3 } };
  const scenarios = [{ id: 'S03' }];
  const failing = new Map([['S03', art({ selected_pair_count: 2 })]]);

  const hypo = runSuite(assertion, thresholds, scenarios, failing);
  assert.equal(hypo.results[0].status, STATUSES.FAIL);
  assert.equal(hypo.results[0].disposition, DISPOSITIONS.EXPECTED_RED);
  assert.equal(hypo.summary.hard_fail, 0);
  assert.equal(hypo.summary.exit_ok, true);

  const approved = runSuite(
    Object.assign({ status: 'approved', reviewer: 'R', reviewed_on: '2026-10-08' }, assertion),
    thresholds, scenarios, failing
  );
  assert.equal(approved.results[0].disposition, DISPOSITIONS.FAIL);
  assert.equal(approved.summary.hard_fail, 1);
  assert.equal(approved.summary.exit_ok, false);

  const waived = runSuite(
    Object.assign({ status: 'waived', reviewer: 'R', reviewed_on: '2026-10-08', reason: 'known' }, assertion),
    thresholds, scenarios, failing
  );
  assert.equal(waived.results[0].disposition, DISPOSITIONS.WAIVED);
  assert.equal(waived.summary.exit_ok, true);
});

test('evaluateSuite REFUSES an approved assertion missing reviewer/reviewed_on', () => {
  assert.throws(() => runSuite(
    { id: 'A1', type: 'min_distinct_cpu_gpu_pairs', status: 'approved', scenarios: ['S03'] },
    { A1_min_distinct_pairs: { value: 3 } },
    [{ id: 'S03' }],
    new Map([['S03', art()]])
  ), /requires a non-empty "reviewer"/);
});

test('evaluateSuite validates every threshold, including unused and malformed entries', () => {
  const check = (entry) => evaluateSuite({
    suite: { scenarios: [], assertions: [], thresholds: { unused: entry } },
    artifacts: new Map(), artifactsSecond: new Map(), pi1: null,
  });
  for (const entry of [null, 3, [], { value: 3 }, { status: undefined }]) {
    assert.throws(() => check(entry), /requires an explicit expectation status/);
  }
  for (const status of ['approved', 'waived']) {
    assert.throws(() => check({ status, reviewer: ' ' }), /requires a non-empty "reviewer"/);
    assert.throws(() => check({ status, reviewer: 'R' }), /requires "reviewed_on"/);
    assert.throws(() => check({ status, reviewer: 'R', reviewed_on: 'today' }), /requires "reviewed_on"/);
  }
  for (const status of ['hypothesis', 'approved', 'waived']) {
    assert.doesNotThrow(() => check({ status, reviewer: 'R', reviewed_on: '2026-10-08', reason: 'known' }));
  }
});

test('evaluateSuite REFUSES a threshold with an unknown expectation status', () => {
  assert.throws(() => runSuite(
    { id: 'A1', type: 'min_distinct_cpu_gpu_pairs', scenarios: ['S03'] },
    { A1_min_distinct_pairs: { value: 3, status: 'nonsense' } },
    [{ id: 'S03' }],
    new Map([['S03', art({ selected_pair_count: 3 })]])
  ), /has unknown expectation status/);
});

test('evaluateSuite REFUSES an approved threshold missing reviewer/reviewed_on', () => {
  assert.throws(() => runSuite(
    { id: 'A1', type: 'min_distinct_cpu_gpu_pairs', scenarios: ['S03'] },
    { A1_min_distinct_pairs: { value: 3, status: 'approved' } },
    [{ id: 'S03' }],
    new Map([['S03', art({ selected_pair_count: 3 })]])
  ), /requires a non-empty "reviewer"/);
});

test('evaluateSuite REFUSES a waived threshold missing reason', () => {
  assert.throws(() => runSuite(
    { id: 'A1', type: 'min_distinct_cpu_gpu_pairs', scenarios: ['S03'] },
    { A1_min_distinct_pairs: { value: 3, status: 'waived', reviewer: 'R', reviewed_on: '2026-10-08' } },
    [{ id: 'S03' }],
    new Map([['S03', art({ selected_pair_count: 3 })]])
  ), /requires a non-empty "reason"/);
});

test('an UNKNOWN escalates to a hard FAIL only once expect_builds_after has landed', () => {
  const assertion = { id: 'A1', type: 'min_distinct_cpu_gpu_pairs', scenarios: ['S17'] };
  const thresholds = { A1_min_distinct_pairs: { value: 3 } };
  const scenarios = [{ id: 'S17', expect_builds_after: 'E6' }];
  const artifacts = new Map([['S17', art({ build_count: 0, selected: [], selected_pair_count: 0 })]]);

  const preE6 = runSuite(assertion, thresholds, scenarios, artifacts, { suite: { current_epic: 'E1' } });
  assert.equal(preE6.results[0].status, STATUSES.UNKNOWN);
  assert.equal(preE6.results[0].disposition, DISPOSITIONS.UNKNOWN);
  assert.equal(preE6.summary.exit_ok, true);

  const atE6 = runSuite(assertion, thresholds, scenarios, artifacts, { suite: { current_epic: 'E6' } });
  assert.equal(atE6.results[0].status, STATUSES.UNKNOWN);
  assert.equal(atE6.results[0].disposition, DISPOSITIONS.FAIL);
  assert.equal(atE6.results[0].escalated, true);
  assert.equal(atE6.summary.hard_fail, 1);
});

test('any UNKNOWN escalates once expect_builds_after has landed, even with builds > 0', () => {
  const assertion = { id: 'A1', type: 'min_distinct_cpu_gpu_pairs', scenarios: ['S17'] };
  const thresholds = { A1_min_distinct_pairs: { value: 3 } };
  const scenarios = [{ id: 'S17', expect_builds_after: 'E6' }];
  // build_count > 0 but the assertion is UNKNOWN (no selected builds to measure):
  // the OLD predicate (build_count === 0) would NOT have escalated this row.
  const artifacts = new Map([['S17', art({ build_count: 5, selected: [], selected_pair_count: 0 })]]);

  const preE6 = runSuite(assertion, thresholds, scenarios, artifacts, { suite: { current_epic: 'E1' } });
  assert.equal(preE6.results[0].status, STATUSES.UNKNOWN);
  assert.equal(preE6.results[0].disposition, DISPOSITIONS.UNKNOWN);
  assert.equal(preE6.summary.exit_ok, true);

  const atE6 = runSuite(assertion, thresholds, scenarios, artifacts, { suite: { current_epic: 'E6' } });
  assert.equal(atE6.results[0].status, STATUSES.UNKNOWN);
  assert.equal(atE6.results[0].disposition, DISPOSITIONS.FAIL);
  assert.equal(atE6.results[0].escalated, true);
  assert.equal(atE6.summary.hard_fail, 1);
});

test('A2b: rank-1 GPU price must grow by the factor across budgets; flat FAILs, missing GPU is UNKNOWN', () => {
  const assertion = { id: 'A2b', type: 'gpu_price_growth', pairs: [{ low: 'S03', high: 'S05' }] };
  const thresholds = { A2b_gpu_price_growth_min: { value: 1.3 } };
  const scenarios = [{ id: 'S03' }, { id: 'S05' }];
  const best = (gpuPrice, total) => ({ signature: 's' + gpuPrice, total_price: total, gpu_price: gpuPrice, has_gpu: gpuPrice !== null, cpu_integrated_gpu_present: gpuPrice === null });

  const grown = run(assertion, thresholds, scenarios, new Map([
    ['S03', art({ budget_amount: 12000, best: best(9000, 20000) })],
    ['S05', art({ budget_amount: 30000, best: best(12000, 26000) })],
  ]));
  assert.equal(grown[0].status, STATUSES.PASS);
  assert.equal(grown[0].measured.ratio, 12000 / 9000);

  const flat = run(assertion, thresholds, scenarios, new Map([
    ['S03', art({ budget_amount: 12000, best: best(9000, 20000) })],
    ['S05', art({ budget_amount: 30000, best: best(9000, 20000) })],
  ]));
  assert.equal(flat[0].status, STATUSES.FAIL);
  assert.equal(flat[0].measured.ratio, 1);

  const noGpu = run(assertion, thresholds, scenarios, new Map([
    ['S03', art({ budget_amount: 12000, best: best(null, 20000) })],
    ['S05', art({ budget_amount: 30000, best: best(9000, 26000) })],
  ]));
  assert.equal(noGpu[0].status, STATUSES.UNKNOWN);
});

test('A3 share: a no-GPU build yields a null share; a zero-total build THROWS (never divides by zero)', () => {
  const snapshot = (build) => ({ builds: [build], budget_floor: {}, budget_amount: 12000, currency: 'MAD' });

  const noGpuBuild = { components: [component('CPU', 'cpu-1', null, 400)], total_price: 1000, currency: 'MAD' };
  const noGpuEntry = { signature: 's', total_price: 1000, compatibility_status: 'PASS', build: noGpuBuild };
  const noGpu = projectArtifact('S', snapshot(noGpuBuild), { ranked: [noGpuEntry] }, { selected: [noGpuEntry] }, MAPS);
  assert.equal(noGpu.best_gpu_price_share, null);

  const zeroBuild = {
    components: [component('CPU', 'cpu-1', null, 0), component('GPU', 'gpu-1', 'var-1', 0)],
    total_price: 0,
    currency: 'MAD',
  };
  const zeroEntry = { signature: 's', total_price: 0, compatibility_status: 'PASS', build: zeroBuild };
  assert.throws(
    () => projectArtifact('S', snapshot(zeroBuild), { ranked: [zeroEntry] }, { selected: [zeroEntry] }, MAPS),
    /positive finite total_price/
  );
});
