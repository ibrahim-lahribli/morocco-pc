/**
 * Engine 2 - Candidate component selector: candidate record contract.
 *
 * A candidate is one product / product-variant that could participate in a
 * recommendation. It preserves enough identity to connect back to Layer 1
 * (product / product_variant / product_category) and forward to
 * build_component (component_role).
 *
 * Price and score are deliberately absent: pricing belongs to offer
 * pre-selection and scores to Engine 4; neither is needed for the
 * role/category eligibility stage.
 *
 * Pure validation: no database access, no framework.
 */

const {
  isValidComponentRole,
  isValidProductCategory,
  expectedCategoryForRole,
} = require('./roles');
const { CandidateSelectionError, ERROR_CODES } = require('./errors');

/**
 * Validate and freeze one candidate record.
 *
 * @param {object} raw
 * @param {string} raw.product_id         required, non-empty (Layer 1 product)
 * @param {string|null} [raw.product_variant_id] optional; omitted/undefined
 *                                                normalizes to null
 * @param {string} raw.category           a PRODUCT_CATEGORIES value
 * @param {string} raw.component_role     a COMPONENT_ROLES value whose
 *                                        canonical category is `category`
 * @returns {object} frozen { product_id, product_variant_id, category, component_role }
 */
function createCandidate(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CandidateSelectionError(ERROR_CODES.INVALID_CANDIDATE, 'Candidate must be an object', null);
  }

  const { product_id, product_variant_id, category, component_role } = raw;

  // --- product_id ----------------------------------------------------------
  if (product_id === undefined || product_id === null) {
    throw new CandidateSelectionError(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'Candidate requires "product_id"',
      'product_id'
    );
  }
  if (typeof product_id !== 'string' || product_id.length === 0) {
    throw new CandidateSelectionError(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'Candidate "product_id" must be a non-empty string',
      'product_id'
    );
  }

  // --- product_variant_id (optional, nullable) ------------------------------
  const variant = product_variant_id === undefined ? null : product_variant_id;
  if (variant !== null && (typeof variant !== 'string' || variant.length === 0)) {
    throw new CandidateSelectionError(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'Candidate "product_variant_id" must be a non-empty string or null',
      'product_variant_id'
    );
  }

  // --- category ------------------------------------------------------------
  if (category === undefined || category === null) {
    throw new CandidateSelectionError(ERROR_CODES.MISSING_REQUIRED_FIELD, 'Candidate requires "category"', 'category');
  }
  if (!isValidProductCategory(category)) {
    throw new CandidateSelectionError(
      ERROR_CODES.INVALID_FIELD_VALUE,
      `Invalid product category "${String(category)}" for candidate`,
      'category'
    );
  }

  // --- component_role ------------------------------------------------------
  if (component_role === undefined || component_role === null) {
    throw new CandidateSelectionError(
      ERROR_CODES.INVALID_COMPONENT_ROLE,
      'Candidate requires "component_role"',
      'component_role'
    );
  }
  if (!isValidComponentRole(component_role)) {
    throw new CandidateSelectionError(
      ERROR_CODES.INVALID_COMPONENT_ROLE,
      `Invalid component role "${String(component_role)}" for candidate`,
      'component_role'
    );
  }

  // --- product/category relationship ---------------------------------------
  const expectedCategory = expectedCategoryForRole(component_role);
  if (category !== expectedCategory) {
    throw new CandidateSelectionError(
      ERROR_CODES.ROLE_CATEGORY_MISMATCH,
      `Component role "${component_role}" requires product category "${expectedCategory}" but got "${category}"`,
      'category'
    );
  }

  return Object.freeze({
    product_id,
    product_variant_id: variant,
    category,
    component_role,
  });
}

module.exports = { createCandidate };
