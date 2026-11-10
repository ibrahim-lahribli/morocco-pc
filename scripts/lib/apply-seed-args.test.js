'use strict';

// scripts/lib/apply-seed-args.test.js - the seed applier's argv contract and
// named-target guards.
//
// The bug this pins (2026-11-10 review): the release recipe documented
//   node scripts/apply-seed.js <seed> --target-env=TARGET_DATABASE_URL --restore-point=<id>
// and the script refused both flags as unknown arguments, so the EU seed step
// could not run at all. It must now PARSE that invocation and refuse the unsafe
// variants — an unresolvable target, a target equal to shared under any name, a
// write with no restore point — BEFORE any connection exists. This module is
// pure (no pg, no process.env), so every refusal is provable without a database.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  UsageError,
  RESERVED_TARGET_ENVS,
  parseApplySeedArgs,
  resolveApplySeedTarget,
} = require('./apply-seed-args');

const SHARED = 'postgres://u:p@ep-shared-1.neon.tech/neondb';
const EU = 'postgres://u:p@ep-release-9.neon.tech/neondb';
const RESTORE = 'br-cool-star-b9whdnt1';

function env(extra) {
  return Object.assign({ DATABASE_URL: SHARED, TARGET_DATABASE_URL: EU }, extra || {});
}

test('the documented release invocation parses (flags it used to refuse)', () => {
  const args = parseApplySeedArgs([
    'database/seeds/029_scoring_model_launch_v2_decay_off.sql',
    '--target-env=TARGET_DATABASE_URL',
    '--restore-point=' + RESTORE,
  ]);
  assert.equal(args.file, 'database/seeds/029_scoring_model_launch_v2_decay_off.sql');
  assert.equal(args.targetEnv, 'TARGET_DATABASE_URL');
  assert.equal(args.restorePoint, RESTORE);
  assert.equal(args.dryRun, false);
  assert.equal(args.help, false);
});

test('the positional file, --file=, --dry-run and --test-db are all accepted', () => {
  assert.equal(parseApplySeedArgs(['a.sql']).file, 'a.sql');
  assert.equal(parseApplySeedArgs(['--file=b.sql']).file, 'b.sql');
  assert.equal(parseApplySeedArgs(['a.sql', '--dry-run']).dryRun, true);
  assert.equal(parseApplySeedArgs(['a.sql', '--test-db']).testDb, true);
});

test('an unknown flag is a usage error naming the flag', () => {
  assert.throws(() => parseApplySeedArgs(['a.sql', '--commit']), (error) => {
    assert.ok(error instanceof UsageError);
    assert.match(error.message, /UNKNOWN_FLAG:--commit/);
    return true;
  });
});

test('a missing seed file is refused', () => {
  assert.throws(() => parseApplySeedArgs([]), /MISSING_SEED_FILE/);
  assert.throws(() => parseApplySeedArgs(['--dry-run']), /MISSING_SEED_FILE/);
});

test('the equals form is mandatory for --target-env and --restore-point', () => {
  assert.throws(() => parseApplySeedArgs(['a.sql', '--target-env', 'TARGET_DATABASE_URL']),
    /MALFORMED_FLAG:--target-env needs the equals form/);
  assert.throws(() => parseApplySeedArgs(['a.sql', '--restore-point', RESTORE]),
    /MALFORMED_FLAG:--restore-point needs the equals form/);
});

test('a URL on the command line is not a variable name', () => {
  assert.throws(() => parseApplySeedArgs(['a.sql', '--target-env=' + EU]), /BAD_TARGET_ENV/);
  assert.throws(() => parseApplySeedArgs(['a.sql', '--target-env=lower_case']), /BAD_TARGET_ENV/);
});

test('the two default variables cannot be named as a release target', () => {
  for (const name of RESERVED_TARGET_ENVS) {
    assert.equal(RESERVED_TARGET_ENVS.has(name), true);
    assert.throws(() => parseApplySeedArgs(['a.sql', '--target-env=' + name]), /RESERVED_TARGET_ENV/);
  }
  assert.deepEqual([...RESERVED_TARGET_ENVS].sort(), ['DATABASE_URL', 'TEST_DATABASE_URL']);
});

test('a placeholder or malformed restore point fails the shape check on purpose', () => {
  for (const bad of ['<id>', 'short', 'has space here', 'br/with/slash']) {
    assert.throws(() => parseApplySeedArgs(['a.sql', '--target-env=TARGET_DATABASE_URL', '--restore-point=' + bad]),
      /BAD_RESTORE_POINT/, bad);
  }
});

