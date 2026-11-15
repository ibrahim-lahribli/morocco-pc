/**
 * check-offer-provenance — provenance gate (ingestion-owned).
 *
 * Defines what "imported from a retailer" means: VERIFIED requires an
 * ingestion record + listing id + matching host + seller + non-future
 * fetched_at. Reports PASS / FAIL / INCONCLUSIVE; INCONCLUSIVE is never
 * reported as PASS.
 *
 * @see RFC §8.3 — Gate ownership: ingestion owns provenance gate
 * @see existing: scripts/check-offer-provenance.js
 */

'use strict';

const { URL } = require('node:url');

/**
 * check-offer-provenance — provenance gate (ingestion-owned).
 *
 * Defines what "imported from a retailer" means: a VERIFIED offer requires an
 * ingestion record, a listing identifier, an https product_url whose host is
 * its own store's, a seller name, and a non-future fetched_at.
 * Reports PASS / FAIL / INCONCLUSIVE; INCONCLUSIVE is never reported as PASS.
 *
 * The verdict logic is pure (`evaluateOfferProvenance`) so it is unit-testable
 * without a database; this module owns the two read-only SELECTs.
 *
 * @see RFC §8.3 — Gate ownership: ingestion owns provenance gate
 * @see existing: scripts/check-offer-provenance.js
 */

const OFFER_CLASS_SEED = 'SEED';
const OFFER_CLASS_VERIFIED = 'VERIFIED';

const PROBLEM_MISSING_LISTING_IDENTIFIER = 'MISSING_LISTING_IDENTIFIER';
const PROBLEM_MISSING_SELLER = 'MISSING_SELLER';
const PROBLEM_MISSING_PRODUCT_URL = 'MISSING_PRODUCT_URL';
const PROBLEM_URL_HOST_MISMATCH = 'URL_HOST_MISMATCH';
const PROBLEM_URL_HOST_UNVERIFIABLE = 'URL_HOST_UNVERIFIABLE';
const PROBLEM_FETCHED_AT_INVALID = 'FETCHED_AT_INVALID';
const PROBLEM_HISTORY_UNTRACED = 'HISTORY_UNTRACED';

const OFFER_FIELDS = [
  's.id',
  's.store_id',
  's.listing_identifier',
  's.product_url',
  's.seller_name',
  's.fetched_at',
  's.ingestion_record_id',
  'st.name AS store_name',
  'st.website_url',
].join(', ');

const OFFER_SQL = [
  'SELECT ' + OFFER_FIELDS,
  'FROM store_offer s',
  'JOIN store st ON st.id = s.store_id',
  'WHERE s.ingestion_record_id IS NOT NULL',
].join('\n');

const HISTORY_SQL = 'SELECT id, store_offer_id, ingestion_record_id FROM price_history';

function hostOf(urlString) {
  if (!urlString) return null;
  try {
    return new URL(String(urlString)).hostname.toLowerCase();
  } catch (_err) {
    return null;
  }
}

/**
 * Pure provenance evaluation over already-fetched rows.
 *
 * @param {object[]} offers - store_offer rows joined with store (non-seed only)
 * @param {object[]} history - price_history rows
 * @param {object} options - { asOf?: Date }
 * @returns {{ verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE', details: string[], problems: object[], classes: object }}
 */
function evaluateOfferProvenance(offers, history, options = {}) {
  const asOf = options.asOf == null ? new Date() : options.asOf;
  const asOfMs = asOf instanceof Date ? asOf.getTime() : new Date(asOf).getTime();

  const untracedOffers = new Set();
  for (const row of history) {
    if (row.ingestion_record_id == null) untracedOffers.add(String(row.store_offer_id));
  }

  const problems = [];

  for (const offer of offers) {
    const id = String(offer.id);
    const storeHost = hostOf(offer.website_url);
    const offerHost = hostOf(offer.product_url);
    const fetchedAt = offer.fetched_at == null ? null : new Date(offer.fetched_at);
    const fetchedInvalid =
      fetchedAt == null || Number.isNaN(fetchedAt.getTime()) || fetchedAt.getTime() > asOfMs;

    if (!offer.listing_identifier) {
      problems.push({ id, store: offer.store_name, class: PROBLEM_MISSING_LISTING_IDENTIFIER, reason: 'no listing identifier' });
    }
    if (!offer.seller_name) {
      problems.push({ id, store: offer.store_name, class: PROBLEM_MISSING_SELLER, reason: 'no seller name' });
    }
    if (!offer.product_url) {
      problems.push({ id, store: offer.store_name, class: PROBLEM_MISSING_PRODUCT_URL, reason: 'no product_url' });
    } else if (storeHost == null) {
      problems.push({ id, store: offer.store_name, class: PROBLEM_URL_HOST_UNVERIFIABLE, reason: 'store has no website_url to verify the host against' });
    } else if (offerHost == null || offerHost !== storeHost) {
      problems.push({ id, store: offer.store_name, class: PROBLEM_URL_HOST_MISMATCH, reason: 'product_url host does not belong to the store' });
    }
    if (fetchedInvalid) {
      problems.push({ id, store: offer.store_name, class: PROBLEM_FETCHED_AT_INVALID, reason: 'fetched_at missing, unparseable, or in the future' });
    }
    if (untracedOffers.has(id)) {
      problems.push({ id, store: offer.store_name, class: PROBLEM_HISTORY_UNTRACED, reason: 'price observations not traced to an ingestion record' });
    }
  }

  const verdict = offers.length === 0 ? 'INCONCLUSIVE' : problems.length > 0 ? 'FAIL' : 'PASS';

  const details = [];
  for (const problem of problems) {
    details.push(`offer ${problem.id} [${problem.store}] ${problem.class}: ${problem.reason}`);
  }

  return { verdict, details, problems, classes: { verified: offers.length } };
}

/**
 * Check that every imported offer has complete provenance evidence.
 * @param {object} client - pg Client
 * @returns {Promise<{ verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE', details: string[] }>}
 */
async function checkOfferProvenance(client) {
  const offers = (await client.query(OFFER_SQL)).rows;
  const history = (await client.query(HISTORY_SQL)).rows;
  const result = evaluateOfferProvenance(offers, history);
  return { verdict: result.verdict, details: result.details };
}

module.exports = {
  OFFER_CLASS_SEED,
  OFFER_CLASS_VERIFIED,
  PROBLEM_MISSING_LISTING_IDENTIFIER,
  PROBLEM_MISSING_SELLER,
  PROBLEM_MISSING_PRODUCT_URL,
  PROBLEM_URL_HOST_MISMATCH,
  PROBLEM_URL_HOST_UNVERIFIABLE,
  PROBLEM_FETCHED_AT_INVALID,
  PROBLEM_HISTORY_UNTRACED,
  OFFER_SQL,
  HISTORY_SQL,
  evaluateOfferProvenance,
  checkOfferProvenance,
};
