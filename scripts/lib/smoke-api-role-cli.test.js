'use strict';

// scripts/lib/smoke-api-role-cli.test.js — the DB-free contract of
// `scripts/smoke-api-role.js`, the step that proves the API RUNS as the
// production role.
//
// The smoke test POSTs a real recommendation to the SHARED database, so what can
// be pinned without a database is exactly what decides whether it may do that at
// all:
//   * `--confirm-shared` is REQUIRED — no environment variable, no CI job and no
//     default reaches the write path, so an accidental run cannot write;
//   * `--dry-run` needs no confirmation and no password, and touches nothing;
//   * the password comes from the file or the environment, never argv;
//   * the target is the shared DATABASE_URL, and its identity is printed as a
//     `db:<12 hex>` digest rather than a host;
//   * `--help` exits 2 and a refusal exits 1, neither with a stack trace.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  API_SCHEMA_PREREQUISITES,
  PASSWORD_ENV,
  SMOKE_ENGINE_VERSION,
  adoptPassForCleanup,
  buildSchemaPreflightSql,
  healthIsOk,
  missingSchemaPrerequisites,
  parseArgs,
  resolvePassword,
  resolveTarget,
  usageText,
} = require('../smoke-api-role');
const { API_ROLE_NAME } = require('./api-role');

const REPO_ROOT = path.join(__dirname, '..', '..');
const FAKE_SHARED = 'postgresql://neondb_owner:owner-s3cret@ep-fake-123456.us-east-2.aws.neon.tech/neondb?sslmode=require';

function isolatedEnv(extra) {
  return Object.assign({}, process.env, {
    DATABASE_URL: '',
    TEST_DATABASE_URL: '',
    [PASSWORD_ENV]: '',
  }, extra || {});
}

test('the usage names the role, the confirmation and the runbook', () => {
  const usage = usageText();
  assert.match(usage, /--confirm-shared/);
  assert.match(usage, new RegExp(API_ROLE_NAME));
  assert.match(usage, /SHARED/);
  assert.match(usage, /docs\/RECIPES\/provision-the-api-role\.md/);
});

test('CLI: defaults, the `=` forms, and the engine version it stamps on its rows', () => {
  const args = parseArgs(['node', 'scripts/smoke-api-role.js', '--confirm-shared']);
  assert.equal(args.confirmShared, true);
  assert.equal(args.dryRun, false);
  assert.equal(args.budget, 20000);
  assert.equal(args.useCase, 'GAMING');
  assert.equal(args.passwordFile, null);
  assert.equal(SMOKE_ENGINE_VERSION, 'smoke-api-role', 'the rows it writes name THIS tool, never a deploy');

  const flagged = parseArgs(['node', 'x', '--confirm-shared', '--budget=12000', '--use-case=OFFICE', '--password-file=/tmp/p']);
  assert.equal(flagged.budget, 12000);
  assert.equal(flagged.useCase, 'OFFICE');
  assert.equal(flagged.passwordFile, '/tmp/p');
});

test('CLI: the confirmation is a flag, never a default and never an env var', () => {
  assert.equal(parseArgs(['node', 'x']).confirmShared, false, 'absent means NO');
  for (const bad of [['--budget=0'], ['--budget=abc'], ['--use-case='], ['--nope'], ['extra'], ['--test-db']]) {
    assert.throws(() => parseArgs(['node', 'x'].concat(bad)), (error) => error.usage === true, bad.join(' ') + ' must be a usage error');
  }
  assert.throws(() => parseArgs(['node', 'x', '--help']), (error) => error.usage === true && /usage:/.test(error.message));
});

