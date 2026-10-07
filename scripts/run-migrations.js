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
// Usage: node scripts/run-migrations.js [mode] [--restore-point=<id>]
//
// A real apply against the shared DATABASE_URL REFUSES unless
// --restore-point=<id> is given and matches ^[A-Za-z0-9_-]{8,}$ (Neon
// restore-point id; placeholders like <PASTE ID HERE> fail the shape).
// Without it the runner prints the pending files and exits 1.
// --baseline is guarded TOO (it writes the ledger even though it runs no SQL)
// and prints every filename it is about to record, while --dry-run / --check /
// --offline and any --test-db run never require it. A successful shared apply
// appends one CRLF-terminated JSON line PER APPLIED FILE to the tracked,
// append-only database/migration-applies.jsonl, carrying exactly the six
// whitelisted fields of scripts/lib/migrations.js APPLY_LOG_FIELDS (restore
// point, git SHA, timestamp, filename, target, note).
//   (no mode)          apply every PENDING migration, then verify
//   --dry-run          list pending migrations without executing or writing
//   --check            exit 0 when nothing is pending, 1 when something is
//                      (CI-shaped freshness gate; executes nothing)
//   --offline          needs no DATABASE_URL and never connects — but with no ledger to
//                      read, every file reports pending, so --offline --check always exits 1
//   --baseline         record every PENDING file as applied WITHOUT running it
//                       the one-time adoption step for a database that
//                      predates the ledger (e.g. the shared dev DB, already at
//                      011). Never runs a migration file, but it IS a ledger
//                      write: on the SHARED target it needs --restore-point=<id>
//                      like an apply does, and names each file it records.
//   --test-db          target TEST_DATABASE_URL (guarded by scripts/lib/db-url.js)
//                      instead of DATABASE_URL  for the empty-DB replay.
//
// Never re-runs a committed migration and never touches `002_enums.sql` twice.

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const {
  pendingMigrations,
  staleLedgerEntries,
  LEDGER_TABLE,
  isValidRestorePointId,
  shouldRefuseSharedApply,
  formatApplyLogLine,
  APPLY_LOG_EOL,
} = require('./lib/migrations');

const MODES = ['--dry-run', '--check', '--baseline', '--offline', '--test-db'];


/**
 * Parse argv into a mode set plus an optional restore-point id.
 *
 * PURE on purpose: an unrecognized flag or an unusable mode combination is
 * RETURNED as `error` instead of calling process.exit, so the refusal paths are
 * testable without a database (scripts/lib/run-migrations-cli.test.js). The
 * bootstrap prints the error to stderr and exits 2.
 */
function parseArgs(argv) {
  const flags = new Set();
  let restorePoint = null;
  for (const arg of argv) {
    if (arg.startsWith('--restore-point=')) {
      restorePoint = arg.slice('--restore-point='.length);
      continue;
    }
    if (!MODES.includes(arg)) {
      return { error: `usage: node scripts/run-migrations.js [${MODES.join('] [')}] [--restore-point=<id>]` };
    }
    flags.add(arg);
  }
  if (flags.has('--baseline') && (flags.has('--dry-run') || flags.has('--check') || flags.has('--offline'))) {
    return { error: 'ERROR: --baseline cannot be combined with --dry-run / --check / --offline' };
  }
  return { flags, restorePoint };
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

/**
 * Append the audit line(s) for a successful shared apply — ONE line per applied
 * file, each carrying the restore point, git SHA and timestamp of the run.
 *
 * Best-effort: a log write failure warns but never fails the migration run
 * itself, because by this point every file has already committed. Each line is
 * built by the whitelisting formatter, so a malformed record is refused rather
 * than written into a tracked file.
 */
function recordSharedApply({ restorePoint, files }) {
  const logPath = path.join(process.cwd(), 'database', 'migration-applies.jsonl');
  let gitSha = 'unknown';
  try {
    gitSha = require('child_process').execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch (_err) {
    gitSha = 'unknown';
  }
  const appliedAt = new Date().toISOString();
  try {
    const lines = files.map((filename) =>
      formatApplyLogLine({
        applied_at: appliedAt,
        filename,
        git_sha: gitSha,
        note: null,
        restore_point: restorePoint,
        target: 'shared',
      })
    );
    fs.appendFileSync(logPath, lines.join(APPLY_LOG_EOL) + APPLY_LOG_EOL, 'utf8');
    console.log(`Recorded ${lines.length} audit line(s) in database/migration-applies.jsonl`);
    console.log('Reminder: commit database/migration-applies.jsonl with this apply (tracked, append-only).');
  } catch (err) {
    console.log('WARNING: could not append to database/migration-applies.jsonl: ' + err.message);
  }
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

/**
 * The CLI entry point. Uses process.exitCode (never process.exit) so a test can
 * call it in-process; the bootstrap passes process.argv.slice(2).
 */
async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(parsed.error);
    process.exitCode = 2;
    return;
  }
  const { flags, restorePoint } = parsed;
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

    // Shared-target guard: a real apply against DATABASE_URL refuses unless a
    // valid --restore-point=<id> was supplied. The pending list is printed
    // first so the refusal names exactly what was NOT applied.
    if (shouldRefuseSharedApply({
      targetShared: !flags.has('--test-db'),
      pendingCount: pending.length,
      dryRun: flags.has('--dry-run'),
      check: flags.has('--check'),
      offline: flags.has('--offline'),
      restorePoint,
    })) {
      const action = flags.has('--baseline') ? 'baseline' : 'apply to';
      console.error(`ERROR: refusing to ${action} the shared DATABASE_URL without --restore-point=<id>`);
      console.error('       Pending (NOT applied): ' + pending.join(', '));
      console.error('       Re-run with --restore-point=<id> matching ^[A-Za-z0-9_-]{8,}$');
      process.exitCode = 1;
      return;
    }

    // --baseline executes no SQL but WRITES the ledger, so it sits BEHIND the
    // guard: a mis-typed --baseline used to be able to record a migration as
    // applied that was never applied, leaving the database silently behind its
    // own ledger. Every filename it is about to record is printed first, because
    // an unnoticed row is the whole hazard.
    if (flags.has('--baseline')) {
      console.log(`BASELINE: recording ${pending.length} file(s) as applied WITHOUT running them:`);
      for (const file of pending) console.log(`  ${file}`);
      await baselineLedger(pending, client);
      await verify(client);
      return;
    }

    for (const file of pending) {
      await applyMigration(file, client);
    }

    // Record restore point + git SHA + timestamp for a shared apply. A JSONL
    // log file, not a migration: schema_migrations is runner-created (never a
    // numbered migration) so a fresh 001->NNN replay stays clean, and audit
    // metadata is not schema. TEST-target runs never write here.
    if (!flags.has('--test-db')) {
      recordSharedApply({ restorePoint, files: pending });
    }

    await verify(client);
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = { parseArgs, main };

if (require.main === module) {
  main(process.argv.slice(2));
}
