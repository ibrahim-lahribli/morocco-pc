'use strict';

// scripts/lib/offer-freshness.js - the PURE half of the OG-30 offer-freshness
// gate (Platform P3 Sprint 5).
//
// WHAT IT ANSWERS. Given `store_offer` rows, which offers have fallen - or are
// about to fall - out of the Decision 7 30-day eligibility window, and which are
// only informational? The gate script (scripts/check-offer-freshness.js) owns the
// SQL and the printing; THIS module owns the classification and the decision, so
// both can be pinned by tests that need no database.
//
// WHY IT EXISTS. The gate used to classify in SQL with one predicate -
// `ingestion_record_id IS NULL` -> SEED, else VERIFIED - and decide PASS/FAIL in
// the same query, so a NON-SEED offer that is not `VERIFIED` had no class of its
// own: it was silently lumped in with the seed class and could age out with
// nothing but an informational line (OG-52's P4 clause). The classification is
// now four-valued and lives here, and EVERY non-seed class is evaluated by age
// and can fail the gate.
//
// THE FOUR CLASSES (`classifyOffer`). They answer "what provenance does this
// offer claim", and only the SEED class changes the DECISION:
//
//   SEED                 no ingestion record at all (`ingestion_record_id IS
//                        NULL`). A seed-catalog row. INFORMATIONAL - it never
//                        fails the gate, because Decision 35's beta waiver
//                        (`allow_unverified_seed_offers`) is what lets runs
//                        continue over a stale seed catalog.
//   VERIFIED             a non-seed offer the caller marks verified
//                        (`offer_class === 'VERIFIED'`).
//   UNVERIFIED           a non-seed offer the caller marks unverified
//                        (`offer_class === 'SEED_UNVERIFIED'`, Decision 35's own
//                        vocabulary).
//   NON_SEED_UNVERIFIED  a non-seed offer whose provenance is otherwise
//                        unrecorded - the LIVE case today, because `store_offer`
//                        has NO `offer_class` column (that vocabulary lives on
//                        `build_component`, migration 018). The gate therefore
//                        treats every ingested offer as NON_SEED_UNVERIFIED until
//                        a class is recorded, which is exactly the class whose
//                        staleness the old gate could not see.
//
// All three non-seed classes fail alike; the distinction is diagnostic. If a
// future migration adds `offer_class` (or a join supplies it), the finer classes
// light up with no change to the decision.
//
// THE AGE BASIS differs by class, deliberately:
//   * a SEED row is governed by `last_checked_at` - the column the Stage 1
//     predicate reads and the one seed 006_offer_refresh.sql re-stamps - so the
//     gate's own historical numbers (101 seed offers, first expiry 2026-11-03)
//     are reproduced exactly;
//   * an INGESTED row is governed by `fetched_at`, the real fetch time, because
//     `last_checked_at` is maintenance state a re-stamp can move with no fetch
//     having happened; measuring an ingested offer's age off it would let a
//     genuinely stale observation look fresh.
// A non-seed row with a NULL `fetched_at` has no computable age: it is REPORTED
// (`warnings`, reason `UNKNOWN_AGE`) and is never counted as fresh.
//
// PURITY. `evaluateFreshness` reads no clock: `asOf` is a REQUIRED argument, so
// the same rows + options always produce the same verdict. The script passes
// `new Date()`. It never mutates its inputs, and `failing`/`warnings` are sorted
// by id (code-unit, never `localeCompare`) so the output is deterministic.

/** Decision 7's Stage 1 window: `last_checked_at >= NOW() - INTERVAL '30 days'`. */
const FRESHNESS_WINDOW_DAYS = 30;

/** The gate's default failure horizon; CI passes 14 so a nightly warns two weeks out. */
const DEFAULT_FAIL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The gate's provenance classes. See the header for the mapping. */
const CLASSIFICATIONS = Object.freeze({
  SEED: 'SEED',
  VERIFIED: 'VERIFIED',
  UNVERIFIED: 'UNVERIFIED',
  NON_SEED_UNVERIFIED: 'NON_SEED_UNVERIFIED',
});

/**
 * A seed offer is one with no ingestion record (Decision 35 / migration 017).
 * Null and undefined are both "no record"; a missing row is treated the same so
 * the classifier is total.
 *
 * @param {object} row a `store_offer` row (or row-like fixture)
 * @returns {boolean}
 */
function isSeedOffer(row) {
  return row === null || row === undefined
    || row.ingestion_record_id === null
    || row.ingestion_record_id === undefined;
}

/**
 * Classify an offer's provenance (see the header). Total: every input maps to
 * one of the four classes, and an unrecognized `offer_class` is
 * NON_SEED_UNVERIFIED rather than "verified" - an unknown provenance is never
 * advertised as verified (the same fail-safe direction Decision 36 item 4 uses).
 *
 * @param {object} row a `store_offer` row (or row-like fixture); reads
 *        `ingestion_record_id` and the optional `offer_class`
 * @returns {'SEED'|'VERIFIED'|'UNVERIFIED'|'NON_SEED_UNVERIFIED'}
 */