test('conflicting flags are refused rather than resolved by precedence', () => {
  assert.throws(() => parseApplySeedArgs(['a.sql', '--test-db', '--target-env=TARGET_DATABASE_URL']),
    /CONFLICTING_TARGETS/);
  assert.throws(() => parseApplySeedArgs(['a.sql', '--restore-point=' + RESTORE]),
    /RESTORE_POINT_WITHOUT_TARGET/);
});

test('every parse refusal is a UsageError, so the CLI exits 2 having dialled nothing', () => {
  for (const argv of [[], ['a.sql', '--nope'], ['a.sql', '--target-env=x'], ['a.sql', '--restore-point=short']]) {
    try {
      parseApplySeedArgs(argv);
      assert.fail('expected a refusal for ' + JSON.stringify(argv));
    } catch (error) {
      assert.ok(error instanceof UsageError, JSON.stringify(argv));
    }
  }
});

test('a named target resolves to a digest and carries the restore point', () => {
  const target = resolveApplySeedTarget(
    parseApplySeedArgs(['a.sql', '--target-env=TARGET_DATABASE_URL', '--restore-point=' + RESTORE]),
    env(),
  );
  assert.equal(target.connectionString, EU);
  assert.equal(target.nonTest, true);
  assert.equal(target.label, 'TARGET_DATABASE_URL');
  assert.match(target.digest, /^db:[0-9a-f]{12}$/);
  assert.equal(target.restorePoint, RESTORE);
});

test('an unset or empty target variable is refused by name, never dialled', () => {
  const args = parseApplySeedArgs(['a.sql', '--target-env=NOT_SET_ANYWHERE', '--restore-point=' + RESTORE]);
  assert.throws(() => resolveApplySeedTarget(args, env()), /names an unset or empty variable/);
  assert.throws(() => resolveApplySeedTarget(args, env({ NOT_SET_ANYWHERE: '   ' })), /unset or empty/);
});

test('without DATABASE_URL a named target cannot be proven distinct, so it is refused', () => {
  const args = parseApplySeedArgs(['a.sql', '--target-env=TARGET_DATABASE_URL', '--restore-point=' + RESTORE]);
  assert.throws(() => resolveApplySeedTarget(args, { TARGET_DATABASE_URL: EU }),
    /cannot be proven distinct from the shared database/);
});

test('a target that IS the shared database is refused, whatever the variable is called', () => {
  const args = parseApplySeedArgs(['a.sql', '--target-env=TARGET_DATABASE_URL', '--restore-point=' + RESTORE]);
  // Same endpoint under another name.
  assert.throws(() => resolveApplySeedTarget(args, env({ TARGET_DATABASE_URL: SHARED })),
    /it IS the shared database/);
  // The pooled host of the same endpoint is the same database.
  assert.throws(() => resolveApplySeedTarget(args, env({
    TARGET_DATABASE_URL: 'postgres://u:p@ep-shared-1-pooler.neon.tech/neondb',
  })), /it IS the shared database/);
});

test('a WRITE to a named target needs a restore point; a dry run does not', () => {
  const write = parseApplySeedArgs(['a.sql', '--target-env=TARGET_DATABASE_URL']);
  assert.throws(() => resolveApplySeedTarget(write, env()), /needs --restore-point/);

  const dryRun = parseApplySeedArgs(['a.sql', '--target-env=TARGET_DATABASE_URL', '--dry-run']);
  const target = resolveApplySeedTarget(dryRun, env());
  assert.equal(target.nonTest, true);
  assert.equal(target.restorePoint, null);
});

test('without --target-env the TEST-branch guard still decides', () => {
  const args = parseApplySeedArgs(['a.sql']);
  assert.throws(() => resolveApplySeedTarget(args, { DATABASE_URL: SHARED }), /TEST_DATABASE_URL is not set/);
  assert.throws(() => resolveApplySeedTarget(args, { DATABASE_URL: SHARED, TEST_DATABASE_URL: SHARED }),
    /must not target the shared database/);

  const target = resolveApplySeedTarget(args, {
    DATABASE_URL: SHARED,
    TEST_DATABASE_URL: 'postgres://u:p@ep-branch-2.neon.tech/neondb',
  });
  assert.equal(target.nonTest, false);
  assert.equal(target.label, 'TEST_DATABASE_URL (write guard)');
  assert.equal(target.restorePoint, null);
  assert.equal(target.digest, null);
});

test('resolving a target never mutates the caller\'s environment', () => {
  const source = env();
  const snapshot = JSON.stringify(source);
  resolveApplySeedTarget(
    parseApplySeedArgs(['a.sql', '--target-env=TARGET_DATABASE_URL', '--restore-point=' + RESTORE]),
    source,
  );
  assert.equal(JSON.stringify(source), snapshot, 'the module must not assign into env');
});
