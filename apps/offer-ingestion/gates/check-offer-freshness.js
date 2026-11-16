/**
 * check-offer-freshness — freshness gate (ingestion-owned).
 *
 * Freshness is an import-acceptance property: offers must have been fetched
 * within the configured window (30 days per Decision 35 / RFC §18).
 * Reports PASS / FAIL / INCONCLUSIVE.
 *
 * @see RFC §8.3 — Gate ownership: ingestion owns freshness gate
 * @see existing: scripts/check-offer-freshness.js
 */

'use strict';

/**
 * check-offer-freshness — freshness gate (ingestion-owned).
 *
 * Freshness is an import-acceptance property: verified offers must have been
 * observed within the configured window (30 days per Decision 7 / Decision 35,
 * RFC §18). Seed offers (no ingestion record) are reported separately and never
 * fail the gate — they are the deliberate beta trade-off, not evidence of
 * freshness.
 *
 * Reports PASS / FAIL / INCONCLUSIVE; INCONCLUSIVE is never reported as PASS.
 *
 * The verdict logic is pure (`evaluateOfferFreshness`) so it is unit-testable
 * without a database; this module owns the single read-only SELECT.
 *
 * @see RFC §8.3 — Gate ownership: ingestion owns freshness gate
 * @see existing: scripts/check-offer-freshness.js
 */

const OFFER_CLASS_SEED = 'SEED';
const OFFER_CLASS_VERIFIED = 'VERIFIED';

const DEFAULT_MAX_AGE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const OFFER_SQL =
  'SELECT id, ingestion_record_id, last_checked_at FROM store_offer';

function ageDays(lastCheckedAt, asOfMs) {
  const observed = lastCheckedAt == null ? null : new Date(lastCheckedAt);
  if (observed == null || Number.isNaN(observed.getTime())) return null;
  return (asOfMs - observed.getTime()) / MS_PER_DAY;
}

/**
 * Pure freshness evaluation over already-fetched rows.
 *
 * @param {object[]} offers - store_offer rows (id, ingestion_record_id, last_checked_at)
 * @param {object} options - { asOf?: Date, maxAgeDays?: number }
 * @returns {{ verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE', details: string[], counts: object }}
 */
function evaluateOfferFreshness(offers, options = {}) {
  const asOf = options.asOf == null ? new Date() : options.asOf;
  const asOfMs = asOf instanceof Date ? asOf.getTime() : new Date(asOf).getTime();
  const maxAgeDays = options.maxAgeDays == null ? DEFAULT_MAX_AGE_DAYS : Number(options.maxAgeDays);

  const counts = {
    seedTotal: 0,
    seedFresh: 0,
    seedExpired: 0,
    verifiedTotal: 0,
    verifiedFresh: 0,
    verifiedExpired: 0,
    verifiedUnknownAge: 0,
  };

  let firstVerifiedDays = null;
  let firstSeedDays = null;

  for (const offer of offers) {
    const verified = offer.ingestion_record_id != null;
    const days = ageDays(offer.last_checked_at, asOfMs);

    if (verified) {
      counts.verifiedTotal += 1;
      if (days == null) {
        counts.verifiedUnknownAge += 1;
        continue;
      }
      if (days > maxAgeDays) {
        counts.verifiedExpired += 1;
      } else {
        counts.verifiedFresh += 1;
      }
      const remaining = maxAgeDays - days;
      if (firstVerifiedDays === null || remaining < firstVerifiedDays) {
        firstVerifiedDays = remaining;
      }
    } else {
      counts.seedTotal += 1;
      if (days == null) continue;
      if (days > maxAgeDays) {
        counts.seedExpired += 1;
      } else {
        counts.seedFresh += 1;
      }
      const remaining = maxAgeDays - days;
      if (firstSeedDays === null || remaining < firstSeedDays) {
        firstSeedDays = remaining;
      }
    }
  }

  const details = [];
  if (counts.verifiedTotal > 0) {
    details.push(`${counts.verifiedFresh} verified fresh, ${counts.verifiedExpired} verified expired`);
    if (counts.verifiedUnknownAge > 0) {
      details.push(`${counts.verifiedUnknownAge} verified with unknown age`);
    }
    if (firstVerifiedDays !== null) {
      details.push(`first verified expiry in ${firstVerifiedDays.toFixed(1)} days`);
    }
  }
  if (counts.seedTotal > 0) {
    details.push(`${counts.seedTotal} seed/unverified offers (${counts.seedFresh} fresh, ${counts.seedExpired} expired)`);
    if (firstSeedDays !== null) {
      details.push(`first seed expiry in ${firstSeedDays.toFixed(1)} days`);
    }
  }

  // Verdict contract (PASS | FAIL | INCONCLUSIVE; INCONCLUSIVE is never PASS):
  //   - INCONCLUSIVE: no verified offers anywhere — nothing to count, not a pass.
  //   - FAIL: any verified offer is expired (beyond the window) or has unknown age.
  //   - PASS: every verified offer has a known age inside the window.
  // `firstVerifiedDays` (the soonest expiry) only measures how close the freshest
  // offer is to expiring; it must not flip a fully-fresh catalog to FAIL.
  let verdict;
  if (counts.verifiedTotal === 0) {
    verdict = 'INCONCLUSIVE';
  } else if (counts.verifiedExpired > 0 || counts.verifiedUnknownAge > 0) {
    verdict = 'FAIL';
  } else {
    verdict = 'PASS';
  }

  return { verdict, details, counts, firstVerifiedDays, firstSeedDays };
}

/**
 * Check that imported verified offers are within the freshness window.
 * @param {object} client - pg Client
 * @param {object} options - { maxAgeDays?: number }
 * @returns {Promise<{ verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE', details: string[] }>}
 */
async function checkOfferFreshness(client, options = {}) {
  const { maxAgeDays = DEFAULT_MAX_AGE_DAYS } = options;
  const offers = (await client.query(OFFER_SQL)).rows;
  const result = evaluateOfferFreshness(offers, { maxAgeDays });
  return { verdict: result.verdict, details: result.details };
}

module.exports = {
  OFFER_CLASS_SEED,
  OFFER_CLASS_VERIFIED,
  DEFAULT_MAX_AGE_DAYS,
  OFFER_SQL,
  ageDays,
  evaluateOfferFreshness,
  checkOfferFreshness,
};
