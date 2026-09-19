'use strict';

// ---------------------------------------------------------------------------
// Engine 3 - assembly entry point (./pipeline): end-to-end integration test.
//
// Proves the complete Engine 3 call resolves the GPU requirement from REAL
// candidate-pool-shaped input with NO manual stubbing: the fixture runs the
// implemented Engine 2 stages first
//
//   selectCandidatePool  ->  selectOfferPrices (Stage 1)  ->
//   loadFilteringContext (2D)  ->  filterCandidates (2D)
//
// and then hands the four produced sources to assembleBuildsForRecommendation.
// The iGPU values come from real cpu_spec rows through the Engine 2D context,
// `gpu_required_use_cases` comes from the scoring-model configuration, and
// `use_case` comes from the Engine 2A selection input - nothing is passed in
// pre-resolved, and resolveGpuRequirement is never called by the test.
//
// The database is a deterministic fake (SQL routed by table marker, rows scoped
// like a parameterized `= ANY($1::uuid[])` query) - no live DB, no .env.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { assembleBuildsForRecommendation } = require('./pipeline');
const { EXPANSION_ORDER } = require('./assemble');
const { priceKey, validatePrices } = require('./prices');
const { selectCandidatePool } = require('../candidates/select');
const { selectOfferPrices } = require('../offers/select');
const { loadFilteringContext } = require('../filtering/context-loader');
const { filterCandidates } = require('../filtering/filter');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

// ---------------------------------------------------------------------------
// Deterministic ids (distinct prefixes so parameter scoping cannot collide).
// ---------------------------------------------------------------------------

const U = (n) => 'uuuuuuuu-uuuu-uuuu-uuuu-' + String(n).padStart(12, '0');
const V = (n) => 'vvvvvvvv-vvvv-vvvv-vvvv-' + String(n).padStart(12, '0');
const P = (n) => 'pppppppp-pppp-pppp-pppp-' + String(n).padStart(12, '0');
const F = (n) => 'ffffffff-ffff-4fff-8fff-' + String(n).padStart(12, '0');
const STORE = '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a';

const DECISION_TS = '2026-09-19T09:00:00.000Z';
const CURRENCY = 'MAD';
const BUDGET = 100000;

/** Decision 10 Rule 1 loader constant, in canonical component_role order. */
const REQUIRED_ROLES = Object.freeze([
  'CPU', 'MOTHERBOARD', 'RAM', 'GPU', 'PSU', 'CASE', 'CPU_COOLER', 'SSD_BOOT',
]);

// Product identity per role (GPU is variant-keyed).
const CPU_IGPU_TRUE = U(1);
const CPU_IGPU_FALSE = U(2);
const CPU_IGPU_NULL = U(3);
const CPU_NO_SPEC_ROW = U(4);
const MB = U(5);
const RAM = U(6);
const GPU = U(7);
const GPU_VARIANT = V(1);
const PSU = U(8);
const MB_SOCKET_MISMATCH = U(9);
const CASE = U(10);
const COOLER = U(11);
const SSD = U(12);

const SOCKET_A = P(1);
const SOCKET_B = P(2);
const MEMORY_TYPE = P(20);

const PRICE = Object.freeze({
  CPU: 300,
  MOTHERBOARD: 150,
  RAM: 100,
  GPU: 500,
  PSU: 120,
  CASE: 90,
  COOLER: 60,
  SSD: 80,
});

const COMPLETE_TOTAL =
  PRICE.CPU + PRICE.MOTHERBOARD + PRICE.RAM + PRICE.GPU +
  PRICE.PSU + PRICE.CASE + PRICE.COOLER + PRICE.SSD;
const OMITTED_GPU_TOTAL = COMPLETE_TOTAL - PRICE.GPU;

// ---------------------------------------------------------------------------
// Fake database (same routing/scoping approach as filtering/integration.test.js).
// ---------------------------------------------------------------------------

