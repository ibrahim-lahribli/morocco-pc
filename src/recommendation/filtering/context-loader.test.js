/**
 * Engine 2D - Filtering context loader foundation tests.
 *
 * Covers only the foundation boundary of loadFilteringContext():
 *   1. a valid Engine 2C candidate-pool result is accepted
 *   2. missing/invalid candidate-pool input is rejected
 *   3. missing/invalid db dependency is rejected
 *   4. the returned context has the required top-level shape
 *   5. Engine 2C candidate identity is preserved
 *   6. GPU/non-GPU variant identity is preserved
 *   7. the returned context is immutable at the level this foundation owns
 *   8. no database query is performed by the foundation-only implementation
 *   9. the existing Engine 2 candidate/error contracts are reused
 *
 * Does not duplicate Engine 2A/2B/2C coverage (candidates/*.test.js).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  COMPONENT_ROLES,
  ERROR_CODES,
  CandidateSelectionError,
  createCandidate,
  selectCandidatePool,
} = require('../candidates');

const { loadFilteringContext, CONTEXT_COMPAT_KEYS } = require('./index');

// ---------------------------------------------------------------------------
// Fixtures: genuine Engine 2C artifacts built through the real contracts.
// ---------------------------------------------------------------------------

const BASE_INPUT = {
  budget_amount: 9000,
  currency: 'MAD',
  use_case: 'GAMING',
  required_roles: [
    'CPU', 'GPU', 'MOTHERBOARD', 'RAM',
    'SSD_BOOT', 'SSD_SECONDARY', 'PSU', 'CASE', 'CPU_COOLER',
  ],
};

function candidate(category, role, id, variantId = null) {
  return { product_id: id, product_variant_id: variantId, category, component_role: role };
}

const cpu = (id) => candidate('CPU', 'CPU', id);
const motherboard = (id) => candidate('MOTHERBOARD', 'MOTHERBOARD', id);
const ram = (id) => candidate('MEMORY', 'RAM', id);
const gpu = (id, variantId) => candidate('GPU', 'GPU', id, variantId);
const ssd = (id, role) => candidate('STORAGE', role, id);
const psu = (id) => candidate('PSU', 'PSU', id);
const chassis = (id) => candidate('CASE', 'CASE', id);
const cooler = (id) => candidate('COOLER', 'CPU_COOLER', id);

const POOL_RESULT = selectCandidatePool({ ...BASE_INPUT }, [
  cpu('cpu-a'),
  motherboard('mb-a'),
  ram('ram-a'),
  gpu('gpu-prod', 'gpu-var-b'),
  gpu('gpu-prod', 'gpu-var-a'),
  ssd('ssd-boot-a', 'SSD_BOOT'),
  ssd('ssd-sec-a', 'SSD_SECONDARY'),
  psu('psu-a'),
  chassis('case-a'),
  cooler('cooler-a'),
]);

/** A db double that fails loudly if the foundation ever touches it. */
const NO_QUERY_DB = {
  query() {
    throw new Error('the Engine 2D foundation must not query the database');
  },
};

