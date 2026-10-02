/**
 * Decision 12 - Per-role candidate retention, the ranking/top-K stage
 * (Engine 2D verdicts -> Engine 3 candidate pool).
 *
 * Boundary: pure composition over already-loaded, already-validated data. It
 * owns no logic beyond the Decision 14 Rules 2-5 ordering and capping: no
 * validation beyond the light gates, no policy, no SQL (the
 * assembly/pipeline.js composition convention).
 *
 * Decision 27 (2026-10-02) amends Rule 4's selection: retention is no longer
 * budget-blind. One slot of K is reserved for the cheapest eligible candidate
 * per role, so a budget below the score-driven top-K can still assemble. See
 * the "Rule 4 replacement" block below for the exact rule.
 *
 *   Engine 2D filter result { results: [verdict, ...] }  (PASS/UNKNOWN/REJECT)
 *   Engine 4 STEP 2 candidate scores { scores: [...] }
 *   Engine 2 Stage 1 price carrier { priceKey: { selected_price, ... } }
 *   candidate_caps.top_k_per_role (Decision 11-validated K)
 *         |  bucket by component_role; keep PASS | UNKNOWN  (Rule 2; REJECT
 *         |                                                   is excluded before
 *         |                                                   ranking)
 *         |  order per bucket: candidate_score DESC, then the existing
 *         |  candidates/select.js compareCandidates() tie-break (Rules 3/5;
 *         |  reused, never reimplemented)
 *         |  retain the first K per role                    (Rule 4, as
 *         |                                                   replaced by
 *         |                                                   Decision 27: the
 *         |                                                   first K-1 PLUS the
 *         |                                                   cheapest eligible
 *         |                                                   candidate; the cap
 *         |                                                   is unchanged, only
 *         |                                                   selection inside it)
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
 *   prices            the Engine 2 Stage 1 carrier (offers.selectOfferPrices),
 *                     the SAME frozen null-prototype object Engine 3 receives.
 *                     Owned by Engine 2; retention only reads selected_price
 *                     through it and never validates, copies or edits it.
 *                     Required: an eligible verdict with no carrier entry (or a
 *                     non-finite selected_price) fails fast rather than being
 *                     read as 0, because an unpriced candidate that won the
 *                     reservation would then fail every downstream budget
 *                     check - turning a data gap into a silent quality loss
 *
 * Rule 4 replacement (Decision 27) - the cheapest-per-role reservation:
 *   - a bucket holding n <= K eligible candidates is returned WHOLE and
 *     untouched: nothing is being cut, so no price is consulted and nothing is
 *     reordered or dropped;
 *   - otherwise the bucket keeps the first K-1 entries of the Rule 3/5 order
 *     PLUS the single cheapest eligible candidate by selected_price, topped up
 *     from the remaining entries in that same order until the set holds K. The
 *     top-up is what keeps retained_count at min(K, eligible_count) when the
 *     reservation duplicates a candidate the K-1 slice already held; the cap
 *     itself is unchanged either way;
 *   - ties on selected_price are broken by position in the Rule 3/5 order, i.e.
 *     by the earliest candidate in an already-deterministic order. This is not
 *     hypothetical: 004b_ssd_ram.sql ships two RAM kits at an identical 1349
 *     MAD. With equal prices the reservation head IS the Rule 3/5 head, which
 *     is already inside the K-1 slice, so the reservation is a no-op;
 *   - the selected set is re-emitted in Rule 3/5 order, so the OUTPUT ORDERING
 *     contract is unchanged and only membership differs;
 *   - at K = 1 the K-1 slice is empty and the reservation alone fills the
 *     slot. Score contributes nothing at K=1, which is correct - there is no
 *     score competition to arbitrate - and is pinned by a test;
 *   - a REJECT is excluded by Rule 2 before any price is read, so a cheap
 *     REJECTed candidate can never take the reservation;
 *   - the reservation is a FLOOR guarantee, not a completeness guarantee. It
 *     makes the cheapest-per-role combination reachable; it cannot promise
 *     that combination survives Engine 3's pairwise FAIL gate, so
 *     "within budget but 0 builds" stays a legitimate outcome.
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
 *   - no Engine 3 work: assembly, GPU policy and max_builds_per_query
 *     (Decision 14 Rule 7) stay untouched
 *   - exactly ONE Engine 3 import is permitted, and Decision 27 item 3 is the
 *     authority for it: priceKey from ../assembly/prices, a pure key
 *     constructor with no logic, imported so the carrier key format keeps a
 *     single owner (offers/select.js imports it for the same reason). These
 *     specifiers stay forbidden, and retention/index.test.js bans each of them
 *     BY NAME - the assembler (../assembly/assemble), the composition entry
 *     point (../assembly/pipeline), the GPU policy (../assembly/gpu-policy),
 *     the Engine 3 input validator (../assembly/input), the barrel
 *     (../assembly/index), and anything upward at
 *     ../orchestrator or ../persistence. The ban is therefore aimed at the
 *     single permitted edge, not lifted
 *   - no new error codes and no second status vocabulary: the Engine 2
 *     CandidateSelectionError / ERROR_CODES vocabulary and the Engine 2D
 *     CANDIDATE_STATUSES are reused unchanged
 *   - no persistence
 *
 * Determinism: no clock reads, no randomness, no I/O; buckets are emitted in
 * canonical COMPONENT_ROLES order (the Engine 2D emission order), and the
 * reservation tie-break is the Rule 3/5 order, so identical inputs yield
 * deeply equal, stably ordered output.
 *
 * Pure: no database access, no framework.
 */

