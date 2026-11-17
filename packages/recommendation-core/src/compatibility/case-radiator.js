const { FINAL_STATUSES, SOURCE_STATUSES } = require('./statuses');
const { REASON_CODES } = require('./reason-codes');
const { createCompatibilityResult } = require('./result');

/**
 * Map a loaded (presence-only) relationship row to a resolver result.
 *
 * These tables have no status column today, so a present row with no
 * explicit `support_status` means PASS (presence = supported). An explicit
 * status, when carried on the loaded row, is honored:
 *
 *   PASS        -> PASS
 *   FAIL        -> FAIL (failReason)
 *   CONDITIONAL -> UNKNOWN (unknownReason); source_status CONDITIONAL and
 *                  the row itself stay in the evidence
 *   UNKNOWN     -> UNKNOWN (unknownReason)
 */
function presenceRowToResult(row, rule, failReason, unknownReason, baseEvidence) {
  const evidenceItem = {
    ...baseEvidence,
    source_id: row.source_id,
    source_status: row.support_status ?? SOURCE_STATUSES.PASS,
  };

  switch (row.support_status ?? SOURCE_STATUSES.PASS) {
    case SOURCE_STATUSES.PASS:
      return createCompatibilityResult({
        status: FINAL_STATUSES.PASS,
        evidence: [evidenceItem],
      });
    case SOURCE_STATUSES.FAIL:
      return createCompatibilityResult({
        status: FINAL_STATUSES.FAIL,
        reason: failReason,
        evidence: [evidenceItem],
      });
    case SOURCE_STATUSES.CONDITIONAL:
    case SOURCE_STATUSES.UNKNOWN:
    default:
      return createCompatibilityResult({
        status: FINAL_STATUSES.UNKNOWN,
        reason: unknownReason,
        evidence: [evidenceItem],
      });
  }
}

/**
 * Rule 4: motherboard <-> case form factor.
 *
 * Uses the already-loaded case_motherboard_form_factor rows for the case.
 * Presence-only: compatibility is NEVER inferred from ATX/mATX/ITX naming
 * or from physical dimensions.
 *
 *   matching row present            -> PASS
 *   matching row FAIL               -> FAIL (CASE_FORM_FACTOR_MISMATCH)
 *   matching row UNKNOWN/CONDITIONAL-> UNKNOWN (CASE_FORM_FACTOR_UNKNOWN);
 *                                      CONDITIONAL stays in the evidence
 *   no matching row                 -> UNKNOWN (CASE_FORM_FACTOR_UNKNOWN)
 *   missing form factor             -> UNKNOWN (CASE_FORM_FACTOR_UNKNOWN)
 *
 * @param {object} input
 * @param {string|null} input.case_product_id
 * @param {string|null} input.motherboard_form_factor
 * @param {Array<object>} input.form_factor_records Loaded rows for this case.
 */
function resolveCaseMotherboardFormFactor(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError(
      'resolveCaseMotherboardFormFactor expects an input object'
    );
  }

  const {
    case_product_id = null,
    motherboard_form_factor,
    form_factor_records = [],
  } = input;

  const baseEvidence = {
    rule: 'case_motherboard_form_factor',
    case_product_id,
    motherboard_form_factor: motherboard_form_factor ?? null,
  };

  if (motherboard_form_factor == null) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.CASE_FORM_FACTOR_UNKNOWN,
      evidence: [{ ...baseEvidence, source_status: null }],
    });
  }

  if (!Array.isArray(form_factor_records)) {
    throw new TypeError('form_factor_records must be an array');
  }

  const matching = form_factor_records.find(
    (row) =>
      row != null &&
      (row.form_factor === motherboard_form_factor ||
        row.motherboard_form_factor === motherboard_form_factor)
  );

  if (!matching) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.CASE_FORM_FACTOR_UNKNOWN,
      evidence: [{ ...baseEvidence, source_status: null }],
    });
  }

  return presenceRowToResult(
    matching,
    'case_motherboard_form_factor',
    REASON_CODES.CASE_FORM_FACTOR_MISMATCH,
    REASON_CODES.CASE_FORM_FACTOR_UNKNOWN,
    baseEvidence
  );
}

