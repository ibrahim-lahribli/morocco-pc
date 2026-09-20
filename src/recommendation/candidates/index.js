/**
 * Engine 2 - Candidate component selector (foundation).
 *
 * Pure, framework-free candidate selection: the future data-loading layer
 * loads product/variant rows and constructs the selection input; this module
 * validates contracts and produces the deterministic candidate pool. It never
 * reads from or writes to the database. Hard compatibility filtering and
 * budget filtering are NOT implemented here (future Engine 2 tasks); scoring
 * is NOT implemented (Engine 4).
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
const { loadCandidates } = require('./loader');
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
  loadCandidates,
  SELECTION_STAGES,
  IMPLEMENTED_STAGES,
  selectCandidatePool,
  compareCandidates,
};
