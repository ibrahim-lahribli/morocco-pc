/**
 * Engine 6 - shared explanation facts -
 * COMPATIBILITY SHIM (step 4B PR 7).
 *
 * The implementation moved to
 * packages/recommendation-core/src/explanation/build-facts.js.
 * Re-exported by identity, so every consumer and test keeps its exact
 * behaviour. New pure consumers should import the `explanation` namespace from
 * the core package entry point instead.
 */
module.exports = require('../../../packages/recommendation-core/src/explanation/build-facts');
