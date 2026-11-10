'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  RESERVED_TARGET_ENVS,
  UsageError,
  auditTargetLine,
  guardSharedCommit,
  parseIngestArgs,
  resolveIngestTarget,
  targetLine,
} = require('./ingest-args');

const SHARED = 'postgres://u:p@ep-shared-1.eu-central-1.aws.neon.tech/neondb?sslmode=require';
const SHARED_POOLED = 'postgres://u:p@ep-shared-1-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';
const TEST = 'postgres://u:p@ep-test-1.eu-central-1.aws.neon.tech/neondb_test?sslmode=require';
const EU = 'postgres://u:p@ep-eu-1.eu-central-1.aws.neon.tech/neondb?sslmode=require';
const EU_POOLED = 'postgres://u:p@ep-eu-1-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';

const RESTORE_POINT = 'br-cool-star-b9whdnt1';

function env(overrides) {
  return Object.assign({ DATABASE_URL: SHARED, TEST_DATABASE_URL: TEST, TARGET_DATABASE_URL: EU }, overrides || {});
}

test('dry-run is the default', () => {
  const args = parseIngestArgs(['--adapter=manual', '--file=in.csv']);
  assert.equal(args.commit, false);
  assert.equal(args.targetEnv, null);
  assert.equal(args.restorePoint, null);
  assert.equal(args.errors.length, 0);
});

test('--commit and --test-db are parsed, and --dry-run overrides --commit', () => {
  assert.equal(parseIngestArgs(['--adapter=manual', '--file=f', '--commit']).commit, true);
  assert.equal(parseIngestArgs(['--adapter=manual', '--file=f', '--test-db']).testDb, true);
  assert.equal(parseIngestArgs(['--adapter=manual', '--file=f', '--commit', '--dry-run']).commit, false);
});

test('missing adapter/file and unknown values are errors', () => {
  assert.ok(parseIngestArgs([]).errors.includes('MISSING_ADAPTER'));
  assert.ok(parseIngestArgs(['--adapter=manual']).errors.includes('MISSING_FILE'));
  assert.ok(parseIngestArgs(['--adapter=bogus', '--file=f']).errors.includes('UNKNOWN_ADAPTER:bogus'));
  assert.ok(parseIngestArgs(['--adapter=manual', '--file=f', '--format=xml']).errors.includes('UNKNOWN_FORMAT:xml'));
  assert.ok(parseIngestArgs(['--adapter=manual', '--file=f', '--nope']).errors.includes('UNKNOWN_ARG:--nope'));
});

test('a shared-DB commit without --confirm-shared is refused', () => {
  const args = parseIngestArgs(['--adapter=manual', '--file=f', '--commit']);
  const refusal = guardSharedCommit(args, { targetIsShared: true });
  assert.ok(refusal && refusal.startsWith('REFUSED'));
});

test('a shared-DB commit WITH --confirm-shared, and any TEST commit, is allowed', () => {
  const confirmed = parseIngestArgs(['--adapter=manual', '--file=f', '--commit', '--confirm-shared']);
  assert.equal(guardSharedCommit(confirmed, { targetIsShared: true }), null);

  const testCommit = parseIngestArgs(['--adapter=manual', '--file=f', '--commit', '--test-db']);
  assert.equal(guardSharedCommit(testCommit, { targetIsShared: false }), null);
});

test('a dry-run is never refused', () => {
  const args = parseIngestArgs(['--adapter=manual', '--file=f']);
  assert.equal(guardSharedCommit(args, { targetIsShared: true }), null);
});

// --- --target-env / --restore-point parsing ---------------------------------

test('--target-env and --restore-point are parsed', () => {
  const args = parseIngestArgs([
    '--adapter=manual', '--file=f', '--commit',
    '--target-env=TARGET_DATABASE_URL', '--restore-point=' + RESTORE_POINT,
  ]);
  assert.equal(args.targetEnv, 'TARGET_DATABASE_URL');
  assert.equal(args.restorePoint, RESTORE_POINT);
  assert.equal(args.errors.length, 0);
});

test('a target that is not a variable NAME is refused, never interpreted as a URL', () => {
  for (const value of ['postgres://u:p@ep-x.neon.tech/neondb', '', 'lower_case', '1TARGET']) {
    const args = parseIngestArgs(['--adapter=manual', '--file=f', '--target-env=' + value]);
    assert.ok(
      args.errors.some((error) => error.startsWith('BAD_TARGET_ENV:')),
      JSON.stringify(value) + ' must be a BAD_TARGET_ENV error'
    );
  }
});

