'use strict';

// ---------------------------------------------------------------------------
// Engine 2D B2-F: integration test for the real B2-B -> B2-D boundary.
//
// This file proves ONLY that the output of the real context loader
// (loadFilteringContext) is accepted unchanged by the real filter
// (filterCandidates): no adapter, no normalization, no mutation, no manually
// added fields between the two calls. It deliberately does NOT duplicate the
// B2-B loader unit tests (context-loader.test.js), the B2-D filter unit tests
// (filter.test.js) or the Engine 1 resolver tests; compatibility verdicts are
// exercised only as far as the boundary integration requires.
//
// The database is a small deterministic fake matching the context-loader test
// approach: SQL is routed by table-name marker and rows are scoped exactly
// like a parameterized `= ANY($1::uuid[])` query.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadFilteringContext } = require('./context-loader');
const { filterCandidates, CANDIDATE_STATUSES } = require('./filter');
const { COMPONENT_ROLES, ROLE_CATEGORIES } = require('../candidates/roles');
const { createCandidate } = require('../candidates');
const { FINAL_STATUSES, REASON_CODES } = require('../compatibility');

// ---------------------------------------------------------------------------
// Fake database (same approach as context-loader.test.js).
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
 * canned rows by any property whose value is a member of the id list (covers
 * the owner columns: product_id, motherboard_product_id, cooler_product_id,
 * case_product_id, socket_id, platform_id, product_variant_id). Rows outside
 * the id list must never surface, exactly like `= ANY($1::uuid[])`.
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
// Fixture: one small hardware universe with three deliberately mixed verdicts.
//
//   CPU U(1)  socket P(1) -> every applicable relationship resolvable and
//                            compatible                                 PASS
//   CPU U(11) socket P(3) -> TWO platform rows for P(3) (ambiguous), so the
//                            platform stays unresolved -> platform_memory
//                            UNKNOWN while socket/cooler checks pass    UNKNOWN
//   MB  U(2)  socket P(1) -> exact support for CPU U(1)                  PASS
//   MB  U(12) socket P(2) -> definite socket mismatch with both CPUs     REJECT
//   MB  U(13) socket P(3) -> exact support for CPU U(11)                 PASS
//
// Everything numeric is comfortably inside its limit so the PASS candidates
// are decided by genuinely evaluated relationships, not by absent data.
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
 * role order to prove the pipeline re-orders output canonically while
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

/** The real boundary under test, executed exactly as Engine 2D wires it. */
async function runPipeline(aPool = pool(), aRoutes = routes()) {
  const db = createDb(aRoutes);
  const context = await loadFilteringContext(poolResult(aPool), db);
  const filtered = filterCandidates(context);
  return { context, filtered };
}

function findResult(filtered, role, productId) {
  return filtered.results.find(
    (entry) => entry.component_role === role && entry.product_id === productId
  );
}

/** Recursively assert every object/array reachable from `value` is frozen. */
function assertDeeplyFrozen(value, path) {
  if (value === null || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value), 'not frozen: ' + path);
  for (const key of Object.keys(value)) {
    assertDeeplyFrozen(value[key], path + '.' + key);
  }
}

// ---------------------------------------------------------------------------
// 1. PASS - the real loaded context makes every applicable relationship pass.
// ---------------------------------------------------------------------------

test('integration: fully compatible candidate gets PASS through the real pipeline', async () => {
  const { filtered } = await runPipeline();
  const cpu = findResult(filtered, 'CPU', CPU_ID);

  assert.equal(cpu.status, CANDIDATE_STATUSES.PASS);
  assert.equal(cpu.reason, null);
  // Every applicable CPU relationship was actually resolved and passed.
  assert.deepEqual(cpu.relationships, {
    cpu_motherboard: FINAL_STATUSES.PASS,
    cooler_socket: FINAL_STATUSES.PASS,
    platform_memory: FINAL_STATUSES.PASS,
  });

  // The rest of the compatible combination passes as well (the SSD takes
  // part in no relationship and is vacuously PASS).
  for (const [role, productId] of [
    ['MOTHERBOARD', MB_ID],
    ['MOTHERBOARD', AMBIGUOUS_MB_ID],
    ['RAM', RAM_ID],
    ['GPU', GPU_ID],
    ['PSU', PSU_ID],
    ['CPU_COOLER', COOLER_ID],
    ['CASE', CASE_ID],
    ['SSD_BOOT', SSD_ID],
  ]) {
    const entry = findResult(filtered, role, productId);
    assert.equal(entry.status, CANDIDATE_STATUSES.PASS, role + ' ' + productId);
  }
});

// ---------------------------------------------------------------------------
// 2. REJECT - one definite incompatibility, evaluated on real loaded context
//    (not on malformed or missing data).
// ---------------------------------------------------------------------------

