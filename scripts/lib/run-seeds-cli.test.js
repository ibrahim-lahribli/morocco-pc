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
//   3. an apply to `DATABASE_URL` needs `--confirm-shared` or a valid
//      `--restore-point=<id>`, WHATEVER THE HOST LOOKS LIKE. A loopback hostname
//      is not an authorization: a local port can forward to a shared database
//      through an SSH tunnel, a TCP proxy or another forwarding process, so the
//      connection string cannot prove the destination is disposable. Every
//      refusal below is asserted for `localhost`, `127.0.0.1` and a Neon host
//      alike, because "loopback is safe" was the defect.
//
// The fourth part is the TEST target's own authorization: `--test-db` routes
// through `getWriteTestDbUrl()`, but that guard only compares normalized
// hostnames, and a tunnel makes the strings differ while the destination is
// shared. So a TEST apply needs `--confirm-test-db`, an operator attestation
// that the destination really is the isolated database - pinned below as
// required, non-bypassing, and refused on its own.
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
  main, parseArgs, resolveConnection, applySeeds, isValidRestorePointId, USAGE, UsageError,
} = require('../../scripts/run-seeds');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ARGV = ['node', 'scripts/run-seeds.js'];
const NEON = 'postgresql://u:p@ep-shared-2.us-east-1.aws.neon.tech/neondb?sslmode=require';
const LOOPBACK = 'postgres://postgres:pg@127.0.0.1:55432/morocco_pc';
/** The same local port spelled `localhost` - one SSH tunnel away from anywhere. */
const TUNNEL = 'postgres://postgres:pg@localhost:55432/morocco_pc';

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
  assert.throws(
    () => parseArgs(ARGV.concat(['--test-db', '--confirm-shared', '--confirm-test-db'])),
    /mutually exclusive/,
    'adding the TEST attestation does not rescue --confirm-shared either'
  );

  // The TEST attestation is not a free-floating opt-in: on its own it authorizes
  // nothing, because it only ever says something ABOUT a TEST target.
  assert.throws(
    () => parseArgs(ARGV.concat(['--confirm-test-db'])),
    /requires --test-db/,
    '--confirm-test-db without --test-db is an invalid invocation'
  );

  // And a restore point is a DATABASE_URL authorization, never a TEST one.
  assert.throws(
    () => parseArgs(ARGV.concat(['--test-db', '--restore-point=br-eu-backup-20261103'])),
    /DATABASE_URL apply only/,
    'a restore point must not silently authorize a TEST-target apply'
  );
});

test('a DATABASE_URL apply is refused without confirmation, whatever the host looks like', () => {
  // The finding: `localhost`, `127.0.0.1` and `::1` were treated as proof that
  // the database is disposable. They are not - a local port can forward to the
  // shared database - so BOTH spellings are refused exactly like a Neon host,
  // and the refusal names both ways to say yes.
  for (const url of [NEON, LOOPBACK, TUNNEL]) {
    assert.throws(
      () => resolveConnection(parseArgs(ARGV), { DATABASE_URL: url }),
      /--confirm-shared/,
      'an unstated write to DATABASE_URL is refused: ' + url
    );
    assert.throws(
      () => resolveConnection(parseArgs(ARGV), { DATABASE_URL: url }),
      /--restore-point=<id>/,
      'and the refusal names the other accepted form: ' + url
    );
    // The refusal is about the TARGET, not the host: the message must not claim
    // the host was checked, because it no longer is.
    assert.throws(
      () => resolveConnection(parseArgs(ARGV), { DATABASE_URL: url }),
      /loopback host does not make one disposable/,
      'the message explains why loopback is not an authorization: ' + url
    );
  }
});

test('the explicit authorization applies to a loopback and a remote target alike', () => {
  for (const url of [NEON, LOOPBACK]) {
    assert.equal(
      resolveConnection(parseArgs(ARGV.concat(['--confirm-shared'])), { DATABASE_URL: url }).connectionString,
      url,
      '--confirm-shared is the opt-in for any DATABASE_URL: ' + url
    );
    assert.equal(
      resolveConnection(
        parseArgs(ARGV.concat(['--restore-point=br-eu-backup-20261103'])),
        { DATABASE_URL: url }
      ).connectionString,
      url,
      'a valid restore point is the other accepted opt-in: ' + url
    );
  }

  // A restore point is kept as parsed, so the run can print what the write
  // relied on; a malformed one never reaches the apply (pinned below).
  assert.equal(
    parseArgs(ARGV.concat(['--restore-point=br-eu-backup-20261103'])).restorePoint,
    'br-eu-backup-20261103'
  );

  // A dry run resolves no connection at all, whatever the target.
  assert.equal(resolveConnection(parseArgs(ARGV.concat(['--dry-run'])), { DATABASE_URL: NEON }), null);
  assert.equal(resolveConnection(parseArgs(ARGV.concat(['--dry-run'])), { DATABASE_URL: LOOPBACK }), null);
});

