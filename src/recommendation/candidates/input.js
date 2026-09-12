/**
 * Engine 2 - Candidate component selector: input contract.
 *
 * This is the ENGINE INPUT CONTRACT, not a copy of the `recommendation_query`
 * database row: the future data-loading layer will read a recommendation_query
 * row and construct this input from it. Only fields the selector (or its
 * documented future stages) need appear here.
 *
 *   budget_amount   finite number > 0
 *                   (mirrors chk_recommendation_query_budget_positive)
 *   currency        3-letter uppercase ISO 4217 code
 *                   (single-currency-per-query policy, section 7)
 *   use_case        non-empty string (DB column is TEXT, not an enum)
 *   required_roles  non-empty list of distinct valid COMPONENT_ROLES
 *
 * Pure validation: no database access, no framework.
 */

const { COMPONENT_ROLES } = require('./roles');
const { CandidateSelectionError, ERROR_CODES } = require('./errors');

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/**
 * Validate and freeze a candidate-selection input.
 *
 * Idempotent: an already-validated (frozen) input passes validation again and
 * yields an equal frozen input.
 *
 * @param {object} raw
 * @returns {object} frozen { budget_amount, currency, use_case, required_roles }
 */
function createCandidateSelectionInput(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(ERROR_CODES.INVALID_INPUT, null, 'Candidate selection input must be an object');
  }

  const { budget_amount, currency, use_case, required_roles } = raw;

  // --- budget_amount -------------------------------------------------------
  if (budget_amount === undefined || budget_amount === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'budget_amount',
      'Candidate selection input requires "budget_amount"'
    );
  }
  if (typeof budget_amount !== 'number' || !Number.isFinite(budget_amount)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'budget_amount',
      '"budget_amount" must be a finite number'
    );
  }
  if (budget_amount <= 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'budget_amount',
      '"budget_amount" must be greater than 0'
    );
  }

  // --- currency ------------------------------------------------------------
  if (currency === undefined || currency === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'currency', 'Candidate selection input requires "currency"');
  }
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'currency',
      '"currency" must be a 3-letter uppercase ISO 4217 code'
    );
  }

  // --- use_case ------------------------------------------------------------
  if (use_case === undefined || use_case === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'use_case', 'Candidate selection input requires "use_case"');
  }
  if (typeof use_case !== 'string' || use_case.trim().length === 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'use_case', '"use_case" must be a non-empty string');
  }

  // --- required_roles ------------------------------------------------------
  if (required_roles === undefined || required_roles === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'required_roles',
      'Candidate selection input requires "required_roles"'
    );
  }
  if (!Array.isArray(required_roles) || required_roles.length === 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'required_roles',
      '"required_roles" must be a non-empty array of component roles'
    );
  }
  for (const role of required_roles) {
    if (!COMPONENT_ROLES.includes(role)) {
      fail(
        ERROR_CODES.INVALID_COMPONENT_ROLE,
        'required_roles',
        `Unknown component role "${String(role)}" in "required_roles"`
      );
    }
  }
  if (new Set(required_roles).size !== required_roles.length) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'required_roles', '"required_roles" must not contain duplicates');
  }

  return Object.freeze({
    budget_amount,
    currency,
    use_case,
    required_roles: Object.freeze([...required_roles]),
  });
}

module.exports = { createCandidateSelectionInput };
