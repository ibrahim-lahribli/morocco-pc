'use strict';

// scripts/lib/rehearse-api-role-cli.test.js — the DB-free contract of the
// REHEARSAL'S OWN CLI (`scripts/rehearse-api-role.js`).
//
// SCOPE CHANGED 2026-10-17, and that is why the file is shorter than it was: the
// privilege fixture, the GRANT block, the self-check SQL and the connection
// swapping were EXTRACTED into `scripts/lib/api-role.js`, because three scripts
// now share them (this rehearsal, the owner-gated `scripts/apply-api-role.js`
// and `scripts/smoke-api-role.js`). Their contract tests moved with them, to
// `scripts/lib/api-role.test.js`. Duplicating them here would let the two copies
// drift, and a fixture tested twice is not tested more — it is tested once and
// copied once.
//
// What stays here is what only this file can pin: that the rehearsal EXPORTS the
// contract rather than keeping a private copy, that its argument parsing accepts
// exactly the documented forms, and that neither `--help` nor a guard refusal
// reaches a database.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { REHEARSAL_ENGINE_VERSION, parseArgs, removeCreatedRole } = require('../rehearse-api-role');
const { API_ROLE_NAME, PRIVILEGE_EXPECTATIONS } = require('./api-role');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ARGV = ['node', 'scripts/rehearse-api-role.js'];

/** Nothing may reach a database, and dotenv must not refill what is blanked. */
function isolatedEnv(extra) {
  return Object.assign({}, process.env, {
    DATABASE_URL: '',
    TEST_DATABASE_URL: '',
    API_ROLE_PASSWORD: '',
  }, extra || {});
}

test('the rehearsal re-exports the SHARED contract — it owns no private copy', () => {
  const rehearsal = require('../rehearse-api-role');
  // The module deliberately exports only its own CLI surface plus the engine
  // version; the contract itself comes from the one owner. If a consumer ever
  // needs `buildGrantStatements` here again, it should import it from
  // `scripts/lib/api-role.js` instead, so there is exactly one definition.
  assert.deepEqual(
    Object.keys(rehearsal).sort(),
    ['REHEARSAL_ENGINE_VERSION', 'parseArgs', 'removeCreatedRole'],
    'exporting the contract from here would create a second definition of it'
  );
  assert.equal(typeof parseArgs, 'function');
  assert.equal(API_ROLE_NAME, 'morocco_pc_api');
  assert.ok(PRIVILEGE_EXPECTATIONS.length > 0, 'the rehearsal consumes the shared fixture');
});

