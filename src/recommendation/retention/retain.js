/**
 * Decision 12 - Per-role candidate retention, the ranking/top-K stage
 * (Engine 2D verdicts -> Engine 3 candidate pool).
 *
 * Boundary: pure composition over already-loaded, already-validated data. It
 * owns no logic beyond the Decision 14 Rules 2-5 ordering and capping: no
 * validation beyond the light gates, no policy, no SQL (the
 * assembly/pipeline.js composition convention).
 *
 *   Engine 2D filter result { results: [verdict, ...] }  (PASS/UNKNOWN/REJECT)
 *   Engine 4 STEP 2 candidate scores { scores: [...] }
 *   candidate_caps.top_k_per_role (Decision 11-validated K)
 *         |  bucket by component_role; keep PASS | UNKNOWN  (Rule 2; REJECT
 *         |                                                   is excluded before
 *         |                                                   ranking)
 *         |  order per bucket: candidate_score DESC, then the existing
 *         |  candidates/select.js compareCandidates() tie-break (Rules 3/5;
 *         |  reused, never reimplemented)
 *         |  retain the first K per role                    (Rule 4:
 *         |                                                   retained_count =
 *         |                                                   min(K, eligible_count))
 *         v
 *   frozen { results: [retained verdict, ...] } - the shape Engine 3's
 *   existing candidate-pool input already expects ({ results } of Engine 2D
 *   verdicts; Decision 14 Rule 6: Engine 3 changes nothing)
 *
 * Field sourcing (no invention, one owner per field):
 *   verdicts          the Engine 2D filter result entries, handed over
 *                     intact by reference: identity, status, reason,
 *                     relationships and unknown_pairwise_count are never
 *                     mutated, reordered in place, copied, or extended
 *   candidate_score   Engine 4 computeCandidateScores (Decision 13 STEP 2),
 *                     looked up by the canonical Engine 2C identity
 *                     (product_id, product_variant_id, component_role - the
 *                     same key construction candidates/select.js
 *                     deduplicates with); it orders the retention only and
 *                     is never written onto a verdict
 *   topKPerRole       candidate_caps.top_k_per_role (Decision 11 Rule 8),
 *                     the same K for every role
 *
 * Eligibility and identity rules:
 *   - eligible statuses are exactly CANDIDATE_STATUSES.PASS | UNKNOWN
 *     (Decision 14 Rule 2); REJECT is excluded before any score lookup and
 *     therefore never requires a score entry;
 *   - a score entry whose identity has no eligible verdict (the pool-wide
 *     STEP 2 output includes REJECTed candidates) is ignored;
 *   - an eligible verdict without a score entry fails fast (an eligible
 *     candidate cannot be ranked deterministically without its STEP 2
 *     score);
 *   - duplicate score identities fail fast (STEP 2 over the deduped 2C pool
 *     yields unique identities; a duplicate is a caller wiring bug);
 *   - the Rule 5 chain ends in unique identity keys, so it is a total order
 *     per role bucket and the candidate at position K is uniquely and
 *     reproducibly determined - equal scores never expand retention.
 *
 * Output freezing: emitted verdicts are sealed by a private freezer first
 * (a no-op for the producer's already-frozen filterCandidates records), then
 * the results array and the container. Verdicts are never field-edited.
 *
 * Explicit NON-responsibilities (deliberately absent from this module)
 *   - no database access, no connection, no SQL, no I/O
 *   - no compatibility evaluation and no verdict aggregation (Engine 2D)
 *   - no scoring and no score arithmetic (Engine 4)
 *   - no Engine 5 build ranking (whole-build build_score, Decision 13 STEP 3)
 *   - no Engine 3 work: assembly, GPU policy, prices, and
 *     max_builds_per_query (Decision 14 Rule 7) stay untouched
 *   - no new error codes and no second status vocabulary: the Engine 2
 *     CandidateSelectionError / ERROR_CODES vocabulary and the Engine 2D
 *     CANDIDATE_STATUSES are reused unchanged
 *   - no persistence
 *
 * Determinism: no clock reads, no randomness, no I/O; buckets are emitted in
 * canonical COMPONENT_ROLES order (the Engine 2D emission order), so
 * identical inputs yield deeply equal, stably ordered output.
 *
 * Pure: no database access, no framework.
 */

'use strict';

const { compareCandidates } = require('../candidates/select');
const { COMPONENT_ROLES } = require('../candidates/roles');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const { CANDIDATE_STATUSES } = require('../filtering/filter');

/** Verdict statuses eligible for retention (Decision 14 Rule 2). */
const RETENTION_ELIGIBLE_STATUSES = Object.freeze([
  CANDIDATE_STATUSES.PASS,
  CANDIDATE_STATUSES.UNKNOWN,
]);

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Canonical Engine 2C identity key (candidates/select.js dedup key). */
function identityKey(productId, variantId, role) {
  return JSON.stringify([productId, variantId, role]);
}

/**
 * Identity -> candidate_score index over the Engine 4 STEP 2 batch output.
 * Fails fast on a malformed entry and on duplicate identities.
 */
function buildScoreIndex(candidateScores) {
  const scoreByIdentity = new Map();
  for (const entry of candidateScores.scores) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof entry.product_id !== 'string' ||
      typeof entry.component_role !== 'string' ||
      !Number.isFinite(entry.candidate_score)
    ) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'candidateScores',
        '"candidateScores.scores" entries must carry a string product_id, a string component_role and a finite candidate_score'
      );
    }
    const key = identityKey(entry.product_id, entry.product_variant_id, entry.component_role);
    if (scoreByIdentity.has(key)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'candidateScores',
        `"candidateScores.scores" carries a duplicate candidate identity: ${key} (STEP 2 over the deduped 2C pool yields unique identities)`
      );
    }
    scoreByIdentity.set(key, entry.candidate_score);
  }
  return scoreByIdentity;
}