function classifyOffer(row) {
  if (isSeedOffer(row)) {
    return CLASSIFICATIONS.SEED;
  }
  const declared = row.offer_class;
  if (declared === 'VERIFIED') {
    return CLASSIFICATIONS.VERIFIED;
  }
  if (declared === 'SEED_UNVERIFIED') {
    return CLASSIFICATIONS.UNVERIFIED;
  }
  return CLASSIFICATIONS.NON_SEED_UNVERIFIED;
}

/**
 * Coerce a timestamp-ish value (Date or string) to a Date, or null when it is
 * absent or unparseable. Never throws on bad input - the gate must stay total.
 *
 * @param {Date|string|null|undefined} value
 * @returns {Date|null}
 */
function toDate(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Code-unit id ordering; never localeCompare (determinism, AGENTS §5). */
function compareById(a, b) {
  const left = a.id === null || a.id === undefined ? '' : String(a.id);
  const right = b.id === null || b.id === undefined ? '' : String(b.id);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Decide the gate's verdict over a set of offers.
 *
 * A non-seed offer is FAILING when its age puts its expiry at or inside
 * `failDays` (inclusive at exactly `failDays` - the boundary is the point). An
 * already-expired offer is failing too, with reason `EXPIRED`; one still inside
 * the window but within `failDays` of expiry is `EXPIRING`. A SEED offer never
 * enters `failing`; its staleness is reported through `counts`/`seedFirstExpiry`
 * so the script can print the informational line unchanged.
 *
 * @param {Array<object>} rows `store_offer` rows (id, last_checked_at,
 *        fetched_at, ingestion_record_id, optional offer_class)
 * @param {{failDays?: number, asOf: Date|string}} options `asOf` is REQUIRED (the
 *        function is pure: it never reads the clock)
 * @returns {{
 *   failing: Array<object>, warnings: Array<object>,
 *   firstExpiry: Date|null, seedFirstExpiry: Date|null,
 *   counts: object
 * }}
 */
function evaluateFreshness(rows, options) {
  if (!Array.isArray(rows)) {
    throw new TypeError('evaluateFreshness requires an array of offer rows');
  }
  const opts = options === null || options === undefined ? {} : options;
  const failDays = opts.failDays === undefined ? DEFAULT_FAIL_DAYS : Number(opts.failDays);
  if (!Number.isFinite(failDays) || failDays < 0) {
    throw new TypeError('evaluateFreshness requires a finite failDays >= 0');
  }
  const asOf = toDate(opts.asOf);
  if (asOf === null) {
    throw new TypeError('evaluateFreshness requires asOf (a Date or date string); it is pure and never reads the clock');
  }

  const windowMs = FRESHNESS_WINDOW_DAYS * DAY_MS;
  const failMs = failDays * DAY_MS;

  const failing = [];
  const warnings = [];
  const counts = {
    total: rows.length,
    seedTotal: 0,
    seedFresh: 0,
    seedExpired: 0,
    seedUnknownAge: 0,
    nonSeedTotal: 0,
    nonSeedFresh: 0,
    nonSeedExpired: 0,
    nonSeedUnknownAge: 0,
  };
  let firstExpiry = null;
  let seedFirstExpiry = null;

  for (const row of rows) {
    // Null-safe: a missing row reads as a seed with no timestamp, so the loop is
    // total over its input the way classifyOffer is.
    const source = row === null || row === undefined ? {} : row;
    const classification = classifyOffer(source);
    const isSeed = classification === CLASSIFICATIONS.SEED;
    const id = source.id === undefined || source.id === null ? null : String(source.id);
    const observedAt = toDate(isSeed ? source.last_checked_at : source.fetched_at);

    if (observedAt === null) {
      if (isSeed) {
        counts.seedTotal += 1;
        counts.seedUnknownAge += 1;
      } else {
        counts.nonSeedTotal += 1;
        counts.nonSeedUnknownAge += 1;
        warnings.push({ id, classification, reason: 'UNKNOWN_AGE' });
      }
      continue;
    }

    const expiresAt = new Date(observedAt.getTime() + windowMs);
    const daysToExpiry = (expiresAt.getTime() - asOf.getTime()) / DAY_MS;

    if (isSeed) {
      counts.seedTotal += 1;
      if (daysToExpiry > 0) {
        counts.seedFresh += 1;
      } else {
        counts.seedExpired += 1;
      }
      if (seedFirstExpiry === null || expiresAt < seedFirstExpiry) {
        seedFirstExpiry = expiresAt;
      }
      continue;
    }

    counts.nonSeedTotal += 1;
    if (daysToExpiry > 0) {
      counts.nonSeedFresh += 1;
    } else {
      counts.nonSeedExpired += 1;
    }
    if (firstExpiry === null || expiresAt < firstExpiry) {
      firstExpiry = expiresAt;
    }
    if (expiresAt.getTime() - asOf.getTime() <= failMs) {
      failing.push({
        id,
        classification,
        observedAt,
        expiresAt,
        daysToExpiry,
        reason: daysToExpiry <= 0 ? 'EXPIRED' : 'EXPIRING',
      });
    }
  }

  failing.sort(compareById);
  warnings.sort(compareById);

  return {
    failing,
    warnings,
    firstExpiry,
    seedFirstExpiry,
    counts,
  };
}

module.exports = {
  FRESHNESS_WINDOW_DAYS,
  DEFAULT_FAIL_DAYS,
  CLASSIFICATIONS,
  isSeedOffer,
  classifyOffer,
  toDate,
  evaluateFreshness,
};
