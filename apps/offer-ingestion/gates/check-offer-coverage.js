/**
 * check-offer-coverage — coverage gate (ingestion-owned).
 *
 * Coverage of imported offers per role (CPU, GPU, etc.). Reports PASS /
 * FAIL / INCONCLUSIVE. On a seed-only catalog this is INCONCLUSIVE
 * (deliberate: no evidence to count).
 *
 * @see RFC §8.3 — Gate ownership: ingestion owns coverage gate
 * @see RFC §11A.2 — Environment-qualified offer counts
 * @see existing: scripts/check-offer-coverage.js
 */

'use strict';

/**
 * Check per-role coverage of imported offers against catalogue identities.
 * @param {object} client - pg Client
 * @returns {Promise<{ verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE', details: string[] }>}
 */
async function checkOfferCoverage(client) {
  const details = [];

  // TODO(step 4/5 migration): port from scripts/check-offer-coverage.js.
  // Query store_offer joined with product/product_variant; count per role.

  details.push('not yet implemented — port from scripts/check-offer-coverage.js');

  return {
    verdict: 'INCONCLUSIVE',
    details,
  };
}

module.exports = {
  checkOfferCoverage,
};