test('integration: incompatible CPU<->motherboard socket yields REJECT', async () => {
  const { context, filtered } = await runPipeline();

  // The context really carries the two distinct loaded sockets - the REJECT
  // below is a genuine evaluated mismatch, never a missing-context artifact.
  assert.equal(context.specs['p:' + CPU_ID].socket_id, COMPATIBLE_SOCKET_ID);
  assert.equal(context.specs['p:' + MISMATCHED_MB_ID].socket_id, MISMATCHED_SOCKET_ID);

  const mismatchedMotherboard = findResult(filtered, 'MOTHERBOARD', MISMATCHED_MB_ID);
  assert.equal(mismatchedMotherboard.status, CANDIDATE_STATUSES.REJECT);
  assert.equal(mismatchedMotherboard.relationships.cpu_motherboard, FINAL_STATUSES.FAIL);
  assert.equal(mismatchedMotherboard.reason, REASON_CODES.CPU_SOCKET_MISMATCH);

  // Best-of across partners: the good CPU still passes via its MB U(2) pair,
  // so the board above is rejected by the same evaluated socket mismatch.
  const cpu = findResult(filtered, 'CPU', CPU_ID);
  assert.equal(cpu.status, CANDIDATE_STATUSES.PASS);
  assert.equal(cpu.relationships.cpu_motherboard, FINAL_STATUSES.PASS);
});

// ---------------------------------------------------------------------------
// 3. UNKNOWN - ambiguous platform: compatibility cannot be determined.
// ---------------------------------------------------------------------------

test('integration: ambiguous platform yields UNKNOWN (never FAIL)', async () => {
  const { context, filtered } = await runPipeline();

  // The loader mapped only the unambiguous socket; the ambiguous socket has
  // no mapping, which downstream logic reads as UNKNOWN-compatible absence.
  assert.ok(COMPATIBLE_SOCKET_ID in context.platform_by_socket);
  assert.equal(AMBIGUOUS_SOCKET_ID in context.platform_by_socket, false);

  const ambiguousCpu = findResult(filtered, 'CPU', AMBIGUOUS_CPU_ID);
  assert.equal(ambiguousCpu.status, CANDIDATE_STATUSES.UNKNOWN);
  // Socket-level and cooler relationships really evaluated and passed; only
  // the platform-derived memory support cannot be determined.
  assert.equal(ambiguousCpu.relationships.cpu_motherboard, FINAL_STATUSES.PASS);
  assert.equal(ambiguousCpu.relationships.cooler_socket, FINAL_STATUSES.PASS);
  assert.equal(ambiguousCpu.relationships.platform_memory, FINAL_STATUSES.UNKNOWN);
  assert.equal(ambiguousCpu.reason, REASON_CODES.PLATFORM_MEMORY_SUPPORT_UNKNOWN);
});

// ---------------------------------------------------------------------------
// 4. Identity and ordering - the Engine 2C identity and the canonical
//    ordering survive the whole pipeline.
// ---------------------------------------------------------------------------

test('integration: results preserve identity, canonical role order and bucket order', async () => {
  const aPool = pool();
  const { filtered } = await runPipeline(aPool);

  assert.equal(filtered.results.length, aPool.length);

  // Canonical role order, and within each role the Engine 2C pool order.
  const expectedOrder = [];
  for (const role of COMPONENT_ROLES) {
    for (const candidate of aPool.filter((c) => c.component_role === role)) {
      expectedOrder.push([role, candidate.product_id]);
    }
  }
  assert.deepEqual(
    filtered.results.map((entry) => [entry.component_role, entry.product_id]),
    expectedOrder
  );

  // Every result record preserves the exact Engine 2C candidate identity.
  const poolByIdentity = new Map(
    aPool.map((c) => [c.product_id + '|' + c.product_variant_id, c])
  );
  for (const entry of filtered.results) {
    const source = poolByIdentity.get(entry.product_id + '|' + entry.product_variant_id);
    assert.ok(source, 'result without pool candidate: ' + entry.product_id);
    assert.deepEqual(
      {
        product_id: entry.product_id,
        product_variant_id: entry.product_variant_id,
        category: entry.category,
        component_role: entry.component_role,
      },
      {
        product_id: source.product_id,
        product_variant_id: source.product_variant_id,
        category: source.category,
        component_role: source.component_role,
      }
    );
  }
});

// ---------------------------------------------------------------------------
// 5. Direct boundary - the loader output feeds the filter with NOTHING in
//    between: no adapter, no normalization, no mutation, no added fields.
// ---------------------------------------------------------------------------

test('integration: filterCandidates accepts loadFilteringContext output directly', async () => {
  const aPool = pool();

  // The single expression under test - the exact Engine 2D boundary.
  const filtered = filterCandidates(
    await loadFilteringContext(poolResult(aPool), createDb(routes()))
  );

  // It behaves identically to the explicit two-step invocation.
  const context = await loadFilteringContext(poolResult(aPool), createDb(routes()));
  const stepped = filterCandidates(context);
  assert.deepEqual(filtered, stepped);

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
});

// ---------------------------------------------------------------------------
// 6. Immutability - the context is deeply frozen and unchanged by filtering.
// ---------------------------------------------------------------------------

test('integration: context stays deeply frozen and unchanged after filtering', async () => {
  const { context, filtered } = await runPipeline();
  const snapshot = structuredClone(context);

  assertDeeplyFrozen(context, 'context');

  // Deep equality with the pre-call snapshot: filterCandidates only read.
  assert.deepEqual(context, snapshot);

  // Frozen in practice: mutations throw in strict mode.
  assert.throws(() => { 'use strict'; context.newKey = 1; }, TypeError);
  assert.throws(() => { 'use strict'; context.specs['p:' + CPU_ID].socket_id = 'x'; }, TypeError);

  // The results are frozen records too.
  assert.ok(Object.isFrozen(filtered));
  assert.ok(Object.isFrozen(filtered.results));
  for (const entry of filtered.results) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.relationships));
  }
});