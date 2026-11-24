/**
 * Engine 5b - persistence input validation - COMPATIBILITY SHIM (step 5 W2).
 *
 * The implementation moved to
 * packages/recommendation-runtime/src/persistence/validate-selected.js.
 * Re-exported by identity, so `./persist-ranked`, its tests and every other
 * consumer keep their exact behaviour. It is pure code with a write-shaped
 * contract, so it stays runtime-owned rather than moving to the pure core; the
 * old path stays loadable so no importer changes in this batch.
 */
module.exports = require('../../../packages/recommendation-runtime/src/persistence/validate-selected');