const SQL = {
  CPU: 'FROM cpu_spec',
  MOTHERBOARD: 'FROM motherboard_spec',
  RAM: 'FROM ram_spec',
  COOLER: 'FROM cooler_spec',
  CASE: 'FROM case_spec',
  PSU: 'FROM psu_spec',
  GPU: 'FROM gpu_board_spec',
  CPU_MB: 'FROM cpu_motherboard_support',
  COOLER_SOCKET: 'FROM cooler_socket_support',
  CASE_FF: 'FROM case_motherboard_form_factor',
  CASE_RAD: 'FROM case_radiator_support',
  PLATFORM: 'FROM platform',
  PLATFORM_MEM: 'FROM platform_memory_support',
  STORE_OFFER: 'FROM store_offer',
};

function bySql(routes) {
  const entries = Object.entries(routes)
    .map(([key, rows]) => ({ marker: SQL[key], rows }))
    .sort((a, b) => b.marker.length - a.marker.length);
  return (sql) => {
    for (const entry of entries) {
      if (sql.includes(entry.marker)) return entry.rows;
    }
    throw new Error('unexpected query: ' + sql);
  };
}

function scopeRowsByParams(rows, params) {
  const idList = Array.isArray(params?.[0]) ? params[0] : null;
  if (!idList) return rows;
  const ids = new Set(idList);
  return rows.filter((row) => Object.values(row).some((value) => ids.has(value)));
}

function createDb(routes) {
  const route = bySql(routes);
  return {
    async query(sql, params) {
      return { rows: scopeRowsByParams(route(sql), params) };
    },
  };
}

/** One eligible store_offer row per candidate (price_checked_at = decision ts). */
function offerRow(productId, variantId, price, n) {
  return {
    id: F(n),
    store_id: STORE,
    product_id: productId,
    product_variant_id: variantId,
    price,
    currency: CURRENCY,
    availability: 'IN_STOCK',
    last_checked_at: DECISION_TS,
    price_checked_at: DECISION_TS,
  };
}

const OFFERS = Object.freeze([
  offerRow(CPU_IGPU_TRUE, null, PRICE.CPU, 1),
  offerRow(CPU_IGPU_FALSE, null, PRICE.CPU, 2),
  offerRow(CPU_IGPU_NULL, null, PRICE.CPU, 3),
  offerRow(CPU_NO_SPEC_ROW, null, PRICE.CPU, 4),
  offerRow(MB, null, PRICE.MOTHERBOARD, 5),
  offerRow(MB_SOCKET_MISMATCH, null, PRICE.MOTHERBOARD, 6),
  offerRow(RAM, null, PRICE.RAM, 7),
  offerRow(GPU, GPU_VARIANT, PRICE.GPU, 8),
  offerRow(PSU, null, PRICE.PSU, 9),
  offerRow(CASE, null, PRICE.CASE, 10),
  offerRow(COOLER, null, PRICE.COOLER, 11),
  offerRow(SSD, null, PRICE.SSD, 12),
]);

