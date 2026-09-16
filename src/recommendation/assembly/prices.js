/**
 * Engine 3 - Step 2: price carrier.
 *
 * Consumes:  raw price carrier keyed by `priceKey(...)`.
 * Produces:  frozen null-prototype carrier of frozen entries.
 *
 * Pure: no database access, no framework.
 */

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** The frozen entry vocabulary, in documented order. */
const PRICE_FIELDS = Object.freeze([
  'selected_price',
  'currency',
  'store_id',
  'price_checked_at',
]);

/** 3-letter uppercase code, no trim, no folding. */
const CURRENCY_RE = /^[A-Z]{3}$/;

/** RFC-4122-compatible UUID check (hex groups 8-4-4-4-12). */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/** Small private recursive freezer; no shared utility is created. */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Canonical key for (product_id, product_variant_id, component_role).
 * Tuple order is exactly product_id, product_variant_id, component_role.
 * Values are preserved verbatim: no trimming, no case handling, no sorting.
 */
function priceKey(product_id, product_variant_id, component_role) {
  return JSON.stringify([product_id, product_variant_id, component_role]);
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Strict UTC ISO-8601 check. Requires a `T` separator and an explicit UTC
 * designator (`Z` or `+00:00`), a successful `Date.parse`, and instant
 * consistency with the canonical UTC representation. Never rewrites input.
 */
function isUtcIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  if (value.indexOf('T') === -1) return false;
  if (!/(Z|\+00:00)$/.test(value)) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  const canonical = new Date(parsed).toISOString();
  if (Number.isNaN(Date.parse(canonical))) return false;
  const normalized = value.replace(/\+00:00$/, 'Z');
  if (Date.parse(normalized) !== parsed) return false;
  if (Date.parse(canonical) !== parsed) return false;
  return true;
}

function validateEntry(key, entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}`, `Price entry "${key}" must be an object`);
  }
  for (const field of Object.keys(entry)) {
    if (!PRICE_FIELDS.includes(field)) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.${field}`, `Unknown price field "${field}"`);
    }
  }
  for (const field of PRICE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(entry, field)) {
      fail(ERROR_CODES.MISSING_REQUIRED_FIELD, `prices.${key}.${field}`, `Price entry "${key}" requires "${field}"`);
    }
  }
  const { selected_price, currency, store_id, price_checked_at } = entry;
  if (typeof selected_price !== 'number' || !Number.isFinite(selected_price) || selected_price <= 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.selected_price`, `Price entry "${key}" has an invalid "selected_price"`);
  }
  if (typeof currency !== 'string' || !CURRENCY_RE.test(currency)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.currency`, `Price entry "${key}" has an invalid "currency"`);
  }
  if (typeof store_id !== 'string' || store_id.length === 0 || !isUuid(store_id)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.store_id`, `Price entry "${key}" has an invalid "store_id"`);
  }
  if (!isUtcIsoTimestamp(price_checked_at)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, `prices.${key}.price_checked_at`, `Price entry "${key}" has an invalid "price_checked_at"`);
  }
}

/**
 * Validate and freeze a price carrier. Fail-fast and idempotent.
 * Caller-owned objects are never mutated: entries are copied to a fresh
 * null-prototype carrier (safe property definition) before freezing.
 */
function validatePrices(prices) {
  if (prices === null || typeof prices !== 'object') {
    fail(ERROR_CODES.INVALID_INPUT, 'prices', '"prices" must be a null-prototype object');
  }
  if (Array.isArray(prices) || Object.getPrototypeOf(prices) !== null) {
    fail(ERROR_CODES.INVALID_INPUT, 'prices', '"prices" must be a null-prototype object');
  }
  const frozen = Object.create(null);
  for (const key of Object.keys(prices)) {
    validateEntry(key, prices[key]);
    const entry = prices[key];
    const copy = {
      selected_price: entry.selected_price,
      currency: entry.currency,
      store_id: entry.store_id,
      price_checked_at: entry.price_checked_at,
    };
    deepFreeze(copy);
    Object.defineProperty(frozen, key, {
      value: copy, enumerable: true, writable: false, configurable: false,
    });
  }
  Object.freeze(frozen);
  return frozen;
}

/**
 * Deterministic lookup of the stored entry for a candidate.
 * Returns the exact frozen object stored in the carrier (no clone).
 */
function lookupPrice(prices, candidate) {
  if (prices === null || typeof prices !== 'object' || Array.isArray(prices)) {
    fail(ERROR_CODES.INVALID_INPUT, 'prices', '"prices" must be a null-prototype object');
  }
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail(ERROR_CODES.INVALID_CANDIDATE, 'prices', 'lookupPrice requires a candidate object');
  }
  const key = priceKey(candidate.product_id, candidate.product_variant_id, candidate.component_role);
  if (!Object.prototype.hasOwnProperty.call(prices, key)) {
    fail(ERROR_CODES.INVALID_CANDIDATE, 'prices', `No price for candidate key ${key}`);
  }
  return prices[key];
}

module.exports = { priceKey, validatePrices, lookupPrice };


