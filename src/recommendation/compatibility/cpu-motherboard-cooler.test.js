const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  FINAL_STATUSES,
  SOURCE_STATUSES,
  REASON_CODES,
  resolveCpuMotherboardSocket,
  resolveCpuMotherboardSupport,
  resolveCoolerSocketSupport,
} = require('./index');

const { PASS, FAIL, UNKNOWN } = FINAL_STATUSES;

// ---------------------------------------------------------------------------
// Rule 1: CPU socket <-> motherboard socket
// ---------------------------------------------------------------------------

test('matching sockets -> PASS', () => {
  const result = resolveCpuMotherboardSocket({
    cpu_socket_id: 'am5',
    motherboard_socket_id: 'am5',
  });
  assert.equal(result.status, PASS);
  assert.equal(result.reason, null);
  assert.equal(result.evidence[0].cpu_socket_id, 'am5');
  assert.equal(result.evidence[0].motherboard_socket_id, 'am5');
});

test('mismatching sockets -> FAIL CPU_SOCKET_MISMATCH', () => {
  const result = resolveCpuMotherboardSocket({
    cpu_socket_id: 'am5',
    motherboard_socket_id: 'lga1700',
  });
  assert.equal(result.status, FAIL);
  assert.equal(result.reason, REASON_CODES.CPU_SOCKET_MISMATCH);
});

test('missing CPU socket -> UNKNOWN CPU_SOCKET_UNKNOWN', () => {
  const result = resolveCpuMotherboardSocket({
    cpu_socket_id: null,
    motherboard_socket_id: 'am5',
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.CPU_SOCKET_UNKNOWN);
});

test('missing motherboard socket -> UNKNOWN CPU_SOCKET_UNKNOWN', () => {
  const result = resolveCpuMotherboardSocket({
    cpu_socket_id: 'am5',
    motherboard_socket_id: undefined,
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.CPU_SOCKET_UNKNOWN);
  assert.equal(result.evidence[0].motherboard_socket_id, null);
});

// ---------------------------------------------------------------------------
// Rule 2: CPU <-> motherboard support (precedence: exact > family > UNKNOWN)
// ---------------------------------------------------------------------------

const MB_ID = 'mb-1';
const CPU_ID = 'cpu-1';
const FAMILY_ID = 'family-1';

function exactRecord(status, extra = {}) {
  return {
    source_table: 'cpu_motherboard_support',
    source_id: 'exact-row',
    support_status: status,
    motherboard_product_id: MB_ID,
    cpu_product_id: CPU_ID,
    ...extra,
  };
}

function familyRecord(status, extra = {}) {
  return {
    source_table: 'cpu_motherboard_support',
    source_id: 'family-row',
    support_status: status,
    motherboard_product_id: MB_ID,
    cpu_product_family_id: FAMILY_ID,
    ...extra,
  };
}

test('exact PASS -> PASS', () => {
  const result = resolveCpuMotherboardSupport({ exact_record: exactRecord('PASS') });
  assert.equal(result.status, PASS);
  assert.equal(result.reason, null);
  assert.equal(result.evidence[0].rule, 'cpu_motherboard_support_exact');
  assert.equal(result.evidence[0].cpu_product_id, CPU_ID);
});

test('exact FAIL -> FAIL', () => {
  const result = resolveCpuMotherboardSupport({ exact_record: exactRecord('FAIL') });
  assert.equal(result.status, FAIL);
  assert.equal(result.reason, REASON_CODES.CPU_MOTHERBOARD_SUPPORT_FAIL);
});

test('exact CONDITIONAL -> UNKNOWN with condition preserved', () => {
  const result = resolveCpuMotherboardSupport({
    exact_record: exactRecord('CONDITIONAL', { min_bios_version: '7E4v41' }),
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.CPU_MOTHERBOARD_CONDITIONAL_UNVERIFIABLE);
  assert.equal(result.evidence[0].source_status, SOURCE_STATUSES.CONDITIONAL);
  assert.equal(result.evidence[0].min_bios_version, '7E4v41');
});

test('family PASS -> PASS', () => {
  const result = resolveCpuMotherboardSupport({ family_record: familyRecord('PASS') });
  assert.equal(result.status, PASS);
  assert.equal(result.reason, null);
  assert.equal(result.evidence[0].rule, 'cpu_motherboard_support_family');
  assert.equal(result.evidence[0].cpu_product_family_id, FAMILY_ID);
});

test('family FAIL -> FAIL', () => {
  const result = resolveCpuMotherboardSupport({ family_record: familyRecord('FAIL') });
  assert.equal(result.status, FAIL);
  assert.equal(result.reason, REASON_CODES.CPU_MOTHERBOARD_SUPPORT_FAIL);
});

test('family CONDITIONAL -> UNKNOWN with condition preserved', () => {
  const result = resolveCpuMotherboardSupport({
    family_record: familyRecord('CONDITIONAL', { min_bios_version: '1.2.0' }),
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.CPU_MOTHERBOARD_CONDITIONAL_UNVERIFIABLE);
  assert.equal(result.evidence[0].source_status, SOURCE_STATUSES.CONDITIONAL);
  assert.equal(result.evidence[0].min_bios_version, '1.2.0');
});

test('no exact and no family record -> UNKNOWN', () => {
  const result = resolveCpuMotherboardSupport({});
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.CPU_MOTHERBOARD_SUPPORT_UNKNOWN);
  assert.equal(result.evidence[0].source_status, null);
});

// Precedence: an existing exact record ALWAYS decides.

test('exact FAIL overrides family PASS -> FAIL', () => {
  const result = resolveCpuMotherboardSupport({
    exact_record: exactRecord('FAIL'),
    family_record: familyRecord('PASS'),
  });
  assert.equal(result.status, FAIL);
  assert.equal(result.reason, REASON_CODES.CPU_MOTHERBOARD_SUPPORT_FAIL);
  assert.equal(result.evidence[0].rule, 'cpu_motherboard_support_exact');
});

test('exact PASS overrides family FAIL -> PASS', () => {
  const result = resolveCpuMotherboardSupport({
    exact_record: exactRecord('PASS'),
    family_record: familyRecord('FAIL'),
  });
  assert.equal(result.status, PASS);
  assert.equal(result.reason, null);
  assert.equal(result.evidence[0].rule, 'cpu_motherboard_support_exact');
});

test('exact CONDITIONAL overrides family PASS -> UNKNOWN', () => {
  const result = resolveCpuMotherboardSupport({
    exact_record: exactRecord('CONDITIONAL', { min_bios_version: '3.4.0' }),
    family_record: familyRecord('PASS'),
  });
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.CPU_MOTHERBOARD_CONDITIONAL_UNVERIFIABLE);
  assert.equal(result.evidence[0].rule, 'cpu_motherboard_support_exact');
});

test('family record is never consulted when exact exists', () => {
  const result = resolveCpuMotherboardSupport({
    exact_record: exactRecord('PASS'),
    family_record: familyRecord('FAIL'),
  });
  assert.ok(!JSON.stringify(result.evidence).includes('family-row'));
});

// ---------------------------------------------------------------------------
// Rule 3: cooler <-> CPU socket
// ---------------------------------------------------------------------------

const COOLER_ID = 'cooler-1';
const SOCKET_AM5 = 'am5';

function coolerRow(status, extra = {}) {
  return {
    source_table: 'cooler_socket_support',
    source_id: 'cooler-row-1',
    socket_id: SOCKET_AM5,
    support_status: status,
    ...extra,
  };
}

function coolerInput(overrides = {}) {
  return {
    cooler_product_id: COOLER_ID,
    cpu_socket_id: SOCKET_AM5,
    support_records: [coolerRow('PASS')],
    ...overrides,
  };
}

test('cooler PASS row -> PASS', () => {
  const result = resolveCoolerSocketSupport(coolerInput());
  assert.equal(result.status, PASS);
  assert.equal(result.reason, null);
  assert.equal(result.evidence[0].cooler_product_id, COOLER_ID);
  assert.equal(result.evidence[0].cpu_socket_id, SOCKET_AM5);
});

test('cooler FAIL row -> FAIL COOLER_SOCKET_MISMATCH', () => {
  const result = resolveCoolerSocketSupport(
    coolerInput({ support_records: [coolerRow('FAIL')] })
  );
  assert.equal(result.status, FAIL);
  assert.equal(result.reason, REASON_CODES.COOLER_SOCKET_MISMATCH);
});

test('cooler UNKNOWN row -> UNKNOWN', () => {
  const result = resolveCoolerSocketSupport(
    coolerInput({ support_records: [coolerRow('UNKNOWN')] })
  );
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.COOLER_SOCKET_SUPPORT_UNKNOWN);
  assert.equal(result.evidence[0].source_status, SOURCE_STATUSES.UNKNOWN);
});

test('cooler CONDITIONAL row -> UNKNOWN with CONDITIONAL preserved', () => {
  const result = resolveCoolerSocketSupport(
    coolerInput({ support_records: [coolerRow('CONDITIONAL')] })
  );
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.COOLER_SOCKET_SUPPORT_UNKNOWN);
  assert.equal(result.evidence[0].source_status, SOURCE_STATUSES.CONDITIONAL);
  assert.equal(result.evidence[0].source_id, 'cooler-row-1');
});

