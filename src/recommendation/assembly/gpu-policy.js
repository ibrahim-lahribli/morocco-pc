/**
 * Engine 3 - Step 3: GPU requirement decision.
 *
 * Consumes:  single argument object carrying `use_case`,
 *             `gpu_required_use_cases`, `integrated_gpu_present` and
 *             `selectedCpuProductId`.
 * Produces:  exactly 'REQUIRED' or 'OPTIONAL'.
 *
 * Responsibilities
 *   - Rule 1: explicit GPU-required use case (exact Array.includes) -> REQUIRED.
 *   - Rule 2: integrated GPU flag strictly equal to true -> OPTIONAL.
 *   - Rule 3: otherwise -> REQUIRED.
 *
 * Explicit NON-responsibilities (deliberately absent from this module)
 *   - no database access, no framework
 *   - no candidate lookup, no price lookup
 *   - no assembly, no compatibility resolution
 *   - no scoring, no ordering, no budget calculations
 *   - no traversal/DFS, no output-cap application
 *   - no mutation of inputs
 *
 * Matching semantics
 *   - use-case check uses exact `Array.prototype.includes()` semantics.
 *     No trimming, no case folding, no normalization, no substring/regex/fuzzy
 *     matching. 'gaming', 'Gaming', ' gaming' and 'gaming ' are distinct.
 *   - integrated GPU check uses strict `=== true`. Only the boolean value
 *     `true` qualifies; false, null, undefined, absent keys and any other
 *     truthy non-boolean value fall through to REQUIRED.
 *
 * Pure: deterministic, no database access, no framework.
 */
'use strict';

function resolveGpuRequirement({
  use_case,
  gpu_required_use_cases,
  integrated_gpu_present,
  selectedCpuProductId,
}) {
  if (gpu_required_use_cases.includes(use_case)) {
    return 'REQUIRED';
  }

  if (integrated_gpu_present[selectedCpuProductId] === true) {
    return 'OPTIONAL';
  }

  return 'REQUIRED';
}

module.exports = { resolveGpuRequirement };
