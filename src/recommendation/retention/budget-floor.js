/**
 * Decision 27 - budget floor diagnostic - COMPATIBILITY SHIM (step 4B PR 5).
 *
 * The implementation moved to
 * packages/recommendation-core/src/retention/budget-floor.js.
 * Re-exported by identity, so every consumer and test keeps its exact
 * behaviour. New pure consumers should import the `retention` namespace from
 * the core package entry point instead.
 */
module.exports = require('../../../packages/recommendation-core/src/retention/budget-floor');
