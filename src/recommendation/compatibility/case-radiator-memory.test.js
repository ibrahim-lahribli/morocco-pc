const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  FINAL_STATUSES,
  SOURCE_STATUSES,
  REASON_CODES,
  resolveCaseMotherboardFormFactor,
  resolveCaseRadiator,
  resolvePlatformMemorySupport,
  resolveMotherboardRamMemoryType,
} = require('./index');

const { PASS, FAIL, UNKNOWN } = FINAL_STATUSES;

// ---------------------------------------------------------------------------
// Rule 4: motherboard <-> case form factor
// ---------------------------------------------------------------------------

test('case supports form factor row -> PASS', () => {
  const result = resolveCaseMotherboardFormFactor({
    case_product_id: 'case-1',
    motherboard_form_factor: 'ATX',
    form_factor_records: [
      { source_id: 'ff-row-1', form_factor: 'ATX' },
    ],
  });
  assert.equal(result.status, PASS);
  assert.equal(result.reason, null);
  assert.equal(result.evidence[0].rule, 'case_motherboard_form_factor');
  assert.equal(result.evidence[0].case_product_id, 'case-1');
  assert.equal(result.evidence[0].source_id, 'ff-row-1');
  assert.equal(result.evidence[0].source_status, SOURCE_STATUSES.PASS);
});

test('case explicit FAIL row -> FAIL CASE_FORM_FACTOR_MISMATCH', () => {
  const result = resolveCaseMotherboardFormFactor({
    case_product_id: 'case-1',
    motherboard_form_factor: 'ATX',
    form_factor_records: [
      { source_id: 'ff-row-2', form_factor: 'ATX', support_status: 'FAIL' },
    ],
  });
  assert.equal(result.status, FAIL);
  assert.equal(result.reason, REASON_CODES.CASE_FORM_FACTOR_MISMATCH);
});

