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

// Only genuine JOIN ... product_variant clauses count as a variant branch;
function joinsProductVariant(sql) {
  return sql.toLowerCase().includes('join product_variant');
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
// Engine 2B correction: canonical candidate identity (product-keyed base-only)

// ---------------------------------------------------------------------------

test('product-keyed SQL emits exactly one base candidate (no product_variant branch)', async () => {
  const db = makeDb({ CPU: [{ product_id: 'cpu-1', product_variant_id: null }] });
  const out = await loadCandidates(input(['CPU']), db);
  const cpuSql = identityQueries(db).find((sql) => sql.includes('FROM cpu_spec'));
  assert.ok(cpuSql, 'expected a cpu_spec identity query');
  assert.ok(!joinsProductVariant(cpuSql), 'product-keyed SQL must be base-only');
  assert.ok(!cpuSql.toLowerCase().includes('union all'), 'product-keyed SQL must not union a variant branch');
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].product_id, 'cpu-1');
  assert.equal(out.candidates[0].product_variant_id, null);
  assert.equal(out.candidates[0].category, 'CPU');
  assert.equal(out.candidates[0].component_role, 'CPU');
});

test('product-keyed CPU spec plus multiple variants yields exactly one base CPU candidate', async () => {
  const db = makeDb({ CPU: [{ product_id: 'cpu-1', product_variant_id: null }] });
  const out = await loadCandidates(input(['CPU']), db);
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].product_id, 'cpu-1');
  assert.equal(out.candidates[0].product_variant_id, null);
  assert.equal(out.candidates[0].category, 'CPU');
  assert.equal(out.candidates[0].component_role, 'CPU');
});

test('product-keyed motherboard spec plus variants yields exactly one base motherboard candidate', async () => {
  const db = makeDb({ MOTHERBOARD: [{ product_id: 'mb-1', product_variant_id: null }] });
  const out = await loadCandidates(input(['MOTHERBOARD']), db);
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].product_id, 'mb-1');
  assert.equal(out.candidates[0].product_variant_id, null);
  assert.equal(out.candidates[0].category, 'MOTHERBOARD');
  assert.equal(out.candidates[0].component_role, 'MOTHERBOARD');
});

test('product-keyed RAM, SSD, PSU, CASE and COOLER queries never reference product_variant', async () => {
  const db = makeDb({
    MEMORY: [{ product_id: 'ram-1', product_variant_id: null }],
    STORAGE: [{ product_id: 'ssd-1', product_variant_id: null }],
    PSU: [{ product_id: 'psu-1', product_variant_id: null }],
    CASE: [{ product_id: 'case-1', product_variant_id: null }],
    COOLER: [{ product_id: 'cooler-1', product_variant_id: null }],
  });
  const out = await loadCandidates(input(['RAM', 'SSD_BOOT', 'PSU', 'CASE', 'CPU_COOLER']), db);
  assert.equal(out.candidates.length, 5);
  assert.ok(out.candidates.every((c) => c.product_variant_id === null));
  for (const sql of identityQueries(db)) {
    assert.ok(!joinsProductVariant(sql), 'product-keyed identity query must be base-only');
    assert.ok(!sql.toLowerCase().includes('union all'));
  }
});

test('non-null variant row for a product-keyed category is rejected, never coerced', async () => {
  const db = makeDb({ CPU: [{ product_id: 'cpu-1', product_variant_id: 'cpu-1-v2' }] });
  let err = null;
  try {
    await loadCandidates(input(['CPU']), db);
  } catch (error) {
    err = error;
  }
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_CANDIDATE);
  assert.equal(err.field, 'product_variant_id');
});

