/**
 * Final compatibility statuses.
 *
 * PASS / FAIL / UNKNOWN are the ONLY statuses a resolver result may carry.
 * CONDITIONAL is deliberately NOT a final status: per
 * docs/RECOMMENDATION_ENGINE_DECISIONS.md (Decision 3b), a CONDITIONAL
 * source row that cannot be verified resolves to UNKNOWN while the original
 * condition (e.g. min_bios_version) is preserved in the evidence.
 */
const FINAL_STATUSES = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNKNOWN: 'UNKNOWN',
});

/**
 * Statuses that may appear on SOURCE compatibility rows (e.g. the
 * `support_status` column of `cpu_motherboard_support` /
 * `cooler_socket_support`) and inside structured evidence.
 */
const SOURCE_STATUSES = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNKNOWN: 'UNKNOWN',
  CONDITIONAL: 'CONDITIONAL',
});

module.exports = { FINAL_STATUSES, SOURCE_STATUSES };
