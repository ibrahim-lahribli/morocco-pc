'use strict';

// ---------------------------------------------------------------------------
// Decision 11 (iGPU sourcing, resolved 2026-09-17): contract tests for the
// Engine 2D -> Engine 3 integrated_gpu_present handoff.
//
// Scope: exactly the four resolved cases (true / false / DB NULL / missing
// cpu_spec row), the no-undefined guarantee, determinism, immutability,
// fail-fast validation, and the no-additional-DB-query discipline. The GPU
// policy pairing uses the existing Engine 3 resolveGpuRequirement() to prove
// the downstream outcomes WITHOUT modifying the policy.
//
// Pure tests: no real database, no .env, no destructive commands.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildIntegratedGpuPresentMap } = require('./igpu-map');
const { loadFilteringContext } = require('./context-loader');
const { resolveGpuRequirement } = require('../assembly/gpu-policy');
const { ROLE_CATEGORIES } = require('../candidates/roles');
const { createCandidate } = require('../candidates');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

// ---------------------------------------------------------------------------
// Fake database: same routing/scoping approach as context-loader.test.js.
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
  return rows.filter((row) =>
    Object.values(row).some((value) => ids.has(value))
  );
}

function createDb(routes, { record = null } = {}) {
  const route = bySql(routes);
  return {
    async query(sql, params) {
      if (record) record.push({ sql, params });
      return { rows: scopeRowsByParams(route(sql, params), params) };
    },
  };
}

// Deterministic id helpers (hex, lexicographically orderable).
const U = (n) => 'uuuuuuuu-uuuu-uuuu-uuuu-' + String(n).padStart(12, '0');
const P = (n) => 'pppppppp-pppp-pppp-pppp-' + String(n).padStart(12, '0');

// ---------------------------------------------------------------------------
// Fixture helpers.
// ---------------------------------------------------------------------------

function makeCandidate(role, productId, variantId = null) {
  return createCandidate({
    component_role: role,
    category: ROLE_CATEGORIES[role],
    product_id: productId,
    product_variant_id: variantId,
  });
}

function poolResult(pool) {
  return {
    input: {
      budget_amount: 100000,
      currency: 'EUR',
      use_case: 'office',
      required_roles: [...new Set(pool.map((c) => c.component_role))],
    },
    pool,
  };
}

function emptyRoutes() {
  return {
    CPU: [], MOTHERBOARD: [], RAM: [], COOLER: [],
    CASE: [], PSU: [], GPU: [], CPU_MB: [],
    COOLER_SOCKET: [], CASE_FF: [], CASE_RAD: [],
    PLATFORM: [], PLATFORM_MEM: [],
  };
}

/**
 * Minimal two-CPU pool. The context only needs the CPU side populated for
 * the iGPU handoff; every other role stays empty.
 */
async function contextWithCpuSpecRows(cpuRows) {
  const pool = [makeCandidate('CPU', U(1)), makeCandidate('CPU', U(2))];
  const routes = emptyRoutes();
  routes.CPU = cpuRows;
  const db = createDb(routes);
  const context = await loadFilteringContext(poolResult(pool), db);
  return { context, pool };
}

/** Prove every map value is exactly true, false or null (never undefined). */
function assertOnlyTrueFalseNull(map, message) {
  for (const key of Object.keys(map)) {
    const value = map[key];
    assert.ok(
      value === true || value === false || value === null,
      message + ' (key ' + key + ' got ' + String(value) + ')'
    );
  }
}

// ---------------------------------------------------------------------------
// The four resolved contract cases.
// ---------------------------------------------------------------------------

test('case 1: integrated_gpu_present = true -> map true, GPU OPTIONAL', async () => {
  const { context } = await contextWithCpuSpecRows([
    { product_id: U(1), socket_id: P(1), product_family_id: null, integrated_gpu_present: true },
    { product_id: U(2), socket_id: P(1), product_family_id: null, integrated_gpu_present: false },
  ]);
  const map = buildIntegratedGpuPresentMap(context);

  assert.equal(map[U(1)], true);
  assertOnlyTrueFalseNull(map, 'case 1');

  // GPU policy pairing: use case NOT in the required list -> OPTIONAL.
  assert.equal(
    resolveGpuRequirement({
      use_case: 'office',
      gpu_required_use_cases: ['gaming'],
      integrated_gpu_present: map,
      selectedCpuProductId: U(1),
    }),
    'OPTIONAL'
  );
});

