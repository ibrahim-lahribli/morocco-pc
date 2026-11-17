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
 *   - Rule 0 (E6, Decision 43): a DECLARED per-use-case gpu_policy (the
 *     Decision 37 profile vocabulary) wins over Rule 1: IGPU_ALLOWED makes
 *     the iGPU the GPU for this use case, so the decision is OPTIONAL exactly
 *     when the selected CPU has an integrated GPU (=== true) and REQUIRED
 *     otherwise; REQUIRED -> REQUIRED. Declared means valid: a null or
 *     non-vocabulary declared value can never arrive here (../input.js owns
 *     the contract and fails first).
 *   - Rule 0 is safe to make the omit path the caller's only path: Step 4
 *     hard-skips the discrete branches on an IGPU_ALLOWED/OPTIONAL result,
 *     and omitting the GPU can only relax the walk (strictly positive prices,
 *     no pair FAIL from an absent partner), so no query that could be built
 *     is left empty. Step 4 owns that hard skip and its test.
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

// E6 (Decision 43): staged, boundary-local copy of the Decision 37
// GPU-policy vocabulary. The one owner is ../scoring/use-cases.js
// (GPU_POLICIES); stage boundary pins keep assembly require-free, so the
// parity of this two-string copy is pinned by gpu-policy tests.
const GPU_POLICY_VALUES = Object.freeze(['REQUIRED', 'IGPU_ALLOWED']);

function resolveGpuRequirement({
  use_case,
  gpu_required_use_cases,
  integrated_gpu_present,
  selectedCpuProductId,
  gpuPolicy,
}) {
  // Rule 0 (E6, Decision 43): a DECLARED per-use-case profile policy wins
  // over the legacy gpu_required_use_cases list. 'REQUIRED' forces the GPU;
  // 'IGPU_ALLOWED' keeps it OPTIONAL exactly on an iGPU CPU (=== true) and
  // REQUIRED otherwise. The declared list and the declared null are not
  // reachable here: ../input.js accepts the field only when it carries an
  // exact vocabulary string.
  //
  // What the caller does with the result: REQUIRED walks the discrete GPUs
  // and forbids the omit path; OPTIONAL-from-IGPU_ALLOWED walks ONLY the omit
  // path; OPTIONAL-from-the-legacy-Rule-2 walks both, GPU verdicts first.
  if (typeof gpuPolicy === 'string' && GPU_POLICY_VALUES.includes(gpuPolicy)) {
    if (gpuPolicy === 'IGPU_ALLOWED') {
      if (integrated_gpu_present[selectedCpuProductId] === true) {
        return 'OPTIONAL';
      }
      return 'REQUIRED';
    }
    return 'REQUIRED';
  }

  if (gpu_required_use_cases.includes(use_case)) {
    return 'REQUIRED';
  }

  if (integrated_gpu_present[selectedCpuProductId] === true) {
    return 'OPTIONAL';
  }

  return 'REQUIRED';
}

module.exports = { resolveGpuRequirement };
