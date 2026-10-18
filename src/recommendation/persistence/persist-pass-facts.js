'use strict';

/**
 * Engine 5b - pass-facts persistence (Decision 46).
 *
 * The third sibling of ./persist-ranked and ./persist-rejections: the same
 * Decision 19 transaction discipline (DML only - no BEGIN/COMMIT/ROLLBACK, no
 * SELECT, no pool, no clock, parameterized only) plus one rule of its own -
 * UPDATE-ONLY, because the rows it annotates already exist (persistRanked
 * inserted them moments earlier in the same transaction). It therefore mints no
 * id, generates no UUID, issues no INSERT/DELETE, and returns statement COUNTS
 * rather than claiming that a row matched - which only a SELECT (banned here)
 * could establish.
 *
 * WHAT IT WRITES - this module's own interface. The CONTRACT has ONE owner,
 * Decision 46 (why UPDATE-only, the additive seam, the caller-supplied
 * engineVersion, the column-scoped production-role grants), and the
 * operator-facing GRANT script lives in docs/API.md "Production mode". Cite
 * those instead of restating them here:
 *
 *   * `recommendation_query.budget_floor` <- the Decision 27 diagnostic the
 *     orchestrator returns on the full-run result: one UPDATE scoped to `id`.
 *   * `recommendation_result.engine_version` / `.strategy_key` <- which deploy
 *     produced a rank, and which E4 archetype (Decision 41) nominated it: one
 *     UPDATE per rank, scoped to `(recommendation_query_id, rank)`.
 *
 * RANK ALIGNMENT: result rows are addressed by `rank = index + 1` over the
 * supplied `strategyKeys`, which is the order `persistRanked` wrote them in
 * (validate-selected.js pins contiguous 1..N over the same array). The LENGTH
 * half of that alignment is enforced here, which is why the caller also passes
 * `selected`; the CONTENT half cannot be checked without a SELECT and is pinned
 * at the seam (orchestrator/full-run.test.js).
 *
 * NULL is never coerced (AGENTS.md section 8): an absent fact reaches the driver
 * as null, never as '' or 0. `budgetFloor` is passed THROUGH unchanged, because
 * node-postgres JSON-encodes a plain object parameter for a jsonb column and
 * stringifying it here would double-encode it.
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
