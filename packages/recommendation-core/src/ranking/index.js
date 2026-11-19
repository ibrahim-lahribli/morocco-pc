'use strict';

/**
 * Decision 18 (2026-09-21) + Decision 20 (2026-09-22) — Engine 5a ranking and
 * post-ranking pair-diversity selection (public surface).
 *
 * Boundary: a thin re-export-only barrel; this module introduces no logic of
 * its own, no additional contracts, and no pipeline. Ranking is pure in-memory
 * ordering of already-assembled, already-scored builds - no database access,
 * no SQL, and no persistence (Engine 5b, Decision 19/20, is separate and
 * future). Engine 3 assembly, Engine 4 scoring, and the orchestrator are all
 * out of scope here; this module is the sole owner of build-level ranking and
 * post-ranking pair-diversity selection.
 *
 * Public surface (direct re-exports only - no wrappers, no copies):
 *   rankBuilds({ builds })  -> deeply frozen { ranked, top_n }
 *   TOP_N_PERSISTED        -> 10 (persistable top-N, Decision 18.4)
 *   selectDiverseTop({ ranked, limit, maxPerPair }) -> deeply frozen { selected, dropped_count }
 *                            (LEGACY walk since E4 / Decision 41: still exported and
 *                            still the Decision 20 contract, no longer the showcase)
 *   MAX_PER_PAIR           -> 3 (per-pair cap, Decision 20 section 3)
 *   selectArchetypes({ ranked, budget, priority, archetypeObjectives }) ->
 *     deeply frozen { archetypes, reason_codes }  (archetypeObjectives is
 *     Decision 58's optional per-use-case weights; absent = pre-58 order)
 *                            (E4 / Decision 41; strategy_key persistence LANDED
 *                            in Platform migration 019 - applied on both databases)
 *   PERFORMANCE_FLOOR      -> 0.85 (E4 spend threshold, Decision 41)
 *   STRATEGIES             -> frozen ['PERFORMANCE','BALANCED','VALUE']
 *   REASON_CODES           -> frozen E4 degradation vocabulary
 */

const { rankBuilds, TOP_N_PERSISTED } = require('./rank');
const { selectDiverseTop, MAX_PER_PAIR } = require('./select-diverse');
const { selectArchetypes, PERFORMANCE_FLOOR, STRATEGIES, REASON_CODES } = require('./select-archetypes');

module.exports = {
  rankBuilds,
  TOP_N_PERSISTED,
  selectDiverseTop,
  MAX_PER_PAIR,
  selectArchetypes,
  PERFORMANCE_FLOOR,
  STRATEGIES,
  REASON_CODES,
};
