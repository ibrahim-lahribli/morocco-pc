'use strict';

// scripts/lib/apply-seed-cli.test.js - the CLI half of `scripts/apply-seed.js`:
// the exact invocation the release recipe documents, and the exit codes of the
// refusals.
//
// No database is touched. Every case below either stops at argument parsing, at
// target resolution, or at `--dry-run` — and the child is spawned with `cwd` in
// the temp directory so dotenv cannot load the checkout's `.env` behind our back
// (an accidental real DATABASE_URL here would turn a refusal test into a
// connection test).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'apply-seed.js');
const SEED = path.join(REPO_ROOT, 'database', 'seeds', '029_scoring_model_launch_v2_decay_off.sql');

const SHARED = 'postgres://u:p@ep-shared-1.neon.tech/neondb';
const EU = 'postgres://u:p@ep-release-9.neon.tech/neondb';
const RESTORE = 'br-cool-star-b9whdnt1';

function isolatedEnv(overrides) {
  const base = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    SystemRoot: process.env.SystemRoot,
    DATABASE_URL: SHARED,
  };
  return Object.assign(base, overrides || {});
}

function run(args, env) {
  return spawnSync(process.execPath, [SCRIPT].concat(args), {
    cwd: os.tmpdir(), // no .env here, so dotenv injects nothing
    encoding: 'utf8',
    env: isolatedEnv(env),
  });
}

function output(child) {
  return child.stdout + child.stderr;
}

test('CLI: the documented EU dry-run prints the resolved target', () => {
  const child = run([SEED, '--target-env=TARGET_DATABASE_URL', '--dry-run'],
    { TARGET_DATABASE_URL: EU });
  const text = output(child);
  assert.equal(child.status, 0, text);
  assert.match(text, /target: TARGET_DATABASE_URL \(db:[0-9a-f]{12}\)/);
  assert.match(text, /DRY RUN: target would be .*nothing connected, nothing applied/);
  assert.doesNotMatch(text, /postgres:\/\/|u:p@/, 'the connection string and its credential are never printed');
  // No restore point was named, so there is nothing to audit. `restore-point=null`
  // in a release log would read like a rollback plan that does not exist.
  assert.doesNotMatch(text, /AUDIT TARGET/);
  assert.doesNotMatch(text, /restore-point=null/);
});

test('CLI: a rehearsal with the real restore point prints the AUDIT line', () => {
  const child = run([SEED, '--target-env=TARGET_DATABASE_URL', '--restore-point=' + RESTORE, '--dry-run'],
    { TARGET_DATABASE_URL: EU });
  const text = output(child);
  assert.equal(child.status, 0, text);
  assert.match(text, new RegExp('AUDIT TARGET: db:[0-9a-f]{12} restore-point=' + RESTORE));
});

test('CLI: the documented EU write shape is refused without a restore point, before dialling', () => {
  const child = run([SEED, '--target-env=TARGET_DATABASE_URL'], { TARGET_DATABASE_URL: EU });
  const text = output(child);
  assert.equal(child.status, 2, text);
  assert.match(text, /needs --restore-point/);
  assert.doesNotMatch(text, /ECONNREFUSED|ENOTFOUND|getaddrinfo|connection terminated|SSL/i, 'nothing dialled a host');
});

test('CLI: a placeholder restore point is refused by shape', () => {
  const child = run([SEED, '--target-env=TARGET_DATABASE_URL', '--restore-point=<id>'],
    { TARGET_DATABASE_URL: EU });
  assert.equal(child.status, 2);
  assert.match(output(child), /BAD_RESTORE_POINT/);
});

test('CLI: an unset target variable is refused by name', () => {
  const child = run([SEED, '--target-env=NOT_SET_ANYWHERE', '--restore-point=' + RESTORE]);
  assert.equal(child.status, 2);
  assert.match(output(child), /NOT_SET_ANYWHERE names an unset or empty variable/);
});

test('CLI: a target that resolves to the shared database is refused', () => {
  const child = run([SEED, '--target-env=TARGET_DATABASE_URL', '--restore-point=' + RESTORE],
    { TARGET_DATABASE_URL: SHARED });
  assert.equal(child.status, 2);
  assert.match(output(child), /it IS the shared database/);
});

test('CLI: the old unknown-flag failure is gone', () => {
  const child = run([SEED, '--target-env=TARGET_DATABASE_URL', '--restore-point=' + RESTORE, '--dry-run'],
    { TARGET_DATABASE_URL: EU });
  assert.doesNotMatch(output(child), /unknown argument/);
  assert.equal(child.status, 0);
});

test('CLI: without --target-env the TEST guard still refuses a missing branch', () => {
  const child = run([SEED], { TEST_DATABASE_URL: '' });
  assert.equal(child.status, 1);
  assert.match(output(child), /TEST_DATABASE_URL is not set/);
});

test('CLI: --help prints usage and exits 0', () => {
  const child = run(['--help']);
  assert.equal(child.status, 0);
  assert.match(output(child), /usage: node scripts\/apply-seed\.js/);
  assert.match(output(child), /--target-env=NAME/);
});
