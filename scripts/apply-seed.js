'use strict';

// scripts/apply-seed.js - apply ONE seed file in a single transaction (Step-2 C).
//
// Why this exists: `run-seeds.js` applies every seed to the shared DATABASE_URL
// and has no TEST-branch routing, and a hand-rolled apply hits the Neon
// search_path trap (a branch client can default to pg_temp, so an unqualified
// table name resolves to nothing). This script is the narrow, guarded tool for
// "apply exactly this file to the TEST branch".
//
// Contract:
//   * TEST branch ONLY. `getWriteTestDbUrl()` throws unless TEST_DATABASE_URL is
//     set, DATABASE_URL is set, and the two normalized hosts differ, so this
//     can never touch production or the shared database.
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
//
// Usage:
//   node scripts/apply-seed.js database/seeds/013_scoring_model_launch_v2.sql [--dry-run]

require('dotenv').config();

const fs = require('fs');
const { Client } = require('pg');

const { getWriteTestDbUrl, describeTarget, toDirectUrl } = require('./lib/db-url');

function parseArgs(argv) {
  const args = { file: null, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--test-db') {
      // Accepted for symmetry with run-migrations.js; this script is ALWAYS the TEST branch.
    } else if (arg.startsWith('--file=')) {
      args.file = arg.slice('--file='.length);
    } else if (arg.startsWith('--')) {
      throw new Error('unknown argument: ' + arg);
    } else if (args.file === null) {
      args.file = arg;
    } else {
      throw new Error('unexpected extra argument: ' + arg);
    }
  }
  if (args.file === null) {
    throw new Error('usage: node scripts/apply-seed.js <seed-file> [--dry-run]');
  }
  return args;
}

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
  const args = parseArgs(process.argv);
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

  const config = getWriteTestDbUrl();
  const targetUrl = toDirectUrl(config.connectionString);
  const target = describeTarget(targetUrl);
  const where = 'endpoint ' + target.endpointId + ' (' + (target.pooled ? 'pooled' : 'direct') + ')'
    + ', database ' + target.database;

  if (args.dryRun) {
    console.log('DRY RUN: target would be ' + where + '; nothing connected, nothing applied.');
    return;
  }

  const client = new Client({
    connectionString: targetUrl,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    application_name: 'morocco-pc-apply-seed',
  });
  await client.connect();
  console.log('target: TEST branch only; ' + where);
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
}

if (require.main === module) {
  main().catch((error) => {
    console.error('APPLY FAILED: ' + (error && error.message ? error.message : String(error)));
    process.exit(1);
  });
}

module.exports = { parseArgs, analyzeSeed };
