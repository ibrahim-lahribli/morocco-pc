/**
 * Engine 2 - Candidate component selector: pool selection (FOUNDATION ONLY).
 *
 * The selector eventually turns a candidate-selection input into candidate
 * components. The conceptual pipeline
 * (docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md, sections 2 and 11):
 *
 *   query
 *     ↓
 *   role/category eligibility        <- implemented here
 *     ↓
 *   candidate pool                   <- implemented here
 *     ↓
 *   hard compatibility filtering     <- future Engine 2 task (consumes Engine 1 verdicts)
 *     ↓
 *   budget filtering                 <- future Engine 2 task
 *     ↓
 *   assessment/scoring               <- future Engine 4 task
 *
 * Boundary note for future stages: GPU<->case and GPU<->PSU compatibility are
 * DERIVED from numeric specs; GPU connector normalization belongs to the
 * future data-loading layer and is intentionally out of scope here.
 *
 * Deterministic ordering (fixed tie-breaks; no randomness, no timestamps):
 *   1. role                component_role enum declaration order (ROLE_ORDER)
 *   2. product_id          ascending string comparison
 *   3. variant             candidates WITHOUT a variant first, then
 *                          product_variant_id ascending
 * Equal candidates keep their relative input order (stable sort), so the same
 * input + same DB state always yields the same pool.
 *
 * Pure: no database access, no framework.
 */

const { createCandidateSelectionInput } = require('./input');
const { createCandidate } = require('./candidate');
const { ROLE_ORDER } = require('./roles');
const { CandidateSelectionError, ERROR_CODES } = require('./errors');

/**
 * The conceptual selection stages, in pipeline order. Only the stages listed
 * in IMPLEMENTED_STAGES exist as executable code today.
 */
const SELECTION_STAGES = Object.freeze([
  'QUERY',
  'ROLE_CATEGORY_ELIGIBILITY',
  'CANDIDATE_POOL',
  'HARD_COMPATIBILITY_FILTERING',
  'BUDGET_FILTERING',
  'ASSESSMENT_SCORING',
]);

const IMPLEMENTED_STAGES = Object.freeze([
  'QUERY',
  'ROLE_CATEGORY_ELIGIBILITY',
  'CANDIDATE_POOL',
]);

/**
 * Deterministic comparison of two validated candidates.
 * @returns {number} negative if a sorts before b, positive if after, 0 if tied
 */
function compareCandidates(a, b) {
  const roleDelta =
    (ROLE_ORDER[a.component_role] ?? Number.MAX_SAFE_INTEGER) -
    (ROLE_ORDER[b.component_role] ?? Number.MAX_SAFE_INTEGER);
  if (roleDelta !== 0) return roleDelta;

  if (a.product_id !== b.product_id) {
    return a.product_id < b.product_id ? -1 : 1;
  }

  const variantA = a.product_variant_id;
  const variantB = b.product_variant_id;
  if (variantA === null && variantB !== null) return -1;
  if (variantA !== null && variantB === null) return 1;
  if (variantA !== variantB) return variantA < variantB ? -1 : 1;

  return 0;
}

/**
 * Select the candidate pool for a selection input.
 *
 * Implements: query -> role/category eligibility -> candidate pool.
 * Role eligibility: a candidate's component_role must be one of the input's
 * required_roles. Category eligibility: a candidate's category must be the
 * canonical category of its role - enforced when the candidate is validated,
 * so every surviving candidate is category-eligible by construction.
 *
 * Future stages (hard compatibility filtering, budget filtering) are NOT
 * implemented here; this pool is their input.
 *
 * @param {object} rawInput       candidate-selection input (or an already
 *                                validated frozen input; re-validated)
 * @param {Array<object>} rawCandidates  non-empty array of candidate records
 * @returns {object} frozen { input, pool } - pool sorted deterministically
 */
function selectCandidatePool(rawInput, rawCandidates) {
  const input = createCandidateSelectionInput(rawInput);

  if (!Array.isArray(rawCandidates)) {
    throw new CandidateSelectionError(
      ERROR_CODES.INVALID_INPUT,
      'Candidates must be an array of candidate records',
      'candidates'
    );
  }
  if (rawCandidates.length === 0) {
    throw new CandidateSelectionError(
      ERROR_CODES.EMPTY_CANDIDATE_POOL,
      'Candidate selection requires at least one candidate',
      'candidates'
    );
  }

  const candidates = rawCandidates.map((raw) => createCandidate(raw));

  const required = new Set(input.required_roles);
  const eligible = candidates.filter((candidate) => required.has(candidate.component_role));

  eligible.sort(compareCandidates);

  return Object.freeze({
    input,
    pool: Object.freeze(eligible),
  });
}

module.exports = { SELECTION_STAGES, IMPLEMENTED_STAGES, selectCandidatePool };
