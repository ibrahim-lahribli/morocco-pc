'use strict';

// Decision 22 items 2 + 4: the fixed deterministic explanation template.
// Engine 4 arithmetic is NOT re-tested here (see build-score.test.js); this file
// proves the template, the dominance selection + tie order, the mandatory BIOS
// and UNKNOWN clauses, copy-not-mutate semantics, determinism, and the guards.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { explainSelection } = require('./explain');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const BUDGET = Object.freeze({ amount: 3500, currency: 'MAD' });

function component(role, status, notes = []) {
  return Object.freeze({
    component_role: role,
    product_id: role + '-product',
    product_variant_id: null,
    category: 'x',
    status,
    price: Object.freeze({ selected_price: 100, currency: 'MAD', store_id: null, price_checked_at: null }),
    compatibility_notes: Object.freeze(notes),
  });
}

function makeBuild(components, currency = 'MAD') {
  return Object.freeze({
    components: Object.freeze(components),
    total_price: 3120,
    currency,
    unknown_pairwise_count: 0,
  });
}

function makeEntry(overrides = {}) {
  return Object.freeze({
    persisted_rank: 1,
    build_score: 87.5,
    total_price: 3120,
    compatibility_status: 'PASS',
    signature: 'CPU:11111111-1111-4111-8111-111111111111|GPU::',
    explanation: null,
    build: makeBuild([component('CPU', 'PASS'), component('MOTHERBOARD', 'PASS')]),
    ...overrides,
  });
}

const CONTRIBUTION = Object.freeze([
  Object.freeze({ role: 'CPU', type: 'PERFORMANCE', effective_score: 80, weight: 0.2 }),
  Object.freeze({ role: 'CPU', type: 'VALUE', effective_score: 40, weight: 0.075 }),
  Object.freeze({ role: 'MOTHERBOARD', type: 'QUALITY', effective_score: 60, weight: 0.25 }),
]);

function call(entry = makeEntry(), contributions = [CONTRIBUTION], budget = BUDGET) {
  return explainSelection({
    selected: [entry],
    builds: [entry.build],
    contributions,
    budget,
  });
}

