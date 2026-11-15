/**
 * Manual adapter — parses operator-supplied CSV or JSON listings.
 *
 * The seam is a file: this adapter performs no network I/O. It turns raw
 * operator text into normalized listing rows with parse errors collected,
 * not thrown, so the caller can decide whether to proceed.
 *
 * Interface:
 *   parse(text, { format }) -> { rows: ListingRow[], errors: ParseError[] }
 *
 * @see RFC §12.1 — Adapter interface
 * @see existing: src/recommendation/ingestion/adapters/manual.js
 */

'use strict';

/**
 * @typedef {object} ListingRow
 * @property {string} productSlug
 * @property {string} variantSku
 * @property {string} retailer
 * @property {string} seller
 * @property {string} price
 * @property {string} currency
 * @property {string} productUrl
 * @property {string} fetchedAt
 * @property {string} sourceFile
 */

/**
 * @typedef {object} ParseError
 * @property {number} line
 * @property {string} reason
 */

/**
 * Parse raw operator text into normalized listing rows.
 * @param {string} text - Raw file contents
 * @param {{ format?: 'csv' | 'json' }} options
 * @returns {{ rows: ListingRow[], errors: ParseError[] }}
 */
function parseManualText(text, { format } = {}) {
  const rows = [];
  const errors = [];

  // TODO(step 4/5 migration): port parse logic from
  // src/recommendation/ingestion/adapters/manual.js.
  // No engine imports, no network, no scoring/ranking.

  return { rows, errors };
}

module.exports = { parseManualText };