test('the password comes from the file or the environment, never from argv', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-api-role-cli-'));
  const file = path.join(dir, 'password');
  try {
    fs.writeFileSync(file, 'from-a-file\n');
    const fromFile = resolvePassword({ passwordFile: file }, { [PASSWORD_ENV]: 'from-the-env' });
    assert.equal(fromFile.password, 'from-a-file', 'the file wins, and one trailing newline is stripped');
    assert.ok(!fromFile.source.includes('from-a-file'), 'the source is reported; the secret is not');

    fs.writeFileSync(file, 'no-newline');
    assert.equal(resolvePassword({ passwordFile: file }, {}).password, 'no-newline');

    assert.equal(resolvePassword({ passwordFile: null }, { [PASSWORD_ENV]: 'env-secret' }).password, 'env-secret');
    assert.throws(() => resolvePassword({ passwordFile: null }, {}), /no password supplied/);
    assert.throws(() => resolvePassword({ passwordFile: path.join(dir, 'nope') }, {}), /could not read --password-file/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the target is the shared DATABASE_URL, named by digest and never by host', () => {
  assert.throws(() => resolveTarget({}), /DATABASE_URL is not set/);
  const target = resolveTarget({ DATABASE_URL: FAKE_SHARED, TEST_DATABASE_URL: 'postgresql://u:p@ep-other.neon.tech/neondb' });
  assert.equal(target.target.endpointId, 'ep-fake-123456');
  assert.equal(target.target.database, 'neondb');
  assert.equal(target.target.pooled, false);
  assert.match(target.digest, /^db:[0-9a-f]{12}$/);
  assert.ok(!JSON.stringify(target.target).includes('owner-s3cret'), 'no credential in the descriptor');
});

test('CLI: --help exits 2, a run without --confirm-shared refuses with exit 1', () => {
  const help = spawnSync(process.execPath, ['scripts/smoke-api-role.js', '--help'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  assert.equal(help.status, 2);
  assert.match(help.stdout + help.stderr, /USAGE: usage: node scripts\/smoke-api-role\.js/);
  assert.doesNotMatch(help.stdout + help.stderr, /at main|Node\.js v/);

  const unconfirmed = spawnSync(process.execPath, ['scripts/smoke-api-role.js'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: isolatedEnv({ DATABASE_URL: FAKE_SHARED }),
  });
  assert.equal(unconfirmed.status, 1);
  const output = unconfirmed.stdout + unconfirmed.stderr;
  assert.match(output, /REFUSED: this smoke test writes Layer 4 rows to the SHARED database/);
  assert.doesNotMatch(output, /ECONNREFUSED|ENOTFOUND|getaddrinfo|connection terminated/i, 'nothing dialled the target');
  assert.doesNotMatch(output, /at main|Node\.js v/);
});

test('CLI: --confirm-shared but no password still refuses BEFORE connecting', () => {
  const child = spawnSync(process.execPath, ['scripts/smoke-api-role.js', '--confirm-shared'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: isolatedEnv({ DATABASE_URL: FAKE_SHARED }),
  });
  assert.equal(child.status, 1);
  const output = child.stdout + child.stderr;
  assert.match(output, /REFUSED: no password supplied/);
  assert.doesNotMatch(output, /ECONNREFUSED|ENOTFOUND|getaddrinfo|connection terminated/i, 'the password check precedes any connection');
});

test('CLI: --dry-run exits 0 with no confirmation and no password', () => {
  const child = spawnSync(process.execPath, ['scripts/smoke-api-role.js', '--dry-run'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: isolatedEnv({ DATABASE_URL: FAKE_SHARED }),
  });
  assert.equal(child.status, 0, 'dry run exits 0 (stderr: ' + child.stderr + ')');
  assert.match(child.stdout, /AUDIT TARGET: db:[0-9a-f]{12}/);
  assert.match(child.stdout, /DRY RUN: would run the API as morocco_pc_api/);
  // The endpoint ID is printed on purpose (every harness names its target that
  // way); the HOST and the credential are what must never appear.
  assert.doesNotMatch(child.stdout, /owner-s3cret|neon\.tech/, 'no credential and no host');
});

test('health is the BODY, not the status code: 200 with db != "ok" is NOT healthy', () => {
  // /v1/health answers 200 during a database outage by design, so the status code
  // alone is exactly the wrong signal - the plan's Review Focus #1.
  assert.equal(healthIsOk(200, { status: 'ok', db: 'ok' }), true, 'the only healthy shape');
  assert.equal(healthIsOk(200, { status: 'ok', db: 'down' }), false, 'a 200 with db=down is an outage');
  assert.equal(healthIsOk(503, { db: 'ok' }), false, 'a non-200 is never healthy');
  assert.equal(healthIsOk(200, null), false);
  assert.equal(healthIsOk(200, {}), false, 'an absent db is UNKNOWN, not ok');
  assert.equal(healthIsOk(200, { db: true }), false, 'only the literal string counts');
});

test('cleanup adopts ONLY a pass this run created, never a dedupe reuse', () => {
  // The reused-pass defect: adopting the response id before checking `reused`
  // made the cleanup delete rows a previous run wrote.
  assert.deepEqual(
    adoptPassForCleanup({ id: 'q1', reused: false }),
    { id: 'q1', reused: false, created: true },
    'a fresh 201 is ours to clean up'
  );
  assert.deepEqual(
    adoptPassForCleanup({ id: 'q1', reused: true }),
    { id: 'q1', reused: true, created: false },
    'a reuse points at someone else\'s pass: adopt nothing'
  );
  assert.deepEqual(adoptPassForCleanup({ reused: false }), { id: null, reused: false, created: false }, 'no id, nothing to adopt');
  assert.deepEqual(adoptPassForCleanup({ id: 'q1' }), { id: 'q1', reused: null, created: false }, 'reused unknown: never adopt');
  assert.deepEqual(adoptPassForCleanup(null), { id: null, reused: null, created: false });
});

test('the schema preflight names what the API code requires, in ONE statement', () => {
  const sql = buildSchemaPreflightSql();
  assert.equal((sql.match(/UNION ALL/g) || []).length, API_SCHEMA_PREREQUISITES.length - 1, 'one round trip, not one query per prerequisite');
  assert.match(sql, /WHERE table_schema = 'public' AND table_name = 'recommendation_query' AND column_name = 'catalog_version'/);
  assert.match(sql, /FROM information_schema\.tables WHERE table_schema = 'public' AND table_name = 'recommendation_preset'/);
  assert.ok(sql.includes("'recommendation_query.catalog_version' AS id"));
  assert.ok(sql.includes("'recommendation_preset' AS id"));
  assert.match(sql, /ORDER BY 1$/, 'the report order is stable');
  assert.deepEqual(
    API_SCHEMA_PREREQUISITES.map((entry) => entry.migration),
    ['021_recommendation_query_catalog_version.sql', '022_recommendation_preset.sql'],
    'a refusal must name the migration that closes it'
  );
});

test('a target behind the API is REFUSED and named, never run', () => {
  const present = (id, n) => ({ id, present: n });
  const all = [present('recommendation_query.catalog_version', 1), present('recommendation_preset', 1)];
  assert.deepEqual(missingSchemaPrerequisites(all), [], 'both present is the only green preflight');

  // The measured 2026-10-17 state of the SHARED database (ledger 020).
  const sharedToday = [present('recommendation_query.catalog_version', 0), present('recommendation_preset', 0)];
  assert.deepEqual(
    missingSchemaPrerequisites(sharedToday),
    [{ id: 'recommendation_query.catalog_version', migration: '021_recommendation_query_catalog_version.sql' },
      { id: 'recommendation_preset', migration: '022_recommendation_preset.sql' }],
    'both halves must be reported, so applying one does not read as done'
  );
  assert.deepEqual(missingSchemaPrerequisites([present('recommendation_query.catalog_version', 1), present('recommendation_preset', 0)])
    .map((m) => m.id), ['recommendation_preset']);
  // An UNANSWERED prerequisite is missing, not present (a dropped row is not a pass).
  assert.deepEqual(missingSchemaPrerequisites([present('recommendation_preset', 1)]).map((m) => m.id), ['recommendation_query.catalog_version']);
  // pg returns `count(*)::int` as a number, but a string '0' must still read as absent.
  assert.equal(missingSchemaPrerequisites([present('recommendation_query.catalog_version', '0'), present('recommendation_preset', '1')]).length, 1);
  assert.throws(() => missingSchemaPrerequisites(null), /requires an array/);
  assert.throws(() => missingSchemaPrerequisites([{ present: 1 }]), /string id/);
});

test('requiring the script runs no smoke test (the require.main guard)', () => {
  const child = spawnSync(
    process.execPath,
    ['-e', 'require("./scripts/smoke-api-role.js"); console.log("LOADED-GUARD-OK");'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: isolatedEnv(),
    }
  );
  assert.equal(child.status, 0, 'require() must exit 0 (stderr: ' + child.stderr + ')');
  assert.match(child.stdout, /LOADED-GUARD-OK/);
});
