'use strict';

// verify-migrations-replay.js — prove that replaying database/migrations/*.sql
// into a genuinely EMPTY database reproduces the live schema.
//
// Created after the 2026-10-05 verification recorded in docs/OPEN_GAPS.md
// (closed table C-30), which proved by hand that migration 001->015 applies
// cleanly and leaves zero structural drift. This script makes that repeatable.
//
// WHY A REAL DATABASE AND NOT A SCRATCH SCHEMA
//
// Two of the first three attempts at this check gave confidently wrong
// answers, and both came from trying to be clever with a schema:
//
//   1. Replaying into a scratch SCHEMA with `public` on search_path reported
//      15/15 applied plus a phantom 3-class enum drift (12 fresh vs 14 live),
//      which closely mimicked the real live-only-index drift that migration
//      012 reconciles. The `public` schema's types were leaking in.
//   2. Replaying into a scratch SCHEMA with `public` NOT on search_path failed
//      hard with `42704: type "assessment_type" does not exist`.
//
// Both are harness artifacts, not evidence. The cause is that migrations 008
// and 011 guard enum creation with a NAMESPACE-BLIND catalog lookup:
//
//   IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assessment_type')
//
// and pg_type is database-global. In a scratch schema the guard sees the copy
// already present in `public` and skips creating one, so the type resolves
// against `public` (case 1) or fails to resolve at all (case 2). Only a
// separate, genuinely empty database reproduces what a new environment gets.
//
// WHY NOT scripts/run-migrations.js
//
// That runner is ledger-driven and hardcodes table_schema='public' in its
// ledger queries, so it cannot target a scratch database; and it deliberately
// skips files already recorded. Migration 015's header says "Do not hand-replay
// it; use the runner" — that warning is about RE-APPLICATION against a
// database already carrying the constraint. Applying each file exactly once
// into an empty database is the fresh-replay case and is what C-30 measured.
//
// SAFETY
//
// --test-db is required. The scratch database is created on the TEST_DATABASE_URL
// instance via scripts/lib/db-url.js, which throws unless TEST_DATABASE_URL is
// set, parseable, and a DIFFERENT host from DATABASE_URL. The shared database
// is only ever read, to supply the live snapshot.
//
// USAGE
//
//   node scripts/verify-migrations-replay.js --dry-run    list migrations, connect to nothing
//   node scripts/verify-migrations-replay.js --test-db    replay and diff (creates + drops a scratch DB)
//   node scripts/verify-migrations-replay.js --test-db --keep-db   leave the scratch DB for debugging
//   node scripts/verify-migrations-replay.js --test-db --reference=test   diff against the TEST branch
//   node scripts/verify-migrations-replay.js --test-db --reference=shared  diff against DATABASE_URL (default)
//
// NOT part of `npm run test:unit` (that glob is `src/**/*.test.js`). Its
// DB-free helpers are tested by scripts/lib/replay-harness.test.js via
// `npm run test:scripts`.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const { compareSchemaSnapshot } = require('./lib/schema-diff');
const { resolveTestDbUrl } = require('./lib/db-url');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'database', 'migrations');

// Invented here, never derived from DATABASE_URL (scripts/lib/replay-harness.test.js pins that).
const SCRATCH_DB = 'migrations_replay_tmp';

// Snapshot strings carry the DEFINITION, not just the identifier. Comparing
// names was C-30's original weakness: a CHECK keeping its name while its body
// changed would have been reported as faithful. Every query excludes
// schema_migrations because that table is created by run-migrations.js, not by
// a numbered migration, so a fresh replay legitimately lacks it.
const SNAPSHOT_QUERIES = {
  columns: `SELECT table_name||'.'||column_name||' :: '||data_type||COALESCE('.'||udt_name,'')
                   ||' :: '||is_nullable||' :: '||COALESCE(column_default,'-')
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name <> 'schema_migrations'
            ORDER BY 1`,
  checks: `SELECT r.relname||'.'||con.conname||' :: '||pg_get_constraintdef(con.oid)
           FROM pg_constraint con
           JOIN pg_class r ON r.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = r.relnamespace
           WHERE con.contype='c' AND n.nspname='public' AND r.relname <> 'schema_migrations'
           ORDER BY 1`,
  fks: `SELECT r.relname||'.'||con.conname||' :: '||pg_get_constraintdef(con.oid)
        FROM pg_constraint con
        JOIN pg_class r ON r.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE con.contype='f' AND n.nspname='public' AND r.relname <> 'schema_migrations'
        ORDER BY 1`,
  indexes: `SELECT indexdef FROM pg_indexes
            WHERE schemaname='public' AND indexname NOT LIKE 'schema_migrations%'
            ORDER BY 1`,
};

function listMigrations(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
}

