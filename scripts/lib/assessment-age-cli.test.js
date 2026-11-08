'use strict';

/**
 * scripts/lib/assessment-age-cli.test.js — the CLI half of
 * `check-assessment-age.js`: argument handling and exit codes.
 *
 * No database is touched: every spawned case fails or finishes BEFORE a
 * connection is attempted, so an isolated env is enough. The report wording is
 * pinned in assessment-age.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { AGE_ROWS_SQL, USAGE, parseArgs } = require('../check-assessment-age');

const REPO_ROOT = path.join(__dirname, '..', '..');

function isolatedEnv(overrides) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, SystemRoot: process.env.SystemRoot };
  return Object.assign(env, overrides || {});
}

function run(args, env) {
  return spawnSync(process.execPath, ['scripts/check-assessment-age.js'].concat(args), {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: isolatedEnv(env),
  });
}

test('the defaults are the shared variable, 90/180 days and the 10 oldest rows', () => {
  const options = parseArgs([]);
  assert.equal(options.targetEnv, 'DATABASE_URL');
  assert.equal(options.dueDays, 90);
  assert.equal(options.overdueDays, 180);
  assert.equal(options.oldest, 10);
  assert.equal(options.strict, false);
});

test('the equals form is mandatory and values are validated', () => {
  assert.equal(parseArgs(['--target=env:TARGET_DATABASE_URL']).targetEnv, 'TARGET_DATABASE_URL');
  assert.equal(parseArgs(['--due-days=120']).dueDays, 120);
  assert.equal(parseArgs(['--overdue-days=0']).overdueDays, 0);
  assert.equal(parseArgs(['--oldest=3']).oldest, 3);
  assert.equal(parseArgs(['--strict']).strict, true);

  for (const bad of [
    '--target=postgres://u:p@ep-x.neon.tech/neondb',
    '--target=env:',
    '--due-days=-1',
    '--overdue-days=x',
    '--oldest=1.5',
    '--nope',
  ]) {
    assert.throws(() => parseArgs([bad]), (error) => error.usage === true, bad + ' must be a usage error');
  }
  assert.throws(() => parseArgs(['--due-days', '90']), (error) => error.usage === true);
});

test('CLI: --help, an unknown flag and an inverted band all exit 2', () => {
  const help = run(['--help']);
  assert.equal(help.status, 2);
  assert.match(help.stdout + help.stderr, /usage: node scripts\/check-assessment-age\.js/);

  const unknown = run(['--nope']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stdout + unknown.stderr, /unknown argument: --nope/);

  const inverted = run(['--due-days=180', '--overdue-days=90']);
  assert.equal(inverted.status, 2);
  assert.match(inverted.stdout + inverted.stderr, /--overdue-days must be >= --due-days/);

  assert.match(USAGE, /Read-only/);
  assert.match(USAGE, /--strict/);
  assert.match(USAGE, /never about whether a score is still true/);
});

test('CLI: an unset target variable exits 1 BEFORE connecting', () => {
  const child = run(['--target=env:NOT_SET_ANYWHERE']);
  assert.equal(child.status, 1);
  const output = child.stdout + child.stderr;
  assert.match(output, /NOT_SET_ANYWHERE is not set/);
  assert.doesNotMatch(output, /ECONNREFUSED|ENOTFOUND|getaddrinfo|connection terminated/i, 'nothing dialled a host');
});

test('the one query is a SELECT over component_assessment joined to product', () => {
  assert.match(AGE_ROWS_SQL, /^SELECT /);
  assert.match(AGE_ROWS_SQL, /FROM component_assessment a/);
  assert.match(AGE_ROWS_SQL, /JOIN product p ON p\.id = a\.product_id/);
  assert.match(AGE_ROWS_SQL, /ORDER BY a\.assessed_at ASC, a\.id ASC/);
  assert.doesNotMatch(AGE_ROWS_SQL, /INSERT|UPDATE|DELETE|BEGIN|COMMIT/i, 'read-only');
});
