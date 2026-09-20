'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateEngine3Input } = require('./input');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

// Strict mode is enabled file-wide so that writes to frozen structures raise a
// TypeError instead of silently no-oping (test group L).

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const CONTRACT_FIELDS = [
  'results',
  'budget_amount',
  'currency',
  'required_roles',
  'use_case',
  'gpu_required_use_cases',
  'integrated_gpu_present',
  'candidate_caps',
  'prices',
  'filtering_context',
];

/** Minimal frozen Engine 2D context shape (Decision 16; content is unread here). */
const FILTERING_CONTEXT = Object.freeze({
  candidates: Object.freeze({}),
  specs: Object.freeze({}),
  platform_by_socket: Object.freeze({}),
  compat: Object.freeze({}),
});

function makeInput(overrides = {}) {
  return {
    results: [],
    budget_amount: 8000,
    currency: 'MAD',
    required_roles: ['CPU', 'MOTHERBOARD', 'RAM'],
    use_case: 'GAMING',
    gpu_required_use_cases: ['GAMING'],
    integrated_gpu_present: { CPU1: true, CPU2: false, CPU3: null },
    candidate_caps: { top_k_per_role: 5, max_builds_per_query: 10 },
    prices: {},
    filtering_context: FILTERING_CONTEXT,
    ...overrides,
  };
}

function makeCaps(overrides = {}) {
  return { top_k_per_role: 5, max_builds_per_query: 10, ...overrides };
}

/** Predicate for assert.throws: stable machine-readable error shape. */
function expectError(code, field) {
  return (error) => {
    if (!(error instanceof CandidateSelectionError)) return false;
    if (error.name !== 'CandidateSelectionError') return false;
    if (error.code !== code) return false;
    return field === undefined ? true : error.field === field;
  };
}

// ---------------------------------------------------------------------------
// A. Top-level shape
// ---------------------------------------------------------------------------

test('accepts a valid Engine 3 input and preserves every field value', () => {
  const input = validateEngine3Input(makeInput());
  assert.deepEqual(Object.keys(input), CONTRACT_FIELDS);
  assert.equal(input.budget_amount, 8000);
  assert.equal(input.currency, 'MAD');
  assert.equal(input.use_case, 'GAMING');
  assert.deepEqual(input.required_roles, ['CPU', 'MOTHERBOARD', 'RAM']);
  assert.deepEqual(input.gpu_required_use_cases, ['GAMING']);
  assert.deepEqual(input.integrated_gpu_present, { CPU1: true, CPU2: false, CPU3: null });
  assert.deepEqual(input.candidate_caps, { top_k_per_role: 5, max_builds_per_query: 10 });
});

test('rejects non-object top-level input with INVALID_INPUT', () => {
  for (const bad of [null, undefined, 42, 'input', true, ['ok'], []]) {
    assert.throws(
      () => validateEngine3Input(bad),
      expectError(ERROR_CODES.INVALID_INPUT),
      `expected INVALID_INPUT for ${JSON.stringify(bad)}`
    );
  }
});

test('rejects every missing required field with MISSING_REQUIRED_FIELD', () => {
  for (const field of CONTRACT_FIELDS) {
    const raw = makeInput();
    delete raw[field];
    assert.throws(
      () => validateEngine3Input(raw),
      expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, field),
      `expected MISSING_REQUIRED_FIELD for ${field}`
    );
  }
});

test('rejects an empty object by naming the first contract field', () => {
  assert.throws(
    () => validateEngine3Input({}),
    expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, 'results')
  );
});

test('detects missing fields by own-property presence, not truthiness', () => {
  // false / null / 0 / [] are all legitimate values: a present-but-invalid
  // value must be INVALID_FIELD_VALUE, never MISSING_REQUIRED_FIELD.
  assert.throws(
    () => validateEngine3Input(makeInput({ results: null })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'results')
  );
  assert.throws(
    () => validateEngine3Input(makeInput({ prices: null })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'prices')
  );
  assert.throws(
    () => validateEngine3Input(makeInput({ gpu_required_use_cases: null })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'gpu_required_use_cases')
  );

  // Zero-filled caps are present and therefore invalid, not missing.
  assert.throws(
    () => validateEngine3Input(makeInput({ candidate_caps: makeCaps({ top_k_per_role: 0 }) })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'candidate_caps.top_k_per_role')
  );

  // An explicitly empty results / gpu list is valid, not missing.
  const input = validateEngine3Input(makeInput({ results: [], gpu_required_use_cases: [] }));
  assert.deepEqual(input.results, []);
  assert.deepEqual(input.gpu_required_use_cases, []);
});

