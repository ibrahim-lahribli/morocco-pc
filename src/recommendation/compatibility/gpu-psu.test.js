const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  FINAL_STATUSES,
  REASON_CODES,
  resolveGpuCaseLength,
  resolveGpuCaseThickness,
  resolveGpuPsuWattage,
  resolveGpuPsuConnectors,
  aggregateCompatibilityResults,
} = require('./index');

const { PASS, FAIL, UNKNOWN } = FINAL_STATUSES;

// ---------------------------------------------------------------------------
// Rule 8: GPU length <-> case
// ---------------------------------------------------------------------------

test('GPU length fits -> PASS', () => {
  const result = resolveGpuCaseLength({
    gpu_product_variant_id: 'gpu-v-1',
    case_product_id: 'case-1',
    gpu_length_mm: 300,
    case_max_gpu_length_mm: 320,
  });
  assert.equal(result.status, PASS);
  assert.equal(result.reason, null);
  assert.equal(result.evidence[0].gpu_length_mm, undefined);
  assert.equal(result.evidence[0].gpu_value, 300);
  assert.equal(result.evidence[0].limit_value, 320);
  assert.equal(result.evidence[0].rule, 'gpu_case_length');
});

test('GPU too long -> FAIL GPU_TOO_LONG', () => {
  const result = resolveGpuCaseLength({
    gpu_product_variant_id: 'gpu-v-1',
    case_product_id: 'case-1',
    gpu_length_mm: 340,
    case_max_gpu_length_mm: 320,
  });
  assert.equal(result.status, FAIL);
  assert.equal(result.reason, REASON_CODES.GPU_TOO_LONG);
  assert.equal(result.evidence[0].gpu_value, 340);
  assert.equal(result.evidence[0].limit_value, 320);
});

test('GPU length exactly equals case limit -> PASS (boundary equality)', () => {
  const result = resolveGpuCaseLength({
    gpu_length_mm: 320,
    case_max_gpu_length_mm: 320,
  });
  assert.equal(result.status, PASS);
});

