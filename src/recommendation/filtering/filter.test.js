'use strict';

// ---------------------------------------------------------------------------
// Focused B2-D unit tests: the pure Engine 2D filter over small in-memory
// frozen contexts. No database is used or required anywhere in this file.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { filterCandidates, CANDIDATE_STATUSES } = require('./filter');
const { COMPONENT_ROLES, ROLE_CATEGORIES } = require('../candidates/roles');
const { createCandidate } = require('../candidates');
const { FINAL_STATUSES, REASON_CODES } = require('../compatibility');

// Deterministic id helpers (hex, lexicographically orderable).
const U = (n) => 'uuuuuuuu-uuuu-uuuu-uuuu-' + String(n).padStart(12, '0');
const V = (n) => 'vvvvvvvv-vvvv-vvvv-vvvv-' + String(n).padStart(12, '0');
// Socket ids share the P() id space with platform ids (as in B2-B tests).
const P = (n) => 'pppppppp-pppp-pppp-pppp-' + String(n).padStart(12, '0');

const CPU_ID = U(1);
const MB_ID = U(2);
const RAM_ID = U(3);
const GPU_ID = U(4);
const PSU_ID = U(5);
const COOLER_ID = U(6);
const CASE_ID = U(7);
const SSD_ID = U(8);

const GPU_VARIANT_ID = V(1);
const PLATFORM_ID = P(10);
const SOCKET_ID = P(1);       // golden CPU + motherboard socket
const OTHER_SOCKET_ID = P(2); // mismatched socket
const FAMILY_ID = P(30);
const RAM_MEMORY_TYPE_ID = P(20);

// ---------------------------------------------------------------------------
// Context builders. Specs / compat rows mirror the B2-B normalized shapes
// exactly ('p:<product_id>' / 'v:<product_variant_id>' keys; loader-shaped
// compat rows with source_table / source_id / support_status).
// ---------------------------------------------------------------------------

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function makeCandidate(role, productId, variantId = null) {
  return createCandidate({
    component_role: role,
    category: ROLE_CATEGORIES[role],
    product_id: productId,
    product_variant_id: variantId,
  });
}

function cpuSpec(overrides = {}) {
  return { socket_id: SOCKET_ID, product_family_id: FAMILY_ID, ...overrides };
}

function motherboardSpec(overrides = {}) {
  return {
    socket_id: SOCKET_ID,
    form_factor: 'ATX',
    memory_type_id: RAM_MEMORY_TYPE_ID,
    ...overrides,
  };
}

function ramSpec(overrides = {}) {
  return { memory_type_id: RAM_MEMORY_TYPE_ID, ...overrides };
}

function coolerSpec(overrides = {}) {
  return {
    cooling_type: 'AIR',
    cooler_requires_radiator: false,
    radiator_size_mm: null, // B2-C: no authoritative value; stays null
    radiator_position: null,
    ...overrides,
  };
}

function caseSpec(overrides = {}) {
  return { max_gpu_length_mm: 360, max_gpu_thickness_slots: 3, ...overrides };
}

function psuSpec(overrides = {}) {
  return {
    rated_wattage: 750,
    power_connectors: { '24pin_atx': 1, eps: 1, pcie_8pin: 2, '12vhpwr': 1, sata: 4 },
    ...overrides,
  };
}

function gpuSpec(overrides = {}) {
  return {
    length_mm: 300,
    width_slots: 2.5, // JS number (B2-C normalization)
    required_power_connectors: { pcie_8pin: 1 }, // structured JSON
    recommended_psu_watts: 650,
    ...overrides,
  };
}

function compatRow(sourceTable, sourceId, extra = {}) {
  return { source_table: sourceTable, source_id: sourceId, support_status: null, ...extra };
}

function cpuMotherboardExactRow(overrides = {}) {
  return compatRow('cpu_motherboard_support', 'cm-exact', {
    support_status: 'PASS',
    cpu_product_id: CPU_ID,
    min_bios_version: null,
    ...overrides,
  });
}

function cpuMotherboardFamilyRow(overrides = {}) {
  return compatRow('cpu_motherboard_support', 'cm-family', {
    support_status: 'PASS',
    cpu_product_family_id: FAMILY_ID,
    min_bios_version: null,
    ...overrides,
  });
}

function coolerSocketRow(overrides = {}) {
  return compatRow('cooler_socket_support', 'cs-1', {
    support_status: 'PASS',
    socket_id: SOCKET_ID,
    ...overrides,
  });
}

function caseFormFactorRow(overrides = {}) {
  return compatRow('case_motherboard_form_factor', 'cff-1', {
    form_factor: 'ATX',
    ...overrides,
  });
}

function caseRadiatorRow(overrides = {}) {
  return compatRow('case_radiator_support', 'cr-1', {
    radiator_size_mm: 240,
    position: 'TOP',
    ...overrides,
  });
}

function platformMemoryRow(overrides = {}) {
  return compatRow('platform_memory_support', 'pm-1', {
    memory_type_id: RAM_MEMORY_TYPE_ID,
    ...overrides,
  });
}

function goldenSpecs() {
  return {
    ['p:' + CPU_ID]: cpuSpec(),
    ['p:' + MB_ID]: motherboardSpec(),
    ['p:' + RAM_ID]: ramSpec(),
    ['p:' + COOLER_ID]: coolerSpec(),
    ['p:' + CASE_ID]: caseSpec(),
    ['p:' + PSU_ID]: psuSpec(),
    ['v:' + GPU_VARIANT_ID]: gpuSpec(),
  };
}

