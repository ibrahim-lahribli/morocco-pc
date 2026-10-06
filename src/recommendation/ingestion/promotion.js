/**
 * Ingestion — pure offer promotion decision.
 *
 * Boundary: given a validated listing and (optionally) the offer already stored
 * for its (store_id, listing_identifier) key, decide what the commit must do.
 * PURE: no DB.
 *
 * Rules (docs/PIPELINE_DESIGN.md sections 2-4):
 *   - No existing offer                     -> INSERT, no price_history row
 *     (the offer row itself is the first observation).
 *   - Existing offer, price or availability changed -> UPDATE, append EXACTLY
 *     one price_history row.
 *   - Existing offer, neither changed       -> UNCHANGED, append NOTHING.
 *   - Comparison is exact (no rounding); a NULL availability never equals a
 *     string availability.
 *
 * A second listing for the same product/variant is legal by design (the legacy
 * uniqueness index is partial on `listing_identifier IS NULL`), so a NEW
 * listing_identifier simply INSERTs and never raises a constraint error.
 */

'use strict';

function sameValue(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return String(a) === String(b);
}

/**
 * @param {object} listing normalized listing (needs price, availability)
 * @param {{price:number|string, availability:string}|null} existing
 * @returns {{ action:'INSERT'|'UPDATE'|'UNCHANGED', appendHistory:boolean, changedFields:Array<string> }}
 */
function decidePromotion(listing, existing) {
  if (!existing) {
    return { action: 'INSERT', appendHistory: false, changedFields: [] };
  }

  const changedFields = [];
  const existingPrice = Number(existing.price);
  const listingPrice = Number(listing.price);
  if (!(Number.isFinite(existingPrice) && existingPrice === listingPrice)) {
    changedFields.push('price');
  }
  if (!sameValue(existing.availability, listing.availability)) {
    changedFields.push('availability');
  }

  if (changedFields.length === 0) {
    return { action: 'UNCHANGED', appendHistory: false, changedFields: [] };
  }
  return { action: 'UPDATE', appendHistory: true, changedFields };
}

module.exports = { decidePromotion };
