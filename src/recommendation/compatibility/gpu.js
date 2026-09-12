const { FINAL_STATUSES } = require('./statuses');
const { REASON_CODES } = require('./reason-codes');
const { createCompatibilityResult } = require('./result');

/**
 * Connector names expressible by the psu_spec columns
 * (connector_24pin_atx, connector_eps_count, connector_pcie_8pin,
 * connector_12vhpwr, connector_sata). The data layer normalizes those
 * columns into a counts object with these keys; the GPU JSONB blob uses
 * the same vocabulary. Any other connector name is not verifiable and
 * resolves to UNKNOWN - compatibility is never invented.
 */
const KNOWN_CONNECTORS = new Set([
  '24pin_atx',
  'eps',
  'pcie_8pin',
  '12vhpwr',
  'sata',
]);

/**
 * Shared pure numeric-comparison helper.
 *
 *   both values finite numbers: required <= limit -> PASS, else FAIL
 *   either value missing / not a number        -> UNKNOWN (NULL is never
 *                                                 treated as unlimited)
 *
 * Boundary equality (required === limit) is PASS.
 */
function numericLimitResult({ required, limit, passReason, failReason, unknownReason, evidence }) {
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  if (!isNum(required) || !isNum(limit)) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: unknownReason,
      evidence: [{
        ...evidence,
        source_status: null,
        gpu_value: required ?? null,
        limit_value: limit ?? null,
      }],
    });
  }

  if (required <= limit) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.PASS,
      reason: passReason,
      evidence: [{ ...evidence, gpu_value: required, limit_value: limit }],
    });
  }

  return createCompatibilityResult({
    status: FINAL_STATUSES.FAIL,
    reason: failReason,
    evidence: [{ ...evidence, gpu_value: required, limit_value: limit }],
  });
}

/**
 * Rule 8: GPU board length vs case max GPU length.
 *
 *   gpu_length_mm <= max_gpu_length_mm -> PASS
 *   gpu_length_mm >  max_gpu_length_mm -> FAIL (GPU_TOO_LONG)
 *   either value missing               -> UNKNOWN (GPU_DIMENSIONS_UNKNOWN)
 *
 * @param {object} input
 * @param {string|null} input.gpu_product_variant_id
 * @param {string|null} input.case_product_id
 * @param {number|null} input.gpu_length_mm       gpu_board_spec.length_mm
 * @param {number|null} input.case_max_gpu_length_mm  case_spec.max_gpu_length_mm
 */
function resolveGpuCaseLength(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('resolveGpuCaseLength expects an input object');
  }
  const { gpu_product_variant_id = null, case_product_id = null } = input;

  return numericLimitResult({
    required: input.gpu_length_mm,
    limit: input.case_max_gpu_length_mm,
    failReason: REASON_CODES.GPU_TOO_LONG,
    unknownReason: REASON_CODES.GPU_DIMENSIONS_UNKNOWN,
    evidence: {
      rule: 'gpu_case_length',
      gpu_product_variant_id,
      case_product_id,
    },
  });
}

/**
 * Rule 9: GPU board thickness vs case max GPU thickness (slots).
 *
 *   width_slots <= max_thickness_slots -> PASS
 *   width_slots >  max_thickness_slots -> FAIL (GPU_TOO_THICK)
 *   either value missing               -> UNKNOWN (GPU_DIMENSIONS_UNKNOWN)
 *
 * Thickness is NEVER inferred from GPU model names - only stored numerics.
 *
 * @param {object} input
 * @param {string|null} input.gpu_product_variant_id
 * @param {string|null} input.case_product_id
 * @param {number|null} input.gpu_width_slots   gpu_board_spec.width_slots
 * @param {number|null} input.case_max_gpu_thickness_slots
 */
function resolveGpuCaseThickness(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('resolveGpuCaseThickness expects an input object');
  }
  const { gpu_product_variant_id = null, case_product_id = null } = input;

  return numericLimitResult({
    required: input.gpu_width_slots,
    limit: input.case_max_gpu_thickness_slots,
    failReason: REASON_CODES.GPU_TOO_THICK,
    unknownReason: REASON_CODES.GPU_DIMENSIONS_UNKNOWN,
    evidence: {
      rule: 'gpu_case_thickness',
      gpu_product_variant_id,
      case_product_id,
    },
  });
}

/**
 * Rule 10: GPU recommended PSU wattage vs PSU rated wattage.
 *
 *   recommended <= rated -> PASS
 *   recommended >  rated -> FAIL (GPU_PSU_WATTAGE_INSUFFICIENT)
 *   either value missing -> UNKNOWN (GPU_PSU_WATTAGE_UNKNOWN;
 *                           missing wattage is never treated as unlimited)
 *
 * @param {object} input
 * @param {string|null} input.gpu_product_variant_id
 * @param {string|null} input.psu_product_id
 * @param {number|null} input.gpu_recommended_psu_watts
 * @param {number|null} input.psu_rated_wattage
 */