function goldenCompat() {
  return {
    cpu_motherboard_exact: { [MB_ID]: [cpuMotherboardExactRow()] },
    cpu_motherboard_family: {},
    cooler_socket: { [COOLER_ID]: [coolerSocketRow()] },
    case_form_factor: { [CASE_ID]: [caseFormFactorRow()] },
    case_radiator: { [CASE_ID]: [caseRadiatorRow()] },
    platform_memory: { [PLATFORM_ID]: [platformMemoryRow()] },
  };
}

/**
 * The golden pool is deliberately listed in NON-canonical role order to
 * prove the filter re-orders output by canonical role (B2-C bucket order).
 * Every product is fully compatible with every partner.
 */
function goldenPool() {
  return [
    makeCandidate('SSD_BOOT', SSD_ID),
    makeCandidate('CASE', CASE_ID),
    makeCandidate('CPU', CPU_ID),
    makeCandidate('PSU', PSU_ID),
    makeCandidate('GPU', GPU_ID, GPU_VARIANT_ID),
    makeCandidate('CPU_COOLER', COOLER_ID),
    makeCandidate('MOTHERBOARD', MB_ID),
    makeCandidate('RAM', RAM_ID),
  ];
}

function bucketCandidates(pool) {
  const buckets = {};
  for (const role of COMPONENT_ROLES) {
    buckets[role] = [];
  }
  for (const candidate of pool) {
    buckets[candidate.component_role].push(candidate);
  }
  return buckets;
}

function buildContext({ pool, specs = {}, platform_by_socket = {}, compat = {} }) {
  return deepFreeze({
    candidates: bucketCandidates(pool),
    specs,
    platform_by_socket,
    compat,
  });
}

function goldenPlatformBySocket() {
  return { [SOCKET_ID]: PLATFORM_ID };
}

function goldenContext() {
  return buildContext({
    pool: goldenPool(),
    specs: goldenSpecs(),
    platform_by_socket: goldenPlatformBySocket(),
    compat: goldenCompat(),
  });
}

function findResult(result, role, productId) {
  return result.results.find(
    (entry) => entry.component_role === role && entry.product_id === productId
  );
}

/** Assert one candidate verdict: status + reason + full relationships map. */
function assertVerdict(entry, { status, reason = null, relationships }) {
  assert.equal(entry.status, status);
  assert.equal(entry.reason, reason);
  assert.deepEqual(entry.relationships, relationships);
}
// ---------------------------------------------------------------------------
// Aggregation semantics (pair -> relationship -> candidate).
// ---------------------------------------------------------------------------

test('B2-D: all-PASS candidate - fully compatible pool passes every relationship', () => {
  const result = filterCandidates(goldenContext());

  assert.equal(result.results.length, 8);
  for (const entry of result.results) {
    assert.equal(entry.status, CANDIDATE_STATUSES.PASS, entry.component_role);
    assert.equal(entry.reason, null);
    for (const relationshipStatus of Object.values(entry.relationships)) {
      assert.equal(relationshipStatus, FINAL_STATUSES.PASS);
    }
  }

  const cpu = findResult(result, 'CPU', CPU_ID);
  assert.deepEqual(cpu.relationships, {
    cpu_motherboard: FINAL_STATUSES.PASS,
    cooler_socket: FINAL_STATUSES.PASS,
    platform_memory: FINAL_STATUSES.PASS,
  });

  // SSD roles participate in no relationship: vacuously PASS.
  const ssd = findResult(result, 'SSD_BOOT', SSD_ID);
  assert.deepEqual(ssd.relationships, {});
});

test('B2-D: UNKNOWN caused by absent partner role - zero partners is never a FAIL', () => {
  const context = buildContext({
    pool: [makeCandidate('CPU', CPU_ID), makeCandidate('RAM', RAM_ID)],
    specs: { ['p:' + CPU_ID]: cpuSpec(), ['p:' + RAM_ID]: ramSpec() },
    platform_by_socket: goldenPlatformBySocket(),
    compat: goldenCompat(),
  });

  const result = filterCandidates(context);
  const cpu = findResult(result, 'CPU', CPU_ID);
  assertVerdict(cpu, {
    status: CANDIDATE_STATUSES.UNKNOWN,
    relationships: {
      cpu_motherboard: FINAL_STATUSES.UNKNOWN, // no MOTHERBOARD candidates
      cooler_socket: FINAL_STATUSES.UNKNOWN, // no CPU_COOLER candidates
      platform_memory: FINAL_STATUSES.PASS, // RAM partner present and supported
    },
  });

  const ram = findResult(result, 'RAM', RAM_ID);
  assert.equal(ram.status, CANDIDATE_STATUSES.UNKNOWN);
  assert.equal(ram.relationships.motherboard_memory, FINAL_STATUSES.UNKNOWN);
  assert.equal(ram.relationships.platform_memory, FINAL_STATUSES.PASS);
});

test('B2-D: unknown_pairwise_count is 0 when every evaluated pair passes', () => {
  const result = filterCandidates(goldenContext());
  assert.equal(result.results.length, 8);
  for (const entry of result.results) {
    assert.equal(entry.unknown_pairwise_count, 0, entry.component_role);
  }
});

