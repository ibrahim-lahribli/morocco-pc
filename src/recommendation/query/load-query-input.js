/**
 * Query input - Decision 10 / Decision 17.1 loader.
 *
 * Boundary: turns ONE `recommendation_query` row into the validated Engine 2A
 * input consumed downstream (via `loadCandidates` / `selectCandidatePool`),
 * plus the row's `scoring_model_id` and query id the orchestrator needs to
 * pin the scoring model and tag its result.
 *
 *   queryId
 *         |  ONE exact-ID parameterized query over recommendation_query
 *         |  (no profile fallback, no discovery, no substitution)
 *         v
 *   raw recommendation_query row
 *         |  row missing -> INVALID_INPUT (fail fast, Decision 17.4)
 *         |  row present -> budget_amount converted (strict plain-decimal
 *         |                strings only, see below), then the Engine 2A input
 *         |                built THROUGH createCandidateSelectionInput() (no
 *         |                re-implemented validation)
 *         v
 *   frozen { query_id, scoring_model_id, input }
 *
 * Decision 10 Rule 1: `required_roles` is the loader-derived constant below,
 * in canonical `component_role` enum order (NOT `COMPONENT_ROLES` order, NOT
 * query- or profile-variable, no multiplicity). GPU is included (Decision 10:
 * without GPU candidates every REQUIRED path yields zero builds);
 * SSD_SECONDARY is excluded (no section 11 generation step, Engine 3 never
 * buckets it).
 *
 * Decision 10 Rule 2: fail closed on NULL/blank `use_case`. The row value is
 * passed to Engine 2A verbatim -- NULL -> MISSING_REQUIRED_FIELD, blank ->
 * INVALID_FIELD_VALUE -- with no default, no normalization, no profile
 * fallback, and no engine change.
 *
 * Decision 10 mapping: `budget_amount = row.budget_amount` (NUMERIC -> JS
 * number), `currency = row.currency` (verbatim; format owned by Engine 2A),
 * `use_case = row.use_case` (verbatim; Rule 2), `required_roles` = Rule 1
 * constant. `resolution`, `priority`, and the profile-FK column are NOT
 * selected and NOT used (Decision 17.6).
 *
 * Budget conversion (amended 2026-09-21): node-postgres returns NUMERIC
 * columns as strings. ONLY strings matching /^[0-9]+(\.[0-9]+)?$/ convert
 * via Number(); every other string (empty, whitespace-padded, hex, exponent,
 * 'Infinity', 'NaN', signed) throws CandidateSelectionError
 * INVALID_FIELD_VALUE field `budget_amount`. Numbers, null/undefined, and all
 * other types pass through untouched so Engine 2A stays the sole owner of
 * the missing / finite / >0 contract. Currency and use_case are never
 * converted.
 *
 * Database policy: parameterized SQL only ($1 is the query id, never
 * interpolated); exactly one query per call. `db` is injected and validated
 * like the other loaders (`typeof db.query === 'function'`); never created
 * or closed. NO BEGIN, no SET TRANSACTION, no NOW()/CURRENT_TIMESTAMP
 * (Decision 17.5: the caller owns the snapshot). PostgreSQL errors propagate
 * unchanged -- never swallowed, never converted.
 *
 * NOTE (malformed UUID): `queryId` is a non-empty string only (same as
 * the Decision 11 loader, which does no UUID-shape check). A malformed id reaches PostgreSQL, which raises
 * 22P02 and ABORTS the surrounding REPEATABLE READ READ ONLY snapshot
 * transaction -- the orchestrator wrapper (`runRecommendationSnapshot`)
 * must ROLLBACK on ANY thrown error.
 *
 * Immutability: result + nested `input`/`required_roles` are frozen; the
 * PostgreSQL row and caller-owned objects are never mutated or frozen.
 *
 * Errors: existing Engine 2 CandidateSelectionError / ERROR_CODES only.
 *
 * NOT owned here: orchestrator, ranking, persistence, profile fallback, any
 * write, `scoring_model` loading (Decision 11), the snapshot wrapper (17.5).
 */

'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const { createCandidateSelectionInput } = require('../candidates/input');

/**
 * Decision 10 Rule 1 loader constant, canonical component_role order.
 * Deliberately NOT COMPONENT_ROLES (different order) and NOT derived from
 * any query/profile column (none exists).
 */
const REQUIRED_ROLES = Object.freeze([
  'CPU',
  'MOTHERBOARD',
  'RAM',
  'GPU',
  'PSU',
  'CASE',
  'CPU_COOLER',
  'SSD_BOOT',
]);

