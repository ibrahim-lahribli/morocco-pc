/**
 * Engine 4 - STEP 3: build score per assembled build.
 *
 * Decision 13 (docs/RECOMMENDATION_ENGINE_DECISIONS.md:1778-1792), verbatim:
 *
 *   build_score_raw
 *       = sum_(role,type)[ role_weights[role][type] * type_weights[type]
 *                          * effective(component_in_role, type) ]
 *         / sum_(role,type)[ role_weights[role][type] * type_weights[type] ]
 *
 *   build_score = clamp(build_score_raw
 *                       - (unknown_compat_penalty
 *                          * count of UNKNOWN pairwise compatibility checks
 *                            in the build),
 *                       0, 100)
 *
 * Rationale bindings (Decision 13): `unknown_compat_penalty` is applied
 * PER-OCCURRENCE (compounding with multiple UNKNOWN pairs); a missing or
 * optional role in the build is EXCLUDED from the weighted average with a
 * renormalized denominator ("not applicable", not "bad" - Decision 10's
 * required_roles distinction). effective() is STEP 1, shared verbatim with
 * STEP 2 (./effective-score).
 *
 * Consumes:  single argument object carrying `build` (a frozen Engine 3
 *            build: { components: [...], total_price, currency,
 *            unknown_pairwise_count }), the frozen assessment map from
 *            ./load-assessments, the validated Decision 3(a) configuration,
 *            `nowMs`, and `unknownPairwiseCount`. In the batch form
 *            (computeBuildScores) `unknownPairwiseCounts` is OPTIONAL: an
 *            explicit array wins (injection stays supported for callers that
 *            derive the count differently); when absent, the count is read
 *            per build from `build.unknown_pairwise_count` (Decision 15).
 * Produces:  one build score (number in [0, 100]), or - for the batch form -
 *            a frozen { scores: [...] } array index-aligned with the input
 *            builds in discovery order.
 *
 * BLOCKING QUESTION B1 (2026-09-19 plan, item 2/7): RESOLVED (2026-09-19,
 * Decision 15 in docs/RECOMMENDATION_ENGINE_DECISIONS.md). Engine 2D now
 * counts, per verdict, the pairwise checks whose aggregated status resolved
 * UNKNOWN (filter.js `unknown_pairwise_count`), and Engine 3 sums those
 * counts per assembled build (assemble.js `unknown_pairwise_count`). The
 * count is a plain integer carry-forward: pair-identity lists and per-build
 * pair recomputation were rejected (Decision 15). Nothing in this module
 * re-derives compatibility; it consumes the producer's number.
 *
 * Role domain (Engine 3 v1 contract): builds carry at most one component per
 * EXPANSION_ORDER role (assemble.js traversal; one verdict per role, GPU
 * walked per path). Roles absent from the build are renormalized away; a
 * build role missing from `role_weights` fails fast (DECISION REQUIRED A6).
 * Type domain (DECISION REQUIRED A4, adopted PROPOSAL): per build role,
 * `sum_type` runs over the configured key set of `role_weights[role]`, and
 * `type_weights` must cover each such type (finite) - fail fast otherwise.
 * Weight-sum guard (DECISION REQUIRED A5): the build denominator must be
 * positive, fail fast otherwise.
 *
 * Explicit NON-responsibilities: no database access, no I/O, no clock reads,
 * no ranking, no tie-breaking (owned by ../retention, Decision 12 RESOLVED
 * 2026-09-20), no compatibility evaluation,
 * no UNKNOWN re-derivation (B1), no persistence (build_candidate.score is
 * Engine 5's write).
 *
 * Pure and deterministic: same inputs always yield the same number; role
 * iteration follows the frozen EXPANSION_ORDER and the configuration's key
 * order, never component order.
 *
 * Decision 22 item 1 (2026-09-24) - ADDITIVE contributions exposure:
 * `computeBuildScoreContributions` is a sibling of `computeBuildScores` that
 * returns the per-(role,type) `{ role, type, effective_score, weight }` inputs
 * that ALREADY produced `build_score` (the STEP 1 / STEP 3 values, iterated in
 * this same EXPANSION_ORDER-then-configuration-type-key order). It is additive
 * only: `computeBuildScore` / `computeBuildScores` keep their return shapes and
 * behavior byte-for-byte, and nothing downstream is wired to it here.
 */

