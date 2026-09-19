/**
 * Engine 4 - STEP 2: candidate score per (product, role).
 *
 * Decision 13 (docs/RECOMMENDATION_ENGINE_DECISIONS.md:1770-1776), verbatim:
 *
 *   candidate_score(product, role)
 *       = sum_type[ role_weights[role][type] * effective(product, type) ]
 *         / sum_type[ role_weights[role][type] ]
 *
 * Consumes:  single argument object carrying `candidate` (Engine 2A identity:
 *            product_id + component_role; product_variant_id is carried
 *            through for traceability but plays no arithmetic part), the
 *            frozen assessment map from ./load-assessments (loader shape
 *            { [product_id]: [rows, ...] }), the validated Decision 3(a)
 *            configuration and `nowMs`.
 * Produces:  one candidate score (number), or - for the batch form - a frozen
 *            { scores: [...] } array in EXACT input order.
 *
 * Type domain (DECISION REQUIRED A4, adopted PROPOSAL): `sum_type` runs over
 * the configured key set of `role_weights[role]` - the literal reading, since
 * the weights define the scheme. `type_weights` is NOT involved in STEP 2
 * (it is build-level, STEP 3). Requires product-owner confirmation.
 *
 * DECISION REQUIRED (A5, adopted PROPOSAL): a role weight sum <= 0 fails
 * fast INVALID_FIELD_VALUE `role_weights.<role>` (division by zero / inverted
 * ordering is never silently accepted). The configuration validator checks
 * weight leaves structurally only (any finite number), so the semantic guard
 * lives here.
 *
 * DECISION REQUIRED (A6, adopted PROPOSAL): a candidate role missing from
 * `role_weights` fails fast INVALID_FIELD_VALUE `role_weights.<role>` (a
 * scoring scheme that cannot weigh a participating role is incomplete);
 * the recorded alternative is renormalize-exclusion as for missing build
 * roles. Requires product-owner confirmation.
 *
 * Explicit NON-responsibilities: no sorting, no ranking, no tie-breaking
 * (Decision 12/14 own both; Decision 12 is TBD and `top_k_per_role` stays
 * validated-only - Decision 11 Rule 7), no REJECT filtering (candidates
 * arrive post-2C/2D), no database access, no I/O, no clock reads, no
 * persistence.
 *
 * Pure and deterministic: iteration follows the frozen configuration's key
 * order (the JSONB's own insertion order, preserved by the validator), so
 * the same inputs always yield the same number.
 */

'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const { isValidComponentRole } = require('../candidates/roles');
const { selectAssessmentRow, computeEffectiveScore } = require('./effective-score');

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Light gate over the fields STEP 2 consumes (role_weights map).
 */
function validateConfiguration(configuration) {
  if (configuration === null || typeof configuration !== 'object' || Array.isArray(configuration)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'configuration',
      'STEP 2 requires the validated Decision 3(a) scoring-model configuration object'
    );
  }
  const role_weights = configuration.role_weights;
  if (role_weights === null || typeof role_weights !== 'object' || Array.isArray(role_weights)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'role_weights', '"role_weights" must be an object keyed by component role');
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

/** Light gate over one Engine 2A candidate identity. */
function validateCandidate(candidate) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail(ERROR_CODES.INVALID_INPUT, 'candidate', 'STEP 2 requires a candidate object');
  }
  const { product_id, component_role } = candidate;
  if (typeof product_id !== 'string' || product_id.length === 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'candidate.product_id', '"candidate.product_id" must be a non-empty string');
  }
  if (!isValidComponentRole(component_role)) {
    fail(
      ERROR_CODES.INVALID_COMPONENT_ROLE,
      'candidate.component_role',
      `"candidate.component_role" "${String(component_role)}" is not a canonical component role`
    );
  }
}

/**
 * Resolve the configured role weight map for one role and validate its
 * leaves. Returns { types, byType, denominator }: the configured type key
 * set in ITS OWN ORDER (the frozen configuration's insertion order - the
 * determinism contract) and the denominator sum.
 *
 * DECISION REQUIRED markers A4/A5/A6 live here; see the module header.
 */
function resolveRoleWeights(configuration, componentRole) {
  const byType = configuration.role_weights[componentRole];
  if (byType === undefined || byType === null || typeof byType !== 'object' || Array.isArray(byType)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      `role_weights.${componentRole}`,
      `"role_weights" requires the role "${componentRole}" (DECISION REQUIRED A6: fail-fast chosen; renormalize-exclusion is the recorded alternative)`
    );
  }
  const types = [];
  let denominator = 0;
  for (const assessmentType of Object.keys(byType)) {
    const weight = byType[assessmentType];
    if (!isFiniteNumber(weight)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        `role_weights.${componentRole}.${assessmentType}`,
        `"role_weights.${componentRole}.${assessmentType}" must be a finite number`
      );
    }
    types.push(assessmentType);
    denominator += weight;
  }
  if (denominator <= 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      `role_weights.${componentRole}`,
      `"role_weights.${componentRole}" weights must sum to a positive number (got ${denominator}) (DECISION REQUIRED A5: fail-fast chosen)`
    );
  }
  return { types, byType, denominator };
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
 * Compute the Decision 13 STEP 2 candidate score for one (product, role).
 *
 * The no-evidence branch is inherited from STEP 1 via computeEffectiveScore:
 * every configured type of the role contributes, assessed or not.
 *
 * @param {object} args { candidate, assessments, configuration, nowMs }
 * @returns {number} the candidate score
 * @throws {CandidateSelectionError} on any contract violation (fail fast)
 */
function computeCandidateScore({ candidate, assessments, configuration, nowMs }) {
  validateCandidate(candidate);
  validateConfiguration(configuration);
  validateAssessments(assessments);
  validateNowMs(nowMs);

  const { product_id, component_role } = candidate;
  const { types, byType, denominator } = resolveRoleWeights(configuration, component_role);
  const productRows =
    assessments === undefined || assessments === null ? undefined : assessments[product_id];

  let numerator = 0;
  for (const assessmentType of types) {
    const row = selectAssessmentRow(productRows, assessmentType);
    const effective = computeEffectiveScore({ assessment: row, configuration, nowMs });
    numerator += byType[assessmentType] * effective;
  }
  return numerator / denominator;
}

/**
 * Compute candidate scores for a candidate list, in EXACT input order.
 *
 * The output is a frozen { scores } array of frozen records; it is
 * deliberately UNSORTED: ranking and tie-breaking are Decision 12/14
 * concerns (Decision 12 is TBD; `top_k_per_role` stays validated-only,
 * Decision 11 Rule 7). An empty candidate list yields an empty scores array
 * (scoring an empty set is not an error).
 *
 * @param {object} args { candidates, assessments, configuration, nowMs }
 * @returns {object} frozen { scores: [ { product_id, product_variant_id,
 *                    component_role, candidate_score }, ... ] }
 */
function computeCandidateScores({ candidates, assessments, configuration, nowMs }) {
  if (!Array.isArray(candidates)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'candidates', '"candidates" must be an array of candidate identities');
  }
  const scores = [];
  for (const candidate of candidates) {
    const candidateScore = computeCandidateScore({ candidate, assessments, configuration, nowMs });
    scores.push(
      Object.freeze({
        product_id: candidate.product_id,
        product_variant_id: candidate.product_variant_id,
        component_role: candidate.component_role,
        candidate_score: candidateScore,
      })
    );
  }
  return deepFreeze({ scores: Object.freeze(scores) });
}

module.exports = { computeCandidateScore, computeCandidateScores };