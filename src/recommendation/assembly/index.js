/**
 * Engine 3 - build assembly public surface - COMPATIBILITY SHIM (step 4B PR 3).
 *
 * The implementation moved to packages/recommendation-core/src/assembly/.
 * Re-exported by identity: the eleven exports are unchanged, so every consumer
 * that imports this barrel (ranking, explanation, orchestrator, apps/api/src/
 * engine.js, and the assembly tests) keeps its exact behaviour.
 *
 * The namespace is also published from the core package's own entry point
 * (packages/recommendation-core/src/index.js), which is where new pure
 * consumers should import it from.
 */
module.exports = require('../../../packages/recommendation-core/src/assembly');
