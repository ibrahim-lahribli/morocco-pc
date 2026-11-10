#!/usr/bin/env node
'use strict';

/**
 * Per-role offer coverage report (READ-ONLY).
 *
 *   node scripts/check-offer-coverage.js
 *   node scripts/check-offer-coverage.js --target=env:TARGET_DATABASE_URL
 *   node scripts/check-offer-coverage.js --min-products=3 --min-stores=1 --strict
 *
 * WHAT "COVERAGE" MEANS HERE. Not "does the product have an offer" but "does the
 * role have an offer Stage 1 would actually accept on evidence". The predicate
 * mirrors `offers/select.js` exactly:
 *
 *   ingestion_record_id IS NOT NULL   -> VERIFIED, so the 30-day window is NEVER
 *                                        waived (the seed waiver cannot apply)
 *   availability != 'OUT_OF_STOCK'    -> NULL is UNKNOWN, never a waiver
 *   price > 0, currency = the report's currency (exact, no conversion)
 *   last_checked_at >= as_of - 30 days
 *   (product_id, product_variant_id) equals the CANDIDATE's identity, exactly as
 *   `offers/select.js` candidateMatchesOffer() requires: GPU candidates are
 *   variant-keyed, the other seven roles are product-keyed with a NULL variant
 *
 * Because builds may still assemble off SEED offers (the API passes
 * `allow_unverified_seed_offers: true`), a warm shelf and an evidenced shelf are
 * different facts. This report measures the second one per role of the 8-role
 * expansion, so "the catalog has 114 offers" cannot hide "no role has a verified
 * one".
 *
 * VERDICTS. PASS / FAIL / INCONCLUSIVE:
 *   PASS          every role meets both thresholds;
 *   FAIL          a named target variable is set and the active catalog holds
 *                 VERIFIED offers, but at least one role is below a threshold;
 *   INCONCLUSIVE  the active catalog holds ZERO VERIFIED offers anywhere, so no
 *                 role can be counted. INCONCLUSIVE exits 0 and is NOT a pass:
 *                 it names the provenance gap (R-01) instead of inventing a
 *                 coverage regression.
 *
 * `--strict` turns FAIL into exit 1 and nothing else.
 *
 * Read-only: SELECT only, no transaction, no writes, no DDL. `--target` is a
 * variable NAME (`env:NAME`, equals form mandatory) and the connection string is
 * never printed — only the resolved `db:<12 hex>` digest, so a report can be
 * pasted into notes.
 *
 * Exit codes: 0 = report printed (PASS / FAIL / INCONCLUSIVE); 1 = the catalog
 * could not be read, or `--strict` saw a FAIL; 2 = usage error (including
 * --help).
 */

require('dotenv').config();
const { Client } = require('pg');

const { applyLogTarget } = require('./lib/migrations');
const {
  DEFAULTS,
  buildCoverage,
  exitCodeFor,
  formatReport,
} = require('./lib/offer-coverage');

const DEFAULT_TARGET_ENV = 'DATABASE_URL';

const USAGE = [
  'usage: node scripts/check-offer-coverage.js [--target=env:NAME] [--min-products=N]',
  '       [--min-stores=N] [--currency=CCC] [--strict]',
  '',
  '  --target=env:NAME    environment variable holding the connection string',
  '                       (default env:' + DEFAULT_TARGET_ENV + ')',
  '  --min-products=N     candidate identities with an eligible VERIFIED offer per',
  '                       role (a GPU variant is its own identity) (default ' + DEFAULTS.minProducts + ')',
  '  --min-stores=N       distinct stores behind them per role',
  '                       (default ' + DEFAULTS.minStores + ')',
  '  --currency=CCC       offer currency to count, exact match',
  '                       (default ' + DEFAULTS.currency + ')',
  '  --strict             exit 1 when the result is FAIL (INCONCLUSIVE stays 0)',
  '',
  'Read-only. Eligible = VERIFIED (ingestion record), in stock, priced in the',
  'currency, last checked inside the ' + DEFAULTS.windowDays + '-day window. The',
  'window is never waived for a VERIFIED offer.',
].join('\n');

