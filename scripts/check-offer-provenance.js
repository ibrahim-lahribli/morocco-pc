'use strict';

/**
 * scripts/check-offer-provenance.js - does each price have a RETAILER behind it?
 *
 * READ-ONLY: one SELECT over `store_offer` JOIN `store`, one over
 * `price_history`, no writes at all, so it needs no TEST_DATABASE_URL guard (the
 * same reasoning as `check-offer-freshness.js` and `check-og01-coverage.js`).
 *
 * WHY IT EXISTS. Every offer in the catalog today was written by a seed file: no
 * `product_url`, no `seller_name`, no `listing_identifier`, no
 * `ingestion_record_id`, and both `store` rows point at `example.ma`. The
 * freshness gate can only ask whether a timestamp is old - it cannot ask whether
 * anything was ever verified - so it prints PASS while the VERIFIED population is
 * empty. This gate answers the other half: WHICH ROW HAS A RETAILER PAGE, a
 * seller, a listing identifier and an observation time behind it, and which is
 * seed data wearing a timestamp.
 *
 * The verdict vocabulary is deliberately three-valued:
 *   PASS          every non-seed offer carries full provenance and every price
 *                 observation is traced to an ingestion record.
 *   INCONCLUSIVE  there are NO non-seed offers at all. Not a pass: nothing could
 *                 have been verified, so the offers must not be presented as
 *                 recently verified. This is today's state, and the report says so
 *                 in words a release note can quote.
 *   FAIL          a non-seed offer is missing part of its provenance, its URL
 *                 points at a host that is not its store's, or a `price_history`
 *                 row cannot be traced to the run that observed it. Each offender
 *                 is named with the class that identifies the repair.
 *
 * Classification rules and the verdict logic live in the pure, unit-tested
 * `scripts/lib/offer-provenance.js`; this file owns the I/O and the printing.
 *
 * Usage:
 *   node scripts/check-offer-provenance.js
 *   node scripts/check-offer-provenance.js --target=env:TARGET_DATABASE_URL
 *   node scripts/check-offer-provenance.js --max-examples=10
 *
 * `--target` takes a VARIABLE NAME (`env:NAME`), never a URL: the connection
 * string carries a password, and this report is meant to be pasted into notes.
 * Equals form is mandatory, like the other read-only gates; `--target env:NAME`
 * is a usage error.
 *
 * Exit codes: 0 = PASS or INCONCLUSIVE; 1 = FAIL or the live data could not be
 * read; 2 = usage error (including --help).
 */

require('dotenv').config();
const { Client } = require('pg');

const { evaluateProvenance, PROVENANCE_CLASSES } = require('./lib/offer-provenance');

const DEFAULT_TARGET_ENV = 'DATABASE_URL';

const USAGE = [
  'usage: node scripts/check-offer-provenance.js [--target=env:NAME] [--max-examples=N]',
  '',
  '  --target=env:NAME    environment variable holding the connection string',
  '                       (default env:' + DEFAULT_TARGET_ENV + ')',
  '  --max-examples=N     offending offers to print per class (default 5)',
  '',
  'Read-only. PASS = every non-seed offer has retailer provenance; INCONCLUSIVE =',
  'no non-seed offer exists (exit 0, but the catalog is NOT verified); FAIL = an',
  'offer cannot be traced to a retailer (exit 1).',
].join('\n');

/**
 * Parse argv. The `=` form only: a URL passed positionally would land in shell
 * history, and `--target env:X` is ambiguous with the next flag.
 *
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{help: boolean, targetEnv: string, maxExamples: number}}
 * @throws {Error} with `usage: true` on anything unrecognised
 */
function parseArgs(argv) {
  const options = { help: false, targetEnv: DEFAULT_TARGET_ENV, maxExamples: 5 };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg.startsWith('--target=env:')) {
      const name = arg.slice('--target=env:'.length).trim();
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
        throw Object.assign(new Error('--target must name an environment variable: --target=env:NAME'), { usage: true });
      }
      options.targetEnv = name;
      continue;
    }
    if (arg.startsWith('--max-examples=')) {
      const raw = arg.slice('--max-examples='.length);
      if (!/^\d+$/.test(raw)) {
        throw Object.assign(new Error('--max-examples expects a non-negative integer'), { usage: true });
      }
      options.maxExamples = parseInt(raw, 10);
      continue;
    }
    throw Object.assign(new Error('unknown argument: ' + arg), { usage: true });
  }
  return options;
}

