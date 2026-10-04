'use strict';

// run-migrations.js  applies database/migrations/*.sql in sorted filename order.
//
// Since gap OG-14 this runner is LEDGER-DRIVEN, not replay-everything: it records
// each applied filename in the `schema_migrations` table (created here, not by a
// numbered migration, so a fresh 001->NNN replay stays clean) and skips files
// already recorded. That makes the runner re-runnable against an
// already-migrated database, which it was NOT before: `002_enums.sql` uses a
// bare `CREATE TYPE`, so the old replay-everything runner aborted at
// `type "product_category" already exists` (see DEVELOPMENT_NOTES.md).
//
// Usage: node scripts/run-migrations.js [mode]
//   (no mode)          apply every PENDING migration, then verify
//   --dry-run          list pending migrations without executing or writing
//   --check            exit 0 when nothing is pending, 1 when something is
//                      (CI-shaped freshness gate; executes nothing)
//   --offline          needs no DATABASE_URL and never connects — but with no ledger to
//                      read, every file reports pending, so --offline --check always exits 1
//   --baseline         record every file on disk as applied WITHOUT running it
//                       the one-time adoption step for a database that
//                      predates the ledger (e.g. the shared dev DB, already at
//                      011). Never runs a migration file.
//   --test-db          target TEST_DATABASE_URL (guarded by scripts/lib/db-url.js)
//                      instead of DATABASE_URL  for the empty-DB replay.
//
// Never re-runs a committed migration and never touches `002_enums.sql` twice.

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const { pendingMigrations, staleLedgerEntries, LEDGER_TABLE } = require('./lib/migrations');

const MODES = ['--dry-run', '--check', '--baseline', '--offline', '--test-db'];

/** Parse argv into a mode set; reject anything unknown. */
function parseArgs(argv) {
  const flags = new Set();
  for (const arg of argv) {
    if (!MODES.includes(arg)) {
      console.error(`usage: node scripts/run-migrations.js [${MODES.join('] [')}]`);
      process.exit(2);
    }
    flags.add(arg);
  }
  if (flags.has('--baseline') && (flags.has('--dry-run') || flags.has('--check') || flags.has('--offline'))) {
    console.error('ERROR: --baseline cannot be combined with --dry-run / --check / --offline');
    process.exit(2);
  }
  return flags;
}

/**
 * A connection config, or null for offline mode. `--test-db` routes through the
 * shared TEST_DATABASE_URL guard; the default is the shared DATABASE_URL.
 */
function resolveConnection(flags) {
  if (flags.has('--offline')) return null;
  require('dotenv').config();
  if (flags.has('--test-db')) {
    const { getWriteTestDbUrl } = require('./lib/db-url');
    try {
      return getWriteTestDbUrl();
    } catch (err) {
      console.error('ERROR: ' + err.message);
      process.exit(1);
    }
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL is not set in .env');
    process.exit(1);
  }
  return { connectionString };
}

/** Create the tracking table if it does not exist; return its applied filenames. */
async function loadLedger(client) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (` +
      'filename TEXT PRIMARY KEY, ' +
      'applied_at TIMESTAMPTZ NOT NULL DEFAULT now())'
  );
  const res = await client.query(`SELECT filename FROM ${LEDGER_TABLE} ORDER BY filename`);
  return res.rows.map((r) => r.filename);
}

/** Apply one pending migration inside its own transaction + ledger record. */
async function applyMigration(fileName, client) {
  const filePath = path.join(process.cwd(), 'database', 'migrations', fileName);
  const sql = fs.readFileSync(filePath, 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(`INSERT INTO ${LEDGER_TABLE} (filename) VALUES ($1)`, [fileName]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
  console.log(`MIGRATED: ${fileName}`);
}

/** One-time ledger adoption: record every on-disk file as applied, run nothing. */
async function baselineLedger(files, client) {
  let inserted = 0;
  for (const file of files) {
    const res = await client.query(
      `INSERT INTO ${LEDGER_TABLE} (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
      [file]
    );
    inserted += res.rowCount;
  }
  console.log(`BASELINED: ${inserted} file(s) recorded as applied (no migration executed)`);
}

/** Post-run structural verification, unchanged from the original runner. */
async function verify(client) {
  console.log('\n--- Verification ---');

    const tablesResult = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    console.log('Tables:', tablesResult.rows.length === 0 ? 'None' : tablesResult.rows.map(r => r.table_name).join(', '));

    const fksResult = await client.query(`
      SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      ORDER BY tc.table_name, kcu.column_name
    `);
    console.log('Foreign keys:', fksResult.rows.length === 0 ? 'None' : `${fksResult.rows.length} found`);

    const enumsResult = await client.query(
      "SELECT typname FROM pg_type WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace::oid ORDER BY typname"
    );
    console.log('Enums:', enumsResult.rows.length === 0 ? 'None' : enumsResult.rows.map(r => r.typname).join(', '));

    const uuidTest = await client.query('SELECT gen_random_uuid()');
    console.log('UUID generation works:', !!uuidTest.rows[0].gen_random_uuid);

}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const offline = flags.has('--offline');

  const migrationsDir = path.join(process.cwd(), 'database', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  // Offline: no DB at all; the pending set is every file (no ledger to consult).
  if (offline) {
    const pending = pendingMigrations(files, []);
    console.log(`templates on disk: ${files.length}`);
    console.log(`pending (offline, no ledger): ${pending.length === 0 ? 'none' : pending.join(', ')}`);
    if (flags.has('--check')) {
      process.exitCode = pending.length === 0 ? 0 : 1;
    }
    return;
  }

  const connection = resolveConnection(flags);
  const client = new Client(connection);
  try {
    await client.connect();
    console.log('Connected to PostgreSQL database');
    if (flags.has('--test-db')) console.log('(target: TEST_DATABASE_URL, isolated branch)');

    const applied = await loadLedger(client);
    const pending = pendingMigrations(files, applied);
    const stale = staleLedgerEntries(files, applied);
    if (stale.length > 0) {
      console.log(`WARNING: ${stale.length} ledger entr${stale.length === 1 ? 'y' : 'ies'} with no file on disk: ${stale.join(', ')}`);
    }

    if (flags.has('--baseline')) {
      await baselineLedger(files, client);
      await verify(client);
      return;
    }

    if (pending.length === 0) {
      console.log('No pending migrations; database is up to date.');
      return;
    }

    console.log(`Pending migrations: ${pending.join(', ')}`);

    if (flags.has('--check')) {
      console.log('RESULT: FAIL - pending migrations while --check was requested');
      process.exitCode = 1;
      return;
    }

    if (flags.has('--dry-run')) {
      console.log('DRY-RUN: no migration executed, nothing written');
      return;
    }

    for (const file of pending) {
      await applyMigration(file, client);
    }

    await verify(client);
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main();
