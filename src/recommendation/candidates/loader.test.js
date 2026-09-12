const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  COMPONENT_ROLES,
  ROLE_CATEGORIES,
  ROLE_ORDER,
  ERROR_CODES,
  CandidateSelectionError,
  createCandidate,
  loadCandidates,
} = require('./index');

const VALID_BASE = {
  budget_amount: 8000,
  currency: 'MAD',
  use_case: 'GAMING',
};

function input(roles, overrides = {}) {
  return { ...VALID_BASE, required_roles: roles, ...overrides };
}

// Canonical reverse: spec table -> category (mirrors the loader static map).
const SPEC_TO_CATEGORY = {
  cpu_spec: 'CPU',
  motherboard_spec: 'MOTHERBOARD',
  ram_spec: 'MEMORY',
  ssd_spec: 'STORAGE',
  psu_spec: 'PSU',
  case_spec: 'CASE',
  cooler_spec: 'COOLER',
  gpu_board_spec: 'GPU',
};

/**
 * Build a fake pg-compatible client.
 * rowsByCategory: { CATEGORY: [{ product_id, product_variant_id }, ...] }.
 * ambiguityRows: rows returned by the product-keyed ambiguity guard.
 * options.throwRegex / options.throwMessage: throw when a query matches.
 */
function makeDb(rowsByCategory = {}, ambiguityRows = [], options = {}) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (options.throwRegex && options.throwRegex.test(sql)) {
        throw new Error(options.throwMessage || 'simulated database failure');
      }
      if (sql.includes('category_count')) {
        return { rows: ambiguityRows };
      }
      let spec = null;
      if (sql.includes('gpu_board_spec')) {
        spec = 'gpu_board_spec';
      } else {
        for (const table of Object.keys(SPEC_TO_CATEGORY)) {
          if (sql.includes(`FROM ${table}`) || sql.includes(`JOIN ${table}`)) {
            spec = table;
            break;
          }
        }
      }
      if (spec === null) return { rows: [] };
      return { rows: rowsByCategory[SPEC_TO_CATEGORY[spec]] || [] };
    },
  };
}

// Exclude the product-keyed ambiguity guard, which legitimately references
// every product-keyed spec table, and keep only the role-identity queries.
function identityQueries(db) {
  return db.queries.filter((sql) => !sql.includes('category_count'));
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

test('valid loader input is passed through Engine 2A validation', async () => {
  const db = makeDb();
  const out = await loadCandidates(input(['CPU']), db);
  assert.equal(out.input.currency, 'MAD');
  assert.equal(out.input.budget_amount, 8000);
  assert.deepEqual(out.input.required_roles, ['CPU']);
  assert.ok(Object.isFrozen(out.input));
  assert.ok(Object.isFrozen(out.candidates));
});

test('invalid input is rejected without touching the database', async () => {
  const db = makeDb();
  let err = null;
  try {
    await loadCandidates({ ...VALID_BASE, budget_amount: -5, required_roles: ['CPU'] }, db);
  } catch (error) {
    err = error;
  }
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(err.field, 'budget_amount');
  assert.equal(db.queries.length, 0);
});

test('unsupported role is rejected clearly', async () => {
  const db = makeDb();
  let err = null;
  try {
    await loadCandidates(input(['CPU', 'HOVERBOARD']), db);
  } catch (error) {
    err = error;
  }
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_COMPONENT_ROLE);
  assert.equal(db.queries.length, 0);
});

// ---------------------------------------------------------------------------
// Category mapping
// ---------------------------------------------------------------------------

test('every valid component role resolves to its expected canonical category', async () => {
  for (const role of COMPONENT_ROLES) {
    const rows =
      role === 'GPU'
        ? [{ product_id: 'gpu-prod', product_variant_id: 'gpu-var' }]
        : [{ product_id: 'prod-1', product_variant_id: null }];
    const db = makeDb({ [ROLE_CATEGORIES[role]]: rows });
    const out = await loadCandidates(input([role]), db);
    assert.equal(out.candidates.length, 1, `expected one candidate for ${role}`);
    assert.equal(out.candidates[0].component_role, role);
    assert.equal(out.candidates[0].category, ROLE_CATEGORIES[role]);
  }
});

