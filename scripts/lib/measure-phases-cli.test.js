'use strict';

// scripts/lib/measure-phases-cli.test.js — the DB-free contract of
// `scripts/measure-api-pass-phases.js`: its argument parsing and the scoring
// model it MEASURES.
//
// Why this file exists: that harness writes real Layer 4 rows on the TEST
// branch, so its CLI contract cannot be checked by running it. The script
// exports `parseArgs` behind a `require.main === module` guard for exactly this
// (`npm run test:scripts` globs `scripts/lib/*.test.js`), and the last test here
// pins that guard — a `require()` must never start a pass.
//
// The pin itself is `scripts/lib/model-pin.js`, whose own suite covers the
// selection semantics (active-only, ambiguous, inactive, unmatched). What is
// pinned HERE is the wiring into this harness, which is what makes a before/
// after across two databases comparable instead of "whichever was active".

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { parseArgs } = require('../measure-api-pass-phases');
const modelPin = require('./model-pin');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ARGV = ['node', 'scripts/measure-api-pass-phases.js'];
// Deterministic on purpose: the real environment (and .env, which the script
// loads) must not decide what a precedence test observes.
const NO_ENV = {};
const ENV_PIN = { [modelPin.MODEL_PIN_ENV]: 'launch-v2@1.0.0' };

test('defaults: 20000 MAD, GAMING, and the shared legacy default pin', () => {
  const args = parseArgs(ARGV, NO_ENV);
  assert.equal(args.budget, 20000);
  assert.equal(args.useCase, 'GAMING');
  assert.equal(args.modelPin, modelPin.DEFAULT_MODEL_PIN, 'an unpinned run must still name a model');
});

test('carries budget, use case and pin in their `=` forms', () => {
  const args = parseArgs(
    ARGV.concat(['--budget=15000', '--use-case=OFFICE', '--model=launch-v2@1.0.0']),
    NO_ENV
  );
  assert.equal(args.budget, 15000);
  assert.equal(args.useCase, 'OFFICE');
  assert.equal(args.modelPin, 'launch-v2@1.0.0');
});

test('pin precedence is flag > SCORING_MODEL_PIN > default, and a blank flag shadows nothing', () => {
  assert.equal(
    parseArgs(ARGV, ENV_PIN).modelPin,
    'launch-v2@1.0.0',
    'the environment pin applies when no flag is given'
  );
  assert.equal(
    parseArgs(ARGV.concat(['--model=seed-minimal-v1@1.0.0']), ENV_PIN).modelPin,
    'seed-minimal-v1@1.0.0',
    'an explicit flag beats the environment'
  );
  assert.equal(
    parseArgs(ARGV.concat(['--model=']), ENV_PIN).modelPin,
    'launch-v2@1.0.0',
    'a blank flag does not shadow the next level down (model-pin.js semantics)'
  );
  assert.equal(parseArgs(ARGV, NO_ENV).modelPin, modelPin.DEFAULT_MODEL_PIN);
});

test('a malformed pin is refused before anything connects', () => {
  assert.throws(() => parseArgs(ARGV.concat(['--model=no-at-sign']), NO_ENV), /name@version|malformed/);
  assert.throws(() => parseArgs(ARGV.concat(['--model=launch-v2@1@2']), NO_ENV), /malformed/);
});

test('a repeated --model is refused rather than silently taking the last one', () => {
  assert.throws(
    () => parseArgs(ARGV.concat(['--model=launch-v2@1.0.0', '--model=seed-minimal-v1@1.0.0']), NO_ENV),
    /more than once/
  );
});

test('the space form and unknown flags are refused', () => {
  assert.throws(() => parseArgs(ARGV.concat(['--budget', '15000']), NO_ENV), /unknown argument: --budget/);
  assert.throws(() => parseArgs(ARGV.concat(['--model', 'launch-v2@1.0.0']), NO_ENV), /unknown argument: --model/);
  assert.throws(() => parseArgs(ARGV.concat(['--nope=1']), NO_ENV), /unknown argument: --nope=1/);
});

test('a non-positive or non-numeric budget is refused', () => {
  assert.throws(() => parseArgs(ARGV.concat(['--budget=0']), NO_ENV), /positive finite/);
  assert.throws(() => parseArgs(ARGV.concat(['--budget=abc']), NO_ENV), /positive finite/);
});

test('--use-case is carried verbatim', () => {
  assert.equal(parseArgs(ARGV.concat(['--use-case=WORKSTATION']), NO_ENV).useCase, 'WORKSTATION');
});

test('--help throws the usage text before any flag is read', () => {
  assert.throws(
    () => parseArgs(ARGV.concat(['--help']), NO_ENV),
    /usage: node scripts\/measure-api-pass-phases\.js/
  );
  // It wins over an otherwise-valid flag set: the preflight runs before the loop.
  assert.throws(() => parseArgs(ARGV.concat(['--budget=15000', '--help']), NO_ENV), /usage:/);
});

test('--help prints the usage without a stack trace, and exits non-zero', () => {
  const child = spawnSync(
    process.execPath,
    ['scripts/measure-api-pass-phases.js', '--help'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { TEST_DATABASE_URL: '' }),
    }
  );
  assert.equal(child.status, 1, 'a usage request is a non-zero no-op');
  const output = child.stdout + child.stderr;
  assert.match(output, /usage: node scripts\/measure-api-pass-phases\.js/);
  assert.doesNotMatch(output, /at parseArgs|at main|Node\.js v/);
});

test('requiring the script does not start a pass (the require.main guard)', () => {
  const child = spawnSync(
    process.execPath,
    ['-e', 'require("./scripts/measure-api-pass-phases.js"); console.log("LOADED-GUARD-OK");'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      // Blanked deliberately: if main() ran, it would demand a TEST_DATABASE_URL
      // and exit non-zero. dotenv.config() does not override an already-set var.
      env: Object.assign({}, process.env, { TEST_DATABASE_URL: '' }),
    }
  );
  assert.equal(child.status, 0, 'require() must exit 0 (stderr: ' + child.stderr + ')');
  assert.match(child.stdout, /LOADED-GUARD-OK/);
});
