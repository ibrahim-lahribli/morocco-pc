const { FINAL_STATUSES } = require('./statuses');

/**
 * Worst-of aggregation of compatibility results.
 *
 *   any FAIL                 -> FAIL
 *   no FAIL, any UNKNOWN     -> UNKNOWN
 *   all PASS                 -> PASS
 *
 * Pure function: the individual results and their structured evidence are
 * preserved in the aggregated output (flattened, order preserved). The
 * aggregated reason is the reason of the decisive (first worst) result and
 * is null when every input is PASS. The penalty stays null: the numeric
 * UNKNOWN penalty is the scoring model's concern (Engine 4).
 *
 * @param {Array<object>} results Compatibility results as produced by
 *                                createCompatibilityResult.
 */
function aggregateCompatibilityResults(results) {
  if (!Array.isArray(results)) {
    throw new TypeError('aggregateCompatibilityResults expects an array');
  }

  const worst = results.reduce(
    (worstSoFar, result) => {
      if (result.status === FINAL_STATUSES.FAIL) return 'FAIL';
      if (result.status === FINAL_STATUSES.UNKNOWN && worstSoFar === 'PASS') {
        return 'UNKNOWN';
      }
      return worstSoFar;
    },
    'PASS'
  );

  const decisive = results.find((result) => result.status === worst) || null;

  return {
    status: worst,
    reason: decisive ? decisive.reason : null,
    evidence: results.flatMap((result) => result.evidence),
    penalty: null,
  };
}

module.exports = { aggregateCompatibilityResults };
