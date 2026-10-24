'use strict';

/**
 * scripts/lib/offer-provenance.js - the PURE half of
 * `scripts/check-offer-provenance.js`.
 *
 * WHY THIS EXISTS. The catalog holds 101 `store_offer` rows whose only link to a
 * retailer is a seed script: they were written with `last_checked_at = NOW()` at
 * seed-apply time, carry no `product_url`, no `seller_name`, no
 * `listing_identifier` and no `ingestion_record_id`, and their two `store` rows
 * point at `example.ma`. Nothing about them says which retailer page the price
 * came from, or when. Reading `last_checked_at` as "recently verified" therefore
 * overstates the data, and the age-based freshness gate cannot tell the
 * difference: it can only ask whether a timestamp is old.
 *
 * This module answers the question the freshness gate cannot: DOES THIS PRICE
 * HAVE A RETAILER BEHIND IT? An offer is VERIFIED only when all of the following
 * hold, each of them a fact the ingestion path writes and nothing else does:
 *
 *   1. `ingestion_record_id` is NOT NULL  - it came through an ingestion run,
 *      not a seed file (Decision 35's SEED/UNVERIFIED class);
 *   2. `listing_identifier` is non-empty  - the retailer's own stable key for the
 *      listing (migration 017). Without it there is no way to re-check or even
 *      discuss "the same offer";
 *   3. `product_url` parses as http(s)    - the page a human can open;
 *   4. `seller_name` is non-empty         - the marketplace seller, when the
 *      listing is not the store's own;
 *   5. the URL's host belongs to the STORE's own host (`store.website_url`), so a
 *      file cannot label a row "NextGamer" and link to another retailer;
 *   6. `fetched_at` is present and not in the future - the observation time.
 *
 * A row that fails any one of these is classified with that FIRST failure, so the
 * report names the repair rather than a generic "not verified". SEED rows are a
 * separate class, never a defect: they are the beta's deliberate fixture, and the
 * verdict is INCONCLUSIVE (never PASS) while they are the whole catalog.
 *
 * PURITY. No `pg`, no clock read (`asOf` is passed in), no I/O, no mutation.
 * `scripts/check-offer-provenance.js` owns the SELECTs and the printing.
 */

/** One class per row; the enum is the report's vocabulary. */
const PROVENANCE_CLASSES = Object.freeze({
  VERIFIED: 'VERIFIED',
  SEED_UNVERIFIED: 'SEED_UNVERIFIED',
  MISSING_LISTING_IDENTIFIER: 'MISSING_LISTING_IDENTIFIER',
  MISSING_PRODUCT_URL: 'MISSING_PRODUCT_URL',
  MISSING_SELLER_NAME: 'MISSING_SELLER_NAME',
  MALFORMED_PRODUCT_URL: 'MALFORMED_PRODUCT_URL',
  STORE_WITHOUT_HOST: 'STORE_WITHOUT_HOST',
  HOST_MISMATCH: 'HOST_MISMATCH',
  MISSING_FETCHED_AT: 'MISSING_FETCHED_AT',
  FETCHED_AT_IN_FUTURE: 'FETCHED_AT_IN_FUTURE',
});

const CLASS_ORDER = Object.freeze([
  PROVENANCE_CLASSES.VERIFIED,
  PROVENANCE_CLASSES.SEED_UNVERIFIED,
  PROVENANCE_CLASSES.MISSING_LISTING_IDENTIFIER,
  PROVENANCE_CLASSES.MISSING_PRODUCT_URL,
  PROVENANCE_CLASSES.MISSING_SELLER_NAME,
  PROVENANCE_CLASSES.MALFORMED_PRODUCT_URL,
  PROVENANCE_CLASSES.STORE_WITHOUT_HOST,
  PROVENANCE_CLASSES.HOST_MISMATCH,
  PROVENANCE_CLASSES.MISSING_FETCHED_AT,
  PROVENANCE_CLASSES.FETCHED_AT_IN_FUTURE,
]);