test('rejects unknown top-level keys', () => {
  assert.throws(
    () => validateEngine3Input(makeInput({ extra: 123 })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'extra')
  );
  assert.throws(
    () => validateEngine3Input(makeInput({ requiredRoles: ['CPU'] })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'requiredRoles')
  );
  // The ten-field vocabulary is closed: even similar-looking spellings fail.
  for (const key of ['result', 'budget', 'role_limits', 'builds', 'limit']) {
    assert.throws(
      () => validateEngine3Input(makeInput({ [key]: 1 })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, key)
    );
  }
});

test('accepts exactly the ten-field vocabulary', () => {
  const raw = makeInput();
  assert.deepEqual(Object.keys(raw).sort(), [...CONTRACT_FIELDS].sort());
  assert.ok(Object.isFrozen(validateEngine3Input(raw)));
});

test('filtering_context: top-level shape only, reference preserved, never frozen', () => {
  // A present-but-invalid value is INVALID_FIELD_VALUE, never MISSING_REQUIRED_FIELD.
  assert.throws(
    () => validateEngine3Input(makeInput({ filtering_context: null })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'filtering_context')
  );
  for (const bad of ['context', 42, true, ['ctx']]) {
    assert.throws(
      () => validateEngine3Input(makeInput({ filtering_context: bad })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'filtering_context'),
      `expected INVALID_FIELD_VALUE for ${JSON.stringify(bad)}`
    );
  }

  // The reference is preserved byte-for-byte: no copy, no freeze (the B2-B
  // loader already delivers a deep-frozen context).
  const context = {
    candidates: { CPU: [] },
    specs: { 'p:cpu': { socket_id: 'am5' } },
    platform_by_socket: {},
    compat: {},
  };
  const input = validateEngine3Input(makeInput({ filtering_context: context }));
  assert.strictEqual(input.filtering_context, context);
  assert.equal(Object.isFrozen(input.filtering_context), false);

  // Content is NOT inspected here: an object of arbitrary shape passes.
  const shapeless = validateEngine3Input(makeInput({ filtering_context: { anything: true } }));
  assert.deepEqual(shapeless.filtering_context, { anything: true });
});

// ---------------------------------------------------------------------------
// B. results
// ---------------------------------------------------------------------------

test('accepts an empty results array', () => {
  const input = validateEngine3Input(makeInput({ results: [] }));
  assert.deepEqual(input.results, []);
  assert.equal(input.results.length, 0);
});

test('accepts a populated results array without inspecting its entries', () => {
  const verdicts = [
    { product_id: 'p1', component_role: 'CPU', status: 'UNKNOWN' },
    null,
    42,
  ];
  const input = validateEngine3Input(makeInput({ results: verdicts }));
  assert.equal(input.results.length, 3);
  // Entries are passed through untouched (no validation, no cloning).
  assert.equal(input.results[0], verdicts[0]);
  assert.equal(input.results[1], verdicts[1]);
  assert.equal(input.results[2], verdicts[2]);
});

test('rejects non-array results', () => {
  for (const bad of ['cpu', {}, null, 42, true, undefined]) {
    assert.throws(
      () => validateEngine3Input(makeInput({ results: bad })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'results')
    );
  }
});

// ---------------------------------------------------------------------------
// C. budget_amount
// ---------------------------------------------------------------------------

test('accepts finite positive budget amounts', () => {
  for (const good of [100, 0.01, 8000, Number.MAX_SAFE_INTEGER]) {
    assert.equal(validateEngine3Input(makeInput({ budget_amount: good })).budget_amount, good);
  }
});