test('--test-db needs its own authorization, then still goes through the shared-target guard', () => {
  const TEST = 'postgresql://u:p@ep-test-1.eu-central-1.aws.neon.tech/neondb?sslmode=require';
  const env = { DATABASE_URL: NEON, TEST_DATABASE_URL: TEST };
  assert.equal(
    resolveConnection(parseArgs(ARGV.concat(['--test-db', '--confirm-test-db'])), env).connectionString,
    TEST
  );

  // The guard the migrations CLI already relies on stays ACTIVE: the explicit
  // attestation says the destination is isolated, it does not overrule a host
  // that IS the shared endpoint.
  assert.throws(
    () => resolveConnection(
      parseArgs(ARGV.concat(['--test-db', '--confirm-test-db'])),
      { DATABASE_URL: NEON, TEST_DATABASE_URL: NEON }
    ),
    /must not target the shared database/,
    'the attestation must not bypass the identical-host refusal'
  );
  // And a missing one is a usage problem, not a silent fallback to DATABASE_URL.
  assert.throws(
    () => resolveConnection(parseArgs(ARGV.concat(['--test-db', '--confirm-test-db'])), { DATABASE_URL: NEON }),
    /TEST_DATABASE_URL is not set/
  );
});

test('a TEST apply is refused without the attestation, and the attestation is an attestation', () => {
  const TEST_REMOTE = 'postgresql://u:p@ep-test-9.eu-central-1.aws.neon.tech/neondb?sslmode=require';

  // The finding: normalized hosts differ for a tunnel too, so neither a loopback
  // TEST URL nor a remote one is authorized by the connection string.
  for (const testUrl of [LOOPBACK, TEST_REMOTE]) {
    const env = { DATABASE_URL: NEON, TEST_DATABASE_URL: testUrl };
    assert.throws(
      () => resolveConnection(parseArgs(ARGV.concat(['--test-db'])), env),
      /--confirm-test-db/,
      'a TEST apply without its attestation is refused: ' + testUrl
    );
    // The refusal says WHY the string cannot be trusted, so an operator cannot
    // read it as "add the flag and the check does the rest".
    assert.throws(
      () => resolveConnection(parseArgs(ARGV.concat(['--test-db'])), env),
      /verified out of\s+band/,
      'the refusal asks for out-of-band verification of the destination: ' + testUrl
    );

    // Explicit TEST authorization works for a DIFFERENT normalized host...
    assert.equal(
      resolveConnection(
        parseArgs(ARGV.concat(['--test-db', '--confirm-test-db'])),
        env
      ).connectionString,
      testUrl,
      'the attestation authorizes a different normalized host: ' + testUrl
    );
  }

  // ...but not for the same endpoint spelled pooled: normalization still wins.
  const pooled = 'postgresql://u:p@ep-shared-2-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require';
  assert.throws(
    () => resolveConnection(
      parseArgs(ARGV.concat(['--test-db', '--confirm-test-db'])),
      { DATABASE_URL: NEON, TEST_DATABASE_URL: pooled }
    ),
    /must not target the shared database/,
    'pooled-vs-direct is still the same endpoint, attestation or not'
  );
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
    // Both a remote host and the loopback spelling: neither may open anything.
    for (const url of [NEON, LOOPBACK]) {
      await assert.rejects(
        () => main(ARGV, { DATABASE_URL: url }),
        /--confirm-shared/,
        'an unconfirmed target is refused: ' + url
      );
      assert.equal(constructed, 0, 'no Client was constructed, so nothing could have been written: ' + url);
      assert.equal(connected, 0, 'and no connection was opened: ' + url);
    }

    // The same consequence for an unattested TEST target, loopback included:
    // the id check runs before `pg` is even required.
    const TEST_REMOTE = 'postgresql://u:p@ep-test-9.eu-central-1.aws.neon.tech/neondb?sslmode=require';
    for (const testUrl of [LOOPBACK, TEST_REMOTE]) {
      await assert.rejects(
        () => main(ARGV.concat(['--test-db']), { DATABASE_URL: NEON, TEST_DATABASE_URL: testUrl }),
        /--confirm-test-db/,
        'an unattested TEST target is refused: ' + testUrl
      );
      assert.equal(constructed, 0, 'no Client was constructed for the TEST refusal: ' + testUrl);
      assert.equal(connected, 0, 'and no connection was opened: ' + testUrl);
    }
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
  for (const flag of ['--dry-run', '--test-db', '--confirm-test-db', '--confirm-shared', '--restore-point=<id>', '--help']) {
    assert.ok(USAGE.includes(flag), 'usage must document ' + flag);
  }
});
