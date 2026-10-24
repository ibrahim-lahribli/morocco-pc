/**
 * E6 (Decision 54) - the CPU eligibility set implied by a DECLARED per-use-case
 * `gpu_policy`.
 *
 * Boundary: a pure derivation, no database, no policy storage of its own. It
 * answers ONE question for the retention stage: when the active model declares
 * `IGPU_ALLOWED` for the query's use case, which CPU candidates cannot satisfy
 * that declaration?
 *
 * Why this exists
 *   Decision 43 made `IGPU_ALLOWED` mean "the iGPU IS the GPU for this use
 *   case" at Engine 3 GPU depth: an iGPU CPU takes the omit path exclusively,
 *   and a CPU without an integrated GPU correctly resolves to REQUIRED and
 *   walks discrete GPUs. That rule is right per CPU, but it is not sufficient
 *   for the epic's acceptance: OFFICE still RECOMMENDED discrete-GPU builds
 *   because retention kept mostly non-iGPU CPUs, and the ranked rank-1 was a
 *   dGPU build (OG-49). Ordering the walk per CPU cannot fix which CPUs reach
 *   it. Decision 43's own verdict named retention as the owner of the missing
 *   half; this module is that half.
 *
 * Semantics
 *   * Only a DECLARED `IGPU_ALLOWED` produces exclusions. `REQUIRED`, null and
 *     absent all return null: those queries keep the pre-E6 pool byte-for-byte.
 *   * A CPU is EXCLUDED unless `cpu_spec.integrated_gpu_present === true`.
 *     `false` is a verified absence; NULL/missing is UNKNOWN, and under a
 *     policy that says the CPU supplies the graphics, absence of evidence is
 *     not evidence of an iGPU. (Today the catalog has no NULL flag - 18 CPUs,
 *     6 true / 12 false, measured 2026-10-14 - but the semantics must not
 *     depend on that.)
 *   * The exclusion set is derived from the FILTERING CONTEXT's CPU candidate
 *     list, not from the spec map's keys, so a CPU candidate with no spec row
 *     is excluded too rather than silently kept.
 *
 * Return shape: `null`, or a FROZEN array of unique product-id strings sorted
 * by code unit (never `localeCompare`), deterministic across runs and input
 * key order. The caller (orchestrator/run.js) passes it to retention as
 * `roleExclusions.CPU`; retention treats it as a membership set.
 *
 * Purity: no clock, no randomness, no I/O, no input mutation.
 */

'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** The declared vocabulary this helper understands (Decision 43). */
const GPU_POLICY_VALUES = Object.freeze(['REQUIRED', 'IGPU_ALLOWED']);

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {object} args
 * @param {string|null|undefined} args.gpuPolicy  the resolved per-use-case
 *        policy (Engine 3 input vocabulary) or null when the model declares
 *        no profile for the query's use case
 * @param {object} args.filteringContext  the Engine 2D context
 *        ({ candidates, specs, ... }); only CPU candidates and `p:<id>` specs
 *        are read
 * @returns {ReadonlyArray<string>|null} excluded CPU product ids, or null
 */
function excludedCpuProductIds(args) {
  if (args !== undefined && args !== null && !isPlainObject(args)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      null,
      'excludedCpuProductIds requires an object carrying gpuPolicy and filteringContext'
    );
  }
  const { gpuPolicy, filteringContext } = args === undefined || args === null ? {} : args;
  if (gpuPolicy === undefined || gpuPolicy === null) {
    return null;
  }
  if (typeof gpuPolicy !== 'string' || !GPU_POLICY_VALUES.includes(gpuPolicy)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'gpuPolicy',
      '"gpuPolicy" must be "REQUIRED", "IGPU_ALLOWED" or null/absent'
    );
  }
  if (gpuPolicy !== 'IGPU_ALLOWED') {
    return null;
  }

  if (!isPlainObject(filteringContext)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'filteringContext',
      '"filteringContext" must be the Engine 2D context object'
    );
  }
  const candidates = filteringContext.candidates;
  if (!isPlainObject(candidates) || !Array.isArray(candidates.CPU)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'filteringContext.candidates.CPU',
      '"filteringContext.candidates.CPU" must be an array of CPU candidates'
    );
  }
  const specs = filteringContext.specs;
  if (!isPlainObject(specs)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'filteringContext.specs',
      '"filteringContext.specs" must be an object keyed by "p:<product_id>"'
    );
  }

  const excluded = new Set();
  for (const candidate of candidates.CPU) {
    if (!isPlainObject(candidate) || candidate.product_id === undefined || candidate.product_id === null) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'filteringContext.candidates.CPU',
        'every CPU candidate must carry a product_id'
      );
    }
    const productId = String(candidate.product_id);
    const spec = specs['p:' + productId];
    const suppliesGraphics = isPlainObject(spec) && spec.integrated_gpu_present === true;
    if (!suppliesGraphics) {
      excluded.add(productId);
    }
  }

  return Object.freeze([...excluded].sort());
}

module.exports = { excludedCpuProductIds, GPU_POLICY_VALUES };
