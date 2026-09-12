const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  COMPONENT_ROLES,
  SINGULAR_ROLES,
  PRODUCT_CATEGORIES,
  ROLE_CATEGORIES,
  SELECTION_STAGES,
  IMPLEMENTED_STAGES,
  ERROR_CODES,
  CandidateSelectionError,
  createCandidateSelectionInput,
  createCandidate,
  selectCandidatePool,
} = require('./index');

const VALID_INPUT = {
  budget_amount: 8000,
  currency: 'MAD',
  use_case: 'GAMING',
  required_roles: [
    'CPU',
    'MOTHERBOARD',
    'RAM',
    'GPU',
    'SSD_BOOT',
    'PSU',
    'CASE',
    'CPU_COOLER',
  ],
};

function makeCandidate(overrides = {}) {
  return {
    product_id: 'product-1',
    product_variant_id: null,
    category: 'CPU',
    component_role: 'CPU',
    ...overrides,
  };
}

function errorOf(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stage and vocabulary definition
// ---------------------------------------------------------------------------

test('selection stages are defined with only the foundation implemented', () => {
  assert.deepEqual(SELECTION_STAGES, [
    'QUERY',
    'ROLE_CATEGORY_ELIGIBILITY',
    'CANDIDATE_POOL',
    'HARD_COMPATIBILITY_FILTERING',
    'BUDGET_FILTERING',
    'ASSESSMENT_SCORING',
  ]);
  assert.deepEqual(IMPLEMENTED_STAGES, [
    'QUERY',
    'ROLE_CATEGORY_ELIGIBILITY',
    'CANDIDATE_POOL',
  ]);
});

test('role vocabulary mirrors the database enums', () => {
  assert.deepEqual(COMPONENT_ROLES, [
    'CPU',
    'GPU',
    'MOTHERBOARD',
    'RAM',
    'SSD_BOOT',
    'SSD_SECONDARY',
    'PSU',
    'CASE',
    'CPU_COOLER',
  ]);
  assert.deepEqual(PRODUCT_CATEGORIES, [
    'CPU',
    'MOTHERBOARD',
    'MEMORY',
    'GPU',
    'STORAGE',
    'PSU',
    'CASE',
    'COOLER',
  ]);
  assert.deepEqual(Object.keys(ROLE_CATEGORIES), COMPONENT_ROLES);
  assert.deepEqual([...SINGULAR_ROLES].sort(), [
    'CASE',
    'CPU',
    'CPU_COOLER',
    'MOTHERBOARD',
    'PSU',
    'SSD_BOOT',
  ]);
});

// ---------------------------------------------------------------------------
// Selector input contract
// ---------------------------------------------------------------------------

test('accepts a valid selector input and freezes it', () => {
  const input = createCandidateSelectionInput(VALID_INPUT);
  assert.equal(input.budget_amount, 8000);
  assert.equal(input.currency, 'MAD');
  assert.equal(input.use_case, 'GAMING');
  assert.deepEqual(input.required_roles, VALID_INPUT.required_roles);
  assert.ok(Object.isFrozen(input));
  assert.ok(Object.isFrozen(input.required_roles));
});

test('rejects non-object input', () => {
  for (const bad of [null, undefined, 42, 'input', [VALID_INPUT]]) {
    const error = errorOf(() => createCandidateSelectionInput(bad));
    assert.ok(error instanceof CandidateSelectionError);
    assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
  }
});

test('rejects missing required fields with machine-readable codes', () => {
  for (const field of ['budget_amount', 'currency', 'use_case', 'required_roles']) {
    const raw = { ...VALID_INPUT };
    delete raw[field];
    const error = errorOf(() => createCandidateSelectionInput(raw));
    assert.ok(error instanceof CandidateSelectionError, `expected error for ${field}`);
    assert.equal(error.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
    assert.equal(error.field, field);
  }
});

test('rejects explicit null fields', () => {
  for (const field of ['budget_amount', 'currency', 'use_case', 'required_roles']) {
    const error = errorOf(() =>
      createCandidateSelectionInput({ ...VALID_INPUT, [field]: null })
    );
    assert.equal(error.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
    assert.equal(error.field, field);
  }
});

test('rejects invalid budget amounts', () => {
  for (const bad of [0, -100, NaN, Infinity, '8000']) {
    const error = errorOf(() =>
      createCandidateSelectionInput({ ...VALID_INPUT, budget_amount: bad })
    );
    assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE);
    assert.equal(error.field, 'budget_amount');
  }
});

test('rejects invalid currency codes', () => {
  for (const bad of ['usd', 'EURR', 'D', 123, 'mad ']) {
    const error = errorOf(() =>
      createCandidateSelectionInput({ ...VALID_INPUT, currency: bad })
    );
    assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE);
    assert.equal(error.field, 'currency');
  }
});

test('rejects an empty use case', () => {
  const error = errorOf(() =>
    createCandidateSelectionInput({ ...VALID_INPUT, use_case: '   ' })
  );
  assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(error.field, 'use_case');
});

test('rejects an empty or non-array required_roles', () => {
  for (const bad of [[], 'CPU', 7]) {
    const error = errorOf(() =>
      createCandidateSelectionInput({ ...VALID_INPUT, required_roles: bad })
    );
    assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE);
    assert.equal(error.field, 'required_roles');
  }
});

