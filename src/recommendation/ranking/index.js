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
 *   MAX_PER_PAIR           -> 3 (per-pair cap, Decision 20 section 3)
 */

const { rankBuilds, TOP_N_PERSISTED } = require('./rank');
const { selectDiverseTop, MAX_PER_PAIR } = require('./select-diverse');

module.exports = {
  rankBuilds,
  TOP_N_PERSISTED,
  selectDiverseTop,
  MAX_PER_PAIR,
};