/** Non-empty trimmed string, or null. */
function textOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Lower-cased host of an http(s) URL, `www.` stripped, or null.
 *
 * `new URL` is the parser: it rejects `example.ma/x` without a scheme, which is
 * exactly the malformed case this must catch. A non-http scheme is malformed too
 * - a `file:` or `javascript:` "product URL" is not a listing.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function hostOf(value) {
  const raw = textOrNull(value);
  if (raw === null) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_error) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  return host.startsWith('www.') ? host.slice(4) : host;
}

/** A Date from a pg value (Date | ISO string), or null when unparseable/absent. */
function dateOrNull(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Classify ONE offer row. The first failing rule wins, in the order documented in
 * the header, so the class names the repair an operator should make.
 *
 * @param {object} offer {
 *   ingestion_record_id, listing_identifier, product_url, seller_name,
 *   fetched_at, store_website_url
 * }
 * @param {{asOf?: Date}} [options]
 * @returns {string} one of PROVENANCE_CLASSES
 */
function classifyOffer(offer, options) {
  const row = offer || {};
  const asOf = (options && options.asOf) || null;

  // 1. A seed (or hand-written) row: no ingestion run behind it.
  if (row.ingestion_record_id === null || row.ingestion_record_id === undefined) {
    return PROVENANCE_CLASSES.SEED_UNVERIFIED;
  }
  // 2. The retailer's own key for the listing.
  if (textOrNull(row.listing_identifier) === null) return PROVENANCE_CLASSES.MISSING_LISTING_IDENTIFIER;
  // 3. A page a human can open.
  const productUrl = textOrNull(row.product_url);
  if (productUrl === null) return PROVENANCE_CLASSES.MISSING_PRODUCT_URL;
  const productHost = hostOf(productUrl);
  if (productHost === null) return PROVENANCE_CLASSES.MALFORMED_PRODUCT_URL;
  // 4. The seller the price belongs to.
  if (textOrNull(row.seller_name) === null) return PROVENANCE_CLASSES.MISSING_SELLER_NAME;
  // 5. The URL must belong to the store it claims. A store with no usable host is
  //    a different problem (its own row needs fixing), never a silent pass.
  const storeHost = hostOf(row.store_website_url);
  if (storeHost === null) return PROVENANCE_CLASSES.STORE_WITHOUT_HOST;
  if (productHost !== storeHost && !productHost.endsWith('.' + storeHost)) {
    return PROVENANCE_CLASSES.HOST_MISMATCH;
  }
  // 6. The observation time.
  const fetchedAt = dateOrNull(row.fetched_at);
  if (fetchedAt === null) return PROVENANCE_CLASSES.MISSING_FETCHED_AT;
  if (asOf instanceof Date && fetchedAt.getTime() > asOf.getTime()) {
    return PROVENANCE_CLASSES.FETCHED_AT_IN_FUTURE;
  }
  return PROVENANCE_CLASSES.VERIFIED;
}

/**
 * Audit the price-observation trail.
 *
 * Every `price_history` row must carry the ingestion record that observed it and
 * an `observed_at` that is present and not in the future. A history row without a
 * record is an untraceable price, which is the same defect as an untraceable
 * offer.
 *
 * @param {Array<{store_offer_id: string, observed_at: Date|string|null, ingestion_record_id: string|null}>} history
 * @param {{asOf?: Date}} [options]
 * @returns {{total: number, traced: number, untraceable: Array<object>, newest: Date|null, oldest: Date|null}}
 */
function auditObservations(history, options) {
  const rows = Array.isArray(history) ? history : [];
  const asOf = (options && options.asOf) || null;
  const untraceable = [];
  let newest = null;
  let oldest = null;
  let traced = 0;

  for (const row of rows) {
    const observedAt = dateOrNull(row.observed_at);
    const hasRecord = row.ingestion_record_id !== null && row.ingestion_record_id !== undefined;
    const inFuture = observedAt !== null && asOf instanceof Date && observedAt.getTime() > asOf.getTime();
    if (!hasRecord || observedAt === null || inFuture) {
      untraceable.push({
        store_offer_id: row.store_offer_id,
        reason: !hasRecord ? 'NO_INGESTION_RECORD' : observedAt === null ? 'NO_OBSERVED_AT' : 'OBSERVED_AT_IN_FUTURE',
      });
      continue;
    }
    traced += 1;
    if (newest === null || observedAt > newest) newest = observedAt;
    if (oldest === null || observedAt < oldest) oldest = observedAt;
  }

  return { total: rows.length, traced, untraceable, newest, oldest };
}

/**
 * Evaluate a whole catalog.
 *
 * Verdicts:
 *   FAIL          at least one NON-SEED offer is not VERIFIED (or its history is
 *                 untraceable). This is the only class an operator can fix by
 *                 re-running a refresh, so it is the only gate failure.
 *   INCONCLUSIVE  no non-seed offers exist at all. Never PASS: there is nothing
 *                 whose provenance could have been verified, and calling that
 *                 green is how a seed catalog gets presented as recent data.
 *   PASS          every non-seed offer is VERIFIED and its observations are
 *                 traceable.
 *
 * Price-history rows belonging to SEED offers are NOT audited: their offers have no
 * retailer evidence by construction, so demanding an ingestion record from them
 * would fail the gate on the beta fixture the plan deliberately keeps. They are
 * counted (`observations.seedRows`) and reported as non-auditable, which is the
 * honest reading of "101 rows, none of them retailer observations".
 *
 * @param {object[]} offers rows as classifyOffer takes them
 * @param {object[]} [history] rows as auditObservations takes them
 * @param {{asOf?: Date}} [options]
 */
function evaluateProvenance(offers, history, options) {
  const rows = Array.isArray(offers) ? offers : [];
  const asOf = (options && options.asOf) || null;
  const counts = {};
  for (const cls of CLASS_ORDER) counts[cls] = 0;

  const stores = new Map();
  const problems = [];
  let newestFetchedAt = null;

  for (const row of rows) {
    const cls = classifyOffer(row, { asOf });
    counts[cls] += 1;

    const storeName = textOrNull(row.store_name) || '(unknown store)';
    if (!stores.has(storeName)) {
      stores.set(storeName, { name: storeName, total: 0, verified: 0, classes: {} });
    }
    const bucket = stores.get(storeName);
    bucket.total += 1;
    bucket.classes[cls] = (bucket.classes[cls] || 0) + 1;
    if (cls === PROVENANCE_CLASSES.VERIFIED) {
      bucket.verified += 1;
      const fetchedAt = dateOrNull(row.fetched_at);
      if (fetchedAt !== null && (newestFetchedAt === null || fetchedAt > newestFetchedAt)) newestFetchedAt = fetchedAt;
    } else if (cls !== PROVENANCE_CLASSES.SEED_UNVERIFIED) {
      problems.push({ id: row.id === undefined ? null : row.id, store: storeName, class: cls });
    }
  }

  // Only positive knowledge of a SEED offer excludes its history rows; a history
  // row whose offer is not in this snapshot is still audited (an orphan cannot be
  // excused as seed data without evidence).
  const seedIds = new Set();
  for (const row of rows) {
    if (row.ingestion_record_id === null || row.ingestion_record_id === undefined) seedIds.add(row.id);
  }
  const historyRows = Array.isArray(history) ? history : [];
  const auditableHistory = historyRows.filter((row) => !seedIds.has(row.store_offer_id));
  const observations = Object.assign(auditObservations(auditableHistory, { asOf }), {
    seedRows: historyRows.length - auditableHistory.length,
  });
  const nonSeedTotal = rows.length - counts[PROVENANCE_CLASSES.SEED_UNVERIFIED];
  const observationsUntraceable = observations.total - observations.traced;

  let verdict;
  if (problems.length > 0 || observationsUntraceable > 0) verdict = 'FAIL';
  else if (nonSeedTotal === 0) verdict = 'INCONCLUSIVE';
  else verdict = 'PASS';

  return {
    verdict,
    counts,
    classOrder: CLASS_ORDER,
    total: rows.length,
    seedTotal: counts[PROVENANCE_CLASSES.SEED_UNVERIFIED],
    verifiedTotal: counts[PROVENANCE_CLASSES.VERIFIED],
    nonSeedTotal,
    problems,
    stores: Array.from(stores.values()).sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)),
    observations,
    newestFetchedAt,
  };
}

module.exports = {
  CLASS_ORDER,
  PROVENANCE_CLASSES,
  auditObservations,
  classifyOffer,
  evaluateProvenance,
  hostOf,
};
