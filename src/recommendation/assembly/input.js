/**
 * Engine 3 - Build assembly: input contract.
 *
 * This is the ENGINE INPUT CONTRACT. It is not a copy of a database row and it
 * is deliberately NOT a reuse of Engine 2's `createCandidateSelectionInput`:
 * Engine 3 consumes a wider universe (Engine 2D verdicts, the query contract,
 * GPU-requirement inputs, output caps and the price carrier) and has different
 * freezing / ownership requirements.
 *
 * Consumes:  raw Engine3Input - a plain object carrying exactly nine fields.
 * Produces:  frozen Engine3Input.
 *
 * Responsibilities
 *   - structural validation of the nine-field contract, fail-fast
 *   - freezing the returned value, plus frozen copies of the arrays and maps
 *     this layer is allowed to own
 *
 * Explicit NON-responsibilities (deliberately absent from this module)
 *   - no database access, no framework
 *   - no candidate / verdict status interpretation (PASS | UNKNOWN | REJECT)
 *   - no candidate grouping or per-role bucketing
 *   - no GPU policy resolution (`gpu_required_use_cases` / iGPU)
 *   - no price selection and no validation of price entries (owned by prices.js)
 *   - no quality assessment, no ordering, no tie-breaking
 *   - no build expansion or traversal, no output-cap application
 *   - no sorting
 *   - no persistence
 *
 * Field contract
 *   results                   Array. May be empty: Engine 3 is allowed to
 *                             return { builds: [] }. Individual entries are NOT
 *                             inspected here - verdict shape belongs to the
 *                             assembly layer.
 *   budget_amount             finite number > 0
 *   currency                  3-letter uppercase ISO 4217 code
 *   required_roles            non-empty list of distinct valid COMPONENT_ROLES.
 *                             Order is preserved; it is NOT a traversal order.
 *   use_case                  non-blank string, preserved verbatim. Whitespace
 *                             is significant: strict matching happens later.
 *   gpu_required_use_cases    Array of non-blank strings, preserved verbatim.
 *                             Duplicates allowed. Never defaulted to [].
 *   integrated_gpu_present    { [cpu_product_id]: true | false | null }.
 *                             Absent CPU keys are valid.
 *   candidate_caps            { top_k_per_role, max_builds_per_query } - both
 *                             positive integers. Validated ONLY, never applied.
 *   prices                    object. Top-level shape only: the price-carrier
 *                             contract is owned by prices.js. The reference is
 *                             preserved and entries are NOT frozen here.
 *
 * Pure: no database access, no framework.
 */

const { isValidComponentRole } = require('../candidates/roles');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** The frozen Engine 3 top-level contract vocabulary, in documented order. */
const ENGINE3_INPUT_FIELDS = Object.freeze([
  'results',
  'budget_amount',
  'currency',
  'required_roles',
  'use_case',
  'gpu_required_use_cases',
  'integrated_gpu_present',
  'candidate_caps',
  'prices',
]);

/** `candidate_caps` is a strict two-field contract. */
const CANDIDATE_CAPS_FIELDS = Object.freeze([
  'top_k_per_role',
  'max_builds_per_query',
]);

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/**
 * Validate and freeze an Engine 3 input.
 *
 * Fail-fast: the first detected contract violation throws immediately.
 * Idempotent: an already-validated (frozen) input passes validation again and
 * yields an equal frozen input. Values are never normalized - no trim, no case
 * folding, no coercion, no defaulting, no aliasing; caller-owned objects are
 * never mutated.
 *
 * @param {object} raw
 * @returns {object} frozen Engine3Input
 */
