'use strict';

/**
 * Decision 17 - Recommendation orchestrator (public surface).
 *
 * Boundary-only barrel: re-exports the no-writes orchestrator and its snapshot
 * wrapper without wrappers, logic, orchestration or additional contracts.
 *
 *   runRecommendation({ db, queryId })         - one recommendation pass over an
 *     injected client: query loader -> transaction timestamp -> pinned scoring
 *     model -> Engine 2B/2C -> Stage 1 -> Engine 2D -> retention -> Engine 3 ->
 *     Engine 4 build scores -> frozen { query_id, scoring_model_id, builds }.
 *     Issues NO BEGIN/COMMIT/ROLLBACK and performs no write (see ./run).
 *
 *   runRecommendationSnapshot(client, queryId) - owns the single
 *     BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY transaction and always
 *     ends it with ROLLBACK (success and error alike). client MUST be a single
 *     dedicated connection: with a pg Pool, check one out first (see
 *     ./snapshot).
 *
 *   evaluateSwapPreview(args)              - Decision 55 item 4: ONE read-only
 *     hypothetical swap against a persisted build - the same loaders and pure
 *     stages a pass uses (2B -> 2C -> Stage 1 -> 2D) feeding Engine 3's
 *     `evaluateBuildReplacement`, with the substituted candidate priced through
 *     Stage 1's own carrier. Writes nothing (see ./swap-preview).
 *
 *   evaluateSwapPreviewSnapshot(client, args) - the same snapshot wrapper
 *     contract as runRecommendationSnapshot: it owns BEGIN/ROLLBACK.
 *
 *   commitSwap(args)                       - Decision 56: the WRITE half of
 *     CD-8. Asks the preview's own composition, then APPENDS one derived build
 *     (`build_candidate` + `build_component` + `recommendation_swap`). No
 *     UPDATE, no DELETE, no rank change (see ./swap-commit).
 *
 *   commitSwapInTransaction(client, args)  - owns its write transaction
 *     (plain BEGIN ... COMMIT, ROLLBACK on any error), like
 *     runRecommendationCommit.
 *
 *   readCommittedSwap(db, sourceResultId)  - the one-committed-swap read, one
 *     statement, no transaction control.
 *
 * NOT owned here: ranking (Engine 5a, Decision 18), persistence (Engine 5b,
 * Decision 19), explanation (Engine 6), `top_k_per_role` application inside
 * Engine 3 (Decision 12/14 put it upstream, in ../retention), and any write.
 */

const { runRecommendation } = require('./run');
const { runRecommendationSnapshot } = require('./snapshot');
const { runRecommendationFullRun } = require('./full-run');
const { evaluateSwapPreview, evaluateSwapPreviewSnapshot } = require('./swap-preview');
const {
  commitSwap,
  commitSwapInTransaction,
  readCommittedSwap,
} = require('./swap-commit');

module.exports = {
  runRecommendation,
  runRecommendationSnapshot,
  runRecommendationFullRun,
  evaluateSwapPreview,
  evaluateSwapPreviewSnapshot,
  commitSwap,
  commitSwapInTransaction,
  readCommittedSwap,
};