function routes(cpuRows) {
  return {
    CPU: cpuRows,
    MOTHERBOARD: [
      { product_id: MB, socket_id: SOCKET_A, form_factor: 'ATX', memory_type_id: MEMORY_TYPE },
      // A definite socket mismatch with every CPU (plus the explicit support
      // FAIL row for the spec-less CPU): REJECT in Engine 2D for every CPU.
      { product_id: MB_SOCKET_MISMATCH, socket_id: SOCKET_B, form_factor: 'ATX', memory_type_id: MEMORY_TYPE },
    ],
    RAM: [{ product_id: RAM, memory_type_id: MEMORY_TYPE }],
    GPU: [{
      product_variant_id: GPU_VARIANT,
      length_mm: 300,
      width_slots: 2,
      required_power_connectors: null,
      recommended_psu_watts: 550,
    }],
    PSU: [{
      product_id: PSU, rated_wattage: 750, connector_24pin_atx: true,
      connector_eps_count: 1, connector_pcie_8pin: 2, connector_12vhpwr: false, connector_sata: 4,
    }],
    CASE: [{ product_id: CASE, max_gpu_length_mm: 350, max_gpu_thickness_slots: 3 }],
    COOLER: [{ product_id: COOLER, cooling_type: 'AIR' }],
    // Explicit FAIL support for the CPU that has NO cpu_spec row (the Decision
    // 11 "missing row" case): without it the socket comparison for that CPU is
    // indefinite (UNKNOWN) and Engine 2D's best-of-partner rule would keep the
    // mismatched board eligible. With it, the board is a definite REJECT for
    // every CPU in this fixture.
    CPU_MB: [{
      id: F(20),
      motherboard_product_id: MB_SOCKET_MISMATCH,
      cpu_product_id: CPU_NO_SPEC_ROW,
      cpu_product_family_id: null,
      support_status: 'FAIL',
      min_bios_version: null,
    }],
    COOLER_SOCKET: [],
    CASE_FF: [],
    CASE_RAD: [],
    PLATFORM: [],
    PLATFORM_MEM: [],
    STORE_OFFER: OFFERS,
  };
}

/** cpu_spec rows for the four CPU states covered by Decision 11. */
function cpuSpecRows() {
  return [
    { product_id: CPU_IGPU_TRUE, socket_id: SOCKET_A, product_family_id: null, integrated_gpu_present: true },
    { product_id: CPU_IGPU_FALSE, socket_id: SOCKET_A, product_family_id: null, integrated_gpu_present: false },
    { product_id: CPU_IGPU_NULL, socket_id: SOCKET_A, product_family_id: null, integrated_gpu_present: null },
    // CPU_NO_SPEC_ROW deliberately has no cpu_spec row at all.
  ];
}

// ---------------------------------------------------------------------------
// Fixture wiring: the real Engine 2 stages, then the Engine 3 entry point.
// ---------------------------------------------------------------------------

function candidates({ cpus = [CPU_IGPU_TRUE] } = {}) {
  const rows = cpus.map((productId) => ({
    product_id: productId,
    product_variant_id: null,
    category: 'CPU',
    component_role: 'CPU',
  }));
  rows.push(
    { product_id: MB, product_variant_id: null, category: 'MOTHERBOARD', component_role: 'MOTHERBOARD' },
    { product_id: MB_SOCKET_MISMATCH, product_variant_id: null, category: 'MOTHERBOARD', component_role: 'MOTHERBOARD' },
    { product_id: RAM, product_variant_id: null, category: 'MEMORY', component_role: 'RAM' },
    { product_id: GPU, product_variant_id: GPU_VARIANT, category: 'GPU', component_role: 'GPU' },
    { product_id: PSU, product_variant_id: null, category: 'PSU', component_role: 'PSU' },
    { product_id: CASE, product_variant_id: null, category: 'CASE', component_role: 'CASE' },
    { product_id: COOLER, product_variant_id: null, category: 'COOLER', component_role: 'CPU_COOLER' },
    { product_id: SSD, product_variant_id: null, category: 'STORAGE', component_role: 'SSD_BOOT' }
  );
  return rows;
}

/**
 * Run the whole implemented chain for one fixture: Engine 2C -> Engine 2
 * Stage 1 -> Engine 2D context -> Engine 2D verdicts -> Engine 3 assembly.
 * The Engine 3 call receives the four produced sources and nothing pre-resolved.
 */