test('case 2: integrated_gpu_present = false -> map false, GPU REQUIRED', async () => {
  const { context } = await contextWithCpuSpecRows([
    { product_id: U(1), socket_id: P(1), product_family_id: null, integrated_gpu_present: true },
    { product_id: U(2), socket_id: P(1), product_family_id: null, integrated_gpu_present: false },
  ]);
  const map = buildIntegratedGpuPresentMap(context);

  assert.equal(map[U(2)], false);
  assertOnlyTrueFalseNull(map, 'case 2');

  assert.equal(
    resolveGpuRequirement({
      use_case: 'office',
      gpu_required_use_cases: ['gaming'],
      integrated_gpu_present: map,
      selectedCpuProductId: U(2),
    }),
    'REQUIRED'
  );
});

test('case 3: integrated_gpu_present = NULL (DB null) -> map null, GPU REQUIRED', async () => {
  const { context } = await contextWithCpuSpecRows([
    { product_id: U(1), socket_id: P(1), product_family_id: null, integrated_gpu_present: null },
  ]);
  const map = buildIntegratedGpuPresentMap(context);

  assert.equal(map[U(1)], null);
  assertOnlyTrueFalseNull(map, 'case 3');

  assert.equal(
    resolveGpuRequirement({
      use_case: 'office',
      gpu_required_use_cases: ['gaming'],
      integrated_gpu_present: map,
      selectedCpuProductId: U(1),
    }),
    'REQUIRED'
  );
});

test('case 4: no cpu_spec row -> map null (never undefined), GPU REQUIRED', async () => {
  // Empty CPU route: candidates exist, no cpu_spec rows returned.
  const { context } = await contextWithCpuSpecRows([]);
  const map = buildIntegratedGpuPresentMap(context);

  // Both candidates must be present with the EXPLICIT value null.
  assert.equal(Object.prototype.hasOwnProperty.call(map, U(1)), true);
  assert.equal(Object.prototype.hasOwnProperty.call(map, U(2)), true);
  assert.equal(map[U(1)], null);
  assert.equal(map[U(2)], null);
  assertOnlyTrueFalseNull(map, 'case 4');

  assert.equal(
    resolveGpuRequirement({
      use_case: 'office',
      gpu_required_use_cases: ['gaming'],
      integrated_gpu_present: map,
      selectedCpuProductId: U(1),
    }),
    'REQUIRED'
  );
});

// ---------------------------------------------------------------------------
// Guarantees around the contract.
// ---------------------------------------------------------------------------

test('the map carries every CPU candidate and no undefined values', async () => {
  // One true, one false, one null, one missing row: mixed in one pool.
  const pool = [
    makeCandidate('CPU', U(1)),
    makeCandidate('CPU', U(2)),
    makeCandidate('CPU', U(3)),
    makeCandidate('CPU', U(4)),
  ];
  const routes = emptyRoutes();
  routes.CPU = [
    { product_id: U(2), socket_id: P(1), product_family_id: null, integrated_gpu_present: false },
    { product_id: U(3), socket_id: P(1), product_family_id: null, integrated_gpu_present: null },
    { product_id: U(1), socket_id: P(1), product_family_id: null, integrated_gpu_present: true },
    // U(4): no cpu_spec row.
  ];
  const context = await loadFilteringContext(poolResult(pool), createDb(routes));
  const map = buildIntegratedGpuPresentMap(context);

  assert.equal(Object.keys(map).length, 4);
  assert.equal(map[U(1)], true);
  assert.equal(map[U(2)], false);
  assert.equal(map[U(3)], null);
  assert.equal(map[U(4)], null);
  assertOnlyTrueFalseNull(map, 'mixed pool');
});

test('strict pass-through: no truthiness conversion, no defaults, no coercion', () => {
  // Feed an unexpected non-boolean value through the same normalization the
  // context guarantees: anything not exactly true/false must become null.
  const context = {
    candidates: { CPU: [makeCandidate('CPU', U(1))] },
    specs: { ['p:' + U(1)]: { integrated_gpu_present: 1 } },
  };
  const map = buildIntegratedGpuPresentMap(context);
  assert.equal(map[U(1)], null);
  assertOnlyTrueFalseNull(map, 'coercion guard');
});

