/**
 * Decision 12 - Candidate retention stage (per-role top-K, Engine 2D -> Engine 3).
 *
 * Boundary: a thin pure composition over already-loaded, already-validated
 * data, following the assembly/pipeline.js composition convention exactly. It
 * owns no logic of its own: no validation beyond the light gates, no policy,
 * no SQL. Pipeline position (Decision 12):
 *
 *   Engine 2C (pool) -> Engine 2D (filter) -> retention/ (here) -> Engine 3
 *
 *   Engine 2D filter result { results: [verdict, ...] }  (PASS/UNKNOWN/REJECT)
 *   Engine 4 STEP 2 candidate scores { scores: [...] }
 *   candidate_caps.top_k_per_role (Decision 11-validated K)
 *         |  retainTopKPerRole(...)      - per-role top-K retention
 *         |                                (./retain): Rule 2 eligibility
 *         |                                (PASS | UNKNOWN), Rule 3/5 ordering
 *         |                                (score DESC, then the existing
 *         |                                compareCandidates() tie-break),
 *         |                                Rule 4 hard cap
 *         v
 *   frozen { results: [retained verdict, ...] } - Engine 3's existing
 *   candidate-pool input shape; drop-in for filterResult (Decision 14
 *   Rule 6: Engine 3 changes nothing)
 *
 * Public surface (direct re-export only - no wrappers, no logic):
 *
 *   retainTopKPerRole({ filterResult, candidateScores, topKPerRole })
 *     - the Decision 12 retention stage (see ./retain).
 *
 * Field sourcing (no invention, one owner per field):
 *   verdicts          Engine 2D filter result, handed over intact by
 *                     reference (no fields added, none removed)
 *   candidate_score   Engine 4 computeCandidateScores (Decision 13 STEP 2);
 *                     orders the retention only, never written onto a verdict
 *   topKPerRole       candidate_caps.top_k_per_role (Decision 11 Rule 8),
 *                     the same K for every role
 *
 * Explicit NON-responsibilities (deliberately absent from this module)
 *   - no database access, no connection, no SQL: the loaders
 *     (loadCandidates, loadFilteringContext, loadComponentAssessments,
 *     loadScoringModel) are the caller's to run; this module receives their
 *     outputs, so retention/ stays database-free (same policy as the Engine
 *     2D B2-G pipeline, filtering/pipeline.js, and the Engine 3 composition
 *     entry point, assembly/pipeline.js)
 *   - no compatibility evaluation, no verdict aggregation (Engine 2D owns it)
 *   - no scoring and no score arithmetic (Engine 4 owns it)
 *   - no Engine 5 build ranking (whole-build build_score, Decision 13 STEP 3)
 *   - no Engine 3 work: assembly, GPU policy, prices, and
 *     max_builds_per_query (Decision 14 Rule 7) stay untouched
 *   - no new error codes and no second status vocabulary: the Engine 2
 *     error vocabulary and the Engine 2D CANDIDATE_STATUSES are reused
 *   - no persistence
 *
 * Determinism: no clock reads, no randomness, no I/O; identical inputs yield
 * deeply equal output in canonical COMPONENT_ROLES bucket order.
 *
 * Pure: no database access, no framework.
 */

'use strict';

const { retainTopKPerRole } = require('./retain');

module.exports = { retainTopKPerRole };