async function runPipeline({
  useCase = 'office',
  gpuRequiredUseCases = ['GAMING', 'WORKSTATION'],
  cpus = [CPU_IGPU_TRUE],
  topK = 5,
  maxBuilds = 10,
} = {}) {
  const selectionInput = {
    budget_amount: BUDGET,
    currency: CURRENCY,
    use_case: useCase,
    required_roles: REQUIRED_ROLES,
  };

  const poolResult = selectCandidatePool(selectionInput, candidates({ cpus }));
  const db = createDb(routes(cpuSpecRows()));
  const stage1 = await selectOfferPrices(poolResult, db);
  const filteringContext = await loadFilteringContext(stage1, db);
  const filterResult = filterCandidates(filteringContext);
  const scoringModel = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'baseline',
    version: 1,
    configuration: {
      gpu_required_use_cases: gpuRequiredUseCases,
      candidate_caps: { top_k_per_role: topK, max_builds_per_query: maxBuilds },
    },
  };

  const builds = assembleBuildsForRecommendation({
    candidatePoolResult: stage1,
    filteringContext,
    filterResult,
    scoringModel,
    prices: stage1.prices,
  });

  return {
    selectionInput,
    poolResult,
    stage1,
    filteringContext,
    filterResult,
    scoringModel,
    assembled: builds,
  };
}

/** The four sources a caller hands to the Engine 3 entry point. */
function validSources(run) {
  return {
    candidatePoolResult: run.stage1,
    filteringContext: run.filteringContext,
    filterResult: run.filterResult,
    scoringModel: run.scoringModel,
    prices: run.stage1.prices,
  };
}

/** Component product id per role for one emitted build. */
function idsOf(build) {
  const ids = {};
  for (const component of build.components) {
    ids[component.component_role] = component.product_id;
  }
  return ids;
}

function rolesOf(build) {
  return build.components.map((component) => component.component_role);
}

/** The GPU product id of the first build carrying a GPU, or undefined. */
function firstGpuId(builds) {
  for (const build of builds) {
    const gpu = build.components.find((component) => component.component_role === 'GPU');
    if (gpu !== undefined) return gpu.product_id;
  }
  return undefined;
}

function expectError(code, field) {
  return (err) => {
    assert.ok(err instanceof CandidateSelectionError, 'expected CandidateSelectionError');
    assert.equal(err.code, code);
    assert.equal(err.field, field);
    return true;
  };
}

// ---------------------------------------------------------------------------
// 1. GPU-required use case: REQUIRED, sourced from the scoring model.
// ---------------------------------------------------------------------------

test('end-to-end: a GPU-required use case yields GPU-complete builds from the real pool', async () => {
  const run = await runPipeline({
    useCase: 'GAMING',
    gpuRequiredUseCases: ['GAMING', 'WORKSTATION'],
    cpus: [CPU_IGPU_TRUE],
  });

  // The Engine 2D verdicts are real: the socket-mismatched board is REJECT.
  const rejected = run.filterResult.results.find((entry) => entry.product_id === MB_SOCKET_MISMATCH);
  assert.equal(rejected.status, 'REJECT');

  // REQUIRED: exactly one complete build, no GPU-omitted path.
  assert.equal(run.assembled.builds.length, 1);
  const build = run.assembled.builds[0];
  assert.deepEqual(rolesOf(build), [...EXPANSION_ORDER]);
  assert.equal(idsOf(build).GPU, GPU);
  assert.equal(idsOf(build).CPU, CPU_IGPU_TRUE);
  assert.equal(idsOf(build).MOTHERBOARD, MB, 'the REJECT board must never be assembled');
  assert.equal(build.total_price, COMPLETE_TOTAL);
  assert.equal(build.currency, CURRENCY);
});

test('end-to-end: the same fixture under a non-GPU use case yields the omit path', async () => {
  const run = await runPipeline({
    useCase: 'office',
    gpuRequiredUseCases: ['GAMING', 'WORKSTATION'],
    cpus: [CPU_IGPU_TRUE],
  });

  // OPTIONAL: the GPU build first, then exactly one GPU-omitted build.
  assert.equal(run.assembled.builds.length, 2);
  const [withGpu, withoutGpu] = run.assembled.builds;
  assert.deepEqual(rolesOf(withGpu), [...EXPANSION_ORDER]);
  assert.deepEqual(
    rolesOf(withoutGpu),
    EXPANSION_ORDER.filter((role) => role !== 'GPU')
  );
  assert.equal(idsOf(withGpu).GPU, GPU);
  assert.equal(withGpu.total_price, COMPLETE_TOTAL);
  assert.equal(withoutGpu.total_price, OMITTED_GPU_TOTAL);
});

