/**
 * Engine 2D - Filtering context loader (foundation).
 *
 * Boundary: turns the Engine 2C candidate-pool result into the deterministic,
 * frozen Engine 2D context consumed by the hard-compatibility filtering stage
 * (docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md, section 2, stage 2).
 *
 *   Engine 2C candidate-pool result ({ input, pool })
 *         |  validate through the existing Engine 2 contracts
 *         |  (createCandidateSelectionInput, createCandidate, variant rules)
 *         v
 *   Engine 2D filtering context
 *     candidates         - candidate records bucketed by component_role in
 *                          canonical role order (Engine 2C identity preserved)
 *     specs              - foundation: empty; populated by the DB-backed stage
 *     platform_by_socket - foundation: empty; populated by the DB-backed stage
 *     compat             - foundation: empty keys; populated by the DB-backed
 *                          stage (cpu_motherboard_exact, cpu_motherboard_family,
 *                          cooler_socket, case_form_factor, case_radiator,
 *                          platform_memory)
 *
 * FOUNDATION SCOPE. This module establishes only the API, the validation
 * boundary, the deterministic structure, and the immutability contract. It
 * deliberately does NOT yet: query the database (specs, compatibility rows,
 * platform lookups), normalize PostgreSQL rows, call Engine 1 resolvers,
 * compute compatibility verdicts, reject candidates, filter by budget, score,
 * assemble builds, persist, or select final components.
 *
 * Candidate contract: the Engine 2C identity
 * { product_id, product_variant_id, category, component_role } is preserved
 * exactly - each pool entry is re-validated (idempotently) through
 * createCandidate plus the Engine 2B/2C variant rules (GPU => variant-keyed,
 * non-GPU => product-keyed). No second candidate schema, no extra fields.
 *
 * Determinism: buckets are created in canonical COMPONENT_ROLES order and
 * compat keys in the fixed CONTEXT_COMPAT_KEYS order; within a bucket the
 * Engine 2C pool order is preserved (the pool itself is deterministically
 * ordered by Engine 2C: role, product_id, variant ASC, NULLS FIRST).
 *
 * Immutability contract: the returned context is frozen, and every nested
 * object/collection this module creates is frozen at creation, so the whole
 * returned tree is immutable without a generic deep-freeze utility. The
 * DB-backed Engine 2D stage must REPLACE these frozen structures with newly
 * built frozen ones; it must never mutate them in place.
 *
 * Database policy: the foundation performs no queries. When the DB-backed
 * stage arrives, PostgreSQL errors must propagate to the caller - they are
 * never silently swallowed (same policy as Engine 2B loadCandidates).
 *
 * Errors: the existing Engine 2 CandidateSelectionError / ERROR_CODES are
 * reused; no new error hierarchy.
 */

const { COMPONENT_ROLES } = require('../candidates/roles');
const { createCandidateSelectionInput } = require('../candidates/input');
const { createCandidate } = require('../candidates/candidate');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** GPU is variant-keyed; every other role is product-keyed (Engine 2B/2C). */
const GPU_ROLE = 'GPU';

/**
 * Compat sub-context keys, in deterministic canonical order. Each will map a
 * compatibility relationship to its loaded rows / verdict inputs once the
 * DB-backed Engine 2D stage populates them.
 */
const CONTEXT_COMPAT_KEYS = Object.freeze([
  'cpu_motherboard_exact',
  'cpu_motherboard_family',
  'cooler_socket',
  'case_form_factor',
  'case_radiator',
  'platform_memory',
]);

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/**
 * Validate the Engine 2C candidate-pool result: an object { input, pool } with
 * a valid Engine 2A selection input and a non-empty candidate array.
 *
 * @param {object} poolResult { input, pool } as produced by selectCandidatePool
 */