'use strict';

const { compareCandidates } = require('../candidates/select');
const { COMPONENT_ROLES } = require('../candidates/roles');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const { CANDIDATE_STATUSES } = require('../filtering/filter');
// Decision 27 item 3: the single permitted Engine 3 import - a pure key
// constructor, so the price-carrier key format keeps exactly one owner.
const { priceKey } = require('../assembly/prices');

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

/**
 * Own-property read that is immune to a prototype key. The carrier is
 * null-prototype, but pricesOf-style callers can hand a plain object, and a
 * truthy inherited property would silently price a candidate at the wrong
 * value.
 */
function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
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
 * The Stage 1 selected_price for one eligible verdict, or a fail-fast.
 *
 * A missing carrier entry and a non-finite selected_price are the SAME defect
 * (the price is UNKNOWN) and are reported the same way, in the existing
 * vocabulary and on the existing field. Neither is ever coerced to 0: this
 * value decides the reservation, so an unpriced candidate treated as free
 * would win the slot and then fail every downstream budget check, turning a
 * data gap into a silent quality loss.
 *
 * Only called for buckets that actually exceed K, because a bucket that fits
 * is returned whole and never consults a price.
 */
function priceOf(prices, verdict) {
  const key = priceKey(verdict.product_id, verdict.product_variant_id, verdict.component_role);
  const entry = hasOwn(prices, key) ? prices[key] : undefined;
  if (entry === undefined || typeof entry.selected_price !== 'number'
      || !Number.isFinite(entry.selected_price)) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'prices',
      `"prices" has no usable selected_price for the eligible verdict ${key} - the cheapest-per-role reservation (Decision 27) cannot rank it, and a missing price is never read as 0`
    );
  }
  return entry.selected_price;
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
 *        - prices: the Engine 2 Stage 1 price carrier (Decision 27), the
 *          same frozen null-prototype object Engine 3 receives; REQUIRED
 * @returns {object} frozen { results: [retained verdict, ...] } - the exact
 *        Engine 3 candidate-pool input shape: verdicts are the producer's
 *        records handed over by reference, buckets in canonical
 *        COMPONENT_ROLES order, each bucket in Rule 3/5 retention order
 * @throws {CandidateSelectionError} fail-fast on a missing/malformed source,
 *        a malformed verdict or score entry, a duplicate score identity, an
 *        eligible verdict without a score, a non-positive-integer K, a
 *        malformed price carrier, or an eligible verdict the reservation cannot
 *        price (missing entry or non-finite selected_price)
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
  const { filterResult, candidateScores, topKPerRole, prices } = sources;

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

  // Decision 27: the Stage 1 price carrier is REQUIRED, because the
  // cheapest-per-role reservation cannot select without it. This is the LAST
  // light gate on purpose: the three pre-existing gates above keep ownership of
  // their own failure codes, so a caller that wired filterResult,
  // candidateScores or topKPerRole wrong is still told which one. The check
  // here is deliberately shallow - it proves only that a carrier-shaped object
  // arrived; per-entry validation is lazy, in priceOf(), and only fires for a
  // bucket that actually exceeds K.
  //
  // validatePrices is deliberately NOT re-run: the carrier is already validated
  // by Stage 1, and re-validating it would duplicate Engine 3's contract here.
  if (prices === null || typeof prices !== 'object' || Array.isArray(prices)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'prices',
      '"prices" must be the Engine 2 Stage 1 price carrier (a null-prototype object keyed by priceKey)'
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
    // n <= K: nothing is being cut, so the bucket is returned whole and no
    // price is consulted at all.
    if (bucket.length <= topKPerRole) {
      for (const entry of bucket) {
        retained.push(entry.verdict);
      }
      return;
    }
    // Decision 27: reserve one slot for the cheapest eligible candidate. A
    // STRICTLY lower price moves the reservation, so equal prices fall to the
    // earliest Rule 3/5 position - and that entry is already inside the
    // top-(K-1) slice, which makes the reservation a no-op when prices tie.
    let cheapest = 0;
    for (let index = 1; index < bucket.length; index += 1) {
      if (priceOf(prices, bucket[index].verdict) < priceOf(prices, bucket[cheapest].verdict)) {
        cheapest = index;
      }
    }
    // Membership is by object identity and every bucket entry is a distinct
    // { verdict, score } object, so Set membership is exact - and the K-1
    // slice is empty at K=1, where the reservation alone fills the slot.
    const selected = new Set(bucket.slice(0, topKPerRole - 1));
    selected.add(bucket[cheapest]);
    // Top the set back UP to the unchanged cap, drawing the remainder in Rule
    // 3/5 order. Without this the bucket would retain only K-1 entries whenever
    // the reservation duplicated a candidate the K-1 slice already held, which
    // would silently shrink retention BELOW min(K, eligible_count). The cap is
    // not part of this change. Because bucket.length > K on this path, the
    // top-up always has an entry to draw on.
    for (const entry of bucket) {
      if (selected.size >= topKPerRole) break;
      selected.add(entry);
    }
    // Re-emitted in Rule 3/5 order: the reservation changes membership, never
    // the output ordering contract.
    for (const entry of bucket) {
      if (selected.has(entry)) {
        retained.push(entry.verdict);
      }
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