'use strict';

// scripts/lib/generate-presets-cli.test.js — the DB-free contract of
// `scripts/generate-presets.js` (Platform P1 Sprint 6 / Decision 48).
//
// Why this file exists: a `--commit` run WRITES Layer 4 rows and runs a real
// engine pass per key, so its command-line contract cannot be checked by running
// it. The script exports `parseArgs`, `budgetRibbon` and `USAGE` behind a
// `require.main === module` guard for exactly this (`npm run test:scripts` globs
// `scripts/lib/*.test.js`), and the last test here pins that guard — a
// `require()` must never start a pass.
//
// Two things this pins that a live run cannot. First, the MODE rules: `--dry-run`
// is the default and the three modes are mutually exclusive, so a command line
// carrying both `--dry-run` and `--commit` is refused rather than read as a
// committed ribbon. Second, the EXIT CODES, which are part of the interface: 2
// for a usage problem (including `--help`) and 1 when the run itself fails. Those
// are asserted by SPAWNING, because a `throw` cannot tell you what the process
// exits with.
//
// The pin itself is `scripts/lib/model-pin.js`, whose own suite covers the
// selection semantics. What is pinned HERE is the wiring: a generation run must
// name the model it is FOR, or two runs would be compared without knowing they
// used the same one.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { parseArgs, budgetRibbon, USAGE } = require('../../scripts/generate-presets');
const modelPin = require('./model-pin');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ARGV = ['node', 'scripts/generate-presets.js'];
// Deterministic on purpose: the real environment (and .env, which the script
// loads) must not decide what a precedence test observes.
const NO_ENV = {};

test('defaults: the plan\'s ribbon, MAD, the legacy default pin, and DRY-RUN', () => {
  const args = parseArgs(ARGV, NO_ENV);
  assert.equal(args.mode, 'dry-run', 'nothing is written unless --commit is asked for');
  assert.deepEqual(
    budgetRibbon(args.budgetFrom, args.budgetTo, args.step).slice(0, 3),
    [6000, 8000, 10000],
    'the ribbon starts at 6000 in 2000 steps'
  );
  assert.equal(budgetRibbon(args.budgetFrom, args.budgetTo, args.step).length, 18, '6k to 40k inclusive');
  assert.equal(args.currency, 'MAD');
  assert.deepEqual(args.useCases, [], 'no --use-case means the ACTIVE model\'s whole vocabulary');
  assert.equal(args.modelPin, modelPin.DEFAULT_MODEL_PIN, 'an unpinned run must still name a model');
  assert.equal(args.cleanupVersion, null);
});

test('carries the ribbon, currency, use cases and pin in their `=` forms', () => {
  const args = parseArgs(ARGV.concat([
    '--budget-from=10000', '--budget-to=14000', '--step=2000',
    '--currency=MAD', '--use-case=GAMING', '--use-case=OFFICE',
    '--model=launch-v2@1.0.0',
  ]), NO_ENV);
  assert.equal(args.budgetFrom, 10000);
  assert.equal(args.budgetTo, 14000);
  assert.deepEqual(budgetRibbon(args.budgetFrom, args.budgetTo, args.step), [10000, 12000, 14000]);
  assert.deepEqual(args.useCases, ['GAMING', 'OFFICE'], '--use-case repeats rather than overwriting');
  assert.equal(args.modelPin, 'launch-v2@1.0.0');
});

test('the three modes are MUTUALLY EXCLUSIVE, not last-wins', () => {
  assert.equal(parseArgs(ARGV.concat(['--commit']), NO_ENV).mode, 'commit');
  assert.equal(parseArgs(ARGV.concat(['--dry-run']), NO_ENV).mode, 'dry-run');
  assert.equal(parseArgs(ARGV.concat(['--cleanup']), NO_ENV).mode, 'cleanup');
  assert.equal(parseArgs(ARGV.concat(['--cleanup=abc']), NO_ENV).cleanupVersion, 'abc');

  // The refusal matters most for --dry-run + --commit: honouring the later flag
  // would turn an intended dry run into a committed ribbon.
  assert.throws(() => parseArgs(ARGV.concat(['--dry-run', '--commit']), NO_ENV), /mutually exclusive/);
  assert.throws(() => parseArgs(ARGV.concat(['--commit', '--cleanup']), NO_ENV), /mutually exclusive/);
  // The same mode twice is not a conflict.
  assert.equal(parseArgs(ARGV.concat(['--commit', '--commit']), NO_ENV).mode, 'commit');
});

