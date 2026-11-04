'use strict';

/**
 * scripts/check-catalog-identity.js - does every ACTIVE product carry the
 * identity the API serves and addresses?
 *
 * READ-ONLY: one SELECT over `product`, no writes at all, so it needs no
 * TEST_DATABASE_URL guard (the same reasoning as `check-offer-provenance.js` and
 * `check-offer-freshness.js`).
 *
 * WHY IT EXISTS. Migration 020 introduced `product.display_name` and
 * `product.slug` and backfilled the catalogue that existed when it ran, leaving
 * both columns NULLABLE on purpose. Every catalogue seed written afterwards had to
 * supply them itself, and seeds 023, 024 and 025 did not: 13 products carried
 * `slug: null` and `display_name: null`, and the API served `component.slug: null`
 * to a client. On EU - the release target - the entire catalogue of 100 rows had
 * no identity, because the seeds replayed after 020 had backfilled an EMPTY table.
 *
 * The suite that caught it, `test:api:db`, is the only one that could have, and it
 * runs in `recurring-gates` (nightly/dispatch), never on push or pull_request. So
  * a NULL slug could ship through a green PR. Since R-21 (2026-11-03) that blind spot is
 * closed from both ends: the gate runs in `unit-and-docs` on every push and pull request,
 * so it blocks the merge that would reintroduce the break, and nightly in
 * `recurring-gates`, so a break arriving any other way is still caught within a day.
 *
 * WHAT MAKES IT PRODUCTION-RELEVANT is not cosmetic: `GET /v1/catalog/products`
 * filters `p.lifecycle_status = 'ACTIVE' AND p.slug IS NOT NULL` and keyset-
 * paginates on `slug`, and `GET /v1/catalog/products/:slug` addresses a product BY
 * that column. A NULL slug therefore removes a product from the catalog and from
 * every URL that could reach it, while the same product still ships inside a
 * recommendation component - which is exactly how `slug: null` reached a client.
 *
 * SCOPE - every ACTIVE product. The handoff's proposed narrower scope ("ACTIVE
 * products carrying an eligible offer") is wrong for that reason: it would ask
 * about only the products that already have a price, and say nothing about the
 * rows the catalog has silently dropped. Nothing here joins `store_offer`.
 *
 * VERDICT VOCABULARY is three-valued, and the classification lives in the pure,
 * unit-tested `scripts/lib/catalog-identity.js`:
 *   PASS          every ACTIVE product carries both columns.
 *   FAIL          at least one does not; each offender names the column it lacks.
 *   INCONCLUSIVE  no ACTIVE product exists, so nothing could be checked. Exit 0,
 *                 but the line says in words that this is not a pass.
 *
 * Usage:
 *   node scripts/check-catalog-identity.js
 *   node scripts/check-catalog-identity.js --target=env:TEST_DATABASE_URL
 *   node scripts/check-catalog-identity.js --max-examples=10
 *
 * `--target` takes a VARIABLE NAME (`env:NAME`), never a URL: the connection string
 * carries a password and this report is meant to be pasted into notes. Equals form
 * is mandatory, like the other read-only gates; `--target env:NAME` is a usage
 * error.
 *
 * Exit codes: 0 = PASS or INCONCLUSIVE; 1 = FAIL or the catalogue could not be
 * read; 2 = usage error (including --help).
 */

require('dotenv').config();
const { Client } = require('pg');

const {
  evaluateCatalogIdentity,
  formatReport,
  verdictExitCode,
} = require('./lib/catalog-identity');

const DEFAULT_TARGET_ENV = 'DATABASE_URL';
const DEFAULT_MAX_EXAMPLES = 20;

/**
 * Every ACTIVE product, identity columns included. Exported so a test can pin the
 * scope instead of trusting a comment.
 *
 * Deliberately NOT narrowed to products with an eligible offer (see the header),
 * and deliberately ordered by `id` so the printed sample is the same on every run.
 */
const ACTIVE_PRODUCTS_SQL = [
  'SELECT p.id, p.name, p.slug, p.display_name',
  'FROM product p',
  "WHERE p.lifecycle_status = 'ACTIVE'",
  'ORDER BY p.id ASC',
].join('\n');