function validateCandidatePoolResult(poolResult) {
  if (poolResult === null || typeof poolResult !== 'object' || Array.isArray(poolResult)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'candidatePoolResult',
      'Filtering context requires an Engine 2C candidate-pool result object'
    );
  }

  // The Engine 2C result carries the validated selection input; re-validation
  // is idempotent for already-validated (frozen) inputs.
  if (poolResult.input === undefined || poolResult.input === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'input', 'Engine 2C candidate-pool result requires "input"');
  }
  createCandidateSelectionInput(poolResult.input);

  if (poolResult.pool === undefined || poolResult.pool === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'pool', 'Engine 2C candidate-pool result requires "pool"');
  }
  if (!Array.isArray(poolResult.pool)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'pool',
      'Engine 2C candidate-pool result "pool" must be an array of candidate records'
    );
  }
  if (poolResult.pool.length === 0) {
    fail(ERROR_CODES.EMPTY_CANDIDATE_POOL, 'pool', 'Filtering context requires a non-empty candidate pool');
  }
}

/** Same db contract as Engine 2B loadCandidates: pg-compatible db.query(sql, params). */
function validateDatabaseClient(db) {
  if (db === null || typeof db !== 'object' || typeof db.query !== 'function') {
    fail(ERROR_CODES.INVALID_INPUT, 'db', 'loadFilteringContext requires a database client exposing query()');
  }
}

/**
 * Engine 2B/2C variant-identity rules, re-enforced at this boundary without
 * normalization (same contract and wording as Engine 2C).
 */
function enforceVariantIdentity(candidate) {
  if (candidate.component_role === GPU_ROLE && candidate.product_variant_id === null) {
    fail(ERROR_CODES.INVALID_CANDIDATE, 'product_variant_id', 'GPU candidates must carry a non-null product_variant_id');
  }
  if (candidate.component_role !== GPU_ROLE && candidate.product_variant_id !== null) {
    fail(ERROR_CODES.INVALID_CANDIDATE, 'product_variant_id', 'Product-keyed candidate must carry a null product_variant_id');
  }
}

/**
 * Bucket the pool by component_role. Every entry is re-validated through the
 * Engine 2A candidate contract, so bucket contents are frozen candidate
 * records owned by this module. Bucket keys are created in canonical
 * COMPONENT_ROLES order; within a bucket the pool order is preserved.
 *
 * @param {Array<object>} pool non-empty Engine 2C pool
 * @returns {object} frozen { [role]: frozen candidate[] } for every role
 */
function buildRoleBuckets(pool) {
  const buckets = {};
  for (const role of COMPONENT_ROLES) {
    buckets[role] = [];
  }

  for (const raw of pool) {
    const candidate = createCandidate(raw);
    enforceVariantIdentity(candidate);
    buckets[candidate.component_role].push(candidate);
  }

  for (const role of COMPONENT_ROLES) {
    buckets[role] = Object.freeze(buckets[role]);
  }
  return Object.freeze(buckets);
}

/**
 * Load the Engine 2D filtering context for an Engine 2C candidate-pool result.
 *
 * Foundation behavior: validates both arguments, buckets the pool by role,
 * and returns the frozen deterministic context skeleton. No database access,
 * no normalization, no verdicts, no filtering, no scoring.
 *
 * @param {object} candidatePoolResult  Engine 2C result { input, pool }
 * @param {object} db  pg-compatible client exposing db.query(sql, params);
 *                     validated here, used by the future DB-backed stage
 * @returns {Promise<object>} frozen { candidates, specs, platform_by_socket, compat }
 */
async function loadFilteringContext(candidatePoolResult, db) {
  validateCandidatePoolResult(candidatePoolResult);
  validateDatabaseClient(db);

  const candidates = buildRoleBuckets(candidatePoolResult.pool);

  // Foundation placeholders: created and frozen here so the returned context
  // is fully immutable from day one. The DB-backed Engine 2D stage replaces
  // these structures with populated frozen ones; it never mutates them.
  const specs = Object.freeze({});
  const platform_by_socket = Object.freeze({});
  const compat = {};
  for (const key of CONTEXT_COMPAT_KEYS) {
    compat[key] = Object.freeze({});
  }

  return Object.freeze({
    candidates,
    specs,
    platform_by_socket,
    compat: Object.freeze(compat),
  });
}

module.exports = { loadFilteringContext, CONTEXT_COMPAT_KEYS };
