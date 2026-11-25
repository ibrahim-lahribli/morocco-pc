'use strict';

// run-seeds.js — applies database/seeds/*.sql in sorted filename order.
//
// SEPARATE from scripts/run-migrations.js (schema/DDL only). Seed files are
// DML-only, idempotent (INSERT ... WHERE NOT EXISTS on natural keys), and
// wrapped in transactions, so re-running is safe on the shared Neon DB.
//
// WHY THIS FILE HAS A REAL CLI NOW (2026-11-25). It used to read argv with a
// single `process.argv.includes('--dry-run')` and then connect to
// `process.env.DATABASE_URL` regardless of anything else on the command line.
// An operator (or an agent) probing `--help` therefore APPLIED EVERY SEED to the
// shared database: an unrecognised flag was not an error, it was the default
// path. The rules this file now keeps, and AGENTS.md section 5 records:
//
//   * an unknown argument is a usage error (exit 2), never the default path;
//   * `--help` prints the usage text and exits 0, touching nothing;
//   * a real apply against `DATABASE_URL` ALWAYS needs `--confirm-shared` or a
//     valid `--restore-point=<id>`. A loopback HOST is not an authorization: a
//     local port can forward to a shared database through an SSH tunnel, a TCP
//     proxy or another forwarding process, so the connection string proves
//     nothing about the destination it actually reaches;
//   * `--test-db` routes through the shared TEST_DATABASE_URL guard instead
//     (packages/database-guard/src), which refuses a host equal to DATABASE_URL;
//   * `dotenv` is loaded by the BOOTSTRAP, not by `require()`ing this module,
//     so a test that loads it cannot read a developer's .env.
//
// The pure parts (parseArgs, resolveConnection, applySeeds) are
// exported so the contract is testable with a recording fake and no database
// (scripts/lib/run-seeds-cli.test.js), the same split run-migrations.js uses.

const fs = require('fs');
const path = require('path');

const USAGE = [
  'usage: node scripts/run-seeds.js [--dry-run] [--test-db] [--confirm-shared]',
  '                                 [--restore-point=<id>] [--help]',
  '',
  '  --dry-run            parse and report each seed file; write nothing.',
  '  --test-db            apply to TEST_DATABASE_URL through the shared-target guard.',
  '  --confirm-shared     apply to DATABASE_URL on purpose.',
  '  --restore-point=<id> the Neon restore point a DATABASE_URL apply relies on',
  '                       (^[A-Za-z0-9_-]{8,}$); accepted instead of --confirm-shared.',
  '  --help               print this text and exit 0.',
  '',
  'Without --test-db the target is DATABASE_URL, and a write there needs',
  '--confirm-shared or --restore-point=<id> even when the host looks loopback: a',
  'local port can forward to a shared database. Seed files are idempotent, so a',
  're-run applies nothing new; the guard is about the TARGET being deliberate, not',
  'about the writes being unsafe.',
].join('\n');

const DEFAULT_SEEDS_DIR = path.join(process.cwd(), 'database', 'seeds');
const RESTORE_POINT_FLAG = '--restore-point=';
/** The same shape run-migrations.js and generate-presets.js require. */
const RESTORE_POINT_PATTERN = /^[A-Za-z0-9_-]{8,}$/;

/**
 * A usage problem, as opposed to a failed run. Exit 2, never 1: a caller
 * scripting this has to be able to tell "fix the invocation" from "look at the
 * database" (the split run-migrations.js and generate-presets.js already use).
 */
class UsageError extends Error {}

const fail = (message) => {
  throw new UsageError(message);
};

const isValidRestorePointId = (value) => typeof value === 'string' && RESTORE_POINT_PATTERN.test(value);

/**
 * Parse the command line. Pure, and it RETURNS an outcome rather than throwing at
 * the process boundary, so the refusal paths are testable without a database.
 *
 * @param {string[]} argv the full argv (`[node, script, ...flags]`)
 * @returns {{dryRun: boolean, testDb: boolean, confirmShared: boolean,
 *   restorePoint: string|null, help: boolean}}
 * @throws {UsageError} on an unknown flag or a malformed restore point
 */
function parseArgs(argv) {
  const args = {
    dryRun: false,
    testDb: false,
    confirmShared: false,
    restorePoint: null,
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--test-db') {
      args.testDb = true;
    } else if (arg === '--confirm-shared') {
      args.confirmShared = true;
    } else if (arg.startsWith(RESTORE_POINT_FLAG)) {
      const value = arg.slice(RESTORE_POINT_FLAG.length);
      if (!isValidRestorePointId(value)) {
        fail(RESTORE_POINT_FLAG + '<id> must match ' + RESTORE_POINT_PATTERN.source
          + ' (received: ' + JSON.stringify(value) + '). A placeholder fails that shape on purpose.');
      }
      args.restorePoint = value;
    } else {
      // THE defect this closes: this branch used to be absent, so `--help` and
      // any typo fell through to a real apply.
      fail('unknown argument: ' + arg + '\n' + USAGE);
    }
  }
  if (args.testDb && args.confirmShared) {
    fail('--test-db and --confirm-shared are mutually exclusive: a guarded TEST branch'
      + ' needs no confirmation, and a confirmation does not make a shared write a TEST write.');
  }
  return args;
}

