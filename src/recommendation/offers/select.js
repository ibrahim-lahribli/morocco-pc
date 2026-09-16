/**
 * Engine 2 - Stage 1: offer pre-selection.
 *
 * Boundary: turns an Engine 2C candidate-pool result into the deterministic
 * price-selected subset plus the Engine 3 price carrier, using a
 * single parameterized PostgreSQL query over `store_offer`.
 *
 *   Engine 2C candidate-pool result ({ input, pool })
 *         |  one parameterized query over store_offer
 *         |  strict JS grouping (cheapest eligible offer wins)
 *         v
 *   frozen { input, pool, prices }
 *
 * Eligibility (exact contract, enforced in SQL and re-enforced in JS so fake
 * DB rows that bypass SQL filtering are still excluded):
 *   - currency exactly equals input.currency (no conversion, no folding)
 *   - availability != 'OUT_OF_STOCK' exactly (no case normalization)
 *   - price is a finite number > 0 (NUMERIC strings converted via Number())
 *   - freshness: last_checked_at within 30 days inclusive of the query
 *     decision timestamp, future values accepted
 *   - strict applicability with no fallback:
 *       null-variant candidate    -> only NULL-variant offers, same product
 *       non-null variant candidate -> exact (product_id, variant_id) match
 *
 * Ordering: cheapest eligible offer wins per candidate; equal prices break
 * by store_offer.id ascending. SQL orders deterministically and JS re-applies
 * the same total order, so shuffled equivalent rows stay deterministic.
 *
 * Decision timestamp: the single CURRENT_TIMESTAMP value returned by the
 * Stage 1 query (CURRENT_TIMESTAMP AS price_checked_at), converted to the
 * strict UTC ISO representation required by validatePrices. The per-offer
 * last_checked_at is never used as the decision timestamp.
 *
 * Empty-pool contract: EMPTY_CANDIDATE_POOL is thrown when no candidate has
 * an eligible offer. An empty pool is never passed downstream.
 *
 * Exclusions: no verdict logic, scoring, ranking, assembly, pruning,
 * persistence, store activity filtering, or second price-carrier contract. Price-key format and carrier validation are reused
 * from Engine 3 (priceKey, validatePrices) without reimplementation.
 */

'use strict';

const { createCandidateSelectionInput } = require('../candidates/input');
const { createCandidate } = require('../candidates/candidate');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const { priceKey, validatePrices } = require('../assembly/prices');

/** GPU is variant-keyed; every other role is product-keyed (Engine 2B/2C). */
const GPU_ROLE = 'GPU';

/** 30-day freshness window in milliseconds (inclusive boundary). */
const FRESHNESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** UUID check mirrors the Engine 3 price-carrier contract. */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Single Stage 1 query. Parameterized only ($1, $2); no interpolation.
 * $1 ::uuid[] candidate product ids (prefilter; strict applicability in JS).
 * $2 text       required currency (exact match, no conversion).
 */
const SELECT_OFFER_PRICES_SQL = [
  'SELECT o.id, o.store_id, o.product_id, o.product_variant_id, o.price, o.currency, o.availability, o.last_checked_at, CURRENT_TIMESTAMP AS price_checked_at',
  'FROM store_offer o',
  'WHERE o.product_id = ANY($1::uuid[])',
  'AND o.currency = $2',
  'AND o.price > 0',
  "AND o.availability != 'OUT_OF_STOCK'",
  "AND o.last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'",
  'ORDER BY o.price ASC, o.id ASC',
].join(' ');

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/** Same db contract as Engine 2B / 2D: pg-compatible db.query(sql, params). */
function validateDatabaseClient(db) {
  if (db === null || typeof db !== 'object' || typeof db.query !== 'function') {
    fail(ERROR_CODES.INVALID_INPUT, 'db', 'selectOfferPrices requires a database client exposing query()');
  }
}

/**
 * Validate the Engine 2C candidate-pool result: { input, pool } with a valid
 * Engine 2A selection input and a non-empty candidate array.
 */
function validateCandidatePoolResult(poolResult) {
  if (poolResult === null || typeof poolResult !== 'object' || Array.isArray(poolResult)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'candidatePoolResult',
      'Offer pre-selection requires an Engine 2C candidate-pool result object'
    );
  }
  if (poolResult.input === undefined || poolResult.input === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'input', 'Engine 2C candidate-pool result requires "input"');
  }
  if (poolResult.pool === undefined || poolResult.pool === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'pool', 'Engine 2C candidate-pool result requires "pool"');
  }
  if (!Array.isArray(poolResult.pool)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'pool',
      'Engine 2C candidate-pool result "pool" must be an array of candidate records'
    );
  }
  if (poolResult.pool.length === 0) {
    fail(ERROR_CODES.EMPTY_CANDIDATE_POOL, 'pool', 'Offer pre-selection requires a non-empty candidate pool');
  }
}

/**
 * Engine 2B/2C variant-identity rules, re-enforced at this boundary without
 * normalization (same contract and wording as Engine 2C).
 */
function enforceVariantIdentity(candidate) {
  if (candidate.component_role === GPU_ROLE && candidate.product_variant_id === null) {
    fail(ERROR_CODES.INVALID_CANDIDATE, 'product_variant_id', 'GPU candidates must carry a non-null product_variant_id');
  }
  if (candidate.component_role !== GPU_ROLE && candidate.product_variant_id !== null) {
    fail(ERROR_CODES.INVALID_CANDIDATE, 'product_variant_id', 'Product-keyed candidate must carry a null product_variant_id');
  }
}

