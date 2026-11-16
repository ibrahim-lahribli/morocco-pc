'use strict';

const { FINAL_STATUSES } = require('./statuses');
const { REASON_CODES } = require('./reason-codes');
const { createCompatibilityResult } = require('./result');

/**
 * Rule 7 (OG-09, E8 / Decision 45): cooler `max_tdp_watts` vs CPU `tdp_watts`.
 *
 *   cooler_max_tdp_watts >= cpu_tdp_watts   -> PASS
 *   cooler_max_tdp_watts <  cpu_tdp_watts   -> UNKNOWN (COOLER_TDP_INSUFFICIENT)
 *   either value NULL / non-finite          -> UNKNOWN (COOLER_TDP_UNKNOWN)
 *
 * WHY THIS RULE IS SOFT (UNKNOWN, never FAIL), unlike OG-11/OG-12:
 * vendor "TDP" ratings are marketing figures, not a measurement. A 65 W-rated
 * box cooler on a 125 W part is a real thermal risk, but a cooler's published
 * `max_tdp_watts` and a CPU's published `tdp_watts` are produced by different
 * vendors under different assumptions, so an apparent shortfall is not a
 * hardware incompatibility the way an over-slot RAM kit is. The build is
 * therefore NOT rejected; the shortfall is surfaced as UNKNOWN so it stays
 * visible in the "N checked rules" copy instead of being presented as a pass.
 *
 * WHY UNKNOWN AND NOT CONDITIONAL: `./statuses.js` (Decision 3b) makes
 * CONDITIONAL a SOURCE status only - a resolver result may carry PASS, FAIL or
 * UNKNOWN, and a CONDITIONAL source row is resolved to UNKNOWN with the
 * condition preserved in evidence. This resolver follows that contract instead
 * of widening the final-status vocabulary for one rule.
 *
 * A NULL IS NEVER A PASS: `max_tdp_watts` is genuinely NULL for one catalog
 * cooler (the Corsair Nautilus 240 RS ARGB, seed 009) because no vendor figure
 * is published. That is UNKNOWN, not "no limit".
 *
 * The comparison is `>=`, not `>`: a cooler rated exactly at the CPU's TDP is
 * adequate, so the boundary is inclusive.
 *
 * @param {object} input
 * @param {string|null} input.cooler_product_id  For evidence only.
 * @param {string|null} input.cpu_product_id     For evidence only.
 * @param {number|null} input.cooler_max_tdp_watts  cooler_spec.max_tdp_watts.
 * @param {number|null} input.cpu_tdp_watts         cpu_spec.tdp_watts.
 */
function resolveCoolerCpuTdp(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('resolveCoolerCpuTdp expects an input object');
  }

  const { cooler_product_id = null, cpu_product_id = null } = input;
  const coolerTdp = input.cooler_max_tdp_watts ?? null;
  const cpuTdp = input.cpu_tdp_watts ?? null;

  const baseEvidence = {
    rule: 'cooler_tdp',
    cooler_product_id,
    cpu_product_id,
  };

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  if (!isNum(coolerTdp) || !isNum(cpuTdp)) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.COOLER_TDP_UNKNOWN,
      evidence: [
        {
          ...baseEvidence,
          cooler_max_tdp_watts: coolerTdp,
          cpu_tdp_watts: cpuTdp,
        },
      ],
    });
  }

  if (coolerTdp >= cpuTdp) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.PASS,
      evidence: [
        {
          ...baseEvidence,
          cooler_max_tdp_watts: coolerTdp,
          cpu_tdp_watts: cpuTdp,
          headroom_watts: coolerTdp - cpuTdp,
        },
      ],
    });
  }

  // SOFT: over-asked cooler, but never a REJECT (see the header).
  return createCompatibilityResult({
    status: FINAL_STATUSES.UNKNOWN,
    reason: REASON_CODES.COOLER_TDP_INSUFFICIENT,
    evidence: [
      {
        ...baseEvidence,
        cooler_max_tdp_watts: coolerTdp,
        cpu_tdp_watts: cpuTdp,
        over_by_watts: cpuTdp - coolerTdp,
      },
    ],
  });
}

module.exports = { resolveCoolerCpuTdp };