test('GPU still generates one candidate per variant row', async () => {
  const db = makeDb({
    GPU: [
      { product_id: 'gpu-prod', product_variant_id: 'gpu-var-a' },
      { product_id: 'gpu-prod', product_variant_id: 'gpu-var-b' },
    ],
  });
  const out = await loadCandidates(input(['GPU']), db);
  assert.equal(out.candidates.length, 2);
  assert.deepEqual(
    out.candidates.map((c) => c.product_variant_id),
    ['gpu-var-a', 'gpu-var-b']
  );
  assert.ok(out.candidates.every((c) => c.category === 'GPU'));
  assert.ok(out.candidates.every((c) => c.component_role === 'GPU'));
});

test('GPU candidate with null variant is rejected', async () => {
  const db = makeDb({ GPU: [{ product_id: 'gpu-prod', product_variant_id: null }] });
  let err = null;
  try {
    await loadCandidates(input(['GPU']), db);
  } catch (error) {
    err = error;
  }
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_CANDIDATE);
  assert.equal(err.field, 'product_variant_id');
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

test('unrelated malformed product elsewhere does not block a valid CPU request', async () => {
  const db = makeDb(
    { CPU: [{ product_id: 'cpu-1', product_variant_id: null }] },
    [{ product_id: 'bad-1', category_count: 2 }]
  );
  const out = await loadCandidates(input(['CPU']), db);
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].product_id, 'cpu-1');
});

test('ambiguous product behind a returned candidate still fails the load', async () => {
  const db = makeDb(
    {
      CPU: [{ product_id: 'prod-1', product_variant_id: null }],
      PSU: [{ product_id: 'unrelated', product_variant_id: null }],
    },
    [
      { product_id: 'prod-1', category_count: 2 },
      { product_id: 'elsewhere-bad', category_count: 3 },
    ]
  );
  let err = null;
  try {
    await loadCandidates(input(['CPU', 'PSU']), db);
  } catch (error) {
    err = error;
  }
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.CANONICAL_CATEGORY_AMBIGUITY);
  assert.ok(err.message.includes('prod-1'), 'relevant product must be named');
  assert.ok(!err.message.includes('elsewhere-bad'), 'unrelated product must not be named');
});

test('GPU-only request is unaffected by unrelated product-keyed ambiguity', async () => {
  const db = makeDb(
    { GPU: [{ product_id: 'gpu-prod', product_variant_id: 'gpu-var' }] },
    [{ product_id: 'bad-1', category_count: 2 }]
  );
  const out = await loadCandidates(input(['GPU']), db);
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].product_variant_id, 'gpu-var');
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
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.CANONICAL_CATEGORY_AMBIGUITY);
});

test('GPU variant representation is not treated as product-level ambiguity', async () => {
  const db = makeDb({
    CPU: [{ product_id: 'cpu-prod', product_variant_id: null }],
    GPU: [{ product_id: 'cpu-prod', product_variant_id: 'gpu-var' }],
  });
  const out = await loadCandidates(input(['CPU', 'GPU']), db);
  const ambiguitySql = db.queries.find((sql) => sql.includes('category_count'));
  assert.ok(ambiguitySql, 'expected the scoped guard query to run');
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
      { product_id: 'psu-2', product_variant_id: null },
      { product_id: 'psu-1', product_variant_id: null },
    ],
    CPU: [
      { product_id: 'cpu-2', product_variant_id: null },
      { product_id: 'cpu-1', product_variant_id: null },
    ],
    GPU: [
      { product_id: 'gpu-prod', product_variant_id: 'gpu-var-b' },
      { product_id: 'gpu-prod', product_variant_id: 'gpu-var-a' },
    ],
  });
  const out = await loadCandidates(input(['PSU', 'CPU', 'GPU']), db);
  const seq = out.candidates.map((c) => `${ROLE_ORDER[c.component_role]}:${c.product_id}:${c.product_variant_id ?? 'NULL'}`);
  assert.deepEqual(seq, [
    '0:cpu-1:NULL',
    '0:cpu-2:NULL',
    '1:gpu-prod:gpu-var-a',
    '1:gpu-prod:gpu-var-b',
    '6:psu-1:NULL',
    '6:psu-2:NULL',
  ]);
});
