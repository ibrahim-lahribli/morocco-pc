'use strict';

/**
 * Decision 18 (2026-09-21) — Engine 5a ranking (public surface).
 *
 * Boundary: a thin re-export-only barrel; this module introduces no logic of
 * its own, no additional contracts, and no pipeline. Ranking is pure in-memory
 * ordering of already-assembled, already-scored builds - no database access,
 * no SQL, and no persistence (Engine 5b, Decision 19/20, is separate and
 * future). Engine 3 assembly, Engine 4 scoring, and the orchestrator are all
 * out of scope here; this module is the sole owner of build-level ranking.
 *
 * Public surface (direct re-exports only - no wrappers, no copies):
 *   rankBuilds({ builds })  -> deeply frozen { ranked, top_n }
 *   TOP_N_PERSISTED        -> 10 (persistable top-N, Decision 18.4)
 */

const { rankBuilds, TOP_N_PERSISTED } = require('./rank');

module.exports = {
  rankBuilds,
  TOP_N_PERSISTED,
};