test('end-to-end: iGPU false / DB NULL / missing cpu_spec row all resolve REQUIRED', async () => {
  for (const cpu of [CPU_IGPU_FALSE, CPU_IGPU_NULL, CPU_NO_SPEC_ROW]) {
    const run = await runPipeline({
      useCase: 'office',
      gpuRequiredUseCases: ['GAMING', 'WORKSTATION'],
      cpus: [cpu],
    });

    assert.equal(run.assembled.builds.length, 1, 'expected no omit path for ' + cpu);
    const build = run.assembled.builds[0];
    assert.equal(idsOf(build).CPU, cpu);
    assert.equal(idsOf(build).GPU, GPU, 'GPU must be present for ' + cpu);
    assert.equal(build.total_price, COMPLETE_TOTAL);
  }
});

test('end-to-end: every CPU in one pool resolves its own GPU requirement', async () => {
  const run = await runPipeline({
    useCase: 'office',
    gpuRequiredUseCases: ['GAMING', 'WORKSTATION'],
    cpus: [CPU_IGPU_TRUE, CPU_IGPU_FALSE, CPU_IGPU_NULL, CPU_NO_SPEC_ROW],
    maxBuilds: 20,
  });

  // One OPTIONAL CPU (2 paths: GPU + omit) and three REQUIRED CPUs (1 path each).
  assert.equal(run.assembled.builds.length, 5);

  const gpuCountByCpu = {};
  for (const build of run.assembled.builds) {
    const cpu = idsOf(build).CPU;
    gpuCountByCpu[cpu] = gpuCountByCpu[cpu] ?? { withGpu: 0, withoutGpu: 0 };
    if (idsOf(build).GPU === undefined) {
      gpuCountByCpu[cpu].withoutGpu += 1;
    } else {
      gpuCountByCpu[cpu].withGpu += 1;
    }
  }
  assert.deepEqual(gpuCountByCpu[CPU_IGPU_TRUE], { withGpu: 1, withoutGpu: 1 });
  assert.deepEqual(gpuCountByCpu[CPU_IGPU_FALSE], { withGpu: 1, withoutGpu: 0 });
  assert.deepEqual(gpuCountByCpu[CPU_IGPU_NULL], { withGpu: 1, withoutGpu: 0 });
  assert.deepEqual(gpuCountByCpu[CPU_NO_SPEC_ROW], { withGpu: 1, withoutGpu: 0 });
  assert.equal(firstGpuId(run.assembled.builds), GPU);
});

// ---------------------------------------------------------------------------
// 2. Build contents: prices, freezing, cap semantics.
// ---------------------------------------------------------------------------

test('end-to-end: emitted components carry the Stage 1 selected price as the Step 2 frozen carrier', async () => {
  const run = await runPipeline({ useCase: 'office', cpus: [CPU_IGPU_TRUE] });

  assert.ok(Object.isFrozen(run.assembled));
  assert.ok(Object.isFrozen(run.assembled.builds));
  for (const build of run.assembled.builds) {
    assert.ok(Object.isFrozen(build));
    assert.ok(Object.isFrozen(build.components));
    let total = 0;
    for (const component of build.components) {
      const key = priceKey(component.product_id, component.product_variant_id, component.component_role);
      const stage1Entry = run.stage1.prices[key];
      assert.ok(stage1Entry, 'no Stage 1 price for ' + key);
      // Same selected price/metadata as Engine 2 Stage 1 produced...
      assert.deepEqual(component.price, stage1Entry);
      assert.equal(component.price.currency, build.currency);
      // ...carried as the frozen Step 2 copy (Step 2 owns the carrier copy).
      assert.ok(Object.isFrozen(component.price));
      assert.notEqual(component.price, stage1Entry);
      total += component.price.selected_price;
    }
    assert.equal(build.total_price, total);
  }

  // Inside Engine 3 the carrier entry is shared: Step 4 keeps the exact carrier
  // object rather than cloning it per build.
  const cpuOf = (build) => build.components.find((c) => c.component_role === 'CPU');
  assert.equal(cpuOf(run.assembled.builds[0]).price, cpuOf(run.assembled.builds[1]).price);
});

