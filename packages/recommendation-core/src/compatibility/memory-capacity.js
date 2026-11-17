'use strict';

const { FINAL_STATUSES } = require('./statuses');
const { REASON_CODES } = require('./reason-codes');
const { createCompatibilityResult } = require('./result');

/**
 * Rule 9 (OG-12, E8 / Decision 45): total RAM capacity vs the motherboard's
 * `max_memory_capacity_gb`. A HARD rule - the board cannot address the kit.
 *
 *   module_count * capacity_per_module_gb <= max_memory_capacity_gb -> PASS
 *   module_count * capacity_per_module_gb >  max_memory_capacity_gb -> FAIL
 *                                                                 (RAM_CAPACITY_EXCEEDED)
 *   any operand NULL / non-finite                                   -> UNKNOWN
 *                                                                 (RAM_CAPACITY_UNKNOWN)
 *
 * WHY HARD, UNLIKE OG-09: a board's maximum addressable memory is a
 * specification of the memory controller, not a marketing rating. A 64 GB kit
 * on a board capped at 32 GB cannot be fully used, so it is a definitive
 * incompatibility and the candidate is REJECTed. Architecture section 6
 * prescribes exactly this REJECT; Decision 26 item B deferred it only because
 * no code read the columns.
 *
 * THREE OPERANDS, and the capacity is DERIVED (module_count *
 * capacity_per_module_gb) rather than stored: the schema carries no total
 * column and a derived arithmetic total is the GPU-dimension precedent
 * (`docs/RECIPES/add-a-pair-evaluator.md` step 5).
 *
 * A NULL IS NEVER A PASS: an unmeasured board limit, module count or module
 * capacity is UNKNOWN, never "unlimited". The rule this replaces in the
 * architecture was explicit that an unknown capacity must not be treated as a
 * pass, and the standing gate counts those pairs as "not-measured".
 *
 * The comparison is `<=`: a kit exactly at the board ceiling is valid, so the
 * boundary is inclusive.
 *
 * @param {object} input
 * @param {string|null} input.ram_product_id          For evidence only.
 * @param {string|null} input.motherboard_product_id  For evidence only.
 * @param {number|null} input.ram_module_count        ram_spec.module_count.
 * @param {number|null} input.ram_capacity_per_module_gb
 *                                                    ram_spec.capacity_per_module_gb.
 * @param {number|null} input.motherboard_max_memory_capacity_gb
 *                                                    motherboard_spec.max_memory_capacity_gb.
 */
function resolveRamMotherboardCapacity(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('resolveRamMotherboardCapacity expects an input object');
  }

  const { ram_product_id = null, motherboard_product_id = null } = input;
  const moduleCount = input.ram_module_count ?? null;
  const capacityPerModule = input.ram_capacity_per_module_gb ?? null;
  const boardMax = input.motherboard_max_memory_capacity_gb ?? null;

  const baseEvidence = {
    rule: 'ram_motherboard_capacity',
    ram_product_id,
    motherboard_product_id,
  };

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  if (!isNum(moduleCount) || !isNum(capacityPerModule) || !isNum(boardMax)) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.RAM_CAPACITY_UNKNOWN,
      evidence: [
        {
          ...baseEvidence,
          ram_module_count: moduleCount,
          ram_capacity_per_module_gb: capacityPerModule,
          motherboard_max_memory_capacity_gb: boardMax,
        },
      ],
    });
  }

  const kitTotalGb = moduleCount * capacityPerModule;

  if (kitTotalGb <= boardMax) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.PASS,
      evidence: [
        {
          ...baseEvidence,
          kit_total_gb: kitTotalGb,
          motherboard_max_memory_capacity_gb: boardMax,
          headroom_gb: boardMax - kitTotalGb,
        },
      ],
    });
  }

  return createCompatibilityResult({
    status: FINAL_STATUSES.FAIL,
    reason: REASON_CODES.RAM_CAPACITY_EXCEEDED,
    evidence: [
      {
        ...baseEvidence,
        kit_total_gb: kitTotalGb,
        motherboard_max_memory_capacity_gb: boardMax,
        over_by_gb: kitTotalGb - boardMax,
      },
    ],
  });
}

module.exports = { resolveRamMotherboardCapacity };