const ROLE_SPEC_TABLES = Object.freeze([
  ['CPU', 'cpu_spec'],
  ['MOTHERBOARD', 'motherboard_spec'],
  ['RAM', 'ram_spec'],
  ['SSD_BOOT', 'ssd_spec'],
  ['PSU', 'psu_spec'],
  ['CASE', 'case_spec'],
  ['CPU_COOLER', 'cooler_spec'],
]);

/**
 * ACTIVE candidate -> role, derived from canonical spec-table presence exactly as
 * `candidates/loader.js` derives category. GPU is the one variant-keyed role:
 * one row per `gpu_board_spec` variant, because that is the identity a GPU
 * candidate carries. Every other role is product-keyed with a NULL variant.
 * Role names, not `product_category` names: this report is scoped to the roles a
 * build expands into, so MEMORY reads as RAM and STORAGE as SSD_BOOT.
 */
function roleProductsCte() {
  const parts = ROLE_SPEC_TABLES.map(([role, table]) => [
    "  SELECT p.id AS product_id, NULL::uuid AS product_variant_id, '" + role + "' AS role",
    '    FROM product p',
    '    JOIN ' + table + ' s ON s.product_id = p.id',
    "   WHERE p.lifecycle_status = 'ACTIVE'",
  ].join('\n'));
  parts.push([
    "  SELECT p.id AS product_id, pv.id AS product_variant_id, 'GPU' AS role",
    '    FROM product p',
    '    JOIN product_variant pv ON pv.product_id = p.id',
    '    JOIN gpu_board_spec s ON s.product_variant_id = pv.id',
    "   WHERE p.lifecycle_status = 'ACTIVE'",
  ].join('\n'));
  return 'WITH role_products AS (\n' + parts.join('\n  UNION ALL\n') + '\n)\n';
}

/** Every (product, variant, role) candidate in the ACTIVE catalog. */
const PRODUCTS_SQL = roleProductsCte()
  + 'SELECT DISTINCT product_id::text AS product_id, product_variant_id::text AS product_variant_id, role\n'
  + '  FROM role_products\n'
  + ' ORDER BY role ASC, product_id ASC, product_variant_id ASC NULLS FIRST;';

/**
 * Every ELIGIBLE VERIFIED offer, one row per (role, candidate identity, store).
 * $1 currency, $2 as_of timestamptz. Stock/price/staleness predicates are the
 * Stage 1 contract, quoted in the header.
 *
 * The join is on the FULL identity the engine matches: `IS NOT DISTINCT FROM`
 * keeps a NULL-variant offer on a product-keyed candidate and a variant offer on
 * its own variant, while refusing a NULL-variant offer on a GPU candidate and an
 * offer for a different variant. Joining on `product_id` alone would credit
 * offers Stage 1 discards (seen 2026-11-10: 23 products vs 24 variant
 * candidates on TEST, and a NULL-variant GPU offer counted as covered).
 */
const ELIGIBLE_OFFERS_SQL = roleProductsCte()
  + 'SELECT DISTINCT rp.role, o.product_id::text AS product_id, o.product_variant_id::text AS product_variant_id, o.store_id::text AS store_id\n'
  + '  FROM store_offer o\n'
  + '  JOIN role_products rp ON rp.product_id = o.product_id\n'
  + '                       AND rp.product_variant_id IS NOT DISTINCT FROM o.product_variant_id\n'
  + '  JOIN product p ON p.id = o.product_id\n'
  + " WHERE p.lifecycle_status = 'ACTIVE'\n"
  + '   AND o.ingestion_record_id IS NOT NULL\n'
  + '   AND o.currency = $1\n'
  + '   AND o.price > 0\n'
  + "   AND o.availability != 'OUT_OF_STOCK'\n"
  + "   AND o.last_checked_at >= ($2::timestamptz - INTERVAL '" + DEFAULTS.windowDays + " days')\n"
  // Ordinal ordering: a DISTINCT select list cannot be ordered by an expression
  // that is not in it, and the qualified columns would collide with the aliases.
  + ' ORDER BY 1 ASC, 2 ASC, 3 ASC, 4 ASC;';

