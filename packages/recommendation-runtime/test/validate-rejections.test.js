'use strict';

// packages/recommendation-runtime/test/validate-rejections.test.js — the
// rejection-payload validator now lives in this package, batch
// `step-5-w2-persistence`.
//
// What it proves, beyond the L1 suite that stayed at the old path
// (src/recommendation/persistence/persist-rejections.test.js):
//   1. the validator loads from its NEW path and the old path is the same
//      module by identity, REJECT_STATUS included;
//   2. every accept and every reject case yields the SAME rows or the same
//      ERROR_CODE, field and message through both paths;
//   3. the filter half survives the move: PASS/UNKNOWN verdicts are dropped,
//      the surviving rows keep input order, and `reason` is mapped to
//      `reason_code` (the DB column) rather than read from the wrong field.
//
// Pure and DB-free: no client is created, no statement is issued.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateRejections, REJECT_STATUS } = require('../src/persistence/validate-rejections');
const shim = require('../../../src/recommendation/persistence/validate-rejections');
const core = require('../../../packages/recommendation-core');

const QUERY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function verdict(overrides) {
  return Object.assign(
    {
      status: 'REJECT',
      component_role: 'GPU',
      product_id: 'gpu-1',
      product_variant_id: null,
      partner_product_id: null,
      partner_product_variant_id: null,
      reason: 'GPU_TOO_THICK',
    },
    overrides
  );
}

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
  ['one REJECT verdict', { queryId: QUERY_ID, rejections: [verdict({})] }],
  ['a mixed set (PASS and UNKNOWN are dropped)', {
    queryId: QUERY_ID,
    rejections: [verdict({ status: 'PASS', product_id: 'gpu-2' }), verdict({}), verdict({ status: 'UNKNOWN', product_id: 'gpu-3' })],
  }],
  ['an empty array', { queryId: QUERY_ID, rejections: [] }],
  ['a product-keyed partner', { queryId: QUERY_ID, rejections: [verdict({ partner_product_id: 'case-1' })] }],
  ['a variant-keyed partner', {
    queryId: QUERY_ID,
    rejections: [verdict({ partner_product_id: 'gpu-9', partner_product_variant_id: 'gpu-9-var' })],
  }],
  ['a variant without its product', {
    queryId: QUERY_ID,
    rejections: [verdict({ partner_product_variant_id: 'gpu-9-var' })],
  }],
  ['a blank reason', { queryId: QUERY_ID, rejections: [verdict({ reason: '  ' })] }],
  ['the wrong reason field name', { queryId: QUERY_ID, rejections: [verdict({ reason: undefined, reason_code: 'GPU_TOO_THICK' })] }],
  ['a missing query id', { queryId: null, rejections: [verdict({})] }],
  ['a non-array rejection set', { queryId: QUERY_ID, rejections: {} }],
];

test('loads from the runtime package and the old path is the same module', () => {
  assert.equal(typeof validateRejections, 'function');
  assert.equal(shim.validateRejections, validateRejections);
  assert.equal(REJECT_STATUS, 'REJECT');
  assert.equal(shim.REJECT_STATUS, REJECT_STATUS);
});

test('every accept and reject case is identical through both paths', () => {
  for (const [label, input] of CASES) {
    const fromNewPath = attempt(validateRejections, input);
    const fromOldPath = attempt(shim.validateRejections, input);
    assert.deepEqual(fromOldPath, fromNewPath, label);
  }
});

test('the filter keeps only REJECT rows, in input order, with reason -> reason_code', () => {
  const rows = validateRejections({
    queryId: QUERY_ID,
    rejections: [verdict({ status: 'PASS', product_id: 'gpu-2' }), verdict({ product_id: 'gpu-4' }), verdict({ product_id: 'gpu-1' })],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.product_id), ['gpu-4', 'gpu-1']);
  assert.deepEqual(rows.map((row) => row.reason_code), ['GPU_TOO_THICK', 'GPU_TOO_THICK']);
  assert.ok(Object.isFrozen(rows));
  assert.ok(Object.isFrozen(rows[0]));
});

test('every rejection is the core error class, not a copy of it', () => {
  for (const [label, input] of CASES) {
    try {
      validateRejections(input);
    } catch (error) {
      assert.ok(
        error instanceof core.candidates.CandidateSelectionError,
        label + ' must raise the core CandidateSelectionError'
      );
    }
  }
});