'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const { isValidComponentRole } = require('../candidates/roles');
const { EXPANSION_ORDER } = require('../assembly/assemble');
const { selectAssessmentRow, computeEffectiveScore } = require('./effective-score');

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Light gate over the fields STEP 3 consumes (role_weights, type_weights,
 * unknown_compat_penalty).
 */
function validateConfiguration(configuration) {
  if (configuration === null || typeof configuration !== 'object' || Array.isArray(configuration)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'configuration',
      'STEP 3 requires the validated Decision 3(a) scoring-model configuration object'
    );
  }
  const role_weights = configuration.role_weights;
  if (role_weights === null || typeof role_weights !== 'object' || Array.isArray(role_weights)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'role_weights', '"role_weights" must be an object keyed by component role');
  }
  const type_weights = configuration.type_weights;
  if (type_weights === null || typeof type_weights !== 'object' || Array.isArray(type_weights)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'type_weights', '"type_weights" must be an object keyed by assessment type');
  }
  const penalty = configuration.unknown_compat_penalty;
  if (penalty === undefined || penalty === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'unknown_compat_penalty', '"unknown_compat_penalty" is required');
  }
  if (!isFiniteNumber(penalty) || penalty < 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'unknown_compat_penalty', '"unknown_compat_penalty" must be a finite number >= 0');
  }
}

function validateNowMs(nowMs) {
  if (nowMs === undefined || nowMs === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'nowMs',
      '"nowMs" is required (injected decision timestamp; no clock reads)'
    );
  }
  if (!isFiniteNumber(nowMs)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'nowMs', '"nowMs" must be a finite epoch-millisecond number');
  }
}

/** Light gate over the assessments map (the ./load-assessments output shape). */
function validateAssessments(assessments) {
  if (assessments === undefined || assessments === null) {
    return;
  }
  if (typeof assessments !== 'object' || Array.isArray(assessments)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'assessments',
      '"assessments" must be the frozen loader map { [product_id]: [rows, ...] }'
    );
  }
}

/**
 * Light gate over one Engine 3 build. The build components are re-checked
 * for exactly what the weighted sum consumes: a valid component role from
 * EXPANSION_ORDER, one component per role (Engine 3 v1 emits one verdict per
 * role per path), and a non-empty product_id for assessment lookup.
 */
function validateBuild(build) {
  if (build === null || typeof build !== 'object' || Array.isArray(build)) {
    fail(ERROR_CODES.INVALID_INPUT, 'build', 'STEP 3 requires a frozen Engine 3 build object');
  }
  if (!Array.isArray(build.components) || build.components.length === 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'build.components', '"build.components" must be a non-empty array');
  }
}

function validateUnknownPairwiseCount(unknownPairwiseCount) {
  if (unknownPairwiseCount === undefined || unknownPairwiseCount === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'unknownPairwiseCount',
      '"unknownPairwiseCount" is required (the Engine 3 build\'s "unknown_pairwise_count" or an explicit injected count, Decision 15)'
    );
  }
  if (!Number.isInteger(unknownPairwiseCount) || unknownPairwiseCount < 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'unknownPairwiseCount',
      '"unknownPairwiseCount" must be a non-negative integer'
    );
  }
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

/** Bucket the validated components by EXPANSION_ORDER role (one per role). */
function componentsByRole(build) {
  const byRole = {};
  for (let index = 0; index < build.components.length; index += 1) {
    const component = build.components[index];
    const where = `build.components.${index}`;
    if (component === null || typeof component !== 'object' || Array.isArray(component)) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, where, `Build component "${where}" must be an object`);
    }
    const { component_role, product_id } = component;
    if (typeof product_id !== 'string' || product_id.length === 0) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, `${where}.product_id`, `"${where}.product_id" must be a non-empty string`);
    }
    if (!isValidComponentRole(component_role)) {
      fail(
        ERROR_CODES.INVALID_COMPONENT_ROLE,
        `${where}.component_role`,
        `"${where}.component_role" "${String(component_role)}" is not a canonical component role`
      );
    }
    if (!EXPANSION_ORDER.includes(component_role)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        `${where}.component_role`,
        `"${where}.component_role" "${component_role}" does not participate in Engine 3 v1 builds`
      );
    }
    if (byRole[component_role] !== undefined) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'build.components',
        `Build carries more than one "${component_role}" component (Engine 3 v1 builds are one-per-role)`
      );
    }
    byRole[component_role] = component;
  }
  return byRole;
}

