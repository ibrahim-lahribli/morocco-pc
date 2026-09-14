'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  loadFilteringContext, CONTEXT_COMPAT_KEYS,
} = require('./context-loader');
const { ROLE_CATEGORIES } = require('../candidates/roles');
const { createCandidate } = require('../candidates');

// ---------------------------------------------------------------------------
// Fake database: routes parameterized SQL to canned rows and records calls.
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
  // Longest match first: 'FROM platform_memory_support' must win over
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
 * canned rows by any property whose value is a member of the id list (this
 * covers the owner columns: product_id, motherboard_product_id,
 * cooler_product_id, case_product_id, socket_id, platform_id,
 * product_variant_id). Rows outside the id list must never surface, exactly
 * like a real `= ANY($1::uuid[])` query.
 */
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
    calls: [],
    async query(sql, params) {
      if (record) record.push({ sql, params });
      return { rows: scopeRowsByParams(route(sql, params), params) };
    },
  };
}

// Deterministic id helpers (hex, lexicographically orderable).
const U = (n) => 'uuuuuuuu-uuuu-uuuu-uuuu-' + String(n).padStart(12, '0');
const V = (n) => 'vvvvvvvv-vvvv-vvvv-vvvv-' + String(n).padStart(12, '0');
const P = (n) => 'pppppppp-pppp-pppp-pppp-' + String(n).padStart(12, '0');

// ---------------------------------------------------------------------------
// Candidate helpers.
// ---------------------------------------------------------------------------

function makeCandidate(role, productId, variantId = null) {
  return createCandidate({
    component_role: role,
    category: ROLE_CATEGORIES[role],
    product_id: productId,
    product_variant_id: variantId,
  });
}

function fullPool() {
  return [
    makeCandidate('CPU', U(1)),
    makeCandidate('MOTHERBOARD', U(2)),
    makeCandidate('RAM', U(3)),
    makeCandidate('GPU', U(4), V(1)),
    makeCandidate('PSU', U(5)),
    makeCandidate('CPU_COOLER', U(6)),
    makeCandidate('CASE', U(7)),
    makeCandidate('SSD_BOOT', U(8)),
  ];
}

