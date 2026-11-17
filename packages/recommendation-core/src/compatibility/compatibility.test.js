const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  FINAL_STATUSES,
  SOURCE_STATUSES,
  REASON_CODES,
  createCompatibilityResult,
  aggregateCompatibilityResults,
} = require('./index');

const { PASS, FAIL, UNKNOWN } = FINAL_STATUSES;

// ---------------------------------------------------------------------------
// Result construction
// ---------------------------------------------------------------------------

test('constructs a PASS result with null reason', () => {
  const result = createCompatibilityResult({ status: PASS, reason: null });
  assert.equal(result.status, PASS);
  assert.equal(result.reason, null);
  assert.deepEqual(result.evidence, []);
  assert.equal(result.penalty, null);
});

test('constructs a FAIL result with a reason code and evidence', () => {
  const result = createCompatibilityResult({
    status: FAIL,
    reason: REASON_CODES.GPU_TOO_LONG,
    evidence: [
      {
        rule: 'gpu_case_length',
        source_table: 'case_spec',
        source_id: 'case-123',
        source_status: null,
        gpu_length_mm: 340,
        max_gpu_length_mm: 320,
      },
    ],
  });
  assert.equal(result.status, FAIL);
  assert.equal(result.reason, 'GPU_TOO_LONG');
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].gpu_length_mm, 340);
  assert.equal(result.evidence[0].max_gpu_length_mm, 320);
});

test('result is frozen and immutable', () => {
  const result = createCompatibilityResult({ status: PASS });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.evidence));
  assert.throws(() => { 'use strict'; result.status = FAIL; }, TypeError);
});

// ---------------------------------------------------------------------------
// Valid statuses
// ---------------------------------------------------------------------------

test('accepts exactly PASS / FAIL / UNKNOWN as final statuses', () => {
  for (const status of [PASS, FAIL, UNKNOWN]) {
    const result = createCompatibilityResult({ status, reason: null });
    assert.equal(result.status, status);
  }
});

test('rejects CONDITIONAL as a final status', () => {
  assert.throws(
    () => createCompatibilityResult({ status: 'CONDITIONAL', reason: null }),
    /CONDITIONAL is a source status only/
  );
});

test('rejects arbitrary invalid statuses', () => {
  assert.throws(
    () => createCompatibilityResult({ status: 'MAYBE', reason: null }),
    TypeError
  );
  assert.throws(() => createCompatibilityResult({}), TypeError);
});

// ---------------------------------------------------------------------------
// Reason codes
// ---------------------------------------------------------------------------
test('required reason codes exist', () => {
  const required = [
    'CPU_SOCKET_MISMATCH',
    'CPU_MOTHERBOARD_SUPPORT_FAIL',
    'CPU_MOTHERBOARD_SUPPORT_UNKNOWN',
    'CPU_MOTHERBOARD_CONDITIONAL_UNVERIFIABLE',
    'COOLER_SOCKET_MISMATCH',
    'COOLER_SOCKET_SUPPORT_UNKNOWN',
    'CASE_FORM_FACTOR_MISMATCH',
    'CASE_FORM_FACTOR_UNKNOWN',
    'RADIATOR_UNSUPPORTED',
    'RADIATOR_SUPPORT_UNKNOWN',
    'PLATFORM_MEMORY_TYPE_UNSUPPORTED',
    'PLATFORM_MEMORY_SUPPORT_UNKNOWN',
    'MOTHERBOARD_MEMORY_TYPE_MISMATCH',
    'MOTHERBOARD_MEMORY_SUPPORT_UNKNOWN',
    'GPU_TOO_LONG',
    'GPU_TOO_THICK',
    'GPU_DIMENSIONS_UNKNOWN',
    'GPU_PSU_WATTAGE_INSUFFICIENT',
    'GPU_PSU_WATTAGE_UNKNOWN',
    'GPU_PSU_CONNECTOR_UNAVAILABLE',
    'GPU_PSU_CONNECTOR_UNKNOWN',
  ];
  for (const code of required) {
    assert.equal(REASON_CODES[code], code, `missing reason code ${code}`);
  }
});

test('rejects an unknown reason code', () => {
  assert.throws(
    () => createCompatibilityResult({ status: FAIL, reason: 'NOT_A_CODE' }),
    /Invalid reason code/
  );
});

// ---------------------------------------------------------------------------
// Structured evidence
// ---------------------------------------------------------------------------