function resolveGpuPsuWattage(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('resolveGpuPsuWattage expects an input object');
  }
  const { gpu_product_variant_id = null, psu_product_id = null } = input;

  return numericLimitResult({
    required: input.gpu_recommended_psu_watts,
    limit: input.psu_rated_wattage,
    failReason: REASON_CODES.GPU_PSU_WATTAGE_INSUFFICIENT,
    unknownReason: REASON_CODES.GPU_PSU_WATTAGE_UNKNOWN,
    evidence: {
      rule: 'gpu_psu_wattage',
      gpu_product_variant_id,
      psu_product_id,
    },
  });
}

/**
 * Normalize a connector requirements value into a counts map.
 *
 * Accepts either the JSONB counts object ({ pcie_8pin: 2 }) or an array of
 * connector names (each entry counts as one). Returns null when the value
 * itself is missing (UNKNOWN), or a counts map otherwise. Returns an empty
 * map for an empty value (nothing required -> vacuously satisfied).
 */
function normalizeRequiredConnectors(value) {
  if (value == null) return null;

  if (Array.isArray(value)) {
    const counts = {};
    for (const name of value) {
      if (typeof name !== 'string') return null;
      counts[name] = (counts[name] || 0) + 1;
    }
    return counts;
  }

  if (typeof value !== 'object') return null;

  const counts = {};
  for (const [name, count] of Object.entries(value)) {
    if (!Number.isFinite(count) || count < 0) return null;
    if (count > 0) counts[name] = count;
  }
  return counts;
}

/**
 * Rule 11: GPU required power connectors vs PSU available connectors.
 *
 * Every known required connector must be available in sufficient count:
 *
 *   all requirements satisfied      -> PASS (exact counts are PASS)
 *   any requirement unavailable     -> FAIL (GPU_PSU_CONNECTOR_UNAVAILABLE)
 *   GPU requirements missing        -> UNKNOWN (GPU_PSU_CONNECTOR_UNKNOWN)
 *   PSU availability for a needed
 *   connector null                  -> UNKNOWN (GPU_PSU_CONNECTOR_UNKNOWN)
 *   unknown connector name required -> UNKNOWN (GPU_PSU_CONNECTOR_UNKNOWN;
 *                                      compatibility is never invented)
 *   empty requirements              -> PASS (vacuously satisfied)
 *
 * @param {object} input
 * @param {string|null} input.gpu_product_variant_id
 * @param {string|null} input.psu_product_id
 * @param {object|Array|null} input.gpu_required_power_connectors
 * @param {object|null} input.psu_power_connectors  Normalized counts map
 *        (e.g. { 24pin_atx: 1, eps: 1, pcie_8pin: 2, 12vhpwr: 1, sata: 4 }).
 */
function resolveGpuPsuConnectors(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('resolveGpuPsuConnectors expects an input object');
  }
  const { gpu_product_variant_id = null, psu_product_id = null } = input;

  const baseEvidence = {
    rule: 'gpu_psu_connectors',
    gpu_product_variant_id,
    psu_product_id,
  };

  const required = normalizeRequiredConnectors(input.gpu_required_power_connectors);
  if (required === null) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.GPU_PSU_CONNECTOR_UNKNOWN,
      evidence: [{
        ...baseEvidence,
        required_connectors: input.gpu_required_power_connectors ?? null,
        available_connectors: input.psu_power_connectors ?? null,
        source_status: null,
      }],
    });
  }

  const available = input.psu_power_connectors ?? null;
  const deficits = {};
  const unknowns = [];

  for (const [name, needed] of Object.entries(required)) {
    if (!KNOWN_CONNECTORS.has(name)) {
      unknowns.push(name);
      continue;
    }
    if (available === null || available[name] == null) {
      unknowns.push(name);
      continue;
    }
    if (!Number.isFinite(available[name])) {
      unknowns.push(name);
      continue;
    }
    if (available[name] < needed) {
      deficits[name] = { required: needed, available: available[name] };
    }
  }

  if (unknowns.length > 0) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.GPU_PSU_CONNECTOR_UNKNOWN,
      evidence: [{
        ...baseEvidence,
        required_connectors: input.gpu_required_power_connectors,
        available_connectors: available,
        unverifiable_connectors: unknowns,
        source_status: null,
      }],
    });
  }

  if (Object.keys(deficits).length > 0) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.FAIL,
      reason: REASON_CODES.GPU_PSU_CONNECTOR_UNAVAILABLE,
      evidence: [{
        ...baseEvidence,
        required_connectors: input.gpu_required_power_connectors,
        available_connectors: available,
        connector_deficits: deficits,
      }],
    });
  }

  return createCompatibilityResult({
    status: FINAL_STATUSES.PASS,
    evidence: [{
      ...baseEvidence,
      required_connectors: input.gpu_required_power_connectors,
      available_connectors: available,
    }],
  });
}

module.exports = {
  resolveGpuCaseLength,
  resolveGpuCaseThickness,
  resolveGpuPsuWattage,
  resolveGpuPsuConnectors,
};