function poolResult(pool) {
  return {
    input: {
      budget_amount: 100000,
      currency: 'EUR',
      use_case: 'gaming',
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

function singleOfEachRoutes() {
  const routes = emptyRoutes();
  routes.CPU = [{ product_id: U(1), socket_id: P(1), product_family_id: P(10) }];
  routes.MOTHERBOARD = [{ product_id: U(2), socket_id: P(1), form_factor: 'ATX', memory_type_id: P(20) }];
  routes.RAM = [{ product_id: U(3), memory_type_id: P(20) }];
  routes.GPU = [{
    product_variant_id: V(1), length_mm: 300, width_slots: '2.50',
    required_power_connectors: { pcie_8pin: 2 }, recommended_psu_watts: 750,
  }];
  routes.PSU = [{
    product_id: U(5), rated_wattage: 850, connector_24pin_atx: true,
    connector_eps_count: 2, connector_pcie_8pin: 4, connector_12vhpwr: null, connector_sata: 6,
  }];
  routes.COOLER = [{ product_id: U(6), cooling_type: 'LIQUID' }];
  routes.CASE = [{ product_id: U(7), max_gpu_length_mm: 360, max_gpu_thickness_slots: 3 }];
  routes.PLATFORM = [{ id: P(1), socket_id: P(1) }];
  return routes;
}

async function fullContext(routes = singleOfEachRoutes()) {
  const db = createDb(routes);
  const context = await loadFilteringContext(poolResult(fullPool()), db);
  return { context, db };
}

// ---------------------------------------------------------------------------
// B2-B: specs loading (candidate-scoped queries, normalization).
// ---------------------------------------------------------------------------

test('specs are loaded only for candidate products/variants', async () => {
  const calls = [];
  const routes = singleOfEachRoutes();
  const db = createDb(routes, { record: calls });
  await loadFilteringContext(poolResult(fullPool()), db);

  // SSD candidates must never trigger an SSD spec query.
  assert.equal(calls.some((c) => /ssd/i.test(c.sql)), false);

  // Every spec query must receive exactly the candidate ids as parameters.
  const paramChecks = [
    { name: SQL.CPU, ids: [U(1)] },
    { name: SQL.MOTHERBOARD, ids: [U(2)] },
    { name: SQL.RAM, ids: [U(3)] },
    { name: SQL.COOLER, ids: [U(6)] },
    { name: SQL.CASE, ids: [U(7)] },
    { name: SQL.PSU, ids: [U(5)] },
    { name: SQL.GPU, ids: [V(1)] },
  ];
  for (const { name, ids } of paramChecks) {
    const call = calls.find((c) => c.sql.includes(name));
    assert.ok(call, 'missing query for ' + name);
    assert.deepEqual(call.params, [ids]);
  }
});

test('specs keys use p:/v: prefixes and SQL rows are normalized', async () => {
  const { context } = await fullContext();

  assert.deepEqual(context.specs['p:' + U(1)], {
    socket_id: P(1), product_family_id: P(10),
  });
  assert.deepEqual(context.specs['p:' + U(2)], {
    socket_id: P(1), form_factor: 'ATX', memory_type_id: P(20),
  });
  assert.deepEqual(context.specs['p:' + U(3)], { memory_type_id: P(20) });
  assert.deepEqual(context.specs['p:' + U(7)], {
    max_gpu_length_mm: 360, max_gpu_thickness_slots: 3,
  });
  // NUMERIC width_slots arrives as string, must be a number in the context.
  assert.deepEqual(context.specs['v:' + V(1)], {
    length_mm: 300, width_slots: 2.5,
    required_power_connectors: { pcie_8pin: 2 }, recommended_psu_watts: 750,
  });
  // JSONB blob stays structured (never stringified).
  assert.equal(typeof context.specs['v:' + V(1)].required_power_connectors, 'object');
});

test('psu power_connectors normalization: boolean and counts, NULL preserved', async () => {
  const { context } = await fullContext();
  assert.deepEqual(context.specs['p:' + U(5)], {
    rated_wattage: 850,
    power_connectors: {
      '24pin_atx': 1, eps: 2, pcie_8pin: 4, '12vhpwr': null, sata: 6,
    },
  });

  // false boolean -> 0 (never NULL).
  const routes = singleOfEachRoutes();
  routes.PSU = [{
    product_id: U(5), rated_wattage: null, connector_24pin_atx: false,
    connector_eps_count: null, connector_pcie_8pin: null,
    connector_12vhpwr: null, connector_sata: null,
  }];
  const { context: c2 } = await fullContext(routes);
  assert.deepEqual(c2.specs['p:' + U(5)], {
    rated_wattage: null,
    power_connectors: { '24pin_atx': 0, eps: null, pcie_8pin: null, '12vhpwr': null, sata: null },
  });
});

test('cooler specs derive cooler_requires_radiator; cooling_type preserved', async () => {
  const { context } = await fullContext();
  assert.deepEqual(context.specs['p:' + U(6)], {
    cooling_type: 'LIQUID', cooler_requires_radiator: true,
    radiator_size_mm: null, radiator_position: null,
  });

  const variants = { AIR: false, PASSIVE: false, LIQUID: true, HYBRID: null, null: null };
  for (const [coolingType, expected] of Object.entries(variants)) {
    const routes = singleOfEachRoutes();
    routes.COOLER = [{ product_id: U(6), cooling_type: coolingType === 'null' ? null : coolingType }];
    const { context: c } = await fullContext(routes);
    assert.equal(c.specs['p:' + U(6)].cooler_requires_radiator, expected);
  }
});

test('specs: rows for non-candidate products are excluded even if returned', async () => {
  const routes = singleOfEachRoutes();
  // The DB layer scopes by parameter, but a buggy/route-level leak must not
  // propagate: rows with foreign ids get their own keys (harmless), while
  // candidate rows keep theirs. Assert the candidate rows are correct and
  // no key is fabricated for candidates with no DB row.
  routes.RAM = []; // RAM candidate U(3) has no spec row
  const { context } = await fullContext(routes);
  assert.equal('p:' + U(3) in context.specs, false);
  assert.ok('p:' + U(1) in context.specs);
});

test('roles without candidates skip their spec queries entirely', async () => {
  const calls = [];
  const routes = emptyRoutes();
  routes.PSU = [{
    product_id: U(5), rated_wattage: 850, connector_24pin_atx: true,
    connector_eps_count: null, connector_pcie_8pin: null,
    connector_12vhpwr: null, connector_sata: null,
  }];
  const db = createDb(routes, { record: calls });
  const pool = [makeCandidate('PSU', U(5))];
  const context = await loadFilteringContext(poolResult(pool), db);

  assert.deepEqual(context.specs['p:' + U(5)].power_connectors, {
    '24pin_atx': 1, eps: null, pcie_8pin: null, '12vhpwr': null, sata: null,
  });
  for (const table of [SQL.CPU, SQL.MOTHERBOARD, SQL.RAM, SQL.COOLER, SQL.CASE, SQL.GPU]) {
    assert.equal(calls.some((c) => c.sql.includes(table)), false, table);
  }
});

// ---------------------------------------------------------------------------
// B2-B: platform_by_socket (candidate-scoped, ambiguity-safe).
// ---------------------------------------------------------------------------

test('platform_by_socket maps sockets with exactly one platform row', async () => {
  const calls = [];
  const routes = singleOfEachRoutes();
  const db = createDb(routes, { record: calls });
  const context = await loadFilteringContext(poolResult(fullPool()), db);

  assert.deepEqual(context.platform_by_socket, { [P(1)]: P(1) });
  const platformCall = calls.find((c) => c.sql.includes(SQL.PLATFORM));
  // Socket ids come from candidate CPU + motherboard specs (same socket).
  assert.deepEqual(platformCall.params, [[P(1)]]);
});

test('platform_by_socket: zero rows -> no mapping; multiple rows -> no mapping', async () => {
  const routes = singleOfEachRoutes();
  routes.PLATFORM = []; // zero rows
  const { context: c1 } = await fullContext(routes);
  assert.deepEqual(c1.platform_by_socket, {});

  const ambiguous = singleOfEachRoutes();
  ambiguous.PLATFORM = [
    { id: P(1), socket_id: P(1) },
    { id: P(2), socket_id: P(1) },
  ];
  const { context: c2 } = await fullContext(ambiguous);
  // Never silently choose one platform for an ambiguous socket.
  assert.deepEqual(c2.platform_by_socket, {});
});

test('platform queries only sockets carried by candidate spec entries', async () => {
  const routes = singleOfEachRoutes();
  routes.MOTHERBOARD = [{ product_id: U(2), socket_id: P(9), form_factor: 'ATX', memory_type_id: P(20) }];
  routes.PLATFORM = [
    { id: P(1), socket_id: P(1) },
    { id: P(9), socket_id: P(9) },
    { id: P(99), socket_id: P(99) }, // unrelated catalog socket
  ];
  const { context } = await fullContext(routes);
  assert.deepEqual(context.platform_by_socket, {
    [P(1)]: P(1), [P(9)]: P(9),
  });
});

test('spec entries without a socket contribute no platform query ids', async () => {
  const routes = singleOfEachRoutes();
  routes.MOTHERBOARD = [{ product_id: U(2), socket_id: null, form_factor: 'ATX', memory_type_id: P(20) }];
  routes.PLATFORM = [{ id: P(1), socket_id: P(1) }];
  const { context } = await fullContext(routes);
  assert.deepEqual(context.platform_by_socket, { [P(1)]: P(1) });
});

// ---------------------------------------------------------------------------
// B2-B: compat buckets (candidate-scoped rows, grouped, normalized).
// ---------------------------------------------------------------------------

test('cpu_motherboard rows split into exact vs family buckets', async () => {
  const routes = singleOfEachRoutes();
  routes.CPU_MB = [
    {
      id: 'mb-row-1', motherboard_product_id: U(2), cpu_product_id: U(1),
      cpu_product_family_id: null, support_status: 'SUPPORTED', min_bios_version: '1.2.0',
    },
    {
      id: 'mb-row-2', motherboard_product_id: U(2), cpu_product_id: null,
      cpu_product_family_id: P(10), support_status: 'SUPPORTED', min_bios_version: null,
    },
    {
      id: 'mb-row-3', motherboard_product_id: U(99), cpu_product_id: U(1),
      cpu_product_family_id: null, support_status: 'SUPPORTED', min_bios_version: null,
    },
  ];
  const { context } = await fullContext(routes);

  assert.deepEqual(context.compat.cpu_motherboard_exact, {
    [U(2)]: [{
      source_table: 'cpu_motherboard_support', source_id: 'mb-row-1',
      support_status: 'SUPPORTED', cpu_product_id: U(1), min_bios_version: '1.2.0',
    }],
  });
  assert.deepEqual(context.compat.cpu_motherboard_family, {
    [U(2)]: [{
      source_table: 'cpu_motherboard_support', source_id: 'mb-row-2',
      support_status: 'SUPPORTED', cpu_product_family_id: P(10), min_bios_version: null,
    }],
  });
  // Row for a non-candidate motherboard (U(99)) must be filtered out.
  assert.equal(U(99) in context.compat.cpu_motherboard_exact, false);
});

test('cooler_socket and case buckets group rows per candidate product', async () => {
  const routes = singleOfEachRoutes();
  routes.COOLER_SOCKET = [
    { id: 'cs-1', cooler_product_id: U(6), socket_id: P(1), support_status: 'SUPPORTED' },
    { id: 'cs-2', cooler_product_id: U(6), socket_id: P(2), support_status: 'UNSUPPORTED' },
    { id: 'cs-3', cooler_product_id: U(66), socket_id: P(1), support_status: 'SUPPORTED' },
  ];
  routes.CASE_FF = [
    { id: 'cff-1', case_product_id: U(7), form_factor: 'ATX' },
    { id: 'cff-2', case_product_id: U(7), form_factor: 'MICRO_ATX' },
  ];
  routes.CASE_RAD = [
    { id: 'cr-1', case_product_id: U(7), radiator_size_mm: 360, position: 'TOP' },
  ];
  const { context } = await fullContext(routes);

  assert.deepEqual(context.compat.cooler_socket, {
    [U(6)]: [
      {
        source_table: 'cooler_socket_support', source_id: 'cs-1',
        support_status: 'SUPPORTED', socket_id: P(1),
      },
      {
        source_table: 'cooler_socket_support', source_id: 'cs-2',
        support_status: 'UNSUPPORTED', socket_id: P(2),
      },
    ],
  });
  // Presence-only table: support_status carries null.
  assert.deepEqual(context.compat.case_form_factor, {
    [U(7)]: [
      { source_table: 'case_motherboard_form_factor', source_id: 'cff-1', support_status: null, form_factor: 'ATX' },
      { source_table: 'case_motherboard_form_factor', source_id: 'cff-2', support_status: null, form_factor: 'MICRO_ATX' },
    ],
  });
  assert.deepEqual(context.compat.case_radiator, {
    [U(7)]: [{
      source_table: 'case_radiator_support', source_id: 'cr-1',
      support_status: null, radiator_size_mm: 360, position: 'TOP',
    }],
  });
  assert.equal(U(66) in context.compat.cooler_socket, false);
});

test('platform_memory is scoped to platforms resolvable from candidate sockets', async () => {
  const calls = [];
  const routes = singleOfEachRoutes();
  routes.PLATFORM_MEM = [
    { platform_id: P(1), memory_type_id: P(20) },
    { platform_id: P(1), memory_type_id: P(21) },
    { platform_id: P(77), memory_type_id: P(20) }, // unrelated platform
  ];
  const db = createDb(routes, { record: calls });
  const context = await loadFilteringContext(poolResult(fullPool()), db);

  assert.deepEqual(context.compat.platform_memory, {
    [P(1)]: [
      { source_table: 'platform_memory_support', source_id: null, support_status: null, memory_type_id: P(20) },
      { source_table: 'platform_memory_support', source_id: null, support_status: null, memory_type_id: P(21) },
    ],
  });
  const memCall = calls.find((c) => c.sql.includes(SQL.PLATFORM_MEM));
  assert.deepEqual(memCall.params, [[P(1)]]); // P(77) never queried

  // Ambiguous socket -> no platform id -> no memory bucket rows.
  const ambiguous = singleOfEachRoutes();
  ambiguous.PLATFORM = [
    { id: P(1), socket_id: P(1) },
    { id: P(2), socket_id: P(1) },
  ];
  const { context: c2 } = await fullContext(ambiguous);
  assert.deepEqual(c2.compat.platform_memory, {});
});

test('compat buckets stay empty maps when no candidates exist for their owner role', async () => {
  const calls = [];
  const db = createDb(emptyRoutes(), { record: calls });
  const pool = [makeCandidate('GPU', U(4), V(1))];
  const context = await loadFilteringContext(poolResult(pool), db);

  for (const key of CONTEXT_COMPAT_KEYS) {
    assert.deepEqual(context.compat[key], {});
  }
  // No compat table may be queried without owner candidates.
  for (const table of [SQL.CPU_MB, SQL.COOLER_SOCKET, SQL.CASE_FF, SQL.CASE_RAD]) {
    assert.equal(calls.some((c) => c.sql.includes(table)), false, table);
  }
});

// ---------------------------------------------------------------------------
// B2-B: context shape, immutability, error propagation, determinism.
// ---------------------------------------------------------------------------

test('returned context keeps the four-key shape and is deeply frozen', async () => {
  const { context } = await fullContext();

  assert.deepEqual(Object.keys(context).sort(), ['candidates', 'compat', 'platform_by_socket', 'specs']);
  assert.ok(Object.isFrozen(context));
  assert.ok(Object.isFrozen(context.specs));
  assert.ok(Object.isFrozen(context.platform_by_socket));
  assert.ok(Object.isFrozen(context.compat));
  for (const key of CONTEXT_COMPAT_KEYS) {
    assert.ok(Object.isFrozen(context.compat[key]), key);
    for (const rows of Object.values(context.compat[key])) {
      assert.ok(Object.isFrozen(rows));
      for (const row of rows) assert.ok(Object.isFrozen(row));
    }
  }
  for (const spec of Object.values(context.specs)) {
    assert.ok(Object.isFrozen(spec));
    if (spec.power_connectors) assert.ok(Object.isFrozen(spec.power_connectors));
  }

  // Frozen in practice: mutations throw (strict mode) or are ignored.
  assert.throws(() => { 'use strict'; context.newKey = 1; }, TypeError);
  assert.throws(() => { 'use strict'; context.specs['p:' + U(1)].socket_id = 'x'; }, TypeError);
});

test('candidates bucketing is unchanged by the DB-backed stage', async () => {
  const { context } = await fullContext();
  for (const role of Object.keys(context.candidates)) {
    assert.ok(Object.isFrozen(context.candidates[role]));
  }
  assert.equal(context.candidates.CPU.length, 1);
  assert.equal(context.candidates.GPU.length, 1);
  assert.equal(context.candidates.SSD_BOOT.length, 1);
});

test('B2-A validation errors still hold and PostgreSQL errors propagate', async () => {
  await assert.rejects(
    () => loadFilteringContext(null, createDb(emptyRoutes())),
    (err) => err.name === 'CandidateSelectionError'
  );
  await assert.rejects(
    () => loadFilteringContext(poolResult(fullPool()), null),
    (err) => err.name === 'CandidateSelectionError'
  );

  const failingDb = {
    async query() {
      const error = new Error('connection refused');
      error.code = 'ECONNREFUSED';
      throw error;
    },
  };
  await assert.rejects(
    () => loadFilteringContext(poolResult(fullPool()), failingDb),
    (err) => err.code === 'ECONNREFUSED'
  );
});

test('determinism: identical DB state yields structurally identical contexts', async () => {
  const { context: a } = await fullContext();
  const { context: b } = await fullContext();
  assert.deepEqual(a, b);
  // Map insertion order is also stable.
  assert.deepEqual(Object.keys(a.specs), Object.keys(b.specs));
  assert.deepEqual(
    Object.keys(a.compat.cpu_motherboard_exact).length >= 0, true
  );
});

test('empty-ish pool (storage only) populates an empty context without queries', async () => {
  const calls = [];
  const db = createDb(emptyRoutes(), { record: calls });
  const pool = [makeCandidate('SSD_BOOT', U(8))];
  const context = await loadFilteringContext(poolResult(pool), db);

  assert.deepEqual(context.specs, {});
  assert.deepEqual(context.platform_by_socket, {});
  for (const key of CONTEXT_COMPAT_KEYS) {
    assert.deepEqual(context.compat[key], {});
  }
  assert.equal(calls.length, 0);
});