test('the space form of either flag is refused rather than guessed', () => {
  const target = parseIngestArgs(['--adapter=manual', '--file=f', '--target-env', 'TARGET_DATABASE_URL']);
  assert.ok(target.errors.some((error) => error.startsWith('MALFORMED_FLAG:--target-env')));
  const restore = parseIngestArgs(['--adapter=manual', '--file=f', '--restore-point', RESTORE_POINT]);
  assert.ok(restore.errors.some((error) => error.startsWith('MALFORMED_FLAG:--restore-point')));
});

test('the two variables the default paths own are not nameable as a target', () => {
  for (const name of RESERVED_TARGET_ENVS) {
    const args = parseIngestArgs(['--adapter=manual', '--file=f', '--target-env=' + name]);
    assert.ok(
      args.errors.some((error) => error.startsWith('RESERVED_TARGET_ENV:')),
      name + ' must be reserved'
    );
  }
});

test('a placeholder restore point fails the shape check', () => {
  for (const value of ['short', '<id>', 'br cool star', 'br-aaaaaaaa']) {
    const args = parseIngestArgs(['--adapter=manual', '--file=f', '--target-env=X', '--restore-point=' + value]);
    // 'br-aaaaaaaa' is a VALID shape (hyphenated, 8+ chars) - shape is the only
    // claim this check makes; see the pair below.
    if (value === 'br-aaaaaaaa') {
      assert.equal(args.errors.length, 0);
      continue;
    }
    assert.ok(args.errors.some((error) => error.startsWith('BAD_RESTORE_POINT:')), value);
  }
});

test('conflicting flags are refused, never resolved by precedence', () => {
  const bothTargets = parseIngestArgs(['--adapter=manual', '--file=f', '--test-db', '--target-env=EU_DB']);
  assert.ok(bothTargets.errors.some((error) => error.startsWith('CONFLICTING_TARGETS:')));

  const sharedPlusNamed = parseIngestArgs([
    '--adapter=manual', '--file=f', '--commit', '--confirm-shared', '--target-env=EU_DB',
  ]);
  assert.ok(sharedPlusNamed.errors.some((error) => error.startsWith('CONFLICTING_SHARED_CONFIRM:')));

  const orphanRestorePoint = parseIngestArgs(['--adapter=manual', '--file=f', '--restore-point=' + RESTORE_POINT]);
  assert.ok(orphanRestorePoint.errors.some((error) => error.startsWith('RESTORE_POINT_WITHOUT_TARGET:')));
});

test('--help suppresses the required-argument errors', () => {
  const args = parseIngestArgs(['--help']);
  assert.equal(args.help, true);
  assert.deepEqual(args.errors, []);
});

// --- resolveIngestTarget ----------------------------------------------------

test('the default path still resolves the shared database and the TEST branch', () => {
  const shared = resolveIngestTarget(parseIngestArgs(['--adapter=manual', '--file=f']), env());
  assert.equal(shared.connectionString, SHARED);
  assert.equal(shared.nonTest, true);
  assert.match(shared.digest, /^db:[0-9a-f]{12}$/);
  assert.equal(shared.connectionTimeoutMillis, 15000);

  const test = resolveIngestTarget(parseIngestArgs(['--adapter=manual', '--file=f', '--test-db']), env());
  assert.equal(test.connectionString, TEST);
  assert.equal(test.nonTest, false);
  assert.equal(test.digest, null);
  assert.match(test.label, /TEST_DATABASE_URL/);
});

test('a named target is read from that variable and kept out of process.env', () => {
  const source = env();
  const frozen = JSON.parse(JSON.stringify(source));
  const before = process.env.DATABASE_URL;

  const target = resolveIngestTarget(
    parseIngestArgs(['--adapter=manual', '--file=f', '--commit', '--target-env=TARGET_DATABASE_URL', '--restore-point=' + RESTORE_POINT]),
    source
  );
  assert.equal(target.connectionString, EU);
  assert.equal(target.label, 'TARGET_DATABASE_URL');
  assert.equal(target.nonTest, true);
  assert.equal(target.restorePoint, RESTORE_POINT);
  assert.match(target.digest, /^db:[0-9a-f]{12}$/);

  assert.deepEqual(source, frozen, 'the injected env object is not mutated');
  assert.equal(process.env.DATABASE_URL, before, 'DATABASE_URL is never overwritten');
});

