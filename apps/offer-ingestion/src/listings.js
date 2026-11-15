/**
 * Listings — parse + validate raw operator listings into normalized rows.
 *
 * Pure validation over supplied input. Does not touch the database and does
 * not import any engine module.
 *
 * @see RFC §12.4 — Reads Layer 1 identities only for matching; never writes Layer 4
 * @see existing: src/recommendation/ingestion/listings.js
 */

'use strict';

/**
 * Normalize and validate a single listing row.
 * @param {object} row - Raw listing row from adapter
 * @returns {{ valid: boolean, row?: object, errors: string[] }}
 */
function validateListing(row) {
  const errors = [];

  if (!row.productSlug || typeof row.productSlug !== 'string') {
    errors.push('missing productSlug');
  }
  if (!row.variantSku || typeof row.variantSku !== 'string') {
    errors.push('missing variantSku');
  }
  if (!row.retailer || typeof row.retailer !== 'string') {
    errors.push('missing retailer');
  }
  if (!row.price || isNaN(Number(row.price))) {
    errors.push('invalid price');
  }

  return {
    valid: errors.length === 0,
    row: errors.length === 0 ? row : undefined,
    errors,
  };
}

/**
 * Parse and validate a batch of listing rows.
 * @param {object[]} rows - Raw listing rows
 * @returns {{ valid: object[], invalid: { row: object, errors: string[] }[] }}
 */
function parseListings(rows) {
  const valid = [];
  const invalid = [];

  for (const row of rows) {
    const result = validateListing(row);
    if (result.valid) {
      valid.push(result.row);
    } else {
      invalid.push({ row, errors: result.errors });
    }
  }

  return { valid, invalid };
}

/**
 * Validate listings for import acceptance.
 * @param {object[]} rows - Normalized listing rows
 * @returns {boolean}
 */
function validateListings(rows) {
  return rows.every((row) => row.productSlug && row.variantSku);
}

module.exports = {
  validateListing,
  parseListings,
  validateListings,
};
