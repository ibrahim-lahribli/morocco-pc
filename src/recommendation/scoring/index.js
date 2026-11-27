/**
 * Scoring model (Decision 11) + Engine 4 scoring (Decision 13) - COMPATIBILITY
 * SHIM (step 5 W3).
 *
 * The namespace barrel moved to
 * packages/recommendation-runtime/src/scoring/index.js. Re-exported by
 * identity, so every consumer and the orchestrator's patch seam are unchanged.
 * Its key ORDER is still the one this path published (the loaders sit in the
 * middle of it), and packages/recommendation-runtime/test/namespace-barrels.test.js
 * pins it.
 */
module.exports = require('../../../packages/recommendation-runtime/src/scoring');
