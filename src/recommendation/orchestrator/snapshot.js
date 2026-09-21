'use strict';

/**
 * Decision 17.5 - snapshot transaction wrapper (read-only, no writes).
 *
 * Owns the ONE transaction every loader of a recommendation pass runs in:
 *
 *   BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY
 *     runRecommendation({ db: client, queryId })   - no transaction control
 *   ROLLBACK                                        - always ends the tx
 *
 * Why REPEATABLE READ READ ONLY: Stage 1 and the assessment loader read
 * CURRENT_TIMESTAMP (stable only per transaction, Decision 7 F3) and every
 * loader must see one snapshot; the pass writes nothing, so the transaction is
 * declared READ ONLY (Decision 17.5). The Decision 19 writer is a SEPARATE,
 * later transaction with its own wrapper.
 *
 * Why ROLLBACK in BOTH paths: a read-only pass has nothing to commit, and a
 * failed statement leaves the connection in an ABORTED transaction state that
 * only ROLLBACK clears. The rule is ROLLBACK on ANY thrown error, not just on
 * loader-mapped CandidateSelectionErrors (DEVELOPMENT_NOTES.md, 2026-09-21): a
 * malformed (non-empty-string) query id reaches PostgreSQL as $1 and raises
 * 22P02, which aborts the transaction. COMMIT is never issued here.
 *
 * Connection requirement: client MUST be a single dedicated connection -
 * BEGIN and ROLLBACK are session-scoped. With a pg Pool, check a client out
 * first (const client = await pool.connect()) and release it afterwards
 * (client.release()); handing this wrapper the Pool itself is a bug, because
 * the loaders queries could be dispatched to other pooled connections OUTSIDE
 * this transaction and the ROLLBACK would then hit a different session.
 *
 * Error policy:
 *   - the pass error always wins; a failing ROLLBACK never masks it;
 *   - a ROLLBACK failure on an otherwise successful pass is surfaced;
 *   - a failing BEGIN propagates unchanged and no ROLLBACK is attempted, since
 *     no transaction was opened.
 *
 * Testability seam (same convention as ./run): the pass is invoked through its
 * namespace object (run.runRecommendation), so the wrapper's transaction
 * semantics are unit-testable without a database.
 *
 * Explicit NON-responsibilities: no DML/DDL of any kind, no COMMIT, no query
 * besides the two transaction statements, no retries, no connection creation or
 * close (the caller owns the client), no logging.
 */

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const run = require('./run');

/** The exact Decision 17.5 transaction open statement. */
const BEGIN_SQL = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';

/** The single end-of-transaction statement this wrapper ever issues. */
const ROLLBACK_SQL = 'ROLLBACK';

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/** Same client contract as the loaders, named client for this boundary. */
function validateClient(client) {
  if (client === null || typeof client !== 'object' || typeof client.query !== 'function') {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'client',
      'runRecommendationSnapshot requires a database client exposing query()'
    );
  }
}

/**
 * Run one recommendation pass inside the Decision 17.5 snapshot transaction.
 *
 * @param {object} client pg-compatible SINGLE dedicated connection exposing
 *        client.query(sql, params); never created, never closed, never a Pool.
 * @param {string} queryId pinned recommendation_query.id (validated by the
 *        query loader inside the transaction).
 * @returns {Promise<object>} the frozen runRecommendation result.
 * @throws the pass error unchanged (after ROLLBACK), or the ROLLBACK error on
 *        an otherwise successful pass; INVALID_INPUT client when the client
 *        contract fails (no statement is issued).
 */
async function runRecommendationSnapshot(client, queryId) {
  validateClient(client);

  // Outside the try: if BEGIN itself fails there is no transaction to end.
  await client.query(BEGIN_SQL);

  let failure = null;
  try {
    return await run.runRecommendation({ db: client, queryId });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await client.query(ROLLBACK_SQL);
    } catch (rollbackError) {
      if (failure === null) {
        throw rollbackError;
      }
      // The pass error is already propagating: never mask it.
    }
  }
}

module.exports = { runRecommendationSnapshot, BEGIN_SQL, ROLLBACK_SQL };