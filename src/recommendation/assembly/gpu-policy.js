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
 *     Decision 37 profile vocabulary) wins over Rule 1: IGPU_ALLOWED ->
 *     OPTIONAL exactly when the selected CPU has an integrated GPU
 *     (=== true), REQUIRED otherwise; REQUIRED -> REQUIRED. Declared means
 *     valid: a null or non-vocabulary declared value can never arrive here
 *     (../input.js owns the contract and fails first).
 *   - Rule 0b (E6, Decision 43, optionality): if the policy is OPTIONAL/
 *     IGPU_ALLOWED, the candidate keeps its GPU role entry only when the
 *     selected CPU already carries an integrated GPU (=== true); otherwise
 *     the candidate is skipped. A null or absent gpuPolicy keeps the legacy
 *     Rule 2 path (integrated_gpu_present === true -> OPTIONAL) unchanged.
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
  // Rule 0b (E6, Decision 43, optionality): once the decision is OPTIONAL
  // because of an IGPU_ALLOWED policy, the caller (Step 4) only keeps the
  // role entry if the selected CPU already carries an integrated GPU
  // (=== true). A REQUIRED result always keeps the role entry; a legacy
  // OPTIONAL result (Rule 2) also keeps the role entry; the only difference
  // is which branch is considered OPTIONAL.
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
