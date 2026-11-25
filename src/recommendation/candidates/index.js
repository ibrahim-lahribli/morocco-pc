/**
 * Engine 2 - candidate contracts and pool selection - COMPATIBILITY SHIM (step 5 W3).
 *
 * The namespace barrel moved to
 * packages/recommendation-runtime/src/candidates/index.js. Re-exported by
 * identity, so the orchestrator's documented patch seam is unchanged: a test
 * patches the object `require('../candidates')` resolves to and the
 * implementation calls through that SAME object, at both depths.
 *
 * The surface composition (a spread of the pure core namespace plus
 * `loadCandidates`) and its exact key set are pinned by
 * packages/recommendation-runtime/test/namespace-barrels.test.js.
 */
module.exports = require('../../../packages/recommendation-runtime/src/candidates');
