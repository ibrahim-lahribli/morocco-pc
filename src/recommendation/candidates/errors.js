/**
 * Compatibility shim (step 4B PR 2): the candidate error vocabulary moved to
 * packages/recommendation-core/src/candidates/errors.js. Re-exported by
 * identity — every stage imports this path, so the class identity that
 * `instanceof` and the `name`/`code` assertions rely on must not change.
 */
module.exports = require('../../../packages/recommendation-core/src/candidates/errors');
