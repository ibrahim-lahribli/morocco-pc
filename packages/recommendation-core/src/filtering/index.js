/**
 * Engine 2D - Pure filtering barrel.
 *
 * The pure half of the Engine 2D filtering stage: `filterCandidates` (the
 * hard-compatibility verdict aggregation), its candidate-status vocabulary and
 * the Decision 11 iGPU handoff map. All three are pure functions of their
 * arguments and moved here from src/recommendation/filtering/ in step 4B PR 2.
 *
 * Deliberately NOT here, and not re-exported from this entry point:
 *   loadFilteringContext   - the B2-B database-backed context loader
 *   CONTEXT_COMPAT_KEYS    - a loader constant (RFC §11.3 item 2)
 *   filterCandidatesForRecommendation - the B2-G composition over the loader
 * They stay in the runtime tree (src/recommendation/filtering/) and remain
 * exported from the old barrel, so importing core can never pull in SQL.
 */
const { filterCandidates, CANDIDATE_STATUSES } = require('./filter');
const { buildIntegratedGpuPresentMap } = require('./igpu-map');

module.exports = { filterCandidates, CANDIDATE_STATUSES, buildIntegratedGpuPresentMap };
