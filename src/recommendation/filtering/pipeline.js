/**
 * Engine 2D - Filtering stage orchestration entry point (B2-G) -
 * COMPATIBILITY SHIM (step 5 W1).
 *
 * The implementation moved to
 * packages/recommendation-runtime/src/filtering/pipeline.js.
 * Re-exported by identity, so `filtering/index.js` and every test that names
 * this path keep their exact behaviour. It composes a SQL-executing loader with
 * the pure filter, so it belongs to the runtime package; the old path stays
 * loadable so no importer changes in this batch.
 */
module.exports = require('../../../packages/recommendation-runtime/src/filtering/pipeline');