/** Offers joined to their store; the classifier needs the store's own host. */
const OFFERS_SQL = [
  'SELECT o.id, o.product_url, o.seller_name, o.listing_identifier, o.fetched_at,',
  '       o.last_checked_at, o.ingestion_record_id, o.availability,',
  '       s.name AS store_name, s.website_url AS store_website_url',
  '  FROM store_offer o',
  '  JOIN store s ON s.id = o.store_id',
  ' ORDER BY s.name ASC, o.id ASC',
].join('\n');

/** Every recorded price observation, with the run that recorded it. */
const HISTORY_SQL = [
  'SELECT store_offer_id, observed_at, ingestion_record_id',
  '  FROM price_history',
  ' ORDER BY observed_at ASC',
].join('\n');

/** Human line for one class, printed in a stable order. */
function classLabel(cls) {
  switch (cls) {
    case PROVENANCE_CLASSES.VERIFIED:
      return 'VERIFIED               (ingestion record + URL + seller + listing id + store host match)';
    case PROVENANCE_CLASSES.SEED_UNVERIFIED:
      return 'SEED_UNVERIFIED        (no ingestion record: seed or hand-written, never verified)';
    case PROVENANCE_CLASSES.MISSING_LISTING_IDENTIFIER:
      return 'MISSING_LISTING_ID      (the retailer\'s own stable key for the listing is absent)';
    case PROVENANCE_CLASSES.MISSING_PRODUCT_URL:
      return 'MISSING_PRODUCT_URL    (no page a human could open)';
    case PROVENANCE_CLASSES.MISSING_SELLER_NAME:
      return 'MISSING_SELLER_NAME    (no seller the price belongs to)';
    case PROVENANCE_CLASSES.MALFORMED_PRODUCT_URL:
      return 'MALFORMED_PRODUCT_URL  (not an http(s) URL)';
    case PROVENANCE_CLASSES.STORE_WITHOUT_HOST:
      return 'STORE_WITHOUT_HOST     (the store row has no usable website_url to match against)';
    case PROVENANCE_CLASSES.HOST_MISMATCH:
      return 'HOST_MISMATCH          (the URL host is not the store\'s host)';
    case PROVENANCE_CLASSES.MISSING_FETCHED_AT:
      return 'MISSING_FETCHED_AT     (no observation time)';
    case PROVENANCE_CLASSES.FETCHED_AT_IN_FUTURE:
      return 'FETCHED_AT_IN_FUTURE   (the observation time is ahead of now)';
    default:
      return cls;
  }
}

/**
 * Render the whole report as lines (no I/O, so a test can pin the wording).
 *
 * @param {object} view evaluateProvenance() result
 * @param {{asOf: Date, maxExamples: number}} context
 * @returns {string[]}
 */