test('rejects invalid budget amounts', () => {
  for (const bad of [0, -1, -0.01, NaN, Infinity, -Infinity, '100', null, true, {}, []]) {
    assert.throws(
      () => validateEngine3Input(makeInput({ budget_amount: bad })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'budget_amount'),
      `expected INVALID_FIELD_VALUE for budget_amount=${String(bad)}`
    );
  }
});

// ---------------------------------------------------------------------------
// D. currency
// ---------------------------------------------------------------------------

test('accepts 3-letter uppercase ISO 4217 currency codes', () => {
  for (const good of ['MAD', 'USD', 'GBP', 'EUR']) {
    assert.equal(validateEngine3Input(makeInput({ currency: good })).currency, good);
  }
});

test('rejects invalid currency codes without trimming', () => {
  for (const bad of ['usd', 'US', 'USDD', '', ' USD', 'USD ', 'Mad', '123', null, 123, true]) {
    assert.throws(
      () => validateEngine3Input(makeInput({ currency: bad })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'currency'),
      `expected INVALID_FIELD_VALUE for currency=${String(bad)}`
    );
  }
});

// ---------------------------------------------------------------------------
// E. required_roles
// ---------------------------------------------------------------------------

test('accepts a valid role list and preserves its order', () => {
  const roles = ['RAM', 'CPU', 'GPU', 'SSD_SECONDARY'];
  const input = validateEngine3Input(makeInput({ required_roles: roles }));
  assert.deepEqual(input.required_roles, roles);
  // Order is caller-declared semantics, not a traversal order.
  assert.notDeepEqual(input.required_roles, [...roles].sort());
});

test('accepts a single-role list', () => {
  assert.deepEqual(
    validateEngine3Input(makeInput({ required_roles: ['CPU'] })).required_roles,
    ['CPU']
  );
});

test('rejects an empty or non-array required_roles', () => {
  for (const bad of [[], 'CPU', 7, null, undefined, {}]) {
    assert.throws(
      () => validateEngine3Input(makeInput({ required_roles: bad })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'required_roles'),
      `expected INVALID_FIELD_VALUE for required_roles=${String(bad)}`
    );
  }
});

test('rejects duplicate required roles', () => {
  assert.throws(
    () => validateEngine3Input(makeInput({ required_roles: ['CPU', 'CPU'] })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'required_roles')
  );
  assert.throws(
    () => validateEngine3Input(makeInput({ required_roles: ['CPU', 'GPU', 'CPU'] })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'required_roles')
  );
});

test('rejects unknown component roles with the role-specific error code', () => {
  for (const bad of ['TOASTER', 'cpu', 'GPUS', '']) {
    assert.throws(
      () => validateEngine3Input(makeInput({ required_roles: ['CPU', bad] })),
      expectError(ERROR_CODES.INVALID_COMPONENT_ROLE, 'required_roles'),
      `expected INVALID_COMPONENT_ROLE for role=${String(bad)}`
    );
  }
});

test('rejects non-string role elements with the role-specific error code', () => {
  for (const bad of [123, null, undefined, true, {}, [], ['CPU']]) {
    assert.throws(
      () => validateEngine3Input(makeInput({ required_roles: ['CPU', bad] })),
      expectError(ERROR_CODES.INVALID_COMPONENT_ROLE, 'required_roles'),
      `expected INVALID_COMPONENT_ROLE for element=${String(bad)}`
    );
  }
});

// ---------------------------------------------------------------------------
// F. use_case
// ---------------------------------------------------------------------------

test('accepts and preserves a use case verbatim', () => {
  for (const good of ['GAMING', 'GAMING ', ' GAMING', ' GAMING ']) {
    const input = validateEngine3Input(makeInput({ use_case: good }));
    assert.equal(input.use_case, good);
    assert.equal(input.use_case.length, good.length);
  }
});

test('rejects blank or non-string use cases', () => {
  for (const bad of ['', ' ', '   ', '\t', null, 123, true, {}, []]) {
    assert.throws(
      () => validateEngine3Input(makeInput({ use_case: bad })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'use_case'),
      `expected INVALID_FIELD_VALUE for use_case=${JSON.stringify(bad)}`
    );
  }
});

