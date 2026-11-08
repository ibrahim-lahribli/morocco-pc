'use strict';

/**
 * scripts/lib/offer-coverage-cli.test.js - the CLI half of
 * `check-offer-coverage.js`: argument handling and the exit codes.
 *
 * No database is touched: every spawned case below fails or finishes BEFORE a
 * connection is attempted, which is why an isolated env is enough. The report
 * wording itself is pinned in offer-coverage.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { USAGE, parseArgs } = require('../check-offer-coverage');
const { VERDICTS, exitCodeFor } = require('./offer-coverage');

const REPO_ROOT = path.join(__dirname, '..', '..');

/** A clean env: dotenv is not read here, so DATABASE_URL must not leak in. */
function isolatedEnv(overrides) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, SystemRoot: process.env.SystemRoot };
  return Object.assign(env, overrides || {});
}

function run(args, env) {
  return spawnSync(process.execPath, ['scripts/check-offer-coverage.js'].concat(args), {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: isolatedEnv(env),
  });
}

test('the defaults are the shared variable, 5 products, 2 stores and MAD', () => {
  const options = parseArgs([]);
  assert.equal(options.targetEnv, 'DATABASE_URL');
  assert.equal(options.minProducts, 5);
  assert.equal(options.minStores, 2);
  assert.equal(options.currency, 'MAD');
  assert.equal(options.strict, false);
});

test('the equals form is mandatory and values are validated', () => {
  assert.equal(parseArgs(['--target=env:TARGET_DATABASE_URL']).targetEnv, 'TARGET_DATABASE_URL');
  assert.equal(parseArgs(['--min-products=0']).minProducts, 0);
  assert.equal(parseArgs(['--min-stores=3']).minStores, 3);
  assert.equal(parseArgs(['--currency=mad']).currency, 'MAD');
  assert.equal(parseArgs(['--strict']).strict, true);

  for (const bad of [
    '--target=postgres://u:p@ep-x.neon.tech/neondb',
    '--target=env:',
    '--target=env:lower_case',
    '--min-products=-1',
    '--min-products=x',
    '--min-stores=1.5',
    '--currency=MA',
    '--nope',
  ]) {
    assert.throws(() => parseArgs([bad]), (error) => error.usage === true, bad + ' must be a usage error');
  }
  // The space form leaves the value as an unknown argument: a usage error, never
  // a silent fallback to the shared database.
  assert.throws(() => parseArgs(['--target', 'env:X']), (error) => error.usage === true);
});

test('CLI: --help and an unknown flag exit 2', () => {
  const help = run(['--help']);
  assert.equal(help.status, 2);
  assert.match(help.stdout + help.stderr, /usage: node scripts\/check-offer-coverage\.js/);

  const unknown = run(['--nope']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stdout + unknown.stderr, /unknown argument: --nope/);
  assert.match(USAGE, /Read-only/);
  assert.match(USAGE, /--strict/);
  assert.match(USAGE, /never waived for a VERIFIED offer/);
});

test('CLI: an unset target variable exits 1 BEFORE connecting', () => {
  const child = run(['--target=env:NOT_SET_ANYWHERE']);
  assert.equal(child.status, 1);
  const output = child.stdout + child.stderr;
  assert.match(output, /NOT_SET_ANYWHERE is not set/);
  assert.doesNotMatch(output, /ECONNREFUSED|ENOTFOUND|getaddrinfo|connection terminated/i, 'nothing dialled a host');
});

test('--strict escalates FAIL only', () => {
  const pass = { verdict: VERDICTS.PASS };
  const fail = { verdict: VERDICTS.FAIL };
  const inconclusive = { verdict: VERDICTS.INCONCLUSIVE };
  assert.equal(exitCodeFor(pass, { strict: true }), 0);
  assert.equal(exitCodeFor(inconclusive, { strict: true }), 0);
  assert.equal(exitCodeFor(fail, { strict: true }), 1);
  assert.equal(exitCodeFor(fail, { strict: false }), 0);
  assert.equal(exitCodeFor(fail), 0);
});
