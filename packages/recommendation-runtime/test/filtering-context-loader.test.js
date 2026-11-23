'use strict';

// packages/recommendation-runtime/test/filtering-context-loader.test.js — the
// Engine 2D filtering-context loader now lives in this package, batch
// `step-5-w1-candidates-filtering`.
//
// What it proves, and why each point is here rather than in the L1 suite that
// stayed at the old path (src/recommendation/filtering/context-loader.test.js):
//   1. the module is loadable from its NEW path and still exports
//      `loadFilteringContext` and the `CONTEXT_COMPAT_KEYS` vocabulary that
//      travels with it (RFC §11.2);
//   2. the old path is the SAME module by identity;
//   3. every statement's SQL text is byte-frozen here — the loader exports no
//      SQL, so the text can only be pinned from outside;
//   4. every statement is bound with exactly ONE parameter: the id array, as
//      `[ids]` for `= ANY($1::uuid[])`. Candidate ids are never interpolated;
//   5. the STATEMENT SEQUENCE is fixed: six spec statements in `COMPONENT_ROLES`
//      order, then the GPU variant statement, then the socket->platform lookup,
//      then the seven compatibility buckets in `CONTEXT_COMPAT_KEYS` order where
//      `cpu_motherboard_exact`/`_family` share one statement. No test pinned
//      that order before this batch;
//   6. a query whose id set is empty is never issued, and a storage-only pool
//      therefore issues no statement at all;
//   7. the returned context keeps its four-key shape and is deeply frozen.
//
// DB-free: the statements are issued against a fake client that records
// (sql, params) and returns fixed rows. No database, no environment, no clock.
//
//   npm run test:runtime        (from the repo root)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadFilteringContext, CONTEXT_COMPAT_KEYS } = require('../src/filtering/context-loader');
const shim = require('../../../src/recommendation/filtering/context-loader');

const INPUT = Object.freeze({
  budget_amount: 8000,
  currency: 'MAD',
  use_case: 'GAMING',
  required_roles: Object.freeze(['CPU', 'GPU', 'MOTHERBOARD', 'RAM', 'PSU', 'CASE', 'CPU_COOLER', 'SSD_BOOT']),
});

const POOL = Object.freeze([
  { product_id: 'p-cpu', product_variant_id: null, category: 'CPU', component_role: 'CPU' },
  { product_id: 'p-gpu', product_variant_id: 'v-gpu', category: 'GPU', component_role: 'GPU' },
  { product_id: 'p-mb', product_variant_id: null, category: 'MOTHERBOARD', component_role: 'MOTHERBOARD' },
  { product_id: 'p-ram', product_variant_id: null, category: 'MEMORY', component_role: 'RAM' },
  { product_id: 'p-psu', product_variant_id: null, category: 'PSU', component_role: 'PSU' },
  { product_id: 'p-case', product_variant_id: null, category: 'CASE', component_role: 'CASE' },
  { product_id: 'p-cool', product_variant_id: null, category: 'COOLER', component_role: 'CPU_COOLER' },
  { product_id: 'p-ssd', product_variant_id: null, category: 'STORAGE', component_role: 'SSD_BOOT' },
]);

// --- the statements, byte-frozen ------------------------------------------

const CPU_SPEC_SQL = `
SELECT cs.product_id, cs.socket_id, p.product_family_id, cs.integrated_gpu_present,
       cs.tdp_watts
  FROM cpu_spec cs
  JOIN product p ON p.id = cs.product_id
 WHERE cs.product_id = ANY($1::uuid[])
 ORDER BY cs.product_id ASC`;

const MOTHERBOARD_SPEC_SQL = `
SELECT product_id, socket_id, form_factor, memory_type_id,
       dimm_slots, max_memory_capacity_gb
  FROM motherboard_spec
 WHERE product_id = ANY($1::uuid[])
 ORDER BY product_id ASC`;

const RAM_SPEC_SQL = `
SELECT product_id, memory_type_id, module_count, capacity_per_module_gb
  FROM ram_spec
 WHERE product_id = ANY($1::uuid[])
 ORDER BY product_id ASC`;

const PSU_SPEC_SQL = `
SELECT product_id, rated_wattage,
       connector_24pin_atx, connector_eps_count, connector_pcie_8pin,
       connector_12vhpwr, connector_sata
  FROM psu_spec
 WHERE product_id = ANY($1::uuid[])
 ORDER BY product_id ASC`;

const CASE_SPEC_SQL = `
SELECT product_id, max_gpu_length_mm, max_gpu_thickness_slots,
       max_cpu_cooler_height_mm
  FROM case_spec
 WHERE product_id = ANY($1::uuid[])
 ORDER BY product_id ASC`;

const COOLER_SPEC_SQL = `
SELECT product_id, cooling_type, radiator_size_mm, height_mm, max_tdp_watts
  FROM cooler_spec
 WHERE product_id = ANY($1::uuid[])
 ORDER BY product_id ASC`;