test('B2-D: unknown_pairwise_count counts the UNKNOWN pairs, per direction, ignoring PASS/FAIL', () => {
  // A second motherboard on the same socket with no matching exact/family
  // support record: the CPU's cpu_motherboard pairs are PASS (MB_ID) and
  // UNKNOWN (the unsupported board) -> count 1, relationship PASS (best-of).
  const unsupportedMbId = U(20);
  const pool = [
    makeCandidate('CPU', CPU_ID),
    makeCandidate('MOTHERBOARD', MB_ID),
    makeCandidate('MOTHERBOARD', unsupportedMbId),
  ];
  const specs = {
    ...goldenSpecs(),
    ['p:' + unsupportedMbId]: motherboardSpec(), // same socket: socket check passes
  };
  const compat = goldenCompat();
  compat.cpu_motherboard_exact = {
    [MB_ID]: [cpuMotherboardExactRow()],
    [unsupportedMbId]: [cpuMotherboardExactRow({ cpu_product_id: U(99) })],
  };
  compat.cpu_motherboard_family = {
    [unsupportedMbId]: [cpuMotherboardFamilyRow({ cpu_product_family_id: P(31) })],
  };
  const result = filterCandidates(buildContext({
    pool, specs, platform_by_socket: goldenPlatformBySocket(), compat,
  }));

  // CPU: pair vs MB_ID is PASS (not counted), pair vs the unsupported board
  // is UNKNOWN (counted); best-of keeps the relationship PASS.
  const cpu = findResult(result, 'CPU', CPU_ID);
  assert.equal(cpu.relationships.cpu_motherboard, FINAL_STATUSES.PASS);
  assert.equal(cpu.unknown_pairwise_count, 1);

  // MB_ID: its single pair (vs the CPU) passes: count 0.
  const supportedMb = findResult(result, 'MOTHERBOARD', MB_ID);
  assert.equal(supportedMb.unknown_pairwise_count, 0);

  // The unsupported board evaluates the same pair from its own side
  // (symmetric) and that one pair is UNKNOWN: count 1.
  const unsupportedMb = findResult(result, 'MOTHERBOARD', unsupportedMbId);
  assert.equal(unsupportedMb.relationships.cpu_motherboard, FINAL_STATUSES.UNKNOWN);
  assert.equal(unsupportedMb.unknown_pairwise_count, 1);
});

test('B2-D: unknown_pairwise_count - zero partners contributes 0 even when the relationship is UNKNOWN', () => {
  const context = buildContext({
    pool: [makeCandidate('CPU', CPU_ID), makeCandidate('RAM', RAM_ID)],
    specs: { ['p:' + CPU_ID]: cpuSpec(), ['p:' + RAM_ID]: ramSpec() },
    platform_by_socket: goldenPlatformBySocket(),
    compat: goldenCompat(),
  });

  const result = filterCandidates(context);
  const cpu = findResult(result, 'CPU', CPU_ID);
  // Two vacuous relationship-level UNKNOWNs (no MOTHERBOARD / CPU_COOLER
  // candidates at all): no pair exists, so nothing is counted.
  assert.equal(cpu.relationships.cpu_motherboard, FINAL_STATUSES.UNKNOWN);
  assert.equal(cpu.relationships.cooler_socket, FINAL_STATUSES.UNKNOWN);
  assert.equal(cpu.unknown_pairwise_count, 0);
});

test('B2-D: unknown_pairwise_count - FAIL pairs are not counted and REJECT verdicts carry the count', () => {
  const mismatchedMbId = U(21);
  const pool = [
    makeCandidate('CPU', CPU_ID),
    makeCandidate('MOTHERBOARD', MB_ID),
    makeCandidate('MOTHERBOARD', mismatchedMbId), // different socket -> pair FAIL
  ];
  const specs = {
    ...goldenSpecs(),
    ['p:' + mismatchedMbId]: motherboardSpec({ socket_id: OTHER_SOCKET_ID }),
  };
  const result = filterCandidates(buildContext({
    pool, specs, platform_by_socket: goldenPlatformBySocket(), compat: goldenCompat(),
  }));

  // CPU: pairs PASS (MB_ID) and FAIL (mismatched board) - neither resolves
  // UNKNOWN, so the count stays 0 while best-of keeps the relationship PASS.
  const cpu = findResult(result, 'CPU', CPU_ID);
  assert.equal(cpu.relationships.cpu_motherboard, FINAL_STATUSES.PASS);
  assert.equal(cpu.unknown_pairwise_count, 0);

  // The mismatched board's single pair FAILs -> REJECT. REJECT verdicts
  // still carry the field (uniform contract).
  const mismatched = findResult(result, 'MOTHERBOARD', mismatchedMbId);
  assert.equal(mismatched.status, CANDIDATE_STATUSES.REJECT);
  assert.equal(mismatched.relationships.cpu_motherboard, FINAL_STATUSES.FAIL);
  assert.equal(mismatched.unknown_pairwise_count, 0);
});

