'use strict';

// E7 - Engine 6 structured reason codes.
//
// This file proves, for the PURE deriveReasons function:
//   - the eight codes, one test each, with exact values and exact omission rules
//   - the canonical REASON_ORDER and the frozen/deep-frozen output contract
//   - determinism, purity (no argument mutation) and DB-freedom
//   - the read-path availability table asserted as executable facts: a
//     persisted build (flat `selected_price`, NO per-component status, NO
//     compatibility_notes) reconstructs exactly the three derivable codes and
//     omits the other five WITHOUT throwing
//   - agreement with the Engine 6 string: DOMINANT_ROLE / BIOS versions /
//     UNKNOWN roles are the SAME facts explain.js prints, because both call
//     ./build-facts.js (no second implementation)
//   - fail-fast guards for every malformed supplied input

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { deriveReasons, REASON_CODES, REASON_ORDER } = require('./reasons');
const { explainSelection } = require('./explain');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const BUDGET = Object.freeze({ amount: 4000, currency: 'MAD' });

/** The engine build's component shape: nested price, status, notes. */
function component(role, status, options = {}) {
  const price = options.price === undefined ? 100 : options.price;
  return Object.freeze({
    component_role: role,
    product_id: role + '-product',
    product_variant_id: null,
    category: 'x',
    status,
    price: Object.freeze({
      selected_price: price,
      currency: 'MAD',
      store_id: null,
      price_checked_at: null,
    }),
    compatibility_notes: Object.freeze(options.notes === undefined ? [] : options.notes),
  });
}

/**
 * The READ-PATH component shape: build_component flattened by the repository
 * join. Note what is ABSENT - no `status`, no `compatibility_notes`, no nested
 * `price` object, no `category`.
 *
 * `selected_price` is a STRING on purpose: `build_component.selected_price` is
 * NUMERIC, and node-postgres does not parse NUMERIC (exact decimal vs double),
 * so this is the value the read path really hands over. A fixture that used a
 * JS number here would pass while the live read path threw.
 */
function readPathComponent(role, selectedPrice) {
  return {
    component_role: role,
    product_id: role + '-product',
    product_variant_id: null,
    selected_price: numericString(selectedPrice),
    offer_class: 'STANDARD',
    store_offer_id: null,
  };
}

/** A NUMERIC literal exactly as node-postgres serializes it, e.g. "1000.00". */
function numericString(value) {
  return value.toFixed(2);
}

function makeBuild(options = {}) {
  const components = options.components === undefined
    ? [component('CPU', 'PASS'), component('GPU', 'PASS', { price: 2000 })]
    : options.components;
  return Object.freeze({
    components: Object.freeze(components),
    total_price: options.total_price === undefined ? 3000 : options.total_price,
    currency: 'MAD',
    unknown_pairwise_count: 0,
  });
}

const CONTRIBUTION = Object.freeze([
  Object.freeze({ role: 'CPU', type: 'PERFORMANCE', effective_score: 80, weight: 0.2 }),
  Object.freeze({ role: 'CPU', type: 'VALUE', effective_score: 40, weight: 0.075 }),
  Object.freeze({ role: 'MOTHERBOARD', type: 'QUALITY', effective_score: 60, weight: 0.25 }),
]);

const BIOS_NOTE = Object.freeze({ source_status: 'CONDITIONAL', min_bios_version: '1.2.3' });
const NON_CONDITIONAL_NOTE = Object.freeze({ source_status: 'VERIFIED', min_bios_version: '9.9.9' });

function byCode(reasons) {
  const map = {};
  for (const reason of reasons) {
    map[reason.code] = reason.value;
  }
  return map;
}

function call(overrides = {}) {
  return deriveReasons({ build: makeBuild(), budget: BUDGET, ...overrides });
}