// ---------------------------------------------------------------------------
// G. gpu_required_use_cases
// ---------------------------------------------------------------------------

test('accepts an empty gpu_required_use_cases array', () => {
  assert.deepEqual(
    validateEngine3Input(makeInput({ gpu_required_use_cases: [] })).gpu_required_use_cases,
    []
  );
});

test('accepts gpu_required_use_cases entries and duplicates', () => {
  const cases = ['GAMING', 'AI'];
  assert.deepEqual(
    validateEngine3Input(makeInput({ gpu_required_use_cases: cases })).gpu_required_use_cases,
    cases
  );
  assert.deepEqual(
    validateEngine3Input(makeInput({ gpu_required_use_cases: ['GAMING', 'GAMING'] }))
      .gpu_required_use_cases,
    ['GAMING', 'GAMING']
  );
});

test('preserves gpu_required_use_cases whitespace byte-for-byte', () => {
  const input = validateEngine3Input(makeInput({ gpu_required_use_cases: [' GAMING '] }));
  assert.deepEqual(input.gpu_required_use_cases, [' GAMING ']);
  assert.equal(input.gpu_required_use_cases[0], ' GAMING ');
  assert.notEqual(input.gpu_required_use_cases[0], 'GAMING');
});

test('rejects non-array gpu_required_use_cases (never defaulted)', () => {
  for (const bad of [null, undefined, 'GAMING', 123, false, {}, new Set(['GAMING'])]) {
    assert.throws(
      () => validateEngine3Input(makeInput({ gpu_required_use_cases: bad })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'gpu_required_use_cases'),
      `expected INVALID_FIELD_VALUE for gpu_required_use_cases=${String(bad)}`
    );
  }
});

test('rejects blank or non-string gpu_required_use_cases entries', () => {
  for (const bad of ['', '   ', 123, null, undefined, false, {}]) {
    assert.throws(
      () => validateEngine3Input(makeInput({ gpu_required_use_cases: [bad] })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'gpu_required_use_cases'),
      `expected INVALID_FIELD_VALUE for entry=${String(bad)}`
    );
  }
});

// ---------------------------------------------------------------------------
// H. integrated_gpu_present
// ---------------------------------------------------------------------------

test('accepts a CPU-keyed true / false / null map', () => {
  const map = { CPU1: true, CPU2: false, CPU3: null };
  const input = validateEngine3Input(makeInput({ integrated_gpu_present: map }));
  assert.deepEqual(input.integrated_gpu_present, map);
  assert.equal(input.integrated_gpu_present.CPU1, true);
  assert.equal(input.integrated_gpu_present.CPU2, false);
  assert.equal(input.integrated_gpu_present.CPU3, null);
});

test('accepts an empty integrated_gpu_present map', () => {
  assert.deepEqual(
    validateEngine3Input(makeInput({ integrated_gpu_present: {} })).integrated_gpu_present,
    {}
  );
});

test('accepts a map that omits some CPU keys', () => {
  const input = validateEngine3Input(
    makeInput({ integrated_gpu_present: { CPU_ONLY: true } })
  );
  assert.deepEqual(input.integrated_gpu_present, { CPU_ONLY: true });
  assert.equal(Object.prototype.hasOwnProperty.call(input.integrated_gpu_present, 'CPU2'), false);
});

test('rejects coerced or undefined integrated_gpu_present values', () => {
  for (const bad of [0, 1, 'true', 'false', '', undefined, {}, [], NaN]) {
    assert.throws(
      () => validateEngine3Input(makeInput({ integrated_gpu_present: { CPU1: bad } })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'integrated_gpu_present'),
      `expected INVALID_FIELD_VALUE for value=${String(bad)}`
    );
  }
});

test('rejects an empty-string key in integrated_gpu_present', () => {
  assert.throws(
    () => validateEngine3Input(makeInput({ integrated_gpu_present: { '': true } })),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'integrated_gpu_present')
  );
});