test('rejects unknown component roles in required_roles', () => {
  const error = errorOf(() =>
    createCandidateSelectionInput({ ...VALID_INPUT, required_roles: ['CPU', 'TOASTER'] })
  );
  assert.equal(error.code, ERROR_CODES.INVALID_COMPONENT_ROLE);
  assert.equal(error.field, 'required_roles');
});

test('rejects duplicate required roles', () => {
  const error = errorOf(() =>
    createCandidateSelectionInput({ ...VALID_INPUT, required_roles: ['CPU', 'CPU'] })
  );
  assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(error.field, 'required_roles');
});

test('errors expose a machine-readable shape', () => {
  const error = errorOf(() => createCandidateSelectionInput({}));
  assert.equal(error.name, 'CandidateSelectionError');
  assert.equal(error.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
  assert.equal(error.field, 'budget_amount');
  assert.deepEqual(error.toJSON(), {
    name: 'CandidateSelectionError',
    code: ERROR_CODES.MISSING_REQUIRED_FIELD,
    field: 'budget_amount',
    message: error.message,
  });
});

// ---------------------------------------------------------------------------
// Candidate record contract
// ---------------------------------------------------------------------------

test('accepts a valid candidate and preserves identity', () => {
  const candidate = createCandidate({
    product_id: 'product-9',
    product_variant_id: 'variant-3',
    category: 'GPU',
    component_role: 'GPU',
  });
  assert.equal(candidate.product_id, 'product-9');
  assert.equal(candidate.product_variant_id, 'variant-3');
  assert.equal(candidate.category, 'GPU');
  assert.equal(candidate.component_role, 'GPU');
  assert.ok(Object.isFrozen(candidate));
  assert.deepEqual(Object.keys(candidate), [
    'product_id',
    'product_variant_id',
    'category',
    'component_role',
  ]);
});

test('treats an omitted variant as null (variant-less product)', () => {
  const candidate = createCandidate({
    product_id: 'product-2',
    category: 'MEMORY',
    component_role: 'RAM',
  });
  assert.equal(candidate.product_variant_id, null);
});

test('rejects a candidate without product_id', () => {
  const error = errorOf(() =>
    createCandidate({ category: 'CPU', component_role: 'CPU' })
  );
  assert.equal(error.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
  assert.equal(error.field, 'product_id');
});

test('rejects an invalid candidate role', () => {
  for (const bad of ['VIDEO_CARD', 'cpu', 'SSD', 42, null, undefined]) {
    const error = errorOf(() =>
      createCandidate({ product_id: 'p', category: 'GPU', component_role: bad })
    );
    assert.ok(error instanceof CandidateSelectionError, `expected error for ${bad}`);
    assert.equal(error.code, ERROR_CODES.INVALID_COMPONENT_ROLE);
    assert.equal(error.field, 'component_role');
  }
});

test('rejects an invalid product category', () => {
  const error = errorOf(() =>
    createCandidate({
      product_id: 'p',
      category: 'STORAGE_DEVICE',
      component_role: 'SSD_BOOT',
    })
  );
  assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(error.field, 'category');
});

test('rejects an invalid product/category relationship', () => {
  const error = errorOf(() =>
    createCandidate({ product_id: 'p', category: 'GPU', component_role: 'RAM' })
  );
  assert.equal(error.code, ERROR_CODES.ROLE_CATEGORY_MISMATCH);
  assert.equal(error.field, 'category');
});

test('rejects non-object candidates', () => {
  for (const bad of [null, undefined, 'candidate', 7]) {
    const error = errorOf(() => createCandidate(bad));
    assert.equal(error.code, ERROR_CODES.INVALID_CANDIDATE);
  }
});

// ---------------------------------------------------------------------------
// Role / category eligibility -> candidate pool
// ---------------------------------------------------------------------------

test('selects only candidates whose role is required', () => {
  const candidates = [
    makeCandidate({ product_id: 'cpu-1', category: 'CPU', component_role: 'CPU' }),
    makeCandidate({
      product_id: 'gpu-1',
      product_variant_id: 'gpu-var-1',
      category: 'GPU',
      component_role: 'GPU',
    }),
    // CASE is not in required_roles below: must be excluded.
    makeCandidate({ product_id: 'case-1', category: 'CASE', component_role: 'CASE' }),
    makeCandidate({ product_id: 'psu-1', category: 'PSU', component_role: 'PSU' }),
  ];
  const input = { ...VALID_INPUT, required_roles: ['CPU', 'GPU', 'PSU'] };
  const { pool } = selectCandidatePool(input, candidates);
  assert.deepEqual(
    pool.map((candidate) => candidate.product_id),
    ['cpu-1', 'gpu-1', 'psu-1']
  );
});

test('selects multiple eligible candidates', () => {
  const candidates = [
    makeCandidate({ product_id: 'cpu-b' }),
    makeCandidate({ product_id: 'cpu-a' }),
    makeCandidate({
      product_id: 'gpu-prod',
      product_variant_id: 'gpu-var-z',
      category: 'GPU',
      component_role: 'GPU',
    }),
    makeCandidate({
      product_id: 'gpu-prod',
      product_variant_id: 'gpu-var-y',
      category: 'GPU',
      component_role: 'GPU',
    }),
  ];
  const input = { ...VALID_INPUT, required_roles: ['CPU', 'GPU'] };
  const { pool } = selectCandidatePool(input, candidates);
  assert.equal(pool.length, 4);
  assert.deepEqual(
    pool.map(
      (candidate) => `${candidate.component_role}:${candidate.product_id}:${candidate.product_variant_id ?? '-'}`
    ),
    ['CPU:cpu-a:-', 'CPU:cpu-b:-', 'GPU:gpu-prod:gpu-var-y', 'GPU:gpu-prod:gpu-var-z']
  );
});

test('pool selection enforces the role/category relationship', () => {
  const error = errorOf(() =>
    selectCandidatePool(VALID_INPUT, [
      makeCandidate({ product_id: 'p', category: 'COOLER', component_role: 'CPU' }),
    ])
  );
  assert.equal(error.code, ERROR_CODES.ROLE_CATEGORY_MISMATCH);
});

test('rejects an empty candidate pool', () => {
  const error = errorOf(() => selectCandidatePool(VALID_INPUT, []));
  assert.ok(error instanceof CandidateSelectionError);
  assert.equal(error.code, ERROR_CODES.EMPTY_CANDIDATE_POOL);
  assert.equal(error.field, 'candidates');
});

test('rejects a non-array candidate list', () => {
  const error = errorOf(() => selectCandidatePool(VALID_INPUT, 'cpu'));
  assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
  assert.equal(error.field, 'candidates');
});

test('rejects malformed candidates inside the pool', () => {
  const error = errorOf(() =>
    selectCandidatePool(VALID_INPUT, [makeCandidate({ component_role: 'TOASTER' })])
  );
  assert.equal(error.code, ERROR_CODES.INVALID_COMPONENT_ROLE);
});

test('selection result, pool and input are frozen', () => {
  const result = selectCandidatePool(VALID_INPUT, [makeCandidate()]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.pool));
  assert.ok(Object.isFrozen(result.input));
});

test('accepts an already-validated selection input', () => {
  const input = createCandidateSelectionInput(VALID_INPUT);
  const result = selectCandidatePool(input, [makeCandidate()]);
  assert.deepEqual(result.input, input);
});

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

test('orders by role enum order, then product id, then variant', () => {
  const candidates = [
    makeCandidate({
      product_id: 'gpu-prod',
      product_variant_id: 'v2',
      category: 'GPU',
      component_role: 'GPU',
    }),
    makeCandidate({
      product_id: 'gpu-prod',
      product_variant_id: 'v1',
      category: 'GPU',
      component_role: 'GPU',
    }),
    makeCandidate({ product_id: 'b' }),
    makeCandidate({ product_id: 'a' }),
    makeCandidate({ product_id: 'zz', category: 'GPU', component_role: 'GPU', product_variant_id: 'v0' }),
    makeCandidate({ product_id: 'aa', category: 'PSU', component_role: 'PSU' }),
  ];
  const input = { ...VALID_INPUT, required_roles: ['CPU', 'GPU', 'PSU'] };
  const { pool } = selectCandidatePool(input, candidates);
  assert.deepEqual(
    pool.map((candidate) => `${candidate.product_id}:${candidate.product_variant_id ?? '-'}`),
    ['a:-', 'b:-', 'gpu-prod:v1', 'gpu-prod:v2', 'zz:v0', 'aa:-']
  );
});

test('selection is deterministic across input order and repeated runs', () => {
  const mk = (id, role, category, variant = null) =>
    makeCandidate({
      product_id: id,
      component_role: role,
      category,
      product_variant_id: variant,
    });
  const base = [
    mk('c1', 'GPU', 'GPU', 'kit-b'),
    mk('c1', 'GPU', 'GPU', 'kit-a'),
    mk('c2', 'CPU', 'CPU'),
    mk('c0', 'CASE', 'CASE'),
  ];
  const input = { ...VALID_INPUT, required_roles: ['CPU', 'GPU', 'CASE'] };
  const idsOf = (result) =>
    result.pool.map(
      (candidate) =>
        `${candidate.product_id}/${candidate.component_role}/${candidate.product_variant_id ?? '-'}`
    );

  const first = selectCandidatePool(input, base);
  const second = selectCandidatePool(input, [...base].reverse());
  const shuffled = selectCandidatePool(input, [
    mk('c0', 'CASE', 'CASE'),
    mk('c1', 'GPU', 'GPU', 'kit-a'),
    mk('c2', 'CPU', 'CPU'),
    mk('c1', 'GPU', 'GPU', 'kit-b'),
  ]);

  assert.deepEqual(idsOf(first), idsOf(second));
  assert.deepEqual(idsOf(first), idsOf(shuffled));
  assert.deepEqual(idsOf(first), [
    'c2/CPU/-',
    'c1/GPU/kit-a',
    'c1/GPU/kit-b',
    'c0/CASE/-',
  ]);
});

// ---------------------------------------------------------------------------
// Identity preservation
// ---------------------------------------------------------------------------

test('preserves product and variant IDs exactly', () => {
  const candidates = [
    makeCandidate({
      product_id: '11111111-1111-1111-1111-111111111111',
      product_variant_id: '22222222-2222-2222-2222-222222222222',
      category: 'GPU',
      component_role: 'GPU',
    }),
    makeCandidate({
      product_id: '33333333-3333-3333-3333-333333333333',
      category: 'MOTHERBOARD',
      component_role: 'MOTHERBOARD',
    }),
  ];
  const { pool } = selectCandidatePool(VALID_INPUT, candidates);
  assert.deepEqual(
    pool.map((candidate) => candidate.product_id),
    [
      '11111111-1111-1111-1111-111111111111',
      '33333333-3333-3333-3333-333333333333',
    ]
  );
  assert.equal(pool[0].product_variant_id, '22222222-2222-2222-2222-222222222222');
  assert.equal(pool[1].product_variant_id, null);
});




