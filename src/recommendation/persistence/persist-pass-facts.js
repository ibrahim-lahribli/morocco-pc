'use strict';

/**
 * Engine 5b - pass-facts persistence (Decision 46).
 *
 * The third sibling of ./persist-ranked and ./persist-rejections: same
 * Decision 19 transaction discipline, same boundary (DML only - no
 * BEGIN/COMMIT/ROLLBACK, no SELECT, no pool, no clock), same
 * parameterized-only rule. It records the facts the pass PRODUCED ABOUT
 * ITSELF, which is the piece nothing else carries:
 *
 *   * `recommendation_query.budget_floor` - the Decision 27 diagnostic the
 *     orchestrator already returns as `budget_floor` on the full-run result.
 *     Until now it lived only in the HTTP reply, so a later GET of the same
 *     query could not reproduce it (the A1/A3 gap: a 200 reply carried a floor
 *     that the persisted row did not).
 *   * `recommendation_result.engine_version` / `.strategy_key` - which engine
 *     build produced a given ranked row, and which E4 strategy (Decision 41)
 *     nominated it. select-archetypes.js RETURNS `strategy_key` today and
 *     explicitly notes that persisting it needs Platform migration 019; this
 *     writer is that persistence, and the columns start NULL for pre-019 rows
 *     (history is genuinely unknowable, so nothing is backfilled).
 *
 * Why UPDATE and not INSERT: the rows this writer touches already exist. The
 * commit wrapper calls it AFTER persistence.persistRanked has inserted
 * build_candidate / build_component / recommendation_result for this pass, so
 * there is nothing to create and no id to mint - which is why this module
 * generates no UUIDs and returns no id list, unlike its two siblings. It is
 * the only writer in the family that is UPDATE-only, and therefore the only
 * one that needs its own GRANT (see the production-role note below).
 *
 * Idempotency: replacement by construction. The floor UPDATE is scoped to the
 * query id and sets one column; each result UPDATE is scoped to the query id
 * AND `rank`, which is unique per query (migration 011's
 * `uq_recommendation_result_query_rank (recommendation_query_id, rank)`), so a
 * re-commit of the same pass converges on the same values instead of
 * duplicating anything - the same Decision 31 replace-not-append discipline
 * ./persist-rejections uses, achieved here without a DELETE because UPDATE is
 * inherently idempotent.
 *
 * RANK ALIGNMENT: result rows are addressed by `rank = index + 1` over the
 * supplied `strategyKeys` array. That is exactly the order
 * persistence.persistRanked wrote them in - it writes `entry.persisted_rank` in
 * input order, and validate-selected.js pins `persisted_rank` to contiguous
 * 1..N over the same array.
 *
 * Two halves of that alignment, and only one of them is checkable here:
 *   * the LENGTH half is enforced, which is why this function also takes
 *     `selected`: `strategyKeys.length` must equal `selected.length`, so a
 *     short array (which would silently leave some rows NULL) or a long one
 *     (which would fire UPDATEs matching no row) fails fast instead of
 *     writing half a story with a green test.
 *   * the CONTENT half - WHICH key belongs to WHICH rank - cannot be checked
 *     without reading the rows back, and a SELECT is forbidden here. It is
 *     pinned at the seam instead (orchestrator/full-run.test.js, against
 *     select-archetypes.js's `persisted_rank = index + 1` contract).
 *
 * NULL is never coerced (AGENTS.md section 8): an absent fact is written as
 * SQL NULL, never as '' or 0. `engineVersion: null` and a `null` entry in
 * `strategyKeys` are legitimate "this pass did not know" values.
 *
 * Production-role note (Decision 46): the documented `morocco_pc_api` role has
 * SELECT + INSERT and deliberately NO UPDATE (docs/API.md, Production mode).
 * This writer breaks that invariant for exactly one column, so the role script
 * gains a COLUMN-scoped grant -
 * `GRANT UPDATE (budget_floor) ON recommendation_query TO morocco_pc_api;` -
 * and NOT a table-wide one: `has_table_privilege('morocco_pc_api',
 * 'recommendation_query', 'UPDATE')` stays `f` while
 * `has_column_privilege('morocco_pc_api', 'recommendation_query',
 * 'budget_floor', 'UPDATE')` becomes `t`. The rejected alternative (a new
 * insert-only diagnostic table) would split the floor from the query row it
 * describes and create a fresh key/UPSERT problem for re-commit handling.
 * `recommendation_result.engine_version` / `.strategy_key` do NOT need a grant
 * of their own only if the role is already granted UPDATE there - it is not,
 * so the same column-scoped treatment applies to those two columns and is
 * recorded in docs/API.md alongside the floor grant. Migration 019 adds the
 * columns; the grants are a separate operator step, never a migration.
 *
 * The budget_floor parameter is passed THROUGH unchanged: node-postgres
 * JSON-encodes a plain object parameter for a jsonb column (verified against
 * the shared DB: `SELECT $1::jsonb` with `{a:1}` round-trips to an object, and
 * a JS `null` becomes SQL NULL), so stringifying here would double-encode it.
 */

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/**
 * Decision 46: the one diagnostic the pass owns, written to the row it
 * describes. `$2` is a jsonb (nullable); `$1` is the pinned query id.
 */
