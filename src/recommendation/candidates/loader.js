/**
 * Engine 2B - Database candidate loader - COMPATIBILITY SHIM (step 5 W1).
 *
 * The implementation moved to
 * packages/recommendation-runtime/src/candidates/loader.js.
 * Re-exported by identity, so `candidates/index.js` and every test keep their
 * exact behaviour. It executes SQL, so it belongs to the runtime package rather
 * than the pure core; the old path stays loadable so no importer changes in
 * this batch.
 */
module.exports = require('../../../packages/recommendation-runtime/src/candidates/loader');
