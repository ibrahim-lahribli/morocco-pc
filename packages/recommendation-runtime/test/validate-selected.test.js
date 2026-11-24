'use strict';

// packages/recommendation-runtime/test/validate-selected.test.js — the
// persisted-payload validator now lives in this package, batch
// `step-5-w2-persistence`.
//
// What it proves, beyond the L1 suite that stayed at the old path
// (src/recommendation/persistence/validate-selected.test.js):
//   1. the validator loads from its NEW path and the old path is the same
//      module by identity;
//   2. every accept and every reject case yields the SAME result — the same
//      undefined for a valid array, the same ERROR_CODE, field and message for
//      an invalid one — through both paths, so the move changed no contract;
//   3. the rejections are the core's CandidateSelectionError, not a copy, so a
//      caller catching the core class keeps working.
//
// Pure and DB-free: no client is created, no statement is issued, no clock is
// read.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateSelected } = require('../src/persistence/validate-selected');
const shim = require('../../../src/recommendation/persistence/validate-selected');
const core = require('../../../packages/recommendation-core');

const OFFER_ID = '33333333-3333-4333-8333-333333333333';

function price(overrides) {
  return Object.assign(
    {
      selected_price: 1000,
      currency: 'MAD',
      store_id: null,
      price_checked_at: null,
      offer_id: OFFER_ID,
      offer_class: 'SEED_UNVERIFIED',
    },
    overrides
  );
}

function component(overrides) {
  return Object.assign(
    {
      component_role: 'CPU',
      product_id: 'cpu-1',
      product_variant_id: null,
      status: 'PASS',
      price: price({}),
    },
    overrides
  );
}

function entry(overrides, buildOverrides) {
  return Object.assign(
    {
      persisted_rank: 1,
      total_price: 1200,
      build_score: 71,
      compatibility_status: 'PASS',
      explanation: 'rank 1',
      build: Object.assign({ components: [component({})] }, buildOverrides),
    },
    overrides
  );
}

/** Run one input through a validator and capture either its value or its error. */
function attempt(validator, input) {
  try {
    return { ok: true, value: validator(input) };
  } catch (error) {
    return {
      ok: false,
      name: error.constructor.name,
      code: error.code,
      field: error.field,
      message: error.message,
    };
  }
}

const CASES = [
  ['a valid single-entry array', [entry({})]],
  ['a valid empty array', []],
  ['a non-array input', 'not-an-array'],
  ['a non-contiguous persisted_rank', [entry({ persisted_rank: 2 })]],
  ['a blank explanation', [entry({ explanation: '   ' })]],
  ['a lowercase currency', [entry({}, { components: [component({ price: price({ currency: 'mad' }) })] })]],
  ['an unknown offer class', [entry({}, { components: [component({ price: price({ offer_class: 'GUESSED' }) })] })]],
  ['an empty component list', [entry({}, { components: [] })]],
  ['an unknown component role', [entry({}, { components: [component({ component_role: 'GPU_X' })] })]],
  ['a build score out of range', [entry({ build_score: 101 })]],
];

test('loads from the runtime package and the old path is the same module', () => {
  assert.equal(typeof validateSelected, 'function');
  assert.equal(shim.validateSelected, validateSelected);
});

test('every accept and reject case is identical through both paths', () => {
  for (const [label, input] of CASES) {
    const fromNewPath = attempt(validateSelected, input);
    const fromOldPath = attempt(shim.validateSelected, input);
    assert.deepEqual(fromOldPath, fromNewPath, label);
  }
});

test('the accept case really accepts and the reject cases really reject', () => {
  const accepted = attempt(validateSelected, [entry({})]);
  assert.deepEqual(accepted, { ok: true, value: undefined });

  const rejected = attempt(validateSelected, [entry({ persisted_rank: 2 })]);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'INVALID_FIELD_VALUE');
  assert.equal(rejected.field, 'selected');
  assert.ok(rejected.message.includes('persisted_rank'), rejected.message);
});

test('every rejection is the core error class, not a copy of it', () => {
  for (const [label, input] of CASES) {
    try {
      validateSelected(input);
    } catch (error) {
      assert.ok(
        error instanceof core.candidates.CandidateSelectionError,
        label + ' must raise the core CandidateSelectionError'
      );
    }
  }
});