test('B2-D: UNKNOWN caused by unresolved/null data - null CPU socket stays UNKNOWN', () => {
  const specs = goldenSpecs();
  specs['p:' + CPU_ID] = cpuSpec({ socket_id: null });
  const context = buildContext({
    pool: [makeCandidate('CPU', CPU_ID), makeCandidate('MOTHERBOARD', MB_ID)],
    specs,
    platform_by_socket: goldenPlatformBySocket(),
    compat: goldenCompat(),
  });

  const result = filterCandidates(context);
  const cpu = findResult(result, 'CPU', CPU_ID);
  // socket UNKNOWN + exact support PASS -> pair UNKNOWN (worst-of).
  assert.equal(cpu.relationships.cpu_motherboard, FINAL_STATUSES.UNKNOWN);
  assert.equal(cpu.status, CANDIDATE_STATUSES.UNKNOWN);
  assert.equal(cpu.reason, REASON_CODES.CPU_SOCKET_UNKNOWN);
});

test('B2-D: relationship FAIL when every partner pair fails (socket mismatch)', () => {
  const specs = goldenSpecs();
  specs['p:' + MB_ID] = motherboardSpec({ socket_id: OTHER_SOCKET_ID });
  const context = buildContext({
    pool: [makeCandidate('CPU', CPU_ID), makeCandidate('MOTHERBOARD', MB_ID)],
    specs,
    platform_by_socket: goldenPlatformBySocket(),
    compat: goldenCompat(),
  });

  const result = filterCandidates(context);
  const cpu = findResult(result, 'CPU', CPU_ID);
  assert.equal(cpu.relationships.cpu_motherboard, FINAL_STATUSES.FAIL);
  const motherboard = findResult(result, 'MOTHERBOARD', MB_ID);
  assert.equal(motherboard.relationships.cpu_motherboard, FINAL_STATUSES.FAIL);
});

test('B2-D: candidate REJECT with the decisive reason on definitive incompatibility', () => {
  const specs = goldenSpecs();
  specs['p:' + MB_ID] = motherboardSpec({ socket_id: OTHER_SOCKET_ID });
  const context = buildContext({
    pool: [makeCandidate('CPU', CPU_ID), makeCandidate('MOTHERBOARD', MB_ID)],
    specs,
    platform_by_socket: goldenPlatformBySocket(),
    compat: goldenCompat(),
  });

  const result = filterCandidates(context);
  const cpu = findResult(result, 'CPU', CPU_ID);
  assert.equal(cpu.status, CANDIDATE_STATUSES.REJECT);
  assert.equal(cpu.reason, REASON_CODES.CPU_SOCKET_MISMATCH);
  const motherboard = findResult(result, 'MOTHERBOARD', MB_ID);
  assert.equal(motherboard.status, CANDIDATE_STATUSES.REJECT);
  assert.equal(motherboard.reason, REASON_CODES.CPU_SOCKET_MISMATCH);
});

test('B2-D: multiple partners where one passes - relationship PASS, failing partner rejected', () => {
  const extraMotherboardId = U(9);
  const pool = [...goldenPool(), makeCandidate('MOTHERBOARD', extraMotherboardId)];
  const specs = goldenSpecs();
  specs['p:' + extraMotherboardId] = motherboardSpec({ socket_id: OTHER_SOCKET_ID });
  const context = buildContext({
    pool,
    specs,
    platform_by_socket: goldenPlatformBySocket(),
    compat: goldenCompat(),
  });

  const result = filterCandidates(context);
  const cpu = findResult(result, 'CPU', CPU_ID);
  // One passing pair is enough: any PASS -> PASS.
  assert.equal(cpu.relationships.cpu_motherboard, FINAL_STATUSES.PASS);
  assert.equal(cpu.status, CANDIDATE_STATUSES.PASS);

  const goodMotherboard = findResult(result, 'MOTHERBOARD', MB_ID);
  assert.equal(goodMotherboard.status, CANDIDATE_STATUSES.PASS);
  const badMotherboard = findResult(result, 'MOTHERBOARD', extraMotherboardId);
  assert.equal(badMotherboard.status, CANDIDATE_STATUSES.REJECT);
  assert.equal(badMotherboard.reason, REASON_CODES.CPU_SOCKET_MISMATCH);
});

test('B2-D: multiple partners where all fail - relationship FAIL and candidate REJECT', () => {
  const mbIdA = U(9);
  const mbIdB = U(10);
  const context = buildContext({
    pool: [
      makeCandidate('CPU', CPU_ID),
      makeCandidate('MOTHERBOARD', mbIdA),
      makeCandidate('MOTHERBOARD', mbIdB),
    ],
    specs: {
      ['p:' + CPU_ID]: cpuSpec(),
      ['p:' + mbIdA]: motherboardSpec({ socket_id: OTHER_SOCKET_ID }),
      ['p:' + mbIdB]: motherboardSpec({ socket_id: OTHER_SOCKET_ID }),
    },
    platform_by_socket: goldenPlatformBySocket(),
    compat: goldenCompat(),
  });

  const result = filterCandidates(context);
  const cpu = findResult(result, 'CPU', CPU_ID);
  assert.equal(cpu.relationships.cpu_motherboard, FINAL_STATUSES.FAIL);
  assert.equal(cpu.status, CANDIDATE_STATUSES.REJECT);
  assert.equal(findResult(result, 'MOTHERBOARD', mbIdA).status, CANDIDATE_STATUSES.REJECT);
  assert.equal(findResult(result, 'MOTHERBOARD', mbIdB).status, CANDIDATE_STATUSES.REJECT);
});

