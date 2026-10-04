'use strict';

/**
 * OG-30 offer-freshness cliff gate (read-only).
 *
 * The gap: every store_offer row was written with last_checked_at = NOW()
 * at seed-apply time (seeds 001/002) and nothing ever refreshes it, while
 * Stage 1 hard-filters last_checked_at >= CURRENT_TIMESTAMP - INTERVAL
 * '30 days' (src/recommendation/offers/select.js:70, Decision 7,
 * re-enforced in JS). Unrenewed, the oldest rows expire first and every
 * query fails loud with EMPTY_CANDIDATE_POOL once all rows are stale --
 * an exception, not silent zero builds (budget_floor is computed after
 * Stage 1 and never runs on this path).
 *
 * This gate answers "how many days until the first offer expires, and
 * until the total blackout?" -- the standing watch for seed 006
 * (database/seeds/006_offer_refresh.sql), in the same spirit as
 * scripts/check-og01-coverage.js (OG-01) and
 * scripts/check-deferred-rules.js (OG-09...OG-12).
 *
 * Distinct from OG-06 (price VALUE accuracy) and OG-19 (seller/url NULLs):
 * this measures eligibility (fresh vs expired), never accuracy.
 *
 * Read-only: one SELECT against DATABASE_URL. It never writes, so it needs
 * no TEST_DATABASE_URL guard (same reasoning as the OG-01 gate).
 *
 * Usage: node scripts/check-offer-freshness.js [--warn-days N] [--fail-days N]
 *   --warn-days N: informational warning threshold (default 14)
 *   --fail-days N: failure threshold on days-to-first-expiry (default 7)
 * Exit codes: 0 = gate satisfied; 1 = offers already expired, or the first
 * expiry is within --fail-days, or the live data could not be read;
 * 2 = usage error.
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
  '  min(o.last_checked_at) AS oldest,',
  '  max(o.last_checked_at) AS newest,',
  "  count(*) FILTER (WHERE o.last_checked_at >= NOW() - INTERVAL '30 days')::int AS fresh,",
  "  count(*) FILTER (WHERE o.last_checked_at < NOW() - INTERVAL '30 days')::int AS expired,",
  "  min(o.last_checked_at + INTERVAL '30 days') AS first_expiry,",
  "  max(o.last_checked_at + INTERVAL '30 days') AS last_expiry,",
  "  EXTRACT(EPOCH FROM (min(o.last_checked_at + INTERVAL '30 days') - NOW())) / 86400 AS days_to_first_expiry,",
  "  EXTRACT(EPOCH FROM (max(o.last_checked_at + INTERVAL '30 days') - NOW())) / 86400 AS days_to_blackout",
  'FROM store_offer o',
].join(' ');

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

    console.log('OG-30 offer-freshness gate (read-only, DATABASE_URL)');
    console.log(
      'Offers: total ' + row.total + ' | fresh ' + row.fresh + ' | expired ' + row.expired
    );
    console.log('Checked range: ' + row.oldest + ' ... ' + row.newest);
    console.log(
      'First expiry: ' + row.first_expiry + ' (' + Number(row.days_to_first_expiry).toFixed(1) + ' days)'
    );
    console.log(
      'Total blackout: ' + row.last_expiry + ' (' + Number(row.days_to_blackout).toFixed(1) + ' days)'
    );

    let exitCode = 0;
    if (row.expired > 0) {
      console.log('RESULT: FAIL - ' + row.expired + ' offer(s) already fail the Stage 1 30-day predicate');
      exitCode = 1;
    } else if (Number(row.days_to_first_expiry) <= failDays) {
      console.log(
        'RESULT: FAIL - first offer expires within ' + failDays + ' days; refresh seed 006 before then'
      );
      exitCode = 1;
    } else {
      console.log('RESULT: PASS - no expired offers and first expiry beyond ' + failDays + ' days');
      if (Number(row.days_to_first_expiry) <= warnDays) {
        console.log(
          'WARN - first expiry within ' + warnDays + ' days; schedule the seed 006 refresh'
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