test('CPU comes from cpu_spec (product-keyed)', async () => {
  const db = makeDb({ CPU: [{ product_id: 'cpu-1', product_variant_id: null }] });
  const out = await loadCandidates(input(['CPU']), db);
  assert.ok(identityQueries(db).some((sql) => sql.includes('FROM cpu_spec')));
  assert.ok(!identityQueries(db).some((sql) => sql.includes('FROM psu_spec')));
  assert.equal(out.candidates[0].category, 'CPU');
});

test('motherboard comes from motherboard_spec (product-keyed)', async () => {
  const db = makeDb({ MOTHERBOARD: [{ product_id: 'mb-1', product_variant_id: null }] });
  const out = await loadCandidates(input(['MOTHERBOARD']), db);
  assert.ok(identityQueries(db).some((sql) => sql.includes('FROM motherboard_spec')));
  assert.equal(out.candidates[0].category, 'MOTHERBOARD');
});

test('RAM comes from ram_spec (product-keyed)', async () => {
  const db = makeDb({ MEMORY: [{ product_id: 'ram-1', product_variant_id: null }] });
  const out = await loadCandidates(input(['RAM']), db);
  assert.ok(identityQueries(db).some((sql) => sql.includes('FROM ram_spec')));
  assert.equal(out.candidates[0].category, 'MEMORY');
});

test('SSD roles come from ssd_spec (product-keyed)', async () => {
  const rows = [{ product_id: 'ssd-1', product_variant_id: null }];
  const db = makeDb({ STORAGE: rows });
  const boot = await loadCandidates(input(['SSD_BOOT']), db);
  const secondary = await loadCandidates(input(['SSD_SECONDARY']), db);
  assert.ok(identityQueries(db).some((sql) => sql.includes('FROM ssd_spec')));
  assert.equal(boot.candidates[0].category, 'STORAGE');
  assert.equal(secondary.candidates[0].category, 'STORAGE');
  assert.equal(boot.candidates[0].component_role, 'SSD_BOOT');
  assert.equal(secondary.candidates[0].component_role, 'SSD_SECONDARY');
});

test('PSU comes from psu_spec (product-keyed)', async () => {
  const db = makeDb({ PSU: [{ product_id: 'psu-1', product_variant_id: null }] });
  const out = await loadCandidates(input(['PSU']), db);
  assert.ok(identityQueries(db).some((sql) => sql.includes('FROM psu_spec')));
  assert.equal(out.candidates[0].category, 'PSU');
});

test('CASE comes from case_spec (product-keyed)', async () => {
  const db = makeDb({ CASE: [{ product_id: 'case-1', product_variant_id: null }] });
  const out = await loadCandidates(input(['CASE']), db);
  assert.ok(identityQueries(db).some((sql) => sql.includes('FROM case_spec')));
  assert.equal(out.candidates[0].category, 'CASE');
});

test('CPU_COOLER comes from cooler_spec (product-keyed)', async () => {
  const db = makeDb({ COOLER: [{ product_id: 'cooler-1', product_variant_id: null }] });
  const out = await loadCandidates(input(['CPU_COOLER']), db);
  assert.ok(identityQueries(db).some((sql) => sql.includes('FROM cooler_spec')));
  assert.equal(out.candidates[0].category, 'COOLER');
});

test('GPU comes from gpu_board_spec through product_variant (variant-keyed)', async () => {
  const db = makeDb({ GPU: [{ product_id: 'gpu-prod', product_variant_id: 'gpu-var' }] });
  const out = await loadCandidates(input(['GPU']), db);
  assert.ok(identityQueries(db).some((sql) => sql.includes('JOIN gpu_board_spec')));
  assert.ok(identityQueries(db).some((sql) => sql.includes('JOIN product_variant')));
  assert.equal(out.candidates[0].category, 'GPU');
});

// ---------------------------------------------------------------------------
// Candidate identity
// ---------------------------------------------------------------------------

