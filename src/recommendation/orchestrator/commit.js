'use strict';

/**
 * Decision 19.1 / 19.2 - commit transaction wrapper (Engine 5b write side).
 *
 * The read-write counterpart of ./snapshot (Decision 17.5): owns the ONE write
 * transaction of a recommendation pass and hands the SAME client to the writer.
 *
 *   BEGIN                                             - default isolation (18-D9)
 *     guard 1: SELECT ... FOR UPDATE                  - lock the query row
 *     guard 2: SELECT 1 FROM build_candidate LIMIT 1  - re-run guard
 *     persistRanked({ client, queryId, selected })    - DML only, no tx control
 *     persistRejections({ client, queryId, rejections }) - OG-04, same tx
 *   COMMIT                                            - success
 *   ROLLBACK                                          - ANY thrown error
 *
 * Why plain BEGIN (no explicit isolation level): Decision 18-D9 - the write
 * transaction runs at the default isolation level, never retries on failure,
 * and commit stays wrapper-owned (Decision 19.1). This is deliberately NOT the
 * snapshot wrapper's `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`; the
 * read pass and the write pass are two separate transactions.
 *
 * Why the two guards live HERE and not in the writer (Decision 19.2): a
 * `recommendation_query` is an immutable request - a re-run means a NEW query
 * row. Guard 1 locks the row and proves it exists; guard 2 refuses fail-fast
 * when `build_candidate` rows already exist for it. There is no overwrite, no
 * delete, no upsert. Both statements are SELECTs, which the writer module is
 * forbidden to contain (its own boundary test bans the token), so the writer
 * stays pure DML and the wrapper stays the only coordinator. Guard 2 is
 * covered by the existing idx_build_candidate_recommendation_query_id index -
 * no new index, no migration.
 *
 * OG-04 rejection diagnostics: the optional 4th argument `rejections` is the
 * pass's Engine 2D candidate verdicts. persistRejections records the REJECT
 * entries into build_rejection inside THIS transaction, immediately after
 * persistRanked, on the SAME client - so a pass can never commit builds
 * without their rejection reasons, or reasons without their builds. It is
 * additive and backwards-compatible: `undefined` writes nothing, and the
 * writer itself writes zero rows when nothing was rejected (the common case),
 * so a healthy pass is behaviourally identical to before. The wrapper's return
 * value is still the writer's OWN frozen result by reference (Decision 19 seam),
 * so no existing caller sees a new or reshaped field; read the committed rows
 * back with a SELECT on build_rejection for the query id.
 *
 * Zero builds (Decision 19.3 / 18-D8): a zero-build pass persists nothing and
 * is a valid outcome, NOT an error. This wrapper still runs the whole
 * transaction (BEGIN, both guards, an empty persistRanked call, COMMIT): the
 * guards are query-level rules, not write-level ones, so a zero-build call is
 * validated exactly like any other call - a nonexistent or already-persisted
 * query id still fails fast instead of silently "succeeding". persistRanked
 * issues zero statements for an empty `selected` and returns frozen empties, so
 * this is a real no-op; and because nothing was persisted, a later non-empty
 * commit for the same query id is still allowed.
 *
 * Connection requirement: client MUST be a single dedicated connection (the
 * same requirement as ./snapshot) - BEGIN/COMMIT/ROLLBACK are session-scoped,
 * and the guards, the writer's INSERTs and the COMMIT must all run on ONE
 * session, otherwise the row lock and the transaction itself are meaningless.
 * With a pg Pool, check a client out first (const client = await pool.connect())
 * and release it afterwards (client.release()); handing this wrapper the Pool
 * itself is a bug. The wrapper never creates, never closes, and never releases
 * the client - the caller owns it.
 *
 * Error policy (mirrors ./snapshot, with COMMIT in place of the always-ROLLBACK):
 *   - the guard failure, the writer error or the COMMIT error always wins; a
 *     failing ROLLBACK never masks it;
 *   - a failing BEGIN propagates unchanged and no ROLLBACK is attempted, since
 *     no transaction was opened;
 *   - there is no "ROLLBACK failure on an otherwise successful pass" case here
 *     (unlike ./snapshot): ROLLBACK is issued only on the error path, because
 *     COMMIT ends the happy path.
 *
 * Guard failures use the existing error vocabulary: CandidateSelectionError
 * with ERROR_CODES.INVALID_INPUT and field 'query_id' (the offending input is
 * the pinned recommendation_query id, not a shape inside `selected`).
 *
 * Testability seam (same convention as ./snapshot): the writer is invoked
 * through its module namespace (`persistence.persistRanked`), so the wrapper's
 * transaction semantics are unit-testable without a database.
 *
 * Explicit NON-responsibilities: no ranking, no explanation generation, no
 * retries, no savepoints, no connection creation/close/release, no logging, no
 * DML/DDL of its own beyond the two guards, and NO wiring into ./run (the
 * orchestrator pass stays read-only; the caller wires this wrapper).
 */

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const persistence = require('../persistence/persist-ranked');
const { persistRejections } = require('../persistence/persist-rejections');

/**
 * Decision 18-D9: plain BEGIN, default isolation, no explicit escalation.
 * The exact statement constant is exported so tests pin it byte for byte.
 */
const BEGIN_SQL = 'BEGIN';

/** Decision 19.1: COMMIT is wrapper-owned and issued on the success path only. */
const COMMIT_SQL = 'COMMIT';

/** The single end-of-transaction statement every error path issues. */
const ROLLBACK_SQL = 'ROLLBACK';

