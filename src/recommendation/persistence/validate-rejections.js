/**
 * Input contract for the rejection writer - COMPATIBILITY SHIM (step 5 W2).
 *
 * The implementation moved to
 * packages/recommendation-runtime/src/persistence/validate-rejections.js.
 * Re-exported by identity, so `./persist-rejections` and its tests keep their
 * exact behaviour. It is validation and filtering only, with a write-shaped
 * contract, so it stays runtime-owned rather than moving to the pure core; the
 * old path stays loadable so no importer changes in this batch.
 */
module.exports = require('../../../packages/recommendation-runtime/src/persistence/validate-rejections');
