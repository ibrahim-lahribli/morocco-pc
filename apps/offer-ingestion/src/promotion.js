/**
 * Promotion — class promotion rules for imported offers.
 *
 * Decides whether an offer reaches `VERIFIED` class based on provenance
 * evidence. Does not invent matches, prices, provenance classes, or
 * timestamps.
 *
 * @see RFC §12.1 — Curated rejection codes; provenance definitions
 * @see existing: src/recommendation/ingestion/promotion.js
 */

'use strict';

const OFFER_CLASS_SEED_UNVERIFIED = 'SEED_UNVERIFIED';
const OFFER_CLASS_PENDING = 'PENDING';
const OFFER_CLASS_VERIFIED = 'VERIFIED';
const OFFER_CLASS_REJECTED = 'REJECTED';

/**
 * Decide the promotion class for a matched listing.
 *
 * @param {object} listing - Normalized listing row
 * @param {object} match - Result from matchListing()
 * @param {object} context - Provenance context (listingId, seller, host, fetchedAt)
 * @returns {{ class: string, reason?: string }}
 */
function decidePromotion(listing, match, context = {}) {
  // Requires: listingId + seller + host + non-future fetchedAt (provenance floor)
  if (!context.listingId || !context.seller || !context.host) {
    return { class: OFFER_CLASS_PENDING, reason: 'incomplete provenance evidence' };
  }

  const fetchedAt = new Date(context.fetchedAt);
  const now = new Date();
  if (isNaN(fetchedAt.getTime()) || fetchedAt > now) {
    return { class: OFFER_CLASS_REJECTED, reason: 'invalid or future fetched_at' };
  }

  if (match.tier === 'UNMATCHED') {
    return { class: OFFER_CLASS_REJECTED, reason: 'no catalogue identity match' };
  }

  return { class: OFFER_CLASS_VERIFIED };
}

module.exports = {
  OFFER_CLASS_SEED_UNVERIFIED,
  OFFER_CLASS_PENDING,
  OFFER_CLASS_VERIFIED,
  OFFER_CLASS_REJECTED,
  decidePromotion,
};
