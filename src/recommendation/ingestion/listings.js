/**
 * Ingestion — normalized listing shape, MAD price parsing and validation.
 *
 * Boundary: turns raw adapter rows (CSV/JSON fields as strings) into validated,
 * normalized listing records. PURE: no DB, no network, no clock reads — the
 * caller supplies `now` so validation is deterministic and testable.
 *
 * A normalized listing is the ingestion-layer input contract shared by every
 * adapter (docs/PIPELINE_DESIGN.md section 2.3):
 *
 *   source              adapter/source name, e.g. 'manual'          (string)
 *   store_name          must resolve to an existing store.name      (string)
 *   listing_identifier  retailer-side stable id (SKU or canonical URL) (string)
 *   product_url         source URL, reused as store_offer.product_url (string|null)
 *   raw_price           the price EXACTLY as collected              (string)
 *   price               parsed MAD amount, finite and > 0           (number)
 *   currency            ISO-ish currency code, must equal expected  (string)
 *   availability        free text; 'OUT_OF_STOCK' is the engine's sentinel (string)
 *   observed_at         ISO timestamp, never in the future          (string)
 *   title               listing title, used for matching            (string|null)
 *   sku                 retailer SKU, used for matching             (string|null)
 *   mpn                 manufacturer part number, used for matching (string|null)
 *   source_note         where/when the row was collected            (string|null) *     raw_data            original row object, kept for staging       (object)
 *     line                1-based source line/index, for reports        (number)
 *
 * Validation never silently drops or repairs a row: every rejected row is
 * returned with its line number and one or more { field, reason } errors.
 */

'use strict';

const DEFAULT_CURRENCY = 'MAD';

/** Row fields that must be present and non-empty. */
const REQUIRED_FIELDS = [
  'source',
  'store_name',
  'listing_identifier',
  'raw_price',
  'currency',
  'availability',
  'observed_at',
];

/** Optional fields, defaulted to null when absent. */
const OPTIONAL_FIELDS = ['product_url', 'title', 'sku', 'mpn', 'source_note'];

/**
 * Parse a MAD price string into a finite positive number.
 *
 * Accepts the forms a Moroccan retailer actually publishes: '1 299',
 * '1 299,00', '1,299.00', '1.234,56', '1299', '1299 MAD', '1 299 DH'.
 * Spaces (including non-breaking) are thousands separators. When both '.' and
 * ',' appear the LAST one is the decimal separator; with a single separator a
 * group of exactly 3 trailing digits is read as thousands, otherwise as a
 * decimal. USD-style and MASSIVE-garbage inputs are rejected, never guessed.
 *
 * @returns {{ ok: boolean, amount: number|null, reason: string|null }}
 */
function parseMadAmount(raw) {
  if (raw === null || raw === undefined) {
    return { ok: false, amount: null, reason: 'PRICE_EMPTY' };
  }
  let s = String(raw).trim();
  if (s === '') {
    return { ok: false, amount: null, reason: 'PRICE_EMPTY' };
  }
  s = s.replace(/MAD|DHS?|د\.م\.?/gi, '').trim();
  s = s.replace(/[\s\u00A0\u202F]/g, '');
  if (s.includes('-')) {
    return { ok: false, amount: null, reason: 'PRICE_NOT_POSITIVE' };
  }
  s = s.replace(/[^0-9.,]/g, '');
  if (s === '') {
    return { ok: false, amount: null, reason: 'PRICE_UNPARSEABLE' };
  }

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  let normalized = s;

  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    normalized = s.split(thousands).join('');
    if (decimal === ',') normalized = normalized.replace(',', '.');
  } else if (hasComma) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) {
      normalized = parts[0] + '.' + parts[1];
    } else {
      normalized = s.split(',').join('');
    }
  } else if (hasDot) {
    const parts = s.split('.');
    const looksLikeThousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    if (looksLikeThousands) normalized = s.split('.').join('');
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount)) {
    return { ok: false, amount: null, reason: 'PRICE_UNPARSEABLE' };
  }
  if (amount <= 0) {
    return { ok: false, amount: null, reason: 'PRICE_NOT_POSITIVE' };
  }
  return { ok: true, amount, reason: null };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function toNullableString(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function pushError(errors, field, reason) {
  errors.push({ field, reason });
}

/**
 * Validate and normalize a set of raw rows.
 *
 * @param {Array<object>} rows raw rows; each may carry `__line` (1-based).
 * @param {object} ctx
 *   @param {Date|string} ctx.now       validation reference time
 *   @param {string}      [ctx.expectedCurrency='MAD']
 *   @param {Set<string>} [ctx.knownStores] known store names (trimmed exact match)
 * @returns {{ valid: Array<object>, invalid: Array<{line:number, errors:Array<{field:string,reason:string}>}> }}
 */
function validateListings(rows, ctx) {
  const options = ctx || {};
  const expectedCurrency = options.expectedCurrency || DEFAULT_CURRENCY;
  const knownStores = options.knownStores || null;
  const nowMs = options.now instanceof Date ? options.now.getTime() : new Date(options.now).getTime();

  const valid = [];
  const invalid = [];
  const seenIdentifiers = new Set();

  rows.forEach((row, index) => {
    const line = typeof row.__line === 'number' ? row.__line : index + 1;
    const errors = [];

    for (const field of REQUIRED_FIELDS) {
      if (!isNonEmptyString(row[field])) pushError(errors, field, 'REQUIRED');
    }

    const priceResult = parseMadAmount(row.raw_price);
    if (!priceResult.ok) pushError(errors, 'raw_price', priceResult.reason);

    if (isNonEmptyString(row.currency) && String(row.currency).trim() !== expectedCurrency) {
      pushError(errors, 'currency', 'UNKNOWN_CURRENCY');
    }

    if (isNonEmptyString(row.store_name) && knownStores && !knownStores.has(String(row.store_name).trim())) {
      pushError(errors, 'store_name', 'UNKNOWN_STORE');
    }

    let observedAt = null;
    if (isNonEmptyString(row.observed_at)) {
      const parsed = new Date(String(row.observed_at).trim());
      if (Number.isNaN(parsed.getTime())) {
        pushError(errors, 'observed_at', 'UNPARSEABLE_TIMESTAMP');
      } else if (Number.isFinite(nowMs) && parsed.getTime() > nowMs) {
        pushError(errors, 'observed_at', 'OBSERVED_AT_IN_FUTURE');
      } else {
        observedAt = parsed.toISOString();
      }
    }

    const identifier = isNonEmptyString(row.listing_identifier)
      ? String(row.listing_identifier).trim()
      : null;
    if (identifier !== null) {
      if (seenIdentifiers.has(identifier)) {
        pushError(errors, 'listing_identifier', 'DUPLICATE_LISTING_IDENTIFIER');
      } else {
        seenIdentifiers.add(identifier);
      }
    }

    if (errors.length > 0) {
      invalid.push({ line, errors });
      return;
    }

    valid.push(Object.freeze({
      line,
      source: String(row.source).trim(),
      store_name: String(row.store_name).trim(),
      listing_identifier: identifier,
      product_url: toNullableString(row.product_url),
      raw_price: String(row.raw_price),
      price: priceResult.amount,
      currency: String(row.currency).trim(),
      availability: String(row.availability).trim(),
      observed_at: observedAt,
      title: toNullableString(row.title),
      sku: toNullableString(row.sku),
      mpn: toNullableString(row.mpn),
      source_note: toNullableString(row.source_note),
      raw_data: row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : null,
    }));
  });

  return { valid, invalid };
}

module.exports = {
  DEFAULT_CURRENCY,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  parseMadAmount,
  validateListings,
};
