/**
 * Engine 5b - ranked persistence writer - COMPATIBILITY SHIM (step 5 W2).
 *
 * The implementation moved to
 * packages/recommendation-runtime/src/persistence/persist-ranked.js.
 * Re-exported by identity, so `orchestrator/commit.js`, its tests and every
 * other consumer keep their exact behaviour. It executes DML against an
 * injected client, so it belongs to the runtime package rather than the pure
 * core; the old path stays loadable so no importer changes in this batch.
 */
module.exports = require('../../../packages/recommendation-runtime/src/persistence/persist-ranked');
