/**
 * Plan â€” dry-run plan (reads only).
 *
 * Computes what would change without writing. Used by the CLI's default
 * dry-run mode and by the apply path for pre-commit validation.
 *
 * @see RFC Â§12.1 â€” plan/apply; dry-run default
 * @see existing: src/recommendation/ingestion/plan.js
 */

'use strict';

/**
 * Compare a stored offer's price/availability to a normalized listing row.
 * Exact comparison (no rounding); a NULL availability never equals a string.
 * @returns {boolean} true when nothing changed and no write is needed.
 */
function sameOffer(existing, row) {
  const existingPrice = Number(existing.price);
  const listingPrice = Number(row.price);
  if (!(Number.isFinite(existingPrice) && existingPrice === listingPrice)) return false;
  const existingAvail = existing.availability == null || existing.availability === undefined ? null : String(existing.availability);
  const listingAvail = row.availability == null || row.availability === undefined ? null : String(row.availability);
  return existingAvail === listingAvail;
}

function planKey(storeId, listingIdentifier) {
  return JSON.stringify([String(storeId), String(listingIdentifier)]);
}


/**
 * Build a plan from validated rows and match results.
 * @param {object[]} validRows - Validated listing rows
 * @param {object[]} matchResults - Results from matchListing()
 * @param {object[]} promotionResults - Results from decidePromotion()
 * @returns {{ inserts: object[], updates: object[], skips: object[], counts: object }}
 */
function buildPlan(validRows, matchResults, promotionResults, existingByKey = new Map()) {
  const inserts = [];
  const updates = [];
  const skips = [];

  for (let i = 0; i < validRows.length; i++) {
    const row = validRows[i];
    const match = matchResults[i] || { tier: 'UNMATCHED' };
    const promotion = promotionResults[i] || { class: 'PENDING' };

    const existing = existingByKey.get(planKey(row.storeId, row.listingIdentifier));
    if (promotion.class === 'REJECTED') {
      skips.push({ row, match, promotion, reason: promotion.reason });
    } else if (promotion.class === 'VERIFIED') {
      if (existing) {
        if (sameOffer(existing, row)) {
          skips.push({ row, match, promotion, reason: 'UNCHANGED' });
        } else {
          updates.push({ row, match, promotion, existing });
        }
      } else {
        inserts.push({ row, match, promotion });
      }
    } else {
      // PENDING / incomplete provenance: never insert, never blindly update.
      skips.push({ row, match, promotion, reason: promotion.reason || 'incomplete provenance evidence' });
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
  planKey,
  sameOffer,
    lines.push(`  SKIP: ${skip.row.productSlug}/${skip.row.variantSku} â€” ${skip.reason}`);
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


