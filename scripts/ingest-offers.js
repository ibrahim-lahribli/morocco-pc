#!/usr/bin/env node
'use strict';

/**
 * Ingest offers from an operator-supplied file (manual adapter).
 *
 *   node scripts/ingest-offers.js --adapter=manual --file=docs/sample.csv
 *   node scripts/ingest-offers.js --adapter=manual --file=f --commit --test-db
 *   node scripts/ingest-offers.js --adapter=manual --file=f --commit --confirm-shared
 *
 * Dry-run is the DEFAULT and performs reads only. `--commit` writes, and a
 * commit against the shared DATABASE_URL is refused unless --confirm-shared is
 * passed (the operator's explicit approval). Writes should target the test
 * branch with --test-db per AGENTS.md §7.
 *
 * Exit codes: 0 = ok; 1 = unexpected error (rolled back); 2 = usage/parse error
 * or a refused shared commit.
 */

require('dotenv').config();
const fs = require('fs');
const { Client } = require('pg');

const { getWriteTestDbUrl } = require('./lib/db-url');
const { parseIngestArgs, guardSharedCommit } = require('./lib/ingest-args');
const { parseManualText, runIngestion } = require('../src/recommendation/ingestion');

const USAGE = [
  'usage: node scripts/ingest-offers.js --adapter=manual --file=<path> [options]',
  '',
  '  --adapter=manual     adapter to use (only "manual" exists)',
  '  --file=<path>        CSV or JSON file prepared by the operator',
  '  --format=csv|json    override format auto-detection',
  '  --commit             write; default is dry-run',
  '  --test-db            target TEST_DATABASE_URL (isolated branch)',
  '  --confirm-shared     required for --commit against the shared DATABASE_URL',
].join('\n');

async function main() {
  const args = parseIngestArgs(process.argv.slice(2));
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
    for (const e of parsed.errors) console.error('  line ' + e.line + ': ' + e.reason);
    process.exit(2);
  }

  const targetIsShared = !args.testDb;
  const refusal = guardSharedCommit(args, { targetIsShared });
  if (refusal) {
    console.error(refusal);
    process.exit(2);
  }

  const client = targetIsShared
    ? new Client({ connectionString: process.env.DATABASE_URL })
    : new Client({ ...getWriteTestDbUrl(), connectionTimeoutMillis: 15000 });

  try {
    await client.connect();
    await client.query('SET search_path = public');

    if (!args.commit) {
      const result = await runIngestion(client, {
        rows: parsed.rows,
        mode: 'dry-run',
        now: new Date(),
        sourceIdentifier: args.file,
        rawText: text,
      });
      console.log(result.report);
      console.log('DRY-RUN: nothing written.');
      await client.end();
      process.exit(0);
    }

    await client.query('BEGIN');
    let result;
    try {
      result = await runIngestion(client, {
        rows: parsed.rows,
        mode: 'commit',
        now: new Date(),
        sourceIdentifier: args.file,
        rawText: text,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    console.log(result.report);
    console.log('COMMITTED: ' + JSON.stringify(result.applied) + ' ingestion_record=' + result.ingestionRecordId);
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('ERROR: ' + err.message);
    if (client) await client.end().catch(() => {});
    process.exit(1);
  }
}

main();