const GPU_VARIANT_SPEC_SQL = `
SELECT b.product_variant_id, b.board_tgp_watts, b.length_mm, b.width_slots,
       b.required_power_connectors, b.recommended_psu_watts,
       c.vram_capacity_gb
  FROM gpu_board_spec b
  LEFT JOIN gpu_chipset c ON c.id = b.gpu_chipset_id
 WHERE b.product_variant_id = ANY($1::uuid[])
 ORDER BY b.product_variant_id ASC`;

const PLATFORM_BY_SOCKET_SQL = `
SELECT id, socket_id
  FROM platform
 WHERE socket_id = ANY($1::uuid[])
 ORDER BY id ASC`;

const CPU_MOTHERBOARD_SUPPORT_SQL = `
SELECT id, motherboard_product_id, cpu_product_id, cpu_product_family_id,
       support_status, min_bios_version
  FROM cpu_motherboard_support
 WHERE motherboard_product_id = ANY($1::uuid[])
 ORDER BY id ASC`;

const COOLER_SOCKET_SUPPORT_SQL = `
SELECT id, cooler_product_id, socket_id, support_status
  FROM cooler_socket_support
 WHERE cooler_product_id = ANY($1::uuid[])
 ORDER BY id ASC`;

const CASE_FORM_FACTOR_SQL = `
SELECT id, case_product_id, form_factor
  FROM case_motherboard_form_factor
 WHERE case_product_id = ANY($1::uuid[])
 ORDER BY id ASC`;

const CASE_RADIATOR_SUPPORT_SQL = `
SELECT id, case_product_id, radiator_size_mm, position
  FROM case_radiator_support
 WHERE case_product_id = ANY($1::uuid[])
 ORDER BY id ASC`;

const PLATFORM_MEMORY_SUPPORT_SQL = `
SELECT platform_id, memory_type_id, support_status
  FROM platform_memory_support
 WHERE platform_id = ANY($1::uuid[])
 ORDER BY platform_id ASC, memory_type_id ASC`;

const MOTHERBOARD_MEMORY_SUPPORT_SQL = `
SELECT id, motherboard_product_id, memory_type_id, support_status
  FROM motherboard_memory_support
 WHERE motherboard_product_id = ANY($1::uuid[])
 ORDER BY motherboard_product_id ASC, memory_type_id ASC`;

/**
 * Rows keyed by a marker unique to one statement. The markers are matched with
 * `includes`, most-specific first, so `FROM platform` cannot capture
 * `FROM platform_memory_support`.
 */
const ROWS_BY_MARKER = Object.freeze([
  ['FROM cpu_spec cs', [{
    product_id: 'p-cpu', socket_id: 's-1', product_family_id: 'f-1', integrated_gpu_present: true, tdp_watts: 65,
  }]],
  ['FROM motherboard_spec', [{
    product_id: 'p-mb', socket_id: 's-1', form_factor: 'ATX', memory_type_id: 'm-1',
    dimm_slots: 4, max_memory_capacity_gb: 128,
  }]],
  ['FROM ram_spec', [{
    product_id: 'p-ram', memory_type_id: 'm-1', module_count: 2, capacity_per_module_gb: 8,
  }]],
  ['FROM psu_spec', [{
    product_id: 'p-psu', rated_wattage: 750, connector_24pin_atx: true, connector_eps_count: 1,
    connector_pcie_8pin: 2, connector_12vhpwr: 0, connector_sata: 4,
  }]],
  ['FROM case_spec', [{
    product_id: 'p-case', max_gpu_length_mm: 340, max_gpu_thickness_slots: 3, max_cpu_cooler_height_mm: 170,
  }]],
  ['FROM cooler_spec', [{
    product_id: 'p-cool', cooling_type: 'AIR', radiator_size_mm: null, height_mm: 150, max_tdp_watts: 150,
  }]],
  ['FROM gpu_board_spec', [{
    product_variant_id: 'v-gpu', board_tgp_watts: 250, length_mm: 300, width_slots: '2.50',
    required_power_connectors: [], recommended_psu_watts: 650, vram_capacity_gb: 12,
  }]],
  ['FROM platform\n', [{ id: 'plat-1', socket_id: 's-1' }]],
  ['FROM platform_memory_support', [{ platform_id: 'plat-1', memory_type_id: 'm-1', support_status: 'PASS' }]],
  ['FROM motherboard_memory_support', [{
    id: 'mm-1', motherboard_product_id: 'p-mb', memory_type_id: 'm-1', support_status: 'PASS',
  }]],
  ['FROM cpu_motherboard_support', [{
    id: 'cm-1', motherboard_product_id: 'p-mb', cpu_product_id: 'p-cpu', support_status: 'PASS', min_bios_version: null,
  }]],
  ['FROM cooler_socket_support', [{
    id: 'cs-1', cooler_product_id: 'p-cool', socket_id: 's-1', support_status: 'PASS',
  }]],
  ['FROM case_motherboard_form_factor', [{ id: 'cf-1', case_product_id: 'p-case', form_factor: 'ATX' }]],
  ['FROM case_radiator_support', [{ id: 'cr-1', case_product_id: 'p-case', radiator_size_mm: 360, position: 'TOP' }]],
]);

