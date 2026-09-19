/**
 * Engine 4 - STEP 1: effective score per (product, assessment_type).
 *
 * Decision 13 (docs/RECOMMENDATION_ENGINE_DECISIONS.md:1751-1768), verbatim:
 *
 *   if no component_assessment row exists for (product_id, type)
 *      OR the row's score column is NULL:
 *       effective = max(0, neutral_baseline - no_evidence_penalty)
 *   else:
 *       age_days  = now - assessed_at
 *       decay     = max(0, 1 - staleness.per_day_decay
 *                           * min(age_days, staleness.max_age_days))
 *       decayed   = assessment.score * decay
 *       mult      = confidence_multipliers[assessment.confidence]
 *       effective = neutral_baseline + mult * (decayed - neutral_baseline)
 *
 * Rationale bindings (Decision 13): the decay is LINEAR (per_day_decay is a
 * literal daily-loss rate, max_age_days a hard floor); confidence BLENDS
 * toward neutral_baseline (it never multiplies toward zero); a NULL-score row
 * is treated identically to a missing row (Decision 13 note, doc line 1815).
 *
 * Consumes:  single argument object carrying `assessment` (a normalized row
 *            from ./load-assessments or null), the validated Decision 3(a)
 *            configuration (frozen, from loadScoringModel) and `nowMs`.
 * Produces:  one finite effective score (number in [0, 100] for in-contract
 *            inputs: decay in [0, 1] and multiplier in [0, 1] keep the blend
 *            inside the baseline/decayed interval).
 *
 * Implementation notes (faithful to the formula, pinned explicitly):
 *   - `now` is INJECTED (`nowMs`): pure modules never read the clock
 *     (assemble.js convention). The caller derives it from the loader's
 *     `loaded_at` decision timestamp (CURRENT_TIMESTAMP; Stage 1 precedent).
 *   - age_days is REAL-VALUED (epoch-ms difference / 86 400 000), matching
 *     per_day_decay as a literal daily-loss rate.
 *   - age_days is clamped at >= 0: a future `assessed_at` means maximally
 *     fresh (decay 1), never decay > 1 - the literal unclamped formula would
 *     inflate the score above its measured value and beyond the 0..100 scale.
 *     This mirrors Decision 7 (future timestamps accepted as fresh).
 *   - The confidence multiplier lookup must yield a finite number. A NULL
 *     confidence, or a DB confidence value the configuration does not cover
 *     (the configuration validator checks keys structurally only -
 *     configuration.js:35-38), fails fast INVALID_FIELD_VALUE `confidence`.
 *     DECISION REQUIRED (2026-09-19 plan, item A3): alternatives recorded -
 *     treat NULL as the UNVERIFIED multiplier, or require complete enum
 *     coverage at configuration level. Fail-fast chosen: no silent defaults.
 *
 * DECISION REQUIRED (2026-09-19 plan, item A2) - selectAssessmentRow policy:
 * `component_assessment` has NO unique constraint on (product_id,
 * assessment_type), so multiple rows per (product, type) are legal and
 * Decision 13 speaks of "the row" (singular) without a selection rule. The
 * adopted PROPOSAL: the FIRST row of the requested type in the loader's
 * deterministic order wins - i.e. the newest assessed_at, id ASC tie-break
 * (Decision 8 pattern). A newer NULL-score row therefore shadows an older
 * scored row, exactly as the formula's "the row's score column is NULL"
 * branch reads. Requires product-owner confirmation.
 *
 * Explicit NON-responsibilities: no database access, no I/O, no clock reads,
 * no weight aggregation (STEP 2/3 own it), no freezing of inputs, no
 * mutation, no ranking.
 *
 * Pure and deterministic: same inputs always yield the same number.
 */

'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** One day in epoch milliseconds. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Light gate over the fields STEP 1 consumes. Full Decision 3(a) validation
 * is owned by ./configuration via loadScoringModel (Decision 11 Rule 3);
 * this re-checks presence/type only, with exact nested paths.
 */
