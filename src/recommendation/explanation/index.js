/**
 * Engine 6 - explanation public surface - COMPATIBILITY SHIM (step 4B PR 7).
 *
 * The implementation moved to packages/recommendation-core/src/explanation/.
 * Re-exported by identity: the four exports are unchanged, so every consumer
 * that imports this barrel (the orchestrator and the explanation tests) keeps
 * its exact behaviour.
 *
 * The namespace is also published from the core package's own entry point
 * (packages/recommendation-core/src/index.js), which is where new pure
 * consumers should import it from.
 */
module.exports = require('../../../packages/recommendation-core/src/explanation');
