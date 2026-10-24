'use strict';

/**
 * scripts/lib/deployed-role-cli.test.js - the CLI half of
 * `check-deployed-role.js`: the argument contract, the verdict -> exit-code
 * mapping, and the promise that a connection string never reaches the output.
 *
 * No database is contacted. `main()` takes an injectable `createClient`, so the
 * exit codes are driven from fixtures; the one subprocess case exists to prove
 * an unset target variable fails BEFORE anything dials.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  CHECKER_APPLICATION_NAME,
  DATABASE_SQL,
  DEFAULT_APP_TAG,
  DEFAULT_TARGET_ENV,
  SESSIONS_SQL,
  USAGE,
  defaultClientConfig,
  main,
  parseArgs,
} = require('../check-deployed-role');
const apiRole = require('./api-role');
const apiDb = require('../../apps/api/src/db');

const REPO_ROOT = path.join(__dirname, '..', '..');
const TARGET = 'DEPLOYED_ROLE_TEST_URL';

/** A clean env: dotenv is not read here, so DATABASE_URL must not leak in. */
function isolatedEnv(overrides) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, SystemRoot: process.env.SystemRoot };
  return Object.assign(env, overrides || {});
}

/**
 * A client stub. `sessions` is the pg_stat_activity fixture; `fail` makes the
 * connect or the activity read throw.
 */
function fakeClient(options) {
  const settings = options || {};
  const calls = { connect: 0, query: 0, end: 0 };
  return {
    calls,
    configs: [],
    client: {
      async connect() {
        calls.connect += 1;
        if (settings.connectError) throw settings.connectError;
      },
      async query(sql) {
        calls.query += 1;
        if (sql === DATABASE_SQL) {
          if (settings.databaseError) throw settings.databaseError;
          return { rows: [{ database: settings.database || 'neondb' }] };
        }
        if (sql === SESSIONS_SQL) return { rows: settings.sessions || [] };
        throw new Error('unexpected SQL in the stub: ' + sql);
      },
      async end() {
        calls.end += 1;
      },
    },
  };
}

/** Run main() with a stub client and captured output. */
async function run(args, options) {
  const settings = options || {};
  const fake = fakeClient(settings);
  const lines = [];
  const errors = [];
  const previous = process.env[TARGET];
  process.env[TARGET] = settings.url === undefined ? 'postgres://owner:secret@ep-x.neon.tech/neondb' : settings.url;
  try {
    const code = await main(args, {
      createClient: (config) => {
        fake.created = (fake.created || 0) + 1;
        fake.configs.push(config);
        return fake.client;
      },
      log: (line) => lines.push(line),
      logError: (line) => errors.push(line),
      now: () => new Date('2026-10-23T12:00:00Z'),
    });
    return { code, fake, stdout: lines.join('\n'), stderr: errors.join('\n') };
  } finally {
    if (previous === undefined) delete process.env[TARGET];
    else process.env[TARGET] = previous;
  }
}

test('the defaults are the API\'s OWN application_name and the role\'s OWN name', () => {
  assert.equal(DEFAULT_APP_TAG, apiDb.APPLICATION_NAME,
    'the check must look for the tag apps/api/src/db.js actually sets');
  assert.equal(parseArgs([]).roleName, apiRole.API_ROLE_NAME);
  assert.equal(parseArgs([]).targetEnv, DEFAULT_TARGET_ENV);
  assert.equal(DEFAULT_TARGET_ENV, 'DATABASE_URL', 'the repo-wide default target variable');
  assert.notEqual(CHECKER_APPLICATION_NAME, DEFAULT_APP_TAG,
    'the checker must not tag itself as the app it is looking for');
});

test('the read uses the DIRECT endpoint, so it cannot relabel the app\'s session', async () => {
  // Measured 2026-10-23: a pooled run of this check reused the app's server
  // connection and overwrote its application_name, then reported INCONCLUSIVE -
  // it hid the evidence it had just relabelled. Reading direct gives the check
  // its own backend and leaves the observed sessions untouched.
  const pooled = 'postgresql://owner:pw@ep-x-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require';
  const config = defaultClientConfig(pooled);
  assert.ok(!config.connectionString.includes('-pooler'), 'the client must not dial the pooler');
  assert.match(config.connectionString, /@ep-x\.us-east-1\.aws\.neon\.tech/);
  assert.equal(config.application_name, CHECKER_APPLICATION_NAME);

  const result = await run(['--target=env:' + TARGET], { url: pooled, sessions: [] });
  assert.equal(result.fake.configs.length, 1);
  assert.ok(!result.fake.configs[0].connectionString.includes('-pooler'),
    'main() must not read through the pooler either');
});

