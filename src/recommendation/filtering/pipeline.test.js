'use strict';

// ---------------------------------------------------------------------------
// Engine 2D B2-G: focused orchestration tests for the filtering-stage entry
// point (filterCandidatesForRecommendation).
//
// This file proves ONLY that the entry point composes the two real, already
// validated stages (loadFilteringContext -> filterCandidates) and returns
// their result unchanged: no re-testing of loader internals, filter verdict
// rules or resolver behavior (see context-loader.test.js, filter.test.js and
// integration.test.js) - none of those cases are duplicated here.
//
// The database is the same small deterministic fake used by the integration
// test: SQL is routed by table-name marker and rows are scoped exactly like
// a parameterized `= ANY($1::uuid[])` statement.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const pipeline = require('./pipeline');
const { filterCandidatesForRecommendation } = pipeline;
const { loadFilteringContext } = require('./context-loader');
const { filterCandidates, CANDIDATE_STATUSES } = require('./filter');
const { ROLE_CATEGORIES } = require('../candidates/roles');
const { createCandidate } = require('../candidates');
const { FINAL_STATUSES, REASON_CODES } = require('../compatibility');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

// ---------------------------------------------------------------------------
// Fake database (same approach as integration.test.js).
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
  // Longest marker first: 'FROM platform_memory_support' must win over
  // 'FROM platform' (substring collision).
  const entries = Object.entries(routes)
    .map(([key, rows]) => ({ key, rows, marker: SQL[key] }))
    .sort((a, b) => b.marker.length - a.marker.length);
  return (sql) => {
    for (const entry of entries) {
      if (sql.includes(entry.marker)) return entry.rows;
    }
    throw new Error('unexpected query: ' + sql);
  };
}

/**
 * Emulates PostgreSQL parameter scoping: every id-array parameter filters the
 * canned rows by any property whose value is a member of the id list. Rows
 * outside the id list must never surface, exactly like `= ANY($1::uuid[])`.
 */
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

// Deterministic id helpers (hex, lexicographically orderable).
const U = (n) => 'uuuuuuuu-uuuu-uuuu-uuuu-' + String(n).padStart(12, '0');
const V = (n) => 'vvvvvvvv-vvvv-vvvv-vvvv-' + String(n).padStart(12, '0');
// Socket ids share the P() id space with platform ids (as in the B2-B tests).
const P = (n) => 'pppppppp-pppp-pppp-pppp-' + String(n).padStart(12, '0');

// ---------------------------------------------------------------------------
// Fixture: one small hardware universe with three deliberately mixed verdicts
// (same engineering as integration.test.js).
//
//   CPU U(1)  socket P(1) -> every applicable relationship resolvable   PASS
//   CPU U(11) socket P(3) -> TWO platform rows for P(3) (ambiguous), so
//                            the platform stays unresolved            UNKNOWN
//   MB  U(2)  socket P(1) -> exact support for CPU U(1)                 PASS
//   MB  U(12) socket P(2) -> definite socket mismatch with both CPUs  REJECT
//   MB  U(13) socket P(3) -> exact support for CPU U(11)                PASS
// ---------------------------------------------------------------------------

const CPU_ID = U(1);
const AMBIGUOUS_CPU_ID = U(11);
const MB_ID = U(2);
const MISMATCHED_MB_ID = U(12);
const AMBIGUOUS_MB_ID = U(13);
const RAM_ID = U(3);
const GPU_ID = U(4);
const PSU_ID = U(5);
const COOLER_ID = U(6);
const CASE_ID = U(7);
const SSD_ID = U(8);

const GPU_VARIANT_ID = V(1);

const COMPATIBLE_SOCKET_ID = P(1);   // CPU U(1) <-> MB U(2) <-> cooler U(6)
const MISMATCHED_SOCKET_ID = P(2);   // MB U(12): the definite incompatibility
const AMBIGUOUS_SOCKET_ID = P(3);    // CPU U(11) / MB U(13): ambiguous platform
const COMPATIBLE_PLATFORM_ID = P(1); // the single unambiguous platform row
const FAMILY_ID = P(10);
const MEMORY_TYPE_ID = P(20);

function makeCandidate(role, productId, variantId = null) {
  return createCandidate({
    component_role: role,
    category: ROLE_CATEGORIES[role],
    product_id: productId,
    product_variant_id: variantId,
  });
}

/**
 * The Engine 2C candidate-pool result, listed in deliberately NON-canonical
 * role order; the composed stages re-order the output canonically while
 * preserving candidate order within each role bucket.
 */