async function errorOf(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

// 1 -------------------------------------------------------------------------
test('valid Engine 2C candidate-pool result is accepted', async () => {
  const context = await loadFilteringContext(POOL_RESULT, NO_QUERY_DB);
  assert.ok(context);
});

// 2 -------------------------------------------------------------------------
test('missing or invalid candidate-pool input is rejected', async () => {
  const raw = { ...BASE_INPUT };
  const cases = [
    [null, ERROR_CODES.INVALID_INPUT],
    [undefined, ERROR_CODES.INVALID_INPUT],
    [42, ERROR_CODES.INVALID_INPUT],
    ['pool', ERROR_CODES.INVALID_INPUT],
    [[POOL_RESULT.pool[0]], ERROR_CODES.INVALID_INPUT],
    [{ pool: [cpu('cpu-a')] }, ERROR_CODES.MISSING_REQUIRED_FIELD],
    [{ input: raw }, ERROR_CODES.MISSING_REQUIRED_FIELD],
    [{ input: raw, pool: 'nope' }, ERROR_CODES.INVALID_FIELD_VALUE],
    [{ input: raw, pool: [] }, ERROR_CODES.EMPTY_CANDIDATE_POOL],
    [{ input: raw, pool: [null] }, ERROR_CODES.INVALID_CANDIDATE],
    [{ input: raw, pool: [{}] }, ERROR_CODES.MISSING_REQUIRED_FIELD],
    [{ input: raw, pool: [{ product_id: 'p', product_variant_id: null, category: 'PSU', component_role: 'CPU' }] }, ERROR_CODES.ROLE_CATEGORY_MISMATCH],
    [{ input: raw, pool: [{ product_id: 'g', product_variant_id: null, category: 'GPU', component_role: 'GPU' }] }, ERROR_CODES.INVALID_CANDIDATE],
    [{ input: raw, pool: [{ product_id: 'c', product_variant_id: 'v', category: 'CPU', component_role: 'CPU' }] }, ERROR_CODES.INVALID_CANDIDATE],
    [{ input: { ...BASE_INPUT, budget_amount: 0 }, pool: POOL_RESULT.pool }, ERROR_CODES.INVALID_FIELD_VALUE],
  ];

  for (const [value, code] of cases) {
    const error = await errorOf(loadFilteringContext(value, NO_QUERY_DB));
    assert.ok(
      error instanceof CandidateSelectionError,
      'expected CandidateSelectionError for ' + JSON.stringify(value)
    );
    assert.equal(
      error.code,
      code,
      'expected code ' + code + ' for ' + JSON.stringify(value) + ', got ' + (error && error.code)
    );
  }
});

// 3 -------------------------------------------------------------------------
test('missing or invalid db dependency is rejected', async () => {
  for (const db of [null, undefined, 42, 'db', {}, { query: 'not-a-function' }]) {
    const error = await errorOf(loadFilteringContext(POOL_RESULT, db));
    assert.ok(
      error instanceof CandidateSelectionError,
      'expected CandidateSelectionError for db ' + String(db)
    );
    assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
    assert.equal(error.field, 'db');
  }
});

// 4 -------------------------------------------------------------------------
test('returned context has the required top-level shape', async () => {
  const context = await loadFilteringContext(POOL_RESULT, NO_QUERY_DB);

  assert.deepEqual(Object.keys(context), ['candidates', 'specs', 'platform_by_socket', 'compat']);
  assert.deepEqual(Object.keys(context.candidates), [...COMPONENT_ROLES]);
  assert.deepEqual(Object.keys(context.compat), [...CONTEXT_COMPAT_KEYS]);

  assert.deepEqual(context.specs, {});
  assert.deepEqual(context.platform_by_socket, {});
  for (const key of CONTEXT_COMPAT_KEYS) {
    assert.deepEqual(context.compat[key], {});
  }
});

// 5 -------------------------------------------------------------------------
test('candidate identity is preserved', async () => {
  const context = await loadFilteringContext(POOL_RESULT, NO_QUERY_DB);

  // Every pool candidate lands in its role bucket, unchanged and complete.
  for (const role of COMPONENT_ROLES) {
    assert.deepEqual(
      context.candidates[role],
      POOL_RESULT.pool.filter((c) => c.component_role === role)
    );
    for (const candidate of context.candidates[role]) {
      assert.deepEqual(Object.keys(candidate).sort(), [
        'category', 'component_role', 'product_id', 'product_variant_id',
      ]);
    }
  }

  // Sanity: the fixture actually spans roles.
  assert.equal(context.candidates.CPU.length, 1);
  assert.equal(context.candidates.GPU.length, 2);
  assert.equal(context.candidates.SSD_SECONDARY.length, 1);
});

// 6 -------------------------------------------------------------------------
test('GPU/non-GPU variant identity is preserved', async () => {
  const context = await loadFilteringContext(POOL_RESULT, NO_QUERY_DB);

  // GPU stays variant-keyed: distinct variants retained, never nulled.
  assert.deepEqual(
    context.candidates.GPU.map((c) => c.product_variant_id).sort(),
    ['gpu-var-a', 'gpu-var-b']
  );

  // Every non-GPU candidate stays product-keyed: variant id stays null.
  for (const role of COMPONENT_ROLES) {
    if (role === 'GPU') continue;
    for (const candidate of context.candidates[role]) {
      assert.equal(
        candidate.product_variant_id,
        null,
        role + ' must keep a null product_variant_id'
      );
    }
  }
});

// 7 -------------------------------------------------------------------------
test('returned context is immutable at the level this foundation owns', async () => {
  const context = await loadFilteringContext(POOL_RESULT, NO_QUERY_DB);

  assert.ok(Object.isFrozen(context));
  assert.ok(Object.isFrozen(context.candidates));
  assert.ok(Object.isFrozen(context.specs));
  assert.ok(Object.isFrozen(context.platform_by_socket));
  assert.ok(Object.isFrozen(context.compat));
  for (const role of COMPONENT_ROLES) {
    assert.ok(Object.isFrozen(context.candidates[role]), 'candidates bucket ' + role + ' must be frozen');
    for (const candidate of context.candidates[role]) {
      assert.ok(Object.isFrozen(candidate), 'candidate in ' + role + ' must be frozen');
    }
  }
  for (const key of CONTEXT_COMPAT_KEYS) {
    assert.ok(Object.isFrozen(context.compat[key]), 'compat key ' + key + ' must be frozen');
  }

  // Frozen in practice: strict-mode mutation attempts throw.
  assert.throws(() => {
    'use strict';
    context.specs.anything = 1;
  }, TypeError);
  assert.throws(() => {
    'use strict';
    context.candidates.CPU.push({});
  }, TypeError);

  // Caller-owned mutable pool data cannot leak into the returned context.
  const rawPool = [cpu('cpu-a'), gpu('gpu-prod', 'gpu-var-a')];
  const isolated = await loadFilteringContext(
    { input: { ...BASE_INPUT, required_roles: ['CPU', 'GPU'] }, pool: rawPool },
    NO_QUERY_DB
  );
  assert.equal(isolated.candidates.CPU.length, 1);
  rawPool.push(psu('psu-a'));
  assert.equal(isolated.candidates.CPU.length, 1);
  assert.equal(isolated.candidates.PSU.length, 0);
});

// 8 -------------------------------------------------------------------------
test('no database query is performed by the foundation-only implementation', async () => {
  let queryCalls = 0;
  const recordingDb = {
    query() {
      queryCalls += 1;
      throw new Error('the Engine 2D foundation must not query the database');
    },
  };

  const context = await loadFilteringContext(POOL_RESULT, recordingDb);
  assert.equal(queryCalls, 0);
  assert.ok(context);
});

// 9 -------------------------------------------------------------------------
test('existing Engine 2 candidate/error contracts are reused', async () => {
  const context = await loadFilteringContext(POOL_RESULT, NO_QUERY_DB);

  // Context records equal what the Engine 2A contract produces: frozen,
  // four-field identity. No parallel candidate schema.
  assert.deepEqual(context.candidates.CPU, [createCandidate(cpu('cpu-a'))]);
  assert.ok(Object.isFrozen(context.candidates.CPU[0]));
  assert.deepEqual(Object.keys(context.candidates.CPU[0]), [
    'product_id', 'product_variant_id', 'category', 'component_role',
  ]);

  // Rejections flow through the existing error type and its codes.
  const error = await errorOf(loadFilteringContext(null, NO_QUERY_DB));
  assert.ok(error instanceof CandidateSelectionError);
  assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
  assert.deepEqual(error.toJSON(), {
    name: 'CandidateSelectionError',
    code: ERROR_CODES.INVALID_INPUT,
    field: 'candidatePoolResult',
    message: error.message,
  });
});