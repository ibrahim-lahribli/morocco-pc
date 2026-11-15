/**
 * Engine 2D - Hard compatibility filter (B2-D: pure verdict aggregation).
 *
 * COMPATIBILITY SHIM (step 4B PR 2). The implementation moved to
 * packages/recommendation-core/src/filtering/filter.js. Re-exported by
 * identity: assembly/assemble.js, retention/retain.js and their tests require
 * this path, and the Decision 16 pairwise re-check must call the same function
 * instance the candidate-level filter uses.
 */
module.exports = require('../../../packages/recommendation-core/src/filtering/filter');