test('end-to-end: max_builds_per_query halts traversal, top_k_per_role is never applied', async () => {
  // The halt cap comes from scoring_model.configuration.candidate_caps.
  const halted = await runPipeline({ useCase: 'office', cpus: [CPU_IGPU_TRUE], maxBuilds: 1 });
  assert.equal(halted.assembled.builds.length, 1);

  // The per-role cap is validated and preserved only (Decision 11 Rule 7 /
  // Decision 14 stays unimplemented): a top_k of 1 removes nothing here.
  const notApplied = await runPipeline({
    useCase: 'office',
    cpus: [CPU_IGPU_TRUE, CPU_IGPU_FALSE, CPU_IGPU_NULL, CPU_NO_SPEC_ROW],
    topK: 1,
    maxBuilds: 20,
  });
  assert.equal(notApplied.assembled.builds.length, 5);
});

// ---------------------------------------------------------------------------
// 3. Determinism and immutability.
// ---------------------------------------------------------------------------

test('end-to-end: repeated runs are deeply equal and never mutate the sources', async () => {
  const run = await runPipeline({ useCase: 'office', cpus: [CPU_IGPU_TRUE, CPU_IGPU_FALSE] });
  const sources = validSources(run);
  const before = {
    stage1: structuredClone(run.stage1),
    filterResult: structuredClone(run.filterResult),
    model: structuredClone(run.scoringModel),
  };

  const second = assembleBuildsForRecommendation(sources);

  assert.deepEqual(second, run.assembled);
  assert.deepEqual(structuredClone(run.stage1), before.stage1);
  assert.deepEqual(structuredClone(run.filterResult), before.filterResult);
  assert.deepEqual(structuredClone(run.scoringModel), before.model);

  // Caller-owned sources stay unfrozen.
  assert.equal(Object.isFrozen(run.scoringModel), false);
  assert.equal(Object.isFrozen(run.scoringModel.configuration), false);
  assert.equal(Object.isFrozen(run.scoringModel.configuration.gpu_required_use_cases), false);
});

// ---------------------------------------------------------------------------
// 4. Fail-fast: every source is required, no price is ever invented.
// ---------------------------------------------------------------------------

test('fail-fast: the entry point requires an object carrying all five sources', async () => {
  for (const bad of [undefined, null]) {
    assert.throws(
      () => assembleBuildsForRecommendation(bad),
      expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, null),
      'expected MISSING_REQUIRED_FIELD for ' + String(bad)
    );
  }
  for (const bad of ['sources', 42, [], true]) {
    assert.throws(
      () => assembleBuildsForRecommendation(bad),
      expectError(ERROR_CODES.INVALID_INPUT, null),
      'expected INVALID_INPUT for ' + String(bad)
    );
  }

  const run = await runPipeline();
  for (const field of [
    'candidatePoolResult',
    'filteringContext',
    'filterResult',
    'scoringModel',
    'prices',
  ]) {
    const missing = validSources(run);
    delete missing[field];
    assert.throws(
      () => assembleBuildsForRecommendation(missing),
      expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, field),
      'expected MISSING_REQUIRED_FIELD for absent ' + field
    );

    const nulled = validSources(run);
    nulled[field] = null;
    assert.throws(
      () => assembleBuildsForRecommendation(nulled),
      expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, field),
      'expected MISSING_REQUIRED_FIELD for null ' + field
    );
  }
});