function validateEngine3Input(raw) {
  // --- top-level shape -----------------------------------------------------
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(ERROR_CODES.INVALID_INPUT, null, 'Engine 3 input must be a plain object');
  }

  // --- unknown top-level keys ---------------------------------------------
  for (const key of Object.keys(raw)) {
    if (!ENGINE3_INPUT_FIELDS.includes(key)) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, key, `Unknown Engine 3 input field "${key}"`);
    }
  }

  // --- presence of all nine fields (own property, never truthiness) -------
  for (const field of ENGINE3_INPUT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) {
      fail(ERROR_CODES.MISSING_REQUIRED_FIELD, field, `Engine 3 input requires "${field}"`);
    }
  }

  const {
    results,
    budget_amount,
    currency,
    required_roles,
    use_case,
    gpu_required_use_cases,
    integrated_gpu_present,
    candidate_caps,
    prices,
  } = raw;

  // --- results -------------------------------------------------------------
  // An empty array is valid. Statuses / roles / relationships are NOT read
  // here; EMPTY_CANDIDATE_POOL is never raised by this layer.
  if (!Array.isArray(results)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'results', '"results" must be an array');
  }

  // --- budget_amount -------------------------------------------------------
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
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'currency',
      '"currency" must be a 3-letter uppercase ISO 4217 code'
    );
  }

  // --- required_roles ------------------------------------------------------
  if (!Array.isArray(required_roles) || required_roles.length === 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'required_roles',
      '"required_roles" must be a non-empty array of component roles'
    );
  }
  for (const role of required_roles) {
    if (!isValidComponentRole(role)) {
      fail(
        ERROR_CODES.INVALID_COMPONENT_ROLE,
        'required_roles',
        `Unknown component role "${String(role)}" in "required_roles"`
      );
    }
  }
  if (new Set(required_roles).size !== required_roles.length) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'required_roles',
      '"required_roles" must not contain duplicates'
    );
  }

  // --- use_case ------------------------------------------------------------
  // Stored verbatim: surrounding whitespace is caller-provided semantics.
  if (typeof use_case !== 'string' || use_case.trim().length === 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'use_case', '"use_case" must be a non-blank string');
  }

  // --- gpu_required_use_cases ---------------------------------------------
  // Strictly an array and never defaulted; entries are preserved byte-for-byte
  // because policy matching is a strict (untrimmed) comparison.
  if (!Array.isArray(gpu_required_use_cases)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'gpu_required_use_cases',
      '"gpu_required_use_cases" must be an array'
    );
  }
  for (const entry of gpu_required_use_cases) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'gpu_required_use_cases',
        '"gpu_required_use_cases" entries must be non-blank strings'
      );
    }
  }

  // --- integrated_gpu_present ---------------------------------------------
  if (
    integrated_gpu_present === null ||
    typeof integrated_gpu_present !== 'object' ||
    Array.isArray(integrated_gpu_present)
  ) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'integrated_gpu_present',
      '"integrated_gpu_present" must be an object map'
    );
  }
  for (const cpuId of Object.keys(integrated_gpu_present)) {
    if (cpuId.length === 0) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'integrated_gpu_present',
        '"integrated_gpu_present" keys must be non-empty strings'
      );
    }
    const value = integrated_gpu_present[cpuId];
    if (value !== true && value !== false && value !== null) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'integrated_gpu_present',
        `"integrated_gpu_present.${cpuId}" must be true, false or null`
      );
    }
  }

  // --- candidate_caps ------------------------------------------------------
  // Validated only. Applying `top_k_per_role` / `max_builds_per_query` is an
  // assembly concern, never an input-layer concern.
  if (
    candidate_caps === null ||
    typeof candidate_caps !== 'object' ||
    Array.isArray(candidate_caps)
  ) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'candidate_caps',
      '"candidate_caps" must be an object with exactly "top_k_per_role" and "max_builds_per_query"'
    );
  }
  for (const key of Object.keys(candidate_caps)) {
    if (!CANDIDATE_CAPS_FIELDS.includes(key)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        `candidate_caps.${key}`,
        `Unknown "candidate_caps" field "${key}"`
      );
    }
  }
  for (const key of CANDIDATE_CAPS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(candidate_caps, key)) {
      fail(
        ERROR_CODES.MISSING_REQUIRED_FIELD,
        `candidate_caps.${key}`,
        `"candidate_caps" requires "${key}"`
      );
    }
    const value = candidate_caps[key];
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value <= 0
    ) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        `candidate_caps.${key}`,
        `"candidate_caps.${key}" must be a positive integer`
      );
    }
  }

  // --- prices (top-level shape only) --------------------------------------
  // Entry shape, currency matching and price-carrier freezing are owned by
  // prices.js. The reference is preserved here, not copied and not frozen.
  if (prices === null || typeof prices !== 'object' || Array.isArray(prices)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'prices', '"prices" must be an object');
  }

  // --- frozen result -------------------------------------------------------
  // Shallow copies keep caller-owned objects untouched while guaranteeing the
  // returned structure is immutable. `results` entries and `prices` entries are
  // intentionally NOT deep-frozen.
  return Object.freeze({
    results: Object.freeze([...results]),
    budget_amount,
    currency,
    required_roles: Object.freeze([...required_roles]),
    use_case,
    gpu_required_use_cases: Object.freeze([...gpu_required_use_cases]),
    integrated_gpu_present: Object.freeze({ ...integrated_gpu_present }),
    candidate_caps: Object.freeze({
      top_k_per_role: candidate_caps.top_k_per_role,
      max_builds_per_query: candidate_caps.max_builds_per_query,
    }),
    prices,
  });
}

module.exports = { validateEngine3Input };