/**
 * The connection config for a parsed command line, or null for a run that must
 * not connect (a dry run, or --help).
 *
 * @param {object} args the parsed argv
 * @param {object} env an environment-like object (never read implicitly)
 * @returns {{connectionString: string, connectionTimeoutMillis?: number, target: string}|null}
 * @throws {UsageError} when a DATABASE_URL apply was not asked for, or a guard
 *   refuses the target
 */
function resolveConnection(args, env) {
  const source = env || {};
  if (args.help || args.dryRun) return null;

  if (args.testDb) {
    const { getWriteTestDbUrl } = require('../packages/database-guard/src');
    let config;
    try {
      config = getWriteTestDbUrl(source);
    } catch (err) {
      fail(err && err.message ? err.message : String(err));
    }
    return Object.assign({}, config, { target: 'TEST_DATABASE_URL' });
  }

  const connectionString = source.DATABASE_URL;
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    fail('DATABASE_URL is not set. Set it, or pass --test-db to target TEST_DATABASE_URL.');
  }
  // EVERY DATABASE_URL apply is deliberate only when the operator says so. The
  // host is not consulted: `localhost` and `127.0.0.1` are indistinguishable
  // from a forwarded port to the shared database, so treating them as proof of a
  // disposable target would let one typo reach a shelf nobody meant to touch.
  if (!(args.confirmShared || isValidRestorePointId(args.restorePoint))) {
    fail('refusing to apply seeds to DATABASE_URL without confirmation.\n'
      + '       Seeds are DML-only and idempotent, but this target is a real database,\n'
      + '       and a loopback host does not make one disposable: a local port can\n'
      + '       forward to a shared database through a tunnel or proxy.\n'
      + '       Re-run with --confirm-shared, or with --restore-point=<id> matching '
      + RESTORE_POINT_PATTERN.source + '.');
  }
  return { connectionString, target: 'DATABASE_URL' };
}

/**
 * Apply one list of seed files through a client, logging exactly what the old
 * script logged. Takes the client as an argument so a recording fake can prove
 * the call order and the statement count without a database.
 *
 * @param {object} client anything with `query(sql)`
 * @param {{name: string, sql: string}[]} seeds
 * @param {{log?: Function}} [io]
 * @returns {Promise<{applied: number, products: number, offers: number, assessments: number}>}
 */
async function applySeeds(client, seeds, io = {}) {
  const log = io.log || console.log;
  for (const seed of seeds) {
    await client.query(seed.sql);
    log('SEEDED: ' + seed.name);
  }

  const seedProducts = await client.query(
    "SELECT count(*)::int AS n FROM product WHERE name LIKE 'Seed %'"
  );
  const seedOffers = await client.query(
    'SELECT count(*)::int AS n FROM store_offer o\n'
    + '        JOIN product p ON p.id = o.product_id WHERE p.name LIKE \'Seed %\''
  );
  const seedAssessments = await client.query(
    'SELECT count(*)::int AS n FROM component_assessment a\n'
    + '        JOIN product p ON p.id = a.product_id WHERE p.name LIKE \'Seed %\''
  );

  const counts = {
    applied: seeds.length,
    products: seedProducts.rows[0].n,
    offers: seedOffers.rows[0].n,
    assessments: seedAssessments.rows[0].n,
  };
  log('Seed rows: products=' + counts.products
    + ', offers=' + counts.offers
    + ', assessments=' + counts.assessments);
  return counts;
}

/** Read the seed directory in sorted filename order. */
function readSeeds(seedsDir) {
  let files;
  try {
    files = fs.readdirSync(seedsDir).filter((f) => f.endsWith('.sql')).sort();
  } catch (err) {
    throw new Error('cannot read seeds dir (' + seedsDir + '): ' + err.message);
  }
  return files.map((name) => ({ name, sql: fs.readFileSync(path.join(seedsDir, name), 'utf8') }));
}

async function main(argv = process.argv, env = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    // A usage outcome, and exit 0: asking how to run something is not an error.
    console.log(USAGE);
    return 0;
  }

  const seedsDir = DEFAULT_SEEDS_DIR;
  const seeds = readSeeds(seedsDir);
  if (seeds.length === 0) {
    console.log('No seed files found.');
    return 0;
  }

  if (args.dryRun) {
    for (const seed of seeds) {
      const statements = seed.sql.split(';').filter((s) => s.trim().length > 0);
      console.log('DRY-RUN ' + seed.name + ': ' + statements.length + ' statements, ' + seed.sql.length + ' chars');
    }
    return 0;
  }

  const config = resolveConnection(args, env);
  const { Client } = require('pg');
  const client = new Client({
    connectionString: config.connectionString,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
  });
  try {
    await client.connect();
    console.log('Connected to PostgreSQL database');
    await applySeeds(client, seeds);
  } finally {
    await client.end().catch(() => {});
  }
  return 0;
}

module.exports = {
  main,
  parseArgs,
  resolveConnection,
  applySeeds,
  readSeeds,
  isValidRestorePointId,
  UsageError,
  USAGE,
};

if (require.main === module) {
  // The bootstrap owns the environment: require()ing this module must never read
  // a developer's .env (the rule getWriteTestDbUrl's header states).
  require('dotenv').config();
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      const message = error && error.message ? error.message : String(error);
      if (error instanceof UsageError) {
        console.error(message);
        process.exitCode = 2;
      } else {
        console.error('ERROR:', message);
        process.exitCode = 1;
      }
    }
  );
}
