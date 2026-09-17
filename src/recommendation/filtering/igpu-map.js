/**
 * Decision 11 (iGPU sourcing, resolved 2026-09-17) - Engine 2D -> Engine 3
 * integrated_gpu_present handoff.
 *
 * Boundary: derives the Engine 3 `integrated_gpu_present` map from the
 * already-built Engine 2D filtering context. The authoritative source is the
 * EXISTING normalized CPU-spec context produced by context-loader.js
 * (CPU_SPEC_SQL already carries cpu_spec.integrated_gpu_present, and
 * normalizeSpecForRole('CPU', row) normalizes it to true | false | null,
 * preserving DB NULL exactly).
 *
 * This module deliberately does NOT query the database, re-read cpu_spec, or
 * add any CPU-spec lookup: it reads only what loadFilteringContext already
 * returned (no dedicated CPU-spec query - Decision 11 resolution).
 *
 * Handoff contract (exactly):
 *
 *   { [cpu_product_id]: true | false | null }
 *
 * Semantics (Decision 11, confirmed 2026-09-17):
 *
 *   cpu_spec.integrated_gpu_present = true   -> true   (GPU OPTIONAL)
 *   cpu_spec.integrated_gpu_present = false  -> false  (GPU REQUIRED)
 *   cpu_spec.integrated_gpu_present = NULL   -> null   (GPU REQUIRED)
 *   no cpu_spec row for the candidate        -> null   (GPU REQUIRED)
 *
 * Only the strict boolean `true` means GPU OPTIONAL downstream; Engine 3's
 * resolveGpuRequirement() applies `=== true` and is NOT changed here.
 *
 * Normalization rules enforced:
 *   - a missing CPU candidate spec entry becomes the explicit value `null`
 *     (never undefined - the Engine 3 input contract rejects undefined);
 *   - no case conversion, no string conversion, no truthiness conversion,
 *     no default false, no default true: only the strict booleans
 *     `true` / `false` pass through, every other state (including DB NULL)
 *     becomes `null`.
 *
 * Determinism: the map is built by walking the frozen Engine 2D CPU bucket
 * in its preserved candidate order (Engine 2C pool order); the same context
 * always yields the same map.
 *
 * Pure: no database access, no I/O, no mutation of the context.
 */

'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

function fail(message) {
  throw new CandidateSelectionError(ERROR_CODES.INVALID_INPUT, message, 'context');
}

/**
 * Build the Engine 3 `integrated_gpu_present` handoff map from an Engine 2D
 * filtering context.
 *
 * @param {object} context  frozen Engine 2D context { candidates, specs, ... }
 * @returns {object} frozen map { [cpu_product_id]: true | false | null }
 */
function buildIntegratedGpuPresentMap(context) {
  if (context === null || typeof context !== 'object' || Array.isArray(context)) {
    fail('iGPU handoff requires an Engine 2D filtering context object');
  }
  if (
    context.candidates === null ||
    typeof context.candidates !== 'object' ||
    Array.isArray(context.candidates.CPU) === false ||
    context.specs === null ||
    typeof context.specs !== 'object'
  ) {
    fail('iGPU handoff requires the context candidates/specs structure');
  }

  const map = {};
  for (const candidate of context.candidates.CPU) {
    const cpuId = candidate.product_id;
    // The 'p:<product_id>' spec entry exists only when the cpu_spec row was
    // loaded. No entry means NO cpu_spec row -> explicit null (never undefined).
    const spec = context.specs['p:' + cpuId];
    const value = spec === undefined ? null : spec.integrated_gpu_present;
    // Strict pass-through: only exact booleans survive; every other state
    // (DB NULL, anything unexpected) is unknown -> null. No truthiness,
    // no defaults, no conversion.
    map[cpuId] = value === true ? true : value === false ? false : null;
  }

  return Object.freeze(map);
}

module.exports = { buildIntegratedGpuPresentMap };