test('a cleanup run takes no ribbon: it is a maintenance mode, not a generation run', () => {
  const args = parseArgs(ARGV.concat(['--cleanup', '--use-case=GAMING', '--budget-from=1']), NO_ENV);
  assert.equal(args.mode, 'cleanup');
  assert.deepEqual(args.useCases, [], 'the collected use cases are dropped rather than silently scoping a delete');
});

test('a malformed ribbon is refused rather than silently empty', () => {
  assert.throws(() => parseArgs(ARGV.concat(['--budget-from=10000', '--budget-to=8000']), NO_ENV), /at or above/);
  assert.throws(() => parseArgs(ARGV.concat(['--step=0']), NO_ENV), /positive finite/);
  assert.throws(() => parseArgs(ARGV.concat(['--budget-from=abc']), NO_ENV), /positive finite/);
  assert.throws(() => parseArgs(ARGV.concat(['--cleanup=']), NO_ENV), /needs a catalog version/);
  assert.throws(() => parseArgs(ARGV.concat(['--use-case=']), NO_ENV), /needs a use case/);
});

test('the space form and unknown flags are refused', () => {
  assert.throws(() => parseArgs(ARGV.concat(['--budget-from', '6000']), NO_ENV), /unknown argument: --budget-from/);
  assert.throws(() => parseArgs(ARGV.concat(['--model', 'launch-v2@1.0.0']), NO_ENV), /unknown argument: --model/);
  assert.throws(() => parseArgs(ARGV.concat(['--budget=15000']), NO_ENV), /unknown argument: --budget=15000/);
});

test('the pin reaches the run, and a malformed or repeated one is refused', () => {
  const ENV_PIN = { [modelPin.MODEL_PIN_ENV]: 'launch-v2@1.0.0' };
  assert.equal(parseArgs(ARGV, ENV_PIN).modelPin, 'launch-v2@1.0.0', 'the environment pin applies');
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
  assert.throws(() => parseArgs(ARGV.concat(['--model=no-at-sign']), NO_ENV), /name@version|malformed/);
  assert.throws(
    () => parseArgs(ARGV.concat(['--model=launch-v2@1.0.0', '--model=seed-minimal-v1@1.0.0']), NO_ENV),
    /more than once/
  );
});

test('--help throws the usage text before any flag is read', () => {
  assert.throws(() => parseArgs(ARGV.concat(['--help']), NO_ENV), /usage: node scripts\/generate-presets\.js/);
  // It wins over an otherwise-valid flag set: the preflight runs before the loop.
  assert.throws(() => parseArgs(ARGV.concat(['--commit', '--help']), NO_ENV), /usage:/);
  assert.match(USAGE, /--dry-run\|--commit\|--cleanup/);
});

/** Spawn the CLI with a blanked TEST_DATABASE_URL, so a run cannot reach a database. */
function spawnCli(args) {
  return spawnSync(process.execPath, ['scripts/generate-presets.js'].concat(args), {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { TEST_DATABASE_URL: '' }),
  });
}

test('a usage problem exits 2 with the usage text and no stack trace', () => {
  for (const args of [['--help'], ['--budget=15000'], ['--dry-run', '--commit'], ['--model=no-at-sign']]) {
    const child = spawnCli(args);
    assert.equal(child.status, 2, args.join(' ') + ' must be a usage problem, not a run failure');
    const output = child.stdout + child.stderr;
    assert.doesNotMatch(output, /at parseArgs|at main|Node\.js v/, 'a usage problem prints no stack');
  }
  // The usage text itself, once, from --help.
  assert.match(spawnCli(['--help']).stderr, /usage: node scripts\/generate-presets\.js/);
});

test('a rollout flag is refused by name, and never looks like a successful dry run', () => {
  // The most dangerous class of typo here: a flag that WOULD have generated
  // something is refused rather than ignored, so a mistyped run cannot report
  // "0 generated" and be read as "nothing to do".
  const child = spawnCli(['--budget=15000']);
  assert.equal(child.status, 2);
  assert.match(child.stderr, /unknown argument: --budget=15000/);
});

test('requiring the script does not start a run (the require.main guard)', () => {
  const child = spawnSync(
    process.execPath,
    ['-e', 'require("./scripts/generate-presets.js"); console.log("LOADED-GUARD-OK");'],
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
