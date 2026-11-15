/**
 * check-offer-provenance — provenance gate (ingestion-owned).
 *
 * Defines what "imported from a retailer" means: VERIFIED requires an
 * ingestion record + listing id + matching host + seller + non-future
 * fetched_at. Reports PASS / FAIL / INCONCLUSIVE; INCONCLUSIVE is never
 * reported as PASS.
 *
 * @see RFC §8.3 — Gate ownership: ingestion owns provenance gate
 * @see existing: scripts/check-offer-provenance.js
 */

'use strict';

/**
 * Check that every imported offer has complete provenance evidence.
 * @param {object} client - pg Client
 * @returns {Promise<{ verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE', details: string[] }>}
 */
async function checkOfferProvenance(client) {
  const details = [];

  // TODO(step 4/5 migration): port from scripts/check-offer-provenance.js.
  // Query store_offer joined with ingestion_record; verify listing_id,
  // seller, host, fetched_at are present and non-future.

  details.push('not yet implemented — port from scripts/check-offer-provenance.js');

  return {
    verdict: 'INCONCLUSIVE',
    details,
  };
}

module.exports = {
  checkOfferProvenance,
};
