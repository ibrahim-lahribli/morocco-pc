'use strict';

/**
 * scripts/lib/ingest-offers-cli.test.js - the CLI half of
 * `scripts/ingest-offers.js`: argument handling, conflict refusals and exit
 * codes.
 *
 * Every case here fails BEFORE a connection is opened, which is the point: the
 * refusal paths a release import depends on must be provable without a database.
 * The resolution rules themselves (unset variable, shared digest, restore point)
 * are pinned in ingest-args.test.js, where the env object is injected.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

function isolatedEnv(overrides) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, SystemRoot: process.env.SystemRoot };
  return Object.assign(env, overrides || {});
}

function run(args, env) {
  return spawnSync(process.execPath, ['scripts/ingest-offers.js'].concat(args), {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: isolatedEnv(env),
  });
}

function outputOf(child) {
  return child.stdout + child.stderr;
}

test('--help documents the release target and exits 0', () => {
  const child = run(['--help']);
  assert.equal(child.status, 0);
  const output = outputOf(child);
  assert.match(output, /--target-env=NAME/);
  assert.match(output, /--restore-point=ID/);
  assert.match(output, /never overwritten/);
});

test('the reserved and malformed target forms exit 2 before any file is read', () => {
  const reserved = run(['--adapter=manual', '--file=whatever.csv', '--commit', '--target-env=DATABASE_URL']);
  assert.equal(reserved.status, 2);
  assert.match(outputOf(reserved), /RESERVED_TARGET_ENV/);

  const asUrl = run(['--adapter=manual', '--file=whatever.csv', '--target-env=postgres://u:p@ep-x.neon.tech/neondb']);
  assert.equal(asUrl.status, 2);
  assert.match(outputOf(asUrl), /BAD_TARGET_ENV/);

  const bothTargets = run(['--adapter=manual', '--file=whatever.csv', '--test-db', '--target-env=EU_DB']);
  assert.equal(bothTargets.status, 2);
  assert.match(outputOf(bothTargets), /CONFLICTING_TARGETS/);

  const sharedConfirm = run(['--adapter=manual', '--file=whatever.csv', '--commit', '--confirm-shared', '--target-env=EU_DB']);
  assert.equal(sharedConfirm.status, 2);
  assert.match(outputOf(sharedConfirm), /CONFLICTING_SHARED_CONFIRM/);

  const orphanRestorePoint = run(['--adapter=manual', '--file=whatever.csv', '--restore-point=br-cool-star-b9whdnt1']);
  assert.equal(orphanRestorePoint.status, 2);
  assert.match(outputOf(orphanRestorePoint), /RESTORE_POINT_WITHOUT_TARGET/);

  const spaceForm = run(['--adapter=manual', '--file=whatever.csv', '--target-env', 'EU_DB']);
  assert.equal(spaceForm.status, 2);
  assert.match(outputOf(spaceForm), /MALFORMED_FLAG/);

  for (const child of [reserved, asUrl, bothTargets, sharedConfirm, orphanRestorePoint, spaceForm]) {
    assert.doesNotMatch(outputOf(child), /ECONNREFUSED|ENOTFOUND|getaddrinfo|connection terminated/i, 'nothing dialled a host');
  }
});

test('an unreadable file exits 2 and never reaches the target resolution', () => {
  const child = run(['--adapter=manual', '--file=does-not-exist.csv', '--commit', '--target-env=TARGET_DATABASE_URL']);
  assert.equal(child.status, 2);
  const output = outputOf(child);
  assert.match(output, /cannot read file does-not-exist\.csv/);
  // Not the restore-point refusal: the file is read before any target is resolved,
  // so a missing file cannot be mistaken for a target problem (or vice versa).
  assert.doesNotMatch(output, /restore-point/);
});

test('a named target with no restore point is refused at the CLI, before connecting', () => {
  // The file must PARSE for the run to reach target resolution, so the fixture
  // has to be real. It is written next to the script suite and removed in a
  // finally: a leftover file would make the next run read stale input.
  const fs = require('node:fs');
  const fixture = path.join(REPO_ROOT, '.tmp-ingest-cli.csv');
  fs.writeFileSync(fixture, [
    'source,store_name,listing_identifier,raw_price,currency,availability,observed_at',
    'manual,Seed UltraPC,L1,1299,MAD,IN_STOCK,2026-10-01T00:00:00Z',
  ].join('\n') + '\n');
  try {
    const env = {
      TARGET_DATABASE_URL: 'postgres://u:p@ep-eu-1.eu-central-1.aws.neon.tech/neondb',
      DATABASE_URL: 'postgres://u:p@ep-shared-1.eu-central-1.aws.neon.tech/neondb',
    };
    const commit = run(['--adapter=manual', '--file=.tmp-ingest-cli.csv', '--commit', '--target-env=TARGET_DATABASE_URL'], env);
    assert.equal(commit.status, 2);
    assert.match(outputOf(commit), /needs --restore-point/);
    assert.doesNotMatch(outputOf(commit), /AUDIT TARGET/, 'the refusal prints before the audit line and before connecting');

    // The same invocation naming the SHARED database through the alias is
    // refused on the digest, not on the variable name.
    const aliased = run(['--adapter=manual', '--file=.tmp-ingest-cli.csv', '--commit',
      '--target-env=TARGET_DATABASE_URL', '--restore-point=br-cool-star-b9whdnt1'], {
      TARGET_DATABASE_URL: 'postgres://u:p@ep-shared-1-pooler.eu-central-1.aws.neon.tech/neondb',
      DATABASE_URL: env.DATABASE_URL,
    });
    assert.equal(aliased.status, 2);
    assert.match(outputOf(aliased), /IS the shared database/);
  } finally {
    fs.unlinkSync(fixture);
  }
});
