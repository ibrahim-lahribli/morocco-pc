const { FINAL_STATUSES, SOURCE_STATUSES } = require('./statuses');
const { REASON_CODES } = require('./reason-codes');
const { createCompatibilityResult } = require('./result');

/**
 * Copy the relevant source-record fields into a structured evidence item.
 *
 * @param {string} rule  Rule identifier for the evidence.
 * @param {object} record  Loaded compatibility / spec row (plain object).
 * @param {Array<string>} extraFields  Additional record fields to preserve.
 */
function buildEvidence(rule, record, extraFields = []) {
  const evidence = {
    rule,
    source_table: record.source_table,
    source_id: record.source_id,
    source_status: record.support_status,
  };
  for (const field of extraFields) {
    if (record[field] !== undefined) {
      evidence[field] = record[field];
    }
  }
  return evidence;
}

/**
 * Map a loaded cpu_motherboard_support row to a resolver result.
 *
 *   PASS        -> PASS
 *   FAIL        -> FAIL (CPU_MOTHERBOARD_SUPPORT_FAIL)
 *   CONDITIONAL -> UNKNOWN (CPU_MOTHERBOARD_CONDITIONAL_UNVERIFIABLE);
 *                  the condition (e.g. min_bios_version) and the original
 *                  CONDITIONAL source status stay in the evidence (the
 *                  schema stores no current BIOS version, so the condition
 *                  is not verifiable today - Decision 3b).
 *   UNKNOWN     -> UNKNOWN (CPU_MOTHERBOARD_SUPPORT_UNKNOWN)
 */
function supportRecordToResult(record, rule, extraFields = []) {
  const evidenceItem = buildEvidence(rule, record, extraFields);

  switch (record.support_status) {
    case SOURCE_STATUSES.PASS:
      return createCompatibilityResult({
        status: FINAL_STATUSES.PASS,
        reason: null,
        evidence: [evidenceItem],
      });
    case SOURCE_STATUSES.FAIL:
      return createCompatibilityResult({
        status: FINAL_STATUSES.FAIL,
        reason: REASON_CODES.CPU_MOTHERBOARD_SUPPORT_FAIL,
        evidence: [evidenceItem],
      });
    case SOURCE_STATUSES.CONDITIONAL:
      return createCompatibilityResult({
        status: FINAL_STATUSES.UNKNOWN,
        reason: REASON_CODES.CPU_MOTHERBOARD_CONDITIONAL_UNVERIFIABLE,
        evidence: [evidenceItem],
      });
    case SOURCE_STATUSES.UNKNOWN:
    default:
      return createCompatibilityResult({
        status: FINAL_STATUSES.UNKNOWN,
        reason: REASON_CODES.CPU_MOTHERBOARD_SUPPORT_UNKNOWN,
        evidence: [evidenceItem],
      });
  }
}

/**
 * Rule 1: CPU socket vs motherboard socket.
 *
 * Inputs are the already-loaded socket identifiers (cpu_spec.socket_id vs
 * motherboard_spec.socket_id). Pure; performs no database access.
 *
 *   matching known sockets      -> PASS
 *   different known sockets     -> FAIL (CPU_SOCKET_MISMATCH)
 *   either socket value missing -> UNKNOWN (CPU_SOCKET_UNKNOWN);
 *                                  NULL is never treated as compatible.
 *
 * @param {object} input
 * @param {string|null} input.cpu_socket_id
 * @param {string|null} input.motherboard_socket_id
 */
function resolveCpuMotherboardSocket(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('resolveCpuMotherboardSocket expects an input object');
  }

  const { cpu_socket_id, motherboard_socket_id } = input;
  const evidenceItem = {
    rule: 'cpu_motherboard_socket',
    cpu_socket_id: cpu_socket_id ?? null,
    motherboard_socket_id: motherboard_socket_id ?? null,
  };

  if (cpu_socket_id == null || motherboard_socket_id == null) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.CPU_SOCKET_UNKNOWN,
      evidence: [evidenceItem],
    });
  }

  if (cpu_socket_id === motherboard_socket_id) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.PASS,
      evidence: [evidenceItem],
    });
  }

  return createCompatibilityResult({
    status: FINAL_STATUSES.FAIL,
    reason: REASON_CODES.CPU_SOCKET_MISMATCH,
    evidence: [evidenceItem],
  });
}

/**
 * Rule 2: CPU <-> motherboard support resolution.
 *
 * Inputs are the ALREADY-LOADED cpu_motherboard_support rows for the
 * (motherboard, CPU) pair - the resolver never queries PostgreSQL.
 *
 * Approved precedence: exact CPU SKU > CPU family > UNKNOWN. If an exact
 * SKU record exists, its verdict ALWAYS decides and the family record is
 * never consulted (exact FAIL + family PASS -> FAIL; exact PASS + family
 * FAIL -> PASS; exact CONDITIONAL + family PASS -> UNKNOWN).
 *
 * @param {object} input
 * @param {object|null} input.exact_record  Row with cpu_product_id set, or null.
 * @param {object|null} input.family_record Row with cpu_product_family_id set, or null.
 */
function resolveCpuMotherboardSupport(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('resolveCpuMotherboardSupport expects an input object');
  }

  const { exact_record = null, family_record = null } = input;

  if (exact_record) {
    return supportRecordToResult(exact_record, 'cpu_motherboard_support_exact', [
      'motherboard_product_id',
      'cpu_product_id',
      'min_bios_version',
    ]);
  }

  if (family_record) {
    return supportRecordToResult(family_record, 'cpu_motherboard_support_family', [
      'motherboard_product_id',
      'cpu_product_family_id',
      'min_bios_version',
    ]);
  }

  return createCompatibilityResult({
    status: FINAL_STATUSES.UNKNOWN,
    reason: REASON_CODES.CPU_MOTHERBOARD_SUPPORT_UNKNOWN,
    evidence: [
      {
        rule: 'cpu_motherboard_support',
        source_status: null,
      },
    ],
  });
}

module.exports = {
  resolveCpuMotherboardSocket,
  resolveCpuMotherboardSupport,
};