function pool() {
  return [
    makeCandidate('CASE', CASE_ID),
    makeCandidate('SSD_BOOT', SSD_ID),
    makeCandidate('MOTHERBOARD', MISMATCHED_MB_ID), // REJECT
    makeCandidate('CPU', CPU_ID),                   // PASS
    makeCandidate('GPU', GPU_ID, GPU_VARIANT_ID),
    makeCandidate('MOTHERBOARD', MB_ID),            // PASS
    makeCandidate('RAM', RAM_ID),
    makeCandidate('CPU_COOLER', COOLER_ID),
    makeCandidate('MOTHERBOARD', AMBIGUOUS_MB_ID),  // PASS
    makeCandidate('PSU', PSU_ID),
    makeCandidate('CPU', AMBIGUOUS_CPU_ID),         // UNKNOWN
  ];
}

function poolResult(aPool) {
  return {
    input: {
      budget_amount: 100000,
      currency: 'EUR',
      use_case: 'gaming',
      required_roles: [...new Set(aPool.map((c) => c.component_role))],
    },
    pool: aPool,
  };
}

function routes() {
  return {
    CPU: [
      { product_id: CPU_ID, socket_id: COMPATIBLE_SOCKET_ID, product_family_id: FAMILY_ID },
      { product_id: AMBIGUOUS_CPU_ID, socket_id: AMBIGUOUS_SOCKET_ID, product_family_id: null },
    ],
    MOTHERBOARD: [
      { product_id: MB_ID, socket_id: COMPATIBLE_SOCKET_ID, form_factor: 'ATX', memory_type_id: MEMORY_TYPE_ID },
      { product_id: MISMATCHED_MB_ID, socket_id: MISMATCHED_SOCKET_ID, form_factor: 'ATX', memory_type_id: MEMORY_TYPE_ID },
      { product_id: AMBIGUOUS_MB_ID, socket_id: AMBIGUOUS_SOCKET_ID, form_factor: 'ATX', memory_type_id: MEMORY_TYPE_ID },
    ],
    RAM: [{ product_id: RAM_ID, memory_type_id: MEMORY_TYPE_ID }],
    COOLER: [{ product_id: COOLER_ID, cooling_type: 'AIR' }],
    CASE: [{ product_id: CASE_ID, max_gpu_length_mm: 360, max_gpu_thickness_slots: 3 }],
    PSU: [{
      product_id: PSU_ID, rated_wattage: 850, connector_24pin_atx: true,
      connector_eps_count: 2, connector_pcie_8pin: 2, connector_12vhpwr: 0, connector_sata: 4,
    }],
    GPU: [{
      product_variant_id: GPU_VARIANT_ID, length_mm: 300, width_slots: '2.50',
      required_power_connectors: { pcie_8pin: 1 }, recommended_psu_watts: 650,
    }],
    CPU_MB: [
      { id: 'cm-1', motherboard_product_id: MB_ID, cpu_product_id: CPU_ID, cpu_product_family_id: null, support_status: 'PASS', min_bios_version: null },
      { id: 'cm-2', motherboard_product_id: AMBIGUOUS_MB_ID, cpu_product_id: AMBIGUOUS_CPU_ID, cpu_product_family_id: null, support_status: 'PASS', min_bios_version: null },
    ],
    COOLER_SOCKET: [
      { id: 'cs-1', cooler_product_id: COOLER_ID, socket_id: COMPATIBLE_SOCKET_ID, support_status: 'PASS' },
      { id: 'cs-2', cooler_product_id: COOLER_ID, socket_id: AMBIGUOUS_SOCKET_ID, support_status: 'PASS' },
    ],
    CASE_FF: [{ id: 'cff-1', case_product_id: CASE_ID, form_factor: 'ATX' }],
    CASE_RAD: [], // the cooler is AIR: the radiator rule is not applicable
    PLATFORM: [
      // Exactly one platform row for the compatible socket...
      { id: COMPATIBLE_PLATFORM_ID, socket_id: COMPATIBLE_SOCKET_ID },
      // ...and TWO rows for the ambiguous socket: no mapping may be produced.
      { id: P(31), socket_id: AMBIGUOUS_SOCKET_ID },
      { id: P(32), socket_id: AMBIGUOUS_SOCKET_ID },
    ],
    PLATFORM_MEM: [{ platform_id: COMPATIBLE_PLATFORM_ID, memory_type_id: MEMORY_TYPE_ID }],
  };
}