test('non-GPU base product candidate has product_variant_id = null', async () => {
  const db = makeDb({
    CPU: [
      { product_id: 'cpu-1', product_variant_id: null },
      { product_id: 'cpu-1', product_variant_id: 'cpu-1-v2' },
    ],
  });
  const out = await loadCandidates(input(['CPU']), db);
  const base = out.candidates.find((c) => c.product_variant_id === null);
  assert.ok(base, 'expected a base candidate with null variant');
  const variant = out.candidates.find((c) => c.product_variant_id === 'cpu-1-v2');
  assert.ok(variant, 'expected a distinct variant candidate to be preserved');
});

test('GPU candidates always preserve the variant ID (never null)', async () => {
  const db = makeDb({ GPU: [{ product_id: 'gpu-prod', product_variant_id: 'gpu-var' }] });
  const out = await loadCandidates(input(['GPU']), db);
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].product_variant_id, 'gpu-var');
  assert.ok(out.candidates.every((c) => c.product_variant_id !== null));
});

test('returned candidates are valid Engine 2A candidates', async () => {
  const db = makeDb({
    CPU: [{ product_id: 'cpu-1', product_variant_id: null }],
    GPU: [{ product_id: 'gpu-prod', product_variant_id: 'gpu-var' }],
  });
  const out = await loadCandidates(input(['CPU', 'GPU']), db);
  assert.ok(out.candidates.length > 0);
  for (const candidate of out.candidates) {
    assert.deepEqual(createCandidate(candidate), candidate);
  }
});

test('no fabricated candidates when the database has zero rows', async () => {
  const db = makeDb();
  const out = await loadCandidates(input(['CPU', 'GPU', 'PSU']), db);
  assert.equal(out.candidates.length, 0);
});

// ---------------------------------------------------------------------------
// Ambiguity
// ---------------------------------------------------------------------------

test('product appearing in multiple product-keyed spec tables is detected', async () => {
  const db = makeDb({}, [{ product_id: 'bad-1', category_count: 2 }]);
  let err = null;
  try {
    await loadCandidates(input(['CPU']), db);
  } catch (error) {
    err = error;
  }
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.CANONICAL_CATEGORY_AMBIGUITY);
  assert.equal(err.field, 'product_id');
});

test('loader does not silently choose one category on ambiguity', async () => {
  const db = makeDb(
    { CPU: [{ product_id: 'prod-1', product_variant_id: null }] },
    [{ product_id: 'prod-1', category_count: 2 }]
  );
  let err = null;
  try {
    await loadCandidates(input(['CPU']), db);
  } catch (error) {
    err = error;
  }
  assert.ok(err && err.code === ERROR_CODES.CANONICAL_CATEGORY_AMBIGUITY);
});

test('GPU variant representation is not treated as product-level ambiguity', async () => {
  const db = makeDb({
    CPU: [{ product_id: 'cpu-prod', product_variant_id: null }],
    GPU: [{ product_id: 'cpu-prod', product_variant_id: 'gpu-var' }],
  });
  const out = await loadCandidates(input(['CPU', 'GPU']), db);
  const ambiguitySql = db.queries[0];
  assert.ok(ambiguitySql.includes('category_count'));
  assert.ok(!ambiguitySql.includes('gpu_board_spec'), 'GPU must be absent from the product-keyed guard');
  assert.equal(out.candidates.filter((c) => c.category === 'CPU').length, 1);
  assert.equal(out.candidates.filter((c) => c.category === 'GPU').length, 1);
});

// ---------------------------------------------------------------------------
// Filtering boundaries
// ---------------------------------------------------------------------------

test('budget does not filter candidates', async () => {
  const rows = { CPU: [{ product_id: 'cpu-1', product_variant_id: null }] };
  const low = await loadCandidates(input(['CPU'], { budget_amount: 1 }), makeDb(rows));
  const high = await loadCandidates(input(['CPU'], { budget_amount: 999999 }), makeDb(rows));
  const keys = (list) => list.map((c) => [c.product_id, c.product_variant_id, c.category, c.component_role]);
  assert.deepEqual(keys(low.candidates), keys(high.candidates));
});

