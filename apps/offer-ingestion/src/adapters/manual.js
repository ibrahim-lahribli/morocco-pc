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
 * Manual adapter — parses operator-supplied CSV or JSON listings.
 *
 * The seam is a file: this adapter performs no network I/O. It turns raw
 * operator text into normalized listing rows with parse errors collected,
 * not thrown, so the caller can decide whether to proceed.
 *
 * Adapter interface (RFC §12.1, docs/ingestion/recipes/import-offers.md):
 *   parse(text, { format }) -> { rows, errors, format }
 *
 * `rows` are normalized listing rows (camel-case fields) plus a 1-based
 * `__line` number; `errors` are file-level problems ({ line, reason }).
 * Invalid rows are never dropped or silently repaired.
 *
 * CSV columns (header row required):
 *   required: source, store_name, listing_identifier, raw_price, currency,
 *             availability, observed_at
 *   optional: product_url, title, sku, mpn, source_note,
 *             product_slug, variant_sku
 *
 * `product_slug` / `variant_sku` are CURATED identity: they name a catalogue
 * product (and one of its variants) explicitly, so a retailer title never has
 * to contain the catalogue name. `sku` stays the retailer's SKU;
 * `variant_sku` is the CATALOGUE's.
 */

const REQUIRED_COLUMNS = [
  'source',
  'store_name',
  'listing_identifier',
  'raw_price',
  'currency',
  'availability',
  'observed_at',
];

const OPTIONAL_COLUMNS = ['product_url', 'title', 'sku', 'mpn', 'source_note', 'product_slug', 'variant_sku'];
const KNOWN_COLUMNS = new Set(REQUIRED_COLUMNS.concat(OPTIONAL_COLUMNS));

/** Parse CSV text into an array of arrays, honouring quotes and CRLF. */
function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const s = String(text);

  const endField = () => { record.push(field); field = ''; };
  const endRecord = () => { endField(); records.push(record); record = []; };

  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { endField(); i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { endRecord(); i += 1; continue; }
    field += ch; i += 1;
  }
  if (field !== '' || record.length > 0) endRecord();
  return records;
}

function parseCsvRows(text) {
  const records = parseCsv(text).filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (records.length === 0) {
    return { rows: [], errors: [{ line: 1, reason: 'EMPTY_FILE' }] };
  }
  const header = records[0].map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { rows: [], errors: [{ line: 1, reason: 'MISSING_COLUMNS:' + missing.join('|') }] };
  }
  const unknown = header.filter((c) => c !== '' && !KNOWN_COLUMNS.has(c));
  if (unknown.length > 0) {
    return { rows: [], errors: [{ line: 1, reason: 'UNKNOWN_COLUMNS:' + unknown.join('|') }] };
  }

  const rows = [];
  for (let r = 1; r < records.length; r += 1) {
    const cells = records[r];
    const row = {};
    header.forEach((col, c) => { row[col] = cells[c] === undefined ? '' : cells[c]; });
    row.__line = r + 1;
    rows.push(normalizeRow(row));
  }
  return { rows, errors: [] };
}


function parseJsonRows(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { rows: [], errors: [{ line: 1, reason: 'INVALID_JSON' }] };
  }
  const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed && parsed.offers) ? parsed.offers : null);
  if (list === null) {
    return { rows: [], errors: [{ line: 1, reason: 'JSON_MUST_BE_ARRAY' }] };
  }
  const rows = list.map((item, index) => {
    const row = Object.assign({}, item);
    row.__line = index + 1;
    return normalizeRow(row);
  });
  return { rows, errors: [] };
}

/** Map a raw adapter row (snake-case columns) onto the normalized row shape. */
function normalizeRow(row) {
  const sourceIdentifier = toNullableString(row.listing_identifier);
  return {
    source: toNullableString(row.source) || 'manual',
    retailer: toNullableString(row.store_name),
    listingIdentifier: sourceIdentifier,
    sourceIdentifier,
    rawPrice: toNullableString(row.raw_price),
    currency: toNullableString(row.currency),
    availability: toNullableString(row.availability),
    fetchedAt: toNullableString(row.observed_at),
    productUrl: toNullableString(row.product_url),
    title: toNullableString(row.title),
    seller: toNullableString(row.seller),
    sku: toNullableString(row.sku),
    mpn: toNullableString(row.mpn),
    productSlug: toNullableString(row.product_slug),
    variantSku: toNullableString(row.variant_sku),
    sourceNote: toNullableString(row.source_note),
    rawData: row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : null,
    __line: typeof row.__line === 'number' ? row.__line : null,
  };
}

function toNullableString(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * Parse raw operator text into normalized listing rows.
 * @param {string} text - Raw file contents
 * @param {{ format?: 'csv' | 'json' }} options
 * @returns {{ rows: object[], errors: object[], format: string|null }}
 */
function parseManualText(text, { format } = {}) {
  const trimmed = String(text).trim();
  if (!format) {
    format = trimmed.startsWith('{') || trimmed.startsWith('[') ? 'json' : 'csv';
  }
  const parsed = format === 'json' ? parseJsonRows(text) : parseCsvRows(text);
  return { rows: parsed.rows, errors: parsed.errors, format };
}

module.exports = { parseManualText, parseCsv, normalizeRow, REQUIRED_COLUMNS, OPTIONAL_COLUMNS };