test('B2-D: PASS + UNKNOWN partner pairs - relationship PASS, UNKNOWN partner stays UNKNOWN', () => {
  const unknownMotherboardId = U(9);
  const pool = [...goldenPool(), makeCandidate('MOTHERBOARD', unknownMotherboardId)];
  const specs = goldenSpecs();
  specs['p:' + unknownMotherboardId] = motherboardSpec({ socket_id: null });
  const context = buildContext({
    pool,
    specs,
    platform_by_socket: goldenPlatformBySocket(),
    compat: goldenCompat(),
  });

  const result = filterCandidates(context);
  const cpu = findResult(result, 'CPU', CPU_ID);
  assert.equal(cpu.relationships.cpu_motherboard, FINAL_STATUSES.PASS);
  assert.equal(cpu.status, CANDIDATE_STATUSES.PASS);

  const unknownMotherboard = findResult(result, 'MOTHERBOARD', unknownMotherboardId);
  assert.equal(unknownMotherboard.relationships.cpu_motherboard, FINAL_STATUSES.UNKNOWN);
  assert.equal(unknownMotherboard.status, CANDIDATE_STATUSES.UNKNOWN);
});

test('B2-D: pair FAIL dominates UNKNOWN and PASS within one pair (cpu_motherboard support)', () => {
  // (a) socket PASS + exact support FAIL -> pair FAIL -> REJECT.
  const failingCompat = goldenCompat();
  failingCompat.cpu_motherboard_exact = {
    [MB_ID]: [cpuMotherboardExactRow({ support_status: 'FAIL' })],
  };
  const failing = filterCandidates(buildContext({
    pool: [makeCandidate('CPU', CPU_ID), makeCandidate('MOTHERBOARD', MB_ID)],
    specs: goldenSpecs(),
    platform_by_socket: goldenPlatformBySocket(),
    compat: failingCompat,
  }));
  const rejectedCpu = findResult(failing, 'CPU', CPU_ID);
  assert.equal(rejectedCpu.status, CANDIDATE_STATUSES.REJECT);
  assert.equal(rejectedCpu.relationships.cpu_motherboard, FINAL_STATUSES.FAIL);
  assert.equal(rejectedCpu.reason, REASON_CODES.CPU_MOTHERBOARD_SUPPORT_FAIL);

  // (b) socket PASS + exact support CONDITIONAL -> pair UNKNOWN (worst-of).
  const conditionalCompat = goldenCompat();
  conditionalCompat.cpu_motherboard_exact = {
    [MB_ID]: [cpuMotherboardExactRow({ support_status: 'CONDITIONAL', min_bios_version: '1.2.3' })],
  };
  const conditional = filterCandidates(buildContext({
    pool: [makeCandidate('CPU', CPU_ID), makeCandidate('MOTHERBOARD', MB_ID)],
    specs: goldenSpecs(),
    platform_by_socket: goldenPlatformBySocket(),
    compat: conditionalCompat,
  }));
  const unknownCpu = findResult(conditional, 'CPU', CPU_ID);
  assert.equal(unknownCpu.status, CANDIDATE_STATUSES.UNKNOWN);
  assert.equal(unknownCpu.relationships.cpu_motherboard, FINAL_STATUSES.UNKNOWN);
  assert.equal(unknownCpu.reason, REASON_CODES.CPU_MOTHERBOARD_CONDITIONAL_UNVERIFIABLE);
});
test('B2-D: GPU<->CASE aggregates length and thickness into one pair verdict', () => {
  // (a) length FAIL + thickness PASS -> FAIL (GPU_TOO_LONG).
  const tooLong = goldenSpecs();
  tooLong['v:' + GPU_VARIANT_ID] = gpuSpec({ length_mm: 400 });
  const longResult = filterCandidates(buildContext({
    pool: [makeCandidate('GPU', GPU_ID, GPU_VARIANT_ID), makeCandidate('CASE', CASE_ID)],
    specs: tooLong,
    platform_by_socket: {},
    compat: goldenCompat(),
  }));
  const longGpu = findResult(longResult, 'GPU', GPU_ID);
  assert.equal(longGpu.relationships.gpu_case, FINAL_STATUSES.FAIL);
  assert.equal(longGpu.status, CANDIDATE_STATUSES.REJECT);
  assert.equal(longGpu.reason, REASON_CODES.GPU_TOO_LONG);

  // (b) length PASS + thickness FAIL -> FAIL (GPU_TOO_THICK).
  const tooThick = goldenSpecs();
  tooThick['v:' + GPU_VARIANT_ID] = gpuSpec({ width_slots: 3.5 });
  const thickResult = filterCandidates(buildContext({
    pool: [makeCandidate('GPU', GPU_ID, GPU_VARIANT_ID), makeCandidate('CASE', CASE_ID)],
    specs: tooThick,
    platform_by_socket: {},
    compat: goldenCompat(),
  }));
  const thickGpu = findResult(thickResult, 'GPU', GPU_ID);
  assert.equal(thickGpu.relationships.gpu_case, FINAL_STATUSES.FAIL);
  assert.equal(thickGpu.status, CANDIDATE_STATUSES.REJECT);
  assert.equal(thickGpu.reason, REASON_CODES.GPU_TOO_THICK);

  // (c) length PASS + thickness UNKNOWN (null) -> pair UNKNOWN.
  const unknownThickness = goldenSpecs();
  unknownThickness['v:' + GPU_VARIANT_ID] = gpuSpec({ width_slots: null });
  const unknownResult = filterCandidates(buildContext({
    pool: [makeCandidate('GPU', GPU_ID, GPU_VARIANT_ID), makeCandidate('CASE', CASE_ID)],
    specs: unknownThickness,
    platform_by_socket: {},
    compat: goldenCompat(),
  }));
  const unknownGpu = findResult(unknownResult, 'GPU', GPU_ID);
  assert.equal(unknownGpu.relationships.gpu_case, FINAL_STATUSES.UNKNOWN);
  assert.equal(unknownGpu.status, CANDIDATE_STATUSES.UNKNOWN);
  assert.equal(unknownGpu.reason, REASON_CODES.GPU_DIMENSIONS_UNKNOWN);
});

