'use strict';

// ---------------------------------------------------------------------------
// E6 (Decision 54): unit tests for the CPU eligibility set implied by a
// declared `IGPU_ALLOWED` GPU policy. Pure, DB-free.
//
// Scope: the null cases (REQUIRED / absent), the tri-state iGPU semantics
// (true keeps, false drops, NULL drops), a missing spec row, dedupe and
// determinism, the frozen return, input immutability, and the fail-fast
// boundary errors.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { excludedCpuProductIds, GPU_POLICY_VALUES } = require('./igpu-pool');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

function context({ cpus, flags }) {
  const candidates = {
    CPU: cpus.map((id) => ({ product_id: id, product_variant_id: null, component_role: 'CPU' })),
    GPU: [],
  };
  const specs = {};
  for (const [id, value] of Object.entries(flags)) {
    specs['p:' + id] = { integrated_gpu_present: value, socket_id: null, product_family_id: null, tdp_watts: null };
  }
  return { candidates, specs, platform_by_socket: {}, compat: {} };
}

function rejectionOf(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

test('E6: a null, absent or REQUIRED policy produces no exclusions', () => {
  assert.equal(excludedCpuProductIds({ gpuPolicy: null }), null);
  assert.equal(excludedCpuProductIds({}), null);
  assert.equal(excludedCpuProductIds({ gpuPolicy: 'REQUIRED' }), null);
});

test('E6: a malformed policy is refused before any context is read', () => {
  for (const bad of ['', 'IGPU', 1, true]) {
    const error = rejectionOf(() => excludedCpuProductIds({ gpuPolicy: bad }));
    assert.ok(error instanceof CandidateSelectionError);
    assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE);
    assert.equal(error.field, 'gpuPolicy');
  }
});

test('E6: only CPUs with integrated_gpu_present === true survive IGPU_ALLOWED', () => {
  const c1 = U(1); // true -> keeps
  const c2 = U(2); // false -> excluded
  const c3 = U(3); // null -> excluded (UNKNOWN is not evidence of an iGPU)
  const c4 = U(4); // no spec row -> excluded
  const excluded = excludedCpuProductIds({
    gpuPolicy: 'IGPU_ALLOWED',
    filteringContext: context({ cpus: [c1, c2, c3, c4], flags: { [c1]: true, [c2]: false, [c3]: null } }),
  });
  assert.deepEqual(excluded, [c2, c3, c4].sort());
  assert.ok(Object.isFrozen(excluded));
});

test('E6: duplicate CPU candidate rows are deduped and the order is canonical', () => {
  const a = U(9);
  const b = U(10);
  const out = excludedCpuProductIds({
    gpuPolicy: 'IGPU_ALLOWED',
    filteringContext: context({ cpus: [b, a, b, a], flags: { [a]: false, [b]: false } }),
  });
  assert.deepEqual(out, [a, b].sort());
  assert.equal(new Set(out).size, out.length);
});

test('E6: the derivation never mutates the context and is deterministic', () => {
  const id = U(5);
  const ctx = context({ cpus: [id], flags: { [id]: false } });
  const before = JSON.stringify(ctx);
  const first = excludedCpuProductIds({ gpuPolicy: 'IGPU_ALLOWED', filteringContext: ctx });
  const second = excludedCpuProductIds({ gpuPolicy: 'IGPU_ALLOWED', filteringContext: ctx });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(ctx), before);
});

test('E6: a malformed context is refused with the fielded path', () => {
  const badContexts = [undefined, null, 'nope', [], { candidates: {}, specs: {} }, { candidates: { CPU: [] }, specs: [] }];
  for (const filteringContext of badContexts) {
    const error = rejectionOf(() => excludedCpuProductIds({ gpuPolicy: 'IGPU_ALLOWED', filteringContext }));
    assert.ok(error instanceof CandidateSelectionError, JSON.stringify(filteringContext));
    assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
  }
  const noId = {
    candidates: { CPU: [{ product_id: null }] },
    specs: {},
  };
  const error = rejectionOf(() => excludedCpuProductIds({ gpuPolicy: 'IGPU_ALLOWED', filteringContext: noId }));
  assert.equal(error.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(error.field, 'filteringContext.candidates.CPU');
});

test('E6: the helper understands exactly the declared GPU-policy vocabulary', () => {
  assert.deepEqual([...GPU_POLICY_VALUES], ['REQUIRED', 'IGPU_ALLOWED']);
});
