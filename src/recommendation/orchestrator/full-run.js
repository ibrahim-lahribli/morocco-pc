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
 *     -> explainSelection({ selected, builds, contributions, budget }) - Engine
 *        6, Decision 22 item 3, pure/DB-free; produces the EXPLAINED array
 *     -> runRecommendationCommit(client, queryId, explained, verdicts) - separate
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
 * their own contracts; the pre-write seam is now FILLED by Engine 6
 * (../explanation, Decision 22 item 3), so the returned `selected` is the
 * explained array.
 */

const ranking = require('../ranking');
const commit = require('./commit');
const snapshot = require('./snapshot');
const explanation = require('../explanation');

/**
 * Run one full recommendation pass: score, rank, diversity-select, persist.
 *
 * @param {object} client pg-compatible SINGLE dedicated connection; never
 *        created, never closed, never released here - handed first to the
 *        read wrapper and then to the write wrapper, sequentially.
 * @param {string} queryId pinned recommendation_query.id.
 * @param {object} [options] Decision 35 engine options (e.g.
 *        `allow_unverified_seed_offers`), forwarded unchanged to the read
 *        wrapper and then to Stage 1. Omitted means default OFF, so existing
 *        callers keep byte-identical behaviour.
 * @returns {Promise<object>} the frozen combined result (eleven fields, see
 *          above).
 */
async function runRecommendationFullRun(client, queryId, options) {
  const snap = await snapshot.runRecommendationSnapshot(client, queryId, options);
  const rankedResult = ranking.rankBuilds({ builds: snap.builds });
  const selection = ranking.selectDiverseTop({
    ranked: rankedResult.ranked,
    limit: ranking.TOP_N_PERSISTED,
    maxPerPair: ranking.MAX_PER_PAIR,
  });
  // Decision 22 item 3: Engine 6 fills the pre-write seam - pure, DB-free, and
  // copies only (the frozen selection is never mutated). The committed and
  // returned `selected` is the EXPLAINED array.
  const explained = explanation.explainSelection({
    selected: selection.selected,
    builds: snap.builds,
    contributions: snap.build_contributions,
    budget: { amount: snap.budget_amount, currency: snap.currency },
  });
  const persisted = await commit.runRecommendationCommit(
    client,
    queryId,
    explained,
    // OG-04: the pass's Engine 2D verdicts, so the commit wrapper can record
    // WHY each REJECTed candidate was rejected in build_rejection - in the SAME
    // transaction as the builds. Omitting this would leave the diagnostics
    // unwritten while everything else still committed.
    snap.filter_verdicts
  );
  return Object.freeze({
    query_id: snap.query_id,
    scoring_model_id: snap.scoring_model_id,
    builds: snap.builds,
    ranked: rankedResult.ranked,
    top_n: rankedResult.top_n,
    selected: explained,
    dropped_count: selection.dropped_count,
    persisted_ranks: persisted.persisted_ranks,
    build_candidate_ids: persisted.build_candidate_ids,
    recommendation_result_ids: persisted.recommendation_result_ids,
    // Decision 27: the pass diagnostic, passed through untouched. It is NOT
    // handed to explainSelection - Decision 27's Out-of-scope section forbids
    // changing Engine 6 output, and there is no UI or API surface to render
    // it into yet.
    budget_floor: snap.budget_floor,
  });
}

module.exports = { runRecommendationFullRun };