test('no relationship row for the socket -> UNKNOWN (nothing invented)', () => {
  const result = resolveCoolerSocketSupport(
    coolerInput({ support_records: [{ ...coolerRow('PASS'), socket_id: 'lga1700' }] })
  );
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.COOLER_SOCKET_SUPPORT_UNKNOWN);
  assert.equal(result.evidence[0].source_status, null);
});

test('missing CPU socket id -> UNKNOWN', () => {
  const result = resolveCoolerSocketSupport(
    coolerInput({ cpu_socket_id: null, support_records: [coolerRow('PASS')] })
  );
  assert.equal(result.status, UNKNOWN);
  assert.equal(result.reason, REASON_CODES.COOLER_SOCKET_SUPPORT_UNKNOWN);
});

// ---------------------------------------------------------------------------
// Integration with aggregation
// ---------------------------------------------------------------------------

test('aggregateCompatibilityResults consumes the new resolver outputs', () => {
  const { aggregateCompatibilityResults } = require('./index');
  const aggregated = aggregateCompatibilityResults([
    resolveCpuMotherboardSocket({ cpu_socket_id: 'am5', motherboard_socket_id: 'am5' }),
    resolveCpuMotherboardSupport({}),
    resolveCoolerSocketSupport(
      coolerInput({ support_records: [coolerRow('FAIL')] })
    ),
  ]);
  assert.equal(aggregated.status, FAIL);
  assert.equal(aggregated.reason, REASON_CODES.COOLER_SOCKET_MISMATCH);
  assert.equal(aggregated.evidence.length, 3);
  assert.equal(aggregated.penalty, null);
});
