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
 *     -> ranking.selectArchetypes({ ranked, budget, priority }) - E4 / Decision
 *        41, which REPLACED the Decision 20 selectDiverseTop walk here; up to
 *        three pair-distinct archetypes, output-ordered by priority
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
 * Decision 38: options.asOf is optional ISO time with an explicit timezone;
 * when supplied it pins scoring/offer freshness, otherwise the transaction clock remains.
 * @returns {Promise<object>} the frozen combined result (eleven fields, see
 *          above).
 */
async function runRecommendationFullRun(client, queryId, options) {
  const snap = await snapshot.runRecommendationSnapshot(client, queryId, options);
  const rankedResult = ranking.rankBuilds({ builds: snap.builds });
  // E4 (Decision 41): the archetype selection REPLACES the selectDiverseTop
  // walk as the pre-persistence showcase. Priority comes from the snapshot
  // query row; strategy_key persistence is DEFERRED until Platform migration
  // 019 adds recommendation_result.strategy_key - the archetypes' strategy
  // keys are RETURNED here, not written.
  const selection = ranking.selectArchetypes({
    ranked: rankedResult.ranked,
    budget: { amount: snap.budget_amount, currency: snap.currency },
    priority: snap.priority,
  });
  // Decision 22 item 3: Engine 6 fills the pre-write seam - pure, DB-free, and
  // copies only (the frozen selection is never mutated). The committed and
  // returned `selected` is the explained array, E4-shape: the archetypes are
  // explained with the SAME entries Engine 6 exists for (see E4 wiring note
  // in the header).
  const explained = explanation.explainSelection({
    selected: selection.archetypes,
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
    archetypes: selection.archetypes,
    archetype_reason_codes: selection.reason_codes,
    dropped_count: 0,
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
