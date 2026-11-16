'use strict';

const { FINAL_STATUSES } = require('./statuses');
const { REASON_CODES } = require('./reason-codes');
const { createCompatibilityResult } = require('./result');

/**
 * Rule 6 (OG-10, Decision 26 un-deferral): AIR cooler height vs the case's
 * CPU-cooler clearance.
 *
 *   height <= clearance              -> PASS
 *   height >  clearance              -> FAIL (COOLER_TOO_TALL)
 *   either value NULL / non-finite   -> UNKNOWN (COOLER_HEIGHT_UNKNOWN)
 *
 * WHY A NULL IS NEVER A PASS: an unmeasured cooler is not an unlimited one.
 * Treating a missing height as "fits" would emit builds that physically do
 * not close, which is the same class of defect OG-34 hid (a 155 mm
 * placeholder on a 158 mm tower would have produced exactly that).
 *
 * SCOPE - AIR COOLERS ONLY, deliberately. Two reasons, and the second is the
 * binding one:
 *   1. It is the scope the standing gate reports
 *      (scripts/check-deferred-rules.js, "[AIR cooler x case]"), so the
 *      implemented rule and the measured gate describe the same pair set.
 *   2. cooler_spec.height_mm means DIFFERENT PHYSICAL THINGS by cooling type.
 *      For an AIR cooler it is the tower's height, the dimension that decides
 *      side-panel clearance. For a LIQUID cooler it is the PUMP BLOCK height
 *      (seed 009), and the dimension that decides whether the block clears the
 *      panel is not the same physical constraint as a tower's. Sharing one
 *      reason code across both would conflate them.
 * A non-AIR cooler is therefore NOT_APPLICABLE: the pair is out of scope, not
 * unknown, and the candidate keeps whatever verdict its other rules give.
 *
 * The comparison is `<=`, not `<`: a cooler exactly as tall as the published
 * clearance fits, and the clearance figure is itself a maximum, not a
 * recommendation with margin.
 *
 * @param {object} input
 * @param {string|null} input.cooler_product_id  For evidence only.
 * @param {string|null} input.case_product_id    For evidence only.
 * @param {string|null} input.cooling_type       cooler_spec.cooling_type; only 'AIR' is in scope.
 * @param {number|null} input.cooler_height_mm   cooler_spec.height_mm.
 * @param {number|null} input.case_max_cpu_cooler_height_mm  case_spec.max_cpu_cooler_height_mm.
 */
function resolveCoolerCaseHeight(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('resolveCoolerCaseHeight expects an input object');
  }

  const {
    cooler_product_id = null,
    case_product_id = null,
    cooling_type = null,
  } = input;
  const height = input.cooler_height_mm ?? null;
  const clearance = input.case_max_cpu_cooler_height_mm ?? null;

  const baseEvidence = {
    rule: 'cooler_case_height',
    cooler_product_id,
    case_product_id,
  };

  // Out of scope, not unknown - but ONLY when the type is positively known to
  // be something other than AIR. A NULL/unrecognised cooling_type means the
  // cooler could not be classified, and an unclassifiable cooler must not be
  // waved through: it falls through to the numeric check below, which reports
  // UNKNOWN unless a height happens to be present. Silently treating an
  // unknown type as "not AIR" would be a hole exactly of the kind OG-34 was.
  if (cooling_type !== null && cooling_type !== 'AIR') {
    return createCompatibilityResult({
      status: FINAL_STATUSES.PASS,
      evidence: [
        {
          ...baseEvidence,
          scope: 'not_applicable',
          cooling_type,
        },
      ],
    });
  }

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  if (!isNum(height) || !isNum(clearance)) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.COOLER_HEIGHT_UNKNOWN,
      evidence: [
        {
          ...baseEvidence,
          scope: 'air',
          source_status: null,
          cooler_height_mm: height,
          case_max_cpu_cooler_height_mm: clearance,
        },
      ],
    });
  }

  if (height <= clearance) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.PASS,
      evidence: [
        {
          ...baseEvidence,
          scope: 'air',
          cooler_height_mm: height,
          case_max_cpu_cooler_height_mm: clearance,
          headroom_mm: clearance - height,
        },
      ],
    });
  }

  return createCompatibilityResult({
    status: FINAL_STATUSES.FAIL,
    reason: REASON_CODES.COOLER_TOO_TALL,
    evidence: [
      {
        ...baseEvidence,
        scope: 'air',
        cooler_height_mm: height,
        case_max_cpu_cooler_height_mm: clearance,
        over_by_mm: height - clearance,
      },
    ],
  });
}

module.exports = { resolveCoolerCaseHeight };