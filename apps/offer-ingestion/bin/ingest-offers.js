#!/usr/bin/env node
'use strict';

/**
 * Ingest offers from an operator-supplied file (manual adapter).
 *
 *   node bin/ingest-offers.js --adapter=manual --file=docs/sample.csv
 *   node bin/ingest-offers.js --adapter=manual --file=f --commit --test-db
 *
 * Dry-run is the DEFAULT and performs reads only. `--commit` writes, and a
 * commit against the shared DATABASE_URL is refused unless explicitly
 * confirmed. Writes should target the test branch with --test-db.
 *
 * @see RFC §12.1 — CLI: dry-run default, --commit, --test-db, --restore-point
 * @see existing: scripts/ingest-offers.js
 */

require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const { Client } = require('pg');

const {
  resolveTestDbUrl,
  normalizeTarget,
} = require('../../../packages/database-guard/src');

const { runIngestion } = require('../src/run');
const { parseManualText } = require('../src/adapters/manual');

const USAGE = [
  'usage: node bin/ingest-offers.js --adapter=manual --file=<path> [options]',
  '',
  '  --adapter=manual     adapter to use (only "manual" exists)',
  '  --file=<path>        CSV or JSON file prepared by the operator',
  '  --format=csv|json    override format auto-detection',
  '  --commit             write; default is dry-run',
  '  --test-db            target TEST_DATABASE_URL (isolated branch)',
  '  --restore-point=ID   required with --commit against non-test target',
  '',
  '  Dry-run is the default: reads only, no writes.',
].join('\n');

function parseArgs(argv) {
  const args = {
    adapter: 'manual',
    file: null,
    format: null,
    commit: false,
    testDb: false,
    restorePoint: null,
    errors: [],
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    const m = arg.match(/^--adapter=(.+)$/);
    if (m) { args.adapter = m[1]; continue; }
    const m2 = arg.match(/^--file=(.+)$/);
    if (m2) { args.file = m2[1]; continue; }
    const m3 = arg.match(/^--format=(.+)$/);
    if (m3) { args.format = m3[1]; continue; }
    if (arg === '--commit') { args.commit = true; continue; }
    if (arg === '--test-db') { args.testDb = true; continue; }
    const m4 = arg.match(/^--restore-point=(.+)$/);
    if (m4) { args.restorePoint = m4[1]; continue; }
    args.errors.push(`unknown argument: ${arg}`);
  }

  if (!args.file) {
    args.errors.push('--file is required');
  }

  return args;
}

/** Credential-free target digest, `db:<12 hex>`, for the audit target line. */
function targetDigest(connectionString) {
  const { host, database } = normalizeTarget(connectionString);
  return 'db:' + crypto.createHash('sha256').update(host + '/' + database).digest('hex').slice(0, 12);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (args.errors.length > 0) {
    console.error('ERROR: ' + args.errors.join(', '));
    console.error(USAGE);
    process.exit(2);
  }

  let text;
  try {
    text = fs.readFileSync(args.file, 'utf8');
  } catch (err) {
    console.error('ERROR: cannot read file ' + args.file + ': ' + err.message);
    process.exit(2);
  }

  const parsed = parseManualText(text, { format: args.format });
  if (parsed.errors.length > 0) {
    console.error('ERROR: file could not be parsed:');
    for (const e of parsed.errors) {
      console.error(`  line ${e.line}: ${e.reason}`);
    }
    process.exit(2);
  }

  // Resolve target through the database-guard. Never target shared without
  // explicit confirmation.
  let target;
  try {
    target = resolveTestDbUrl(process.env);
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(2);
  }

  const identity = normalizeTarget(target.connectionString);
  console.log(`target: ${identity.host}/${identity.database}`);
  if (!args.testDb) {
    console.log(`AUDIT TARGET: restore-point=${args.restorePoint || '<none>'}`);
  }

  const client = new Client({
    connectionString: target.connectionString,
    connectionTimeoutMillis: target.connectionTimeoutMillis,
  });

  // Layer 1 reads, scoped to this run's transaction when committing.
  async function lookupStore(retailer) {
    const result = await client.query(
      'SELECT id FROM store WHERE name = $1 AND is_active = TRUE LIMIT 1',
      [retailer]
    );
    return result.rows.length === 1 ? result.rows[0].id : null;
  }

  async function lookupCatalogueKey(slug, sku) {
    const result = await client.query(
      'SELECT p.id AS product_id, pv.id AS product_variant_id,' +
        ' (SELECT COUNT(*) FROM product_variant pv2 WHERE pv2.product_id = p.id)::int AS variant_count' +
        ' FROM product p' +
        ' LEFT JOIN product_variant pv ON pv.product_id = p.id AND pv.sku = $2' +
        ' WHERE p.slug = $1 AND p.lifecycle_status = $3',
      [slug, sku, 'ACTIVE']
    );
    const row = result.rows[0];
    if (!row) {
      const err = new Error('unknown product slug: ' + slug);
      err.code = 'UNKNOWN_PRODUCT_SLUG';
      throw err;
    }
    const variantCount = Number(row.variant_count);
    if (!sku) {
      if (variantCount > 0) {
        const err = new Error('variant_sku required for product: ' + slug);
        err.code = 'VARIANT_SKU_REQUIRED';
        throw err;
      }
      return { productId: row.product_id, variantId: null };
    }
    if (variantCount > 0 && !row.product_variant_id) {
      const err = new Error('unknown variant sku: ' + sku + ' for product: ' + slug);
      err.code = 'UNKNOWN_VARIANT_SKU';
      throw err;
    }
    return {
      productId: row.product_id,
      variantId: row.product_variant_id === undefined ? null : row.product_variant_id,
    };
  }

  try {
    await client.connect();

    const digest = targetDigest(target.connectionString);
    console.log(`target: ${identity.host}/${identity.database} (${digest})`);
    if (!args.testDb) {
      console.log(`AUDIT TARGET: ${digest} restore-point=${args.restorePoint || '<none>'}`);
    }

    if (!args.commit) {
      const result = await runIngestion(client, {
        mode: 'dry-run',
        now: new Date(),
        sourceIdentifier: args.file,
        rawText: text,
        format: args.format,
        lookupStore,
        lookupCatalogueKey,
      });
      console.log(result.report);
      console.log('DRY-RUN: nothing written.');
      await client.end();
      process.exit(0);
    }

    if (!args.restorePoint) {
      console.error('ERROR: --restore-point is required for --commit against non-test target');
      await client.end();
      process.exit(2);
    }

    await client.query('BEGIN');
    let result;
    try {
      result = await runIngestion(client, {
        mode: 'commit',
        now: new Date(),
        sourceIdentifier: args.file,
        rawText: text,
        format: args.format,
        lookupStore,
        lookupCatalogueKey,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
    console.log(result.report);
    console.log(`COMMITTED: ${result.applied} ingestion_record=${result.ingestionRecordId}`);
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('ERROR: ' + err.message);
    if (client) await client.end().catch(() => {});
    process.exit(1);
  }
}

main();
