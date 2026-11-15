/**
 * Compatibility shim (step 4B PR 2): the candidate factory moved to
 * packages/recommendation-core/src/candidates/candidate.js. Re-exported by
 * identity so the old import path keeps resolving for the runtime tree.
 */
module.exports = require('../../../packages/recommendation-core/src/candidates/candidate');