/**
 * Rule 3/5 retention order for one role bucket: candidate score descending,
 * then the existing compareCandidates() chain - reused, never reimplemented.
 * Within a role bucket the comparator's role term is constant, so the
 * effective chain is product_id ASC, then product_variant_id NULL-first then
 * ASC (Decision 14 Rule 5). Both operands are finite STEP 2 scores, so the
 * subtraction is exact.
 */
function byScoreDescThenCanonical(a, b) {
  return b.score - a.score || compareCandidates(a.verdict, b.verdict);
}

/** Small private recursive freezer; no shared helper module is created. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  Object.freeze(value);
  return value;
}

/**
 * Retain, per component_role, the first candidate_caps.top_k_per_role (K)
 * eligible (PASS | UNKNOWN) candidates ordered by candidate score descending
 * with the existing compareCandidates() chain as the deterministic tie-break
 * (Decision 12; Decision 14 Rules 2-5).
 *
 * @param {object} sources single argument object carrying:
 *        - filterResult: the Engine 2D filter result { results }
 *          (filterCandidates output)
 *        - candidateScores: the Engine 4 computeCandidateScores output
 *          { scores } (Decision 13 STEP 2)
 *        - topKPerRole: the positive-integer K
 *          (candidate_caps.top_k_per_role, Decision 11 Rule 8)
 * @returns {object} frozen { results: [retained verdict, ...] } - the exact
 *        Engine 3 candidate-pool input shape: verdicts are the producer's
 *        records handed over by reference, buckets in canonical
 *        COMPONENT_ROLES order, each bucket in Rule 3/5 retention order
 * @throws {CandidateSelectionError} fail-fast on a missing/malformed source,
 *        a malformed verdict or score entry, a duplicate score identity, an
 *        eligible verdict without a score, or a non-positive-integer K
 */
function retainTopKPerRole(sources) {
  if (sources === undefined || sources === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      null,
      'Candidate retention requires a sources object'
    );
  }
  if (!isPlainObject(sources)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      null,
      'Candidate retention requires an object carrying filterResult, candidateScores and topKPerRole'
    );
  }
  const { filterResult, candidateScores, topKPerRole } = sources;

  // --- light gates (fail fast, before any work; existing vocabulary) -------
  if (!isPlainObject(filterResult) || !Array.isArray(filterResult.results)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'filterResult',
      '"filterResult" must be the Engine 2D filter result exposing a "results" array'
    );
  }
  if (!isPlainObject(candidateScores) || !Array.isArray(candidateScores.scores)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'candidateScores',
      '"candidateScores" must be the Engine 4 computeCandidateScores output exposing a "scores" array'
    );
  }
  if (
    typeof topKPerRole !== 'number' ||
    !Number.isFinite(topKPerRole) ||
    !Number.isInteger(topKPerRole) ||
    topKPerRole <= 0
  ) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'topKPerRole',
      '"topKPerRole" must be a positive integer (candidate_caps.top_k_per_role, Decision 11 Rule 8)'
    );
  }

  const scoreByIdentity = buildScoreIndex(candidateScores);

  // --- Rule 2: bucket the eligible verdicts per role; REJECT never ranks ---
  const bucketsByRole = new Map();
  for (const verdict of filterResult.results) {
    if (verdict === null || typeof verdict !== 'object' || Array.isArray(verdict)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'filterResult',
        '"filterResult.results" entries must be Engine 2D candidate verdicts'
      );
    }
    if (!RETENTION_ELIGIBLE_STATUSES.includes(verdict.status)) {
      continue; // REJECT (from the real producer, only REJECT) never ranks.
    }
    const score = scoreByIdentity.get(
      identityKey(verdict.product_id, verdict.product_variant_id, verdict.component_role)
    );
    if (score === undefined) {
      fail(
        ERROR_CODES.MISSING_REQUIRED_FIELD,
        'candidateScores',
        `"candidateScores" has no candidate_score for the eligible verdict ${identityKey(
          verdict.product_id,
          verdict.product_variant_id,
          verdict.component_role
        )} - an eligible candidate cannot be ranked without its Decision 13 STEP 2 score`
      );
    }
    let bucket = bucketsByRole.get(verdict.component_role);
    if (bucket === undefined) {
      bucket = [];
      bucketsByRole.set(verdict.component_role, bucket);
    }
    bucket.push({ verdict, score });
  }

  // --- Rules 3/5 + Rule 4: order each bucket, retain the first K -----------
  const retained = [];
  const retainBucket = (bucket) => {
    bucket.sort(byScoreDescThenCanonical);
    for (const entry of bucket.slice(0, topKPerRole)) {
      retained.push(entry.verdict);
    }
  };
  for (const role of COMPONENT_ROLES) {
    const bucket = bucketsByRole.get(role);
    if (bucket !== undefined) {
      retainBucket(bucket);
      bucketsByRole.delete(role);
    }
  }
  // Defensive only: the real producer (filterCandidates) emits exactly the
  // canonical COMPONENT_ROLES. Should a foreign role ever appear, its bucket
  // is still retained (capped at K) and emitted after the canonical ones in
  // first-encounter order - deterministic either way.
  for (const bucket of bucketsByRole.values()) {
    retainBucket(bucket);
  }

  // Seal the verdicts first (a no-op for the producer's already-frozen
  // records), then the array, then the container.
  for (const verdictRecord of retained) {
    deepFreeze(verdictRecord);
  }
  return Object.freeze({ results: Object.freeze(retained) });
}

module.exports = { retainTopKPerRole };