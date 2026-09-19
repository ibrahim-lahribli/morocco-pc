'use strict';

// ---------------------------------------------------------------------------
// Engine 3 - GPU-input loading (./gpu-input): contract tests.
//
// Scope: exactly the sourcing/adaptation rules - the four Decision 11 iGPU
// states, the Engine 2A `use_case` passthrough, the verbatim
// gpu_required_use_cases passthrough, the no-undefined guarantee, determinism,
// immutability, the fail-fast matrix, the source boundary and the public
// surface. GPU POLICY branches are NOT re-tested here (see gpu-policy.test.js);
// the pairing assertions below use the existing, unchanged
// resolveGpuRequirement() to prove the downstream outcomes.
//
// Pure tests: no real database, no .env, no destructive commands. The Engine 2D
// context is produced by the real loadFilteringContext over a deterministic
// fake db (same approach as filtering/igpu-map.test.js).
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildGpuInputs } = require('./gpu-input');
const { resolveGpuRequirement } = require('./gpu-policy');
const { validateEngine3Input } = require('./input');
const { loadFilteringContext } = require('../filtering/context-loader');
const { createCandidate, ROLE_CATEGORIES } = require('../candidates');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

// ---------------------------------------------------------------------------
// Fake database (same routing/scoping approach as filtering/igpu-map.test.js).
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

/** Deterministic id helpers (hex, lexicographically orderable). */
const U = (n) => 'uuuuuuuu-uuuu-uuuu-uuuu-' + String(n).padStart(12, '0');
const P = (n) => 'pppppppp-pppp-pppp-pppp-' + String(n).padStart(12, '0');

function emptyRoutes() {
  return {
    CPU: [], MOTHERBOARD: [], RAM: [], COOLER: [],
    CASE: [], PSU: [], GPU: [], CPU_MB: [],
    COOLER_SOCKET: [], CASE_FF: [], CASE_RAD: [],
    PLATFORM: [], PLATFORM_MEM: [],
  };
}

function makeCandidate(role, productId, variantId = null) {
  return createCandidate({
    component_role: role,
    category: ROLE_CATEGORIES[role],
    product_id: productId,
    product_variant_id: variantId,
  });
}

/** Engine 2C candidate-pool result shape for the given pool. */
function poolResult(pool, overrides = {}) {
  return {
    input: {
      budget_amount: 100000,
      currency: 'MAD',
      use_case: 'office',
      required_roles: [...new Set(pool.map((c) => c.component_role))],
      ...overrides,
    },
    pool,
  };
}

/** Validated-scoring-model shape (Decision 11 loader output) for fixtures. */
function scoringModel(gpuRequiredUseCases, { candidateCaps } = {}) {
  return {
    id: 'model-1',
    name: 'baseline',
    version: 1,
    configuration: {
      gpu_required_use_cases: gpuRequiredUseCases,
      candidate_caps: candidateCaps ?? { top_k_per_role: 5, max_builds_per_query: 10 },
    },
  };
}

/**
 * Real Engine 2D filtering context carrying the given cpu_spec rows. Only the
 * CPU side is populated: the iGPU handoff reads nothing else.
 */
async function contextWithCpuSpecRows(cpuRows) {
  const pool = [
    makeCandidate('CPU', U(1)),
    makeCandidate('CPU', U(2)),
    makeCandidate('CPU', U(3)),
    makeCandidate('CPU', U(4)),
  ];
  const routes = emptyRoutes();
  routes.CPU = cpuRows;
  return loadFilteringContext(poolResult(pool), createDb(routes));
}

function expectError(code, field) {
  return (err) => {
    assert.ok(
      err instanceof CandidateSelectionError,
      'expected CandidateSelectionError, got ' + String(err)
    );
    assert.equal(err.code, code);
    assert.equal(err.field, field);
    return true;
  };
}

