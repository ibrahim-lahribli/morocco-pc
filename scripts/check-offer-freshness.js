'use strict';

/**
 * OG-30 offer-freshness gate (read-only), split by Decision 35 class.
 *
 * The gap: every store_offer row was written with last_checked_at = NOW() at
 * seed-apply time (seeds 001/002) and nothing ever refreshes it, while Stage 1
 * hard-filters last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
 * (src/recommendation/offers/select.js, Decision 7, re-enforced in JS).
 * Unrenewed, the oldest rows expire first and every query fails loud with
 * EMPTY_CANDIDATE_POOL once all rows are stale -- an exception, not silent zero
 * builds (budget_floor is computed after Stage 1 and never runs on this path).
 *
 * Decision 35 adds a SECOND class. Stage 1 now labels every offer from its
 * provenance (migration 017): ingestion_record_id IS NULL is SEED/UNVERIFIED,
 * non-NULL is VERIFIED. A seed offer may bypass the 30-day window ONLY when the
 * caller passes allow_unverified_seed_offers (default OFF). This gate therefore
 * reports the two classes separately and FAILs on the non-seed class only: seed
 * offers never count toward "verified fresh", and a stale seed catalog is
 * reported as a loud WARN (the beta trade-off is explicit, not hidden), never as
 * a PASS.
 *
 * Platform P3 Sprint 5 moved the CLASSIFICATION and the DECISION into the pure,
 * unit-tested scripts/lib/offer-freshness.js, and widened the failing class from
 * "has an ingestion record" to "EVERY non-seed offer, regardless of provenance
 * class". That closes OG-52's P4 clause: a non-seed offer whose recorded
 * provenance is not VERIFIED no longer rides along on the seed informational
 * line - it is evaluated by age and can fail the gate. The output below is
 * unchanged for the data it sees today (all 101 offers are seed rows), so
 * "VERIFIED" in these lines means the NON-SEED population; the helper's own
 * header is the contract for the four classes.
 *
 * Distinct from OG-37 (price VALUE accuracy: the half of OG-06 that stayed open
 * when OG-06's missing offer-level unique key closed as C-34 on 2026-10-06) and
 * OG-19 (seller/url NULLs): this measures eligibility (fresh vs expired), never
 * accuracy.
 *
 * Read-only: one SELECT against DATABASE_URL. It never writes, so it needs no
 * TEST_DATABASE_URL guard (same reasoning as the OG-01 gate).
 *
 * Usage: node scripts/check-offer-freshness.js [--warn-days N] [--fail-days N]
 *   --warn-days N: informational warning threshold (default 14)
 *   --fail-days N: failure threshold on days-to-first-non-seed-expiry (default 7)
 * The `=` form is mandatory (`--fail-days=14`); the space form is a usage error
 * by design and exits 2.
 * `RESULT: PASS` requires at least one VERIFIED offer. With none (today's state:
 * all 101 rows are seed data) the verdict is `INCONCLUSIVE`, because "no verified
 * offer has expired" is true and meaningless at the same time -- there is nothing
 * to be fresh. The gate therefore never prints PASS over a catalog that has never
 * been refreshed, and the INCONCLUSIVE line says the seed offers must not be
 * presented as recently verified. That is a WORDING change only: exit stays 0 for
 * both, since the seed class is a deliberate beta trade-off, not a build breaker.
 *
 * Exit codes: 0 = gate satisfied or INCONCLUSIVE; 1 = non-seed offers already
 * expired, or the first non-seed expiry is within --fail-days, or the live data
 * could not be read; 2 = usage error. A stale SEED class is reported but never
 * fails the gate -- the class is not a launch blocker once Decision 35 exists.
 */

require('dotenv').config();
const { Client } = require('pg');

const { classifyOffer, evaluateFreshness, CLASSIFICATIONS } = require('./lib/offer-freshness');

const DAY_MS = 24 * 60 * 60 * 1000;

const ARGS = process.argv.slice(2);
let warnDays = 14;
let failDays = 7;
for (const arg of ARGS) {
  const warnMatch = /^--warn-days=(\d+)$/.exec(arg);
  const failMatch = /^--fail-days=(\d+)$/.exec(arg);
  if (warnMatch) warnDays = parseInt(warnMatch[1], 10);
  else if (failMatch) failDays = parseInt(failMatch[1], 10);
  else {
    console.error('usage: node scripts/check-offer-freshness.js [--warn-days N] [--fail-days N]');
    process.exit(2);
  }
}

// Rows, not an aggregate: the classification and the decision are the pure
// helper's job now, so the gate reads the columns that helper consumes and does
// the arithmetic in JS (the same reasoning the other guards use to keep ONE owner
// for a rule). `offer_class` is deliberately not selected -- store_offer has no
// such column (it lives on build_component, migration 018), so every live non-seed
// row classifies as NON_SEED_UNVERIFIED and is still evaluated by age.
const OFFERS_SQL = 'SELECT id, last_checked_at, fetched_at, ingestion_record_id FROM store_offer';