test('fail-fast: a malformed Engine 2D result or scoring model is rejected', async () => {
  const run = await runPipeline();

  for (const bad of [{ results: {} }, [], 'results', { results: null }]) {
    assert.throws(
      () => assembleBuildsForRecommendation({ ...validSources(run), filterResult: bad }),
      expectError(ERROR_CODES.INVALID_INPUT, 'filterResult'),
      'expected INVALID_INPUT for filterResult=' + JSON.stringify(bad)
    );
  }

  assert.throws(
    () => assembleBuildsForRecommendation({ ...validSources(run), scoringModel: {} }),
    expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, 'scoring_model.configuration')
  );
  assert.throws(
    () => assembleBuildsForRecommendation({
      ...validSources(run),
      scoringModel: { configuration: { candidate_caps: { top_k_per_role: 5, max_builds_per_query: 10 } } },
    }),
    expectError(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'scoring_model.configuration.gpu_required_use_cases'
    )
  );
});

test('fail-fast: candidate_caps stays Step 1 ownership; a missing price is never invented', async () => {
  const run = await runPipeline();

  // candidate_caps shape: validated by Step 1, with the exact nested path.
  const badModel = {
    ...run.scoringModel,
    configuration: {
      ...run.scoringModel.configuration,
      candidate_caps: { top_k_per_role: 5 },
    },
  };
  assert.throws(
    () => assembleBuildsForRecommendation({ ...validSources(run), scoringModel: badModel }),
    expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, 'candidate_caps.max_builds_per_query')
  );

  // A plain object is not a price carrier - the Step 2 contract owns that.
  assert.throws(
    () => assembleBuildsForRecommendation({ ...validSources(run), prices: {} }),
    expectError(ERROR_CODES.INVALID_INPUT, 'prices')
  );

  // Drop the GPU price entry: assembly must fail rather than invent a price.
  const raw = Object.create(null);
  const gpuKey = priceKey(GPU, GPU_VARIANT, 'GPU');
  for (const key of Object.keys(run.stage1.prices)) {
    if (key === gpuKey) continue;
    Object.defineProperty(raw, key, {
      value: run.stage1.prices[key],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  assert.equal(raw[gpuKey], undefined);
  assert.throws(
    () => assembleBuildsForRecommendation({ ...validSources(run), prices: validatePrices(raw) }),
    (err) =>
      err instanceof CandidateSelectionError &&
      err.code === ERROR_CODES.INVALID_CANDIDATE &&
      err.field === 'prices',
    'expected the missing-price lookup failure'
  );
});

// ---------------------------------------------------------------------------
// 5. Source boundary and public surface.
// ---------------------------------------------------------------------------

const PIPELINE_SOURCE = fs.readFileSync(path.join(__dirname, 'pipeline.js'), 'utf8');

test('pipeline.js keeps its source boundary (pure composition, no DB access)', () => {
  const forbidden = [
    'new Pool',
    '.query(',
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'store_offer',
    'Math.random',
    'Date.now',
    'async',
    'await',
  ];
  for (const needle of forbidden) {
    assert.equal(PIPELINE_SOURCE.includes(needle), false, `must not contain ${needle}`);
  }
  assert.equal(/require\(['"]pg['"]\)/.test(PIPELINE_SOURCE), false, 'must not contain pg require');
  assert.equal(/\bscore\b/i.test(PIPELINE_SOURCE), false, 'must not contain score');
  assert.equal(/\brank\b/i.test(PIPELINE_SOURCE), false, 'must not contain rank');
});

test('pipeline.js composes exactly the six allowed engine modules', () => {
  const requires = [...PIPELINE_SOURCE.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(requires, [
    '../candidates/input',
    '../candidates/errors',
    './gpu-input',
    './input',
    './prices',
    './assemble',
  ]);
  assert.equal(
    PIPELINE_SOURCE.includes('module.exports = { assembleBuildsForRecommendation };'),
    true
  );
});

test('public surface is exactly assembleBuildsForRecommendation', () => {
  const api = require('./pipeline');
  assert.deepEqual(Object.keys(api), ['assembleBuildsForRecommendation']);
  assert.equal(typeof assembleBuildsForRecommendation, 'function');
  assert.equal(assembleBuildsForRecommendation.length, 1);
});