/** The three populated CPU spec states used by the iGPU tests. */
function threeStateCpuRows() {
  return [
    { product_id: U(1), socket_id: P(1), product_family_id: null, integrated_gpu_present: true },
    { product_id: U(2), socket_id: P(1), product_family_id: null, integrated_gpu_present: false },
    { product_id: U(3), socket_id: P(1), product_family_id: null, integrated_gpu_present: null },
    // U(4): no cpu_spec row at all.
  ];
}

// ---------------------------------------------------------------------------
// 1. Output shape: exactly the resolveGpuRequirement argument contract.
// ---------------------------------------------------------------------------

test('output is frozen with the documented key order and spreads into resolveGpuRequirement', async () => {
  const context = await contextWithCpuSpecRows(threeStateCpuRows());
  const inputs = buildGpuInputs({
    candidatePoolResult: poolResult([makeCandidate('CPU', U(1))]),
    filteringContext: context,
    scoringModel: scoringModel(['GAMING', 'WORKSTATION']),
  });

  assert.deepEqual(Object.keys(inputs), [
    'use_case',
    'gpu_required_use_cases',
    'integrated_gpu_present',
  ]);
  assert.ok(Object.isFrozen(inputs));
  assert.ok(Object.isFrozen(inputs.gpu_required_use_cases));
  assert.ok(Object.isFrozen(inputs.integrated_gpu_present));

  // The whole point of the shape: a caller spreads it and adds the per-path CPU.
  assert.equal(
    resolveGpuRequirement({ ...inputs, selectedCpuProductId: U(1) }),
    'OPTIONAL'
  );
  assert.equal(
    resolveGpuRequirement({ ...inputs, selectedCpuProductId: U(2) }),
    'REQUIRED'
  );

  // Exactly one argument, synchronous, no db dependency.
  assert.equal(buildGpuInputs.length, 1);
});

// ---------------------------------------------------------------------------
// 2. use_case: sourced from the Engine 2A selection input, verbatim.
// ---------------------------------------------------------------------------

test('use_case comes from the Engine 2A selection input, preserved verbatim', async () => {
  const context = await contextWithCpuSpecRows([]);
  const inputs = buildGpuInputs({
    candidatePoolResult: poolResult([makeCandidate('CPU', U(1))], { use_case: ' GAMING ' }),
    filteringContext: context,
    scoringModel: scoringModel(['GAMING']),
  });

  // No trim, no case folding: strict byte matching stays Step 3's job.
  assert.equal(inputs.use_case, ' GAMING ');
  assert.equal(
    resolveGpuRequirement({ ...inputs, selectedCpuProductId: U(1) }),
    'REQUIRED' // ' GAMING ' !== 'GAMING' -> falls through to the iGPU rule
  );
});

// ---------------------------------------------------------------------------
// 3. integrated_gpu_present: the four resolved Decision 11 cases.
// ---------------------------------------------------------------------------

test('the four resolved iGPU states flow through unchanged and drive the policy', async () => {
  const context = await contextWithCpuSpecRows(threeStateCpuRows());
  const inputs = buildGpuInputs({
    candidatePoolResult: poolResult([makeCandidate('CPU', U(1))]),
    filteringContext: context,
    scoringModel: scoringModel(['GAMING']),
  });

  // true / false / DB NULL / missing cpu_spec row.
  assert.equal(inputs.integrated_gpu_present[U(1)], true);
  assert.equal(inputs.integrated_gpu_present[U(2)], false);
  assert.equal(inputs.integrated_gpu_present[U(3)], null);
  assert.equal(inputs.integrated_gpu_present[U(4)], null);

  // No value is ever undefined (the Engine 3 input contract rejects undefined).
  for (const key of Object.keys(inputs.integrated_gpu_present)) {
    const value = inputs.integrated_gpu_present[key];
    assert.ok(value === true || value === false || value === null, 'key ' + key);
  }
  assert.equal(Object.keys(inputs.integrated_gpu_present).length, 4);

  // 'office' is not a GPU-required use case: only `=== true` yields OPTIONAL.
  const decisionFor = (cpuId) =>
    resolveGpuRequirement({ ...inputs, selectedCpuProductId: cpuId });
  assert.equal(decisionFor(U(1)), 'OPTIONAL');
  assert.equal(decisionFor(U(2)), 'REQUIRED');
  assert.equal(decisionFor(U(3)), 'REQUIRED');
  assert.equal(decisionFor(U(4)), 'REQUIRED');
});