/** Days from `asOf` to a Date, or null. */
function daysFrom(asOf, target) {
  if (target === null || target === undefined) return null;
  return (target.getTime() - asOf.getTime()) / DAY_MS;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
    const rows = (await client.query(OFFERS_SQL)).rows;
    const asOf = new Date();
    const view = evaluateFreshness(rows, { failDays, asOf });
    const counts = view.counts;

    // Checked range over every row's last_checked_at (unchanged meaning).
    let oldest = null;
    let newest = null;
    for (const row of rows) {
      const ts = row.last_checked_at instanceof Date ? row.last_checked_at : new Date(row.last_checked_at);
      if (Number.isNaN(ts.getTime())) continue;
      if (oldest === null || ts < oldest) oldest = ts;
      if (newest === null || ts > newest) newest = ts;
    }

    // Diagnostic: how many non-seed offers are NOT VERIFIED provenance. Zero on
    // today's data, so no extra line is printed.
    let nonVerifiedNonSeed = 0;
    for (const row of rows) {
      const cls = classifyOffer(row);
      if (cls === CLASSIFICATIONS.SEED || cls === CLASSIFICATIONS.VERIFIED) continue;
      nonVerifiedNonSeed += 1;
    }

    const firstVerifiedDays = daysFrom(asOf, view.firstExpiry);
    const firstSeedDays = daysFrom(asOf, view.seedFirstExpiry);

    console.log('OG-30 offer-freshness gate (read-only, DATABASE_URL; Decision 35 classes)');
    console.log('Offers: total ' + counts.total);
    console.log(
      '  VERIFIED        (ingestion_record_id NOT NULL): fresh ' +
        counts.nonSeedFresh +
        ' | expired ' +
        counts.nonSeedExpired
    );
    console.log(
      '  SEED/UNVERIFIED (ingestion_record_id IS NULL) : fresh ' +
        counts.seedFresh +
        ' | expired ' +
        counts.seedExpired
    );
    console.log('Checked range: ' + (oldest === null ? 'n/a' : oldest) + ' ... ' + (newest === null ? 'n/a' : newest));
    if (view.firstExpiry === null) {
      console.log('First VERIFIED expiry: n/a (no verified offers yet)');
    } else {
      console.log(
        'First VERIFIED expiry: ' + view.firstExpiry + ' (' + firstVerifiedDays.toFixed(1) + ' days)'
      );
    }
    if (view.seedFirstExpiry !== null) {
      console.log(
        'First SEED expiry:     ' + view.seedFirstExpiry + ' (' + firstSeedDays.toFixed(1) + ' days)'
      );
    }

    // Diagnostics for the widened class, printed only when such offers exist.
    if (nonVerifiedNonSeed > 0) {
      console.log(
        'INFO - ' + nonVerifiedNonSeed + ' non-seed offer(s) are not VERIFIED provenance; each is still evaluated by age'
      );
    }
    if (counts.nonSeedUnknownAge > 0) {
      console.log(
        'WARN - ' + counts.nonSeedUnknownAge + ' non-seed offer(s) have no fetched_at; age is UNKNOWN and is never counted as fresh'
      );
    }

    // ---- non-seed class decides the gate -----------------------------------
    let exitCode = 0;
    if (counts.nonSeedExpired > 0) {
      console.log(
        'RESULT: FAIL - ' +
          counts.nonSeedExpired +
          ' VERIFIED offer(s) already fail the Stage 1 30-day predicate'
      );
      exitCode = 1;
    } else if (counts.nonSeedTotal > 0 && firstVerifiedDays !== null && firstVerifiedDays <= failDays) {
      console.log(
        'RESULT: FAIL - first VERIFIED offer expires within ' + failDays + ' days; refresh the source before then'
      );
      exitCode = 1;
    } else if (counts.nonSeedTotal === 0) {
      // Not a PASS: there is no verified offer whose freshness could be asserted.
      console.log(
        'RESULT: INCONCLUSIVE - no VERIFIED offer exists, so nothing here is fresh or stale. The ' +
          counts.seedTotal +
          ' SEED/UNVERIFIED offer(s) must not be presented as recently verified.'
      );
      console.log(
        '        Refresh from a real retailer source (docs/IMPORT_OFFERS.md, "Refresh the catalog"),' +
          ' then re-run this gate and node scripts/check-offer-provenance.js.'
      );
    } else {
      console.log(
        'RESULT: PASS - no expired VERIFIED offers and first VERIFIED expiry beyond ' + failDays + ' days'
      );
      if (firstVerifiedDays !== null && firstVerifiedDays <= warnDays) {
        console.log('WARN - first VERIFIED expiry within ' + warnDays + ' days; schedule a source refresh');
      }
    }

    // ---- SEED class is reported, never failed ------------------------------
    if (counts.seedTotal > 0) {
      if (counts.seedExpired > 0) {
        console.log(
          'WARN - ' +
            counts.seedExpired +
            ' SEED/UNVERIFIED offer(s) already expired; runs continue ONLY with allow_unverified_seed_offers=ON, otherwise they fail EMPTY_CANDIDATE_POOL'
        );
      } else if (firstSeedDays !== null && firstSeedDays <= warnDays) {
        console.log(
          'WARN - first SEED/UNVERIFIED expiry within ' +
            warnDays +
            ' days (' +
            firstSeedDays.toFixed(1) +
            '); re-apply seed 006_offer_refresh.sql or run with allow_unverified_seed_offers=ON'
        );
      } else {
        console.log(
          'INFO - ' +
            counts.seedFresh +
            ' SEED/UNVERIFIED offer(s) fresh; never counted toward verified-fresh'
        );
      }
    }

    await client.end();
    process.exit(exitCode);
  } catch (err) {
    console.error('ERROR:', err.message);
    if (client) await client.end();
    process.exit(1);
  }
}

main();