function findResult(filtered, role, productId) {
  return filtered.results.find(
    (entry) => entry.component_role === role && entry.product_id === productId
  );
}

// ---------------------------------------------------------------------------
// 1. Happy path - the entry point composes the real loader and the real
//    filter and returns the expected filtered result.
// ---------------------------------------------------------------------------

test('pipeline: composes the real loader and filter into the filtered result', async () => {
  const aPool = pool();
  const filtered = await filterCandidatesForRecommendation(poolResult(aPool), createDb(routes()));

  // The agreed Engine 2D result shape, exactly as filterCandidates produces it.
  assert.ok(Object.isFrozen(filtered));
  assert.ok(Object.isFrozen(filtered.results));
  assert.deepEqual(Object.keys(filtered), ['results']);
  assert.equal(filtered.results.length, aPool.length);

  // One run carries all three verdicts side by side, as designed.
  const statusCounts = {};
  for (const entry of filtered.results) {
    statusCounts[entry.status] = (statusCounts[entry.status] ?? 0) + 1;
  }
  assert.deepEqual(statusCounts, {
    [CANDIDATE_STATUSES.PASS]: 9,
    [CANDIDATE_STATUSES.UNKNOWN]: 1,
    [CANDIDATE_STATUSES.REJECT]: 1,
  });

  // A fully compatible CPU: the complete Engine 2D verdict record.
  assert.deepEqual(findResult(filtered, 'CPU', CPU_ID), {
    product_id: CPU_ID,
    product_variant_id: null,
    category: ROLE_CATEGORIES.CPU,
    component_role: 'CPU',
    status: CANDIDATE_STATUSES.PASS,
    reason: null,
    relationships: {
      cpu_motherboard: FINAL_STATUSES.PASS,
      cooler_socket: FINAL_STATUSES.PASS,
      platform_memory: FINAL_STATUSES.PASS,
    },
    unknown_pairwise_count: 0,
  });
});

// ---------------------------------------------------------------------------
// 2. UNKNOWN propagation - unresolved compatibility stays UNKNOWN.
// ---------------------------------------------------------------------------

test('pipeline: UNKNOWN propagates - unresolved compatibility is never rejected', async () => {
  const filtered = await filterCandidatesForRecommendation(poolResult(pool()), createDb(routes()));
  const ambiguousCpu = findResult(filtered, 'CPU', AMBIGUOUS_CPU_ID);

  assert.equal(ambiguousCpu.status, CANDIDATE_STATUSES.UNKNOWN);
  assert.notEqual(ambiguousCpu.status, CANDIDATE_STATUSES.REJECT);
  assert.notEqual(ambiguousCpu.status, CANDIDATE_STATUSES.PASS);

  // Only the platform-derived memory support is undecidable; the socket and
  // cooler relationships were really evaluated and passed.
  assert.equal(ambiguousCpu.relationships.platform_memory, FINAL_STATUSES.UNKNOWN);
  assert.equal(ambiguousCpu.relationships.cpu_motherboard, FINAL_STATUSES.PASS);
  assert.equal(ambiguousCpu.relationships.cooler_socket, FINAL_STATUSES.PASS);
  assert.equal(ambiguousCpu.reason, REASON_CODES.PLATFORM_MEMORY_SUPPORT_UNKNOWN);
});

// ---------------------------------------------------------------------------
// 3. REJECT propagation - a hard incompatibility rejects the candidate.
// ---------------------------------------------------------------------------

test('pipeline: REJECT propagates - a hard incompatibility rejects the candidate', async () => {
  const filtered = await filterCandidatesForRecommendation(poolResult(pool()), createDb(routes()));
  const mismatchedMotherboard = findResult(filtered, 'MOTHERBOARD', MISMATCHED_MB_ID);

  assert.equal(mismatchedMotherboard.status, CANDIDATE_STATUSES.REJECT);
  assert.equal(mismatchedMotherboard.relationships.cpu_motherboard, FINAL_STATUSES.FAIL);
  assert.equal(mismatchedMotherboard.reason, REASON_CODES.CPU_SOCKET_MISMATCH);

  // REJECT and UNKNOWN stay distinguishable within the very same result.
  const statuses = new Set(filtered.results.map((entry) => entry.status));
  assert.ok(statuses.has(CANDIDATE_STATUSES.REJECT));
  assert.ok(statuses.has(CANDIDATE_STATUSES.UNKNOWN));
  assert.ok(statuses.has(CANDIDATE_STATUSES.PASS));
});