const UPDATE_RECOMMENDATION_QUERY_FLOOR_SQL =
  'UPDATE recommendation_query SET budget_floor = $2 WHERE id = $1';

/**
 * Decision 46: the per-result provenance facts. `$4` is the rank the row was
 * inserted with (contiguous 1..N, see RANK ALIGNMENT above), which migration
 * 011's uq_recommendation_result_query_rank makes unique per query.
 */
const UPDATE_RECOMMENDATION_RESULT_FACTS_SQL =
  'UPDATE recommendation_result SET engine_version = $1, strategy_key = $2 '
  + 'WHERE recommendation_query_id = $3 AND rank = $4';

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Same db contract as the loaders and the two sibling writers. */
function validateClient(client) {
  if (client === null || typeof client !== 'object' || typeof client.query !== 'function') {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'client',
      'persistPassFacts requires a database client exposing query()'
    );
  }
}

/** A present fact must be a real string: blank is not a fact (mirrors validate-rejections.js). */
function requireNonBlankString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      field,
      field + ' must be a non-empty, non-blank string'
    );
  }
  return value;
}

/**
 * Validate and normalize one pass's facts.
 *
 * Every key is REQUIRED (no `undefined`): null is how a caller says "this pass
 * did not know this fact", and omitting the key instead is a bug that should
 * fail loudly rather than silently write NULL. The same rule the schema uses -
 * NULL is a value, absent is a mistake.
 *
 * @param {object} passFacts
 * @param {object|null} passFacts.budgetFloor Decision 27 diagnostic object, or
 *        null when the pass computed no floor. Written verbatim as jsonb.
 * @param {string|null} passFacts.engineVersion the engine build that produced
 *        this pass, or null when it is not known.
 * @param {Array<string|null>} passFacts.strategyKeys one E4 strategy key per
 *        persisted rank, index-aligned with the persisted `selected` array
 *        (index i belongs to rank i+1). May be empty for a zero-build pass.
 * @returns {object} frozen { budgetFloor, engineVersion, strategyKeys }
 */
