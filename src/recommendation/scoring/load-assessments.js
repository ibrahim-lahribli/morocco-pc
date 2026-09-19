/**
 * Engine 4 - component_assessment loader (Decision 13 STEP 1 data source).
 *
 * Boundary: turns the `component_assessment` rows of a fixed product id set
 * into the frozen, deterministic assessment map consumed by the pure Engine 4
 * scoring steps (STEP 1 ./effective-score, STEP 2 ./candidate-score, STEP 3
 * ./build-score). This is the FIRST and ONLY production reader of
 * component_assessment; migration 008 owns the schema (no unique constraint
 * on (product_id, assessment_type), nullable score, nullable confidence).
 *
 *   product id set (from candidates/builds - candidate-scoped loading, never
 *                   the whole catalog, same policy as Engine 2D B2-B)
 *         |  ONE parameterized query over component_assessment
 *         |  (ANY($1::uuid[]); deterministic ORDER BY; CURRENT_TIMESTAMP)
 *         v
 *   raw component_assessment rows
 *         |  row-shape validation (fail fast on bad DB data)
 *         v
 *   frozen { assessments: { [product_id]: frozen [frozen row, ...] },
 *            loaded_at: strict UTC ISO decision timestamp | null }
 *
 * Loader contract:
 *   - EVERY row of the requested products is returned. Row selection for the
 *     legal multi-row-per-(product, type) case is deliberately NOT owned
 *     here: the pure `selectAssessmentRow` (./effective-score) applies the
 *     policy to the loader's order (DECISION REQUIRED note there).
 *   - An unassessed product is NOT an error: its key is simply absent from
 *     the map. Decision 13 STEP 1 owns the no-evidence branch.
 *   - `loaded_at` is the single CURRENT_TIMESTAMP decision timestamp returned
 *     by the query (Stage 1 `price_checked_at` convention, offers/select.js).
 *     The JS clock is NEVER read: the pure steps take `nowMs` explicitly,
 *     derived from this value. When the result set is EMPTY no decision
 *     timestamp exists (it rides on the rows), so `loaded_at` is null - and
 *     `nowMs` is then unused downstream (every type takes the no-evidence
 *     branch, which needs no timestamp).
 *
 * Timestamp policy (pinned): migration 008 declares `assessed_at TIMESTAMP`
 * WITHOUT a time zone. The query converts the naive value with
 * `AT TIME ZONE 'UTC'` - the naive wall time is read as UTC - so every
 * derived epoch-millisecond value is deterministic regardless of the process
 * time zone. Future timestamps are valid instants and are preserved as-is
 * (Decision 7 precedent: future values accepted as fresh).
 *
 * Ordering/determinism: the SQL orders every row (product_id ASC,
 * assessment_type ASC, assessed_at DESC, id ASC) and the map keys are
 * inserted in sorted product order, so the same DB state always yields the
 * same frozen result. The row order is what makes the DECISION REQUIRED
 * newest-row policy of `selectAssessmentRow` deterministic.
 *
 * Database policy: parameterized SQL only ($1 = the product id array, never
 * interpolated); exactly one query per call. PostgreSQL errors propagate to
 * the caller unchanged - never swallowed, never converted (same policy as
 * Engine 2B / 2D / Stage 1 / Decision 11).
 *
 * Immutability: the returned value is deeply frozen and built from fresh
 * structures; caller-owned objects are never mutated, never frozen.
 *
 * Errors: the existing Engine 2 CandidateSelectionError / ERROR_CODES are
 * reused; no new error class and no new error code is introduced.
 *
 * Scope exclusions: no scoring arithmetic (the pure steps own it), no
 * row-selection policy (./effective-score owns it), no role/type weights, no
 * compatibility evaluation, no ranking, no top-K, no assembly, no
 * persistence, no orchestrator.
 */

'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/**
 * Single Engine 4 assessment query. Parameterized only ($1 = product ids).
 * `assessed_at` is a naive TIMESTAMP (migration 008): `AT TIME ZONE 'UTC'`
 * pins the naive wall time to its UTC instant deterministically.
 * CURRENT_TIMESTAMP supplies the decision timestamp (no JS clock read).
 */
const SELECT_COMPONENT_ASSESSMENTS_SQL = [
  'SELECT product_id, assessment_type, score, confidence,',
  "       assessed_at AT TIME ZONE 'UTC' AS assessed_at,",
  '       CURRENT_TIMESTAMP AS loaded_at',
  'FROM component_assessment',
  'WHERE product_id = ANY($1::uuid[])',
  'ORDER BY product_id ASC, assessment_type ASC, assessed_at DESC, id ASC',
].join(' ');

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/** Same db contract as Engine 2B / 2D / Stage 1 / Decision 11. */
function validateDatabaseClient(db) {
  if (db === null || typeof db !== 'object' || typeof db.query !== 'function') {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'db',
      'loadComponentAssessments requires a database client exposing query()'
    );
  }
}

/**
 * Validate the requested product id set: a non-empty array of non-empty
 * strings. Duplicates are tolerated (the exact set is deduped and sorted for
 * determinism). The empty list is rejected: scoring an empty candidate/build
 * set never reaches the loader (empty builds are scored as empty results
 * without a query).
 */