async function rejectionOf(fn) {
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

// The template ---------------------------------------------------------------

test('Decision 22 item 4: the fixed template, verbatim', () => {
  const out = call();
  assert.equal(
    out[0].explanation,
    'Ranked 1: best weighted score 87.5; PASS compatibility; 3120 MAD of 3500 MAD budget; CPU PERFORMANCE dominant'
  );
});

test('Decision 22 item 4(a): entry values are used as-is (never re-rounded)', () => {
  const out = call(makeEntry({ persisted_rank: 3, build_score: 42, total_price: 12345.67 }));
  assert.match(out[0].explanation, /^Ranked 3: best weighted score 42;/);
  assert.match(out[0].explanation, /12345\.67 MAD of 3500 MAD budget/);
});

test('Decision 22 item 4(b): the budget argument is the only budget source', () => {
  const out = call(makeEntry(), [CONTRIBUTION], { amount: 12000, currency: 'USD' });
  assert.match(out[0].explanation, /3120 MAD of 12000 USD budget/);
});

// Dominance (item 4(c)) -------------------------------------------------------

test('Decision 22 item 4(c): a tie keeps the first contribution in Engine 4 order', () => {
  // MOTHERBOARD/QUALITY and CPU/PERFORMANCE both give 16; the list order wins.
  const tie = [
    Object.freeze({ role: 'CPU', type: 'PERFORMANCE', effective_score: 80, weight: 0.2 }),
    Object.freeze({ role: 'MOTHERBOARD', type: 'QUALITY', effective_score: 64, weight: 0.25 }),
  ];
  assert.match(call(makeEntry(), [tie])[0].explanation, /; CPU PERFORMANCE dominant$/);
  const reversed = [tie[1], tie[0]];
  assert.match(call(makeEntry(), [reversed])[0].explanation, /; MOTHERBOARD QUALITY dominant$/);
});

// CONDITIONAL / BIOS (item 4(d)) ---------------------------------------------

test('Decision 22 item 4(d): a CONDITIONAL note emits the verbatim BIOS clause', () => {
  const entry = makeEntry({
    build: makeBuild([
      component('CPU', 'PASS', [{ source_status: 'CONDITIONAL', min_bios_version: '1.2.3' }]),
      component('MOTHERBOARD', 'PASS'),
    ]),
  });
  assert.match(call(entry)[0].explanation, /; requires BIOS >= 1\.2\.3$/);
});

test('Decision 22 item 4(d): non-CONDITIONAL and empty notes emit no BIOS clause', () => {
  const entry = makeEntry({
    build: makeBuild([
      component('CPU', 'PASS', [{ source_status: 'PASS', min_bios_version: '9.9.9' }]),
      component('MOTHERBOARD', 'PASS'),
    ]),
  });
  assert.ok(!call(entry)[0].explanation.includes('requires BIOS'));
});

test('Decision 22 item 4(d): distinct versions are emitted once, in order', () => {
  const entry = makeEntry({
    build: makeBuild([
      component('CPU', 'PASS', [
        { source_status: 'CONDITIONAL', min_bios_version: '1.2.3' },
        { source_status: 'CONDITIONAL', min_bios_version: '1.2.3' },
      ]),
      component('MOTHERBOARD', 'PASS', [{ source_status: 'CONDITIONAL', min_bios_version: '2.0' }]),
    ]),
  });
  assert.match(call(entry)[0].explanation, /; requires BIOS >= 1\.2\.3; requires BIOS >= 2\.0$/);
});

// UNKNOWN is never silent (item 4(e)) ----------------------------------------

test('Decision 22 item 4(e): UNKNOWN status and UNKNOWN roles are always printed', () => {
  const entry = makeEntry({
    compatibility_status: 'UNKNOWN',
    build: makeBuild([
      component('CPU', 'UNKNOWN'),
      component('RAM', 'UNKNOWN'),
      component('MOTHERBOARD', 'PASS'),
    ]),
  });
  assert.match(call(entry)[0].explanation, /; UNKNOWN compatibility; .*; UNKNOWN: CPU, RAM$/);
});

test('Decision 22 item 4(e): a PASS build emits no UNKNOWN clause', () => {
  assert.ok(!call()[0].explanation.includes('UNKNOWN'));
});

// Copies, freezing, determinism ----------------------------------------------

test('Decision 22 item 3: entries are copied, never mutated, and deeply frozen', () => {
  const entry = makeEntry();
  const selected = Object.freeze([entry]);
  const out = explainSelection({
    selected,
    builds: [entry.build],
    contributions: [CONTRIBUTION],
    budget: BUDGET,
  });

  assert.notEqual(out[0], entry);
  assert.equal(entry.explanation, null, 'the frozen selection is never edited');
  assert.equal(out[0].persisted_rank, entry.persisted_rank);
  assert.equal(out[0].build, entry.build, 'the build travels by reference');
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out[0]));
  assert.equal(typeof out[0].explanation, 'string');
});

test('Decision 22 item 6: identical inputs yield byte-identical text', () => {
  assert.equal(call()[0].explanation, call()[0].explanation);
});

test('an empty selection yields a frozen empty array (never an error)', () => {
  const out = explainSelection({ selected: [], builds: [], contributions: [], budget: BUDGET });
  assert.deepEqual(out, []);
  assert.ok(Object.isFrozen(out));
});

// Guards ---------------------------------------------------------------------

test('contract violations fail fast with the shared vocabulary', async () => {
  assertError(
    await rejectionOf(() =>
      explainSelection({ selected: 'x', builds: [], contributions: [], budget: BUDGET })
    ),
    ERROR_CODES.INVALID_INPUT,
    'selected',
    'non-array selected'
  );
  assertError(
    await rejectionOf(() =>
      explainSelection({ selected: [], builds: [], contributions: [CONTRIBUTION], budget: BUDGET })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'contributions',
    'misaligned contributions'
  );
  assertError(
    await rejectionOf(() =>
      explainSelection({ selected: [], builds: [], contributions: [], budget: { currency: 'MAD' } })
    ),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'budget.amount',
    'missing budget amount'
  );
  assertError(
    await rejectionOf(() =>
      explainSelection({ selected: [], builds: [], contributions: [], budget: { amount: 1, currency: 'mad' } })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'budget.currency',
    'bad budget currency'
  );
  assertError(
    await rejectionOf(() => call(makeEntry({ build_score: 101 }))),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'selected[0].build_score',
    'out-of-range score'
  );
  const orphan = makeEntry();
  assertError(
    await rejectionOf(() =>
      explainSelection({ selected: [orphan], builds: [], contributions: [], budget: BUDGET })
    ),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'selected[0].build',
    'build not among builds'
  );
});