test('GPU length missing -> UNKNOWN GPU_DIMENSIONS_UNKNOWN', () => {
  const result = resolveGpuCaseLength({
    gpu_length_mm: null,
    case_max_gpu_length_mm: 320,
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.GPU_DIMENSIONS_UNKNOWN);
  assert.equal(result.evidence[0].gpu_value, null);
});

test('case max GPU length missing -> UNKNOWN (NULL is never unlimited)', () => {
  const result = resolveGpuCaseLength({
    gpu_length_mm: 300,
    case_max_gpu_length_mm: null,
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.GPU_DIMENSIONS_UNKNOWN);
});

// ---------------------------------------------------------------------------
// Rule 9: GPU thickness <-> case
// ---------------------------------------------------------------------------

test('GPU thickness fits -> PASS', () => {
  const result = resolveGpuCaseThickness({
    gpu_product_variant_id: 'gpu-v-1',
    case_product_id: 'case-1',
    gpu_width_slots: 2.5,
    case_max_gpu_thickness_slots: 3,
  });
  assert.equal(result.status, PASS);
  assert.equal(result.evidence[0].rule, 'gpu_case_thickness');
});

test('GPU too thick -> FAIL GPU_TOO_THICK', () => {
  const result = resolveGpuCaseThickness({
    gpu_product_variant_id: 'gpu-v-1',
    case_product_id: 'case-1',
    gpu_width_slots: 4,
    case_max_gpu_thickness_slots: 3,
  });
  assert.equal(result.status, FAIL);
  assert.equal(result.reason, REASON_CODES.GPU_TOO_THICK);
});

test('GPU thickness exactly equals case limit -> PASS (boundary equality)', () => {
  const result = resolveGpuCaseThickness({
    gpu_width_slots: 2.5,
    case_max_gpu_thickness_slots: 2.5,
  });
  assert.equal(result.status, PASS);
});

test('GPU thickness missing -> UNKNOWN', () => {
  const result = resolveGpuCaseThickness({
    gpu_width_slots: null,
    case_max_gpu_thickness_slots: 3,
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.GPU_DIMENSIONS_UNKNOWN);
});

test('case max GPU thickness missing -> UNKNOWN', () => {
  const result = resolveGpuCaseThickness({
    gpu_width_slots: 2,
    case_max_gpu_thickness_slots: null,
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.GPU_DIMENSIONS_UNKNOWN);
});

// ---------------------------------------------------------------------------
// Rule 10: GPU <-> PSU wattage
// ---------------------------------------------------------------------------

test('PSU wattage sufficient -> PASS', () => {
  const result = resolveGpuPsuWattage({
    gpu_product_variant_id: 'gpu-v-1',
    psu_product_id: 'psu-1',
    gpu_recommended_psu_watts: 650,
    psu_rated_wattage: 750,
  });
  assert.equal(result.status, PASS);
  assert.equal(result.evidence[0].rule, 'gpu_psu_wattage');
  assert.equal(result.evidence[0].gpu_value, 650);
  assert.equal(result.evidence[0].limit_value, 750);
});

test('PSU wattage insufficient -> FAIL GPU_PSU_WATTAGE_INSUFFICIENT', () => {
  const result = resolveGpuPsuWattage({
    gpu_product_variant_id: 'gpu-v-1',
    psu_product_id: 'psu-1',
    gpu_recommended_psu_watts: 850,
    psu_rated_wattage: 750,
  });
  assert.equal(result.status, FAIL);
  assert.equal(result.reason, REASON_CODES.GPU_PSU_WATTAGE_INSUFFICIENT);
});

test('GPU requirement exactly equals PSU wattage -> PASS (boundary equality)', () => {
  const result = resolveGpuPsuWattage({
    gpu_recommended_psu_watts: 750,
    psu_rated_wattage: 750,
  });
  assert.equal(result.status, PASS);
});

test('GPU wattage requirement missing -> UNKNOWN', () => {
  const result = resolveGpuPsuWattage({
    gpu_recommended_psu_watts: null,
    psu_rated_wattage: 750,
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.GPU_PSU_WATTAGE_UNKNOWN);
});

test('PSU wattage missing -> UNKNOWN (never treated as unlimited)', () => {
  const result = resolveGpuPsuWattage({
    gpu_recommended_psu_watts: 650,
    psu_rated_wattage: null,
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.GPU_PSU_WATTAGE_UNKNOWN);
});

// ---------------------------------------------------------------------------
// Rule 11: GPU <-> PSU connectors
// ---------------------------------------------------------------------------

const PSU_CONNECTORS = {
  '24pin_atx': 1,
  eps: 2,
  pcie_8pin: 2,
  '12vhpwr': 1,
  sata: 4,
};

test('all required connectors available -> PASS', () => {
  const result = resolveGpuPsuConnectors({
    gpu_product_variant_id: 'gpu-v-1',
    psu_product_id: 'psu-1',
    gpu_required_power_connectors: { pcie_8pin: 2, '12vhpwr': 1 },
    psu_power_connectors: PSU_CONNECTORS,
  });
  assert.equal(result.status, PASS);
  assert.equal(result.reason, null);
  assert.equal(result.evidence[0].rule, 'gpu_psu_connectors');
  assert.deepEqual(result.evidence[0].required_connectors, {
    pcie_8pin: 2,
    '12vhpwr': 1,
  });
});

test('exact connector count equality -> PASS', () => {
  const result = resolveGpuPsuConnectors({
    gpu_required_power_connectors: { pcie_8pin: 2 },
    psu_power_connectors: PSU_CONNECTORS,
  });
  assert.equal(result.status, PASS);
});

test('required connector unavailable -> FAIL GPU_PSU_CONNECTOR_UNAVAILABLE', () => {
  const result = resolveGpuPsuConnectors({
    gpu_product_variant_id: 'gpu-v-1',
    psu_product_id: 'psu-1',
    gpu_required_power_connectors: { '12vhpwr': 2 },
    psu_power_connectors: PSU_CONNECTORS,
  });
  assert.equal(result.status, FAIL);
  assert.equal(result.reason, REASON_CODES.GPU_PSU_CONNECTOR_UNAVAILABLE);
  assert.deepEqual(result.evidence[0].connector_deficits, {
    '12vhpwr': { required: 2, available: 1 },
  });
});

test('GPU required connector info missing -> UNKNOWN', () => {
  const result = resolveGpuPsuConnectors({
    gpu_required_power_connectors: null,
    psu_power_connectors: PSU_CONNECTORS,
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.GPU_PSU_CONNECTOR_UNKNOWN);
});

test('PSU connector availability missing for a needed connector -> UNKNOWN', () => {
  const result = resolveGpuPsuConnectors({
    gpu_required_power_connectors: { '12vhpwr': 1 },
    psu_power_connectors: { '24pin_atx': 1, eps: 1, pcie_8pin: 2 },
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.GPU_PSU_CONNECTOR_UNKNOWN);
  assert.deepEqual(result.evidence[0].unverifiable_connectors, ['12vhpwr']);
});

test('unknown connector name -> UNKNOWN (compatibility never invented)', () => {
  const result = resolveGpuPsuConnectors({
    gpu_required_power_connectors: { '12v2x6': 1 },
    psu_power_connectors: PSU_CONNECTORS,
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.GPU_PSU_CONNECTOR_UNKNOWN);
  assert.deepEqual(result.evidence[0].unverifiable_connectors, ['12v2x6']);
});

test('empty GPU requirements -> PASS (nothing required)', () => {
  const result = resolveGpuPsuConnectors({
    gpu_required_power_connectors: {},
    psu_power_connectors: PSU_CONNECTORS,
  });
  assert.equal(result.status, PASS);
});

test('PSU connector info entirely missing -> UNKNOWN', () => {
  const result = resolveGpuPsuConnectors({
    gpu_required_power_connectors: { pcie_8pin: 1 },
    psu_power_connectors: null,
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.GPU_PSU_CONNECTOR_UNKNOWN);
});

test('array-form requirements (each name counts once) supported', () => {
  const result = resolveGpuPsuConnectors({
    gpu_required_power_connectors: ['pcie_8pin', 'pcie_8pin'],
    psu_power_connectors: PSU_CONNECTORS,
  });
  assert.equal(result.status, PASS);
});

// ---------------------------------------------------------------------------
// Aggregation integration
// ---------------------------------------------------------------------------

test('PASS + PASS + UNKNOWN + FAIL aggregates to FAIL with evidence preserved', () => {
  const aggregated = aggregateCompatibilityResults([
    resolveGpuCaseLength({
      gpu_length_mm: 300,
      case_max_gpu_length_mm: 320,
    }),
    resolveGpuCaseThickness({
      gpu_width_slots: 2,
      case_max_gpu_thickness_slots: 3,
    }),
    resolveGpuPsuWattage({
      gpu_recommended_psu_watts: null,
      psu_rated_wattage: 750,
    }),
    resolveGpuPsuConnectors({
      gpu_required_power_connectors: { '12vhpwr': 2 },
      psu_power_connectors: PSU_CONNECTORS,
    }),
  ]);
  assert.equal(aggregated.status, FAIL);
  assert.equal(aggregated.reason, REASON_CODES.GPU_PSU_CONNECTOR_UNAVAILABLE);
  assert.equal(aggregated.evidence.length, 4);
  assert.deepEqual(
    aggregated.evidence.map((e) => e.rule),
    ['gpu_case_length', 'gpu_case_thickness', 'gpu_psu_wattage', 'gpu_psu_connectors']
  );
  assert.ok(
    aggregated.evidence.some(
      (e) => e.gpu_value === 300 && e.limit_value === 320
    )
  );
  assert.ok(
    aggregated.evidence.some(
      (e) => e.gpu_value === null && e.limit_value === 750
    )
  );
  assert.deepEqual(
    aggregated.evidence.find((e) => e.rule === 'gpu_psu_connectors')
      .connector_deficits,
    { '12vhpwr': { required: 2, available: 1 } }
  );
  assert.equal(aggregated.penalty, null);
});
