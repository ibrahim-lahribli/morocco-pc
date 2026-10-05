'use strict';

// Unit tests for the OG-10 resolver (rule 6, AIR cooler height vs case
// clearance). The behaviours pinned here are the ones the decision rests on:
// a NULL is UNKNOWN and never a PASS, a LIQUID cooler is out of scope rather
// than judged on its pump-block height, and the boundary is inclusive.

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveCoolerCaseHeight } = require('./cooler-height');
const { REASON_CODES } = require('./reason-codes');
const { FINAL_STATUSES } = require('./statuses');

const COOLER = 'cooler-1';
const CASE = 'case-1';

function base(overrides = {}) {
  return {
    cooler_product_id: COOLER,
    case_product_id: CASE,
    cooling_type: 'AIR',
    cooler_height_mm: 155,
    case_max_cpu_cooler_height_mm: 170,
    ...overrides,
  };
}

test('OG-10: an AIR cooler shorter than the clearance PASSes, with headroom in evidence', () => {
  const r = resolveCoolerCaseHeight(base());
  assert.equal(r.status, FINAL_STATUSES.PASS);
  assert.equal(r.reason, null);
  assert.equal(r.evidence[0].cooler_height_mm, 155);
  assert.equal(r.evidence[0].case_max_cpu_cooler_height_mm, 170);
  assert.equal(r.evidence[0].headroom_mm, 15);
});

test('OG-10: an AIR cooler taller than the clearance FAILs with COOLER_TOO_TALL', () => {
  const r = resolveCoolerCaseHeight(
    base({ cooler_height_mm: 175, case_max_cpu_cooler_height_mm: 170 })
  );
  assert.equal(r.status, FINAL_STATUSES.FAIL);
  assert.equal(r.reason, REASON_CODES.COOLER_TOO_TALL);
  assert.equal(r.evidence[0].over_by_mm, 5);
});

test('OG-10: the boundary is INCLUSIVE - a cooler exactly as tall as the clearance fits', () => {
  const r = resolveCoolerCaseHeight(
    base({ cooler_height_mm: 170, case_max_cpu_cooler_height_mm: 170 })
  );
  assert.equal(r.status, FINAL_STATUSES.PASS);
  assert.equal(r.evidence[0].headroom_mm, 0);
});

test('OG-10: one millimetre over the clearance FAILs', () => {
  const r = resolveCoolerCaseHeight(
    base({ cooler_height_mm: 171, case_max_cpu_cooler_height_mm: 170 })
  );
  assert.equal(r.status, FINAL_STATUSES.FAIL);
});

// The single most important property: an unmeasured cooler is not an
// unlimited one. This is the exact failure mode OG-34 hid.
test('OG-10: a NULL cooler height is UNKNOWN, never a PASS', () => {
  const r = resolveCoolerCaseHeight(base({ cooler_height_mm: null }));
  assert.equal(r.status, FINAL_STATUSES.UNKNOWN);
  assert.equal(r.reason, REASON_CODES.COOLER_HEIGHT_UNKNOWN);
  assert.equal(r.evidence[0].cooler_height_mm, null);
  assert.equal(r.evidence[0].case_max_cpu_cooler_height_mm, 170);
});

test('OG-10: a NULL case clearance is UNKNOWN, never a PASS', () => {
  const r = resolveCoolerCaseHeight(base({ case_max_cpu_cooler_height_mm: null }));
  assert.equal(r.status, FINAL_STATUSES.UNKNOWN);
  assert.equal(r.reason, REASON_CODES.COOLER_HEIGHT_UNKNOWN);
});

test('OG-10: both NULL is UNKNOWN', () => {
  const r = resolveCoolerCaseHeight(
    base({ cooler_height_mm: null, case_max_cpu_cooler_height_mm: null })
  );
  assert.equal(r.status, FINAL_STATUSES.UNKNOWN);
  assert.equal(r.reason, REASON_CODES.COOLER_HEIGHT_UNKNOWN);
});

// Liquid heights mean something different (pump block, seed 009), so the rule
// must not judge them - and must not turn them into UNKNOWN noise either.
test('OG-10: a LIQUID cooler is OUT OF SCOPE, not UNKNOWN and not FAIL', () => {
  const r = resolveCoolerCaseHeight(
    base({ cooling_type: 'LIQUID', cooler_height_mm: 200, case_max_cpu_cooler_height_mm: 170 })
  );
  assert.equal(r.status, FINAL_STATUSES.PASS);
  assert.equal(r.reason, null);
  assert.equal(r.evidence[0].scope, 'not_applicable');
  assert.equal(r.evidence[0].cooling_type, 'LIQUID');
});

