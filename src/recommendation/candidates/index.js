/**
 * Engine 2 - Candidate component selector (foundation).
 *
 * COMPATIBILITY SHIM (step 4B PR 2). The implementation moved to
 * packages/recommendation-core/src/candidates/; this module keeps the old
 * import path working and re-exports by identity, so `require`-cache identity,
 * `instanceof` checks and every existing consumer are unchanged.
 *
 * The surface is written out explicitly rather than spread from the core
 * barrel: a future core export must not appear here by accident. `loadCandidates`
 * is the one runtime export, and it still lives beside this file in ./loader.
 *
 * Read packages/recommendation-core/src/candidates/index.js for the pure
 * contract; nothing in this file implements anything.
 */
const core = require('../../../packages/recommendation-core/src/candidates');
const { loadCandidates } = require('./loader');

module.exports = {
  COMPONENT_ROLES: core.COMPONENT_ROLES,
  ROLE_ORDER: core.ROLE_ORDER,
  SINGULAR_ROLES: core.SINGULAR_ROLES,
  PRODUCT_CATEGORIES: core.PRODUCT_CATEGORIES,
  ROLE_CATEGORIES: core.ROLE_CATEGORIES,
  isValidComponentRole: core.isValidComponentRole,
  isValidProductCategory: core.isValidProductCategory,
  expectedCategoryForRole: core.expectedCategoryForRole,
  ERROR_CODES: core.ERROR_CODES,
  CandidateSelectionError: core.CandidateSelectionError,
  createCandidateSelectionInput: core.createCandidateSelectionInput,
  createCandidate: core.createCandidate,
  loadCandidates,
  SELECTION_STAGES: core.SELECTION_STAGES,
  IMPLEMENTED_STAGES: core.IMPLEMENTED_STAGES,
  selectCandidatePool: core.selectCandidatePool,
  compareCandidates: core.compareCandidates,
};