test('B2-D: GPU<->PSU aggregates wattage and connectors into one pair verdict', () => {
  // (a) wattage FAIL + connectors PASS -> FAIL (GPU_PSU_WATTAGE_INSUFFICIENT).
  const heavyGpuSpecs = goldenSpecs();
  heavyGpuSpecs['v:' + GPU_VARIANT_ID] = gpuSpec({ recommended_psu_watts: 800 });
  const wattageResult = filterCandidates(buildContext({
    pool: [makeCandidate('GPU', GPU_ID, GPU_VARIANT_ID), makeCandidate('PSU', PSU_ID)],
    specs: heavyGpuSpecs,
    platform_by_socket: {},
    compat: goldenCompat(),
  }));
  const wattageGpu = findResult(wattageResult, 'GPU', GPU_ID);
  assert.equal(wattageGpu.relationships.gpu_psu, FINAL_STATUSES.FAIL);
  assert.equal(wattageGpu.status, CANDIDATE_STATUSES.REJECT);
  assert.equal(wattageGpu.reason, REASON_CODES.GPU_PSU_WATTAGE_INSUFFICIENT);

  // (b) wattage PASS + connector deficit -> FAIL (GPU_PSU_CONNECTOR_UNAVAILABLE).
  const deficitSpecs = goldenSpecs();
  deficitSpecs['v:' + GPU_VARIANT_ID] = gpuSpec({ required_power_connectors: { pcie_8pin: 2 } });
  deficitSpecs['p:' + PSU_ID] = psuSpec({
    power_connectors: { '24pin_atx': 1, eps: 1, pcie_8pin: 1, '12vhpwr': 1, sata: 4 },
  });
  const connectorResult = filterCandidates(buildContext({
    pool: [makeCandidate('GPU', GPU_ID, GPU_VARIANT_ID), makeCandidate('PSU', PSU_ID)],
    specs: deficitSpecs,
    platform_by_socket: {},
    compat: goldenCompat(),
  }));
  const connectorGpu = findResult(connectorResult, 'GPU', GPU_ID);
  assert.equal(connectorGpu.relationships.gpu_psu, FINAL_STATUSES.FAIL);
  assert.equal(connectorGpu.status, CANDIDATE_STATUSES.REJECT);
  assert.equal(connectorGpu.reason, REASON_CODES.GPU_PSU_CONNECTOR_UNAVAILABLE);
});

test('B2-D: ambiguous/unmapped platform stays unresolved -> platform memory UNKNOWN', () => {
  // (a) No mapping at all (ambiguous or unmapped socket): no platform id,
  //     no records - UNKNOWN, never FAIL.
  const unmapped = buildContext({
    pool: [makeCandidate('CPU', CPU_ID), makeCandidate('RAM', RAM_ID)],
    specs: { ['p:' + CPU_ID]: cpuSpec(), ['p:' + RAM_ID]: ramSpec() },
    platform_by_socket: {},
    compat: goldenCompat(),
  });
  const unmappedResult = filterCandidates(unmapped);
  const unmappedCpu = findResult(unmappedResult, 'CPU', CPU_ID);
  assert.equal(unmappedCpu.relationships.platform_memory, FINAL_STATUSES.UNKNOWN);
  assert.equal(unmappedCpu.status, CANDIDATE_STATUSES.UNKNOWN);

  // (b) Mapped platform with zero memory rows: absence reads as UNKNOWN.
  const emptyPlatform = buildContext({
    pool: goldenPool(),
    specs: goldenSpecs(),
    platform_by_socket: goldenPlatformBySocket(),
    compat: { ...goldenCompat(), platform_memory: {} },
  });
  const emptyResult = filterCandidates(emptyPlatform);
  const emptyCpu = findResult(emptyResult, 'CPU', CPU_ID);
  assert.equal(emptyCpu.relationships.platform_memory, FINAL_STATUSES.UNKNOWN);
  assert.equal(emptyCpu.status, CANDIDATE_STATUSES.UNKNOWN);
  assert.equal(emptyCpu.reason, REASON_CODES.PLATFORM_MEMORY_SUPPORT_UNKNOWN);
});