/** Every statement one full-pool load issues, in order, with its ONE parameter. */
const FULL_SEQUENCE = Object.freeze([
  [CPU_SPEC_SQL, ['p-cpu']],
  [MOTHERBOARD_SPEC_SQL, ['p-mb']],
  [RAM_SPEC_SQL, ['p-ram']],
  [PSU_SPEC_SQL, ['p-psu']],
  [CASE_SPEC_SQL, ['p-case']],
  [COOLER_SPEC_SQL, ['p-cool']],
  [GPU_VARIANT_SPEC_SQL, ['v-gpu']],
  [PLATFORM_BY_SOCKET_SQL, ['s-1']],
  [CPU_MOTHERBOARD_SUPPORT_SQL, ['p-mb']],
  [COOLER_SOCKET_SUPPORT_SQL, ['p-cool']],
  [CASE_FORM_FACTOR_SQL, ['p-case']],
  [CASE_RADIATOR_SUPPORT_SQL, ['p-case']],
  [PLATFORM_MEMORY_SUPPORT_SQL, ['plat-1']],
  [MOTHERBOARD_MEMORY_SUPPORT_SQL, ['p-mb']],
]);

/** Fake pg-compatible client: records (sql, params) and returns fixed rows. */
function makeDb() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const marker = ROWS_BY_MARKER.find(([text]) => sql.includes(text));
      if (marker === undefined) throw new Error('unexpected statement: ' + JSON.stringify(sql));
      return { rows: marker[1] };
    },
  };
}

test('loads from the runtime package and exports the filtering-context surface', () => {
  assert.equal(typeof loadFilteringContext, 'function');
  assert.ok(Array.isArray(CONTEXT_COMPAT_KEYS));
  assert.deepEqual([...CONTEXT_COMPAT_KEYS], [
    'cpu_motherboard_exact',
    'cpu_motherboard_family',
    'cooler_socket',
    'case_form_factor',
    'case_radiator',
    'platform_memory',
    'motherboard_memory',
  ]);
});

test('the old path is the same module by identity, not a second implementation', () => {
  assert.equal(shim.loadFilteringContext, loadFilteringContext);
  assert.equal(shim.CONTEXT_COMPAT_KEYS, CONTEXT_COMPAT_KEYS);
});

test('one full-pool load issues every statement in sequence with one id-array parameter', async () => {
  const db = makeDb();

  const context = await loadFilteringContext({ input: INPUT, pool: POOL }, db);

  assert.deepEqual(
    db.calls.map((call) => [call.sql, call.params]),
    FULL_SEQUENCE.map(([sql, ids]) => [sql, [ids]]),
    'the statement sequence changed: spec order, the GPU variant statement, the'
      + ' socket->platform lookup and the seven compat buckets are all pinned'
  );
  for (const call of db.calls) {
    assert.equal(call.params.length, 1, 'every statement binds exactly one parameter');
    assert.ok(Array.isArray(call.params[0]), 'the single parameter is the id array');
  }

  assert.ok(Object.isFrozen(context));
  assert.deepEqual(Object.keys(context).sort(), ['candidates', 'compat', 'platform_by_socket', 'specs']);
  assert.deepEqual(Object.keys(context.compat), [...CONTEXT_COMPAT_KEYS]);
  assert.deepEqual(context.platform_by_socket, { 's-1': 'plat-1' });
  assert.ok(Object.isFrozen(context.specs));
  assert.ok(Object.isFrozen(context.compat));
});

test('a query whose id set is empty is never issued', async () => {
  const db = makeDb();

  const context = await loadFilteringContext({
    input: INPUT,
    pool: [{ product_id: 'p-ssd', product_variant_id: null, category: 'STORAGE', component_role: 'SSD_BOOT' }],
  }, db);

  assert.deepEqual(db.calls, [], 'a storage-only pool issues no statement at all');
  assert.deepEqual(context.specs, {});
  assert.deepEqual(context.platform_by_socket, {});
  assert.deepEqual(Object.keys(context.compat), [...CONTEXT_COMPAT_KEYS]);
});

test('candidate ids are sorted before binding, so the same pool always binds the same array', async () => {
  const db = makeDb();
  const pool = [
    { product_id: 'p-ram-b', product_variant_id: null, category: 'MEMORY', component_role: 'RAM' },
    { product_id: 'p-ram-a', product_variant_id: null, category: 'MEMORY', component_role: 'RAM' },
  ];

  await loadFilteringContext({ input: INPUT, pool }, db);

  assert.deepEqual(db.calls, [[RAM_SPEC_SQL, [['p-ram-a', 'p-ram-b']]]].map(([sql, params]) => ({ sql, params })));
});