function rejectionOf(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

function assertError(error, code, field, message) {
  assert.ok(error instanceof CandidateSelectionError, message);
  assert.equal(error.code, code, message);
  assert.equal(error.field, field, message);
}

// Vocabulary + order ---------------------------------------------------------

test('REASON_CODES is the frozen eight-code vocabulary', () => {
  assert.deepEqual(Object.keys(REASON_CODES), [
    'STRATEGY',
    'BUDGET_USED_PCT',
    'GPU_SHARE',
    'DOMINANT_ROLE',
    'BIOS_UPDATE_REQUIRED',
    'UNKNOWN_SPEC',
    'INPUT_APPLIED',
    'LIMITED_CATALOG',
  ]);
  assert.ok(Object.isFrozen(REASON_CODES));
});

test('REASON_ORDER is derived from the vocabulary, never a second copy', () => {
  assert.deepEqual(REASON_ORDER, Object.values(REASON_CODES));
  assert.ok(Object.isFrozen(REASON_ORDER));
});

test('the output order is REASON_ORDER for a build that fires every code', () => {
  const build = makeBuild({
    components: [
      component('MOTHERBOARD', 'PASS', { notes: [BIOS_NOTE] }),
      component('CPU', 'UNKNOWN'),
      component('GPU', 'PASS', { price: 1500 }),
    ],
  });
  const reasons = deriveReasons({
    build,
    budget: BUDGET,
    contributions: CONTRIBUTION,
    profile: { gpu_policy: 'IGPU_ALLOWED' },
    inputs: { use_case: 'GAMING', resolution: '1080p', priority: 3 },
    strategy: 'BALANCED',
    catalogReasonCodes: ['NO_PERFORMANCE_CANDIDATE'],
  });
  assert.deepEqual(reasons.map((reason) => reason.code), REASON_ORDER);
});

// STRATEGY ------------------------------------------------------------------

test('STRATEGY carries the E4 archetype strategy key verbatim', () => {
  for (const strategy of ['PERFORMANCE', 'BALANCED', 'VALUE']) {
    assert.equal(byCode(call({ strategy })).STRATEGY, strategy);
  }
});

test('STRATEGY is omitted when no strategy was supplied (never invented)', () => {
  assert.ok(!('STRATEGY' in byCode(call())));
});

test('STRATEGY rejects an unknown key instead of passing it through', () => {
  const error = rejectionOf(() => call({ strategy: 'CHEAPEST' }));
  assertError(error, ERROR_CODES.INVALID_FIELD_VALUE, 'strategy', 'unknown strategy must fail');
});

// BUDGET_USED_PCT -----------------------------------------------------------

test('BUDGET_USED_PCT is total_price / budget.amount * 100, unrounded', () => {
  const reasons = deriveReasons({ build: makeBuild({ total_price: 12345.67 }), budget: BUDGET });
  assert.equal(byCode(reasons).BUDGET_USED_PCT, (12345.67 / 4000) * 100);
});

test('BUDGET_USED_PCT exceeds 100 for a build over budget', () => {
  const reasons = deriveReasons({ build: makeBuild({ total_price: 5000 }), budget: BUDGET });
  assert.equal(byCode(reasons).BUDGET_USED_PCT, 125);
});

test('BUDGET_USED_PCT always fires - it is derivable on the read path', () => {
  const reasons = deriveReasons({ build: makeBuild(), budget: BUDGET });
  assert.equal(reasons[0].code, REASON_CODES.BUDGET_USED_PCT);
});

// GPU_SHARE -----------------------------------------------------------------

test('GPU_SHARE is the GPU component price over the build total', () => {
  const reasons = call();
  assert.equal(byCode(reasons).GPU_SHARE, 2000 / 3000);
});

test('GPU_SHARE reads the flat read-path selected_price too', () => {
  const build = makeBuild({
    components: [readPathComponent('CPU', 1000), readPathComponent('GPU', 2000)],
    total_price: 3000,
  });
  assert.equal(byCode(deriveReasons({ build, budget: BUDGET })).GPU_SHARE, 2000 / 3000);
});

// NUMERIC columns (node-postgres returns them as strings) --------------------

test('NUMERIC strings from the driver are accepted for all three price inputs', () => {
  const build = makeBuild({
    components: [readPathComponent('CPU', 1000), readPathComponent('GPU', 1300)],
    total_price: '3000.00',
  });
  const reasons = deriveReasons({
    build,
    budget: { amount: '4000.00', currency: 'MAD' },
    inputs: { use_case: 'GAMING' },
  });
  const map = byCode(reasons);
  assert.equal(map.BUDGET_USED_PCT, 75);
  assert.equal(map.GPU_SHARE, 1300 / 3000);
  assert.equal(typeof map.BUDGET_USED_PCT, 'number', 'arithmetic must run on numbers, not strings');
  assert.equal(typeof map.GPU_SHARE, 'number');
});

test('NUMERIC strings carry integer-literal and negative-zero-free forms', () => {
  const build = makeBuild({ components: [readPathComponent('GPU', 900)], total_price: '1000' });
  assert.equal(byCode(deriveReasons({ build, budget: { amount: '2000', currency: 'MAD' } })).BUDGET_USED_PCT, 50);
});

test('only a PLAIN DECIMAL string is coerced; every other string form fails fast', () => {
  for (const bad of ['1e3', ' 1000', '1000 ', '1,000.00', '', 'abc', '1000.00.00', '+1000', '$1000', 'Infinity', 'NaN']) {
    const error = rejectionOf(() => deriveReasons({ build: makeBuild(), budget: { amount: bad, currency: 'MAD' } }));
    assertError(error, ERROR_CODES.INVALID_FIELD_VALUE, 'budget.amount', 'not a NUMERIC literal: ' + JSON.stringify(bad));
  }
  for (const bad of [true, {}, [], NaN, Infinity]) {
    const error = rejectionOf(() => deriveReasons({ build: makeBuild(), budget: { amount: bad, currency: 'MAD' } }));
    assert.ok(error instanceof CandidateSelectionError, 'non-number ' + String(bad) + ' must fail');
  }
});

test('a NUMERIC string price on the GPU component is coerced, a malformed one fails', () => {
  const ok = makeBuild({ components: [readPathComponent('GPU', 1500)], total_price: 3000 });
  assert.equal(byCode(deriveReasons({ build: ok, budget: BUDGET })).GPU_SHARE, 0.5);
  const bad = makeBuild({
    components: [{ component_role: 'GPU', product_id: 'g', product_variant_id: null, selected_price: '1.5k' }],
    total_price: 3000,
  });
  const error = rejectionOf(() => deriveReasons({ build: bad, budget: BUDGET }));
  assertError(error, ERROR_CODES.INVALID_FIELD_VALUE, 'build.GPU.selected_price', 'malformed component price');
});

test('a NULL total_price fails fast by name (the column is nullable)', () => {
  const build = makeBuild({ total_price: null });
  assertError(
    rejectionOf(() => deriveReasons({ build, budget: BUDGET })),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'build.total_price',
    'a build with no price has no derivable budget share'
  );
});

test('the flat persisted price WINS over a stale nested one', () => {
  const component = {
    component_role: 'GPU',
    product_id: 'g',
    product_variant_id: null,
    selected_price: '1500.00',
    price: { selected_price: 999 },
  };
  const build = makeBuild({ components: [component], total_price: 3000 });
  assert.equal(byCode(deriveReasons({ build, budget: BUDGET })).GPU_SHARE, 0.5);
});

test('GPU_SHARE is null (not omitted) when the build carries no GPU role', () => {
  const reasons = call({ build: makeBuild({ components: [component('CPU', 'PASS')], total_price: 1000 }) });
  const map = byCode(reasons);
  assert.equal(map.GPU_SHARE, null);
  assert.ok('GPU_SHARE' in map, 'the iGPU path is an answer, not a missing value');
});

test('GPU_SHARE always fires - it is derivable on the read path', () => {
  const reasons = deriveReasons({ build: makeBuild(), budget: BUDGET });
  assert.deepEqual(reasons.map((reason) => reason.code), [
    REASON_CODES.BUDGET_USED_PCT,
    REASON_CODES.GPU_SHARE,
  ]);
});

// DOMINANT_ROLE -------------------------------------------------------------

test('DOMINANT_ROLE is the role of the highest weight * effective_score', () => {
  assert.equal(byCode(call({ contributions: CONTRIBUTION })).DOMINANT_ROLE, 'CPU');
});

test('DOMINANT_ROLE keeps the first contribution on a tie (Engine 4 order)', () => {
  const tie = [
    Object.freeze({ role: 'CPU', type: 'PERFORMANCE', effective_score: 80, weight: 0.2 }),
    Object.freeze({ role: 'MOTHERBOARD', type: 'QUALITY', effective_score: 64, weight: 0.25 }),
  ];
  assert.equal(byCode(call({ contributions: tie })).DOMINANT_ROLE, 'CPU');
  assert.equal(byCode(call({ contributions: [tie[1], tie[0]] })).DOMINANT_ROLE, 'MOTHERBOARD');
});

test('DOMINANT_ROLE is omitted when no contributions were supplied', () => {
  assert.ok(!('DOMINANT_ROLE' in byCode(call())));
});

test('DOMINANT_ROLE is omitted for an empty contribution list', () => {
  assert.ok(!('DOMINANT_ROLE' in byCode(call({ contributions: [] }))));
});

// BIOS_UPDATE_REQUIRED ------------------------------------------------------

test('BIOS_UPDATE_REQUIRED carries the verbatim CONDITIONAL min_bios_version texts', () => {
  const build = makeBuild({
    components: [
      component('CPU', 'PASS', { notes: [BIOS_NOTE] }),
      component('GPU', 'PASS', { notes: [BIOS_NOTE, Object.freeze({ source_status: 'CONDITIONAL', min_bios_version: '2.0.1' })] }),
    ],
  });
  assert.deepEqual(byCode(deriveReasons({ build, budget: BUDGET })).BIOS_UPDATE_REQUIRED, ['1.2.3', '2.0.1']);
});

test('BIOS_UPDATE_REQUIRED ignores non-CONDITIONAL notes and empty version texts', () => {
  const build = makeBuild({
    components: [
      component('CPU', 'PASS', { notes: [NON_CONDITIONAL_NOTE] }),
      component('GPU', 'PASS', { notes: [Object.freeze({ source_status: 'CONDITIONAL' })] }),
    ],
  });
  assert.ok(!('BIOS_UPDATE_REQUIRED' in byCode(deriveReasons({ build, budget: BUDGET }))));
});

test('BIOS_UPDATE_REQUIRED is omitted when no note demands one', () => {
  assert.ok(!('BIOS_UPDATE_REQUIRED' in byCode(call())));
});

// UNKNOWN_SPEC --------------------------------------------------------------

test('UNKNOWN_SPEC lists the UNKNOWN roles in EXPANSION_ORDER', () => {
  const build = makeBuild({
    components: [
      component('SSD_BOOT', 'UNKNOWN'),
      component('CPU', 'PASS'),
      component('MOTHERBOARD', 'UNKNOWN'),
    ],
  });
  assert.deepEqual(byCode(deriveReasons({ build, budget: BUDGET })).UNKNOWN_SPEC, ['MOTHERBOARD', 'SSD_BOOT']);
});

test('UNKNOWN_SPEC is order-stable regardless of the component array order', () => {
  const first = deriveReasons({
    build: makeBuild({ components: [component('SSD_BOOT', 'UNKNOWN'), component('CPU', 'UNKNOWN')] }),
    budget: BUDGET,
  });
  const second = deriveReasons({
    build: makeBuild({ components: [component('CPU', 'UNKNOWN'), component('SSD_BOOT', 'UNKNOWN')] }),
    budget: BUDGET,
  });
  assert.deepEqual(byCode(first).UNKNOWN_SPEC, ['CPU', 'SSD_BOOT']);
  assert.deepEqual(byCode(second).UNKNOWN_SPEC, ['CPU', 'SSD_BOOT']);
});

test('UNKNOWN_SPEC is omitted for an all-PASS build', () => {
  assert.ok(!('UNKNOWN_SPEC' in byCode(call())));
});

// INPUT_APPLIED -------------------------------------------------------------

test('INPUT_APPLIED echoes the inputs plus the declared gpu policy', () => {
  const map = byCode(call({
    inputs: { use_case: 'GAMING', resolution: '1080p', priority: 3 },
    profile: { gpu_policy: 'IGPU_ALLOWED' },
  }));
  assert.deepEqual(map.INPUT_APPLIED, {
    use_case: 'GAMING',
    resolution: '1080p',
    priority: 3,
    gpu_policy: 'IGPU_ALLOWED',
  });
});

test('INPUT_APPLIED normalizes absent resolution / priority to null', () => {
  const map = byCode(call({ inputs: { use_case: 'OFFICE' } }));
  assert.deepEqual(map.INPUT_APPLIED, {
    use_case: 'OFFICE',
    resolution: null,
    priority: null,
    gpu_policy: null,
  });
});

test('INPUT_APPLIED is omitted when no inputs were supplied', () => {
  assert.ok(!('INPUT_APPLIED' in byCode(call({ profile: { gpu_policy: 'REQUIRED' } }))));
});

test('INPUT_APPLIED rejects a missing use_case and an out-of-range priority', () => {
  assertError(
    rejectionOf(() => call({ inputs: {} })),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'inputs.use_case',
    'use_case is required'
  );
  assertError(
    rejectionOf(() => call({ inputs: { use_case: 'GAMING', priority: 9 } })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'inputs.priority',
    'priority must be 1..5 or null'
  );
});

// LIMITED_CATALOG -----------------------------------------------------------

test('LIMITED_CATALOG carries the E4 selection reason codes, de-duplicated', () => {
  const map = byCode(call({
    catalogReasonCodes: ['NO_PERFORMANCE_CANDIDATE', 'NO_PERFORMANCE_CANDIDATE', 'EMPTY_RANKED'],
  }));
  assert.deepEqual(map.LIMITED_CATALOG, ['NO_PERFORMANCE_CANDIDATE', 'EMPTY_RANKED']);
});

test('LIMITED_CATALOG is omitted when the catalog had no degradation code', () => {
  assert.ok(!('LIMITED_CATALOG' in byCode(call())));
  assert.ok(!('LIMITED_CATALOG' in byCode(call({ catalogReasonCodes: [] }))));
});

test('LIMITED_CATALOG rejects a code outside the E4 vocabulary', () => {
  assertError(
    rejectionOf(() => call({ catalogReasonCodes: ['MADE_UP'] })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'catalogReasonCodes[0]',
    'unknown catalog reason code must fail'
  );
});

// Read-path availability ---------------------------------------------------

test('a persisted read-path build reconstructs exactly the three derivable codes', () => {
  // build_component flattened by the repository join: no status, no notes, no
  // nested price, and every NUMERIC as the STRING the driver returns. Nothing
  // here can say UNKNOWN or require a BIOS update - and that absence must OMIT
  // those codes rather than throw.
  const build = makeBuild({
    components: [readPathComponent('CPU', 1000), readPathComponent('MOTHERBOARD', 700), readPathComponent('GPU', 1300)],
    total_price: '3000.00',
  });
  const reasons = deriveReasons({
    build,
    budget: { amount: '4000.00', currency: 'MAD' },
    inputs: { use_case: 'GAMING', resolution: '1080p', priority: 4 },
  });
  const codes = reasons.map((reason) => reason.code);
  assert.deepEqual(codes, [
    REASON_CODES.BUDGET_USED_PCT,
    REASON_CODES.GPU_SHARE,
    REASON_CODES.INPUT_APPLIED,
  ]);
  const map = byCode(reasons);
  assert.equal(map.BUDGET_USED_PCT, 75);
  assert.equal(map.GPU_SHARE, 1300 / 3000);
  for (const notDerivable of ['STRATEGY', 'DOMINANT_ROLE', 'BIOS_UPDATE_REQUIRED', 'UNKNOWN_SPEC', 'LIMITED_CATALOG']) {
    assert.ok(!(notDerivable in map), notDerivable + ' is not reconstructable from persisted rows');
  }
});

test('the read path never needs a per-component status (no throw on a missing one)', () => {
  const build = makeBuild({ components: [readPathComponent('CPU', 1000)], total_price: 1000 });
  assert.doesNotThrow(() => deriveReasons({ build, budget: BUDGET }));
});

// Determinism, purity, DB-freedom -----------------------------------------

test('two calls with the same inputs are deeply equal', () => {
  const args = {
    build: makeBuild({ components: [component('CPU', 'UNKNOWN'), component('GPU', 'PASS', { price: 900 })] }),
    budget: BUDGET,
    contributions: CONTRIBUTION,
    profile: { gpu_policy: 'REQUIRED' },
    inputs: { use_case: 'GAMING', resolution: '1440p', priority: 2 },
    strategy: 'PERFORMANCE',
    catalogReasonCodes: ['NO_VALUE_CANDIDATE'],
  };
  assert.deepEqual(deriveReasons(args), deriveReasons(args));
});

test('the result is deeply frozen, including every nested code value', () => {
  const reasons = call({
    build: makeBuild({
      components: [component('CPU', 'UNKNOWN', { notes: [BIOS_NOTE] }), component('GPU', 'PASS', { price: 900 })],
    }),
    contributions: CONTRIBUTION,
    inputs: { use_case: 'GAMING' },
    catalogReasonCodes: ['EMPTY_RANKED'],
  });
  assert.ok(Object.isFrozen(reasons));
  for (const reason of reasons) {
    assert.ok(Object.isFrozen(reason), reason.code + ' record must be frozen');
    if (Array.isArray(reason.value)) {
      assert.ok(Object.isFrozen(reason.value), reason.code + ' array value must be frozen');
    } else if (reason.value !== null && typeof reason.value === 'object') {
      assert.ok(Object.isFrozen(reason.value), reason.code + ' object value must be frozen');
    }
  }
});

test('no argument is mutated', () => {
  const components = [component('CPU', 'PASS', { notes: [BIOS_NOTE] }), component('GPU', 'PASS', { price: 900 })];
  const build = makeBuild({ components });
  const contributions = [
    Object.freeze({ role: 'CPU', type: 'PERFORMANCE', effective_score: 80, weight: 0.2 }),
  ];
  const profile = { gpu_policy: 'REQUIRED' };
  const inputs = { use_case: 'GAMING', resolution: '1080p', priority: 3 };
  const catalogReasonCodes = ['EMPTY_RANKED'];
  const before = JSON.stringify({ components, contributions, profile, inputs, catalogReasonCodes });
  deriveReasons({ build, budget: BUDGET, contributions, profile, inputs, strategy: 'VALUE', catalogReasonCodes });
  assert.equal(
    JSON.stringify({ components, contributions, profile, inputs, catalogReasonCodes }),
    before
  );
});

test('reasons.js is pure: no DB client, no SQL, no clock, no randomness', () => {
  const source = fs.readFileSync(path.join(__dirname, 'reasons.js'), 'utf8');
  for (const token of ['.query(', "require('pg')", 'Date.now', 'new Date', 'Math.random', 'process.env']) {
    assert.ok(!source.includes(token), 'reasons.js must not contain ' + token);
  }
});

test('build-facts.js is pure and is the single owner of the shared derivations', () => {
  const facts = fs.readFileSync(path.join(__dirname, 'build-facts.js'), 'utf8');
  for (const token of ['.query(', "require('pg')", 'Date.now', 'new Date', 'Math.random']) {
    assert.ok(!facts.includes(token), 'build-facts.js must not contain ' + token);
  }
  const explainSource = fs.readFileSync(path.join(__dirname, 'explain.js'), 'utf8');
  const reasonsSource = fs.readFileSync(path.join(__dirname, 'reasons.js'), 'utf8');
  for (const owner of [explainSource, reasonsSource]) {
    assert.ok(owner.includes("require('./build-facts')"), 'both entry points must consume build-facts');
    assert.ok(!owner.includes('function dominantContribution'), 'no second dominance implementation');
    assert.ok(!owner.includes('function biosRequirements'), 'no second BIOS implementation');
    assert.ok(!owner.includes('function unknownRoles'), 'no second UNKNOWN implementation');
  }
});

// Agreement with the Engine 6 string --------------------------------------

test('E6/E7 agreement: DOMINANT_ROLE, BIOS versions and UNKNOWN roles are the SAME facts', () => {
  const build = makeBuild({
    components: [
      component('CPU', 'PASS'),
      component('MOTHERBOARD', 'UNKNOWN'),
      component('GPU', 'PASS', {
        price: 2000,
        notes: [BIOS_NOTE, Object.freeze({ source_status: 'CONDITIONAL', min_bios_version: '2.0.1' })],
      }),
    ],
  });
  const entry = Object.freeze({
    persisted_rank: 1,
    build_score: 87.5,
    total_price: 3000,
    compatibility_status: 'UNKNOWN',
    signature: 'sig',
    explanation: null,
    build,
  });
  const text = explainSelection({
    selected: [entry],
    builds: [build],
    contributions: [CONTRIBUTION],
    budget: BUDGET,
  })[0].explanation;
  const map = byCode(deriveReasons({ build, contributions: CONTRIBUTION, budget: BUDGET }));

  // Same dominant role.
  assert.ok(text.includes('; ' + map.DOMINANT_ROLE + ' '), 'dominant role must appear in the string');
  // Same BIOS versions, in the same order - the string emits one clause per
  // version, so clause COUNT parity proves the array lost or gained nothing.
  const clauses = text.split('; requires BIOS >= ').length - 1;
  assert.equal(clauses, map.BIOS_UPDATE_REQUIRED.length, 'one clause per version: ' + text);
  for (const version of map.BIOS_UPDATE_REQUIRED) {
    assert.ok(text.includes('; requires BIOS >= ' + version), 'clause for ' + version + ': ' + text);
  }
  // Same UNKNOWN roles, in the same order.
  assert.ok(
    text.endsWith('; UNKNOWN: ' + map.UNKNOWN_SPEC.join(', ')),
    'UNKNOWN clause must match the codes: ' + text
  );
});

test('out-of-order-role notes are OUT of contract for both surfaces (documented boundary)', () => {
  // Engine 3 v1 emits only the eight EXPANSION_ORDER roles, so a note attached
  // to any other role contributes neither a code nor a string clause. Pinned so
  // the behavior is a documented boundary rather than a silent surprise if a
  // ninth role is ever introduced.
  const build = makeBuild({
    components: [component('NINTH_ROLE', 'UNKNOWN', { notes: [BIOS_NOTE] }), component('GPU', 'PASS', { price: 900 })],
  });
  const map = byCode(deriveReasons({ build, budget: BUDGET }));
  assert.ok(!('UNKNOWN_SPEC' in map));
  assert.ok(!('BIOS_UPDATE_REQUIRED' in map));
});

// Guards --------------------------------------------------------------------

test('deriveReasons requires a single object argument', () => {
  for (const bad of [undefined, null, 42, 'x', []]) {
    assertError(
      rejectionOf(() => deriveReasons(bad)),
      ERROR_CODES.INVALID_INPUT,
      null,
      'non-object args must fail'
    );
  }
});

test('deriveReasons requires build and budget', () => {
  assertError(
    rejectionOf(() => deriveReasons({ budget: BUDGET })),
    ERROR_CODES.INVALID_INPUT,
    'build',
    'build is required'
  );
  assertError(
    rejectionOf(() => deriveReasons({ build: makeBuild({ components: [] }) })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'build.components',
    'components must be non-empty'
  );
  assertError(
    rejectionOf(() => deriveReasons({ build: makeBuild({ total_price: 0 }), budget: BUDGET })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'build.total_price',
    'total_price must be positive'
  );
  assertError(
    rejectionOf(() => deriveReasons({ build: makeBuild() })),
    ERROR_CODES.INVALID_INPUT,
    'budget',
    'budget is required'
  );
});

test('deriveReasons validates budget.amount and budget.currency like explain.js', () => {
  assertError(
    rejectionOf(() => deriveReasons({ build: makeBuild(), budget: { currency: 'MAD' } })),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'budget.amount',
    'amount required'
  );
  assertError(
    rejectionOf(() => deriveReasons({ build: makeBuild(), budget: { amount: -1, currency: 'MAD' } })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'budget.amount',
    'amount must be positive'
  );
  assertError(
    rejectionOf(() => deriveReasons({ build: makeBuild(), budget: { amount: 4000, currency: 'mad' } })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'budget.currency',
    'currency must be 3 uppercase letters'
  );
});

test('a malformed contribution fails fast rather than silently losing the dominance test', () => {
  assertError(
    rejectionOf(() => call({ contributions: [Object.freeze({ role: 'CPU' })] })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'contributions[0].weight',
    'weight must be finite'
  );
  assertError(
    rejectionOf(() => call({ contributions: [Object.freeze({ role: '', weight: 1, effective_score: 1 })] })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'contributions[0].role',
    'role must be non-empty'
  );
  assertError(
    rejectionOf(() => call({ contributions: ['CPU'] })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'contributions[0]',
    'each contribution must be an object'
  );
  assertError(
    rejectionOf(() => call({ contributions: {} })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'contributions',
    'contributions must be an array'
  );
});

test('a DECLARED null gpu_policy is malformed, never a synonym for absent', () => {
  assertError(
    rejectionOf(() => call({ profile: { gpu_policy: null } })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'profile.gpu_policy',
    'declared null is malformed'
  );
  assertError(
    rejectionOf(() => call({ profile: { gpu_policy: 'ANY' } })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'profile.gpu_policy',
    'unknown policy must fail'
  );
  // A profile with no gpu_policy key at all is simply "not declared".
  assert.equal(rejectionOf(() => call({ profile: {} })), null);
});
