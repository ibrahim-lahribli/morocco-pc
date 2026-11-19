/**
 * E6 (Decision 54) - the iGPU CPU eligibility set - COMPATIBILITY SHIM
 * (step 4B PR 5).
 *
 * The implementation moved to
 * packages/recommendation-core/src/retention/igpu-pool.js.
 * Re-exported by identity, so every consumer and test keeps its exact
 * behaviour. `GPU_POLICY_VALUES` is deliberately NOT re-exported through the
 * core `retention` barrel; this shim preserves the module-level export that
 * existing consumers use.
 */
module.exports = require('../../../packages/recommendation-core/src/retention/igpu-pool');