function scratchDatabaseUrl(baseUrl, name) {
  const u = new URL(baseUrl);
  u.pathname = '/' + name;
  return u.toString();
}

// Throws unless TEST_DATABASE_URL is set, parseable and a different host from
// DATABASE_URL. Delegating to db-url keeps that rule in exactly one place.
// NOTE: returns a pg connection CONFIG OBJECT ({ connectionString,
// connectionTimeoutMillis }), not a bare URL string.
function resolveReplayTarget(env) {
  return resolveTestDbUrl(env);
}

// Backends must be terminated first or the DROP fails with "database is being
// accessed by other users" — which is what a crashed run leaves behind.
async function dropScratchDatabase(client, name) {
  await client.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${name}' AND pid <> pg_backend_pid()`,
  );
  await client.query(`DROP DATABASE IF EXISTS ${name}`);
}

// Cleanup runs on BOTH the success and the failure path, so an interrupted or
// failing migration never leaves a half-built database lying around.
//
// A cleanup failure must not swallow the error that got us here. Throwing from
// a finally block replaces the in-flight exception, so a DROP that failed
// (say, another session held a connection) would bury the actual cause — the
// migration that failed — and send the reader to debug the wrong thing. So the
// body's error wins, and the cleanup failure is attached to it. Only when the
// body succeeded does a cleanup failure surface on its own, because then it is
// the only problem there is.
async function withScratchDatabase(client, name, fn, opts = {}) {
  await client.query(`CREATE DATABASE ${name}`);
  let bodyError = null;
  let result;
  try {
    result = await fn();
  } catch (err) {
    bodyError = err;
    throw err;
  } finally {
    // Deliberately NOT `return` when keeping the database: a bare return inside a
    // finally block overrides the value the try block produced, so the caller got
    // undefined and read `.failed` off it. Branch around the cleanup instead.
    if (!opts.keepDb) {
      try {
        await dropScratchDatabase(client, name);
      } catch (dropErr) {
        if (!bodyError) throw dropErr;
        bodyError.cleanupError = dropErr && dropErr.message ? dropErr.message : String(dropErr);
      }
    }
  }
  return result;
}

// Neon propagates CREATE DATABASE asynchronously, so connecting to the scratch
// database immediately after creating it can race the control plane and fail
// with `database "..." does not exist (server_login_retry)`. Retry briefly
// rather than reporting a spurious replay failure.
async function connectWithRetry(config, attempts = 8, delayMs = 1500) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    const client = new Client({ ...config, ssl: { rejectUnauthorized: false } });
    client.on('error', (e) => console.error(`  client error: ${e.message}`));
    try {
      await client.connect();
      return client;
    } catch (err) {
      lastErr = err;
      await client.end().catch(() => {});
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`could not connect to the scratch database after ${attempts} attempts: ${lastErr && lastErr.message}`);
}

async function snapshot(client) {
  const out = {};
  for (const [name, sql] of Object.entries(SNAPSHOT_QUERIES)) {
    const res = await client.query(sql);
    out[name] = res.rows.map((r) => Object.values(r)[0]);
  }
  return out;
}

// --reference=test|shared selects the diff target. Default `shared` is the
// current behaviour (snapshot DATABASE_URL); `test` snapshots the TEST branch
// instead, so a TEST-first migration can be replay-verified (expect 0 drift)
// while the shared DB still trails by design.
function parseReference(argv) {
  let reference = 'shared';
  for (const arg of argv) {
    if (arg.startsWith('--reference=')) {
      const value = arg.slice('--reference='.length);
      if (value !== 'test' && value !== 'shared') {
        return { error: `ERROR: --reference must be test or shared, got '${value}'` };
      }
      reference = value;
    }
  }
  return { reference };
}