test('evidence preserves rule, source record, source status, ids, values and conditions', () => {
  const result = createCompatibilityResult({
    status: UNKNOWN,
    reason: REASON_CODES.CPU_MOTHERBOARD_CONDITIONAL_UNVERIFIABLE,
    evidence: [
      {
        rule: 'cpu_motherboard_support',
        source_table: 'cpu_motherboard_support',
        source_id: 'cm-row-7',
        source_status: SOURCE_STATUSES.CONDITIONAL,
        motherboard_product_id: 'mb-1',
        cpu_product_id: 'cpu-1',
        min_bios_version: '7E4v41',
      },
    ],
  });
  const evidence = result.evidence[0];
  assert.equal(evidence.rule, 'cpu_motherboard_support');
  assert.equal(evidence.source_table, 'cpu_motherboard_support');
  assert.equal(evidence.source_id, 'cm-row-7');
  assert.equal(evidence.source_status, 'CONDITIONAL');
  assert.equal(evidence.motherboard_product_id, 'mb-1');
  assert.equal(evidence.cpu_product_id, 'cpu-1');
  assert.equal(evidence.min_bios_version, '7E4v41');
});

test('evidence item without a rule is rejected', () => {
  assert.throws(
    () =>
      createCompatibilityResult({
        status: PASS,
        evidence: [{ source_table: 'cpu_spec' }],
      }),
    /non-empty string "rule"/
  );
});

test('evidence items are frozen', () => {
  const result = createCompatibilityResult({
    status: PASS,
    evidence: [{ rule: 'r' }],
  });
  assert.ok(Object.isFrozen(result.evidence[0]));
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function pass() {
  return createCompatibilityResult({ status: PASS });
}

function unknown(reason = REASON_CODES.GPU_PSU_WATTAGE_UNKNOWN) {
  return createCompatibilityResult({ status: UNKNOWN, reason });
}

function fail(reason = REASON_CODES.GPU_TOO_LONG) {
  return createCompatibilityResult({ status: FAIL, reason });
}

test('PASS + PASS -> PASS', () => {
  assert.equal(aggregateCompatibilityResults([pass(), pass()]).status, PASS);
});

test('PASS + UNKNOWN -> UNKNOWN', () => {
  assert.equal(
    aggregateCompatibilityResults([pass(), unknown()]).status,
    UNKNOWN
  );
});

test('UNKNOWN + UNKNOWN -> UNKNOWN', () => {
  assert.equal(
    aggregateCompatibilityResults([unknown(), unknown()]).status,
    UNKNOWN
  );
});

test('PASS + FAIL -> FAIL', () => {
  assert.equal(aggregateCompatibilityResults([pass(), fail()]).status, FAIL);
});

test('UNKNOWN + FAIL -> FAIL', () => {
  assert.equal(aggregateCompatibilityResults([unknown(), fail()]).status, FAIL);
});

test('aggregation preserves individual evidence and the decisive reason', () => {
  const a = createCompatibilityResult({
    status: UNKNOWN,
    reason: REASON_CODES.CPU_MOTHERBOARD_SUPPORT_UNKNOWN,
    evidence: [{ rule: 'cpu_motherboard_support', source_id: 'row-1' }],
  });
  const b = createCompatibilityResult({
    status: FAIL,
    reason: REASON_CODES.GPU_TOO_LONG,
    evidence: [{ rule: 'gpu_case_length', source_id: 'case-1' }],
  });
  const aggregated = aggregateCompatibilityResults([a, b]);
  assert.equal(aggregated.status, FAIL);
  assert.equal(aggregated.reason, REASON_CODES.GPU_TOO_LONG);
  assert.equal(
    aggregated.evidence.length,
    a.evidence.length + b.evidence.length
  );
  assert.ok(aggregated.evidence.includes(a.evidence[0]));
  assert.ok(aggregated.evidence.includes(b.evidence[0]));
  assert.equal(aggregated.penalty, null);
});

test('aggregating an empty array yields PASS', () => {
  const aggregated = aggregateCompatibilityResults([]);
  assert.equal(aggregated.status, PASS);
  assert.equal(aggregated.reason, null);
  assert.deepEqual(aggregated.evidence, []);
});

// ---------------------------------------------------------------------------
// Penalty placeholder
// ---------------------------------------------------------------------------

test('numeric penalties are rejected at this stage', () => {
  assert.throws(
    () => createCompatibilityResult({ status: UNKNOWN, penalty: 5 }),
    /Penalty must be null/
  );
});

