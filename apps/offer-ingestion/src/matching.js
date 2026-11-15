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

/** Curated-key rejection codes surfaced by a strict catalogue lookup. */
const MATCH_REASON_UNKNOWN_PRODUCT_SLUG = 'UNKNOWN_PRODUCT_SLUG';
const MATCH_REASON_UNKNOWN_VARIANT_SKU = 'UNKNOWN_VARIANT_SKU';
const MATCH_REASON_VARIANT_SKU_REQUIRED = 'VARIANT_SKU_REQUIRED';

const MIN_NAME_MATCH_LENGTH = 5;

/**
 * Uppercase, strip accents, drop a leading 'Seed ' prefix, collapse to
 * [A-Z0-9 ] tokens. Mirrors src/recommendation/ingestion/matching.js so a
 * future inferred tier (SKU / MPN / NAME) compares on the same normal form.
 */
function normalizeModelString(input) {
  if (input === null || input === undefined) return '';
  let s = String(input).toUpperCase();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/^SEED\s+/, '');
  s = s.replace(/[^A-Z0-9]+/g, ' ').trim();
  return s;
}

/**
 * Match a listing row against catalogue identities.
 *
 * Tier 0 CATALOGUE_KEY (operator product_slug + variant_sku) is the only
 * tier: the operator asserts the identity and nothing is inferred. The
 * catalogue lookup is caller-supplied and runs against Layer 1
 * (product.slug, product_variant.sku) inside the caller's transaction.
 *
 * A strict lookup reports problems by throwing an error with a `code`
 * property: UNKNOWN_PRODUCT_SLUG, UNKNOWN_VARIANT_SKU or
 * VARIANT_SKU_REQUIRED — an unknown key is REJECTED downstream, never guessed.
 *
 * @param {object} listing - Normalized listing row
 * @param {(slug: string, sku: string) => Promise<{ productId?: number, variantId?: number } | null>} lookupCatalogueKey
 * @returns {Promise<{ tier: string, productId?: number, variantId?: number, reason?: string }>}
 */
async function matchListing(listing, lookupCatalogueKey) {
  if (!listing.productSlug || !listing.variantSku) {
    return { tier: MATCH_TIER_UNMATCHED, reason: 'missing productSlug or variantSku' };
  }

  let identity;
  try {
    identity = await lookupCatalogueKey(listing.productSlug, listing.variantSku);
  } catch (err) {
    const code = err && err.code ? String(err.code) : String(err && err.message ? err.message : 'lookup failed');
    return { tier: MATCH_TIER_UNMATCHED, reason: code };
  }

  if (identity) {
    return {
      tier: MATCH_TIER_CATALOGUE_KEY,
      productId: identity.productId,
      variantId: identity.variantId,
    };
  }

  return { tier: MATCH_TIER_UNMATCHED, reason: 'no catalogue identity match' };
}

function nameMatches(listingName, catalogName) {
  const a = normalizeModelString(listingName);
  const b = normalizeModelString(catalogName);
  if (a.length < MIN_NAME_MATCH_LENGTH || b.length < MIN_NAME_MATCH_LENGTH) return false;
  return a.includes(b) || b.includes(a);
}

module.exports = {
  MATCH_TIER_CATALOGUE_KEY,
  MATCH_TIER_SKU,
  MATCH_TIER_MPN,
  MATCH_TIER_NAME,
  MATCH_TIER_UNMATCHED,
  MATCH_REASON_UNKNOWN_PRODUCT_SLUG,
  MATCH_REASON_UNKNOWN_VARIANT_SKU,
  MATCH_REASON_VARIANT_SKU_REQUIRED,
  matchListing,
  normalizeModelString,
  nameMatches,
};