function formatReport(view, context) {
  const lines = [];
  lines.push('Offer provenance gate (read-only; retailer evidence per offer)');
  lines.push('As of: ' + context.asOf.toISOString());
  lines.push('Offers: ' + view.total + ' across ' + view.stores.length + ' store(s)');
  for (const cls of view.classOrder) {
    if (view.counts[cls] === 0) continue;
    lines.push('  ' + classLabel(cls) + ': ' + view.counts[cls]);
  }

  if (view.observations.total === 0 && view.observations.seedRows === 0) {
    lines.push('Price observations: none (no price_history rows exist)');
  } else if (view.observations.total === 0 && view.verifiedTotal > 0) {
    // A NEW verified offer records its first observation on the offer itself
    // (`fetched_at`); `price_history` only appends when price/availability CHANGE.
    // Saying "none auditable" beside a PASS would read as "never observed".
    lines.push(
      'Price observations: no price CHANGES recorded yet; a new offer\'s first observation is its fetched_at'
      + (view.observations.seedRows > 0 ? ' (' + view.observations.seedRows + ' SEED history row(s) are not auditable)' : '')
    );
  } else if (view.observations.total === 0) {
    lines.push(
      'Price observations: none auditable; ' + view.observations.seedRows
      + ' row(s) belong to SEED offers and carry no retailer evidence'
    );
  } else {
    lines.push(
      'Price observations: ' + view.observations.total + ' auditable row(s), ' + view.observations.traced
      + ' traced to an ingestion record'
      + (view.observations.seedRows > 0 ? ' (+' + view.observations.seedRows + ' on SEED offers, not auditable)' : '')
      + '; newest ' + (view.observations.newest === null ? 'n/a' : view.observations.newest.toISOString())
    );
  }
  lines.push(
    'Newest retailer observation: '
    + (view.newestFetchedAt === null ? 'none (no offer has ever been refreshed from a retailer)'
      : view.newestFetchedAt.toISOString())
  );

  for (const store of view.stores) {
    const classes = Object.keys(store.classes)
      .sort()
      .map((cls) => cls + ' ' + store.classes[cls])
      .join(', ');
    lines.push('  store ' + store.name + ': ' + store.total + ' offer(s), ' + store.verified + ' verified (' + classes + ')');
  }

  if (view.problems.length > 0) {
    lines.push('Offending non-seed offers (first ' + Math.min(view.problems.length, context.maxExamples) + ' of ' + view.problems.length + '):');
    for (const problem of view.problems.slice(0, context.maxExamples)) {
      lines.push('  ' + (problem.id === null ? '(no id)' : problem.id) + ' [' + problem.store + '] ' + problem.class);
    }
  }
  if (view.observations.untraceable.length > 0) {
    lines.push('Untraceable price observations (first ' + Math.min(view.observations.untraceable.length, context.maxExamples)
      + ' of ' + view.observations.untraceable.length + '):');
    for (const row of view.observations.untraceable.slice(0, context.maxExamples)) {
      lines.push('  ' + row.store_offer_id + ' ' + row.reason);
    }
  }

  if (view.verdict === 'PASS') {
    lines.push('RESULT: PASS - every non-seed offer carries retailer provenance and every observation is traced');
  } else if (view.verdict === 'INCONCLUSIVE') {
    lines.push('RESULT: INCONCLUSIVE - no non-seed offer exists, so NOTHING in this catalog has been');
    lines.push('        verified against a retailer source. The ' + view.seedTotal + ' seed/unverified offer(s) must not be presented as recently verified.');
    lines.push('        Refresh from a real source (docs/IMPORT_OFFERS.md, "Refresh the catalog") and re-run this gate.');
  } else {
    lines.push('RESULT: FAIL - ' + view.problems.length + ' non-seed offer(s) and '
      + view.observations.untraceable.length + ' price observation(s) lack retailer provenance');
  }
  return lines;
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error('ERROR: ' + error.message);
    console.error(USAGE);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 2;
  }

  const connectionString = process.env[options.targetEnv];
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    console.error('ERROR: ' + options.targetEnv + ' is not set (pass --target=env:NAME to name another variable)');
    return 1;
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 15000,
    statement_timeout: 15000,
    application_name: 'morocco-pc-offer-provenance',
  });
  try {
    await client.connect();
    const offers = (await client.query(OFFERS_SQL)).rows;
    const history = (await client.query(HISTORY_SQL)).rows;
    const asOf = new Date();
    const view = evaluateProvenance(offers, history, { asOf });
    for (const line of formatReport(view, { asOf, maxExamples: options.maxExamples })) console.log(line);
    return view.verdict === 'FAIL' ? 1 : 0;
  } catch (error) {
    console.error('ERROR: ' + (error && error.message ? error.message : String(error)));
    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = { DEFAULT_TARGET_ENV, HISTORY_SQL, OFFERS_SQL, USAGE, classLabel, formatReport, main, parseArgs };

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error('ERROR: ' + (error && error.message ? error.message : String(error)));
      process.exitCode = 1;
    }
  );
}