test('a GPU-required use case overrides a present integrated GPU', async () => {
  const context = await contextWithCpuSpecRows(threeStateCpuRows());
  const inputs = buildGpuInputs({
    candidatePoolResult: poolResult([makeCandidate('CPU', U(1))], { use_case: 'gaming' }),
    filteringContext: context,
    scoringModel: scoringModel(['gaming', 'workstation']),
  });

  assert.equal(inputs.integrated_gpu_present[U(1)], true);
  assert.equal(
    resolveGpuRequirement({ ...inputs, selectedCpuProductId: U(1) }),
    'REQUIRED'
  );
});

// ---------------------------------------------------------------------------
// 4. gpu_required_use_cases: verbatim pass-through, no vocabulary enforcement.
// ---------------------------------------------------------------------------

/** A minimal valid Engine 3 input built from loader output (for Step 1 checks). */
function engine3InputFrom(gpuInputs, results = []) {
  return {
    results,
    budget_amount: 1000,
    currency: 'MAD',
    required_roles: ['CPU'],
    use_case: gpuInputs.use_case,
    gpu_required_use_cases: gpuInputs.gpu_required_use_cases,
    integrated_gpu_present: gpuInputs.integrated_gpu_present,
    candidate_caps: { top_k_per_role: 5, max_builds_per_query: 10 },
    prices: Object.create(null),
  };
}

test('gpu_required_use_cases is copied verbatim: order, duplicates, whitespace, case', () => {
  const list = [' GAMING ', 'gaming', 'GAMING', 'WORKSTATION'];
  const inputs = buildGpuInputs({
    candidatePoolResult: poolResult([makeCandidate('CPU', U(1))]),
    filteringContext: { candidates: { CPU: [] }, specs: {} },
    scoringModel: scoringModel(list),
  });

  assert.deepEqual(inputs.gpu_required_use_cases, list);
  assert.notStrictEqual(inputs.gpu_required_use_cases, list, 'must be a fresh copy');
  // Nothing was trimmed, folded or deduplicated...
  assert.equal(inputs.gpu_required_use_cases[0], ' GAMING ');
  assert.equal(inputs.gpu_required_use_cases.length, 4);
  // ...and Step 1 accepts the verbatim copy.
  assert.doesNotThrow(() => validateEngine3Input(engine3InputFrom(inputs)));
  // The caller-owned list is untouched.
  assert.deepEqual(list, [' GAMING ', 'gaming', 'GAMING', 'WORKSTATION']);
});

test('an empty gpu_required_use_cases stays empty - never defaulted', () => {
  const inputs = buildGpuInputs({
    candidatePoolResult: poolResult([makeCandidate('CPU', U(1))]),
    filteringContext: { candidates: { CPU: [] }, specs: {} },
    scoringModel: scoringModel([]),
  });
  assert.deepEqual(inputs.gpu_required_use_cases, []);
  assert.ok(Object.isFrozen(inputs.gpu_required_use_cases));
});

test('entry-level rules stay Step 1 ownership, not duplicated by the loader', () => {
  // The loader is structural-only: it neither rejects nor repairs entries.
  for (const bad of ['', 42, null]) {
    const inputs = buildGpuInputs({
      candidatePoolResult: poolResult([makeCandidate('CPU', U(1))]),
      filteringContext: { candidates: { CPU: [] }, specs: {} },
      scoringModel: scoringModel([bad]),
    });
    assert.deepEqual(inputs.gpu_required_use_cases, [bad]);

    // Step 1 (validateEngine3Input) is where it must fail, with the exact path.
    assert.throws(
      () => validateEngine3Input(engine3InputFrom(inputs)),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'gpu_required_use_cases'),
      'expected Step 1 to reject entry ' + String(bad)
    );
  }
});

