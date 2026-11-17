/**
 * Engine 3 - GPU policy - COMPATIBILITY SHIM (step 4B PR 3).
 *
 * The implementation moved to
 * packages/recommendation-core/src/assembly/gpu-policy.js. Re-exported by
 * identity so the DFS walk keeps consulting the same REQUIRED | OPTIONAL
 * decision function.
 */
module.exports = require('../../../packages/recommendation-core/src/assembly/gpu-policy');
