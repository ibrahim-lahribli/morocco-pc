'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseIngestArgs, guardSharedCommit } = require('./ingest-args');

test('dry-run is the default', () => {
  const args = parseIngestArgs(['--adapter=manual', '--file=in.csv']);
  assert.equal(args.commit, false);
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
