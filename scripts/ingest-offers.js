#!/usr/bin/env node
'use strict';

/**
 * Ingest offers from an operator-supplied file (manual adapter).
 *
 *   node scripts/ingest-offers.js --adapter=manual --file=docs/sample.csv
 *   node scripts/ingest-offers.js --adapter=manual --file=f --commit --test-db
 *   node scripts/ingest-offers.js --adapter=manual --file=f --commit --confirm-shared
 *   node scripts/ingest-offers.js --adapter=manual --file=f --commit \
 *     --target-env=TARGET_DATABASE_URL --restore-point=br-cool-star-b9whdnt1
 *
 * Dry-run is the DEFAULT and performs reads only. `--commit` writes, and a
 * commit against the shared DATABASE_URL is refused unless --confirm-shared is
 * passed (the operator's explicit approval). Writes should target the test
 * branch with --test-db per AGENTS.md §7.
 *
 * A RELEASE target (the EU database) is named, never exported: `--target-env`
 * reads the URL from that variable and `--restore-point` names the rollback the
 * write relies on. A named target must be provably distinct from the shared
 * database — the comparison is a `db:<12 hex>` digest of the connection target,
 * not the variable name — and this script never assigns to `process.env`, so a
 * release import cannot change what the next command in the same shell reads
 * from `DATABASE_URL`. Every run prints `target:` and, for a release target,
 * `AUDIT TARGET: db:<12 hex> restore-point=<id>` BEFORE it connects, so the log
 * line proves which database was changed without quoting a host.
 *
 * Exit codes: 0 = ok; 1 = unexpected error (rolled back); 2 = usage/parse error,
 * a refused shared commit, or a refused target (unset variable, shared digest,
 * missing restore point). Every exit-2 path exits BEFORE connecting.
 */

require('dotenv').config();
const fs = require('fs');
const { Client } = require('pg');

const {
  UsageError,
  auditTargetLine,
  guardSharedCommit,
  parseIngestArgs,
  resolveIngestTarget,
  targetLine,
} = require('./lib/ingest-args');
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
  '  --target-env=NAME    read the connection string from that variable (a release',
  '                       target, e.g. TARGET_DATABASE_URL); the variable is not',
  '                       exported and DATABASE_URL is never overwritten',
  '  --restore-point=ID   required with --commit --target-env=NAME; a Neon restore',
  '                       point id, ^[A-Za-z0-9_-]{8,}$',
  '',
  '  --test-db and --target-env are mutually exclusive; the shared DATABASE_URL is',
  '  never nameable through --target-env (omit it and pass --confirm-shared).',
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

  // A named target is not the shared database by definition (the digest check
  // below proves that), so only the unnamed path needs the shared approval.
  const targetIsShared = !args.testDb && args.targetEnv === null;
  const refusal = guardSharedCommit(args, { targetIsShared });
  if (refusal) {
    console.error(refusal);
    process.exit(2);
  }

  let target;
  try {
    target = resolveIngestTarget(args, process.env);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error('ERROR: ' + err.message);
      process.exit(2);
    }
    // resolveTestDbUrl()'s branch guard: its message is the contract, and this is
    // still an invocation problem, not a failed run.
    console.error('ERROR: ' + err.message);
    process.exit(2);
  }

  console.log(targetLine(target));
  if (target.nonTest) {
    console.log(auditTargetLine(target, target.restorePoint));
  }

  const client = new Client({
    connectionString: target.connectionString,
    connectionTimeoutMillis: target.connectionTimeoutMillis,
  });

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