/** Gate on INCONCLUSIVE vs FAIL: does the ACTIVE catalog hold ANY evidence? */
const VERIFIED_TOTAL_SQL = [
  'SELECT count(*)::int AS n',
  '  FROM store_offer o',
  '  JOIN product p ON p.id = o.product_id',
  " WHERE p.lifecycle_status = 'ACTIVE'",
  '   AND o.ingestion_record_id IS NOT NULL;',
].join('\n');

/**
 * Parse argv. Equals form only for every value that could carry a URL or be
 * confused with the next flag, same as the other read-only gates.
 *
 * @param {string[]} argv
 * @returns {{help: boolean, targetEnv: string, minProducts: number,
 *   minStores: number, currency: string, strict: boolean}}
 * @throws {Error} with `usage: true` on anything unrecognised
 */
function parseArgs(argv) {
  const options = {
    help: false,
    targetEnv: DEFAULT_TARGET_ENV,
    minProducts: DEFAULTS.minProducts,
    minStores: DEFAULTS.minStores,
    currency: DEFAULTS.currency,
    strict: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--strict') {
      options.strict = true;
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
    if (arg.startsWith('--min-products=')) {
      options.minProducts = parseCount(arg.slice('--min-products='.length), '--min-products');
      continue;
    }
    if (arg.startsWith('--min-stores=')) {
      options.minStores = parseCount(arg.slice('--min-stores='.length), '--min-stores');
      continue;
    }
    if (arg.startsWith('--currency=')) {
      const raw = arg.slice('--currency='.length).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(raw)) {
        throw Object.assign(new Error('--currency expects a three-letter code, e.g. --currency=MAD'), { usage: true });
      }
      options.currency = raw;
      continue;
    }
    throw Object.assign(new Error('unknown argument: ' + arg), { usage: true });
  }
  return options;
}

function parseCount(raw, flag) {
  if (!/^\d+$/.test(raw)) {
    throw Object.assign(new Error(flag + ' expects a non-negative integer'), { usage: true });
  }
  return parseInt(raw, 10);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    process.exit(2);
  }
  if (options.help) {
    console.log(USAGE);
    process.exit(2);
  }

  const connectionString = process.env[options.targetEnv];
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    console.error('ERROR: ' + options.targetEnv + ' is not set');
    process.exit(1);
  }
  let digest;
  try {
    digest = applyLogTarget(connectionString);
  } catch (_error) {
    console.error('ERROR: ' + options.targetEnv + ' is not a usable connection string');
    process.exit(1);
  }

  // One clock for the whole report: the window boundary and the label must agree.
  const asOf = new Date();
  const client = new Client({ connectionString });

  try {
    await client.connect();
    // Sequential on ONE client: pg queues parallel queries on a client but warns
    // about it, and a report that races itself is not worth the saved round trip.
    const productsRes = await client.query(PRODUCTS_SQL);
    const offersRes = await client.query(ELIGIBLE_OFFERS_SQL, [options.currency, asOf.toISOString()]);
    const verifiedRes = await client.query(VERIFIED_TOTAL_SQL);
    await client.end();

    const report = buildCoverage({
      products: productsRes.rows,
      offers: offersRes.rows,
      minProducts: options.minProducts,
      minStores: options.minStores,
      verifiedOffersAnywhere: verifiedRes.rows.length === 1 ? verifiedRes.rows[0].n : 0,
    });

    const lines = formatReport(report, {
      asOf,
      windowDays: DEFAULTS.windowDays,
      currency: options.currency,
      label: options.targetEnv + ' (' + digest + ')',
    });
    for (const line of lines) console.log(line);

    const exitCode = exitCodeFor(report, options);
    if (exitCode === 1) console.log('STRICT: exit 1 on FAIL');
    process.exit(exitCode);
  } catch (err) {
    console.error('ERROR: could not read the catalog: ' + err.message);
    await client.end().catch(() => {});
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { USAGE, parseArgs, main };