function validatePassFacts(passFacts) {
  if (passFacts === undefined) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'passFacts', 'persistPassFacts requires "passFacts"');
  }
  if (!isPlainObject(passFacts)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'passFacts',
      '"passFacts" must be an object carrying budgetFloor, engineVersion and strategyKeys'
    );
  }

  if (passFacts.budgetFloor === undefined) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'passFacts.budgetFloor',
      '"passFacts.budgetFloor" is required (use null when the pass computed no floor)'
    );
  }
  if (passFacts.budgetFloor !== null && !isPlainObject(passFacts.budgetFloor)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'passFacts.budgetFloor',
      '"passFacts.budgetFloor" must be a plain object (jsonb) or null'
    );
  }

  if (passFacts.engineVersion === undefined) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'passFacts.engineVersion',
      '"passFacts.engineVersion" is required (use null when it is not known)'
    );
  }
  if (passFacts.engineVersion !== null) {
    requireNonBlankString(passFacts.engineVersion, 'passFacts.engineVersion');
  }

  if (passFacts.strategyKeys === undefined) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'passFacts.strategyKeys',
      '"passFacts.strategyKeys" is required (use [] for a zero-build pass)'
    );
  }
  if (!Array.isArray(passFacts.strategyKeys)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'passFacts.strategyKeys',
      '"passFacts.strategyKeys" must be an array index-aligned with the persisted ranks'
    );
  }
  for (let index = 0; index < passFacts.strategyKeys.length; index += 1) {
    const key = passFacts.strategyKeys[index];
    if (key !== null) {
      requireNonBlankString(key, 'passFacts.strategyKeys[' + index + ']');
    }
  }

  return Object.freeze({
    budgetFloor: passFacts.budgetFloor,
    engineVersion: passFacts.engineVersion,
    strategyKeys: Object.freeze(passFacts.strategyKeys.slice()),
  });
}

/**
 * Persist one pass's own facts onto the rows it just wrote.
 *
 * @param {object} args
 * @param {object} args.client query executor exposing query(sql, params)
 * @param {string} args.queryId pinned recommendation_query.id (the row the
 *        floor is written to; it is the same id persistRanked just used).
 * @param {Array} args.selected the SAME array persistRanked just wrote, used
 *        only to cross-check `passFacts.strategyKeys.length` against the number
 *        of result rows that exist. Its own shape is validate-selected.js's
 *        contract, checked earlier by persistRanked in this transaction.
 * @param {object} args.passFacts the pass's facts (see validatePassFacts).
 * @returns {Promise<object>} frozen { query_id, floor_update_issued,
 *          result_updates_issued }. These are STATEMENT COUNTS, deliberately
 *          named as such: without a SELECT (banned here) the writer cannot
 *          prove a row matched, so it must not claim that it updated one.
 * @throws CandidateSelectionError on a malformed input (no statement is
 *        issued - validation precedes every statement) or the driver error
 *        unchanged (the wrapper's ROLLBACK undoes the writes).
 */
async function persistPassFacts({ client, queryId, selected, passFacts }) {
  validateClient(client);

  if (queryId === undefined || queryId === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'queryId', 'persistPassFacts requires "queryId"');
  }
  if (typeof queryId !== 'string' || queryId.length === 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'queryId', '"queryId" must be a non-empty string');
  }

  if (!Array.isArray(selected)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'selected',
      'persistPassFacts requires "selected" (the array persistRanked just wrote) to '
        + 'cross-check the number of result rows'
    );
  }

  const facts = validatePassFacts(passFacts);

  // The one alignment half that IS checkable here: one fact per result row. A
  // shorter array would leave rows NULL and a longer one would fire UPDATEs
  // that match nothing, and either would pass a fake-client test.
  if (facts.strategyKeys.length !== selected.length) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'passFacts.strategyKeys',
      'passFacts.strategyKeys has ' + facts.strategyKeys.length + ' entries but this pass '
        + 'persisted ' + selected.length + ' result row(s): the array must be index-aligned '
        + 'with the persisted ranks (one strategy key per rank)'
    );
  }

  // The floor first (one row, this query), then one result row per rank. Both
  // run on the caller's client inside its open transaction; this module issues
  // no transaction control of its own (Decision 19.1).
  await client.query(UPDATE_RECOMMENDATION_QUERY_FLOOR_SQL, [queryId, facts.budgetFloor]);

  for (let index = 0; index < facts.strategyKeys.length; index += 1) {
    await client.query(UPDATE_RECOMMENDATION_RESULT_FACTS_SQL, [
      facts.engineVersion,
      facts.strategyKeys[index],
      queryId,
      index + 1,
    ]);
  }

  return Object.freeze({
    query_id: queryId,
    floor_update_issued: true,
    result_updates_issued: facts.strategyKeys.length,
  });
}

module.exports = {
  persistPassFacts,
  validatePassFacts,
  UPDATE_RECOMMENDATION_QUERY_FLOOR_SQL,
  UPDATE_RECOMMENDATION_RESULT_FACTS_SQL,
};
