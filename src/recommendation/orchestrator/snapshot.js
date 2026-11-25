/**
 * Orchestrator module `snapshot` - COMPATIBILITY SHIM (step 5 W3).
 *
 * The implementation moved to
 * packages/recommendation-runtime/src/orchestrator/snapshot.js. Re-exported by
 * identity, so this path, its `*.test.js` suites and every consumer keep
 * their exact behaviour. It owns no logic and no transaction of its own: the
 * transaction contract is still the one recorded in
 * packages/recommendation-runtime/docs/ORCHESTRATOR_ENTRY_POINTS.md and
 * checked against the implementation by
 * packages/recommendation-runtime/test/transaction-ownership.test.js.
 */
module.exports = require('../../../packages/recommendation-runtime/src/orchestrator/snapshot');