test('rejects a non-object integrated_gpu_present', () => {
  for (const bad of [null, undefined, [], 'CPU1', 42, true]) {
    assert.throws(
      () => validateEngine3Input(makeInput({ integrated_gpu_present: bad })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'integrated_gpu_present'),
      `expected INVALID_FIELD_VALUE for integrated_gpu_present=${String(bad)}`
    );
  }
});

// ---------------------------------------------------------------------------
// I. candidate_caps
// ---------------------------------------------------------------------------

test('accepts positive integer candidate caps', () => {
  const input = validateEngine3Input(
    makeInput({ candidate_caps: { top_k_per_role: 1, max_builds_per_query: 250 } })
  );
  assert.deepEqual(input.candidate_caps, { top_k_per_role: 1, max_builds_per_query: 250 });
});

test('rejects non-positive, fractional or non-finite caps', () => {
  for (const bad of [0, -1, -5, 1.5, 0.5, NaN, Infinity, -Infinity, '5', null, true, {}, []]) {
    assert.throws(
      () => validateEngine3Input(makeInput({ candidate_caps: makeCaps({ top_k_per_role: bad }) })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'candidate_caps.top_k_per_role'),
      `expected INVALID_FIELD_VALUE for top_k_per_role=${String(bad)}`
    );
    assert.throws(
      () => validateEngine3Input(makeInput({ candidate_caps: makeCaps({ max_builds_per_query: bad }) })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'candidate_caps.max_builds_per_query'),
      `expected INVALID_FIELD_VALUE for max_builds_per_query=${String(bad)}`
    );
  }
});

test('rejects a missing nested candidate_caps field', () => {
  assert.throws(
    () => validateEngine3Input(makeInput({ candidate_caps: { max_builds_per_query: 10 } })),
    expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, 'candidate_caps.top_k_per_role')
  );
  assert.throws(
    () => validateEngine3Input(makeInput({ candidate_caps: { top_k_per_role: 5 } })),
    expectError(ERROR_CODES.MISSING_REQUIRED_FIELD, 'candidate_caps.max_builds_per_query')
  );
});

test('rejects unknown nested candidate_caps keys', () => {
  assert.throws(
    () =>
      validateEngine3Input(
        makeInput({ candidate_caps: { top_k_per_role: 5, max_builds_per_query: 10, extra: 123 } })
      ),
    expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'candidate_caps.extra')
  );
});

test('rejects a non-object candidate_caps', () => {
  for (const bad of [null, undefined, [], 'caps', 42, true]) {
    assert.throws(
      () => validateEngine3Input(makeInput({ candidate_caps: bad })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'candidate_caps'),
      `expected INVALID_FIELD_VALUE for candidate_caps=${String(bad)}`
    );
  }
});

test('validates candidate_caps but never applies them', () => {
  const results = Array.from({ length: 12 }, (_, index) => ({ product_id: `p${index}` }));
  const input = validateEngine3Input(
    makeInput({ results, candidate_caps: { top_k_per_role: 2, max_builds_per_query: 1 } })
  );
  // No truncation, no re-application: caps are contract data only.
  assert.equal(input.results.length, 12);
  assert.deepEqual(input.candidate_caps, { top_k_per_role: 2, max_builds_per_query: 1 });
});

// ---------------------------------------------------------------------------
// J. prices
// ---------------------------------------------------------------------------

test('accepts an empty prices object', () => {
  assert.deepEqual(validateEngine3Input(makeInput({ prices: {} })).prices, {});
});

test('accepts a plain object of price entries without inspecting them', () => {
  const prices = {
    '11111111-1111-1111-1111-111111111111': {
      selected_price: 1299.5,
      currency: 'MAD',
      store_id: 'store-1',
      price_checked_at: '2026-09-14T00:00:00.000Z',
    },
    // Arbitrary entry shapes pass at this layer: prices.js owns the carrier.
    '22222222-2222-2222-2222-222222222222': { anything: ['goes', null, 0] },
  };
  const input = validateEngine3Input(makeInput({ prices }));
  // The reference is preserved: price-carrier ownership belongs to prices.js.
  assert.equal(input.prices, prices);
  assert.equal(input.prices['11111111-1111-1111-1111-111111111111'].selected_price, 1299.5);
});

