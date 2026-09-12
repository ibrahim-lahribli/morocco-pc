/**
 * Engine 2C - Candidate pool selection tests.
 *
 * Focused on the canonical selector (selectCandidatePool): eligibility,
 * variant-identity rules, duplicate handling, empty-pool contract,
 * deterministic ordering, and non-responsibilities (no compat, no budget,
 * no scoring). Does not weaken Engine 2A/2B tests.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ROLE_CATEGORIES,
  ROLE_ORDER,
  ERROR_CODES,
  CandidateSelectionError,
  selectCandidatePool,
} = require('./index');

const BASE_INPUT = {
  budget_amount: 8000,
  currency: 'MAD',
  use_case: 'GAMING',
  required_roles: ['CPU', 'GPU', 'MOTHERBOARD', 'RAM', 'SSD_BOOT', 'PSU', 'CASE', 'CPU_COOLER'],
};

function cpu(id) {
  return { product_id: id, product_variant_id: null, category: 'CPU', component_role: 'CPU' };
}

function gpu(productId, variantId) {
  return {
    product_id: productId,
    product_variant_id: variantId,
    category: 'GPU',
    component_role: 'GPU',
  };
}

function psu(id) {
  return { product_id: id, product_variant_id: null, category: 'PSU', component_role: 'PSU' };
}

function ram(id) {
  return { product_id: id, product_variant_id: null, category: 'MEMORY', component_role: 'RAM' };
}

function errorOf(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

test('valid requested roles produce candidates', () => {
  const { pool } = selectCandidatePool({ ...BASE_INPUT, required_roles: ['CPU', 'PSU'] }, [
    cpu('cpu-1'),
    psu('psu-1'),
  ]);
  assert.equal(pool.length, 2);
  assert.deepEqual(
    pool.map((c) => c.component_role),
    ['CPU', 'PSU']
  );
});

test('candidates for unrequested roles are excluded', () => {
  const { pool } = selectCandidatePool({ ...BASE_INPUT, required_roles: ['CPU'] }, [
    cpu('cpu-1'),
    psu('psu-1'),
    gpu('gpu-prod', 'gpu-var-1'),
  ]);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].component_role, 'CPU');
});

test('multiple candidates for the same role are retained', () => {
  const { pool } = selectCandidatePool({ ...BASE_INPUT, required_roles: ['CPU'] }, [
    cpu('cpu-a'),
    cpu('cpu-b'),
    cpu('cpu-c'),
  ]);
  assert.equal(pool.length, 3);
});

test('role/category mismatch is rejected', () => {
  const error = errorOf(() =>
    selectCandidatePool({ ...BASE_INPUT, required_roles: ['CPU'] }, [
      { product_id: 'p', product_variant_id: null, category: 'PSU', component_role: 'CPU' },
    ])
  );
  assert.ok(error instanceof CandidateSelectionError);
  assert.equal(error.code, ERROR_CODES.ROLE_CATEGORY_MISMATCH);
});

test('malformed candidates are rejected', () => {
  const badList = [
    { product_id: '', product_variant_id: null, category: 'CPU', component_role: 'CPU' },
    { product_id: 'cpu-1', product_variant_id: null, category: 'NOPE', component_role: 'CPU' },
    { product_id: 'cpu-1', product_variant_id: null, category: 'CPU', component_role: 'TOASTER' },
    { product_id: 'cpu-1', product_variant_id: 7, category: 'CPU', component_role: 'CPU' },
    null,
  ];
  for (const bad of badList) {
    const error = errorOf(() =>
      selectCandidatePool({ ...BASE_INPUT, required_roles: ['CPU'] }, [bad])
    );
    assert.ok(error instanceof CandidateSelectionError, 'expected rejection');
  }
});

test('exact duplicate identity behavior is deterministic', () => {
  const candidates = [cpu('cpu-1'), cpu('cpu-1'), cpu('cpu-2')];
  const first = selectCandidatePool({ ...BASE_INPUT, required_roles: ['CPU'] }, candidates);
  const second = selectCandidatePool(
    { ...BASE_INPUT, required_roles: ['CPU'] },
    [...candidates].reverse()
  );
  assert.equal(first.pool.length, 2);
  assert.deepEqual(
    first.pool.map((c) => c.product_id),
    ['cpu-1', 'cpu-2']
  );
  assert.deepEqual(
    second.pool.map((c) => c.product_id),
    ['cpu-1', 'cpu-2']
  );
});

test('distinct GPU variants are retained', () => {
  const { pool } = selectCandidatePool({ ...BASE_INPUT, required_roles: ['GPU'] }, [
    gpu('gpu-prod', 'var-a'),
    gpu('gpu-prod', 'var-b'),
  ]);
  assert.equal(pool.length, 2);
  assert.deepEqual(
    pool.map((c) => c.product_variant_id),
    ['var-a', 'var-b']
  );
});

test('GPU with null variant ID is rejected', () => {
  const error = errorOf(() =>
    selectCandidatePool({ ...BASE_INPUT, required_roles: ['GPU'] }, [
      { product_id: 'gpu-prod', product_variant_id: null, category: 'GPU', component_role: 'GPU' },
    ])
  );
  assert.ok(error instanceof CandidateSelectionError);
  assert.equal(error.code, ERROR_CODES.INVALID_CANDIDATE);
  assert.equal(error.field, 'product_variant_id');
});

test('non-GPU candidate with variant ID is rejected', () => {
  const badList = [
    { product_id: 'cpu-1', product_variant_id: 'v1', category: 'CPU', component_role: 'CPU' },
    { product_id: 'ram-1', product_variant_id: 'kit-a', category: 'MEMORY', component_role: 'RAM' },
    { product_id: 'psu-1', product_variant_id: 'v9', category: 'PSU', component_role: 'PSU' },
  ];
  for (const bad of badList) {
    const error = errorOf(() =>
      selectCandidatePool({ ...BASE_INPUT, required_roles: [bad.component_role] }, [bad])
    );
    assert.ok(error instanceof CandidateSelectionError, 'expected rejection');
    assert.equal(error.code, ERROR_CODES.INVALID_CANDIDATE);
    assert.equal(error.field, 'product_variant_id');
  }
});

test('empty requested role follows the EMPTY_CANDIDATE_POOL contract', () => {
  const emptyRaw = errorOf(() =>
    selectCandidatePool({ ...BASE_INPUT, required_roles: ['CPU'] }, [])
  );
  assert.equal(emptyRaw.code, ERROR_CODES.EMPTY_CANDIDATE_POOL);

  const allFiltered = errorOf(() =>
    selectCandidatePool({ ...BASE_INPUT, required_roles: ['CPU'] }, [psu('psu-1')])
  );
  assert.ok(allFiltered instanceof CandidateSelectionError);
  assert.equal(allFiltered.code, ERROR_CODES.EMPTY_CANDIDATE_POOL);
  assert.equal(allFiltered.field, 'candidates');

  const { pool } = selectCandidatePool({ ...BASE_INPUT, required_roles: ['CPU', 'PSU'] }, [
    cpu('cpu-1'),
    gpu('gpu-prod', 'gpu-var-1'),
  ]);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].component_role, 'CPU');
});

test('no candidate fabrication', () => {
  const candidates = [cpu('cpu-1'), cpu('cpu-2')];
  const { pool } = selectCandidatePool({ ...BASE_INPUT, required_roles: ['CPU'] }, candidates);
  assert.ok(pool.length <= candidates.length);
  const known = new Set(candidates.map((c) => `${c.product_id}/${c.component_role}`));
  for (const c of pool) {
    assert.ok(known.has(`${c.product_id}/${c.component_role}`));
  }
});

test('no category substitution', () => {
  const { pool } = selectCandidatePool(
    { ...BASE_INPUT, required_roles: ['CPU', 'GPU', 'RAM', 'PSU'] },
    [cpu('cpu-1'), gpu('gpu-prod', 'gpu-var-1'), ram('ram-1'), psu('psu-1')]
  );
  for (const c of pool) {
    assert.equal(c.category, ROLE_CATEGORIES[c.component_role]);
  }
});

test('canonical role ordering', () => {
  const { pool } = selectCandidatePool(
    { ...BASE_INPUT, required_roles: ['CASE', 'CPU', 'GPU', 'PSU'] },
    [
      { product_id: 'case-1', product_variant_id: null, category: 'CASE', component_role: 'CASE' },
      psu('psu-1'),
      gpu('gpu-prod', 'gpu-var-1'),
      cpu('cpu-1'),
    ]
  );
  const orders = pool.map((c) => ROLE_ORDER[c.component_role]);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  assert.deepEqual(
    pool.map((c) => c.component_role),
    ['CPU', 'GPU', 'PSU', 'CASE']
  );
});

test('product ID ordering', () => {
  const { pool } = selectCandidatePool({ ...BASE_INPUT, required_roles: ['CPU'] }, [
    cpu('cpu-c'),
    cpu('cpu-a'),
    cpu('cpu-b'),
  ]);
  assert.deepEqual(
    pool.map((c) => c.product_id),
    ['cpu-a', 'cpu-b', 'cpu-c']
  );
});

test('variant ascending order within the same product', () => {
  const { pool } = selectCandidatePool({ ...BASE_INPUT, required_roles: ['GPU'] }, [
    gpu('gpu-prod', 'var-c'),
    gpu('gpu-prod', 'var-a'),
    gpu('gpu-prod', 'var-b'),
  ]);
  assert.deepEqual(
    pool.map((c) => c.product_variant_id),
    ['var-a', 'var-b', 'var-c']
  );
});

test('repeated execution produces deterministic results', () => {
  const candidates = [
    gpu('gpu-prod', 'var-b'),
    cpu('cpu-2'),
    psu('psu-1'),
    gpu('gpu-prod', 'var-a'),
    cpu('cpu-1'),
  ];
  const input = { ...BASE_INPUT, required_roles: ['CPU', 'GPU', 'PSU'] };
  const a = selectCandidatePool(input, candidates);
  const b = selectCandidatePool(input, candidates);
  assert.deepEqual(a.pool, b.pool);
});

test('budget does not affect the pool', () => {
  const candidates = [cpu('cpu-1'), psu('psu-1')];
  const low = selectCandidatePool(
    { ...BASE_INPUT, budget_amount: 1, required_roles: ['CPU', 'PSU'] },
    candidates
  );
  const high = selectCandidatePool(
    { ...BASE_INPUT, budget_amount: 9999999, required_roles: ['CPU', 'PSU'] },
    candidates
  );
  assert.deepEqual(low.pool, high.pool);
});

test('currency does not affect the pool', () => {
  const candidates = [cpu('cpu-1'), psu('psu-1')];
  const a = selectCandidatePool(
    { ...BASE_INPUT, currency: 'MAD', required_roles: ['CPU', 'PSU'] },
    candidates
  );
  const b = selectCandidatePool(
    { ...BASE_INPUT, currency: 'USD', required_roles: ['CPU', 'PSU'] },
    candidates
  );
  assert.deepEqual(a.pool, b.pool);
});

test('use_case does not affect the pool', () => {
  const candidates = [cpu('cpu-1'), psu('psu-1')];
  const a = selectCandidatePool(
    { ...BASE_INPUT, use_case: 'GAMING', required_roles: ['CPU', 'PSU'] },
    candidates
  );
  const b = selectCandidatePool(
    { ...BASE_INPUT, use_case: 'OFFICE', required_roles: ['CPU', 'PSU'] },
    candidates
  );
  assert.deepEqual(a.pool, b.pool);
});

test('no compatibility logic is executed', () => {
  const source = fs.readFileSync(path.join(__dirname, 'select.js'), 'utf8');
  const required = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  for (const spec of required) {
    assert.ok(!spec.includes('compat'), `select.js must not require ${spec}`);
    assert.ok(!spec.startsWith('../'), `select.js must not require parent module ${spec}`);
  }

  const { pool } = selectCandidatePool(
    { ...BASE_INPUT, required_roles: ['CPU', 'GPU', 'PSU'] },
    [cpu('cpu-x'), gpu('gpu-prod', 'gpu-huge'), psu('psu-tiny')]
  );
  assert.equal(pool.length, 3);

  for (const c of pool) {
    assert.deepEqual(Object.keys(c).sort(), [
      'category',
      'component_role',
      'product_id',
      'product_variant_id',
    ]);
  }
});

