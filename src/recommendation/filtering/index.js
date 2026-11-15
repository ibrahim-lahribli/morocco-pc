/**
 * Engine 2D - Filtering stage (B2-B context loader + B2-D filter + B2-G pipeline).
 *
 * COMPATIBILITY SHIM (step 4B PR 2). The pure half of this stage moved to
 * packages/recommendation-core/src/filtering/; the loader and the B2-G
 * composition stay here because they execute SQL. The six-export public
 * surface is unchanged and every re-export is by identity, so
 * filtering/index.test.js passes without an edit.
 *
 * Public surface:
 *
 *   loadFilteringContext()  - B2-B: assembles the frozen Engine 2D filtering
 *     context from an Engine 2C candidate-pool result and a validated
 *     pg-compatible `db` dependency (see ./context-loader).
 *
 *   filterCandidates()      - B2-D: pure hard-compatibility filter over the
 *     frozen context (now packages/recommendation-core/src/filtering).
 *
 *   CANDIDATE_STATUSES      - B2-D candidate verdict vocabulary.
 *   CONTEXT_COMPAT_KEYS     - canonical compat sub-context keys of the B2-B
 *     context; a loader constant, so it is NOT part of the core surface.
 *
 *   buildIntegratedGpuPresentMap() - Decision 11 iGPU handoff map, derived from
 *     the frozen filtering context (core).
 *
 *   filterCandidatesForRecommendation() - B2-G: canonical public Engine 2D
 *     filtering-stage entry point, composing loadFilteringContext(pool, db)
 *     -> filterCandidates(context) (see ./pipeline).
 *
 * Budget filtering, scoring, build generation and persistence belong to later
 * stages/engines. Candidate and error contracts are reused from Engine 2
 * (../candidates); this module defines no parallel contracts.
 */
const core = require('../../../packages/recommendation-core/src/filtering');
const { loadFilteringContext, CONTEXT_COMPAT_KEYS } = require('./context-loader');
const { filterCandidatesForRecommendation } = require('./pipeline');

module.exports = {
  loadFilteringContext,
  CONTEXT_COMPAT_KEYS,
  buildIntegratedGpuPresentMap: core.buildIntegratedGpuPresentMap,
  filterCandidates: core.filterCandidates,
  CANDIDATE_STATUSES: core.CANDIDATE_STATUSES,
  filterCandidatesForRecommendation,
};
