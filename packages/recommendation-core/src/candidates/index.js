/**
 * Engine 2 - Candidate component selector (pure candidates barrel).
 *
 * Pure, framework-free candidate selection: the data-loading layer loads
 * product/variant rows and constructs the selection input; this module
 * validates contracts and produces the deterministic candidate pool. It never
 * reads from or writes to the database. Hard compatibility filtering and
 * budget filtering are NOT implemented here (Engine 2 tasks); scoring is NOT
 * implemented (Engine 4).
 *
 * Step 4B PR 2: the pure candidates modules moved here from
 * src/recommendation/candidates/ (which keeps re-export shims so old import
 * paths resolve). `loadCandidates` did NOT move: it executes SQL, so it stays
 * in the runtime tree and is exported by the old barrel only. This file is the
 * pure surface — the export list is written by hand so a future module cannot
 * join it by accident.
 */
const {
  COMPONENT_ROLES,
  ROLE_ORDER,
  SINGULAR_ROLES,
  PRODUCT_CATEGORIES,
  ROLE_CATEGORIES,
  isValidComponentRole,
  isValidProductCategory,
  expectedCategoryForRole,
} = require('./roles');
const { ERROR_CODES, CandidateSelectionError } = require('./errors');
const { createCandidateSelectionInput } = require('./input');
const { createCandidate } = require('./candidate');
const {
  SELECTION_STAGES,
  IMPLEMENTED_STAGES,
  selectCandidatePool,
  compareCandidates,
} = require('./select');

module.exports = {
  COMPONENT_ROLES,
  ROLE_ORDER,
  SINGULAR_ROLES,
  PRODUCT_CATEGORIES,
  ROLE_CATEGORIES,
  isValidComponentRole,
  isValidProductCategory,
  expectedCategoryForRole,
  ERROR_CODES,
  CandidateSelectionError,
  createCandidateSelectionInput,
  createCandidate,
  SELECTION_STAGES,
  IMPLEMENTED_STAGES,
  selectCandidatePool,
  compareCandidates,
};
