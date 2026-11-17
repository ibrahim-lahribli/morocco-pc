'use strict';

// Unit tests for the OG-09 resolver (rule 7, cooler max_tdp_watts vs CPU
// tdp_watts, E8 / Decision 45). The behaviours pinned here are the ones the
// decision rests on: the rule is SOFT (an under-spec cooler is UNKNOWN, never
// FAIL, so it can never REJECT a build), a NULL is UNKNOWN rather than a pass,
// and the boundary is inclusive.

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveCoolerCpuTdp } = require('./cooler-tdp');
const { REASON_CODES } = require('./reason-codes');
const { FINAL_STATUSES } = require('./statuses');

const COOLER = 'cooler-1';
const CPU = 'cpu-1';

function base(overrides = {}) {
  return {
    cooler_product_id: COOLER,
    cpu_product_id: CPU,
    cooler_max_tdp_watts: 250,
    cpu_tdp_watts: 125,
    ...overrides,
  };
}

test('OG-09: a cooler rated above the CPU TDP PASSes, with headroom in evidence', () => {
  const r = resolveCoolerCpuTdp(base());
  assert.equal(r.status, FINAL_STATUSES.PASS);
  assert.equal(r.reason, null);
  assert.equal(r.evidence[0].cooler_max_tdp_watts, 250);
  assert.equal(r.evidence[0].cpu_tdp_watts, 125);
  assert.equal(r.evidence[0].headroom_watts, 125);
});

test('OG-09: the boundary is INCLUSIVE - a cooler rated exactly at the CPU TDP is adequate', () => {
  const r = resolveCoolerCpuTdp(base({ cooler_max_tdp_watts: 125, cpu_tdp_watts: 125 }));
  assert.equal(r.status, FINAL_STATUSES.PASS);
  assert.equal(r.evidence[0].headroom_watts, 0);
});

// THE DESIGN DECISION: unlike OG-11/OG-12 this rule must NEVER FAIL, because
// vendor TDP figures are marketing numbers rather than measurements. If this
// test ever sees FAIL, an under-spec cooler can REJECT a build and the whole
// point of the soft rule is gone.
test('OG-09: an under-spec cooler is UNKNOWN (SOFT), never FAIL and never a REJECT', () => {
  const r = resolveCoolerCpuTdp(base({ cooler_max_tdp_watts: 65, cpu_tdp_watts: 125 }));
  assert.notEqual(r.status, FINAL_STATUSES.FAIL);
  assert.equal(r.status, FINAL_STATUSES.UNKNOWN);
  assert.equal(r.reason, REASON_CODES.COOLER_TDP_INSUFFICIENT);
  assert.equal(r.evidence[0].over_by_watts, 60);
});

test('OG-09: one watt under the CPU TDP is UNKNOWN with the shortfall recorded', () => {
  const r = resolveCoolerCpuTdp(base({ cooler_max_tdp_watts: 124, cpu_tdp_watts: 125 }));
  assert.equal(r.status, FINAL_STATUSES.UNKNOWN);
  assert.equal(r.reason, REASON_CODES.COOLER_TDP_INSUFFICIENT);
  assert.equal(r.evidence[0].over_by_watts, 1);
});

// An unmeasured cooler is not an unlimited one: the catalog's Corsair Nautilus
// carries a NULL max_tdp_watts because no vendor figure is published.
test('OG-09: a NULL cooler TDP is UNKNOWN, never a PASS', () => {
  const r = resolveCoolerCpuTdp(base({ cooler_max_tdp_watts: null }));
  assert.equal(r.status, FINAL_STATUSES.UNKNOWN);
  assert.equal(r.reason, REASON_CODES.COOLER_TDP_UNKNOWN);
  assert.equal(r.evidence[0].cooler_max_tdp_watts, null);
});

test('OG-09: a NULL CPU TDP is UNKNOWN (the CPU side is never assumed)', () => {
  const r = resolveCoolerCpuTdp(base({ cpu_tdp_watts: null }));
  assert.equal(r.status, FINAL_STATUSES.UNKNOWN);
  assert.equal(r.reason, REASON_CODES.COOLER_TDP_UNKNOWN);
});

test('OG-09: non-finite operands are UNKNOWN, never compared', () => {
  for (const bad of [NaN, Infinity, -Infinity, '125', undefined, {}]) {
    const r = resolveCoolerCpuTdp(base({ cpu_tdp_watts: bad }));
    assert.equal(r.status, FINAL_STATUSES.UNKNOWN, String(bad));
    assert.equal(r.reason, REASON_CODES.COOLER_TDP_UNKNOWN, String(bad));
  }
});

test('OG-09: a non-object input throws', () => {
  assert.throws(() => resolveCoolerCpuTdp(null), TypeError);
  assert.throws(() => resolveCoolerCpuTdp('nope'), TypeError);
});
