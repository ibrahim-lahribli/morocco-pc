/**
 * Engine 2D - filtering - COMPATIBILITY SHIM (step 5 W3).
 *
 * The namespace barrel moved to
 * packages/recommendation-runtime/src/filtering/index.js. Re-exported by
 * identity, so every consumer and the orchestrator's patch seam are unchanged.
 * The surface is a spread of the pure core filtering namespace plus the three
 * SQL/orchestration members; its exact key set and function identities are
 * pinned by packages/recommendation-runtime/test/namespace-barrels.test.js.
 */
module.exports = require('../../../packages/recommendation-runtime/src/filtering');
