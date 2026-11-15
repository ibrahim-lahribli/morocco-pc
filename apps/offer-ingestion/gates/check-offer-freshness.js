/**
 * check-offer-freshness — freshness gate (ingestion-owned).
 *
 * Freshness is an import-acceptance property: offers must have been fetched
 * within the configured window (30 days per Decision 35 / RFC §18).
 * Reports PASS / FAIL / INCONCLUSIVE.
 *
 * @see RFC §8.3 — Gate ownership: ingestion owns freshness gate
 * @see existing: scripts/check-offer-freshness.js
 */

'use strict';

/**
 * Check that imported offers are within the freshness window.
 * @param {object} client - pg Client
 * @param {object} options - { maxAgeDays?: number }
 * @returns {Promise<{ verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE', details: string[] }>}
 */
async function checkOfferFreshness(client, options = {}) {
  const { maxAgeDays = 30 } = options;
  const details = [];

  // TODO(step 4/5 migration): port from scripts/check-offer-freshness.js.
  // Query store_offer.fetched_at; flag rows older than maxAgeDays.

  details.push(`not yet implemented — port from scripts/check-offer-freshness.js (maxAgeDays=${maxAgeDays})`);

  return {
    verdict: 'INCONCLUSIVE',
    details,
  };
}

module.exports = {
  checkOfferFreshness,
};
