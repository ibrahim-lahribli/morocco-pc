'use strict';

/**
 * Decision 21 - full-run composition (snapshot -> rank -> select -> persist).
 *
 * A thin top-level entry point that wires the already-implemented stages in
 * order on ONE caller-owned dedicated connection, reused sequentially:
 *
 *   runRecommendationSnapshot(client, queryId)   - read pass, always ends
 *     its own transaction without writing
 *     -> rankBuilds({ builds })                  - Engine 5a, pure, full
 *        ranked list plus the top_n slice
 *     -> selectDiverseTop({ ranked })            - Decision 20, walks the
 *        FULL ranked list (never the top_n slice), capped by the ranking
 *        barrel constants
 *     -> runRecommendationCommit(client, queryId, selected) - separate
 *        later write pass on the same client, after the read pass has ended
 *        (the session is idle by then); still called with an empty array
 *        when there is nothing to persist
 *     -> frozen combined result (see below)
 *
 * No short-circuit anywhere: a zero-build read flows through ranking (frozen
 * empties) and selection (empty selected, dropped_count 0) into the write
 * pass with an empty selected array, and a zero-selected outcome does the
 * same. The write pass guards are query-level rules, so an unknown or
 * already-persisted query id still fails fast instead of silently passing.
 *
 * Boundary (same discipline as ./index): this module issues no statement of
 * its own and owns no transaction control, no ranking, no selection and no
 * persistence logic of its own - it only calls the three wrapper/barrel
 * entry points through their module namespaces (stub seam, same convention
 * as ./snapshot and ./commit) and freezes the combined traceable result:
 * query_id, scoring_model_id, builds, ranked, top_n, selected,
 * dropped_count, persisted_ranks, build_candidate_ids,
 * recommendation_result_ids. Intermediates stay observable by reference per
 * their own contracts; the pre-write seam stays open for Engine 6.
 */

const ranking = require('../ranking');
const commit = require('./commit');
const snapshot = require('./snapshot');

/**
 * Run one full recommendation pass: score, rank, diversity-select, persist.
 *
 * @param {object} client pg-compatible SINGLE dedicated connection; never
 *        created, never closed, never released here - handed first to the
 *        read wrapper and then to the write wrapper, sequentially.
 * @param {string} queryId pinned recommendation_query.id.
 * @returns {Promise<object>} the frozen combined result (ten fields, see
 *          above).
 */
async function runRecommendationFullRun(client, queryId) {
  const snap = await snapshot.runRecommendationSnapshot(client, queryId);
  const rankedResult = ranking.rankBuilds({ builds: snap.builds });
  const selection = ranking.selectDiverseTop({
    ranked: rankedResult.ranked,
    limit: ranking.TOP_N_PERSISTED,
    maxPerPair: ranking.MAX_PER_PAIR,
  });
  const persisted = await commit.runRecommendationCommit(client, queryId, selection.selected);
  return Object.freeze({
    query_id: snap.query_id,
    scoring_model_id: snap.scoring_model_id,
    builds: snap.builds,
    ranked: rankedResult.ranked,
    top_n: rankedResult.top_n,
    selected: selection.selected,
    dropped_count: selection.dropped_count,
    persisted_ranks: persisted.persisted_ranks,
    build_candidate_ids: persisted.build_candidate_ids,
    recommendation_result_ids: persisted.recommendation_result_ids,
  });
}

module.exports = { runRecommendationFullRun };
