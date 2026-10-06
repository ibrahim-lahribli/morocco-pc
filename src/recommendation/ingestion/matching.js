/**
 * Ingestion — listing to canonical product/variant matching.
 *
 * Boundary: maps a normalized listing title/SKU/MPN onto an existing
 * `product_variant` / `product` identity. PURE: no DB, no network, no clock.
 *
 * Confidence ladder (docs/PIPELINE_DESIGN.md section 6):
 *   exact SKU (product_variant.sku)        -> CONFIRMED
 *   exact MPN (product.manufacturer_part_number) -> HIGH
 *   normalized model-string containment    -> MEDIUM
 *   nothing                                 -> UNMATCHED (review queue)
 *
 * Ambiguity is never resolved by guessing: when two or more catalog entries
 * tie at the highest available tier the result is REVIEW with every candidate
 * listed. Nothing here ever CREATES a product; the caller routes REVIEW and
 * UNMATCHED listings to the review queue.
 *
 * The catalog entry shape:
 *   { product_id, product_variant_id|null, sku|null, mpn|null, name }
 * A leading 'Seed ' token (the seed-catalog display prefix) is stripped during
 * normalization, so seed fixtures match real titles too.
 */

'use strict';

const MIN_NAME_MATCH_LENGTH = 5;

/** Uppercase, strip accents, drop a leading 'Seed ' prefix, keep [A-Z0-9 ]. */
function normalizeModelString(input) {
  if (input === null || input === undefined) return '';
  let s = String(input).toUpperCase();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/^SEED\s+/, '');
  s = s.replace(/[^A-Z0-9]+/g, ' ').trim();
  return s;
}

function nameMatches(listingName, catalogName) {
  const a = normalizeModelString(listingName);
  const b = normalizeModelString(catalogName);
  if (a.length < MIN_NAME_MATCH_LENGTH || b.length < MIN_NAME_MATCH_LENGTH) return false;
  return a.includes(b) || b.includes(a);
}

function result(status, confidence, entries, reason) {
  const chosen = status === 'MATCHED' && entries.length === 1 ? entries[0] : null;
  return Object.freeze({
    status,
    confidence,
    matched_product_id: chosen ? chosen.product_id : null,
    matched_product_variant_id: chosen ? (chosen.product_variant_id === undefined ? null : chosen.product_variant_id) : null,
    candidates: Object.freeze(entries.map((e) => Object.freeze({
      product_id: e.product_id,
      product_variant_id: e.product_variant_id === undefined ? null : e.product_variant_id,
    }))),
    reason,
  });
}

/**
 * @param {object} listing normalized listing (needs title/sku/mpn)
 * @param {Array<object>} catalog catalog entries (see header)
 * @returns {{ status:string, confidence:string|null, matched_product_id:string|null,
 *             matched_product_variant_id:string|null, candidates:Array, reason:string }}
 */
function matchListing(listing, catalog) {
  const entries = Array.isArray(catalog) ? catalog : [];

  if (listing.sku) {
    const sku = normalizeModelString(listing.sku);
    const hits = entries.filter((e) => e.sku && normalizeModelString(e.sku) === sku);
    if (hits.length === 1) return result('MATCHED', 'CONFIRMED', hits, 'SKU_EXACT');
    if (hits.length > 1) return result('REVIEW', 'CONFIRMED', hits, 'SKU_AMBIGUOUS');
  }

  if (listing.mpn) {
    const mpn = normalizeModelString(listing.mpn);
    const hits = entries.filter((e) => e.mpn && normalizeModelString(e.mpn) === mpn);
    if (hits.length === 1) return result('MATCHED', 'HIGH', hits, 'MPN_EXACT');
    if (hits.length > 1) return result('REVIEW', 'HIGH', hits, 'MPN_AMBIGUOUS');
  }

  if (listing.title) {
    const hits = entries.filter((e) => nameMatches(listing.title, e.name));
    if (hits.length === 1) return result('MATCHED', 'MEDIUM', hits, 'NAME_CONTAINS');
    if (hits.length > 1) return result('REVIEW', 'MEDIUM', hits, 'NAME_AMBIGUOUS');
  }

  return result('UNMATCHED', null, [], 'NO_MATCH');
}

module.exports = { normalizeModelString, matchListing };