async function main(argv, env) {
  const flags = new Set(argv);
  const dryRun = flags.has('--dry-run');

  if (!dryRun && !flags.has('--test-db')) {
    console.error('ERROR: pass --test-db to run against TEST_DATABASE_URL, or --dry-run to list migrations.');
    console.error('       This script creates a database; it never does that implicitly.');
    return 1;
  }

  const parsed = parseReference(argv);
  if (parsed.error) {
    console.error(parsed.error);
    return 2;
  }
  const reference = parsed.reference;

  const files = listMigrations(MIGRATIONS_DIR);

  if (dryRun) {
    console.log(`Migrations to replay (${files.length}) — no database contacted:`);
    for (const f of files) console.log(`  ${f}`);
    return 0;
  }

  let testConfig;
  try {
    testConfig = resolveReplayTarget(env);
  } catch (err) {
    console.error('ERROR: ' + err.message);
    return 1;
  }

  const ssl = { rejectUnauthorized: false };
  // Reuse db-url's timeout on every connection this script opens.
  const adminConfig = { ...testConfig, ssl };
  const testUrl = testConfig.connectionString;
  const admin = new Client(adminConfig);
  let replay;

  try {
    await admin.connect();
    // Clear a scratch database left behind by an interrupted run.
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);

    let freshSnap = null;
    const outcome = await withScratchDatabase(
      admin,
      SCRATCH_DB,
      async () => {
        replay = await connectWithRetry({ ...testConfig, connectionString: scratchDatabaseUrl(testUrl, SCRATCH_DB) });
        let failed = null;
        for (const f of files) {
          const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
          try {
            await replay.query('BEGIN');
            await replay.query(sql);
            await replay.query('COMMIT');
            console.log(`  APPLIED  ${f}`);
          } catch (err) {
            await replay.query('ROLLBACK').catch(() => {});
            console.error(`  FAILED   ${f}`);
            console.error(`           ${err.code || ''}: ${err.message}`);
            failed = f;
            break;
          }
        }
        // Snapshot and CLOSE before returning: withScratchDatabase's finally
        // runs pg_terminate_backend against the scratch database, which would
        // kill this very connection mid-drop if it were still open.
        if (!failed) freshSnap = await snapshot(replay);
        await replay.end();
        replay = null;
        return { failed };
      },
      { keepDb: flags.has('--keep-db') },
    );

    if (outcome.failed) {
      console.error(`\nREPLAY ABORTED at ${outcome.failed} — schema not comparable.`);
      return 1;
    }
    console.log(`\nReplayed ${files.length} migrations into an empty database.`);

    // The reference side defaults to the shared DATABASE_URL; --reference=test
    // snapshots the TEST branch instead. Scratch creation still ran on the
    // TEST instance either way (AGENTS.md item 8).
    const referenceUrl = reference === 'test' ? testConfig.connectionString : env.DATABASE_URL;
    if (reference === 'test' && !referenceUrl) {
      console.error('ERROR: --reference=test needs TEST_DATABASE_URL (guarded config missing connectionString)');
      return 1;
    }
    if (reference !== 'test' && !env.DATABASE_URL) {
      console.error('ERROR: DATABASE_URL is not set in .env');
      return 1;
    }
    console.log(`Reference: ${reference === 'test' ? 'TEST_DATABASE_URL' : 'DATABASE_URL'}`);
    const live = new Client({ connectionString: referenceUrl, connectionTimeoutMillis: testConfig.connectionTimeoutMillis, ssl });
    await live.connect();
    let result;
    let liveCounts;
    let freshCounts;
    try {
      const liveSnap = await snapshot(live);
      result = compareSchemaSnapshot(freshSnap, liveSnap);
      // Counts must be taken from the snapshot we already hold: the connection
      // is closed in the finally below, so a second round of queries here
      // would hit a closed client.
      liveCounts = Object.fromEntries(Object.entries(liveSnap).map(([k, v]) => [k, v.length]));
      freshCounts = Object.fromEntries(Object.entries(freshSnap).map(([k, v]) => [k, v.length]));
    } finally {
      await live.end().catch(() => {});
    }

    let drift = 0;
    for (const [name, d] of Object.entries(result.byClass)) {
      const ok = d.onlyFresh.length === 0 && d.onlyLive.length === 0;
      if (!ok) drift++;
      console.log(`  ${name.padEnd(8)} fresh=${String(freshCounts[name]).padStart(3)} live=${String(liveCounts[name]).padStart(3)}  ${ok ? 'MATCH' : 'DRIFT'}`);
      for (const item of d.onlyLive.slice(0, 10)) console.log(`      live-only : ${item}`);
      for (const item of d.onlyFresh.slice(0, 10)) console.log(`      fresh-only: ${item}`);
      if (d.onlyLive.length > 10 || d.onlyFresh.length > 10) {
        console.log(`      ...and ${Math.max(d.onlyLive.length, d.onlyFresh.length) - 10} more`);
      }
    }

    console.log(`\nRESULT: ${drift === 0 ? '0 drift' : drift + ' class(es) drift'}`);
    return drift === 0 ? 0 : 1;
  } finally {
    if (replay) await replay.end().catch(() => {});
    await admin.end().catch(() => {});
  }
}

module.exports = {
  SCRATCH_DB,
  SNAPSHOT_QUERIES,
  listMigrations,
  scratchDatabaseUrl,
  dropScratchDatabase,
  withScratchDatabase,
  resolveReplayTarget,
  parseReference,
};

if (require.main === module) {
  require('dotenv').config();
  main(process.argv.slice(2), process.env)
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('ERROR:', err && err.message ? err.message : err);
      if (err && err.stack) console.error(err.stack);
      process.exit(1);
    });
}
