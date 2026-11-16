/**
 * Compatibility shim (step 4B PR 2): pool selection and the deterministic
 * tie-breaks moved to packages/recommendation-core/src/candidates/select.js.
 * Re-exported by identity so the old import path keeps resolving for the
 * runtime tree.
 */
module.exports = require('../../../packages/recommendation-core/src/candidates/select');
