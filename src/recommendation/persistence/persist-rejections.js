/**
 * Engine 5b - rejection-reason persistence - COMPATIBILITY SHIM (step 5 W2).
 *
 * The implementation moved to
 * packages/recommendation-runtime/src/persistence/persist-rejections.js.
 * Re-exported by identity, so `orchestrator/commit.js` and its tests keep
 * their exact behaviour. It executes the Decision 31 replace DELETE plus one
 * INSERT on the caller's client, so it belongs to the runtime package rather
 * than the pure core; the old path stays loadable so no importer changes in
 * this batch.
 */
module.exports = require('../../../packages/recommendation-runtime/src/persistence/persist-rejections');
