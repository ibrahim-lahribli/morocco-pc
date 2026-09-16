/**
 * Scoring model - Decision 11 loader.
 *
 * Boundary: turns the pinned `scoring_model` row (selected by
 * `recommendation_query.scoring_model_id`) into the frozen, validated
 * scoring-model domain object consumed by Engine 3 (and, in the future, by
 * Engine 4 and later stages).
 *
 *   pinned scoring_model_id
 *         |  ONE exact-ID parameterized query over scoring_model
 *         |  (no is_active discovery, no substitution, no fallback)
 *         v
 *   raw scoring_model row
 *         |  row missing            -> SCORING_MODEL_UNAVAILABLE (fail fast)
 *         |  row is_active != true  -> SCORING_MODEL_UNAVAILABLE (fail fast)
 *         |  row active             -> validate the COMPLETE Decision 3(a)
 *         |                           configuration (./configuration)
 *         v
 *   frozen { id, name, version, description, configuration,
 *            is_active, created_at, updated_at }
 *
 * Decision 11 Rule 1: the model is selected ONLY by the pinned foreign key.
 * `is_active` is an eligibility check, never a model-discovery mechanism, and
 * the loader never discovers the active model globally, never prefers the
 * latest model, never selects by name/version, and never falls back to another
 * model. The query deliberately omits the eligibility predicate from the WHERE
 * clause so the loader can distinguish "missing" from "inactive".
 *
 * Decision 11 Rule 3 + Rule 6: this module validates the scoring model AS a
 * model/configuration (the DB-to-validated-domain boundary). Engine 3 keeps
 * validating its own input contract; GPU policy stays in the pure GPU-policy
 * module. Nothing here redefines Engine 3.
 *
 * Scope exclusions: no iGPU sourcing, no CPU iGPU presence map, no
 * `top_k_per_role` application (validated and preserved only), no scoring, no
 * ranking, no assembly, no persistence, no orchestrator.
 *
 * Database policy: parameterized SQL only ($1 is the pinned model id, never
 * interpolated); exactly one query per call. PostgreSQL errors propagate to the
 * caller unchanged - never swallowed and never converted into
 * SCORING_MODEL_UNAVAILABLE (same policy as Engine 2B / 2D / Stage 1).
 *
 * Immutability: the returned model is deeply frozen and built from fresh
 * structures; the PostgreSQL row and every caller-owned object are left
 * untouched (never mutated, never frozen).
 *
 * Errors: the existing Engine 2 CandidateSelectionError / ERROR_CODES are
 * reused; no new error class is introduced.
 */

'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const { validateScoringModelConfiguration } = require('./configuration');

/**
 * Single Decision 11 query (Rule 2). Parameterized only ($1 = pinned model id).
 * Exactly the eight contract columns, exactly the pinned-ID predicate - the
 * eligibility filter is NOT folded into the lookup.
 */
const SELECT_SCORING_MODEL_SQL = [
  'SELECT id, name, version, description, configuration, is_active, created_at, updated_at',
  'FROM scoring_model',
  'WHERE id = $1',
].join(' ');

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/**
 * Validate the loader's own pinned-id argument. Same convention as the Engine 2
 * input contracts: absent -> MISSING_REQUIRED_FIELD, wrong value ->
 * INVALID_FIELD_VALUE. The id is never normalized.
 */
function validateScoringModelId(scoringModelId) {
  if (scoringModelId === undefined || scoringModelId === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'scoring_model_id',
      'loadScoringModel requires a pinned "scoring_model_id"'
    );
  }
  if (typeof scoringModelId !== 'string' || scoringModelId.length === 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'scoring_model_id',
      '"scoring_model_id" must be a non-empty string'
    );
  }
}

/** Same db contract as Engine 2B / 2D / Stage 1: pg-compatible db.query(sql, params). */
function validateDatabaseClient(db) {
  if (db === null || typeof db !== 'object' || typeof db.query !== 'function') {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'db',
      'loadScoringModel requires a database client exposing query()'
    );
  }
}

/**
 * Decision 11 Rule 5: both "no row" and "row not active" fail fast with the
 * same dedicated code. The pinned model id is carried in the structured `field`
 * slot; no raw database details and no row contents are exposed.
 */
function failUnavailable(scoringModelId, reason) {
  fail(
    ERROR_CODES.SCORING_MODEL_UNAVAILABLE,
    scoringModelId,
    `Pinned scoring model "${scoringModelId}" is unavailable: ${reason}`
  );
}

/** Small private recursive freezer; no shared helper module is created.
 *  Caller-owned leaf objects (e.g. row timestamps) are never frozen. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  Object.freeze(value);
  return value;
}

/**
 * Load and validate the pinned scoring model.
 *
 * Exactly one parameterized query is issued. A missing row and an inactive row
 * both fail fast with SCORING_MODEL_UNAVAILABLE; an active row must carry the
 * complete valid Decision 3(a) configuration. `top_k_per_role` is preserved but
 * deliberately NOT applied, and no GPU/iGPU behavior is introduced.
 *
 * @param {string} scoringModelId pinned scoring_model.id (recommendation_query FK)
 * @param {object} db pg-compatible client exposing db.query(sql, params)
 * @returns {Promise<object>} deeply frozen validated scoring model
 */
async function loadScoringModel(scoringModelId, db) {
  validateScoringModelId(scoringModelId);
  validateDatabaseClient(db);

  // PostgreSQL errors propagate unchanged: no try/catch, no conversion.
  const result = await db.query(SELECT_SCORING_MODEL_SQL, [scoringModelId]);
  const rows = result && Array.isArray(result.rows) ? result.rows : [];

  if (rows.length === 0) {
    failUnavailable(scoringModelId, 'no scoring_model row exists for the pinned id');
  }

  const row = rows[0];

  // Eligibility check, NOT discovery: only strict `true` is active.
  if (row.is_active !== true) {
    failUnavailable(scoringModelId, 'the pinned scoring_model row is not active');
  }

  // Decision 11 Rule 3: the loader owns validation of the COMPLETE Decision
  // 3(a) configuration (NULL -> MISSING_REQUIRED_FIELD `configuration`).
  const configuration = validateScoringModelConfiguration(row.configuration);

  // Model identity and metadata are preserved exactly as returned by the query
  // (no coercion, no renaming, no defaulting); only the configuration is
  // replaced by its validated deep-frozen copy.
  return deepFreeze({
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    configuration,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

module.exports = { loadScoringModel, SELECT_SCORING_MODEL_SQL };