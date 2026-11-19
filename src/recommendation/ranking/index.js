/**
 * Engine 5a - ranking public surface - COMPATIBILITY SHIM (step 4B PR 4).
 *
 * The implementation moved to packages/recommendation-core/src/ranking/.
 * Re-exported by identity: the exports are unchanged, so every consumer that
 * imports this barrel (explanation, orchestrator, apps/api/src/engine.js and the
 * ranking tests) keeps its exact behaviour.
 *
 * The namespace is also published from the core package's own entry point
 * (packages/recommendation-core/src/index.js), which is where new pure
 * consumers should import it from.
 */
module.exports = require('../../../packages/recommendation-core/src/ranking');