test('B2-D: PSU connector count null stays UNKNOWN while 0 fails (null is never 0)', () => {
  // (a) null count: availability unproven -> UNKNOWN (pair worst-of UNKNOWN).
  const nullSpecs = goldenSpecs();
  nullSpecs['p:' + PSU_ID] = psuSpec({
    power_connectors: { '24pin_atx': 1, eps: 1, pcie_8pin: null, '12vhpwr': 1, sata: 4 },
  });
  const nullResult = filterCandidates(buildContext({
    pool: [
      makeCandidate('GPU', GPU_ID, GPU_VARIANT_ID),
      makeCandidate('PSU', PSU_ID),
      makeCandidate('CASE', CASE_ID), // compatible case: gpu_case PASSes first
    ],
    specs: nullSpecs,
    platform_by_socket: {},
    compat: goldenCompat(),
  }));
  const nullGpu = findResult(nullResult, 'GPU', GPU_ID);
  assert.equal(nullGpu.relationships.gpu_psu, FINAL_STATUSES.UNKNOWN);
  assert.equal(nullGpu.status, CANDIDATE_STATUSES.UNKNOWN);
  assert.equal(nullGpu.reason, REASON_CODES.GPU_PSU_CONNECTOR_UNKNOWN);

  // (b) 0 count: verifiable deficit -> FAIL.
  const zeroSpecs = goldenSpecs();
  zeroSpecs['p:' + PSU_ID] = psuSpec({
    power_connectors: { '24pin_atx': 1, eps: 1, pcie_8pin: 0, '12vhpwr': 1, sata: 4 },
  });
  const zeroResult = filterCandidates(buildContext({
    pool: [
      makeCandidate('GPU', GPU_ID, GPU_VARIANT_ID),
      makeCandidate('PSU', PSU_ID),
      makeCandidate('CASE', CASE_ID),
    ],
    specs: zeroSpecs,
    platform_by_socket: {},
    compat: goldenCompat(),
  }));
  const zeroGpu = findResult(zeroResult, 'GPU', GPU_ID);
  assert.equal(zeroGpu.relationships.gpu_psu, FINAL_STATUSES.FAIL);
  assert.equal(zeroGpu.status, CANDIDATE_STATUSES.REJECT);
  assert.equal(zeroGpu.reason, REASON_CODES.GPU_PSU_CONNECTOR_UNAVAILABLE);
});

test('B2-D: HYBRID/null cooler radiator requirement stays tri-state UNKNOWN', () => {
  const basePool = () => [
    makeCandidate('CPU', CPU_ID),
    makeCandidate('CPU_COOLER', COOLER_ID),
    makeCandidate('CASE', CASE_ID),
  ];

  // (a) HYBRID cooler: cooler_requires_radiator null -> UNKNOWN (never FAIL,
  //     never PASS-by-default).
  const hybridSpecs = goldenSpecs();
  hybridSpecs['p:' + COOLER_ID] = coolerSpec({
    cooling_type: 'HYBRID',
    cooler_requires_radiator: null,
  });
  const hybridResult = filterCandidates(buildContext({
    pool: basePool(),
    specs: hybridSpecs,
    platform_by_socket: goldenPlatformBySocket(),
    compat: goldenCompat(),
  }));
  const hybridCooler = findResult(hybridResult, 'CPU_COOLER', COOLER_ID);
  assert.equal(hybridCooler.relationships.cooler_socket, FINAL_STATUSES.PASS);
  assert.equal(hybridCooler.relationships.case_radiator, FINAL_STATUSES.UNKNOWN);
  assert.equal(hybridCooler.status, CANDIDATE_STATUSES.UNKNOWN);
  assert.equal(hybridCooler.reason, REASON_CODES.RADIATOR_SUPPORT_UNKNOWN);

  // (b) Liquid cooler: radiator_size_mm stays null (B2-C contract) - the
  //     required size is never invented, so the check stays UNKNOWN.
  const liquidSpecs = goldenSpecs();
  liquidSpecs['p:' + COOLER_ID] = coolerSpec({
    cooling_type: 'LIQUID',
    cooler_requires_radiator: true,
  });
  const liquidResult = filterCandidates(buildContext({
    pool: basePool(),
    specs: liquidSpecs,
    platform_by_socket: goldenPlatformBySocket(),
    compat: goldenCompat(),
  }));
  const liquidCooler = findResult(liquidResult, 'CPU_COOLER', COOLER_ID);
  assert.equal(liquidCooler.relationships.case_radiator, FINAL_STATUSES.UNKNOWN);
  assert.equal(liquidCooler.status, CANDIDATE_STATUSES.UNKNOWN);
  assert.equal(liquidCooler.reason, REASON_CODES.RADIATOR_SUPPORT_UNKNOWN);
});

test('B2-D: CPU<->MOTHERBOARD exact/family support wiring (exact > family > UNKNOWN)', () => {
  const pool = [makeCandidate('CPU', CPU_ID), makeCandidate('MOTHERBOARD', MB_ID)];
  const build = (compat) => buildContext({
    pool,
    specs: goldenSpecs(),
    platform_by_socket: goldenPlatformBySocket(),
    compat,
  });

  // An exact record for a DIFFERENT cpu product must not match; the family
  // record for this CPU's family decides -> PASS.
  const familyCompat = goldenCompat();
  familyCompat.cpu_motherboard_exact = {
    [MB_ID]: [cpuMotherboardExactRow({ cpu_product_id: U(99) })],
  };
  familyCompat.cpu_motherboard_family = {
    [MB_ID]: [cpuMotherboardFamilyRow({ cpu_product_family_id: FAMILY_ID })],
  };
  const familyCpu = findResult(filterCandidates(build(familyCompat)), 'CPU', CPU_ID);
  assert.equal(familyCpu.relationships.cpu_motherboard, FINAL_STATUSES.PASS);

  // No exact record and a family record for another family -> UNKNOWN.
  const unknownCompat = goldenCompat();
  unknownCompat.cpu_motherboard_exact = {};
  unknownCompat.cpu_motherboard_family = {
    [MB_ID]: [cpuMotherboardFamilyRow({ cpu_product_family_id: P(31) })],
  };
  const unknownCpu = findResult(filterCandidates(build(unknownCompat)), 'CPU', CPU_ID);
  assert.equal(unknownCpu.relationships.cpu_motherboard, FINAL_STATUSES.UNKNOWN);
  assert.equal(unknownCpu.reason, REASON_CODES.CPU_MOTHERBOARD_SUPPORT_UNKNOWN);
});