test('OG-10: a LIQUID cooler out of scope ignores its height entirely', () => {
  // 200mm pump block against a 170mm case: if the rule leaked LIQUID rows this
  // would FAIL and wrongly reject every AIO on a mid-tower.
  const tall = resolveCoolerCaseHeight(
    base({ cooling_type: 'LIQUID', cooler_height_mm: 200 })
  );
  const unknown = resolveCoolerCaseHeight(
    base({ cooling_type: 'LIQUID', cooler_height_mm: null })
  );
  assert.equal(tall.status, FINAL_STATUSES.PASS);
  assert.equal(unknown.status, FINAL_STATUSES.PASS);
  assert.equal(tall.reason, null);
  assert.equal(unknown.reason, null);
});

test('OG-10: a NULL cooling_type is UNKNOWN when unmeasured, never waved through', () => {
  // An unclassifiable cooler is not provably "not AIR". Treating a NULL type
  // as out-of-scope would be a silent hole of exactly the OG-34 kind, so with
  // no height to judge it must report UNKNOWN.
  const noTypeNoHeight = resolveCoolerCaseHeight(
    base({ cooling_type: null, cooler_height_mm: null })
  );
  assert.equal(noTypeNoHeight.status, FINAL_STATUSES.UNKNOWN);
  assert.equal(noTypeNoHeight.reason, REASON_CODES.COOLER_HEIGHT_UNKNOWN);

  // When both numbers ARE present the comparison is sound regardless of the
  // label, so a NULL type does not manufacture an UNKNOWN out of thin air.
  const noTypeKnown = resolveCoolerCaseHeight(base({ cooling_type: null }));
  assert.equal(noTypeKnown.status, FINAL_STATUSES.PASS);
  assert.equal(noTypeKnown.reason, null);
  assert.equal(noTypeKnown.evidence[0].scope, 'air');
});

// Non-finite values must not sneak past the numeric guard as a comparison.
test('OG-10: NaN and Infinity are UNKNOWN, not a silent PASS or a bogus FAIL', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const r = resolveCoolerCaseHeight(base({ cooler_height_mm: bad }));
    assert.equal(r.status, FINAL_STATUSES.UNKNOWN, `height ${bad}`);
    assert.equal(r.reason, REASON_CODES.COOLER_HEIGHT_UNKNOWN);
  }
  for (const bad of [NaN, Infinity]) {
    const r = resolveCoolerCaseHeight(base({ case_max_cpu_cooler_height_mm: bad }));
    assert.equal(r.status, FINAL_STATUSES.UNKNOWN, `clearance ${bad}`);
  }
});

test('OG-10: a numeric string is UNKNOWN, not coerced', () => {
  const r = resolveCoolerCaseHeight(base({ cooler_height_mm: '155' }));
  assert.equal(r.status, FINAL_STATUSES.UNKNOWN);
  assert.equal(r.reason, REASON_CODES.COOLER_HEIGHT_UNKNOWN);
});

test('OG-10: absent keys behave exactly like explicit NULLs', () => {
  const r = resolveCoolerCaseHeight({ cooler_product_id: COOLER, case_product_id: CASE });
  assert.equal(r.status, FINAL_STATUSES.UNKNOWN);
  assert.equal(r.reason, REASON_CODES.COOLER_HEIGHT_UNKNOWN);
});

test('OG-10: evidence carries the pair identity for rejection persistence', () => {
  const r = resolveCoolerCaseHeight(base({ cooler_height_mm: 180 }));
  assert.equal(r.evidence[0].rule, 'cooler_case_height');
  assert.equal(r.evidence[0].cooler_product_id, COOLER);
  assert.equal(r.evidence[0].case_product_id, CASE);
});

test('OG-10: a non-object input is rejected', () => {
  assert.throws(() => resolveCoolerCaseHeight(null), TypeError);
  assert.throws(() => resolveCoolerCaseHeight('nope'), TypeError);
  assert.throws(() => resolveCoolerCaseHeight(undefined), TypeError);
});