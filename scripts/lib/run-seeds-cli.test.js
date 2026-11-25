'use strict';

// scripts/lib/run-seeds-cli.test.js — the DB-free contract of
// `scripts/run-seeds.js`.
//
// WHY THIS FILE EXISTS (2026-11-25). The seeder used to read argv with a single
// `process.argv.includes('--dry-run')` and then connect to
// `process.env.DATABASE_URL` for ANY other command line. So `--help` - the flag
// every CLI is expected to answer - applied every seed to the shared database.
// An unknown argument was not an error; it was the default path.
//
// The fix has three parts and each is pinned here:
//   1. `--help` prints the usage text and exits 0, touching nothing.
//   2. an unknown argument is a usage error (exit 2), not a run.
//   3. an apply to a NON-loopback `DATABASE_URL` needs `--confirm-shared` or a
//      valid `--restore-point=<id>`; a loopback target is disposable and needs
//      neither, which is what keeps CI's service container and local throwaways
//      frictionless.
//
// Everything is checked with a recording fake or by SPAWNING with blanked
// environment variables. Nothing here connects to a database, and `require()`ing
// the script must not read a developer's `.env` (the bootstrap owns dotenv, which
// the last test pins).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  main, parseArgs, isLoopbackHost, resolveConnection, applySeeds, isValidRestorePointId, USAGE, UsageError,
} = require('../../scripts/run-seeds');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ARGV = ['node', 'scripts/run-seeds.js'];
const NEON = 'postgresql://u:p@ep-shared-2.us-east-1.aws.neon.tech/neondb?sslmode=require';
const LOOPBACK = 'postgres://postgres:pg@127.0.0.1:55432/morocco_pc';

/**
 * A client that records what it was asked to run and returns the three count rows
 * `applySeeds` reads at the end. No database, no network, no clock.
 */
function recordingClient(counts = { products: 113, offers: 114, assessments: 319 }) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (/FROM product WHERE name LIKE 'Seed %'/.test(sql)) return { rows: [{ n: counts.products }] };
      if (/FROM store_offer/.test(sql)) return { rows: [{ n: counts.offers }] };
      if (/FROM component_assessment/.test(sql)) return { rows: [{ n: counts.assessments }] };
      return { rows: [] };
    },
  };
}

test('--help is a usage outcome that exits 0 and connects to nothing', () => {
  const args = parseArgs(ARGV.concat(['--help']));
  assert.equal(args.help, true);
  assert.equal(resolveConnection(args, { DATABASE_URL: NEON }), null, 'help must resolve no connection');

  const child = spawnSync(process.execPath, ['scripts/run-seeds.js', '--help'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    // Blanked deliberately: if --help fell through to a run, the missing URL
    // would make it fail loudly instead of quietly applying seeds.
    env: Object.assign({}, process.env, { DATABASE_URL: '', TEST_DATABASE_URL: '' }),
  });
  assert.equal(child.status, 0, 'asking how to run something is not an error (stderr: ' + child.stderr + ')');
  assert.match(child.stdout, /usage: node scripts\/run-seeds\.js/);
  assert.doesNotMatch(child.stdout + child.stderr, /SEEDED:|Connected to/);
});

test('an unknown argument is exit 2, never the default path', () => {
  assert.throws(() => parseArgs(ARGV.concat(['--bogus'])), /unknown argument: --bogus/);
  assert.throws(() => parseArgs(ARGV.concat(['--confirm'])), UsageError, 'a near-miss fails closed');

  const child = spawnSync(process.execPath, ['scripts/run-seeds.js', '--rehearse'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { DATABASE_URL: '', TEST_DATABASE_URL: '' }),
  });
  assert.equal(child.status, 2, 'a usage problem, not a run failure');
  assert.match(child.stderr, /unknown argument: --rehearse/);
  assert.match(child.stderr, /usage: node scripts\/run-seeds\.js/);
  assert.doesNotMatch(child.stdout + child.stderr, /SEEDED:/);
});

test('a malformed restore point is refused, and the flags that conflict are refused', () => {
  assert.equal(isValidRestorePointId('br-eu-backup-20261103'), true);
  assert.equal(isValidRestorePointId('short'), false);
  assert.throws(() => parseArgs(ARGV.concat(['--restore-point=short'])), /must match/);
  assert.throws(() => parseArgs(ARGV.concat(['--restore-point='])), /must match/);
  assert.throws(
    () => parseArgs(ARGV.concat(['--test-db', '--confirm-shared'])),
    /mutually exclusive/,
    'a confirmation does not turn a shared write into a TEST write'
  );
});

test('loopback is the only target treated as disposable', () => {
  assert.equal(isLoopbackHost(LOOPBACK), true);
  assert.equal(isLoopbackHost('postgres://u:p@localhost:5432/db'), true);
  assert.equal(isLoopbackHost('postgres://u:p@[::1]:5432/db'), true);
  assert.equal(isLoopbackHost(NEON), false);
  assert.equal(isLoopbackHost(''), false);
  assert.equal(isLoopbackHost('not a url'), false);
});