test('--target takes a variable NAME, and every flag needs the equals form', () => {
  assert.equal(parseArgs(['--target=env:TARGET_DATABASE_URL']).targetEnv, 'TARGET_DATABASE_URL');
  assert.equal(parseArgs(['--app=another-api']).appTag, 'another-api');
  assert.equal(parseArgs(['--role=some_role']).roleName, 'some_role');

  for (const bad of [
    ['--target=postgres://u:p@ep-x.neon.tech/neondb'],
    ['--target=env:'],
    ['--target=env:lower_case'],
    ['--app='],
    ['--app= padded'],
    ['--app=' + 'x'.repeat(64)],
    ['--role=Bad-Role'],
    ['--role='],
    ['--nope'],
    ['--target', 'env:X'],
  ]) {
    assert.throws(() => parseArgs(bad), (error) => error.usage === true, JSON.stringify(bad) + ' must be a usage error');
  }
});

test('CLI: --help exits 2 and states the three-valued verdict', () => {
  const child = spawnSync(process.execPath, ['scripts/check-deployed-role.js', '--help'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  assert.equal(child.status, 2);
  const output = child.stdout + child.stderr;
  assert.match(output, /usage: node scripts\/check-deployed-role\.js/);
  assert.match(output, /INCONCLUSIVE = no app session was observed, which is NOT a pass/);
  assert.match(output, /deploy-eu-colocation\.md section 8\.5/);
  assert.match(USAGE, /morocco_pc_api/);
});

test('CLI: an unset target variable exits 1 BEFORE a client is created', () => {
  const child = spawnSync(process.execPath, ['scripts/check-deployed-role.js', '--target=env:NOT_SET_ANYWHERE'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  assert.equal(child.status, 1);
  const output = child.stdout + child.stderr;
  assert.match(output, /NOT_SET_ANYWHERE is not set/);
  assert.doesNotMatch(output, /ECONNREFUSED|ENOTFOUND|getaddrinfo|connection terminated/i, 'nothing dialled a host');
});

test('the verdict decides the exit code: PASS 0, INCONCLUSIVE 0, FAIL 1', async () => {
  const passing = await run(['--target=env:' + TARGET], {
    sessions: [{ usename: 'morocco_pc_api', application_name: DEFAULT_APP_TAG, connections: 2 }],
  });
  assert.equal(passing.code, 0);
  assert.match(passing.stdout, /RESULT: PASS/);
  assert.equal(passing.fake.calls.end, 1, 'the client is always closed');

  const inconclusive = await run(['--target=env:' + TARGET], { sessions: [] });
  assert.equal(inconclusive.code, 0, 'INCONCLUSIVE exits 0 like the other evidence gates...');
  assert.match(inconclusive.stdout, /RESULT: INCONCLUSIVE/);
  assert.match(inconclusive.stdout, /NOT a pass/, '...but it must never read as one');

  const failing = await run(['--target=env:' + TARGET], {
    sessions: [{ usename: 'neondb_owner', application_name: DEFAULT_APP_TAG, connections: 1 }],
  });
  assert.equal(failing.code, 1);
  assert.match(failing.stdout, /RESULT: FAIL/);
  assert.match(failing.stdout, /neondb_owner \(1 connection\)/);
});

test('a read that cannot complete exits 1 with the error and still closes the client', async () => {
  const unreadable = await run(['--target=env:' + TARGET], { databaseError: new Error('permission denied for pg_stat_activity') });
  assert.equal(unreadable.code, 1);
  assert.match(unreadable.stderr, /ERROR: permission denied for pg_stat_activity/);
  assert.doesNotMatch(unreadable.stderr, /at main|node:internal/);
  assert.equal(unreadable.fake.calls.end, 1);
});

test('the connection string never reaches stdout or stderr', async () => {
  const secret = 'postgres://owner:sup3rsecret@ep-x.neon.tech/neondb?sslmode=require';
  for (const sessions of [
    [{ usename: 'morocco_pc_api', application_name: DEFAULT_APP_TAG, connections: 1 }],
    [],
    [{ usename: 'neondb_owner', application_name: DEFAULT_APP_TAG, connections: 1 }],
  ]) {
    const result = await run(['--target=env:' + TARGET], { url: secret, sessions });
    const output = result.stdout + result.stderr;
    assert.doesNotMatch(output, /sup3rsecret/);
    assert.doesNotMatch(output, /ep-x\.neon\.tech/);
    assert.match(output, /Target: env:DEPLOYED_ROLE_TEST_URL/, 'the variable NAME is the target, never the URL');
  }
});