/**
 * Decision 22 item 1 - shared STEP 3 accumulation (single computation path).
 *
 * Iterates EXPANSION_ORDER roles, then each role's configuration type keys -
 * the exact order computeBuildScore has always used - accumulating the weighted
 * numerator/denominator AND recording every item
 * `{ role, type, effective_score, weight }` with
 * `weight = role_weights[role][type] * type_weights[type]` and
 * `effective_score = effective(component_in_role, type)` (STEP 1).
 *
 * computeBuildScore uses only numerator/denominator, so its output stays
 * byte-identical; computeBuildScoreContributions returns the items. Validation
 * is the CALLER's responsibility - the UNKNOWN count is not consumed here.
 */
function accumulateBuild({ build, assessments, configuration, nowMs }) {
  const byRole = componentsByRole(build);

  let numerator = 0;
  let denominator = 0;
  const contributions = [];
  for (const role of EXPANSION_ORDER) {
    const component = byRole[role];
    if (component === undefined) {
      continue; // Missing/optional role: excluded, denominator renormalizes.
    }
    const byType = configuration.role_weights[role];
    if (byType === undefined || byType === null || typeof byType !== 'object' || Array.isArray(byType)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        `role_weights.${role}`,
        `"role_weights" requires the build role "${role}" (DECISION REQUIRED A6: fail-fast chosen)`
      );
    }
    const productRows =
      assessments === undefined || assessments === null ? undefined : assessments[component.product_id];
    for (const assessmentType of Object.keys(byType)) {
      const roleWeight = byType[assessmentType];
      if (!isFiniteNumber(roleWeight)) {
        fail(
          ERROR_CODES.INVALID_FIELD_VALUE,
          `role_weights.${role}.${assessmentType}`,
          `"role_weights.${role}.${assessmentType}" must be a finite number`
        );
      }
      const typeWeight = configuration.type_weights[assessmentType];
      if (!isFiniteNumber(typeWeight)) {
        fail(
          ERROR_CODES.INVALID_FIELD_VALUE,
          `type_weights.${assessmentType}`,
          `"type_weights" must cover the configured type "${assessmentType}" (DECISION REQUIRED A4: fail-fast chosen)`
        );
      }
      const row = selectAssessmentRow(productRows, assessmentType);
      const effective = computeEffectiveScore({ assessment: row, configuration, nowMs });
      const weight = roleWeight * typeWeight;
      numerator += weight * effective;
      denominator += weight;
      contributions.push({ role, type: assessmentType, effective_score: effective, weight });
    }
  }
  return { numerator, denominator, contributions };
}

/**
 * Compute the Decision 13 STEP 3 build score for one assembled build.
 *
 * Iterates EXPANSION_ORDER (never component order): roles absent from the
 * build are excluded and the denominator renormalizes (Decision 13
 * rationale); a present role without a `role_weights` entry fails fast
 * (DECISION REQUIRED A6); each configured type contributes
 * role_weight * type_weight * STEP 1 effective(component, type), with
 * `type_weights` required to cover the type (DECISION REQUIRED A4). The
 * UNKNOWN penalty is applied PER-OCCURRENCE from the injected count
 * (BLOCKING QUESTION B1) and the final value is clamped to [0, 100].
 *
 * @param {object} args { build, assessments, configuration, nowMs,
 *                        unknownPairwiseCount }
 * @returns {number} the clamped build score
 * @throws {CandidateSelectionError} on any contract violation (fail fast)
 */
function computeBuildScore({ build, assessments, configuration, nowMs, unknownPairwiseCount }) {
  validateBuild(build);
  validateConfiguration(configuration);
  validateAssessments(assessments);
  validateNowMs(nowMs);
  validateUnknownPairwiseCount(unknownPairwiseCount);

  // Decision 22 item 1: the single accumulation path (identical arithmetic and
  // iteration order); the contribution list it also builds is ignored here.
  const { numerator, denominator } = accumulateBuild({ build, assessments, configuration, nowMs });

  if (denominator <= 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'role_weights',
      `The build weight denominator must be a positive number (got ${denominator}) (DECISION REQUIRED A5: fail-fast chosen)`
    );
  }

  const buildScoreRaw = numerator / denominator;
  const penalized = buildScoreRaw - configuration.unknown_compat_penalty * unknownPairwiseCount;
  return Math.min(100, Math.max(0, penalized));
}

