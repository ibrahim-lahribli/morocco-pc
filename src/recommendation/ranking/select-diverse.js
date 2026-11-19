/**
 * Engine 5a - diverse top-set selection - COMPATIBILITY SHIM (step 4B PR 4).
 *
 * The implementation moved to
 * packages/recommendation-core/src/ranking/select-diverse.js.
 * Re-exported by identity, so every consumer and test keeps its exact
 * behaviour. New pure consumers should import the `ranking` namespace from the
 * core package entry point instead.
 */
module.exports = require('../../../packages/recommendation-core/src/ranking/select-diverse');