test('case explicit UNKNOWN row -> UNKNOWN CASE_FORM_FACTOR_UNKNOWN', () => {
  const result = resolveCaseMotherboardFormFactor({
    case_product_id: 'case-1',
    motherboard_form_factor: 'ATX',
    form_factor_records: [
      { source_id: 'ff-row-3', form_factor: 'ATX', support_status: 'UNKNOWN' },
    ],
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.CASE_FORM_FACTOR_UNKNOWN);
  assert.equal(result.evidence[0].source_status, SOURCE_STATUSES.UNKNOWN);
});

test('absent form-factor row -> UNKNOWN (no naming inference)', () => {
  const result = resolveCaseMotherboardFormFactor({
    case_product_id: 'case-1',
    motherboard_form_factor: 'E-ATX',
    form_factor_records: [{ source_id: 'ff-row-1', form_factor: 'ATX' }],
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.CASE_FORM_FACTOR_UNKNOWN);
  assert.equal(result.evidence[0].source_status, null);
});

test('missing motherboard form factor -> UNKNOWN', () => {
  const result = resolveCaseMotherboardFormFactor({
    case_product_id: 'case-1',
    motherboard_form_factor: null,
    form_factor_records: [],
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.CASE_FORM_FACTOR_UNKNOWN);
});

test('CONDITIONAL form-factor row -> UNKNOWN preserved in evidence', () => {
  const result = resolveCaseMotherboardFormFactor({
    case_product_id: 'case-1',
    motherboard_form_factor: 'ATX',
    form_factor_records: [
      { source_id: 'ff-row-4', form_factor: 'ATX', support_status: 'CONDITIONAL' },
    ],
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.evidence[0].source_status, SOURCE_STATUSES.CONDITIONAL);
});

// ---------------------------------------------------------------------------
// Rule 5: case <-> radiator
// ---------------------------------------------------------------------------

const CASE_ID = 'case-9';

function radiatorRows(...rows) {
  return rows.map((r, i) => ({ source_id: 'rad-' + i, ...r }));
}

function radiatorInput(overrides = {}) {
  return {
    case_product_id: CASE_ID,
    cooler_requires_radiator: true,
    radiator_size_mm: 240,
    radiator_position: null,
    radiator_records: radiatorRows({ radiator_size_mm: 240, position: 'TOP' }),
    ...overrides,
  };
}

test('liquid cooler + supported radiator row -> PASS', () => {
  const result = resolveCaseRadiator(radiatorInput());
  assert.equal(result.status, PASS);
  assert.equal(result.reason, null);
  assert.equal(result.evidence[0].rule, 'case_radiator_support');
  assert.equal(result.evidence[0].case_product_id, CASE_ID);
  assert.equal(result.evidence[0].radiator_size_mm, 240);
});

test('liquid cooler + position-matched radiator row -> PASS', () => {
  const result = resolveCaseRadiator(
    radiatorInput({ radiator_position: 'TOP' })
  );
  assert.equal(result.status, PASS);
});

test('liquid cooler + wrong position -> UNKNOWN', () => {
  const result = resolveCaseRadiator(
    radiatorInput({ radiator_position: 'FRONT' })
  );
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.RADIATOR_SUPPORT_UNKNOWN);
});

test('explicit FAIL radiator row -> FAIL RADIATOR_UNSUPPORTED', () => {
  const result = resolveCaseRadiator(
    radiatorInput({
      radiator_records: radiatorRows({
        radiator_size_mm: 240,
        position: 'TOP',
        support_status: 'FAIL',
      }),
    })
  );
  assert.equal(result.status, FAIL);
  assert.equal(result.reason, REASON_CODES.RADIATOR_UNSUPPORTED);
});

test('explicit UNKNOWN radiator row -> UNKNOWN', () => {
  const result = resolveCaseRadiator(
    radiatorInput({
      radiator_records: radiatorRows({
        radiator_size_mm: 240,
        position: 'TOP',
        support_status: 'UNKNOWN',
      }),
    })
  );
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.RADIATOR_SUPPORT_UNKNOWN);
  assert.equal(result.evidence[0].source_status, SOURCE_STATUSES.UNKNOWN);
});

test('liquid cooler + rows exist but no matching size -> UNKNOWN', () => {
  const result = resolveCaseRadiator(
    radiatorInput({
      radiator_size_mm: 360,
      radiator_records: radiatorRows({ radiator_size_mm: 240, position: 'TOP' }),
    })
  );
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.RADIATOR_SUPPORT_UNKNOWN);
  assert.equal(result.evidence[0].row_count, 1);
});

test('liquid cooler + ZERO radiator rows -> FAIL RADIATOR_UNSUPPORTED', () => {
  const result = resolveCaseRadiator(
    radiatorInput({ radiator_records: [] })
  );
  assert.equal(result.status, FAIL);
  assert.equal(result.reason, REASON_CODES.RADIATOR_UNSUPPORTED);
  assert.equal(result.evidence[0].row_count, 0);
  assert.equal(result.evidence[0].cooler_requires_radiator, true);
});

test('air cooler + zero radiator rows -> PASS (special rule NOT triggered)', () => {
  const result = resolveCaseRadiator(
    radiatorInput({ cooler_requires_radiator: false, radiator_records: [] })
  );
  assert.equal(result.status, PASS);
  assert.equal(result.reason, null);
});

test('unknown cooler type + zero rows -> UNKNOWN (condition not established)', () => {
  const result = resolveCaseRadiator(
    radiatorInput({ cooler_requires_radiator: null, radiator_records: [] })
  );
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.RADIATOR_SUPPORT_UNKNOWN);
});

test('CONDITIONAL radiator row -> UNKNOWN preserved in evidence', () => {
  const result = resolveCaseRadiator(
    radiatorInput({
      radiator_records: radiatorRows({
        radiator_size_mm: 240,
        position: 'TOP',
        support_status: 'CONDITIONAL',
      }),
    })
  );
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.evidence[0].source_status, SOURCE_STATUSES.CONDITIONAL);
});

// ---------------------------------------------------------------------------
// Rule 6: platform <-> memory type
// ---------------------------------------------------------------------------

const PLATFORM_ID = 'platform-am5';
const DDR5 = 'ddr5';
const DDR4 = 'ddr4';

function platformInput(overrides = {}) {
  return {
    platform_id: PLATFORM_ID,
    memory_type_id: DDR5,
    platform_memory_records: [
      { source_id: 'pm-1', memory_type_id: DDR5 },
    ],
    ...overrides,
  };
}

