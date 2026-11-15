/**
 * Decision 11 iGPU handoff (Engine 2D -> Engine 3).
 *
 * COMPATIBILITY SHIM (step 4B PR 2). The implementation moved to
 * packages/recommendation-core/src/filtering/igpu-map.js. Re-exported by
 * identity: assembly/gpu-input.js requires this path.
 */
module.exports = require('../../../packages/recommendation-core/src/filtering/igpu-map');