test('rejects non-object prices', () => {
  for (const bad of [null, undefined, [], 'prices', 42, true]) {
    assert.throws(
      () => validateEngine3Input(makeInput({ prices: bad })),
      expectError(ERROR_CODES.INVALID_FIELD_VALUE, 'prices'),
      `expected INVALID_FIELD_VALUE for prices=${String(bad)}`
    );
  }
});

// ---------------------------------------------------------------------------
// K. Freezing
// ---------------------------------------------------------------------------

test('returns a frozen input with frozen owned structures', () => {
  const input = validateEngine3Input(makeInput());
  assert.equal(Object.isFrozen(input), true);
  assert.equal(Object.isFrozen(input.results), true);
  assert.equal(Object.isFrozen(input.required_roles), true);
  assert.equal(Object.isFrozen(input.gpu_required_use_cases), true);
  assert.equal(Object.isFrozen(input.integrated_gpu_present), true);
  assert.equal(Object.isFrozen(input.candidate_caps), true);
});

test('does not deep-freeze results entries or price entries', () => {
  const verdict = { product_id: 'p1', status: 'PASS' };
  const prices = { p1: { selected_price: 100 } };
  const input = validateEngine3Input(makeInput({ results: [verdict], prices }));

  // Shallow array freeze only: verdict objects stay caller-owned.
  assert.equal(Object.isFrozen(input.results), true);
  assert.equal(Object.isFrozen(verdict), false);
  assert.equal(Object.isFrozen(input.results[0]), false);

  // prices is preserved by reference and deliberately left unfrozen.
  assert.equal(input.prices, prices);
  assert.equal(Object.isFrozen(prices), false);
  assert.equal(Object.isFrozen(input.prices), false);
});

test('does not mutate the caller-owned input objects', () => {
  const raw = makeInput();
  validateEngine3Input(raw);
  assert.equal(Object.isFrozen(raw), false);
  assert.equal(Object.isFrozen(raw.results), false);
  assert.equal(Object.isFrozen(raw.required_roles), false);
  assert.equal(Object.isFrozen(raw.gpu_required_use_cases), false);
  assert.equal(Object.isFrozen(raw.integrated_gpu_present), false);
  assert.equal(Object.isFrozen(raw.candidate_caps), false);
});

// ---------------------------------------------------------------------------
// L. Mutation
// ---------------------------------------------------------------------------

test('returned structures reject mutation in strict mode', () => {
  const input = validateEngine3Input(makeInput());
  assert.throws(() => { input.budget_amount = 1; }, TypeError);
  assert.throws(() => { input.use_case = 'OTHER'; }, TypeError);
  assert.throws(() => { input.prices = {}; }, TypeError);
  assert.throws(() => { input.results.push({ product_id: 'x' }); }, TypeError);
  assert.throws(() => { input.required_roles[0] = 'GPU'; }, TypeError);
  assert.throws(() => { input.required_roles.push('GPU'); }, TypeError);
  assert.throws(() => { input.gpu_required_use_cases.push('AI'); }, TypeError);
  assert.throws(() => { input.integrated_gpu_present.CPU1 = false; }, TypeError);
  assert.throws(() => { delete input.integrated_gpu_present.CPU1; }, TypeError);
  assert.throws(() => { input.candidate_caps.top_k_per_role = 99; }, TypeError);
  assert.throws(() => { delete input.candidate_caps.max_builds_per_query; }, TypeError);
});

// ---------------------------------------------------------------------------
// M. Idempotency
// ---------------------------------------------------------------------------

test('is idempotent: revalidating a frozen input yields an equal frozen input', () => {
  const first = validateEngine3Input(makeInput());
  const second = validateEngine3Input(first);

  assert.deepEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(second), true);
  assert.equal(Object.isFrozen(second.results), true);
  assert.equal(Object.isFrozen(second.required_roles), true);
  assert.equal(Object.isFrozen(second.gpu_required_use_cases), true);
  assert.equal(Object.isFrozen(second.integrated_gpu_present), true);
  assert.equal(Object.isFrozen(second.candidate_caps), true);
});