/**
 * Single Decision 10/17.1 query. Parameterized only ($1 = query id).
 * Exactly the five contract columns -- `resolution`, `priority`, and
 * the profile-FK column are deliberately absent (Decision 17.6).
 */
const SELECT_QUERY_INPUT_SQL = [
  'SELECT id, budget_amount, currency, use_case, scoring_model_id',
  'FROM recommendation_query',
  'WHERE id = $1',
].join(' ');

/**
 * Strict plain-decimal gate for NUMERIC-string budgets (amended 2026-09-21):
 * unsigned digits with at most one dot and at least one digit per side.
 * Anything else string-shaped is rejected, never coerced.
 */
const PLAIN_DECIMAL_RE = /^[0-9]+(\.[0-9]+)?$/;

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/**
 * Validate the loader's own query-id argument. Same convention as the
 * Decision 11 scoring-model loader's pinned-id validator:
 * absent -> MISSING_REQUIRED_FIELD, wrong value -> INVALID_FIELD_VALUE.
 * Non-empty string only -- no UUID-shape check, no normalization.
 */
function validateQueryId(queryId) {
  if (queryId === undefined || queryId === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'query_id',
      'loadQueryInput requires a "query_id"'
    );
  }
  if (typeof queryId !== 'string' || queryId.length === 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'query_id',
      '"query_id" must be a non-empty string'
    );
  }
}

/** Same db contract as Engine 2B / 2D / Stage 1 / Decision 11. */
function validateDatabaseClient(db) {
  if (db === null || typeof db !== 'object' || typeof db.query !== 'function') {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'db',
      'loadQueryInput requires a database client exposing query()'
    );
  }
}

/**
 * Convert a NUMERIC-string budget to a JS number. Only strict plain-decimal
 * strings convert; every other string throws INVALID_FIELD_VALUE.
 * Non-strings pass through untouched for Engine 2A to judge (missing ->
 * MISSING_REQUIRED_FIELD; non-number / non-finite / <= 0 ->
 * INVALID_FIELD_VALUE). A plain-decimal string that still converts to a
 * non-finite number (hundreds of digits -> Infinity) fails closed here.
 */
function convertBudgetAmount(raw) {
  if (typeof raw !== 'string') {
    return raw;
  }
  if (!PLAIN_DECIMAL_RE.test(raw)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'budget_amount',
      '"budget_amount" must be a finite number'
    );
  }
  const converted = Number(raw);
  if (!Number.isFinite(converted)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'budget_amount',
      '"budget_amount" must be a finite number'
    );
  }
  return converted;
}

/**
 * Load one recommendation_query row and derive the Engine 2A input.
 *
 * Exactly one parameterized query. Missing row -> INVALID_INPUT (fail fast).
 * Present row -> mapped per Decision 10, validated THROUGH
 * createCandidateSelectionInput (NULL/blank use_case fails with the Engine 2A
 * MISSING_REQUIRED_FIELD / INVALID_FIELD_VALUE contract).
 *
 * @param {string} queryId pinned recommendation_query.id
 * @param {object} db pg-compatible client exposing db.query(sql, params)
 * @returns {Promise<object>} frozen { query_id, scoring_model_id, input }
 */
async function loadQueryInput(queryId, db) {
  validateQueryId(queryId);
  validateDatabaseClient(db);

  // PostgreSQL errors (incl. 22P02 on a malformed UUID id, which aborts the
  // caller's snapshot transaction) propagate unchanged: no try/catch, no
  // conversion. The orchestrator wrapper must ROLLBACK on ANY thrown error.
  const result = await db.query(SELECT_QUERY_INPUT_SQL, [queryId]);
  const rows = result && Array.isArray(result.rows) ? result.rows : [];

  if (rows.length === 0) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'query_id',
      `No recommendation_query row exists for query id "${queryId}"`
    );
  }

  const row = rows[0];

  // Engine 2A input THROUGH the contract validator: budget converted above,
  // currency/use_case verbatim, roles from the Rule 1 constant (fresh copy
  // so the frozen constant is never aliased).
  const input = createCandidateSelectionInput({
    budget_amount: convertBudgetAmount(row.budget_amount),
    currency: row.currency,
    use_case: row.use_case,
    required_roles: [...REQUIRED_ROLES],
  });

  // Identity columns preserved verbatim (no coercion, no validation);
  // scoring_model_id ownership stays with the Decision 11 loader.
  return Object.freeze({
    query_id: row.id,
    scoring_model_id: row.scoring_model_id,
    input,
  });
}

module.exports = { loadQueryInput, SELECT_QUERY_INPUT_SQL, REQUIRED_ROLES };
