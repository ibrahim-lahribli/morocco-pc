/**
 * Engine 3 - assembly entry point - COMPATIBILITY SHIM (step 4B PR 3).
 *
 * The implementation moved to
 * packages/recommendation-core/src/assembly/pipeline.js. Re-exported by
 * identity so the orchestrator's single assembly call keeps resolving this
 * path and no composition behaviour changes.
 */
module.exports = require('../../../packages/recommendation-core/src/assembly/pipeline');
