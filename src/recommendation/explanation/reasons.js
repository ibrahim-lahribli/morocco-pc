/**
 * Engine 6 - structured reason codes (E7) -
 * COMPATIBILITY SHIM (step 4B PR 7).
 *
 * The implementation moved to
 * packages/recommendation-core/src/explanation/reasons.js.
 * Re-exported by identity, so every consumer and test keeps its exact
 * behaviour. New pure consumers should import the `explanation` namespace from
 * the core package entry point instead.
 */
module.exports = require('../../../packages/recommendation-core/src/explanation/reasons');
