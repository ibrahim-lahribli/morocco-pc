/**
 * Plan — dry-run plan (reads only).
 *
 * Computes what would change without writing. Used by the CLI's default
 * dry-run mode and by the apply path for pre-commit validation.
 *
 * @see RFC §12.1 — plan/apply; dry-run default
 * @see existing: src/recommendation/ingestion/plan.js
 */

'use strict';

/**
 * Build a plan from validated rows and match results.
 * @param {object[]} validRows - Validated listing rows
 * @param {object[]} matchResults - Results from matchListing()
 * @param {object[]} promotionResults - Results from decidePromotion()
 * @returns {{ inserts: object[], updates: object[], skips: object[], counts: object }}
 */
function buildPlan(validRows, matchResults, promotionResults) {
  const inserts = [];
  const updates = [];
  const skips = [];

  for (let i = 0; i < validRows.length; i++) {
    const row = validRows[i];
    const match = matchResults[i] || { tier: 'UNMATCHED' };
    const promotion = promotionResults[i] || { class: 'PENDING' };

    if (promotion.class === 'REJECTED') {
      skips.push({ row, match, promotion, reason: promotion.reason });
    } else if (promotion.class === 'VERIFIED') {
      inserts.push({ row, match, promotion });
    } else {
      updates.push({ row, match, promotion });
    }
  }

  return {
    inserts,
    updates,
    skips,
    counts: {
      total: validRows.length,
      insert: inserts.length,
      update: updates.length,
      skip: skips.length,
    },
  };
}

/**
 * Format a plan as a human-readable report string.
 * @param {object} plan - Result from buildPlan()
 * @returns {string}
 */
function formatPlan(plan) {
  const lines = [
    `Ingestion plan:`,
    `  total:    ${plan.counts.total}`,
    `  insert:   ${plan.counts.insert}`,
    `  update:   ${plan.counts.update}`,
    `  skip:     ${plan.counts.skip}`,
    '',
  ];

  for (const skip of plan.skips) {
    lines.push(`  SKIP: ${skip.row.productSlug}/${skip.row.variantSku} — ${skip.reason}`);
  }

  return lines.join('\n');
}

/**
 * Summary counts from a plan.
 * @param {object} plan - Result from buildPlan()
 * @returns {object}
 */
function planCounts(plan) {
  return { ...plan.counts };
}

module.exports = {
  buildPlan,
  formatPlan,
  planCounts,
};
