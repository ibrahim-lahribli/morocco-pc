/**
 * Engine 2 - Candidate component selector: machine-readable errors.
 *
 * Deliberately minimal: one error class carrying a stable machine-readable
 * `code` and the offending `field`. These are input/contract validation codes,
 * not compatibility verdicts (compatibility reason codes live in Engine 1's
 * `REASON_CODES`).
 */

const ERROR_CODES = Object.freeze({
  // The selector input / candidate list is not the expected shape at all.
  INVALID_INPUT: 'INVALID_INPUT',
  // A required field is absent (undefined or null).
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  // A field is present but its value does not satisfy the contract.
  INVALID_FIELD_VALUE: 'INVALID_FIELD_VALUE',
  // A component_role is not part of the canonical role vocabulary.
  INVALID_COMPONENT_ROLE: 'INVALID_COMPONENT_ROLE',
  // The candidate category is not the category its role must come from.
  ROLE_CATEGORY_MISMATCH: 'ROLE_CATEGORY_MISMATCH',
  // A candidate record is not the expected shape.
  INVALID_CANDIDATE: 'INVALID_CANDIDATE',
  // Candidate selection was invoked without the candidates it requires.
  EMPTY_CANDIDATE_POOL: 'EMPTY_CANDIDATE_POOL',
});

class CandidateSelectionError extends Error {
  /**
   * @param {string} code    one of ERROR_CODES
   * @param {string} message human-readable description
   * @param {string|null} field offending input field, when applicable
   */
  constructor(code, message, field = null) {
    super(message);
    this.name = 'CandidateSelectionError';
    this.code = code;
    this.field = field;
  }

  /** Plain JSON-serializable form for logs / API responses. */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      field: this.field,
      message: this.message,
    };
  }
}

module.exports = { ERROR_CODES, CandidateSelectionError };
