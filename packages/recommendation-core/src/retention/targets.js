/**
 * Retention - per-role price targets (E2).
 *
 * Boundary: pure arithmetic over a scoring model's own configuration and the
 * query it is answering. No database access, no I/O, no clock, no policy
 * beyond the two published constants below.
 *
 *   scoring_model.configuration.use_case_profiles[use_case].spend_targets
 *   recommendation_query.budget_amount
 *   recommendation_query.resolution
 *         |  computeRoleTargets(...)
 *         |    - target  = share x budget, x resolutionMultiplier for GPU only
 *         |    - ceiling = target x BAND_CEILING_FACTOR
 *         v
 *   frozen { <component_role>: { target, ceiling } }
 *
 * Why this exists: retention was budget-BLIND above the Decision 27 cheapest
 * reservation - it kept the top-K by score, so a 30 000 MAD pass could retain
 * the same 3 200 MAD GPU as an 8 000 MAD pass while every candidate in the
 * target band lost on score. This module turns the model's own per-use-case
 * spend policy into per-role price targets, which `retain.js` then uses to keep
 * the best scorer in each band (below / at / above the target).
 *
 * `spend_targets` are the scoring model's RELATIVE WEIGHTS (Decision 37 item
 * 6): they need not sum to 1, so a target is a per-role price point, not a
 * partition. GPU is the only role scaled by resolution, because resolution is
 * a GPU-spend lever (E5 refines this with a VRAM floor).
 *
 * The three resolution multipliers and the two band constants are HYPOTHESES
 * pending the H3 human review (Decision 39), not measured facts. They live here
 * as frozen code constants by the `MAX_PER_PAIR` / `TOP_N_PERSISTED` precedent:
 * a per-model override would be a new optional configuration key plus a new
 * seed, which is deliberately out of scope for E2.
 *
 * Purity: no database access, no framework; the returned map and every entry
 * are deep-frozen copies, never the caller's objects.
 */

'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** Resolution -> GPU spend multiplier. `null` resolution is neutral (1.0). */
const RESOLUTION_MULTIPLIERS = Object.freeze({
  '1080p': 1.0,
  '1440p': 1.25,
  '2160p': 1.5,
});

/** Half-width of the "at target" band, as a share of the target. */
const BAND_TOLERANCE = 0.15;

/** Hard ceiling for the "above target" band, as a multiple of the target. */
const BAND_CEILING_FACTOR = 2.0;

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
 * The GPU spend multiplier for a resolution.
 *
 * @param {string|null|undefined} resolution `recommendation_query.resolution`
 * @returns {number} 1.0 for null/absent, else the mapped multiplier
 * @throws {CandidateSelectionError} INVALID_FIELD_VALUE on any other value -
 *        an unmapped non-null resolution is a data/contract error, never a
 *        silent 1.0 (NULL means UNKNOWN; a wrong string is not NULL).
 */
function resolutionMultiplier(resolution) {
  if (resolution === null || resolution === undefined) {
    return 1.0;
  }
  if (
    typeof resolution !== 'string'
    || !Object.prototype.hasOwnProperty.call(RESOLUTION_MULTIPLIERS, resolution)
  ) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'resolution',
      `"resolution" must be null or one of ${Object.keys(RESOLUTION_MULTIPLIERS).join(', ')}`
    );
  }
  return RESOLUTION_MULTIPLIERS[resolution];
}

/**
 * Per-role price targets for one pass.
 *
 * A share of 0 is EMITTED, not skipped: that role gets `{ target: 0, ceiling: 0 }`.
 * Downstream that is exactly "no target for this role" - retain.js's `bandOf`
 * puts every positive price above a 0 ceiling, so no band is claimed and the
 * pre-E2 set is rebuilt by the shared Decision 27 reservation + Rule 3/5 top-up
 * (pinned in retain.test.js). A role OMITTED from `spendTargets` is a different
 * shape: it is absent from the result entirely, which retain.js also reads as
 * "no target". The two agree in effect; only the 0 case reaches it through the
 * band logic rather than by being skipped.
 *
 * @param {object} sources single argument object carrying:
 *        - spendTargets: a profile's `spend_targets` (relative weights)
 *        - budgetAmount: the query's budget_amount, a finite number > 0
 *        - resolution: `recommendation_query.resolution` (null allowed)
 * @returns {object} frozen { <role>: { target, ceiling } } - roles absent from
 *        `spendTargets` are absent from the result (their bucket keeps the
 *        pre-E2 top-K rule)
 * @throws {CandidateSelectionError} the Engine 2 vocabulary, on a
 *        missing/malformed source, a non-positive budget, or a bad share
 */
function computeRoleTargets(sources) {
  if (sources === undefined || sources === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, null, 'Per-role price targets require a sources object');
  }
  if (!isPlainObject(sources)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      null,
      'Per-role price targets require an object carrying spendTargets, budgetAmount and resolution'
    );
  }

  const { spendTargets, budgetAmount, resolution } = sources;

  if (!isPlainObject(spendTargets) || Object.keys(spendTargets).length === 0) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'spendTargets',
      '"spendTargets" must be a non-empty object keyed by component role (a profile\'s spend_targets)'
    );
  }
  if (typeof budgetAmount !== 'number' || !Number.isFinite(budgetAmount) || budgetAmount <= 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'budgetAmount',
      '"budgetAmount" must be a finite number greater than 0 (recommendation_query.budget_amount)'
    );
  }

  const multiplier = resolutionMultiplier(resolution);

  const targets = {};
  for (const role of Object.keys(spendTargets)) {
    if (typeof role !== 'string' || role.trim().length === 0) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'spendTargets',
        '"spendTargets" keys must be non-blank component-role strings'
      );
    }
    const share = spendTargets[role];
    if (typeof share !== 'number' || !Number.isFinite(share) || share < 0 || share > 1) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        `spendTargets.${role}`,
        `"spendTargets.${role}" must be a share of budget in [0, 1]`
      );
    }
    // GPU is the only resolution-scaled role (E5 refines this with a VRAM floor).
    const target = share * budgetAmount * (role === 'GPU' ? multiplier : 1);
    targets[role] = { target, ceiling: target * BAND_CEILING_FACTOR };
  }

  return deepFreeze(targets);
}

module.exports = {
  RESOLUTION_MULTIPLIERS,
  BAND_TOLERANCE,
  BAND_CEILING_FACTOR,
  resolutionMultiplier,
  computeRoleTargets,
};