/**
 * Compute build scores for a build list, index-aligned in discovery order.
 *
 * An empty build list yields an empty scores array (scoring zero builds is
 * not an error; Engine 3 may legitimately return { builds: [] }).
 *
 * `unknownPairwiseCounts` is OPTIONAL (Decision 15): when provided, it must
 * be an array aligned with `builds` by index and wins as-is (injection
 * kept); when absent, the count is read per build from
 * `build.unknown_pairwise_count`, and a missing/invalid build count fails
 * fast through the existing per-count validation.
 *
 * @param {object} args { builds, assessments, configuration, nowMs,
 *                        unknownPairwiseCounts? }
 * @returns {object} frozen { scores: [ { build_index, build_score }, ... ] }
 */
function computeBuildScores({ builds, assessments, configuration, nowMs, unknownPairwiseCounts }) {
  if (!Array.isArray(builds)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'builds', '"builds" must be an array of Engine 3 builds');
  }
  let counts = unknownPairwiseCounts;
  if (counts === undefined || counts === null) {
    // Decision 15: fall back to the build-carried count. Per-index validity
    // (missing / negative / non-integer) fails fast through the existing
    // validateUnknownPairwiseCount inside computeBuildScore.
    counts = builds.map((build) =>
      build !== null && typeof build === 'object' && !Array.isArray(build)
        ? build.unknown_pairwise_count
        : undefined
    );
  }
  if (!Array.isArray(counts) || counts.length !== builds.length) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'unknownPairwiseCounts',
      '"unknownPairwiseCounts" must be an array aligned with "builds" by index'
    );
  }
  const scores = [];
  for (let index = 0; index < builds.length; index += 1) {
    scores.push(
      Object.freeze({
        build_index: index,
        build_score: computeBuildScore({
          build: builds[index],
          assessments,
          configuration,
          nowMs,
          unknownPairwiseCount: counts[index],
        }),
      })
    );
  }
  return deepFreeze({ scores: Object.freeze(scores) });
}

/**
 * Decision 22 item 1 - ADDITIVE sibling: expose the per-(role,type)
 * contributions that ALREADY produced each build's score.
 *
 * Same input contract as computeBuildScores (builds / assessments /
 * configuration / nowMs; same failure vocabulary and fail-fast guards). It does
 * NOT consume the UNKNOWN pairwise count - contributions are the STEP 1 / STEP 3
 * weighted inputs; the per-occurrence penalty and clamp are Engine 6's
 * reconstruction concern.
 *
 * An empty build list yields a frozen empty contributions array (scoring zero
 * builds is not an error, matching computeBuildScores).
 *
 * @param {object} args { builds, assessments, configuration, nowMs }
 * @returns {object} frozen { contributions: [ [ { role, type, effective_score,
 *                   weight }, ... ], ... ] } index-aligned with `builds`
 * @throws {CandidateSelectionError} on any contract violation (fail fast)
 */
function computeBuildScoreContributions({ builds, assessments, configuration, nowMs }) {
  if (!Array.isArray(builds)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'builds', '"builds" must be an array of Engine 3 builds');
  }
  const contributions = [];
  for (let index = 0; index < builds.length; index += 1) {
    validateBuild(builds[index]);
    validateConfiguration(configuration);
    validateAssessments(assessments);
    validateNowMs(nowMs);
    const accumulated = accumulateBuild({
      build: builds[index],
      assessments,
      configuration,
      nowMs,
    });
    if (accumulated.denominator <= 0) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'role_weights',
        `The build weight denominator must be a positive number (got ${accumulated.denominator}) (DECISION REQUIRED A5: fail-fast chosen)`
      );
    }
    const entries = [];
    for (const contribution of accumulated.contributions) {
      entries.push({
        role: contribution.role,
        type: contribution.type,
        effective_score: contribution.effective_score,
        weight: contribution.weight,
      });
    }
    contributions.push(entries);
  }
  // One deepFreeze seals children first (never pre-freeze a container -
  // DEVELOPMENT_NOTES 2026-09-22 deepFreeze ordering pitfall).
  return deepFreeze({ contributions });
}

module.exports = { computeBuildScore, computeBuildScores, computeBuildScoreContributions };