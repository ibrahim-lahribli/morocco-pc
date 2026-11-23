/**
 * Engine 2D - Filtering context loader - COMPATIBILITY SHIM (step 5 W1).
 *
 * The implementation moved to
 * packages/recommendation-runtime/src/filtering/context-loader.js.
 * Re-exported by identity, so `filtering/index.js`, `filtering/pipeline.js` and
 * every test keep their exact behaviour. It executes SQL, so it belongs to the
 * runtime package rather than the pure core; the old path stays loadable so no
 * importer changes in this batch. `CONTEXT_COMPAT_KEYS` travels with it, as
 * RFC §11.2 records.
 */
module.exports = require('../../../packages/recommendation-runtime/src/filtering/context-loader');