/**
 * Rule 5: case <-> radiator.
 *
 * Uses the already-loaded case_radiator_support rows for the case.
 * Presence-only. The approved special rule (architecture decision 1):
 *
 *   liquid cooler (requires radiator) + ZERO radiator rows ->
 *     FAIL RADIATOR_UNSUPPORTED
 *
 * Rationale: a rejected combo is not a rejected build (air coolers can
 * always be substituted), so the false-negative cost is near zero while
 * the safety gain is real. The special rule applies ONLY to liquid
 * coolers that require a radiator - never to air coolers.
 *
 *   liquid + zero rows        -> FAIL RADIATOR_UNSUPPORTED
 *   liquid + matching row     -> PASS
 *   liquid + rows, no match   -> UNKNOWN RADIATOR_SUPPORT_UNKNOWN
 *                                (support is never invented)
 *   air cooler                -> PASS (radiator rule not applicable)
 *   cooler type unknown       -> UNKNOWN RADIATOR_SUPPORT_UNKNOWN
 *                                (zero-row condition not established)
 *   row UNKNOWN / CONDITIONAL -> UNKNOWN (CONDITIONAL preserved)
 *
 * @param {object} input
 * @param {string|null} input.case_product_id
 * @param {boolean|null} input.cooler_requires_radiator  true = liquid cooler.
 * @param {number|null} input.radiator_size_mm  Required radiator size.
 * @param {string|null} [input.radiator_position] Optional position constraint.
 * @param {Array<object>} input.radiator_records Loaded rows for this case.
 */
function resolveCaseRadiator(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('resolveCaseRadiator expects an input object');
  }

  const {
    case_product_id = null,
    cooler_requires_radiator,
    radiator_size_mm = null,
    radiator_position = null,
    radiator_records = [],
  } = input;

  const baseEvidence = {
    rule: 'case_radiator_support',
    case_product_id,
    cooler_requires_radiator: cooler_requires_radiator ?? null,
    radiator_size_mm,
    radiator_position,
  };

  if (!Array.isArray(radiator_records)) {
    throw new TypeError('radiator_records must be an array');
  }

  // Cooler type unknown: the zero-row condition cannot be established.
  if (cooler_requires_radiator == null) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.RADIATOR_SUPPORT_UNKNOWN,
      evidence: [{ ...baseEvidence, source_status: null }],
    });
  }

  // Air cooler: a radiator is not required; the rule does not apply.
  if (cooler_requires_radiator === false) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.PASS,
      evidence: [{ ...baseEvidence, source_status: null, not_applicable: true }],
    });
  }

  // Liquid cooler + zero radiator-support rows: explicit rejection.
  if (radiator_records.length === 0) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.FAIL,
      reason: REASON_CODES.RADIATOR_UNSUPPORTED,
      evidence: [{ ...baseEvidence, source_status: null, row_count: 0 }],
    });
  }

  const matching = radiator_records.find(
    (row) =>
      row != null &&
      row.radiator_size_mm === radiator_size_mm &&
      (radiator_position == null || row.position === radiator_position)
  );

  if (!matching) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.RADIATOR_SUPPORT_UNKNOWN,
      evidence: [{
        ...baseEvidence,
        source_status: null,
        row_count: radiator_records.length,
      }],
    });
  }

  return presenceRowToResult(
    matching,
    'case_radiator_support',
    REASON_CODES.RADIATOR_UNSUPPORTED,
    REASON_CODES.RADIATOR_SUPPORT_UNKNOWN,
    baseEvidence
  );
}

module.exports = {
  resolveCaseMotherboardFormFactor,
  resolveCaseRadiator,
};