function validateConfiguration(configuration) {
  if (configuration === null || typeof configuration !== 'object' || Array.isArray(configuration)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'configuration',
      'STEP 1 requires the validated Decision 3(a) scoring-model configuration object'
    );
  }
  for (const field of ['neutral_baseline', 'no_evidence_penalty']) {
    if (configuration[field] === undefined || configuration[field] === null) {
      fail(ERROR_CODES.MISSING_REQUIRED_FIELD, field, `"${field}" is required`);
    }
    if (!isFiniteNumber(configuration[field])) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, field, `"${field}" must be a finite number`);
    }
  }
  if (
    configuration.confidence_multipliers === null ||
    typeof configuration.confidence_multipliers !== 'object' ||
    Array.isArray(configuration.confidence_multipliers)
  ) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'confidence_multipliers',
      '"confidence_multipliers" must be an object map'
    );
  }
  const staleness = configuration.staleness;
  if (staleness === null || typeof staleness !== 'object' || Array.isArray(staleness)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'staleness', '"staleness" must be an object');
  }
  for (const field of ['max_age_days', 'per_day_decay']) {
    if (staleness[field] === undefined || staleness[field] === null) {
      fail(ERROR_CODES.MISSING_REQUIRED_FIELD, `staleness.${field}`, `"staleness.${field}" is required`);
    }
    if (!isFiniteNumber(staleness[field])) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, `staleness.${field}`, `"staleness.${field}" must be a finite number`);
    }
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

/** Light gate over one normalized assessment row (or null). */
function validateAssessment(assessment) {
  if (assessment === null || typeof assessment !== 'object' || Array.isArray(assessment)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'assessment', '"assessment" must be a normalized row object or null');
  }
  if (assessment.score !== null && !isFiniteNumber(assessment.score)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'assessment.score', '"assessment.score" must be a finite number or null');
  }
  if (assessment.score !== null && (assessment.score < 0 || assessment.score > 100)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'assessment.score', '"assessment.score" must be in [0, 100] (migration 008 CHECK)');
  }
  if (assessment.confidence !== null && typeof assessment.confidence !== 'string') {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'assessment.confidence', '"assessment.confidence" must be a string or null');
  }
  if (!isFiniteNumber(assessment.assessed_at)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'assessment.assessed_at', '"assessment.assessed_at" must be a finite epoch-millisecond number');
  }
}

/**
 * Deterministically select the assessment row for one assessment type.
 *
 * DECISION REQUIRED (A2 - adopted proposal, see module header): the FIRST
 * row of the requested type wins; the loader's SQL order makes that the
 * newest assessed_at with id ASC as the tie-break. Absent/unassessed input
 * yields null (the STEP 1 no-evidence branch, never an error).
 *
 * @param {Array<object>|undefined|null} rows loader rows for ONE product
 * @param {string} assessmentType the assessment type to select
 * @returns {object|null} the selected row, or null
 */
function selectAssessmentRow(rows, assessmentType) {
  if (assessmentType === undefined || assessmentType === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'assessment_type', '"assessmentType" is required');
  }
  if (typeof assessmentType !== 'string' || assessmentType.length === 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'assessment_type', '"assessmentType" must be a non-empty string');
  }
  if (rows === undefined || rows === null) {
    return null;
  }
  if (!Array.isArray(rows)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'rows', '"rows" must be an array of assessment rows');
  }
  for (const row of rows) {
    if (row !== null && typeof row === 'object' && !Array.isArray(row) && row.assessment_type === assessmentType) {
      return row;
    }
  }
  return null;
}

/**
 * Compute the Decision 13 STEP 1 effective score.
 *
 * @param {object} args { assessment, configuration, nowMs }
 * @returns {number} the effective score
 * @throws {CandidateSelectionError} on any contract violation (fail fast)
 */
function computeEffectiveScore({ assessment, configuration, nowMs }) {
  validateConfiguration(configuration);
  validateNowMs(nowMs);

  // Decision 13, verbatim: no row OR the row's score column is NULL both take
  // the no-evidence branch (a NULL score gives STEP 1 no number to decay or
  // blend - Decision 13 note, doc line 1815). Never multiply a NULL through.
  if (
    assessment === undefined ||
    assessment === null ||
    (typeof assessment === 'object' && assessment.score === null)
  ) {
    return Math.max(0, configuration.neutral_baseline - configuration.no_evidence_penalty);
  }
  validateAssessment(assessment);

  const ageDays = Math.max(0, (nowMs - assessment.assessed_at) / MS_PER_DAY);
  const decay = Math.max(
    0,
    1 - configuration.staleness.per_day_decay * Math.min(ageDays, configuration.staleness.max_age_days)
  );
  const decayed = assessment.score * decay;
  const mult = configuration.confidence_multipliers[assessment.confidence];
  if (!isFiniteNumber(mult)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'confidence',
      `"${String(assessment.confidence)}" has no configured confidence multiplier (DECISION REQUIRED A3: NULL/unknown confidence handling; fail-fast chosen)`
    );
  }
  return configuration.neutral_baseline + mult * (decayed - configuration.neutral_baseline);
}

module.exports = { selectAssessmentRow, computeEffectiveScore };