/** A fake pg client; `failOn` throws for any statement matching its regex. */
function fakeClient(options) {
  const opts = options || {};
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (opts.failOn && opts.failOn.test(sql)) {
        throw Object.assign(new Error('injected failure: ' + sql), { code: 'XX000' });
      }
      if (/FROM pg_roles WHERE rolname = \$1/.test(sql)) {
        return { rows: opts.roleSurvives ? [{ present: 1 }] : [] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
}

test('removeCreatedRole issues NOTHING when this run did not create the role', async () => {
  // The existing-role guard refuses to touch a role someone else created, so the
  // cleanup must keep that promise. Regression: the old `finally` swept and
  // dropped `morocco_pc_api` precisely when the guard had just refused.
  for (const createdByThisRun of [false, undefined, null, 0]) {
    const client = fakeClient();
    const result = await removeCreatedRole(client, 'morocco_pc_api', createdByThisRun);
    assert.equal(client.calls.length, 0, JSON.stringify(createdByThisRun) + ' must issue no statement at all');
    assert.deepEqual(result, { attempted: false, removed: null, failures: [] });
  }
});

test('removeCreatedRole sweeps, drops and then VERIFIES - in that order', async () => {
  const client = fakeClient();
  const result = await removeCreatedRole(client, 'morocco_pc_api', true);

  assert.equal(result.attempted, true);
  assert.equal(result.removed, true);
  assert.deepEqual(result.failures, []);
  assert.ok(client.calls.length >= 6, 'the sweep, the drop and a verification SELECT');
  assert.match(client.calls[0].sql, /^REVOKE ALL ON ALL TABLES/);
  assert.equal(client.calls[client.calls.length - 2].sql, 'DROP ROLE morocco_pc_api');
  assert.equal(client.calls[client.calls.length - 1].sql, 'SELECT 1 FROM pg_roles WHERE rolname = $1');
});

test('removeCreatedRole reports a failed DROP and a role that SURVIVED, rather than assuming either', async () => {
  const dropFailed = fakeClient({ failOn: /^DROP ROLE/ });
  const failed = await removeCreatedRole(dropFailed, 'morocco_pc_api', true);
  assert.equal(failed.removed, true, 'the verification SELECT is what decides, not the DROP error');
  assert.equal(failed.failures.length, 1);
  assert.match(failed.failures[0], /^DROP ROLE morocco_pc_api :: /);

  const survived = await removeCreatedRole(fakeClient({ roleSurvives: true }), 'morocco_pc_api', true);
  assert.equal(survived.removed, false);
  assert.deepEqual(survived.failures, []);
});

test('CLI: defaults, the `=` forms, and --test-db accepted for symmetry', () => {
  const args = parseArgs(ARGV);
  assert.equal(args.budget, 20000);
  assert.equal(args.useCase, 'GAMING');
  assert.equal(REHEARSAL_ENGINE_VERSION, 'rehearse-api-role', 'the rows it writes name THIS tool, never a deploy');

  const flagged = parseArgs(ARGV.concat(['--budget=12000', '--use-case=OFFICE', '--test-db']));
  assert.equal(flagged.budget, 12000);
  assert.equal(flagged.useCase, 'OFFICE');
  assert.equal(parseArgs(ARGV.concat(['--use-case=WORKSTATION'])).useCase, 'WORKSTATION');
  // `--test-db` is a no-op here: this script is ALWAYS the TEST branch, and it is
  // accepted so the documented invocation reads the same as the other harnesses.
  assert.deepEqual(parseArgs(ARGV.concat(['--test-db'])), parseArgs(ARGV));
});

test('CLI: every malformed form is a usage error, and none of them connects', () => {
  const usage = [
    ['--budget', '12000'],
    ['--budget=0'],
    ['--budget=abc'],
    ['--use-case='],
    ['--nope=1'],
  ];
  for (const extra of usage) {
    assert.throws(() => parseArgs(ARGV.concat(extra)), (error) => error.usage === true, extra.join(' ') + ' must be a usage error');
  }
  // The nearest good value still parses (the list above refuses malformed forms,
  // not everything that starts with --).
  assert.equal(parseArgs(ARGV.concat(['--budget=1'])).budget, 1);
});

test('--help prints the usage, exits 2 and touches no database', () => {
  const child = spawnSync(process.execPath, ['scripts/rehearse-api-role.js', '--help'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  assert.equal(child.status, 2, 'usage exits 2 (the split generate-presets.js uses), not 1');
  const output = child.stdout + child.stderr;
  assert.match(output, /usage: node scripts\/rehearse-api-role\.js/);
  assert.match(output, /morocco_pc_api/);
  assert.doesNotMatch(output, /at main|at parseArgs|Node\.js v/, 'a usage problem prints no stack trace');
});

test('a missing TEST_DATABASE_URL is refused by the guard, not attempted', () => {
  const child = spawnSync(process.execPath, ['scripts/rehearse-api-role.js'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  assert.equal(child.status, 1, 'a guard refusal is a run failure, not a usage error');
  assert.match(child.stdout + child.stderr, /TEST_DATABASE_URL is not set/);
});

test('requiring the script does not create a role (the require.main guard)', () => {
  const child = spawnSync(
    process.execPath,
    ['-e', 'require("./scripts/rehearse-api-role.js"); console.log("LOADED-GUARD-OK");'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: isolatedEnv(),
    }
  );
  assert.equal(child.status, 0, 'require() must exit 0 (stderr: ' + child.stderr + ')');
  assert.match(child.stdout, /LOADED-GUARD-OK/);
});
