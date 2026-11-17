const { FINAL_STATUSES, SOURCE_STATUSES } = require('./statuses');
const { REASON_CODES } = require('./reason-codes');
const { createCompatibilityResult } = require('./result');

/**
 * Rule 3: cooler <-> CPU socket.
 *
 * Inputs are the ALREADY-LOADED cooler_socket_support rows for the cooler
 * product - the resolver never queries PostgreSQL and never invents a
 * compatibility verdict when no row exists.
 *
 * The row whose socket_id matches the CPU socket decides:
 *
 *   row PASS          -> PASS
 *   row FAIL          -> FAIL (COOLER_SOCKET_MISMATCH)
 *   row UNKNOWN       -> UNKNOWN (COOLER_SOCKET_SUPPORT_UNKNOWN)
 *   row CONDITIONAL   -> UNKNOWN (COOLER_SOCKET_SUPPORT_UNKNOWN); the
 *                        original CONDITIONAL status stays in the evidence
 *   no matching row   -> UNKNOWN (COOLER_SOCKET_SUPPORT_UNKNOWN)
 *   no CPU socket id  -> UNKNOWN (COOLER_SOCKET_SUPPORT_UNKNOWN)
 *
 * @param {object} input
 * @param {string|null} input.cooler_product_id  For evidence only.
 * @param {string|null} input.cpu_socket_id     Socket being matched against.
 * @param {Array<object>} input.support_records Loaded rows for this cooler.
 */
function resolveCoolerSocketSupport(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('resolveCoolerSocketSupport expects an input object');
  }

  const { cooler_product_id = null, cpu_socket_id, support_records = [] } = input;

  const baseEvidence = {
    rule: 'cooler_socket_support',
    cooler_product_id,
    cpu_socket_id: cpu_socket_id ?? null,
  };

  if (cpu_socket_id == null) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.COOLER_SOCKET_SUPPORT_UNKNOWN,
      evidence: [{ ...baseEvidence, source_status: null }],
    });
  }

  if (!Array.isArray(support_records)) {
    throw new TypeError('support_records must be an array');
  }

  const matching = support_records.find(
    (record) => record != null && record.socket_id === cpu_socket_id
  );

  if (!matching) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.COOLER_SOCKET_SUPPORT_UNKNOWN,
      evidence: [{ ...baseEvidence, source_status: null }],
    });
  }

  const evidenceItem = {
    ...baseEvidence,
    source_id: matching.source_id,
    source_status: matching.support_status,
  };

  switch (matching.support_status) {
    case SOURCE_STATUSES.PASS:
      return createCompatibilityResult({
        status: FINAL_STATUSES.PASS,
        evidence: [evidenceItem],
      });
    case SOURCE_STATUSES.FAIL:
      return createCompatibilityResult({
        status: FINAL_STATUSES.FAIL,
        reason: REASON_CODES.COOLER_SOCKET_MISMATCH,
        evidence: [evidenceItem],
      });
    case SOURCE_STATUSES.CONDITIONAL:
    case SOURCE_STATUSES.UNKNOWN:
    default:
      return createCompatibilityResult({
        status: FINAL_STATUSES.UNKNOWN,
        reason: REASON_CODES.COOLER_SOCKET_SUPPORT_UNKNOWN,
        evidence: [evidenceItem],
      });
  }
}

module.exports = { resolveCoolerSocketSupport };
