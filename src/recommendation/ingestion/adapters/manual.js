/**
 * Ingestion — manual-import adapter (the only real adapter for the beta).
 *
 * Boundary: parses a CSV or JSON file the operator prepares by hand into raw
 * rows for `validateListings`. PURE: no DB, no network, no clock. It NEVER
 * fetches anything — the operator supplies the file.
 *
 * Adapter interface (docs/IMPORT_OFFERS.md): an adapter exposes
 *   parse(text, { format }) -> { rows, errors }
 * and the ingestion runner turns `rows` into normalized listings. This is the
 * `fetchListings() -> normalized listings` seam with the network replaced by a
 * file.
 *
 * CSV columns (header row required):
 *   required: source, store_name, listing_identifier, raw_price, currency,
 *             availability, observed_at
 *   optional: product_url, title, sku, mpn, source_note
 *
 * Errors are reported with a 1-based line number (CSV header is line 1, so the
 * first data row is line 2; JSON uses the array index + 1). Invalid rows are
 * never dropped or repaired.
 */

'use strict';

const REQUIRED_COLUMNS = [
  'source',
  'store_name',
  'listing_identifier',
  'raw_price',
  'currency',
  'availability',
  'observed_at',
];

const OPTIONAL_COLUMNS = ['product_url', 'title', 'sku', 'mpn', 'source_note'];
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
    row.raw_data = Object.assign({}, row);
    delete row.raw_data.__line;
    delete row.raw_data.raw_data;
    rows.push(row);
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
    row.raw_data = Object.assign({}, item);
    return row;
  });
  return { rows, errors: [] };
}

/**
 * @param {string} text file contents
 * @param {{format?:'csv'|'json'}} [options]
 * @returns {{ rows: Array<object>, errors: Array<{line:number, reason:string}>, format:string }}
 */
function parseManualText(text, options) {
  const opts = options || {};
  let format = opts.format;
  if (format !== 'csv' && format !== 'json') {
    const trimmed = String(text).trim();
    format = trimmed.startsWith('{') || trimmed.startsWith('[') ? 'json' : 'csv';
  }
  const parsed = format === 'json' ? parseJsonRows(text) : parseCsvRows(text);
  return { rows: parsed.rows, errors: parsed.errors, format };
}

module.exports = {
  REQUIRED_COLUMNS,
  OPTIONAL_COLUMNS,
  parseCsv,
  parseManualText,
};