const USAGE = [
  'usage: node scripts/check-catalog-identity.js [--target=env:NAME] [--max-examples=N]',
  '',
  '  --target=env:NAME    environment variable holding the connection string',
  '                       (default env:' + DEFAULT_TARGET_ENV + ')',
  '  --max-examples=N     offenders to print (default ' + DEFAULT_MAX_EXAMPLES
    + '); the count is always full',
  '',
  'Read-only, one SELECT over `product`. PASS = every ACTIVE product carries both',
  '`slug` and `display_name`; FAIL = at least one does not, each offender naming the',
  'column it lacks; INCONCLUSIVE = no ACTIVE product exists, so nothing was checked',
  '(exit 0, and NOT a pass).',
].join('\n');

/**
 * Parse argv. The `=` form only: a URL passed positionally would land in shell
 * history, and `--target env:X` is ambiguous with the next flag.
 */
function parseArgs(argv) {
  const options = { targetEnv: DEFAULT_TARGET_ENV, maxExamples: DEFAULT_MAX_EXAMPLES, help: false };
  const args = Array.isArray(argv) ? argv : [];

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg.startsWith('--target=')) {
      const value = arg.slice('--target='.length);
      if (!/^env:[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        throw new Error('--target takes a variable NAME as env:NAME (got "' + value
          + '"); a connection string is never accepted');
      }
      options.targetEnv = value.slice('env:'.length);
      continue;
    }
    if (arg.startsWith('--max-examples=')) {
      const value = arg.slice('--max-examples='.length);
      if (!/^\d+$/.test(value) || Number(value) < 1) {
        throw new Error('--max-examples takes a positive integer (got "' + value + '")');
      }
      options.maxExamples = Number(value);
      continue;
    }
    throw new Error('unrecognised argument "' + arg + '"');
  }

  return options;
}

/**
 * Run the gate. Returns the process exit code instead of calling `process.exit`,
 * so the pool is always closed first (the pattern the other read-only gates use).
 *
 * `deps` is injectable for the same reason `check-origin-readiness.js` takes one:
 * `scripts/lib/catalog-identity-cli.test.js` pins the EXIT CODES and the report
 * wording without a database. That matters because this gate runs on push/PR
 * (R-21, 2026-11-03) - a regression that made it exit 0 on an offender would
 * otherwise hide behind a green pull request. Omit `deps` and every collaborator
 * is the real thing.
 */
async function main(argv, deps) {
  const injected = deps === null || deps === undefined ? {} : deps;
  const env = injected.env || process.env;
  const log = injected.log || ((line) => console.log(line));
  const logError = injected.logError || ((line) => console.error(line));
  const createClient = injected.createClient || ((config) => new Client(config));

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    logError('ERROR: ' + error.message);
    logError(USAGE);
    return 2;
  }
  if (options.help) {
    log(USAGE);
    return 2;
  }

  const connectionString = env[options.targetEnv];
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    logError('ERROR: ' + options.targetEnv
      + ' is not set (pass --target=env:NAME to name another variable)');
    return 1;
  }

  const client = createClient({
    connectionString,
    connectionTimeoutMillis: 15000,
    statement_timeout: 15000,
    application_name: 'morocco-pc-catalog-identity',
  });

  try {
    await client.connect();
    const rows = (await client.query(ACTIVE_PRODUCTS_SQL)).rows;
    const result = evaluateCatalogIdentity({ scopeSize: rows.length, rows });

    log('Catalogue identity gate (read-only; slug and display_name on every ACTIVE product)');
    // The variable NAME only, never the URL: this output is meant to be quoted.
    log('Target: env:' + options.targetEnv);
    for (const line of formatReport(result, options.maxExamples)) log(line);

    return verdictExitCode(result.verdict);
  } catch (error) {
    logError('RESULT: FAIL - the catalogue could not be read: '
      + (error && error.message ? error.message : String(error)));
    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = { ACTIVE_PRODUCTS_SQL, DEFAULT_MAX_EXAMPLES, DEFAULT_TARGET_ENV, USAGE, main, parseArgs };

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
