/**
 * Query input - Decision 10 / Decision 17.1 loader - COMPATIBILITY SHIM (step 5 W1).
 *
 * The implementation moved to
 * packages/recommendation-runtime/src/query/load-query-input.js.
 * Re-exported by identity, so every consumer and test keeps its exact
 * behaviour. It executes SQL, so it belongs to the runtime package rather than
 * the pure core; the old path stays loadable so no importer changes in this
 * batch.
 */
module.exports = require('../../../packages/recommendation-runtime/src/query/load-query-input');
