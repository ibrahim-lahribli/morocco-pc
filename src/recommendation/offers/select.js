/**
 * Engine 2 - Stage 1: offer pre-selection - COMPATIBILITY SHIM (step 5 W1).
 *
 * The implementation moved to
 * packages/recommendation-runtime/src/offers/select.js.
 * Re-exported by identity, so every consumer and test keeps its exact
 * behaviour. It executes SQL, so it belongs to the runtime package rather than
 * the pure core; the old path stays loadable so no importer changes in this
 * batch.
 */
module.exports = require('../../../packages/recommendation-runtime/src/offers/select');
