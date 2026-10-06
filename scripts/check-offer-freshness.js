'use strict';

/**
 * OG-30 offer-freshness cliff gate (read-only), split by Decision 35 class.
 *
 * The gap: every store_offer row was written with last_checked_at = NOW()
 * at seed-apply time (seeds 001/002) and nothing ever refreshes it, while
 * Stage 1 hard-filters last_checked_at >= CURRENT_TIMESTAMP - INTERVAL
 * '30 days' (src/recommendation/offers/select.js, Decision 7, re-enforced in
 * JS). Unrenewed, the oldest rows expire first and every query fails loud with
 * EMPTY_CANDIDATE_POOL once all rows are stale -- an exception, not silent
 * zero builds (budget_floor is computed after Stage 1 and never runs on this
 * path).
 *
 * Decision 35 adds a SECOND class. Stage 1 now labels every offer from its
 * provenance (migration 017): ingestion_record_id IS NULL is SEED/UNVERIFIED,
 * non-NULL is VERIFIED. A seed offer may bypass the 30-day window ONLY when the
 * caller passes allow_unverified_seed_offers (default OFF). This gate therefore
 * reports the two classes separately and FAILs on the VERIFIED class only:
 * seed offers never count toward "verified fresh", and a stale seed catalog is
 * reported as a loud WARN (the beta trade-off is explicit, not hidden), never
 * as a PASS.
 *
 * Distinct from OG-06 (price VALUE accuracy) and OG-19 (seller/url NULLs):
 * this measures eligibility (fresh vs expired), never accuracy.
 *
 * Read-only: one SELECT against DATABASE_URL. It never writes, so it needs
 * no TEST_DATABASE_URL guard (same reasoning as the OG-01 gate).
 *
 * Usage: node scripts/check-offer-freshness.js [--warn-days N] [--fail-days N]
 *   --warn-days N: informational warning threshold (default 14)
 *   --fail-days N: failure threshold on days-to-first-VERIFIED-expiry (default 7)
 * Exit codes: 0 = gate satisfied; 1 = VERIFIED offers already expired, or the
 * first VERIFIED expiry is within --fail-days, or the live data could not be
 * read; 2 = usage error. A stale SEED class is reported but never fails the
 * gate -- the class is not a launch blocker once Decision 35 exists.
 */

require('dotenv').config();
const { Client } = require('pg');

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

const FRESHNESS_SQL = [
  'SELECT count(*)::int AS total,',
  '  count(*) FILTER (WHERE o.ingestion_record_id IS NULL)::int AS seed_total,',
  '  count(*) FILTER (WHERE o.ingestion_record_id IS NOT NULL)::int AS verified_total,',
  "  count(*) FILTER (WHERE o.ingestion_record_id IS NULL AND o.last_checked_at >= NOW() - INTERVAL '30 days')::int AS seed_fresh,",
  "  count(*) FILTER (WHERE o.ingestion_record_id IS NULL AND o.last_checked_at < NOW() - INTERVAL '30 days')::int AS seed_expired,",
  "  count(*) FILTER (WHERE o.ingestion_record_id IS NOT NULL AND o.last_checked_at >= NOW() - INTERVAL '30 days')::int AS verified_fresh,",
  "  count(*) FILTER (WHERE o.ingestion_record_id IS NOT NULL AND o.last_checked_at < NOW() - INTERVAL '30 days')::int AS verified_expired,",
  '  min(o.last_checked_at) AS oldest,',
  '  max(o.last_checked_at) AS newest,',
  "  min(o.last_checked_at + INTERVAL '30 days') FILTER (WHERE o.ingestion_record_id IS NOT NULL) AS first_verified_expiry,",
  "  EXTRACT(EPOCH FROM (min(o.last_checked_at + INTERVAL '30 days') FILTER (WHERE o.ingestion_record_id IS NOT NULL) - NOW())) / 86400 AS days_to_first_verified_expiry,",
  "  min(o.last_checked_at + INTERVAL '30 days') FILTER (WHERE o.ingestion_record_id IS NULL) AS first_seed_expiry,",
  "  EXTRACT(EPOCH FROM (min(o.last_checked_at + INTERVAL '30 days') FILTER (WHERE o.ingestion_record_id IS NULL) - NOW())) / 86400 AS days_to_first_seed_expiry",
  'FROM store_offer o',
].join(' ');

function days(value) {
  return value === null || value === undefined ? null : Number(value);
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
    const row = (await client.query(FRESHNESS_SQL)).rows[0];

    const firstVerified = days(row.days_to_first_verified_expiry);
    const firstSeed = days(row.days_to_first_seed_expiry);

    console.log('OG-30 offer-freshness gate (read-only, DATABASE_URL; Decision 35 classes)');
    console.log('Offers: total ' + row.total);
    console.log(
      '  VERIFIED        (ingestion_record_id NOT NULL): fresh ' +
        row.verified_fresh +
        ' | expired ' +
        row.verified_expired
    );
    console.log(
      '  SEED/UNVERIFIED (ingestion_record_id IS NULL) : fresh ' +
        row.seed_fresh +
        ' | expired ' +
        row.seed_expired
    );
    console.log('Checked range: ' + row.oldest + ' ... ' + row.newest);
    if (row.first_verified_expiry === null) {
      console.log('First VERIFIED expiry: n/a (no verified offers yet)');
    } else {
      console.log(
        'First VERIFIED expiry: ' +
          row.first_verified_expiry +
          ' (' +
          firstVerified.toFixed(1) +
          ' days)'
      );
    }
    if (row.first_seed_expiry !== null) {
      console.log(
        'First SEED expiry:     ' +
          row.first_seed_expiry +
          ' (' +
          firstSeed.toFixed(1) +
          ' days)'
      );
    }

    // ---- VERIFIED class decides the gate -----------------------------------
    let exitCode = 0;
    if (row.verified_expired > 0) {
      console.log(
        'RESULT: FAIL - ' +
          row.verified_expired +
          ' VERIFIED offer(s) already fail the Stage 1 30-day predicate'
      );
      exitCode = 1;
    } else if (row.verified_total > 0 && firstVerified <= failDays) {
      console.log(
        'RESULT: FAIL - first VERIFIED offer expires within ' + failDays + ' days; refresh the source before then'
      );
      exitCode = 1;
    } else {
      console.log(
        'RESULT: PASS - no expired VERIFIED offers and first VERIFIED expiry beyond ' + failDays + ' days'
      );
      if (row.verified_total > 0 && firstVerified <= warnDays) {
        console.log('WARN - first VERIFIED expiry within ' + warnDays + ' days; schedule a source refresh');
      }
    }

    // ---- SEED class is reported, never failed ------------------------------
    if (row.seed_total > 0) {
      if (row.seed_expired > 0) {
        console.log(
          'WARN - ' +
            row.seed_expired +
            ' SEED/UNVERIFIED offer(s) already expired; runs continue ONLY with allow_unverified_seed_offers=ON, otherwise they fail EMPTY_CANDIDATE_POOL'
        );
      } else if (firstSeed !== null && firstSeed <= warnDays) {
        console.log(
          'WARN - first SEED/UNVERIFIED expiry within ' +
            warnDays +
            ' days (' +
            firstSeed.toFixed(1) +
            '); re-apply seed 006_offer_refresh.sql or run with allow_unverified_seed_offers=ON'
        );
      } else {
        console.log(
          'INFO - ' +
            row.seed_fresh +
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
