'use strict';

const { EXPANSION_ORDER } = require('../assembly');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const MAX_PER_PAIR = 3;

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/**
 * Validate selectDiverseTop arguments. Only validates what this function directly
 * reads; does not re-validate build internals that rankBuilds already validated.
 *
 * - `ranked` must be an array if provided (empty array is valid, not an error).
 * - `limit` must be a positive integer if provided.
 * - `maxPerPair` must be a positive integer if provided.
 */
function validateArgs({ ranked, limit, maxPerPair }) {
  if (ranked === undefined || ranked === null) {
    return { ranked: [], limit, maxPerPair };
  }
  if (!Array.isArray(ranked)) {
    fail(ERROR_CODES.INVALID_INPUT, 'ranked', '"ranked" must be an array');
  }
  if (limit !== undefined && limit !== null) {
    if (!Number.isInteger(limit) || limit <= 0) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, 'limit', '"limit" must be a positive integer');
    }
  }
  if (maxPerPair !== undefined && maxPerPair !== null) {
    if (!Number.isInteger(maxPerPair) || maxPerPair <= 0) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, 'maxPerPair', '"maxPerPair" must be a positive integer');
    }
  }
  return { ranked, limit, maxPerPair };
}

/**
 * Build a pair key for a ranked entry: (CPU product_id, GPU product_variant_id-or-omitted).
 *
 * Uses the same by-role lookup pattern as rank.js buildSignature(). GPU omission
 * (iGPU path) is represented by the string 'OMITTED' as the GPU part of the key,
 * making it a distinct pair value from any actual GPU variant.
 *
 * Throws MISSING_REQUIRED_FIELD if the build has no CPU component - contract violation.
 */
function pairKey(entry) {
  const components = entry.build.components;
  const byRole = Object.create(null);
  for (const component of components) {
    byRole[component.component_role] = component;
  }

  const cpuComponent = byRole['CPU'];
  if (cpuComponent === undefined) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'ranked',
      'ranked entry build has no CPU component - contract violation (Decision 10 required_roles)'
    );
  }

  const cpuProductId = cpuComponent.product_id;

  const gpuComponent = byRole['GPU'];
  let gpuPairValue;
  if (gpuComponent === undefined) {
    gpuPairValue = 'OMITTED';
  } else {
    gpuPairValue = gpuComponent.product_variant_id;
    if (gpuPairValue === null || gpuPairValue === undefined) {
      gpuPairValue = '';
    }
  }

  return `${cpuProductId}|${gpuPairValue}`;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Post-ranking pair-diversity selection (Decision 20, O4).
 *
 * Walks the ranked list top-down, selecting builds while enforcing a per-pair cap
 * on (CPU product_id, GPU product_variant_id-or-omitted). Stops when `limit`
 * entries are selected or the ranked list is exhausted.
 */
function selectDiverseTop({ ranked, limit = 10, maxPerPair = MAX_PER_PAIR } = {}) {
  const validated = validateArgs({ ranked, limit, maxPerPair });
  const { ranked: rankedList, limit: limitVal, maxPerPair: maxPerPairVal } = validated;

  const selected = [];
  const pairCounts = Object.create(null);
  let droppedCount = 0;

  for (let i = 0; i < rankedList.length; i += 1) {
    if (selected.length >= limitVal) {
      break;
    }

    const entry = rankedList[i];
    const key = pairKey(entry);
    const currentCount = pairCounts[key] || 0;

    if (currentCount >= maxPerPairVal) {
      droppedCount += 1;
      continue;
    }

    pairCounts[key] = currentCount + 1;
    selected.push({
      persisted_rank: selected.length + 1,
      build_score: entry.build_score,
      total_price: entry.total_price,
      compatibility_status: entry.compatibility_status,
      signature: entry.signature,
      explanation: entry.explanation,
      build: entry.build,
    });
  }

  const result = {
    selected,
    dropped_count: droppedCount,
  };

  return deepFreeze(result);
}

module.exports = { selectDiverseTop, MAX_PER_PAIR };