function validateProductIds(productIds) {
  if (productIds === undefined || productIds === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'product_ids', '"product_ids" is required');
  }
  if (!Array.isArray(productIds) || productIds.length === 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'product_ids',
      '"product_ids" must be a non-empty array of product id strings'
    );
  }
  for (const id of productIds) {
    if (typeof id !== 'string' || id.length === 0) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'product_ids',
        '"product_ids" entries must be non-empty strings'
      );
    }
  }
}

/** Convert the query decision timestamp to strict UTC ISO (Stage 1 convention). */
function toDecisionIso(value, field) {
  let iso = null;
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) {
      iso = value.toISOString();
    }
  } else if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      iso = parsed.toISOString();
    }
  }
  if (iso === null) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      field,
      'The assessment decision timestamp must be a valid timestamp'
    );
  }
  return iso;
}

/** Parse a timestamp to epoch milliseconds, or null when unparseable. */
function toEpochMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/**
 * Validate one raw component_assessment row and return the intermediate
 * grouping record. Score conversion follows the Stage 1 NUMERIC-string
 * convention (Number()); the 0..100 CHECK of migration 008 is re-enforced.
 */
function normalizeAssessmentRow(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'component_assessment', 'Assessment row must be an object');
  }
  const { product_id, assessment_type, score, confidence, assessed_at } = row;

  const productId = product_id === null || product_id === undefined ? '' : String(product_id);
  if (productId.length === 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'component_assessment.product_id',
      'Assessment row is missing "product_id"'
    );
  }
  if (typeof assessment_type !== 'string' || assessment_type.length === 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'component_assessment.assessment_type',
      'Assessment row "assessment_type" must be a non-empty string'
    );
  }

  let normalizedScore = null;
  if (score !== null && score !== undefined) {
    normalizedScore = Number(score);
    if (!Number.isFinite(normalizedScore) || normalizedScore < 0 || normalizedScore > 100) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'component_assessment.score',
        `Assessment score for "${assessment_type}" must be a finite number in [0, 100] (migration 008 CHECK)`
      );
    }
  }

  let normalizedConfidence = null;
  if (confidence !== null && confidence !== undefined) {
    if (typeof confidence !== 'string' || confidence.length === 0) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'component_assessment.confidence',
        'Assessment "confidence" must be a non-empty string or null'
      );
    }
    normalizedConfidence = confidence;
  }

  const assessedAtMs = toEpochMs(assessed_at);
  if (assessedAtMs === null) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'component_assessment.assessed_at',
      `Assessment "assessed_at" for "${assessment_type}" must be a valid timestamp`
    );
  }

  return {
    product_id: productId,
    assessment_type,
    score: normalizedScore,
    confidence: normalizedConfidence,
    assessed_at: assessedAtMs,
  };
}

/** Small private recursive freezer; no shared helper module is created. */
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
 * Load every component_assessment row of the requested products.
 *
 * Exactly one parameterized query is issued ($1 = the deduped, sorted id
 * list). An unassessed product is NOT an error: its key is absent from the
 * map (the pure steps own the no-evidence branch). The row-selection policy
 * for multiple rows per (product, assessment_type) is NOT owned here - see
 * ./effective-score `selectAssessmentRow`.
 *
 * @param {string[]} productIds non-empty candidate product id strings
 * @param {object} db pg-compatible client exposing db.query(sql, params)
 * @returns {Promise<object>} frozen { assessments, loaded_at }
 */
async function loadComponentAssessments(productIds, db) {
  validateProductIds(productIds);
  validateDatabaseClient(db);

  const uniqueIds = [...new Set(productIds)].sort();

  // PostgreSQL errors propagate unchanged: no try/catch, no conversion.
  const result = await db.query(SELECT_COMPONENT_ASSESSMENTS_SQL, [uniqueIds]);
  const rows = result && Array.isArray(result.rows) ? result.rows : [];

  const grouped = {};
  let loadedAtIso = null;
  for (const row of rows) {
    const normalized = normalizeAssessmentRow(row);
    if (!Object.prototype.hasOwnProperty.call(grouped, normalized.product_id)) {
      grouped[normalized.product_id] = [];
    }
    grouped[normalized.product_id].push(
      Object.freeze({
        assessment_type: normalized.assessment_type,
        score: normalized.score,
        confidence: normalized.confidence,
        assessed_at: normalized.assessed_at,
      })
    );
    const rowLoadedAt = toDecisionIso(row.loaded_at, 'loaded_at');
    if (loadedAtIso === null) {
      loadedAtIso = rowLoadedAt;
    }
  }

  // Map keys in sorted product order (deterministic regardless of the
  // driver's grouping behavior; the SQL already orders rows this way).
  const ordered = {};
  for (const productId of Object.keys(grouped).sort()) {
    ordered[productId] = grouped[productId];
  }

  return deepFreeze({
    assessments: ordered,
    loaded_at: loadedAtIso,
  });
}

module.exports = { loadComponentAssessments, SELECT_COMPONENT_ASSESSMENTS_SQL };