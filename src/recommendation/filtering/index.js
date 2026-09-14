/**
 * Engine 2D - Filtering stage (B2-B context loader + B2-D filter).
 *
 * Public surface:
 *
 *   loadFilteringContext()  - B2-B: assembles the frozen Engine 2D filtering
 *     context from an Engine 2C candidate-pool result and a validated
 *     pg-compatible `db` dependency. B2-B populates specs / platform_by_socket /
 *     compat from candidate-scoped, parameterized PostgreSQL queries (see
 *     ./context-loader).
 *
 *   filterCandidates()      - B2-D: pure hard-compatibility filter over the
 *     frozen context. Orchestrates the existing Engine 1 resolvers and
 *     aggregates check -> pair -> relationship -> candidate verdicts
 *     (PASS / UNKNOWN / REJECT). It performs no database access and never
 *     mutates its input (see ./filter).
 *
 *   CANDIDATE_STATUSES      - B2-D candidate verdict vocabulary.
 *   CONTEXT_COMPAT_KEYS     - canonical compat sub-context keys of the
 *     B2-B context.
 *
 * Budget filtering, scoring, build generation and persistence belong to
 * later stages/engines. Candidate and error contracts are reused from
 * Engine 2 (../candidates); this module defines no parallel contracts.
 */
const { loadFilteringContext, CONTEXT_COMPAT_KEYS } = require('./context-loader');
const { filterCandidates, CANDIDATE_STATUSES } = require('./filter');

module.exports = { loadFilteringContext, CONTEXT_COMPAT_KEYS, filterCandidates, CANDIDATE_STATUSES };