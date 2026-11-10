'use strict';

// scripts/apply-seed.js - apply ONE seed file in a single transaction (Step-2 C).
//
// Why this exists: `run-seeds.js` applies every seed to the shared DATABASE_URL
// and has no per-target routing, and a hand-rolled apply hits the Neon
// search_path trap (a branch client can default to pg_temp, so an unqualified
// table name resolves to nothing). This script is the narrow, guarded tool for
// "apply exactly this file to ONE database".
//
// Contract:
//   * TWO targets, one at a time (scripts/lib/apply-seed-args.js):
//       - no `--target-env`: the TEST branch, and only the TEST branch.
//         `resolveTestDbUrl()` throws unless TEST_DATABASE_URL is set,
//         DATABASE_URL is set, and the two normalized hosts differ.
//       - `--target-env=<NAME>`: the connection string is read from that
//         VARIABLE NAME (never a URL on argv), `process.env` is untouched, the
//         variable may not be DATABASE_URL / TEST_DATABASE_URL, the target's
//         `db:<12 hex>` digest must differ from the shared database's, and a
//         WRITE also requires `--restore-point=<id>` matching
//         `^[A-Za-z0-9_-]{8,}$`. This is the release path
//         (`docs/RECIPES/release-in-two-stages.md`); before 2026-11-10 those two
//         flags were refused as unknown arguments, so the documented EU step
//         could not run at all.
//   * DIRECT host. The pooled (PgBouncer transaction-mode) host drops a
//     session-level SET, so the connection string's `-pooler` suffix is removed
//     before connecting and the startup line says `direct`.
//   * `SET LOCAL search_path = public` inside the transaction, so the seed is
//     correct whether or not the role's session default is pg_temp. SET LOCAL
//     is transaction-scoped and therefore also safe on a pooled host; the seed
//     is additionally scanned for its OWN session-level SET statements.
//   * ONE transaction, wrapping the whole file as a single query. A seed that
//     carries its own BEGIN/COMMIT/ROLLBACK is REFUSED, because an inner COMMIT
//     ends the outer transaction and a later ROLLBACK would be a silent no-op.
//   * `--dry-run` connects to nothing.
//   * The resolved target is printed BEFORE connecting: `target:` always, and
//     `AUDIT TARGET: db:<12 hex> restore-point=<id>` for a named target. No
//     host, URL or credential is ever printed.
//
// Usage:
//   node scripts/apply-seed.js database/seeds/013_scoring_model_launch_v2.sql [--dry-run]
//   node scripts/apply-seed.js <seed-file> --target-env=TARGET_DATABASE_URL \
//     --restore-point=<id> [--dry-run]

require('dotenv').config();

const fs = require('fs');
const { Client } = require('pg');

const { describeTarget, toDirectUrl } = require('./lib/db-url');
const {
  UsageError,
  parseApplySeedArgs,
  resolveApplySeedTarget,
} = require('./lib/apply-seed-args');

const USAGE = [
  'usage: node scripts/apply-seed.js <seed-file> [--dry-run]',
  '       node scripts/apply-seed.js <seed-file> --target-env=NAME --restore-point=<id> [--dry-run]',
  '',
  '  <seed-file>          the seed to apply (a single transaction wraps the whole file)',
  '  --dry-run            read and check the file; connect to nothing',
  '  --target-env=NAME    read the connection string from that variable (a release',
  '                       target, e.g. TARGET_DATABASE_URL). Without it the script',
  '                       is the TEST-branch tool.',
  '  --restore-point=ID   required to WRITE to a named target; a Neon restore point',
  '                       id, ^[A-Za-z0-9_-]{8,}$',
].join('\n');

/**
 * Inspect a seed's SQL without executing it. Line comments are stripped first
 * so a `BEGIN;` mentioned in prose does not count.
 */
function analyzeSeed(sql) {
  const code = sql.replace(/--[^\n]*/g, '');
  // Statement-position checks: split on ';' so an UPDATE's `SET` clause is not
  // mistaken for a session-level SET statement.
  const statements = code.split(';');
  return {
    hasTopLevelTransaction: statements.some((s) => /^[ \t\n]*(BEGIN|COMMIT|ROLLBACK)\b/i.test(s)),
    sessionSets: statements.filter((s) => /^[ \t\n]*SET[ \t]+(?!LOCAL\b)/i.test(s)).length,
  };
}

async function main() {
  const args = parseApplySeedArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const sql = fs.readFileSync(args.file, 'utf8');
  const analysis = analyzeSeed(sql);

  console.log('seed file: ' + args.file + ' (' + sql.length + ' chars)');
  if (analysis.hasTopLevelTransaction) {
    throw new Error('seed file contains its own BEGIN/COMMIT/ROLLBACK; refusing to wrap it'
      + ' (an inner COMMIT ends the outer transaction and a later ROLLBACK becomes a silent no-op).'
      + ' Strip it or apply it on a throwaway branch with reset_branch.');
  }
  console.log('seed session-level SET statements: ' + analysis.sessionSets
    + (analysis.sessionSets > 0 ? ' (they will not survive a pooled host; this run uses the direct host)' : ''));

  const config = resolveApplySeedTarget(args, process.env);
  const targetUrl = toDirectUrl(config.connectionString);
  const target = describeTarget(targetUrl);
  const where = 'endpoint ' + target.endpointId + ' (' + (target.pooled ? 'pooled' : 'direct') + ')'
    + ', database ' + target.database;

  if (config.nonTest) {
    // Printed BEFORE the connection, and never containing the connection string.
    // The AUDIT line is the write's rollback record, so it appears only when a
    // restore point was actually named - a dry run without one has nothing to
    // audit, and `restore-point=null` would read like a rollback plan.
    console.log('target: ' + config.label + ' (' + config.digest + ')');
    if (config.restorePoint !== null) {
      console.log('AUDIT TARGET: ' + config.digest + ' restore-point=' + config.restorePoint);
    }
  }

  if (args.dryRun) {
    console.log('DRY RUN: target would be ' + where + '; nothing connected, nothing applied.');
    return 0;
  }

  const client = new Client({
    connectionString: targetUrl,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    application_name: 'morocco-pc-apply-seed',
  });
  await client.connect();
  console.log('target: ' + (config.nonTest ? config.label : 'TEST branch only') + '; ' + where);
  try {
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL search_path = public');
      await client.query(sql);
      await client.query('COMMIT');
      console.log('APPLIED in one transaction: ' + args.file);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (_rollbackError) {
        // the transaction is already gone
      }
      throw error;
    }
  } finally {
    try {
      await client.end();
    } catch (_endError) {
      // already closed
    }
  }
  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exit(code || 0);
  }).catch((error) => {
    // A usage error means "fix the invocation" and dialled nothing (exit 2); a
    // failed apply is a failed run (exit 1). Same split as ingest-offers.js.
    if (error instanceof UsageError) {
      console.error('ERROR: ' + error.message);
      console.error(USAGE);
      process.exit(2);
    }
    console.error('APPLY FAILED: ' + (error && error.message ? error.message : String(error)));
    process.exit(1);
  });
}

module.exports = { USAGE, analyzeSeed };