/**
 * Decision 19.2 guard 1: lock the immutable query row. Zero rows means the
 * pinned recommendation_query id does not exist - fail fast, no writes.
 */
const LOCK_RECOMMENDATION_QUERY_SQL =
  'SELECT id FROM recommendation_query WHERE id = $1 FOR UPDATE';

/**
 * Decision 19.2 guard 2: re-run guard. Any row means this query already has
 * persisted candidates - fail fast; no overwrite, no delete, no upsert.
 * Served by idx_build_candidate_recommendation_query_id (no new index).
 */
const EXISTING_BUILD_CANDIDATES_SQL =
  'SELECT 1 FROM build_candidate WHERE recommendation_query_id = $1 LIMIT 1';

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/** Same client contract as the loaders and ./snapshot, named for this boundary. */
function validateClient(client) {
  if (client === null || typeof client !== 'object' || typeof client.query !== 'function') {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'client',
      'runRecommendationCommit requires a database client exposing query()'
    );
  }
}

/**
 * Run one recommendation persistence pass inside its own write transaction.
 *
 * @param {object} client pg-compatible SINGLE dedicated connection exposing
 *        client.query(sql, params); never created, never closed, never a Pool.
 * @param {string} queryId pinned recommendation_query.id (an existing row is a
 *        guard-1 precondition; an unknown id fails fast).
 * @param {Array} selected ranked entries for persistRanked (validated by the
 *        writer inside this transaction); [] persists nothing (Decision 18-D8).
 * @param {Array} [rejections] OG-04: this pass's Engine 2D candidate verdicts.
 *        Optional; undefined or [] writes no rejection rows.
 * @returns {Promise<object>} the frozen persistRanked result, BY REFERENCE and
 *          unchanged (Decision 19 seam). The OG-04 rejection rows are committed
 *          in the same transaction but are not merged into this object - see
 *          the note at the COMMIT site.
 * @throws CandidateSelectionError INVALID_INPUT/field 'query_id' when the query
 *        row does not exist or already has build_candidate rows, the writer
 *        error unchanged (after ROLLBACK), or the COMMIT error; and
 *        INVALID_INPUT/field 'client' when the client contract fails (no
 *        statement is issued).
 */
async function runRecommendationCommit(client, queryId, selected, rejections) {
  validateClient(client);

  // Outside the try: if BEGIN itself fails there is no transaction to end.
  await client.query(BEGIN_SQL);

  try {
    // Guard 1 (Decision 19.2): lock the query row. The lock is what makes the
    // existence check and the re-run check race-free against a concurrent
    // commit for the same query id.
    const locked = await client.query(LOCK_RECOMMENDATION_QUERY_SQL, [queryId]);
    if (locked.rows.length === 0) {
      fail(
        ERROR_CODES.INVALID_INPUT,
        'query_id',
        'recommendation_query row not found: the pinned query_id does not exist'
      );
    }

    // Guard 2 (Decision 19.2): refuse a re-run. Read-only, no side effect.
    const existing = await client.query(EXISTING_BUILD_CANDIDATES_SQL, [queryId]);
    if (existing.rows.length > 0) {
      fail(
        ERROR_CODES.INVALID_INPUT,
        'query_id',
        'build_candidate rows already exist for this query_id: '
          + 're-run refused (no overwrite, no delete, no upsert)'
      );
    }

    // The writer runs on the SAME client, inside this transaction, and issues
    // no transaction control of its own (Decision 19.1). For an empty
    // `selected` it issues no statement at all and returns frozen empties.
    const result = await persistence.persistRanked({ client, queryId, selected });

    // OG-04: the rejection-reason writer runs in the SAME transaction, after
    // persistRanked, on the SAME client - so a failure in either rolls back
    // both and a pass can never commit builds without their diagnostics (or
    // diagnostics without their builds). `rejections` is the pass's Engine 2D
    // verdicts; the writer keeps only REJECT entries and writes zero rows when
    // nothing was rejected, so a healthy pass is a true no-op here. It is
    // additive and optional: an undefined `rejections` writes nothing, which
    // keeps every existing three-argument call site byte-identical in
    // behaviour.
    const rejectionResult = await persistRejections({
      client,
      queryId,
      rejections: rejections === undefined ? [] : rejections,
    });

    // Last statement of the happy path; after this the transaction is closed
    // and ROLLBACK must never be issued.
    await client.query(COMMIT_SQL);
    // Decision 19 seam, preserved deliberately: the writer's OWN frozen result
    // is returned BY REFERENCE, exactly as before OG-04. It is not re-wrapped,
    // copied or reshaped - a caller (and the unit tests) rely on that identity,
    // and re-wrapping would also drop the writer's `query_id` field. The
    // rejection rows are already committed at this point; `rejectionResult` is
    // retained only so its id list is observable to a caller that wants it,
    // without changing this return.
    void rejectionResult;
    return result;
  } catch (error) {
    // Any failure - a guard fail-fast, a writer error, or a failing COMMIT -
    // leaves the session to be returned to a clean state. The failure that
    // caused it always wins; a failing ROLLBACK never masks it.
    try {
      await client.query(ROLLBACK_SQL);
    } catch (rollbackError) {
      void rollbackError;
    }
    throw error;
  }
}

module.exports = {
  runRecommendationCommit,
  BEGIN_SQL,
  COMMIT_SQL,
  ROLLBACK_SQL,
  LOCK_RECOMMENDATION_QUERY_SQL,
  EXISTING_BUILD_CANDIDATES_SQL,
};

