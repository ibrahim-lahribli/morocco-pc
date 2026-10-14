'use strict';

const { FINAL_STATUSES } = require('./statuses');
const { REASON_CODES } = require('./reason-codes');
const { createCompatibilityResult } = require('./result');

/**
 * Rule 8 (OG-11, E8 / Decision 45): RAM `module_count` vs motherboard
 * `dimm_slots`. A HARD, PHYSICAL rule - the kit cannot be installed.
 *
 *   module_count <= dimm_slots   -> PASS
 *   module_count >  dimm_slots   -> FAIL (RAM_SLOTS_EXCEEDED)
 *   either value NULL/non-finite -> UNKNOWN (RAM_SLOTS_UNKNOWN)
 *
 * WHY HARD, UNLIKE OG-09: this is not a rating or an estimate. A 4-module kit
 * physically does not fit a 2-slot board, so the shortfall is a definitive
 * incompatibility and the candidate is REJECTed. Architecture section 6
 * prescribes exactly this REJECT; it was DEFERRED by Decision 26 item B only
 * because no code read the columns (silent drift until 2026-09-28).
 *
 * A NULL IS NEVER A PASS: an unmeasured slot count or module count is UNKNOWN,
 * never "unlimited". The standing gate treats a NULL operand the same way
 * (`scripts/check-deferred-rules.js` "not-measured").
 *
 * The comparison is `<=`: a kit filling every slot exactly is valid, so the
 * boundary is inclusive.
 *
 * @param {object} input
 * @param {string|null} input.ram_product_id          For evidence only.
 * @param {string|null} input.motherboard_product_id  For evidence only.
 * @param {number|null} input.ram_module_count        ram_spec.module_count.
 * @param {number|null} input.motherboard_dimm_slots  motherboard_spec.dimm_slots.
 */
function resolveRamMotherboardSlots(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('resolveRamMotherboardSlots expects an input object');
  }

  const { ram_product_id = null, motherboard_product_id = null } = input;
  const moduleCount = input.ram_module_count ?? null;
  const dimmSlots = input.motherboard_dimm_slots ?? null;

  const baseEvidence = {
    rule: 'ram_motherboard_slots',
    ram_product_id,
    motherboard_product_id,
  };

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  if (!isNum(moduleCount) || !isNum(dimmSlots)) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.RAM_SLOTS_UNKNOWN,
      evidence: [
        {
          ...baseEvidence,
          ram_module_count: moduleCount,
          motherboard_dimm_slots: dimmSlots,
        },
      ],
    });
  }

  if (moduleCount <= dimmSlots) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.PASS,
      evidence: [
        {
          ...baseEvidence,
          ram_module_count: moduleCount,
          motherboard_dimm_slots: dimmSlots,
          spare_slots: dimmSlots - moduleCount,
        },
      ],
    });
  }

  return createCompatibilityResult({
    status: FINAL_STATUSES.FAIL,
    reason: REASON_CODES.RAM_SLOTS_EXCEEDED,
    evidence: [
      {
        ...baseEvidence,
        ram_module_count: moduleCount,
        motherboard_dimm_slots: dimmSlots,
        over_by_slots: moduleCount - dimmSlots,
      },
    ],
  });
}

module.exports = { resolveRamMotherboardSlots };