// ---------------------------------------------------------------------------
// 5. Determinism and immutability.
// ---------------------------------------------------------------------------

test('determinism: identical sources yield deeply equal frozen outputs', async () => {
  const context = await contextWithCpuSpecRows(threeStateCpuRows());
  const sources = {
    candidatePoolResult: poolResult([makeCandidate('CPU', U(1)), makeCandidate('CPU', U(2))]),
    filteringContext: context,
    scoringModel: scoringModel(['GAMING', 'WORKSTATION']),
  };

  const first = buildGpuInputs(sources);
  const second = buildGpuInputs(sources);
  assert.deepEqual(second, first);
  assert.deepEqual(
    JSON.parse(JSON.stringify(second)),
    JSON.parse(JSON.stringify(first))
  );
});

test('caller-owned sources are neither mutated nor frozen', async () => {
  const context = await contextWithCpuSpecRows(threeStateCpuRows());
  const pool = poolResult([makeCandidate('CPU', U(1))], { use_case: 'office' });
  const model = scoringModel(['GAMING']);
  const list = model.configuration.gpu_required_use_cases;
  const before = {
    pool: structuredClone(pool),
    model: structuredClone(model),
  };

  const inputs = buildGpuInputs({
    candidatePoolResult: pool,
    filteringContext: context,
    scoringModel: model,
  });

  assert.deepEqual(structuredClone(pool), before.pool);
  assert.deepEqual(structuredClone(model), before.model);

  for (const target of [pool, pool.input, model, model.configuration, list]) {
    assert.equal(Object.isFrozen(target), false, 'caller-owned data must stay unfrozen');
  }
  // The emitted structures are frozen and detached from the caller's array.
  assert.ok(Object.isFrozen(inputs));
  assert.ok(Object.isFrozen(inputs.gpu_required_use_cases));
  assert.ok(Object.isFrozen(inputs.integrated_gpu_present));
  assert.notStrictEqual(inputs.gpu_required_use_cases, list);
});

// ---------------------------------------------------------------------------
// 6. Fail-fast validation (existing error vocabulary, exact fields).
// ---------------------------------------------------------------------------

test('rejects a missing or non-object sources argument', () => {
  for (const bad of [undefined, null]) {
    assert.throws(
      () => buildGpuInputs(bad),
      expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, null),
      'expected MISSING_REQUIRED_FIELD for ' + String(bad)
    );
  }
  for (const bad of ['sources', 42, true, []]) {
    assert.throws(
      () => buildGpuInputs(bad),
      expectError(ERROR_CODES.INVALID_INPUT, null),
      'expected INVALID_INPUT for ' + String(bad)
    );
  }
});

test('rejects a missing or malformed candidatePoolResult', () => {
  const base = {
    filteringContext: { candidates: { CPU: [] }, specs: {} },
    scoringModel: scoringModel(['GAMING']),
  };
  assert.throws(
    () => buildGpuInputs({ ...base }),
    expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, 'candidatePoolResult')
  );
  assert.throws(
    () => buildGpuInputs({ ...base, candidatePoolResult: 'pool' }),
    expectError(ERROR_CODES.INVALID_INPUT, 'candidatePoolResult')
  );
  assert.throws(
    () => buildGpuInputs({ ...base, candidatePoolResult: { pool: [] } }),
    expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, 'candidatePoolResult.input')
  );
  // The Engine 2A contract owns the selection-input rules themselves.
  assert.throws(
    () => buildGpuInputs({ ...base, candidatePoolResult: { input: {}, pool: [] } }),
    expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, 'budget_amount')
  );
});