test('an alias of the same endpoint resolves to the same digest', () => {
  const pooled = resolveIngestTarget(
    parseIngestArgs(['--adapter=manual', '--file=f', '--target-env=TARGET_DATABASE_URL']),
    env({ TARGET_DATABASE_URL: EU_POOLED })
  );
  const direct = resolveIngestTarget(
    parseIngestArgs(['--adapter=manual', '--file=f', '--target-env=TARGET_DATABASE_URL']),
    env()
  );
  assert.equal(pooled.digest, direct.digest);
});

test('the shared database is refused even when named through another variable', () => {
  for (const alias of [SHARED, SHARED_POOLED]) {
    assert.throws(
      () => resolveIngestTarget(
        parseIngestArgs(['--adapter=manual', '--file=f', '--target-env=TARGET_DATABASE_URL']),
        env({ TARGET_DATABASE_URL: alias })
      ),
      (error) => error instanceof UsageError && /IS the shared database/.test(error.message),
      alias
    );
  }
});

test('an unset or empty target variable is a usage error', () => {
  assert.throws(
    () => resolveIngestTarget(parseIngestArgs(['--adapter=manual', '--file=f', '--target-env=EU_NOT_SET']), env()),
    (error) => error instanceof UsageError && /unset or empty/.test(error.message)
  );
  assert.throws(
    () => resolveIngestTarget(parseIngestArgs(['--adapter=manual', '--file=f', '--target-env=TARGET_DATABASE_URL']),
      env({ TARGET_DATABASE_URL: '   ' })),
    (error) => error instanceof UsageError && /unset or empty/.test(error.message)
  );
});

test('without DATABASE_URL a named target cannot be proven distinct, so it is refused', () => {
  assert.throws(
    () => resolveIngestTarget(
      parseIngestArgs(['--adapter=manual', '--file=f', '--target-env=TARGET_DATABASE_URL']),
      { TARGET_DATABASE_URL: EU }
    ),
    (error) => error instanceof UsageError && /cannot be proven distinct/.test(error.message)
  );
});

test('--commit against a named target needs a restore point; a dry run does not', () => {
  assert.throws(
    () => resolveIngestTarget(
      parseIngestArgs(['--adapter=manual', '--file=f', '--commit', '--target-env=TARGET_DATABASE_URL']),
      env()
    ),
    (error) => error instanceof UsageError && /needs --restore-point/.test(error.message)
  );

  const dryRun = resolveIngestTarget(
    parseIngestArgs(['--adapter=manual', '--file=f', '--target-env=TARGET_DATABASE_URL']),
    env()
  );
  assert.equal(dryRun.restorePoint, null);
});

test('the TEST branch guard is re-raised untouched', () => {
  assert.throws(
    () => resolveIngestTarget(
      parseIngestArgs(['--adapter=manual', '--file=f', '--test-db']),
      env({ TEST_DATABASE_URL: SHARED })
    ),
    /TEST_DATABASE_URL must not target the shared database/
  );
});

test('the target and audit lines name a digest, never a host', () => {
  const named = resolveIngestTarget(
    parseIngestArgs(['--adapter=manual', '--file=f', '--commit', '--target-env=TARGET_DATABASE_URL', '--restore-point=' + RESTORE_POINT]),
    env()
  );
  assert.equal(targetLine(named), 'target: TARGET_DATABASE_URL (' + named.digest + ')');
  assert.equal(auditTargetLine(named, named.restorePoint),
    'AUDIT TARGET: ' + named.digest + ' restore-point=' + RESTORE_POINT);
  assert.equal(auditTargetLine(named, null), 'AUDIT TARGET: ' + named.digest);
  assert.doesNotMatch(targetLine(named) + auditTargetLine(named, RESTORE_POINT), /neon\.tech|password|u:p/);

  const test = resolveIngestTarget(parseIngestArgs(['--adapter=manual', '--file=f', '--test-db']), env());
  assert.equal(targetLine(test), 'target: TEST_DATABASE_URL (write guard)');
});