/**
 * Convert the query decision timestamp to the strict UTC ISO representation
 * required by validatePrices. Accepts the pg TIMESTAMPTZ forms (Date or
 * string/number). Never falls back to per-offer timestamps or the clock.
 */
function toDecisionIso(value) {
  let iso = null;
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) {
      iso = value.toISOString();
    }
  } else if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      iso = parsed.toISOString();
    }
  }
  if (iso === null) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'prices.price_checked_at', 'Stage 1 decision timestamp must be a valid timestamp');
  }
  return iso;
}

/** Parse a row freshness timestamp to milliseconds, or null when unparseable. */
function toFreshnessMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Sorted (deterministic) id list from a Set of strings. */
function sortedIds(set) {
  return [...set].sort();
}

function candidateMatchesOffer(candidate, offer) {
  if (offer.product_id !== candidate.product_id) {
    return false;
  }
  if (candidate.product_variant_id === null) {
    return offer.product_variant_id === null;
  }
  return offer.product_variant_id === candidate.product_variant_id;
}

function isCheaperOffer(a, b) {
  if (a.price !== b.price) {
    return a.price < b.price;
  }
  return a.id < b.id;
}

/**
 * Normalize one store_offer row, re-enforcing the exact SQL eligibility.
 * Returns null for ineligible rows.
 */
function normalizeOfferRow(row, currency, decisionMs) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return null;
  }
  if (row.currency !== currency) {
    return null;
  }
  if (typeof row.availability !== 'string' || row.availability === 'OUT_OF_STOCK') {
    return null;
  }
  const price = Number(row.price);
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }
  const checkedMs = toFreshnessMs(row.last_checked_at);
  if (checkedMs === null) {
    return null;
  }
  if (checkedMs < decisionMs - FRESHNESS_WINDOW_MS) {
    return null;
  }
  const productId = row.product_id === null || row.product_id === undefined ? null : String(row.product_id);
  if (productId === null || productId.length === 0) {
    return null;
  }
  const rawVariant = row.product_variant_id;
  const variantId = rawVariant === null || rawVariant === undefined ? null : String(rawVariant);
  if (rawVariant !== null && rawVariant !== undefined && variantId.length === 0) {
    return null;
  }
  const storeId = row.store_id === null || row.store_id === undefined ? null : String(row.store_id);
  if (!isUuid(storeId)) {
    return null;
  }
  const offerId = row.id === null || row.id === undefined ? null : String(row.id);
  if (offerId === null || offerId.length === 0) {
    return null;
  }
  return { id: offerId, store_id: storeId, product_id: productId, product_variant_id: variantId, price };
}

/**
 * Select the cheapest eligible offer per candidate.
 *
 * Investigated candidate split: product-level (NULL variant) candidates
 * match only NULL-variant offers; variant-level candidates match only the
 * exact (product_id, product_variant_id) pair. The single SQL prefilter
 * covers the union of product ids; strict applicability stays in JS.
 *
 * @param {object} candidatePoolResult Engine 2C result { input, pool }
 * @param {object} db pg-compatible client exposing db.query(sql, params)
 * @returns {Promise<object>} frozen { input, pool, prices }
 */
async function selectOfferPrices(candidatePoolResult, db) {
  validateCandidatePoolResult(candidatePoolResult);
  validateDatabaseClient(db);

  const input = createCandidateSelectionInput(candidatePoolResult.input);

  // Re-validate pool entries through the Engine 2A candidate contract so the
  // returned pool holds module-owned frozen records. Original 2C order is
  // preserved; no re-sorting happens here.
  const candidates = candidatePoolResult.pool.map((raw) => {
    const candidate = createCandidate(raw);
    enforceVariantIdentity(candidate);
    return candidate;
  });

  const productIds = sortedIds(new Set(candidates.map((c) => c.product_id)));

  const result = await db.query(SELECT_OFFER_PRICES_SQL, [productIds, input.currency]);
  const rows = result && Array.isArray(result.rows) ? result.rows : [];

  if (rows.length === 0) {
    throw new CandidateSelectionError(
      ERROR_CODES.EMPTY_CANDIDATE_POOL,
      'No candidate has an eligible offer',
      'candidates'
    );
  }

  const decisionIso = toDecisionIso(rows[0].price_checked_at);
  const decisionMs = new Date(decisionIso).getTime();

  const eligible = [];
  for (const row of rows) {
    const offer = normalizeOfferRow(row, input.currency, decisionMs);
    if (offer !== null) {
      eligible.push(offer);
    }
  }

  const pool = [];
  const rawCarrier = Object.create(null);
  for (const candidate of candidates) {
    let best = null;
    for (const offer of eligible) {
      if (!candidateMatchesOffer(candidate, offer)) {
        continue;
      }
      if (best === null || isCheaperOffer(offer, best)) {
        best = offer;
      }
    }
    if (best === null) {
      continue;
    }
    pool.push(candidate);
    const key = priceKey(candidate.product_id, candidate.product_variant_id, candidate.component_role);
    const entry = {
      selected_price: best.price,
      currency: input.currency,
      store_id: best.store_id,
      price_checked_at: decisionIso,
    };
    Object.defineProperty(rawCarrier, key, {
      value: entry, enumerable: true, writable: true, configurable: true,
    });
  }

  if (pool.length === 0) {
    throw new CandidateSelectionError(
      ERROR_CODES.EMPTY_CANDIDATE_POOL,
      'No candidate has an eligible offer',
      'candidates'
    );
  }

  const prices = validatePrices(rawCarrier);

  return Object.freeze({
    input,
    pool: Object.freeze(pool),
    prices,
  });
}

module.exports = { selectOfferPrices, SELECT_OFFER_PRICES_SQL };