test('a non-loopback DATABASE_URL needs an explicit confirmation; a loopback one does not', () => {
  // No confirmation: refused, and the message names both ways to say yes.
  assert.throws(
    () => resolveConnection(parseArgs(ARGV), { DATABASE_URL: NEON }),
    /--confirm-shared/,
    'the whole point: an unstated write to a real database is refused'
  );
  assert.throws(
    () => resolveConnection(parseArgs(ARGV), { DATABASE_URL: NEON }),
    /--restore-point=<id>/,
    'and a restore point is the other accepted form'
  );

  // Confirmed, by flag or by a real restore point.
  assert.equal(resolveConnection(parseArgs(ARGV.concat(['--confirm-shared'])), { DATABASE_URL: NEON }).connectionString, NEON);
  assert.equal(
    resolveConnection(parseArgs(ARGV.concat(['--restore-point=br-eu-backup-20261103'])), { DATABASE_URL: NEON }).connectionString,
    NEON
  );

  // Loopback: no ceremony, because it is disposable by construction (CI's
  // service container and any local throwaway).
  assert.equal(resolveConnection(parseArgs(ARGV), { DATABASE_URL: LOOPBACK }).connectionString, LOOPBACK);

  // A dry run resolves no connection at all, whatever the target.
  assert.equal(resolveConnection(parseArgs(ARGV.concat(['--dry-run'])), { DATABASE_URL: NEON }), null);
});

test('--test-db goes through the shared-target guard instead of the confirmation', () => {
  const TEST = 'postgresql://u:p@ep-test-1.eu-central-1.aws.neon.tech/neondb?sslmode=require';
  const env = { DATABASE_URL: NEON, TEST_DATABASE_URL: TEST };
  assert.equal(resolveConnection(parseArgs(ARGV.concat(['--test-db'])), env).connectionString, TEST);

  // The guard the migrations CLI already relies on: TEST must not be the shared host.
  assert.throws(
    () => resolveConnection(parseArgs(ARGV.concat(['--test-db'])), { DATABASE_URL: NEON, TEST_DATABASE_URL: NEON }),
    /must not target the shared database/
  );
  // And a missing one is a usage problem, not a silent fallback to DATABASE_URL.
  assert.throws(() => resolveConnection(parseArgs(ARGV.concat(['--test-db'])), { DATABASE_URL: NEON }), /TEST_DATABASE_URL is not set/);
});

test('applySeeds runs every file in order and then the three counts, on the client it is given', async () => {
  const client = recordingClient();
  const lines = [];
  const seeds = [
    { name: '001_minimal_builds.sql', sql: 'INSERT ...;' },
    { name: '002_catalog_expansion.sql', sql: 'INSERT ...;' },
  ];

  const counts = await applySeeds(client, seeds, { log: (line) => lines.push(line) });

  assert.deepEqual(counts, { applied: 2, products: 113, offers: 114, assessments: 319 });
  assert.equal(client.calls.length, 5, 'two seed files plus the three count queries');
  assert.equal(client.calls[0], 'INSERT ...;', 'the files run in the order given');
  assert.match(client.calls[2], /FROM product WHERE name LIKE 'Seed %'/, 'then the counts');
  assert.deepEqual(lines, [
    'SEEDED: 001_minimal_builds.sql',
    'SEEDED: 002_catalog_expansion.sql',
    'Seed rows: products=113, offers=114, assessments=319',
  ]);
});

test('a refused run never constructs a client (the guard runs before the connection)', async () => {
  // The claim is about CONSEQUENCE, not ordering in the source: a refusal must
  // not have opened anything. `pg.Client` is wrapped so a construction is
  // observable, and main() is driven directly with an injected environment.
  const pg = require('pg');
  const OriginalClient = pg.Client;
  let constructed = 0;
  let connected = 0;
  pg.Client = function CountingClient(...clientArgs) {
    constructed += 1;
    const instance = new OriginalClient(...clientArgs);
    const connect = instance.connect.bind(instance);
    instance.connect = (...connectArgs) => { connected += 1; return connect(...connectArgs); };
    return instance;
  };
  try {
    await assert.rejects(
      () => main(ARGV, { DATABASE_URL: NEON }),
      /--confirm-shared/,
      'a non-loopback target without confirmation is refused'
    );
    assert.equal(constructed, 0, 'no Client was constructed, so nothing could have been written');
    assert.equal(connected, 0);
  } finally {
    pg.Client = OriginalClient;
  }
});

test('requiring the script neither runs a seed nor reads a .env', () => {
  const child = spawnSync(
    process.execPath,
    ['-e', 'require("./scripts/run-seeds.js"); console.log("LOADED-GUARD-OK");'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      // Blanked: if the bootstrap had run, the empty URL would fail loudly.
      env: Object.assign({}, process.env, { DATABASE_URL: '', TEST_DATABASE_URL: '' }),
    }
  );
  assert.equal(child.status, 0, 'require() must exit 0 (stderr: ' + child.stderr + ')');
  assert.match(child.stdout, /LOADED-GUARD-OK/);
  assert.doesNotMatch(child.stdout, /SEEDED:|Connected to/);
});

test('the usage text documents every accepted flag', () => {
  for (const flag of ['--dry-run', '--test-db', '--confirm-shared', '--restore-point=<id>', '--help']) {
    assert.ok(USAGE.includes(flag), 'usage must document ' + flag);
  }
});
