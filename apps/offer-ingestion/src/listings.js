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

const DEFAULT_CURRENCY = 'MAD';

/** Row fields that must be present and non-empty on a normalized listing. */
const REQUIRED_FIELDS = ['productSlug', 'variantSku', 'retailer', 'rawPrice', 'currency', 'fetchedAt'];

/**
 * Parse a MAD price string into a finite positive number.
 *
 * Accepts the forms a Moroccan retailer actually publishes: '1 299',
 * '1 299,00', '1,299.00', '1.234,56', '1299', '1299 MAD', '1 299 DH'.
 * Spaces (including non-breaking) are thousands separators. When both '.' and
 * ',' appear the LAST one is the decimal separator; with a single separator a
 * group of exactly 3 trailing digits is read as thousands, otherwise as a
 * decimal. USD-style and massive-garbage inputs are rejected, never guessed.
 *
 * @param {unknown} raw - Price exactly as collected
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
 * Normalize one raw adapter row: trim strings, parse the price, default
 * optionals. Pure — no DB, no clock reads beyond the caller-supplied `now`.
 * @param {object} row - Raw row from the adapter
 * @param {object} ctx - { now?: Date, expectedCurrency?: string }
 * @returns {{ valid: boolean, row?: object, errors: {field:string,reason:string}[] }}
 */
function normalizeListing(row, ctx = {}) {
  const expectedCurrency = ctx.expectedCurrency || DEFAULT_CURRENCY;
  const errors = [];
  const nowMs = ctx.now instanceof Date ? ctx.now.getTime() : ctx.now == null ? null : new Date(ctx.now).getTime();

  const normalized = {
    source: toNullableString(row.source) || 'manual',
    retailer: toNullableString(row.retailer),
    listingIdentifier: toNullableString(row.listingIdentifier),
    sourceIdentifier: toNullableString(row.sourceIdentifier),
    rawPrice: toNullableString(row.rawPrice),
    currency: toNullableString(row.currency) || null,
    availability: toNullableString(row.availability),
    fetchedAt: toNullableString(row.fetchedAt),
    productUrl: toNullableString(row.productUrl),
    title: toNullableString(row.title),
    seller: toNullableString(row.seller),
    sku: toNullableString(row.sku),
    mpn: toNullableString(row.mpn),
    productSlug: toNullableString(row.productSlug),
    variantSku: toNullableString(row.variantSku),
    sourceNote: toNullableString(row.sourceNote),
    rawData: row.rawData && typeof row.rawData === 'object' ? row.rawData : null,
    __line: typeof row.__line === 'number' ? row.__line : null,
  };

  const priceResult = parseMadAmount(normalized.rawPrice ?? normalized.price);
  if (!priceResult.ok) {
    pushError(errors, 'price', priceResult.reason);
  } else {
    normalized.price = priceResult.amount;
  }

  if (!isNonEmptyString(normalized.currency)) {
    normalized.currency = expectedCurrency;
  } else if (String(normalized.currency).trim() !== expectedCurrency) {
    pushError(errors, 'currency', 'UNKNOWN_CURRENCY');
  }

  if (isNonEmptyString(normalized.fetchedAt) && Number.isFinite(nowMs)) {
    const parsed = new Date(String(normalized.fetchedAt).trim());
    if (Number.isNaN(parsed.getTime())) {
      pushError(errors, 'fetchedAt', 'UNPARSEABLE_TIMESTAMP');
    } else if (parsed.getTime() > nowMs) {
      pushError(errors, 'fetchedAt', 'FETCHED_AT_IN_FUTURE');
    } else {
      normalized.fetchedAt = parsed.toISOString();
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, row: Object.freeze(normalized) };
}

/**
 * Normalize and validate a single listing row.
 * @param {object} row - Raw listing row from the adapter
 * @param {object} [ctx] - { now?: Date, expectedCurrency?: string }
 * @returns {{ valid: boolean, row?: object, errors: string[] }}
 */
function validateListing(row, ctx) {
  const normalized = normalizeListing(row, ctx);
  if (!normalized.valid) {
    return {
      valid: false,
      errors: normalized.errors.map((e) => e.field + ': ' + e.reason),
    };
  }
  const errors = [];
  const r = normalized.row;
  if (!r.productSlug) errors.push('missing productSlug');
  if (!r.variantSku) errors.push('missing variantSku');
  if (!r.retailer) errors.push('missing retailer');
  if (!Number.isFinite(r.price) || !(r.price > 0)) errors.push('invalid price');
  return {
    valid: errors.length === 0,
    row: errors.length === 0 ? r : undefined,
    errors,
  };
}

/**
 * Parse and validate a batch of listing rows.
 * @param {object[]} rows - Raw listing rows from the adapter
 * @param {object} [ctx] - { now?: Date, expectedCurrency?: string }
 * @returns {{ valid: object[], invalid: { row: object, errors: string[] }[] }}
 */
function parseListings(rows, ctx) {
  const valid = [];
  const invalid = [];
  const seenIdentifiers = new Set();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const line = typeof row.__line === 'number' ? row.__line : i + 1;

    const normalized = normalizeListing(row, ctx);
    if (!normalized.valid) {
      invalid.push({
        row,
        errors: normalized.errors.map((e) => `line ${line} ${e.field}: ${e.reason}`),
      });
      continue;
    }
    const listing = normalized.row;
    listing.__line = line;

    const identifier = listing.listingIdentifier;
    if (identifier !== null) {
      if (seenIdentifiers.has(identifier)) {
        invalid.push({ row, errors: [`line ${line} listingIdentifier: DUPLICATE_LISTING_IDENTIFIER`] });
        continue;
      }
      seenIdentifiers.add(identifier);
    }

    const validated = validateListing(listing, ctx);
    if (validated.valid) {
      valid.push(validated.row);
    } else {
      invalid.push({ row, errors: validated.errors.map((e) => `line ${line} ${e}`) });
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
  DEFAULT_CURRENCY,
  REQUIRED_FIELDS,
  parseMadAmount,
  normalizeListing,
  validateListing,
  parseListings,
  validateListings,
};