test('use_case does not create invented filtering', async () => {
  const rows = { CPU: [{ product_id: 'cpu-1', product_variant_id: null }] };
  const a = await loadCandidates(input(['CPU'], { use_case: 'GAMING' }), makeDb(rows));
  const b = await loadCandidates(input(['CPU'], { use_case: 'VIDEO EDITING' }), makeDb(rows));
  assert.deepEqual(a.candidates, b.candidates);
  const db = makeDb(rows);
  await loadCandidates(input(['CPU']), db);
  assert.ok(db.queries.every((sql) => !sql.toLowerCase().includes('use_case')));
});

test('no store, price, or benchmark lookup occurs', async () => {
  const db = makeDb({ CPU: [{ product_id: 'cpu-1', product_variant_id: null }] });
  const out = await loadCandidates(input(['CPU']), db);
  assert.equal(out.candidates.length, 1);
  const forbidden = [
    'store_offer',
    'price_history',
    'benchmark',
    'recommendation',
    'build_',
    'scoring_model',
    'component_assessment',
    'product_candidate',
  ];
  for (const sql of db.queries) {
    for (const token of forbidden) {
      assert.ok(!sql.includes(token), `query must not reference ${token}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Empty / error behavior
// ---------------------------------------------------------------------------

test('zero rows produce zero candidates', async () => {
  const db = makeDb();
  const out = await loadCandidates(input(['MOTHERBOARD', 'PSU']), db);
  assert.equal(out.candidates.length, 0);
});

test('database query failure propagates as an error', async () => {
  const db = makeDb(
    { CPU: [{ product_id: 'cpu-1', product_variant_id: null }] },
    [],
    { throwRegex: /EXISTS/, throwMessage: 'connection reset by peer' }
  );
  let err = null;
  try {
    await loadCandidates(input(['CPU']), db);
  } catch (error) {
    err = error;
  }
  assert.ok(err, 'expected a thrown error');
  assert.equal(err.message, 'connection reset by peer');
  assert.notEqual(err.code, ERROR_CODES.EMPTY_CANDIDATE_POOL);
  assert.notEqual(err.code, ERROR_CODES.CANONICAL_CATEGORY_AMBIGUITY);
});

test('role/category mismatch cannot be emitted', async () => {
  const db = makeDb({
    CPU: [{ product_id: 'cpu-1', product_variant_id: null }],
    PSU: [{ product_id: 'psu-1', product_variant_id: null }],
    GPU: [{ product_id: 'gpu-prod', product_variant_id: 'gpu-var' }],
  });
  const out = await loadCandidates(input(['CPU', 'PSU', 'GPU']), db);
  for (const candidate of out.candidates) {
    assert.equal(candidate.category, ROLE_CATEGORIES[candidate.component_role]);
  }
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

test('candidates are deterministically ordered by role, product_id, then variant (null first)', async () => {
  const db = makeDb({
    PSU: [
      { product_id: 'psu-1', product_variant_id: 'psu-1-x' },
      { product_id: 'psu-1', product_variant_id: null },
      { product_id: 'psu-2', product_variant_id: null },
    ],
    CPU: [
      { product_id: 'cpu-2', product_variant_id: null },
      { product_id: 'cpu-1', product_variant_id: null },
    ],
    GPU: [{ product_id: 'gpu-prod', product_variant_id: 'gpu-var' }],
  });
  const out = await loadCandidates(input(['PSU', 'CPU', 'GPU']), db);
  const seq = out.candidates.map((c) => `${ROLE_ORDER[c.component_role]}:${c.product_id}:${c.product_variant_id ?? 'NULL'}`);
  assert.deepEqual(seq, [
    '0:cpu-1:NULL',
    '0:cpu-2:NULL',
    '1:gpu-prod:gpu-var',
    '6:psu-1:NULL',
    '6:psu-1:psu-1-x',
    '6:psu-2:NULL',
  ]);
});
