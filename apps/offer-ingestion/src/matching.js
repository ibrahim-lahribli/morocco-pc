/**
 * Matching — identity matching tiers for imported listings.
 *
 * Tier 0 `CATALOGUE_KEY` (operator `product_slug` + `variant_sku`) wins over
 * SKU / MPN / name tiers. Nothing is force-matched; unmatched rows are
 * reported as UNMATCHED with a reason.
 *
 * @see RFC §12.1 — Identity: Tier 0 CATALOGUE_KEY wins
 * @see existing: src/recommendation/ingestion/matching.js
 */

'use strict';

const MATCH_TIER_CATALOGUE_KEY = 'CATALOGUE_KEY';
const MATCH_TIER_SKU = 'SKU';
const MATCH_TIER_MPN = 'MPN';
const MATCH_TIER_NAME = 'NAME';
const MATCH_TIER_UNMATCHED = 'UNMATCHED';

/**
 * Match a listing row against catalogue identities.
 *
 * Reads Layer 1 identities (`product.slug`, `product_variant.sku`) through
 * the supplied identity lookup. Does not write anything.
 *
 * @param {object} listing - Normalized listing row
 * @param {(slug: string, sku: string) => Promise<{ productId?: number, variantId?: number } | null>} lookupCatalogueKey
 * @returns {Promise<{ tier: string, productId?: number, variantId?: number, reason?: string }>}
 */
async function matchListing(listing, lookupCatalogueKey) {
  if (!listing.productSlug || !listing.variantSku) {
    return { tier: MATCH_TIER_UNMATCHED, reason: 'missing productSlug or variantSku' };
  }

  const identity = await lookupCatalogueKey(listing.productSlug, listing.variantSku);
  if (identity) {
    return {
      tier: MATCH_TIER_CATALOGUE_KEY,
      productId: identity.productId,
      variantId: identity.variantId,
    };
  }

  return { tier: MATCH_TIER_UNMATCHED, reason: 'no catalogue identity match' };
}

function normalizeModelString(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = {
  MATCH_TIER_CATALOGUE_KEY,
  MATCH_TIER_SKU,
  MATCH_TIER_MPN,
  MATCH_TIER_NAME,
  MATCH_TIER_UNMATCHED,
  matchListing,
  normalizeModelString,
};