test('rejects a missing or malformed scoring model', () => {
  const base = {
    candidatePoolResult: poolResult([makeCandidate('CPU', U(1))]),
    filteringContext: { candidates: { CPU: [] }, specs: {} },
  };
  assert.throws(
    () => buildGpuInputs({ ...base }),
    expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, 'scoringModel')
  );
  assert.throws(
    () => buildGpuInputs({ ...base, scoringModel: 'model' }),
    expectError(ERROR_CODES.INVALID_INPUT, 'scoringModel')
  );

  for (const bad of [undefined, null]) {
    assert.throws(
      () => buildGpuInputs({ ...base, scoringModel: { configuration: bad } }),
      expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, 'scoring_model.configuration'),
      'expected MISSING_REQUIRED_FIELD for configuration=' + String(bad)
    );
  }
  for (const bad of ['config', 42, ['config']]) {
    assert.throws(
      () => buildGpuInputs({ ...base, scoringModel: { configuration: bad } }),
      expectError(ERROR_CODES.INVALID_INPUT, 'scoring_model.configuration'),
      'expected INVALID_INPUT for configuration=' + String(bad)
    );
  }

  const path = 'scoring_model.configuration.gpu_required_use_cases';
  for (const bad of [undefined, null]) {
    assert.throws(
      () => buildGpuInputs({ ...base, scoringModel: { configuration: { gpu_required_use_cases: bad } } }),
      expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, path),
      'expected MISSING_REQUIRED_FIELD for ' + String(bad)
    );
  }
  for (const bad of ['GAMING', 42, {}]) {
    assert.throws(
      () => buildGpuInputs({ ...base, scoringModel: { configuration: { gpu_required_use_cases: bad } } }),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, path),
      'expected INVALID_FIELD_VALUE for ' + String(bad)
    );
  }
});

test('rejects a missing or malformed filtering context', () => {
  const base = {
    candidatePoolResult: poolResult([makeCandidate('CPU', U(1))]),
    scoringModel: scoringModel(['GAMING']),
  };
  assert.throws(
    () => buildGpuInputs({ ...base }),
    expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, 'filteringContext')
  );
  // The Decision 11 handoff owns the context shape check (field 'context').
  assert.throws(
    () => buildGpuInputs({ ...base, filteringContext: 'context' }),
    expectError(ERROR_CODES.INVALID_INPUT, 'context')
  );
  assert.throws(
    () => buildGpuInputs({ ...base, filteringContext: { specs: {} } }),
    expectError(ERROR_CODES.INVALID_INPUT, 'context')
  );
});

// ---------------------------------------------------------------------------
// 7. Source boundary and public surface.
// ---------------------------------------------------------------------------

const GPU_INPUT_SOURCE = fs.readFileSync(path.join(__dirname, 'gpu-input.js'), 'utf8');

test('gpu-input.js keeps its source boundary (pure, DB-free, no duplicated steps)', () => {
  const forbidden = [
    'new Pool',
    '.query(',
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'store_offer',
    'priceKey',
    'validateEngine3Input',
    'assembleBuilds',
    'Math.random',
    'Date.now',
    'async',
    'await',
    "require('../scoring",
  ];
  for (const needle of forbidden) {
    assert.equal(GPU_INPUT_SOURCE.includes(needle), false, `must not contain ${needle}`);
  }
  assert.equal(/require\(['"]pg['"]\)/.test(GPU_INPUT_SOURCE), false, 'must not contain pg require');
  assert.equal(/\bscore\b/i.test(GPU_INPUT_SOURCE), false, 'must not contain score');
  assert.equal(/\brank\b/i.test(GPU_INPUT_SOURCE), false, 'must not contain rank');
});

test('gpu-input.js uses only the three allowed engine requires', () => {
  const requires = [...GPU_INPUT_SOURCE.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(requires, [
    '../candidates/input',
    '../candidates/errors',
    '../filtering/igpu-map',
  ]);
  assert.equal(GPU_INPUT_SOURCE.includes('module.exports = { buildGpuInputs };'), true);
});

test('public surface is exactly buildGpuInputs, in one export object', () => {
  const api = require('./gpu-input');
  assert.deepEqual(Object.keys(api), ['buildGpuInputs']);
  assert.equal(typeof buildGpuInputs, 'function');
  assert.equal(buildGpuInputs.length, 1);
});