test('B2-D: repeated evaluation of the same context is deterministic', () => {
  const context = goldenContext();
  const first = filterCandidates(context);
  const second = filterCandidates(context);
  assert.deepEqual(first, second);

  // Also deterministic across structurally identical, freshly built contexts.
  const third = filterCandidates(goldenContext());
  assert.deepEqual(first, third);
});
test('B2-D: filtering never mutates the frozen input context', () => {
  const context = goldenContext();
  const snapshot = JSON.parse(JSON.stringify(context));

  filterCandidates(context);

  assert.deepEqual(context, snapshot);
  assert.ok(Object.isFrozen(context));
  assert.ok(Object.isFrozen(context.candidates));
  assert.ok(Object.isFrozen(context.candidates.CPU));
  assert.ok(Object.isFrozen(context.specs));
  assert.ok(Object.isFrozen(context.platform_by_socket));
  assert.ok(Object.isFrozen(context.compat));
  for (const key of [
    'cpu_motherboard_exact', 'cpu_motherboard_family', 'cooler_socket',
    'case_form_factor', 'case_radiator', 'platform_memory',
  ]) {
    assert.ok(Object.isFrozen(context.compat[key]));
  }
});

test('B2-D: result records preserve the Engine 2C candidate identity exactly', () => {
  const context = goldenContext();
  const result = filterCandidates(context);

  let cursor = 0;
  for (const role of COMPONENT_ROLES) {
    for (const candidate of context.candidates[role]) {
      const entry = result.results[cursor++];
      assert.notEqual(entry, candidate); // freshly built record, never aliased
      assert.deepEqual(
        {
          product_id: entry.product_id,
          product_variant_id: entry.product_variant_id,
          category: entry.category,
          component_role: entry.component_role,
        },
        {
          product_id: candidate.product_id,
          product_variant_id: candidate.product_variant_id,
          category: candidate.category,
          component_role: candidate.component_role,
        }
      );
      assert.deepEqual(Object.keys(entry).sort(), [
        'category', 'component_role', 'product_id', 'product_variant_id',
        'reason', 'relationships', 'status', 'unknown_pairwise_count',
      ]);
      assert.ok(Object.isFrozen(entry));
      assert.ok(Object.isFrozen(entry.relationships));
    }
  }
});

test('B2-D: output ordering follows canonical role order and B2-C bucket order', () => {
  const result = filterCandidates(goldenContext());
  assert.deepEqual(
    result.results.map((entry) => [entry.component_role, entry.product_id]),
    [
      ['CPU', CPU_ID],
      ['GPU', GPU_ID],
      ['MOTHERBOARD', MB_ID],
      ['RAM', RAM_ID],
      ['SSD_BOOT', SSD_ID],
      ['PSU', PSU_ID],
      ['CASE', CASE_ID],
      ['CPU_COOLER', COOLER_ID],
    ]
  );
});
test('B2-D: the filter takes only the context and performs no database access', () => {
  // The filter's only parameter is the context - there is no db/client slot.
  assert.equal(filterCandidates.length, 1);

  const filterSource = fs.readFileSync(path.join(__dirname, 'filter.js'), 'utf8');
  assert.doesNotMatch(filterSource, /require\(['"]pg['"]\)/);
  assert.doesNotMatch(filterSource, /\bPool\b/);
  assert.doesNotMatch(filterSource, /\.query\s*\(/);
});

test('B2-D: contract validation reuses the Engine 2 error vocabulary', () => {
  assert.throws(
    () => filterCandidates(null),
    (err) => err.name === 'CandidateSelectionError' && err.code === 'INVALID_INPUT'
  );
  assert.throws(
    () => filterCandidates({ candidates: null }),
    (err) => err.name === 'CandidateSelectionError' && err.code === 'MISSING_REQUIRED_FIELD'
  );
  assert.throws(
    () => filterCandidates({ candidates: { CPU: 'not-an-array' } }),
    (err) => err.name === 'CandidateSelectionError' && err.code === 'INVALID_FIELD_VALUE'
  );
  assert.throws(
    () => filterCandidates({ candidates: { NOT_A_ROLE: [] } }),
    (err) => err.name === 'CandidateSelectionError' && err.code === 'INVALID_FIELD_VALUE'
  );
  // A bucket holding a candidate of another role is a contract error.
  assert.throws(
    () => filterCandidates({
      candidates: { MOTHERBOARD: [makeCandidate('CPU', U(1))] },
    }),
    (err) => err.name === 'CandidateSelectionError' && err.code === 'INVALID_CANDIDATE'
  );
});