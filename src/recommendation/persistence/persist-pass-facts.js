/**
 * Engine 5b - pass-facts persistence - COMPATIBILITY SHIM (step 5 W2).
 *
 * The implementation moved to
 * packages/recommendation-runtime/src/persistence/persist-pass-facts.js.
 * Re-exported by identity, so `orchestrator/commit.js`, `orchestrator/full-run`
 * and their tests keep their exact behaviour. It issues UPDATE-only DML on the
 * caller's client, so it belongs to the runtime package rather than the pure
 * core; the old path stays loadable so no importer changes in this batch.
 */
module.exports = require('../../../packages/recommendation-runtime/src/persistence/persist-pass-facts');
