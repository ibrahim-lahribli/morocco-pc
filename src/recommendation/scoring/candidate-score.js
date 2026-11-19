/**
 * Engine 4 - STEP 2: candidate score per (product, role) (Decision 13) -
 * COMPATIBILITY SHIM (step 4B PR 6).
 *
 * The implementation moved to
 * packages/recommendation-core/src/scoring/candidate-score.js.
 * Re-exported by identity, so every consumer and test keeps its exact
 * behaviour. New pure consumers should import the `scoring` namespace from
 * the core package entry point instead.
 */
module.exports = require('../../../packages/recommendation-core/src/scoring/candidate-score');