test('candidate ordering is preserved (Engine 2C pool order, not reordered)', async () => {
  const pool = [
    makeCandidate('CPU', U(3)),
    makeCandidate('CPU', U(1)),
    makeCandidate('CPU', U(2)),
  ];
  const routes = emptyRoutes();
  routes.CPU = [
    { product_id: U(1), socket_id: P(1), product_family_id: null, integrated_gpu_present: true },
    { product_id: U(2), socket_id: P(1), product_family_id: null, integrated_gpu_present: false },
    { product_id: U(3), socket_id: P(1), product_family_id: null, integrated_gpu_present: null },
  ];
  const context = await loadFilteringContext(poolResult(pool), createDb(routes));
  const map = buildIntegratedGpuPresentMap(context);

  // Keys follow the candidate bucket order (U(3), U(1), U(2)) because the
  // pool is walked in preserved order. The handoff is deterministic and
  // never re-sorts candidate order.
  assert.deepEqual(Object.keys(map), [U(3), U(1), U(2)]);
  assert.equal(map[U(3)], null);
  assert.equal(map[U(1)], true);
  assert.equal(map[U(2)], false);
});

test('determinism: the same context always yields an identical map', async () => {
  const { context } = await contextWithCpuSpecRows([
    { product_id: U(1), socket_id: P(1), product_family_id: null, integrated_gpu_present: true },
    { product_id: U(2), socket_id: P(1), product_family_id: null, integrated_gpu_present: false },
  ]);
  const a = buildIntegratedGpuPresentMap(context);
  const b = buildIntegratedGpuPresentMap(context);
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a), Object.keys(b));
});

test('the returned map is frozen and the context is never mutated', async () => {
  const { context } = await contextWithCpuSpecRows([
    { product_id: U(1), socket_id: P(1), product_family_id: null, integrated_gpu_present: true },
  ]);
  const specsSnapshot = JSON.parse(JSON.stringify(context.specs));
  const map = buildIntegratedGpuPresentMap(context);

  assert.ok(Object.isFrozen(map));
  assert.throws(() => { 'use strict'; map['new-cpu'] = false; }, TypeError);
  assert.throws(() => { 'use strict'; delete map[U(1)]; }, TypeError);
  assert.deepEqual(JSON.parse(JSON.stringify(context.specs)), specsSnapshot);
});

test('no additional DB query is introduced: the helper is pure over the context', async () => {
  const { context } = await contextWithCpuSpecRows([
    { product_id: U(1), socket_id: P(1), product_family_id: null, integrated_gpu_present: true },
  ]);

  // The helper accepts only the context: it holds no db client and issues no
  // queries. A poisoned query() client proves no database access path exists.
  const poisoned = {
    calls: [],
    query(sql, params) {
      this.calls.push({ sql, params });
      throw new Error('iGPU handoff must never query the database');
    },
  };
  // Sanity: the poisoned client really does throw when used.
  assert.throws(() => poisoned.query('SELECT 1'), /must never query/);
  assert.equal(poisoned.calls.length, 1);

  const map = buildIntegratedGpuPresentMap(context);
  assert.equal(map[U(1)], true);
  assert.equal(poisoned.calls.length, 1); // unchanged: helper touched no client

  // Source-level guarantee: no SQL / async / query surface in the module.
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, 'igpu-map.js'), 'utf8');
  assert.equal(source.includes('.query('), false);
  assert.equal(source.includes('SELECT '), false);
  assert.equal(source.includes('FROM '), false);
  assert.equal(source.includes('async '), false);
  assert.equal(source.includes('await '), false);
  const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(requires, ['../candidates/errors']);
});

test('malformed contexts fail fast with CandidateSelectionError', () => {
  for (const bad of [null, undefined, 42, 'context', [], { candidates: {}, specs: {} }]) {
    assert.throws(
      () => buildIntegratedGpuPresentMap(bad),
      (error) =>
        error instanceof CandidateSelectionError &&
        error.name === 'CandidateSelectionError' &&
        error.code === ERROR_CODES.INVALID_INPUT,
      'expected CandidateSelectionError for ' + JSON.stringify(bad)
    );
  }
});

test('the barrel re-exports the handoff without wrappers', () => {
  const barrel = require('./index');
  assert.equal(barrel.buildIntegratedGpuPresentMap, buildIntegratedGpuPresentMap);
});


