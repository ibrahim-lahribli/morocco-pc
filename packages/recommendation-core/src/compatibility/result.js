const { FINAL_STATUSES } = require('./statuses');
const { REASON_CODES } = require('./reason-codes');

/**
 * Normalize one structured evidence item.
 *
 * Evidence is structured data (not a human-readable string) so downstream
 * engines (scoring, explanation, persistence) can consume it
 * programmatically. Kept deliberately simple:
 *
 *   rule          (required) which compatibility rule was evaluated
 *   source_table             which source record/table was used
 *   source_id                id of the source record (product / family /
 *                            row id...)
 *   source_status            PASS | FAIL | UNKNOWN | CONDITIONAL status of
 *                            the source row, when applicable
 *   ...extra fields          relevant ids, numeric values (e.g. lengths,
 *                            wattages), and conditions (e.g.
 *                            min_bios_version) are copied as-is
 *
 * Human-readable summaries are NOT generated here.
 */
function normalizeEvidenceItem(item) {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new TypeError('Evidence item must be an object');
  }
  if (typeof item.rule !== 'string' || item.rule.length === 0) {
    throw new TypeError('Evidence item must have a non-empty string "rule"');
  }

  const normalized = { rule: item.rule };

  for (const key of Object.keys(item)) {
    if (key === 'rule') continue;
    const value = item[key];
    if (value !== undefined) {
      normalized[key] = value;
    }
  }

  return Object.freeze(normalized);
}

/**
 * Build a structured compatibility result.
 *
 * Framework-free and side-effect-free: it performs no database access and
 * only validates/normalizes its inputs.
 *
 * @param {object} input
 * @param {string} input.status    Final status: PASS | FAIL | UNKNOWN.
 *                                 CONDITIONAL is not accepted as a final
 *                                 status (resolve it to UNKNOWN first and
 *                                 keep the condition in the evidence).
 * @param {string|null} input.reason  A REASON_CODES value; null (or omitted)
 *                                 is allowed for PASS results.
 * @param {Array<object>} [input.evidence]  Structured evidence items.
 * @param {number|null} [input.penalty]     Left null: the numeric UNKNOWN
 *                                 penalty is defined later by the scoring
 *                                 model (Engine 4), not here.
 */
function createCompatibilityResult(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('Compatibility result input must be an object');
  }

  const { status, reason = null, evidence = [], penalty = null } = input;

  if (!Object.values(FINAL_STATUSES).includes(status)) {
    throw new TypeError(
      `Invalid result status "${status}". Allowed final statuses: ` +
        `${Object.values(FINAL_STATUSES).join(', ')}. ` +
        'CONDITIONAL is a source status only and must be resolved to ' +
        'UNKNOWN with the condition preserved in the evidence.'
    );
  }

  if (reason !== null && !Object.values(REASON_CODES).includes(reason)) {
    throw new TypeError(
      `Invalid reason code "${reason}". ` +
        'It must be one of REASON_CODES or null.'
    );
  }

  if (!Array.isArray(evidence)) {
    throw new TypeError('Evidence must be an array');
  }

  if (penalty !== null) {
    throw new TypeError(
      'Penalty must be null: the numeric UNKNOWN penalty is defined by the ' +
        'scoring model (Engine 4), not by the compatibility resolver.'
    );
  }

  const normalizedEvidence = evidence.map(normalizeEvidenceItem);

  return Object.freeze({
    status,
    reason,
    evidence: Object.freeze(normalizedEvidence),
    penalty,
  });
}

module.exports = { createCompatibilityResult, normalizeEvidenceItem };