test('is idempotent for an empty results pool', () => {
  const first = validateEngine3Input(makeInput({ results: [], gpu_required_use_cases: [] }));
  const second = validateEngine3Input(first);
  assert.deepEqual(second, first);
  assert.equal(Object.isFrozen(second), true);
});

// ---------------------------------------------------------------------------
// N. No semantic mutation
// ---------------------------------------------------------------------------

test('preserves caller-provided semantics byte-for-byte', () => {
  const raw = makeInput({
    use_case: ' GAMING ',
    gpu_required_use_cases: [' GAMING ', 'WORKSTATION '],
    integrated_gpu_present: { CPU1: true, CPU2: false, CPU3: null },
  });

  const input = validateEngine3Input(raw);

  assert.equal(input.use_case, ' GAMING ');
  assert.deepEqual(input.gpu_required_use_cases, [' GAMING ', 'WORKSTATION ']);
  assert.equal(input.gpu_required_use_cases[0], ' GAMING ');
  assert.equal(input.gpu_required_use_cases[1], 'WORKSTATION ');
  assert.deepEqual(input.integrated_gpu_present, { CPU1: true, CPU2: false, CPU3: null });
  assert.equal(input.integrated_gpu_present.CPU1, true);
  assert.equal(input.integrated_gpu_present.CPU2, false);
  assert.equal(input.integrated_gpu_present.CPU3, null);

  // The source fixture itself is untouched.
  assert.equal(raw.use_case, ' GAMING ');
  assert.deepEqual(raw.gpu_required_use_cases, [' GAMING ', 'WORKSTATION ']);
});

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

test('exports exactly validateEngine3Input with arity 1', () => {
  const moduleApi = require('./input');
  assert.deepEqual(Object.keys(moduleApi), ['validateEngine3Input']);
  assert.equal(typeof moduleApi.validateEngine3Input, 'function');
  assert.equal(moduleApi.validateEngine3Input.length, 1);
});

// ---------------------------------------------------------------------------
// Source boundaries (input.js must stay a structural contract gate)
// ---------------------------------------------------------------------------

const INPUT_SOURCE = fs.readFileSync(path.join(__dirname, 'input.js'), 'utf8');

// Literal substrings that would prove the module had crossed an architectural
// boundary (database access, SQL, another engine's internals, GPU policy, price
// lookup, quality scoring, build expansion). Generic-looking words are only
// listed because they name a boundary; the module's own comments deliberately
// avoid them, so a plain substring check stays honest.
const FORBIDDEN_SUBSTRINGS = [
  "require('pg')",
  'new Pool',
  '.query(',
  'SELECT ',
  'INSERT ',
  '../compatibility',
  '../filtering',
  'score',
  'rank',
  'penalt',
  'fresh',
  'store_offer',
  'assemble',
  'resolveGpuRequirement',
  'lookupPrice',
];

test('input.js contains no out-of-scope boundary crossings', () => {
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    assert.equal(
      INPUT_SOURCE.includes(needle),
      false,
      `input.js must not contain "${needle}"`
    );
  }
});

test('input.js depends only on the candidates vocabulary and error contract', () => {
  const requires = [...INPUT_SOURCE.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]);
  assert.deepEqual(requires, ['../candidates/roles', '../candidates/errors']);
});

test('input.js is a pure structural gate with no I/O or async surface', () => {
  assert.equal(INPUT_SOURCE.includes('async '), false);
  assert.equal(INPUT_SOURCE.includes('await '), false);
  assert.equal(INPUT_SOURCE.includes('process.env'), false);
  assert.equal(INPUT_SOURCE.includes('fetch('), false);
  assert.equal(INPUT_SOURCE.includes('Math.random'), false);
  assert.equal(INPUT_SOURCE.includes('Date.now'), false);
  // The only exported symbol is the validator.
  const exports_ = [...INPUT_SOURCE.matchAll(/module\.exports\s*=\s*\{([^}]*)\}/g)].map(
    (match) => match[1].replace(/\s/g, '')
  );
  assert.deepEqual(exports_, ['validateEngine3Input']);
});