test('platform has support rows + requested type row -> PASS', () => {
  const result = resolvePlatformMemorySupport(platformInput());
  assert.equal(result.status, PASS);
  assert.equal(result.reason, null);
  assert.equal(result.evidence[0].platform_id, PLATFORM_ID);
  assert.equal(result.evidence[0].memory_type_id, DDR5);
  assert.equal(result.evidence[0].source_id, 'pm-1');
});

test('platform has rows but requested type absent -> FAIL', () => {
  const result = resolvePlatformMemorySupport(
    platformInput({ memory_type_id: DDR4 })
  );
  assert.equal(result.status, FAIL);
  assert.equal(result.reason, REASON_CODES.PLATFORM_MEMORY_TYPE_UNSUPPORTED);
  assert.deepEqual(result.evidence[0].supported_memory_type_ids, [DDR5]);
});

test('platform has ZERO support rows -> UNKNOWN (not incompatible)', () => {
  const result = resolvePlatformMemorySupport(
    platformInput({ platform_memory_records: [] })
  );
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.PLATFORM_MEMORY_SUPPORT_UNKNOWN);
  assert.equal(result.evidence[0].row_count, 0);
});

test('missing requested memory type -> UNKNOWN (never PASS)', () => {
  const result = resolvePlatformMemorySupport(
    platformInput({ memory_type_id: null })
  );
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.PLATFORM_MEMORY_SUPPORT_UNKNOWN);
});

// ---------------------------------------------------------------------------
// Rule 7: motherboard <-> RAM memory type
// ---------------------------------------------------------------------------

test('matching motherboard / RAM memory types -> PASS', () => {
  const result = resolveMotherboardRamMemoryType({
    motherboard_memory_type_id: DDR5,
    ram_memory_type_id: DDR5,
  });
  assert.equal(result.status, PASS);
  assert.equal(result.reason, null);
  assert.equal(result.evidence[0].rule, 'motherboard_memory_type');
  assert.equal(result.evidence[0].ram_memory_type_id, DDR5);
});

test('mismatching memory types -> FAIL MOTHERBOARD_MEMORY_TYPE_MISMATCH', () => {
  const result = resolveMotherboardRamMemoryType({
    motherboard_memory_type_id: DDR5,
    ram_memory_type_id: DDR4,
  });
  assert.equal(result.status, FAIL);
  assert.equal(result.reason, REASON_CODES.MOTHERBOARD_MEMORY_TYPE_MISMATCH);
});

test('missing motherboard memory type -> UNKNOWN', () => {
  const result = resolveMotherboardRamMemoryType({
    motherboard_memory_type_id: null,
    ram_memory_type_id: DDR5,
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.MOTHERBOARD_MEMORY_SUPPORT_UNKNOWN);
  assert.equal(result.evidence[0].motherboard_memory_type_id, null);
});

test('missing RAM memory type -> UNKNOWN', () => {
  const result = resolveMotherboardRamMemoryType({
    motherboard_memory_type_id: DDR5,
    ram_memory_type_id: undefined,
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.MOTHERBOARD_MEMORY_SUPPORT_UNKNOWN);
  assert.equal(result.evidence[0].ram_memory_type_id, null);
});

// ---------------------------------------------------------------------------
// Aggregation integration
// ---------------------------------------------------------------------------

test('aggregateCompatibilityResults consumes the new resolver outputs', () => {
  const { aggregateCompatibilityResults } = require('./index');
  const aggregated = aggregateCompatibilityResults([
    resolveCaseMotherboardFormFactor({
      case_product_id: 'case-1',
      motherboard_form_factor: 'ATX',
      form_factor_records: [{ source_id: 'ff-1', form_factor: 'ATX' }],
    }),
    resolveCaseRadiator(
      radiatorInput({ cooler_requires_radiator: true, radiator_records: [] })
    ),
    resolvePlatformMemorySupport(platformInput({ memory_type_id: DDR4 })),
    resolveMotherboardRamMemoryType({
      motherboard_memory_type_id: DDR5,
      ram_memory_type_id: DDR5,
    }),
  ]);
  assert.equal(aggregated.status, FAIL);
  assert.equal(aggregated.reason, REASON_CODES.RADIATOR_UNSUPPORTED);
  assert.equal(aggregated.evidence.length, 4);
  assert.equal(aggregated.penalty, null);
});
