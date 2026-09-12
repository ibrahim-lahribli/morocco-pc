/**
 * Engine 2C - Candidate pool selection (canonical selector).
 *
 * Consumes:
 *   - validated Engine 2A selection input (createCandidateSelectionInput)
 *   - candidate records produced by Engine 2B (createCandidate contract)
 *
 * Returns the deterministic candidate pool eligible for the requested roles.
 *
 * The conceptual pipeline
 * (docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md, sections 2 and 11):
 *
 *   query
 *     ↓
 *   role/category eligibility        <- implemented here (Engine 2A contract)
 *     ↓
 *   candidate pool                   <- implemented here (Engine 2C)
 *     ↓
 *   hard compatibility filtering     <- future stage (consumes Engine 1 verdicts)
 *     ↓
 *   budget filtering                 <- future stage
 *     ↓
 *   assessment/scoring               <- future Engine 4 task
 *
 * Eligibility rules (Engine 2C):
 *   1. component_role is in input.required_roles (pool may hold many per role).
 *   2. category exactly matches ROLE_CATEGORIES[component_role] (enforced by
 *      createCandidate, so survivors are category-eligible by construction).
 *   3. product_id / component_role / category satisfy the candidate contract.
 *   4. Variant identity follows Engine 2B rules (enforced here, never
 *      normalized):
 *        GPU     -> product_variant_id MUST NOT be null (variant-level).
 *        non-GPU -> product_variant_id MUST be null (product-level).
 *
 * Empty-pool contract (global-only): EMPTY_CANDIDATE_POOL is thrown when the
 * raw candidate list is empty OR when filtering yields zero eligible
 * candidates. A partially satisfiable request returns its partial pool; roles
 * are never fabricated, substituted, or silently dropped from the request.
 *
 * Duplicate handling: canonical identity is
 * (product_id, product_variant_id, component_role). Exact duplicate identities
 * are deduplicated deterministically (first occurrence wins); distinct GPU
 * variants (same product_id, different variant) are always retained.
 *
 * Deterministic ordering (fixed tie-breaks; no randomness, no timestamps):
 *   1. role                component_role enum declaration order (ROLE_ORDER)
 *   2. product_id          ascending string comparison
 *   3. variant             candidates WITHOUT a variant first, then
 *                          product_variant_id ascending
 * Equal candidates keep their relative input order (stable sort), so the same
 * input always yields the same pool.
 *
 * Non-responsibilities: no database, filesystem, network, time, randomness,
 * compatibility resolvers, budget/price, benchmark, scoring, ranking, build
 * assembly, or persistence.
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
 * Implements Engine 2C: query -> role/category eligibility -> candidate pool.
 * Role eligibility: a candidate's component_role must be one of the input's
 * required_roles (many candidates per role are retained; winner selection is
 * a later stage). Category eligibility: a candidate's category must be the
 * canonical category of its role - enforced when the candidate is validated,
 * so every surviving candidate is category-eligible by construction.
 * Variant identity: GPU candidates must carry a variant id; non-GPU
 * candidates must not (Engine 2B rules, enforced here without normalization).
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

  // Engine 2B variant-identity rules, enforced without silent normalization.
  for (const candidate of candidates) {
    if (candidate.component_role === 'GPU' && candidate.product_variant_id === null) {
      throw new CandidateSelectionError(
        ERROR_CODES.INVALID_CANDIDATE,
        'GPU candidates must carry a non-null product_variant_id',
        'product_variant_id'
      );
    }
    if (candidate.component_role !== 'GPU' && candidate.product_variant_id !== null) {
      throw new CandidateSelectionError(
        ERROR_CODES.INVALID_CANDIDATE,
        'Product-keyed candidate must carry a null product_variant_id',
        'product_variant_id'
      );
    }
  }

  const required = new Set(input.required_roles);
  const eligible = candidates.filter((candidate) => required.has(candidate.component_role));

  if (eligible.length === 0) {
    throw new CandidateSelectionError(
      ERROR_CODES.EMPTY_CANDIDATE_POOL,
      'No eligible candidates for the requested roles',
      'candidates'
    );
  }

  // Deduplicate exact canonical identities deterministically (first wins).
  // Key includes the variant so distinct GPU variants are never collapsed.
  const seen = new Set();
  const deduped = [];
  for (const candidate of eligible) {
    const key = JSON.stringify([
      candidate.product_id,
      candidate.product_variant_id,
      candidate.component_role,
    ]);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(candidate);
    }
  }

  deduped.sort(compareCandidates);

  return Object.freeze({
    input,
    pool: Object.freeze(deduped),
  });
}

module.exports = { SELECTION_STAGES, IMPLEMENTED_STAGES, selectCandidatePool };