// ---------------------------------------------------------------------------
// 4. Error propagation - loader and database failures reject the call.
// ---------------------------------------------------------------------------

test('pipeline: context-loader and database failures propagate unchanged', async () => {
  // (a) Database access failure: the exact error object surfaces, untranslated.
  const boom = new Error('connection refused');
  boom.code = 'ECONNREFUSED';
  const failingDb = {
    async query() {
      throw boom;
    },
  };
  await assert.rejects(
    filterCandidatesForRecommendation(poolResult(pool()), failingDb),
    (error) => error === boom
  );

  // (b) Candidate-pool validation failure: the Engine 2 contract error
  //     surfaces with its code and offending field intact.
  const invalidPoolResult = poolResult(pool());
  delete invalidPoolResult.pool;
  await assert.rejects(
    filterCandidatesForRecommendation(invalidPoolResult, createDb(routes())),
    (error) =>
      error instanceof CandidateSelectionError &&
      error.code === ERROR_CODES.MISSING_REQUIRED_FIELD &&
      error.field === 'pool'
  );

  // (c) An invalid db dependency fails the same loader validation.
  await assert.rejects(
    filterCandidatesForRecommendation(poolResult(pool()), null),
    (error) =>
      error instanceof CandidateSelectionError &&
      error.code === ERROR_CODES.INVALID_INPUT &&
      error.field === 'db'
  );
});

// ---------------------------------------------------------------------------
// 5. No duplicated logic - the entry point delegates instead of evaluating
//    compatibility itself.
// ---------------------------------------------------------------------------

test('pipeline: delegates - identical to the explicit two-stage composition', async () => {
  const aPool = pool();

  const orchestrated = await filterCandidatesForRecommendation(
    poolResult(aPool), createDb(routes())
  );

  // The same stages composed by hand, independently, with an equivalent db.
  const stepped = filterCandidates(
    await loadFilteringContext(poolResult(aPool), createDb(routes()))
  );

  // Exactly the same verdicts in the same order: nothing was added in
  // between and no compatibility was evaluated by the boundary itself.
  assert.deepEqual(orchestrated, stepped);

  // And no parallel public surface: only the orchestration function is
  // exported (no second verdict vocabulary, no re-implemented aggregation).
  assert.deepEqual(Object.keys(pipeline), ['filterCandidatesForRecommendation']);
});

// ---------------------------------------------------------------------------
// 6. Dependency boundary - no driver, connection pool, direct data access,
//    SQL text or Engine 1 piece anywhere in the orchestration module.
// ---------------------------------------------------------------------------

test('pipeline: dependency boundary - only the two sibling stages are imported', () => {
  const source = fs.readFileSync(require.resolve('./pipeline'), 'utf8');

  // Every require target: exactly the two already-validated stages.
  const requires = [...source.matchAll(/require\((['"])(.+?)\1\)/g)].map((m) => m[2]);
  assert.deepEqual([...requires].sort(), ['./context-loader', './filter']);

  // The orchestration layer owns none of the forbidden concerns: they all
  // belong to the composed stages or to later engines.
  const forbidden = [
    "require('pg')", "require('node:pg')", 'new Pool', '.query(',
    'SELECT ', 'INSERT ', 'UPDATE ', 'DELETE ',
    '../compatibility', '../candidates',
    'FINAL_STATUSES', 'REASON_CODES', 'CANDIDATE_STATUSES',
    'aggregateCompatibility', 'evaluateCandidate',
  ];
  for (const token of forbidden) {
    assert.ok(!source.includes(token), 'forbidden token in pipeline.js: ' + token);
  }
});

// ---------------------------------------------------------------------------
// 7. Determinism - the same candidate-pool input yields the same result.
// ---------------------------------------------------------------------------

test('pipeline: deterministic - the same candidate-pool input yields the same result', async () => {
  const aPool = pool();

  const first = await filterCandidatesForRecommendation(poolResult(aPool), createDb(routes()));
  const second = await filterCandidatesForRecommendation(poolResult(aPool), createDb(routes()));

  assert.deepEqual(second, first);
  // Identical sequence too: same candidates, same order.
  assert.deepEqual(
    second.results.map((entry) => entry.product_id + '|' + entry.product_variant_id),
    first.results.map((entry) => entry.product_id + '|' + entry.product_variant_id)
  );
});




